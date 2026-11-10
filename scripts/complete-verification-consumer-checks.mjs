import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const completeVerificationTypedConsumer = String.raw`
import {createElement} from 'react';
import {CompleteVerificationScreen,type CompleteVerificationScreenProps,type CompleteVerificationScreenLabels} from '@miniextensions/sdk/react';
const result=Object.freeze({synthetic:true});
const labels:CompleteVerificationScreenLabels={sentCodeTo:'Code sent to',enterCode:'Verification code',continue:'Continue',reload:'Reload',attemptsExhausted:'Attempts exhausted',loading:'Loading'};
const props:CompleteVerificationScreenProps<typeof result>={verificationId:'synthetic',maskedDestination:'***42',labels,async confirm(input){void input.verificationId;void input.verificationCode;return result;},async continueWithResult(value){const exact:typeof result=value;void exact;},reload(){},onError(error){void error.message;},inputId:'verification',className:'consumer',accentColor:'#0f766e',formatErrorMessage:message=>message,pendingDetails:createElement('aside',null,'Host timeout/help')};
createElement(CompleteVerificationScreen<typeof result>,props);
// @ts-expect-error confirmation transport is an explicit adapter
const noConfirm:CompleteVerificationScreenProps<typeof result>={verificationId:'synthetic',maskedDestination:'***42',labels,continueWithResult:props.continueWithResult,reload(){}};
// @ts-expect-error continuation is an explicit adapter, not SDK session installation
const noContinuation:CompleteVerificationScreenProps<typeof result>={verificationId:'synthetic',maskedDestination:'***42',labels,confirm:props.confirm,reload(){}};
// @ts-expect-error results remain typed, not cast into a grant or token
const wrong:CompleteVerificationScreenProps<string>={...props};
// @ts-expect-error no private-result snapshot or whole native renderer
const renderer:CompleteVerificationScreenProps<typeof result>={...props,renderNative(){return null;}};
// @ts-expect-error React-free core does not import the screen
import {CompleteVerificationScreen as CoreScreen} from '@miniextensions/sdk';
void noConfirm;void noContinuation;void wrong;void renderer;void CoreScreen;
`;

