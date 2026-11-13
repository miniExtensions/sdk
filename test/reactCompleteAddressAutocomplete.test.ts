import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    Suspense,
    startTransition,
    useLayoutEffect,
} from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteAddressAutocomplete,
    useAddressAutocomplete,
    type CompleteAddressAutocompleteProps,
    type AddressAutocompleteLifecycleProps,
} from '../src/react/index.js';

const labels = {
    clear: 'Clear',
    loadingPredictions: 'Loading suggestions',
    loadingDetails: 'Loading selected address',
    failed: 'Unable to load. Keep typing or retry.',
    retry: 'Try again',
};
const prediction = { description: 'Selected address', placeId: 'place-A' };
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

async function fixture(
    t: TestContext,
    patch: Partial<CompleteAddressAutocompleteProps> = {},
    probe = false
) {
    const window = new Window({ url: 'https://address.example.test' });
    let network = 0,
        submits = 0;
    const rejectNetwork = async () => {
        network++;
        throw Error('Unexpected real request');
    };
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLFieldSetElement: window.HTMLFieldSetElement,
        HTMLLegendElement: window.HTMLLegendElement,
        Element: window.Element,
        Node: window.Node,
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        IS_REACT_ACT_ENVIRONMENT: true,
        fetch: rejectNetwork,
    };
    const originals = Object.keys(values).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.defineProperty(window, 'fetch', { value: rejectNetwork });
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const container = window.document.createElement('form');
    container.id = 'address-form';
    container.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const ref = createRef<HTMLInputElement>();
    const writes: string[] = [];
    const queries: { query: string; signal: AbortSignal }[] = [];
    const details: {
        id: string;
        signal: AbortSignal;
        written: readonly string[];
    }[] = [];
    let props: CompleteAddressAutocompleteProps = {
        identity: {
            session: 'session-A',
            field: 'field-A',
            readScope: 'token-A',
        },
        value: '',
        onChange(value) {
            writes.push(value);
            props = {
                ...props,
                value:
                    props.maxLength == null
                        ? value
                        : value.slice(0, props.maxLength),
            };
            root.render(view());
        },
        reads: {
            async listPredictions(query, { signal }) {
                queries.push({ query, signal });
                return [prediction];
            },
            async getFormattedAddress(id, { signal }) {
                details.push({ id, signal, written: [...writes] });
                return 'Formatted address';
            },
        },
        labels,
        initialMobile: false,
        id: 'address',
        form: 'address-form',
        'aria-label': 'Address',
        ...patch,
    };
    let suspended = false;
    const never = new Promise<never>(() => {});
    let lifecycle!: ReturnType<typeof useAddressAutocomplete>;
    function Probe(input: AddressAutocompleteLifecycleProps) {
        const result = useAddressAutocomplete(input);
        useLayoutEffect(() => {
            lifecycle = result;
        });
        if (suspended) throw never;
        return h('output', null, result.state.phase);
    }
    const view = () =>
        h(
            StrictMode,
            null,
            probe
                ? h(
                      Suspense,
                      { fallback: h('span', null, 'Uncommitted render') },
                      h(Probe, props)
                  )
                : h(CompleteAddressAutocomplete, { ...props, ref })
        );
    let unmounted = false;
    t.after(async () => {
        try {
            if (!unmounted) await act(async () => root.unmount());
            assert.equal(network, 0);
            assert.equal(submits, 0);
            assert.equal(ref.current, null);
        } finally {
            t.mock.timers.reset();
            for (const [key, descriptor] of originals) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    await act(async () => root.render(view()));
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const update = async (patch: Partial<CompleteAddressAutocompleteProps>) => {
        props = { ...props, ...patch };
        await act(async () => root.render(view()));
    };
    const change = async (value: string) => {
        await act(async () => {
            if (probe) lifecycle.change(value);
            else {
                const input = container.querySelector('input')!;
                input.focus();
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(input, value);
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            }
        });
    };
    const tick = async (ms = 800) => {
        await act(async () => {
            t.mock.timers.tick(ms);
        });
    };
    const select = async () => {
        await act(async () =>
            lifecycle.select(lifecycle.state.predictions[0]!)
        );
    };
    return {
        window,
        container,
        ref,
        writes,
        queries,
        details,
        update,
        change,
        tick,
        select,
        commitSync(patch: Partial<CompleteAddressAutocompleteProps>) {
            props = { ...props, ...patch };
            flushSync(() => root.render(view()));
        },
        unmountSync() {
            flushSync(() => root.unmount());
            unmounted = true;
        },
        async suspend(patch: Partial<CompleteAddressAutocompleteProps>) {
            props = { ...props, ...patch };
            suspended = true;
            await act(async () => startTransition(() => root.render(view())));
        },
        get lifecycle() {
            return lifecycle;
        },
        get props() {
            return props;
        },
        async unmount() {
            await act(async () => root.unmount());
            unmounted = true;
        },
    };
}

it('renders supplied null/external text, real forwarded ref and native form/ARIA without reads', async (t) => {
    const f = await fixture(t, {
        value: null,
        maxLength: 12,
        'aria-describedby': 'hint error',
        'aria-invalid': true,
    });
    const input = f.container.querySelector('input')!;
    assert.equal(f.ref.current, input);
    assert.equal(input.value, '');
    assert.equal(input.id, 'address');
    assert.equal(input.getAttribute('form'), 'address-form');
    assert.equal(input.getAttribute('autocomplete'), 'off');
    assert.equal(input.getAttribute('aria-describedby'), 'hint error');
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.maxLength, 12);
    await f.update({ value: 'External text beyond cap' });
    assert.equal(f.ref.current, input);
    assert.equal(input.value, 'External text beyond cap');
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.writes, []);
});

