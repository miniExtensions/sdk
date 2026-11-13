import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    SignatureField,
    type SignatureFieldProps,
} from '../src/react/SignatureField.js';
import {
    SignatureStorageError,
    type SignatureAuthority,
    type SignatureRecovery,
    type TemporarySignature,
} from '../src/react/signatureReceipt.js';
import type { AirtableAttachment } from '../src/runtime/types.js';

const uploadOnly = { allowDrawnSignature: false, allowUploadedSignature: true };
const typeOnly = { allowDrawnSignature: false, allowTypedSignature: true };
const all = {
    allowDrawnSignature: true,
    allowTypedSignature: true,
    allowUploadedSignature: true,
};
const attachment = {
    id: null,
    url: 'https://example.test/signature.png',
    filename: 'signature.png',
    size: 3,
    type: 'image/png',
};
const unexpected = () => assert.fail('Unexpected recovery');

async function fixture(
    t: TestContext,
    config: SignatureFieldProps['config'] = uploadOnly
) {
    const window = new Window({ url: 'https://signature.example.test' });
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLCanvasElement: window.HTMLCanvasElement,
        EventTarget: window.EventTarget,
        Event: window.Event,
        CustomEvent: window.CustomEvent,
        File: window.File,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    let missingContext = false;
    const rasterCalls: {
        operation: string;
        args: unknown[];
        canvas: unknown;
        style: string;
        font: string;
    }[] = [];
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: function (this: unknown) {
            if (missingContext) return null;
            const context: Record<string, unknown> = {
                fillStyle: '',
                font: '',
            };
            for (const operation of [
                'fillRect',
                'clearRect',
                'fillText',
                'scale',
                'beginPath',
                'closePath',
                'arc',
                'fill',
                'moveTo',
                'lineTo',
                'drawImage',
            ])
                context[operation] = (...args: unknown[]) =>
                    rasterCalls.push({
                        operation,
                        args,
                        canvas: this,
                        style: String(context.fillStyle),
                        font: String(context.font),
                    });
            return context;
        },
    });
    Object.defineProperty(window.HTMLCanvasElement.prototype, 'toDataURL', {
        configurable: true,
        value: () => 'data:image/png;base64,cG5n',
    });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    window.document.body.append(container);
    let submits = 0;
    container.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const root = createRoot(container as unknown as HTMLElement);
    const pending: {
        file: File;
        authority: SignatureAuthority;
        resolve: (receipt: TemporarySignature) => void;
        reject: (error: unknown) => void;
    }[] = [];
    const recoveries: SignatureRecovery[] = [];
    const writes: AirtableAttachment[][] = [];
    let releases = 0;
    let mounted = true;
    let appendMode:
        | 'normal'
        | 'retired'
        | 'throw-before'
        | 'throw-after'
        | 'unknown' = 'normal';
    const props: SignatureFieldProps = {
        id: 'signature',
        ownerIdentity: 'A',
        value: [],
        config,
        storage: {
            store: (file, authority) =>
                new Promise((resolve, reject) =>
                    pending.push({ file, authority, resolve, reject })
                ),
        },
        onRecovery: (recovery) => recoveries.push(recovery),
        appendCurrent: (request) => {
            if (appendMode === 'retired') return 'retired';
            if (appendMode === 'unknown') return undefined as never;
            if (appendMode === 'throw-before') throw new Error('before commit');
            props.value = request.value.concat(request.attachment);
            writes.push([...props.value]);
            render();
            if (appendMode === 'throw-after') throw new Error('after commit');
            return 'appended';
        },
    };
    const render = () =>
        root.render(
            h(StrictMode, null, mounted ? h(SignatureField, props) : null)
        );
    t.after(async () => {
        await act(async () => root.unmount());
        for (const [key, value] of originals) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    });
    await act(async () => render());
    return {
        window,
        container,
        pending,
        recoveries,
        writes,
        rasterCalls,
        props,
        get releases() {
            return releases;
        },
        get submits() {
            return submits;
        },
        missingContext(value: boolean) {
            missingContext = value;
        },
        appendMode(value: typeof appendMode) {
            appendMode = value;
        },
        async update(next: Partial<SignatureFieldProps>) {
            Object.assign(props, next);
            await act(async () => render());
        },
        async unmount() {
            mounted = false;
            await act(async () => render());
        },
        async remount() {
            mounted = true;
            await act(async () => render());
        },
        button(name: string) {
            const button = [...container.querySelectorAll('button')].find(
                (node) => node.textContent === name
            );
            assert.ok(button, `Expected ${name}`);
            return button;
        },
        async click(name: string) {
            const button = this.button(name);
            await act(async () => button.click());
        },
        async type(value: string) {
            const input = container.querySelector('input[type=text]');
            assert.ok(input);
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(input, value);
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
        async upload(name = 'signature.png', type = 'image/png', size = 3) {
            const input = container.querySelector('input[type=file]');
            assert.ok(input);
            const file = new window.File([new Uint8Array(size)], name, {
                type,
            });
            Object.defineProperty(input, 'files', {
                configurable: true,
                value: [file],
            });
            await act(async () =>
                input.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                )
            );
        },
        async resolve(
            index = 0,
            release: TemporarySignature['release'] = async () => {
                releases++;
                return 'released';
            }
        ) {
            await act(async () =>
                pending[index]!.resolve({ attachment, release })
            );
        },
        async reject(error: unknown, index = 0) {
            await act(async () => pending[index]!.reject(error));
        },
        async draw(x = 10) {
            const canvas = container.querySelector('canvas');
            assert.ok(canvas);
            await act(async () => {
                canvas.dispatchEvent(
                    new window.PointerEvent('pointerdown', {
                        clientX: x,
                        clientY: 10,
                        buttons: 1,
                        button: 0,
                    })
                );
                window.document.dispatchEvent(
                    new window.PointerEvent('pointerup', {
                        clientX: x + 10,
                        clientY: 15,
                        buttons: 0,
                        button: 0,
                    })
                );
            });
        },
    };
}

