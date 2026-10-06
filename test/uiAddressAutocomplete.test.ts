import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    const type = (next: string, isComposing = false) => {
        control.input.value = next;
        control.input.dispatchEvent(
            new window.InputEvent('input', {
                bubbles: true,
                isComposing,
            }) as unknown as Event
        );
    };
    const key = (
        name: string,
        options: Pick<KeyboardEventInit, 'isComposing' | 'keyCode'> = {}
    ) => {
        const event = new window.KeyboardEvent('keydown', {
            key: name,
            bubbles: true,
            cancelable: true,
            ...options,
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
    it('ignores captured old option and Retry clicks while composition owns the input', async (test) => {
        const queries: string[] = [];
        const places: string[] = [];
        const h = fixture(test, {
            listPredictions: async (request) => {
                queries.push(request.addressFieldValue);
                if (queries.length === 1)
                    throw new Error('Synthetic unavailable');
                return [{ description: 'Returned address', placeId: 'tokyo' }];
            },
            getFormattedAddress: async (request) => {
                places.push(request.placeId);
                return 'Unexpected replacement';
            },
        });
        h.type('Failed query');
        test.mock.timers.tick(800);
        await settle();
        const retry = Array.from(
            h.control.element.querySelectorAll('button')
        ).find((button) => button.textContent === 'Try again');
        assert.ok(retry);
        assert.equal(retry.hidden, false);
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent(
                'compositionstart'
            ) as unknown as Event
        );
        h.type('未確定の入力', true);
        retry.click();
        test.mock.timers.tick(800);
        await settle();
        assert.deepEqual(queries, ['Failed query']);
        assert.deepEqual(places, []);
        assert.deepEqual(h.changes, ['Failed query']);
        assert.equal(h.control.input.value, '未確定の入力');
        h.control.input.value = '東京';
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent('compositionend') as unknown as Event
        );
        test.mock.timers.tick(800);
        await settle();
        assert.deepEqual(queries, ['Failed query', '東京']);
        const oldOption =
            h.control.element.querySelector<HTMLButtonElement>(
                '[role="option"]'
            );
        assert.ok(oldOption);
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent(
                'compositionstart'
            ) as unknown as Event
        );
        h.type('続く未確定の入力', true);
        oldOption.click();
        await settle();
        assert.deepEqual(places, []);
        assert.deepEqual(h.changes, ['Failed query', '東京']);
        assert.equal(h.control.getValue(), '東京');
        assert.equal(h.control.input.value, '続く未確定の入力');
    });

    it('defers composition input and its character cap until compositionend, then permits ordinary keyboard selection', async (test) => {
        const queries: string[] = [];
        const places: string[] = [];
        const h = fixture(
            test,
            {
                listPredictions: async (request) => {
                    queries.push(request.addressFieldValue);
                    return [
                        { description: 'Selected address', placeId: 'tokyo' },
                    ];
                },
                getFormattedAddress: async (request) => {
                    places.push(request.placeId);
                    return 'Formatted address';
                },
            },
            5,
            'Loaded value'
        );
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent(
                'compositionstart'
            ) as unknown as Event
        );
        h.type('東京都千代田区', true);
        test.mock.timers.tick(1600);
        await settle();
        assert.deepEqual(queries, []);
        assert.equal(h.control.input.value, '東京都千代田区');
        assert.equal(h.control.getValue(), 'Loaded value');
        assert.deepEqual(h.changes, []);
        for (const name of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'])
            assert.equal(h.key(name).defaultPrevented, false);
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent('compositionend') as unknown as Event
        );
        assert.equal(h.control.getValue(), '東京都千代');
        assert.equal(h.control.input.value, '東京都千代');
        test.mock.timers.tick(799);
        assert.deepEqual(queries, []);
        test.mock.timers.tick(1);
        await settle();
        assert.deepEqual(queries, ['東京都千代']);
        h.choose();
        await settle();
        assert.deepEqual(places, ['tokyo']);
        assert.equal(h.control.getValue(), 'Forma');
        assert.deepEqual(h.changes, ['東京都千代', 'Selec', 'Forma']);
    });

    it('recognizes a composing input without compositionstart and debounces the final input only once', async (test) => {
        const queries: string[] = [];
        const h = fixture(test, {
            listPredictions: async (request) => {
                queries.push(request.addressFieldValue);
                return [];
            },
            getFormattedAddress: async () => 'Unused',
        });
        h.type('とうきょう', true);
        test.mock.timers.tick(800);
        await settle();
        assert.deepEqual(queries, []);
        assert.deepEqual(h.changes, []);
        h.control.input.value = '東京';
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent('compositionend') as unknown as Event
        );
        h.type('東京');
        test.mock.timers.tick(800);
        await settle();
        assert.deepEqual(queries, ['東京']);
        assert.equal(h.control.getValue(), '東京');
    });

    it('leaves composing and keyCode 229 keyboard events to the input even with existing suggestions', async (test) => {
        const places: string[] = [];
        const h = fixture(test, {
            listPredictions: async () => [
                { description: 'Existing suggestion', placeId: 'existing' },
            ],
            getFormattedAddress: async (request) => {
                places.push(request.placeId);
                return 'Formatted existing';
            },
        });
        h.type('Existing query');
        test.mock.timers.tick(800);
        await settle();
        assert.equal(h.key('ArrowDown').defaultPrevented, true);
        const selected = h.control.input.getAttribute('aria-activedescendant');
        assert.ok(selected);
        for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
            for (const name of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
                assert.equal(h.key(name, options).defaultPrevented, false);
                assert.equal(
                    h.control.input.getAttribute('aria-activedescendant'),
                    selected
                );
                assert.equal(h.control.getValue(), 'Existing query');
                assert.deepEqual(places, []);
            }
        }
        assert.equal(h.key('Enter').defaultPrevented, true);
        await settle();
        assert.deepEqual(places, ['existing']);
        assert.equal(h.control.getValue(), 'Formatted existing');
    });

    it('retires old timers and ignored-abort prediction replies when composition starts', async (test) => {
        const pending = deferred<AddressPrediction[]>();
        const queries: string[] = [];
        const h = fixture(test, {
            listPredictions: async (request) => {
                queries.push(request.addressFieldValue);
                return pending.promise;
            },
            getFormattedAddress: async () => 'Unused',
        });
        h.type('Old timer');
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent(
                'compositionstart'
            ) as unknown as Event
        );
        test.mock.timers.tick(800);
        assert.deepEqual(queries, []);
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent('compositionend') as unknown as Event
        );
        test.mock.timers.tick(800);
        assert.deepEqual(queries, ['Old timer']);
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent(
                'compositionstart'
            ) as unknown as Event
        );
        h.type('東京未完', true);
        pending.resolve([
            { description: 'Late old suggestion', placeId: 'old' },
        ]);
        await settle();
        assert.equal(h.control.element.querySelector('[role="option"]'), null);
        assert.equal(h.control.input.value, '東京未完');
        assert.equal(h.control.getValue(), 'Old timer');
    });

    it('retires ignored-abort formatted details before they can replace composing text', async (test) => {
        const pending = deferred<string>();
        const h = fixture(test, {
            listPredictions: async () => [
                { description: 'Selected before composition', placeId: 'old' },
            ],
            getFormattedAddress: async () => pending.promise,
        });
        h.type('Old query');
        test.mock.timers.tick(800);
        await settle();
        h.choose();
        h.control.input.dispatchEvent(
            new h.window.CompositionEvent(
                'compositionstart'
            ) as unknown as Event
        );
        h.type('東京未完', true);
        pending.resolve('Late formatted replacement');
        await settle();
        assert.equal(h.control.input.value, '東京未完');
        assert.equal(h.control.getValue(), 'Selected before composition');
        assert.equal(h.changes.includes('Late formatted replacement'), false);
    });

    it('retires composition across supplied replacement and suspend/reveal, while explicit Clear still works', async (test) => {
        const queries: string[] = [];
        const h = fixture(
            test,
            {
                listPredictions: async (request) => {
                    queries.push(request.addressFieldValue);
                    return [];
                },
                getFormattedAddress: async () => 'Unused',
            },
            null,
            'Loaded value'
        );
        const start = () =>
            h.control.input.dispatchEvent(
                new h.window.CompositionEvent(
                    'compositionstart'
                ) as unknown as Event
            );
        const end = () =>
            h.control.input.dispatchEvent(
                new h.window.CompositionEvent(
                    'compositionend'
                ) as unknown as Event
            );
        start();
        h.type('未完の入力', true);
        h.control.setValue('Replacement value');
        end();
        test.mock.timers.tick(800);
        assert.deepEqual(queries, []);
        assert.deepEqual(h.changes, []);
        assert.equal(h.control.input.value, 'Replacement value');
        start();
        h.type('隠す前の未完', true);
        h.control.setActive(false);
        h.control.setActive(true);
        end();
        test.mock.timers.tick(800);
        assert.deepEqual(queries, []);
        assert.deepEqual(h.changes, []);
        assert.equal(h.control.input.value, 'Replacement value');
        start();
        h.type('消去前の未完', true);
        h.button('Clear address');
        end();
        test.mock.timers.tick(800);
        assert.deepEqual(queries, []);
        assert.deepEqual(h.changes, ['']);
        assert.equal(h.control.getValue(), '');
        assert.equal(h.control.input.value, '');
    });

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
        assert.equal(
            h.control.element.querySelector('[role="listbox"] img'),
            null
        );
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

    it('shows official attribution separately from visibly highlighted keyboard options', async (test) => {
        const places: string[] = [];
        const pending = deferred<string>();
        const h = fixture(test, {
            listPredictions: async () => [
                { description: 'First address', placeId: 'first' },
                { description: 'Second address', placeId: 'second' },
            ],
            getFormattedAddress: async (request) => {
                places.push(request.placeId);
                return pending.promise;
            },
        });
        const popup = h.control.element.querySelector<HTMLElement>(
            '[data-address-suggestions]'
        );
        const list =
            h.control.element.querySelector<HTMLElement>('[role="listbox"]');
        const attribution = h.control.element.querySelector<HTMLElement>(
            '[data-address-attribution]'
        );
        const logo = attribution?.querySelector('img');
        assert.ok(popup && list && attribution && logo);
        assert.equal(popup.hidden, true);
        h.control.input.focus();
        h.type('Two choices');
        test.mock.timers.tick(800);
        await settle();
        assert.equal(popup.hidden, false);
        assert.equal(list.hidden, false);
        assert.equal(list.parentElement, popup);
        assert.equal(attribution.parentElement, popup);
        assert.equal(list.contains(attribution), false);
        assert.equal(list.querySelector('img'), null);
        assert.equal(list.children.length, 2);
        assert.equal(h.control.element.querySelectorAll('img').length, 1);
        assert.equal(logo.alt, 'Google Maps');
        assert.equal(logo.getAttribute('translate'), 'no');
        assert.equal(logo.width, 98);
        assert.equal(logo.height, 18);
        assert.equal(logo.style.width, '98px');
        assert.equal(logo.style.height, '18px');
        assert.equal(attribution.style.paddingTop, '10px');
        assert.equal(attribution.style.paddingRight, '10px');
        assert.equal(attribution.style.paddingBottom, '5px');
        assert.equal(attribution.style.paddingLeft, '10px');
        assert.notEqual(attribution.style.backgroundColor, '');
        assert.equal(popup.style.borderWidth, '1px');
        assert.equal(popup.style.borderStyle, 'solid');
        const source = logo.getAttribute('src');
        assert.ok(source);
        assert.ok(source.startsWith('data:image/png;base64,'));
        const bytes = Buffer.from(source.split(',')[1]!, 'base64');
        assert.equal(bytes.length, 2600);
        assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            'f542cdc1844d0e1a848455dffdc46a5cd618528576a4dba47bc4a096bfa4f60c'
        );
        const options = Array.from(
            list.querySelectorAll<HTMLButtonElement>('[role="option"]')
        );
        const ordinaryBackground = options[0]!.style.backgroundColor;
        const ordinaryColor = options[0]!.style.color;
        const assertSelected = (index: number): void => {
            for (const [optionIndex, option] of options.entries()) {
                const selected = optionIndex === index;
                assert.equal(
                    option.getAttribute('aria-selected'),
                    String(selected)
                );
                if (selected) {
                    assert.notEqual(
                        option.style.backgroundColor,
                        ordinaryBackground
                    );
                    assert.notEqual(option.style.color, ordinaryColor);
                    assert.equal(option.style.outlineWidth, '2px');
                    assert.equal(option.style.outlineStyle, 'solid');
                    assert.notEqual(option.style.outlineColor, 'transparent');
                } else {
                    assert.equal(
                        option.style.backgroundColor,
                        ordinaryBackground
                    );
                    assert.equal(option.style.color, ordinaryColor);
                    assert.equal(option.style.outlineColor, 'transparent');
                }
            }
            assert.equal(
                h.control.input.getAttribute('aria-activedescendant'),
                options[index]!.id
            );
            assert.equal(h.window.document.activeElement, h.control.input);
        };
        assert.equal(h.key('ArrowDown').defaultPrevented, true);
        assertSelected(0);
        h.key('ArrowDown');
        assertSelected(1);
        h.key('ArrowDown');
        assertSelected(0);
        h.key('ArrowUp');
        assertSelected(1);
        assert.equal(h.key('Enter').defaultPrevented, true);
        assert.deepEqual(places, ['second']);
        assert.equal(h.control.getValue(), 'Second address');
        assert.equal(popup.hidden, true);
        assert.equal(list.children.length, 0);
        assert.equal(
            h.control.input.hasAttribute('aria-activedescendant'),
            false
        );
        assert.equal(h.window.document.activeElement, h.control.input);
    });

    it('retires the attributed popup across dismiss, clear, empty, failure, suspend and destroy', async (test) => {
        let outcome: 'success' | 'empty' | 'error' = 'success';
        const h = fixture(test, {
            listPredictions: async () => {
                if (outcome === 'error')
                    throw new Error('Private provider diagnostic');
                return outcome === 'empty'
                    ? []
                    : [{ description: 'Visible address', placeId: 'one' }];
            },
            getFormattedAddress: async () => 'Unused',
        });
        const popup = h.control.element.querySelector<HTMLElement>(
            '[data-address-suggestions]'
        );
        const list =
            h.control.element.querySelector<HTMLElement>('[role="listbox"]');
        assert.ok(popup && list);
        const read = async (value: string): Promise<void> => {
            h.type(value);
            test.mock.timers.tick(800);
            await settle();
        };
        const assertClosed = (): void => {
            assert.equal(popup.hidden, true);
            assert.equal(list.hidden, true);
            assert.equal(list.children.length, 0);
            assert.equal(
                h.control.input.getAttribute('aria-expanded'),
                'false'
            );
            assert.equal(
                h.control.input.hasAttribute('aria-activedescendant'),
                false
            );
        };
        await read('Dismiss');
        h.key('ArrowDown');
        h.key('Escape');
        assertClosed();
        await read('Clear');
        h.button('Clear address');
        assertClosed();
        await read('Suspend');
        h.control.setActive(false);
        h.control.setActive(true);
        assertClosed();
        assert.equal(h.control.getValue(), 'Suspend');
        await read('Replace supplied value');
        h.control.setValue('Restored native value');
        assertClosed();
        outcome = 'empty';
        await read('No results');
        assertClosed();
        outcome = 'error';
        await read('Failure');
        assertClosed();
        assert.ok(h.control.element.querySelector('[role="alert"]'));
        outcome = 'success';
        h.button('Try again');
        await settle();
        assert.equal(popup.hidden, false);
        h.control.destroy();
        assertClosed();
        assert.equal(h.control.getValue(), 'Failure');
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
