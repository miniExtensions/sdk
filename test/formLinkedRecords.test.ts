import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormLinkedRecordLoader } from '../src/ui/loaders.js';
import type {
    AirtableRecord,
    FormLoadedResult,
    LoadSelectedRecordsResult,
    MiniExtensionsClient,
    RuntimeAirtableField,
    RuntimeSession,
} from '../src/runtime/types.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

const metadata: RuntimeAirtableField = {
    id: 'fld_name',
    name: 'Name',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: 'singleLineText', options: null },
};
const record = (id: string) => ({ id, fields: { fld_name: id } });
const table = (records: ReturnType<typeof record>[]) => ({
    airtableFields: [metadata],
    recordIdsToAirtableRecords: Object.fromEntries(
        records.map((r) => [r.id, r])
    ),
});
const richForm = () => {
    const loaded = loadedForm();
    for (const [id, native] of [
        ['fld_a', ['rec_a', 'rec_a']],
        ['fld_b', ['rec_b']],
    ] as const) {
        loaded.payload.fieldIdsInForm.push(id);
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'multipleRecordLinks',
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'multipleRecordLinks',
                    options: {
                        linkedTableId: 'tbl_linked',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
            miniExtConfig: {},
        };
        loaded.payload.formRecord.data[id] = [...native];
    }
    return loaded;
};
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
};
const fixture = (
    loaded = richForm(),
    read: () => Promise<LoadSelectedRecordsResult> = async () => ({
        tbl_linked: table([
            record('rec_a'),
            record('rec_b'),
            record('rec_extra'),
        ]),
        tbl_foreign: table([record('rec_foreign')]),
    }),
    initialSession: RuntimeSession = { visitor: 'A' }
) => {
    let session: RuntimeSession = { ...initialSession };
    let configuration = 0;
    const calls: { input: unknown; signal?: AbortSignal }[] = [];
    const client = {
        getSession: () => ({ ...session }),
        setSession: (next: RuntimeSession) => {
            session = { ...next };
        },
        linkedRecords: {
            loadSelectedRecords: async (
                input: unknown,
                options: { signal?: AbortSignal }
            ) => {
                calls.push({ input, signal: options.signal });
                return read();
            },
            listFormOptions: async () => ({
                records: [record('rec_candidate')],
                offset: null,
                tableIdsToLinkedTableStates: {
                    tbl_linked: table([record('rec_candidate')]),
                },
                linkedRecordFieldIdToDetailFields: null,
            }),
        },
    } as unknown as MiniExtensionsClient;
    const fields = createFormFieldBindings({
        loaded,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
        configurationRevision: () => configuration,
    });
    return {
        fields,
        client,
        calls,
        replace: () => {
            configuration++;
        },
    };
};

it('Form rich facets share one explicit token-only hydration and isolate per-field native selections', async () => {
    const pending = deferred<LoadSelectedRecordsResult>();
    const f = fixture(richForm(), () => pending.promise);
    const a = f.fields.linkedRecords('fld_a'),
        b = f.fields.linkedRecords('fld_b');
    assert.equal(a, f.fields.linkedRecords('fld_a'));
    const stop = a.subscribe(() => {});
    assert.equal(f.calls.length, 0);
    const first = a.readSelected(),
        second = b.readSelected();
    await Promise.resolve();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].input, {
        extensionAccessToken: f.fields.getLoaded().payload.extensionAccessToken,
    });
    assert.equal(a.getSnapshot().pending, true);
    pending.resolve({
        tbl_linked: table([
            record('rec_a'),
            record('rec_b'),
            record('rec_extra'),
        ]),
    });
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.deepEqual(
        a.getSnapshot().selectedRecords.map((r) => r.id),
        ['rec_a', 'rec_a']
    );
    assert.deepEqual(
        b.getSnapshot().selectedRecords.map((r) => r.id),
        ['rec_b']
    );
    assert.equal(await b.readSelected(), true);
    assert.equal(
        f.calls.length,
        1,
        'Accepted hydration is reused until owner replacement'
    );
    assert.equal('recordIdsToAirtableRecords' in a.getSnapshot().table!, false);
    const snapshot = a.getSnapshot();
    (snapshot.selectedRecords[0].fields as Record<string, unknown>).fld_name =
        'mutated';
    assert.equal(a.getSnapshot().selectedRecords[0].fields.fld_name, 'rec_a');
    f.fields.controller.write('fld_a', ['rec_extra', 'rec_extra']);
    assert.deepEqual(a.getSnapshot().selectedRecords, []);
    assert.deepEqual(a.getSnapshot().unresolvedSelectedIds, [
        'rec_extra',
        'rec_extra',
    ]);
    stop();
    f.fields.destroy();
});

