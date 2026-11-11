import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, useLayoutEffect } from 'react';
import {
    BrowserMultiFormatReader,
    type Result,
    NotFoundException,
    ChecksumException,
} from '@zxing/library';
import type {
    CompleteBarcodeScannerProps,
    BarcodeScannerButtonOptions,
} from '../src/react/index.js';
let api: typeof import('../src/react/index.js');
async function fixture(t: import('node:test').TestContext) {
    const f = await scannerDom(t);
    // Like a browser bundle, load the dialog only after a DOM exists. SSR is
    // separately exercised in a fresh packed consumer without browser globals.
    api = await import('../src/react/index.js');
    return f;
}
import { scannerDom, deferred, cameraStream } from './fixtures/scannerDom.js';
void Window;
const vendorDecodeOnceFromStream =
    BrowserMultiFormatReader.prototype.decodeOnceFromStream;
const result = (text: string) => ({ getText: () => text }) as Result;
const device = { kind: 'videoinput' } as MediaDeviceInfo;

// First in this process: exercise the real cold module handoff, without a
// production loader seam or a mocked dialog/runtime.
it('retires a cold dialog load before any camera work and admits a fresh successor', async (t) => {
    const f = await fixture(t);
    const media = cameraStream();
    const writes: string[] = [];
    let lists = 0,
        acquisitions = 0,
        decodes = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => {
            lists++;
            return [device];
        }
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
        acquisitions++;
        return media.stream;
    });
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        async () => {
            decodes++;
            return result('fresh');
        }
    );
    const scanner = (ownerKey: string) =>
        h(api.CompleteBarcodeScanner, {
            ownerKey,
            onUpdate: (value) => {
                writes.push(value);
            },
            onDismiss() {},
        });
    // StrictMode requests the runtime, but retirement happens in the same
    // stack, before the real dynamic import can fulfill.
    f.renderSync(scanner('retired'), true);
    f.renderSync(null);
    assert.deepEqual([lists, acquisitions, decodes], [0, 0, 0]);
    await act(async () => {
        await import('../src/react/scannerDialogRuntime.js');
    });
    assert.deepEqual([lists, acquisitions, decodes], [0, 0, 0]);
    assert.deepEqual(writes, []);
    assert.equal(f.document.querySelector('[role=dialog], video'), null);

    await f.render(scanner('successor'));
    assert.deepEqual([lists, acquisitions, decodes], [1, 1, 1]);
    assert.deepEqual(writes, ['fresh']);
    assert.equal(media.stops(), 1);
});

for (const failure of [
    'no-device',
    'permission-denied',
    'decode-error',
] as const)
    it(`keeps manual entry unchanged on ${failure}, with visible recovery`, async (t) => {
        const f = await fixture(t);
        const media = cameraStream();
        let writes = 0,
            dismissals = 0,
            acquisitions = 0;
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'listVideoInputDevices',
            async () => (failure === 'no-device' ? [] : [device])
        );
        t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
            acquisitions++;
            if (failure === 'permission-denied')
                throw { name: 'NotAllowedError' };
            return media.stream;
        });
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'decodeOnceFromStream',
            async () => {
                throw Error('Synthetic decode failure');
            }
        );
        await f.render(
            h(
                'div',
                null,
                h('input', { defaultValue: 'manual-original' }),
                h(api.CompleteBarcodeScanner, {
                    onUpdate: () => {
                        writes++;
                    },
                    onDismiss: () => dismissals++,
                })
            )
        );
        assert(
            f.document
                .querySelector('[role=alert]')
                ?.textContent?.includes(
                    failure === 'no-device'
                        ? 'No camera'
                        : failure === 'permission-denied'
                          ? 'denied'
                          : 'could not'
                )
        );
        assert.equal(
            f.document.querySelector('input')?.value,
            'manual-original'
        );
        assert.equal(writes, 0);
        await f.click('Enter manually');
        assert.equal(dismissals, 1);
        assert.equal(f.document.querySelector('video'), null);
        assert.equal(writes, 0);
        assert.equal(acquisitions, failure === 'no-device' ? 0 : 1);
        assert.equal(media.stops(), failure === 'decode-error' ? 1 : 0);
    });

