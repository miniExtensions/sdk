// Build only; use the supported browser tool separately. No browser/server is launched.
// Run the SDK build first, then:
// node scripts/build-multiple-collaborators-browser-proof.mjs fresh-output-directory
// This is a SOURCE / DIRECT COMPILED MODULE proof. Public export/package-check
// integration is deliberately pending and is not certified by this fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { multipleCollaboratorsLoadedFixture } from './multiple-collaborators-consumer-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const inside = (parent, child) => {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
};
function sourceReceipt() {
    const paths = new Set([
        ...git('diff', '--name-only', '-z', 'HEAD').split('\0'),
        ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
    ]);
    paths.delete('');
    return {
        head: git('rev-parse', 'HEAD').trim(),
        branch: git('branch', '--show-current').trim(),
        baseline: git('merge-base', 'HEAD', 'origin/main').trim(),
        status: git('status', '--porcelain=v1'),
        diffSha256: sha256(git('diff', '--binary', 'HEAD')),
        dirtyFiles: [...paths].sort().map((path) => ({
            path,
            sha256: existsSync(join(root, path))
                ? sha256(readFileSync(join(root, path)))
                : null,
        })),
    };
}

// Synthetic values only. Imports below resolve this checkout's compiled ESM,
// including the dedicated module that is intentionally not publicly exported.
function browserMain(data) {
    const { loaded, expected, portal } = data;
    const sourceText = expected.find(([id]) => id === 'source')[1];
    const h = React.createElement;
    const counters = {
        writes: 0,
        saves: 0,
        network: 0,
        rows: 0,
        getters: 0,
        portalReads: 0,
        ownerReads: 0,
    };
    const errors = [];
    const check = (condition, message) => {
        if (!condition) throw Error(message);
    };
    const block = (counter) => async () => {
        counters[counter]++;
        throw Error(
            'No mutation or network is connected to this synthetic proof.'
        );
    };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic-sdk.invalid',
        fetch: block('network'),
    });
    window.addEventListener('error', (event) => errors.push(event.message));
    window.addEventListener('unhandledrejection', (event) =>
        errors.push(String(event.reason))
    );
    const bindingOptions = {
        client,
        getScope: () => ({
            ownerId: 'multiple-collaborators-browser-synthetic',
            revision: 0,
        }),
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    };
    client.forms.save = block('saves');
    client.portals.updateGridCell = block('saves');
    const fields = createFormFieldBindings({ ...bindingOptions, loaded });
    const lifecycleFields = createFormFieldBindings({
        ...bindingOptions,
        loaded: structuredClone(loaded),
    });
    const scope = createFormRenderScope({
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const binding = fields.field('source');
    for (const id of loaded.payload.fieldIdsInForm)
        fields.field(id).setValue = block('writes');
    let lifecycleBinding = lifecycleFields.field('source');
    let predecessorBinding = null;
    lifecycleBinding.setValue = block('writes');
    const nativeBefore = JSON.stringify(fields.controller.getState());
    const baseProps = scope
        .getSnapshot()
        .fields.find((field) => field.fieldId === 'source')
        .host.getSnapshot().fields[0];
    const poison = () => {
        counters.getters++;
        throw Error('Masked or hidden native value was inspected');
    };
    const maskedProps = [];
    // This probes the renderer boundary. Accepted hosts may inspect their native
    // input while making their own detached snapshot before invoking a renderer.
    for (const context of ['form', 'portal-cell', 'portal-detail']) {
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
            for (const side of ['displayConfig', 'writeConfig']) {
                const props = {
                    ...baseProps,
                    context,
                    title: `${context} ${side} ${flag}`,
                    displayConfig: { [flag]: false },
                    writeConfig: { [flag]: false },
                };
                props[side] = { [flag]: true, showTitle: false };
                const poisonedMember = {};
                for (const name of ['id', 'name', 'email', 'profilePicUrl'])
                    Object.defineProperty(poisonedMember, name, {
                        get: poison,
                    });
                const array =
                    side === 'displayConfig'
                        ? new Proxy([], { get: poison })
                        : [poisonedMember, poisonedMember];
                if (context === 'form')
                    Object.defineProperty(props, 'value', { get: poison });
                else props.value = array;
                Object.defineProperty(props, 'capability', { get: poison });
                maskedProps.push(props);
            }
        }
    }
    function poisonBinding(mode) {
        const original = binding.getSnapshot();
        const snapshot = {
            ...original,
            field: {
                ...original.field,
                title: 'Masked binding',
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
                ...(mode === 'blocked' ? { code: 'invalid' } : {}),
                diagnostics: [],
            },
            retired: mode === 'retired',
        };
        Object.defineProperty(snapshot, 'value', { get: poison });
        if (mode !== 'masked')
            Object.defineProperty(snapshot, 'field', { get: poison });
        const result = {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            setValue: block('writes'),
        };
        for (const name of ['selection', 'scalar', 'date'])
            Object.defineProperty(result, name, { get: poison });
        return result;
    }
    const maskedBinding = poisonBinding('masked');
    const hiddenBinding = poisonBinding('hidden');
    const blockedBinding = poisonBinding('blocked');
    const retiredBinding = poisonBinding('retired');
    const validMember = loaded.payload.formRecord.data.source[0];
    const malformedValues = [
        [validMember, { ...validMember, name: 7 }],
        [validMember, null],
        [validMember, undefined],
        [validMember, , validMember],
        [validMember, [validMember]],
        { name: 'not an array' },
    ];
    const malformedProps = malformedValues.map((value, index) => ({
        ...baseProps,
        title: `Whole-array rejection ${index + 1}`,
        displayConfig: {},
        writeConfig: null,
        value,
    }));
    const field = loaded.payload.fieldIdsToSchemas.source.airtableField;
    const details = [
        {
            fieldId: 'source',
            fieldName: 'Multiple Collaborators',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {},
        },
    ];
    const portalNative = structuredClone(loaded.payload.formRecord.data.source);
    portal.payload.initialLinkedTableStates.tbl_children.airtableFields = [
        field,
    ];
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = details;
    client.portals.listLinkedRecords = async () => {
        counters.portalReads++;
        return {
            airtableOffset: null,
            recordIds: ['rec_multiple_collaborators'],
            customViewDetailFields: { fld_children: details },
            tableIdsToLinkedTableStates: {
                tbl_children: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        rec_multiple_collaborators: {
                            id: 'rec_multiple_collaborators',
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
        getScope: () => ({
            ownerId: 'multiple-collaborators-browser-portal',
            revision: 0,
        }),
    });
    const portalScope = createPortalRenderScope({
        owner,
        client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const read = portalScope
        .getSnapshot()
        .actions.load({ pagesToFetch: 1, refreshLoggedInPortalRecord: false });
    const renderers = { renderMultipleCollaboratorsField };
    const rowEvent = () => {
        counters.rows++;
        updateCounters();
    };
    const rowEvents = {
        onClick: rowEvent,
        onAuxClick: rowEvent,
        onDoubleClick: rowEvent,
        onPointerDown: rowEvent,
        onKeyDown: rowEvent,
        onKeyUp: rowEvent,
    };
    const section = (id, title, ...children) =>
        h(
            'section',
            { id, className: 'card proof-surface', ...rowEvents },
            h('h2', null, title),
            ...children
        );
    let retired = false;
    let replaced = false;
    let lifecycleText = sourceText;
    let lifecycleNative = JSON.stringify(lifecycleBinding.getSnapshot().value);
    let remount = 0;
    let root;
    let portalBefore;
    const result = document.getElementById('proof-result');
    function updateCounters() {
        document.getElementById('counters').textContent = Object.entries(
            counters
        )
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ');
    }
    function App() {
        return h(
            React.Fragment,
            null,
            section(
                'form-proof',
                'Form · supplied names in native order',
                h(AirtableForm, { scope, renderers }, (state) =>
                    h(
                        'div',
                        { className: 'field-grid' },
                        ...state.fields.map(({ fieldId, node }) =>
                            h(
                                'div',
                                {
                                    className: 'field',
                                    key: fieldId,
                                    'data-field': fieldId,
                                },
                                node
                            )
                        )
                    )
                )
            ),
            h(
                'div',
                { className: 'columns' },
                section(
                    'binding-proof',
                    'Binding · native array retained',
                    h(MultipleCollaboratorsField, { binding })
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
                                {
                                    role: 'table',
                                    'aria-label': 'Multiple Collaborators grid',
                                },
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
                    h(
                        'div',
                        { className: 'stack' },
                        ...maskedProps.map((props, index) =>
                            h(
                                React.Fragment,
                                { key: `mask-${index}` },
                                renderMultipleCollaboratorsField(props)
                            )
                        ),
                        h(MultipleCollaboratorsField, {
                            key: 'masked-binding',
                            binding: maskedBinding,
                        })
                    )
                ),
                section(
                    'lifecycle-proof',
                    'Lifecycle · accepted binding',
                    h(MultipleCollaboratorsField, {
                        key: 'accepted-lifecycle',
                        binding: lifecycleBinding,
                    }),
                    h(
                        'div',
                        { id: 'predecessor-proof' },
                        predecessorBinding
                            ? h(MultipleCollaboratorsField, {
                                  key: 'retired-predecessor',
                                  binding: predecessorBinding,
                              })
                            : null
                    ),
                    h(
                        'p',
                        { className: 'note' },
                        retired
                            ? 'Retired binding: output removed.'
                            : 'Use “Retire binding” to remove this output.'
                    )
                ),
                section(
                    'hidden-proof',
                    'Hidden, blocked and retired bindings',
                    h(MultipleCollaboratorsField, {
                        key: 'hidden',
                        binding: hiddenBinding,
                    }),
                    h(MultipleCollaboratorsField, {
                        key: 'blocked',
                        binding: blockedBinding,
                    }),
                    h(MultipleCollaboratorsField, {
                        key: 'retired',
                        binding: retiredBinding,
                    }),
                    h(
                        'p',
                        { className: 'note' },
                        'No omitted binding exposes output or inspects its field/value.'
                    )
                )
            ),
            section(
                'malformed-proof',
                'Malformed arrays · no partial display',
                h(
                    'div',
                    { className: 'field-grid' },
                    ...malformedProps.map((props, index) =>
                        h(
                            React.Fragment,
                            { key: `malformed-${index}` },
                            renderMultipleCollaboratorsField(props)
                        )
                    )
                )
            ),
            section(
                'native-proof',
                'Native array evidence',
                h(
                    'pre',
                    null,
                    JSON.stringify(
                        {
                            form: binding.getSnapshot().value,
                            portal: portalScope.getSnapshot().records.records[0]
                                .fields.source,
                            missingKeyPresent: Object.hasOwn(
                                fields.controller.getState().draft.data,
                                'missing'
                            ),
                        },
                        null,
                        2
                    )
                )
            )
        );
    }
    function render() {
        flushSync(() =>
            root.render(h(React.StrictMode, null, h(App, { key: remount })))
        );
    }
    function verify() {
        const checks = [];
        for (const [id, text] of expected) {
            const output = document.querySelector(
                `#form-proof [data-field="${id}"] output`
            );
            check(
                output && output.textContent === text,
                `Form supplied text mismatch: ${id}`
            );
        }
        checks.push(
            'Form: native order, duplicate IDs/names, blank names, whitespace, Unicode, literal markup/URL, empty array, null, missing and mask'
        );
        check(
            document.querySelector('#binding-proof output')?.textContent ===
                sourceText,
            'Binding text mismatch'
        );
        for (const id of ['grid-proof', 'list-proof'])
            check(
                document.querySelector(`#${id} output`)?.textContent ===
                    sourceText,
                `${id} text mismatch`
            );
        checks.push('Actual Form, Grid, List and binding renderers');
        check(
            document.querySelectorAll('#mask-proof output').length === 13,
            'Masked probes missing'
        );
        for (const output of document.querySelectorAll('#mask-proof output'))
            check(output.textContent === '••••••••', 'Mask mismatch');
        check(counters.getters === 0, 'Native masked/hidden getter was read');
        check(
            !document.querySelector('#hidden-proof output'),
            'Hidden/blocked/retired binding exposed a value'
        );
        check(
            !!document.querySelector('#lifecycle-proof output') !== retired,
            'Lifecycle retirement mismatch'
        );
        if (!retired) {
            check(
                document.querySelector('#lifecycle-proof output')
                    ?.textContent === lifecycleText,
                'Accepted lifecycle value mismatch'
            );
            check(
                JSON.stringify(lifecycleBinding.getSnapshot().value) ===
                    lifecycleNative,
                'Lifecycle native array changed during presentation'
            );
        }
        check(
            !document.querySelector('#predecessor-proof output'),
            'Retired predecessor binding exposed its previous value'
        );
        const malformedOutputs = document.querySelectorAll(
            '#malformed-proof output'
        );
        check(
            malformedOutputs.length === malformedValues.length,
            'Malformed probes missing'
        );
        for (const output of malformedOutputs)
            check(
                output.textContent === 'Unavailable' &&
                    output.getAttribute('aria-invalid') === 'true',
                'Malformed array displayed a partial value'
            );
        checks.push(
            'Malformed native arrays rejected as a whole; accepted binding replacement/remount/retirement preserves owner values'
        );
        checks.push(
            'Fixed mask precedes value/length/member reads in Form/cell/detail contexts; hidden, blocked and retired bindings omit before field/value access'
        );
        check(
            !document.querySelector(
                '.proof-surface input,.proof-surface button,.proof-surface a,.proof-surface img,.proof-surface canvas,.proof-surface video,.proof-surface audio,.proof-surface iframe,.proof-surface svg,.proof-surface [contenteditable=true]'
            ),
            'Unexpected actionable/media content'
        );
        const ids = [...document.querySelectorAll('[id]')].map(
            (node) => node.id
        );
        check(new Set(ids).size === ids.length, 'Duplicate DOM IDs');
        for (const output of document.querySelectorAll(
            '.proof-surface output'
        )) {
            check(
                output.getAttribute('aria-label') ||
                    [...document.querySelectorAll('label')].some(
                        (label) =>
                            label.htmlFor === output.id &&
                            label.textContent.trim()
                    ),
                'Output lacks an accessible name'
            );
        }
        checks.push('Escaped inert output, accessible names and unique IDs');
        check(
            JSON.stringify(fields.controller.getState()) === nativeBefore,
            'Form owner native state changed'
        );
        check(
            JSON.stringify(portalScope.getSnapshot().records) === portalBefore,
            'Portal native records changed'
        );
        check(
            !Object.hasOwn(fields.controller.getState().draft.data, 'missing'),
            'Missing value became a present key'
        );
        check(
            counters.writes === 0 &&
                counters.saves === 0 &&
                counters.network === 0 &&
                counters.rows === 0,
            'Unexpected action, request or row event'
        );
        check(counters.portalReads === 1, 'Unexpected synthetic Portal read');
        check(
            counters.ownerReads === (replaced ? 1 : 0),
            'Unexpected accepted owner read'
        );
        check(errors.length === 0, errors.join('\n'));
        checks.push(
            'Native arrays/objects unchanged; missing key preserved; zero write/save/network/row events'
        );
        check(
            document.documentElement.scrollWidth <= window.innerWidth,
            'Horizontal page overflow'
        );
        checks.push(
            `Responsive viewport ${window.innerWidth} × ${window.innerHeight}`
        );
        updateCounters();
        return checks;
    }
    function runProof(interactions = false) {
        try {
            if (interactions) {
                for (const output of document.querySelectorAll(
                    '.proof-surface output'
                )) {
                    for (const type of ['click', 'auxclick', 'dblclick'])
                        output.dispatchEvent(
                            new MouseEvent(type, {
                                bubbles: true,
                                cancelable: true,
                            })
                        );
                    output.dispatchEvent(
                        new PointerEvent('pointerdown', {
                            bubbles: true,
                            cancelable: true,
                        })
                    );
                    for (const type of ['keydown', 'keyup'])
                        output.dispatchEvent(
                            new KeyboardEvent(type, {
                                key: 'Enter',
                                bubbles: true,
                                cancelable: true,
                            })
                        );
                }
            }
            const checks = verify();
            if (interactions)
                checks.push(
                    'Injected click/auxclick/double-click/pointerdown/keydown/keyup isolated at every output'
                );
            result.dataset.state = 'pass';
            result.textContent = `PASS · ${checks.length} checks${retired ? ' · binding retired' : ''}${interactions ? ' · injected events' : ''}`;
            document.getElementById('checks').replaceChildren(
                ...checks.map((text) => {
                    const li = document.createElement('li');
                    li.textContent = text;
                    return li;
                })
            );
        } catch (error) {
            result.dataset.state = 'fail';
            result.textContent = `FAIL · ${error.message}`;
            updateCounters();
        }
    }
    read.then((accepted) => {
        check(accepted, 'Synthetic Portal read was not accepted');
        portalBefore = JSON.stringify(portalScope.getSnapshot().records);
        root = createRoot(document.getElementById('app'));
        render();
        document.getElementById('run').onclick = () => runProof(true);
        document.getElementById('remount').onclick = () => {
            remount++;
            render();
            runProof();
        };
        document.getElementById('replace').onclick = async () => {
            try {
                const successor = structuredClone(loaded);
                const next = [
                    { ...validMember, name: 'Replacement Ω' },
                    { ...validMember, name: '' },
                    { ...validMember, name: '  same ID, supplied name  ' },
                ];
                successor.payload.formRecord.data.source = next;
                const accepted = await lifecycleFields.reload({
                    dirty: 'discard',
                    read: async () => {
                        counters.ownerReads++;
                        return successor;
                    },
                });
                check(accepted, 'Replacement owner load was not accepted');
                predecessorBinding = lifecycleBinding;
                check(
                    predecessorBinding.getSnapshot().retired,
                    'Replacement did not retire the prior accepted binding'
                );
                lifecycleBinding = lifecycleFields.field('source');
                lifecycleBinding.setValue = block('writes');
                replaced = true;
                lifecycleText = next.map((member) => member.name).join(', ');
                lifecycleNative = JSON.stringify(next);
                render();
                runProof();
                document.getElementById('replace').disabled = true;
            } catch (error) {
                result.dataset.state = 'fail';
                result.textContent = `FAIL · ${error.message}`;
                updateCounters();
            }
        };
        document.getElementById('retire').onclick = () => {
            retired = true;
            flushSync(() => lifecycleFields.destroy());
            render();
            runProof();
            document.getElementById('retire').disabled = true;
            document.getElementById('replace').disabled = true;
        };
        runProof();
    }).catch((error) => {
        result.dataset.state = 'fail';
        result.textContent = `FAIL · ${error.message}`;
    });
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

const css = `
:root{font-family:system-ui,sans-serif;color:#153044;background:#f3f6f8;font-size:15px;line-height:1.5;color-scheme:light}
*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:auto;padding:28px 22px 48px}h1{margin:0;font-size:clamp(1.6rem,4vw,2.4rem);line-height:1.15}h2{font-size:1rem;margin:0 0 14px}p{margin:10px 0}.eyebrow{color:#186d67;letter-spacing:.1em;text-transform:uppercase;font-weight:700;font-size:.8rem}.lead,.note{color:#546675}.lead{max-width:75ch}.note{font-size:.85rem}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button{font:inherit;font-weight:600;border:1px solid #75959c;border-radius:7px;background:white;padding:8px 12px;color:#123e45;cursor:pointer}button:hover{background:#e7f1f1}button:focus-visible{outline:3px solid #1679c7;outline-offset:3px}button:disabled{opacity:.55;cursor:default}.card{background:white;border:1px solid #d5e1e6;border-radius:10px;padding:16px;min-width:0;margin-bottom:14px}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.columns .card{margin-bottom:14px}.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.field{border-top:1px solid #e5ecee;padding-top:10px;min-width:0}.mx-sdk-multiple-collaborators-field{display:block;min-width:0}.mx-sdk-multiple-collaborators-field label{color:#526a76;display:block;font-size:.8rem;font-weight:650;margin-bottom:4px}.mx-sdk-multiple-collaborators-field output{min-height:1.7em;font-family:ui-monospace,monospace;font-size:.93rem}.mx-sdk-multiple-collaborators-field output:empty:after{content:'(empty)';color:#8b979e;font-family:system-ui,sans-serif;font-size:.8rem}ul{padding-left:20px}.stack{display:grid;gap:12px}pre{font-size:.85rem;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}#proof-result{font-weight:750;font-size:1.05rem}#proof-result[data-state=pass]{color:#116143}#proof-result[data-state=fail]{color:#b21d30}#counters{font-family:ui-monospace,monospace;font-size:.8rem;overflow-wrap:anywhere}#checks{font-size:.85rem;margin-bottom:0}.receipt{font-size:.75rem;color:#5c707b;overflow-wrap:anywhere}@media(max-width:680px){main{padding:20px 14px 36px}.columns,.field-grid{grid-template-columns:1fr}.card{padding:14px}.columns{gap:0}}@media(forced-colors:active){.card,button{border:1px solid CanvasText}}
`;

async function main() {
    assert(process.argv[2], 'Pass a fresh output directory.');
    const output = resolve(process.argv[2]);
    assert(
        !existsSync(output),
        'Output already exists; use a fresh directory.'
    );
    assert(
        !inside(root, output),
        'Keep generated proof assets outside the checkout.'
    );
    const compiledEntry = 'dist/esm/react/MultipleCollaboratorsField.js';
    assert(
        existsSync(join(root, compiledEntry)),
        'Build the dedicated SDK module first.'
    );
    const sourceStart = sourceReceipt();
    const fixture = multipleCollaboratorsLoadedFixture();
    const imports = [
        "import React from 'react';",
        "import {createRoot} from 'react-dom/client';",
        "import {flushSync} from 'react-dom';",
        `import {createMiniExtensionsClient} from ${JSON.stringify(join(root, 'dist/esm/runtime/index.js'))};`,
        `import {createFormFieldBindings} from ${JSON.stringify(join(root, 'dist/esm/forms/index.js'))};`,
        `import {createPortalListOwner} from ${JSON.stringify(join(root, 'dist/esm/portals/index.js'))};`,
        `import {createFormRenderScope,createPortalRenderScope} from ${JSON.stringify(join(root, 'dist/esm/ui/index.js'))};`,
        `import {AirtableForm,AirtableGrid,AirtableList} from ${JSON.stringify(join(root, 'dist/esm/react/index.js'))};`,
        `import {MultipleCollaboratorsField,renderMultipleCollaboratorsField} from ${JSON.stringify(join(root, compiledEntry))};`,
    ];
    const entry = `${imports.join('\n')}\n(${browserMain.toString()})(${JSON.stringify({ ...fixture, portal: portalRecipeFixtures.makePortal() })});\n`;
    mkdirSync(output, { recursive: true });
    const entryPath = join(output, 'entry.js');
    writeFileSync(entryPath, entry);
    const bundle = await build({
        absWorkingDir: root,
        entryPoints: [entryPath],
        outfile: join(output, 'main.js'),
        nodePaths: [join(root, 'node_modules')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        metafile: true,
        write: false,
        define: { 'process.env.NODE_ENV': '"development"' },
    });
    const compiledRoot = realpathSync(join(root, 'dist/esm'));
    const dependencies = realpathSync(join(root, 'node_modules'));
    const inputs = Object.keys(bundle.metafile.inputs)
        .sort()
        .map((path) => {
            const actual = realpathSync(resolve(root, path));
            assert(
                actual === realpathSync(entryPath) ||
                    inside(compiledRoot, actual) ||
                    inside(dependencies, actual),
                `Unexpected browser input outside direct compiled ESM/dependencies: ${path}`
            );
            const name = relative(root, actual).split(sep).join('/');
            const compiled = inside(compiledRoot, actual);
            const sourcePath = compiled
                ? name.replace(/^dist\/esm\//, 'src/').replace(/\.js$/, '.ts')
                : null;
            return {
                path: name,
                sha256: sha256(readFileSync(actual)),
                ...(sourcePath && existsSync(join(root, sourcePath))
                    ? {
                          source: {
                              path: sourcePath,
                              sha256: sha256(
                                  readFileSync(join(root, sourcePath))
                              ),
                          },
                      }
                    : {}),
            };
        });
    assert(
        inputs.some(({ path }) => path === compiledEntry),
        'Dedicated compiled renderer was not bundled.'
    );
    const sourceEnd = sourceReceipt();
    const receipt = {
        createdAt: new Date().toISOString(),
        proofMode: 'source/direct-compiled-module',
        browserExecution: 'pending-supported-browser-verification',
        installedPublicExportProof: 'pending-shared-export-integration',
        aggregateIntegrationProof:
            'pending-shared-package-check-registration-and-serialized-integration',
        source: {
            start: sourceStart,
            end: sourceEnd,
            unchangedDuringBuild:
                JSON.stringify(sourceStart) === JSON.stringify(sourceEnd),
            relationship:
                'Recorded checkout sources and existing compiled ESM. Caller must run and retain the SDK build before this fixture builder; this is not a package archive proof.',
        },
        build: {
            entry: 'entry.js',
            entrySha256: sha256(entry),
            sdkEntry: compiledEntry,
            sdkFormat: 'checkout compiled ESM direct module',
            reactVersion: JSON.parse(
                readFileSync(
                    join(root, 'node_modules/react/package.json'),
                    'utf8'
                )
            ).version,
            inputsVerified: true,
            inputs,
        },
        checks: 'Synthetic self-checks cover actual SDK renderers and injected events. Native pointer selection, keyboard operation, and visual inspection require the supported browser separately.',
        output: {},
    };
    const assets = {
        'entry.js': entry,
        'main.js': bundle.outputFiles[0].contents,
        'styles.css': css,
        'bundle-inputs.json': JSON.stringify(bundle.metafile, null, 2) + '\n',
        'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Multiple Collaborators direct-module proof</title><link rel="stylesheet" href="./styles.css"></head><body><main><p class="eyebrow">miniExtensions SDK · direct-module proof</p><h1>Multiple Collaborators supplied names</h1><p class="lead">Form, Grid and List preserve supplied names, ordering, duplicate IDs, blank names, whitespace and native objects. All values are synthetic.</p><p class="note"><strong>Public-export and aggregate package-check integration remain pending.</strong> This fixture imports the dedicated compiled module directly.</p><div class="toolbar"><button id="run" type="button">Run interaction checks</button><button id="remount" type="button">Remount displays</button><button id="replace" type="button">Replace accepted owner</button><button id="retire" type="button">Retire binding</button></div><section class="card" aria-label="Proof result"><p id="proof-result" role="status" data-state="pending">Loading direct SDK modules…</p><p id="counters"></p><ul id="checks"></ul><p class="note">Interaction checks inject six DOM events. Use the browser separately to select supplied text with a pointer and operate these buttons by keyboard.</p></section><div id="app"></div><p class="receipt">Direct compiled entry: ${compiledEntry}<br>Source HEAD at build: ${sourceStart.head}<br>Exact inputs and source hashes: receipt.json</p></main><script type="module" src="./main.js"></script></body></html>`,
    };
    for (const [name, contents] of Object.entries(assets)) {
        writeFileSync(join(output, name), contents);
        receipt.output[name] = {
            sha256: sha256(contents),
            bytes: Buffer.byteLength(contents),
        };
    }
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n'
    );
    console.log(
        JSON.stringify(
            {
                output,
                proofMode: receipt.proofMode,
                inputs: inputs.length,
                browserExecution: receipt.browserExecution,
                installedPublicExportProof: receipt.installedPublicExportProof,
                aggregateIntegrationProof: receipt.aggregateIntegrationProof,
            },
            null,
            2
        )
    );
}

await main();
