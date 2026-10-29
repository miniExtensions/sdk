import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { createOwnedCompiler } from './ownedCompiler.js';

const compiler = createOwnedCompiler();

type Confirmation = {
    requestConfirmation(options: {
        title: string;
        message: string;
        confirmLabel: string;
        cancelLabel?: string;
        signal?: AbortSignal;
    }): Promise<boolean>;
    cancelConfirmation(): void;
};
const failureMessage =
    'The confirmation could not be displayed. No action was taken.';
let directory: string;
let revision = 0;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-confirmation-'));
    await compiler.build({
        entryPoints: [resolve('examples/browser/src/confirmation.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'confirmation.mjs'),
    });
});
after(async () => {
    if (!compiler.canCleanup())
        throw new Error('Compiler did not close; output directory retained.');
    await rm(directory, { recursive: true, force: true });
});
const flush = () => new Promise<void>((done) => setImmediate(done));
const observe = (promise: Promise<boolean>) => {
    let result: unknown = 'pending';
    let settlements = 0;
    let writes = 0;
    void promise.then(
        (value) => {
            settlements++;
            if (value) writes++;
            result = { type: 'resolved', value };
        },
        (error: unknown) => {
            settlements++;
            result = {
                type: 'rejected',
                message: error instanceof Error ? error.message : String(error),
            };
        }
    );
    return {
        result: () => result,
        settlements: () => settlements,
        writes: () => writes,
    };
};
const fixture = async (test: TestContext) => {
    const window = new Window();
    const previous = ['document', 'HTMLElement'].map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, {
        document: window.document,
        HTMLElement: window.HTMLElement,
    });
    window.addEventListener('error', (event) => event.preventDefault());
    const confirmation = (await import(
        `${pathToFileURL(join(directory, 'confirmation.mjs')).href}?case=${++revision}`
    )) as Confirmation;
    const trigger = window.document.createElement('button');
    window.document.body.append(trigger);
    trigger.focus();
    const restorers: Array<() => void> = [];
    test.after(async () => {
        for (const restore of restorers) restore();
        confirmation.cancelConfirmation();
        await window.happyDOM.close();
        for (const [key, descriptor] of previous)
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
    });
    const request = (title: string, signal?: AbortSignal) =>
        confirmation.requestConfirmation({
            title,
            message: 'Synthetic confirmation',
            confirmLabel: 'Confirm',
            cancelLabel: 'Edit',
            signal,
        });
    const dialog = () => {
        const node = window.document.querySelector('dialog');
        assert.ok(node instanceof window.HTMLDialogElement);
        return node;
    };
    const button = (name: string, node = dialog()) => {
        const result = Array.from(node.querySelectorAll('button')).find(
            (entry) => entry.textContent === name
        );
        assert.ok(result instanceof window.HTMLButtonElement);
        return result;
    };
    return {
        window,
        confirmation,
        trigger,
        restorers,
        request,
        dialog,
        button,
    };
};

