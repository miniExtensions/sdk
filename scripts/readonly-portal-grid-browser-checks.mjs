import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { realpathSync, readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

export const readonlyPortalGridBrowserEntry = String.raw`
import React,{createElement as h,StrictMode,useEffect,useRef,useState}from'react';
import{createRoot}from'react-dom/client';
import{ReadonlyPortalGrid,CompleteReadOnlyTextField}from'@miniextensions/sdk/react';
import'@miniextensions/sdk/react/readonly-portal-grid.css';
const records=Object.freeze([{recordId:'second',name:'Alpha',amount:'0',notes:'Detailed note '.repeat(120)},{recordId:'first',name:'Beta',amount:'false',notes:'Small note'}].map(Object.freeze));
const original=JSON.stringify(records),hides=[],widths=[],opens=[],errors=[],pointers=[],headerEvents=[];let change,committed=0,retired=false,activeTrigger=null,returnCheck=null,stateRead=null,submits=0;
window.addEventListener('pointerdown',e=>pointers.push({type:e.pointerType,trusted:e.isTrusted}),{capture:true});
for(const type of ['click','auxclick','contextmenu'])document.addEventListener(type,event=>{if(!(event.target instanceof Element)||!event.target.closest('[role="tooltip"] a'))return;const item={type,trusted:event.isTrusted,atCapture:event.defaultPrevented,final:null};headerEvents.push(item);queueMicrotask(()=>{item.final=event.defaultPrevented;});},{capture:true});
window.addEventListener('error',e=>errors.push(String(e.error||e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const columns=Object.freeze([{fieldId:'name',title:'<Name>',icon:'text'},{fieldId:'amount',title:'Amount',icon:'number'},{fieldId:'notes',title:'Notes',icon:'multiline-text',description:'<p><strong>Useful header</strong><a href="/stale-help-link">Help link</a><script>window.__headerUnsafe=true</script></p>',descriptionImageUrl:'/grid-header-help.svg'}].map(Object.freeze));
const leaf=value=>h(CompleteReadOnlyTextField,{value,language:'en'});
document.querySelector('#child-close').onclick=()=>{document.querySelector('#child').close();if(returnCheck?.()&&activeTrigger?.isConnected)activeTrigger.focus();};
function App(){const[state,set]=useState({scope:'original',revision:1,ready:true,live:true,copy:false,height:'short',empty:false,hidden:{original:{name:true}},widths:{original:{name:'180',amount:180,notes:220}}});
 const live=useRef(state);live.current=state;change=p=>{retired=false;set(s=>({...s,...p}));};
 useEffect(()=>{stateRead=state;committed++;});
 const scope=state.scope,revision=state.revision,isCurrent=()=>!retired&&live.current.live&&live.current.ready&&live.current.scope===scope&&live.current.revision===revision;
 const rows=state.empty?[]:records.map(r=>({recordId:r.recordId,label:r.name,cells:['notes','name','amount'].map(fieldId=>({fieldId,node:leaf(r[fieldId])}))}));
 return h('form',{onSubmit:e=>{e.preventDefault();submits++;}},h('button',{type:'button',id:'before'},'Before Grid'),h(ReadonlyPortalGrid,{columns,rows,primaryFieldId:'name',revision,preferenceScopeKey:scope,ready:state.ready,isCurrent,hiddenColumns:state.hidden[scope]||{},columnWidths:state.widths[scope]||{},allowHideColumns:true,doNotAllowUserToCopyTextOnGrid:state.copy,rowHeight:state.height,onFieldHiddenChange:change=>{if(!isCurrent())throw Error('Stale hide reached host');hides.push({scope,revision,...change});set(s=>({...s,hidden:{...s.hidden,[scope]:{...s.hidden[scope],[change.fieldId]:change.isHidden}}}));},onColumnWidthCommit:change=>{if(!isCurrent())throw Error('Stale width reached host');widths.push({scope,revision,...change,measuredAtCommit:[...document.querySelectorAll('th[data-field-id]')].find(n=>n.dataset.fieldId===change.fieldId)?.clientWidth});set(s=>({...s,widths:{...s.widths,[scope]:{...s.widths[scope],[change.fieldId]:change.width}}}));},onOpenRecord:(recordId,trigger)=>{if(!isCurrent())throw Error('Stale Open reached host');opens.push({scope,revision,recordId,button:trigger.tagName});activeTrigger=trigger;returnCheck=isCurrent;document.querySelector('#child').showModal();}}),h('input',{id:'editable',defaultValue:'Editable unaffected','aria-label':'Editable control'}));
}
window.__nativeProbe={change:p=>change(p),retire:()=>{retired=true;},snapshot:()=>({react:React.version,platform:navigator.platform,committed,state:stateRead,externalRetired:retired,hides,widths,opens,submits,errors,pointers,headerEvents,canonicalUnchanged:JSON.stringify(records)===original})};
createRoot(document.querySelector('#root')).render(h(StrictMode,null,h(App)));
`;

export async function prepareReadonlyPortalGridBrowserFixtures(args) {
    const {
        temporary,
        installed,
        allowed,
        report,
        readArchiveMember,
        regular,
        hash,
    } = args;
    const entry = join(temporary, 'readonly-portal-grid.mjs');
    writeFileSync(entry, readonlyPortalGridBrowserEntry);
    const bundle = await args.build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'readonly-portal-grid.js'),
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await args.assertBrowserInputs(bundle.metafile, temporary);
    const inputs = Object.keys(bundle.metafile.inputs);
    for (const suffix of [
        '/react/ReadonlyPortalGrid.js',
        '/react/CompleteReadOnlyTextField.js',
        '/react/CompleteFormFieldPresentation.js',
        '/react/readonly-portal-grid.css',
        '/react/complete-readonly-text.css',
    ])
        assert(
            inputs.some((name) => name.endsWith(suffix)),
            'Installed Grid input ' + suffix
        );
    const proofInputs = inputs.map((name) => {
        const path = realpathSync(resolve(temporary, name)),
            bytes = regular(path);
        const item = {
            path: relative(temporary, path),
            sha256: hash(bytes),
            bytes: bytes.length,
        };
        if (path.startsWith(installed + '/')) {
            item.archiveMember =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(bytes, readArchiveMember(item.archiveMember));
        }
        return item;
    });
    for (const file of bundle.outputFiles) {
        if (file.path.endsWith('.js'))
            allowed.set('/readonly-portal-grid.js', file.contents);
        else if (file.path.endsWith('.css'))
            allowed.set('/readonly-portal-grid.css', file.contents);
        else assert.fail('Unexpected Grid fixture output');
    }
    assert(
        allowed.has('/readonly-portal-grid.js') &&
            allowed.has('/readonly-portal-grid.css')
    );
    allowed.set('/favicon.ico', Buffer.alloc(0));
    allowed.set(
        '/grid-header-help.svg',
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>'
        )
    );
    allowed.set(
        '/readonly-portal-grid.html',
        Buffer.from(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nine synthetic readonly Portal Grid</title><link rel="stylesheet" href="/readonly-portal-grid.css"><style>body{margin:16px;font:16px system-ui}#editable{display:block;margin-top:16px}</style></head><body><div id="root"></div><dialog id="child" aria-label="Synthetic child"><button id="child-close" type="button">Close child</button></dialog><script type="module" src="/readonly-portal-grid.js"></script></body></html>'
        )
    );
    report.readonlyPortalGrid = {
        sourceSha256: hash(readonlyPortalGridBrowserEntry),
        checkerSha256: hash(regular(fileURLToPath(import.meta.url))),
        react: JSON.parse(
            regular(join(temporary, 'node_modules/react/package.json'))
        ).version,
        bundleInputs: proofInputs,
        scriptSha256: hash(allowed.get('/readonly-portal-grid.js')),
        cssSha256: hash(allowed.get('/readonly-portal-grid.css')),
    };
}

