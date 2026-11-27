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

export const completeDateBrowserSource = `
import React,{createElement as h,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DateField,CompleteDateField} from '@miniextensions/sdk/react/date';
const date={type:'date',options:{dateFormat:{format:'YYYY-MM-DD'}}};
const datetime={type:'dateTime',options:{dateFormat:{format:'YYYY-MM-DD'},timeFormat:{format:'HH:mm'},timeZone:'America/New_York'}};
const mode=new URLSearchParams(location.search).get('mode')||'date';
let writes=[],saves=[],observed,change;
function App(){
 const [state,setState]=useState({config:mode==='datetime'?datetime:date,value:mode==='datetime'?'2024-07-01T10:30:12.345-04:00':'2025-02-01',adjacent:'',saveCount:0,owner:{},current:true,readonly:mode==='readonly',mounted:true,writer:'first',session:'session',id:'date',align:'end',dialog:mode==='dialog'});
 const latest=useRef(state);useLayoutEffect(()=>{latest.current=state;});observed=state;change=patch=>setState(old=>({...old,...patch}));
 const dialog=useRef(null);useLayoutEffect(()=>{if(state.dialog&&!dialog.current.open)dialog.current.showModal();},[state.dialog]);
 const owner=state.owner;
 const field=state.mounted?h(state.config.type==='date'?DateField:CompleteDateField,{id:state.id,sessionId:state.session,airtableDateConfig:state.config,value:state.value,setValue(value){if(!latest.current.current||latest.current.readonly||latest.current.owner!==owner)return false;writes.push({value,writer:state.writer});setState(old=>({...old,value}));return true;},owner:{token:owner,isCurrent:()=>latest.current.current&&latest.current.owner===owner},readOnly:state.readonly,dateRange:state.readonly?'today or in the future':undefined,language:mode==='vietnamese'?'vi':'en',title:'Appointment',description:'Choose a synthetic date',formId:'date-form',calendarAlign:state.align}):null;
 const controls=h(React.Fragment,null,
  h('div',{className:'fixture-toolbar'},
   h('button',{type:'button'},'Outside calendar'),
   h('button',{type:'button',onPointerDown:e=>e.stopPropagation(),onMouseDown:e=>e.preventDefault(),onClick:()=>change({config:{...state.config,options:{...state.config.options,dateFormat:{format:'D/M/YYYY'}}}})},'European format'),
   h('button',{type:'button',onPointerDown:e=>e.stopPropagation(),onMouseDown:e=>e.preventDefault(),onClick:()=>change({owner:{},session:'replacement',value:'2024-03-15'})},'Replace owner'),
   h('button',{type:'button',onPointerDown:e=>e.stopPropagation(),onMouseDown:e=>e.preventDefault(),onClick:()=>change({mounted:false})},'Remove field')),
  field,h('label',{htmlFor:'adjacent'},'Adjacent draft'),h('input',{id:'adjacent',value:state.adjacent,onChange:e=>change({adjacent:e.target.value})}),h('button',{type:'submit'},'Save'));

 return h('form',{id:'date-form',onSubmit:event=>{event.preventDefault();saves.push({value:latest.current.value,adjacent:latest.current.adjacent});setState(old=>({...old,saveCount:old.saveCount+1}));}},state.dialog?h('dialog',{ref:dialog,role:'dialog','aria-label':'Synthetic modal',className:'host-dialog'},controls):controls,h('output',{'aria-label':'Canonical value'},JSON.stringify(state.value)),h('output',{'aria-label':'Save count'},String(state.saveCount)),h('output',{'aria-label':'Saved values'},JSON.stringify(saves.at(-1)??null)));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.dateProof={snapshot:()=>({reactVersion:React.version,writes:[...writes],saves:[...saves],value:observed.value,adjacent:observed.adjacent}),change:patch=>change(patch)};
`;

