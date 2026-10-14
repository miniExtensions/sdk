import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    NumberField,
    CurrencyField,
    FieldRenderer,
    renderCurrencyField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import {
    createFormFieldRendererHost,
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

async function fixture(
    t: TestContext,
    config: FieldConfig<'currency'> = {},
    initial: number | null = null,
    missing = false,
    symbol = '$',
    precision = 2,
    includeDuration = false
) {
    const window = new Window();
    for (const key of ['AbortController', 'AbortSignal'] as const)
        Object.defineProperty(window, key, { value: globalThis[key] });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm.push('currency', 'number');
    if (!missing) loaded.payload.formRecord.data.currency = initial;
    loaded.payload.formRecord.data.number = 1.25;
    loaded.payload.fieldIdsToSchemas.currency = {
        fieldType: 'currency',
        airtableField: {
            id: 'currency',
            name: 'Amount',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'currency', options: { symbol, precision } },
        },
        miniExtConfig: config,
    };
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Count',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtConfig: {},
    };
    if (includeDuration) {
        loaded.payload.fieldIdsInForm.push('duration');
        loaded.payload.formRecord.data.duration = 90.125;
        loaded.payload.fieldIdsToSchemas.duration = {
            fieldType: 'duration',
            airtableField: {
                id: 'duration',
                name: 'Elapsed time',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'duration',
                    options: { durationFormat: 'h:mm:ss' },
                },
            },
            miniExtConfig: {},
        };
    }
    let requests = 0;
    const scope = {
        current: true,
        writable: true,
        visible: true,
        revision: 0,
    };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('No implicit requests');
            },
        }),
        getScope: () => ({ ownerId: 'currency-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('currency');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'currency',
        isCurrent: () => scope.current,
        configurationRevision: () => scope.revision,
    });
    t.after(async () => {
        await act(async () => root.unmount());
        host.dispose();
        owner.destroy();
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
        assert.equal(requests, 0);
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    return {
        window,
        container,
        binding,
        host,
        owner,
        scope,
        input,
        loaded,
        focus: async (focused: boolean) => {
            await act(async () =>
                input().dispatchEvent(
                    new window.FocusEvent(focused ? 'focusin' : 'focusout', {
                        bubbles: true,
                    })
                )
            );
        },
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'currency'
            )
                throw Error('Currency props expected');
            return snapshot.fields[0];
        },
        edit: async (value: string) => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(input(), value);
                input().dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
    };
}

it('retains raw precision, finite exponent edits and invalid drafts across StrictMode, binding and accepted slot remounts', async (t) => {
    const initial = 1234567.8912345;
    const f = await fixture(
        t,
        { numberSeparator: 'period-comma', showThousandsSeparator: true },
        initial
    );
    const scalar = f.binding.scalar!;
    const before = f.binding.getSnapshot().revision;
    await f.render(
        h(CurrencyField, { binding: f.binding, className: 'custom' })
    );
    assert.ok(f.container.querySelector('.custom'));
    assert.equal(f.input().type, 'text');
    assert.equal(f.input().inputMode, 'decimal');
    assert.equal(f.input().value, String(initial));
    assert.equal(f.binding.getSnapshot().revision, before);
    assert.equal(f.binding.getSnapshot().dirty, false);
    await f.edit('-');
    assert.equal(f.input().value, '-');
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderCurrencyField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, '-');
    await f.edit('1e');
    await f.render(null);
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().value, '1e');
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.binding.getSnapshot().revision, before);
    assert.equal(f.binding.scalar, scalar);
    assert.equal(scalar.getState().retired, false);
    for (const [text, value] of [
        ['-1234.56789123', -1234.56789123],
        ['1e3', 1000],
        ['-4.25e-7', -4.25e-7],
        ['+12.5', 12.5],
        ['0', 0],
        ['-0', -0],
    ] as const) {
        await f.edit(text);
        assert.equal(f.input().value, text);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    }
    await act(async () => f.binding.setValue(9876.54321987));
    assert.equal(f.input().value, '9876.54321987');
});

