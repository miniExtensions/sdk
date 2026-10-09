import type { FormFieldBindings } from '../forms/bindings.js';
import type { FormLinkedRecordsFacet } from '../forms/linkedRecords.js';
import type { LinkedRecordsRendererProps } from './rendererRegistry.js';

/** Subscription adapter only: records and requests stay with the Form facet. */
export function createFormLinkedRendererBridge(
    fields: FormFieldBindings,
    fieldId: string
) {
    let disposed = false;
    let generation = 0;
    let facet: FormLinkedRecordsFacet | null = null;
    let stop: (() => void) | null = null;
    let isCurrent = () => false;
    let notify = () => {};
    const release = () => {
        generation++;
        facet = null;
        const previous = stop;
        stop = null;
        previous?.();
    };
    const connect = () => {
        if (disposed || !isCurrent()) {
            release();
            return;
        }
        let next: FormLinkedRecordsFacet;
        try {
            next = fields.linkedRecords(fieldId);
        } catch {
            // The owning replacement/read can temporarily prohibit acquisition.
            release();
            return;
        }
        if (disposed || !isCurrent()) {
            release();
            return;
        }
        if (next === facet) return;
        release();
        const ticket = generation;
        facet = next;
        let returned: () => void;
        try {
            returned = next.subscribe(() => {
                if (disposed || generation !== ticket || facet !== next) return;
                connect();
                notify();
            });
        } catch (error) {
            if (generation === ticket && facet === next) release();
            throw error;
        }
        // subscribe may synchronously replace the facet or dispose this host.
        if (disposed || generation !== ticket || facet !== next || !isCurrent())
            returned();
        else stop = returned;
    };
    return {
        subscribe(listener: () => void, current: () => boolean) {
            notify = listener;
            isCurrent = current;
            connect();
            return () => this.dispose();
        },
        refresh: connect,
        getProps(): LinkedRecordsRendererProps | undefined {
            connect();
            const captured = facet;
            const ticket = generation;
            if (!captured || disposed || !isCurrent()) return undefined;
            const state = captured.getSnapshot();
            const owns = () =>
                !disposed &&
                isCurrent() &&
                generation === ticket &&
                facet === captured;
            if (!owns() || state.phase === 'retired') return undefined;
            return {
                source: 'form',
                state,
                readSelected: async () => {
                    connect();
                    if (!owns()) return false;
                    const accepted = await captured.readSelected();
                    return accepted && owns();
                },
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            notify = () => {};
            release();
        },
    };
}
