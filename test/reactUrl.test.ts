import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { UrlField, FieldRenderer, renderUrlField } from '../src/react/index.js';
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
    config: FieldConfig<'url'> = {},
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
    loaded.payload.fieldIdsInForm.push('url');
    if (!missing) loaded.payload.formRecord.data.url = initial;
    loaded.payload.fieldIdsToSchemas.url = {
        fieldType: 'url',
        airtableField: {
            id: 'url',
            name: 'Website',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'url', options: null },
        },
        miniExtConfig: config,
    };
    if (withPages) {
        loaded.payload.fieldIdsInForm = ['url', 'fld_title'];
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
        getScope: () => ({ ownerId: 'url-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('url');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'url',
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
                snapshot.fields[0].physicalKind !== 'url'
            )
                throw Error('URL props expected');
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

it('binding and Form slot preserve literal URL drafts without normalization, activation or native URL validation', async (t) => {
    const f = await fixture(t, {
        enforceUniqueness: true,
        enableQRCodeScannerForFormField: true,
        autoStartCamera: true,
        autoSubmitFormAfterScan: true,
    });
    await f.render(
        h(UrlField, { binding: f.binding, className: 'url-custom' })
    );
    assert.ok(f.container.querySelector('.url-custom'));
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
        'Example.TEST:8080/Path?q=A%20B#Fragment',
        'HTTP://Example.TEST/Path?Case=Kept',
        'mailto:Alice+News@Example.TEST?subject=Hello',
        'https://例え.テスト/道?名前=値',
        '  https://Example.TEST/path  ',
        'not a URL',
        '   ',
        'javascript:alert(1)',
        'data:text/html,<img src=x onerror=alert(1)>',
    ]) {
        await f.edit(value);
        assert.equal(f.input().value, value);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.input().validity.typeMismatch, false);
        assert.equal(
            f.container.querySelector('a,[href],img,video,iframe'),
            null
        );
        assert.equal(opens, 0);
    }
    const revision = f.binding.getSnapshot().revision;
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderUrlField },
            fallback: () => null,
        })
    );
    assert.equal(
        f.input().value,
        'data:text/html,<img src=x onerror=alert(1)>'
    );
    assert.equal(f.binding.getSnapshot().revision, revision);
    assert.equal(f.container.querySelector('img,a,video,iframe'), null);
    await act(async () => f.binding.setValue('External.TEST/Path?Case=Kept'));
    assert.equal(f.input().value, 'External.TEST/Path?Case=Kept');
    await f.render(
        h(UrlField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, 'External.TEST/Path?Case=Kept:true');
    assert.equal(opens, 0);
});

for (const initial of [null, undefined] as const)
    it(`preserves initial ${initial === null ? 'null' : 'absence'} and writes null only on deliberate clear`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        const revision = f.binding.getSnapshot().revision;
        await f.render(
            h(UrlField, { binding: f.binding, clearLabel: 'Clear address' })
        );
        await f.render(null);
        await f.render(
            h(UrlField, { binding: f.binding, clearLabel: 'Clear address' })
        );
        assert.equal(f.input().value, '');
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        await f.edit('Example.TEST/Path?Tag=New');
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.type, 'button');
        assert.equal(clear.getAttribute('aria-label'), 'Clear address');
        await act(async () => clear.click());
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.window.document.activeElement, f.input());
        await f.edit('not a URL');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('associates required and owner validation feedback while using shared hidden-title and masking policy', async (t) => {
    const f = await fixture(
        t,
        {
            title: 'Project URL',
            required: true,
            placeholderText: 'Enter address',
        },
        'https://Example.TEST/Project'
    );
    const feedback = '<img src=x> Address needs review';
    const props = { ...f.props(), error: feedback };
    await f.render(
        h('div', null, renderUrlField(props), renderUrlField(props))
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
            fieldId: 'url',
            fieldTitle: 'Project URL',
            errorMessage: 'Owner validation',
        },
    ];
    for (const error of ['', null]) {
        await f.render(renderUrlField({ ...f.props(), error, validation }));
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
    }
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderUrlField(
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
        assert.equal(f.input().getAttribute('aria-label'), 'Website');
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(
            f.container.querySelector('button')!.getAttribute('aria-label'),
            'Clear Website'
        );
    }
});

