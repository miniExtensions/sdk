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
import {
    useFileSelection,
    type FileSelectionOptions,
} from '../src/react/index.js';

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
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
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, i) => {
            if (previous[i])
                Object.defineProperty(globalThis, key, previous[i]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
    };
}

it('delivers original files in order, resets the real picker before handoff and permits same-file retry', async (t) => {
    const f = await fixture(t),
        ref = createRef<HTMLInputElement>();
    const received: File[][] = [];
    function Picker() {
        const selection = useFileSelection({
            onFiles(files) {
                assert.equal(ref.current?.value, '');
                received.push(files);
            },
        });
        return h('input', {
            ...selection.inputProps,
            ref,
            id: 'picker',
            multiple: true,
            accept: 'image/*',
            name: 'attachments',
            form: 'native-form',
            'aria-label': 'Choose files',
        });
    }
    await f.render(h(Picker));
    const input = f.container.querySelector('input')!;
    assert.equal(ref.current, input);
    assert.equal(input.type, 'file');
    assert.equal(input.multiple, true);
    assert.equal(input.accept, 'image/*');
    assert.equal(input.getAttribute('form'), 'native-form');
    assert.equal(input.getAttribute('aria-label'), 'Choose files');
    const a = new f.window.File(['a'], 'a.png', { type: 'image/png' }),
        b = new f.window.File(['b'], 'b.png', { type: 'image/png' });
    for (let i = 0; i < 2; i++) {
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [a, b],
        });
        await act(async () =>
            input.dispatchEvent(new f.window.Event('change', { bubbles: true }))
        );
    }
    assert.equal(received.length, 2);
    assert.equal(received[0]![0], a);
    assert.equal(received[0]![1], b);
    assert.equal(received[1]![0], a);
    assert.notEqual(received[0], received[1]);
    Object.defineProperty(input, 'files', { configurable: true, value: null });
    await act(async () =>
        input.dispatchEvent(new f.window.Event('change', { bubbles: true }))
    );
    assert.equal(received.length, 2);
});

it('keeps nested drag highlighting until the target is left and contains native drag/drop before handoff', async (t) => {
    const f = await fixture(t),
        received: File[][] = [];
    let parentEvents = 0;
    function Picker() {
        const selection = useFileSelection<HTMLDivElement>({
            onFiles: (files) => received.push(files),
        });
        return h(
            'div',
            { onDrop: () => parentEvents++, onDragEnter: () => parentEvents++ },
            h(
                'div',
                { ...selection.dropProps, 'data-target': 'drop' },
                h('span', { 'data-child': 'yes' }, 'Child')
            ),
            h('output', null, selection.isDragActive ? 'active' : 'idle')
        );
    }
    await f.render(h(Picker));
    const target = f.container.querySelector('[data-target]')!,
        child = f.container.querySelector('span')!;
    const drag = async (
        node: typeof target,
        type: string,
        files: File[] = []
    ) => {
        const event = new f.window.Event(type, {
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(event, 'dataTransfer', { value: { files } });
        await act(async () => node.dispatchEvent(event));
        assert.equal(event.defaultPrevented, true);
    };
    await drag(target, 'dragenter');
    await drag(child, 'dragenter');
    await drag(child, 'dragleave');
    assert.equal(f.container.querySelector('output')?.textContent, 'active');
    await drag(target, 'dragleave');
    assert.equal(f.container.querySelector('output')?.textContent, 'idle');
    await drag(target, 'dragover');
    assert.equal(f.container.querySelector('output')?.textContent, 'active');
    await drag(target, 'dragend');
    assert.equal(f.container.querySelector('output')?.textContent, 'idle');
    const file = new f.window.File(['a'], 'a.txt');
    await drag(target, 'dragenter');
    await drag(target, 'drop', [file as unknown as File]);
    assert.equal(f.container.querySelector('output')?.textContent, 'idle');
    assert.equal(received.length, 1);
    assert.equal(received[0]![0], file);
    await drag(target, 'drop');
    assert.equal(received.length, 1);
    assert.equal(parentEvents, 0);
});

it('denies disabled picker/drop intake, clears drag lifetime and uses the current owner callback', async (t) => {
    const f = await fixture(t),
        first: File[][] = [],
        second: File[][] = [];
    function Picker(props: FileSelectionOptions) {
        const selection = useFileSelection<HTMLDivElement>(props);
        return h(
            'div',
            { ...selection.dropProps },
            h('input', selection.inputProps),
            h('output', null, selection.isDragActive ? 'active' : 'idle')
        );
    }
    const file = new f.window.File(['a'], 'a.txt');
    const dispatch = async (type: string, selector: string) => {
        const node = f.container.querySelector(selector)!;
        const event = new f.window.Event(type, {
            bubbles: true,
            cancelable: true,
        });
        if (type === 'change')
            Object.defineProperty(node, 'files', {
                configurable: true,
                value: [file],
            });
        else
            Object.defineProperty(event, 'dataTransfer', {
                value: { files: [file] },
            });
        await act(async () => node.dispatchEvent(event));
    };
    await f.render(h(Picker, { onFiles: (files) => first.push(files) }));
    await dispatch('dragenter', 'div');
    await f.render(
        h(Picker, { disabled: true, onFiles: (files) => first.push(files) })
    );
    assert.equal(f.container.querySelector('output')?.textContent, 'idle');
    assert.equal(f.container.querySelector('input')?.disabled, true);
    await dispatch('dragenter', 'div');
    await dispatch('dragover', 'div');
    await dispatch('dragleave', 'div');
    await dispatch('dragend', 'div');
    await dispatch('drop', 'div');
    await dispatch('change', 'input');
    assert.equal(first.length, 0);
    await f.render(h(Picker, { onFiles: (files) => second.push(files) }));
    await dispatch('dragenter', 'div');
    await dispatch('dragleave', 'div');
    assert.equal(f.container.querySelector('output')?.textContent, 'idle');
    await dispatch('change', 'input');
    await dispatch('drop', 'div');
    assert.equal(second.length, 2);
    assert.equal(first.length, 0);
});