it('retries an actual failed attempt once and delivers a single success', async (t) => {
    const f = await fixture(t);
    let lists = 0,
        writes: string[] = [];
    const media = cameraStream();
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => (++lists === 1 ? [] : [device])
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => media.stream);
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        async () => result('fresh')
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        })
    );
    assert(f.document.querySelector('[role=alert]'));
    await f.click('Try again');
    assert.deepEqual(writes, ['fresh']);
    assert.equal(lists, 2);
    assert.equal(media.stops(), 1);
});

it('ignores continuous NotFound frames, reports real failure, and rejects retained old callbacks after retry', async (t) => {
    const f = await fixture(t);
    let writes: string[] = [];
    const streams = [cameraStream(), cameraStream(), cameraStream()];
    let acquisitions = 0;
    const callbacks: Parameters<
        BrowserMultiFormatReader['decodeFromStream']
    >[2][] = [];
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => streams[acquisitions++].stream
    );
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeFromStream',
        async (
            ...[_stream, _video, callback]: Parameters<
                BrowserMultiFormatReader['decodeFromStream']
            >
        ) => {
            callbacks.push(callback);
        }
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            runInLoop: true,
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        })
    );
    await act(async () => callbacks[0](null!, new NotFoundException()));
    assert.equal(f.document.querySelector('[role=alert]'), null);
    await act(async () => callbacks[0](null!, new ChecksumException()));
    assert(f.document.querySelector('[role=alert]'));
    assert.equal(streams[0].stops(), 1);
    await f.click('Try again');
    await act(async () => {
        callbacks[0](result('retired'), null!);
        callbacks[1](result('successor'), null!);
    });
    assert.deepEqual(writes, ['successor']);
    await f.click('Close');
    await act(async () => callbacks[1](result('after-close'), null!));
    assert.deepEqual(writes, ['successor']);
    assert.equal(streams[1].stops(), 1);
});

for (const boundary of ['dismiss', 'unmount', 'owner-aba', 'mode'] as const)
    it(`retires a late decode across ${boundary} with a live successor control`, async (t) => {
        const f = await fixture(t);
        const pending = deferred<Result>();
        const media = cameraStream();
        let writes: string[] = [];
        let decodes = 0;
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'listVideoInputDevices',
            async () => [device]
        );
        t.mock.method(f.mediaDevices, 'getUserMedia', async () => media.stream);
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'decodeOnceFromStream',
            () =>
                ++decodes === 1
                    ? pending.promise
                    : Promise.resolve(result('fresh'))
        );
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'decodeFromStream',
            async (
                ...[_s, _v, cb]: Parameters<
                    BrowserMultiFormatReader['decodeFromStream']
                >
            ) => cb(result('fresh-loop'), null!)
        );
        const props: CompleteBarcodeScannerProps = {
            ownerKey: 'A',
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        };
        await f.render(h(api.CompleteBarcodeScanner, props));
        if (boundary === 'dismiss') await f.click('Close');
        else if (boundary === 'unmount') await f.render(null);
        else if (boundary === 'mode')
            await f.render(
                h(api.CompleteBarcodeScanner, { ...props, runInLoop: true })
            );
        else {
            await f.render(
                h(api.CompleteBarcodeScanner, { ...props, ownerKey: 'B' })
            );
            await f.render(h(api.CompleteBarcodeScanner, props));
        }
        await act(async () => pending.resolve(result('old')));
        assert(!writes.includes('old'));
        assert(media.stops() >= 1);
        if (boundary === 'mode') assert.deepEqual(writes, ['fresh-loop']);
        else {
            await f.render(null);
            await f.render(h(api.CompleteBarcodeScanner, props));
            assert(writes.includes('fresh'));
        }
    });

it('stops late-acquired media under StrictMode and unmount without starting decoder work', async (t) => {
    const f = await fixture(t);
    const pending = deferred<MediaStream>();
    const media = cameraStream();
    let decodes = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', () => pending.promise);
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        async () => {
            decodes++;
            return result('wrong');
        }
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate() {
                assert.fail('late write');
            },
            onDismiss() {},
        }),
        true
    );
    await f.unmount();
    await act(async () => pending.resolve(media.stream));
    assert.equal(media.stops(), 1);
    assert.equal(decodes, 0);
});

it('uses the current callback without restarting the mounted camera', async (t) => {
    const f = await fixture(t);
    const pending = deferred<Result>();
    let acquisitions = 0;
    let first = 0,
        second = 0;
    const media = cameraStream();
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
        acquisitions++;
        return media.stream;
    });
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        () => pending.promise
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate: () => {
                first++;
            },
            onDismiss() {},
        })
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate: () => {
                second++;
            },
            onDismiss() {},
        })
    );
    await act(async () => pending.resolve(result('current')));
    assert.equal(acquisitions, 1);
    assert.equal(first, 0);
    assert.equal(second, 1);
});

