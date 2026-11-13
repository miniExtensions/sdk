import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    cpSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Real installed package, provider artifact fixture, and React 18/19. */
export function checkCustomerChatMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    // Fail before npm's own retry loop if the prerequisite archive is absent.
    readFileSync(archivePath);
    const directory = mkdtempSync(join(tmpdir(), 'sdk-customer-chat-'));
    const versions = [];
    const rewrite = (source) =>
        source
            .replaceAll(
                '../src/customer-chat/index.js',
                '@miniextensions/sdk/customer-chat'
            )
            .replaceAll(
                '../src/customer-chat/intercom.js',
                '@miniextensions/sdk/customer-chat/intercom'
            )
            .replaceAll(
                '../src/customer-chat/react.js',
                '@miniextensions/sdk/customer-chat/react'
            )
            .replace(
                "'../src/customer-chat/' + 'react.js?second-bundle'",
                "'@miniextensions/sdk/customer-chat/react'"
            )
            .replaceAll("'happy-dom'", JSON.stringify(happyDomModulePath));
    const run = (command, args) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            timeout: 120000,
        });
    try {
        mkdirSync(join(directory, 'test/fixtures'), { recursive: true });
        cpSync(
            new URL('../test/fixtures/customer-chat', import.meta.url),
            join(directory, 'test/fixtures/customer-chat'),
            { recursive: true }
        );
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + resolve(archivePath),
                },
            })
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', dom: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', dom: '19.2.2' },
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                '--cache',
                join(directory, 'npm-cache'),
                '@types/node@22.20.5',
                'react@' + version.react,
                'react-dom@' + version.react,
                '@types/react@' + version.types,
                '@types/react-dom@' + version.dom,
            ]);
            for (const format of ['mts', 'cts']) {
                const files = [];
                for (const name of [
                    'customerChatPlatform',
                    'customerChat.test',
                    'reactCustomerChat.test',
                ]) {
                    const filename = name + '.' + format;
                    let source = rewrite(
                        readFileSync(
                            new URL('../test/' + name + '.ts', import.meta.url),
                            'utf8'
                        )
                    );
                    source = source.replaceAll(
                        './customerChatPlatform.js',
                        './customerChatPlatform.' +
                            (format === 'mts' ? 'mjs' : 'cjs')
                    );
                    writeFileSync(join(directory, filename), source);
                    files.push(filename);
                }
                run(process.execPath, [
                    typescriptBin,
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    ...files,
                ]);
                run(process.execPath, [
                    '--test',
                    '--test-concurrency=1',
                    ...files
                        .filter((f) => f.includes('.test.'))
                        .map((f) =>
                            f.replace(
                                /\.(mts|cts)$/,
                                format === 'mts' ? '.mjs' : '.cjs'
                            )
                        ),
                ]);
            }
            versions.push(version.react);
        }
        return { versions, formats: ['ESM', 'CJS'], cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
