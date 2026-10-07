import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as f } from './portal-recipe-checks.mjs';
const button = (root, label) => {
    const b = [...root.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === label
    );
    assert(b, label);
    return b;
};
const criteria = () => ({
    selectedCustomViewId: 'view_example',
    searchTerm: 'Keep search',
    sortFieldsByEndUser: [
        { idOrName: { type: 'id', id: 'fld_title' }, type: 'desc' },
    ],
    filtersByEndUser: null,
    searchParamsMap: { retained: 'Exact' },
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
const controls = (root) => {
    const n = root.matches?.('[aria-label="Portal condition filtering"]')
        ? root
        : root.querySelector('[aria-label="Portal condition filtering"]');
    assert(n);
    const [field, operator, bool, choices] = n.querySelectorAll('select');
    return {
        node: n,
        field,
        operator,
        bool,
        choices,
        value: n.querySelector('input'),
        apply: button(n, 'Apply filter'),
        clear: button(n, 'Clear filter'),
    };
};
const change = (w, n) =>
    n.dispatchEvent(new w.Event('change', { bubbles: true }));
const assertOperandRows = (window, c, textVisible, checkboxVisible) => {
    for (const [control, label, visible] of [
        [c.value, 'Filter value', textVisible],
        [c.bool, 'Checkbox value', checkboxVisible],
    ]) {
        const row = control.closest('label');
        assert(row);
        assert.equal(row.firstChild.textContent, label);
        assert.equal(row.hidden, !visible, label);
        assert.equal(
            window.getComputedStyle(row).display !== 'none',
            visible,
            label
        );
        assert.equal(control.hidden, !visible, label);
    }
};
const condition = (id, type, operator, value) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'existing_filter',
            type: 'singleCondition',
            setting: {
                type: operator,
                idOrName: { type: 'id', id },
                fieldType: type,
                value,
            },
        },
    ],
});
export async function checkPortalFilterCases({
    check,
    mount,
    environment,
    loadExample,
    editablePortal,
    consumer,
}) {
    const fixture = JSON.parse(
        readFileSync('test/fixtures/portalFilter.json', 'utf8')
    );
    const compiler = await import(
        pathToFileURL(
            join(
                consumer,
                'node_modules/@miniextensions/sdk/dist/esm/forms/index.js'
            )
        ).href
    );
    const snapshot = () => ({
        ...f.page([]),
        criteriaKey: 'fixture',
        detailFields: [],
        layoutSettings: {},
    });
    const standalone = async (
        p = editablePortal(),
        s = snapshot(),
        c = criteria()
    ) => {
        const env = await environment();
        const { mountPortalScalarFilterEditor } =
            await loadExample('portalFilter');
        const changes = [];
        const editor = mountPortalScalarFilterEditor({
            portal: p,
            portalFieldId: 'fld_children',
            snapshot: s,
            criteria: c,
            isCurrent: () => true,
            onApply: (n) => changes.push(n),
        });
        if (editor.type === 'ready')
            env.window.document.getElementById('screen').append(editor.node);
        return { ...env, editor, changes };
    };
    const selectFields = () =>
        ['singleSelect', 'multipleSelects'].map((type, i) => ({
            id: `fld_choice_${i}`,
            name: 'Same field label',
            isComputed: false,
            config: {
                type,
                options: {
                    choices: [
                        { id: 'sel_a', name: '<b>Alpha</b>' },
                        { id: 'sel_b', name: 'Beta, "quoted"' },
                    ],
                },
            },
        }));
    const selectSnapshot = () => {
        const s = snapshot();
        s.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
            ...selectFields()
        );
        return s;
    };
    const choose = (w, ui, id, op, ids = []) => {
        ui.field.value = id;
        change(w, ui.field);
        ui.operator.value = op;
        change(w, ui.operator);
        for (const o of ui.choices.options) o.selected = ids.includes(o.value);
        change(w, ui.choices);
    };
    await check(
        'installed select editor executes all12 exact-ID typed operators without automatic requests',
        async () => {
            for (const [type, id, ops] of [
                [
                    'singleSelect',
                    'fld_choice_0',
                    [
                        'is',
                        'isNot',
                        'isAnyOf',
                        'isNoneOf',
                        'isEmpty',
                        'isNotEmpty',
                    ],
                ],
                [
                    'multipleSelects',
                    'fld_choice_1',
                    [
                        'hasAnyOf',
                        'hasAllOf',
                        'hasNoneOf',
                        'isExactly',
                        'isEmpty',
                        'isNotEmpty',
                    ],
                ],
            ])
                for (const op of ops) {
                    const c = criteria(),
                        before = structuredClone(c);
                    const h = await standalone(undefined, selectSnapshot(), c);
                    assert.equal(h.editor.type, 'ready');
                    const ui = controls(h.editor.node);
                    const ids = ['is', 'isNot'].includes(op)
                        ? ['sel_b']
                        : ['sel_a', 'sel_b'];
                    choose(h.window, ui, id, op, ids);
                    assert.equal(h.changes.length, 0);
                    assert.equal(
                        ui.choices.closest('label').hidden,
                        ['isEmpty', 'isNotEmpty'].includes(op)
                    );
                    assert.equal(
                        ui.choices.closest('label').firstChild.textContent,
                        'Filter choices'
                    );
                    assert.equal(
                        ui.choices.options[1].textContent,
                        '<b>Alpha</b>'
                    );
                    assert.equal(ui.node.querySelector('b'), null);
                    ui.apply.click();
                    assert.equal(h.changes.length, 1, op);
                    const expected = condition(
                        id,
                        type,
                        op,
                        ['is', 'isNot'].includes(op) ? 'sel_b' : ids
                    );
                    expected.conditions[0].id = 'portal_scalar_filter';
                    if (['isEmpty', 'isNotEmpty'].includes(op))
                        delete expected.conditions[0].setting.value;
                    assert.deepEqual(h.changes[0], {
                        ...before,
                        filtersByEndUser: expected,
                    });
                    assert.deepEqual(c, before);
                    const compiled = compiler.compileRuntimeConditions({
                        conditions: expected,
                        airtableFields: selectFields(),
                        invalidConditionMode: 'strict',
                        fieldReferenceMode: 'saved',
                    });
                    assert.equal(compiled.type, 'compiled');
                    assert.deepEqual(compiled.diagnostics, []);
                    await h.close();
                }
        }
    );
    await check(
        'select eligibility is visible UNION dropdown, independent of Form policy and quick dropdown visibility',
        async () => {
            for (const [dropdown, visible, expected] of [
                [null, [], ['fld_choice_0', 'fld_choice_1']],
                [undefined, [], ['fld_choice_0', 'fld_choice_1']],
                [[], ['fld_choice_0'], ['fld_choice_0']],
                [
                    ['fld_choice_1'],
                    ['fld_choice_0'],
                    ['fld_choice_0', 'fld_choice_1'],
                ],
                [['fld_deleted'], ['fld_choice_0'], ['fld_choice_0']],
            ]) {
                const p = editablePortal(),
                    s = selectSnapshot(),
                    root =
                        p.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
                root.dropdownFiltersFields = dropdown;
                root.hideDropdownFilters = true;
                root.readOnly = true;
                root.limitLinkedRecordsToAvailableOptions = true;
                p.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    visible.map((fieldId) => ({ fieldId, isHidden: false }));
                const h = await standalone(p, s);
                assert.equal(h.editor.type, 'ready');
                assert.deepEqual(
                    [...controls(h.editor.node).field.options]
                        .map((o) => o.value)
                        .filter((id) => id.startsWith('fld_choice')),
                    expected
                );
                await h.close();
            }
            for (const custom of [false, true]) {
                const p = editablePortal(),
                    s = selectSnapshot(),
                    root =
                        p.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
                root.dropdownFiltersFields = [];
                root.hideDropdownFilters = true;
                root.customViews[0].config = custom
                    ? {
                          viewBehavior: 'custom',
                          disableFilteringOnExtension: false,
                      }
                    : undefined;
                const h = await standalone(p, s);
                assert.equal(h.editor.type, 'ready');
                assert.deepEqual(
                    [...controls(h.editor.node).field.options]
                        .map((o) => o.value)
                        .filter((id) => id.startsWith('fld_choice')),
                    custom ? ['fld_choice_0', 'fld_choice_1'] : []
                );
                await h.close();
            }
            const p = editablePortal(),
                s = selectSnapshot();
            s.customViewDetailFields = {};
            const h = await standalone(p, s);
            assert.equal(h.editor.type, 'ready');
            assert.deepEqual(
                [...controls(h.editor.node).field.options].map((o) => o.value),
                ['fld_choice_0', 'fld_choice_1']
            );
            await h.close();
        }
    );
    await check(
        'zero choices retain emptiness capabilities and ambiguous choices fail closed',
        async () => {
            for (const mode of [
                'empty',
                'duplicate-id',
                'duplicate-name',
                'null',
                'sparse',
            ]) {
                const s = selectSnapshot(),
                    fields =
                        s.tableIdsToLinkedTableStates.tbl_children
                            .airtableFields;
                const list = fields.find((f) => f.id === 'fld_choice_0').config
                    .options.choices;
                if (mode === 'empty') list.length = 0;
                if (mode === 'duplicate-id') list[1].id = list[0].id;
                if (mode === 'duplicate-name') list[1].name = list[0].name;
                if (mode === 'null') list[1] = null;
                if (mode === 'sparse') delete list[1];
                const h = await standalone(undefined, s);
                if (mode === 'empty') {
                    assert.equal(h.editor.type, 'ready');
                    const ui = controls(h.editor.node);
                    choose(h.window, ui, 'fld_choice_0', 'isEmpty');
                    assert.deepEqual(
                        [...ui.operator.options].map((o) => o.value),
                        ['isEmpty', 'isNotEmpty']
                    );
                    ui.apply.click();
                    assert.equal(h.changes.length, 1);
                } else {
                    assert.equal(h.editor.type, 'unavailable');
                    assert.equal(h.changes.length, 0);
                }
                await h.close();
            }
        }
    );
    await check(
        'unknown and partially unknown saved operands preserve whole AST until explicit replacement; known arrays restore every ID',
        async () => {
            for (const [type, op, value] of [
                ['singleSelect', 'is', 'sel_deleted'],
                ['singleSelect', 'isAnyOf', ['sel_a', 'sel_deleted']],
                ['singleSelect', 'isNoneOf', ['sel_a', 'sel_deleted']],
                ['multipleSelects', 'hasAnyOf', ['sel_a', 'sel_deleted']],
                ['multipleSelects', 'hasAllOf', ['sel_a', 'sel_deleted']],
                ['multipleSelects', 'hasNoneOf', ['sel_a', 'sel_deleted']],
                ['multipleSelects', 'isExactly', ['sel_a', 'sel_deleted']],
            ]) {
                const c = criteria();
                c.filtersByEndUser = condition(
                    type === 'singleSelect' ? 'fld_choice_0' : 'fld_choice_1',
                    type,
                    op,
                    value
                );
                const before = structuredClone(c),
                    h = await standalone(undefined, selectSnapshot(), c),
                    ui = controls(h.editor.node);
                assert(ui.apply.disabled);
                assert.match(
                    ui.node.textContent,
                    /saved choices are unavailable/
                );
                ui.apply.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                ui.clear.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                assert.equal(h.changes.length, 0);
                assert.deepEqual(c, before);
                button(ui.node, 'Replace existing filters').click();
                assert.equal(h.changes.length, 0);
                choose(
                    h.window,
                    ui,
                    type === 'singleSelect' ? 'fld_choice_0' : 'fld_choice_1',
                    op,
                    ['sel_b']
                );
                ui.apply.click();
                assert.equal(h.changes.length, 1);
                assert.deepEqual(c, before);
                await h.close();
            }
            for (const [type, op] of [
                ['singleSelect', 'isAnyOf'],
                ['multipleSelects', 'isExactly'],
            ]) {
                const c = criteria();
                c.filtersByEndUser = condition(
                    type === 'singleSelect' ? 'fld_choice_0' : 'fld_choice_1',
                    type,
                    op,
                    ['sel_a', 'sel_b']
                );
                const h = await standalone(undefined, selectSnapshot(), c),
                    ui = controls(h.editor.node);
                assert.deepEqual(
                    [...ui.choices.selectedOptions].map((o) => o.value),
                    ['sel_a', 'sel_b']
                );
                ui.apply.click();
                assert.deepEqual(
                    h.changes[0].filtersByEndUser,
                    c.filtersByEndUser
                );
                await h.close();
            }
        }
    );
    await check(
        'choice/configuration/criteria observed ABA retires held handlers without callbacks',
        async () => {
            for (const mode of ['choice', 'config', 'criteria']) {
                const p = editablePortal(),
                    s = selectSnapshot(),
                    c = criteria(),
                    h = await standalone(p, s, c),
                    ui = controls(h.editor.node);
                choose(h.window, ui, 'fld_choice_0', 'is', ['sel_a']);
                const list =
                    s.tableIdsToLinkedTableStates.tbl_children.airtableFields.find(
                        (f) => f.id === 'fld_choice_0'
                    ).config.options.choices;
                if (mode === 'choice') list[0].name = 'Renamed';
                if (mode === 'config')
                    p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.dropdownFiltersFields =
                        [];
                if (mode === 'criteria') c.searchTerm = 'Changed';
                ui.apply.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                if (mode === 'choice') list[0].name = '<b>Alpha</b>';
                if (mode === 'config')
                    delete p.payload.fieldIdsToSchemas.fld_children
                        .miniExtConfig.dropdownFiltersFields;
                if (mode === 'criteria') c.searchTerm = 'Keep search';
                ui.apply.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                assert.equal(h.changes.length, 0);
                assert(ui.node.inert);
                await h.close();
            }
        }
    );
    await check(
        'actual copied starter select Apply submits every finite operator only on explicit Load and retires offset/actions',
        async () => {
            for (const [type, ops] of [
                [
                    'singleSelect',
                    [
                        'is',
                        'isNot',
                        'isAnyOf',
                        'isNoneOf',
                        'isEmpty',
                        'isNotEmpty',
                    ],
                ],
                [
                    'multipleSelects',
                    [
                        'hasAnyOf',
                        'hasAllOf',
                        'hasNoneOf',
                        'isExactly',
                        'isEmpty',
                        'isNotEmpty',
                    ],
                ],
            ])
                for (const op of ops) {
                    const id =
                        type === 'singleSelect'
                            ? 'fld_choice_0'
                            : 'fld_choice_1';
                    let reads = 0;
                    const h = await mount({
                        initialCriteria: criteria(),
                        handlers: {
                            list: ({ input }) => {
                                reads++;
                                const pg = f.page(
                                    [f.record('rec_old', 'Old')],
                                    reads === 1 ? 'old_cursor' : null
                                );
                                pg.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
                                    ...selectFields()
                                );
                                if (reads === 2) {
                                    assert.equal(input.airtableOffset, null);
                                    assert.equal(
                                        input.searchTerm,
                                        'Keep search'
                                    );
                                    assert.deepEqual(input.searchParamsMap, {
                                        retained: 'Exact',
                                    });
                                    assert.deepEqual(
                                        input.sortFieldsByEndUser,
                                        criteria().sortFieldsByEndUser
                                    );
                                    const expected = condition(
                                        id,
                                        type,
                                        op,
                                        ['is', 'isNot'].includes(op)
                                            ? 'sel_a'
                                            : ['sel_a', 'sel_b']
                                    );
                                    expected.conditions[0].id =
                                        'portal_scalar_filter';
                                    if (['isEmpty', 'isNotEmpty'].includes(op))
                                        delete expected.conditions[0].setting
                                            .value;
                                    assert.deepEqual(
                                        input.filtersByEndUser,
                                        expected
                                    );
                                }
                                return pg;
                            },
                        },
                    });
                    await h.click('Load records');
                    const ui = controls(h.view.node);
                    choose(
                        h.window,
                        ui,
                        id,
                        op,
                        ['is', 'isNot'].includes(op)
                            ? ['sel_a']
                            : ['sel_a', 'sel_b']
                    );
                    ui.apply.click();
                    assert.equal(reads, 1);
                    assert(button(h.view.node, 'Create record').disabled);
                    assert(button(h.view.node, 'Next page').disabled);
                    assert.equal(h.view.node.querySelector('tbody'), null);
                    ui.apply.dispatchEvent(
                        new h.window.Event('click', { bubbles: true })
                    );
                    assert.equal(reads, 1);
                    await h.click('Load records');
                    assert.equal(reads, 2);
                    await h.dispose();
                }
        }
    );
    await check(
        'presence-aware policy rejects absent-to-own-undefined filtering transition before retained Apply',
        async () => {
            const p = editablePortal(),
                s = selectSnapshot(),
                c = criteria(),
                before = structuredClone(c);
            const root = p.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
            assert.equal(
                Object.hasOwn(root, 'disableFilteringOnExtension'),
                false
            );
            const h = await standalone(p, s, c),
                ui = controls(h.editor.node);
            choose(h.window, ui, 'fld_choice_0', 'is', ['sel_a']);
            const priorFetch = globalThis.fetch,
                priorWindowFetch = h.window.fetch;
            let io = 0;
            const unexpectedRequest = async () => {
                io++;
                throw new Error('Unexpected retained-handler request');
            };
            globalThis.fetch = unexpectedRequest;
            h.window.fetch = unexpectedRequest;
            try {
                root.disableFilteringOnExtension = undefined;
                assert.equal(
                    Object.hasOwn(root, 'disableFilteringOnExtension'),
                    true
                );
                ui.apply.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                assert.equal(h.changes.length, 0);
                assert.deepEqual(c, before);
                assert(ui.node.inert);
                delete root.disableFilteringOnExtension;
                ui.apply.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                assert.equal(h.changes.length, 0);
                assert.equal(io, 0);
            } finally {
                globalThis.fetch = priorFetch;
                h.window.fetch = priorWindowFetch;
                await h.close();
            }
        }
    );
    await check(
        'scalar recipe executes all87 advertised operator/type pairs against pinned canonical formula and normalization',
        async () => {
            assert.equal(
                fixture.provenance.revision,
                '58f73d575ab10baa0a10693660d8002f204368e1'
            );
            assert.equal(
                fixture.provenance.tree,
                'b39e58ead46a311c497def57474cf5ca720542ae'
            );
            assert.equal(
                createHash('sha256')
                    .update(readFileSync(fixture.provenance.generator))
                    .digest('hex'),
                fixture.provenance.generatorSha256
            );
            const { window, close } = await environment();
            const style = window.document.createElement('style');
            style.textContent = readFileSync(
                join(consumer, 'styles.css'),
                'utf8'
            );
            window.document.head.append(style);
            const { mountPortalScalarFilterEditor } =
                await loadExample('portalFilter');
            let count = 0;
            for (const { input, expected } of fixture.cases.slice(0, 87)) {
                assert.deepEqual(expected.issues, [], input.name);
                const p = editablePortal(),
                    s = snapshot();
                p.payload.linkedRecordFieldIdToDetailFields.fld_children = [];
                s.tableIdsToLinkedTableStates.tbl_children.airtableFields = [
                    input.field,
                ];
                const changes = [];
                const e = mountPortalScalarFilterEditor({
                    portal: p,
                    portalFieldId: 'fld_children',
                    criteria: criteria(),
                    snapshot: s,
                    isCurrent: () => true,
                    onApply: (n) => changes.push(n),
                });
                assert.equal(e.type, 'ready', input.name);
                window.document.getElementById('screen').append(e.node);
                const c = controls(e.node),
                    setting = input.conditions.conditions[0].setting;
                c.operator.value = setting.type;
                assert.equal(c.operator.value, setting.type, input.name);
                change(window, c.operator);
                const needsOperand = !['isEmpty', 'isNotEmpty'].includes(
                    setting.type
                );
                assertOperandRows(
                    window,
                    c,
                    needsOperand && input.field.config.type !== 'checkbox',
                    needsOperand && input.field.config.type === 'checkbox'
                );
                c.value.value =
                    setting.value === undefined ? '' : String(setting.value);
                c.bool.value = String(setting.value);
                c.apply.click();
                assert.equal(changes.length, 1, input.name);
                const normalized = structuredClone(expected.filters);
                normalized.conditions[0].id = 'portal_scalar_filter';
                assert.deepEqual(
                    changes[0].filtersByEndUser,
                    normalized,
                    input.name
                );
                const result = compiler.compileRuntimeConditions({
                    conditions: normalized,
                    airtableFields: [input.field],
                    invalidConditionMode: 'strict',
                    fieldReferenceMode: 'saved',
                });
                assert.equal(result.type, 'compiled');
                assert.equal(result.formula, expected.formula, input.name);
                assert.deepEqual(result.diagnostics, []);
                assert.deepEqual(changes[0].searchParamsMap, {
                    retained: 'Exact',
                });
                e.node.remove();
                count++;
            }
            assert.equal(count, 87);
            // Exercise one live editor across field and operator changes,
            // retaining valid operands when only presentation changes.
            const p = editablePortal(),
                s = snapshot();
            const checkbox = {
                id: 'fld_checked',
                name: 'Checked',
                config: { type: 'checkbox' },
            };
            s.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
                checkbox
            );
            p.payload.linkedRecordFieldIdToDetailFields.fld_children.push({
                fieldId: checkbox.id,
                isHidden: false,
            });
            const changes = [];
            const e = mountPortalScalarFilterEditor({
                portal: p,
                portalFieldId: 'fld_children',
                criteria: criteria(),
                snapshot: s,
                isCurrent: () => true,
                onApply: (n) => changes.push(n),
            });
            assert.equal(e.type, 'ready');
            window.document.getElementById('screen').append(e.node);
            const c = controls(e.node);
            for (const [id, op, operand] of [
                ['fld_title', 'contains', ' Exact text '],
                ['fld_quantity', 'equals', '25'],
            ]) {
                c.field.value = id;
                change(window, c.field);
                c.operator.value = op;
                change(window, c.operator);
                c.value.value = operand;
                assertOperandRows(window, c, true, false);
                c.operator.value = 'isEmpty';
                change(window, c.operator);
                assertOperandRows(window, c, false, false);
                assert.equal(c.value.value, operand);
                c.operator.value = op;
                change(window, c.operator);
                assertOperandRows(window, c, true, false);
                assert.equal(c.value.value, operand);
            }
            c.field.value = checkbox.id;
            change(window, c.field);
            assertOperandRows(window, c, false, true);
            c.bool.value = 'true';
            c.field.value = 'fld_title';
            change(window, c.field);
            assertOperandRows(window, c, true, false);
            c.field.value = checkbox.id;
            change(window, c.field);
            assertOperandRows(window, c, false, true);
            assert.equal(c.bool.value, 'true');
            c.apply.click();
            assert.equal(changes.length, 1);
            assert.equal(
                changes[0].filtersByEndUser.conditions[0].setting.value,
                true
            );
            await close();
        }
    );
    await check(
        'canonical boundary normalization fixtures retain exact refusal and conservative compiler differences',
        async () => {
            assert.equal(fixture.cases.length, 99);
            for (const { input, expected } of fixture.cases.slice(87)) {
                if (
                    [
                        'missing',
                        'type-changed',
                        'not-allowed',
                        'empty-id',
                    ].includes(input.mode)
                ) {
                    assert.equal(expected.filters, null, input.name);
                    assert.deepEqual(expected.issues, [
                        {
                            missing: 'field_not_found',
                            'type-changed': 'field_type_changed',
                            'not-allowed': 'field_not_available',
                            'empty-id': 'invalid_condition',
                        }[input.mode],
                    ]);
                } else if (expected.filters == null) {
                    assert.deepEqual(
                        expected.issues,
                        ['invalid_value'],
                        input.name
                    );
                } else {
                    const compiled = compiler.compileRuntimeConditions({
                        conditions: expected.filters,
                        airtableFields: [input.field],
                        invalidConditionMode: 'strict',
                        fieldReferenceMode: 'saved',
                    });
                    if (
                        input.conditions.conditions[0].setting.type ===
                            'matchesRegex' &&
                        input.conditions.conditions[0].setting.value === '['
                    ) {
                        assert.equal(compiled.type, 'invalid');
                        assert(
                            compiled.diagnostics.some(
                                (d) => d.code === 'invalid-regex'
                            )
                        );
                    } else {
                        assert.equal(compiled.type, 'compiled', input.name);
                        assert.equal(
                            compiled.formula,
                            expected.formula,
                            input.name
                        );
                        assert.deepEqual(compiled.diagnostics, []);
                    }
                }
            }
        }
    );
    await check(
        'root key presence and custom/omitted-whole-config enablement agree with15 actual canonical cases',
        async () => {
            for (const { input, enabled, hasKey } of fixture.settings) {
                const p = editablePortal(),
                    root =
                        p.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
                delete root.disableFilteringOnExtension;
                if (input.kind !== 'absent')
                    root.disableFilteringOnExtension =
                        input.kind === 'undefined'
                            ? undefined
                            : JSON.parse(input.kind);
                if (input.scope === 'custom') {
                    root.customViews[0].config = { viewBehavior: 'custom' };
                    if (input.kind !== 'absent')
                        root.customViews[0].config.disableFilteringOnExtension =
                            root.disableFilteringOnExtension;
                    delete root.disableFilteringOnExtension;
                } else if (input.scope === 'omitted-config')
                    delete root.customViews[0].config;
                const h = await standalone(p);
                assert.equal(
                    h.editor.type,
                    enabled ? 'ready' : 'unavailable',
                    JSON.stringify(input)
                );
                if (input.scope === 'custom') assert(hasKey);
                await h.close();
            }
        }
    );
    await check(
        'missing and empty accepted/legacy projections differ; hidden partial other-table fields never recover',
        async () => {
            for (const mode of [
                'missing-legacy',
                'empty-legacy',
                'missing-returned',
                'empty-returned',
                'partial',
                'hidden',
                'other-table',
            ]) {
                const p = editablePortal(),
                    s = snapshot();
                if (mode.includes('legacy')) {
                    if (mode.startsWith('missing'))
                        delete p.payload.linkedRecordFieldIdToDetailFields
                            .fld_children;
                    else
                        p.payload.linkedRecordFieldIdToDetailFields.fld_children =
                            [];
                } else {
                    s.customViewDetailFields =
                        mode === 'missing-returned' ? {} : { fld_children: [] };
                }
                if (mode === 'partial') {
                    s.customViewDetailFields.fld_children = [
                        { fieldId: 'fld_unreturned', isHidden: false },
                    ];
                    s.tableIdsToLinkedTableStates.tbl_children.airtableFields.forEach(
                        (x) => (x.isPrimaryField = false)
                    );
                }
                if (mode === 'hidden') {
                    s.customViewDetailFields.fld_children = [
                        { fieldId: 'fld_quantity', isHidden: true },
                    ];
                }
                if (mode === 'other-table') {
                    delete s.tableIdsToLinkedTableStates.tbl_children;
                    s.tableIdsToLinkedTableStates.other = f.page(
                        []
                    ).tableIdsToLinkedTableStates.tbl_children;
                }
                const h = await standalone(p, s);
                assert.equal(
                    h.editor.type,
                    ['empty-legacy', 'empty-returned', 'hidden'].includes(mode)
                        ? 'ready'
                        : 'unavailable',
                    mode
                );
                if (h.editor.type === 'ready')
                    assert.deepEqual(
                        [...controls(h.editor.node).field.options].map(
                            (x) => x.value
                        ),
                        ['fld_title']
                    );
                await h.close();
            }
        }
    );
    await check(
        'strict value entry preserves bytes, refuses blank and nonfinite numbers, and retains compiler empty/regex behavior',
        async () => {
            for (const [type, op, value, success] of [
                ['number', 'equals', '', false],
                ['number', 'equals', '   ', false],
                ['number', 'equals', 'Infinity', false],
                ['number', 'equals', '0', true],
                ['percent', 'equals', '25', true],
                ['singleLineText', 'isOfLength', '', false],
                ['singleLineText', 'isOfLength', '-2.5', true],
                ['singleLineText', 'is', '', false],
                ['singleLineText', 'isNot', '', false],
                ['singleLineText', 'contains', '', true],
                ['singleLineText', 'doesNotContain', '', true],
                ['singleLineText', 'matchesRegex', '', true],
                ['singleLineText', 'matchesRegex', '[', false],
                ['singleLineText', 'contains', '  Exact bytes  ', true],
            ]) {
                const p = editablePortal(),
                    s = snapshot();
                s.tableIdsToLinkedTableStates.tbl_children.airtableFields = [
                    {
                        id: 'fld_value',
                        name: 'Value',
                        isComputed: false,
                        isPrimaryField: true,
                        config: { type, options: null },
                    },
                ];
                p.payload.linkedRecordFieldIdToDetailFields.fld_children = [];
                const h = await standalone(p, s);
                assert.equal(h.editor.type, 'ready');
                const c = controls(h.editor.node);
                c.operator.value = op;
                change(h.window, c.operator);
                c.value.value = value;
                c.apply.click();
                assert.equal(
                    h.changes.length,
                    success ? 1 : 0,
                    [type, op, value].join('/')
                );
                if (
                    success &&
                    !['number', 'percent'].includes(type) &&
                    op !== 'isOfLength'
                )
                    assert.equal(
                        h.changes[0].filtersByEndUser.conditions[0].setting
                            .value,
                        value
                    );
                await h.close();
            }
        }
    );
    await check(
        'unsupported rich AST and invalid identities survive until explicit replacement, including missing-field FALSE warning',
        async () => {
            const richer = [
                { logicalOperator: 'and', conditions: [] },
                {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'group',
                            type: 'groupCondition',
                            logicalOperator: 'or',
                            conditions: [],
                        },
                    ],
                },
                condition('fld_title', 'singleLineText', 'contains', 'Keep'),
                condition('fld_missing', 'number', 'equals', 2),
                condition(
                    'fld_quantity',
                    'singleLineText',
                    'contains',
                    'Wrong'
                ),
            ];
            richer[2].conditions[0].setting.idOrName = {
                type: 'name',
                name: 'Title',
            };
            const noId = condition(
                'fld_title',
                'singleLineText',
                'contains',
                'Keep'
            );
            noId.conditions[0].id = '';
            richer.push(noId);
            richer.push({
                logicalOperator: 'and',
                conditions: [
                    condition('fld_title', 'singleLineText', 'contains', 'A')
                        .conditions[0],
                    condition('fld_title', 'singleLineText', 'contains', 'B')
                        .conditions[0],
                ],
            });
            for (const saved of richer) {
                const c = criteria();
                c.filtersByEndUser = saved;
                const before = structuredClone(c);
                const h = await standalone(undefined, undefined, c);
                assert.equal(h.editor.type, 'ready');
                const ui = controls(h.editor.node);
                assert(ui.apply.disabled);
                ui.apply.click();
                ui.clear.click();
                assert.equal(h.changes.length, 0);
                assert.deepEqual(c, before);
                button(h.editor.node, 'Replace existing filters').click();
                assert.equal(h.changes.length, 0);
                ui.clear.click();
                assert.equal(h.changes.length, 1);
                assert.equal(h.changes[0].filtersByEndUser, null);
                assert.deepEqual(
                    h.changes[0].sortFieldsByEndUser,
                    c.sortFieldsByEndUser
                );
                await h.close();
            }
            const missing = compiler.compileRuntimeConditions({
                conditions: condition('fld_missing', 'number', 'equals', 2),
                airtableFields: [],
                invalidConditionMode: 'strict',
            });
            assert.equal(missing.type, 'compiled');
            assert(missing.diagnostics.some((x) => x.code === 'missing-field'));
            assert.match(missing.formula, /FALSE/);
        }
    );
    await check(
        'metadata failures are presentation only; duplicates use IDs, legacy whitelist/dropdown IDs do not restrict scalars',
        async () => {
            for (const mode of [
                'duplicate-label',
                'legacy-list',
                'dropdown-scalar',
                'computed',
                'malformed',
                'duplicate-id',
                'view-array',
                'view-number',
                'view-string',
            ]) {
                const p = editablePortal(),
                    s = snapshot(),
                    root =
                        p.payload.fieldIdsToSchemas.fld_children.miniExtConfig,
                    fields =
                        s.tableIdsToLinkedTableStates.tbl_children
                            .airtableFields;
                if (mode === 'duplicate-label') fields[1].name = fields[0].name;
                if (mode === 'legacy-list')
                    root.filteringOnExtensionFields = ['fld_unreturned'];
                if (mode === 'dropdown-scalar')
                    root.dropdownFiltersFields = ['fld_quantity'];
                if (mode === 'computed')
                    fields.forEach((x) => (x.isComputed = true));
                if (mode === 'malformed') fields[0].isComputed = 'true';
                if (mode === 'duplicate-id')
                    fields.push(structuredClone(fields[0]));
                if (mode.startsWith('view-'))
                    root.customViews[0].config =
                        mode === 'view-array'
                            ? []
                            : mode === 'view-number'
                              ? 123
                              : 'bad';
                const h = await standalone(p, s);
                assert.equal(
                    h.editor.type,
                    [
                        'duplicate-label',
                        'legacy-list',
                        'dropdown-scalar',
                    ].includes(mode)
                        ? 'ready'
                        : 'unavailable',
                    mode
                );
                if (h.editor.type === 'ready') {
                    const c = controls(h.editor.node);
                    assert.deepEqual(
                        [...c.field.options].map((x) => x.value),
                        ['fld_title', 'fld_quantity']
                    );
                    c.field.value = 'fld_quantity';
                    change(h.window, c.field);
                    c.operator.value = 'equals';
                    c.value.value = '25';
                    c.apply.click();
                    assert.equal(
                        h.changes[0].filtersByEndUser.conditions[0].setting
                            .idOrName.id,
                        'fld_quantity'
                    );
                }
                await h.close();
            }
        }
    );
    await check(
        'actual starter filter Apply preserves owned criteria and exact request; sort/filter share retirement both directions',
        async () => {
            for (const first of ['filter', 'sort']) {
                let reads = 0;
                const h = await mount({
                    initialCriteria: criteria(),
                    handlers: {
                        list: ({ input }) => {
                            reads++;
                            if (reads === 1)
                                return f.page(
                                    [f.record('rec_old', 'Old')],
                                    'old_cursor'
                                );
                            assert.equal(input.airtableOffset, null);
                            assert.deepEqual(input.searchParamsMap, {
                                retained: 'Exact',
                            });
                            assert.equal(input.searchTerm, 'Keep search');
                            if (first === 'filter')
                                assert.equal(
                                    input.filtersByEndUser.conditions[0].setting
                                        .value,
                                    25
                                );
                            return f.page([
                                f.record('rec_z', 'Z'),
                                f.record('rec_a', 'A'),
                            ]);
                        },
                    },
                });
                await h.click('Load records');
                const fc = controls(h.view.node),
                    sort = h.view.node.querySelector(
                        '[aria-label="Portal sorting"]'
                    ),
                    heldFilter = fc.apply,
                    heldSort = button(sort, 'Apply sort');
                fc.field.value = 'fld_quantity';
                change(h.window, fc.field);
                fc.operator.value = 'equals';
                fc.value.value = '25';
                if (first === 'filter') fc.apply.click();
                else {
                    sort.querySelectorAll('select')[0].value = 'fld_quantity';
                    sort.querySelectorAll('select')[1].value = 'desc';
                    heldSort.click();
                }
                heldFilter.click();
                heldFilter.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                heldSort.click();
                heldSort.dispatchEvent(
                    new h.window.Event('click', { bubbles: true })
                );
                assert.equal(reads, 1);
                assert(button(h.view.node, 'Create record').disabled);
                assert(button(h.view.node, 'Next page').disabled);
                assert.equal(h.view.node.querySelector('tbody'), null);
                await h.click('Load records');
                assert.deepEqual(
                    [...h.view.node.querySelectorAll('tbody tr')].map(
                        (x) => x.dataset.recordId
                    ),
                    ['rec_z', 'rec_a']
                );
                if (first === 'filter') {
                    const secondSort = h.view.node.querySelector(
                        '[aria-label="Portal sorting"]'
                    );
                    secondSort.querySelectorAll('select')[0].value =
                        'fld_quantity';
                    secondSort.querySelectorAll('select')[1].value = 'asc';
                    button(secondSort, 'Apply sort').click();
                } else {
                    const secondFilter = controls(h.view.node);
                    secondFilter.field.value = 'fld_title';
                    change(h.window, secondFilter.field);
                    secondFilter.operator.value = 'contains';
                    secondFilter.value.value = 'After sort';
                    secondFilter.apply.click();
                }
                assert.equal(reads, 2);
                await h.click('Load records');
                assert.equal(reads, 3);
                const finalInput = h.calls
                    .filter((x) => x.operation === 'list')
                    .at(-1).input;
                assert.deepEqual(finalInput.sortFieldsByEndUser, [
                    {
                        idOrName: { type: 'id', id: 'fld_quantity' },
                        type: first === 'sort' ? 'desc' : 'asc',
                    },
                ]);
                assert.deepEqual(finalInput.filtersByEndUser, {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'portal_scalar_filter',
                            type: 'singleCondition',
                            setting:
                                first === 'filter'
                                    ? {
                                          type: 'equals',
                                          idOrName: {
                                              type: 'id',
                                              id: 'fld_quantity',
                                          },
                                          fieldType: 'number',
                                          value: 25,
                                      }
                                    : {
                                          type: 'contains',
                                          idOrName: {
                                              type: 'id',
                                              id: 'fld_title',
                                          },
                                          fieldType: 'singleLineText',
                                          value: 'After sort',
                                      },
                        },
                    ],
                });
                await h.click('Create record');
                assert.equal(h.handoffs.length, 1);
                assert.equal(h.handoffs[0][2].recordId, 'rec_user');
                await h.dispose();
            }
        }
    );
    await check(
        'held filter controls retire after paging, child opening and A to B to A',
        async () => {
            for (const mode of ['page', 'child', 'aba']) {
                for (const select of [false, true]) {
                    const h = await mount({
                        handlers: {
                            list: () => {
                                const pg = f.page(
                                    [f.record('rec_one', 'One')],
                                    'cursor'
                                );
                                if (select)
                                    pg.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
                                        ...selectFields()
                                    );
                                return pg;
                            },
                        },
                    });
                    await h.click('Load records');
                    const c = controls(h.view.node);
                    c.value.value = 'Keep';
                    if (select)
                        choose(h.window, c, 'fld_choice_0', 'is', ['sel_a']);
                    const originalParent = structuredClone(
                        h.portal.payload.formRecord
                    );
                    const held = c.clear;
                    if (mode === 'page') await h.click('Next page');
                    if (mode === 'child') await h.click('Create record');
                    if (mode === 'aba') {
                        h.switchOwner('B');
                        h.switchOwner('visitor_A');
                    }
                    const count = h.calls.length;
                    held.click();
                    held.dispatchEvent(
                        new h.window.Event('click', { bubbles: true })
                    );
                    await h.settle();
                    assert.equal(h.calls.length, count);
                    if (mode === 'child') {
                        assert.equal(h.handoffs.length, 1);
                        assert.deepEqual(h.handoffs[0][1], {
                            type: 'modal',
                            prefillData: {
                                toLinkToParent: {
                                    reversedFieldIdToPrefill: 'fld_parent',
                                    parentFormRecordId: 'rec_user',
                                },
                                prefillQueryForChildExtension:
                                    'prefill_Title=Example',
                            },
                        });
                        assert.deepEqual(h.handoffs[0][2], {
                            portalId: 'portal_example',
                            recordId: 'rec_user',
                            portalFieldId: 'fld_children',
                        });
                    }
                    assert.deepEqual(
                        h.portal.payload.formRecord,
                        originalParent
                    );
                    await h.dispose();
                }
            }
        }
    );
    await check(
        'sequential server cleanup preserves filter/sort edits and flags; filtering-disabled errors never clear criteria',
        async () => {
            let reads = 0;
            const initial = criteria();
            initial.filtersByEndUser = condition(
                'fld_title',
                'singleLineText',
                'contains',
                'Keep'
            );
            const h = await mount({
                initialCriteria: initial,
                handlers: {
                    list: () => {
                        reads++;
                        if (reads === 1)
                            return {
                                ...f.page([]),
                                endUserSortCleanup: { sortFields: [] },
                            };
                        if (reads === 2)
                            return {
                                ...f.page([]),
                                endUserFilterCleanup: { filters: null },
                            };
                        if (reads === 3)
                            throw new Error(
                                'portal_records.client_filtering_disabled'
                            );
                        return f.page([]);
                    },
                },
            });
            await h.click('Load records');
            await h.click('Review criteria cleanup');
            assert.equal(reads, 1);
            await h.click('Load records');
            assert.deepEqual(
                h.calls.filter((x) => x.operation === 'list')[1].input
                    .filtersByEndUser,
                initial.filtersByEndUser
            );
            await h.click('Review criteria cleanup');
            await h.click('Load records');
            assert.equal(h.failures.length, 1);
            assert(button(h.view.node, 'Create record').disabled);
            assert.equal(reads, 3);
            await h.click('Load records');
            assert.equal(reads, 4);
            const req = h.calls
                .filter((x) => x.operation === 'list')
                .at(-1).input;
            assert.deepEqual(req.searchParamsMap, { retained: 'Exact' });
            assert.deepEqual(req.sortFieldsByEndUser, []);
            assert.equal(req.filtersByEndUser, null);
            await h.dispose();
            const rejected = await mount({
                initialCriteria: initial,
                handlers: {
                    list: () => {
                        throw new Error(
                            'portal_records.client_filtering_disabled'
                        );
                    },
                },
            });
            await rejected.click('Load records');
            assert.equal(
                rejected.calls.filter((x) => x.operation === 'list').length,
                1
            );
            await rejected.click('Load records');
            assert.deepEqual(
                rejected.calls.filter((x) => x.operation === 'list')[1].input
                    .filtersByEndUser,
                initial.filtersByEndUser
            );
            await rejected.dispose();
        }
    );
    await check(
        'recipe copies inputs/output and retires before callback/disposal reentry',
        async () => {
            const env = await environment(),
                { mountPortalScalarFilterEditor } =
                    await loadExample('portalFilter');
            const p = editablePortal(),
                s = snapshot(),
                c = criteria();
            let e,
                count = 0;
            const original = structuredClone(c);
            e = mountPortalScalarFilterEditor({
                portal: p,
                portalFieldId: 'fld_children',
                criteria: c,
                snapshot: s,
                isCurrent: () => true,
                onApply: (n) => {
                    count++;
                    controls(e.node).clear.click();
                    controls(e.node).clear.dispatchEvent(
                        new env.window.Event('click', { bubbles: true })
                    );
                    assert.deepEqual(
                        n.searchParamsMap,
                        original.searchParamsMap
                    );
                    n.searchParamsMap.retained = 'Changed';
                },
            });
            assert.equal(e.type, 'ready');
            env.window.document.getElementById('screen').append(e.node);
            const ui = controls(e.node);
            ui.operator.value = 'contains';
            ui.value.value = ' Keep ';
            ui.apply.click();
            assert.equal(count, 1);
            assert.equal(c.searchParamsMap.retained, 'Exact');
            await env.close();
        }
    );
    await check(
        'checkbox true/false, rich text exclusions and deferred physical families use compiler authority',
        async () => {
            for (const type of [
                'checkbox',
                'richText',
                'singleSelect',
                'multipleSelects',
                'multipleRecordLinks',
                'date',
                'dateTime',
                'multipleLookupValues',
            ]) {
                const p = editablePortal(),
                    s = snapshot();
                p.payload.linkedRecordFieldIdToDetailFields.fld_children = [];
                s.tableIdsToLinkedTableStates.tbl_children.airtableFields = [
                    {
                        id: 'fld_value',
                        name: 'Value',
                        isComputed: false,
                        isPrimaryField: true,
                        config: { type, options: null },
                    },
                ];
                const h = await standalone(p, s);
                assert.equal(
                    h.editor.type,
                    ['checkbox', 'richText'].includes(type)
                        ? 'ready'
                        : 'unavailable',
                    type
                );
                if (h.editor.type === 'ready') {
                    const ui = controls(h.editor.node),
                        ops = [...ui.operator.options].map((x) => x.value);
                    if (type === 'checkbox') {
                        assert.deepEqual(ops, ['is']);
                        ui.bool.value = 'true';
                        ui.apply.click();
                        assert.equal(
                            h.changes[0].filtersByEndUser.conditions[0].setting
                                .value,
                            true
                        );
                    } else {
                        assert(!ops.includes('is'));
                        assert(!ops.includes('isNot'));
                    }
                }
                await h.close();
            }
        }
    );
    await check(
        'cancelled cleanup, empty results and stale ownership/disposal leave filter criteria unchanged',
        async () => {
            const initial = criteria();
            initial.filtersByEndUser = condition(
                'fld_title',
                'singleLineText',
                'contains',
                'Keep'
            );
            const h = await mount({
                initialCriteria: initial,
                confirm: async () => false,
                handlers: {
                    list: () => ({
                        ...f.page([]),
                        endUserFilterCleanup: { filters: null },
                    }),
                },
            });
            await h.click('Load records');
            await h.click('Review criteria cleanup');
            assert.equal(
                h.calls.filter((x) => x.operation === 'list').length,
                1
            );
            assert(button(h.view.node, 'Create record').disabled);
            assert.deepEqual(
                initial.filtersByEndUser,
                condition('fld_title', 'singleLineText', 'contains', 'Keep')
            );
            await h.dispose();
            const empty = await mount({ handlers: { list: () => f.page([]) } });
            await empty.click('Load records');
            assert(controls(empty.view.node));
            assert.equal(empty.view.node.querySelector('tbody tr'), null);
            await empty.dispose();
            for (const dispose of [false, true]) {
                const env = await environment(),
                    { mountPortalScalarFilterEditor } =
                        await loadExample('portalFilter');
                let editor;
                editor = mountPortalScalarFilterEditor({
                    portal: editablePortal(),
                    portalFieldId: 'fld_children',
                    criteria: criteria(),
                    snapshot: snapshot(),
                    isCurrent: () => {
                        if (dispose) editor.destroy();
                        return dispose;
                    },
                    onApply: () => assert.fail('Stale/disposed callback'),
                });
                assert.equal(editor.type, 'ready');
                env.window.document
                    .getElementById('screen')
                    .append(editor.node);
                controls(editor.node).clear.click();
                controls(editor.node).clear.dispatchEvent(
                    new env.window.Event('click', { bubbles: true })
                );
                await env.close();
            }
        }
    );
}
