import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    Component,
    createElement as h,
    createRef,
    StrictMode,
    Suspense,
    startTransition,
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

it('retires prior editor writes across semantic replacement and A-to-B-to-A', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    const writer = (value: string) => {
        writes.push(value);
    };
    const render = (value: string) =>
        f.render(
            h(NativeRichTextEditor, {
                value,
                onValueChange: writer,
                renderEditor: f.editor,
            })
        );
    await render('Original');
    const first = f.current();
    await render('Replacement');
    const second = f.current();
    await render('Original');
    let reads = 0;
    await act(async () => {
        first.onChange(() => {
            reads++;
            return 'Late original edit';
        });
        second.onChange(() => {
            reads++;
            return 'Late replacement edit';
        });
    });
    assert.equal(
        reads,
        0,
        'Retired editors must not even read a disposed document'
    );
    assert.deepEqual(writes, []);
    await act(async () => f.current().onChange(() => 'Current edit'));
    assert.deepEqual(writes, ['Current edit']);
});

it('retires captured editor writes when unmounted', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    await f.render(
        h(NativeRichTextEditor, {
            value: 'Original',
            onValueChange: (value) => writes.push(value),
            renderEditor: f.editor,
        })
    );
    const retired = f.current();
    await f.render(null);
    let reads = 0;
    await act(async () =>
        retired.onChange(() => {
            reads++;
            return 'Late edit';
        })
    );
    assert.equal(reads, 0);
    assert.deepEqual(writes, []);
});

it('does not revive a detached empty editor after the read-only null view', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    const render = (value: string | null, readOnly: boolean) =>
        f.render(
            h(NativeRichTextEditor, {
                value,
                readOnly,
                onValueChange: (value) => writes.push(value),
                renderEditor: f.editor,
            })
        );
    await render('', false);
    const retired = f.current();
    await render(null, true);
    await render('', false);
    let reads = 0;
    await act(async () =>
        retired.onChange(() => {
            reads++;
            return 'Retired empty edit';
        })
    );
    assert.equal(reads, 0);
    assert.deepEqual(writes, []);
    await act(async () => f.current().onChange(() => 'Current empty edit'));
    assert.deepEqual(writes, ['Current empty edit']);
});

it('keeps current editor callbacks on cosmetic echoes and writer changes while respecting current read-only policy', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const oldWrites: string[] = [];
    const newWrites: string[] = [];
    const render = (
        value: string,
        readOnly: boolean,
        writer: (value: string) => void
    ) =>
        f.render(
            h(NativeRichTextEditor, {
                ref,
                value,
                readOnly,
                onValueChange: writer,
                renderEditor: f.editor,
            })
        );
    await render('Original\n', false, (value) => oldWrites.push(value));
    const native = f.current();
    const instance = ref.current;
    await render('Original\n\n', false, (value) => newWrites.push(value));
    assert.equal(ref.current, instance);
    await act(async () => native.onChange(() => 'Current edit'));
    assert.deepEqual(oldWrites, []);
    assert.deepEqual(newWrites, ['Current edit']);
    // A rejected write cannot modify comparison state or read a disposed vendor.
    await render('Current edit', true, (value) => newWrites.push(value));
    let reads = 0;
    await act(async () =>
        native.onChange(() => {
            reads++;
            return 'Blocked edit';
        })
    );
    assert.equal(reads, 0);
    assert.deepEqual(newWrites, ['Current edit']);
    await render('Current edit', false, (value) => newWrites.push(value));
    assert.equal(ref.current, instance);
    await act(async () => f.current().onChange(() => 'Resumed edit'));
    assert.deepEqual(newWrites, ['Current edit', 'Resumed edit']);
});

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

it('cleans opt-in stale roots on actual attachment across null, empty and read-only/editable transitions', async (t) => {
    const f = await fixture(t),
        ref = createRef<NativeRichTextEditorHandle>();
    const render = (value: string | null, readOnly: boolean) =>
        f.render(
            h(NativeRichTextEditor, {
                value,
                readOnly,
                ref,
                removeStaleEditorRoots: true,
                onValueChange: () => assert.fail('unexpected write'),
                renderEditor: f.editor,
                emptyContent: 'Empty',
            })
        );
    for (const [value, readOnly] of [
        [null, true],
        ['', true],
        [null, true],
        [null, false],
        ['', false],
        [null, true],
        ['', true],
        ['', false],
    ] as const) {
        await render(value, readOnly);
        assert.equal(
            f.container.querySelectorAll('[data-stale]').length,
            0,
            `stale root after ${String(value)}/${readOnly}`
        );
        assert.equal(
            f.container.querySelectorAll('[data-active]').length,
            readOnly && value === null ? 0 : 1
        );
        assert.equal(ref.current === null, readOnly && value === null);
    }
});

