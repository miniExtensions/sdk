import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { transform } from 'esbuild';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const portalButtonCompositionTypedConsumer = `
import { createPortalRenderScope, createPortalCellRendererHost, type ButtonFieldRecovery, type PortalRenderScopeOptions, type PortalCellRendererHostOptions, type FieldRendererSlots } from '@miniextensions/sdk/ui';
export function typedPortalButtonRecovery(scope: PortalRenderScopeOptions, cell: PortalCellRendererHostOptions, recovery: ButtonFieldRecovery) {
    const composed = createPortalRenderScope({...scope, buttonRecovery: recovery});
    const host = createPortalCellRendererHost({...cell, buttonRecovery: recovery});
    const optionalScope: ButtonFieldRecovery | undefined = scope.buttonRecovery;
    const optionalCell: ButtonFieldRecovery | undefined = cell.buttonRecovery;
    void [optionalScope, optionalCell];
    host.dispose(); composed.destroy();
}
export const typedPortalButtonSlots: FieldRendererSlots<string> = {renderButtonField(props) {
    if(props.capability.type === 'button') {
        const link = props.capability.button.prepareLink();
        void props.capability.button.triggerWebhook();
        props.capability.button.cancel();
        // @ts-expect-error Button renderer actions expose no extension credential
        props.capability.button.extensionAccessToken;
        return link?.href ?? props.title;
    }
    return props.title;
}};
`;
export const portalButtonCompositionReactTypedConsumer = `
import { createElement } from 'react';
import { AirtableGrid, AirtableList } from '@miniextensions/sdk/react';
import type { PortalRenderScope } from '@miniextensions/sdk/ui';
export function typedPortalButtonShell(scope: PortalRenderScope) {
    return [AirtableGrid,AirtableList].map(Component => createElement(Component, {scope,
        renderers: {renderButtonField(props) {
            if (props.capability.type !== 'button') return null;
            const button = props.capability.button;
            return createElement('button', {onClick:()=>void button.triggerWebhook()}, props.title);
        }}, children: state => createElement('section', null, ...state.rows.flatMap(row=>row.cells.map(cell=>cell.node)))
    }));
}
`;

