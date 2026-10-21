import assert from 'node:assert/strict';
import { it } from 'node:test';
import { getSelectAddOptionPresentation } from '../src/ui/index.js';

const base = {
    options: ['Existing'],
    searchTerm: '  New choice  ',
    resultCount: 0,
    allowAddingNewOptions: true,
    hasAddOptionCallback: true,
};

it('trims only the presentation and distinguishes empty, whitespace and equivalent strings', () => {
    assert.deepEqual(getSelectAddOptionPresentation(base), {
        kind: 'add',
        searchTerm: 'New choice',
        showSeparator: false,
    });
    assert.equal(base.searchTerm, '  New choice  ');
    for (const searchTerm of ['', ' \t\n ', ' EXISTING ']) {
        assert.equal(
            getSelectAddOptionPresentation({ ...base, searchTerm }).kind,
            'no-results'
        );
    }
    assert.equal(
        getSelectAddOptionPresentation({ ...base, searchTerm: 'New  choice' })
            .searchTerm,
        'New  choice'
    );
});

it('uses caller canonical and alias text without inferring object metadata', () => {
    const options = Object.freeze([
        Object.freeze({
            id: '',
            canonicalName: 'Native',
            displayName: ' Friendly ',
        }),
    ]);
    for (const searchTerm of [' NATIVE ', ' fRiEnDlY ']) {
        assert.equal(
            getSelectAddOptionPresentation({
                ...base,
                options,
                searchTerm,
                getOptionTextValues: (option) => [
                    option.canonicalName,
                    option.displayName,
                ],
            }).kind,
            'no-results'
        );
    }
    assert.equal(
        getSelectAddOptionPresentation({
            ...base,
            options,
            searchTerm: 'Native',
        }).kind,
        'add'
    );
    assert.equal(options[0]!.id, '');
    // A supplied extractor replaces the string fallback, including an empty list.
    assert.equal(
        getSelectAddOptionPresentation({
            ...base,
            searchTerm: 'Existing',
            getOptionTextValues: () => [],
        }).kind,
        'add'
    );
    assert.equal(
        getSelectAddOptionPresentation({
            ...base,
            searchTerm: ' Alias ',
            getOptionTextValues: () => ['alias'],
        }).kind,
        'no-results'
    );
});

it('requires permission and callback availability, then uses the actual result count', () => {
    for (const denied of [
        { allowAddingNewOptions: false },
        { allowAddingNewOptions: undefined },
        { hasAddOptionCallback: false },
    ]) {
        for (const resultCount of [0, 1, 3]) {
            const result = getSelectAddOptionPresentation({
                ...base,
                ...denied,
                resultCount,
            });
            assert.equal(
                result.kind,
                resultCount === 0 ? 'no-results' : 'none'
            );
            assert.equal(result.showSeparator, false);
        }
    }
    for (const resultCount of [0, 1, 3]) {
        const result = getSelectAddOptionPresentation({ ...base, resultCount });
        assert.equal(result.kind, 'add');
        assert.equal(result.showSeparator, resultCount > 0);
    }
});

it('loading takes precedence over add, no-results and existing results', () => {
    for (const resultCount of [0, 2]) {
        for (const searchTerm of ['', 'Existing', 'New']) {
            for (const allowAddingNewOptions of [false, true]) {
                assert.deepEqual(
                    getSelectAddOptionPresentation({
                        ...base,
                        resultCount,
                        searchTerm,
                        allowAddingNewOptions,
                        isLoading: true,
                    }),
                    { kind: 'loading', searchTerm, showSeparator: false }
                );
            }
        }
    }
});
