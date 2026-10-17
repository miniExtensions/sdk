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
                        ? { hideFieldIfEmpty: true, required: true }
                        : { headerSectionTitle: i === 1 ? 'Second' : 'Third' },
            },
        ])
    );
    loaded.payload.formRecord = {
        type: 'edit',
        recordId: 'record_leading_page',
        tableId: 'table_projects',
        data: { a: '', b: 'B', c: 'show', untouched: { text: 'native' } },
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
        getScope: () => ({ ownerId: 'leading-page', revision: 0 }),
    });
    const pages = createFormPageOwner({
        fields,
        isCurrent: () => current,
        configurationRevision: () => 0,
    });
    return {
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

describe('leading unsectioned edit-page visibility', () => {
    it('skips an empty required leading page in both directions and preserves native Save data', async (t) => {
        const f = fixture();
        t.after(f.dispose);
        const before = structuredClone(f.fields.controller.getState().draft!);
        assert.equal(
            f.fields.field('a').getSnapshot().visibility.type,
            'hidden'
        );
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert.equal(f.pages.getSnapshot().canBack, false);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0]!.formRecord.data, before.data);
        assert.deepEqual(
            f.calls[0]!.formFieldIdsWithUnsavedChanges,
            before.dirtyFieldIds
        );
    });
    it('keeps a nonempty leading page available and normalizes when its value empties', (t) => {
        const f = fixture((loaded) => {
            loaded.payload.formRecord.data.a = 'Kept';
        });
        t.after(f.dispose);
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
        const stale = f.pages.getSnapshot().revision;
        assert(f.fields.field('a').setValue('').accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert.equal(f.pages.getSnapshot().canBack, false);
        assert.deepEqual(f.pages.next(stale), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert.equal(f.fields.controller.getState().draft!.data.a, '');
        assert.equal(f.calls.length, 0);
    });
    it('observes accepted native repopulation without losing a newer page or accepting a repeated click', (t) => {
        const f = fixture();
        t.after(f.dispose);
        assert(f.fields.controller.write('a', 'Restored native'));
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert.equal(f.pages.getSnapshot().canBack, true);
        const revision = f.pages.getSnapshot().revision;
        assert(f.pages.back(revision).accepted);
        assert.deepEqual(f.pages.back(revision), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert.equal(
            f.fields.field('a').getSnapshot().value,
            'Restored native'
        );
        assert.equal(f.calls.length, 0);
    });
    it('skips a newly hidden current page and restores Back when its condition changes', (t) => {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                headerSectionTitle: 'Second',
                conditionalFields: condition('c', 'show'),
            } as never;
        });
        t.after(f.dispose);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert(f.fields.field('c').setValue('hide').accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        assert.equal(f.pages.getSnapshot().canBack, false);
        assert(f.fields.field('c').setValue('show').accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        assert.equal(f.calls.length, 0);
    });
    it('keeps all-hidden and retired owners unable to submit', async (t) => {
        const hidden = fixture((loaded) => {
            for (const id of ['b', 'c'])
                loaded.payload.fieldIdsToSchemas[id]!.miniExtConfig = {
                    headerSectionTitle: id,
                    conditionalFields: condition('a', 'never'),
                } as never;
        });
        t.after(hidden.dispose);
        assert.equal(hidden.pages.getSnapshot().status, 'all-hidden');
        assert.equal(hidden.pages.getSnapshot().canSubmit, false);
        await assert.rejects(
            hidden.pages.submit(hidden.pages.getSnapshot().revision)
        );
        assert.equal(hidden.calls.length, 0);
        const retired = fixture();
        t.after(retired.dispose);
        assert(
            retired.pages.next(retired.pages.getSnapshot().revision).accepted
        );
        retired.retire();
        await assert.rejects(
            retired.pages.submit(retired.pages.getSnapshot().revision)
        );
        assert.equal(retired.calls.length, 0);
    });
    it('does not apply edit-only empty hiding to create Forms', (t) => {
        const f = fixture((loaded) => {
            loaded.payload.formRecord = {
                type: 'create',
                data: loaded.payload.formRecord.data,
            };
        });
        t.after(f.dispose);
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert.equal(
            f.fields.field('a').getSnapshot().visibility.type,
            'visible'
        );
        assert.deepEqual(f.pages.getSnapshot().problems, [
            { fieldId: 'a', code: 'required' },
        ]);
        assert.equal(f.pages.getSnapshot().canNext, false);
    });
});
