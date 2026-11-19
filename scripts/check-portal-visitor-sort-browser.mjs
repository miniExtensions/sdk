import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stop as stopBuildService } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { checkPortalVisitorSortBrowser } from './portal-visitor-sort-browser-checks.mjs';

const [archive, executablePath, expectedSha256, queryFlag, ...unexpected] =
    process.argv.slice(2);
assert.ok(archive && executablePath && expectedSha256);
assert.ok(
    queryFlag === undefined ||
        queryFlag === '--include-search' ||
        queryFlag === '--include-view-buttons' ||
        queryFlag === '--include-filter'
);
assert.deepEqual(unexpected, []);
assert.equal(realpathSync(archive), archive);
assert.equal(realpathSync(executablePath), executablePath);
const archiveDigest = () =>
    createHash('sha256').update(readFileSync(archive)).digest('hex');
assert.equal(archiveDigest(), expectedSha256);
const receipt = { archiveSha256: expectedSha256, profiles: [], cleanup: {} };
let browser;
try {
    browser = await chromium.launch({
        executablePath,
        headless: true,
        chromiumSandbox: true,
    });
    receipt.browser = browser.version();
    for (const react of ['18.3.1', '19.2.0']) {
        const consumer = mkdtempSync(
            join(tmpdir(), 'sdk-visitor-sort-browser-consumer-')
        );
        const evidence = { react };
        receipt.profiles.push(evidence);
        try {
            writeFileSync(
                join(consumer, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': 'file:' + archive,
                        react,
                        'react-dom': react,
                    },
                })
            );
            installAgeQualifiedConsumer({
                directory: consumer,
                args: ['install', '--ignore-scripts'],
            });
            await checkPortalVisitorSortBrowser({
                browser,
                consumer,
                evidence,
                expectedReactVersion: react,
                includeSearch: queryFlag === '--include-search',
                includeViewButtons: queryFlag === '--include-view-buttons',
                includeFilter: queryFlag === '--include-filter',
            });
            assert.equal(archiveDigest(), expectedSha256);
        } finally {
            rmSync(consumer, { recursive: true });
            evidence.consumerCleanup = 'completed';
        }
    }
} finally {
    try {
        if (browser) {
            await browser.close();
            receipt.cleanup.browser = 'completed';
        }
    } finally {
        stopBuildService();
        receipt.cleanup.bundler = 'completed';
        console.log(JSON.stringify(receipt));
    }
}
