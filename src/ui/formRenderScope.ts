import type { FormFieldBindings } from '../forms/bindings.js';
import type {
    FormControllerSaveOptions,
    FormControllerState,
} from '../forms/controller.js';
import {
    createFormPageOwner,
    FormPageError,
    readFormPageOwnerFields,
    type FormPageAction,
    type FormPageOwner,
    type FormPageOwnerOptions,
    type FormPageSnapshot,
} from '../forms/pages.js';
import {
    createFormFieldRendererHost,
    type FormFieldRendererHostOptions,
} from './rendererHosts.js';
import type { FieldRendererHost } from './rendererRegistry.js';

export type FormRenderScopeOptions = FormPageOwnerOptions & {
    /** Retain this exact SDK page owner. It must belong to fields. */
    pages?: FormPageOwner;
    saveOptions?: FormControllerSaveOptions;
    attachmentRecovery?: FormFieldRendererHostOptions['attachmentRecovery'];
    button?: FormFieldRendererHostOptions['button'];
};
export type FormRenderField = {
    fieldId: string;
    host: FieldRendererHost;
};
export type FormRenderSnapshot = {
    revision: number;
    retired: boolean;
    page: FormPageSnapshot;
    fields: readonly FormRenderField[];
    status: FormControllerState['status'];
    canSave: boolean;
    errorMessage: string | null;
    validationErrors: FormControllerState['validationErrors'];
    /** Each action captures this snapshot's page revision, never a later one. */
    actions: {
        back(): FormPageAction;
        next(): FormPageAction;
        submit(
            options?: FormControllerSaveOptions
        ): ReturnType<FormFieldBindings['save']>;
    };
};
export type FormRenderScope = {
    readonly pages: FormPageOwner;
    readonly ownsPages: boolean;
    getSnapshot(): FormRenderSnapshot;
    subscribe(listener: (snapshot: FormRenderSnapshot) => void): () => void;
    /** Retire owned hosts and an internally created page owner, never fields. */
    destroy(): void;
};

