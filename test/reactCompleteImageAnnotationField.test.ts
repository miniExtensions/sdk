import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    ImageAnnotationField,
    type ImageAnnotationFieldProps,
} from '../src/react/CompleteImageAnnotationField.js';

type Upload = { temporary: true };
type Props = ImageAnnotationFieldProps<Upload>;

async function fixture(t: TestContext, patch: Partial<Props> = {}) {
    const window = new Window();
    const keys = ['window', 'document', 'navigator', 'HTMLElement',
        'HTMLInputElement', 'HTMLImageElement', 'HTMLButtonElement',
        'IS_REACT_ACT_ENVIRONMENT'] as const;
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
    for (const key of keys) Object.defineProperty(globalThis, key, {
        configurable: true, writable: true,
        value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key as keyof Window],
    });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const token = {};
    let current = token;
    const owner = { token, isCurrent: () => current === token };
    const created: string[] = [], revoked: string[] = [], errors: unknown[] = [];
    let uploads = 0, reads = 0, appends = 0, mounted = true;
    t.mock.method(URL, 'createObjectURL', () => {
        const url = 'blob:annotation-' + (created.length + 1);
        created.push(url);
        return url;
    });
    t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
    let props: Props = {
        owner,
        storage: {
            async createTemporaryPng() { uploads++; return { temporary: true }; },
            async resolveUrl() { reads++; return 'https://synthetic.invalid/output.png'; },
        },
        appendCurrent() { appends++; return 'appended'; },
        onError(_phase, error) { errors.push(error); },
        ...patch,
    };
    const render = async () => {
        await act(async () => root.render(h(StrictMode, null, h(ImageAnnotationField<Upload>, props))));
    };
    const update = async (next: Partial<Props>) => { props = { ...props, ...next }; await render(); };
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        try { await unmount(); } finally {
            t.mock.restoreAll();
            keys.forEach((key, index) => {
                const descriptor = originals[index];
                if (descriptor) Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    const input = () => { const node = container.querySelector('input'); assert.ok(node); return node; };
    const select = async (node = input(), type = 'image/png') => {
        Object.defineProperty(node, 'files', {
            configurable: true, value: [new window.File(['synthetic selection'], 'photo.png', { type })],
        });
        await act(async () => { node.dispatchEvent(new window.Event('change', { bubbles: true })); });
    };
    await render();
    return {
        window, container, input, select, update, unmount,
        created, revoked, errors,
        counts: () => ({ uploads, reads, appends }),
        async owner(next = {}) {
            current = next;
            await update({ owner: { token: next, isCurrent: () => current === next } });
        },
        async originalOwner() { current = token; await update({ owner }); },
    };
}

const inertProps: Props = {
    owner: { token: {}, isCurrent: () => false },
    storage: {
        async createTemporaryPng() { throw new Error('SSR must not allocate'); },
        async resolveUrl() { throw new Error('SSR must not resolve'); },
    },
    appendCurrent() { throw new Error('SSR must not append'); },
};

it('renders standalone SSR picker and prominent attribution without vendor/storage work', () => {
    const html = renderToString(h(ImageAnnotationField<Upload>, inertProps));
    assert.ok(html.includes('type="file"'));
    assert.ok(html.includes('accept="image/*"'));
    assert.ok(html.includes('https://markerjs.com'));
    assert.ok(html.includes('Image annotation powered by marker.js'));
    assert.ok(!html.includes('<form'));
});

it('uses actual external form/name/help associations and an accessible picker', async (t) => {
    const f = await fixture(t, { id: 'annotation', name: 'image', form: 'native-save', ariaDescribedBy: 'help' });
    assert.equal(f.input().id, 'annotation');
    assert.equal(f.input().name, 'image');
    assert.equal(f.input().getAttribute('form'), 'native-save');
    assert.equal(f.input().getAttribute('aria-describedby'), 'help');
    assert.equal(f.container.querySelector('label')?.htmlFor, f.input().id);
    assert.ok(f.input().getAttribute('aria-label'));
    assert.equal(f.container.querySelector('form'), null);
});

it('file selection creates a source without storage or canonical writes', async (t) => {
    const f = await fixture(t);
    await f.select();
    assert.equal(f.container.querySelector('img')?.getAttribute('src'), f.created[0]);
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});

it('undefined-to-false policy echoes preserve the source and picker DOM', async (t) => {
    const f = await fixture(t);
    await f.select();
    const input = f.input(), image = f.container.querySelector('img');
    await f.update({ disabled: false, readOnly: false });
    assert.equal(f.input(), input);
    assert.equal(f.container.querySelector('img'), image);
    assert.deepEqual(f.revoked, []);
});

it('owner replacement retires the old picker rather than retargeting its file result', async (t) => {
    const f = await fixture(t);
    const old = f.input();
    await f.select(old);
    await f.owner();
    assert.notEqual(f.input(), old);
    await f.select(old);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.revoked, ['blob:annotation-1']);
    await f.select();
    assert.equal(f.created.length, 2);
});

it('owner A to B to A never reuses A old picker DOM', async (t) => {
    const f = await fixture(t);
    const oldA = f.input();
    await f.owner();
    await f.originalOwner();
    assert.notEqual(f.input(), oldA);
    await f.select(oldA);
    assert.deepEqual(f.created, []);
    await f.select();
    assert.equal(f.created.length, 1);
});

it('readOnly replacement retires the current local source and refuses selection', async (t) => {
    const f = await fixture(t);
    await f.select();
    const old = f.input();
    await f.update({ readOnly: true });
    assert.equal(f.input().disabled, true);
    assert.equal(f.container.querySelector('img'), null);
    assert.deepEqual(f.revoked, ['blob:annotation-1']);
    await f.select(old);
    assert.equal(f.created.length, 1);
});

it('disabled replacement uses the same refusal and original URL cleanup', async (t) => {
    const f = await fixture(t);
    await f.select();
    await f.update({ disabled: true });
    await f.select();
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.revoked, ['blob:annotation-1']);
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});

