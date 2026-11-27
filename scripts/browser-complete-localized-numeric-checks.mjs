import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

// Native Form #7920's first parent, 6463fb7f. Keep the Tailwind Forms
// defaults and the historic NumberField utilities separate so the installed
// comparison sees the same host reset and theme as the archived control.
const nativeNumericAppearanceCss = `
    :root {
        --theme-500: 20 184 166;
        --theme-600: 13 148 136;
        font: 16px/24px Inter, system-ui, sans-serif;
    }
    form { margin: 16px; }
    [data-numeric-following] { display: block; }
    [type='text'] {
        appearance: none;
        padding: 8px 12px;
        border: 1px solid #6b7280;
        background: white;
        font-family: inherit;
        font-size: 16px;
        line-height: 24px;
    }
    [type='text']:focus {
        outline: 2px solid transparent;
        outline-offset: 2px;
        border-color: #2563eb;
        box-shadow: 0 0 0 0 white, 0 0 0 1px #2563eb, var(--native-shadow, 0 0 #0000);
    }
    .native-numeric-control { display: flex; gap: 8px; width: 100%; }
    .native-numeric-control > .mx-sdk-complete-clearable-input { flex: 1; min-width: 0; }
    .native-numeric-symbol { display: flex; align-items: center; color: #6b7280; }
    .native-numeric-percent { order: 1; }
    .native-numeric-input {
        --native-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        box-sizing: border-box;
        display: block;
        width: 100%;
        padding: 8px;
        border-color: #d1d5db;
        border-radius: 6px;
        color: black;
        box-shadow: var(--native-shadow);
    }
    .native-numeric-input:focus {
        border-color: rgb(var(--theme-500));
        box-shadow: 0 0 0 0 white, 0 0 0 1px rgb(var(--theme-500)), var(--native-shadow);
    }
    @media (min-width: 640px) {
        .native-numeric-input, .native-numeric-symbol { font-size: 14px; line-height: 20px; }
    }
`;

const numericAppearanceThemeCss = [
    '.mx-sdk-localized-numeric { --mx-sdk-accent: rgb(var(--theme-600)); }',
    '.mx-sdk-localized-numeric-form { --mx-sdk-numeric-focus: rgb(var(--theme-500)); }',
].join('\n');

// Installed public UI and trusted keyboard/pointer input. The controlled host
// supplies canonical values and guarded writes; it is not a native Form binding.
export async function checkCompleteLocalizedNumericBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'building',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const bounded = async (label, operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.localized-numeric-native-'));
        const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NumberField,CurrencyField,PercentField,CompleteLocalizedNumericField,CompleteClearableTextInput,CompleteReadOnlyTextField} from '@miniextensions/sdk/react';
