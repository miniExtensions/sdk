import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const completeCalendlyTypedConsumer = String.raw`
import {createElement,type ComponentProps} from 'react';
import {CompleteCalendlyWidget,type CompleteCalendlyWidgetProps} from '@miniextensions/sdk/react';
const props:CompleteCalendlyWidgetProps={configuredUrl:'https://calendly.com/synthetic/no-booking',email:null,name:null,embedDomain:'https://consumer.invalid',ownerKey:{session:'synthetic-session'},onScheduled(){},enabled:true,booked:false,schedulingTitle:null,labels:{schedule:'Schedule',booked:'Booked',invalidUrl:'Invalid scheduling URL',close:'Close'},className:'consumer-widget',accentColor:'#4f46e5',hoverColor:'#6366f1',focusColor:'#4f46e5',reservedInlineEndWidth:'440px',zIndex:60,frameTitle:'Schedule with Calendly'};
createElement(CompleteCalendlyWidget,props);
const componentProps:ComponentProps<typeof CompleteCalendlyWidget>=props;
// @ts-expect-error native current-owner identity is required
const unowned:CompleteCalendlyWidgetProps={configuredUrl:props.configuredUrl,email:null,name:null,embedDomain:props.embedDomain,onScheduled(){}};
// @ts-expect-error booking admission requires an explicit caller callback
const unwritable:CompleteCalendlyWidgetProps={configuredUrl:props.configuredUrl,email:null,name:null,embedDomain:props.embedDomain,ownerKey:'owner'};
// @ts-expect-error the complete widget owns the actual frame presentation
const extraFrame:CompleteCalendlyWidgetProps={...props,frameClassName:'native-frame'};
// @ts-expect-error no native whole-renderer/frame slot
const extraRenderer:CompleteCalendlyWidgetProps={...props,renderFrame(){return null;}};
// @ts-expect-error booked state is a boolean, not a display string
const textBooked:CompleteCalendlyWidgetProps={...props,booked:'true'};
// @ts-expect-error the complete React widget does not belong to the React-free core
import {CompleteCalendlyWidget as CoreWidget} from '@miniextensions/sdk';
void componentProps;void unowned;void unwritable;void extraFrame;void extraRenderer;void textBooked;void CoreWidget;
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
        consumer.resolve('@miniextensions/sdk/react/complete-calendly.css'),
        'utf8'
    );
    for (const selector of [
        '.mx-sdk-calendly-widget',
        '.mx-sdk-calendly-trigger',
        '.mx-sdk-calendly-dialog',
        '.mx-sdk-calendly-panel',
        '.mx-sdk-calendly-overlay',
        '.mx-sdk-calendly-frame',
        '.mx-sdk-calendly-close',
    ])
        assert(css.includes(selector), `Missing packaged selector ${selector}`);

    const results = [];
    for (const [module, api] of [
        ['esm', esm],
        ['cjs', cjs],
    ]) {
        assert.equal(typeof api.CompleteCalendlyWidget, 'function');
        assert.equal(typeof api.useCalendlyBooking, 'function');
        const writes = [];
        let formSubmits = 0;
        let lifetime = 0;
        const defaults = {
            configuredUrl:
                'https://calendly.com/synthetic/no-booking?hide_gdpr_banner=1',
            email: 'ada+schedule&team@example.invalid',
            name: 'Ada & Grace = Team',
            embedDomain: 'https://consumer.invalid',
            ownerKey: 'record-A/session-A/field-A',
            onScheduled() {
                writes.push('initial');
            },
            className: 'consumer-widget',
        };
        let props = { ...defaults };
        const element = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(
                    'form',
                    {
                        onSubmit(event) {
                            event.preventDefault();
                            formSubmits++;
                        },
                    },
                    React.createElement(api.CompleteCalendlyWidget, {
                        ...props,
                        key: lifetime,
                    })
                )
            );
        assert.equal(typeof document, 'undefined');
        // Keep any real hook SSR warning observable. This harness never patches
        // console.error and does not replace the existing booking hook.
        const html = renderToString(element());
        assert(html.includes('Schedule'));
        assert(html.includes('consumer-widget'));
        assert(!html.includes('<iframe'));
        assert(!html.includes('<dialog'));
        assert.deepEqual(writes, []);
        assert.equal(formSubmits, 0);
        const literalHtml = renderToString(
            React.createElement(api.CompleteCalendlyWidget, {
                ...defaults,
                schedulingTitle: '<b>Literal scheduling title</b>',
            })
        );
        assert(
            literalHtml.includes('&lt;b&gt;Literal scheduling title&lt;/b&gt;')
        );
        assert(!literalHtml.includes('<b>Literal scheduling title</b>'));

        const requests = [];
        const window = new Window({
            url: 'https://consumer.invalid',
            settings: {
                navigation: {
                    disableMainFrameNavigation: true,
                    disableChildFrameNavigation: true,
                    disableChildPageNavigation: true,
                    disableFallbackToSetURL: true,
                },
                fetch: {
                    interceptor: {
                        beforeAsyncRequest() {
                            requests.push('unexpected async request');
                            throw new Error(
                                'Consumer proof must not contact a provider.'
                            );
                        },
                        beforeSyncRequest() {
                            requests.push('unexpected sync request');
                            throw new Error(
                                'Consumer proof must not contact a provider.'
                            );
                        },
                    },
                },
            },
        });
        // HappyDOM's supported child-navigation gate is the external boundary:
        // it creates the actual iframe contentWindow but returns before Fetch.
        // We do not clone, replace, re-key or intercept the SDK session.frame.
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
            'HTMLIFrameElement',
            'HTMLDialogElement',
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
        const host = window.document.createElement('div');
        host.innerHTML = html;
        window.document.body.append(host);
        let root;
        let mounted = false;
        const recoverable = [];
        const checks = [];
        const { act } = React;
        const button = (label) => {
            const node = [...host.querySelectorAll('button')].find(
                (candidate) =>
                    (candidate.getAttribute('aria-label') ??
                        candidate.textContent) === label
            );
            assert(node, `Expected button ${label}`);
            return node;
        };
        const frame = () => {
            const node = host.querySelector('iframe');
            assert(node, 'Expected the actual SDK Calendly frame.');
            assert(
                node.contentWindow,
                'Expected the actual iframe contentWindow.'
            );
            return node;
        };
        const dialog = () => {
            const node = host.querySelector('dialog,[role="dialog"]');
            assert(node, 'Expected the complete booking dialog.');
            return node;
        };
        const dialogName = () => {
            const node = dialog();
            const direct = node.getAttribute('aria-label');
            if (direct != null) return direct;
            const ids = node.getAttribute('aria-labelledby');
            assert(ids, 'Booking dialog needs an accessible name.');
            return ids
                .split(/\s+/)
                .map(
                    (id) =>
                        window.document.getElementById(id)?.textContent ?? ''
                )
                .join(' ');
        };
        const click = async (node) => {
            await act(async () => {
                node.click();
            });
        };
        const publish = async (patch) => {
            props = { ...props, ...patch };
            await act(async () => {
                root.render(element());
            });
        };
        const reset = async (patch = {}) => {
            lifetime++;
            props = { ...defaults, ...patch };
            await act(async () => {
                root.render(element());
            });
        };
        const send = async (
            source,
            origin = 'https://calendly.com',
            data = { event: 'calendly.event_scheduled' }
        ) => {
            await act(async () => {
                window.dispatchEvent(
                    new window.MessageEvent('message', { source, origin, data })
                );
            });
        };
        const open = async (label = 'Schedule') => {
            await click(button(label));
            return frame();
        };
        const cancel = async (label = 'Close') => {
            await click(button(label));
            assert.equal(host.querySelector('iframe'), null);
            assert.equal(host.querySelector('dialog,[role="dialog"]'), null);
        };
        try {
            const { hydrateRoot } = consumer('react-dom/client');
            await act(async () => {
                root = hydrateRoot(host, element(), {
                    onRecoverableError(error) {
                        recoverable.push(error);
                    },
                });
                mounted = true;
            });
            assert.deepEqual(recoverable, []);
            assert.equal(host.querySelector('iframe'), null);
            await send(window);
            assert.deepEqual(writes, []);
            checks.push(
                'SSR/hydration, literal title and closed-frame rejection'
            );

            const first = await open();
            assert.equal(button('Schedule').type, 'button');
            assert.equal(formSubmits, 0);
            const destination = new URL(first.src);
            assert.equal(destination.searchParams.get('hide_gdpr_banner'), '1');
            assert.equal(destination.searchParams.get('email'), defaults.email);
            assert.equal(destination.searchParams.get('name'), defaults.name);
            assert.equal(
                destination.searchParams.get('embed_domain'),
                defaults.embedDomain
            );
            assert.equal(
                destination.searchParams.get('embed_type'),
                'PopupText'
            );
            assert.equal(first.title, 'Schedule with Calendly');
            assert.equal(
                first.getAttribute('sandbox'),
                'allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts'
            );
            assert.equal(
                first.getAttribute('referrerpolicy'),
                'strict-origin-when-cross-origin'
            );
            assert.equal(dialogName(), 'Schedule');
            assert.equal(
                host.querySelectorAll('dialog,[role="dialog"]').length,
                1
            );
            assert.equal(window.document.activeElement, first);
            const firstSource = first.contentWindow;
            await send(firstSource, 'https://attacker.invalid');
            await send(window);
            await send(firstSource, 'https://calendly.com', null);
            assert.deepEqual(writes, []);
            assert.equal(frame(), first);
            await act(async () => {
                for (let i = 0; i < 2; i++)
                    window.dispatchEvent(
                        new window.MessageEvent('message', {
                            source: firstSource,
                            origin: 'https://calendly.com',
                            data: { event: 'calendly.event_scheduled' },
                        })
                    );
            });
            assert.deepEqual(writes, ['initial']);
            assert.equal(host.querySelector('iframe'), null);
            checks.push(
                'resolved prefill, trusted frame, security attributes and consume-once'
            );

            const canceled = await open();
            const canceledSource = canceled.contentWindow;
            await cancel();
            await send(canceledSource);
            assert.equal(writes.length, 1);
            const reopened = await open();
            assert.notEqual(reopened, canceled);
            await send(canceledSource);
            assert.equal(writes.length, 1);
            await send(reopened.contentWindow);
            assert.equal(writes.length, 2);
            checks.push('cancel/reopen generation rejects retained old source');

            const writerFrame = await open();
            await publish({
                onScheduled() {
                    writes.push('latest');
                },
            });
            assert.equal(frame(), writerFrame);
            await send(writerFrame.contentWindow);
            assert.equal(writes.at(-1), 'latest');
            assert.equal(writes.length, 3);
            checks.push('same-owner current writer preserves actual frame');

            for (const replacement of [
                { ownerKey: 'record-B/session-B/field-A' },
                { configuredUrl: 'https://calendly.com/synthetic/changed' },
                { booked: true },
                { enabled: false },
            ]) {
                await reset();
                const old = await open();
                const oldSource = old.contentWindow;
                const before = writes.length;
                await publish(replacement);
                assert.equal(host.querySelector('iframe'), null);
                await send(oldSource);
                assert.equal(writes.length, before);
                await publish({ enabled: true, booked: false });
                const successor = await open();
                assert.notEqual(successor, old);
                if (replacement.configuredUrl)
                    assert.equal(
                        new URL(successor.src).pathname,
                        '/synthetic/changed'
                    );
                await send(oldSource);
                assert.equal(writes.length, before);
                await send(successor.contentWindow);
                assert.equal(writes.length, before + 1);
            }
            checks.push(
                'owner/destination/booked/disabled replacement retires old frame and admits a fresh successor'
            );
            await reset({ enabled: false });
            const beforeDisabled = writes.length;
            await click(button('Schedule'));
            assert.equal(host.querySelector('iframe'), null);
            await send(window);
            assert.equal(writes.length, beforeDisabled);
            checks.push(
                'disabled initial presentation cannot allocate a frame'
            );
            await reset({ booked: true });
            assert(host.textContent.includes('✅ Booked'));
            assert.equal(host.querySelector('iframe'), null);
            checks.push('booked presentation');

            for (const configuredUrl of [
                'http://calendly.com/synthetic',
                'https://attacker.invalid/calendly',
                'not a URL',
            ]) {
                const before = writes.length;
                await reset({ configuredUrl });
                const alert = host.querySelector('[role="alert"]');
                assert(alert);
                assert(
                    alert.textContent.includes(
                        'valid HTTPS calendly.com scheduling URL'
                    )
                );
                assert.equal(host.querySelector('button'), null);
                assert.equal(host.querySelector('iframe'), null);
                assert.equal(writes.length, before);
            }
            checks.push('three untrusted URL controls fail closed');

            await reset({ email: null, name: null });
            const unprefilled = new URL((await open()).src);
            assert.equal(unprefilled.searchParams.has('email'), false);
            assert.equal(unprefilled.searchParams.has('name'), false);
            await cancel();
            checks.push('resolved absent prefill remains absent');
            await reset({ frameTitle: 'Synthetic localized frame' });
            assert.equal((await open()).title, 'Synthetic localized frame');
            await cancel();
            checks.push('inherited frame-title override');

            for (const labels of [
                {
                    schedulingTitle: 'Book an onboarding call',
                    labels: { close: 'Close' },
                },
                {
                    schedulingTitle: '',
                    labels: { schedule: 'Programme', close: 'Fermer' },
                },
            ]) {
                await reset(labels);
                const title = labels.schedulingTitle || labels.labels.schedule;
                const before = writes.length;
                const actual = await open(title);
                assert.equal(dialogName(), title);
                assert.equal(
                    host.querySelectorAll('dialog,[role="dialog"]').length,
                    1
                );
                assert.equal(window.document.activeElement, actual);
                await cancel(labels.labels.close);
                assert.equal(writes.length, before);
                assert.equal(formSubmits, 0);
            }
            checks.push(
                'custom/default-localized dialog names and non-submitting cancellation'
            );

            await reset();
            const unmountedSource = (await open()).contentWindow;
            const beforeUnmount = writes.length;
            await act(async () => {
                root.unmount();
            });
            mounted = false;
            await send(unmountedSource);
            assert.equal(writes.length, beforeUnmount);
            assert.equal(host.querySelector('iframe'), null);
            await window.happyDOM.waitUntilComplete();
            assert.deepEqual(requests, []);
            assert.equal(formSubmits, 0);
            checks.push('unmount retirement and zero provider requests');
            results.push({ module, checks });
        } finally {
            if (mounted)
                await act(async () => {
                    root.unmount();
                });
            for (const [index, key] of keys.entries()) {
                if (originals[index])
                    Object.defineProperty(globalThis, key, originals[index]);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    }
    return {
        react: React.version,
        groups: results.length,
        results,
        providerRequests: 0,
        scope: 'Installed complete Calendly ESM/CJS, declarations, optional CSS and SSR/hydration/DOM with real hook/frame; synthetic messages and blocked child navigation only. No real booking, browser focus restoration, native schema projection, Form admission or persistence acceptance.',
    };
}

export function checkCompleteCalendlyReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-complete-calendly-'));
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
                const name = `complete-calendly.${extension}`;
                writeFileSync(
                    join(directory, name),
                    completeCalendlyTypedConsumer
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
                        // Do not suppress the existing hook's real SSR warnings.
                        stdio: ['ignore', 'pipe', 'inherit'],
                    }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            assert.equal(result.providerRequests, 0);
            versions.push(result);
            console.log(
                `Installed complete Calendly React${result.react}: ESM/CJS, types, CSS, SSR/hydration and synthetic trusted-frame lifecycle checks passed; no provider contact.`
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
