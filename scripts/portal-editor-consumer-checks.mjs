import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as f } from './portal-recipe-checks.mjs';
/** Original installed archive. Local synthetic metadata; no transport or live credentials. */
export async function checkPortalEditorConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const root = join(consumerDirectory, 'node_modules/@miniextensions/sdk');
    const api = await import(
        pathToFileURL(join(root, 'dist/esm/portals/index.js'))
    );
    const cjs = consumer('@miniextensions/sdk/portals');
    assert.equal(typeof cjs.createPortalSortEditor, 'function');
    assert.equal(typeof cjs.createPortalFilterEditor, 'function');
    let checks = 0;
    const fixture = () => {
        const portal = f.makePortal();
        portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig.customViews =
            [{ id: 'view_example' }];
        const snapshot = {
            ...f.page([f.record('rec_native', 'Native', 4)]),
            criteriaKey: 'fixture',
            layoutSettings: {},
            detailFields: structuredClone(
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children
            ),
        };
        const fields =
            snapshot.tableIdsToLinkedTableStates.tbl_children.airtableFields;
        fields.push({
            id: 'fld_choice',
            name: 'Choice',
            isComputed: false,
            config: {
                type: 'multipleSelects',
                options: {
                    choices: [
                        { id: 'a', name: 'Alpha' },
                        { id: 'b', name: 'Beta' },
                    ],
                },
            },
        });
        const criteria = {
            selectedCustomViewId: 'view_example',
            searchTerm: 'Keep search',
            searchParamsMap: { native: 'Exact' },
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        };
        let epoch = 0,
            live = true;
        const applied = [];
        return {
            options: {
                portal,
                snapshot,
                portalFieldId: 'fld_children',
                criteria,
                isCurrent: () => live,
                configurationRevision: () => epoch,
                onApply: (n) => applied.push(n),
            },
            applied,
            retire() {
                live = false;
            },
            change() {
                epoch++;
            },
        };
    };
    for (const entry of [api, cjs]) {
        const x = fixture(),
            r = entry.createPortalSortEditor(x.options);
        assert.equal(r.type, 'ready');
        r.model.setField('fld_quantity');
        r.model.setDirection('desc');
        assert.equal(x.applied.length, 0);
        assert.equal(r.model.apply(), true);
        assert.deepEqual(x.applied[0], {
            ...x.options.criteria,
            sortFieldsByEndUser: [
                { idOrName: { type: 'id', id: 'fld_quantity' }, type: 'desc' },
            ],
        });
        assert.equal(r.model.clear(), false);
        checks++;
        const y = fixture(),
            v = entry.createPortalFilterEditor(y.options);
        assert.equal(v.type, 'ready');
        v.model.setField('fld_choice');
        v.model.setOperator('hasAllOf');
        v.model.setOperand(['b', 'a']);
        assert.equal(y.applied.length, 0);
        assert.equal(v.model.apply(), true);
        assert.deepEqual(
            y.applied[0].filtersByEndUser.conditions[0].setting.value,
            ['b', 'a']
        );
        assert.equal(y.applied[0].searchTerm, 'Keep search');
        checks++;
        const z = fixture();
        z.options.criteria.filtersByEndUser = {
            logicalOperator: 'and',
            conditions: [
                {
                    type: 'singleCondition',
                    id: 'saved',
                    setting: {
                        type: 'hasAnyOf',
                        idOrName: { type: 'id', id: 'fld_choice' },
                        fieldType: 'multipleSelects',
                        value: ['a', 'deleted'],
                    },
                },
            ],
        };
        const q = entry.createPortalFilterEditor(z.options);
        assert.equal(q.type, 'ready');
        assert.equal(q.model.getSnapshot().unresolved, true);
        assert.equal(q.model.clear(), false);
        assert.deepEqual(
            q.model.getSnapshot().originalCriteria,
            z.options.criteria
        );
        q.model.prepareReplacement();
        assert.equal(q.model.clear(), true);
        checks++;
        const old = fixture(),
            m = entry.createPortalFilterEditor(old.options);
        assert.equal(m.type, 'ready');
        old.change();
        assert.equal(m.model.apply(), false);
        assert.equal(old.applied.length, 0);
        checks++;
    }
    for (const kind of ['sort', 'filter']) {
        for (const outcome of ['withdraw', 'self-reentry']) {
            const x = fixture(),
                result =
                    kind === 'sort'
                        ? api.createPortalSortEditor(x.options)
                        : api.createPortalFilterEditor(x.options);
            assert.equal(result.type, 'ready');
            const model = result.model;
            if (kind === 'filter') model.setOperand('Exact');
            const repeats = [];
            model.subscribe((state) => {
                if (!state.retired) return;
                if (outcome === 'withdraw') x.retire();
                else repeats.push(model.apply(), model.clear());
            });
            assert.equal(model.apply(), outcome !== 'withdraw');
            assert.equal(x.applied.length, outcome === 'withdraw' ? 0 : 1);
            if (outcome === 'self-reentry')
                assert.deepEqual(repeats, [false, false]);
            checks++;
        }
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath),
        window = new Window();
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
    const React = consumer('react'),
        { createRoot } = consumer('react-dom/client'),
        reactApi = await import(
            pathToFileURL(join(root, 'dist/esm/react/index.js'))
        );
    try {
        for (const which of ['sort', 'filter']) {
            const x = fixture(),
                r =
                    which === 'sort'
                        ? api.createPortalSortEditor(x.options)
                        : api.createPortalFilterEditor(x.options);
            assert.equal(r.type, 'ready');
            const model = r.model;
            const host = window.document.createElement('div');
            window.document.body.append(host);
            let reactRoot = createRoot(host);
            const component =
                which === 'sort'
                    ? reactApi.PortalSortEditor
                    : reactApi.PortalFilterEditor;
            const render = ({ snapshot, model }) =>
                React.createElement(
                    'button',
                    {
                        onClick: () =>
                            model.setField(
                                which === 'sort' ? 'fld_quantity' : 'fld_choice'
                            ),
                    },
                    snapshot.fieldId
                );
            await React.act(async () =>
                reactRoot.render(
                    React.createElement(
                        React.StrictMode,
                        null,
                        React.createElement(component, { model, render })
                    )
                )
            );
            await React.act(async () => host.querySelector('button').click());
            assert.equal(
                model.getSnapshot().fieldId,
                which === 'sort' ? 'fld_quantity' : 'fld_choice'
            );
            await React.act(async () => reactRoot.unmount());
            assert.equal(model.getSnapshot().retired, false);
            reactRoot = createRoot(host);
            await React.act(async () =>
                reactRoot.render(
                    React.createElement(
                        React.StrictMode,
                        null,
                        React.createElement(component, { model, render })
                    )
                )
            );
            assert.equal(host.textContent, model.getSnapshot().fieldId);
            assert.equal(x.applied.length, 0);
            await React.act(async () => {
                x.retire();
                model.getSnapshot();
            });
            assert.equal(model.apply(), false);
            assert.equal(x.applied.length, 0);
            await React.act(async () => reactRoot.unmount());
            host.remove();
            checks++;
            // Child layout effects precede the external-store subscription.
            const late = fixture();
            const pending =
                which === 'sort'
                    ? api.createPortalSortEditor(late.options)
                    : api.createPortalFilterEditor(late.options);
            assert.equal(pending.type, 'ready');
            const delayedModel = pending.model;
            const delayedHost = window.document.createElement('div');
            window.document.body.append(delayedHost);
            const delayedRoot = createRoot(delayedHost);
            const RetireBeforeSubscribe = () => {
                React.useLayoutEffect(() => {
                    delayedModel.destroy();
                }, []);
                return null;
            };
            const delayedRender = ({ snapshot }) =>
                React.createElement(
                    'section',
                    null,
                    React.createElement(
                        'output',
                        { 'data-retired': String(snapshot.retired) },
                        snapshot.fieldId
                    ),
                    React.createElement(RetireBeforeSubscribe)
                );
            await React.act(async () =>
                delayedRoot.render(
                    React.createElement(
                        React.StrictMode,
                        null,
                        React.createElement(component, {
                            model: delayedModel,
                            render: delayedRender,
                        })
                    )
                )
            );
            assert.equal(delayedModel.getSnapshot().retired, true);
            assert.equal(
                delayedHost
                    .querySelector('output')
                    .getAttribute('data-retired'),
                'true'
            );
            assert.equal(delayedHost.querySelector('output').textContent, '');
            assert.equal(delayedModel.apply(), false);
            assert.equal(late.applied.length, 0);
            await React.act(async () => delayedRoot.unmount());
            delayedHost.remove();
            checks++;
        }
    } finally {
        keys.forEach((k, i) => {
            if (previous[i]) Object.defineProperty(globalThis, k, previous[i]);
            else delete globalThis[k];
        });
        await window.happyDOM.close();
    }
    assert.equal(checks, 16);
    console.log(
        `Installed Portal editors: ${checks} checkpoints; renderer/criteria preparation only, no network.`
    );
    return checks;
}
