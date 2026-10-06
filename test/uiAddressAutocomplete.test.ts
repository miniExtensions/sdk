import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    AddressAutocompleteConfigurationError,
    createAddressAutocompleteControl,
} from '../src/ui/index.js';
import type {
    AddressPrediction,
    MiniExtensionsClient,
} from '../src/runtime/index.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const settle = async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};
const fixture = (
    test: TestContext,
    reads: MiniExtensionsClient['addresses'],
    characterLimit?: number | null,
    value?: string
) => {
    const window = new Window({ url: 'https://address.example.test' });
    const document = window.document as unknown as Document;
    test.mock.timers.enable({ apis: ['setTimeout'] });
    let current = true;
    const changes: string[] = [];
    const control = createAddressAutocompleteControl({
        document,
        label: 'Address',
        input: {
            extensionAccessToken: 'access_example',
            fieldId: 'fld_address',
        },
        reads,
        characterLimit,
        value,
        isCurrent: () => current,
        onChange: (next) => changes.push(next),
    });
    document.body.append(control.element);
    test.after(async () => {
        control.destroy();
        test.mock.timers.reset();
        await window.happyDOM.close();
    });
    const type = (next: string) => {
        control.input.value = next;
        control.input.dispatchEvent(
            new window.Event('input', { bubbles: true }) as unknown as Event
        );
    };
    const key = (name: string) => {
        const event = new window.KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
        });
        control.input.dispatchEvent(event as unknown as KeyboardEvent);
        return event;
    };
    const choose = () => {
        assert.equal(key('ArrowDown').defaultPrevented, true);
        assert.equal(key('Enter').defaultPrevented, true);
    };
    const button = (name: string) => {
        const node = Array.from(
            control.element.querySelectorAll('button')
        ).find((entry) => entry.textContent === name);
        assert.ok(node);
        assert.equal(node.type, 'button');
        node.click();
    };
    return {
        window,
        document,
        control,
        changes,
        type,
        key,
        choose,
        button,
        retireOwner: () => {
            current = false;
        },
    };
};

