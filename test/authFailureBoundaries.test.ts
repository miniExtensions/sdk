import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthFlowError, createAuthFlow } from '../src/auth/index.js';
import {
    SDKError,
    type ConfirmVerificationCodeResult,
    type LoginResult,
} from '../src/runtime/index.js';
import {
    authFixture,
    deferred,
    loginPage,
    verificationSent,
} from './authFixtures.js';

const scope = () => ({ ownerId: 'visitor_example', revision: 0 });
const hasCode = (code: AuthFlowError['code']) => (error: unknown) =>
    error instanceof AuthFlowError && error.code === code;

describe('authentication failure boundaries', () => {
    const malformedLogins: Array<[string, unknown]> = [
        ['missing response', null],
        ['unknown result discriminator', { type: 'unexpected' }],
        [
            'empty encrypted credential',
            { type: 'found-record', encryptedLoginToken: '' },
        ],
        [
            'invalid verification channel',
            { ...verificationSent(), verificationType: 'sms' },
        ],
        [
            'missing verification recipient',
            { ...verificationSent(), emailOrPhoneNumber: null },
        ],
        [
            'empty verification identity',
            { ...verificationSent(), verificationId: ' ' },
        ],
    ];
    for (const [description, response] of malformedLogins) {
        it(`retires login with ${description} without granting credentials or resending`, async () => {
            const fixture = authFixture({
                login: async () => response as LoginResult,
            });
            const flow = createAuthFlow({
                client: fixture.client,
                page: loginPage(),
                getScope: scope,
            });
            await assert.rejects(
                flow.login({ loginCredentials: {} }),
                TypeError
            );
            assert.equal(flow.isCurrent(), false);
            await assert.rejects(
                flow.login({ loginCredentials: {} }),
                hasCode('reload-required')
            );
            assert.deepEqual(fixture.client.getSession(), {
                previous: 'encrypted_previous',
            });
            assert.deepEqual(fixture.applied, []);
            assert.equal(fixture.calls.length, 1);
            assert.equal(fixture.loads, 0);
        });
    }

    it('does not reuse a verification challenge after a malformed confirmation response', async () => {
        const fixture = authFixture({
            login: async () => verificationSent(),
            confirm: async () =>
                null as unknown as ConfirmVerificationCodeResult,
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const result = await flow.login({ loginCredentials: {} });
        assert.equal(result.type, 'verification-message-sent');
        if (result.type !== 'verification-message-sent')
            throw new Error('Expected challenge');
        const input = {
            challenge: result.challenge,
            verificationCode: 'synthetic_code',
        };
        await assert.rejects(flow.confirmVerificationCode(input), TypeError);
        await assert.rejects(
            flow.confirmVerificationCode(input),
            hasCode('reload-required')
        );
        assert.equal(flow.isCurrent(), false);
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['login', 'confirm']
        );
        assert.deepEqual(fixture.applied, []);
    });

    it('does not retry account creation after an invalid signup acknowledgement', async () => {
        const fixture = authFixture({
            signup: async () => ({ ok: 'true' }) as unknown as { ok: boolean },
        });
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        await assert.rejects(flow.signUp({ signUpCredentials: {} }), TypeError);
        await assert.rejects(
            flow.signUp({ signUpCredentials: {} }),
            hasCode('reload-required')
        );
        assert.deepEqual(
            fixture.calls.map((call) => call.operation),
            ['signup']
        );
        assert.deepEqual(fixture.applied, []);
        assert.equal(fixture.loads, 0);
    });

    it('retains a fulfilled grant when the former request signal is aborted later', async () => {
        const fixture = authFixture();
        const controller = new AbortController();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const result = await flow.login(
            { loginCredentials: {} },
            { signal: controller.signal }
        );
        assert.equal(result.type, 'found-record');
        if (result.type !== 'found-record') throw new Error('Expected grant');
        controller.abort(new Error('Former request owner unmounted'));
        assert.equal(flow.isCurrent(), true);
        assert.equal(fixture.calls[0].options?.signal?.aborted, false);
        const session = flow.applySession(result.grant);
        assert.equal(
            Object.values(session).includes('encrypted_login_example'),
            true
        );
        assert.deepEqual(fixture.applied, [session]);
        assert.throws(
            () => flow.applySession(result.grant),
            hasCode('reload-required')
        );
    });

    it('retires an unreadable owner before surfacing a late API rejection', async () => {
        const response = deferred<LoginResult>();
        const fixture = authFixture({ login: () => response.promise });
        let readable = true;
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: () => {
                if (!readable) throw new Error('Owner was unmounted');
                return scope();
            },
        });
        const pending = flow.login({ loginCredentials: {} });
        readable = false;
        response.reject(
            new SDKError('Old owner API rejection', { kind: 'api' })
        );
        await assert.rejects(pending, hasCode('scope-changed'));
        readable = true;
        assert.equal(flow.isCurrent(), false);
        await assert.rejects(
            flow.login({ loginCredentials: {} }),
            hasCode('scope-changed')
        );
        assert.equal(fixture.calls[0].options?.signal?.aborted, true);
        assert.equal(fixture.calls.length, 1);
        assert.deepEqual(fixture.applied, []);
    });

    it('keeps cancellation authoritative when an abort-ignoring request rejects later', async () => {
        const response = deferred<LoginResult>();
        const fixture = authFixture({ login: () => response.promise });
        const controller = new AbortController();
        const flow = createAuthFlow({
            client: fixture.client,
            page: loginPage(),
            getScope: scope,
        });
        const pending = flow.login(
            { loginCredentials: {} },
            { signal: controller.signal }
        );
        const cancellation = new Error('Synthetic owner cancellation');
        controller.abort(cancellation);
        response.reject(
            new SDKError('Late transport failure', { kind: 'network' })
        );
        await assert.rejects(pending, (error) => error === cancellation);
        assert.equal(flow.isCurrent(), false);
        await assert.rejects(
            flow.login({ loginCredentials: {} }),
            hasCode('cancelled')
        );
        assert.equal(fixture.calls.length, 1);
        assert.deepEqual(fixture.applied, []);
    });
});
