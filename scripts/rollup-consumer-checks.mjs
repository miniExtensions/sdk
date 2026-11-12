import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const rollupReactTypedConsumer = `
import type { ReactNode } from 'react';
import { RollupField, renderRollupField, AirtableForm, AirtableGrid, AirtableList, type RollupFieldProps, type RollupFieldOptions, type ControlledRollupFieldProps } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const nativeProps: ControlledRollupFieldProps = {mode: 'controlled', isValid: true, value: 'CHF 0.000', language: 'fr', textSize: 'large', layout: 'cell-medium'};
export function Native() { return <RollupField {...nativeProps} />; }
export function Invalid() { return <RollupField mode="controlled" isValid={false} language="en" />; }
export function Conditional({valid}: {valid: boolean}) { return <RollupField mode="controlled" language="en" {...(valid ? {isValid:true, value:"0"} : {isValid:false})} />; }
// @ts-expect-error controlled mode cannot borrow a binding
const mixed: ControlledRollupFieldProps = {...nativeProps, binding: {} as RollupFieldProps['binding']};
// @ts-expect-error raw values must use the owner's existing readable conversion
const raw: ControlledRollupFieldProps = {...nativeProps, value: 0};
// @ts-expect-error invalid metadata cannot carry a stale converted result
const stale: ControlledRollupFieldProps = {mode:'controlled', isValid:false, value:'stale', language:'en'};
// @ts-expect-error controlled presentation has no injected renderer
const injected: ControlledRollupFieldProps = {...nativeProps, render: () => null};
// @ts-expect-error no setter or aggregation engine
const setter: ControlledRollupFieldProps = {...nativeProps, setValue: () => {}};
// @ts-expect-error explicit mode is required
export const implicit = <RollupField isValid={true} value="0" language="en" />;
void mixed; void raw; void stale; void injected; void setter;
const options: RollupFieldOptions = { className: 'rollup-consumer' };
// @ts-expect-error Rollup has no editor or write option.
const write: RollupFieldOptions = { setValue: (value: number) => {} };
// @ts-expect-error Rollup has no Clear button.
const clear: RollupFieldOptions = { clearLabel: 'Clear' };
export const renderers: FieldRendererSlots<ReactNode> = { renderRollupField: props => renderRollupField(props, options) };
export function Bound(props: RollupFieldProps) { return <RollupField {...props} {...options} />; }
export function Override(props: RollupFieldProps) { return <RollupField {...props} render={({snapshot}) => <span>{String(snapshot.value ?? '')}</span>} />; }
export function Kinds(rollup: FieldRendererProps<'rollup'>, formula: FieldRendererProps<'formula'>) {
    const readonly: { type: 'readonly' } = rollup.capability;
    // @ts-expect-error Formula remains a separate physical slot.
    renderRollupField(formula);
    // @ts-expect-error Lookup has a separate array and provenance contract.
    renderRollupField({} as FieldRendererProps<'multipleLookupValues'>);
    // @ts-expect-error Rollup has no editable capability.
    const editable: FieldRendererProps<'rollup'>['capability'] = { type: 'editable', setValue: () => ({accepted: true}) };
    return readonly;
}
export function Compositions({form, portal}: {form: FormRenderScope; portal: PortalRenderScope}) { return <>
    <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
    <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
    <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
</>; }
`;

