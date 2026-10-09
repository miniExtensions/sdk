import type { MiniExtensionsClient } from '../runtime/types.js';
import type { PortalCellBinding } from '../portals/cell.js';
import type {
    PortalListOwner,
    PortalListSnapshot,
    PortalRecordPresentation,
} from '../portals/listOwner.js';
import { PortalCollectionError } from '../portals/collection.js';
import type {
    PortalCollectionCriteria,
    PortalReadOptions,
    PortalChildRequestOptions,
    PortalChildFormRequest,
} from '../portals/types.js';
import {
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
} from './rendererHosts.js';
import type { FieldRendererHost } from './rendererRegistry.js';
import type { ButtonFieldRecovery } from './buttonModel.js';

export type PortalRenderScopeOptions = {
    /** Borrow the existing read owner; this scope never destroys it. */
    owner: PortalListOwner;
    client: MiniExtensionsClient;
    isCurrent(): boolean;
    configurationRevision(): string | number;
    /** Borrow the existing mutation recovery resource; rendering never owns it. */
    buttonRecovery?: ButtonFieldRecovery;
    /** Return an existing caller-owned cell only for this accepted detail. */
    resolveCell?(input: {
        recordId: string;
        fieldId: string;
        ownerRevision: number;
    }): PortalCellBinding | null | undefined;
};
export type PortalRenderCell = { fieldId: string; host: FieldRendererHost };
export type PortalRenderRow = {
    recordId: string;
    cells: readonly PortalRenderCell[];
};
export type PortalRenderSnapshot = {
    revision: number;
    retired: boolean;
    owner: PortalListSnapshot;
    /** Detached owner-authorized projection, including missing/null/present. */
    records: PortalRecordPresentation | null;
    rows: readonly PortalRenderRow[];
    actions: {
        load(options: PortalReadOptions): Promise<boolean>;
        more(options: PortalReadOptions): Promise<boolean>;
        setCriteria(criteria: PortalCollectionCriteria): boolean;
        setField(fieldId: string, criteria: PortalCollectionCriteria): boolean;
        acceptCleanup(): boolean;
        dismissCleanup(): boolean;
        childFormRequest(
            options: PortalChildRequestOptions
        ): PortalChildFormRequest;
        cancel(): void;
    };
};
export type PortalRenderScope = {
    readonly owner: PortalListOwner;
    getSnapshot(): PortalRenderSnapshot;
    subscribe(listener: (snapshot: PortalRenderSnapshot) => void): () => void;
    /** Release presentation hosts/subscriptions, retaining owner and cell drafts. */
    destroy(): void;
};

