import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    PhoneNumberField,
    FieldRenderer,
    renderPhoneNumberField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormPageOwner } from '../src/forms/pages.js';
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
    config: FieldConfig<'phoneNumber'> = {},
    initial: string | null = null,
    missing = false,
    withPages = false
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
    loaded.payload.fieldIdsInForm.push('phoneNumber');
    if (!missing) loaded.payload.formRecord.data.phoneNumber = initial;
    loaded.payload.fieldIdsToSchemas.phoneNumber = {
        fieldType: 'phoneNumber',
        airtableField: {
            id: 'phoneNumber',
            name: 'Contact phone',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'phoneNumber', options: null },
        },
        miniExtConfig: config,
    };
    if (withPages) {
        loaded.payload.fieldIdsInForm = ['phoneNumber', 'fld_title'];
        loaded.payload.fieldIdsToSchemas.fld_title!.miniExtConfig = {
            headerSectionTitle: 'Details',
        };
        loaded.payload.publicFields.state.multiPageFormMode = 'multi-page';
        loaded.payload.publicFields.state.promptUserBeforeSubmission = false;
        loaded.payload.publicFields.state.enableFormComputeMode = false;
        loaded.payload.publicFields.state.autoSubmitAfterPrefill = false;
    }
    let requests = 0;
    const scope = {
        current: true,
        writable: true,
        visible: true,
        revision: 0,
    };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            requests++;
            throw Error('No implicit requests');
        },
    });
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client,
        getScope: () => ({ ownerId: 'phone-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('phoneNumber');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'phoneNumber',
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
        client,
        composition: async (
            type: 'compositionstart' | 'compositionend',
            value?: string
        ) => {
            await act(async () => {
                if (value !== undefined)
                    Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        'value'
                    )!.set!.call(input(), value);
                input().dispatchEvent(
                    new window.CompositionEvent(type, { bubbles: true })
                );
            });
        },
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'phoneNumber'
            )
                throw Error('Phone props expected');
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

it('binding and Form slot preserve exact phone text while country and verification metadata stay inert', async (t) => {
    const f = await fixture(t, {
        enforceUniqueness: true,
        showCountryCodes: true,
        defaultCountryCode: 'GB',
        requirePhoneNumberVerificationToLogin: true,
        enableQRCodeScannerForLogin: true,
        allowSearchFromExistingValuesInLogin: true,
    });
    await f.render(
        h(PhoneNumberField, { binding: f.binding, className: 'phone-custom' })
    );
    assert.ok(f.container.querySelector('.phone-custom'));
    assert.equal(f.binding.scalar, null);
    assert.equal(f.binding.date, null);
    assert.equal(f.binding.selection, null);
    assert.equal(f.input().type, 'text');
    let opens = 0;
    f.window.open = () => {
        opens++;
        return null;
    };
    for (const value of [
        '+1 (202) 555-0100',
        '0044 020 7946 0958',
        '020-0000 ext. 42',
        '*#06#',
        '+1 202 555 0100,123;456',
        '１２３－４５６',
        '  +33 (0)1 23 45 67 89  ',
        'not a phone number',
        '   ',
        'tel:+12025550100;ext=42',
        '<img src=x> +0123',
    ]) {
        await f.edit(value);
        assert.equal(f.input().value, value);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.input().validity.typeMismatch, false);
        assert.equal(
            f.container.querySelector(
                'a,[href],img,video,iframe,select,[role=combobox]'
            ),
            null
        );
        assert.equal(opens, 0);
    }
    const revision = f.binding.getSnapshot().revision;
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderPhoneNumberField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, '<img src=x> +0123');
    assert.equal(f.binding.getSnapshot().revision, revision);
    assert.equal(f.container.querySelector('img,a,video,iframe'), null);
    await act(async () => f.binding.setValue('  001-020 ext. 7  '));
    assert.equal(f.input().value, '  001-020 ext. 7  ');
    await f.render(
        h(PhoneNumberField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '  001-020 ext. 7  :true');
    assert.equal(opens, 0);
});