it('debounces raw nonempty queries and rejects stale predictions/failures with signals', async (t) => {
    const old = deferred<readonly (typeof prediction)[]>();
    const fresh = deferred<readonly (typeof prediction)[]>();
    const calls: { query: string; signal: AbortSignal }[] = [];
    const f = await fixture(
        t,
        {
            reads: {
                listPredictions(query, { signal }) {
                    calls.push({ query, signal });
                    return calls.length === 1 ? old.promise : fresh.promise;
                },
                async getFormattedAddress() {
                    return 'Unused';
                },
            },
        },
        true
    );
    await f.change('old');
    await f.tick();
    await f.change('   raw query   ');
    await f.tick(799);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.signal.aborted, true);
    await f.tick(1);
    assert.equal(calls[1]!.query, '   raw query   ');
    await act(async () => {
        fresh.resolve([prediction]);
    });
    const state = f.lifecycle.state;
    await act(async () => {
        old.reject(Error('private failure'));
    });
    assert.equal(f.lifecycle.state, state);
    await f.change('');
    await f.tick();
    assert.equal(calls.length, 2);
    assert.deepEqual(f.writes, ['old', '   raw query   ', '']);
});

it('accepts only current exact options and writes description synchronously before details', async (t) => {
    const detail = deferred<string>();
    const order: string[] = [];
    const f = await fixture(
        t,
        {
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress(id) {
                    order.push('read:' + id);
                    return detail.promise;
                },
            },
            onChange(value) {
                order.push('write:' + value);
            },
        },
        true
    );
    await f.change('query');
    await f.tick();
    const offered = f.lifecycle.state.predictions[0]!;
    await act(async () => {
        f.lifecycle.select({ ...offered });
    });
    assert.deepEqual(order, ['write:query']);
    await f.select();
    assert.deepEqual(order, [
        'write:query',
        'write:Selected address',
        'read:place-A',
    ]);
    await act(async () => {
        detail.resolve('Canonical address');
    });
    assert.equal(order.at(-1), 'write:Canonical address');
    await act(async () => f.lifecycle.select(offered));
    assert.equal(order.filter((v) => v.startsWith('read:')).length, 1);
});

it('keeps an unchanged capped selection echo, uses latest committed writer and expires its receipt', async (t) => {
    const detail = deferred<string>();
    const writes: string[] = [];
    const f = await fixture(
        t,
        {
            value: 'Sele',
            maxLength: 4,
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress() {
                    return detail.promise;
                },
            },
        },
        true
    );
    // A failed query retry can produce the full description while canonical cap stays unchanged.
    await f.change('Selected address');
    await f.tick();
    await f.select();
    assert.equal(f.props.value, 'Sele');
    assert.equal(f.lifecycle.state.phase, 'loading-details');
    await f.update({
        disabled: false,
        readOnly: false,
        onChange(value) {
            writes.push(value);
        },
    });
    await act(async () => {
        detail.resolve('Formatted address');
    });
    assert.deepEqual(writes, ['Formatted address']);
    assert.equal(f.lifecycle.state.phase, 'details');
    await f.update({ value: 'Other' });
    assert.equal(f.lifecycle.state.phase, 'idle');
    await f.update({ value: 'Sele' });
    assert.equal(f.lifecycle.state.phase, 'idle');
});

