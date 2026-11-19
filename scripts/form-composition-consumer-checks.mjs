import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { rendererTypedConsumer } from './renderer-consumer-checks.mjs';

// Reuse the complete 33-kind native metadata/value/config correlation oracle.
export const formCompositionTypedConsumer = `
import { createElement, type ReactNode } from 'react';
import { AirtableForm, CompleteFormComposition, type CompleteFormCompositionProps, type FormCompositionItem } from '@miniextensions/sdk/react';
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
const complete: CompleteFormCompositionProps = {
    formId: 'consumer-form',
    items: [{kind: 'field', key: 'literal-field', node: createElement('input', {form: 'consumer-form'})}] satisfies readonly FormCompositionItem[],
    validation: {heading: 'Check the fields', diagnostics: []},
    primary: {kind: 'terminal', label: 'Save', mode: 'save', saving: false, canSubmit: true},
    onSubmit: event => { event.preventDefault(); },
};
createElement(CompleteFormComposition, complete);
// @ts-expect-error consumer must supply its layout
createElement(AirtableForm, {scope,renderers:slots});
// @ts-expect-error observed configuration revision is required
createFormRenderScope({fields:bindings,isCurrent:()=>true});
// @ts-expect-error scope is not a native value writer
scope.setValue({answer:'replacement'});
void [snapshot,retained,owns];
`;

function makeFixture(
    forms,
    configure = () => {},
    validationErrors = [
        {
            fieldId: 'a',
            fieldTitle: 'a',
            errorMessage: 'Synthetic validation',
        },
    ]
) {
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
                    formValidationErrors: validationErrors,
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

function characterizeHostPresentation(
    api,
    { formId, diagnostics, useCompleteComposition }
) {
    let submission;
    let submitCount = 0;
    let hostAdmitsSubmit = true;
    let navigationContainer;
    const navigationRef = (element) => {
        navigationContainer = element;
    };
    return {
        render(state, createElement) {
            const [prefix, ...grouped] = state.fields;
            const field = ({ fieldId, node }) =>
                createElement('div', { id: fieldId, key: fieldId }, node);
            const handleSubmit = (event) => {
                event.preventDefault();
                submitCount++;
                submission = state.actions.submit();
            };
            const group = {
                title: 'Grouped fields',
                isExpanded: false,
                allFieldsHidden: false,
                hasError: state.validationErrors.some(
                    ({ fieldId }) => fieldId === 'b'
                ),
            };
            const validation = {
                heading: 'Check these fields',
                diagnostics: state.validationErrors,
            };
            const terminal = {
                label: 'Save response',
                mode: 'save',
                saving: false,
                canSubmit: hostAdmitsSubmit && state.canSave,
            };
            if (useCompleteComposition) {
                const item = (entry) => ({
                    kind: 'field',
                    key: entry.fieldId,
                    node: field(entry),
                });
                return createElement(api.CompleteFormComposition, {
                    formId,
                    onSubmit: handleSubmit,
                    items: [
                        item(prefix),
                        {
                            kind: 'group',
                            key: grouped[0].fieldId,
                            group,
                            fields: grouped.map(item),
                        },
                    ],
                    validation,
                    primary: { kind: 'terminal', ...terminal },
                    bodyClassName: 'native-form-scroll',
                    fieldsClassName: 'native-form-fields',
                    footerClassName: 'native-form-footer',
                    footerDetailsClassName: 'native-form-footer-details',
                    afterFields: createElement(
                        'span',
                        { 'data-native-feedback': true },
                        'Host form notification'
                    ),
                    actionsClassName: 'native-form-actions',
                    slots: {
                        header: createElement(
                            'div',
                            { 'data-native-header': true },
                            'Host settings header'
                        ),
                        pageNavigation: createElement(
                            'div',
                            {
                                'data-native-navigation': true,
                                ref: navigationRef,
                            },
                            'Host page navigation'
                        ),
                        footerDescription: createElement(
                            'div',
                            { 'data-native-footer-description': true },
                            'Host settings footer'
                        ),
                    },
                });
            }
            return createElement(
                'section',
                null,
                createElement('form', {
                    id: formId,
                    noValidate: true,
                    onSubmit: handleSubmit,
                }),
                field(prefix),
                createElement(api.FormGroup, group, ...grouped.map(field)),
                createElement(api.FormValidationSummary, validation),
                createElement(api.FormSubmitButton, { ...terminal, formId })
            );
        },
        async verify({ act, container, fixture, rerender }) {
            const form = container.querySelector('form');
            const group = container.querySelector('.mx-sdk-form-group');
            const disclosure = group.querySelector('button[aria-expanded]');
            const terminal = container.querySelector('button[type=submit]');
            const prefixId = diagnostics[0].fieldId;
            const prefix = container.ownerDocument.getElementById(prefixId);
            assert.equal(form.id, formId);
            assert.equal(form.noValidate, true);
            assert.equal(container.querySelectorAll('form').length, 1);
            assert.equal(form.childElementCount, 0);
            const initialNavigationContainer = navigationContainer;
            if (useCompleteComposition) {
                assert.equal(
                    initialNavigationContainer,
                    container.querySelector('[data-native-navigation]')
                );
                assert.equal(
                    initialNavigationContainer.nextElementSibling,
                    form
                );
                assert.equal(
                    container.querySelector('[data-native-header]')
                        .nextElementSibling,
                    initialNavigationContainer
                );
                assert(
                    container.querySelector(
                        '.native-form-scroll .native-form-fields + [data-native-feedback]'
                    )
                );
                assert(form.closest('.native-form-scroll'));
                assert(
                    container.querySelector(
                        '.native-form-footer .native-form-footer-details [data-native-footer-description]'
                    )
                );
                assert(terminal.closest('.native-form-actions'));
            }
            assert.equal(terminal.form, form);
            assert.equal(terminal.getAttribute('aria-label'), 'Save response');
            assert.equal(terminal.disabled, false);
            assert.equal(prefix.nextElementSibling, group);
            assert.equal(prefix.textContent, 'A');
            assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
            assert.equal(container.ownerDocument.getElementById('b'), null);
            assert.equal(container.querySelector('[role=alert]'), null);

            await act(async () => disclosure.click());
            assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
            assert.equal(group.querySelector('[id=b]').textContent, 'B');
            await act(async () => disclosure.click());
            assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
            assert.equal(submitCount, 0);
            assert.equal(fixture.calls.length, 0);

            if (useCompleteComposition) {
                hostAdmitsSubmit = false;
                await act(async () => rerender());
                assert.equal(terminal.disabled, true);
                await act(async () => terminal.click());
                const submitEvent =
                    new container.ownerDocument.defaultView.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    });
                await act(async () => form.dispatchEvent(submitEvent));
                assert.equal(submitEvent.defaultPrevented, true);
                assert.equal(submitCount, 0);
                assert.equal(fixture.calls.length, 0);
                hostAdmitsSubmit = true;
                await act(async () => rerender());
                assert.equal(terminal.disabled, false);
            }
            await act(async () => {
                terminal.click();
                assert(submission);
                await submission;
            });
            assert.equal(submitCount, 1);
            assert.equal(fixture.calls.length, 1);
            assert.deepEqual(fixture.calls[0].formRecord.data, {
                [prefixId]: 'A',
                b: 'B',
                c: 'C',
                unrendered: { text: 'native' },
            });
            const links = Array.from(
                container.querySelectorAll('[role=alert] a')
            );
            assert.deepEqual(
                links.map((a) => [a.getAttribute('href'), a.textContent]),
                diagnostics.map(({ fieldId, fieldTitle }) => [
                    `#${fieldId}`,
                    fieldTitle,
                ])
            );
            assert.equal(
                container.ownerDocument.getElementById(prefixId),
                prefix
            );
            assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
            assert.equal(container.ownerDocument.getElementById('b'), null);
            assert.equal(navigationContainer, initialNavigationContainer);
        },
    };
}