it('Form rich facets preserve missing, null and present-empty detail projection', () => {
    for (const mode of [
        'missing',
        'missing-map',
        'null-map',
        'null-field',
        'empty',
    ] as const) {
        const loaded = richForm();
        if (mode === 'missing-map')
            delete (loaded.payload as Partial<FormLoadedResult['payload']>)
                .linkedRecordFieldIdToDetailFields;
        if (mode === 'null-map')
            loaded.payload.linkedRecordFieldIdToDetailFields = null as never;
        if (mode === 'null-field')
            loaded.payload.linkedRecordFieldIdToDetailFields.fld_a =
                null as never;
        if (mode === 'empty')
            loaded.payload.linkedRecordFieldIdToDetailFields.fld_a = [];
        const f = fixture(loaded),
            snapshot = f.fields.linkedRecords('fld_a').getSnapshot();
        assert.equal(
            snapshot.detailProjection,
            mode === 'empty'
                ? 'present'
                : mode === 'missing' || mode === 'missing-map'
                  ? 'missing'
                  : 'null'
        );
        assert.deepEqual(snapshot.detailFields, mode === 'empty' ? [] : null);
        assert.equal(f.calls.length, 0);
        f.fields.destroy();
    }
});

it('unsupported selected sort suppresses records without changing native values', async () => {
    const loaded = richForm();
    loaded.payload.fieldIdsToSchemas.fld_a.miniExtConfig = {
        sortFields: [{ fieldId: 'fld_name', direction: 'asc' }],
    } as never;
    const f = fixture(loaded),
        facet = f.fields.linkedRecords('fld_a');
    assert.equal(await facet.readSelected(), true);
    assert.deepEqual(facet.getSnapshot().selectedPolicy, {
        supported: false,
        reasons: ['selected-sort'],
    });
    assert.deepEqual(facet.getSnapshot().selectedRecords, []);
    assert.deepEqual(f.fields.field('fld_a').getSnapshot().value, [
        'rec_a',
        'rec_a',
    ]);
    f.fields.destroy();
});

it('hydration failure requires explicit retry and stale completion cannot publish rich records', async () => {
    let attempt = 0;
    const pending = deferred<LoadSelectedRecordsResult>();
    const f = fixture(richForm(), async () => {
        if (++attempt === 1) throw Error('synthetic failure');
        return pending.promise;
    });
    const facet = f.fields.linkedRecords('fld_a');
    assert.equal(await facet.readSelected(), false);
    assert.equal(facet.getSnapshot().phase, 'error');
    assert.equal(f.calls.length, 1);
    const retry = facet.readSelected();
    await Promise.resolve();
    f.replace();
    assert.equal(facet.getSnapshot().phase, 'retired');
    assert.equal(f.calls[1].signal?.aborted, true);
    pending.resolve({ tbl_linked: table([record('rec_a')]) });
    assert.equal(await retry, false);
    assert.deepEqual(facet.getSnapshot().selectedRecords, []);
    f.fields.destroy();
});

