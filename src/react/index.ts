import {
    createElement,
    useMemo,
    useRef,
    useEffect,
    useSyncExternalStore,
    type ReactNode,
    type ChangeEvent,
} from 'react';
import type { FormFieldBinding, FormFieldSnapshot } from '../forms/bindings.js';
import type {
    FormAttachmentController,
    FormAttachmentSnapshot,
} from '../forms/attachmentController.js';

/** A file chooser's bubbling cancel is not cancellation of its surrounding dialog. */
export function isDialogCancellation(event: {
    target: unknown;
    currentTarget: unknown;
}): boolean {
    return event.target === event.currentTarget;
}

/** Optional shell. Picker cancellation never closes it or changes the pending queue. */
export function AttachmentDialog({
    children,
    onClose,
}: {
    children: ReactNode;
    onClose(): void;
}): ReactNode {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const node = dialog.current;
        if (node == null) return;
        node.showModal();
        return () => node.close();
    }, []);
    return createElement(
        'dialog',
        {
            ref: dialog,
            onCancel: (
                event: import('react').SyntheticEvent<HTMLDialogElement>
            ) => {
                event.preventDefault();
                if (!isDialogCancellation(event)) return;
                onClose();
            },
        },
        children,
        createElement('button', { type: 'button', onClick: onClose }, 'Close')
    );
}

export type AttachmentRenderState = FieldRenderState & {
    attachment: FormAttachmentSnapshot;
    controller: FormAttachmentController;
};
export type AttachmentFieldProps = {
    binding: FormFieldBinding;
    controller: FormAttachmentController;
    render?(state: AttachmentRenderState): ReactNode;
};

/** Unmount removes subscriptions, never the owner-held queue or uncertainty journal. */
export function AttachmentField({
    binding,
    controller,
    render,
}: AttachmentFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    const input = useRef<HTMLInputElement>(null);
    const store = useMemo(() => {
        let value = controller.getSnapshot();
        return {
            getSnapshot: () => value,
            subscribe: (notify: () => void) =>
                controller.subscribe((next) => {
                    value = next;
                    notify();
                }),
        };
    }, [controller]);
    const attachment = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    if (render) return render({ snapshot, attachment, binding, controller });
    if (snapshot.retired || attachment.retired) return null;
    const visible = snapshot.visibility.type === 'visible';
    if (!visible && attachment.files.length === 0 && !attachment.busy)
        return null;
    return createElement(
        'section',
        {
            'aria-label': visible
                ? (snapshot.field?.title ?? 'Attachments')
                : 'Pending attachment activity',
            onDragOver: (event: import('react').DragEvent<HTMLElement>) =>
                event.preventDefault(),
            onDrop: (event: import('react').DragEvent<HTMLElement>) => {
                event.preventDefault();
                controller.select(Array.from(event.dataTransfer.files));
            },
        },
        createElement('input', {
            ref: input,
            type: 'file',
            hidden: true,
            multiple: true,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
                controller.select(Array.from(event.currentTarget.files ?? []));
                // The controller owns File identities; allow selecting the same file again.
                event.currentTarget.value = '';
            },
        }),
        createElement(
            'button',
            {
                type: 'button',
                hidden: !visible,
                disabled: !snapshot.canEdit && !attachment.busy,
                onClick: () => input.current?.click(),
            },
            'Choose files'
        ),
        createElement(
            'p',
            { role: 'status', 'aria-busy': attachment.busy },
            attachment.error ??
                (attachment.busy
                    ? 'Uploading attachment'
                    : attachment.files.length > 0
                      ? 'Files selected'
                      : 'No pending files')
        ),
        createElement(
            'button',
            {
                type: 'button',
                hidden: !visible,
                disabled:
                    attachment.busy ||
                    attachment.files.length === 0 ||
                    !snapshot.canEdit,
                onClick: () => void controller.upload(),
            },
            'Upload'
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: attachment.files.length === 0,
                onClick: () => controller.clear(),
            },
            'Clear pending files'
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: !attachment.busy,
                onClick: () => controller.cancel(),
            },
            'Cancel upload'
        )
    );
}

