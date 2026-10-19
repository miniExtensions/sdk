import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { File } from 'node:buffer';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import type {
    FormPageOwnerOptions,
    FormPageReviewDecision,
    FormPageReviewRequest,
} from '../src/forms/pages.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    FormLoadedResult,
    LoadExtensionInput,
    SaveFormInput,
    SaveFormResult,
} from '../src/runtime/types.js';
import { formSaveOptions, loadedForm } from './formsFixtures.js';
import {
    childForm,
    childSaved,
    pagedChildForm,
    parentForm,
    validationError,
} from './formLinkedChildFixtures.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};
const setup = (
    edit = false,
    options: {
        loaded?: FormLoadedResult;
        save?: () => Promise<SaveFormResult>;
        review?: FormPageOwnerOptions['review'];
    } = {}
) => {
    const loaded =
        options.loaded ?? pagedChildForm(edit ? 'rec_existing' : undefined);
    loaded.payload.fieldNamesToSchemas = Object.fromEntries(
        Object.values(loaded.payload.fieldIdsToSchemas).map((schema) => [
            schema.airtableField.name,
            structuredClone(schema),
        ])
    );
    const parent = parentForm('edit');
    const calls = {
        loads: [] as LoadExtensionInput[],
        saves: [] as SaveFormInput[],
        reads: 0,
        begins: 0,
    };
    class Journal extends RecoveryJournal {
        override begin(...args: Parameters<RecoveryJournal['begin']>) {
            calls.begins++;
            return super.begin(...args);
        }
    }
    const journal = new Journal();
    let scope = { ownerId: 'synthetic-owner', revision: 0 };
    let configuration = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-A' },
        fetch: async () => {
            throw Error('No I/O');
        },
    });
    client.loadExtension = async (input) => {
        calls.loads.push(structuredClone(input));
        return structuredClone(loaded);
    };
    client.linkedRecords.loadSelectedRecords = async () => {
        calls.reads++;
        return {
            tbl_child: {
                airtableFields: [
                    parent.payload.fieldIdsToSchemas.fld_title!.airtableField,
                ],
                recordIdsToAirtableRecords: Object.fromEntries(
                    ['rec_existing', 'rec_sibling'].map((id) => [
                        id,
                        { id, fields: { fld_title: id } },
                    ])
                ),
            },
        };
    };
    client.forms.save = async (input) => {
        calls.saves.push(structuredClone(input));
        if (options.save) return options.save();
        const result = childSaved('edit');
        result.record = {
            id: edit ? 'rec_existing' : 'rec_created',
            fields: structuredClone(input.formRecord.data),
        };
        return result;
    };
    const fields = createFormFieldBindings({
        loaded: parent,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => scope,
        configurationRevision: () => configuration,
    });
    const owner = fields.linkedChild('fld_children_a', {
        journal,
        loadVersion: 1,
        review: options.review,
    });
    const open = async () => {
        if (edit) {
            await fields.linkedRecords('fld_children_a').readSelected();
            return owner.openEdit('rec_existing', owner.getSnapshot().revision);
        }
        return owner.openCreate();
    };
    const ready = () => {
        const s = owner.getSnapshot();
        assert.ok(s.child);
        assert.ok(s.pages);
        return { ...s, child: s.child, pages: s.pages };
    };
    const advance = () => {
        const s = ready();
        const page = s.pages.getSnapshot();
        return s.pages.next(page.revision);
    };
    const final = () => {
        while (ready().pages.getSnapshot().canNext)
            assert.equal(advance().accepted, true);
    };
    const save = () => owner.save(owner.getSnapshot().revision);
    return {
        loaded,
        fields,
        owner,
        journal,
        client,
        calls,
        open,
        ready,
        advance,
        final,
        save,
        changeConfiguration: () => {
            configuration++;
            fields.refresh();
        },
        replaceOwner: () => {
            scope = { ownerId: 'synthetic-B', revision: 1 };
            fields.refresh();
        },
        close: () => {
            owner.close();
            fields.destroy();
        },
    };
};

