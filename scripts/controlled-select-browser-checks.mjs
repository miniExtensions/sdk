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

async function readNativeReadonlyForm(page, multiple) {
    const specimens = page.locator('[data-readonly-sample]');
    const painted = await specimens.evaluateAll((nodes) =>
        nodes.map((node) => {
            const root = node.querySelector(
                '.mx-sdk-select[data-readonly-dropdown-layout="native-form"]'
            );
            const name = node.querySelector('label');
            if (!root || !name) throw Error('Missing readonly Form fixture');
            const box = root.getBoundingClientRect();
            const holder = root.querySelector('.mx-sdk-select-dropdown');
            const badge = root.querySelector('.mx-sdk-select-badge');
            const selected = root.querySelector('.mx-sdk-select-selected');
            const blank = root.querySelector(
                '[data-testid="no-value-test-id"]'
            );
            const icon = blank?.querySelector('svg');
            const font = (style) => [
                style.fontSize,
                style.lineHeight,
                style.fontWeight,
            ];
            return {
                height: box.height,
                nameGap: name.getBoundingClientRect().top - box.bottom,
                controls: root.querySelectorAll(
                    'button,input,textarea,select,[tabindex],a[href],[contenteditable="true"]'
                ).length,
                selected:
                    holder && badge
                        ? {
                              border: getComputedStyle(holder).borderTop,
                              holderRadius:
                                  getComputedStyle(holder).borderRadius,
                              holderWidth:
                                  holder.getBoundingClientRect().width ===
                                  box.width,
                              badgeRadius: getComputedStyle(badge).borderRadius,
                              inset:
                                  badge.getBoundingClientRect().left - box.left,
                              height: badge.getBoundingClientRect().height,
                              font: font(getComputedStyle(badge)),
                              color: getComputedStyle(badge).color,
                              background:
                                  getComputedStyle(badge).backgroundColor,
                              title: badge.title,
                              text: badge.textContent,
                              gap: getComputedStyle(selected).columnGap,
                              badges: Array.from(
                                  selected.querySelectorAll(
                                      '.mx-sdk-select-badge'
                                  ),
                                  (pill) => ({
                                      text: pill.textContent,
                                      height: pill.getBoundingClientRect()
                                          .height,
                                  })
                              ),
                          }
                        : null,
                empty:
                    blank && icon
                        ? {
                              font: font(getComputedStyle(blank)),
                              color: getComputedStyle(blank).color,
                              text: blank.textContent,
                              icon: {
                                  width: icon.getBoundingClientRect().width,
                                  height: icon.getBoundingClientRect().height,
                                  color: getComputedStyle(icon).color,
                                  margin: getComputedStyle(icon).marginRight,
                                  hidden: icon.getAttribute('aria-hidden'),
                              },
                          }
                        : null,
            };
        })
    );
    const form = page.locator('[data-readonly-form]');
    await form.evaluate((node) => {
        node.dataset.trustedTabs = '';
        node.addEventListener('keydown', (event) => {
            if (event.key === 'Tab')
                node.dataset.trustedTabs += event.isTrusted ? 'T' : 'F';
        });
    });
    const before = form.getByRole('button', {
        name: 'Before Status',
        exact: true,
    });
    await before.focus();
    const names = form.getByRole('textbox', { name: 'Name', exact: true });
    const tabs = [];
    for (const name of await names.all()) {
        await page.keyboard.press('Tab');
        tabs.push(
            await name.evaluate((node) => node === document.activeElement)
        );
        assert.equal(await name.inputValue(), 'Synthetic Status record');
    }
    assert.deepEqual(tabs, [true, true]);
    for (const previous of [names.first(), before]) {
        await page.keyboard.press('Shift+Tab');
        assert(
            await previous.evaluate((node) => node === document.activeElement)
        );
    }
    assert.equal(await form.getAttribute('data-trusted-tabs'), 'TTTT');

    const guards = page.locator('[data-readonly-guards]');
    assert.equal(
        await guards.locator('[data-readonly-dropdown-layout]').count(),
        0
    );
    assert.equal(
        await guards
            .locator('[data-dropdown-guard="editable"]')
            .getByRole('combobox')
            .count(),
        1
    );
    assert.equal(
        await guards
            .locator('[data-dropdown-guard="list"]')
            .getByRole(multiple ? 'checkbox' : 'radio')
            .isDisabled(),
        true
    );
    assert.equal(await guards.locator('[title="In progress"]').count(), 7);
    return { painted, tabs };
}

