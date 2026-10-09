import type { FormFieldBindings, FormFieldSnapshot } from './bindings.js';
import type { FormControllerSaveOptions } from './controller.js';
import { validatePageField, type FormPageProblem } from './pageValidation.js';
import { normalizeFormLeaseLoaded } from '../ui/formLease.js';
export type FormPageDescriptor = {
    title: string | null;
    description: string | null;
    fieldIds: string[];
    hidden: boolean;
};
export type FormPageSnapshot = {
    revision: number;
    status: 'ready' | 'blocked' | 'all-hidden' | 'retired';
    pages: FormPageDescriptor[];
    activePageIndex: number;
    currentFieldIds: string[];
    canBack: boolean;
    canNext: boolean;
    canSubmit: boolean;
    problems: FormPageProblem[];
};
export type FormPageAction =
    | { accepted: true }
    | {
          accepted: false;
          reason:
              | 'retired'
              | 'stale-revision'
              | 'blocked'
              | 'validation'
              | 'no-page'
              | 'busy';
      };
export type FormPageOwnerOptions = {
    fields: FormFieldBindings;
    /** Exact accepted owner/session/token/parent lease. Observed failure retires permanently. */
    isCurrent(): boolean;
    /** Monotonic accepted configuration epoch; do not use a reversible value hash. */
    configurationRevision(): number;
};
export type FormPageOwner = {
    getSnapshot(): FormPageSnapshot;
    subscribe(listener: (snapshot: FormPageSnapshot) => void): () => void;
    back(expectedRevision: number): FormPageAction;
    next(expectedRevision: number): FormPageAction;
    submit(
        expectedRevision: number,
        options?: FormControllerSaveOptions
    ): ReturnType<FormFieldBindings['save']>;
    /** Retires only this page owner; never destroys shared bindings or draft. */
    dispose(): void;
};
export class FormPageError extends Error {
    constructor(
        readonly reason: Exclude<FormPageAction, { accepted: true }>['reason']
    ) {
        super(`Form page action refused: ${reason}.`);
        this.name = 'FormPageError';
    }
}
const lastVisible = (
    pages: readonly FormPageDescriptor[],
    before = pages.length
): number => {
    for (let i = Math.min(before - 1, pages.length - 1); i >= 0; i--)
        if (!pages[i]!.hidden) return i;
    return -1;
};
export function createFormPageOwner(
    options: FormPageOwnerOptions
): FormPageOwner {
    const { fields } = options;
    const loaded = fields.getLoaded();
    const initial = fields.controller.getState();
    const configuration = options.configurationRevision();
    const loadedKey = JSON.stringify(normalizeFormLeaseLoaded(loaded));
    let retired = false,
        disposed = false,
        revision = 0,
        active = 0,
        emitting = false,
        syncing = false;
    let fingerprint = '';
    let backBlocked = false;
    let state: FormPageSnapshot = {
        revision,
        status: 'blocked',
        pages: [],
        activePageIndex: 0,
        currentFieldIds: [],
        canBack: false,
        canNext: false,
        canSubmit: false,
        problems: [],
    };
    const listeners = new Set<(s: FormPageSnapshot) => void>();
    const stops: (() => void)[] = [];
    const current = () => {
        if (retired || disposed) return false;
        try {
            const before = fields.controller.getState();
            const epoch = options.configurationRevision();
            const live = options.isCurrent();
            const after = fields.controller.getState();
            if (
                !live ||
                !Number.isSafeInteger(epoch) ||
                epoch < 0 ||
                epoch !== configuration ||
                before.epoch !== initial.epoch ||
                after.epoch !== initial.epoch ||
                after.contextRevision !== initial.contextRevision ||
                JSON.stringify(after.ownerScope) !==
                    JSON.stringify(initial.ownerScope) ||
                JSON.stringify(normalizeFormLeaseLoaded(fields.getLoaded())) !==
                    loadedKey
            )
                retired = true;
        } catch {
            retired = true;
        }
        return !retired && !disposed;
    };
    const sync = () => {
        if (syncing) return;
        syncing = true;
        try {
            const problems: FormPageProblem[] = [];
            const snapshots = new Map<string, FormFieldSnapshot>();
            const control = fields.controller.getState();
            const live = current();
            const config = loaded.payload.publicFields.state;
            const validConfig =
                config != null &&
                typeof config === 'object' &&
                !Array.isArray(config);
            const cfg: Record<string, unknown> = validConfig ? config : {};
            if (!validConfig)
                problems.push({ fieldId: null, code: 'invalid-metadata' });
            if (!live) retired = true;
            if (
                cfg.enableFormComputeMode === true ||
                cfg.autoSubmitAfterPrefill === true ||
                cfg.promptUserBeforeSubmission === true
            )
                problems.push({
                    fieldId: null,
                    code: 'unsupported-configuration',
                });
            const structural: FormPageDescriptor[] = [];
            const leading: FormPageDescriptor = {
                title: null,
                description: null,
                fieldIds: [],
                hidden: true,
            };
            let page = leading;
            const ids = loaded.payload.fieldIdsInForm;
            const seen = new Set<string>();
            for (const id of ids) {
                if (typeof id !== 'string' || seen.has(id)) {
                    problems.push({ fieldId: null, code: 'invalid-metadata' });
                    continue;
                }
                seen.add(id);
                const schema = loaded.payload.fieldIdsToSchemas[id];
                if (!schema) {
                    problems.push({ fieldId: id, code: 'invalid-metadata' });
                    continue;
                }
                const mini: Record<string, unknown> =
                    schema.miniExtConfig ?? {};
                if (
                    (mini.enableSectionHeader != null &&
                        typeof mini.enableSectionHeader !== 'boolean') ||
                    (mini.headerSectionTitle != null &&
                        typeof mini.headerSectionTitle !== 'string') ||
                    (mini.headerSectionDescription != null &&
                        typeof mini.headerSectionDescription !== 'string')
                )
                    problems.push({ fieldId: id, code: 'invalid-metadata' });
                const title =
                    mini.enableSectionHeader !== false &&
                    typeof mini.headerSectionTitle === 'string' &&
                    mini.headerSectionTitle.trim() !== ''
                        ? mini.headerSectionTitle
                        : null;
                if (title != null) {
                    if (structural.length === 0 && leading.fieldIds.length > 0)
                        structural.push(leading);
                    page = {
                        title,
                        description:
                            typeof mini.headerSectionDescription === 'string'
                                ? mini.headerSectionDescription
                                : null,
                        fieldIds: [],
                        hidden: true,
                    };
                    structural.push(page);
                }
                page.fieldIds.push(id);
                if (live) {
                    const snapshot = fields.field(id).getSnapshot();
                    snapshots.set(id, snapshot);
                    if (snapshot.visibility.type !== 'hidden')
                        page.hidden = false;
                    if (snapshot.visibility.type === 'blocked')
                        problems.push({
                            fieldId: id,
                            code: 'blocked-visibility',
                        });
                }
            }
            if (structural.length === 0 && leading.fieldIds.length > 0)
                structural.push(leading);
            const pages =
                cfg.multiPageFormMode === 'multi-page' && structural.length > 1
                    ? structural
                    : ids.length === 0
                      ? []
                      : [
                            {
                                title: null,
                                description: null,
                                fieldIds: [...ids],
                                hidden: [...snapshots.values()].every(
                                    (s) => s.visibility.type === 'hidden'
                                ),
                            },
                        ];
            if (
                cfg.multiPageFormMode != null &&
                cfg.multiPageFormMode !== 'one-page' &&
                cfg.multiPageFormMode !== 'multi-page'
            )
                problems.push({
                    fieldId: null,
                    code: 'unsupported-configuration',
                });
            const first = pages.findIndex((p) => !p.hidden);
            if (active >= pages.length || pages[active]?.hidden)
                active = first < 0 ? 0 : first;
            const currentIds = pages[active]?.fieldIds ?? [];
            const last = lastVisible(pages);
            // Next follows the current page. Final Submit rechecks the complete
            // native answer using each rule's own hidden/read-only exceptions.
            for (const [id, snapshot] of snapshots) {
                if (!snapshot.field) {
                    problems.push({ fieldId: id, code: 'invalid-metadata' });
                    continue;
                }
                const issue = validatePageField(
                    snapshot.field,
                    control.draft?.data[id],
                    loaded.payload.formRecord.data[id],
                    snapshot.visibility.type === 'hidden'
                );
                if (issue && (active === last || currentIds.includes(id)))
                    problems.push(issue);
                if (
                    (active === last || currentIds.includes(id)) &&
                    snapshot.visibility.type === 'visible' &&
                    !snapshot.readOnly &&
                    (snapshot.scalar?.valid === false ||
                        snapshot.date?.error != null)
                )
                    problems.push({ fieldId: id, code: 'invalid-input' });
            }
            if (!current()) retired = true;
            const blocked = problems.some((p) =>
                [
                    'unsupported-configuration',
                    'unsupported-validation',
                    'invalid-metadata',
                    'blocked-visibility',
                ].includes(p.code)
            );
            backBlocked = problems.some((p) =>
                [
                    'unsupported-configuration',
                    'invalid-metadata',
                    'blocked-visibility',
                ].includes(p.code)
            );
            const busy =
                control.status === 'saving' ||
                !control.canSave ||
                [...snapshots.values()].some(
                    (s) =>
                        s.pending ||
                        (s.visibility.type === 'visible' &&
                            !s.readOnly &&
                            !s.canEdit)
                );
            const status: FormPageSnapshot['status'] = retired
                ? 'retired'
                : first < 0
                  ? 'all-hidden'
                  : blocked
                    ? 'blocked'
                    : 'ready';
            const shape = {
                status,
                pages,
                activePageIndex: active,
                currentFieldIds: currentIds,
                canBack:
                    status !== 'retired' &&
                    status !== 'all-hidden' &&
                    !backBlocked &&
                    !busy &&
                    pages.some((p, i) => i < active && !p.hidden),
                canNext:
                    status === 'ready' &&
                    !busy &&
                    problems.length === 0 &&
                    pages.some((p, i) => i > active && !p.hidden),
                canSubmit:
                    status === 'ready' &&
                    !busy &&
                    problems.length === 0 &&
                    active === last &&
                    [...snapshots.values()].some((s) => !s.readOnly),
                problems,
            };
            const key = JSON.stringify([
                shape,
                control.draftRevision,
                control.status,
                [...snapshots].map(([id, s]) => [
                    id,
                    s.scalar,
                    s.date,
                    s.pending,
                    s.retired,
                ]),
            ]);
            if (key !== fingerprint) {
                fingerprint = key;
                revision++;
            }
            state = { ...shape, revision };
        } finally {
            syncing = false;
        }
    };
    const snapshot = () => {
        sync();
        return structuredClone(state);
    };
    const notify = () => {
        if (emitting) return;
        const before = revision;
        sync();
        if (before === revision) return;
        emitting = true;
        try {
            for (const listener of [...listeners]) {
                const ticket = revision;
                try {
                    listener(structuredClone(state));
                } catch {
                    /* Renderer errors do not change state. */
                }
                sync();
                if (revision !== ticket || retired) break;
            }
        } finally {
            emitting = false;
        }
    };
    const refusal = (expected: number, back = false): FormPageAction | null => {
        sync();
        if (retired) return { accepted: false, reason: 'retired' };
        if (expected !== revision)
            return { accepted: false, reason: 'stale-revision' };
        if (state.status === 'all-hidden')
            return { accepted: false, reason: 'no-page' };
        if (state.status === 'blocked' && (!back || backBlocked))
            return { accepted: false, reason: 'blocked' };
        if (
            !fields.controller.getState().canSave ||
            [...state.pages.flatMap((p) => p.fieldIds)].some((id) => {
                const s = fields.field(id).getSnapshot();
                return (
                    s.pending ||
                    (s.visibility.type === 'visible' &&
                        !s.readOnly &&
                        !s.canEdit)
                );
            })
        )
            return { accepted: false, reason: 'busy' };
        return null;
    };
    sync();
    stops.push(fields.controller.subscribe(notify));
    for (const id of loaded.payload.fieldIdsInForm) {
        try {
            stops.push(fields.field(id).subscribe(notify));
        } catch {
            /* Missing metadata is reported in the snapshot. */
        }
    }
    return {
        getSnapshot: snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        back(expected) {
            const denied = refusal(expected, true);
            if (denied) return denied;
            const index = lastVisible(state.pages, active);
            if (index < 0) return { accepted: false, reason: 'no-page' };
            active = index;
            const completionRevision = revision + 1;
            notify();
            if (revision !== completionRevision && current())
                return { accepted: false, reason: 'stale-revision' };
            return current()
                ? { accepted: true }
                : { accepted: false, reason: 'retired' };
        },
        next(expected) {
            const denied = refusal(expected);
            if (denied) return denied;
            if (state.problems.length > 0)
                return { accepted: false, reason: 'validation' };
            const index = state.pages.findIndex(
                (p, i) => i > active && !p.hidden
            );
            if (index < 0) return { accepted: false, reason: 'no-page' };
            active = index;
            const completionRevision = revision + 1;
            notify();
            if (revision !== completionRevision && current())
                return { accepted: false, reason: 'stale-revision' };
            return current()
                ? { accepted: true }
                : { accepted: false, reason: 'retired' };
        },
        async submit(expected, saveOptions) {
            const denied = refusal(expected);
            if (denied && !denied.accepted)
                throw new FormPageError(denied.reason);
            if (!state.canSubmit)
                throw new FormPageError(
                    state.problems.length ? 'validation' : 'no-page'
                );
            const draftRevision = fields.controller.getState().draftRevision;
            const pageIndex = active;
            return fields.save({
                ...saveOptions,
                lifecycle: {
                    dispatch(input, draftRevision) {
                        // Inspect the effective controller input, including inherited
                        // binding options, before a journal attempt or transport exists.
                        if (input.isComputeMode === true)
                            throw new FormPageError('blocked');
                        const operation = saveOptions?.lifecycle?.dispatch(
                            input,
                            draftRevision
                        );
                        return {
                            accepted(result) {
                                operation?.accepted(result);
                            },
                            finish(disposition) {
                                operation?.finish(disposition);
                            },
                        };
                    },
                },
                isCurrent: () => {
                    const owns = () =>
                        current() &&
                        active === pageIndex &&
                        fields.controller.getState().draftRevision ===
                            draftRevision;
                    if (!owns()) return false;
                    const callerCurrent = saveOptions?.isCurrent?.() ?? true;
                    return callerCurrent && owns();
                },
            });
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            retired = true;
            for (const stop of stops) stop();
            notify();
            listeners.clear();
        },
    };
}
