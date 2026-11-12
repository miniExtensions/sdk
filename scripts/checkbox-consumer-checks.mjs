import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Exercise the installed ESM/CJS public APIs, never checkout aliases. */
export async function checkCheckboxConsumer({
    consumerDirectory,
    happyDomModulePath,
    loadESM,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const providerRequests = [];
    const window = new Window({
        url: 'https://checkbox-consumer.invalid/',
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
                        providerRequests.push('async');
                        throw Error(
                            'Checkbox qualification must not contact a provider'
                        );
                    },
                    beforeSyncRequest() {
                        providerRequests.push('sync');
                        throw Error(
                            'Checkbox qualification must not contact a provider'
                        );
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
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    const controlledProfiles = [];
    let saveCalls = 0;
    try {
        const css = require.resolve('@miniextensions/sdk/react/checkbox.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-checkbox:focus-visible/
        );
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(`@miniextensions/sdk/${name}`)
                    : loadESM
                      ? loadESM(name)
                      : import(
                            pathToFileURL(
                                join(
                                    consumerDirectory,
                                    `node_modules/@miniextensions/sdk/dist/esm/${name}/index.js`
                                )
                            )
                        );
            const [ui, forms, react] = await Promise.all(
                ['ui', 'forms', 'react'].map(load)
            );
            assert.equal(typeof react.renderCheckboxField, 'function');
            assert.equal(typeof react.CheckboxField, 'function');
            assert.equal(typeof react.CheckboxInput, 'function');
            assert.equal(ui.renderCheckboxField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['check'];
            loaded.payload.formRecord.data.check = null;
            loaded.payload.fieldIdsToSchemas.check = {
                fieldType: 'checkbox',
                airtableField: {
                    id: 'check',
                    name: 'Approved',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: {
                        type: 'checkbox',
                        options: { icon: 'check', color: 'greenBright' },
                    },
                },
                miniExtConfig: {},
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            saveCalls++;
                            throw Error('No implicit Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'checkbox-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            let revision = 0;
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'check',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('check');
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderCheckboxField: react.renderCheckboxField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().checked, false);
                assert.equal(binding.getSnapshot().value, null);
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, true);
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().checked, true);
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, false);
                checks++;
                const props = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderCheckboxField(props))
                );
                revision++;
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, false);
                assert.equal(input().checked, false);
                await act(async () =>
                    root.render(
                        react.renderCheckboxField({
                            ...props,
                            capability: { type: 'readonly' },
                        })
                    )
                );
                assert.equal(input().disabled, true);
                await act(async () =>
                    root.render(
                        react.renderCheckboxField({
                            ...props,
                            writeConfig: { enableCalendlyIntegration: true },
                        })
                    )
                );
                assert.equal(input().disabled, true);
                checks++;
                await act(async () =>
                    root.render(
                        h(react.CheckboxField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(container.querySelector('.consumer'));
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, true);
                checks++;

                const changes = [];
                let rowClicks = 0;
                const native = (checked) =>
                    h(
                        'div',
                        {
                            onClick: (event) => {
                                if (event.target === input()) rowClicks++;
                            },
                        },
                        h('label', { htmlFor: 'consumer-check' }, 'Consent'),
                        h('form', { id: 'consumer-form' }),
                        h('p', { id: 'consumer-help' }, 'Host help'),
                        h(react.CheckboxInput, {
                            checked,
                            id: 'consumer-check',
                            form: 'consumer-form',
                            'aria-describedby': 'consumer-help',
                            onChange: (event) => {
                                assert.equal(event.currentTarget, input());
                                changes.push(event.currentTarget.checked);
                            },
                        })
                    );
                await act(async () => root.render(native(false)));
                assert.equal(input().type, 'checkbox');
                assert.equal(input().form?.id, 'consumer-form');
                assert.equal(
                    input().getAttribute('aria-describedby'),
                    'consumer-help'
                );
                await act(async () => container.querySelector('label').click());
                assert.deepEqual(changes, [true]);
                assert.equal(rowClicks, 1);
                assert.equal(input().checked, false);
                await act(async () => root.render(native(true)));
                assert.equal(input().checked, true);
                await act(async () => input().click());
                assert.deepEqual(changes, [true, false]);
                assert.equal(rowClicks, 2);
                await act(async () => root.render(native(false)));
                assert.equal(input().checked, false);
                assert.equal(binding.getSnapshot().value, true);
                checks++;
                const controlled = await checkControlledCheckbox({
                    api: react,
                    root,
                    container,
                    window,
                    h,
                    act,
                    binding,
                });
                controlledProfiles.push({ format, checks: controlled });
                assert.equal(saveCalls, 0);
                assert.deepEqual(providerRequests, []);
            } finally {
                await act(async () => root.unmount());
                host.dispose();
                fields.destroy();
                container.remove();
            }
        }
        assert.equal(saveCalls, 0);
        assert.deepEqual(providerRequests, []);
        return {
            react: require('react').version,
            checks,
            controlledProfiles,
            saveCalls,
            providerRequests: providerRequests.length,
        };
    } finally {
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}

