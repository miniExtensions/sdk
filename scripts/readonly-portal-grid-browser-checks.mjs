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
import{ReadonlyPortalGrid,CompleteReadOnlyTextField,PortalGridSingleLineTextCell,PortalGridEmptyCell,PortalGridRatingCell,PortalGridCheckboxCell}from'@miniextensions/sdk/react';
import'@miniextensions/sdk/react/readonly-portal-grid.css';
import'@miniextensions/sdk/react/portal-grid-single-line-text-cell.css';
import'@miniextensions/sdk/react/single-line-text.css';
import'@miniextensions/sdk/react/portal-grid-empty-cell.css';
import'@miniextensions/sdk/react/portal-grid-cell.css';
import'@miniextensions/sdk/react/rating.css';
import'@miniextensions/sdk/react/complete-checkbox.css';
const records=Object.freeze([{recordId:'second',name:'Alpha',amount:'0',notes:'Detailed note '.repeat(120)},{recordId:'first',name:'Beta',amount:'false',notes:'Small note'}].map(Object.freeze));
const original=JSON.stringify(records),hides=[],widths=[],opens=[],errors=[],pointers=[],headerEvents=[];let change,committed=0,retired=false,activeTrigger=null,returnCheck=null,stateRead=null,submits=0;
window.addEventListener('pointerdown',e=>pointers.push({type:e.pointerType,trusted:e.isTrusted}),{capture:true});
for(const type of ['click','auxclick','contextmenu'])document.addEventListener(type,event=>{if(!(event.target instanceof Element)||!event.target.closest('[role="tooltip"] a'))return;const item={type,button:event.button,trusted:event.isTrusted,atCapture:event.defaultPrevented,microtask:null,final:null};headerEvents.push(item);queueMicrotask(()=>{item.microtask=event.defaultPrevented;});setTimeout(()=>{item.final=event.defaultPrevented;},0);},{capture:true});
window.addEventListener('error',e=>errors.push(String(e.error||e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const columns=Object.freeze([{fieldId:'name',title:'<Name>',icon:'text'},{fieldId:'amount',title:'Amount',icon:'number'},{fieldId:'notes',title:'Notes',icon:'multiline-text',description:'<p><strong>Useful header</strong><a href="/stale-help-link">Help link</a><script>window.__headerUnsafe=true</script></p>',descriptionImageUrl:'/grid-header-help.svg'}].map(Object.freeze));
const leaf=value=>h(CompleteReadOnlyTextField,{value,language:'en'});
document.querySelector('#child-close').onclick=()=>{document.querySelector('#child').close();if(returnCheck?.()&&activeTrigger?.isConnected)activeTrigger.focus();};
function App(){const[state,set]=useState({scope:'original',revision:1,ready:true,live:true,copy:false,height:'short',empty:false,hidden:{original:{name:true}},widths:{original:{name:'180',amount:180,notes:220}}});
 const live=useRef(state);live.current=state;change=p=>{retired=false;set(s=>({...s,...p}));};
 useEffect(()=>{stateRead=state;committed++;});
 const scope=state.scope,revision=state.revision,isCurrent=()=>!retired&&live.current.live&&live.current.ready&&live.current.scope===scope&&live.current.revision===revision;
 const rows=state.empty?[]:records.map(r=>({recordId:r.recordId,label:r.name,cells:['notes','name','amount'].map(fieldId=>({fieldId,node:leaf(r[fieldId])}))}));
 return h('form',{onSubmit:e=>{e.preventDefault();submits++;}},h('button',{type:'button',id:'before'},'Before Grid'),h(ReadonlyPortalGrid,{columns,rows,primaryFieldId:'name',revision,preferenceScopeKey:scope,ready:state.ready,isCurrent,hiddenColumns:state.hidden[scope]||{},columnWidths:state.widths[scope]||{},allowHideColumns:true,doNotAllowUserToCopyTextOnGrid:state.copy,rowHeight:state.height,openRecordTestIds:{second:'native-open-second',first:'native-open-first'},onFieldHiddenChange:change=>{if(!isCurrent())throw Error('Stale hide reached host');hides.push({scope,revision,...change});set(s=>({...s,hidden:{...s.hidden,[scope]:{...s.hidden[scope],[change.fieldId]:change.isHidden}}}));},onColumnWidthCommit:change=>{if(!isCurrent())throw Error('Stale width reached host');widths.push({scope,revision,...change,measuredAtCommit:[...document.querySelectorAll('th[data-field-id]')].find(n=>n.dataset.fieldId===change.fieldId)?.clientWidth});set(s=>({...s,widths:{...s.widths,[scope]:{...s.widths[scope],[change.fieldId]:change.width}}}));},onOpenRecord:(recordId,trigger)=>{if(!isCurrent())throw Error('Stale Open reached host');opens.push({scope,revision,recordId,button:trigger.tagName});activeTrigger=trigger;returnCheck=isCurrent;document.querySelector('#child').showModal();}}),h('input',{id:'editable',defaultValue:'Editable unaffected','aria-label':'Editable control'}));
}
function TextCellProbe() {
    const [cell, setCell] = useState(() => ({
        record: 'A', frame: {}, value: 'Committed A', selected: false, conditional: false
    }));
    const writeLog = useRef([]);
    const openCount = useRef(0);
    const submitCount = useRef(0);
    const currentFrame = useRef(cell.frame);
    useEffect(() => {
        window.__textCellProbe = {
            snapshot: () => ({
                record: cell.record,
                value: cell.value,
                selected: cell.selected,
                writes: writeLog.current,
                opens: openCount.current,
                submits: submitCount.current,
            }),
            reject: () => setCell(current => ({ ...current, value: 'Committed A' })),
            replace: () => {
                const frame = {};
                currentFrame.current = frame;
                setCell({ record: 'B', frame, value: 'Committed B', selected: true, conditional: false });
            },
            replaceReadonly: () => {
                const frame = {};
                currentFrame.current = frame;
                setCell({ record: 'C', frame, value: 'Readonly C', selected: true, conditional: true });
            },
            setConditional: (conditional) => {
                const frame = {};
                currentFrame.current = frame;
                setCell(current => ({ ...current, frame, conditional }));
            },
        };
        return () => { delete window.__textCellProbe; };
    }, [cell]);
    return h('form', {
        onSubmit(event) { event.preventDefault(); submitCount.current++; }
    }, h('table', { 'aria-label': 'Writable Grid fixture' }, h('tbody', null,
        h('tr', null, h(PortalGridSingleLineTextCell, {
            value: cell.value,
            displayText: cell.value,
            title: 'Plain note',
            language: 'en',
            cellIdentity: cell.record,
            selected: cell.selected,
            rowHeight: 'medium',
            onSelect: () => setCell(current => ({ ...current, selected: true })),
            readOnlyGuidance: cell.conditional ? {
                label: 'Edit form required',
                text: cell.record === 'C'
                    ? 'Use the edit form for the replacement record.'
                    : 'Use the edit form for conditional fields.',
            } : undefined,
            editor: cell.conditional ? undefined : {
                owner: { token: cell.frame, isCurrent: () => currentFrame.current === cell.frame },
                onChange(value) {
                    writeLog.current.push({ record: cell.record, value });
                    setCell(current => ({ ...current, value }));
                },
            },
        }), h('td', null, h('button', {
            type: 'button',
            onClick: () => { openCount.current++; },
        }, 'Open from writable Grid'))))));
}
function EmptyCellProbe() {
    const actions = useRef({ writes: 0, selects: 0, opens: 0, submits: 0 });
    useEffect(() => {
        window.__emptyCellProbe = { snapshot: () => ({ ...actions.current }) };
        return () => { delete window.__emptyCellProbe; };
    }, []);
    const heights = ['short', 'medium', 'tall', 'extra-tall', 'fit-content'];
    return h('form', {
        onChange() { actions.current.writes++; },
        onSelect() { actions.current.selects++; },
        onSubmit(event) { event.preventDefault(); actions.current.submits++; },
    }, h('table', { 'aria-label': 'Empty Grid cell fixture' }, h('tbody', null,
        heights.map((rowHeight, index) => h('tr', { key: rowHeight, 'data-row-height': rowHeight },
            h('td', null, 'Before ' + rowHeight),
            h(PortalGridEmptyCell, { rowHeight, lastRow: index === heights.length - 1, stickyLeft: 37 }),
            h('td', null, h('button', {
                type: 'button',
                onClick() { actions.current.opens++; },
            }, 'Sibling action ' + rowHeight))
        ))
    )));
}
function RatingCellProbe() {
    const [cell, setCell] = useState(() => ({
        record: 'rating-A', frame: {}, value: 2, selected: false, enabled: true, revision: 0,
    }));
    const log = useRef({ writes: [], selects: 0, opens: 0, submits: 0, keys: [] });
    const currentFrame = useRef(cell.frame);
    const cancelNext = useRef(false);
    useEffect(() => {
        const belongs = event => event.target instanceof Element && event.target.closest('[data-rating-probe]');
        const cancel = event => {
            if (belongs(event) && cancelNext.current) {
                cancelNext.current = false;
                event.preventDefault();
            }
        };
        const record = event => {
            if (belongs(event)) log.current.keys.push({ key: event.key, repeat: event.repeat, composing: event.isComposing, trusted: event.isTrusted, prevented: event.defaultPrevented });
        };
        window.addEventListener('keydown', cancel, true);
        window.addEventListener('keydown', record);
        window.__ratingCellProbe = {
            snapshot: () => ({ record: cell.record, value: cell.value, selected: cell.selected, enabled: cell.enabled, revision: cell.revision, ...log.current }),
            patch: patch => setCell(current => ({ ...current, ...patch })),
            cancelNext: () => { cancelNext.current = true; },
            retire: () => { currentFrame.current = {}; },
            rerender: () => setCell(current => ({ ...current, revision: current.revision + 1 })),
            replace: () => {
                const frame = {};
                currentFrame.current = frame;
                setCell({ record: 'rating-B', frame, value: 4, selected: true, enabled: true, revision: 0 });
            },
        };
        return () => {
            window.removeEventListener('keydown', cancel, true);
            window.removeEventListener('keydown', record);
            delete window.__ratingCellProbe;
        };
    }, [cell]);
    return h('form', {
        'data-rating-probe': true,
        onSubmit(event) { event.preventDefault(); log.current.submits++; },
    }, h('table', {
        'aria-label': 'Rating Grid fixture',
        style: { width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 },
    }, h('thead', null, h('tr', null,
        h('th', { scope: 'col', style: { width: 200 } }, 'Priority rating'),
        h('th', { scope: 'col', style: { width: 160 } }, 'Record action')
    )), h('tbody', null, h('tr', null,
        h(PortalGridRatingCell, {
            value: cell.value,
            displayText: cell.value == null ? '' : String(cell.value),
            title: 'Priority rating',
            max: 5,
            icon: 'star',
            color: 'yellow',
            labels: { empty: 'No priority', repair: 'Repair priority' },
            cellIdentity: cell.record,
            selected: cell.selected,
            rowHeight: 'medium',
            onSelect() {
                log.current.selects++;
                setCell(current => ({ ...current, selected: true }));
            },
            editor: cell.enabled ? {
                owner: { token: cell.frame, isCurrent: () => currentFrame.current === cell.frame },
                onChange(value) {
                    log.current.writes.push({ record: cell.record, value });
                    setCell(current => ({ ...current, value }));
                },
            } : undefined,
        }), h('td', null, h('button', {
            type: 'button', onClick() { log.current.opens++; },
        }, 'Open from rating Grid'))
    ))), h('button', { type: 'submit' }, 'Submit synthetic rating'));
}
function CheckboxCellProbe() {
    const [cell, setCell] = useState(() => ({
        record: 'checkbox-A', frame: {}, value: false, selected: false, enabled: true, revision: 0, checkboxStyle: 'checkbox',
    }));
    const currentFrame = useRef(cell.frame);
    const log = useRef({ writes: [], selections: 0, opens: 0, submits: 0, rejections: [], activations: [], pointerPhases: [] });
    const isControl = (target) => target instanceof HTMLElement &&
        target.matches('input[type="checkbox"], button.mx-sdk-complete-checkbox__button');
    useEffect(() => {
        window.__checkboxCellProbe = {
            snapshot: () => ({ record: cell.record, value: cell.value, selected: cell.selected, enabled: cell.enabled, revision: cell.revision, checkboxStyle: cell.checkboxStyle, ...log.current }),
            patch: patch => setCell(current => ({ ...current, ...patch })),
            reject: () => {
                log.current.rejections.push({ record: cell.record, attempt: log.current.writes.length });
                setCell(current => ({ ...current, value: false }));
            },
            retire: () => { currentFrame.current = {}; },
            rerender: () => setCell(current => ({ ...current, revision: current.revision + 1 })),
            replace: () => {
                const frame = {};
                currentFrame.current = frame;
                setCell({ record: 'checkbox-B', frame, value: false, selected: false, enabled: true, revision: 0, checkboxStyle: cell.checkboxStyle });
            },
        };
        return () => { delete window.__checkboxCellProbe; };
    }, [cell]);
    return h('form', {
        id: 'checkbox-probe-form',
        onSubmit(event) { event.preventDefault(); log.current.submits++; },
        onClickCapture(event) {
            if (isControl(event.target))
                log.current.activations.push({ trusted: event.isTrusted, detail: event.detail });
        },
        onPointerDownCapture(event) {
            if (isControl(event.target))
                log.current.pointerPhases.push({ phase: 'down', record: cell.record, pointerType: event.pointerType, button: event.button, primary: event.isPrimary, trusted: event.isTrusted });
        },
        onPointerUpCapture(event) {
            if (isControl(event.target))
                log.current.pointerPhases.push({ phase: 'up', record: cell.record, pointerType: event.pointerType, button: event.button, primary: event.isPrimary, trusted: event.isTrusted });
        },
    }, h('p', { id: 'checkbox-help' }, 'Approval policy.'), h('table', {
        'aria-label': 'Checkbox Grid fixture',
        style: { width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 },
    }, h('thead', null, h('tr', null,
        h('th', { scope: 'col', style: { width: 200 } }, 'Approved'),
        h('th', { scope: 'col', style: { width: 160 } }, 'Record action')
    )), h('tbody', null, h('tr', null,
        h(PortalGridCheckboxCell, {
            value: cell.value,
            checkboxStyle: cell.checkboxStyle,
            checkedStateLabel: '  Approved  ',
            uncheckedStateLabel: '  Approve  ',
            displayText: cell.value == null ? '' : String(cell.value),
            title: 'Approved',
            cellIdentity: cell.record,
            selected: cell.selected,
            rowHeight: 'medium',
            onSelect() {
                log.current.selections++;
                setCell(current => ({ ...current, selected: true }));
            },
            editor: cell.enabled ? {
                owner: { token: cell.frame, isCurrent: () => currentFrame.current === cell.frame },
                id: 'checkbox-approval',
                form: 'checkbox-probe-form',
                ariaDescribedBy: 'checkbox-help',
                ariaInvalid: false,
                onChange(checked) {
                    log.current.writes.push({ record: cell.record, value: checked });
                    setCell(current => ({ ...current, value: checked }));
                },
            } : undefined,
        }), h('td', null, h('button', {
            type: 'button', onClick() { log.current.opens++; },
        }, 'Open from checkbox Grid'))
    ))), h('button', { type: 'submit' }, 'Submit synthetic checkbox'));
}
const root = createRoot(document.querySelector('#root'));
window.__nativeProbe={change:p=>change(p),retire:()=>{retired=true;},snapshot:()=>({react:React.version,platform:navigator.platform,committed,state:stateRead,externalRetired:retired,hides,widths,opens,submits,errors,pointers,headerEvents,canonicalUnchanged:JSON.stringify(records)===original}),
    startTextCell: () => root.render(h(StrictMode, null, h(TextCellProbe))),
    startEmptyCell: () => root.render(h(StrictMode, null, h(EmptyCellProbe))),
    startRatingCell: () => root.render(h(StrictMode, null, h(RatingCellProbe))),
    startCheckboxCell: (key = 'ordinary') => root.render(h(StrictMode, null, h(CheckboxCellProbe, { key })))
};
root.render(h(StrictMode,null,h(App)));
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
        '/react/PortalGridSingleLineTextCell.js',
        '/react/SingleLineTextField.js',
        '/react/portal-grid-single-line-text-cell.css',
        '/react/PortalGridEmptyCell.js',
        '/react/portal-grid-empty-cell.css',
        '/react/PortalGridRatingCell.js',
        '/react/ControlledRatingField.js',
        '/react/RatingInput.js',
        '/react/rating.css',
        '/react/PortalGridCheckboxCell.js',
        '/react/CompleteCheckboxField.js',
        '/react/CheckboxField.js',
        '/react/complete-checkbox.css',
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
    assert.equal(
        await page.getByTestId('native-open-second').getAttribute('aria-label'),
        'Open record Alpha'
    );
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
    assert.equal(
        end.widths.at(-1).width,
        await amount.evaluate((node) => node.clientWidth),
        'Host echo preserves the exact measured client width'
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
    assert.equal(
        end.widths.at(-1).width,
        await amount.evaluate((node) => node.clientWidth),
        'Host echo preserves the exact measured client width'
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

    const stableWidth = await amount.evaluate((node) => node.clientWidth);
    let settlements = (await snapshot()).widths.length;
    const stationaryBox = await handle.boundingBox();
    assert(stationaryBox);
    await page.mouse.move(
        stationaryBox.x + stationaryBox.width / 2,
        stationaryBox.y + stationaryBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(
        (n) => window.__nativeProbe.snapshot().widths.length === n + 1,
        settlements
    );
    assert.equal(
        await amount.evaluate((node) => node.clientWidth),
        stableWidth
    );
    assert.equal((await snapshot()).widths.at(-1).width, stableWidth);
    await handle.focus();
    for (const [key, expected] of [
        ['ArrowRight', stableWidth + 1],
        ['ArrowLeft', stableWidth],
    ]) {
        settlements = (await snapshot()).widths.length;
        await page.keyboard.down(key);
        await page.waitForFunction(
            (width) =>
                document.querySelector('th[data-field-id="amount"]')
                    .clientWidth === width,
            expected
        );
        await page.keyboard.up(key);
        await page.waitForFunction(
            (n) => window.__nativeProbe.snapshot().widths.length === n + 1,
            settlements
        );
        const settled = (await snapshot()).widths.at(-1);
        assert.equal(settled.width, expected);
        assert.equal(settled.measuredAtCommit, expected);
        assert.equal(
            await amount.evaluate((node) => node.clientWidth),
            expected
        );
    }
    await patch({ ready: false });
    await patch({ ready: true });
    assert.equal(
        await amount.evaluate((node) => node.clientWidth),
        stableWidth
    );
    assert.equal((await snapshot()).state.widths.original.amount, stableWidth);
    results.push({
        group: 'stationary pointer and ordinary ArrowRight/Left preserve measured width through echo and remount',
        width: stableWidth,
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
        await amount.evaluate((node) => node.clientWidth),
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
    await page.waitForFunction(() =>
        window.__nativeProbe
            .snapshot()
            .headerEvents.every((event) => event.final !== null)
    );
    const linkEvents = (await snapshot()).headerEvents;
    evidence.retiredHeaderDefaults = linkEvents;
    assert(
        linkEvents.some(
            (event) => event.type === 'auxclick' && event.button === 1
        )
    );
    assert(
        linkEvents.some(
            (event) => event.type === 'contextmenu' && event.button === 2
        )
    );
    assert(
        linkEvents.every(
            (event) =>
                event.trusted &&
                event.final === true &&
                ((event.type === 'auxclick' &&
                    (event.button === 1 || event.button === 2)) ||
                    (event.type === 'contextmenu' && event.button === 2))
        ),
        'Every native middle/right-click default must be cancelled, including a platform right-button auxclick'
    );
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
    const textCell = await checkPlainTextCellBrowser(page);
    const emptyCell = await checkEmptyCellBrowser(page);
    const ratingCell = await checkRatingCellBrowser(page);
    const checkboxCell = await checkCheckboxCellBrowser(page);
    end = await snapshot();
    assert.deepEqual(end.errors, []);
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
        textCell,
        emptyCell,
        ratingCell,
        checkboxCell,
        errors: end.errors,
        limits: [
            'Installed SDK presentation only; actual native borrowed-route, child admission and persistent preference qualification remain separate.',
        ],
    });
}

async function checkPlainTextCellBrowser(page) {
    await page.evaluate(() => window.__nativeProbe.startTextCell());
    const table = page.getByRole('table', { name: 'Writable Grid fixture' });
    const cell = table.getByRole('cell').first();
    await cell.waitFor({ state: 'visible' });
    assert.equal(
        await cell
            .locator('.mx-sdk-portal-grid-text-cell__content')
            .evaluate((element) => element.getBoundingClientRect().height),
        52
    );
    assert.equal(
        await cell
            .locator('.read-only-text')
            .evaluate((element) => getComputedStyle(element).webkitLineClamp),
        '2'
    );
    const state = () => page.evaluate(() => window.__textCellProbe.snapshot());
    const input = table.getByRole('textbox', { name: 'Plain note' });
    assert.equal(await input.count(), 0);
    await cell.click();
    await input.waitFor({ state: 'visible' });
    assert.equal(
        await cell.evaluate((element) => element === document.activeElement),
        true
    );
    assert.deepEqual((await state()).writes, []);
    assert.equal((await state()).opens, 0);

    await input.fill('Rejected A');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.deepEqual((await state()).writes, []);
    assert.equal(await input.inputValue(), 'Rejected A');
    await input.press('Enter');
    await page.waitForFunction(
        () => window.__textCellProbe.snapshot().writes.length === 1
    );
    assert.deepEqual((await state()).writes, [
        { record: 'A', value: 'Rejected A' },
    ]);
    await page.evaluate(() => window.__textCellProbe.reject());
    await page.waitForFunction(
        () =>
            document.querySelector('[aria-label="Plain note"]')?.value ===
            'Committed A'
    );
    await input.focus();
    await page.keyboard.press('Tab');
    assert.equal((await state()).writes.length, 1);

    await input.fill('Retired draft');
    await page.evaluate(() => window.__textCellProbe.replace());
    await page.waitForFunction(
        () =>
            document.querySelector('[aria-label="Plain note"]')?.value ===
            'Committed B'
    );
    assert.equal((await state()).writes.length, 1);
    await input.fill('Current B');
    await page.keyboard.press('Tab');
    await page.waitForFunction(
        () => window.__textCellProbe.snapshot().writes.length === 2
    );
    await input.fill('Retired by conditional policy');
    await page.evaluate(() => window.__textCellProbe.setConditional(true));
    const guidance = cell.getByRole('button', { name: 'Edit form required' });
    await guidance.waitFor({ state: 'visible' });
    assert.equal(await input.count(), 0);
    assert.equal(
        await cell.locator('.read-only-text').textContent(),
        'Current B'
    );
    await guidance.hover();
    const tooltip = page.getByRole('tooltip');
    await tooltip.waitFor({ state: 'visible' });
    assert.equal(
        await tooltip.textContent(),
        'Use the edit form for conditional fields.'
    );
    await guidance.focus();
    assert.equal(
        await guidance.getAttribute('aria-describedby'),
        await tooltip.getAttribute('id')
    );
    await guidance.press('Escape');
    await tooltip.waitFor({ state: 'hidden' });
    assert.equal(await guidance.getAttribute('aria-describedby'), null);
    await guidance.click();
    assert.equal(
        await cell.evaluate((node) => document.activeElement === node),
        true
    );
    const copied = await cell.evaluate((node) => {
        const clipboardData = new DataTransfer();
        node.dispatchEvent(
            new ClipboardEvent('copy', {
                bubbles: true,
                cancelable: true,
                clipboardData,
            })
        );
        return clipboardData.getData('text/plain');
    });
    assert.equal(copied, 'Current B');
    await page.keyboard.press('Tab');
    assert.equal(
        await guidance.evaluate((node) => document.activeElement === node),
        true
    );
    await guidance.press('Enter');
    assert.equal(
        await guidance.evaluate((node) => document.activeElement === node),
        true
    );
    await tooltip.waitFor({ state: 'visible' });
    assert.equal((await state()).writes.length, 2);
    const previousCell = await cell.elementHandle();
    assert.ok(previousCell);
    try {
        await page.evaluate(() => window.__textCellProbe.replaceReadonly());
        await page.waitForFunction(
            () => window.__textCellProbe.snapshot().record === 'C'
        );
        assert.equal(
            await cell.evaluate(
                (node, previous) => node === previous,
                previousCell
            ),
            true
        );
    } finally {
        await previousCell.dispose();
    }
    assert.equal(await tooltip.count(), 0);
    assert.equal(await guidance.getAttribute('aria-describedby'), null);
    assert.equal(
        await guidance.evaluate((node) => document.activeElement === node),
        false
    );
    assert.equal(
        await cell.locator('.read-only-text').textContent(),
        'Readonly C'
    );
    await guidance.focus();
    await tooltip.waitFor({ state: 'visible' });
    assert.equal(
        await tooltip.textContent(),
        'Use the edit form for the replacement record.'
    );
    await page.evaluate(() => window.__textCellProbe.setConditional(false));
    await input.waitFor({ state: 'visible' });
    assert.equal(await input.inputValue(), 'Readonly C');
    assert.equal(await guidance.count(), 0);
    const result = await state();
    assert.deepEqual(result.writes, [
        { record: 'A', value: 'Rejected A' },
        { record: 'B', value: 'Current B' },
    ]);
    assert.equal(result.submits, 0);
    assert.equal(result.opens, 0);
    return {
        status: 'passed',
        conditionalGuidance: true,
        guidanceIdentityRetired: true,
        ...result,
    };
}

async function checkEmptyCellBrowser(page) {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.evaluate(() => window.__nativeProbe.startEmptyCell());
    const table = page.getByRole('table', { name: 'Empty Grid cell fixture' });
    await table.waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__emptyCellProbe != null);
    const cells = table.locator('.mx-sdk-portal-grid-empty-cell');
    assert.equal(await cells.count(), 5);
    const desktop = await cells.evaluateAll((nodes) =>
        nodes.map((node) => {
            const content = node.querySelector(
                '.mx-sdk-portal-grid-empty-cell__content'
            );
            const style = getComputedStyle(node);
            return {
                rowHeight: node.parentElement.dataset.rowHeight,
                tag: node.tagName,
                parentTag: node.parentElement.tagName,
                index: node.cellIndex,
                siblingIndexes: [...node.parentElement.children].map(
                    (sibling) => sibling.cellIndex
                ),
                siblingTags: [...node.parentElement.children].map(
                    (sibling) => sibling.tagName
                ),
                text: node.textContent,
                children: node.children.length,
                contentTag: content?.tagName ?? null,
                contentHeight: content?.getBoundingClientRect().height ?? null,
                interactiveCount: node.querySelectorAll(
                    'input, button, a, textarea, select, [contenteditable="true"]'
                ).length,
                tabIndexAttribute: node.getAttribute('tabindex'),
                tabIndex: node.tabIndex,
                position: style.position,
                left: style.left,
                bottomBorder: style.borderBottomWidth,
            };
        })
    );
    assert.deepEqual(
        desktop.map((cell) => [cell.rowHeight, cell.contentHeight]),
        [
            ['short', 24],
            ['medium', 52],
            ['tall', 84],
            ['extra-tall', 140],
            ['fit-content', 0],
        ]
    );
    for (const cell of desktop) {
        assert.equal(cell.tag, 'TD');
        assert.equal(cell.parentTag, 'TR');
        assert.equal(cell.index, 1);
        assert.deepEqual(cell.siblingIndexes, [0, 1, 2]);
        assert.deepEqual(cell.siblingTags, ['TD', 'TD', 'TD']);
        assert.equal(cell.text, '');
        assert.equal(cell.children, 1);
        assert.equal(cell.contentTag, 'DIV');
        assert.equal(cell.interactiveCount, 0);
        assert.equal(cell.tabIndexAttribute, null);
        assert.equal(cell.tabIndex, -1);
        assert.equal(cell.position, 'sticky');
        assert.equal(cell.left, '37px');
        assert.equal(
            cell.bottomBorder,
            cell.rowHeight === 'fit-content' ? '0px' : '1px'
        );
    }
    const before = await page.evaluate(() =>
        window.__emptyCellProbe.snapshot()
    );
    assert.deepEqual(before, { writes: 0, selects: 0, opens: 0, submits: 0 });
    for (let index = 0; index < desktop.length; index++) {
        await cells.nth(index).click();
        assert.equal(
            await cells
                .nth(index)
                .evaluate((node) => node === node.ownerDocument.activeElement),
            false,
            'Empty cells must not acquire focus when clicked'
        );
    }
    const actions = await page.evaluate(() =>
        window.__emptyCellProbe.snapshot()
    );
    assert.deepEqual(actions, before);
    await page.setViewportSize({ width: 639, height: 900 });
    const narrow = await cells.evaluateAll((nodes) =>
        nodes.map((node) => ({
            rowHeight: node.parentElement.dataset.rowHeight,
            position: getComputedStyle(node).position,
            contentHeight: node
                .querySelector('.mx-sdk-portal-grid-empty-cell__content')
                .getBoundingClientRect().height,
        }))
    );
    assert(narrow.every((cell) => cell.position === 'relative'));
    assert.deepEqual(
        narrow.map((cell) => cell.contentHeight),
        desktop.map((cell) => cell.contentHeight)
    );
    assert.deepEqual(
        await page.evaluate(() => window.__emptyCellProbe.snapshot()),
        actions
    );
    await page.setViewportSize({ width: 1200, height: 900 });
    return { status: 'passed', desktop, narrow, actions };
}

async function checkRatingCellBrowser(page) {
    await page.evaluate(() => window.__nativeProbe.startRatingCell());
    const table = page.getByRole('table', { name: 'Rating Grid fixture' });
    await table.waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__ratingCellProbe != null);
    const state = () =>
        page.evaluate(() => window.__ratingCellProbe.snapshot());
    const patch = async (value) => {
        await page.evaluate(
            (next) => window.__ratingCellProbe.patch(next),
            value
        );
        await page.waitForFunction((expected) => {
            const current = window.__ratingCellProbe.snapshot();
            return Object.entries(expected).every(
                ([key, value]) => current[key] === value
            );
        }, value);
    };
    const cell = table.locator('.mx-sdk-portal-grid-rating-cell');
    const icons = cell.locator('.mx-sdk-rating-icon');
    const input = cell.getByRole('slider', {
        name: 'Priority rating',
        exact: true,
    });
    assert.equal(await cell.count(), 1);
    assert.equal(await icons.count(), 5);
    assert.equal(await input.count(), 0);
    assert.equal(
        await cell.locator('.mx-sdk-rating-sr-only').textContent(),
        '(2/5)'
    );
    const geometry = await cell.evaluate((node) => {
        const icon = node.querySelector('.mx-sdk-rating-icon');
        const thirdIcon = node.querySelectorAll('.mx-sdk-rating-icon')[2];
        const hitBox = thirdIcon.getBoundingClientRect();
        const hit = node.ownerDocument.elementFromPoint(
            hitBox.left + hitBox.width / 2,
            hitBox.top + hitBox.height / 2
        );
        const content = node.querySelector(
            '.mx-sdk-portal-grid-text-cell__content'
        );
        const style = getComputedStyle(node);
        const iconStyle = getComputedStyle(icon);
        return {
            tag: node.tagName,
            parentTag: node.parentElement.tagName,
            neutralShell: node.classList.contains('mx-sdk-portal-grid-cell'),
            legacyTextCell: node.classList.contains(
                'mx-sdk-portal-grid-text-cell'
            ),
            padding: [style.paddingTop, style.paddingLeft],
            contentHeight: content.getBoundingClientRect().height,
            iconWidth: iconStyle.width,
            iconHeight: iconStyle.height,
            iconDisplay: getComputedStyle(icon.parentElement).display,
            thirdIconHit: thirdIcon.contains(hit),
        };
    });
    assert.deepEqual(geometry, {
        tag: 'TD',
        parentTag: 'TR',
        neutralShell: true,
        legacyTextCell: false,
        padding: ['8px', '12px'],
        contentHeight: 52,
        iconWidth: '24px',
        iconHeight: '24px',
        iconDisplay: 'flex',
        thirdIconHit: true,
    });
    await icons.nth(2).click();
    await input.waitFor({ state: 'visible' });
    assert.equal((await state()).selected, true);
    assert.equal((await state()).selects, 1);
    assert.deepEqual((await state()).writes, []);

    await icons.nth(2).click();
    await page.waitForFunction(
        () => window.__ratingCellProbe.snapshot().writes.length === 1
    );
    assert.deepEqual((await state()).writes, [
        { record: 'rating-A', value: 3 },
    ]);
    assert.equal(await input.inputValue(), '3');
    assert.equal(
        await cell.locator('.mx-sdk-rating-print').textContent(),
        '(3/5)'
    );

    for (const [key, count] of [
        ['Delete', 2],
        ['Backspace', 3],
    ]) {
        await patch({ value: 3 });
        await input.focus();
        await input.press(key);
        await page.waitForFunction(
            (expected) =>
                window.__ratingCellProbe.snapshot().writes.length === expected,
            count
        );
        const observed = await state();
        assert.deepEqual(observed.writes.at(-1), {
            record: 'rating-A',
            value: null,
        });
        assert.equal(observed.value, null);
        assert.equal(observed.keys.at(-1).key, key);
        assert.equal(observed.keys.at(-1).prevented, true);
        assert.equal(observed.keys.at(-1).trusted, true);
        assert.equal(observed.submits, 0);
        await input.press(key);
        assert.equal((await state()).writes.length, count);
    }

    await patch({ value: 3 });
    await input.dispatchEvent('keydown', {
        key: 'Delete',
        repeat: true,
        cancelable: true,
    });
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).keys.at(-1).repeat, true);
    assert.equal((await state()).keys.at(-1).prevented, true);
    await input.dispatchEvent('keydown', {
        key: 'Backspace',
        isComposing: true,
        cancelable: true,
    });
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).keys.at(-1).composing, true);
    await page.evaluate(() => window.__ratingCellProbe.cancelNext());
    await input.press('Delete');
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).keys.at(-1).prevented, true);
    await input.press('Escape');
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).value, 3);

    await patch({ enabled: false });
    assert.equal(await input.count(), 0);
    await icons.nth(4).click();
    await cell.focus();
    await page.keyboard.press('Delete');
    assert.equal((await state()).writes.length, 3);
    const readonlySummary = await cell
        .locator('.mx-sdk-rating-sr-only')
        .textContent();
    assert.equal(readonlySummary, '(3/5)');
    await patch({ value: null });
    assert.equal(await cell.textContent(), '');
    assert.equal(await icons.count(), 0);

    await patch({ enabled: true, value: 3 });
    await input.waitFor({ state: 'visible' });
    await page.evaluate(() => window.__ratingCellProbe.retire());
    await input.focus();
    await input.press('Delete');
    await icons.nth(3).click();
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).value, 3);

    await page.evaluate(() => window.__ratingCellProbe.replace());
    await page.waitForFunction(
        () => window.__ratingCellProbe.snapshot().record === 'rating-B'
    );
    assert.equal(await input.inputValue(), '4');
    const mounted = await input.elementHandle();
    assert(mounted);
    await input.focus();
    await page.evaluate(() => window.__ratingCellProbe.rerender());
    await page.waitForFunction(
        () => window.__ratingCellProbe.snapshot().revision === 1
    );
    assert.equal(
        await input.evaluate((node, previous) => node === previous, mounted),
        true,
        'An ordinary canonical rerender must retain the Rating input'
    );
    assert.equal(
        await input.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true
    );
    assert.equal((await state()).writes.length, 3);
    await mounted.dispose();
    await icons.nth(1).click();
    await page.waitForFunction(
        () => window.__ratingCellProbe.snapshot().writes.length === 4
    );
    const result = await state();
    assert.deepEqual(result.writes, [
        { record: 'rating-A', value: 3 },
        { record: 'rating-A', value: null },
        { record: 'rating-A', value: null },
        { record: 'rating-B', value: 2 },
    ]);
    assert.equal(result.value, 2);
    assert.equal(result.opens, 0);
    assert.equal(result.submits, 0);
    return {
        status: 'passed',
        geometry,
        readonlySummary,
        nonMutating: [
            'repeat',
            'composition',
            'cancelled key',
            'Escape',
            'readonly',
            'stale owner',
        ],
        ...result,
    };
}

