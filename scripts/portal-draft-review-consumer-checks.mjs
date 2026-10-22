import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Execute the two reviewed regressions against the installed public package. */
export async function checkPortalDraftReviewConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'portal-draft-review-public.mjs');
    writeFileSync(
        loader,
        `export {createPortalInlineEditQueue,createPortalCellBinding} from '@miniextensions/sdk/portals';
export {RecoveryJournal} from '@miniextensions/sdk/forms';
export {createMiniExtensionsClient} from '@miniextensions/sdk';
export const urls = ['', '/forms', '/portals'].map(entry => import.meta.resolve('@miniextensions/sdk' + entry));
`
    );
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const installed = realpathSync(
        join(consumerDirectory, 'node_modules/@miniextensions/sdk')
    );
    const failures = [];
    let checks = 0;
    for (const format of ['esm', 'cjs']) {
        const api =
            format === 'esm'
                ? await import(pathToFileURL(loader).href)
                : {
                      ...require('@miniextensions/sdk'),
                      ...require('@miniextensions/sdk/forms'),
                      ...require('@miniextensions/sdk/portals'),
                      urls: ['', '/forms', '/portals'].map((entry) =>
                          require.resolve('@miniextensions/sdk' + entry)
                      ),
                  };
        for (const url of api.urls)
            assert(
                realpathSync(
                    format === 'esm' ? fileURLToPath(url) : url
                ).startsWith(`${installed}/dist/${format}/`)
            );
        const check = async (name, run) => {
            try {
                await run();
                checks++;
                console.log(
                    `Installed Portal review ${format}: ${name} passed`
                );
            } catch (error) {
                failures.push(error);
                console.error(
                    `Installed Portal review ${format}: ${name} FAILED`,
                    error
                );
            }
        };
        await check(
            'second native read retirement refuses canonical write',
            () => {
                let reads = 0;
                let writes = 0;
                let transports = 0;
                let observed = false;
                let armed = false;
                let cell;
                const client = api.createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.test',
                    session: { visitor: 'A' },
                    fetch: async () => {
                        transports++;
                        throw new Error('No transport while editing');
                    },
                });
                cell = api.createPortalCellBinding({
                    client,
                    input: {
                        portalExtensionAccessToken: 'token',
                        portalFieldId: 'fld_children',
                        recordFieldId: 'fld_title',
                        recordId: 'rec_one',
                    },
                    schema: {
                        fieldType: 'singleLineText',
                        airtableField: {
                            id: 'fld_title',
                            name: 'Title',
                            isComputed: false,
                            config: { type: 'singleLineText', options: null },
                        },
                        miniExtConfig: {},
                    },
                    value: 'Initial',
                    getScope: () => ({ ownerId: 'A', revision: 0 }),
                    isCurrent: () => true,
                    recovery: {
                        journal: new api.RecoveryJournal(),
                        scope: {
                            owner: 'A',
                            parentFieldId: 'fld_children',
                            tableId: 'tbl_children',
                            childExtensionId: '',
                            context: 'modal',
                        },
                        loadVersion: 1,
                    },
                    draft: {
                        read: () => {
                            if (armed && ++reads === 2) {
                                armed = false;
                                observed = true;
                                cell.destroy();
                            }
                            return 'Initial';
                        },
                        dirty: () => false,
                        revision: () => 0,
                        write: () => {
                            writes++;
                            return true;
                        },
                        markSaved: () => true,
                    },
                });
                try {
                    armed = true;
                    const result = cell.binding.setValue('Edited');
                    assert.equal(observed, true);
                    assert.equal(writes, 0);
                    assert.equal(result.accepted, false);
                    assert.equal(cell.binding.getSnapshot().retired, true);
                    assert.equal(transports, 0);
                } finally {
                    cell.destroy();
                }
            }
        );
        await check(
            'projection fault retains successful transport and completion',
            async () => {
                const receipt = { value: 'Canonical A' };
                const projection = new Error('Projection failed');
                const committed = [];
                const errors = [];
                let visible = 'Initial';
                let batches = 0;
                let idle = 0;
                const queue = api.createPortalInlineEditQueue({
                    commit: async () => receipt,
                    committedValue: () => {
                        throw projection;
                    },
                });
                try {
                    queue.enqueue({
                        cell: {
                            tableId: 'table',
                            recordId: 'record',
                            fieldId: 'field',
                        },
                        committedValue: visible,
                        value: 'A',
                        request: {},
                        applyValue: (value) => {
                            visible = value;
                        },
                        onCommitted: (result) => committed.push(result),
                        onError: (error) => errors.push(error),
                        onBatchSettled: () => {
                            batches++;
                        },
                        onIdle: () => {
                            idle++;
                        },
                    });
                    await queue.flush();
                    assert.equal(visible, 'A');
                    assert.equal(committed[0], receipt);
                    assert.deepEqual(errors, [projection]);
                    assert.equal(batches, 1);
                    assert.equal(idle, 1);
                    assert.equal(queue.hasPending(), false);
                } finally {
                    queue.dispose();
                }
            }
        );
    }
    if (failures.length)
        throw new AggregateError(
            failures,
            'Installed Portal review regressions failed'
        );
    console.log(
        `Installed Portal review: ${checks} ESM/CommonJS regressions passed.`
    );
    return { checks };
}