it('releases returned callback-ref cleanups exactly once on ref replacement, semantic remount and unmount', async (t) => {
    const f = await fixture(t);
    const attachments: {
        owner: string;
        instance: NativeRichTextEditorHandle;
        released: number;
    }[] = [];
    const nullCalls: string[] = [];
    const callback =
        (owner: string) => (instance: NativeRichTextEditorHandle | null) => {
            if (instance === null) {
                nullCalls.push(owner);
                return;
            }
            const entry = { owner, instance, released: 0 };
            attachments.push(entry);
            return () => {
                entry.released++;
            };
        };
    const first = callback('first'),
        second = callback('second');
    const render = (value: string, ref: typeof first) =>
        f.render(
            h(NativeRichTextEditor, {
                value,
                ref,
                onValueChange: () => assert.fail('unexpected write'),
                renderEditor: f.editor,
            })
        );
    await render('Alpha', first);
    await render('Alpha', second);
    assert(attachments.some((item) => item.owner === 'first'));
    assert(
        attachments
            .filter((item) => item.owner === 'first')
            .every((item) => item.released === 1)
    );
    await render('Replacement', second);
    assert(attachments.filter((item) => item.owner === 'second').length >= 2);
    await f.render(null);
    assert(attachments.every((item) => item.released === 1));
    assert.deepEqual(nullCalls, []);
});

it('retains paired null-callback lifetime for legacy refs that return no cleanup', async (t) => {
    const f = await fixture(t);
    let live: NativeRichTextEditorHandle | null = null,
        attached = 0,
        detached = 0;
    const legacy = (instance: NativeRichTextEditorHandle | null) => {
        if (instance) {
            assert.equal(live, null);
            live = instance;
            attached++;
        } else {
            assert(live);
            live = null;
            detached++;
        }
    };
    const render = (value: string) =>
        f.render(
            h(NativeRichTextEditor, {
                value,
                ref: legacy,
                onValueChange: () => {},
                renderEditor: f.editor,
            })
        );
    await render('Alpha');
    await render('Replacement');
    await f.render(null);
    assert(attached >= 2);
    assert.equal(detached, attached);
    assert.equal(live, null);
});

// Independent PR229 review probes: public editor slot only; no vendor-impact claim.
it('review229: retired actual instance cannot write after same-value slot-type replacement', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const writer = (value: string) => {
        writes.push(value);
    };
    let detachedA = 0;
    class EditorA extends EditorSlotProbe {
        componentWillUnmount() {
            detachedA++;
            super.componentWillUnmount();
        }
    }
    class EditorB extends EditorSlotProbe {}
    let supplied: NativeRichTextEditorRenderProps | undefined;
    const render = (Editor: typeof EditorSlotProbe) =>
        f.render(
            h(NativeRichTextEditor, {
                ref,
                value: 'Same document',
                onValueChange: writer,
                renderEditor: (native, focused) => {
                    supplied = native;
                    return h(Editor, { native, focused });
                },
            })
        );
    await render(EditorA);
    assert(supplied);
    const retired = supplied;
    const instanceA = ref.current;
    assert(instanceA instanceof EditorA);
    const detachCountBeforeReplacement = detachedA;
    await render(EditorB);
    assert(supplied);
    const current = supplied;
    assert(ref.current instanceof EditorB);
    assert.notEqual(ref.current, instanceA);
    assert.equal(detachedA, detachCountBeforeReplacement + 1);
    let retiredReads = 0;
    await act(async () =>
        retired.onChange(() => {
            retiredReads++;
            return 'Late A document';
        })
    );
    const staleWrites = writes.splice(0);
    await act(async () => current.onChange(() => 'Current B document'));
    assert.deepEqual(writes, ['Current B document']);
    t.diagnostic(
        JSON.stringify({
            retiredReads,
            staleWrites,
            callbackReused: retired.onChange === current.onChange,
        })
    );
    assert.deepEqual(
        { retiredReads, staleWrites },
        { retiredReads: 0, staleWrites: [] }
    );
});

