import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ReactNode,
} from 'react';
import { TextInput, InputClearButton } from '../src/react/index.js';

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
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
        keys.forEach((key, i) => {
            const original = originals[i];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    return {
        window,
        container,
        input,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        edit: async (value: string) => {
            await act(async () => {
                const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!;
                setter.call(input(), value);
                input().dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
    };
}

it('forwards the native ref, host form/label/ARIA and bubbling controlled change without adding markup', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLInputElement>();
    const edits: string[] = [];
    let parentChanges = 0;
    const view = (value: string) =>
        h(
            'div',
            {
                onChange: () => {
                    parentChanges++;
                },
            },
            h('form', { id: 'host-form' }),
            h('label', { htmlFor: 'host-input' }, 'Host title'),
            h('p', { id: 'host-description' }, 'Description'),
            h(TextInput, {
                ref,
                id: 'host-input',
                form: 'host-form',
                name: 'answer',
                type: 'text',
                value,
                className: 'host-style',
                placeholder: 'Host placeholder',
                autoComplete: 'off',
                'aria-describedby': 'host-description',
                'aria-invalid': true,
                onChange: (event) => {
                    assert.ok(Object.is(event.currentTarget, f.input()));
                    edits.push(event.currentTarget.value);
                },
            })
        );
    await f.render(view('baseline'));
    assert.ok(Object.is(ref.current, f.input()));
    assert.equal(f.input().form?.id, 'host-form');
    assert.equal(f.input().name, 'answer');
    assert.equal(f.input().className, 'host-style');
    assert.equal(f.input().placeholder, 'Host placeholder');
    assert.equal(f.input().autocomplete, 'off');
    assert.equal(
        f.input().getAttribute('aria-describedby'),
        'host-description'
    );
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(f.container.querySelectorAll('input').length, 1);
    assert.equal(f.container.querySelectorAll('label').length, 1);
    assert.deepEqual(edits, []);
    ref.current!.focus();
    ref.current!.setSelectionRange(1, 4);
    assert.equal(f.input().selectionStart, 1);
    assert.equal(f.input().selectionEnd, 4);
    await f.edit('new native draft');
    assert.deepEqual(edits, ['new native draft']);
    assert.equal(parentChanges, 1);
    assert.equal(f.input().value, 'baseline');
    await f.render(view('accepted'));
    assert.equal(f.input().value, 'accepted');
    assert.deepEqual(edits, ['new native draft']);
    await f.render(null);
    assert.equal(ref.current, null);
    await f.render(view('restored'));
    assert.equal(f.input().value, 'restored');
    assert.deepEqual(edits, ['new native draft']);
});

it('retains partial numeric text exactly and forwards composition, keyboard and focus events', async (t) => {
    const f = await fixture(t);
    const edits: string[] = [];
    const events: string[] = [];
    for (const value of ['-', '1,', '0.', '-0', '12.50']) {
        await f.render(
            h(TextInput, {
                type: 'text',
                inputMode: 'decimal',
                value,
                onChange: (event) => edits.push(event.currentTarget.value),
                onCompositionStart: () => events.push('compositionstart'),
                onCompositionEnd: () => events.push('compositionend'),
                onKeyDown: () => events.push('keydown'),
                onBlur: () => events.push('blur'),
            })
        );
        assert.equal(f.input().value, value);
        assert.equal(f.input().inputMode, 'decimal');
        assert.deepEqual(edits, []);
    }
    await act(async () => {
        f.input().focus();
        f.input().dispatchEvent(
            new f.window.CompositionEvent('compositionstart', { bubbles: true })
        );
        f.input().dispatchEvent(
            new f.window.CompositionEvent('compositionend', { bubbles: true })
        );
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Enter',
            })
        );
        f.input().blur();
    });
    assert.deepEqual(events, [
        'compositionstart',
        'compositionend',
        'keydown',
        'blur',
    ]);
    assert.deepEqual(edits, []);
});

