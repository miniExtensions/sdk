import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const calendarTypedConsumer = `
import {createElement,type ComponentProps} from 'react';
import {CalendarMonthGrid} from '@miniextensions/sdk/react/calendar';
import {createCalendarRecordPickerController,createPortalCalendarController,parseCalendarFieldDate,getPortalCalendarDateKeys,type CalendarClock} from '@miniextensions/sdk/ui';
const clock:CalendarClock={utcDay:()=> '2026-09-01',localDay:()=> '2026-08-31',localMonth:()=> '2026-08',localToday:()=> '2026-08-31',clientUtcOffset:()=> -480};
const picker=createCalendarRecordPickerController({owner:{},isCurrent:()=>true,selectedRecordIds:['other'],visibleDay:'2026-09-01',visibleDayRecordIds:['one'],scheduleRead(request){const reset:boolean=request.resetOffset;void reset;return {type:'admitted'};},toggleRecord(id){const native:string=id;void native;return {type:'admitted'};}},clock);
const portal=createPortalCalendarController({owner:{},isCurrent:()=>true,retainedMonth:'2026-08',retainMonth(month){const retained:string=month;void retained;return {type:'admitted'};},readFirstPage(request){const forced:false=request.onlyFetchIfNotAlreadyFetched;void forced;return {type:'admitted'};}},clock);
const props:ComponentProps<typeof CalendarMonthGrid>={surface:'picker',selectedDay:picker.getSnapshot().selectedDay,onDayChange(day){picker.selectDay(day);},onFocusChange(day){picker.focusDay(day);},eventCounts:{'2026-09-01':10},locale:'en-US',localToday:{year:2026,month:8,day:31},labels:{calendar:'Calendar',previous:'Previous month',next:'Next month',events:'events'}};
createElement(CalendarMonthGrid,props);
createElement(CalendarMonthGrid,{...props,surface:'portal',isWide:true,selectedDay:portal.getSnapshot().selectedDay});
declare const field:Parameters<typeof parseCalendarFieldDate>[0]['field'];
const day:string|undefined=parseCalendarFieldDate({field,value:'2026-09-01T00:00:00+14:00'})?.format('YYYY-MM-DD');
const days:string[]=getPortalCalendarDateKeys({field,value:['2026-09-01'],fallbackClientUtcOffset:0});
// @ts-expect-error native Promise fulfillment is not semantic admission
createCalendarRecordPickerController({owner:{},isCurrent:()=>true,selectedRecordIds:[],visibleDay:'2026-09-01',visibleDayRecordIds:[],scheduleRead:async()=>({type:'admitted'}),toggleRecord:()=>({type:'admitted'})},clock);
// @ts-expect-error day selection is a canonical date string
createElement(CalendarMonthGrid,{...props,selectedDay:12});
// @ts-expect-error arbitrary layout modes do not redefine the native policies
createElement(CalendarMonthGrid,{...props,surface:'map'});
void day;void days;
`;

async function load(consumer, entry, format) {
    return format === 'cjs'
        ? consumer(`@miniextensions/sdk/${entry}`)
        : import(
              pathToFileURL(
                  consumer
                      .resolve(`@miniextensions/sdk/${entry}`)
                      .replace('/cjs/', '/esm/')
              ).href
          );
}

function props(surface = 'picker', isWide = false) {
    return {
        surface,
        isWide,
        selectedDay: '2026-02-15',
        locale: 'en-US',
        localToday: { year: 2026, month: 2, day: 14 },
        eventCounts: { '2026-02-15': 10 },
        labels: { calendar: 'Appointments', previous: 'Back', next: 'Forward' },
    };
}

async function server(directory, format) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const api = await load(consumer, 'react/calendar', format);
    let actions = 0;
    assert.equal(typeof document, 'undefined');
    const html = consumer('react-dom/server').renderToString(
        React.createElement(
            React.StrictMode,
            null,
            React.createElement(api.CalendarMonthGrid, {
                ...props(),
                onDayChange() {
                    actions++;
                },
                onFocusChange() {
                    actions++;
                },
            })
        )
    );
    assert.equal(actions, 0);
    assert(html.includes('9+'));
    assert(html.includes('Appointments'));
    assert.equal(typeof document, 'undefined');
    return { html, react: React.version };
}

