// Build only. Drive the retained page with the supported browser tool separately.
// Usage: SDK_RICH_TEXT_NPM_CACHE=/path/to/seeded/cache node scripts/build-rich-text-browser-proof.mjs tested.tgz fresh-output --direct-module=/absolute/dist/esm/react/RichTextField.js
// After export integration, use --public-export instead. Neither mode drives a browser.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
import { richTextLoadedFixture } from './rich-text-consumer-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const root = realpathSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..')
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const inside = (parent, child) => {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
};
const identity = (stat) => `${stat.dev}:${stat.ino}`;
function existingEntry(path) {
    try {
        return lstatSync(path);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

// Resolve the existing ancestor, not just the lexical path: a missing output
// below an external symlink can otherwise point back into this checkout.
export function prepareProofOutput(checkoutRoot, requestedPath) {
    const checkout = realpathSync(checkoutRoot);
    const requested = resolve(requestedPath);
    assert(
        !existingEntry(requested),
        'Output directory already exists; use a fresh proof directory.'
    );
    let ancestor = requested;
    const missing = [];
    while (!existingEntry(ancestor)) {
        missing.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
    }
    // realpath deliberately rejects dangling symlinks and symlink loops.
    const canonicalAncestor = realpathSync(ancestor);
    const ancestorStat = statSync(ancestor);
    assert(ancestorStat.isDirectory(), 'Output ancestor must be a directory.');
    const output = join(canonicalAncestor, ...missing);
    assert(
        !inside(checkout, output),
        'Keep generated proof assets outside the checkout.'
    );
    return {
        checkout,
        requested,
        ancestor,
        canonicalAncestor,
        ancestorEntryIdentity: identity(lstatSync(ancestor)),
        ancestorIdentity: identity(ancestorStat),
        output,
    };
}

function assertOutputAncestor(plan) {
    assert.equal(
        realpathSync(plan.ancestor),
        plan.canonicalAncestor,
        'Output ancestor changed after validation.'
    );
    assert.equal(
        identity(lstatSync(plan.ancestor)),
        plan.ancestorEntryIdentity,
        'Output ancestor entry changed after validation.'
    );
    assert.equal(
        identity(statSync(plan.ancestor)),
        plan.ancestorIdentity,
        'Output ancestor identity changed after validation.'
    );
    assert(
        !inside(plan.checkout, plan.output),
        'Keep generated proof assets outside the checkout.'
    );
}

function assertProofOutput(state) {
    assertOutputAncestor(state.plan);
    const entry = lstatSync(state.output);
    assert(
        entry.isDirectory() && !entry.isSymbolicLink(),
        'Proof output must remain the created directory.'
    );
    assert.equal(
        identity(entry),
        state.identity,
        'Proof output identity changed after creation.'
    );
    assert.equal(
        realpathSync(state.output),
        state.output,
        'Proof output path changed after creation.'
    );
}

export function createProofOutput(plan) {
    assertOutputAncestor(plan);
    const current = prepareProofOutput(plan.checkout, plan.requested);
    assert.equal(
        current.output,
        plan.output,
        'Output parent changed after validation.'
    );
    const parent = dirname(plan.output);
    mkdirSync(parent, { recursive: true });
    assertOutputAncestor(plan);
    assert.equal(
        realpathSync(parent),
        parent,
        'Output parent changed after validation.'
    );
    // Non-recursive creation keeps the final leaf fresh, including against
    // preexisting/dangling links. Each asset is also created exclusively.
    mkdirSync(plan.output);
    const state = {
        plan,
        output: plan.output,
        identity: identity(lstatSync(plan.output)),
    };
    try {
        assertProofOutput(state);
        return state;
    } catch (error) {
        cleanupProofOutput(state);
        throw error;
    }
}

export function writeProofAsset(state, name, contents) {
    assert(
        name && name === basename(name) && name !== '.' && name !== '..',
        'Proof asset must have a simple file name.'
    );
    assertProofOutput(state);
    writeFileSync(join(state.output, name), contents, { flag: 'wx' });
}

export function cleanupProofOutput(state) {
    try {
        assertProofOutput(state);
    } catch {
        // Never remove a path whose ownership or canonical identity changed.
        return false;
    }
    rmSync(state.output, { recursive: true });
    return true;
}

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

// Only synthetic data is serialized. The browser entry imports SDK code solely
// from the exact archive installed under its independent consumer directory.
export function browserMain(data) {
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
            ownerId: 'rich-text-browser-synthetic',
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
                Object.defineProperty(props, 'value', { get: poison });
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
    const malformedValues = [
        17,
        false,
        ['**not a native richText string**'],
        { text: '**not a native richText string**' },
        new String('not a primitive string'),
    ];
    const malformedProps = malformedValues.map((value, index) => ({
        ...baseProps,
        title: `Invalid native value ${index + 1}`,
        displayConfig: {},
        writeConfig: null,
        value,
    }));
    const statusProps = {
        ...baseProps,
        title: 'Pending Rich Text',
        displayConfig: { showTitle: false },
        writeConfig: null,
        value: '**pending native text**',
        pending: true,
        error: '<b>Pending feedback</b>',
        validation: [],
    };
    const field = loaded.payload.fieldIdsToSchemas.source.airtableField;
    const details = [
        {
            fieldId: 'source',
            fieldName: 'Rich Text',
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
            recordIds: ['rec_rich_text'],
            customViewDetailFields: { fld_children: details },
            tableIdsToLinkedTableStates: {
                tbl_children: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        rec_rich_text: {
                            id: 'rec_rich_text',
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
            ownerId: 'rich-text-browser-portal',
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
    const renderers = { renderRichTextField };
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
    const evidence = {
        lifecycle: { remount: null, replacement: null, retirement: null },
        interactions: [],
    };
    let root;
    let portalBefore;
    const result = document.getElementById('proof-result');
    function updateCounters() {
        document.getElementById('counters').textContent = Object.entries(
            counters
        )
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ');
        document.getElementById('proof-evidence').textContent = JSON.stringify(
            evidence,
            null,
            2
        );
    }
    function App() {
        return h(
            React.Fragment,
            null,
            section(
                'form-proof',
                'Form · supplied Markdown as literal text',
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
                    'Binding · native string retained',
                    h(RichTextField, { binding })
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
                                    'aria-label': 'Rich Text grid',
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
                                renderRichTextField(props)
                            )
                        ),
                        h(RichTextField, {
                            key: 'masked-binding',
                            binding: maskedBinding,
                        })
                    )
                ),
                section(
                    'lifecycle-proof',
                    'Lifecycle · accepted binding',
                    h(RichTextField, {
                        key: 'accepted-lifecycle',
                        binding: lifecycleBinding,
                    }),
                    h(
                        'div',
                        { id: 'predecessor-proof' },
                        predecessorBinding
                            ? h(RichTextField, {
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
                    h(RichTextField, {
                        key: 'hidden',
                        binding: hiddenBinding,
                    }),
                    h(RichTextField, {
                        key: 'blocked',
                        binding: blockedBinding,
                    }),
                    h(RichTextField, {
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
                'status-proof',
                'Accessible pending and error feedback',
                renderRichTextField(statusProps)
            ),
            section(
                'malformed-proof',
                'Invalid native values · unavailable display',
                h(
                    'div',
                    { className: 'field-grid' },
                    ...malformedProps.map((props, index) =>
                        h(
                            React.Fragment,
                            { key: `malformed-${index}` },
                            renderRichTextField(props)
                        )
                    )
                )
            ),
            section(
                'native-proof',
                'Native string evidence',
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
            'Form: literal Markdown/HTML/URL, whitespace, CRLF/LF, Unicode, empty string, null, missing and mask'
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
                'Lifecycle native string changed during presentation'
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
                'Invalid native value displayed as text'
            );
        checks.push(
            'Invalid native values rejected; current accepted binding state matches its owner'
        );
        checks.push(
            'Fixed mask precedes native value access in Form/cell/detail contexts; hidden, blocked and retired bindings omit before field/value access'
        );
        check(
            !document.querySelector(
                '.proof-surface input,.proof-surface textarea,.proof-surface select,.proof-surface button,.proof-surface a,.proof-surface img,.proof-surface canvas,.proof-surface video,.proof-surface audio,.proof-surface iframe,.proof-surface svg,.proof-surface script,.proof-surface style,.proof-surface link,.proof-surface strong,.proof-surface em,.proof-surface code,.proof-surface [contenteditable=true]'
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
        const statusOutput = document.querySelector('#status-proof output');
        const statusFeedback = document.getElementById(
            statusOutput.getAttribute('aria-describedby')
        );
        check(
            statusOutput.getAttribute('aria-busy') === 'true' &&
                statusOutput.getAttribute('aria-invalid') === 'true' &&
                statusOutput.getAttribute('aria-label') ===
                    'Pending Rich Text' &&
                statusFeedback?.getAttribute('role') === 'status' &&
                statusFeedback.getAttribute('aria-live') === 'polite' &&
                statusFeedback.textContent === '<b>Pending feedback</b>' &&
                !document.querySelector('#status-proof b'),
            'Accessible pending/error feedback mismatch'
        );
        for (const output of document.querySelectorAll('.proof-surface output'))
            check(
                getComputedStyle(output).whiteSpace === 'pre-wrap',
                'Output does not preserve visible whitespace and line breaks'
            );
        checks.push(
            'Escaped inert output, literal feedback, accessible names/status, unique IDs and preserved whitespace style'
        );
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
            'Native strings unchanged; missing key preserved; zero write/save/network/row events'
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
    function injectInteractions() {
        const types = [
            'click',
            'auxclick',
            'dblclick',
            'pointerdown',
            'keydown',
            'keyup',
        ];
        const counts = () => Object.fromEntries(types.map((type) => [type, 0]));
        const record = {
            state: retired ? 'retired' : 'active',
            status: 'pending',
            expectedTargets: retired
                ? { output: 30, label: 23, status: 30 }
                : { output: 31, label: 24, status: 31 },
            targets: { output: 0, label: 0, status: 0 },
            dispatched: counts(),
            received: counts(),
            defaultPrevented: counts(),
            rowsBefore: counters.rows,
        };
        evidence.interactions.push(record);
        try {
            const targets = [
                ...document.querySelectorAll(
                    '.proof-surface .mx-sdk-rich-text-field > *'
                ),
            ];
            check(
                new Set(targets).size === targets.length,
                'Duplicate event target'
            );
            for (const target of targets) {
                check(target.isConnected, 'Detached event target');
                const kind =
                    target.tagName === 'OUTPUT'
                        ? 'output'
                        : target.tagName === 'LABEL'
                          ? 'label'
                          : target.tagName === 'SPAN' &&
                              target.getAttribute('role') === 'status'
                            ? 'status'
                            : null;
                check(kind !== null, 'Unexpected event target kind');
                record.targets[kind]++;
            }
            for (const kind of Object.keys(record.expectedTargets))
                check(
                    record.targets[kind] === record.expectedTargets[kind],
                    `Event target count mismatch: ${kind}`
                );
            record.targetCount = targets.length;
            for (const target of targets) {
                for (const type of types) {
                    const EventClass = type.startsWith('key')
                        ? KeyboardEvent
                        : type === 'pointerdown'
                          ? PointerEvent
                          : MouseEvent;
                    const event = new EventClass(type, {
                        bubbles: true,
                        cancelable: true,
                        ...(type.startsWith('key') ? { key: 'Enter' } : {}),
                    });
                    let receipts = 0;
                    const received = (actual) => {
                        if (
                            actual === event &&
                            actual.target === target &&
                            actual.currentTarget === target
                        ) {
                            receipts++;
                            record.received[type]++;
                        }
                    };
                    target.addEventListener(type, received);
                    record.dispatched[type]++;
                    try {
                        const allowed = target.dispatchEvent(event);
                        if (!allowed || event.defaultPrevented)
                            record.defaultPrevented[type]++;
                    } finally {
                        target.removeEventListener(type, received);
                    }
                    check(
                        receipts === 1,
                        `Event dispatch/receipt mismatch: ${type}`
                    );
                }
            }
            for (const type of types) {
                check(
                    record.dispatched[type] === targets.length &&
                        record.received[type] === targets.length,
                    `Event dispatch/receipt mismatch: ${type}`
                );
                check(
                    record.defaultPrevented[type] === 0,
                    `Event default was prevented: ${type}`
                );
            }
            check(
                record.rowsBefore === 0 && counters.rows === 0,
                'Injected event escaped to a row'
            );
            verify();
            record.status = 'passed';
            return record;
        } catch (error) {
            record.status = 'failed';
            record.error = error.message;
            throw error;
        } finally {
            record.totalDispatched = Object.values(record.dispatched).reduce(
                (sum, n) => sum + n,
                0
            );
            record.totalReceived = Object.values(record.received).reduce(
                (sum, n) => sum + n,
                0
            );
            record.rowsAfter = counters.rows;
        }
    }
    function fail(error) {
        result.dataset.state = 'fail';
        result.textContent = `FAIL · ${error.message}`;
        document.getElementById('checks').replaceChildren();
        updateCounters();
    }
    function runProof(interactions = false, verifiedAction) {
        try {
            const checks = verify();
            if (interactions) {
                const record = injectInteractions();
                checks.push(
                    `Injected events: ${record.targetCount} targets; ${record.totalDispatched} dispatched / ${record.totalReceived} received; zero row events or canceled defaults`
                );
            }
            // Action-specific observations are recorded only after all current
            // display/native-state checks pass. Rendering alone is not evidence.
            verifiedAction?.();
            const completed = Object.keys(evidence.lifecycle).filter(
                (name) => evidence.lifecycle[name]
            );
            const pending = Object.keys(evidence.lifecycle).filter(
                (name) => !evidence.lifecycle[name]
            );
            for (const name of completed)
                checks.push(`Verified lifecycle action: ${name}`);
            result.dataset.state = 'pass';
            result.textContent = `PASS · ${checks.length} checks${pending.length ? ` · lifecycle pending: ${pending.join(', ')}` : ' · lifecycle complete'}${interactions ? ' · injected events verified' : ''}`;
            document.getElementById('checks').replaceChildren(
                ...checks.map((text) => {
                    const li = document.createElement('li');
                    li.textContent = text;
                    return li;
                })
            );
            updateCounters();
            return true;
        } catch (error) {
            fail(error);
            return false;
        }
    }
    read.then((accepted) => {
        check(accepted, 'Synthetic Portal read was not accepted');
        portalBefore = JSON.stringify(portalScope.getSnapshot().records);
        root = createRoot(document.getElementById('app'));
        render();
        document.getElementById('run').onclick = () => runProof(true);
        document.getElementById('remount').onclick = () => {
            try {
                const before = document.querySelector('#binding-proof output');
                check(before, 'Missing output before remount');
                remount++;
                render();
                runProof(false, () => {
                    const after = document.querySelector(
                        '#binding-proof output'
                    );
                    check(
                        after &&
                            after !== before &&
                            !before.isConnected &&
                            after.id !== before.id,
                        'Remount did not replace the output node and ID'
                    );
                    evidence.lifecycle.remount = {
                        beforeId: before.id,
                        afterId: after.id,
                    };
                });
            } catch (error) {
                fail(error);
            }
        };
        document.getElementById('replace').onclick = async () => {
            try {
                check(
                    !retired &&
                        !replaced &&
                        !document.getElementById('replace').disabled,
                    'Replacement is unavailable'
                );
                document.getElementById('replace').disabled = true;
                const previous = lifecycleBinding;
                const readsBefore = counters.ownerReads;
                const before = document.querySelector(
                    '#lifecycle-proof output'
                );
                check(before, 'Missing output before replacement');
                const beforeText = before.textContent;
                const successor = structuredClone(loaded);
                const next =
                    '  **Replacement Ω**\r\n[still literal](https://replacement.invalid)\n  final  ';
                successor.payload.formRecord.data.source = next;
                const accepted = await lifecycleFields.reload({
                    dirty: 'discard',
                    read: async () => {
                        counters.ownerReads++;
                        return successor;
                    },
                });
                check(accepted, 'Replacement owner load was not accepted');
                predecessorBinding = previous;
                check(
                    predecessorBinding.getSnapshot().retired,
                    'Replacement did not retire the prior accepted binding'
                );
                lifecycleBinding = lifecycleFields.field('source');
                lifecycleBinding.setValue = block('writes');
                replaced = true;
                lifecycleText = next;
                lifecycleNative = JSON.stringify(next);
                render();
                runProof(false, () => {
                    const after = document.querySelector(
                        '#lifecycle-proof output'
                    );
                    check(
                        lifecycleBinding !== previous &&
                            counters.ownerReads === readsBefore + 1 &&
                            after?.textContent === next &&
                            previous.getSnapshot().retired &&
                            !document.querySelector(
                                '#predecessor-proof output'
                            ),
                        'Accepted replacement transition was not verified'
                    );
                    evidence.lifecycle.replacement = {
                        previousRetired: true,
                        ownerReads: counters.ownerReads - readsBefore,
                        beforeText,
                        afterText: after.textContent,
                    };
                });
            } catch (error) {
                fail(error);
            }
        };
        document.getElementById('retire').onclick = () => {
            try {
                check(!retired, 'Binding already retired');
                const before = document.querySelector(
                    '#lifecycle-proof output'
                );
                check(before, 'Missing output before retirement');
                retired = true;
                flushSync(() => lifecycleFields.destroy());
                render();
                runProof(false, () => {
                    check(
                        lifecycleBinding.getSnapshot().retired &&
                            !before.isConnected &&
                            !document.querySelector('#lifecycle-proof output'),
                        'Retirement did not remove the accepted binding output'
                    );
                    evidence.lifecycle.retirement = {
                        beforeId: before.id,
                        outputRemoved: true,
                    };
                });
                document.getElementById('retire').disabled = true;
                document.getElementById('replace').disabled = true;
            } catch (error) {
                fail(error);
            }
        };
        runProof();
    }).catch(fail);
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
*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:auto;padding:28px 22px 48px}h1{margin:0;font-size:clamp(1.6rem,4vw,2.4rem);line-height:1.15}h2{font-size:1rem;margin:0 0 14px}p{margin:10px 0}.eyebrow{color:#186d67;letter-spacing:.1em;text-transform:uppercase;font-weight:700;font-size:.8rem}.lead,.note{color:#546675}.lead{max-width:75ch}.note{font-size:.85rem}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button{font:inherit;font-weight:600;border:1px solid #75959c;border-radius:7px;background:white;padding:8px 12px;color:#123e45;cursor:pointer}button:hover{background:#e7f1f1}button:focus-visible{outline:3px solid #1679c7;outline-offset:3px}button:disabled{opacity:.55;cursor:default}.card{background:white;border:1px solid #d5e1e6;border-radius:10px;padding:16px;min-width:0;margin-bottom:14px}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.columns .card{margin-bottom:14px}.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.field{border-top:1px solid #e5ecee;padding-top:10px;min-width:0}.mx-sdk-rich-text-field{display:block;min-width:0}.mx-sdk-rich-text-field label{color:#526a76;display:block;font-size:.8rem;font-weight:650;margin-bottom:4px}.mx-sdk-rich-text-field output{min-height:1.7em;font-family:ui-monospace,monospace;font-size:.93rem}.mx-sdk-rich-text-field output:empty:after{content:'(empty)';color:#8b979e;font-family:system-ui,sans-serif;font-size:.8rem}ul{padding-left:20px}.stack{display:grid;gap:12px}pre{font-size:.85rem;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}#proof-result{font-weight:750;font-size:1.05rem}#proof-result[data-state=pass]{color:#116143}#proof-result[data-state=fail]{color:#b21d30}#counters{font-family:ui-monospace,monospace;font-size:.8rem;overflow-wrap:anywhere}#checks{font-size:.85rem;margin-bottom:0}.receipt{font-size:.75rem;color:#5c707b;overflow-wrap:anywhere}@media(max-width:680px){main{padding:20px 14px 36px}.columns,.field-grid{grid-template-columns:1fr}.card{padding:14px}.columns{gap:0}}@media(forced-colors:active){.card,button{border:1px solid CanvasText}}
`;

async function main() {
    assert(
        process.argv[2] && process.argv[3],
        'Pass the tested tarball and a fresh output directory.'
    );
    const modeArguments = process.argv.slice(4);
    assert(
        modeArguments.length === 1 &&
            (modeArguments[0] === '--public-export' ||
                modeArguments[0].startsWith('--direct-module=')),
        'Choose exactly one proof mode: --direct-module=/absolute/built/RichTextField.js or --public-export.'
    );
    const directModuleArgument = modeArguments[0].startsWith('--direct-module=')
        ? modeArguments[0].slice('--direct-module='.length)
        : null;
    assert(
        directModuleArgument === null || isAbsolute(directModuleArgument),
        'The direct module path must be absolute.'
    );
    const directModule =
        directModuleArgument === null
            ? null
            : realpathSync(directModuleArgument);
    if (directModule !== null)
        assert(
            lstatSync(directModule).isFile(),
            'The direct module must be a regular file.'
        );
    const proofMode =
        directModule === null
            ? 'installed-public-export'
            : 'installed-direct-module';
    const archive = realpathSync(resolve(process.argv[2]));
    const outputPlan = prepareProofOutput(root, process.argv[3]);
    const output = outputPlan.output;
    assert(
        lstatSync(archive).isFile(),
        'The package archive must be a regular file.'
    );
    const packageSha256 = sha256(readFileSync(archive));
    const packageIntegrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    const sourceStart = sourceReceipt();
    const consumer = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-rich-text-browser-'))
    );
    let outputState;
    try {
        writeFileSync(
            join(consumer, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        execFileSync(
            'npm',
            [
                'install',
                '--offline',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                archive,
                'react@18.3.1',
                'react-dom@18.3.1',
            ],
            {
                cwd: consumer,
                stdio: 'pipe',
                timeout: 120000,
                env: {
                    ...process.env,
                    ...(process.env.SDK_RICH_TEXT_NPM_CACHE
                        ? {
                              npm_config_cache: resolve(
                                  process.env.SDK_RICH_TEXT_NPM_CACHE
                              ),
                          }
                        : {}),
                },
            }
        );
        const installed = join(consumer, 'node_modules/@miniextensions/sdk');
        assert.equal(
            realpathSync(installed),
            installed,
            'Installed SDK must not be a symlink.'
        );
        const lock = JSON.parse(
            readFileSync(join(consumer, 'package-lock.json'), 'utf8')
        );
        const locked = lock.packages['node_modules/@miniextensions/sdk'];
        assert(!locked.link, 'Archive must be installed, not linked.');
        assert.equal(
            locked.integrity,
            packageIntegrity,
            'Installed SDK integrity differs from the tested archive.'
        );
        assert(
            locked.resolved.startsWith('file:'),
            'Installed SDK must resolve a local archive.'
        );
        const resolvedArchive = locked.resolved.startsWith('file://')
            ? fileURLToPath(locked.resolved)
            : resolve(consumer, locked.resolved.slice(5));
        assert.equal(
            realpathSync(resolvedArchive),
            archive,
            'Installed SDK resolves a different archive.'
        );
        const packageMetadata = JSON.parse(
            readFileSync(join(installed, 'package.json'), 'utf8')
        );
        assert.equal(packageMetadata.name, '@miniextensions/sdk');
        const installedModule = join(
            installed,
            'dist/esm/react/RichTextField.js'
        );
        if (directModule !== null)
            assert.equal(
                sha256(readFileSync(directModule)),
                sha256(readFileSync(installedModule)),
                'Direct module differs from the exact installed archive module.'
            );
        const rendererImport =
            directModule === null
                ? "import {RichTextField,renderRichTextField} from '@miniextensions/sdk/react';"
                : "import {RichTextField,renderRichTextField} from './node_modules/@miniextensions/sdk/dist/esm/react/RichTextField.js';";
        const entry = `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {flushSync} from 'react-dom';\nimport {createMiniExtensionsClient} from '@miniextensions/sdk';\nimport {createFormFieldBindings} from '@miniextensions/sdk/forms';\nimport {createPortalListOwner} from '@miniextensions/sdk/portals';\nimport {createFormRenderScope,createPortalRenderScope} from '@miniextensions/sdk/ui';\nimport {AirtableForm,AirtableGrid,AirtableList} from '@miniextensions/sdk/react';\n${rendererImport}\n(${browserMain.toString()})(${JSON.stringify({ ...richTextLoadedFixture(), portal: portalRecipeFixtures.makePortal() })});\n`;
        writeFileSync(join(consumer, 'entry.js'), entry);
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: ['entry.js'],
            outfile: 'main.js',
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            metafile: true,
            write: false,
            define: { 'process.env.NODE_ENV': '"development"' },
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        const inputs = Object.keys(bundle.metafile.inputs)
            .sort()
            .map((path) => {
                const actual = realpathSync(resolve(consumer, path));
                const name = relative(consumer, actual).split(sep).join('/');
                assert(
                    !isAbsolute(name) &&
                        name !== '..' &&
                        !name.startsWith('../')
                );
                if (name.startsWith('node_modules/@miniextensions/sdk/'))
                    assert(
                        name.startsWith(
                            'node_modules/@miniextensions/sdk/dist/esm/'
                        ),
                        'Browser must consume installed ESM.'
                    );
                return { path: name, sha256: sha256(readFileSync(actual)) };
            });
        assert(
            inputs.some(
                ({ path }) =>
                    path ===
                    'node_modules/@miniextensions/sdk/dist/esm/react/RichTextField.js'
            ),
            'The exact installed renderer module was not bundled.'
        );
        assert.equal(
            sha256(readFileSync(archive)),
            packageSha256,
            'Archive changed during build.'
        );
        const sourceEnd = sourceReceipt();
        const receipt = {
            createdAt: new Date().toISOString(),
            proofMode,
            qualificationScope:
                directModule === null
                    ? 'Renderer consumed through public /react export.'
                    : 'Renderer imported directly from its installed archive module. Public /react export is not qualified by this proof.',
            directModule:
                directModule === null
                    ? null
                    : {
                          path: directModule,
                          sha256: sha256(readFileSync(directModule)),
                          matchesInstalledArchive: true,
                      },
            browserExecution: 'pending-supported-browser-verification',
            package: {
                archive,
                name: packageMetadata.name,
                version: packageMetadata.version,
                sha256: packageSha256,
                integrity: packageIntegrity,
            },
            source: {
                start: sourceStart,
                end: sourceEnd,
                unchangedDuringBuild:
                    JSON.stringify(sourceStart) === JSON.stringify(sourceEnd),
                relationToArchive:
                    'Source snapshot at fixture build time; caller supplies the separately tested archive.',
            },
            consumer: {
                installMode: 'npm offline, ignore-scripts',
                lockSha256: sha256(
                    readFileSync(join(consumer, 'package-lock.json'))
                ),
                inputsVerified: true,
                sdkFormat: 'installed ESM',
                reactVersion: JSON.parse(
                    readFileSync(
                        join(consumer, 'node_modules/react/package.json'),
                        'utf8'
                    )
                ).version,
                inputs,
            },
            checks: 'Visible page self-checks cover actual SDK renderers and synthetic injected DOM events; native user/browser checks remain separate.',
            output: {},
        };
        outputState = createProofOutput(outputPlan);
        const assets = {
            'entry.js': entry,
            'main.js': bundle.outputFiles[0].contents,
            'styles.css': css,
            'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Rich Text display proof</title><link rel="stylesheet" href="./styles.css"></head><body><main><p class="eyebrow">miniExtensions SDK · ${proofMode} proof</p><h1>Rich Text literal display</h1><p class="lead">These Form, Grid and List displays preserve supplied Markdown, HTML, URLs, whitespace and line breaks as inert text. Native strings remain unchanged with their owner. This is plain-text display, not formatted Rich Text parity. All data is synthetic. ${directModule === null ? 'The renderer uses the public /react export.' : 'The renderer imports its installed module directly; public /react export qualification is deferred.'}</p><div class="toolbar"><button id="run" type="button">Run interaction checks</button><button id="remount" type="button">Remount displays</button><button id="replace" type="button">Replace accepted owner</button><button id="retire" type="button">Retire binding</button></div><section class="card" aria-label="Proof result"><p id="proof-result" role="status" data-state="pending">Loading installed SDK…</p><p id="counters"></p><ul id="checks"></ul><details><summary>Recorded proof evidence</summary><pre id="proof-evidence"></pre></details><p class="note">Interaction checks inject DOM events. Use the browser separately for native pointer, keyboard, accessibility and responsive inspection.</p></section><div id="app"></div><p class="receipt">Archive SHA-256: ${packageSha256}<br>Source HEAD at build: ${sourceStart.head}<br>Exact inputs and dirty-source hashes: receipt.json</p></main><script type="module" src="./main.js"></script></body></html>`,
            'bundle-inputs.json':
                JSON.stringify(bundle.metafile, null, 2) + '\n',
        };
        for (const [name, contents] of Object.entries(assets)) {
            writeProofAsset(outputState, name, contents);
            receipt.output[name] = {
                sha256: sha256(contents),
                bytes: Buffer.byteLength(contents),
            };
        }
        writeProofAsset(
            outputState,
            'receipt.json',
            JSON.stringify(receipt, null, 2) + '\n'
        );
        console.log(
            JSON.stringify(
                {
                    output,
                    packageSha256,
                    proofMode: receipt.proofMode,
                    inputs: inputs.length,
                    browserExecution: receipt.browserExecution,
                },
                null,
                2
            )
        );
    } catch (error) {
        if (outputState) cleanupProofOutput(outputState);
        throw error;
    } finally {
        rmSync(consumer, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    existsSync(process.argv[1]) &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
    await main();
