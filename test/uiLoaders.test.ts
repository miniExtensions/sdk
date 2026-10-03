import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AirtableFieldType,
    createMiniExtensionsClient,
    type AirtableRecord,
    type AirtableValue,
    type ListFormLinkedRecordOptionsInput,
    type ListLinkedRecordOptionsResult,
    type ListPortalLinkedRecordOptionsInput,
    type RuntimeRequestOptions,
    type RuntimeSession,
} from '../src/runtime/index.js';
import {
    createFormLinkedRecordLoader,
    createPortalLinkedRecordLoader,
    SelectionScopeChangedError,
    selectionOptionsFromRecords,
} from '../src/ui/loaders.js';
import type { SelectionRequest } from '../src/ui/types.js';

const formInput: Omit<ListFormLinkedRecordOptionsInput, 'filter' | 'offset'> = {
    extensionAccessToken: 'access_example',
    linkedRecordFieldId: 'field_projects',
    conditionalLinkedRecordFilteringValues: {
        field_region: { recordId: 'record_region', stringValue: 'North' },
        field_empty: null,
    },
};
const portalInput: Omit<
    ListPortalLinkedRecordOptionsInput,
    'filter' | 'offset'
> = {
    extensionAccessToken: 'portal_access_example',
    linkedRecordFieldId: 'field_projects',
    portalTableId: 'table_people',
    portalFieldId: 'field_portal_projects',
};
type SelectorTableState =
    ListLinkedRecordOptionsResult['tableIdsToLinkedTableStates'][string];

const table: SelectorTableState = {
    airtableFields: [
        {
            id: 'field_title',
            name: 'Title',
            description: null,
            isComputed: false,
            isPrimaryField: true,
            config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
        },
    ],
    recordIdsToAirtableRecords: {},
};
const records: AirtableRecord[] = [
    { id: 'record_first', fields: { field_title: 'First project' } },
    { id: 'record_second', fields: { Title: 'Second project' } },
];
const result = (): ListLinkedRecordOptionsResult => ({
    records: structuredClone(records),
    offset: 'next_page',
    tableIdsToLinkedTableStates: { table_projects: structuredClone(table) },
});
const request = (
    searchTerm = '',
    offset: string | null = null,
    signal = new AbortController().signal
): SelectionRequest => ({ searchTerm, offset, signal });

