import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateFormFieldVisibility, composeFormFieldVisibility } from '../src/forms/visibility.js';
import { createFormPageOwner } from '../src/forms/pages.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';

const condition = (id: string, value: string) => ({
    logicalOperator: 'and' as const,
    conditions: [
        {
            id: `show-${id}`,
            type: 'singleCondition' as const,
            setting: {
                type: 'is' as const,
                fieldType: 'singleLineText' as const,
                idOrName: { type: 'id' as const, id },
                value,
            },
        },
    ],
});
const fixture = (configure: (loaded: FormLoadedResult) => void = () => {}) => {
    const loaded = loadedForm();
    const template = loaded.payload.fieldIdsToSchemas.fld_title!;
    if (template.fieldType !== 'singleLineText') throw Error('fixture');
    loaded.payload.fieldIdsInForm = ['a', 'b', 'c'];
    loaded.payload.fieldIdsToSchemas = Object.fromEntries(
        ['a', 'b', 'c'].map((id, i) => [
            id,
            {
                ...structuredClone(template),
                airtableField: {
                    ...structuredClone(template.airtableField),
                    id,
                    name: id,
                },
                miniExtConfig:
                    i === 0
                        ? { headerSectionTitle: 'First', hideFieldIfEmpty: true, required: true }
                        : i === 1 ? { hideFieldIfEmpty: true, required: true } : { headerSectionTitle: 'Last' },
            },
        ])
    );
    loaded.payload.formRecord = {
        type: 'edit',
        recordId: 'record_section_page',
        tableId: 'table_projects',
        data: { a: '', b: '', c: 'show', untouched: { text: 'native' } },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['untouched'];
    loaded.payload.urlPrefilledFieldIds = [];
    Object.assign(loaded.payload.publicFields.state, {
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    });
    configure(loaded);
    let current = true;
    const calls: SaveFormInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('Unexpected network');
        },
    });
    client.forms.save = async (input) => {
        calls.push(structuredClone(input));
        return invalidForm();
    };
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'section-page', revision: 0 }),
    });
    const pages = createFormPageOwner({
        fields,
        isCurrent: () => current,
        configurationRevision: () => 0,
    });
    return {
        loaded,
        fields,
        pages,
        calls,
        retire: () => {
            current = false;
        },
        dispose: () => {
            pages.dispose();
            fields.destroy();
        },
    };
};

