import type { PortalRecordPresentation } from '../portals/listOwner.js';
import type { PortalRenderRow } from './portalRenderScope.js';
import {
    createRendererProps,
    type FieldRendererHost,
    type FieldRendererHostSnapshot,
} from './rendererRegistry.js';

/** The subscription-only contract shared by native and SDK-owned shells. */
export type PortalPresentationSnapshot = {
    revision: number;
    retired: boolean;
    rows: readonly PortalRenderRow[];
};
export type PortalPresentationSource<S extends PortalPresentationSnapshot> = {
    getSnapshot(): S;
    subscribe(listener: (snapshot: S) => void): () => void;
};
export type BorrowedPortalTarget = {
    action: 'open-row' | 'open-child';
    recordId: string;
    fieldId?: string;
};
export type BorrowedPortalPort<Stamp> = {
    /**
     * Detached accepted data only, never the full cache. A stamp is stable until
     * any owner/session/view/config/policy/row/value publication changes. Advance
     * it on ABA too. Missing/withheld projections never authorize cache fallback.
     */
    capture(): {
        stamp: Stamp;
        projection: PortalRecordPresentation | null;
    } | null;
    isCurrent(stamp: Stamp): boolean;
    subscribe(listener: () => void): () => void;
    /**
     * Native admission immediately before the native action, including after
     * every wait. The supplied check is a presentation fence, not backend auth.
     * No writes are authorized by this read-only contract.
     */
    invokeIfCurrent?(
        stamp: Stamp,
        target: BorrowedPortalTarget,
        isCurrent: () => boolean
    ): boolean | Promise<boolean>;
};
export type BorrowedPortalColumn = { fieldId: string; title: string };
export type BorrowedPortalRenderSnapshot = PortalPresentationSnapshot & {
    /** Accepted policy metadata; independent of row existence and values. */
    columns: readonly BorrowedPortalColumn[];
    actions: {
        openRow(recordId: string): Promise<boolean>;
        openChild(recordId: string, fieldId?: string): Promise<boolean>;
    };
};
export type BorrowedPortalRenderScope =
    PortalPresentationSource<BorrowedPortalRenderSnapshot> & {
        /** Presentation subscriptions only. Never cancels or disposes native work. */
        destroy(): void;
    };

