import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
} from '@miniextensions/sdk';
import {
    composeFormFieldVisibility,
    createFormProgressStorage,
    describeLoadedFormFields,
    type FormDraftSnapshot,
    type FormProgressSnapshot,
    type FormProgressToken,
    type FormProgressValues,
} from '@miniextensions/sdk/forms';
import { button, element, labeled, settings } from './dom.js';

type ProgressOptions = {
    page: FormLoadedResult;
    visitor: string;
    apiOrigin: string;
    shareId: string;
    isCurrent(): boolean;
    getDraft(): FormDraftSnapshot<AirtableValue> | null;
    getRevision(): number | null;
    getInputRevision(): number;
    report(message: string, error?: boolean): void;
    restore(
        values: FormProgressValues,
        accepts: (page: FormLoadedResult) => boolean,
        consume: (isCurrent: () => boolean) => Promise<boolean>
    ): Promise<void>;
};
export type BrowserCreateProgress = {
    node: HTMLElement;
    changed(): void;
    discard(): Promise<boolean>;
    beforeSave(): Promise<boolean>;
    resume(): void;
    retire(): void;
};

const mounts = new Map<string, Set<BrowserCreateProgress>>();
const remembered = new Map<string, Map<string, FormProgressToken>>();
const blocked = new Set<string>();
const scalarTypes = new Set<string>([
    AirtableFieldType.SINGLE_LINE_TEXT,
    AirtableFieldType.MULTILINE_TEXT,
    AirtableFieldType.NUMBER,
    AirtableFieldType.CURRENCY,
    AirtableFieldType.PERCENT,
    AirtableFieldType.DURATION,
    AirtableFieldType.RATING,
    AirtableFieldType.CHECKBOX,
]);
const ownerKey = (visitor: string) =>
    'sdk-create-progress-owner:v1:' +
    JSON.stringify([location.origin, visitor]);
const id = () => document.defaultView!.crypto.randomUUID();
const storage = () => document.defaultView!.sessionStorage;
const locks = () => {
    const manager = document.defaultView!.navigator.locks;
    return manager == null
        ? undefined
        : {
              request: <Result>(
                  name: string,
                  callback: () => Result
              ): Promise<Result> => manager.request(name, callback),
          };
};
const owner = (visitor: string): string => {
    if (blocked.has(visitor)) throw new Error();
    const adapter = storage();
    const key = ownerKey(visitor);
    const previous = adapter.getItem(key);
    if (previous) return previous;
    const next = id();
    adapter.setItem(key, next);
    return next;
};
const identity = (page: FormLoadedResult) => {
    const tableId = settings(page.payload.publicFields).tableId;
    return typeof tableId === 'string' &&
        tableId.trim() !== '' &&
        typeof page.publishedVersionId === 'string' &&
        page.publishedVersionId.trim() !== ''
        ? [page.extensionId, tableId, page.publishedVersionId]
        : null;
};
// This comparison stays in memory. It is never a storage key or stored value.
const configuration = (page: FormLoadedResult) =>
    JSON.stringify([
        identity(page),
        page.payload.hasParentExtension,
        page.payload.fieldIdsInForm,
        page.payload.fieldIdsToSchemas,
    ]);
const maskExcluded = (config: unknown): boolean => {
    if (config === undefined || config === null) return false;
    if (typeof config !== 'object' || Array.isArray(config)) return true;
    for (const key of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
        const value = (config as Record<string, unknown>)[key];
        if (value !== undefined && value !== false) return true;
    }
    return false;
};

export const retireBrowserCreateProgress = (visitor: string): void => {
    for (const mount of mounts.get(visitor) ?? []) mount.retire();
};

/** Explicit forgetting rotates the anonymous namespace before waiting for locks. */
export const forgetBrowserCreateProgress = async (
    visitor: string
): Promise<boolean> => {
    retireBrowserCreateProgress(visitor);
    let complete = true;
    try {
        const adapter = storage();
        if (adapter.getItem(ownerKey(visitor)))
            adapter.setItem(ownerKey(visitor), id());
        blocked.delete(visitor);
    } catch {
        blocked.add(visitor);
        complete = false;
    }
    const entries = remembered.get(visitor);
    const captured = [...(entries ?? [])];
    for (const [scope, token] of captured) {
        // A detached cleanup lease can remove only the captured exact incarnation.
        const cleanup = createFormProgressStorage({
            scope,
            getStorage: storage,
            getLocks: locks,
            createId: id,
            isCurrent: () => true,
        });
        const result = await cleanup.remove(token);
        cleanup.destroy();
        if (result.status === 'removed' || result.status === 'absent') {
            if (entries?.get(scope) === token) entries.delete(scope);
        } else complete = false;
    }
    return complete;
};