function characterizeCompositionActions(api) {
    const formId = 'composition-action-form';
    const calls = [];
    let mode = 'next';
    let reviewOpen = false;
    let currentRevision = 0;
    let reviewedRevision;
    let onReviewConfirmation;
    return {
        render(_state, createElement) {
            const primary =
                mode === 'next'
                    ? {
                          kind: 'next',
                          label: 'Continue',
                          onClick: () => calls.push('duplicate click'),
                      }
                    : {
                          kind: 'terminal',
                          label: mode === 'review' ? 'Review' : 'Compute',
                          mode,
                          saving: false,
                          canSubmit: true,
                      };
            return createElement(api.CompleteFormComposition, {
                formId,
                items: [
                    {
                        kind: 'field',
                        key: 'answer',
                        node: createElement('input', {
                            form: formId,
                            'aria-label': 'Answer',
                        }),
                    },
                ],
                primary,
                back: { label: 'Previous', onClick: () => calls.push('back') },
                onSubmit(event) {
                    assert.equal(event.defaultPrevented, true);
                    calls.push(mode);
                    if (mode === 'review') {
                        reviewedRevision = currentRevision;
                        reviewOpen = true;
                    }
                },
                review: {
                    open: reviewOpen,
                    items: [],
                    title: 'Review answers',
                    editLabel: 'Edit',
                    confirmLabel: 'Confirm',
                    emptyLabel: 'Nothing to review',
                    dialogFrame: ({ children }) =>
                        createElement('div', { role: 'dialog' }, children),
                    onEdit: () => {
                        reviewOpen = false;
                        calls.push('edit');
                    },
                    onDismiss: () => calls.push('dismiss'),
                    onConfirm: () => {
                        if (reviewedRevision !== currentRevision) return;
                        onReviewConfirmation();
                    },
                },
            });
        },
        async verify({ act, container, fixture, rerender }) {
            onReviewConfirmation = () => calls.push('save');
            const form = container.querySelector('form');
            const input = container.querySelector('input');
            const back = container.querySelector('button[aria-label=Previous]');
            assert.equal(input.form, form);
            assert.equal(back.type, 'button');
            await act(async () => back.click());
            assert.deepEqual(calls, ['back']);
            const next = container.querySelector('button[aria-label=Continue]');
            assert.equal(next.form, form);
            assert.equal(next.type, 'submit');
            const cancelledSubmit =
                new container.ownerDocument.defaultView.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                });
            cancelledSubmit.preventDefault();
            await act(async () => form.dispatchEvent(cancelledSubmit));
            assert.deepEqual(calls, ['back']);
            await act(async () => next.click());
            assert.deepEqual(calls, ['back', 'next']);

            mode = 'compute';
            await act(async () => rerender());
            const compute = container.querySelector(
                'button[aria-label=Compute]'
            );
            assert.equal(compute.form, form);
            await act(async () => form.requestSubmit());
            assert.deepEqual(calls, ['back', 'next', 'compute']);

            mode = 'review';
            await act(async () => rerender());
            const review = container.querySelector('button[aria-label=Review]');
            await act(async () => review.click());
            await act(async () => rerender());
            const confirm = container.querySelector(
                '.mx-sdk-form-review-confirm'
            );
            assert.equal(confirm.type, 'button');
            assert.deepEqual(calls, ['back', 'next', 'compute', 'review']);
            currentRevision++;
            await act(async () => confirm.click());
            assert.deepEqual(calls, ['back', 'next', 'compute', 'review']);
            const edit = Array.from(
                container.querySelectorAll('[role=dialog] button')
            ).find((button) => button.textContent === 'Edit');
            await act(async () => edit.click());
            await act(async () => rerender());
            assert.equal(container.querySelector('[role=dialog]'), null);

            await act(async () => review.click());
            await act(async () => rerender());
            await act(async () =>
                container.querySelector('.mx-sdk-form-review-confirm').click()
            );
            assert.deepEqual(calls, [
                'back',
                'next',
                'compute',
                'review',
                'edit',
                'review',
                'save',
            ]);
            assert.equal(container.querySelector('form'), form);
            assert.equal(container.querySelector('input'), input);
            assert.equal(fixture.calls.length, 0);
        },
    };
}

