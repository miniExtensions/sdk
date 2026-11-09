import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import {
    CompleteLocalizedNumericField,
    type CompleteLocalizedNumericFieldOptions,
    type CompleteLocalizedNumericRendererProps,
} from '../src/react/index.js';
import { createRendererProps } from '../src/ui/rendererRegistry.js';
import type { NumberInputSeparator } from '../src/ui/numberInputCompatibility.js';

type Kind = 'number' | 'currency' | 'percent';
async function fixture(
    t: TestContext,
    args: {
        kind?: Kind;
        value?: number | null;
        precision?: number;
        separator?: NumberInputSeparator;
        grouping?: boolean;
        allowNegative?: boolean;
        progress?: boolean;
        deferred?: boolean;
        mobile?: boolean;
        symbol?: string;
        error?: string | null;
    } = {}
) {
    const window = new Window();
    if (args.mobile)
        Object.defineProperty(window.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'standalone-numeric';
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const state = {
        value: args.value ?? null,
        kind: args.kind ?? 'number',
        precision: args.precision ?? 2,
        separator: args.separator,
        grouping: args.grouping ?? false,
        allowNegative: args.allowNegative ?? false,
        progress: args.progress ?? false,
        readonly: false,
        error: args.error ?? null,
        owner: {},
        current: true,
        symbol: args.symbol ?? '$',
    };
    const writes: (number | null)[] = [];
    let submits = 0;
    let renders = 0;
    container.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const options: CompleteLocalizedNumericFieldOptions = {
        commit: args.deferred ? 'deferred' : 'immediate',
        input: {
            id: 'numeric-input',
            form: container.id,
            'aria-describedby': 'native-description',
        },
    };
    const props = (): CompleteLocalizedNumericRendererProps => {
        const capturedOwner = state.owner;
        const result = createRendererProps({
            physicalKind: state.kind,
            fieldId: 'numeric',
            title: 'Amount',
            field: {
                id: 'numeric',
                name: 'Amount',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: state.kind,
                    options: {
                        precision: state.precision,
                        ...(state.kind === 'currency'
                            ? { symbol: state.symbol }
                            : {}),
                    },
                },
            },
            displayConfig: {
                numberSeparator: state.separator,
                showThousandsSeparator: state.grouping,
                allowNegativeNumbers: state.allowNegative,
                readOnly: state.readonly,
                ...(state.kind === 'percent'
                    ? { showAsProgressBar: state.progress }
                    : {}),
            },
            value: state.value,
            context: 'form',
            computed: false,
            dirty: false,
            pending: false,
            validation: [],
            error: state.error,
            capability: {
                type: 'editable',
                setValue(value) {
                    if (!state.current || state.owner !== capturedOwner)
                        return { accepted: false, reason: 'retired' };
                    if (state.readonly)
                        return { accepted: false, reason: 'readonly' };
                    if (
                        value !== null &&
                        (typeof value !== 'number' || !Number.isFinite(value))
                    )
                        return { accepted: false, reason: 'invalid-value' };
                    state.value = value;
                    writes.push(value);
                    publish();
                    return { accepted: true };
                },
            },
        });
        assert.ok(
            result &&
                (result.physicalKind === 'number' ||
                    result.physicalKind === 'currency' ||
                    result.physicalKind === 'percent')
        );
        return result;
    };
    const publish = () => {
        if (!mounted) return;
        renders++;
        root.render(
            h(
                StrictMode,
                null,
                h(CompleteLocalizedNumericField, {
                    field: props(),
                    options: {
                        ...options,
                        owner: {
                            token: state.owner,
                            isCurrent: () => state.current,
                        },
                    },
                })
            )
        );
    };
    const render = async () => {
        await act(async () => publish());
    };
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const focus = async () => {
        await act(async () => input().focus());
    };
    const blur = async () => {
        await act(async () => input().blur());
    };
    const edit = async (text: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(input(), text);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    let mounted = true;
    const unmount = async () => {
        if (mounted) {
            mounted = false;
            await act(async () => root.unmount());
        }
    };
    t.after(async () => {
        await unmount();
        assert.equal(submits, 0, 'editing and Clear must never submit');
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    await render();
    return {
        window,
        state,
        writes,
        container,
        options,
        render,
        input,
        focus,
        blur,
        edit,
        unmount,
        renders: () => renders,
    };
}

const locales = [
    ['comma-period', ['1235', '1,235', '1234.56', '1,234.56'], '9876.54'],
    ['period-comma', ['1235', '1.235', '1234,56', '1.234,56'], '9876,54'],
    ['space-comma', ['1235', '1 235', '1234,56', '1 234,56'], '9876,54'],
    ['space-period', ['1235', '1 235', '1234.56', '1 234.56'], '9876.54'],
] as const;
for (const kind of ['number', 'currency', 'percent'] as const)
    for (const [separator, displays, text] of locales)
        for (const precision of [0, 2])
            for (const grouping of [false, true])
                it(`complete ${kind}: ${separator}, precision${precision}, grouping${grouping}`, async (t) => {
                    const f = await fixture(t, {
                        kind,
                        value: kind === 'percent' ? 12.3456 : 1234.56,
                        precision,
                        separator,
                        grouping,
                    });
                    assert.equal(
                        f.input().value,
                        displays[(precision === 2 ? 2 : 0) + Number(grouping)]
                    );
                    assert.deepEqual(f.writes, []);
                    await f.focus();
                    assert.equal(
                        f.input().value,
                        precision === 0
                            ? '1235'
                            : separator.endsWith('comma')
                              ? '1234,56'
                              : '1234.56'
                    );
                    await f.edit(text);
                    assert.deepEqual(f.writes, [
                        kind === 'percent'
                            ? 9876.54 / 100
                            : precision === 0
                              ? 9877
                              : 9876.54,
                    ]);
                    await f.blur();
                    assert.equal(f.writes.length, 1);
                });

it('keeps partial drafts, exact negative comma policy, zero/null and rejects nonfinite/exponent/grouped edits', async (t) => {
    const f = await fixture(t, { separator: 'period-comma', value: 2 });
    await f.focus();
    for (const denied of [
        '-0,5',
        '-',
        'Infinity',
        'NaN',
        '1e3',
        '1.234,5',
        ' ',
        '.',
    ]) {
        await f.edit(denied);
        assert.deepEqual(f.writes, []);
        assert.equal(f.input().value, '2,00');
    }
    await f.edit('0,');
    assert.deepEqual(f.writes, [0]);
    assert.equal(f.input().value, '0,');
    await f.edit('');
    assert.deepEqual(f.writes, [0, null]);
    f.state.allowNegative = true;
    await f.render();
    await f.edit('-');
    assert.equal(f.input().value, '-');
    assert.deepEqual(f.writes, [0, null, null]);
    await f.edit('-0,5');
    assert.equal(f.writes.at(-1), -0.5);
    await f.edit('-0');
    assert.ok(Object.is(f.writes.at(-1), 0));
});

it('retains the focused DOM/caret across a value and writer echo, then formats on blur without another write', async (t) => {
    const f = await fixture(t, { value: 12.34, grouping: true });
    const node = f.input();
    await f.focus();
    await f.edit('1234.5');
    node.setSelectionRange(2, 2);
    f.state.value = 999;
    await f.render();
    assert.equal(f.input(), node);
    assert.equal(node.value, '1234.5');
    assert.equal(node.selectionStart, 2);
    assert.equal(node.selectionEnd, 2);
    assert.deepEqual(f.writes, [1234.5]);
    await f.blur();
    assert.equal(node.value, '999.00');
    assert.deepEqual(f.writes, [1234.5]);
});

it('commits deferred blur/Enter/unmount exactly once and StrictMode does not manufacture writes', async (t) => {
    const f = await fixture(t, { value: 2, deferred: true });
    assert.deepEqual(f.writes, []);
    await f.focus();
    await f.blur();
    assert.deepEqual(f.writes, []);
    await f.focus();
    await f.edit('3.5');
    assert.deepEqual(f.writes, []);
    await f.blur();
    assert.deepEqual(f.writes, [3.5]);
    await f.focus();
    await f.edit('4.5');
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                isComposing: true,
            })
        )
    );
    assert.deepEqual(f.writes, [3.5]);
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
            })
        )
    );
    assert.deepEqual(f.writes, [3.5, 4.5]);
    await f.focus();
    await f.edit('5.5');
    await f.unmount();
    assert.deepEqual(f.writes, [3.5, 4.5, 5.5]);
});

