import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    NumberField,
    RatingField,
    FieldRenderer,
    renderRatingField,
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
    config: FieldConfig<'rating'> = {},
    initial: number | null | undefined = undefined,
    multipage = false
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
    loaded.payload.fieldIdsInForm.push('rating', 'duration');
    if (initial !== undefined) loaded.payload.formRecord.data.rating = initial;
    loaded.payload.fieldIdsToSchemas.rating = {
        fieldType: 'rating',
        airtableField: {
            id: 'rating',
            name: 'Score',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'rating',
                options: { max: 5, icon: 'star', color: 'yellowBright' },
            },
        },
        miniExtConfig: config,
    };
    loaded.payload.formRecord.data.duration = 7;
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
    if (multipage) {
        loaded.payload.fieldIdsInForm = ['rating', 'duration'];
        loaded.payload.fieldIdsToSchemas.duration.miniExtConfig = {
            headerSectionTitle: 'Second page',
        };
        loaded.payload.publicFields.state.multiPageFormMode = 'multi-page';
        loaded.payload.publicFields.state.promptUserBeforeSubmission = false;
        loaded.payload.publicFields.state.enableFormComputeMode = false;
        loaded.payload.publicFields.state.autoSubmitAfterPrefill = false;
    }
    let requests = 0;
    const scope = { current: true, writable: true, visible: true, revision: 0 };
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
        getScope: () => ({ ownerId: 'rating-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('rating');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'rating',
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
        owner,
        binding,
        host,
        scope,
        input,
        loaded,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderRatingField },
                fallback: () => null,
            }),
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'rating'
            )
                throw Error('Rating props expected');
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

it('RatingField and NumberField keep native ratings and precision without scaling, suffixes or range limits', async (t) => {
    const f = await fixture(
        t,
        {
            title: 'Native score',
        },
        0.25
    );
    for (const Component of [RatingField, NumberField]) {
        await f.render(
            h(Component, { binding: f.binding, className: 'rating' })
        );
        assert.ok(f.container.querySelector('.mx-sdk-number-field.rating'));
        assert.equal(f.input().value, '0.25');
        assert.equal(f.input().type, 'text');
        assert.equal(f.input().inputMode, 'decimal');
        assert.equal(f.input().hasAttribute('min'), false);
        assert.equal(f.input().hasAttribute('max'), false);
        assert.equal(f.container.textContent, 'Native score');
        assert.equal(
            f.container.querySelector(
                'progress,[role=progressbar],[role=slider],svg,button'
            ),
            null
        );
        const revision = f.binding.getSnapshot().revision;
        await act(async () => {
            f.input().dispatchEvent(
                new f.window.FocusEvent('focusin', { bubbles: true })
            );
            f.input().dispatchEvent(
                new f.window.FocusEvent('focusout', { bubbles: true })
            );
        });
        assert.equal(f.binding.getSnapshot().revision, revision);
        for (const [input, value] of [
            ['0.25', 0.25],
            ['0.1234567890123', 0.1234567890123],
            ['-0.375', -0.375],
            ['5.75', 5.75],
            ['25', 25],
            ['2.5e-3', 0.0025],
        ] as const) {
            await f.edit(input);
            assert.equal(f.binding.getSnapshot().value, value);
            assert.equal(f.input().value, input);
            assert.equal(f.input().getAttribute('aria-invalid'), 'false');
        }
        await act(async () => f.binding.setValue(0.25));
    }
});

it('partial and invalid rating drafts remain owner-held through StrictMode, remount and refresh until an external replacement', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const model = f.binding.scalar!;
    const nativeRevision = f.binding.getSnapshot().revision;
    await f.render(h(RatingField, { binding: f.binding }));
    for (const draft of [
        '-',
        '1e',
        '5 stars',
        '0,25',
        'NaN',
        'Infinity',
        '1e400',
    ]) {
        await f.edit(draft);
        await act(async () => f.owner.refresh());
        await f.render(null);
        await f.render(f.tree());
        assert.equal(f.input().value, draft);
        assert.equal(f.binding.getSnapshot().value, 0.25);
        assert.equal(f.binding.getSnapshot().revision, nativeRevision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    }
    await act(async () => {
        await assert.rejects(() => f.owner.save());
    });
    assert.equal(f.binding.scalar, model);
    assert.equal(model.getState().retired, false);
    await act(async () => f.binding.setValue(0.8754321));
    assert.equal(f.input().value, '0.8754321');
    assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    await f.edit('-');
    await f.render(h(NumberField, { binding: f.binding }));
    assert.equal(f.input().value, '-');
    assert.equal(f.binding.getSnapshot().value, 0.8754321);
    await f.edit('0.5');
    assert.equal(f.binding.getSnapshot().value, 0.5);
});

