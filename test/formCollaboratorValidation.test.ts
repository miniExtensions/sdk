import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormPageOwner } from '../src/forms/pages.js';
import type { FormSaveLifecycle } from '../src/forms/controller.js';
import {
    createMiniExtensionsClient,
    type AirtableValue,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';

type Kind = 'singleCollaborator' | 'multipleCollaborators';
type FixtureOptions = {
    kind?: Kind;
    stored?: unknown;
    choices?: unknown;
    required?: boolean;
    hidden?: boolean;
    readOnly?: boolean;
    otherStored?: unknown;
};
const choice = { id: 'usr_choice', email: 'not-an-email', name: '' };
const saved = { id: 'usr_saved', email: 'old@example.test', name: 'Old label' };
const native = (value: unknown): AirtableValue => value as AirtableValue;

/** Public owners, fake transport and native objects; no account lookup or backend claim. */
const fixture = (options: FixtureOptions = {}) => {
    const kind = options.kind ?? 'singleCollaborator';
    const loaded = loadedForm();
    const schema = {
        fieldType: kind,
        airtableField: {
            id: 'fld_person',
            name: 'Person',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: kind,
                options: {
                    choices: Object.hasOwn(options, 'choices')
                        ? options.choices
                        : [choice],
                },
            },
        },
        miniExtConfig: {
            required: options.required ?? false,
            readOnly: options.readOnly ?? false,
            ...(options.hidden
                ? {
                      conditionalFields: {
                          logicalOperator: 'and',
                          conditions: [
                              {
                                  id: 'hide-person',
                                  type: 'singleCondition',
                                  setting: {
                                      type: 'is',
                                      fieldType: 'singleLineText',
                                      idOrName: { type: 'id', id: 'fld_end' },
                                      value: 'never',
                                  },
                              },
                          ],
                      },
                  }
                : {}),
        },
    } as RuntimeFieldSchema;
    const end = structuredClone(loaded.payload.fieldIdsToSchemas.fld_title!);
    end.airtableField.id = 'fld_end';
    end.airtableField.name = 'End';
    end.miniExtConfig = {
        enableSectionHeader: true,
        headerSectionTitle: 'End',
    };
    loaded.payload.fieldIdsInForm = ['fld_person', 'fld_end'];
    loaded.payload.fieldIdsToSchemas = { fld_person: schema, fld_end: end };
    loaded.payload.formRecord = {
        type: 'create',
        data: {
            fld_person: native(
                Object.hasOwn(options, 'stored') ? options.stored : null
            ),
            fld_end: 'Finish',
            fld_other: native(options.otherStored ?? saved),
            fld_hidden_native: { text: 'Retained full native value' },
        },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['fld_hidden_native'];
    loaded.payload.urlPrefilledFieldIds = [];
    Object.assign(loaded.payload.publicFields.state, {
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    });
    let scope = { ownerId: 'A', revision: 0 };
    let configuration = 0;
    let ownership = () => true;
    let lookups = 0;
    let attempts = 0;
    const calls: SaveFormInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            lookups++;
            throw Error('No account lookup or unexpected transport');
        },
    });
    client.forms.save = async (input) => {
        calls.push(structuredClone(input));
        return invalidForm();
    };
    const saveOptions = formSaveOptions();
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions,
        getScope: () => scope,
    });
    const pages = createFormPageOwner({
        fields,
        isCurrent: () => ownership(),
        configurationRevision: () => configuration,
    });
    const lifecycle: FormSaveLifecycle = {
        dispatch() {
            attempts++;
            return { accepted() {}, finish() {} };
        },
    };
    return {
        loaded,
        fields,
        pages,
        client,
        calls,
        lifecycle,
        saveOptions,
        attempts: () => attempts,
        lookups: () => lookups,
        setScope: (value: typeof scope) => {
            scope = value;
        },
        setConfiguration: (value: number) => {
            configuration = value;
        },
        setOwnership: (value: () => boolean) => {
            ownership = value;
        },
        write(value: unknown) {
            assert.equal(
                fields.controller.write('fld_person', native(value)),
                true
            );
        },
        finalPage() {
            while (pages.getSnapshot().canNext)
                assert.equal(
                    pages.next(pages.getSnapshot().revision).accepted,
                    true
                );
        },
        dispose() {
            pages.dispose();
            fields.destroy();
        },
    };
};
const assertNoDispatch = (f: ReturnType<typeof fixture>) => {
    assert.equal(f.attempts(), 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.lookups(), 0);
};