const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
async function fixture(
    api,
    { mode = 'triggerWebhookPOST', cell = false, multiple = false } = {}
) {
    const portal = fixtures.makePortal();
    const config = portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
    Object.assign(config, { layout: 'grid', disableInlineEdit: false });
    Object.assign(config.customViews[0].config, {
        layout: 'grid',
        disableInlineEdit: false,
    });
    config.customViews.push({
        ...structuredClone(config.customViews[0]),
        id: 'view_other',
    });
    const field = {
        id: 'fld_button',
        name: 'Action',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'button', options: null },
    };
    const policy = { openLinkType: mode };
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = [
        {
            fieldId: 'fld_button',
            fieldName: 'Action',
            titleOverride: 'Returned action',
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: policy,
        },
    ];
    let row = 'rec_one',
        configuration = 0,
        current = true,
        session = { visitor: 'A' };
    const calls = [],
        reads = [],
        cellWrites = [];
    let respond = async () => ({ success: true });
    const client = {
        getSession: () => ({ ...session }),
        buttons: {
            triggerWebhook: async (input) => {
                calls.push(structuredClone(input));
                return respond(input);
            },
        },
        portals: {
            listLinkedRecords: async (input) => {
                reads.push(structuredClone(input));
                const page = fixtures.page([
                    {
                        id: row,
                        fields: {
                            fld_button: {
                                url: 'portal.example.test/action',
                                label: 'Portal action',
                            },
                        },
                    },
                ]);
                if (multiple) {
                    page.recordIds.push('rec_two');
                    page.tableIdsToLinkedTableStates.tbl_children.recordIdsToAirtableRecords.rec_two =
                        {
                            id: 'rec_two',
                            fields: {
                                fld_button: {
                                    url: 'portal.example.test/second',
                                    label: 'Second action',
                                },
                            },
                        };
                }
                page.tableIdsToLinkedTableStates.tbl_children.airtableFields = [
                    field,
                ];
                page.layoutSettings = {
                    ...page.layoutSettings,
                    layout: 'grid',
                    disableInlineEdit: false,
                };
                return page;
            },
            updateGridCell: async (input) => {
                cellWrites.push(input);
                throw Error('No Button cell save');
            },
        },
    };
    const criteria = {
        selectedCustomViewId: 'view_example',
        searchTerm: null,
        searchParamsMap: {},
        sortFieldsByEndUser: null,
        filtersByEndUser: null,
        supportsEndUserSortCleanup: true,
        supportsEndUserFilterCleanup: true,
    };
    const owner = api.portals.createPortalListOwner({
        client,
        portal,
        portalFieldId: 'fld_children',
        criteria,
        getScope: () => ({ ownerId: 'A', revision: 0 }),
        isCurrent: () => current,
        configurationRevision: () => configuration,
    });
    assert.equal(
        await owner.readFirst(owner.getSnapshot().revision, readOptions),
        true
    );
    const recovery = {
        journal: new api.forms.RecoveryJournal(),
        scope: {
            owner: 'A',
            parentFieldId: 'fld_children',
            tableId: 'tbl_children',
            childExtensionId: '',
            context: 'modal',
        },
        loadVersion: 1,
    };
    const cells = [];
    const options = {
        owner,
        client,
        buttonRecovery: recovery,
        isCurrent: () => current,
        configurationRevision: () => configuration,
        ...(cell
            ? {
                  resolveCell({ recordId, fieldId, ownerRevision }) {
                      const binding = api.portals.createPortalCellBinding({
                          client,
                          input: {
                              portalExtensionAccessToken:
                                  portal.payload.extensionAccessToken,
                              portalFieldId: 'fld_children',
                              selectedCustomViewId: 'view_example',
                              recordId,
                              recordFieldId: fieldId,
                          },
                          schema: {
                              fieldType: 'button',
                              airtableField: field,
                              miniExtConfig: policy,
                          },
                          value: {
                              url: 'portal.example.test/action',
                              label: 'Portal action',
                          },
                          getScope: () => ({ ownerId: 'A', revision: 0 }),
                          isCurrent: () => owner.isCurrent(ownerRevision),
                          recovery,
                      });
                      cells.push(binding);
                      return binding;
                  },
              }
            : {}),
    };
    return {
        owner,
        options,
        recovery,
        calls,
        reads,
        cellWrites,
        client,
        scope: () =>
            api.guide.createPortalButtonPresentation(options, recovery),
        respond: (fn) => {
            respond = fn;
        },
        replace: async (kind) => {
            if (kind === 'row') {
                row = 'rec_other';
                await owner.readFirst(
                    owner.getSnapshot().revision,
                    readOptions
                );
            } else if (kind === 'view' || kind === 'criteria')
                assert.equal(
                    owner.setCriteria(owner.getSnapshot().revision, {
                        ...criteria,
                        ...(kind === 'view'
                            ? { selectedCustomViewId: 'view_other' }
                            : { searchTerm: 'Changed' }),
                    }),
                    true,
                    kind
                );
            else if (kind === 'session') session = { visitor: 'B' };
            else if (kind === 'configuration') configuration++;
            else current = false;
        },
        destroy() {
            cells.forEach((c) => c.destroy());
            owner.destroy();
        },
    };
}
const buttonProps = (scope, rowIndex = 0) => {
    const snapshot = scope.getSnapshot();
    const props = snapshot.rows[rowIndex]?.cells
        .find((c) => c.fieldId === 'fld_button')
        ?.host.getSnapshot().fields?.[0];
    assert.equal(props?.capability.type, 'button');
    return props.capability.button;
};