async function checkCheckboxCellBrowser(page) {
    await page.evaluate(() => window.__nativeProbe.startCheckboxCell());
    const table = page.getByRole('table', { name: 'Checkbox Grid fixture' });
    await table.waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__checkboxCellProbe != null);
    const state = () =>
        page.evaluate(() => window.__checkboxCellProbe.snapshot());
    const patch = async (value) => {
        await page.evaluate(
            (next) => window.__checkboxCellProbe.patch(next),
            value
        );
        await page.waitForFunction((expected) => {
            const current = window.__checkboxCellProbe.snapshot();
            return Object.entries(expected).every(
                ([key, value]) => current[key] === value
            );
        }, value);
    };
    const waitForWrites = (count) =>
        page.waitForFunction(
            (expected) =>
                window.__checkboxCellProbe.snapshot().writes.length ===
                expected,
            count
        );
    const cell = table.locator('.mx-sdk-portal-grid-checkbox-cell');
    const input = cell.getByRole('checkbox', { name: 'Approved', exact: true });
    assert.equal(await cell.count(), 1);
    assert.equal((await state()).selected, false);
    assert.equal(await input.isEnabled(), true);
    assert.equal(await input.isChecked(), false);
    assert.equal(await input.getAttribute('id'), 'checkbox-approval');
    assert.equal(await input.getAttribute('aria-describedby'), 'checkbox-help');
    assert.equal(await input.getAttribute('aria-invalid'), 'false');
    assert.equal(
        await input.evaluate((node) => node.form?.id),
        'checkbox-probe-form'
    );
    const originalCell = await cell.elementHandle();
    const originalInput = await input.elementHandle();
    assert(originalCell && originalInput);
    const geometry = await input.evaluate((node) => {
        const cell = node.closest('td');
        const style = getComputedStyle(node);
        return {
            cellTag: cell.tagName,
            parentTag: cell.parentElement.tagName,
            neutralShell: cell.classList.contains('mx-sdk-portal-grid-cell'),
            width: style.width,
            height: style.height,
            contentHeight: cell
                .querySelector('.mx-sdk-portal-grid-text-cell__content')
                .getBoundingClientRect().height,
        };
    });
    assert.deepEqual(geometry, {
        cellTag: 'TD',
        parentTag: 'TR',
        neutralShell: true,
        width: '20px',
        height: '20px',
        contentHeight: 20,
    });

    await input.click();
    await waitForWrites(1);
    assert.deepEqual((await state()).writes, [
        { record: 'checkbox-A', value: true },
    ]);
    assert.equal((await state()).selected, true);
    assert.equal(await input.isChecked(), true);
    assert.equal(
        await input.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true,
        'The native checkbox keeps focus after its first pointer activation'
    );
    assert.deepEqual((await state()).activations[0], {
        trusted: true,
        detail: 1,
    });

    await page.evaluate(() => window.__checkboxCellProbe.reject());
    await page.waitForFunction(
        () => window.__checkboxCellProbe.snapshot().value === false
    );
    assert.equal(await input.isChecked(), false);
    assert.equal((await state()).writes.length, 1);
    assert.deepEqual((await state()).rejections, [
        { record: 'checkbox-A', attempt: 1 },
    ]);
    assert.equal(
        await input.evaluate(
            (node, original) => node === original,
            originalInput
        ),
        true,
        'Host rollback restores the existing controlled input'
    );
    assert.equal(
        await input.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true
    );

    await input.press('Space');
    await waitForWrites(2);
    assert.deepEqual((await state()).writes.at(-1), {
        record: 'checkbox-A',
        value: true,
    });
    assert.deepEqual((await state()).activations.at(-1), {
        trusted: true,
        detail: 0,
    });
    await input.press('Space');
    await waitForWrites(3);
    assert.deepEqual((await state()).writes.at(-1), {
        record: 'checkbox-A',
        value: false,
    });
    assert.equal(await input.isChecked(), false);

    await patch({ selected: false });
    const bounds = await cell.boundingBox();
    assert(bounds);
    await cell.click({
        position: { x: bounds.width - 4, y: bounds.height - 4 },
    });
    await page.waitForFunction(
        () => window.__checkboxCellProbe.snapshot().selected === true
    );
    assert.equal((await state()).writes.length, 3);
    assert.equal(
        await cell.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true,
        'Only a background click moves focus to the cell surface'
    );
    await input.focus();
    await page.evaluate(() => window.__checkboxCellProbe.rerender());
    await page.waitForFunction(
        () => window.__checkboxCellProbe.snapshot().revision === 1
    );
    assert.equal(
        await cell.evaluate(
            (node, original) => node === original,
            originalCell
        ),
        true
    );
    assert.equal(
        await input.evaluate(
            (node, original) => node === original,
            originalInput
        ),
        true
    );
    assert.equal(
        await input.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true,
        'Ordinary canonical rerenders preserve checkbox focus'
    );
    assert.equal((await state()).writes.length, 3);

    await page.evaluate(() => window.__checkboxCellProbe.retire());
    await input.press('Space');
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).value, false);
    await input.click();
    assert.equal((await state()).writes.length, 3);
    assert.equal((await state()).value, false);
    await input.focus();
    await page.evaluate(() => window.__checkboxCellProbe.replace());
    await page.waitForFunction(
        () => window.__checkboxCellProbe.snapshot().record === 'checkbox-B'
    );
    assert.equal(
        await cell.evaluate(
            (node, original) => node === original,
            originalCell
        ),
        true,
        'The mounted table cell survives record and owner replacement'
    );
    assert.equal(
        await originalInput.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        false,
        'Replacing the owner and identity clears the old control focus'
    );
    assert.equal(await input.isChecked(), false);
    await input.click();
    await waitForWrites(4);
    assert.deepEqual((await state()).writes.at(-1), {
        record: 'checkbox-B',
        value: true,
    });
    assert.equal(
        await input.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true
    );

    await patch({ enabled: false });
    assert.equal(await input.count(), 0);
    const indicator = cell.locator('[data-checkbox-grid-value]');
    assert.equal(
        await indicator.getAttribute('data-checkbox-grid-value'),
        'true'
    );
    await indicator.click();
    assert.equal((await state()).writes.length, 4);
    await patch({ value: false });
    assert.equal(
        await indicator.getAttribute('data-checkbox-grid-value'),
        'false'
    );
    await indicator.click();
    assert.equal((await state()).writes.length, 4);
    await patch({ value: null });
    assert.equal(await input.count(), 0);
    assert.equal(await indicator.count(), 0);
    assert.equal(await cell.textContent(), '');
    const result = await state();
    assert.deepEqual(result.writes, [
        { record: 'checkbox-A', value: true },
        { record: 'checkbox-A', value: true },
        { record: 'checkbox-A', value: false },
        { record: 'checkbox-B', value: true },
    ]);
    assert(result.writes.every((write) => typeof write.value === 'boolean'));
    assert.equal(result.opens, 0);
    assert.equal(result.submits, 0);
    await originalInput.dispose();
    await originalCell.dispose();
    const splitPointer = await checkCheckboxSplitPointerBrowser(page);
    const toggleStyle = await checkCheckboxToggleStyleBrowser(page);
    const buttonStyle = await checkCheckboxButtonStyleBrowser(page);
    return {
        status: 'passed',
        geometry,
        nonMutating: [
            'host rollback',
            'background selection',
            'rerender',
            'retired owner',
            'readonly',
            'blank',
        ],
        ...result,
        splitPointer,
        toggleStyle,
        buttonStyle,
    };
}