/** Optional, anonymous direct-create recipe; no credentials or native objects are stored. */
export const createBrowserCreateProgress = (
    options: ProgressOptions
): BrowserCreateProgress | null => {
    const { page, visitor } = options;
    const target = identity(page);
    if (
        !target ||
        page.payload.formRecord.type !== 'create' ||
        settings(page.payload.publicFields).saveFormProgress !== true
    )
        return null;
    let initialConfiguration: string;
    try {
        initialConfiguration = configuration(page);
    } catch {
        return null;
    }
    let retired = false;
    let suspended = false;
    let enabled = false;
    let candidate: FormProgressSnapshot | null = null;
    let token: FormProgressToken | null = null;
    let scope: string | null = null;
    let backend: ReturnType<typeof createFormProgressStorage> | null = null;
    let queue: Promise<void> = Promise.resolve();
    let lastValues: string | null = null;
    let failed = false;
    let writeEpoch = 0;
    let flightWrite: ReturnType<typeof createFormProgressStorage> | null = null;
    const selected = new Set<string>();
    const current = () => {
        try {
            return (
                !retired &&
                options.isCurrent() &&
                configuration(page) === initialConfiguration
            );
        } catch {
            return false;
        }
    };
    const retireWrite = () => {
        writeEpoch++;
        flightWrite?.destroy();
        flightWrite = null;
    };
    const makeScope = (namespace: string) =>
        JSON.stringify([
            'browser-create-progress',
            1,
            location.origin,
            new URL(options.apiOrigin).origin,
            options.shareId,
            visitor,
            namespace,
            ...target,
        ]);
    const openBackend = (nextScope: string) => {
        scope = nextScope;
        backend?.destroy();
        backend = createFormProgressStorage({
            scope,
            getStorage: storage,
            getLocks: locks,
            createId: id,
            isCurrent: current,
        });
        return backend;
    };
    const node = element('section');
    node.setAttribute('aria-label', 'Optional Form progress');
    const optIn = element('input');
    optIn.type = 'checkbox';
    node.append(
        labeled('Remember selected answers in this tab', optIn),
        element(
            'p',
            'Optional. Select only nonsensitive answers. Selected answers are readable by scripts on this origin and may be copied when this tab is duplicated. Files, hidden and masked fields are excluded.',
            'hint'
        )
    );
    const choices = element('div');
    const message = element('p', '', 'hint');
    const actions = element('div', undefined, 'actions');
    node.append(choices, actions, message);
    const notice = (text: string, error = false) => {
        if (current()) {
            message.textContent = text;
            if (error) options.report(text, true);
        }
    };
    const rememberToken = (next: FormProgressToken) => {
        token = next;
        if (scope == null) return;
        let entries = remembered.get(visitor);
        if (!entries) remembered.set(visitor, (entries = new Map()));
        entries.set(scope, next);
    };
    const forgetToken = (previous: FormProgressToken) => {
        if (scope && remembered.get(visitor)?.get(scope) === previous)
            remembered.get(visitor)!.delete(scope);
        if (token === previous) token = null;
    };
    const eligible = (draft: FormDraftSnapshot<AirtableValue>) => {
        const visibility = composeFormFieldVisibility({
            fieldIds: page.payload.fieldIdsInForm,
            fieldIdsToSchemas: page.payload.fieldIdsToSchemas,
            airtableFields: Object.values(page.payload.fieldIdsToSchemas).map(
                (field) => field.airtableField
            ),
            data: draft.data,
            formRecordType: 'create',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        });
        return describeLoadedFormFields(page).filter(
            (field) =>
                scalarTypes.has(field.fieldType) &&
                !field.isComputed &&
                !field.readOnly &&
                field.schema.airtableField.isComputed === false &&
                !maskExcluded(field.schema.miniExtConfig) &&
                visibility[field.fieldId]?.type === 'visible'
        );
    };
    const project = (
        source: Record<string, unknown>,
        draft: FormDraftSnapshot<AirtableValue>
    ): FormProgressValues => {
        const values: FormProgressValues = {};
        for (const field of eligible(draft)) {
            if (
                !selected.has(field.fieldId) ||
                !Object.hasOwn(source, field.fieldId)
            )
                continue;
            // Read the native value only after explicit selection and all metadata gates.
            const value = source[field.fieldId];
            const valid =
                value === null ||
                (field.fieldType === AirtableFieldType.CHECKBOX
                    ? typeof value === 'boolean'
                    : field.fieldType === AirtableFieldType.SINGLE_LINE_TEXT ||
                        field.fieldType === AirtableFieldType.MULTILINE_TEXT
                      ? typeof value === 'string'
                      : typeof value === 'number' && Number.isFinite(value));
            if (!valid || !current()) continue;
            Object.defineProperty(values, field.fieldId, {
                value,
                enumerable: true,
            });
        }
        return values;
    };
    const renderChoices = () => {
        restoreButton.disabled = !enabled || suspended || !candidate;
        discardButton.disabled = !enabled || suspended || !token;
        choices.replaceChildren();
        const draft = options.getDraft();
        if (!draft || !current()) return;
        try {
            for (const field of eligible(draft)) {
                const input = element('input');
                input.type = 'checkbox';
                input.checked = selected.has(field.fieldId);
                input.disabled = !enabled || suspended;
                input.dataset.progressFieldId = field.fieldId;
                input.addEventListener('change', () => {
                    if (!current() || !enabled || suspended) return;
                    if (input.checked) selected.add(field.fieldId);
                    else selected.delete(field.fieldId);
                    bridge.changed();
                });
                choices.append(
                    labeled(
                        `Remember ${field.schema.airtableField.name}`,
                        input
                    )
                );
            }
        } catch {
            notice('Remembering is unavailable for this Form configuration.');
        }
    };
    const remove = async (
        ownsOperation: () => boolean = current
    ): Promise<boolean> => {
        if (!backend || !token) {
            lastValues = null;
            return true;
        }
        const previous = token;
        const cleanup = createFormProgressStorage({
            scope: scope!,
            getStorage: storage,
            getLocks: locks,
            createId: id,
            isCurrent: () => current() && ownsOperation(),
        });
        const result = await cleanup.remove(previous);
        cleanup.destroy();
        if (!current() || !ownsOperation()) return false;
        if (result.status !== 'removed' && result.status !== 'absent') {
            failed = true;
            notice(
                'Remembered answers could not be cleared. Save was not sent. Try clearing them explicitly before saving.',
                true
            );
            return false;
        }
        forgetToken(previous);
        candidate = null;
        lastValues = null;
        failed = false;
        return true;
    };
    const restoreButton = button('Restore remembered answers', () => {
        if (!current() || !enabled || suspended || !candidate) return;
        if (options.getRevision() !== 0 || options.getInputRevision() !== 0) {
            notice(
                'Current answers were retained. Reload replaces current inputs before Restore can be used.',
                true
            );
            return;
        }
        const draft = options.getDraft();
        if (!draft) return;
        const values = project(candidate.values, draft);
        if (!Object.keys(values).length) {
            notice('Select the nonsensitive answers to restore first.');
            return;
        }
        const proposed = { ...draft.data, ...values };
        const validated = project(values, {
            data: proposed,
            dirtyFieldIds: [],
        });
        if (!Object.keys(validated).length) {
            notice('No selected answers are eligible to restore.');
            return;
        }
        retireWrite();
        const restoreEpoch = writeEpoch;
        suspended = true;
        renderChoices();
        void options
            .restore(
                validated,
                (returned) =>
                    current() &&
                    enabled &&
                    writeEpoch === restoreEpoch &&
                    returned.payload.formRecord.type === 'create' &&
                    settings(returned.payload.publicFields).saveFormProgress ===
                        true &&
                    configuration(returned) === initialConfiguration,
                async (ownsOperation) =>
                    current() && (await remove(ownsOperation)) && current()
            )
            .finally(() => {
                if (current()) {
                    suspended = false;
                    renderChoices();
                }
            });
    });
    const discardButton = button('Discard remembered answers', () => {
        if (!current() || !enabled || suspended) return;
        retireWrite();
        suspended = true;
        renderChoices();
        queue = queue.then(async () => {
            if (await remove()) {
                failed = false;
                notice('Remembered answers discarded. No record was saved.');
            }
            if (current()) {
                suspended = false;
                renderChoices();
            }
        });
    });
    actions.append(restoreButton, discardButton);
    optIn.addEventListener('change', () => {
        if (!current()) return;
        retireWrite();
        enabled = optIn.checked;
        if (!enabled) {
            suspended = true;
            queue = queue.then(async () => {
                await remove();
                suspended = false;
                renderChoices();
            });
            return;
        }
        try {
            const read = openBackend(makeScope(owner(visitor))).read();
            if (read.status !== 'read') throw new Error();
            candidate = read.snapshot;
            if (candidate) rememberToken(candidate.token);
            notice(
                candidate
                    ? 'Remembered answers are available. Select fields, then Restore or Discard explicitly.'
                    : 'Select the nonsensitive answers to remember.'
            );
        } catch {
            enabled = false;
            optIn.checked = false;
            notice(
                'Browser progress storage is unavailable. No answers were remembered.'
            );
        }
        renderChoices();
    });
    const bridge: BrowserCreateProgress = {
        node,
        changed() {
            if (!current()) {
                bridge.retire();
                return;
            }
            retireWrite();
            renderChoices();
            if (!enabled || suspended || candidate || !backend) return;
            const epoch = writeEpoch;
            const revision = options.getRevision();
            const inputRevision = options.getInputRevision();
            const draft = options.getDraft();
            if (!draft) return;
            let values: FormProgressValues;
            try {
                values = project(draft.data, draft);
            } catch {
                return;
            }
            const serialized = JSON.stringify(values);
            if (serialized === lastValues) return;
            const selectedBackend = backend;
            queue = queue.then(async () => {
                if (
                    !current() ||
                    suspended ||
                    !enabled ||
                    epoch !== writeEpoch ||
                    revision !== options.getRevision() ||
                    inputRevision !== options.getInputRevision() ||
                    selectedBackend !== backend
                )
                    return;
                if (!Object.keys(values).length) {
                    if (token) await remove();
                    return;
                }
                const writeOwner = createFormProgressStorage({
                    scope: scope!,
                    getStorage: storage,
                    getLocks: locks,
                    createId: id,
                    isCurrent: () =>
                        current() &&
                        enabled &&
                        !suspended &&
                        epoch === writeEpoch &&
                        revision === options.getRevision() &&
                        inputRevision === options.getInputRevision(),
                });
                flightWrite = writeOwner;
                const result = await writeOwner.write({
                    expected: token,
                    values,
                });
                writeOwner.destroy();
                if (flightWrite === writeOwner) flightWrite = null;
                if (!current() || epoch !== writeEpoch) return;
                if (result.status === 'written') {
                    rememberToken(result.snapshot.token);
                    lastValues = serialized;
                    failed = false;
                    notice('Selected answers remembered in this tab.');
                } else if (result.status !== 'retired') {
                    failed = true;
                    lastValues = null;
                    notice(
                        'Answers were not remembered. Another draft or unavailable browser storage requires explicit inspection.'
                    );
                }
            });
        },
        async beforeSave() {
            retireWrite();
            suspended = true;
            renderChoices();
            await queue;
            const refuse = () => {
                suspended = false;
                renderChoices();
                return false;
            };
            if (!current()) return refuse();
            if (enabled && candidate) {
                notice(
                    'Restore or discard the remembered answers before saving this Form.',
                    true
                );
                return refuse();
            }
            // Explicit Save must also clear a prior document's progress when the
            // current opt-in is unchecked. Reading never restores its values.
            if (!token) {
                try {
                    if (!backend) {
                        const namespace = storage().getItem(ownerKey(visitor));
                        if (namespace) openBackend(makeScope(namespace));
                    }
                    if (backend) {
                        const read = backend.read();
                        if (read.status !== 'read') throw new Error();
                        if (read.snapshot) rememberToken(read.snapshot.token);
                        else failed = false;
                    }
                } catch {
                    notice(
                        'Remembered answers could not be checked. Save was not sent.',
                        true
                    );
                    return refuse();
                }
            }
            if (!(await remove()) || !current()) return refuse();
            // A same-document remount may have retired the opt-in UI while its
            // accepted progress remains. Clear only its recorded exact tokens.
            for (const [knownScope, knownToken] of remembered.get(visitor) ??
                []) {
                const parts: unknown = JSON.parse(knownScope);
                if (
                    !Array.isArray(parts) ||
                    parts[2] !== location.origin ||
                    parts[3] !== new URL(options.apiOrigin).origin ||
                    parts[4] !== options.shareId ||
                    JSON.stringify(parts.slice(-3)) !== JSON.stringify(target)
                )
                    continue;
                const cleanup = createFormProgressStorage({
                    scope: knownScope,
                    getStorage: storage,
                    getLocks: locks,
                    createId: id,
                    isCurrent: current,
                });
                const result = await cleanup.remove(knownToken);
                cleanup.destroy();
                if (
                    !current() ||
                    (result.status !== 'removed' && result.status !== 'absent')
                ) {
                    notice(
                        'Remembered answers could not be cleared. Save was not sent.',
                        true
                    );
                    return refuse();
                }
                if (remembered.get(visitor)?.get(knownScope) === knownToken)
                    remembered.get(visitor)!.delete(knownScope);
            }
            return failed ? refuse() : true;
        },
        async discard() {
            retireWrite();
            suspended = true;
            renderChoices();
            await queue;
            const cleared = current() && (await remove());
            if (!cleared && current()) {
                suspended = false;
                renderChoices();
            }
            return cleared;
        },
        resume() {
            if (current()) {
                suspended = false;
                renderChoices();
                bridge.changed();
            }
        },
        retire() {
            if (retired) return;
            retireWrite();
            retired = true;
            backend?.destroy();
            mounts.get(visitor)?.delete(bridge);
        },
    };
    let active = mounts.get(visitor);
    if (!active) mounts.set(visitor, (active = new Set()));
    active.add(bridge);
    renderChoices();
    return bridge;
};