it('imports and server-renders the complete default draw control without DOM or storage', () => {
    const html = renderToString(
        h(SignatureField, {
            id: 'ssr',
            ownerIdentity: null,
            value: [],
            appendCurrent: () => assert.fail('SSR append'),
            onRecovery: unexpected,
            storage: { store: async () => assert.fail('SSR storage') },
        })
    );
    assert.match(html, /Sign here/);
    assert.doesNotMatch(html, /<canvas|<input|tablist/);
});

it('reuses the previous signature without allocating storage or deletion authority', async (t) => {
    const f = await fixture(t);
    await f.update({ previousSignature: attachment });
    await f.click('Attach last signature');
    assert.deepEqual(f.writes, [[attachment]]);
    assert.equal(f.pending.length, 0);
    assert.equal(f.releases, 0);
    assert.equal(f.submits, 0);
});

it('renders enabled tabs in Type/Draw/Upload order and the exact upload accept list', async (t) => {
    const f = await fixture(t, all);
    assert.deepEqual(
        [...f.container.querySelectorAll('[role=tab]')].map(
            (n) => n.textContent
        ),
        ['Type', 'Draw', 'Upload']
    );
    await f.click('Upload');
    assert.equal(
        f.container.querySelector('input')?.accept,
        'image/png,image/jpeg,image/jpg,image/svg+xml'
    );
});

it('renders no producer or actions when all methods are disabled', async (t) => {
    const f = await fixture(t, {
        allowDrawnSignature: false,
        allowUploadedSignature: false,
    });
    assert.match(f.container.textContent, /No signature methods/);
    assert.equal(f.container.querySelector('button,input,canvas'), null);
});

it('clears a disabled method draft before it is reenabled', async (t) => {
    const f = await fixture(t, all);
    await f.type('old');
    await f.update({ config: { ...all, allowTypedSignature: false } });
    await f.update({ config: all });
    await f.click('Type');
    assert.equal(f.container.querySelector('input')?.value, '');
});