it('one mounted NumberField isolates currency and duration drafts, actions and borrowed model retirement', async (t) => {
    const initial = 1234.56789;
    const f = await fixture(t, {}, initial, false, 'CHF', 2, true);
    const duration = f.owner.field('duration');
    const currencyModel = f.binding.scalar!;
    const durationModel = duration.scalar!;
    const show = (binding: typeof duration) =>
        f.render(h(NumberField, { key: 'same-numeric-field', binding }));

    await show(f.binding);
    assert.ok(f.container.querySelector('.mx-sdk-currency-field'));
    assert.equal(f.container.querySelector('.mx-sdk-duration-field'), null);
    assert.equal(f.input().inputMode, 'decimal');
    assert.equal(
        f.container.querySelector('.mx-sdk-currency-symbol')!.textContent,
        'CHF'
    );
    await f.edit('1e');

    await show(duration);
    assert.ok(f.container.querySelector('.mx-sdk-duration-field'));
    assert.equal(f.container.querySelector('.mx-sdk-currency-field'), null);
    assert.equal(f.container.querySelector('.mx-sdk-currency-symbol'), null);
    assert.equal(f.input().inputMode, 'text');
    assert.equal(f.input().placeholder, 'h:mm:ss');
    await f.focus(true);
    await f.edit('1:');
    await f.focus(false);

    for (const [binding, draft, control] of [
        [f.binding, '1e', '.mx-sdk-currency-field'],
        [duration, '1:', '.mx-sdk-duration-field'],
        [f.binding, '1e', '.mx-sdk-currency-field'],
    ] as const) {
        await show(binding);
        assert.ok(f.container.querySelector(control));
        assert.equal(f.input().value, draft);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.equal(binding.getSnapshot().dirty, false);
    }
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(duration.getSnapshot().value, 90.125);
    assert.equal(f.binding.scalar, currencyModel);
    assert.equal(duration.scalar, durationModel);
    assert.equal(currencyModel.getState().retired, false);
    assert.equal(durationModel.getState().retired, false);

    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(duration.getSnapshot().value, 90.125);
    assert.equal(durationModel.getState().input, '1:');
    await f.edit('1e');
    await show(duration);
    assert.equal(f.input().value, '1:');
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(duration.getSnapshot().value, null);
    assert.equal(currencyModel.getState().input, '1e');

    await act(async () => durationModel.destroy());
    assert.equal(duration.getSnapshot().retired, false);
    assert.equal(f.container.innerHTML, '');
    assert.equal(durationModel.setInput('2:00'), false);
    assert.equal(duration.getSnapshot().value, null);
    await show(f.binding);
    assert.equal(f.input().value, '1e');
    assert.equal(
        f.container.querySelector('.mx-sdk-currency-symbol')!.textContent,
        'CHF'
    );
    assert.equal(currencyModel.getState().retired, false);
    await f.edit('1e2');
    assert.equal(f.binding.getSnapshot().value, 100);
    assert.equal(duration.getSnapshot().value, null);
});

it('does not parse grouped or localized numbers, nonfinite text or symbols, and focus never writes or rounds', async (t) => {
    const f = await fixture(
        t,
        { numberSeparator: 'space-comma', showThousandsSeparator: true },
        0.123456789
    );
    await f.render(h(CurrencyField, { binding: f.binding }));
    const revision = f.binding.getSnapshot().revision;
    f.binding.scalar!.setFocused = () => {
        throw Error('Currency has no focus model');
    };
    await f.focus(true);
    await f.focus(false);
    assert.equal(f.input().value, '0.123456789');
    for (const text of [
        '1,234.56',
        '1.234,56',
        '1 234,56',
        '$12',
        '12 USD',
        'NaN',
        'Infinity',
        '1e309',
        ' 12 ',
    ]) {
        await f.edit(text);
        assert.equal(f.input().value, text);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.equal(f.binding.getSnapshot().value, 0.123456789);
        assert.equal(f.binding.getSnapshot().revision, revision);
    }
    await f.focus(false);
    assert.equal(f.input().value, ' 12 ');
});