it('retires deferred intents across actual committed owner/configuration ABA and admits the fresh owner', async (t) => {
    const f = await fixture(t, { value: 2, deferred: true });
    const firstOwner = f.state.owner;
    await f.focus();
    await f.edit('17');
    f.state.owner = {};
    f.state.value = 3;
    await f.render();
    assert.equal(
        f.input().value,
        '3.00',
        'a new owner must not inherit the old draft'
    );
    f.state.owner = firstOwner;
    await f.render();
    assert.deepEqual(f.writes, []);
    await f.edit('19');
    await f.blur();
    assert.deepEqual(f.writes, [19]);
    await f.focus();
    await f.edit('21');
    f.state.readonly = true;
    await f.render();
    f.state.readonly = false;
    await f.render();
    assert.deepEqual(f.writes, [19]);
    await f.edit('23');
    await f.unmount();
    assert.deepEqual(f.writes, [19, 23]);
});

for (const kind of ['number', 'currency', 'percent'] as const)
    it(`does not allocate unchanged deferred ${kind} display on blur or subsequent unmount`, async (t) => {
        const f = await fixture(t, {
            kind,
            value: kind === 'percent' ? 0.25 : 25,
            deferred: true,
        });
        await f.focus();
        await f.edit('26.00');
        await f.edit('25.00');
        await f.blur();
        assert.deepEqual(f.writes, []);
        await f.unmount();
        assert.deepEqual(f.writes, []);
    });

