import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window, type HTMLInputElement as HappyInput } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    type ComponentProps,
} from 'react';
import {
    CompleteDurationField,
    useDurationInputAdapter,
} from '../src/react/index.js';
import { renderToString } from 'react-dom/server';
import type { DurationFormat } from '../src/formulas/index.js';

type DurationProps = ComponentProps<typeof CompleteDurationField>;
type AdapterProps = Parameters<typeof useDurationInputAdapter>[0];

it('server-renders the complete clock without a DOM, effects, CSS import or canonical write', () => {
    assert.equal(typeof document, 'undefined');
    const writes: (number | null)[] = [];
    const html = renderToString(
        h(CompleteDurationField, {
            fieldId: 'duration-ssr',
            sessionId: 'session-ssr',
            format: 'h:mm:ss.SSS',
            value: -3680.125,
            title: 'Duration <script>',
            description: 'Synthetic timing help',
            error: 'Synthetic error',
            owner: { token: {}, isCurrent: () => true },
            onChange(value) {
                writes.push(value);
            },
        })
    );
    assert.match(html, /value="-1:01:20\.125"/);
    assert.match(html, /form="form-session-ssr"/);
    assert.match(html, /Duration &lt;script&gt;/);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /mx-sdk-complete-duration-clock/);
    assert.deepEqual(writes, []);
    assert.equal(typeof document, 'undefined');
});

async function dom(t: TestContext, inShadow = false) {
    const window = new Window();
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
    container.id = 'form-duration-session';
    if (inShadow) {
        const host = window.document.createElement('div');
        window.document.body.append(host);
        host.attachShadow({ mode: 'open' }).append(container);
    } else window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    let mounted = true;
    let submits = 0;
    container.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        await unmount();
        assert.equal(submits, 0, 'Duration editing and Clear must not submit');
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        root,
        container,
        unmount,
        isMounted: () => mounted,
    };
}

async function fixture(
    t: TestContext,
    initial: Partial<DurationProps> = {},
    inShadow = false
) {
    const d = await dom(t, inShadow);
    const writes: (number | null)[] = [];
    let current = true;
    let props: DurationProps = {
        fieldId: 'duration',
        sessionId: 'duration-session',
        format: 'h:mm:ss.SSS',
        value: 60,
        owner: { token: {}, isCurrent: () => current },
        onChange(value) {
            writes.push(value);
            props = { ...props, value };
            publish();
        },
        ...initial,
    };
    const publish = () => {
        if (d.isMounted())
            d.root.render(h(StrictMode, null, h(CompleteDurationField, props)));
    };
    const render = async () => {
        await act(async () => publish());
    };
    const input = () => {
        const node = d.container.querySelector('input');
        assert.ok(node, 'the real complete Duration input must be mounted');
        return node;
    };
    const edit = async (text: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                d.window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(input(), text);
            input().dispatchEvent(
                new d.window.Event('input', { bubbles: true })
            );
        });
    };
    await render();
    return {
        ...d,
        writes,
        input,
        edit,
        render,
        get props() {
            return props;
        },
        async update(patch: Partial<DurationProps>) {
            props = { ...props, ...patch };
            await render();
        },
        setCurrent(value: boolean) {
            current = value;
        },
        async focus() {
            await act(async () => input().focus());
        },
        async blur() {
            await act(async () => input().blur());
        },
    };
}

const formatCases: {
    format: DurationFormat;
    initial: string;
    seconds: number;
    after: string;
}[] = [
    { format: 'h:mm', initial: '0:01', seconds: 420, after: '0:07' },
    { format: 'h:mm:ss', initial: '1:00', seconds: 7, after: '0:07' },
    { format: 'h:mm:ss.S', initial: '1:00.0', seconds: 7, after: '0:07.0' },
    { format: 'h:mm:ss.SS', initial: '1:00.00', seconds: 7, after: '0:07.00' },
    {
        format: 'h:mm:ss.SSS',
        initial: '1:00.000',
        seconds: 7,
        after: '0:07.000',
    },
];