/** Synthetic accepted Form shared by installed and packed-browser checks. */
export function rollupLoadedFixture() {
    const loaded = fixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.hasParentExtension = false;
    loaded.payload.publicFields.state = {
        ...loaded.payload.publicFields.state,
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    };
    const number = { type: 'number', options: { precision: 2 } };
    const text = { type: 'singleLineText', options: null };
    const data = [
        ['amount', number, -1234.567, '-1234.57'],
        ['array', number, [1.234, null, 2.345], '1.23, 2.35'],
        [
            'text',
            text,
            '<img src="https://secret.invalid/image">\n**literal**',
            '<img src="https://secret.invalid/image">\n**literal**',
        ],
        ['empty', number, null, ''],
        ['missing', number, undefined, ''],
        ['error', number, { error: '#ERROR!' }, '#ERROR!'],
        ['special', number, { specialValue: 'Infinity' }, 'Infinity'],
        [
            'choices',
            { type: 'multipleSelects', options: { choices: [] } },
            ['a', 'b'],
            'a, b',
        ],
        [
            'currency',
            { type: 'currency', options: { symbol: '$', precision: 2 } },
            -1234.567,
            '-$1,234.57',
        ],
        ['masked', text, 'PRIVATE_MASKED_ANSWER', '••••••••'],
        ['invalid', null, 123, ''],
        [
            'linked',
            {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'private',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
            ['rec12345678901234', 'Supplied label'],
            'Unavailable, Supplied label',
        ],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, result, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'rollup',
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'rollup',
                    options: result
                        ? {
                              isValid: true,
                              result,
                              recordLinkFieldId: 'unavailable_link',
                              fieldIdInLinkedTable: 'unavailable_source',
                          }
                        : { isValid: false, result: null },
                },
            },
            miniExtConfig:
                id === 'masked'
                    ? { obscurePassword: true }
                    : {
                          renderRollupAsHTML: true,
                          renderRollupAsAttachment: true,
                          displayAsButton: true,
                      },
        };
    }
    return {
        loaded,
        expected: data.map(([id, , , expected]) => [id, expected]),
    };
}

export async function checkRollupConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
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
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot, hydrateRoot } = require('react-dom/client');
    const { renderToString } = require('react-dom/server');
    const css = readFileSync(
        require.resolve('@miniextensions/sdk/react/complete-readonly-text.css'),
        'utf8'
    );
    assert.match(css, /\.mx-sdk-complete-readonly-text/);
    assert.match(css, /\.mx-sdk-rollup-error/);
    let checks = 0;
    try {
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(`@miniextensions/sdk/${name}`)
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
            assert.equal(ui.renderRollupField, undefined);
            assert.equal(typeof react.RollupField, 'function');
            const ssr = window.document.createElement('div');
            const element = h(react.RollupField, {
                mode: 'controlled',
                isValid: true,
                value: 'CHF 0.000',
                language: 'en',
            });
            ssr.innerHTML = renderToString(element);
            window.document.body.append(ssr);
            const errors = [];
            let hydrated;
            try {
                await act(async () => {
                    hydrated = hydrateRoot(ssr, element, {
                        onRecoverableError: (error) => errors.push(error),
                    });
                });
                assert.equal(
                    ssr.querySelector('.read-only-text').textContent,
                    'CHF 0.000'
                );
                assert.deepEqual(errors, []);
            } finally {
                if (hydrated) await act(async () => hydrated.unmount());
                ssr.remove();
            }
            const { loaded, expected } = rollupLoadedFixture();
            let requests = 0;
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No Rollup Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'rollup-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const scope = ui.createFormRenderScope({
                fields,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const renderers = {
                    renderRollupField: (props) =>
                        h(
                            'div',
                            { 'data-field': props.fieldId },
                            react.renderRollupField(props)
                        ),
                };
                await act(async () =>
                    root.render(
                        h(
                            StrictMode,
                            null,
                            h(
                                react.AirtableForm,
                                { scope, renderers },
                                (state) =>
                                    state.fields.map((field) => field.node)
                            )
                        )
                    )
                );
                for (const [id, expectedText] of expected) {
                    assert.equal(
                        container.querySelector(`[data-field="${id}"] output`)
                            .textContent,
                        expectedText
                    );
                    assert.equal(fields.field(id).getSnapshot().canEdit, false);
                    checks++;
                }
                assert.equal(
                    container.querySelector('input,button,a,img,iframe'),
                    null
                );
                assert.equal(
                    container.innerHTML.includes('PRIVATE_MASKED_ANSWER'),
                    false
                );
                assert.equal(
                    container.innerHTML.includes('rec12345678901234'),
                    false
                );
                assert.equal(requests, 0);
                const binding = fields.field('amount');
                const before = binding.getSnapshot();
                binding.setValue = () => {
                    throw Error('Do not borrow a Rollup setter');
                };
                await act(async () =>
                    root.render(h(react.RollupField, { binding }))
                );
                assert.equal(
                    container.querySelector('output').textContent,
                    '-1234.57'
                );
                assert.deepEqual(binding.getSnapshot().value, before.value);
                assert.equal(binding.getSnapshot().dirty, before.dirty);
                await act(async () => fields.destroy());
                assert.equal(container.querySelector('output'), null);
                checks++;
                const native = (value, language = 'en') =>
                    h(react.RollupField, {
                        mode: 'controlled',
                        isValid: true,
                        value,
                        language,
                    });
                for (const value of [
                    'CHF 0.000',
                    'false',
                    '1, 0, false',
                    '<b>literal</b> https://example.test/rollup',
                ]) {
                    await act(async () => root.render(native(value)));
                    assert.equal(
                        container.querySelector('.read-only-text').textContent,
                        value
                    );
                    assert.equal(
                        container.querySelector('output,input,button,img,b'),
                        null
                    );
                    checks++;
                }
                assert.equal(
                    container.querySelector('a').getAttribute('target'),
                    '_blank'
                );
                await act(async () =>
                    root.render(
                        h(react.RollupField, {
                            mode: 'controlled',
                            isValid: false,
                            language: 'en',
                        })
                    )
                );
                assert.match(
                    container.querySelector('[role="alert"]').textContent,
                    /invalid value/
                );
                assert.equal(
                    container.querySelector('.read-only-text,a'),
                    null
                );
                checks++;
                await act(async () => root.render(native(null, 'es')));
                assert.equal(
                    container.querySelector('[data-testid="no-value-test-id"]')
                        .textContent,
                    'Sin Valor'
                );
                checks++;
                await act(async () => root.render(native('Recovered')));
                assert.equal(
                    container.querySelector('.read-only-text').textContent,
                    'Recovered'
                );
                assert.equal(container.querySelector('[role="alert"]'), null);
                assert.equal(requests, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                scope.destroy();
                fields.destroy();
                container.remove();
            }
        }
    } finally {
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
    return { checks };
}