it('keeps native email/password constraints and callback-ref replacement without creating a write policy', async (t) => {
    const f = await fixture(t);
    const refs: (HTMLInputElement | null)[] = [];
    const nextRef = createRef<HTMLInputElement>();
    const props = {
        value: 'literal@invalid',
        required: true,
        maxLength: 32,
        readOnly: true,
        disabled: true,
        onChange: () => assert.fail('No input event dispatched'),
    };
    await f.render(
        h(TextInput, {
            ...props,
            type: 'email',
            ref: (node) => refs.push(node),
        })
    );
    assert.equal(f.input().type, 'email');
    assert.equal(f.input().required, true);
    assert.equal(f.input().maxLength, 32);
    assert.equal(f.input().readOnly, true);
    assert.equal(f.input().disabled, true);
    assert.ok(Object.is(refs.at(-1), f.input()));
    await f.render(h(TextInput, { ...props, type: 'password', ref: nextRef }));
    assert.equal(refs.at(-1), null);
    assert.ok(Object.is(nextRef.current, f.input()));
    assert.equal(f.input().type, 'password');
    assert.equal(f.input().value, 'literal@invalid');
    await f.render(null);
    assert.equal(nextRef.current, null);
});

it('clear presentation forwards its native ref and remains a non-submitting owner action', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLButtonElement>();
    let clears = 0,
        submits = 0;
    const runtimeProps = {
        label: 'Clear amount',
        ref,
        type: 'submit',
        className: 'host-clear',
        indicatorClassName: 'host-indicator',
        iconClassName: 'host-icon',
        'aria-controls': 'owned-amount',
        onClick: () => {
            clears++;
        },
    };
    await f.render(
        h(
            'form',
            {
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            h(TextInput, { id: 'owned-amount', value: '1,', readOnly: true }),
            h(InputClearButton, runtimeProps)
        )
    );
    const button = f.container.querySelector('button');
    assert.ok(button);
    assert.ok(Object.is(ref.current, button));
    assert.equal(button.type, 'button');
    assert.equal(button.className, 'host-clear');
    assert.equal(button.getAttribute('aria-label'), 'Clear amount');
    assert.equal(button.getAttribute('aria-controls'), 'owned-amount');
    assert.equal(button.querySelector('span')?.className, 'host-indicator');
    assert.equal(
        button.querySelector('svg')?.getAttribute('class'),
        'host-icon'
    );
    await act(async () => {
        const current = button;
        assert.ok(current);
        current.click();
    });
    assert.equal(clears, 1);
    assert.equal(submits, 0);
    assert.equal(f.input().value, '1,');
    await f.render(null);
    assert.equal(ref.current, null);
});

it('clear presentation keeps disabled native activation and literal labels under owner replacement', async (t) => {
    const f = await fixture(t);
    let clears = 0;
    const view = (disabled: boolean, label: string) =>
        h(InputClearButton, {
            label,
            disabled,
            onClick: () => {
                clears++;
            },
        });
    await f.render(view(true, 'Clear <b>draft</b>'));
    let button = f.container.querySelector('button');
    assert.ok(button);
    assert.equal(button.getAttribute('aria-label'), 'Clear <b>draft</b>');
    assert.equal(button.querySelector('b'), null);
    assert.equal(
        button.querySelector('svg')?.getAttribute('aria-hidden'),
        'true'
    );
    await act(async () => {
        const current = button;
        assert.ok(current);
        current.click();
    });
    assert.equal(clears, 0);
    await f.render(view(false, 'Effacer'));
    button = f.container.querySelector('button');
    assert.ok(button);
    assert.equal(button.getAttribute('aria-label'), 'Effacer');
    await act(async () => {
        const current = button;
        assert.ok(current);
        current.click();
    });
    assert.equal(clears, 1);
    await f.render(null);
    await f.render(view(true, 'Effacer'));
    button = f.container.querySelector('button');
    assert.ok(button);
    await act(async () => {
        const current = button;
        assert.ok(current);
        current.click();
    });
    assert.equal(clears, 1);
});
