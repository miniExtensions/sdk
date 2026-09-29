import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'miniextensions-sdk-'));
const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));

function run(command, args, cwd = temporaryDirectory) {
    return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
    });
}

try {
    const packed = JSON.parse(
        run(
            'npm',
            [
                'pack',
                '--json',
                '--ignore-scripts',
                '--pack-destination',
                temporaryDirectory,
            ],
            process.cwd()
        )
    )[0];
    for (const { path } of packed.files) {
        assert(
            path === 'package.json' ||
                path === 'README.md' ||
                path === 'LICENSE' ||
                path === 'THIRD_PARTY_NOTICES.md' ||
                path === 'docs/formulas.md' ||
                path.startsWith('dist/esm/') ||
                path.startsWith('dist/cjs/'),
            `Unexpected published file: ${path}`
        );
    }
    writeFileSync(
        join(temporaryDirectory, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
    );
    run('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        join(temporaryDirectory, packed.filename),
    ]);

    const consumer = `
import { FormulaRunner, AirtableFieldType } from '@miniextensions/sdk/formulas';
interface NumericOptions { precision: number; }
const numericOptions: NumericOptions = { precision: 0 };
const runner = new FormulaRunner('{Quantity} * 3');
runner.context = {
    record: { id: 'recExample', fields: { fldQuantity: 4 } },
    airtableFields: [{
        id: 'fldQuantity', name: 'Quantity', isPrimaryField: true,
        config: { type: AirtableFieldType.NUMBER, options: numericOptions }
    }],
    linkedTableLoadingStates: {}
};
if (runner.run() !== 12) throw new Error('Formula context did not resolve');
export const result = runner.run();
`;
    const javascriptConsumer = consumer.replace(
        'interface NumericOptions { precision: number; }\nconst numericOptions: NumericOptions',
        'const numericOptions'
    );
    writeFileSync(join(temporaryDirectory, 'consumer.mjs'), javascriptConsumer);
    run(process.execPath, ['consumer.mjs']);

    writeFileSync(
        join(temporaryDirectory, 'consumer.cjs'),
        `const { FormulaRunner } = require('@miniextensions/sdk/formulas');
if (new FormulaRunner('2 + 3 * 4').run() !== 14) throw new Error('CommonJS formula evaluation failed');
`
    );
    run(process.execPath, ['consumer.cjs']);

    for (const [filename, module, moduleResolution] of [
        ['consumer.mts', 'NodeNext', 'NodeNext'],
        ['consumer.cts', 'NodeNext', 'NodeNext'],
        ['browser-consumer.ts', 'ESNext', 'Bundler'],
    ]) {
        writeFileSync(join(temporaryDirectory, filename), consumer);
        run(process.execPath, [
            require.resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            'false',
            '--target',
            'ES2022',
            '--module',
            module,
            '--moduleResolution',
            moduleResolution,
            filename,
        ]);
    }

    const bundled = await build({
        entryPoints: [join(temporaryDirectory, 'consumer.mjs')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'miniExtensionsFormulaExample',
        write: false,
        logLevel: 'silent',
    });
    const browserContext = {};
    runInNewContext(bundled.outputFiles[0].text, browserContext, {
        timeout: 10000,
    });
    assert.equal(browserContext.miniExtensionsFormulaExample.result, 12);

    function checkPortableOutput(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                checkPortableOutput(path);
            } else if (
                entry.name.endsWith('.js') ||
                entry.name.endsWith('.ts')
            ) {
                assert.doesNotMatch(
                    readFileSync(path, 'utf8'),
                    /@type-system\/|['"]@\/|\/Users\//,
                    `Non-portable package reference: ${entry.name}`
                );
            }
        }
    }
    checkPortableOutput(
        join(temporaryDirectory, 'node_modules/@miniextensions/sdk/dist')
    );
    console.log(
        `${packageMetadata.name}: packed ESM/CommonJS, TypeScript declarations, and browser bundle passed`
    );
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
}
