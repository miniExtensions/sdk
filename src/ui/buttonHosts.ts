import { normalizeFormLeaseLoaded } from './formLease.js';
import type { FormFieldBindings } from '../forms/bindings.js';
import {
    readPortalListOwnerContext,
    type PortalListOwner,
} from '../portals/listOwner.js';
import { getPortalLinkedRecordFieldConfig } from '../portals/helpers.js';
import type {
    MiniExtensionsClient,
    PortalLoadedResult,
    ConfiguredButtonWebhookSource,
} from '../runtime/types.js';
import type {
    AirtableButtonField,
    AirtableButtonValue,
    ButtonMiniExtConfig,
} from '../runtime/rendererTypes.js';
import {
    createButtonFieldModel,
    type ButtonFieldRecovery,
    type ButtonFieldData,
} from './buttonModel.js';

export type AcceptedButtonLinkedContext = {
    owner: PortalListOwner;
    portal: PortalLoadedResult;
    revision: number;
    recordId: string;
};
type Lease = {
    client: MiniExtensionsClient;
    isCurrent(): boolean;
    configurationRevision(): string | number;
    recovery: ButtonFieldRecovery;
};
export type FormButtonFieldModelOptions = Lease & {
    fields: FormFieldBindings;
    fieldId: string;
    /** Accepted list ownership, never an arbitrary webhook source override. */
    acceptedLinkedContext?: AcceptedButtonLinkedContext;
};
export type PortalButtonFieldModelOptions = Lease & {
    owner: PortalListOwner;
    portal: PortalLoadedResult;
    recordId: string;
    fieldId: string;
};
const key = (value: unknown) => JSON.stringify(value);
const buttonValue = (value: unknown): AirtableButtonValue | null => {
    if (value == null) return null;
    if (
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('url' in value) ||
        typeof value.url !== 'string' ||
        !('label' in value) ||
        typeof value.label !== 'string'
    )
        throw new Error('Unavailable Button value.');
    return { url: value.url, label: value.label };
};

function linkedData(
    context: AcceptedButtonLinkedContext,
    fieldId: string,
    client: MiniExtensionsClient
) {
    const portal = readPortalListOwnerContext(
        context.owner,
        context.revision,
        client
    );
    if (!portal || key(context.portal) !== key(portal)) return null;
    const state = context.owner.getSnapshot();
    if (
        !context.owner.isCurrent(context.revision) ||
        state.revision !== context.revision ||
        state.phase !== 'ready' ||
        state.pending ||
        !state.page ||
        !state.criteria ||
        !state.portalFieldId
    )
        return null;
    const outerId = state.portalFieldId;
    if (
        portal.payload.fieldIdsInPortal.filter((id) => id === outerId)
            .length !== 1
    )
        return null;
    const outer = portal.payload.fieldIdsToSchemas[outerId];
    if (
        !outer ||
        outer.airtableField.id !== outerId ||
        outer.fieldType !== outer.airtableField.config.type
    )
        return null;
    const link = getPortalLinkedRecordFieldConfig(outer.airtableField);
    if (!link) return null;
    const tableId = link.options.linkedTableId;
    const page = state.page;
    const table = page.tableIdsToLinkedTableStates[tableId];
    if (
        !table ||
        page.recordIds.filter((id) => id === context.recordId).length !== 1
    )
        return null;
    // Cross-table duplicates cannot establish one physical metadata/record identity.
    if (
        Object.values(page.tableIdsToLinkedTableStates).filter((t) =>
            Object.hasOwn(t.recordIdsToAirtableRecords, context.recordId)
        ).length !== 1
    )
        return null;
    if (
        Object.values(page.tableIdsToLinkedTableStates).flatMap((t) =>
            t.airtableFields.filter((field) => field.id === fieldId)
        ).length !== 1
    )
        return null;
    const row = table.recordIdsToAirtableRecords[context.recordId];
    const matches = table.airtableFields.filter((f) => f.id === fieldId);
    if (
        !row ||
        row.id !== context.recordId ||
        matches.length !== 1 ||
        matches[0].config.type !== 'button'
    )
        return null;
    const field = matches[0] as AirtableButtonField;
    const details = page.detailFields.filter((f) => f.fieldId === fieldId);
    if (details.length !== 1 || details[0].isHidden) return null;
    const detail = details[0];
    const source: ConfiguredButtonWebhookSource = {
        type: 'linked-record',
        linkedRecordId: context.recordId,
        linkedTableId: tableId,
        parentLinkedRecordFieldId: outerId,
        selectedCustomViewId: state.criteria.selectedCustomViewId,
    };
    return { field, row, detail, source, portal };
}

