import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const self = fileURLToPath(import.meta.url);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const formCaptchaTypedConsumer = `
import {createElement} from 'react';
import {FormCaptcha,createFormCaptchaProviderRegistry,createRecaptchaV2Provider,type RecaptchaV2Options,type FormCaptchaHost,type FormCaptchaProps,type FormCaptchaProvider} from '@miniextensions/sdk/react';
type Proof={synthetic:true};type Options={theme:string};
declare const host:FormCaptchaHost<Proof,Options>;
createElement(FormCaptcha<Proof,Options>,{mode:'controlled',host,labels:{loading:'Cargando',unavailable:'No disponible'}});
createElement(FormCaptcha,{mode:'preview',labels:{preview:'Vista previa'}});
const registry=createFormCaptchaProviderRegistry();
const provider:FormCaptchaProvider<Proof,Options>=registry.provider({scope:{},configuration:{},load:()=>({render:(container,options,callbacks)=>{
    const node:HTMLElement=container;const theme:string=options.theme;callbacks.change({synthetic:true});callbacks.expired();callbacks.error();void node;void theme;
    return {reset(){},remove(){}};
}})});
// @ts-expect-error preview has no host or provider authority
const mixed:FormCaptchaProps<Proof,Options>={mode:'preview',host};
// @ts-expect-error live widget requires canonical host ports
const missing:FormCaptchaProps={mode:'controlled'};
// @ts-expect-error proof is opaque and remains host-specific
host.publish({owner:{},configurationRevision:0},'not-a-proof');
// @ts-expect-error verification is read-only; the widget has no verification setter
host.setVerified(true);
// @ts-expect-error publication admission is synchronous
const asynchronous:FormCaptchaHost<Proof,Options>={...host,publish:async()=>({status:'admitted'})};
void mixed;void missing;void asynchronous;void provider;
const visible=createRecaptchaV2Provider<Proof>({registry,scope:{},configuration:{},load:()=>({render(container,options){options.callback({synthetic:true});return 0;},reset(id){const owned:number=id;void owned;}})});
// @ts-expect-error visible widget cannot silently enable invisible execution
const invisible:RecaptchaV2Options={sitekey:'synthetic-config',size:'invisible'};
void visible;void invisible;
`;

/** Synthetic host only. No provider script, challenge, network or real proof. */
export function formCaptchaFixture(document) {
    const listeners = new Set();
    const widgets = [];
    const events = [];
    let loads = 0;
    let writes = 0;
    let invalidations = 0;
    const owner = {};
    let snapshot = {
        owner,
        configurationRevision: 0,
        options: { theme: 'light' },
        enabled: true,
        editable: true,
        verified: false,
        token: { owner, configurationRevision: 0, value: null, revision: {} },
        provider: {
            load() {
                loads++;
                return {
                    render(container, options, callbacks) {
                        const node = document.createElement('button');
                        node.type = 'button';
                        node.textContent = 'Synthetic CAPTCHA';
                        node.dataset.captchaWidget = String(widgets.length);
                        node.onclick = () =>
                            callbacks.change({ synthetic: true });
                        container.append(node);
                        const widget = {
                            node,
                            callbacks,
                            options,
                            resets: 0,
                            removes: 0,
                        };
                        widgets.push(widget);
                        return {
                            reset() {
                                widget.resets++;
                                callbacks.change(null);
                                callbacks.expired();
                            },
                            remove() {
                                widget.removes++;
                                node.remove();
                                callbacks.change(null);
                            },
                        };
                    },
                };
            },
        },
    };
    const emit = () => {
        for (const listener of [...listeners]) listener();
    };
    const host = {
        read: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        publish(scope, value) {
            if (
                !Object.is(scope.owner, snapshot.owner) ||
                scope.configurationRevision !==
                    snapshot.configurationRevision ||
                !snapshot.enabled ||
                !snapshot.editable ||
                snapshot.verified
            )
                return { status: 'refused' };
            writes++;
            events.push(value === null ? 'publish-null' : 'publish-proof');
            snapshot = {
                ...snapshot,
                token: { ...scope, value, revision: {} },
            };
            emit();
            return { status: 'admitted' };
        },
        invalidate(scope, expected) {
            if (
                !Object.is(snapshot.owner, scope.owner) ||
                !Object.is(snapshot.token.owner, scope.owner) ||
                snapshot.token.configurationRevision !==
                    scope.configurationRevision ||
                !Object.is(snapshot.token.revision, expected.revision)
            )
                return { status: 'refused' };
            invalidations++;
            events.push('invalidate');
            snapshot = {
                ...snapshot,
                token: { ...snapshot.token, value: null, revision: {} },
            };
            emit();
            return { status: 'admitted' };
        },
        notify(notice) {
            events.push(notice.kind);
        },
    };
    return {
        host,
        widgets,
        events,
        read: () => snapshot,
        counts: () => ({
            loads,
            writes,
            invalidations,
            listeners: listeners.size,
        }),
        update(patch) {
            snapshot = { ...snapshot, ...patch };
            emit();
        },
        clear() {
            snapshot = {
                ...snapshot,
                token: { ...snapshot.token, value: null, revision: {} },
            };
            emit();
        },
    };
}

