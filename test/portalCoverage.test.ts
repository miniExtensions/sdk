import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createPortalCollection,
    PortalCollectionError,
    type PortalCollectionCriteria,
    type PortalCollectionSnapshot,
} from '../src/portals/index.js';
import {
    createPortalFilterEditor,
    createPortalSortEditor,
    type PortalEditorOptions,
} from '../src/portals/editors.js';
import type {
    ListPortalLinkedRecordsResult,
    RuntimeAirtableField,
} from '../src/runtime/index.js';
import {
    deferredPortal,
    portalFixture,
    portalListPage,
    portalPage,
} from './portalFixtures.js';

const criteria = (): PortalCollectionCriteria => ({
    selectedCustomViewId: 'view_example',
    searchTerm: 'retained search',
    searchParamsMap: {},
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
const field = (
    id: string,
    type: string,
    options: unknown = null
): RuntimeAirtableField =>
    ({
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: id === 'text',
        config: { type, options },
    }) as RuntimeAirtableField;
const editorFixture = () => {
    const fields = [
        field('text', 'singleLineText'),
        field('number', 'number', { precision: 2 }),
        field('check', 'checkbox', { icon: 'check', color: 'greenBright' }),
        field('rich', 'richText'),
        field('multi', 'multipleSelects', {
            choices: [
                { id: 'a', name: 'Alpha', color: 'blueBright' },
                { id: 'b', name: 'Beta', color: 'blueBright' },
            ],
        }),
    ];
    const details = fields.map(({ id }) => ({
        fieldId: id,
        fieldName: id,
        titleOverride: null,
        isHidden: false,
        fieldIsInEditingChildForm: true,
        childFormField: null,
        miniExtConfig: {},
    }));
    const snapshot: PortalCollectionSnapshot = {
        ...portalListPage({
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: fields,
                    recordIdsToAirtableRecords: {},
                },
            },
        }),
        criteriaKey: 'accepted-page',
        detailFields: details,
        customViewDetailFields: { fld_children: details },
        layoutSettings: {
            layout: 'grid',
            disableInlineEdit: false,
            allowUsersToUnlinkRecords: false,
            kanbanCategoryField: null,
        },
    };
    const applied: PortalCollectionCriteria[] = [];
    const options: PortalEditorOptions = {
        portal: portalPage(),
        portalFieldId: 'fld_children',
        snapshot,
        criteria: criteria(),
        isCurrent: () => true,
        onApply: (next) => {
            applied.push(next);
        },
    };
    return {
        options,
        fields: snapshot.tableIdsToLinkedTableStates.table_children
            .airtableFields,
        applied,
        config: options.portal.payload.fieldIdsToSchemas.fld_children
            .miniExtConfig as Record<string, unknown>,
    };
};
const readyFilter = (options: PortalEditorOptions) => {
    const result = createPortalFilterEditor(options);
    assert.equal(result.type, 'ready');
    if (result.type !== 'ready') throw new Error('Expected ready filter');
    return result.model;
};