type Call = {
    operation: 'form' | 'portal';
    input:
        | ListFormLinkedRecordOptionsInput
        | ListPortalLinkedRecordOptionsInput;
    options: RuntimeRequestOptions | undefined;
};
const fixture = (
    respond: (
        call: Call
    ) => Promise<ListLinkedRecordOptionsResult> = async () => result()
) => {
    const calls: Call[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'visitor_A' },
        fetch: async () => {
            throw new Error(
                'The fixture must use the existing client methods.'
            );
        },
    });
    client.linkedRecords.listFormOptions = (input, options) => {
        const call: Call = { operation: 'form', input, options };
        calls.push(call);
        return respond(call);
    };
    client.linkedRecords.listPortalOptions = (input, options) => {
        const call: Call = { operation: 'portal', input, options };
        calls.push(call);
        return respond(call);
    };
    return { client, calls };
};
const deferred = () => {
    let resolve!: (value: ListLinkedRecordOptionsResult) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<ListLinkedRecordOptionsResult>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

describe('linked record UI loaders', () => {
    it('uses the existing Form operation with exact filter, paging, signal and captured session', async () => {
        const { client, calls } = fixture();
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        const nextRequest = request('project', 'after_page');
        assert.deepEqual(await load(nextRequest), {
            options: [
                { value: 'record_first', label: 'First project' },
                { value: 'record_second', label: 'Second project' },
            ],
            offset: 'next_page',
        });
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], {
            operation: 'form',
            input: {
                ...formInput,
                filter: { viewType: 'list', searchTerm: 'project' },
                offset: 'after_page',
            },
            options: {
                signal: nextRequest.signal,
                session: { visitor: 'visitor_A' },
            },
        });
        assert.equal(calls[0].options?.signal, nextRequest.signal);
    });

    it('uses the Portal operation and canonical fetched table for a custom label', async () => {
        const { client, calls } = fixture();
        const load = createPortalLinkedRecordLoader({
            client,
            input: portalInput,
            linkedTableId: 'table_projects',
            formatRecordLabel: (record, currentTable) => {
                assert.deepEqual(currentTable, table);
                return `Project ${record.id}`;
            },
        });
        const nextRequest = request();
        assert.deepEqual(await load(nextRequest), {
            options: records.map((record) => ({
                value: record.id,
                label: `Project ${record.id}`,
            })),
            offset: 'next_page',
        });
        assert.deepEqual(calls[0], {
            operation: 'portal',
            input: {
                ...portalInput,
                filter: { viewType: 'list', searchTerm: '' },
                offset: null,
            },
            options: {
                signal: nextRequest.signal,
                session: { visitor: 'visitor_A' },
            },
        });
    });

    it('snapshots nested inputs and client references and gives each request independent copies', async () => {
        const { client, calls } = fixture(async (call) => {
            if (calls.length === 1) {
                call.input.extensionAccessToken = 'mutated_by_client';
                assert.ok(
                    'conditionalLinkedRecordFilteringValues' in call.input
                );
                call.input.conditionalLinkedRecordFilteringValues.field_region =
                    null;
                assert.ok(call.options?.session);
                (call.options.session as RuntimeSession).visitor = 'mutated';
            }
            return result();
        });
        const input = structuredClone(formInput);
        const options = { client, input, linkedTableId: 'table_projects' };
        const load = createFormLinkedRecordLoader(options);
        input.extensionAccessToken = 'mutated_by_caller';
        input.conditionalLinkedRecordFilteringValues.field_region = null;
        options.client = fixture().client;
        await load(request());
        await load(request());
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[1].input, {
            ...formInput,
            filter: { viewType: 'list', searchTerm: '' },
            offset: null,
        });
        assert.deepEqual(calls[1].options?.session, { visitor: 'visitor_A' });
        assert.deepEqual(client.getSession(), { visitor: 'visitor_A' });
    });

    it('rejects before dispatch after a session value, key or credential changes', async () => {
        const sessions: RuntimeSession[] = [
            { visitor: 'visitor_B' },
            {},
            { visitor: 'visitor_A', extension: 'password_credential' },
        ];
        for (const session of sessions) {
            const { client, calls } = fixture();
            const load = createFormLinkedRecordLoader({
                client,
                input: formInput,
                linkedTableId: 'table_projects',
            });
            assert.equal(load.isCurrent?.(), true);
            client.setSession(session);
            assert.equal(load.isCurrent?.(), false);
            await assert.rejects(load(request()), SelectionScopeChangedError);
            assert.equal(calls.length, 0);
        }
    });

    it('reports an unreadable current session as stale without throwing', () => {
        const { client } = fixture();
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        client.getSession = () => {
            throw new Error('Unavailable fixture session');
        };
        assert.equal(load.isCurrent?.(), false);
    });

    it('accepts an equivalent reordered session and a fresh loader for a new visitor', async () => {
        const { client, calls } = fixture();
        client.setSession({ visitor: 'visitor_A', extension: 'credential_A' });
        const first = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        client.setSession({ extension: 'credential_A', visitor: 'visitor_A' });
        await first(request());
        client.setSession({ visitor: 'visitor_B' });
        const next = createFormLinkedRecordLoader({
            client,
            input: { ...formInput, extensionAccessToken: 'new_access_example' },
            linkedTableId: 'table_projects',
        });
        await next(request());
        assert.deepEqual(calls[1].options?.session, { visitor: 'visitor_B' });
        assert.equal(calls[1].input.extensionAccessToken, 'new_access_example');
        await assert.rejects(first(request()), SelectionScopeChangedError);
    });

    it('rejects an in-flight response from the previous visitor even when the client ignores abort', async () => {
        const pending = deferred();
        const { client, calls } = fixture(() => pending.promise);
        const load = createPortalLinkedRecordLoader({
            client,
            input: portalInput,
            linkedTableId: 'table_projects',
        });
        const loading = load(request());
        client.setSession({ visitor: 'visitor_B' });
        pending.resolve(result());
        await assert.rejects(loading, SelectionScopeChangedError);
        assert.deepEqual(calls[0].options?.session, { visitor: 'visitor_A' });
        assert.deepEqual(client.getSession(), { visitor: 'visitor_B' });
    });

    it('does not dispatch an already cancelled request', async () => {
        const { client, calls } = fixture();
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        const controller = new AbortController();
        const cancellation = new Error('Cancelled fixture request');
        controller.abort(cancellation);
        await assert.rejects(load(request('', null, controller.signal)), {
            message: cancellation.message,
        });
        assert.equal(calls.length, 0);
    });

    it('rejects an aborted stale search while returning the newer search', async () => {
        const old = deferred();
        const current = deferred();
        const { client } = fixture((call) =>
            call.input.filter.viewType === 'list' &&
            call.input.filter.searchTerm === 'old'
                ? old.promise
                : current.promise
        );
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        const controller = new AbortController();
        const previous = load(request('old', null, controller.signal));
        const newest = load(request('new'));
        controller.abort();
        current.resolve({ ...result(), offset: null });
        assert.equal((await newest).offset, null);
        old.resolve(result());
        await assert.rejects(previous, { name: 'AbortError' });
    });

    it('preserves API failures without mutating the visitor session', async () => {
        const failure = new Error('The fixture server denied this request.');
        const { client } = fixture(async () => {
            throw failure;
        });
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        await assert.rejects(load(request()), (error) => error === failure);
        assert.deepEqual(client.getSession(), { visitor: 'visitor_A' });
    });

    it('checks scope again after a custom formatter changes the session', async () => {
        const { client } = fixture();
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
            formatRecordLabel: (record) => {
                client.setSession({ visitor: 'visitor_B' });
                return record.id;
            },
        });
        await assert.rejects(load(request()), SelectionScopeChangedError);
    });

    it('fails safely for malformed pages, records and cursors', async () => {
        const malformed: unknown[] = [
            null,
            { ...result(), records: null },
            { ...result(), offset: false },
            { ...result(), tableIdsToLinkedTableStates: null },
            { ...result(), records: [{ id: '', fields: {} }] },
            { ...result(), records: [{ id: 'record_invalid', fields: [] }] },
        ];
        for (const value of malformed) {
            const { client } = fixture(
                async () => value as ListLinkedRecordOptionsResult
            );
            const load = createFormLinkedRecordLoader({
                client,
                input: formInput,
                linkedTableId: 'table_projects',
            });
            await assert.rejects(load(request()), TypeError);
        }
        const { client, calls } = fixture();
        const load = createFormLinkedRecordLoader({
            client,
            input: formInput,
            linkedTableId: 'table_projects',
        });
        await assert.rejects(
            load({
                ...request(),
                searchTerm: 1,
            } as unknown as SelectionRequest),
            TypeError
        );
        await assert.rejects(
            load({
                ...request(),
                offset: false,
            } as unknown as SelectionRequest),
            TypeError
        );
        assert.equal(calls.length, 0);
    });

    it('rejects empty authority and table identifiers at construction', () => {
        const { client } = fixture();
        for (const input of [
            { ...formInput, extensionAccessToken: '' },
            { ...formInput, linkedRecordFieldId: ' ' },
        ]) {
            assert.throws(
                () =>
                    createFormLinkedRecordLoader({
                        client,
                        input,
                        linkedTableId: 'table_projects',
                    }),
                TypeError
            );
        }
        assert.throws(
            () =>
                createFormLinkedRecordLoader({
                    client,
                    input: formInput,
                    linkedTableId: '',
                }),
            TypeError
        );
        for (const input of [
            { ...portalInput, portalFieldId: '' },
            { ...portalInput, portalTableId: ' ' },
        ]) {
            assert.throws(
                () =>
                    createPortalLinkedRecordLoader({
                        client,
                        input,
                        linkedTableId: 'table_projects',
                    }),
                TypeError
            );
        }
    });
});

