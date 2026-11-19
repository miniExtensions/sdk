import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import {
    FormLinkedChildEditDialog,
    type FormLinkedChildEditOpening,
} from '../src/react/FormLinkedChildEditDialog.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type { SaveFormInput, SaveFormResult } from '../src/runtime/types.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';
import {
    childForm,
    childSaved,
    parentForm,
} from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

const linkedField = 'fld_children_a';
const selectedId = 'rec_existing';

function savedEdit() {
    const result = childSaved('edit');
    result.record.id = selectedId;
    result.record.fields.fld_parent_a = ['rec_parent'];
    return result;
}

async function fixture(t: TestContext, save?: () => Promise<SaveFormResult>) {
    const dom = await htmlPresentationFixture(t);
    const doc = dom.window.document;
    const prototype = dom.window.HTMLElement.prototype;
    const geometry = Object.getOwnPropertyDescriptor(
        prototype,
        'getClientRects'
    );
    Object.defineProperty(prototype, 'getClientRects', {
        configurable: true,
        value: () => [{}],
    });
    t.after(() => {
        if (geometry)
            Object.defineProperty(prototype, 'getClientRects', geometry);
        else Reflect.deleteProperty(prototype, 'getClientRects');
    });
    const style = doc.createElement('style');
    style.textContent = 'button, input { visibility: visible; }';
    doc.head.append(style);
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://edit.example.test',
        fetch: async () => {
            throw Error('Unexpected real transport');
        },
    });
    let reads = 0;
    const loads: string[] = [];
    const saves: SaveFormInput[] = [];
    const parent = parentForm('edit');
    client.linkedRecords.loadSelectedRecords = async () => {
        reads++;
        return {
            tbl_child: {
                airtableFields: [
                    parent.payload.fieldIdsToSchemas.fld_title.airtableField,
                ],
                recordIdsToAirtableRecords: {
                    [selectedId]: {
                        id: selectedId,
                        fields: { fld_title: 'Selected' },
                    },
                    rec_sibling: {
                        id: 'rec_sibling',
                        fields: { fld_title: 'Sibling' },
                    },
                },
            },
        };
    };
    client.loadExtension = async (input) => {
        assert('childExtensionInfo' in input);
        const access = input.childExtensionInfo.accessType;
        assert(access.type === 'edit');
        const recordId = access.childExtensionRecordId;
        loads.push(recordId);
        const loaded = childForm('edit');
        loaded.payload.formRecord = {
            type: 'edit',
            tableId: 'tbl_child',
            recordId,
            data: loaded.payload.formRecord.data,
        };
        loaded.payload.formFieldIdsWithUnsavedChanges = [];
        return loaded;
    };
    client.forms.save = async (input) => {
        saves.push(structuredClone(input));
        return save ? save() : savedEdit();
    };
    let sequence = 0;
    const createParent = () => {
        const ownerId = 'mounted-edit-parent-' + ++sequence;
        const fields = createFormFieldBindings({
            loaded: parent,
            client,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId, revision: 0 }),
        });
        t.after(async () => {
            await act(async () => fields.destroy());
        });
        const owner = fields.linkedChild(linkedField, {
            journal: new RecoveryJournal(),
            loadVersion: 1,
        });
        return {
            fields,
            owner,
            hydrate: () => fields.linkedRecords(linkedField).readSelected(),
        };
    };
    let host = createParent();
    let opening: FormLinkedChildEditOpening | null = null;
    let submits = 0;
    const render = () =>
        dom.render(
            h(
                'div',
                { onSubmit: () => submits++ },
                h(
                    'button',
                    { id: 'owned-edit-opener', type: 'button' },
                    'Edit selected'
                ),
                opening &&
                    h(FormLinkedChildEditDialog, {
                        owner: host.owner,
                        opening,
                        renderFields: () =>
                            h('input', { 'aria-label': 'Child title' }),
                    })
            )
        );
    await render();
    await host.hydrate();
    const opener = () => {
        const button = doc.querySelector('#owned-edit-opener');
        assert(button instanceof dom.window.HTMLButtonElement);
        return button;
    };
    const open = async (targetId = selectedId) => {
        const button = opener();
        button.focus();
        await act(async () => {
            assert.equal(
                await host.owner.openEdit(
                    selectedId,
                    host.owner.getSnapshot().revision
                ),
                true
            );
        });
        const child = host.owner.getSnapshot().child;
        assert(child);
        const accepted: FormLinkedChildEditOpening = {
            opener: button as unknown as HTMLButtonElement,
            child,
            recordId: targetId,
            isCurrent: () => opening === accepted,
        };
        opening = accepted;
        await render();
        return child;
    };
    const dialog = () => doc.querySelector('dialog');
    const button = (label: string) => {
        const match = [...(dialog()?.querySelectorAll('button') ?? [])].find(
            (candidate) => candidate.textContent === label
        );
        assert(match, `Missing ${label}`);
        return match;
    };
    const edit = (value: string) =>
        act(async () => {
            const child = host.owner.getSnapshot().child;
            assert(child);
            child.field('fld_title').setValue(value);
        });
    const replace = async () => {
        opening = null;
        await act(async () => host.fields.destroy());
        host = createParent();
        await host.hydrate();
        return open();
    };
    return {
        ...dom,
        doc,
        button,
        dialog,
        open,
        opener,
        edit,
        replace,
        loads,
        saves,
        reads: () => reads,
        submits: () => submits,
        host: () => host,
    };
}

