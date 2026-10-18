import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    MultipleAttachmentsField,
    renderMultipleAttachmentsField,
} from '../src/react/MultipleAttachmentsField.js';
import {
    AirtableForm,
    AirtableGrid,
    AirtableList,
    FieldRenderer,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import type { FormAttachmentSnapshot } from '../src/forms/attachmentController.js';
import { createFormFieldRendererHost } from '../src/ui/rendererHosts.js';
import { createFormRenderScope } from '../src/ui/formRenderScope.js';
import { createPortalRenderScope } from '../src/ui/portalRenderScope.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import type {
    AttachmentRendererActions,
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import {
    createMiniExtensionsClient,
    type UploadFileResult,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const unavailable = 'Attachment presentation unavailable';
const masked = '••••••••';
const literalLabel =
    '  <img src=x onerror=alert(1)> 雪 https://private.invalid\r\n  ';
const stored = {
    id: 'att_existing',
    url: 'https://files.example.test/PRIVATE_URL',
    filename: 'PRIVATE_existing.txt',
    type: 'text/plain',
    size: 5,
    thumbnails: {
        small: {
            url: 'https://files.example.test/PRIVATE_THUMBNAIL',
            width: 10,
            height: 10,
        },
    },
};
type Props = FieldRendererProps<'multipleAttachments'>;
type Fixture = Awaited<ReturnType<typeof domFixture>>;

async function domFixture(t: TestContext) {
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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container as unknown as HTMLElement);
    let mounted = true;
    t.after(async () => {
        if (mounted) await act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        async render(node: ReactNode) {
            if (!mounted) {
                root = createRoot(container as unknown as HTMLElement);
                mounted = true;
            }
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        async unmount() {
            if (mounted) await act(async () => root.unmount());
            mounted = false;
        },
        button(label: string) {
            const button = [...container.querySelectorAll('button')].find(
                (node) => node.textContent === label
            );
            assert.ok(button, `Expected ${label} button`);
            return button;
        },
        input() {
            const input = container.querySelector('input');
            assert.ok(input, 'Expected native file input');
            return input;
        },
    };
}

function fake(
    options: {
        state?: Partial<FormAttachmentSnapshot>;
        actions?: Partial<AttachmentRendererActions>;
        props?: Partial<Props>;
    } = {}
) {
    const calls = {
        select: [] as readonly File[][],
        remove: [] as number[],
        clear: 0,
        upload: 0,
        cancel: 0,
        native: 0,
        setter: 0,
    };
    const state: FormAttachmentSnapshot = {
        valuesRevision: 7,
        revision: 3,
        presentation: 'ready',
        rows: [
            {
                nativeIndex: 4,
                label: literalLabel,
                removeAllowed: true,
                openAllowed: true,
                downloadAllowed: true,
            },
            {
                nativeIndex: 9,
                label: literalLabel,
                removeAllowed: false,
                openAllowed: true,
                downloadAllowed: true,
            },
        ],
        phase: 'idle',
        files: [],
        busy: false,
        error: null,
        retired: false,
        ...options.state,
    };
    const actions: AttachmentRendererActions = {
        state,
        select: (files) => {
            (calls.select as File[][]).push([...files]);
            return true;
        },
        remove: (index) => {
            calls.remove.push(index);
            return true;
        },
        clear: () => {
            calls.clear++;
        },
        upload: async () => {
            calls.upload++;
            return true;
        },
        cancel: () => {
            calls.cancel++;
        },
        ...options.actions,
    };
    const capability = {
        type: 'editable' as const,
        attachment: actions,
        get setValue(): never {
            calls.setter++;
            throw Error('PRIVATE setter must not be read');
        },
    };
    const props: Props = {
        physicalKind: 'multipleAttachments',
        presentation: {
            type: 'physical',
            config: {
                type: 'multipleAttachments',
                options: { isReversed: false },
            },
        },
        fieldId: 'fld_files',
        title: 'Supplied attachments',
        field: {
            id: 'fld_files',
            name: 'Files',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleAttachments',
                options: { isReversed: false },
            },
        },
        displayConfig: {},
        writeConfig: {},
        value: undefined,
        context: 'form',
        computed: false,
        dirty: false,
        pending: false,
        validation: [],
        error: null,
        capability,
        ...options.props,
    };
    Object.defineProperty(props, 'value', {
        configurable: true,
        get() {
            calls.native++;
            throw Error('PRIVATE native value must not be read');
        },
    });
    return { props, state, actions, calls };
}

function inert(f: Fixture, expected = unavailable) {
    assert.ok(
        f.container.textContent?.includes(expected),
        f.container.textContent ?? ''
    );
    assert.equal(
        f.container.querySelector(
            'button,input,a,img,video,canvas,iframe,object,embed'
        ),
        null
    );
    assert.equal(f.container.innerHTML.includes('PRIVATE'), false);
    assert.equal(f.container.textContent?.includes(literalLabel), false);
}

async function pick(f: Fixture, files: readonly File[], input = f.input()) {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () =>
        input.dispatchEvent(
            new f.window.Event('change', { bubbles: true, cancelable: true })
        )
    );
}

function pendingFile(f: Fixture, name = 'PRIVATE_queued.txt') {
    return new f.window.File(['content'], name, {
        type: 'text/plain',
    }) as unknown as File;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

async function realForm(
    t: TestContext,
    config: FieldConfig<'multipleAttachments'> = {},
    values = [stored, stored]
) {
    const f = await domFixture(t);
    const loaded = loadedForm();
    const schema = loaded.payload.fieldIdsToSchemas.fld_files;
    if (schema.fieldType !== 'multipleAttachments')
        throw Error('Expected attachment schema');
    schema.miniExtConfig = { hideFieldIfEmpty: false, ...config };
    loaded.payload.formRecord.data.fld_files = values;
    const counters = { requests: 0, uploads: [] as File[], saves: 0 };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        session: { visitor: 'A' },
        fetch: async () => {
            counters.requests++;
            throw Error('No network');
        },
    });
    let uploadResult: (file: File) => Promise<UploadFileResult> = async (
        file
    ) => ({
        id: null,
        url: 'https://files.example.test/PRIVATE_uploaded',
        filename: file.name,
        type: file.type,
        size: file.size,
    });
    client.attachments.uploadFile = async ({ file }) => {
        counters.uploads.push(file as File);
        return uploadResult(file as File);
    };
    client.forms.save = async () => {
        counters.saves++;
        throw Error('Explicit Save remains outside this adapter');
    };
    const scope = { current: true, configuration: 0, owner: 'A' };
    const owner = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: scope.owner, revision: 0 }),
    });
    const recovery = {
        journal: new RecoveryJournal(),
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal' as const,
        },
        loadVersion: 1,
    };
    const controller = owner.attachment('fld_files', recovery);
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_files',
        attachmentRecovery: recovery,
        isCurrent: () => scope.current,
        configurationRevision: () => scope.configuration,
    });
    t.after(() => {
        host.dispose();
        owner.destroy();
        assert.equal(counters.requests, 0);
        assert.equal(counters.saves, 0);
    });
    return {
        ...f,
        loaded,
        schema,
        owner,
        controller,
        recovery,
        host,
        client,
        counters,
        scope,
        setUpload(next: typeof uploadResult) {
            uploadResult = next;
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderMultipleAttachmentsField },
                fallback: () => null,
            }),
        props(): Props {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'multipleAttachments'
            )
                throw Error('Expected attachment props');
            return snapshot.fields[0];
        },
    };
}

