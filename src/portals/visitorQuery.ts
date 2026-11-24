import type {
    PortalVisitorFilterCommand,
    PortalVisitorFilterFrame,
    PortalVisitorFilterPort,
} from './visitorFilter.js';
import {
    samePortalVisitorSearchScope,
    type PortalVisitorSearchCommand,
    type PortalVisitorSearchFrame,
    type PortalVisitorSearchPort,
    type PortalVisitorSearchPublication,
} from './visitorSearch.js';
import type {
    PortalVisitorSortCommand,
    PortalVisitorSortFrame,
    PortalVisitorSortPort,
    PortalVisitorSortStamp,
} from './visitorSort.js';

/** One read of the host's accepted query state. Rows and paging stay in the host. */
export type PortalVisitorQueryFrame = Readonly<{
    stamp: PortalVisitorSortStamp;
    search: Omit<PortalVisitorSearchFrame, 'stamp'>;
    filter: Omit<PortalVisitorFilterFrame, 'stamp'>;
    sort: Omit<PortalVisitorSortFrame, 'stamp'>;
    /** An opaque capability for the current failed attempt, retired on owner drift. */
    retryId?: string;
}>;

export type PortalVisitorQueryCommand =
    | Readonly<PortalVisitorSearchCommand & { type: 'search' }>
    | Readonly<PortalVisitorFilterCommand & { type: 'filter' }>
    | Readonly<PortalVisitorSortCommand & { type: 'sort' }>
    | Readonly<{
          type: 'view';
          stamp: PortalVisitorSortStamp;
          viewId: string;
      }>
    | Readonly<{
          type: 'retry';
          stamp: PortalVisitorSortStamp;
          retryId: string;
      }>;

export type PortalVisitorQueryRequestStart = Readonly<{
    requestId: string;
    generation: number;
}>;

export type PortalVisitorQueryOutcome =
    | Readonly<{
          type: 'allocated';
          /** A receipt from invoking the authorized transport. */
          requestStart: PortalVisitorQueryRequestStart;
          committedPublication?: PortalVisitorSearchPublication;
      }>
    | Readonly<{ type: 'unchanged' }>
    | Readonly<{ type: 'stale' }>
    | Readonly<{
          type: 'refused' | 'uncertain';
          /** A term publication verified for this Search command. */
          committedPublication?: PortalVisitorSearchPublication;
          /** A criteria publication verified for this Filter or Sort command. */
          committedGeneration?: number;
      }>;

export type PortalVisitorQueryPort = {
    read(): PortalVisitorQueryFrame | null;
    subscribe(listener: () => void): () => void;
    /**
     * Verify the captured stamp and the native request binding before
     * publishing or invoking transport. Retry also requires a matching live
     * capability, which the host consumes on admission.
     */
    apply(
        command: PortalVisitorQueryCommand
    ): PortalVisitorQueryOutcome | Promise<PortalVisitorQueryOutcome>;
};

export type PortalVisitorQueryControls = {
    readonly search: PortalVisitorSearchPort &
        Pick<PortalVisitorQueryPort, 'subscribe'>;
    readonly filter: PortalVisitorFilterPort;
    readonly sort: PortalVisitorSortPort;
    selectView(
        stamp: PortalVisitorSortStamp,
        viewId: string
    ): Promise<PortalVisitorQueryOutcome>;
    /** Pass the capability captured with the frame that rendered Retry. */
    retry(
        stamp: PortalVisitorSortStamp,
        retryId: string
    ): Promise<PortalVisitorQueryOutcome>;
};

/** Connect the existing control drafts to the same host-owned query port. */
export function createPortalVisitorQueryControls(
    port: PortalVisitorQueryPort
): PortalVisitorQueryControls {
    const subscribe: PortalVisitorQueryPort['subscribe'] = (listener) =>
        port.subscribe(listener);
    const readControl = <Control extends 'search' | 'filter' | 'sort'>(
        name: Control
    ) => {
        const frame = port.read();
        return frame ? { ...frame[name], stamp: frame.stamp } : null;
    };

    const submit = async (
        stamp: PortalVisitorSortStamp,
        prepare: (
            frame: PortalVisitorQueryFrame
        ) => PortalVisitorQueryCommand | PortalVisitorQueryOutcome
    ): Promise<PortalVisitorQueryOutcome> => {
        try {
            const frame = port.read();
            if (
                !frame ||
                frame.stamp.generation !== stamp.generation ||
                !samePortalVisitorSearchScope(frame.stamp, stamp)
            )
                return { type: 'stale' };

            const prepared = prepare(frame);
            return 'stamp' in prepared ? await port.apply(prepared) : prepared;
        } catch {
            return { type: 'uncertain' };
        }
    };

    const applyCriteria = async (
        command: Extract<PortalVisitorQueryCommand, { type: 'filter' | 'sort' }>
    ) => {
        const outcome = await submit(command.stamp, () => command);
        if (outcome.type === 'allocated')
            return { type: outcome.type, ...outcome.requestStart };
        if (
            (outcome.type === 'refused' || outcome.type === 'uncertain') &&
            outcome.committedGeneration !== undefined
        )
            return {
                type: outcome.type,
                committedGeneration: outcome.committedGeneration,
            };
        return { type: outcome.type };
    };

    return {
        search: {
            read: () => readControl('search'),
            subscribe,
            async apply(command) {
                const outcome = await submit(command.stamp, () => ({
                    ...command,
                    type: 'search',
                }));
                if (outcome.type === 'allocated') {
                    const { type, requestStart, committedPublication } =
                        outcome;
                    return committedPublication
                        ? { type, ...requestStart, committedPublication }
                        : { type, ...requestStart };
                }
                if (outcome.type === 'unchanged') return { type: 'uncertain' };
                if (
                    (outcome.type === 'refused' ||
                        outcome.type === 'uncertain') &&
                    outcome.committedPublication
                )
                    return {
                        type: outcome.type,
                        committedPublication: outcome.committedPublication,
                    };
                return { type: outcome.type };
            },
        },
        filter: {
            read: () => readControl('filter'),
            subscribe,
            apply: (command) => applyCriteria({ ...command, type: 'filter' }),
        },
        sort: {
            read: () => readControl('sort'),
            subscribe,
            apply: (command) => applyCriteria({ ...command, type: 'sort' }),
        },
        selectView(stamp, viewId) {
            return submit(stamp, (frame) =>
                frame.stamp.viewId === viewId
                    ? { type: 'unchanged' }
                    : { type: 'view', stamp, viewId }
            );
        },
        retry(stamp, retryId) {
            return submit(stamp, ({ retryId: currentRetryId }) => {
                if (!currentRetryId) return { type: 'refused' };
                return currentRetryId === retryId
                    ? { type: 'retry', stamp, retryId }
                    : { type: 'stale' };
            });
        },
    };
}
