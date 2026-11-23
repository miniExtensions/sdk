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

// Native Form uses the Heroicons 2.1.1 solid Clock in a 20px slot.
const nativeClock =
    'M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z';
const formAccent = 'rgb(16, 185, 129)';
const nativeShadow = 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px';
const nativeFocusRing = `rgb(255, 255, 255) 0px 0px 0px 0px, ${formAccent} 0px 0px 0px 1px, rgba(0, 0, 0, 0) 0px 0px 0px 0px`;

// Installed public UI and trusted keyboard/pointer input. The controlled host
// supplies canonical values and guarded writes; it is not a native Form binding.
export async function checkCompleteDurationBrowser({
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
        directory = mkdtempSync(join(root, '.complete-duration-native-'));
        const source = `
import React,{createElement as h,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DurationField,ReadOnlyDurationField} from '@miniextensions/sdk/react';
import {getFormattedDuration} from '@miniextensions/sdk/formulas';
const mode=new URLSearchParams(location.search).get('mode')||'minutes';
const visual=mode.startsWith('appearance-');
let writes=[],inputs=[],focuses=0,submits=0,observed;
function App(){
 const [state,setState]=useState({value:mode.endsWith('-empty')?null:mode==='minutes'?60:61.25,format:mode==='minutes'?'h:mm':'h:mm:ss.SSS',readonly:mode==='appearance-disabled',active:true,owner:{},mounted:true,writer:'initial'});
 const initialOwner=useRef(state.owner);
 const latest=useRef(state);latest.current=state;observed=state;
 const scope=state.owner;
 const update=patch=>setState(old=>({...old,...patch}));
 return h(React.Fragment,null,
  h('form',{id:'native-form',style:visual?{'--mx-sdk-accent':${JSON.stringify(formAccent)},fontSize:'16px',lineHeight:'24px'}:undefined,onSubmit:event=>{event.preventDefault();submits++;},onFocusCapture:()=>{focuses++;},onInputCapture:event=>inputs.push({trusted:event.nativeEvent.isTrusted,value:event.target.value})},
   h('label',{htmlFor:'native-duration'},'Synthetic duration'),h('p',{id:'external-help'},'External timing help'),
   state.mounted?h(DurationField,{fieldId:'duration',sessionId:'duration-session',format:state.format,value:state.value,readOnly:state.readonly,owner:{token:scope,isCurrent:()=>latest.current.active&&latest.current.owner===scope},onChange(value){if(!latest.current.active||latest.current.readonly||latest.current.owner!==scope)return false;writes.push({value,writer:state.writer});setState(old=>({...old,value}));return true;},inputId:'native-duration',formId:'native-form',title:'Synthetic duration',showLabel:false,description:visual?undefined:'Synthetic timing note',error:visual?undefined:'Synthetic duration error',describedBy:'external-help',clearLabel:mode==='clear'?'Clear synthetic duration':undefined}):null,
   visual?h('div',{'data-duration-following':''},'Following field'):null),
  h('output',{'aria-label':'Canonical seconds'},JSON.stringify(state.value)),
  h('div',{'data-duration-readonly':''},h(ReadOnlyDurationField,{value:state.value,format:state.format,language:'en'})),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>update({value:120})},'Echo canonical value'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>update({writer:'current'})},'Replace writer'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>update({format:'h:mm:ss.SSS'})},'Change format'),
  h('button',{type:'button',onClick:()=>update({readonly:true})},'Make readonly'),
  h('button',{type:'button',onClick:()=>update({readonly:false})},'Restore editing'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>update({owner:{},value:90})},'Replace owner'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>update({owner:initialOwner.current,value:60})},'Restore owner'),
  h('button',{type:'button',onMouseDown:event=>event.preventDefault(),onClick:()=>update({active:false})},'Retire owner'),
  h('button',{type:'button',onClick:()=>update({mounted:false})},'Remove input'));
}
let mount=document.querySelector('main');
if(mode==='shadow'){
 const shadow=mount.attachShadow({mode:'open'});
 const css=document.createElement('link');css.rel='stylesheet';css.href='/duration.css';shadow.append(css);
 mount=document.createElement('div');shadow.append(mount);
}
createRoot(mount).render(h(React.StrictMode,null,h(App)));
window.durationProof={snapshot:()=>({readonlyText:mount.querySelector('[data-duration-readonly]')?.textContent,reactVersion:React.version,writes:[...writes],inputs:[...inputs],submits,focuses,value:observed.value,formatted:observed.value===null?'':getFormattedDuration(String(observed.value),observed.format,true)})};
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
            inputs.some((p) => p.endsWith('/react/CompleteDurationField.js'))
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/complete-duration.css')
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
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/duration.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Complete native Duration proof</title><link rel="stylesheet" href="/duration.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'duration server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
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
                    : width
                      ? { viewport: { width, height: 720 } }
                      : {}),
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
                    ['/', '/proof.js', '/duration.css'].includes(url.pathname)
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            evidence.phase = mode;
            await page.goto(origin + '?mode=' + mode);
            await page
                .getByRole('textbox', {
                    name: 'Synthetic duration',
                    exact: true,
                })
                .waitFor();
            return page.getByRole('textbox', {
                name: 'Synthetic duration',
                exact: true,
            });
        };
        const snapshot = () =>
            page.evaluate(() => window.durationProof.snapshot());
        const finish = async (name) => {
            const state = await snapshot();
            assert.equal(
                state.readonlyText,
                state.value === null ? 'No Value' : state.formatted
            );
            assert.equal(state.submits, 0);
            assert(state.inputs.length > 0);
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
                path: join(output, 'duration-' + name + '.png'),
                fullPage: true,
            });
        };
        const replace = async (input, text) => {
            await input.focus();
            await page.keyboard.press('ControlOrMeta+A');
            await input.pressSequentially(text);
        };
        let input = await open('minutes');
        assert.equal(await input.inputValue(), '0:01');
        assert.equal(await input.getAttribute('id'), 'native-duration');
        assert.equal(await input.getAttribute('form'), 'native-form');
        assert.equal(await input.getAttribute('aria-invalid'), 'true');
        assert.equal(
            await page
                .getByRole('button', {
                    name: 'Clear synthetic duration',
                    exact: true,
                })
                .count(),
            0
        );
        const associated = await input.evaluate((node) =>
            (node.getAttribute('aria-describedby') || '')
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent || '')
        );
        assert(
            associated.some((text) => text.includes('External timing help'))
        );
        assert(
            associated.some((text) => text.includes('Synthetic timing note'))
        );
        assert(
            associated.some((text) => text.includes('Synthetic duration error'))
        );
        const styleLoaded = await page.evaluate(() =>
            [...document.styleSheets].some(
                (sheet) =>
                    sheet.href?.endsWith('/duration.css') &&
                    sheet.cssRules.length > 0
            )
        );
        assert.equal(styleLoaded, true);
        const geometry = await input.evaluate((node) => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            const icon = node.parentElement
                .querySelector('.mx-sdk-complete-duration-clock svg')
                .getBoundingClientRect();
            return {
                boxSizing: style.boxSizing,
                width: box.width,
                height: box.height,
                textStart: box.x + Number.parseFloat(style.paddingLeft),
                iconRight: icon.right,
                iconWidth: icon.width,
            };
        });
        assert.equal(geometry.boxSizing, 'border-box');
        assert(geometry.width > 0 && geometry.height > 0);
        assert(geometry.iconWidth > 0);
        assert(geometry.textStart >= geometry.iconRight);
        evidence.geometry = geometry;
        await replace(input, '7');
        assert.deepEqual((await snapshot()).writes, [
            { value: 420, writer: 'initial' },
        ]);
        assert.equal(await input.inputValue(), '7');
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        await page
            .getByRole('button', { name: 'Echo canonical value', exact: true })
            .click();
        assert.equal(await input.inputValue(), '7');
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        await page
            .getByRole('button', { name: 'Replace writer', exact: true })
            .click();
        await replace(input, '8');
        assert.deepEqual((await snapshot()).writes.at(-1), {
            value: 480,
            writer: 'current',
        });
        const beforeFormat = (await snapshot()).writes.length;
        await page
            .getByRole('button', { name: 'Change format', exact: true })
            .click();
        assert.equal(await input.inputValue(), (await snapshot()).formatted);
        assert.equal((await snapshot()).writes.length, beforeFormat);
        await finish('minutes-current-writer-echo');

        input = await open('seconds');
        await replace(input, '-1.25');
        assert.deepEqual((await snapshot()).writes.at(-1), {
            value: -1.25,
            writer: 'initial',
        });
        await replace(input, '1:');
        assert.deepEqual((await snapshot()).writes.at(-1), {
            value: 0,
            writer: 'initial',
        });
        assert.equal(await input.inputValue(), '1:');
        const beforeBlur = (await snapshot()).writes.length;
        await page
            .getByRole('button', { name: 'Make readonly', exact: true })
            .focus();
        assert.equal(await input.inputValue(), (await snapshot()).formatted);
        assert.equal((await snapshot()).writes.length, beforeBlur);
        await finish('fractional-seconds-native-colon');

        input = await open('seconds');
        await replace(input, '7');
        const beforeReplacement = (await snapshot()).writes.length;
        await page
            .getByRole('button', { name: 'Replace owner', exact: true })
            .click();
        assert.equal(await input.inputValue(), (await snapshot()).formatted);
        assert.equal((await snapshot()).writes.length, beforeReplacement);
        assert.equal(
            await input.evaluate(
                (node) => node.ownerDocument.activeElement === node
            ),
            true
        );
        const retainedFocusCount = (await snapshot()).focuses;
        await replace(input, '8');
        assert.equal(await input.inputValue(), '8');
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        assert.equal((await snapshot()).focuses, retainedFocusCount);
        assert.equal((await snapshot()).writes.length, beforeReplacement + 1);
        assert.deepEqual((await snapshot()).writes.at(-1), {
            value: 8,
            writer: 'initial',
        });
        await page
            .getByRole('button', { name: 'Restore owner', exact: true })
            .click();
        assert.equal(await input.inputValue(), '1:00.000');
        assert.equal(
            await input.evaluate(
                (node) => node.ownerDocument.activeElement === node
            ),
            true
        );
        assert.equal((await snapshot()).writes.length, beforeReplacement + 1);
        await replace(input, '9');
        assert.equal(await input.inputValue(), '9');
        assert.equal((await snapshot()).focuses, retainedFocusCount);
        assert.equal((await snapshot()).writes.length, beforeReplacement + 2);
        // A genuine blur/refocus remains an independent control.
        await page
            .getByRole('button', { name: 'Make readonly', exact: true })
            .focus();
        assert.equal(await input.inputValue(), '0:09.000');
        assert.equal((await snapshot()).writes.length, beforeReplacement + 2);
        await replace(input, '6');
        assert.equal(await input.inputValue(), '6');
        // Only the input is inside the form's focus-capture boundary. The
        // external button blurs it; refocusing the input emits one new focus.
        assert.equal((await snapshot()).focuses, retainedFocusCount + 1);
        assert.equal((await snapshot()).writes.length, beforeReplacement + 3);
        const beforeRefusal = (await snapshot()).writes.length;
        await page
            .getByRole('button', { name: 'Make readonly', exact: true })
            .click();
        assert.equal(await input.isEditable(), false);
        assert.equal((await snapshot()).writes.length, beforeRefusal);
        await page
            .getByRole('button', { name: 'Restore editing', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Retire owner', exact: true })
            .click();
        const retiredCanonical = (await snapshot()).value;
        await replace(input, '9');
        assert.equal((await snapshot()).writes.length, beforeRefusal);
        assert.equal((await snapshot()).value, retiredCanonical);
        assert.equal(await input.inputValue(), (await snapshot()).formatted);
        await page
            .getByRole('button', { name: 'Remove input', exact: true })
            .click();
        assert.equal(await page.locator('input').count(), 0);
        assert.equal((await snapshot()).writes.length, beforeRefusal);
        await finish('owner-readonly-unmount');

        input = await open('shadow');
        assert.deepEqual(
            await input.evaluate((node) => ({
                rootFocused: node.getRootNode().activeElement === node,
                documentFocused: node.ownerDocument.activeElement === node,
            })),
            { rootFocused: false, documentFocused: false }
        );
        await replace(input, '7');
        assert.equal(await input.inputValue(), '7');
        assert.deepEqual((await snapshot()).writes, [
            { value: 7, writer: 'initial' },
        ]);
        assert.deepEqual(
            await input.evaluate((node) => ({
                rootFocused: node.getRootNode().activeElement === node,
                documentFocused: node.ownerDocument.activeElement === node,
            })),
            { rootFocused: true, documentFocused: false }
        );
        const shadowFocusCount = (await snapshot()).focuses;
        await page
            .getByRole('button', { name: 'Replace owner', exact: true })
            .click();
        assert.equal(await input.inputValue(), '1:30.000');
        assert.equal((await snapshot()).writes.length, 1);
        await replace(input, '8');
        assert.equal(await input.inputValue(), '8');
        assert.equal(await input.evaluate((node) => node.selectionStart), 1);
        assert.equal((await snapshot()).focuses, shadowFocusCount);
        assert.deepEqual((await snapshot()).writes, [
            { value: 7, writer: 'initial' },
            { value: 8, writer: 'initial' },
        ]);
        await page
            .getByRole('button', { name: 'Make readonly', exact: true })
            .focus();
        assert.equal(await input.inputValue(), '0:08.000');
        assert.equal((await snapshot()).writes.length, 2);
        await finish('shadow-retained-owner-focus');

        input = await open('clear', true);
        const clear = page.getByRole('button', {
            name: 'Clear synthetic duration',
            exact: true,
        });
        await clear.waitFor();
        assert.equal(await clear.getAttribute('type'), 'button');
        await clear.tap();
        assert.deepEqual((await snapshot()).writes, [
            { value: null, writer: 'initial' },
        ]);
        assert.equal(await input.inputValue(), '');
        assert.equal(await clear.count(), 0);
        await replace(input, '7');
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Backspace');
        assert.deepEqual((await snapshot()).writes.at(-1), {
            value: null,
            writer: 'initial',
        });
        assert.equal(await input.inputValue(), '');
        await page.emulateMedia({ forcedColors: 'active' });
        await finish('optional-clear-mobile-keyboard');
        assert.equal(evidence.results.length, 5);

        evidence.appearance = [];
        const appearanceDifferences = [];
        for (const width of [375, 639, 640, 1280]) {
            for (const state of [
                'populated',
                'empty',
                'disabled',
                'focused-populated',
                'focused-empty',
            ]) {
                input = await open(`appearance-${state}`, false, width);
                const focused = state.startsWith('focused-');
                const empty = state.endsWith('empty');
                const disabled = state === 'disabled';
                if (focused) await page.keyboard.press('Tab');
                const appearance = await input.evaluate(async (node, clock) => {
                    const control = node.parentElement;
                    const glyph = control.querySelector('svg');
                    const path = glyph.querySelector('path');
                    const next = node.form.querySelector(
                        '[data-duration-following]'
                    );
                    getComputedStyle(node).boxShadow;
                    getComputedStyle(glyph).color;
                    await Promise.all(
                        control
                            .getAnimations({ subtree: true })
                            .map((animation) => animation.finished)
                    );
                    const bounds = node.getBoundingClientRect();
                    const wrapper = control.getBoundingClientRect();
                    const icon = glyph.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    const hostStyle = getComputedStyle(control);
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = 20;
                    const paint = canvas.getContext('2d');
                    const alpha = (data, rule) => {
                        paint.clearRect(0, 0, 20, 20);
                        paint.setTransform(20 / 24, 0, 0, 20 / 24, 0, 0);
                        paint.fill(new Path2D(data), rule);
                        paint.resetTransform();
                        return paint.getImageData(0, 0, 20, 20).data;
                    };
                    const actual = alpha(
                        path.getAttribute('d'),
                        path.getAttribute('fill-rule')
                    );
                    const native = alpha(clock, 'evenodd');
                    return {
                        fieldHeight: bounds.height,
                        hostHeight: wrapper.height,
                        nextOffset:
                            next.getBoundingClientRect().top - bounds.top,
                        fillsWidth: bounds.width === wrapper.width,
                        fontSize: style.fontSize,
                        lineHeight: style.lineHeight,
                        padding: style.padding,
                        backgroundColor: style.backgroundColor,
                        textColor: style.color,
                        inputShadow: style.boxShadow,
                        hostShadow: hostStyle.boxShadow,
                        hostMargin: hostStyle.marginTop,
                        borderColor: style.borderTopColor,
                        iconColor: getComputedStyle(glyph).color,
                        outline: [
                            style.outlineColor,
                            style.outlineWidth,
                            style.outlineOffset,
                        ],
                        clockSize: [icon.width, icon.height],
                        clockInset: icon.left - bounds.left,
                        clockCenterDelta:
                            icon.top +
                            icon.height / 2 -
                            bounds.top -
                            bounds.height / 2,
                        maskDifferences: actual.filter(
                            (value, index) =>
                                index % 4 === 3 && value !== native[index]
                        ).length,
                        focusVisible: node.matches(':focus-visible'),
                        disabled: node.disabled,
                        value: node.value,
                    };
                }, nativeClock);
                const height = width < 640 ? 42 : 38;
                const expected = {
                    fieldHeight: height,
                    hostHeight: height,
                    nextOffset: height,
                    fillsWidth: true,
                    fontSize: width < 640 ? '16px' : '14px',
                    lineHeight: width < 640 ? '24px' : '20px',
                    padding: '8px 12px 8px 40px',
                    backgroundColor: disabled
                        ? 'rgb(243, 244, 246)'
                        : 'rgb(255, 255, 255)',
                    textColor: disabled ? 'rgb(75, 85, 99)' : 'rgb(0, 0, 0)',
                    inputShadow: focused ? nativeFocusRing : 'none',
                    hostShadow: nativeShadow,
                    hostMargin: '4px',
                    borderColor: focused ? formAccent : 'rgb(209, 213, 219)',
                    iconColor: focused ? formAccent : 'rgb(156, 163, 175)',
                    ...(focused
                        ? { outline: ['rgba(0, 0, 0, 0)', '2px', '2px'] }
                        : {}),
                    clockSize: [20, 20],
                    clockInset: 12,
                    clockCenterDelta: 0,
                    maskDifferences: 0,
                    focusVisible: focused,
                    disabled,
                    value: empty ? '' : '1:01.250',
                };
                const differences = Object.keys(expected).filter(
                    (key) =>
                        JSON.stringify(appearance[key]) !==
                        JSON.stringify(expected[key])
                );
                if (differences.length)
                    appearanceDifferences.push({ width, state, differences });
                evidence.appearance.push({
                    width,
                    state,
                    appearance,
                    differences,
                });
                assert.deepEqual((await snapshot()).writes, []);
                assert.deepEqual((await snapshot()).inputs, []);
                assert.equal((await snapshot()).submits, 0);
                await page.screenshot({
                    path: join(
                        output,
                        `duration-appearance-${width}-${state}.png`
                    ),
                });
                if (state === 'focused-empty') {
                    await page.keyboard.type('7');
                    assert.deepEqual((await snapshot()).writes, [
                        { value: 7, writer: 'initial' },
                    ]);
                    assert.deepEqual((await snapshot()).inputs, [
                        { trusted: true, value: '7' },
                    ]);
                    await page.keyboard.press('Tab');
                    const typed = await snapshot();
                    assert.equal(typed.submits, 0);
                    assert.equal(typed.writes.length, 1);
                    assert.equal(await input.inputValue(), typed.formatted);
                }
            }
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert.deepEqual(
            appearanceDifferences,
            [],
            'Native Duration appearance'
        );
        evidence.scope =
            'Installed complete Duration with trusted input; no native Form/backend/clipboard/live-device claim.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.durationProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'duration-failure.png'),
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
                await bounded('duration cleanup ' + name, cleanup);
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
