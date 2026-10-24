import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(process.cwd());
let directory: string;
let presentation: {
    createLinkedReviewPresentation: unknown;
    prepareFormReviewRows: unknown;
    unavailableLinkedAnswer: string;
    createFormSaveInput: unknown;
};
const { checkLinkedReviewMasking, checkLinkedReviewProvenance } = await import(
    pathToFileURL(join(root, 'scripts/linked-review-recipe-checks.mjs')).href
);

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-linked-review-masking-'));
    const outfile = join(directory, 'presentation.mjs');
    await build({
        stdin: {
            contents: [
                "export { createLinkedReviewPresentation, unavailableLinkedAnswer } from './examples/browser/src/linkedReview.ts';",
                "export { prepareFormReviewRows } from './examples/browser/src/review.ts';",
                "export { createFormSaveInput } from '@miniextensions/sdk/forms';",
            ].join('\n'),
            resolveDir: root,
            sourcefile: 'linked-review-masking-test.ts',
            loader: 'ts',
        },
        alias: {
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        logLevel: 'silent',
    });
    presentation = await import(pathToFileURL(outfile).href);
});

after(async () => rm(directory, { recursive: true, force: true }));

describe('linked Review accepted primary masking', () => {
    it('protects both flags before reading every supported primary type across options and hydration', () => {
        assert.equal(
            checkLinkedReviewMasking({
                create: presentation.createLinkedReviewPresentation,
                review: presentation.prepareFormReviewRows,
                generic: presentation.unavailableLinkedAnswer,
                createFormSaveInput: presentation.createFormSaveInput,
            }).checks,
            104
        );
    });
});

it('rejects lost policy provenance and uses only unambiguous own primary values', () => {
    assert.equal(
        checkLinkedReviewProvenance({
            create: presentation.createLinkedReviewPresentation,
            generic: presentation.unavailableLinkedAnswer,
        }).checks,
        56
    );
});
