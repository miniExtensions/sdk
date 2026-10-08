import type {
    MiniExtensionsClient,
    FormLoadedResult,
    SelectFieldChoice,
} from '../runtime/types.js';
import type { FormFieldBindings } from './bindings.js';
import { getSelectFieldPolicy } from '../ui/selectPolicy.js';
import { resolveSelectFieldAvailability } from '../ui/selectAvailability.js';
import { formChoiceConditionRecord } from './choiceRecord.js';
import {
    RecoveryJournal,
    type RecoveryScope,
    type RecoveryAttempt,
} from './recovery.js';

export type SelectChoicePhase =
    | 'idle'
    | 'creating'
    | 'created-selected'
    | 'created-not-selected'
    | 'uncertain'
    | 'retired';
export type FormSelectChoiceSnapshot = {
    phase: SelectChoicePhase;
    canCreate: boolean;
    busy: boolean;
    error: string | null;
    revision: number;
    /** Detached canonical metadata; creation does not mean record Save. */
    choice: SelectFieldChoice | null;
};
export type SelectChoiceRecovery = {
    journal: RecoveryJournal;
    scope: RecoveryScope;
    loadVersion: number;
};
export type SelectChoiceAdapter = {
    getLoaded?(): FormLoadedResult;
    isCurrent?(): boolean;
    /** Own-response write lease when canWrite intentionally blocks the journal's pending attempt. Defaults to the owner's canWrite. */
    canAccept?(): boolean;
    /** Advance on observed policy/context replacements, including A→B→A. */
    configurationRevision?(): string | number;
    onAttempt?(attempt: RecoveryAttempt): void;
};
export type FormSelectChoiceController = {
    getSnapshot(): FormSelectChoiceSnapshot;
    subscribe(
        listener: (snapshot: FormSelectChoiceSnapshot) => void
    ): () => void;
    /** Explicit mutation. Refusal makes no request or journal attempt. */
    create(name: string): Promise<boolean>;
    cancel(): void;
    blocksForm(): boolean;
    dispose(): void;
};

type Options = SelectChoiceRecovery &
    SelectChoiceAdapter & {
        form: FormFieldBindings;
        fieldId: string;
        client: MiniExtensionsClient;
        canWrite(): boolean;
        /** Fresh field/UI lease excluding only the own journal-pending block. */
        canAccept(): boolean;
        changed(): void;
        /** Internal owner commit: install metadata, optionally select, then settle before publication. */
        install(
            choice: SelectFieldChoice,
            selected: boolean,
            accepted: () => void
        ): boolean;
    };