describe('Portal editor metadata and publication boundaries', () => {
    const badConfigurations: Array<
        [string, (f: ReturnType<typeof editorFixture>) => void]
    > = [
        [
            'missing linked schema',
            (f) => {
                delete f.options.portal.payload.fieldIdsToSchemas.fld_children;
            },
        ],
        [
            'non-array custom views',
            (f) => {
                f.config.customViews = {};
            },
        ],
        [
            'ambiguous selected view',
            (f) => {
                f.config.customViews = [
                    { id: 'view_example', config: {} },
                    { id: 'view_example', config: {} },
                ];
            },
        ],
        [
            'malformed selected view settings',
            (f) => {
                f.config.customViews = [{ id: 'view_example', config: [] }];
            },
        ],
        [
            'duplicate returned field identity',
            (f) => {
                f.fields.push(structuredClone(f.fields[0]));
            },
        ],
        [
            'unknown returned field type',
            (f) => {
                Object.assign(f.fields[0].config, {
                    type: 'future-unsupported-type',
                });
            },
        ],
        [
            'invalid field computed flag',
            (f) => {
                Object.assign(f.fields[0], { isComputed: 'false' });
            },
        ],
        [
            'ambiguous physical primary fields',
            (f) => {
                f.fields[1].isPrimaryField = true;
            },
        ],
    ];
    for (const [label, corrupt] of badConfigurations) {
        it(`refuses sort and filter proposals with ${label}`, () => {
            const f = editorFixture();
            corrupt(f);
            const original = structuredClone(f.options.criteria);
            for (const create of [
                createPortalSortEditor,
                createPortalFilterEditor,
            ]) {
                const result = create(f.options);
                assert.equal(result.type, 'unavailable');
                if (result.type === 'unavailable')
                    assert.ok(result.diagnostic.length > 0);
            }
            assert.equal(f.applied.length, 0);
            assert.deepEqual(f.options.criteria, original);
        });
    }

    for (const duplicate of ['id', 'name'] as const) {
        it(`rejects ambiguous choice ${duplicate}s even when text remains eligible`, () => {
            const f = editorFixture();
            const options = f.fields[4].config.options as {
                choices: Array<{ id: string; name: string }>;
            };
            options.choices[1][duplicate] = options.choices[0][duplicate];
            const result = createPortalFilterEditor(f.options);
            assert.deepEqual(result, {
                type: 'unavailable',
                diagnostic:
                    'Returned filter choices are malformed or ambiguous.',
            });
            assert.equal(f.applied.length, 0);
        });
    }

    it('rejects a missing explicitly configured primary instead of silently choosing a physical primary', () => {
        const f = editorFixture();
        f.config.customPrimaryField = 'not-returned';
        assert.deepEqual(createPortalFilterEditor(f.options), {
            type: 'unavailable',
            diagnostic: 'The configured filter primary is not returned.',
        });
        assert.equal(f.applied.length, 0);
    });

    it('excludes computed fields even when the accepted projection explicitly exposes them', () => {
        const f = editorFixture();
        f.options.snapshot.customViewDetailFields = {
            fld_children: [
                f.options.snapshot.detailFields[0],
                f.options.snapshot.detailFields[1],
            ],
        };
        f.config.dropdownFiltersFields = [];
        const ordinary = readyFilter(f.options);
        assert.deepEqual(ordinary.getSnapshot().fields, [
            { id: 'text', name: 'text' },
            { id: 'number', name: 'number' },
        ]);
        assert.equal(ordinary.setField('number'), true);
        ordinary.destroy();
        f.fields[1].isComputed = true;
        const computed = readyFilter(f.options);
        assert.deepEqual(computed.getSnapshot().fields, [
            { id: 'text', name: 'text' },
        ]);
        assert.equal(computed.setField('number'), false);
        assert.equal(f.applied.length, 0);
    });

    it('honors an explicit empty dropdown restriction for fields outside the accepted projection', () => {
        const f = editorFixture();
        f.options.snapshot.customViewDetailFields = {
            fld_children: [f.options.snapshot.detailFields[0]],
        };
        const unrestricted = readyFilter(f.options);
        assert.deepEqual(unrestricted.getSnapshot().fields, [
            { id: 'text', name: 'text' },
            { id: 'multi', name: 'multi' },
        ]);
        assert.equal(unrestricted.setField('multi'), true);
        unrestricted.destroy();
        f.config.dropdownFiltersFields = [];
        const restricted = readyFilter(f.options);
        assert.deepEqual(restricted.getSnapshot().fields, [
            { id: 'text', name: 'text' },
        ]);
        assert.equal(restricted.setField('multi'), false);
        assert.equal(f.applied.length, 0);
    });

    for (const value of [false, true]) {
        it(`publishes checkbox ${value} without coercing text and preserves boolean state across fields`, () => {
            const f = editorFixture();
            const m = readyFilter(f.options);
            m.setField('check');
            assert.equal(m.getSnapshot().operandKind, 'boolean');
            m.setOperand(String(value));
            assert.equal(m.apply(), false);
            assert.equal(m.getSnapshot().diagnostic, 'Choose a boolean value.');
            assert.equal(f.applied.length, 0);
            m.setOperand(value);
            m.setField('text');
            m.setField('check');
            assert.equal(m.getSnapshot().operand, value);
            assert.equal(m.apply(), true);
            assert.deepEqual(f.applied[0], {
                ...criteria(),
                filtersByEndUser: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'portal_scalar_filter',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                idOrName: { type: 'id', id: 'check' },
                                fieldType: 'checkbox',
                                value,
                            },
                        },
                    ],
                },
            });
        });
    }

    it('supports rich-text contains while rejecting equality and nontext operands', () => {
        const f = editorFixture();
        const m = readyFilter(f.options);
        m.setField('rich');
        assert.equal(m.setOperator('is'), false);
        assert.equal(m.setOperator('contains'), true);
        m.setOperand(true);
        assert.equal(m.apply(), false);
        assert.equal(m.getSnapshot().diagnostic, 'Enter a text value.');
        m.setOperand(' exact text ');
        assert.equal(m.apply(), true);
        assert.deepEqual(f.applied[0].filtersByEndUser, {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'portal_scalar_filter',
                    type: 'singleCondition',
                    setting: {
                        type: 'contains',
                        idOrName: { type: 'id', id: 'rich' },
                        fieldType: 'richText',
                        value: ' exact text ',
                    },
                },
            ],
        });
    });

    it('retains a saved numeric leaf identity and converts edited finite input only on Apply', () => {
        const f = editorFixture();
        f.options.criteria.filtersByEndUser = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'saved-number',
                    type: 'singleCondition',
                    setting: {
                        type: 'greaterThan',
                        idOrName: { type: 'id', id: 'number' },
                        fieldType: 'number',
                        value: 12.5,
                    },
                },
            ],
        };
        const m = readyFilter(f.options);
        assert.equal(m.getSnapshot().operand, '12.5');
        assert.equal(m.getSnapshot().unresolved, false);
        m.setOperand(' -2.75 ');
        assert.equal(f.applied.length, 0);
        assert.equal(m.apply(), true);
        assert.deepEqual(f.applied[0].filtersByEndUser, {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'saved-number',
                    type: 'singleCondition',
                    setting: {
                        type: 'greaterThan',
                        idOrName: { type: 'id', id: 'number' },
                        fieldType: 'number',
                        value: -2.75,
                    },
                },
            ],
        });
    });

    it('publishes multiple-select choice IDs as a detached array', () => {
        const f = editorFixture();
        const m = readyFilter(f.options);
        m.setField('multi');
        assert.equal(m.getSnapshot().multiple, true);
        assert.equal(m.setOperator('hasAllOf'), true);
        const operand = ['b', 'a'];
        assert.equal(m.setOperand(operand), true);
        operand.pop();
        assert.deepEqual(m.getSnapshot().operand, ['b', 'a']);
        assert.equal(m.apply(), true);
        assert.deepEqual(f.applied[0].filtersByEndUser, {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'portal_scalar_filter',
                    type: 'singleCondition',
                    setting: {
                        type: 'hasAllOf',
                        idOrName: { type: 'id', id: 'multi' },
                        fieldType: 'multipleSelects',
                        value: ['b', 'a'],
                    },
                },
            ],
        });
    });

    it('retires both editors when the application ownership callback throws', () => {
        const f = editorFixture();
        const filter = readyFilter(f.options);
        const sort = createPortalSortEditor(f.options);
        if (sort.type !== 'ready') throw new Error(sort.diagnostic);
        f.options.isCurrent = () => {
            throw new Error('Owner gone');
        };
        for (const model of [filter, sort.model]) {
            assert.equal(model.apply(), false);
            assert.equal(model.getSnapshot().retired, true);
            assert.deepEqual(model.getSnapshot().fields, []);
        }
        f.options.isCurrent = () => true;
        assert.equal(filter.clear(), false);
        assert.equal(sort.model.clear(), false);
        assert.equal(f.applied.length, 0);
    });
});

describe('Portal collection late failure boundaries', () => {
    it('does not restore a collection when a late rejection follows an unreadable owner', async () => {
        const result = deferredPortal<ListPortalLinkedRecordsResult>();
        const fixture = portalFixture(() => result.promise);
        let readable = true;
        const collection = createPortalCollection({
            client: fixture.client,
            portal: portalPage(),
            portalFieldId: 'fld_children',
            criteria: criteria(),
            getScope: () => {
                if (!readable) throw new Error('Owner unavailable');
                return { ownerId: 'visitor', revision: 0 };
            },
        });
        const pending = collection.readFirst({
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        readable = false;
        result.reject(new Error('Late server failure'));
        await assert.rejects(
            pending,
            (error) =>
                error instanceof PortalCollectionError &&
                error.code === 'scope-changed'
        );
        readable = true;
        assert.equal(collection.isCurrent(), false);
        assert.equal(collection.getSnapshot(), null);
        assert.equal(fixture.calls[0].options?.signal?.aborted, true);
        assert.equal(fixture.calls.length, 1);
        assert.equal(fixture.mutations, 0);
    });
});
