import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ReactNode,
} from 'react';
import { renderToString } from 'react-dom/server';
import { TextareaInput, type TextareaInputProps } from '../src/react/index.js';

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLTextAreaElement',
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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const render = async (value: ReactNode) => {
        await act(async () => root.render(h(StrictMode, null, value)));
    };
    const textarea = () => {
        const node = container.querySelector('textarea');
        assert(node);
        return node;
    };
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            const descriptor = previous[index];
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return { window, container, render, textarea };
}

it('forwards native textarea/ref, host form/ARIA and controlled edits without adding markup', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLTextAreaElement>();
    const edits: string[] = [];
    const composition: string[] = [];
    let parentChanges = 0;
    const view = (value: string) =>
        h(
            'div',
            {
                onChange: () => {
                    parentChanges++;
                },
            },
            h('form', { id: 'host' }),
            h('label', { htmlFor: 'notes' }, 'Notes'),
            h(TextareaInput, {
                ref,
                id: 'notes',
                name: 'notes',
                form: 'host',
                value,
                rows: 4,
                maxLength: 100,
                className: 'host',
                placeholder: 'Write',
                'aria-describedby': 'help',
                'aria-invalid': true,
                onChange: (event) => {
                    assert.equal(event.currentTarget, ref.current);
                    edits.push(event.currentTarget.value);
                },
                onCompositionStart: (event) => composition.push(event.type),
                onCompositionEnd: (event) => composition.push(event.type),
            })
        );
    await f.render(view('literal <b>\n  draft'));
    assert.equal(ref.current, f.textarea());
    assert.equal(f.textarea().form?.id, 'host');
    assert.equal(f.textarea().getAttribute('rows'), '4');
    assert.equal(f.textarea().getAttribute('maxlength'), '100');
    assert.equal(f.textarea().className, 'host');
    assert.equal(f.textarea().getAttribute('aria-describedby'), 'help');
    assert.equal(f.textarea().getAttribute('aria-invalid'), 'true');
    assert.equal(f.textarea().style.height, '');
    await act(async () => {
        f.textarea().focus();
        f.textarea().setSelectionRange(2, 5, 'backward');
        for (const type of ['compositionstart', 'compositionend'])
            f.textarea().dispatchEvent(
                new f.window.CompositionEvent(type, {
                    bubbles: true,
                })
            );
        Object.getOwnPropertyDescriptor(
            f.window.HTMLTextAreaElement.prototype,
            'value'
        )!.set!.call(f.textarea(), 'edited\nvalue');
        f.textarea().dispatchEvent(
            new f.window.Event('input', { bubbles: true })
        );
    });
    assert.deepEqual(edits, ['edited\nvalue']);
    assert.equal(parentChanges, 1);
    assert.deepEqual(composition, ['compositionstart', 'compositionend']);
    // Rejected owner updates restore the controlled native draft without another edit.
    assert.equal(f.textarea().value, 'literal <b>\n  draft');
    const original = f.textarea();
    original.setSelectionRange(1, 4, 'backward');
    await f.render(view('literal <b>\n  draft'));
    assert.equal(f.textarea(), original);
    assert.equal(f.window.document.activeElement, original);
    assert.equal(original.selectionStart, 1);
    assert.equal(original.selectionEnd, 4);
    await f.render(null);
    assert.equal(ref.current, null);
});

// Happy DOM has no layout. Only the browser's scrollHeight measurement boundary
// is substituted; the production sizing, effects, refs and listeners run intact.
function layout(f: Awaited<ReturnType<typeof fixture>>) {
    const prototype = f.window.HTMLTextAreaElement.prototype;
    const previous = Object.getOwnPropertyDescriptor(prototype, 'scrollHeight');
    let reads = 0;
    let zero = false;
    Object.defineProperty(prototype, 'scrollHeight', {
        configurable: true,
        get() {
            reads++;
            if (zero) return 0;
            const node = this as HTMLTextAreaElement;
            return node.value.split('\n').length * 20 + 8;
        },
    });
    return {
        get reads() {
            return reads;
        },
        zero: () => {
            zero = true;
        },
        restore: () => {
            if (previous)
                Object.defineProperty(prototype, 'scrollHeight', previous);
            else Reflect.deleteProperty(prototype, 'scrollHeight');
        },
    };
}
const sizingStyle = {
    boxSizing: 'border-box',
    paddingTop: 4,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    width: 200,
} as const;

it('sizes min/content/max rows, shrinks, uses placeholders and releases every measurement node', async (t) => {
    const f = await fixture(t);
    const boundary = layout(f);
    t.after(boundary.restore);
    const render = (value: string, extra: Partial<TextareaInputProps> = {}) =>
        f.render(
            h(TextareaInput, {
                value,
                onChange: () => {},
                autoSize: { minRows: 3, maxRows: 30 },
                style: sizingStyle,
                ...extra,
            })
        );
    await render('');
    assert.equal(f.textarea().style.height, '70px');
    await render(Array(8).fill('line').join('\n'));
    assert.equal(f.textarea().style.height, '170px');
    const long = Array(45).fill('line').join('\n');
    await render(long);
    assert.equal(f.textarea().style.height, '610px');
    assert.equal(f.textarea().value, long);
    await render('short');
    assert.equal(f.textarea().style.height, '70px');
    await render('', { placeholder: Array(7).fill('hint').join('\n') });
    assert.equal(f.textarea().style.height, '150px');
    await render('a\nb\nc\nd', {
        style: { ...sizingStyle, boxSizing: 'content-box' },
    });
    assert.equal(f.textarea().style.height, '80px');
    assert.equal(f.window.document.querySelectorAll('textarea').length, 1);
    boundary.zero();
    await render('unmeasurable');
    assert.equal(f.window.document.querySelectorAll('textarea').length, 1);
    assert.equal(f.textarea().style.height, '80px');
});

