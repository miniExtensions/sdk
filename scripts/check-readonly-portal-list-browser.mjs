import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';
import { checkReadonlyPortalListBrowser } from './readonly-portal-list-browser-checks.mjs';
const output = resolve(process.argv[2] ?? 'dist/readonly-list-browser-proof');
mkdirSync(output, { recursive: true });
assert(
    !existsSync(join(output, 'receipt.json')),
    'Retained proof must not be overwritten'
);
let temporary;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, options = {}) =>
    execFileSync(command, args, {
        cwd: temporary,
        stdio: 'inherit',
        timeout: 120000,
        ...options,
    });
const report = {
    scope: 'Packed SDK List with synthetic host; native and hosted acceptance remain separate',
    profiles: [],
    passed: false,
    cleanup: {},
};
let browser;
try {
    temporary = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-readonly-list-browser-'))
    );
    const executablePath = realpathSync(process.env.SDK_NATIVE_CHROMIUM ?? '');
    assert(
        lstatSync(executablePath).isFile(),
        'Verified Chromium executable is required'
    );
    report.chromium = {
        path: executablePath,
        sha256: digest(readFileSync(executablePath)),
    };
    let archive;
    if (process.env.SDK_NATIVE_PACKAGE_DIR) {
        const kit = resolve(process.env.SDK_NATIVE_PACKAGE_DIR);
        const names = readdirSync(kit).filter((name) => name.endsWith('.tgz'));
        assert.equal(names.length, 1);
        archive = join(kit, names[0]);
        assert.equal(
            digest(readFileSync(archive)),
            JSON.parse(readFileSync(join(kit, 'artifact-receipt.json'), 'utf8'))
                .package.sha256
        );
    } else {
        run(process.execPath, ['scripts/build.mjs'], { cwd: process.cwd() });
        const packed = JSON.parse(
            run(
                'npm',
                [
                    'pack',
                    '--ignore-scripts',
                    '--json',
                    '--pack-destination',
                    temporary,
                ],
                {
                    cwd: process.cwd(),
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'inherit'],
                }
            )
        )[0];
        archive = join(temporary, packed.filename);
    }
    report.archiveSHA256 = digest(readFileSync(archive));
    writeFileSync(
        join(temporary, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            dependencies: { '@miniextensions/sdk': `file:${archive}` },
        })
    );
    browser = await chromium.launch({ executablePath, headless: true });
    for (const version of ['18.3.1', '19.2.0']) {
        runAgeQualifiedConsumerInstall(run, [
            'install',
            '--ignore-scripts',
            '--strict-peer-deps',
            '--no-audit',
            '--no-fund',
            '--package-lock=false',
            `react@${version}`,
            `react-dom@${version}`,
        ]);
        const evidence = {};
        report.profiles.push(evidence);
        await checkReadonlyPortalListBrowser({
            browser,
            consumer: temporary,
            evidence,
            output,
        });
        assert.equal(evidence.react, version);
    }
    report.ageReceipts = JSON.parse(
        readFileSync(
            join(temporary, 'consumer-age-install-receipts.json'),
            'utf8'
        )
    );
    report.passed = true;
} catch (error) {
    report.error = error.stack ?? String(error);
    throw error;
} finally {
    if (browser) {
        await browser.close();
        report.cleanup.browserClosed = true;
    }
    if (temporary) {
        rmSync(temporary, { recursive: true });
        report.cleanup.temporaryRemoved = true;
    }
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
}
