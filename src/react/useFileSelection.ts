import {
    useEffect,
    useRef,
    useState,
    type ChangeEventHandler,
    type DragEventHandler,
} from 'react';

export type FileSelectionOptions = {
    /** Receives the original File objects in selection order. The caller owns validation and uploads. */
    onFiles(files: File[]): void;
    disabled?: boolean;
};

/** Shared native picker/drop intake; no queue, storage, network or persistence owner. */
export function useFileSelection<T extends HTMLElement = HTMLElement>({
    onFiles,
    disabled = false,
}: FileSelectionOptions) {
    const [dragActive, setDragActive] = useState(false);
    const depth = useRef(0);
    useEffect(() => {
        if (disabled) {
            depth.current = 0;
            setDragActive(false);
        }
    }, [disabled]);
    const contain: DragEventHandler<T> = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const reset = () => {
        depth.current = 0;
        setDragActive(false);
    };
    const onChange: ChangeEventHandler<HTMLInputElement> = (event) => {
        // Snapshot before resetting: FileList is owned by the native input.
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (!disabled && files.length > 0) onFiles(files);
    };
    const onDragEnter: DragEventHandler<T> = (event) => {
        contain(event);
        if (disabled) return;
        depth.current++;
        setDragActive(true);
    };
    const onDragLeave: DragEventHandler<T> = (event) => {
        contain(event);
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragActive(false);
    };
    const onDragOver: DragEventHandler<T> = (event) => {
        contain(event);
        if (!disabled) setDragActive(true);
    };
    const onDragEnd: DragEventHandler<T> = (event) => {
        contain(event);
        reset();
    };
    const onDrop: DragEventHandler<T> = (event) => {
        contain(event);
        reset();
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onFiles(files);
    };
    return {
        isDragActive: !disabled && dragActive,
        inputProps: { type: 'file' as const, disabled, onChange },
        dropProps: {
            onDrag: contain,
            onDragStart: contain,
            onDragEnter,
            onDragOver,
            onDragLeave,
            onDragEnd,
            onDrop,
        },
    };
}
