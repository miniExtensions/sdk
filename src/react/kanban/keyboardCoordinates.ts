/* eslint @typescript-eslint/strict-boolean-expressions: 0 */

import {
    closestCorners,
    getFirstCollision,
    KeyboardCode,
    DroppableContainer,
    KeyboardCoordinateGetter,
    type CollisionDetection,
    type UniqueIdentifier,
} from './runtime.js';

const directions: string[] = [
    KeyboardCode.Down,
    KeyboardCode.Right,
    KeyboardCode.Up,
    KeyboardCode.Left,
];

const containerInsetX = 20;
const containerInsetY = 74;

export type KeyboardHorizontalTarget = Readonly<{
    activeId: UniqueIdentifier;
    id: UniqueIdentifier;
    registrationKey: UniqueIdentifier;
}>;

type KeyboardContext = Parameters<KeyboardCoordinateGetter>[1]['context'];
type DroppableRect = NonNullable<
    ReturnType<KeyboardContext['droppableRects']['get']>
>;
type KeyboardMove = {
    coordinates: Exclude<ReturnType<KeyboardCoordinateGetter>, void>;
    horizontalTarget: KeyboardHorizontalTarget | null;
};

function canMeasureDroppable(
    entry: DroppableContainer | undefined,
    rect: DroppableRect | undefined
): entry is DroppableContainer {
    return (
        entry != null &&
        !entry.disabled &&
        entry.node.current?.isConnected === true &&
        rect != null &&
        rect.width > 0 &&
        rect.height > 0
    );
}

function isEmptyColumn(entry: DroppableContainer, activeId?: UniqueIdentifier) {
    const data = entry.data.current;
    return (
        data?.type === 'container' &&
        Array.isArray(data.children) &&
        data.children.every((id) => id === activeId)
    );
}

function isCurrentHorizontalTarget(
    target: KeyboardHorizontalTarget | null,
    activeId: UniqueIdentifier,
    entry: DroppableContainer | undefined,
    rect: DroppableRect | undefined
): entry is DroppableContainer {
    return (
        target != null &&
        target.activeId === activeId &&
        canMeasureDroppable(entry, rect) &&
        entry.id === target.id &&
        entry.key === target.registrationKey &&
        (entry.data.current?.type !== 'container' ||
            isEmptyColumn(entry, activeId))
    );
}

/** Retain the keyboard destination through the board's optimistic layout change. */
export function getKeyboardHorizontalCollision(
    args: Parameters<CollisionDetection>[0],
    target: KeyboardHorizontalTarget | null
): ReturnType<CollisionDetection>[number] | null {
    if (
        target == null ||
        args.pointerCoordinates != null ||
        args.active.data.current?.type === 'container'
    )
        return null;
    const entry = args.droppableContainers.find(({ id }) => id === target.id);
    const rect = args.droppableRects.get(target.id);
    return isCurrentHorizontalTarget(target, args.active.id, entry, rect)
        ? { id: entry.id, data: { droppableContainer: entry, value: 1 } }
        : null;
}