/** Framework-neutral composition; construction and rendering perform no I/O. */
export function createPortalRenderScope(
    options: PortalRenderScopeOptions
): PortalRenderScope {
    const { owner } = options;
    const configuration = options.configurationRevision();
    let destroyed = false,
        retired = false,
        working = false,
        pending = false;
    let revision = 0,
        builtRevision = -1,
        delivering = false,
        checkingLease = false,
        checkingAction = false;
    let initializing = true;
    const initializationFailures: unknown[] = [];
    let cached: PortalRenderSnapshot;
    let rows: PortalRenderRow[] = [];
    let records: PortalRecordPresentation | null = null;
    let state = owner.getSnapshot();
    const stops: (() => void)[] = [];
    let resources: { host: FieldRendererHost; stop: () => void }[] = [];
    const listeners = new Map<
        (snapshot: PortalRenderSnapshot) => void,
        number
    >();
    const releaseHosts = () => {
        const previous = resources;
        resources = [];
        rows = [];
        for (const resource of previous) {
            try {
                resource.stop();
            } catch {}
            try {
                resource.host.dispose();
            } catch {}
        }
    };
    const current = () => {
        if (destroyed || retired) return false;
        if (checkingLease) return true;
        checkingLease = true;
        try {
            if (
                !options.isCurrent() ||
                destroyed ||
                options.configurationRevision() !== configuration
            )
                retired = true;
        } catch {
            retired = true;
        } finally {
            checkingLease = false;
        }
        return !destroyed && !retired;
    };
    const allowedOwner = (expected: number) =>
        current() &&
        owner.getSnapshot().revision === expected &&
        owner.getSnapshot().phase !== 'retired' &&
        current();
    const copy = (snapshot: PortalRenderSnapshot): PortalRenderSnapshot => ({
        ...snapshot,
        owner: structuredClone(snapshot.owner),
        records: structuredClone(snapshot.records),
        rows: snapshot.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) => ({ ...cell })),
        })),
        actions: { ...snapshot.actions },
    });
    const publish = () => {
        const expected = state.revision,
            captured = revision;
        const allowed = () => {
            if (working || delivering || checkingLease || checkingAction)
                return false;
            checkingAction = true;
            try {
                if (captured !== revision || !allowedOwner(expected))
                    return false;
                // Ownership callbacks may synchronously publish a newer scope.
                return (
                    current() &&
                    !working &&
                    !delivering &&
                    captured === revision
                );
            } finally {
                checkingAction = false;
            }
        };
        cached = {
            revision,
            retired: destroyed || retired,
            owner: structuredClone(state),
            records: structuredClone(records),
            rows: rows.map((row) => ({
                ...row,
                cells: row.cells.filter((cell) => {
                    const snapshot = cell.host.getSnapshot();
                    return (
                        snapshot.status !== 'hidden' &&
                        snapshot.status !== 'retired'
                    );
                }),
            })),
            actions: {
                load: (read) =>
                    allowed()
                        ? owner.readFirst(expected, read)
                        : Promise.resolve(false),
                more: (read) =>
                    allowed()
                        ? owner.readNext(expected, read)
                        : Promise.resolve(false),
                setCriteria: (criteria) =>
                    allowed() && owner.setCriteria(expected, criteria),
                setField: (fieldId, criteria) =>
                    allowed() && owner.setField(expected, fieldId, criteria),
                acceptCleanup: () => allowed() && owner.acceptCleanup(expected),
                dismissCleanup: () =>
                    allowed() && owner.dismissCleanup(expected),
                childFormRequest: (child) => {
                    if (!allowed())
                        throw new PortalCollectionError(
                            'read-required',
                            'A current accepted Portal page is required.'
                        );
                    const request = owner.childFormRequest(expected, child);
                    const checked = request.isCurrent;
                    return {
                        ...request,
                        isCurrent: () => allowed() && checked() && allowed(),
                    };
                },
                cancel: () => {
                    if (allowed()) owner.cancel(expected);
                },
            },
        };
    };
    const refresh = () => {
        pending = true;
        if (working) return;
        working = true;
        try {
            // Bound synchronous ownership/subscription reentry. Fail closed if
            // callbacks continually replace context instead of reaching a lease.
            for (let pass = 0; pending && pass < 16; pass++) {
                pending = false;
                if (current()) {
                    state = owner.getSnapshot();
                    if (
                        state.phase === 'retired' ||
                        !allowedOwner(state.revision)
                    )
                        retired = true;
                }
                if (destroyed || retired) {
                    releaseHosts();
                    records = null;
                } else if (builtRevision !== state.revision) {
                    releaseHosts();
                    const expected = state.revision;
                    records = owner.getRecords(expected);
                    builtRevision = expected;
                    if (records && allowedOwner(expected)) {
                        for (const record of records.records) {
                            if (!allowedOwner(expected)) {
                                pending = true;
                                break;
                            }
                            const detailHost = createPortalDetailRendererHost({
                                ...options,
                                recordId: record.id,
                            });
                            resources.push({
                                host: detailHost,
                                stop: () => {},
                            });
                            const detailState = detailHost.getSnapshot();
                            const row: PortalRenderRow = {
                                recordId: record.id,
                                cells: [],
                            };
                            const cells: PortalRenderCell[] = [];
                            if (detailState.status === 'ready')
                                for (const props of detailState.fields) {
                                    if (!allowedOwner(expected)) {
                                        pending = true;
                                        break;
                                    }
                                    const cell = options.resolveCell?.({
                                        recordId: record.id,
                                        fieldId: props.fieldId,
                                        ownerRevision: expected,
                                    });
                                    if (!allowedOwner(expected)) {
                                        pending = true;
                                        break;
                                    }
                                    // Button actions use returned detail policy, independently
                                    // of inline-write configuration. Reuse this row's detail
                                    // model instead of creating another owner for the action.
                                    const host: FieldRendererHost =
                                        cell && props.physicalKind !== 'button'
                                            ? createPortalCellRendererHost({
                                                  ...options,
                                                  cell,
                                                  recordId: record.id,
                                                  fieldId: props.fieldId,
                                              })
                                            : projectDetailHost(
                                                  detailHost,
                                                  props.fieldId
                                              );
                                    resources.push({ host, stop: () => {} });
                                    const snapshot = host.getSnapshot();
                                    if (
                                        snapshot.status !== 'hidden' &&
                                        snapshot.status !== 'retired'
                                    )
                                        cells.push({
                                            fieldId: props.fieldId,
                                            host,
                                        });
                                }
                            row.cells = cells;
                            rows.push(row);
                        }
                        if (!allowedOwner(expected)) pending = true;
                        // Subscribe after acquisition, suppress the initial delivery.
                        for (const resource of [...resources]) {
                            let initial = true;
                            resource.stop = resource.host.subscribe(() => {
                                if (!initial) changed();
                            });
                            initial = false;
                        }
                    }
                }
                revision++;
                publish();
            }
            if (pending) {
                retired = true;
                pending = false;
                releaseHosts();
                records = null;
                revision++;
                publish();
            }
        } catch (error) {
            // A later resolver/acquisition failure must not leave a partially
            // built revision cached as accepted. Retire presentation only.
            retired = true;
            pending = false;
            while (stops.length) {
                try {
                    stops.pop()!();
                } catch {}
            }
            releaseHosts();
            records = null;
            revision++;
            publish();
            if (initializing) {
                initializationFailures.push(error);
                throw error;
            }
        } finally {
            working = false;
        }
    };
    const notify = () => {
        if (delivering) return;
        delivering = true;
        try {
            for (let pass = 0; pass < 16; pass++) {
                const before = revision;
                for (const [listener, last] of [...listeners]) {
                    if (!current() && !cached.retired) refresh();
                    if (!listeners.has(listener) || last === revision) continue;
                    listeners.set(listener, revision);
                    try {
                        listener(copy(cached));
                    } catch {}
                }
                if (before === revision) break;
            }
        } finally {
            delivering = false;
        }
        if (destroyed) listeners.clear();
    };
    const changed = () => {
        refresh();
        if (!working) notify();
    };
    try {
        refresh();
        stops.push(owner.subscribe(changed));
        if (initializationFailures.length) throw initializationFailures[0];
        initializing = false;
    } catch (error) {
        destroyed = true;
        while (stops.length) {
            try {
                stops.pop()!();
            } catch {}
        }
        releaseHosts();
        throw error;
    }
    return {
        owner,
        getSnapshot() {
            if (
                !working &&
                !checkingLease &&
                ((!current() && !cached.retired) ||
                    (!cached.retired &&
                        owner.getSnapshot().revision !== state.revision))
            )
                changed();
            return copy(cached);
        },
        subscribe(listener) {
            const snapshot = this.getSnapshot();
            if (!destroyed) listeners.set(listener, snapshot.revision);
            const previousDelivery = delivering;
            delivering = true;
            try {
                listener(snapshot);
            } catch {
            } finally {
                delivering = previousDelivery;
            }
            if (!delivering) notify();
            return () => {
                listeners.delete(listener);
            };
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            while (stops.length) {
                try {
                    stops.pop()!();
                } catch {}
            }
            changed();
        },
    };
}

/** A per-field facet of the accepted aggregate; it owns no source resource. */
function projectDetailHost(
    source: FieldRendererHost,
    fieldId: string
): FieldRendererHost {
    const project = (snapshot: ReturnType<FieldRendererHost['getSnapshot']>) =>
        snapshot.status === 'ready'
            ? {
                  ...snapshot,
                  fields: snapshot.fields.filter(
                      (field) => field.fieldId === fieldId
                  ),
              }
            : snapshot;
    return {
        getSnapshot: () => project(source.getSnapshot()),
        subscribe: (listener) =>
            source.subscribe((snapshot) => listener(project(snapshot))),
        dispose() {},
    };
}
