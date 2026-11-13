import assert from 'node:assert/strict';
import { calendarCompleteStyleAssets } from './calendar-complete-style-assets.mjs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const calendarBrowserSource = `
import React,{createElement as h,useLayoutEffect,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {CalendarMonthGrid} from '@miniextensions/sdk/react/calendar';

// Controlled grid only: no record client, accepted owner, provider or native host.
const media=window.matchMedia('(min-width: 1024px)');
const subscribe=listener=>{media.addEventListener('change',listener);return ()=>media.removeEventListener('change',listener);};
const dayIntents=[],focusIntents=[];
let observed=null;
function App(){
 const [surface,setSurface]=useState('portal');
 const [selectedDay,setSelectedDay]=useState('2026-02-12');
 const [mounted,setMounted]=useState(true);
 const isWide=useSyncExternalStore(subscribe,()=>media.matches,()=>false);
 useLayoutEffect(()=>{observed={surface,selectedDay,isWide,mounted};});
 const select=surface=>{setSurface(surface);setSelectedDay('2026-02-12');setMounted(true);};
 return h(React.Fragment,null,
  h('div',{className:'fixture-controls'},
   h('button',{type:'button','data-calendar-proof':'picker',onClick:()=>select('picker')},'Show picker'),
   h('button',{type:'button','data-calendar-proof':'portal',onClick:()=>select('portal')},'Show Portal'),
   h('button',{type:'button','data-calendar-proof':'remove',onClick:()=>setMounted(false)},'Remove grid')),
  mounted?h('div',{className:'fixture-grid-host'},h(CalendarMonthGrid,{key:surface,surface,selectedDay,isWide,locale:'en-US',localToday:{year:2026,month:2,day:11},labels:{calendar:'Synthetic appointments',previous:'Previous month',next:'Next month',events:'events'},eventCounts:{'2026-02-12':12},onDayChange(day){dayIntents.push(day);setSelectedDay(day);},onFocusChange(day){focusIntents.push(day);},selectedDayContent:h('p',{'data-calendar-proof':'selected'},'Selected day: '+selectedDay)})):null);
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.calendarProof={snapshot:()=>observed&&({...observed,reactVersion:React.version,dayIntents:[...dayIntents],focusIntents:[...focusIntents]})};
`;

export const completeCalendarBrowserSource = `
import React,{createElement as h,useLayoutEffect,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {CalendarRecordPicker,PortalCalendar} from '@miniextensions/sdk/react/calendar';
// Explicit synthetic host ports only. These are not SDK-private accepted pages,
// native adapters, provider calls, child forms, or backend persistence evidence.
const media=window.matchMedia('(min-width: 1024px)');
const subscribe=listener=>{media.addEventListener('change',listener);return ()=>media.removeEventListener('change',listener);};
const clock={utcDay:()=> '2026-02-15',localDay:()=> '2026-02-15',localMonth:()=> '2026-02',localToday:()=> '2026-02-14',clientUtcOffset:()=>0};
const date=id=>({id,name:id,description:null,isComputed:false,isPrimaryField:false,config:{type:'date',options:{dateFormat:{name:'iso',format:'YYYY-MM-DD'}}}});
const admitted=()=>({type:'admitted'}),refused=reason=>({type:'refused',reason});
const canonical=['off-day'],attempts=[],writes=[],pickerReads=[],portalReads=[],opens=[],removals=[];
let pickerOwner={},pickerLive=true,pickerControlLive=true,capped=false,refuseReads=false;
let portalOwner={},portalLive=true,portalControlLive=true,portalCanOpen=true,retainedMonth='2026-02';
let setPickerFrame=null,setPortalFrame=null,observed=null;
const pickerControl={owner:{},isCurrent:()=>pickerControlLive,scheduleRead(request){pickerReads.push(request);return refuseReads?refused('native-read-refusal'):admitted();}};
const pickerRecords=[{id:'one',fields:{start:'2026-02-15',end:'2026-02-15'}},{id:'two',fields:{start:'2026-02-15',end:'2026-02-15'}},{id:'off-day',fields:{start:'2026-02-21',end:'2026-02-21'}}];
const presentations={one:{type:'list',primary:'Rich appointment',showPreviewFieldTitle:true,details:[{key:'notes',title:'Notes',leaf:{kind:'text',display:{value:'Rich https://example.test/calendar',language:'en',layout:'linked-list'}}},{key:'tag',title:'Tag',leaf:{kind:'pills',items:[{label:'Accepted tag'}]}}]},two:{type:'calendar',primary:'Second appointment',subtitle:'Native compact detail'},'off-day':{type:'calendar',primary:'Off-day selection',subtitle:''}};
function makePicker(patch={}){const expected=pickerOwner;return Object.freeze({control:pickerControl,presentationOwner:{owner:expected,isCurrent:()=>pickerLive&&pickerOwner===expected},records:pickerRecords,startField:date('start'),endField:date('end'),selectedRecordIds:[...canonical],presentationByRecordId:presentations,selectionEnabled:true,errorMessage:null,isLoading:false,isLoadingMore:false,canLoadMore:true,toggleRecord(id){attempts.push(id);if(!pickerControlLive||!pickerLive||pickerOwner!==expected)return refused('stale-host');if(capped&&!canonical.includes(id))return refused('native-cap');const index=canonical.indexOf(id);if(index>=0)canonical.splice(index,1);else canonical.push(id);writes.push(id);publishPicker();return admitted();},...patch});}
function publishPicker(patch={}){pickerOwner={};setPickerFrame?.(makePicker(patch));}
const portalControl={owner:{},isCurrent:()=>portalControlLive,retainMonth(month){if(!portalControlLive)return refused('stale-control');portalReads.push(['retain',month]);retainedMonth=month;publishPortal();return admitted();},readFirstPage(request){if(!portalControlLive)return refused('stale-control');portalReads.push(['read',request]);return admitted();}};
function makePortal(){const expected=portalOwner;const current=()=>portalControlLive&&portalLive&&portalOwner===expected;return Object.freeze({control:portalControl,presentationOwner:{token:expected,isCurrent:()=>portalLive&&portalOwner===expected},retainedMonth,records:[{id:'one',fields:{date:'2026-02-15'},display:{status:'present',primary:'Literal <appointment>',subtitle:'Native compact subtitle'}}],dateField:date('date'),fallbackClientUtcOffset:0,shouldShowToTheSide:true,recordActions:[{recordId:'one',...(portalCanOpen?{open(request){if(!current())return refused('stale-host');opens.push(request);return admitted();}}:{}),remove(){if(!current())return refused('stale-host');removals.push('one');return admitted();}}],status:'ready'});}
function publishPortal(){portalOwner={};setPortalFrame?.(makePortal());}
function App(){
 const [mode,setMode]=useState('picker'),[mounted,setMounted]=useState(true);
 const [pickerFrame,publishP]=useState(()=>makePicker()),[portalFrame,publishQ]=useState(()=>makePortal());
 const isWide=useSyncExternalStore(subscribe,()=>media.matches,()=>false);
 useLayoutEffect(()=>{setPickerFrame=publishP;setPortalFrame=publishQ;observed={mode,mounted,isWide};return()=>{setPickerFrame=null;setPortalFrame=null;};});
 const show=mode=>{setMode(mode);setMounted(true);};
 return h(React.Fragment,null,h('div',{className:'fixture-controls'},
  h('button',{type:'button','data-complete-calendar':'picker',onClick:()=>show('picker')},'Complete picker'),
  h('button',{type:'button','data-complete-calendar':'portal',onClick:()=>show('portal')},'Complete Portal'),
  h('button',{type:'button','data-complete-calendar':'cap',onClick:()=>{capped=true;publishPicker();}},'Native cap'),
  h('button',{type:'button','data-complete-calendar':'disable',onClick:()=>publishPicker({selectionEnabled:false})},'Disable selection'),
  h('button',{type:'button','data-complete-calendar':'refuse-read',onClick:()=>{refuseReads=true;publishPicker();}},'Refuse reads'),
  h('button',{type:'button','data-complete-calendar':'error-loading',onClick:()=>publishPicker({errorMessage:'Calendar native error',isLoading:true})},'Error and loading'),
  h('button',{type:'button','data-complete-calendar':'restore',onClick:()=>{pickerLive=true;portalLive=true;publishPicker();publishPortal();}},'Restore presentation'),
  h('button',{type:'button','data-complete-calendar':'retire-picker',onClick:()=>{pickerLive=false;}},'Retire picker display'),
  h('button',{type:'button','data-complete-calendar':'remove-only',onClick:()=>{portalCanOpen=false;publishPortal();}},'Remove-only card'),
  h('button',{type:'button','data-complete-calendar':'retire-portal',onClick:()=>{portalLive=false;}},'Retire Portal display'),
  h('button',{type:'button','data-complete-calendar':'retire-portal-control',onClick:()=>{portalControlLive=false;}},'Retire Portal controls'),
  h('button',{type:'button','data-complete-calendar':'unmount',onClick:()=>setMounted(false)},'Unmount complete Calendar')),
  mounted?h('div',{className:'fixture-complete-host'},mode==='picker'?h(CalendarRecordPicker,{key:'picker',frame:pickerFrame,clock,locale:'en-US'}):h(PortalCalendar,{key:'portal',frame:portalFrame,clock,locale:'en-US',isWide})):null);
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.completeCalendarProof={snapshot:()=>observed&&({...observed,reactVersion:React.version,canonical:[...canonical],attempts:[...attempts],writes:[...writes],pickerReads:[...pickerReads],portalReads:[...portalReads],opens:[...opens],removals:[...removals]})};
`;

const fixtureStyle = `
body{margin:8px;font:14px system-ui,sans-serif;color:#111827}
main{width:100%;max-width:1100px;margin:0 auto}
.fixture-controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.fixture-controls button{font:inherit;padding:6px 10px}
.fixture-grid-host{width:100%}
@media(max-width:400px){.fixture-grid-host{max-width:270px;margin:0 auto}}
`;

/** Prepare the actual installed public grid and CSS under existing TGZ custody. */
export async function prepareCalendarBrowser(
    consumer,
    readArchiveMember,
    profile = 'grid'
) {
    assert.equal(typeof readArchiveMember, 'function');
    const root = realpathSync(consumer);
    const directory = mkdtempSync(join(root, '.calendar-browser-'));
    try {
        const entry = join(directory, 'host.mjs');
        const complete = profile === 'complete';
        const source = complete
            ? completeCalendarBrowserSource
            : calendarBrowserSource;
        writeFileSync(entry, source);
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
        const inputs = Object.keys(result.metafile.inputs).filter((input) =>
            realpathSync(resolve(root, input)).startsWith(installed + '/')
        );
        assert(
            inputs.some((input) =>
                input.endsWith('/react/CalendarMonthGrid.js')
            ),
            'Actual installed CalendarMonthGrid required'
        );
        assert(
            inputs.some((input) => input.endsWith('/react/calendar/index.js')),
            'Public Calendar entry required'
        );
        if (complete)
            for (const name of [
                'CalendarRecordPicker',
                'PortalCalendar',
                'LinkedFinderCard',
                'CalendarRuntime',
            ])
                assert(
                    inputs.some((input) => input.endsWith(`/react/${name}.js`)),
                    `Actual installed ${name} required`
                );
        for (const name of ['react', 'react-dom'])
            assert.equal(
                Object.keys(result.metafile.inputs).filter((input) =>
                    input.endsWith(`/node_modules/${name}/index.js`)
                ).length,
                1,
                `One consumer ${name} instance required`
            );
        const packageInputs = inputs.map((input) => {
            const path = realpathSync(resolve(root, input));
            const bytes = readFileSync(path);
            const member =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(
                bytes,
                readArchiveMember(member),
                'Calendar input differs from admitted TGZ'
            );
            return { member, bytes: bytes.length, sha256: hash(bytes) };
        });
        const cssMember =
            'package/dist/esm/react/' +
            (complete ? 'calendar-complete.css' : 'calendar.css');
        const css = readFileSync(
            join(installed, cssMember.slice('package/'.length))
        );
        assert.deepEqual(css, readArchiveMember(cssMember));
        const fullStyles = complete
            ? calendarCompleteStyleAssets(installed, readArchiveMember)
            : null;
        const style = complete
            ? Buffer.from(fixtureStyle)
            : Buffer.concat([css, Buffer.from(fixtureStyle)]);
        const script = result.outputFiles[0].contents;
        const scriptPath = complete ? '/complete-calendar.js' : '/calendar.js';
        const styleHref = complete ? fullStyles.href : '/calendar.css';
        const html = Buffer.from(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDK Calendar composition</title><link rel="stylesheet" href="' +
                styleHref +
                '">' +
                (complete
                    ? '<link rel="stylesheet" href="/calendar-fixture.css">'
                    : '') +
                '<main></main><script type="module" src="' +
                scriptPath +
                '"></script>'
        );
        return {
            assets: new Map([
                [complete ? '/complete' : '/', html],
                [scriptPath, script],
                [complete ? '/calendar-fixture.css' : '/calendar.css', style],
                ...[...(fullStyles?.assets ?? new Map())],
                ['/favicon.ico', Buffer.alloc(0)],
            ]),
            receipt: {
                harnessSha256: hash(readFileSync(new URL(import.meta.url))),
                hostSha256: hash(source),
                profile,
                completeStyles: fullStyles?.inputs,
                scriptSha256: hash(script),
                css: { member: cssMember, sha256: hash(css) },
                servedStyleSha256: hash(style),
                inputs: packageInputs,
            },
        };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

/** Called only by the existing installed SDK native-browser harness. */
export async function checkCalendarBrowser({
    browser,
    consumer,
    evidence,
    output,
    readArchiveMember,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'prepare',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        screenshots: [],
        cleanup: {},
    });
    let server, context, page, failure;
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
        const prepared = await prepareCalendarBrowser(
            consumer,
            readArchiveMember
        );
        const completePrepared = await prepareCalendarBrowser(
            consumer,
            readArchiveMember,
            'complete'
        );
        evidence.package = prepared.receipt;
        evidence.completePackage = completePrepared.receipt;
        for (const [path, bytes] of completePrepared.assets)
            prepared.assets.set(path, bytes);
        evidence.cleanup.fixtureDirectory = 'removed';
        server = createServer((request, response) => {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const bytes = prepared.assets.get(pathname);
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'"
            );
            if (!bytes) {
                response.writeHead(404);
                response.end();
                return;
            }
            response.setHeader(
                'Content-Type',
                pathname.endsWith('.js')
                    ? 'text/javascript'
                    : pathname.endsWith('.css')
                      ? 'text/css'
                      : 'text/html'
            );
            response.statusCode = pathname === '/favicon.ico' ? 204 : 200;
            response.end(bytes);
        });
        await bounded(
            'Calendar server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            serviceWorkers: 'block',
            viewport: { width: 375, height: 844 },
        });
        await context.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin === origin && prepared.assets.has(url.pathname))
                await route.continue();
            else {
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                await route.abort();
            }
        });
        page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        const snapshot = () =>
            page.evaluate(() => window.calendarProof.snapshot());
        const saveScreenshot = async (name) => {
            const file = `calendar-${name}.png`;
            const bytes = await page.screenshot({
                path: join(output, file),
                fullPage: true,
            });
            evidence.screenshots.push({ file, sha256: hash(bytes) });
        };
        const day = (date) =>
            page.locator(`[data-date="${date}"] .mx-sdk-calendar__day`);
        evidence.phase = 'interaction';
        await page.goto(origin);
        await page.waitForFunction(() => window.calendarProof?.snapshot());
        assert.equal(await page.locator('tbody tr').count(), 4);
        assert.deepEqual((await snapshot()).dayIntents, []);
        assert.deepEqual((await snapshot()).focusIntents, []);
        const geometry = await page
            .locator('[data-date="2026-02-12"]')
            .evaluate((cell) => {
                const rect = (node) => {
                    const value = node.getBoundingClientRect();
                    return {
                        top: value.top,
                        right: value.right,
                        bottom: value.bottom,
                        left: value.left,
                        width: value.width,
                        height: value.height,
                    };
                };
                return {
                    cell: rect(cell),
                    number: rect(
                        cell.querySelector('.mx-sdk-calendar__number')
                    ),
                    dots: [
                        ...cell.querySelectorAll('.mx-sdk-calendar__dot'),
                    ].map(rect),
                    viewport: innerWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    gridWidth: cell.closest('table').getBoundingClientRect()
                        .width,
                };
            });
        assert.equal(geometry.viewport, 375);
        assert(
            geometry.gridWidth <= 270.5 && geometry.gridWidth >= 269.5,
            'Dense event regression uses the compact 270px field container'
        );
        assert.equal(geometry.dots.length, 12);
        for (const dot of geometry.dots) {
            assert(
                dot.width > 0 && dot.height > 0,
                'Each event dot is visible'
            );
            assert(
                dot.top >= geometry.number.bottom - 0.5,
                'Every event dot stays below the day number'
            );
            assert(
                dot.left >= geometry.cell.left - 0.5 &&
                    dot.right <= geometry.cell.right + 0.5 &&
                    dot.top >= geometry.cell.top - 0.5 &&
                    dot.bottom <= geometry.cell.bottom + 0.5,
                'Dense Portal dots stay inside their day cell'
            );
        }
        assert(
            geometry.documentWidth <= geometry.viewport,
            'Narrow calendar must not force horizontal page overflow'
        );
        evidence.results.push({
            name: 'portal-375-dense-events',
            geometry,
            weeks: 4,
        });
        await saveScreenshot('portal-375-dense-events');

        await day('2026-02-13').click();
        await page.waitForFunction(
            () => window.calendarProof.snapshot().selectedDay === '2026-02-13'
        );
        const selected = await snapshot();
        assert.deepEqual(selected.dayIntents, ['2026-02-13']);
        const transitions = [];
        for (const width of [1023, 1024, 375]) {
            await page.setViewportSize({ width, height: 844 });
            await page.waitForFunction(
                ({ width, wide }) =>
                    innerWidth === width &&
                    window.calendarProof.snapshot().isWide === wide,
                { width, wide: width >= 1024 }
            );
            const current = await snapshot();
            assert.equal(current.selectedDay, selected.selectedDay);
            assert.deepEqual(current.dayIntents, selected.dayIntents);
            assert.deepEqual(current.focusIntents, selected.focusIntents);
            if (width >= 1024) {
                assert.equal(
                    await day('2026-02-13').getAttribute('role'),
                    null
                );
                assert.equal(
                    await day('2026-02-13').getAttribute('tabindex'),
                    null
                );
                await saveScreenshot('portal-1024');
            }
            transitions.push({ width, isWide: current.isWide });
        }
        assert.equal(
            await day('2026-02-13').getAttribute('data-selected'),
            'true'
        );
        evidence.results.push({
            name: 'portal-selected-day-responsive-retention',
            selectedDay: selected.selectedDay,
            transitions,
            unsolicitedDayOrFocusIntents: 0,
        });

        await day('2026-02-13').click();
        const beforePortalArrow = await snapshot();
        await page.keyboard.press('ArrowRight');
        assert.equal(
            await day('2026-02-13').evaluate(
                (node) => node === document.activeElement
            ),
            true
        );
        const afterPortalArrow = await snapshot();
        assert.deepEqual(
            afterPortalArrow.focusIntents,
            beforePortalArrow.focusIntents
        );
        assert.deepEqual(
            afterPortalArrow.dayIntents,
            beforePortalArrow.dayIntents
        );
        evidence.results.push({
            name: 'portal-grid-keydown-suppressed',
            key: 'ArrowRight',
            newDayOrFocusIntents: 0,
        });

        await page.locator('[data-calendar-proof="picker"]').click();
        await page.waitForFunction(
            () => window.calendarProof.snapshot().surface === 'picker'
        );
        assert.equal(await page.locator('tbody tr').count(), 6);
        assert.equal(
            await page.locator('.mx-sdk-calendar__badge').textContent(),
            '9+'
        );
        await day('2026-02-13').click();
        const beforePickerArrow = await snapshot();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(
            () =>
                document.activeElement
                    ?.closest('[data-date]')
                    ?.getAttribute('data-date') === '2026-02-14'
        );
        const afterPickerArrow = await snapshot();
        const arrowFocus = afterPickerArrow.focusIntents.slice(
            beforePickerArrow.focusIntents.length
        );
        assert(arrowFocus.length > 0);
        assert(arrowFocus.every((date) => date === '2026-02-14'));
        assert.deepEqual(
            afterPickerArrow.dayIntents,
            beforePickerArrow.dayIntents,
            'Focus navigation is not day selection'
        );
        await page
            .getByRole('button', { name: 'Next month', exact: true })
            .click();
        await page.waitForFunction(() =>
            document.querySelector('h2')?.textContent?.includes('March 2026')
        );
        const afterNext = await snapshot();
        const monthFocus = afterNext.focusIntents.slice(
            afterPickerArrow.focusIntents.length
        );
        assert(monthFocus.length > 0);
        assert(monthFocus.every((date) => date.startsWith('2026-03')));
        assert.deepEqual(afterNext.dayIntents, afterPickerArrow.dayIntents);
        evidence.results.push({
            name: 'picker-native-keyboard-and-month-focus',
            weeks: 6,
            arrowFocus,
            monthFocus,
            extraDaySelections: 0,
        });
        await saveScreenshot('picker-keyboard');
        await page.locator('[data-calendar-proof="remove"]').click();
        assert.equal(await page.locator('.mx-sdk-calendar').count(), 0);
        assert.deepEqual((await snapshot()).dayIntents, afterNext.dayIntents);
        assert.deepEqual(
            (await snapshot()).focusIntents,
            afterNext.focusIntents
        );
        // Continue within the same guarded runner, browser and owned origin.
        await page.setViewportSize({ width: 375, height: 844 });
        await page.goto(origin + '/complete');
        await page.waitForFunction(() =>
            window.completeCalendarProof?.snapshot()
        );
        const completeSnapshot = () =>
            page.evaluate(() => window.completeCalendarProof.snapshot());
        assert.equal(
            await page.evaluate(() => typeof screen.orientation.angle),
            'number',
            'Cold browser import uses real ScreenOrientation'
        );
        const option = (index) =>
            page
                .locator('.mx-sdk-calendar-picker__records [role=option]')
                .nth(index);
        assert.equal(await option(0).count(), 1);
        assert.equal(await option(1).count(), 1);
        assert.deepEqual((await completeSnapshot()).pickerReads, []);
        assert.deepEqual((await completeSnapshot()).writes, []);
        assert.equal(
            await option(0).locator('a').getAttribute('href'),
            'https://example.test/calendar'
        );
        assert.equal(
            await option(0).locator('.mx-sdk-finder-pill').textContent(),
            'Accepted tag'
        );
        const richGeometry = await option(0).evaluate((row) => ({
            border: getComputedStyle(row).borderTopWidth,
            width: row.getBoundingClientRect().width,
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
        }));
        assert.equal(
            richGeometry.border,
            '3px',
            'Complete picker scoped CSS is loaded'
        );
        assert(
            richGeometry.width > 0 &&
                richGeometry.documentWidth <= richGeometry.viewport
        );
        await option(0).click({ position: { x: 6, y: 6 } });
        await page.waitForFunction(
            () => window.completeCalendarProof.snapshot().writes.length === 1
        );
        assert.deepEqual((await completeSnapshot()).canonical, [
            'off-day',
            'one',
        ]);
        assert.equal(await option(0).getAttribute('aria-selected'), 'true');
        const bulkBefore = await completeSnapshot();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Escape');
        assert.deepEqual(
            (await completeSnapshot()).attempts,
            bulkBefore.attempts,
            'Bulk/clear cannot write hidden off-day membership'
        );
        await page.locator('[data-complete-calendar="cap"]').click();
        await option(1).click({ position: { x: 6, y: 6 } });
        assert.deepEqual((await completeSnapshot()).attempts, ['one', 'two']);
        assert.deepEqual((await completeSnapshot()).writes, ['one']);
        assert.deepEqual((await completeSnapshot()).canonical, [
            'off-day',
            'one',
        ]);
        await page.locator('.mx-sdk-calendar-picker__more').click();
        assert.deepEqual((await completeSnapshot()).pickerReads, [
            { month: '2026-02', resetOffset: false, clientUtcOffset: 0 },
        ]);
        await page.locator('[data-complete-calendar="refuse-read"]').click();
        await page.locator('.mx-sdk-calendar-picker__more').click();
        assert.equal((await completeSnapshot()).pickerReads.length, 2);
        assert.deepEqual((await completeSnapshot()).writes, ['one']);
        await page.locator('[data-complete-calendar="disable"]').click();
        await option(1).click({ position: { x: 6, y: 6 } });
        assert.deepEqual((await completeSnapshot()).attempts, ['one', 'two']);
        await page.locator('[data-complete-calendar="error-loading"]').click();
        assert.equal(
            await page
                .locator('.mx-sdk-calendar-picker__list [role=alert]')
                .textContent(),
            'Calendar native error'
        );
        assert.equal(
            await page
                .locator('.mx-sdk-calendar-picker__list [role=status]')
                .count(),
            0
        );
        await saveScreenshot('complete-picker-error-loading');
        await page.locator('[data-complete-calendar="restore"]').click();
        await page.locator('[data-complete-calendar="retire-picker"]').click();
        const retiredPicker = await completeSnapshot();
        await option(0).click({ position: { x: 6, y: 6 } });
        assert.deepEqual(
            (await completeSnapshot()).attempts,
            retiredPicker.attempts,
            'Retired display cannot invoke a retained visible row'
        );
        evidence.results.push({
            name: 'complete-picker-rich-r30-status-paging-refusal',
            canonical: (await completeSnapshot()).canonical,
            attempts: (await completeSnapshot()).attempts,
            writes: (await completeSnapshot()).writes,
            reads: (await completeSnapshot()).pickerReads,
            richGeometry,
        });

        await page.setViewportSize({ width: 1100, height: 844 });
        await page.locator('[data-complete-calendar="portal"]').click();
        await page.waitForFunction(
            () =>
                window.completeCalendarProof.snapshot().mode === 'portal' &&
                window.completeCalendarProof.snapshot().isWide
        );
        assert.deepEqual((await completeSnapshot()).portalReads, []);
        assert.equal(
            await page
                .locator('.mx-sdk-portal-calendar__primary')
                .textContent(),
            'Literal <appointment>'
        );
        assert.equal(await page.locator('appointment').count(), 0);
        await page
            .getByRole('button', {
                name: 'Open record: Literal <appointment>',
                exact: true,
            })
            .click();
        assert.deepEqual((await completeSnapshot()).opens, [
            { shouldShowToTheSide: true },
        ]);
        await page.setViewportSize({ width: 375, height: 844 });
        await page.waitForFunction(
            () => !window.completeCalendarProof.snapshot().isWide
        );
        assert.equal(
            await day('2026-02-15').getAttribute('data-selected'),
            'true'
        );
        await page
            .getByRole('button', {
                name: 'Open record: Literal <appointment>',
                exact: true,
            })
            .click();
        assert.deepEqual((await completeSnapshot()).opens, [
            { shouldShowToTheSide: true },
            { shouldShowToTheSide: false },
        ]);
        const beforeDayWrites = await completeSnapshot();
        await day('2026-02-16').click();
        assert.equal(
            await page.locator('.mx-sdk-portal-calendar__record').count(),
            0
        );
        await day('2026-02-15').click();
        assert.deepEqual(
            (await completeSnapshot()).writes,
            beforeDayWrites.writes
        );
        assert.deepEqual(
            (await completeSnapshot()).removals,
            beforeDayWrites.removals
        );
        await page.setViewportSize({ width: 1024, height: 844 });
        await page.waitForFunction(
            () => window.completeCalendarProof.snapshot().isWide
        );
        assert.deepEqual(
            (await completeSnapshot()).portalReads,
            [],
            'Wide/narrow/wide has no unsolicited reads'
        );
        await page
            .getByRole('button', {
                name: 'Remove record: Literal <appointment>',
                exact: true,
            })
            .click();
        assert.deepEqual((await completeSnapshot()).removals, ['one']);
        await page.locator('[data-complete-calendar="remove-only"]').click();
        assert.equal(
            await page
                .getByRole('button', {
                    name: 'Open record: Literal <appointment>',
                    exact: true,
                })
                .count(),
            0
        );
        await page
            .getByRole('button', {
                name: 'Remove record: Literal <appointment>',
                exact: true,
            })
            .click();
        assert.deepEqual((await completeSnapshot()).removals, ['one', 'one']);
        await page.locator('[data-complete-calendar="retire-portal"]').click();
        await page
            .getByRole('button', {
                name: 'Remove record: Literal <appointment>',
                exact: true,
            })
            .click();
        assert.deepEqual(
            (await completeSnapshot()).removals,
            ['one', 'one'],
            'Retired display cannot reuse child/remove authority'
        );
        await page.locator('[data-complete-calendar="restore"]').click();
        await saveScreenshot('complete-portal-wide');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        assert.deepEqual(
            (await completeSnapshot()).portalReads,
            [
                ['retain', '2026-03'],
                [
                    'read',
                    { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false },
                ],
            ],
            'One stable-control retain then forced read despite display publication'
        );
        await page
            .locator('[data-complete-calendar="retire-portal-control"]')
            .click();
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        assert.equal((await completeSnapshot()).portalReads.length, 2);
        assert.deepEqual((await completeSnapshot()).writes, ['one']);
        evidence.results.push({
            name: 'complete-portal-responsive-card-capability-control-retirement',
            opens: (await completeSnapshot()).opens,
            removals: (await completeSnapshot()).removals,
            reads: (await completeSnapshot()).portalReads,
            dayRecordWrites: 0,
        });
        await page.locator('[data-complete-calendar="unmount"]').click();
        assert.equal(
            await page
                .locator('.mx-sdk-calendar-picker,.mx-sdk-portal-calendar')
                .count(),
            0
        );
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Installed public Calendar grid and complete picker/Portal composition with shared rich leaves and exact owning CSS; trusted synthetic localhost host ports only, no native adapter, provider, read receipt or hosted acceptance.';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            try {
                evidence.failureState = await page.evaluate(
                    () =>
                        window.completeCalendarProof?.snapshot() ??
                        window.calendarProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'calendar-failure.png'),
                    fullPage: true,
                });
            } catch (capture) {
                evidence.failureCaptureError = capture.message;
            }
    } finally {
        for (const [name, cleanup] of [
            ['page', () => page?.close()],
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
                await bounded(`Calendar cleanup ${name}`, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                failure ??= error;
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
            }
        writeFileSync(
            join(output, 'calendar.json'),
            JSON.stringify(evidence, null, 2)
        );
    }
    if (failure) throw failure;
}
