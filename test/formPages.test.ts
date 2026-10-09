import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { File } from 'node:buffer';
import { describe, it } from 'node:test';
import {
    createFormPageOwner,
    FormPageError,
    type FormPageOwnerOptions,
} from '../src/forms/pages.js';
import { validatePageField } from '../src/forms/pageValidation.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { describeLoadedFormFields } from '../src/forms/helpers.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type SaveFormInput,
    type RuntimeFieldSchema,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';
const fixture = (configure: (loaded: FormLoadedResult) => void = () => {}) => {
    const loaded = loadedForm();
    const source = loaded.payload.fieldIdsToSchemas.fld_title!;
    if (source.fieldType !== 'singleLineText') throw Error('fixture');
    const template = structuredClone(source);
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
                miniExtConfig: {
                    headerSectionTitle:
                        i === 1 ? 'Second' : i === 2 ? 'Third' : undefined,
                    required: true,
                },
            },
        ])
    );
    loaded.payload.formRecord = {
        type: 'create',
        data: { a: 'A', b: 'B', c: 'C', untouched: { text: 'native' } },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['untouched'];
    loaded.payload.urlPrefilledFieldIds = [];
    loaded.payload.publicFields.state.multiPageFormMode = 'multi-page';
    loaded.payload.publicFields.state.promptUserBeforeSubmission = false;
    loaded.payload.publicFields.state.enableFormComputeMode = false;
    loaded.payload.publicFields.state.autoSubmitAfterPrefill = false;
    configure(loaded);
    let scope = { ownerId: 'A', revision: 0 },
        config = 0,
        lease = true;
    const calls: SaveFormInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw Error('Unexpected request');
        },
    });
    client.forms.save = async (input) => {
        calls.push(input);
        return invalidForm();
    };
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => scope,
    });
    const pages = createFormPageOwner({
        fields,
        isCurrent: () => lease,
        configurationRevision: () => config,
    });
    return {
        loaded,
        client,
        fields,
        pages,
        calls,
        setScope: (v: typeof scope) => {
            scope = v;
        },
        setConfig: (v: number) => {
            config = v;
        },
        setLease: (v: boolean) => {
            lease = v;
        },
    };
};
const hash = (path: string) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const lastPage = (f: ReturnType<typeof fixture>) => {
    while (f.pages.getSnapshot().canNext) {
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
    }
    assert.equal(f.pages.getSnapshot().canSubmit, true);
};
const validationSupport = JSON.parse(
    readFileSync('test/fixtures/formPageValidationSupport.json', 'utf8')
) as { canonicalComparison: string[]; unsupportedValidation: string[] };
describe('canonical ordinary page validation', () => {
    const oracle = JSON.parse(
        readFileSync('test/fixtures/formPages.json', 'utf8')
    );
    it('pins source/generator fixture provenance without private checkout', () => {
        assert.equal(
            oracle.provenance.revision,
            '58f73d575ab10baa0a10693660d8002f204368e1'
        );
        assert.equal(
            oracle.provenance.generatorSha256,
            hash(oracle.provenance.generator)
        );
        assert.equal(
            oracle.provenance.casesSourceSha256,
            hash('test/fixtures/formPageCases.mjs')
        );
    });
    it('partitions every pinned case explicitly into canonical comparison or conservative refusal', () => {
        const ids = [
            ...validationSupport.canonicalComparison,
            ...validationSupport.unsupportedValidation,
        ];
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual(
            [...ids].sort(),
            oracle.validation.map((c: { name: string }) => c.name).sort()
        );
        assert.equal(validationSupport.canonicalComparison.length, 118);
        assert.equal(validationSupport.unsupportedValidation.length, 28);
    });
    for (const c of oracle.validation)
        it(c.name, () => {
            const loaded = loadedForm();
            loaded.payload.fieldIdsInForm = ['fld_answer'];
            loaded.payload.fieldIdsToSchemas = { fld_answer: c.schema };
            const descriptor = describeLoadedFormFields(loaded)[0]!;
            const result = validatePageField(
                descriptor,
                c.value,
                c.stored,
                c.hidden
            );
            if (validationSupport.unsupportedValidation.includes(c.name))
                assert.deepEqual(result, {
                    fieldId: 'fld_answer',
                    code: 'unsupported-validation',
                });
            else assert.equal(result !== null, c.invalid);
        });
});
describe('page composition authority regressions', () => {
    it('unsupported editable validation blocks its current page rather than unrelated Next', () => {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                headerSectionTitle: 'Second',
                fieldValidationConditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'advanced',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'b' },
                                value: 'B',
                            },
                        },
                    ],
                },
            } as never;
        });
        assert.equal(f.pages.getSnapshot().status, 'ready');
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(f.pages.getSnapshot().status, 'blocked');
        assert(
            f.pages
                .getSnapshot()
                .problems.some(
                    (p) =>
                        p.fieldId === 'b' && p.code === 'unsupported-validation'
                )
        );
        assert.equal(f.calls.length, 0);
    });

    it('computed native values pass through navigation and the original Save authority', async () => {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.b!.airtableField.isComputed = true;
            loaded.payload.formRecord.data.b = 'Computed native';
        });
        lastPage(f);
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0]!.formRecord.data.b, 'Computed native');
    });

    it('computed presentation cannot waive unsupported linked-open tracking', () => {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.b!.airtableField.isComputed = true;
            loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                headerSectionTitle: 'Second',
                requireOpenLinkedRecords: true,
            } as never;
        });
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert(
            f.pages
                .getSnapshot()
                .problems.some(
                    (p) =>
                        p.fieldId === 'b' && p.code === 'unsupported-validation'
                )
        );
        assert.equal(f.calls.length, 0);
    });

    it('final Submit validates earlier visible pages while Next validates only the current page', async () => {
        const f = fixture();
        assert.equal(f.fields.field('b').setValue('').accepted, true);
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            false
        );
        assert.equal(f.fields.field('b').setValue('B').accepted, true);
        lastPage(f);
        assert.equal(f.fields.field('a').setValue('').accepted, true);
        assert.equal(f.pages.getSnapshot().canSubmit, false);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(f.calls.length, 0);
        assert.equal(f.fields.field('a').getSnapshot().value, '');
    });

    for (const change of ['dispose', 'draft', 'navigation'] as const) {
        it(`a reentrant Save predicate ${change} cannot dispatch the captured submission`, async () => {
            const f = fixture();
            lastPage(f);
            let armed = false;
            let changed = false;
            let disposition: string | undefined;
            const saving = f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch: () => {
                        armed = true;
                        return {
                            accepted() {},
                            finish(value) {
                                disposition = value;
                            },
                        };
                    },
                },
                isCurrent: () => {
                    if (armed && !changed) {
                        changed = true;
                        if (change === 'dispose') f.pages.dispose();
                        else if (change === 'draft') {
                            assert.equal(
                                f.fields.controller.write('a', 'Changed'),
                                true
                            );
                        } else {
                            // Cancelling releases the busy gate; the retained page intent
                            // must still fail after this callback changes navigation.
                            f.fields.controller.cancel();
                            f.pages.back(f.pages.getSnapshot().revision);
                        }
                    }
                    return true;
                },
            });
            await assert.rejects(saving);
            assert.equal(changed, true);
            assert.equal(f.calls.length, 0);
            assert.equal(disposition, 'not-dispatched');
            if (change === 'draft')
                assert.equal(
                    f.fields.field('a').getSnapshot().value,
                    'Changed'
                );
            if (change === 'dispose')
                assert.equal(
                    f.fields.field('a').setValue('Still owned').accepted,
                    true
                );
        });
    }

    it('owner-current callback disposal cannot revive a page action', () => {
        const f = fixture();
        let dispose = false;
        const pages = createFormPageOwner({
            fields: f.fields,
            configurationRevision: () => 0,
            isCurrent: () => {
                if (dispose) pages.dispose();
                return true;
            },
        });
        const revision = pages.getSnapshot().revision;
        dispose = true;
        assert.equal(pages.next(revision).accepted, false);
        assert.equal(pages.getSnapshot().status, 'retired');
        assert.equal(f.calls.length, 0);
        assert.equal(f.fields.field('a').setValue('Live owner').accepted, true);
    });

    it('a pending reload refuses Submit before lifecycle dispatch', async () => {
        const f = fixture();
        lastPage(f);
        const held = deferred<FormLoadedResult>();
        const loading = f.fields.reload({
            dirty: 'keep',
            read: () => held.promise,
        });
        let dispatched = false;
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch: () => {
                        dispatched = true;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(dispatched, false);
        assert.equal(f.calls.length, 0);
        held.resolve(structuredClone(f.loaded));
        await loading;
        assert.equal(f.pages.getSnapshot().status, 'retired');
    });

    for (const review of [false, true]) {
        for (const change of [
            'native-draft',
            'configuration',
            'transport-failure',
        ] as const) {
            it(`${review ? 'confirmed Review' : 'final Save'} classifies ${change} at the binding snapshot dispatch boundary`, async () => {
                const f = fixture((loaded) => {
                    loaded.payload.publicFields.state.promptUserBeforeSubmission =
                        review;
                });
                f.pages.dispose();
                f.fields.destroy();
                let armed = false;
                let observed = false;
                let configuration = 0;
                const fields = createFormFieldBindings({
                    client: f.client,
                    loaded: f.loaded,
                    saveOptions: formSaveOptions(),
                    getScope: () => ({ ownerId: 'A', revision: 0 }),
                    canWriteField: () => {
                        if (armed && !observed) {
                            observed = true;
                            if (change === 'native-draft')
                                assert.equal(
                                    fields.controller.write('a', ''),
                                    true
                                );
                            else if (change === 'configuration')
                                configuration++;
                        }
                        return true;
                    },
                });
                const pages = createFormPageOwner({
                    fields,
                    isCurrent: () => true,
                    configurationRevision: () => configuration,
                    review: review
                        ? async () => ({
                              type: 'confirm',
                              isCurrent: () => true,
                          })
                        : undefined,
                });
                while (pages.getSnapshot().canNext)
                    assert.equal(
                        pages.next(pages.getSnapshot().revision).accepted,
                        true
                    );
                const journal = new RecoveryJournal();
                const scope = {
                    owner: 'A',
                    parentFieldId: null,
                    tableId: null,
                    childExtensionId: 'form',
                    context: 'modal' as const,
                };
                let attempt: ReturnType<typeof journal.begin> | undefined;
                let accepted = 0;
                const dispositions: string[] = [];
                if (change === 'transport-failure')
                    f.client.forms.save = async (input) => {
                        f.calls.push(input);
                        throw Error('Unknown server outcome');
                    };
                await assert.rejects(
                    pages.submit(pages.getSnapshot().revision, {
                        lifecycle: {
                            dispatch() {
                                attempt = journal.begin(scope, null, 'save', 1);
                                armed = true;
                                return {
                                    accepted() {
                                        accepted++;
                                    },
                                    finish(disposition) {
                                        dispositions.push(disposition);
                                        if (disposition === 'not-dispatched')
                                            journal.notDispatched(attempt!);
                                        else journal.finishFlight(attempt!);
                                    },
                                };
                            },
                        },
                    })
                );
                assert.equal(observed, true);
                assert.ok(attempt);
                assert.equal(accepted, 0);
                assert.equal(attempt.flight, false);
                if (change === 'transport-failure') {
                    assert.equal(f.calls.length, 1);
                    assert.equal(f.calls[0]!.formRecord.data.a, 'A');
                    assert.deepEqual(dispositions, ['dispatched']);
                    assert.equal(attempt.outcome, 'unknown');
                    assert.equal(journal.blocking(scope, null), attempt);
                    assert.equal(journal.unknown('A').length, 1);
                } else {
                    assert.equal(f.calls.length, 0);
                    assert.deepEqual(dispositions, ['not-dispatched']);
                    assert.equal(attempt.outcome, 'not-dispatched');
                    assert.equal(journal.blocking(scope, null), undefined);
                    assert.equal(journal.unknown('A').length, 0);
                    if (change === 'native-draft')
                        assert.equal(
                            fields.controller.getState().draft!.data.a,
                            ''
                        );
                }
                pages.dispose();
                fields.destroy();
            });
        }
    }

    it('a dispatched unknown Save is never replayed by retained page Submit', async () => {
        const f = fixture();
        lastPage(f);
        const held = deferred<ReturnType<typeof invalidForm>>();
        f.client.forms.save = (input) => {
            f.calls.push(input);
            return held.promise;
        };
        const saving = f.pages.submit(f.pages.getSnapshot().revision);
        const rejected = assert.rejects(saving);
        f.fields.controller.cancel();
        held.reject(new Error('Unknown server outcome'));
        await rejected;
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0]!.formRecord.data.a, 'A');
        assert.equal(f.fields.field('a').getSnapshot().retired, true);
        assert.equal(
            await f.fields.reload({
                dirty: 'keep',
                read: async () => structuredClone(f.loaded),
            }),
            true
        );
        const recovered = createFormPageOwner({
            fields: f.fields,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        assert.equal(recovered.getSnapshot().status, 'ready');
        assert.equal(f.fields.field('a').getSnapshot().value, 'A');
        assert.equal(f.pages.getSnapshot().status, 'retired');
        assert.equal(f.calls.length, 1);
        recovered.dispose();
    });

    it('refuses effective compute options before journal creation or transport', async () => {
        for (const inherited of [false, true]) {
            const f = fixture();
            f.pages.dispose();
            const fields = createFormFieldBindings({
                client: f.client,
                loaded: f.loaded,
                saveOptions: { ...formSaveOptions(), isComputeMode: inherited },
                getScope: () => ({ ownerId: 'ordinary', revision: 0 }),
            });
            const pages = createFormPageOwner({
                fields,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            while (pages.getSnapshot().canNext)
                assert(pages.next(pages.getSnapshot().revision).accepted);
            let attempts = 0;
            await assert.rejects(
                pages.submit(pages.getSnapshot().revision, {
                    options: inherited
                        ? undefined
                        : { ...formSaveOptions(), isComputeMode: true },
                    lifecycle: {
                        dispatch() {
                            attempts++;
                            return { accepted() {}, finish() {} };
                        },
                    },
                }),
                { reason: 'blocked' }
            );
            assert.equal(attempts, 0);
            assert.equal(f.calls.length, 0);
            assert.equal(fields.controller.getState().status, 'ready');
            pages.dispose();
            fields.destroy();
            f.fields.destroy();
        }
    });

    it('accepted AddChoice metadata survives page leases but a real configuration change retires them', async () => {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.a = {
                fieldType: 'multipleSelects',
                airtableField: {
                    id: 'a',
                    name: 'a',
                    isComputed: false,
                    isPrimaryField: false,
                    description: null,
                    config: {
                        type: 'multipleSelects',
                        options: { choices: [{ id: 'alpha', name: 'Alpha' }] },
                    },
                },
                miniExtConfig: { required: true, allowAddingNewOptions: true },
            };
            loaded.payload.formRecord.data.a = ['Alpha'];
        });
        const journal = new RecoveryJournal();
        const creator = f.fields.selectChoice('a', {
            journal,
            loadVersion: 1,
            scope: {
                owner: 'A',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
        });
        let choiceCalls = 0;
        f.client.forms.addSelectOption = async () => {
            choiceCalls++;
            return { newChoice: { id: 'beta', name: 'Beta' } };
        };
        assert.equal(await creator.create('Beta'), true);
        assert.equal(choiceCalls, 1);
        assert.deepEqual(f.fields.field('a').getSnapshot().value, [
            'Alpha',
            'Beta',
        ]);
        assert.equal(f.pages.getSnapshot().status, 'ready');
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(
            f.pages.back(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(f.calls.length, 0);
        f.setConfig(1);
        assert.equal(f.pages.getSnapshot().status, 'retired');
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            false
        );
        assert.deepEqual(f.fields.field('a').getSnapshot().value, [
            'Alpha',
            'Beta',
        ]);
    });
});
describe('multipage Form ownership', () => {
    it('retains full native draft and dirty IDs across Back/Next/remount; explicit final Save only', async () => {
        const f = fixture();
        assert.equal(f.pages.getSnapshot().pages.length, 3);
        const first = f.pages.getSnapshot();
        assert.equal(f.pages.next(first.revision).accepted, true);
        assert.equal(f.calls.length, 0);
        assert.equal(f.fields.field('b').setValue('Changed').accepted, true);
        assert.equal(
            f.pages.back(f.pages.getSnapshot().revision).accepted,
            true
        );
        const remount = f.pages.subscribe(() => {});
        remount();
        assert.equal(f.fields.field('b').getSnapshot().value, 'Changed');
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0]!.formRecord.data, {
            a: 'A',
            b: 'Changed',
            c: 'C',
            untouched: { text: 'native' },
        });
        assert(f.calls[0]!.formFieldIdsWithUnsavedChanges.includes('b'));
        assert(
            f.calls[0]!.formFieldIdsWithUnsavedChanges.includes('untouched')
        );
    });
    it('Back permits invalid current page; Next blocks only current-page required values', () => {
        const f = fixture();
        f.fields.field('b').setValue('');
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            false
        );
        assert.equal(
            f.pages.back(f.pages.getSnapshot().revision).accepted,
            true
        );
        assert.equal(f.calls.length, 0);
    });
    it('raw invalid scalar input advances revision without overwriting native; rejects stale Next', () => {
        const f = fixture();
        f.pages.dispose();
        const loaded = f.loaded;
        const s = loaded.payload.fieldIdsToSchemas.a!;
        s.fieldType = 'number';
        s.airtableField.config = { type: 'number', options: { precision: 0 } };
        loaded.payload.formRecord.data.a = 7;
        const fields = createFormFieldBindings({
            client: f.client,
            loaded,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'numeric', revision: 0 }),
        });
        const p = createFormPageOwner({
            fields,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        const prior = p.getSnapshot().revision;
        assert.equal(fields.field('a').scalar!.setInput('-'), false);
        assert.equal(fields.field('a').getSnapshot().value, 7);
        assert(p.getSnapshot().revision > prior);
        assert.deepEqual(p.next(prior), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert.deepEqual(p.next(p.getSnapshot().revision), {
            accepted: false,
            reason: 'validation',
        });
    });
    for (const inputType of ['number', 'date'] as const) {
        it(`a final ownership check changing raw ${inputType} input cannot advance Next`, () => {
            const native = inputType === 'number' ? 1 : '2024-01-01';
            const f = fixture((loaded) => {
                const schema = loaded.payload.fieldIdsToSchemas.a!;
                if (inputType === 'number') {
                    schema.fieldType = 'number';
                    schema.airtableField.config = {
                        type: 'number',
                        options: { precision: 0 },
                    };
                } else {
                    loaded.payload.fieldIdsToSchemas.a = {
                        fieldType: 'date',
                        airtableField: {
                            id: 'a',
                            name: 'a',
                            description: null,
                            isComputed: false,
                            isPrimaryField: false,
                            config: {
                                type: 'date',
                                options: {
                                    dateFormat: {
                                        name: 'iso',
                                        format: 'YYYY-MM-DD',
                                    },
                                },
                            },
                        },
                        miniExtConfig: { required: true },
                    };
                }
                loaded.payload.formRecord.data.a = native;
            });
            f.pages.dispose();
            let armed = false;
            let checks = 0;
            let edited = false;
            const pages = createFormPageOwner({
                fields: f.fields,
                configurationRevision: () => 0,
                isCurrent: () => {
                    if (armed && ++checks === 2) {
                        edited = true;
                        const field = f.fields.field('a');
                        assert.equal(
                            inputType === 'number'
                                ? field.scalar!.setInput('-')
                                : field.date!.setInput('2024-02-30'),
                            false
                        );
                    }
                    return true;
                },
            });
            const deliveries = [[], []] as {
                revision: number;
                activePageIndex: number;
                canNext: boolean;
                invalidInput: boolean;
            }[][];
            for (const delivered of deliveries)
                pages.subscribe((s) =>
                    delivered.push({
                        revision: s.revision,
                        activePageIndex: s.activePageIndex,
                        canNext: s.canNext,
                        invalidInput: s.problems.some(
                            (p) =>
                                p.fieldId === 'a' && p.code === 'invalid-input'
                        ),
                    })
                );
            const revision = pages.getSnapshot().revision;
            assert.equal(f.fields.controller.getState().draftRevision, 0);
            armed = true;
            assert.equal(pages.next(revision).accepted, false);
            assert.equal(edited, true);
            const current = pages.getSnapshot();
            assert.equal(current.activePageIndex, 0);
            assert.equal(current.canNext, false);
            assert(current.revision > revision);
            assert(
                current.problems.some(
                    (p) => p.fieldId === 'a' && p.code === 'invalid-input'
                )
            );
            for (const delivered of deliveries)
                assert.deepEqual(delivered.at(-1), {
                    revision: current.revision,
                    activePageIndex: 0,
                    canNext: false,
                    invalidInput: true,
                });
            assert.equal(f.fields.field('a').getSnapshot().value, native);
            assert.equal(f.fields.controller.getState().draftRevision, 0);
            assert.equal(f.calls.length, 0);
        });
    }
    for (const inputType of ['number', 'date'] as const) {
        for (const listenerCount of [0, 2]) {
            it(`continuous raw ${inputType} edits return a bounded snapshot with ${listenerCount} subscribers`, () => {
                const native = inputType === 'number' ? 1 : '2024-01-01';
                const f = fixture((loaded) => {
                    const schema = loaded.payload.fieldIdsToSchemas.a!;
                    if (inputType === 'number') {
                        schema.fieldType = 'number';
                        schema.airtableField.config = {
                            type: 'number',
                            options: { precision: 0 },
                        };
                    } else {
                        loaded.payload.fieldIdsToSchemas.a = {
                            fieldType: 'date',
                            airtableField: {
                                id: 'a',
                                name: 'a',
                                description: null,
                                isComputed: false,
                                isPrimaryField: false,
                                config: {
                                    type: 'date',
                                    options: {
                                        dateFormat: {
                                            name: 'iso',
                                            format: 'YYYY-MM-DD',
                                        },
                                    },
                                },
                            },
                            miniExtConfig: { required: true },
                        };
                    }
                    loaded.payload.formRecord.data.a = native;
                });
                f.pages.dispose();
                let armed = false;
                let checks = 0;
                let sentinelReached = false;
                const pages = createFormPageOwner({
                    fields: f.fields,
                    configurationRevision: () => 0,
                    isCurrent: () => {
                        if (armed) {
                            checks++;
                            // Fail closed if a regression repeatedly drains notifications.
                            // A thrown ownership callback terminates the old loop safely.
                            if (checks > 12) {
                                sentinelReached = true;
                                throw Error(
                                    'Unbounded raw-input ownership checks'
                                );
                            }
                            const field = f.fields.field('a');
                            assert.equal(
                                inputType === 'number'
                                    ? field.scalar!.setInput(
                                          checks % 2 ? '-' : '+'
                                      )
                                    : field.date!.setInput(
                                          checks % 2
                                              ? '2024-02-30'
                                              : '2024-02-31'
                                      ),
                                false
                            );
                        }
                        return true;
                    },
                });
                const deliveries = Array.from(
                    { length: listenerCount },
                    () =>
                        [] as {
                            revision: number;
                            canNext: boolean;
                            canSubmit: boolean;
                        }[]
                );
                for (const delivered of deliveries)
                    pages.subscribe((s) =>
                        delivered.push({
                            revision: s.revision,
                            canNext: s.canNext,
                            canSubmit: s.canSubmit,
                        })
                    );
                armed = true;
                const current = pages.getSnapshot();
                assert.equal(sentinelReached, false);
                assert(checks > 0 && checks <= 4);
                assert.equal(current.canNext, false);
                assert.equal(current.canSubmit, false);
                for (const delivered of deliveries) {
                    assert(delivered.length > 0 && delivered.length <= 2);
                    assert.deepEqual(delivered.at(-1), {
                        revision: current.revision,
                        canNext: false,
                        canSubmit: false,
                    });
                }
                checks = 0;
                sentinelReached = false;
                assert.equal(pages.next(current.revision).accepted, false);
                assert.equal(sentinelReached, false);
                assert(checks > 0 && checks <= 4);
                assert.equal(current.activePageIndex, 0);
                for (const delivered of deliveries)
                    assert.equal(delivered.at(-1)?.canNext, false);
                armed = false;
                assert.equal(pages.getSnapshot().activePageIndex, 0);
                assert.equal(f.fields.field('a').getSnapshot().value, native);
                assert.equal(f.fields.controller.getState().draftRevision, 0);
                assert.equal(f.calls.length, 0);
            });
        }
    }
    it('configuration ABA permanently retires; dispose never retires shared bindings', () => {
        const f = fixture();
        const old = f.pages.getSnapshot().revision;
        f.setConfig(1);
        assert.equal(f.pages.getSnapshot().status, 'retired');
        f.setConfig(0);
        assert.deepEqual(f.pages.next(old), {
            accepted: false,
            reason: 'retired',
        });
        assert(f.fields.field('a').setValue('Still owned').accepted);
        f.pages.dispose();
        assert(f.fields.field('a').setValue('After disposal').accepted);
    });
    it('owner replacement retires old page actions without touching successor state', () => {
        const f = fixture();
        const r = f.pages.getSnapshot().revision;
        f.setScope({ ownerId: 'B', revision: 1 });
        assert.equal(f.pages.getSnapshot().status, 'retired');
        f.setScope({ ownerId: 'A', revision: 2 });
        assert.deepEqual(f.pages.next(r), {
            accepted: false,
            reason: 'retired',
        });
        assert.equal(f.calls.length, 0);
    });
    it('rejects configured prepared Review without an adapter', async () => {
        const f = fixture();
        f.pages.dispose();
        f.loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
        const fields = createFormFieldBindings({
            client: f.client,
            loaded: f.loaded,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'review', revision: 0 }),
        });
        const p = createFormPageOwner({
            fields,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        assert.equal(p.getSnapshot().status, 'blocked');
        await assert.rejects(p.submit(p.getSnapshot().revision), FormPageError);
        assert.equal(f.calls.length, 0);
    });
    it('canonical structures preserve leading fields, disabled headers and legacy titles', () => {
        const oracle = JSON.parse(
            readFileSync('test/fixtures/formPages.json', 'utf8')
        );
        for (const c of oracle.structure) {
            const f = fixture((p) => {
                p.payload.fieldIdsInForm = c.fields.map(
                    (v: RuntimeFieldSchema) => v.airtableField.id
                );
                p.payload.fieldIdsToSchemas = Object.fromEntries(
                    c.fields.map((v: RuntimeFieldSchema) => [
                        v.airtableField.id,
                        v,
                    ])
                );
                p.payload.formRecord.data = Object.fromEntries(
                    p.payload.fieldIdsInForm.map((id) => [id, 'value'])
                );
            });
            const expected: string[][] = [];
            let leading: string[] = [];
            for (const group of c.groups) {
                if ('fieldId' in group) leading.push(group.fieldId);
                else {
                    if (leading.length) {
                        expected.push(leading);
                        leading = [];
                    }
                    expected.push(group.fieldIds);
                }
            }
            if (leading.length) expected.push(leading);
            assert.deepEqual(
                f.pages.getSnapshot().pages.map((v) => v.fieldIds),
                expected
            );
            f.pages.dispose();
            f.fields.destroy();
        }
    });
    it('one structural page or one-page mode uses all fields', () => {
        const f = fixture((p) => {
            p.payload.publicFields.state.multiPageFormMode = 'one-page';
        });
        assert.deepEqual(
            f.pages.getSnapshot().pages.map((p) => p.fieldIds),
            [['a', 'b', 'c']]
        );
    });
    it('hidden active page normalizes to first visible without pruning its native data', () => {
        const condition = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'visibility',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'singleLineText',
                        idOrName: { type: 'id', id: 'a' },
                        value: 'A',
                    },
                },
            ],
        };
        const f = fixture((p) => {
            const schema = p.payload.fieldIdsToSchemas.b!;
            schema.miniExtConfig = {
                ...schema.miniExtConfig,
                conditionalFields: condition as never,
            };
        });
        f.pages.next(f.pages.getSnapshot().revision);
        assert.equal(f.pages.getSnapshot().activePageIndex, 1);
        f.fields.field('a').setValue('No');
        assert.equal(f.pages.getSnapshot().activePageIndex, 0);
        assert.equal(f.pages.getSnapshot().pages[1]!.hidden, true);
        assert.equal(f.fields.field('b').getSnapshot().value, 'B');
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
    });
    it('empty/all-hidden forms cannot submit; blocked visibility is not hidden', () => {
        const f = fixture((p) => {
            p.payload.fieldIdsInForm = [];
            p.payload.fieldIdsToSchemas = {};
        });
        assert.equal(f.pages.getSnapshot().status, 'all-hidden');
        assert.equal(f.pages.getSnapshot().canSubmit, false);
        const broken = fixture((p) => {
            p.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'bad',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'multipleRecordLinks',
                                idOrName: { type: 'id', id: 'b' },
                                value: 'rec',
                            },
                        },
                    ],
                } as never,
            };
        });
        assert.equal(broken.pages.getSnapshot().status, 'blocked');
        assert.equal(broken.pages.getSnapshot().pages[0]!.hidden, false);
    });
    it('subscriber replacement retires only the old action, not shared bindings', () => {
        const f = fixture();
        f.pages.subscribe((s) => {
            if (s.activePageIndex === 1) f.setConfig(1);
        });
        assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
            accepted: false,
            reason: 'retired',
        });
        assert(f.fields.field('a').setValue('Live draft').accepted);
    });
    it('subscriber native edit supersedes navigation without discarding the edit', () => {
        const f = fixture();
        let once = false;
        f.pages.subscribe((s) => {
            if (s.activePageIndex === 1 && !once) {
                once = true;
                f.fields.field('b').setValue('Reentered');
            }
        });
        assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert.equal(f.fields.field('b').getSnapshot().value, 'Reentered');
    });
    it('all subscribers converge after a native edit during Next notification', () => {
        const f = fixture();
        const first: { revision: number; canNext: boolean }[] = [];
        const second: { revision: number; canNext: boolean }[] = [];
        let edited = false;
        f.pages.subscribe((s) => {
            first.push({ revision: s.revision, canNext: s.canNext });
            if (s.activePageIndex === 1 && !edited) {
                edited = true;
                assert.equal(f.fields.field('b').setValue('').accepted, true);
            }
        });
        f.pages.subscribe((s) => {
            second.push({ revision: s.revision, canNext: s.canNext });
        });
        assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
            accepted: false,
            reason: 'stale-revision',
        });
        const current = f.pages.getSnapshot();
        assert.equal(current.revision, 3);
        assert.equal(current.canNext, false);
        assert.deepEqual(first[0], { revision: 2, canNext: true });
        assert.deepEqual(first.at(-1), { revision: 3, canNext: false });
        assert.deepEqual(second.at(-1), { revision: 3, canNext: false });
        assert.equal(f.fields.field('b').getSnapshot().value, '');
        assert.equal(f.calls.length, 0);
    });

    it('an earlier field subscriber reading pages cannot consume the edit notification', () => {
        const f = fixture();
        f.pages.dispose();
        let pages: ReturnType<typeof createFormPageOwner> | undefined;
        const reads: number[] = [];
        f.fields.field('a').subscribe(() => {
            if (pages) reads.push(pages.getSnapshot().revision);
        });
        pages = createFormPageOwner({
            fields: f.fields,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        const delivered: number[] = [];
        pages.subscribe((s) => delivered.push(s.revision));
        const before = pages.getSnapshot().revision;
        assert.equal(f.fields.field('a').setValue('').accepted, true);
        const current = pages.getSnapshot();
        assert.equal(current.revision, before + 1);
        assert.equal(current.canNext, false);
        assert.equal(reads.at(-1), current.revision);
        assert.deepEqual(delivered, [current.revision]);
        assert.equal(f.calls.length, 0);
    });

    it('a snapshot read publishes a native edit made by its ownership callback', () => {
        const f = fixture();
        f.pages.dispose();
        let armed = false;
        let edited = false;
        const pages = createFormPageOwner({
            fields: f.fields,
            configurationRevision: () => 0,
            isCurrent: () => {
                if (armed && !edited) {
                    edited = true;
                    assert.equal(f.fields.controller.write('a', ''), true);
                }
                return true;
            },
        });
        const delivered: number[] = [];
        pages.subscribe((s) => delivered.push(s.revision));
        const before = pages.getSnapshot().revision;
        armed = true;
        const current = pages.getSnapshot();
        assert.equal(edited, true);
        assert(current.revision > before);
        assert.equal(current.canNext, false);
        assert.equal(delivered.at(-1), current.revision);
        assert.equal(f.fields.field('a').getSnapshot().value, '');
        assert.equal(f.calls.length, 0);
    });

    for (const listenerCount of [0, 2]) {
        it(`an ownership callback that always edits returns a bounded busy snapshot with ${listenerCount} subscribers`, () => {
            const f = fixture();
            f.pages.dispose();
            let armed = false;
            let checks = 0;
            const pages = createFormPageOwner({
                fields: f.fields,
                configurationRevision: () => 0,
                isCurrent: () => {
                    if (armed) {
                        checks++;
                        assert.equal(
                            f.fields.controller.write('a', `Edited ${checks}`),
                            true
                        );
                    }
                    return true;
                },
            });
            const deliveries = Array.from(
                { length: listenerCount },
                () =>
                    [] as {
                        revision: number;
                        canNext: boolean;
                        canSubmit: boolean;
                    }[]
            );
            for (const delivered of deliveries)
                pages.subscribe((s) =>
                    delivered.push({
                        revision: s.revision,
                        canNext: s.canNext,
                        canSubmit: s.canSubmit,
                    })
                );
            armed = true;
            const current = pages.getSnapshot();
            assert(checks > 0 && checks <= 4);
            assert.equal(current.canNext, false);
            assert.equal(current.canSubmit, false);
            for (const delivered of deliveries)
                assert.deepEqual(delivered.at(-1), {
                    revision: current.revision,
                    canNext: false,
                    canSubmit: false,
                });
            assert.equal(
                f.fields.field('a').getSnapshot().value,
                `Edited ${checks}`
            );
            assert.equal(f.calls.length, 0);

            // An explicit later read can validate once the callback stops editing.
            armed = false;
            const recovered = pages.getSnapshot();
            assert.equal(recovered.canNext, true);
            assert.equal(recovered.canSubmit, false);
            assert(recovered.revision > current.revision);
            assert.equal(f.calls.length, 0);
        });
    }

    it('all subscribers converge when an unstable notification explicitly reads a recovered snapshot', () => {
        const f = fixture();
        f.pages.dispose();
        let armed = false;
        let checks = 0;
        const pages = createFormPageOwner({
            fields: f.fields,
            configurationRevision: () => 0,
            isCurrent: () => {
                if (armed) {
                    checks++;
                    assert.equal(
                        f.fields.controller.write('a', `Edited ${checks}`),
                        true
                    );
                }
                return true;
            },
        });
        const first: { revision: number; canNext: boolean }[] = [];
        const second: { revision: number; canNext: boolean }[] = [];
        let recoveredRevision: number | undefined;
        pages.subscribe((s) => {
            first.push({ revision: s.revision, canNext: s.canNext });
            if (armed) {
                armed = false;
                const recovered = pages.getSnapshot();
                assert.equal(recovered.canNext, true);
                recoveredRevision = recovered.revision;
            }
        });
        pages.subscribe((s) => {
            second.push({ revision: s.revision, canNext: s.canNext });
        });
        const before = pages.getSnapshot().revision;
        armed = true;
        const current = pages.getSnapshot();
        assert(checks > 0 && checks <= 4);
        assert.deepEqual(first[0], { revision: before + 1, canNext: false });
        assert.equal(current.revision, recoveredRevision);
        assert.equal(current.revision, before + 2);
        assert.equal(current.canNext, true);
        assert.equal(current.canSubmit, false);
        assert.deepEqual(first.at(-1), {
            revision: current.revision,
            canNext: true,
        });
        assert.deepEqual(second.at(-1), {
            revision: current.revision,
            canNext: true,
        });
        assert.equal(f.calls.length, 0);
    });

    it('an owner callback edit during final sync ownership validation cannot save an invalid earlier page', async () => {
        const f = fixture();
        f.pages.dispose();
        let armed = false;
        let checks = 0;
        let edited = false;
        const pages = createFormPageOwner({
            fields: f.fields,
            configurationRevision: () => 0,
            isCurrent: () => {
                // The second ownership check follows validation of the captured draft.
                if (armed && ++checks === 2) {
                    edited = true;
                    assert.equal(f.fields.controller.write('a', ''), true);
                }
                return true;
            },
        });
        while (pages.getSnapshot().canNext)
            assert.equal(
                pages.next(pages.getSnapshot().revision).accepted,
                true
            );
        const revision = pages.getSnapshot().revision;
        assert.equal(pages.getSnapshot().canSubmit, true);
        armed = true;
        await assert.rejects(pages.submit(revision));
        assert.equal(edited, true);
        assert.equal(f.fields.field('a').getSnapshot().value, '');
        assert.equal(pages.getSnapshot().canSubmit, false);
        assert.equal(f.calls.length, 0);
    });
    it('all-hidden pages expose no submit and retain every native value', () => {
        const f = fixture((p) => {
            for (const schema of Object.values(p.payload.fieldIdsToSchemas)) {
                schema.miniExtConfig = {
                    ...schema.miniExtConfig,
                    conditionalFields: {
                        logicalOperator: 'and',
                        conditions: [
                            {
                                id: 'hidden',
                                type: 'singleCondition',
                                setting: {
                                    type: 'is',
                                    fieldType: 'singleLineText',
                                    idOrName: { type: 'id', id: 'a' },
                                    value: 'never',
                                },
                            },
                        ],
                    },
                } as never;
            }
        });
        assert.equal(f.pages.getSnapshot().status, 'all-hidden');
        assert.equal(f.pages.getSnapshot().canSubmit, false);
        assert.equal(f.fields.field('b').getSnapshot().value, 'B');
        assert.equal(f.calls.length, 0);
    });
    it('raw date input revision rejects a retained Next while preserving the last native date', () => {
        const f = fixture((p) => {
            p.payload.fieldIdsToSchemas.a = {
                fieldType: 'date',
                airtableField: {
                    id: 'a',
                    name: 'a',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: 'date',
                        options: {
                            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                        },
                    },
                },
                miniExtConfig: {},
            };
            p.payload.formRecord.data.a = '2024-01-01';
        });
        const before = f.pages.getSnapshot().revision;
        assert.equal(f.fields.field('a').date!.setInput('2024-02-30'), false);
        assert.equal(f.fields.field('a').getSnapshot().value, '2024-01-01');
        assert(f.pages.getSnapshot().revision > before);
        assert.deepEqual(f.pages.next(before), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
            accepted: false,
            reason: 'validation',
        });
    });
    it('observed session ABA retires old actions permanently', () => {
        const f = fixture();
        const before = f.pages.getSnapshot().revision;
        f.client.setSession({ visitor: 'B' });
        assert.equal(f.pages.getSnapshot().status, 'retired');
        f.client.setSession({ visitor: 'A' });
        assert.deepEqual(f.pages.next(before), {
            accepted: false,
            reason: 'retired',
        });
        assert.equal(f.calls.length, 0);
    });
    it('controller replacement preserves successor draft when retained page actions run', () => {
        const f = fixture();
        const successor = structuredClone(f.loaded);
        successor.payload.formRecord.data.a = 'Successor';
        f.fields.controller.reset({
            client: f.client,
            loaded: successor,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'B', revision: 1 }),
        });
        assert.equal(f.pages.getSnapshot().status, 'retired');
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            false
        );
        assert.equal(f.fields.controller.getState().draft?.data.a, 'Successor');
    });
    it('effective advanced validation and linked review tracking block explicitly', () => {
        const f = fixture((p) => {
            p.payload.fieldIdsToSchemas.a!.miniExtConfig = {
                fieldValidationConditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'advanced',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'a' },
                                value: 'A',
                            },
                        },
                    ],
                },
            } as never;
        });
        assert.equal(f.pages.getSnapshot().status, 'blocked');
        assert(
            f.pages
                .getSnapshot()
                .problems.some((p) => p.code === 'unsupported-validation')
        );
        const readonly = fixture((p) => {
            p.payload.fieldIdsToSchemas.a!.miniExtConfig = {
                readOnly: true,
                fieldValidationConditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'advanced',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'a' },
                                value: 'A',
                            },
                        },
                    ],
                },
            } as never;
        });
        assert.equal(readonly.pages.getSnapshot().status, 'ready');
    });
});

