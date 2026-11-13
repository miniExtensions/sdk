import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type RefAttributes,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    SingleLineTextField,
    type ControlledSingleLineTextFieldProps,
    type SingleLineTextFieldProps,
    TextField,
    renderSingleLineTextField,
} from '../src/react/index.js';

function declarations(
    binding: import('../src/react/index.js').TextFieldProps['binding']
) {
    h(TextField, { binding });
    assert.equal(typeof renderSingleLineTextField, 'function');
    const immediate: SingleLineTextFieldProps = {
        mode: 'controlled',
        value: null,
        onChange: () => {},
        language: 'en',
    };
    h(SingleLineTextField, immediate);
    // @ts-expect-error Native deferred editing requires captured host authority.
    h(SingleLineTextField, { ...immediate, enableInlineEdit: true });
    // @ts-expect-error A controlled field does not manufacture a binding.
    h(SingleLineTextField, { ...immediate, binding });
    h(SingleLineTextField, {
        mode: 'readOnly',
        value: '',
        language: 'en',
        // @ts-expect-error Display-only fields have no writer.
        onChange: () => {},
    });
}
void declarations;

async function fixture(t: TestContext) {
    const window = new Window({ url: 'https://single-line.example.test/' });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLButtonElement',
        'IS_REACT_ACT_ENVIRONMENT',
        'fetch',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let requests = 0;
    const noRequest = async () => {
        requests++;
        throw new Error('Unexpected provider action');
    };
    Object.defineProperty(window, 'fetch', { value: noRequest });
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? noRequest
                      : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'single-line-form';
    window.document.body.append(container);
    let submits = 0;
    container.addEventListener('submit', (event) => {
        submits++;
        event.preventDefault();
    });
    const root = createRoot(container as unknown as HTMLElement);
    const writes: string[] = [];
    let current = true;
    let unmounted = false;
    let props: ControlledSingleLineTextFieldProps &
        RefAttributes<HTMLInputElement> = {
        mode: 'controlled',
        value: 'seed',
        language: 'en',
        onChange: (value) => writes.push(value),
        id: 'single-line',
        form: 'single-line-form',
        initialMobile: true,
        owner: { token: {}, isCurrent: () => current },
    };
    const render = async (
        overrides: Partial<
            ControlledSingleLineTextFieldProps & RefAttributes<HTMLInputElement>
        > = {}
    ) => {
        props = {
            ...props,
            ...overrides,
        } as ControlledSingleLineTextFieldProps &
            RefAttributes<HTMLInputElement>;
        await act(async () =>
            root.render(h(StrictMode, null, h(SingleLineTextField, props)))
        );
        assert.equal(submits, 0);
        assert.equal(requests, 0);
    };
    const input = () => {
        const result = container.querySelector('input');
        assert.ok(result);
        return result;
    };
    const edit = async (value: string, start?: number, end = start) => {
        await act(async () => {
            input().focus();
            const set = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            assert.ok(set);
            set.call(input(), value);
            if (start != null) input().setSelectionRange(start, end ?? start);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    const unmount = async () => {
        if (unmounted) return;
        unmounted = true;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        current = false;
        try {
            await unmount();
            assert.equal(submits, 0);
            assert.equal(requests, 0);
        } finally {
            keys.forEach((key, index) => {
                const original = originals[index];
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    return {
        window,
        root,
        container,
        writes,
        render,
        input,
        edit,
        unmount,
        retire: () => {
            current = false;
        },
    };
}

it('SSR preserves literal null/string display without a provider or writer', () => {
    for (const value of [null, '', 'literal <tag>  ']) {
        const html = renderToStaticMarkup(
            h(SingleLineTextField, {
                mode: 'controlled',
                value,
                language: 'en',
                initialMobile: false,
                onChange: () => assert.fail('SSR must not write'),
            })
        );
        assert.match(html, /type="text"/);
        assert.doesNotMatch(html, /owner=|enableInlineEdit=|mode=/);
        if (value) assert.match(html, /literal &lt;tag&gt;  /);
    }
});

it('keeps empty-string writes, trailing whitespace and native UTF-16 slicing', async (t) => {
    const f = await fixture(t);
    await f.render({ characterLimit: 2 });
    await f.edit('a😀z');
    assert.deepEqual(f.writes, ['a\ud83d']);
    await f.render({ characterLimit: undefined });
    await f.edit('text  ');
    assert.equal(f.writes.at(-1), 'text  ');
    await f.render({ value: 'text  ' });
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    assert.equal(clear.type, 'button');
    await act(async () => clear.click());
    assert.equal(f.writes.at(-1), '');
});

it('captures and restores selection at the immediate parent change', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLInputElement>();
    await f.render({
        ref,
        title: 'Name',
        describedBy: 'help error',
        invalid: true,
        characterLimit: 8,
    });
    assert.equal(ref.current, f.input());
    assert.equal(f.input().getAttribute('form'), 'single-line-form');
    assert.equal(f.input().getAttribute('aria-describedby'), 'help error');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await f.edit('abXYZcd', 2, 5);
    await f.render({ value: 'abXYZcd' });
    assert.equal(f.input().selectionStart, 2);
    assert.equal(f.input().selectionEnd, 5);
    assert.equal(
        f.container.querySelector('[title="Character Limit"]')?.textContent,
        '7/8'
    );
});

it('readOnly configuration ignores an editable character limit and removes its counter', async (t) => {
    const f = await fixture(t);
    await f.render({ readOnly: true, characterLimit: 1, value: 'long value' });
    assert.equal(f.input().hasAttribute('maxlength'), false);
    assert.equal(f.container.querySelector('[title="Character Limit"]'), null);
    await f.edit('replacement');
    assert.deepEqual(f.writes, []);
});

it('defers both the bound and caret capture until the native parent blur handler runs', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true, characterLimit: 4 });
    await f.edit('abcdef', 1, 3);
    assert.deepEqual(f.writes, []);
    f.input().setSelectionRange(2, 4);
    await act(async () => f.input().blur());
    assert.deepEqual(f.writes, ['abcd']);
    assert.equal(f.input().selectionStart, 2);
    assert.equal(f.input().selectionEnd, 4);
    // The deferred input later reconciles its local text from an accepted
    // parent echo. That is a separate native effect, not the caret capture.
    await f.render({ value: 'abcd' });
    assert.equal(f.input().value, 'abcd');
});

it('preserves deferred IME Enter and commits ordinary Enter without Submit', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('編集中');
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
                isComposing: true,
            })
        )
    );
    assert.deepEqual(f.writes, []);
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.deepEqual(f.writes, ['編集中']);
});

