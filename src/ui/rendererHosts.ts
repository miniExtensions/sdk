import {
    normalizeFormLeaseLoaded,
    normalizeFormLeaseField,
} from './formLease.js';
import { createFormLinkedRendererBridge } from './formLinkedRenderer.js';
import type {
    FormFieldBindings,
    FormFieldBinding,
    FormFieldSnapshot,
    FieldActionResult,
} from '../forms/bindings.js';
import type {
    AttachmentRecovery,
    FormAttachmentController,
} from '../forms/attachmentController.js';
import {
    readPortalCellBindingContext,
    type PortalCellBinding,
} from '../portals/cell.js';
import {
    readPortalListOwnerContext,
    type PortalListOwner,
} from '../portals/listOwner.js';
import {
    capturePortalMetadata,
    getPortalLinkedRecordFieldConfig,
} from '../portals/helpers.js';
import type {
    MiniExtensionsClient,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import {
    createFormButtonFieldModel,
    createPortalButtonFieldModel,
    type FormButtonFieldModelOptions,
} from './buttonHosts.js';
import type { ButtonFieldModel, ButtonFieldRecovery } from './buttonModel.js';
import {
    createRendererProps,
    type FieldRendererHost,
    type FieldRendererHostSnapshot,
    type RendererPropsInput,
} from './rendererRegistry.js';

type LeaseOptions = {
    isCurrent(): boolean;
    configurationRevision(): string | number;
};
export type FormFieldRendererHostOptions = LeaseOptions & {
    fields: FormFieldBindings;
    fieldId: string;
    button?: Omit<
        FormButtonFieldModelOptions,
        'fields' | 'fieldId' | 'isCurrent' | 'configurationRevision'
    >;
    attachmentRecovery?: AttachmentRecovery;
};
export type PortalCellRendererHostOptions = LeaseOptions & {
    cell: PortalCellBinding;
    owner: PortalListOwner;
    client: MiniExtensionsClient;
    recordId: string;
    fieldId: string;
};
export type PortalDetailRendererHostOptions = LeaseOptions & {
    owner: PortalListOwner;
    client: MiniExtensionsClient;
    recordId: string;
    context?: 'portal-detail' | 'linked-detail';
    buttonRecovery?: ButtonFieldRecovery;
};
// Presence-aware fingerprints distinguish omitted keys from explicit undefined.
const fingerprint = (value: unknown): string => {
    const ancestors = new Set<object>();
    const encode = (v: unknown): unknown => {
        if (v === undefined) return ['undefined'];
        if (v === null) return ['null'];
        if (
            typeof v === 'string' ||
            typeof v === 'boolean' ||
            (typeof v === 'number' && Number.isFinite(v))
        )
            return [typeof v, v];
        if (typeof v !== 'object' || ancestors.has(v))
            throw new Error('Unavailable configuration.');
        if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
            throw new Error('Unavailable configuration.');
        ancestors.add(v);
        try {
            return Array.isArray(v)
                ? [
                      'array',
                      Array.from(v, (item, index) =>
                          Object.hasOwn(v, index) ? encode(item) : ['missing']
                      ),
                  ]
                : [
                      'object',
                      Object.keys(v)
                          .sort()
                          .map((k) => [
                              k,
                              encode((v as Record<string, unknown>)[k]),
                          ]),
                  ];
        } finally {
            ancestors.delete(v);
        }
    };
    return JSON.stringify(encode(value));
};
const emptyValue = (kind: string, value: unknown): boolean => {
    if (value == null || (typeof value === 'string' && value.trim() === ''))
        return true;
    if (Array.isArray(value))
        return value.length === 0 || value.every((item) => item == null);
    if (kind === 'checkbox') return value === false;
    if (kind === 'rating') return value === 0;
    if (kind === 'barcode' && typeof value === 'object')
        return emptyValue('singleLineText', (value as { text?: unknown }).text);
    if (kind === 'button' && typeof value === 'object')
        return emptyValue('singleLineText', (value as { url?: unknown }).url);
    return false;
};
const staticConfigAllows = (config: unknown): boolean => {
    if (config == null) return true;
    if (typeof config !== 'object' || Array.isArray(config)) return false;
    const c = config as Record<string, unknown>;
    if (c.readOnly === true) return false;
    if (c.conditionalFields != null) {
        if (typeof c.conditionalFields !== 'object') return false;
        const conditions = (c.conditionalFields as { conditions?: unknown })
            .conditions;
        if (!Array.isArray(conditions) || conditions.length !== 0) return false;
    }
    if (
        c.conditionsForOptions != null &&
        (!Array.isArray(c.conditionsForOptions) ||
            c.conditionsForOptions.length !== 0)
    )
        return false;
    return (
        c.filterLinkedRecordsConditionFields == null ||
        c.filterLinkedRecordsToggle === false
    );
};
const refusal = (): FieldActionResult => ({
    accepted: false,
    reason: 'retired',
});
const unavailable = (): FieldRendererHostSnapshot => ({
    status: 'unavailable',
    reason: 'Field presentation is unavailable.',
});
function subscribeTo(
    listener: () => void,
    sources: ((listener: () => void) => () => void)[]
): (() => void)[] {
    const stops: (() => void)[] = [];
    try {
        for (const source of sources) stops.push(source(listener));
        return stops;
    } catch (error) {
        while (stops.length) {
            try {
                stops.pop()!();
            } catch {}
        }
        throw error;
    }
}
function host(
    options: LeaseOptions,
    authority: () => unknown | null,
    read: (current: () => boolean) => FieldRendererHostSnapshot,
    subscribe: (listener: () => void, current: () => boolean) => (() => void)[],
    disposeOwned: () => void = () => {}
): FieldRendererHost {
    let disposed = false,
        retired = false;
    const revision = options.configurationRevision();
    let accepted: unknown | null = null;
    let key = '';
    try {
        accepted = authority();
        key = fingerprint(accepted);
    } catch {
        accepted = null;
    }
    const current = () => {
        if (disposed || retired) return false;
        try {
            const now = authority();
            if (
                !options.isCurrent() ||
                options.configurationRevision() !== revision ||
                now === null ||
                fingerprint(now) !== key
            )
                retired = true;
        } catch {
            retired = true;
        }
        return !disposed && !retired;
    };
    const snapshot = (): FieldRendererHostSnapshot => {
        if (accepted === null && !disposed && !retired) return unavailable();
        if (!current())
            return {
                status: 'retired',
                reason: 'The accepted field context changed.',
            };
        try {
            return read(current);
        } catch {
            return unavailable();
        }
    };
    const listeners = new Set<(s: FieldRendererHostSnapshot) => void>();
    const emit = () => {
        for (const listener of [...listeners])
            if (listeners.has(listener)) {
                const next = snapshot();
                try {
                    listener(next);
                } catch {}
            }
    };
    let stops: (() => void)[];
    try {
        stops = subscribe(emit, current);
    } catch (error) {
        disposeOwned();
        throw error;
    }
    return {
        getSnapshot: snapshot,
        subscribe(listener) {
            listeners.add(listener);
            try {
                listener(snapshot());
            } catch {}
            return () => listeners.delete(listener);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            stops.forEach((stop) => stop());
            listeners.clear();
            disposeOwned();
        },
    };
}
function capability(
    binding: FormFieldBinding,
    state: FormFieldSnapshot,
    current: () => boolean,
    attachment?: FormAttachmentController,
    button?: ButtonFieldModel,
    editAllowed: () => boolean = () => true
): RendererPropsInput['capability'] {
    if (button) {
        const props = button.getRenderProps();
        return {
            type: 'button',
            button: {
                ...props,
                prepareLink: () => (current() ? props.prepareLink() : null),
                triggerWebhook: () =>
                    current()
                        ? props.triggerWebhook()
                        : Promise.resolve({
                              type: 'refused',
                              reason: 'retired',
                          }),
                cancel: () => current() && props.cancel(),
                acknowledgeNewIntent: () =>
                    current() && props.acknowledgeNewIntent(),
            },
        };
    }
    if (
        state.readOnly ||
        state.field?.isComputed ||
        state.field?.fieldType === 'button'
    )
        return { type: 'readonly' };
    const editable = () =>
        current() &&
        editAllowed() &&
        binding.getSnapshot().canEdit &&
        current();
    const scalar = binding.scalar,
        date = binding.date,
        selection = binding.selection,
        choice = binding.choiceCreation;
    const result: RendererPropsInput['capability'] = {
        type: 'editable',
        setValue: (value) => {
            if (!editable()) return refusal();
            const props = createRendererProps({
                ...base(state, 'form'),
                value,
                capability: { type: 'readonly' },
            });
            return value === undefined || !props
                ? { accepted: false, reason: 'invalid-value' }
                : binding.setValue(value);
        },
    };
    if (scalar) {
        const scalarState = scalar.getState();
        const actions = {
            setInput: (input: string) => editable() && scalar.setInput(input),
            setChecked: (value: boolean) =>
                editable() && scalar.setChecked(value),
        };
        result.scalar =
            scalarState.kind === 'duration' && scalar.setFocused
                ? {
                      ...actions,
                      state: structuredClone(scalarState),
                      setFocused: (value: boolean) =>
                          editable() && scalar.setFocused!(value),
                  }
                : { ...actions, state: structuredClone(scalarState) };
    }
    if (date)
        result.date = {
            state: structuredClone(date.getState()),
            setInput: (input) => editable() && date.setInput(input),
            clear: () => editable() && date.clear(),
        };
    if (selection)
        result.selection = {
            state: structuredClone(selection.getState()),
            choose: (values) => {
                if (editable()) selection.choose(values);
            },
            toggle: (value) => {
                if (editable()) selection.toggle(value);
            },
            clear: () => {
                if (editable()) selection.clear();
            },
            setSearchInput: (input) => {
                if (editable()) selection.setSearchInput(input);
            },
            reload: () => (editable() ? selection.reload() : Promise.resolve()),
            loadMore: () =>
                editable() ? selection.loadMore() : Promise.resolve(),
            cancel: () => {
                if (current()) selection.cancel();
            },
        };
    if (attachment) {
        const queueEditable = () => {
            if (!current() || !editAllowed()) return false;
            const now = binding.getSnapshot();
            return (
                !now.retired &&
                !now.readOnly &&
                !now.field?.isComputed &&
                now.visibility.type === 'visible' &&
                current()
            );
        };
        const captured = attachment.getSnapshot();
        result.attachment = {
            state: {
                ...captured,
                rows: structuredClone(captured.rows),
                files: [...captured.files],
            },
            select: (files) => queueEditable() && attachment.select(files),
            clear: () => {
                if (current()) attachment.clear();
            },
            remove: (index) =>
                editable() && attachment.remove(captured.valuesRevision, index),
            upload: () =>
                editable() ? attachment.upload() : Promise.resolve(false),
            cancel: () => {
                if (current()) attachment.cancel();
            },
        };
    }
    if (choice)
        result.choice = {
            state: structuredClone(choice.getSnapshot()),
            create: (name) =>
                editable() ? choice.create(name) : Promise.resolve(false),
            cancel: () => {
                if (current()) choice.cancel();
            },
        };
    return result;
}
function base(
    state: FormFieldSnapshot,
    context: RendererPropsInput['context']
): RendererPropsInput {
    const field = state.field!;
    return {
        physicalKind: field.fieldType,
        fieldId: field.fieldId,
        title: field.title,
        field: field.schema.airtableField,
        displayConfig: field.schema.miniExtConfig,
        writeConfig: field.schema.miniExtConfig,
        value: state.value,
        context,
        computed:
            field.isComputed || field.schema.airtableField.isComputed === true,
        dirty: state.dirty,
        pending: state.pending,
        validation: structuredClone(state.validation),
        error: state.error,
        capability: { type: 'readonly' },
    };
}
function bindingSnapshot(
    binding: FormFieldBinding,
    context: RendererPropsInput['context'],
    current: () => boolean,
    attachment?: FormAttachmentController,
    button?: ButtonFieldModel,
    decorate?: (input: RendererPropsInput) => RendererPropsInput,
    editAllowed?: () => boolean
): FieldRendererHostSnapshot {
    const state = binding.getSnapshot();
    if (state.retired)
        return {
            status: 'retired',
            reason: 'The accepted field context changed.',
        };
    if (state.visibility.type !== 'visible')
        return {
            status: state.visibility.type === 'hidden' ? 'hidden' : 'blocked',
            reason: 'Field presentation is unavailable.',
        };
    if (!state.field) return unavailable();
    const input = {
        ...base(state, context),
        capability: capability(
            binding,
            state,
            current,
            attachment,
            button,
            editAllowed
        ),
    };
    const props = createRendererProps(decorate ? decorate(input) : input);
    return props ? { status: 'ready', fields: [props] } : unavailable();
}
export function createFormFieldRendererHost(
    options: FormFieldRendererHostOptions
): FieldRendererHost {
    const binding = options.fields.field(options.fieldId);
    const authority = () => {
        const state = options.fields.controller.getState(),
            snapshot = binding.getSnapshot();
        return snapshot.retired || !snapshot.field || state.draft === null
            ? null
            : [
                  state.epoch,
                  state.contextRevision,
                  state.ownerScope,
                  normalizeFormLeaseLoaded(options.fields.getLoaded()),
                  normalizeFormLeaseField(snapshot.field),
              ];
    };
    let attachment: FormAttachmentController | undefined,
        button: ButtonFieldModel | undefined;
    const linked =
        binding.getSnapshot().field?.fieldType === 'multipleRecordLinks'
            ? createFormLinkedRendererBridge(options.fields, options.fieldId)
            : undefined;
    if (
        binding.getSnapshot().field?.fieldType === 'multipleAttachments' &&
        options.attachmentRecovery
    )
        attachment = options.fields.attachment(
            options.fieldId,
            options.attachmentRecovery
        );
    if (binding.getSnapshot().field?.fieldType === 'button' && options.button)
        button = createFormButtonFieldModel({
            ...options.button,
            fields: options.fields,
            fieldId: options.fieldId,
            isCurrent: options.isCurrent,
            configurationRevision: options.configurationRevision,
        });
    return host(
        options,
        authority,
        (current) =>
            bindingSnapshot(
                binding,
                'form',
                current,
                attachment,
                button,
                linked
                    ? (input) => ({
                          ...input,
                          linkedRecords: linked.getProps(),
                      })
                    : undefined
            ),
        (listener, current) =>
            subscribeTo(listener, [
                ...(linked
                    ? [
                          (notify: () => void) =>
                              linked.subscribe(notify, current),
                      ]
                    : []),
                ...[binding, options.fields.controller].map(
                    (source) => (notify: () => void) =>
                        source.subscribe(() => {
                            linked?.refresh();
                            notify();
                        })
                ),
                ...(attachment
                    ? [(notify: () => void) => attachment.subscribe(notify)]
                    : []),
                ...(button
                    ? [(notify: () => void) => button.subscribe(notify)]
                    : []),
            ]),
        () => {
            linked?.dispose();
            button?.dispose();
        }
    );
}
function portalContext(
    options: Pick<
        PortalDetailRendererHostOptions,
        'owner' | 'client' | 'recordId'
    >,
    revision: number
) {
    const portal = readPortalListOwnerContext(
            options.owner,
            revision,
            options.client
        ),
        state = options.owner.getSnapshot();
    if (
        !portal ||
        state.revision !== revision ||
        !state.page ||
        !state.criteria ||
        !state.portalFieldId ||
        state.pending
    )
        return null;
    const outer = portal.payload.fieldIdsToSchemas[state.portalFieldId];
    if (
        portal.payload.fieldIdsInPortal.filter(
            (id) => id === state.portalFieldId
        ).length !== 1 ||
        !outer ||
        outer.airtableField.id !== state.portalFieldId ||
        outer.fieldType !== outer.airtableField.config.type
    )
        return null;
    const link = getPortalLinkedRecordFieldConfig(outer.airtableField);
    if (!link) return null;
    const table =
        state.page.tableIdsToLinkedTableStates[link.options.linkedTableId];
    if (
        !table ||
        state.page.recordIds.filter((id) => id === options.recordId).length !==
            1 ||
        Object.values(state.page.tableIdsToLinkedTableStates).filter((t) =>
            Object.hasOwn(t.recordIdsToAirtableRecords, options.recordId)
        ).length !== 1
    )
        return null;
    const row = table.recordIdsToAirtableRecords[options.recordId];
    if (!row || row.id !== options.recordId) return null;
    return { portal, state, table, row };
}
function detailSchema(
    context: NonNullable<ReturnType<typeof portalContext>>,
    fieldId: string
) {
    const details = context.state.page!.detailFields.filter(
        (d) => d.fieldId === fieldId
    );
    if (details.length !== 1) return null;
    const detail = details[0];
    const matches = context.table.airtableFields.filter(
        (f) => f.id === fieldId
    );
    if (
        matches.length !== 1 ||
        Object.values(context.state.page!.tableIdsToLinkedTableStates).flatMap(
            (t) => t.airtableFields.filter((f) => f.id === fieldId)
        ).length !== 1
    )
        return null;
    const field = matches[0],
        child = detail.childFormField;
    if (
        child &&
        (child.idOrName.type !== 'id' ||
            child.idOrName.id !== fieldId ||
            child.config.type !== field.config.type)
    )
        return null;
    const writeConfig = child ? child.config.config : detail.miniExtConfig;
    const writeConfigPresent = child
        ? Object.hasOwn(child.config, 'config')
        : Object.hasOwn(detail, 'miniExtConfig');
    return { detail, field, writeConfig, writeConfigPresent };
}
export function createPortalDetailRendererHost(
    options: PortalDetailRendererHostOptions
): FieldRendererHost {
    const revision = options.owner.getSnapshot().revision;
    const authority = () => portalContext(options, revision);
    let accepted: ReturnType<typeof authority> = null;
    try {
        accepted = authority();
        fingerprint(accepted);
    } catch {
        accepted = null;
    }
    const buttons = new Map<string, ButtonFieldModel>();
    if (accepted && options.buttonRecovery)
        for (const detail of accepted.state.page!.detailFields) {
            const data = detailSchema(accepted, detail.fieldId);
            if (data && !detail.isHidden && data.field.config.type === 'button')
                buttons.set(
                    detail.fieldId,
                    createPortalButtonFieldModel({
                        owner: options.owner,
                        client: options.client,
                        portal: accepted.portal,
                        recordId: options.recordId,
                        fieldId: detail.fieldId,
                        recovery: options.buttonRecovery,
                        isCurrent: options.isCurrent,
                        configurationRevision: options.configurationRevision,
                    })
                );
        }
    return host(
        options,
        authority,
        (current) => {
            const context = authority();
            if (!context) return unavailable();
            const fields = [];
            const seen = new Set<string>();
            for (const detail of context.state.page!.detailFields) {
                if (seen.has(detail.fieldId)) return unavailable();
                seen.add(detail.fieldId);
                if (detail.isHidden) continue;
                if (
                    !context.table.airtableFields.some(
                        (f) => f.id === detail.fieldId
                    )
                )
                    continue;
                const data = detailSchema(context, detail.fieldId);
                if (!data) return unavailable();
                const button = buttons.get(detail.fieldId),
                    buttonProps = button?.getRenderProps();
                const props = createRendererProps({
                    physicalKind: data.field.config.type,
                    fieldId: detail.fieldId,
                    title: detail.titleOverride ?? detail.fieldName,
                    field: data.field,
                    displayConfig: detail.miniExtConfig,
                    writeConfig: data.writeConfig,
                    value: context.row.fields[detail.fieldId],
                    context: options.context ?? 'portal-detail',
                    computed: data.field.isComputed === true,
                    dirty: false,
                    pending: buttonProps?.busy ?? false,
                    validation: [],
                    error: null,
                    capability: buttonProps
                        ? {
                              type: 'button',
                              button: {
                                  ...buttonProps,
                                  prepareLink: () =>
                                      current()
                                          ? buttonProps.prepareLink()
                                          : null,
                                  triggerWebhook: () =>
                                      current()
                                          ? buttonProps.triggerWebhook()
                                          : Promise.resolve({
                                                type: 'refused',
                                                reason: 'retired',
                                            }),
                                  cancel: () =>
                                      current() && buttonProps.cancel(),
                                  acknowledgeNewIntent: () =>
                                      current() &&
                                      buttonProps.acknowledgeNewIntent(),
                              },
                          }
                        : { type: 'readonly' },
                });
                if (!props) return unavailable();
                fields.push(props);
            }
            return { status: 'ready', fields };
        },
        (listener) =>
            subscribeTo(listener, [
                (notify) => options.owner.subscribe(notify),
                ...[...buttons.values()].map(
                    (button) => (notify: () => void) => button.subscribe(notify)
                ),
            ]),
        () => buttons.forEach((button) => button.dispose())
    );
}
export function createPortalCellRendererHost(
    options: PortalCellRendererHostOptions
): FieldRendererHost {
    const revision = options.owner.getSnapshot().revision;
    const authority = () => {
        const context = portalContext(options, revision),
            cell = readPortalCellBindingContext(options.cell, options.client);
        if (!context || !cell) return null;
        const data = detailSchema(context, options.fieldId),
            input = cell.input;
        if (
            !data ||
            data.detail.isHidden ||
            input.recordId !== options.recordId ||
            input.recordFieldId !== options.fieldId ||
            input.portalFieldId !== context.state.portalFieldId ||
            input.portalExtensionAccessToken !==
                context.portal.payload.extensionAccessToken ||
            input.selectedCustomViewId !==
                context.state.criteria!.selectedCustomViewId ||
            fingerprint(cell.schema.airtableField) !==
                fingerprint(data.field) ||
            Object.hasOwn(cell.schema, 'miniExtConfig') !==
                data.writeConfigPresent ||
            fingerprint(cell.schema.miniExtConfig) !==
                fingerprint(data.writeConfig)
        )
            return null;
        return { context, cell, data };
    };
    const canEditDisplay = () => {
        const accepted = authority();
        if (!accepted) return false;
        // Canonical inline writes carry only scalar or string-array values.
        // Object-valued native fields require the accepted child Form.
        if (
            [
                'barcode',
                'singleCollaborator',
                'multipleCollaborators',
                'multipleAttachments',
            ].includes(accepted.cell.schema.fieldType)
        )
            return false;
        const config = accepted.data.detail.miniExtConfig;
        const metadata = capturePortalMetadata(
            accepted.context.portal,
            accepted.context.state.portalFieldId!,
            accepted.context.state.criteria!.selectedCustomViewId
        );
        return (
            metadata.viewAllowsEditing &&
            (accepted.context.state.page!.layoutSettings.layout ?? 'grid') ===
                'grid' &&
            accepted.context.state.page!.layoutSettings.disableInlineEdit !==
                true &&
            staticConfigAllows(config) &&
            staticConfigAllows(accepted.data.writeConfig) &&
            !(
                config != null &&
                'hideFieldIfEmpty' in config &&
                config.hideFieldIfEmpty === true &&
                emptyValue(
                    accepted.cell.schema.fieldType,
                    options.cell.binding.getSnapshot().value
                )
            )
        );
    };
    return host(
        options,
        authority,
        (current) =>
            bindingSnapshot(
                options.cell.binding,
                'portal-cell',
                current,
                undefined,
                undefined,
                (input) => {
                    const data = authority()!.data;
                    const display = data.detail.miniExtConfig;
                    const blocked = !canEditDisplay();
                    return {
                        ...input,
                        title:
                            data.detail.titleOverride ?? data.detail.fieldName,
                        displayConfig: display,
                        writeConfig: data.writeConfig,
                        capability: blocked
                            ? { type: 'readonly' }
                            : input.capability,
                    };
                },
                canEditDisplay
            ),
        (listener) =>
            subscribeTo(listener, [
                (notify) => options.cell.binding.subscribe(notify),
                (notify) => options.owner.subscribe(notify),
            ])
    );
}