it('review229: child update callback respects newly committed read-only policy', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    let updateReads = 0;
    let observedReadOnly: boolean | undefined;
    let current: NativeRichTextEditorRenderProps | undefined;
    class FlushOnPolicyUpdate extends EditorSlotProbe {
        componentDidUpdate(previous: Readonly<EditorSlotProbe['props']>) {
            super.componentDidUpdate(previous);
            if (previous.native.readOnly !== this.props.native.readOnly) {
                observedReadOnly = this.props.native.readOnly;
                this.props.native.onChange(() => {
                    updateReads++;
                    return 'Transaction flushed during policy update';
                });
            }
        }
    }
    const writer = (value: string) => {
        writes.push(value);
    };
    const render = (readOnly: boolean) =>
        f.render(
            h(NativeRichTextEditor, {
                value: 'Same document',
                readOnly,
                onValueChange: writer,
                renderEditor: (native, focused) => {
                    current = native;
                    return h(FlushOnPolicyUpdate, { native, focused });
                },
            })
        );
    await render(false);
    await render(true);
    assert.equal(
        observedReadOnly,
        true,
        'The actual child has received the new policy'
    );
    assert(current);
    let settledReads = 0;
    await act(async () =>
        current?.onChange(() => {
            settledReads++;
            return 'After commit';
        })
    );
    assert.equal(settledReads, 0, 'Settled read-only behavior remains blocked');
    t.diagnostic(
        JSON.stringify({ observedReadOnly, updateReads, writes, settledReads })
    );
    assert.deepEqual({ updateReads, writes }, { updateReads: 0, writes: [] });
});

it('review229: child update callback uses the replacement writer during commit', async (t) => {
    const f = await fixture(t);
    const oldWrites: string[] = [];
    const newWrites: string[] = [];
    let updateReads = 0;
    let current: NativeRichTextEditorRenderProps | undefined;
    class FlushOnPresentationUpdate extends EditorSlotProbe {
        componentDidUpdate(previous: Readonly<EditorSlotProbe['props']>) {
            super.componentDidUpdate(previous);
            if (previous.native.placeholder !== this.props.native.placeholder) {
                this.props.native.onChange(() => {
                    updateReads++;
                    return 'Transaction flushed during writer update';
                });
            }
        }
    }
    const render = (
        placeholder: string,
        onValueChange: (value: string) => void
    ) =>
        f.render(
            h(NativeRichTextEditor, {
                value: 'Same document',
                placeholder,
                onValueChange,
                renderEditor: (native, focused) => {
                    current = native;
                    return h(FlushOnPresentationUpdate, { native, focused });
                },
            })
        );
    await render('Before', (value) => oldWrites.push(value));
    await render('After', (value) => newWrites.push(value));
    const duringCommit = {
        oldWrites: [...oldWrites],
        newWrites: [...newWrites],
        updateReads,
    };
    assert(current);
    await act(async () => current?.onChange(() => 'After commit'));
    assert.equal(
        newWrites.at(-1),
        'After commit',
        'Settled callbacks use the replacement writer'
    );
    t.diagnostic(JSON.stringify(duringCommit));
    assert.deepEqual(duringCommit, {
        oldWrites: [],
        newWrites: ['Transaction flushed during writer update'],
        updateReads: 1,
    });
});