/** Cache detached snapshots: React requires stable identity between notifications. */
export function useFieldBinding(binding: FormFieldBinding): FormFieldSnapshot {
    const store = useMemo(() => {
        let snapshot = binding.getSnapshot();
        return {
            getSnapshot: () => snapshot,
            subscribe: (notify: () => void) =>
                binding.subscribe((next) => {
                    snapshot = next;
                    notify();
                }),
        };
    }, [binding]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}
export type FieldRenderState = {
    snapshot: FormFieldSnapshot;
    binding: FormFieldBinding;
};
export type FieldProps = {
    binding: FormFieldBinding;
    render?(state: FieldRenderState): ReactNode;
};
const status = (snapshot: FormFieldSnapshot) =>
    createElement(
        'p',
        { role: 'status', 'aria-busy': snapshot.pending },
        snapshot.scalar?.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n')
    );
export function TextField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const obscure = snapshot.field?.schema.miniExtConfig;
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement('input', {
                type:
                    obscure &&
                    'obscurePassword' in obscure &&
                    obscure.obscurePassword === true
                        ? 'password'
                        : 'text',
                value: typeof snapshot.value === 'string' ? snapshot.value : '',
                disabled: !snapshot.canEdit,
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    binding.setValue(event.currentTarget.value || null),
            })
        ),
        status(snapshot)
    );
}
/** Numeric input uses native units, including fractional percent values. */
export function NumberField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        snapshot.scalar?.kind !== 'number'
    )
        return null;
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement('input', {
                type: 'text',
                inputMode: 'decimal',
                value: snapshot.scalar.input,
                disabled: !snapshot.canEdit,
                'aria-invalid': !snapshot.scalar.valid,
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    binding.scalar?.setInput(event.currentTarget.value),
            })
        ),
        status(snapshot)
    );
}
export function CheckboxField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        snapshot.scalar?.kind !== 'checkbox'
    )
        return null;
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement('input', {
                type: 'checkbox',
                checked: snapshot.scalar.checked,
                disabled: !snapshot.canEdit,
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    binding.scalar?.setChecked(event.currentTarget.checked),
            })
        ),
        status(snapshot)
    );
}

export function SelectField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        !snapshot.selection
    )
        return null;
    const state = snapshot.selection;
    const options = new Map(
        [...state.selectedOptions, ...state.options].map((option) => [
            option.value,
            option,
        ])
    );
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement(
                'select',
                {
                    multiple: state.multiple,
                    value: state.multiple
                        ? [...state.value]
                        : (state.value[0] ?? ''),
                    disabled: !snapshot.canEdit,
                    onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                        binding.selection?.choose(
                            Array.from(
                                event.currentTarget.selectedOptions,
                                (option) => option.value
                            ).filter((value) => value !== '')
                        ),
                },
                !state.multiple
                    ? createElement('option', { value: '' }, 'None')
                    : null,
                [...options.values()].map((option) =>
                    createElement(
                        'option',
                        {
                            key: option.value,
                            value: option.value,
                            disabled: option.disabled,
                        },
                        option.label
                    )
                )
            )
        ),
        status(snapshot)
    );
}
export function LinkedField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        !snapshot.selection
    )
        return null;
    const state = snapshot.selection;
    const options = new Map(
        [...state.selectedOptions, ...state.options].map((option) => [
            option.value,
            option,
        ])
    );
    return createElement(
        'fieldset',
        { disabled: !snapshot.canEdit },
        createElement('legend', null, snapshot.field?.title),
        createElement(
            'label',
            null,
            'Search linked records',
            createElement('input', {
                value: state.searchTerm,
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    if (binding.getSnapshot().canEdit)
                        binding.selection?.setSearchInput(
                            event.currentTarget.value
                        );
                },
            })
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: state.loading,
                onClick: () => {
                    if (binding.getSnapshot().canEdit)
                        void binding.selection?.reload();
                },
            },
            'Search'
        ),
        [...options.values()].map((option) =>
            createElement(
                'label',
                { key: option.value },
                createElement('input', {
                    type: 'checkbox',
                    checked: state.value.includes(option.value),
                    disabled: option.disabled,
                    onChange: () => binding.selection?.toggle(option.value),
                }),
                option.label
            )
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: state.loading || state.offset === null,
                onClick: () => {
                    if (binding.getSnapshot().canEdit)
                        void binding.selection?.loadMore();
                },
            },
            'More'
        ),
        status(snapshot)
    );
}
