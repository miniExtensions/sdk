import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    SDKError,
    withExtensionPassword,
    withLoginToken,
    type LoginResult,
    type VerifyExtensionPasswordResult,
} from '../src/runtime/index.js';
import {
    AuthFlowError,
    createAuthFlow,
    type AuthCredentialGrant,
    type AuthFlow,
    type AuthOwnerScope,
    type AuthPage,
    type AuthVerificationChallenge,
} from '../src/auth/index.js';
import {
    authFixture,
    deferred,
    loginPage,
    passwordPage,
    verificationSent,
} from './authFixtures.js';

const scope = (): AuthOwnerScope => ({
    ownerId: 'visitor_example',
    revision: 0,
});
const hasCode = (code: AuthFlowError['code']) => (error: unknown) =>
    error instanceof AuthFlowError && error.code === code;
const assertOpaque = (value: object) => {
    assert.equal(Object.getPrototypeOf(value), null);
    assert.equal(Object.isFrozen(value), true);
    assert.deepEqual(Reflect.ownKeys(value), []);
    assert.equal(JSON.stringify(value), '{}');
};
const foundGrant = async (
    flow: Extract<AuthFlow, { screen: 'login_page' }>
) => {
    const result = await flow.login({ loginCredentials: {} });
    assert.equal(result.type, 'found-record');
    if (result.type !== 'found-record')
        throw new Error('Expected synthetic found-record.');
    return result.grant;
};
const challengeFrom = async (
    flow: Extract<AuthFlow, { screen: 'login_page' }>
) => {
    const result = await flow.login({ loginCredentials: {} });
    assert.equal(result.type, 'verification-message-sent');
    if (result.type !== 'verification-message-sent')
        throw new Error('Expected synthetic verification message.');
    return result.challenge;
};

// These compile-only checks ensure the page overload and union discriminator stay useful.
const typeContract = (
    page: AuthPage,
    fixture: ReturnType<typeof authFixture>
) => {
    const flow = createAuthFlow({
        client: fixture.client,
        page,
        getScope: scope,
    });
    if (flow.screen === 'password') {
        void flow.verifyPassword({ extensionPassword: '' });
        // @ts-expect-error Login methods are absent on a password screen.
        void flow.login({ loginCredentials: {} });
    } else {
        void flow.signUp({ signUpCredentials: {} });
        // @ts-expect-error Password verification is absent on a login screen.
        void flow.verifyPassword({ extensionPassword: '' });
    }
};
void typeContract;