it('saves drawn PNG with the real engine and clears only after canonical transfer', async (t) => {
    const f = await fixture(t, {
        allowDrawnSignature: true,
        allowUploadedSignature: false,
    });
    assert.equal(f.button('Sign').disabled, true);
    await f.draw();
    await f.click('Sign');
    assert.equal(f.pending.length, 1);
    assert.equal(f.pending[0]?.file.type, 'image/png');
    await f.resolve();
    assert.deepEqual(f.writes, [[attachment]]);
    assert.equal(f.button('Sign').disabled, true);
    assert.equal(f.releases, 0);
});

it('clears typed input without signing or submitting', async (t) => {
    const f = await fixture(t, typeOnly);
    await f.type('Name');
    await f.click('Clear');
    assert.equal(f.container.querySelector('input')?.value, '');
    assert.equal(f.pending.length, 0);
    assert.equal(f.submits, 0);
});

it('converts typed names to white 600x200 PNG using the existing font', async (t) => {
    const f = await fixture(t, typeOnly);
    await f.type('Name');
    await f.click('Sign');
    assert.equal(f.pending.length, 1);
    const fill = f.rasterCalls.find(
        (call) => call.operation === 'fillRect' && call.style === '#ffffff'
    );
    assert.deepEqual(fill?.args, [0, 0, 600, 200]);
    assert.match(
        f.rasterCalls.find((call) => call.operation === 'fillText')?.font ?? '',
        /^48px "Brush Script MT", "Lucida Handwriting", cursive$/
    );
    assert.deepEqual(
        f.rasterCalls.find((call) => call.operation === 'fillText')?.args,
        ['Name', 300, 100]
    );
    await f.resolve();
    assert.equal(f.container.querySelector('input')?.value, '');
});

it('recovers from a missing typed canvas context with an explicit retry', async (t) => {
    const f = await fixture(t, typeOnly);
    f.missingContext(true);
    await f.type('Name');
    await f.click('Sign');
    assert.equal(f.pending.length, 0);
    assert.match(
        f.container.querySelector('[role=alert]')?.textContent ?? '',
        /couldn't save/
    );
    f.missingContext(false);
    await f.click('Sign');
    await f.resolve();
    assert.equal(f.writes.length, 1);
});

it('reports transport failure and retains the draft for explicit retry', async (t) => {
    const f = await fixture(t);
    await f.upload();
    await f.click('Sign');
    const original = new Error('upload rejected');
    const failure = new SignatureStorageError(
        original,
        'uncertain',
        new Error('cleanup rejected')
    );
    await f.reject(failure);
    assert.equal(f.writes.length, 0);
    assert.equal(f.recoveries[0]?.error, failure);
    assert.equal(failure.cause, original);
    assert.equal(failure.cleanup, 'uncertain');
    assert.match(f.container.textContent, /signature.png/);
    await f.click('Sign');
    assert.equal(f.pending.length, 2);
    await f.resolve(1);
    assert.equal(f.writes.length, 1);
});

for (const retirement of [
    'unmount',
    'disable',
    'owner',
    'field',
    'mode-aba',
    'owner-aba',
] as const) {
    it(`releases without appending after ${retirement}, including stale cleanup failure isolation`, async (t) => {
        const f = await fixture(t);
        await f.upload();
        await f.click('Sign');
        if (retirement === 'unmount') await f.unmount();
        if (retirement === 'disable')
            await f.update({
                config: { ...uploadOnly, allowUploadedSignature: false },
            });
        if (retirement === 'owner' || retirement === 'owner-aba')
            await f.update({ ownerIdentity: 'B' });
        if (retirement === 'owner-aba') await f.update({ ownerIdentity: 'A' });
        if (retirement === 'field') await f.update({ id: 'successor' });
        if (retirement === 'mode-aba') {
            await f.update({ config: typeOnly });
            await f.update({ config: uploadOnly });
        }
        let releases = 0;
        await f.resolve(0, async () => {
            releases++;
            throw new Error('cleanup failed');
        });
        assert.equal(releases, 1);
        assert.equal(f.writes.length, 0);
        assert.equal(f.recoveries[0]?.phase, 'release');
        assert.equal(
            f.container
                .querySelector('[role=alert]')
                ?.textContent.includes("couldn't save") ?? false,
            false
        );
        if (
            retirement === 'owner' ||
            retirement === 'owner-aba' ||
            retirement === 'field' ||
            retirement === 'mode-aba'
        ) {
            await f.upload('new.png');
            assert.equal(f.button('Sign').disabled, false);
        }
    });
}