/** Presentation resources only. No React, second draft, session or I/O owner. */
export function createFormRenderScope(
    options: FormRenderScopeOptions
): FormRenderScope {
    const { fields } = options;
    if (options.pages && readFormPageOwnerFields(options.pages) !== fields)
        throw new Error(
            'The page owner does not belong to these Form bindings.'
        );
    const pages = options.pages ?? createFormPageOwner(options);
    const ownsPages = options.pages === undefined;
    const initial = fields.controller.getState();
    const configuration = options.configurationRevision();
    const hosts = new Map<string, FieldRendererHost>();
    const stops: (() => void)[] = [];
    const listeners = new Map<(state: FormRenderSnapshot) => void, number>();
    let retired = false,
        destroyed = false,
        initializing = true,
        reading = false,
        emitting = false,
        pending = false,
        revision = 0,
        key = '';
    let page = pages.getSnapshot();
    let control = initial;
    let cached: FormRenderSnapshot | null = null;
    const release = () => {
        while (stops.length) stops.pop()!();
        hosts.forEach((host) => host.dispose());
        hosts.clear();
        if (ownsPages) pages.dispose();
    };
    const current = () => {
        if (retired || destroyed) return false;
        try {
            const before = fields.controller.getState();
            const epoch = options.configurationRevision();
            const live = options.isCurrent();
            const after = fields.controller.getState();
            if (
                destroyed ||
                !live ||
                !Number.isSafeInteger(epoch) ||
                epoch < 0 ||
                epoch !== configuration ||
                options.configurationRevision() !== configuration ||
                before.epoch !== initial.epoch ||
                after.epoch !== initial.epoch ||
                after.contextRevision !== initial.contextRevision ||
                JSON.stringify(after.ownerScope) !==
                    JSON.stringify(initial.ownerScope)
            )
                retired = true;
        } catch {
            retired = true;
        }
        return !retired && !destroyed;
    };
    const snapshot = (): FormRenderSnapshot => {
        // Reads from reentrant ownership callbacks observe the last completed
        // presentation rather than starting another ownership/validation pass.
        if (reading && cached) return copy(cached);
        const entries: FormRenderField[] = [];
        if (!reading) {
            reading = true;
            try {
                if (current()) {
                    page = pages.getSnapshot();
                    control = fields.controller.getState();
                    if (page.status === 'retired') retired = true;
                    else
                        for (const fieldId of page.currentFieldIds) {
                            const host = hosts.get(fieldId);
                            if (!host) continue;
                            const state = host.getSnapshot();
                            if (
                                state.status !== 'hidden' &&
                                state.status !== 'retired'
                            )
                                entries.push({ fieldId, host });
                        }
                    current();
                }
            } finally {
                reading = false;
            }
        }
        const dead = retired || destroyed;
        if (dead) {
            entries.length = 0;
            page = {
                ...page,
                status: 'retired',
                currentFieldIds: [],
                canBack: false,
                canNext: false,
                canSubmit: false,
            };
        }
        const summary = {
            retired: dead,
            page,
            status: control.status,
            canSave: !dead && page.canSubmit && control.canSave,
            errorMessage: control.errorMessage,
            validationErrors: control.validationErrors,
        };
        const nextKey = JSON.stringify([
            summary,
            entries.map((e) => e.fieldId),
        ]);
        if (nextKey !== key) {
            key = nextKey;
            revision++;
        }
        const expected = page.revision;
        const allowed = () =>
            current() && pages.getSnapshot().status !== 'retired' && current();
        cached = {
            ...structuredClone(summary),
            revision,
            fields: entries,
            actions: {
                back: () =>
                    allowed()
                        ? pages.back(expected)
                        : { accepted: false, reason: 'retired' },
                next: () =>
                    allowed()
                        ? pages.next(expected)
                        : { accepted: false, reason: 'retired' },
                submit: async (saveOptions) => {
                    if (!allowed()) throw new FormPageError('retired');
                    return pages.submit(
                        expected,
                        saveOptions ?? options.saveOptions
                    );
                },
            },
        };
        if (pending && !initializing && !emitting && !reading) notify();
        return copy(cached);
    };
    const copy = (state: FormRenderSnapshot): FormRenderSnapshot => {
        const { fields: entries, actions, ...data } = state;
        return {
            ...structuredClone(data),
            fields: entries.map((entry) => ({ ...entry })),
            actions: { ...actions },
        };
    };
    const notify = () => {
        pending = true;
        if (initializing || reading || emitting) return;
        emitting = true;
        try {
            // Reentrant listeners may edit or retire context. Fresh reads and
            // per-listener delivery revisions converge without an unbounded drain.
            for (let pass = 0; pending && pass < 16; pass++) {
                pending = false;
                for (const [listener] of [...listeners]) {
                    if (!listeners.has(listener)) continue;
                    const next = snapshot();
                    if (listeners.get(listener) === next.revision) continue;
                    listeners.set(listener, next.revision);
                    try {
                        listener(next);
                    } catch {
                        /* Rendering never owns state. */
                    }
                }
            }
        } finally {
            emitting = false;
            // Destruction inside a listener/read must publish terminal state to
            // every remaining subscriber before releasing their subscriptions.
            if (destroyed) listeners.clear();
        }
    };
    try {
        for (const fieldId of fields.getLoaded().payload.fieldIdsInForm) {
            if (hosts.has(fieldId)) continue;
            try {
                const host = createFormFieldRendererHost({
                    fields,
                    fieldId,
                    isCurrent: current,
                    configurationRevision: options.configurationRevision,
                    attachmentRecovery: options.attachmentRecovery,
                    button: options.button,
                });
                hosts.set(fieldId, host);
                stops.push(host.subscribe(notify));
            } catch {
                // A missing field remains the existing page owner's diagnostic.
            }
        }
        stops.push(
            pages.subscribe(notify),
            fields.controller.subscribe(notify)
        );
    } catch (error) {
        retired = true;
        release();
        throw error;
    }
    initializing = false;
    return {
        pages,
        ownsPages,
        getSnapshot: snapshot,
        subscribe(listener) {
            const next = snapshot();
            if (destroyed) {
                listener(next);
                return () => {};
            }
            listeners.set(listener, next.revision);
            try {
                listener(next);
            } catch {
                /* Rendering never owns state. */
            }
            return () => listeners.delete(listener);
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            release();
            notify();
        },
    };
}
