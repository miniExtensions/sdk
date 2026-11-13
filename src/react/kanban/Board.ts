/* eslint @typescript-eslint/strict-boolean-expressions: 0 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    CancelDrop,
    closestCenter,
    pointerWithin,
    rectIntersection,
    CollisionDetection,
    DndContext,
    DragOverlay,
    DropAnimation,
    getFirstCollision,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    Modifiers,
    UniqueIdentifier,
    useSensors,
    useSensor,
    MeasuringStrategy,
    KeyboardCoordinateGetter,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
    AnimateLayoutChanges,
    SortableContext,
    useSortable,
    arrayMove,
    defaultAnimateLayoutChanges,
    verticalListSortingStrategy,
    SortingStrategy,
    horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { coordinateGetter as multipleContainersCoordinateGetter } from './keyboardCoordinates.js';
import { Container, ContainerProps } from './Container.js';
import { Item } from './Item.js';
import { RenderItemFunc } from './Item.js';
import { useStateWithDeps } from './projectionState.js';
import { useThemeSnapshot, getThemePortalProps } from '../ThemeBoundary.js';
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
    defaultAnimateLayoutChanges({ ...args, wasDragging: true });
function DroppableContainer({
    children,
    columns = 1,
    disabled,
    id,
    items,
    style,
    ...props
}: ContainerProps & {
    disabled?: boolean;
    id: UniqueIdentifier;
    items: UniqueIdentifier[];
    style?: React.CSSProperties;
}) {
    const {
        active,
        attributes,
        isDragging,
        listeners,
        over,
        setNodeRef,
        transition,
        transform,
    } = useSortable({
        id,
        data: {
            type: 'container',
            children: items,
        },
        animateLayoutChanges,
    });
    const isOverContainer = over
        ? (id === over.id && active?.data.current?.type !== 'container') ||
          items.includes(over.id)
        : false;
    return React.createElement(Container, {
        ref: disabled ? undefined : setNodeRef,
        style: {
            ...style,
            transition,
            transform: CSS.Translate.toString(transform),
            opacity: isDragging ? 0.5 : undefined,
        },
        hover: isOverContainer,
        handleProps: {
            ...attributes,
            ...listeners,
        },
        columns: columns,
        ...props,
        children: children,
    });
}
const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
        styles: {
            active: {
                opacity: '0.5',
            },
        },
    }),
};
export type KanbanColumn = {
    id: UniqueIdentifier;
    label: string;
    value: string | null;
    recordIds: UniqueIdentifier[];
};
export type KanbanItems = KanbanColumn[];
const findColumnById = (
    items: KanbanItems,
    id: UniqueIdentifier
): KanbanColumn | undefined => items.find((column) => column.id === id);
const isColumnId = (items: KanbanItems, id: UniqueIdentifier): boolean =>
    findColumnById(items, id) != null;
interface Props {
    adjustScale?: boolean;
    cancelDrop?: CancelDrop;
    columns?: number;
    containerStyle?: React.CSSProperties;
    coordinateGetter?: KeyboardCoordinateGetter;
    getItemStyles?(args: {
        value: UniqueIdentifier;
        index: number;
        overIndex: number;
        isDragging: boolean;
        containerId: UniqueIdentifier;
        isSorting: boolean;
        isDragOverlay: boolean;
    }): React.CSSProperties;
    wrapperStyle?(args: { index: number }): React.CSSProperties;
    items: KanbanItems;
    setItems: React.Dispatch<React.SetStateAction<KanbanItems>>;
    handle?: boolean;
    renderItem: RenderItemFunc;
    strategy?: SortingStrategy;
    modifiers?: Modifiers;
    minimal?: boolean;
    scrollable?: boolean;
    vertical?: boolean;
    disabled: boolean;
    isCurrent: () => boolean;
    modalOpen?: boolean;
    overlayClassName?: string;
    onRecordUpdate: (
        recordId: string,
        newContainerId: UniqueIdentifier
    ) => void;
}
export function MultipleContainers({
    adjustScale = false,
    cancelDrop,
    columns,
    handle = false,
    items,
    setItems,
    containerStyle,
    coordinateGetter = multipleContainersCoordinateGetter,
    getItemStyles = () => ({}),
    wrapperStyle = () => ({}),
    minimal = false,
    modifiers,
    renderItem,
    strategy = verticalListSortingStrategy,
    vertical = false,
    scrollable,
    onRecordUpdate,
    disabled,
    isCurrent,
    modalOpen = false,
    overlayClassName,
}: Props) {
    const contextId = useId();
    const live = useRef(true);
    useEffect(() => {
        live.current = true;
        return () => {
            live.current = false;
        };
    }, []);
    const acceptsDrag = () =>
        live.current && isCurrent() && !disabled && !modalOpen;
    const isAnExtensionModalOpen = modalOpen;
    const theme = getThemePortalProps(useThemeSnapshot());
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    useEffect(() => {
        setPortalTarget(document.body);
    }, []);
    const [containers, setContainers] = useStateWithDeps<UniqueIdentifier[]>(
        items.map((column) => column.id),
        [items]
    );
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
    const lastOverId = useRef<UniqueIdentifier | null>(null);
    const recentlyMovedToNewContainer = useRef(false);
    const isSortingContainer = activeId ? containers.includes(activeId) : false;
    /**
     * Custom collision detection strategy optimized for multiple containers
     *
     * - First, find any droppable containers intersecting with the pointer.
     * - If there are none, find intersecting containers with the active draggable.
     * - If there are no intersecting containers, return the last matched intersection
     *
     */
    const collisionDetectionStrategy: CollisionDetection = useCallback(
        (args) => {
            if (activeId && isColumnId(items, activeId)) {
                return closestCenter({
                    ...args,
                    droppableContainers: args.droppableContainers.filter(
                        (container) => isColumnId(items, container.id)
                    ),
                });
            }
            // Start by finding any intersecting droppable
            const pointerIntersections = pointerWithin(args);
            const intersections =
                pointerIntersections.length > 0
                    ? // If there are droppables intersecting with the pointer, return those
                      pointerIntersections
                    : rectIntersection(args);
            let overId = getFirstCollision(intersections, 'id');
            if (overId != null) {
                const overColumn = findColumnById(items, overId);
                if (overColumn != null) {
                    const containerItems = overColumn.recordIds;
                    // If a container is matched and it contains items (columns 'A', 'B', 'C')
                    if (containerItems.length > 0) {
                        // Return the closest droppable within that container
                        overId = closestCenter({
                            ...args,
                            droppableContainers:
                                args.droppableContainers.filter(
                                    (container) =>
                                        container.id !== overId &&
                                        containerItems.includes(container.id)
                                ),
                        })[0]?.id;
                    }
                }
                lastOverId.current = overId;
                return [{ id: overId }];
            }
            // When a draggable item moves to a new container, the layout may shift
            // and the `overId` may become `null`. We manually set the cached `lastOverId`
            // to the id of the draggable item that was moved to the new container, otherwise
            // the previous `overId` will be returned which can cause items to incorrectly shift positions
            if (recentlyMovedToNewContainer.current) {
                lastOverId.current = activeId;
            }
            // If no droppable is matched, return the last match
            return lastOverId.current ? [{ id: lastOverId.current }] : [];
        },
        [activeId, items]
    );
    const [clonedItems, setClonedItems] = useState<KanbanItems | null>(null);
    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 0,
            },
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                distance: 0,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter,
        })
    );
    const findContainer = (id: UniqueIdentifier) => {
        if (isColumnId(items, id)) {
            return id;
        }
        return items.find((column) => column.recordIds.includes(id))?.id;
    };
    const getIndex = (id: UniqueIdentifier) => {
        const container = findContainer(id);
        if (!container) {
            return -1;
        }
        const column = findColumnById(items, container);
        if (column == null) {
            return -1;
        }
        const index = column.recordIds.indexOf(id);
        return index;
    };
    const onDragCancel = () => {
        if (!acceptsDrag()) return;
        if (clonedItems) {
            // Reset items to their original state in case items have been
            // Dragged across containers
            setItems(clonedItems);
        }
        setActiveId(null);
        setClonedItems(null);
    };
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            recentlyMovedToNewContainer.current = false;
        });
        return () => cancelAnimationFrame(frame);
    }, [items]);
    return React.createElement(DndContext, {
        id: contextId,
        sensors: sensors,
        collisionDetection: collisionDetectionStrategy,
        measuring: {
            droppable: {
                strategy: MeasuringStrategy.Always,
            },
        },
        onDragStart: ({ active }) => {
            if (!acceptsDrag()) return;
            setActiveId(active.id);
            setClonedItems(items);
        },
        onDragOver: ({ active, over }) => {
            if (!acceptsDrag()) return;
            const overId = over?.id;
            if (overId == null || isColumnId(items, active.id)) {
                return;
            }
            const overContainer = findContainer(overId);
            const activeContainer = findContainer(active.id);
            if (!overContainer || !activeContainer) {
                return;
            }
            if (activeContainer !== overContainer) {
                setItems((items) => {
                    const activeColumn = findColumnById(items, activeContainer);
                    const overColumn = findColumnById(items, overContainer);
                    if (activeColumn == null || overColumn == null) {
                        return items;
                    }
                    const activeItems = activeColumn.recordIds;
                    const overItems = overColumn.recordIds;
                    const overIndex = overItems.indexOf(overId);
                    const activeIndex = activeItems.indexOf(active.id);
                    if (activeIndex === -1) {
                        return items;
                    }
                    let newIndex: number;
                    if (isColumnId(items, overId)) {
                        newIndex = overItems.length + 1;
                    } else {
                        const isBelowOverItem =
                            over &&
                            active.rect.current.translated &&
                            active.rect.current.translated.top >
                                over.rect.top + over.rect.height;
                        const modifier = isBelowOverItem ? 1 : 0;
                        newIndex =
                            overIndex >= 0
                                ? overIndex + modifier
                                : overItems.length + 1;
                    }
                    recentlyMovedToNewContainer.current = true;
                    return items.map((column) => {
                        if (column.id === activeContainer) {
                            return {
                                ...column,
                                recordIds: activeItems.filter(
                                    (item) => item !== active.id
                                ),
                            };
                        }
                        if (column.id === overContainer) {
                            return {
                                ...column,
                                recordIds: [
                                    ...overItems.slice(0, newIndex),
                                    activeItems[activeIndex],
                                    ...overItems.slice(newIndex),
                                ],
                            };
                        }
                        return column;
                    });
                });
            }
        },
        onDragEnd: ({ active, over }) => {
            if (!acceptsDrag()) return;
            if (isColumnId(items, active.id) && over?.id) {
                setContainers((containers) => {
                    const activeIndex = containers.indexOf(active.id);
                    const overIndex = containers.indexOf(over.id);
                    return arrayMove(containers, activeIndex, overIndex);
                });
                setActiveId(null);
                return;
            }
            const activeContainer = findContainer(active.id);
            if (!activeContainer) {
                setActiveId(null);
                return;
            }
            const overId = over?.id;
            if (overId == null) {
                setActiveId(null);
                return;
            }
            const overContainer = findContainer(overId);
            if (overContainer) {
                const activeColumn = findColumnById(items, activeContainer);
                const overColumn = findColumnById(items, overContainer);
                if (activeColumn == null || overColumn == null) {
                    setActiveId(null);
                    return;
                }
                const activeIndex = activeColumn.recordIds.indexOf(active.id);
                const overIndex = overColumn.recordIds.indexOf(overId);
                if (activeIndex === -1) {
                    setActiveId(null);
                    return;
                }
                if (activeIndex !== overIndex) {
                    setItems((items) =>
                        items.map((column) =>
                            column.id === overContainer
                                ? {
                                      ...column,
                                      recordIds: arrayMove(
                                          column.recordIds,
                                          activeIndex,
                                          overIndex
                                      ),
                                  }
                                : column
                        )
                    );
                }
                onRecordUpdate(active.id as string, overContainer);
            }
            setActiveId(null);
        },
        cancelDrop: cancelDrop,
        onDragCancel: onDragCancel,
        modifiers: modifiers,
        children: [
            React.createElement('div', {
                key: 'board',
                className: 'mx-sdk-kanban-board',
                children: React.createElement(SortableContext, {
                    items: containers,
                    strategy: vertical
                        ? verticalListSortingStrategy
                        : horizontalListSortingStrategy,
                    children: containers.map((containerId) => {
                        const column = findColumnById(items, containerId);
                        if (column == null) return null;
                        return React.createElement(DroppableContainer, {
                            key: containerId,
                            id: containerId,
                            label: column.label,
                            columns: columns,
                            items: column.recordIds,
                            scrollable: scrollable,
                            style: containerStyle,
                            unstyled: minimal,
                            children: React.createElement(SortableContext, {
                                items: column.recordIds,
                                strategy: strategy,
                                children: column.recordIds.map(
                                    (value, index) => {
                                        return React.createElement(
                                            SortableItem,
                                            {
                                                disabled:
                                                    disabled ||
                                                    isSortingContainer ||
                                                    isAnExtensionModalOpen,
                                                key: value,
                                                id: value,
                                                index: index,
                                                handle: handle,
                                                style: getItemStyles,
                                                wrapperStyle: wrapperStyle,
                                                renderItem: renderItem,
                                                containerId: containerId,
                                                getIndex: getIndex,
                                            }
                                        );
                                    }
                                ),
                            }),
                        });
                    }),
                }),
            }),
            portalTarget &&
                createPortal(
                    React.createElement('div', {
                        ...theme,
                        className: [
                            'mx-sdk-kanban',
                            theme.className,
                            overlayClassName,
                        ]
                            .filter(Boolean)
                            .join(' '),
                        children: React.createElement(DragOverlay, {
                            adjustScale: adjustScale,
                            dropAnimation: dropAnimation,
                            zIndex: 10,
                            children: activeId
                                ? containers.includes(activeId)
                                    ? renderContainerDragOverlay(activeId)
                                    : renderSortableItemDragOverlay(activeId)
                                : null,
                        }),
                    }),
                    portalTarget,
                    'kanban-overlay'
                ),
        ],
    });
    function renderSortableItemDragOverlay(id: UniqueIdentifier) {
        return React.createElement(Item, {
            value: id,
            handle: handle,
            style: getItemStyles({
                containerId: findContainer(id) as UniqueIdentifier,
                overIndex: -1,
                index: getIndex(id),
                value: id,
                isSorting: true,
                isDragging: true,
                isDragOverlay: true,
            }),
            color: getColor(id),
            wrapperStyle: wrapperStyle({ index: 0 }),
            renderItem: renderItem,
            dragOverlay: true,
        });
    }
    function renderContainerDragOverlay(containerId: UniqueIdentifier) {
        const column = findColumnById(items, containerId);
        if (column == null) return null;
        return React.createElement(Container, {
            label: column.label,
            columns: columns,
            style: {
                height: '100%',
            },
            shadow: true,
            unstyled: false,
            children: column.recordIds.map((item, index) =>
                React.createElement(Item, {
                    key: item,
                    value: item,
                    handle: handle,
                    style: getItemStyles({
                        containerId,
                        overIndex: -1,
                        index: getIndex(item),
                        value: item,
                        isDragging: false,
                        isSorting: false,
                        isDragOverlay: false,
                    }),
                    color: getColor(item),
                    wrapperStyle: wrapperStyle({ index }),
                    renderItem: renderItem,
                })
            ),
        });
    }
}
function getColor(id: UniqueIdentifier) {
    switch (String(id)[0]) {
        case 'A':
            return '#7193f1';
        case 'B':
            return '#ffda6c';
        case 'C':
            return '#00bcd4';
        case 'D':
            return '#ef769f';
    }
    return undefined;
}
interface SortableItemProps {
    containerId: UniqueIdentifier;
    id: UniqueIdentifier;
    index: number;
    handle: boolean;
    disabled?: boolean;
    style: NonNullable<Props['getItemStyles']>;
    getIndex(id: UniqueIdentifier): number;
    renderItem: RenderItemFunc;
    wrapperStyle({ index }: { index: number }): React.CSSProperties;
}
function SortableItem({
    disabled,
    id,
    index,
    handle,
    renderItem,
    style,
    containerId,
    getIndex,
    wrapperStyle,
}: SortableItemProps) {
    const {
        setNodeRef,
        setActivatorNodeRef,
        listeners,
        isDragging,
        isSorting,
        over,
        overIndex,
        transform,
        transition,
    } = useSortable({
        disabled,
        id,
    });
    const mounted = useMountStatus();
    const mountedWhileDragging = isDragging && !mounted;
    return React.createElement(Item, {
        ref: disabled ? undefined : setNodeRef,
        value: id,
        dragging: isDragging,
        sorting: isSorting,
        handle: handle,
        handleProps: handle ? { ref: setActivatorNodeRef } : undefined,
        index: index,
        wrapperStyle: wrapperStyle({ index }),
        style: style({
            index,
            value: id,
            isDragging,
            isSorting,
            isDragOverlay: false,
            overIndex: over ? getIndex(over.id) : overIndex,
            containerId,
        }),
        color: getColor(id),
        transition: transition,
        transform: transform,
        fadeIn: mountedWhileDragging,
        listeners: listeners,
        renderItem: renderItem,
    });
}
function useMountStatus() {
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        const timeout = setTimeout(() => setIsMounted(true), 500);
        return () => clearTimeout(timeout);
    }, []);
    return isMounted;
}
