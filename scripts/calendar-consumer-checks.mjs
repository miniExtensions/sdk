import assert from 'node:assert/strict';
import { calendarCompleteStyleAssets } from './calendar-complete-style-assets.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const calendarTypedConsumer = `
import {createElement,type ComponentProps} from 'react';
import {CalendarMonthGrid,CalendarRecordPicker,PortalCalendar,type PortalCalendarVisibleRecords} from '@miniextensions/sdk/react/calendar';
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
declare const pickerFrame:ComponentProps<typeof CalendarRecordPicker>['frame'];
declare const portalFrame:ComponentProps<typeof PortalCalendar>['frame'];
createElement(CalendarRecordPicker,{frame:pickerFrame,clock,locale:'en-US'});
createElement(PortalCalendar,{frame:portalFrame,clock,locale:'en-US',isWide:true});
createElement(PortalCalendar,{frame:portalFrame,isWide:false,registerVisibleRecords(presentation){const ids:readonly string[]=presentation.recordIds;const current:boolean=presentation.isCurrent();return ()=>{void ids;void current;};}});
declare const visiblePresentation:PortalCalendarVisibleRecords;
// @ts-expect-error committed membership is a readonly array
visiblePresentation.recordIds.push('native-child');
// @ts-expect-error a committed descriptor cannot replace its membership
visiblePresentation.recordIds=[];
// @ts-expect-error registration must return its synchronous disposer
createElement(PortalCalendar,{frame:portalFrame,isWide:false,registerVisibleRecords:()=>{}});
// @ts-expect-error currentness is a synchronous boolean observation
const invalidVisiblePresentation:PortalCalendarVisibleRecords={recordIds:[],isCurrent:async()=>true};
// @ts-expect-error full surfaces do not accept a native JSX card renderer
createElement(CalendarRecordPicker,{frame:pickerFrame,renderRecord:()=>null});
// @ts-expect-error responsive mode is an explicit host snapshot
createElement(PortalCalendar,{frame:portalFrame});
const {presentationOwner,...withoutDisplayOwner}=portalFrame;
// @ts-expect-error stable control ownership does not replace accepted display-frame ownership
createElement(PortalCalendar,{frame:withoutDisplayOwner,isWide:true});
void day;void days;void presentationOwner;void invalidVisiblePresentation;
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

function portalFixture() {
    const reads = [],
        opens = [],
        removals = [];
    let controlCurrent = true,
        presentationCurrent = true,
        retirePresentationOnRetain = false;
    let beforePresentationRead;
    const admitted = () => ({ type: 'admitted' });
    const clock = {
        utcDay: () => '2026-02-15',
        localDay: () => '2026-02-15',
        localMonth: () => '2026-02',
        localToday: () => '2026-02-14',
        clientUtcOffset: () => 0,
    };
    const frame = Object.freeze({
        control: Object.freeze({
            owner: Object.freeze({}),
            isCurrent: () => controlCurrent,
            retainMonth(month) {
                reads.push(['retain', month]);
                if (retirePresentationOnRetain) presentationCurrent = false;
                return admitted();
            },
            readFirstPage(request) {
                reads.push(['read', request]);
                return admitted();
            },
        }),
        presentationOwner: Object.freeze({
            token: Object.freeze({}),
            isCurrent() {
                const before = beforePresentationRead;
                beforePresentationRead = undefined;
                before?.();
                return presentationCurrent;
            },
        }),
        retainedMonth: '2026-02',
        records: Object.freeze([
            Object.freeze({
                id: 'one',
                fields: Object.freeze({ date: '2026-02-15' }),
                display: Object.freeze({
                    status: 'present',
                    primary: 'Literal <appointment>',
                    subtitle: 'Native compact subtitle',
                }),
            }),
        ]),
        dateField: {
            id: 'date',
            name: 'Date',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'date',
                options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
            },
        },
        fallbackClientUtcOffset: 0,
        shouldShowToTheSide: true,
        recordActions: Object.freeze([
            {
                recordId: 'one',
                open(request) {
                    opens.push(request);
                    return admitted();
                },
                remove() {
                    removals.push('one');
                    return admitted();
                },
            },
        ]),
        status: 'ready',
    });
    return {
        frame,
        clock,
        reads,
        opens,
        removals,
        isPresentationCurrent: () => presentationCurrent,
        beforeNextPresentationRead(callback) {
            beforePresentationRead = callback;
        },
        retireDisplay() {
            presentationCurrent = false;
        },
        retireControl() {
            controlCurrent = false;
        },
        retireDisplayOnRetain() {
            retirePresentationOnRetain = true;
        },
    };
}

