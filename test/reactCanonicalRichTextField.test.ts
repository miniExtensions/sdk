import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import { act, createElement as h, type FormEvent } from 'react';
import {
    RichTextField,
    type ControlledRichTextFieldProps,
} from '../src/react/index.js';
import type {
    FormFieldBinding,
    FormFieldSnapshot,
} from '../src/forms/bindings.js';
import {
    completeRichTextFixture,
    ControlledCanonicalRichTextField,
} from './completeRichTextTestHarness.js';

function textbox(container: HTMLElement) {
    const element = container.querySelector<HTMLElement>(
        '.ProseMirror[role="textbox"]'
    );
    assert(element, 'The canonical field must mount its complete real editor');
    return element;
}

async function paste(window: Window, target: HTMLElement, text: string) {
    const event = new window.Event('paste', {
        bubbles: true,
        cancelable: true,
    });
    Object.defineProperty(event, 'clipboardData', {
        value: {
            types: ['text/plain'],
            files: [],
            items: [],
            getData: (type: string) => (type === 'text/plain' ? text : ''),
        },
    });
    await act(async () => target.dispatchEvent(event as unknown as Event));
}

it('uses the canonical controlled API for real Markdown, stored checkbox paste, readonly and field associations', async (t) => {
    const f = await completeRichTextFixture(t);
    const writes: string[] = [];
    let submits = 0;
    const render = (readOnly = false) =>
        f.render(
            h(
                'form',
                {
                    id: 'notes-form',
                    onSubmit: (event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        submits++;
                    },
                },
                h('label', { id: 'notes-label', htmlFor: 'notes' }, 'Notes'),
                h('p', { id: 'notes-help' }, 'Describe the request.'),
                h('p', { id: 'notes-error' }, 'Add more detail.'),
                h(ControlledCanonicalRichTextField, {
                    initial: '**Bold** and _italic_\n\n[ ] task',
                    writes,
                    readOnly,
                    id: 'notes',
                    ariaLabelledBy: 'notes-label',
                    ariaDescribedBy: 'notes-help notes-error',
                    ariaInvalid: true,
                    identity: 'record:notes',
                }),
                h('input', { name: 'sibling', defaultValue: 'untouched' })
            )
        );
    await render();
    const input = textbox(f.container);
    assert.equal(input.querySelector('strong')?.textContent, 'Bold');
    assert.equal(input.querySelector('em')?.textContent, 'italic');
    const checkbox = input.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
    );
    assert(checkbox);
    assert.equal(checkbox.checked, false);
    assert.equal(input.id, 'notes');
    assert.equal(input.closest('form')?.id, 'notes-form');
    assert.equal(input.getAttribute('aria-labelledby'), 'notes-label');
    assert.equal(
        input.getAttribute('aria-describedby'),
        'notes-help notes-error'
    );
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(writes, []);
    await paste(f.window, input, '# Heading\n\n[x] Pasted task');
    assert.equal(writes.length, 1);
    assert.match(writes[0]!, /\[x\] Pasted task/);
    assert(input.querySelector('input[type="checkbox"]:checked'));
    assert.doesNotMatch(writes[0]!, /^- \[x\]/m);
    await paste(f.window, input, 'Canonical paste ');
    assert.equal(writes.length, 2);
    assert.match(writes[1]!, /Canonical paste/);
    assert.match(writes[1]!, /\*\*[^*]*Bold\*\*/);
    assert.equal(textbox(f.container), input);
    assert.equal(
        f.container.querySelector<HTMLInputElement>('[name="sibling"]')?.value,
        'untouched'
    );
    await render(true);
    assert.equal(textbox(f.container), input);
    assert.equal(input.getAttribute('contenteditable'), 'false');
    const accepted = input.innerHTML;
    await paste(f.window, input, 'Refused');
    assert.equal(input.innerHTML, accepted);
    assert.equal(writes.length, 2);
    assert.equal(submits, 0);
});

