import {
    createElement,
    Fragment,
    useMemo,
    useState,
    useRef,
    useEffect,
    useSyncExternalStore,
    type ReactNode,
    type ChangeEvent,
} from 'react';
import { dispatchField } from '../ui/rendererRegistry.js';
import type {
    FormRenderScope,
    FormRenderSnapshot,
} from '../ui/formRenderScope.js';
import type {
    PortalRenderScope,
    PortalRenderSnapshot,
} from '../ui/portalRenderScope.js';
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
        !snapshot.scalar ||
        snapshot.scalar.kind === 'checkbox'
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
                inputMode:
                    snapshot.scalar.kind === 'duration' ? 'text' : 'decimal',
                placeholder:
                    snapshot.scalar.kind === 'duration'
                        ? ((snapshot.field?.schema.miniExtConfig &&
                          'placeholderText' in
                              snapshot.field.schema.miniExtConfig
                              ? snapshot.field.schema.miniExtConfig
                                    .placeholderText
                              : undefined) ??
                          snapshot.scalar.durationFormat ??
                          undefined)
                        : undefined,
                value: snapshot.scalar.input,
                disabled: !snapshot.canEdit,
                'aria-invalid': !snapshot.scalar.valid,
                onFocus: () => binding.scalar?.setFocused?.(true),
                onBlur: () => binding.scalar?.setFocused?.(false),
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    binding.scalar?.setInput(event.currentTarget.value),
            })
        ),
        status(snapshot)
    );
}
/** Clock editing shares the existing scalar owner; render may replace all markup. */
export function DurationField(props: FieldProps): ReactNode {
    return createElement(NumberField, props);
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

/** Calendar-only date or explicit-offset dateTime; no browser local-time conversion. */
export function DateField({ binding, render }: FieldProps): ReactNode {
    useFieldBinding(binding);
    // Date context can change independently of a native write; observe it on rerender.
    const snapshot = binding.getSnapshot();
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        snapshot.date == null
    )
        return null;
    if (snapshot.date.retired)
        return createElement(
            'p',
            { role: 'status' },
            'Load a fresh Form before editing this date.'
        );
    const privacy = snapshot.field?.schema.miniExtConfig;
    const masked =
        privacy != null &&
        'obscurePassword' in privacy &&
        privacy.obscurePassword === true;
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement('input', {
                type: masked ? 'password' : 'text',
                value: snapshot.date.input,
                disabled: !snapshot.date.canEdit,
                'aria-invalid': !snapshot.date.valid,
                placeholder:
                    snapshot.date.kind === 'date'
                        ? 'YYYY-MM-DD'
                        : 'YYYY-MM-DDTHH:mm:ssZ',
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    binding.date?.setInput(event.currentTarget.value),
            })
        ),
        createElement(
            'p',
            { role: 'status' },
            snapshot.date.error ?? snapshot.error ?? ''
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: !snapshot.date.canEdit,
                onClick: () => binding.date?.clear(),
            },
            'Clear date'
        )
    );
}
/** Same owner/model authority; stock rendering accepts an explicit offset, not a naive local timestamp. */
export const DateTimeField = DateField;

import type {
    PortalSortEditorModel,
    PortalSortEditorSnapshot,
    PortalFilterEditorModel,
    PortalFilterEditorSnapshot,
} from '../portals/editors.js';
/** Unmount only removes a subscription; the accepted Portal owner retains prepared state. */
export function PortalSortEditor({
    model,
    render,
}: {
    model: PortalSortEditorModel;
    render(state: {
        snapshot: PortalSortEditorSnapshot;
        model: PortalSortEditorModel;
    }): ReactNode;
}): ReactNode {
    const store = useMemo(() => {
        let value = model.getSnapshot();
        return {
            getSnapshot: () => value,
            subscribe: (notify: () => void) => {
                const stop = model.subscribe((next) => {
                    value = next;
                    notify();
                });
                // A child layout effect may have changed the model after render.
                // Refresh once on subscription; getSnapshot remains reference-stable.
                value = model.getSnapshot();
                notify();
                return stop;
            },
        };
    }, [model]);
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    return render({ snapshot, model });
}
/** Custom markup uses the same explicit replacement/Apply/Clear actions as stock DOM. */
export function PortalFilterEditor({
    model,
    render,
}: {
    model: PortalFilterEditorModel;
    render(state: {
        snapshot: PortalFilterEditorSnapshot;
        model: PortalFilterEditorModel;
    }): ReactNode;
}): ReactNode {
    const store = useMemo(() => {
        let value = model.getSnapshot();
        return {
            getSnapshot: () => value,
            subscribe: (notify: () => void) => {
                const stop = model.subscribe((next) => {
                    value = next;
                    notify();
                });
                // A child layout effect may have changed the model after render.
                // Refresh once on subscription; getSnapshot remains reference-stable.
                value = model.getSnapshot();
                notify();
                return stop;
            },
        };
    }, [model]);
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    return render({ snapshot, model });
}