/** No collection, fetch, draft store, writer or private SDK owner provenance. */
export function createBorrowedPortalRenderScope<Stamp>(
    port: BorrowedPortalPort<Stamp>
): BorrowedPortalRenderScope {
    let destroyed = false;
    let revision = 0;
    let accepted: ReturnType<typeof port.capture> = null;
    let snapshot: BorrowedPortalRenderSnapshot;
    let refreshing = false;
    let notifying = false;
    const listeners = new Map<
        (snapshot: BorrowedPortalRenderSnapshot) => void,
        number
    >();
    const hosts = new Set<() => void>();
    const read = () => {
        try {
            return port.capture();
        } catch {
            return null;
        }
    };
    const current = (stamp: Stamp, expected: number) => {
        if (destroyed || expected !== revision) return false;
        try {
            return (
                port.isCurrent(stamp) &&
                Object.is(read()?.stamp, stamp) &&
                !destroyed &&
                expected === revision &&
                port.isCurrent(stamp)
            );
        } catch {
            return false;
        }
    };
    const buildHost = (
        stamp: Stamp,
        expected: number,
        field: NonNullable<ReturnType<typeof createRendererProps>>
    ): FieldRendererHost => {
        let disposed = false;
        const callbacks = new Set<
            (snapshot: FieldRendererHostSnapshot) => void
        >();
        const getSnapshot = (): FieldRendererHostSnapshot =>
            !disposed && current(stamp, expected)
                ? { status: 'ready', fields: [structuredClone(field)] }
                : { status: 'retired', reason: 'Native presentation replaced' };
        const retire = () => {
            if (disposed) return;
            disposed = true;
            for (const callback of [...callbacks]) {
                try {
                    callback(getSnapshot());
                } catch {
                    /* Isolate presentation listeners. */
                }
            }
            callbacks.clear();
        };
        hosts.add(retire);
        return {
            getSnapshot,
            subscribe(callback) {
                if (!disposed) callbacks.add(callback);
                callback(getSnapshot());
                return () => {
                    callbacks.delete(callback);
                };
            },
            dispose() {
                retire();
                hosts.delete(retire);
            },
        };
    };
    const refresh = () => {
        if (refreshing) return;
        refreshing = true;
        try {
            const next = destroyed ? null : read();
            if (
                snapshot &&
                Object.is(next?.stamp, accepted?.stamp) &&
                (next === null) === (accepted === null) &&
                (snapshot.retired || !next || current(next.stamp, revision))
            )
                return;
            accepted = next;
            revision++;
            for (const retire of [...hosts]) retire();
            hosts.clear();
            const expected = revision;
            const rows: PortalRenderRow[] = [];
            let columns: BorrowedPortalColumn[] = [];
            const projection = next?.projection;
            if (next && projection && current(next.stamp, expected)) {
                const details =
                    projection.detailProjection === 'present'
                        ? projection.detailFields
                        : [];
                const prepared = [];
                for (const detail of details) {
                    if (
                        detail.isHidden ||
                        details.filter((d) => d.fieldId === detail.fieldId)
                            .length !== 1
                    )
                        continue;
                    const schemas = projection.table.airtableFields.filter(
                        (f) => f.id === detail.fieldId
                    );
                    if (schemas.length !== 1) continue;
                    const schema = schemas[0];
                    // Validate presentation metadata with a null value; headers
                    // must not depend on a first row or any cached row value.
                    const props = createRendererProps({
                        physicalKind: schema.config.type,
                        fieldId: detail.fieldId,
                        title: detail.titleOverride ?? detail.fieldName,
                        field: schema,
                        displayConfig: detail.miniExtConfig,
                        value: null,
                        context: 'portal-detail',
                        computed: schema.isComputed === true,
                        dirty: false,
                        pending: false,
                        validation: [],
                        error: null,
                        capability: { type: 'readonly' },
                    });
                    if (props) prepared.push(props);
                }
                columns = prepared.map(({ fieldId, title }) => ({
                    fieldId,
                    title,
                }));
                const seen = new Set<string>();
                for (const record of projection.records) {
                    if (seen.has(record.id)) continue;
                    seen.add(record.id);
                    const cells: PortalRenderRow['cells'][number][] = [];
                    for (const column of prepared) {
                        const props = createRendererProps({
                            ...column,
                            value: record.fields[column.fieldId],
                        });
                        if (props)
                            cells.push({
                                fieldId: column.fieldId,
                                host: buildHost(next.stamp, expected, props),
                            });
                    }
                    rows.push({ recordId: record.id, cells });
                }
            }
            const allowed = (target: BorrowedPortalTarget) => {
                const row = rows.find(
                    (row) => row.recordId === target.recordId
                );
                return (
                    next !== null &&
                    current(next.stamp, expected) &&
                    !!row &&
                    (target.fieldId === undefined ||
                        row.cells.some(
                            (cell) => cell.fieldId === target.fieldId
                        ))
                );
            };
            const invoke = async (target: BorrowedPortalTarget) => {
                if (!next || !allowed(target) || !port.invokeIfCurrent)
                    return false;
                const result = await port.invokeIfCurrent(
                    next.stamp,
                    { ...target },
                    () => allowed(target)
                );
                return allowed(target) && result;
            };
            snapshot = {
                revision,
                retired: destroyed || !next || !current(next.stamp, expected),
                rows,
                columns,
                actions: {
                    openRow: (recordId) =>
                        invoke({ action: 'open-row', recordId }),
                    openChild: (recordId, fieldId) =>
                        invoke({ action: 'open-child', recordId, fieldId }),
                },
            };
            if (snapshot.retired) {
                snapshot.rows = [];
                snapshot.columns = [];
            }
        } finally {
            refreshing = false;
            // Host retirement can destroy the scope during this refresh. Finish
            // its terminal snapshot before delivering or clearing listeners.
            if (destroyed) {
                if (accepted !== null) refresh();
                notify();
            }
        }
    };
    const copy = (): BorrowedPortalRenderSnapshot => ({
        ...snapshot,
        columns: snapshot.columns.map((column) => ({ ...column })),
        rows: snapshot.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({ ...cell })),
        })),
        actions: { ...snapshot.actions },
    });
    const notify = () => {
        if (notifying || refreshing) return;
        notifying = true;
        try {
            // A terminal revision is immutable: allow its final delivery even
            // when destruction occurs on the last bounded refresh pass.
            for (let pass = 0; pass < 16 || destroyed; pass++) {
                const before = revision;
                for (const [listener, delivered] of [...listeners]) {
                    if (delivered === revision || !listeners.has(listener))
                        continue;
                    listeners.set(listener, revision);
                    try {
                        listener(copy());
                    } catch {
                        /* Isolate presentation listeners. */
                    }
                }
                if (revision === before) break;
            }
        } finally {
            notifying = false;
            if (destroyed) listeners.clear();
        }
    };
    refresh();
    let stop: () => void;
    try {
        stop = port.subscribe(() => {
            refresh();
            notify();
        });
    } catch (error) {
        destroyed = true;
        for (const retire of [...hosts]) retire();
        hosts.clear();
        throw error;
    }
    // Close subscribe/capture ordering without adding a read owner.
    refresh();
    return {
        getSnapshot() {
            refresh();
            return copy();
        },
        subscribe(listener) {
            refresh();
            if (!destroyed) listeners.set(listener, revision);
            listener(copy());
            return () => {
                listeners.delete(listener);
            };
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            stop();
            refresh();
            // A reentrant destroy leaves listeners for the active notifier.
            notify();
        },
    };
}
