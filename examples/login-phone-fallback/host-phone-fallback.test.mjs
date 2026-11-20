import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { createHostPhoneFallback } from './host-phone-fallback.mjs';

// Exact source control from SDK e93ac6d052d394ee7cf0c38c9a57aa7615b98bc6.
// Map TS runtime imports as Node runs the checked-in source, not a packed SDK.
// The unused tRPC library is an import-only guard: any invocation fails the test.
const blobs = {
  'auth/flow.ts': '7b6477474bee30e533bf31c5b970dd383aa59b08',
  'runtime/client.ts': '857d2995ace39144f647ed89723b07cb53af3b1a',
  'runtime/session.ts': '7f91da421c58df7e06795de5f880aa23fcd4ff75',
};
const upstream = process.env.SDK_SOURCE_ROOT
  ? new URL(process.env.SDK_SOURCE_ROOT).href
  : new URL('../../src/', import.meta.url).href;
for (const [path, sha] of Object.entries(blobs)) {
  const bytes = readFileSync(new URL(path, upstream));
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), sha, path);
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.startsWith(upstream)) return next(specifier, context);
    if (specifier === '@trpc/client') {
      return { url: 'data:text/javascript,' + encodeURIComponent('export function createTRPCUntypedClient(){throw Error("unexpected transport")} export const httpLink=createTRPCUntypedClient'), shortCircuit: true };
    }
    if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.replace(/\.js$/, '.ts'), context);
    return next(specifier, context);
  },
});
const { createAuthFlow } = await import(new URL('auth/flow.ts', upstream).href);
hooks.deregister();
globalThis.fetch = () => { throw Error('unexpected network'); };

const localeCopy = '[synthetic localized phone-not-found message]';
const miss = { type: 'known-phone-not-found' };
function setup(send, isCurrent = () => true) {
  const calls = [];
  const makeChallenge = (kind, id) => ({
    notice: Object.freeze({ kind, label: kind === 'email' ? 'fixture@example.invalid' : 'fixture phone' }),
    confirm: async (code) => { calls.push(['confirm', id, code]); },
  });
  const email = makeChallenge('email', 'email-original');
  const phone = makeChallenge('phoneNumber', 'phone-new');
  const adapter = createHostPhoneFallback({
    email, isCurrent, phoneNotFoundCopy: () => localeCopy,
    sendPhone: (value) => { calls.push(['fallback', value]); return send(phone); },
  });
  return { adapter, calls, email, phone };
}

test('known no-record: show localized error and confirm original email exactly once', async () => {
  const { adapter, calls, email } = setup(async () => miss);
  assert.equal(await adapter.replaceWithPhone('missing-phone'), 'retained');
  assert.equal(adapter.read().error, localeCopy);
  const original = adapter.read().challenge;
  assert.equal(original, email.notice);
  assert.deepEqual(calls, [['fallback', 'missing-phone']]);
  assert.equal(await adapter.confirm(original, 'fixture-code'), 'confirmed');
  assert.equal(await adapter.confirm(original, 'fixture-code'), 'ignored');
  assert.deepEqual(calls, [['fallback', 'missing-phone'], ['confirm', 'email-original', 'fixture-code']]);
});

test('known no-record then successful retry: adopt one phone challenge, no stale confirm', async () => {
  let sends = 0;
  let finish;
  const { adapter, calls, email, phone } = setup(async (challenge) => {
    if (++sends === 1) return miss;
    return new Promise((resolve) => { finish = () => resolve({ type: 'phone-challenge', challenge }); });
  });
  const notices = [adapter.read().challenge];
  assert.equal(await adapter.replaceWithPhone('missing-phone'), 'retained');
  notices.push(adapter.read().challenge);
  const retry = adapter.replaceWithPhone('working-phone');
  assert.equal(await adapter.replaceWithPhone('duplicate-gesture'), 'ignored');
  notices.push(adapter.read().challenge);
  finish();
  assert.equal(await retry, 'replaced');
  notices.push(adapter.read().challenge);
  assert.deepEqual(notices, [email.notice, email.notice, email.notice, phone.notice]);
  assert.equal(await adapter.replaceWithPhone('duplicate-after-success'), 'ignored');
  assert.equal(adapter.read().error, null);
  assert.equal(await adapter.confirm(email.notice, 'stale-code'), 'ignored');
  assert.equal(await adapter.confirm(phone.notice, 'fixture-code'), 'confirmed');
  assert.equal(await adapter.confirm(phone.notice, 'fixture-code'), 'ignored');
  assert.deepEqual(calls, [['fallback', 'missing-phone'], ['fallback', 'working-phone'], ['confirm', 'phone-new', 'fixture-code']]);
});

test('unknown transport outcome does not revive the original path', async () => {
  const { adapter, calls, email } = setup(async () => { throw Error('synthetic ambiguous delivery'); });
  assert.equal(await adapter.replaceWithPhone('ambiguous-phone'), 'recovery');
  assert.equal(adapter.read().challenge, null);
  assert.equal(adapter.read().error, null);
  assert.equal(await adapter.confirm(email.notice, 'fixture-code'), 'ignored');
  assert.deepEqual(calls, [['fallback', 'ambiguous-phone']]);
});

test('retired owner cannot display a late phone response or confirm', async () => {
  let current = true;
  let finish;
  const { adapter, calls, email } = setup((challenge) => new Promise((resolve) => {
    finish = () => resolve({ type: 'phone-challenge', challenge });
  }), () => current);
  const result = adapter.replaceWithPhone('working-phone');
  current = false;
  finish();
  assert.equal(await result, 'ignored');
  assert.equal(adapter.read(), null);
  assert.equal(await adapter.confirm(email.notice, 'fixture-code'), 'ignored');
  assert.deepEqual(calls, [['fallback', 'working-phone']]);
});

test('SDK source negative control: fallback no-record retires the prior opaque handle before dispatch', async () => {
  const calls = [];
  const client = { getSession: () => ({}), auth: {
    login: async (input) => {
      calls.push(input.fallbackPhoneVerificationNumber ?? 'email');
      if (input.fallbackPhoneVerificationNumber) return { type: 'no-record' };
      return { type: 'verification-message-sent', verificationId: 'email-original', verificationType: 'email', emailOrPhoneNumber: 'fixture@example.invalid' };
    },
    confirmVerificationCode: async () => { assert.fail('stale SDK handle reached host transport'); },
  } };
  const flow = createAuthFlow({ client, getScope: () => ({ ownerId: 'fixture-owner', revision: 1 }),
    page: { extensionId: 'fixture-extension', extensionScreen: 'login_page', language: 'en', payload: { tableId: 'fixture-table', loginFieldNames: ['Email'] } } });
  const loginCredentials = { Email: 'fixture@example.invalid' };
  const email = await flow.login({ loginCredentials });
  assert.equal(email.type, 'verification-message-sent');
  assert.deepEqual(await flow.login({ loginCredentials, fallbackPhoneVerificationNumber: 'missing-phone' }), { type: 'no-record' });
  await assert.rejects(flow.confirmVerificationCode({ challenge: email.challenge, verificationCode: 'fixture-code' }), { code: 'invalid-challenge' });
  assert.deepEqual(calls, ['email', 'missing-phone']);
  flow.destroy();
});
