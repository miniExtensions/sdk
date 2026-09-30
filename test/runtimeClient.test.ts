import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
    createMiniExtensionsClient,
    SDKError,
    withLoginToken,
    type LoadExtensionInput,
    type RuntimeSession,
} from '../src/runtime/index.js';
import { formResult, loadInput, saveInput } from './runtimeFixtures.js';

type RequestBody = {
    operation: string;
    input: unknown;
    session: RuntimeSession;
};
type CapturedRequest = { url: string; init: RequestInit; body: RequestBody };

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const externalFetch = (
    respond: (request: CapturedRequest) => Response | Promise<Response> = () =>
        jsonResponse(formResult)
) => {
    const requests: CapturedRequest[] = [];
    const fetchImpl: typeof globalThis.fetch = async (url, init) => {
        assert.ok(init);
        const request = {
            url: String(url),
            init,
            body: JSON.parse(String(init.body)) as RequestBody,
        };
        requests.push(request);
        return respond(request);
    };
    return { fetchImpl, requests };
};

const configuration = {
    apiOrigin: 'https://sdk.example.test',
    publishableKey: 'publishable_example',
};

describe('runtime client transport', () => {
    it('requires an HTTP(S) origin and a nonempty publishable key', () => {
        for (const apiOrigin of [
            'relative',
            'file:///example',
            'https://sdk.example.test/path',
            'https://sdk.example.test?query=1',
            'https://user:pass@sdk.example.test',
        ]) {
            assert.throws(
                () =>
                    createMiniExtensionsClient({ ...configuration, apiOrigin }),
                TypeError
            );
        }
        for (const publishableKey of ['', '  ', 'key\nother']) {
            assert.throws(
                () =>
                    createMiniExtensionsClient({
                        ...configuration,
                        publishableKey,
                    }),
                TypeError
            );
        }
    });

    it('maps all six methods to one authenticated POST without changing input or output', async () => {
        const responses: Record<string, unknown> = {
            loadExtension: formResult,
            'auth.verifyExtensionPassword': {
                type: 'correct',
                encryptedExtensionPassword: 'password_token',
            },
            'auth.login': {
                type: 'found-record',
                encryptedLoginToken: 'login_token',
            },
            'auth.confirmVerificationCode': {
                encryptedLoginToken: 'confirmed_token',
            },
            'auth.signUp': { ok: true },
            'forms.save': {
                type: 'saved',
                record: {
                    id: 'rec00000000000001',
                    fields: { fld_title: 'Updated example' },
                },
                loggedInUserRecord: null,
                context: { type: 'direct-url' },
                tableId: 'table_example',
            },
        };
        const boundary = externalFetch(({ body }) =>
            jsonResponse(responses[body.operation])
        );
        const session = { login: 'session_token' };
        const client = createMiniExtensionsClient({
            ...configuration,
            apiOrigin: configuration.apiOrigin + '/',
            session,
            fetch: boundary.fetchImpl,
        });
        const signal = new AbortController().signal;
        const password = {
            extensionId: 'extension_example',
            extensionPassword: 'Entered password',
        };
        const login = {
            extensionId: 'extension_example',
            loginCredentials: { Email: 'person@example.test' },
            loginRecordId: 'rec00000000000001',
            fallbackPhoneVerificationNumber: '+15555550100',
        };
        const confirm = {
            verificationId: 'verification_example',
            verificationCode: '123456',
            language: 'en' as const,
        };
        const signUp = {
            extensionId: 'extension_example',
            signUpCredentials: { Email: 'person@example.test' },
        };
        const methods = [
            [
                'loadExtension',
                loadInput,
                () => client.loadExtension(loadInput, { signal }),
            ],
            [
                'auth.verifyExtensionPassword',
                password,
                () => client.auth.verifyExtensionPassword(password, { signal }),
            ],
            ['auth.login', login, () => client.auth.login(login, { signal })],
            [
                'auth.confirmVerificationCode',
                confirm,
                () => client.auth.confirmVerificationCode(confirm, { signal }),
            ],
            [
                'auth.signUp',
                signUp,
                () => client.auth.signUp(signUp, { signal }),
            ],
            [
                'forms.save',
                saveInput,
                () => client.forms.save(saveInput, { signal }),
            ],
        ] as const;

        for (const [operation, input, call] of methods) {
            assert.deepEqual(await call(), responses[operation]);
            const request = boundary.requests.at(-1)!;
            assert.equal(request.url, 'https://sdk.example.test/api/sdk');
            assert.equal(request.init.method, 'POST');
            assert.equal(request.init.credentials, 'omit');
            assert.equal(request.init.signal, signal);
            const headers = new Headers(request.init.headers);
            assert.equal(
                headers.get('authorization'),
                'Bearer publishable_example'
            );
            assert.equal(headers.get('content-type'), 'application/json');
            assert.deepEqual(request.body, { operation, input, session });
        }
        assert.equal(boundary.requests.length, methods.length);
    });

    it('preserves child create/edit inputs and their context', async () => {
        const boundary = externalFetch();
        const client = createMiniExtensionsClient({
            ...configuration,
            fetch: boundary.fetchImpl,
        });
        const common = {
            context: {
                type: 'modal' as const,
                linkedTableIdOfLinkedRecordField: 'table_child',
                prefillDataForLinkedRecordsForm: {
                    toLinkToParent: {
                        reversedFieldIdToPrefill: 'fld_parent',
                        parentFormRecordId: 'rec00000000000001',
                    },
                    prefillQueryForChildExtension: 'prefill_Title=Example',
                },
            },
            query: { repeated: ['First', 'Second'] },
            clientTimeZone: 'America/New_York',
            childExtensionAccessData: {
                parentExtensionAccessToken: 'parent_access',
                fieldIdUsedToAccessExtension: 'fld_children',
            },
        };
        const inputs: LoadExtensionInput[] = [
            {
                ...common,
                childExtensionInfo: {
                    childExtensionId: 'child_example',
                    accessType: { type: 'create' },
                },
            },
            {
                ...common,
                childExtensionInfo: {
                    childExtensionId: 'child_example',
                    accessType: {
                        type: 'edit',
                        childExtensionRecordId: 'rec00000000000002',
                        childExtensionFieldId: 'fld_title',
                    },
                },
            },
        ];
        for (const input of inputs) await client.loadExtension(input);
        assert.deepEqual(
            boundary.requests.map(({ body }) => body.input),
            inputs
        );
    });

    it('preserves loaded screens, redirects, and unknown nested configuration properties', async () => {
        const outputs = [
            formResult,
            {
                ...formResult,
                extensionScreen: 'portal_loaded',
                payload: {
                    ...formResult.payload,
                    extensionType: 'portal',
                    formRecord: {
                        type: 'edit',
                        recordId: 'rec00000000000001',
                        tableId: 'table_example',
                        data: { fld_title: 'Example' },
                    },
                    viewIdsToAirtableViews: {},
                    fieldIdsInPortal: ['fld_children'],
                    usersTableFields: [],
                    linkedRecordFieldIdToFieldsTitles: {},
                    initialLinkedTableStates: {},
                    extraSetting: ['Example', { enabled: false }],
                },
            },
            {
                ...formResult,
                extensionScreen: 'password',
                payload: {
                    baseId: 'base_example',
                    loggedInUserCanEditExtension: false,
                    showMiniExtensionsBranding: true,
                    onFreePlan: true,
                    trialExpiresAtUnixEpoch: null,
                    futureSetting: null,
                },
            },
            {
                ...formResult,
                extensionScreen: 'login_page',
                payload: {
                    baseId: 'base_example',
                    loggedInUserCanEditExtension: false,
                    showMiniExtensionsBranding: true,
                    onFreePlan: true,
                    trialExpiresAtUnixEpoch: null,
                    publicFields: {},
                    hasParentExtension: false,
                    shareId: 'share_example',
                    loginFieldNames: ['Email'],
                    loginFieldIds: ['fld_email'],
                    fieldNamesToSchemas: {},
                    fieldIdsToSchemas: {},
                    tableId: 'table_example',
                    prefillFieldNamesToValues: {},
                    prefillLoginRecordId: null,
                    futureSetting: { nested: 42 },
                },
            },
            { type: 'redirect', url: 'https://example.test/next' },
        ];
        for (const output of outputs) {
            const boundary = externalFetch(() => jsonResponse(output));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            assert.deepEqual(await client.loadExtension(loadInput), output);
        }
    });

    it('returns all password, login, confirmation, and sign-up outcomes without persisting tokens', async () => {
        const outputs = [
            { type: 'correct', encryptedExtensionPassword: 'password_token' },
            { type: 'wrong' },
            { type: 'blocked' },
            { type: 'found-record', encryptedLoginToken: 'login_token' },
            { type: 'no-record' },
            {
                type: 'verification-message-sent',
                verificationId: 'verification_example',
                emailOrPhoneNumber: 'person@example.test',
                verificationType: 'email',
            },
            { encryptedLoginToken: 'confirmed_token' },
            { ok: true },
            { ok: false },
        ];
        const boundary = externalFetch(() => jsonResponse(outputs.shift()));
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { existing: 'existing_token' },
            fetch: boundary.fetchImpl,
        });
        for (const expected of [
            { type: 'correct', encryptedExtensionPassword: 'password_token' },
            { type: 'wrong' },
            { type: 'blocked' },
        ])
            assert.deepEqual(
                await client.auth.verifyExtensionPassword({
                    extensionId: 'extension_example',
                    extensionPassword: 'Password',
                }),
                expected
            );
        for (const expected of [
            { type: 'found-record', encryptedLoginToken: 'login_token' },
            { type: 'no-record' },
            {
                type: 'verification-message-sent',
                verificationId: 'verification_example',
                emailOrPhoneNumber: 'person@example.test',
                verificationType: 'email',
            },
        ])
            assert.deepEqual(
                await client.auth.login({
                    extensionId: 'extension_example',
                    loginCredentials: { Email: 'person@example.test' },
                }),
                expected
            );
        assert.deepEqual(
            await client.auth.confirmVerificationCode({
                verificationId: 'verification_example',
                verificationCode: '123456',
                language: 'en',
            }),
            { encryptedLoginToken: 'confirmed_token' }
        );
        assert.deepEqual(
            await client.auth.signUp({
                extensionId: 'extension_example',
                signUpCredentials: {},
            }),
            { ok: true }
        );
        assert.deepEqual(
            await client.auth.signUp({
                extensionId: 'extension_example',
                signUpCredentials: {},
            }),
            { ok: false }
        );
        assert.deepEqual(client.getSession(), { existing: 'existing_token' });
    });

    it('returns saved metadata and Form validation errors as ordinary results', async () => {
        const saved = {
            type: 'saved',
            record: {
                id: 'rec00000000000001',
                fields: { fld_title: 'Example' },
            },
            loggedInUserRecord: null,
            tableId: 'table_example',
            context: { type: 'modal', newTableIdsToLinkedTableStates: {} },
            postSubmissionWarnings: [{ type: 'adminNotificationEmailFailed' }],
            postSubmissionNotifications: [
                { type: 'saveAndContinueUpdateLinkEmailSent' },
            ],
        };
        const validation = {
            type: 'error',
            formValidationErrors: [
                {
                    fieldId: 'fld_title',
                    fieldTitle: 'Title',
                    errorMessage: 'Please enter a value.',
                },
            ],
            formErrors: { fld_title: 'Please enter a value.' },
            concurrentEditErrorMessage: 'Review recent changes.',
        };
        for (const output of [saved, validation]) {
            const boundary = externalFetch(() => jsonResponse(output));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            assert.deepEqual(await client.forms.save(saveInput), output);
        }
    });

    for (const [status, body, kind, code] of [
        [
            200,
            { error: true, message: 'Request denied.', code: 'request.denied' },
            'api',
            'request.denied',
        ],
        [
            403,
            { message: 'Request denied.', code: 'request.denied' },
            'http',
            'request.denied',
        ],
        [401, { error: true, message: 'Request denied.' }, 'api', undefined],
    ] as const) {
        it(`throws a typed ${kind} error for HTTP ${status} without retrying the save`, async () => {
            const boundary = externalFetch(() => jsonResponse(body, status));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            await assert.rejects(
                client.forms.save(saveInput),
                (error: unknown) => {
                    assert.ok(error instanceof SDKError);
                    assert.equal(error.kind, kind);
                    assert.equal(error.status, status);
                    assert.equal(error.code, code);
                    return true;
                }
            );
            assert.equal(boundary.requests.length, 1);
        });
    }

    it('reports network failure once while retaining its cause', async () => {
        const cause = new TypeError('Synthetic network failure');
        const boundary = externalFetch(() => Promise.reject(cause));
        const client = createMiniExtensionsClient({
            ...configuration,
            fetch: boundary.fetchImpl,
        });
        await assert.rejects(client.forms.save(saveInput), (error: unknown) => {
            assert.ok(error instanceof SDKError);
            assert.equal(error.kind, 'network');
            assert.equal(error.cause, cause);
            assert.equal(error.status, undefined);
            return true;
        });
        assert.equal(boundary.requests.length, 1);
    });

    for (const [status, kind] of [
        [200, 'protocol'],
        [502, 'http'],
    ] as const) {
        it(`handles invalid JSON at HTTP ${status} without including the response body`, async () => {
            const boundary = externalFetch(
                () =>
                    new Response('<html>Synthetic gateway failure</html>', {
                        status,
                    })
            );
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            await assert.rejects(
                client.loadExtension(loadInput),
                (error: unknown) => {
                    assert.ok(error instanceof SDKError);
                    assert.equal(error.kind, kind);
                    assert.equal(error.status, status);
                    assert.ok(!error.message.includes('<html>'));
                    assert.ok(
                        !error.message.includes(configuration.publishableKey)
                    );
                    return true;
                }
            );
            assert.equal(boundary.requests.length, 1);
        });
    }

    for (const output of [null, [], 'Unexpected']) {
        it(`rejects the non-object JSON response ${JSON.stringify(output)}`, async () => {
            const boundary = externalFetch(() => jsonResponse(output));
            const client = createMiniExtensionsClient({
                ...configuration,
                fetch: boundary.fetchImpl,
            });
            await assert.rejects(
                client.loadExtension(loadInput),
                (error: unknown) =>
                    error instanceof SDKError && error.kind === 'protocol'
            );
        });
    }

    it('honors a pre-aborted signal before contacting the network', async () => {
        const boundary = externalFetch();
        const client = createMiniExtensionsClient({
            ...configuration,
            fetch: boundary.fetchImpl,
        });
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            client.forms.save(saveInput, { signal: controller.signal }),
            (error: unknown) => error === controller.signal.reason
        );
        assert.equal(boundary.requests.length, 0);
    });

    it('propagates in-flight cancellation without retrying or changing session', async () => {
        const boundary = externalFetch(
            ({ init }) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal!.addEventListener(
                        'abort',
                        () => reject(init.signal!.reason),
                        { once: true }
                    );
                })
        );
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { login: 'current_token' },
            fetch: boundary.fetchImpl,
        });
        const controller = new AbortController();
        const pending = client.forms.save(saveInput, {
            signal: controller.signal,
        });
        controller.abort();
        await assert.rejects(
            pending,
            (error: unknown) => error === controller.signal.reason
        );
        assert.equal(boundary.requests.length, 1);
        assert.deepEqual(client.getSession(), { login: 'current_token' });
    });

    it('makes a real HTTP request with the default fetch implementation', async () => {
        let captured:
            | {
                  method?: string;
                  url?: string;
                  authorization?: string;
                  contentType?: string;
                  body: RequestBody;
              }
            | undefined;
        const server = createServer((request, response) => {
            request.setEncoding('utf8');
            let body = '';
            request.on('data', (chunk: string) => {
                body += chunk;
            });
            request.on('end', () => {
                captured = {
                    method: request.method,
                    url: request.url,
                    authorization: request.headers.authorization,
                    contentType: request.headers['content-type'],
                    body: JSON.parse(body) as RequestBody,
                };
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify(formResult));
            });
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        try {
            const address = server.address();
            assert.ok(address && typeof address === 'object');
            const client = createMiniExtensionsClient({
                ...configuration,
                apiOrigin: `http://127.0.0.1:${address.port}`,
                session: { login: 'session_token' },
            });
            assert.deepEqual(await client.loadExtension(loadInput), formResult);
            assert.deepEqual(captured, {
                method: 'POST',
                url: '/api/sdk',
                authorization: 'Bearer publishable_example',
                contentType: 'application/json',
                body: {
                    operation: 'loadExtension',
                    input: loadInput,
                    session: { login: 'session_token' },
                },
            });
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        }
    });
});