for (const initial of [undefined, null, 0] as const)
    it(`preserves initial ${initial === undefined ? 'absence' : initial} until a deliberate empty edit`, async (t) => {
        const f = await fixture(t, {}, initial);
        const revision = f.binding.getSnapshot().revision;
        await f.render(h(RatingField, { binding: f.binding }));
        await f.render(null);
        await f.render(f.tree());
        assert.equal(f.input().value, initial === 0 ? '0' : '');
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.binding.getSnapshot().revision, revision);
        assert.equal(f.binding.getSnapshot().dirty, false);
        await f.edit('0');
        assert.equal(f.binding.getSnapshot().value, 0);
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.input().value, '');
    });

it('requires a matching editable scalar and leaves readonly native ratings unscaled in every host context', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const props = f.props();
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Expected numeric bridge');
    const cap = props.capability;
    const scalar = cap.scalar!;
    let rawWrites = 0;
    const variants: FieldRendererProps<'rating'>[] = [
        { ...props, pending: true },
        { ...props, computed: true },
        { ...props, displayConfig: { readOnly: true } },
        { ...props, writeConfig: { readOnly: true } },
        { ...props, capability: { type: 'readonly' } },
        {
            ...props,
            capability: {
                type: 'editable',
                setValue: () => {
                    rawWrites++;
                    return { accepted: true };
                },
            },
        },
        ...[
            { ...scalar.state, canEdit: false },
            { ...scalar.state, kind: 'checkbox' as const },
            {
                ...scalar.state,
                kind: 'duration' as const,
                focused: false,
                durationFormat: 'h:mm:ss' as const,
            },
        ].map((state) => ({
            ...props,
            capability: { ...cap, scalar: { ...scalar, state } },
        })),
    ];
    for (const variant of variants) {
        await f.render(renderRatingField(variant));
        assert.equal(f.input().disabled, true);
        await f.edit('99');
        assert.equal(f.input().value, '0.25');
        assert.equal(f.binding.getSnapshot().value, 0.25);
    }
    assert.equal(rawWrites, 0);
    for (const context of [
        'form',
        'portal-cell',
        'portal-detail',
        'linked-detail',
    ] as const)
        for (const value of [undefined, null, 0, 0.123456789, NaN, Infinity]) {
            await f.render(
                renderRatingField({
                    ...props,
                    context,
                    value,
                    capability: { type: 'readonly' },
                })
            );
            assert.equal(f.input().disabled, true);
            assert.equal(
                f.input().value,
                typeof value === 'number' && Number.isFinite(value)
                    ? String(value)
                    : ''
            );
        }
    await f.render(
        renderRatingField({
            ...props,
            capability: {
                ...cap,
                scalar: {
                    ...scalar,
                    state: { ...scalar.state, retired: true },
                },
            },
        })
    );
    assert.equal(f.container.querySelector('input'), null);
});

it('associates plain owner feedback and applies display or write masking, required and hidden-title policy', async (t) => {
    const f = await fixture(t, { title: 'Stored rating' }, 0.25);
    const props = f.props();
    const validation = [
        {
            fieldId: 'rating',
            fieldTitle: 'Stored rating',
            errorMessage: 'Owner validation',
        },
    ];
    await f.render(
        h(
            'div',
            null,
            renderRatingField({ ...props, error: '<b>Review rating</b>' }),
            renderRatingField({ ...props, error: '<b>Review rating</b>' })
        )
    );
    const inputs = f.container.querySelectorAll('input');
    assert.notEqual(inputs[0].id, inputs[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.input().placeholder, '');
    const feedback = f.window.document.getElementById(
        f.input().getAttribute('aria-describedby')!
    )!;
    assert.equal(feedback.textContent, '<b>Review rating</b>');
    assert.equal(feedback.querySelector('b'), null);
    for (const error of ['', null]) {
        await f.render(renderRatingField({ ...props, error, validation }));
        assert.equal(
            f.container.querySelector('[role=status]')!.textContent,
            error === '' ? '' : 'Owner validation'
        );
    }
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        await f.render(
            renderRatingField({
                ...props,
                title: ' ',
                displayConfig: { showTitle: false },
                writeConfig: {},
                [which]: {
                    showTitle: false,
                    maskPasswordOnLoginScreen: true,
                    required: true,
                },
            })
        );
        assert.equal(f.input().type, 'password');
        assert.equal(f.input().value, '0.25');
        assert.equal(f.input().getAttribute('aria-label'), 'Score');
        assert.equal(f.input().getAttribute('aria-required'), 'true');
        assert.equal(f.container.querySelector('label'), null);
    }
});