export const rollupControlledTypedConsumer = `
import {createElement as h} from 'react';
import {RollupField,type RollupFieldProps,type ControlledRollupFieldProps} from '@miniextensions/sdk/react';
const props:ControlledRollupFieldProps={mode:'controlled',isValid:true,value:'0',language:'en',layout:'cell-medium',textSize:'large'};
h(RollupField,props);
h(RollupField,{mode:'controlled',isValid:false,language:'en'});
function bound(props:RollupFieldProps){h(RollupField,props);}
// @ts-expect-error native raw values require the existing host conversion
const raw:ControlledRollupFieldProps={...props,value:0};
// @ts-expect-error invalid result has no stale converted value
const invalid:ControlledRollupFieldProps={mode:'controlled',isValid:false,value:'stale',language:'en'};
// @ts-expect-error bindings and controlled values cannot be mixed
const mixed:ControlledRollupFieldProps={...props,binding:{} as RollupFieldProps['binding']};
// @ts-expect-error no injected React renderer
const renderer:ControlledRollupFieldProps={...props,render:()=>null};
// @ts-expect-error no canonical setter
const setter:ControlledRollupFieldProps={...props,setValue:()=>{}};
void raw;void invalid;void mixed;void renderer;void setter;void bound;
`;

export function checkRollupReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-rollup-matrix-'));
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
            for (const extension of ['mts', 'cts', 'tsx']) {
                const name = `rollup.${extension}`;
                writeFileSync(
                    join(directory, name),
                    extension === 'tsx'
                        ? rollupReactTypedConsumer
                        : rollupControlledTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--jsx',
                    'react-jsx',
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
                    { cwd: directory, encoding: 'utf8' }
                )
            );
            assert.equal(result.checks, 40);
            versions.push({ react: version.react, ...result });
            console.log(
                `Installed Rollup React${version.react}: ${result.checks} ESM/CJS binding/controlled scenarios, SSR/hydration, MTS/CTS/JSX and CSS passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (process.argv[2] === '--run-consumer')
    console.log(
        JSON.stringify(
            await checkRollupConsumer({
                consumerDirectory: process.argv[3],
                happyDomModulePath: process.argv[4],
            })
        )
    );