it('accepted candidate records resolve newly selected options and retire on loader replacement', async () => {
    const f = fixture();
    f.fields.setLinkedLoader(
        'fld_a',
        createFormLinkedRecordLoader({
            client: f.client,
            linkedTableId: 'tbl_linked',
            input: {
                extensionAccessToken:
                    f.fields.getLoaded().payload.extensionAccessToken,
                linkedRecordFieldId: 'fld_a',
                conditionalLinkedRecordFilteringValues: {},
            },
        })
    );
    const facet = f.fields.linkedRecords('fld_a');
    await f.fields.field('fld_a').selection!.reload();
    assert.deepEqual(
        facet.getSnapshot().candidateRecords.map((r) => r.id),
        ['rec_candidate']
    );
    assert.equal(
        f.fields.field('fld_a').setValue(['rec_candidate']).accepted,
        true
    );
    assert.deepEqual(
        facet.getSnapshot().selectedRecords.map((r) => r.id),
        ['rec_candidate']
    );
    f.fields.field('fld_a').selection!.setSearchInput('new');
    assert.deepEqual(facet.getSnapshot().candidateRecords, []);
    assert.deepEqual(
        facet.getSnapshot().selectedRecords.map((r) => r.id),
        ['rec_candidate']
    );
    f.fields.setLinkedOptions('fld_a', []);
    assert.equal(facet.getSnapshot().phase, 'retired');
    const next = f.fields.linkedRecords('fld_a');
    assert.deepEqual(next.getSnapshot().selectedRecords, []);
    assert.deepEqual(next.getSnapshot().unresolvedSelectedIds, [
        'rec_candidate',
    ]);
    f.fields.destroy();
});

it('every facet listener rechecks configuration and no facet destruction clears native drafts', async () => {
    const f = fixture(),
        facet = f.fields.linkedRecords('fld_a');
    let armed = false;
    let observed = '';
    facet.subscribe(() => {
        if (armed) f.replace();
    });
    facet.subscribe((snapshot) => {
        observed = snapshot.phase;
    });
    armed = true;
    await facet.readSelected();
    assert.equal(observed, 'retired');
    assert.deepEqual(f.fields.field('fld_a').getSnapshot().value, [
        'rec_a',
        'rec_a',
    ]);
    f.fields.destroy();
});

it('session replacement retires rich records and aborts pending hydration', async () => {
    const pending = deferred<LoadSelectedRecordsResult>();
    const f = fixture(richForm(), () => pending.promise),
        facet = f.fields.linkedRecords('fld_a');
    const read = facet.readSelected();
    await Promise.resolve();
    f.client.setSession({ visitor: 'B' });
    assert.equal(facet.getSnapshot().phase, 'retired');
    assert.equal(f.calls[0].signal?.aborted, true);
    pending.resolve({ tbl_linked: table([record('rec_a')]) });
    assert.equal(await read, false);
    assert.equal(f.calls.length, 1);
    f.fields.destroy();
});

it('canonical selected-condition defaults are unsupported unless disabled or finder-only', async () => {
    for (const mode of ['default', 'selected', 'disabled', 'finder'] as const) {
        const loaded = richForm();
        loaded.payload.fieldIdsToSchemas.fld_a.miniExtConfig = {
            filterLinkedRecordsConditionFields: {
                logicalOperator: 'and',
                conditions: [
                    { fieldId: 'fld_name', operator: 'is', value: 'x' },
                ],
            },
            ...(mode === 'selected'
                ? { filterApplicationMode: 'selected-records' }
                : {}),
            ...(mode === 'disabled'
                ? { filterLinkedRecordsToggle: false }
                : {}),
            ...(mode === 'finder'
                ? { filterApplicationMode: 'record-finder-only' }
                : {}),
        } as never;
        const f = fixture(loaded),
            facet = f.fields.linkedRecords('fld_a');
        assert.equal(await facet.readSelected(), true);
        const blocked = mode === 'default' || mode === 'selected';
        assert.deepEqual(facet.getSnapshot().selectedPolicy, {
            supported: !blocked,
            reasons: blocked ? ['selected-condition'] : [],
        });
        assert.equal(
            facet.getSnapshot().selectedRecords.length,
            blocked ? 0 : 2
        );
        f.fields.destroy();
    }
});