for (const [type, size, message] of [
    ['text/plain', 3, 'valid image'],
    ['image/png', 5 * 1024 * 1024 + 1, 'less than 5MB'],
] as const) {
    it(`rejects invalid uploaded signature (${type}, ${size}) without storage`, async (t) => {
        const f = await fixture(t);
        await f.upload('signature', type, size);
        await f.click('Sign');
        assert.match(
            f.container.querySelector('[role=alert]')?.textContent ?? '',
            new RegExp(message)
        );
        assert.equal(f.pending.length, 0);
    });
}

it('admits exactly 5MiB and each legacy image MIME without changing attachment metadata', async (t) => {
    const f = await fixture(t);
    for (const type of [
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/svg+xml',
    ]) {
        await f.upload(
            'accepted',
            type,
            type === 'image/png' ? 5 * 1024 * 1024 : 3
        );
        await f.click('Sign');
        await f.resolve(f.pending.length - 1);
    }
    assert.equal(f.writes.length, 4);
    assert.equal(f.releases, 0);
});

it('appends to the latest committed list without resurrecting a concurrent removal or clearing newer upload B', async (t) => {
    const f = await fixture(t);
    const removed = { id: 'removed', url: 'https://example.test/old' };
    await f.update({ value: [removed] });
    await f.upload('A.png');
    await f.click('Sign');
    await f.update({ value: [] });
    await f.upload('B.png');
    await f.resolve();
    assert.deepEqual(f.writes, [[attachment]]);
    assert.match(f.container.textContent, /B.png/);
    assert.equal(f.button('Sign').disabled, false);
    await f.unmount();
    assert.equal(f.releases, 0);
});

it('preserves a newer typed draft and same-owner value echoes during pending A', async (t) => {
    const f = await fixture(t, typeOnly);
    await f.type('A');
    await f.click('Sign');
    await f.type('B');
    await f.update({ value: [...f.props.value] });
    await f.resolve();
    assert.equal(f.container.querySelector('input')?.value, 'B');
    assert.equal(f.writes.length, 1);
});

for (const outcome of ['throw-before', 'throw-after', 'unknown'] as const) {
    it(`blocks reappend and deletion after uncertain ${outcome}`, async (t) => {
        const f = await fixture(t);
        f.appendMode(outcome);
        await f.upload();
        await f.click('Sign');
        await f.resolve();
        assert.equal(f.writes.length, outcome === 'throw-after' ? 1 : 0);
        assert.equal(f.releases, 0);
        assert.match(
            f.container.querySelector('[role=alert]')?.textContent ?? '',
            /uncertain/
        );
        await f.click('Sign');
        assert.equal(f.pending.length, 1);
        await f.unmount();
        assert.equal(f.releases, 0);
    });
}

it('releases a positively rejected canonical append once', async (t) => {
    const f = await fixture(t);
    f.appendMode('retired');
    await f.upload();
    await f.click('Sign');
    await f.resolve();
    assert.equal(f.writes.length, 0);
    assert.equal(f.releases, 1);
    assert.equal(f.recoveries.length, 0);
});

it('retires pending resize timers and gives StrictMode/remount a fresh canvas', async (t) => {
    const f = await fixture(t, {
        allowDrawnSignature: true,
        allowUploadedSignature: false,
    });
    const old = f.container.querySelector('canvas');
    assert.ok(old);
    f.window.dispatchEvent(new f.window.Event('resize'));
    await f.unmount();
    const retiredCalls = f.rasterCalls.length;
    await f.remount();
    const successor = f.container.querySelector('canvas');
    assert.notEqual(old, successor);
    const successorCalls = f.rasterCalls.filter(
        (call) => call.canvas === successor
    ).length;
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 170));
    });
    assert.equal(
        f.rasterCalls.filter((call) => call.canvas === successor).length,
        successorCalls
    );
    assert.ok(f.rasterCalls.length >= retiredCalls);
    assert.equal(f.button('Sign').disabled, true);
});

