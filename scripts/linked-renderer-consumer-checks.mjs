import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const nativeIds = ['rec_one', 'rec_missing', 'rec_one'];
const complete = (field) => ({
    description: null,
    isComputed: false,
    isPrimaryField: false,
    ...field,
    config: {
        ...field.config,
        ...(field.config.type === 'singleLineText' ? { options: null } : {}),
    },
});
const physical = [
    complete(fixtures.titleField),
    complete(fixtures.quantityField),
];
const row = (id, title = id) => fixtures.record(id, title, 2);
const table = (records) => ({
    airtableFields: structuredClone(physical),
    recordIdsToAirtableRecords: Object.fromEntries(
        records.map((r) => [r.id, structuredClone(r)])
    ),
});
const page = (records, offset = null) => ({
    records,
    offset,
    linkedRecordFieldIdToDetailFields: null,
    tableIdsToLinkedTableStates: { tbl_children: table(records) },
});
const saveOptions = {
    captchaVal: null,
    isComputeMode: false,
    context: { type: 'direct-url' },
    searchQuery: {},
    conditionalLinkedRecordFieldIdsToFilteringValues: {},
};
function loaded(readOnly = false) {
    const value = fixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    value.payload.fieldIdsInForm.push('fld_parent');
    const schema = value.payload.fieldIdsToSchemas.fld_parent;
    schema.airtableField = complete(schema.airtableField);
    schema.airtableField.config.options.linkedTableId = 'tbl_children';
    schema.airtableField.config.options.prefersSingleRecordLink = false;
    schema.miniExtConfig = { readOnly };
    value.payload.urlPrefilledFieldIds = [];
    value.payload.formRecord.data.fld_parent = [...nativeIds];
    return value;
}
const propsOf = (host) => {
    const snapshot = host.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.fields[0].physicalKind, 'multipleRecordLinks');
    assert.equal(snapshot.fields[0].linkedRecords.source, 'form');
    return snapshot.fields[0];
};