describe('optional auth flow contracts', () => {
    it('uses only password operation and explicit canonical one-use session application', async () => {
        const fixture = authFixture();
        const page = passwordPage();
        const flow = createAuthFlow({
            client: fixture.client,
            page,
            getScope: scope,
        });
        assert.equal(flow.screen, 'password');
        assert.equal('login' in flow, false);
        assert.equal(Object.isFrozen(flow), true);
        const input = { extensionPassword: 'entered_example' };
        const pending = flow.verifyPassword(input);
        input.extensionPassword = 'changed_after_call';
        page.extensionId = 'changed_extension';
        const result = await pending;
        assert.equal(result.type, 'correct');
        if (result.type !== 'correct') return;
        assert.deepEqual(fixture.calls[0].input, {
            extensionId: 'extension_example',
            extensionPassword: 'entered_example',
        });
        assert.deepEqual(fixture.calls[0].options?.session, {
            previous: 'encrypted_previous',
        });
        assert.ok(fixture.calls[0].options?.signal instanceof AbortSignal);
        assertOpaque(result.grant);
        assert.deepEqual(Reflect.ownKeys(result), ['type', 'grant']);
        assert.equal(fixture.applied.length, 0);
        assert.equal(fixture.loads, 0);
        assert.equal(flow.isCurrent(), true);
        const applied = flow.applySession(result.grant);
        assert.deepEqual(
            applied,
            withExtensionPassword(
                { previous: 'encrypted_previous' },
                {
                    extensionId: 'extension_example',
                    encryptedExtensionPassword: 'encrypted_password_example',
                }
            )
        );
        assert.equal(fixture.applied.length, 1);
        assert.equal(flow.isCurrent(), false);
        assert.throws(
            () => flow.applySession(result.grant),
            hasCode('reload-required')
        );
        assert.equal(fixture.applied.length, 1);
    });

    for (const type of ['wrong', 'blocked'] as const)
        it(`returns canonical password ${type} without a grant or session action`, async () => {
            const fixture = authFixture({ password: async () => ({ type }) });
            const flow = createAuthFlow({
                client: fixture.client,
                page: passwordPage(),
                getScope: scope,
            });
            assert.deepEqual(
                await flow.verifyPassword({ extensionPassword: '' }),
                { type }
            );
            assert.equal(flow.isCurrent(), true);
            assert.equal(fixture.applied.length, 0);
        });

    it('uses copied login metadata and explicit native optional inputs without prefilling credentials', async () => {
        const fixture = authFixture();
        const page = loginPage();
        const original = structuredClone(page);
        const flow = createAuthFlow({
            client: fixture.client,
            page,
            getScope: scope,
        });
        assert.equal('verifyPassword' in flow, false);
        page.extensionId = 'changed_extension';
        page.payload.tableId = 'changed_table';
        page.payload.loginFieldNames.splice(0, 2, 'Changed');
        page.payload.prefillLoginRecordId = 'changed_prefill';
        const input = {
            loginCredentials: { Émail: 'entered@example.test', Password: '' },
            loginRecordId: 'record_explicit',
            fallbackPhoneVerificationNumber: '+10000000000',
        };
        const pending = flow.login(input);
        input.loginCredentials.Émail = 'changed@example.test';
        input.loginRecordId = 'changed_record';
        input.fallbackPhoneVerificationNumber = 'changed_phone';
        const result = await pending;
        assert.equal(result.type, 'found-record');
        if (result.type !== 'found-record') return;
        assert.deepEqual(fixture.calls[0].input, {
            extensionId: original.extensionId,
            loginCredentials: { Émail: 'entered@example.test', Password: '' },
            loginRecordId: 'record_explicit',
            fallbackPhoneVerificationNumber: '+10000000000',
        });
        assertOpaque(result.grant);
        assert.deepEqual(
            flow.applySession(result.grant),
            withLoginToken(
                { previous: 'encrypted_previous' },
                {
                    extensionId: original.extensionId,
                    tableId: original.payload.tableId,
                    loginFieldNames: original.payload.loginFieldNames,
                    encryptedLoginToken: 'encrypted_login_example',
                }
            )
        );
        assert.equal(fixture.loads, 0);
    });

    it('permits empty credentials and record-only login while leaving omitted inputs absent', async () => {
        const fixture = authFixture({
            login: async () => ({ type: 'no-record' }),
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        assert.deepEqual(await flow.login({ loginCredentials: {} }), {
            type: 'no-record',
        });
        assert.deepEqual(fixture.calls[0].input, {
            extensionId: 'extension_example',
            loginCredentials: {},
        });
        assert.deepEqual(
            await flow.login({
                loginCredentials: {},
                loginRecordId: 'record_explicit',
            }),
            { type: 'no-record' }
        );
        assert.deepEqual(fixture.calls[1].input, {
            extensionId: 'extension_example',
            loginCredentials: {},
            loginRecordId: 'record_explicit',
        });
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['login', 'login']
        );
        assert.equal(fixture.applied.length, 0);
    });

    for (const verificationType of ['email', 'phoneNumber'] as const)
        it(`keeps ${verificationType} verification metadata opaque and explicitly confirms using copied language`, async () => {
            const fixture = authFixture({
                login: async () => ({
                    ...verificationSent(),
                    verificationType,
                }),
            });
            const page = loginPage();
            const flow = createAuthFlow({
                client: fixture.client,
                page,
                getScope: scope,
            });
            page.language = 'en';
            const result = await flow.login({ loginCredentials: {} });
            assert.equal(result.type, 'verification-message-sent');
            if (result.type !== 'verification-message-sent') return;
            assert.deepEqual(Reflect.ownKeys(result), [
                'type',
                'challenge',
                'emailOrPhoneNumber',
                'verificationType',
            ]);
            assert.equal(result.emailOrPhoneNumber, 'masked@example.test');
            assert.equal(result.verificationType, verificationType);
            assertOpaque(result.challenge);
            assert.deepEqual(
                fixture.calls.map((call) => call.operation),
                ['login']
            );
            const input = {
                challenge: result.challenge,
                verificationCode: 'code_example',
            };
            const pending = flow.confirmVerificationCode(input);
            input.verificationCode = 'changed_code';
            input.challenge = {} as AuthVerificationChallenge;
            const grant = await pending;
            assertOpaque(grant);
            assert.deepEqual(fixture.calls[1].input, {
                verificationId: 'verification_example',
                verificationCode: 'code_example',
                language: 'fr',
            });
            await assert.rejects(
                flow.confirmVerificationCode({
                    challenge: result.challenge,
                    verificationCode: 'second_code',
                }),
                hasCode('invalid-challenge')
            );
            assert.equal(fixture.applied.length, 0);
            flow.applySession(grant);
            assert.equal(fixture.applied.length, 1);
        });

    for (const ok of [true, false])
        it(`returns actual signup ok=${ok} without login, token or reload`, async () => {
            const fixture = authFixture({ signup: async () => ({ ok }) });
            const page = loginPage();
            page.payload.publicFields = {};
            const flow = createAuthFlow({
                client: fixture.client,
                page,
                getScope: scope,
            });
            const input = {
                signUpCredentials: { Émail: 'signup@example.test' },
            };
            const pending = flow.signUp(input);
            input.signUpCredentials.Émail = 'changed@example.test';
            assert.deepEqual(await pending, { ok });
            assert.deepEqual(fixture.calls[0].input, {
                extensionId: 'extension_example',
                signUpCredentials: { Émail: 'signup@example.test' },
            });
            assert.deepEqual(
                fixture.calls.map((call) => call.operation),
                ['signup']
            );
            assert.equal(fixture.applied.length, 0);
            assert.equal(fixture.loads, 0);
            assert.equal(flow.isCurrent(), true);
        });
});

describe('flow-owned handles and explicit action ordering', () => {
    it('rejects fabricated and foreign grants without changing either client', async () => {
        const first = authFixture(),
            second = authFixture();
        const a = createAuthFlow({
            client: first.client,
            page: loginPage(),
            getScope: scope,
        });
        const b = createAuthFlow({
            client: second.client,
            page: loginPage(),
            getScope: scope,
        });
        const grant = await foundGrant(a);
        assert.throws(() => b.applySession(grant), hasCode('invalid-grant'));
        assert.throws(
            () => a.applySession({} as AuthCredentialGrant),
            hasCode('invalid-grant')
        );
        assert.equal(first.applied.length + second.applied.length, 0);
        a.applySession(grant);
        assert.equal(first.applied.length, 1);
    });

    it('invalidates previous grant when a new explicit login starts, even if it returns no record', async () => {
        let next: LoginResult = {
            type: 'found-record',
            encryptedLoginToken: 'encrypted_example',
        };
        const fixture = authFixture({ login: async () => next });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const grant = await foundGrant(flow);
        next = { type: 'no-record' };
        await flow.login({ loginCredentials: {} });
        assert.throws(() => flow.applySession(grant), hasCode('invalid-grant'));
    });

    it('rejects foreign/replaced challenges and invalidates login handles when explicit signup starts', async () => {
        const fixture = authFixture({ login: async () => verificationSent() });
        const other = authFixture({ login: async () => verificationSent() });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const foreign = await challengeFrom(
            createAuthFlow({
                client: other.client,
                page: loginPage(),
                getScope: scope,
            })
        );
        const first = await challengeFrom(flow);
        await assert.rejects(
            flow.confirmVerificationCode({
                challenge: foreign,
                verificationCode: 'code',
            }),
            hasCode('invalid-challenge')
        );
        const replacement = await challengeFrom(flow);
        await assert.rejects(
            flow.confirmVerificationCode({
                challenge: first,
                verificationCode: 'code',
            }),
            hasCode('invalid-challenge')
        );
        await flow.signUp({ signUpCredentials: {} });
        await assert.rejects(
            flow.confirmVerificationCode({
                challenge: replacement,
                verificationCode: 'code',
            }),
            hasCode('invalid-challenge')
        );
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['login', 'login', 'signup']
        );
    });

    it('preserves original API rejection and permits only an explicit confirmation retry', async () => {
        const apiError = new SDKError('Synthetic API rejection', {
            kind: 'api',
            code: 'opaque_backend_code',
        });
        let reject = true;
        const fixture = authFixture({
            login: async () => verificationSent(),
            confirm: async () => {
                if (reject) throw apiError;
                return { encryptedLoginToken: 'encrypted_retry_example' };
            },
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const challenge = await challengeFrom(flow);
        await assert.rejects(
            flow.confirmVerificationCode({
                challenge,
                verificationCode: 'first_code',
            }),
            (error) => error === apiError
        );
        assert.equal(flow.isCurrent(), true);
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['login', 'confirm']
        );
        reject = false;
        const grant = await flow.confirmVerificationCode({
            challenge,
            verificationCode: 'corrected_code',
        });
        flow.applySession(grant);
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['login', 'confirm', 'confirm']
        );
    });

    for (const kind of ['network', 'http', 'protocol'] as const)
        it(`retires an uncertain ${kind} outcome without retry/resend`, async () => {
            const error = new SDKError('Synthetic uncertain outcome', { kind });
            const fixture = authFixture({
                login: async () => verificationSent(),
                confirm: async () => {
                    throw error;
                },
            });
            const flow = createAuthFlow({
                client: fixture.client,
                page: loginPage(),
                getScope: scope,
            });
            const challenge = await challengeFrom(flow);
            await assert.rejects(
                flow.confirmVerificationCode({
                    challenge,
                    verificationCode: 'code',
                }),
                (actual) => actual === error
            );
            assert.equal(flow.isCurrent(), false);
            await assert.rejects(
                flow.login({ loginCredentials: {} }),
                hasCode('reload-required')
            );
            assert.equal(fixture.calls.length, 2);
        });

    it('rejects overlapping login, signup and apply attempts while retaining the dispatched request', async () => {
        const response = deferred<LoginResult>();
        const fixture = authFixture({ login: () => response.promise });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const pending = flow.login({ loginCredentials: {} });
        await assert.rejects(
            flow.login({ loginCredentials: {} }),
            hasCode('busy')
        );
        await assert.rejects(
            flow.signUp({ signUpCredentials: {} }),
            hasCode('busy')
        );
        assert.throws(
            () => flow.applySession({} as AuthCredentialGrant),
            hasCode('busy')
        );
        assert.equal(fixture.calls.length, 1);
        response.resolve({ type: 'no-record' });
        assert.deepEqual(await pending, { type: 'no-record' });
    });

    it('consumes and retires before a synchronous session setter reenters', async () => {
        const fixture = authFixture();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const grant = await foundGrant(flow);
        const setSession = fixture.client.setSession;
        fixture.client.setSession = (session) => {
            assert.equal(flow.isCurrent(), false);
            assert.throws(
                () => flow.applySession(grant),
                hasCode('reload-required')
            );
            flow.cancel();
            setSession(session);
        };
        flow.applySession(grant);
        assert.equal(fixture.applied.length, 1);
    });

    it('cannot reuse a consumed grant after a setter throws', async () => {
        const fixture = authFixture();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const grant = await foundGrant(flow);
        const error = new Error('Synthetic setter failure');
        fixture.client.setSession = () => {
            throw error;
        };
        assert.throws(
            () => flow.applySession(grant),
            (actual) => actual === error
        );
        assert.throws(
            () => flow.applySession(grant),
            hasCode('reload-required')
        );
        assert.equal(flow.isCurrent(), false);
    });
});

