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

const fixtureStyle = `
body{margin:8px;font:14px system-ui,sans-serif;color:#111827}
main{width:100%;max-width:1100px;margin:0 auto}
.fixture-controls{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.fixture-controls button{font:inherit;padding:6px 10px}
.fixture-grid-host{width:100%}
@media(max-width:400px){.fixture-grid-host{max-width:270px;margin:0 auto}}
`;

/** Prepare the actual installed public grid and CSS under existing TGZ custody. */
export async function prepareCalendarBrowser(consumer, readArchiveMember) {
    assert.equal(typeof readArchiveMember, 'function');
    const root = realpathSync(consumer);
    const directory = mkdtempSync(join(root, '.calendar-browser-'));
    try {
        const entry = join(directory, 'host.mjs');
        writeFileSync(entry, calendarBrowserSource);
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
        const cssMember = 'package/dist/esm/react/calendar.css';
        const css = readFileSync(
            join(installed, 'dist/esm/react/calendar.css')
        );
        assert.deepEqual(css, readArchiveMember(cssMember));
        const style = Buffer.concat([css, Buffer.from(fixtureStyle)]);
        const script = result.outputFiles[0].contents;
        const html = Buffer.from(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SDK Calendar foundations</title><link rel="stylesheet" href="/calendar.css"><main></main><script type="module" src="/calendar.js"></script>'
        );
        return {
            assets: new Map([
                ['/', html],
                ['/calendar.js', script],
                ['/calendar.css', style],
                ['/favicon.ico', Buffer.alloc(0)],
            ]),
            receipt: {
                harnessSha256: hash(readFileSync(new URL(import.meta.url))),
                hostSha256: hash(calendarBrowserSource),
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
        evidence.package = prepared.receipt;
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
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Installed public Calendar grid and CSS, trusted synthetic localhost interaction only; no complete rich-card surface, native host, provider, read receipt or hosted acceptance.';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            try {
                evidence.failureState = await page.evaluate(() =>
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
