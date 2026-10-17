import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
    conditions: [{
        id: `show-${id}`,
        type: 'singleCondition' as const,
        setting: {
            type: 'matchesRegex' as const,
            fieldType: 'singleSelect' as const,
            idOrName: { type: 'id' as const, id },
            value,
        },
    }],
});
const fixture = (configure: (loaded: FormLoadedResult) => void = () => {}) => {
    const loaded = loadedForm();
    const template = loaded.payload.fieldIdsToSchemas.fld_title!;
    if (template.fieldType !== 'singleLineText') throw Error('fixture');
    loaded.payload.fieldIdsInForm = ['a', 'b', 'c'];
    loaded.payload.fieldIdsToSchemas = Object.fromEntries(
        ['a', 'b', 'c'].map((id, i) => [id, {
            ...structuredClone(template),
            airtableField: { ...structuredClone(template.airtableField), id, name: id },
            miniExtConfig: i === 0 ? {} : { headerSectionTitle: i === 1 ? 'Second' : 'Third' },
        }])
    );
    loaded.payload.formRecord = {
        type: 'edit',
        recordId: 'record_regex_page',
        tableId: 'table_projects',
        data: { a: 'Alpha', b: '', c: 'C', untouched: { text: 'native' } },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['untouched'];
    loaded.payload.urlPrefilledFieldIds = [];
    Object.assign(loaded.payload.publicFields.state, {
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    });
    loaded.payload.fieldIdsToSchemas.a = {
        fieldType: 'singleSelect',
        airtableField: {
            ...template.airtableField, id: 'a', name: 'Choice', isComputed: false,
            config: { type: 'singleSelect', options: { choices: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }] } },
        },
        miniExtConfig: {},
    } as never;
    loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
        headerSectionTitle: 'Second', required: true,
        conditionalFields: condition('a', '^Alpha$'),
    } as never;
    configure(loaded);
    let current = true;
    const calls: SaveFormInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => { throw Error('Unexpected network'); },
    });
    client.forms.save = async (input) => {
        calls.push(structuredClone(input));
        return invalidForm();
    };
    const fields = createFormFieldBindings({
        client, loaded, saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'regex-page', revision: 0 }),
    });
    const pages = createFormPageOwner({
        fields, isCurrent: () => current, configurationRevision: () => 0,
    });
    return {
        fields, pages, calls,
        retire: () => { current = false; },
        dispose: () => { pages.dispose(); fields.destroy(); },
    };
};

describe('single-select regex conditional pages', () => {
    it('skips and restores a required page, retaining native values and Save dirtiness', async (t) => {
        const f = fixture();
        t.after(f.dispose);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert.equal(f.pages.getSnapshot().canNext, false);
        const stale = f.pages.getSnapshot().revision;
        assert(f.fields.controller.write('a', 'Beta'));
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert.deepEqual(f.pages.back(stale), { accepted: false, reason: 'stale-revision' });
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        const revision = f.pages.getSnapshot().revision;
        assert(f.pages.back(revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert.deepEqual(f.pages.back(revision), { accepted: false, reason: 'stale-revision' });
        assert(f.fields.controller.write('a', 'Alpha'));
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert(f.fields.field('b').setValue('Required answer').accepted);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        const before = structuredClone(f.fields.controller.getState().draft!);
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0]!.formRecord.data, before.data);
        assert.deepEqual(f.calls[0]!.formFieldIdsWithUnsavedChanges, before.dirtyFieldIds);
        assert.equal(f.calls[0]!.formRecord.data.a, 'Alpha');
    });
    it('final validation follows the earlier answer and retired owners cannot submit', async (t) => {
        const f = fixture((loaded) => { loaded.payload.formRecord.data.a = 'Beta'; });
        t.after(f.dispose);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        assert(f.fields.controller.write('a', 'Alpha'));
        assert.equal(f.pages.getSnapshot().canSubmit, false);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(f.calls.length, 0);
        assert(f.fields.controller.write('a', 'Beta'));
        f.retire();
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(f.calls.length, 0);
    });
});
