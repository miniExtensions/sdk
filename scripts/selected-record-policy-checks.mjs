import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const saveOptions = {
    captchaVal: null,
    isComputeMode: false,
    context: { type: 'direct-url' },
    searchQuery: {},
    conditionalLinkedRecordFieldIdsToFilteringValues: {},
};
const table = (input) => ({
    airtableFields: structuredClone(input.fields),
    recordIdsToAirtableRecords: Object.fromEntries(
        input.records.map((record) => [record.id, structuredClone(record)])
    ),
});
function loadedForm(input) {
    const loaded = fixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.fieldIdsInForm.push('fld_parent');
    const schema = loaded.payload.fieldIdsToSchemas.fld_parent;
    Object.assign(schema.airtableField, {
        description: null,
        isComputed: false,
        isPrimaryField: false,
    });
    Object.assign(schema.airtableField.config.options, {
        linkedTableId: 'tbl_children',
        prefersSingleRecordLink: false,
    });
    // Canonical helper null means no policy; the loaded SDK schema expresses
    // the same absence as optional undefined, not a malformed null config.
    schema.miniExtConfig =
        input.config === null ? undefined : structuredClone(input.config);
    loaded.payload.formRecord.data.fld_parent = [...input.recordIds];
    return loaded;
}
const ids = (snapshot) => snapshot.selectedRecords.map((record) => record.id);

