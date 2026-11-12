import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    useState,
    type ReactNode,
    type RefObject,
} from 'react';
import {
    CompleteRichTextEditor,
    type CompleteRichTextEditorProps,
} from '../src/react/CompleteRichTextEditor.js';
import {
    RichTextField,
    type ControlledRichTextFieldProps,
} from '../src/react/index.js';
import type { NativeRichTextEditorHandle } from '../src/react/NativeRichTextEditor.js';
import type { Editor } from '../vendor/rich-markdown-editor/sdk-runtime.js';

// Only the browser's missing geometry is supplied here. The editor, document,
// transactions, clipboard handlers, serialization and React portals are real.
function installLayout(window: Window, document: Document) {
    const rect: DOMRect = {
        bottom: 10,
        height: 10,
        left: 0,
        right: 10,
        top: 0,
        width: 10,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    };
    const rects: DOMRectList = {
        0: rect,
        length: 1,
        item: (index) => (index === 0 ? rect : null),
        [Symbol.iterator]: () => [rect][Symbol.iterator](),
    };
    for (const prototype of [
        window.Range.prototype,
        window.Element.prototype,
        window.Node.prototype,
    ]) {
        Object.defineProperty(prototype, 'getClientRects', {
            configurable: true,
            value: () => rects,
        });
        Object.defineProperty(prototype, 'getBoundingClientRect', {
            configurable: true,
            value: () => rect,
        });
    }
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: () =>
            document.querySelector('[role="textbox"]') ?? document.body,
    });
}

export function ControlledCompleteEditor({
    initial = null,
    writes,
    editorRef,
    ...props
}: Omit<CompleteRichTextEditorProps, 'value' | 'onValueChange'> & {
    initial?: string | null;
    writes: string[];
    editorRef: RefObject<NativeRichTextEditorHandle>;
}) {
    const [value, setValue] = useState(initial);
    return h(CompleteRichTextEditor, {
        ...props,
        ref: editorRef,
        value,
        onValueChange: (stored) => {
            writes.push(stored);
            setValue(stored);
        },
    });
}

/** Ordinary canonical consumption; the public field requires no editor ref or slot. */
export function ControlledCanonicalRichTextField({
    initial = null,
    writes,
    ...props
}: Omit<ControlledRichTextFieldProps, 'value' | 'onValueChange'> & {
    initial?: string | null;
    writes: string[];
}) {
    const [value, setValue] = useState(initial);
    return h(RichTextField, {
        ...props,
        value,
        onValueChange: (stored) => {
            writes.push(stored);
            setValue(stored);
        },
    });
}

export async function completeRichTextFixture(t: TestContext) {
    const window = new Window({ url: 'https://editor.synthetic.invalid/' });
    const document = window.document as unknown as Document;
    const keys = [
        'window',
        'document',
        'navigator',
        'Node',
        'Text',
        'Element',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'Document',
        'DocumentFragment',
        'ShadowRoot',
        'Range',
        'MutationObserver',
        'DOMParser',
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'innerHeight',
        'innerWidth',
        'pageXOffset',
        'pageYOffset',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys) {
        const value =
            key === 'IS_REACT_ACT_ENVIRONMENT'
                ? true
                : key === 'getComputedStyle'
                  ? window.getComputedStyle.bind(window)
                  : key === 'requestAnimationFrame'
                    ? window.requestAnimationFrame.bind(window)
                    : key === 'cancelAnimationFrame'
                      ? window.cancelAnimationFrame.bind(window)
                      : window[key as keyof Window];
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    installLayout(window, document);
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    t.after(async () => {
        try {
            await act(async () => root.unmount());
            container.remove();
        } finally {
            await window.happyDOM.close();
            keys.forEach((key, index) => {
                const original = originals[index];
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            });
        }
    });

    return {
        container,
        document,
        window,
        async render(node: ReactNode) {
            await act(async () => root.render(h(StrictMode, null, node)));
            // Yield to the real browser-only dynamic import, observing readiness
            // instead of substituting the runtime or waiting an arbitrary time.
            for (let turn = 0; turn < 100; turn++) {
                if (!container.querySelector('.me-rich-text[aria-busy="true"]'))
                    return;
                await act(async () => {
                    await new Promise<void>((resolve) => setImmediate(resolve));
                });
            }
            assert.fail('The real lazy editor did not finish mounting');
        },
        async editor(ref: RefObject<NativeRichTextEditorHandle>) {
            const { Editor } = await import(
                '../vendor/rich-markdown-editor/sdk-runtime.js'
            );
            assert(ref.current instanceof Editor, 'Expected the real editor');
            assert(ref.current.view && !ref.current.view.isDestroyed);
            assert.equal(ref.current.view.dom.getAttribute('role'), 'textbox');
            return ref.current;
        },
        async select(view: Editor['view'], from: number, to = from) {
            const { TextSelection } = await import(
                '../vendor/rich-markdown-editor/sdk-runtime.js'
            );
            await act(async () => {
                view.dispatch(
                    view.state.tr.setSelection(
                        TextSelection.create(view.state.doc, from, to)
                    )
                );
                view.focus();
            });
        },
        async paste(
            view: Editor['view'],
            data: Record<string, string>,
            extraTypes: string[] = []
        ) {
            const event = new window.Event('paste', {
                bubbles: true,
                cancelable: true,
            });
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    types: [...Object.keys(data), ...extraTypes],
                    files: [],
                    items: [],
                    getData: (type: string) => data[type] ?? '',
                },
            });
            await act(async () => {
                view.dom.dispatchEvent(event as unknown as Event);
            });
            return event;
        },
    };
}
