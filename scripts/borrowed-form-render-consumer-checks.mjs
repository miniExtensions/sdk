import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const borrowedFormRenderTypedConsumer = `
import { createBorrowedFormRenderScope, type BorrowedFormRenderPort } from '@miniextensions/sdk/ui';
import { AirtableForm } from '@miniextensions/sdk/react';
export function nativeVoidForm(port: BorrowedFormRenderPort<void>) {
    const scope = createBorrowedFormRenderScope(port);
    const done: Promise<void> = scope.getSnapshot().actions.submit();
    const presentation = AirtableForm({scope, renderers: {}, children: state => {
        const submit: () => Promise<void> = state.actions.submit;
        void submit;
        return null;
    }});
    return {done, presentation};
}
`;

export async function checkBorrowedFormRenderConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const loader = join(consumerDirectory, 'borrowed-form-render-exports.mjs');
    writeFileSync(
        loader,
        "export * from '@miniextensions/sdk/ui';\nexport const resolved = import.meta.resolve('@miniextensions/sdk/ui');\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const installed = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    assert.equal(
        realpathSync(fileURLToPath(esm.resolved)),
        realpathSync(join(installed, 'dist/esm/ui/index.js'))
    );
    assert.equal(
        realpathSync(require.resolve('@miniextensions/sdk/ui')),
        realpathSync(join(installed, 'dist/cjs/ui/index.js'))
    );
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        let submits = 0;
        const scope = api.createBorrowedFormRenderScope({
            read: () => ({
                owner: 1,
                configuration: 1,
                fields: [],
                canSubmit: true,
            }),
            subscribe: () => () => {},
            write: () => {
                throw new Error('No construction write allowed');
            },
            submit: async (_owner, admit) => {
                assert.equal(admit(), true);
                assert.equal(admit(), false);
                submits++;
            },
        });
        assert.equal(submits, 0);
        const action = scope.getSnapshot().actions.submit;
        assert.equal(await action(), undefined);
        await assert.rejects(action());
        assert.equal(submits, 1);
        scope.destroy();
    }
    return 2;
}