for (const { format, initial, seconds, after } of formatCases)
    it(`complete native Duration keeps bare units, controlled seconds and blur formatting for ${format}`, async (t) => {
        const f = await fixture(t, { format });
        assert.equal(f.input().value, initial);
        assert.equal(f.input().placeholder, format);
        assert.ok(
            f.input().id,
            'a standalone input receives a stable generated ID'
        );
        assert.equal(f.input().form, f.container);
        assert.deepEqual(f.writes, []);
        assert.equal(f.container.querySelector('button'), null);
        await f.focus();
        await f.edit('7');
        assert.equal(f.input().value, '7');
        assert.deepEqual(f.writes, [seconds]);
        await f.blur();
        assert.equal(f.input().value, after);
        assert.deepEqual(f.writes, [seconds]);
    });

it('keeps native 1: and negative-sign drafts while writing zero, then formats without another write', async (t) => {
    const f = await fixture(t);
    await f.focus();
    for (const draft of ['1:', '-', ':']) {
        await f.edit(draft);
        assert.equal(f.input().value, draft);
        assert.equal(f.writes.at(-1), 0);
    }
    assert.deepEqual(f.writes, [0, 0, 0]);
    await f.blur();
    assert.equal(f.input().value, '0:00.000');
    assert.deepEqual(f.writes, [0, 0, 0]);
});

it('refuses invalid/nonfinite text without changing the controlled draft or native answer', async (t) => {
    const f = await fixture(t);
    await f.focus();
    for (const rejected of [
        'invalid-clock',
        '.',
        '1e3',
        '1,5',
        '1.1234',
        '1:02.1234',
        ' 7',
        'NaN',
        'Infinity',
        '9'.repeat(400),
    ]) {
        await f.edit(rejected);
        assert.equal(f.input().value, '1:00.000', rejected);
        assert.deepEqual(f.writes, [], rejected);
    }
    await f.edit('-1:01:20.125');
    assert.equal(f.input().value, '-1:01:20.125');
    assert.deepEqual(f.writes, [-3680.125]);
});

it('retains focused draft, input identity and caret across value/writer echoes and equivalent metadata', async (t) => {
    const f = await fixture(t);
    const node = f.input();
    await f.focus();
    await f.edit('1:20.125');
    node.setSelectionRange(3, 5);
    const successorWrites: (number | null)[] = [];
    await f.update({
        value: 999,
        format: 'h:mm:ss.SSS',
        placeholder: 'Equivalent metadata',
        onChange(value) {
            successorWrites.push(value);
        },
    });
    assert.equal(f.input(), node);
    assert.equal(f.window.document.activeElement, node);
    assert.equal(node.value, '1:20.125');
    assert.equal(node.selectionStart, 3);
    assert.equal(node.selectionEnd, 5);
    assert.deepEqual(f.writes, [80.125]);
    assert.deepEqual(successorWrites, []);
    await f.edit('2:01.125');
    assert.deepEqual(successorWrites, [121.125]);
    await f.blur();
    // The controlled external value remains authoritative; a writer need not echo.
    assert.equal(node.value, '16:39.000');
    assert.deepEqual(successorWrites, [121.125]);
});

it('re-reads controlled seconds on blur without an echo and accepts a later resting echo without writing', async (t) => {
    const accepted: (number | null)[] = [];
    const f = await fixture(t, {
        value: 60,
        onChange(value) {
            accepted.push(value);
        },
    });
    assert.equal(f.input().value, '1:00.000');
    await f.focus();
    await f.edit('7');
    assert.equal(f.input().value, '7');
    assert.equal(f.props.value, 60);
    assert.deepEqual(accepted, [7]);
    await f.blur();
    assert.equal(f.input().value, '1:00.000');
    assert.deepEqual(accepted, [7]);
    await f.update({ value: 7 });
    assert.equal(f.input().value, '0:07.000');
    assert.deepEqual(accepted, [7]);
    assert.deepEqual(f.writes, []);
});

