import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Checkpoint = {
    attempts: number;
    saves: number;
    reads: number;
    dialogs: number;
    banner: { text: string; error: boolean };
    privateDetailVisible: boolean;
    childTitle: string;
    parentTitle: string;
    parentLinks: string[];
};
const { assertFailedConfirmation } = (await import(
    pathToFileURL(
        resolve('scripts/browser-linked-child-confirmation-native.mjs')
    ).href
)) as {
    assertFailedConfirmation(
        actual: Checkpoint,
        expected: Pick<
            Checkpoint,
            'reads' | 'childTitle' | 'parentTitle' | 'parentLinks'
        >
    ): void;
};
const expected = {
    reads: 2,
    childTitle: '<strong>Child draft retained</strong>',
    parentTitle: 'Parent draft retained',
    parentLinks: ['rec_existing', 'rec_existing', 'rec_sibling'],
};
const checkpoint = (): Checkpoint => ({
    ...structuredClone(expected),
    attempts: 1,
    saves: 0,
    dialogs: 0,
    banner: {
        text: 'Child Save was not accepted. Retry only after checking its state.',
        error: true,
    },
    privateDetailVisible: false,
});

describe('installed starter confirmation proof acceptance', () => {
    it('accepts a sanitized refusal with untouched drafts and no transport', () => {
        assertFailedConfirmation(checkpoint(), expected);
    });
    const invalid: Array<[string, (actual: Checkpoint) => void]> = [
        ['fault never exercised', (actual) => (actual.attempts = 0)],
        ['Save allocated', (actual) => (actual.saves = 1)],
        ['extra read', (actual) => actual.reads++],
        ['leaked modal', (actual) => (actual.dialogs = 1)],
        [
            'neutral cancellation banner',
            (actual) => (actual.banner.error = false),
        ],
        ['missing failure feedback', (actual) => (actual.banner.text = '')],
        [
            'private detail disclosed',
            (actual) => (actual.privateDetailVisible = true),
        ],
        ['child draft lost', (actual) => (actual.childTitle = '')],
        ['parent draft lost', (actual) => (actual.parentTitle = '')],
        ['parent links changed', (actual) => actual.parentLinks.pop()],
    ];
    for (const [name, mutate] of invalid)
        it(`rejects false proof: ${name}`, () => {
            const actual = checkpoint();
            mutate(actual);
            assert.throws(() => assertFailedConfirmation(actual, expected), {
                code: 'ERR_ASSERTION',
            });
        });
});