export const checkboxTypedConsumer = String.raw`
import {createElement,type ComponentProps} from 'react';
import {CheckboxField,type CheckboxFieldProps,type ControlledCheckboxFieldProps,type BoundCheckboxFieldProps,type CheckboxCalendlyOptions} from '@miniextensions/sdk/react';
const controlled:ControlledCheckboxFieldProps={value:null,onChange(checked){const exact:boolean=checked;void exact;},id:'dom-checkbox',form:'external-form',title:'Approved',checkboxStyle:'toggle',ariaInvalid:true,ariaDescribedBy:'help'};
createElement(CheckboxField,controlled);
const natural:ComponentProps<typeof CheckboxField>=controlled;void natural;
declare const binding:BoundCheckboxFieldProps['binding'];
createElement(CheckboxField,{binding,render({snapshot,binding:current}){void snapshot;void current;return null;}});
const calendly:CheckboxCalendlyOptions={configuredUrl:'https://calendly.com/synthetic/no-booking',email:null,name:null,embedDomain:'https://consumer.invalid',ownerKey:{record:'synthetic'},onScheduled(){},schedulingTitle:'Schedule',labels:{schedule:'Schedule',close:'Close'}};
createElement(CheckboxField,{...controlled,calendly});
// @ts-expect-error controlled fields need an explicit writer
createElement(CheckboxField,{value:false});
// @ts-expect-error controlled values are boolean or null
createElement(CheckboxField,{value:'true',onChange(){}});
// @ts-expect-error one call cannot mix binding and controlled ownership
const mixed:CheckboxFieldProps={...controlled,binding};void mixed;
// @ts-expect-error the natural API owns its complete provider presentation
const injected:ControlledCheckboxFieldProps={...controlled,calendlyPresenter:null};void injected;
// @ts-expect-error current provider owner identity is mandatory
const unowned:CheckboxCalendlyOptions={configuredUrl:calendly.configuredUrl,email:null,name:null,embedDomain:calendly.embedDomain,onScheduled(){}};void unowned;
// @ts-expect-error scheduling completion needs explicit host admission
const unwritable:CheckboxCalendlyOptions={configuredUrl:calendly.configuredUrl,email:null,name:null,embedDomain:calendly.embedDomain,ownerKey:'owner'};void unwritable;
// @ts-expect-error booked state is derived from the checkbox value
const doubleValue:CheckboxCalendlyOptions={...calendly,booked:true};void doubleValue;
`;