it('renders only filtered labels in supplied order, preserves duplicates and delegates the native index', async (t) => {
    const f = await domFixture(t);
    const value = fake();
    for (const row of value.state.rows)
        for (const property of ['url', 'filename', 'attachment', 'thumbnails'])
            Object.defineProperty(row, property, {
                get() {
                    throw Error(`PRIVATE ${property}`);
                },
            });
    await f.render(
        h(MultipleAttachmentsField, {
            field: value.props,
            className: 'custom-attachments',
        })
    );
    const rows = [...f.container.querySelectorAll('li')];
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(row.textContent?.includes(literalLabel));
    assert.equal(f.container.querySelector('img,a,video,canvas'), null);
    assert.ok(f.container.querySelector('.custom-attachments'));
    const remove = rows.map((row) => row.querySelector('button')!);
    assert.equal(remove[0].disabled, false);
    assert.equal(remove[1].disabled, true);
    await act(async () => remove[0].click());
    await act(async () => remove[1].click());
    assert.deepEqual(value.calls.remove, [4]);
    assert.equal(value.calls.native, 0);
    assert.equal(value.calls.setter, 0);
});

it('helper and component use the same native multiple picker and explicit guarded actions', async (t) => {
    const f = await domFixture(t);
    const selected = pendingFile(f);
    const value = fake({ state: { phase: 'selected', files: [selected] } });
    await f.render(renderMultipleAttachmentsField(value.props));
    assert.equal(f.input().multiple, true);
    assert.equal(f.button('Upload next file').getAttribute('type'), 'button');
    for (const button of f.container.querySelectorAll('button'))
        assert.equal(button.type, 'button');
    assert.equal(f.container.textContent?.includes(selected.name), false);
    assert.match(f.container.textContent ?? '', /1 pending file/);
    await pick(f, [selected]);
    assert.equal(value.calls.select.length, 1);
    assert.equal(value.calls.select[0][0], selected);
    assert.equal(value.calls.upload, 0);
    await act(async () => f.button('Upload next file').click());
    assert.equal(value.calls.upload, 1);
    await act(async () => f.button('Clear pending files').click());
    assert.equal(value.calls.clear, 1);
    assert.equal(value.calls.native + value.calls.setter, 0);
});

it('does not inspect pending File members or native content when reporting queue length', async (t) => {
    const f = await domFixture(t);
    let reads = 0;
    const file = new Proxy(
        {},
        {
            get() {
                reads++;
                throw Error('PRIVATE File metadata');
            },
        }
    ) as File;
    const value = fake({ state: { files: [file, file], phase: 'selected' } });
    await f.render(renderMultipleAttachmentsField(value.props));
    assert.match(f.container.textContent ?? '', /2 pending files/);
    assert.equal(reads, 0);
    assert.equal(value.calls.native + value.calls.setter, 0);
});

for (const property of [
    'obscurePassword',
    'maskPasswordOnLoginScreen',
] as const)
    for (const target of ['displayConfig', 'writeConfig'] as const)
        for (const flag of [true, 'true', 1, {}])
            it(`masks ${target}.${property}=${JSON.stringify(flag)} before capability or native access`, async (t) => {
                const f = await domFixture(t);
                const value = fake({
                    props: { [target]: { [property]: flag } as never },
                });
                let reads = 0;
                Object.defineProperty(value.props, 'capability', {
                    get() {
                        reads++;
                        throw Error('PRIVATE facet');
                    },
                });
                await f.render(renderMultipleAttachmentsField(value.props));
                inert(f, masked);
                assert.equal(reads, 0);
                assert.equal(value.calls.native + value.calls.setter, 0);
            });