for (const fieldType of ['barcode', 'email', 'url', 'singleLineText'] as const)
    it(`owns ${fieldType} enablement and stale auto-start suppression`, async (t) => {
        const f = await fixture(t);
        let allocations = 0;
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'listVideoInputDevices',
            async () => {
                allocations++;
                return [];
            }
        );
        let enabled = false,
            readOnly = false;
        function Host() {
            const scanner = api.useBarcodeScannerButtonInField({
                fieldType,
                enableQRCodeScannerForFormField: enabled,
                autoStartCamera: true,
                readOnly,
                className: 'consumer-scanner',
                setValue() {},
            });
            return h(
                'div',
                null,
                scanner.barcodeScannerButton,
                scanner.scannerComponent
            );
        }
        await f.render(h(Host));
        assert.equal(
            Boolean(f.document.querySelector('video')),
            fieldType === 'barcode'
        );
        assert.equal(allocations, fieldType === 'barcode' ? 1 : 0);
        enabled = true;
        await f.render(h(Host));
        assert(f.document.querySelector('[data-testid=qr-scanner-button]'));
        if (fieldType !== 'barcode') await f.click('Scan barcode or QR code');
        assert(f.document.querySelector('video'));
        assert(f.document.querySelector('.consumer-scanner[role=dialog]'));
        readOnly = true;
        await f.render(h(Host));
        assert.equal(f.document.querySelector('video'), null);
        assert.equal(
            f.document.querySelector('[data-testid=qr-scanner-button]'),
            null
        );
        readOnly = false;
        await f.render(h(Host));
        assert.equal(f.document.querySelector('video'), null);
        await f.click('Scan barcode or QR code');
        assert(f.document.querySelector('video'));
    });

it('keeps the allocated callback settling while dismiss/owner ABA retires restarts', async (t) => {
    const f = await fixture(t);
    const pending = deferred<void>();
    let writes = 0;
    let options: BarcodeScannerButtonOptions = {
        autoStartCamera: true,
        hideButton: false,
        runInLoop: true,
        ownerKey: 'A',
        setValue: () => {
            writes++;
            return pending.promise;
        },
    };
    let scan: ((text: string) => void | Promise<void>) | undefined;
    function Host() {
        const scanner = api.useBarcodeScannerButton(options);
        scan = scanner.scannerComponent?.props.onUpdate;
        return h(
            'div',
            null,
            scanner.barcodeScannerButton,
            scanner.scannerComponent
        );
    }
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => []
    );
    await f.render(h(Host), true);
    let admitted: Promise<void> | undefined;
    await act(async () => {
        admitted = Promise.resolve(scan?.('once'));
    });
    assert.equal(writes, 1);
    options = { ...options, ownerKey: 'B' };
    await f.render(h(Host), true);
    options = { ...options, ownerKey: 'A' };
    await f.render(h(Host), true);
    await act(async () => {
        pending.resolve();
        await admitted;
    });
    assert.equal(f.document.querySelector('video'), null);
    assert.equal(writes, 1);
    await f.click('Scan barcode or QR code');
    assert(f.document.querySelector('video'));
});

it('retains the 1000ms nonempty throttle and exact 500ms loop restart', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    const callbacks: Parameters<
        BrowserMultiFormatReader['decodeFromStream']
    >[2][] = [];
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => cameraStream().stream
    );
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeFromStream',
        async (
            ...[_s, _v, cb]: Parameters<
                BrowserMultiFormatReader['decodeFromStream']
            >
        ) => {
            callbacks.push(cb);
        }
    );
    function Host() {
        const scanner = api.useBarcodeScannerButton({
            autoStartCamera: true,
            hideButton: false,
            runInLoop: true,
            setValue: (v) => {
                writes.push(v);
            },
        });
        return h(
            'div',
            null,
            scanner.barcodeScannerButton,
            scanner.scannerComponent
        );
    }
    await f.render(h(Host));
    await f.tick();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
    const scan = async (text: string) =>
        act(async () => callbacks.at(-1)!(result(text), null!));
    const advance = async (ms: number) =>
        act(async () => t.mock.timers.tick(ms));
    await scan('first');
    assert.deepEqual(writes, ['first']);
    assert.equal(f.document.querySelector('video'), null);
    await advance(499);
    assert.equal(f.document.querySelector('video'), null);
    await advance(1);
    assert(f.document.querySelector('video'));
    await scan('too-fast');
    assert.deepEqual(writes, ['first']);
    await advance(500);
    await scan('exactly-1000');
    assert.deepEqual(writes, ['first']);
    await advance(500);
    await scan('admitted');
    assert.deepEqual(writes, ['first', 'admitted']);
    await advance(500);
    await scan('');
    assert.deepEqual(writes, ['first', 'admitted']);
    await f.unmount();
    t.mock.timers.reset();
});

