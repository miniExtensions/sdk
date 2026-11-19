import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createFormFieldBindings,
    createFormPageOwner,
    FormControllerError,
    FormPageError,
    RecoveryJournal,
} from '../src/forms/index.js';
import { withFormSaveAdmission } from '../src/forms/saveAdmission.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type { SaveFormInput } from '../src/runtime/types.js';
import {
    childForm,
    childSaved,
    parentForm,
} from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

const links = 'fld_children_a';
const first = 'rec_existing';
const second = 'rec_sibling';

function requiredOpenFixture(
    ids = [first, second],
    observations: { configuration?(): void; scope?(): void } = {}
) {
    const loaded = parentForm('edit');
    loaded.payload.fieldIdsInForm = [links, 'fld_title'];
    loaded.payload.formRecord.data[links] = ids;
    loaded.payload.publicFields.state.multiPageFormMode = 'multi-page';
    const link = loaded.payload.fieldIdsToSchemas[links];
    assert(link?.fieldType === 'multipleRecordLinks');
    link.miniExtConfig = {
        ...link.miniExtConfig,
        requireOpenLinkedRecords: true,
    };
    const title = loaded.payload.fieldIdsToSchemas.fld_title;
    assert(title?.fieldType === 'singleLineText');
    title.miniExtConfig = {
        ...title.miniExtConfig,
        headerSectionTitle: 'Finish',
    };
    let configuration = 0;
    let scopeRevision = 0;
    const writes: SaveFormInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-required-open' },
        fetch: async () => {
            throw Error('Unexpected transport');
        },
    });
    client.linkedRecords.loadSelectedRecords = async () => ({
        tbl_child: {
            airtableFields: [
                loaded.payload.fieldIdsToSchemas.fld_title.airtableField,
            ],
            recordIdsToAirtableRecords: Object.fromEntries(
                [first, second].map((id) => [
                    id,
                    { id, fields: { fld_title: id } },
                ])
            ),
        },
    });
    client.loadExtension = async (input) => {
        const access =
            'childExtensionInfo' in input
                ? input.childExtensionInfo.accessType
                : undefined;
        assert(access?.type === 'edit');
        const result = childForm('edit');
        result.payload.formRecord = {
            type: 'edit',
            recordId: access.childExtensionRecordId,
            tableId: 'tbl_child',
            data: result.payload.formRecord.data,
        };
        return result;
    };
    client.forms.save = async (input) => {
        writes.push(input);
        const saved = childSaved('edit');
        return {
            ...saved,
            context: { type: 'direct-url' },
            tableId: 'tbl_parent',
            record: { id: 'rec_parent', fields: input.formRecord.data },
        };
    };
    const fields = createFormFieldBindings({
        loaded,
        client,
        getScope: () => {
            observations.scope?.();
            return { ownerId: 'synthetic-parent', revision: scopeRevision };
        },
        configurationRevision: () => {
            observations.configuration?.();
            return configuration;
        },
        saveOptions: formSaveOptions(),
    });
    // Keep the separate page epoch fixed, to test the bindings' own final fence.
    const pages = createFormPageOwner({
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const owner = fields.linkedChild(links, {
        journal: new RecoveryJournal(),
        loadVersion: 1,
    });
    const open = async (id: string) => {
        assert.equal(
            await owner.openEdit(id, owner.getSnapshot().revision),
            true
        );
        const snapshot = owner.getSnapshot();
        assert(snapshot.child);
        const child = snapshot.child;
        return (signal: AbortSignal = new AbortController().signal) =>
            owner.acknowledgeEditPresentation(snapshot.revision, child, signal);
    };
    return {
        fields,
        pages,
        owner,
        client,
        writes,
        open,
        replaceOwner: (kind: 'scope' | 'session') => {
            if (kind === 'scope') scopeRevision++;
            else client.setSession({ visitor: 'synthetic-successor' });
        },
        rotateConfiguration: () => {
            configuration++;
        },
        dispose: () => {
            pages.dispose();
            fields.destroy();
        },
    };
}

it('uses only live presentations against the unfiltered linked selection on both pages', async () => {
    const f = requiredOpenFixture();
    try {
        assert(await f.fields.linkedRecords(links).readSelected());
        const retained = await f.open(first);
        const expired = new AbortController();
        expired.abort();
        assert.equal(retained(expired.signal), false);
        f.owner.close();
        assert.equal(retained(), false);
        assert.equal(f.pages.getSnapshot().canNext, false);

        const presentFirst = await f.open(first);
        assert.equal(presentFirst(), true);
        assert.equal(presentFirst(), false);
        const shown = f.owner.getSnapshot();
        assert(shown.child);
        assert.equal(
            f.owner.acknowledgeEditPresentation(
                shown.revision,
                shown.child,
                new AbortController().signal
            ),
            true
        );
        assert.equal(f.owner.getSnapshot().revision, shown.revision);
        f.owner.close();
        assert.equal(f.pages.getSnapshot().canNext, false);
        assert(f.fields.controller.write(links, []));
        assert(f.fields.controller.write(links, [first]));
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert(f.fields.controller.write(links, [first, second]));
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision),
            FormPageError
        );
        assert.equal(f.writes.length, 0);

        const presentSecond = await f.open(second);
        assert.equal(presentSecond(), true);
        f.owner.close();
        assert.equal(f.pages.getSnapshot().canSubmit, true);
        assert.equal(
            (await f.pages.submit(f.pages.getSnapshot().revision)).type,
            'saved'
        );
        assert.equal(f.writes.length, 1);
        assert.deepEqual(f.writes[0]!.formRecord.data[links], [first, second]);
    } finally {
        f.dispose();
    }
});

