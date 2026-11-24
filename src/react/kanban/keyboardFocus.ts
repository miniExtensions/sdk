type KeyboardDrag = {
    recordId: string;
    epoch: number;
    element: HTMLElement;
    ended: boolean;
    followProjection: boolean;
};

/** The focused keyboard activator can be replaced by a preview or a new board. */
export function createKanbanKeyboardFocus() {
    let drag: KeyboardDrag | null = null;

    function clear() {
        if (drag == null) return;
        const document = drag.element.ownerDocument;
        drag = null;
        document.removeEventListener('focusin', onFocus, true);
        document.removeEventListener('pointerdown', clear, true);
        document.removeEventListener('keydown', onKeyDown, true);
    }

    function onFocus(event: FocusEvent) {
        if (drag != null && event.target !== drag.element) clear();
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === 'Tab' && drag?.ended === true) clear();
    }

    return {
        start(event: Event, recordId: string, epoch: number) {
            clear();
            if (event.type !== 'keydown') return;
            const target = event.target as HTMLElement | null;
            const document = target?.ownerDocument;
            const HTMLElement = document?.defaultView?.HTMLElement;
            if (
                document == null ||
                HTMLElement == null ||
                !(target instanceof HTMLElement) ||
                target !== document.activeElement ||
                target.dataset.kanbanRecord !== recordId
            )
                return;
            drag = {
                recordId,
                epoch,
                element: target,
                ended: false,
                followProjection: false,
            };
            document.addEventListener('focusin', onFocus, true);
            document.addEventListener('pointerdown', clear, true);
            document.addEventListener('keydown', onKeyDown, true);
        },
        end(epoch: number, followProjection = false) {
            if (drag?.epoch !== epoch) return;
            drag.ended = true;
            drag.followProjection = followProjection;
        },
        restore(board: HTMLDivElement, epoch: number) {
            if (drag == null) return;
            if (drag.epoch !== epoch && !drag.followProjection) {
                clear();
                return;
            }
            if (drag.element.isConnected) return;
            const document = board.ownerDocument;
            if (
                document !== drag.element.ownerDocument ||
                (document.activeElement !== document.body &&
                    document.activeElement !== document.documentElement)
            ) {
                clear();
                return;
            }
            const replacement = Array.from(
                board.querySelectorAll<HTMLElement>('[data-kanban-record]')
            ).find(
                (element) =>
                    element.dataset.kanbanRecord === drag?.recordId &&
                    element.closest('.mx-sdk-kanban-board') === board
            );
            if (replacement == null) return;
            drag.element = replacement;
            replacement.focus({ preventScroll: true });
            if (document.activeElement !== replacement) clear();
        },
        update(epoch: number, recordIds: readonly string[], disabled: boolean) {
            if (
                drag != null &&
                (disabled ||
                    !recordIds.includes(drag.recordId) ||
                    (drag.epoch !== epoch && !drag.followProjection))
            )
                clear();
        },
        clear,
    };
}
