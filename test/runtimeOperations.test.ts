import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AirtableFieldType,
    createMiniExtensionsClient,
    SDKError,
    type CreateUploadUrlInput,
    type ListPortalLinkedRecordsInput,
    type MiniExtensionsClient,
    type RuntimeConditionsDefinition,
    type RuntimeSession,
    type RuntimeTableStates,
    type UploadFileInput,
} from '../src/runtime/index.js';
import { saveInput } from './runtimeFixtures.js';

type WireRequest = {
    operation: string;
    input: unknown;
    session: RuntimeSession;
};
type CapturedRequest = { url: string; init: RequestInit };

const configuration = {
    apiOrigin: 'https://sdk.example.test',
    publishableKey: 'publishable_example',
};
const tokenInput = { extensionAccessToken: 'visitor_access' };
const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
const wireBody = (request: CapturedRequest): WireRequest =>
    JSON.parse(String(request.init.body)) as WireRequest;

const captureFetch = (
    respond: (request: CapturedRequest) => Response | Promise<Response>
) => {
    const requests: CapturedRequest[] = [];
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
        assert.ok(init);
        const request = { url: String(url), init };
        requests.push(request);
        return respond(request);
    };
    return { requests, fetchImpl };
};

const conditions: RuntimeConditionsDefinition = {
    logicalOperator: 'and',
    conditions: [
        {
            id: 'group_example',
            type: 'groupCondition',
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'condition_example',
                    type: 'singleCondition',
                    setting: {
                        idOrName: { type: 'id', id: 'fld_title' },
                        type: 'contains',
                        fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
                        value: 'Example',
                    },
                },
            ],
        },
    ],
};
const listInput: ListPortalLinkedRecordsInput = {
    ...tokenInput,
    refreshLoggedInPortalRecord: true,
    alreadyLoadedRecordIds: ['record_loaded'],
    portalFieldId: 'fld_children',
    sortFieldsByEndUser: [
        { idOrName: { type: 'id', id: 'fld_title' }, type: 'desc' },
    ],
    supportsEndUserSortCleanup: true,
    selectedCustomViewId: 'view_example',
    filtersByEndUser: conditions,
    supportsEndUserFilterCleanup: true,
    searchParamsMap: { fld_title: 'Example' },
    airtableOffset: 'next_page',
    pagesToFetch: 2,
    searchTerm: 'Example',
    calendarLayoutFilter: {
        monthToFetchRecordsFor: '2026-11',
        clientUtcOffset: -300,
        clientTimeZone: 'America/New_York',
    },
};
const record = { id: 'record_example', fields: { fld_title: 'Example' } };
const tableStates: RuntimeTableStates = {
    table_example: {
        airtableFields: [
            {
                id: 'fld_children',
                name: 'Children',
                config: {
                    type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                    options: {
                        linkedTableId: 'table_child',
                        inverseLinkFieldId: 'fld_parent',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
        ],
        recordIdsToAirtableRecords: { [record.id]: record },
    },
};
const linkedRecordsResult = {
    airtableOffset: 'later_page',
    recordIds: [record.id],
    tableIdsToLinkedTableStates: tableStates,
    customViewDetailFields: null,
};
const selectorResult = {
    records: [record],
    offset: 'later_option_page',
    tableIdsToLinkedTableStates: tableStates,
};
const formOptionsInput = {
    ...tokenInput,
    linkedRecordFieldId: 'fld_children',
    filter: {
        viewType: 'list' as const,
        searchTerm: 'Example',
        searchSource: 'barcode-scanner' as const,
    },
    offset: 'next_option_page',
    conditionalLinkedRecordFilteringValues: {
        fld_region: { recordId: 'record_region', stringValue: 'North' },
        fld_empty: null,
    },
};
const portalOptionsInput = {
    ...tokenInput,
    linkedRecordFieldId: 'fld_related',
    portalTableId: 'table_child',
    portalFieldId: 'fld_children',
    filter: {
        viewType: 'calendar' as const,
        month: '2026-11',
        clientUtcOffset: -300,
    },
    offset: null,
};
const gridInput = {
    portalExtensionAccessToken: tokenInput.extensionAccessToken,
    portalFieldId: 'fld_children',
    recordFieldId: 'fld_title',
    recordId: record.id,
    selectedCustomViewId: 'view_example',
    value: 'Updated example',
};
const unlinkInput = {
    ...tokenInput,
    portalFieldId: 'fld_children',
    recordIdToUnlink: record.id,
    selectedCustomViewId: 'view_example',
};
const kanbanInput = {
    ...tokenInput,
    portalFieldId: 'fld_children',
    recordId: record.id,
    categoryFieldValue: null,
    selectedCustomViewId: 'view_example',
};
const selectInput = {
    ...tokenInput,
    airtableFieldId: 'fld_status',
    newChoiceText: 'New, option',
};
const uploadUrlInput: CreateUploadUrlInput = {
    fileType: 'text/plain',
    filename: 'example.txt',
    fileSize: 7,
    authority: {
        type: 'form',
        ...tokenInput,
        fieldId: 'fld_files',
    },
};
const signedUpload = {
    signedUrl: 'https://upload.example.test/signed-object?signature=example',
    publicUrl: 'https://files.example.test/object',
};
const commentInput = { childExtensionAccessToken: 'child_access' };
const commentResult = {
    readableVersionOfRecordPrimaryValue: 'Example',
    comments: [
        {
            id: 'comment_example',
            createdTime: '2026-01-02T03:04:05.000Z',
            lastUpdatedTime: null,
            text: 'Example comment',
            author: {
                id: 'user_example',
                email: 'person@example.test',
                name: null,
            },
            mentioned: {
                group_example: {
                    type: 'userGroup',
                    id: 'group_example',
                    name: 'Example group',
                },
            },
        },
    ],
    disableSending: true,
};

describe('Form and Portal method contracts', () => {
    const methods: Array<{
        operation: string;
        input: object;
        response: unknown;
        expected?: unknown;
        call: (client: MiniExtensionsClient) => Promise<unknown>;
    }> = [
        {
            operation: 'portals.listLinkedRecords',
            input: listInput,
            response: linkedRecordsResult,
            call: (client) => client.portals.listLinkedRecords(listInput),
        },
        {
            operation: 'portals.getUserRecord',
            input: tokenInput,
            response: record,
            call: (client) => client.portals.getUserRecord(tokenInput),
        },
        {
            operation: 'portals.updateGridCell',
            input: gridInput,
            response: {
                record,
                auditTrail: {
                    linkedRecordsFieldToAudit: 'fld_audit',
                    recordId: 'audit_one',
                },
                auditTrails: [
                    {
                        linkedRecordsFieldToAudit: 'fld_audit',
                        recordId: 'audit_one',
                    },
                ],
            },
            call: (client) => client.portals.updateGridCell(gridInput),
        },
        {
            operation: 'portals.unlinkRecord',
            input: unlinkInput,
            response: null,
            expected: undefined,
            call: (client) => client.portals.unlinkRecord(unlinkInput),
        },
        {
            operation: 'portals.setKanbanCategory',
            input: kanbanInput,
            response: { type: 'logged-in', loggedInUserRecord: record },
            call: (client) => client.portals.setKanbanCategory(kanbanInput),
        },
        {
            operation: 'forms.deleteCurrentRecord',
            input: tokenInput,
            response: null,
            expected: undefined,
            call: (client) => client.forms.deleteCurrentRecord(tokenInput),
        },
        {
            operation: 'forms.addSelectOption',
            input: selectInput,
            response: {
                newChoice: {
                    id: 'choice_example',
                    name: 'New, option',
                    color: 'blueLight2',
                },
            },
            call: (client) => client.forms.addSelectOption(selectInput),
        },
        {
            operation: 'linkedRecords.listFormOptions',
            input: formOptionsInput,
            response: selectorResult,
            call: (client) =>
                client.linkedRecords.listFormOptions(formOptionsInput),
        },
        {
            operation: 'linkedRecords.listPortalOptions',
            input: portalOptionsInput,
            response: selectorResult,
            call: (client) =>
                client.linkedRecords.listPortalOptions(portalOptionsInput),
        },
        {
            operation: 'linkedRecords.loadSelectedRecords',
            input: tokenInput,
            response: tableStates,
            call: (client) =>
                client.linkedRecords.loadSelectedRecords(tokenInput),
        },
        {
            operation: 'attachments.createUploadUrl',
            input: uploadUrlInput,
            response: signedUpload,
            call: (client) =>
                client.attachments.createUploadUrl(uploadUrlInput),
        },
        {
            operation: 'comments.listForRecord',
            input: commentInput,
            response: commentResult,
            call: (client) => client.comments.listForRecord(commentInput),
        },
        {
            operation: 'comments.addToRecord',
            input: { ...commentInput, comment: 'Example comment' },
            response: null,
            expected: undefined,
            call: (client) =>
                client.comments.addToRecord({
                    ...commentInput,
                    comment: 'Example comment',
                }),
        },
    ];

    for (const method of methods) {
        it(`preserves ${method.operation} authority, input and result`, async () => {
            const boundary = captureFetch(() => jsonResponse(method.response));
            const session = { visitor: 'visitor_A' };
            const client = createMiniExtensionsClient({
                ...configuration,
                session,
                fetch: boundary.fetchImpl,
            });
            const inputBefore = structuredClone(method.input);
            const result = await method.call(client);
            assert.deepEqual(
                result,
                'expected' in method ? method.expected : method.response
            );
            assert.equal(boundary.requests.length, 1);
            const request = boundary.requests[0];
            assert.equal(request.url, 'https://sdk.example.test/api/sdk');
            assert.equal(request.init.method, 'POST');
            assert.equal(request.init.credentials, 'omit');
            const headers = new Headers(request.init.headers);
            assert.equal(
                headers.get('authorization'),
                'Bearer publishable_example'
            );
            assert.equal(headers.get('content-type'), 'application/json');
            assert.deepEqual(wireBody(request), {
                operation: method.operation,
                input: inputBefore,
                session,
            });
            assert.deepEqual(method.input, inputBefore);
            assert.deepEqual(client.getSession(), session);
        });
    }

    it('returns empty and cleanup Portal pages without automatically retrying or replacing filters', async () => {
        for (const output of [
            {
                ...linkedRecordsResult,
                airtableOffset: null,
                recordIds: [],
                tableIdsToLinkedTableStates: {},
            },
            {
                ...linkedRecordsResult,
                airtableOffset: null,
                recordIds: [],
                tableIdsToLinkedTableStates: {},
                endUserSortCleanup: { sortFields: [] },
            },
            {
                ...linkedRecordsResult,
                airtableOffset: null,
                recordIds: [],
                tableIdsToLinkedTableStates: {},
                endUserFilterCleanup: { filters: null },
            },
        ]) {
            const boundary = captureFetch(() => jsonResponse(output));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            assert.deepEqual(
                await client.portals.listLinkedRecords(listInput),
                output
            );
            assert.deepEqual(wireBody(boundary.requests[0]).input, listInput);
            assert.equal(boundary.requests.length, 1);
        }
    });

    it('preserves a nullable user record and the no-login Kanban result', async () => {
        const boundary = captureFetch(({ init }) =>
            jsonResponse(
                JSON.parse(String(init.body)).operation ===
                    'portals.getUserRecord'
                    ? null
                    : { type: 'no-login' }
            )
        );
        const client = createMiniExtensionsClient({
            ...configuration,
            fetch: boundary.fetchImpl,
        });
        assert.equal(await client.portals.getUserRecord(tokenInput), null);
        assert.deepEqual(await client.portals.setKanbanCategory(kanbanInput), {
            type: 'no-login',
        });
        assert.equal(boundary.requests.length, 2);
    });

    it('rejects null ordinary responses and non-null void responses without weakening protocol checks', async () => {
        for (const [response, call] of [
            [
                null,
                (client: MiniExtensionsClient) => client.forms.save(saveInput),
            ],
            [
                null,
                (client: MiniExtensionsClient) =>
                    client.portals.listLinkedRecords(listInput),
            ],
            [
                { ok: true },
                (client: MiniExtensionsClient) =>
                    client.forms.deleteCurrentRecord(tokenInput),
            ],
            [
                false,
                (client: MiniExtensionsClient) =>
                    client.portals.unlinkRecord(unlinkInput),
            ],
        ] as const) {
            const boundary = captureFetch(() => jsonResponse(response));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            await assert.rejects(
                call(client),
                (error: unknown) =>
                    error instanceof SDKError && error.kind === 'protocol'
            );
            assert.equal(boundary.requests.length, 1);
        }
    });

    it('throws an HTTP-200 endpoint error before interpreting a void mutation and never replays it', async () => {
        const boundary = captureFetch(() =>
            jsonResponse({
                error: true,
                message: 'Comment denied.',
                code: 'comment.denied',
            })
        );
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'visitor_A' },
            fetch: boundary.fetchImpl,
        });
        await assert.rejects(
            client.comments.addToRecord({
                ...commentInput,
                comment: 'Example',
            }),
            (error: unknown) => {
                assert.ok(error instanceof SDKError);
                assert.equal(error.kind, 'api');
                assert.equal(error.status, 200);
                assert.equal(error.code, 'comment.denied');
                return true;
            }
        );
        assert.equal(boundary.requests.length, 1);
        assert.deepEqual(client.getSession(), { visitor: 'visitor_A' });
    });
});

