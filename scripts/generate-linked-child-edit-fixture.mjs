import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// This executes finite pinned expressions, not a backend route or SDK EDIT owner.
const revision = '4bf957c4830e6863972e45e52f2c371dc8ea9c77';
const checkout = process.argv[2];
assert(checkout, 'Supply the authorized canonical checkout explicitly.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
    config: 'utils/linked-records-field-config-helpers.ts',
    field: 'components/Fields/FieldRenderer/LinkedRecordsField/LinkedRecordsField.tsx',
    modal: 'components/Fields/FieldRenderer/LinkedRecordsField/LineItemModalTrigger.tsx',
    reducer: 'components/PublicExtension/redux/publicExtensionReducer.ts',
    save: 'components/PublicExtension/redux/saveOrComputeForm.ts',
    merge: 'types/helpers/mergeLinkedTableState.ts',
    ids: 'types/airtable/helpers.ts',
    load: 'backend-src/v1/handlers/fetchExtensionForEndUser/index.ts',
    fallback: 'backend-src/utils/reconcileAllowedRecordIdsForChildExtension.ts',
    prefill: 'backend-src/public-extensions/prefillState.ts',
    guards: 'types/utils/type-guards/index.ts',
    skip: 'utils/skipLoginRecordId.ts',
};
const sourceHashes = {};
const sources = Object.fromEntries(
    Object.entries(paths).map(([key, path]) => {
        const source = execFileSync('git', ['show', `${revision}:${path}`], {
            cwd: checkout,
            encoding: 'utf8',
        });
        sourceHashes[path] = createHash('sha256').update(source).digest('hex');
        return [
            key,
            {
                source,
                ast: ts.createSourceFile(
                    path,
                    source,
                    ts.ScriptTarget.Latest,
                    true
                ),
            },
        ];
    })
);
const nodes = (key, predicate) => {
    const result = [];
    const walk = (node) => {
        if (predicate(node)) result.push(node);
        ts.forEachChild(node, walk);
    };
    walk(sources[key].ast);
    return result;
};
const unique = (values, label) => {
    assert.equal(values.length, 1, `Expected exactly one ${label}.`);
    return values[0];
};
const variable = (key, name) =>
    unique(
        nodes(
            key,
            (node) =>
                ts.isVariableDeclaration(node) && node.name.getText() === name
        ),
        name
    );
const declaration = (key, name) => `const ${variable(key, name).getText()};`;
const expression = (key, name) => variable(key, name).initializer.getText();
const condition = (key, prefix) =>
    unique(
        nodes(
            key,
            (node) =>
                ts.isIfStatement(node) &&
                node.expression.getText().startsWith(prefix)
        ),
        prefix
    ).expression.getText();
const execute = (source, globals = {}) =>
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.None,
            },
        }).outputText,
        globals,
        { timeout: 1000 }
    );
const detached = (value) => JSON.parse(JSON.stringify(value));
const editExtension = (config) =>
    execute(
        `${declaration('config', 'getExtensionIdForEditingLinkedRecords')}
getExtensionIdForEditingLinkedRecords(config);`,
        { config, FormForEditingAndCreating: { sameForm: 'same-form' } }
    );
