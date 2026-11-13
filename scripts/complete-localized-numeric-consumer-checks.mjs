import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const completeLocalizedNumericTypedConsumer = `
import {createElement,createRef} from 'react';
import {NumberField,type NumberFieldProps,type ControlledNumberFieldProps,CompleteLocalizedNumericField,renderCompleteLocalizedNumericField,type CompleteLocalizedNumericFieldOptions,type CompleteLocalizedNumericRendererProps} from '@miniextensions/sdk/react';
import {CurrencyField,type ControlledCurrencyFieldProps,type CurrencyFieldProps} from '@miniextensions/sdk/react';
const controlledNumeric:CompleteLocalizedNumericRendererProps={
 physicalKind:'number',presentation:{type:'physical',config:{type:'number',options:{precision:2}}},
 fieldId:'native-number',title:'Amount',field:{id:'native-number',name:'Amount',description:null,isComputed:false,isPrimaryField:false,config:{type:'number',options:{precision:2}}},
 displayConfig:{numberSeparator:'period-comma'},value:12.3,context:'form',computed:false,dirty:false,pending:false,validation:[],error:null,
 capability:{type:'editable',setValue(value){const canonical:number|null=value;void canonical;return{accepted:true};}},
};
createElement(CompleteLocalizedNumericField,{field:controlledNumeric});
const numberProps:ControlledNumberFieldProps={mode:'controlled',field:controlledNumeric,options:{presentation:'display'}};
createElement(NumberField,numberProps);
function bindingNumber(props:NumberFieldProps){createElement(NumberField,props);}
// @ts-expect-error controlled semantics always require the explicit discriminator
createElement(NumberField,{field:controlledNumeric});
// @ts-expect-error controlled mode cannot borrow a binding or whole-field renderer
const mixed:ControlledNumberFieldProps={...numberProps,binding:{} as NumberFieldProps['binding']};
// @ts-expect-error Percent remains a separately tracked controlled facade
const percentNumber:ControlledNumberFieldProps={mode:'controlled',field:{...controlledNumeric,physicalKind:'percent'}};
void bindingNumber;void mixed;void percentNumber;

function currency(field:Extract<CompleteLocalizedNumericRendererProps,{physicalKind:'currency'}>,binding:CurrencyFieldProps['binding']){
 const props:ControlledCurrencyFieldProps={...field,options:{presentation:'display'}};
 createElement(CurrencyField,props);
 // @ts-expect-error controlled currency cannot borrow a binding
 const mixedCurrency:ControlledCurrencyFieldProps={...props,binding};
 const namedMixedCurrency={...props,binding};
 // @ts-expect-error structural legacy overloads must not admit mixed named objects
 CurrencyField(namedMixedCurrency);
 // @ts-expect-error createElement must preserve the same exclusive contract
 createElement(CurrencyField,namedMixedCurrency);
 // @ts-expect-error controlled currency requires the currency physical discriminator
 createElement(CurrencyField,{...controlledNumeric});
 // @ts-expect-error canonical currency values are never localized strings
 const localizedCurrency:ControlledCurrencyFieldProps={...props,value:'1.234,57'};
 void mixedCurrency;void localizedCurrency;
}
void currency;

function numeric(props:CompleteLocalizedNumericRendererProps){
 const options:CompleteLocalizedNumericFieldOptions={owner:{token:{},isCurrent:()=>true},commit:'deferred',showLabel:false,inputRef:createRef<HTMLInputElement>(),input:{id:'existing-field',form:'existing-native-form','aria-describedby':'existing-help'},clearLabel:'Clear',emptyLabel:'No value'};
 createElement(CompleteLocalizedNumericField,{field:props,options});
 renderCompleteLocalizedNumericField(props,{...options,presentation:'display'});
 // @ts-expect-error displayed locale strings are never canonical values
 const localeValue:CompleteLocalizedNumericRendererProps={...props,value:'12,3'};
 // @ts-expect-error the complete component owns its controlled display value
 const injectedValue:CompleteLocalizedNumericFieldOptions={input:{value:'12,3'}};
 // @ts-expect-error native numeric UI is packaged, not injected through a render slot
 createElement(CompleteLocalizedNumericField,{field:props,renderInput:()=>null});
 void localeValue;void injectedValue;
}
void numeric;
`;