describe('owned linked child manual pages', () => {
    for (const edit of [false, true]) {
        it(`${edit ? 'Edit' : 'Create'} navigates locally and saves the complete native child exactly once`, async () => {
            const f = setup(edit);
            try {
                assert.equal(f.calls.loads.length, 0);
                assert.equal(await f.open(), true);
                const s = f.ready();
                assert.equal(s.pages.getSnapshot().pages.length, 3);
                assert.equal(s.pages.getSnapshot().canSubmit, false);
                const before = structuredClone(
                    f.fields.controller.getState().draft!.data
                );
                await assert.rejects(f.save(), /Complete the child Form/);
                assert.equal(f.calls.begins, 0);
                assert.equal(
                    s.child.field('fld_title').setValue('Edited first answer')
                        .accepted,
                    true
                );
                assert.equal(f.advance().accepted, true);
                assert.equal(
                    s.child.field('fld_note').setValue('Edited second answer')
                        .accepted,
                    true
                );
                f.final();
                assert.equal(f.calls.loads.length, 1);
                assert.equal(f.calls.saves.length, 0);
                assert.equal(f.calls.begins, 0);
                const expected = structuredClone(
                    s.child.controller.getState().draft!.data
                );
                assert.equal((await f.save()).type, 'saved');
                assert.equal(f.calls.saves.length, 1);
                assert.equal(f.calls.begins, 1);
                assert.equal(
                    f.calls.saves[0]!.formRecord.type,
                    edit ? 'edit' : 'create'
                );
                assert.deepEqual(f.calls.saves[0]!.formRecord.data, expected);
                assert.equal(f.calls.saves[0]!.isComputeMode, false);
                assert.equal(f.calls.saves[0]!.context.type, 'modal');
                assert.deepEqual(
                    f.fields.controller.getState().draft!.data.fld_children_a,
                    edit
                        ? before.fld_children_a
                        : [
                              ...(before.fld_children_a as string[]),
                              'rec_created',
                          ]
                );
                assert.equal(
                    f.fields.controller.getState().draft!.data.fld_unrendered,
                    before.fld_unrendered
                );
            } finally {
                f.close();
            }
        });
        it(`${edit ? 'Edit' : 'Create'} invalidates coordinator Save callbacks after navigation ABA`, async () => {
            const f = setup(edit);
            try {
                assert.equal(await f.open(), true);
                f.final();
                const s = f.ready(),
                    oldRevision = s.revision;
                assert.equal(
                    s.pages.back(s.pages.getSnapshot().revision).accepted,
                    true
                );
                assert.equal(f.advance().accepted, true);
                assert.ok(f.owner.getSnapshot().revision > oldRevision);
                await assert.rejects(f.owner.save(oldRevision));
                assert.equal(f.calls.begins, 0);
                assert.equal(f.calls.saves.length, 0);
                assert.equal((await f.save()).type, 'saved');
            } finally {
                f.close();
            }
        });
        it(`${edit ? 'Edit' : 'Create'} revalidates earlier required answers at final Save without dispatch`, async () => {
            const f = setup(edit);
            try {
                assert.equal(await f.open(), true);
                const s = f.ready();
                assert.equal(
                    s.child.field('fld_title').setValue('').accepted,
                    true
                );
                assert.equal(f.advance().accepted, false);
                assert.equal(
                    s.child.field('fld_title').setValue('Accepted').accepted,
                    true
                );
                f.final();
                assert.equal(
                    s.child.field('fld_title').setValue('').accepted,
                    true
                );
                await assert.rejects(f.save());
                assert.equal(f.calls.begins, 0);
                assert.equal(f.calls.saves.length, 0);
                assert.equal(
                    s.child.field('fld_title').setValue('Fixed').accepted,
                    true
                );
                assert.equal((await f.save()).type, 'saved');
            } finally {
                f.close();
            }
        });
        it(`${edit ? 'Edit' : 'Create'} skips a conditionally hidden page without deleting its native answer`, async () => {
            const loaded = pagedChildForm(edit ? 'rec_existing' : undefined);
            loaded.payload.fieldIdsToSchemas.fld_note!.miniExtConfig = {
                ...loaded.payload.fieldIdsToSchemas.fld_note!.miniExtConfig,
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'show-note',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'fld_title' },
                                value: 'Show second',
                            },
                        },
                    ],
                },
            };
            const f = setup(edit, { loaded });
            try {
                assert.equal(await f.open(), true);
                assert.equal(f.advance().accepted, true);
                assert.equal(f.ready().pages.getSnapshot().activePageIndex, 2);
                assert.equal((await f.save()).type, 'saved');
                assert.equal(
                    f.calls.saves[0]!.formRecord.data.fld_note,
                    'Second native answer'
                );
            } finally {
                f.close();
            }
        });
    }
    for (const edit of [false, true]) {
        it(`${edit ? 'Edit' : 'Create'} keeps incomplete native input out of navigation and Save`, async () => {
            const loaded = pagedChildForm(edit ? 'rec_existing' : undefined);
            loaded.payload.fieldIdsToSchemas.fld_number = {
                fieldType: 'number',
                airtableField: {
                    id: 'fld_number',
                    name: 'Number',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: { type: 'number', options: { precision: 0 } },
                },
                miniExtConfig: {},
            };
            loaded.payload.fieldIdsInForm.splice(2, 0, 'fld_number');
            loaded.payload.formRecord.data.fld_number = 12;
            const f = setup(edit, { loaded });
            try {
                assert.equal(await f.open(), true);
                assert.equal(f.advance().accepted, true);
                const s = f.ready();
                assert.equal(
                    s.child.field('fld_number').scalar!.setInput('-'),
                    false
                );
                assert.equal(f.advance().accepted, false);
                await assert.rejects(f.save());
                assert.equal(
                    s.child.controller.getState().draft!.data.fld_number,
                    12
                );
                assert.equal(f.calls.begins, 0);
                assert.equal(f.calls.saves.length, 0);
                assert.equal(
                    s.child.field('fld_number').scalar!.setInput('15'),
                    true
                );
                f.final();
                assert.equal((await f.save()).type, 'saved');
                assert.equal(f.calls.saves[0]!.formRecord.data.fld_number, 15);
            } finally {
                f.close();
            }
        });
        it(`${edit ? 'Edit' : 'Create'} retains queued files and blocks navigation without an implicit upload`, async () => {
            const loaded = pagedChildForm(edit ? 'rec_existing' : undefined);
            loaded.payload.fieldIdsToSchemas.fld_files = structuredClone(
                loadedForm().payload.fieldIdsToSchemas.fld_files!
            );
            loaded.payload.fieldIdsInForm.splice(2, 0, 'fld_files');
            loaded.payload.formRecord.data.fld_files = [];
            const f = setup(edit, { loaded });
            try {
                assert.equal(await f.open(), true);
                assert.equal(f.advance().accepted, true);
                const s = f.ready();
                const attachment = s.child.attachment('fld_files', {
                    journal: f.journal,
                    scope: {
                        owner: 'synthetic-child-files',
                        parentFieldId: 'fld_files',
                        tableId: 'tbl_child',
                        childExtensionId: 'form_child_synthetic',
                        context: 'modal',
                    },
                    loadVersion: 1,
                });
                assert.equal(
                    attachment.select([
                        new File(['synthetic'], 'queued.txt', {
                            type: 'text/plain',
                        }) as unknown as globalThis.File,
                    ]),
                    true
                );
                assert.equal(s.child.hasPendingFiles(), true);
                assert.equal(f.advance().accepted, false);
                await assert.rejects(f.save());
                assert.equal(f.calls.begins, 0);
                assert.equal(f.calls.saves.length, 0);
                assert.deepEqual(
                    s.child.controller.getState().draft!.data.fld_files,
                    []
                );
            } finally {
                f.close();
            }
        });
    }
    it('retires old page subscriptions when a navigation observer closes and reopens', async () => {
        const f = setup();
        try {
            assert.equal(await f.open(), true);
            const old = f.ready();
            let closed = false;
            const stop = f.owner.subscribe((s) => {
                if (!closed && s.pages?.getSnapshot().activePageIndex === 1) {
                    closed = true;
                    f.owner.close();
                }
            });
            assert.equal(f.advance().accepted, false);
            assert.equal(closed, true);
            stop();
            assert.equal(await f.open(), true);
            const fresh = f.ready();
            const revision = fresh.revision;
            assert.notEqual(fresh.pages, old.pages);
            assert.equal(
                old.pages.next(old.pages.getSnapshot().revision).accepted,
                false
            );
            assert.equal(f.owner.getSnapshot().revision, revision);
            assert.equal(f.ready().pages.getSnapshot().activePageIndex, 0);
            assert.equal(f.calls.loads.length, 2);
            assert.equal(f.calls.saves.length, 0);
        } finally {
            f.close();
        }
    });
    it('handles close during the synchronous setup notification without a late subscription on released pages', async () => {
        const f = setup();
        const released: ReturnType<typeof f.ready>['pages'][] = [];
        try {
            const stop = f.owner.subscribe((s) => {
                if (s.pages && released.length === 0) {
                    released.push(s.pages);
                    f.owner.close();
                }
            });
            assert.equal(await f.open(), false);
            stop();
            assert.equal(released.length, 1);
            assert.equal(f.owner.getSnapshot().child, null);
            assert.equal(await f.open(), true);
            const fresh = f.ready();
            const revision = fresh.revision;
            assert.equal(
                released[0]!.next(released[0]!.getSnapshot().revision).accepted,
                false
            );
            assert.equal(f.owner.getSnapshot().revision, revision);
            assert.equal(fresh.pages.getSnapshot().activePageIndex, 0);
        } finally {
            f.close();
        }
    });
    it('preserves an uncertain final Save and refuses another create instead of replaying', async () => {
        const f = setup(false, {
            save: async () => {
                throw Error('Synthetic transport stopped');
            },
        });
        try {
            assert.equal(await f.open(), true);
            f.final();
            await assert.rejects(f.save());
            assert.equal(f.owner.getSnapshot().phase, 'unknown');
            assert.equal(await f.open(), false);
            assert.equal(f.calls.saves.length, 1);
            assert.equal(f.calls.begins, 1);
        } finally {
            f.close();
        }
    });
    it('keeps known validation failure editable for one later explicit final Save', async () => {
        let reject = true;
        const f = setup(false, {
            save: async () =>
                reject ? structuredClone(validationError) : childSaved('edit'),
        });
        try {
            assert.equal(await f.open(), true);
            f.final();
            assert.equal((await f.save()).type, 'error');
            assert.equal(
                f
                    .ready()
                    .child.field('fld_title')
                    .setValue('Fixed child answer').accepted,
                true
            );
            reject = false;
            assert.equal((await f.save()).type, 'saved');
            assert.equal(f.calls.saves.length, 2);
            assert.equal(f.calls.begins, 2);
            assert.equal(
                f.calls.saves[1]!.formRecord.data.fld_title,
                'Fixed child answer'
            );
        } finally {
            f.close();
        }
    });
    it('closing a held final Save cannot reconcile its late result or reopen its request', async () => {
        const held = deferred<SaveFormResult>();
        const f = setup(false, { save: () => held.promise });
        try {
            assert.equal(await f.open(), true);
            f.final();
            const before = structuredClone(
                f.fields.controller.getState().draft!.data
            );
            const flight = f.save();
            const rejected = assert.rejects(flight);
            assert.equal(f.calls.saves.length, 1);
            f.owner.close();
            held.resolve(childSaved('edit'));
            await rejected;
            assert.deepEqual(
                f.fields.controller.getState().draft!.data,
                before
            );
            assert.equal(await f.open(), false);
            assert.equal(f.calls.saves.length, 1);
        } finally {
            f.close();
        }
    });
    for (const [key, value] of [
        ['promptUserBeforeSubmission', true],
        ['enableFormComputeMode', true],
        ['enableCaptcha', true],
        ['autoSubmitAfterPrefill', true],
        ['multiPageFormMode', 'future-mode'],
    ] as const) {
        it(`keeps unsupported child ${key} refused without Save`, async () => {
            const loaded = pagedChildForm();
            Object.assign(loaded.payload.publicFields.state, { [key]: value });
            const f = setup(false, { loaded });
            try {
                assert.equal(await f.open(), false);
                assert.equal(f.owner.getSnapshot().child, null);
                assert.equal(f.calls.saves.length, 0);
                assert.equal(f.calls.begins, 0);
            } finally {
                f.close();
            }
        });
    }
    it('keeps ordinary one-page child admission', async () => {
        const f = setup(false, { loaded: childForm('edit') });
        try {
            assert.equal(await f.open(), true);
            assert.equal(f.ready().pages.getSnapshot().pages.length, 1);
            assert.equal((await f.save()).type, 'saved');
        } finally {
            f.close();
        }
    });
});