it('does not give a replacement native owner the previous focused draft, including observed owner ABA', async (t) => {
    const f = await fixture(t);
    const firstOwner = f.props.owner;
    await f.focus();
    await f.edit('17');
    assert.deepEqual(f.writes, [17]);
    assert.equal(f.input().value, '17');
    await f.update({
        value: 80,
        owner: { token: {}, isCurrent: () => true },
    });
    assert.equal(f.input().value, '1:20.000');
    assert.deepEqual(f.writes, [17]);
    await f.update({ value: 60, owner: firstOwner });
    assert.equal(f.input().value, '1:00.000');
    await f.focus();
    await f.edit('19');
    assert.deepEqual(f.writes, [17, 19]);
});

it('refreshes a real format successor in place without reinterpreting old focused text or writing', async (t) => {
    const f = await fixture(t, { format: 'h:mm', value: 120 });
    const node = f.input();
    await f.focus();
    await f.edit('2');
    node.setSelectionRange(0, 1);
    assert.deepEqual(f.writes, [120]);
    await f.update({ format: 'h:mm' });
    assert.equal(node.value, '2');
    assert.equal(node.selectionStart, 0);
    assert.equal(node.selectionEnd, 1);
    await f.update({ format: 'h:mm:ss' });
    assert.equal(f.input(), node);
    assert.equal(f.window.document.activeElement, node);
    assert.equal(node.value, '2:00');
    assert.deepEqual(f.writes, [120]);
    await f.edit('2:01');
    assert.deepEqual(f.writes, [120, 121]);
    await f.blur();
    assert.equal(node.value, '2:01');
    assert.deepEqual(f.writes, [120, 121]);
});

it('refreshes an unfocused/read-only format without enabling edits or manufacturing writes', async (t) => {
    const f = await fixture(t, {
        format: 'h:mm',
        value: 120,
        readOnly: true,
    });
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().value, '0:02');
    await f.update({ format: 'h:mm:ss.SSS', value: 120.125 });
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().value, '2:00.125');
    await f.edit('7');
    assert.deepEqual(f.writes, []);
    await f.update({ readOnly: false });
    await f.focus();
    await f.edit('7');
    assert.deepEqual(f.writes, [7]);
});

it('preserves null versus zero and opt-in Clear is a non-submit native null write', async (t) => {
    const f = await fixture(t, { value: null, clearLabel: 'Clear effort' });
    assert.equal(f.input().value, '');
    await f.focus();
    await f.edit('0');
    assert.deepEqual(f.writes, [0]);
    await f.blur();
    assert.equal(f.input().value, '0:00.000');
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    assert.equal(clear.type, 'button');
    assert.equal(clear.getAttribute('aria-label'), 'Clear effort');
    await act(async () => clear.click());
    assert.equal(f.input().value, '');
    assert.deepEqual(f.writes, [0, null]);
    await f.edit('');
    assert.equal(f.props.value, null);
});

it('retains native input/form/label/help/error associations and supplied input ref', async (t) => {
    const inputRef = { current: null as HTMLInputElement | null };
    const f = await fixture(t, {
        title: 'Effort',
        showLabel: true,
        inputId: 'native-duration',
        formId: 'form-duration-session',
        placeholder: 'Hours and minutes',
        description: h('span', null, 'Native duration help'),
        error: 'A duration is required',
        invalid: true,
        describedBy: 'external-duration-help',
        inputRef,
    });
    const node = f.input();
    assert.equal(node.id, 'native-duration');
    assert.equal(node.form, f.container);
    assert.equal(node.type, 'text');
    assert.equal(node.autocomplete, 'off');
    assert.equal(node.placeholder, 'Hours and minutes');
    assert.equal(node.getAttribute('aria-invalid'), 'true');
    assert.equal(inputRef.current, node);
    const label = f.container.querySelector('label');
    assert.ok(label);
    assert.equal(label.htmlFor, node.id);
    assert.equal(label.textContent, 'Effort');
    const describedBy = node.getAttribute('aria-describedby')?.split(/\s+/);
    assert.ok(describedBy?.includes('external-duration-help'));
    assert.match(f.container.textContent ?? '', /Native duration help/);
    assert.match(f.container.textContent ?? '', /A duration is required/);
    assert.equal(f.container.querySelector('button'), null);
    assert.deepEqual(f.writes, []);
});