async function checkInstalled(consumerDirectory, happyDomModulePath) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const cjs = consumer('@miniextensions/sdk/react');
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const css = readFileSync(
        consumer.resolve('@miniextensions/sdk/react/localized-numeric.css'),
        'utf8'
    );
    assert(css.includes('.mx-sdk-localized-numeric-input'));
    assert(css.includes('.mx-sdk-localized-numeric-progress'));
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    let groups = 0;
    for (const [api, kind] of [esm, cjs].flatMap((api) =>
        ['percent', 'number', 'currency'].map((kind) => [api, kind])
    )) {
        const Component =
            kind === 'number'
                ? api.NumberField
                : kind === 'currency'
                  ? api.CurrencyField
                  : api.CompleteLocalizedNumericField;
        const state = {
            value: kind === 'percent' ? 0.425 : 42.5,
            readonly: false,
            scope: {},
        };
        const writes = [];
        let mounted = false,
            root;
        const properties = () => {
            const scope = state.scope;
            const numericOptions = {
                precision: 2,
                ...(kind === 'currency'
                    ? { symbol: '<img src=x> CHF & ' }
                    : {}),
            };
            const field = {
                physicalKind: kind,
                fieldId: 'installed-percent',
                title: 'Progress',
                presentation: {
                    type: 'physical',
                    config: { type: kind, options: numericOptions },
                },
                field: {
                    id: 'installed-percent',
                    name: 'Progress',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: { type: kind, options: numericOptions },
                },
                displayConfig: {
                    numberSeparator: 'period-comma',
                    showThousandsSeparator: kind === 'currency',
                    showAsProgressBar: true,
                    readOnly: state.readonly,
                },
                value: state.value,
                context: 'form',
                computed: false,
                dirty: false,
                pending: false,
                error: null,
                validation: [],
                capability: {
                    type: 'editable',
                    setValue(value) {
                        if (scope !== state.scope)
                            return { accepted: false, reason: 'retired' };
                        if (state.readonly)
                            return { accepted: false, reason: 'readonly' };
                        writes.push(value);
                        state.value = value;
                        if (mounted) publish();
                        return { accepted: true };
                    },
                },
            };
            assert.equal(field.physicalKind, kind);
            const options = {
                owner: {
                    token: state.scope,
                    isCurrent: () => !state.readonly,
                },
                input: { id: 'installed-input', form: 'native-owner' },
            };
            return kind === 'currency'
                ? { ...field, options }
                : {
                      ...(kind === 'number' ? { mode: 'controlled' } : {}),
                      field,
                      options,
                  };
        };
        // Actual installed render, not an import-only SSR claim.
        assert.equal(typeof globalThis.window, 'undefined');
        const html = renderToString(
            React.createElement(Component, properties())
        );
        assert(html.includes('value="42,50"'));
        if (kind === 'percent') assert(html.includes('42.5%'));
        if (kind === 'currency')
            assert(html.includes('&lt;img src=x&gt; CHF &amp; '));
        if (kind === 'currency') {
            const supplied = properties();
            const display = renderToString(
                React.createElement(Component, {
                    ...supplied,
                    value: -1234.56789,
                    capability: { type: 'readonly' },
                    options: { ...supplied.options, presentation: 'display' },
                })
            );
            assert(display.includes('-&lt;img src=x&gt; CHF &amp; 1.234,57'));
        }
        assert.deepEqual(writes, []);

        const window = new Window();
        const originals = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        for (const key of keys)
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
            });
        const container = window.document.createElement('form');
        container.id = 'native-owner';
        let submits = 0;
        container.addEventListener('submit', (event) => {
            event.preventDefault();
            submits++;
        });
        window.document.body.append(container);
        const ref = React.createRef();
        function publish() {
            const supplied = properties();
            root.render(
                React.createElement(
                    React.StrictMode,
                    null,
                    React.createElement(Component, {
                        ...supplied,
                        options: { ...supplied.options, inputRef: ref },
                    })
                )
            );
        }
        try {
            const { createRoot, hydrateRoot } = consumer('react-dom/client');
            container.innerHTML = html;
            const hydrationErrors = [];
            await React.act(async () => {
                root = hydrateRoot(
                    container,
                    React.createElement(Component, properties()),
                    {
                        onRecoverableError: (error) =>
                            hydrationErrors.push(error),
                    }
                );
                mounted = true;
            });
            assert.deepEqual(writes, []);
            assert.deepEqual(hydrationErrors, []);
            await React.act(async () => root.unmount());
            mounted = false;
            container.replaceChildren();
            root = createRoot(container);
            mounted = true;
            await React.act(async () => publish());
            const input = container.querySelector('input');
            assert(input);
            assert.equal(ref.current, input);
            assert.equal(input.value, '42,50');
            assert.equal(input.getAttribute('form'), 'native-owner');
            assert.equal(input.form, container);
            await React.act(async () => input.focus());
            await React.act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(input, '75,25');
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
            assert.deepEqual(writes, [kind === 'percent' ? 0.7525 : 75.25]);
            input.setSelectionRange(2, 2);
            state.value = kind === 'percent' ? 0.1 : 10;
            await React.act(async () => publish());
            assert.equal(input.value, '75,25');
            assert.equal(input.selectionStart, 2);
            await React.act(async () => input.blur());
            assert.equal(input.value, '10,00');
            assert.deepEqual(writes, [kind === 'percent' ? 0.7525 : 75.25]);
            state.readonly = true;
            await React.act(async () => publish());
            assert.equal(input.disabled, true);
            groups++;
        } finally {
            mounted = false;
            if (root) await React.act(async () => root.unmount());
            assert.equal(ref.current, null);
            assert.equal(submits, 0);
            keys.forEach((key, index) => {
                if (originals[index])
                    Object.defineProperty(globalThis, key, originals[index]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return {
        react: React.version,
        groups,
        scope: 'Installed ESM/CommonJS numeric UI, SSR/hydration, canonical callbacks and declarations; no live backend.',
    };
}

export function checkCompleteLocalizedNumericReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(
        join(tmpdir(), 'sdk-complete-localized-numeric-')
    );
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
                const name = `complete-localized-numeric.${extension}`;
                writeFileSync(
                    join(directory, name),
                    completeLocalizedNumericTypedConsumer +
                        (extension === 'tsx'
                            ? `
const jsx = <NumberField mode="controlled" field={controlledNumeric} />; void jsx;
const currencyJSX = (props:ControlledCurrencyFieldProps) => <CurrencyField {...props} />; void currencyJSX;
function mixedCurrencyJSX(props:ControlledCurrencyFieldProps,binding:CurrencyFieldProps['binding']) {
 const mixed={...props,binding};
 // @ts-expect-error JSX spreads cannot combine controlled and binding contracts
 const bad=<CurrencyField {...mixed}/>;
 return bad;
}
void mixedCurrencyJSX;
`
                            : '')
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
            const bytes = execFileSync(
                process.execPath,
                [
                    fileURLToPath(import.meta.url),
                    '--run-consumer',
                    directory,
                    happyDomModulePath,
                ],
                { cwd: directory, encoding: 'utf8' }
            );
            const result = JSON.parse(bytes);
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 6);
            versions.push(result);
            console.log(
                `Installed complete localized numeric React${result.react}: 6 ESM/CommonJS complete-family/canonical-Number/Currency groups, SSR/hydration, strict declarations and styles passed.`
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
