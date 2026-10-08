import {
    createElement,
    useMemo,
    useState,
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
        visible
            ? createElement(
                  'ul',
                  null,
                  ...attachment.rows.map((row) =>
                      createElement(
                          'li',
                          { key: row.nativeIndex },
                          createElement('span', null, row.label),
                          createElement(
                              'button',
                              {
                                  type: 'button',
                                  disabled: !row.removeAllowed,
                                  onClick: () =>
                                      controller.remove(
                                          attachment.valuesRevision,
                                          row.nativeIndex
                                      ),
                              },
                              'Remove attachment'
                          )
                      )
                  )
              )
            : null,
        visible && attachment.presentation === 'unavailable'
            ? createElement('p', null, 'Attachment presentation unavailable')
            : null,
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
    // Renderer-local text is not native data; replacement owners get a fresh input.
    const [intent, setIntent] = useState({ binding, name: '' });
    const name = intent.binding === binding ? intent.name : '';
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
        snapshot.choiceCreation != null
            ? createElement(
                  'div',
                  null,
                  createElement(
                      'label',
                      null,
                      'New choice name',
                      createElement('input', {
                          value: name,
                          disabled: !snapshot.choiceCreation.canCreate,
                          onChange: (event: ChangeEvent<HTMLInputElement>) =>
                              setIntent({
                                  binding,
                                  name: event.currentTarget.value,
                              }),
                      })
                  ),
                  createElement(
                      'button',
                      {
                          type: 'button',
                          disabled:
                              !snapshot.choiceCreation.canCreate ||
                              name.trim() === '',
                          onClick: () => {
                              const captured = name;
                              void binding.choiceCreation
                                  ?.create(captured)
                                  .then((accepted) => {
                                      if (accepted)
                                          setIntent((now) =>
                                              now.binding === binding &&
                                              now.name === captured
                                                  ? { binding, name: '' }
                                                  : now
                                          );
                                  });
                          },
                      },
                      'Create choice'
                  ),
                  createElement(
                      'button',
                      {
                          type: 'button',
                          disabled: !snapshot.choiceCreation.busy,
                          onClick: () => binding.choiceCreation?.cancel(),
                      },
                      'Cancel choice creation'
                  ),
                  createElement(
                      'p',
                      {
                          role: 'status',
                          'aria-busy': snapshot.choiceCreation.busy,
                      },
                      snapshot.choiceCreation.error ??
                          (snapshot.choiceCreation.phase === 'created-selected'
                              ? 'Choice created and selected in the draft. Save to update the record.'
                              : snapshot.choiceCreation.phase ===
                                  'created-not-selected'
                                ? 'Choice created but not currently selectable. The record has not been saved.'
                                : snapshot.choiceCreation.busy
                                  ? 'Creating choice…'
                                  : '')
                  )
              )
            : null,
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

/** Optional subscription bridge. Mount/StrictMode/remount never reads. */
export function usePortalListOwner(
    owner: import('../portals/listOwner.js').PortalListOwner
): import('../portals/listOwner.js').PortalListSnapshot {
    const store = useMemo(() => {
        let snapshot = owner.getSnapshot();
        return {
            getSnapshot: () => {
                // Observe session/configuration retirement on same-owner rerenders.
                // Cache by revision so useSyncExternalStore retains stable identity.
                const next = owner.getSnapshot();
                if (next.revision !== snapshot.revision) snapshot = next;
                return snapshot;
            },
            subscribe: (notify: () => void) =>
                owner.subscribe((next) => {
                    snapshot = next;
                    notify();
                }),
        };
    }, [owner]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}
export type PortalListProps = {
    owner: import('../portals/listOwner.js').PortalListOwner;
    readOptions: import('../portals/types.js').PortalReadOptions;
    render?(state: {
        snapshot: import('../portals/listOwner.js').PortalListSnapshot;
        owner: import('../portals/listOwner.js').PortalListOwner;
    }): ReactNode;
};
/** Safe default list shell: app renderers own privacy-aware cell presentation, not state. */
export function PortalList({
    owner,
    readOptions,
    render,
}: PortalListProps): ReactNode {
    const snapshot = usePortalListOwner(owner);
    if (render) return render({ snapshot, owner });
    if (snapshot.phase === 'retired') return null;
    return createElement(
        'section',
        { 'aria-label': 'Portal records' },
        createElement(
            'p',
            { role: 'status', 'aria-busy': snapshot.pending },
            snapshot.error ??
                (snapshot.phase === 'empty'
                    ? 'No records returned.'
                    : snapshot.phase === 'cleanup'
                      ? 'The server proposed criteria cleanup. Inspect replacements before acceptance.'
                      : snapshot.pending
                        ? 'Loading records…'
                        : '')
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: snapshot.pending || snapshot.phase === 'cleanup',
                onClick: () => {
                    void owner.readFirst(snapshot.revision, readOptions);
                },
            },
            'Load records'
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: snapshot.pending || !snapshot.hasNext,
                onClick: () => {
                    void owner.readNext(snapshot.revision, readOptions);
                },
            },
            'Next page'
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: !snapshot.pending,
                onClick: () => owner.cancel(snapshot.revision),
            },
            'Cancel read'
        ),
        createElement(
            'ol',
            null,
            ...(snapshot.page?.recordIds ?? []).map((id, index) =>
                createElement('li', { key: id }, `Record ${index + 1}`)
            )
        )
    );
}
