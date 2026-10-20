import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    Component,
    createElement as h,
    createRef,
    StrictMode,
    useState,
    type ReactNode,
} from 'react';
import {
    NativeRichTextEditor,
    type NativeRichTextEditorHandle,
    type NativeRichTextEditorRenderProps,
} from '../src/react/index.js';

// External editor-slot ABI probe only. Real vendor/caret/paste/composition
// acceptance is qualified separately in the actual host and browser matrix.
class EditorSlotProbe extends Component<{
    native: NativeRichTextEditorRenderProps;
    focused: boolean;
    ready?: boolean;
    attachElement?: boolean;
}> {
    element: HTMLDivElement | null = null;
    view?: { dom: HTMLElement };
    private outer: HTMLDivElement | null = null;
    private active: HTMLDivElement | null = null;
    private initial = this.props.native.defaultValue;
    componentDidMount() {
        this.element = this.props.attachElement === false ? null : this.outer;
        if (this.active && this.props.ready !== false)
            this.view = { dom: this.active };
        this.props.native.ref(this);
    }
    componentDidUpdate(previous: Readonly<EditorSlotProbe['props']>) {
        if (previous.native.ref !== this.props.native.ref) {
            previous.native.ref(null);
            this.props.native.ref(this);
        }
    }
    componentWillUnmount() {
        this.props.native.ref(null);
    }
    render() {
        return h(
            'div',
            {
                ref: (node: HTMLDivElement | null) => {
                    this.outer = node;
                },
                'data-focused': String(this.props.focused),
            },
            h(
                'div',
                {
                    ref: (node: HTMLDivElement | null) => {
                        this.active = node;
                    },
                    'data-active': 'true',
                },
                this.initial
            ),
            h('div', { 'data-stale': 'true' }, 'stale slot root')
        );
    }
}

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    let native: NativeRichTextEditorRenderProps | undefined;
    return {
        container,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        editor: (props: NativeRichTextEditorRenderProps, focused: boolean) => {
            native = props;
            return h(EditorSlotProbe, { native: props, focused });
        },
        current: () => {
            assert(native);
            return native;
        },
    };
}

it('forwards the actual supplied editor instance, native syntax and focus with opt-in stale DOM cleanup', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    await f.render(
        h(NativeRichTextEditor, {
            ref,
            value: '[x] done',
            removeStaleEditorRoots: true,
            onValueChange: (v) => writes.push(v),
            placeholder: 'Native placeholder',
            renderEditor: f.editor,
        })
    );
    const instance = ref.current;
    assert(instance instanceof EditorSlotProbe);
    const active = f.container.querySelector('[data-active]');
    assert(active);
    assert.equal(instance.view?.dom, active);
    assert.equal(f.container.querySelector('[data-stale]'), null);
    assert.equal(f.container.childElementCount, 1);
    assert.equal(f.current().defaultValue, '- [x] done');
    assert.equal(f.current().placeholder, 'Native placeholder');
    assert.equal(f.current().readOnly, false);
    assert(!('value' in f.current()));
    assert.deepEqual(f.current().parsers[0].match({ content: '[x]  done ' }), {
        type: 'checkbox_list_item',
        checked: true,
        content: 'done',
    });
    assert.equal(
        f.current().serializer({
            type: 'checkbox_list_item',
            checked: false,
            content: 'open',
        }),
        '[ ] open\n'
    );
    await act(async () => f.current().onFocus());
    assert.equal(
        f.container.firstElementChild?.getAttribute('data-focused'),
        'true'
    );
    assert.equal(ref.current, instance);
    assert.equal(f.container.querySelector('[data-active]'), active);
    await act(async () => f.current().onBlur());
    assert.equal(
        f.container.firstElementChild?.getAttribute('data-focused'),
        'false'
    );
    assert.deepEqual(writes, []);
    await f.render(null);
    assert.equal(ref.current, null);
});

it('retains controlled native ownership and exact stored writes while ignoring only legacy comparison artifacts', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    function Controlled() {
        const [value, setValue] = useState<string | null>('Alpha');
        return h(NativeRichTextEditor, {
            ref,
            value,
            onValueChange: (v) => {
                writes.push(v);
                setValue(v);
            },
            renderEditor: f.editor,
        });
    }
    await f.render(h(Controlled));
    const instance = ref.current;
    const active = f.container.querySelector('[data-active]');
    await act(async () => f.current().onChange(() => '- [x] done  \n\n'));
    assert.deepEqual(writes, ['[x] done  \n\n']);
    assert.equal(ref.current, instance);
    assert.equal(f.container.querySelector('[data-active]'), active);
    await act(async () => f.current().onChange(() => '- [x] done  \n'));
    assert.deepEqual(writes, ['[x] done  \n\n']);
    assert.equal(ref.current, instance);
    await act(async () => f.current().onChange(() => '- [x] done   \n'));
    assert.deepEqual(writes, ['[x] done  \n\n', '[x] done   \n']);
    assert.equal(ref.current, instance);
});

