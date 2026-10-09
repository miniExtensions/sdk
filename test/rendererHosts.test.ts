import assert from 'node:assert/strict';
import { it } from 'node:test';
import { File } from 'node:buffer';
import type {
    AirtableValue,
    RuntimeFieldSchema,
    UploadFileResult,
} from '../src/runtime/types.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import {
    createFormFieldRendererHost,
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';
import type { FieldRendererHost } from '../src/ui/rendererRegistry.js';
const field = (host: FieldRendererHost) => {
    const state = host.getSnapshot();
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready') throw new Error('Expected ready');
    const props = state.fields[0]!;
    if (props.physicalKind !== 'singleLineText')
        throw new Error('Expected text field');
    return props;
};
const form = () => {
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw new Error('No implicit request');
        },
    });
    const fields = createFormFieldBindings({
        client,
        loaded: loadedForm(),
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    let configuration = 0;
    const host = createFormFieldRendererHost({
        fields,
        fieldId: 'fld_title',
        isCurrent: () => true,
        configurationRevision: () => configuration,
    });
    return {
        fields,
        host,
        client,
        replace: () => {
            configuration++;
        },
    };
};
it('Form host preserves owned native drafts across unmount and gives only guarded actions', () => {
    const f = form(),
        props = field(f.host);
    assert.equal(props.physicalKind, 'singleLineText');
    assert.equal(props.title, 'Request title');
    assert.equal(props.capability.type, 'editable');
    if (props.capability.type !== 'editable')
        throw new Error('Expected editable');
    assert.deepEqual(props.capability.setValue('Edited'), { accepted: true });
    assert.equal('binding' in props, false);
    assert.equal('controller' in props, false);
    f.host.dispose();
    assert.equal(f.fields.field('fld_title').getSnapshot().value, 'Edited');
    assert.equal(props.capability.setValue('Stale').accepted, false);
    assert.equal(f.fields.field('fld_title').getSnapshot().value, 'Edited');
    f.fields.destroy();
});
it('Form retained callbacks retire on configuration epochs and session replacement', () => {
    const f = form(),
        props = field(f.host);
    assert.equal(props.capability.type, 'editable');
    if (props.capability.type !== 'editable')
        throw new Error('Expected editable');
    assert.equal(props.capability.setValue(undefined as never).accepted, false);
    f.replace();
    assert.equal(props.capability.setValue('Stale').accepted, false);
    assert.equal(f.host.getSnapshot().status, 'retired');
    f.host.dispose();
    f.fields.destroy();
    const second = form(),
        retained = field(second.host);
    second.client.setSession({ visitor: 'B' });
    if (retained.capability.type === 'editable')
        assert.equal(retained.capability.setValue('Foreign').accepted, false);
    second.host.dispose();
    second.fields.destroy();
});
it('every listener rechecks its lease after a preceding listener replaces configuration', () => {
    const f = form();
    let armed = false,
        observed = '';
    f.host.subscribe(() => {
        if (armed) f.replace();
    });
    f.host.subscribe((state) => {
        observed = state.status;
    });
    armed = true;
    const props = field(f.host);
    if (props.capability.type === 'editable') props.capability.setValue('Edit');
    assert.equal(observed, 'retired');
    f.host.dispose();
    f.fields.destroy();
});
async function portal(
    empty = false,
    hideEmpty = false,
    policy: 'normal' | 'view-blocked' | 'list' | 'default-grid' = 'normal',
    native?: { schema: RuntimeFieldSchema; value: AirtableValue }
) {
    const schema =
        native?.schema ?? loadedForm().payload.fieldIdsToSchemas.fld_title;
    if (hideEmpty)
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            hideFieldIfEmpty: true,
        };
    const detail = {
        fieldId: 'fld_title',
        fieldName: 'Title',
        titleOverride: '',
        isHidden: false,
        fieldIsInEditingChildForm: true,
        childFormField: null,
        miniExtConfig: schema.miniExtConfig,
    };
    const api = portalFixture(async () =>
        portalListPage({
            recordIds: ['record_1'],
            customViewDetailFields: { fld_children: empty ? [] : [detail] },
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: [schema.airtableField],
                    recordIdsToAirtableRecords: {
                        record_1: {
                            id: 'record_1',
                            fields: { fld_title: native?.value ?? 'Initial' },
                        },
                    },
                },
            },
        })
    );
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage({
            disableInlineEdit: false,
            ...(policy === 'list' ? { layout: 'list' } : {}),
            ...(policy === 'view-blocked'
                ? {
                      customViews: [
                          {
                              id: 'view_example',
                              config: {
                                  name: 'Example',
                                  disableEditingForCustomView: true,
                              },
                          },
                      ],
                  }
                : {}),
            ...(policy === 'default-grid'
                ? {
                      customViews: [
                          {
                              id: 'view_example',
                              config: {
                                  name: 'Example',
                                  viewBehavior: 'custom',
                              },
                          },
                      ],
                  }
                : {}),
        }),
        portalFieldId: 'fld_children',
        criteria: {
            selectedCustomViewId: 'view_example',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const cell = createPortalCellBinding({
        client: api.client,
        schema,
        value: native?.value ?? 'Initial',
        input: {
            portalExtensionAccessToken: 'portal_access_example',
            portalFieldId: 'fld_children',
            recordId: 'record_1',
            recordFieldId: 'fld_title',
            selectedCustomViewId: 'view_example',
        },
        getScope: () => ({ ownerId: 'A', revision: 0 }),
        isCurrent: () => true,
        recovery: {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'A',
                parentFieldId: 'fld_children',
                tableId: 'table_children',
                childExtensionId: '',
                context: 'modal',
            },
            loadVersion: 1,
        },
    });
    const options = {
        owner,
        client: api.client,
        recordId: 'record_1',
        isCurrent: () => true,
        configurationRevision: () => 0,
    };
    return { ...api, owner, cell, options };
}
it('actual Portal cells use accepted detail display and private matching provenance', async () => {
    const f = await portal();
    const host = createPortalCellRendererHost({
        ...f.options,
        cell: f.cell,
        fieldId: 'fld_title',
    });
    const props = field(host);
    assert.equal(props.title, '');
    assert.equal(props.context, 'portal-cell');
    if (props.capability.type !== 'editable')
        throw new Error('Expected editable');
    assert.equal(props.capability.setValue('Edited').accepted, true);
    host.dispose();
    assert.equal(f.cell.binding.getSnapshot().value, 'Edited');
    const foreign = createPortalCellRendererHost({
        ...f.options,
        cell: { ...f.cell },
        fieldId: 'fld_title',
    });
    assert.equal(foreign.getSnapshot().status, 'unavailable');
    foreign.dispose();
    f.cell.destroy();
    f.owner.destroy();
});
it('a cell host constructor releases earlier subscriptions if owner subscription fails', async () => {
    const f = await portal();
    const subscribe = f.cell.binding.subscribe.bind(f.cell.binding);
    const ownerSubscribe = f.owner.subscribe;
    let live = 0;
    f.cell.binding.subscribe = (listener) => {
        const stop = subscribe(listener);
        live++;
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            live--;
            stop();
        };
    };
    f.owner.subscribe = () => {
        throw new Error('Synthetic subscription failure');
    };
    try {
        assert.throws(
            () =>
                createPortalCellRendererHost({
                    ...f.options,
                    cell: f.cell,
                    fieldId: 'fld_title',
                }),
            /Synthetic subscription failure/
        );
        assert.equal(live, 0);
        assert.equal(f.cell.binding.getSnapshot().value, 'Initial');
        assert.equal(f.owner.getSnapshot().phase, 'ready');
    } finally {
        f.owner.subscribe = ownerSubscribe;
        f.cell.binding.subscribe = subscribe;
        f.cell.destroy();
        f.owner.destroy();
    }
});
it('Portal detail projects only returned ordered fields and empty remains empty', async () => {
    const f = await portal();
    const host = createPortalDetailRendererHost(f.options),
        props = field(host);
    assert.equal(props.title, '');
    assert.equal(props.capability.type, 'readonly');
    f.owner.setCriteria(f.owner.getSnapshot().revision, {
        ...f.owner.getSnapshot().criteria!,
        searchTerm: 'replacement',
    });
    assert.equal(host.getSnapshot().status, 'retired');
    host.dispose();
    f.cell.destroy();
    f.owner.destroy();
    const e = await portal(true),
        empty = createPortalDetailRendererHost(e.options);
    assert.deepEqual(empty.getSnapshot(), { status: 'ready', fields: [] });
    empty.dispose();
    e.cell.destroy();
    e.owner.destroy();
});
it('Portal host refuses foreign clients, record identities and cell inputs without requests', async () => {
    const f = await portal();
    const foreignClient = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw new Error('No read');
        },
    });
    const hosts = [
        createPortalCellRendererHost({
            ...f.options,
            client: foreignClient,
            cell: f.cell,
            fieldId: 'fld_title',
        }),
        createPortalCellRendererHost({
            ...f.options,
            recordId: 'record_other',
            cell: f.cell,
            fieldId: 'fld_title',
        }),
        createPortalCellRendererHost({
            ...f.options,
            cell: f.cell,
            fieldId: 'fld_other',
        }),
        createPortalDetailRendererHost({ ...f.options, client: foreignClient }),
        createPortalDetailRendererHost({
            ...f.options,
            recordId: 'record_other',
        }),
    ];
    for (const host of hosts) {
        assert.equal(host.getSnapshot().status, 'unavailable');
        host.dispose();
    }
    assert.equal(f.calls.length, 1);
    assert.equal(f.mutations, 0);
    f.cell.destroy();
    f.owner.destroy();
});
it('Form invalid native writes preserve untouched and partial data', () => {
    const f = form(),
        props = field(f.host);
    if (props.capability.type !== 'editable')
        throw new Error('Expected editable');
    assert.equal(props.capability.setValue(42 as never).accepted, false);
    assert.equal(
        f.fields.field('fld_title').getSnapshot().value,
        'Initial title'
    );
    props.capability.setValue('Updated');
    assert.deepEqual(f.fields.controller.getState().draft!.data.fld_parent, [
        'record_parent',
    ]);
    assert.equal(
        f.fields.controller.getState().draft!.data.fld_computed,
        'Server formula value'
    );
    f.host.dispose();
    f.fields.destroy();
});

