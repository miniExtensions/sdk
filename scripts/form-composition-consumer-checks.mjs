import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { rendererTypedConsumer } from './renderer-consumer-checks.mjs';

// Reuse the complete 33-kind native metadata/value/config correlation oracle.
export const formCompositionTypedConsumer = `
import { createElement, type ReactNode } from 'react';
import { AirtableForm } from '@miniextensions/sdk/react';
import { createFormRenderScope, type FormRenderScope, type FormRenderSnapshot } from '@miniextensions/sdk/ui';
import type { FormFieldBindings, FormPageOwner } from '@miniextensions/sdk/forms';
${rendererTypedConsumer.replace('Required<FieldRendererSlots<string>>', 'Required<FieldRendererSlots<ReactNode>>').replace('const rendered: string =', 'const rendered: ReactNode =')}
declare const bindings: FormFieldBindings;
declare const pages: FormPageOwner;
const scope: FormRenderScope = createFormRenderScope({fields:bindings,pages,isCurrent:()=>true,configurationRevision:()=>0});
const snapshot: FormRenderSnapshot = scope.getSnapshot();
const retained: FormPageOwner = scope.pages;
const owns: boolean = scope.ownsPages;
createElement(AirtableForm, {scope,renderers:slots,children: state => {
 const revision:number=state.revision;
 const nodes:readonly {fieldId:string;node:ReactNode}[]=state.fields;
 // @ts-expect-error layout fields contain rendered nodes, not ownership handles
 state.fields[0].host;
 void [revision,nodes]; return createElement('form',null,...nodes.map(f=>f.node));
}});
// @ts-expect-error consumer must supply its layout
createElement(AirtableForm, {scope,renderers:slots});
// @ts-expect-error observed configuration revision is required
createFormRenderScope({fields:bindings,isCurrent:()=>true});
// @ts-expect-error scope is not a native value writer
scope.setValue({answer:'replacement'});
void [snapshot,retained,owns];
`;

