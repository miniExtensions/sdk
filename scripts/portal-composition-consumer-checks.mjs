import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';
import { rendererTypedConsumer } from './renderer-consumer-checks.mjs';

// The existing declaration oracle checks every named slot's metadata/value/config correlation.
export const portalCompositionTypedConsumer = `
import { createElement, type ReactNode } from 'react';
import { AirtableGrid, AirtableList } from '@miniextensions/sdk/react';
import { createPortalRenderScope, type PortalRenderScope, type PortalRenderSnapshot } from '@miniextensions/sdk/ui';
import type { PortalListOwner, PortalCellBinding } from '@miniextensions/sdk/portals';
import type { MiniExtensionsClient } from '@miniextensions/sdk';
${rendererTypedConsumer.replace('Required<FieldRendererSlots<string>>', 'Required<FieldRendererSlots<ReactNode>>').replace('const rendered: string =', 'const rendered: ReactNode =')}
declare const owner: PortalListOwner;
declare const client: MiniExtensionsClient;
declare const cell: PortalCellBinding;
const scope: PortalRenderScope = createPortalRenderScope({owner,client,isCurrent:()=>true,configurationRevision:()=>0,resolveCell:({recordId,fieldId,ownerRevision})=>{void [recordId,fieldId,ownerRevision];return cell;}});
const snapshot: PortalRenderSnapshot = scope.getSnapshot();
for(const Component of [AirtableGrid,AirtableList]) createElement(Component,{scope,renderers:slots,children:state=>{
 const rows:readonly {recordId:string;cells:readonly {fieldId:string;node:ReactNode}[]}[]=state.rows;
 // @ts-expect-error layout cells expose nodes, not ownership handles
 state.rows[0].cells[0].host;
 return createElement('section',null,...rows.map(row=>createElement('article',{key:row.recordId},...row.cells.map(c=>c.node))));
}});
// @ts-expect-error layout is required
createElement(AirtableGrid,{scope,renderers:slots});
// @ts-expect-error layout is required for list too
createElement(AirtableList,{scope,renderers:slots});
// @ts-expect-error observed configuration revision is required
createPortalRenderScope({owner,client,isCurrent:()=>true});
// @ts-expect-error scope does not write native cells
scope.setValue('replacement');
void snapshot;
`;

