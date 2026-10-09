import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

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
const link = (id, table = 'tbl_targets') =>
    complete({
        id,
        name: id,
        config: {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: table,
                inverseLinkFieldId: 'fld_inverse',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    });
const primary = complete({
    id: 'fld_label',
    name: 'Label',
    isPrimaryField: true,
    config: { type: 'singleLineText' },
});
const physical = [
    complete(fixtures.titleField),
    link('fld_links'),
    link('fld_other'),
    link('fld_self', 'tbl_children'),
];
const detail = (field) => ({
    fieldId: field.id,
    fieldName: field.name,
    titleOverride: null,
    miniExtConfig: {},
    isHidden: false,
    fieldIsInEditingChildForm: true,
    childFormField: null,
});
const table = (fields, records) => ({
    airtableFields: structuredClone(fields),
    recordIdsToAirtableRecords: Object.fromEntries(
        records.map((r) => [r.id, structuredClone(r)])
    ),
});
const criteria = () => ({
    selectedCustomViewId: 'view_example',
    sortFieldsByEndUser: null,
    supportsEndUserSortCleanup: true,
    filtersByEndUser: null,
    supportsEndUserFilterCleanup: true,
    searchParamsMap: {},
    searchTerm: null,
});
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
const native = ['rec_a', 'rec_missing', 'rec_a', 'rec_blank'];
function envelope(options = {}) {
    const rows = [
        {
            id: 'rec_one',
            fields: {
                fld_title: 'Self one',
                fld_links: [...native],
                fld_other: ['rec_b'],
                fld_self: ['rec_two'],
            },
        },
        {
            id: 'rec_two',
            fields: {
                fld_title: 'Self two',
                fld_links: ['rec_b'],
                fld_other: ['rec_a'],
                fld_self: ['rec_one'],
            },
        },
    ];
    const targets = [
        { id: 'rec_a', fields: { fld_label: 'Alpha' } },
        { id: 'rec_b', fields: { fld_label: 'Beta' } },
        { id: 'rec_blank', fields: { fld_label: '' } },
        {
            id: 'rec_cached',
            fields: { fld_label: 'Cache must not grant admission' },
        },
    ];
    return {
        airtableOffset: options.offset ?? null,
        recordIds: rows.map((r) => r.id),
        tableIdsToLinkedTableStates: {
            tbl_children: table(physical, rows),
            tbl_targets: table(
                options.primaryFields ?? [primary],
                options.targets ?? targets
            ),
        },
        customViewDetailFields: Object.hasOwn(options, 'projection')
            ? options.projection
            : {
                  fld_children: physical.map(detail),
              },
    };
}
const itemsOf = (host, id = 'fld_links') => {
    const snapshot = host.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    const props = snapshot.fields.find((field) => field.fieldId === id);
    assert.equal(props.physicalKind, 'multipleRecordLinks');
    assert.equal(props.linkedRecords.source, 'portal-pills');
    assert.deepEqual(Object.keys(props.linkedRecords).sort(), [
        'items',
        'source',
    ]);
    for (const item of props.linkedRecords.items)
        assert.deepEqual(Object.keys(item).sort(), [
            'label',
            'nativeIndex',
            'state',
        ]);
    return props;
};
const resolved = (nativeIndex, label) => ({
    nativeIndex,
    state: 'resolved',
    label,
});
const unavailable = (nativeIndex) => ({
    nativeIndex,
    state: 'unavailable',
    label: null,
});
const blank = (nativeIndex) => ({ nativeIndex, state: 'blank', label: null });

/** Actual installed public ESM/CJS and shipped React recipe; synthetic DOM/transport only. */
export async function checkPortalLinkedPillConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const base = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const esm = Object.fromEntries(
        await Promise.all(
            ['ui', 'forms', 'portals', 'react'].map(async (name) => [
                name,
                await import(pathToFileURL(join(base, name, 'index.js'))),
            ])
        )
    );
    const cjs = Object.fromEntries(
        ['ui', 'forms', 'portals', 'react'].map((name) => [
            name,
            require(`@miniextensions/sdk/${name}`),
        ])
    );
    let checks = 0;
    const groups = [];
    const checked = (name) => {
        checks++;
        groups.push(name);
    };
    function setup(api, pageOptions = {}) {
        let current = true,
            config = 0,
            scope = { ownerId: 'synthetic', revision: 0 },
            session = {};
        let response = envelope(pageOptions);
        const calls = { reads: [], saves: [], forbidden: [] };
        const fail = (name) => () => {
            calls.forbidden.push(name);
            throw Error(`Unexpected ${name}`);
        };
        const client = {
            getSession: () => session,
            portals: {
                listLinkedRecords: async (input) => {
                    calls.reads.push(structuredClone(input));
                    return structuredClone(response);
                },
                updateGridCell: async (input) => {
                    calls.saves.push(structuredClone(input));
                    return {
                        auditTrail: null,
                        auditTrails: [],
                        record: {
                            id: input.recordId,
                            fields: {
                                [input.recordFieldId]: structuredClone(
                                    input.value
                                ),
                            },
                        },
                    };
                },
                listLinkedRecordOptions: fail('selector'),
                loadChildForm: fail('child'),
            },
            forms: { listLinkedRecordOptions: fail('form-selector') },
        };
        const portal = fixtures.makePortal();
        Object.values(portal.payload.fieldIdsToSchemas).forEach((schema) => {
            schema.airtableField = complete(schema.airtableField);
        });
        const configOuter =
            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
        configOuter.disableInlineEdit = false;
        Object.assign(configOuter.customViews[0].config, {
            layout: 'grid',
            disableInlineEdit: false,
        });
        configOuter.customViews.push({
            ...structuredClone(configOuter.customViews[0]),
            id: 'view_replacement',
        });
        portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
            physical.map(detail);
        const owner = api.portals.createPortalListOwner({
            client,
            portal,
            portalFieldId: 'fld_children',
            criteria: criteria(),
            getScope: () => scope,
            isCurrent: () => current,
            configurationRevision: () => config,
        });
        const resources = [];
        const detailHost = (recordId = 'rec_one', lease = {}) => {
            const host = api.ui.createPortalDetailRendererHost({
                owner,
                client,
                recordId,
                isCurrent: () => current,
                configurationRevision: () => config,
                ...lease,
            });
            resources.push(() => host.dispose());
            return host;
        };
        const cellHost = (fieldId = 'fld_links', recordId = 'rec_one') => {
            const field = physical.find((f) => f.id === fieldId);
            const cell = api.portals.createPortalCellBinding({
                client,
                schema: {
                    fieldType: field.config.type,
                    airtableField: structuredClone(field),
                    miniExtConfig: {},
                },
                value: response.tableIdsToLinkedTableStates.tbl_children
                    .recordIdsToAirtableRecords[recordId].fields[fieldId],
                input: {
                    portalExtensionAccessToken:
                        portal.payload.extensionAccessToken,
                    portalFieldId: 'fld_children',
                    recordFieldId: fieldId,
                    recordId,
                    selectedCustomViewId: 'view_example',
                },
                getScope: () => scope,
                isCurrent: () => owner.isCurrent(owner.getSnapshot().revision),
                recovery: {
                    journal: new api.forms.RecoveryJournal(),
                    scope: {
                        owner: 'synthetic',
                        parentFieldId: 'fld_children',
                        tableId: 'tbl_children',
                        childExtensionId: '',
                        context: 'modal',
                    },
                    loadVersion: 1,
                },
            });
            const host = api.ui.createPortalCellRendererHost({
                owner,
                client,
                cell,
                fieldId,
                recordId,
                isCurrent: () => current,
                configurationRevision: () => config,
            });
            resources.push(
                () => host.dispose(),
                () => cell.destroy()
            );
            return { host, cell };
        };
        return {
            owner,
            calls,
            detailHost,
            cellHost,
            read: () =>
                owner.readFirst(owner.getSnapshot().revision, readOptions),
            setResponse: (v) => {
                response = v;
            },
            retire: (kind) => {
                if (kind === 'configuration') config++;
                else if (kind === 'session')
                    session = { loginToken: 'synthetic-replacement' };
                else if (kind === 'scope')
                    scope = { ownerId: 'replacement', revision: 1 };
                else current = false;
            },
            destroy: () => {
                resources.reverse().forEach((stop) => stop());
                owner.destroy();
            },
        };
    }
    let reactSetup;
    for (const [name, api] of [
        ['ESM', esm],
        ['CJS', cjs],
    ]) {
        const s = setup(api);
        try {
            assert.equal(s.calls.reads.length, 0);
            assert.equal(await s.read(), true);
            const first = s.detailHost(),
                second = s.detailHost('rec_two');
            assert.deepEqual(itemsOf(first).linkedRecords.items, [
                resolved(0, 'Alpha'),
                unavailable(1),
                resolved(2, 'Alpha'),
                blank(3),
            ]);
            assert.deepEqual(itemsOf(second).linkedRecords.items, [
                resolved(0, 'Beta'),
            ]);
            assert.deepEqual(itemsOf(first, 'fld_other').linkedRecords.items, [
                resolved(0, 'Beta'),
            ]);
            assert.deepEqual(itemsOf(second, 'fld_other').linkedRecords.items, [
                resolved(0, 'Alpha'),
            ]);
            assert.deepEqual(itemsOf(first, 'fld_self').linkedRecords.items, [
                resolved(0, 'Self two'),
            ]);
            assert.deepEqual(itemsOf(first).value, native);
            checked(`${name}: rows/fields/duplicates/self-link/privacy`);
            const untouched = s.cellHost();
            assert.deepEqual(
                untouched.cell.binding.getSnapshot().value,
                native
            );
            assert.deepEqual(itemsOf(untouched.host).value, native);
            const duplicateSave = await untouched.cell.save();
            assert.deepEqual(duplicateSave.record.fields.fld_links, native);
            assert.deepEqual(s.calls.saves[0], {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_links',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
                value: native,
            });
            assert.deepEqual(itemsOf(first).value, native);
            checked(`${name}: untouched native duplicate Save`);
            const { host, cell } = s.cellHost();
            const props = itemsOf(host);
            assert.equal(props.capability.type, 'editable');
            cell.binding.selection.setOptions(
                ['rec_a', 'rec_blank', 'rec_b', 'rec_cached'].map((value) => ({
                    value,
                    label: 'Synthetic admitted option',
                }))
            );
            const next = ['rec_blank', 'rec_a', 'rec_b', 'rec_cached'];
            assert.equal(props.capability.setValue(next).accepted, true);
            assert.deepEqual(itemsOf(host).linkedRecords.items, [
                blank(0),
                resolved(1, 'Alpha'),
                unavailable(2),
                unavailable(3),
            ]);
            assert.deepEqual(itemsOf(first).value, native);
            assert.deepEqual(itemsOf(second).linkedRecords.items, [
                resolved(0, 'Beta'),
            ]);
            const saved = await cell.save();
            assert.deepEqual(saved.record.fields.fld_links, next);
            assert.equal(s.calls.saves.length, 2);
            assert.deepEqual(s.calls.saves[1], {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_links',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
                value: next,
            });
            assert.equal(s.calls.reads.length, 1);
            assert.deepEqual(s.calls.forbidden, []);
            checked(`${name}: native add/reorder/save/cache isolation`);
            const detached = itemsOf(host).linkedRecords;
            detached.items[0].state = 'resolved';
            detached.items[0].label = 'mutated';
            assert.deepEqual(itemsOf(host).linkedRecords.items[0], blank(0));
            checked(`${name}: detached presentation`);
        } finally {
            s.destroy();
        }
        for (const [label, options, expected] of [
            ['null nested projection', { projection: null }, 'Alpha'],
            [
                'missing nested projection',
                { projection: { fld_children: physical.map(detail) } },
                'Alpha',
            ],
            [
                'empty nested projection',
                {
                    projection: {
                        fld_children: physical.map(detail),
                        fld_links: [],
                    },
                },
                'Alpha',
            ],
            [
                'invalid native primary',
                {
                    primaryFields: [
                        {
                            ...primary,
                            config: {
                                type: 'number',
                                options: { precision: 2 },
                            },
                        },
                    ],
                    targets: [
                        { id: 'rec_a', fields: { fld_label: 'not a number' } },
                    ],
                },
                null,
            ],
            [
                'computed primary',
                {
                    primaryFields: [
                        {
                            ...primary,
                            isComputed: true,
                            config: {
                                type: 'formula',
                                options: {
                                    isValid: true,
                                    result: {
                                        type: 'singleLineText',
                                        options: null,
                                    },
                                },
                            },
                        },
                    ],
                },
                'Alpha',
            ],
            [
                'ambiguous primary',
                {
                    primaryFields: [
                        primary,
                        { ...primary, id: 'fld_second_primary' },
                    ],
                },
                null,
            ],
            ['missing primary', { primaryFields: [] }, null],
            [
                'missing primary ID with name alias',
                {
                    targets: [
                        {
                            id: 'rec_a',
                            fields: { Label: 'Alias must not replace ID' },
                        },
                    ],
                },
                null,
            ],
            [
                'conflicting name alias',
                {
                    targets: [
                        {
                            id: 'rec_a',
                            fields: { fld_label: 'Alpha', Label: 'Conflict' },
                        },
                    ],
                },
                null,
            ],
            [
                'matching name alias',
                {
                    targets: [
                        {
                            id: 'rec_a',
                            fields: { fld_label: 'Alpha', Label: 'Alpha' },
                        },
                    ],
                },
                'Alpha',
            ],
            [
                'null primary blank',
                { targets: [{ id: 'rec_a', fields: { fld_label: null } }] },
                '',
            ],
            [
                'whitespace primary blank',
                { targets: [{ id: 'rec_a', fields: { fld_label: '   ' } }] },
                '',
            ],
        ]) {
            const sample = setup(api, options);
            try {
                assert.equal(await sample.read(), true);
                const item = itemsOf(sample.detailHost()).linkedRecords
                    .items[0];
                assert.deepEqual(
                    item,
                    expected === null
                        ? unavailable(0)
                        : expected === ''
                          ? blank(0)
                          : resolved(0, expected)
                );
                assert.equal(sample.calls.reads.length, 1);
                assert.deepEqual(sample.calls.forbidden, []);
                checked(`${name}: ${label}`);
            } finally {
                sample.destroy();
            }
        }
        for (const callback of ['isCurrent', 'configurationRevision']) {
            const sample = setup(api);
            let armed = false,
                invocations = 0,
                replacements = 0;
            const replaceOnFinalCheck = () => {
                if (armed && ++invocations === 2) {
                    replacements++;
                    assert.equal(
                        sample.owner.setCriteria(
                            sample.owner.getSnapshot().revision,
                            {
                                ...criteria(),
                                searchTerm: 'final-callback-replacement',
                            }
                        ),
                        true
                    );
                }
                return callback === 'isCurrent' ? true : 0;
            };
            try {
                assert.equal(await sample.read(), true);
                const host = sample.detailHost('rec_one', {
                    [callback]: replaceOnFinalCheck,
                });
                assert.deepEqual(
                    itemsOf(host).linkedRecords.items[0],
                    resolved(0, 'Alpha')
                );
                armed = true;
                invocations = 0;
                const snapshot = host.getSnapshot();
                assert.equal(replacements, 1);
                assert.equal(invocations, 2);
                assert.equal(snapshot.status, 'retired');
                assert.equal(Object.hasOwn(snapshot, 'fields'), false);
                assert.doesNotMatch(
                    JSON.stringify(snapshot),
                    /Alpha|Beta|Self two|rec_a|portal_access_example/
                );
                assert.equal(sample.calls.reads.length, 1);
                assert.equal(sample.calls.saves.length, 0);
                assert.deepEqual(sample.calls.forbidden, []);
                checked(
                    `${name}: final ${callback} callback replacement refuses old pills`
                );
            } finally {
                sample.destroy();
            }
        }
        for (const reason of [
            'configuration',
            'scope',
            'session',
            'owner',
            'criteria',
            'view',
            'paging',
        ]) {
            const sample = setup(api, { offset: 'synthetic-next' });
            try {
                await sample.read();
                const host = sample.detailHost();
                itemsOf(host);
                if (reason === 'criteria' || reason === 'view')
                    assert.equal(
                        sample.owner.setCriteria(
                            sample.owner.getSnapshot().revision,
                            {
                                ...criteria(),
                                ...(reason === 'view'
                                    ? {
                                          selectedCustomViewId:
                                              'view_replacement',
                                      }
                                    : { searchTerm: 'replacement' }),
                            }
                        ),
                        true,
                        `${name}: ${reason} replacement accepted`
                    );
                else if (reason === 'paging')
                    assert.equal(
                        await sample.owner.readNext(
                            sample.owner.getSnapshot().revision,
                            readOptions
                        ),
                        true,
                        `${name}: paging accepted`
                    );
                else sample.retire(reason);
                assert.equal(
                    host.getSnapshot().status,
                    'retired',
                    `${name}: ${reason} retirement`
                );
                assert.deepEqual(sample.calls.forbidden, []);
                checked(`${name}: ${reason} retires host`);
            } finally {
                sample.destroy();
            }
        }
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
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
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container);
    try {
        reactSetup = setup(esm);
        await reactSetup.read();
        const host = reactSetup.detailHost();
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
                code.includes('export function PortalLinkedPills(')
            );
        assert.equal(
            blocks.length,
            1,
            'Unique shipped PortalLinkedPills recipe is required'
        );
        const recipe = await transform(blocks[0], {
            loader: 'tsx',
            jsx: 'automatic',
            format: 'esm',
            target: 'es2022',
        });
        const recipePath = join(
            consumerDirectory,
            'installed-portal-linked-pills.mjs'
        );
        writeFileSync(recipePath, recipe.code);
        const { PortalLinkedPills } = await import(pathToFileURL(recipePath));
        const tree = () =>
            h(
                StrictMode,
                null,
                h(esm.react.FieldRenderer, {
                    host,
                    renderers: {
                        renderMultipleRecordLinksField: (props) =>
                            h(PortalLinkedPills, props),
                    },
                    fallback: () => null,
                })
            );
        await act(async () => root.render(tree()));
        assert.match(container.textContent, /Alpha/);
        assert.match(container.textContent, /Beta/);
        assert.doesNotMatch(
            container.textContent,
            /rec_a|rec_missing|rec_b|rec_blank|portal_access_example/
        );
        assert.equal(reactSetup.calls.reads.length, 1);
        assert.equal(reactSetup.calls.saves.length, 0);
        assert.deepEqual(reactSetup.calls.forbidden, []);
        checked('React: installed FieldRenderer + shipped recipe');
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.match(container.textContent, /Alpha/);
        assert.equal(reactSetup.calls.reads.length, 1);
        assert.deepEqual(itemsOf(host).value, native);
        checked('React: StrictMode/remount no reads or native changes');
        await act(async () => {
            reactSetup.owner.setCriteria(
                reactSetup.owner.getSnapshot().revision,
                { ...criteria(), searchTerm: 'retired' }
            );
        });
        assert.equal(host.getSnapshot().status, 'retired');
        assert.equal(container.textContent, '');
        checked('React: retired recipe clears labels');
    } finally {
        await act(async () => root.unmount());
        reactSetup?.destroy();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
        await window.happyDOM.close();
    }
    return { checks, groups };
}