it('honors explicit writer refusal and current owner policy without a fallback write', async (t) => {
    let attempts = 0;
    const f = await fixture(t, {
        onChange() {
            attempts++;
            return false;
        },
    });
    await f.focus();
    await f.edit('7');
    assert.equal(attempts, 1);
    assert.equal(f.input().value, '1:00.000');
    f.setCurrent(false);
    await f.edit('8');
    assert.equal(attempts, 1);
    assert.deepEqual(f.writes, []);
});

it('public hook retains only committed current actions through field/session/format/owner ABA and unmount', async (t) => {
    const d = await dom(t);
    const writes: (number | null)[] = [];
    const successorWrites: (number | null)[] = [];
    const originalOwner = {};
    let current = true;
    let props: AdapterProps = {
        fieldId: 'duration-A',
        sessionId: 'duration-session-A',
        format: 'h:mm:ss.SSS',
        value: 60,
        onChange(value) {
            writes.push(value);
        },
        owner: { token: originalOwner, isCurrent: () => current },
    };
    const observed: {
        adapter?: ReturnType<typeof useDurationInputAdapter>;
    } = {};
    function Probe() {
        observed.adapter = useDurationInputAdapter(props);
        return null;
    }
    const read = () => {
        assert.ok(observed.adapter);
        return observed.adapter;
    };
    const publish = async () => {
        await act(async () => d.root.render(h(StrictMode, null, h(Probe))));
    };
    await publish();
    assert.deepEqual(writes, []);
    const original = read();
    props = {
        ...props,
        value: 80,
        onChange(value) {
            successorWrites.push(value);
        },
    };
    await publish();
    assert.equal(read(), original);
    act(() => assert.equal(original.setInput('7'), true));
    assert.deepEqual(writes, []);
    assert.deepEqual(successorWrites, [7]);
    props = { ...props, readOnly: true };
    await publish();
    act(() => assert.equal(original.setInput('8'), false));
    assert.equal(original.canEdit(), false);
    props = { ...props, readOnly: false };
    await publish();

    const replacements: Partial<AdapterProps>[] = [
        { fieldId: 'duration-B' },
        { sessionId: 'duration-session-B' },
        { format: 'h:mm' },
        { owner: { token: {}, isCurrent: () => current } },
    ];
    for (const replacement of replacements) {
        const retained = read();
        const previous = props;
        props = { ...props, ...replacement };
        await publish();
        props = previous;
        await publish();
        assert.equal(retained.isCurrent(), false);
        act(() => assert.equal(retained.setInput('9'), false));
        act(() => assert.equal(read().setInput('10'), true));
    }
    assert.deepEqual(successorWrites, [7, 10, 10, 10, 10]);
    const beforeRetirement = read();
    current = false;
    act(() => assert.equal(beforeRetirement.setInput('11'), false));
    assert.equal(beforeRetirement.canEdit(), false);
    assert.deepEqual(successorWrites, [7, 10, 10, 10, 10]);
    await d.unmount();
    act(() => assert.equal(beforeRetirement.setInput('12'), false));
    assert.deepEqual(successorWrites, [7, 10, 10, 10, 10]);
});