const mode=new URLSearchParams(location.search).get('mode')||'number';
const appearance=/^appearance-(number|currency|percent)-(native|sdk)$/.exec(mode);
let writes=[],inputs=[],submits=0;
const defaults={number:1234.5,percent:0.425,currency:-1234.5,deferred:0.25,mobile:12.5};
function NativeAppearance({kind}) {
 const values={number:'1.234,50',currency:'-1.234,50',percent:'42,50'};
 const [value,setValue]=useState(values[kind]);
 const symbolClass=kind==='percent'
   ? 'native-numeric-symbol native-numeric-percent'
   : 'native-numeric-symbol';
 return h('div',{className:'native-numeric-control'},
  kind==='number'?null:h('span',{
   className:symbolClass,
   id:kind==='currency'?'native-symbol':undefined,
  },kind==='currency'?'€':'%'),
  h(CompleteClearableTextInput,{
   id:'native-number',
   type:'text',
   inputMode:'decimal',
   form:'native-form',
   autoComplete:'off',
   className:'native-numeric-input',
   value,
   clearLabel:'Clear synthetic amount',
   initialMobile:false,
   enableInlineEdit:false,
   'aria-describedby':kind==='currency'?'native-symbol':undefined,
   onChange:setValue,
   onClear:()=>setValue(''),
   onFocus:()=>setValue(value.replace(/\\./g,'')),
   onBlur:()=>setValue(values[kind]),
  }));
}
function App(){
 const readonlyPercent=mode==='readonly-percent';
 const kind=appearance?.[1]??(mode==='deferred'||readonlyPercent?'percent':mode==='mobile'?'number':mode);
 const [state,setState]=useState({value:defaults[appearance?.[1]??(readonlyPercent?'percent':mode)],readonly:false,owner:{},mounted:true,display:false});
 const scope=state.owner;
 const metadata={type:kind,options:{precision:2,...(kind==='currency'?{symbol:appearance?'€':'<img src=x> literal '}: {})}};
 const field={physicalKind:kind,presentation:{type:'physical',config:metadata},fieldId:'numeric',title:'Synthetic amount',field:{id:'numeric',name:'Synthetic amount',description:null,isComputed:false,isPrimaryField:false,config:metadata},displayConfig:{numberSeparator:'period-comma',showThousandsSeparator:true,allowNegativeNumbers:true,showAsProgressBar:kind==='percent'&&!appearance,readOnly:state.readonly},value:state.value,context:mode==='deferred'?'portal-cell':'form',computed:false,dirty:false,pending:false,error:null,validation:[],capability:{type:'editable',setValue(value){if(scope!==state.owner||state.readonly)return{accepted:false,reason:'retired'};writes.push(value);setState(old=>({...old,value}));return{accepted:true};}}};
 const Component=kind==='currency'?CurrencyField:kind==='number'?NumberField:readonlyPercent?PercentField:CompleteLocalizedNumericField;
 const props=kind==='currency'?field:{...(kind==='number'||readonlyPercent?{mode:'controlled'}:{}),field};
 const options={
  owner:{token:scope,isCurrent:()=>!state.readonly},
  showLabel:!appearance,
  commit:mode==='deferred'?'deferred':'immediate',
  presentation:state.display?'display':'editor',
  input:{
   id:'native-number',
   form:'native-form',
   onInput:event=>inputs.push({trusted:event.nativeEvent.isTrusted,value:event.currentTarget.value}),
  },
  clearLabel:'Clear synthetic amount',
 };
 const editor=appearance?.[2]==='native'
  ?h(NativeAppearance,{kind})
  :state.mounted?h(appearance?CompleteLocalizedNumericField:Component,{...(appearance?{field}:props),options}):null;
 return h(React.Fragment,null,
  h('form',{id:'native-form',onSubmit:event=>{event.preventDefault();submits++;}},
   appearance?h('label',{htmlFor:'native-number'},'Synthetic amount'):null,
   editor,
   appearance?h('button',{type:'button','data-numeric-following':''},'Following field'):null),
  h('output',{'aria-label':'Canonical value'},JSON.stringify(state.value)),
  readonlyPercent?h('button',{type:'button',onClick:()=>setState(old=>({...old,value:0.079,display:true,readonly:true}))},'Show below threshold'):null,
  readonlyPercent?h('button',{type:'button',onClick:()=>setState(old=>({...old,value:0.08,display:true,readonly:true}))},'Show at threshold'):null,
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>setState(old=>({...old,value:0.1}))},'Echo canonical value'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,value:12.345,display:true}))},'Show large readonly value'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,readonly:true}))},'Make readonly'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>setState(old=>({...old,owner:{},value:0.5}))},'Replace owner'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,mounted:false}))},'Remove input'),
  h('button',{type:'button',onClick:()=>setState(old=>({...old,value:null,display:true}))},'Show empty value'));
}
function ReadOnlyNumberAppearance() {
 const config = {type:'number',options:{precision:2}};
 const rows = [['negative',-12345,'-12,345.00'],['zero',0,'0.00'],['empty',null,'']];
 function sdkNumber(id,value,context,computed=false) {
  return h(NumberField,{
   mode:'controlled',
   field:{
    physicalKind:'number',
    presentation:{type:computed?'computed-result':'physical',config},
    fieldId:id,
    title:'Amount',
    field:{id,name:'Amount',description:null,isComputed:computed,isPrimaryField:false,config},
    displayConfig:{numberSeparator:'comma-period',showThousandsSeparator:true,readOnly:true},
    value,context,computed,dirty:false,pending:false,error:null,validation:[],capability:{type:'readonly'},
   },
   options:{presentation:'display',showLabel:false,className:'read-only-text linkify',emptyLabel:'No Value'},
  });
 }
 function sample(renderer,field) {
  return h('div',{'data-renderer':renderer},field,h('div',{'data-next':''},'Following field'));
 }
 return h('form',{onSubmit:event=>{event.preventDefault();submits++;}},
  h('button',{type:'button'},'Before numbers'),
  ...rows.map(([id,value,text])=>h('section',{'data-sample':id,key:id},
   sample('native',h(CompleteReadOnlyTextField,{value:text,language:'en'})),
   sample('sdk',sdkNumber(id,value,'form')))),
  h('div',{'data-boundary':'computed'},sdkNumber('computed',null,'form',true)),
  h('div',{'data-boundary':'portal'},sdkNumber('portal',null,'portal-detail')),
  h('button',{type:'button'},'After numbers'));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,
 h(mode==='readonly-number-appearance'?ReadOnlyNumberAppearance:App)));