async function installed(directory, format, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    assert.equal(
        consumer('calendar-react-aria/package.json').version,
        '3.53.0'
    );
    assert.equal(consumer('react-aria/package.json').version, '3.53.1');
    assert.equal(consumer('react-stately/package.json').version, '3.51.0');
    assert.equal(
        consumer('@internationalized/date/package.json').version,
        '3.12.4'
    );
    const policy = await load(consumer, 'ui', format);
    const field = {
        id: 'date',
        name: 'Date',
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config: {
            type: 'formula',
            options: {
                isValid: true,
                result: {
                    type: 'date',
                    options: {
                        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    },
                },
            },
        },
    };
    const value = '2026-09-01T00:00:00.000+14:00';
    assert.equal(
        policy.parseCalendarFieldDate({ field, value }).format('YYYY-MM-DD'),
        '2026-08-31'
    );
    assert.deepEqual(
        policy.getPortalCalendarDateKeys({
            field,
            value,
            fallbackClientUtcOffset: 0,
        }),
        ['2026-09-01']
    );
    const clock = {
        utcDay: () => '2026-09-01',
        localDay: () => '2026-08-31',
        localMonth: () => '2026-08',
        localToday: () => '2026-08-31',
        clientUtcOffset: () => -480,
    };
    const reads = [];
    const writes = [];
    let current = true;
    const pickerFrame = {
        owner: {},
        isCurrent: () => current,
        selectedRecordIds: ['off-day'],
        visibleDay: '2026-09-01',
        visibleDayRecordIds: ['visible'],
        scheduleRead(request) {
            reads.push(request);
            return { type: 'admitted' };
        },
        toggleRecord(id) {
            writes.push(id);
            return { type: 'admitted' };
        },
    };
    const picker = policy.createCalendarRecordPickerController(
        pickerFrame,
        clock
    );
    assert.equal(picker.getSnapshot().selectedDay, '2026-09-01');
    assert.equal(picker.getSnapshot().queryMonth, '2026-08');
    assert.equal(picker.focusDay('2026-10-01').type, 'admitted');
    assert.deepEqual(reads, [
        { month: '2026-10', resetOffset: true, clientUtcOffset: -480 },
    ]);
    assert.equal(picker.loadMore().type, 'admitted');
    assert.equal(reads[1].resetOffset, false);
    picker.updateFrame({ ...pickerFrame, visibleDay: '2026-10-01' });
    assert.equal(
        picker.changeSelection(new Set(['off-day', 'visible'])).type,
        'admitted'
    );
    assert.equal(picker.changeSelection('all').type, 'refused');
    assert.deepEqual(writes, ['visible']);
    const held = picker.captureActions();
    current = false;
    assert.equal(held.loadMore().type, 'refused');
    assert.equal(reads.length, 2);
    picker.dispose();

    const ssr = JSON.parse(
        execFileSync(
            process.execPath,
            [fileURLToPath(import.meta.url), '--ssr', directory, format],
            { encoding: 'utf8' }
        )
    );
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLButtonElement',
        'HTMLDivElement',
        'Element',
        'Node',
        'NodeFilter',
        'CustomEvent',
        'CSS',
        'MutationObserver',
        'ResizeObserver',
        'PointerEvent',
        'MouseEvent',
        'KeyboardEvent',
        'IS_REACT_ACT_ENVIRONMENT',
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys) {
        const value =
            key === 'IS_REACT_ACT_ENVIRONMENT'
                ? true
                : [
                        'getComputedStyle',
                        'requestAnimationFrame',
                        'cancelAnimationFrame',
                    ].includes(key)
                  ? window[key].bind(window)
                  : window[key];
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    const React = consumer('react');
    assert.equal(React.version, ssr.react);
    assert.equal(consumer('react-dom/package.json').version, React.version);
    const api = await load(consumer, 'react/calendar', format);
    const css = readFileSync(
        consumer.resolve('@miniextensions/sdk/react/calendar.css'),
        'utf8'
    );
    assert(css.includes('.mx-sdk-calendar__grid'));
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const host = document.createElement('div');
    host.innerHTML = ssr.html;
    document.body.append(host);
    let events = 0;
    let options = props();
    let root;
    const recoverable = [];
    const element = () =>
        React.createElement(
            React.StrictMode,
            null,
            React.createElement(api.CalendarMonthGrid, {
                ...options,
                onDayChange() {
                    events++;
                },
                onFocusChange() {
                    events++;
                },
            })
        );
    try {
        const { hydrateRoot } = consumer('react-dom/client');
        await React.act(async () => {
            root = hydrateRoot(host, element(), {
                onRecoverableError(error) {
                    recoverable.push(error);
                },
            });
        });
        assert.deepEqual(recoverable, []);
        assert.equal(host.querySelectorAll('tbody tr').length, 6);
        assert.equal(
            host.querySelectorAll('.mx-sdk-calendar__badge').length,
            1
        );
        assert.equal(
            host.querySelector('.mx-sdk-calendar__badge').textContent,
            '9+'
        );
        assert.equal(
            host.querySelector(
                '[data-date="2026-02-15"] [data-selected=true]'
            ) != null,
            true
        );
        assert.equal(events, 0);
        options = props('portal', false);
        await React.act(async () => root.render(element()));
        assert.equal(host.querySelectorAll('tbody tr').length, 4);
        assert.equal(host.querySelectorAll('.mx-sdk-calendar__dot').length, 10);
        options = props('portal', true);
        await React.act(async () => root.render(element()));
        assert.equal(host.querySelector('[data-wide=true]') != null, true);
        assert.equal(host.querySelectorAll('.mx-sdk-calendar__dot').length, 0);
        options = props('portal', false);
        await React.act(async () => root.render(element()));
        assert.equal(
            host.querySelector(
                '[data-date="2026-02-15"] [data-selected=true]'
            ) != null,
            true
        );
        assert.equal(
            events,
            0,
            'presentation switches must not emit focus/day intents'
        );
        return {
            react: React.version,
            format,
            groups: 3,
            hydration: true,
            scope: 'Installed Calendar foundations only; no complete rich-card or native acceptance.',
        };
    } finally {
        if (root) await React.act(async () => root.unmount());
        for (let index = 0; index < keys.length; index++) {
            if (originals[index])
                Object.defineProperty(
                    globalThis,
                    keys[index],
                    originals[index]
                );
            else Reflect.deleteProperty(globalThis, keys[index]);
        }
        await window.happyDOM.close();
    }
}