for (const initial of [null, undefined, 0] as const)
    it(`leaves initial ${initial === null ? 'null' : initial === undefined ? 'missing' : 'zero'} native data untouched and clears deliberately to null`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        const before = f.binding.getSnapshot();
        await f.render(
            h(CurrencyField, {
                binding: f.binding,
                clearLabel: 'Effacer le montant',
            })
        );
        await f.render(null);
        await f.render(
            h(CurrencyField, {
                binding: f.binding,
                clearLabel: 'Effacer le montant',
            })
        );
        assert.equal(f.binding.getSnapshot().value, before.value);
        assert.equal(before.value, initial);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(f.input().value, initial === 0 ? '0' : '');
        assert.equal(
            f.container.querySelector('button')!.disabled,
            initial !== 0
        );
        await f.edit('1e');
        assert.equal(f.container.querySelector('button')!.disabled, false);
        const button = f.container.querySelector('button')!;
        assert.equal(button.type, 'button');
        assert.equal(button.getAttribute('aria-label'), 'Effacer le montant');
        const press = new f.window.MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
        });
        await act(async () => button.dispatchEvent(press));
        assert.equal(press.defaultPrevented, true);
        await act(async () => button.click());
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.input().value, '');
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
        assert.equal(f.window.document.activeElement, f.input());
        await f.edit('1234.56789');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('provides unique labels, literal symbol and plain feedback associations, and contains Portal events', async (t) => {
    const f = await fixture(t, {
        title: 'Purchase',
        required: true,
        placeholderText: 'Enter amount',
    });
    let rows = 0,
        submits = 0;
    const row = () => rows++;
    const feedback = '<img src=x> Check the currency';
    const props = { ...f.props(), error: feedback };
    await f.render(
        h(
            'form',
            {
                onClick: row,
                onChange: row,
                onDoubleClick: row,
                onAuxClick: row,
                onPointerDown: row,
                onKeyDown: row,
                onKeyUp: row,
                onFocus: row,
                onBlur: row,
                onCompositionStart: row,
                onCompositionEnd: row,
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            renderCurrencyField(props, { className: 'custom more' }),
            renderCurrencyField(props)
        )
    );
    const ids = Array.from(f.container.querySelectorAll('[id]')).map(
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.container.querySelector('label')!.textContent, 'Purchase');
    assert.equal(f.input().placeholder, 'Enter amount');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const descriptions = f
        .input()
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => f.window.document.getElementById(id)!.textContent);
    assert.deepEqual(new Set(descriptions), new Set(['$', feedback]));
    assert.equal(f.container.querySelector('img'), null);
    assert.ok(f.container.querySelector('.mx-sdk-currency-field.custom.more'));
    await f.edit('1234.56789');
    await act(async () => {
        f.container.querySelector('label')!.click();
        for (const type of [
            'click',
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
            'focusin',
            'focusout',
            'compositionstart',
            'compositionend',
        ])
            f.input().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
        f.container.querySelector('button')!.click();
    });
    assert.equal(rows, 0);
    assert.equal(submits, 0);
});