const confirmed = (): FormPageReviewDecision => ({
    type: 'confirm',
    signal: new AbortController().signal,
    isCurrent: () => true,
});
const reviewChild = (edit: boolean, multipage = true) => {
    const loaded = pagedChildForm(edit ? 'rec_existing' : undefined);
    loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
    if (!multipage)
        loaded.payload.publicFields.state.multiPageFormMode = 'one-page';
    return loaded;
};

describe('configured linked-child Review composition', () => {
    for (const edit of [false, true]) {
        for (const multipage of [false, true]) {
            it(`${edit ? 'Edit' : 'Create'} ${multipage ? 'multipage' : 'one-page'} reviews only at final Save and reconciles once`, async () => {
                const entered = deferred<FormPageReviewRequest>();
                const decision = deferred<FormPageReviewDecision>();
                let reviews = 0;
                const f = setup(edit, {
                    loaded: reviewChild(edit, multipage),
                    review: async (request) => {
                        reviews++;
                        entered.resolve(request);
                        return decision.promise;
                    },
                });
                try {
                    assert.equal(await f.open(), true);
                    const s = f.ready();
                    if (multipage) {
                        await assert.rejects(f.save());
                        assert.equal(reviews, 0);
                    }
                    f.final();
                    const native = structuredClone(
                        s.child.controller.getState().draft!.data
                    );
                    const saving = f.save();
                    const request = await entered.promise;
                    assert.equal(request.isCurrent(), true);
                    assert.deepEqual(request.draft.data, native);
                    // Presentation copies cannot change transport values.
                    request.draft.data.fld_title = 'Presentation-only text';
                    request.loaded.payload.formRecord.data.fld_note =
                        'Presentation-only note';
                    assert.equal(s.pages.getSnapshot().reviewing, true);
                    assert.equal(
                        s.pages.back(s.pages.getSnapshot().revision).accepted,
                        false
                    );
                    assert.equal(
                        s.pages.next(s.pages.getSnapshot().revision).accepted,
                        false
                    );
                    await assert.rejects(f.save());
                    assert.equal(f.calls.begins, 0);
                    assert.equal(f.calls.saves.length, 0);
                    assert.equal(
                        f.fields
                            .field('fld_title')
                            .setValue('Unrelated parent edit').accepted,
                        true
                    );
                    decision.resolve(confirmed());
                    assert.equal((await saving).type, 'saved');
                    assert.equal(reviews, 1);
                    assert.equal(f.calls.begins, 1);
                    assert.equal(f.calls.saves.length, 1);
                    assert.deepEqual(f.calls.saves[0]!.formRecord.data, native);
                    assert.equal(
                        f.owner.getSnapshot().completion,
                        'reconciled'
                    );
                    const data = f.fields.controller.getState().draft!.data;
                    assert.equal(data.fld_title, 'Unrelated parent edit');
                    assert.deepEqual(data.fld_children_b, ['rec_other_field']);
                    assert.deepEqual(
                        data.fld_children_a,
                        edit
                            ? ['rec_existing', 'rec_existing', 'rec_sibling']
                            : [
                                  'rec_existing',
                                  'rec_existing',
                                  'rec_sibling',
                                  'rec_created',
                              ]
                    );
                    await assert.rejects(f.save());
                    assert.equal(f.calls.saves.length, 1);
                } finally {
                    f.close();
                }
            });
        }

        for (const action of [
            'edit',
            'escape',
            'abort',
            'close',
            'parent-retirement',
            'configuration',
            'draft',
            'reentrant-confirm',
        ] as const) {
            it(`${edit ? 'Edit' : 'Create'} ${action} during Review performs zero Saves`, async () => {
                const entered = deferred<FormPageReviewRequest>();
                const decision = deferred<FormPageReviewDecision>();
                const f = setup(edit, {
                    loaded: reviewChild(edit),
                    review: async (request) => {
                        entered.resolve(request);
                        return decision.promise;
                    },
                });
                try {
                    assert.equal(await f.open(), true);
                    f.final();
                    const s = f.ready();
                    const abort = new AbortController();
                    const saving = f.owner.save(s.revision, {
                        signal: abort.signal,
                    });
                    const rejected = assert.rejects(saving);
                    const request = await entered.promise;
                    if (action === 'close') f.owner.close();
                    else if (action === 'abort') abort.abort();
                    else if (action === 'parent-retirement') f.replaceOwner();
                    else if (action === 'configuration')
                        f.changeConfiguration();
                    else if (action === 'draft') {
                        s.child.field('fld_title').setValue('New draft');
                        decision.resolve(confirmed());
                    } else if (action === 'reentrant-confirm') {
                        decision.resolve({
                            type: 'confirm',
                            signal: new AbortController().signal,
                            isCurrent: () => {
                                s.child
                                    .field('fld_title')
                                    .setValue('Reentrant edit');
                                return true;
                            },
                        });
                    } else decision.resolve({ type: 'edit' }); // Edit and Escape use the same adapter decision.
                    await rejected;
                    assert.equal(f.calls.begins, 0);
                    assert.equal(f.calls.saves.length, 0);
                    if (
                        [
                            'close',
                            'abort',
                            'parent-retirement',
                            'configuration',
                        ].includes(action)
                    )
                        assert.equal(request.signal.aborted, true);
                    if (action === 'edit' || action === 'escape') {
                        assert.equal(f.owner.getSnapshot().phase, 'ready');
                        assert.equal(f.owner.getSnapshot().error, null);
                        assert.ok(f.ready().child);
                    }
                } finally {
                    f.close();
                }
            });
        }

        it(`${edit ? 'Edit' : 'Create'} allows inspection of invalid answers but Confirm cannot bypass validation`, async () => {
            let reviews = 0;
            const f = setup(edit, {
                loaded: reviewChild(edit),
                review: async () => {
                    reviews++;
                    return confirmed();
                },
            });
            try {
                assert.equal(await f.open(), true);
                f.final();
                f.ready().child.field('fld_title').setValue('');
                assert.equal(f.ready().pages.getSnapshot().canReview, true);
                assert.equal(f.ready().pages.getSnapshot().canSubmit, false);
                await assert.rejects(f.save());
                assert.equal(reviews, 1);
                assert.equal(f.calls.begins, 0);
                assert.equal(f.calls.saves.length, 0);
            } finally {
                f.close();
            }
        });

        it(`${edit ? 'Edit' : 'Create'} keeps backend validation and uncertain outcomes on the existing lifecycle`, async () => {
            let attempts = 0;
            const f = setup(edit, {
                loaded: reviewChild(edit),
                review: async () => confirmed(),
                save: async () => {
                    if (++attempts === 1)
                        return structuredClone(validationError);
                    throw Error('Synthetic lost response');
                },
            });
            try {
                assert.equal(await f.open(), true);
                f.final();
                assert.equal((await f.save()).type, 'error');
                assert.equal(f.owner.getSnapshot().phase, 'ready');
                await assert.rejects(f.save());
                assert.equal(f.owner.getSnapshot().phase, 'unknown');
                await assert.rejects(f.save());
                assert.equal(f.calls.saves.length, 2);
                assert.equal(f.owner.getSnapshot().completion, 'none');
            } finally {
                f.close();
            }
        });
    }

    it('keeps configured Review unavailable without an adapter and refuses unsupported presentation', async () => {
        const noAdapter = setup(false, { loaded: reviewChild(false) });
        try {
            assert.equal(await noAdapter.open(), false);
            assert.equal(noAdapter.calls.saves.length, 0);
        } finally {
            noAdapter.close();
        }
        const unsupported = setup(false, {
            loaded: reviewChild(false),
            review: async () => {
                throw Error('Unsupported answers');
            },
        });
        try {
            assert.equal(await unsupported.open(), true);
            unsupported.final();
            await assert.rejects(unsupported.save(), /Unsupported answers/);
            assert.equal(unsupported.calls.begins, 0);
            assert.equal(unsupported.calls.saves.length, 0);
        } finally {
            unsupported.close();
        }
    });

    it('replacing the adapter retires the old owner and pending Review', async () => {
        const entered = deferred<FormPageReviewRequest>();
        const decision = deferred<FormPageReviewDecision>();
        const review = async (request: FormPageReviewRequest) => {
            entered.resolve(request);
            return decision.promise;
        };
        const f = setup(false, { loaded: reviewChild(false), review });
        try {
            assert.equal(
                f.fields.linkedChild('fld_children_a', {
                    journal: f.journal,
                    loadVersion: 1,
                    review,
                }),
                f.owner
            );
            assert.equal(await f.open(), true);
            f.final();
            const rejected = assert.rejects(f.save());
            const request = await entered.promise;
            const replacement = f.fields.linkedChild('fld_children_a', {
                journal: f.journal,
                loadVersion: 1,
                review: async () => confirmed(),
            });
            assert.notEqual(replacement, f.owner);
            await rejected;
            assert.equal(request.signal.aborted, true);
            assert.equal(f.calls.saves.length, 0);
        } finally {
            f.close();
        }
    });
});

