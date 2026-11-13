import assert from 'node:assert/strict';
import {
    mkdtempSync,
    mkdirSync,
    readdirSync,
    realpathSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { checkExternalSyncSourceControlledBrowser } from './external-sync-source-controlled-browser-checks.mjs';

it('removes its source directory when the installed stylesheet cannot be read', async () => {
    const consumer = mkdtempSync(
        join(realpathSync(tmpdir()), 'external-source-cleanup-')
    );
    const evidence = {};
    try {
        mkdirSync(join(consumer, 'node_modules/@miniextensions/sdk'), {
            recursive: true,
        });
        await assert.rejects(
            checkExternalSyncSourceControlledBrowser({
                consumer,
                evidence,
                output: consumer,
                browser: new Proxy(
                    {},
                    {
                        get() {
                            throw Error(
                                'No browser should start before CSS validation'
                            );
                        },
                    }
                ),
            }),
            { code: 'ENOENT' }
        );
        assert.deepEqual(readdirSync(consumer), ['node_modules']);
        assert.deepEqual(evidence.cleanup, {
            contextClosed: true,
            serverClosed: true,
            sourceDirectoryRemoved: true,
        });
    } finally {
        rmSync(consumer, { recursive: true, force: true });
    }
});
