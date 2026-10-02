import type {
    LinkedRecordPrefill,
    ListPortalLinkedRecordsInput,
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
    PortalCollectionErrorCode,
    PortalCollectionOptions,
    PortalCollectionSnapshot,
    PortalReadOptions,
    PortalReadOutcome,
} from './types.js';

export class PortalCollectionError extends Error {
    readonly code: PortalCollectionErrorCode;

    constructor(code: PortalCollectionErrorCode, message: string) {
        super(message);
        this.name = 'PortalCollectionError';
        this.code = code;
    }
}

type Attempt = {
    controller: AbortController;
    generation: number;
    dispatched: boolean;
};

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
    let active: Attempt | null = null;
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
        const previous = active;
        generation += 1;
        active = null;
        phase = next;
        snapshot = null;
        cleanupRequired = false;
        recoveryRequired = true;
        session = null;
        // Detach and retire before application-owned abort callbacks can reenter.
        previous?.controller.abort(lifecycleError());
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
        if (active !== null)
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
    const requireAttempt = (attempt: Attempt) => {
        attempt.controller.signal.throwIfAborted();
        requireCurrent(attempt.generation);
        if (active !== attempt) throw lifecycleError();
    };
    const freshReadError = () =>
        new PortalCollectionError(
            'read-required',
            'A successful fresh first read is required.'
        );

    const read = async (
        more: boolean,
        supplied: PortalReadOptions
    ): Promise<PortalReadOutcome | null> => {
        const readOptions = captureReadOptions(supplied);
        requireAvailable();
        readOptions.signal?.throwIfAborted();
        const attempt: Attempt = {
            controller: new AbortController(),
            generation,
            dispatched: false,
        };
        active = attempt;
        const externalSignal = readOptions.signal;
        const forwardAbort = () => {
            if (active !== attempt) return;
            if (attempt.dispatched) {
                generation += 1;
                recoveryRequired = true;
            }
            // Keep single-flight ownership until an abort-ignoring operation settles.
            attempt.controller.abort(externalSignal?.reason);
        };
        externalSignal?.addEventListener('abort', forwardAbort, { once: true });
        try {
            if (externalSignal?.aborted) forwardAbort();
            requireAttempt(attempt);
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
                airtableOffset:
                    previous === null ? null : previous.airtableOffset,
                pagesToFetch: readOptions.pagesToFetch,
                refreshLoggedInPortalRecord:
                    readOptions.refreshLoggedInPortalRecord,
            };
            requireAttempt(attempt);
            generation += 1;
            attempt.generation = generation;
            recoveryRequired = true;
            if (!more) snapshot = null;
            attempt.dispatched = true;
            const raw = await client.portals.listLinkedRecords(input, {
                signal: attempt.controller.signal,
                session: { ...session! },
            });
            requireAttempt(attempt);
            const page = capturePage(raw);
            requireAttempt(attempt);
            if (
                page.endUserSortCleanup !== undefined ||
                page.endUserFilterCleanup !== undefined
            ) {
                snapshot = null;
                cleanupRequired = true;
                recoveryRequired = true;
                const outcome: PortalReadOutcome = {
                    type: 'criteria-cleanup-required',
                    raw: structuredClone(page),
                };
                requireAttempt(attempt);
                return outcome;
            }
            const combined = mergePage(previous, page);
            const next: PortalCollectionSnapshot = {
                ...combined,
                criteriaKey,
                detailFields: visibleDetails(metadata, combined),
                layoutSettings: structuredClone(metadata.layoutSettings),
            };
            requireAttempt(attempt);
            snapshot = structuredClone(next);
            recoveryRequired = false;
            const outcome: PortalReadOutcome = {
                type: 'loaded',
                raw: structuredClone(page),
                snapshot: structuredClone(next),
            };
            requireAttempt(attempt);
            return outcome;
        } catch (error) {
            if (attempt.controller.signal.aborted)
                throw attempt.controller.signal.reason ?? error;
            if (
                phase !== 'active' ||
                active !== attempt ||
                generation !== attempt.generation
            )
                throw lifecycleError();
            requireAttempt(attempt);
            if (attempt.dispatched) recoveryRequired = true;
            throw error;
        } finally {
            externalSignal?.removeEventListener('abort', forwardAbort);
            if (active === attempt) active = null;
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
                    active !== null ||
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
                    ...(childOptions.query === undefined
                        ? {}
                        : { query: childOptions.query }),
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
