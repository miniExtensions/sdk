import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
    AirtableForm,
    renderMultipleAttachmentsField,
} from '../src/react/index.js';
import type { AirtableAttachment } from '../src/runtime/index.js';
import type { FormPageOwner, FormPageSnapshot } from '../src/forms/index.js';
import type {
    FieldRendererHost,
    FieldRendererHostSnapshot,
    FieldRendererProps,
    FormRenderScope,
    FormRenderSnapshot,
} from '../src/ui/index.js';

// Test-local native owner port, not a proposed public SDK API. The host retains
// snapshot identity, validation and canonical writes. There is no Save capability.
interface NativePort {
    getSnapshot(): NativeSnapshot;
    subscribe(notify: () => void): () => void;
    write(expected: NativeSnapshot, value: AirtableAttachment[]): boolean;
}
interface NativeSnapshot {
    revision: number;
    owner: string;
    value: AirtableAttachment[];
}
const first = { id: 'att_a', url: 'https://example.test/a', filename: 'A.txt' };
const second = {
    id: 'att_b',
    url: 'https://example.test/b',
    filename: 'B.txt',
};
function nativeOwner() {
    let snapshot: NativeSnapshot = {
        revision: 0,
        owner: 'A',
        value: [first, second],
    };
    let writes = 0;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of [...listeners]) listener();
    };
    const publish = (
        owner: string,
        value: AirtableAttachment[],
        emit = true
    ) => {
        snapshot = { revision: snapshot.revision + 1, owner, value };
        if (emit) notify();
    };
    const port: NativePort = {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        write: (expected, value) => {
            if (snapshot !== expected) return false;
            writes++;
            publish(snapshot.owner, value);
            return true;
        },
    };
    return {
        port,
        publish,
        notify,
        writes: () => writes,
        listeners: () => listeners.size,
    };
}

// A handwritten public rendering scope: no FormDraftStore, bindings/controller
// constructor, client, reset, Save or native-owner disposal. Only a single
// existing-attachment field is supported; chooser/upload operations are inert and are not acceptance coverage.
function borrowedScope(port: NativePort) {
    let disposed = false;
    const listeners = new Set<() => void>();
    const subscribe = (notify: () => void) => {
        listeners.add(notify);
        const stop = port.subscribe(notify);
        return () => {
            listeners.delete(notify);
            stop();
        };
    };
    const retire = () => {
        if (disposed) return;
        disposed = true;
        for (const notify of [...listeners]) notify();
    };
    const revision = () => port.getSnapshot().revision * 2 + Number(disposed);
    let latest: FieldRendererProps<'multipleAttachments'> | undefined;
    const fieldSnapshot = (): FieldRendererHostSnapshot => {
        if (disposed)
            return { status: 'retired', reason: 'Rendering scope disposed' };
        const captured = port.getSnapshot();
        const remove = (index: number) => {
            if (
                disposed ||
                port.getSnapshot() !== captured ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= captured.value.length
            )
                return false;
            return port.write(
                captured,
                captured.value.filter((_, i) => i !== index)
            );
        };
        const config = {
            type: 'multipleAttachments' as const,
            options: { isReversed: false },
        };
        latest = {
            physicalKind: 'multipleAttachments',
            presentation: { type: 'physical', config },
            fieldId: 'fld_files',
            title: 'Files',
            field: {
                id: 'fld_files',
                name: 'Files',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config,
            },
            displayConfig: {},
            writeConfig: {},
            value: captured.value,
            context: 'form',
            computed: false,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: {
                type: 'editable',
                setValue: (value) =>
                    !disposed && port.write(captured, [...(value ?? [])])
                        ? { accepted: true }
                        : { accepted: false, reason: 'retired' },
                attachment: {
                    state: {
                        valuesRevision: captured.revision,
                        revision: captured.revision,
                        presentation: 'ready',
                        rows: captured.value.map((value, nativeIndex) => ({
                            nativeIndex,
                            label: value.filename ?? 'Attachment',
                            removeAllowed: true,
                            openAllowed: false,
                            downloadAllowed: false,
                        })),
                        phase: 'idle',
                        files: [],
                        busy: false,
                        error: null,
                        retired: false,
                    },
                    remove,
                    select: () => false,
                    clear: () => {},
                    upload: async () => false,
                    cancel: () => {},
                },
            },
        };
        return { status: 'ready', fields: [latest] };
    };
    const fieldHost: FieldRendererHost = {
        getSnapshot: fieldSnapshot,
        subscribe: (listener) => subscribe(() => listener(fieldSnapshot())),
        dispose: retire,
    };
    const page = (): FormPageSnapshot => ({
        revision: revision(),
        status: disposed ? 'retired' : 'ready',
        pages: [
            {
                title: null,
                description: null,
                fieldIds: ['fld_files'],
                hidden: false,
            },
        ],
        activePageIndex: 0,
        currentFieldIds: disposed ? [] : ['fld_files'],
        canBack: false,
        canNext: false,
        canSubmit: false,
        canReview: false,
        reviewing: false,
        problems: [],
    });
    const pages: FormPageOwner = {
        getSnapshot: page,
        subscribe: (listener) => subscribe(() => listener(page())),
        back: () => ({ accepted: false, reason: 'no-page' }),
        next: () => ({ accepted: false, reason: 'no-page' }),
        submit: async () => {
            throw new Error(
                'Native Save is not granted to this rendering scope'
            );
        },
        dispose: retire,
    };
    const snapshot = (): FormRenderSnapshot => {
        const capturedPage = page();
        return {
            revision: revision(),
            retired: disposed,
            page: capturedPage,
            fields: disposed ? [] : [{ fieldId: 'fld_files', host: fieldHost }],
            status: 'ready',
            canSave: false,
            errorMessage: null,
            validationErrors: [],
            actions: {
                back: () => pages.back(capturedPage.revision),
                next: () => pages.next(capturedPage.revision),
                submit: pages.submit.bind(pages, capturedPage.revision),
            },
        };
    };
    const scope: FormRenderScope = {
        pages,
        ownsPages: true,
        getSnapshot: snapshot,
        subscribe: (listener) => subscribe(() => listener(snapshot())),
        destroy: retire,
    };
    return {
        scope,
        latest: () => {
            assert.ok(latest);
            return latest;
        },
    };
}

