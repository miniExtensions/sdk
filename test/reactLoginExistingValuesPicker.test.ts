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
        'Element',
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
        const node = container.querySelector(
            'input[type=search], input[role=combobox]'
        );
        assert(node instanceof window.HTMLInputElement);
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
    const dialog = () => container.querySelector('[role=dialog], dialog[open]');
    const native = () => {
        const panel = dialog();
        assert(panel instanceof window.HTMLDialogElement && panel.open);
        const listbox = panel.querySelector('[role=listbox]');
        assert(listbox instanceof window.HTMLElement);
        return {
            panel,
            listbox,
            rows: [...listbox.querySelectorAll('[role=option]')].map((row) => {
                assert(row instanceof window.HTMLElement);
                return row;
            }),
        };
    };
    const nativeKey = async (
        key: string,
        modifiers: {
            isComposing?: boolean;
            repeat?: boolean;
            shiftKey?: boolean;
        } = {},
        target: ReturnType<typeof search> | ReturnType<typeof button> = search()
    ) => {
        const event = new window.KeyboardEvent('keydown', {
            key,
            ...modifiers,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => target.dispatchEvent(event));
        return event.defaultPrevented;
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
        dialog,
        native,
        nativeKey,
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

it('runs the title action without changing the dialog name, selection, or form', async (t) => {
    const title = 'Valeurs existantes';
    const actionLabel = 'Réglages';
    let activations = 0;
    const ui = await fixture(t, {
        labels: { title },
        titleAction: h(
            'button',
            { type: 'button', onClick: () => activations++ },
            actionLabel
        ),
    });
    assert.equal(ui.container.textContent?.includes(actionLabel), false);
    await ui.click(openLabel);
    const dialog = ui.dialog();
    assert(dialog);
    const heading = ui.window.document.getElementById(
        dialog.getAttribute('aria-labelledby') ?? ''
    );
    assert(heading);
    assert.equal(heading.textContent, title);
    assert.equal(heading.nextElementSibling, ui.button(actionLabel));
    const requests = ui.requests.length;
    await ui.click(actionLabel);
    assert.equal(activations, 1);
    assert.deepEqual(ui.choices, []);
    assert.equal(ui.submits(), 0);
    assert.equal(ui.requests.length, requests);
    assert.equal(ui.dialog(), dialog);
    await act(async () => ui.options()[1].click());
    assert.deepEqual(ui.choices, ['']);
    assert.equal(ui.dialog(), null);
    assert.equal(ui.window.document.activeElement, ui.button(openLabel));
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
        const heading = ui
            .dialog()
            ?.querySelector('.mx-sdk-login-values-header');
        assert.equal(heading?.children.length, 2);
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

it('navigates the rendered occurrences and preserves search, dismissal and form ownership', async (t) => {
    const ui = await fixture(t);
    const focused = () => ui.window.document.activeElement;
    const key = async (
        value: string,
        init: { shiftKey?: boolean; repeat?: boolean } = {}
    ) => {
        const event = new ui.window.KeyboardEvent('keydown', {
            ...init,
            key: value,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            focused()?.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };
    await ui.click(openLabel);
    await ui.click('Load more');
    const options = ui.options();
    ui.search().focus();
    assert(await key('Enter'));
    assert.equal(await key('ArrowDown', { shiftKey: true }), false);
    assert(await key('ArrowDown'), 'ArrowDown must focus an option');
    assert(focused() === options[0]);
    assert(await key('ArrowDown'));
    assert(focused() === options[1]);
    assert(await key('ArrowDown'));
    assert(focused() === options[2]);
    assert.equal(options[0].textContent, options[2].textContent);
    assert(await key('ArrowDown'));
    assert(focused() === options[3]);

    // A browser activates this exact type=button with Enter while it is focused.
    await act(async () => options[3].click());
    assert.deepEqual(ui.choices, ['']);
    assert.equal(ui.dialog(), null);
    assert(focused() === ui.button(openLabel));
    assert(await key('Enter', { repeat: true }));

    await ui.click(openLabel);
    const last = ui.options().at(-1);
    assert(await key('ArrowUp'));
    assert(focused() === last);
    assert(await key('ArrowDown'));
    assert(focused() === last);
    await key('ArrowUp');
    await key('ArrowUp');
    await key('ArrowUp');
    assert(focused() === ui.search());
    await key('ArrowDown');
    assert(await key('Escape'));
    assert.equal(ui.dialog(), null);
    assert(focused() === ui.button(openLabel));
    assert.equal(ui.submits(), 0);
});

it('debounces raw input for 500 ms and retires superseded reads immediately', async (t) => {
    const old = deferred<LoginExistingValuesPage>();
    const ui = await fixture(t, {
        async loadOptions({ searchTerm }) {
            if (searchTerm === '') return old.promise;
            return {
                labels: searchTerm === 'No results' ? [] : ['Fresh match'],
                offset: null,
            };
        },
    });
    const status = () =>
        ui.container.querySelector('[role=status]')?.textContent;
    await ui.click(openLabel);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await ui.edit('  Needle_*  ');
    assert.equal(ui.requests[0].signal.aborted, true);
    await act(async () => t.mock.timers.tick(499));
    assert.equal(ui.requests.length, 1);
    assert.equal(status(), 'Loading values…');
    assert.equal(
        ui.container.querySelector('ul')?.getAttribute('aria-busy'),
        'true'
    );
    await act(async () => t.mock.timers.tick(1));
    assert.equal(ui.requests[1].searchTerm, '  Needle_*  ');
    assert.equal(ui.requests[1].offset, null);
    assert.deepEqual(ui.text(), ['Fresh match']);
    await act(async () =>
        old.resolve({ labels: ['Late'], offset: 'stale-page' })
    );
    assert.deepEqual(ui.text(), ['Fresh match']);
    await ui.edit('No results');
    assert.equal(status(), 'Loading values…');
    await act(async () => t.mock.timers.tick(500));
    assert.equal(status(), 'No matching values.');
    assert.equal(
        ui.container.querySelector('ul')?.getAttribute('aria-busy'),
        'false'
    );
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

it('keeps native combobox focus on the input and commits exact duplicate and blank occurrences', async (t) => {
    const ui = await fixture(t, {
        appearance: 'native',
        labels: { open: 'Rechercher', search: 'Adresse électronique' },
        searchPlaceholder: 'Saisissez quelques lettres',
        triggerContent: h('span', { 'aria-hidden': true }, 'Search icon'),
        async loadOptions({ searchTerm }) {
            if (searchTerm === 'No results')
                return { labels: [], offset: null };
            return searchTerm === ''
                ? pages[0]
                : { labels: ['', duplicate], offset: null };
        },
    });
    const opener = ui.button('Search icon');
    assert.equal(opener.getAttribute('aria-label'), 'Rechercher');
    const open = async () => {
        opener.focus();
        await ui.click('Search icon');
        const { panel, listbox, rows } = ui.native();
        const input = ui.search();
        assert.equal(opener.getAttribute('aria-controls'), panel.id);
        assert.equal(input.getAttribute('aria-controls'), listbox.id);
        assert.equal(input.form, null);
        assert.equal(ui.window.document.activeElement, input);
        return rows;
    };
    const active = () => ui.search().getAttribute('aria-activedescendant');
    const assertActive = (id: string) => {
        assert.equal(active(), id);
        assert.equal(ui.window.document.activeElement, ui.search());
        assert.equal(
            ui.window.document
                .getElementById(id)
                ?.getAttribute('aria-selected'),
            'true'
        );
    };

    const [first, blank, second] = await open();
    assert.equal(
        ui.search().getAttribute('aria-label'),
        'Adresse électronique'
    );
    assert.equal(ui.search().placeholder, 'Saisissez quelques lettres');
    assert.deepEqual(
        [first.textContent, blank.textContent, second.textContent],
        pages[0].labels
    );
    assert.equal(blank.getAttribute('aria-label'), 'Blank value');
    assert.equal(new Set([first.id, blank.id, second.id]).size, 3);
    assert(await ui.nativeKey('Enter'));
    assert.equal(await ui.nativeKey('ArrowDown', { shiftKey: true }), false);
    assert.equal(await ui.nativeKey('ArrowDown', { isComposing: true }), false);
    assert.deepEqual(ui.choices, []);
    assert(await ui.nativeKey('ArrowDown'));
    assertActive(first.id);
    assert(await ui.nativeKey('ArrowUp'));
    assertActive(first.id);
    assert(await ui.nativeKey('End'));
    assertActive(second.id);
    assert(await ui.nativeKey('Home'));
    assertActive(first.id);
    assert(await ui.nativeKey('PageDown'));
    assertActive(second.id);
    assert(await ui.nativeKey('PageUp'));
    assertActive(first.id);

    const pointer = async (type: string, pointerType: string) => {
        await act(async () =>
            second.dispatchEvent(
                new ui.window.PointerEvent(type, { pointerType, bubbles: true })
            )
        );
    };
    await pointer('pointermove', 'touch');
    assertActive(first.id);
    await pointer('pointermove', 'mouse');
    assertActive(second.id);
    await pointer('pointerout', 'mouse');
    assert.equal(active(), null);
    assert(await ui.nativeKey('ArrowUp'));
    assertActive(second.id);
    assert(await ui.nativeKey('Enter', { repeat: true }));
    assert.deepEqual(ui.choices, []);
    assert(await ui.nativeKey('Enter'));
    assert.deepEqual(ui.choices, [duplicate]);
    assert.equal(ui.dialog(), null);
    assert.equal(ui.window.document.activeElement, opener);

    await open();
    assert(await ui.nativeKey('ArrowDown'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const raw = '  Needle_*  ';
    await ui.edit(raw);
    assert.equal(active(), null);
    assert.equal(ui.native().listbox.hidden, true);
    assert.equal(
        ui.container.querySelector('[role=status]')?.getAttribute('aria-label'),
        'Loading values…'
    );
    assert.equal(await ui.nativeKey('ArrowDown'), false);
    const beforeDebounce = ui.requests.length;
    await act(async () => t.mock.timers.tick(499));
    assert.equal(ui.requests.length, beforeDebounce);
    await act(async () => t.mock.timers.tick(1));
    assert.equal(ui.requests.at(-1)?.searchTerm, raw);
    assert.equal(ui.search().value, raw);
    assert.deepEqual(
        ui.native().rows.map((row) => row.textContent),
        ['', duplicate]
    );
    assertActive(ui.native().rows[0].id);
    assert.deepEqual(ui.choices, [duplicate]);

    await ui.edit('');
    await act(async () => t.mock.timers.tick(500));
    assertActive(ui.native().rows[0].id);

    await ui.edit('No results');
    await act(async () => t.mock.timers.tick(500));
    assert.equal(
        ui.container.querySelector('[role=status]')?.textContent,
        'No matching values.'
    );
    assert.equal(ui.search().getAttribute('aria-expanded'), 'false');
    assert.equal(active(), null);
    await ui.edit(raw);
    await act(async () => t.mock.timers.tick(500));
    assertActive(ui.native().rows[0].id);
    assert(await ui.nativeKey('ArrowDown'));
    assertActive(ui.native().rows[1].id);
    assert(await ui.nativeKey('ArrowUp'));
    assertActive(ui.native().rows[0].id);
    assert.equal(await ui.nativeKey('Tab', { shiftKey: true }), false);
    assert.deepEqual(ui.choices, [duplicate, '']);
    assert.equal(ui.dialog(), null);
    assert.equal(ui.submits(), 0);
});

it('dismisses the native modal and retires lookups without focusing a replaced opener', async (t) => {
    const pending = deferred<LoginExistingValuesPage>();
    const ui = await fixture(t, {
        appearance: 'native',
        testIds: { dialog: 'lookup-dialog', overlay: 'lookup-overlay' },
        loadOptions({ extensionSessionId }) {
            return extensionSessionId === owner.extensionSessionId
                ? pending.promise
                : Promise.resolve({ labels: ['Fresh owner'], offset: null });
        },
        titleAction: h(
            'div',
            { role: 'dialog' },
            h('button', { type: 'button' }, 'Nested action')
        ),
    });
    const showModal = t.mock.method(
        ui.window.HTMLDialogElement.prototype,
        'showModal'
    );
    const close = t.mock.method(ui.window.HTMLDialogElement.prototype, 'close');
    const opener = ui.button(openLabel);
    const open = async () => {
        opener.focus();
        await ui.click(openLabel);
        const { panel } = ui.native();
        assert.equal(panel.getAttribute('data-testid'), 'lookup-dialog');
        assert.equal(ui.window.document.activeElement, ui.search());
        return panel;
    };
    const closed = (index: number) => {
        assert.equal(ui.dialog(), null);
        assert(ui.requests[index].signal.aborted);
        assert.equal(ui.window.document.activeElement, opener);
    };

    const panel = await open();
    const overlay = panel.querySelector('[data-testid=lookup-overlay]');
    assert(overlay instanceof ui.window.HTMLElement);
    const press = new ui.window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => overlay.dispatchEvent(press));
    assert(press.defaultPrevented);
    assert(panel.open);
    await act(async () => overlay.click());
    closed(0);

    await open();
    assert.equal(
        await ui.nativeKey('Escape', {}, ui.button('Nested action')),
        false
    );
    assert.equal(await ui.nativeKey('Escape', { isComposing: true }), false);
    assert(await ui.nativeKey('Escape', { repeat: true }));
    assert(ui.native().panel.open);
    assert(await ui.nativeKey('Escape'));
    closed(1);

    const cancelled = await open();
    const cancel = new ui.window.Event('cancel', { cancelable: true });
    await act(async () => cancelled.dispatchEvent(cancel));
    assert(cancel.defaultPrevented);
    closed(2);

    const retired = await open();
    const restoreFocus = t.mock.method(opener, 'focus');
    await ui.render({ owner: { ...owner, extensionSessionId: 'session-B' } });
    assert(ui.requests[3].signal.aborted);
    assert.equal(restoreFocus.mock.callCount(), 0);
    assert.equal(opener.isConnected, false);
    assert.equal(retired.isConnected, false);
    assert.equal(ui.dialog(), null);
    assert(showModal.mock.callCount() >= 4);
    assert.equal(close.mock.callCount(), 3);
    await act(async () =>
        pending.resolve({ labels: ['Retired result'], offset: null })
    );
    assert.equal(ui.dialog(), null);
    await ui.click(openLabel);
    assert.deepEqual(
        ui.native().rows.map((row) => row.textContent),
        ['Fresh owner']
    );
    assert.deepEqual(ui.choices, []);
    assert.equal(ui.submits(), 0);
});

it('uses a safe native error label and preserves loading, formatting and append retry controls', async (t) => {
    const initial = deferred<LoginExistingValuesPage>();
    const append = deferred<LoginExistingValuesPage>();
    let reads = 0;
    const ui = await fixture(t, {
        appearance: 'native',
        labels: { error: 'Valeurs indisponibles' },
        renderLoading: () => h('span', { role: 'status' }, 'Host loading'),
        loadOptions() {
            switch (++reads) {
                case 1:
                    return initial.promise;
                case 2:
                    return Promise.resolve(pages[0]);
                case 3:
                    return append.promise;
                default:
                    return Promise.resolve(pages[1]);
            }
        },
    });
    await ui.click(openLabel);
    assert.equal(
        ui.container.querySelector('[role=status]')?.textContent,
        'Host loading'
    );
    await act(async () => initial.reject(new Error('private initial detail')));
    assert.equal(
        ui.container.querySelector('[role=alert]')?.textContent,
        'Valeurs indisponibles'
    );
    assert(!ui.container.innerHTML.includes('private initial detail'));
    await ui.render({
        renderError(message) {
            return h(
                'span',
                { role: 'alert' },
                message === 'private append detail'
                    ? 'Host append error'
                    : 'Host initial error'
            );
        },
    });
    assert.equal(
        ui.container.querySelector('[role=alert]')?.textContent,
        'Host initial error'
    );
    await ui.click('Retry');
    assert.deepEqual(
        ui.native().rows.map((row) => row.textContent),
        pages[0].labels
    );
    await ui.click('Load more');
    assert.equal(ui.button('Load more').disabled, true);
    assert.deepEqual(
        ui.native().rows.map((row) => row.textContent),
        pages[0].labels
    );
    await act(async () => append.reject(new Error('private append detail')));
    assert.equal(
        ui.container.querySelector('[role=alert]')?.textContent,
        'Host append error'
    );
    assert.equal(ui.native().listbox.hidden, true);
    await ui.click('Retry');
    assert.deepEqual(
        ui.requests.map(({ offset }) => offset),
        [null, null, 'raw-page-2', 'raw-page-2']
    );
    assert.deepEqual(
        ui.native().rows.map((row) => row.textContent),
        [...pages[0].labels, ...pages[1].labels]
    );
    const choice = ui.native().rows[4];
    const mouseDown = new ui.window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => choice.dispatchEvent(mouseDown));
    assert(mouseDown.defaultPrevented);
    await act(async () => choice.click());
    assert.deepEqual(ui.choices, [duplicate]);
    assert.equal(ui.dialog(), null);
    assert.equal(ui.submits(), 0);
});
