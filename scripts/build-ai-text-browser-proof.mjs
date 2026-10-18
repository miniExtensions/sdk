// Build only. Inspect the retained page with the supported browser separately.
// Usage: node scripts/build-ai-text-browser-proof.mjs installed-consumer tested.tgz fresh-output
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { aiTextLoadedFixture } from './ai-text-consumer-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') =>
    createHash(algorithm).update(bytes).digest(encoding);
const git = (...args) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
function sourceReceipt() {
    const paths = new Set([
        ...git('diff', '--name-only', '-z', 'HEAD').split('\0'),
        ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
    ]);
    paths.delete('');
    return {
        head: git('rev-parse', 'HEAD').trim(),
        branch: git('branch', '--show-current').trim(),
        status: git('status', '--porcelain=v1'),
        diffSha256: digest(git('diff', '--binary', 'HEAD')),
        dirtyFiles: [...paths].sort().map((path) => {
            const fullPath = join(repository, path);
            if (!existsSync(fullPath)) return { path, kind: 'missing' };
            const stat = lstatSync(fullPath);
            if (stat.isSymbolicLink())
                return {
                    path,
                    kind: 'symlink',
                    target: readlinkSync(fullPath),
                };
            assert(stat.isFile(), `Unexpected non-file source entry: ${path}`);
            return {
                path,
                kind: 'file',
                sha256: digest(readFileSync(fullPath)),
            };
        }),
    };
}