it('keeps committed policy and rejects callbacks from a suspended replacement render', async (t) => {
    const f = await fixture(t);
    const oldWrites: string[] = [],
        newWrites: string[] = [];
    let setPending: (pending: boolean) => void = () =>
        assert.fail('not mounted');
    let committedNative: NativeRichTextEditorRenderProps | undefined;
    let pendingNative: NativeRichTextEditorRenderProps | undefined;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    function Slot({
        native,
        focused,
        pending,
    }: {
        native: NativeRichTextEditorRenderProps;
        focused: boolean;
        pending: boolean;
    }) {
        if (pending) throw wait;
        return h(EditorSlotProbe, { native, focused });
    }
    function Host() {
        const [pending, update] = useState(false);
        setPending = update;
        return h(
            Suspense,
            { fallback: h('b', null, 'Pending replacement') },
            h(NativeRichTextEditor, {
                value: 'Same document',
                readOnly: pending,
                onValueChange: pending
                    ? (value) => newWrites.push(value)
                    : (value) => oldWrites.push(value),
                renderEditor: (native, focused) => {
                    if (pending) pendingNative = native;
                    else committedNative = native;
                    return h(Slot, { native, focused, pending });
                },
            })
        );
    }
    await f.render(h(Host));
    assert(committedNative);
    const visible = committedNative;
    await act(async () => startTransition(() => setPending(true)));
    assert(pendingNative, 'The replacement actually rendered and suspended');
    assert(!f.container.textContent?.includes('Pending replacement'));
    let pendingReads = 0;
    await act(async () => {
        pendingNative?.onChange(() => {
            pendingReads++;
            return 'Uncommitted edit';
        });
        visible.onChange(() => 'Committed edit');
    });
    assert.equal(pendingReads, 0);
    assert.deepEqual(newWrites, []);
    assert.deepEqual(oldWrites, ['Committed edit']);
    await act(async () => {
        setPending(false);
        release();
    });
});

it('distinguishes actual slot types with a stable factory and admits the new mounted editor', async (t) => {
    const f = await fixture(t);
    const writes: string[] = [];
    const writer = (value: string) => {
        writes.push(value);
    };
    class EditorA extends EditorSlotProbe {}
    class EditorB extends EditorSlotProbe {
        componentDidMount() {
            super.componentDidMount();
            this.props.native.onChange(() => 'Mounted B document');
        }
    }
    let Editor: typeof EditorSlotProbe = EditorA;
    let supplied: NativeRichTextEditorRenderProps | undefined;
    const factory = (
        native: NativeRichTextEditorRenderProps,
        focused: boolean
    ) => {
        supplied = native;
        return h(Editor, { native, focused });
    };
    const render = () =>
        f.render(
            h(NativeRichTextEditor, {
                value: 'Same document',
                onValueChange: writer,
                renderEditor: factory,
            })
        );
    await render();
    assert(supplied);
    const retired = supplied;
    Editor = EditorB;
    await render();
    assert(
        writes.includes('Mounted B document'),
        'Newly attached B may flush its own mount'
    );
    writes.length = 0;
    let retiredReads = 0;
    await act(async () => {
        retired.onChange(() => {
            retiredReads++;
            return 'Late A document';
        });
        retired.onFocus();
    });
    assert.equal(retiredReads, 0);
    assert.deepEqual(writes, []);
    assert.equal(
        f.container.firstElementChild?.getAttribute('data-focused'),
        'false'
    );
    assert(supplied);
    await act(async () => supplied?.onChange(() => 'Current B document'));
    assert.deepEqual(writes, ['Current B document']);
});

it('does not revive a first actual instance through same-value slot A-to-B-to-A', async (t) => {
    const f = await fixture(t);
    const ref = createRef<NativeRichTextEditorHandle>();
    const writes: string[] = [];
    const writer = (value: string) => {
        writes.push(value);
    };
    class EditorA extends EditorSlotProbe {}
    class EditorB extends EditorSlotProbe {}
    let Editor: typeof EditorSlotProbe = EditorA;
    let supplied: NativeRichTextEditorRenderProps | undefined;
    const factory = (
        native: NativeRichTextEditorRenderProps,
        focused: boolean
    ) => {
        supplied = native;
        return h(Editor, { native, focused });
    };
    const render = () =>
        f.render(
            h(NativeRichTextEditor, {
                ref,
                value: 'Same document',
                onValueChange: writer,
                renderEditor: factory,
            })
        );
    await render();
    const firstInstance = ref.current;
    assert(supplied);
    const first = supplied;
    Editor = EditorB;
    await render();
    assert(supplied);
    const second = supplied;
    Editor = EditorA;
    await render();
    assert.notEqual(ref.current, firstInstance);
    let retiredReads = 0;
    await act(async () => {
        first.onChange(() => {
            retiredReads++;
            return 'First A document';
        });
        second.onChange(() => {
            retiredReads++;
            return 'Retired B document';
        });
    });
    assert.equal(retiredReads, 0);
    assert.deepEqual(writes, []);
    await act(async () => supplied?.onChange(() => 'Second A document'));
    assert.deepEqual(writes, ['Second A document']);
});