/** Installed public SDKs only; transports are local synthetic promises. */
export async function checkLinkedRendererConsumer({
    consumerDirectory,
    reactModules = {},
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const base = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const esm = Object.fromEntries(
        await Promise.all(
            ['ui', 'forms', 'react'].map(async (name) => [
                name,
                await import(pathToFileURL(join(base, name, 'index.js'))),
            ])
        )
    );
    const cjs = Object.fromEntries(
        ['ui', 'forms', 'react'].map((name) => [
            name,
            require(`@miniextensions/sdk/${name}`),
        ])
    );
    const resources = [];
    let checks = 0;
    const grouped = [];
    const checked = (name) => {
        checks++;
        grouped.push(name);
    };
    function setup(api, readOnly = false, scope = {}) {
        let current = true,
            visitor = scope.visitor ?? 'synthetic';
        const calls = { selected: [], options: [], saves: [] };
        let selected = async () => ({
            tbl_children: table([row('rec_one', 'Hydrated')]),
        });
        let options = async () =>
            page([row('rec_candidate', 'Candidate')], 'next');
        const client = {
            getSession: () => ({ visitor }),
            linkedRecords: {
                loadSelectedRecords: (...args) => {
                    calls.selected.push(args);
                    return selected(...args);
                },
                listFormOptions: (...args) => {
                    calls.options.push(args);
                    return options(...args);
                },
            },
            forms: {
                save: async (input) => {
                    calls.saves.push(structuredClone(input));
                    throw Error('synthetic save observation');
                },
            },
        };
        const fields = api.forms.createFormFieldBindings({
            loaded: loaded(readOnly),
            client,
            getScope: () => ({
                ownerId: scope.ownerId ?? 'child-owner',
                revision: 0,
            }),
            parent: scope.parent,
            isCurrent: () => current,
            configurationRevision: () => 0,
            saveOptions: scope.saveOptions ?? saveOptions,
        });
        resources.push(() => fields.destroy());
        const host = () => {
            const host = api.ui.createFormFieldRendererHost({
                fields,
                fieldId: 'fld_parent',
                isCurrent: () => current,
                configurationRevision: () => 0,
            });
            resources.push(() => host.dispose());
            return host;
        };
        const loader = () =>
            api.ui.createFormLinkedRecordLoader({
                client,
                input: {
                    extensionAccessToken: 'child_access_example',
                    linkedRecordFieldId: 'fld_parent',
                },
                linkedTableId: 'tbl_children',
            });
        return {
            fields,
            calls,
            host,
            retire: () => {
                current = false;
                visitor = 'replacement-visitor';
            },
            loader,
            setSelected: (fn) => {
                selected = fn;
            },
            setOptions: (fn) => {
                options = fn;
            },
        };
    }
    try {
        for (const [format, api] of [
            ['esm', esm],
            ['cjs', cjs],
        ]) {
            const f = setup(api, true),
                host = f.host(),
                siblingHost = f.host();
            const borrowed = f.fields.linkedRecords('fld_parent');
            const props = propsOf(host);
            assert.equal(props.capability.type, 'readonly');
            assert.equal('setValue' in props.capability, false);
            assert.equal('linkedRecords' in props.capability, false);
            assert.deepEqual(props.value, nativeIds);
            assert.deepEqual(
                props.linkedRecords.state.unresolvedSelectedIds,
                nativeIds
            );
            assert.equal(
                f.calls.selected.length +
                    f.calls.options.length +
                    f.calls.saves.length,
                0
            );
            const held = fixtures.deferred();
            f.setSelected(() => held.promise);
            const first = props.linkedRecords.readSelected(),
                second = propsOf(siblingHost).linkedRecords.readSelected();
            await Promise.resolve();
            assert.equal(f.calls.selected.length, 1);
            assert.deepEqual(f.calls.selected[0][0], {
                extensionAccessToken: 'child_access_example',
            });
            let notifications = 0;
            const stop = host.subscribe(() => {
                notifications++;
            });
            held.resolve({ tbl_children: table([row('rec_one', 'Hydrated')]) });
            assert.equal(await first, true);
            assert.equal(await second, true);
            assert.ok(notifications > 0);
            stop();
            assert.deepEqual(
                propsOf(host).linkedRecords.state.selectedRecords.map(
                    (r) => r.id
                ),
                ['rec_one', 'rec_one']
            );
            assert.deepEqual(
                propsOf(host).linkedRecords.state.unresolvedSelectedIds,
                ['rec_missing']
            );
            assert.deepEqual(
                propsOf(host).linkedRecords.state,
                borrowed.getSnapshot()
            );
            assert.deepEqual(
                f.fields.field('fld_parent').getSnapshot().value,
                nativeIds
            );
            assert.equal(
                f.fields.field('fld_parent').getSnapshot().dirty,
                false
            );
            checked(
                `${format}: passive readonly bridge and shared token-only selected hydration`
            );

            const editable = setup(api);
            editable.fields.setLinkedLoader('fld_parent', editable.loader());
            const editHost = editable.host();
            const selection = editable.fields.field('fld_parent').selection;
            const observed = [];
            const off = editHost.subscribe(() => {
                const p = propsOf(editHost);
                const rich = p.linkedRecords.state.candidateRecords;
                const state = p.capability.selection.state;
                if (rich.length)
                    observed.push({
                        rich: rich.map((r) => r.id),
                        options: state.options.map((o) => o.value),
                        offset: state.offset,
                    });
            });
            await selection.reload();
            assert.ok(observed.length > 0);
            observed.forEach((s) => {
                assert.deepEqual(s.rich, s.options);
                assert.equal(s.offset, 'next');
            });
            const old = fixtures.deferred();
            editable.setOptions(() => old.promise);
            const stale = selection.setSearchTerm('old');
            await Promise.resolve();
            editable.setOptions(async () => page([row('rec_new')], null));
            await selection.setSearchTerm('new');
            old.resolve(page([row('rec_stale')], 'wrong'));
            await stale;
            assert.deepEqual(
                propsOf(editHost).linkedRecords.state.candidateRecords.map(
                    (r) => r.id
                ),
                ['rec_new']
            );
            assert.equal(
                propsOf(editHost).capability.selection.state.offset,
                null
            );
            off();
            checked(
                `${format}: atomic accepted page/options/cursor and stale generation`
            );

            assert.equal(
                editable.fields.controller.write('fld_parent', [
                    'rec_new',
                    'rec_missing',
                    'rec_new',
                ]),
                true
            );
            selection.setSearchInput('retire candidates without reading host');
            assert.deepEqual(
                propsOf(editHost).linkedRecords.state.selectedRecords.map(
                    (r) => r.id
                ),
                ['rec_new', 'rec_new']
            );
            assert.deepEqual(propsOf(editHost).value, [
                'rec_new',
                'rec_missing',
                'rec_new',
            ]);
            assert.equal(propsOf(editHost).dirty, true);
            await assert.rejects(
                editable.fields.save(),
                /synthetic save observation/
            );
            assert.deepEqual(editable.calls.saves[0], {
                ...saveOptions,
                extensionAccessToken: 'child_access_example',
                formRecord: {
                    type: 'create',
                    data: {
                        fld_title: 'Initial child',
                        fld_quantity: 2,
                        fld_parent: ['rec_new', 'rec_missing', 'rec_new'],
                    },
                },
                formFieldIdsWithUnsavedChanges: ['fld_parent'],
            });
            const modalSaveOptions = {
                ...saveOptions,
                context: { type: 'modal', prefillData: null },
            };
            const oldChild = setup(api, false, {
                ownerId: 'parent-A/child-A',
                visitor: 'visitor-A',
                parent: {
                    portalId: 'portal-A',
                    recordId: 'rec_parent_A',
                    portalFieldId: 'fld_children_A',
                },
                saveOptions: modalSaveOptions,
            });
            const oldChildHost = oldChild.host();
            const retainedChildRead =
                propsOf(oldChildHost).linkedRecords.readSelected;
            assert.equal(await retainedChildRead(), true);
            const oldChildCalls = oldChild.calls.selected.length;
            oldChild.retire();
            assert.equal(await retainedChildRead(), false);
            assert.equal(oldChild.calls.selected.length, oldChildCalls);
            const isolated = setup(api, false, {
                    ownerId: 'parent-B/child-B',
                    visitor: 'visitor-B',
                    parent: {
                        portalId: 'portal-B',
                        recordId: 'rec_parent_B',
                        portalFieldId: 'fld_children_B',
                    },
                    saveOptions: modalSaveOptions,
                }),
                isolatedHost = isolated.host();
            assert.deepEqual(
                propsOf(isolatedHost).linkedRecords.state.selectedRecords,
                []
            );
            assert.deepEqual(propsOf(isolatedHost).value, nativeIds);
            assert.equal(isolated.calls.selected.length, 0);
            isolated.setSelected(async () => ({
                tbl_children: table([row('rec_one', 'Child B only')]),
            }));
            assert.equal(
                await propsOf(isolatedHost).linkedRecords.readSelected(),
                true
            );
            assert.equal(
                propsOf(isolatedHost).linkedRecords.state.selectedRecords[0]
                    .fields.fld_title,
                'Child B only'
            );
            assert.deepEqual(isolated.calls.selected[0][1].session, {
                visitor: 'visitor-B',
            });
            assert.equal(
                isolated.fields.controller.write('fld_parent', [
                    'rec_one',
                    'rec_one',
                ]),
                true
            );
            await assert.rejects(
                isolated.fields.save(),
                /synthetic save observation/
            );
            assert.deepEqual(isolated.calls.saves[0], {
                ...modalSaveOptions,
                extensionAccessToken: 'child_access_example',
                formRecord: {
                    type: 'create',
                    data: {
                        fld_title: 'Initial child',
                        fld_quantity: 2,
                        fld_parent: ['rec_one', 'rec_one'],
                    },
                },
                formFieldIdsWithUnsavedChanges: ['fld_parent'],
            });
            checked(
                `${format}: native order/duplicates/full Save/dirty and child owner isolation`
            );

            // Candidate acceptance belongs to the existing Form owner even without
            // renderer observers or reads between acceptance and query retirement.
            for (const observer of ['never-subscribed', 'unmounted']) {
                const retention = setup(api);
                retention.fields.setLinkedLoader(
                    'fld_parent',
                    retention.loader()
                );
                const retentionHost = retention.host();
                if (observer === 'unmounted')
                    retentionHost.subscribe(() => {})();
                const retainedSelection =
                    retention.fields.field('fld_parent').selection;
                await retainedSelection.reload();
                retainedSelection.choose(['rec_candidate', 'rec_missing']);
                retainedSelection.setSearchInput(
                    'retire accepted candidate page'
                );
                const detached = propsOf(retentionHost);
                assert.deepEqual(
                    detached.linkedRecords.state.candidateRecords,
                    []
                );
                assert.deepEqual(
                    detached.linkedRecords.state.selectedRecords.map(
                        (record) => record.id
                    ),
                    ['rec_candidate']
                );
                assert.deepEqual(
                    detached.linkedRecords.state.unresolvedSelectedIds,
                    ['rec_missing']
                );
                detached.linkedRecords.state.selectedRecords[0].fields.fld_title =
                    'mutated by renderer';
                detached.value.push('rec_injected');
                assert.equal(
                    propsOf(retentionHost).linkedRecords.state
                        .selectedRecords[0].fields.fld_title,
                    'Candidate'
                );
                assert.deepEqual(
                    retention.fields.field('fld_parent').getSnapshot().value,
                    ['rec_candidate', 'rec_missing']
                );
                assert.equal(
                    retention.calls.selected.length +
                        retention.calls.saves.length,
                    0
                );
            }
            checked(
                `${format}: detached data and selected retention without renderer observers/snapshot reads`
            );

            const replacement = setup(api),
                replacementHost = replacement.host();
            const oldAction =
                propsOf(replacementHost).linkedRecords.readSelected;
            const oldFacet = replacement.fields.linkedRecords('fld_parent');
            let replaced = false;
            oldFacet.subscribe((state) => {
                if (state.phase === 'retired' && !replaced) {
                    replaced = true;
                    replacement.fields.setLinkedOptions('fld_parent', [
                        { value: 'rec_newest', label: 'Newest' },
                    ]);
                }
            });
            replacement.fields.setLinkedOptions('fld_parent', [
                { value: 'rec_older', label: 'Older' },
            ]);
            assert.equal(await oldAction(), false);
            assert.deepEqual(
                propsOf(replacementHost).capability.selection.state.options.map(
                    (o) => o.value
                ),
                ['rec_newest']
            );
            assert.equal(
                await propsOf(replacementHost).linkedRecords.readSelected(),
                true
            );
            const retained =
                propsOf(replacementHost).linkedRecords.readSelected;
            replacementHost.dispose();
            assert.equal(await retained(), false);
            checked(
                `${format}: replacement reconnect/reentrant winner/disposed retained actions`
            );

            const pending = setup(api),
                pendingHost = pending.host(),
                deferred = fixtures.deferred();
            pending.setSelected(() => deferred.promise);
            const flight = propsOf(pendingHost).linkedRecords.readSelected();
            await Promise.resolve();
            const signal = pending.calls.selected[0][1].signal;
            pendingHost.dispose();
            assert.equal(signal.aborted, false);
            const remounted = pending.host();
            deferred.resolve({
                tbl_children: table([row('rec_one', 'After disposal')]),
            });
            assert.equal(await flight, false);
            assert.equal(signal.aborted, false);
            assert.equal(
                pending.fields.linkedRecords('fld_parent').getSnapshot().phase,
                'ready'
            );
            assert.equal(
                propsOf(remounted).linkedRecords.state.selectedRecords[0].fields
                    .fld_title,
                'After disposal'
            );
            checked(
                `${format}: host disposal borrows ongoing read and remount receives completion`
            );

            const failure = setup(api),
                facet = failure.fields.linkedRecords('fld_parent');
            const borrowedFlight = fixtures.deferred();
            failure.setSelected(() => borrowedFlight.promise);
            const read = facet.readSelected();
            await Promise.resolve();
            const failureSignal = failure.calls.selected[0][1].signal;
            const binding = failure.fields.field('fld_parent');
            const bindingSubscribe = binding.subscribe.bind(binding),
                controllerSubscribe = failure.fields.controller.subscribe.bind(
                    failure.fields.controller
                );
            let attached = 0,
                detached = 0;
            binding.subscribe = (listener) => {
                attached++;
                const stop = bindingSubscribe(listener);
                return () => {
                    detached++;
                    stop();
                };
            };
            failure.fields.controller.subscribe = () => {
                throw Error('synthetic subscription failure');
            };
            assert.throws(
                () => failure.host(),
                /synthetic subscription failure/
            );
            assert.equal(attached, detached);
            assert.equal(failureSignal.aborted, false);
            failure.fields.controller.subscribe = controllerSubscribe;
            binding.subscribe = bindingSubscribe;
            borrowedFlight.resolve({ tbl_children: table([row('rec_one')]) });
            assert.equal(await read, true);
            assert.equal(facet.getSnapshot().phase, 'ready');
            checked(
                `${format}: initialization failure cleans host subscriptions only`
            );
        }
        const react = reactModules.react ?? require('react');
        const { createRoot } =
            reactModules.reactDomClient ?? require('react-dom/client');
        const { Window } = createRequire(import.meta.url)(
            reactModules.happyDomModulePath ?? happyDomModulePath ?? 'happy-dom'
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
        const previous = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        keys.forEach((key) =>
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
            })
        );
        const { createElement: h, StrictMode, act } = react;
        const container = window.document.createElement('div');
        window.document.body.append(container);
        let root = createRoot(container);
        try {
            // Executing the installed guide catches drift between the prose recipe and shipped API.
            const guide = readFileSync(
                join(
                    consumerDirectory,
                    'node_modules/@miniextensions/sdk/docs/field-bindings.md'
                ),
                'utf8'
            );
            const blocks = [...guide.matchAll(/```tsx\n([\s\S]*?)\n```/g)]
                .map(([, code]) => code)
                .filter((code) =>
                    code.includes('export function RichLinkedField(')
                );
            assert.equal(
                blocks.length,
                1,
                'Unique installed RichLinkedField recipe'
            );
            const { transform } = await import('esbuild');
            const recipe = await transform(blocks[0], {
                loader: 'tsx',
                jsx: 'automatic',
                format: 'esm',
                target: 'es2022',
            });
            const recipePath = join(
                consumerDirectory,
                'installed-rich-linked-field.mjs'
            );
            writeFileSync(recipePath, recipe.code);
            const { RichLinkedField } = await import(pathToFileURL(recipePath));
            for (const [format, api] of [
                ['esm', esm],
                ['cjs', cjs],
            ]) {
                const f = setup(api, true),
                    host = f.host(),
                    held = fixtures.deferred();
                f.setSelected(() => held.promise);
                let received,
                    submitCount = 0;
                const renderers = {
                    renderMultipleRecordLinksField: (props) => {
                        received = props;
                        return h(
                            'section',
                            null,
                            h(
                                'output',
                                { 'data-rich-count': true },
                                String(
                                    props.linkedRecords.state.selectedRecords
                                        .length
                                )
                            ),
                            h(RichLinkedField, props)
                        );
                    },
                };
                const tree = (receivingHost) =>
                    h(
                        StrictMode,
                        null,
                        h(
                            'form',
                            {
                                onSubmit: (event) => {
                                    event.preventDefault();
                                    submitCount++;
                                },
                            },
                            h(api.react.FieldRenderer, {
                                host: receivingHost,
                                renderers,
                                fallback: () => h('span', null, 'fallback'),
                            })
                        )
                    );
                await act(async () => root.render(tree(host)));
                assert.equal(
                    f.calls.selected.length +
                        f.calls.options.length +
                        f.calls.saves.length,
                    0
                );
                assert.equal(received.capability.type, 'readonly');
                assert.equal(
                    container.querySelector('[data-rich-count]').textContent,
                    '0'
                );
                const readButton = [
                    ...container.querySelectorAll('button'),
                ].find((button) =>
                    button.textContent.includes('Load selected')
                );
                assert.ok(
                    readButton,
                    'Installed recipe provides explicit selected hydration'
                );
                await act(async () => readButton.click());
                assert.equal(f.calls.selected.length, 1);
                assert.equal(
                    submitCount,
                    0,
                    'Load selected must not submit the enclosing native Form'
                );
                assert.equal(
                    readButton.type,
                    'button',
                    'Installed recipe selected read is an explicit non-submit action'
                );
                const signal = f.calls.selected[0][1].signal;
                await act(async () => root.unmount());
                host.dispose();
                assert.equal(signal.aborted, false);
                const remounted = f.host();
                root = createRoot(container);
                await act(async () => root.render(tree(remounted)));
                assert.equal(f.calls.selected.length, 1);
                await act(async () => {
                    held.resolve({
                        tbl_children: table([row('rec_one', 'React hydrated')]),
                    });
                    await Promise.resolve();
                });
                assert.equal(
                    container.querySelector('[data-rich-count]').textContent,
                    '2'
                );
                assert.deepEqual(
                    received.linkedRecords.state.unresolvedSelectedIds,
                    ['rec_missing']
                );
                assert.deepEqual(received.value, nativeIds);
                assert.equal(received.dirty, false);
                assert.equal(f.calls.saves.length, 0);
                const oldRenderedRead = received.linkedRecords.readSelected;
                const beforeReplacementData = JSON.stringify(received);
                await act(async () =>
                    f.fields.setLinkedOptions('fld_parent', [])
                );
                assert.equal(await oldRenderedRead(), false);
                assert.equal(
                    JSON.stringify(propsOf(remounted)),
                    beforeReplacementData,
                    'Replacement preserves identical readonly rich/native data'
                );
                assert.notEqual(
                    received.linkedRecords.readSelected,
                    oldRenderedRead,
                    'React receives the replacement facet action even when JSON data is identical'
                );
                await act(async () =>
                    assert.equal(
                        await received.linkedRecords.readSelected(),
                        true
                    )
                );
                assert.equal(
                    f.calls.selected.length,
                    1,
                    'Replacement uses the accepted borrowed selected read'
                );

                await act(async () => root.unmount());
                root = createRoot(container);
                checked(
                    `${format}: actual React named slot/installed recipe explicit read/StrictMode/remount`
                );
            }
        } finally {
            await act(async () => root.unmount());
            keys.forEach((key, i) =>
                previous[i]
                    ? Object.defineProperty(globalThis, key, previous[i])
                    : Reflect.deleteProperty(globalThis, key)
            );
            await window.happyDOM.close();
        }
        assert.equal(checks, 16);
        assert.equal(grouped.length, checks);
        return {
            checks,
            grouped,
            reactVersion: react.version,
            proof: 'Synthetic installed ESM/CommonJS Form bridge and actual React StrictMode/remount plus executed installed TSX recipe; no live backend/browser claim',
        };
    } finally {
        resources.reverse().forEach((dispose) => dispose());
    }
}