async function checkInstalled(directory, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const cjs = consumer('@miniextensions/sdk/react');
    const esm = await import(
        pathToFileURL(
            join(
                directory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const css = readFileSync(
        consumer.resolve('@miniextensions/sdk/react/complete-verification.css'),
        'utf8'
    );
    for (const selector of [
        '.mx-sdk-verification',
        '.mx-sdk-verification-input',
        '.mx-sdk-verification-submit',
        '.mx-sdk-verification-error',
        '.mx-sdk-verification-loading',
    ])
        assert(css.includes(selector));
    const results = [];
    for (const [module, api] of [
        ['esm', esm],
        ['cjs', cjs],
    ]) {
        const secret = Object.freeze({
            privateSyntheticResult: 'must-not-be-rendered',
        });
        const labels = {
            sentCodeTo: 'Code sent to',
            enterCode: 'Verification code',
            continue: 'Continue',
            reload: 'Reload',
            attemptsExhausted: 'Attempts exhausted',
            loading: 'Loading',
        };
        let confirms = 0,
            continues = 0,
            reloads = 0,
            networks = 0;
        const identity = [];
        let props = {
            verificationId: 'synthetic-A',
            maskedDestination: '<b>***42</b>',
            labels,
            async confirm() {
                confirms++;
                return secret;
            },
            async continueWithResult(value) {
                identity.push(value === secret);
                if (++continues === 1)
                    throw new Error('Synthetic load failure');
            },
            reload() {
                reloads++;
            },
        };
        const element = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.CompleteVerificationScreen, props)
            );
        assert.equal(typeof document, 'undefined');
        const html = renderToString(element());
        assert(html.includes('&lt;b&gt;***42&lt;/b&gt;'));
        assert(!html.includes('<b>***42</b>'));
        assert(html.includes('type="submit"'));
        assert.equal(confirms, 0);
        assert.equal(continues, 0);
        const window = new Window({
            url: 'https://consumer.invalid',
            settings: {
                fetch: {
                    interceptor: {
                        beforeAsyncRequest() {
                            networks++;
                            throw new Error('No network permitted');
                        },
                        beforeSyncRequest() {
                            networks++;
                            throw new Error('No network permitted');
                        },
                    },
                },
            },
        });
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
            'HTMLInputElement',
            'IS_REACT_ACT_ENVIRONMENT',
        ];
        const originals = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        for (const key of keys)
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
            });
        const host = window.document.createElement('main');
        host.innerHTML = html;
        window.document.body.append(host);
        const { hydrateRoot } = consumer('react-dom/client');
        let root;
        const recoverable = [];
        try {
            await React.act(async () => {
                root = hydrateRoot(host, element(), {
                    onRecoverableError: (error) =>
                        recoverable.push(error.message),
                });
            });
            assert.deepEqual(recoverable, []);
            const input = () => {
                const node = host.querySelector('input');
                assert(node);
                return node;
            };
            const edit = async (value) => {
                await React.act(async () => {
                    Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        'value'
                    ).set.call(input(), value);
                    input().dispatchEvent(
                        new window.Event('input', { bubbles: true })
                    );
                });
            };
            const submit = async () => {
                const form = host.querySelector('form');
                assert(form);
                await React.act(async () => {
                    const event = new window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    });
                    form.dispatchEvent(event);
                    assert(event.defaultPrevented);
                });
            };
            assert.equal(host.querySelector('button').disabled, true);
            assert.equal(input().pattern, '\\d*');
            assert.equal(input().labels[0].textContent, labels.enterCode);
            await edit('123456');
            assert.equal(host.querySelector('button').disabled, false);
            await submit();
            assert.equal(
                host.querySelector('[role=alert]').textContent,
                'Synthetic load failure'
            );
            assert.equal(confirms, 1);
            assert.equal(continues, 1);
            props = {
                ...props,
                async continueWithResult(value) {
                    identity.push(value === secret);
                    continues++;
                },
            };
            await React.act(async () => root.render(element()));
            await submit();
            assert.equal(confirms, 1);
            assert.equal(continues, 2);
            assert.deepEqual(identity, [true, true]);
            assert(host.querySelector('[role=status]'));
            assert.equal(host.querySelector('form'), null);
            assert(!host.innerHTML.includes('must-not-be-rendered'));
            assert.equal(window.localStorage.length, 0);
            assert.equal(window.sessionStorage.length, 0);
            await React.act(async () => root.unmount());
            root = undefined;
            assert.equal(host.textContent, '');
            assert.equal(reloads, 0);
            assert.equal(networks, 0);
            results.push({
                module,
                confirmationCount: confirms,
                continuationCount: continues,
                resultIdentityPreserved: identity.every(Boolean),
                hydrationErrors: recoverable.length,
            });
        } finally {
            if (root) await React.act(async () => root.unmount());
            keys.forEach((key, i) => {
                if (originals[i])
                    Object.defineProperty(globalThis, key, originals[i]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return {
        react: React.version,
        groups: results.length,
        results,
        networkRequests: 0,
    };
}

export function checkCompleteVerificationReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-complete-verification-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: { '@miniextensions/sdk': `file:${archivePath}` },
            })
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = `complete-verification.${extension}`;
                writeFileSync(
                    join(directory, name),
                    completeVerificationTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    name,
                ]);
            }
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        '--run-consumer',
                        directory,
                        happyDomModulePath,
                    ],
                    {
                        cwd: directory,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'inherit'],
                    }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            assert.equal(result.networkRequests, 0);
            versions.push(result);
            console.log(
                `Installed complete verification React${result.react}: ESM/CJS/types/CSS/SSR/hydration and private-result continuation retry passed; no network.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
if (process.argv[2] === '--run-consumer')
    console.log(
        JSON.stringify(await checkInstalled(process.argv[3], process.argv[4]))
    );