export async function checkReadonlyPortalGridBrowser({ page, evidence }) {
    page.setDefaultTimeout(5000);
    const snapshot = () => page.evaluate(() => window.__nativeProbe.snapshot());
    const patch = async (value) => {
        const old = (await snapshot()).committed;
        await page.evaluate((v) => window.__nativeProbe.change(v), value);
        await page.waitForFunction(
            (n) => window.__nativeProbe.snapshot().committed > n,
            old
        );
    };
    const results = [];
    evidence.results = results;
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    assert.equal((await snapshot()).react, evidence.react);
    await page.setViewportSize({ width: 1200, height: 900 });
    assert.deepEqual(
        await page
            .locator('thead th')
            .evaluateAll((headers) =>
                headers.map(
                    (header) =>
                        header.querySelector('.mx-sdk-field-title')
                            ?.textContent ?? header.textContent
                )
            ),
        ['<Name>', 'Amount', 'Notes', 'Record']
    );
    assert.deepEqual(
        await page
            .locator('tbody tr')
            .evaluateAll((rows) => rows.map((row) => row.dataset.recordId)),
        ['second', 'first']
    );
    assert.equal(await page.locator('thead b').count(), 0);
    assert.equal(await page.locator('thead svg').count(), 3);
    assert.deepEqual(
        await page.locator('thead th').evaluateAll((headers) =>
            headers.map((header) => ({
                top: getComputedStyle(header).paddingTop,
                bottom: getComputedStyle(header).paddingBottom,
                left: getComputedStyle(header).paddingLeft,
            }))
        ),
        Array(4).fill({ top: '14px', bottom: '14px', left: '12px' })
    );
    results.push({
        group: 'ordered admitted cells, literal headers and protected primary',
        passed: true,
    });

    const description = page.getByRole('button', {
        name: 'Field description for Notes',
        exact: true,
    });
    await description.focus();
    const help = page.getByRole('tooltip');
    await help.waitFor({ state: 'visible' });
    assert.equal(await help.locator('strong').textContent(), 'Useful header');
    await page.waitForFunction(() => {
        const image = document.querySelector('[role="tooltip"] img');
        return (
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth === 8
        );
    });
    assert.equal(await page.evaluate(() => window.__headerUnsafe), undefined);
    await page.keyboard.press('Escape');
    await help.waitFor({ state: 'detached' });
    assert.equal(
        await description.evaluate((node) => node === document.activeElement),
        true
    );
    await patch({ empty: true });
    await description.focus();
    // It may already have focus after Escape; trusted Enter still activates it.
    await page.keyboard.press('Enter');
    await help.waitFor({ state: 'visible' });
    await patch({ ready: false });
    await help.waitFor({ state: 'detached' });
    await patch({ ready: true, empty: false });
    assert.equal(await help.count(), 0);
    results.push({
        group: 'rich empty-safe header tooltip, actual image, keyboard Escape and retirement',
        passed: true,
    });

    const amount = page.locator('th[data-field-id="amount"]');
    const handle = amount.getByRole('separator');
    const beforeWidth = (await snapshot()).widths.length;
    const initialMouseWidth = await amount.evaluate((node) => node.clientWidth);
    const box = await handle.boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 47, box.y + box.height / 2, {
        steps: 8,
    });
    await page.waitForFunction(
        (width) =>
            document.querySelector('th[data-field-id="amount"]').clientWidth >
            width,
        initialMouseWidth
    );
    const provisionalMouseWidth = await amount.evaluate(
        (node) => node.clientWidth
    );
    await page.mouse.up();
    await page.waitForFunction(
        (n) => window.__nativeProbe.snapshot().widths.length === n + 1,
        beforeWidth
    );
    let end = await snapshot();
    assert.equal(end.widths.at(-1).scope, 'original');
    assert(end.widths.at(-1).width > initialMouseWidth);
    assert.equal(end.widths.at(-1).width, end.widths.at(-1).measuredAtCommit);
    assert(
        Math.abs(
            end.widths.at(-1).width -
                (await amount.evaluate((node) => node.clientWidth))
        ) <= 1
    );
    const ordinaryWidth = end.widths.at(-1).width;
    results.push({
        group: 'trusted pointer resize and measured canonical width',
        before: initialMouseWidth,
        provisional: provisionalMouseWidth,
        width: ordinaryWidth,
        passed: true,
    });

    await handle.focus();
    const initialKeyboardWidth = await amount.evaluate(
        (node) => node.clientWidth
    );
    await page.keyboard.down('Shift');
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(
        (width) =>
            document.querySelector('th[data-field-id="amount"]').clientWidth >
            width,
        initialKeyboardWidth
    );
    const provisionalKeyboardWidth = await amount.evaluate(
        (node) => node.clientWidth
    );
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Shift');
    await page.waitForFunction(
        (n) => window.__nativeProbe.snapshot().widths.length === n + 1,
        beforeWidth + 1
    );
    end = await snapshot();
    assert(end.widths.at(-1).width > initialKeyboardWidth);
    assert.equal(end.widths.at(-1).width, end.widths.at(-1).measuredAtCommit);
    assert(
        Math.abs(
            end.widths.at(-1).width -
                (await amount.evaluate((node) => node.clientWidth))
        ) <= 1
    );
    const beforeCancel = end.widths.length;
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.press('Escape');
    await page.keyboard.up('ArrowLeft');
    assert.equal((await snapshot()).widths.length, beforeCancel);
    results.push({
        group: 'trusted keyboard resize and Escape cancellation',
        before: initialKeyboardWidth,
        provisional: provisionalKeyboardWidth,
        passed: true,
    });

    const hide = page.getByRole('button', {
        name: 'Hide columns',
        exact: true,
    });
    await hide.click();
    assert.equal(
        await page.getByRole('switch', { name: '<Name>', exact: true }).count(),
        0
    );
    const toggle = page.getByRole('switch', { name: 'Amount', exact: true });
    await toggle.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().hides.length === 1
    );
    assert.equal(await amount.count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(
        await page
            .getByRole('dialog', { name: 'Hide columns', exact: true })
            .count(),
        0
    );
    assert.equal(
        await page.evaluate(() => document.activeElement?.textContent),
        'Hide columns'
    );
    results.push({
        group: 'controlled hide switch, primary exclusion and native dialog focus return',
        passed: true,
    });

    await patch({ scope: 'custom', revision: 2 });
    assert.equal(await amount.count(), 1);
    const customWidth = await amount.evaluate((node) => node.clientWidth);
    assert.notEqual(
        customWidth,
        ordinaryWidth,
        'Another view hydrates its own default width'
    );
    await patch({ scope: 'original', revision: 3 });
    assert.equal(
        await amount.count(),
        0,
        'Original hidden preference restored'
    );
    await hide.click();
    await page.getByRole('switch', { name: 'Amount', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(
        await amount.evaluate((node) => parseFloat(node.style.width)),
        (await snapshot()).state.widths.original.amount
    );
    results.push({
        group: 'view-scoped width/hide hydration and restoration',
        passed: true,
    });

    await description.focus();
    await help.waitFor({ state: 'visible' });
    const currentUrl = page.url();
    await page.evaluate(() => window.__nativeProbe.retire());
    const staleLink = help.getByRole('link', {
        name: 'Help link',
        exact: true,
    });
    await staleLink.click({ button: 'middle' });
    await staleLink.click({ button: 'right' });
    const linkEvents = (await snapshot()).headerEvents;
    assert.deepEqual(
        linkEvents.map((event) => ({
            type: event.type,
            trusted: event.trusted,
            final: event.final,
        })),
        [
            { type: 'auxclick', trusted: true, final: true },
            { type: 'contextmenu', trusted: true, final: true },
        ]
    );
    evidence.retiredHeaderDefaults = linkEvents;
    await staleLink.click();
    assert.equal(
        page.url(),
        currentUrl,
        'A retired portaled link cannot navigate'
    );
    await page.keyboard.press('Escape');
    await help.waitFor({ state: 'detached' });
    const staleHeaderActions = [];
    evidence.staleHeaderActions = staleHeaderActions;
    await description.focus();
    staleHeaderActions.push({
        action: 'focus',
        tooltipCount: await help.count(),
        externalRetired: (await snapshot()).externalRetired,
    });
    assert.equal(
        staleHeaderActions.at(-1).tooltipCount,
        0,
        'Retired header focus cannot activate help'
    );
    await description.click();
    staleHeaderActions.push({
        action: 'click',
        tooltipCount: await help.count(),
        externalRetired: (await snapshot()).externalRetired,
    });
    assert.equal(
        staleHeaderActions.at(-1).tooltipCount,
        0,
        'Retired header click/enter cannot activate help'
    );
    await description.hover();
    staleHeaderActions.push({
        action: 'hover',
        tooltipCount: await help.count(),
        externalRetired: (await snapshot()).externalRetired,
    });
    assert.equal(await help.count(), 0);
    assert.equal(await page.locator('[role="tooltip"] img').count(), 0);
    results.push({
        group: 'retained stale header focus/hover/click and portaled link refusal',
        passed: true,
    });
    await patch({ revision: 4 });
    const beforeStale = await snapshot();
    const staleBox = await handle.boundingBox();
    assert(staleBox);
    await page.mouse.move(staleBox.x + staleBox.width / 2, staleBox.y + 4);
    await page.mouse.down();
    await page.evaluate(() => window.__nativeProbe.retire());
    await page.mouse.move(staleBox.x + 60, staleBox.y + 4);
    await page.mouse.up();
    await page
        .getByRole('button', { name: 'Open record Alpha', exact: true })
        .click();
    assert.equal((await snapshot()).widths.length, beforeStale.widths.length);
    assert.equal((await snapshot()).opens.length, beforeStale.opens.length);
    await patch({ revision: 5 });
    const abaBox = await handle.boundingBox();
    assert(abaBox);
    await page.mouse.move(abaBox.x + 8, abaBox.y + 4);
    await page.mouse.down();
    await patch({ scope: 'custom', revision: 6 });
    await patch({ scope: 'original', revision: 7 });
    await page.mouse.up();
    assert.equal((await snapshot()).widths.length, beforeStale.widths.length);
    results.push({ group: 'stale and A-B-A drag/Open refusal', passed: true });

    for (const retired of [{ ready: false }, { live: false }]) {
        await hide.click();
        assert.equal(
            await page
                .getByRole('dialog', { name: 'Hide columns', exact: true })
                .count(),
            1
        );
        await patch(retired);
        assert.equal(await page.getByRole('table').count(), 0);
        await patch({ ready: true, live: true });
        assert.equal(
            await page
                .getByRole('dialog', { name: 'Hide columns', exact: true })
                .count(),
            0
        );
    }
    results.push({
        group: 'unavailable recovery never revives an old dialog',
        passed: true,
    });

    const heights = [];
    for (const [height, pixels] of [
        ['short', 24],
        ['medium', 52],
        ['tall', 84],
        ['extra-tall', 140],
        ['fit-content', null],
    ]) {
        await patch({ height });
        const actual = await page
            .locator('.mx-sdk-readonly-grid__cell-content')
            .first()
            .evaluate((n) => ({
                height: n.getBoundingClientRect().height,
                css: getComputedStyle(n).height,
            }));
        if (pixels != null) assert.equal(actual.height, pixels);
        else assert(actual.height > 0);
        heights.push({ height, ...actual });
    }
    results.push({
        group: 'actual native content-wrapper geometry',
        heights,
        passed: true,
    });

    await patch({ height: 'short' });
    const alpha = page
        .locator('tbody tr')
        .first()
        .locator('[data-field-id="name"] .read-only-text');
    const selection = [];
    for (const [policy, restricted] of [
        [false, false],
        [null, false],
        ['true', false],
        [true, true],
        [false, false],
    ]) {
        await patch({ copy: policy });
        await page.mouse.click(1100, 850);
        const rect = await alpha.boundingBox();
        assert(rect);
        await page.mouse.move(rect.x - 2, rect.y + rect.height / 2);
        await page.mouse.down();
        await page.mouse.move(
            rect.x + rect.width + 2,
            rect.y + rect.height / 2,
            { steps: 10 }
        );
        await page.mouse.up();
        const observed = await page.evaluate(() => ({
            text: window.getSelection()?.toString() ?? '',
            select: getComputedStyle(
                document.querySelector('.mx-sdk-readonly-grid__viewport')
            ).userSelect,
        }));
        if (restricted) {
            assert.equal(observed.select, 'none');
            assert(!observed.text.includes('Alpha'));
        } else assert(observed.text.includes('Alpha'));
        selection.push({ policy, restricted, ...observed });
    }
    const editable = page.getByRole('textbox', {
        name: 'Editable control',
        exact: true,
    });
    await patch({ copy: true });
    await editable.focus();
    const modifier = (await snapshot()).platform.startsWith('Mac')
        ? 'Meta'
        : 'Control';
    await page.keyboard.press(modifier + '+A');
    assert.deepEqual(
        await editable.evaluate((n) => [n.selectionStart, n.selectionEnd]),
        [0, 'Editable unaffected'.length]
    );
    results.push({
        group: 'trusted readonly drag selection, strict copy gate and editable positive control',
        selection,
        passed: true,
    });

    await page.locator('#before').focus();
    const tabOrder = [];
    for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        const label = await page.evaluate(
            () =>
                document.activeElement?.getAttribute('aria-label') ??
                document.activeElement?.textContent
        );
        tabOrder.push(label);
        if (label === 'Open record Alpha') break;
    }
    assert.equal(tabOrder.at(-1), 'Open record Alpha');
    await page.keyboard.press('Enter');
    assert.equal(
        await page
            .getByRole('dialog', { name: 'Synthetic child', exact: true })
            .count(),
        1
    );
    await page
        .getByRole('button', { name: 'Close child', exact: true })
        .click();
    assert.equal(
        await page.evaluate(() =>
            document.activeElement?.getAttribute('aria-label')
        ),
        'Open record Alpha'
    );
    assert.equal((await snapshot()).opens.at(-1).button, 'BUTTON');
    results.push({
        group: 'trusted Tab/Enter Open and actual trigger focus return',
        tabOrder,
        passed: true,
    });

    const touchBrowser = page.context().browser();
    assert(touchBrowser);
    const touchContext = await touchBrowser.newContext({
        hasTouch: true,
        viewport: { width: 1200, height: 900 },
    });
    touchContext.setDefaultTimeout(5000);
    const touchCleanup = {};
    evidence.touchCleanup = touchCleanup;
    let touchProtocol, touchFailure;
    try {
        const origin = new URL(page.url()).origin;
        await touchContext.route('**/*', (route) =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : route.abort()
        );
        const touchPage = await touchContext.newPage();
        await touchPage.goto(origin + '/readonly-portal-grid.html');
        await touchPage.waitForFunction(
            () => window.__nativeProbe?.snapshot().committed > 0
        );
        const touchHeader = touchPage.locator('th[data-field-id="amount"]');
        const initialTouchWidth = await touchHeader.evaluate(
            (node) => node.clientWidth
        );
        const touchHandle = await touchHeader
            .getByRole('separator')
            .boundingBox();
        assert(touchHandle);
        touchProtocol = await touchContext.newCDPSession(touchPage);
        const point = {
            x: touchHandle.x + touchHandle.width / 2,
            y: touchHandle.y + touchHandle.height / 2,
        };
        await touchProtocol.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [point],
        });
        await touchProtocol.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...point, x: point.x + 40 }],
        });
        await touchPage.waitForFunction(
            (width) =>
                document.querySelector('th[data-field-id="amount"]')
                    .clientWidth > width,
            initialTouchWidth
        );
        const provisionalTouchWidth = await touchHeader.evaluate(
            (node) => node.clientWidth
        );
        await touchProtocol.send('Input.dispatchTouchEvent', {
            type: 'touchEnd',
            touchPoints: [],
        });
        await touchPage.waitForFunction(
            () => window.__nativeProbe.snapshot().widths.length === 1
        );
        const touch = await touchPage.evaluate(() =>
            window.__nativeProbe.snapshot()
        );
        const settledTouchHeader = await touchHeader.evaluate((node) => ({
            clientWidth: node.clientWidth,
            inlineWidth: node.style.width,
            boundsWidth: node.getBoundingClientRect().width,
        }));
        evidence.touchObservation = {
            before: initialTouchWidth,
            provisional: provisionalTouchWidth,
            header: settledTouchHeader,
            snapshot: touch,
        };
        assert(
            touch.pointers.some(
                (event) => event.type === 'touch' && event.trusted
            )
        );
        assert.equal(touch.widths[0].width, touch.widths[0].measuredAtCommit);
        assert(touch.widths[0].width > initialTouchWidth);
        assert(
            Math.abs(touch.widths[0].width - settledTouchHeader.clientWidth) <=
                1,
            JSON.stringify(evidence.touchObservation)
        );
        assert.equal(touch.canonicalUnchanged, true);
        assert.deepEqual(touch.errors, []);
        assert.equal(touch.submits, 0);
        results.push({
            group: 'trusted touch resize and measured settlement',
            events: touch.pointers,
            before: initialTouchWidth,
            provisional: provisionalTouchWidth,
            width: touch.widths[0].width,
            passed: true,
        });
    } catch (error) {
        touchFailure = error;
    } finally {
        for (const [name, action] of [
            ['protocol', () => touchProtocol?.detach()],
            ['context', () => touchContext.close()],
        ]) {
            let timer;
            try {
                await Promise.race([
                    action(),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(
                                    Error(
                                        'Grid touch ' +
                                            name +
                                            ' cleanup timed out'
                                    )
                                ),
                            5000
                        );
                    }),
                ]);
                touchCleanup[name] = 'completed';
            } catch (error) {
                touchCleanup[name] = { error: error.message };
                touchFailure ??= error;
            } finally {
                clearTimeout(timer);
            }
        }
    }
    if (touchFailure) throw touchFailure;

    await patch({ empty: true });
    assert.equal(await page.locator('thead th').count(), 4);
    assert.equal(
        await page.getByText('No records', { exact: true }).count(),
        1
    );
    await patch({ ready: false });
    assert.equal(await page.getByRole('table').count(), 0);
    await patch({ ready: true, empty: false });
    end = await snapshot();
    assert.deepEqual(end.errors, []);
    assert.equal(end.submits, 0);
    assert.equal(end.canonicalUnchanged, true);
    Object.assign(evidence, {
        status: 'passed',
        results,
        actualReact: end.react,
        platform: end.platform,
        commands: {
            hides: end.hides,
            widths: end.widths,
            opens: end.opens,
            submits: end.submits,
        },
        canonicalUnchanged: true,
        errors: end.errors,
        limits: [
            'Installed SDK presentation only; actual native borrowed-route, child admission and persistent preference qualification remain separate.',
        ],
    });
}

