import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPackageFileSync } from './package-manager-launch.mjs';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkReadonlyPortalListReactMatrix } from './readonly-portal-list-consumer-checks.mjs';

// Focused diagnostic. The full check:package/source/browser gates remain required.
const output = resolve(process.argv[2] ?? 'dist/readonly-list-consumer-proof');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'sdk-readonly-list-pack-'));
const require = createRequire(import.meta.url);
const report = {
    scope: 'Packed readonly Portal List consumers only',
    passed: false,
};
try {
    execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
    // Match the maintained package checker: build first, then archive those bytes.
    const packed = JSON.parse(
        execPackageFileSync(
            'npm',
            [
                'pack',
                '--ignore-scripts',
                '--json',
                '--pack-destination',
                temporary,
            ],
            { encoding: 'utf8' }
        )
    )[0];
    assert(packed.filename.endsWith('.tgz'));
    Object.assign(
        report,
        checkReadonlyPortalListReactMatrix({
            archivePath: join(temporary, packed.filename),
            typescriptBin: require.resolve('typescript/bin/tsc'),
            happyDomModulePath: require.resolve('happy-dom'),
            esbuildModulePath: require.resolve('esbuild'),
        })
    );
    report.passed = true;
} catch (error) {
    report.error = error.stack ?? String(error);
    throw error;
} finally {
    rmSync(temporary, { recursive: true });
    report.archiveScratchRemoved = true;
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
}
