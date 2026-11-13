import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    DurationField,
    CompleteDurationField,
    ReadOnlyDurationField,
    type ControlledDurationFieldProps,
} from '../src/react/index.js';

it('natural controlled Duration preserves the complete entry, SSR and explicit native associations', () => {
    const writes: (number | null)[] = [];
    const props: ControlledDurationFieldProps = {
        value: -3680.125,
        format: 'h:mm:ss.SSS',
        fieldId: 'duration',
        sessionId: 'native',
        inputId: 'elapsed',
        formId: 'native-form',
        title: 'Elapsed <time>',
        description: 'Timing help',
        error: 'Timing error',
        owner: { token: {}, isCurrent: () => false },
        onChange(value) {
            writes.push(value);
        },
    };
    const natural = renderToString(h(DurationField, props));
    assert.equal(natural, renderToString(h(CompleteDurationField, props)));
    assert.match(natural, /value="-1:01:20\.125"/);
    assert.match(natural, /for="elapsed"/);
    assert.match(natural, /form="native-form"/);
    assert.match(natural, /Elapsed &lt;time&gt;/);
    assert.deepEqual(writes, []);
});

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const previous = keys.map((key) =>
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
    const form = window.document.createElement('form');
    form.id = 'native';
    window.document.body.append(form);
    const root = createRoot(form as unknown as HTMLElement);
    let mounted = true;
    let active = true;
    let generation = {};
    let submits = 0;
    let writer = 'initial';
    const writes: { value: number | null; writer: string }[] = [];
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    let props: ControlledDurationFieldProps = {
        fieldId: 'duration',
        sessionId: 'native',
        format: 'h:mm:ss.SSS',
        value: 60,
        title: 'Elapsed',
        inputId: 'elapsed',
        formId: 'native',
        owner: owner(),
        onChange: writeFor(writer),
        clearLabel: 'Clear elapsed',
    };
    function owner() {
        const captured = generation;
        return {
            token: captured,
            isCurrent: () => active && captured === generation,
        };
    }
    function writeFor(name: string) {
        return (value: number | null) => {
            writes.push({ value, writer: name });
            props = { ...props, value };
            publish();
        };
    }
    function publish() {
        if (mounted) root.render(h(StrictMode, null, h(DurationField, props)));
    }
    const render = async () => {
        await act(async () => publish());
    };
    const input = () => {
        const node = form.querySelector('input');
        assert.ok(node);
        return node;
    };
    const edit = async (value: string) => {
        await act(async () => {
            const node = input();
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(node, value);
            node.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    const unmount = async () => {
        if (mounted) {
            mounted = false;
            await act(async () => root.unmount());
        }
    };
    t.after(async () => {
        await unmount();
        assert.equal(submits, 0);
        keys.forEach((key, index) => {
            const descriptor = previous[index];
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    await render();
    return {
        window,
        form,
        input,
        edit,
        writes,
        unmount,
        focus: async () => {
            await act(async () => input().focus());
        },
        blur: async () => {
            await act(async () => input().blur());
        },
        async patch(patch: Partial<ControlledDurationFieldProps>) {
            props = { ...props, ...patch };
            await render();
        },
        async replaceOwner(value: number, token = {}) {
            generation = token;
            writer = 'successor';
            props = {
                ...props,
                value,
                owner: owner(),
                onChange: writeFor(writer),
            };
            await render();
        },
        async retire() {
            active = false;
            await render();
        },
        get token() {
            return generation;
        },
    };
}

it('natural Duration keeps raw partial/caret echoes and writes canonical zero, seconds and null once', async (t) => {
    const f = await fixture(t);
    const input = f.input();
    await f.focus();
    await f.edit('1:');
    assert.equal(input.value, '1:');
    assert.deepEqual(f.writes, [{ value: 0, writer: 'initial' }]);
    input.setSelectionRange(1, 2);
    await f.patch({ value: 120, description: 'Cosmetic echo' });
    assert.equal(f.input(), input);
    assert.equal(input.value, '1:');
    assert.equal(input.selectionStart, 1);
    assert.equal(input.selectionEnd, 2);
    await f.blur();
    assert.equal(input.value, '2:00.000');
    assert.equal(f.writes.length, 1);
    await f.focus();
    await f.edit('7');
    assert.equal(input.value, '7');
    assert.deepEqual(f.writes.at(-1), { value: 7, writer: 'initial' });
    const clear = f.form.querySelector('button');
    assert.ok(clear);
    assert.equal(clear.type, 'button');
    await act(async () => clear.click());
    assert.equal(input.value, '');
    assert.deepEqual(f.writes.at(-1), { value: null, writer: 'initial' });
    assert.equal(f.writes.length, 3);
});

it('natural Duration keeps actual DOM focus through owner ABA and rejects retired and readonly edits', async (t) => {
    const f = await fixture(t);
    const input = f.input();
    const first = f.token;
    await f.focus();
    await f.edit('1:');
    await f.replaceOwner(90);
    assert.equal(f.input(), input);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(input.value, '1:30.000');
    await f.edit('8');
    assert.equal(input.value, '8');
    assert.deepEqual(f.writes.at(-1), { value: 8, writer: 'successor' });
    await f.replaceOwner(60, first);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(input.value, '1:00.000');
    await f.edit('9');
    assert.equal(input.value, '9');
    assert.equal(f.writes.length, 3);
    await f.patch({ readOnly: true });
    await f.edit('4');
    assert.equal(f.writes.length, 3);
    await f.patch({ readOnly: false });
    await f.retire();
    await f.edit('5');
    assert.equal(f.writes.length, 3);
    await f.unmount();
    input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(f.writes.length, 3);
});

for (const [format, expected] of [
    ['h:mm', '0:01'],
    ['h:mm:ss', '1:00'],
    ['h:mm:ss.S', '1:00.0'],
    ['h:mm:ss.SS', '1:00.00'],
    ['h:mm:ss.SSS', '1:00.000'],
] as const)
    it(`readonly Duration formats canonical seconds for ${format} without an editing authority`, () => {
        const html = renderToString(
            h(ReadOnlyDurationField, { value: 60, format, language: 'en' })
        );
        assert.ok(html.includes(`>${expected}</p>`));
        assert.doesNotMatch(html, /<input|<button|<form/);
    });

it('readonly Duration distinguishes zero, null, negatives and fractions with native presentation options', () => {
    const render = (value: number | null | undefined) =>
        renderToString(
            h(ReadOnlyDurationField, {
                value,
                format: 'h:mm:ss.SSS',
                language: 'fr',
                layout: 'cell-short',
                textSize: 'large',
                className: 'elapsed-display',
            })
        );
    assert.match(render(0), />0:00\.000<\/p>/);
    assert.match(render(-1.25), />-0:01\.250<\/p>/);
    assert.match(render(null), /Pas de Valeur/);
    assert.equal(render(null), render(undefined));
    assert.match(render(0), /elapsed-display/);
    assert.match(render(0), /data-layout="cell-short"/);
    assert.match(render(0), /text-lg/);
});

it('readonly Duration refuses unsupported runtime formats and nonfinite native values', () => {
    for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
        assert.throws(
            () =>
                renderToString(
                    h(ReadOnlyDurationField, {
                        value,
                        format: 'h:mm',
                        language: 'en',
                    })
                ),
            /finite native seconds/
        );
    assert.throws(
        () =>
            Reflect.apply(ReadOnlyDurationField, undefined, [
                { value: 0, format: 'days', language: 'en' },
            ]),
        /Unsupported Duration format/
    );
});
