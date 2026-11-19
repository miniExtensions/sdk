import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type FormEvent } from 'react';
import { renderToString } from 'react-dom/server';
import {
    LoginExistingValuesPicker,
    type LoginExistingValuesPage,
    type LoginExistingValuesPickerProps,
    type LoginExistingValuesRequest,
} from '../src/react/LoginExistingValuesPicker.js';

const owner = {
    extensionSessionId: 'session-A',
    extensionId: 'extension',
    fieldId: 'field',
    viewMode: 'published',
} as const;
const duplicate = '  duplicate@example.com  ';
const pages = [
    { labels: [duplicate, '', duplicate], offset: 'raw-page-2' },
    { labels: ['', duplicate, 'Last option'], offset: null },
] as const;
const openLabel = 'Find an existing value';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
}

async function fixture(
    t: TestContext,
    initial: Partial<LoginExistingValuesPickerProps> = {}
) {
    const window = new Window({ url: 'https://login.example.invalid/' });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const before = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const choices: string[] = [];
    const requests: LoginExistingValuesRequest[] = [];
    let submits = 0;
    let mounted = true;
    let props: LoginExistingValuesPickerProps = {
        owner,
        allowSearchFromExistingValuesInLogin: true,
        async loadOptions({ offset }) {
            return offset === null ? pages[0] : pages[1];
        },
        onSelect: (value) => choices.push(value),
        ...initial,
    };
    const render = async (
        patch: Partial<LoginExistingValuesPickerProps> = {}
    ) => {
        props = { ...props, ...patch };
        const load = props.loadOptions;
        await act(async () =>
            root.render(
                h(
                    StrictMode,
                    null,
                    h(
                        'form',
                        {
                            onSubmit: (event: FormEvent<HTMLFormElement>) => {
                                event.preventDefault();
                                submits++;
                            },
                        },
                        h('input', {
                            type: 'password',
                            'aria-label': 'Account password',
                        }),
                        h(LoginExistingValuesPicker, {
                            ...props,
                            loadOptions(request) {
                                requests.push(request);
                                return load(request);
                            },
                        })
                    )
                )
            )
        );
    };
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        try {
            await unmount();
        } finally {
            keys.forEach((key, index) => {
                const descriptor = before[index];
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    await render();
    const button = (label: string) => {
        const match = [...container.querySelectorAll('button')].find(
            (candidate) => candidate.textContent === label
        );
        assert(match, `Missing button ${label}`);
        return match;
    };
    const options = () =>
        [...container.querySelectorAll('[role=dialog] li button')].map(
            (option) => {
                assert(option instanceof window.HTMLButtonElement);
                return option;
            }
        );
    const text = () => options().map((node) => node.textContent);
    const search = () => {
        const node = container.querySelector('input[type=search]');
        assert(node);
        return node;
    };
    const edit = async (value: string) => {
        await act(async () => {
            const input = search();
            const set = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!;
            set.call(input, value);
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    const click = async (label: string) => {
        await act(async () => button(label).click());
    };
    return {
        window,
        container,
        button,
        options,
        text,
        search,
        click,
        edit,
        render,
        unmount,
        choices,
        requests,
        submits: () => submits,
        dialog: () => container.querySelector('[role=dialog]'),
    };
}

it('is closed and inert while rendering on the server', () => {
    let reads = 0;
    const markup = renderToString(
        h(LoginExistingValuesPicker, {
            owner,
            allowSearchFromExistingValuesInLogin: true,
            async loadOptions() {
                reads++;
                return pages[0];
            },
            onSelect() {
                assert.fail('SSR must not select');
            },
        })
    );
    assert.match(markup, /aria-expanded="false"/);
    assert(!markup.includes('role="dialog"'));
    assert.equal(reads, 0);
});

for (const [index, value] of [
    [3, ''],
    [4, duplicate],
] as const) {
    it(`selects occurrence ${index} as its original label once and returns focus`, async (t) => {
        const ui = await fixture(t);
        assert.equal(ui.requests.length, 0);
        await ui.click(openLabel);
        assert.equal(ui.window.document.activeElement, ui.search());
        await ui.click('Load more');
        assert.deepEqual(ui.text(), [...pages[0].labels, ...pages[1].labels]);
        assert.deepEqual(
            ui.requests.map(({ searchTerm, offset }) => [searchTerm, offset]),
            [
                ['', null],
                ['', 'raw-page-2'],
            ]
        );
        const choice = ui.options()[index];
        assert.equal(choice.textContent, value);
        if (value === '')
            assert.equal(choice.getAttribute('aria-label'), 'Blank value');
        await act(async () => {
            choice.click();
            choice.click();
        });
        assert.deepEqual(ui.choices, [value]);
        assert.equal(ui.dialog(), null);
        assert.equal(ui.window.document.activeElement, ui.button(openLabel));
        assert.equal(ui.submits(), 0);
        assert(!ui.container.innerHTML.includes('login-option:'));
    });
}

it('debounces raw input for 500 ms and retires superseded reads immediately', async (t) => {
    const old = deferred<LoginExistingValuesPage>();
    const ui = await fixture(t, {
        loadOptions: (request) =>
            request.searchTerm === ''
                ? old.promise
                : Promise.resolve({ labels: ['Fresh match'], offset: null }),
    });
    await ui.click(openLabel);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ui.edit('  Needle_*  ');
    assert.equal(ui.requests[0].signal.aborted, true);
    await act(async () => t.mock.timers.tick(499));
    assert.equal(ui.requests.length, 1);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(ui.requests[1].searchTerm, '  Needle_*  ');
    assert.equal(ui.requests[1].offset, null);
    assert.deepEqual(ui.text(), ['Fresh match']);
    await act(async () =>
        old.resolve({ labels: ['Late'], offset: 'stale-page' })
    );
    assert.deepEqual(ui.text(), ['Fresh match']);
    assert.equal(ui.submits(), 0);
});

it('retries initial and append failures at the right cursors without exposing loader errors', async (t) => {
    const append = deferred<LoginExistingValuesPage>();
    let reads = 0;
    const ui = await fixture(t, {
        async loadOptions() {
            switch (++reads) {
                case 1:
                    throw new Error('synthetic private loader detail');
                case 2:
                    return pages[0];
                case 3:
                    return append.promise;
                default:
                    return pages[1];
            }
        },
    });
    await ui.click(openLabel);
    assert.equal(
        ui.container.querySelector('[role=alert]')?.textContent,
        'Could not load values.'
    );
    assert(!ui.container.innerHTML.includes('synthetic private loader detail'));
    await ui.click('Retry');
    const more = ui.button('Load more');
    await act(async () => {
        more.click();
        more.click();
    });
    assert.equal(reads, 3);
    await act(async () => append.reject(new Error('append failed')));
    assert.deepEqual(ui.text(), pages[0].labels);
    await ui.click('Retry');
    assert.deepEqual(ui.text(), [...pages[0].labels, ...pages[1].labels]);
    assert.deepEqual(
        ui.requests.map(({ offset }) => offset),
        [null, null, 'raw-page-2', 'raw-page-2']
    );
});

it('does not resurrect an A lookup after the owner changes to B and back', async (t) => {
    const a = deferred<LoginExistingValuesPage>();
    const b = deferred<LoginExistingValuesPage>();
    const ui = await fixture(t, { loadOptions: () => a.promise });
    await ui.click(openLabel);
    await ui.render({
        owner: { ...owner, extensionSessionId: 'session-B' },
        loadOptions: () => b.promise,
    });
    assert(ui.requests[0].signal.aborted);
    assert.equal(ui.dialog(), null);
    await ui.click(openLabel);
    await ui.render({
        owner,
        async loadOptions() {
            return { labels: ['Current A'], offset: null };
        },
    });
    assert(ui.requests[1].signal.aborted);
    await ui.click(openLabel);
    await act(async () => {
        a.resolve({ labels: ['Old A'], offset: 'old-A' });
        b.reject(new Error('Old B'));
    });
    assert.deepEqual(ui.text(), ['Current A']);
    await ui.click('Current A');
    assert.deepEqual(ui.choices, ['Current A']);
    assert.deepEqual(
        ui.requests.map(({ extensionSessionId }) => extensionSessionId),
        ['session-A', 'session-B', 'session-A']
    );
});

it('dismisses with Escape, preserves focus, and cancels a pending debounce on unmount', async (t) => {
    const old = deferred<LoginExistingValuesPage>();
    const ui = await fixture(t, { loadOptions: () => old.promise });
    await ui.click(openLabel);
    await act(async () =>
        ui.search().dispatchEvent(
            new ui.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            })
        )
    );
    assert(ui.requests[0].signal.aborted);
    assert.equal(ui.dialog(), null);
    assert.equal(ui.window.document.activeElement, ui.button(openLabel));
    await ui.click(openLabel);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ui.edit('No late read');
    await ui.unmount();
    await act(async () => t.mock.timers.tick(500));
    old.resolve({ labels: ['Old'], offset: null });
    assert.equal(ui.requests.length, 2);
    assert(ui.requests[1].signal.aborted);
    assert.equal(ui.choices.length, 0);
});

it('enforces explicit eligibility and retires a lookup when masking takes effect', async (t) => {
    const old = deferred<LoginExistingValuesPage>();
    const ui = await fixture(t, {
        allowSearchFromExistingValuesInLogin: undefined,
        loadOptions: () => old.promise,
    });
    assert.equal(ui.container.querySelector('button'), null);
    await ui.render({
        allowSearchFromExistingValuesInLogin: true,
        disabled: true,
    });
    assert(ui.button(openLabel).disabled);
    await ui.click(openLabel);
    assert.equal(ui.requests.length, 0);
    await ui.render({ disabled: false });
    await ui.click(openLabel);
    assert.equal(ui.requests.length, 1);
    await ui.render({ maskPasswordOnLoginScreen: true });
    assert(ui.requests[0].signal.aborted);
    assert.equal(ui.container.querySelector('button'), null);
    assert.equal(ui.submits(), 0);
    old.resolve({ labels: ['No longer offered'], offset: null });
});