it('retained cell edit actions recheck hide-empty inline-edit policy after native writes', async () => {
    const f = await portal(false, true);
    const host = createPortalCellRendererHost({
        ...f.options,
        cell: f.cell,
        fieldId: 'fld_title',
    });
    const props = field(host);
    if (props.capability.type !== 'editable')
        throw new Error('Expected editable');
    assert.equal(props.capability.setValue('').accepted, true);
    assert.equal(
        props.capability.setValue('Retained callback').accepted,
        false
    );
    assert.equal(field(host).capability.type, 'readonly');
    assert.equal(f.cell.binding.getSnapshot().value, '');
    host.dispose();
    f.cell.destroy();
    f.owner.destroy();
});

it('Portal cell editing follows the exact selected view and effective grid layout', async () => {
    for (const policy of ['view-blocked', 'list', 'default-grid'] as const) {
        const f = await portal(false, false, policy);
        const host = createPortalCellRendererHost({
            ...f.options,
            cell: f.cell,
            fieldId: 'fld_title',
        });
        assert.equal(
            field(host).capability.type,
            policy === 'default-grid' ? 'editable' : 'readonly'
        );
        host.dispose();
        f.cell.destroy();
        f.owner.destroy();
    }
});

it('genuine cell provenance rejects a replaced public binding before renderer edits', async () => {
    const f = await portal();
    const original = f.cell.binding;
    const replacementOwner = form();
    const replacement = replacementOwner.fields.field('fld_title');
    const host = createPortalCellRendererHost({
        ...f.options,
        cell: f.cell,
        fieldId: 'fld_title',
    });
    const retained = field(host);
    if (retained.capability.type !== 'editable')
        throw new Error('Expected editable');
    f.cell.binding = replacement;
    assert.equal(host.getSnapshot().status, 'retired');
    assert.equal(retained.capability.setValue('Spoofed edit').accepted, false);
    const rejected = createPortalCellRendererHost({
        ...f.options,
        cell: f.cell,
        fieldId: 'fld_title',
    });
    assert.equal(rejected.getSnapshot().status, 'unavailable');
    assert.equal(original.getSnapshot().value, 'Initial');
    assert.equal(replacement.getSnapshot().value, 'Initial title');
    assert.equal(f.calls.length, 1);
    assert.equal(f.mutations, 0);
    rejected.dispose();
    host.dispose();
    replacementOwner.host.dispose();
    replacementOwner.fields.destroy();
    f.cell.binding = original;
    f.cell.destroy();
    f.owner.destroy();
});

