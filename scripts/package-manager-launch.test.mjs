import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import test from 'node:test';
import { resolvePackageManagerLaunch } from './package-manager-launch.mjs';

const node = 'C:\\Program Files\\nodejs\\node.exe';
const directory = 'C:\\Program Files\\nodejs';
const global = 'C:\\Users\\SDK test\\AppData\\Roaming\\npm';
const args = ['install', 'file:C:\\sdk kit\\a&b %x% !y!.tgz', '--offline'];
const options = {
    cwd: 'C:\\SDK space\\consumer',
    env: { Path: `"${directory}";${global}`, PathExt: '.EXE;.CMD' },
    timeout: 12000,
};

function windows(files, execute = () => assert.fail('Unexpected subprocess')) {
    return {
        platform: 'win32',
        node,
        exists: (file) => Object.hasOwn(files, file),
        readShim: (file) => files[file],
        execute,
    };
}

test('Windows npm preserves the configured npm shim prefix and literal arguments', () => {
    const bundled = win32.join(directory, 'node_modules/npm/bin/npm-cli.js');
    const probe = win32.join(directory, 'node_modules/npm/bin/npm-prefix.js');
    const npm = win32.join(global, 'node_modules/npm/bin/npm-cli.js');
    const shim = String.raw`SET "NPM_PREFIX_JS=%~dp0\node_modules\npm\bin\npm-prefix.js"
SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"`;
    const files = {
        [win32.join(directory, 'npm.cmd')]: shim,
        [bundled]: '',
        [probe]: '',
        [npm]: '',
    };
    assert.deepEqual(
        resolvePackageManagerLaunch(
            'npm',
            args,
            options,
            windows(files, (...call) => {
                assert.deepEqual(call, [
                    node,
                    [probe],
                    {
                        ...options,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                    },
                ]);
                return global + '\r\n';
            })
        ),
        [node, [npm, ...args]]
    );
});

test('Windows resolves package-manager shims without treating them as shell commands', () => {
    const corepack = win32.join(
        directory,
        'node_modules/corepack/dist/corepack.js'
    );
    const pnpmCorepack = win32.join(
        directory,
        'node_modules/corepack/dist/pnpm.js'
    );
    const pnpmGlobal = win32.join(directory, 'node_modules/pnpm/bin/pnpm.cjs');
    const files = {
        [win32.join(directory, 'corepack.cmd')]:
            String.raw`node "%~dp0\node_modules\corepack\dist\corepack.js" %*`,
        [win32.join(directory, 'pnpm.cmd')]:
            String.raw`node "%~dp0\node_modules\corepack\dist\pnpm.js" %*`,
        [corepack]: '',
        [pnpmCorepack]: '',
        [pnpmGlobal]: '',
    };
    assert.deepEqual(
        resolvePackageManagerLaunch(
            'corepack',
            ['pnpm', ...args],
            options,
            windows(files)
        ),
        [node, [corepack, 'pnpm', ...args]]
    );
    assert.deepEqual(
        resolvePackageManagerLaunch('pnpm', args, options, windows(files)),
        [node, [pnpmCorepack, ...args]]
    );
    files[win32.join(directory, 'pnpm.cmd')] =
        String.raw`node "%dp0%\node_modules\pnpm\bin\pnpm.cjs" %*`;
    assert.deepEqual(
        resolvePackageManagerLaunch('pnpm', args, options, windows(files)),
        [node, [pnpmGlobal, ...args]]
    );
});

test('Windows supports standalone native executables and rejects unknown batch launchers', () => {
    const exe = win32.join(directory, 'pnpm.exe');
    assert.deepEqual(
        resolvePackageManagerLaunch(
            'pnpm',
            args,
            options,
            windows({ [exe]: '' })
        ),
        [exe, args]
    );
    assert.throws(
        () =>
            resolvePackageManagerLaunch(
                'pnpm',
                args,
                options,
                windows({ [win32.join(directory, 'pnpm.cmd')]: 'unknown' })
            ),
        /Cannot locate the installed Windows pnpm/
    );
});

test('Unix and non-package-manager commands retain normal argv and lookup', () => {
    assert.deepEqual(
        resolvePackageManagerLaunch('npm', args, options, {
            platform: 'linux',
        }),
        ['npm', args]
    );
    assert.deepEqual(
        resolvePackageManagerLaunch('tar', args, options, windows({})),
        ['tar', args]
    );
});

test('pnpm workspace .bin shims resolve all three exact Node CLIs with literal argv', () => {
    const bin = 'C:\\SDK space\\workspace\\node_modules\\.bin';
    const environment = {
        ...options,
        env: { ...options.env, Path: `"${bin}";${directory}` },
    };
    for (const [command, entry] of [
        ['npm', String.raw`..\npm\bin\npm-cli.js`],
        ['pnpm', String.raw`..\pnpm\bin\pnpm.cjs`],
        [
            'corepack',
            String.raw`..\.pnpm\corepack@0.34.5\node_modules\corepack\dist\corepack.js`,
        ],
    ]) {
        const target = win32.join(bin, entry);
        const shim = [
            '@SETLOCAL',
            String.raw`@IF EXIST "%~dp0\node.exe" (`,
            '  "%~dp0\\node.exe"  "%~dp0\\' + entry + '" %*',
            ') ELSE (',
            '@SET PATHEXT=%PATHEXT:;.JS;=;%',
            '  node  "%~dp0\\' + entry + '" %*',
            ')',
        ].join('\r\n');
        assert.deepEqual(
            resolvePackageManagerLaunch(
                command,
                args,
                environment,
                windows({
                    [win32.join(bin, command + '.cmd')]: shim,
                    [target]: '',
                })
            ),
            [node, [target, ...args]]
        );
    }
});

test('workspace shims cannot select another package or escape the node_modules layout', () => {
    const bin = 'C:\\SDK space\\workspace\\node_modules\\.bin';
    const environment = { ...options, env: { ...options.env, Path: bin } };
    for (const entry of [
        String.raw`..\evil\bin\npm-cli.js`,
        String.raw`..\..\npm\bin\npm-cli.js`,
    ]) {
        const shim = '  node "%~dp0\\' + entry + '" %*';
        assert.throws(
            () =>
                resolvePackageManagerLaunch(
                    'npm',
                    args,
                    environment,
                    windows({
                        [win32.join(bin, 'npm.cmd')]: shim,
                        [win32.join(bin, entry)]: '',
                    })
                ),
            /Cannot locate the installed Windows npm/
        );
    }
});
