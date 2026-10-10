import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const moduleNames = new Set([
    'none',
    'commonjs',
    'amd',
    'umd',
    'system',
    'es6',
    'es2015',
    'es2020',
    'es2022',
    'esnext',
    'node16',
    'node18',
    'node20',
    'nodenext',
    'preserve',
]);
const resolutionNames = new Set([
    'classic',
    'node10',
    'node16',
    'nodenext',
    'bundler',
]);

export function fingerprint(path) {
    try {
        const bytes = readFileSync(path);
        return {
            size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        };
    } catch {
        return { size: null, sha256: null };
    }
}

/** Build-only diagnostics: never publish raw compiler output or environment. */
export function compilerMetadata(
    compiler,
    project,
    execute = spawnSync,
    nodeOptions = process.env.NODE_OPTIONS ?? ''
) {
    assert(
        project === 'tsconfig.json' || project === 'tsconfig.cjs.json',
        'Unsupported compiler project'
    );
    const run = (args) => {
        try {
            return execute(process.execPath, [compiler, ...args], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 30000,
                maxBuffer: 1024 * 1024,
            });
        } catch {
            return { error: true, status: null, stdout: '' };
        }
    };
    const version = run(['--version']);
    const config = run(['--project', project, '--showConfig']);
    let options = null;
    if (!config.error && config.status === 0) {
        try {
            options = JSON.parse(config.stdout).compilerOptions;
        } catch {
            /* No raw output. */
        }
    }
    let compilerEntry = 'outside-typescript-package';
    try {
        const packageRoot = dirname(require.resolve('typescript/package.json'));
        if (relative(packageRoot, compiler).split('\\').join('/') === 'bin/tsc')
            compilerEntry = 'typescript/bin/tsc';
    } catch {
        /* No private resolution error. */
    }
    const validConfig =
        options !== null &&
        typeof options === 'object' &&
        !Array.isArray(options);
    return {
        schemaVersion: 1,
        project,
        compilerEntry,
        compiler: fingerprint(compiler),
        compilerVersion:
            !version.error &&
            version.status === 0 &&
            /^Version \d{1,3}\.\d{1,3}\.\d{1,3}\s*$/.test(version.stdout ?? '')
                ? version.stdout.trim().slice('Version '.length)
                : 'unknown',
        configuration: validConfig ? 'available' : 'unavailable',
        module:
            validConfig && moduleNames.has(options.module)
                ? options.module
                : 'unknown',
        moduleResolution:
            validConfig && resolutionNames.has(options.moduleResolution)
                ? options.moduleResolution
                : 'unknown',
        nodeVersion: process.version,
        inheritedNodeOptionsPresent: nodeOptions.length !== 0,
        inheritedPreloadHint:
            /--(?:require|import|loader|experimental-loader)(?:[=\s]|$)|(?:^|\s)-r(?:[=\s]|$)/.test(
                nodeOptions
            ),
    };
}