export function getKeyboardMove(
    event: Parameters<KeyboardCoordinateGetter>[0],
    {
        context: { active, droppableRects, droppableContainers, collisionRect },
    }: Parameters<KeyboardCoordinateGetter>[1],
    previousTarget: KeyboardHorizontalTarget | null
): KeyboardMove | undefined {
    if (directions.includes(event.code)) {
        event.preventDefault();

        if (!active || !collisionRect) {
            return;
        }

        const left = event.code === KeyboardCode.Left;
        const right = event.code === KeyboardCode.Right;
        const horizontalRecordMove =
            (left || right) && active.data.current?.type !== 'container';
        const previousEntry =
            previousTarget && droppableContainers.get(previousTarget.id);
        const previousRect =
            previousTarget && droppableRects.get(previousTarget.id);
        const followsAssistedMove =
            horizontalRecordMove &&
            isCurrentHorizontalTarget(
                previousTarget,
                active.id,
                previousEntry ?? undefined,
                previousRect ?? undefined
            );
        // A preview can expand the destination and shift the following columns
        // before dnd-kit refreshes all its measured rectangles.
        const measuredRects = followsAssistedMove
            ? new Map(droppableRects)
            : droppableRects;
        if (followsAssistedMove) {
            for (const entry of droppableContainers.getEnabled()) {
                const live = entry.node.current?.getBoundingClientRect();
                if (live && live.width > 0 && live.height > 0)
                    measuredRects.set(entry.id, live);
            }
        }
        const previousLiveRect =
            followsAssistedMove && previousEntry
                ? measuredRects.get(previousEntry.id)
                : undefined;
        const origin = previousLiveRect ?? collisionRect;
        const horizontalGap = (rect: DroppableRect) =>
            left ? origin.left - rect.right : rect.left - origin.right;
        const cannotContainDrag = (rect: DroppableRect, inset = 0) =>
            rect.width < collisionRect.width + inset;
        const filteredContainers: DroppableContainer[] = [];
        let narrowColumn: { entry: DroppableContainer; gap: number } | null =
            null;

        for (const entry of droppableContainers.getEnabled()) {
            const rect = measuredRects.get(entry.id);
            if (entry.disabled || rect == null) continue;

            const { type, children } = entry.data.current ?? {};
            if (
                type === 'container' &&
                children?.length > 0 &&
                active.data.current?.type !== 'container'
            )
                continue;

            if (horizontalRecordMove) {
                if (entry.id === active.id) continue;
                const gap = horizontalGap(rect);
                if (gap >= 0) {
                    filteredContainers.push(entry);
                    if (
                        cannotContainDrag(rect, containerInsetX) &&
                        canMeasureDroppable(entry, rect) &&
                        isEmptyColumn(entry) &&
                        (narrowColumn == null || gap < narrowColumn.gap)
                    )
                        narrowColumn = { entry, gap };
                }
                continue;
            }

            switch (event.code) {
                case KeyboardCode.Down:
                    if (collisionRect.top < rect.top) {
                        filteredContainers.push(entry);
                    }
                    break;
                case KeyboardCode.Up:
                    if (collisionRect.top > rect.top) {
                        filteredContainers.push(entry);
                    }
                    break;
                case KeyboardCode.Left:
                    if (collisionRect.left >= rect.left + rect.width) {
                        filteredContainers.push(entry);
                    }
                    break;
                case KeyboardCode.Right:
                    if (collisionRect.left + collisionRect.width <= rect.left) {
                        filteredContainers.push(entry);
                    }
                    break;
            }
        }

        const collisions = closestCorners({
            active,
            collisionRect: origin,
            droppableRects: measuredRects,
            droppableContainers: filteredContainers,
            pointerCoordinates: null,
        });
        const closestId = getFirstCollision(collisions, 'id');
        const closestRect =
            closestId == null ? undefined : measuredRects.get(closestId);
        const targetId =
            narrowColumn != null &&
            (closestRect == null ||
                narrowColumn.gap <= horizontalGap(closestRect))
                ? narrowColumn.entry.id
                : closestId;

        if (targetId != null) {
            const newDroppable = droppableContainers.get(targetId);
            const newNode = newDroppable?.node.current;
            const newRect = followsAssistedMove
                ? measuredRects.get(targetId)
                : newDroppable?.rect.current;

            if (newNode && newRect) {
                if (newDroppable.id === 'placeholder') {
                    return {
                        coordinates: {
                            x:
                                newRect.left +
                                (newRect.width - collisionRect.width) / 2,
                            y:
                                newRect.top +
                                (newRect.height - collisionRect.height) / 2,
                        },
                        horizontalTarget: null,
                    };
                }

                const isColumn =
                    newDroppable.data.current?.type === 'container';
                const needsHorizontalTarget =
                    horizontalRecordMove &&
                    (followsAssistedMove ||
                        cannotContainDrag(
                            newRect,
                            isColumn ? containerInsetX : 0
                        )) &&
                    canMeasureDroppable(newDroppable, newRect) &&
                    (!isColumn || isEmptyColumn(newDroppable));

                return {
                    coordinates: {
                        x:
                            newRect.left +
                            (isColumn
                                ? needsHorizontalTarget &&
                                  newRect.width <= containerInsetX
                                    ? newRect.width / 2
                                    : containerInsetX
                                : 0),
                        y: newRect.top + (isColumn ? containerInsetY : 0),
                    },
                    horizontalTarget: needsHorizontalTarget
                        ? {
                              activeId: active.id,
                              id: newDroppable.id,
                              registrationKey: newDroppable.key,
                          }
                        : null,
                };
            }
        }
    }

    return undefined;
}

export const coordinateGetter: KeyboardCoordinateGetter = (event, options) =>
    getKeyboardMove(event, options, null)?.coordinates;