it('preserves a newer drawn draft while pending A transfers', async (t) => {
    const f = await fixture(t, { allowDrawnSignature: true });
    await f.draw();
    await f.click('Sign');
    await f.draw(40);
    await f.resolve();
    assert.equal(f.writes.length, 1);
    assert.equal(f.button('Sign').disabled, false);
    await f.click('Sign');
    assert.equal(f.pending.length, 2);
    await f.resolve(1);
    assert.equal(f.button('Sign').disabled, true);
});

it('old release failure cannot change successor busy state while its B is pending', async (t) => {
    const f = await fixture(t);
    await f.upload('A.png');
    await f.click('Sign');
    await f.update({ ownerIdentity: 'B' });
    await f.upload('B.png');
    await f.click('Sign');
    assert.equal(f.pending.length, 2);
    await f.resolve(0, async () => {
        throw new Error('old cleanup');
    });
    assert.equal(f.button('Saving...').disabled, true);
    assert.equal(f.container.querySelector('[role=alert]'), null);
    await f.resolve(1);
    assert.equal(f.writes.length, 1);
    assert.equal(f.recoveries.length, 1);
});

it('keeps uncertain recovery visible when switching methods', async (t) => {
    const f = await fixture(t, all);
    f.appendMode('throw-after');
    await f.type('A');
    await f.click('Sign');
    await f.resolve();
    await f.click('Upload');
    assert.match(
        f.container.querySelector('[role=alert]')?.textContent ?? '',
        /uncertain/
    );
    await f.upload('B.png');
    assert.equal(f.button('Sign').disabled, true);
});

it('preserves a drawn draft after a resize event with unchanged canvas dimensions', async (t) => {
    const f = await fixture(t, { allowDrawnSignature: true });
    await f.draw();
    const calls = f.rasterCalls.length;
    await act(async () => {
        f.window.dispatchEvent(new f.window.Event('resize'));
        await new Promise((resolve) => setTimeout(resolve, 170));
    });
    assert.equal(f.button('Sign').disabled, false);
    assert.equal(f.rasterCalls.length, calls);
});

it('admits only one storage operation from duplicate immediate Sign actions', async (t) => {
    const f = await fixture(t);
    await f.upload();
    const sign = f.button('Sign');
    await act(async () => {
        sign.click();
        sign.click();
    });
    assert.equal(f.pending.length, 1);
    await f.resolve();
    assert.equal(f.writes.length, 1);
});

it('does not acquire deletion authority when previous-signature append becomes uncertain', async (t) => {
    const f = await fixture(t);
    f.appendMode('throw-after');
    await f.update({ previousSignature: attachment });
    await f.click('Attach last signature');
    assert.equal(f.writes.length, 1);
    assert.equal(f.pending.length, 0);
    assert.equal(f.releases, 0);
    assert.match(
        f.container.querySelector('[role=alert]')?.textContent ?? '',
        /uncertain/
    );
});

it('localizes method navigation and action labels through the public messages', async (t) => {
    const f = await fixture(t, all);
    await f.update({
        messages: {
            methodLabel: 'Método',
            type: 'Escribir',
            draw: 'Dibujar',
            upload: 'Subir',
            sign: 'Firmar',
            clear: 'Borrar',
            typePlaceholder: 'Nombre',
        },
    });
    assert.equal(
        f.container.querySelector('[role=tablist]')?.getAttribute('aria-label'),
        'Método'
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('[role=tab]')].map(
            (n) => n.textContent
        ),
        ['Escribir', 'Dibujar', 'Subir']
    );
    assert.equal(f.container.querySelector('input')?.placeholder, 'Nombre');
    assert.equal(f.button('Firmar').disabled, true);
    await f.click('Dibujar');
    await f.update({
        messages: { ...f.props.messages, signHere: 'Firme aquí' },
    });
    assert.equal(
        f.container.querySelector('canvas')?.getAttribute('aria-label'),
        'Firme aquí'
    );
});
