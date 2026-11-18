import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    AttachmentUrlInput,
    type AttachmentUrlDraft,
    type AttachmentUrlInputLabels,
    type AttachmentUrlInputProps,
} from '../src/react/index.js';

const labels: AttachmentUrlInputLabels = {
    url: 'Lien de pièce jointe',
    add: 'Ajouter',
    invalidUrl: 'Saisissez une URL HTTP ou HTTPS',
    appendRefused: 'La pièce jointe ne peut pas être ajoutée',
};

async function formFixture(t: TestContext) {
    const url = 'https://form.example.test/';
    const window = new Window({ url });
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const original = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            value,
            configurable: true,
            writable: true,
        });
    const { createRoot } = await import('react-dom/client');
    const form = window.document.createElement('form');
    const request = t.mock.method(globalThis, 'fetch', () =>
        assert.fail('Entering an attachment URL must not allocate a request')
    );
    let submits = 0;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    window.document.body.append(form);
    const root = createRoot(form as unknown as HTMLElement);
    t.after(async () => {
        try {
            await act(async () => root.unmount());
        } finally {
            for (const [key, descriptor] of original) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    const input = () => {
        const control = form.querySelector('input[inputmode="url"]');
        assert.ok(control, 'the public SDK renders a visitor URL textbox');
        return control as typeof window.HTMLInputElement.prototype;
    };
    const add = () => {
        const control = [...form.querySelectorAll('button')].find(
            (button) =>
                button.textContent === labels.add ||
                button.getAttribute('aria-label') === labels.add
        );
        assert.ok(control, 'the Add control has its supplied localized name');
        return control;
    };
    const enter = async (repeat = false, isComposing = false) => {
        const event = new window.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            repeat,
            isComposing,
        });
        await act(async () => input().dispatchEvent(event));
        assert.equal(event.defaultPrevented, !isComposing);
    };
    const edit = async (value: string) => {
        await act(async () => {
            const control = input();
            control.focus();
            const setValue = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            assert.ok(setValue);
            setValue.call(control, value);
            control.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    return {
        form,
        input,
        add,
        enter,
        edit,
        render: (node: ReactNode) =>
            act(async () => root.render(h(StrictMode, null, node))),
        assertNoEffects() {
            assert.equal(submits, 0);
            assert.equal(request.mock.callCount(), 0);
            assert.equal(window.location.href, url);
        },
    };
}

it('stages visitor URLs through click and Enter in the public SDK without submitting the host Form', async (t) => {
    const f = await formFixture(t);
    const first = { id: 'existing', url: 'https://files.example.test/first' };
    const attachments: Array<typeof first | AttachmentUrlDraft> = [first];
    await f.render(
        h(AttachmentUrlInput, {
            id: 'attachment-url',
            labels,
            owner: { token: {}, isCurrent: () => true },
            appendCurrent(attachment) {
                attachments.push(attachment);
                return true;
            },
        })
    );

    assert.equal(f.input().id, 'attachment-url');
    assert.equal(f.input().getAttribute('aria-label'), labels.url);
    assert.equal(f.form.querySelector('form'), null);
    assert.equal(f.add().type, 'button');
    const pointerUrl = 'https://files.example.test/a%20b.pdf?draft=1#preview';
    await f.edit(`  ${pointerUrl}  `);
    await act(async () => f.add().click());
    assert.deepEqual(attachments, [
        first,
        { id: null, url: pointerUrl, filename: 'a b.pdf' },
    ]);
    assert.equal(f.input().value, '');

    const keyboardUrl = 'http://files.example.test/folder/';
    await f.edit(keyboardUrl);
    await f.enter();
    assert.deepEqual(attachments, [
        first,
        { id: null, url: pointerUrl, filename: 'a b.pdf' },
        { id: null, url: keyboardUrl, filename: 'files.example.test' },
    ]);
    assert.equal(f.input().value, '');
    f.assertNoEffects();
});

it('keeps refused input and describes errors, and accepts a malformed path escape exactly once', async (t) => {
    const f = await formFixture(t);
    const staged: AttachmentUrlDraft[] = [];
    let admitted = false;
    let attempts = 0;
    await f.render(
        h(AttachmentUrlInput, {
            labels,
            owner: { token: {}, isCurrent: () => true },
            appendCurrent(value) {
                attempts++;
                if (!admitted) return false;
                staged.push(value);
                // A synchronous host callback can trigger the same control.
                f.add().click();
                return true;
            },
        })
    );
    await f.enter();
    await act(async () => f.add().click());
    assert.equal(attempts, 0);
    assert.equal(f.form.querySelector('[role="alert"]'), null);

    const disallowed = 'ftp://files.example.test/old.pdf';
    await f.edit(disallowed);
    await f.enter();
    assert.equal(attempts, 0);
    assert.equal(f.input().value, disallowed);
    const error = f.form.querySelector('[role="alert"]');
    assert.equal(error?.textContent, labels.invalidUrl);
    assert.equal(f.input().getAttribute('aria-describedby'), error?.id);

    const malformedPath = 'https://files.example.test/%E0%A4%A?raw=1#preview';
    await f.edit(malformedPath);
    await f.enter(true);
    await f.enter(false, true);
    assert.equal(attempts, 0);
    await f.enter();
    assert.equal(attempts, 1);
    assert.equal(f.input().value, malformedPath);
    assert.equal(
        f.form.querySelector('[role="alert"]')?.textContent,
        labels.appendRefused
    );
    assert.deepEqual(staged, []);

    admitted = true;
    await act(async () => {
        f.add().click();
        f.add().click();
    });
    assert.equal(attempts, 2);
    assert.deepEqual(staged, [
        { id: null, url: malformedPath, filename: '%E0%A4%A' },
    ]);
    assert.equal(f.input().value, '');
    assert.equal(f.form.querySelector('[role="alert"]'), null);
    f.assertNoEffects();
});

it('refuses retired controls and does not carry a URL into a replacement, readonly, masked or full owner', async (t) => {
    const f = await formFixture(t);
    const staged: AttachmentUrlDraft[] = [];
    let current = true;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of [...listeners]) listener();
    };
    const firstOwner = {
        token: {},
        isCurrent: () => current,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const nextOwner = { token: {}, isCurrent: () => true };
    const props: AttachmentUrlInputProps = {
        labels,
        owner: firstOwner,
        appendCurrent(attachment) {
            staged.push(attachment);
            return true;
        },
    };
    await f.render(h(AttachmentUrlInput, props));
    assert.equal(listeners.size, 1);
    const firstButton = f.add();
    const url = 'https://files.example.test/on-current-owner.pdf';
    await f.edit(url);
    current = false;
    await f.enter();
    await act(async () => firstButton.click());
    assert.deepEqual(staged, []);
    await act(async () => notify());
    assert.equal(listeners.size, 0);
    assert.equal(f.form.querySelector('input'), null);
    await f.render(h(AttachmentUrlInput, { ...props, owner: nextOwner }));
    assert.equal(f.input().value, '');
    await act(async () => firstButton.click());
    assert.deepEqual(staged, []);

    for (const flag of ['readOnly', 'masked', 'full'] as const) {
        await f.edit(url);
        const prior = f.add();
        await f.render(
            h(AttachmentUrlInput, { ...props, owner: nextOwner, [flag]: true })
        );
        assert.equal(f.form.querySelector('input'), null);
        await act(async () => prior.click());
        await f.render(h(AttachmentUrlInput, { ...props, owner: nextOwner }));
        assert.equal(f.input().value, '');
    }
    await f.edit(url);
    await f.enter();
    assert.deepEqual(staged, [
        { id: null, url, filename: 'on-current-owner.pdf' },
    ]);
    f.assertNoEffects();
});