describe('linked record option labels and hydration', () => {
    it('retains record IDs and reads ID-keyed values before name-keyed values', () => {
        assert.deepEqual(
            selectionOptionsFromRecords(
                [
                    {
                        id: 'record_id_wins',
                        fields: { field_title: 'Canonical', Title: 'Other' },
                    },
                    {
                        id: 'record_blank_id',
                        // @ts-expect-error -- An explicit undefined own property is deliberate malformed JavaScript input, absent from canonical JSON.
                        fields: { field_title: undefined, Title: 'Other' },
                    },
                    { id: 'record_name', fields: { Title: 'Name-keyed' } },
                ],
                table
            ),
            [
                { value: 'record_id_wins', label: 'Canonical' },
                { value: 'record_blank_id', label: 'record_blank_id' },
                { value: 'record_name', label: 'Name-keyed' },
            ]
        );
    });

    it('hydrates selected records absent from the options page and supports scalar and stable JSON labels', () => {
        const values: AirtableValue[] = [
            0,
            false,
            { name: 'Ada', id: 'user_example', email: 'ada@example.test' },
            [
                {
                    filename: 'example.txt',
                    url: 'https://files.example.test/file',
                },
            ],
        ];
        const selected = values.map((value, index) => ({
            id: `record_selected_${index}`,
            fields: { field_title: value },
        }));
        const hydratedTable = {
            ...table,
            recordIdsToAirtableRecords: Object.fromEntries(
                selected.map((record) => [record.id, record])
            ),
        };
        assert.deepEqual(
            selectionOptionsFromRecords(
                Object.values(hydratedTable.recordIdsToAirtableRecords),
                hydratedTable
            ),
            [
                { value: 'record_selected_0', label: '0' },
                { value: 'record_selected_1', label: 'false' },
                {
                    value: 'record_selected_2',
                    label: '{"email":"ada@example.test","id":"user_example","name":"Ada"}',
                },
                {
                    value: 'record_selected_3',
                    label: '[{"filename":"example.txt","url":"https://files.example.test/file"}]',
                },
            ]
        );
    });

    it('uses IDs when the primary field or value is missing or blank', () => {
        for (const value of [undefined, null, '', '  ']) {
            assert.deepEqual(
                selectionOptionsFromRecords(
                    [
                        {
                            id: 'record_blank',
                            fields:
                                value === undefined
                                    ? {}
                                    : { field_title: value },
                        },
                    ],
                    table
                ),
                [{ value: 'record_blank', label: 'record_blank' }]
            );
        }
        for (const metadata of [
            undefined,
            { ...table, airtableFields: [] },
            {
                ...table,
                airtableFields: table.airtableFields.map((field) => ({
                    ...field,
                    isPrimaryField: false,
                })),
            },
        ]) {
            assert.deepEqual(
                selectionOptionsFromRecords(records, metadata),
                records.map((record) => ({
                    value: record.id,
                    label: record.id,
                }))
            );
        }
        assert.deepEqual(
            selectionOptionsFromRecords(
                [{ id: 'record_own_fields', fields: {} }],
                {
                    ...table,
                    airtableFields: [
                        { ...table.airtableFields[0], name: 'constructor' },
                    ],
                }
            ),
            [{ value: 'record_own_fields', label: 'record_own_fields' }]
        );
    });

    it('uses custom formatting while preserving IDs and rejecting non-string labels', () => {
        assert.deepEqual(
            selectionOptionsFromRecords(records, table, () => ''),
            records.map((record) => ({ value: record.id, label: record.id }))
        );
        assert.throws(
            () =>
                selectionOptionsFromRecords(
                    records,
                    table,
                    (() => 1) as unknown as () => string
                ),
            TypeError
        );
    });

    it('rejects malformed metadata and non-JSON complex values rather than fabricating labels', () => {
        for (const metadata of [
            null,
            { ...table, airtableFields: null },
            { ...table, recordIdsToAirtableRecords: [] },
            { ...table, airtableFields: [null] },
            {
                ...table,
                airtableFields: [
                    { ...table.airtableFields[0], isPrimaryField: 'yes' },
                ],
            },
            {
                ...table,
                airtableFields: [
                    table.airtableFields[0],
                    { ...table.airtableFields[0], id: 'field_other_primary' },
                ],
            },
        ]) {
            assert.throws(
                () =>
                    selectionOptionsFromRecords(
                        records,
                        metadata as SelectorTableState
                    ),
                TypeError
            );
        }
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        for (const value of [Infinity, new Date(), circular, 1n]) {
            assert.throws(
                () =>
                    selectionOptionsFromRecords(
                        [
                            {
                                id: 'record_invalid',
                                fields: {
                                    field_title:
                                        value as unknown as AirtableValue,
                                },
                            },
                        ],
                        table
                    ),
                TypeError
            );
        }
    });
});
