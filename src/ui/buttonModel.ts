import type {
    AirtableButtonField,
    AirtableButtonValue,
    ButtonMiniExtConfig,
} from '../runtime/rendererTypes.js';
import type {
    MiniExtensionsClient,
    RuntimeLanguage,
    ConfiguredButtonWebhookSource,
} from '../runtime/types.js';
import {
    RecoveryJournal,
    subscribeRecoveryJournal,
    sameRecoveryRelationship,
    type RecoveryScope,
    type RecoveryAttempt,
} from '../forms/recovery.js';

/** Accepted host data. Tokens and sources never enter renderer snapshots. */
export type ButtonFieldData = {
    field: AirtableButtonField;
    value: AirtableButtonValue | null;
    config: ButtonMiniExtConfig;
    language: RuntimeLanguage;
    source: ConfiguredButtonWebhookSource | null;
    extensionAccessToken: string;
    visible: boolean;
};
export type ButtonFieldAdapter = {
    read(): ButtonFieldData | null;
    isCurrent(): boolean;
    /** Monotonic accepted policy/context epoch, including observed A→B→A. */
    configurationRevision(): string | number;
    subscribe?(listener: () => void): () => void;
};
export type ButtonFieldRecovery = {
    journal: RecoveryJournal;
    scope: RecoveryScope;
    loadVersion: number;
};
export type ButtonFieldModelOptions = {
    client: MiniExtensionsClient;
    adapter: ButtonFieldAdapter;
    recovery: ButtonFieldRecovery;
};
export type ButtonFieldState = {
    revision: number;
    phase: 'idle' | 'pending' | 'reported-success' | 'uncertain' | 'retired';
    busy: boolean;
    canLink: boolean;
    canTrigger: boolean;
    feedback: { kind: 'success' | 'error'; text: string | null } | null;
    field: AirtableButtonField | null;
    value: AirtableButtonValue | null;
    config: ButtonMiniExtConfig;
    language: RuntimeLanguage | null;
};
export type ButtonLinkDescriptor = {
    href: string;
    target: '_self' | '_blank' | '_parent';
    rel: 'noreferrer';
};
export type ButtonActionResult =
    | { type: 'refused'; reason: string }
    | { type: 'reported-success' }
    | { type: 'uncertain' };
export type ButtonFieldRenderProps = ButtonFieldState & {
    prepareLink(): ButtonLinkDescriptor | null;
    triggerWebhook(): Promise<ButtonActionResult>;
    cancel(): boolean;
    acknowledgeNewIntent(): boolean;
};
export type ButtonFieldModel = {
    getSnapshot(): ButtonFieldState;
    getRenderProps(): ButtonFieldRenderProps;
    subscribe(listener: (snapshot: ButtonFieldState) => void): () => void;
    prepareLink(expectedRevision: number): ButtonLinkDescriptor | null;
    triggerWebhook(expectedRevision: number): Promise<ButtonActionResult>;
    cancel(expectedRevision: number): boolean;
    acknowledgeNewIntent(expectedRevision: number): boolean;
    dispose(): void;
};

// Plain JSON metadata plus optional undefined; cycles and unsupported values fail closed.
const encode = (value: unknown): unknown => {
    if (value === undefined) return ['undefined'];
    if (value === null) return ['null'];
    if (Array.isArray(value)) return ['array', Array.from(value, encode)];
    if (typeof value === 'object')
        return [
            'object',
            Object.entries(value).map(([key, item]) => [key, encode(item)]),
        ];
    if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    )
        return [typeof value, value];
    throw new Error('Unavailable Button metadata.');
};
const identity = (value: unknown): string => JSON.stringify(encode(value));
const valid = (data: ButtonFieldData | null): data is ButtonFieldData => {
    if (
        !data ||
        data.field?.config?.type !== 'button' ||
        typeof data.field.id !== 'string' ||
        !data.field.id ||
        typeof data.extensionAccessToken !== 'string' ||
        !data.extensionAccessToken ||
        typeof data.visible !== 'boolean'
    )
        return false;
    if (
        data.value !== null &&
        (typeof data.value?.url !== 'string' ||
            typeof data.value?.label !== 'string')
    )
        return false;
    if (
        data.config !== undefined &&
        (data.config === null ||
            typeof data.config !== 'object' ||
            Array.isArray(data.config))
    )
        return false;
    const mode = data.config?.openLinkType;
    return (
        mode === undefined ||
        [
            '_self',
            '_blank',
            '_parent',
            'triggerWebhookGET',
            'triggerWebhookPOST',
        ].includes(mode)
    );
};
const attachProtocol = (url: string) =>
    /^(http:\/\/|https:\/\/|mailto:|tel:|\/)/.test(url)
        ? url
        : `https://${url}`;