for (const boundary of ['dismiss', 'retry', 'unmount', 'strict'] as const)
    it(`retires actual vendor attachment and retained media events on ${boundary}`, async (t) => {
        const f = await fixture(t);
        const media: ReturnType<typeof cameraStream>[] = [];
        let decodes = 0,
            writes: string[] = [];
        const failures: string[] = [];
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'decodeOnceFromStream',
            function (
                this: BrowserMultiFormatReader,
                ...args: Parameters<
                    BrowserMultiFormatReader['decodeOnceFromStream']
                >
            ) {
                return vendorDecodeOnceFromStream
                    .apply(this, args)
                    .catch((error) => {
                        failures.push(String(error));
                        throw error;
                    });
            }
        );
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'listVideoInputDevices',
            async () => [device]
        );
        t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
            const next = cameraStream();
            media.push(next);
            return next.stream;
        });
        t.mock.method(
            BrowserMultiFormatReader.prototype,
            'decodeOnce',
            async () => {
                decodes++;
                return result('vendor-success');
            }
        );
        const play = t.mock.method(
            f.window.HTMLMediaElement.prototype,
            'play',
            async () => {}
        );
        const props: CompleteBarcodeScannerProps = {
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        };
        await f.render(
            h(api.CompleteBarcodeScanner, props),
            boundary === 'strict'
        );
        const old = f.document.querySelector('video');
        assert(old);
        assert.equal(decodes, 0);
        const oldPlay = play.mock.callCount();
        if (boundary === 'retry') {
            await act(async () =>
                old.dispatchEvent(new f.window.Event('error'))
            );
            assert(f.document.querySelector('[role=alert]'));
            await f.click('Try again');
        } else if (boundary === 'dismiss') await f.click('Close');
        else await f.render(null);
        await act(async () => {
            old.dispatchEvent(new f.window.Event('canplay'));
            old.dispatchEvent(new f.window.Event('playing'));
        });
        if (boundary !== 'retry') {
            assert.equal(decodes, 0);
            assert.equal(play.mock.callCount(), oldPlay);
        }
        assert.equal(writes.includes('vendor-success'), boundary === 'retry');
        assert.equal(media[0].stops(), 1);
        await f.render(null);
        await f.render(h(api.CompleteBarcodeScanner, props));
        const fresh = f.document.querySelector('video');
        assert(fresh);
        await act(async () =>
            fresh.dispatchEvent(new f.window.Event('playing'))
        );
        assert.equal(
            writes.at(-1),
            'vendor-success',
            JSON.stringify({
                failures,
                decodes,
                playCalls: play.mock.callCount(),
                alert: f.document.querySelector('[role=alert]')?.textContent,
                media: media.map((m) => m.stops()),
            })
        );
        assert.equal(media.at(-1)!.stops(), 1);
    });

it('does not replay or restart a rejected caller-owned lookup', async (t) => {
    const f = await fixture(t);
    let writes = 0;
    let decode:
        | Parameters<BrowserMultiFormatReader['decodeFromStream']>[2]
        | undefined;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => cameraStream().stream
    );
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeFromStream',
        async (
            ...[_s, _v, cb]: Parameters<
                BrowserMultiFormatReader['decodeFromStream']
            >
        ) => {
            decode = cb;
        }
    );
    function Host() {
        const scan = api.useBarcodeScannerButton({
            autoStartCamera: true,
            hideButton: false,
            runInLoop: true,
            async setValue() {
                writes++;
                throw Error('Caller lookup failed');
            },
        });
        return h('div', null, scan.barcodeScannerButton, scan.scannerComponent);
    }
    await f.render(h(Host));
    await f.tick();
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
    await act(async () => decode?.(result('once'), null!));
    assert.equal(writes, 1);
    assert.equal(f.document.querySelector('[role=dialog]'), null);
    await act(async () => t.mock.timers.tick(500));
    assert.equal(writes, 1);
    assert.equal(f.document.querySelector('[role=dialog]'), null);
    await f.unmount();
    t.mock.timers.reset();
});