it('disabled and retained stale actions cannot write; hidden and retired bindings remove controls', async (t) => {
    const initial = 'Existing.TEST/Path?Tag=Kept';
    const f = await fixture(t, {}, initial);
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
    ]) {
        await f.render(renderUrlField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        await f.edit('Rejected.TEST/path');
        await act(async () => f.container.querySelector('button')!.click());
        assert.equal(f.binding.getSnapshot().value, initial);
    }
    await f.render(renderUrlField(f.props()));
    f.scope.revision++;
    await f.edit('Stale.TEST/path');
    assert.equal(f.input().value, initial);
    assert.equal(f.binding.getSnapshot().value, initial);
    await f.render(h(UrlField, { binding: f.binding }));
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
    const initial = 'Before.TEST/path';
    const f = await fixture(t, {}, initial);
    await f.render(h(UrlField, { binding: f.binding }));
    const revision = f.binding.getSnapshot().revision!;
    await f.composition('compositionstart');
    await f.edit('https://例え.テスト/道?タグ=値');
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.input().value, 'https://例え.テスト/道?タグ=値');
    await f.composition('compositionend', 'https://例え.テスト/道?タグ=値');
    assert.equal(
        f.binding.getSnapshot().value,
        'https://例え.テスト/道?タグ=値'
    );
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
    await f.edit('https://例え.テスト/道?タグ=値');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
    const props = f.props();
    await f.render(renderUrlField(props));
    await f.composition('compositionstart');
    await f.edit('unfinished');
    const replacement: FieldRendererProps<'url'> = {
        ...props,
        capability: {
            type: 'editable',
            setValue: () => {
                throw Error('Replacement must not inherit composition');
            },
        },
    };
    await f.render(renderUrlField(replacement));
    await f.composition('compositionend', 'Late.TEST/path');
    await f.edit('Late.TEST/path');
    assert.equal(
        f.binding.getSnapshot().value,
        'https://例え.テスト/道?タグ=値'
    );
    assert.equal(f.input().value, 'https://例え.テスト/道?タグ=値');
    assert.equal(f.binding.getSnapshot().revision, revision + 1);
});