const completeField = (field) => ({
    description: null,
    isComputed: false,
    isPrimaryField: false,
    ...field,
    config: {
        ...field.config,
        ...(field.config.type === 'singleLineText' ? { options: null } : {}),
    },
});
const completePage = (page) => {
    for (const table of Object.values(page.tableIdsToLinkedTableStates))
        table.airtableFields = table.airtableFields.map(completeField);
    return page;
};
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
function fixture(portals, configure = () => {}) {
    const portal = fixtures.makePortal();
    const config = portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
    config.layout = 'grid';
    config.disableInlineEdit = false;
    config.customViews[0].config.layout = 'grid';
    config.customViews[0].config.disableInlineEdit = false;
    configure(portal);
    for (const schema of Object.values(portal.payload.fieldIdsToSchemas))
        schema.airtableField = completeField(schema.airtableField);
    let configuration = 0,
        current = true,
        context = { ownerId: 'visitor', revision: 0 };
    let respond = () =>
        fixtures.page([fixtures.record('rec_one', 'Native', 12)], 'next');
    const reads = [],
        saves = [];
    const client = {
        getSession: () => ({}),
        portals: {
            listLinkedRecords: async (input) => {
                reads.push(structuredClone(input));
                return completePage(respond());
            },
            updateGridCell: async (input) => {
                saves.push(structuredClone(input));
                return { success: true };
            },
        },
    };
    const criteria = {
        selectedCustomViewId: 'view_example',
        searchTerm: null,
        searchParamsMap: { retained: 'exact' },
        sortFieldsByEndUser: null,
        filtersByEndUser: null,
        supportsEndUserSortCleanup: true,
        supportsEndUserFilterCleanup: true,
    };
    const owner = portals.createPortalListOwner({
        client,
        portal,
        portalFieldId: 'fld_children',
        criteria,
        getScope: () => context,
        isCurrent: () => current,
        configurationRevision: () => configuration,
    });
    return {
        portal,
        client,
        owner,
        criteria,
        reads,
        saves,
        options: {
            owner,
            client,
            isCurrent: () => current,
            configurationRevision: () => configuration,
        },
        respond: (fn) => (respond = fn),
        bump: () => configuration++,
        resetConfiguration: () => (configuration = 0),
        retire: () => (current = false),
        context: () =>
            (context = { ownerId: 'other', revision: context.revision + 1 }),
    };
}
async function mountCheck(
    f,
    scope,
    api,
    require,
    happyDomModulePath,
    cells,
    guide,
    external
) {
    const { Window } = createRequire(import.meta.url)(
        happyDomModulePath || 'happy-dom'
    );
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((k) =>
        Object.getOwnPropertyDescriptor(globalThis, k)
    );
    keys.forEach((k) =>
        Object.defineProperty(globalThis, k, {
            configurable: true,
            writable: true,
            value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[k],
        })
    );
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container),
        mounted = true,
        state,
        text,
        numeric;
    const renderers = {
        renderSingleLineTextField: (p) => {
            text = p;
            return h('span', { 'data-field': 'title' }, p.value ?? '');
        },
        renderNumberField: (p) => {
            numeric = p;
            return h(
                'span',
                { 'data-field': 'number' },
                p.capability.type === 'editable'
                    ? p.capability.scalar.state.input
                    : String(p.value ?? '')
            );
        },
    };
    const tree = (Component) =>
        h(
            StrictMode,
            null,
            external
                ? h(api.FieldRenderer, {
                      host: external.host,
                      renderers: {
                          renderMultipleAttachmentsField: (p) =>
                              h(
                                  'output',
                                  { 'data-external-files': true },
                                  String(
                                      p.capability.attachment.state.files.length
                                  )
                              ),
                      },
                  })
                : null,
            h(Component, {
                scope,
                renderers,
                children: (s) => {
                    state = s;
                    return h(
                        'section',
                        null,
                        ...s.rows.map((row) =>
                            h(
                                'article',
                                {
                                    key: row.recordId,
                                    'data-record': row.recordId,
                                },
                                ...row.cells.map((c) =>
                                    h('div', { key: c.fieldId }, c.node)
                                )
                            )
                        )
                    );
                },
            })
        );
    try {
        await act(async () => root.render(tree(api.AirtableGrid)));
        assert.equal(f.reads.length, 0, 'StrictMode mount never reads');
        assert.equal(f.saves.length, 0);
        assert.equal(container.textContent, external ? '0' : '');
        if (external) {
            const selected = new window.File(['native bytes'], 'queued.txt', {
                type: 'text/plain',
            });
            await act(async () =>
                assert.equal(external.attachment.select([selected]), true)
            );
            external.selected = selected;
            assert.equal(external.attachment.getSnapshot().files[0], selected);
        }
        if (guide) {
            await act(async () =>
                root.render(
                    h(
                        StrictMode,
                        null,
                        h(guide.CustomPortal, { scope, renderers })
                    )
                )
            );
            assert.equal(
                f.reads.length,
                0,
                'actual shipped CustomPortal mount never reads'
            );
            await act(async () => container.querySelector('button').click());
            assert.equal(f.reads.length, 1);
            assert.equal(container.querySelectorAll('article').length, 1);
            f.respond(() =>
                fixtures.page([fixtures.record('rec_two', 'Guide more')], null)
            );
            await act(async () =>
                [...container.querySelectorAll('button')]
                    .find((b) => b.textContent === 'More')
                    .click()
            );
            assert.equal(f.reads.length, 2);
            assert.equal(container.querySelectorAll('article').length, 2);
            assert.equal(f.reads[1].airtableOffset, 'next');
            return;
        }
        const initial = state.actions;
        await act(async () => {
            assert.equal(await initial.load(readOptions), true);
        });
        assert.equal(f.reads.length, 1);
        assert.equal(container.querySelectorAll('article').length, 1);
        assert.deepEqual(
            state.rows[0].cells.map((c) => c.fieldId),
            ['fld_title', 'fld_quantity']
        );
        assert.equal('host' in state.rows[0].cells[0], false);
        assert.equal(text.capability.type, cells ? 'editable' : 'readonly');
        if (cells) {
            await act(async () => {
                assert.equal(text.capability.setValue('Edited').accepted, true);
                numeric.capability.scalar.setInput('-');
            });
            assert.equal(cells.title.binding.getSnapshot().value, 'Edited');
            assert.equal(cells.quantity.binding.getSnapshot().value, 12);
            assert.equal(
                container.querySelector('[data-field=number]').textContent,
                '-'
            );
        } else assert.equal('setValue' in text.capability, false);
        await act(async () => root.unmount());
        mounted = false;
        root = createRoot(container);
        mounted = true;
        await act(async () => root.render(tree(api.AirtableList)));
        assert.equal(f.reads.length, 1, 'remount never reads');
        assert.equal(scope.getSnapshot().retired, false);
        if (external) {
            assert.equal(
                external.attachment.getSnapshot().files[0],
                external.selected
            );
            assert.equal(
                container.querySelector('[data-external-files]').textContent,
                '1'
            );
        }
        if (cells) {
            assert.equal(
                container.querySelector('[data-field=title]').textContent,
                'Edited'
            );
            assert.equal(
                container.querySelector('[data-field=number]').textContent,
                '-'
            );
            await act(async () => numeric.capability.scalar.setInput('23'));
            await act(async () => cells.quantity.save());
            assert.equal(f.saves.length, 1);
            assert.equal(f.saves[0].value, 23);
            assert.equal(f.saves[0].recordId, 'rec_one');
            assert.equal(f.saves[0].recordFieldId, 'fld_quantity');
            assert.equal(f.saves[0].selectedCustomViewId, 'view_example');
        }
        const stale = state.actions;
        await act(async () =>
            assert.equal(
                state.actions.setCriteria({
                    ...f.criteria,
                    searchTerm: 'replacement',
                }),
                true
            )
        );
        assert.equal(container.textContent, external ? '1' : '');
        assert.equal(await stale.load(readOptions), false);
        assert.equal(await stale.more(readOptions), false);
        assert.equal(stale.setCriteria(f.criteria), false);
        assert.equal(f.reads.length, 1);
        await act(async () => scope.destroy());
        assert.equal(scope.getSnapshot().retired, true);
        if (external) {
            assert.equal(
                external.attachment.getSnapshot().files[0],
                external.selected
            );
            assert.equal(external.uploads.length, 0);
        }
        assert.equal(
            f.owner.getSnapshot().criteria.searchTerm,
            'replacement',
            'scope borrows owner'
        );
    } finally {
        if (mounted) await act(async () => root.unmount());
        container.remove();
        await window.happyDOM.abort();
        keys.forEach((k, i) =>
            previous[i]
                ? Object.defineProperty(globalThis, k, previous[i])
                : delete globalThis[k]
        );
    }
}