for (const [title, expected] of [
    ['', 'Score'],
    [' \t ', 'Score'],
    ['Custom score', 'Custom score'],
] as const) {
    it(`hidden icon rating title ${JSON.stringify(title)} matches the bound and numeric accessible label`, async (t) => {
        const f = await fixture(t, { title, showTitle: false }, 2);
        const revision = f.binding.getSnapshot().revision;
        await f.render(h(RatingField, { binding: f.binding, iconInput: {} }));
        assert.equal(f.input().type, 'range');
        assert.equal(f.input().getAttribute('aria-label'), expected);
        assert.equal(f.input().getAttribute('aria-labelledby'), null);
        assert.equal(f.container.querySelector('label'), null);
        const props = {
            ...f.props(),
            title,
            displayConfig: { showTitle: false },
            writeConfig: { showTitle: false },
        };
        await f.render(renderRatingField(props));
        assert.equal(f.input().getAttribute('aria-label'), expected);
        await f.render(renderRatingField(props, { iconInput: {} }));
        assert.equal(f.input().type, 'range');
        assert.equal(f.input().getAttribute('aria-label'), expected);
        assert.equal(f.input().getAttribute('aria-labelledby'), null);
        assert.equal(f.container.querySelector('label'), null);
        assert.equal(f.binding.getSnapshot().revision, revision);
        assert.equal(f.binding.getSnapshot().value, 2);
    });
}

it('retained rating actions respect configuration and permission changes, then hidden and retired owners remove controls', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const props = f.props();
    await f.render(renderRatingField(props));
    f.scope.revision++;
    await f.edit('0.75');
    assert.equal(f.input().value, '0.25');
    assert.equal(f.binding.getSnapshot().dirty, false);
    await f.render(h(RatingField, { binding: f.binding }));
    f.scope.writable = false;
    await f.edit('0.5');
    assert.equal(f.binding.getSnapshot().value, 0.25);
    await act(async () => f.owner.refresh());
    assert.equal(f.input().disabled, true);
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
    if (props.capability.type !== 'editable' || !props.capability.scalar)
        throw Error('Expected numeric bridge');
    assert.equal(props.capability.scalar.setInput('0.9'), false);
});