it('StrictMode remount and a genuine unmount do not write, and unmount retires retained hook actions', async (t) => {
    const d = await dom(t);
    const writes: (number | null)[] = [];
    const props: AdapterProps = {
        fieldId: 'duration',
        sessionId: 'duration-session',
        format: 'h:mm:ss',
        value: null,
        owner: { token: {}, isCurrent: () => true },
        onChange(value) {
            writes.push(value);
        },
    };
    let captured: ReturnType<typeof useDurationInputAdapter> | undefined;
    function Probe() {
        captured = useDurationInputAdapter(props);
        return h(CompleteDurationField, props);
    }
    await act(async () => d.root.render(h(StrictMode, null, h(Probe))));
    assert.ok(captured);
    const live = captured;
    assert.equal(live.isCurrent(), true);
    assert.deepEqual(writes, []);
    await d.unmount();
    assert.equal(live.isCurrent(), false);
    assert.equal(live.canEdit(), false);
    assert.equal(live.setInput('7'), false);
    assert.deepEqual(writes, []);
});

function retainedInputCallbacks(input: HappyInput) {
    const key = Object.keys(input).find((name) =>
        name.startsWith('__reactProps$')
    );
    const props: unknown = key ? Reflect.get(input, key) : null;
    assert.ok(props != null && typeof props === 'object');
    assert.ok('onChange' in props && typeof props.onChange === 'function');
    assert.ok('onBlur' in props && typeof props.onBlur === 'function');
    const change = props.onChange;
    const blur = props.onBlur;
    return {
        change: (text: string) =>
            change({ target: { value: text }, currentTarget: input }),
        blur: () => blur({ target: input, currentTarget: input }),
    };
}

for (const scope of ['row', 'parent'] as const)
    it(`retains actual DOM focus through observed ${scope} owner replacement/ABA and one controlled successor edit`, async (t) => {
        const firstToken = { scope, generation: 1 };
        const secondToken = { scope, generation: 2 };
        let currentToken = firstToken;
        const firstOwner = {
            token: firstToken,
            isCurrent: () => currentToken === firstToken,
        };
        const secondOwner = {
            token: secondToken,
            isCurrent: () => currentToken === secondToken,
        };
        const f = await fixture(t, { owner: firstOwner });
        const commit = f.props.onChange;
        const calls: { writer: string; value: number | null }[] = [];
        const writer =
            (name: string): DurationProps['onChange'] =>
            (value) => {
                calls.push({ writer: name, value });
                return commit(value);
            };
        await f.update({ onChange: writer('first') });
        const node = f.input();
        await f.focus();
        await f.edit('17');
        const stale = retainedInputCallbacks(node);
        currentToken = secondToken;
        await f.update({
            owner: secondOwner,
            value: 80,
            onChange: writer('second'),
        });
        assert.equal(f.input(), node);
        assert.equal(f.window.document.activeElement, node);
        assert.equal(
            node.value,
            '1:20.000',
            'new owner resets the previous raw draft'
        );
        await act(async () => stale.change('9'));
        assert.deepEqual(f.writes, [17]);

        currentToken = firstToken;
        await f.update({
            owner: firstOwner,
            value: 60,
            onChange: writer('successor'),
        });
        assert.equal(f.input(), node);
        assert.equal(f.window.document.activeElement, node);
        assert.equal(node.value, '1:00.000');
        await act(async () => stale.change('10'));
        assert.deepEqual(
            f.writes,
            [17],
            'old callback remains retired after token ABA'
        );
        let focusEvents = 0;
        node.addEventListener('focus', () => {
            focusEvents++;
        });
        await f.focus();
        assert.equal(
            focusEvents,
            0,
            'already-focused input has no new focus transition'
        );
        await f.edit('8');
        assert.equal(
            node.value,
            '8',
            'current canonical echo must retain the raw draft'
        );
        node.setSelectionRange(0, 1);
        await f.update({
            value: 8,
            placeholder: 'Equivalent successor metadata',
        });
        assert.equal(node.value, '8');
        assert.equal(node.selectionStart, 0);
        assert.equal(node.selectionEnd, 1);
        await act(async () => stale.blur());
        assert.equal(node.value, '8', 'old blur cannot reformat the successor');
        assert.deepEqual(calls, [
            { writer: 'first', value: 17 },
            { writer: 'successor', value: 8 },
        ]);
        await f.blur();
        assert.equal(node.value, '0:08.000');
        assert.deepEqual(f.writes, [17, 8]);
        const retainedSuccessor = retainedInputCallbacks(node);
        await f.unmount();
        await act(async () => retainedSuccessor.change('11'));
        assert.deepEqual(
            f.writes,
            [17, 8],
            'unmount never writes or admits retained intent'
        );
    });