window.numericProof={snapshot:()=>({reactVersion:React.version,writes:[...writes],inputs:[...inputs],submits})};
`;
        writeFileSync(join(directory, 'host.mjs'), source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [join(directory, 'host.mjs')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((p) =>
            p.includes('/sdk/dist/')
        );
        assert(
            inputs.some((p) =>
                p.endsWith('/react/CompleteLocalizedNumericField.js')
            )
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/localized-numeric.css')
        );
        const readonlyTextCss = readFileSync(
            join(installed, 'dist/esm/react/complete-readonly-text.css')
        );
        evidence.sdkInputs = inputs;
        evidence.harnessSha256 = hash(readFileSync(new URL(import.meta.url)));
        evidence.hostSha256 = hash(source);
        evidence.bundleSha256 = hash(bundle.outputFiles[0].contents);
        evidence.cssSha256 = hash(css);
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            const requestUrl = new URL(request.url, 'http://localhost');
            const path = requestUrl.pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/numeric.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/readonly-text.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(readonlyTextCss);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                const mode = requestUrl.searchParams.get('mode');
                const appearance = mode?.startsWith('appearance-');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Complete localized numeric proof</title>' +
                        (appearance
                            ? '<style>' +
                              nativeNumericAppearanceCss +
                              '</style>'
                            : '') +
                        '<link rel="stylesheet" href="/numeric.css">' +
                        (appearance
                            ? '<style>' + numericAppearanceThemeCss + '</style>'
                            : '') +
                        (mode === 'readonly-number-appearance'
                            ? '<style>body{font:16px/1.5 system-ui}p{margin:0}[data-renderer]{margin-bottom:24px}</style><link rel="stylesheet" href="/readonly-text.css">'
                            : '') +
                        '<main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'numeric server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        const fieldLocator = () =>
            page.getByRole('textbox', {
                name: 'Synthetic amount',
                exact: true,
            });
        const visit = async (mode) => {
            evidence.phase = mode;
            await page.goto(origin + '?mode=' + mode);
            const field =
                mode === 'readonly-number-appearance'
                    ? page.getByRole('button', { name: 'Before numbers' })
                    : fieldLocator();
            await field.waitFor();
            return field;
        };
        const open = async (mode, mobile = false, width) => {
            if (context) await context.close();
            context = await browser.newContext({
                serviceWorkers: 'block',
                ...(mobile
                    ? {
                          viewport: { width: 390, height: 844 },
                          isMobile: true,
                          hasTouch: true,
                          userAgent:
                              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
                      }
                    : width == null
                      ? {}
                      : { viewport: { width, height: 720 } }),
            });
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            await page.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    [
                        '/',
                        '/proof.js',
                        '/numeric.css',
                        '/readonly-text.css',
                    ].includes(url.pathname)
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            return visit(mode);
        };
        const snapshot = () =>
            page.evaluate(() => window.numericProof.snapshot());
        const finish = async (name) => {
            const state = await snapshot();
            assert.equal(state.submits, 0);
            assert(state.inputs.every((item) => item.trusted));
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            evidence.reactVersion = state.reactVersion;
            evidence.results.push({
                name,
                state,
                ax: await page.locator('body').ariaSnapshot(),
            });
            await page.screenshot({
                path: join(output, 'numeric-' + name + '.png'),
                fullPage: true,
            });
        };
        const exerciseKeyboardClear = async () => {
            const amount = await open('mobile', true);
            const clear = page.getByRole('button', {
                name: 'Clear synthetic amount',
                exact: true,
            });
            await clear.waitFor();
            const original = await amount.elementHandle();
            assert.equal(await page.evaluate(() => window.innerWidth), 390);
            assert.equal(await amount.inputValue(), '12,50');
            await amount.focus();
            await page.keyboard.press('Tab');
            assert(
                await clear.evaluate((node) => node === document.activeElement)
            );
            await page.keyboard.press('Space');
            await clear.waitFor({ state: 'detached' });
            const focusAfterClear = await amount.evaluate(
                (node, first) =>
                    node === first && document.activeElement === node,
                original
            );
            const clearedValue = await amount.inputValue();
            await page.keyboard.type('7');
            const afterTyping = await amount.inputValue();
            const state = await snapshot();
            await original.dispose();
            const result = {
                focusAfterClear,
                clearedValue,
                afterTyping,
                writes: state.writes,
                submits: state.submits,
            };
            await finish('mobile-clear-keyboard');
            return result;
        };
        let input = await open('number');
        assert.equal(await input.inputValue(), '1.234,50');
        await input.focus();
        assert.equal(await input.inputValue(), '1234,50');
        await page.keyboard.press('Home');
        for (let i = 0; i < 4; i++)
            await page.keyboard.press('Shift+ArrowRight');
        await input.pressSequentially('9');
        assert.equal(await input.inputValue(), '9,50');
        assert.deepEqual((await snapshot()).writes, [9.5]);
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        await page
            .getByRole('button', { name: 'Echo canonical value' })
            .click();
        assert.equal(await input.inputValue(), '9,50');
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        await page.getByRole('button', { name: 'Make readonly' }).focus();
        assert.equal(await input.inputValue(), '0,10');
        assert.deepEqual((await snapshot()).writes, [9.5]);
        await finish('number-selection-locale');

        input = await open('percent');
        assert.equal(await input.inputValue(), '42,50');
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-fill')
                .evaluate((node) => node.style.width),
            '42.5%'
        );
        await input.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('75,25');
        assert.equal((await snapshot()).writes.at(-1), 0.7525);
        const percentRoot = await page
            .locator('.mx-sdk-localized-numeric')
            .elementHandle();
        await page
            .getByRole('button', { name: 'Show large readonly value' })
            .click();
        assert(
            await page
                .locator('.mx-sdk-localized-numeric-display')
                .evaluate((display, root) => display === root, percentRoot)
        );
        await percentRoot.dispose();
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-progress-label')
                .textContent(),
            '1.234,50%'
        );
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-fill')
                .evaluate((node) => node.style.width),
            '100%'
        );
        await finish('percent-canonical-progress');

        input = await open('deferred');
        assert.equal(
            await input.evaluate((node) =>
                Boolean(node.closest('.mx-sdk-localized-numeric-form'))
            ),
            false
        );
        await input.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('75,25');
        assert.deepEqual((await snapshot()).writes, []);
        await page.keyboard.press('Enter');
        assert.deepEqual((await snapshot()).writes, [0.7525]);
        await page.getByRole('button', { name: 'Remove input' }).click();
        assert.deepEqual((await snapshot()).writes, [0.7525]);
        await finish('deferred-enter-once');

        input = await open('deferred');
        await input.focus();
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('55');
        // The host's button preserves focus while replacing its actual owner,
        // so this does not accidentally commit the old draft through blur.
        await page.getByRole('button', { name: 'Replace owner' }).click();
        assert.deepEqual((await snapshot()).writes, []);
        assert.equal(await input.inputValue(), '50,00');
        await page.keyboard.press('ControlOrMeta+A');
        await input.pressSequentially('60');
        await page.keyboard.press('Enter');
        assert.deepEqual((await snapshot()).writes, [0.6]);
        await finish('deferred-host-replacement');

        input = await open('currency');
        assert.equal(
            await page
                .locator('.mx-sdk-localized-numeric-symbol')
                .textContent(),
            '<img src=x> literal '
        );
        assert.equal(await page.locator('img').count(), 0);
        await page.getByRole('button', { name: 'Make readonly' }).click();
        assert.equal(await input.isDisabled(), true);
        await page.getByRole('button', { name: 'Show empty value' }).click();
        assert.equal(
            await page.locator('.mx-sdk-localized-numeric-empty').textContent(),
            'No value'
        );
        assert.equal(
            await page.locator('.mx-sdk-localized-numeric-empty svg').count(),
            1
        );
        await finish('currency-literal-empty-readonly');

        input = await open('mobile', true);
        assert.equal(await page.evaluate(() => window.innerWidth), 390);
        const clear = page.getByRole('button', {
            name: 'Clear synthetic amount',
            exact: true,
        });
        await clear.waitFor();
        assert.equal(await clear.getAttribute('type'), 'button');
        await clear.tap();
        assert.deepEqual((await snapshot()).writes, [null]);
        assert.equal(await input.inputValue(), '');
        await page.emulateMedia({ forcedColors: 'active' });
        await finish('mobile-clear-forced-colors');
        evidence.keyboardClear = await exerciseKeyboardClear();
        assert.deepEqual(evidence.keyboardClear, {
            focusAfterClear: true,
            clearedValue: '',
            afterTyping: '7',
            writes: [null, 7],
            submits: 0,
        });
        assert.equal(evidence.results.length, 7);

        evidence.readonlyNumber = [];
        for (const width of [375, 1280]) {
            const before = await open(
                'readonly-number-appearance',
                false,
                width
            );
            const after = page.getByRole('button', { name: 'After numbers' });
            const rows = await page
                .locator('[data-sample]')
                .evaluateAll((samples) =>
                    samples.map((sample) =>
                        [...sample.querySelectorAll('[data-renderer]')].map(
                            (renderer) => {
                                const value = renderer.querySelector('p');
                                const bounds = value.getBoundingClientRect();
                                return {
                                    text: value.textContent,
                                    lineHeight:
                                        getComputedStyle(value).lineHeight,
                                    height: bounds.height,
                                    followingOffset:
                                        renderer
                                            .querySelector('[data-next]')
                                            .getBoundingClientRect().top -
                                        bounds.top,
                                };
                            }
                        )
                    )
                );
            const otherNumberLineHeights = await page
                .locator('[data-boundary] p')
                .evaluateAll((rows) =>
                    rows.map((row) => getComputedStyle(row).lineHeight)
                );
            evidence.readonlyNumber.push({
                width,
                rows,
                otherNumberLineHeights,
            });
            const expected = [
                ['-12,345.00', 24],
                ['0.00', 24],
                ['No Value', 20],
            ].map(([text, height]) => ({
                text,
                lineHeight: `${height}px`,
                height,
                followingOffset: height,
            }));
            assert.deepEqual(
                rows,
                expected.map((row) => [row, row])
            );
            assert.deepEqual(otherNumberLineHeights, ['21px', '21px']);
            await before.focus();
            await page.keyboard.press('Tab');
            assert.equal(
                await after.evaluate(
                    (button) => button === document.activeElement
                ),
                true
            );
            await page.keyboard.press('Shift+Tab');
            assert.equal(
                await before.evaluate(
                    (button) => button === document.activeElement
                ),
                true
            );
            const state = await snapshot();
            assert.deepEqual(state.writes, []);
            assert.equal(state.submits, 0);
            await page.screenshot({
                path: join(output, `numeric-readonly-number-${width}.png`),
                fullPage: true,
            });
        }

        evidence.readonlyPercent = [];
        for (const width of [375, 1280]) {
            await open('readonly-percent', false, width);
            const display = page.locator('.mx-sdk-localized-numeric-display');
            const states = [];
            for (const [action, text, fill, position] of [
                ['Show below threshold', '7,90%', '7.9%', 'absolute'],
                ['Show at threshold', '8,00%', '8%', 'static'],
                ['Show empty value', 'No value', null, 'static'],
            ]) {
                await page.getByRole('button', { name: action }).click();
                const sample = await display.evaluate((node) => {
                    const label = node.querySelector(
                        '.mx-sdk-localized-numeric-progress-label, .mx-sdk-localized-numeric-empty'
                    );
                    const track = node.querySelector(
                        '.mx-sdk-localized-numeric-track'
                    );
                    const fill = node.querySelector(
                        '.mx-sdk-localized-numeric-fill'
                    );
                    const css = getComputedStyle(label);
                    return {
                        text: label.textContent,
                        lineHeight: css.lineHeight,
                        position: css.position,
                        fill: fill?.style.width ?? null,
                        height: track?.getBoundingClientRect().height ?? null,
                    };
                });
                assert.deepEqual(sample, {
                    text,
                    lineHeight: '20px',
                    position,
                    fill,
                    height: fill === null ? null : 28,
                });
                states.push(sample);
            }
            const state = await snapshot();
            assert.deepEqual(state.writes, []);
            assert.equal(state.submits, 0);
            evidence.readonlyPercent.push({ width, states });
        }

        evidence.appearance = [];
        const appearanceDifferences = [];
        for (const width of [375, 639, 640, 1280]) {
            await open('appearance-number-native', false, width);
            for (const kind of ['number', 'currency', 'percent']) {
                const samples = {};
                for (const renderer of ['native', 'sdk']) {
                    input = await visit(`appearance-${kind}-${renderer}`);
                    const states = {};
                    for (const state of ['rest', 'tab']) {
                        if (state === 'tab') await page.keyboard.press('Tab');
                        const measured = await input.evaluate(async (node) => {
                            const style = getComputedStyle(node);
                            const clipPadding = 4;
                            // Read the pending style change before waiting for
                            // the actual input border/shadow transition.
                            style.boxShadow;
                            await Promise.all(
                                node
                                    .getAnimations()
                                    .map((item) => item.finished)
                            );
                            const bounds = node.getBoundingClientRect();
                            const following = node.form.querySelector(
                                '[data-numeric-following]'
                            );
                            return {
                                metrics: {
                                    height: bounds.height,
                                    followingOffset:
                                        following.getBoundingClientRect().top -
                                        bounds.top,
                                    font: [
                                        style.fontFamily,
                                        style.fontSize,
                                        style.lineHeight,
                                    ],
                                    border: style.borderTopColor,
                                    outline: [
                                        style.outlineColor,
                                        style.outlineWidth,
                                        style.outlineOffset,
                                    ],
                                    shadow: style.boxShadow,
                                    focusVisible:
                                        node.matches(':focus-visible'),
                                    value: node.value,
                                },
                                clip: {
                                    x: bounds.x - clipPadding,
                                    y: bounds.y - clipPadding,
                                    width: bounds.width + 2 * clipPadding,
                                    height: bounds.height + 2 * clipPadding,
                                },
                            };
                        });
                        assert.equal(
                            measured.metrics.focusVisible,
                            state === 'tab'
                        );
                        states[state] = measured.metrics;
                        await page.screenshot({
                            path: join(
                                output,
                                `numeric-${width}-${kind}-${renderer}-${state}.png`
                            ),
                            clip: measured.clip,
                            caret: 'hide',
                        });
                    }
                    await page.keyboard.press('Tab');
                    assert.equal(await input.inputValue(), states.rest.value);
                    const interaction = await snapshot();
                    assert.deepEqual(interaction.writes, []);
                    assert.deepEqual(interaction.inputs, []);
                    assert.equal(interaction.submits, 0);
                    samples[renderer] = states;
                }
                const expectedHeight = width < 640 ? 42 : 38;
                assert.equal(samples.native.rest.height, expectedHeight);
                assert.equal(
                    samples.native.rest.followingOffset,
                    expectedHeight
                );
                assert.equal(samples.native.tab.border, 'rgb(20, 184, 166)');
                for (const state of ['rest', 'tab']) {
                    const properties = Object.keys(samples.native[state]);
                    const differences = properties.filter(
                        (key) =>
                            JSON.stringify(samples.native[state][key]) !==
                            JSON.stringify(samples.sdk[state][key])
                    );
                    if (differences.length)
                        appearanceDifferences.push({
                            width,
                            kind,
                            state,
                            differences,
                        });
                }
                evidence.appearance.push({ width, kind, samples });
            }
        }
        assert.equal(evidence.appearance.length, 12);
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert.deepEqual(
            appearanceDifferences,
            [],
            'Installed Form numeric inputs must match historic native geometry and Tab focus'
        );
        input = await open('number');
        await page.keyboard.press('Tab');
        const inputFocusColor = (property, color) =>
            input.evaluate(
                async (node, { property, color }) => {
                    node.style.setProperty(property, color);
                    const style = getComputedStyle(node);
                    style.borderTopColor;
                    await Promise.all(
                        node.getAnimations().map((item) => item.finished)
                    );
                    return style.borderTopColor;
                },
                { property, color }
            );
        assert.equal(
            await inputFocusColor('--mx-sdk-accent', 'rgb(126, 34, 206)'),
            'rgb(126, 34, 206)'
        );
        assert.equal(
            await inputFocusColor(
                '--mx-sdk-numeric-focus',
                'rgb(20, 184, 166)'
            ),
            'rgb(20, 184, 166)'
        );
        evidence.scope =
            'Installed numeric UI, trusted input and archived Form appearance in a paired fixture. No backend or live-device interaction.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.numericProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'numeric-failure.png'),
                    fullPage: true,
                });
            } catch (capture) {
                evidence.failureCaptureError = capture.message;
            }
        }
    } finally {
        for (const [name, cleanup] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    new Promise((resolve, reject) => {
                        if (!server) return resolve();
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    }),
            ],
            [
                'fixture',
                () => {
                    if (directory)
                        rmSync(directory, { recursive: true, force: true });
                },
            ],
        ]) {
            try {
                await bounded('numeric cleanup ' + name, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                failure ??= error;
            }
        }
    }
    if (failure) throw failure;
}