async function checkNativeEditableForm(page, snapshot, capture) {
    const holder = page.locator(
        '[data-editable-dropdown-layout="native-form"]'
    );
    const status = holder.getByRole('combobox', {
        name: 'Status',
        exact: true,
    });
    const remove = holder.getByRole('button', { name: 'Remove option Second' });
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    const active = (target) =>
        target.evaluate((node) => node === document.activeElement);
    const listbox = holder.getByRole('listbox');
    const paint = () =>
        holder.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const sibling = document.querySelector('[data-following-name]');
            const input = node.querySelector('input');
            const chip = node.querySelector('.mx-sdk-select-badge');
            const chevron = node.querySelector('.mx-sdk-select-portal-chevron');
            const icon = chevron.getBoundingClientRect();
            const menu = node.querySelector('[role="listbox"]');
            const menuBox = menu?.getBoundingClientRect();
            return {
                height: box.height,
                width: box.width,
                nameGap: sibling.getBoundingClientRect().top - box.bottom,
                radius: getComputedStyle(node).borderRadius,
                inputFont: getComputedStyle(input).fontSize,
                inputLineHeight: getComputedStyle(input).lineHeight,
                chipHeight: chip?.getBoundingClientRect().height ?? null,
                chevron: [icon.width, icon.height, box.right - icon.right],
                menu: menuBox && [menuBox.height, menuBox.top - box.bottom],
            };
        });
    await page.getByRole('button', { name: 'Before Status' }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await active(remove), true);
    await page.keyboard.press('Tab');
    assert.equal(await active(status), true);
    assert.equal(await status.getAttribute('aria-expanded'), 'false');
    assert.equal(await listbox.count(), 0);
    assert.equal(
        await holder.getByRole('button', { name: 'Clear' }).count(),
        0
    );
    assert.equal(await status.getAttribute('placeholder'), '');
    const closed = await paint();
    assert.deepEqual(closed, {
        height: 42,
        width: page.viewportSize().width === 375 ? 335 : 608,
        nameGap: 24,
        radius: '8px',
        inputFont: '14px',
        inputLineHeight: '20px',
        chipHeight: 24,
        chevron: [16, 16, 8],
        menu: undefined,
    });
    assert.equal(
        await holder.evaluate((node) => getComputedStyle(node).borderColor),
        'rgb(59, 130, 246)'
    );
    await capture('closed');

    await page.keyboard.press('ArrowDown');
    const options = listbox.getByRole('option');
    assert.equal(await options.count(), 3);
    assert.equal(
        await listbox.getByText('Available choices', { exact: true }).count(),
        1
    );
    assert.equal(
        await status.getAttribute('aria-activedescendant'),
        await options.nth(1).getAttribute('id')
    );
    const open = await paint();
    assert.deepEqual(open.menu, [160, 4]);
    await options.first().hover();
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(
        await options.evaluateAll((nodes) =>
            nodes.map((node) => getComputedStyle(node).backgroundColor)
        ),
        ['rgba(0, 0, 0, 0)', 'rgb(219, 234, 254)', 'rgba(0, 0, 0, 0)']
    );
    await capture('open');

    await page.keyboard.type('Third');
    const match = listbox.getByRole('option', { name: 'Third', exact: true });
    assert.equal(await status.inputValue(), 'Third');
    assert.equal(await options.count(), 1);
    await page.keyboard.press('ArrowDown');
    const matchId = await match.getAttribute('id');
    assert(matchId);
    assert.equal(await status.getAttribute('aria-activedescendant'), matchId);
    assert.equal(await match.getAttribute('aria-selected'), 'false');

    const missing = 'zzxqv42nomatch';
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(missing);
    assert.equal(await status.inputValue(), missing);
    assert.equal(await options.count(), 0);
    assert.equal(await status.getAttribute('aria-activedescendant'), null);
    const emptyMessage = listbox.getByText('No matching choices', {
        exact: true,
    });
    assert.equal(await emptyMessage.isVisible(), true);
    const emptyMenu = await paint();
    const message = await emptyMessage.evaluate((node) => {
        const row = node.getBoundingClientRect();
        const menu = node.parentElement.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
            width: row.width,
            height: row.height,
            start: row.left - menu.left,
            top: row.top - menu.top,
            padding: [
                style.paddingBlockStart,
                style.paddingBlockEnd,
                style.paddingInlineStart,
                style.paddingInlineEnd,
            ],
        };
    });
    const mobile = page.viewportSize().width === 375;
    assert.deepEqual(emptyMenu.menu, [mobile ? 48 : 44, 4]);
    assert.deepEqual(message, {
        width: closed.width,
        height: mobile ? 40 : 36,
        start: 0,
        top: 4,
        padding: ['8px', '8px', '16px', '16px'],
    });
    await capture('no-match');

    await page.keyboard.press('Escape');
    assert.equal(await listbox.count(), 0);
    assert.equal(await status.getAttribute('aria-expanded'), 'false');
    assert.equal(await status.inputValue(), '');
    assert.equal(await active(status), true);
    assert.equal(
        await status.evaluate((node) => node.matches(':focus-visible')),
        true
    );
    assert.equal(await remove.count(), 1);
    const afterSearch = await snapshot();
    assert.equal(afterSearch.single, 'Beta');
    assert.deepEqual(afterSearch.writes, []);
    assert.equal(afterSearch.submits, 0);
    await page.keyboard.press('Tab');
    assert.equal(await active(name), true);

    await status.click();
    assert.equal(await listbox.count(), 1);
    const chevron = await holder
        .locator('.mx-sdk-select-portal-chevron')
        .boundingBox();
    await page.mouse.click(
        chevron.x + chevron.width / 2,
        chevron.y + chevron.height / 2
    );
    assert.equal(await listbox.count(), 0);
    assert.equal(await active(status), true);
    assert.deepEqual((await snapshot()).writes, []);

    await remove.click();
    await remove.waitFor({ state: 'detached' });
    const blank = await paint();
    assert.deepEqual(blank, { ...closed, height: 38, chipHeight: null });
    assert.equal(await status.getAttribute('placeholder'), 'Choose one');
    assert.equal(await active(status), true);
    assert.equal(await status.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('ArrowDown');
    assert.equal(
        await status.getAttribute('aria-activedescendant'),
        await options.first().getAttribute('id')
    );
    await page.keyboard.press('Tab');
    assert.equal(await active(name), true);
    assert.equal(await listbox.count(), 0);
    const effects = await snapshot();
    assert.deepEqual(effects.writes, [
        { kind: 'value', key: 'single', value: null },
    ]);
    assert.equal(effects.submits, 0);
    await status.click();
    await options.nth(2).click();
    const removeThird = holder.getByRole('button', {
        name: 'Remove option Third',
    });
    await removeThird.waitFor();
    assert.equal(await listbox.count(), 0);
    await removeThird.focus();
    await page.keyboard.press('Space');
    await removeThird.waitFor({ state: 'detached' });
    assert.equal(await active(status), true);
    assert.equal(await status.getAttribute('aria-expanded'), 'false');
    const activated = await snapshot();
    assert.deepEqual(activated.writes, [
        { kind: 'value', key: 'single', value: null },
        { kind: 'value', key: 'single', value: 'Gamma' },
        { kind: 'value', key: 'single', value: null },
    ]);
    assert.equal(activated.submits, 0);
    assert.equal(
        await page
            .locator('[data-editable-guards] [data-editable-dropdown-layout]')
            .count(),
        0
    );
    return { closed, open, empty: { menu: emptyMenu.menu, message }, blank };
}

