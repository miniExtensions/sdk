import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    ReadonlyAttachmentsField,
    renderReadonlyAttachmentsField,
} from '../src/react/ReadonlyAttachmentsField.js';
import { AirtableForm, FieldRenderer } from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormRenderScope } from '../src/ui/formRenderScope.js';
import {
    createFormFieldRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import type {
    FieldConfig,
    FieldRendererHost,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

type Props = FieldRendererProps<'multipleAttachments'>;
const unavailable = 'Attachment presentation unavailable';
const masked = '••••••••';
const literal =
    '  <img src=x onerror=alert(1)> 雪 https://private.invalid\r\n  ';
const native = {
    id: 'PRIVATE_ID',
    url: 'https://files.example.test/PRIVATE_URL',
    filename: literal,
    thumbnails: {
        small: {
            url: 'https://files.example.test/PRIVATE_THUMBNAIL',
            width: 10,
            height: 10,
        },
    },
};
const slots = {
    renderMultipleAttachmentsField: renderReadonlyAttachmentsField,
};

async function domFixture(t: TestContext) {
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
    };
}
type Fixture = Awaited<ReturnType<typeof domFixture>>;

function direct(overrides: Partial<Props> = {}) {
    const field =
        loadedForm().payload.fieldIdsToSchemas.fld_files.airtableField;
    if (field.config.type !== 'multipleAttachments')
        throw Error('Expected attachment schema');
    const props = {
        physicalKind: 'multipleAttachments',
        presentation: { type: 'physical', config: field.config },
        fieldId: 'fld_files',
        title: 'Supplied attachment labels',
        field,
        displayConfig: { readOnly: true, hideAttachmentName: false },
        writeConfig: { readOnly: true, hideAttachmentName: false },
        context: 'form',
        computed: false,
        attachmentPresentation: {
            status: 'ready',
            rows: [{ label: literal }, { label: '' }, { label: literal }],
        },
        ...overrides,
    } as Props;
    const reads: string[] = [];
    for (const name of [
        'value',
        'capability',
        'validation',
        'error',
        'pending',
        'dirty',
    ])
        Object.defineProperty(props, name, {
            configurable: true,
            get() {
                reads.push(name);
                throw Error(`PRIVATE ${name} must not be read`);
            },
        });
    return { props, reads };
}

function labels(f: Fixture) {
    return [...f.container.querySelectorAll('li')].map(
        (row) => row.textContent
    );
}
function passive(f: Fixture) {
    assert.equal(
        f.container.querySelector(
            'button,input,select,textarea,a,img,picture,video,audio,canvas,iframe,object,embed,[contenteditable]'
        ),
        null
    );
    assert.equal(f.container.innerHTML.includes('PRIVATE'), false);
}
function inert(f: Fixture, text = unavailable) {
    assert.ok(
        f.container.textContent?.includes(text),
        f.container.textContent ?? ''
    );
    assert.equal(f.container.querySelector('li,ul,ol'), null);
    assert.equal(f.container.textContent?.includes(literal), false);
    assert.equal(
        /\b(?:\d+|pending|upload|download)\b/i.test(
            f.container.textContent ?? ''
        ),
        false
    );
    passive(f);
}
function hostTree(host: FieldRendererHost) {
    return h(FieldRenderer, { host, renderers: slots, fallback: () => null });
}

for (const context of ['form', 'portal-detail'] as const)
    it(`readonly attachment ${context} renders literal labels in order with duplicates and empty labels`, async (t) => {
        const f = await domFixture(t);
        const d = direct({ context });
        await f.render(
            renderReadonlyAttachmentsField(d.props, { className: 'label-only' })
        );
        assert.deepEqual(labels(f), [literal, '', literal]);
        assert.ok(f.container.querySelector('.label-only'));
        passive(f);
        assert.deepEqual(d.reads, []);
        for (const row of f.container.querySelectorAll('li')) {
            const styled = row.getAttribute('style')
                ? row
                : row.querySelector('[style]');
            assert.ok(styled);
            assert.match(
                styled.getAttribute('style') ?? '',
                /white-space: pre-wrap/
            );
            assert.match(
                styled.getAttribute('style') ?? '',
                /overflow-wrap: anywhere/
            );
        }
    });

it('readonly attachment component accepts ready empty projection without inventing rows or counts', async (t) => {
    const f = await domFixture(t);
    const d = direct({ attachmentPresentation: { status: 'ready', rows: [] } });
    await f.render(h(ReadonlyAttachmentsField, { field: d.props }));
    assert.deepEqual(labels(f), []);
    assert.equal(f.container.textContent?.includes(unavailable), false);
    assert.equal(/\b\d+\b/.test(f.container.textContent ?? ''), false);
    passive(f);
    assert.deepEqual(d.reads, []);
});

for (const status of ['masked', 'unavailable'] as const)
    it(`readonly attachment ${status} facet is inert and discloses no rows`, async (t) => {
        const f = await domFixture(t);
        const d = direct({ attachmentPresentation: { status } });
        await f.render(renderReadonlyAttachmentsField(d.props));
        inert(f, status === 'masked' ? masked : unavailable);
        assert.deepEqual(d.reads, []);
    });

for (const config of ['displayConfig', 'writeConfig'] as const)
    for (const flag of [
        'obscurePassword',
        'maskPasswordOnLoginScreen',
    ] as const)
        for (const value of [true, null, 'false', 0])
            it(`readonly attachment ${config}.${flag}=${String(value)} masks before facet access`, async (t) => {
                const f = await domFixture(t);
                const d = direct({ [config]: { [flag]: value } } as never);
                let reads = 0;
                Object.defineProperty(d.props, 'attachmentPresentation', {
                    get() {
                        reads++;
                        throw Error('PRIVATE concealed facet');
                    },
                });
                await f.render(renderReadonlyAttachmentsField(d.props));
                inert(f, masked);
                assert.equal(reads, 0);
                assert.deepEqual(d.reads, []);
            });

for (const config of ['displayConfig', 'writeConfig'] as const)
    for (const malformed of [[], 'config', 42])
        it(`readonly attachment malformed ${config} ${JSON.stringify(malformed)} fails closed before facet access`, async (t) => {
            const f = await domFixture(t);
            const d = direct({ [config]: malformed } as never);
            let reads = 0;
            Object.defineProperty(d.props, 'attachmentPresentation', {
                get() {
                    reads++;
                    throw Error('PRIVATE malformed configuration');
                },
            });
            await f.render(renderReadonlyAttachmentsField(d.props));
            inert(f);
            assert.equal(reads, 0);
            assert.deepEqual(d.reads, []);
        });

for (const config of ['displayConfig', 'writeConfig'] as const)
    for (const flag of [
        'hideAttachmentName',
        'readOnly',
        'addOnlyMode',
        'showExistingValuesForAddOnlyMode',
    ] as const)
        it(`readonly attachment malformed ${config}.${flag} fails closed`, async (t) => {
            const f = await domFixture(t);
            const d = direct({ [config]: { [flag]: 'false' } } as never);
            await f.render(renderReadonlyAttachmentsField(d.props));
            inert(f);
            assert.deepEqual(d.reads, []);
        });

it('readonly attachment valid read-only and add-only flags consume the approved facet unchanged', async (t) => {
    const f = await domFixture(t);
    const d = direct({
        displayConfig: {
            readOnly: true,
            addOnlyMode: true,
            hideAttachmentName: false,
        },
        writeConfig: {
            readOnly: true,
            addOnlyMode: true,
            hideAttachmentName: false,
        },
    });
    await f.render(renderReadonlyAttachmentsField(d.props));
    assert.deepEqual(labels(f), [literal, '', literal]);
    assert.deepEqual(d.reads, []);
});

it('readonly attachment needs an accepted configuration but permits one omitted optional configuration', async (t) => {
    const f = await domFixture(t);
    for (const overrides of [
        { displayConfig: undefined },
        { writeConfig: undefined },
        { displayConfig: null },
        { writeConfig: null },
    ]) {
        const d = direct(overrides as never);
        await f.render(renderReadonlyAttachmentsField(d.props));
        assert.deepEqual(labels(f), [literal, '', literal]);
        assert.deepEqual(d.reads, []);
    }
    const d = direct({ displayConfig: undefined, writeConfig: undefined });
    await f.render(renderReadonlyAttachmentsField(d.props));
    inert(f);
    assert.deepEqual(d.reads, []);
});

for (const target of ['config', 'facet', 'rows', 'label'] as const)
    it(`readonly attachment throwing ${target} getter fails closed without native fallback`, async (t) => {
        const f = await domFixture(t);
        const d = direct();
        const throwPrivate = (): never => {
            throw Error('PRIVATE accessor');
        };
        if (target === 'config')
            Object.defineProperty(d.props, 'displayConfig', {
                get: throwPrivate,
            });
        else if (target === 'facet')
            Object.defineProperty(d.props, 'attachmentPresentation', {
                get: throwPrivate,
            });
        else if (target === 'rows')
            d.props.attachmentPresentation = {
                status: 'ready',
                get rows(): never {
                    return throwPrivate();
                },
            };
        else
            d.props.attachmentPresentation = {
                status: 'ready',
                rows: [
                    {
                        get label(): never {
                            return throwPrivate();
                        },
                    },
                ],
            };
        await f.render(renderReadonlyAttachmentsField(d.props));
        inert(f);
        assert.deepEqual(d.reads, []);
    });

it('readonly attachment rejects extra native row keys without evaluating their getters', async (t) => {
    const f = await domFixture(t);
    let reads = 0;
    const d = direct({
        attachmentPresentation: {
            status: 'ready',
            rows: [
                {
                    label: literal,
                    get url() {
                        reads++;
                        throw Error('PRIVATE URL');
                    },
                },
            ] as never,
        },
    });
    await f.render(renderReadonlyAttachmentsField(d.props));
    inert(f);
    assert.equal(reads, 0);
    assert.deepEqual(d.reads, []);
});

const malformedFacets: readonly [string, unknown][] = [
    ['missing', undefined],
    ['null', null],
    ['array', []],
    ['status missing', { rows: [] }],
    ['status unknown', { status: 'loading' }],
    ['ready missing rows', { status: 'ready' }],
    ['ready nonarray rows', { status: 'ready', rows: {} }],
    ['sparse rows', { status: 'ready', rows: new Array(2) }],
    ['null row', { status: 'ready', rows: [null] }],
    ['string row', { status: 'ready', rows: ['literal'] }],
    ['missing label', { status: 'ready', rows: [{}] }],
    ['numeric label', { status: 'ready', rows: [{ label: 0 }] }],
    ['native object label', { status: 'ready', rows: [{ label: native }] }],
    ['masked extra rows', { status: 'masked', rows: [{ label: literal }] }],
    [
        'unavailable extra rows',
        { status: 'unavailable', rows: [{ label: literal }] },
    ],
    ...[
        'url',
        'id',
        'filename',
        'nativeIndex',
        'attachment',
        'removeAllowed',
        'openAllowed',
        'downloadAllowed',
        'thumbnails',
        'file',
    ].map((key): [string, unknown] => [
        `native row key ${key}`,
        { status: 'ready', rows: [{ label: literal, [key]: 'PRIVATE' }] },
    ]),
    ['facet metadata', { status: 'ready', rows: [], count: 4 }],
];
for (const [name, facet] of malformedFacets)
    it(`readonly attachment malformed facet ${name} never falls back to native values`, async (t) => {
        const f = await domFixture(t);
        const d = direct({ attachmentPresentation: facet as never });
        await f.render(renderReadonlyAttachmentsField(d.props));
        inert(f);
        assert.deepEqual(d.reads, []);
    });

it('readonly attachment copies changing label getters once per render and rejects later raw objects', async (t) => {
    const f = await domFixture(t);
    let reads = 0;
    const d = direct({
        attachmentPresentation: {
            status: 'ready',
            rows: [
                {
                    get label() {
                        return ++reads === 1
                            ? 'captured label'
                            : (native as never);
                    },
                },
            ],
        },
    });
    // Render without StrictMode here so a subsequent React render is distinguishable
    // from a second getter read within one accepted projection copy.
    const { renderToStaticMarkup } = await import('react-dom/server');
    const first = renderToStaticMarkup(renderReadonlyAttachmentsField(d.props));
    assert.equal(reads, 1);
    assert.ok(first.includes('captured label'));
    assert.equal(first.includes('PRIVATE'), false);
    await f.render(renderReadonlyAttachmentsField(d.props));
    inert(f);
    assert.deepEqual(d.reads, []);
});

for (const [name, override] of [
    ['linked detail', { context: 'linked-detail' }],
    ['Portal inline', { context: 'portal-cell' }],
    ['computed', { computed: true }],
    ['physical kind', { physicalKind: 'singleLineText' }],
    [
        'result presentation',
        {
            presentation: {
                type: 'result',
                config: { type: 'multipleAttachments' },
            },
        },
    ],
] as const)
    it(`readonly attachment excludes ${name} before reading the facet`, async (t) => {
        const f = await domFixture(t);
        const d = direct(override as never);
        let reads = 0;
        Object.defineProperty(d.props, 'attachmentPresentation', {
            get() {
                reads++;
                throw Error('PRIVATE unsupported facet');
            },
        });
        await f.render(renderReadonlyAttachmentsField(d.props));
        inert(f);
        assert.equal(reads, 0);
        assert.deepEqual(d.reads, []);
    });

for (const showTitle of [true, false])
    it(`readonly attachment exposes an accessible title with showTitle=${showTitle}`, async (t) => {
        const f = await domFixture(t);
        const d = direct({ displayConfig: { showTitle } });
        await f.render(renderReadonlyAttachmentsField(d.props));
        if (showTitle) {
            const named = f.container.querySelector('[aria-labelledby]');
            assert.ok(named);
            const id = named.getAttribute('aria-labelledby');
            assert.ok(id);
            assert.equal(
                f.window.document.getElementById(id)?.textContent,
                d.props.title
            );
        } else {
            assert.ok(
                f.container.querySelector(`[aria-label="${d.props.title}"]`)
            );
            assert.equal(
                f.container.textContent?.includes(d.props.title),
                false
            );
        }
        assert.deepEqual(d.reads, []);
    });

it('readonly attachment title fallback reads only field names and retains a generic label when metadata throws', async (t) => {
    const f = await domFixture(t);
    const d = direct({ title: '   ', displayConfig: { showTitle: false } });
    await f.render(renderReadonlyAttachmentsField(d.props));
    assert.ok(f.container.querySelector('[aria-label="Files"]'));
    Object.defineProperty(d.props, 'title', {
        get() {
            throw Error('PRIVATE title');
        },
    });
    await f.render(renderReadonlyAttachmentsField(d.props));
    assert.ok(f.container.textContent?.includes('Attachments'));
    passive(f);
    assert.deepEqual(d.reads, []);
});

it('readonly attachment captures a changing field name once before masked presentation', async () => {
    const d = direct({
        title: '',
        displayConfig: { obscurePassword: true } as never,
    });
    let nameReads = 0,
        facetReads = 0;
    Object.defineProperty(d.props.field, 'name', {
        get() {
            return ++nameReads === 1 ? 'Captured field name' : native;
        },
    });
    Object.defineProperty(d.props, 'attachmentPresentation', {
        get() {
            facetReads++;
            throw Error('PRIVATE concealed facet');
        },
    });
    const { renderToStaticMarkup } = await import('react-dom/server');
    const result = renderToStaticMarkup(
        renderReadonlyAttachmentsField(d.props)
    );
    assert.ok(result.includes('Captured field name'));
    assert.ok(result.includes(masked));
    assert.equal(result.includes('PRIVATE'), false);
    assert.equal(nameReads, 1);
    assert.equal(facetReads, 0);
    assert.deepEqual(d.reads, []);
});

for (const status of ['masked', 'unavailable'] as const)
    for (const showTitle of [true, false])
        it(`readonly attachment ${status} remains accessibly named with showTitle=${showTitle}`, async (t) => {
            const f = await domFixture(t);
            const d = direct({
                displayConfig: { showTitle },
                attachmentPresentation: { status },
            });
            await f.render(renderReadonlyAttachmentsField(d.props));
            const output = f.container.querySelector('output');
            assert.ok(output);
            if (showTitle) {
                const label = f.container.querySelector('label');
                assert.ok(label);
                assert.equal(label.getAttribute('for'), output.id);
                assert.equal(label.textContent, d.props.title);
                assert.equal(output.getAttribute('aria-label'), null);
            } else {
                assert.equal(output.getAttribute('aria-label'), d.props.title);
                assert.equal(f.container.querySelector('label'), null);
            }
            inert(f, status === 'masked' ? masked : unavailable);
            assert.deepEqual(d.reads, []);
        });

for (const status of ['ready', 'masked', 'unavailable'] as const)
    it(`readonly attachment ${status} isolates descendant events and Enter without blocking text selection defaults`, async (t) => {
        const f = await domFixture(t);
        const d = direct({
            attachmentPresentation:
                status === 'ready'
                    ? { status, rows: [{ label: literal }] }
                    : { status },
        });
        let leaked = 0,
            submits = 0;
        const row = () => {
            leaked++;
        };
        await f.render(
            h(
                'form',
                {
                    onClick: row,
                    onDoubleClick: row,
                    onAuxClick: row,
                    onPointerDown: row,
                    onKeyDown: row,
                    onKeyUp: row,
                    onSubmit(event: import('react').FormEvent) {
                        event.preventDefault();
                        submits++;
                    },
                },
                renderReadonlyAttachmentsField(d.props)
            )
        );
        for (const element of f.container.querySelectorAll('form *')) {
            for (const type of [
                'click',
                'dblclick',
                'auxclick',
                'pointerdown',
            ]) {
                const event = new f.window.Event(type, {
                    bubbles: true,
                    cancelable: true,
                });
                await act(async () => element.dispatchEvent(event));
                assert.equal(event.defaultPrevented, false);
            }
            for (const type of ['keydown', 'keyup'])
                for (const key of ['Enter', ' ', 'Tab', 'ArrowRight']) {
                    const event = new f.window.KeyboardEvent(type, {
                        key,
                        bubbles: true,
                        cancelable: true,
                    });
                    await act(async () => element.dispatchEvent(event));
                    assert.equal(
                        event.defaultPrevented,
                        type === 'keydown' && key === 'Enter'
                    );
                }
        }
        assert.equal(leaked, 0);
        assert.equal(submits, 0);
        assert.deepEqual(d.reads, []);
    });

async function formFixture(
    t: TestContext,
    config: FieldConfig<'multipleAttachments'> = {}
) {
    const f = await domFixture(t);
    const loaded = loadedForm();
    const schema = loaded.payload.fieldIdsToSchemas.fld_files;
    assert.equal(schema.fieldType, 'multipleAttachments');
    if (schema.fieldType !== 'multipleAttachments')
        throw Error('Expected attachment field');
    schema.miniExtConfig = {
        readOnly: true,
        hideAttachmentName: false,
        hideFieldIfEmpty: false,
        ...config,
    };
    loaded.payload.formRecord.data.fld_files = [native, native];
    let requests = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        session: { visitor: 'A' },
        fetch: async () => {
            requests++;
            throw Error('No I/O from readonly presentation');
        },
    });
    const lease = { current: true, configuration: 0, owner: 'A', revision: 0 };
    const owner = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: lease.owner, revision: lease.revision }),
    });
    owner.attachment = () => {
        throw Error('Readonly labels must not construct a controller');
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_files',
        isCurrent: () => lease.current,
        configurationRevision: () => lease.configuration,
    });
    t.after(() => {
        host.dispose();
        owner.destroy();
        assert.equal(requests, 0);
    });
    return {
        ...f,
        loaded,
        schema,
        owner,
        client,
        lease,
        host,
        tree: () => hostTree(host),
    };
}