describe('shipped confirmation lifecycle', () => {
    for (const failure of [
        'show-modal',
        'initial-focus',
        'append',
        'close',
        'remove',
        'restore-focus',
    ] as const)
        it(`settles ${failure} failure once without authorizing or retiring a successor`, async (test) => {
            const f = await fixture(test);
            const { window } = f;
            const controller = new AbortController();
            let attempts = 0;
            const fail = () => {
                attempts++;
                throw Error('Synthetic private presentation detail');
            };
            let restore = () => {};
            if (failure === 'show-modal') {
                const proto = window.HTMLDialogElement.prototype;
                const original = proto.showModal;
                proto.showModal = fail;
                restore = () => (proto.showModal = original);
            } else if (failure === 'initial-focus') {
                const proto = window.HTMLElement.prototype;
                const original = proto.focus;
                proto.focus = function (...args) {
                    if (this.closest('dialog')) fail();
                    return original.apply(this, args);
                };
                restore = () => (proto.focus = original);
            } else if (failure === 'append') {
                const body = window.document.body;
                const original = body.append;
                body.append = (...nodes) => {
                    original.apply(body, nodes);
                    if (
                        nodes.some(
                            (node) => node instanceof window.HTMLDialogElement
                        )
                    )
                        fail();
                };
                restore = () => (body.append = original);
            }
            f.restorers.push(() => restore());
            const result = observe(f.request('Original', controller.signal));
            let retained: InstanceType<Window['HTMLButtonElement']> | null =
                null;
            if (['close', 'remove', 'restore-focus'].includes(failure)) {
                const dialog = f.dialog();
                retained = f.button('Confirm');
                if (failure === 'close') {
                    const original = dialog.close;
                    dialog.close = fail;
                    restore = () => (dialog.close = original);
                } else if (failure === 'remove') {
                    const original = dialog.remove;
                    dialog.remove = fail;
                    restore = () => (dialog.remove = original);
                } else {
                    const original = f.trigger.focus;
                    f.trigger.focus = fail;
                    restore = () => (f.trigger.focus = original);
                }
                try {
                    retained.click();
                } catch {
                    // An old event handler may throw while leaving its Promise pending.
                }
            }
            await flush();
            assert.equal(attempts, 1);
            assert.deepEqual(result.result(), {
                type: 'rejected',
                message: failureMessage,
            });
            assert.equal(result.settlements(), 1);
            assert.equal(result.writes(), 0);
            assert.equal(window.document.querySelectorAll('dialog').length, 0);
            restore();
            const successor = observe(f.request('Successor'));
            const current = f.dialog();
            controller.abort();
            retained?.click();
            await flush();
            assert.equal(current.isConnected, true);
            assert.equal(current.open, true);
            assert.equal(successor.result(), 'pending');
            assert.equal(result.settlements(), 1);
            f.button('Edit', current).click();
            await flush();
            assert.deepEqual(successor.result(), {
                type: 'resolved',
                value: false,
            });
        });

    it('refuses an initially aborted signal without constructing a prompt', async (test) => {
        const f = await fixture(test);
        const controller = new AbortController();
        controller.abort();
        assert.equal(await f.request('Aborted', controller.signal), false);
        assert.equal(f.window.document.querySelector('dialog'), null);
    });
    for (const action of ['edit', 'escape', 'close', 'abort'] as const)
        it(`keeps deliberate ${action} a single refusal`, async (test) => {
            const f = await fixture(test);
            const controller = new AbortController();
            const result = observe(f.request('Dismiss', controller.signal));
            if (action === 'edit') f.button('Edit').click();
            else if (action === 'escape')
                f.dialog().dispatchEvent(
                    new f.window.Event('cancel', { cancelable: true })
                );
            else if (action === 'close') f.dialog().close();
            else controller.abort();
            await flush();
            assert.deepEqual(result.result(), {
                type: 'resolved',
                value: false,
            });
            assert.equal(result.settlements(), 1);
            assert.equal(result.writes(), 0);
        });
    it('authorizes one ordinary Confirm and keeps retained callbacks inert', async (test) => {
        const f = await fixture(test);
        const controller = new AbortController();
        const first = observe(f.request('First', controller.signal));
        const confirm = f.button('Confirm');
        confirm.click();
        await flush();
        assert.deepEqual(first.result(), { type: 'resolved', value: true });
        assert.equal(first.writes(), 1);
        const next = observe(f.request('Next'));
        const current = f.dialog();
        confirm.click();
        controller.abort();
        await flush();
        assert.equal(first.settlements(), 1);
        assert.equal(first.writes(), 1);
        assert.equal(current.isConnected, true);
        assert.equal(next.result(), 'pending');
    });
    it('preserves a successor opened while an earlier request is cancelled', async (test) => {
        const f = await fixture(test);
        const first = observe(f.request('First'));
        const original = f.trigger.focus;
        let successor: ReturnType<typeof observe> | undefined;
        f.trigger.focus = () => {
            f.trigger.focus = original;
            successor = observe(f.request('Successor'));
        };
        const outer = observe(f.request('Superseded outer'));
        await flush();
        assert.deepEqual(first.result(), { type: 'resolved', value: false });
        assert.deepEqual(outer.result(), { type: 'resolved', value: false });
        assert.equal(successor?.result(), 'pending');
        assert.match(f.dialog().textContent ?? '', /Successor/);
    });
    it('refuses Confirm if focus restoration opened a successor', async (test) => {
        const f = await fixture(test);
        const first = observe(f.request('First'));
        const original = f.trigger.focus;
        let successor: ReturnType<typeof observe> | undefined;
        f.trigger.focus = () => {
            f.trigger.focus = original;
            successor = observe(f.request('Successor'));
        };
        f.button('Confirm').click();
        await flush();
        assert.deepEqual(first.result(), { type: 'resolved', value: false });
        assert.equal(first.writes(), 0);
        assert.equal(successor?.result(), 'pending');
        assert.match(f.dialog().textContent ?? '', /Successor/);
    });
});
