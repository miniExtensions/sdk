import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createPortalSortEditor,
    createPortalFilterEditor,
    type PortalEditorOptions,
} from '../src/portals/editors.js';
import type {
    PortalCollectionCriteria,
    PortalCollectionSnapshot,
} from '../src/portals/types.js';
import { portalPage, portalListPage } from './portalFixtures.js';
import type { RuntimeAirtableField } from '../src/runtime/index.js';
const fields = [
    {
        id: 'fld_text',
        name: 'Duplicate',
        description: null,
        isComputed: false,
        isPrimaryField: true,
        config: { type: 'singleLineText', options: null },
    },
    {
        id: 'fld_number',
        name: 'Duplicate',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'number', options: { precision: 1 } },
    },
    {
        id: 'fld_choice',
        name: 'Choice',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'singleSelect',
            options: {
                choices: [
                    { id: 'choice_a', name: 'Alpha', color: 'blueBright' },
                    { id: 'choice_b', name: 'Beta', color: 'blueBright' },
                ],
            },
        },
    },
] as RuntimeAirtableField[];
const criteria = (): PortalCollectionCriteria => ({
    selectedCustomViewId: 'view_example',
    searchTerm: 'Exact search',
    searchParamsMap: { retained: 'Native' },
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
export function editorFixture() {
    const portal = portalPage();
    const detailFields = [
        { fieldId: 'fld_text', isHidden: false, miniExtConfig: {} },
        { fieldId: 'fld_number', isHidden: false, miniExtConfig: {} },
    ];
    const snapshot = {
        ...portalListPage({
            recordIds: ['record_native'],
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: structuredClone(fields),
                    recordIdsToAirtableRecords: {
                        record_native: {
                            id: 'record_native',
                            fields: { fld_private: ['Native'] },
                        },
                    },
                },
            },
        }),
        criteriaKey: 'fixture',
        detailFields,
        customViewDetailFields: { fld_children: detailFields },
        layoutSettings: {},
    } as unknown as PortalCollectionSnapshot;
    let live = true,
        epoch = 0;
    const applied: PortalCollectionCriteria[] = [];
    const options: PortalEditorOptions = {
        portal,
        portalFieldId: 'fld_children',
        snapshot,
        criteria: criteria(),
        isCurrent: () => live,
        configurationRevision: () => epoch,
        onApply: (next) => applied.push(next),
    };
    return {
        options,
        applied,
        retire() {
            live = false;
        },
        change() {
            epoch++;
        },
    };
}
it('sort preparation is detached, subscribed, exact-ID and preserves all unrelated criteria with zero reads', () => {
    const f = editorFixture(),
        r = createPortalSortEditor(f.options);
    assert.equal(r.type, 'ready');
    if (r.type !== 'ready') return;
    const m = r.model,
        events: number[] = [];
    m.subscribe((s) => events.push(s.revision));
    assert.equal(
        m.getSnapshot().fields.filter((x) => x.name === 'Duplicate').length,
        2
    );
    const copy = m.getSnapshot();
    copy.fields[0].name = 'mutated';
    copy.originalCriteria!.searchTerm = 'mutated';
    assert.equal(m.getSnapshot().fields[0].name, 'Duplicate');
    assert.equal(m.setField('fld_number'), true);
    assert.equal(m.setDirection('desc'), true);
    assert.equal(f.applied.length, 0);
    assert.equal(m.apply(), true);
    assert.deepEqual(f.applied[0], {
        ...criteria(),
        sortFieldsByEndUser: [
            { idOrName: { type: 'id', id: 'fld_number' }, type: 'desc' },
        ],
    });
    assert.equal(m.clear(), false);
    assert.equal(m.getSnapshot().retired, true);
    assert(events.length >= 3);
});
it('filter choice IDs and scalar bytes prepare one exact leaf while preserving sort/search and native parent', () => {
    const f = editorFixture();
    f.options.criteria.sortFieldsByEndUser = [
        { idOrName: { type: 'id', id: 'fld_number' }, type: 'desc' },
    ];
    const parent = structuredClone(f.options.portal.payload.formRecord);
    const r = createPortalFilterEditor(f.options);
    assert.equal(r.type, 'ready');
    if (r.type !== 'ready') return;
    const m = r.model;
    assert.equal(m.setField('fld_choice'), true);
    assert.equal(m.setOperator('isAnyOf'), true);
    assert.equal(m.setOperand(['choice_b', 'choice_a']), true);
    assert.equal(f.applied.length, 0);
    assert.equal(m.apply(), true);
    const next = f.applied[0];
    assert.equal(next.searchTerm, 'Exact search');
    assert.deepEqual(
        next.sortFieldsByEndUser,
        f.options.criteria.sortFieldsByEndUser
    );
    assert.deepEqual(next.filtersByEndUser, {
        logicalOperator: 'and',
        conditions: [
            {
                id: 'portal_scalar_filter',
                type: 'singleCondition',
                setting: {
                    type: 'isAnyOf',
                    idOrName: { type: 'id', id: 'fld_choice' },
                    fieldType: 'singleSelect',
                    value: ['choice_b', 'choice_a'],
                },
            },
        ],
    });
    assert.deepEqual(f.options.portal.payload.formRecord, parent);
});
it('partial operands and unknown saved operands preserve the complete original AST until explicit replacement', () => {
    const f = editorFixture();
    f.options.criteria.filtersByEndUser = {
        logicalOperator: 'and',
        conditions: [
            {
                type: 'singleCondition',
                id: 'saved',
                setting: {
                    type: 'isAnyOf',
                    fieldType: 'singleSelect',
                    idOrName: { type: 'id', id: 'fld_choice' },
                    value: ['choice_a', 'deleted'],
                },
            },
        ],
    };
    const original = structuredClone(f.options.criteria),
        r = createPortalFilterEditor(f.options);
    assert.equal(r.type, 'ready');
    if (r.type !== 'ready') return;
    assert.equal(r.model.getSnapshot().unresolved, true);
    assert.equal(r.model.apply(), false);
    assert.equal(r.model.clear(), false);
    assert.deepEqual(r.model.getSnapshot().originalCriteria, original);
    assert.equal(r.model.prepareReplacement(), true);
    r.model.setOperand([]);
    assert.equal(r.model.apply(), false);
    assert.equal(f.applied.length, 0);
    assert.equal(r.model.clear(), true);
    assert.deepEqual(f.applied[0], { ...original, filtersByEndUser: null });
});
it('numeric blanks, unsupported operators and malformed choice operands fail without criteria mutation', () => {
    const f = editorFixture(),
        r = createPortalFilterEditor(f.options);
    if (r.type !== 'ready') throw Error(r.diagnostic);
    r.model.setField('fld_number');
    r.model.setOperand(' ');
    assert.equal(r.model.apply(), false);
    r.model.setOperand('Infinity');
    assert.equal(r.model.apply(), false);
    assert.equal(r.model.setOperator('matchesRegex'), false);
    r.model.setField('fld_choice');
    r.model.setOperand(['deleted']);
    assert.equal(r.model.apply(), false);
    assert.equal(f.applied.length, 0);
});
it('presence-aware metadata and observed owner/configuration ABA retire retained actions permanently', () => {
    for (const which of ['undefined', 'configuration', 'owner'] as const) {
        const f = editorFixture(),
            r = createPortalFilterEditor(f.options);
        if (r.type !== 'ready') throw Error(r.diagnostic);
        r.model.setOperand('Native');
        if (which === 'undefined') {
            Object.assign(
                f.options.portal.payload.fieldIdsToSchemas.fld_children
                    .miniExtConfig!,
                { disableFilteringOnExtension: undefined }
            );
            r.model.getSnapshot();
            delete (
                f.options.portal.payload.fieldIdsToSchemas.fld_children
                    .miniExtConfig as Record<string, unknown>
            ).disableFilteringOnExtension;
        }
        if (which === 'configuration') f.change();
        if (which === 'owner') f.retire();
        assert.equal(r.model.apply(), false);
        assert.equal(r.model.prepareReplacement(), false);
        assert.equal(f.applied.length, 0);
        assert.equal(r.model.getSnapshot().retired, true);
    }
});
it('sort and filter share caller criteria ownership, so either accepted Apply retires held other actions', () => {
    for (const sortFirst of [true, false]) {
        const f = editorFixture();
        let accepted = 0;
        f.options.isCurrent = () => accepted === 0;
        f.options.onApply = (next) => {
            accepted++;
            f.applied.push(next);
        };
        const s = createPortalSortEditor(f.options),
            v = createPortalFilterEditor(f.options);
        if (s.type !== 'ready' || v.type !== 'ready') throw Error('fixture');
        s.model.setField('fld_number');
        v.model.setOperand('Native');
        assert.equal(sortFirst ? s.model.apply() : v.model.apply(), true);
        assert.equal(sortFirst ? v.model.apply() : s.model.apply(), false);
        assert.equal(f.applied.length, 1);
    }
});
it('custom omitted-key replacement, hidden eligibility, empty choice metadata and stale restrictions retain existing boundaries', () => {
    const f = editorFixture();
    const config = f.options.portal.payload.fieldIdsToSchemas.fld_children
        .miniExtConfig as Record<string, unknown>;
    config.disableFilteringOnExtension = false;
    config.customViews = [
        { id: 'view_example', config: { viewBehavior: 'custom' } },
    ];
    assert.equal(createPortalFilterEditor(f.options).type, 'unavailable');
    config.customViews = [
        {
            id: 'view_example',
            config: {
                viewBehavior: 'custom',
                disableFilteringOnExtension: false,
                dropdownFiltersFields: [],
            },
        },
    ];
    let r = createPortalFilterEditor(f.options);
    assert.equal(r.type, 'ready');
    if (r.type === 'ready')
        assert(
            !r.model.getSnapshot().fields.some((x) => x.id === 'fld_choice')
        );
    config.customViews = [{ id: 'view_example' }];
    r = createPortalFilterEditor(f.options);
    assert.equal(r.type, 'ready');
    const choice =
        f.options.snapshot.tableIdsToLinkedTableStates.table_children.airtableFields.find(
            (x) => x.id === 'fld_choice'
        )!;
    (choice.config as { options: { choices: unknown[] } }).options.choices = [];
    r = createPortalFilterEditor(f.options);
    if (r.type !== 'ready') throw Error(r.diagnostic);
    r.model.setField('fld_choice');
    assert.deepEqual(r.model.getSnapshot().operators, [
        'isEmpty',
        'isNotEmpty',
    ]);
    assert.equal(r.model.apply(), true);
});
it('reentrant ownership withdrawal or disposal cannot publish a prepared replacement', () => {
    for (const mode of ['withdraw', 'destroy'] as const) {
        const f = editorFixture();
        let hook = () => true;
        f.options.isCurrent = () => hook();
        const r = createPortalSortEditor(f.options);
        if (r.type !== 'ready') throw Error(r.diagnostic);
        r.model.setField('fld_number');
        hook = () => {
            if (mode === 'destroy') r.model.destroy();
            return mode === 'destroy';
        };
        assert.equal(r.model.apply(), false);
        assert.equal(f.applied.length, 0);
    }
});
it('retirement subscribers withdrawing ownership suppress Apply publication for both editors', () => {
    for (const kind of ['sort', 'filter']) {
        const f = editorFixture(),
            r =
                kind === 'sort'
                    ? createPortalSortEditor(f.options)
                    : createPortalFilterEditor(f.options);
        if (r.type !== 'ready') throw Error(r.diagnostic);
        if (kind === 'filter')
            'setOperand' in r.model && r.model.setOperand('Exact');
        r.model.subscribe((s) => {
            if (s.retired) f.retire();
        });
        assert.equal(r.model.apply(), false);
        assert.equal(f.applied.length, 0);
        assert.equal(r.model.getSnapshot().retired, true);
    }
});
it('retirement subscriber self-reentry cannot duplicate Apply or Clear publication', () => {
    for (const kind of ['sort', 'filter']) {
        const f = editorFixture(),
            r =
                kind === 'sort'
                    ? createPortalSortEditor(f.options)
                    : createPortalFilterEditor(f.options);
        if (r.type !== 'ready') throw Error(r.diagnostic);
        if (kind === 'filter')
            'setOperand' in r.model && r.model.setOperand('Exact');
        const repeats: boolean[] = [];
        r.model.subscribe((s) => {
            if (s.retired) {
                repeats.push(r.model.apply(), r.model.clear());
            }
        });
        assert.equal(r.model.apply(), true);
        assert.deepEqual(repeats, [false, false]);
        assert.equal(f.applied.length, 1);
    }
});
it('original returned sort metadata and criteria mutations retire the headless lease', () => {
    for (const kind of ['metadata', 'criteria']) {
        const f = editorFixture(),
            r = createPortalSortEditor(f.options);
        if (r.type !== 'ready') throw Error(r.diagnostic);
        r.model.setField('fld_number');
        if (kind === 'metadata')
            f.options.snapshot.tableIdsToLinkedTableStates.table_children.airtableFields =
                f.options.snapshot.tableIdsToLinkedTableStates.table_children.airtableFields.filter(
                    (field) => field.id !== 'fld_number'
                );
        else f.options.criteria.searchTerm = 'Changed';
        assert.equal(r.model.apply(), false);
        assert.equal(f.applied.length, 0);
        assert.equal(r.model.getSnapshot().retired, true);
    }
});