describe('address autocomplete native control', { concurrency: false }, () => {
    it('debounces final input, renders labels as text and accepts keyboard selection before details', async (test) => {
        const queries: string[] = [];
        const places: string[] = [];
        const pending = deferred<string>();
        const h = fixture(test, {
            listPredictions: async (input) => {
                assert.equal(input.extensionAccessToken, 'access_example');
                assert.equal(input.fieldId, 'fld_address');
                queries.push(input.addressFieldValue);
                return [
                    {
                        description: '<img src=x> usable address',
                        placeId: 'place_one',
                    },
                ];
            },
            getFormattedAddress: async (input) => {
                places.push(input.placeId);
                return pending.promise;
            },
        });
        h.type('1');
        h.type('12');
        h.type('12 Main');
        test.mock.timers.tick(799);
        assert.equal(queries.length, 0);
        test.mock.timers.tick(1);
        await settle();
        assert.deepEqual(queries, ['12 Main']);
        assert.equal(h.control.element.querySelector('img'), null);
        assert.equal(
            h.control.element.querySelector('[role="option"]')?.textContent,
            '<img src=x> usable address'
        );
        h.choose();
        assert.equal(h.control.getValue(), '<img src=x> usable address');
        assert.deepEqual(places, ['place_one']);
        pending.resolve('Formatted address');
        await settle();
        assert.equal(h.control.getValue(), 'Formatted address');
        assert.deepEqual(h.changes, [
            '1',
            '12',
            '12 Main',
            '<img src=x> usable address',
            'Formatted address',
        ]);
    });

    it('ignores stale prediction success and failure when adapters ignore abort', async (test) => {
        const old = deferred<AddressPrediction[]>();
        const fresh = deferred<AddressPrediction[]>();
        const staleFailure = deferred<AddressPrediction[]>();
        const replies = [old, fresh, staleFailure];
        const signals: AbortSignal[] = [];
        const h = fixture(test, {
            listPredictions: async (_input, options) => {
                assert.ok(options?.signal);
                signals.push(options.signal);
                return replies.shift()!.promise;
            },
            getFormattedAddress: async () => 'Unused',
        });
        h.type('Old');
        test.mock.timers.tick(800);
        h.type('Fresh');
        test.mock.timers.tick(800);
        assert.equal(signals[0]?.aborted, true);
        fresh.resolve([{ description: 'Fresh only', placeId: 'fresh' }]);
        await settle();
        old.resolve([{ description: 'Old stale', placeId: 'old' }]);
        await settle();
        assert.equal(
            h.control.element.querySelector('[role="option"]')?.textContent,
            'Fresh only'
        );
        h.type('Failure');
        test.mock.timers.tick(800);
        h.type('Final');
        staleFailure.reject(new Error('Private provider diagnostic'));
        await settle();
        assert.equal(h.control.element.querySelector('[role="alert"]'), null);
        assert.equal(h.control.getValue(), 'Final');
    });

    it('retains a selected description on detail failure and retries only its current place', async (test) => {
        const calls: string[] = [];
        let detail = 0;
        const h = fixture(test, {
            listPredictions: async () => [
                { description: 'Selected address', placeId: 'selected' },
            ],
            getFormattedAddress: async (input) => {
                calls.push(input.placeId);
                if (++detail === 1) throw new Error('Provider failed');
                return 'Formatted after retry';
            },
        });
        h.type('Selected');
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        await settle();
        assert.equal(h.control.getValue(), 'Selected address');
        assert.ok(h.control.element.querySelector('[role="alert"]'));
        h.button('Try again');
        await settle();
        assert.deepEqual(calls, ['selected', 'selected']);
        assert.equal(h.control.getValue(), 'Formatted after retry');
        h.type('Manual');
        h.key('Escape');
        assert.equal(h.control.getValue(), 'Manual');
        h.button('Clear address');
        assert.equal(h.control.getValue(), '');
        assert.equal(h.window.document.activeElement, h.control.input);
    });

    it('preserves newer typing and a newer place over an older pending detail', async (test) => {
        const first = deferred<string>();
        const second = deferred<string>();
        let place = 'one';
        const h = fixture(test, {
            listPredictions: async () => [
                { description: `Description ${place}`, placeId: place },
            ],
            getFormattedAddress: async (input) =>
                input.placeId === 'one' ? first.promise : second.promise,
        });
        h.type('One');
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        h.type('New manual intent');
        assert.equal(h.control.getValue(), 'New manual intent');
        place = 'two';
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        second.resolve('Current formatted two');
        await settle();
        first.resolve('Stale formatted one');
        await settle();
        assert.equal(h.control.getValue(), 'Current formatted two');
        assert.equal(h.changes.includes('Stale formatted one'), false);
    });

    it('retires timers and reads across suspend/reveal and disposal without clearing values', async (test) => {
        const pending = deferred<AddressPrediction[]>();
        let reads = 0;
        const h = fixture(test, {
            listPredictions: async () => {
                reads += 1;
                return pending.promise;
            },
            getFormattedAddress: async () => 'Unused',
        });
        h.type('Timer retained');
        h.control.setActive(false);
        h.control.setActive(true);
        test.mock.timers.tick(800);
        await settle();
        assert.equal(reads, 0);
        assert.equal(h.control.getValue(), 'Timer retained');
        h.type('Pending retained');
        test.mock.timers.tick(800);
        h.control.setActive(false);
        h.control.setActive(true);
        pending.resolve([
            { description: 'Stale after reveal', placeId: 'stale' },
        ]);
        await settle();
        assert.equal(h.control.element.querySelector('[role="option"]'), null);
        assert.equal(h.control.getValue(), 'Pending retained');
        assert.equal(reads, 1);
        h.type('Disposed retained');
        h.control.destroy();
        h.control.destroy();
        test.mock.timers.tick(800);
        h.type('Disallowed');
        assert.equal(h.control.getValue(), 'Disposed retained');
        assert.equal(reads, 1);
    });

    it('rejects stale owner edits and details even when cancellation is ignored', async (test) => {
        const pending = deferred<string>();
        const h = fixture(test, {
            listPredictions: async () => [
                { description: 'Accepted before retirement', placeId: 'one' },
            ],
            getFormattedAddress: async () => pending.promise,
        });
        h.type('Query');
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        h.retireOwner();
        pending.resolve('Foreign result');
        await settle();
        h.type('Foreign edit');
        h.button('Clear address');
        assert.equal(h.control.getValue(), 'Accepted before retirement');
        assert.deepEqual(h.changes, ['Query', 'Accepted before retirement']);
    });

    it('caps every accepted writer while preserving supplied data and zero/null semantics', async (test) => {
        const h = fixture(
            test,
            {
                listPredictions: async () => [
                    { description: 'Description too long', placeId: 'one' },
                ],
                getFormattedAddress: async () => 'Formatted too long',
            },
            5,
            'Loaded unchanged value'
        );
        assert.equal(h.control.getValue(), 'Loaded unchanged value');
        h.type('Manual too long');
        assert.equal(h.control.getValue(), 'Manua');
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        assert.equal(h.control.getValue(), 'Descr');
        await settle();
        assert.equal(h.control.getValue(), 'Forma');
        assert.deepEqual(h.changes, ['Manua', 'Descr', 'Forma']);
        const make = (characterLimit: number | null) =>
            createAddressAutocompleteControl({
                document: h.document,
                input: { extensionAccessToken: 'a', fieldId: 'f' },
                reads: {
                    listPredictions: async () => [],
                    getFormattedAddress: async () => '',
                },
                isCurrent: () => true,
                onChange: () => {},
                label: 'Boundary',
                characterLimit,
                value: 'Loaded baseline',
            });
        const zero = make(0);
        assert.equal(zero.getValue(), 'Loaded baseline');
        zero.input.value = 'Edited';
        zero.input.dispatchEvent(
            new h.window.Event('input') as unknown as Event
        );
        assert.equal(zero.getValue(), '');
        zero.destroy();
        const uncapped = make(null);
        uncapped.input.value = 'x'.repeat(201);
        uncapped.input.dispatchEvent(
            new h.window.Event('input') as unknown as Event
        );
        assert.equal(uncapped.getValue().length, 201);
        uncapped.destroy();
        for (const invalid of [-1, 1.5, Infinity, NaN])
            assert.throws(
                () => make(invalid),
                AddressAutocompleteConfigurationError
            );
    });

    it('keeps request bounds separate from native values and retries failed reads explicitly', async (test) => {
        const queries: string[] = [];
        const h = fixture(test, {
            listPredictions: async (input) => {
                queries.push(input.addressFieldValue);
                if (input.addressFieldValue.trim().length > 200)
                    throw new Error('Backend query validation');
                return [
                    {
                        description: 'Usable description',
                        placeId: 'p'.repeat(257),
                    },
                ];
            },
            getFormattedAddress: async (input) => {
                if (input.placeId.trim().length > 256)
                    throw new Error('Backend place validation');
                return 'unused';
            },
        });
        h.type('x'.repeat(201));
        test.mock.timers.tick(800);
        await settle();
        assert.equal(h.control.getValue().length, 201);
        assert.equal(queries.length, 1);
        h.button('Try again');
        await settle();
        assert.equal(queries.length, 2);
        h.type('x'.repeat(200));
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        await settle();
        assert.equal(h.control.getValue(), 'Usable description');
        assert.ok(h.control.element.querySelector('[role="alert"]'));
    });
});