describe('auth scope, cancellation and late responses', () => {
    it('detects changed owner and same-owner revision before dispatch or application', async () => {
        for (const changed of [
            { ownerId: 'other_visitor', revision: 0 },
            { ownerId: 'visitor_example', revision: 1 },
        ]) {
            const fixture = authFixture();
            let owner = scope();
            const flow = createAuthFlow({
                client: fixture.client,
                page: loginPage(),
                getScope: () => owner,
            });
            const grant = await foundGrant(flow);
            owner = changed;
            assert.throws(
                () => flow.applySession(grant),
                hasCode('scope-changed')
            );
            await assert.rejects(
                flow.login({ loginCredentials: {} }),
                hasCode('scope-changed')
            );
            assert.equal(fixture.calls.length, 1);
            assert.equal(fixture.applied.length, 0);
        }
    });

    it('guards changed client session, including stale successful abort-ignoring results', async () => {
        const response = deferred<LoginResult>();
        const fixture = authFixture({ login: () => response.promise });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const pending = flow.login({ loginCredentials: {} });
        fixture.client.setSession({ other: 'encrypted_other' });
        response.resolve({
            type: 'found-record',
            encryptedLoginToken: 'encrypted_late',
        });
        await assert.rejects(pending, hasCode('scope-changed'));
        assert.equal(flow.isCurrent(), false);
        assert.equal(fixture.calls[0].options?.signal?.aborted, true);
        assert.deepEqual(fixture.calls[0].options?.session, {
            previous: 'encrypted_previous',
        });
        assert.equal(fixture.applied.length, 1);
    });

    it('uses application revision to detect anonymous A→B→A transitions', async () => {
        const fixture = authFixture();
        fixture.client.setSession({});
        let owner = scope();
        const flow = createAuthFlow({
            client: fixture.client,
            page: passwordPage(),
            getScope: () => owner,
        });
        const pending = flow.verifyPassword({ extensionPassword: 'example' });
        owner = { ownerId: 'other_visitor', revision: 1 };
        owner = { ownerId: 'visitor_example', revision: 2 };
        await assert.rejects(pending, hasCode('scope-changed'));
    });

    it('detects owner changes caused by a wrapped getSession callback', () => {
        const fixture = authFixture();
        let owner = scope();
        const flow = createAuthFlow({
            client: fixture.client,
            page: passwordPage(),
            getScope: () => owner,
        });
        const getSession = fixture.client.getSession;
        fixture.client.getSession = () => {
            owner = { ...owner, revision: owner.revision + 1 };
            return getSession();
        };
        assert.equal(flow.isCurrent(), false);
    });

    it('rejects creating a flow when scope changes during its initial snapshot', () => {
        const fixture = authFixture();
        let reads = 0;
        assert.throws(
            () =>
                createAuthFlow({
                    client: fixture.client,
                    page: passwordPage(),
                    getScope: () => ({ ...scope(), revision: reads++ }),
                }),
            hasCode('scope-changed')
        );
    });

    it('isCurrent protects rendering when owner changes after the helper has fulfilled', async () => {
        const fixture = authFixture();
        let owner = scope();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: () => owner,
        });
        const accepted = flow.login({ loginCredentials: {} });
        let acceptedType = '';
        void accepted.then((result) => {
            acceptedType = result.type;
            owner = { ...owner, revision: 1 };
        });
        const result = await accepted;
        assert.equal(acceptedType, 'found-record');
        assert.equal(result.type, 'found-record');
        assert.equal(flow.isCurrent(), false);
        if (result.type === 'found-record')
            assert.throws(
                () => flow.applySession(result.grant),
                hasCode('scope-changed')
            );
        assert.equal(fixture.applied.length, 0);
    });

    it('does not dispatch with an already-aborted signal or invalidate an existing challenge', async () => {
        const fixture = authFixture({ login: async () => verificationSent() });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const challenge = await challengeFrom(flow);
        const controller = new AbortController();
        const reason = new Error('Synthetic pre-dispatch cancellation');
        controller.abort(reason);
        await assert.rejects(
            flow.login({ loginCredentials: {} }, { signal: controller.signal }),
            (error) => error === reason
        );
        assert.equal(flow.isCurrent(), true);
        const grant = await flow.confirmVerificationCode({
            challenge,
            verificationCode: 'code',
        });
        assertOpaque(grant);
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['login', 'confirm']
        );
    });

    for (const action of ['signal', 'cancel', 'destroy'] as const)
        it(`discards ignored-abort late success after ${action}`, async () => {
            const response = deferred<VerifyExtensionPasswordResult>();
            const fixture = authFixture({ password: () => response.promise });
            const flow = createAuthFlow({
                client: fixture.client,
                page: passwordPage(),
                getScope: scope,
            });
            const controller = new AbortController();
            const pending = flow.verifyPassword(
                { extensionPassword: 'example' },
                { signal: controller.signal }
            );
            if (action === 'signal')
                controller.abort(new Error('Synthetic in-flight cancellation'));
            else flow[action]();
            assert.equal(fixture.calls[0].options?.signal?.aborted, true);
            response.resolve({
                type: 'correct',
                encryptedExtensionPassword: 'encrypted_late',
            });
            await assert.rejects(pending);
            assert.equal(flow.isCurrent(), false);
            assert.equal(fixture.applied.length, 0);
            assert.equal(fixture.loads, 0);
        });

    for (const action of ['cancel', 'destroy'] as const)
        it(`safely handles getScope reentrant ${action} before dispatch`, async () => {
            const fixture = authFixture();
            let callback: (() => void) | undefined;
            const flow = createAuthFlow({
                client: fixture.client,
                page: passwordPage(),
                getScope: () => {
                    const current = scope();
                    callback?.();
                    return current;
                },
            });
            callback = () => {
                callback = undefined;
                flow[action]();
            };
            await assert.rejects(
                flow.verifyPassword({ extensionPassword: 'example' }),
                hasCode(action === 'cancel' ? 'cancelled' : 'disposed')
            );
            assert.equal(fixture.calls.length, 0);
        });

    it('does not recursively overflow if an owner callback checks freshness', () => {
        const fixture = authFixture();
        let nested: (() => void) | undefined;
        const flow = createAuthFlow({
            client: fixture.client,
            page: passwordPage(),
            getScope: () => {
                nested?.();
                return scope();
            },
        });
        nested = () => assert.equal(flow.isCurrent(), false);
        assert.equal(flow.isCurrent(), true);
    });

    it('retires and detaches before synchronous abort listeners reenter', async () => {
        const response = deferred<LoginResult>();
        const fixture = authFixture({
            login: (call) => {
                call.options?.signal?.addEventListener('abort', () => {
                    assert.equal(flow.isCurrent(), false);
                    flow.destroy();
                });
                return response.promise;
            },
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const pending = flow.login({ loginCredentials: {} });
        flow.cancel();
        response.resolve({
            type: 'found-record',
            encryptedLoginToken: 'encrypted_late',
        });
        await assert.rejects(pending, hasCode('cancelled'));
        assert.equal(flow.isCurrent(), false);
        await assert.rejects(
            flow.login({ loginCredentials: {} }),
            hasCode('disposed')
        );
    });

    it('checks freshness before challenge confirmation and never dispatches stale IDs', async () => {
        const fixture = authFixture({ login: async () => verificationSent() });
        let owner = scope();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: () => owner,
        });
        const challenge = await challengeFrom(flow);
        owner = { ...owner, revision: 1 };
        await assert.rejects(
            flow.confirmVerificationCode({
                challenge,
                verificationCode: 'code',
            }),
            hasCode('scope-changed')
        );
        assert.equal(fixture.calls.length, 1);
    });

    it('expires opaque grants after cancel or destroy and permits only a fresh flow', async () => {
        for (const action of ['cancel', 'destroy'] as const) {
            const fixture = authFixture();
            const flow = createAuthFlow({
                client: fixture.client,
                page: loginPage(),
                getScope: scope,
            });
            const grant = await foundGrant(flow);
            flow[action]();
            assert.throws(
                () => flow.applySession(grant),
                hasCode(action === 'cancel' ? 'cancelled' : 'disposed')
            );
            assert.equal(fixture.applied.length, 0);
            const fresh = createAuthFlow({
                client: fixture.client,
                page: loginPage(),
                getScope: scope,
            });
            fresh.applySession(await foundGrant(fresh));
            assert.equal(fixture.applied.length, 1);
        }
    });

    it('uses the captured session independently of request-side option mutation', async () => {
        const fixture = authFixture({
            login: async (call) => {
                const session = call.options?.session;
                assert.ok(session);
                (session as Record<string, string>).previous =
                    'changed_request_copy';
                return {
                    type: 'found-record',
                    encryptedLoginToken: 'encrypted_login_example',
                };
            },
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const grant = await foundGrant(flow);
        assert.equal(flow.isCurrent(), true);
        assert.deepEqual(
            flow.applySession(grant),
            withLoginToken(
                { previous: 'encrypted_previous' },
                {
                    extensionId: 'extension_example',
                    tableId: 'table_example',
                    loginFieldNames: ['Émail', 'Password'],
                    encryptedLoginToken: 'encrypted_login_example',
                }
            )
        );
    });

    it('rejects successful grants when scope getter reenters during application', async () => {
        const fixture = authFixture();
        let onScope: (() => void) | undefined;
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: () => {
                onScope?.();
                return scope();
            },
        });
        const grant = await foundGrant(flow);
        onScope = () => {
            onScope = undefined;
            flow.cancel();
        };
        assert.throws(() => flow.applySession(grant), hasCode('cancelled'));
        assert.equal(fixture.applied.length, 0);
        assert.equal(flow.isCurrent(), false);
    });

    it('rejects a late challenge when a response getter changes owner during projection', async () => {
        let owner = scope();
        const result = verificationSent();
        Object.defineProperty(result, 'verificationId', {
            get() {
                owner = { ...owner, revision: 1 };
                return 'verification_example';
            },
        });
        const fixture = authFixture({ login: async () => result });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: () => owner,
        });
        await assert.rejects(
            flow.login({ loginCredentials: {} }),
            hasCode('scope-changed')
        );
        assert.equal(flow.isCurrent(), false);
        assert.equal(fixture.calls.length, 1);
    });

    it('rejects cancellation after explicit signup dispatch without automatically repeating account creation', async () => {
        const response = deferred<{ ok: boolean }>();
        const fixture = authFixture({ signup: () => response.promise });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const pending = flow.signUp({
            signUpCredentials: { Émail: 'signup@example.test' },
        });
        flow.cancel();
        response.resolve({ ok: true });
        await assert.rejects(pending, hasCode('cancelled'));
        await assert.rejects(
            flow.signUp({ signUpCredentials: {} }),
            hasCode('cancelled')
        );
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['signup']
        );
        assert.equal(fixture.loads, 0);
    });

    it('does not hide an API rejection with invented code-specific behavior or actions', async () => {
        const error = new SDKError('Synthetic unknown API code', {
            kind: 'api',
            code: 'new_backend_code',
        });
        const fixture = authFixture({
            signup: async () => {
                throw error;
            },
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        await assert.rejects(
            flow.signUp({ signUpCredentials: {} }),
            (actual) => actual === error
        );
        assert.equal(flow.isCurrent(), true);
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['signup']
        );
        assert.equal(fixture.loads, 0);
    });

    it('fails before dispatch on invalid credential values without echoing their content', async () => {
        const fixture = authFixture();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        await assert.rejects(
            flow.login({
                loginCredentials: {
                    Password: {
                        enteredSecret: 'never_echo',
                    } as unknown as string,
                },
            }),
            (error) => {
                assert.ok(error instanceof TypeError);
                assert.equal(error.message.includes('never_echo'), false);
                return true;
            }
        );
        assert.equal(fixture.calls.length, 0);
        assert.equal(flow.isCurrent(), true);
    });

    it('fails closed on malformed endpoint data without fabricating a response or session', async () => {
        const fixture = authFixture({
            password: async () => ({
                type: 'correct',
                encryptedExtensionPassword: '',
            }),
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: passwordPage(),
            getScope: scope,
        });
        await assert.rejects(
            flow.verifyPassword({ extensionPassword: 'example' }),
            TypeError
        );
        assert.equal(flow.isCurrent(), false);
        assert.equal(fixture.applied.length, 0);
        assert.equal(fixture.calls.length, 1);
    });
});