it('renders accepted currency symbols literally outside the raw value and ignores precision and separator metadata', async (t) => {
    const symbol = '<img src=x> USD & cents';
    const initial = 1234.56789123;
    const f = await fixture(
        t,
        { showThousandsSeparator: true, numberSeparator: 'period-comma' },
        initial,
        false,
        symbol,
        0
    );
    await f.render(h(CurrencyField, { binding: f.binding }));
    assert.equal(f.input().value, String(initial));
    const adornment = f.container.querySelector('.mx-sdk-currency-symbol')!;
    assert.equal(adornment.tagName, 'SPAN');
    assert.equal(adornment.textContent, symbol);
    assert.equal(f.container.querySelector('img'), null);
    assert.ok(
        f
            .input()
            .getAttribute('aria-describedby')!
            .split(' ')
            .includes(adornment.id)
    );
    for (const precision of [0, 2, 8]) {
        for (const symbol of ['€', ' CHF ', '']) {
            await f.render(
                renderCurrencyField({
                    ...f.props(),
                    value: initial,
                    field: {
                        ...f.props().field,
                        config: {
                            type: 'currency',
                            options: { precision, symbol },
                        },
                    },
                    capability: { type: 'readonly' },
                })
            );
            assert.equal(f.input().value, String(initial));
            assert.equal(
                f.container.querySelector('.mx-sdk-currency-symbol')
                    ?.textContent ?? '',
                symbol
            );
            assert.equal(
                f.input().hasAttribute('aria-describedby'),
                symbol !== ''
            );
        }
    }
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('read-only slots preserve finite native values and missing data without fabricating an editing bridge', async (t) => {
    const f = await fixture(t);
    for (const context of [
        'form',
        'portal-cell',
        'portal-detail',
        'linked-detail',
    ] as const) {
        for (const value of [undefined, null, 0, -1234.56789, 1e-9]) {
            await f.render(
                renderCurrencyField({
                    ...f.props(),
                    context,
                    value,
                    capability: { type: 'readonly' },
                })
            );
            assert.equal(f.input().value, value == null ? '' : String(value));
            assert.equal(f.input().disabled, true);
            assert.equal(f.container.querySelector('button')!.disabled, true);
        }
    }
    for (const value of [NaN, Infinity, -Infinity, '12', { amount: 12 }]) {
        await f.render(
            renderCurrencyField({
                ...f.props(),
                value,
                capability: { type: 'readonly' },
            } as unknown as FieldRendererProps<'currency'>)
        );
        assert.equal(f.input().value, '');
        assert.equal(f.input().disabled, true);
    }
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('retained slot actions reject stale context and hidden or retired bindings remove controls', async (t) => {
    const f = await fixture(t, {}, 25.12345);
    await f.render(renderCurrencyField(f.props()));
    f.scope.revision++;
    await f.edit('90');
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.binding.getSnapshot().value, 25.12345);
    assert.equal(f.binding.getSnapshot().dirty, false);
    await f.render(h(CurrencyField, { binding: f.binding }));
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
});

it('incompatible and retired borrowed scalars do not expose currency binding controls', async (t) => {
    const f = await fixture(t, {}, 25.12345);
    const snapshot = f.binding.getSnapshot();
    const incompatible = {
        ...snapshot,
        scalar: {
            ...snapshot.scalar!,
            kind: 'duration' as const,
            focused: false,
            durationFormat: 'h:mm:ss' as const,
        },
    };
    const mismatched = {
        ...f.binding,
        getSnapshot: () => incompatible,
        subscribe: () => () => {},
    };
    await f.render(h(CurrencyField, { binding: mismatched }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(CurrencyField, { binding: f.binding }));
    await act(async () => f.binding.scalar!.destroy());
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().value, 25.12345);
});

it('NumberField and CurrencyField preserve non-currency numeric behavior and custom binding rendering', async (t) => {
    const f = await fixture(t);
    const binding = f.owner.field('number');
    for (const Component of [NumberField, CurrencyField]) {
        await f.render(h(Component, { binding }));
        assert.equal(f.input().value, '1.25');
        assert.equal(f.input().inputMode, 'decimal');
        assert.equal(
            f.container.querySelector('.mx-sdk-currency-symbol'),
            null
        );
        await f.edit('2.5');
        assert.equal(binding.getSnapshot().value, 2.5);
        await act(async () => binding.setValue(1.25));
        await f.render(
            h(Component, {
                binding,
                render: ({ snapshot, binding: accepted }) =>
                    h(
                        'output',
                        null,
                        `${snapshot.value}:${accepted === binding}`
                    ),
            })
        );
        assert.equal(f.container.textContent, '1.25:true');
    }
    await f.render(null);
    await f.render(h(CurrencyField, { binding: f.owner.field('fld_title') }));
    assert.equal(f.container.querySelector('input'), null);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses accepted synthetic Portal ${layout} hosts without implicit reads or saves`, async (t) => {
        const initial = 1250.123456;
        const f = await fixture(t, {}, initial, false, '€');
        const schema = f.loaded.payload.fieldIdsToSchemas.currency;
        const detail = {
            fieldId: 'currency',
            fieldName: 'Amount',
            titleOverride: '',
            isHidden: false,
            fieldIsInEditingChildForm: true,
            childFormField: null,
            miniExtConfig: schema.miniExtConfig,
        };
        const api = portalFixture(async () =>
            portalListPage({
                recordIds: ['record_1'],
                customViewDetailFields: { fld_children: [detail] },
                tableIdsToLinkedTableStates: {
                    table_children: {
                        airtableFields: [schema.airtableField],
                        recordIdsToAirtableRecords: {
                            record_1: {
                                id: 'record_1',
                                fields: { currency: initial },
                            },
                        },
                    },
                },
            })
        );
        const owner = createPortalListOwner({
            client: api.client,
            portal: portalPage({ disableInlineEdit: false, layout }),
            portalFieldId: 'fld_children',
            criteria: {
                selectedCustomViewId: 'view_example',
                searchTerm: '',
                searchParamsMap: {},
                sortFieldsByEndUser: null,
                filtersByEndUser: null,
                supportsEndUserSortCleanup: true,
                supportsEndUserFilterCleanup: true,
            },
            getScope: () => ({ ownerId: 'currency-portal', revision: 0 }),
        });
        await owner.readFirst(owner.getSnapshot().revision, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        let current = true;
        const cell = createPortalCellBinding({
            client: api.client,
            schema,
            value: initial,
            input: {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordId: 'record_1',
                recordFieldId: 'currency',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'currency-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'currency-portal',
                    parentFieldId: 'fld_children',
                    tableId: 'table_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        const options = {
            owner,
            client: api.client,
            recordId: 'record_1',
            isCurrent: () => current,
            configurationRevision: () => 0,
        };
        const host =
            layout === 'grid'
                ? createPortalCellRendererHost({
                      ...options,
                      cell,
                      fieldId: 'currency',
                  })
                : createPortalDetailRendererHost(options);
        t.after(() => {
            host.dispose();
            cell.destroy();
            owner.destroy();
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
        });
        const snapshot = host.getSnapshot();
        assert.equal(snapshot.status, 'ready');
        if (
            snapshot.status !== 'ready' ||
            snapshot.fields[0].physicalKind !== 'currency'
        )
            throw Error('Currency Portal props expected');
        const props = snapshot.fields[0];
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderCurrencyField },
                fallback: () => null,
            })
        );
        assert.equal(f.input().value, String(initial));
        assert.equal(
            f.container.querySelector('.mx-sdk-currency-symbol')!.textContent,
            '€'
        );
        assert.equal(f.input().disabled, layout === 'list');
        if (layout === 'grid') {
            assert.equal(props.capability.type, 'editable');
            await f.edit('-7.123456789');
            assert.equal(cell.binding.getSnapshot().value, -7.123456789);
            await f.edit('1e');
            await f.render(null);
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderCurrencyField },
                    fallback: () => null,
                })
            );
            assert.equal(f.input().value, '1e');
            assert.equal(cell.binding.getSnapshot().value, -7.123456789);
        } else {
            assert.equal(props.capability.type, 'readonly');
            await f.edit('900');
            assert.equal(cell.binding.getSnapshot().value, initial);
        }
        current = false;
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderCurrencyField },
                fallback: () => null,
            })
        );
        assert.equal(f.container.querySelector('input'), null);
        if (props.capability.type === 'editable') {
            assert.equal(props.capability.scalar!.setInput('90'), false);
        }
    });

it('masks either configuration surface, keeps hidden-title accessibility and preserves custom binding rendering', async (t) => {
    const f = await fixture(
        t,
        {
            maskPasswordOnLoginScreen: true,
            showTitle: false,
            title: 'Private currency',
        },
        3723.25
    );
    await f.render(h(CurrencyField, { binding: f.binding }));
    assert.equal(f.input().type, 'password');
    assert.equal(f.input().getAttribute('aria-label'), 'Private currency');
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(
        f.container.querySelector('button')!.getAttribute('aria-label'),
        'Clear Private currency'
    );
    for (const which of ['displayConfig', 'writeConfig'] as const)
        for (const mask of [
            { obscurePassword: true },
            { maskPasswordOnLoginScreen: true },
        ]) {
            await f.render(
                renderCurrencyField(
                    {
                        ...f.props(),
                        title: ' ',
                        displayConfig: { showTitle: false },
                        writeConfig: {},
                        [which]: { ...mask, showTitle: false },
                    },
                    { clearLabel: '' }
                )
            );
            assert.equal(f.input().type, 'password');
            assert.equal(f.input().getAttribute('aria-label'), 'Amount');
            assert.equal(
                f.container.querySelector('button')!.getAttribute('aria-label'),
                'Clear Amount'
            );
        }
    await f.render(
        h(CurrencyField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '3723.25:true');
});

it('honors both read-only configurations, pending, computed and permission refusal without raw writes', async (t) => {
    const f = await fixture(t, {}, 3723.25);
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
        {
            capability: {
                type: 'editable' as const,
                setValue: () => {
                    throw Error(
                        'Missing currency bridge must not call setValue'
                    );
                },
            },
        },
    ]) {
        await f.render(renderCurrencyField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('90');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.binding.getSnapshot().value, 3723.25);
    }
    await f.render(h(CurrencyField, { binding: f.binding }));
    await act(async () => {
        f.scope.writable = false;
        f.owner.refresh();
    });
    assert.equal(f.input().disabled, true);
    await f.edit('90');
    assert.equal(f.binding.getSnapshot().value, 3723.25);
});

it('preserves empty feedback and validation priority and rejects wrong-kind, noneditable and retired currency states', async (t) => {
    const f = await fixture(t, {}, 3723.25);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Duration bridge expected');
    const capability = props.capability;
    const scalar = capability.scalar!;
    const show = async (
        state: typeof scalar.state,
        override: Partial<FieldRendererProps<'currency'>> = {}
    ) =>
        f.render(
            renderCurrencyField({
                ...props,
                ...override,
                capability: { ...capability, scalar: { ...scalar, state } },
            })
        );
    const validation = [
        {
            fieldId: 'currency',
            fieldTitle: 'Amount',
            errorMessage: 'Configured validation',
        },
    ];
    await show(
        { ...scalar.state, valid: false, error: '' },
        { error: 'Do not replace empty model feedback', validation }
    );
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    await show(scalar.state, { error: '', validation });
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    await show(scalar.state, { validation });
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Configured validation'
    );
    for (const state of [
        { ...scalar.state, kind: 'checkbox' as const },
        { ...scalar.state, canEdit: false },
    ]) {
        await show(state);
        assert.equal(f.input().disabled, true);
        await f.edit('90');
        assert.equal(f.binding.getSnapshot().value, 3723.25);
    }
    await show({ ...scalar.state, retired: true });
    assert.equal(f.container.querySelector('input'), null);
});
