import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const formats = ['esm', 'cjs'];
const within = (root, path) => {
    const part = relative(root, path);
    return part === '' || (!part.startsWith('..') && !isAbsolute(part));
};

function packageRoot(entry, name) {
    for (let path = dirname(entry); ; path = dirname(path)) {
        try {
            const manifest = JSON.parse(
                readFileSync(join(path, 'package.json'))
            );
            if (manifest.name === name) return realpathSync(path);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        assert.notEqual(dirname(path), path, `Installed ${name} root missing`);
    }
}

const fixtureStyle = String.raw`body {margin:16px;font-family:Arial,sans-serif;color:#111827}
.fixture-chart-host {width:640px;max-width:100%}
.fixture-chart-host.narrow {width:360px}
#sibling-host {position:relative;width:240px;margin-top:24px}
`;

function browserSource(format) {
    const imports =
        format === 'esm'
            ? `import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompletePortalChart} from '@miniextensions/sdk/react';
import {Chart as ChartJS} from 'chart.js';\n`
            : `const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {CompletePortalChart} = require('@miniextensions/sdk/react');
const {Chart:ChartJS} = require('chart.js');\n`;
    return (
        imports +
        `const format = ${JSON.stringify(format)};\n` +
        String.raw`
// This is a public installed-package consumer. There is no provider, client,
// network response, canvas mock, private Chart field, or replacement adapter.
const state = {errors:[],requests:0,submits:0,revision:0,committed:0,
    strictMounts:0,strictCleanups:0,disposed:false};
window.addEventListener('error',(event) => state.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection',(event) => state.errors.push(String(event.reason)));
window.fetch = async () => {state.requests++;throw Error('Chart fixture cannot fetch');};
XMLHttpRequest.prototype.open = function () {state.requests++;throw Error('Chart fixture cannot use XHR');};

// Observe effective DOM listener registrations through the public EventTarget
// methods. Only Chart's ordinary canvas event types and window resize count;
// React's delegated root listeners and unrelated document handlers do not.
const eventTypes = new Set(['mousemove','mouseout','click','touchstart','touchmove']);
const originalAdd = EventTarget.prototype.addEventListener;
const originalRemove = EventTarget.prototype.removeEventListener;
const listeners = [];
const capture = (options) => typeof options === 'boolean' ? options : !!options?.capture;
const observed = (target,type) => (target instanceof HTMLCanvasElement && eventTypes.has(type)) ||
    (target === window && type === 'resize');
function observedAdd(type,listener,options) {
    const result = originalAdd.call(this,type,listener,options);
    if (listener && observed(this,type) && !listeners.some((item) =>
        item.active && item.target === this && item.type === type &&
        item.listener === listener && item.capture === capture(options)))
        listeners.push({target:this,type,listener,capture:capture(options),active:true});
    return result;
}
function observedRemove(type,listener,options) {
    const result = originalRemove.call(this,type,listener,options);
    const item = listeners.find((item) => item.active && item.target === this &&
        item.type === type && item.listener === listener && item.capture === capture(options));
    if (item) item.active = false;
    return result;
}
EventTarget.prototype.addEventListener = observedAdd;
EventTarget.prototype.removeEventListener = observedRemove;
const charts = new Map(),canvases = new Map();
const plugin = {
    id:'completePortalChartConsumerProbe',
    beforeInit(chart) {
        const kind = chart.canvas.id === 'sibling-canvas' ? 'sibling' : 'candidate';
        canvases.set(chart.canvas,kind);
        charts.set(chart.id,{chart,canvas:chart.canvas,kind,initialized:0,destroyed:0,draws:0,events:0,resizes:0});
    },
    afterInit(chart) {charts.get(chart.id).initialized++;},
    afterDestroy(chart) {charts.get(chart.id).destroyed++;},
    afterDraw(chart) {charts.get(chart.id).draws++;},
    afterEvent(chart) {charts.get(chart.id).events++;},
    resize(chart) {charts.get(chart.id).resizes++;},
};
ChartJS.register(plugin);
const point = (xAxisValue,yAxisValue,metadata = {}) => ({data:{type:'loaded',data:{viewType:'chart',xAxisValue,yAxisValue},...metadata}});
const mixedRows = () => [
    {data:{type:'notLoaded'}},point('Repeated',0),{data:{type:'loading'}},
    point('Repeated',-2.5),{data:{type:'loaded',data:{viewType:'list'}}},
    point('Fraction',1.25,{isPaginating:true,isReloading:true,errorMessage:'Synthetic retained loaded data'}),
    {data:{type:'loaded',data:{viewType:'calendar'}}},
    {data:{type:'failed',errorMessage:'Synthetic ignored leaf state'}},point('  <b>literal</b>  ',4),
];
function frozenRows(rows) {
    for (const row of rows) {
        if (row.data.type === 'loaded') Object.freeze(row.data.data);
        Object.freeze(row.data);Object.freeze(row);
    }
    return Object.freeze(rows);
}
let model = {rows:frozenRows(mixedRows()),title:undefined,fieldName:'Projects',
    xAxisFieldName:'Category',yAxisFieldName:'Amount',backgroundColor:'rgb(37 99 235)',narrow:false};
let inputBefore = JSON.stringify(model.rows),root,saved;
const candidateCanvas = () => document.querySelector('#root .mx-sdk-portal-chart canvas');
const candidate = () => {
    const canvas = candidateCanvas();
    return canvas ? ChartJS.getChart(canvas) : undefined;
};
const siblingCanvas = document.getElementById('sibling-canvas');
const sibling = new ChartJS(siblingCanvas,{
    type:'bar',data:{labels:['Unrelated'],datasets:[{data:[3],backgroundColor:'rgb(22 163 74)'}]},
    options:{responsive:true,animation:false,plugins:{legend:{display:false}}},
});
const siblingId = sibling.id;
function lifecycle() {
    return Array.from(charts,([id,item]) => ({id,kind:item.kind,initialized:item.initialized,
        destroyed:item.destroyed,draws:item.draws,events:item.events,resizes:item.resizes,
        registered:ChartJS.getChart(item.canvas) === item.chart}));
}
function listenerTotals(kind) {
    const items = listeners.filter((item) => kind === 'window' ? item.target === window : canvases.get(item.target) === kind);
    return {adds:items.length,removes:items.filter((item) => !item.active).length,
        active:items.filter((item) => item.active).length};
}
function registryHealthy() {
    try {
        return !!ChartJS.registry.getController('bar') && !!ChartJS.registry.getElement('bar') &&
            !!ChartJS.registry.getScale('category') && !!ChartJS.registry.getScale('linear') &&
            !!ChartJS.registry.getPlugin('title') && !!ChartJS.registry.getPlugin('tooltip') &&
            !!ChartJS.registry.getPlugin('legend');
    } catch {return false;}
}
function snapshot() {
    const canvas = candidateCanvas(),chart = candidate(),dl = document.querySelector('#root dl');
    let painted = 0;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
        const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        for (let index = 3;index < pixels.length;index += 4) if (pixels[index]) painted++;
    }
    const box = canvas?.getBoundingClientRect();
    return {...state,errors:[...state.errors],format,reactVersion:React.version,chartVersion:ChartJS.version,
        inputUnchanged:JSON.stringify(model.rows) === inputBefore,
        registry:Object.keys(ChartJS.instances).map(Number).sort((a,b) => a-b),registryHealthy:registryHealthy(),
        chart:chart ? {id:chart.id,labels:[...chart.data.labels],datasets:chart.data.datasets.map((data) => ({
            data:[...data.data],backgroundColor:data.backgroundColor})),
            title:chart.options.plugins.title.text,titleDisplayed:chart.options.plugins.title.display,
            legendDisplayed:chart.options.plugins.legend.display,responsive:chart.options.responsive,
            beginAtZero:chart.options.scales.y.beginAtZero,
            xTitle:chart.options.scales.x.title.text,yTitle:chart.options.scales.y.title.text,
            xTitleDisplayed:chart.options.scales.x.title.display,yTitleDisplayed:chart.options.scales.y.title.display,
            width:chart.width,height:chart.height} : null,
        canvas:canvas ? {width:canvas.width,height:canvas.height,cssWidth:box.width,cssHeight:box.height,
            painted,ariaHidden:canvas.getAttribute('aria-hidden')} : null,
        pairs:dl ? Array.from(dl.children,(row) => [row.querySelector('dt').textContent,row.querySelector('dd').textContent]) : [],
        list:dl ? {ariaHidden:dl.getAttribute('aria-hidden'),position:getComputedStyle(dl).position,
            width:getComputedStyle(dl).width,height:getComputedStyle(dl).height,
            overflow:getComputedStyle(dl).overflow,clip:getComputedStyle(dl).clip,
            whiteSpace:getComputedStyle(dl).whiteSpace} : null,
        sibling:{id:siblingId,registered:ChartJS.getChart(siblingCanvas) === sibling,
            labels:[...sibling.data.labels],data:[...sibling.data.datasets[0].data]},
        lifecycle:lifecycle(),listeners:{candidate:listenerTotals('candidate'),sibling:listenerTotals('sibling'),window:listenerTotals('window')},
        identity:saved ? {sameChart:chart === saved.chart,sameCanvas:canvas === saved.canvas,
            savedRegistered:ChartJS.getChart(saved.canvas) === saved.chart,
            entryConnected:saved.entry?.isConnected ?? false,
            entryIndex:dl ? Array.from(dl.children).indexOf(saved.entry) : -1} : null,
    };
}
window.__nativeProbe = {snapshot};
const settled = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function App({revision}) {
    React.useEffect(() => {
        state.strictMounts++;
        return () => {state.strictCleanups++;};
    },[]);
    React.useEffect(() => {state.committed = revision;},[revision]);
    return React.createElement('form',{onSubmit(event) {event.preventDefault();state.submits++;}},
        React.createElement('section',{className:'fixture-chart-host' + (model.narrow ? ' narrow' : '')},
            React.createElement(CompletePortalChart,{
                rows:model.rows,title:model.title,fieldName:model.fieldName,xAxisFieldName:model.xAxisFieldName,
                yAxisFieldName:model.yAxisFieldName,backgroundColor:model.backgroundColor,
            })));
}
async function publish() {
    const revision = ++state.revision;
    flushSync(() => root.render(React.createElement(React.StrictMode,null,React.createElement(App,{revision}))));
    await settled();return snapshot();
}
async function unmount() {
    if (root) {flushSync(() => root.unmount());root = null;}
    await settled();return snapshot();
}
window.__portalChartFixture = {
    snapshot,
    async update(patch) {
        if ('rows' in patch) patch.rows = frozenRows(patch.rows);
        Object.assign(model,patch);inputBefore = JSON.stringify(model.rows);
        return publish();
    },
    capture(entryIndex = 0) {
        saved = {chart:candidate(),canvas:candidateCanvas(),entry:document.querySelector('#root dl')?.children[entryIndex]};
        return snapshot();
    },
    unmount,
    async remount() {
        if (root) throw Error('Unmount before remount');
        root = createRoot(document.getElementById('root'));
        return publish();
    },
    async dispatchRetiredEvent() {
        const before = lifecycle().filter((item) => item.kind === 'candidate').map((item) => item.events);
        saved.canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:12,clientY:12}));
        await settled();
        return {before,after:lifecycle().filter((item) => item.kind === 'candidate').map((item) => item.events)};
    },
    async dispose() {
        if (!state.disposed) {
            await unmount();sibling.destroy();ChartJS.unregister(plugin);state.disposed = true;
            if (EventTarget.prototype.addEventListener === observedAdd) EventTarget.prototype.addEventListener = originalAdd;
            if (EventTarget.prototype.removeEventListener === observedRemove) EventTarget.prototype.removeEventListener = originalRemove;
        }
        await settled();return snapshot();
    },
};
root = createRoot(document.getElementById('root'));
void publish();
`
    );
}

export function recordPortalChartInputs({
    metafile,
    temporary,
    installed,
    archive,
    readArchiveMember = (member) =>
        execFileSync('tar', ['-xOf', archive, member]),
    format,
    regular,
    hash,
    chartRoot,
}) {
    const inputs = [];
    for (const name of Object.keys(metafile.inputs)) {
        assert(
            !name.startsWith('node:'),
            'Node built-in in Chart browser input'
        );
        const path = realpathSync(resolve(temporary, name));
        assert(within(temporary, path), 'Chart input escapes clean consumer');
        const bytes = regular(path);
        const item = {
            path: relative(temporary, path),
            sha256: hash(bytes),
            bytes: bytes.length,
        };
        if (within(installed, path)) {
            // The ordinary React barrel also reaches the existing private
            // Phone, Rich Text, and Address closures, shared by ESM/CJS.
            // Bind their shipped bytes too. Address admits only its three
            // runtime files, never another vendor, source alias, or format.
            const packagePath = relative(installed, path).replaceAll('\\', '/');
            assert(
                within(join(installed, 'dist', format), path) ||
                    within(
                        join(installed, 'dist/vendor/phone-number-input'),
                        path
                    ) ||
                    within(
                        join(installed, 'dist/vendor/rich-markdown-editor'),
                        path
                    ) ||
                    [
                        'dist/vendor/headlessui-address/combobox.js',
                        'dist/vendor/headlessui-address/react-peer.js',
                        'dist/vendor/headlessui-address/sdk-runtime.js',
                    ].includes(packagePath),
                `Chart browser imported a source alias or wrong SDK format: ${packagePath}`
            );
            const member = 'package/' + packagePath;
            assert.deepEqual(bytes, readArchiveMember(member));
            item.archiveMember = member;
        }
        if (within(chartRoot, path))
            item.chartPackagePath = relative(chartRoot, path).replaceAll(
                '\\',
                '/'
            );
        inputs.push(item);
    }
    const component = `package/dist/${format}/react/CompletePortalChart.js`;
    assert(
        inputs.some((item) => item.archiveMember === component),
        'Actual packed Chart child was not bundled'
    );
    assert(
        inputs.some(
            (item) =>
                item.chartPackagePath ===
                `dist/chart.${format === 'esm' ? 'js' : 'cjs'}`
        ),
        'Expected conditional Chart.js input missing'
    );
    assert(
        inputs.some((item) => item.path.endsWith('/react.development.js')),
        'Actual React development build required'
    );
    assert(
        inputs.some((item) =>
            /react-dom(?:-client)?\.development\.js$/.test(item.path)
        ),
        'Actual ReactDOM development build required'
    );
    assert(
        !inputs.some((item) =>
            /(?:react|react-dom(?:-client)?)\.production/.test(item.path)
        ),
        'Production React cannot prove StrictMode effect replay'
    );
    assert(
        !inputs.some((item) => /[/\\]react-chartjs-2[/\\]/.test(item.path)),
        'Adapter must be shipped inside the actual SDK child, not supplied by this consumer'
    );
    return inputs;
}

/** Add exact local routes to the existing allowed map; do not launch a server. */
export async function prepareCompletePortalChartFixtures({
    temporary,
    archive,
    readArchiveMember = (member) =>
        execFileSync('tar', ['-xOf', archive, member]),
    installed,
    allowed,
    report,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    temporary = realpathSync(temporary);
    installed = realpathSync(installed);
    assert(
        within(temporary, installed),
        'SDK must belong to the clean consumer'
    );
    const consumerRequire = createRequire(join(temporary, 'package.json'));
    const sdkRequire = createRequire(join(installed, 'package.json'));
    const chartRoot = packageRoot(
        realpathSync(sdkRequire.resolve('chart.js')),
        'chart.js'
    );
    assert.equal(
        packageRoot(
            realpathSync(consumerRequire.resolve('chart.js')),
            'chart.js'
        ),
        chartRoot,
        'Observer and SDK must share Chart.js'
    );
    const chartManifest = regular(join(chartRoot, 'package.json'));
    assert.equal(JSON.parse(chartManifest).version, '4.4.2');
    const reactVersion = JSON.parse(
        regular(realpathSync(consumerRequire.resolve('react/package.json')))
    ).version;
    const cssPath = realpathSync(
        consumerRequire.resolve(
            '@miniextensions/sdk/react/complete-portal-chart.css'
        )
    );
    assert(within(installed, cssPath));
    const css = regular(cssPath);
    const cssMember =
        'package/' + relative(installed, cssPath).replaceAll('\\', '/');
    assert.deepEqual(css, readArchiveMember(cssMember));
    allowed.set('/complete-portal-chart.css', css);
    allowed.set(
        '/complete-portal-chart-fixture.css',
        Buffer.from(fixtureStyle)
    );
    report.completePortalChart = {};
    const routes = {};
    for (const format of formats) {
        const source = browserSource(format);
        const entry = join(
            temporary,
            `complete-portal-chart-${format}.${format === 'esm' ? 'mjs' : 'cjs'}`
        );
        writeFileSync(entry, source);
        const bundled = await build({
            absWorkingDir: temporary,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            write: false,
            outfile: join(temporary, `complete-portal-chart-${format}.js`),
            metafile: true,
            legalComments: 'none',
            define: { 'process.env.NODE_ENV': '"development"' },
        });
        await assertBrowserInputs(bundled.metafile, temporary);
        const inputs = recordPortalChartInputs({
            metafile: bundled.metafile,
            temporary,
            installed,
            archive,
            readArchiveMember,
            format,
            regular,
            hash,
            chartRoot,
        });
        const child = inputs.find(
            (item) =>
                item.archiveMember ===
                `package/dist/${format}/react/CompletePortalChart.js`
        );
        const code = bundled.outputFiles[0].contents;
        const route = `/complete-portal-chart-${format}.html`;
        routes[format] = route;
        allowed.set(`/complete-portal-chart-${format}.js`, code);
        allowed.set(
            route,
            Buffer.from(
                `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Standalone complete Portal Chart ${format}</title><link rel="stylesheet" href="/complete-portal-chart.css"><link rel="stylesheet" href="/complete-portal-chart-fixture.css"></head><body><div id="root"></div><section id="sibling-host"><canvas id="sibling-canvas" aria-label="Unrelated chart"></canvas></section><script type="module" src="/complete-portal-chart-${format}.js"></script></body></html>`
            )
        );
        report.completePortalChart[format] = {
            format,
            route,
            mode: 'development',
            reactVersion,
            chartVersion: '4.4.2',
            sourceSha256: hash(source),
            fixtureCssSha256: hash(fixtureStyle),
            packagedCssSha256: hash(css),
            packagedCssMember: cssMember,
            packagedChildSha256: child.sha256,
            packagedChildMember: child.archiveMember,
            chartPackageSha256: hash(chartManifest),
            bundleSha256: hash(code),
            bundleInputs: inputs,
            limits: [
                'Synthetic loaded structural rows; no host parent/schema/record transport authority.',
                'Real Chromium canvas, lifecycle and DOM fallback; no screen-reader certification or external provider/network.',
            ],
        };
    }
    return { formats: [...formats], routes };
}

/** Existing run() owns navigation, the page, CSP/network guard and cleanup. */
export async function checkCompletePortalChartBrowser({
    page,
    evidence,
    format,
}) {
    assert(formats.includes(format), 'Explicit installed SDK format required');
    assert.equal(evidence.format, format);
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    const snapshot = () =>
        page.evaluate(() => window.__portalChartFixture.snapshot());
    const update = (patch) =>
        page.evaluate(
            (patch) => window.__portalChartFixture.update(patch),
            patch
        );
    const capture = (index = 0) =>
        page.evaluate(
            (index) => window.__portalChartFixture.capture(index),
            index
        );
    const groups = [];
    const clean = (value) => {
        assert.deepEqual(value.errors, []);
        assert.equal(value.requests, 0);
        assert.equal(value.submits, 0);
        assert.equal(value.inputUnchanged, true);
        assert.equal(value.chartVersion, '4.4.2');
        assert.equal(value.reactVersion, evidence.reactVersion);
        assert.equal(value.format, format);
    };
    const record = (name, value) => {
        clean(value);
        groups.push({ name, state: value });
        return value;
    };
    const currentChart = (value, labels, values) => {
        assert.deepEqual(value.chart.labels, labels);
        assert.equal(value.chart.datasets.length, 1);
        assert.deepEqual(value.chart.datasets[0].data, values);
        assert.equal(value.chart.responsive, true);
        assert.equal(value.chart.beginAtZero, true);
        assert.equal(value.chart.titleDisplayed, true);
        assert.equal(value.chart.legendDisplayed, false);
        assert.equal(value.chart.xTitleDisplayed, true);
        assert.equal(value.chart.yTitleDisplayed, true);
    };
    try {
        await page.waitForFunction(() => {
            const value = window.__nativeProbe.snapshot();
            return value.canvas?.painted > 50 && value.chart?.width > 100;
        });
        let value = await snapshot();
        assert(['18', '19'].includes(value.reactVersion.split('.')[0]));
        assert(
            value.strictMounts >= 2 && value.strictCleanups >= 1,
            'Development StrictMode must actually replay effects'
        );
        const created = value.lifecycle.filter(
            (item) => item.kind === 'candidate'
        );
        assert(
            created.length >= 2 && created.some((item) => item.destroyed === 1)
        );
        assert.equal(created.filter((item) => item.registered).length, 1);
        assert.equal(value.registry.length, 2);
        assert.equal(value.registryHealthy, true);
        assert(value.listeners.candidate.active > 0);
        record(
            'actual development StrictMode replay and shared public Chart.js registry',
            value
        );

        const labels = [
            'Repeated',
            'Repeated',
            'Fraction',
            '  <b>literal</b>  ',
        ];
        currentChart(value, labels, [0, -2.5, 1.25, 4]);
        assert.deepEqual(
            value.pairs,
            labels.map((label, index) => [
                label,
                String([0, -2.5, 1.25, 4][index]),
            ])
        );
        assert.equal(value.chart.title, 'Projects');
        assert.equal(value.chart.xTitle, 'Category');
        assert.equal(value.chart.yTitle, 'Amount');
        assert.equal(value.chart.datasets[0].backgroundColor, 'rgb(37 99 235)');
        assert.equal(value.canvas.ariaHidden, 'true');
        assert.equal(value.list.ariaHidden, null);
        assert.deepEqual(
            [
                value.list.position,
                value.list.width,
                value.list.height,
                value.list.overflow,
                value.list.whiteSpace,
            ],
            ['absolute', '1px', '1px', 'hidden', 'nowrap']
        );
        assert.equal(value.list.clip, 'rect(0px, 0px, 0px, 0px)');
        assert.equal(await page.locator('#root b').count(), 0);
        assert(
            value.canvas.width > 100 &&
                value.canvas.height > 50 &&
                value.canvas.cssWidth > 100 &&
                value.canvas.cssHeight > 50
        );
        record(
            'ordered mixed rows, duplicate labels, raw zero/negative/fractional values and accessible literal DL',
            value
        );

        await capture();
        value = await update({
            title: 'Current custom title',
            xAxisFieldName: 'Updated X',
            yAxisFieldName: 'Updated Y',
            backgroundColor: 'rgb(225 29 72)',
        });
        assert.equal(value.identity.sameChart, true);
        assert.equal(value.identity.sameCanvas, true);
        assert.equal(value.chart.title, 'Current custom title');
        assert.equal(value.chart.xTitle, 'Updated X');
        assert.equal(value.chart.yTitle, 'Updated Y');
        assert.equal(value.chart.datasets[0].backgroundColor, 'rgb(225 29 72)');
        currentChart(value, labels, [0, -2.5, 1.25, 4]);
        value = await update({ title: '' });
        assert.equal(value.chart.title, '');
        value = await update({ title: null, fieldName: 'Current fallback' });
        assert.equal(value.chart.title, 'Current fallback');
        value = await update({
            title: undefined,
            fieldName: 'Undefined fallback',
        });
        assert.equal(value.chart.title, 'Undefined fallback');
        assert.equal(value.identity.sameChart, true);
        record(
            'current title/nullish/empty fallback, axes and theme update on the same real chart',
            value
        );

        const kept = {
            data: {
                type: 'loaded',
                data: {
                    viewType: 'chart',
                    xAxisValue: 'Kept row',
                    yAxisValue: 8,
                },
            },
        };
        await update({ rows: [{ data: { type: 'loading' } }, kept] });
        await capture(0);
        value = await update({
            rows: [
                {
                    data: {
                        type: 'loaded',
                        data: {
                            viewType: 'chart',
                            xAxisValue: 'Now loaded',
                            yAxisValue: 2,
                        },
                    },
                },
                kept,
            ],
        });
        assert.equal(value.identity.entryConnected, true);
        assert.equal(value.identity.entryIndex, 1);
        assert.equal(value.identity.sameChart, true);
        assert.equal(value.identity.sameCanvas, true);
        currentChart(value, ['Now loaded', 'Kept row'], [2, 8]);
        record(
            'original input-row key preserves the later DL node when an earlier row loads',
            value
        );

        value = await update({
            rows: [
                {
                    data: {
                        type: 'loaded',
                        data: {
                            viewType: 'chart',
                            xAxisValue: 'Replacement',
                            yAxisValue: -7,
                        },
                    },
                },
            ],
        });
        currentChart(value, ['Replacement'], [-7]);
        assert.deepEqual(value.pairs, [['Replacement', '-7']]);
        value = await update({ rows: [] });
        currentChart(value, [], []);
        assert.deepEqual(value.pairs, []);
        value = await update({
            rows: [
                { data: { type: 'loading' } },
                { data: { type: 'loaded', data: { viewType: 'list' } } },
                { data: { type: 'loaded', data: { viewType: 'calendar' } } },
            ],
        });
        currentChart(value, [], []);
        assert.deepEqual(value.pairs, []);
        assert.equal(value.identity.sameChart, true);
        record(
            'replacement, empty and ignored-only rows remove stale chart and DL data',
            value
        );

        await update({
            rows: [
                {
                    data: {
                        type: 'loaded',
                        data: {
                            viewType: 'chart',
                            xAxisValue: 'Resize',
                            yAxisValue: 6,
                        },
                    },
                },
            ],
        });
        await capture();
        const wide = (await snapshot()).chart.width;
        await update({ narrow: true });
        await page.waitForFunction((wide) => {
            const value = window.__nativeProbe.snapshot();
            return (
                value.chart?.width < wide - 100 && value.canvas?.painted > 50
            );
        }, wide);
        value = await snapshot();
        assert.equal(value.identity.sameChart, true);
        assert.equal(value.identity.sameCanvas, true);
        assert(
            value.chart.width > 100 &&
                value.chart.height > 50 &&
                value.canvas.painted > 50
        );
        assert(
            value.lifecycle.some(
                (item) =>
                    item.registered &&
                    item.kind === 'candidate' &&
                    item.resizes > 0
            )
        );
        record(
            'real canvas dimensions, paint and responsive container resize without replacing the chart',
            value
        );

        await capture();
        const oldId = (await snapshot()).chart.id;
        value = await page.evaluate(() =>
            window.__portalChartFixture.unmount()
        );
        assert.equal(value.chart, null);
        assert.equal(value.canvas, null);
        assert.deepEqual(value.pairs, []);
        assert.equal(value.identity.savedRegistered, false);
        assert(
            value.lifecycle
                .filter((item) => item.kind === 'candidate')
                .every((item) => item.destroyed === 1 && !item.registered)
        );
        assert.equal(value.listeners.candidate.active, 0);
        assert.equal(
            value.listeners.candidate.adds,
            value.listeners.candidate.removes
        );
        assert.deepEqual(value.registry, [value.sibling.id]);
        assert.equal(value.sibling.registered, true);
        assert.equal(value.registryHealthy, true);
        const retired = await page.evaluate(() =>
            window.__portalChartFixture.dispatchRetiredEvent()
        );
        assert.deepEqual(retired.after, retired.before);
        const siblingEvents = value.lifecycle.find(
            (item) => item.kind === 'sibling'
        ).events;
        await page.locator('#sibling-canvas').hover();
        await page.waitForFunction(
            (before) =>
                window.__nativeProbe
                    .snapshot()
                    .lifecycle.find((item) => item.kind === 'sibling').events >
                before,
            siblingEvents
        );
        value = await snapshot();
        assert.deepEqual(value.sibling.labels, ['Unrelated']);
        assert.deepEqual(value.sibling.data, [3]);
        record(
            'unmount balances owned canvas listeners/registry and leaves the unrelated chart interactive',
            value
        );

        value = await page.evaluate(() =>
            window.__portalChartFixture.remount()
        );
        await page.waitForFunction(
            () => window.__nativeProbe.snapshot().canvas?.painted > 50
        );
        value = await snapshot();
        assert.notEqual(value.chart.id, oldId);
        assert.equal(value.identity.sameChart, false);
        assert.equal(value.identity.sameCanvas, false);
        assert.equal(value.identity.savedRegistered, false);
        assert.equal(value.registry.length, 2);
        assert(value.strictMounts >= 4 && value.strictCleanups >= 3);
        assert.equal(value.sibling.registered, true);
        currentChart(value, ['Resize'], [6]);
        record(
            'fresh real StrictMode remount without reviving retired instances or stale data',
            value
        );

        value = await page.evaluate(() =>
            window.__portalChartFixture.dispose()
        );
        assert.deepEqual(value.registry, []);
        assert(
            value.lifecycle.every(
                (item) => item.destroyed === 1 && !item.registered
            )
        );
        for (const totals of Object.values(value.listeners)) {
            assert.equal(totals.active, 0);
            assert.equal(totals.adds, totals.removes);
        }
        assert.equal(value.strictMounts, value.strictCleanups);
        record(
            'final fixture-owned teardown balances all charts and observed canvas/window events',
            value
        );
        assert.equal(groups.length, 9);
        evidence.browserGroups = groups;
    } finally {
        await page.evaluate(() => window.__portalChartFixture?.dispose());
    }
}