for (const target of ['displayConfig', 'writeConfig'] as const)
    it(`a throwing ${target} password accessor fails closed without capability access`, async (t) => {
        const f = await domFixture(t);
        const value = fake({
            props: {
                [target]: {
                    get obscurePassword(): never {
                        throw Error('PRIVATE config');
                    },
                },
            },
        });
        let reads = 0;
        Object.defineProperty(value.props, 'capability', {
            get() {
                reads++;
                throw Error('PRIVATE facet');
            },
        });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
        assert.equal(reads, 0);
        assert.equal(value.calls.native, 0);
    });

const noneditable: Array<[string, Partial<Props>]> = [
    ['readonly capability', { capability: { type: 'readonly' } }],
    ['computed Form field', { computed: true }],
    [
        'computed presentation',
        { presentation: { type: 'computed-result', config: null } },
    ],
    ['Portal cell', { context: 'portal-cell' }],
    ['Portal detail', { context: 'portal-detail' }],
    ['linked detail', { context: 'linked-detail' }],
    ['display readonly', { displayConfig: { readOnly: true } }],
    ['write readonly', { writeConfig: { readOnly: true } }],
];
for (const [name, props] of noneditable)
    it(`${name} is an inert generic fallback without native counts or labels`, async (t) => {
        const f = await domFixture(t);
        const value = fake({ props });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
        assert.equal(value.calls.native + value.calls.setter, 0);
        assert.deepEqual(value.calls.remove, []);
    });

for (const facet of [undefined, null, {}, { state: null }, { state: {} }])
    it(`missing or malformed attachment facet is inert: ${JSON.stringify(facet)}`, async (t) => {
        const f = await domFixture(t);
        const value = fake();
        Object.defineProperty(value.props.capability, 'attachment', {
            value: facet,
        });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
        assert.equal(value.calls.native + value.calls.setter, 0);
    });

for (const property of ['capability', 'attachment', 'state'] as const)
    it(`throwing ${property} getter is contained without a native fallback`, async (t) => {
        const f = await domFixture(t);
        const value = fake();
        const target =
            property === 'capability'
                ? value.props
                : property === 'attachment'
                  ? value.props.capability
                  : value.actions;
        Object.defineProperty(target, property, {
            get() {
                throw Error(`PRIVATE ${property}`);
            },
        });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
        assert.equal(value.calls.native, 0);
    });

const malformedSnapshots: Array<[string, Partial<FormAttachmentSnapshot>]> = [
    ['unknown phase', { phase: 'unknown' as never }],
    ['string busy flag', { busy: 'false' as never }],
    ['invalid queue revision', { revision: -1 }],
    ['invalid values revision', { valuesRevision: NaN }],
    ['non-array rows', { rows: {} as never }],
    ['sparse rows', { rows: new Array(2) }],
    ['non-array pending queue', { files: {} as never }],
    ['sparse pending queue', { files: new Array(2) }],
    [
        'invalid row native index',
        {
            rows: [
                {
                    nativeIndex: -1,
                    label: 'PRIVATE',
                    removeAllowed: true,
                    openAllowed: false,
                    downloadAllowed: false,
                },
            ],
        },
    ],
    [
        'invalid row label',
        {
            rows: [
                {
                    nativeIndex: 0,
                    label: {} as never,
                    removeAllowed: true,
                    openAllowed: false,
                    downloadAllowed: false,
                },
            ],
        },
    ],
    [
        'invalid remove flag',
        {
            rows: [
                {
                    nativeIndex: 0,
                    label: 'PRIVATE',
                    removeAllowed: 'yes' as never,
                    openAllowed: false,
                    downloadAllowed: false,
                },
            ],
        },
    ],
    [
        'duplicate native indexes',
        {
            rows: [
                {
                    nativeIndex: 0,
                    label: 'PRIVATE',
                    removeAllowed: true,
                    openAllowed: false,
                    downloadAllowed: false,
                },
                {
                    nativeIndex: 0,
                    label: 'PRIVATE',
                    removeAllowed: true,
                    openAllowed: false,
                    downloadAllowed: false,
                },
            ],
        },
    ],
];
for (const [name, state] of malformedSnapshots)
    it(`malformed filtered snapshot fails closed: ${name}`, async (t) => {
        const f = await domFixture(t);
        const value = fake({ state });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
        assert.equal(value.calls.native + value.calls.setter, 0);
    });

for (const property of ['rows', 'files', 'phase', 'busy', 'error'] as const)
    it(`throwing filtered ${property} accessor fails closed`, async (t) => {
        const f = await domFixture(t);
        const value = fake();
        Object.defineProperty(value.state, property, {
            get() {
                throw Error('PRIVATE state');
            },
        });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
        assert.equal(value.calls.native, 0);
    });

it('malformed required actions cannot expose partially working controls', async (t) => {
    const f = await domFixture(t);
    for (const property of ['select', 'clear', 'remove', 'upload', 'cancel']) {
        const value = fake();
        Object.defineProperty(value.actions, property, {
            value: 'not callable',
        });
        await f.render(renderMultipleAttachmentsField(value.props));
        inert(f);
    }
});