async function checkCheckboxSplitPointerBrowser(page) {
    await page.evaluate(() =>
        window.__nativeProbe.startCheckboxCell('split-pointer')
    );
    await page.waitForFunction(() => {
        const current = window.__checkboxCellProbe?.snapshot();
        return current?.record === 'checkbox-A' && current.writes.length === 0;
    });
    const table = page.getByRole('table', { name: 'Checkbox Grid fixture' });
    const input = table.getByRole('checkbox', {
        name: 'Approved',
        exact: true,
    });
    const state = () =>
        page.evaluate(() => window.__checkboxCellProbe.snapshot());
    assert.equal((await state()).selected, false);
    assert.equal(await input.isEnabled(), true);
    assert.equal(await input.isChecked(), false);
    const before = await input.boundingBox();
    assert(before);
    let pointerHeld = false;
    let failure;
    let after;
    let released;
    try {
        await page.mouse.move(
            before.x + before.width / 2,
            before.y + before.height / 2
        );
        await page.mouse.down({ button: 'left' });
        pointerHeld = true;
        assert.deepEqual((await state()).writes, []);
        await page.evaluate(() => window.__checkboxCellProbe.replace());
        await page.waitForFunction(
            () => window.__checkboxCellProbe.snapshot().record === 'checkbox-B'
        );
        assert.equal((await state()).selected, false);
        assert.equal(await input.isEnabled(), true);
        after = await input.boundingBox();
        assert(after);
        assert.deepEqual(
            after,
            before,
            'The successor checkbox occupies the same position'
        );
        assert.deepEqual((await state()).writes, []);
        await page.mouse.up({ button: 'left' });
        pointerHeld = false;
        released = await state();
        assert.deepEqual(
            released.writes,
            [],
            'An A pointer-down followed by B pointer-up must reach neither writer'
        );
        assert.equal(released.value, false);
        assert.equal(released.opens, 0);
        assert.equal(released.submits, 0);
        assert.deepEqual(released.pointerPhases, [
            {
                phase: 'down',
                record: 'checkbox-A',
                pointerType: 'mouse',
                button: 0,
                primary: true,
                trusted: true,
            },
            {
                phase: 'up',
                record: 'checkbox-B',
                pointerType: 'mouse',
                button: 0,
                primary: true,
                trusted: true,
            },
        ]);
    } catch (error) {
        failure = error;
    } finally {
        if (pointerHeld) {
            try {
                await page.mouse.up({ button: 'left' });
            } catch (error) {
                failure ??= error;
            }
        }
    }
    if (failure) throw failure;

    const currentInput = await input.elementHandle();
    assert(currentInput);
    try {
        await input.click();
        await page.waitForFunction(
            () => window.__checkboxCellProbe.snapshot().writes.length === 1
        );
        assert.deepEqual((await state()).writes, [
            { record: 'checkbox-B', value: true },
        ]);
        assert.equal(await input.isChecked(), true);
        assert.equal(
            await input.evaluate(
                (node) => node === node.ownerDocument.activeElement
            ),
            true,
            'A fresh B click retains native input focus'
        );
        await page.evaluate(() => window.__checkboxCellProbe.rerender());
        await page.waitForFunction(
            () => window.__checkboxCellProbe.snapshot().revision === 1
        );
        assert.equal(
            await input.evaluate(
                (node, original) => node === original,
                currentInput
            ),
            true,
            'The current placement retains its input through an ordinary rerender'
        );
        assert.equal(
            await input.evaluate(
                (node) => node === node.ownerDocument.activeElement
            ),
            true
        );
        const fresh = await state();
        assert.deepEqual(fresh.writes, [{ record: 'checkbox-B', value: true }]);
        assert.equal(fresh.opens, 0);
        assert.equal(fresh.submits, 0);
        return { status: 'passed', before, after, released, fresh };
    } finally {
        await currentInput.dispose();
    }
}

