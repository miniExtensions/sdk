import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const revision = '4bf957c4830e6863972e45e52f2c371dc8ea9c77';
const checkout = process.argv[2];
assert(checkout, 'Supply the authorized canonical checkout explicitly.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
    create: 'utils/linked-records-field-config-helpers.ts',
    field: 'components/Fields/FieldRenderer/LinkedRecordsField/LinkedRecordsField.tsx',
    reducer: 'components/PublicExtension/redux/publicExtensionReducer.ts',
    prefill:
        'components/Fields/FieldRenderer/LinkedRecordsField/getPrefillQueryForChildExtension.ts',
    readable: 'types/airtable/getReadableStringFromAirtableValue.ts',
    readableType:
        'types/extensions/miniExt-field-configs/writeTypeForField-helpers.ts',
    types: 'types/airtable/types.ts',
    empty: 'types/helpers/isValueEmptyForField.ts',
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
    const found = [];
    const walk = (node) => {
        if (predicate(node)) found.push(node);
        ts.forEachChild(node, walk);
    };
    walk(sources[key].ast);
    return found;
};
const declaration = (key, name) => {
    const found = nodes(
        key,
        (node) => ts.isVariableDeclaration(node) && node.name.getText() === name
    );
    assert.equal(found.length, 1, `Expected one ${name} declaration.`);
    return `const ${found[0].getText()};`;
};
const expression = (key, name) => {
    const found = nodes(
        key,
        (node) => ts.isVariableDeclaration(node) && node.name.getText() === name
    );
    assert.equal(found.length, 1, `Expected one ${name} expression.`);
    return found[0].initializer.getText();
};
const enumNode = nodes(
    'types',
    (node) =>
        ts.isEnumDeclaration(node) && node.name.text === 'AirtableFieldType'
);
assert.equal(enumNode.length, 1);
const inversePredicate = nodes(
    'reducer',
    (node) =>
        ts.isIfStatement(node) &&
        node.expression.getText().startsWith('shouldReloadNoLoginPortal ||')
);
assert.equal(inversePredicate.length, 1);
const additions = nodes(
    'reducer',
    (node) =>
        ts.isVariableDeclaration(node) &&
        node.name.getText() === 'valueWithNewRecordId'
);
assert.equal(additions.length, 1);
const removals = nodes(
    'reducer',
    (node) =>
        ts.isVariableDeclaration(node) &&
        node.name.getText() === 'valueWithoutRemovedRecordId'
);
assert.equal(removals.length, 1);
const run = (source, input = {}) =>
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.None,
            },
        }).outputText,
        input,
        { timeout: 1000 }
    );
const createOracle = (config) =>
    run(
        `${declaration('create', 'getExtensionIdForCreatingLinkedRecords')}
getExtensionIdForCreatingLinkedRecords(config);`,
        { config, FormForEditingAndCreating: { sameForm: 'same-form' } }
    );
const capacityOracle = (config, physicalSingle, selectedCount) =>
    run(
        `
const prefersSingleRecordLink = ${expression('field', 'prefersSingleRecordLink')};
${declaration('field', 'canAddMoreRecordsToCell')}
({prefersSingleRecordLink,canAddMoreRecordsToCell});`,
        {
            isPortalScreen: false,
            props: { miniExtFieldConfig: config },
            linkedRecordsConfig: {
                options: { prefersSingleRecordLink: physicalSingle },
            },
            selectedRecordsIds: Array.from(
                { length: selectedCount },
                (_, i) => `rec_${i}`
            ),
            maxRecordsToSelectOrCreateFieldId: 'maxRecordsToSelectOrCreate',
            customMaxRecordsToSelectFieldId: 'customMaxRecordsToSelect',
        }
    );
const reconcileOracle = (input) => {
    const add = run(`(${inversePredicate[0].expression.getText()});`, {
        shouldReloadNoLoginPortal: false,
        inverseLinkFieldInModal:
            input.parentMode === 'edit' ? { id: 'fld_parent_a' } : null,
        parentScreenState: {
            result: {
                data: {
                    formRecord: {
                        type: input.parentMode,
                        recordId: 'rec_parent',
                    },
                },
            },
        },
        modalFormRecord: { data: { fld_parent_a: input.inverseIds } },
    });
    const existingValue = input.nativeIds;
    const action = {
        payload: {
            newRecordIdToAdd: input.savedId,
            recordIdToRemove: input.savedId,
        },
    };
    const next = add
        ? existingValue.includes(input.savedId)
            ? [...existingValue]
            : run(`(${additions[0].initializer.getText()});`, {
                  existingValue,
                  action,
              })
        : run(`(${removals[0].initializer.getText()});`, {
              existingValue,
              action,
          });
    return {
        nativeIds: [...next],
        changed: next.length !== existingValue.length,
        exemptCreatedRecord: add && next.length !== existingValue.length,
    };
};
const prefillOracle = (value) =>
    run(
        `
${enumNode[0].getText().replace(/^export\s+/, '')}
${declaration('readableType', 'getReadableTypeForAirtableField')}
${declaration('readable', 'convertAirtableValueToPrimitive')}
${declaration('readable', 'getReadableStringFromAirtableValue')}
${declaration('readable', 'getReadableStringFromAirtableValueWithErrorHandling')}
${declaration('prefill', 'getPrefillQueryForChildExtension')}
getPrefillQueryForChildExtension({prefillChildFormForCreatingRecords:true,
prefillFieldForCreatingChildExtensionId:'fld_title',
fieldIdsToSchemas:{fld_title:{airtableField:{name:'Title',config:{type:'singleLineText',options:null}}}},
formRecordData:{fld_title:value},source:{type:'airtableMock',linkedTableStates:{}},customErrorMessage:'synthetic'});`,
        { value }
    );