it('real Form host retains canonical null attachment ID after explicit synthetic upload', async () => {
    let uploads = 0,
        saves = 0,
        implicitRequests = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            implicitRequests++;
            throw new Error('No implicit I/O');
        },
    });
    const uploaded: UploadFileResult = {
        id: null,
        url: 'https://files.example.test/uploaded',
        filename: 'uploaded.txt',
        size: 7,
        type: 'text/plain',
    };
    client.attachments.uploadFile = async () => {
        uploads++;
        return uploaded;
    };
    client.forms.save = async () => {
        saves++;
        throw new Error('No Save');
    };
    const fields = createFormFieldBindings({
        client,
        loaded: loadedForm(),
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    const host = createFormFieldRendererHost({
        fields,
        fieldId: 'fld_files',
        isCurrent: () => true,
        configurationRevision: () => 0,
        attachmentRecovery: {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'A',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
            loadVersion: 1,
        },
    });
    const attachmentProps = () => {
        const state = host.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready')
            throw new Error('Expected ready attachment host');
        const props = state.fields[0]!;
        if (
            props.physicalKind !== 'multipleAttachments' ||
            props.capability.type !== 'editable' ||
            !props.capability.attachment
        )
            throw new Error('Expected attachment actions');
        return props;
    };
    const before = attachmentProps();
    assert.equal(uploads, 0);
    assert.equal(implicitRequests, 0);
    assert.equal(saves, 0);
    if (before.capability.type !== 'editable' || !before.capability.attachment)
        throw new Error('Expected attachment actions');
    const selected = new File(['content'], 'uploaded.txt', {
        type: 'text/plain',
    }) as unknown as globalThis.File;
    assert.equal(before.capability.attachment.select([selected]), true);
    assert.equal(uploads, 0);
    assert.equal(await before.capability.attachment.upload(), true);
    const native = fields.field('fld_files').getSnapshot().value;
    assert.ok(Array.isArray(native));
    assert.deepEqual(native.at(-1), uploaded);
    const after = attachmentProps();
    assert.ok(Array.isArray(after.value));
    assert.deepEqual(after.value.at(-1), uploaded);
    assert.equal(after.value.at(-1)!.id, null);
    if (after.capability.type !== 'editable' || !after.capability.attachment)
        throw new Error('Expected retained attachment actions');
    assert.equal(after.capability.attachment.state.phase, 'accepted');
    assert.equal(
        after.capability.attachment.remove(after.value.length - 1),
        true
    );
    assert.equal(attachmentProps().value?.length, 1);
    assert.equal(uploads, 1);
    assert.equal(implicitRequests, 0);
    assert.equal(saves, 0);
    host.dispose();
    fields.destroy();
});