it('keeps a genuine blur/refocus control through current owner replacement', async (t) => {
    const f = await fixture(t);
    const node = f.input();
    await f.focus();
    await f.update({ value: 80, owner: { token: {}, isCurrent: () => true } });
    assert.equal(f.window.document.activeElement, node);
    await f.blur();
    assert.notEqual(f.window.document.activeElement, node);
    await f.focus();
    await f.edit('8');
    assert.equal(node.value, '8');
    assert.deepEqual(f.writes, [8]);
    await f.blur();
    assert.equal(node.value, '0:08.000');
    assert.deepEqual(f.writes, [8]);
});

it('refreshes disabled current-owner values without treating retained focus as write authority', async (t) => {
    const f = await fixture(t);
    await f.focus();
    await f.edit('7');
    await f.update({
        owner: { token: {}, isCurrent: () => true },
        value: 120,
        readOnly: true,
    });
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().value, '2:00.000');
    await f.edit('8');
    assert.deepEqual(f.writes, [7]);
    await f.update({ value: 130 });
    assert.equal(f.input().value, '2:10.000');
    await f.update({ readOnly: false });
    await f.focus();
    await f.edit('9');
    assert.equal(f.input().value, '9');
    assert.deepEqual(f.writes, [7, 9]);
});

it('keeps object and callback input refs current across ref replacement and unmount', async (t) => {
    const first: (HTMLInputElement | null)[] = [];
    const second: (HTMLInputElement | null)[] = [];
    const f = await fixture(t, {
        inputRef: (node) => {
            first.push(node);
        },
    });
    const node = f.input();
    assert.equal(first.at(-1), node);
    await f.update({
        inputRef: (next) => {
            second.push(next);
        },
    });
    assert.equal(first.at(-1), null);
    assert.equal(second.at(-1), node);
    const object = { current: null as HTMLInputElement | null };
    await f.update({ inputRef: object });
    assert.equal(second.at(-1), null);
    assert.equal(object.current, node);
    await f.unmount();
    assert.equal(object.current, null);
});

it('uses the actual focus root for a shadow-hosted clock and retained owner replacement', async (t) => {
    const f = await fixture(t, {}, true);
    const node = f.input();
    await f.focus();
    const focusRoot = node.getRootNode();
    assert.ok('activeElement' in focusRoot);
    assert.equal(focusRoot.activeElement, node);
    assert.notEqual(f.window.document.activeElement, node);
    await f.edit('7');
    assert.equal(node.value, '7');
    assert.deepEqual(f.writes, [7]);
    await f.update({ value: 80, owner: { token: {}, isCurrent: () => true } });
    assert.equal(f.input(), node);
    assert.equal(focusRoot.activeElement, node);
    assert.equal(node.value, '1:20.000');
    await f.edit('8');
    assert.equal(node.value, '8');
    node.setSelectionRange(0, 1);
    await f.update({ value: 8 });
    assert.equal(node.selectionStart, 0);
    assert.equal(node.selectionEnd, 1);
    await f.blur();
    assert.equal(node.value, '0:08.000');
    assert.deepEqual(f.writes, [7, 8]);
});
