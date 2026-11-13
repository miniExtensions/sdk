import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    NativeLinkedFinderCascade,
    NativeLinkedFinderCascadeDriverView,
    type NativeLinkedFinderCascadeProps,
} from '../src/react/index.js';
import type {
    NativeLinkedFinderCascadeHost,
    NativeLinkedFinderCascadeQuery,
    NativeLinkedFinderCascadePage,
    NativeLinkedFinderCascadeValue,
} from '../src/ui/index.js';
import { scannerDom, deferred } from './fixtures/scannerDom.js';

const pair = (recordId: string, stringValue = recordId) => ({
    recordId,
    stringValue,
});
const page = (
    primaryValues: readonly NativeLinkedFinderCascadeValue[] = [],
    prefillValue: NativeLinkedFinderCascadeValue | null = null
): NativeLinkedFinderCascadePage => ({ primaryValues, prefillValue });
async function fixture(
    t: TestContext,
    patch: Partial<NativeLinkedFinderCascadeProps<object>> = {},
    strict = false,
    singlePredecessor?: string | null
) {
    const f = await scannerDom(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
    const owner = {};
    let current = owner;
    const requests: {
        query: NativeLinkedFinderCascadeQuery;
        result: ReturnType<typeof deferred<NativeLinkedFinderCascadePage>>;
    }[] = [];
    const writes: unknown[] = [];
    const flags: boolean[] = [];
    const failures: unknown[] = [];
    const values: Record<string, NativeLinkedFinderCascadeValue | null> = {};
    const host: NativeLinkedFinderCascadeHost<object> = {
        isCurrent: (expected) => expected === current,
        captureRead(expected, query) {
            return {
                isCurrent: () => expected === current,
                query: () => {
                    const result = deferred<NativeLinkedFinderCascadePage>();
                    requests.push({ query, result });
                    return result.promise;
                },
            };
        },
        publish(expected, field, value) {
            if (expected !== current) return { status: 'refused' };
            values[field] = value;
            writes.push({ field, value });
            return { status: 'admitted' };
        },
        clear(expected, field) {
            if (expected !== current) return { status: 'refused' };
            values[field] = null;
            writes.push({ clear: field });
            return { status: 'admitted' };
        },
        setPrefillLoading: (_owner, _field, value) => flags.push(value),
        reportOrdinaryError() {},
        errorMessage: () => 'Ordinary unavailable',
    };
    let props: NativeLinkedFinderCascadeProps<object> = {
        owner,
        host,
        drivers: [
            {
                fieldId: 'driver',
                fieldName: 'Driver',
                title: null,
                urlSearchValue: undefined,
                hidden: false,
            },
        ],
        values,
        formReadOnly: false,
        labels: { loading: 'Chargement', noMatches: 'Aucun résultat' },
        testing: true,
        onPrefillFailure: (error) => failures.push(error),
        ...patch,
    };
    const render = async (next: Partial<typeof props> = {}) => {
        props = { ...props, ...next };
        const { drivers, ...shared } = props;
        await f.render(
            singlePredecessor === undefined
                ? h(NativeLinkedFinderCascade, props)
                : h(NativeLinkedFinderCascadeDriverView, {
                      ...shared,
                      driver: drivers[0],
                      previousFieldId: singlePredecessor,
                  }),
            strict
        );
    };
    await render();
    const settle = async () => {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    };
    return {
        ...f,
        owner,
        ports: host,
        values,
        requests,
        writes,
        flags,
        failures,
        render,
        settle,
        replace: () => {
            current = {};
            return current;
        },
    };
}

test('cascade SSR renders escaped localized selector chrome without allocating reads', () => {
    let reads = 0;
    const host: NativeLinkedFinderCascadeHost<object> = {
        isCurrent: () => true,
        captureRead: () => {
            reads++;
            return null;
        },
        publish: () => ({ status: 'refused' }),
        clear: () => ({ status: 'refused' }),
        setPrefillLoading() {},
        reportOrdinaryError() {},
        errorMessage: () => '',
    };
    const html = renderToString(
        h(NativeLinkedFinderCascade, {
            owner: {},
            host,
            values: {},
            formReadOnly: false,
            drivers: [
                {
                    fieldId: 'driver',
                    fieldName: '<Driver>',
                    title: null,
                    urlSearchValue: undefined,
                    hidden: false,
                },
            ],
            labels: { loading: 'Chargement', noMatches: 'Aucun résultat' },
        })
    );
    assert.match(html, /&lt;Driver&gt;/);
    assert.match(html, /role="combobox"/);
    assert.equal(reads, 0);
});

test('one native partial survivor retains its external predecessor, test identity and string-only scheduling', async (t) => {
    const f = await fixture(
        t,
        {
            values: { country: pair('country-A', 'Same') },
            drivers: [
                {
                    fieldId: 'region',
                    fieldName: 'Region',
                    title: null,
                    urlSearchValue: undefined,
                    hidden: false,
                    testId: 'native-region',
                },
            ],
        },
        false,
        'country'
    );
    await f.settle();
    assert.equal(
        f.host
            .querySelector('[data-testid="native-region"]')
            ?.getAttribute('data-field-id'),
        'region'
    );
    assert.deepEqual(f.requests[0].query.filterData, {
        previousFilterFieldId: 'country',
        previousFilterPrimaryValue: 'Same',
    });
    await f.render({ values: { country: pair('country-B', 'Same') } });
    await f.settle();
    assert.equal(f.requests.length, 1);
    await f.render({ values: { country: pair('country-B', 'Different') } });
    await f.settle();
    assert.equal(f.requests.length, 2);
    assert.equal(
        f.requests[1].query.filterData?.previousFilterPrimaryValue,
        'Different'
    );
});

test('hidden partial survivors still run independent raw-array prefill and predecessor reads; Form readonly suppresses all', async (t) => {
    const raw = ['One', 'Two'];
    const f = await fixture(t, {
        drivers: [
            {
                fieldId: 'first',
                fieldName: 'First',
                title: null,
                urlSearchValue: raw,
                hidden: true,
            },
            {
                fieldId: 'survivor',
                fieldName: 'Survivor',
                title: null,
                urlSearchValue: undefined,
                hidden: true,
            },
        ],
        values: { first: pair('first-ID', 'Same label') },
    });
    assert.equal(f.host.querySelector('input'), null);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].query.searchTerm, raw);
    await f.settle();
    assert.equal(f.requests.length, 3);
    assert.equal(f.requests[1].query.urlSearchValue, raw);
    assert.deepEqual(f.requests[2].query.filterData, {
        previousFilterFieldId: 'first',
        previousFilterPrimaryValue: 'Same label',
    });
    await f.render({ formReadOnly: true });
    await act(async () => {
        for (const request of f.requests)
            request.result.resolve(page([], pair('late')));
    });
    assert.equal(
        f.writes.some((write) => JSON.stringify(write).includes('late')),
        false
    );
    const count = f.requests.length;
    await f.settle();
    assert.equal(f.requests.length, count);
});