/** Prepare only installed public bytes. Used by CI and independent localhost QA. */
export async function prepareCompleteDateBrowser(consumer) {
    const root = realpathSync(consumer);
    const directory = mkdtempSync(join(root, '.complete-date-browser-'));
    try {
        const entry = join(directory, 'host.mjs');
        writeFileSync(entry, completeDateBrowserSource);
        const result = await build({
            absWorkingDir: root,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(result.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(result.metafile.inputs).filter((path) =>
            path.includes('/sdk/dist/')
        );
        assert(
            inputs.some((path) => path.endsWith('/react/CompleteDateField.js'))
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/vendor/date-time/upstream.cjs')
            )
        );
        assert(
            inputs.some((path) => path.endsWith('/react/datePopoverRuntime.js'))
        );
        const reactInputs = Object.keys(result.metafile.inputs).filter((path) =>
            /(?:^|\/)node_modules\/react\/index\.js$/.test(path)
        );
        assert.equal(reactInputs.length, 1, 'One consumer React');
        const domInputs = Object.keys(result.metafile.inputs).filter((path) =>
            /(?:^|\/)node_modules\/react-dom\/index\.js$/.test(path)
        );
        assert.equal(domInputs.length, 1, 'One consumer ReactDOM');
        const css = readFileSync(
            join(installed, 'dist/esm/react/complete-date.css')
        );
        const script = result.outputFiles[0].contents;
        const style = Buffer.concat([
            css,
            Buffer.from(
                '\nbody{font:14px system-ui;margin:24px}main{max-width:340px;margin-left:auto}button{margin:8px;padding:8px}label{display:block}input{padding:8px}.host-dialog{width:320px;min-height:380px;overflow:visible;border:1px solid #888;border-radius:8px}output{display:block;margin:8px}'
            ),
        ]);
        const html = Buffer.from(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDK Date qualification</title><link rel="stylesheet" href="/date.css"><main></main><script type="module" src="/date.js"></script>'
        );
        const assets = new Map([
            ['/date.js', script],
            ['/date.css', style],
            ['/', html],
        ]);
        const hash = (bytes) =>
            createHash('sha256').update(bytes).digest('hex');
        const receipt = {
            scriptSha256: hash(script),
            cssSha256: hash(style),
            inputs: inputs.map((path) => ({
                path: path.slice(path.indexOf('/sdk/dist/') + 5),
                sha256: hash(readFileSync(resolve(root, path))),
            })),
        };
        return { assets, receipt };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

// Heroicons 2.1.1 solid Calendar used by the app at bc9794bf.
const nativeCalendarPath =
    'M6.75 2.25A.75.75 0 0 1 7.5 3v1.5h9V3A.75.75 0 0 1 18 3v1.5h.75a3 3 0 0 1 3 3v11.25a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3H6V3a.75.75 0 0 1 .75-.75Zm13.5 9a1.5 1.5 0 0 0-1.5-1.5H5.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h13.5a1.5 1.5 0 0 0 1.5-1.5v-7.5Z';

async function compareNativeCalendarIcon(icon, output, label) {
    await icon.screenshot({
        path: join(output, `date-${label}-installed-glyph.png`),
        animations: 'disabled',
    });
    // Replacing an identical SVG between screenshots can change edge antialiasing
    // in Chromium. Compare the mounted path and paint against the native source.
    return await icon.evaluate((svg, d) => {
        const [path] = svg.children;
        return (
            svg.getAttribute('viewBox') === '0 0 24 24' &&
            svg.getAttribute('fill') === 'currentColor' &&
            svg.children.length === 1 &&
            path?.localName === 'path' &&
            path.getAttribute('d') === d &&
            path.getAttribute('fill-rule') === 'evenodd' &&
            path.getAttribute('clip-rule') === 'evenodd' &&
            getComputedStyle(path).fill === getComputedStyle(svg).color &&
            getComputedStyle(path).stroke === 'none'
        );
    }, nativeCalendarPath);
}

async function checkCompleteDatePresentation({
    page,
    open,
    snapshot,
    output,
    evidence,
}) {
    const profiles = [
        { name: 'empty', populated: false },
        { name: 'populated', populated: true },
        { name: 'empty-focus', populated: false, focus: true },
        { name: 'populated-focus', populated: true, focus: true },
        { name: 'disabled', populated: true, disabled: true },
    ];
    const observations = (evidence.presentation = []);
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 860 });
        for (const mode of ['date', 'datetime']) {
            const dateTime = mode === 'datetime';
            const seed = dateTime ? '2024-07-01T14:30:00.000Z' : '2025-02-01';
            const display = dateTime ? '2024-07-01 10:30' : '2025-02-01';
            for (const profile of profiles) {
                const input = await open(mode);
                const readonly = profile.disabled === true;
                const value = profile.populated ? seed : null;
                await page.evaluate((state) => window.dateProof.change(state), {
                    value,
                    readonly,
                });
                await page.waitForFunction(
                    ({ expected, readonly }) => {
                        const field = document.querySelector(
                            '.mx-sdk-complete-date-input'
                        );
                        return (
                            field?.value === expected &&
                            field.disabled === readonly
                        );
                    },
                    { expected: profile.populated ? display : '', readonly }
                );
                if (profile.focus || readonly) {
                    await page
                        .getByRole('button', { name: 'Remove field' })
                        .focus();
                    await page.keyboard.press('Tab');
                }
                if (readonly) {
                    assert.equal(
                        await page
                            .getByRole('textbox', { name: 'Adjacent draft' })
                            .evaluate(
                                (node) => document.activeElement === node
                            ),
                        true
                    );
                }
                const control = page.locator('.mx-sdk-complete-date-control');
                const icon = control.locator('.mx-sdk-complete-date-icon');
                const appearance = await control.evaluate((controlNode) => {
                    const field = controlNode.querySelector('input');
                    const icon = controlNode.querySelector('svg');
                    const input = field.getBoundingClientRect();
                    const glyph = icon.getBoundingClientRect();
                    const style = getComputedStyle(field);
                    const iconStyle = getComputedStyle(icon);
                    return {
                        width: innerWidth,
                        dpr: devicePixelRatio,
                        height: input.height,
                        font: style.fontFamily,
                        size: style.fontSize,
                        lineHeight: style.lineHeight,
                        focused: field.matches(':focus-visible'),
                        disabled: field.disabled,
                        outline: style.outlineStyle,
                        glyph: [glyph.width, glyph.height],
                        inset: glyph.left - input.left,
                        color: iconStyle.color,
                        ariaHidden: icon.getAttribute('aria-hidden'),
                        pointerEvents: iconStyle.pointerEvents,
                    };
                });
                assert.equal(appearance.width, width);
                assert.equal(appearance.dpr, 1);
                assert.equal(appearance.focused, profile.focus === true);
                assert.equal(appearance.disabled, readonly);
                assert.deepEqual(appearance.glyph, [20, 20]);
                assert.equal(appearance.inset, 12);
                assert.equal(appearance.ariaHidden, 'true');
                assert.equal(appearance.pointerEvents, 'none');
                assert.equal(
                    appearance.color,
                    profile.focus ? 'rgb(59, 130, 246)' : 'rgb(156, 163, 175)'
                );
                if (profile.focus) assert.equal(appearance.outline, 'solid');
                const label = `${mode}-${width}-${profile.name}`;
                await control.screenshot({
                    path: join(output, `date-${label}-control.png`),
                    animations: 'disabled',
                });
                const glyphMatches = await compareNativeCalendarIcon(
                    icon,
                    output,
                    label
                );
                const state = await snapshot();
                assert.equal(state.value, value);
                assert.equal(
                    await input.inputValue(),
                    profile.populated ? display : ''
                );
                assert.deepEqual(state.writes, []);
                assert.deepEqual(state.saves, []);
                observations.push({ label, appearance, glyphMatches });
            }
        }
    }
    const differences = observations.filter(({ appearance, glyphMatches }) => {
        const mobile = appearance.width === 375;
        return (
            !glyphMatches ||
            appearance.height !== (mobile ? 42 : 38) ||
            appearance.size !== (mobile ? '16px' : '14px') ||
            appearance.lineHeight !== (mobile ? '24px' : '20px')
        );
    });
    assert.equal(
        differences.length,
        0,
        `Native Date presentation differs in ${differences.length} of ${observations.length} cases.`
    );
}

export async function checkCompleteDateBrowser({
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
    let server, context, page, failure;
    try {
        const prepared = await prepareCompleteDateBrowser(consumer);
        evidence.package = prepared.receipt;
        server = createServer((request, response) => {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const bytes = prepared.assets.get(pathname);
            if (!bytes) {
                response.writeHead(404);
                response.end();
                return;
            }
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; frame-src 'none'"
            );
            response.setHeader(
                'Content-Type',
                pathname.endsWith('.js')
                    ? 'application/javascript'
                    : pathname.endsWith('.css')
                      ? 'text/css'
                      : 'text/html'
            );
            response.end(bytes);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width: 900, height: 780 },
            deviceScaleFactor: 1,
        });
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                ['/', '/date.js', '/date.css'].includes(url.pathname)
            )
                return route.continue();
            evidence.unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        page = await context.newPage();
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        const snapshot = () => page.evaluate(() => window.dateProof.snapshot());
        const open = async (mode) => {
            await page.goto(origin + '/?mode=' + mode);
            await page
                .getByRole('textbox', { name: 'Appointment', exact: true })
                .waitFor();
            return page.getByRole('textbox', {
                name: 'Appointment',
                exact: true,
            });
        };
        const finish = async (name) => {
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            evidence.results.push({
                name,
                state: await snapshot(),
                ax: await page.locator('body').ariaSnapshot(),
            });
            await page.screenshot({
                path: join(output, `date-${name}.png`),
                fullPage: true,
            });
        };
        let input = await open('date');
        await input.click();
        const weekdayWidths = await page
            .locator('.rdtDays .dow')
            .evaluateAll((nodes) =>
                nodes.map((node) => node.getBoundingClientRect().width)
            );
        assert.equal(weekdayWidths.length, 7);
        assert(
            Math.max(...weekdayWidths) - Math.min(...weekdayWidths) < 2,
            'All seven weekday columns retain equal visible space'
        );
        await page.locator('.rdtOld[data-value="31"]').click();
        assert.equal((await snapshot()).value, '2025-01-31');
        assert.equal(await input.getAttribute('aria-expanded'), 'false');
        await input.click();
        await page.locator('.rdtNext').click();
        await page.locator('.rdtPrev').click();
        await page.keyboard.press('Escape');
        assert.equal(await input.getAttribute('aria-expanded'), 'false');
        await input.click();
        await page.getByRole('button', { name: 'Outside calendar' }).click();
        assert.equal(await input.getAttribute('aria-expanded'), 'false');
        await input.fill('2025-02-');
        await page.getByRole('button', { name: 'European format' }).click();
        assert.equal(await input.inputValue(), '31/1/2025');
        await input.fill('not a date');
        await page.keyboard.press('Tab');
        assert.equal(await input.inputValue(), '31/1/2025');
        await finish('month-boundary-dismiss-reset-recover');

        input = await open('vietnamese');
        assert.equal(await input.inputValue(), '2025-02-01');
        await input.click();
        await page.locator('.rdtDays .rdtSwitch').click();
        const months = page.locator('.rdtMonth:visible');
        const labels = Array.from(
            { length: 12 },
            (_, month) => `Thg ${String(month + 1).padStart(2, '0')}`
        );
        assert.deepEqual(await months.allTextContents(), labels);
        assert.equal(
            await page.locator('.rdtMonth.rdtActive').textContent(),
            'Thg 02'
        );
        const beforeMonthSelection = await snapshot();
        assert.equal(beforeMonthSelection.value, '2025-02-01');
        // Pointer focus leaving the input can recommit its unchanged text.
        assert(beforeMonthSelection.writes.length <= 1);
        for (const write of beforeMonthSelection.writes)
            assert.deepEqual(write, { value: '2025-02-01', writer: 'first' });
        await finish('vietnamese-month-labels');
        await page.getByRole('cell', { name: 'Thg 07', exact: true }).click();
        assert.deepEqual(
            (await snapshot()).writes,
            beforeMonthSelection.writes
        );
        await page
            .locator('.rdtDay:not(.rdtOld):not(.rdtNew)[data-value="15"]')
            .click();
        assert.deepEqual((await snapshot()).writes, [
            ...beforeMonthSelection.writes,
            { value: '2025-07-15', writer: 'first' },
        ]);
        assert.deepEqual((await snapshot()).saves, []);
        await finish('vietnamese-july-day-selection');

        input = await open('datetime');
        assert.equal(await input.inputValue(), '2024-07-01 10:30');
        assert.deepEqual((await snapshot()).writes, []);
        await input.click();
        await page
            .locator('.rdtDay:not(.rdtOld):not(.rdtNew)[data-value="2"]')
            .click();
        assert.equal((await snapshot()).value, '2024-07-02T14:30:00.000Z');
        await input.click();
        const dayPopup = page.locator('.mx-sdk-complete-date-popup');
        assert.equal(
            await dayPopup.evaluate(
                (node) => node.getBoundingClientRect().width
            ),
            266
        );
        await page.locator('body').evaluate((body) => {
            body.style.font = '16px/1.5 Arial, sans-serif';
            body.style.color = 'rgb(2, 8, 23)';
        });
        await page.getByRole('cell', { name: '10:30', exact: true }).click();
        const timePanel = await dayPopup.evaluate((node) => {
            const style = getComputedStyle(node);
            return {
                width: node.getBoundingClientRect().width,
                font: style.fontFamily,
                size: style.fontSize,
                color: style.color,
                digits: Array.from(
                    node.querySelectorAll('.rdtCount'),
                    (digit) => ({
                        value: digit.textContent,
                        size: getComputedStyle(digit).fontSize,
                    })
                ),
                counterSizes: Array.from(
                    node.querySelectorAll('.rdtCounter'),
                    (counter) => {
                        const { width, height } =
                            counter.getBoundingClientRect();
                        return [width, height];
                    }
                ),
                adjustmentHeights: Array.from(
                    node.querySelectorAll('.rdtCounter .rdtBtn'),
                    (button) => button.getBoundingClientRect().height
                ),
            };
        });
        assert.deepEqual(timePanel, {
            width: 250,
            font: 'Arial, sans-serif',
            size: '16px',
            color: 'rgb(2, 8, 23)',
            digits: [
                { value: '10', size: '19.2px' },
                { value: '30', size: '19.2px' },
            ],
            counterSizes: [
                [40, 100],
                [40, 100],
            ],
            adjustmentHeights: [40, 40, 40, 40],
        });
        evidence.timePanel = timePanel;
        await page.locator('.rdtCounter .rdtBtn').first().click();
        assert.equal((await snapshot()).value, '2024-07-02T15:30:00.000Z');
        assert.equal(await input.inputValue(), '2024-07-02 11:30');
        assert.equal((await snapshot()).saves.length, 0);
        await page.getByRole('button', { name: 'Outside calendar' }).click();
        await input.fill('2024-07-02 08:15');
        await page.keyboard.press('Enter');
        assert.equal((await snapshot()).value, '2024-07-02T12:15:00.000Z');
        assert.equal((await snapshot()).saves.length, 0);
        await page.keyboard.press('Enter');
        assert.equal((await snapshot()).saves.length, 0);
        await page
            .getByRole('textbox', { name: 'Adjacent draft' })
            .fill('Adjacent unsaved text');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.deepEqual((await snapshot()).saves, [
            {
                value: '2024-07-02T12:15:00.000Z',
                adjacent: 'Adjacent unsaved text',
            },
        ]);
        assert.equal(
            await page.locator('output[aria-label="Save count"]').textContent(),
            '1'
        );
        await finish('datetime-enter-explicit-save');

        input = await open('dialog');
        await input.click();
        const popup = page.locator('.mx-sdk-complete-date-popup');
        await popup.waitFor();
        assert.equal(
            await popup.evaluate((node) =>
                node.closest('dialog')?.getAttribute('aria-label')
            ),
            'Synthetic modal'
        );
        await page.setViewportSize({ width: 380, height: 700 });
        await page.waitForFunction(() => {
            const r = document
                .querySelector('.mx-sdk-complete-date-popup')
                ?.getBoundingClientRect();
            return r && r.left >= 0 && r.right <= innerWidth;
        });
        assert.equal(await popup.getAttribute('data-align'), 'end');
        await page.keyboard.press('Escape');
        assert.equal(await input.getAttribute('aria-expanded'), 'false');
        await input.click();
        await input.fill('2025-02-');
        await page.getByRole('button', { name: 'Replace owner' }).click();
        assert.equal(await input.inputValue(), '2024-03-15');
        assert.equal(await input.getAttribute('aria-expanded'), 'false');
        assert.deepEqual((await snapshot()).writes, []);
        await input.click();
        await page.getByRole('button', { name: 'Remove field' }).click();
        assert.equal(await popup.count(), 0);
        await finish('dialog-collision-reopen-unmount');

        input = await open('readonly');
        assert.equal(await input.isDisabled(), true);
        assert.equal(await input.inputValue(), '2025-02-01');
        assert.deepEqual((await snapshot()).writes, []);
        await finish('readonly-existing-range');
        await checkCompleteDatePresentation({
            page,
            open,
            snapshot,
            output,
            evidence,
        });
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Installed public Date picker in synthetic localhost browser; trusted pointer/keyboard, popup/modal and explicit Save; no provider/native backend or OS IME claim.';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.dateProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'date-failure.png'),
                    fullPage: true,
                });
            } catch (capture) {
                evidence.failureCaptureError = capture.message;
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
        ])
            try {
                await cleanup();
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                failure ??= error;
                evidence.status = 'failed';
            }
    }
    if (failure) throw failure;
}
