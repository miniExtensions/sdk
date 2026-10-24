import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkIfFormUrlIsValid } from '../src/forms/index.js';

describe('public Form URL syntax predicate', () => {
    const accepted = [
        'http://example.test',
        'https://example.test/path?q=a%20b#fragment',
        'HTTPS://EXAMPLE.TEST',
        'example.test',
        'example.test:8080/path',
        'https://example.test:443/path',
        'https://example.test:',
        '//example.test',
        'https://example.test.',
        'https://192.0.2.1',
        'https://127.1',
        'https://例え.test/道',
        'xn--r8jz45g.test',
        `https://${'a'.repeat(63)}.test`,
        'https://example.test/a%2Fb',
        'https://example.test/%250A',
        'https://example.test/%ZZ',
        'mailto:person@example.test',
        'mailto:first@example.test,second@example.test',
        'mailto:person%2Btag%40example.test',
        'mailto:person@example.test?subject=Synthetic%20subject',
    ];
    const rejected = [
        '',
        'https://',
        '/synthetic/path',
        'example.test:65536',
        'https://example.test:bad',
        'http:example.test',
        'http://localhost',
        'https://synthetic',
        'https://999.0.2.1',
        'https://[2001:db8::1]',
        'https://[2001:db8::1',
        'https://example..test',
        'https://-example.test',
        'https://example-.test',
        'https://some_host.test',
        `https://${'a'.repeat(64)}.test`,
        `https://${Array(4).fill('a'.repeat(63)).join('.')}`,
        'https://person@example.test',
        'https://person:password@example.test',
        'person@example.test',
        'javascript:alert(1)',
        'data:text/plain,Synthetic',
        'ftp://example.test',
        'file:///synthetic',
        'synthetic:example.test',
        ' https://example.test',
        'https://example.test ',
        'https://example.test/a b',
        'https://example.test/\u00a0',
        'https://example.test\\path',
        'mailto:',
        'mailto:person@example.test,',
        'mailto:person@example.test,invalid',
        'mailto://person@example.test',
        'mailto:%ZZ@example.test',
        'mailto:person%20name@example.test',
    ];

    for (const value of accepted) {
        it(`accepts ${JSON.stringify(value)} without returning a replacement`, () => {
            assert.equal(checkIfFormUrlIsValid(value), true);
        });
    }
    for (const value of rejected) {
        it(`rejects ${JSON.stringify(value)}`, () => {
            assert.equal(checkIfFormUrlIsValid(value), false);
        });
    }
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
        it(`rejects literal and encoded control ${code}`, () => {
            const hex = code.toString(16).padStart(2, '0');
            for (const control of [
                String.fromCharCode(code),
                `%${hex}`,
                `%${hex.toUpperCase()}`,
            ]) {
                assert.equal(
                    checkIfFormUrlIsValid(`https://example.test/${control}`),
                    false
                );
                assert.equal(
                    checkIfFormUrlIsValid(
                        `mailto:person@example.test?subject=${control}`
                    ),
                    false
                );
            }
        });
    }
});
