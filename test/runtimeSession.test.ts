import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    generateLoginCredentialKey,
    withExtensionPassword,
    withLoginToken,
} from '../src/runtime/index.js';

describe('runtime credential helpers', () => {
    it('rejects a hosted Firebase principal instead of copying it into visitor credentials', () => {
        const session = { miniExtSession: 'hosted_firebase_principal' };
        assert.throws(
            () =>
                withExtensionPassword(session, {
                    extensionId: 'extension_example',
                    encryptedExtensionPassword: 'password_token',
                }),
            TypeError
        );
        assert.throws(
            () =>
                withLoginToken(session, {
                    extensionId: 'extension_example',
                    tableId: 'table_example',
                    loginFieldNames: ['Email'],
                    encryptedLoginToken: 'login_token',
                }),
            TypeError
        );
        assert.deepEqual(session, {
            miniExtSession: 'hosted_firebase_principal',
        });
    });

    it('adds an extension-bound password credential to a new session', () => {
        const session = { existing: 'existing_token' };
        const next = withExtensionPassword(session, {
            extensionId: 'extension_example',
            encryptedExtensionPassword: 'password_token',
        });
        assert.deepEqual(next, {
            existing: 'existing_token',
            'miniExtb7BuZl-extension_example': 'password_token',
        });
        assert.deepEqual(session, { existing: 'existing_token' });
        assert.notEqual(next, session);
    });

    for (const loginFieldNames of [
        ['A'],
        ['AB'],
        ['ABC'],
        ['Émail', 'Access key'],
    ]) {
        it(`matches the UTF-8 credential key for ${JSON.stringify(loginFieldNames)}`, () => {
            const originalNames = [...loginFieldNames];
            const session = { existing: 'existing_token' };
            const scope = {
                extensionId: 'extension_example',
                tableId: 'table_example',
                loginFieldNames,
            };
            const next = withLoginToken(session, {
                ...scope,
                encryptedLoginToken: 'login_token',
            });
            const key = encodeURIComponent(
                Buffer.from(
                    [...loginFieldNames].sort().join('') +
                        scope.tableId +
                        scope.extensionId,
                    'utf8'
                ).toString('base64')
            );
            assert.deepEqual(next, {
                existing: 'existing_token',
                [key]: 'login_token',
            });
            assert.deepEqual(loginFieldNames, originalNames);
            assert.deepEqual(session, { existing: 'existing_token' });
            assert.notEqual(next, session);
        });
    }

    it('keeps table and extension login scopes distinct and sorts a copy of field names', () => {
        const credential = {
            extensionId: 'extension_one',
            tableId: 'table_one',
            loginFieldNames: ['Second', 'First'],
            encryptedLoginToken: 'token_one',
        };
        const first = withLoginToken({}, credential);
        assert.deepEqual(
            first,
            withLoginToken(
                {},
                { ...credential, loginFieldNames: ['First', 'Second'] }
            )
        );
        assert.notDeepEqual(
            first,
            withLoginToken({}, { ...credential, tableId: 'table_two' })
        );
        assert.notDeepEqual(
            first,
            withLoginToken({}, { ...credential, extensionId: 'extension_two' })
        );
        assert.deepEqual(credential.loginFieldNames, ['Second', 'First']);
    });
});

describe('hosted login credential key compatibility', () => {
    // Fixed keys produced by the unchanged hosted helper at monorepo 52444394.
    const cases = [
        {
            name: 'ordered ASCII',
            loginFieldNames: ['beta', 'alpha', 'gamma'],
            tableId: 'tblOrders',
            extensionId: 'extPortal',
            expected: 'YWxwaGFiZXRhZ2FtbWF0YmxPcmRlcnNleHRQb3J0YWw%3D',
        },
        {
            name: 'Unicode',
            loginFieldNames: ['Émail', '💼', '名前'],
            tableId: 'tblCafé',
            extensionId: 'ext门户',
            expected: 'w4ltYWls5ZCN5YmN8J%2BSvHRibENhZsOpZXh06Zeo5oi3',
        },
        {
            name: 'UTF-16 sort',
            loginFieldNames: ['\uE000', '\u{10000}'],
            tableId: 'tblOne',
            extensionId: 'extOne',
            expected: '8JCAgO6AgHRibE9uZWV4dE9uZQ%3D%3D',
        },
        {
            name: 'duplicate fields',
            loginFieldNames: ['Email', 'Email', 'Access'],
            tableId: 'tblOne',
            extensionId: 'extOne',
            expected: 'QWNjZXNzRW1haWxFbWFpbHRibE9uZWV4dE9uZQ%3D%3D',
        },
        {
            name: 'empty fields',
            loginFieldNames: [],
            tableId: 'tblOne',
            extensionId: 'extOne',
            expected: 'dGJsT25lZXh0T25l',
        },
        {
            name: 'URI escaping',
            loginFieldNames: ['\uffff'],
            tableId: 'tblOne',
            extensionId: 'extOne',
            expected: '77%2B%2FdGJsT25lZXh0T25l',
        },
        {
            name: 'unpaired surrogate',
            loginFieldNames: ['\ud800'],
            tableId: 'tblOne',
            extensionId: 'extOne',
            expected: '77%2B9dGJsT25lZXh0T25l',
        },
    ];
    for (const { name, expected, ...input } of cases) {
        it(`preserves the legacy key and input for ${name}`, () => {
            const scope = Object.freeze({
                ...input,
                loginFieldNames: Object.freeze([...input.loginFieldNames]),
            });
            assert.equal(generateLoginCredentialKey(scope), expected);
            assert.equal(
                generateLoginCredentialKey({
                    ...scope,
                    loginFieldNames: [...scope.loginFieldNames].reverse(),
                }),
                expected
            );
            assert.deepEqual(
                withLoginToken(
                    {},
                    { ...scope, encryptedLoginToken: 'synthetic-token' }
                ),
                { [expected]: 'synthetic-token' }
            );
            assert.deepEqual(scope.loginFieldNames, input.loginFieldNames);
        });
    }
});