it('does not credit a loaded but unpresented, pending, or failed edit', async () => {
    const f = requiredOpenFixture([first]);
    const signal = new AbortController().signal;
    let finishLoad!: () => void;
    const unsettled = new Promise<void>((resolve) => {
        finishLoad = resolve;
    });
    try {
        assert(await f.fields.linkedRecords(links).readSelected());
        await f.open(first);
        const original = f.owner.getSnapshot();
        assert(original.child);
        assert.equal(f.pages.getSnapshot().canNext, false);
        f.owner.close();

        f.client.loadExtension = async () => {
            await unsettled;
            throw Error('Synthetic child read failure');
        };
        const pending = f.owner.openEdit(first, f.owner.getSnapshot().revision);
        const loading = f.owner.getSnapshot();
        assert.equal(loading.phase, 'loading');
        assert.equal(
            f.owner.acknowledgeEditPresentation(
                loading.revision,
                original.child,
                signal
            ),
            false
        );
        finishLoad();
        assert.equal(await pending, false);
        const failed = f.owner.getSnapshot();
        assert.equal(failed.phase, 'error');
        assert.equal(
            f.owner.acknowledgeEditPresentation(
                failed.revision,
                original.child,
                signal
            ),
            false
        );
        assert.equal(f.pages.getSnapshot().canNext, false);
        assert.equal(f.writes.length, 0);
    } finally {
        finishLoad();
        f.dispose();
    }
});

it('drops old credit at a fresh parent and rechecks the bindings epoch after dispatch hooks', async () => {
    const f = requiredOpenFixture([first]);
    const fresh = requiredOpenFixture([first]);
    try {
        assert(await f.fields.linkedRecords(links).readSelected());
        const present = await f.open(first);
        assert.equal(present(), true);
        f.owner.close();
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(fresh.pages.getSnapshot().canNext, false);
        await assert.rejects(
            fresh.pages.submit(fresh.pages.getSnapshot().revision),
            FormPageError
        );
        let dispatched = false;
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch() {
                        dispatched = true;
                        f.rotateConfiguration();
                        return { accepted() {}, finish() {} };
                    },
                },
            }),
            FormPageError
        );
        assert.equal(dispatched, true);
        assert.equal(f.writes.length, 0);
        assert.equal(fresh.writes.length, 0);
        assert.equal(present(), false);
        assert.equal(f.pages.getSnapshot().canSubmit, false);
    } finally {
        fresh.dispose();
        f.dispose();
    }
});

it('refuses transport when the final owner observation advances the linked configuration', async () => {
    let dispatched = false;
    let armed = false;
    let rotated = false;
    const f = requiredOpenFixture([first], {
        configuration() {
            if (dispatched && !rotated) armed = true;
        },
        scope() {
            if (armed) {
                armed = false;
                rotated = true;
                f.rotateConfiguration();
            }
        },
    });
    try {
        assert(await f.fields.linkedRecords(links).readSelected());
        assert((await f.open(first))());
        f.owner.close();
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        await assert.rejects(
            f.pages.submit(f.pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch() {
                        dispatched = true;
                        return { accepted() {}, finish() {} };
                    },
                },
            }),
            FormPageError
        );
        assert.equal(rotated, true);
        assert.equal(f.writes.length, 0);
    } finally {
        f.dispose();
    }
});

for (const kind of ['scope', 'session', 'configuration'] as const) {
    it(
        'refuses a change to ' + kind + ' during final linked admission',
        async () => {
            let finalAdmission = false;
            let checkScope = false;
            let changed = false;
            const f = requiredOpenFixture([first], {
                configuration() {
                    if (!finalAdmission || changed) return;
                    if (kind === 'configuration') checkScope = true;
                    else {
                        changed = true;
                        f.replaceOwner(kind);
                    }
                },
                scope() {
                    if (!checkScope) return;
                    checkScope = false;
                    changed = true;
                    f.rotateConfiguration();
                },
            });
            const finishes: string[] = [];
            try {
                assert(await f.fields.linkedRecords(links).readSelected());
                assert((await f.open(first))());
                f.owner.close();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const lifecycle = withFormSaveAdmission(
                    {
                        dispatch() {
                            return {
                                accepted() {},
                                finish(disposition) {
                                    finishes.push(disposition);
                                },
                            };
                        },
                    },
                    () => {},
                    () => {
                        finalAdmission = true;
                    }
                );
                const outcome = await f.pages
                    .submit(f.pages.getSnapshot().revision, {
                        lifecycle,
                    })
                    .then(
                        () => null,
                        (error: unknown) => error
                    );
                assert.equal(changed, true);
                assert.deepEqual(
                    { writes: f.writes.length, finishes },
                    { writes: 0, finishes: ['not-dispatched'] }
                );
                if (kind === 'configuration') {
                    assert(outcome instanceof FormPageError);
                    assert.equal(outcome.reason, 'stale-revision');
                } else {
                    assert(outcome instanceof FormControllerError);
                    assert.equal(outcome.code, 'scope-changed');
                }
            } finally {
                f.dispose();
            }
        }
    );
}