it('successful actual Add Choice refresh keeps sibling and choice Form hosts current', async () => {
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm.push('fld_choice');
    loaded.payload.fieldIdsToSchemas.fld_choice = {
        fieldType: 'multipleSelects',
        airtableField: {
            id: 'fld_choice',
            name: 'Choices',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleSelects',
                options: { choices: [{ id: 'sel_alpha', name: 'Alpha' }] },
            },
        },
        miniExtConfig: { allowAddingNewOptions: true },
    };
    loaded.payload.formRecord.data.fld_choice = ['Alpha'];
    loaded.payload.fieldNamesToSchemas.Choices =
        loaded.payload.fieldIdsToSchemas.fld_choice;
    loaded.payload.fieldIdsInForm.push('fld_button');
    loaded.payload.fieldIdsToSchemas.fld_button = {
        fieldType: 'button',
        airtableField: {
            id: 'fld_button',
            name: 'Button',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'button', options: null },
        },
        miniExtConfig: { openLinkType: '_blank' },
    };
    loaded.payload.formRecord.data.fld_button = {
        url: 'https://example.test/button',
        label: 'Open',
    };
    let requests = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw new Error('No implicit I/O');
        },
    });
    client.forms.addSelectOption = async (input) => {
        requests++;
        return {
            newChoice: {
                id: 'sel_' + input.newChoiceText.toLowerCase(),
                name: input.newChoiceText,
            },
        };
    };
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    const creator = fields.selectChoice('fld_choice', {
        journal: new RecoveryJournal(),
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal',
        },
        loadVersion: 1,
    });
    const lease = {
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    };
    const textHost = createFormFieldRendererHost({
        ...lease,
        fieldId: 'fld_title',
    });
    const choiceHost = createFormFieldRendererHost({
        ...lease,
        fieldId: 'fld_choice',
    });
    const buttonHost = createFormFieldRendererHost({
        ...lease,
        fieldId: 'fld_button',
        button: {
            client,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'A',
                    parentFieldId: null,
                    tableId: null,
                    childExtensionId: 'form',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        },
    });
    const buttonProps = () => {
        const state = buttonHost.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready') throw new Error('Expected Button host');
        const props = state.fields[0]!;
        if (
            props.physicalKind !== 'button' ||
            props.capability.type !== 'button'
        )
            throw new Error('Expected Button action');
        return props.capability.button;
    };
    assert.ok(buttonProps().prepareLink());
    const text = field(textHost);
    const choiceState = choiceHost.getSnapshot();
    assert.equal(choiceState.status, 'ready');
    if (choiceState.status !== 'ready') throw new Error('Expected choice host');
    const choice = choiceState.fields[0]!;
    if (
        choice.physicalKind !== 'multipleSelects' ||
        choice.capability.type !== 'editable' ||
        !choice.capability.choice
    )
        throw new Error('Expected choice actions');
    assert.equal(requests, 0);
    assert.equal(await choice.capability.choice.create('Beta'), true);
    assert.equal(requests, 1);
    assert.deepEqual(fields.field('fld_choice').getSnapshot().value, [
        'Alpha',
        'Beta',
    ]);
    assert.equal(textHost.getSnapshot().status, 'ready');
    assert.equal(choiceHost.getSnapshot().status, 'ready');
    if (text.capability.type !== 'editable')
        throw new Error('Expected text actions');
    assert.equal(text.capability.setValue('After Choice').accepted, true);
    assert.equal(field(textHost).value, 'After Choice');
    assert.ok(buttonProps().prepareLink());
    assert.equal(await creator.create('Gamma'), true);
    assert.equal(await creator.create('Delta'), true);
    assert.deepEqual(fields.field('fld_choice').getSnapshot().value, [
        'Alpha',
        'Beta',
        'Gamma',
        'Delta',
    ]);
    assert.equal(textHost.getSnapshot().status, 'ready');
    assert.equal(choiceHost.getSnapshot().status, 'ready');
    assert.ok(buttonProps().prepareLink());
    const remounted = createFormFieldRendererHost({
        ...lease,
        fieldId: 'fld_choice',
    });
    assert.equal(remounted.getSnapshot().status, 'ready');
    remounted.dispose();
    buttonHost.dispose();
    textHost.dispose();
    choiceHost.dispose();
    fields.destroy();
});