describe('linked-child Review admission and receipt boundaries', () => {
    for (const [key, value] of [
        ['enableFormComputeMode', true],
        ['autoSubmitAfterPrefill', true],
        ['enableCaptcha', true],
        ['multiPageFormMode', 'future-mode'],
    ] as const) {
        it(`an adapter does not admit ${key}`, async () => {
            const loaded = reviewChild(false);
            Object.assign(loaded.payload.publicFields.state, { [key]: value });
            let reviews = 0;
            const f = setup(false, {
                loaded,
                review: async () => {
                    reviews++;
                    return confirmed();
                },
            });
            try {
                assert.equal(await f.open(), false);
                assert.equal(reviews, 0);
                assert.equal(f.calls.begins, 0);
                assert.equal(f.calls.saves.length, 0);
            } finally {
                f.close();
            }
        });
    }

    it('rejects a retained final action after navigation away and back before Review', async () => {
        let reviews = 0;
        const f = setup(false, {
            loaded: reviewChild(false),
            review: async () => {
                reviews++;
                return confirmed();
            },
        });
        try {
            assert.equal(await f.open(), true);
            f.final();
            const s = f.ready();
            assert.equal(
                s.pages.back(s.pages.getSnapshot().revision).accepted,
                true
            );
            f.final();
            await assert.rejects(f.owner.save(s.revision));
            assert.equal(reviews, 0);
            assert.equal(f.calls.begins, 0);
            assert.equal((await f.save()).type, 'saved');
            assert.equal(reviews, 1);
        } finally {
            f.close();
        }
    });

    it('an aborted confirmation presentation cannot authorize transport', async () => {
        const presentation = new AbortController();
        const f = setup(false, {
            loaded: reviewChild(false),
            review: async () => {
                presentation.abort();
                return {
                    type: 'confirm',
                    signal: presentation.signal,
                    isCurrent: () => true,
                };
            },
        });
        try {
            assert.equal(await f.open(), true);
            f.final();
            await assert.rejects(f.save());
            assert.equal(f.calls.begins, 0);
            assert.equal(f.calls.saves.length, 0);
        } finally {
            f.close();
        }
    });

    it('reentrant adapter Close prevents Save even if it returns Confirm', async () => {
        const f = setup(false, {
            loaded: reviewChild(false),
            review: async () => {
                f.owner.close();
                return confirmed();
            },
        });
        try {
            assert.equal(await f.open(), true);
            f.final();
            await assert.rejects(f.save());
            assert.equal(f.calls.begins, 0);
            assert.equal(f.calls.saves.length, 0);
        } finally {
            f.close();
        }
    });

    it('parent configuration retirement after reviewed dispatch retains the known receipt without reconciliation', async () => {
        const response = deferred<SaveFormResult>();
        const dispatched = deferred<void>();
        const f = setup(false, {
            loaded: reviewChild(false),
            review: async () => confirmed(),
            save: async () => {
                dispatched.resolve();
                return response.promise;
            },
        });
        try {
            assert.equal(await f.open(), true);
            f.final();
            const before = structuredClone(
                f.fields.controller.getState().draft!.data
            );
            const saving = f.save();
            await dispatched.promise;
            f.changeConfiguration();
            response.resolve(childSaved('edit'));
            assert.equal((await saving).type, 'saved');
            assert.equal(f.calls.saves.length, 1);
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.deepEqual(
                f.fields.controller.getState().draft!.data,
                before
            );
            await assert.rejects(f.save());
            assert.equal(f.calls.saves.length, 1);
        } finally {
            f.close();
        }
    });
});

