import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    parsePostgresAttachmentDisplay,
    PostgresAttachmentDisplayError,
    POSTGRES_ATTACHMENT_DISPLAY_SYNTAX,
    type PostgresAttachmentDisplayFailure,
    type PostgresValue,
} from '../src/runtime/index.js';

it('projects native text without changing signed URL bytes or encoded commas', () => {
    for (const value of [null, '', ' \t\n'])
        assert.deepEqual(parsePostgresAttachmentDisplay(value), []);
    const first = 'HTTPS://example.invalid/a%2Cb.pdf?signature=a%2Fb%3D&x=1';
    const second = 'http://example.invalid/second#part';
    const stored = ` ${first} , ${second} `;
    assert.deepEqual(parsePostgresAttachmentDisplay(stored), [first, second]);
    assert.equal(stored, ` ${first} , ${second} `);
    assert.match(POSTGRES_ATTACHMENT_DISPLAY_SYNTAX, /%2C/);
    assert.match(
        POSTGRES_ATTACHMENT_DISPLAY_SYNTAX,
        /reachability or public access/
    );
});

it('rejects malformed entries with native reasons and the exact entry index', () => {
    const cases: [unknown, PostgresAttachmentDisplayFailure, number][] = [
        [42, 'NOT_TEXT', 0],
        ['https://example.invalid/ok,', 'EMPTY_ENTRY', 1],
        [',https://example.invalid/ok', 'EMPTY_ENTRY', 0],
        ['"https://example.invalid/secret?token=private"', 'QUOTED_URL', 0],
        ["'https://example.invalid/secret'", 'QUOTED_URL', 0],
        ["'https://example.invalid/secret", 'MALFORMED_URL', 0],
        ['https://example.invalid/a\\b', 'BACKSLASH_ESCAPE', 0],
        ['https://example.invalid/a b', 'MALFORMED_URL', 0],
        ['https://example.invalid/a\u0000b', 'MALFORMED_URL', 0],
        ['https://example.invalid/a\u007fb', 'MALFORMED_URL', 0],
        ['https://example.invalid/%ZZ', 'MALFORMED_URL', 0],
        ['not-an-absolute-url', 'MALFORMED_URL', 0],
        ['https:example.invalid', 'MALFORMED_URL', 0],
        ['https:///example.invalid', 'MALFORMED_URL', 0],
        ['ftp://example.invalid/a', 'NON_HTTP_URL', 0],
        ['https://user:password@example.invalid/a', 'URL_CREDENTIALS', 0],
        ['https://:password@example.invalid/a', 'URL_CREDENTIALS', 0],
        ['https://@example.invalid/a', 'URL_CREDENTIALS', 0],
        [
            'https://example.invalid/ok, ftp://example.invalid/private',
            'NON_HTTP_URL',
            1,
        ],
        ['https://example.invalid/a,b.pdf', 'MALFORMED_URL', 1],
    ];
    for (const [value, reason, index] of cases)
        assert.throws(
            () => parsePostgresAttachmentDisplay(value as PostgresValue),
            (error) => {
                assert(error instanceof PostgresAttachmentDisplayError);
                assert.equal(error.reason, reason);
                assert.equal(error.index, index);
                assert.match(
                    error.message,
                    new RegExp(`Attachment URL ${index + 1}:`)
                );
                assert(!error.message.includes('example.invalid'));
                assert(!error.message.includes('token=private'));
                return true;
            }
        );
});

it('validates syntax without accessing the network or requiring hosted files', (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => {
        throw new Error('Unexpected network access');
    });
    assert.deepEqual(
        parsePostgresAttachmentDisplay(
            'https://unreachable.example.invalid/a.pdf'
        ),
        ['https://unreachable.example.invalid/a.pdf']
    );
    assert.equal(fetch.mock.calls.length, 0);
});
