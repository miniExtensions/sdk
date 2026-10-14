import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    EmailField,
    FieldRenderer,
    renderEmailField,
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
    config: FieldConfig<'email'> = {},
    initial: string | null = null,
    missing = false
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
    loaded.payload.fieldIdsInForm.push('email');
    if (!missing) loaded.payload.formRecord.data.email = initial;
    loaded.payload.fieldIdsToSchemas.email = {
        fieldType: 'email',
        airtableField: {
            id: 'email',
            name: 'Contact email',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'email', options: null },
        },
        miniExtConfig: config,
    };
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
        getScope: () => ({ ownerId: 'email-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('email');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'email',
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
                snapshot.fields[0].physicalKind !== 'email'
            )
                throw Error('Email props expected');
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

it('binding and Form slot preserve exact email text, case, tags, whitespace and invalid-looking native drafts', async (t) => {
    const f = await fixture(t, {
        emailLetterCase: 'lowercase',
        enforceUniqueness: true,
        enableQRCodeScannerForFormField: true,
        autoStartCamera: true,
        autoSubmitFormAfterScan: true,
    });
    await f.render(
        h(EmailField, { binding: f.binding, className: 'email-custom' })
    );
    assert.ok(f.container.querySelector('.email-custom'));
    assert.equal(f.binding.scalar, null);
    assert.equal(f.binding.date, null);
    assert.equal(f.binding.selection, null);
    assert.equal(f.input().type, 'text');
    for (const value of [
        '  Alice+News@Example.TEST  ',
        'not an email',
        'Person@@Example.TEST',
        '   ',
        '<img src=x>+Tag@Example.TEST',
    ]) {
        await f.edit(value);
        assert.equal(f.input().value, value);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.input().validity.typeMismatch, false);
    }
    const revision = f.binding.getSnapshot().revision;
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderEmailField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, '<img src=x>+Tag@Example.TEST');
    assert.equal(f.binding.getSnapshot().revision, revision);
    assert.equal(f.container.querySelector('img,a,video,iframe'), null);
    await act(async () => f.binding.setValue('External+Tag@Example.TEST'));
    assert.equal(f.input().value, 'External+Tag@Example.TEST');
    await f.render(
        h(EmailField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, 'External+Tag@Example.TEST:true');
});

for (const initial of [null, undefined] as const)
    it(`preserves initial ${initial === null ? 'null' : 'absence'} and writes null only on deliberate clear`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        const revision = f.binding.getSnapshot().revision;
        await f.render(
            h(EmailField, { binding: f.binding, clearLabel: 'Clear address' })
        );
        await f.render(null);
        await f.render(
            h(EmailField, { binding: f.binding, clearLabel: 'Clear address' })
        );
        assert.equal(f.input().value, '');
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        await f.edit('User+Tag@Example.TEST');
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.type, 'button');
        assert.equal(clear.getAttribute('aria-label'), 'Clear address');
        await act(async () => clear.click());
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.window.document.activeElement, f.input());
        await f.edit('not an email');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('associates required and owner validation feedback while using shared hidden-title and masking policy', async (t) => {
    const f = await fixture(
        t,
        {
            title: 'Work email',
            required: true,
            placeholderText: 'Enter address',
        },
        'Person@Example.TEST'
    );
    const feedback = '<img src=x> Address needs review';
    const props = { ...f.props(), error: feedback };
    await f.render(
        h('div', null, renderEmailField(props), renderEmailField(props))
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.input().placeholder, 'Enter address');
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
            fieldId: 'email',
            fieldTitle: 'Work email',
            errorMessage: 'Owner validation',
        },
    ];
    for (const error of ['', null]) {
        await f.render(renderEmailField({ ...f.props(), error, validation }));
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
    }
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderEmailField(
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
        assert.equal(f.input().getAttribute('aria-label'), 'Contact email');
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(
            f.container.querySelector('button')!.getAttribute('aria-label'),
            'Clear Contact email'
        );
    }
});