/** Exercise only installed public entrypoints and synthetic local transports. */
export async function checkSelectedRecordPolicyConsumer({ consumerDirectory }) {
    const canonical = JSON.parse(
        readFileSync(
            new URL(
                '../test/fixtures/selected-record-policy.json',
                import.meta.url
            ),
            'utf8'
        )
    );
    assert.equal(
        canonical.provenance.revision,
        '58f73d575ab10baa0a10693660d8002f204368e1'
    );
    assert.equal(
        canonical.provenance.tree,
        'b39e58ead46a311c497def57474cf5ca720542ae'
    );
    assert.equal(
        canonical.provenance.generatorSha256,
        createHash('sha256')
            .update(
                readFileSync(
                    new URL(
                        './generate-selected-record-policy-fixtures.mjs',
                        import.meta.url
                    )
                )
            )
            .digest('hex')
    );
    assert.equal(canonical.cases.length, 34);
    assert.equal(new Set(canonical.cases.map((c) => c.name)).size, 34);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const base = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const esm = Object.fromEntries(
        await Promise.all(
            ['forms', 'ui'].map(async (entry) => [
                entry,
                await import(pathToFileURL(join(base, entry, 'index.js'))),
            ])
        )
    );
    const cjs = Object.fromEntries(
        ['forms', 'ui'].map((entry) => [
            entry,
            require(`@miniextensions/sdk/${entry}`),
        ])
    );
    let checks = 0;
    for (const api of [esm, cjs]) {
        for (const test of canonical.cases) {
            const { input, expected } = test;
            const active =
                Boolean(
                    expected.activeFilter &&
                        expected.filterAppliedToSelectedRecords
                ) || (input.config?.sortFields?.length ?? 0) > 0;
            let calls = 0;
            const loaded = loadedForm(input);
            const client = {
                getSession: () => ({ visitor: 'policy-fixture' }),
                linkedRecords: {
                    loadSelectedRecords: async (request) => {
                        calls++;
                        assert.equal(
                            request.extensionAccessToken,
                            'child_access_example',
                            test.name
                        );
                        return { tbl_children: table(input) };
                    },
                },
            };
            const owner = api.forms.createFormFieldBindings({
                loaded,
                client,
                getScope: () => ({ ownerId: 'policy-fixture', revision: 0 }),
                isCurrent: () => true,
                configurationRevision: () => 0,
                saveOptions,
            });
            try {
                const facet = owner.linkedRecords('fld_parent');
                const originalDraft = structuredClone(
                    owner.controller.getState().draft
                );
                const originalSave = api.forms.createFormSaveInput({
                    loaded,
                    draft: originalDraft,
                    options: saveOptions,
                });
                facet.subscribe(() => {})();
                assert.equal(calls, 0, `${test.name}: no automatic hydration`);
                assert.equal(
                    facet.getSnapshot().selectedPolicy.state,
                    active ? 'waiting-data' : 'not-configured',
                    test.name
                );
                assert.equal(await facet.readSelected(), true, test.name);
                const snapshot = facet.getSnapshot();
                assert.deepEqual(ids(snapshot), expected.recordIds, test.name);
                assert.equal(
                    snapshot.selectedPolicy.supported,
                    true,
                    test.name
                );
                assert.equal(
                    snapshot.selectedPolicy.state,
                    active ? 'applied' : 'not-configured',
                    test.name
                );
                assert.deepEqual(
                    snapshot.selectedPolicy.diagnostics,
                    [],
                    test.name
                );
                assert.deepEqual(
                    owner.field('fld_parent').getSnapshot().value,
                    input.recordIds,
                    `${test.name}: native order and duplicates`
                );
                assert.equal(
                    owner.field('fld_parent').getSnapshot().dirty,
                    originalDraft.dirtyFieldIds.includes('fld_parent'),
                    `${test.name}: initial prefill dirty IDs stay intact`
                );
                assert.deepEqual(
                    owner.controller.getState().draft,
                    originalDraft,
                    `${test.name}: full draft unchanged`
                );
                assert.deepEqual(
                    api.forms.createFormSaveInput({
                        loaded,
                        draft: owner.controller.getState().draft,
                        options: saveOptions,
                    }),
                    originalSave,
                    `${test.name}: full save unchanged`
                );
                checks++;
            } finally {
                owner.destroy();
            }
        }
        const sourceCase = canonical.cases.find(
            (test) => test.input.config?.sortFields?.length > 0
        );
        const source = sourceCase.input;
        const input = {
            ...structuredClone(source),
            recordIds: source.records.map((record) => record.id),
            config: source.config,
        };
        let session = { visitor: 'policy-ui' },
            configuration = 0,
            calls = 0;
        let selectedResult = async () => ({ tbl_children: table(input) });
        let pageResult = async () => ({
            records: input.records,
            offset: 'next',
            linkedRecordFieldIdToDetailFields: null,
            tableIdsToLinkedTableStates: { tbl_children: table(input) },
        });
        const client = {
            getSession: () => ({ ...session }),
            linkedRecords: {
                loadSelectedRecords: async () => {
                    calls++;
                    return selectedResult();
                },
                listFormOptions: async (request) => {
                    assert.equal(
                        request.extensionAccessToken,
                        'child_access_example'
                    );
                    return pageResult();
                },
            },
        };
        const loaded = loadedForm(input);
        const other = structuredClone(
            loaded.payload.fieldIdsToSchemas.fld_parent
        );
        other.airtableField.id = 'fld_other';
        other.airtableField.name = 'Other';
        other.miniExtConfig = {};
        loaded.payload.fieldIdsToSchemas.fld_other = other;
        loaded.payload.fieldIdsInForm.push('fld_other');
        loaded.payload.formRecord.data.fld_other = [
            ...input.recordIds,
        ].reverse();
        const owner = api.forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => ({ ownerId: 'policy-ui', revision: 0 }),
            isCurrent: () => true,
            configurationRevision: () => configuration,
            saveOptions,
        });
        try {
            const facet = owner.linkedRecords('fld_parent');
            assert.equal(calls, 0);
            await facet.readSelected();
            assert.deepEqual(
                ids(owner.linkedRecords('fld_other').getSnapshot()),
                [...input.recordIds].reverse(),
                'shared table policies are field-specific'
            );
            checks++;
            owner.setLinkedLoader(
                'fld_parent',
                api.ui.createFormLinkedRecordLoader({
                    client,
                    input: {
                        extensionAccessToken: 'child_access_example',
                        linkedRecordFieldId: 'fld_parent',
                    },
                    linkedTableId: 'tbl_children',
                })
            );
            const currentFacet = owner.linkedRecords('fld_parent');
            const selection = owner.field('fld_parent').selection;
            await selection.reload();
            selection.choose(input.recordIds);
            const projected = [...new Set(sourceCase.expected.recordIds)];
            assert.ok(
                projected.length > 0,
                'the retention proof must have selected rows'
            );
            selection.setSearchInput('next');
            assert.deepEqual(
                ids(currentFacet.getSnapshot()),
                projected,
                'selected rich rows survive search without listeners'
            );
            await selection.setSearchTerm('next');
            pageResult = async () => ({
                records: [],
                offset: null,
                linkedRecordFieldIdToDetailFields: null,
                tableIdsToLinkedTableStates: { tbl_children: table(input) },
            });
            await selection.loadMore();
            assert.deepEqual(
                ids(currentFacet.getSnapshot()),
                projected,
                'selected rich rows survive pagination'
            );
            checks++;
            configuration++;
            assert.equal(currentFacet.getSnapshot().phase, 'retired');
            assert.deepEqual(ids(currentFacet.getSnapshot()), []);
            checks++;
        } finally {
            owner.destroy();
        }
        session = { visitor: 'policy-ui' };
        configuration = 0;
        selectedResult = async () => ({
            tbl_children: {
                airtableFields: [],
                recordIdsToAirtableRecords:
                    table(input).recordIdsToAirtableRecords,
            },
        });
        const missingOwner = api.forms.createFormFieldBindings({
            loaded: loadedForm(input),
            client,
            getScope: () => ({ ownerId: 'missing-policy', revision: 0 }),
            isCurrent: () => true,
            configurationRevision: () => configuration,
            saveOptions,
        });
        try {
            const facet = missingOwner.linkedRecords('fld_parent');
            await facet.readSelected();
            const snapshot = facet.getSnapshot();
            assert.equal(snapshot.selectedPolicy.state, 'unsupported');
            assert.equal(snapshot.selectedPolicy.supported, false);
            assert.ok(
                snapshot.selectedPolicy.diagnostics.some(
                    (diagnostic) => diagnostic.code === 'missing-dependency'
                )
            );
            assert.deepEqual(ids(snapshot), []);
            assert.deepEqual(
                missingOwner.field('fld_parent').getSnapshot().value,
                input.recordIds
            );
            checks++;
        } finally {
            missingOwner.destroy();
        }
        for (const retirement of ['session', 'configuration']) {
            session = { visitor: 'policy-ui' };
            configuration = 0;
            const pending = fixtures.deferred();
            selectedResult = () => pending.promise;
            const staleOwner = api.forms.createFormFieldBindings({
                loaded: loadedForm(input),
                client,
                getScope: () => ({ ownerId: 'stale-policy', revision: 0 }),
                isCurrent: () => true,
                configurationRevision: () => configuration,
                saveOptions,
            });
            try {
                const facet = staleOwner.linkedRecords('fld_parent');
                const read = facet.readSelected();
                await Promise.resolve();
                if (retirement === 'session')
                    session = { visitor: 'replacement' };
                else configuration++;
                pending.resolve({ tbl_children: table(input) });
                assert.equal(await read, false);
                assert.deepEqual(
                    ids(facet.getSnapshot()),
                    [],
                    `stale ${retirement} hydration`
                );
                checks++;
            } finally {
                staleOwner.destroy();
            }
        }
    }
    return {
        checks,
        fixtureCases: canonical.cases.length,
        lifecycleGroups: 12,
    };
}