it('dismisses synchronously once even when Close and backdrop fire before commit', async (t) => {
    const f = await fixture(t);
    let dismissed = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => []
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate() {
                assert.fail('write');
            },
            onDismiss() {
                dismissed++;
            },
        })
    );
    const close = f.document.querySelector('[data-testid=close-dialog]');
    const overlay = f.document.querySelector(
        '[data-testid=dialog-overlay-test-id]'
    );
    assert(close instanceof f.window.HTMLButtonElement);
    assert(overlay instanceof f.window.HTMLElement);
    await act(async () => {
        close.click();
        overlay.click();
    });
    assert.equal(dismissed, 1);
    assert.equal(f.document.querySelector('video'), null);
});

for (const boundary of ['retry', 'owner-aba'] as const)
    for (const settlement of ['resolve', 'reject'] as const)
        it(`old attachment ${settlement} and retained events cannot touch a live ${boundary} camera`, async (t) => {
            const f = await fixture(t);
            const pending = deferred<void>();
            const streams = [cameraStream(), cameraStream(), cameraStream()];
            let acquisitions = 0;
            let decodes = 0;
            const writes: string[] = [];
            const retained: (() => void)[] = [];
            const add = f.window.HTMLVideoElement.prototype.addEventListener;
            t.mock.method(
                f.window.HTMLVideoElement.prototype,
                'addEventListener',
                function (
                    this: object,
                    type: string,
                    callback: EventListener,
                    options?: unknown
                ) {
                    if (
                        this instanceof f.window.HTMLVideoElement &&
                        ['canplay', 'playing'].includes(type) &&
                        acquisitions === 1 &&
                        typeof callback === 'function'
                    )
                        retained.push(() =>
                            Reflect.apply(callback, this, [
                                new f.window.Event(type),
                            ])
                        );
                    return Reflect.apply(add, this, [type, callback, options]);
                }
            );
            t.mock.method(
                BrowserMultiFormatReader.prototype,
                'listVideoInputDevices',
                async () => [device]
            );
            t.mock.method(
                f.mediaDevices,
                'getUserMedia',
                async () => streams[acquisitions++].stream
            );
            t.mock.method(
                BrowserMultiFormatReader.prototype,
                'decodeOnce',
                async () => {
                    decodes++;
                    return result('successor');
                }
            );
            let plays = 0;
            t.mock.method(f.window.HTMLMediaElement.prototype, 'play', () =>
                ++plays === 1 ? pending.promise : Promise.resolve()
            );
            const props: CompleteBarcodeScannerProps = {
                ownerKey: 'A',
                onUpdate(v) {
                    writes.push(v);
                },
                onDismiss() {},
            };
            await f.render(h(api.CompleteBarcodeScanner, props));
            assert.equal(plays, 1);
            assert.equal(retained.length, 2);
            const video = f.document.querySelector('video');
            assert(video);
            if (boundary === 'retry') {
                await act(async () =>
                    video.dispatchEvent(new f.window.Event('error'))
                );
                await f.click('Try again');
            } else {
                await f.render(
                    h(api.CompleteBarcodeScanner, { ...props, ownerKey: 'B' })
                );
                await f.render(h(api.CompleteBarcodeScanner, props));
            }
            const attempts = boundary === 'retry' ? 2 : 3;
            assert.equal(acquisitions, attempts);
            assert.equal(plays, attempts);
            assert.equal(streams[0].stops(), 1);
            assert.equal(streams[attempts - 1].stops(), 0);
            await act(async () => {
                for (const callback of retained) callback();
                if (settlement === 'resolve') pending.resolve();
                else pending.reject(Error('Late old playback rejection'));
            });
            assert.equal(plays, attempts);
            assert.equal(decodes, 0);
            assert.deepEqual(writes, []);
            assert.equal(streams[attempts - 1].stops(), 0);
            await act(async () =>
                video.dispatchEvent(new f.window.Event('playing'))
            );
            assert.equal(decodes, 1);
            assert.deepEqual(writes, ['successor']);
            assert.equal(streams[attempts - 1].stops(), 1);
        });

