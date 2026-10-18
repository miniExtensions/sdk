// Build only; drive the page separately with a supported browser tool.
// Usage: node scripts/build-multiple-attachments-browser-proof.mjs installed-consumer tested.tgz fresh-output
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { multipleAttachmentsLoadedFixture } from './multiple-attachments-consumer-checks.mjs';
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
        tree: git('rev-parse', 'HEAD^{tree}').trim(),
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

// Owner/controller internals below inspect synthetic state to check invariants.
// The adapter receives only the existing guarded facet and its filtered rows.
function browserMain({ loaded, portal }) {
    const h = React.createElement;
    const fallback = 'Attachment presentation unavailable';
    const counters = {
        network: 0,
        uploads: 0,
        saves: 0,
        rowEvents: 0,
        forbiddenReads: 0,
        portalReads: 0,
        ownerReads: 0,
        fixtureSelections: 0,
        adapterSelections: 0,
        injectedDispatched: 0,
        injectedReceived: 0,
    };
    const errors = [],
        history = [],
        flights = [],
        nativeInputs = new WeakMap();
    let root,
        current,
        remounts = 0,
        replacements = 0,
        retired = false,
        portalRetired = false;
    let oldActions = null,
        staleProbe = null,
        lateResultChecks = 0;
    const check = (ok, message) => {
        if (!ok) throw Error(message);
    };
    const poison = () => {
        counters.forbiddenReads++;
        throw Error('Adapter inspected protected native input or metadata');
    };
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
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic-attachments.invalid',
        fetch: async () => {
            counters.network++;
            throw Error('External requests are not connected to this fixture');
        },
    });
    client.attachments.uploadFile = (input, options) => {
        counters.uploads++;
        const owner = current;
        const selected = nativeInputs.get(input.file);
        check(
            selected,
            'Unexpected non-synthetic file reached the upload stub'
        );
        check(
            owner.controller.getSnapshot().files[0] === input.file,
            'Upload did not select the first queued File'
        );
        history.push({
            action: 'upload-dispatched',
            owner: owner.id,
            selection: selected,
        });
        let complete;
        const promise = new Promise((resolvePromise) => {
            complete = resolvePromise;
        });
        flights.push({
            owner,
            selected,
            signal: options.signal,
            complete,
            finished: false,
        });
        renderLater();
        return promise;
    };
    client.forms.save = async () => {
        counters.saves++;
        const record = current.loaded.payload.formRecord;
        history.push({ action: 'explicit-save', owner: current.id });
        return {
            type: 'saved',
            record: {
                id:
                    record.type === 'edit'
                        ? record.recordId
                        : 'rec_synthetic_saved',
                fields: structuredClone(
                    current.fields.controller.getState().draft.data
                ),
            },
            loggedInUserRecord: null,
            tableId: current.loaded.payload.publicFields.state.tableId,
            context: { type: 'direct-url' },
        };
    };
    client.portals.updateGridCell = async () => {
        throw Error('Portal writes are unavailable in this fixture');
    };
    function makeOwner(seed, id) {
        const fields = createFormFieldBindings({
            client,
            loaded: seed,
            getScope: () => ({ ownerId: id, revision: 0 }),
            saveOptions,
        });
        const recovery = {
            journal: new RecoveryJournal(),
            scope: {
                owner: id,
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'synthetic-form',
                context: 'modal',
            },
            loadVersion: 1,
        };
        const controller = fields.attachment('files', recovery);
        const scope = createFormRenderScope({
            fields,
            attachmentRecovery: recovery,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        return { fields, controller, scope, recovery, loaded: seed, id };
    }
    current = makeOwner(structuredClone(loaded), 'attachments-proof-0');
    const readonlySeed = structuredClone(loaded);
    readonlySeed.payload.fieldIdsToSchemas.files.miniExtConfig.readOnly = true;
    const readonly = makeOwner(readonlySeed, 'attachments-proof-readonly');
    const filteredSeed = structuredClone(loaded);
    const hiddenPrefix = {
        filename: 'PRIVATE_hidden_prefix',
        url: 'https://private.invalid/PRIVATE_hidden_prefix',
    };
    filteredSeed.payload.formRecord.data.files = [
        hiddenPrefix,
        ...structuredClone(loaded.payload.formRecord.data.files.slice(0, 2)),
    ];
    Object.assign(filteredSeed.payload.fieldIdsToSchemas.files.miniExtConfig, {
        addOnlyMode: true,
        showExistingValuesForAddOnlyMode: false,
    });
    filteredSeed.payload.persistedAddOnlyAttachmentValuesByFieldId = {
        files: [hiddenPrefix],
    };
    const filtered = makeOwner(filteredSeed, 'attachments-proof-filtered');
    const baseProps = () =>
        current.scope
            .getSnapshot()
            .fields.find((entry) => entry.fieldId === 'files')
            ?.host.getSnapshot().fields[0];
    const initialProps = baseProps();
    check(
        initialProps?.capability.attachment,
        'Accepted Form host did not expose its existing attachment facet'
    );
    const initialLabels = initialProps.capability.attachment.state.rows.map(
        (row) => row.label
    );
    check(
        initialLabels.length >= 2 && initialLabels[0] === initialLabels[1],
        'Fixture must include duplicate filtered labels'
    );
    const direct = (overrides = {}) => ({
        ...initialProps,
        ...overrides,
        title: 'Protected boundary',
        displayConfig: {},
        writeConfig: null,
    });
    const masked = [];
    for (const context of ['form', 'portal-cell', 'portal-detail'])
        for (const side of ['displayConfig', 'writeConfig'])
            for (const flag of [
                'obscurePassword',
                'maskPasswordOnLoginScreen',
            ]) {
                const props = direct({ context });
                props[side] = { [flag]: true };
                Object.defineProperty(props, 'value', { get: poison });
                Object.defineProperty(props, 'capability', { get: poison });
                masked.push(props);
            }
    const inert = [];
    for (const overrides of [
        { capability: { type: 'readonly' } },
        { capability: { type: 'editable', setValue: poison } },
        { computed: true },
        { context: 'portal-cell' },
        { context: 'portal-detail' },
        { context: 'linked-detail' },
    ]) {
        const props = direct(overrides);
        Object.defineProperty(props, 'value', { get: poison });
        if (overrides.computed || overrides.context)
            Object.defineProperty(props, 'capability', { get: poison });
        inert.push(props);
    }
    for (const state of [
        null,
        { ...initialProps.capability.attachment.state, rows: [null] },
        {
            ...initialProps.capability.attachment.state,
            rows: [{ nativeIndex: 0, label: 17, removeAllowed: true }],
        },
        { ...initialProps.capability.attachment.state, phase: 'unknown' },
    ]) {
        const props = direct({
            capability: {
                type: 'editable',
                setValue: poison,
                attachment: { ...initialProps.capability.attachment, state },
            },
        });
        Object.defineProperty(props, 'value', { get: poison });
        inert.push(props);
    }
    const protectedFacet = {
        select: () => false,
        clear() {},
        remove: () => false,
        upload: async () => false,
        cancel() {},
        state: {
            ...initialProps.capability.attachment.state,
            files: [
                Object.defineProperties(
                    {},
                    {
                        name: { get: poison },
                        size: { get: poison },
                        type: { get: poison },
                        arrayBuffer: { get: poison },
                    }
                ),
            ],
            rows: initialProps.capability.attachment.state.rows.map((row) =>
                Object.defineProperties(
                    { ...row },
                    {
                        url: { get: poison },
                        filename: { get: poison },
                        thumbnails: { get: poison },
                    }
                )
            ),
        },
    };
    const protectedProps = direct({
        capability: {
            type: 'editable',
            setValue: poison,
            attachment: protectedFacet,
        },
    });
    Object.defineProperty(protectedProps, 'value', { get: poison });
    const unavailableActivity = [
        { phase: 'idle', busy: false, files: [] },
        { phase: 'selected', busy: false, files: protectedFacet.state.files },
        { phase: 'uploading', busy: true, files: protectedFacet.state.files },
        { phase: 'uncertain', busy: false, files: protectedFacet.state.files },
    ].map((activity) => {
        const state = {
            ...protectedFacet.state,
            ...activity,
            presentation: 'unavailable',
        };
        Object.defineProperty(state, 'rows', { get: poison });
        const props = direct({
            capability: {
                type: 'editable',
                setValue: poison,
                attachment: { ...protectedFacet, state },
            },
        });
        Object.defineProperty(props, 'value', { get: poison });
        return props;
    });
    const details = [
        {
            fieldId: 'files',
            fieldName: 'Files',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {},
        },
    ];
    const airtableField = loaded.payload.fieldIdsToSchemas.files.airtableField;
    portal.payload.initialLinkedTableStates.tbl_children.airtableFields = [
        airtableField,
    ];
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = details;
    client.portals.listLinkedRecords = async () => {
        counters.portalReads++;
        return {
            airtableOffset: null,
            recordIds: ['rec_attachments'],
            customViewDetailFields: { fld_children: details },
            tableIdsToLinkedTableStates: {
                tbl_children: {
                    airtableFields: [airtableField],
                    recordIdsToAirtableRecords: {
                        rec_attachments: {
                            id: 'rec_attachments',
                            fields: {
                                files: structuredClone(
                                    loaded.payload.formRecord.data.files
                                ),
                            },
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
        getScope: () => ({ ownerId: 'attachments-proof-portal', revision: 0 }),
    });
    const portalScope = createPortalRenderScope({
        owner: portalOwner,
        client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const rowEvent = () => {
        counters.rowEvents++;
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
    const renderers = { renderMultipleAttachmentsField };
    const renderer = (field) => {
        const attachment =
            field.capability.type === 'editable' && field.capability.attachment;
        if (!attachment) return renderMultipleAttachmentsField(field);
        const wrapped = {
            ...field,
            capability: {
                ...field.capability,
                attachment: {
                    ...attachment,
                    select(files) {
                        counters.adapterSelections++;
                        return attachment.select(files);
                    },
                },
            },
        };
        return renderMultipleAttachmentsField(wrapped);
    };
    const card = (id, title, ...children) =>
        h(
            'section',
            { id, className: 'card proof-surface', ...rowEvents },
            h('h2', null, title),
            ...children
        );
    function App() {
        return h(
            React.Fragment,
            null,
            card(
                'editable-proof',
                'Editable Form · existing filtered rows and guarded actions',
                retired
                    ? h(
                          'p',
                          { className: 'note' },
                          'Retired Form: no adapter remains.'
                      )
                    : h(
                          AirtableForm,
                          {
                              scope: current.scope,
                              renderers: {
                                  renderMultipleAttachmentsField: renderer,
                              },
                          },
                          (state) =>
                              h(
                                  React.Fragment,
                                  null,
                                  ...state.fields.map(({ fieldId, node }) =>
                                      h(
                                          'div',
                                          {
                                              key: fieldId,
                                              'data-field': fieldId,
                                          },
                                          node
                                      )
                                  ),
                                  h(
                                      'div',
                                      {
                                          className: 'save-control',
                                          onClick: (e) => e.stopPropagation(),
                                          onPointerDown: (e) =>
                                              e.stopPropagation(),
                                          onKeyDown: (e) => e.stopPropagation(),
                                          onKeyUp: (e) => e.stopPropagation(),
                                      },
                                      h(
                                          'button',
                                          {
                                              id: 'save-owner',
                                              type: 'button',
                                              disabled: !state.canSave,
                                              onClick: () =>
                                                  action('save', async () => {
                                                      const before =
                                                          counters.saves;
                                                      const result =
                                                          await state.actions.submit();
                                                      check(
                                                          counters.saves ===
                                                              before + 1 &&
                                                              result.type ===
                                                                  'saved',
                                                          'Explicit synthetic Save was not accepted'
                                                      );
                                                  }),
                                          },
                                          'Save'
                                      ),
                                      h(
                                          'p',
                                          { className: 'note' },
                                          'Save is the separate owner action. Its synthetic transport retains data only in memory.'
                                      )
                                  )
                              )
                      )
            ),
            h(
                'div',
                { className: 'columns' },
                card(
                    'readonly-proof',
                    'Read-only Form · inert fallback',
                    h(
                        AirtableForm,
                        { scope: readonly.scope, renderers },
                        (state) =>
                            h(
                                React.Fragment,
                                null,
                                ...state.fields.map(({ fieldId, node }) =>
                                    h('div', { key: fieldId }, node)
                                )
                            )
                    )
                ),
                card(
                    'grid-proof',
                    'Read-only Grid · inert fallback',
                    h(
                        AirtableGrid,
                        { scope: portalScope, renderers },
                        (state) =>
                            h(
                                'div',
                                {
                                    role: 'table',
                                    'aria-label': 'Attachment grid',
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
                card(
                    'list-proof',
                    'Read-only List · inert fallback',
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
            card(
                'filtered-proof',
                'Filtered duplicate occurrences · hidden prefix stays private',
                h(AirtableForm, { scope: filtered.scope, renderers }, (state) =>
                    h(
                        React.Fragment,
                        null,
                        ...state.fields.map(({ fieldId, node }) =>
                            h('div', { key: fieldId }, node)
                        )
                    )
                )
            ),
            card(
                'masked-proof',
                'Mask before facet or native input access',
                ...masked.map((field, index) =>
                    h(MultipleAttachmentsField, { key: index, field })
                )
            ),
            card(
                'inert-proof',
                'Missing, computed, non-Form and malformed capability',
                ...inert.map((field, index) =>
                    h(MultipleAttachmentsField, { key: index, field })
                )
            ),
            card(
                'unavailable-activity-proof',
                'Unavailable projection · guarded activity only',
                ...unavailableActivity.map((field, index) =>
                    h(
                        'div',
                        { key: index, 'data-activity': index },
                        h(MultipleAttachmentsField, { field })
                    )
                )
            ),
            card(
                'protected-proof',
                'Filtered facet only · hostile raw getters remain unread',
                h(MultipleAttachmentsField, { field: protectedProps })
            )
        );
    }
    function render() {
        if (root)
            flushSync(() =>
                root.render(
                    h(React.StrictMode, null, h(App, { key: remounts }))
                )
            );
    }
    let scheduled = false;
    function renderLater() {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            render();
            runProof();
        });
    }
    function updateCounters() {
        document.getElementById('counters').textContent = Object.entries(
            counters
        )
            .map(([key, value]) => `${key}: ${value}`)
            .join(' · ');
    }
    function snapshot() {
        const state = current.controller.getSnapshot();
        return {
            counters: { ...counters },
            owner: current.id,
            remounts,
            replacements,
            retired,
            portalRetired,
            phase: state.phase,
            busy: state.busy,
            pendingFiles: state.files.length,
            filteredRows: state.rows.map(
                ({ nativeIndex, label, removeAllowed }) => ({
                    nativeIndex,
                    label,
                    removeAllowed,
                })
            ),
            hiddenPrefixVisibleRows: filtered.controller
                .getSnapshot()
                .rows.map(({ nativeIndex, label }) => ({ nativeIndex, label })),
            openFlights: flights.filter((flight) => !flight.finished).length,
            staleProbe,
            lateResultChecks,
            history: structuredClone(history),
            errors: [...errors],
            viewport: {
                width: innerWidth,
                height: innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
            },
            result: document.getElementById('proof-result').textContent,
        };
    }
    function verify() {
        const checks = [];
        check(
            counters.network === 0 &&
                counters.rowEvents === 0 &&
                counters.forbiddenReads === 0,
            'Unexpected network, row event, or protected metadata read'
        );
        check(errors.length === 0, 'Unhandled fixture error');
        check(
            document.querySelectorAll(
                '.mx-sdk-multiple-attachments-field a,.mx-sdk-multiple-attachments-field img,.mx-sdk-multiple-attachments-field iframe,.mx-sdk-multiple-attachments-field video'
            ).length === 0,
            'Adapter exposed a link or preview'
        );
        for (const id of [
            'readonly-proof',
            ...(!portalRetired ? ['grid-proof', 'list-proof'] : []),
        ]) {
            const node = document.getElementById(id);
            check(
                node.textContent.includes(fallback),
                `${id} missing inert fallback`
            );
            check(
                node.querySelectorAll('button,input,a,img,progress').length ===
                    0,
                `${id} exposes interactive or metadata-derived controls`
            );
            for (const label of initialLabels)
                check(
                    !node.textContent.includes(label),
                    `${id} exposed a filtered or native filename`
                );
        }
        checks.push(
            'Read-only Form/Grid/List use generic fallback without attachment details or actions'
        );
        check(
            [
                ...document.querySelectorAll(
                    '#masked-proof .mx-sdk-multiple-attachments-field'
                ),
            ].length === masked.length,
            'Mask cases missing'
        );
        for (const node of document.querySelectorAll(
            '#masked-proof .mx-sdk-multiple-attachments-field'
        ))
            check(
                node.textContent.includes('••••••••') &&
                    !node.textContent.includes(fallback) &&
                    node.querySelectorAll('button,input').length === 0,
                'Mask did not precede facet access'
            );
        checks.push(
            'Both mask flags on both config sides prevent facet/native reads in all contexts'
        );
        for (const node of document.querySelectorAll(
            '#inert-proof .mx-sdk-multiple-attachments-field'
        ))
            check(
                node.textContent.includes(fallback) &&
                    node.querySelectorAll('button,input').length === 0,
                'Malformed or missing capability was actionable'
            );
        checks.push(
            'Missing, computed, non-Form and malformed capabilities fail closed'
        );
        for (const [index, field] of unavailableActivity.entries()) {
            const node = document.querySelector(
                `#unavailable-activity-proof [data-activity="${index}"]`
            );
            check(
                node.textContent.includes(fallback),
                'Unavailable projection exposed row details'
            );
            check(
                node.querySelectorAll('li').length === 0,
                'Unavailable projection inspected rows'
            );
            if (index === 0)
                check(
                    node.querySelectorAll('button,input').length === 0,
                    'Idle unavailable projection is not inert'
                );
            else {
                const buttons = [...node.querySelectorAll('button')];
                check(
                    buttons.find(
                        (button) => button.textContent === 'Choose files'
                    )?.disabled &&
                        buttons.find(
                            (button) =>
                                button.textContent === 'Upload next file'
                        )?.disabled,
                    'Unavailable projection admitted selection or upload'
                );
                check(
                    buttons.find(
                        (button) => button.textContent === 'Clear pending files'
                    )?.disabled === false,
                    'Unavailable queued activity lost Clear'
                );
                check(
                    buttons.find(
                        (button) => button.textContent === 'Cancel upload'
                    )?.disabled === !field.capability.attachment.state.busy,
                    'Unavailable activity Cancel guard differs from busy state'
                );
            }
        }
        checks.push(
            'Unavailable projections are inert when idle and retain only guarded Clear/Cancel for activity'
        );
        check(
            !/PRIVATE_|private\.invalid|files\.example\.test/.test(
                document.getElementById('app').innerHTML
            ),
            'Private metadata appeared in rendered markup'
        );
        checks.push(
            'Supplied filtered labels are literal; URLs, previews and pending File metadata remain hidden'
        );
        if (retired)
            check(
                document.querySelectorAll(
                    '#editable-proof .mx-sdk-multiple-attachments-field'
                ).length === 0,
                'Retired owner retained adapter controls'
            );
        else {
            const rows = current.controller.getSnapshot().rows;
            const buttons = [
                ...document.querySelectorAll(
                    '#editable-proof button[data-attachment-row]'
                ),
            ];
            check(
                buttons.length === rows.length,
                'Filtered row occurrence count differs from controller'
            );
            check(
                buttons.every(
                    (button, index) =>
                        Number(button.dataset.attachmentRow) === index &&
                        button.getAttribute('aria-label') ===
                            `Remove attachment ${index + 1}`
                ),
                'Visible occurrence numbering changed'
            );
            for (const row of rows)
                check(
                    document
                        .getElementById('editable-proof')
                        .textContent.includes(row.label),
                    'Filtered row label missing'
                );
        }
        checks.push(
            'Editable display preserves filtered row order and uses visible occurrence numbering'
        );
        const filteredState = filtered.controller.getSnapshot();
        const filteredButtons = [
            ...document.querySelectorAll(
                '#filtered-proof button[data-attachment-row]'
            ),
        ];
        check(
            filteredButtons.length === filteredState.rows.length &&
                filteredButtons.every(
                    (button, index) =>
                        Number(button.dataset.attachmentRow) === index &&
                        button.getAttribute('aria-label') ===
                            `Remove attachment ${index + 1}`
                ),
            'Filtered prefix leaked through visible row numbering'
        );
        check(
            filteredState.rows.every(
                (row, index) => row.nativeIndex === index + 1
            ),
            'Filtered owner lost native occurrence positions'
        );
        check(
            filtered.fields.controller.getState().draft.data.files[0].url ===
                hiddenPrefix.url,
            'Filtered prefix was removed'
        );
        checks.push(
            'A real add-only owner filters its hidden prefix; duplicate removal remains native-index guarded'
        );
        check(
            counters.injectedReceived === counters.injectedDispatched,
            'Injected event did not reach its target'
        );
        checks.push(
            `Injected event receipt ${counters.injectedReceived}/${counters.injectedDispatched}; native actions are recorded separately`
        );
        check(
            document.documentElement.scrollWidth <= innerWidth,
            'Horizontal viewport overflow'
        );
        checks.push(
            `Viewport ${innerWidth} × ${innerHeight} has no horizontal overflow`
        );
        return checks;
    }
    function runProof() {
        try {
            const checks = verify();
            document.getElementById('checks').replaceChildren(
                ...checks.map((text) => {
                    const item = document.createElement('li');
                    item.textContent = text;
                    return item;
                })
            );
            const result = document.getElementById('proof-result');
            result.dataset.state = 'pass';
            result.textContent = `PASS · ${checks.length} checks · remounts ${remounts} · replacements ${replacements}${retired ? ' · Form retired' : ''}${portalRetired ? ' · Portal retired' : ''}`;
        } catch (error) {
            document.getElementById('proof-result').dataset.state = 'fail';
            document.getElementById('proof-result').textContent =
                `FAIL · ${error.message}`;
        }
        updateCounters();
        return snapshot();
    }
    async function action(name, operation) {
        try {
            await operation();
            history.push({ action: name });
            render();
            runProof();
        } catch (error) {
            errors.push(`${name}: ${error.message}`);
            runProof();
        }
    }
    function seed() {
        check(!retired, 'Cannot seed a retired owner');
        const beforeUploads = counters.uploads,
            beforeSaves = counters.saves;
        const generation = counters.fixtureSelections + 1;
        const files = [1, 2].map((index) => {
            const file = new File(
                [`synthetic-${generation}-${index}`],
                `PRIVATE_pending_${generation}_${index}.txt`,
                { type: 'text/plain' }
            );
            nativeInputs.set(file, `${generation}:${index}`);
            return file;
        });
        check(
            baseProps().capability.attachment.select(files),
            'Synthetic file selection was refused'
        );
        counters.fixtureSelections++;
        check(
            current.controller.getSnapshot().files[0] === files[0] &&
                current.controller.getSnapshot().files[1] === files[1],
            'Selection changed File identity or queue order'
        );
        check(
            counters.uploads === beforeUploads &&
                counters.saves === beforeSaves,
            'Selection triggered upload or Save'
        );
        history.push({
            action: 'fixture-selection',
            owner: current.id,
            selection: generation,
            count: files.length,
        });
    }
    async function completeUpload() {
        const flight = flights.find((candidate) => !candidate.finished);
        check(flight, 'No synthetic upload is awaiting completion');
        const shouldIgnore =
            flight.signal.aborted || flight.owner !== current || retired;
        const before = JSON.stringify(
            current.fields.controller.getState().draft?.data.files
        );
        flight.finished = true;
        flight.complete({
            id: null,
            filename: `Synthetic upload ${flight.selected}`,
            url: 'https://private.invalid/PRIVATE_uploaded_bytes',
            size: 12,
            type: 'text/plain',
        });
        await new Promise((done) => setTimeout(done, 0));
        if (shouldIgnore) {
            check(
                JSON.stringify(
                    current.fields.controller.getState().draft?.data.files
                ) === before,
                'Cancelled or stale completion modified the accepted draft'
            );
            lateResultChecks++;
        }
        history.push({
            action: 'synthetic-completion',
            owner: flight.owner.id,
            ignored: shouldIgnore,
        });
    }
    async function replaceOwner() {
        check(!retired, 'Cannot replace a retired owner');
        const predecessor = current;
        oldActions = baseProps().capability.attachment;
        const successor = structuredClone(loaded);
        const accepted = await predecessor.fields.reload({
            dirty: 'discard',
            read: async () => {
                counters.ownerReads++;
                return successor;
            },
        });
        check(accepted, 'Owner replacement load was not accepted');
        check(
            predecessor.controller.getSnapshot().retired,
            'Prior controller was not retired'
        );
        predecessor.scope.destroy();
        const id = `attachments-proof-${++replacements}`;
        const recovery = {
            journal: new RecoveryJournal(),
            scope: {
                owner: id,
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'synthetic-form',
                context: 'modal',
            },
            loadVersion: replacements + 1,
        };
        const controller = predecessor.fields.attachment('files', recovery);
        const scope = createFormRenderScope({
            fields: predecessor.fields,
            attachmentRecovery: recovery,
            isCurrent: () => true,
            configurationRevision: () => 0,
        });
        current = {
            fields: predecessor.fields,
            controller,
            scope,
            recovery,
            loaded: successor,
            id,
        };
        const nativeBefore = JSON.stringify(
            current.fields.controller.getState().draft.data.files
        );
        const uploadBefore = counters.uploads;
        const removed = oldActions.remove(0),
            selected = oldActions.select([
                new File(['stale'], 'PRIVATE_stale.txt', {
                    type: 'text/plain',
                }),
            ]),
            uploaded = await oldActions.upload();
        oldActions.clear();
        oldActions.cancel();
        check(
            !removed &&
                !selected &&
                !uploaded &&
                uploadBefore === counters.uploads &&
                JSON.stringify(
                    current.fields.controller.getState().draft.data.files
                ) === nativeBefore,
            'Retired action modified successor state'
        );
        staleProbe = { removed, selected, uploaded, successorUnchanged: true };
    }
    function injectedEvents() {
        // Never inject activating clicks into action buttons or the file picker.
        // These checks cover inert descendants and their wrapper; native buttons
        // are exercised separately by the browser operator.
        const targets = [
            ...document.querySelectorAll('.mx-sdk-multiple-attachments-field'),
        ].flatMap((node) => [
            node,
            ...node.querySelectorAll(
                'label,strong,span,p,output,li,[role="status"]'
            ),
        ]);
        for (const target of targets)
            for (const type of [
                'click',
                'auxclick',
                'dblclick',
                'pointerdown',
                'keydown',
                'keyup',
            ]) {
                const received = () => {
                    counters.injectedReceived++;
                };
                target.addEventListener(type, received, { once: true });
                const event = type.startsWith('key')
                    ? new KeyboardEvent(type, {
                          key: 'Escape',
                          bubbles: true,
                          cancelable: true,
                      })
                    : type === 'pointerdown'
                      ? new PointerEvent(type, {
                            bubbles: true,
                            cancelable: true,
                        })
                      : new MouseEvent(type, {
                            bubbles: true,
                            cancelable: true,
                        });
                counters.injectedDispatched++;
                target.dispatchEvent(event);
            }
        history.push({
            action: 'injected-events',
            targets: targets.length,
            events: targets.length * 6,
        });
    }
    window.__multipleAttachmentsProof = { snapshot, verify: runProof };
    portalScope
        .getSnapshot()
        .actions.load({ pagesToFetch: 1, refreshLoggedInPortalRecord: false })
        .then((accepted) => {
            check(accepted, 'Synthetic Portal load was not accepted');
            root = createRoot(document.getElementById('app'));
            render();
            document.getElementById('seed').onclick = () =>
                action('seed-two-files', seed);
            document.getElementById('complete').onclick = () =>
                action('complete-upload', completeUpload);
            document.getElementById('run').onclick = () =>
                action('injected-event-checks', injectedEvents);
            document.getElementById('remount').onclick = () =>
                action('remount', () => {
                    const before = current.controller.getSnapshot();
                    remounts++;
                    render();
                    const after = current.controller.getSnapshot();
                    check(
                        before.phase === after.phase &&
                            before.files.length === after.files.length &&
                            before.files.every(
                                (file, index) => file === after.files[index]
                            ),
                        'Remount changed owner-held queue or phase'
                    );
                });
            document.getElementById('replace').onclick = () =>
                action('replace-owner', replaceOwner);
            document.getElementById('retire').onclick = () =>
                action('retire-owner', () => {
                    current.fields.destroy();
                    current.scope.destroy();
                    retired = true;
                    check(
                        current.controller.getSnapshot().retired,
                        'Controller did not retire'
                    );
                });
            document.getElementById('retire-portal').onclick = () =>
                action('retire-portal', () => {
                    portalScope.destroy();
                    portalOwner.destroy();
                    portalRetired = true;
                });
            runProof();
        })
        .catch((error) => {
            errors.push(error.message);
            runProof();
        });
    window.addEventListener(
        'pagehide',
        () => {
            root?.unmount();
            current.scope.destroy();
            current.fields.destroy();
            readonly.scope.destroy();
            readonly.fields.destroy();
            filtered.scope.destroy();
            filtered.fields.destroy();
            portalScope.destroy();
            portalOwner.destroy();
        },
        { once: true }
    );
}

const css = `:root{font:15px/1.5 system-ui,sans-serif;color:#163448;background:#f2f6f8;color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:26px 20px 50px}h1{margin:0;font-size:clamp(1.7rem,4vw,2.4rem)}h2{font-size:1rem;margin:0 0 12px}.eyebrow{color:#167269;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700}.lead,.note{color:#566c7a}.note{font-size:.85rem}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}button{font:inherit;background:#fff;color:#164550;border:1px solid #789ca5;border-radius:6px;padding:8px 11px;cursor:pointer}button:hover{background:#e8f2f2}button:focus-visible{outline:3px solid #1479bc;outline-offset:3px}button:disabled{opacity:.5;cursor:default}.card{background:#fff;border:1px solid #d5e1e6;border-radius:9px;padding:16px;margin:0 0 14px;min-width:0}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.columns .card{min-width:0}.mx-sdk-multiple-attachments-field{margin-bottom:12px;overflow-wrap:anywhere;min-width:0}.mx-sdk-multiple-attachments-field label{display:block;font-weight:600}.mx-sdk-multiple-attachments-field ul{padding-left:20px}.save-control{border-top:1px solid #d5e1e6;padding-top:12px}.receipt,#counters{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}#proof-result{font-weight:750}#proof-result[data-state=pass]{color:#126344}#proof-result[data-state=fail]{color:#b91c37}#checks{font-size:.85rem;padding-left:20px}@media(max-width:680px){main{padding:18px 12px 36px}.columns{grid-template-columns:1fr;gap:0}.card{padding:13px}}`;

async function main() {
    assert.equal(
        process.argv.length,
        5,
        'Pass an installed consumer, tested tarball and fresh output directory.'
    );
    const consumer = realpathSync(resolve(process.argv[2]));
    const archive = realpathSync(resolve(process.argv[3]));
    const output = resolve(process.argv[4]);
    assert(
        lstatSync(consumer).isDirectory(),
        'Consumer must be an existing directory.'
    );
    assert(lstatSync(archive).isFile(), 'Archive must be a regular file.');
    assert(
        !existsSync(output),
        'Output already exists; use a fresh directory.'
    );
    assert(
        !inside(root, output) && !inside(consumer, output),
        'Keep proof output outside checkout and installed consumer.'
    );
    const archiveBytes = readFileSync(archive);
    const packageSha256 = sha256(archiveBytes);
    const integrity = `sha512-${createHash('sha512').update(archiveBytes).digest('base64')}`;
    const installed = join(consumer, 'node_modules/@miniextensions/sdk');
    assert.equal(
        realpathSync(installed),
        installed,
        'Installed SDK must not be a symlink.'
    );
    const lockBytes = readFileSync(join(consumer, 'package-lock.json'));
    const locked =
        JSON.parse(lockBytes).packages['node_modules/@miniextensions/sdk'];
    assert(
        locked &&
            !locked.link &&
            locked.integrity === integrity &&
            locked.resolved.startsWith('file:'),
        'Consumer must contain the exact local tested archive.'
    );
    const resolvedArchive = locked.resolved.startsWith('file://')
        ? fileURLToPath(locked.resolved)
        : resolve(consumer, locked.resolved.slice(5));
    assert.equal(
        realpathSync(resolvedArchive),
        archive,
        'Consumer lock resolves a different archive.'
    );
    const metadata = JSON.parse(
        readFileSync(join(installed, 'package.json'), 'utf8')
    );
    assert.equal(metadata.name, '@miniextensions/sdk');
    const sourceStart = sourceReceipt();
    const fixture = multipleAttachmentsLoadedFixture();
    const loaded = fixture.loaded ?? fixture;
    const entry = `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {flushSync} from 'react-dom';\nimport {createMiniExtensionsClient} from '@miniextensions/sdk';\nimport {createFormFieldBindings,RecoveryJournal} from '@miniextensions/sdk/forms';\nimport {createPortalListOwner} from '@miniextensions/sdk/portals';\nimport {createFormRenderScope,createPortalRenderScope} from '@miniextensions/sdk/ui';\nimport {AirtableForm,AirtableGrid,AirtableList,MultipleAttachmentsField,renderMultipleAttachmentsField} from '@miniextensions/sdk/react';\n(${browserMain.toString()})(${JSON.stringify({ loaded, portal: portalRecipeFixtures.makePortal() })});\n`;
    const bundle = await build({
        absWorkingDir: consumer,
        stdin: {
            contents: entry,
            resolveDir: consumer,
            sourcefile: 'multiple-attachments-proof-entry.js',
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
    await assertBrowserInputs(
        {
            ...bundle.metafile,
            inputs: Object.fromEntries(
                Object.entries(bundle.metafile.inputs).filter(
                    ([path]) => path !== 'multiple-attachments-proof-entry.js'
                )
            ),
        },
        consumer
    );
    const inputs = Object.keys(bundle.metafile.inputs)
        .sort()
        .map((path) => {
            if (path === 'multiple-attachments-proof-entry.js')
                return { path, kind: 'generated-entry', sha256: sha256(entry) };
            const actual = realpathSync(resolve(consumer, path));
            assert(
                inside(consumer, actual),
                'Bundle input escaped installed consumer.'
            );
            const name = relative(consumer, actual).split(sep).join('/');
            const bytes = readFileSync(actual);
            const item = {
                path: name,
                sha256: sha256(bytes),
                bytes: bytes.length,
            };
            if (name.startsWith('node_modules/@miniextensions/sdk/')) {
                assert(
                    name.startsWith(
                        'node_modules/@miniextensions/sdk/dist/esm/'
                    ),
                    'SDK browser input must be installed ESM.'
                );
                const member = `package/${name.slice('node_modules/@miniextensions/sdk/'.length)}`;
                const archived = execFileSync(
                    'tar',
                    ['-xOf', archive, member],
                    { maxBuffer: 16 * 1024 * 1024 }
                );
                assert(
                    bytes.equals(archived),
                    `Installed SDK input differs from archive: ${member}`
                );
                Object.assign(item, {
                    archiveMember: member,
                    matchesArchive: true,
                });
            }
            return item;
        });
    assert(
        inputs.some(
            ({ path }) =>
                path ===
                'node_modules/@miniextensions/sdk/dist/esm/react/MultipleAttachmentsField.js'
        ),
        'Dedicated installed adapter was not bundled.'
    );
    assert.equal(
        sha256(readFileSync(archive)),
        packageSha256,
        'Archive changed during build.'
    );
    assert.equal(
        sha256(readFileSync(join(consumer, 'package-lock.json'))),
        sha256(lockBytes),
        'Consumer lock changed during build.'
    );
    const sourceEnd = sourceReceipt();
    assert.deepEqual(
        sourceEnd,
        sourceStart,
        'Source changed during fixture build.'
    );
    const receipt = {
        createdAt: new Date().toISOString(),
        proofMode: 'installed-public-export',
        browserExecution: 'pending-supported-browser-verification',
        package: {
            archive,
            name: metadata.name,
            version: metadata.version,
            sha256: packageSha256,
            integrity,
            bytes: archiveBytes.length,
        },
        source: {
            start: sourceStart,
            end: sourceEnd,
            unchangedDuringBuild: true,
            relationToArchive:
                'Source identity at fixture build time; caller supplies its separately qualified archive.',
        },
        consumer: {
            directory: consumer,
            installMode:
                'Existing caller-provided install; builder performs no install, server start or deletion.',
            lockSha256: sha256(lockBytes),
            inputsVerified: true,
            sdkFormat: 'installed ESM',
            sdkInputsMatchedToArchive: inputs.filter(
                (item) => item.matchesArchive
            ).length,
            inputs,
        },
        checks: 'Synthetic owner transports and injected events only; native browser actions and screenshots must be retained separately.',
        output: {},
    };
    const assets = {
        'entry.js': entry,
        'main.js': bundle.outputFiles[0].contents,
        'styles.css': css,
        'bundle-inputs.json': JSON.stringify(bundle.metafile, null, 2) + '\n',
        'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Multiple Attachments adapter proof</title><link rel="stylesheet" href="./styles.css"></head><body><main><p class="eyebrow">miniExtensions SDK · installed package proof</p><h1>Multiple Attachments adapter</h1><p class="lead">Synthetic Form and Portal owners exercise existing filtered snapshots and guarded actions. Read-only presentations intentionally show only a generic fallback. No downloads, previews, remote requests or clipboard access are connected.</p><p class="note">Seed two files is a fixture control, separate from the adapter picker. Selection must not upload. Click Upload next file, then Complete synthetic upload; clear and cancel have different effects. Save remains explicit. Replace the owner during an upload to inspect late completion rejection.</p><div class="toolbar"><button id="seed" type="button">Seed two synthetic files</button><button id="complete" type="button">Complete synthetic upload</button><button id="run" type="button">Run injected event checks</button><button id="remount" type="button">Remount adapter</button><button id="replace" type="button">Replace accepted owner</button><button id="retire" type="button">Retire Form owner</button><button id="retire-portal" type="button">Retire Portal scope</button></div><section class="card" aria-label="Proof result"><p id="proof-result" role="status" data-state="pending">Loading installed SDK…</p><p id="counters"></p><ul id="checks"></ul><p class="note">Injected events cover inert adapter descendants only. Native picker, pointer, keyboard, accessibility and responsive inspection are separate browser checks. Save and upload transports are in-memory stubs.</p></section><div id="app"></div><p class="receipt">Archive SHA-256: ${packageSha256}<br>Source HEAD: ${sourceStart.head}<br>Source tree: ${sourceStart.tree}<br>Provenance: receipt.json</p></main><script type="module" src="./main.js"></script></body></html>`,
    };
    mkdirSync(output, { recursive: true });
    for (const [name, bytes] of Object.entries(assets)) {
        writeFileSync(join(output, name), bytes);
        receipt.output[name] = {
            sha256: sha256(bytes),
            bytes: Buffer.byteLength(bytes),
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
                packageSha256,
                sourceHead: sourceStart.head,
                sourceTree: sourceStart.tree,
                sdkInputsMatchedToArchive:
                    receipt.consumer.sdkInputsMatchedToArchive,
                inputs: inputs.length,
                browserExecution: receipt.browserExecution,
            },
            null,
            2
        )
    );
}

await main();
