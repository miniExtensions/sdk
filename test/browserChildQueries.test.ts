import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { it } from 'node:test';
import { build } from 'esbuild';

it('starter child query snapshots preserve canonical Save and conservative cascade boundaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sdk-child-query-test-'));
    try {
        const file = join(dir, 'queries.mjs');
        await build({
            entryPoints: [resolve('examples/browser/src/childQueries.ts')],
            bundle: true,
            platform: 'node',
            format: 'esm',
            outfile: file,
            logLevel: 'silent',
        });
        const { childQuerySnapshots } = await import(pathToFileURL(file).href);
        const child = (setting: unknown = undefined, edit = false) => ({
            payload: {
                formRecord: { type: edit ? 'edit' : 'create' },
                publicFields: {
                    state: { prefillURLParamsForAddingRecords: setting },
                },
            },
        });
        const dynamic =
            'prefill_Country=Old&prefill_Country=New&prefill_Region=One&prefill_Region=Two&dynamicOnly=yes';
        const result = childQuerySnapshots(
            dynamic,
            child('prefill_Country=Static&prefill_City=First&prefill_City=Last')
        );
        assert.deepEqual(result.cascade, {
            prefill_Country: 'Static',
            prefill_Region: ['One', 'Two'],
            dynamicOnly: 'yes',
            prefill_City: ['First', 'Last'],
        });
        assert.deepEqual(result.save, {
            prefill_Country: 'New',
            prefill_Region: 'Two',
            dynamicOnly: 'yes',
        });
        result.cascade.dynamicOnly = 'changed';
        assert.equal(result.save.dynamicOnly, 'yes');
        for (const empty of [undefined, null]) {
            assert.deepEqual(childQuerySnapshots(empty, child(empty)), {
                cascade: {},
                save: {},
                diagnostic: null,
            });
            assert.deepEqual(
                childQuerySnapshots(empty, child('prefill_Country=Static'))
                    .cascade,
                { prefill_Country: 'Static' }
            );
        }
        for (const wrong of [false, 42, [], {}]) {
            const dynamicBad = childQuerySnapshots(wrong, child());
            assert.deepEqual(dynamicBad.cascade, {});
            assert.deepEqual(dynamicBad.save, {});
            assert.match(dynamicBad.diagnostic, /could not be reconstructed/);
            const staticBad = childQuerySnapshots(dynamic, child(wrong));
            assert.deepEqual(staticBad.cascade, {});
            assert.equal(staticBad.save.prefill_Country, 'New');
            assert.match(staticBad.diagnostic, /Ordinary draft editing/);
        }
        for (const publicFields of [
            false,
            42,
            [],
            { state: 42 },
            { state: [] },
        ])
            assert.match(
                childQuerySnapshots(dynamic, {
                    payload: { formRecord: { type: 'create' }, publicFields },
                }).diagnostic,
                /could not be reconstructed/
            );
        assert.deepEqual(
            childQuerySnapshots(dynamic, child('prefill_Country=Static', true)),
            { cascade: {}, save: {}, diagnostic: null }
        );
        const loaded = child('prefill_Country=Static');
        const captured = childQuerySnapshots(dynamic, loaded);
        loaded.payload.publicFields.state.prefillURLParamsForAddingRecords =
            'prefill_Country=Mutated';
        assert.equal(captured.cascade.prefill_Country, 'Static');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