it('readonly attachment real Form subscriptions hide and show labels without changing native data or allocating an upload queue', async (t) => {
    const f = await formFixture(t, {
        conditionalFields: {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'visible-title',
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
    assert.deepEqual(labels(f), [literal, literal]);
    const before = f.owner.field('fld_files').getSnapshot();
    await act(async () => {
        assert.equal(
            f.owner.field('fld_title').setValue('Hidden').accepted,
            true
        );
    });
    assert.equal(f.host.getSnapshot().status, 'hidden');
    assert.equal(f.container.textContent, '');
    await act(async () => {
        assert.equal(
            f.owner.field('fld_title').setValue('Initial title').accepted,
            true
        );
    });
    assert.deepEqual(labels(f), [literal, literal]);
    assert.deepEqual(
        f.owner.field('fld_files').getSnapshot().value,
        before.value
    );
    assert.equal(f.owner.field('fld_files').getSnapshot().dirty, before.dirty);
    assert.equal(f.owner.hasPendingFiles(), false);
    passive(f);
});

it('readonly attachment real Form shell preserves custom slot precedence and remounts the same accepted owner', async (t) => {
    const f = await formFixture(t);
    const scope = createFormRenderScope({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => scope.destroy());
    let custom = 0;
    await f.render(
        h(AirtableForm, {
            scope,
            renderers: {
                renderMultipleAttachmentsField: () => {
                    custom++;
                    return h('p', null, 'Application attachment renderer');
                },
            },
            children: (state) =>
                state.fields
                    .filter((field) => field.fieldId === 'fld_files')
                    .map((field) => field.node),
        })
    );
    assert.ok(custom > 0);
    assert.equal(f.container.textContent, 'Application attachment renderer');
    assert.deepEqual(labels(f), []);
    const tree = () =>
        h(AirtableForm, {
            scope,
            renderers: slots,
            children: (state) =>
                state.fields
                    .filter((field) => field.fieldId === 'fld_files')
                    .map((field) => field.node),
        });
    await f.render(tree());
    assert.deepEqual(labels(f), [literal, literal]);
    await f.unmount();
    await f.render(tree());
    assert.deepEqual(labels(f), [literal, literal]);
    assert.equal(f.owner.field('fld_files').getSnapshot().retired, false);
});

for (const cause of ['configuration', 'owner', 'session', 'destroy'] as const)
    it(`readonly attachment Form ${cause} retirement clears subscribed DOM and never revives after ABA`, async (t) => {
        const f = await formFixture(t);
        await f.render(f.tree());
        assert.deepEqual(labels(f), [literal, literal]);
        await act(async () => {
            if (cause === 'configuration') f.lease.configuration++;
            else if (cause === 'owner') f.lease.owner = 'B';
            else if (cause === 'session') f.client.setSession({ visitor: 'B' });
            else f.owner.destroy();
            f.owner.refresh();
            f.host.getSnapshot();
        });
        await f.render(f.tree());
        assert.equal(f.host.getSnapshot().status, 'retired');
        assert.equal(f.container.textContent, '');
        await act(async () => {
            if (cause === 'configuration') f.lease.configuration--;
            else if (cause === 'owner') f.lease.owner = 'A';
            else if (cause === 'session') f.client.setSession({ visitor: 'A' });
            f.owner.refresh();
            f.host.getSnapshot();
        });
        await f.render(f.tree());
        assert.equal(f.host.getSnapshot().status, 'retired');
        assert.equal(f.container.textContent, '');
    });

it('readonly attachment accepted Form host replacement cannot inherit retired predecessor labels', async (t) => {
    const f = await formFixture(t);
    await f.render(f.tree());
    await act(async () => f.owner.destroy());
    const loaded = loadedForm();
    const schema = loaded.payload.fieldIdsToSchemas.fld_files;
    assert.ok(schema.fieldType === 'multipleAttachments');
    schema.miniExtConfig = { readOnly: true, hideAttachmentName: false };
    loaded.payload.formRecord.data.fld_files = [
        { ...native, filename: 'Accepted successor label' },
    ];
    const owner = createFormFieldBindings({
        client: f.client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'successor', revision: 0 }),
    });
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_files',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => {
        host.dispose();
        owner.destroy();
    });
    await f.render(h('div', null, hostTree(f.host), hostTree(host)));
    assert.deepEqual(labels(f), ['Accepted successor label']);
    assert.equal(f.host.getSnapshot().status, 'retired');
    passive(f);
});

