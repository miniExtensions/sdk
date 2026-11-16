import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import {
    act,
    createElement as h,
    createRef,
    useState,
    type Dispatch,
    type SetStateAction,
    type Ref,
} from 'react';
import { BrowserMultiFormatReader, type Result } from '@zxing/library';
import {
    SingleLineTextField,
    type ControlledSingleLineTextFieldProps,
} from '../src/react/index.js';
import { scannerDom, cameraStream, deferred } from './fixtures/scannerDom.js';

async function field(
    t: TestContext,
    patch: Partial<ControlledSingleLineTextFieldProps> = {},
    inputRef?: Ref<HTMLInputElement>
) {
    const f = await scannerDom(t);
    const writes: string[] = [];
    let submits = 0,
        network = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        network++;
        throw Error('Unexpected network');
    });
    t.mock.method(f.window, 'fetch', async () => {
        network++;
        throw Error('Unexpected network');
    });
    let update!: Dispatch<SetStateAction<ControlledSingleLineTextFieldProps>>;
    function Parent() {
        const [props, setProps] = useState<ControlledSingleLineTextFieldProps>(
            () =>
                ({
                    mode: 'controlled',
                    value: 'seed',
                    language: 'en',
                    title: 'Main text',
                    initialMobile: true,
                    owner: { token: {}, isCurrent: () => true },
                    onChange(value) {
                        writes.push(value);
                        update((previous) => ({ ...previous, value }));
                    },
                    ...patch,
                }) as ControlledSingleLineTextFieldProps
        );
        update = setProps;
        return h(
            'form',
            {
                onSubmit: (event) => {
                    event.preventDefault();
                    submits++;
                },
            },
            h(SingleLineTextField, { ...props, ref: inputRef }),
            h('input', {
                'aria-label': 'Sibling draft',
                defaultValue: 'keep sibling',
            })
        );
    }
    await f.render(h(Parent), true);
    const input = () => {
        const node = f.host.querySelector('input');
        assert.ok(node);
        return node;
    };
    const siblingUnchanged = () => {
        const sibling = f.host.querySelector('[aria-label="Sibling draft"]');
        assert.ok(sibling instanceof f.window.HTMLInputElement);
        assert.equal(sibling.value, 'keep sibling');
    };
    const change = async (value: string, start?: number, end = start) =>
        act(async () => {
            const node = input();
            node.focus();
            Object.getOwnPropertyDescriptor(
                f.window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(node, value);
            if (start != null) node.setSelectionRange(start, end ?? start);
            node.dispatchEvent(new f.window.Event('input', { bubbles: true }));
            siblingUnchanged();
        });
    t.after(() => {
        assert.equal(submits, 0);
        assert.equal(network, 0);
    });
    return {
        ...f,
        writes,
        input,
        change,
        async click(text: string) {
            await f.click(text);
            siblingUnchanged();
        },
        async update(next: Partial<ControlledSingleLineTextFieldProps>) {
            await act(async () =>
                update(
                    (previous) =>
                        ({
                            ...previous,
                            ...next,
                        }) as ControlledSingleLineTextFieldProps
                )
            );
            siblingUnchanged();
        },
    };
}

for (const enableInlineEdit of [false, true])
    it(`matches the actual native synchronous-parent caret trace, deferred=${enableInlineEdit}`, async (t) => {
        const f = await field(t, { enableInlineEdit, characterLimit: 4 });
        await f.change('abcdef', 1, 3);
        if (enableInlineEdit) {
            assert.deepEqual(f.writes, []);
            f.input().setSelectionRange(2, 4);
            await act(async () => f.input().blur());
            assert.equal(f.input().selectionStart, 4);
            assert.equal(f.input().selectionEnd, 4);
        } else {
            assert.equal(f.input().selectionStart, 1);
            assert.equal(f.input().selectionEnd, 3);
        }
        assert.deepEqual(f.writes, ['abcd']);
        assert.equal(f.input().value, 'abcd');
    });

for (const enableInlineEdit of [false, true])
    it(`bounds an actual scanner-produced value with native UTF-16 slice, deferred=${enableInlineEdit}`, async (t) => {
        const f = await field(t, {
            enableInlineEdit,
            characterLimit: 2,
            scanner: { enableQRCodeScannerForFormField: true },
        });
        const media = cameraStream();
        let allocations = 0;
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
            async () => ({ getText: () => 'a😀suffix' }) as Result
        );
        assert.equal(allocations, 0);
        await f.click('Scan barcode or QR code');
        assert.deepEqual(f.writes, ['a\ud83d']);
        assert.equal(f.input().value, 'a\ud83d');
        assert.equal(allocations, 1);
        assert.equal(media.stops(), 1);
    });

it('denies a retained scanner trigger before provider allocation when current authority has retired', async (t) => {
    let current = true;
    const f = await field(t, {
        owner: { token: {}, isCurrent: () => current },
        scanner: { enableQRCodeScannerForFormField: true },
    });
    let lists = 0,
        allocations = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => {
            lists++;
            return [];
        }
    );
    t.mock.method(f.mediaDevices, 'getUserMedia', async () => {
        allocations++;
        throw Error('Retired owner');
    });
    current = false;
    await f.click('Scan barcode or QR code');
    assert.equal(lists, 0);
    assert.equal(allocations, 0);
    assert.deepEqual(f.writes, []);
    assert.equal(f.host.querySelector('[role=dialog], video'), null);
});

