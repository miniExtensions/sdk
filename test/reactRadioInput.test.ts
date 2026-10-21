import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    useState,
    type ReactNode,
} from 'react';
import { RadioInput } from '../src/react/index.js';

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

it('forwards native ref, form/ARIA and bubbling selection intent without submitting', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLInputElement>();
    const intents: boolean[] = [];
    let submits = 0,
        parentClicks = 0;
    function Host() {
        const [checked, set] = useState(false);
        return h(
            'form',
            {
                id: 'choice-form',
                onSubmit: (e) => {
                    e.preventDefault();
                    submits++;
                },
                onClick: () => parentClicks++,
            },
            h('label', { htmlFor: 'choice' }, 'Priority'),
            h(RadioInput, {
                id: 'choice',
                name: 'priority',
                value: 'canonical',
                form: 'choice-form',
                'aria-describedby': 'choice-help',
                checked,
                ref,
                onCheckedChange(next, event) {
                    assert.equal(event.currentTarget, ref.current);
                    intents.push(next);
                    set(next);
                },
            })
        );
    }
    await f.render(h(Host));
    const input = f.input();
    assert.equal(ref.current, input);
    assert.equal(input.type, 'radio');
    assert.equal(input.getAttribute('form'), 'choice-form');
    assert.equal(input.getAttribute('aria-describedby'), 'choice-help');
    await act(async () => input.click());
    assert.deepEqual(intents, [true]);
    assert.equal(input.checked, true);
    await act(async () => input.click());
    assert.deepEqual(intents, [true]);
    assert.equal(parentClicks, 2);
    assert.equal(submits, 0);
});

it('supports opt-in repeat-click clear and keeps refused intents controlled', async (t) => {
    const f = await fixture(t);
    const intents: boolean[] = [];
    const view = (checked: boolean) =>
        h(RadioInput, {
            checked,
            allowDeselect: true,
            onCheckedChange: (next) => intents.push(next),
        });
    await f.render(view(false));
    await act(async () => f.input().click());
    assert.deepEqual(intents, [true]);
    assert.equal(f.input().checked, false);
    await f.render(view(true));
    await act(async () => f.input().click());
    assert.deepEqual(intents, [true, false]);
    assert.equal(f.input().checked, true);
    await f.render(view(false));
    assert.equal(f.input().checked, false);
});

it('denies disabled, readonly and cancelled native activation without selection writes', async (t) => {
    const f = await fixture(t);
    let writes = 0;
    let focus = 0;
    for (const policy of [
        { disabled: true },
        { readOnly: true },
        {
            onClickCapture: (e: import('react').MouseEvent<HTMLInputElement>) =>
                e.preventDefault(),
        },
    ]) {
        await f.render(
            h(RadioInput, {
                ...policy,
                checked: false,
                allowDeselect: true,
                onFocus: () => focus++,
                onCheckedChange: () => writes++,
            })
        );
        await act(async () => f.input().click());
        assert.equal(writes, 0);
        assert.equal(f.input().checked, false);
    }
    await f.render(
        h(RadioInput, {
            checked: false,
            onFocus: () => focus++,
            onCheckedChange: () => writes++,
        })
    );
    await act(async () => f.input().focus());
    assert.equal(focus, 1);
});
