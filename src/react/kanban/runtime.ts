// Exact pinned native dependency closure, bundled privately in both formats.
export {
    closestCenter,
    pointerWithin,
    rectIntersection,
    DndContext,
    DragOverlay,
    getFirstCollision,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    useSensors,
    useSensor,
    MeasuringStrategy,
    defaultDropAnimationSideEffects,
    closestCorners,
    KeyboardCode,
    type CancelDrop,
    type CollisionDetection,
    type DropAnimation,
    type Modifiers,
    type UniqueIdentifier,
    type KeyboardCoordinateGetter,
    type DroppableContainer,
} from '@dnd-kit/core';
export {
    SortableContext,
    useSortable,
    arrayMove,
    defaultAnimateLayoutChanges,
    verticalListSortingStrategy,
    horizontalListSortingStrategy,
    type AnimateLayoutChanges,
    type SortingStrategy,
} from '@dnd-kit/sortable';
export { CSS } from '@dnd-kit/utilities';
export { useStateWithDeps } from 'use-state-with-deps';