function pickerFixture() {
    const reads = [],
        attempts = [],
        accepted = [];
    const canonical = ['off-day'];
    let controlCurrent = true,
        displayCurrent = true,
        displayOwner = {},
        capped = false,
        refuseRead = false;
    const clock = {
        utcDay: () => '2026-02-15',
        localDay: () => '2026-02-15',
        localMonth: () => '2026-02',
        localToday: () => '2026-02-14',
        clientUtcOffset: () => 0,
    };
    const date = (id) => ({
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'date',
            options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
        },
    });
    const records = Object.freeze([
        { id: 'one', fields: { start: '2026-02-15', end: '2026-02-15' } },
        { id: 'two', fields: { start: '2026-02-15', end: '2026-02-15' } },
        { id: 'off-day', fields: { start: '2026-02-21', end: '2026-02-21' } },
    ]);
    const presentationByRecordId = Object.freeze({
        one: {
            type: 'list',
            primary: 'Rich appointment',
            showPreviewFieldTitle: true,
            details: [
                {
                    key: 'notes',
                    title: 'Notes',
                    leaf: {
                        kind: 'text',
                        display: {
                            value: 'Rich https://example.test/calendar',
                            language: 'en',
                            layout: 'linked-list',
                        },
                    },
                },
                {
                    key: 'tags',
                    title: 'Tags',
                    leaf: { kind: 'pills', items: [{ label: 'Accepted tag' }] },
                },
            ],
        },
        two: {
            type: 'calendar',
            primary: 'Second appointment',
            subtitle: 'Native compact detail',
        },
        'off-day': {
            type: 'calendar',
            primary: 'Off-day selection',
            subtitle: '',
        },
    });
    const control = Object.freeze({
        owner: Object.freeze({}),
        isCurrent: () => controlCurrent,
        scheduleRead(request) {
            reads.push(request);
            return refuseRead
                ? { type: 'refused', reason: 'native-read-refusal' }
                : { type: 'admitted' };
        },
    });
    const makeFrame = (patch = {}) => {
        const expected = displayOwner;
        return Object.freeze({
            control,
            presentationOwner: Object.freeze({
                owner: expected,
                isCurrent: () => displayCurrent && displayOwner === expected,
            }),
            records,
            startField: date('start'),
            endField: date('end'),
            selectedRecordIds: Object.freeze([...canonical]),
            presentationByRecordId,
            selectionEnabled: true,
            errorMessage: null,
            isLoading: false,
            isLoadingMore: false,
            canLoadMore: true,
            toggleRecord(id) {
                attempts.push(id);
                if (
                    !controlCurrent ||
                    !displayCurrent ||
                    displayOwner !== expected
                )
                    return { type: 'refused', reason: 'stale-host' };
                if (capped && !canonical.includes(id))
                    return { type: 'refused', reason: 'native-cap' };
                const index = canonical.indexOf(id);
                if (index >= 0) canonical.splice(index, 1);
                else canonical.push(id);
                accepted.push(id);
                return { type: 'admitted' };
            },
            ...patch,
        });
    };
    return {
        clock,
        reads,
        attempts,
        accepted,
        canonical,
        initialFrame: makeFrame(),
        publish(patch) {
            displayOwner = {};
            return makeFrame(patch);
        },
        cap() {
            capped = true;
        },
        refuseReads() {
            refuseRead = true;
        },
        retireDisplay() {
            displayCurrent = false;
        },
        retireControl() {
            controlCurrent = false;
        },
    };
}