// Every value is synthetic. SDK imports resolve solely inside the installed
// consumer. Fixture actions replace local owners; no remote service is attached.
function browserMain({ loaded, expected, portal }) {
    const h = React.createElement;
    const counters = {
        writes: 0,
        saves: 0,
        network: 0,
        rows: 0,
        forbiddenReads: 0,
        portalReads: 0,
        replacementReads: 0,
    };
    const errors = [];
    const result = document.getElementById('proof-result');
    const evidence = {
        scope: 'synthetic installed-package DOM proof',
        interactions: [],
        actions: [],
    };
    const check = (condition, message) => {
        if (!condition) throw Error(message);
    };
    const forbidden = (counter) => () => {
        counters[counter]++;
        throw Error(`Forbidden synthetic proof action: ${counter}`);
    };
    const poison = forbidden('forbiddenReads');
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic-sdk.invalid',
        fetch: forbidden('network'),
    });
    client.forms.save = forbidden('saves');
    client.portals.updateGridCell = forbidden('saves');
    window.addEventListener('error', (event) => errors.push(event.message));
    window.addEventListener('unhandledrejection', (event) =>
        errors.push(String(event.reason))
    );
    const options = {
        client,
        getScope: () => ({ ownerId: 'ai-text-synthetic-form', revision: 0 }),
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    };
    const fields = createFormFieldBindings({ ...options, loaded });
    const lifecycleFields = createFormFieldBindings({
        ...options,
        loaded: structuredClone(loaded),
    });
    const scope = createFormRenderScope({
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const binding = fields.field('source');
    for (const id of loaded.payload.fieldIdsInForm)
        fields.field(id).setValue = forbidden('writes');
    let lifecycleBinding = lifecycleFields.field('source');
    lifecycleBinding.setValue = forbidden('writes');
    const nativeBefore = JSON.stringify(fields.controller.getState());
    const base = scope
        .getSnapshot()
        .fields.find(({ fieldId }) => fieldId === 'source')
        .host.getSnapshot().fields[0];
    const sourceText = loaded.payload.formRecord.data.source.value;
    let lifecycleText = sourceText;
    let lifecycleNative = JSON.stringify(lifecycleBinding.getSnapshot().value);
    let predecessor;
    let replaced = false;
    let retired = false;
    let portalRetired = false;
    let remounts = 0;
    let root;

    const maskedProps = {
        ...base,
        title: 'Masked value reference',
        displayConfig: { obscurePassword: true },
        writeConfig: null,
    };
    Object.defineProperty(maskedProps, 'value', { get: poison });
    const maskedNative = {};
    for (const property of [
        'state',
        'value',
        'isStale',
        'errorType',
        'prompt',
        'references',
    ])
        Object.defineProperty(maskedNative, property, { get: poison });
    const maskedNativeProps = {
        ...base,
        title: 'Masked native properties',
        displayConfig: { showTitle: false },
        writeConfig: { maskPasswordOnLoginScreen: true },
        value: maskedNative,
    };
    function snapshotBinding(mode) {
        const original = binding.getSnapshot();
        const snapshot = {
            ...original,
            field: {
                ...original.field,
                schema: {
                    ...original.field.schema,
                    miniExtConfig: { obscurePassword: true },
                },
            },
            visibility: {
                type:
                    mode === 'masked'
                        ? 'visible'
                        : mode === 'blocked'
                          ? 'blocked'
                          : 'hidden',
                diagnostics: [],
                ...(mode === 'blocked' ? { code: 'invalid' } : {}),
            },
            retired: mode === 'retired',
        };
        Object.defineProperty(snapshot, 'value', { get: poison });
        if (mode !== 'masked')
            Object.defineProperty(snapshot, 'field', { get: poison });
        return {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            setValue: forbidden('writes'),
            scalar: null,
            selection: null,
            date: null,
        };
    }
    const maskedBinding = snapshotBinding('masked');
    const hiddenBindings = ['hidden', 'blocked', 'retired'].map(
        snapshotBinding
    );
    const malformed = [
        'plain string',
        [],
        {},
        { state: 'generated', value: 'Missing required stale flag' },
        { state: 'generated', value: 'Invalid stale flag', isStale: 'false' },
        { state: 'unknown', value: 'Invalid state', isStale: false },
        { state: 'generated', value: 17, isStale: false },
    ];
    const unreadMetadata = {
        state: 'generated',
        value: 'Extra prompt/reference metadata stays unread',
        isStale: false,
    };
    for (const property of ['prompt', 'references'])
        Object.defineProperty(unreadMetadata, property, { get: poison });

    const field = loaded.payload.fieldIdsToSchemas.source.airtableField;
    const detail = [
        {
            fieldId: 'source',
            fieldName: 'AI Text',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {},
        },
    ];
    const portalNative = {
        state: 'error',
        value: '  Portal supplied text\n<em>literal</em> Ω  ',
        isStale: true,
        errorType: 'unknownError',
    };
    portal.payload.initialLinkedTableStates.tbl_children.airtableFields = [
        field,
    ];
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = detail;
    client.portals.listLinkedRecords = async () => {
        counters.portalReads++;
        return {
            airtableOffset: null,
            recordIds: ['rec_ai_text'],
            customViewDetailFields: { fld_children: detail },
            tableIdsToLinkedTableStates: {
                tbl_children: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        rec_ai_text: {
                            id: 'rec_ai_text',
                            fields: { source: portalNative },
                        },
                    },
                },
            },
        };
    };
    const owner = createPortalListOwner({
        client,
        portal,
        portalFieldId: 'fld_children',
        criteria: {
            selectedCustomViewId: 'view_example',
            searchTerm: null,
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: 'ai-text-synthetic-portal', revision: 0 }),
    });
    const portalScope = createPortalRenderScope({
        owner,
        client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    let portalBefore;
    const renderers = {
        renderAiTextField: (props) =>
            renderAiTextField(props, { className: 'proof-adapter' }),
    };
    const row = () => counters.rows++;
    const rowEvents = {
        onClick: row,
        onAuxClick: row,
        onDoubleClick: row,
        onPointerDown: row,
        onKeyDown: row,
        onKeyUp: row,
    };
    const section = (id, title, ...children) =>
        h(
            'section',
            { id, className: 'card proof-surface', ...rowEvents },
            h('h2', null, title),
            ...children
        );
    const wrapped = (id, child) =>
        h('div', { key: id, 'data-field': id, className: 'field' }, child);
    function App() {
        return h(
            React.Fragment,
            null,
            section(
                'form-proof',
                'Form · supplied value for every state and stale flag',
                h(AirtableForm, { scope, renderers }, (state) =>
                    h(
                        'div',
                        { className: 'field-grid' },
                        ...state.fields.map(({ fieldId, node }) =>
                            wrapped(fieldId, node)
                        )
                    )
                )
            ),
            h(
                'div',
                { className: 'columns' },
                section(
                    'binding-proof',
                    'Binding · accepted native object',
                    h(AiTextField, { binding, className: 'proof-binding' })
                ),
                section(
                    'grid-proof',
                    'Grid · accepted Portal detail',
                    h(
                        AirtableGrid,
                        { scope: portalScope, renderers },
                        (state) =>
                            h(
                                'div',
                                { role: 'table', 'aria-label': 'AI Text grid' },
                                ...state.rows.map((row) =>
                                    h(
                                        'div',
                                        { role: 'row', key: row.recordId },
                                        ...row.cells.map((cell) =>
                                            h(
                                                'div',
                                                {
                                                    role: 'cell',
                                                    key: cell.fieldId,
                                                },
                                                cell.node
                                            )
                                        )
                                    )
                                )
                            )
                    )
                ),
                section(
                    'list-proof',
                    'List · accepted Portal detail',
                    h(
                        AirtableList,
                        { scope: portalScope, renderers },
                        (state) =>
                            h(
                                'ul',
                                null,
                                ...state.rows.map((row) =>
                                    h(
                                        'li',
                                        { key: row.recordId },
                                        ...row.cells.map((cell) =>
                                            h(
                                                React.Fragment,
                                                { key: cell.fieldId },
                                                cell.node
                                            )
                                        )
                                    )
                                )
                            )
                    )
                )
            ),
            h(
                'div',
                { className: 'columns' },
                section(
                    'mask-proof',
                    'Mask before native access',
                    renderAiTextField(maskedProps),
                    renderAiTextField(maskedNativeProps),
                    h(AiTextField, { binding: maskedBinding })
                ),
                section(
                    'hidden-proof',
                    'Hidden, blocked and retired',
                    ...hiddenBindings.map((binding, key) =>
                        h(AiTextField, { key, binding })
                    ),
                    h(
                        'p',
                        { className: 'note' },
                        'Output omitted before field/value getter access.'
                    )
                ),
                section(
                    'custom-proof',
                    'Custom render precedence',
                    ...hiddenBindings.map((binding, key) =>
                        h(AiTextField, {
                            key,
                            binding,
                            render: () =>
                                h(
                                    'span',
                                    { 'data-custom': key },
                                    `Custom override ${key + 1}`
                                ),
                        })
                    )
                )
            ),
            section(
                'malformed-proof',
                'Malformed direct values fail closed',
                h(
                    'div',
                    { className: 'field-grid' },
                    ...malformed.map((value, index) =>
                        wrapped(
                            String(index),
                            renderAiTextField({
                                ...base,
                                title: `Malformed ${index + 1}`,
                                value,
                            })
                        )
                    )
                )
            ),
            section(
                'metadata-proof',
                'Unrelated metadata stays unread',
                renderAiTextField({ ...base, value: unreadMetadata })
            ),
            section(
                'lifecycle-proof',
                'Accepted owner lifecycle',
                h(AiTextField, { binding: lifecycleBinding }),
                predecessor
                    ? h(
                          'div',
                          { id: 'predecessor' },
                          h(AiTextField, { binding: predecessor })
                      )
                    : null,
                h(
                    'p',
                    { className: 'note' },
                    retired
                        ? 'Retired output removed.'
                        : replaced
                          ? 'Replacement supplied value accepted; predecessor retired.'
                          : 'Original accepted value visible.'
                )
            )
        );
    }
    const render = () =>
        flushSync(() =>
            root.render(h(React.StrictMode, null, h(App, { key: remounts })))
        );
    const outputs = (id) => [...document.querySelectorAll(`#${id} output`)];
    function verify() {
        const checks = [];
        for (const [id, text] of expected) {
            const output = document.querySelector(
                `#form-proof [data-field="${id}"] output`
            );
            check(
                output?.textContent === text,
                `Exact supplied value mismatch: ${id}`
            );
            check(
                output.getAttribute('aria-busy') === 'false' &&
                    output.getAttribute('aria-invalid') === 'false',
                `Native AI state/stale flag invented a host status: ${id}`
            );
        }
        checks.push(
            `Form: ${expected.length} native state/value/stale cases, escaped literal text and preserved whitespace`
        );
        check(
            outputs('binding-proof')[0]?.textContent === sourceText,
            'Accepted binding output missing'
        );
        for (const id of ['grid-proof', 'list-proof']) {
            check(
                outputs(id).length === (portalRetired ? 0 : 1),
                `${id} lifecycle output count`
            );
            if (!portalRetired)
                check(
                    outputs(id)[0].textContent === portalNative.value,
                    `${id} supplied native value`
                );
            if (!portalRetired)
                check(
                    outputs(id)[0].getAttribute('aria-busy') === 'false' &&
                        outputs(id)[0].getAttribute('aria-invalid') === 'false',
                    `${id} native error/stale value invented a host status`
                );
        }
        checks.push(
            'Actual accepted Form, Grid, List and binding presentation'
        );
        check(
            outputs('mask-proof').length === 3,
            'Positive mask probes missing'
        );
        for (const output of outputs('mask-proof'))
            check(output.textContent === '••••••••', 'Mask mismatch');
        check(
            outputs('hidden-proof').length === 0,
            'Hidden/blocked/retired output leaked'
        );
        check(
            document.querySelectorAll('[data-custom]').length === 3,
            'Custom override precedence failed'
        );
        check(
            outputs('custom-proof').length === 0,
            'Default renderer ran behind custom override'
        );
        check(
            counters.forbiddenReads === 0,
            'Masked, hidden or unrelated property was read'
        );
        checks.push(
            'Mask and visibility guards precede native/property reads; custom render takes precedence'
        );
        check(
            outputs('malformed-proof').length === malformed.length,
            'Malformed probes missing'
        );
        for (const output of outputs('malformed-proof'))
            check(
                output.textContent === 'Unavailable' &&
                    output.getAttribute('aria-invalid') === 'true',
                'Malformed value did not fail closed'
            );
        check(
            outputs('metadata-proof')[0]?.textContent === unreadMetadata.value,
            'Supplied value with unrelated metadata missing'
        );
        checks.push(
            'Malformed native values fail closed; prompt/reference getters remain unread'
        );
        check(
            outputs('lifecycle-proof').length === (retired ? 0 : 1),
            'Accepted binding retirement output count'
        );
        if (!retired) {
            check(
                outputs('lifecycle-proof')[0].textContent === lifecycleText,
                'Accepted lifecycle text mismatch'
            );
            check(
                JSON.stringify(lifecycleBinding.getSnapshot().value) ===
                    lifecycleNative,
                'Lifecycle native object changed'
            );
        }
        if (predecessor)
            check(
                predecessor.getSnapshot().retired &&
                    !document.querySelector('#predecessor output'),
                'Predecessor must remain retired'
            );
        checks.push(
            'Lifecycle assertions require visible output before replacement, remount and retirement'
        );
        check(
            !document.querySelector(
                '.proof-surface input,.proof-surface button,.proof-surface a,.proof-surface img,.proof-surface canvas,.proof-surface video,.proof-surface audio,.proof-surface iframe,.proof-surface object,.proof-surface embed,.proof-surface svg,.proof-surface [contenteditable=true]'
            ),
            'Unexpected actionable or parsed content'
        );
        const ids = [...document.querySelectorAll('[id]')].map(
            (node) => node.id
        );
        check(ids.length === new Set(ids).size, 'Duplicate IDs');
        for (const output of document.querySelectorAll(
            '.proof-surface output'
        )) {
            check(
                output.style.whiteSpace === 'pre-wrap' &&
                    output.style.overflowWrap === 'anywhere',
                'Whitespace/wrapping rule missing'
            );
            check(
                output.getAttribute('aria-label') ||
                    [...document.querySelectorAll('label')].some(
                        (label) =>
                            label.htmlFor === output.id &&
                            label.textContent.trim()
                    ),
                'Accessible name missing'
            );
            if (output.hasAttribute('aria-describedby'))
                check(
                    document.getElementById(
                        output.getAttribute('aria-describedby')
                    ),
                    'Feedback reference missing'
                );
        }
        check(
            !!document.querySelector('.proof-adapter') &&
                !!document.querySelector('.proof-binding'),
            'className options missing'
        );
        checks.push(
            'Escaped non-actionable output, accessible names and unique IDs'
        );
        check(
            JSON.stringify(fields.controller.getState()) === nativeBefore,
            'Form owner native state changed'
        );
        if (!portalRetired)
            check(
                JSON.stringify(portalScope.getSnapshot().records) ===
                    portalBefore,
                'Portal native records changed'
            );
        check(
            !Object.hasOwn(fields.controller.getState().draft.data, 'missing'),
            'Missing answer became present'
        );
        check(
            ['writes', 'saves', 'network', 'rows'].every(
                (key) => counters[key] === 0
            ),
            'Action, I/O or row event escaped'
        );
        check(
            counters.portalReads === 1 &&
                counters.replacementReads === (replaced ? 1 : 0),
            'Unexpected synthetic fixture read'
        );
        check(errors.length === 0, errors.join('\n'));
        checks.push(
            'Native value/state/isStale unchanged; zero network, writes, saves or row events'
        );
        check(
            document.documentElement.scrollWidth <= window.innerWidth,
            'Horizontal page overflow'
        );
        checks.push(`Viewport ${window.innerWidth} × ${window.innerHeight}`);
        return checks;
    }
    function interactions() {
        const targets = [
            ...document.querySelectorAll(
                '.mx-sdk-ai-text-field,.mx-sdk-ai-text-field *'
            ),
        ];
        check(targets.length > 0, 'No event targets mounted');
        let dispatched = 0;
        let received = 0;
        for (const target of targets) {
            for (const type of [
                'click',
                'auxclick',
                'dblclick',
                'pointerdown',
                'keydown',
                'keyup',
            ]) {
                const capture = () => received++;
                target.addEventListener(type, capture, {
                    capture: true,
                    once: true,
                });
                const Constructor = type.startsWith('key')
                    ? KeyboardEvent
                    : type === 'pointerdown'
                      ? PointerEvent
                      : MouseEvent;
                const event = new Constructor(type, {
                    key: 'Enter',
                    bubbles: true,
                    cancelable: true,
                });
                check(
                    target.dispatchEvent(event) && !event.defaultPrevented,
                    'Display prevented a native default'
                );
                dispatched++;
                target.removeEventListener(type, capture, true);
            }
        }
        check(
            dispatched === targets.length * 6 && received === dispatched,
            'Injected events did not reach every intended target'
        );
        check(counters.rows === 0, 'Event escaped into row listener');
        evidence.interactions.push({
            targets: targets.length,
            dispatched,
            received,
            rows: counters.rows,
            remounts,
            replaced,
            retired,
            portalRetired,
        });
    }
    function publish(inject = false) {
        if (inject) interactions();
        const checks = verify();
        if (inject)
            checks.push(
                'Injected pointer, click and keyboard events reached all field descendants and stayed contained'
            );
        result.dataset.state = 'pass';
        result.textContent = `PASS · ${checks.length} checks · remounts ${remounts} · replacement ${replaced} · binding retired ${retired} · Portal retired ${portalRetired}`;
        document.getElementById('counters').textContent = Object.entries(
            counters
        )
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ');
        document.getElementById('checks').replaceChildren(
            ...checks.map((text) => {
                const li = document.createElement('li');
                li.textContent = text;
                return li;
            })
        );
        document.getElementById('evidence').textContent = JSON.stringify(
            { ...evidence, counters, errors, checks },
            null,
            2
        );
    }
    function fail(error) {
        result.dataset.state = 'fail';
        result.textContent = `FAIL · ${error.message}`;
    }
    function action(id, run) {
        document.getElementById(id).onclick = async () => {
            try {
                await run();
            } catch (error) {
                fail(error);
            }
        };
    }
    portalScope
        .getSnapshot()
        .actions.load({ pagesToFetch: 1, refreshLoggedInPortalRecord: false })
        .then((accepted) => {
            check(accepted, 'Synthetic Portal read was not accepted');
            portalBefore = JSON.stringify(portalScope.getSnapshot().records);
            root = createRoot(document.getElementById('app'));
            render();
            action('run', () => publish(true));
            action('remount', () => {
                verify();
                check(
                    outputs('binding-proof')[0]?.textContent === sourceText,
                    'Remount requires accepted visible output'
                );
                remounts++;
                render();
                evidence.actions.push('remount accepted visible output');
                publish();
            });
            action('replace', async () => {
                verify();
                check(
                    !replaced &&
                        !retired &&
                        outputs('lifecycle-proof')[0]?.textContent ===
                            lifecycleText,
                    'Replacement requires original visible accepted output'
                );
                const successor = structuredClone(loaded);
                const value = {
                    state: 'loading',
                    value: '  Replacement supplied text\n<strong>literal</strong> Ω  ',
                    isStale: true,
                };
                successor.payload.formRecord.data.source = value;
                const accepted = await lifecycleFields.reload({
                    dirty: 'discard',
                    read: async () => {
                        counters.replacementReads++;
                        return successor;
                    },
                });
                check(accepted, 'Replacement was not accepted');
                predecessor = lifecycleBinding;
                check(
                    predecessor.getSnapshot().retired,
                    'Original accepted binding was not retired'
                );
                lifecycleBinding = lifecycleFields.field('source');
                lifecycleBinding.setValue = forbidden('writes');
                lifecycleText = value.value;
                lifecycleNative = JSON.stringify(value);
                replaced = true;
                render();
                evidence.actions.push(
                    'replace visible accepted owner and retain retired predecessor'
                );
                publish();
                document.getElementById('replace').disabled = true;
            });
            action('retire', () => {
                verify();
                check(
                    !retired &&
                        outputs('lifecycle-proof')[0]?.textContent ===
                            lifecycleText,
                    'Retirement requires visible accepted output'
                );
                flushSync(() => lifecycleFields.destroy());
                retired = true;
                render();
                evidence.actions.push('retire visible accepted binding');
                publish();
                document.getElementById('retire').disabled = true;
                document.getElementById('replace').disabled = true;
            });
            action('retire-portal', () => {
                verify();
                check(
                    !portalRetired &&
                        outputs('grid-proof').length === 1 &&
                        outputs('list-proof').length === 1,
                    'Portal retirement requires visible Grid and List output'
                );
                flushSync(() => portalScope.destroy());
                portalRetired = true;
                render();
                evidence.actions.push('retire visible Grid and List scope');
                publish();
                document.getElementById('retire-portal').disabled = true;
            });
            publish();
        })
        .catch(fail);
    window.addEventListener(
        'pagehide',
        () => {
            root?.unmount();
            scope.destroy();
            fields.destroy();
            lifecycleFields.destroy();
            portalScope.destroy();
            owner.destroy();
        },
        { once: true }
    );
}

const styles = `
:root{font-family:system-ui,sans-serif;color:#183744;background:#f2f6f8;font-size:15px;line-height:1.5;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:28px 20px 48px}h1{margin:0;font-size:clamp(1.6rem,4vw,2.4rem)}h2{font-size:1rem;margin:0 0 14px}p{margin:10px 0}.eyebrow{color:#186d67;text-transform:uppercase;letter-spacing:.08em;font-size:.8rem;font-weight:700}.lead,.note{color:#546675}.lead{max-width:80ch}.note{font-size:.85rem}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}button{font:inherit;border:1px solid #75959c;border-radius:6px;padding:8px 12px;color:#123e45;background:white;cursor:pointer}button:focus-visible{outline:3px solid #1679c7;outline-offset:3px}button:disabled{opacity:.55;cursor:default}.card{background:white;border:1px solid #d5e1e6;border-radius:9px;padding:16px;margin-bottom:14px;min-width:0}.columns,.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.field{min-width:0;border-top:1px solid #e5ecee;padding-top:10px}.mx-sdk-ai-text-field{display:block;min-width:0;margin-bottom:10px}.mx-sdk-ai-text-field label{display:block;color:#526a76;font-size:.8rem;font-weight:650;margin-bottom:4px}.mx-sdk-ai-text-field output{min-height:1.7em;font-family:ui-monospace,monospace;font-size:.9rem}.mx-sdk-ai-text-field output:empty:after{content:'(empty)';color:#8b979e;font-family:system-ui,sans-serif;font-size:.8rem}ul{padding-left:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.78rem}#proof-result{font-weight:750}#proof-result[data-state=pass]{color:#116143}#proof-result[data-state=fail]{color:#b21d30}#counters,.receipt{font-size:.78rem;overflow-wrap:anywhere}#checks{font-size:.85rem}@media(max-width:680px){main{padding:20px 14px 36px}.columns,.field-grid{grid-template-columns:1fr}.columns{gap:0}.card{padding:14px}}@media(forced-colors:active){.card,button{border:1px solid CanvasText}}
`;

async function main() {
    assert(
        process.argv[2] && process.argv[3] && process.argv[4],
        'Pass an installed consumer, tested archive and fresh output directory.'
    );
    const consumer = realpathSync(resolve(process.argv[2]));
    const archive = realpathSync(resolve(process.argv[3]));
    const requestedOutput = resolve(process.argv[4]);
    const output = join(
        realpathSync(dirname(requestedOutput)),
        basename(requestedOutput)
    );
    assert(
        lstatSync(archive).isFile(),
        'The tested archive must be a regular file.'
    );
    assert(
        !existsSync(output),
        'Output already exists; supply a fresh directory.'
    );
    const bytes = readFileSync(archive);
    const archiveSha256 = digest(bytes);
    const integrity = `sha512-${digest(bytes, 'sha512', 'base64')}`;
    const installed = join(consumer, 'node_modules/@miniextensions/sdk');
    assert.equal(
        realpathSync(installed),
        installed,
        'Installed SDK must not be linked.'
    );
    const lockBytes = readFileSync(join(consumer, 'package-lock.json'));
    const locked =
        JSON.parse(lockBytes).packages['node_modules/@miniextensions/sdk'];
    assert(
        locked && !locked.link && locked.resolved.startsWith('file:'),
        'Consumer must install a local SDK archive.'
    );
    assert.equal(
        locked.integrity,
        integrity,
        'Consumer archive integrity mismatch.'
    );
    const lockedArchive = locked.resolved.startsWith('file://')
        ? fileURLToPath(locked.resolved)
        : resolve(consumer, locked.resolved.slice(5));
    assert.equal(
        realpathSync(lockedArchive),
        archive,
        'Consumer resolved a different archive.'
    );
    const metadata = JSON.parse(
        readFileSync(join(installed, 'package.json'), 'utf8')
    );
    assert.equal(metadata.name, '@miniextensions/sdk');
    const sourceStart = sourceReceipt();
    const entry = `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {flushSync} from 'react-dom';\nimport {createMiniExtensionsClient} from '@miniextensions/sdk';\nimport {createFormFieldBindings} from '@miniextensions/sdk/forms';\nimport {createPortalListOwner} from '@miniextensions/sdk/portals';\nimport {createFormRenderScope,createPortalRenderScope} from '@miniextensions/sdk/ui';\nimport {AirtableForm,AirtableGrid,AirtableList,AiTextField,renderAiTextField} from '@miniextensions/sdk/react';\n(${browserMain.toString()})(${JSON.stringify({ ...aiTextLoadedFixture(), portal: portalRecipeFixtures.makePortal() })});\n`;
    const bundle = await build({
        absWorkingDir: consumer,
        stdin: {
            contents: entry,
            resolveDir: consumer,
            sourcefile: 'ai-text-proof-entry.js',
            loader: 'js',
        },
        outfile: 'main.js',
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        metafile: true,
        write: false,
        define: { 'process.env.NODE_ENV': '"development"' },
    });
    const externalInputs = {
        ...bundle.metafile,
        inputs: Object.fromEntries(
            Object.entries(bundle.metafile.inputs).filter(
                ([path]) => path !== 'ai-text-proof-entry.js'
            )
        ),
    };
    await assertBrowserInputs(externalInputs, consumer);
    const inputs = Object.keys(externalInputs.inputs)
        .sort()
        .map((path) => {
            const actual = realpathSync(resolve(consumer, path));
            const name = relative(consumer, actual).split(sep).join('/');
            assert(
                !isAbsolute(name) && name !== '..' && !name.startsWith('../'),
                'Bundle input escaped consumer.'
            );
            if (name.startsWith('node_modules/@miniextensions/sdk/'))
                assert(
                    name.startsWith(
                        'node_modules/@miniextensions/sdk/dist/esm/'
                    ),
                    'Browser must consume installed ESM.'
                );
            return { path: name, sha256: digest(readFileSync(actual)) };
        });
    // A lockfile identifies the installed archive, but cannot prove that its
    // unpacked files remain unchanged. Read each consumed SDK member from that
    // archive without extracting anything and compare the actual bundled bytes.
    const archiveMembers = execFileSync('tar', ['-tzf', archive], {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
    })
        .trimEnd()
        .split('\n');
    const sdkInputs = inputs.filter((input) =>
        input.path.startsWith('node_modules/@miniextensions/sdk/')
    );
    assert(sdkInputs.length > 0, 'No installed SDK inputs were bundled.');
    const archiveInputParity = sdkInputs.map((input) => {
        const member = input.path.replace(
            'node_modules/@miniextensions/sdk/',
            'package/'
        );
        assert.equal(
            archiveMembers.filter((name) => name === member).length,
            1,
            `Archive must contain exactly one matching member: ${member}`
        );
        const archived = execFileSync('tar', ['-xOzf', archive, member], {
            maxBuffer: 10 * 1024 * 1024,
        });
        const sha256 = digest(archived);
        assert.equal(sha256, input.sha256, `Installed SDK differs: ${member}`);
        return {
            path: input.path,
            archiveMember: member,
            bytes: archived.length,
            sha256,
        };
    });
    assert.equal(
        digest(readFileSync(archive)),
        archiveSha256,
        'Archive changed during bundling.'
    );
    assert.equal(
        digest(readFileSync(join(consumer, 'package-lock.json'))),
        digest(lockBytes),
        'Consumer lock changed during bundling.'
    );
    const sourceEnd = sourceReceipt();
    assert.deepEqual(
        sourceStart,
        sourceEnd,
        'Source changed during fixture build.'
    );
    const assets = {
        'main.js': bundle.outputFiles[0].contents,
        'styles.css': styles,
        'entry.js': entry,
        'bundle-inputs.json': JSON.stringify(bundle.metafile, null, 2) + '\n',
        'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>AI Text display proof</title><link rel="stylesheet" href="./styles.css"></head><body><main><p class="eyebrow">miniExtensions SDK · installed package proof</p><h1>AI Text supplied value</h1><p class="lead">All data is synthetic. These displays preserve the native value exactly across empty, loading, generated and error states and both stale flags. The owner retains the native object; the display adds no generation or status meaning.</p><div class="toolbar"><button id="run" type="button">Run interaction checks</button><button id="remount" type="button">Remount displays</button><button id="replace" type="button">Replace accepted owner</button><button id="retire" type="button">Retire binding</button><button id="retire-portal" type="button">Retire Portal scope</button></div><section class="card" aria-label="Proof result"><p id="proof-result" role="status" data-state="pending">Loading installed SDK…</p><p id="counters"></p><ul id="checks"></ul><p class="note">Page self-checks inject DOM events. Native pointer, keyboard, layout and accessibility inspection must be recorded separately. No clipboard access.</p></section><div id="app"></div><details class="card"><summary>Synthetic check evidence</summary><pre id="evidence"></pre></details><p class="receipt">Archive SHA-256: ${archiveSha256}<br>Source HEAD: ${sourceStart.head}<br>Exact installed inputs and source hashes: receipt.json</p></main><script type="module" src="./main.js"></script></body></html>`,
    };
    const receipt = {
        createdAt: new Date().toISOString(),
        browserExecution: 'pending-supported-browser-verification',
        package: {
            archive,
            name: metadata.name,
            version: metadata.version,
            sha256: archiveSha256,
            integrity,
        },
        source: {
            start: sourceStart,
            end: sourceEnd,
            unchangedDuringBuild: true,
            relationToArchive:
                'Caller supplies separately tested archive; these are fixture-build source identities.',
        },
        consumer: {
            directory: consumer,
            lockSha256: digest(lockBytes),
            inputsVerified: true,
            sdkFormat: 'installed ESM',
            inputs,
            archiveInputParity: {
                method: 'Read-only tar member bytes compared to every consumed installed SDK file; no extraction.',
                verifiedCount: archiveInputParity.length,
                inputs: archiveInputParity,
            },
        },
        limitations: [
            'Synthetic accepted owners and injected DOM events are separate from native browser evidence.',
            'No clipboard, generation, retry, parsing, writes, hydration or remote service is exercised.',
        ],
        output: Object.fromEntries(
            Object.entries(assets).map(([name, contents]) => [
                name,
                {
                    sha256: digest(contents),
                    bytes: Buffer.byteLength(contents),
                },
            ])
        ),
    };
    mkdirSync(output);
    for (const [name, contents] of Object.entries(assets))
        writeFileSync(join(output, name), contents, { flag: 'wx' });
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n',
        { flag: 'wx' }
    );
    console.log(
        JSON.stringify(
            {
                output,
                archiveSha256,
                inputs: inputs.length,
                browserExecution: receipt.browserExecution,
            },
            null,
            2
        )
    );
}

await main();