it('preserves same-owner focused metadata continuity while retiring pending config ABA', async (t) => {
    const f = await fixture(t, { value: 2, deferred: true });
    await f.focus();
    await f.edit('7.');
    f.state.separator = 'period-comma';
    await f.render();
    assert.equal(f.input().value, '7.');
    f.state.separator = 'comma-period';
    await f.render();
    await f.blur();
    assert.deepEqual(f.writes, []);
    await f.focus();
    await f.edit('8.5');
    await f.blur();
    assert.deepEqual(f.writes, [8.5]);
});

it('uses current owner authority before any edit and keeps read-only mobile clear inert', async (t) => {
    const f = await fixture(t, { value: 2, mobile: true });
    await f.focus();
    f.state.current = false;
    await f.edit('3');
    assert.deepEqual(f.writes, []);
    assert.equal(f.input().value, '2.00');
    f.state.current = true;
    f.state.readonly = true;
    await f.render();
    assert.equal(f.input().disabled, true);
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    assert.equal(clear.disabled, true);
    await act(async () => clear.click());
    assert.deepEqual(f.writes, []);
    f.state.readonly = false;
    await f.render();
    await f.focus();
    await f.edit('4');
    assert.deepEqual(f.writes, [4]);
});

it('keeps empty currency symbols and empty error messages associated with the actual input', async (t) => {
    const f = await fixture(t, { kind: 'currency', value: 0, symbol: '' });
    f.state.error = '';
    await f.render();
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const ids = f.input().getAttribute('aria-describedby')?.split(' ') ?? [];
    assert.deepEqual(ids, [
        'numeric-input-currency-symbol',
        'native-description',
        'numeric-input-feedback',
    ]);
    assert.ok(f.container.querySelector('#numeric-input-currency-symbol'));
    assert.ok(f.container.querySelector('#numeric-input-feedback'));
    assert.deepEqual(f.writes, []);
});

it('preserves Percent signed zero and fractional precision instead of Number rounding', async (t) => {
    const f = await fixture(t, {
        kind: 'percent',
        value: 0,
        separator: 'period-comma',
        allowNegative: true,
    });
    await f.focus();
    await f.edit('-0,');
    assert.ok(Object.is(f.writes.at(-1), -0));
    await f.edit('-42,755');
    assert.equal(f.writes.at(-1), -42.755 / 100);
    assert.equal(f.input().value, '-42,755');
    await f.blur();
    assert.equal(f.input().value, '-42,76');
});