describe('attachment upload', () => {
    const input: UploadFileInput = {
        ...tokenInput,
        fieldId: 'fld_files',
        filename: 'example.txt',
        file: new Blob(['Example'], { type: 'text/plain' }),
    };

    it('uploads exact bytes with no SDK key or cookies on the signed PUT and returns unsaved attachment metadata', async () => {
        const boundary = captureFetch(({ init }) =>
            init.method === 'POST'
                ? jsonResponse(signedUpload)
                : new Response(null, { status: 204 })
        );
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'visitor_A' },
            fetch: boundary.fetchImpl,
        });
        const signal = new AbortController().signal;
        assert.deepEqual(
            await client.attachments.uploadFile(input, { signal, session: {} }),
            {
                id: null,
                url: signedUpload.publicUrl,
                filename: input.filename,
                size: input.file.size,
                type: input.file.type,
            }
        );
        assert.equal(boundary.requests.length, 2);
        assert.deepEqual(wireBody(boundary.requests[0]), {
            operation: 'attachments.createUploadUrl',
            input: uploadUrlInput,
            session: {},
        });
        const put = boundary.requests[1];
        assert.equal(put.url, signedUpload.signedUrl);
        assert.equal(put.init.method, 'PUT');
        assert.equal(put.init.body, input.file);
        assert.equal(await input.file.text(), 'Example');
        assert.equal(put.init.credentials, 'omit');
        assert.equal(put.init.signal, signal);
        assert.deepEqual(
            [...new Headers(put.init.headers)],
            [['content-type', 'text/plain']]
        );
        assert.deepEqual(client.getSession(), { visitor: 'visitor_A' });
    });

    it('does not PUT or retry when URL admission fails or returns missing upload metadata', async () => {
        for (const response of [
            { error: true, message: 'Upload denied.', code: 'upload.denied' },
            { signedUrl: signedUpload.signedUrl },
        ]) {
            const boundary = captureFetch(() => jsonResponse(response));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            await assert.rejects(
                client.attachments.uploadFile(input),
                (error: unknown) =>
                    error instanceof SDKError &&
                    error.kind === ('error' in response ? 'api' : 'protocol')
            );
            assert.equal(boundary.requests.length, 1);
        }
    });

    it('does not recreate a URL, replay a PUT, or save after an uncertain upload failure', async () => {
        for (const failure of ['http', 'network'] as const) {
            const cause = new TypeError('Synthetic upload network failure');
            const boundary = captureFetch(({ init }) => {
                if (init.method === 'POST') return jsonResponse(signedUpload);
                if (failure === 'network') return Promise.reject(cause);
                return new Response('Synthetic upload error', { status: 503 });
            });
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            await assert.rejects(
                client.attachments.uploadFile(input),
                (error: unknown) => {
                    assert.ok(error instanceof SDKError);
                    assert.equal(error.kind, failure);
                    assert.equal(
                        error.status,
                        failure === 'http' ? 503 : undefined
                    );
                    assert.equal(
                        error.cause,
                        failure === 'network' ? cause : undefined
                    );
                    return true;
                }
            );
            assert.equal(boundary.requests.length, 2);
            assert.deepEqual(
                boundary.requests.map(({ init }) => init.method),
                ['POST', 'PUT']
            );
        }
    });

    it('sends no request when upload is cancelled before it starts', async () => {
        const boundary = captureFetch(() => jsonResponse(signedUpload));
        const client = createMiniExtensionsClient({
            ...configuration,
            fetch: boundary.fetchImpl,
        });
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            client.attachments.uploadFile(input, { signal: controller.signal }),
            (error: unknown) => error === controller.signal.reason
        );
        assert.equal(boundary.requests.length, 0);
    });

    it('stops an aborted signing phase before upload and preserves replacement session B', async () => {
        const controller = new AbortController();
        const boundary = captureFetch(() => {
            controller.abort();
            return jsonResponse(signedUpload);
        });
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'visitor_A' },
            fetch: boundary.fetchImpl,
        });
        const pending = client.attachments.uploadFile(input, {
            signal: controller.signal,
        });
        client.setSession({ visitor: 'visitor_B' });
        await assert.rejects(
            pending,
            (error: unknown) => error === controller.signal.reason
        );
        assert.equal(boundary.requests.length, 1);
        assert.deepEqual(wireBody(boundary.requests[0]).session, {
            visitor: 'visitor_A',
        });
        assert.deepEqual(client.getSession(), { visitor: 'visitor_B' });
    });

    it('propagates in-flight PUT cancellation without retrying or changing the current session', async () => {
        let putStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            putStarted = resolve;
        });
        const boundary = captureFetch(({ init }) => {
            if (init.method === 'POST') return jsonResponse(signedUpload);
            return new Promise<Response>((_resolve, reject) => {
                init.signal!.addEventListener(
                    'abort',
                    () => reject(init.signal!.reason),
                    { once: true }
                );
                putStarted();
            });
        });
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'visitor_A' },
            fetch: boundary.fetchImpl,
        });
        const controller = new AbortController();
        const pending = client.attachments.uploadFile(input, {
            signal: controller.signal,
        });
        await started;
        client.setSession({ visitor: 'visitor_B' });
        controller.abort();
        await assert.rejects(
            pending,
            (error: unknown) => error === controller.signal.reason
        );
        assert.equal(boundary.requests.length, 2);
        assert.deepEqual(client.getSession(), { visitor: 'visitor_B' });
    });
});