const base = {
    allowCreatingRecords: true,
    allowEditingRecords: true,
    formsForEditingAndCreating: 'same-form',
    extensionIdForCreatingAndEditing: 'form_shared',
    extensionIdForCreating: 'form_create',
};
const createCases = [
    {
        name: 'shared-default',
        config: { ...base, formsForEditingAndCreating: undefined },
    },
    { name: 'shared-explicit', config: base },
    {
        name: 'separate',
        config: { ...base, formsForEditingAndCreating: 'different-forms' },
    },
    { name: 'create-only', config: { ...base, allowEditingRecords: false } },
    { name: 'disabled', config: { ...base, allowCreatingRecords: false } },
].map((c) => ({ ...c, expected: createOracle(c.config) }));
const capacityCases = [
    {
        name: 'physical-single-empty',
        config: base,
        physicalSingle: true,
        selectedCount: 0,
    },
    {
        name: 'physical-single-full',
        config: base,
        physicalSingle: true,
        selectedCount: 1,
    },
    {
        name: 'unlimited-overrides-physical',
        config: { ...base, maxRecordsToSelectOrCreate: 'unlimited' },
        physicalSingle: true,
        selectedCount: 2,
    },
    {
        name: 'configured-one',
        config: { ...base, maxRecordsToSelectOrCreate: '1' },
        physicalSingle: false,
        selectedCount: 1,
    },
    {
        name: 'custom-below',
        config: { ...base, customMaxRecordsToSelect: 3 },
        physicalSingle: false,
        selectedCount: 2,
    },
    {
        name: 'custom-at',
        config: { ...base, customMaxRecordsToSelect: 3 },
        physicalSingle: false,
        selectedCount: 3,
    },
    {
        name: 'custom-zero',
        config: { ...base, customMaxRecordsToSelect: 0 },
        physicalSingle: false,
        selectedCount: 0,
    },
].map((c) => ({
    ...c,
    expected: capacityOracle(c.config, c.physicalSingle, c.selectedCount),
}));
const reconciliationCases = [
    {
        name: 'create-append',
        parentMode: 'create',
        nativeIds: ['rec_other'],
        savedId: 'rec_new',
        inverseIds: [],
    },
    {
        name: 'create-noop-duplicates',
        parentMode: 'create',
        nativeIds: ['rec_new', 'rec_new'],
        savedId: 'rec_new',
        inverseIds: [],
    },
    {
        name: 'edit-linked-append',
        parentMode: 'edit',
        nativeIds: ['rec_other'],
        savedId: 'rec_new',
        inverseIds: ['rec_parent'],
    },
    {
        name: 'edit-unlinked-removes-all',
        parentMode: 'edit',
        nativeIds: ['rec_new', 'rec_other', 'rec_new'],
        savedId: 'rec_new',
        inverseIds: [],
    },
    {
        name: 'edit-unlinked-noop',
        parentMode: 'edit',
        nativeIds: ['rec_other'],
        savedId: 'rec_new',
        inverseIds: [],
    },
].map((c) => ({ ...c, expected: reconcileOracle(c) }));
const prefillCases = [
    null,
    '',
    '  ',
    'prefill_Title=one',
    '  prefill_Title=two  ',
].map((value, index) => ({
    name: `text-${index}`,
    value,
    expected: prefillOracle(value),
}));
const emptyCases = [null, '', '  '].map((value, index) => ({
    name: `empty-${index}`,
    value,
    expected: run(
        `${enumNode[0].getText().replace(/^export\s+/, '')}
${declaration('empty', 'isValueEmptyForField')}
isValueEmptyForField({fieldType:AirtableFieldType.MULTIPLE_RECORD_LINKS,value});`,
        { value }
    ),
}));
const generator = 'scripts/generate-linked-child-fixture.mjs';
const fixture = {
    revision,
    sourceHashes,
    generator,
    generatorSha256: createHash('sha256')
        .update(readFileSync(resolve(root, generator)))
        .digest('hex'),
    proof: 'Pinned canonical helper and expression execution; synthetic pure policy only. Reconciliation executes the canonical inverse predicate and append/remove expressions; no-op exemption refusal is the conservative SDK policy, not full canonical reducer provenance. No full reducer, browser or persistence evidence.',
    createCases,
    capacityCases,
    reconciliationCases,
    prefillCases,
    emptyCases,
};
const { format, resolveConfig } = await import('prettier');
writeFileSync(
    resolve(root, 'test/fixtures/linked-child-canonical.json'),
    await format(JSON.stringify(fixture), {
        ...(await resolveConfig(resolve(root, '.prettierrc.json'))),
        parser: 'json',
    })
);
