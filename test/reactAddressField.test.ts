import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    AddressField,
    type AddressFieldProps,
} from '../src/react/AddressField.js';

const labels = {
    clear: 'Clear',
    loadingPredictions: 'Loading suggestions',
    loadingDetails: 'Loading details',
    failed: 'Read failed',
    retry: 'Retry',
};
const identity = { session: 'A', field: 'address', readScope: 'token-A' };

async function fixture(t: TestContext, manual = false) {
    const window = new Window({ url: 'https://address.example.invalid' });
    let network = 0;
    const rejectNetwork = async () => {
        network++;
        throw Error('Unexpected real network');
    };
    Object.defineProperty(window, 'fetch', { value: rejectNetwork });
    const globals = {
        fetch: rejectNetwork,
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
        NodeFilter: window.NodeFilter,
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const old = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'address-form';
    window.document.body.append(container);
    let submits = 0;
    container.addEventListener('submit', (e) => {
        submits++;
        e.preventDefault();
    });
    const root = createRoot(container as unknown as HTMLElement),
        ref = createRef<HTMLInputElement>();
    const writes: string[] = [],
        queries: string[] = [],
        details: { prior: string[]; signal: AbortSignal }[] = [];
    let release: (value: string) => void = () => {};
    let failPrediction = false,
        failDetail = false;
    const reads = {
        async listPredictions(query: string) {
            queries.push(query);
            if (failPrediction) {
                failPrediction = false;
                throw Error('Synthetic prediction failure');
            }
            return [{ placeId: 'p', description: 'Selected address' }];
        },
        async getFormattedAddress(
            _place: string,
            { signal }: { signal: AbortSignal }
        ) {
            details.push({ prior: [...writes], signal });
            if (failDetail) {
                failDetail = false;
                throw Error('Synthetic detail failure');
            }
            return new Promise<string>((resolve) => {
                release = resolve;
            });
        },
    };
    const render = () =>
        root.render(h(StrictMode, null, h(AddressField, { ...props, ref })));
    const write = (value: string) => {
        assert.notEqual(props.mode, 'readonly');
        writes.push(value);
        if (props.mode === 'readonly') return;
        props = {
            ...props,
            value:
                props.maxLength == null
                    ? value
                    : value.slice(0, props.maxLength),
        };
        render();
    };
    let props: AddressFieldProps = manual
        ? {
              mode: 'manual',
              value: '',
              onChange: write,
              labels,
              initialMobile: true,
              maxLength: 8,
              explanation: 'Use the standalone form.',
              id: 'address',
              form: 'address-form',
              'aria-describedby': 'help',
          }
        : {
              mode: 'autocomplete',
              value: '',
              onChange: write,
              identity,
              reads,
              labels,
              maxLength: 8,
              initialMobile: true,
              id: 'address',
              form: 'address-form',
          };
    t.after(async () => {
        try {
            await act(async () => root.unmount());
            assert.equal(submits, 0);
            assert.equal(network, 0);
            assert.equal(ref.current, null);
        } finally {
            t.mock.timers.reset();
            for (const [key, descriptor] of old) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    await act(async () => render());
    t.mock.timers.enable({ apis: ['setTimeout'] });
    return {
        container,
        ref,
        writes,
        queries,
        details,
        reads,
        props: () => {
            if (props.mode === 'readonly')
                throw Error('Expected editing props');
            return props;
        },
        inputValue: () => ref.current?.value,
        replace: async (next: AddressFieldProps) => {
            props = next;
            await act(async () => render());
        },
        type: async (value: string) => {
            await act(async () => {
                const input = container.querySelector('input')!;
                input.focus();
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(input, value);
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
        debounce: async () => {
            await act(async () => t.mock.timers.tick(800));
        },
        select: async () => {
            await act(async () =>
                (
                    container.querySelector(
                        '[role="option"]'
                    ) as unknown as HTMLElement
                ).click()
            );
        },
        settle: async (value: string) => {
            await act(async () => release(value));
        },
        failPrediction: () => {
            failPrediction = true;
        },
        failDetail: () => {
            failDetail = true;
        },
    };
}

it('renders natural readonly and manual modes on the server without read or write authority', (t) => {
    t.mock.method(globalThis, 'fetch', () => {
        throw Error('Unexpected server-render network');
    });
    let writes = 0;
    const readonly = renderToString(
        h(AddressField, {
            mode: 'readonly',
            value: 'https://example.invalid',
            language: 'ja',
        })
    );
    assert.match(readonly, /href="https:\/\/example.invalid"/);
    assert.doesNotMatch(readonly, /combobox|input|button/);
    assert.match(
        renderToString(
            h(AddressField, { mode: 'readonly', value: null, language: 'es' })
        ),
        /Sin Valor/
    );
    const manual = renderToString(
        h(AddressField, {
            mode: 'manual',
            value: null,
            onChange: () => writes++,
            labels,
            explanation: 'Standalone only',
            initialMobile: false,
            id: 'preview',
        })
    );
    assert.match(manual, /value=""/);
    assert.match(manual, /preview-address-preview/);
    assert.doesNotMatch(manual, /combobox/);
    assert.equal(writes, 0);
});

it('keeps manual preview controlled, associated, capped by its writer and non-submitting on Clear', async (t) => {
    const f = await fixture(t, true);
    await f.type('123456789');
    assert.equal(f.inputValue(), '12345678');
    assert.match(f.container.textContent, /8\/8/);
    assert.equal(f.ref.current?.getAttribute('autocomplete'), 'off');
    assert.match(
        f.ref.current?.getAttribute('aria-describedby') ?? '',
        /help address-address-preview/
    );
    const clear = f.container.querySelector('button')!;
    assert.equal(clear.type, 'button');
    await act(async () => clear.click());
    assert.equal(f.inputValue(), '');
    assert.equal(f.ref.current, f.container.ownerDocument.activeElement);
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.details, []);
    await f.replace({ ...f.props(), value: 'External replacement' });
    assert.equal(f.inputValue(), 'External replacement');
});

it('preserves raw queries, synchronous capped selection and retirement across readonly A-B-A', async (t) => {
    const f = await fixture(t);
    await f.replace({ ...f.props(), maxLength: 30 });
    await f.type('  raw query  ');
    await f.debounce();
    assert.deepEqual(f.queries, ['  raw query  ']);
    await f.replace({ ...f.props(), maxLength: 8 });
    await f.select();
    assert.equal(f.inputValue(), 'Selected');
    assert.equal(f.details[0]?.prior.at(-1), 'Selected address');
    const edit = f.props();
    await f.replace({
        mode: 'readonly',
        value: 'External replacement',
        language: 'en',
    });
    assert.equal(f.ref.current, null);
    assert.equal(f.details[0]?.signal.aborted, true);
    await f.replace(edit);
    await f.settle('Late canonical');
    assert.equal(f.inputValue(), 'Selected');
    assert.equal(f.writes.at(-1), 'Selected address');
});

it('keeps retry explicit and confined to the failing request phase', async (t) => {
    const f = await fixture(t);
    f.failPrediction();
    await f.type('Query');
    await f.debounce();
    assert.match(f.container.textContent, /Read failed/);
    assert.equal(f.queries.length, 1);
    const retry = () =>
        [...f.container.querySelectorAll('button')].find(
            (b) => b.textContent === 'Retry'
        )!;
    await act(async () => retry().click());
    assert.equal(f.queries.length, 2);
    f.failDetail();
    await f.select();
    assert.match(f.container.textContent, /Read failed/);
    assert.equal(f.inputValue(), 'Selected');
    await act(async () => retry().click());
    assert.equal(f.details.length, 2);
    assert.equal(f.queries.length, 2);
    await f.settle('Canonical address');
    assert.equal(f.inputValue(), 'Canonica');
});

it('keeps configured scanner UI inert until requested and removes it in readonly mode', async (t) => {
    const f = await fixture(t, true);
    await f.replace({
        ...f.props(),
        scanner: {
            enableQRCodeScannerForFormField: true,
            autoStartCamera: false,
            ownerKey: {},
        },
    });
    assert(f.container.querySelector('[data-testid="qr-scanner-button"]'));
    assert.equal(f.container.querySelector('video'), null);
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.writes, []);
    await f.replace({
        mode: 'readonly',
        value: 'Accepted address',
        language: 'en',
    });
    assert.equal(f.container.querySelector('button'), null);
    assert.equal(f.container.querySelector('video'), null);
});