/** Optional React subscription; the host owns model disposal, not a renderer remount. */
export function useButtonField(
    model: import('../ui/buttonModel.js').ButtonFieldModel
): import('../ui/buttonModel.js').ButtonFieldRenderProps {
    const store = useMemo(() => {
        let snapshot = model.getSnapshot();
        let key = JSON.stringify(snapshot);
        return {
            getSnapshot: () => {
                const next = model.getSnapshot();
                const nextKey = JSON.stringify(next);
                if (nextKey !== key) {
                    snapshot = next;
                    key = nextKey;
                }
                return snapshot;
            },
            subscribe: (notify: () => void) => {
                const stop = model.subscribe((next) => {
                    snapshot = next;
                    key = JSON.stringify(next);
                    notify();
                });
                const next = model.getSnapshot();
                if (JSON.stringify(next) !== key) {
                    snapshot = next;
                    key = JSON.stringify(next);
                    notify();
                }
                return stop;
            },
        };
    }, [model]);
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    return useMemo(
        () => ({
            ...snapshot,
            prepareLink: () => model.prepareLink(snapshot.revision),
            triggerWebhook: () => model.triggerWebhook(snapshot.revision),
            cancel: () => model.cancel(snapshot.revision),
            acknowledgeNewIntent: () =>
                model.acknowledgeNewIntent(snapshot.revision),
        }),
        [model, snapshot]
    );
}

export type FieldRendererFallback =
    | Exclude<
          import('../ui/rendererRegistry.js').FieldRendererHostSnapshot,
          { status: 'ready' }
      >
    | {
          status: 'missing-renderer';
          physicalKind: import('../ui/rendererRegistry.js').FieldKind;
      };
export type FieldRendererProps = {
    host: import('../ui/rendererRegistry.js').FieldRendererHost;
    renderers: import('../ui/rendererRegistry.js').FieldRendererSlots<ReactNode>;
    fallback?(state: FieldRendererFallback): ReactNode;
};