for (const member of ['session', 'field', 'readScope'] as const) {
    it(`retires ${member} A-to-B-to-A, stale handlers and late details after StrictMode setup`, async (t) => {
        const detail = deferred<string>();
        let signal!: AbortSignal;
        const f = await fixture(
            t,
            {
                reads: {
                    async listPredictions() {
                        return [prediction];
                    },
                    getFormattedAddress(_id, options) {
                        signal = options.signal;
                        return detail.promise;
                    },
                },
            },
            true
        );
        await f.change('query');
        await f.tick();
        await f.select();
        const stale = f.lifecycle;
        const identity = f.props.identity;
        await f.update({ identity: { ...identity, [member]: 'B' } });
        assert.equal(signal.aborted, true);
        await f.update({ identity });
        await act(async () => {
            stale.change('forged old edit');
            stale.select(prediction);
            stale.retry();
            detail.resolve('Late canonical');
        });
        assert.deepEqual(f.writes, ['query', 'Selected address']);
        assert.equal(f.lifecycle.state.phase, 'idle');
    });
}

it('external value replacement retires pending details, including external clear and value ABA', async (t) => {
    const detail = deferred<string>();
    let signal!: AbortSignal;
    const f = await fixture(
        t,
        {
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress(_id, options) {
                    signal = options.signal;
                    return detail.promise;
                },
            },
        },
        true
    );
    await f.change('query');
    await f.tick();
    await f.select();
    await f.update({ value: '' });
    await f.update({ value: 'Selected address' });
    assert.equal(signal.aborted, true);
    await act(async () => detail.resolve('Late address'));
    assert.deepEqual(f.writes, ['query', 'Selected address']);
});

it('explicit retries retain phase and reject stale callbacks; manual text stays editable', async (t) => {
    let predictions = 0,
        details = 0;
    const f = await fixture(
        t,
        {
            reads: {
                async listPredictions() {
                    if (++predictions === 1) throw Error('private');
                    return [prediction];
                },
                async getFormattedAddress() {
                    if (++details === 1) throw Error('private');
                    return 'Canonical';
                },
            },
        },
        true
    );
    await f.change('query');
    await f.tick();
    assert.equal(f.lifecycle.state.phase, 'failed-predictions');
    const staleRetry = f.lifecycle.retry;
    await act(async () => f.lifecycle.retry());
    assert.equal(predictions, 2);
    await f.select();
    assert.equal(f.lifecycle.state.phase, 'failed-details');
    await act(async () => staleRetry());
    assert.equal(details, 1);
    await act(async () => f.lifecycle.retry());
    assert.equal(details, 2);
    assert.equal(predictions, 2);
    assert.equal(f.props.value, 'Canonical');
    await f.change('Manual correction');
    await f.tick();
    assert.equal(predictions, 3);
    assert.equal(f.props.value, 'Manual correction');
});

it('unmount aborts details and refuses the old writer', async (t) => {
    const detail = deferred<string>();
    let signal!: AbortSignal;
    const f = await fixture(
        t,
        {
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress(_id, options) {
                    signal = options.signal;
                    return detail.promise;
                },
            },
        },
        true
    );
    await f.change('query');
    await f.tick();
    await f.select();
    const stale = f.lifecycle;
    await f.unmount();
    assert.equal(signal.aborted, true);
    await act(async () => {
        detail.resolve('Late');
        stale.change('Old edit');
    });
    assert.deepEqual(f.writes, ['query', 'Selected address']);
});

