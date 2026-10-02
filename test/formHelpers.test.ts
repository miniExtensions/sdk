import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createFormSaveInput,
    describeLoadedFormFields,
    FormDraftStore,
    formValidationMessages,
    normalizeFormSaveResult,
    openLoadedFormDraft,
    type FormSaveOptions,
} from '../src/forms/index.js';
import type {
    AirtableValue,
    FormLoadedResult,
    SaveFormResult,
} from '../src/runtime/index.js';
import {
    formSaveOptions,
    invalidForm,
    loadedForm,
    savedForm,
} from './formsFixtures.js';

describe('loaded Form draft and save helpers', () => {
    it('keeps all native loaded values and unions hidden/URL prefill dirty IDs', () => {
        const loaded = loadedForm();
        const store = new FormDraftStore<AirtableValue>();
        const handle = openLoadedFormDraft({ store, loaded });
        assert.deepEqual(store.snapshot(handle), {
            data: loaded.payload.formRecord.data,
            dirtyFieldIds: ['fld_parent', 'fld_prefill'],
        });
        store.write(handle, 'fld_title', 'Draft title');
        loaded.payload.formRecord.data.fld_title = 'External mutation';
        assert.equal(store.read(handle, 'fld_title'), 'Draft title');
        assert.equal(openLoadedFormDraft({ store, loaded }), handle);
    });

    it('preserves create/edit identity, baseline fields and every explicit save option from a sparse snapshot', () => {
        for (const edit of [false, true]) {
            const loaded = loadedForm();
            if (edit) {
                loaded.payload.formRecord = {
                    ...loaded.payload.formRecord,
                    type: 'edit',
                    recordId: 'record_existing',
                    tableId: 'table_existing',
                };
            }
            const saveOptions = formSaveOptions();
            // Compute mode is forwarded; it is not a promise of read-only preview.
            saveOptions.isComputeMode = true;
            const draft = {
                data: {
                    fld_title: 'Draft title',
                    fld_flag: false,
                    fld_number: 0,
                },
                dirtyFieldIds: ['fld_title', 'fld_title'],
            };
            const input = createFormSaveInput({
                loaded,
                draft,
                options: saveOptions,
            });
            assert.deepEqual(input, {
                ...saveOptions,
                extensionAccessToken: loaded.payload.extensionAccessToken,
                formRecord: {
                    ...loaded.payload.formRecord,
                    data: { ...loaded.payload.formRecord.data, ...draft.data },
                },
                formFieldIdsWithUnsavedChanges: [
                    'fld_parent',
                    'fld_prefill',
                    'fld_title',
                ],
            });
            input.formRecord.data.fld_title = 'Mutation';
            input.searchQuery.repeated = ['Mutation'];
            assert.equal(draft.data.fld_title, 'Draft title');
            assert.deepEqual(saveOptions.searchQuery.repeated, ['One', 'Two']);
        }
    });

    it('requires all existing save options rather than providing implicit mutation defaults', () => {
        const loaded = loadedForm();
        const draft = { data: {}, dirtyFieldIds: [] };
        for (const key of [
            'captchaVal',
            'isComputeMode',
            'searchQuery',
            'context',
            'conditionalLinkedRecordFieldIdsToFilteringValues',
        ] as const) {
            const incomplete = formSaveOptions();
            delete (incomplete as unknown as Record<string, unknown>)[key];
            assert.throws(
                () =>
                    createFormSaveInput({ loaded, draft, options: incomplete }),
                TypeError
            );
        }
        assert.throws(
            () =>
                createFormSaveInput({
                    loaded,
                    draft,
                    options: {
                        ...formSaveOptions(),
                        context: { type: 'modal' },
                    } as FormSaveOptions,
                }),
            TypeError
        );
    });

    it('describes returned schema order only and preserves computed/read-only/raw configuration', () => {
        const loaded = loadedForm();
        loaded.payload.fieldIdsInForm.push('fld_title');
        const descriptors = describeLoadedFormFields(loaded);
        assert.deepEqual(
            descriptors.map((field) => field.fieldId),
            ['fld_title', 'fld_computed', 'fld_readonly', 'fld_files']
        );
        assert.equal(descriptors[0].title, 'Request title');
        assert.equal(descriptors[0].readOnly, false);
        assert.equal(descriptors[1].isComputed, true);
        assert.equal(descriptors[1].readOnly, true);
        assert.equal(descriptors[2].readOnly, true);
        assert.deepEqual(descriptors[0].schema.miniExtConfig?.futureSetting, {
            preserve: true,
        });
        assert.equal(Object.hasOwn(descriptors[0], 'hidden'), false);
        descriptors[0].schema.airtableField.name = 'Changed by renderer';
        assert.equal(
            loaded.payload.fieldIdsToSchemas.fld_title.airtableField.name,
            'Title'
        );
    });

    it('rejects malformed returned schema and a non-Form screen', () => {
        for (const alter of [
            (loaded: FormLoadedResult) => {
                loaded.payload.fieldIdsToSchemas.fld_title.airtableField.id =
                    'fld_other';
            },
            (loaded: FormLoadedResult) => {
                loaded.payload.fieldIdsToSchemas.fld_title.fieldType =
                    'invented' as never;
            },
            (loaded: FormLoadedResult) => {
                loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                    readOnly: 'yes',
                };
            },
        ]) {
            const loaded = loadedForm();
            alter(loaded);
            assert.throws(() => describeLoadedFormFields(loaded), TypeError);
        }
        const wrong = {
            ...loadedForm(),
            extensionScreen: 'portal_loaded',
        } as unknown as FormLoadedResult;
        assert.throws(() => describeLoadedFormFields(wrong), TypeError);
    });

    it('clears dirty IDs only if the submitted revision is still current', () => {
        const loaded = loadedForm();
        const store = new FormDraftStore<AirtableValue>();
        const handle = openLoadedFormDraft({ store, loaded });
        const submitted = store.revision(handle)!;
        store.write(handle, 'fld_title', 'Edited during save');
        assert.equal(store.markSaved(handle, submitted), false);
        assert.deepEqual(store.snapshot(handle)?.dirtyFieldIds, [
            'fld_parent',
            'fld_prefill',
            'fld_title',
        ]);
        assert.equal(store.markSaved(handle, store.revision(handle)!), true);
        assert.deepEqual(store.snapshot(handle)?.dirtyFieldIds, []);
        assert.equal(store.read(handle, 'fld_title'), 'Edited during save');
        store.clear();
        assert.equal(store.markSaved(handle, submitted), false);
        assert.equal(store.revision(handle), null);
    });
});

