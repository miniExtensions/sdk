import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ComponentType,
    type Ref,
} from 'react';
import {
    EmailField,
    type ControlledEmailFieldProps,
    type EmailFieldProps,
    type TextFieldProps,
} from '../src/react/index.js';
import { renderToStaticMarkup } from 'react-dom/server';

function declarationContract(binding: EmailFieldProps['binding']) {
    const legacy: EmailFieldProps = { binding };
    const unchanged: TextFieldProps = legacy;
    h(EmailField, unchanged);
    const controlled = {
        mode: 'controlled' as const,
        value: 'Mail@Example.TEST',
        language: 'en' as const,
        onChange: (_value: string) => {},
    };
    h(EmailField, controlled);
    const owner = { token: {}, isCurrent: () => true };
    const deferred: ControlledEmailFieldProps = {
        ...controlled,
        enableInlineEdit: true,
        owner,
    };
    h(EmailField, deferred);
    // @ts-expect-error Deferred callers must provide genuine captured authority.
    h(EmailField, { ...controlled, enableInlineEdit: true });
    // @ts-expect-error Binding and controlled contracts are mutually exclusive.
    h(EmailField, { ...controlled, binding });
}
void declarationContract;

// This source-level composition suite does not claim package or native adoption.
type Props = {
    mode: 'controlled';
    value: string | null;
    onChange(value: string): void;
    language: 'en';
    owner?: { token: unknown; isCurrent(): boolean };
    enableInlineEdit?: boolean;
    initialMobile?: boolean;
    readOnly?: boolean;
    disabled?: boolean;
    displayOnly?: boolean;
    id?: string;
    form?: string;
    placeholder?: string;
    describedBy?: string;
    invalid?: boolean;
    inputRef?: Ref<HTMLInputElement>;
    enableQRCodeScannerForFormField?: boolean;
};