async function checkCheckboxToggleStyleBrowser(page) {
    await page.evaluate(() =>
        window.__nativeProbe.startCheckboxCell('toggle-style')
    );
    await page.waitForFunction(() => {
        const current = window.__checkboxCellProbe?.snapshot();
        return current?.record === 'checkbox-A' && current.writes.length === 0;
    });
    const table = page.getByRole('table', { name: 'Checkbox Grid fixture' });
    const input = table.getByRole('checkbox', {
        name: 'Approved',
        exact: true,
    });
    const previous = await input.elementHandle();
    assert(previous);
    const before = await previous.boundingBox();
    assert(before);
    const x = before.x + before.width / 2;
    const y = before.y + before.height / 2;
    const toggle = table.locator('[data-style="toggle"] input');
    const state = () =>
        page.evaluate(() => window.__checkboxCellProbe.snapshot());

    try {
        await page.mouse.move(x, y);
        await page.mouse.down();
        try {
            await page.evaluate(() =>
                window.__checkboxCellProbe.patch({ checkboxStyle: 'toggle' })
            );
            await toggle.waitFor({ state: 'visible' });
            assert.equal(
                await previous.evaluate((node) => node.isConnected),
                false
            );
            const bounds = await toggle.boundingBox();
            assert(bounds);
            assert(x > bounds.x && x < bounds.x + bounds.width);
            assert(y > bounds.y && y < bounds.y + bounds.height);
        } finally {
            await page.mouse.up();
        }
    } finally {
        await previous.dispose();
    }

    const released = await state();
    assert.deepEqual(released.writes, []);
    assert.deepEqual(
        released.pointerPhases.map(({ phase, record, trusted }) => ({
            phase,
            record,
            trusted,
        })),
        [
            { phase: 'down', record: 'checkbox-A', trusted: true },
            { phase: 'up', record: 'checkbox-A', trusted: true },
        ]
    );
    assert.equal(await input.isChecked(), false);
    await input.click();
    assert.equal(await input.isChecked(), true);
    assert.equal(
        await input.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true
    );
    await input.press('Space');
    assert.equal(await input.isChecked(), false);
    const fresh = await state();
    assert.deepEqual(fresh.writes, [
        { record: 'checkbox-A', value: true },
        { record: 'checkbox-A', value: false },
    ]);
    assert.equal(fresh.opens, 0);
    assert.equal(fresh.submits, 0);
    return { status: 'passed', released, fresh };
}