test('same-label options keep record-ID identity and keyboard selection/focus; same-label predecessor IDs do not reset', async (t) => {
    const f = await fixture(t);
    await f.settle();
    await act(async () =>
        f.requests[0].result.resolve(
            page([pair('A', 'Same'), pair('B', 'Same')])
        )
    );
    const input = f.host.querySelector('input')!;
    await act(async () => {
        input.focus();
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowDown',
                bubbles: true,
            })
        );
    });
    await f.tick();
    assert.equal(f.host.querySelectorAll('[role="option"]').length, 2);
    await act(async () => {
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })
        );
    });
    await f.tick();
    await act(async () =>
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
            })
        )
    );
    assert.equal(f.values.driver?.recordId, 'B');
    assert.equal(f.document.activeElement, input);
});

test('ordinary loading takes precedence and retained ordinary error survives later successful data', async (t) => {
    const f = await fixture(t);
    await f.settle();
    await act(async () =>
        f.requests[0].result.reject(new Error('Synthetic transport failure'))
    );
    const input = f.host.querySelector('input')!;
    await act(async () => input.focus());
    // Focus allocated a new ordinary request; loading outranks the retained error.
    assert.match(f.host.textContent, /Chargement/);
    assert.equal(f.host.querySelector('[role="alert"]'), null);
    await act(async () =>
        f.requests[1].result.resolve(page([pair('available')]))
    );
    assert.match(f.host.textContent, /Ordinary unavailable/);
    assert.equal(f.host.querySelector('[role="option"]'), null);
});

test('StrictMode preserves allocated prefill transports while retiring old local writers and reports current failures only', async (t) => {
    const f = await fixture(
        t,
        {
            drivers: [
                {
                    fieldId: 'driver',
                    fieldName: 'Driver',
                    title: null,
                    urlSearchValue: 'raw',
                    hidden: true,
                },
            ],
        },
        true
    );
    assert.equal(f.requests.length, 2);
    await act(async () =>
        f.requests[0].result.resolve(page([], pair('retired')))
    );
    assert.equal(
        f.writes.some((write) => JSON.stringify(write).includes('retired')),
        false
    );
    const error = new Error('Current prefill failure');
    await act(async () => f.requests[1].result.reject(error));
    assert.deepEqual(f.failures, [error]);
    assert.deepEqual(f.flags, [true, true]);
    const next = f.replace();
    await f.render({ owner: next });
    await act(async () =>
        f.requests.at(-1)!.result.resolve(page([], pair('new-owner')))
    );
    assert.equal(f.values.driver?.recordId, 'new-owner');
});

for (const selected of [null, pair('same', 'Same label')]) {
    test(`prefill completion clears loading text without a canonical identity change (${selected ? 'same pair' : 'null'})`, async (t) => {
        const values = { driver: selected };
        const f = await fixture(
            t,
            {
                values,
                drivers: [
                    {
                        fieldId: 'driver',
                        fieldName: 'Driver',
                        title: null,
                        hidden: false,
                        urlSearchValue: 'Raw',
                    },
                ],
            },
            false,
            null
        );
        const loadingInput = f.host.querySelector('input')!;
        assert.equal(loadingInput.value, 'Chargement');
        assert.equal(loadingInput.disabled, true);
        const request = f.requests[0];
        await act(async () => request.result.resolve(page([], selected)));
        const input = f.host.querySelector('input')!;
        assert.equal(input.value, selected?.stringValue ?? '');
        assert.equal(input.disabled, false);
        assert.equal(
            f.host
                .querySelector('[data-pending-requests]')
                ?.getAttribute('data-pending-requests'),
            '0'
        );
        assert.equal(values.driver, selected);
        const requestCount = f.requests.length;
        await f.render();
        assert.equal(f.host.querySelector('input'), input);
        assert.equal(f.requests.length, requestCount);
    });
}