async function checkControlledCheckbox({
    api,
    root,
    container,
    window,
    h,
    act,
    binding,
}) {
    const checks = [];
    const changes = [];
    let submits = 0;
    const formId = 'packed-checkbox-external-form';
    const form = () =>
        h('form', {
            id: formId,
            onSubmit(event) {
                event.preventDefault();
                submits++;
            },
        });
    const publish = async (node) => {
        await act(async () => root.render(h('div', null, form(), node)));
    };
    const click = async (node) => {
        assert(node, 'Expected the actual packed control');
        await act(async () => node.click());
    };
    const left = () =>
        container.querySelector('[data-checkbox-instance="left"]');
    const input = () => left()?.querySelector('input');
    let writer = 'first';
    const rows = (value, checkboxStyle = 'checkbox', extra = {}) =>
        h(
            'div',
            null,
            h(
                'section',
                { 'data-checkbox-instance': 'left' },
                h(api.CompleteFormFieldPresentation, {
                    title: 'Approval',
                    fieldName: 'Canonical approval',
                    description: '<p>Approval help</p>',
                    error: 'Approval required',
                    formId,
                    associationKind:
                        extra.isInGrid ||
                        (checkboxStyle === 'button' && !extra.readOnly)
                            ? 'non-labelable'
                            : 'input',
                    children: (presentation) =>
                        h(api.CheckboxField, {
                            value,
                            checkboxStyle,
                            onChange: (next) =>
                                changes.push(`left:${writer}:${next}`),
                            id: 'canonical-writer-id',
                            presentation,
                            checkedStateLabel: ' Approved ',
                            uncheckedStateLabel: ' <b>Approve</b> ',
                            title: 'Duplicate title',
                            feedback: 'Duplicate feedback',
                            ...extra,
                        }),
                })
            ),
            h(
                'section',
                { 'data-checkbox-instance': 'right' },
                h(api.CheckboxField, {
                    value: true,
                    onChange: (next) => changes.push(`right:${writer}:${next}`),
                    title: 'Sibling approval',
                    form: formId,
                })
            )
        );
    await publish(rows(null));
    assert.equal(input().checked, false);
    const label = left().querySelector('label');
    assert(label);
    assert.equal(label.htmlFor, input().id);
    assert.notEqual(input().id, 'canonical-writer-id');
    assert.equal(input().getAttribute('form'), formId);
    assert.equal(input().getAttribute('aria-invalid'), 'true');
    assert.equal(left().querySelectorAll('label').length, 1);
    assert(!left().textContent.includes('Duplicate'));
    const targets = input().getAttribute('aria-describedby').split(/\s+/);
    assert.deepEqual(
        targets.map((id) => window.document.getElementById(id)?.textContent),
        ['Approval required', 'Approval help']
    );
    for (const id of targets) assert(left().querySelector(`[id="${id}"]`));
    await click(left());
    assert.deepEqual(changes, []);
    await click(label);
    assert.deepEqual(changes, ['left:first:true']);
    assert.equal(
        input().checked,
        false,
        'Controlled state waits for the caller echo'
    );
    const sibling = container.querySelector(
        '[data-checkbox-instance="right"] input'
    );
    assert.notEqual(sibling.id, input().id);
    await click(
        container.querySelector('[data-checkbox-instance="right"] label')
    );
    assert.deepEqual(changes, ['left:first:true', 'right:first:false']);
    assert.equal(input().checked, false);
    writer = 'current';
    await publish(rows(true, 'toggle'));
    assert.equal(input().checked, true);
    assert(left().querySelector('[data-style="toggle"]'));
    await click(input());
    assert.deepEqual(changes, [
        'left:first:true',
        'right:first:false',
        'left:current:false',
    ]);
    assert.equal(input().checked, true);
    checks.push(
        'controlled checkbox/toggle, real shell label/help/error/form association and sibling/current-writer isolation'
    );

    await publish(rows(false, 'button'));
    const button = left().querySelector('button');
    assert(button);
    assert.equal(button.type, 'button');
    assert.equal(button.textContent, '<b>Approve</b>');
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    assert.equal(left().querySelector('label'), null);
    const beforeTitle = changes.length;
    await click(left().querySelector('.mx-sdk-field-title'));
    assert.equal(changes.length, beforeTitle);
    await click(button);
    assert.equal(changes.at(-1), 'left:current:true');
    assert.equal(submits, 0);
    await publish(rows(true, 'button', { readOnly: true }));
    assert.equal(input().checked, true);
    assert.equal(input().disabled, true);
    assert.equal(input().readOnly, true);
    assert.equal(left().querySelector('button'), null);
    const beforeReadonly = changes.length;
    await click(left().querySelector('label'));
    await click(input());
    assert.equal(changes.length, beforeReadonly);
    await publish(rows(true, 'toggle', { readOnly: true, isInGrid: true }));
    assert.equal(left().querySelector('input,button,label'), null);
    assert.equal(
        left()
            .querySelector('[data-checkbox-grid-value]')
            .getAttribute('data-checkbox-grid-value'),
        'true'
    );
    checks.push(
        'literal non-submit button, non-activating field title and readonly/grid fallback'
    );

    // Keep the same public component mounted while changing ownership contracts.
    await act(async () => root.render(h(api.CheckboxField, { binding })));
    assert.equal(container.querySelector('input').checked, true);
    const oldBoundInput = container.querySelector('input');
    const replacementWrites = [];
    await act(async () =>
        root.render(
            h(api.CheckboxField, {
                value: false,
                onChange: (value) => replacementWrites.push(value),
                title: 'Controlled replacement',
            })
        )
    );
    const oldControlledInput = container.querySelector('input');
    await click(oldControlledInput);
    assert.deepEqual(replacementWrites, [true]);
    assert.equal(binding.getSnapshot().value, true);
    await click(oldBoundInput);
    assert.equal(binding.getSnapshot().value, true);
    await act(async () => root.render(h(api.CheckboxField, { binding })));
    await click(oldControlledInput);
    assert.deepEqual(replacementWrites, [true]);
    await click(container.querySelector('input'));
    assert.equal(binding.getSnapshot().value, false);
    assert.deepEqual(replacementWrites, [true]);
    checks.push(
        'binding/controlled/binding replacement preserves distinct writers and retires detached controls'
    );

    const scheduled = [];
    const ownerA = {},
        ownerB = {};
    let providerProps = {
        value: false,
        title: 'Schedule field',
        checkboxStyle: 'toggle',
        onChange() {
            assert.fail('Scheduling must use explicit completion admission');
        },
        calendly: {
            configuredUrl:
                'https://calendly.com/synthetic/no-booking?hide_gdpr_banner=1',
            email: 'ada+team&calendar@example.invalid',
            name: 'Ada & Grace = Team',
            embedDomain: 'https://checkbox-consumer.invalid',
            ownerKey: ownerA,
            schedulingTitle: 'Meet locally',
            onScheduled() {
                scheduled.push('first');
            },
        },
    };
    const provider = async (next = {}) => {
        providerProps = { ...providerProps, ...next };
        await publish(h(api.CheckboxField, providerProps));
    };
    const trigger = () =>
        [...container.querySelectorAll('button')].find(
            (node) => node.textContent === 'Meet locally'
        );
    const open = async () => {
        await click(trigger());
        const frame = container.querySelector('iframe');
        assert(
            frame?.contentWindow,
            'The real qualified SDK widget owns the iframe'
        );
        assert.equal(container.querySelectorAll('dialog').length, 1);
        return frame;
    };
    const send = async (source, origin = 'https://calendly.com') => {
        await act(async () =>
            window.dispatchEvent(
                new window.MessageEvent('message', {
                    source,
                    origin,
                    data: { event: 'calendly.event_scheduled' },
                })
            )
        );
    };
    await provider();
    assert.equal(container.querySelector('input,iframe,dialog'), null);
    assert(trigger());
    assert.equal(trigger().type, 'button');
    await click(container.querySelector('.mx-sdk-complete-checkbox__title'));
    assert.equal(container.querySelector('iframe'), null);
    const firstFrame = await open();
    const firstSource = firstFrame.contentWindow;
    const url = new URL(firstFrame.src);
    assert.equal(
        url.searchParams.get('email'),
        'ada+team&calendar@example.invalid'
    );
    assert.equal(url.searchParams.get('name'), 'Ada & Grace = Team');
    assert.equal(url.searchParams.get('hide_gdpr_banner'), '1');
    await send(window);
    await send(firstSource, 'https://calendly.com:444');
    assert.deepEqual(scheduled, []);
    await send(firstSource);
    await send(firstSource);
    assert.deepEqual(scheduled, ['first']);
    assert.equal(container.querySelector('iframe'), null);
    const retired = await open();
    const retiredSource = retired.contentWindow;
    await provider({
        calendly: { ...providerProps.calendly, ownerKey: ownerB },
    });
    assert.equal(container.querySelector('iframe'), null);
    await provider({
        calendly: { ...providerProps.calendly, ownerKey: ownerA },
    });
    await send(retiredSource);
    assert.deepEqual(scheduled, ['first']);
    const current = await open();
    await provider({
        calendly: {
            ...providerProps.calendly,
            onScheduled() {
                scheduled.push('current');
            },
        },
    });
    assert.equal(container.querySelector('iframe'), current);
    await send(current.contentWindow);
    assert.deepEqual(scheduled, ['first', 'current']);
    await provider({ value: true });
    assert.equal(container.querySelector('input,iframe,button'), null);
    assert(container.textContent.includes('✅ Booked'));
    await provider({ readOnly: true });
    assert.equal(container.querySelector('input').disabled, true);
    assert.equal(container.querySelector('button,iframe'), null);
    await provider({
        value: false,
        readOnly: false,
        calendly: {
            ...providerProps.calendly,
            configuredUrl: 'https://provider.invalid/blocked',
        },
    });
    assert(container.querySelector('[role="alert"]'));
    assert.equal(container.querySelector('input,iframe,button'), null);
    await provider({
        calendly: { ...providerProps.calendly, configuredUrl: url.toString() },
    });
    const unmountedSource = (await open()).contentWindow;
    await publish(null);
    await send(unmountedSource);
    assert.deepEqual(scheduled, ['first', 'current']);
    assert.equal(submits, 0);
    assert.equal(binding.getSnapshot().value, false);
    checks.push(
        'configured complete Calendly exact prefill, trusted-frame completion, owner A-B-A/current writer, readonly/booked/invalid/unmount with no implicit submission'
    );
    return checks;
}