for (const phase of ['prediction', 'detail'] as const) {
    for (const action of [
        'replace',
        'replace-value',
        'value-aba',
        'unmount',
        'new-edit',
    ] as const) {
        it(`fences old manual writes when ${phase} abort synchronously triggers ${action}`, async (t) => {
            let signal!: AbortSignal;
            const pending = deferred<readonly (typeof prediction)[]>();
            const detail = deferred<string>();
            const successor: string[] = [];
            const f = await fixture(
                t,
                {
                    reads: {
                        listPredictions(_query, options) {
                            signal = options.signal;
                            return phase === 'prediction'
                                ? pending.promise
                                : Promise.resolve([prediction]);
                        },
                        getFormattedAddress(_id, options) {
                            signal = options.signal;
                            return detail.promise;
                        },
                    },
                },
                true
            );
            await f.change('Initial query');
            await f.tick();
            if (phase === 'detail') await f.select();
            const before = [...f.writes];
            signal.addEventListener(
                'abort',
                () => {
                    if (action === 'replace')
                        f.commitSync({
                            identity: { ...f.props.identity, readScope: 'B' },
                            onChange(value) {
                                successor.push(value);
                            },
                        });
                    else if (action === 'replace-value')
                        f.commitSync({ value: 'External replacement' });
                    else if (action === 'value-aba') {
                        const value = f.props.value;
                        f.commitSync({ value: 'External replacement' });
                        f.commitSync({ value });
                    } else if (action === 'unmount') f.unmountSync();
                    else f.lifecycle.change('Reentrant current edit');
                },
                { once: true }
            );
            await f.change('Obsolete outer edit');
            await f.tick();
            assert.deepEqual(successor, []);
            assert.deepEqual(
                f.writes,
                action === 'new-edit'
                    ? [...before, 'Reentrant current edit']
                    : before
            );
            assert(!f.writes.includes('Obsolete outer edit'));
            await act(async () => {
                pending.resolve([prediction]);
                detail.resolve('Late details');
            });
            assert.deepEqual(successor, []);
        });
    }
}

it('expires an unacknowledged own echo at its state commit before a real external transition', async (t) => {
    const detail = deferred<string>();
    let signal!: AbortSignal;
    const writes: string[] = [];
    const f = await fixture(
        t,
        {
            value: 'Canonical A',
            onChange(value) {
                writes.push(value);
            },
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress(_id, options) {
                    signal = options.signal;
                    return detail.promise;
                },
            },
        },
        true
    );
    await f.change('Query');
    await f.tick();
    await f.select();
    assert.equal(f.props.value, 'Canonical A');
    assert.equal(f.lifecycle.state.phase, 'loading-details');
    await f.update({ value: 'Selected address' });
    assert.equal(signal.aborted, true);
    await act(async () => detail.resolve('Late canonical'));
    assert.deepEqual(writes, ['Query', 'Selected address']);
});

it('does not leak writer or read closures from a suspended uncommitted render', async (t) => {
    const detail = deferred<string>();
    const committed: string[] = [],
        discarded: string[] = [];
    const f = await fixture(
        t,
        {
            onChange(value) {
                committed.push(value);
            },
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress() {
                    return detail.promise;
                },
            },
        },
        true
    );
    await f.change('Query');
    await f.tick();
    await f.select();
    await f.suspend({
        onChange(value) {
            discarded.push(value);
        },
        reads: {
            async listPredictions() {
                assert.fail('Uncommitted prediction closure');
            },
            async getFormattedAddress() {
                assert.fail('Uncommitted detail closure');
            },
        },
    });
    await act(async () => detail.resolve('Committed canonical'));
    assert.deepEqual(committed, [
        'Query',
        'Selected address',
        'Committed canonical',
    ]);
    assert.deepEqual(discarded, []);
});

for (const flag of ['disabled', 'readOnly'] as const) {
    it(`retires pending public control reads/options and refuses writes while ${flag}`, async (t) => {
        const detail = deferred<string>();
        let signal!: AbortSignal,
            details = 0;
        const f = await fixture(t, {
            reads: {
                async listPredictions() {
                    return [prediction];
                },
                getFormattedAddress(_id, options) {
                    details++;
                    signal = options.signal;
                    return detail.promise;
                },
            },
        });
        await f.change('Query');
        await f.tick();
        const input = f.container.querySelector('input')!;
        await act(async () =>
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                })
            )
        );
        const oldOption = f.container.querySelector('[role=option]')!;
        assert.ok(oldOption);
        await f.update({ [flag]: true });
        assert.equal(input.disabled, flag === 'disabled');
        assert.equal(input.readOnly, flag === 'readOnly');
        await act(async () =>
            oldOption.dispatchEvent(
                new f.window.MouseEvent('click', { bubbles: true })
            )
        );
        assert.equal(details, 0);
        assert.deepEqual(f.writes, ['Query']);
        await f.update({ [flag]: false });
        await f.change('New query');
        await f.tick();
        await act(async () =>
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                })
            )
        );
        await act(async () =>
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(details, 1);
        await f.update({ [flag]: true });
        assert.equal(signal.aborted, true);
        await act(async () => detail.resolve('Forbidden late value'));
        assert.deepEqual(f.writes, ['Query', 'New query', 'Selected address']);
    });
}