it('settles a genuine current-owner deferred unmount exactly once under StrictMode', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('pending  ');
    await f.unmount();
    assert.deepEqual(f.writes, ['pending  ']);
});

for (const replacement of ['owner', 'disable', 'password'] as const)
    it(`retires a dirty deferred writer across ${replacement} A-B-A replacement`, async (t) => {
        const f = await fixture(t);
        const owner = { token: {}, isCurrent: () => true };
        await f.render({ enableInlineEdit: true, owner });
        await f.edit('obsolete');
        await f.render(
            replacement === 'owner'
                ? { owner: { token: {}, isCurrent: () => true } }
                : replacement === 'disable'
                  ? { disabled: true }
                  : { obscurePassword: true }
        );
        await f.render({ owner, disabled: false, obscurePassword: false });
        assert.deepEqual(f.writes, []);
        await f.edit('current');
        await act(async () => f.input().blur());
        assert.deepEqual(f.writes, ['current']);
    });

it('checks current host authority at deferred admission without a rerender', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('retired');
    f.retire();
    await act(async () => f.input().blur());
    await f.unmount();
    assert.deepEqual(f.writes, []);
});

it('keeps preview address provider-free and password suppresses its dormant configuration', async (t) => {
    const f = await fixture(t);
    await f.render({
        address: {
            mode: 'preview',
            explanation: 'Suggestions require the standalone form',
        },
    });
    assert.match(
        f.input().getAttribute('aria-describedby') ?? '',
        /address-preview/
    );
    assert.match(
        f.container.textContent,
        /Suggestions require the standalone form/
    );
    await f.render({ obscurePassword: true });
    assert.equal(f.input().type, 'password');
    assert.equal(f.container.querySelector('[id$="address-preview"]'), null);
});

for (const [value, mask, attachment, button, expected] of [
    [null, false, false, false, 'empty'],
    ['', true, false, false, 'empty'],
    ['secret', true, true, true, 'mask'],
    ['https://example.test/file.pdf', false, true, true, 'attachment'],
    ['javascript:alert(1)', false, true, true, 'invalid-button'],
    ['ordinary text  ', false, false, false, 'text'],
] as const)
    it(`dispatches readonly ${expected} for ${String(value)}`, () => {
        const html = renderToStaticMarkup(
            h(SingleLineTextField, {
                mode: 'readOnly',
                value,
                language: 'en',
                obscurePassword: mask,
                displayAsAttachments: attachment,
                displayAsButton: button,
            })
        );
        if (expected === 'mask') {
            assert.match(html, /••••••••/);
            assert.doesNotMatch(html, /secret|created-time/);
        }
        if (expected === 'attachment') {
            assert.match(html, /<ul aria-label="Attachments"/);
            assert.match(html, /Open attachment/);
            assert.doesNotMatch(html, /<a\b/);
        }
        if (expected === 'invalid-button') {
            assert.match(html, /disabled=""/);
            assert.doesNotMatch(html, /href=|javascript:/);
        }
        if (expected === 'empty') assert.match(html, /No Value/);
        if (expected === 'text') assert.match(html, /ordinary text  /);
    });
