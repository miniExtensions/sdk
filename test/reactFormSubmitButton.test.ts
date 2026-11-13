import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    type ReactNode,
    type FormEvent,
} from 'react';
import {
    FormSubmitButton,
    type FormSubmitButtonProps,
} from '../src/react/index.js';

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

it('uses the associated host form exactly once without dispatching during render', async (t) => {
    const f = await fixture(t);
    let submits = 0;
    await f.render(
        h(
            'div',
            null,
            h(
                'form',
                {
                    id: 'terminal-form',
                    noValidate: true,
                    onSubmit: (event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        submits++;
                    },
                },
                h('input', { name: 'required', required: true })
            ),
            h(FormSubmitButton, {
                formId: 'terminal-form',
                label: 'Save <literal>',
                mode: 'save',
                saving: false,
                canSubmit: true,
            })
        )
    );
    const button = f.container.querySelector('button');
    assert(button);
    assert.equal(button.type, 'submit');
    assert.equal(button.form?.id, 'terminal-form');
    assert.equal(button.getAttribute('aria-label'), 'Save <literal>');
    assert.equal(button.textContent, 'Save <literal>');
    assert.equal(button.querySelector('literal'), null);
    assert.equal(submits, 0);
    await act(async () => button.click());
    assert.equal(submits, 1);
});

it('updates labels and modes, refuses saving/non-admitted activation and allows retry', async (t) => {
    const f = await fixture(t);
    let submits = 0;
    const render = (props: Partial<FormSubmitButtonProps> = {}) =>
        f.render(
            h(
                'form',
                {
                    id: 'terminal-form',
                    noValidate: true,
                    onSubmit: (event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        submits++;
                    },
                },
                h(FormSubmitButton, {
                    formId: 'terminal-form',
                    label: 'Save',
                    mode: 'save',
                    saving: false,
                    canSubmit: true,
                    ...props,
                })
            )
        );
    await render();
    const button = f.container.querySelector('button');
    assert(button);
    for (const mode of ['compute', 'review', 'save'] as const) {
        await render({ mode, label: mode });
        assert.equal(f.container.querySelector('button'), button);
        assert.equal(button.getAttribute('data-mode'), mode);
        assert.equal(button.getAttribute('aria-label'), mode);
        assert.equal(button.textContent, mode);
    }
    await render({ saving: true });
    assert.equal(button.disabled, true);
    assert(button.querySelector('svg[aria-hidden="true"]'));
    await act(async () => button.click());
    assert.equal(submits, 0);
    await render({ canSubmit: false });
    assert.equal(button.disabled, true);
    assert.equal(button.querySelector('svg'), null);
    await act(async () => button.click());
    assert.equal(submits, 0);
    await render();
    await act(async () => button.click());
    assert.equal(submits, 1);
});