it('keeps native node/focus/caret across opt-in changes, updates resize/font listeners and restores owned height', async (t) => {
    const f = await fixture(t);
    const boundary = layout(f);
    t.after(boundary.restore);
    const fonts = new f.window.EventTarget();
    Object.defineProperty(f.window.document, 'fonts', {
        configurable: true,
        value: fonts,
    });
    let edits = 0;
    const view = (autoSize?: TextareaInputProps['autoSize']) =>
        h(TextareaInput, {
            value: 'a\nb\nc\nd\ne',
            onChange: () => {
                edits++;
            },
            autoSize,
            style: { ...sizingStyle, height: 44 },
        });
    await f.render(view());
    const original = f.textarea();
    original.focus();
    original.setSelectionRange(1, 4, 'backward');
    assert.equal(boundary.reads, 0);
    assert.equal(original.style.height, '44px');
    await f.render(view({ minRows: 3, maxRows: 30 }));
    assert.equal(f.textarea(), original);
    assert.equal(original.style.height, '110px');
    assert.equal(original.selectionStart, 1);
    assert.equal(original.selectionEnd, 4);
    assert.equal(f.window.document.activeElement, original);
    await f.render(view({ minRows: 3, maxRows: 4 }));
    assert.equal(original.style.height, '90px');
    const before = boundary.reads;
    await act(async () => {
        f.window.dispatchEvent(new f.window.Event('resize'));
        fonts.dispatchEvent(new f.window.Event('loadingdone'));
    });
    assert(boundary.reads > before);
    // A manual resize persists until the content's measured height changes.
    original.style.height = '240px';
    await f.render(view({ minRows: 3, maxRows: 4 }));
    assert.equal(original.style.height, '240px');
    await f.render(view());
    assert.equal(original.style.height, '240px');
    const stopped = boundary.reads;
    f.window.dispatchEvent(new f.window.Event('resize'));
    fonts.dispatchEvent(new f.window.Event('loadingdone'));
    assert.equal(boundary.reads, stopped);
    assert.equal(edits, 0);
    await f.render(view({ minRows: 3, maxRows: 30 }));
    assert.equal(original.style.height, '110px');
    await f.render(view());
    assert.equal(original.style.height, '240px');
    await f.render(null);
    const removed = boundary.reads;
    f.window.dispatchEvent(new f.window.Event('resize'));
    fonts.dispatchEvent(new f.window.Event('loadingdone'));
    assert.equal(boundary.reads, removed);
});

it('does not size hidden/unmeasurable nodes and leaves disabled/read-only policy with the caller', async (t) => {
    const f = await fixture(t);
    const boundary = layout(f);
    t.after(boundary.restore);
    await f.render(
        h(TextareaInput, {
            value: 'protected',
            disabled: true,
            readOnly: true,
            autoSize: {},
            style: { ...sizingStyle, display: 'none' },
        })
    );
    assert.equal(boundary.reads, 0);
    assert.equal(f.textarea().disabled, true);
    assert.equal(f.textarea().readOnly, true);
    assert.equal(f.textarea().value, 'protected');
    await f.render(
        h(TextareaInput, {
            value: 'protected',
            autoSize: {},
            onChange: () => {},
        })
    );
    assert.equal(boundary.reads, 0);
});

it('preserves SSR native rows and rejects incompatible autosizing configuration explicitly', () => {
    assert.match(
        renderToString(
            h(TextareaInput, {
                value: 'literal\ntext',
                rows: 4,
                onChange: () => {},
            })
        ),
        /rows="4"/
    );
    assert.match(
        renderToString(
            h(TextareaInput, {
                value: 'literal',
                rows: 4,
                autoSize: { minRows: 3, maxRows: 30 },
                onChange: () => {},
            })
        ),
        /rows="4"/
    );
    for (const autoSize of [
        { minRows: 0 },
        { minRows: 1.5 },
        { maxRows: 0 },
        { maxRows: NaN },
        { minRows: 4, maxRows: 3 },
    ])
        assert.throws(
            () => renderToString(h(TextareaInput, { value: '', autoSize })),
            { name: 'RangeError', message: /positive integer rows/ }
        );
    for (const style of [{ minHeight: 20 }, { maxHeight: 20 }])
        assert.throws(
            () =>
                renderToString(
                    h(TextareaInput, { value: '', autoSize: {}, style })
                ),
            { name: 'Error', message: /Use autoSize/ }
        );
});

it('restores its owned height after fractional CSS measurements without retaining hidden draft nodes', async (t) => {
    const f = await fixture(t);
    const boundary = layout(f);
    t.after(boundary.restore);
    const style = {
        ...sizingStyle,
        height: 44,
        paddingTop: 3.3,
        paddingBottom: 3.3,
        borderTopWidth: 0.2,
        borderBottomWidth: 0.2,
    };
    await f.render(
        h(TextareaInput, {
            value: 'draft',
            onChange: () => {},
            style,
            autoSize: { minRows: 3, maxRows: 30 },
        })
    );
    assert.notEqual(f.textarea().style.height, '44px');
    await f.render(
        h(TextareaInput, { value: 'draft', onChange: () => {}, style })
    );
    assert.equal(f.textarea().style.height, '44px');
    assert.equal(f.window.document.querySelectorAll('textarea').length, 1);
});
