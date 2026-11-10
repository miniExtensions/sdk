import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    getSearchPageQueryKeys,
    getSearchPageSubmissionUrl,
    hasSearchPageQueryParam,
} from '../src/portals/index.js';

const field = { fieldId: 'fld_Search', fieldName: 'Customer name' };

it('recognizes either nonblank name/ID alias without interpreting unrelated query values', () => {
    assert.deepEqual(getSearchPageQueryKeys(field), {
        canonicalQueryKey: 'search_Customer name',
        configuredFieldIdQueryKey: 'search_fld_Search',
    });
    for (const [query, expected] of [
        ['', false],
        ['search_other=anything', false],
        ['search_Customer+name=%20%20&search_fld_Search=%09', false],
        ['search_Customer+name=%20Alice%20', true],
        ['search_fld_Search=Alice', true],
        ['search_Customer+name=&search_fld_Search=Alice', true],
        ['search_Customer+name=&search_Customer+name=Alice', false],
    ] as const)
        assert.equal(
            hasSearchPageQueryParam({
                searchParams: new URLSearchParams(query),
                searchPageField: field,
            }),
            expected,
            query
        );
});

it('uses the exact canonical name key, deleting all configured-ID aliases and preserving unrelated URL state', () => {
    const result = new URL(
        getSearchPageSubmissionUrl({
            currentUrl:
                'https://example.test/portal/path?keep=a&keep=b&search_fld_Search=stale&search_fld_Search=older&search_other=retain#section',
            searchPageField: field,
            searchTerm: '  Alice & Bob  ',
        })
    );
    assert.equal(result.origin, 'https://example.test');
    assert.equal(result.pathname, '/portal/path');
    assert.equal(result.hash, '#section');
    assert.deepEqual(result.searchParams.getAll('keep'), ['a', 'b']);
    assert.equal(result.searchParams.get('search_other'), 'retain');
    assert.equal(result.searchParams.has('search_fld_Search'), false);
    assert.equal(
        result.searchParams.get('search_Customer name'),
        'Alice & Bob'
    );
});

it('round-trips Unicode and reserved field-name/value characters through URLSearchParams', () => {
    const special = {
        fieldId: 'fld_東京&=/#',
        fieldName: 'Équipe 東京 + & / # ? =',
    };
    const input = new URL('https://example.test/a%20b?other=%26#frag');
    input.searchParams.set(`search_${special.fieldId}`, 'old');
    const result = new URL(
        getSearchPageSubmissionUrl({
            currentUrl: input.href,
            searchPageField: special,
            searchTerm: ' \tvalue + & 東京 / # ? =\n ',
        })
    );
    assert.equal(
        result.searchParams.get(`search_${special.fieldName}`),
        'value + & 東京 / # ? ='
    );
    assert.equal(result.searchParams.has(`search_${special.fieldId}`), false);
    assert.equal(result.searchParams.get('other'), '&');
    assert.equal(result.pathname, '/a%20b');
    assert.equal(result.hash, '#frag');
    assert.equal(
        hasSearchPageQueryParam({
            searchParams: result.searchParams,
            searchPageField: special,
        }),
        true
    );
});

it('keeps native URL constructor and same-name/ID behavior without adding navigation', () => {
    assert.throws(() =>
        getSearchPageSubmissionUrl({
            currentUrl: '/relative',
            searchPageField: field,
            searchTerm: 'term',
        })
    );
    const url = new URL(
        getSearchPageSubmissionUrl({
            currentUrl: 'https://example.test/?search_same=old#keep',
            searchPageField: { fieldId: 'same', fieldName: 'same' },
            searchTerm: ' new ',
        })
    );
    assert.deepEqual(url.searchParams.getAll('search_same'), ['new']);
    assert.equal(url.hash, '#keep');
});