/** Fresh installed React18/19 proof with mandatory, verified publication-age admission. */
export async function checkFormCaptchaReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    browser,
}) {
    archivePath = resolve(archivePath);
    const archiveSha256 = sha(readFileSync(archivePath));
    const profiles = [];
    for (const version of ['18.3.1', '19.2.0']) {
        const root = mkdtempSync(join(tmpdir(), 'sdk-form-captcha-'));
        const manifest = {
            private: true,
            type: 'module',
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
            nodeLinker: 'hoisted',
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
                execFileSync('pnpm', args, {
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
                const path = join(root, `form-captcha.${extension}`);
                writeFileSync(path, formCaptchaTypedConsumer);
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
            assert.equal(proof.reactVersion, version);
            if (browser) {
                const { checkFormCaptchaBrowser } = await import(
                    './form-captcha-browser-checks.mjs'
                );
                proof.browser = await checkFormCaptchaBrowser({
                    browser,
                    consumer: root,
                    evidence: {},
                    output: root,
                });
                assert.equal(proof.browser.status, 'passed');
                const resultBytes = readFileSync(
                    join(root, 'form-captcha.json')
                );
                assert.deepEqual(
                    JSON.parse(resultBytes.toString()),
                    proof.browser
                );
                proof.browserResultSha256 = sha(resultBytes);
            }
            const require = createRequire(join(root, 'package.json'));
            const css = readFileSync(
                require.resolve('@miniextensions/sdk/react/form-captcha.css')
            );
            assert.match(css.toString(), /\.mx-sdk-form-captcha-preview/);
            assert.match(css.toString(), /\[hidden\]/);
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
        assert.equal(typeof api.FormCaptcha, 'function');
        assert.equal(typeof api.createFormCaptchaProviderRegistry, 'function');
        assert.equal(typeof api.createRecaptchaV2Provider, 'function');
        const f = formCaptchaFixture(undefined);
        const tree = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.FormCaptcha, {
                    mode: 'controlled',
                    host: { ...f.host },
                    labels: {
                        title: 'Prueba',
                        loading: 'Cargando',
                        unavailable: 'No disponible',
                    },
                })
            );
        const preview = renderToString(
            React.createElement(api.FormCaptcha, {
                mode: 'preview',
                labels: { preview: 'Vista previa' },
            })
        );
        assert.match(preview, /Vista previa/);
        assert.doesNotMatch(preview, /<script|<iframe|<button|<input/);
        const html = renderToString(tree());
        assert.match(html, /Cargando/);
        assert.equal(f.counts().loads, 0);
        for (const patch of [
            { enabled: false },
            { editable: false },
            { verified: true },
        ]) {
            const closed = formCaptchaFixture(undefined);
            closed.update(patch);
            assert.match(
                renderToString(
                    React.createElement(api.FormCaptcha, {
                        mode: 'controlled',
                        host: closed.host,
                    })
                ),
                /hidden=""/
            );
            assert.equal(closed.counts().loads, 0);
        }
        const window = new Window();
        let adapterCallbacks;
        const resets = [];
        let portLoads = 0;
        const concrete = api.createRecaptchaV2Provider({
            registry: api.createFormCaptchaProviderRegistry(),
            scope: {},
            configuration: {},
            load() {
                portLoads++;
                return {
                    render(node, options) {
                        adapterCallbacks = options;
                        node.append(window.document.createElement('span'));
                        return 0;
                    },
                    reset(id) {
                        resets.push(id);
                        adapterCallbacks.callback(null);
                    },
                };
            },
        });
        const concreteRenderer = await concrete.load();
        assert.equal(await concrete.load(), concreteRenderer);
        assert.equal(portLoads, 1);
        const concreteMount = window.document.createElement('div');
        const concreteChanges = [];
        const handle = await concreteRenderer.render(
            concreteMount,
            { sitekey: 'synthetic-config', size: 'compact' },
            {
                change: (value) => concreteChanges.push(value),
                expired() {},
                error() {},
            }
        );
        adapterCallbacks.callback({ synthetic: true });
        handle.reset();
        handle.remove();
        handle.remove();
        adapterCallbacks.callback(null);
        assert.deepEqual(resets, [0, 0]);
        assert.equal(concreteChanges.length, 2);
        assert.equal(concreteMount.childNodes.length, 0);
        // The synthetic provider's document is supplied only for client execution.
        const client = formCaptchaFixture(window.document);
        const clientTree = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.FormCaptcha, {
                    mode: 'controlled',
                    host: { ...client.host },
                    labels: {
                        title: 'Prueba',
                        loading: 'Cargando',
                        unavailable: 'No disponible',
                    },
                })
            );
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
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
        const errors = [];
        const warnings = [];
        const previousError = console.error;
        let hydrated;
        try {
            console.error = (...args) =>
                warnings.push(args.map(String).join(' '));
            const { hydrateRoot } = require('react-dom/client');
            await React.act(async () => {
                hydrated = hydrateRoot(container, clientTree(), {
                    onRecoverableError: (error) => errors.push(String(error)),
                });
            });
            assert.deepEqual(errors, []);
            assert.deepEqual(warnings, []);
            assert.equal(container.querySelectorAll('button').length, 1);
            assert.equal(
                container.querySelector('section').getAttribute('aria-label'),
                'Prueba'
            );
            const widget = client.widgets.at(-1);
            const initialLoads = client.counts().loads;
            await React.act(async () => hydrated.render(clientTree()));
            assert.equal(client.counts().loads, initialLoads);
            await React.act(async () => widget.node.click());
            assert.equal(client.counts().writes, 1);
            const accepted = client.read().token.value;
            await React.act(async () =>
                widget.callbacks.error({ synthetic: true })
            );
            assert.equal(client.read().token.value, accepted);
            assert.equal(client.read().verified, false);
            await React.act(async () => client.clear());
            assert.equal(widget.resets, 1);
            assert.equal(client.counts().writes, 1);
            await React.act(async () => widget.node.click());
            await React.act(async () =>
                client.update({
                    configurationRevision: 1,
                    options: { theme: 'dark' },
                })
            );
            assert.equal(client.counts().invalidations, 1);
            assert.equal(client.read().token.value, null);
            assert.equal(widget.removes, 1);
            const replacement = client.widgets.at(-1);
            await React.act(async () => replacement.callbacks.expired());
            assert.equal(replacement.resets, 1);
            assert.equal(client.events.at(-1), 'expired');
            await React.act(async () => client.update({ editable: false }));
            assert.equal(container.querySelector('button'), null);
            const writes = client.counts().writes;
            widget.callbacks.change({ synthetic: true });
            replacement.callbacks.change(null);
            assert.equal(client.counts().writes, writes);
            await React.act(async () =>
                client.update({ editable: true, owner: {} })
            );
            assert.equal(container.querySelectorAll('button').length, 1);
            await React.act(async () =>
                hydrated.render(
                    React.createElement(api.FormCaptcha, { mode: 'preview' })
                )
            );
            assert.equal(client.counts().listeners, 0);
            assert.equal(container.querySelector('button'), null);
            formats.push({
                format,
                ssr: true,
                previewInert: true,
                closedGates: true,
                hydration: true,
                strictMode: true,
                canonicalPublication: true,
                expiryErrorSeparation: true,
                resetReentry: true,
                configurationInvalidation: true,
                staleCallbacks: true,
            });
        } finally {
            console.error = previousError;
            if (hydrated) await React.act(async () => hydrated.unmount());
            assert.equal(client.counts().listeners, 0);
            assert.equal(container.children.length, 0);
            keys.forEach((key, i) =>
                saved[i]
                    ? Object.defineProperty(globalThis, key, saved[i])
                    : Reflect.deleteProperty(globalThis, key)
            );
            await window.happyDOM.close();
        }
    }
    return { reactVersion: React.version, formats, externalRequests: 0 };
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
