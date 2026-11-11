import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    type ComponentProps,
} from 'react';
import { renderToString } from 'react-dom/server';
import { PortalSearchGate } from '../src/react/index.js';

type Props = ComponentProps<typeof PortalSearchGate>;
const initial: Props = {
    searchPageField: { fieldId: 'fld_Name', fieldName: 'Customer Name' },
    getCurrentUrl: () => 'https://example.test/portal?keep=yes#fragment',
    onNavigate() {
        assert.fail('SSR/mount must not navigate');
    },
};

it('SSR imports/renders escaped complete markup without CSS, DOM or URL/navigation effects', () => {
    assert.equal(typeof document, 'undefined');
    const html = renderToString(
        h(PortalSearchGate, {
            ...initial,
            title: '<script>Title</script>',
            description: 'Find {fieldName}; {fieldName}',
            getCurrentUrl() {
                assert.fail('render must not read current URL');
            },
        })
    );
    assert.match(html, /<dialog/);
    assert.match(html, /&lt;script&gt;Title/);
    assert.match(html, /Find Customer Name; Customer Name/);
    assert.match(html, /placeholder="Enter customer name"/);
    assert.match(html, /type="submit" disabled=""/);
    assert.doesNotMatch(html, /type="button"/);
    const hosted = renderToString(
        h(PortalSearchGate, {
            ...initial,
            renderDialog: ({ children, ariaLabel }) =>
                h(
                    'section',
                    { role: 'dialog', 'aria-label': ariaLabel },
                    children
                ),
        })
    );
    assert.doesNotMatch(hosted, /<dialog/);
    assert.match(hosted, /<form/);
    assert.match(hosted, /role="dialog"/);
    assert.equal(typeof document, 'undefined');
});

async function fixture(
    t: TestContext,
    patch: Partial<Props> = {},
    setup?: (window: Window) => () => void
) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLDialogElement',
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
    const disposeSetup = setup?.(window);
    const root = createRoot(container as unknown as HTMLElement);
    const navigations: string[] = [];
    let reads = 0;
    let clears = 0;
    let mounted = true;
    let props: Props = {
        ...initial,
        getCurrentUrl() {
            reads++;
            return 'https://example.test/portal?keep=yes&search_fld_Name=old#fragment';
        },
        onNavigate(url) {
            navigations.push(url);
        },
        onClearSearch() {
            clears++;
        },
        ...patch,
    };
    const render = async () => {
        await act(async () =>
            root.render(h(StrictMode, null, h(PortalSearchGate, props)))
        );
    };
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        await unmount();
        disposeSetup?.();
        keys.forEach((key, index) => {
            const old = originals[index];
            if (old) Object.defineProperty(globalThis, key, old);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const edit = async (value: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(input(), value);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    const submit = async () => {
        await act(async () => {
            const form = container.querySelector('form');
            assert.ok(form);
            form.dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        });
    };
    await render();
    return {
        window,
        container,
        root,
        input,
        edit,
        submit,
        unmount,
        navigations,
        get reads() {
            return reads;
        },
        get clears() {
            return clears;
        },
        async update(next: Partial<Props>) {
            props = { ...props, ...next };
            await render();
        },
    };
}

it('mounts a real non-dismissible dialog with independent label/description and refuses blank submit', async (t) => {
    const f = await fixture(t);
    const dialog = f.container.querySelector('dialog');
    assert.ok(dialog);
    assert.equal(dialog.open, true);
    assert.equal(f.input().value, '');
    assert.equal(f.container.querySelector('label')?.htmlFor, f.input().id);
    assert.equal(f.window.document.activeElement, f.input());
    assert.match(
        f.container.textContent,
        /This step is required before records are shown/
    );
    const cancel = new f.window.Event('cancel', { cancelable: true });
    await act(async () => {
        dialog.dispatchEvent(cancel);
    });
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(dialog.open, true);
    await act(async () => {
        f.container
            .querySelector('.mx-sdk-search-gate-overlay')
            ?.dispatchEvent(
                new f.window.MouseEvent('click', { bubbles: true })
            );
    });
    assert.equal(dialog.open, true);
    await f.submit();
    await f.edit(' \t ');
    assert.equal(f.container.querySelector('button')?.disabled, true);
    await f.submit();
    assert.deepEqual(f.navigations, []);
    assert.equal(f.reads, 0);
});

it('closes the real dialog before removal across StrictMode cleanup and unmount', async (t) => {
    const closes: { connected: boolean; open: boolean }[] = [];
    const f = await fixture(t, {}, (window) => {
        const prototype = window.HTMLDialogElement.prototype;
        const close = prototype.close;
        prototype.close = function (
            this: typeof prototype,
            ...args: Parameters<typeof close>
        ) {
            closes.push({ connected: this.isConnected, open: this.open });
            return close.apply(this, args);
        };
        return () => {
            prototype.close = close;
        };
    });
    assert.equal(closes.length, 1, 'StrictMode cleans up its first setup');
    assert.deepEqual(closes[0], { connected: true, open: true });
    assert.equal(f.container.querySelector('dialog')?.open, true);
    await f.unmount();
    assert.equal(closes.length, 2, 'the accepted mount is closed once');
    assert.deepEqual(closes[1], { connected: true, open: true });
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.reads, 0);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.clears, 0);
    // HappyDOM does not implement opener restoration. The packed Chromium
    // proof retains that real-browser requirement, including multiple gates.
});