it('contains thrown and rejected actions without rendering private error details or using setters', async (t) => {
    const f = await domFixture(t);
    const selected = pendingFile(f);
    const value = fake({
        state: { phase: 'selected', files: [selected] },
        actions: {
            select() {
                throw Error('PRIVATE selection failure');
            },
            clear() {
                throw Error('PRIVATE clear failure');
            },
            remove() {
                throw Error('PRIVATE remove failure');
            },
            upload: async () => {
                throw Error('PRIVATE upload failure');
            },
        },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    await pick(f, [selected]);
    await act(async () => f.button('Remove attachment').click());
    await act(async () => f.button('Clear pending files').click());
    await act(async () => f.button('Upload next file').click());
    assert.equal(f.container.innerHTML.includes('PRIVATE'), false);
    assert.equal(value.calls.native + value.calls.setter, 0);
});

it('uncertainty prevents selection, upload and removal while explicit clearing remains available', async (t) => {
    const f = await domFixture(t);
    const value = fake({
        state: { phase: 'uncertain', files: [pendingFile(f)] },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    assert.equal(f.button('Choose files').disabled, true);
    assert.equal(f.button('Upload next file').disabled, true);
    assert.equal(f.button('Remove attachment').disabled, true);
    assert.equal(f.button('Clear pending files').disabled, false);
    await pick(f, [pendingFile(f, 'PRIVATE_second.txt')]);
    await act(async () => f.button('Upload next file').click());
    await act(async () => f.button('Remove attachment').click());
    await act(async () => f.button('Clear pending files').click());
    assert.equal(value.calls.select.length, 0);
    assert.equal(value.calls.upload, 0);
    assert.deepEqual(value.calls.remove, []);
    assert.equal(value.calls.clear, 1);
    assert.match(
        f.container.textContent ?? '',
        /uncertain|inspection|inspect/i
    );
});

it('busy presentation permits queue replacement and cancellation but prevents another upload or removal', async (t) => {
    const f = await domFixture(t);
    const value = fake({
        state: { phase: 'uploading', busy: true, files: [pendingFile(f)] },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    assert.equal(f.button('Choose files').disabled, false);
    assert.equal(f.button('Upload next file').disabled, true);
    assert.equal(f.button('Remove attachment').disabled, true);
    assert.equal(f.button('Cancel upload').disabled, false);
    const replacement = pendingFile(f, 'PRIVATE_replacement.txt');
    await pick(f, [replacement]);
    await act(async () => f.button('Cancel upload').click());
    assert.equal(value.calls.select[0][0], replacement);
    assert.equal(value.calls.cancel, 1);
    assert.equal(value.calls.upload, 0);
});

it('empty chooser completion and cancel preserve the queue without selection, clearing or upload', async (t) => {
    const f = await domFixture(t);
    const value = fake({
        state: { phase: 'selected', files: [pendingFile(f)] },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    await pick(f, []);
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.Event('cancel', {
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(value.calls.select.length, 0);
    assert.equal(
        value.calls.clear + value.calls.upload + value.calls.cancel,
        0
    );
    assert.match(f.container.textContent ?? '', /1 pending file/);
});

it('contains descendant events and prevents Enter from submitting a surrounding form', async (t) => {
    const f = await domFixture(t);
    const value = fake();
    let leaked = 0,
        submits = 0;
    const event = () => {
        leaked++;
    };
    await f.render(
        h(
            'form',
            {
                onSubmit: (e: import('react').FormEvent) => {
                    e.preventDefault();
                    submits++;
                },
                onClick: event,
                onDoubleClick: event,
                onAuxClick: event,
                onPointerDown: event,
                onKeyDown: event,
                onKeyUp: event,
                onChange: event,
                onDrop: event,
            },
            renderMultipleAttachmentsField(value.props)
        )
    );
    for (const element of f.container.querySelectorAll(
        'section,span,li,input,button,label'
    )) {
        for (const type of ['click', 'dblclick', 'auxclick', 'pointerdown'])
            await act(async () =>
                element.dispatchEvent(
                    new f.window.Event(type, {
                        bubbles: true,
                        cancelable: true,
                    })
                )
            );
        for (const type of ['keydown', 'keyup'])
            for (const key of ['Enter', ' ', 'Tab']) {
                const keyboard = new f.window.KeyboardEvent(type, {
                    key,
                    bubbles: true,
                    cancelable: true,
                });
                await act(async () => element.dispatchEvent(keyboard));
                if (
                    key === 'Enter' &&
                    type === 'keydown' &&
                    element.tagName !== 'BUTTON'
                )
                    assert.equal(keyboard.defaultPrevented, true);
                if (key === 'Tab')
                    assert.equal(keyboard.defaultPrevented, false);
            }
    }
    assert.equal(leaked, 0);
    assert.equal(submits, 0);
    assert.equal(value.calls.upload, 0);
    assert.equal(value.calls.native + value.calls.setter, 0);
});

it('provides accessible field naming, live feedback and owner busy/invalid state', async (t) => {
    const f = await domFixture(t);
    const value = fake({
        props: {
            displayConfig: { showTitle: false },
            pending: true,
            error: 'Review this attachment field.',
        },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    const region = f.container.querySelector(
        '[aria-label="Supplied attachments"]'
    );
    assert.ok(region);
    assert.equal(region.getAttribute('aria-busy'), 'true');
    assert.equal(region.getAttribute('aria-invalid'), 'true');
    const status = f.container.querySelector('[role=status]');
    assert.ok(status);
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.ok(
        f.container.textContent?.includes('Review the field before continuing.')
    );
    assert.equal(
        f.container.textContent?.includes('Review this attachment field.'),
        false
    );
    assert.ok(
        f.input().getAttribute('aria-label') ||
            f.container.querySelector(`label[for="${f.input().id}"]`)
    );
});

it('detached picker and action nodes cannot act after props become readonly or unmount', async (t) => {
    const f = await domFixture(t);
    const value = fake({
        state: { phase: 'selected', files: [pendingFile(f)] },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    const oldInput = f.input();
    const oldUpload = f.button('Upload next file');
    const oldRemove = f.button('Remove attachment');
    await f.render(
        renderMultipleAttachmentsField(
            fake({ props: { capability: { type: 'readonly' } } }).props
        )
    );
    inert(f);
    await pick(f, [pendingFile(f)], oldInput);
    await act(async () => {
        oldUpload.click();
        oldRemove.click();
    });
    await f.unmount();
    await act(async () => oldUpload.click());
    assert.equal(value.calls.select.length, 0);
    assert.equal(value.calls.upload, 0);
    assert.deepEqual(value.calls.remove, []);
});

it('late asynchronous completion cannot mutate or focus a replacement renderer', async (t) => {
    const f = await domFixture(t);
    const pending = deferred<boolean>();
    let uploads = 0;
    const first = fake({
        state: { phase: 'selected', files: [pendingFile(f)] },
        actions: {
            upload: () => {
                uploads++;
                return pending.promise;
            },
        },
    });
    await f.render(renderMultipleAttachmentsField(first.props));
    await act(async () => f.button('Upload next file').click());
    const second = fake({
        props: { title: 'Successor attachments', fieldId: 'successor' },
    });
    await f.render(renderMultipleAttachmentsField(second.props));
    const successor = f.button('Choose files');
    successor.focus();
    const before = f.container.innerHTML;
    await act(async () => pending.resolve(true));
    assert.equal(uploads, 1);
    assert.equal(f.container.innerHTML, before);
    assert.equal(f.window.document.activeElement, successor);
    assert.equal(
        second.calls.upload + second.calls.clear + second.calls.cancel,
        0
    );
});

it('real Form preserves filtered duplicate rows and all native metadata when removing one occurrence', async (t) => {
    const f = await realForm(t, { hideAttachmentName: false });
    await f.render(f.tree());
    assert.equal(f.container.querySelectorAll('li').length, 2);
    const removals = [...f.container.querySelectorAll('button')].filter(
        (button) => button.textContent === 'Remove attachment'
    );
    await act(async () => removals[1].click());
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [stored]);
    assert.equal(f.owner.field('fld_files').getSnapshot().dirty, true);
    assert.equal(f.counters.uploads.length, 0);
    assert.equal(f.container.innerHTML.includes('PRIVATE_URL'), false);
    assert.equal(f.container.innerHTML.includes('PRIVATE_THUMBNAIL'), false);
});

it('real Form defaults to generic existing labels and keeps a queue over chooser cancellation and remount', async (t) => {
    const f = await realForm(t);
    await f.render(f.tree());
    assert.equal(f.container.innerHTML.includes('PRIVATE'), false);
    const queued = pendingFile(f);
    await pick(f, [queued]);
    assert.equal(f.controller.getSnapshot().files[0], queued);
    await pick(f, []);
    assert.equal(f.controller.getSnapshot().files[0], queued);
    await f.unmount();
    assert.equal(f.controller.getSnapshot().files[0], queued);
    await f.render(f.tree());
    assert.match(f.container.textContent ?? '', /1 pending file/);
    assert.equal(f.container.innerHTML.includes('PRIVATE'), false);
    assert.equal(f.counters.uploads.length, 0);
});

it('real Form uploads exactly the first queued File per explicit click, appends native results and never saves', async (t) => {
    const f = await realForm(t);
    await f.render(f.tree());
    const first = pendingFile(f, 'PRIVATE_first.txt'),
        second = pendingFile(f, 'PRIVATE_second.txt');
    await pick(f, [first, second]);
    assert.equal(f.counters.uploads.length, 0);
    await act(async () => f.button('Upload next file').click());
    assert.deepEqual(f.counters.uploads, [first]);
    assert.equal(f.controller.getSnapshot().files.length, 1);
    assert.equal(f.controller.getSnapshot().files[0], second);
    const afterFirst = f.owner.field('fld_files').getSnapshot().value;
    assert.ok(Array.isArray(afterFirst));
    assert.equal(afterFirst.length, 3);
    assert.deepEqual(afterFirst.slice(0, 2), [stored, stored]);
    assert.equal((afterFirst[2] as { id: unknown }).id, null);
    assert.equal(f.owner.field('fld_files').getSnapshot().dirty, true);
    await act(async () => f.button('Upload next file').click());
    assert.deepEqual(f.counters.uploads, [first, second]);
    assert.equal(f.controller.getSnapshot().files.length, 0);
    assert.equal(f.counters.saves, 0);
    assert.match(f.container.textContent ?? '', /Save/);
});

it('real Form active upload retains its File while a new queue replaces pending selection', async (t) => {
    const f = await realForm(t);
    const flight = deferred<UploadFileResult>();
    f.setUpload(() => flight.promise);
    await f.render(f.tree());
    const first = pendingFile(f, 'PRIVATE_first.txt'),
        replacement = pendingFile(f, 'PRIVATE_replacement.txt');
    await pick(f, [first]);
    await act(async () => f.button('Upload next file').click());
    assert.equal(f.controller.getSnapshot().busy, true);
    assert.equal(f.button('Choose files').disabled, false);
    await pick(f, [replacement]);
    assert.equal(f.controller.getSnapshot().files[0], replacement);
    await act(async () =>
        flight.resolve({
            id: null,
            url: 'https://files.example.test/PRIVATE_result',
            filename: first.name,
            type: first.type,
            size: first.size,
        })
    );
    assert.equal(f.controller.getSnapshot().busy, false);
    assert.equal(f.controller.getSnapshot().files[0], replacement);
    assert.deepEqual(f.counters.uploads, [first]);
    assert.equal(f.counters.saves, 0);
});

it('real cancel leaves uncertainty, rejects replay and permits clearing without accepting the late result', async (t) => {
    const f = await realForm(t);
    const flight = deferred<UploadFileResult>();
    f.setUpload(() => flight.promise);
    await f.render(f.tree());
    const file = pendingFile(f);
    await pick(f, [file]);
    await act(async () => f.button('Upload next file').click());
    await act(async () => f.button('Cancel upload').click());
    await act(async () =>
        flight.resolve({
            id: null,
            url: 'https://files.example.test/PRIVATE_late',
            filename: file.name,
            type: file.type,
            size: file.size,
        })
    );
    assert.equal(f.controller.getSnapshot().phase, 'uncertain');
    assert.equal(f.recovery.journal.unknown('A').length, 1);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [
        stored,
        stored,
    ]);
    assert.equal(f.button('Upload next file').disabled, true);
    await act(async () => f.button('Upload next file').click());
    assert.equal(f.counters.uploads.length, 1);
    await act(async () => f.button('Clear pending files').click());
    assert.equal(f.controller.getSnapshot().files.length, 0);
    assert.equal(f.recovery.journal.unknown('A').length, 1);
});

for (const retire of ['configuration', 'render-scope'] as const)
    it(`renderer ${retire} retirement prevents new actions while its live owner can finish an existing upload`, async (t) => {
        const f = await realForm(t);
        const flight = deferred<UploadFileResult>();
        f.setUpload(() => flight.promise);
        await f.render(f.tree());
        const file = pendingFile(f);
        await pick(f, [file]);
        const staleInput = f.input();
        const staleUpload = f.button('Upload next file');
        await act(async () => staleUpload.click());
        await act(async () => {
            if (retire === 'configuration') f.scope.configuration++;
            else f.scope.current = false;
            f.host.getSnapshot();
        });
        await f.render(f.tree());
        await pick(f, [pendingFile(f, 'PRIVATE_later.txt')], staleInput);
        await act(async () => staleUpload.click());
        await act(async () =>
            flight.resolve({
                id: null,
                url: 'https://files.example.test/PRIVATE_late',
                filename: file.name,
                type: file.type,
                size: file.size,
            })
        );
        assert.equal(f.container.querySelector('input,button'), null);
        assert.equal(f.counters.uploads.length, 1);
        const accepted = f.owner.field('fld_files').getSnapshot().value;
        assert.ok(Array.isArray(accepted));
        assert.equal(accepted.length, 3);
        assert.equal(
            (accepted[2] as { url: string }).url,
            'https://files.example.test/PRIVATE_late'
        );
    });

it('real readonly Form with attachment recovery stays inert', async (t) => {
    const f = await realForm(t, { readOnly: true });
    await f.render(f.tree());
    inert(f);
    const host = createFormFieldRendererHost({
        fields: f.owner,
        fieldId: 'fld_files',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => host.dispose());
    await f.render(
        h(FieldRenderer, {
            host,
            renderers: { renderMultipleAttachmentsField },
            fallback: () => null,
        })
    );
    inert(f);
});

it('real Form composition exposes the attachment slot but no Save action', async (t) => {
    const f = await realForm(t);
    const scope = createFormRenderScope({
        fields: f.owner,
        attachmentRecovery: f.recovery,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => scope.destroy());
    await f.render(
        h(AirtableForm, {
            scope,
            renderers: { renderMultipleAttachmentsField },
            children: (state) =>
                state.fields
                    .filter((field) => field.fieldId === 'fld_files')
                    .map((field) => field.node),
        })
    );
    assert.ok(f.input());
    const selected = pendingFile(f);
    await pick(f, [selected]);
    assert.equal(f.controller.getSnapshot().files[0], selected);
    assert.equal(f.counters.uploads.length, 0);
    assert.equal(
        [...f.container.querySelectorAll('button')].some(
            (button) => button.textContent === 'Save'
        ),
        false
    );
});

for (const layout of ['grid', 'list'] as const)
    it(`accepted readonly Portal ${layout} never reconstructs attachment metadata and retires with its scope`, async (t) => {
        const f = await domFixture(t);
        const schema = loadedForm().payload.fieldIdsToSchemas.fld_files;
        const detail = {
            fieldId: 'fld_files',
            fieldName: 'Files',
            titleOverride: '',
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: { hideAttachmentName: false },
        };
        const api = portalFixture(async () =>
            portalListPage({
                recordIds: ['record_1'],
                customViewDetailFields: { fld_children: [detail] },
                tableIdsToLinkedTableStates: {
                    table_children: {
                        airtableFields: [schema.airtableField],
                        recordIdsToAirtableRecords: {
                            record_1: {
                                id: 'record_1',
                                fields: { fld_files: [stored, stored] },
                            },
                        },
                    },
                },
            })
        );
        const owner = createPortalListOwner({
            client: api.client,
            portal: portalPage({ disableInlineEdit: false, layout }),
            portalFieldId: 'fld_children',
            criteria: {
                selectedCustomViewId: 'view_example',
                searchTerm: '',
                searchParamsMap: {},
                sortFieldsByEndUser: null,
                filtersByEndUser: null,
                supportsEndUserSortCleanup: true,
                supportsEndUserFilterCleanup: true,
            },
            getScope: () => ({ ownerId: 'attachments-portal', revision: 0 }),
        });
        await owner.readFirst(owner.getSnapshot().revision, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        let current = true;
        const scope = createPortalRenderScope({
            owner,
            client: api.client,
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => {
            scope.destroy();
            owner.destroy();
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
        });
        const Component = layout === 'grid' ? AirtableGrid : AirtableList;
        const tree = () =>
            h(Component, {
                scope,
                renderers: { renderMultipleAttachmentsField },
                children: (state) =>
                    state.rows.flatMap((row) =>
                        row.cells.map((cell) => cell.node)
                    ),
            });
        await f.render(tree());
        inert(f);
        assert.equal(f.container.textContent?.includes('2'), false);
        current = false;
        await f.render(tree());
        assert.equal(f.container.textContent, '');
    });

it('retired filtered facets disappear before any row or pending queue access', async (t) => {
    const f = await domFixture(t);
    for (const state of [{ retired: true }, { phase: 'retired' as const }]) {
        const value = fake({ state });
        let reads = 0;
        for (const property of ['rows', 'files'])
            Object.defineProperty(value.state, property, {
                get() {
                    reads++;
                    throw Error('PRIVATE retired data');
                },
            });
        await f.render(renderMultipleAttachmentsField(value.props));
        assert.equal(f.container.textContent, '');
        assert.equal(reads, 0);
        assert.equal(value.calls.native, 0);
    }
});

it('valid unavailable filtered presentation preserves only clearing and cancellation without reading rows', async (t) => {
    const f = await domFixture(t);
    const value = fake({
        state: {
            presentation: 'unavailable',
            phase: 'uploading',
            busy: true,
            files: [pendingFile(f)],
        },
    });
    let reads = 0;
    Object.defineProperty(value.state, 'rows', {
        get() {
            reads++;
            throw Error('PRIVATE unavailable rows');
        },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    assert.ok(f.container.textContent?.includes(unavailable));
    assert.equal(f.container.querySelector('li,a,img'), null);
    assert.equal(f.button('Choose files').disabled, true);
    assert.equal(f.button('Upload next file').disabled, true);
    assert.equal(f.button('Clear pending files').disabled, false);
    assert.equal(f.button('Cancel upload').disabled, false);
    await pick(f, [pendingFile(f)]);
    await act(async () => f.button('Clear pending files').click());
    await act(async () => f.button('Cancel upload').click());
    assert.equal(value.calls.select.length, 0);
    assert.equal(value.calls.upload, 0);
    assert.equal(value.calls.clear, 1);
    assert.equal(value.calls.cancel, 1);
    assert.equal(reads, 0);
    assert.equal(value.calls.native + value.calls.setter, 0);
});

it('editable real Form without attachment recovery renders only the generic fallback', async (t) => {
    const f = await realForm(t);
    const host = createFormFieldRendererHost({
        fields: f.owner,
        fieldId: 'fld_files',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => host.dispose());
    const state = host.getSnapshot();
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready') throw Error('Expected ready host');
    assert.equal(state.fields[0].capability.type, 'editable');
    assert.equal('attachment' in state.fields[0].capability, false);
    await f.render(
        h(FieldRenderer, {
            host,
            renderers: { renderMultipleAttachmentsField },
            fallback: () => null,
        })
    );
    inert(f);
});

it('repeated upload clicks while a guarded promise is pending invoke only one upload', async (t) => {
    const f = await domFixture(t);
    const flight = deferred<boolean>();
    let calls = 0;
    const value = fake({
        state: { phase: 'selected', files: [pendingFile(f)] },
        actions: {
            upload: () => {
                calls++;
                return flight.promise;
            },
        },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    const button = f.button('Upload next file');
    await act(async () => {
        button.click();
        button.click();
        button.click();
    });
    assert.equal(calls, 1);
    assert.equal(button.disabled, true);
    await act(async () => flight.resolve(true));
    assert.equal(calls, 1);
});

it('real session replacement rejects a late upload and scrubs retired presentation', async (t) => {
    const f = await realForm(t);
    const flight = deferred<UploadFileResult>();
    f.setUpload(() => flight.promise);
    await f.render(f.tree());
    const file = pendingFile(f);
    await pick(f, [file]);
    await act(async () => f.button('Upload next file').click());
    await act(async () => f.client.setSession({ visitor: 'B' }));
    await act(async () =>
        flight.resolve({
            id: null,
            url: 'https://files.example.test/PRIVATE_late',
            filename: file.name,
            type: file.type,
            size: file.size,
        })
    );
    assert.equal(f.owner.field('fld_files').getSnapshot().value, undefined);
    assert.equal(f.owner.field('fld_files').getSnapshot().retired, true);
    assert.equal(f.owner.controller.getState().draft, null);
    assert.equal(f.controller.getSnapshot().retired, true);
    assert.equal(f.controller.getSnapshot().files.length, 0);
    assert.equal(f.recovery.journal.unknown('A').length, 1);
    assert.equal(f.counters.uploads.length, 1);
});

it('destroyed owner cannot append a late upload into an accepted successor owner', async (t) => {
    const f = await realForm(t);
    const flight = deferred<UploadFileResult>();
    f.setUpload(() => flight.promise);
    await f.render(f.tree());
    const file = pendingFile(f);
    await pick(f, [file]);
    const oldInput = f.input();
    const oldUpload = f.button('Upload next file');
    await act(async () => oldUpload.click());
    await act(async () => f.owner.destroy());
    const loaded = loadedForm();
    loaded.payload.formRecord.data.fld_files = [
        { ...stored, filename: 'Successor supplied label' },
    ];
    const next = createFormFieldBindings({
        client: f.client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'B', revision: 0 }),
    });
    const host = createFormFieldRendererHost({
        fields: next,
        fieldId: 'fld_files',
        attachmentRecovery: {
            ...f.recovery,
            scope: { ...f.recovery.scope, owner: 'B' },
        },
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => {
        host.dispose();
        next.destroy();
    });
    await f.render(
        h(FieldRenderer, {
            host,
            renderers: { renderMultipleAttachmentsField },
            fallback: () => null,
        })
    );
    const before = next.field('fld_files').getSnapshot().value;
    await pick(f, [pendingFile(f)], oldInput);
    await act(async () => oldUpload.click());
    await act(async () =>
        flight.resolve({
            id: null,
            url: 'https://files.example.test/PRIVATE_late',
            filename: file.name,
            type: file.type,
            size: file.size,
        })
    );
    assert.deepEqual(next.field('fld_files').getSnapshot().value, before);
    assert.equal(f.counters.uploads.length, 1);
    assert.equal(next.field('fld_files').getSnapshot().dirty, false);
});

it('real add-only filtered snapshots hide persisted names and native indexes without pruning native values', async (t) => {
    const f = await realForm(t, {
        addOnlyMode: true,
        hideAttachmentName: false,
        showExistingValuesForAddOnlyMode: false,
    });
    // The canonical persisted baseline must be installed before constructing the owner.
    // A separate accepted owner uses the fixture loaded state, avoiding mutation of an existing owner.
    const loaded = structuredClone(f.loaded);
    loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
        fld_files: [stored],
    };
    const added = {
        ...stored,
        url: 'https://files.example.test/PRIVATE_new',
        filename: 'Only supplied visible name',
    };
    loaded.payload.formRecord.data.fld_files = [stored, added, stored];
    const owner = createFormFieldBindings({
        client: f.client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'add-only', revision: 0 }),
    });
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_files',
        attachmentRecovery: {
            ...f.recovery,
            scope: { ...f.recovery.scope, owner: 'add-only' },
        },
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => {
        host.dispose();
        owner.destroy();
    });
    await f.render(
        h(FieldRenderer, {
            host,
            renderers: { renderMultipleAttachmentsField },
            fallback: () => null,
        })
    );
    const rows = f.container.querySelectorAll('li');
    assert.equal(rows.length, 1);
    assert.ok(rows[0].textContent?.includes(added.filename));
    const removal = f.button('Remove attachment');
    assert.equal(removal.getAttribute('aria-label'), 'Remove attachment 1');
    assert.equal(f.container.innerHTML.includes(stored.filename), false);
    assert.equal(f.container.innerHTML.includes('PRIVATE_URL'), false);
    await act(async () => removal.click());
    assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
        stored,
        stored,
    ]);
});

it('valid unavailable filtered presentation without activity has no controls or count', async (t) => {
    const f = await domFixture(t);
    const value = fake({ state: { presentation: 'unavailable' } });
    Object.defineProperty(value.state, 'rows', {
        get() {
            throw Error('PRIVATE unavailable rows');
        },
    });
    await f.render(renderMultipleAttachmentsField(value.props));
    inert(f);
    assert.equal(f.container.textContent?.includes('pending'), false);
    assert.equal(value.calls.native + value.calls.setter, 0);
});

it('hidden Form attachment retires rendered callbacks but retains its owner-held queue and other draft', async (t) => {
    const f = await realForm(t, {
        conditionalFields: {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'show_when_title_matches',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'singleLineText',
                        idOrName: { type: 'id', id: 'fld_title' },
                        value: 'Initial title',
                    },
                },
            ],
        },
    });
    await f.render(f.tree());
    const selected = pendingFile(f);
    await pick(f, [selected]);
    const input = f.input(),
        upload = f.button('Upload next file');
    await act(async () => {
        assert.equal(
            f.owner.field('fld_title').setValue('Changed title').accepted,
            true
        );
    });
    assert.equal(f.host.getSnapshot().status, 'hidden');
    assert.equal(f.container.querySelector('input,button'), null);
    await pick(f, [pendingFile(f, 'PRIVATE_foreign.txt')], input);
    await act(async () => upload.click());
    assert.equal(f.counters.uploads.length, 0);
    assert.equal(f.controller.getSnapshot().files[0], selected);
    assert.equal(
        f.owner.field('fld_title').getSnapshot().value,
        'Changed title'
    );
    assert.equal(f.owner.field('fld_title').getSnapshot().dirty, true);
});

it('owner-guarded attachment configuration replacement refuses a late upload without requiring a new controller', async (t) => {
    const f = await domFixture(t);
    const loaded = loadedForm();
    let revision = 0,
        uploads = 0;
    const flight = deferred<UploadFileResult>();
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            throw Error('No network');
        },
    });
    client.attachments.uploadFile = () => {
        uploads++;
        return flight.promise;
    };
    const owner = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'guarded', revision: 0 }),
    });
    const recovery = {
        journal: new RecoveryJournal(),
        scope: {
            owner: 'guarded',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal' as const,
        },
        loadVersion: 1,
    };
    const controller = owner.attachment('fld_files', recovery, {
        configurationRevision: () => revision,
    });
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_files',
        attachmentRecovery: recovery,
        isCurrent: () => true,
        configurationRevision: () => revision,
    });
    t.after(() => {
        host.dispose();
        owner.destroy();
    });
    await f.render(
        h(FieldRenderer, {
            host,
            renderers: { renderMultipleAttachmentsField },
            fallback: () => null,
        })
    );
    const file = pendingFile(f);
    await pick(f, [file]);
    await act(async () => f.button('Upload next file').click());
    revision++;
    await act(async () =>
        flight.resolve({
            id: null,
            url: 'https://files.example.test/PRIVATE_late',
            filename: file.name,
            type: file.type,
            size: file.size,
        })
    );
    assert.equal(uploads, 1);
    assert.deepEqual(
        owner.field('fld_files').getSnapshot().value,
        loaded.payload.formRecord.data.fld_files
    );
    assert.equal(controller.getSnapshot().phase, 'uncertain');
    assert.equal(recovery.journal.unknown('guarded').length, 1);
});

it('removing the focused row restores focus within the same live attachment field', async (t) => {
    const f = await realForm(t);
    await f.render(f.tree());
    const first = f.button('Remove attachment');
    first.focus();
    await act(async () => first.click());
    const next = f.button('Remove attachment');
    assert.equal(f.window.document.activeElement, next);
    assert.equal(f.counters.uploads.length, 0);
});