function createPortalRegistrationHost(React, PortalCalendar, register) {
    return function PortalRegistrationHost(options) {
        const [, refresh] = React.useState(0);
        const registerVisibleRecords = React.useCallback((presentation) => {
            const dispose = register(presentation);
            refresh((revision) => revision + 1);
            return () => {
                dispose();
                refresh((revision) => revision + 1);
            };
        }, []);
        return React.createElement(PortalCalendar, {
            ...options,
            frame: {
                ...options.frame,
                presentationOwner: { ...options.frame.presentationOwner },
                recordActions: options.frame.recordActions.map((actions) => ({
                    ...actions,
                })),
            },
            registerVisibleRecords,
        });
    };
}

async function server(directory, format, surface = 'grid') {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const api = await load(consumer, 'react/calendar', format);
    let actions = 0;
    let visibilityRegistrations = 0;
    let visibilityDisposals = 0;
    const PortalRegistrationHost = createPortalRegistrationHost(
        React,
        api.PortalCalendar,
        () => {
            visibilityRegistrations++;
            return () => visibilityDisposals++;
        }
    );
    assert.equal(typeof document, 'undefined');
    const fixture =
        surface === 'portal'
            ? portalFixture()
            : surface === 'picker'
              ? pickerFixture()
              : null;
    const content =
        surface === 'portal'
            ? React.createElement(PortalRegistrationHost, {
                  frame: fixture.frame,
                  clock: fixture.clock,
                  locale: 'en-US',
                  isWide: true,
              })
            : surface === 'picker'
              ? React.createElement(api.CalendarRecordPicker, {
                    frame: fixture.initialFrame,
                    clock: fixture.clock,
                    locale: 'en-US',
                })
              : React.createElement(api.CalendarMonthGrid, {
                    ...props(),
                    onDayChange() {
                        actions++;
                    },
                    onFocusChange() {
                        actions++;
                    },
                });
    const html = consumer('react-dom/server').renderToString(
        React.createElement(React.StrictMode, null, content)
    );
    assert.equal(actions, 0);
    if (surface === 'portal') {
        assert(html.includes('Literal &lt;appointment&gt;'));
        assert(html.includes('Native compact subtitle'));
        assert.deepEqual(fixture.reads, []);
        assert.deepEqual(fixture.opens, []);
        assert.deepEqual(fixture.removals, []);
        assert.equal(visibilityRegistrations, 0);
        assert.equal(visibilityDisposals, 0);
    } else if (surface === 'picker') {
        assert(html.includes('Rich appointment'));
        assert(html.includes('https://example.test/calendar'));
        assert(html.includes('mx-sdk-finder-pill'));
        assert(!html.includes('Off-day selection'));
        assert.deepEqual(fixture.reads, []);
        assert.deepEqual(fixture.attempts, []);
    } else {
        assert(html.includes('9+'));
        assert(html.includes('Appointments'));
    }
    assert.equal(typeof document, 'undefined');
    return {
        html,
        react: React.version,
        visibilityRegistrations,
        visibilityDisposals,
    };
}