type ReviewAdapter = NonNullable<FormPageOwnerOptions['review']>;
type ReviewDecision = Awaited<ReturnType<ReviewAdapter>>;
const reviewFixture = (
    review: ReviewAdapter,
    configure: (loaded: FormLoadedResult) => void = () => {}
) => {
    const f = fixture((loaded) => {
        loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
        configure(loaded);
    });
    f.pages.dispose();
    let current = true;
    let configuration = 0;
    const pages = createFormPageOwner({
        fields: f.fields,
        review,
        isCurrent: () => current,
        configurationRevision: () => configuration,
    });
    return {
        ...f,
        pages,
        retire: () => {
            current = false;
        },
        configureRevision: (value: number) => {
            configuration = value;
        },
    };
};
const reviewLastPage = (f: ReturnType<typeof reviewFixture>) => {
    while (f.pages.getSnapshot().canNext)
        assert.equal(
            f.pages.next(f.pages.getSnapshot().revision).accepted,
            true
        );
    assert.equal(f.pages.getSnapshot().activePageIndex, 2);
    assert.equal(f.pages.getSnapshot().canReview, true);
};
describe('configured multipage Review authority', () => {
    it('Edit receives detached complete answers and performs no lifecycle or Save', async () => {
        let captured!: Parameters<ReviewAdapter>[0];
        const f = reviewFixture(async (request) => {
            captured = request;
            assert.equal(request.isCurrent(), true);
            request.draft.data.a = 'Presentation-only mutation';
            request.loaded.payload.formRecord.data.b =
                'Detached loaded mutation';
            return { type: 'edit' };
        });
        reviewLastPage(f);
        let lifecycle = 0;
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch() {
                        lifecycle++;
                        return { accepted() {}, finish() {} };
                    },
                },
            }),
            (error: unknown) =>
                error instanceof FormPageError &&
                error.reason === 'review-cancelled'
        );
        assert.deepEqual(captured.draft.data.untouched, { text: 'native' });
        assert.equal(f.fields.field('a').getSnapshot().value, 'A');
        assert.equal(f.loaded.payload.formRecord.data.b, 'B');
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        assert.equal(f.pages.getSnapshot().reviewing, false);
        assert.equal(f.pages.getSnapshot().canReview, true);
        assert.equal(lifecycle, 0);
        assert.equal(f.calls.length, 0);
    });

    it('one current Confirm preserves the native envelope and delegates once', async () => {
        let reviews = 0;
        const f = reviewFixture(async () => {
            reviews++;
            return { type: 'confirm', isCurrent: () => true };
        });
        reviewLastPage(f);
        let lifecycle = 0;
        await f.pages.submit(f.pages.getSnapshot().revision, {
            lifecycle: {
                dispatch() {
                    lifecycle++;
                    return { accepted() {}, finish() {} };
                },
            },
        });
        assert.equal(reviews, 1);
        assert.equal(lifecycle, 1);
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0]!.formRecord.data, {
            a: 'A',
            b: 'B',
            c: 'C',
            untouched: { text: 'native' },
        });
        assert(
            f.calls[0]!.formFieldIdsWithUnsavedChanges.includes('untouched')
        );
    });

    for (const invalidField of ['a', 'c']) {
        it(`ordinary required error on ${invalidField} allows Review but Confirm validates all pages before dispatch`, async () => {
            let reviews = 0;
            const f = reviewFixture(async () => {
                reviews++;
                return { type: 'confirm', isCurrent: () => true };
            });
            reviewLastPage(f);
            assert.equal(
                f.fields.field(invalidField).setValue('').accepted,
                true
            );
            assert.equal(f.pages.getSnapshot().canReview, true);
            let lifecycle = 0;
            await assert.rejects(
                f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: {
                        dispatch() {
                            lifecycle++;
                            return { accepted() {}, finish() {} };
                        },
                    },
                })
            );
            assert.equal(reviews, 1);
            assert.equal(lifecycle, 0);
            assert.equal(f.calls.length, 0);
            assert.equal(f.pages.getSnapshot().activePageIndex, 2);
            assert.equal(f.fields.field(invalidField).getSnapshot().value, '');
        });
    }

    it('a character limit allows Review but prevents Confirm transport', async () => {
        let reviews = 0;
        const f = reviewFixture(
            async () => {
                reviews++;
                return { type: 'confirm', isCurrent: () => true };
            },
            (loaded) => {
                loaded.payload.fieldIdsToSchemas.a!.miniExtConfig = {
                    required: true,
                    characterLimit: 1,
                };
            }
        );
        reviewLastPage(f);
        assert.equal(f.fields.field('a').setValue('Too long').accepted, true);
        assert.equal(f.pages.getSnapshot().canReview, true);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(reviews, 1);
        assert.equal(f.calls.length, 0);
    });

    it('a caller abort ends held Review without waiting for the adapter decision', async () => {
        const held = deferred<ReviewDecision>();
        let request!: Parameters<ReviewAdapter>[0];
        const f = reviewFixture((value) => {
            request = value;
            return held.promise;
        });
        reviewLastPage(f);
        const abort = new AbortController();
        const saving = f.pages.submit(f.pages.getSnapshot().revision, {
            signal: abort.signal,
        });
        await Promise.resolve();
        abort.abort();
        await assert.rejects(
            saving,
            (error: unknown) =>
                error instanceof FormPageError &&
                error.reason === 'review-cancelled'
        );
        assert.equal(request.signal.aborted, true);
        assert.equal(f.pages.getSnapshot().reviewing, false);
        assert.equal(f.calls.length, 0);
        held.resolve({ type: 'confirm', isCurrent: () => true });
    });

    it('held Review is single flight and refuses Next, Back and another Submit', async () => {
        const held = deferred<ReviewDecision>();
        let reviews = 0;
        const f = reviewFixture(() => {
            reviews++;
            return held.promise;
        });
        reviewLastPage(f);
        const saving = f.pages.submit(f.pages.getSnapshot().revision);
        await Promise.resolve();
        const during = f.pages.getSnapshot();
        assert.equal(during.reviewing, true);
        assert.equal(during.canReview, false);
        assert.equal(during.canNext, false);
        assert.equal(during.canBack, false);
        assert.equal(during.canSubmit, false);
        assert.equal(f.pages.next(during.revision).accepted, false);
        assert.equal(f.pages.back(during.revision).accepted, false);
        await assert.rejects(f.pages.submit(during.revision));
        assert.equal(reviews, 1);
        assert.equal(f.calls.length, 0);
        held.resolve({ type: 'edit' });
        await assert.rejects(saving);
        assert.equal(f.pages.getSnapshot().reviewing, false);
    });

    for (const replacement of [
        'draft-ABA',
        'configuration',
        'owner',
    ] as const) {
        it(`held Confirm is invalidated by ${replacement}`, async () => {
            const held = deferred<ReviewDecision>();
            let request!: Parameters<ReviewAdapter>[0];
            const f = reviewFixture((value) => {
                request = value;
                return held.promise;
            });
            reviewLastPage(f);
            const saving = f.pages.submit(f.pages.getSnapshot().revision);
            await Promise.resolve();
            if (replacement === 'draft-ABA') {
                assert.equal(f.fields.controller.write('a', 'Changed'), true);
                assert.equal(f.fields.controller.write('a', 'A'), true);
            } else if (replacement === 'configuration') f.configureRevision(1);
            else f.retire();
            assert.equal(request.isCurrent(), false);
            held.resolve({ type: 'confirm', isCurrent: () => true });
            await assert.rejects(saving);
            assert.equal(f.calls.length, 0);
        });
    }

    it('a reentrant confirmation presentation predicate cannot save a newer draft', async () => {
        let changed = false;
        const f = reviewFixture(async () => ({
            type: 'confirm',
            isCurrent: () => {
                if (!changed) {
                    changed = true;
                    assert.equal(f.fields.controller.write('a', ''), true);
                }
                return true;
            },
        }));
        reviewLastPage(f);
        let lifecycle = 0;
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch() {
                        lifecycle++;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(changed, true);
        assert.equal(f.fields.field('a').getSnapshot().value, '');
        assert.equal(lifecycle, 0);
        assert.equal(f.calls.length, 0);
    });

    for (const stage of ['before-review', 'held-review'] as const) {
        it(`invalid raw input ${stage} blocks Confirm without changing native data`, async () => {
            const held = deferred<ReviewDecision>();
            let reviews = 0;
            const f = reviewFixture(
                () => {
                    reviews++;
                    return held.promise;
                },
                (loaded) => {
                    const schema = loaded.payload.fieldIdsToSchemas.a!;
                    schema.fieldType = 'number';
                    schema.airtableField.config = {
                        type: 'number',
                        options: { precision: 0 },
                    };
                    loaded.payload.formRecord.data.a = 1;
                }
            );
            reviewLastPage(f);
            const revision = f.pages.getSnapshot().revision;
            let saving: ReturnType<typeof f.pages.submit>;
            if (stage === 'held-review') {
                saving = f.pages.submit(revision);
                await Promise.resolve();
            }
            assert.equal(f.fields.field('a').scalar!.setInput('-'), false);
            assert.equal(f.fields.controller.getState().draftRevision, 0);
            if (stage === 'before-review') {
                assert.equal(f.pages.getSnapshot().canReview, false);
                saving = f.pages.submit(f.pages.getSnapshot().revision);
            } else held.resolve({ type: 'confirm', isCurrent: () => true });
            await assert.rejects(saving!);
            assert.equal(reviews, stage === 'before-review' ? 0 : 1);
            assert.equal(f.fields.field('a').getSnapshot().value, 1);
            assert.equal(f.calls.length, 0);
        });
    }

    for (const stage of ['before-review', 'held-review'] as const) {
        it(`a queued attachment ${stage} refuses Review transport and clearing restores admission`, async () => {
            const held = deferred<ReviewDecision>();
            let reviews = 0;
            const f = reviewFixture(
                () => {
                    reviews++;
                    return stage === 'held-review' && reviews === 1
                        ? held.promise
                        : Promise.resolve({ type: 'edit' });
                },
                (loaded) => {
                    const attachment = structuredClone(
                        loadedForm().payload.fieldIdsToSchemas.fld_files!
                    );
                    attachment.airtableField.id = 'b';
                    attachment.airtableField.name = 'b';
                    attachment.miniExtConfig = { headerSectionTitle: 'Second' };
                    loaded.payload.fieldIdsToSchemas.b = attachment;
                    loaded.payload.formRecord.data.b = [];
                }
            );
            const journal = new RecoveryJournal();
            const scope = {
                owner: 'A',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal' as const,
            };
            let journalAttempts = 0;
            const begin = journal.begin.bind(journal);
            journal.begin = (...args: Parameters<typeof journal.begin>) => {
                journalAttempts++;
                return begin(...args);
            };
            const attachment = f.fields.attachment('b', {
                journal,
                scope,
                loadVersion: 1,
            });
            let uploads = 0;
            f.client.attachments.uploadFile = async () => {
                uploads++;
                throw Error('Queued selection must not upload implicitly');
            };
            reviewLastPage(f);
            let saving: ReturnType<typeof f.pages.submit> | undefined;
            const lifecycle = {
                dispatch() {
                    journal.begin(scope, null, 'save', 1);
                    return { accepted() {}, finish() {} };
                },
            };
            if (stage === 'held-review') {
                saving = f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle,
                });
                await Promise.resolve();
            }
            const selected = new File(['queued'], 'queued.txt', {
                type: 'text/plain',
            }) as unknown as globalThis.File;
            assert.equal(attachment.select([selected]), true);
            assert.equal(f.fields.hasPendingFiles(), true);
            assert.equal(f.fields.controller.getState().draftRevision, 0);
            assert.equal(f.pages.getSnapshot().canReview, false);
            if (stage === 'held-review') {
                held.resolve({ type: 'confirm', isCurrent: () => true });
                await assert.rejects(saving!);
            } else {
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle,
                    })
                );
                assert.equal(reviews, 0);
            }
            assert.equal(journalAttempts, 0);
            assert.equal(journal.unknown('A').length, 0);
            assert.equal(uploads, 0);
            assert.equal(f.calls.length, 0);
            assert.deepEqual(f.fields.field('b').getSnapshot().value, []);

            attachment.clear();
            assert.equal(f.fields.hasPendingFiles(), false);
            assert.equal(f.pages.getSnapshot().canReview, true);
            await assert.rejects(
                f.pages.submit(f.pages.getSnapshot().revision, { lifecycle }),
                (error: unknown) =>
                    error instanceof FormPageError &&
                    error.reason === 'review-cancelled'
            );
            assert.equal(reviews, stage === 'held-review' ? 2 : 1);
            assert.equal(journalAttempts, 0);
            assert.equal(uploads, 0);
            assert.equal(f.calls.length, 0);
        });
    }

    it('pending reload blocks Review without invoking the adapter', async () => {
        let reviews = 0;
        const f = reviewFixture(async () => {
            reviews++;
            return { type: 'edit' };
        });
        reviewLastPage(f);
        const held = deferred<FormLoadedResult>();
        const loading = f.fields.reload({
            dirty: 'keep',
            read: () => held.promise,
        });
        assert.equal(f.pages.getSnapshot().canReview, false);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(reviews, 0);
        assert.equal(f.calls.length, 0);
        held.resolve(structuredClone(f.loaded));
        await loading;
    });

    for (const mode of [
        'compute',
        'automatic',
        'unsupported-validation',
    ] as const) {
        it(`${mode} is not admitted by supplying a Review adapter`, async () => {
            let reviews = 0;
            const f = reviewFixture(
                async () => {
                    reviews++;
                    return { type: 'edit' };
                },
                (loaded) => {
                    if (mode === 'compute')
                        loaded.payload.publicFields.state.enableFormComputeMode = true;
                    else if (mode === 'automatic')
                        loaded.payload.publicFields.state.autoSubmitAfterPrefill = true;
                    else
                        loaded.payload.fieldIdsToSchemas.a!.miniExtConfig = {
                            required: true,
                            requireOpenLinkedRecords: true,
                        } as never;
                }
            );
            const snapshot = f.pages.getSnapshot();
            assert.equal(snapshot.canReview, false);
            assert.equal(f.pages.next(snapshot.revision).accepted, false);
            await assert.rejects(
                f.pages.submit(f.pages.getSnapshot().revision)
            );
            assert.equal(reviews, 0);
            assert.equal(f.calls.length, 0);
        });
    }

    it('a continuously mutating confirmation predicate refuses in bounded work', async () => {
        let checks = 0;
        let sentinelReached = false;
        const f = reviewFixture(async () => ({
            type: 'confirm',
            isCurrent: () => {
                checks++;
                if (checks > 12) {
                    sentinelReached = true;
                    throw Error('Unbounded Review ownership predicate');
                }
                assert.equal(
                    f.fields.controller.write('a', `Changed ${checks}`),
                    true
                );
                return true;
            },
        }));
        reviewLastPage(f);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(sentinelReached, false);
        assert(checks > 0 && checks <= 4);
        assert.equal(f.calls.length, 0);
        assert.equal(f.pages.getSnapshot().reviewing, false);
    });

    it('an unknown confirmed Save cannot reopen Review or replay transport', async () => {
        let reviews = 0;
        const f = reviewFixture(async () => {
            reviews++;
            return { type: 'confirm', isCurrent: () => true };
        });
        reviewLastPage(f);
        const held = deferred<ReturnType<typeof invalidForm>>();
        const dispatched = deferred<void>();
        f.client.forms.save = (input) => {
            f.calls.push(input);
            dispatched.resolve();
            return held.promise;
        };
        const saving = f.pages.submit(f.pages.getSnapshot().revision);
        const rejected = assert.rejects(saving);
        await dispatched.promise;
        f.fields.controller.cancel();
        held.reject(Error('Unknown confirmed Save outcome'));
        await rejected;
        assert.equal(f.pages.getSnapshot().canReview, false);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(reviews, 1);
        assert.equal(f.calls.length, 1);
    });

    it('adapter failure restores only the current review gate without lifecycle work', async () => {
        const f = reviewFixture(async () => {
            throw Error('Synthetic dialog failed');
        });
        reviewLastPage(f);
        let lifecycle = 0;
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch() {
                        lifecycle++;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(f.pages.getSnapshot().reviewing, false);
        assert.equal(f.pages.getSnapshot().canReview, true);
        assert.equal(lifecycle, 0);
        assert.equal(f.calls.length, 0);
    });

    for (const change of ['raw-input', 'configuration', 'owner'] as const) {
        it(`a reentrant presentation check changing ${change} cannot dispatch Confirm`, async () => {
            let changed = false;
            const f = reviewFixture(
                async () => ({
                    type: 'confirm',
                    isCurrent: () => {
                        if (!changed) {
                            changed = true;
                            if (change === 'raw-input')
                                assert.equal(
                                    f.fields.field('a').scalar!.setInput('-'),
                                    false
                                );
                            else if (change === 'configuration')
                                f.configureRevision(1);
                            else f.retire();
                        }
                        return true;
                    },
                }),
                (loaded) => {
                    const schema = loaded.payload.fieldIdsToSchemas.a!;
                    schema.fieldType = 'number';
                    schema.airtableField.config = {
                        type: 'number',
                        options: { precision: 0 },
                    };
                    loaded.payload.formRecord.data.a = 1;
                }
            );
            reviewLastPage(f);
            let lifecycle = 0;
            await assert.rejects(
                f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: {
                        dispatch() {
                            lifecycle++;
                            return { accepted() {}, finish() {} };
                        },
                    },
                })
            );
            assert.equal(changed, true);
            assert.equal(f.fields.controller.getState().draftRevision, 0);
            assert.equal(f.fields.field('a').getSnapshot().value, 1);
            assert.equal(lifecycle, 0);
            assert.equal(f.calls.length, 0);
        });
    }

    for (const fence of ['not-current', 'raw-input-change'] as const) {
        it(`a caller Save fence ${fence} refuses before opening Review`, async () => {
            let reviews = 0;
            const f = reviewFixture(
                async () => {
                    reviews++;
                    return { type: 'confirm', isCurrent: () => true };
                },
                (loaded) => {
                    const schema = loaded.payload.fieldIdsToSchemas.a!;
                    schema.fieldType = 'number';
                    schema.airtableField.config = {
                        type: 'number',
                        options: { precision: 0 },
                    };
                    loaded.payload.formRecord.data.a = 1;
                }
            );
            reviewLastPage(f);
            let checks = 0;
            let lifecycle = 0;
            await assert.rejects(
                f.pages.submit(f.pages.getSnapshot().revision, {
                    isCurrent: () => {
                        checks++;
                        if (fence === 'not-current') return false;
                        if (checks === 1)
                            assert.equal(
                                f.fields.field('a').scalar!.setInput('-'),
                                false
                            );
                        return true;
                    },
                    lifecycle: {
                        dispatch() {
                            lifecycle++;
                            return { accepted() {}, finish() {} };
                        },
                    },
                })
            );
            assert(checks > 0 && checks <= 4);
            assert.equal(reviews, 0);
            assert.equal(lifecycle, 0);
            assert.equal(f.calls.length, 0);
            assert.equal(f.fields.field('a').getSnapshot().value, 1);
            assert.equal(f.fields.controller.getState().draftRevision, 0);
            assert.equal(f.pages.getSnapshot().reviewing, false);
        });
    }

    it('a stale presentation decision never dispatches', async () => {
        const f = reviewFixture(async () => ({
            type: 'confirm',
            isCurrent: () => false,
        }));
        reviewLastPage(f);
        await assert.rejects(f.pages.submit(f.pages.getSnapshot().revision));
        assert.equal(f.calls.length, 0);
    });

    it('disposal aborts held Review and its cleanup cannot change a successor owner', async () => {
        const held = deferred<ReviewDecision>();
        let request!: Parameters<ReviewAdapter>[0];
        const f = reviewFixture((value) => {
            request = value;
            return held.promise;
        });
        reviewLastPage(f);
        const saving = f.pages.submit(f.pages.getSnapshot().revision);
        await Promise.resolve();
        f.pages.dispose();
        assert.equal(request.signal.aborted, true);
        const successor = createFormPageOwner({
            fields: f.fields,
            review: async () => ({ type: 'edit' }),
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        const before = successor.getSnapshot();
        held.resolve({ type: 'confirm', isCurrent: () => true });
        await assert.rejects(saving);
        assert.deepEqual(successor.getSnapshot(), before);
        assert.equal(
            f.fields.field('a').setValue('Successor edit').accepted,
            true
        );
        assert.equal(f.calls.length, 0);
    });
});
