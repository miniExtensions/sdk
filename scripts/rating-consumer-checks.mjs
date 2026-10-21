import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const ratingReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    RatingField, NumberField, renderRatingField, AirtableForm, AirtableGrid, AirtableList,
    type RatingFieldProps, type RatingFieldOptions, type NumberFieldProps, type NumberFieldOptions,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

const options: RatingFieldOptions = { className: 'rating-consumer' };
const numberOptions: NumberFieldOptions = options;
// @ts-expect-error Rating reuses Number options; it adds no Clear button.
const unsupported: RatingFieldOptions = { clearLabel: 'Clear rating' };
// @ts-expect-error Native range policy is not a renderer appearance option.
const unsupportedRange: RatingFieldOptions = { max: 5 };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderRatingField: props => renderRatingField(props, options),
};
export function BoundRating(props: RatingFieldProps) {
    const numberProps: NumberFieldProps = props;
    return <><RatingField {...props} {...options} /><NumberField {...numberProps} {...numberOptions} /></>;
}
export function RatingOverride(props: RatingFieldProps) {
    return <RatingField {...props} render={({ snapshot }) => <span>{snapshot.scalar?.input}</span>} />;
}
export function checkRatingKinds(rating: FieldRendererProps<'rating'>, number: FieldRendererProps<'number'>, currency: FieldRendererProps<'currency'>) {
    renderRatingField(rating);
    // @ts-expect-error A numeric slot is not the rating slot.
    renderRatingField(number);
    // @ts-expect-error Currency metadata does not authorize a rating slot.
    renderRatingField(currency);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed ESM/CJS APIs and real synthetic scalar owners; no live services. */
export async function checkRatingConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
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
    let requests = 0;
    try {
        const css = require.resolve('@miniextensions/sdk/react/number.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-number:focus-visible/
        );
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/rating.css'),
            { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
        );
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
            assert.equal(typeof react.RatingField, 'function');
            assert.equal(typeof react.renderRatingField, 'function');
            assert.equal(ui.renderRatingField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = [
                'rating',
                'number',
                'currency',
                'duration',
            ];
            for (const [kind, value, options] of [
                ['rating', 0.25, { max: 5, icon: 'heart', color: 'redBright' }],
                ['number', 12.5, { precision: 2 }],
                ['currency', 1234.56, { precision: 2, symbol: '$' }],
                ['duration', 60, { durationFormat: 'h:mm:ss' }],
            ]) {
                loaded.payload.formRecord.data[kind] = value;
                loaded.payload.fieldIdsToSchemas[kind] = {
                    fieldType: kind,
                    airtableField: {
                        id: kind,
                        name: kind === 'rating' ? 'Rating' : kind,
                        description: null,
                        isPrimaryField: false,
                        isComputed: false,
                        config: { type: kind, options },
                    },
                    miniExtConfig:
                        kind === 'rating'
                            ? {
                                  showTitle: true,
                              }
                            : {},
                };
            }
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No transport or implicit Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'rating-consumer', revision: 0 }),
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
                fieldId: 'rating',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const binding = fields.field('rating');
                const scalar = binding.scalar;
                const input = () => container.querySelector('input');
                const edit = (value) =>
                    act(async () => {
                        Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            'value'
                        ).set.call(input(), value);
                        input().dispatchEvent(
                            new window.Event('input', { bubbles: true })
                        );
                    });
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderRatingField: react.renderRatingField,
                            },
                            fallback: () => null,
                        })
                    );
                const initialRevision = scalar.getState().revision;
                await act(async () => root.render(tree()));
                assert.equal(scalar.getState().revision, initialRevision);
                assert.equal(input().value, '0.25');
                assert.equal(input().type, 'text');
                assert.equal(input().inputMode, 'decimal');
                assert.equal(input().getAttribute('min'), null);
                assert.equal(input().getAttribute('max'), null);
                assert.equal(input().getAttribute('step'), null);
                assert.equal(
                    container.querySelector(
                        'progress,[role=progressbar],[role=slider],[role=radiogroup],button,svg'
                    ),
                    null
                );
                assert.equal(container.textContent.includes('★'), false);
                assert.equal(container.textContent.includes('♥'), false);
                assert.equal(container.innerHTML.includes('redBright'), false);
                for (const [text, native] of [
                    ['-0.5', -0.5],
                    ['7.25', 7.25],
                    ['1e2', 100],
                    ['0.123456789', 0.123456789],
                    ['0.2500', 0.25],
                ]) {
                    await edit(text);
                    assert.equal(input().value, text);
                    assert.equal(binding.getSnapshot().value, native);
                }
                const blurRevision = scalar.getState().revision;
                await act(async () => input().focus());
                await act(async () => input().blur());
                assert.equal(input().value, '0.2500');
                assert.equal(scalar.getState().revision, blurRevision);
                checks++;

                await edit('1e');
                assert.equal(input().value, '1e');
                assert.equal(binding.getSnapshot().value, 0.25);
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                await act(async () => {
                    await assert.rejects(() => fields.save());
                });
                const partialRevision = scalar.getState().revision;
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '1e');
                assert.equal(binding.scalar, scalar);
                assert.equal(scalar.getState().revision, partialRevision);
                await edit('-');
                assert.equal(binding.getSnapshot().value, 0.25);
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                await edit('0');
                assert.equal(binding.getSnapshot().value, 0);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.RatingField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-number-field')
                );
                await edit('0.7654321');
                assert.equal(binding.getSnapshot().value, 0.7654321);
                await act(async () =>
                    root.render(h(react.NumberField, { binding }))
                );
                assert.ok(container.querySelector('.mx-sdk-number-field'));
                assert.equal(input().value, '0.7654321');
                assert.equal(container.querySelector('button,progress'), null);
                await act(async () =>
                    root.render(
                        h(react.RatingField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'output',
                                    null,
                                    `Custom rating ${snapshot.scalar.input}`
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(container.textContent, 'Custom rating 0.7654321');
                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding: fields.field('number'),
                        })
                    )
                );
                assert.ok(container.querySelector('.mx-sdk-number-field'));
                await edit('7.125');
                assert.equal(fields.field('number').getSnapshot().value, 7.125);
                assert.equal(binding.getSnapshot().value, 0.7654321);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding: fields.field('currency'),
                        })
                    )
                );
                assert.ok(container.querySelector('.mx-sdk-currency-field'));
                assert.ok(container.textContent.includes('$'));
                assert.equal(input().value, '1234.56');
                await edit('7.5');
                assert.equal(fields.field('currency').getSnapshot().value, 7.5);
                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding: fields.field('duration'),
                        })
                    )
                );
                assert.ok(container.querySelector('.mx-sdk-duration-field'));
                assert.equal(input().inputMode, 'text');
                await edit('1:02:03');
                assert.equal(
                    fields.field('duration').getSnapshot().value,
                    3723
                );
                assert.equal(binding.getSnapshot().value, 0.7654321);
                checks++;

                const emptyLoaded = portalRecipeFixtures.makeForm({
                    childExtensionInfo: { accessType: { type: 'create' } },
                });
                emptyLoaded.payload.hasParentExtension = false;
                emptyLoaded.payload.publicFields.state = {
                    ...emptyLoaded.payload.publicFields.state,
                    multiPageFormMode: 'multi-page',
                    promptUserBeforeSubmission: false,
                    enableFormComputeMode: false,
                    autoSubmitAfterPrefill: false,
                };
                emptyLoaded.payload.fieldIdsInForm = [
                    'ratingMissing',
                    'ratingZero',
                    'ratingNull',
                ];
                for (const [id, value] of [
                    ['ratingMissing', undefined],
                    ['ratingNull', null],
                    ['ratingZero', 0],
                ]) {
                    if (value === undefined)
                        delete emptyLoaded.payload.formRecord.data[id];
                    else emptyLoaded.payload.formRecord.data[id] = value;
                    emptyLoaded.payload.fieldIdsToSchemas[id] = {
                        fieldType: 'rating',
                        airtableField: {
                            id,
                            name: 'Rating',
                            description: null,
                            isPrimaryField: false,
                            isComputed: false,
                            config: {
                                type: 'rating',
                                options: {
                                    max: 5,
                                    icon: 'star',
                                    color: 'yellowBright',
                                },
                            },
                        },
                        miniExtConfig: {
                            required: id === 'ratingZero',
                            ...(id === 'ratingNull'
                                ? { headerSectionTitle: 'Second page' }
                                : {}),
                        },
                    };
                }
                const emptyFields = forms.createFormFieldBindings({
                    loaded: emptyLoaded,
                    client: {
                        getSession: () => ({}),
                        forms: {
                            save: async () => {
                                requests++;
                                throw Error(
                                    'Required-zero validation must prevent transport'
                                );
                            },
                        },
                    },
                    getScope: () => ({
                        ownerId: 'rating-empty-consumer',
                        revision: 0,
                    }),
                    saveOptions: {
                        captchaVal: null,
                        isComputeMode: false,
                        context: { type: 'direct-url' },
                        searchQuery: {},
                        conditionalLinkedRecordFieldIdsToFilteringValues: {},
                    },
                });
                const pages = forms.createFormPageOwner({
                    fields: emptyFields,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                try {
                    for (const [id, native, rendered] of [
                        ['ratingMissing', undefined, ''],
                        ['ratingNull', null, ''],
                        ['ratingZero', 0, '0'],
                    ]) {
                        let emptyBinding;
                        await act(async () => {
                            emptyBinding = emptyFields.field(id);
                        });
                        const before = emptyBinding.scalar.getState().revision;
                        await act(async () =>
                            root.render(
                                h(react.RatingField, { binding: emptyBinding })
                            )
                        );
                        assert.equal(input().value, rendered);
                        await act(async () => root.render(null));
                        await act(async () =>
                            root.render(
                                h(react.RatingField, { binding: emptyBinding })
                            )
                        );
                        assert.equal(input().value, rendered);
                        assert.equal(emptyBinding.getSnapshot().value, native);
                        assert.equal(
                            emptyBinding.scalar.getState().revision,
                            before
                        );
                    }
                    assert.equal(
                        emptyFields.field('ratingZero').scalar.getState().valid,
                        true
                    );
                    assert.equal(pages.getSnapshot().canNext, false);
                    assert.deepEqual(pages.getSnapshot().problems, [
                        { fieldId: 'ratingZero', code: 'required' },
                    ]);
                    await act(async () => {
                        assert.deepEqual(
                            pages.next(pages.getSnapshot().revision),
                            { accepted: false, reason: 'validation' }
                        );
                    });
                    await edit('1');
                    assert.equal(pages.getSnapshot().canNext, true);
                    await act(async () => {
                        assert.equal(
                            pages.next(pages.getSnapshot().revision).accepted,
                            true
                        );
                    });
                    assert.equal(pages.getSnapshot().canSubmit, true);
                    await edit('0');
                    assert.equal(pages.getSnapshot().canSubmit, false);
                    await act(async () => {
                        await assert.rejects(
                            () => pages.submit(pages.getSnapshot().revision),
                            (error) =>
                                error instanceof forms.FormPageError &&
                                error.reason === 'validation'
                        );
                    });
                    assert.equal(requests, 0);
                    assert.equal(
                        emptyFields.field('ratingZero').getSnapshot().value,
                        0
                    );
                    await edit('');
                    assert.equal(
                        emptyFields.field('ratingZero').getSnapshot().value,
                        null
                    );
                    assert.equal(pages.getSnapshot().canSubmit, false);
                    await edit('0');
                    assert.equal(
                        emptyFields.field('ratingZero').getSnapshot().value,
                        0
                    );
                    assert.deepEqual(pages.getSnapshot().problems, [
                        { fieldId: 'ratingZero', code: 'required' },
                    ]);
                } finally {
                    await act(async () => root.render(null));
                    pages.dispose();
                    emptyFields.destroy();
                }
                checks++;

                const props = host.getSnapshot().fields[0];
                for (const [title, expected] of [
                    ['', 'Rating'],
                    [' \t ', 'Rating'],
                    ['Custom rating', 'Custom rating'],
                ]) {
                    const hidden = {
                        ...props,
                        title,
                        displayConfig: { showTitle: false },
                        writeConfig: { showTitle: false },
                    };
                    for (const options of [{}, { iconInput: {} }]) {
                        await act(async () =>
                            root.render(
                                react.renderRatingField(hidden, options)
                            )
                        );
                        assert.equal(
                            input().getAttribute('aria-label'),
                            expected
                        );
                        assert.equal(
                            input().getAttribute('aria-labelledby'),
                            null
                        );
                        assert.equal(container.querySelector('label'), null);
                        assert.equal(
                            input().type,
                            options.iconInput ? 'range' : 'text'
                        );
                    }
                    checks++;
                }
                for (const capability of [
                    { type: 'readonly' },
                    {
                        type: 'editable',
                        setValue: () => {
                            throw Error('No raw numeric write fallback');
                        },
                    },
                    {
                        ...props.capability,
                        scalar: {
                            ...props.capability.scalar,
                            state: {
                                ...props.capability.scalar.state,
                                kind: 'duration',
                            },
                        },
                    },
                    {
                        ...props.capability,
                        scalar: {
                            ...props.capability.scalar,
                            state: {
                                ...props.capability.scalar.state,
                                canEdit: false,
                            },
                        },
                    },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderRatingField({ ...props, capability })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(input().value, '0.7654321');
                    await edit('5');
                    assert.equal(binding.getSnapshot().value, 0.7654321);
                }
                for (const restriction of [
                    { displayConfig: { readOnly: true } },
                    { writeConfig: { readOnly: true } },
                    { pending: true },
                    { computed: true },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderRatingField({
                                ...props,
                                ...restriction,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    await edit('5');
                    assert.equal(binding.getSnapshot().value, 0.7654321);
                }
                checks++;

                await act(async () =>
                    root.render(
                        react.renderRatingField({
                            ...props,
                            capability: { type: 'readonly' },
                            displayConfig: {
                                showTitle: false,
                            },
                            writeConfig: {
                                maskPasswordOnLoginScreen: true,
                                required: true,
                            },
                            error: '<b>Rating rejected</b>',
                        })
                    )
                );
                assert.equal(input().type, 'password');
                assert.equal(input().getAttribute('aria-label'), 'Rating');
                assert.equal(input().getAttribute('aria-required'), 'true');
                assert.equal(input().placeholder, '');
                assert.equal(container.querySelector('label,b'), null);
                const feedback = window.document.getElementById(
                    input().getAttribute('aria-describedby')
                );
                assert.equal(feedback.textContent, '<b>Rating rejected</b>');
                assert.equal(
                    container.textContent.includes('0.7654321'),
                    false
                );
                for (const value of [null, undefined, NaN, Infinity, '0.25']) {
                    await act(async () =>
                        root.render(
                            react.renderRatingField({
                                ...props,
                                value,
                                capability: { type: 'readonly' },
                                error: '',
                            })
                        )
                    );
                    assert.equal(input().value, '');
                    assert.equal(
                        container.querySelector('[role=status]').textContent,
                        ''
                    );
                }
                checks++;

                await act(async () =>
                    root.render(react.renderRatingField(props))
                );
                revision++;
                await edit('99');
                assert.equal(binding.getSnapshot().value, 0.7654321);
                assert.equal(input().value, '0.7654321');
                checks++;

                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                await act(async () =>
                    root.render(
                        react.renderRatingField({
                            ...props,
                            capability: {
                                ...props.capability,
                                scalar: {
                                    ...props.capability.scalar,
                                    state: {
                                        ...props.capability.scalar.state,
                                        retired: true,
                                    },
                                },
                            },
                        })
                    )
                );
                assert.equal(input(), null);
                await act(async () =>
                    root.render(h(react.RatingField, { binding }))
                );
                assert.equal(input().value, '0.7654321');
                const finalRevision = scalar.getState().revision;
                await act(async () => root.render(null));
                assert.equal(scalar.getState().revision, finalRevision);
                assert.equal(scalar.getState().retired, false);
                assert.equal(requests, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                host.dispose();
                fields.destroy();
                container.remove();
            }
        }
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
