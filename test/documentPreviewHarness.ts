import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Worker as NodeWorker } from 'node:worker_threads';
import type { TestContext } from 'node:test';
import type { Window } from 'happy-dom';

/** Actual native canvas and PDF.js thread; source proof, distinct from Chromium. */
export function documentCanvasHarness(t: TestContext, window: Window) {
    const require = createRequire(import.meta.url);
    const engineRequire = createRequire(
        require.resolve('pdfjs-dist/package.json')
    );
    const native = engineRequire('@napi-rs/canvas') as {
        createCanvas(
            width: number,
            height: number
        ): {
            width: number;
            height: number;
            getContext(type: '2d'): CanvasRenderingContext2D;
        };
        DOMMatrix: unknown;
        Path2D: unknown;
        ImageData: unknown;
    };
    const saved = ['DOMMatrix', 'Path2D', 'ImageData'].map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key] of saved)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: native[key as keyof typeof native],
        });
    const prototype = window.HTMLCanvasElement.prototype;
    const descriptors = ['width', 'height', 'getContext'].map(
        (key) => [key, Object.getOwnPropertyDescriptor(prototype, key)] as const
    );
    const surfaces = new WeakMap<
        object,
        ReturnType<typeof native.createCanvas>
    >();
    for (const dimension of ['width', 'height'] as const) {
        Object.defineProperty(prototype, dimension, {
            configurable: true,
            get() {
                return Number(
                    this.getAttribute(dimension) ??
                        (dimension === 'width' ? 300 : 150)
                );
            },
            set(value: number) {
                this.setAttribute(dimension, String(value));
                const surface = surfaces.get(this);
                if (surface) surface[dimension] = value;
            },
        });
    }
    Object.defineProperty(prototype, 'getContext', {
        configurable: true,
        value: function (
            this: InstanceType<typeof window.HTMLCanvasElement>,
            type: string
        ) {
            if (type !== '2d') return null;
            let canvas = surfaces.get(this);
            if (!canvas) {
                canvas = native.createCanvas(this.width, this.height);
                surfaces.set(this, canvas);
            }
            return canvas.getContext('2d');
        },
    });
    const workers: OwnedWorker[] = [];
    const errors: Error[] = [];
    class OwnedWorker extends EventTarget {
        readonly thread: NodeWorker;
        terminated = false;
        private ready = false;
        private queue: [
            unknown,
            import('node:worker_threads').Transferable[],
        ][] = [];
        readonly messages: {
            direction: string;
            action: unknown;
            source: unknown;
            target: unknown;
        }[] = [];
        constructor(url: string | URL, options: WorkerOptions) {
            super();
            assert.equal(
                new URL(String(url)).origin,
                new URL(window.document.URL).origin
            );
            assert.equal(options.type, 'module');
            assert.equal(options.credentials, 'omit');
            this.thread = new NodeWorker(
                resolve('test/fixtures/pdf-worker-thread.mjs')
            );
            this.thread.on('message', (data) => {
                this.messages.push({
                    direction: 'receive',
                    action: data.action,
                    source: data.sourceName,
                    target: data.targetName,
                });
                if (data.action === 'ready') {
                    this.ready = true;
                    for (const [message, transfer] of this.queue)
                        this.thread.postMessage(message, transfer);
                    this.queue = [];
                }
                try {
                    this.dispatchEvent(new MessageEvent('message', { data }));
                    this.messages.push({
                        direction: 'delivered',
                        action: data.action,
                        source: data.sourceName,
                        target: data.targetName,
                    });
                } catch (error) {
                    errors.push(error as Error);
                }
            });
            this.thread.on('error', (error) => errors.push(error));
            workers.push(this);
        }
        postMessage(
            message: unknown,
            transfer: import('node:worker_threads').Transferable[] = []
        ) {
            const data = message as Record<string, unknown>;
            this.messages.push({
                direction: 'send',
                action: data.action,
                source: data.sourceName,
                target: data.targetName,
            });
            if (this.ready) this.thread.postMessage(message, transfer);
            else this.queue.push([message, transfer]);
        }
        terminate() {
            this.terminated = true;
            void this.thread.terminate();
        }
    }
    const workerDescriptor = Object.getOwnPropertyDescriptor(window, 'Worker');
    Object.defineProperty(window, 'Worker', {
        configurable: true,
        value: OwnedWorker,
    });
    t.after(async () => {
        await Promise.all(workers.map((worker) => worker.thread.terminate()));
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(prototype, key, descriptor);
            else Reflect.deleteProperty(prototype, key);
        }
        if (workerDescriptor)
            Object.defineProperty(window, 'Worker', workerDescriptor);
        else Reflect.deleteProperty(window, 'Worker');
        assert.deepEqual(errors, []);
    });
    return { workers, surfaces };
}
