import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Counts bounded scenarios, each containing assertions of rich and native data.
export const linkedChildEditFreshnessConsumerCheckCount = 54;
const fieldId = 'fld_children_a',
    target = 'rec_existing';
const deferred = () => {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};

function setup(api, fixtures, mode = 'overlay') {
    const loaded = fixtures.parentForm('edit');
    const native = [target, target, 'rec_sibling'];
    loaded.payload.formRecord.data[fieldId] = [...native];
    loaded.payload.linkedRecordFieldIdToDetailFields[fieldId] = [
        {
            fieldId: 'fld_title',
            fieldName: 'Title',
            titleOverride: null,
            miniExtConfig: {},
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
        },
    ];
    if (mode === 'filtered')
        Object.assign(loaded.payload.fieldIdsToSchemas[fieldId].miniExtConfig, {
            filterLinkedRecordsConditionFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'synthetic-filter',
                        type: 'singleCondition',
                        setting: {
                            fieldType: 'singleLineText',
                            type: 'is',
                            value: 'Old',
                            idOrName: { type: 'id', id: 'fld_title' },
                        },
                    },
                ],
            },
        });
    const metadata = loaded.payload.fieldIdsToSchemas.fld_title.airtableField;
    const row = (label = 'Old') => ({
        id: target,
        fields: { fld_title: label },
    });
    const table = (records) => ({
        airtableFields: [metadata],
        recordIdsToAirtableRecords: Object.fromEntries(
            records.map((record) => [record.id, record])
        ),
    });
    const page = (records = [row()]) => ({
        records,
        offset: null,
        tableIdsToLinkedTableStates: { tbl_child: table(records) },
        linkedRecordFieldIdToDetailFields: null,
    });
    const calls = { reads: [], options: [], loads: [], saves: [] };
    let selected = () => Promise.resolve({ tbl_child: table([row()]) });
    let options = () => Promise.resolve(page());
    let save = (input) => {
        const result = fixtures.childSaved('edit');
        result.record = {
            id: target,
            fields: structuredClone(input.formRecord.data),
        };
        if (mode === 'tombstone')
            result.context.newTableIdsToLinkedTableStates.tbl_child.airtableFields =
                [];
        return Promise.resolve(result);
    };
    let configuration = 0;
    const client = {
        getSession: () => ({ visitor: 'synthetic-A' }),
        linkedRecords: {
            loadSelectedRecords: (input) => {
                calls.reads.push(structuredClone(input));
                return selected();
            },
            listFormOptions: (input) => {
                calls.options.push(structuredClone(input));
                return options();
            },
        },
        loadExtension: async (input) => {
            calls.loads.push(structuredClone(input));
            const child = fixtures.childForm('edit');
            child.payload.formRecord = {
                type: 'edit',
                recordId: target,
                tableId: 'tbl_child',
                data: structuredClone(child.payload.formRecord.data),
            };
            return child;
        },
        forms: {
            save: (input) => {
                calls.saves.push(structuredClone(input));
                return save(input);
            },
        },
    };
    const fields = api.forms.createFormFieldBindings({
        loaded,
        client,
        getScope: () => ({ ownerId: 'synthetic-parent', revision: 0 }),
        configurationRevision: () => configuration,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    const owner = fields.linkedChild(fieldId, {
        journal: new api.forms.RecoveryJournal(),
        loadVersion: 1,
    });
    const loader = () =>
        api.ui.createFormLinkedRecordLoader({
            client,
            linkedTableId: 'tbl_child',
            input: {
                extensionAccessToken: loaded.payload.extensionAccessToken,
                linkedRecordFieldId: fieldId,
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
    const view = () =>
        fields
            .linkedRecords(fieldId)
            .getSnapshot()
            .selectedRecords.filter((record) => record.id === target)
            .map((record) => record.fields.fld_title);
    const expectEdit = (label = 'Edit') => {
        assert.deepEqual(view(), mode === 'overlay' ? [label, label] : []);
        assert.deepEqual(
            owner.getSnapshot().editableRecordIds.includes(target),
            mode === 'overlay'
        );
        assert.deepEqual(
            fields.controller.getState().draft.data[fieldId],
            native
        );
        assert.deepEqual(
            fields.controller.getState().draft.data.fld_children_b,
            ['rec_other_field']
        );
    };
    const open = async (label = 'Edit') => {
        assert.equal(
            await owner.openEdit(target, owner.getSnapshot().revision),
            true
        );
        assert.equal(
            owner.getSnapshot().child.field('fld_title').setValue(label)
                .accepted,
            true
        );
    };
    const submit = async () => {
        const childNative = structuredClone(
            owner.getSnapshot().child.controller.getState().draft.data
        );
        const result = await owner.save(owner.getSnapshot().revision);
        assert.equal(result.type, 'saved');
        const input = calls.saves.at(-1);
        assert.deepEqual(input.formRecord, {
            type: 'edit',
            recordId: target,
            tableId: 'tbl_child',
            data: childNative,
        });
        assert.deepEqual(input.formFieldIdsWithUnsavedChanges, ['fld_title']);
        assert.equal(
            input.formRecord.data.fld_unrendered,
            'Unrendered child synthetic value'
        );
        assert.deepEqual(calls.loads.at(-1).childExtensionInfo.accessType, {
            type: 'edit',
            childExtensionRecordId: target,
            childExtensionFieldId: null,
        });
        return result;
    };
    return {
        fields,
        owner,
        calls,
        loader,
        view,
        expectEdit,
        open,
        submit,
        row,
        table,
        page,
        setSelected: (fn) => {
            selected = fn;
        },
        setOptions: (fn) => {
            options = fn;
        },
        holdSave: (held) => {
            const original = save;
            save = async (input) => {
                await held.promise;
                return original(input);
            };
        },
        retire: () => {
            configuration++;
        },
    };
}

async function matrix(api, fixtures) {
    let count = 0;
    for (const mode of ['overlay', 'tombstone', 'filtered']) {
        for (const action of [
            'options',
            'loader',
            'before',
            'during',
            'omitted',
            'recovery',
        ]) {
            const f = setup(api, fixtures, mode),
                held = deferred(),
                saveHeld = deferred();
            try {
                f.fields.setLinkedLoader(fieldId, f.loader());
                assert.equal(
                    await f.fields.linkedRecords(fieldId).readSelected(),
                    true
                );
                assert.deepEqual(f.view(), ['Old', 'Old']);
                await f.open();
                let flight;
                f.setOptions(() => held.promise);
                if (action === 'before') {
                    flight = f.fields.field(fieldId).selection.reload();
                    await Promise.resolve();
                }
                if (action === 'during') {
                    f.holdSave(saveHeld);
                    const saving = f.submit();
                    await Promise.resolve();
                    flight = f.fields.field(fieldId).selection.reload();
                    await Promise.resolve();
                    saveHeld.resolve();
                    await saving;
                } else await f.submit();
                f.expectEdit();
                if (action === 'options')
                    f.fields.setLinkedOptions(fieldId, []);
                if (action === 'loader')
                    f.fields.setLinkedLoader(fieldId, f.loader());
                if (flight) {
                    held.resolve(f.page());
                    await flight;
                }
                if (action === 'omitted' || action === 'recovery') {
                    f.setOptions(async () => f.page([]));
                    await f.fields.field(fieldId).selection.reload();
                    f.expectEdit();
                    if (action === 'recovery') {
                        const fresh = mode === 'filtered' ? 'Old' : 'Fresh';
                        f.setOptions(async () => f.page([f.row(fresh)]));
                        await f.fields.field(fieldId).selection.reload();
                        assert.deepEqual(f.view(), [fresh, fresh]);
                        assert(
                            f.owner
                                .getSnapshot()
                                .editableRecordIds.includes(target)
                        );
                        f.fields.setLinkedOptions(fieldId, []);
                        assert.deepEqual(f.view(), [fresh, fresh]);
                        f.fields.setLinkedLoader(fieldId, f.loader());
                        assert.deepEqual(f.view(), [fresh, fresh]);
                    }
                }
                if (action !== 'recovery') f.expectEdit();
                assert.deepEqual(f.calls.reads, [
                    { extensionAccessToken: 'synthetic_parent_token' },
                ]);
                assert.equal(f.calls.saves.length, 1);
                count++;
            } finally {
                held.resolve(f.page());
                saveHeld.resolve();
                f.fields.destroy();
            }
        }
    }
    for (const timing of ['before', 'during', 'after', 'warm']) {
        const f = setup(api, fixtures),
            held = deferred(),
            saveHeld = deferred();
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            await f.fields.field(fieldId).selection.reload();
            if (timing === 'warm')
                await f.fields.linkedRecords(fieldId).readSelected();
            f.setSelected(() => held.promise);
            await f.open();
            let hydration;
            if (timing === 'before') {
                hydration = f.fields.linkedRecords(fieldId).readSelected();
                await Promise.resolve();
            }
            if (timing === 'during') {
                f.holdSave(saveHeld);
                const saving = f.submit();
                await Promise.resolve();
                hydration = f.fields.linkedRecords(fieldId).readSelected();
                await Promise.resolve();
                saveHeld.resolve();
                await saving;
            } else await f.submit();
            if (timing === 'after' || timing === 'warm')
                hydration = f.fields.linkedRecords(fieldId).readSelected();
            held.resolve({ tbl_child: f.table([f.row()]) });
            assert.equal(await hydration, true);
            if (timing === 'after') assert.deepEqual(f.view(), ['Old', 'Old']);
            else f.expectEdit();
            assert.equal(f.calls.reads.length, 1);
            count++;
        } finally {
            held.resolve({ tbl_child: f.table([]) });
            saveHeld.resolve();
            f.fields.destroy();
        }
    }
    for (const newer of ['options', 'hydration']) {
        const f = setup(api, fixtures),
            optionHeld = deferred(),
            selectedHeld = deferred();
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            await f.fields.field(fieldId).selection.reload();
            await f.open();
            await f.submit();
            f.setSelected(() => selectedHeld.promise);
            f.setOptions(() => optionHeld.promise);
            let hydration, optionRead;
            if (newer === 'options') {
                hydration = f.fields.linkedRecords(fieldId).readSelected();
                await Promise.resolve();
                optionRead = f.fields.field(fieldId).selection.reload();
                await Promise.resolve();
                optionHeld.resolve(f.page([f.row('Fresh')]));
                await optionRead;
                selectedHeld.resolve({ tbl_child: f.table([f.row('Old')]) });
                await hydration;
            } else {
                optionRead = f.fields.field(fieldId).selection.reload();
                await Promise.resolve();
                hydration = f.fields.linkedRecords(fieldId).readSelected();
                await Promise.resolve();
                selectedHeld.resolve({ tbl_child: f.table([f.row('Fresh')]) });
                await hydration;
                optionHeld.resolve(f.page([f.row('Old')]));
                await optionRead;
            }
            assert.deepEqual(f.view(), ['Fresh', 'Fresh']);
            f.fields.setLinkedOptions(fieldId, []);
            assert.deepEqual(f.view(), ['Fresh', 'Fresh']);
            assert.equal(f.calls.reads.length, 1);
            count++;
        } finally {
            optionHeld.resolve(f.page());
            selectedHeld.resolve({ tbl_child: f.table([]) });
            f.fields.destroy();
        }
    }
    {
        const f = setup(api, fixtures),
            held = deferred();
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            await f.fields.linkedRecords(fieldId).readSelected();
            await f.open('Edit one');
            await f.submit();
            f.setOptions(async () => f.page([f.row('Edit one')]));
            await f.fields.field(fieldId).selection.reload();
            await f.open('Edit two');
            f.setOptions(() => held.promise);
            const stale = f.fields.field(fieldId).selection.reload();
            await Promise.resolve();
            await f.submit();
            held.resolve(f.page([f.row('Edit one')]));
            await stale;
            f.fields.setLinkedOptions(fieldId, []);
            f.expectEdit('Edit two');
            assert.equal(f.calls.saves.length, 2);
            count++;
        } finally {
            held.resolve(f.page());
            f.fields.destroy();
        }
    }
    {
        const f = setup(api, fixtures),
            held = deferred();
        try {
            await f.fields.linkedRecords(fieldId).readSelected();
            await f.open();
            f.holdSave(held);
            const saving = f.submit();
            await Promise.resolve();
            const before = structuredClone(
                f.fields.controller.getState().draft.data
            );
            f.retire();
            f.owner.getSnapshot();
            held.resolve();
            await saving;
            assert.deepEqual(f.fields.controller.getState().draft.data, before);
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.calls.saves.length, 1);
            count++;
        } finally {
            held.resolve();
            f.fields.destroy();
        }
    }
    return count;
}

