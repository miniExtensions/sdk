import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPackageFileSync } from './package-manager-launch.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    ratingInputTypedConsumer,
    checkRatingInputConsumer,
} from './rating-input-consumer-checks.mjs';

const self = fileURLToPath(import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Fresh installed React18/19 proof with mandatory, verified publication-age admission. */
export async function checkControlledRatingReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    archivePath = resolve(archivePath);
    const archiveSha256 = sha(readFileSync(archivePath));
    const profiles = [];
    for (const version of ['18.3.1', '19.2.0']) {
        const root = mkdtempSync(join(tmpdir(), 'sdk-controlled-rating-'));
        const manifest = {
            private: true,
            type: 'module',
            packageManager: 'pnpm@10.28.2',
            dependencies: {
                '@miniextensions/sdk': `file:${archivePath}`,
                react: version,
                'react-dom': version,
                '@types/react': version === '18.3.1' ? '18.3.12' : '19.2.2',
                '@types/react-dom': version === '18.3.1' ? '18.3.1' : '19.2.2',
                '@types/node': '22.20.5',
            },
        };
        const policy = {
            minimumReleaseAge: 2880,
            minimumReleaseAgeExclude: [],
            blockExoticSubdeps: true,
            strictPeerDependencies: true,
            ignoreScripts: true,
        };
        try {
            writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
            const policyText =
                Object.entries(policy)
                    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                    .join('\n') + '\n';
            writeFileSync(join(root, 'pnpm-workspace.yaml'), policyText);
            const pnpm = (args) =>
                execPackageFileSync('pnpm', args, {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 120000,
                    env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0' },
                });
            assert.equal(pnpm(['--version']).trim(), '10.28.2');
            for (const [key, value] of Object.entries(policy))
                assert.deepEqual(
                    JSON.parse(pnpm(['config', 'get', key, '--json']).trim()),
                    value
                );
            assert.equal(sha(readFileSync(archivePath)), archiveSha256);
            pnpm(['install', '--strict-peer-dependencies', '--ignore-scripts']);
            assert.equal(
                readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
                policyText
            );
            const lockSha256 = sha(readFileSync(join(root, 'pnpm-lock.yaml')));
            for (const extension of ['mts', 'cts']) {
                const path = join(root, `controlled-rating.${extension}`);
                writeFileSync(path, ratingInputTypedConsumer);
                execFileSync(
                    process.execPath,
                    [
                        typescriptBin,
                        '--strict',
                        '--noEmit',
                        '--target',
                        'ES2022',
                        '--module',
                        'NodeNext',
                        '--moduleResolution',
                        'NodeNext',
                        '--types',
                        'node,react',
                        path,
                    ],
                    { cwd: root, stdio: 'pipe', timeout: 120000 }
                );
            }
            const proof = JSON.parse(
                execFileSync(
                    process.execPath,
                    [self, 'runtime', root, happyDomModulePath],
                    { cwd: root, encoding: 'utf8', timeout: 120000 }
                )
            );
            assert.equal(proof.formats.length, 2);
            assert.equal(proof.inputChecks, 2);
            assert.equal(proof.reactVersion, version);
            const require = createRequire(join(root, 'package.json'));
            const css = readFileSync(
                require.resolve('@miniextensions/sdk/react/rating.css')
            );
            assert.match(css.toString(), /\.mx-sdk-rating-icon/);
            assert.match(
                css.toString(),
                /\.mx-sdk-rating-empty\s*\{[^}]*line-height:\s*1\.25rem\s*;/
            );
            assert.match(css.toString(), /@media print/);
            assert.equal(sha(readFileSync(archivePath)), archiveSha256);
            profiles.push({
                version,
                archiveSha256,
                lockSha256,
                policy,
                types: ['NodeNext ESM', 'NodeNext CJS'],
                cssSha256: sha(css),
                ...proof,
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }
    return { profiles, cleanup: 'completed' };
}

async function runtime(root, happyDomModulePath) {
    const require = createRequire(join(root, 'package.json'));
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const formats = [];
    for (const format of ['esm', 'cjs']) {
        const api =
            format === 'cjs'
                ? require('@miniextensions/sdk/react')
                : await import(
                      pathToFileURL(
                          join(
                              root,
                              'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
                          )
                      )
                  );
        const changes = [];
        const tree = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.RatingField, {
                    mode: 'controlled',
                    value: 8,
                    max: 3,
                    icon: 'heart',
                    color: 'redBright',
                    id: 'hydrated-rating',
                    title: 'Score',
                    describedBy: 'rating-help',
                    labels: { repair: 'Repair' },
                    onChange: (value) => changes.push(value),
                })
            );
        const serverWarnings = [];
        const previousServerError = console.error;
        let html;
        try {
            console.error = (...args) =>
                serverWarnings.push(args.map(String).join(' '));
            html = renderToString(tree());
        } finally {
            console.error = previousServerError;
        }
        assert.deepEqual(serverWarnings, []);
        assert.match(html, /mx-sdk-rating-icon/);
        assert.match(html, /hydrated-rating/);
        assert.deepEqual(changes, []);
        const window = new Window();
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
            'HTMLInputElement',
            'IS_REACT_ACT_ENVIRONMENT',
        ];
        const saved = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        keys.forEach((key) =>
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
            })
        );
        const container = window.document.createElement('div');
        container.innerHTML = html;
        window.document.body.append(container);
        const originalWarning = container
            .querySelector('input')
            .getAttribute('aria-describedby');
        const errors = [];
        const warnings = [];
        const previousError = console.error;
        let hydrated;
        try {
            console.error = (...args) =>
                warnings.push(args.map(String).join(' '));
            const { hydrateRoot } = require('react-dom/client');
            await React.act(async () => {
                hydrated = hydrateRoot(container, tree(), {
                    onRecoverableError: (error) => errors.push(String(error)),
                });
            });
            assert.deepEqual(errors, []);
            assert.deepEqual(warnings, []);
            assert.deepEqual(changes, []);
            assert.equal(
                container
                    .querySelector('input')
                    .getAttribute('aria-describedby'),
                originalWarning
            );
            assert.equal(
                container.querySelector('input').getAttribute('aria-label'),
                'Score'
            );
            assert.equal(
                container.querySelectorAll('.mx-sdk-rating-icon').length,
                3
            );
            await React.act(async () =>
                container.querySelector('.mx-sdk-rating-repair').click()
            );
            assert.deepEqual(changes, [3]);
            formats.push({
                format,
                ssr: true,
                hydration: true,
                strictMode: true,
                postHydrationRepair: true,
            });
        } finally {
            console.error = previousError;
            if (hydrated) await React.act(async () => hydrated.unmount());
            keys.forEach((key, i) =>
                saved[i]
                    ? Object.defineProperty(globalThis, key, saved[i])
                    : Reflect.deleteProperty(globalThis, key)
            );
            await window.happyDOM.close();
        }
    }
    const inputChecks = await checkRatingInputConsumer({
        consumerDirectory: root,
        happyDomModulePath,
    });
    return { reactVersion: React.version, formats, inputChecks };
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === self &&
    process.argv[2] === 'runtime'
) {
    console.log(
        JSON.stringify(await runtime(process.argv[3], process.argv[4]))
    );
}
