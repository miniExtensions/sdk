import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TRPCClientError } from '@trpc/client';
import {
    createMiniExtensionsClient,
    SDKError,
    type ConditionalFilterPrimaryValue,
    type GetFormattedAddressInput,
    type ListAddressPredictionsInput,
    type ListConditionalFilterPrimaryValuesInput,
    type MiniExtensionsClient,
    type RuntimeRequestOptions,
    type TriggerConfiguredButtonWebhookInput,
} from '../src/runtime/index.js';

const primaryValue: ConditionalFilterPrimaryValue = {
    recordId: 'rec_region',
    stringValue: 'North, East',
};
const conditionalInput: ListConditionalFilterPrimaryValuesInput = {
    extensionAccessToken: 'form_token',
    linkedRecordsFilterFieldId: 'fld_region',
    mainTableLinkedRecordsFieldId: 'fld_projects',
    searchTerm: 'North, East',
    filterData: {
        previousFilterFieldId: 'fld_country',
        previousFilterPrimaryValue: 'United States',
    },
    urlSearchValue: 'North, East',
};
const predictionInput: ListAddressPredictionsInput = {
    extensionAccessToken: 'form_token',
    fieldId: 'fld_address',
    addressFieldValue: '12 Main, Apt 2',
};
const placeInput: GetFormattedAddressInput = {
    extensionAccessToken: 'form_token',
    fieldId: 'fld_address',
    placeId: 'provider_place',
};
const currentButtonInput: TriggerConfiguredButtonWebhookInput = {
    extensionAccessToken: 'form_token',
    fieldId: 'fld_button',
    source: { type: 'current-record', recordId: 'rec_current' },
};
const linkedButtonInput: TriggerConfiguredButtonWebhookInput = {
    extensionAccessToken: 'portal_token',
    fieldId: 'fld_child_button',
    source: {
        type: 'linked-record',
        linkedRecordId: 'rec_child',
        linkedTableId: 'tbl_children',
        parentLinkedRecordFieldId: 'fld_children',
        selectedCustomViewId: 'view_current',
    },
};

type OperationCase = {
    name: string;
    route: string;
    method: 'GET' | 'POST';
    input: object;
    output: unknown;
    call: (
        client: MiniExtensionsClient,
        options?: RuntimeRequestOptions
    ) => Promise<unknown>;
};
const operations: OperationCase[] = [
    {
        name: 'conditional primary values',
        route: 'fetchPrimaryValuesForConditionalLinkedRecordFilterField',
        method: 'POST',
        input: conditionalInput,
        output: {
            primaryValues: [
                primaryValue,
                {
                    recordId: 'rec_other',
                    stringValue: primaryValue.stringValue,
                },
            ],
            prefillValue: primaryValue,
        },
        call: (client, options) =>
            client.linkedRecords.listConditionalFilterPrimaryValues(
                conditionalInput,
                options
            ),
    },
    {
        name: 'address predictions',
        route: 'publicExtensions.autoCompleteAddressField',
        method: 'GET',
        input: predictionInput,
        output: [{ description: '12 Main, Apt 2', placeId: 'provider_place' }],
        call: (client, options) =>
            client.addresses.listPredictions(predictionInput, options),
    },
    {
        name: 'formatted address',
        route: 'publicExtensions.getFormattedAddressFromPlaceId',
        method: 'GET',
        input: placeInput,
        output: '12 Main Street, Apt 2\nExample City',
        call: (client, options) =>
            client.addresses.getFormattedAddress(placeInput, options),
    },
    {
        name: 'configured current Button',
        route: 'publicExtensions.triggerWebhook',
        method: 'POST',
        input: currentButtonInput,
        output: { success: true },
        call: (client, options) =>
            client.buttons.triggerWebhook(currentButtonInput, options),
    },
    {
        name: 'configured linked Button',
        route: 'publicExtensions.triggerWebhook',
        method: 'POST',
        input: linkedButtonInput,
        output: { success: false },
        call: (client, options) =>
            client.buttons.triggerWebhook(linkedButtonInput, options),
    },
];
const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
    });
const response = (operation: OperationCase): Response =>
    json(
        operation.route.includes('.')
            ? { result: { data: operation.output } }
            : operation.output
    );

