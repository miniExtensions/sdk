import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { BrowserMultiFormatReader, type Result } from '@zxing/library';
import { cameraStream, deferred, scannerDom } from './fixtures/scannerDom.js';

it('scanning writes only to the current URL scanner callback', async (t) => {
    const f = await scannerDom(t);
    const { UrlField } = await import('../src/react/index.js');
    const pending = deferred<Result>();
    const media = cameraStream();
    const typing: string[] = [];
    const scans: string[] = [];
    let allocations = 0;
    let decodes = 0;
    let submits = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [{ kind: 'videoinput' } as MediaDeviceInfo]
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
        allocations++;
        return media.stream;
    });
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        async () =>
            ++decodes === 1
                ? pending.promise
                : ({
                      getText: () => 'https://example.test/Current',
                  } as Result)
    );
    const render = (token: object) =>
        f.render(
            h(
                'form',
                {
                    onSubmit(event: { preventDefault(): void }) {
                        event.preventDefault();
                        submits++;
                    },
                },
                h(UrlField, {
                    mode: 'controlled',
                    value: 'https://example.test/Existing',
                    owner: { token, isCurrent: () => true },
                    scanner: { enableQRCodeScannerForFormField: true },
                    onChange: (value) => typing.push(value),
                    onScan: (value) => scans.push(value),
                }),
                h('input', { id: 'sibling', defaultValue: 'Sibling draft' })
            )
        );
    await render({});
    assert.equal(allocations, 0);
    await f.click('Scan barcode or QR code');
    assert.equal(decodes, 1);
    assert.deepEqual(scans, []);

    await render({});
    await act(async () =>
        pending.resolve({
            getText: () => 'https://example.test/Stale',
        } as Result)
    );
    assert.deepEqual(scans, []);
    await f.click('Scan barcode or QR code');
    assert.deepEqual(scans, ['https://example.test/Current']);
    assert.deepEqual(typing, []);
    const sibling = f.document.getElementById('sibling');
    assert.ok(sibling instanceof f.window.HTMLInputElement);
    assert.equal(sibling.value, 'Sibling draft');
    assert.equal(submits, 0);
    assert.equal(allocations, 2);
    assert.equal(media.stops(), 2);
});
