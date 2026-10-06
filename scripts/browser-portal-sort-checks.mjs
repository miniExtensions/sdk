import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { portalRecipeFixtures as f } from './portal-recipe-checks.mjs';

const button = (root, label) => {
    const b = [...root.querySelectorAll('button')].find(
        (x) => x.textContent.trim() === label
    );
    assert(b, `Missing sorting button ${label}`);
    return b;
};
const tick = () => new Promise((r) => setImmediate(r));
const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await tick();
    }
    assert.fail('Sort state did not settle');
};
const criteria = () => ({
    selectedCustomViewId: 'view_example',
    searchTerm: 'Owned search',
    searchParamsMap: {
        fld_title: 'Exact search-page value',
        preserved: 'value',
    },
    sortFieldsByEndUser: null,
    filtersByEndUser: {
        logicalOperator: 'and',
        conditions: [
            {
                id: 'condition_owned',
                type: 'singleCondition',
                setting: {
                    type: 'contains',
                    idOrName: { type: 'id', id: 'fld_title' },
                    fieldType: 'singleLineText',
                    value: 'Keep',
                },
            },
        ],
    },
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
const controls = (root) => {
    const node = root.querySelector('[aria-label="Portal sorting"]');
    assert(node);
    const [field, direction] = node.querySelectorAll('select');
    return { node, field, direction, apply: node.querySelector('button') };
};
const blocked = (h) => {
    assert.equal(button(h.view.node, 'Create record').disabled, true);
    assert.equal(button(h.view.node, 'Next page').disabled, true);
    assert.equal(h.view.node.querySelector('tbody'), null);
};
const ids = (root) =>
    [...root.querySelectorAll('tbody tr')].map((x) => x.dataset.recordId);

/** Both standalone recipe and real starter imports are compiled from the installed archive. */
export async function checkPortalSortCases({
    check,
    mount,
    environment,
    loadExample,
    editablePortal,
}) {
    await check(
        'sort applies exact descending criteria, resets offset and preserves server row order and child context',
        async () => {
            const original = criteria();
            let reads = 0;
            const h = await mount({
                initialCriteria: original,
                handlers: {
                    list: ({ input }) => {
                        reads++;
                        if (reads === 1)
                            return f.page(
                                [f.record('rec_old', 'Old')],
                                'old_cursor'
                            );
                        assert.deepEqual(input.sortFieldsByEndUser, [
                            {
                                idOrName: { type: 'id', id: 'fld_quantity' },
                                type: 'desc',
                            },
                        ]);
                        return f.page([
                            f.record('rec_z', 'Z', 9),
                            f.record('rec_a', 'A', 1),
                        ]);
                    },
                },
            });
            await h.click('Load records');
            const heldChild = button(h.view.node, 'Open Form');
            const heldPage = button(h.view.node, 'Next page');
            const c = controls(h.view.node);
            c.field.value = 'fld_quantity';
            c.direction.value = 'desc';
            c.apply.click();
            blocked(h);
            heldChild.click();
            heldPage.click();
            await h.settle();
            assert.equal(h.calls.length, 1);
            const search = [...h.view.node.querySelectorAll('input')].find(
                (n) => n.placeholder === 'Search this table'
            );
            search.value = 'Changed search';
            search.dispatchEvent(
                new h.window.Event('input', { bubbles: true })
            );
            assert.equal(
                button(h.view.node, 'Create record').disabled,
                true,
                'Search must not restore Apply-retired Create'
            );
            await h.click('Load records');
            assert.deepEqual(ids(h.view.node), ['rec_z', 'rec_a']);
            const input = h.calls[1].input;
            assert.equal(input.airtableOffset, null);
            assert.deepEqual(input.alreadyLoadedRecordIds, []);
            assert.equal(input.searchTerm, 'Changed search');
            assert.deepEqual(input.searchParamsMap, original.searchParamsMap);
            assert.deepEqual(input.filtersByEndUser, original.filtersByEndUser);
            assert.equal(input.supportsEndUserSortCleanup, true);
            assert.equal(input.supportsEndUserFilterCleanup, true);
            await h.click('Open Form');
            const child = h.calls.find((x) => x.operation === 'child');
            assert.deepEqual(child.input.childExtensionInfo.accessType, {
                type: 'edit',
                childExtensionRecordId: 'rec_z',
                childExtensionFieldId: null,
            });
            assert.deepEqual(h.handoffs[0][1], {
                type: 'modal',
                prefillData:
                    child.input.context.prefillDataForLinkedRecordsForm,
            });
            assert.equal(h.handoffs[0][2].recordId, 'rec_user');
            assert.deepEqual(h.handoffs[0][0], f.makeForm(child.input));
            assert.equal(
                h.calls.filter(
                    (x) => x.operation === 'grid' || x.operation === 'unlink'
                ).length,
                0
            );
            await h.dispose();
        }
    );
    await check(
        'sort restrictions null, empty, nonempty and all-stale retain exact configured semantics',
        async () => {
            for (const [restriction, expected] of [
                [null, ['', 'fld_title', 'fld_quantity']],
                [[], ['', 'fld_title', 'fld_quantity']],
                [['fld_quantity'], ['', 'fld_quantity']],
                [['fld_stale'], null],
            ]) {
                const p = editablePortal();
                p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.sortingOnExtensionFields =
                    restriction;
                const h = await mount({
                    portal: p,
                    handlers: { list: () => f.page([]) },
                });
                await h.click('Load records');
                if (expected)
                    assert.deepEqual(
                        [...controls(h.view.node).field.options].map(
                            (x) => x.value
                        ),
                        expected
                    );
                else
                    assert.equal(
                        h.view.node.querySelector(
                            '[aria-label="Portal sorting"]'
                        ),
                        null
                    );
                assert.equal(h.calls.length, 1);
                await h.dispose();
            }
        }
    );
    await check(
        'hidden sort-only metadata stays hidden and duplicate labels retain exact IDs',
        async () => {
            const p = editablePortal();
            p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.sortingOnExtensionFields =
                ['fld_hidden', 'fld_title', 'fld_quantity'];
            const output = f.page([]);
            output.tableIdsToLinkedTableStates.tbl_children.airtableFields[1].name =
                'Title';
            output.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
                {
                    id: 'fld_hidden',
                    name: 'Hidden sort secret',
                    config: { type: 'singleLineText' },
                }
            );
            const h = await mount({
                portal: p,
                handlers: { list: () => output },
            });
            await h.click('Load records');
            const c = controls(h.view.node);
            assert.deepEqual(
                [...c.field.options].map((x) => x.value),
                ['', 'fld_title', 'fld_quantity']
            );
            assert.match(c.field.options[1].textContent, /fld_title/);
            assert.match(c.field.options[2].textContent, /fld_quantity/);
            assert.doesNotMatch(c.node.textContent, /Hidden sort secret/);
            c.field.value = 'fld_quantity';
            c.apply.click();
            blocked(h);
            await h.dispose();
        }
    );
    await check(
        'omitted custom overrides clear root hide, restrictions and custom primary; source mutation is detached',
        async () => {
            // An absent whole config inherits root; omitted keys inside a
            // custom config below instead clear the corresponding root keys.
            for (const mode of ['omitted', 'undefined', 'null']) {
                const inherited = editablePortal();
                const root =
                    inherited.payload.fieldIdsToSchemas.fld_children
                        .miniExtConfig;
                root.hideSortButtonForPortal = false;
                root.sortingOnExtensionFields = ['fld_quantity'];
                root.customPrimaryField = 'fld_quantity';
                if (mode === 'omitted') delete root.customViews[0].config;
                else
                    root.customViews[0].config =
                        mode === 'null' ? null : undefined;
                const h = await mount({
                    portal: inherited,
                    initialCriteria: criteria(),
                    handlers: {
                        list: () => f.page([f.record('rec_one', 'Inherited')]),
                    },
                });
                await h.click('Load records');
                assert.deepEqual(
                    [...controls(h.view.node).field.options].map(
                        (x) => x.value
                    ),
                    ['', 'fld_quantity'],
                    mode
                );
                assert.deepEqual(ids(h.view.node), ['rec_one']);
                assert.equal(
                    h.calls.filter((x) => x.operation === 'list').length,
                    1
                );
                await h.dispose();
            }
            const p = editablePortal(),
                cfg = p.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
            cfg.hideSortButtonForPortal = true;
            cfg.sortingOnExtensionFields = ['fld_hidden'];
            cfg.customPrimaryField = 'fld_hidden';
            cfg.customViews[0].config = {
                name: 'Own',
                viewBehavior: 'custom',
                layout: 'grid',
            };
            const output = f.page([]);
            output.customViewDetailFields = { fld_children: [] };
            output.tableIdsToLinkedTableStates.tbl_children.airtableFields.push(
                { id: 'fld_hidden', name: 'Hidden', config: { type: 'number' } }
            );
            const h = await mount({
                portal: p,
                handlers: { list: () => output },
            });
            cfg.customViews[0].config.hideSortButtonForPortal = true;
            await h.click('Load records');
            assert.deepEqual(
                [...controls(h.view.node).field.options].map((x) => x.value),
                ['', 'fld_title']
            );
            await h.dispose();
        }
    );
    await check(
        'multiple or unresolved saved sorts require explicit replacement and clearing means configured order',
        async () => {
            for (const sorts of [
                [
                    { idOrName: { type: 'id', id: 'fld_title' }, type: 'asc' },
                    {
                        idOrName: { type: 'id', id: 'fld_quantity' },
                        type: 'desc',
                    },
                ],
                [{ idOrName: { type: 'id', id: 'fld_stale' }, type: 'asc' }],
            ]) {
                const own = criteria();
                own.sortFieldsByEndUser = sorts;
                const h = await mount({
                    initialCriteria: own,
                    handlers: { list: () => f.page([]) },
                });
                await h.click('Load records');
                assert.deepEqual(h.calls[0].input.sortFieldsByEndUser, sorts);
                assert.match(
                    controls(h.view.node).node.textContent,
                    /preserved/
                );
                button(h.view.node, 'Replace existing sorts').click();
                blocked(h);
                assert.equal(h.calls.length, 1);
                await h.click('Load records');
                assert.deepEqual(h.calls[1].input.sortFieldsByEndUser, []);
                assert.deepEqual(
                    h.calls[1].input.filtersByEndUser,
                    own.filtersByEndUser
                );
                await h.dispose();
            }
        }
    );
    await check(
        'held editor cannot apply after next-page acceptance, cleanup or child opening',
        async () => {
            for (const after of ['next', 'cleanup', 'child']) {
                let reads = 0;
                const h = await mount({
                    handlers: {
                        list: () =>
                            ++reads === 1
                                ? f.page(
                                      [f.record('rec_one', 'First')],
                                      'cursor'
                                  )
                                : after === 'cleanup'
                                  ? f.page([], null, {
                                        endUserSortCleanup: { sortFields: [] },
                                    })
                                  : f.page([f.record('rec_two', 'Second')]),
                    },
                });
                await h.click('Load records');
                const c = controls(h.view.node);
                c.field.value = 'fld_quantity';
                await h.click(after === 'child' ? 'Open Form' : 'Next page');
                const count = h.calls.length;
                c.apply.dispatchEvent(new h.window.Event('click'));
                await h.settle();
                assert.equal(h.calls.length, count);
                assert.equal(c.apply.disabled, true);
                assert.equal(c.node.inert, true);
                if (after === 'cleanup') {
                    await h.click('Review criteria cleanup');
                    await wait(() =>
                        h.statuses.some(([s]) => s.includes('Cleanup accepted'))
                    );
                }
                await h.click('Load records');
                assert.equal(
                    h.calls.at(-1).input.sortFieldsByEndUser === null ||
                        after === 'cleanup',
                    true
                );
                if (after === 'child') assert.equal(h.handoffs.length, 1);
                await h.dispose();
            }
        }
    );
    await check(
        'sequential cleanup patches only returned properties and preserves complete owned criteria',
        async () => {
            const own = criteria();
            own.sortFieldsByEndUser = [
                { idOrName: { type: 'id', id: 'fld_stale' }, type: 'desc' },
            ];
            let reads = 0,
                accept = false;
            const h = await mount({
                initialCriteria: own,
                confirm: async () => accept,
                handlers: {
                    list: () => {
                        reads++;
                        return reads === 1
                            ? f.page([], null, {
                                  endUserSortCleanup: { sortFields: [] },
                              })
                            : reads === 2
                              ? f.page([], null, {
                                    endUserFilterCleanup: { filters: null },
                                })
                              : f.page([]);
                    },
                },
            });
            own.searchParamsMap.preserved = 'External mutation';
            await h.click('Load records');
            blocked(h);
            assert.match(
                h.view.node.querySelector(
                    '[aria-label="Portal criteria cleanup"]'
                ).textContent,
                /sortFieldsByEndUser/
            );
            assert.doesNotMatch(
                h.view.node.querySelector(
                    '[aria-label="Portal criteria cleanup"]'
                ).textContent,
                /filtersByEndUser/
            );
            await h.click('Review criteria cleanup');
            await tick();
            await h.click('Load records');
            assert.equal(reads, 1, 'Cancelled cleanup cannot dispatch');
            accept = true;
            await h.click('Review criteria cleanup');
            await wait(() =>
                h.statuses.some(([s]) => s.includes('Cleanup accepted'))
            );
            blocked(h);
            assert.equal(reads, 1);
            await h.click('Load records');
            blocked(h);
            assert.deepEqual(h.calls[1].input.sortFieldsByEndUser, []);
            assert.deepEqual(
                h.calls[1].input.filtersByEndUser,
                criteria().filtersByEndUser
            );
            await h.click('Review criteria cleanup');
            await tick();
            await h.click('Load records');
            assert.equal(reads, 3);
            const input = h.calls[2].input;
            assert.deepEqual(input.sortFieldsByEndUser, []);
            assert.equal(input.filtersByEndUser, null);
            assert.equal(input.searchTerm, 'Owned search');
            assert.deepEqual(input.searchParamsMap, criteria().searchParamsMap);
            assert.equal(input.supportsEndUserSortCleanup, true);
            assert.equal(input.supportsEndUserFilterCleanup, true);
            assert.deepEqual(ids(h.view.node), []);
            await h.dispose();
        }
    );
    await check(
        'stale cleanup confirmation and detached Portal controls cannot alter child or new-owner criteria',
        async () => {
            const pending = f.deferred();
            let confirmations = 0;
            const h = await mount({
                initialCriteria: criteria(),
                confirm: () => {
                    confirmations++;
                    return pending.promise;
                },
                handlers: {
                    list: () =>
                        f.page([], null, {
                            endUserFilterCleanup: { filters: null },
                        }),
                },
            });
            await h.click('Load records');
            const review = button(h.view.node, 'Review criteria cleanup');
            review.click();
            await tick();
            h.view.node.remove();
            review.dispatchEvent(new h.window.Event('click'));
            assert.equal(confirmations, 1);
            h.retire();
            h.window.document.getElementById('screen').append(h.view.node);
            pending.resolve(true);
            await tick();
            assert.doesNotMatch(h.statuses.at(-1)[0], /Cleanup accepted/);
            await h.click('Load records');
            assert.deepEqual(
                h.calls[1].input.filtersByEndUser,
                criteria().filtersByEndUser
            );
            await h.dispose();
        }
    );
    await check(
        'A to B to A and failed/cancelled next reads retire held sorting and paging authority',
        async () => {
            for (const mode of ['aba', 'failure', 'cancel']) {
                const pending = f.deferred();
                let reads = 0;
                const h = await mount({
                    handlers: {
                        list: () =>
                            ++reads === 1
                                ? f.page(
                                      [f.record('rec_one', 'First')],
                                      'cursor'
                                  )
                                : pending.promise,
                    },
                });
                await h.click('Load records');
                const c = controls(h.view.node);
                c.field.value = 'fld_quantity';
                button(h.view.node, 'Next page').click();
                await tick();
                if (mode === 'aba') {
                    h.switchOwner('visitor_B');
                    h.switchOwner('visitor_A');
                    pending.resolve(f.page([f.record('rec_late', 'Late')]));
                } else {
                    if (mode === 'cancel') h.abort();
                    pending.reject(new Error('controlled sort read failure'));
                }
                await h.settle();
                c.apply.dispatchEvent(new h.window.Event('click'));
                assert.equal(reads, 2);
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    true
                );
                assert.equal(button(h.view.node, 'Next page').disabled, true);
                assert(!ids(h.view.node).includes('rec_late'));
                await h.dispose();
            }
        }
    );
    await check(
        'installed standalone sorting recipe rejects malformed metadata and never guesses first primary',
        async () => {
            const { window } = await environment();
            const { mountPortalSortEditor } = await loadExample('portalSort');
            for (const mode of [
                'duplicate',
                'name',
                'config',
                'order',
                'first-primary',
                'primary-type',
                'computed-type',
                'restriction',
                'view-shape',
                'view-config-array',
                'view-config-number',
                'view-config-string',
            ]) {
                const p = editablePortal();
                const snapshot = {
                    ...f.page([]),
                    detailFields: [],
                    criteriaKey: 'fixture',
                    layoutSettings: {},
                };
                const fields =
                    snapshot.tableIdsToLinkedTableStates.tbl_children
                        .airtableFields;
                if (mode === 'duplicate')
                    fields.push(structuredClone(fields[0]));
                if (mode === 'name') fields[0].name = 123;
                if (mode === 'config') fields[0].config = null;
                if (mode === 'order') fields[0].config = { type: 'notAField' };
                if (mode === 'first-primary') fields[0].isPrimaryField = false;
                if (mode === 'primary-type') fields[0].isPrimaryField = 'true';
                if (mode === 'computed-type') fields[0].isComputed = 'true';
                if (mode === 'restriction')
                    p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.sortingOnExtensionFields =
                        'fld_title';
                if (mode === 'view-shape')
                    p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.customViews =
                        [null];
                if (mode.startsWith('view-config-'))
                    p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.customViews[0].config =
                        mode === 'view-config-array'
                            ? []
                            : mode === 'view-config-number'
                              ? 123
                              : 'custom';
                const result = mountPortalSortEditor({
                    portal: p,
                    portalFieldId: 'fld_children',
                    criteria: criteria(),
                    snapshot,
                    isCurrent: () => true,
                    onApply: () => assert.fail('No malformed apply'),
                });
                assert.equal(result.type, 'unavailable', mode);
                if (mode.startsWith('view-config-')) {
                    const h = await mount({
                        portal: p,
                        initialCriteria: criteria(),
                        handlers: {
                            list: () =>
                                f.page([f.record('rec_one', 'Ordinary read')]),
                        },
                    });
                    await h.click('Load records');
                    assert.deepEqual(ids(h.view.node), ['rec_one']);
                    assert.equal(
                        h.view.node.querySelector(
                            '[aria-label="Portal sorting"]'
                        ),
                        null
                    );
                    assert.equal(
                        h.calls.filter((x) => x.operation === 'list').length,
                        1
                    );
                    await h.dispose();
                }
            }
            assert(window.document);
        }
    );
    await check(
        'installed recipe agrees with eight executed pinned canonical sort/configuration fixtures',
        async () => {
            const fixture = JSON.parse(
                readFileSync('test/fixtures/portalSort.json', 'utf8')
            );
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
            const { window } = await environment();
            const { mountPortalSortEditor } = await loadExample('portalSort');
            for (const { input, expected } of fixture.cases) {
                const p = editablePortal();
                Object.assign(
                    p.payload.fieldIdsToSchemas.fld_children.miniExtConfig,
                    input.root
                );
                if (input.view)
                    p.payload.fieldIdsToSchemas.fld_children.miniExtConfig.customViews[0].config =
                        input.view;
                const snapshot = {
                    ...f.page([]),
                    detailFields:
                        p.payload.linkedRecordFieldIdToDetailFields
                            .fld_children,
                    criteriaKey: 'fixture',
                    layoutSettings: {},
                };
                snapshot.tableIdsToLinkedTableStates.tbl_children.airtableFields =
                    input.fields;
                const result = mountPortalSortEditor({
                    portal: p,
                    portalFieldId: 'fld_children',
                    criteria: criteria(),
                    snapshot,
                    isCurrent: () => true,
                    onApply: () =>
                        assert.fail('Fixture comparison must not apply'),
                });
                if (expected.hidden || expected.fieldIds.length === 0)
                    assert.equal(result.type, 'unavailable', input.name);
                else {
                    assert.equal(result.type, 'ready', input.name);
                    window.document.body.append(result.node);
                    assert.deepEqual(
                        [...result.node.querySelector('select').options].map(
                            (x) => x.value
                        ),
                        ['', ...expected.fieldIds],
                        input.name
                    );
                    result.destroy();
                    result.node.remove();
                }
            }
            assert.equal(fixture.cases.length, 8);
        }
    );
    await check(
        'installed standalone sorting recipe copies inputs/outputs and retires before callback reentry',
        async () => {
            const { window } = await environment();
            const { mountPortalSortEditor } = await loadExample('portalSort');
            const own = criteria(),
                p = editablePortal(),
                snapshot = {
                    ...f.page([]),
                    detailFields:
                        p.payload.linkedRecordFieldIdToDetailFields
                            .fld_children,
                    criteriaKey: 'fixture',
                    layoutSettings: {},
                };
            let calls = 0;
            let applied;
            let current = true;
            const result = mountPortalSortEditor({
                portal: p,
                portalFieldId: 'fld_children',
                criteria: own,
                snapshot,
                isCurrent: () => current,
                onApply: (next) => {
                    calls++;
                    applied = next;
                    controls(result.node.parentNode).apply.dispatchEvent(
                        new window.Event('click')
                    );
                },
            });
            assert.equal(result.type, 'ready');
            window.document.body.append(result.node);
            own.searchParamsMap.preserved = 'mutated';
            snapshot.tableIdsToLinkedTableStates.tbl_children.airtableFields[0].id =
                'mutated';
            const c = controls(window.document.body);
            c.field.value = 'fld_quantity';
            c.direction.value = 'desc';
            c.apply.click();
            assert.equal(calls, 1);
            assert.deepEqual(
                applied.searchParamsMap,
                criteria().searchParamsMap
            );
            assert.deepEqual(applied.sortFieldsByEndUser, [
                { idOrName: { type: 'id', id: 'fld_quantity' }, type: 'desc' },
            ]);
            applied.filtersByEndUser.conditions[0].setting.value =
                'Output mutation';
            assert.equal(
                own.filtersByEndUser.conditions[0].setting.value,
                'Keep'
            );
            current = false;
            result.destroy();
            c.apply.dispatchEvent(new window.Event('click'));
            assert.equal(calls, 1);
        }
    );
    await check(
        'installed recipe rejects ambiguous saved names and disposal during ownership callback',
        async () => {
            const { window } = await environment();
            const { mountPortalSortEditor } = await loadExample('portalSort');
            const p = editablePortal();
            const own = criteria();
            own.sortFieldsByEndUser = [
                { idOrName: { type: 'name', name: 'Duplicate' }, type: 'asc' },
            ];
            const snapshot = {
                ...f.page([]),
                detailFields:
                    p.payload.linkedRecordFieldIdToDetailFields.fld_children,
                criteriaKey: 'fixture',
                layoutSettings: {},
            };
            for (const field of snapshot.tableIdsToLinkedTableStates
                .tbl_children.airtableFields)
                field.name = 'Duplicate';
            let result;
            let disposeInside = false;
            result = mountPortalSortEditor({
                portal: p,
                portalFieldId: 'fld_children',
                criteria: own,
                snapshot,
                isCurrent: () => {
                    if (disposeInside) result.destroy();
                    return true;
                },
                onApply: () => assert.fail('Disposed editor cannot apply'),
            });
            assert.equal(result.type, 'ready');
            window.document.body.append(result.node);
            const c = controls(window.document.body);
            assert.equal(c.apply.textContent, 'Replace existing sorts');
            c.field.value = 'fld_quantity';
            disposeInside = true;
            c.apply.click();
            assert.equal(c.apply.disabled, true);
            assert.equal(c.node.inert, true);
        }
    );
}