function makeFixture(forms, configure = () => {}) {
    const loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.hasParentExtension = false;
    const schema = (id, type = 'singleLineText', miniExtConfig = {}) => ({
        fieldType: type,
        airtableField: {
            id,
            name: id,
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type,
                options:
                    type === 'multipleAttachments'
                        ? { isReversed: false }
                        : type === 'number'
                          ? { precision: 0 }
                          : null,
            },
        },
        miniExtConfig,
    });
    Object.assign(loaded.payload, {
        fieldIdsInForm: ['a', 'b', 'c'],
        fieldIdsToSchemas: {
            a: schema('a'),
            b: schema('b', 'singleLineText', { headerSectionTitle: 'Second' }),
            c: schema('c', 'singleLineText', { headerSectionTitle: 'Third' }),
        },
        formRecord: {
            type: 'create',
            data: { a: 'A', b: 'B', c: 'C', unrendered: { text: 'native' } },
        },
        formFieldIdsWithUnsavedChanges: ['unrendered'],
        urlPrefilledFieldIds: [],
        publicFields: {
            type: 'form',
            state: {
                multiPageFormMode: 'multi-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            },
        },
    });
    configure(loaded, schema);
    let config = 0,
        current = true,
        context = { ownerId: 'A', revision: 0 };
    const calls = [];
    const client = {
        getSession: () => ({}),
        forms: {
            save: async (input) => {
                calls.push(structuredClone(input));
                return {
                    type: 'error',
                    formValidationErrors: [
                        {
                            fieldId: 'a',
                            fieldTitle: 'a',
                            errorMessage: 'Synthetic validation',
                        },
                    ],
                    formErrors: {},
                };
            },
        },
        attachments: {
            uploadFile: async () => {
                throw Error('Unexpected upload');
            },
        },
    };
    const fields = forms.createFormFieldBindings({
        loaded,
        client,
        getScope: () => context,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: { kept: 'exact' },
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    return {
        loaded,
        fields,
        calls,
        options: {
            fields,
            isCurrent: () => current,
            configurationRevision: () => config,
        },
        setConfig: () => config++,
        retire: () => {
            current = false;
        },
        setContext: () => {
            context = { ownerId: 'B', revision: 1 };
        },
    };
}

async function checkMount(f, scope, api, require, retainedControls = false) {
    const { Window } = createRequire(import.meta.url)('happy-dom');
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
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
    const { createElement, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container),
        mounted = false,
        last,
        fallbacks = 0;
    let numeric, attachment, selected;
    const controls = {
        renderNumberField: (p) => {
            numeric = p.capability.scalar;
            return createElement(
                'output',
                { id: 'numeric' },
                numeric.state.input
            );
        },
        renderMultipleAttachmentsField: (p) => {
            attachment = p.capability.attachment;
            return createElement(
                'output',
                { id: 'files' },
                String(attachment.state.files.length)
            );
        },
    };
    const tree = () =>
        createElement(
            StrictMode,
            null,
            createElement(api.AirtableForm, {
                scope,
                renderers: {
                    ...controls,
                    renderSingleLineTextField: (p) =>
                        createElement(
                            'button',
                            {
                                type: 'button',
                                onClick: () =>
                                    p.capability.setValue('Retained answer'),
                            },
                            p.value
                        ),
                },
                fallback: () => {
                    fallbacks++;
                    return 'fallback';
                },
                children: (s) => {
                    last = s;
                    return createElement(
                        'section',
                        null,
                        ...s.fields.map((f) =>
                            createElement('div', { key: f.fieldId }, f.node)
                        )
                    );
                },
            })
        );
    try {
        await act(async () => root.render(tree()));
        mounted = true;
        assert.equal(f.calls.length, 0);
        if (retainedControls === 'hidden') {
            assert(!last.fields.some((f) => f.fieldId === 'a'));
            assert.equal(fallbacks, 0);
            assert.equal(f.calls.length, 0);
            return;
        }
        if (retainedControls) {
            selected = new window.File(['bytes'], 'pending.txt', {
                type: 'text/plain',
            });
            await act(async () => {
                assert.equal(numeric.setInput('-'), false);
                assert(attachment.select([selected]));
            });
            assert.equal(numeric.state.input, '-');
            assert.equal(numeric.state.valid, false);
            assert.equal(attachment.state.files[0], selected);
            await act(async () => root.unmount());
            mounted = false;
            root = createRoot(container);
            await act(async () => root.render(tree()));
            mounted = true;
            assert.equal(container.querySelector('#numeric').textContent, '-');
            assert.equal(container.querySelector('#files').textContent, '1');
            assert.equal(attachment.state.files[0], selected);
            assert.equal(f.fields.field('number').getSnapshot().value, 12);
            assert.equal(f.calls.length, 0);
            return;
        }
        assert.equal(container.querySelectorAll('button').length, 1);
        assert.equal(last.fields[0].fieldId, 'a');
        assert.equal('host' in last.fields[0], false);
        const renderedActions = last.actions;
        await act(async () => container.querySelector('button').click());
        assert.equal(
            f.fields.field('a').getSnapshot().value,
            'Retained answer'
        );
        assert.equal(renderedActions.next().accepted, false);
        await assert.rejects(renderedActions.submit());
        assert.equal(f.calls.length, 0);
        await act(async () => root.unmount());
        mounted = false;
        assert.equal(scope.getSnapshot().retired, false);
        root = createRoot(container);
        await act(async () => root.render(tree()));
        mounted = true;
        assert.equal(
            container.querySelector('button').textContent,
            'Retained answer'
        );
        assert.equal(f.fields.field('a').getSnapshot().dirty, true);
        await act(async () => scope.getSnapshot().actions.next());
        assert.equal(last.fields[0].fieldId, 'b');
        assert.equal(fallbacks, 0);
        assert.equal(f.calls.length, 0);
        await act(async () => last.actions.next());
        await act(async () => last.actions.submit());
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0].formRecord.data, {
            a: 'Retained answer',
            b: 'B',
            c: 'C',
            unrendered: { text: 'native' },
        });
        assert.deepEqual(f.calls[0].formFieldIdsWithUnsavedChanges, [
            'unrendered',
            'a',
        ]);
        await act(async () => scope.destroy());
        assert.equal(container.textContent, '');
    } finally {
        if (mounted) await act(async () => root.unmount());
        container.remove();
        await window.happyDOM.abort();
        keys.forEach((k, i) => {
            if (previous[i]) Object.defineProperty(globalThis, k, previous[i]);
            else delete globalThis[k];
        });
    }
}

