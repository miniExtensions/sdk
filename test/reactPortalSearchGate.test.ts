import assert from 'node:assert/strict';
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
    assert.equal(typeof document, 'undefined');
});

async function fixture(t: TestContext, patch: Partial<Props> = {}) {
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
