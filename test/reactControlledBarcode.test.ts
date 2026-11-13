import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h } from 'react';
import { BrowserMultiFormatReader, type Result } from '@zxing/library';
import type { ControlledBarcodeFieldProps } from '../src/react/index.js';
import { scannerDom, deferred, cameraStream } from './fixtures/scannerDom.js';
void Window;

async function fixture(t: TestContext) {
    const f = await scannerDom(t);
    const api = await import('../src/react/index.js');
    const writes: ControlledBarcodeFieldProps['value'][] = [];
    let media = 0;
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
        media++;
        throw Error('Unexpected automatic camera allocation');
    });
    const props: ControlledBarcodeFieldProps = {
        mode: 'controlled',
        value: { text: '00042', type: 'qr' },
        onChange: (value) => writes.push(value),
        language: 'en',
        title: 'Barcode',
        id: 'barcode-answer',
        form: 'host-form',
        initialMobile: true,
        clearLabel: 'Clear barcode',
    };
    const render = (overrides: Partial<ControlledBarcodeFieldProps> = {}) =>
        f.render(h(api.BarcodeField, { ...props, ...overrides }), true);
    const input = () => {
        const node = f.host.querySelector('input');
        assert.ok(node);
        return node;
    };
    const edit = async (text: string) => {
        await act(async () => {
            input().focus();
            Object.getOwnPropertyDescriptor(
                f.window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(input(), text);
            input().dispatchEvent(
                new f.window.Event('input', { bubbles: true })
            );
        });
    };
    return {
        ...f,
        api,
        writes,
        props,
        render,
        input,
        edit,
        media: () => media,
    };
}

it('edits and clears only text, preserving exact metadata and field associations without camera/Save', async (t) => {
    const f = await fixture(t);
    const metadata = { source: 'synthetic', sequence: 4 };
    const value = { text: '00042', type: 'qr', metadata };
    await f.render({
        value,
        describedBy: 'answer-help answer-error',
        invalid: true,
        placeholder: 'Scan or type',
    });
    assert.equal(f.input().id, 'barcode-answer');
    assert.equal(f.input().getAttribute('form'), 'host-form');
    assert.equal(f.input().getAttribute('autocomplete'), 'off');
    assert.equal(
        f.input().getAttribute('aria-describedby'),
        'answer-help answer-error'
    );
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(f.host.querySelector('label')?.htmlFor, f.input().id);
    assert.ok(f.host.querySelector('[data-testid="qr-scanner-button"]'));
    await f.edit('  001\n雪 <b>');
    // Native single-line input removes line breaks; no trimming or decoding occurs.
    assert.deepEqual(f.writes, [{ ...value, text: '  001雪 <b>' }]);
    assert.equal(
        f.writes[0] && 'metadata' in f.writes[0] && f.writes[0].metadata,
        metadata
    );
    await f.render({ value: { ...value, text: 'next' } });
    await f.click('Clear barcode');
    assert.deepEqual(f.writes[1], { ...value, text: '' });
    assert.equal(f.media(), 0);
});

it('renders null and type-only values blank, and uses native readonly empty/literal presentation', async (t) => {
    const f = await fixture(t);
    for (const value of [null, {}, { type: 'qr' }]) {
        await f.render({ value });
        assert.equal(f.input().value, '');
    }
    await f.render({ value: null, displayOnly: true, autoStartCamera: true });
    assert.match(f.host.textContent ?? '', /No Value/);
    assert.equal(f.host.querySelector('input,button,video'), null);
    await f.render({
        value: { text: '<script>literal</script>', type: 'qr' },
        displayOnly: true,
    });
    assert.match(f.host.textContent ?? '', /<script>literal<\/script>/);
    assert.equal(f.host.querySelector('script'), null);
    assert.equal(f.media(), 0);
    assert.deepEqual(f.writes, []);
});

it('defers typing until blur or Enter and settles one dirty genuine unmount to its current owner', async (t) => {
    const f = await fixture(t);
    const token = {};
    let current = true;
    const owner = { token, isCurrent: () => current };
    await f.render({ enableInlineEdit: true, owner });
    await f.edit('draft');
    assert.deepEqual(f.writes, []);
    await act(async () => f.input().blur());
    assert.deepEqual(f.writes, [{ text: 'draft', type: 'qr' }]);
    await f.render({
        enableInlineEdit: true,
        owner,
        value: { text: 'draft', type: 'qr' },
    });
    await f.edit('last draft');
    await f.unmount();
    assert.deepEqual(f.writes, [
        { text: 'draft', type: 'qr' },
        { text: 'last draft', type: 'qr' },
    ]);
    current = false;
});