it('the existing page owner blocks Next and Submit for invalid URL drafts without rewriting text or preparing a save', async (t) => {
    const f = await fixture(
        t,
        { required: true },
        'example.test/path',
        false,
        true
    );
    const pages = createFormPageOwner({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => pages.dispose());
    await f.render(h(UrlField, { binding: f.binding }));
    await f.edit('javascript:alert(1)');
    const beforeNext = f.owner.controller.getState().draftRevision;
    assert.equal(pages.getSnapshot().canNext, false);
    assert.deepEqual(pages.getSnapshot().problems, [
        { fieldId: 'url', code: 'invalid-url' },
    ]);
    assert.deepEqual(pages.next(pages.getSnapshot().revision), {
        accepted: false,
        reason: 'validation',
    });
    assert.equal(f.owner.controller.getState().draftRevision, beforeNext);
    assert.equal(f.input().value, 'javascript:alert(1)');
    assert.equal(f.binding.getSnapshot().value, 'javascript:alert(1)');

    await f.edit('Example.TEST/Path?q=A%20B');
    await act(async () => {
        assert.equal(pages.next(pages.getSnapshot().revision).accepted, true);
    });
    assert.equal(pages.getSnapshot().canSubmit, true);
    await f.edit(' https://Example.TEST/path ');
    const beforeSubmit = f.owner.controller.getState().draftRevision;
    assert.equal(pages.getSnapshot().canSubmit, false);
    assert.deepEqual(pages.getSnapshot().problems, [
        { fieldId: 'url', code: 'invalid-url' },
    ]);
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
    assert.equal(f.binding.getSnapshot().value, ' https://Example.TEST/path ');
    assert.equal(f.input().value, ' https://Example.TEST/path ');
    assert.equal(f.container.querySelector('a,[href]'), null);
});

it('page admission keeps the existing allowInvalidUrls and read-only exemptions without normalizing native data', async (t) => {
    const initial = 'legacy invalid URL';
    const f = await fixture(
        t,
        { allowInvalidUrls: true },
        initial,
        false,
        true
    );
    const allowedPages = createFormPageOwner({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => allowedPages.dispose());
    await f.render(h(UrlField, { binding: f.binding }));
    await f.edit('javascript:alert(1)');
    assert.deepEqual(allowedPages.getSnapshot().problems, []);
    await act(async () => {
        assert.equal(
            allowedPages.next(allowedPages.getSnapshot().revision).accepted,
            true
        );
    });
    assert.equal(allowedPages.getSnapshot().canSubmit, true);
    assert.equal(f.binding.getSnapshot().value, 'javascript:alert(1)');

    const loaded = structuredClone(f.loaded);
    loaded.payload.fieldIdsToSchemas.url!.miniExtConfig = { readOnly: true };
    const readonlyOwner = createFormFieldBindings({
        client: f.client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'readonly-url', revision: 0 }),
    });
    const readonlyPages = createFormPageOwner({
        fields: readonlyOwner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => {
        readonlyPages.dispose();
        readonlyOwner.destroy();
    });
    const readonlyBinding = readonlyOwner.field('url');
    await f.render(h(UrlField, { binding: readonlyBinding }));
    assert.equal(f.input().disabled, true);
    assert.equal(f.input().value, initial);
    assert.deepEqual(readonlyPages.getSnapshot().problems, []);
    await act(async () => {
        assert.equal(
            readonlyPages.next(readonlyPages.getSnapshot().revision).accepted,
            true
        );
    });
    assert.equal(readonlyPages.getSnapshot().canSubmit, true);
    assert.equal(readonlyBinding.getSnapshot().value, initial);
    assert.equal(readonlyBinding.getSnapshot().dirty, false);
});

for (const layout of ['grid', 'list'] as const)
    it(`uses accepted synthetic Portal ${layout} hosts without implicit reads or saves`, async (t) => {
        const initial = '  https://Example.TEST/Path?Case=Kept  ';
        const f = await fixture(t, {}, initial);
        const schema = f.loaded.payload.fieldIdsToSchemas.url;
        const detail = {
            fieldId: 'url',
            fieldName: 'Website',
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
                                fields: { url: initial },
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
            getScope: () => ({ ownerId: 'url-portal', revision: 0 }),
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
                recordFieldId: 'url',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'url-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'url-portal',
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
                      fieldId: 'url',
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
            snapshot.fields[0].physicalKind !== 'url'
        )
            throw Error('URL Portal props expected');
        const props = snapshot.fields[0];
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderUrlField },
                fallback: () => null,
            })
        );
        assert.equal(f.input().value, String(initial));
        assert.equal(f.input().disabled, layout === 'list');
        if (layout === 'grid') {
            assert.equal(props.capability.type, 'editable');
            await f.edit('  MiXeD.TEST/Path?Tag=Kept  ');
            assert.equal(
                cell.binding.getSnapshot().value,
                '  MiXeD.TEST/Path?Tag=Kept  '
            );
            await f.edit('not a URL');
            await f.render(null);
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderUrlField },
                    fallback: () => null,
                })
            );
            assert.equal(f.input().value, 'not a URL');
            assert.equal(cell.binding.getSnapshot().value, 'not a URL');
        } else {
            assert.equal(props.capability.type, 'readonly');
            await f.edit('900');
            assert.equal(cell.binding.getSnapshot().value, initial);
        }
        current = false;
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderUrlField },
                fallback: () => null,
            })
        );
        assert.equal(f.container.querySelector('input'), null);
        if (props.capability.type === 'editable') {
            assert.equal(
                props.capability.setValue('rejected.test/path').accepted,
                false
            );
        }
    });