it('mobile Clear is non-submitting, returns focus and displays controlled manual text', async (t) => {
    const f = await fixture(t, {
        value: 'Existing address',
        initialMobile: true,
    });
    const clear = f.container.querySelector('button')!;
    assert.equal(clear.type, 'button');
    assert.equal(clear.getAttribute('aria-label'), 'Clear');
    await act(async () => clear.click());
    assert.equal(f.ref.current?.value, '');
    assert.equal(f.window.document.activeElement, f.ref.current);
    assert.deepEqual(f.writes, ['']);
    assert.deepEqual(f.queries, []);
});

it('SSR preserves null and loaded values without reads or a document', () => {
    let reads = 0;
    const props: CompleteAddressAutocompleteProps = {
        identity: { session: 's', field: 'f', readScope: 'r' },
        value: null,
        onChange() {
            assert.fail();
        },
        reads: {
            async listPredictions() {
                reads++;
                return [];
            },
            async getFormattedAddress() {
                reads++;
                return '';
            },
        },
        labels,
        initialMobile: false,
        'aria-label': 'Address',
    };
    assert(
        renderToString(h(CompleteAddressAutocomplete, props)).includes(
            'value=""'
        )
    );
    assert(
        renderToString(
            h(CompleteAddressAutocomplete, {
                ...props,
                value: 'Loaded address',
            })
        ).includes('value="Loaded address"')
    );
    assert.equal(reads, 0);
});

for (const locale of [
    {
        clear: 'Borrar',
        loadingPredictions: 'Cargando sugerencias',
        loadingDetails: 'Cargando la dirección seleccionada',
        failed: 'No se pudieron cargar las sugerencias de direcciones.',
        retry: 'Intentar de nuevo',
    },
    {
        clear: 'クリア',
        loadingPredictions: '住所の候補を読み込み中',
        loadingDetails: '選択した住所を読み込み中',
        failed: '住所の候補を読み込めませんでした。',
        retry: 'もう一度試す',
    },
]) {
    it(`renders two-option keyboard selection, attributed predictions and localized detail/retry UI (${locale.clear})`, async (t) => {
        const detail = deferred<string>();
        let attempts = 0;
        const f = await fixture(t, {
            labels: locale,
            reads: {
                async listPredictions() {
                    return [
                        prediction,
                        { placeId: 'p2', description: 'Second address' },
                    ];
                },
                getFormattedAddress() {
                    if (++attempts === 1) return detail.promise;
                    return Promise.resolve('Canonical address');
                },
            },
        });
        await f.change('Query');
        await f.tick();
        assert.deepEqual(f.writes, ['Query']);
        const input = f.container.querySelector('input')!;
        const activeText = () =>
            f.window.document.getElementById(
                input.getAttribute('aria-activedescendant') ?? ''
            )?.textContent;
        assert.equal(activeText(), 'Selected address');
        await act(async () => {
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                })
            );
        });
        assert.equal(activeText(), 'Second address');
        await act(async () => {
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'ArrowUp',
                    bubbles: true,
                })
            );
        });
        assert.equal(activeText(), 'Selected address');
        const option = f.container.querySelector('[role=option]');
        assert.ok(option);
        assert.equal(option.textContent, 'Selected address');
        const logo = f.container.querySelector('img')!;
        assert.equal(logo.alt, 'Google Maps');
        assert(logo.src.startsWith('data:image/png;base64,'));
        await act(async () => {
            input.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true,
                })
            );
        });
        assert.equal(f.props.value, 'Selected address');
        assert.equal(
            f.container.querySelector('[role=status]')?.textContent,
            locale.loadingDetails
        );
        await act(async () =>
            detail.reject(Error('Private provider diagnostic'))
        );
        assert.equal(
            f.container.querySelector('[role=alert]')?.textContent,
            locale.failed
        );
        assert(
            !f.container.textContent.includes('Private provider diagnostic')
        );
        const retry = Array.from(f.container.querySelectorAll('button')).find(
            (button) => button.textContent === locale.retry
        )!;
        assert.equal(retry.type, 'button');
        await act(async () => retry.click());
        assert.equal(attempts, 2);
        assert.equal(f.props.value, 'Canonical address');
    });
}