export async function checkCheckboxSSRConsumer({ consumerDirectory, loadESM }) {
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof window, 'undefined');
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    for (const api of [
        consumer('@miniextensions/sdk/react'),
        await loadESM('react'),
    ]) {
        const props = {
            value: false,
            onChange() {
                assert.fail('SSR write');
            },
            title: '<b>Approval</b>',
        };
        const html = renderToString(
            React.createElement(
                'main',
                null,
                React.createElement(api.CheckboxField, props),
                React.createElement(api.CheckboxField, {
                    ...props,
                    checkboxStyle: 'toggle',
                }),
                React.createElement(api.CheckboxField, {
                    ...props,
                    checkboxStyle: 'button',
                    uncheckedStateLabel: ' <b>Approve</b> ',
                }),
                React.createElement(api.CheckboxField, {
                    ...props,
                    calendly: {
                        configuredUrl:
                            'https://calendly.com/synthetic/no-booking',
                        email: null,
                        name: null,
                        embedDomain: 'https://checkbox-consumer.invalid',
                        ownerKey: 'synthetic',
                        onScheduled() {
                            assert.fail('SSR scheduling write');
                        },
                    },
                })
            )
        );
        assert(html.includes('&lt;b&gt;Approval&lt;/b&gt;'));
        assert(html.includes('&lt;b&gt;Approve&lt;/b&gt;'));
        assert(html.includes('type="checkbox"'));
        assert(html.includes('type="button"'));
        assert(html.includes('Schedule'));
        assert(!html.includes('<iframe'));
        assert(!html.includes('<dialog'));
    }
    return { react: React.version, formats: 2, writes: 0 };
}

