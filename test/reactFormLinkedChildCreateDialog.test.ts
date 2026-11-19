import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { FormLinkedChildCreateDialog } from '../src/react/FormLinkedChildCreateDialog.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type { SaveFormInput, SaveFormResult } from '../src/runtime/types.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';
import {
    childForm,
    childSaved,
    parentForm,
    validationError,
} from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

async function fixture(t: TestContext, save?: () => Promise<SaveFormResult>) {
    const dom = await htmlPresentationFixture(t);
    const doc = dom.window.document;
    const style = doc.createElement('style');
    style.textContent = 'button, input { visibility: visible; }';
    doc.head.append(style);
    const prototype = dom.window.HTMLElement.prototype;
    const geometry = Object.getOwnPropertyDescriptor(
        prototype,
        'getClientRects'
    );
    Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
        configurable: true,
        value: function (this: HTMLElement) {
            return this.dataset.laidOut === 'false' ? [] : [{}];
        },
    });
    t.after(() => {
        if (geometry)
            Object.defineProperty(prototype, 'getClientRects', geometry);
        else Reflect.deleteProperty(prototype, 'getClientRects');
    });
    const opener = doc.createElement('button');
    const outside = doc.createElement('button');
    doc.body.append(opener, outside);
    const parent = parentForm('edit');
    const child = childForm('edit');
    child.payload.formRecord.data.fld_title = '';
    child.payload.formFieldIdsWithUnsavedChanges = [];
    const schema = child.payload.fieldIdsToSchemas.fld_title!;
    assert.equal(schema.fieldType, 'singleLineText');
    if (schema.fieldType !== 'singleLineText')
        throw Error('Unexpected fixture field');
    Object.assign(schema, {
        miniExtConfig: { ...schema.miniExtConfig, required: true },
    });
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://create.test',
        fetch: async () => {
            throw Error('Unexpected real transport');
        },
    });
    const saves: SaveFormInput[] = [];
    client.loadExtension = async () => structuredClone(child);
    client.forms.save = async (input) => {
        saves.push(input);
        return save ? save() : childSaved('edit');
    };
    const fields = createFormFieldBindings({
        loaded: parent,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'synthetic-create-parent', revision: 0 }),
    });
    t.after(() => fields.destroy());
    const owner = fields.linkedChild('fld_children_a', {
        journal: new RecoveryJournal(),
        loadVersion: 1,
    });
    assert.equal(await owner.openCreate(), true);
    const installedChild = owner.getSnapshot().child;
    assert(installedChild);
    let current = true;
    const opening = {
        opener: opener as unknown as HTMLButtonElement,
        child: installedChild,
        isCurrent: () => current,
    };
    const dialog = () => doc.querySelector('dialog');
    const readButton = (label: string) => {
        const found = [...(dialog()?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === label
        );
        assert(found, `Missing ${label}`);
        return found;
    };
    const props = {
        owner,
        opening,
        renderFields: () => h('input', { 'aria-label': 'Child title' }),
    };
    const render = () => dom.render(h(FormLinkedChildCreateDialog, props));
    const edit = (value: string) =>
        act(async () => {
            installedChild.field('fld_title').setValue(value);
        });
    const dismiss = async () => {
        const target = dialog();
        assert(target);
        const event = new dom.window.Event('cancel', { cancelable: true });
        await act(async () => {
            target.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };
    const tab = async (shiftKey: boolean) => {
        const event = new dom.window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            doc.activeElement?.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };
    return {
        ...dom,
        doc,
        owner,
        fields,
        opener,
        outside,
        saves,
        parent,
        props,
        render,
        edit,
        tab,
        dismiss,
        dialog,
        readButton,
        retire: () => {
            current = false;
        },
    };
}

it('mounts the named Create portal, contains keyboard focus, and closes cleanly', async (t) => {
    const f = await fixture(t);
    f.opener.focus();
    await f.render();
    const dialog = f.dialog();
    assert(dialog?.open);
    assert.equal(
        f.doc.getElementById(dialog.getAttribute('aria-labelledby')!)
            ?.textContent,
        'Create linked record'
    );
    assert.ok(f.doc.activeElement === f.readButton('Close'));
    assert.equal(await f.tab(true), true);
    assert.ok(f.doc.activeElement === f.readButton('Save'));
    assert.equal(await f.tab(false), true);
    assert.ok(f.doc.activeElement === f.readButton('Close'));
    assert.equal(await f.tab(false), false);
    assert.equal(await f.dismiss(), true);
    assert.ok(f.dialog() === null);
    assert.ok(f.doc.activeElement === f.opener);
    assert.deepEqual(f.saves, []);
});

it('keeps dirty input through Keep editing and Escape, then closes without writing', async (t) => {
    const f = await fixture(t);
    await f.render();
    await f.edit('Keep this owned value');
    await f.click(f.readButton('Close'));
    assert.ok(f.doc.activeElement === f.readButton('Keep editing'));
    await f.click(f.readButton('Keep editing'));
    assert.equal(
        f.owner.getSnapshot().child?.field('fld_title').getSnapshot().value,
        'Keep this owned value'
    );
    await f.dismiss();
    assert.ok(f.doc.activeElement === f.readButton('Keep editing'));
    await f.dismiss();
    assert(f.dialog()?.open);
    await f.click(f.readButton('Close'));
    await f.click(f.readButton('Close without saving'));
    assert.ok(f.dialog() === null);
    assert.equal(f.owner.getSnapshot().phase, 'closed');
    assert.deepEqual(f.saves, []);
});

it('refuses blank Save, then accepts one current child Save and links it', async (t) => {
    const f = await fixture(t);
    await f.render();
    await f.click(f.readButton('Save'));
    assert.match(
        f.dialog()?.textContent ?? '',
        /Complete the child Form before saving/
    );
    assert.equal(f.saves.length, 0);
    const submit = new f.window.Event('submit', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        f.dialog()?.dispatchEvent(submit);
    });
    assert.equal(submit.defaultPrevented, true);
    await f.edit('Accepted child');
    await f.click(f.readButton('Save'));
    assert.equal(f.owner.getSnapshot().phase, 'saved');
    assert.equal(f.saves.length, 1);
    assert.equal(f.saves[0]?.formRecord.data.fld_title, 'Accepted child');
    assert.ok(
        f.doc.activeElement === f.opener,
        `Expected the original opener, got ${f.doc.activeElement?.tagName}`
    );
    assert.deepEqual(f.fields.field('fld_children_a').getSnapshot().value, [
        'rec_existing',
        'rec_existing',
        'rec_sibling',
        'rec_created',
    ]);
});

it('reports the owner’s validation error and blocks a detached confirmation', async (t) => {
    const f = await fixture(t, async () => validationError);
    await f.render();
    await f.edit('Refused by the host');
    await f.click(f.readButton('Save'));
    assert.match(
        f.dialog()?.textContent ?? '',
        /Review the returned child validation errors/
    );
    assert.equal(f.saves.length, 1);
    await f.click(f.readButton('Close'));
    const confirm = f.readButton('Close without saving');
    f.retire();
    await f.click(confirm);
    await f.render();
    assert.ok(f.dialog() === null);
    assert.ok(f.owner.getSnapshot().child === f.props.opening.child);
    assert.equal(f.saves.length, 1);
});

it('blocks duplicate Save and dismissal during a held request without restoring retired focus', async (t) => {
    let finish!: (result: SaveFormResult) => void;
    const held = new Promise<SaveFormResult>((resolve) => {
        finish = resolve;
    });
    const f = await fixture(t, () => held);
    await f.render();
    await f.edit('Held child');
    const save = f.readButton('Save');
    await f.click(save);
    assert.equal(f.owner.getSnapshot().phase, 'saving');
    assert.equal(f.readButton('Close').disabled, true);
    await f.click(save);
    await f.dismiss();
    assert(f.dialog()?.open);
    assert.equal(f.saves.length, 1);
    f.retire();
    await f.render();
    f.outside.focus();
    await act(async () => finish(childSaved('edit')));
    assert.equal(f.owner.getSnapshot().phase, 'saved');
    assert.ok(f.doc.activeElement === f.outside);
    assert.equal(f.saves.length, 1);
});