async function environment(t: TestContext) {
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
                    : Reflect.get(window, key),
        });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        container,
        render: async (node: ReactNode) => act(async () => root.render(node)),
        remove: async () => {
            const button = container.querySelector<HTMLButtonElement>(
                'button[data-attachment-row]'
            );
            assert.ok(button);
            await act(async () => button.click());
        },
    };
}
function element(scope: FormRenderScope) {
    return h(AirtableForm, {
        scope,
        renderers: { renderMultipleAttachmentsField },
        children: (state) =>
            h(
                'main',
                { 'data-can-save': String(state.canSave) },
                ...state.fields.map((field) => field.node)
            ),
    });
}
function editable(field: FieldRendererProps<'multipleAttachments'>) {
    assert.equal(field.capability.type, 'editable');
    if (field.capability.type !== 'editable')
        throw new Error('Expected editable field');
    assert.ok(field.capability.attachment);
    return field.capability;
}

it('handwritten scope renders the native owner through AirtableForm and the attachment slot without acquiring Save', async (t) => {
    const dom = await environment(t),
        native = nativeOwner(),
        borrowed = borrowedScope(native.port);
    await dom.render(element(borrowed.scope));
    assert.match(dom.container.textContent ?? '', /A.txt/);
    assert.match(dom.container.textContent ?? '', /B.txt/);
    assert.equal(dom.container.querySelector('main')?.dataset.canSave, 'false');
    const retained = editable(borrowed.latest());
    await dom.remove();
    assert.deepEqual(native.port.getSnapshot().value, [second]);
    assert.equal(native.writes(), 1);
    assert.doesNotMatch(dom.container.textContent ?? '', /A.txt/);
    assert.equal(retained.attachment?.remove(0), false);
    assert.deepEqual(retained.setValue([]), {
        accepted: false,
        reason: 'retired',
    });
    assert.equal(native.writes(), 1);
    const nativeState = native.port.getSnapshot();
    await dom.render(null);
    assert.equal(native.listeners(), 0);
    assert.equal(native.port.getSnapshot(), nativeState);
    await dom.render(element(borrowed.scope));
    assert.match(dom.container.textContent ?? '', /B.txt/);
    await dom.remove();
    assert.deepEqual(native.port.getSnapshot().value, []);
    assert.equal(native.writes(), 2);
});

for (const mode of ['owner ABA', 'value ABA'] as const) {
    it(`rejects retained attachment and direct writes after ${mode} before React publication`, async (t) => {
        const dom = await environment(t),
            native = nativeOwner(),
            borrowed = borrowedScope(native.port);
        await dom.render(element(borrowed.scope));
        const retained = editable(borrowed.latest());
        const initial = native.port.getSnapshot();
        native.publish(mode === 'owner ABA' ? 'B' : 'A', [second], false);
        native.publish('A', initial.value, false);
        const current = native.port.getSnapshot();
        assert.equal(current.owner, initial.owner);
        assert.equal(current.value, initial.value);
        assert.ok(current.revision > initial.revision);
        await dom.remove();
        assert.equal(native.port.getSnapshot(), current);
        assert.equal(native.writes(), 0);
        assert.equal(retained.attachment?.remove(0), false);
        assert.deepEqual(retained.setValue([]), {
            accepted: false,
            reason: 'retired',
        });
        assert.equal(native.writes(), 0);
        assert.equal(native.port.getSnapshot(), current);
        await act(async () => native.notify());
        await dom.remove();
        assert.deepEqual(native.port.getSnapshot().value, [second]);
        assert.equal(native.writes(), 1);
    });
}

it('retires a detached rendering scope without disposing the native owner or granting stale writes', async (t) => {
    const dom = await environment(t),
        native = nativeOwner(),
        borrowed = borrowedScope(native.port);
    await dom.render(element(borrowed.scope));
    const retained = editable(borrowed.latest());
    const original = native.port.getSnapshot();
    await dom.render(null);
    borrowed.scope.destroy();
    assert.equal(native.listeners(), 0);
    assert.equal(retained.attachment?.remove(0), false);
    assert.deepEqual(retained.setValue([]), {
        accepted: false,
        reason: 'retired',
    });
    assert.equal(native.port.getSnapshot(), original);
    assert.equal(native.writes(), 0);
    const successor = borrowedScope(native.port);
    await dom.render(element(successor.scope));
    await dom.remove();
    assert.deepEqual(native.port.getSnapshot().value, [second]);
    assert.equal(native.writes(), 1);
});