/** One owner-held mutation state. No names/credentials are retained in the journal. */
export function createFormSelectChoiceController(
    options: Options
): FormSelectChoiceController {
    const { form, client, fieldId, journal } = options;
    const scope = structuredClone(options.scope);
    const initial = form.controller.getState();
    const epoch = initial.epoch;
    const context = initial.contextRevision;
    let retired = false;
    let active: AbortController | null = null;
    let phase: SelectChoicePhase = 'idle';
    let error: string | null = null;
    let choice: SelectFieldChoice | null = null;
    let revision = 0;
    let emission = 0;
    let observed: string | null = null;
    const listeners = new Set<(snapshot: FormSelectChoiceSnapshot) => void>();
    const current = (): boolean => {
        const state = form.controller.getState();
        return (
            !retired &&
            state.epoch === epoch &&
            state.contextRevision === context &&
            state.draft !== null &&
            state.status !== 'stale' &&
            state.status !== 'disposed' &&
            (options.isCurrent?.() ?? true)
        );
    };
    const loaded = () =>
        structuredClone(options.getLoaded?.() ?? form.getLoaded());
    const recordId = () => {
        const record = loaded().payload.formRecord;
        return record.type === 'edit' ? record.recordId : null;
    };
    const blocked = () =>
        current() && journal.blocking(scope, recordId()) != null;
    const inspect = () => {
        const page = loaded();
        const state = form.controller.getState();
        const schema = page.payload.fieldIdsToSchemas[fieldId];
        const policy = getSelectFieldPolicy(schema!);
        const value = state.draft?.data[fieldId];
        const multiple = schema!.fieldType === 'multipleSelects';
        const values =
            value == null || (typeof value === 'string' && value.trim() === '')
                ? []
                : multiple
                  ? Array.isArray(value) &&
                    Array.from(value).every(
                        (item, index) =>
                            Object.hasOwn(value, index) &&
                            typeof item === 'string' &&
                            item !== ''
                    )
                      ? ([...value] as string[])
                      : null
                  : typeof value === 'string'
                    ? [value]
                    : null;
        const availability = resolveSelectFieldAvailability({
            field: schema!,
            airtableFields: Object.values(page.payload.fieldIdsToSchemas).map(
                (item) => item.airtableField
            ),
            recordForConditionEvaluation:
                state.draft == null
                    ? null
                    : formChoiceConditionRecord(
                          page,
                          schema!,
                          state.draft.data
                      ),
            mode: 'runtime',
            invalidConditionMode: 'compatibility',
        });
        const key = JSON.stringify([
            page.extensionId,
            page.payload.extensionAccessToken,
            page.payload.fieldIdsInForm,
            page.payload.fieldIdsToSchemas,
            client.getSession(),
            state.ownerScope,
            state.contextRevision,
            options.configurationRevision?.(),
        ]);
        if (key !== observed) {
            observed = key;
            revision++;
        }
        return {
            page,
            state,
            schema: schema!,
            policy,
            availability,
            values,
            multiple,
            key,
        };
    };
    const canCreate = () => {
        try {
            if (
                !current() ||
                active !== null ||
                blocked() ||
                !options.canWrite()
            )
                return false;
            const info = inspect();
            return (
                info.policy.allowAddingNewOptions &&
                info.availability.status === 'ready' &&
                info.values !== null &&
                (info.state.status === 'ready' ||
                    info.state.status === 'saved' ||
                    info.state.status === 'validation-error') &&
                (!info.multiple ||
                    info.policy.maxSelections === null ||
                    info.values.length < info.policy.maxSelections)
            );
        } catch {
            return false;
        }
    };
    const snapshot = (): FormSelectChoiceSnapshot => {
        const live = current();
        const allowed = canCreate();
        // Observe policy even while the own attempt blocks ordinary writes.
        if (current()) {
            try {
                inspect();
            } catch {
                observed = null;
                revision++;
            }
        }
        return {
            phase: !live
                ? 'retired'
                : blocked() && active === null
                  ? 'uncertain'
                  : phase,
            canCreate: allowed,
            busy: active !== null,
            error: !live ? null : error,
            revision,
            choice: !live || choice == null ? null : structuredClone(choice),
        };
    };
    const emit = () => {
        if (!current()) return;
        const delivery = ++emission;
        const next = snapshot();
        for (const listener of [...listeners]) {
            if (!current() || delivery !== emission) break;
            if (listeners.has(listener)) {
                try {
                    listener(structuredClone(next));
                } catch {}
            }
        }
        if (current() && delivery === emission) {
            try {
                options.changed();
            } catch {}
        }
    };
    const dispose = () => {
        if (retired) return;
        retired = true;
        revision++;
        emission++;
        const previous = active;
        active = null;
        for (const listener of [...listeners]) {
            try {
                listener(snapshot());
            } catch {}
        }
        listeners.clear();
        stop();
        previous?.abort();
    };
    let stop = () => {};
    stop = form.controller.subscribe((state) => {
        if (
            state.epoch !== epoch ||
            state.contextRevision !== context ||
            state.status === 'stale' ||
            state.status === 'disposed'
        )
            dispose();
    });
    if (retired) stop();
    return {
        getSnapshot: snapshot,
        blocksForm: () => active !== null || blocked(),
        subscribe(listener) {
            listeners.add(listener);
            listener(snapshot());
            return () => listeners.delete(listener);
        },
        async create(name) {
            if (
                typeof name !== 'string' ||
                name.trim() === '' ||
                !canCreate()
            ) {
                if (current() && active === null) {
                    error =
                        'This choice cannot be created with the current Form settings.';
                    emit();
                }
                return false;
            }
            const captured = inspect();
            const capturedRevision = revision;
            const abort = new AbortController();
            let attempt: RecoveryAttempt;
            try {
                attempt = journal.begin(
                    scope,
                    recordId(),
                    'choice',
                    options.loadVersion,
                    fieldId
                );
            } catch {
                return false;
            }
            active = abort;
            phase = 'creating';
            error = null;
            choice = null;
            const ownsAttempt = () => {
                if (
                    !current() ||
                    active !== abort ||
                    abort.signal.aborted ||
                    !options.canAccept()
                )
                    return false;
                const now = inspect();
                return (
                    revision === capturedRevision &&
                    now.key === captured.key &&
                    now.state.draftRevision === captured.state.draftRevision &&
                    attempt.flight &&
                    attempt.outcome === 'unknown' &&
                    attempt.acknowledgment === 'none' &&
                    journal.blocking(scope, recordId()) === attempt
                );
            };
            try {
                options.onAttempt?.(attempt);
                emit();
                if (!ownsAttempt()) return false;
                const result = await client.forms.addSelectOption(
                    {
                        extensionAccessToken:
                            captured.page.payload.extensionAccessToken,
                        airtableFieldId: fieldId,
                        newChoiceText: name,
                    },
                    { signal: abort.signal }
                );
                if (!ownsAttempt()) return false;
                const returned = result?.newChoice;
                if (
                    returned == null ||
                    typeof returned.id !== 'string' ||
                    returned.id.trim() === '' ||
                    typeof returned.name !== 'string' ||
                    returned.name.trim() === ''
                )
                    return false;
                const now = inspect();
                const schema = structuredClone(now.schema);
                const config = schema.airtableField.config;
                if (
                    config.type !== 'singleSelect' &&
                    config.type !== 'multipleSelects'
                )
                    return false;
                // The canonical route may reuse the same ID/name. Conflicting identities must not overwrite metadata.
                if (
                    now.policy.options.some(
                        (item) =>
                            (item.id === returned.id &&
                                item.value !== returned.name) ||
                            (item.id !== returned.id &&
                                item.value === returned.name)
                    )
                )
                    return false;
                config.options = {
                    ...config.options,
                    choices: [
                        ...(config.options?.choices ?? []).filter(
                            (item) => item.id !== returned.id
                        ),
                        structuredClone(returned),
                    ],
                };
                getSelectFieldPolicy(schema); // Validate the whole returned canonical choice map.
                const availability = resolveSelectFieldAvailability({
                    field: schema,
                    airtableFields: Object.values(
                        now.page.payload.fieldIdsToSchemas
                    ).map((item) => item.airtableField),
                    recordForConditionEvaluation: formChoiceConditionRecord(
                        now.page,
                        schema,
                        now.state.draft!.data
                    ),
                    mode: 'runtime',
                    invalidConditionMode: 'compatibility',
                });
                const selected =
                    availability.status === 'ready' &&
                    availability.options.some(
                        (item) => item.id === returned.id
                    ) &&
                    now.values !== null &&
                    (!now.multiple ||
                        now.policy.maxSelections === null ||
                        now.values.length < now.policy.maxSelections);
                if (!ownsAttempt()) return false;
                const accepted = options.install(
                    structuredClone(returned),
                    selected,
                    () => {
                        journal.accepted(attempt, 'choice-created');
                        choice = structuredClone(returned);
                        phase = selected
                            ? 'created-selected'
                            : 'created-not-selected';
                    }
                );
                if (!accepted) return false;
                return true;
            } catch {
                return attempt.outcome === 'choice-created';
            } finally {
                journal.finishFlight(attempt);
                if (active === abort) active = null;
                if (current()) {
                    if (attempt.outcome === 'unknown') {
                        phase = 'uncertain';
                        error =
                            'Choice creation outcome needs inspection. It will not be retried automatically.';
                    }
                    emit();
                }
            }
        },
        cancel() {
            if (!current() || active === null) return;
            const previous = active;
            phase = 'uncertain';
            revision++;
            previous.abort();
            emit();
        },
        dispose,
    };
}