it('clears mobile deferred input once to canonical null with no later unmount allocation', async (t) => {
    const f = await fixture(t, { value: 1, mobile: true, deferred: true });
    await f.focus();
    await f.edit('7');
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    assert.equal(clear.type, 'button');
    await act(async () => clear.click());
    assert.deepEqual(f.writes, [null]);
    assert.equal(f.input().value, '');
    await f.unmount();
    assert.deepEqual(f.writes, [null]);
});

it('keeps percent units/progress and literal currency read-only presentation in the package', async (t) => {
    const f = await fixture(t, {
        kind: 'percent',
        value: 0.425,
        separator: 'period-comma',
        progress: true,
    });
    assert.equal(f.input().value, '42,50');
    assert.match(f.container.textContent ?? '', /42\.5%/);
    const fillWidth = () => {
        const node = f.container.querySelector(
            '.mx-sdk-localized-numeric-fill'
        );
        assert.ok(node instanceof f.window.HTMLElement);
        return node.style.width;
    };
    assert.equal(fillWidth(), '42.5%');
    await f.focus();
    await f.edit('75,25');
    assert.deepEqual(f.writes, [0.7525]);
    await f.blur();
    assert.match(f.container.textContent ?? '', /75\.25%/);
    f.options.presentation = 'display';
    f.state.value = 12.345;
    await f.render();
    assert.match(f.container.textContent ?? '', /1234,50%/);
    assert.equal(fillWidth(), '100%');
    f.state.kind = 'currency';
    f.state.symbol = '<img src=x> CHF ';
    f.state.value = -12.3;
    await f.render();
    assert.equal(f.container.querySelector('input,img'), null);
    assert.equal(f.container.textContent, '-<img src=x> CHF 12,30');
    f.state.value = null;
    await f.render();
    assert.equal(f.container.textContent, 'No value');
    assert.equal(
        f.container.querySelector('svg')?.getAttribute('aria-hidden'),
        'true'
    );
    f.state.value = 0;
    await f.render();
    assert.equal(f.container.textContent, '<img src=x> CHF 0,00');
    assert.deepEqual(f.writes, [0.7525]);
});

it('retains native readonly Linkify policy without interpreting literal symbols as markup', async (t) => {
    const f = await fixture(t, {
        kind: 'currency',
        value: 0,
        symbol: 'https://example.test/ <img src=x> ',
    });
    f.options.presentation = 'display';
    await f.render();
    const link = f.container.querySelector('a');
    assert.equal(link?.getAttribute('href'), 'https://example.test/');
    assert.equal(link?.getAttribute('target'), '_blank');
    assert.equal(f.container.querySelector('img,input'), null);
    assert.match(f.container.textContent ?? '', /<img src=x> 0\.00/);
    let bubbled = 0;
    // React delegates at the root. Observe the enclosing host, not a native
    // listener on that same root that runs before React's delegated handler.
    f.window.document.body.addEventListener('click', () => bubbled++);
    // Navigation is an external boundary; only containment/presentation is tested.
    link?.addEventListener('click', (event) => event.preventDefault());
    link?.dispatchEvent(
        new f.window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    assert.equal(bubbled, 0);
    assert.deepEqual(f.writes, []);
});

it('server-renders supplied canonical numeric props without DOM globals or writes', async () => {
    assert.equal(typeof globalThis.window, 'undefined');
    const { renderToString } = await import('react-dom/server');
    let writes = 0;
    const field = createRendererProps({
        physicalKind: 'percent',
        fieldId: 'ssr-percent',
        title: 'Progress',
        field: {
            id: 'ssr-percent',
            name: 'Progress',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'percent', options: { precision: 2 } },
        },
        displayConfig: {
            numberSeparator: 'period-comma',
            showAsProgressBar: true,
        },
        value: 0.425,
        context: 'form',
        computed: false,
        dirty: false,
        pending: false,
        validation: [],
        error: null,
        capability: {
            type: 'editable',
            setValue() {
                writes++;
                return { accepted: true };
            },
        },
    });
    assert.ok(field?.physicalKind === 'percent');
    const html = renderToString(
        h(CompleteLocalizedNumericField, {
            field,
            options: { input: { form: 'existing-native-form' } },
        })
    );
    assert.match(html, /value="42,50"/);
    assert.match(html, /42\.5%/);
    assert.match(html, /form="existing-native-form"/);
    assert.equal(writes, 0);
    assert.equal(typeof globalThis.window, 'undefined');
});