it('retains cosmetic external updates and remounts only a semantic replacement with the current writer', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const oldWrites: string[] = [];
    const newWrites: string[] = [];
    await f.render(
        h(NativeRichTextEditor, {
            ref,
            value: 'Alpha',
            onValueChange: (v) => oldWrites.push(v),
            renderEditor: f.editor,
        })
    );
    const instance = ref.current;
    const active = f.container.querySelector('[data-active]');
    await f.render(
        h(NativeRichTextEditor, {
            ref,
            value: 'Alpha\n\n',
            onValueChange: (v) => newWrites.push(v),
            renderEditor: f.editor,
        })
    );
    assert.equal(ref.current, instance);
    assert.equal(f.container.querySelector('[data-active]'), active);
    await act(async () => f.current().onChange(() => 'Current'));
    assert.deepEqual(oldWrites, []);
    assert.deepEqual(newWrites, ['Current']);
    await f.render(
        h(NativeRichTextEditor, {
            ref,
            value: 'Replacement',
            onValueChange: (v) => newWrites.push(v),
            renderEditor: f.editor,
        })
    );
    assert.notEqual(ref.current, instance);
    assert.notEqual(f.container.querySelector('[data-active]'), active);
    assert.equal(f.current().defaultValue, 'Replacement');
    assert.deepEqual(newWrites, ['Current']);
});

it('keeps caller-owned read-only null content distinct from an empty native document', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    let renders = 0;
    const editor = (
        native: NativeRichTextEditorRenderProps,
        focused: boolean
    ) => {
        renders++;
        return f.editor(native, focused);
    };
    await f.render(
        h(NativeRichTextEditor, {
            ref,
            value: null,
            readOnly: true,
            onValueChange: () => assert.fail('unexpected write'),
            renderEditor: editor,
            emptyContent: h('strong', null, 'Localized no value'),
        })
    );
    assert.equal(renders, 0);
    assert.equal(ref.current, null);
    assert.equal(f.container.textContent, 'Localized no value');
    await f.render(
        h(NativeRichTextEditor, {
            ref,
            value: '',
            readOnly: true,
            onValueChange: () => assert.fail('unexpected write'),
            renderEditor: editor,
        })
    );
    assert(renders > 0);
    const readCurrentRef = (): NativeRichTextEditorHandle | null => ref.current;
    assert(readCurrentRef() instanceof EditorSlotProbe);
    assert.equal(f.current().readOnly, true);
    assert.equal(f.current().defaultValue, '');
});

it('forwards callback refs and safely leaves an initializing editor without a view untouched', async (t) => {
    const f = await fixture(t);
    const instances: (NativeRichTextEditorHandle | null)[] = [];
    await f.render(
        h(NativeRichTextEditor, {
            removeStaleEditorRoots: true,
            ref: (instance) => instances.push(instance),
            value: null,
            onValueChange: () => assert.fail('unexpected write'),
            renderEditor: (native, focused) =>
                h(EditorSlotProbe, { native, focused, ready: false }),
        })
    );
    assert(instances.some((instance) => instance instanceof EditorSlotProbe));
    assert(f.container.querySelector('[data-stale]'));
    await f.render(
        h(NativeRichTextEditor, {
            removeStaleEditorRoots: true,
            value: 'Fresh',
            onValueChange: () => assert.fail('unexpected write'),
            renderEditor: (native, focused) =>
                h(EditorSlotProbe, { native, focused, attachElement: false }),
        })
    );
    assert(f.container.querySelector('[data-active]'));
    await f.render(null);
    assert.equal(instances.at(-1), null);
});

it('preserves caller sibling DOM by default', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(NativeRichTextEditor, {
            value: 'Caller content',
            onValueChange: () => {},
            renderEditor: f.editor,
        })
    );
    assert(f.container.querySelector('[data-active]'));
    assert(f.container.querySelector('[data-stale]'));
});