export function checkCalendarReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const temporary = mkdtempSync(join(tmpdir(), 'sdk-calendar-'));
    const versions = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const directory = join(temporary, version.react);
            mkdirSync(directory);
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                    },
                })
            );
            execFileSync(
                'npm',
                [
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
                ],
                { cwd: directory, stdio: 'inherit' }
            );
            for (const extension of ['mts', 'cts']) {
                const name = `calendar.${extension}`;
                writeFileSync(join(directory, name), calendarTypedConsumer);
                execFileSync(
                    process.execPath,
                    [
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
                    ],
                    { cwd: directory, stdio: 'inherit' }
                );
            }
            const profiles = [];
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    execFileSync(
                        process.execPath,
                        [
                            fileURLToPath(import.meta.url),
                            '--installed',
                            directory,
                            format,
                            happyDomModulePath,
                        ],
                        { cwd: directory, encoding: 'utf8' }
                    )
                );
                assert.equal(result.react, version.react);
                assert.equal(result.groups, 3);
                profiles.push(result);
            }
            versions.push({ react: version.react, profiles });
            console.log(
                `Installed Calendar foundations React${version.react}: ESM/CJS, strict declarations, CSS, cold SSR/hydration/StrictMode, projection and controller checks passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[2] === '--ssr')
    console.log(JSON.stringify(await server(process.argv[3], process.argv[4])));
if (process.argv[2] === '--installed')
    console.log(
        JSON.stringify(
            await installed(process.argv[3], process.argv[4], process.argv[5])
        )
    );