it('keeps canonical metadata updates on the current editor and retires equal-value owners and empty views', async (t) => {
    const f = await completeRichTextFixture(t);
    const writes: string[] = [];
    const render = (props: Partial<ControlledRichTextFieldProps> = {}) =>
        f.render(
            h(RichTextField, {
                value: '**Owned**',
                onValueChange: (stored) => writes.push(stored),
                identity: 'record-one',
                id: 'notes',
                emptyContent: h('p', { lang: 'es' }, 'Sin notas'),
                ...props,
            })
        );
    await render();
    const first = textbox(f.container);
    const text = first.querySelector('strong')?.firstChild;
    assert(text);
    const range = f.document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 3);
    f.document.getSelection()?.removeAllRanges();
    f.document.getSelection()?.addRange(range);
    await render({ id: 'notes-updated', ariaInvalid: true });
    assert.equal(textbox(f.container), first);
    assert.equal(f.document.getSelection()?.toString(), 'wn');
    assert.equal(first.id, 'notes-updated');
    assert.equal(first.getAttribute('aria-invalid'), 'true');
    await render({ identity: 'record-two' });
    const current = textbox(f.container);
    assert.notEqual(current, first);
    assert.equal(first.isConnected, false);
    await paste(f.window, first, 'Retired');
    assert.deepEqual(writes, []);
    assert.equal(current.querySelector('strong')?.textContent, 'Owned');
    await render({ identity: 'record-two', value: null, readOnly: true });
    assert.equal(f.container.querySelector('[role="textbox"]'), null);
    assert.equal(
        f.container.querySelector('[lang="es"]')?.textContent,
        'Sin notas'
    );
    await render({ identity: 'record-two', value: '', readOnly: true });
    assert.equal(textbox(f.container).textContent, '');
    assert.equal(f.container.querySelector('[lang="es"]'), null);
    await render({ identity: 'record-two', value: null });
    const editable = textbox(f.container);
    assert.equal(editable.getAttribute('contenteditable'), 'true');
    await paste(f.window, editable, 'Current');
    assert.deepEqual(writes, ['Current']);
});

it('switches canonical controlled and literal binding contracts without leaking subscriptions or borrowing writes', async (t) => {
    const f = await completeRichTextFixture(t);
    const literal = '  **literal** <b>escaped</b>\r\n';
    const snapshot: FormFieldSnapshot = {
        field: {
            fieldId: 'rich',
            title: 'Stored notes',
            fieldType: 'richText',
            isComputed: false,
            readOnly: false,
            schema: {
                fieldType: 'richText',
                miniExtConfig: {},
                airtableField: {
                    id: 'rich',
                    name: 'Stored notes',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: { type: 'richText', options: null },
                },
            },
        },
        value: literal,
        dirty: false,
        revision: 0,
        visibility: { type: 'visible', diagnostics: [] },
        readOnly: false,
        canEdit: true,
        pending: false,
        error: null,
        validation: [],
        selection: null,
        retired: false,
    };
    let subscribers = 0;
    const binding: FormFieldBinding = {
        getSnapshot: () => snapshot,
        subscribe() {
            subscribers++;
            return () => {
                subscribers--;
            };
        },
        setValue() {
            throw Error('Literal binding cannot write');
        },
        scalar: null,
        date: null,
        selection: null,
    };
    for (const name of ['setValue', 'scalar', 'selection', 'date', 'save'])
        Object.defineProperty(binding, name, {
            get() {
                throw Error(`Literal field cannot borrow ${name}`);
            },
        });
    await f.render(h(RichTextField, { binding }));
    assert.equal(subscribers, 1);
    assert.equal(f.container.querySelector('output')?.textContent, literal);
    assert.equal(f.container.querySelector('strong,b,[contenteditable]'), null);
    const writes: string[] = [];
    await f.render(
        h(RichTextField, {
            value: '**Editor**',
            onValueChange: (value) => writes.push(value),
        })
    );
    assert.equal(subscribers, 0);
    const input = textbox(f.container);
    assert.equal(input.querySelector('strong')?.textContent, 'Editor');
    await f.render(h(RichTextField, { binding }));
    assert.equal(subscribers, 1);
    assert.equal(input.isConnected, false);
    assert.equal(f.container.querySelector('output')?.textContent, literal);
    await paste(f.window, input, 'Late');
    assert.deepEqual(writes, []);
    await f.render(null);
    assert.equal(subscribers, 0);
});
