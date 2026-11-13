/**
 * dnd-kit distance:0 activates on the first move, returning before its normal
 * preventDefault. Cancel that admitted moving event before the browser claims
 * panning/navigation. Stationary taps and unadmitted surfaces remain native.
 */
export function claimKanbanTouchMove(
    start: Event,
    isCurrent: () => boolean
): () => void {
    // TouchSensor's onActivation contract supplies the native touchstart.
    const touches = (start as TouchEvent).touches;
    const first = touches?.length === 1 ? touches[0] : undefined;
    const target = start.target;
    if (!first || !target) return () => {};
    const { identifier, clientX, clientY } = first;
    const ownerDocument =
        (start as UIEvent).view?.document ?? (target as Node).ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    let active = true;
    const release = () => {
        if (!active) return;
        active = false;
        target.removeEventListener('touchmove', move, true);
        target.removeEventListener('touchend', release, true);
        target.removeEventListener('touchcancel', release, true);
        ownerWindow?.removeEventListener('resize', release);
        ownerWindow?.removeEventListener('visibilitychange', release);
        ownerDocument?.removeEventListener('keydown', cancelKey);
    };
    const cancelKey = (event: KeyboardEvent) => {
        if (event.code === 'Escape') release();
    };
    const move = (event: Event) => {
        if (!active) return;
        let current = false;
        try {
            current = isCurrent();
        } catch {
            release();
            return;
        }
        if (!active || !current) {
            release();
            return;
        }
        const touches = (event as TouchEvent).touches;
        const point = touches?.length === 1 ? touches[0] : undefined;
        if (!point || point.identifier !== identifier) {
            release();
            return;
        }
        if (point.clientX === clientX && point.clientY === clientY) return;
        try {
            if (event.cancelable) event.preventDefault();
        } finally {
            release();
        }
    };
    target.addEventListener('touchmove', move, {
        capture: true,
        passive: false,
    });
    target.addEventListener('touchend', release, true);
    target.addEventListener('touchcancel', release, true);
    // Match the sensor's pending-gesture cancellation, before onDragCancel
    // is available from DndContext for an activated drag.
    ownerWindow?.addEventListener('resize', release);
    ownerWindow?.addEventListener('visibilitychange', release);
    ownerDocument?.addEventListener('keydown', cancelKey);
    return release;
}