export function checkCheckboxReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-checkbox-consumer-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: ['ignore', 'pipe', 'inherit'],
        });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        const runtime = join(directory, 'checkbox-runtime.mjs');
        writeFileSync(
            runtime,
            `import {checkCheckboxConsumer,checkCheckboxSSRConsumer} from ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};
const loaders={react:()=>import('@miniextensions/sdk/react'),ui:()=>import('@miniextensions/sdk/ui'),forms:()=>import('@miniextensions/sdk/forms')};
const options={consumerDirectory:process.cwd(),happyDomModulePath:process.argv[2],loadESM:name=>loaders[name]()};
process.stdout.write(JSON.stringify(await (process.argv[3]==='ssr'?checkCheckboxSSRConsumer(options):checkCheckboxConsumer(options))));
`
        );
        for (const [react, types, domTypes] of [
            ['18.3.1', '18.3.12', '18.3.1'],
            ['19.2.0', '19.2.2', '19.2.2'],
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                archivePath,
                `react@${react}`,
                `react-dom@${react}`,
                `@types/react@${types}`,
                `@types/react-dom@${domTypes}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = `checkbox.${extension}`;
                writeFileSync(join(directory, name), checkboxTypedConsumer);
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
            const results = [];
            for (const mode of ['ssr', 'dom']) {
                const result = JSON.parse(
                    run(process.execPath, [
                        runtime,
                        happyDomModulePath,
                        mode,
                    ]).toString()
                );
                assert.equal(result.react, react);
                if (mode === 'dom') {
                    assert.equal(result.checks, 8);
                    assert.equal(result.controlledProfiles.length, 2);
                    assert.equal(result.saveCalls, 0);
                    assert.equal(result.providerRequests, 0);
                } else assert.equal(result.formats, 2);
                results.push(result);
            }
            const { buildSync } = createRequire(import.meta.url)(
                esbuildModulePath
            );
            for (const format of ['esm', 'cjs']) {
                const contents =
                    format === 'esm'
                        ? "import {CheckboxField} from '@miniextensions/sdk/react';import '@miniextensions/sdk/react/checkbox.css';console.log(CheckboxField);"
                        : "const {CheckboxField}=require('@miniextensions/sdk/react');require('@miniextensions/sdk/react/checkbox.css');console.log(CheckboxField);";
                const bundle = buildSync({
                    stdin: { contents, resolveDir: directory },
                    bundle: true,
                    platform: 'browser',
                    format: 'iife',
                    outdir: join(directory, 'browser-output'),
                    write: false,
                    logLevel: 'silent',
                });
                const css =
                    bundle.outputFiles.find((file) =>
                        file.path.endsWith('.css')
                    )?.text ?? '';
                for (const selector of [
                    '.mx-sdk-checkbox',
                    '.mx-sdk-complete-checkbox',
                    '.mx-sdk-calendly-dialog',
                ])
                    assert(css.includes(selector));
            }
            versions.push({ react, results });
            console.log(
                `Installed natural Checkbox React${react}: ESM/CJS/types/CSS, controlled/binding replacement and configured Calendly synthetic lifecycle passed; zero Save/provider requests.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