it('mounts a named Edit modal outside its parent Form and contains focus', async (t) => {
    const f = await fixture(t);
    await f.open();
    const dialog = f.dialog();
    assert(dialog?.open);
    assert.ok(dialog.parentElement === f.doc.body);
    assert.equal(
        f.doc.getElementById(dialog.getAttribute('aria-labelledby')!)
            ?.textContent,
        'Edit linked record'
    );
    assert.ok(f.doc.activeElement === f.button('Close'));
    for (const shiftKey of [true, false]) {
        const event = new f.window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            f.doc.activeElement?.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, true);
        assert.ok(
            f.doc.activeElement === f.button(shiftKey ? 'Save' : 'Close')
        );
    }
    const submit = new f.window.Event('submit', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => dialog.dispatchEvent(submit));
    assert.equal(submit.defaultPrevented, true);
    assert.equal(f.submits(), 0);
    assert.deepEqual(f.saves, []);
});

it('resumes a confirmed dirty Close and saves only the selected child once', async (t) => {
    const f = await fixture(t);
    const originalOpener = f.opener();
    await f.open();
    const parentDraft = f.host().fields.controller.getState().draft?.data;
    await f.edit('Resume this selected child');
    await f.click(f.button('Close'));
    assert.ok(f.doc.activeElement === f.button('Keep editing'));
    await f.click(f.button('Close without saving'));
    assert.equal(f.host().owner.getSnapshot().phase, 'closed');
    assert.ok(f.dialog() === null);
    assert.ok(f.doc.activeElement === originalOpener);
    assert.deepEqual(f.loads, [selectedId]);
    assert.equal(f.reads(), 1);
    assert.equal(f.saves.length, 0);
    const resumed = await f.open();
    assert.equal(
        resumed.field('fld_title').getSnapshot().value,
        'Resume this selected child'
    );
    assert.deepEqual(f.loads, [selectedId]);
    assert.equal(f.reads(), 1);
    await f.click(f.button('Save'));
    assert.equal(f.saves.length, 1);
    const [submitted] = f.saves;
    assert.equal(submitted.extensionAccessToken, 'synthetic_child_token');
    assert(submitted.formRecord.type === 'edit');
    assert.equal(submitted.formRecord.recordId, selectedId);
    assert.equal(submitted.formRecord.tableId, 'tbl_child');
    assert.equal(
        submitted.formRecord.data.fld_title,
        'Resume this selected child'
    );
    assert.equal(f.submits(), 0);
    assert.deepEqual(
        f.host().fields.controller.getState().draft?.data,
        parentDraft
    );
    assert.ok(f.dialog() === null);
    assert.ok(f.doc.activeElement === originalOpener);
});

it('keeps the same-record successor draft and focus when a retired Save settles', async (t) => {
    let release!: (result: SaveFormResult) => void;
    const held = new Promise<SaveFormResult>((resolve) => {
        release = resolve;
    });
    const f = await fixture(t, () => held);
    await f.open();
    await f.edit('Old accepted Save');
    await f.click(f.button('Save'));
    assert.equal(f.host().owner.getSnapshot().phase, 'saving');
    assert.equal(f.saves.length, 1);
    const successor = await f.replace();
    await f.edit('New same-record draft');
    const successorDraft = successor.controller.getState().draft;
    const focus = f.dialog()?.querySelector('input');
    assert(focus);
    focus.focus();
    await act(async () => release(savedEdit()));
    assert.equal(f.host().owner.getSnapshot().phase, 'ready');
    assert.ok(f.host().owner.getSnapshot().child === successor);
    assert.deepEqual(successor.controller.getState().draft, successorDraft);
    assert.equal(
        successor.field('fld_title').getSnapshot().value,
        'New same-record draft'
    );
    assert.ok(f.doc.activeElement === focus);
    assert.equal(f.saves.length, 1);
    assert.equal(f.submits(), 0);
});

it('refuses an opening for another record without allocating another read or Save', async (t) => {
    const f = await fixture(t);
    await f.open('rec_sibling');
    assert.ok(f.dialog() === null);
    assert.deepEqual(f.loads, [selectedId]);
    assert.equal(f.reads(), 1);
    assert.deepEqual(f.saves, []);
});