it('object-valued Portal cell kinds retain native presentation with readonly capability', async () => {
    const collaborator = {
        id: 'usr_one',
        email: 'one@example.test',
        name: 'One',
    };
    for (const kind of [
        'barcode',
        'singleCollaborator',
        'multipleCollaborators',
    ] as const) {
        const value =
            kind === 'barcode'
                ? { text: '012345', type: 'upc' }
                : kind === 'singleCollaborator'
                  ? collaborator
                  : [collaborator];
        const schema = {
            fieldType: kind,
            miniExtConfig: {},
            airtableField: {
                id: 'fld_title',
                name: 'Native object',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: kind,
                    options:
                        kind === 'barcode' ? null : { choices: [collaborator] },
                },
            },
        } as RuntimeFieldSchema;
        const f = await portal(false, false, 'normal', { schema, value });
        const host = createPortalCellRendererHost({
            ...f.options,
            cell: f.cell,
            fieldId: 'fld_title',
        });
        const state = host.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready')
            throw new Error('Expected native presentation');
        const props = state.fields[0]!;
        assert.equal(props.physicalKind, kind);
        assert.deepEqual(props.value, value);
        assert.equal(props.capability.type, 'readonly');
        assert.equal('setValue' in props.capability, false);
        assert.deepEqual(f.cell.binding.getSnapshot().value, value);
        assert.equal(f.calls.length, 1);
        assert.equal(f.mutations, 0);
        host.dispose();
        f.cell.destroy();
        f.owner.destroy();
    }
});

it('reentrant lease disposal refuses a retained edit before native mutation', () => {
    const f = form();
    f.host.dispose();
    let disposeFromLease = false;
    const host = createFormFieldRendererHost({
        fields: f.fields,
        fieldId: 'fld_title',
        configurationRevision: () => 0,
        isCurrent: () => {
            if (disposeFromLease) host.dispose();
            return true;
        },
    });
    const props = field(host);
    if (props.capability.type !== 'editable') throw new Error('Expected edit');
    disposeFromLease = true;
    assert.equal(props.capability.setValue('After disposal').accepted, false);
    assert.equal(
        f.fields.field('fld_title').getSnapshot().value,
        'Initial title'
    );
    assert.equal(host.getSnapshot().status, 'retired');
    f.fields.destroy();
});