async function installed(directory, format, happyDomModulePath, archivePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    assert.equal(typeof document, 'undefined');
    // Match the universal SSR-to-hydration lifetime. Cold browser imports are
    // separately qualified in Chromium, which supplies real ScreenOrientation.
    const api = await load(consumer, 'react/calendar', format);
    const calendarEntry = consumer
        .resolve('@miniextensions/sdk/react/calendar')
        .replace('/cjs/', `/${format}/`);
    const calendarDirectory = dirname(dirname(calendarEntry));
    const vendor = JSON.parse(
        readFileSync(join(calendarDirectory, 'calendar-vendor.json'), 'utf8')
    );
    const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
    assert.equal(
        sha256(readFileSync(join(calendarDirectory, 'CalendarRuntime.js'))),
        vendor.sha256
    );
    assert.equal(
        sha256(readFileSync(join(calendarDirectory, 'calendar.LICENSES.txt'))),
        vendor.licensesSha256
    );
    for (const [name, version] of [
        ['react-aria', '3.53.0'],
        ['react-stately', '3.51.0'],
        ['@internationalized/date', '3.12.4'],
    ])
        assert.equal(
            vendor.packages.find((value) => value.name === name)?.version,
            version
        );
    assert(
        vendor.packages.every(
            (value) => !['react', 'react-dom'].includes(value.name)
        )
    );
    assert.throws(() => consumer.resolve('calendar-react-aria'), {
        code: 'MODULE_NOT_FOUND',
    });
    assert.equal(
        realpathSync(
            consumer.resolve('@miniextensions/sdk/react/calendar-complete.css')
        ),
        realpathSync(
            join(
                directory,
                'node_modules/@miniextensions/sdk/dist/esm/react/calendar-complete.css'
            )
        )
    );
    const completeStyles = calendarCompleteStyleAssets(
        join(directory, 'node_modules/@miniextensions/sdk'),
        (member) =>
            execFileSync('tar', ['-xzOf', archivePath, member], {
                maxBuffer: 1024 * 1024,
            })
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
    const { Window: CSSWindow } = createRequire(import.meta.url)(
        happyDomModulePath
    );
    const cssWindow = new CSSWindow();
    const { JSDOM } = consumer('jsdom');
    assert.equal(consumer('jsdom/package.json').version, '20.0.3');
    // One real DOM implementation for the whole mounted lifecycle. React Aria
    // retains its live-announcer node across component mounts in this process.
    const window = new JSDOM(
        '<!doctype html><html><head></head><body></body></html>',
        {
            url: 'http://localhost/',
            pretendToBeVisual: true,
        }
    ).window;
    // JSDOM implements the standards HTML parser but not CSS.escape. Reuse the
    // existing harness's actual CSS namespace without changing browser behavior.
    Object.defineProperty(window, 'CSS', {
        configurable: true,
        value: cssWindow.CSS,
    });
    const keys = [
        'window',
        'document',
        'navigator',
        'Window',
        'Document',
        'DocumentFragment',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
        'HTMLTextAreaElement',
        'HTMLAnchorElement',
        'HTMLButtonElement',
        'HTMLDivElement',
        'SVGElement',
        'ShadowRoot',
        'Element',
        'Node',
        'NodeFilter',
        'Event',
        'FocusEvent',
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
                : key === 'Window'
                  ? window.Window
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
    const days = [];
    const focuses = [];
    let options = props();
    let root;
    const recoverable = [];
    const element = () =>
        React.createElement(
            React.StrictMode,
            null,
            React.createElement(api.CalendarMonthGrid, {
                ...options,
                onDayChange(day) {
                    events++;
                    days.push(day);
                    options = { ...options, selectedDay: day };
                    root.render(element());
                },
                onFocusChange(day) {
                    events++;
                    focuses.push(day);
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
        const day = (date) => {
            const result = host.querySelector(
                `[data-date="${date}"] .mx-sdk-calendar__day`
            );
            assert(result);
            return result;
        };
        await React.act(async () =>
            day('2026-02-16').dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            )
        );
        assert.deepEqual(days, ['2026-02-16']);
        assert.equal(day('2026-02-16').getAttribute('data-selected'), 'true');
        const beforePortalArrow = [...focuses];
        await React.act(async () =>
            day('2026-02-16').dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.deepEqual(focuses, beforePortalArrow);
        options = { ...options, surface: 'picker' };
        await React.act(async () => root.render(element()));
        await React.act(async () =>
            day('2026-02-16').dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'ArrowRight',
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(focuses.at(-1), '2026-02-17');
        await React.act(async () =>
            host.querySelector('button[aria-label="Forward"]').dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            )
        );
        assert(focuses.at(-1).startsWith('2026-03'));
        assert.deepEqual(days, ['2026-02-16']);
        await React.act(async () => root.unmount());
        root = undefined;
        // The same standards parser and Node implementation serve grid,
        // Portal and picker SSR/hydration; exact literal names remain unchanged.
        const completePortal = portalFixture();
        let portalProps = {
            frame: completePortal.frame,
            clock: completePortal.clock,
            locale: 'en-US',
            isWide: true,
        };
        const visiblePublications = [];
        const visibleDisposals = [];
        let registrationTransitionStart = 0;
        const beginRegistrationTransition = () => {
            registrationTransitionStart = visiblePublications.length;
        };
        // A real host registration rerenders its parent, which may reconstruct
        // frame/action wrappers. Keep the admitted immutable inputs unchanged.
        const PortalRegistrationHost = createPortalRegistrationHost(
            React,
            api.PortalCalendar,
            (presentation) => {
                assert.equal(presentation.isCurrent(), true);
                assert(Object.isFrozen(presentation));
                assert(Object.isFrozen(presentation.recordIds));
                assert.deepEqual(
                    [...presentation.recordIds].sort(),
                    [
                        ...new Set(
                            [
                                ...host.querySelectorAll(
                                    'article[data-record-id]'
                                ),
                            ].map((node) => node.getAttribute('data-record-id'))
                        ),
                    ].sort()
                );
                visiblePublications.push(presentation);
                assert(
                    visiblePublications.length - registrationTransitionStart <=
                        2,
                    'one host transition must settle within its StrictMode replay'
                );
                return () => {
                    assert.equal(presentation.isCurrent(), false);
                    visibleDisposals.push(presentation);
                };
            }
        );
        const visiblePresentation = () => visiblePublications.at(-1);
        const portalElement = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(PortalRegistrationHost, portalProps)
            );
        const portalServer = JSON.parse(
            execFileSync(
                process.execPath,
                [
                    fileURLToPath(import.meta.url),
                    '--ssr',
                    directory,
                    format,
                    'portal',
                ],
                { encoding: 'utf8' }
            )
        );
        assert.equal(
            portalServer.visibilityRegistrations,
            0,
            'cold SSR must not register child membership'
        );
        assert.equal(
            portalServer.visibilityDisposals,
            0,
            'cold SSR has no child membership disposer'
        );
        host.innerHTML = portalServer.html;
        const originalPortalTable = host.querySelector('table');
        const originalPortalCard = host.querySelector(
            'article[data-record-id="one"]'
        );
        assert(originalPortalTable && originalPortalCard);
        assert.equal(
            originalPortalCard
                .querySelector('button[aria-label^="Open record:"]')
                .getAttribute('aria-label'),
            'Open record: Literal <appointment>'
        );
        recoverable.length = 0;
        await React.act(async () => {
            root = hydrateRoot(host, portalElement(), {
                onRecoverableError(error) {
                    recoverable.push(error);
                },
            });
        });
        assert.deepEqual(recoverable, []);
        assert.equal(
            host.querySelector('table'),
            originalPortalTable,
            'hydrate the original parsed Portal table'
        );
        assert.equal(
            host.querySelector('article[data-record-id="one"]'),
            originalPortalCard,
            'hydrate the original literal compact card'
        );
        assert.deepEqual(completePortal.reads, []);
        assert.deepEqual(completePortal.opens, []);
        assert.deepEqual(completePortal.removals, []);
        assert(
            visiblePublications.length >= 1,
            'hydration registers a committed presentation'
        );
        // React versions may replay hydration effects differently. Every
        // predecessor must retire, and the one current descriptor must work.
        for (const predecessor of visiblePublications.slice(0, -1))
            assert.equal(predecessor.isCurrent(), false);
        assert.deepEqual(visiblePresentation().recordIds, ['one']);
        const heldWidePresentation = visiblePresentation();
        const settledRegistrations = visiblePublications.length;
        portalProps = { ...portalProps };
        beginRegistrationTransition();
        await React.act(async () => root.render(portalElement()));
        assert.equal(
            visiblePublications.length,
            settledRegistrations,
            'equivalent host wrappers must not republish or loop'
        );
        assert.equal(heldWidePresentation.isCurrent(), true);
        completePortal.beforeNextPresentationRead(() => {
            portalProps = { ...portalProps, frame: { ...portalProps.frame } };
            consumer('react-dom').flushSync(() => root.render(portalElement()));
        });
        await React.act(async () =>
            assert.equal(heldWidePresentation.isCurrent(), true)
        );
        assert.equal(visiblePublications.length, settledRegistrations);
        assert.equal(
            visiblePresentation(),
            heldWidePresentation,
            'an equivalent synchronous guard publication preserves the descriptor'
        );
        assert.equal(heldWidePresentation.isCurrent(), true);
        assert.equal(
            host.querySelectorAll('article[data-record-id="one"]').length,
            1
        );
        assert(host.textContent.includes('Literal <appointment>'));
        assert.equal(
            host.querySelector('appointment'),
            null,
            'accepted compact primary stays literal'
        );
        const click = async (selector) => {
            const target = host.querySelector(selector);
            assert(target, selector);
            beginRegistrationTransition();
            await React.act(async () => target.click());
        };
        await click('button[aria-label^="Open record:"]');
        assert.deepEqual(completePortal.opens, [{ shouldShowToTheSide: true }]);
        portalProps = { ...portalProps, isWide: false };
        beginRegistrationTransition();
        await React.act(async () => root.render(portalElement()));
        assert.equal(heldWidePresentation.isCurrent(), false);
        assert.deepEqual(visiblePresentation().recordIds, ['one']);
        assert.equal(
            host.querySelector(
                '[data-date="2026-02-15"] [data-selected=true]'
            ) != null,
            true
        );
        await click('button[aria-label^="Open record:"]');
        assert.deepEqual(completePortal.opens, [
            { shouldShowToTheSide: true },
            { shouldShowToTheSide: false },
        ]);
        const heldNarrowPresentation = visiblePresentation();
        await click('[data-date="2026-02-16"] .mx-sdk-calendar__day');
        assert.equal(heldNarrowPresentation.isCurrent(), false);
        assert.deepEqual(visiblePresentation().recordIds, []);
        assert.equal(
            host.querySelector('article[data-record-id="one"]'),
            null,
            'off-day native children have no visible membership'
        );
        const emptyDayPresentation = visiblePresentation();
        await click('[data-date="2026-02-15"] .mx-sdk-calendar__day');
        assert.equal(emptyDayPresentation.isCurrent(), false);
        assert.equal(
            heldNarrowPresentation.isCurrent(),
            false,
            'day ABA cannot revive the old registration'
        );
        assert.deepEqual(visiblePresentation().recordIds, ['one']);
        portalProps = { ...portalProps, isWide: true };
        beginRegistrationTransition();
        await React.act(async () => root.render(portalElement()));
        assert.equal(
            heldWidePresentation.isCurrent(),
            false,
            'width ABA cannot revive the old registration'
        );
        const spanningRecords = Array.from({ length: 90 }, (_, index) => {
            const date = new Date(Date.UTC(2026, 0, index + 1))
                .toISOString()
                .slice(0, 10);
            return {
                id: date,
                fields: { date },
                display: { status: 'present', primary: date },
            };
        });
        const localeFrame = {
            ...completePortal.frame,
            records: spanningRecords,
            recordActions: [],
        };
        for (const locale of [
            'en-US-u-ca-islamic-umalqura',
            'ar-SA-u-ca-islamic-umalqura',
        ]) {
            portalProps = { ...portalProps, frame: localeFrame, locale };
            beginRegistrationTransition();
            await React.act(async () => root.render(portalElement()));
            const mounted = [
                ...host.querySelectorAll('article[data-record-id]'),
            ].map((node) => node.getAttribute('data-record-id'));
            assert.equal(visiblePresentation().isCurrent(), true);
            assert.deepEqual(
                [...visiblePresentation().recordIds].sort(),
                [...new Set(mounted)].sort()
            );
            assert(
                new Set(mounted.map((id) => id.slice(0, 7))).size > 1,
                `${locale} actual mounted month spans ISO months`
            );
        }
        const heldLocalePresentation = visiblePresentation();
        beginRegistrationTransition();
        completePortal.beforeNextPresentationRead(() => {
            portalProps = {
                ...portalProps,
                frame: { ...localeFrame, records: [] },
            };
            consumer('react-dom').flushSync(() => root.render(portalElement()));
        });
        await React.act(async () =>
            assert.equal(heldLocalePresentation.isCurrent(), false)
        );
        assert.notEqual(
            visiblePresentation(),
            heldLocalePresentation,
            'a real synchronous record lease change retires the predecessor'
        );
        assert.deepEqual(visiblePresentation().recordIds, []);
        assert.equal(visiblePresentation().isCurrent(), true);
        portalProps = {
            ...portalProps,
            frame: completePortal.frame,
            locale: 'en-US',
        };
        beginRegistrationTransition();
        await React.act(async () => root.render(portalElement()));
        assert.deepEqual(
            completePortal.reads,
            [],
            'responsive card changes must not issue a read'
        );
        await click('button[aria-label^="Remove record:"]');
        assert.deepEqual(completePortal.removals, ['one']);
        const readonlyFrame = Object.freeze({
            ...completePortal.frame,
            presentationOwner: {
                token: {},
                isCurrent: completePortal.isPresentationCurrent,
            },
            recordActions: [
                {
                    recordId: 'one',
                    remove() {
                        completePortal.removals.push('one');
                        return { type: 'admitted' };
                    },
                },
            ],
        });
        portalProps = { ...portalProps, frame: readonlyFrame };
        beginRegistrationTransition();
        await React.act(async () => root.render(portalElement()));
        assert.equal(
            host.querySelector('button[aria-label^="Open record:"]'),
            null,
            'display data never grants an absent open action'
        );
        await click('button[aria-label^="Remove record:"]');
        assert.deepEqual(completePortal.removals, ['one', 'one']);
        completePortal.retireDisplayOnRetain();
        await click('button[aria-label="Next"]');
        assert.deepEqual(
            completePortal.reads,
            [
                ['retain', '2026-03'],
                [
                    'read',
                    { type: 'firstPage', onlyFetchIfNotAlreadyFetched: false },
                ],
            ],
            'display retirement during retain cannot cancel the one ordered control-scoped forced read'
        );
        assert.deepEqual(
            completePortal.removals,
            ['one', 'one'],
            'calendar focus performs no record write'
        );
        await React.act(async () => root.unmount());
        root = undefined;
        assert(
            visiblePublications.every(
                (presentation) => !presentation.isCurrent()
            )
        );
        assert.deepEqual(
            visibleDisposals,
            visiblePublications,
            'all committed registrations dispose after retirement'
        );
        const completePicker = pickerFixture();
        let pickerProps = {
            frame: completePicker.initialFrame,
            clock: completePicker.clock,
            locale: 'en-US',
        };
        const pickerElement = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.CalendarRecordPicker, pickerProps)
            );
        const pickerServer = JSON.parse(
            execFileSync(
                process.execPath,
                [
                    fileURLToPath(import.meta.url),
                    '--ssr',
                    directory,
                    format,
                    'picker',
                ],
                { encoding: 'utf8' }
            )
        );
        host.innerHTML = pickerServer.html;
        recoverable.length = 0;
        await React.act(async () => {
            root = hydrateRoot(host, pickerElement(), {
                onRecoverableError(error) {
                    recoverable.push(error);
                },
            });
        });
        assert.deepEqual(recoverable, []);
        assert.deepEqual(completePicker.reads, []);
        assert.deepEqual(completePicker.attempts, []);
        const list = () => {
            const value = host.querySelector(
                '.mx-sdk-calendar-picker__records'
            );
            assert(value);
            return value;
        };
        const optionsForPicker = () => list().querySelectorAll('[role=option]');
        assert.equal(optionsForPicker().length, 2);
        assert.equal(
            list().querySelector('a[href="https://example.test/calendar"]') !=
                null,
            true,
            'actual shared text leaf retains link presentation'
        );
        assert.equal(
            list().querySelector('.mx-sdk-finder-pill').textContent,
            'Accepted tag'
        );
        await React.act(async () =>
            optionsForPicker()[0].dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            )
        );
        assert.deepEqual(completePicker.accepted, ['one']);
        assert.deepEqual(
            completePicker.canonical,
            ['off-day', 'one'],
            'one visible semantic toggle preserves global off-day selection'
        );
        pickerProps = { ...pickerProps, frame: completePicker.publish() };
        await React.act(async () => root.render(pickerElement()));
        assert.equal(
            optionsForPicker()[0].getAttribute('aria-selected'),
            'true'
        );
        const beforeBulk = [...completePicker.attempts];
        await React.act(async () =>
            list().dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'a',
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.deepEqual(
            completePicker.attempts,
            beforeBulk,
            'bulk select cannot reach the native semantic writer'
        );
        completePicker.cap();
        await React.act(async () =>
            optionsForPicker()[1].dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            )
        );
        assert.deepEqual(completePicker.attempts, ['one', 'two']);
        assert.deepEqual(completePicker.accepted, ['one']);
        assert.deepEqual(
            completePicker.canonical,
            ['off-day', 'one'],
            'current native cap refusal remains authoritative'
        );
        await click('.mx-sdk-calendar-picker__more');
        assert.deepEqual(completePicker.reads, [
            { month: '2026-02', resetOffset: false, clientUtcOffset: 0 },
        ]);
        completePicker.refuseReads();
        await click('.mx-sdk-calendar-picker__more');
        assert.equal(completePicker.reads.length, 2);
        assert.deepEqual(
            completePicker.canonical,
            ['off-day', 'one'],
            'read admission refusal cannot write record membership'
        );
        pickerProps = {
            ...pickerProps,
            frame: completePicker.publish({
                errorMessage: 'Calendar native error',
                isLoading: true,
            }),
        };
        await React.act(async () => root.render(pickerElement()));
        assert.equal(
            host.querySelector('.mx-sdk-calendar-picker__list [role=alert]')
                .textContent,
            'Calendar native error'
        );
        assert.equal(
            host.querySelector('.mx-sdk-calendar-picker__list [role=status]'),
            null,
            'picker error precedes loading'
        );
        pickerProps = {
            ...pickerProps,
            frame: completePicker.publish({ selectionEnabled: false }),
        };
        await React.act(async () => root.render(pickerElement()));
        const beforeDisabled = [...completePicker.attempts];
        await React.act(async () =>
            optionsForPicker()[1].dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            )
        );
        assert.deepEqual(completePicker.attempts, beforeDisabled);
        completePicker.retireDisplay();
        await React.act(async () =>
            optionsForPicker()[0].dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            )
        );
        assert.deepEqual(
            completePicker.attempts,
            beforeDisabled,
            'retired presentation cannot grant a held row action'
        );
        await React.act(async () => root.unmount());
        root = undefined;
        return {
            react: React.version,
            format,
            groups: 5,
            completeStyleInputs: completeStyles.inputs.length,
            hydration: true,
            visibleRecordRegistration: true,
            scope: 'Installed complete Calendar picker/Portal composition and shared rich leaves; synthetic host ports only, no native or hosted acceptance.',
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
        window.close();
        await cssWindow.happyDOM.close();
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
                            archivePath,
                        ],
                        { cwd: directory, encoding: 'utf8' }
                    )
                );
                assert.equal(result.react, version.react);
                assert.equal(result.groups, 5);
                assert.equal(result.visibleRecordRegistration, true);
                profiles.push(result);
            }
            versions.push({ react: version.react, profiles });
            console.log(
                `Installed Calendar surfaces React${version.react}: ESM/CJS, strict declarations, owning CSS, cold SSR/hydration/StrictMode, real picker/Portal, projection and controller checks passed; synthetic host ports only.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[2] === '--ssr')
    console.log(
        JSON.stringify(
            await server(process.argv[3], process.argv[4], process.argv[5])
        )
    );
if (process.argv[2] === '--installed')
    console.log(
        JSON.stringify(
            await installed(
                process.argv[3],
                process.argv[4],
                process.argv[5],
                process.argv[6]
            )
        )
    );