it('uses actual raw input until explicit submit, then navigates once to the canonical encoded URL', async (t) => {
    const f = await fixture(t);
    await f.edit('  Alice & 東京  ');
    assert.equal(f.input().value, '  Alice & 東京  ');
    assert.equal(f.container.querySelector('button')?.type, 'submit');
    assert.equal(f.container.querySelector('button')?.disabled, false);
    assert.deepEqual(f.navigations, []);
    await f.submit();
    assert.equal(f.navigations.length, 1);
    assert.equal(f.reads, 1);
    const url = new URL(f.navigations[0]);
    assert.equal(url.searchParams.get('search_Customer Name'), 'Alice & 東京');
    assert.equal(url.searchParams.has('search_fld_Name'), false);
    assert.equal(url.searchParams.get('keep'), 'yes');
    assert.equal(url.hash, '#fragment');
    await f.unmount();
    assert.equal(f.navigations.length, 1);
    assert.equal(f.clears, 0);
});

it('wraps both Tab boundaries without submitting, preserving middle navigation and current enabled controls', async (t) => {
    const f = await fixture(t, { hasNoResults: true });
    await f.edit('term');
    const buttons = () => [...f.container.querySelectorAll('button')];
    const clear = buttons().find((node) => node.type === 'button');
    assert.ok(clear);
    const key = async (shiftKey = false, prevented = false) => {
        const event = new f.window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
        });
        if (prevented) event.preventDefault();
        await act(async () => {
            f.window.document.activeElement?.dispatchEvent(event);
        });
        return event;
    };
    await act(async () => clear.focus());
    assert.equal((await key()).defaultPrevented, true);
    assert.equal(f.window.document.activeElement, f.input());
    assert.equal((await key(true)).defaultPrevented, true);
    assert.equal(f.window.document.activeElement, clear);
    await key(false, true);
    assert.equal(
        f.window.document.activeElement,
        clear,
        'an already handled Tab is not overridden'
    );
    await act(async () => f.input().focus());
    const enter = new f.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        f.input().dispatchEvent(enter);
    });
    assert.equal(
        enter.defaultPrevented,
        false,
        'native non-Tab keyboard behavior stays with the control/form'
    );
    assert.equal(
        (await key()).defaultPrevented,
        false,
        'the browser owns middle navigation'
    );
    await f.update({ hasNoResults: false });
    const submit = buttons().find((node) => node.type === 'submit');
    assert.ok(submit);
    await act(async () => submit.focus());
    assert.equal((await key()).defaultPrevented, true);
    assert.equal(f.window.document.activeElement, f.input());
    await f.edit('');
    assert.equal(submit.disabled, true);
    assert.equal(
        (await key()).defaultPrevented,
        true,
        'disabled submit is omitted from the single-input loop'
    );
    assert.equal(f.window.document.activeElement, f.input());
    assert.deepEqual(f.navigations, []);
    assert.equal(f.clears, 0);
});