async function fixture(t: TestContext) {
    // Also exercise malformed JS callers: missing deferred authority must fail
    // closed at runtime even though the public declaration rejects it below.
    const component = EmailField as ComponentType<Props>;
    const window = new Window({ url: 'https://email.example.test/' });
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
    const rejectRequest = async () => {
        requests++;
        throw new Error('Email presentation must not make requests');
    };
    Object.defineProperty(window, 'fetch', { value: rejectRequest });
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? rejectRequest
                      : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'email-form';
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
    let props: Props = {
        mode: 'controlled',
        value: 'Seed+Tag@Example.TEST',
        onChange: (value) => writes.push(value),
        language: 'en',
        id: 'email-control',
        form: 'email-form',
        initialMobile: true,
        owner: { token: {}, isCurrent: () => current },
    };
    const render = async (overrides: Partial<Props> = {}) => {
        props = { ...props, ...overrides };
        await act(async () =>
            root.render(h(StrictMode, null, h(component, props)))
        );
        assert.equal(submits, 0);
        assert.equal(requests, 0);
    };
    const input = () => {
        const result = container.querySelector('input');
        assert.ok(result);
        return result;
    };
    const edit = async (value: string) => {
        await act(async () => {
            input().focus();
            const set = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            assert.ok(set);
            set.call(input(), value);
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

it('SSR uses explicit mobile input without browser globals or implicit writes', () => {
    assert.equal(typeof globalThis.window, 'undefined');
    const html = renderToStaticMarkup(
        h(EmailField, {
            mode: 'controlled',
            value: null,
            language: 'en',
            initialMobile: true,
            onChange: () => assert.fail('SSR must not write'),
            placeholder: 'Address',
        })
    );
    assert.match(html, /type="email"/);
    assert.match(html, /autoComplete="off"/);
    assert.match(html, /value=""/);
    assert.doesNotMatch(html, /initialMobile|enableInlineEdit|owner=/);
    assert.equal(typeof globalThis.window, 'undefined');
});

it('renders the actual email input, envelope and metadata without a write', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLInputElement>();
    await f.render({
        placeholder: 'Work address',
        describedBy: 'email-help email-error',
        invalid: true,
        inputRef: ref,
    });
    assert.equal(f.input().type, 'email');
    assert.equal(f.input().autocomplete, 'off');
    assert.equal(f.input().id, 'email-control');
    assert.equal(f.input().getAttribute('form'), 'email-form');
    assert.equal(f.input().placeholder, 'Work address');
    assert.equal(
        f.input().getAttribute('aria-describedby'),
        'email-help email-error'
    );
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(ref.current, f.input());
    assert.ok(
        f.container.querySelector('.mx-sdk-email-icon[aria-hidden=true]')
    );
    assert.equal(f.input().hasAttribute('mode'), false);
    assert.deepEqual(f.writes, []);
});

it('keeps email case and literal empty-string writes in immediate mode', async (t) => {
    const f = await fixture(t);
    await f.render();
    await f.edit('MiXeD+Tag@Example.TEST');
    assert.deepEqual(f.writes, ['MiXeD+Tag@Example.TEST']);
    await f.render({ value: 'MiXeD+Tag@Example.TEST' });
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    assert.equal(clear.type, 'button');
    await act(async () => clear.click());
    assert.deepEqual(f.writes, ['MiXeD+Tag@Example.TEST', '']);
    await f.render({ value: null });
    assert.equal(f.input().value, '');
    assert.deepEqual(f.writes, ['MiXeD+Tag@Example.TEST', '']);
});

it('preserves deferred blur before pointer-Clear rather than dropping a write', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('Draft@Example.TEST');
    assert.deepEqual(f.writes, []);
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    await act(async () => clear.focus());
    await act(async () => clear.click());
    assert.deepEqual(f.writes, ['Draft@Example.TEST', '']);
});

it('settles non-IME Enter once without submitting the surrounding Form', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('Enter@Example.TEST');
    await act(async () => {
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                isComposing: true,
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.deepEqual(f.writes, []);
    await act(async () => {
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.deepEqual(f.writes, ['Enter@Example.TEST']);
});

it('retires a dirty A-to-B-to-A owner and accepts only a fresh successor draft', async (t) => {
    const f = await fixture(t);
    const a = { token: {}, isCurrent: () => true };
    const b = { token: {}, isCurrent: () => true };
    await f.render({ enableInlineEdit: true, owner: a });
    await f.edit('Abandoned@Example.TEST');
    await f.render({ owner: b });
    await f.render({ owner: a });
    assert.deepEqual(f.writes, []);
    assert.equal(f.input().value, 'Seed+Tag@Example.TEST');
    await f.edit('Fresh@Example.TEST');
    await act(async () => f.input().blur());
    assert.deepEqual(f.writes, ['Fresh@Example.TEST']);
});

it('fails closed for a missing deferred owner and disabled or read-only input', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true, owner: undefined });
    assert.equal(f.input().disabled, true);
    await f.edit('Rejected@Example.TEST');
    await act(async () => f.input().blur());
    assert.deepEqual(f.writes, []);
    for (const state of [
        { readOnly: true },
        { readOnly: false, disabled: true },
    ]) {
        await f.render({ enableInlineEdit: false, ...state });
        assert.equal(f.input().disabled, true);
        await f.edit('Rejected@Example.TEST');
        assert.deepEqual(f.writes, []);
    }
});

it('reuses the opt-in scanner control and suppresses it for read-only display', async (t) => {
    const f = await fixture(t);
    await f.render();
    assert.equal(
        f.container.querySelector('[data-testid=qr-scanner-button]'),
        null
    );
    assert.equal(f.input().classList.contains('rounded-r-md'), true);
    await f.render({ enableQRCodeScannerForFormField: true });
    assert.equal(
        f.container
            .querySelector('[data-testid=qr-scanner-button]')
            ?.getAttribute('type'),
        'button'
    );
    assert.equal(f.input().classList.contains('rounded-r-md'), false);
    await f.render({ readOnly: true });
    assert.equal(
        f.container.querySelector('[data-testid=qr-scanner-button]'),
        null
    );
    await f.render({ displayOnly: true });
    assert.equal(f.container.querySelector('input'), null);
    assert.match(f.container.textContent, /Seed\+Tag@Example\.TEST/);
    assert.equal(f.container.querySelector('a'), null);
    await f.render({ value: 'Seed+Tag@example.com' });
    assert.equal(
        f.container.querySelector('a')?.getAttribute('href'),
        'mailto:Seed+Tag@example.com'
    );
    assert.deepEqual(f.writes, []);
});

it('genuine dirty unmount settles once through the original mounted writer', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('Mounted@Example.TEST');
    const newer: string[] = [];
    await f.render({ onChange: (value) => newer.push(value) });
    await f.unmount();
    assert.deepEqual(f.writes, ['Mounted@Example.TEST']);
    assert.deepEqual(newer, []);
});

it('retired dirty unmount cannot write even through the original callback', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true });
    await f.edit('Retired@Example.TEST');
    f.retire();
    await f.unmount();
    assert.deepEqual(f.writes, []);
});