it('closes after a one-shot caller rejection without replaying its allocated operation', async (t) => {
    const f = await fixture(t);
    const pending = deferred<void>();
    let writes = 0,
        dismissed = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => cameraStream().stream
    );
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        async () => result('allocated')
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            async onUpdate() {
                writes++;
                await pending.promise;
            },
            onDismiss() {
                dismissed++;
            },
        })
    );
    assert.equal(writes, 1);
    await act(async () => pending.reject(Error('Caller operation failed')));
    assert.equal(dismissed, 1);
    assert.equal(f.document.querySelector('video'), null);
    assert.equal(writes, 1);
});

it('retires an old decode at owner commit before a sibling layout effect can deliver it', async (t) => {
    const f = await fixture(t);
    const callbacks: Parameters<
        BrowserMultiFormatReader['decodeFromStream']
    >[2][] = [];
    const writes: string[] = [];
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => cameraStream().stream
    );
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeFromStream',
        async (
            ...[_s, _v, cb]: Parameters<
                BrowserMultiFormatReader['decodeFromStream']
            >
        ) => {
            callbacks.push(cb);
        }
    );
    function CommitEmitter({ owner }: { owner: string }) {
        useLayoutEffect(() => {
            if (owner === 'B') callbacks[0](result('old-at-commit'), null!);
        }, [owner]);
        return null;
    }
    function Host({ owner }: { owner: string }) {
        return h(
            'div',
            null,
            h(api.CompleteBarcodeScanner, {
                ownerKey: owner,
                runInLoop: true,
                onUpdate: (v) => {
                    writes.push(v);
                },
                onDismiss() {},
            }),
            h(CommitEmitter, { owner })
        );
    }
    await f.render(h(Host, { owner: 'A' }));
    await f.render(h(Host, { owner: 'B' }));
    assert.deepEqual(writes, []);
    assert.equal(callbacks.length, 2);
    await act(async () => callbacks[1](result('fresh'), null!));
    assert.deepEqual(writes, ['fresh']);
});

it('stops an ended pending attachment and permits a fresh retry', async (t) => {
    const f = await fixture(t);
    const streams = [cameraStream(), cameraStream()];
    let acquisitions = 0,
        decodes = 0;
    const writes: string[] = [];
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => streams[acquisitions++].stream
    );
    t.mock.method(f.window.HTMLMediaElement.prototype, 'play', async () => {});
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnce',
        async () => {
            decodes++;
            return result('fresh-after-ended');
        }
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        })
    );
    const video = f.document.querySelector('video');
    assert(video);
    await act(async () => video.dispatchEvent(new f.window.Event('ended')));
    assert(f.document.querySelector('[role=alert]'));
    assert.equal(streams[0].stops(), 1);
    assert.equal(decodes, 0);
    assert.deepEqual(writes, []);
    await f.click('Try again');
    assert.equal(acquisitions, 2);
    await act(async () => video.dispatchEvent(new f.window.Event('playing')));
    assert.deepEqual(writes, ['fresh-after-ended']);
    assert.equal(decodes, 1);
    assert.equal(streams[1].stops(), 1);
});