it('a late cancelled adapter cannot clear the next Review retirement guard', async () => {
    const firstDecision = deferred<FormPageReviewDecision>();
    const secondDecision = deferred<FormPageReviewDecision>();
    const firstEntered = deferred<FormPageReviewRequest>();
    const secondEntered = deferred<FormPageReviewRequest>();
    let reviews = 0;
    const f = setup(false, {
        loaded: reviewChild(false),
        review: async (request) => {
            if (++reviews === 1) {
                firstEntered.resolve(request);
                return firstDecision.promise;
            }
            secondEntered.resolve(request);
            return secondDecision.promise;
        },
    });
    try {
        assert.equal(await f.open(), true);
        f.final();
        const abort = new AbortController();
        const first = assert.rejects(
            f.owner.save(f.owner.getSnapshot().revision, {
                signal: abort.signal,
            })
        );
        await firstEntered.promise;
        abort.abort();
        await first;
        const second = assert.rejects(f.save());
        const request = await secondEntered.promise;
        firstDecision.resolve({ type: 'edit' });
        await new Promise<void>((resolve) => setImmediate(resolve));
        f.changeConfiguration();
        assert.equal(request.signal.aborted, true);
        await second;
        assert.equal(f.calls.begins, 0);
        assert.equal(f.calls.saves.length, 0);
    } finally {
        f.close();
    }
});