describe('ordinary section scalar empty hiding', () => {
    it('skips the empty required section and preserves native Save data', async (t) => {
        const f = fixture(); t.after(f.dispose);
        assert.equal(f.fields.field('a').getSnapshot().visibility.type, 'hidden');
        assert.equal(f.fields.field('b').getSnapshot().visibility.type, 'hidden');
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert.equal(f.pages.getSnapshot().canBack, false);
        const before = structuredClone(f.fields.controller.getState().draft!);
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0]!.formRecord.data, before.data);
        assert.deepEqual(f.calls[0]!.formFieldIdsWithUnsavedChanges, before.dirtyFieldIds);
    });
    it('restores a mixed section and refuses stale, repeated and retired actions', async (t) => {
        const f = fixture(); t.after(f.dispose);
        const stale = f.pages.getSnapshot().revision;
        assert(f.fields.controller.write('b', 'Restored'));
        assert.deepEqual(f.pages.back(stale), { accepted: false, reason: 'stale-revision' });
        const revision = f.pages.getSnapshot().revision;
        assert(f.pages.back(revision).accepted);
        assert.deepEqual(f.pages.back(revision), { accepted: false, reason: 'stale-revision' });
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert.equal(f.fields.field('a').getSnapshot().visibility.type, 'hidden');
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert(f.fields.controller.write('b', ''));
        assert.equal(f.pages.getSnapshot().canBack, false);
        f.retire();
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(f.calls.length, 0);
    });
    it('keeps native answers for own predicates and never hides empty create fields', (t) => {
        const f = fixture((loaded) => {
            loaded.payload.formRecord.data.b = 'native';
            loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                hideFieldIfEmpty: true, conditionalFields: condition('a', 'show'),
            } as never;
        }); t.after(f.dispose);
        assert.equal(f.fields.field('b').getSnapshot().visibility.type, 'hidden');
        assert(f.fields.controller.write('a', 'show'));
        assert.equal(f.fields.field('b').getSnapshot().visibility.type, 'visible');
        assert.equal(f.fields.controller.getState().draft!.data.b, 'native');
        const create = fixture((loaded) => { loaded.payload.formRecord = { type: 'create', data: loaded.payload.formRecord.data }; });
        t.after(create.dispose);
        assert.equal(create.fields.field('a').getSnapshot().visibility.type, 'visible');
        assert.equal(create.pages.getSnapshot().canNext, false);
    });
    it('keeps standalone section evaluation and inherited raw sections conservative', (t) => {
        for (const disabled of [false, true]) {
            const f = fixture((loaded) => {
                Object.assign(loaded.payload.fieldIdsToSchemas.a!.miniExtConfig!, {
                    enableSectionHeader: !disabled, applyFieldConditionsToSection: true,
                });
            }); t.after(f.dispose);
            assert.equal(f.fields.field('b').getSnapshot().visibility.type, 'blocked');
            assert.equal(f.pages.getSnapshot().canSubmit, false);
        }
        const f = fixture(); t.after(f.dispose);
        assert.equal(evaluateFormFieldVisibility({
            field: f.loaded.payload.fieldIdsToSchemas.a!,
            airtableFields: Object.values(f.loaded.payload.fieldIdsToSchemas).map((s) => s.airtableField),
            data: f.loaded.payload.formRecord.data, formRecordType: 'edit',
            evaluationMode: 'runtime', invalidConditionMode: 'strict',
        }).type, 'blocked');
    });
    it('uses raw disabled titles to reset inheritance without resetting display grouping', (t) => {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsInForm = ['a', 'b', 'c', 'd'];
            loaded.payload.fieldIdsToSchemas.d = structuredClone(loaded.payload.fieldIdsToSchemas.c!);
            loaded.payload.fieldIdsToSchemas.d.airtableField.id = 'd';
            loaded.payload.fieldIdsToSchemas.d.airtableField.name = 'd';
            loaded.payload.formRecord.data.d = 'Last';
            loaded.payload.fieldIdsToSchemas.a!.miniExtConfig = {
                headerSectionTitle: 'Applied', applyFieldConditionsToSection: true,
                conditionalFields: condition('d', 'Last'),
            } as never;
            loaded.payload.formRecord.data.a = 'Lead';
            loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                headerSectionTitle: 'Reset', enableSectionHeader: false,
                hideFieldIfEmpty: true,
            };
            loaded.payload.fieldIdsToSchemas.c!.miniExtConfig = { hideFieldIfEmpty: true };
            loaded.payload.formRecord.data.c = '';
        }); t.after(f.dispose);
        assert.equal(f.fields.field('b').getSnapshot().visibility.type, 'hidden');
        assert.equal(f.fields.field('c').getSnapshot().visibility.type, 'hidden');
        assert.deepEqual(f.pages.getSnapshot().pages[0]!.fieldIds, ['a', 'b', 'c']);
        assert(f.fields.controller.write('d', 'No'));
        assert.equal(f.fields.field('c').getSnapshot().visibility.type, 'hidden');
        assert.equal(f.fields.controller.getState().draft!.data.a, 'Lead');
    });
});


it('preserves supported scalar emptiness and unsupported physical/value boundaries', () => {
    for (const [type, value, expected] of [
        ['singleLineText', ' ', 'hidden'], ['number', 0, 'visible'],
        ['rating', 0, 'hidden'], ['checkbox', false, 'hidden'],
        ['barcode', { text: '' }, 'hidden'], ['singleSelect', null, 'blocked'],
        ['multipleRecordLinks', [], 'blocked'], ['singleLineText', {}, 'blocked'],
        ['number', Infinity, 'blocked'],
    ] as const) {
        const field = {
            fieldType: type,
            airtableField: { id: 'a', name: 'A', isComputed: false, isPrimaryField: false, description: null, config: { type, options: null } },
            miniExtConfig: { headerSectionTitle: 'Ordinary', hideFieldIfEmpty: true },
        };
        const result = composeFormFieldVisibility({
            fieldIds: ['a'], fieldIdsToSchemas: { a: field }, airtableFields: [field.airtableField],
            data: { a: value }, formRecordType: 'edit', evaluationMode: 'runtime', invalidConditionMode: 'strict',
        } as never);
        assert.equal(result.a!.type, expected, type);
        field.airtableField.isComputed = true;
        assert.equal(composeFormFieldVisibility({
            fieldIds: ['a'], fieldIdsToSchemas: { a: field }, airtableFields: [field.airtableField],
            data: { a: value }, formRecordType: 'edit', evaluationMode: 'runtime', invalidConditionMode: 'strict',
        } as never).a!.type, 'blocked', type + ' computed');
    }
});


it('does not let a whitespace title clear inherited filtering', (t) => {
    const f = fixture((loaded) => {
        loaded.payload.fieldIdsToSchemas.a!.miniExtConfig = {
            headerSectionTitle: 'Applied', applyFieldConditionsToSection: true,
        };
        loaded.payload.formRecord.data.a = 'Lead';
        loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
            headerSectionTitle: '  ', hideFieldIfEmpty: true,
        };
    }); t.after(f.dispose);
    assert.equal(f.fields.field('b').getSnapshot().visibility.type, 'blocked');
});
