import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    nativeCalendarClock,
    type CalendarActionResult,
    type CalendarClock,
    type CalendarOwnerFrame,
} from '../ui/calendarController.js';

export type CalendarCompositionSnapshot = {
    readonly selectedDay: string;
    readonly focusMonth: string;
    readonly queryMonth?: string;
    readonly appliedMonth?: string;
    readonly today: string;
};

export type CalendarCompositionController<
    Snapshot extends CalendarCompositionSnapshot,
> = {
    getSnapshot(): Snapshot;
    focusDay(day: string): CalendarActionResult;
    selectDay(day: string): CalendarActionResult;
    dispose(): void;
};

const refused = (): CalendarActionResult => ({
    type: 'refused',
    reason: 'uncommitted-or-retired',
});
const viewKey = (snapshot: CalendarCompositionSnapshot) =>
    JSON.stringify([
        snapshot.selectedDay,
        snapshot.focusMonth,
        snapshot.queryMonth,
        snapshot.appliedMonth,
        snapshot.today,
    ]);

/** Read admission is separate from a mounted action lifetime, including SSR. */
export function isCalendarFrameReadable(frame: CalendarOwnerFrame): boolean {
    try {
        return frame.isCurrent() === true;
    } catch {
        return false;
    }
}

/**
 * Commit-only borrowed controller composition. No subscription, canonical store
 * or mount read. Factories and synchronizers must be module-stable functions.
 * The injected clock is a mount-lifetime input, matching native useState clocks;
 * its methods must perform their own current-time/offset reads. A new clock prop
 * object does not recenter local selection or allocate a read.
 */
export function useCalendarComposition<
    Frame extends CalendarOwnerFrame & {
        readonly control?: CalendarOwnerFrame;
    },
    Snapshot extends CalendarCompositionSnapshot,
    Controller extends CalendarCompositionController<Snapshot>,
>(
    frame: Frame,
    create: (frame: Frame, clock: CalendarClock) => Controller,
    synchronize: (
        controller: Controller,
        frame: Frame,
        isCurrent: () => boolean
    ) => void,
    clock: CalendarClock = nativeCalendarClock
) {
    type Runtime = {
        controller: Controller;
        active: boolean;
        disposed: boolean;
        frame: Frame | null;
        lease: object | null;
        controlLease: object | null;
        focusedDay: string;
    };
    const [, refresh] = useState(0);
    const mountClock = useRef(clock);
    const make = (): Runtime => {
        const controller = create(frame, mountClock.current);
        return {
            controller,
            active: false,
            disposed: false,
            frame: null,
            lease: null,
            controlLease: null,
            focusedDay: controller.getSnapshot().selectedDay,
        };
    };
    const holder = useRef<Runtime | null>(null);
    if (holder.current === null) holder.current = make();
    const runtime = holder.current;
    const lease = useMemo(() => ({}), [runtime, frame]);
    const controlKey = frame.control ?? frame;
    const controlLease = useMemo(() => ({}), [runtime, controlKey]);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const current = () => {
        const committed = () =>
            holder.current === runtime &&
            runtime.active &&
            !runtime.disposed &&
            runtime.lease === lease &&
            runtime.frame === frame;
        return committed() && isCalendarFrameReadable(frame) && committed();
    };
    const sameActiveControl = () => {
        const committed = () =>
            holder.current === runtime &&
            runtime.active &&
            !runtime.disposed &&
            runtime.controlLease === controlLease;
        // Equal/reused owner objects cannot revive a completed control ABA.
        // Display-only publication keeps this separate committed lease stable.
        return (
            committed() && isCalendarFrameReadable(controlKey) && committed()
        );
    };
    useCommitEffect(() => {
        let active = holder.current!;
        if (active.disposed) {
            active = make();
            holder.current = active;
            // StrictMode's second setup needs a fresh committed callback lease.
            refresh((value) => value + 1);
        }
        active.active = true;
        return () => {
            active.active = false;
            active.disposed = true;
            active.lease = null;
            active.controlLease = null;
            active.frame = null;
            active.controller.dispose();
        };
    }, [create]);
    const snapshot = runtime.controller.getSnapshot();
    useCommitEffect(() => {
        if (holder.current !== runtime || runtime.disposed) return;
        runtime.frame = frame;
        runtime.lease = lease;
        runtime.controlLease = controlLease;
        synchronize(runtime.controller, frame, current);
        if (viewKey(snapshot) !== viewKey(runtime.controller.getSnapshot()))
            refresh((value) => value + 1);
    });
    const act = (
        action: (controller: Controller) => CalendarActionResult
    ): CalendarActionResult => {
        if (!current()) return refused();
        synchronize(runtime.controller, frame, current);
        if (!current()) return refused();
        const before = viewKey(runtime.controller.getSnapshot());
        try {
            return action(runtime.controller);
        } finally {
            if (
                holder.current === runtime &&
                runtime.active &&
                !runtime.disposed
            ) {
                // A native month dispatch may synchronously commit new display
                // data. Refresh the admitted local result, but never reinstall
                // the old display frame over that successor publication.
                if (current()) synchronize(runtime.controller, frame, current);
                if (viewKey(runtime.controller.getSnapshot()) !== before)
                    refresh((value) => value + 1);
            }
        }
    };
    return {
        snapshot,
        focusedDay: runtime.focusedDay,
        current,
        act,
        focusDay(day: string): CalendarActionResult {
            const result = act((controller) => controller.focusDay(day));
            if (
                result.type === 'admitted' &&
                sameActiveControl() &&
                runtime.focusedDay !== day
            ) {
                runtime.focusedDay = day;
                refresh((value) => value + 1);
            }
            return result;
        },
        selectDay(day: string): CalendarActionResult {
            return act((controller) => controller.selectDay(day));
        },
    };
}
