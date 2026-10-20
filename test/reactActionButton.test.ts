import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ReactNode,
    type FormEvent,
} from 'react';
import { ActionButton } from '../src/react/index.js';

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
    };
}

it('forwards the actual button/ref and native form props without submitting on activation', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLButtonElement>();
    let submits = 0;
    let calls = 0;
    await f.render(
        h(
            'form',
            {
                id: 'action-owner',
                onSubmit: (event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    submits++;
                },
            },
            h(
                ActionButton,
                {
                    ref,
                    id: 'action',
                    name: 'action',
                    value: 'run',
                    form: 'action-owner',
                    className: 'owner-action',
                    'aria-describedby': 'help',
                    onClick: (event) => {
                        assert.equal(event.currentTarget, ref.current);
                        calls++;
                    },
                },
                'Run <literal>'
            )
        )
    );
    const button = f.container.querySelector('button');
    assert(button);
    assert.equal(ref.current, button);
    assert.equal(button.form?.id, 'action-owner');
    assert.equal(button.type, 'button');
    assert.equal(button.className, 'owner-action');
    assert.equal(button.textContent, 'Run <literal>');
    assert.equal(button.getAttribute('aria-describedby'), 'help');
    await act(async () => button.click());
    assert.equal(calls, 1);
    assert.equal(submits, 0);
    await f.render(null);
    assert.equal(ref.current, null);
});

it('blocks native activation while busy or disabled and restores caller content for retry', async (t) => {
    const f = await fixture(t);
    let calls = 0;
    const render = (
        busy: boolean,
        disabled = false,
        busyContent: ReactNode = h('span', null, 'Pending')
    ) =>
        f.render(
            h(
                ActionButton,
                {
                    busy,
                    disabled,
                    busyContent,
                    onClick: () => {
                        calls++;
                    },
                },
                'Run action'
            )
        );
    await render(false);
    const button = f.container.querySelector('button');
    assert(button);
    await act(async () => button.click());
    assert.equal(calls, 1);
    await render(true);
    assert.equal(f.container.querySelector('button'), button);
    assert.equal(button.textContent, 'Pending');
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(button.disabled, true);
    await act(async () => button.click());
    assert.equal(calls, 1);
    await render(false, true);
    assert.equal(button.textContent, 'Run action');
    assert.equal(button.getAttribute('aria-busy'), 'false');
    await act(async () => button.click());
    assert.equal(calls, 1);
    await render(false);
    await act(async () => button.click());
    assert.equal(calls, 2);
    await f.render(h(ActionButton, { busy: true }, 'Keep label'));
    assert.equal(button.textContent, 'Keep label');
    await render(true, false, null);
    assert.equal(button.textContent, '');
});