for (const replacement of [
    'owner',
    'readOnly',
    'configuration',
    'form',
    'mode',
] as const) {
    it(`retires dirty deferred ${replacement} work across A/B/A and admits successor edits`, async (t) => {
        const f = await fixture(t);
        const a = {},
            b = {};
        let current = a;
        const initial: Partial<ControlledBarcodeFieldProps> = {
            enableInlineEdit: true,
            owner: { token: a, isCurrent: () => current === a },
        };
        await f.render(initial);
        await f.edit('retired draft');
        const changes: Partial<ControlledBarcodeFieldProps> =
            replacement === 'owner'
                ? { owner: { token: b, isCurrent: () => current === b } }
                : replacement === 'readOnly'
                  ? { readOnly: true }
                  : replacement === 'configuration'
                    ? { placeholder: 'new policy' }
                    : replacement === 'form'
                      ? { form: 'successor-form' }
                      : { enableInlineEdit: false };
        if (replacement === 'owner') current = b;
        await f.render({
            ...initial,
            ...changes,
            value: { text: 'successor', type: 'code128' },
        });
        current = a;
        await f.render({ ...initial, value: { text: 'returned', type: 'qr' } });
        assert.equal(f.input().value, 'returned');
        assert.deepEqual(f.writes, []);
        await f.edit('accepted successor');
        await act(async () => f.input().blur());
        assert.deepEqual(f.writes, [
            { text: 'accepted successor', type: 'qr' },
        ]);
    });
}

it('refreshes metadata/callback on ordinary echo without discarding a focused draft', async (t) => {
    const f = await fixture(t);
    const token = {};
    const owner = { token, isCurrent: () => true };
    await f.render({ owner, enableInlineEdit: true });
    await f.edit('kept draft');
    const successor: unknown[] = [];
    await f.render({
        owner,
        enableInlineEdit: true,
        value: { text: 'external', type: 'code128' },
        onChange: (v) => successor.push(v),
        title: 'Changed title',
    });
    assert.equal(f.input().value, 'kept draft');
    await act(async () => f.input().blur());
    assert.deepEqual(successor, [{ text: 'kept draft', type: 'code128' }]);
    assert.deepEqual(f.writes, []);
});

it('rejects current-authority refusal including dirty unmount, then admits a fresh owner', async (t) => {
    const f = await fixture(t);
    let current = true;
    const owner = { token: {}, isCurrent: () => current };
    await f.render({ owner, enableInlineEdit: true });
    await f.edit('dirty');
    current = false;
    await f.unmount();
    assert.deepEqual(f.writes, []);
});

it('retires a late scanner decode after owner ABA and admits a successor scan preserving new metadata', async (t) => {
    const f = await fixture(t);
    const a = {},
        b = {};
    let current = a;
    const decode = deferred<Result>();
    const stream = cameraStream();
    let decodes = 0,
        allocations = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => [{ kind: 'videoinput' } as MediaDeviceInfo]
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
        allocations++;
        return stream.stream;
    });
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'decodeOnceFromStream',
        async () => {
            decodes++;
            return decodes === 1
                ? decode.promise
                : ({ getText: () => 'successor scan' } as Result);
        }
    );
    const initial = { owner: { token: a, isCurrent: () => current === a } };
    await f.render(initial);
    assert.equal(allocations, 0);
    await f.click('Scan barcode or QR code');
    assert.equal(decodes, 1);
    current = b;
    await f.render({ owner: { token: b, isCurrent: () => current === b } });
    current = a;
    await f.render({ ...initial, value: { text: 'current', type: 'code128' } });
    await act(async () =>
        decode.resolve({ getText: () => 'retired scan' } as Result)
    );
    assert.deepEqual(f.writes, []);
    await f.click('Scan barcode or QR code');
    assert.deepEqual(f.writes, [{ text: 'successor scan', type: 'code128' }]);
    assert.equal(allocations, 2);
    assert.equal(stream.stops(), 2);
});
