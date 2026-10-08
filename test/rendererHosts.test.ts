import assert from 'node:assert/strict';
import { it } from 'node:test';
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
    policy: 'normal' | 'view-blocked' | 'list' | 'default-grid' = 'normal'
) {
    const schema = loadedForm().payload.fieldIdsToSchemas.fld_title;
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
                            fields: { fld_title: 'Initial' },
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
        value: 'Initial',
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