for (const retirement of ['owner', 'disabled', 'password'] as const)
    it(`retires a late scanner decode across ${retirement} replacement and admits the new owner`, async (t) => {
        const a = { token: {}, isCurrent: () => true },
            b = { token: {}, isCurrent: () => true };
        const f = await field(t, {
            owner: a,
            characterLimit: 4,
            scanner: {
                enableQRCodeScannerForFormField: true,
                autoStartCamera: false,
            },
        });
        const media = cameraStream(),
            pending = deferred<Result>();
        let allocations = 0,
            decodes = 0;
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
                    : ({ getText: () => 'fresh scan' } as Result)
        );
        await f.click('Scan barcode or QR code');
        assert.equal(decodes, 1);
        await f.update(
            retirement === 'owner'
                ? { owner: b }
                : retirement === 'disabled'
                  ? { disabled: true }
                  : { obscurePassword: true }
        );
        await f.update({ owner: a, disabled: false, obscurePassword: false });
        await act(async () =>
            pending.resolve({ getText: () => 'old scan' } as Result)
        );
        assert.deepEqual(f.writes, []);
        assert.equal(allocations, 1);
        await f.click('Scan barcode or QR code');
        assert.deepEqual(f.writes, ['fres']);
        assert.equal(allocations, 2);
        assert.equal(media.stops(), 2);
    });

it('auto-starts only the initial admitted mount and never replays on disable/re-enable', async (t) => {
    let lists = 0;
    t.mock.method(
        BrowserMultiFormatReader.prototype,
        'listVideoInputDevices',
        async () => {
            lists++;
            return [];
        }
    );
    const f = await field(t, {
        scanner: {
            enableQRCodeScannerForFormField: true,
            autoStartCamera: true,
        },
    });
    await f.tick();
    const first = lists;
    // Native StrictMode replays the initial scanner effects: two no-device
    // probes, with no camera acquisition. Re-enable must add no new probe.
    assert.equal(first, 2);
    await f.update({ disabled: true });
    await f.update({ disabled: false });
    await f.tick();
    assert.equal(lists, first);
    assert.deepEqual(f.writes, []);
});

it('uses the complete Address control, bounds selection/details, forwards its own ref and retires late details', async (t) => {
    const details = deferred<string>(),
        ref = createRef<HTMLInputElement>();
    const queries: string[] = [],
        detailIds: string[] = [];
    let signal: AbortSignal | undefined;
    const address = {
        mode: 'autocomplete' as const,
        identity: { session: 's', field: 'f', readScope: 'A' },
        labels: {
            clear: 'Clear',
            loadingPredictions: 'Loading suggestions',
            loadingDetails: 'Loading selected address',
            failed: 'Unable to load',
            retry: 'Try again',
        },
        reads: {
            async listPredictions(query: string) {
                queries.push(query);
                return [{ placeId: 'p', description: 'A😀abcdef' }];
            },
            getFormattedAddress(id: string, options: { signal: AbortSignal }) {
                detailIds.push(id);
                signal = options.signal;
                return details.promise;
            },
        },
    };
    const f = await field(t, { value: '', characterLimit: 5, address }, ref);
    // Ref is a public component ref, not the ordinary input's caret-capture ref.
    assert.equal(ref.current, f.host.querySelector('input'));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await f.change('  raw query  ');
    assert.deepEqual(f.writes, ['  raw']);
    await act(async () => t.mock.timers.tick(800));
    assert.deepEqual(queries, ['  raw query  ']);
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.deepEqual(f.writes, ['  raw', 'A😀ab']);
    assert.deepEqual(detailIds, ['p']);
    await f.update({
        owner: { token: {}, isCurrent: () => true },
        value: 'replacement',
    });
    assert.equal(signal?.aborted, true);
    await act(async () => details.resolve('late detail'));
    assert.equal(f.input().value, 'replacement');
    assert.deepEqual(f.writes, ['  raw', 'A😀ab']);
    t.mock.timers.reset();
});

it('bounds a current Address detail echo without retiring its own selection', async (t) => {
    const f = await field(t, {
        value: '',
        characterLimit: 2,
        address: {
            mode: 'autocomplete',
            identity: { session: 's', field: 'f', readScope: 'a' },
            labels: {
                clear: 'Clear',
                loadingPredictions: 'Loading',
                loadingDetails: 'Loading details',
                failed: 'Failed',
                retry: 'Retry',
            },
            reads: {
                async listPredictions() {
                    return [{ placeId: 'p', description: 'long prediction' }];
                },
                async getFormattedAddress() {
                    return 'z😀detail';
                },
            },
        },
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await f.change('q');
    await act(async () => t.mock.timers.tick(800));
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.deepEqual(f.writes, ['q', 'lo', 'z\ud83d']);
    assert.equal(f.input().value, 'z\ud83d');
    t.mock.timers.reset();
});
