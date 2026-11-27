import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const urlReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    UrlField, TextField, renderUrlField, AirtableForm, AirtableGrid, AirtableList,
    type UrlFieldProps, type UrlFieldOptions, type TextFieldProps, type TextFieldOptions,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

const options: UrlFieldOptions = { className: 'url-consumer', clearLabel: 'Clear URL' };
const textOptions: TextFieldOptions = options;
export const renderers: FieldRendererSlots<ReactNode> = {
    renderUrlField: props => renderUrlField(props, options),
};
export function BoundUrl(props: UrlFieldProps) {
    const textProps: TextFieldProps = props;
    return <><UrlField {...props} {...options} /><TextField {...textProps} {...textOptions} /></>;
}
export function UrlOverride(props: UrlFieldProps) {
    return <UrlField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkUrlKinds(url: FieldRendererProps<'url'>, text: FieldRendererProps<'singleLineText'>) {
    renderUrlField(url);
    // @ts-expect-error A single-line text slot is not a URL slot.
    renderUrlField(text);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

export const urlModeTypedConsumer = String.raw`
import { createElement as urlElement } from 'react';
import { UrlField, type UrlFieldProps as BoundUrlProps, type ControlledUrlFieldProps, type ReadOnlyUrlFieldProps, type UrlEditOwner } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/url-field.css';
declare const urlOwner: UrlEditOwner;
declare const urlBinding: BoundUrlProps['binding'];
const controlledUrl: ControlledUrlFieldProps = {mode: 'controlled', value: null, onChange(value) { const text: string = value; void text; }, owner: urlOwner, enableInlineEdit: true};
const readOnlyUrl: ReadOnlyUrlFieldProps = {mode: 'readOnly', value: 'https://example.test', language: 'en', displayAsButton: true};
urlElement(UrlField, {binding: urlBinding});
urlElement(UrlField, controlledUrl);
urlElement(UrlField, readOnlyUrl);
// @ts-expect-error Binding and controlled writes cannot be combined.
urlElement(UrlField, {...controlledUrl, binding: urlBinding});
// @ts-expect-error Read-only presentation accepts no writer.
urlElement(UrlField, {...readOnlyUrl, onChange() {}});
// @ts-expect-error Deferred editing requires a current record owner.
urlElement(UrlField, {mode: 'controlled', enableInlineEdit: true, value: '', onChange() {}});
`;

/** Installed ESM/CJS APIs with synthetic drafts; no navigation, requests or Save. */
export async function checkUrlConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    let openCalls = 0;
    window.open = () => {
        openCalls++;
        return null;
    };
    window.fetch = () => {
        requests++;
        throw Error('No URL requests');
    };
    const initialLocation = window.location.href;
    const keys = [
        'window',
        'document',
        'navigator',
        'fetch',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    const middleClicks = [];
    try {
        const css = require.resolve('@miniextensions/sdk/react/text.css');
        assert.match(readFileSync(css, 'utf8'), /\.mx-sdk-text:focus-visible/);
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/url.css'),
            { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
        );
        const urlStyles = readFileSync(
            require.resolve('@miniextensions/sdk/react/url-field.css'),
            'utf8'
        );
        assert.match(urlStyles, /\.mx-sdk-url-overlay/);
        assert.doesNotMatch(urlStyles, /@tailwind|@apply/);
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(`@miniextensions/sdk/${name}`)
                    : import(
                          pathToFileURL(
                              join(
                                  consumerDirectory,
                                  `node_modules/@miniextensions/sdk/dist/esm/${name}/index.js`
                              )
                          )
                      );
            const [ui, forms, react] = await Promise.all(
                ['ui', 'forms', 'react'].map(load)
            );
            assert.equal(typeof react.renderUrlField, 'function');
            assert.equal(typeof react.UrlField, 'function');
            assert.equal(ui.renderUrlField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['url'];
            loaded.payload.formRecord.data.url = null;
            loaded.payload.fieldIdsToSchemas.url = {
                fieldType: 'url',
                airtableField: {
                    id: 'url',
                    name: 'URL',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: { type: 'url', options: null },
                },
                miniExtConfig: {
                    placeholderText: 'Paste a URL',
                    displayAsButton: true,
                    displayAsAttachments: true,
                    enableQRCodeScannerForFormField: true,
                    autoStartCamera: true,
                    autoSubmitFormAfterScan: true,
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No implicit Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'url-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            let revision = 0;
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'url',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('url');
                let writes = 0;
                const original = binding.setValue;
                binding.setValue = (value) => {
                    writes++;
                    return original(value);
                };
                const edit = async (value) =>
                    act(async () => {
                        Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            'value'
                        ).set.call(input(), value);
                        input().dispatchEvent(
                            new window.Event('input', { bubbles: true })
                        );
                    });
                const compose = async (type) =>
                    act(async () =>
                        input().dispatchEvent(
                            new window.CompositionEvent(type, { bubbles: true })
                        )
                    );
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderUrlField: react.renderUrlField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().type, 'text');
                assert.equal(input().value, '');
                assert.equal(input().placeholder, 'Paste a URL');
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(writes, 0);
                const literalValues = [
                    '  HTTPS://Example.TEST/A?Q=MiXeD  ',
                    'example.test/path',
                    '/relative/path?q=1',
                    '//example.test/path',
                    'not a URL',
                    'javascript:globalThis.__urlConsumerExecuted=true',
                    'data:text/html,<b>literal</b>',
                    'https://例え.test/にほんご',
                    'https://example.test/<img src=x>',
                ];
                for (const value of literalValues) {
                    await edit(value);
                    assert.equal(binding.getSnapshot().value, value);
                    assert.equal(input().value, value);
                    assert.equal(
                        container.querySelector(
                            '[href],[src],a,img,iframe,video,canvas'
                        ),
                        null
                    );
                }
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, literalValues.at(-1));
                assert.equal(writes, literalValues.length);
                checks++;

                assert.equal(container.querySelectorAll('button').length, 1);
                const clear = container.querySelector('button');
                assert.equal(clear.type, 'button');
                await act(async () => clear.click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(writes, literalValues.length + 1);
                await compose('compositionstart');
                await edit('https://例え.test/');
                assert.equal(binding.getSnapshot().value, null);
                await compose('compositionend');
                assert.equal(binding.getSnapshot().value, 'https://例え.test/');
                assert.equal(writes, literalValues.length + 2);
                await edit('https://例え.test/');
                assert.equal(writes, literalValues.length + 2);
                checks++;

                const props = host.getSnapshot().fields[0];
                await act(async () => root.render(react.renderUrlField(props)));
                revision++;
                await edit('https://stale.example.test');
                assert.equal(binding.getSnapshot().value, 'https://例え.test/');
                assert.equal(input().value, 'https://例え.test/');
                await act(async () =>
                    container.querySelector('button').click()
                );
                assert.equal(binding.getSnapshot().value, 'https://例え.test/');
                checks++;

                let directWrites = 0;
                const editable = {
                    type: 'editable',
                    setValue: () => {
                        directWrites++;
                        return { accepted: true };
                    },
                };
                for (const restrictions of [
                    { capability: { type: 'readonly' } },
                    { displayConfig: { readOnly: true } },
                    { writeConfig: { readOnly: true } },
                    { pending: true },
                    { computed: true },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderUrlField({
                                ...props,
                                capability: editable,
                                ...restrictions,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(
                        container.querySelector('button').disabled,
                        true
                    );
                    await edit('https://blocked.example.test');
                }
                await act(async () =>
                    root.render(
                        react.renderUrlField({
                            ...props,
                            capability: { type: 'readonly' },
                            displayConfig: { showTitle: false },
                            writeConfig: { maskPasswordOnLoginScreen: true },
                            error: '<b>URL rejected</b>',
                        })
                    )
                );
                assert.equal(input().type, 'password');
                assert.equal(input().getAttribute('aria-label'), 'URL');
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                const feedback = window.document.getElementById(
                    input().getAttribute('aria-describedby')
                );
                assert.equal(feedback.textContent, '<b>URL rejected</b>');
                assert.equal(container.querySelector('b,a,img'), null);
                assert.equal(directWrites, 0);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.UrlField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-text-field')
                );
                assert.equal(
                    container
                        .querySelector('button')
                        .getAttribute('aria-label'),
                    'Effacer'
                );
                await edit('  HTTPS://Still.Mixed.Example.TEST/Path  ');
                assert.equal(
                    binding.getSnapshot().value,
                    '  HTTPS://Still.Mixed.Example.TEST/Path  '
                );
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                const beforeOverride = writes;
                await act(async () =>
                    root.render(
                        h(react.UrlField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'span',
                                    { 'data-custom': true },
                                    String(snapshot.value)
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(
                    container.querySelector('[data-custom]').textContent,
                    'null'
                );
                assert.equal(writes, beforeOverride);
                checks++;

                // The accepted host has retired after configuration replacement.
                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                assert.equal(requests, 0);
                assert.equal(openCalls, 0);
                assert.equal(window.location.href, initialLocation);
                assert.equal(window.__urlConsumerExecuted, undefined);
                assert.equal(globalThis.__urlConsumerExecuted, undefined);
                checks++;

                const edits = [];
                const value = 'https://example.test/path';
                let submits = 0;
                const mountControlled = (key) =>
                    act(async () =>
                        root.render(
                            h(
                                'form',
                                {
                                    key,
                                    id: 'consumer-url-form',
                                    onSubmit(event) {
                                        event.preventDefault();
                                        submits++;
                                    },
                                },
                                h(
                                    'label',
                                    { htmlFor: 'consumer-url' },
                                    'Website'
                                ),
                                h(
                                    'p',
                                    { id: 'consumer-help' },
                                    'Use a site link'
                                ),
                                h(
                                    'p',
                                    { id: 'consumer-error' },
                                    'URL rejected'
                                ),
                                h(react.UrlField, {
                                    mode: 'controlled',
                                    id: 'consumer-url',
                                    form: 'consumer-url-form',
                                    describedBy: 'consumer-help consumer-error',
                                    invalid: true,
                                    value,
                                    onChange: (next) => edits.push(next),
                                })
                            )
                        )
                    );
                const overlay = () =>
                    container.querySelector('a[aria-hidden="true"]');
                const checkControlled = (textbox) => {
                    assert.equal(input(), textbox);
                    assert.equal(textbox.type, 'url');
                    assert.equal(textbox.form?.id, 'consumer-url-form');
                    assert.equal(textbox.labels?.[0]?.textContent, 'Website');
                    assert.equal(textbox.getAttribute('aria-invalid'), 'true');
                    const description =
                        textbox.getAttribute('aria-describedby');
                    assert.equal(description, 'consumer-help consumer-error');
                    assert.deepEqual(
                        description
                            .split(' ')
                            .map(
                                (id) =>
                                    window.document.getElementById(id)
                                        ?.textContent
                            ),
                        ['Use a site link', 'URL rejected']
                    );
                    assert.equal(textbox.value, value);
                    assert.deepEqual(edits, []);
                    assert.equal(writes, beforeOverride);
                    assert.equal(submits, 0);
                    assert.equal(openCalls, 0);
                    assert.equal(requests, 0);
                    assert.equal(window.location.href, initialLocation);
                };
                await mountControlled('auxiliary');
                const textbox = input();
                const resting = overlay();
                assert.equal(resting.getAttribute('href'), value);
                assert.equal(resting.tabIndex, -1);
                assert.notEqual(window.document.activeElement, textbox);
                const right = new window.MouseEvent('auxclick', {
                    button: 2,
                    bubbles: true,
                    cancelable: true,
                });
                await act(async () =>
                    assert.equal(resting.dispatchEvent(right), true)
                );
                assert.equal(right.defaultPrevented, false);
                assert.notEqual(window.document.activeElement, textbox);
                assert.equal(overlay(), resting);
                const middle = new window.MouseEvent('auxclick', {
                    button: 1,
                    bubbles: true,
                    cancelable: true,
                });
                assert.equal(middle.type, 'auxclick');
                assert.equal(middle.button, 1);
                assert.equal(middle.bubbles, true);
                assert.equal(middle.cancelable, true);
                let dispatched;
                await act(async () => {
                    dispatched = resting.dispatchEvent(middle);
                });
                middleClicks.push({
                    format,
                    dispatched,
                    defaultPrevented: middle.defaultPrevented,
                    focused: window.document.activeElement === textbox,
                });
                checkControlled(textbox);

                await mountControlled('primary');
                const primaryTextbox = input();
                assert.notEqual(primaryTextbox, textbox);
                assert.notEqual(window.document.activeElement, primaryTextbox);
                const click = new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                });
                await act(async () => overlay().dispatchEvent(click));
                assert.equal(click.defaultPrevented, true);
                assert.equal(window.document.activeElement, primaryTextbox);
                checkControlled(primaryTextbox);
                await edit('https://example.test/next');
                assert.deepEqual(edits, ['https://example.test/next']);
                checks++;

                const showUrl = async (resource) =>
                    act(async () =>
                        root.render(
                            h(react.UrlField, {
                                mode: 'readOnly',
                                value: resource,
                                language: 'en',
                                displayAsAttachments: true,
                                displayAsButton: true,
                                validButtonLabel: 'Open the website',
                            })
                        )
                    );
                await showUrl('https://example.invalid/report.pdf');
                assert.ok(
                    container.querySelector('ul[aria-label="Attachments"]')
                );
                assert.equal(
                    container.querySelector('.mx-sdk-created-time-url-button'),
                    null
                );
                await showUrl('mailto:example@example.test');
                assert.equal(
                    container.querySelector('a')?.getAttribute('href'),
                    'mailto:example@example.test'
                );
                assert.equal(
                    container.querySelector('a')?.textContent,
                    'Open the website'
                );
                await showUrl(null);
                assert.equal(container.querySelector('a[href]'), null);
                assert.equal(container.querySelector('button')?.disabled, true);
                assert.equal(input(), null);
                assert.equal(requests, 0);
                assert.equal(openCalls, 0);
                assert.equal(window.location.href, initialLocation);
                checks++;
            } finally {
                await act(async () => root.unmount());
                host.dispose();
                fields.destroy();
                container.remove();
            }
        }
        assert.deepEqual(
            middleClicks,
            ['esm', 'cjs'].map((format) => ({
                format,
                dispatched: false,
                defaultPrevented: true,
                focused: true,
            })),
            'Middle-click on the editable resting URL must focus the input without opening a tab'
        );
        return { checks };
    } finally {
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
