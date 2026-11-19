import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormPageOwner, FormPageError } from '../src/forms/pages.js';
import {
    RecoveryJournal,
    type RecoveryAttempt,
} from '../src/forms/recovery.js';
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

class ObservedJournal extends RecoveryJournal {
    readonly observed: RecoveryAttempt[] = [];
    override prepare(...args: Parameters<RecoveryJournal['prepare']>) {
        const attempt = super.prepare(...args);
        this.observed.push(attempt);
        return attempt;
    }
}

function savedEdit() {
    const result = childSaved('edit');
    result.record.id = selectedId;
    result.record.fields.fld_parent_a = ['rec_parent'];
    return result;
}

async function fixture(
    t: TestContext,
    options: {
        save?: () => Promise<SaveFormResult>;
        requireOpen?: boolean;
    } = {}
) {
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
    if (options.requireOpen) {
        const links = parent.payload.fieldIdsToSchemas[linkedField];
        assert(links?.fieldType === 'multipleRecordLinks');
        links.miniExtConfig = {
            ...links.miniExtConfig,
            requireOpenLinkedRecords: true,
        };
        parent.payload.formRecord.data[linkedField] = [selectedId];
    }
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
        return options.save ? options.save() : savedEdit();
    };
    let sequence = 0;
    const createParent = () => {
        const ownerId = 'mounted-edit-parent-' + ++sequence;
        const fields = createFormFieldBindings({
            loaded: parent,
            client,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId, revision: 0 }),
            ...(options.requireOpen
                ? { linkedRecordOpenAuthorityRevision: () => 0 }
                : {}),
        });
        t.after(async () => {
            await act(async () => fields.destroy());
        });
        const journal = new ObservedJournal();
        const owner = fields.linkedChild(linkedField, {
            journal,
            loadVersion: 1,
        });
        return {
            fields,
            owner,
            journal,
            hydrate: () => fields.linkedRecords(linkedField).readSelected(),
        };
    };
    let host = createParent();
    let opening: FormLinkedChildEditOpening | null = null;
    let submits = 0;
    const render = (refreshOpening = false) => {
        const activeOpening = opening;
        const presentation =
            refreshOpening && activeOpening
                ? {
                      ...activeOpening,
                      isCurrent: () => activeOpening.isCurrent(),
                  }
                : activeOpening;
        return dom.render(
            h(
                'div',
                { onSubmit: () => submits++ },
                h(
                    'button',
                    { id: 'owned-edit-opener', type: 'button' },
                    'Edit selected'
                ),
                presentation &&
                    h(FormLinkedChildEditDialog, {
                        owner: host.owner,
                        opening: presentation,
                        renderFields: () =>
                            h('input', { 'aria-label': 'Child title' }),
                    })
            )
        );
    };
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
    const cancel = async () => {
        const node = dialog();
        assert(node);
        const event = new dom.window.Event('cancel', { cancelable: true });
        await act(async () => node.dispatchEvent(event));
        assert(event.defaultPrevented);
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
        cancel,
        render,
        retireOpening: () => {
            opening = null;
        },
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

for (const exit of ['Close', 'Escape'] as const) {
    it(`exits an unknown Save through ${exit} without clearing or replaying it`, async (t) => {
        const f = await fixture(t, {
            save: async () => {
                throw Error('Synthetic lost Save response');
            },
        });
        const { owner, journal } = f.host();
        const opener = f.opener();
        const child = await f.open();
        await f.edit('Draft after an attempted Save');
        await f.click(f.button('Save'));
        const pending = owner.getSnapshot();
        const draft = child.controller.getState().draft;
        assert.equal(pending.phase, 'unknown');
        assert.equal(f.saves.length, 1);
        assert(f.button('Save').disabled);
        const attempts = structuredClone(journal.observed);
        assert.equal(attempts.length, 1);
        assert.equal(attempts[0].recordId, selectedId);
        assert.equal(attempts[0].outcome, 'unknown');
        assert.equal(attempts[0].flight, false);
        assert.equal(attempts[0].acknowledgment, 'none');

        if (exit === 'Close') {
            assert.equal(f.button('Close').disabled, false);
            await f.click(f.button('Close'));
        } else await f.cancel();

        assert(f.dialog() === null);
        assert(f.doc.activeElement === opener);
        await f.render();
        assert(f.dialog() === null);
        await f.render(true);
        assert(f.dialog() === null, 'An equivalent opening revived the dialog');
        assert(f.doc.activeElement === opener);
        assert.deepEqual(owner.getSnapshot(), pending);
        assert.deepEqual(child.controller.getState().draft, draft);
        assert.deepEqual(journal.observed, attempts);
        assert.equal(await owner.openEdit(selectedId, pending.revision), false);
        assert.deepEqual(f.loads, [selectedId]);
        assert.equal(f.reads(), 1);
        assert.equal(f.saves.length, 1);
        assert.equal(f.submits(), 0);

        await act(async () => {
            assert(
                f
                    .host()
                    .fields.field('fld_title')
                    .setValue('Parent draft update').accepted
            );
        });
        const afterParentEdit = owner.getSnapshot();
        assert(afterParentEdit.revision > pending.revision);
        assert(
            afterParentEdit.child === child &&
                afterParentEdit.phase === 'unknown'
        );
        await f.render(true);
        assert(f.dialog() === null);
        assert(f.doc.activeElement === opener);
        assert.deepEqual(journal.observed, attempts);

        // The host explicitly starts a new intent after checking the old attempt.
        await act(async () => {
            journal.acknowledgeNewIntent(journal.observed[0]);
            owner.close();
        });
        const successor = await f.open();
        assert(f.opener() === opener);
        assert(f.host().owner === owner);
        assert(successor !== child);
        assert(owner.getSnapshot().pages !== pending.pages);
        assert.deepEqual(owner.getSnapshot().intent, {
            type: 'edit',
            recordId: selectedId,
        });
        assert(f.dialog()?.open);
        assert(f.doc.activeElement === f.button('Close'));
        await f.edit('Newly admitted same-record draft');
        assert.equal(
            successor.field('fld_title').getSnapshot().value,
            'Newly admitted same-record draft'
        );
        assert(f.doc.activeElement === f.button('Close'));
        assert.deepEqual(f.loads, [selectedId, selectedId]);
        assert.equal(f.reads(), 1);
        assert.equal(f.saves.length, 1);
        assert.equal(f.submits(), 0);
        assert.deepEqual(journal.observed, [
            { ...attempts[0], acknowledgment: 'new-intent' },
        ]);
    });
}

it('does not admit an unknown Save dismissal from a retired opening', async (t) => {
    const f = await fixture(t, {
        save: async () => {
            throw Error('Synthetic lost Save response');
        },
    });
    await f.open();
    await f.edit('Attempted predecessor edit');
    await f.click(f.button('Save'));
    assert.equal(f.host().owner.getSnapshot().phase, 'unknown');
    f.retireOpening();
    await f.cancel();
    assert(f.dialog()?.open);
    assert(f.doc.activeElement !== f.opener());

    const successor = await f.replace();
    await f.edit('Fresh current draft');
    assert.equal(
        successor.field('fld_title').getSnapshot().value,
        'Fresh current draft'
    );
    assert(f.dialog()?.open);
    assert(f.doc.activeElement === f.button('Close'));
    assert.equal(f.saves.length, 1);
    assert.equal(f.submits(), 0);
});

it('keeps the same-record successor draft and focus when a retired Save settles', async (t) => {
    let release!: (result: SaveFormResult) => void;
    const held = new Promise<SaveFormResult>((resolve) => {
        release = resolve;
    });
    const f = await fixture(t, { save: () => held });
    await f.open();
    await f.edit('Old accepted Save');
    await f.click(f.button('Save'));
    assert.equal(f.host().owner.getSnapshot().phase, 'saving');
    assert.equal(f.saves.length, 1);
    assert(f.button('Close').disabled);
    await f.cancel();
    assert(f.dialog()?.open);
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

it('requires explicit host acknowledgment for required-open credit', async (t) => {
    const f = await fixture(t, { requireOpen: true });
    const { fields, owner } = f.host();
    const pages = createFormPageOwner({
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => pages.dispose());
    await f.open();
    assert(f.dialog()?.open);
    await f.click(f.button('Close'));
    assert.equal(owner.getSnapshot().phase, 'closed');
    assert.equal(pages.getSnapshot().canSubmit, false);
    await act(async () => {
        await assert.rejects(
            pages.submit(pages.getSnapshot().revision),
            FormPageError
        );
    });
    assert.equal(f.saves.length, 0);

    await f.open();
    const { child, revision } = owner.getSnapshot();
    assert(child);
    const presentation = new AbortController();
    t.after(() => presentation.abort());
    await act(async () => {
        assert(
            owner.acknowledgeEditPresentation(
                revision,
                child,
                presentation.signal
            )
        );
    });
    await f.click(f.button('Close'));
    assert.equal(pages.getSnapshot().canSubmit, true);
    assert.equal(f.saves.length, 0);
});