const editBase = {
    allowEditingRecords: true,
    allowCreatingRecords: true,
    extensionIdForCreatingAndEditing: 'form_shared',
    extensionIdForEditing: 'form_edit',
};
const editExtensionCases = [
    ['shared-default', editBase, 'form_shared'],
    [
        'shared-explicit',
        { ...editBase, formsForEditingAndCreating: 'same-form' },
        'form_shared',
    ],
    [
        'shared-null',
        { ...editBase, formsForEditingAndCreating: null },
        'form_shared',
    ],
    [
        'separate',
        { ...editBase, formsForEditingAndCreating: 'different-forms' },
        'form_edit',
    ],
    [
        'edit-only-false',
        { ...editBase, allowCreatingRecords: false },
        'form_edit',
    ],
    [
        'edit-only-omitted',
        { allowEditingRecords: true, extensionIdForEditing: 'form_edit' },
        'form_edit',
    ],
    ['edit-disabled', { ...editBase, allowEditingRecords: false }, null],
    ['edit-toggle-omitted', { extensionIdForEditing: 'form_edit' }, null],
    [
        'shared-id-missing',
        {
            allowCreatingRecords: true,
            allowEditingRecords: true,
            extensionIdForEditing: 'form_edit',
        },
        null,
    ],
    [
        'separate-id-missing',
        {
            allowCreatingRecords: false,
            allowEditingRecords: true,
            extensionIdForCreatingAndEditing: 'form_shared',
        },
        null,
    ],
].map(([name, config, expected]) => {
    assert.equal(editExtension(config), expected, name);
    return { name, config, expected };
});
const wrapperCondition = condition(
    'field',
    "formSurface.kind === 'config-preview'"
);
const displayedRows = variable(
    'field',
    'recordIdsWithLinkedRecordDisplayData'
).initializer.arguments[0].getText();
const capacityExpression = expression('field', 'canAddMoreRecordsToCell');
const openCases = [
    [
        'readonly-full-capacity',
        true,
        true,
        true,
        true,
        false,
        'form_edit',
        true,
    ],
    [
        'editable-full-capacity',
        false,
        true,
        true,
        true,
        false,
        'form_edit',
        true,
    ],
    ['displayed-selected', false, false, true, true, false, 'form_edit', true],
    [
        'filtered-out-selected',
        false,
        false,
        true,
        false,
        false,
        'form_edit',
        false,
    ],
    ['finder-only', false, false, false, false, false, 'form_edit', false],
    ['config-preview', false, false, true, true, true, 'form_edit', false],
    ['no-edit-form', false, false, true, true, false, null, false],
].map(
    ([
        name,
        parentReadOnly,
        capacityFull,
        targetInNative,
        targetDisplayed,
        preview,
        childId,
        proposedScopeEligible,
    ]) => {
        const nativeIds = targetInNative ? ['rec_child', 'rec_child'] : [];
        const effectiveIds = targetDisplayed ? ['rec_child', 'rec_child'] : [];
        const props = {
            extensionIdForEditing: childId,
            disableEditingForCustomViewOnPortal: false,
        };
        const canonicalCanAdd = execute(`(${capacityExpression});`, {
            prefersSingleRecordLink: false,
            selectedRecordsIds: capacityFull ? ['rec_child'] : [],
            customMaxRecordsToSelectFieldId: 'customMaxRecordsToSelect',
            props: { miniExtFieldConfig: { customMaxRecordsToSelect: 1 } },
        });
        assert.equal(canonicalCanAdd, !capacityFull, name);
        const canonicalWrapperAllows = !execute(`(${wrapperCondition});`, {
            formSurface: { kind: preview ? 'config-preview' : 'published' },
            props,
            readOnly: parentReadOnly,
            canAddMoreRecordsToCell: !capacityFull,
        });
        const displayedRecordIds = detached(
            execute(`(${displayedRows})().map(item => item.recordId);`, {
                clientFilteredAndSortedRecordsIds: effectiveIds,
                getRecordDisplayData: () => ({ type: 'synthetic' }),
            })
        );
        assert.deepEqual(
            displayedRecordIds,
            targetDisplayed ? ['rec_child'] : [],
            name
        );
        assert.equal(
            canonicalWrapperAllows &&
                nativeIds.includes('rec_child') &&
                displayedRecordIds.includes('rec_child'),
            proposedScopeEligible,
            name
        );
        return {
            name,
            parentReadOnly,
            capacityFull,
            targetInNative,
            targetDisplayed,
            expected: {
                canonicalWrapperAllows,
                canonicalCanAdd,
                proposedScopeEligible,
                displayedRecordIds,
            },
        };
    }
);
const inverseCondition = condition('reducer', 'shouldReloadNoLoginPortal ||');
const createdCondition = condition(
    'reducer',
    'action.payload.isNewlyCreatedRecord === true'
);
const createProvenance = unique(
    nodes(
        'save',
        (node) =>
            ts.isPropertyAssignment(node) &&
            node.name.getText() === 'isNewlyCreatedRecord' &&
            node.initializer.getText().includes('childExtensionAccessInfo') &&
            ts.isObjectLiteralExpression(node.parent) &&
            !node.parent.properties.some(
                (property) =>
                    property.name?.getText() === 'skipPortalRecordsReload'
            )
    ),
    'child access provenance'
).initializer.getText();
const reconcile = (row) => {
    const action = {
        payload: {
            newRecordIdToAdd: row.savedId,
            recordIdToRemove: row.savedId,
            isNewlyCreatedRecord: false,
        },
    };
    const inverseData = row.inversePresent
        ? { fld_parent: row.inverseIds }
        : {};
    const add = execute(`(${inverseCondition});`, {
        shouldReloadNoLoginPortal: false,
        inverseLinkFieldInModal: row.inversePresent
            ? { id: 'fld_parent' }
            : null,
        parentScreenState: {
            result: {
                data: {
                    formRecord: {
                        type: row.parentMode,
                        recordId: 'rec_parent',
                    },
                },
            },
        },
        modalFormRecord: { data: inverseData },
    });
    const isNewlyCreatedRecord = execute(`(${createProvenance});`, {
        context: { childExtensionAccessInfo: { accessType: { type: 'edit' } } },
    });
    assert.equal(isNewlyCreatedRecord, false);
    action.payload.isNewlyCreatedRecord = isNewlyCreatedRecord;
    const createdExemption = execute(`(${createdCondition});`, { action });
    const nativeIds = add
        ? row.nativeIds.includes(row.savedId)
            ? [...row.nativeIds]
            : execute(`(${expression('reducer', 'valueWithNewRecordId')});`, {
                  existingValue: row.nativeIds,
                  action,
              })
        : execute(
              `(${expression('reducer', 'valueWithoutRemovedRecordId')});`,
              { existingValue: row.nativeIds, action }
          );
    return detached({
        nativeIds,
        changed: nativeIds.length !== row.nativeIds.length,
        createdExemption,
    });
};
const reconciliationCases = [
    [
        'retain-duplicates',
        'edit',
        ['rec_child', 'rec_other', 'rec_child'],
        true,
        ['rec_parent'],
        ['rec_child', 'rec_other', 'rec_child'],
    ],
    [
        'readd-after-local-removal',
        'edit',
        ['rec_other', 'rec_other'],
        true,
        ['rec_parent'],
        ['rec_other', 'rec_other', 'rec_child'],
    ],
    [
        'unlink-all-duplicates',
        'edit',
        ['rec_child', 'rec_other', 'rec_child', 'rec_last'],
        true,
        [],
        ['rec_other', 'rec_last'],
    ],
    [
        'unlink-absent-noop',
        'edit',
        ['rec_other', 'rec_other'],
        true,
        [],
        ['rec_other', 'rec_other'],
    ],
    [
        'parent-create-keeps-selection',
        'create',
        ['rec_child', 'rec_child'],
        true,
        [],
        ['rec_child', 'rec_child'],
    ],
    [
        'missing-inverse-canonical-add',
        'edit',
        ['rec_other'],
        false,
        null,
        ['rec_other', 'rec_child'],
    ],
    [
        'null-inverse-canonical-remove',
        'edit',
        ['rec_child', 'rec_other', 'rec_child'],
        true,
        null,
        ['rec_other'],
    ],
].map(([name, parentMode, nativeIds, inversePresent, inverseIds, next]) => {
    const row = {
        name,
        parentMode,
        nativeIds,
        savedId: 'rec_child',
        inversePresent,
        inverseIds,
    };
    const expected = {
        nativeIds: next,
        changed: next.length !== nativeIds.length,
        createdExemption: false,
    };
    assert.deepEqual(reconcile(row), expected, name);
    return { ...row, expected };
});
const membershipCondition = condition(
    'load',
    '!childAccessState.allowedRecordIdsToEdit.includes(recordId)'
);
const fallbackCondition = condition(
    'fallback',
    "args.parentTokenState.accessType.type !== 'portal'"
);
const membershipCases = [
    ['cached-edit-local-removal', true, 'edit', false, false, false, true],
    ['cached-create-local-removal', true, 'create', false, false, false, true],
    ['cached-remote-unlink', true, 'edit', false, false, false, true],
    ['miss-edit-live-linked', false, 'edit', true, true, true, true],
    ['miss-edit-live-unlinked', false, 'edit', false, true, true, false],
    ['miss-create-local-selected', false, 'create', true, true, false, false],
].map(
    ([
        name,
        cachedAllowed,
        parentContext,
        fallbackAllowed,
        fallbackRequired,
        fallbackPermitted,
        passedRecordAllowlistGate,
    ]) => {
        const needsFallback = execute(`(${membershipCondition});`, {
            childAccessState: {
                allowedRecordIdsToEdit: cachedAllowed ? ['rec_child'] : [],
            },
            recordId: 'rec_child',
        });
        const permitsFallback = !execute(`(${fallbackCondition});`, {
            args: {
                parentTokenState: {
                    accessType: {
                        type:
                            parentContext === 'edit'
                                ? 'edit-record-on-form'
                                : 'create',
                    },
                },
            },
        });
        const expected = {
            fallbackRequired,
            fallbackPermitted,
            passedRecordAllowlistGate,
        };
        // Cached hits do not execute the fallback at all. These are fragments after
        // token/capability verification, not evidence of full route authorization.
        assert.deepEqual(
            {
                fallbackRequired: needsFallback,
                fallbackPermitted: needsFallback && permitsFallback,
                passedRecordAllowlistGate:
                    !needsFallback || (permitsFallback && fallbackAllowed),
            },
            expected,
            name
        );
        return {
            name,
            cachedAllowed,
            parentContext,
            fallbackAllowed,
            expected,
        };
    }
);
const relationshipPrefillSource = `
${declaration('guards', 'isArrayOfStrings')}
${declaration('guards', 'assertIsArrayOfStrings')}
${declaration('skip', 'recordIdForSkippingLogin')}
${declaration('prefill', 'getPrefillFieldNameAndValueForLinkedRecordsForm')}
getPrefillFieldNameAndValueForLinkedRecordsForm(args);`;
const relationshipCases = [];
const relationshipProducer = unique(
    nodes(
        'field',
        (node) =>
            ts.isJsxAttribute(node) &&
            node.name.getText() === 'toLinkToParent' &&
            node.initializer?.getText().includes('showLoggedInRecordsOnly')
    ),
    'selected-row relationship producer'
).initializer.expression.getText();
const contextCases = [
    [
        'configured-parent-edit',
        'fld_parent',
        'rec_parent',
        { loggedInUserRecordsViewMode: 'only-record-linked-to-user' },
        null,
        true,
    ],
    [
        'custom-view-parent-edit',
        'fld_parent',
        'rec_parent',
        {},
        { showRecordsNotLinkedToUser: false },
        true,
    ],
    ['unrestricted-view', 'fld_parent', 'rec_parent', {}, null, false],
    [
        'missing-inverse',
        null,
        'rec_parent',
        { loggedInUserRecordsViewMode: 'only-record-linked-to-user' },
        null,
        false,
    ],
    [
        'parent-create-no-id',
        'fld_parent',
        null,
        { loggedInUserRecordsViewMode: 'only-record-linked-to-user' },
        null,
        false,
    ],
].map(([name, inverseId, parentId, config, selectedCustomView, present]) => {
    const showLoggedInRecordsOnly = execute(
        `(${expression('field', 'showLoggedInRecordsOnly')});`,
        { props: { miniExtFieldConfig: config }, selectedCustomView }
    );
    const expected = present
        ? {
              reversedFieldIdToPrefill: 'fld_parent',
              parentFormRecordId: 'rec_parent',
          }
        : null;
    const actual = detached(
        execute(`(${relationshipProducer});`, {
            fieldIdInLineItemRecordToLinkToParentExtension: inverseId,
            parentExtensionRecordId: parentId,
            showLoggedInRecordsOnly,
        })
    );
    assert.deepEqual(actual, expected, name);
    return { name, inverseId, parentId, config, selectedCustomView, expected };
});
for (const [name, value, publicField, parentLink, expectedValue] of [
    ['new-selection-keeps-parent-context', [], true, true, ['rec_parent']],
    [
        'existing-inverse-canonical-dedup',
        ['rec_other', 'rec_other'],
        true,
        true,
        ['rec_other', 'rec_parent'],
    ],
    [
        'already-linked-no-prefill',
        ['rec_parent', 'rec_parent'],
        true,
        true,
        null,
    ],
    ['nonpublic-inverse-no-prefill', [], false, true, null],
    ['dropped-context-demonstrates-unlink', [], true, false, null],
]) {
    const toLinkToParent = parentLink
        ? {
              reversedFieldIdToPrefill: 'fld_parent',
              parentFormRecordId: 'rec_parent',
          }
        : null;
    const prefillQueryForChildExtension = execute(
        `(${expression('modal', 'prefillQueryForChildExtension')});`,
        {
            props: {
                mode: {
                    type: 'edit',
                    recordId: 'rec_child',
                    prefillQueryForChildExtension: 'create-only=excluded',
                },
            },
        }
    );
    assert.equal(prefillQueryForChildExtension, null, name);
    const relationship = detached(
        await execute(relationshipPrefillSource, {
            args: {
                prefillDataForLinkedRecordsForm: {
                    toLinkToParent,
                    prefillQueryForChildExtension: null,
                },
                formRecord: {
                    type: 'edit',
                    recordId: 'rec_child',
                    data: { fld_parent: value },
                },
                workspaceId: 'workspace_synthetic',
                baseId: 'base_synthetic',
                cacheKey: 'cache_synthetic',
                linkedTableIdOfLinkedRecordField: 'tbl_child',
                fieldIdsUsedPublicly: new Set(
                    publicField ? ['fld_parent'] : []
                ),
            },
            fetchFieldsForTable: async () => ({
                fields: [{ id: 'fld_parent', name: 'Parent' }],
            }),
            throwPublicExtensionError: () => {
                throw Error('Synthetic prefill refusal.');
            },
        })
    );
    const expected =
        expectedValue === null
            ? null
            : { fieldName: 'Parent', fieldValue: expectedValue };
    assert.deepEqual(relationship, expected, name);
    const inverseIds = relationship?.fieldValue ?? value;
    const reconciled = reconcile({
        parentMode: 'edit',
        nativeIds: ['rec_child'],
        savedId: 'rec_child',
        inversePresent: true,
        inverseIds,
    });
    const expectedNative = parentLink && publicField ? ['rec_child'] : [];
    assert.deepEqual(reconciled.nativeIds, expectedNative, name);
    relationshipCases.push({
        name,
        value,
        publicField,
        parentLink,
        sdkQuery: {},
        prefillQueryForChildExtension,
        toLinkToParent,
        expected,
        expectedNative,
    });
}
const fields = [
    {
        id: 'fld_title',
        name: 'Title',
        config: { type: 'singleLineText', options: null },
    },
    {
        id: 'fld_enabled',
        name: 'Enabled',
        config: { type: 'checkbox', options: {} },
    },
];
const a = {
    airtableFields: fields,
    recordIdsToAirtableRecords: {
        rec_child: {
            id: 'rec_child',
            fields: {
                fld_title: 'Old label',
                fld_enabled: true,
                fld_unfetched: 'Retained dependency',
            },
        },
        rec_sibling: { id: 'rec_sibling', fields: { fld_title: 'Sibling' } },
    },
};
const mergeSource = `
${declaration('ids', 'generateIdsMap')}
${declaration('merge', 'mergeLinkedRecordIdsToAirtableRecords')}
${declaration('merge', 'mergeAirtableFields')}
${declaration('merge', 'mergeLinkedTableState')}
mergeLinkedTableState(a,b);`;
const cacheCases = [
    [
        'cache-edit-overlay',
        {
            airtableFields: fields,
            recordIdsToAirtableRecords: {
                rec_child: {
                    id: 'rec_child',
                    fields: { fld_title: 'Edited label' },
                },
            },
        },
        { fld_title: 'Edited label', fld_unfetched: 'Retained dependency' },
    ],
    [
        'cache-unfetched-boolean-retained',
        {
            airtableFields: [fields[0]],
            recordIdsToAirtableRecords: {
                rec_child: {
                    id: 'rec_child',
                    fields: { fld_title: 'Edited label' },
                },
            },
        },
        {
            fld_title: 'Edited label',
            fld_enabled: true,
            fld_unfetched: 'Retained dependency',
        },
    ],
].map(([name, b, expectedFields]) => {
    const expected = detached(execute(mergeSource, { a, b }));
    assert.deepEqual(
        expected.recordIdsToAirtableRecords.rec_child.fields,
        expectedFields,
        name
    );
    assert.deepEqual(
        expected.recordIdsToAirtableRecords.rec_sibling,
        a.recordIdsToAirtableRecords.rec_sibling,
        name
    );
    return { name, a, b, expected };
});
const generator = 'scripts/generate-linked-child-edit-fixture.mjs';
const fixture = {
    revision,
    tree: execFileSync('git', ['rev-parse', `${revision}^{tree}`], {
        cwd: checkout,
        encoding: 'utf8',
    }).trim(),
    sourceHashes,
    generator,
    generatorSha256: createHash('sha256')
        .update(readFileSync(resolve(root, generator)))
        .digest('hex'),
    proof: 'Finite source-executed EDIT helper/expression and pure cache-merge oracles with synthetic external schema input. Proposed displayed-native-row eligibility is explicitly a conservative contract, not an implemented SDK EDIT owner. No full reducer, backend authorization, browser or persistence proof.',
    editExtensionCases,
    openCases,
    reconciliationCases,
    membershipCases,
    relationshipCases,
    contextCases,
    cacheCases,
};
const { format, resolveConfig } = await import('prettier');
writeFileSync(
    resolve(root, 'test/fixtures/linked-child-edit-canonical.json'),
    await format(JSON.stringify(fixture), {
        ...(await resolveConfig(resolve(root, '.prettierrc.json'))),
        parser: 'json',
    })
);
console.log(
    JSON.stringify({
        revision,
        tree: fixture.tree,
        sourceCount: Object.keys(sourceHashes).length,
        cases: Object.fromEntries(
            [
                'editExtensionCases',
                'openCases',
                'reconciliationCases',
                'membershipCases',
                'relationshipCases',
                'contextCases',
                'cacheCases',
            ].map((key) => [key, fixture[key].length])
        ),
    })
);