describe('runtime session ownership', () => {
    it('clones construction, replacement, and returned sessions and clears by replacement', async () => {
        const boundary = externalFetch();
        const initial = { visitor: 'token_A' };
        const client = createMiniExtensionsClient({
            ...configuration,
            session: initial,
            fetch: boundary.fetchImpl,
        });
        initial.visitor = 'Changed outside';
        const exposed = client.getSession();
        exposed.visitor = 'Changed copy';
        assert.deepEqual(client.getSession(), { visitor: 'token_A' });
        const replacement = { visitor: 'token_B' };
        client.setSession(replacement);
        replacement.visitor = 'Changed replacement';
        await client.loadExtension(loadInput);
        client.setSession({ visitor: 'token_A' });
        await client.loadExtension(loadInput);
        client.setSession({});
        await client.loadExtension(loadInput);
        assert.deepEqual(
            boundary.requests.map(({ body }) => body.session),
            [{ visitor: 'token_B' }, { visitor: 'token_A' }, {}]
        );
    });

    it('uses complete request-only session overrides without merging or persisting them', async () => {
        const boundary = externalFetch();
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'token_A', retained: 'old_token' },
            fetch: boundary.fetchImpl,
        });
        const override = { other: 'token_B' };
        const pending = client.loadExtension(loadInput, { session: override });
        override.other = 'Changed outside';
        await pending;
        await client.loadExtension(loadInput, { session: {} });
        await client.loadExtension(loadInput);
        assert.deepEqual(
            boundary.requests.map(({ body }) => body.session),
            [
                { other: 'token_B' },
                {},
                { visitor: 'token_A', retained: 'old_token' },
            ]
        );
        assert.deepEqual(client.getSession(), {
            visitor: 'token_A',
            retained: 'old_token',
        });
    });

    it('keeps a pending auth request under A from changing replacement session B', async () => {
        let finishLogin!: (response: Response) => void;
        const boundary = externalFetch(({ body }) =>
            body.operation === 'auth.login'
                ? new Promise<Response>((resolve) => {
                      finishLogin = resolve;
                  })
                : jsonResponse(formResult)
        );
        const client = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'token_A' },
            fetch: boundary.fetchImpl,
        });
        const pending = client.auth.login({
            extensionId: 'extension_example',
            loginCredentials: { Email: 'person@example.test' },
        });
        client.setSession({ visitor: 'token_B' });
        await client.loadExtension(loadInput);
        finishLogin(
            jsonResponse({
                type: 'found-record',
                encryptedLoginToken: 'late_token_A',
            })
        );
        assert.deepEqual(await pending, {
            type: 'found-record',
            encryptedLoginToken: 'late_token_A',
        });
        assert.deepEqual(
            boundary.requests.map(({ body }) => body.session),
            [{ visitor: 'token_A' }, { visitor: 'token_B' }]
        );
        assert.deepEqual(client.getSession(), { visitor: 'token_B' });
    });

    it('keeps concurrent clients separate and restores explicitly persisted credentials', async () => {
        const boundary = externalFetch();
        const first = createMiniExtensionsClient({
            ...configuration,
            session: { visitor: 'token_A' },
            fetch: boundary.fetchImpl,
        });
        const second = createMiniExtensionsClient({
            ...configuration,
            publishableKey: 'publishable_other',
            session: { visitor: 'token_B' },
            fetch: boundary.fetchImpl,
        });
        await Promise.all([
            first.loadExtension(loadInput),
            second.loadExtension(loadInput),
        ]);
        assert.deepEqual(
            boundary.requests.map(({ body }) => body.session),
            [{ visitor: 'token_A' }, { visitor: 'token_B' }]
        );
        assert.deepEqual(
            boundary.requests.map(({ init }) =>
                new Headers(init.headers).get('authorization')
            ),
            ['Bearer publishable_example', 'Bearer publishable_other']
        );
        first.setSession(
            withLoginToken(first.getSession(), {
                extensionId: 'extension_example',
                tableId: 'table_example',
                loginFieldNames: ['Email'],
                encryptedLoginToken: 'persisted_login',
            })
        );
        const restored = createMiniExtensionsClient({
            ...configuration,
            session: first.getSession(),
            fetch: boundary.fetchImpl,
        });
        await restored.loadExtension(loadInput);
        assert.deepEqual(
            boundary.requests.at(-1)!.body.session,
            first.getSession()
        );
        assert.deepEqual(second.getSession(), { visitor: 'token_B' });
    });
});