// Synthetic controlled host, installed public entry points, actual browser input.
// Canonical state and deferred metadata remain host-owned; no provider is called.
export async function checkControlledSelectBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const longLabel = 'SelectedOption' + 'WithoutSpaces'.repeat(11);
    const bounded = async (operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                Error('Controlled Select cleanup timed out')
                            ),
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
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        directory = mkdtempSync(join(root, '.controlled-select-proof-'));
        const css = readFileSync(
            join(installed, 'dist/esm/react/controlled-select.css')
        );
        const assets = new Map([['/select.css', css]]);
        evidence.inputs = {};
        for (const format of ['esm', 'cjs']) {
            const imports =
                format === 'esm'
                    ? "import React from 'react';import {createRoot} from 'react-dom/client';import {SingleSelectField,MultipleSelectsField} from '@miniextensions/sdk/react';"
                    : "const React=require('react');const {createRoot}=require('react-dom/client');const {SingleSelectField,MultipleSelectsField}=require('@miniextensions/sdk/react');";
            const source =
                imports +
                `
const {createElement:h,useState,useRef}=React;
let writes=[],submits=0,activations=0,observed,singleEchoTransitions=[];
const choices=[{id:'a',name:'Alpha',displayName:'First'},{id:'b',name:'Beta',displayName:'Second'},{id:'c',name:'Gamma',displayName:'Third'}];
const nativeEditable=new URLSearchParams(location.search).has('native-editable-dropdown');
function App(){
 const [state,setState]=useState({single:nativeEditable?'Beta':null,multi:['Alpha','Beta'],limited:['Alpha'],choices,readonly:false,active:true,token:{}});
 const latest=useRef(state);latest.current=state;observed=state;
 const canonicalSingle=useRef(state.single);
 const scope=state.token;
 const owner={token:scope,isCurrent:()=>latest.current.active&&latest.current.token===scope};
 const singleOwner={token:scope,isCurrent:()=>owner.isCurrent()&&canonicalSingle.current===state.single};
 const common={choices:state.choices,availableChoices:state.choices,owner,readOnly:state.readonly,formId:'select-form'};
 const change=(key,value)=>{const writerOwner=key==='single'?singleOwner:owner;const currentBefore=writerOwner.isCurrent();if(!currentBefore||latest.current.readonly)return false;writes.push({kind:'value',key,value});if(key==='single'){canonicalSingle.current=value;singleEchoTransitions.push({renderedValue:state.single,canonicalValue:value,currentBefore,currentAfter:singleOwner.isCurrent()});}setState(old=>({...old,[key]:value}));};
 if(nativeEditable){
    const nativeChoices=choices.map(choice=>({...choice,backgroundColor:'#ffeab6',color:'#374151'}));
    const dropdown={...common,owner:singleOwner,choices:nativeChoices,availableChoices:nativeChoices,inputId:'status',ariaLabel:'Status',presentation:'dropdown',value:state.single,editableDropdownLayout:'native-form',labels:{placeholder:'Choose one',availableOptions:'Available choices',remove:name=>'Remove option '+name},onValueChange:value=>change('single',value)};
    return h('form',{id:'select-form',style:{width:'min(calc(100vw - 40px), 608px)',margin:'0 auto',font:'400 16px/24px system-ui, sans-serif'},onSubmit:event=>{event.preventDefault();submits++;}},
      h('button',{type:'button'},'Before Status'),
      h(SingleSelectField,dropdown),
      h('label',{'data-following-name':'',style:{display:'block',marginTop:'24px'}},'Name',h('input',{defaultValue:'Synthetic Status record'})),
      h('div',{'data-editable-guards':'',hidden:true},
        ...[{editableDropdownLayout:undefined},{readOnly:true},{disabled:true},{presentation:'list'},{isInGrid:true},{dropdownStyle:'portal-filter'}].map((options,index)=>h(SingleSelectField,{...dropdown,...options,inputId:'guard-'+index,key:index})),
        h(MultipleSelectsField,{...dropdown,inputId:'guard-multiple',value:['Beta']})
      )
    );
 }
 if (new URLSearchParams(location.search).has('native-readonly-dropdown')) {
    const multiple = new URLSearchParams(location.search).get('native-readonly-dropdown') === 'multiple';
    const status = { id: 'status-in-progress', name: 'In progress', backgroundColor: '#ffeab6', color: '#374151' };
    const alpha = { id: 'status-alpha', name: 'Alpha', color: '#374151', backgroundColor: '#cfdfff' };
    const beta = { id: 'status-beta', name: 'Beta', color: '#374151', backgroundColor: '#ffeab6' };
    const orderedChoices = [beta, alpha];
    const Field = multiple ? MultipleSelectsField : SingleSelectField;
    const values = multiple ? [['Alpha', 'Beta'], []] : [status.name, null];
    const guardValue = multiple ? [status.name] : status.name;
    const dropdown = {
        ...common, choices: [status], availableChoices: [status], presentation: 'dropdown',
        readOnly: true, readOnlyDropdownLayout: 'native-form', labels: { empty: 'No Selection' },
        onValueChange: value => writes.push({ kind: 'readonly-value', value }),
        publishMetadata: choice => writes.push({ kind: 'readonly-metadata', choice }),
    };
    const guards = [
        ['default', Field, { value: guardValue, readOnlyDropdownLayout: undefined }],
        ['disabled', Field, { value: guardValue, readOnly: false, disabled: true }],
        ['editable', Field, { value: guardValue, readOnly: false }],
        ['list', Field, { value: guardValue, presentation: 'list' }],
        ['multiple', MultipleSelectsField, { value: [status.name], readOnlyDropdownLayout: undefined }],
        ['grid', Field, { value: guardValue, isInGrid: true }],
        ['filter', Field, { value: guardValue, dropdownStyle: 'portal-filter' }],
    ];
    return h('form', {
        id: 'select-form', style: { maxWidth: '38rem', margin: '0 auto', font: '400 16px/24px system-ui, sans-serif' },
        onSubmit: event => { event.preventDefault(); submits++; },
    },
        h('div', { 'data-readonly-form': '' },
            h('button', { type: 'button' }, 'Before Status'),
            ...values.map((value, index) => h('section', { 'data-readonly-sample': '', key: index },
                h('div', null, 'Status'),
                h(Field, { ...dropdown, ...(multiple ? { choices: orderedChoices, availableChoices: orderedChoices } : {}), value }),
                h('label', { style: { display: 'block', marginTop: '24px' } },
                    'Name', h('input', { defaultValue: 'Synthetic Status record' })
                )
            ))
        ),
        h('div', { 'data-readonly-guards': '' }, ...guards.map(([scope, Field, options]) =>
            h('section', { key: scope, 'data-dropdown-guard': scope }, h(Field, { ...dropdown, ...options }))
        ))
    );
 }
 if(new URLSearchParams(location.search).has('long-badge')){
    const dropdownChoices=[{...choices[0],displayName:${JSON.stringify(longLabel)}},{...choices[1],displayName:'Short'},choices[2]];
    return h('form',{id:'select-form',style:{maxWidth:'42rem',fontFamily:'system-ui, sans-serif',lineHeight:'24px'},onSubmit:event=>{event.preventDefault();submits++;}},
       h(MultipleSelectsField,{...common,choices:dropdownChoices,availableChoices:[dropdownChoices[2]],ariaLabel:'Many dropdown',presentation:'dropdown',value:state.multi,onValueChange:value=>change('multi',value)}));
 }
 return h('form',{id:'select-form',style:{'--mx-sdk-field-theme-color':'#7c3aed'},onSubmit:event=>{event.preventDefault();submits++;}},
 h('label',{htmlFor:'single'},'Decision'),h('p',{id:'select-help'},'Choice help'),
 h(SingleSelectField,{...common,owner:singleOwner,inputId:'single',ariaLabel:'Decision',describedBy:'select-help',presentation:'dropdown',value:state.single,onValueChange:value=>change('single',value),allowAddingNewOptions:true,publishMetadata:choice=>{if(!owner.isCurrent())return false;writes.push({kind:'metadata',choice});setState(old=>({...old,choices:[...old.choices,choice]}));return true;}}),
 h('section',{'aria-label':'Many control'},h(MultipleSelectsField,{...common,ariaLabel:'Many',presentation:'list',value:state.multi,maxSelections:2,onValueChange:value=>change('multi',value),allowAddingNewOptions:true,publishMetadata:choice=>{if(!owner.isCurrent())return false;writes.push({kind:'metadata',choice});setState(old=>({...old,choices:[...old.choices,choice]}));return true;}})),
 h(MultipleSelectsField,{...common,ariaLabel:'One from many',presentation:'list',value:state.limited,limitToOneSelection:true,onValueChange:value=>change('limited',value)}),
 h('div',{'data-grid-cell':'',onClick:()=>{activations++;}},h(MultipleSelectsField,{...common,presentation:'dropdown',readOnly:true,value:['Missing'],onValueChange:()=>{throw Error('readonly writer');}})),
 h('label',null,'Adjacent sentinel',h('input',{defaultValue:'untouched'})),
 h('button',{type:'button',onClick:()=>setState(old=>({...old,readonly:!old.readonly}))},'Toggle readonly'),
 h('button',{type:'button',onClick:()=>setState(old=>({...old,active:false}))},'Retire owner'),
 h('button',{type:'submit'},'Explicit Save'));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.selectProof={snapshot:()=>({react:React.version,writes:[...writes],submits,activations,single:observed.single,multi:observed.multi,limited:observed.limited,singleEchoTransitions:[...singleEchoTransitions]})};
`;
            const entry = join(
                directory,
                `host.${format === 'esm' ? 'mjs' : 'cjs'}`
            );
            writeFileSync(entry, source);
            const bundle = await build({
                absWorkingDir: root,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
            });
            await assertBrowserInputs(bundle.metafile, root);
            const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
                path.includes('/sdk/dist/')
            );
            assert(
                inputs.some((path) =>
                    path.endsWith('/react/ControlledSelectField.js')
                )
            );
            for (const input of inputs)
                assert(
                    realpathSync(resolve(root, input)).startsWith(
                        installed + '/'
                    )
                );
            evidence.inputs[format] = inputs;
            evidence[format + 'HostSha256'] = createHash('sha256')
                .update(source)
                .digest('hex');
            assets.set('/' + format + '.js', bundle.outputFiles[0].contents);
        }
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://localhost');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            if (url.pathname === '/') {
                const format = url.searchParams.get('format');
                assert(['esm', 'cjs'].includes(format));
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Controlled Select proof</title><link rel="stylesheet" href="/select.css"><main></main><script type="module" src="/' +
                        format +
                        '.js"></script>'
                );
            } else if (assets.has(url.pathname)) {
                response.setHeader(
                    'Content-Type',
                    url.pathname.endsWith('.css')
                        ? 'text/css'
                        : 'text/javascript'
                );
                response.end(assets.get(url.pathname));
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const format of ['esm', 'cjs']) {
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: { width: 390, height: 844 },
            });
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            const dialogs = [];
            page.on('dialog', (dialog) => {
                dialogs.push({
                    type: dialog.type(),
                    message: dialog.message(),
                });
                dialog
                    .dismiss()
                    .catch((error) => evidence.pageErrors.push(error.message));
            });
            await page.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    ['/', '/select.css', '/esm.js', '/cjs.js'].includes(
                        url.pathname
                    )
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            evidence.phase = format;
            await page.goto(origin + '/?format=' + format);
            const snapshot = () =>
                page.evaluate(() => window.selectProof.snapshot());
            const single = page.getByRole('combobox', {
                name: 'Decision',
                exact: true,
            });
            await single.fill('Second');
            await single.press('ArrowDown');
            const beforeSingleSelection = await snapshot();
            await single.press('Enter');
            await page.waitForFunction(() => {
                const input = document.getElementById('single');
                return (
                    window.selectProof.snapshot().single === 'Beta' &&
                    input?.value === '' &&
                    input.getAttribute('aria-expanded') === 'false'
                );
            });
            const afterSingleSelection = await snapshot();
            const synchronousCanonicalEcho = {
                value: afterSingleSelection.single,
                writes: afterSingleSelection.writes.slice(
                    beforeSingleSelection.writes.length
                ),
                authority: afterSingleSelection.singleEchoTransitions.slice(
                    beforeSingleSelection.singleEchoTransitions.length
                ),
                search: await single.inputValue(),
                expanded: await single.getAttribute('aria-expanded'),
                submits: afterSingleSelection.submits,
                sentinel: await page
                    .getByRole('textbox', {
                        name: 'Adjacent sentinel',
                        exact: true,
                    })
                    .inputValue(),
            };
            assert.deepEqual(synchronousCanonicalEcho, {
                value: 'Beta',
                writes: [{ kind: 'value', key: 'single', value: 'Beta' }],
                authority: [
                    {
                        renderedValue: null,
                        canonicalValue: 'Beta',
                        currentBefore: true,
                        currentAfter: false,
                    },
                ],
                search: '',
                expanded: 'false',
                submits: 0,
                sentinel: 'untouched',
            });
            assert.equal(await page.getByRole('listbox').count(), 0);
            assert.equal(
                await single.getAttribute('aria-describedby'),
                'select-help'
            );
            await page
                .getByRole('button', { name: 'Remove Second', exact: true })
                .click();
            assert.equal((await snapshot()).single, null);
            await single.fill(' New choice ');
            await page
                .getByRole('option', {
                    name: /^Add new option/,
                    exact: false,
                })
                .click();
            const creation = (await snapshot()).writes.slice(-2);
            assert.deepEqual(creation, [
                {
                    kind: 'metadata',
                    choice: { id: '', name: 'New choice', newOption: true },
                },
                { kind: 'value', key: 'single', value: 'New choice' },
            ]);
            const many = page.getByRole('group', { name: 'Many', exact: true });
            const manyControl = page.getByRole('region', {
                name: 'Many control',
                exact: true,
            });
            const add = manyControl.getByRole('button', {
                name: 'Add new option',
                exact: true,
            });
            const clear = manyControl.getByRole('button', {
                name: 'Clear',
                exact: true,
            });
            const firstCheckbox = many.getByRole('checkbox', {
                name: 'First',
                exact: true,
            });
            const thirdCheckbox = many.getByRole('checkbox', {
                name: 'Third',
                exact: true,
            });
            const one = page.getByRole('group', {
                name: 'One from many',
                exact: true,
            });
            const firstRadio = one.getByRole('radio', {
                name: 'First',
                exact: true,
            });
            const appearance = (locator) =>
                locator.evaluate((node) => {
                    const rect = node.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    return {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        background: style.backgroundColor,
                        borderWidth: parseFloat(style.borderTopWidth),
                        borderStyle: style.borderTopStyle,
                        accent: style.accentColor,
                        opacity: Number(style.opacity),
                        cursor: style.cursor,
                    };
                });
            const actionLayout = async () => {
                const [addBox, clearBox] = await Promise.all([
                    appearance(add),
                    appearance(clear),
                ]);
                const sameRow =
                    Math.abs(addBox.y - clearBox.y) <
                    Math.min(addBox.height, clearBox.height);
                const gap = sameRow
                    ? clearBox.x - (addBox.x + addBox.width)
                    : clearBox.y - (addBox.y + addBox.height);
                assert(gap >= 4, 'Add/Clear need visible separation');
                for (const box of [addBox, clearBox]) {
                    assert(
                        box.height >= 28,
                        'Action needs a padded button box'
                    );
                    assert(box.borderWidth >= 1);
                    assert.notEqual(box.borderStyle, 'none');
                    assert.notEqual(box.background, 'rgba(0, 0, 0, 0)');
                    assert.notEqual(box.background, 'transparent');
                }
                return { add: addBox, clear: clearBox, sameRow, gap };
            };
            const presentation = { actions: [] };
            for (const width of [390, 1024]) {
                await page.setViewportSize({ width, height: 844 });
                presentation.actions.push({ width, ...(await actionLayout()) });
            }
            await page.setViewportSize({ width: 390, height: 844 });
            await manyControl.evaluate((node) => {
                node.style.width = '8rem';
            });
            const wrappedActions = await actionLayout();
            assert.equal(wrappedActions.sameRow, false);
            presentation.actions.push({ width: '8rem', ...wrappedActions });
            await manyControl.evaluate((node) => {
                node.style.removeProperty('width');
            });
            const [checkboxAppearance, radioAppearance, disabledAppearance] =
                await Promise.all([
                    appearance(firstCheckbox),
                    appearance(firstRadio),
                    appearance(thirdCheckbox),
                ]);
            for (const input of [checkboxAppearance, radioAppearance]) {
                assert(Math.abs(input.width - 16) <= 0.5);
                assert(Math.abs(input.height - 16) <= 0.5);
                assert.equal(input.accent, 'rgb(124, 58, 237)');
            }
            assert(disabledAppearance.opacity < checkboxAppearance.opacity);
            assert.equal(disabledAppearance.cursor, 'not-allowed');
            presentation.inputs = {
                checkbox: checkboxAppearance,
                radio: radioAppearance,
                disabled: disabledAppearance,
            };
            assert.equal(await add.isDisabled(), true);
            const disabledAdd = await appearance(add);
            assert(disabledAdd.opacity < (await appearance(clear)).opacity);
            assert.equal(disabledAdd.cursor, 'not-allowed');
            const beforeDisabledAdd = await snapshot();
            await add.scrollIntoViewIfNeeded();
            const addBounds = await add.boundingBox();
            assert(addBounds);
            await page.mouse.click(
                addBounds.x + addBounds.width / 2,
                addBounds.y + addBounds.height / 2
            );
            assert.deepEqual(await snapshot(), beforeDisabledAdd);
            assert.deepEqual(dialogs, []);
            const keyboardFocus = async (target) => {
                for (let index = 0; index < 32; index++) {
                    await page.keyboard.press('Tab');
                    if (await add.isDisabled())
                        assert.equal(
                            await add.evaluate(
                                (node) => node === document.activeElement
                            ),
                            false,
                            'Disabled Add must be skipped by Tab'
                        );
                    const focused = await target.evaluate((node) => {
                        const style = getComputedStyle(node);
                        return {
                            active: node === document.activeElement,
                            visible: node.matches(':focus-visible'),
                            outlineWidth: parseFloat(style.outlineWidth),
                            outlineStyle: style.outlineStyle,
                            outlineColor: style.outlineColor,
                        };
                    });
                    if (!focused.active) continue;
                    assert.equal(focused.visible, true);
                    assert(focused.outlineWidth >= 2);
                    assert.notEqual(focused.outlineStyle, 'none');
                    assert.equal(focused.outlineColor, 'rgb(124, 58, 237)');
                    return focused;
                }
                throw Error('Select control was not reachable by Tab');
            };
            presentation.focus = {
                checkbox: await keyboardFocus(firstCheckbox),
                clear: await keyboardFocus(clear),
                radio: await keyboardFocus(firstRadio),
            };
            assert.equal(await thirdCheckbox.isDisabled(), true);
            await firstCheckbox.uncheck();
            assert.equal(await add.isDisabled(), false);
            presentation.focus.add = await keyboardFocus(add);
            const beforeCancelledAdd = await snapshot();
            const [prompt] = await Promise.all([
                page.waitForEvent('dialog'),
                add.press('Enter'),
            ]);
            assert.equal(prompt.type(), 'prompt');
            assert.equal(prompt.message(), 'Add new option');
            assert.deepEqual(await snapshot(), beforeCancelledAdd);
            assert.deepEqual(dialogs, [
                { type: 'prompt', message: 'Add new option' },
            ]);
            await thirdCheckbox.check();
            assert.deepEqual((await snapshot()).multi, ['Beta', 'Gamma']);
            assert.equal(await one.getByRole('checkbox').count(), 0);
            await one
                .getByRole('radio', { name: 'Second', exact: true })
                .click();
            assert.deepEqual((await snapshot()).limited, ['Beta']);
            await one
                .getByRole('radio', { name: 'Second', exact: true })
                .click();
            assert.deepEqual((await snapshot()).limited, []);
            const beforeClear = (await snapshot()).writes.length;
            await clear.click();
            const cleared = await snapshot();
            assert.deepEqual(cleared.multi, []);
            assert.deepEqual(cleared.writes.slice(beforeClear), [
                { kind: 'value', key: 'multi', value: [] },
            ]);
            assert.equal(cleared.submits, 0);
            assert.equal(
                await page
                    .getByRole('textbox', {
                        name: 'Adjacent sentinel',
                        exact: true,
                    })
                    .inputValue(),
                'untouched'
            );
            const missing = page.locator(
                '[data-grid-cell] .mx-sdk-select-badge'
            );
            assert.equal(
                await missing.evaluate(
                    (node) => getComputedStyle(node).backgroundColor
                ),
                'rgb(128, 128, 128)'
            );
            await missing.click();
            assert.equal((await snapshot()).activations, 1);
            const before = (await snapshot()).writes.length;
            await page
                .getByRole('button', { name: 'Toggle readonly', exact: true })
                .click();
            assert.equal(await page.getByRole('combobox').count(), 0);
            assert.equal((await snapshot()).writes.length, before);
            assert.equal(
                await page
                    .getByRole('textbox', {
                        name: 'Adjacent sentinel',
                        exact: true,
                    })
                    .inputValue(),
                'untouched'
            );
            await page
                .getByRole('button', { name: 'Explicit Save', exact: true })
                .click();
            assert.equal((await snapshot()).submits, 1);
            await page.screenshot({
                path: join(output, 'controlled-select-' + format + '.png'),
                fullPage: true,
            });
            const otherControls = await snapshot();
            presentation.longSelectedLabel = [];
            for (const width of [375, 1280]) {
                await page.setViewportSize({ width, height: 844 });
                await page.goto(
                    origin + '/?format=' + format + '&long-badge=' + width
                );
                const remove = page.getByRole('button', {
                    name: 'Remove ' + longLabel,
                    exact: true,
                });
                await remove.waitFor();
                await page.keyboard.press('Tab');
                const badge = await remove.evaluate((button) => {
                    const parent = button.closest('.mx-sdk-select-badge');
                    const row = parent.closest('.mx-sdk-select-selected');
                    const short = row.querySelectorAll(
                        '.mx-sdk-select-badge'
                    )[1];
                    const label = parent.querySelector(
                        '.mx-sdk-select-selected-label'
                    );
                    const badgeBounds = parent.getBoundingClientRect();
                    const shortBounds = short.getBoundingClientRect();
                    const rect = button.getBoundingClientRect();
                    const hit = document.elementFromPoint(
                        rect.x + rect.width / 2,
                        rect.y + rect.height / 2
                    );
                    const style = getComputedStyle(label);
                    return {
                        fullLabel: parent.title,
                        labelLineHeight: style.lineHeight,
                        badgeHeight: badgeBounds.height,
                        shortBadgeHeight: shortBounds.height,
                        whiteSpace: style.whiteSpace,
                        textOverflow: style.textOverflow,
                        clipsHorizontally:
                            label.scrollWidth > label.clientWidth &&
                            label.scrollHeight === label.clientHeight,
                        wrapsBadges:
                            getComputedStyle(row).flexWrap === 'wrap' &&
                            shortBounds.top >= badgeBounds.bottom,
                        focusVisible:
                            button === document.activeElement &&
                            button.matches(':focus-visible'),
                        removeHit: button.contains(hit),
                        removeWidth: rect.width,
                        removeHeight: rect.height,
                    };
                });
                assert.deepEqual(badge, {
                    fullLabel: longLabel,
                    labelLineHeight: '20px',
                    badgeHeight: 24,
                    shortBadgeHeight: 24,
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    clipsHorizontally: true,
                    wrapsBadges: true,
                    focusVisible: true,
                    removeHit: true,
                    removeWidth: 16,
                    removeHeight: 16,
                });
                const observed = await snapshot();
                assert.deepEqual(observed.multi, ['Alpha', 'Beta']);
                assert.deepEqual(observed.writes, []);
                assert.equal(observed.submits, 0);
                presentation.longSelectedLabel.push({ width, ...badge });
                await page.screenshot({
                    path: join(
                        output,
                        `controlled-select-long-${format}-${width}.png`
                    ),
                });
            }
            presentation.nativeReadonlyDropdown = [];
            presentation.nativeReadonlyMultipleDropdown = [];
            for (const [multiple, receipts, label] of [
                [false, presentation.nativeReadonlyDropdown, 'In progress'],
                [true, presentation.nativeReadonlyMultipleDropdown, 'Alpha'],
            ]) {
                for (const width of [375, 1280]) {
                    await page.setViewportSize({ width, height: 640 });
                    await page.goto(
                        origin +
                            '/?format=' +
                            format +
                            '&native-readonly-dropdown=' +
                            (multiple ? 'multiple' : 'single')
                    );
                    await page
                        .getByRole('button', {
                            name: 'Before Status',
                            exact: true,
                        })
                        .waitFor();
                    const layout = await readNativeReadonlyForm(page, multiple);
                    assert.deepEqual(layout.painted, [
                        {
                            height: 42,
                            nameGap: 24,
                            controls: 0,
                            selected: {
                                border: '1px solid rgb(209, 213, 219)',
                                holderRadius: '8px',
                                holderWidth: true,
                                badgeRadius: '9999px',
                                inset: 13,
                                height: 24,
                                font: ['14px', '20px', '500'],
                                color: 'rgb(55, 65, 81)',
                                background: multiple
                                    ? 'rgb(207, 223, 255)'
                                    : 'rgb(255, 234, 182)',
                                title: label,
                                text: label,
                                gap: '4px',
                                badges: (multiple
                                    ? ['Alpha', 'Beta']
                                    : [label]
                                ).map((text) => ({ text, height: 24 })),
                            },
                            empty: null,
                        },
                        {
                            height: 20,
                            nameGap: 24,
                            controls: 0,
                            selected: null,
                            empty: {
                                font: ['14px', '20px', '400'],
                                text: 'No Selection',
                                color: 'rgb(107, 114, 128)',
                                icon: {
                                    width: 16,
                                    height: 16,
                                    margin: '4px',
                                    color: 'rgb(156, 163, 175)',
                                    hidden: 'true',
                                },
                            },
                        },
                    ]);
                    const observed = await snapshot();
                    assert.deepEqual(observed.writes, []);
                    assert.equal(observed.submits, 0);
                    receipts.push({ width, ...layout });
                    await page.locator('[data-readonly-form]').screenshot({
                        path: join(
                            output,
                            `controlled-select-readonly-form${multiple ? '-multiple' : ''}-${format}-${width}.png`
                        ),
                    });
                }
            }
            presentation.nativeEditableDropdown = [];
            for (const width of [375, 1280]) {
                await page.setViewportSize({ width, height: 640 });
                await page.goto(
                    origin + '/?format=' + format + '&native-editable-dropdown'
                );
                const result = await checkNativeEditableForm(
                    page,
                    snapshot,
                    (state) =>
                        page.screenshot({
                            path: join(
                                output,
                                `controlled-select-editable-form-${format}-${width}-${state}.png`
                            ),
                        })
                );
                presentation.nativeEditableDropdown.push({ width, ...result });
            }
            evidence.results.push({
                format,
                synchronousCanonicalEcho,
                presentation,
                dialogs,
                ...otherControls,
            });
            await context.close();
            context = null;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.scope =
            'Installed controlled ESM/CJS Select UI; synchronous canonical owner echo, deferred metadata, caps/radios, readonly Grid events, and native Form dropdown appearance, focus and actions. Synthetic host and explicit submit sentinel.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.selectProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'controlled-select-failure.png'),
                    fullPage: true,
                });
            } catch {}
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
                await bounded(cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                failure ??= error;
            }
        }
        writeFileSync(
            join(output, 'controlled-select.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
    if (failure) throw failure;
}