it('disabled and retained stale actions cannot write; hidden and retired bindings remove controls', async (t) => {
    const initial = 'Existing+Tag@Example.TEST';
    const f = await fixture(t, {}, initial);
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
    ]) {
        await f.render(renderEmailField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        await f.edit('Rejected@Example.TEST');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.binding.getSnapshot().value, initial);
    }
    await f.render(renderEmailField(f.props()));
    f.scope.revision++;
    await f.edit('Stale@Example.TEST');
    assert.equal(f.input().value, initial);
    assert.equal(f.binding.getSnapshot().value, initial);
    await f.render(h(EmailField, { binding: f.binding }));
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
    const initial = 'Before@Example.TEST';
    const f = await fixture(t, {}, initial);
    await f.render(h(EmailField, { binding: f.binding }));
    const revision = f.binding.getSnapshot().revision!;
    await f.composition('compositionstart');
    await f.edit('ユーザー+タグ@Example.TEST');
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.input().value, 'ユーザー+タグ@Example.TEST');
    await f.composition('compositionend', 'ユーザー+タグ@Example.TEST');
    assert.equal(f.binding.getSnapshot().value, 'ユーザー+タグ@Example.TEST');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
    await f.edit('ユーザー+タグ@Example.TEST');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
    const props = f.props();
    await f.render(renderEmailField(props));
    await f.composition('compositionstart');
    await f.edit('unfinished');
    const replacement: FieldRendererProps<'email'> = {
        ...props,
        capability: {
            type: 'editable',
            setValue: () => {
                throw Error('Replacement must not inherit composition');
            },
        },
    };
    await f.render(renderEmailField(replacement));
    await f.composition('compositionend', 'Late@Example.TEST');
    await f.edit('Late@Example.TEST');
    assert.equal(f.binding.getSnapshot().value, 'ユーザー+タグ@Example.TEST');
    assert.equal(f.input().value, 'ユーザー+タグ@Example.TEST');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses accepted synthetic Portal ${layout} hosts without implicit reads or saves`, async (t) => {
        const initial = '  Alice+News@Example.TEST  ';
        const f = await fixture(t, {}, initial);
        const schema = f.loaded.payload.fieldIdsToSchemas.email;
        const detail = {
            fieldId: 'email',
            fieldName: 'Contact email',
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
                                fields: { email: initial },
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
            getScope: () => ({ ownerId: 'email-portal', revision: 0 }),
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
                recordFieldId: 'email',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'email-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'email-portal',
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
                      fieldId: 'email',
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
            snapshot.fields[0].physicalKind !== 'email'
        )
            throw Error('Email Portal props expected');
        const props = snapshot.fields[0];
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderEmailField },
                fallback: () => null,
            })
        );
        assert.equal(f.input().value, String(initial));
        assert.equal(f.input().disabled, layout === 'list');
        if (layout === 'grid') {
            assert.equal(props.capability.type, 'editable');
            await f.edit('  MiXeD+Tag@Example.TEST  ');
            assert.equal(
                cell.binding.getSnapshot().value,
                '  MiXeD+Tag@Example.TEST  '
            );
            await f.edit('not an email');
            await f.render(null);
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderEmailField },
                    fallback: () => null,
                })
            );
            assert.equal(f.input().value, 'not an email');
            assert.equal(cell.binding.getSnapshot().value, 'not an email');
        } else {
            assert.equal(props.capability.type, 'readonly');
            await f.edit('900');
            assert.equal(cell.binding.getSnapshot().value, initial);
        }
        current = false;
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderEmailField },
                fallback: () => null,
            })
        );
        assert.equal(f.container.querySelector('input'), null);
        if (props.capability.type === 'editable') {
            assert.equal(
                props.capability.setValue('rejected@example.test').accepted,
                false
            );
        }
    });
