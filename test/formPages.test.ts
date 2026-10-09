import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { createFormPageOwner, FormPageError } from '../src/forms/pages.js';
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
    it('rejects configured prepared Review without bypassing it', async () => {
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