async function mounted(api, fixtures, require) {
    const { Window } = createRequire(import.meta.url)('happy-dom');
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
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot } = require('react-dom/client');
    const f = setup(api, fixtures);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container),
        host,
        received;
    const newHost = () =>
        api.ui.createFormFieldRendererHost({
            fields: f.fields,
            fieldId,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
    const tree = () =>
        h(
            StrictMode,
            null,
            h(api.react.FieldRenderer, {
                host,
                renderers: {
                    renderMultipleRecordLinksField: (props) => {
                        received = props;
                        return h(
                            'output',
                            null,
                            props.linkedRecords.state.selectedRecords
                                .map((record) => record.fields.fld_title)
                                .join('|')
                        );
                    },
                },
                fallback: () => h('span', null, 'fallback'),
            })
        );
    try {
        host = newHost();
        await act(async () => root.render(tree()));
        assert.equal(f.calls.reads.length, 0);
        await act(async () => {
            await received.linkedRecords.readSelected();
        });
        await act(async () => {
            await f.open();
            await f.submit();
        });
        assert.equal(container.textContent, 'Edit|Edit');
        const oldRead = received.linkedRecords.readSelected;
        await act(async () => f.fields.setLinkedOptions(fieldId, []));
        assert.equal(container.textContent, 'Edit|Edit');
        assert.equal(await oldRead(), false);
        assert.notEqual(received.linkedRecords.readSelected, oldRead);
        await act(async () => root.unmount());
        host.dispose();
        host = newHost();
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(container.textContent, 'Edit|Edit');
        assert.equal(f.calls.reads.length, 1);
        assert.equal(f.calls.saves.length, 1);
        f.expectEdit();
        return 1;
    } finally {
        await act(async () => root.unmount());
        host?.dispose();
        f.fields.destroy();
        container.remove();
        await window.happyDOM.abort();
        keys.forEach((key, index) =>
            previous[index]
                ? Object.defineProperty(globalThis, key, previous[index])
                : delete globalThis[key]
        );
    }
}

export async function checkLinkedChildEditFreshnessConsumer({
    consumerDirectory,
}) {
    const bundled = await build({
        entryPoints: [
            new URL('../test/formLinkedChildFixtures.ts', import.meta.url)
                .pathname,
        ],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
    });
    const fixtures = await import(
        `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    const require = createRequire(join(consumerDirectory, 'package.json'));
    let checks = 0;
    for (const format of ['esm', 'cjs']) {
        const api = {};
        for (const name of ['forms', 'ui', 'react'])
            api[name] =
                format === 'esm'
                    ? await import(
                          pathToFileURL(
                              join(
                                  consumerDirectory,
                                  'node_modules/@miniextensions/sdk/dist/esm',
                                  name,
                                  'index.js'
                              )
                          )
                      )
                    : require(`@miniextensions/sdk/${name}`);
        checks += await matrix(api, fixtures);
        checks += await mounted(api, fixtures, require);
    }
    assert.equal(checks, linkedChildEditFreshnessConsumerCheckCount);
    return checks;
}