/** Exercise actual installed ESM and CJS modules with synthetic transport only. */
export async function checkPortalCompositionConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const apis = await Promise.all(
        ['portals', 'ui', 'react', 'forms'].map(
            (entry) => import(pathToFileURL(join(esm, entry, 'index.js')))
        )
    );
    const guideText = readFileSync(
        join(
            consumerDirectory,
            'node_modules/@miniextensions/sdk/docs/field-bindings.md'
        ),
        'utf8'
    );
    const fences = [...guideText.matchAll(/```(?:ts|tsx)\n([\s\S]*?)```/g)].map(
        (m) => m[1]
    );
    const guideSource = ['createPortalPresentation', 'CustomPortal']
        .map((name) => {
            const source = fences.find((code) =>
                code.includes(`export function ${name}(`)
            );
            assert(source, `installed guide exports ${name}`);
            return source;
        })
        .join('\n');
    const guidePath = join(
        consumerDirectory,
        'portal-composition-shipped-guide.mjs'
    );
    writeFileSync(
        guidePath,
        (
            await transform(guideSource, {
                loader: 'tsx',
                format: 'esm',
                jsx: 'automatic',
            })
        ).code
    );
    const guide = await import(pathToFileURL(guidePath));
    let checks = 0;
    for (const [portals, ui, react, forms] of [
        apis,
        ['portals', 'ui', 'react', 'forms'].map((entry) =>
            require(`@miniextensions/sdk/${entry}`)
        ),
    ]) {
        const resources = [];
        const make = (configure) => {
            const f = fixture(portals, configure);
            resources.push(() => f.owner.destroy());
            return f;
        };
        const scope = (f, extra = {}) => {
            const s = ui.createPortalRenderScope({ ...f.options, ...extra });
            resources.push(() => s.destroy());
            return s;
        };
        try {
            if (portals === apis[0]) {
                const p = make(),
                    q = guide.createPortalPresentation(p.options);
                resources.push(() => q.destroy());
                await mountCheck(
                    p,
                    q,
                    react,
                    require,
                    happyDomModulePath,
                    undefined,
                    guide
                );
                checks++;
            }
            const f = make(),
                s = scope(f);
            assert.equal(s.owner, f.owner);
            await mountCheck(f, s, react, require, happyDomModulePath);
            checks++;
            // Caller-owned native bindings are resolved after the explicit read; the scope never creates them.
            const g = make();
            let cells;
            const native = (fieldId, value, fixture = g) => {
                const field = completeField(
                    fieldId === 'fld_title'
                        ? fixtures.titleField
                        : fixtures.quantityField
                );
                const cell = portals.createPortalCellBinding({
                    client: fixture.client,
                    schema: {
                        fieldType: field.config.type,
                        airtableField: field,
                    },
                    value,
                    input: {
                        portalExtensionAccessToken:
                            fixture.portal.payload.extensionAccessToken,
                        portalFieldId: 'fld_children',
                        recordId: 'rec_one',
                        recordFieldId: fieldId,
                        selectedCustomViewId: 'view_example',
                    },
                    getScope: () => ({ ownerId: 'visitor', revision: 0 }),
                    isCurrent: () =>
                        fixture.owner.isCurrent(
                            fixture.owner.getSnapshot().revision
                        ),
                    recovery: {
                        journal: new forms.RecoveryJournal(),
                        scope: {
                            owner: 'visitor',
                            parentFieldId: 'fld_children',
                            tableId: 'tbl_children',
                            childExtensionId: '',
                            context: 'modal',
                        },
                        loadVersion: 1,
                    },
                });
                resources.push(() => cell.destroy());
                return cell;
            };
            cells = {
                title: native('fld_title', 'Native'),
                quantity: native('fld_quantity', 12),
            };
            const editable = scope(g, {
                resolveCell: ({ recordId, fieldId }) =>
                    recordId === 'rec_one'
                        ? fieldId === 'fld_title'
                            ? cells.title
                            : fieldId === 'fld_quantity'
                              ? cells.quantity
                              : null
                        : null,
            });
            const loaded = fixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['files'];
            loaded.payload.fieldIdsToSchemas = {
                files: {
                    fieldType: 'multipleAttachments',
                    airtableField: {
                        id: 'files',
                        name: 'Files',
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                        config: {
                            type: 'multipleAttachments',
                            options: { isReversed: false },
                        },
                    },
                    miniExtConfig: {},
                },
            };
            loaded.payload.formRecord = { type: 'create', data: { files: [] } };
            loaded.payload.formFieldIdsWithUnsavedChanges = [];
            loaded.payload.urlPrefilledFieldIds = [];
            const uploads = [];
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    attachments: {
                        uploadFile: async (input) => {
                            uploads.push(input);
                            throw Error('Unexpected upload');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'visitor', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: {},
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            resources.push(() => fields.destroy());
            const recovery = {
                journal: new forms.RecoveryJournal(),
                loadVersion: 1,
                scope: {
                    owner: 'visitor',
                    parentFieldId: null,
                    tableId: null,
                    childExtensionId: loaded.extensionId,
                    context: 'direct-url',
                },
            };
            const attachment = fields.attachment('files', recovery);
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'files',
                isCurrent: () => true,
                configurationRevision: () => 0,
                attachmentRecovery: recovery,
            });
            resources.push(() => host.dispose());
            await mountCheck(
                g,
                editable,
                react,
                require,
                happyDomModulePath,
                cells,
                undefined,
                { attachment, host, uploads }
            );
            checks++;
            for (const projection of ['null', 'empty', 'hidden']) {
                const p = make((portal) => {
                    if (projection === 'hidden')
                        portal.payload.linkedRecordFieldIdToDetailFields.fld_children.forEach(
                            (d) => (d.isHidden = true)
                        );
                });
                p.respond(() =>
                    fixtures.page(
                        [fixtures.record('rec_one', 'Native', 12)],
                        null,
                        projection === 'empty'
                            ? { customViewDetailFields: { fld_children: [] } }
                            : {}
                    )
                );
                const q = scope(p);
                assert.equal(
                    await q.getSnapshot().actions.load(readOptions),
                    true
                );
                assert.equal(q.getSnapshot().rows.length, 1);
                assert.equal(
                    q.getSnapshot().rows[0].cells.length,
                    projection === 'null' ? 2 : 0
                );
                assert.equal(p.saves.length, 0);
                checks++;
            }
            {
                const p = make(),
                    q = scope(p);
                await q.getSnapshot().actions.load(readOptions);
                const retained = q.getSnapshot().actions;
                const child = retained.childFormRequest({
                    access: { type: 'edit', recordId: 'rec_one' },
                    configuredChildExtensionId: 'child_example',
                });
                assert.equal(child.isCurrent(), true);
                p.respond(() =>
                    fixtures.page([fixtures.record('rec_two', 'Second')], null)
                );
                assert.equal(await retained.more(readOptions), true);
                assert.equal(p.reads[1].airtableOffset, 'next');
                assert.deepEqual(
                    q.getSnapshot().rows.map((r) => r.recordId),
                    ['rec_one', 'rec_two']
                );
                assert.equal(await retained.more(readOptions), false);
                assert.equal(child.isCurrent(), false);
                checks++;
            }
            {
                const p = make(),
                    q = scope(p);
                p.respond(() =>
                    fixtures.page([], null, {
                        endUserSortCleanup: { sortFields: [] },
                    })
                );
                await q.getSnapshot().actions.load(readOptions);
                assert.equal(q.getSnapshot().owner.phase, 'cleanup');
                const old = q.getSnapshot().actions;
                assert.equal(old.acceptCleanup(), true);
                assert.equal(old.dismissCleanup(), false);
                assert.equal(p.reads.length, 1);
                checks++;
            }
            {
                const p = make();
                let q,
                    armed = false;
                q = scope(p, {
                    resolveCell: () => {
                        if (armed) {
                            armed = false;
                            q.destroy();
                        }
                        return null;
                    },
                });
                const old = q.getSnapshot().actions;
                armed = true;
                await old.load(readOptions);
                assert.equal(q.getSnapshot().retired, true);
                assert.equal(q.getSnapshot().rows.length, 0);
                assert.equal(await old.more(readOptions), false);
                assert.equal(old.setCriteria(p.criteria), false);
                assert.equal(p.reads.length, 1);
                checks++;
            }
            for (const failureMode of ['resolver', 'subscription']) {
                const p = make();
                const subscribe = p.owner.subscribe;
                let liveSubscriptions = 0,
                    subscribeAttempts = 0,
                    subscriptionFailureObserved = false;
                p.owner.subscribe = function (...args) {
                    subscribeAttempts++;
                    if (
                        failureMode === 'subscription' &&
                        subscribeAttempts === 3
                    ) {
                        subscriptionFailureObserved = true;
                        throw new Error(
                            'Synthetic later host subscription failure'
                        );
                    }
                    const stop = subscribe.apply(this, args);
                    liveSubscriptions++;
                    let active = true;
                    return () => {
                        if (!active) return;
                        active = false;
                        liveSubscriptions--;
                        stop();
                    };
                };
                const failure = new Error(
                    'Synthetic second-row resolver failure'
                );
                const resolved = [];
                const q = scope(p, {
                    resolveCell: ({ recordId, fieldId }) => {
                        resolved.push([recordId, fieldId]);
                        if (
                            failureMode === 'resolver' &&
                            recordId === 'rec_two'
                        )
                            throw failure;
                        return null;
                    },
                });
                const old = q.getSnapshot().actions;
                p.respond(() =>
                    fixtures.page(
                        [
                            fixtures.record('rec_one', 'First', 12),
                            fixtures.record('rec_two', 'Second', 24),
                        ],
                        null
                    )
                );
                await old.load(readOptions);
                assert(resolved.some(([id]) => id === 'rec_one'));
                if (failureMode === 'resolver') {
                    assert(resolved.some(([id]) => id === 'rec_two'));
                    assert.equal(subscriptionFailureObserved, false);
                } else {
                    assert.equal(subscriptionFailureObserved, true);
                    assert.equal(subscribeAttempts, 3);
                    assert.equal(
                        resolved.some(([id]) => id === 'rec_two'),
                        false
                    );
                }
                const retired = q.getSnapshot();
                assert.equal(retired.retired, true);
                assert.deepEqual(retired.rows, []);
                assert.equal(retired.records, null);
                assert.equal(await old.load(readOptions), false);
                assert.equal(await old.more(readOptions), false);
                assert.equal(old.setCriteria(p.criteria), false);
                assert.equal(
                    liveSubscriptions,
                    0,
                    'failed acquisition immediately releases all subscriptions'
                );
                q.destroy();
                assert.equal(
                    liveSubscriptions,
                    0,
                    'destroy remains idempotent'
                );
                assert.equal(p.owner.getSnapshot().phase, 'ready');
                assert.equal(
                    p.owner.setCriteria(p.owner.getSnapshot().revision, {
                        ...p.criteria,
                        searchTerm: 'borrowed owner survives',
                    }),
                    true
                );
                assert.equal(
                    await p.owner.readFirst(
                        p.owner.getSnapshot().revision,
                        readOptions
                    ),
                    true
                );
                assert.equal(p.reads.length, 2);
                assert.equal(p.saves.length, 0);
                checks++;
            }
            for (const action of ['setCriteria', 'more']) {
                const firedOrdinals = [];
                for (let ordinal = 1; ordinal <= 6; ordinal++) {
                    const p = make();
                    const cell = native('fld_title', 'Native', p);
                    let armed = false,
                        calls = 0,
                        fired = false,
                        expectedOwnerRevision;
                    const q = scope(p, {
                        resolveCell: ({ fieldId }) =>
                            fieldId === 'fld_title' ? cell : null,
                        isCurrent: () => {
                            if (
                                armed &&
                                p.owner.getSnapshot().revision ===
                                    expectedOwnerRevision &&
                                ++calls === ordinal
                            ) {
                                armed = false;
                                fired = true;
                                assert.equal(
                                    cell.binding.setValue(`Injected ${ordinal}`)
                                        .accepted,
                                    true
                                );
                            }
                            return true;
                        },
                    });
                    await q.getSnapshot().actions.load(readOptions);
                    const retained = q.getSnapshot().actions;
                    const ownerRevision = p.owner.getSnapshot().revision;
                    expectedOwnerRevision = ownerRevision;
                    armed = true;
                    const accepted =
                        action === 'setCriteria'
                            ? retained.setCriteria({
                                  ...p.criteria,
                                  searchTerm: 'must remain absent',
                              })
                            : await retained.more(readOptions);
                    armed = false;
                    if (fired) {
                        firedOrdinals.push(ordinal);
                        assert.equal(
                            accepted,
                            false,
                            `${action} must reject a callback-induced cell revision at ordinal ${ordinal}`
                        );
                        assert.equal(
                            p.owner.getSnapshot().revision,
                            ownerRevision
                        );
                        assert.equal(
                            p.owner.getSnapshot().criteria.searchTerm,
                            null
                        );
                        assert.equal(p.reads.length, 1);
                        assert.equal(p.saves.length, 0);
                    }
                    q.destroy();
                }
                assert(
                    firedOrdinals.length > 0,
                    `${action} exercised actual application lease callbacks`
                );
                checks++;
            }
            for (const invalidation of [
                'configuration',
                'context',
                'retire',
                'view',
                'destroy',
            ]) {
                const p = make((portal) => {
                        if (invalidation === 'view')
                            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig.customViews.push(
                                {
                                    id: 'view_second',
                                    config: {
                                        name: 'Second view',
                                        viewBehavior: 'custom',
                                        layout: 'grid',
                                        disableInlineEdit: false,
                                    },
                                }
                            );
                    }),
                    q = scope(p);
                await q.getSnapshot().actions.load(readOptions);
                const old = q.getSnapshot().actions;
                if (invalidation === 'configuration') {
                    p.bump();
                    q.getSnapshot();
                    p.resetConfiguration();
                }
                if (invalidation === 'context') p.context();
                if (invalidation === 'retire') p.retire();
                if (invalidation === 'view')
                    assert.equal(
                        p.owner.setCriteria(p.owner.getSnapshot().revision, {
                            ...p.criteria,
                            selectedCustomViewId: 'view_second',
                        }),
                        true,
                        'view replacement must be accepted'
                    );
                if (invalidation === 'destroy') q.destroy();
                assert.equal(
                    await old.load(readOptions),
                    false,
                    `${invalidation} fences retained action: await old.load(readOptions)`
                );
                assert.equal(
                    await old.more(readOptions),
                    false,
                    `${invalidation} fences retained action: await old.more(readOptions)`
                );
                assert.equal(
                    old.setCriteria(p.criteria),
                    false,
                    `${invalidation} fences retained action: old.setCriteria(p.criteria)`
                );
                assert.equal(
                    old.acceptCleanup(),
                    false,
                    `${invalidation} fences retained action: old.acceptCleanup()`
                );
                assert.equal(
                    old.dismissCleanup(),
                    false,
                    `${invalidation} fences retained action: old.dismissCleanup()`
                );
                assert.equal(
                    old.setField('fld_children', p.criteria),
                    false,
                    `${invalidation} fences retained action: old.setField(fld_children, p.criteria)`
                );
                assert.throws(() =>
                    old.childFormRequest({
                        access: { type: 'edit', recordId: 'rec_one' },
                        configuredChildExtensionId: 'child_example',
                    })
                );
                old.cancel();
                assert.equal(
                    p.reads.length,
                    1,
                    `${invalidation} causes no extra reads`
                );
                assert.equal(
                    p.saves.length,
                    0,
                    `${invalidation} causes no Save`
                );
                checks++;
            }
            {
                const p = make(),
                    q = scope(p);
                let armed = false;
                q.subscribe(() => {
                    if (armed) {
                        armed = false;
                        q.destroy();
                    }
                });
                const observed = [];
                q.subscribe((state) => observed.push(state.retired));
                armed = true;
                await q.getSnapshot().actions.load(readOptions);
                assert.equal(q.getSnapshot().retired, true);
                assert.equal(observed.at(-1), true);
                checks++;
            }
        } finally {
            for (const dispose of resources.reverse()) dispose();
        }
    }
    console.log(
        `Installed Portal composition: ${checks} checks; ESM/CJS StrictMode layouts, native cell Save and stale actions.`
    );
    return checks;
}