it('explicit Form reload retires facets and pending hydration before the replacement read', async () => {
    const selected = deferred<LoadSelectedRecordsResult>(),
        replacement = deferred<FormLoadedResult>();
    const f = fixture(richForm(), () => selected.promise);
    const facet = f.fields.linkedRecords('fld_a'),
        read = facet.readSelected();
    await Promise.resolve();
    const reload = f.fields.reload({
        dirty: 'discard',
        read: () => replacement.promise,
    });
    assert.equal(facet.getSnapshot().phase, 'retired');
    assert.equal(f.calls[0].signal?.aborted, true);
    assert.throws(() => f.fields.linkedRecords('fld_a'), /idle Form owner/);
    selected.resolve({ tbl_linked: table([record('rec_a')]) });
    assert.equal(await read, false);
    replacement.resolve(richForm());
    assert.equal(await reload, true);
    assert.notEqual(f.fields.linkedRecords('fld_a'), facet);
    f.fields.destroy();
});

it('malformed hydration fails closed without installing a table-wide cache', async () => {
    const f = fixture(richForm(), async () => ({
        tbl_linked: {
            airtableFields: [metadata, metadata],
            recordIdsToAirtableRecords: { rec_a: record('rec_a') },
        },
    }));
    const facet = f.fields.linkedRecords('fld_a');
    assert.equal(await facet.readSelected(), false);
    assert.equal(facet.getSnapshot().phase, 'error');
    assert.equal(facet.getSnapshot().table, null);
    assert.deepEqual(facet.getSnapshot().selectedRecords, []);
    assert.deepEqual(f.fields.field('fld_a').getSnapshot().value, [
        'rec_a',
        'rec_a',
    ]);
    f.fields.destroy();
});

it('facet replacement observers cannot capture option records from a retired loader', async () => {
    const f = fixture();
    f.fields.setLinkedLoader(
        'fld_a',
        createFormLinkedRecordLoader({
            client: f.client,
            linkedTableId: 'tbl_linked',
            input: {
                extensionAccessToken:
                    f.fields.getLoaded().payload.extensionAccessToken,
                linkedRecordFieldId: 'fld_a',
                conditionalLinkedRecordFilteringValues: {},
            },
        })
    );
    const facet = f.fields.linkedRecords('fld_a');
    await f.fields.field('fld_a').selection!.reload();
    f.fields.field('fld_a').setValue(['rec_candidate']);
    let refused = false;
    facet.subscribe((snapshot) => {
        if (snapshot.phase === 'retired') {
            assert.throws(
                () => f.fields.linkedRecords('fld_a'),
                /idle Form owner/
            );
            refused = true;
        }
    });
    f.fields.setLinkedOptions('fld_a', []);
    assert.equal(refused, true);
    assert.deepEqual(
        f.fields.linkedRecords('fld_a').getSnapshot().selectedRecords,
        []
    );
    f.fields.destroy();
});

it('dirty keep does not promote another field hydrated ID into original selection authority', async () => {
    const f = fixture();
    f.fields.controller.write('fld_a', ['rec_b']);
    assert.equal(
        await f.fields.reload({ dirty: 'keep', read: async () => richForm() }),
        true
    );
    const a = f.fields.linkedRecords('fld_a'),
        b = f.fields.linkedRecords('fld_b');
    assert.equal(await a.readSelected(), true);
    assert.deepEqual(f.fields.field('fld_a').getSnapshot().value, ['rec_b']);
    assert.deepEqual(a.getSnapshot().selectedRecords, []);
    assert.deepEqual(a.getSnapshot().unresolvedSelectedIds, ['rec_b']);
    assert.deepEqual(
        b.getSnapshot().selectedRecords.map((r) => r.id),
        ['rec_b']
    );
    f.fields.destroy();
});

it('selected hydration rejects record IDs claimed by distinct physical tables', async () => {
    const f = fixture(richForm(), async () => ({
        tbl_linked: table([record('rec_a')]),
        tbl_foreign: table([
            { id: 'rec_a', fields: { fld_name: 'Conflicting foreign value' } },
        ]),
    }));
    const facet = f.fields.linkedRecords('fld_a');
    assert.equal(await facet.readSelected(), false);
    assert.equal(facet.getSnapshot().phase, 'error');
    assert.equal(
        facet.getSnapshot().error,
        'Selected linked records could not be loaded. Retry explicitly.'
    );
    assert.deepEqual(facet.getSnapshot().selectedRecords, []);
    assert.equal(facet.getSnapshot().table, null);
    assert.deepEqual(f.fields.field('fld_a').getSnapshot().value, [
        'rec_a',
        'rec_a',
    ]);
    facet.getSnapshot();
    assert.equal(
        f.calls.length,
        1,
        'Malformed response must not trigger an implicit retry'
    );
    f.fields.destroy();
});