describe('Form save result normalization', () => {
    it('deduplicates inline errors by field/message with canonical titles and separate concurrent errors', () => {
        const raw = invalidForm();
        const normalized = normalizeFormSaveResult(raw, loadedForm());
        assert.equal(normalized.type, 'error');
        assert.deepEqual(normalized.raw, raw);
        assert.deepEqual(normalized.validationErrors, [
            raw.formValidationErrors[0],
            {
                fieldId: 'fld_files',
                fieldTitle: 'Files',
                errorMessage: 'Choose a supported attachment.',
            },
            {
                fieldId: 'fld_other',
                fieldTitle: 'fld_other',
                errorMessage: 'Review this field.',
            },
        ]);
        assert.equal(
            normalized.concurrentEditErrorMessage,
            raw.concurrentEditErrorMessage
        );
        normalized.raw.formErrors.fld_title = 'Mutated returned result';
        assert.equal(raw.formErrors.fld_title, 'A title is required.');
        assert.equal(normalized.postSubmissionWarnings.length, 0);
        assert.deepEqual(
            formValidationMessages(
                { constructor: 'Unknown field error.' },
                [],
                loadedForm()
            ),
            [
                {
                    fieldId: 'constructor',
                    fieldTitle: 'constructor',
                    errorMessage: 'Unknown field error.',
                },
            ]
        );
    });

    it('retains the complete success result, linked parent state, logged-in user and post-save warnings', () => {
        const raw = savedForm();
        const normalized = normalizeFormSaveResult(raw);
        assert.equal(normalized.type, 'saved');
        assert.deepEqual(normalized.raw, raw);
        assert.deepEqual(
            normalized.postSubmissionWarnings,
            raw.postSubmissionWarnings
        );
        assert.deepEqual(
            normalized.postSubmissionNotifications,
            raw.postSubmissionNotifications
        );
        assert.deepEqual(normalized.validationErrors, []);
        assert.equal(normalized.concurrentEditErrorMessage, null);
        normalized.postSubmissionWarnings[0].type = 'smsConfirmationFailed';
        assert.equal(
            raw.postSubmissionWarnings?.[0].type,
            'adminNotificationEmailFailed'
        );
    });

    it('fails safely on malformed results rather than claiming a successful save', () => {
        for (const value of [
            null,
            { type: 'saved' },
            { ...savedForm(), record: { id: '', fields: {} } },
            { ...savedForm(), context: { type: 'modal' } },
            {
                ...invalidForm(),
                formValidationErrors: [
                    { fieldId: '', fieldTitle: '', errorMessage: '' },
                ],
            },
            { ...invalidForm(), formErrors: { fld_title: null } },
            { ...invalidForm(), concurrentEditErrorMessage: false },
        ]) {
            assert.throws(
                () => normalizeFormSaveResult(value as SaveFormResult),
                TypeError
            );
        }
        assert.deepEqual(formValidationMessages({}, []), []);
    });
});