async function checkMount(
    f,
    scope,
    api,
    require,
    retainedControls = false,
    hostPresentation
) {
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
                    if (hostPresentation)
                        return hostPresentation.render(s, createElement);
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
        if (hostPresentation) {
            await hostPresentation.verify({
                act,
                container,
                fixture: f,
                rerender: () => root.render(tree()),
            });
            assert.equal(fallbacks, 0);
            return;
        }
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
        const fixture = (fn, diagnostics) => {
            const f = makeFixture(forms, fn, diagnostics);
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
            for (const useCompleteComposition of [false, true]) {
                const prefixId = 'field[raw]:prefix';
                const diagnostics = [
                    {
                        fieldId: prefixId,
                        fieldTitle: 'Prefix field',
                        errorMessage: 'Provide a different answer',
                    },
                    {
                        fieldId: 'b',
                        fieldTitle: 'Grouped field',
                        errorMessage: 'A committed value is required',
                    },
                ];
                const f = fixture((p, schema) => {
                    p.payload.fieldIdsInForm = [prefixId, 'b', 'c'];
                    p.payload.fieldIdsToSchemas[prefixId] = schema(prefixId);
                    delete p.payload.fieldIdsToSchemas.a;
                    p.payload.formRecord.data[prefixId] =
                        p.payload.formRecord.data.a;
                    delete p.payload.formRecord.data.a;
                    p.payload.publicFields.state.multiPageFormMode = 'one-page';
                }, diagnostics);
                const s = scope(f);
                await checkMount(
                    f,
                    s,
                    react,
                    require,
                    false,
                    characterizeHostPresentation(react, {
                        formId: 'existing-native-submit',
                        diagnostics,
                        useCompleteComposition,
                    })
                );
                checks++;
            }
            {
                const f = fixture();
                const s = scope(f);
                await checkMount(
                    f,
                    s,
                    react,
                    require,
                    false,
                    characterizeCompositionActions(react)
                );
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