for (const initial of [null, undefined] as const)
    it(`preserves initial ${initial === null ? 'null' : 'absence'} and writes null only on deliberate clear`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        const revision = f.binding.getSnapshot().revision;
        await f.render(
            h(PhoneNumberField, {
                binding: f.binding,
                clearLabel: 'Clear phone',
            })
        );
        await f.render(null);
        await f.render(
            h(PhoneNumberField, {
                binding: f.binding,
                clearLabel: 'Clear phone',
            })
        );
        assert.equal(f.input().value, '');
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        await f.edit('+001-020 ext. 42');
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.type, 'button');
        assert.equal(clear.getAttribute('aria-label'), 'Clear phone');
        await act(async () => clear.click());
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.window.document.activeElement, f.input());
        await f.edit('not a phone number');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('associates required and owner validation feedback while using shared hidden-title and masking policy', async (t) => {
    const f = await fixture(
        t,
        {
            title: 'Contact phone',
            required: true,
            placeholderText: 'Enter phone',
        },
        '+020 (000) 123-456 ext 7'
    );
    const feedback = '<img src=x> Phone needs review';
    const props = { ...f.props(), error: feedback };
    await f.render(
        h(
            'div',
            null,
            renderPhoneNumberField(props),
            renderPhoneNumberField(props)
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.input().placeholder, 'Enter phone');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(
        f.window.document.getElementById(
            f.input().getAttribute('aria-describedby')!
        )!.textContent,
        feedback
    );
    assert.equal(f.container.querySelector('img'), null);
    const validation = [
        {
            fieldId: 'phoneNumber',
            fieldTitle: 'Contact phone',
            errorMessage: 'Owner validation',
        },
    ];
    for (const error of ['', null]) {
        await f.render(
            renderPhoneNumberField({ ...f.props(), error, validation })
        );
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
    }
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderPhoneNumberField(
                {
                    ...f.props(),
                    title: ' ',
                    displayConfig: { showTitle: false },
                    writeConfig: {},
                    [which]: {
                        showTitle: false,
                        maskPasswordOnLoginScreen: true,
                    },
                },
                { clearLabel: '' }
            )
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().getAttribute('aria-label'), 'Contact phone');
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(
            f.container.querySelector('button')!.getAttribute('aria-label'),
            'Clear Contact phone'
        );
    }
});

it('disabled and retained stale actions cannot write; hidden and retired bindings remove controls', async (t) => {
    const initial = '001-020 ext. 42';
    const f = await fixture(t, {}, initial);
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
    ]) {
        await f.render(renderPhoneNumberField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        await f.edit('999 rejected');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.binding.getSnapshot().value, initial);
    }
    await f.render(renderPhoneNumberField(f.props()));
    f.scope.revision++;
    await f.edit('999 stale');
    assert.equal(f.input().value, initial);
    assert.equal(f.binding.getSnapshot().value, initial);
    await f.render(h(PhoneNumberField, { binding: f.binding }));
    await act(async () => {
        f.scope.writable = false;
        f.owner.refresh();
    });
    assert.equal(f.input().disabled, true);
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
});

it('shared composition buffering commits once and cancels on accepted action replacement', async (t) => {
    const initial = '001-020';
    const f = await fixture(t, {}, initial);
    await f.render(h(PhoneNumberField, { binding: f.binding }));
    const revision = f.binding.getSnapshot().revision!;
    await f.composition('compositionstart');
    await f.edit('１２３－４５６ 内線７');
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.input().value, '１２３－４５６ 内線７');
    await f.composition('compositionend', '１２３－４５６ 内線７');
    assert.equal(f.binding.getSnapshot().value, '１２３－４５６ 内線７');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
    await f.edit('１２３－４５６ 内線７');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
    const props = f.props();
    await f.render(renderPhoneNumberField(props));
    await f.composition('compositionstart');
    await f.edit('unfinished');
    const replacement: FieldRendererProps<'phoneNumber'> = {
        ...props,
        capability: {
            type: 'editable',
            setValue: () => {
                throw Error('Replacement must not inherit composition');
            },
        },
    };
    await f.render(renderPhoneNumberField(replacement));
    await f.composition('compositionend', '999 late');
    await f.edit('999 late');
    assert.equal(f.binding.getSnapshot().value, '１２３－４５６ 内線７');
    assert.equal(f.input().value, '１２３－４５６ 内線７');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
});