/** One owner-held behavior model. React remount does not dispose it or replay an action. */
export function createButtonFieldModel(
    options: ButtonFieldModelOptions
): ButtonFieldModel {
    const client = options.client,
        adapter = options.adapter,
        journal = options.recovery.journal;
    const recovery = {
        ...options.recovery,
        scope: structuredClone(options.recovery.scope),
    };
    let data: ButtonFieldData | null = null,
        dataKey = '',
        sessionKey = '',
        configuration: string | number;
    let retired = false,
        revision = 0,
        delivery = 0;
    let phase: ButtonFieldState['phase'] = 'idle',
        feedback: ButtonFieldState['feedback'] = null;
    let active: {
        abort: AbortController;
        attempt: RecoveryAttempt | null;
        dispatched: boolean;
    } | null = null;
    let lastAttempt: RecoveryAttempt | null = null;
    let changingJournal = false;
    let stop: (() => void) | undefined;
    const listeners = new Set<(state: ButtonFieldState) => void>();
    try {
        // Capture identity before reading host data or accepting any owner callback.
        sessionKey = identity(client.getSession());
        configuration = adapter.configurationRevision();
        const read = adapter.read();
        if (!valid(read) || !adapter.isCurrent())
            throw new Error('Unavailable Button.');
        data = structuredClone(read);
        dataKey = identity(data);
        // A callback can return A data after moving the host to B. Two bounded
        // observations reject one-shot changes in the final lease callback as well.
        for (let pass = 0; pass < 2; pass++) {
            if (
                identity(adapter.read()) !== dataKey ||
                !adapter.isCurrent() ||
                adapter.configurationRevision() !== configuration ||
                identity(client.getSession()) !== sessionKey
            )
                throw new Error('Unavailable Button.');
        }
    } catch {
        retired = true;
        phase = 'retired';
    }
    let publish: () => void = () => {};
    const retire = () => {
        if (retired) return;
        retired = true;
        phase = 'retired';
        feedback = null;
        revision++;
        active?.abort.abort();
        publish();
    };
    let checking = false;
    const current = (): boolean => {
        if (retired) return false;
        // Nested actions fail closed. Explicit cancellation has a separate local guard.
        if (checking) return false;
        checking = true;
        try {
            for (let pass = 0; pass < 2 && !retired; pass++) {
                // Read first, then validate the whole lease after each host observation.
                if (
                    identity(adapter.read()) !== dataKey ||
                    !adapter.isCurrent() ||
                    adapter.configurationRevision() !== configuration ||
                    identity(client.getSession()) !== sessionKey
                )
                    retire();
            }
        } catch {
            retire();
        } finally {
            checking = false;
        }
        if (retired) publish();
        return !retired;
    };
    const recordId = () =>
        data?.source?.type === 'current-record'
            ? data.source.recordId
            : (data?.source?.linkedRecordId ?? null);
    const blocking = () => data && journal.blocking(recovery.scope, recordId());
    const journalState = () => {
        const attempt = blocking();
        return JSON.stringify([!!attempt, attempt?.flight === true]);
    };
    let observedJournalState = journalState();
    const snapshot = (redacted = false): ButtonFieldState => {
        const present = !retired && !redacted && data?.visible === true;
        const guard = blocking();
        const sharedAttempt =
            !retired && !active && guard !== lastAttempt ? guard : null;
        const mode = data?.config?.openLinkType ?? '_blank';
        const webhook =
            mode === 'triggerWebhookGET' || mode === 'triggerWebhookPOST';
        return {
            revision,
            phase: redacted
                ? 'retired'
                : sharedAttempt
                  ? sharedAttempt.flight
                      ? 'pending'
                      : 'uncertain'
                  : phase,
            busy:
                !retired &&
                !redacted &&
                (active !== null || sharedAttempt?.flight === true),
            canLink:
                present &&
                data?.value !== null &&
                !webhook &&
                active === null &&
                !blocking(),
            canTrigger:
                present &&
                data?.value !== null &&
                webhook &&
                data?.source != null &&
                active === null &&
                !blocking(),
            feedback:
                retired || redacted || sharedAttempt
                    ? null
                    : structuredClone(feedback),
            field: present ? structuredClone(data!.field) : null,
            value: present ? structuredClone(data!.value) : null,
            config: present ? structuredClone(data!.config) : undefined,
            language: present ? data!.language : null,
        };
    };
    let emitting = false;
    const emit = () => {
        ++delivery;
        observedJournalState = journalState();
        if (emitting || checking) return;
        emitting = true;
        try {
            // One bounded refresh delivers a reentrant change, including redacted retirement.
            // Further listener mutations invalidate delivery without recursive publication.
            for (let pass = 0; pass < 2; pass++) {
                const id = delivery,
                    state = snapshot();
                for (const listener of [...listeners]) {
                    current();
                    if (id !== delivery || revision !== state.revision) break;
                    if (listeners.has(listener)) {
                        try {
                            listener(structuredClone(state));
                        } catch {}
                    }
                }
                if (id === delivery && revision === state.revision) break;
            }
        } finally {
            emitting = false;
        }
    };
    publish = emit;
    const check = (expected: number) => current() && expected === revision;
    const observe = () => {
        current();
    };
    stop = adapter.subscribe?.(observe);
    const stopJournal = subscribeRecoveryJournal(journal, (change) => {
        if (
            retired ||
            !sameRecoveryRelationship(change.scope, recovery.scope) ||
            change.recordId !== recordId()
        )
            return;
        if (!current()) return;
        const next = journalState();
        if (active || changingJournal || next === observedJournalState) {
            observedJournalState = next;
            return;
        }
        if (
            lastAttempt?.acknowledgment === 'new-intent' &&
            phase === 'uncertain'
        ) {
            phase = 'idle';
            feedback = null;
        }
        revision++;
        emit();
    });
    const model: ButtonFieldModel = {
        getSnapshot() {
            if (checking) return snapshot(true);
            observe();
            return snapshot();
        },
        getRenderProps() {
            const state = model.getSnapshot(),
                expected = state.revision;
            return {
                ...state,
                prepareLink: () => model.prepareLink(expected),
                triggerWebhook: () => model.triggerWebhook(expected),
                cancel: () => model.cancel(expected),
                acknowledgeNewIntent: () =>
                    model.acknowledgeNewIntent(expected),
            };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        prepareLink(expected) {
            if (!check(expected) || !snapshot().canLink || data?.value == null)
                return null;
            const mode = data.config?.openLinkType ?? '_blank';
            if (mode !== '_self' && mode !== '_blank' && mode !== '_parent')
                return null;
            return {
                href: attachProtocol(data.value.url),
                target: mode,
                rel: 'noreferrer',
            };
        },
        async triggerWebhook(expected) {
            if (active) return { type: 'refused', reason: 'busy' };
            // Claim singleflight before calling any host code; reentrant hooks cannot dispatch twice.
            const intent = {
                abort: new AbortController(),
                attempt: null as RecoveryAttempt | null,
                dispatched: false,
            };
            active = intent;
            if (
                !check(expected) ||
                data?.visible !== true ||
                data.value == null ||
                data.source == null ||
                !['triggerWebhookGET', 'triggerWebhookPOST'].includes(
                    data.config?.openLinkType ?? ''
                ) ||
                blocking()
            ) {
                active = null;
                return {
                    type: 'refused',
                    reason: retired ? 'retired' : 'unavailable',
                };
            }
            const captured = data;
            try {
                intent.attempt = journal.begin(
                    recovery.scope,
                    captured.source!.type === 'current-record'
                        ? captured.source!.recordId
                        : captured.source!.linkedRecordId,
                    'button',
                    recovery.loadVersion,
                    captured.field.id
                );
                lastAttempt = intent.attempt;
                phase = 'pending';
                feedback = null;
                revision++;
                emit();
                if (
                    !current() ||
                    active !== intent ||
                    intent.abort.signal.aborted
                ) {
                    journal.notDispatched(intent.attempt);
                    return {
                        type: 'refused',
                        reason: retired ? 'retired' : 'cancelled',
                    };
                }
                intent.dispatched = true;
                const result = await client.buttons.triggerWebhook(
                    {
                        extensionAccessToken: captured.extensionAccessToken,
                        fieldId: captured.field.id,
                        source: structuredClone(captured.source!),
                    },
                    { signal: intent.abort.signal }
                );
                if (result?.success === true)
                    journal.accepted(intent.attempt, 'webhook-success');
                if (
                    !current() ||
                    intent.abort.signal.aborted ||
                    active !== intent
                )
                    return { type: 'uncertain' };
                if (result?.success === true) {
                    phase = 'reported-success';
                    feedback = {
                        kind: 'success',
                        text:
                            captured.config?.triggerWebhookSuccessMessage ??
                            null,
                    };
                    return { type: 'reported-success' };
                }
                phase = 'uncertain';
                feedback = {
                    kind: 'error',
                    text: captured.config?.triggerWebhookErrorMessage ?? null,
                };
                return { type: 'uncertain' };
            } catch {
                if (intent.attempt && !intent.dispatched)
                    journal.notDispatched(intent.attempt);
                if (current() && active === intent) {
                    phase = intent.dispatched ? 'uncertain' : 'idle';
                    feedback = intent.dispatched
                        ? {
                              kind: 'error',
                              text:
                                  captured.config?.triggerWebhookErrorMessage ??
                                  null,
                          }
                        : null;
                }
                return intent.dispatched
                    ? { type: 'uncertain' }
                    : { type: 'refused', reason: 'not-dispatched' };
            } finally {
                if (intent.attempt) journal.finishFlight(intent.attempt);
                if (active === intent) active = null;
                if (current()) {
                    if (phase === 'pending')
                        phase = intent.dispatched ? 'uncertain' : 'idle';
                    revision++;
                    emit();
                }
            }
        },
        cancel(expected) {
            if (
                retired ||
                expected !== revision ||
                (!checking && !current()) ||
                !active
            )
                return false;
            active.abort.abort();
            phase = active.dispatched ? 'uncertain' : 'idle';
            revision++;
            emit();
            return true;
        },
        acknowledgeNewIntent(expected) {
            if (!check(expected) || active) return false;
            const attempt = blocking();
            if (
                !attempt ||
                attempt.operation !== 'button' ||
                attempt.fieldId !== data?.field.id ||
                attempt.outcome !== 'unknown' ||
                attempt.flight ||
                attempt.acknowledgment !== 'none'
            )
                return false;
            changingJournal = true;
            try {
                journal.acknowledgeNewIntent(attempt);
            } finally {
                changingJournal = false;
            }
            phase = 'idle';
            feedback = null;
            revision++;
            emit();
            return true;
        },
        dispose() {
            retire();
            stop?.();
            stopJournal();
            stop = undefined;
            listeners.clear();
        },
    };
    return model;
}