it('Tab wrapping respects positive tab order and skips hidden or disabled header decorations', async (t) => {
    const f = await fixture(t, {
        hasNoResults: true,
        headerActions: h(
            'span',
            null,
            h('button', { type: 'button', tabIndex: 2 }, 'Priority decoration'),
            h(
                'button',
                { type: 'button', disabled: true },
                'Disabled decoration'
            ),
            h(
                'span',
                { hidden: true },
                h('button', { type: 'button' }, 'Hidden decoration')
            ),
            h(
                'span',
                { style: { display: 'none' } },
                h('button', { type: 'button' }, 'Absent decoration')
            ),
            h(
                'span',
                { style: { visibility: 'hidden' } },
                h('button', { type: 'button' }, 'Invisible decoration')
            )
        ),
    });
    await f.edit('term');
    const buttons = [...f.container.querySelectorAll('button')];
    const first = buttons.find(
        (node) => node.textContent === 'Priority decoration'
    );
    const last = buttons.at(-1);
    assert.ok(first && last);
    await act(async () => first.focus());
    await act(async () => {
        first.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Tab',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(f.window.document.activeElement, last);
    await act(async () => {
        last.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(f.window.document.activeElement, first);
    assert.deepEqual(f.navigations, []);
});

it('does not steal keyboard focus from a nested active dialog', async (t) => {
    const f = await fixture(t, {
        headerActions: h(
            'div',
            { role: 'dialog', 'aria-label': 'Nested decoration' },
            h('button', { type: 'button' }, 'Nested control')
        ),
    });
    const nested = [...f.container.querySelectorAll('button')].find(
        (node) => node.textContent === 'Nested control'
    );
    assert.ok(nested);
    await act(async () => nested.focus());
    for (const shiftKey of [false, true]) {
        const event = new f.window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            nested.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, false);
        assert.equal(f.window.document.activeElement, nested);
    }
    assert.deepEqual(f.navigations, []);
});

it('preserves native truthy description/nullish title-error policies and literal text', async (t) => {
    const f = await fixture(t, {
        title: '',
        description: '{fieldName} / {fieldName} <script>',
        noResultsMessage: '',
        hasNoResults: true,
    });
    assert.equal(f.container.querySelector('h2')?.textContent, '');
    assert.equal(
        f.container.querySelector('dialog')?.getAttribute('aria-label'),
        'Search'
    );
    assert.equal(f.container.querySelector('script'), null);
    assert.match(
        f.container.textContent,
        /Customer Name \/ Customer Name <script>/
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-search-gate-error p')?.textContent,
        ''
    );
    await f.update({ title: null, description: '', noResultsMessage: null });
    assert.equal(f.container.querySelector('h2')?.textContent, 'Search');
    assert.match(
        f.container.textContent,
        /Please enter a value for Customer Name/
    );
    assert.match(
        f.container.querySelector('.mx-sdk-search-gate-error')?.textContent ??
            '',
        /No records found matching/
    );
    await f.update({ ariaLabel: 'Find authorized records' });
    assert.equal(
        f.container.querySelector('dialog')?.getAttribute('aria-label'),
        'Find authorized records'
    );
});

it('keeps no-results separate from local error visibility across typing, submit, Clear and rerender', async (t) => {
    const f = await fixture(t, { hasNoResults: true });
    const error = () => f.container.querySelector('.mx-sdk-search-gate-error');
    assert.ok(error());
    await f.edit('term');
    assert.ok(error(), 'typing does not hide the native error');
    await f.submit();
    assert.equal(error(), null);
    await f.update({ hasNoResults: true });
    assert.equal(
        error(),
        null,
        'same result flag does not replay error effect'
    );
    assert.equal(
        f.container.querySelector('button[type=submit]')?.textContent,
        'Search Again'
    );
    await f.update({ hasNoResults: false });
    await f.update({ hasNoResults: true });
    assert.ok(error());
    const clear = [...f.container.querySelectorAll('button')].find(
        (node) => node.type === 'button'
    );
    assert.ok(clear);
    await act(async () => clear.click());
    assert.equal(f.input().value, '');
    assert.equal(error(), null);
    assert.equal(f.clears, 1);
    assert.equal(f.navigations.length, 1, 'Clear never submits/navigates');
    assert.equal(clear.textContent, 'Clear');
});

it('retains the native draft on field/copy replacement and uses the current field/callback on submit', async (t) => {
    const f = await fixture(t);
    await f.edit(' draft ');
    const id = f.input().id;
    const next: string[] = [];
    await f.update({
        searchPageField: { fieldId: 'fld_New', fieldName: 'Other' },
        title: 'Changed',
        onNavigate(url) {
            next.push(url);
        },
    });
    assert.equal(f.input().value, ' draft ');
    assert.equal(f.input().id, id);
    assert.equal(f.input().placeholder, 'Enter other');
    await f.submit();
    assert.equal(new URL(next[0]).searchParams.get('search_Other'), 'draft');
    assert.deepEqual(f.navigations, []);
    await f.update({ searchPageField: initial.searchPageField });
    assert.equal(f.input().value, ' draft ', 'ABA is not a hidden draft reset');
    await f.update({ searchPageField: { fieldId: 'empty', fieldName: '' } });
    await f.submit();
    assert.equal(next.length, 1, 'empty metadata name refuses navigation');
});

it('Clear remains a local non-submit action when a host has no clearing callback', async (t) => {
    const f = await fixture(t, {
        hasNoResults: true,
        onClearSearch: undefined,
    });
    await f.edit('value');
    const clear = [...f.container.querySelectorAll('button')].find(
        (node) => node.type === 'button'
    );
    assert.ok(clear);
    await act(async () => clear.click());
    assert.equal(f.input().value, '');
    assert.equal(f.container.querySelector('.mx-sdk-search-gate-error'), null);
    assert.equal(f.reads, 0);
    assert.deepEqual(f.navigations, []);
});

it('uses unique generated associations for simultaneous instances without shared drafts or callbacks', async (t) => {
    const f = await fixture(t);
    let secondWrites = 0;
    await act(async () =>
        f.root.render(
            h(
                StrictMode,
                null,
                h(PortalSearchGate, { ...initial, onNavigate() {} }),
                h(PortalSearchGate, {
                    ...initial,
                    onNavigate() {
                        secondWrites++;
                    },
                })
            )
        )
    );
    const inputs = [...f.container.querySelectorAll('input')];
    assert.equal(inputs.length, 2);
    assert.notEqual(inputs[0].id, inputs[1].id);
    for (const node of inputs)
        assert.ok(f.container.querySelector(`label[for="${node.id}"]`));
    await f.edit('first only');
    assert.equal(inputs[1].value, '');
    assert.equal(secondWrites, 0);
    await f.unmount();
    assert.equal(f.container.querySelector('dialog'), null);
});

it('delegates only the shell while retaining the real SDK prompt, draft, error and URL policy', async (t) => {
    let shows = 0;
    let closes = 0;
    const shell: NonNullable<Props['renderDialog']> = ({
        children,
        ariaLabel,
        descriptionId,
        initialFocus,
    }) =>
        h(
            'div',
            {
                role: 'dialog',
                'aria-modal': true,
                'aria-label': ariaLabel,
                'aria-describedby': descriptionId,
                ref: (node: HTMLDivElement | null): void => {
                    if (node) initialFocus.current?.focus();
                },
            },
            children
        );
    const f = await fixture(
        t,
        {
            renderDialog: shell,
            hasNoResults: true,
            accentColor: '#123456',
        },
        (window) => {
            const prototype = window.HTMLDialogElement.prototype;
            const show = prototype.showModal;
            const close = prototype.close;
            prototype.showModal = function (...args: Parameters<typeof show>) {
                shows++;
                return show.apply(this, args);
            };
            prototype.close = function (
                this: typeof prototype,
                ...args: Parameters<typeof close>
            ) {
                closes++;
                return close.apply(this, args);
            };
            return () => {
                prototype.showModal = show;
                prototype.close = close;
            };
        }
    );
    const dialog = f.container.querySelector('[role="dialog"]');
    assert.ok(dialog);
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.container.querySelectorAll('form').length, 1);
    assert.equal(f.container.querySelectorAll('input').length, 1);
    assert.equal(f.window.document.activeElement, f.input());
    assert.equal(dialog.getAttribute('aria-label'), 'Search');
    assert.equal(
        dialog.getAttribute('aria-describedby'),
        f.input().getAttribute('aria-describedby')?.split(' ')[0]
    );
    assert.equal(
        f.container
            .querySelector('section')
            ?.style.getPropertyValue('--mx-sdk-search-accent'),
        '#123456'
    );
    assert.ok(f.container.querySelector('.mx-sdk-search-gate-error'));
    await f.submit();
    assert.equal(f.reads, 0);
    await f.edit('  Alice & 東京  ');
    await f.update({ title: 'New title', description: 'Find {fieldName}' });
    assert.equal(f.input().value, '  Alice & 東京  ');
    assert.ok(f.container.querySelector('.mx-sdk-search-gate-error'));
    await f.submit();
    assert.equal(f.reads, 1);
    assert.equal(f.navigations.length, 1);
    const url = new URL(f.navigations[0]);
    assert.equal(url.searchParams.get('search_Customer Name'), 'Alice & 東京');
    assert.equal(url.searchParams.has('search_fld_Name'), false);
    assert.equal(url.searchParams.get('keep'), 'yes');
    assert.equal(url.hash, '#fragment');
    assert.equal(f.container.querySelector('.mx-sdk-search-gate-error'), null);
    const clear = [...f.container.querySelectorAll('button')].find(
        (node) => node.type === 'button'
    );
    assert.ok(clear);
    await act(async () => clear.click());
    assert.equal(f.input().value, '');
    assert.equal(f.clears, 1);
    await f.unmount();
    assert.equal(shows, 0);
    assert.equal(closes, 0);
    assert.equal(f.reads, 1);
    assert.equal(f.navigations.length, 1);
});

it('changes modal shells without resetting the SDK draft or allocating effects', async (t) => {
    const f = await fixture(t);
    await f.edit('retained draft');
    await f.update({
        renderDialog: ({ children, ariaLabel }) =>
            h('div', { role: 'dialog', 'aria-label': ariaLabel }, children),
    });
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.input().value, 'retained draft');
    await f.update({ renderDialog: undefined });
    assert.equal(f.container.querySelector('dialog')?.open, true);
    assert.equal(f.input().value, 'retained draft');
    assert.equal(f.window.document.activeElement, f.input());
    assert.equal(f.reads, 0);
    assert.equal(f.clears, 0);
    assert.deepEqual(f.navigations, []);
});

it('keeps packaged form spacing when the complete panel is rendered by a framework shell', async (t) => {
    const f = await fixture(
        t,
        {
            renderDialog: ({ children, ariaLabel }) =>
                h(
                    'section',
                    { role: 'dialog', 'aria-label': ariaLabel },
                    children
                ),
        },
        (window) => {
            window.document.documentElement.style.fontSize = '16px';
            const stylesheet = window.document.createElement('style');
            stylesheet.textContent = readFileSync(
                new URL('../src/react/search-gate.css', import.meta.url),
                'utf8'
            );
            window.document.head.append(stylesheet);
            return () => stylesheet.remove();
        }
    );
    const expectSpacing = () => {
        const actions = f.container.querySelector(
            '.mx-sdk-search-gate-actions'
        );
        assert.ok(actions);
        assert.equal(f.window.getComputedStyle(actions).marginTop, '16px');
    };
    expectSpacing();
    await f.update({ renderDialog: undefined });
    expectSpacing();
    assert.equal(f.reads, 0);
    assert.equal(f.clears, 0);
    assert.deepEqual(f.navigations, []);
});