/** Subscription only: the supplied owner retains drafts, input buffers, Files and uncertainty. */
export function useFieldRendererHost(
    host: import('../ui/rendererRegistry.js').FieldRendererHost
): import('../ui/rendererRegistry.js').FieldRendererHostSnapshot {
    const store = useMemo(() => {
        let value = host.getSnapshot();
        let key = JSON.stringify(value);
        const read = () => {
            const next = host.getSnapshot();
            const nextKey = JSON.stringify(next);
            if (nextKey !== key) {
                value = next;
                key = nextKey;
            }
            return value;
        };
        return {
            getSnapshot: read,
            subscribe: (notify: () => void) => {
                const stop = host.subscribe(() => {
                    const before = value;
                    read();
                    if (value !== before) notify();
                });
                const before = value;
                read();
                if (value !== before) notify();
                return stop;
            },
        };
    }, [host]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}

/** Named per-kind slots; no default markup, owner disposal, or automatic I/O. */
export function FieldRenderer({
    host,
    renderers,
    fallback,
}: FieldRendererProps): ReactNode {
    const snapshot = useFieldRendererHost(host);
    if (snapshot.status !== 'ready') return fallback?.(snapshot) ?? null;
    return createElement(
        Fragment,
        null,
        ...snapshot.fields.map((field) =>
            createElement(
                Fragment,
                { key: field.fieldId },
                dispatchField(
                    renderers,
                    field,
                    (missing) =>
                        fallback?.({
                            status: 'missing-renderer',
                            physicalKind: missing.physicalKind,
                        }) ?? null
                )
            )
        )
    );
}

export type AirtableFormRenderState = Omit<FormRenderSnapshot, 'fields'> & {
    fields: readonly { fieldId: string; node: ReactNode }[];
};
export type AirtableFormProps = {
    scope: FormRenderScope;
    renderers: import('../ui/rendererRegistry.js').FieldRendererSlots<ReactNode>;
    fallback?(state: FieldRendererFallback): ReactNode;
    /** Layout only; actions retain the revision that produced this render. */
    children(state: AirtableFormRenderState): ReactNode;
};

/** A subscription shell: unmount never disposes the supplied rendering scope. */
export function AirtableForm({
    scope,
    renderers,
    fallback,
    children,
}: AirtableFormProps): ReactNode {
    const store = useMemo(() => {
        let value = scope.getSnapshot();
        const read = () => {
            const next = scope.getSnapshot();
            if (next.revision !== value.revision) value = next;
            return value;
        };
        return {
            getSnapshot: read,
            subscribe: (notify: () => void) => {
                const refresh = () => {
                    const before = value;
                    read();
                    if (value !== before) notify();
                };
                const stop = scope.subscribe(refresh);
                refresh();
                return stop;
            },
        };
    }, [scope]);
    const state = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    if (state.retired) return null;
    return children({
        ...state,
        fields: state.fields.map(({ fieldId, host }) => ({
            fieldId,
            node: createElement(FieldRenderer, {
                key: fieldId,
                host,
                renderers,
                fallback: (failure) =>
                    failure.status === 'hidden' || failure.status === 'retired'
                        ? null
                        : (fallback?.(failure) ?? null),
            }),
        })),
    });
}

export type AirtablePortalRenderState = Omit<PortalRenderSnapshot, 'rows'> & {
    rows: readonly {
        recordId: string;
        cells: readonly { fieldId: string; node: ReactNode }[];
    }[];
};
export type AirtableGridProps = {
    scope: PortalRenderScope;
    renderers: import('../ui/rendererRegistry.js').FieldRendererSlots<ReactNode>;
    fallback?(state: FieldRendererFallback): ReactNode;
    /** App-owned layout; every action retains this accepted render's revision. */
    children(state: AirtablePortalRenderState): ReactNode;
};
export type AirtableListProps = AirtableGridProps;

function AirtablePortal({
    scope,
    renderers,
    fallback,
    children,
}: AirtableGridProps): ReactNode {
    const store = useMemo(() => {
        let value = scope.getSnapshot();
        const read = () => {
            const next = scope.getSnapshot();
            if (next.revision !== value.revision) value = next;
            return value;
        };
        return {
            getSnapshot: read,
            subscribe: (notify: () => void) => {
                const refresh = () => {
                    const before = value;
                    read();
                    if (value !== before) notify();
                };
                const stop = scope.subscribe(refresh);
                refresh();
                return stop;
            },
        };
    }, [scope]);
    const state = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    if (state.retired) return null;
    return children({
        ...state,
        rows: state.rows.map(({ recordId, cells }) => ({
            recordId,
            cells: cells.map(({ fieldId, host }) => ({
                fieldId,
                node: createElement(FieldRenderer, {
                    key: fieldId,
                    host,
                    renderers,
                    fallback: (failure) =>
                        failure.status === 'hidden' ||
                        failure.status === 'retired'
                            ? null
                            : (fallback?.(failure) ?? null),
                }),
            })),
        })),
    });
}

/** Grid layout shell only. Unmount never disposes the supplied scope or owner. */
export function AirtableGrid(props: AirtableGridProps): ReactNode {
    return createElement(AirtablePortal, props);
}

/** List layout shell over the same accepted records, hosts and action authority. */
export function AirtableList(props: AirtableListProps): ReactNode {
    return createElement(AirtablePortal, props);
}