it('ends actual continuous polling and keeps a retry live across retained old ended events', async (t) => {
    const f = await fixture(t);
    const streams = [cameraStream(), cameraStream()];
    let acquisitions = 0,
        decodes = 0;
    let success = false;
    const writes: string[] = [];
    const retained: (() => void)[] = [];
    const add = f.window.HTMLVideoElement.prototype.addEventListener;
    t.mock.method(
        f.window.HTMLVideoElement.prototype,
        'addEventListener',
        function (
            this: object,
            type: string,
            callback: EventListener,
            options?: unknown
        ) {
            if (
                type === 'ended' &&
                acquisitions === 1 &&
                typeof callback === 'function'
            )
                retained.push(() =>
                    Reflect.apply(callback, this, [new f.window.Event(type)])
                );
            return Reflect.apply(add, this, [type, callback, options]);
        }
    );
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(
        f.mediaDevices,
        'getUserMedia',
        async () => streams[acquisitions++].stream
    );
    t.mock.method(f.window.HTMLMediaElement.prototype, 'play', async () => {});
    t.mock.method(BrowserMultiFormatReader.prototype, 'decode', () => {
        decodes++;
        if (!success) throw new NotFoundException();
        return result('fresh-loop');
    });
    await f.render(
        h(api.CompleteBarcodeScanner, {
            runInLoop: true,
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        })
    );
    await f.tick();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const video = f.document.querySelector('video');
    assert(video);
    await act(async () => video.dispatchEvent(new f.window.Event('playing')));
    assert.equal(decodes, 1);
    await act(async () => video.dispatchEvent(new f.window.Event('ended')));
    assert.equal(streams[0].stops(), 1);
    assert(f.document.querySelector('[role=alert]'));
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(decodes, 1);
    assert.deepEqual(writes, []);
    await f.click('Try again');
    assert.equal(acquisitions, 2);
    assert.equal(streams[1].stops(), 0);
    await act(async () => {
        for (const ended of retained) ended();
    });
    assert.equal(streams[1].stops(), 0);
    success = true;
    await act(async () => video.dispatchEvent(new f.window.Event('playing')));
    assert.deepEqual(writes, ['fresh-loop']);
    await f.click('Close');
    await act(async () => t.mock.timers.tick(1000));
    assert.equal(decodes, 2);
    assert.equal(streams[1].stops(), 1);
    await f.unmount();
    t.mock.timers.reset();
});

it('ignores a one-shot decode completing after the actual stream ended', async (t) => {
    const f = await fixture(t);
    const pending = deferred<Result>();
    const media = cameraStream();
    const writes: string[] = [];
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [device]
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => media.stream);
    t.mock.method(f.window.HTMLMediaElement.prototype, 'play', async () => {});
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnce',
        () => pending.promise
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate: (v) => {
                writes.push(v);
            },
            onDismiss() {},
        })
    );
    const video = f.document.querySelector('video');
    assert(video);
    await act(async () => video.dispatchEvent(new f.window.Event('playing')));
    await act(async () => video.dispatchEvent(new f.window.Event('ended')));
    await act(async () => pending.resolve(result('ended-final-frame')));
    assert.deepEqual(writes, []);
    assert.equal(media.stops(), 1);
    assert(f.document.querySelector('[role=alert]'));
});

it('owns Escape before an older host dialog window-bubble listener', async (t) => {
    const f = await fixture(t);
    let parentDismissed = 0,
        scannerDismissed = 0;
    const parent = () => {
        parentDismissed++;
    };
    f.window.addEventListener('keydown', parent);
    t.after(() => f.window.removeEventListener('keydown', parent));
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => []
    );
    await f.render(
        h(api.CompleteBarcodeScanner, {
            onUpdate() {},
            onDismiss() {
                scannerDismissed++;
            },
        })
    );
    await act(async () =>
        f.document.body.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(scannerDismissed, 1);
    assert.equal(parentDismissed, 0);
    assert.equal(f.document.querySelector('video'), null);
});

it('lets Escape dismiss only the top SDK scanner when two are explicitly mounted', async (t) => {
    const f = await fixture(t);
    let first = 0,
        second = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => []
    );
    await f.render(
        h(
            'div',
            null,
            h(api.CompleteBarcodeScanner, {
                onUpdate() {},
                onDismiss() {
                    first++;
                },
            }),
            h(api.CompleteBarcodeScanner, {
                onUpdate() {},
                onDismiss() {
                    second++;
                },
            })
        )
    );
    await act(async () =>
        f.document.body.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(first, 0);
    assert.equal(second, 1);
    assert.equal(f.document.querySelectorAll('video').length, 1);
    await act(async () =>
        f.document.body.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(first, 1);
    assert.equal(second, 1);
});

it('wraps the scanner recovery controls at the forward and reverse Tab boundaries', async (t) => {
    const f = await fixture(t);
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => []
    );
    await f.render(
        h(api.CompleteBarcodeScanner, { onUpdate() {}, onDismiss() {} })
    );
    const close = f.document.querySelector('[data-testid=close-dialog]');
    const manual = Array.from(f.document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Enter manually'
    );
    assert(close instanceof f.window.HTMLButtonElement);
    assert(manual);
    close.focus();
    await act(async () =>
        close.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Tab',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert(
        f.document.activeElement === manual,
        'reverse Tab active=' + f.document.activeElement?.outerHTML
    );
    await act(async () =>
        manual.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert(
        f.document.activeElement === close,
        'forward Tab active=' + f.document.activeElement?.outerHTML
    );
});