export async function checkReadonlyPortalGridProfile({
    browser,
    consumer,
    evidence,
    output,
    readArchiveMember,
}) {
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const regular = (path) => {
        const absolute = resolve(path);
        assert(lstatSync(absolute).isFile());
        assert.equal(realpathSync(absolute), absolute);
        return readFileSync(absolute);
    };
    const allowed = new Map(),
        report = {},
        requests = [],
        unexpected = [];
    let server, context, failure;
    try {
        const installed = realpathSync(
            join(consumer, 'node_modules/@miniextensions/sdk')
        );
        await prepareReadonlyPortalGridBrowserFixtures({
            temporary: consumer,
            readArchiveMember,
            installed,
            allowed,
            report,
            build,
            assertBrowserInputs,
            regular,
            hash,
        });
        Object.assign(evidence, report.readonlyPortalGrid);
        server = createServer((request, response) => {
            const path = new URL(request.url, 'http://127.0.0.1').pathname;
            requests.push({ method: request.method, path });
            const bytes = allowed.get(path);
            if (request.method !== 'GET' || !bytes) {
                unexpected.push({ method: request.method, path });
                response.writeHead(403);
                response.end();
                return;
            }
            response.setHeader(
                'Content-Type',
                path.endsWith('.svg')
                    ? 'image/svg+xml'
                    : path.endsWith('.js')
                      ? 'text/javascript'
                      : path.endsWith('.css')
                        ? 'text/css'
                        : 'text/html'
            );
            response.end(bytes);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        evidence.origin = origin;
        context = await browser.newContext();
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.origin === origin && allowed.has(url.pathname))
                return route.continue();
            unexpected.push({ url: route.request().url() });
            return route.abort();
        });
        const page = await context.newPage();
        await page.goto(origin + '/readonly-portal-grid.html');
        try {
            await checkReadonlyPortalGridBrowser({ page, evidence });
        } finally {
            await page.screenshot({
                path: join(output, 'grid.png'),
                fullPage: true,
            });
            writeFileSync(
                join(output, 'grid-ax.yaml'),
                await page.locator('body').ariaSnapshot()
            );
        }
        assert.deepEqual(unexpected, []);
        evidence.requests = requests;
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
    } finally {
        evidence.cleanup = {};
        for (const [name, action] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    server?.listening
                        ? new Promise((resolve, reject) => {
                              server.closeAllConnections();
                              server.close((error) =>
                                  error ? reject(error) : resolve()
                              );
                          })
                        : undefined,
            ],
        ]) {
            let timer;
            try {
                await Promise.race([
                    action(),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(
                                    Error('Grid ' + name + ' cleanup timed out')
                                ),
                            5000
                        );
                    }),
                ]);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                failure ??= error;
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
            } finally {
                clearTimeout(timer);
            }
        }
        writeFileSync(
            join(output, 'grid-profile-receipt.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
    if (failure) throw failure;
}