async function checkCheckboxButtonStyleBrowser(page) {
    await page.evaluate(() =>
        window.__nativeProbe.startCheckboxCell('button-style')
    );
    await page.waitForFunction(() => {
        const current = window.__checkboxCellProbe?.snapshot();
        return current?.record === 'checkbox-A' && current.writes.length === 0;
    });
    await page.evaluate(() =>
        window.__checkboxCellProbe.patch({ checkboxStyle: 'button' })
    );
    const table = page.getByRole('table', { name: 'Checkbox Grid fixture' });
    const approve = table.getByRole('button', { name: 'Approve', exact: true });
    await approve.waitFor({ state: 'visible' });
    assert.equal(await approve.getAttribute('type'), 'button');
    assert.equal(await approve.getAttribute('aria-pressed'), 'false');
    assert.equal(
        await approve.evaluate((node) => node.form?.id),
        'checkbox-probe-form'
    );
    const previous = await approve.elementHandle();
    assert(previous);
    const bounds = await previous.boundingBox();
    assert(bounds);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    try {
        await page.mouse.move(x, y);
        await page.mouse.down();
        try {
            await page.evaluate(() => window.__checkboxCellProbe.replace());
            await page.waitForFunction(
                () =>
                    window.__checkboxCellProbe.snapshot().record ===
                    'checkbox-B'
            );
            assert.equal(
                await previous.evaluate((node) => node.isConnected),
                false
            );
            const replacement = await approve.boundingBox();
            assert(replacement);
            assert(x > replacement.x && x < replacement.x + replacement.width);
            assert(y > replacement.y && y < replacement.y + replacement.height);
        } finally {
            await page.mouse.up();
        }
    } finally {
        await previous.dispose();
    }
    const snapshot = () =>
        page.evaluate(() => window.__checkboxCellProbe.snapshot());
    const released = await snapshot();
    assert.deepEqual(released.writes, []);
    assert.deepEqual(
        released.pointerPhases.map(({ phase, record, trusted }) => ({
            phase,
            record,
            trusted,
        })),
        [
            { phase: 'down', record: 'checkbox-A', trusted: true },
            { phase: 'up', record: 'checkbox-B', trusted: true },
        ]
    );
    await approve.click();
    const approved = table.getByRole('button', {
        name: 'Approved',
        exact: true,
    });
    assert.equal(await approved.getAttribute('aria-pressed'), 'true');
    assert.equal(
        await approved.evaluate(
            (node) => node === node.ownerDocument.activeElement
        ),
        true
    );
    await approved.press('Space');
    assert.equal(await approve.getAttribute('aria-pressed'), 'false');
    const fresh = await snapshot();
    assert.deepEqual(fresh.writes, [
        { record: 'checkbox-B', value: true },
        { record: 'checkbox-B', value: false },
    ]);
    assert.equal(fresh.opens, 0);
    assert.equal(fresh.submits, 0);
    return { status: 'passed', released, fresh };
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