it('same-visitor foreign SDK field and token pages retain native options without rich data', async () => {
    for (const foreign of ['field', 'token'] as const) {
        const f = fixture();
        const loader = createFormLinkedRecordLoader({
            client: f.client,
            linkedTableId: 'tbl_linked',
            input: {
                extensionAccessToken:
                    foreign === 'token'
                        ? 'foreign_extension_token'
                        : f.fields.getLoaded().payload.extensionAccessToken,
                linkedRecordFieldId: foreign === 'field' ? 'fld_b' : 'fld_a',
                conditionalLinkedRecordFilteringValues: {},
            },
        });
        const page = await loader({
            searchTerm: '',
            offset: null,
            signal: new AbortController().signal,
        });
        f.fields.setLinkedLoader('fld_a', async () => page);
        const binding = f.fields.field('fld_a'),
            facet = f.fields.linkedRecords('fld_a');
        await binding.selection!.reload();
        assert.deepEqual(binding.selection!.getState().options, [
            { value: 'rec_candidate', label: 'rec_candidate' },
        ]);
        assert.equal(binding.selection!.getState().linkedRecords, undefined);
        assert.deepEqual(facet.getSnapshot().candidateRecords, []);
        assert.equal(binding.setValue(['rec_candidate']).accepted, true);
        assert.deepEqual(facet.getSnapshot().selectedRecords, []);
        assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, [
            'rec_candidate',
        ]);
        assert.equal(f.calls.length, 0);
        f.fields.destroy();
    }
});

it('a cached SDK page cannot expose rich records to a distinct receiving client', async () => {
    const producer = fixture();
    const loader = createFormLinkedRecordLoader({
        client: producer.client,
        linkedTableId: 'tbl_linked',
        input: {
            extensionAccessToken:
                producer.fields.getLoaded().payload.extensionAccessToken,
            linkedRecordFieldId: 'fld_a',
            conditionalLinkedRecordFilteringValues: {},
        },
    });
    const page = await loader({
        searchTerm: '',
        offset: null,
        signal: new AbortController().signal,
    });
    for (const visitor of ['A', 'B']) {
        const receiver = fixture(richForm(), undefined, { visitor });
        assert.notEqual(receiver.client, producer.client);
        assert.equal(
            loader.isCurrent?.(),
            true,
            'The original source remains current'
        );
        receiver.fields.setLinkedLoader('fld_a', async () => page);
        const binding = receiver.fields.field('fld_a');
        await binding.selection!.reload();
        assert.deepEqual(binding.selection!.getState().options, [
            { value: 'rec_candidate', label: 'rec_candidate' },
        ]);
        assert.equal(binding.selection!.getState().linkedRecords, undefined);
        const facet = receiver.fields.linkedRecords('fld_a');
        assert.deepEqual(facet.getSnapshot().candidateRecords, []);
        assert.equal(binding.setValue(['rec_candidate']).accepted, true);
        assert.deepEqual(facet.getSnapshot().selectedRecords, []);
        assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, [
            'rec_candidate',
        ]);
        assert.equal(receiver.calls.length, 0);
        receiver.fields.destroy();
    }
    producer.fields.destroy();
});

it('linked native blank values remain empty in the rich facet without normalizing the draft', () => {
    for (const native of [undefined, null, [], '', ' \n\t ']) {
        const loaded = richForm();
        if (native === undefined) delete loaded.payload.formRecord.data.fld_a;
        else loaded.payload.formRecord.data.fld_a = native;
        const f = fixture(loaded),
            facet = f.fields.linkedRecords('fld_a');
        assert.equal(facet.getSnapshot().phase, 'idle');
        assert.deepEqual(facet.getSnapshot().selectedRecords, []);
        assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, []);
        assert.deepEqual(f.fields.field('fld_a').getSnapshot().value, native);
        assert.equal(f.calls.length, 0);
        f.fields.destroy();
    }
});