const shapeCases: { label: string; kind: Kind; value: unknown }[] = [
    { label: 'single array', kind: 'singleCollaborator', value: [choice] },
    { label: 'single string ID', kind: 'singleCollaborator', value: choice.id },
    { label: 'single false', kind: 'singleCollaborator', value: false },
    { label: 'single zero', kind: 'singleCollaborator', value: 0 },
    {
        label: 'single missing ID',
        kind: 'singleCollaborator',
        value: { name: 'Label' },
    },
    {
        label: 'single numeric ID',
        kind: 'singleCollaborator',
        value: { id: 7 },
    },
    { label: 'multiple object', kind: 'multipleCollaborators', value: choice },
    { label: 'multiple false', kind: 'multipleCollaborators', value: false },
    { label: 'multiple zero', kind: 'multipleCollaborators', value: 0 },
    {
        label: 'multiple mixed',
        kind: 'multipleCollaborators',
        value: [choice, choice.id],
    },
    {
        label: 'multiple null entry',
        kind: 'multipleCollaborators',
        value: [choice, null],
    },
    {
        label: 'multiple sparse',
        kind: 'multipleCollaborators',
        value: Object.assign(new Array(2), { 1: choice }),
    },
];

describe('collaborator membership through public Form page owners', () => {
    for (const kind of [
        'singleCollaborator',
        'multipleCollaborators',
    ] as const) {
        it(`${kind}: unknown IDs block visible Next and final Submit before lifecycle/transport`, async () => {
            const f = fixture({ kind });
            try {
                const value =
                    kind === 'singleCollaborator'
                        ? { id: 'usr_unknown' }
                        : [{ id: 'usr_unknown' }];
                f.write(value);
                const snapshot = f.pages.getSnapshot();
                assert(
                    snapshot.problems.some(
                        (p) =>
                            p.fieldId === 'fld_person' &&
                            p.code === 'invalid-selection'
                    )
                );
                assert.equal(snapshot.canNext, false);
                assert.equal(f.pages.next(snapshot.revision).accepted, false);
                await assert.rejects(
                    f.pages.submit(snapshot.revision, {
                        lifecycle: f.lifecycle,
                    })
                );
                assertNoDispatch(f);
                f.write(kind === 'singleCollaborator' ? choice : [choice]);
                f.finalPage();
                f.write(value);
                assert.equal(f.pages.getSnapshot().canSubmit, false);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: f.lifecycle,
                    })
                );
                assertNoDispatch(f);
            } finally {
                f.dispose();
            }
        });

        it(`${kind}: exact choice/stored IDs preserve full native metadata and Save envelope`, async () => {
            const stored = kind === 'singleCollaborator' ? saved : [saved];
            const changed = {
                ...saved,
                email: 'invalid display email',
                name: 'Renamed',
                extra: 'Native metadata',
            };
            const chosen = { ...choice, name: 'Changed label' };
            const value =
                kind === 'singleCollaborator'
                    ? changed
                    : [chosen, changed, chosen];
            const f = fixture({ kind, stored });
            try {
                f.write(value);
                f.finalPage();
                assert.equal(f.pages.getSnapshot().canSubmit, true);
                await f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: f.lifecycle,
                });
                assert.equal(f.attempts(), 1);
                assert.equal(f.lookups(), 0);
                assert.deepEqual(f.calls, [
                    {
                        ...f.saveOptions,
                        extensionAccessToken:
                            f.loaded.payload.extensionAccessToken,
                        formRecord: {
                            ...f.loaded.payload.formRecord,
                            data: {
                                ...f.loaded.payload.formRecord.data,
                                fld_person: value,
                            },
                        },
                        formFieldIdsWithUnsavedChanges: [
                            'fld_hidden_native',
                            'fld_person',
                        ],
                    },
                ]);
                assert.deepEqual(
                    f.fields.field('fld_person').getSnapshot().value,
                    value
                );
            } finally {
                f.dispose();
            }
        });

        it(`${kind}: IDs remain exact despite matching display metadata`, () => {
            const f = fixture({ kind });
            try {
                const spoofed = { ...choice, id: 'USR_CHOICE' };
                f.write(kind === 'singleCollaborator' ? spoofed : [spoofed]);
                assert(
                    f.pages
                        .getSnapshot()
                        .problems.some((p) => p.code === 'invalid-selection')
                );
                assert.equal(f.pages.getSnapshot().canNext, false);
                assertNoDispatch(f);
            } finally {
                f.dispose();
            }
        });

        it(`${kind}: another field's stored identity does not grant membership`, () => {
            const f = fixture({
                kind,
                otherStored: { id: 'usr_other', name: 'Same display' },
            });
            try {
                f.write(
                    kind === 'singleCollaborator'
                        ? { id: 'usr_other' }
                        : [{ id: 'usr_other' }]
                );
                assert(
                    f.pages
                        .getSnapshot()
                        .problems.some((p) => p.code === 'invalid-selection')
                );
                assert.equal(f.pages.getSnapshot().canNext, false);
                assertNoDispatch(f);
            } finally {
                f.dispose();
            }
        });

        for (const mode of [
            'optional',
            'required',
            'hidden-required',
            'readonly-required',
        ] as const) {
            const clears =
                kind === 'multipleCollaborators'
                    ? [null, undefined, '', []]
                    : [null, undefined, ''];
            for (const [index, value] of clears.entries()) {
                it(`${kind}: ${mode} clear ${index} applies required before missing authority`, async () => {
                    const f = fixture({
                        kind,
                        stored: value,
                        choices: undefined,
                        required: mode !== 'optional',
                        hidden: mode === 'hidden-required',
                        readOnly: mode === 'readonly-required',
                    });
                    try {
                        const blocked = mode === 'required';
                        assert.equal(
                            f.pages
                                .getSnapshot()
                                .problems.some((p) => p.code === 'required'),
                            blocked
                        );
                        assert.equal(
                            f.pages
                                .getSnapshot()
                                .problems.some(
                                    (p) => p.code === 'invalid-metadata'
                                ),
                            false
                        );
                        if (blocked) {
                            assert.equal(f.pages.getSnapshot().canNext, false);
                            await assert.rejects(
                                f.pages.submit(f.pages.getSnapshot().revision, {
                                    lifecycle: f.lifecycle,
                                })
                            );
                            assertNoDispatch(f);
                        } else {
                            f.finalPage();
                            assert.equal(f.pages.getSnapshot().canSubmit, true);
                            await f.pages.submit(
                                f.pages.getSnapshot().revision,
                                { lifecycle: f.lifecycle }
                            );
                            assert.deepEqual(
                                f.calls[0]!.formRecord.data,
                                f.loaded.payload.formRecord.data
                            );
                            assert.deepEqual(
                                f.calls[0]!.formFieldIdsWithUnsavedChanges,
                                ['fld_hidden_native']
                            );
                            assert.equal(f.lookups(), 0);
                        }
                    } finally {
                        f.dispose();
                    }
                });
            }
        }

        for (const mode of ['visible', 'hidden', 'readonly'] as const) {
            it(`${kind}: nonempty invalid collaborator selection is not waived by ${mode} presentation`, async () => {
                const f = fixture({
                    kind,
                    hidden: mode === 'hidden',
                    readOnly: mode === 'readonly',
                    ...(mode === 'readonly' ? { stored: false } : {}),
                });
                try {
                    if (mode !== 'readonly')
                        f.write(
                            kind === 'singleCollaborator'
                                ? { id: 'usr_unknown' }
                                : [{ id: 'usr_unknown' }]
                        );
                    assert(
                        f.pages
                            .getSnapshot()
                            .problems.some(
                                (p) => p.code === 'invalid-selection'
                            )
                    );
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: f.lifecycle,
                        })
                    );
                    assertNoDispatch(f);
                } finally {
                    f.dispose();
                }
            });
        }
    }

    for (const sample of shapeCases) {
        it(`malformed native shape: ${sample.label}`, async () => {
            const f = fixture({ kind: sample.kind });
            try {
                f.write(sample.value);
                assert(
                    f.pages
                        .getSnapshot()
                        .problems.some(
                            (p) =>
                                p.fieldId === 'fld_person' &&
                                p.code === 'invalid-selection'
                        )
                );
                assert.equal(f.pages.getSnapshot().canNext, false);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: f.lifecycle,
                    })
                );
                assertNoDispatch(f);
            } finally {
                f.dispose();
            }
        });
    }

    for (const kind of [
        'singleCollaborator',
        'multipleCollaborators',
    ] as const) {
        for (const [label, choices] of [
            ['missing', undefined],
            ['null', null],
            ['not-array', {}],
            ['missing-ID', [{}]],
            ['numeric-ID', [{ id: 1 }]],
            ['mixed', [choice, 'usr_choice']],
            ['sparse', new Array(1)],
        ] as const) {
            it(`${kind}: ${label} choices are invalid metadata even for an original stored ID`, async () => {
                const f = fixture({
                    kind,
                    choices,
                    stored: kind === 'singleCollaborator' ? saved : [saved],
                });
                try {
                    assert(
                        f.pages
                            .getSnapshot()
                            .problems.some((p) => p.code === 'invalid-metadata')
                    );
                    assert.equal(f.pages.getSnapshot().canNext, false);
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: f.lifecycle,
                        })
                    );
                    assertNoDispatch(f);
                } finally {
                    f.dispose();
                }
            });
        }
    }

    it('retained rendered revisions refuse Next after a collaborator replacement', () => {
        const f = fixture();
        try {
            const rendered = f.pages.getSnapshot().revision;
            f.write(choice);
            assert.deepEqual(f.pages.next(rendered), {
                accepted: false,
                reason: 'stale-revision',
            });
            assert.equal(f.pages.getSnapshot().canNext, true);
            assertNoDispatch(f);
        } finally {
            f.dispose();
        }
    });

    for (const replacement of ['configuration', 'session', 'owner'] as const) {
        it(`${replacement} replacement retires retained Next and final Submit`, async () => {
            const f = fixture({ stored: choice });
            try {
                const retainedNext = f.pages.next;
                f.finalPage();
                const revision = f.pages.getSnapshot().revision;
                if (replacement === 'configuration') f.setConfiguration(1);
                else if (replacement === 'session')
                    f.client.setSession({ visitor: 'B' });
                else f.setScope({ ownerId: 'B', revision: 1 });
                assert.equal(retainedNext(revision).accepted, false);
                await assert.rejects(
                    f.pages.submit(revision, { lifecycle: f.lifecycle })
                );
                assertNoDispatch(f);
            } finally {
                f.dispose();
            }
        });
    }

    it('an accepted-page ownership callback exposes invalid collaborator membership before navigation', () => {
        const f = fixture({ stored: choice });
        try {
            const revision = f.pages.getSnapshot().revision;
            let replaced = false;
            f.setOwnership(() => {
                if (!replaced) {
                    replaced = true;
                    f.write({ id: 'usr_unknown' });
                }
                return true;
            });
            const current = f.pages.getSnapshot();
            assert.equal(replaced, true);
            assert.equal(current.canNext, false);
            assert(
                current.problems.some((p) => p.code === 'invalid-selection')
            );
            assert.equal(f.pages.next(revision).accepted, false);
            assertNoDispatch(f);
        } finally {
            f.dispose();
        }
    });
});
