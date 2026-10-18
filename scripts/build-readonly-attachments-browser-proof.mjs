// Build only. Inspect the retained page with the supported browser separately.
// Usage: node scripts/build-readonly-attachments-browser-proof.mjs installed-consumer tested.tgz fresh-output
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
import { multipleAttachmentsLoadedFixture } from './multiple-attachments-consumer-checks.mjs';
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
        tree: git('rev-parse', 'HEAD^{tree}').trim(),
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
function browserMain({ loaded, portal }) {
    const h = React.createElement;
    const fallback = 'Attachment presentation unavailable';
    const mask = '••••••••';
    const rendererClass = '.mx-sdk-readonly-attachments-field';
    const counters = {
        network: 0,
        writes: 0,
        saves: 0,
        uploads: 0,
        actions: 0,
        forbiddenReads: 0,
        rowEvents: 0,
        portalReads: 0,
        replacementReads: 0,
        fixtureVisibilityChanges: 0,
        injectedDispatched: 0,
        injectedReceived: 0,
    };
    const errors = [],
        actions = [],
        interactions = [],
        visibilityDeliveries = [];
    const check = (ok, message) => {
        if (!ok) throw Error(message);
    };
    const forbidden = (key) => () => {
        counters[key]++;
        throw Error(`Forbidden renderer read or action: ${key}`);
    };
    const poison = forbidden('forbiddenReads');
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic-readonly-attachments.invalid',
        fetch: forbidden('network'),
    });
    client.forms.save = forbidden('saves');
    client.attachments.uploadFile = forbidden('uploads');
    client.portals.updateGridCell = forbidden('writes');
    window.addEventListener('error', (event) => errors.push(event.message));
    window.addEventListener('unhandledrejection', (event) =>
        errors.push(String(event.reason))
    );
    const saveOptions = {
        captchaVal: null,
        isComputeMode: false,
        searchQuery: {},
        context: { type: 'direct-url' },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
    };
    const condition = {
        logicalOperator: 'and',
        conditions: [
            {
                id: 'fixture-visible-title',
                type: 'singleCondition',
                setting: {
                    type: 'is',
                    fieldType: 'singleLineText',
                    idOrName: { type: 'id', id: 'fld_title' },
                    value: 'Initial child',
                },
            },
        ],
    };
    function seed({ config = {}, values, conditional = false } = {}) {
        const next = structuredClone(loaded);
        Object.assign(
            next.payload.fieldIdsToSchemas.files.miniExtConfig,
            config
        );
        if (values !== undefined) next.payload.formRecord.data.files = values;
        if (conditional) {
            next.payload.fieldIdsInForm.unshift('fld_title');
            next.payload.fieldIdsToSchemas.files.miniExtConfig.conditionalFields =
                condition;
        }
        return next;
    }
    function makeScope(owner) {
        return createFormRenderScope({
            fields: owner.fields,
            isCurrent: () => true,
            configurationRevision: () => owner.configuration,
        });
    }
    function makeOwner(input, id) {
        const fields = createFormFieldBindings({
            client,
            loaded: input,
            getScope: () => ({ ownerId: id, revision: 0 }),
            saveOptions,
        });
        fields.field('files').setValue = forbidden('writes');
        const owner = { fields, id, configuration: 0 };
        owner.scope = makeScope(owner);
        owner.native = JSON.stringify(
            fields.controller.getState().draft.data.files
        );
        return owner;
    }
    const primary = makeOwner(seed(), 'readonly-attachments-primary');
    const generic = makeOwner(
        seed({ config: { hideAttachmentName: true } }),
        'readonly-attachments-generic'
    );
    const maskedOwner = makeOwner(
        seed({ config: { obscurePassword: true } }),
        'readonly-attachments-masked'
    );
    const emptyOwner = makeOwner(
        seed({ values: [] }),
        'readonly-attachments-empty'
    );
    const staticOwners = [primary, generic, maskedOwner, emptyOwner];
    const current = makeOwner(
        seed({ conditional: true }),
        'readonly-attachments-lifecycle'
    );
    const initialLabels = loaded.payload.formRecord.data.files.map(
        (row) => row.filename
    );
    check(
        initialLabels.length === 3 && initialLabels[0] === initialLabels[1],
        'Fixture requires ordered duplicate labels'
    );
    let currentLabels = initialLabels,
        remounts = 0,
        replaced = false;
    let hidden = false,
        retired = false,
        portalRetired = false,
        aba = false;
    let predecessorScope, predecessorBinding, root, linkedHost;
    const base = primary.scope.getSnapshot().fields[0].host.getSnapshot()
        .fields[0];
    check(
        base.attachmentPresentation?.status === 'ready',
        'Accepted host must expose the label-only facet'
    );
    const protectedField = (field, overrides = {}) => {
        // Fixture construction may inspect normal host snapshots. The adapter receives
        // poisoned native/action properties and only the approved label facet.
        const result = { ...field, ...overrides };
        for (const key of [
            'value',
            'capability',
            'pending',
            'error',
            'validation',
        ])
            Object.defineProperty(result, key, { get: poison });
        return result;
    };
    const direct = (overrides = {}) =>
        protectedField(base, {
            title: 'Protected attachment boundary',
            displayConfig: {},
            writeConfig: null,
            ...overrides,
        });
    const masked = [];
    for (const side of ['displayConfig', 'writeConfig'])
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
            for (const value of [true, 'malformed']) {
                const field = direct({ [side]: { [flag]: value } });
                Object.defineProperty(field, 'attachmentPresentation', {
                    get: poison,
                });
                masked.push(field);
            }
    const maskedFacet = direct({
        attachmentPresentation: { status: 'masked' },
    });
    masked.push(maskedFacet);
    const missing = direct();
    delete missing.attachmentPresentation;
    const unavailable = [
        missing,
        direct({ attachmentPresentation: { status: 'unavailable' } }),
    ];
    for (const overrides of [
        { context: 'linked-detail' },
        { context: 'inline' },
        { context: 'portal-cell' },
        { computed: true },
        { physicalKind: 'singleLineText' },
        {
            presentation: {
                type: 'computed',
                config: { type: 'multipleAttachments' },
            },
        },
    ]) {
        const field = direct(overrides);
        Object.defineProperty(field, 'attachmentPresentation', { get: poison });
        unavailable.push(field);
    }
    for (const config of [
        { hideAttachmentName: 'false' },
        { readOnly: 'true' },
        { addOnlyMode: 1 },
        [],
        'malformed',
    ]) {
        const field = direct({ displayConfig: config });
        Object.defineProperty(field, 'attachmentPresentation', { get: poison });
        unavailable.push(field);
    }
    for (const facet of [
        null,
        {},
        { status: 'unknown' },
        { status: 'ready' },
        { status: 'ready', rows: [null] },
        { status: 'ready', rows: [{ label: 17 }] },
        { status: 'ready', rows: new Array(1) },
        {
            status: 'ready',
            rows: [{ label: 'PRIVATE_rejected', id: 'PRIVATE_id' }],
        },
        {
            status: 'ready',
            rows: [{ label: 'PRIVATE_rejected' }],
            url: 'PRIVATE_url',
        },
        { status: 'masked', rows: [{ label: 'PRIVATE_masked' }] },
        { status: 'unavailable', rows: [{ label: 'PRIVATE_unavailable' }] },
    ])
        unavailable.push(direct({ attachmentPresentation: facet }));
    const noTitle = direct({
        displayConfig: { showTitle: false },
        title: 'Unlabelled visible title fallback',
    });
    const renderers = {
        renderMultipleAttachmentsField: (field) =>
            renderReadonlyAttachmentsField(protectedField(field), {
                className: 'proof-adapter',
            }),
        renderSingleLineTextField: () => null,
    };
    const row = () => counters.rowEvents++;
    const rowEvents = {
        onClick: row,
        onAuxClick: row,
        onDoubleClick: row,
        onPointerDown: row,
        onPointerUp: row,
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
    const form = (scope, override = renderers) =>
        h(AirtableForm, { scope, renderers: override }, (state) =>
            h(
                'div',
                null,
                ...state.fields.map(({ fieldId, node }) =>
                    h('div', { key: fieldId, 'data-field': fieldId }, node)
                )
            )
        );
    const field = loaded.payload.fieldIdsToSchemas.files.airtableField;
    const detail = [
        {
            fieldId: 'files',
            fieldName: 'Portal attachment labels',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: { hideAttachmentName: false, readOnly: true },
        },
    ];
    const portalValues = [
        {
            filename: 'Portal duplicate <em>literal</em>',
            url: 'https://private.invalid/PRIVATE_portal_a',
        },
        {
            filename: 'Portal duplicate <em>literal</em>',
            url: 'https://private.invalid/PRIVATE_portal_b',
        },
        {
            filename: 'https://example.invalid/portal-label.txt',
            url: 'https://private.invalid/PRIVATE_portal_c',
        },
    ];
    const portalLabels = portalValues.map((item) => item.filename);
    portal.payload.initialLinkedTableStates.tbl_children.airtableFields = [
        field,
    ];
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = detail;
    client.portals.listLinkedRecords = async () => {
        counters.portalReads++;
        return {
            airtableOffset: null,
            recordIds: ['rec_readonly_attachments'],
            customViewDetailFields: { fld_children: detail },
            tableIdsToLinkedTableStates: {
                tbl_children: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        rec_readonly_attachments: {
                            id: 'rec_readonly_attachments',
                            fields: { files: portalValues },
                        },
                    },
                },
            },
        };
    };
    const portalOwner = createPortalListOwner({
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
            ownerId: 'readonly-attachments-portal',
            revision: 0,
        }),
    });
    const portalScope = createPortalRenderScope({
        owner: portalOwner,
        client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    let portalNative;
    const stopVisibility = current.fields.field('files').subscribe(() => {
        visibilityDeliveries.push(
            current.fields.field('files').getSnapshot().visibility.type
        );
    });
    function App() {
        return h(
            React.Fragment,
            null,
            section(
                'form-proof',
                'Read-only Form · ordered literal labels',
                form(primary.scope)
            ),
            h(
                'div',
                { className: 'columns' },
                section(
                    'grid-proof',
                    'Grid · accepted Portal-detail labels',
                    h(
                        AirtableGrid,
                        { scope: portalScope, renderers },
                        (state) =>
                            h(
                                'div',
                                {
                                    role: 'table',
                                    'aria-label': 'Attachment label grid',
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
                    'List · accepted Portal-detail labels',
                    h(
                        AirtableList,
                        { scope: portalScope, renderers },
                        (state) =>
                            h(
                                'div',
                                null,
                                ...state.rows.map((row) =>
                                    h(
                                        'div',
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
                ),
                section(
                    'direct-proof',
                    'Direct component · supplied facet only',
                    h(ReadonlyAttachmentsField, {
                        field: direct(),
                        className: 'proof-direct',
                    }),
                    h(ReadonlyAttachmentsField, { field: noTitle })
                )
            ),
            h(
                'div',
                { className: 'columns' },
                section(
                    'generic-proof',
                    'Names concealed · generic ordered labels',
                    form(generic.scope)
                ),
                section(
                    'empty-proof',
                    'Empty accepted Form',
                    form(emptyOwner.scope)
                ),
                section(
                    'masked-owner-proof',
                    'Masked accepted Form',
                    form(maskedOwner.scope)
                )
            ),
            section(
                'mask-proof',
                'Mask before facet or native access',
                ...masked.map((field, key) =>
                    h(ReadonlyAttachmentsField, { field, key })
                )
            ),
            section(
                'unavailable-proof',
                'Unsupported, missing and malformed fail closed',
                ...unavailable.map((field, key) =>
                    h(ReadonlyAttachmentsField, { field, key })
                )
            ),
            section(
                'linked-proof',
                'Actual linked-detail host stays unsupported',
                h(FieldRenderer, { host: linkedHost, renderers })
            ),
            section(
                'custom-proof',
                'Custom slot renderer takes precedence',
                form(primary.scope, {
                    renderMultipleAttachmentsField: () =>
                        h(
                            'span',
                            { 'data-custom': true },
                            'Custom attachment slot'
                        ),
                })
            ),
            section(
                'lifecycle-proof',
                'Conditional visibility and accepted owner lifecycle',
                h('div', { id: 'current-owner' }, form(current.scope)),
                predecessorScope
                    ? h(
                          'div',
                          { id: 'predecessor-owner' },
                          form(predecessorScope)
                      )
                    : null,
                h(
                    'p',
                    { id: 'lifecycle-state', className: 'note' },
                    `Visible: ${!hidden && !retired}; replaced: ${replaced}; retired: ${retired}; configuration ABA: ${aba}`
                )
            )
        );
    }
    const render = () =>
        flushSync(() =>
            root.render(h(React.StrictMode, null, h(App, { key: remounts })))
        );
    const nodes = (id, selector) => [
        ...document.querySelectorAll(
            selector
                ? selector
                      .split(',')
                      .map((part) => `#${id} ${rendererClass} ${part}`)
                      .join(',')
                : `#${id} ${rendererClass}`
        ),
    ];
    const labels = (id) => nodes(id, 'li').map((node) => node.textContent);
    const same = (left, right) =>
        JSON.stringify(left) === JSON.stringify(right);
    function verify() {
        const checks = [];
        check(
            same(labels('form-proof'), initialLabels),
            'Accepted Form label order or duplicates changed'
        );
        check(
            same(
                labels('generic-proof'),
                initialLabels.map(() => 'Attachment')
            ),
            'Hidden names did not retain generic-only labels'
        );
        check(
            same(labels('direct-proof'), [...initialLabels, ...initialLabels]),
            'Direct component label-only facet mismatch'
        );
        check(
            nodes('empty-proof', 'ul').length === 1 &&
                labels('empty-proof').length === 0 &&
                nodes('empty-proof', 'p')[0]?.textContent === 'No attachments',
            'Ready empty shape mismatch'
        );
        checks.push(
            'Accepted read-only Form and direct component preserve ready order, duplicates, literal text, generic names and empty state'
        );
        for (const id of ['grid-proof', 'list-proof']) {
            check(
                same(labels(id), portalRetired ? [] : portalLabels),
                `${id} accepted Portal-detail labels mismatch`
            );
            check(
                nodes(id).length === (portalRetired ? 0 : 1),
                `${id} retirement leaked renderer`
            );
        }
        checks.push(
            'Grid and List consume accepted Portal-detail facets and retire visibly'
        );
        for (const id of ['mask-proof', 'masked-owner-proof']) {
            const outputs = nodes(id, 'output');
            check(
                outputs.length === (id === 'mask-proof' ? masked.length : 1),
                `${id} positive probes missing`
            );
            check(
                outputs.every((node) => node.textContent === mask),
                `${id} masking mismatch`
            );
            check(
                nodes(id, 'ul,li').length === 0,
                `${id} disclosed rows or count`
            );
        }
        for (const id of ['unavailable-proof', 'linked-proof']) {
            const outputs = nodes(id, 'output');
            check(
                outputs.length ===
                    (id === 'unavailable-proof'
                        ? unavailable.length
                        : portalRetired
                          ? 0
                          : 1),
                `${id} probes missing`
            );
            check(
                outputs.every((node) => node.textContent === fallback),
                `${id} unavailable fallback mismatch`
            );
            check(
                nodes(id, 'ul,li').length === 0,
                `${id} disclosed rows or count`
            );
        }
        check(
            document.querySelectorAll('#custom-proof [data-custom]').length ===
                1 && nodes('custom-proof').length === 0,
            'Custom renderer precedence failed'
        );
        checks.push(
            'Masked, unavailable, missing, malformed and unsupported surfaces are inert with no rows/count; custom slot wins'
        );
        check(
            same(
                labels('current-owner'),
                hidden || retired ? [] : currentLabels
            ),
            'Visible lifecycle output mismatch'
        );
        check(
            nodes('current-owner').length === (hidden || retired ? 0 : 1),
            'Hidden/retired lifecycle renderer leaked'
        );
        if (predecessorScope) {
            check(
                predecessorScope.getSnapshot().retired &&
                    predecessorBinding.getSnapshot().retired,
                'Predecessor did not stay retired'
            );
            check(
                nodes('predecessor-owner').length === 0,
                'Retired predecessor rendered labels'
            );
        }
        if (aba)
            check(
                current.scope.getSnapshot().retired,
                'Configuration ABA revived old scope'
            );
        checks.push(
            'Subscription visibility, accepted replacement and permanent retirement match visible preconditions'
        );
        check(
            !document.querySelector(
                '.proof-surface input,.proof-surface button,.proof-surface a,.proof-surface img,.proof-surface canvas,.proof-surface video,.proof-surface audio,.proof-surface iframe,.proof-surface object,.proof-surface embed,.proof-surface svg,.proof-surface [contenteditable=true]'
            ),
            'Actionable or parsed content appeared'
        );
        check(
            !document.getElementById('app').textContent.includes('PRIVATE_'),
            'Private raw value or rejected facet text escaped'
        );
        const ids = [...document.querySelectorAll('[id]')].map(
            (node) => node.id
        );
        check(ids.length === new Set(ids).size, 'Duplicate DOM IDs');
        for (const list of document.querySelectorAll(`${rendererClass} ul`)) {
            const named = list.getAttribute('aria-labelledby');
            check(
                list.getAttribute('aria-label') ||
                    (named &&
                        document.getElementById(named)?.textContent.trim()),
                'List lacks accessible name'
            );
        }
        for (const output of document.querySelectorAll(
            `${rendererClass} output`
        ))
            check(
                output.getAttribute('aria-label') ||
                    [...document.querySelectorAll('label')].some(
                        (label) =>
                            label.htmlFor === output.id &&
                            label.textContent.trim()
                    ),
                'Output lacks accessible name'
            );
        for (const item of document.querySelectorAll(`${rendererClass} li`))
            check(
                item.style.whiteSpace === 'pre-wrap' &&
                    item.style.overflowWrap === 'anywhere',
                'Literal label whitespace/wrapping missing'
            );
        check(
            document.querySelector('.proof-adapter') &&
                document.querySelector('.proof-direct'),
            'Public className options missing'
        );
        checks.push(
            'Non-actionable labels retain whitespace, accessible names and unique IDs'
        );
        for (const owner of [...staticOwners, current])
            check(
                JSON.stringify(
                    owner.fields.controller.getState().draft.data.files
                ) === owner.native,
                'Native attachment value changed'
            );
        if (!portalRetired)
            check(
                JSON.stringify(portalScope.getSnapshot().records) ===
                    portalNative,
                'Native Portal records changed'
            );
        check(
            [
                'network',
                'writes',
                'saves',
                'uploads',
                'actions',
                'forbiddenReads',
                'rowEvents',
            ].every((key) => counters[key] === 0),
            'Renderer action, protected read, I/O or event escaped'
        );
        check(
            counters.portalReads === 1 &&
                counters.replacementReads === (replaced ? 1 : 0),
            'Unexpected synthetic owner read'
        );
        check(errors.length === 0, errors.join('\n'));
        checks.push(
            'Native attachment data unchanged; zero renderer raw/action reads, writes, upload, save, network or row events'
        );
        check(
            document.documentElement.scrollWidth <= window.innerWidth,
            'Horizontal overflow'
        );
        checks.push(`Viewport ${window.innerWidth} × ${window.innerHeight}`);
        return checks;
    }
    function inject() {
        const targets = [
            ...document.querySelectorAll(`${rendererClass},${rendererClass} *`),
        ];
        check(targets.length > 0, 'No mounted event target');
        let dispatched = 0,
            received = 0,
            preventedEnter = 0;
        for (const target of targets)
            for (const type of [
                'click',
                'auxclick',
                'dblclick',
                'pointerdown',
                'pointerup',
                'keydown',
                'keyup',
            ]) {
                const capture = () => received++;
                target.addEventListener(type, capture, {
                    once: true,
                    capture: true,
                });
                const Constructor = type.startsWith('key')
                    ? KeyboardEvent
                    : type.startsWith('pointer')
                      ? PointerEvent
                      : MouseEvent;
                const event = new Constructor(type, {
                    key: 'Enter',
                    bubbles: true,
                    cancelable: true,
                });
                target.dispatchEvent(event);
                check(
                    event.defaultPrevented === (type === 'keydown'),
                    'Unexpected native default handling'
                );
                if (event.defaultPrevented) preventedEnter++;
                dispatched++;
                target.removeEventListener(type, capture, true);
            }
        check(
            received === dispatched && dispatched === targets.length * 7,
            'Injected events did not reach all intended descendants'
        );
        check(counters.rowEvents === 0, 'Injected event escaped to parent row');
        counters.injectedDispatched += dispatched;
        counters.injectedReceived += received;
        interactions.push({
            targets: targets.length,
            dispatched,
            received,
            preventedEnter,
            remounts,
            replaced,
            hidden,
            retired,
            portalRetired,
        });
    }
    function publish(injected = false) {
        if (injected) inject();
        const checks = verify();
        const result = document.getElementById('proof-result');
        result.dataset.state = 'pass';
        result.textContent = `PASS · ${checks.length} checks · remounts ${remounts} · replacement ${replaced} · hidden ${hidden} · Form retired ${retired} · Portal retired ${portalRetired}`;
        document.getElementById('lifecycle-state').textContent =
            `Visible: ${!hidden && !retired}; replaced: ${replaced}; retired: ${retired}; configuration ABA: ${aba}`;
        document.getElementById('counters').textContent = Object.entries(
            counters
        )
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ');
        document.getElementById('checks').replaceChildren(
            ...checks.map((text) => {
                const item = document.createElement('li');
                item.textContent = text;
                return item;
            })
        );
        document.getElementById('evidence').textContent = JSON.stringify(
            {
                scope: 'synthetic installed-package label-only proof',
                counters,
                errors,
                checks,
                actions,
                interactions,
                visibilityDeliveries,
                state: {
                    remounts,
                    replaced,
                    hidden,
                    retired,
                    portalRetired,
                    aba,
                },
                renderedLabels: {
                    form: labels('form-proof'),
                    current: labels('current-owner'),
                    grid: labels('grid-proof'),
                    list: labels('list-proof'),
                },
            },
            null,
            2
        );
    }
    function fail(error) {
        const result = document.getElementById('proof-result');
        result.dataset.state = 'fail';
        result.textContent = `FAIL · ${error.message}`;
        document.getElementById('evidence').textContent = JSON.stringify(
            { counters, errors, actions, error: String(error.stack ?? error) },
            null,
            2
        );
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
            portalNative = JSON.stringify(portalScope.getSnapshot().records);
            linkedHost = createPortalDetailRendererHost({
                owner: portalOwner,
                client,
                recordId: 'rec_readonly_attachments',
                context: 'linked-detail',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            root = createRoot(document.getElementById('app'));
            render();
            action('run', () => publish(true));
            action('remount', () => {
                verify();
                check(
                    same(labels('form-proof'), initialLabels),
                    'Remount needs visible accepted Form labels'
                );
                remounts++;
                render();
                actions.push('remount accepted visible labels');
                publish();
            });
            action('hide', () => {
                verify();
                check(
                    !hidden &&
                        !retired &&
                        same(labels('current-owner'), currentLabels),
                    'Hide requires visible lifecycle labels'
                );
                flushSync(() => {
                    const accepted = current.fields
                        .field('fld_title')
                        .setValue('Hidden');
                    check(accepted.accepted, 'Fixture title hide rejected');
                });
                counters.fixtureVisibilityChanges++;
                hidden = true;
                // No root render: actual subscriptions must remove the DOM.
                actions.push(
                    'fixture title change hides labels through subscriptions'
                );
                publish();
                document.getElementById('hide').disabled = true;
                document.getElementById('show').disabled = false;
            });
            action('show', () => {
                verify();
                check(
                    hidden && !retired && nodes('current-owner').length === 0,
                    'Show requires hidden lifecycle DOM'
                );
                flushSync(() => {
                    const accepted = current.fields
                        .field('fld_title')
                        .setValue('Initial child');
                    check(accepted.accepted, 'Fixture title show rejected');
                });
                counters.fixtureVisibilityChanges++;
                hidden = false;
                actions.push(
                    'fixture title change restores current labels through subscriptions'
                );
                publish();
                document.getElementById('hide').disabled = false;
                document.getElementById('show').disabled = true;
            });
            action('replace', async () => {
                verify();
                check(
                    !replaced &&
                        !hidden &&
                        !retired &&
                        same(labels('current-owner'), currentLabels),
                    'Replacement requires original accepted visible labels'
                );
                predecessorScope = current.scope;
                predecessorBinding = current.fields.field('files');
                const successor = seed({
                    conditional: true,
                    values: [
                        {
                            filename:
                                'Replacement duplicate <strong>literal</strong>',
                            url: 'https://private.invalid/PRIVATE_replacement_a',
                        },
                        {
                            filename:
                                'Replacement duplicate <strong>literal</strong>',
                            url: 'https://private.invalid/PRIVATE_replacement_b',
                        },
                        {
                            filename:
                                '  https://example.invalid/replacement.txt  ',
                            url: 'https://private.invalid/PRIVATE_replacement_c',
                        },
                    ],
                });
                const accepted = await current.fields.reload({
                    dirty: 'discard',
                    read: async () => {
                        counters.replacementReads++;
                        return successor;
                    },
                });
                check(
                    accepted &&
                        predecessorScope.getSnapshot().retired &&
                        predecessorBinding.getSnapshot().retired,
                    'Accepted replacement did not retire predecessor'
                );
                current.scope = makeScope(current);
                current.fields.field('files').setValue = forbidden('writes');
                current.native = JSON.stringify(
                    current.fields.controller.getState().draft.data.files
                );
                currentLabels = successor.payload.formRecord.data.files.map(
                    (item) => item.filename
                );
                replaced = true;
                render();
                actions.push(
                    'accepted owner replacement retains permanently retired predecessor'
                );
                publish();
                document.getElementById('replace').disabled = true;
            });
            action('retire', () => {
                verify();
                check(
                    !hidden &&
                        !retired &&
                        same(labels('current-owner'), currentLabels),
                    'Retirement requires accepted visible labels'
                );
                current.configuration++;
                check(
                    current.scope.getSnapshot().retired,
                    'Configuration change did not retire scope'
                );
                current.configuration--;
                check(
                    current.scope.getSnapshot().retired,
                    'ABA configuration revived scope'
                );
                retired = true;
                aba = true;
                render();
                actions.push(
                    'retire visible Form scope and restore configuration without revival'
                );
                publish();
                for (const id of ['hide', 'show', 'replace', 'retire'])
                    document.getElementById(id).disabled = true;
            });
            action('retire-portal', () => {
                verify();
                check(
                    !portalRetired &&
                        same(labels('grid-proof'), portalLabels) &&
                        same(labels('list-proof'), portalLabels),
                    'Portal retirement requires visible accepted Grid and List labels'
                );
                flushSync(() => {
                    portalScope.destroy();
                    portalOwner.destroy();
                });
                portalRetired = true;
                render();
                actions.push('retire accepted visible Portal detail scopes');
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
            stopVisibility();
            for (const owner of [...staticOwners, current]) {
                owner.scope.destroy();
                owner.fields.destroy();
            }
            predecessorScope?.destroy();
            linkedHost?.dispose();
            portalScope.destroy();
            portalOwner.destroy();
        },
        { once: true }
    );
}

const styles = `
:root{font-family:system-ui,sans-serif;color:#183744;background:#f2f6f8;font-size:15px;line-height:1.5;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:28px 20px 48px}h1{margin:0;font-size:clamp(1.6rem,4vw,2.4rem)}h2{font-size:1rem;margin:0 0 14px}p{margin:10px 0}.eyebrow{color:#186d67;text-transform:uppercase;letter-spacing:.08em;font-size:.8rem;font-weight:700}.lead,.note{color:#546675}.lead{max-width:80ch}.note{font-size:.85rem}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}button{font:inherit;border:1px solid #75959c;border-radius:6px;padding:8px 12px;color:#123e45;background:white;cursor:pointer}button:focus-visible{outline:3px solid #1679c7;outline-offset:3px}button:disabled{opacity:.55;cursor:default}.card{background:white;border:1px solid #d5e1e6;border-radius:9px;padding:16px;margin-bottom:14px;min-width:0}.columns,.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.field{min-width:0;border-top:1px solid #e5ecee;padding-top:10px}.mx-sdk-readonly-attachments-field{display:block;min-width:0;margin-bottom:10px}.mx-sdk-readonly-attachments-field label{display:block;color:#526a76;font-size:.8rem;font-weight:650;margin-bottom:4px}.mx-sdk-readonly-attachments-field output{min-height:1.7em;font-family:ui-monospace,monospace;font-size:.9rem}.mx-sdk-readonly-attachments-field output:empty:after{content:'(empty)';color:#8b979e;font-family:system-ui,sans-serif;font-size:.8rem}ul{padding-left:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.78rem}#proof-result{font-weight:750}#proof-result[data-state=pass]{color:#116143}#proof-result[data-state=fail]{color:#b21d30}#counters,.receipt{font-size:.78rem;overflow-wrap:anywhere}#checks{font-size:.85rem}@media(max-width:680px){main{padding:20px 14px 36px}.columns,.field-grid{grid-template-columns:1fr}.columns{gap:0}.card{padding:14px}}@media(forced-colors:active){.card,button{border:1px solid CanvasText}}
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
    for (const parent of [repository, consumer]) {
        const child = relative(parent, output);
        assert(
            isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`),
            'Keep proof output outside the checkout and installed consumer.'
        );
    }
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
    const entry = `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {flushSync} from 'react-dom';\nimport {createMiniExtensionsClient} from '@miniextensions/sdk';\nimport {createFormFieldBindings} from '@miniextensions/sdk/forms';\nimport {createPortalListOwner} from '@miniextensions/sdk/portals';\nimport {createFormRenderScope,createPortalRenderScope,createPortalDetailRendererHost} from '@miniextensions/sdk/ui';\nimport {AirtableForm,AirtableGrid,AirtableList,FieldRenderer,ReadonlyAttachmentsField,renderReadonlyAttachmentsField} from '@miniextensions/sdk/react';\n(${browserMain.toString()})(${JSON.stringify({ ...multipleAttachmentsLoadedFixture({ config: { readOnly: true, hideAttachmentName: false } }), portal: portalRecipeFixtures.makePortal() })});\n`;
    const bundle = await build({
        absWorkingDir: consumer,
        stdin: {
            contents: entry,
            resolveDir: consumer,
            sourcefile: 'readonly-attachments-proof-entry.js',
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
                ([path]) => path !== 'readonly-attachments-proof-entry.js'
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
    assert(
        sdkInputs.some(
            ({ path }) =>
                path ===
                'node_modules/@miniextensions/sdk/dist/esm/react/ReadonlyAttachmentsField.js'
        ),
        'The dedicated installed read-only attachment renderer was not bundled.'
    );
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
        'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Read-only attachment labels proof</title><link rel="stylesheet" href="./styles.css"></head><body><main><p class="eyebrow">miniExtensions SDK · installed package proof</p><h1>Read-only attachment labels</h1><p class="lead">Synthetic Form and Portal-detail owners supply the approved label-only facet. Ready labels preserve order and duplicates. Masked and unavailable displays have no rows or counts. No attachment actions or remote service are connected.</p><div class="toolbar"><button id="run" type="button">Run injected event checks</button><button id="remount" type="button">Remount displays</button><button id="hide" type="button">Hide conditional labels</button><button id="show" type="button" disabled>Show conditional labels</button><button id="replace" type="button">Replace accepted owner</button><button id="retire" type="button">Retire Form with configuration ABA</button><button id="retire-portal" type="button">Retire Portal scope</button></div><section class="card" aria-label="Proof result"><p id="proof-result" role="status" data-state="pending">Loading installed SDK…</p><p id="counters"></p><ul id="checks"></ul><p class="note">Injected DOM events are separate from native pointer, keyboard, layout and accessibility inspection. Visibility controls change only a synthetic title binding; renderer writes/actions remain zero. No native picker or clipboard access.</p></section><div id="app"></div><details class="card"><summary>Synthetic check evidence</summary><pre id="evidence"></pre></details><p class="receipt">Archive SHA-256: ${archiveSha256}<br>Source HEAD: ${sourceStart.head}<br>Exact installed inputs and source hashes: receipt.json</p></main><script type="module" src="./main.js"></script></body></html>`,
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
            'No clipboard, picker, upload, preview, download, attachment mutation or remote service is exercised. Fixture-only title changes exercise visibility.',
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