it('retired or wrong-kind borrowed models render nothing while custom rendering remains app-owned', async (t) => {
    const f = await fixture(t, {}, 0.25);
    const original = f.binding.getSnapshot();
    const wrongSnapshot = {
        ...original,
        scalar: { ...original.scalar!, kind: 'checkbox' as const },
    };
    const wrong = {
        ...f.binding,
        getSnapshot: () => wrongSnapshot,
        subscribe: () => () => {},
    };
    await f.render(h(RatingField, { binding: wrong }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(RatingField, { binding: f.owner.field('fld_title') }));
    assert.equal(f.container.querySelector('input'), null);
    await f.render(h(RatingField, { binding: f.binding }));
    await act(async () => f.binding.scalar!.destroy());
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.binding.getSnapshot().value, 0.25);
    assert.equal(f.binding.getSnapshot().retired, false);
    await f.render(
        h(RatingField, {
            binding: f.binding,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === f.binding}`),
        })
    );
    assert.equal(f.container.textContent, '0.25:true');
});

it('one mounted NumberField keeps rating and duration drafts and actions isolated', async (t) => {
    const f = await fixture(t, {}, 3.25);
    const duration = f.owner.field('duration');
    const ratingModel = f.binding.scalar!;
    const durationModel = duration.scalar!;
    const show = (binding: typeof duration) =>
        f.render(h(NumberField, { key: 'same-number-field', binding }));
    await show(f.binding);
    assert.ok(f.container.querySelector('.mx-sdk-number-field'));
    assert.equal(f.input().inputMode, 'decimal');
    assert.equal(f.container.querySelector('button'), null);
    await f.edit('1e');
    await show(duration);
    assert.ok(f.container.querySelector('.mx-sdk-duration-field'));
    assert.equal(f.input().inputMode, 'text');
    assert.equal(f.input().placeholder, 'h:mm:ss');
    await f.edit('1:');
    for (const [binding, input, inputMode] of [
        [f.binding, '1e', 'decimal'],
        [duration, '1:', 'text'],
        [f.binding, '1e', 'decimal'],
    ] as const) {
        await show(binding);
        assert.equal(f.input().value, input);
        assert.equal(f.input().inputMode, inputMode);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.equal(binding.getSnapshot().dirty, false);
    }
    assert.equal(f.binding.getSnapshot().value, 3.25);
    assert.equal(duration.getSnapshot().value, 7);
    assert.equal(f.binding.scalar, ratingModel);
    assert.equal(duration.scalar, durationModel);
    assert.equal(ratingModel.getState().retired, false);
    assert.equal(durationModel.getState().retired, false);
    await show(duration);
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(duration.getSnapshot().value, null);
    await show(f.binding);
    assert.equal(f.input().value, '1e');
    assert.equal(f.binding.getSnapshot().value, 3.25);
    await f.edit('-2.75');
    assert.equal(f.binding.getSnapshot().value, -2.75);
    assert.equal(duration.getSnapshot().value, null);
});

it('the page owner treats required rating zero as empty while the renderer preserves native zero and out-of-range values', async (t) => {
    const f = await fixture(t, { required: true }, 0, true);
    const pages = createFormPageOwner({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => pages.dispose());
    await f.render(f.tree());
    const nativeRevision = f.binding.getSnapshot().revision;
    assert.equal(f.input().value, '0');
    assert.equal(f.binding.scalar!.getState().valid, true);
    assert.equal(pages.getSnapshot().canNext, false);
    assert.deepEqual(pages.getSnapshot().problems, [
        { fieldId: 'rating', code: 'required' },
    ]);
    await act(async () => {
        assert.deepEqual(pages.next(pages.getSnapshot().revision), {
            accepted: false,
            reason: 'validation',
        });
    });
    assert.equal(f.binding.getSnapshot().value, 0);
    assert.equal(f.binding.getSnapshot().revision, nativeRevision);
    assert.equal(f.input().value, '0');
    for (const value of ['-0.25', '5.75', '2e2']) {
        await f.edit(value);
        assert.deepEqual(pages.getSnapshot().problems, []);
        assert.equal(pages.getSnapshot().canNext, true);
        assert.equal(f.input().value, value);
    }
    await act(async () => {
        assert.equal(pages.next(pages.getSnapshot().revision).accepted, true);
    });
    assert.equal(pages.getSnapshot().canSubmit, true);
    await f.edit('0');
    assert.equal(pages.getSnapshot().canSubmit, false);
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
            }),
            { name: 'FormPageError', reason: 'validation' }
        );
    });
    assert.equal(preparations, 0);
    assert.equal(f.owner.controller.getState().draftRevision, beforeSubmit);
    assert.equal(f.binding.getSnapshot().value, 0);
    assert.equal(f.input().value, '0');
});

for (const layout of ['grid', 'list'] as const)
    it(`renders Rating in an accepted synthetic Portal ${layout} host with no implicit mutation`, async (t) => {
        const initial = 3.25;
        const f = await fixture(t, {}, initial);
        const schema = f.loaded.payload.fieldIdsToSchemas.rating;
        const detail = {
            fieldId: 'rating',
            fieldName: 'Score',
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
                                fields: { rating: initial },
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
            getScope: () => ({ ownerId: 'rating-portal', revision: 0 }),
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
                recordFieldId: 'rating',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'rating-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'rating-portal',
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
                      fieldId: 'rating',
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
        if (
            snapshot.status !== 'ready' ||
            snapshot.fields[0].physicalKind !== 'rating'
        )
            throw Error('Rating Portal props expected');
        const props = snapshot.fields[0];
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderRatingField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.ok(f.container.querySelector('.mx-sdk-number-field'));
        assert.equal(f.input().value, '3.25');
        assert.equal(f.input().disabled, layout === 'list');
        if (layout === 'grid') {
            assert.equal(props.capability.type, 'editable');
            await f.edit('-2.75');
            assert.equal(cell.binding.getSnapshot().value, -2.75);
            await f.edit('1e');
            await f.render(null);
            await f.render(tree());
            assert.equal(f.input().value, '1e');
            assert.equal(f.input().getAttribute('aria-invalid'), 'true');
            assert.equal(cell.binding.getSnapshot().value, -2.75);
            await f.edit('9e1');
            assert.equal(cell.binding.getSnapshot().value, 90);
        } else {
            assert.equal(props.capability.type, 'readonly');
            await f.edit('900');
            assert.equal(cell.binding.getSnapshot().value, initial);
            assert.equal(f.input().value, '3.25');
        }
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('input'), null);
        if (props.capability.type === 'editable') {
            assert.equal(props.capability.scalar!.setInput('999'), false);
            assert.equal(props.capability.setValue(999).accepted, false);
        }
        assert.equal(cell.binding.getSnapshot().retired, true);
        assert.equal(cell.binding.getSnapshot().value, undefined);
    });
