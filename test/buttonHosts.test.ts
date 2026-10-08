import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    TriggerConfiguredButtonWebhookInput,
    RuntimeLinkedRecordDetailField,
} from '../src/runtime/types.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import {
    createFormButtonFieldModel,
    createPortalButtonFieldModel,
} from '../src/ui/buttonHosts.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalPage, portalListPage } from './portalFixtures.js';
const field = {
    id: 'fld_button',
    name: 'Button',
    description: null,
    isComputed: true,
    isPrimaryField: false,
    config: { type: 'button' as const, options: null },
};
const value = { url: 'example.test/button', label: 'Run' };
const recovery = () => ({
    journal: new RecoveryJournal(),
    scope: {
        owner: 'A',
        parentFieldId: null,
        tableId: 'table_children',
        childExtensionId: 'form',
        context: 'modal' as const,
    },
    loadVersion: 0,
});
function clientFixture() {
    const calls: TriggerConfiguredButtonWebhookInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw Error('No implicit request');
        },
    });
    client.buttons.triggerWebhook = async (input) => {
        calls.push(structuredClone(input));
        return { success: true };
    };
    return { client, calls };
}
function formFixture(edit: boolean, hidden = false) {
    const api = clientFixture(),
        loaded = loadedForm();
    loaded.payload.fieldIdsInForm = ['fld_button'];
    loaded.payload.fieldIdsToSchemas = {
        fld_button: {
            fieldType: 'button',
            airtableField: field,
            miniExtConfig: {
                openLinkType: 'triggerWebhookPOST',
                hideFieldIfEmpty: hidden,
            },
        },
    };
    loaded.payload.formRecord = edit
        ? {
              type: 'edit',
              tableId: 'table_children',
              recordId: 'rec_edit',
              data: { fld_button: hidden ? null : value },
          }
        : { type: 'create', data: { fld_button: value } };
    let revision = 0;
    const fields = createFormFieldBindings({
        client: api.client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision }),
    });
    const options = {
        client: api.client,
        fields,
        fieldId: 'fld_button',
        isCurrent: () => true,
        configurationRevision: () => revision,
        recovery: recovery(),
    };
    return { ...api, fields, options, change: () => revision++ };
}
it('Form create has no record source; computed edit Button dispatches without value-edit permission', async () => {
    const create = formFixture(false),
        edit = formFixture(true);
    const a = createFormButtonFieldModel(create.options),
        b = createFormButtonFieldModel(edit.options);
    assert.equal(a.getSnapshot().canTrigger, false);
    assert.equal(
        create.fields.field('fld_button').getSnapshot().canEdit,
        false
    );
    assert.equal(b.getSnapshot().canTrigger, true);
    assert.deepEqual(await b.getRenderProps().triggerWebhook(), {
        type: 'reported-success',
    });
    assert.deepEqual(edit.calls[0].source, {
        type: 'current-record',
        recordId: 'rec_edit',
    });
    assert.equal(create.calls.length, 0);
});
it('Form hidden Button cannot act and owner/config replacements permanently retire retained controls', async () => {
    const hidden = formFixture(true, true),
        f = formFixture(true);
    assert.equal(
        createFormButtonFieldModel(hidden.options).getSnapshot().canTrigger,
        false
    );
    const model = createFormButtonFieldModel(f.options),
        props = model.getRenderProps();
    f.change();
    assert.equal(model.getSnapshot().phase, 'retired');
    assert.equal((await props.triggerWebhook()).type, 'refused');
    assert.equal(f.calls.length, 0);
});
async function portalFixture(duplicate = false) {
    const api = clientFixture(),
        portal = portalPage();
    const detail: RuntimeLinkedRecordDetailField = {
        fieldId: 'fld_button',
        fieldName: 'Button',
        titleOverride: 'Returned title',
        isHidden: false,
        fieldIsInEditingChildForm: true,
        miniExtConfig: {
            openLinkType: 'triggerWebhookGET',
            title: 'Detail title',
        },
        childFormField: {
            idOrName: { type: 'id', id: 'fld_button' },
            config: {
                type: 'button',
                config: {
                    title: 'Child title',
                    openLinkType: 'triggerWebhookPOST',
                },
            },
        },
    };
    portal.payload.linkedRecordFieldIdToDetailFields = {
        fld_children: [detail],
    };
    const page = portalListPage({
        recordIds: ['rec_linked'],
        airtableOffset: 'next',
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: duplicate ? [field, field] : [field],
                recordIdsToAirtableRecords: {
                    rec_linked: {
                        id: 'rec_linked',
                        fields: { fld_button: value },
                    },
                },
            },
        },
    });
    let revision = 0,
        config = 0;
    api.client.portals.listLinkedRecords = async () => page;
    const owner = createPortalListOwner({
        client: api.client,
        portal,
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
        getScope: () => ({ ownerId: 'A', revision }),
        configurationRevision: () => config,
    });
    await owner.readFirst(0, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const options = {
        client: api.client,
        owner,
        portal,
        recordId: 'rec_linked',
        fieldId: 'fld_button',
        isCurrent: () => true,
        configurationRevision: () => config,
        recovery: recovery(),
    };
    return {
        ...api,
        options,
        owner,
        scope: () => revision++,
        config: () => config++,
    };
}
it('Portal uses accepted row and native table source, returned title and accepted child action config', async () => {
    const f = await portalFixture(),
        m = createPortalButtonFieldModel(f.options);
    assert.equal(m.getSnapshot().config?.title, 'Returned title');
    assert.equal(m.getSnapshot().config?.openLinkType, 'triggerWebhookPOST');
    assert.equal(m.getSnapshot().canTrigger, true);
    await m.getRenderProps().triggerWebhook();
    assert.deepEqual(f.calls[0].source, {
        type: 'linked-record',
        linkedRecordId: 'rec_linked',
        linkedTableId: 'table_children',
        parentLinkedRecordFieldId: 'fld_children',
        selectedCustomViewId: 'view_example',
    });
    assert.equal('url' in f.calls[0], false);
});
it('Portal rejects missing rows and duplicate physical Button metadata without requests', async () => {
    const f = await portalFixture(),
        dup = await portalFixture(true);
    assert.equal(
        createPortalButtonFieldModel({
            ...f.options,
            recordId: 'unlisted',
        }).getSnapshot().phase,
        'retired'
    );
    assert.equal(
        createPortalButtonFieldModel(dup.options).getSnapshot().phase,
        'retired'
    );
    assert.equal(f.calls.length + dup.calls.length, 0);
});
it('Portal criteria, paging, scope and configuration ABA retire retained actions', async () => {
    for (const change of ['criteria', 'paging', 'scope', 'config'] as const) {
        const f = await portalFixture(),
            m = createPortalButtonFieldModel(f.options),
            props = m.getRenderProps();
        const state = f.owner.getSnapshot();
        if (change === 'criteria')
            f.owner.setCriteria(state.revision, {
                ...state.criteria!,
                searchTerm: 'changed',
            });
        if (change === 'paging')
            await f.owner.readNext(state.revision, {
                pagesToFetch: 1,
                refreshLoggedInPortalRecord: false,
            });
        if (change === 'scope') f.scope();
        if (change === 'config') {
            f.config();
            f.owner.getSnapshot();
            f.config();
        }
        assert.equal(m.getSnapshot().phase, 'retired', change);
        assert.equal((await props.triggerWebhook()).type, 'refused', change);
        assert.equal(f.calls.length, 0);
    }
});
it('accepted linked context supplies Form create source only through listed native Button coherence', async () => {
    const portal = await portalFixture(),
        form = formFixture(false);
    const context = {
        owner: portal.owner,
        portal: portal.options.portal,
        revision: portal.owner.getSnapshot().revision,
        recordId: 'rec_linked',
    };
    const m = createFormButtonFieldModel({
        ...form.options,
        acceptedLinkedContext: context,
    });
    assert.equal(m.getSnapshot().canTrigger, true);
    await m.getRenderProps().triggerWebhook();
    assert.equal(form.calls[0].source.type, 'linked-record');
    const wrong = createFormButtonFieldModel({
        ...form.options,
        recovery: recovery(),
        acceptedLinkedContext: { ...context, recordId: 'not-listed' },
    });
    assert.equal(wrong.getSnapshot().phase, 'retired');
    portal.owner.destroy();
    assert.equal(m.getSnapshot().phase, 'retired');
});
it('Portal raw detail action settings work without a child config', async () => {
    const f = await portalFixture();
    const detail =
        f.options.portal.payload.linkedRecordFieldIdToDetailFields
            .fld_children[0];
    detail.childFormField = null;
    // A new accepted owner is required for changed returned Portal policy.
    const owner = createPortalListOwner({
        client: f.client,
        portal: f.options.portal,
        portalFieldId: 'fld_children',
        criteria: f.owner.getSnapshot().criteria!,
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    await owner.readFirst(0, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const m = createPortalButtonFieldModel({ ...f.options, owner });
    assert.equal(m.getSnapshot().config?.openLinkType, 'triggerWebhookGET');
    assert.equal(m.getSnapshot().canTrigger, true);
});

it('Portal mismatched child identity and hidden details refuse actions', async () => {
    for (const hidden of [false, true]) {
        const f = await portalFixture();
        const detail =
            f.options.portal.payload.linkedRecordFieldIdToDetailFields
                .fld_children[0];
        if (hidden) detail.isHidden = true;
        else detail.childFormField!.idOrName = { type: 'id', id: 'fld_other' };
        const owner = createPortalListOwner({
            client: f.client,
            portal: f.options.portal,
            portalFieldId: 'fld_children',
            criteria: f.owner.getSnapshot().criteria!,
            getScope: () => ({ ownerId: 'A', revision: 0 }),
        });
        await owner.readFirst(0, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        const m = createPortalButtonFieldModel({ ...f.options, owner });
        assert.equal(m.getSnapshot().phase, 'retired');
        assert.equal(
            (await m.getRenderProps().triggerWebhook()).type,
            'refused'
        );
        assert.equal(f.calls.length, 0);
    }
});
