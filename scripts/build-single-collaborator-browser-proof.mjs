// Build only. Drive the retained page with the supported browser tool separately.
// Usage: SDK_SINGLE_COLLABORATOR_NPM_CACHE=/path/to/seeded/cache node scripts/build-single-collaborator-browser-proof.mjs tested.tgz output-directory
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
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { singleCollaboratorLoadedFixture } from './single-collaborator-consumer-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' });
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
function browserMain(data) {
    const { loaded, expected, portal } = data;
    const h = React.createElement;
    const counters = {
        writes: 0,
        saves: 0,
        network: 0,
        rows: 0,
        getters: 0,
        portalReads: 0,
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
            ownerId: 'single-collaborator-browser-synthetic',
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
    const blockedLoaded = structuredClone(loaded);
    blockedLoaded.payload.fieldIdsInForm = ['source'];
    blockedLoaded.payload.formRecord = {
        ...blockedLoaded.payload.formRecord,
        type: 'edit',
        tableId: 'tbl_collaborator_synthetic',
        recordId: 'rec_collaborator_synthetic',
    };
    blockedLoaded.payload.fieldIdsToSchemas.source.miniExtConfig = {
        hideFieldIfEmpty: true,
    };
    const blockedFields = createFormFieldBindings({
        ...bindingOptions,
        loaded: blockedLoaded,
    });
    const blockedBefore = JSON.stringify(blockedFields.controller.getState());
    const scope = createFormRenderScope({
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const binding = fields.field('source');
    for (const id of loaded.payload.fieldIdsInForm)
        fields.field(id).setValue = block('writes');
    const lifecycleBinding = lifecycleFields.field('source');
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
    const maskedProps = {
        ...baseProps,
        title: 'Masked getter',
        displayConfig: { obscurePassword: true },
        writeConfig: null,
    };
    Object.defineProperty(maskedProps, 'value', {
        enumerable: true,
        get: poison,
    });
    const maskedNative = {};
    Object.defineProperties(maskedNative, {
        name: { get: poison },
        id: { get: poison },
        email: { get: poison },
        profilePicUrl: { get: poison },
    });
    const writeMaskProps = {
        ...baseProps,
        title: 'Write-side mask',
        displayConfig: { showTitle: false },
        writeConfig: { maskPasswordOnLoginScreen: true },
        value: maskedNative,
    };
    function poisonBinding(mode) {
        const original = binding.getSnapshot();
        const snapshot = {
            ...original,
            field: {
                ...original.field,
                title: 'Masked binding',
                schema: {
                    ...original.field.schema,
                    miniExtConfig:
                        mode === 'masked'
                            ? { obscurePassword: true }
                            : mode === 'login-mask'
                              ? { maskPasswordOnLoginScreen: true }
                              : {},
                },
            },
            visibility: {
                type:
                    mode === 'hidden'
                        ? 'hidden'
                        : mode === 'blocked'
                          ? 'blocked'
                          : 'visible',
                diagnostics: [],
            },
            retired: mode === 'retired',
        };
        Object.defineProperty(snapshot, 'value', {
            enumerable: true,
            get: poison,
        });
        return {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            setValue: block('writes'),
            scalar: null,
            selection: null,
            date: null,
        };
    }
    const maskedBinding = poisonBinding('masked');
    const hiddenBinding = poisonBinding('hidden');
    const blockedBinding = poisonBinding('blocked');
    const loginMaskBinding = poisonBinding('login-mask');
    const retiredBinding = poisonBinding('retired');
    const field = loaded.payload.fieldIdsToSchemas.source.airtableField;
    const details = [
        {
            fieldId: 'source',
            fieldName: 'Single Collaborator',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {},
        },
    ];
    const portalNative = {
        id: 'usr_PRIVATE_PORTAL',
        email: 'private-portal@example.invalid',
        name: '  Grace Hopper\nΩ ',
        profilePicUrl: 'https://private.invalid/portal-avatar.png',
        extra: { source: 'PRIVATE_PORTAL_EXTRA' },
    };
    portal.payload.initialLinkedTableStates.tbl_children.airtableFields = [
        field,
    ];
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = details;
    client.portals.listLinkedRecords = async () => {
        counters.portalReads++;
        return {
            airtableOffset: null,
            recordIds: ['rec_collaborator'],
            customViewDetailFields: { fld_children: details },
            tableIdsToLinkedTableStates: {
                tbl_children: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        rec_collaborator: {
                            id: 'rec_collaborator',
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
            ownerId: 'single-collaborator-browser-portal',
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
    const renderers = { renderSingleCollaboratorField };
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
                'Form · exact supplied names',
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
                    'Binding · native object retained',
                    h(SingleCollaboratorField, { binding })
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
                                    'aria-label': 'Single Collaborator grid',
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
                        renderSingleCollaboratorField(maskedProps),
                        renderSingleCollaboratorField(writeMaskProps),
                        h(SingleCollaboratorField, { binding: maskedBinding }),
                        h(SingleCollaboratorField, {
                            binding: loginMaskBinding,
                        })
                    )
                ),
                section(
                    'lifecycle-proof',
                    'Lifecycle · accepted binding',
                    h(SingleCollaboratorField, { binding: lifecycleBinding }),
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
                    h(SingleCollaboratorField, { binding: hiddenBinding }),
                    h(SingleCollaboratorField, { binding: blockedBinding }),
                    h(SingleCollaboratorField, {
                        binding: blockedFields.field('source'),
                    }),
                    h(SingleCollaboratorField, { binding: retiredBinding }),
                    h(
                        'p',
                        { className: 'note' },
                        'No native value is exposed. Edit hide-if-empty remains blocked by the existing owner policy.'
                    )
                )
            ),
            section(
                'native-proof',
                'Native object evidence',
                h(
                    'pre',
                    null,
                    JSON.stringify(
                        {
                            formNativeUnchanged:
                                JSON.stringify(fields.controller.getState()) ===
                                nativeBefore,
                            portalNativeUnchanged:
                                JSON.stringify(
                                    portalScope.getSnapshot().records
                                ) === portalBefore,
                            hideIfEmptyEditStatus: blockedFields
                                .field('source')
                                .getSnapshot().visibility.type,
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
            'Form: exact supplied names, literal markup, whitespace, Unicode, URL text, blank, null, missing, extra native metadata and mask'
        );
        check(
            document.querySelector('#binding-proof output')?.textContent ===
                'Ada Lovelace',
            'Binding text mismatch'
        );
        for (const id of ['grid-proof', 'list-proof'])
            check(
                document.querySelector(`#${id} output`)?.textContent ===
                    portalNative.name,
                `${id} text mismatch`
            );
        checks.push('Actual Form, Grid, List and binding renderers');
        check(
            document.querySelectorAll('#mask-proof output').length === 4,
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
            blockedFields.field('source').getSnapshot().visibility.type ===
                'blocked',
            'Edit hide-if-empty policy changed'
        );
        check(
            JSON.stringify(blockedFields.controller.getState()) ===
                blockedBefore,
            'Blocked owner native state changed'
        );
        check(
            !!document.querySelector('#lifecycle-proof output') !== retired,
            'Lifecycle retirement mismatch'
        );
        checks.push(
            'Both masks precede value/name/id/email/avatar access; hidden, blocked and retired bindings omit output'
        );
        check(
            !document.querySelector(
                '.proof-surface input,.proof-surface textarea,.proof-surface select,.proof-surface button,.proof-surface [role=combobox],.proof-surface [role=listbox],.proof-surface a,.proof-surface img,.proof-surface canvas,.proof-surface video,.proof-surface audio,.proof-surface iframe,.proof-surface object,.proof-surface embed,.proof-surface svg,.proof-surface [contenteditable=true]'
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
        const nativeIdentities = [
            ...Object.values(loaded.payload.formRecord.data),
            portalNative,
        ].filter(
            (value) => value && typeof value === 'object' && 'name' in value
        );
        const dom = document.body.innerHTML;
        for (const identity of nativeIdentities)
            for (const key of ['id', 'email', 'profilePicUrl'])
                if (typeof identity[key] === 'string' && identity[key])
                    check(
                        !dom.includes(identity[key]),
                        `Identity ${key} leaked into DOM`
                    );
        check(
            !dom.includes('PRIVATE_MASKED_COLLABORATOR') &&
                !dom.includes('PRIVATE_EXTRA') &&
                !dom.includes('PRIVATE_PORTAL_EXTRA'),
            'Masked name or extra native metadata leaked into DOM'
        );
        checks.push(
            'No native IDs, emails, avatars, extra metadata or masked names in DOM'
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
        check(errors.length === 0, errors.join('\n'));
        checks.push(
            'Complete native collaborator objects and missing key preserved; zero write/save/network/row events'
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
        document.getElementById('retire').onclick = () => {
            retired = true;
            flushSync(() => lifecycleFields.destroy());
            render();
            runProof();
            document.getElementById('retire').disabled = true;
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
            blockedFields.destroy();
            portalScope.destroy();
            owner.destroy();
        },
        { once: true }
    );
}

const css = `
:root{font-family:system-ui,sans-serif;color:#153044;background:#f3f6f8;font-size:15px;line-height:1.5;color-scheme:light}
*{box-sizing:border-box}body{margin:0}main{max-width:1160px;margin:auto;padding:28px 22px 48px}h1{margin:0;font-size:clamp(1.6rem,4vw,2.4rem);line-height:1.15}h2{font-size:1rem;margin:0 0 14px}p{margin:10px 0}.eyebrow{color:#186d67;letter-spacing:.1em;text-transform:uppercase;font-weight:700;font-size:.8rem}.lead,.note{color:#546675}.lead{max-width:75ch}.note{font-size:.85rem}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}button{font:inherit;font-weight:600;border:1px solid #75959c;border-radius:7px;background:white;padding:8px 12px;color:#123e45;cursor:pointer}button:hover{background:#e7f1f1}button:focus-visible{outline:3px solid #1679c7;outline-offset:3px}button:disabled{opacity:.55;cursor:default}.card{background:white;border:1px solid #d5e1e6;border-radius:10px;padding:16px;min-width:0;margin-bottom:14px}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.columns .card{margin-bottom:14px}.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.field{border-top:1px solid #e5ecee;padding-top:10px;min-width:0}.mx-sdk-single-collaborator-field{display:block;min-width:0}.mx-sdk-single-collaborator-field label{color:#526a76;display:block;font-size:.8rem;font-weight:650;margin-bottom:4px}.mx-sdk-single-collaborator-field output{min-height:1.7em;font-family:ui-monospace,monospace;font-size:.93rem}ul{padding-left:20px}.stack{display:grid;gap:12px}pre{font-size:.85rem;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}#proof-result{font-weight:750;font-size:1.05rem}#proof-result[data-state=pass]{color:#116143}#proof-result[data-state=fail]{color:#b21d30}#counters{font-family:ui-monospace,monospace;font-size:.8rem;overflow-wrap:anywhere}#checks{font-size:.85rem;margin-bottom:0}.receipt{font-size:.75rem;color:#5c707b;overflow-wrap:anywhere}@media(max-width:680px){main{padding:20px 14px 36px}.columns,.field-grid{grid-template-columns:1fr}.card{padding:14px}.columns{gap:0}}@media(forced-colors:active){.card,button{border:1px solid CanvasText}}
`;

async function main() {
    assert(
        process.argv[2] && process.argv[3],
        'Pass the tested tarball and a fresh output directory.'
    );
    const archive = realpathSync(resolve(process.argv[2]));
    const output = resolve(process.argv[3]);
    assert(
        lstatSync(archive).isFile(),
        'The package archive must be a regular file.'
    );
    assert(
        !existsSync(output),
        'Output directory already exists; use a fresh proof directory.'
    );
    const packageSha256 = sha256(readFileSync(archive));
    const packageIntegrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    const sourceStart = sourceReceipt();
    const consumer = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-single-collaborator-browser-'))
    );
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
                    ...(process.env.SDK_SINGLE_COLLABORATOR_NPM_CACHE
                        ? {
                              npm_config_cache: resolve(
                                  process.env.SDK_SINGLE_COLLABORATOR_NPM_CACHE
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
        const entry = `import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {flushSync} from 'react-dom';\nimport {createMiniExtensionsClient} from '@miniextensions/sdk';\nimport {createFormFieldBindings} from '@miniextensions/sdk/forms';\nimport {createPortalListOwner} from '@miniextensions/sdk/portals';\nimport {createFormRenderScope,createPortalRenderScope} from '@miniextensions/sdk/ui';\nimport {AirtableForm,AirtableGrid,AirtableList,SingleCollaboratorField,renderSingleCollaboratorField} from '@miniextensions/sdk/react';\n(${browserMain.toString()})(${JSON.stringify({ ...singleCollaboratorLoadedFixture(), portal: portalRecipeFixtures.makePortal() })});\n`;
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
        assert.equal(
            sha256(readFileSync(archive)),
            packageSha256,
            'Archive changed during build.'
        );
        const sourceEnd = sourceReceipt();
        const receipt = {
            createdAt: new Date().toISOString(),
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
                inputs,
            },
            checks: 'Visible page self-checks cover actual SDK renderers and synthetic injected DOM events; native user/browser checks remain separate.',
            output: {},
        };
        mkdirSync(output, { recursive: true });
        const assets = {
            'main.js': bundle.outputFiles[0].contents,
            'styles.css': css,
            'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Single Collaborator display proof</title><link rel="stylesheet" href="./styles.css"></head><body><main><p class="eyebrow">miniExtensions SDK · installed package proof</p><h1>Single Collaborator supplied names</h1><p class="lead">Native collaborator objects remain with the owner. These Form, Grid and List displays preserve supplied names, blank names and whitespace; identity metadata stays internal. All data is synthetic.</p><div class="toolbar"><button id="run" type="button">Run interaction checks</button><button id="remount" type="button">Remount displays</button><button id="retire" type="button">Retire binding</button></div><section class="card" aria-label="Proof result"><p id="proof-result" role="status" data-state="pending">Loading installed SDK…</p><p id="counters"></p><ul id="checks"></ul><p class="note">Interaction checks inject DOM events. Use the browser separately for native pointer, keyboard, accessibility and responsive inspection.</p></section><div id="app"></div><p class="receipt">Archive SHA-256: ${packageSha256}<br>Source HEAD at build: ${sourceStart.head}<br>Exact inputs and dirty-source hashes: receipt.json</p></main><script type="module" src="./main.js"></script></body></html>`,
            'bundle-inputs.json':
                JSON.stringify(bundle.metafile, null, 2) + '\n',
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
                    packageSha256,
                    inputs: inputs.length,
                    browserExecution: receipt.browserExecution,
                },
                null,
                2
            )
        );
    } finally {
        rmSync(consumer, { recursive: true, force: true });
    }
}

await main();