/** Real packed modules, real React named slots; fake accepted page and transport only. */
export async function checkPortalButtonCompositionConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const root = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const entries = ['ui', 'forms', 'portals', 'react'];
    const esm = Object.fromEntries(
        await Promise.all(
            entries.map(async (name) => [
                name,
                await import(pathToFileURL(join(root, name, 'index.js'))),
            ])
        )
    );
    const cjs = Object.fromEntries(
        entries.map((name) => [name, require('@miniextensions/sdk/' + name)])
    );
    const guideText = readFileSync(
        join(
            consumerDirectory,
            'node_modules/@miniextensions/sdk/docs/field-bindings.md'
        ),
        'utf8'
    );
    const fences = [
        ...guideText.matchAll(/```(?:ts|tsx)\n([\s\S]*?)\n```/g),
    ].map((match) => match[1]);
    const guideSource = [
        'export function createPortalButtonPresentation',
        'export function PortalButtonSlot',
    ]
        .map((marker) => {
            const matching = fences.filter((fence) => fence.includes(marker));
            assert.equal(matching.length, 1, marker);
            return matching[0];
        })
        .join('\n');
    const typedGuide = join(consumerDirectory, 'portal-button-guide.tsx');
    writeFileSync(typedGuide, guideSource);
    const compilation = spawnSync(
        process.execPath,
        [
            createRequire(import.meta.url).resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--jsx',
            'react-jsx',
            typedGuide,
        ],
        { cwd: consumerDirectory, encoding: 'utf8' }
    );
    assert.equal(
        compilation.status,
        0,
        compilation.stdout + compilation.stderr
    );
    for (const [api, format, extension] of [
        [esm, 'esm', 'mjs'],
        [cjs, 'cjs', 'cjs'],
    ]) {
        const file = join(
            consumerDirectory,
            'portal-button-guide.' + extension
        );
        writeFileSync(
            file,
            (
                await transform(guideSource, {
                    loader: 'tsx',
                    format,
                    target: 'es2022',
                })
            ).code
        );
        api.guide =
            format === 'esm'
                ? await import(pathToFileURL(file))
                : require(file);
        assert.equal(
            typeof api.guide.portalButtonSlots.renderButtonField,
            'function'
        );
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'Event',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((k) =>
        Object.getOwnPropertyDescriptor(globalThis, k)
    );
    keys.forEach((k) =>
        Object.defineProperty(globalThis, k, {
            configurable: true,
            writable: true,
            value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[k],
        })
    );
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    try {
        for (const api of [esm, cjs]) {
            for (const cell of [false, true]) {
                for (const Component of [
                    api.react.AirtableGrid,
                    api.react.AirtableList,
                ]) {
                    const f = await fixture(api, { cell });
                    let scope = f.scope(),
                        renderer,
                        props,
                        action;
                    const container = window.document.createElement('div');
                    window.document.body.append(container);
                    const tree = () =>
                        h(
                            StrictMode,
                            null,
                            h(Component, {
                                scope,
                                renderers: {
                                    renderButtonField(p) {
                                        assert.equal(
                                            p.capability.type,
                                            'button'
                                        );
                                        assert.equal(
                                            p.context,
                                            'portal-detail'
                                        );
                                        props = p.capability.button;
                                        return api.guide.PortalButtonSlot({
                                            ...p,
                                            capability: {
                                                ...p.capability,
                                                button: {
                                                    ...props,
                                                    triggerWebhook: () => {
                                                        action =
                                                            props.triggerWebhook();
                                                        return action;
                                                    },
                                                },
                                            },
                                        });
                                    },
                                },
                                children: (s) =>
                                    h(
                                        'section',
                                        null,
                                        ...s.rows.flatMap((r) =>
                                            r.cells.map((c) => c.node)
                                        )
                                    ),
                            })
                        );
                    try {
                        renderer = createRoot(container);
                        await act(async () => renderer.render(tree()));
                        assert.equal(
                            container.querySelector('button').textContent,
                            'Portal action'
                        );
                        assert.equal(f.calls.length, 0);
                        assert.equal(f.reads.length, 1);
                        assert.equal(f.cellWrites.length, 0);
                        await act(async () => {
                            container.querySelector('button').click();
                            await action;
                        });
                        assert.equal((await action).type, 'reported-success');
                        assert.deepEqual(f.calls, [
                            {
                                extensionAccessToken: 'portal_access_example',
                                fieldId: 'fld_button',
                                source: {
                                    type: 'linked-record',
                                    linkedRecordId: 'rec_one',
                                    linkedTableId: 'tbl_children',
                                    parentLinkedRecordFieldId: 'fld_children',
                                    selectedCustomViewId: 'view_example',
                                },
                            },
                        ]);
                        checks++;
                        await act(async () => renderer.unmount());
                        renderer = createRoot(container);
                        await act(async () => renderer.render(tree()));
                        assert.equal(f.calls.length, 1);
                        checks++;
                    } finally {
                        if (renderer) await act(async () => renderer.unmount());
                        scope.destroy();
                        f.destroy();
                        container.remove();
                    }
                }
                {
                    const f = await fixture(api, { cell, mode: '_self' });
                    const scope = f.scope();
                    try {
                        const linkSlot = api.guide.PortalButtonSlot(
                            scope
                                .getSnapshot()
                                .rows[0].cells[0].host.getSnapshot().fields[0]
                        );
                        assert.equal(linkSlot.type, 'a');
                        assert.equal(linkSlot.props.target, '_self');
                        assert.equal(
                            linkSlot.props.href,
                            'https://portal.example.test/action'
                        );
                        assert.deepEqual(buttonProps(scope).prepareLink(), {
                            href: 'https://portal.example.test/action',
                            target: '_self',
                            rel: 'noreferrer',
                        });
                        assert.equal(
                            (await buttonProps(scope).triggerWebhook()).type,
                            'refused'
                        );
                        assert.equal(f.calls.length, 0);
                        checks++;
                    } finally {
                        scope.destroy();
                        f.destroy();
                    }
                }
                {
                    const f = await fixture(api, { cell });
                    let scope = f.scope();
                    try {
                        const pending = fixtures.deferred();
                        f.respond(() => pending.promise);
                        const action = buttonProps(scope).triggerWebhook();
                        assert.equal(f.calls.length, 1);
                        assert.equal(buttonProps(scope).cancel(), true);
                        pending.reject(Error('Synthetic uncertain transport'));
                        assert.equal((await action).type, 'uncertain');
                        scope.destroy();
                        scope = f.scope();
                        const held = buttonProps(scope);
                        assert.equal(held.phase, 'uncertain');
                        assert.equal(f.recovery.journal.unknown('A').length, 1);
                        assert.equal(held.canTrigger, false);
                        assert.equal(
                            (await held.triggerWebhook()).type,
                            'refused'
                        );
                        assert.equal(f.calls.length, 1);
                        checks++;
                        scope.destroy();
                        scope = f.scope();
                        assert.equal(
                            (await buttonProps(scope).triggerWebhook()).type,
                            'refused'
                        );
                        assert.equal(f.calls.length, 1);
                        assert.equal(
                            buttonProps(scope).acknowledgeNewIntent(),
                            true
                        );
                        assert.equal(f.calls.length, 1);
                        assert.equal(buttonProps(scope).canTrigger, true);
                        checks++;
                    } finally {
                        scope.destroy();
                        f.destroy();
                    }
                }
                for (const kind of [
                    'row',
                    'view',
                    'criteria',
                    'session',
                    'configuration',
                    'ownership',
                ]) {
                    const f = await fixture(api, { cell });
                    const scope = f.scope();
                    try {
                        const held = buttonProps(scope);
                        await f.replace(kind);
                        assert.equal(
                            (await held.triggerWebhook()).type,
                            'refused',
                            kind
                        );
                        assert.equal(held.prepareLink(), null);
                        assert.equal(f.calls.length, 0);
                        assert.equal(f.cellWrites.length, 0);
                        checks++;
                    } finally {
                        scope.destroy();
                        f.destroy();
                    }
                }
            }
        }
        for (const api of [esm, cjs]) {
            const f = await fixture(api, { multiple: true });
            let first = f.scope(),
                second = f.scope();
            try {
                const pending = fixtures.deferred();
                f.respond((input) =>
                    input.source.linkedRecordId === 'rec_one'
                        ? pending.promise
                        : Promise.resolve({ success: true })
                );
                const action = buttonProps(first).triggerWebhook();
                assert.equal(buttonProps(second).canTrigger, false);
                assert.equal(
                    (await buttonProps(second).triggerWebhook()).type,
                    'refused'
                );
                assert.equal(
                    (await buttonProps(second, 1).triggerWebhook()).type,
                    'reported-success'
                );
                assert.deepEqual(
                    f.calls.map((call) => call.source.linkedRecordId),
                    ['rec_one', 'rec_two']
                );
                assert.equal(buttonProps(first).cancel(), true);
                pending.reject(Error('Synthetic uncertain transport'));
                assert.equal((await action).type, 'uncertain');
                first.destroy();
                second.destroy();
                first = f.scope();
                second = f.scope();
                assert.equal(buttonProps(first).canTrigger, false);
                assert.equal(buttonProps(second, 1).canTrigger, true);
                assert.equal(buttonProps(first).acknowledgeNewIntent(), true);
                assert.equal(buttonProps(second).canTrigger, true);
                assert.equal(f.calls.length, 2);
                checks++;
            } finally {
                first.destroy();
                second.destroy();
                f.destroy();
            }
            {
                const f = await fixture(api);
                let scope = f.scope();
                try {
                    const pending = fixtures.deferred();
                    f.respond(() => pending.promise);
                    const held = buttonProps(scope),
                        action = held.triggerWebhook();
                    assert.equal(buttonProps(scope).cancel(), true);
                    scope.destroy();
                    scope = f.scope();
                    pending.resolve({ success: true });
                    assert.equal((await action).type, 'uncertain');
                    assert.equal(f.recovery.journal.unknown('A').length, 0);
                    assert.equal(buttonProps(scope).phase, 'idle');
                    assert.equal(buttonProps(scope).canTrigger, true);
                    assert.equal(f.calls.length, 1);
                    checks++;
                } finally {
                    scope.destroy();
                    f.destroy();
                }
            }
            for (const reentrant of [false, true]) {
                const f = await fixture(api);
                const subscribe = f.owner.subscribe.bind(f.owner);
                let active = 0,
                    armed = false,
                    configuration = 0;
                f.owner.subscribe = (listener) => {
                    const stop = subscribe(listener);
                    active++;
                    armed = true;
                    let stopped = false;
                    return () => {
                        if (!stopped) {
                            stopped = true;
                            active--;
                            stop();
                        }
                    };
                };
                const options = {
                    ...f.options,
                    recordId: 'rec_one',
                    fieldIds: ['fld_button'],
                    configurationRevision: () => {
                        if (armed && !reentrant)
                            throw Error('Armed configuration callback');
                        return armed && reentrant ? ++configuration : 0;
                    },
                };
                let host;
                try {
                    if (reentrant) {
                        host = api.ui.createPortalDetailRendererHost(options);
                        assert.equal(host.getSnapshot().status, 'retired');
                        host.dispose();
                    } else
                        assert.throws(
                            () =>
                                api.ui.createPortalDetailRendererHost(options),
                            /Armed configuration callback/
                        );
                    assert.equal(active, 0);
                    assert.equal(f.calls.length, 0);
                    checks++;
                } finally {
                    host?.dispose();
                    f.destroy();
                }
            }
        }
        for (const api of [esm, cjs]) {
            for (const mode of [
                'triggerWebhookPOST',
                '_parent',
                'omit-recovery',
            ]) {
                const f = await fixture(api, {
                    cell: true,
                    mode:
                        mode === 'omit-recovery' ? 'triggerWebhookPOST' : mode,
                });
                const cell = f.options.resolveCell({
                    recordId: 'rec_one',
                    fieldId: 'fld_button',
                    ownerRevision: f.owner.getSnapshot().revision,
                });
                const options = {
                    ...f.options,
                    cell,
                    recordId: 'rec_one',
                    fieldId: 'fld_button',
                };
                if (mode === 'omit-recovery') delete options.buttonRecovery;
                const host = api.ui.createPortalCellRendererHost(options);
                let scope;
                try {
                    const snapshot = host.getSnapshot();
                    assert.equal(snapshot.status, 'ready');
                    const props = snapshot.fields[0];
                    assert.equal(props.context, 'portal-cell');
                    assert.equal(f.calls.length, 0);
                    assert.equal(f.cellWrites.length, 0);
                    if (mode === 'omit-recovery') {
                        assert.equal(props.capability.type, 'readonly');
                        const scopeOptions = { ...f.options };
                        delete scopeOptions.buttonRecovery;
                        scope = api.ui.createPortalRenderScope(scopeOptions);
                        const scoped = scope
                            .getSnapshot()
                            .rows[0].cells[0].host.getSnapshot().fields[0];
                        assert.equal(scoped.capability.type, 'readonly');
                        assert.equal(f.calls.length, 0);
                    } else {
                        assert.equal(props.capability.type, 'button');
                        assert.equal(props.displayConfig.openLinkType, mode);
                        if (mode === '_parent') {
                            assert.deepEqual(
                                props.capability.button.prepareLink(),
                                {
                                    href: 'https://portal.example.test/action',
                                    target: '_parent',
                                    rel: 'noreferrer',
                                }
                            );
                            assert.equal(f.calls.length, 0);
                        } else {
                            assert.equal(
                                (await props.capability.button.triggerWebhook())
                                    .type,
                                'reported-success'
                            );
                            assert.equal(f.calls.length, 1);
                            assert.equal(
                                f.calls[0].source.linkedRecordId,
                                'rec_one'
                            );
                            assert.equal(
                                f.calls[0].source.parentLinkedRecordFieldId,
                                'fld_children'
                            );
                            assert.equal(f.cellWrites.length, 0);
                        }
                    }
                    checks++;
                } finally {
                    scope?.destroy();
                    host.dispose();
                    f.destroy();
                }
            }
        }
        console.log(
            `Installed Portal Button composition: ${checks} ESM/CJS/Grid/List/default-detail/cell checkpoints; synthetic DOM/transport only.`
        );
        return { checks };
    } finally {
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
        await window.happyDOM.close();
    }
}