it('the page owner enforces required and configured conditions without introducing phone syntax policy', async (t) => {
    const f = await fixture(
        t,
        {
            required: true,
            fieldValidationConditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'phone-policy',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            idOrName: { type: 'id', id: 'fld_title' },
                            value: 'allowed',
                        },
                    },
                ],
            },
            customErrorMessageForFieldValidation: 'Contact policy not met',
        },
        null,
        false,
        true
    );
    const driver = f.owner.field('fld_title');
    const pages = createFormPageOwner({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => pages.dispose());
    await f.render(h(PhoneNumberField, { binding: f.binding }));
    await f.edit('   ');
    const beforeNext = f.owner.controller.getState().draftRevision;
    assert.deepEqual(pages.getSnapshot().problems, [
        { fieldId: 'phoneNumber', code: 'required' },
    ]);
    assert.deepEqual(pages.next(pages.getSnapshot().revision), {
        accepted: false,
        reason: 'validation',
    });
    assert.equal(f.binding.getSnapshot().value, '   ');
    assert.equal(f.owner.controller.getState().draftRevision, beforeNext);

    await f.edit('not a phone number');
    assert.deepEqual(pages.getSnapshot().problems, [
        { fieldId: 'phoneNumber', code: 'conditional-validation' },
    ]);
    await act(async () => driver.setValue('allowed'));
    assert.deepEqual(pages.getSnapshot().problems, []);
    await act(async () => {
        assert.equal(pages.next(pages.getSnapshot().revision).accepted, true);
    });
    assert.equal(pages.getSnapshot().canSubmit, true);
    assert.equal(f.binding.getSnapshot().value, 'not a phone number');
    await f.edit('tel:this is not a number');
    assert.equal(pages.getSnapshot().canSubmit, true);
    assert.equal(f.binding.getSnapshot().value, 'tel:this is not a number');

    await act(async () => driver.setValue('denied'));
    assert.equal(pages.getSnapshot().canSubmit, false);
    assert.deepEqual(pages.getSnapshot().problems, [
        { fieldId: 'phoneNumber', code: 'conditional-validation' },
    ]);
    const beforeSubmit = f.owner.controller.getState().draftRevision;
    let preparations = 0;
    await act(async () => {
        await assert.rejects(
            pages.submit(pages.getSnapshot().revision, {
                lifecycle: {
                    dispatch() {
                        preparations++;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
    });
    assert.equal(preparations, 0);
    assert.equal(f.owner.controller.getState().draftRevision, beforeSubmit);
    assert.equal(f.input().value, 'tel:this is not a number');
    assert.equal(
        f.container.querySelector('a,[href],select,[role=combobox]'),
        null
    );
});

for (const layout of ['grid', 'list'] as const)
    it(`uses accepted synthetic Portal ${layout} hosts without implicit reads or saves`, async (t) => {
        const initial = '  +001 (020) 123-456 ext. 7  ';
        const f = await fixture(t, {}, initial);
        const schema = f.loaded.payload.fieldIdsToSchemas.phoneNumber;
        const detail = {
            fieldId: 'phoneNumber',
            fieldName: 'Contact phone',
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
                                fields: { phoneNumber: initial },
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
            getScope: () => ({ ownerId: 'phone-portal', revision: 0 }),
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
                recordFieldId: 'phoneNumber',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'phone-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'phone-portal',
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
                      fieldId: 'phoneNumber',
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
            snapshot.fields[0].physicalKind !== 'phoneNumber'
        )
            throw Error('Phone Portal props expected');
        const props = snapshot.fields[0];
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderPhoneNumberField },
                fallback: () => null,
            })
        );
        assert.equal(f.input().value, String(initial));
        assert.equal(f.input().disabled, layout === 'list');
        if (layout === 'grid') {
            assert.equal(props.capability.type, 'editable');
            await f.edit('  0044 020 7946 0958,123;456  ');
            assert.equal(
                cell.binding.getSnapshot().value,
                '  0044 020 7946 0958,123;456  '
            );
            await f.edit('not a phone number');
            await f.render(null);
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderPhoneNumberField },
                    fallback: () => null,
                })
            );
            assert.equal(f.input().value, 'not a phone number');
            assert.equal(
                cell.binding.getSnapshot().value,
                'not a phone number'
            );
        } else {
            assert.equal(props.capability.type, 'readonly');
            await f.edit('900');
            assert.equal(cell.binding.getSnapshot().value, initial);
        }
        current = false;
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderPhoneNumberField },
                fallback: () => null,
            })
        );
        assert.equal(f.container.querySelector('input'), null);
        if (props.capability.type === 'editable') {
            assert.equal(
                props.capability.setValue('999 rejected').accepted,
                false
            );
        }
    });