/** Actual installed ESM/CJS entrypoints; all transport is synthetic. */
export async function checkFormCompositionConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const load = (entry) => import(pathToFileURL(join(esm, entry, 'index.js')));
    const esmApis = await Promise.all(['forms', 'ui', 'react'].map(load));
    let checks = 0;
    for (const [forms, ui, react] of [
        esmApis,
        [
            require('@miniextensions/sdk/forms'),
            require('@miniextensions/sdk/ui'),
            require('@miniextensions/sdk/react'),
        ],
    ]) {
        const fixtures = [],
            scopes = [],
            pages = [];
        const fixture = (fn) => {
            const f = makeFixture(forms, fn);
            fixtures.push(f);
            return f;
        };
        const scope = (f, extra = {}) => {
            const s = ui.createFormRenderScope({ ...f.options, ...extra });
            scopes.push(s);
            return s;
        };
        try {
            {
                const f = fixture(),
                    s = scope(f);
                assert.equal(s.ownsPages, true);
                assert.deepEqual(
                    s.getSnapshot().fields.map((x) => x.fieldId),
                    ['a']
                );
                s.getSnapshot();
                const stop = s.subscribe(() => {});
                stop();
                assert.equal(f.calls.length, 0);
                await checkMount(f, s, react, require);
                checks++;
            }
            {
                const f = fixture((p, schema) => {
                    p.payload.fieldIdsInForm = ['number', 'files'];
                    p.payload.fieldIdsToSchemas = {
                        number: schema('number', 'number'),
                        files: schema('files', 'multipleAttachments'),
                    };
                    p.payload.formRecord.data = { number: 12, files: [] };
                });
                const recovery = {
                    journal: new forms.RecoveryJournal(),
                    loadVersion: 1,
                    scope: {
                        owner: 'A',
                        parentFieldId: null,
                        tableId: null,
                        childExtensionId: f.loaded.extensionId,
                        context: 'direct-url',
                    },
                };
                const s = scope(f, { attachmentRecovery: recovery });
                await checkMount(f, s, react, require, true);
                checks++;
            }
            {
                const f = fixture(),
                    s = scope(f);
                f.fields.field('b').setValue('Native edit');
                assert(s.getSnapshot().actions.next().accepted);
                assert(s.getSnapshot().actions.next().accepted);
                await s.getSnapshot().actions.submit();
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.calls[0].formRecord.data, {
                    a: 'A',
                    b: 'Native edit',
                    c: 'C',
                    unrendered: { text: 'native' },
                });
                assert.deepEqual(f.calls[0].formFieldIdsWithUnsavedChanges, [
                    'unrendered',
                    'b',
                ]);
                assert.deepEqual(f.calls[0].searchQuery, { kept: 'exact' });
                assert.deepEqual(s.getSnapshot().validationErrors, [
                    {
                        fieldId: 'a',
                        fieldTitle: 'a',
                        errorMessage: 'Synthetic validation',
                    },
                ]);
                assert.equal(f.fields.field('b').getSnapshot().dirty, true);
                checks++;
            }
            for (const invalidate of ['edit', 'config', 'context', 'destroy']) {
                const f = fixture(),
                    s = scope(f);
                s.getSnapshot().actions.next();
                s.getSnapshot().actions.next();
                const old = s.getSnapshot().actions;
                if (invalidate === 'edit')
                    f.fields.field('a').setValue('After render');
                if (invalidate === 'config') f.setConfig();
                if (invalidate === 'context') f.setContext();
                if (invalidate === 'destroy') s.destroy();
                assert.equal(old.back().accepted, false);
                assert.equal(old.next().accepted, false);
                await assert.rejects(old.submit());
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture(),
                    p = forms.createFormPageOwner(f.options);
                pages.push(p);
                const s = scope(f, { pages: p });
                assert.equal(s.pages, p);
                assert.equal(s.ownsPages, false);
                s.destroy();
                assert.equal(p.getSnapshot().status, 'ready');
                assert(p.next(p.getSnapshot().revision).accepted);
                assert(
                    f.fields.field('a').setValue('Shared owner alive').accepted
                );
                const foreign = fixture();
                assert.throws(() =>
                    ui.createFormRenderScope({ ...foreign.options, pages: p })
                );
                checks++;
            }
            for (const borrowed of [false, true]) {
                const f = fixture();
                const stops = new Set();
                let live = 0,
                    armed = false,
                    p;
                // Arm only after the page owner's final field subscription exists.
                // This targets scope initialization without depending on read counts.
                const track = (target, arm = false) => {
                    const subscribe = target.subscribe;
                    target.subscribe = function (...args) {
                        const originalStop = subscribe.apply(this, args);
                        live++;
                        let active = true;
                        const stop = () => {
                            if (!active) return;
                            active = false;
                            live--;
                            stops.delete(stop);
                            originalStop();
                        };
                        stops.add(stop);
                        if (arm) armed = true;
                        return stop;
                    };
                };
                track(f.fields.controller);
                for (const id of ['a', 'b', 'c'])
                    track(f.fields.field(id), id === 'c');
                const failure = new Error('Scope initial configuration failed');
                try {
                    if (borrowed) p = forms.createFormPageOwner(f.options);
                    assert.throws(
                        () =>
                            ui.createFormRenderScope({
                                ...f.options,
                                ...(borrowed ? { pages: p } : {}),
                                configurationRevision: () => {
                                    if (armed) throw failure;
                                    return f.options.configurationRevision();
                                },
                            }),
                        (error) => error === failure
                    );
                    assert.equal(armed, true);
                    assert.equal(live, borrowed ? 4 : 0);
                    if (borrowed) {
                        assert.equal(p.getSnapshot().status, 'ready');
                        const s = scope(f, { pages: p });
                        assert.equal(s.pages, p);
                        assert(s.getSnapshot().actions.next().accepted);
                        s.destroy();
                        assert.equal(p.getSnapshot().status, 'ready');
                        assert.equal(live, 4);
                        p.dispose();
                        assert.equal(live, 0);
                    }
                    assert.equal(f.calls.length, 0);
                    checks++;
                } finally {
                    p?.dispose();
                    for (const stop of [...stops]) stop();
                }
            }
            {
                const f = fixture(),
                    s = scope(f);
                let armed = false;
                s.subscribe(() => {
                    if (armed) {
                        armed = false;
                        s.destroy();
                    }
                });
                const observed = [];
                s.subscribe((state) => observed.push(state.retired));
                armed = true;
                f.fields.field('a').setValue('Reentrant destroy');
                assert.equal(observed.at(-1), true);
                assert.equal(s.getSnapshot().retired, true);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture((p) => {
                        p.payload.publicFields.state.promptUserBeforeSubmission = true;
                    }),
                    s = scope(f);
                assert.equal(s.getSnapshot().canSave, false);
                await assert.rejects(s.getSnapshot().actions.submit());
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.a.miniExtConfig.conditionalFields =
                        {
                            logicalOperator: 'and',
                            conditions: [
                                {
                                    id: 'hide',
                                    type: 'singleCondition',
                                    setting: {
                                        type: 'is',
                                        fieldType: 'singleLineText',
                                        idOrName: { type: 'id', id: 'b' },
                                        value: 'show',
                                    },
                                },
                            ],
                        };
                });
                const s = scope(f);
                assert(!s.getSnapshot().fields.some((x) => x.fieldId === 'a'));
                await checkMount(f, s, react, require, 'hidden');
                assert.equal(f.calls.length, 0);
                checks++;
            }
        } finally {
            scopes.forEach((s) => s.destroy());
            pages.forEach((p) => p.dispose());
            fixtures.forEach((f) => f.fields.destroy());
        }
    }
    console.log(
        `Installed Form composition: ${checks} checks; ESM/CJS StrictMode remount and synthetic Save only.`
    );
    return checks;
}