async function portalDetailFixture(
    t: TestContext,
    config: FieldConfig<'multipleAttachments'> = { hideAttachmentName: false },
    hidden = false
) {
    const f = await domFixture(t);
    const schema = loadedForm().payload.fieldIdsToSchemas.fld_files;
    const detail = {
        fieldId: 'fld_files',
        fieldName: 'Files',
        titleOverride: 'Portal labels',
        isHidden: hidden,
        fieldIsInEditingChildForm: false,
        childFormField: null,
        miniExtConfig: config,
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
                            fields: { fld_files: [native, native] },
                        },
                    },
                },
            },
        })
    );
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage({ disableInlineEdit: false }),
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
        getScope: () => ({ ownerId: 'portal', revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const lease = { current: true, configuration: 0 };
    const options = {
        owner,
        client: api.client,
        recordId: 'record_1',
        isCurrent: () => lease.current,
        configurationRevision: () => lease.configuration,
    };
    const host = createPortalDetailRendererHost(options);
    t.after(() => {
        host.dispose();
        owner.destroy();
        assert.equal(api.calls.length, 1);
        assert.equal(api.mutations, 0);
    });
    return {
        ...f,
        api,
        owner,
        lease,
        options,
        host,
        tree: () => hostTree(host),
    };
}

it('readonly attachment real Portal-detail host supplies duplicate labels without exposing native metadata or actions', async (t) => {
    const f = await portalDetailFixture(t);
    await f.render(f.tree());
    assert.deepEqual(labels(f), [literal, literal]);
    passive(f);
    const state = f.host.getSnapshot();
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready') throw Error('Expected ready Portal detail');
    assert.deepEqual(state.fields[0].value, [native, native]);
    await f.unmount();
    await f.render(f.tree());
    assert.deepEqual(labels(f), [literal, literal]);
});

for (const [name, config, expected] of [
    ['masked', { obscurePassword: true }, masked],
    ['name hidden', { hideAttachmentName: true }, 'Attachment'],
    ['name policy absent', {}, 'Attachment'],
    ['unavailable add-only', { addOnlyMode: true }, unavailable],
] as const)
    it(`readonly attachment Portal-detail ${name} respects returned policy`, async (t) => {
        const f = await portalDetailFixture(
            t,
            config as FieldConfig<'multipleAttachments'>
        );
        await f.render(f.tree());
        if (expected === 'Attachment')
            assert.deepEqual(labels(f), ['Attachment', 'Attachment']);
        else inert(f, expected);
        assert.equal(f.container.textContent?.includes(literal), false);
        passive(f);
    });

it('readonly attachment hidden Portal-detail and linked-detail contexts remain outside visible label coverage', async (t) => {
    const f = await portalDetailFixture(t, { hideAttachmentName: false }, true);
    await f.render(f.tree());
    assert.equal(f.container.textContent, '');
    const linked = createPortalDetailRendererHost({
        ...f.options,
        context: 'linked-detail',
    });
    t.after(() => linked.dispose());
    await f.render(hostTree(linked));
    assert.equal(f.container.textContent, '');
});

it('readonly attachment visible linked-detail remains unavailable despite matching physical kind', async (t) => {
    const f = await portalDetailFixture(t);
    const linked = createPortalDetailRendererHost({
        ...f.options,
        context: 'linked-detail',
    });
    t.after(() => linked.dispose());
    await f.render(hostTree(linked));
    inert(f);
});

for (const cause of ['configuration', 'current', 'session', 'destroy'] as const)
    it(`readonly attachment Portal-detail ${cause} retirement clears the subscribed shell and resists ABA`, async (t) => {
        const f = await portalDetailFixture(t);
        await f.render(f.tree());
        assert.deepEqual(labels(f), [literal, literal]);
        await act(async () => {
            if (cause === 'configuration') f.lease.configuration++;
            else if (cause === 'current') f.lease.current = false;
            else if (cause === 'session')
                f.api.client.setSession({ visitor: 'visitor_B' });
            else f.owner.destroy();
            f.host.getSnapshot();
        });
        await f.render(f.tree());
        assert.equal(f.host.getSnapshot().status, 'retired');
        assert.equal(f.container.textContent, '');
        if (cause === 'configuration') f.lease.configuration--;
        if (cause === 'current') f.lease.current = true;
        if (cause === 'session')
            await act(async () =>
                f.api.client.setSession({ visitor: 'visitor_A' })
            );
        await f.render(f.tree());
        assert.equal(f.host.getSnapshot().status, 'retired');
        assert.equal(f.container.textContent, '');
    });
