import type {
    LinkedRecordPrefill,
    ListPortalLinkedRecordsInput,
    ListPortalLinkedRecordsResult,
    RuntimeSession,
} from '../runtime/types.js';
import {
    captureCriteria,
    capturePage,
    capturePortalMetadata,
    captureReadOptions,
    criteriaIdentity,
    isObject,
    mergePage,
    readOwnerScope,
    readSession,
    requireIdentifier,
    sameOwner,
    sameSession,
    visibleDetails,
} from './helpers.js';
import type {
    PortalChildFormRequest,
    PortalCollection,
    PortalCollectionOptions,
    PortalCollectionSnapshot,
    PortalReadOptions,
    PortalReadOutcome,
} from './types.js';

import { PortalCollectionError } from './error.js';
import { createPortalReadCoordinator } from './readCoordinator.js';
import type { PortalReadCoordinator } from './readCoordinator.js';
export { PortalCollectionError } from './error.js';

/** One loaded Portal field and immutable set of criteria; rendering belongs to the app. */
export const createPortalCollection = (
    options: PortalCollectionOptions
): PortalCollection => {
    const client = options.client;
    const getScope = options.getScope;
    const criteria = captureCriteria(options.criteria);
    const metadata = capturePortalMetadata(
        options.portal,
        options.portalFieldId,
        criteria.selectedCustomViewId
    );
    const criteriaKey = criteriaIdentity(
        metadata.portalId,
        metadata.parentRecordId,
        metadata.portalFieldId,
        criteria
    );
    let session: RuntimeSession | null = readSession(client.getSession());
    const owner = readOwnerScope(getScope);
    const checkedSession = readSession(client.getSession());
    if (
        !sameOwner(readOwnerScope(getScope), owner) ||
        !sameSession(checkedSession, session)
    )
        throw new PortalCollectionError(
            'scope-changed',
            'The Portal context changed while creating the collection.'
        );
    let phase: 'active' | 'stale' | 'disposed' = 'active';
    let generation = 0;
    let coordinator: PortalReadCoordinator<
        ListPortalLinkedRecordsInput,
        ListPortalLinkedRecordsResult
    > | null = null;
    let pendingRead = false;
    let snapshot: PortalCollectionSnapshot | null = null;
    let cleanupRequired = false;
    let recoveryRequired = false;
    let checkingFreshness = false;

    const lifecycleError = () =>
        phase === 'disposed'
            ? new PortalCollectionError(
                  'disposed',
                  'The Portal collection was disposed.'
              )
            : new PortalCollectionError(
                  'scope-changed',
                  'The Portal owner or session changed. Create a fresh collection.'
              );
    const retire = (next: 'stale' | 'disposed') => {
        generation += 1;
        phase = next;
        snapshot = null;
        cleanupRequired = false;
        recoveryRequired = true;
        session = null;
        // Detach and retire before application-owned abort callbacks can reenter.
        coordinator?.destroy(lifecycleError());
    };
    const isCurrent = (): boolean => {
        if (phase !== 'active' || session === null || checkingFreshness)
            return false;
        const observed = generation;
        checkingFreshness = true;
        const unchanged = () =>
            phase === 'active' && session !== null && generation === observed;
        try {
            const first = readOwnerScope(getScope);
            if (!unchanged()) return false;
            const firstSession = readSession(client.getSession());
            if (!unchanged()) return false;
            const second = readOwnerScope(getScope);
            if (!unchanged()) return false;
            const lastSession = readSession(client.getSession());
            if (!unchanged()) return false;
            const last = readOwnerScope(getScope);
            if (!unchanged()) return false;
            if (
                sameOwner(first, owner) &&
                sameOwner(second, owner) &&
                sameOwner(last, owner) &&
                sameSession(firstSession, session!) &&
                sameSession(lastSession, session!)
            )
                return true;
        } catch {
            // An unreadable application scope is stale, not an authorization result.
        } finally {
            checkingFreshness = false;
        }
        if (phase === 'active' && generation === observed) retire('stale');
        return false;
    };
    const requireCurrent = (expectedGeneration: number) => {
        if (
            !isCurrent() ||
            generation !== expectedGeneration ||
            phase !== 'active'
        )
            throw lifecycleError();
    };
    const requireAvailable = () => {
        if (phase !== 'active') throw lifecycleError();
        if (pendingRead || coordinator?.hasPendingRead())
            throw new PortalCollectionError(
                'read-in-progress',
                'A Portal read is already in progress.'
            );
        requireCurrent(generation);
        if (cleanupRequired)
            throw new PortalCollectionError(
                'criteria-cleanup-required',
                'Accept the returned criteria cleanup and create a fresh collection.'
            );
    };
    const freshReadError = () =>
        new PortalCollectionError(
            'read-required',
            'A successful fresh first read is required.'
        );

    coordinator = createPortalReadCoordinator({
        load: (input, { signal }) =>
            client.portals.listLinkedRecords(input, {
                signal,
                session: { ...session! },
            }),
        getScope: () => owner,
        isContextCurrent: isCurrent,
        concurrency: 'reject',
    });
    const reads = coordinator;
    const read = async (
        more: boolean,
        supplied: PortalReadOptions
    ): Promise<PortalReadOutcome | null> => {
        const readOptions = captureReadOptions(supplied);
        requireAvailable();
        readOptions.signal?.throwIfAborted();
        if (more && (recoveryRequired || snapshot === null))
            throw freshReadError();
        if (more && snapshot!.airtableOffset === null) return null;
        const previous = more ? snapshot : null;
        const input: ListPortalLinkedRecordsInput = {
            ...structuredClone(criteria),
            extensionAccessToken: metadata.token,
            portalFieldId: metadata.portalFieldId,
            alreadyLoadedRecordIds:
                previous === null ? [] : [...previous.recordIds],
            airtableOffset: previous === null ? null : previous.airtableOffset,
            pagesToFetch: readOptions.pagesToFetch,
            refreshLoggedInPortalRecord:
                readOptions.refreshLoggedInPortalRecord,
        };
        let dispatched = false;
        let expected = generation;
        let outcome: PortalReadOutcome | undefined;
        // The facade has an extra await after transport acceptance. Keep its
        // single-flight lease until this outer read returns, as before SDK reuse.
        pendingRead = true;
        try {
            requireCurrent(expected);
            const receipt = await reads.read(input, {
                signal: readOptions.signal,
                onDispatch: () => {
                    requireCurrent(expected);
                    generation++;
                    expected = generation;
                    recoveryRequired = true;
                    if (!more) snapshot = null;
                    dispatched = true;
                },
                onCancelledAfterDispatch: () => {
                    generation++;
                    recoveryRequired = true;
                },
                onAccepted: (accepted) => {
                    const requireReceipt = () => {
                        requireCurrent(expected);
                        if (!accepted.isCurrent()) throw lifecycleError();
                    };
                    requireReceipt();
                    const page = capturePage(accepted.raw);
                    requireReceipt();
                    if (
                        page.endUserSortCleanup !== undefined ||
                        page.endUserFilterCleanup !== undefined
                    ) {
                        snapshot = null;
                        cleanupRequired = true;
                        recoveryRequired = true;
                        outcome = {
                            type: 'criteria-cleanup-required',
                            raw: structuredClone(page),
                        };
                    } else {
                        const combined = mergePage(previous, page);
                        const next: PortalCollectionSnapshot = {
                            ...combined,
                            criteriaKey,
                            detailFields: visibleDetails(metadata, combined),
                            layoutSettings: structuredClone(
                                metadata.layoutSettings
                            ),
                        };
                        requireReceipt();
                        snapshot = structuredClone(next);
                        recoveryRequired = false;
                        outcome = {
                            type: 'loaded',
                            raw: structuredClone(page),
                            snapshot: structuredClone(next),
                        };
                    }
                    requireReceipt();
                },
            });
            if (receipt.type === 'retired' || outcome === undefined)
                throw lifecycleError();
            // Acceptance committed synchronously while the transport lease was
            // held. A queued context change after detachment retires this owner,
            // but must not turn that already-settled outcome into a new failure.
            // The application still checks owner freshness before publication.
            return outcome;
        } catch (error) {
            if (readOptions.signal?.aborted)
                throw readOptions.signal.reason ?? error;
            requireCurrent(expected);
            if (dispatched) recoveryRequired = true;
            throw error;
        } finally {
            pendingRead = false;
        }
    };

    return Object.freeze({
        criteriaKey,
        readFirst: async (readOptions) => (await read(false, readOptions))!,
        readNext: (readOptions) => read(true, readOptions),
        getSnapshot: () => {
            const observed = generation;
            if (!isCurrent() || generation !== observed) return null;
            const result = snapshot === null ? null : structuredClone(snapshot);
            return isCurrent() && generation === observed ? result : null;
        },
        isCurrent,
        childFormRequest: (supplied) => {
            requireAvailable();
            const observed = generation;
            requireCurrent(observed);
            if (recoveryRequired) throw freshReadError();
            const childOptions = structuredClone(supplied);
            if (
                !isObject(childOptions.access) ||
                !['create', 'edit'].includes(childOptions.access.type)
            )
                throw new TypeError(
                    'A child create or edit request is required.'
                );
            const creating = childOptions.access.type === 'create';
            const configuredId = creating
                ? metadata.createChildId
                : metadata.editChildId;
            const requestedId = requireIdentifier(
                childOptions.configuredChildExtensionId,
                'Configured child extension ID'
            );
            if (
                configuredId === null ||
                requestedId !== configuredId ||
                (!creating && !metadata.viewAllowsEditing)
            )
                throw new PortalCollectionError(
                    'child-not-configured',
                    'Use the published child Form configured for this action and selected view.'
                );
            const recordId =
                childOptions.access.type === 'edit'
                    ? requireIdentifier(
                          childOptions.access.recordId,
                          'Child record ID'
                      )
                    : null;
            const listed = (id: string) =>
                snapshot !== null &&
                snapshot.recordIds.includes(id) &&
                Object.hasOwn(
                    snapshot.tableIdsToLinkedTableStates,
                    metadata.linkedTableId
                ) &&
                Object.hasOwn(
                    snapshot.tableIdsToLinkedTableStates[metadata.linkedTableId]
                        .recordIdsToAirtableRecords,
                    id
                );
            if (recordId !== null && !listed(recordId))
                throw new PortalCollectionError(
                    'record-not-listed',
                    'Read this record in the current selected Portal view before editing.'
                );
            const prefillData: LinkedRecordPrefill | null = creating
                ? structuredClone(metadata.prefill)
                : null;
            const current = (): boolean => {
                if (
                    !isCurrent() ||
                    generation !== observed ||
                    pendingRead ||
                    reads.hasPendingRead() ||
                    cleanupRequired ||
                    recoveryRequired
                )
                    return false;
                return recordId === null || listed(recordId);
            };
            const plan: PortalChildFormRequest = {
                input: {
                    childExtensionAccessData: {
                        parentExtensionAccessToken: metadata.token,
                        fieldIdUsedToAccessExtension: metadata.portalFieldId,
                    },
                    childExtensionInfo: {
                        childExtensionId: requestedId,
                        accessType:
                            recordId === null
                                ? { type: 'create' }
                                : {
                                      type: 'edit',
                                      childExtensionRecordId: recordId,
                                      childExtensionFieldId: null,
                                  },
                    },
                    context: {
                        type: 'modal',
                        linkedTableIdOfLinkedRecordField:
                            metadata.linkedTableId,
                        prefillDataForLinkedRecordsForm:
                            structuredClone(prefillData),
                    },
                    query: childOptions.query ?? {},
                    ...(childOptions.clientTimeZone === undefined
                        ? {}
                        : { clientTimeZone: childOptions.clientTimeZone }),
                    ...(childOptions.deviceFingerprint === undefined
                        ? {}
                        : {
                              deviceFingerprint: childOptions.deviceFingerprint,
                          }),
                },
                saveContext: {
                    type: 'modal',
                    prefillData: structuredClone(prefillData),
                },
                parent: {
                    portalId: metadata.portalId,
                    recordId: metadata.parentRecordId,
                    portalFieldId: metadata.portalFieldId,
                },
                isCurrent: current,
            };
            requireCurrent(observed);
            if (!current()) throw lifecycleError();
            return plan;
        },
        destroy: () => {
            if (phase !== 'disposed') retire('disposed');
        },
    } satisfies PortalCollection);
};