it('a late image error cannot clear the replacement source or publish feedback', async (t) => {
    const f = await fixture(t);
    await f.select();
    const old = f.container.querySelector('img');
    assert.ok(old);
    await f.select();
    const next = f.container.querySelector('img');
    await act(async () => { old.dispatchEvent(new f.window.Event('error')); });
    assert.equal(f.container.querySelector('img'), next);
    assert.deepEqual(f.errors, []);
});

it('non-image MIME selection leaves the existing source untouched', async (t) => {
    const f = await fixture(t);
    await f.select();
    const image = f.container.querySelector('img');
    await f.select(f.input(), 'text/plain');
    assert.equal(f.container.querySelector('img'), image);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.revoked, []);
});

it('focus and untouched blur do not allocate transport or append', async (t) => {
    const f = await fixture(t);
    await act(async () => { f.input().focus(); f.input().blur(); });
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});

it('remote source echoes preserve its mounted image without acquiring URL ownership', async (t) => {
    const f = await fixture(t);
    const token = {};
    const remote = { token, url: 'data:image/png;base64,iVBORw0KGgo=', filename: 'remote.png' };
    await f.update({ remoteSource: remote });
    const image = f.container.querySelector('img');
    await f.update({ remoteSource: { ...remote } });
    assert.equal(f.container.querySelector('img'), image);
    assert.deepEqual(f.created, []);
    assert.deepEqual(f.revoked, []);
});

it('a fresh remote source lease for the same URL gets a fresh decode DOM node', async (t) => {
    const f = await fixture(t);
    const remote = { token: {}, url: 'data:image/png;base64,iVBORw0KGgo=', filename: 'remote.png' };
    await f.update({ remoteSource: remote });
    const old = f.container.querySelector('img');
    await f.update({ remoteSource: { ...remote, token: {} } });
    assert.notEqual(f.container.querySelector('img'), old);
    assert.deepEqual(f.revoked, []);
});

it('StrictMode unmount releases each local URL once and refuses late feedback', async (t) => {
    const f = await fixture(t);
    await f.select();
    const old = f.container.querySelector('img');
    assert.ok(old);
    await f.unmount();
    await act(async () => old.dispatchEvent(new f.window.Event('error')));
    assert.deepEqual(f.revoked, ['blob:annotation-1']);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.counts(), { uploads: 0, reads: 0, appends: 0 });
});