it('attachment renderer can replace the exact queued File during an existing upload', async () => {
    const f = form();
    f.host.dispose();
    let resolve!: (result: UploadFileResult) => void;
    let requests = 0;
    f.client.attachments.uploadFile = async () => {
        requests++;
        return new Promise<UploadFileResult>((yes) => {
            resolve = yes;
        });
    };
    const host = createFormFieldRendererHost({
        fields: f.fields,
        fieldId: 'fld_files',
        configurationRevision: () => 0,
        isCurrent: () => true,
        attachmentRecovery: {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'A',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
            loadVersion: 1,
        },
    });
    const actions = () => {
        const state = host.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready') throw new Error('Expected attachments');
        const props = state.fields[0]!;
        if (
            props.physicalKind !== 'multipleAttachments' ||
            props.capability.type !== 'editable' ||
            !props.capability.attachment
        )
            throw new Error('Expected queue actions');
        return props.capability.attachment;
    };
    const first = new File(['first'], 'first.txt', {
        type: 'text/plain',
    }) as unknown as globalThis.File;
    const next = new File(['next'], 'next.txt', {
        type: 'text/plain',
    }) as unknown as globalThis.File;
    assert.equal(actions().select([first]), true);
    const uploading = actions().upload();
    assert.equal(actions().state.busy, true);
    assert.equal(actions().select([next]), true);
    assert.equal(actions().state.files[0], next);
    resolve({
        id: null,
        url: 'https://files.example.test/first',
        filename: 'first.txt',
        size: 5,
        type: 'text/plain',
    });
    assert.equal(await uploading, true);
    assert.equal(requests, 1);
    assert.equal(actions().state.files[0], next);
    const cancelled = actions().upload();
    assert.equal(actions().state.busy, true);
    actions().cancel();
    resolve({
        id: null,
        url: 'https://files.example.test/next',
        filename: 'next.txt',
        size: 4,
        type: 'text/plain',
    });
    assert.equal(await cancelled, false);
    assert.equal(actions().state.phase, 'uncertain');
    assert.equal(actions().state.files[0], next);
    assert.equal(await actions().upload(), false);
    assert.equal(requests, 2);
    actions().clear();
    assert.deepEqual(actions().state.files, []);
    host.dispose();
    f.fields.destroy();
});

it('retained attachment clear cleans the owned queue after field becomes hidden', () => {
    const loaded = loadedForm();
    const schema = loaded.payload.fieldIdsToSchemas.fld_files;
    if (schema.fieldType !== 'multipleAttachments')
        throw new Error('Expected attachment schema');
    schema.miniExtConfig = {
        conditionalFields: {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'condition_title',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'singleLineText',
                        idOrName: { type: 'id', id: 'fld_title' },
                        value: 'Initial title',
                    },
                },
            ],
        },
    };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw new Error('No I/O');
        },
    });
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    const recovery = {
        journal: new RecoveryJournal(),
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal' as const,
        },
        loadVersion: 1,
    };
    const attachment = fields.attachment('fld_files', recovery);
    const host = createFormFieldRendererHost({
        fields,
        fieldId: 'fld_files',
        configurationRevision: () => 0,
        isCurrent: () => true,
        attachmentRecovery: recovery,
    });
    const state = host.getSnapshot();
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready') throw new Error('Expected attachment host');
    const props = state.fields[0]!;
    if (
        props.physicalKind !== 'multipleAttachments' ||
        props.capability.type !== 'editable' ||
        !props.capability.attachment
    )
        throw new Error('Expected queue');
    const retained = props.capability.attachment;
    const selected = new File(['data'], 'queued.txt', {
        type: 'text/plain',
    }) as unknown as globalThis.File;
    assert.equal(retained.select([selected]), true);
    assert.equal(fields.field('fld_title').setValue('Hidden').accepted, true);
    assert.equal(host.getSnapshot().status, 'hidden');
    assert.equal(retained.select([selected]), false);
    retained.clear();
    assert.deepEqual(attachment.getSnapshot().files, []);
    assert.deepEqual(
        fields.field('fld_files').getSnapshot().value,
        loaded.payload.formRecord.data.fld_files
    );
    host.dispose();
    fields.destroy();
});
