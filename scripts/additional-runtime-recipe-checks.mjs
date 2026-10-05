import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Synthetic transport proof through both installed archive entry points. */
export async function checkAdditionalRuntimeOperations({ consumerDirectory }) {
    const consumerRoot = realpathSync(consumerDirectory);
    const consumerRequire = createRequire(join(consumerRoot, 'package.json'));
    const installedRoot = realpathSync(
        join(consumerRoot, 'node_modules/@miniextensions/sdk')
    );
    const commonJsPath = realpathSync(
        consumerRequire.resolve('@miniextensions/sdk')
    );
    assert(commonJsPath.startsWith(`${installedRoot}/dist/cjs/`));
    const modules = [
        ['CommonJS', consumerRequire('@miniextensions/sdk')],
        [
            'ESM',
            await import(
                pathToFileURL(join(installedRoot, 'dist/esm/runtime/index.js'))
                    .href
            ),
        ],
    ];
    const primaryValue = { recordId: 'rec_region', stringValue: 'North, East' };
    const cases = [
        {
            route: 'fetchPrimaryValuesForConditionalLinkedRecordFilterField',
            method: 'POST',
            input: {
                extensionAccessToken: 'form_token',
                linkedRecordsFilterFieldId: 'fld_region',
                mainTableLinkedRecordsFieldId: 'fld_projects',
                searchTerm: 'North, East',
                filterData: {
                    previousFilterFieldId: 'fld_country',
                    previousFilterPrimaryValue: 'United States',
                },
                urlSearchValue: 'North, East',
            },
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
            call: (client, input, options) =>
                client.linkedRecords.listConditionalFilterPrimaryValues(
                    input,
                    options
                ),
        },
        {
            route: 'publicExtensions.autoCompleteAddressField',
            method: 'GET',
            input: {
                extensionAccessToken: 'form_token',
                fieldId: 'fld_address',
                addressFieldValue: '12 Main, Apt 2',
            },
            output: [
                { description: '12 Main, Apt 2', placeId: 'provider_place' },
            ],
            call: (client, input, options) =>
                client.addresses.listPredictions(input, options),
        },
        {
            route: 'publicExtensions.getFormattedAddressFromPlaceId',
            method: 'GET',
            input: {
                extensionAccessToken: 'form_token',
                fieldId: 'fld_address',
                placeId: 'provider_place',
            },
            output: '12 Main Street, Apt 2\nExample City',
            call: (client, input, options) =>
                client.addresses.getFormattedAddress(input, options),
        },
        {
            route: 'publicExtensions.triggerWebhook',
            method: 'POST',
            input: {
                extensionAccessToken: 'form_token',
                fieldId: 'fld_button',
                source: { type: 'current-record', recordId: 'rec_current' },
            },
            output: { success: true },
            call: (client, input, options) =>
                client.buttons.triggerWebhook(input, options),
        },
        {
            route: 'publicExtensions.triggerWebhook',
            method: 'POST',
            input: {
                extensionAccessToken: 'portal_token',
                fieldId: 'fld_child_button',
                source: {
                    type: 'linked-record',
                    linkedRecordId: 'rec_child',
                    linkedTableId: 'tbl_children',
                    parentLinkedRecordFieldId: 'fld_children',
                    selectedCustomViewId: 'view_current',
                },
            },
            output: { success: false },
            call: (client, input, options) =>
                client.buttons.triggerWebhook(input, options),
        },
    ];
    const json = (body) =>
        new Response(JSON.stringify(body), {
            headers: { 'Content-Type': 'application/json' },
        });
    let checks = 0;
    for (const [entry, sdk] of modules) {
        for (const operation of cases) {
            const isTrpc = operation.route.includes('.');
            const resultResponse = () =>
                json(
                    isTrpc
                        ? { result: { data: operation.output } }
                        : operation.output
                );
            const requests = [];
            const client = sdk.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { password: 'shared_visitor' },
                fetch: async (url, init) => {
                    assert(init);
                    requests.push({ url: new URL(String(url)), init });
                    return resultResponse();
                },
            });
            const before = structuredClone(operation.input);
            assert.deepEqual(
                await operation.call(client, operation.input, {
                    session: { login: 'request_visitor' },
                }),
                operation.output,
                entry
            );
            assert.equal(requests.length, 1);
            const { url, init } = requests[0];
            assert.equal(url.origin, 'https://sdk.example.test');
            assert.equal(init.method, operation.method);
            assert.equal(init.credentials, 'omit');
            assert.equal(init.cache, 'no-store');
            const headers = new Headers(init.headers);
            assert.equal(headers.get('authorization'), null);
            if (isTrpc) {
                assert.equal(url.pathname, `/api/trpc/${operation.route}`);
                assert.deepEqual(
                    JSON.parse(
                        operation.method === 'GET'
                            ? url.searchParams.get('input')
                            : String(init.body)
                    ),
                    before
                );
                assert.deepEqual(JSON.parse(headers.get('miniext-context')), {
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
            checks++;

            let failures = 0;
            const denied = sdk.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    failures++;
                    return json(
                        isTrpc
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
            await assert.rejects(
                operation.call(denied, operation.input),
                (error) =>
                    isTrpc
                        ? error.name === 'TRPCClientError' &&
                          error.data?.code === 'FORBIDDEN'
                        : error instanceof sdk.SDKError && error.kind === 'api'
            );
            assert.equal(failures, 1);
            checks++;

            const beforeAbort = new AbortController();
            const beforeReason = new Error('Owner changed before request');
            beforeAbort.abort(beforeReason);
            await assert.rejects(
                operation.call(client, operation.input, {
                    signal: beforeAbort.signal,
                }),
                (error) => error === beforeReason
            );
            assert.equal(requests.length, 1);
            checks++;

            let dispatch;
            const dispatched = new Promise((resolve) => {
                dispatch = resolve;
            });
            let complete;
            const pending = new Promise((resolve) => {
                complete = resolve;
            });
            let pendingCalls = 0;
            const lateClient = sdk.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    pendingCalls++;
                    dispatch();
                    return pending;
                },
            });
            const controller = new AbortController();
            const reason = new Error('Owner changed during request');
            const waiting = operation.call(lateClient, operation.input, {
                signal: controller.signal,
            });
            const checked = assert.rejects(
                waiting,
                (error) => error === reason
            );
            await dispatched;
            controller.abort(reason);
            complete(resultResponse());
            await checked;
            assert.equal(pendingCalls, 1);
            checks++;
        }
        const conditional = cases[0];
        const noPriorFilter = {
            ...conditional.input,
            filterData: null,
            urlSearchValue: null,
        };
        const unfilteredClient = sdk.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async (_url, init) => {
                const { miniExtStorageV4, ...input } = JSON.parse(
                    String(init.body)
                );
                assert.deepEqual(input, noPriorFilter);
                assert.deepEqual(miniExtStorageV4, {});
                return json({ primaryValues: [], prefillValue: null });
            },
        });
        assert.deepEqual(
            await conditional.call(unfilteredClient, noPriorFilter),
            { primaryValues: [], prefillValue: null }
        );
        checks++;
        const noPredictions = sdk.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => json({ result: { data: [] } }),
        });
        assert.deepEqual(
            await cases[1].call(noPredictions, cases[1].input),
            []
        );
        checks++;
        for (const selectedCustomViewId of [undefined, null]) {
            const source = {
                type: 'linked-record',
                linkedRecordId: 'rec_child',
                linkedTableId: 'tbl_children',
                parentLinkedRecordFieldId: 'fld_children',
                ...(selectedCustomViewId === undefined
                    ? {}
                    : { selectedCustomViewId }),
            };
            const input = { ...cases[4].input, source };
            const linkedClient = sdk.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async (_url, init) => {
                    assert.deepEqual(JSON.parse(String(init.body)), input);
                    return json({ result: { data: { success: false } } });
                },
            });
            assert.deepEqual(await cases[4].call(linkedClient, input), {
                success: false,
            });
            checks++;
        }
    }
    return { checks };
}