/** Form value editability does not govern configured Button actions. */
export function createFormButtonFieldModel(
    options: FormButtonFieldModelOptions
) {
    const binding = options.fields.field(options.fieldId);
    const accepted = options.fields.controller.getState();
    const loaded = normalizeFormLeaseLoaded(options.fields.getLoaded());
    const context = options.acceptedLinkedContext
        ? {
              ...options.acceptedLinkedContext,
              portal: structuredClone(options.acceptedLinkedContext.portal),
          }
        : undefined;
    const linkedPortalKey = options.acceptedLinkedContext
        ? key(options.acceptedLinkedContext.portal)
        : '';
    const lease = key([
        accepted.epoch,
        accepted.contextRevision,
        accepted.ownerScope,
        accepted.draft === null,
    ]);
    return createButtonFieldModel({
        client: options.client,
        recovery: options.recovery,
        adapter: {
            configurationRevision: () => options.configurationRevision(),
            isCurrent: () => {
                const state = options.fields.controller.getState();
                return (
                    options.isCurrent() &&
                    key([
                        state.epoch,
                        state.contextRevision,
                        state.ownerScope,
                        state.draft === null,
                    ]) === lease &&
                    !binding.getSnapshot().retired &&
                    (!context ||
                        (key(options.acceptedLinkedContext!.portal) ===
                            linkedPortalKey &&
                            linkedData(
                                context,
                                options.fieldId,
                                options.client
                            ) !== null))
                );
            },
            read: (): ButtonFieldData | null => {
                const now = options.fields.getLoaded(),
                    snapshot = binding.getSnapshot();
                const schema = snapshot.field?.schema;
                if (
                    !schema ||
                    schema.fieldType !== 'button' ||
                    schema.airtableField.config.type !== 'button' ||
                    schema.airtableField.id !== options.fieldId ||
                    key(normalizeFormLeaseLoaded(now)) !== key(loaded)
                )
                    return null;
                const linked = context
                    ? linkedData(context, options.fieldId, options.client)
                    : null;
                if (
                    context &&
                    (!linked || key(linked.field) !== key(schema.airtableField))
                )
                    return null;
                return {
                    field: schema.airtableField as AirtableButtonField,
                    value: buttonValue(snapshot.value),
                    config: linked
                        ? {
                              ...(schema.miniExtConfig as ButtonMiniExtConfig),
                              // Policy follows the accepted parent token/source.
                              openLinkType: (
                                  linked.detail
                                      .miniExtConfig as ButtonMiniExtConfig
                              )?.openLinkType,
                              triggerWebhookSuccessMessage: (
                                  linked.detail
                                      .miniExtConfig as ButtonMiniExtConfig
                              )?.triggerWebhookSuccessMessage,
                              triggerWebhookErrorMessage: (
                                  linked.detail
                                      .miniExtConfig as ButtonMiniExtConfig
                              )?.triggerWebhookErrorMessage,
                          }
                        : (schema.miniExtConfig as ButtonMiniExtConfig),
                    language: now.language,
                    // Linked sources resolve against the parent Portal extension.
                    extensionAccessToken: linked
                        ? linked.portal.payload.extensionAccessToken
                        : now.payload.extensionAccessToken,
                    visible: snapshot.visibility.type === 'visible',
                    source:
                        linked?.source ??
                        (now.payload.formRecord.type === 'edit'
                            ? {
                                  type: 'current-record',
                                  recordId: now.payload.formRecord.recordId,
                              }
                            : null),
                };
            },
            subscribe: (listener) => {
                const stops = [
                    binding.subscribe(listener),
                    options.fields.controller.subscribe(listener),
                ];
                if (context) stops.push(context.owner.subscribe(listener));
                return () => stops.forEach((stop) => stop());
            },
        },
    });
}

/** Returned list details own both display and action policy. */
export function createPortalButtonFieldModel(
    options: PortalButtonFieldModelOptions
) {
    const portal = structuredClone(options.portal),
        portalKey = key(portal);
    const revision = options.owner.getSnapshot().revision;
    const context = {
        owner: options.owner,
        portal,
        revision,
        recordId: options.recordId,
    };
    return createButtonFieldModel({
        client: options.client,
        recovery: options.recovery,
        adapter: {
            configurationRevision: () => options.configurationRevision(),
            isCurrent: () =>
                options.isCurrent() &&
                key(options.portal) === portalKey &&
                options.owner.isCurrent(revision),
            subscribe: (listener) => options.owner.subscribe(listener),
            read: () => {
                const linked = linkedData(
                    context,
                    options.fieldId,
                    options.client
                );
                if (!linked) return null;
                const detailConfig = linked.detail.miniExtConfig;
                const child = linked.detail.childFormField;
                if (
                    child &&
                    (child.idOrName.type !== 'id' ||
                        child.idOrName.id !== options.fieldId ||
                        child.config.type !== 'button')
                )
                    return null;
                // The returned detail config already includes accepted upstream child
                // settings and custom-detail overrides. Do not merge the child again.
                const config: ButtonMiniExtConfig = {
                    ...(detailConfig as ButtonMiniExtConfig),
                    title:
                        linked.detail.titleOverride ?? linked.detail.fieldName,
                };
                return {
                    field: linked.field,
                    value: buttonValue(linked.row.fields[options.fieldId]),
                    config,
                    language: linked.portal.language,
                    source: linked.source,
                    extensionAccessToken:
                        linked.portal.payload.extensionAccessToken,
                    visible: true,
                };
            },
        },
    });
}