describe('additional canonical runtime operations', () => {
    for (const operation of operations) {
        it(`preserves ${operation.name} wire authority and native result`, async () => {
            const calls: Array<{ url: URL; init: RequestInit }> = [];
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { password: 'shared_visitor' },
                fetch: async (url, init) => {
                    assert.ok(init);
                    calls.push({ url: new URL(String(url)), init });
                    return response(operation);
                },
            });
            const before = structuredClone(operation.input);
            assert.deepEqual(
                await operation.call(client, {
                    session: { login: 'request_visitor' },
                }),
                operation.output
            );
            assert.equal(calls.length, 1);
            const { url, init } = calls[0];
            assert.equal(url.origin, 'https://sdk.example.test');
            assert.equal(init.method, operation.method);
            assert.equal(init.credentials, 'omit');
            assert.equal(init.cache, 'no-store');
            const headers = new Headers(init.headers);
            assert.equal(headers.get('authorization'), null);
            if (operation.route.includes('.')) {
                assert.equal(url.pathname, `/api/trpc/${operation.route}`);
                assert.deepEqual(
                    JSON.parse(
                        operation.method === 'GET'
                            ? url.searchParams.get('input')!
                            : String(init.body)
                    ),
                    before
                );
                assert.deepEqual(JSON.parse(headers.get('miniext-context')!), {
                    miniExtStorageV4: { login: 'request_visitor' },
                });
            } else {
                assert.equal(url.pathname, '/api/v1');
                assert.equal(url.searchParams.get('route'), operation.route);
                assert.deepEqual(JSON.parse(String(init.body)), {
                    ...before,
                    miniExtStorageV4: { login: 'request_visitor' },
                });
            }
            assert.deepEqual(operation.input, before);
            assert.deepEqual(client.getSession(), {
                password: 'shared_visitor',
            });
        });

        it(`cancels ${operation.name} before dispatch and after a late response`, async () => {
            let calls = 0;
            let dispatch!: () => void;
            const dispatched = new Promise<void>((resolve) => {
                dispatch = resolve;
            });
            let complete!: (value: Response) => void;
            const pending = new Promise<Response>((resolve) => {
                complete = resolve;
            });
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    calls++;
                    dispatch();
                    return pending;
                },
            });
            const before = new AbortController();
            const beforeReason = new Error('Owner changed before dispatch');
            before.abort(beforeReason);
            await assert.rejects(
                operation.call(client, { signal: before.signal }),
                (error: unknown) => error === beforeReason
            );
            assert.equal(calls, 0);
            const during = new AbortController();
            const duringReason = new Error('Owner changed during request');
            const result = operation.call(client, { signal: during.signal });
            const checked = assert.rejects(
                result,
                (error: unknown) => error === duringReason
            );
            await dispatched;
            during.abort(duringReason);
            complete(response(operation));
            await checked;
            assert.equal(calls, 1);
        });

        it(`preserves ${operation.name} failures without retrying`, async () => {
            let calls = 0;
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    calls++;
                    return json(
                        operation.route.includes('.')
                            ? {
                                  error: {
                                      message: 'Request denied.',
                                      code: -32003,
                                      data: {
                                          code: 'FORBIDDEN',
                                          httpStatus: 403,
                                          path: operation.route,
                                      },
                                  },
                              }
                            : { error: true, message: 'Request denied.' }
                    );
                },
            });
            await assert.rejects(operation.call(client), (error: unknown) =>
                operation.route.includes('.')
                    ? error instanceof TRPCClientError &&
                      error.data?.code === 'FORBIDDEN'
                    : error instanceof SDKError && error.kind === 'api'
            );
            assert.equal(calls, 1);
        });
    }

    it('preserves unfiltered discovery, empty predictions, and optional linked view values', async () => {
        let expectedSource: TriggerConfiguredButtonWebhookInput['source'];
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async (url, init) => {
                const requestUrl = new URL(String(url));
                if (requestUrl.pathname === '/api/v1') {
                    assert.equal(
                        JSON.parse(String(init?.body)).filterData,
                        null
                    );
                    return json({ primaryValues: [], prefillValue: null });
                }
                if (requestUrl.pathname.endsWith('autoCompleteAddressField')) {
                    return json({ result: { data: [] } });
                }
                const input = JSON.parse(String(init?.body));
                assert.deepEqual(input.source, expectedSource);
                return json({ result: { data: { success: false } } });
            },
        });
        assert.deepEqual(
            await client.linkedRecords.listConditionalFilterPrimaryValues({
                ...conditionalInput,
                filterData: null,
                urlSearchValue: null,
            }),
            { primaryValues: [], prefillValue: null }
        );
        assert.deepEqual(
            await client.addresses.listPredictions(predictionInput),
            []
        );
        for (const selectedCustomViewId of [undefined, null]) {
            expectedSource = {
                type: 'linked-record',
                linkedRecordId: 'rec_child',
                linkedTableId: 'tbl_children',
                parentLinkedRecordFieldId: 'fld_children',
                ...(selectedCustomViewId === undefined
                    ? {}
                    : { selectedCustomViewId }),
            };
            assert.deepEqual(
                await client.buttons.triggerWebhook({
                    ...linkedButtonInput,
                    source: expectedSource,
                }),
                { success: false }
            );
        }
    });
});
