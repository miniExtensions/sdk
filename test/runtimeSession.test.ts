import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withExtensionPassword, withLoginToken } from '../src/runtime/index.js';

describe('runtime credential helpers', () => {
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