it('rechecks committed generation after a reentrant authority callback', async (t) => {
    const f = await fixture(t);
    const { flushSync } = await import('react-dom');
    const successorWrites: string[] = [];
    const successor = { token: {}, isCurrent: () => true };
    const previous = {
        token: {},
        isCurrent: () => {
            flushSync(() =>
                f.root.render(
                    h(EmailField, {
                        mode: 'controlled',
                        value: 'Successor@Example.TEST',
                        language: 'en',
                        owner: successor,
                        onChange: (value) => successorWrites.push(value),
                    })
                )
            );
            return true;
        },
    };
    await f.render({ owner: previous });
    await f.edit('Abandoned@Example.TEST');
    assert.deepEqual(f.writes, []);
    assert.equal(successorWrites.length, 0);
    await f.render({
        owner: successor,
        onChange: (value) => successorWrites.push(value),
    });
    await f.edit('Fresh@Example.TEST');
    assert.deepEqual(successorWrites, ['Fresh@Example.TEST']);
});

it('cannot emit an ordinary edit after authority synchronously unmounts the field', async (t) => {
    const f = await fixture(t);
    const { flushSync } = await import('react-dom');
    await f.render({
        owner: {
            token: {},
            isCurrent: () => {
                flushSync(() => f.root.render(null));
                return true;
            },
        },
    });
    await f.edit('Abandoned@Example.TEST');
    assert.equal(f.container.querySelector('input'), null);
    assert.deepEqual(f.writes, []);
});

for (const initialMobile of [false, true]) {
    it(`keeps a deferred draft and captured mobile=${initialMobile} until a genuine owner remount`, async (t) => {
        const f = await fixture(t);
        await f.render({ enableInlineEdit: true, initialMobile });
        const original = f.input();
        await f.edit('Kept@Example.TEST');
        await f.render({ initialMobile: !initialMobile });
        assert.ok(
            f.input() === original,
            'mobile hint changes retain the actual input'
        );
        assert.equal(f.input().value, 'Kept@Example.TEST');
        assert.equal(
            Boolean(f.container.querySelector('button')),
            initialMobile
        );
        assert.deepEqual(f.writes, []);
        await act(async () => f.input().blur());
        assert.deepEqual(f.writes, ['Kept@Example.TEST']);
        await f.render({
            value: 'Kept@Example.TEST',
            owner: { token: {}, isCurrent: () => true },
        });
        assert.ok(
            f.input() !== original,
            'a genuine owner replacement remounts'
        );
        assert.equal(
            Boolean(f.container.querySelector('button')),
            !initialMobile
        );
        assert.deepEqual(f.writes, ['Kept@Example.TEST']);
    });
}

for (const enableInlineEdit of [false, true]) {
    it(`requires actual true from a provided owner in inline=${enableInlineEdit} mode`, async (t) => {
        const f = await fixture(t);
        await f.render({
            enableInlineEdit,
            owner: {
                token: {},
                isCurrent: () => undefined as unknown as boolean,
            },
        });
        await f.edit('Unavailable@Example.TEST');
        await act(async () => f.input().blur());
        assert.deepEqual(f.writes, []);
        await f.render({ owner: { token: {}, isCurrent: () => true } });
        await f.edit('Accepted@Example.TEST');
        await act(async () => f.input().blur());
        assert.deepEqual(f.writes, ['Accepted@Example.TEST']);
    });
}

it('keeps ordinary immediate controlled callers independent of a borrowed owner', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: false, owner: undefined });
    await f.edit('Standalone@Example.TEST');
    assert.deepEqual(f.writes, ['Standalone@Example.TEST']);
});

it('binds fresh deferred authority separately from a missing owner with the same absent token', async (t) => {
    const f = await fixture(t);
    await f.render({ enableInlineEdit: true, owner: undefined });
    assert.equal(f.input().disabled, true);
    await f.render({ owner: { token: undefined, isCurrent: () => true } });
    assert.equal(f.input().disabled, false);
    await f.edit('Fresh@Example.TEST');
    await f.unmount();
    assert.deepEqual(f.writes, ['Fresh@Example.TEST']);
});
