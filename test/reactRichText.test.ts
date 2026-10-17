import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    AirtableForm,
    AirtableGrid,
    AirtableList,
    FieldRenderer,
    NumberField,
} from '../src/react/index.js';
import {
    RichTextField,
    renderRichTextField,
} from '../src/react/RichTextField.js';
import {
    createFormFieldBindings,
    type FormFieldBinding,
    type FormFieldSnapshot,
} from '../src/forms/bindings.js';
import {
    createFormFieldRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import { createFormRenderScope } from '../src/ui/formRenderScope.js';
import { createPortalRenderScope } from '../src/ui/portalRenderScope.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const native =
    '  **Bold** _emphasis_\r\n雪 <b>literal</b>  \n\t[link](https://private.invalid)\n![image](https://private.invalid/image)';

async function fixture(
    t: TestContext,
    options: {
        value?: string | null;
        config?: FieldConfig<'richText'>;
        edit?: boolean;
    } = {}
) {
    const window = new Window();
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
    if (options.edit)
        loaded.payload.formRecord = {
            type: 'edit',
            tableId: 'table_projects',
            recordId: 'record_rich_text',
            data: loaded.payload.formRecord.data,
        };
    loaded.payload.fieldIdsInForm.push('richText', 'number');
    const value = Object.hasOwn(options, 'value') ? options.value : native;
    if (value !== undefined) loaded.payload.formRecord.data.richText = value;
    loaded.payload.fieldIdsToSchemas.richText = {
        fieldType: 'richText',
        airtableField: {
            id: 'richText',
            name: 'Supplied rich text',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'richText', options: null },
        },
        miniExtConfig: { hideFieldIfEmpty: false, ...options.config },
    };
    loaded.payload.fieldIdsToSchemas.number = {
        fieldType: 'number',
        airtableField: {
            id: 'number',
            name: 'Editable neighbor',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.number = 2;
    let requests = 0;
    const scope = { current: true, visible: true };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('Rich Text presentation must not perform I/O');
            },
        }),
        getScope: () => ({ ownerId: 'richText', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('richText');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'richText',
        isCurrent: () => scope.current,
        configurationRevision: () => 0,
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
    return {
        window,
        container,
        loaded,
        owner,
        binding,
        host,
        scope,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const state = host.getSnapshot();
            if (
                state.status !== 'ready' ||
                state.fields[0].physicalKind !== 'richText'
            )
                throw Error('Rich Text props expected');
            return state.fields[0];
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderRichTextField },
                fallback: () => null,
            }),
        output: () => {
            const output = container.querySelector('output');
            assert.ok(output);
            return output;
        },
    };
}

function snapshotBinding(initial: FormFieldSnapshot) {
    let snapshot = initial;
    const listeners = new Set<(state: FormFieldSnapshot) => void>();
    const binding: FormFieldBinding = {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setValue() {
            throw Error('Rich Text display cannot borrow a setter');
        },
        scalar: null,
        date: null,
        selection: null,
    };
    for (const name of [
        'setValue',
        'scalar',
        'date',
        'selection',
        'choiceCreation',
        'save',
    ])
        Object.defineProperty(binding, name, {
            get() {
                throw Error(`Rich Text display cannot read ${name}`);
            },
        });
    return {
        binding,
        listeners,
        update(next: FormFieldSnapshot) {
            snapshot = next;
            for (const listener of listeners) listener(snapshot);
        },
    };
}

function rowHandlers(onEvent: () => void) {
    return {
        onClick: onEvent,
        onDoubleClick: onEvent,
        onAuxClick: onEvent,
        onPointerDown: onEvent,
        onKeyDown: onEvent,
        onKeyUp: onEvent,
    };
}

async function dispatchRowEvents(f: Awaited<ReturnType<typeof fixture>>) {
    await act(async () => {
        for (const type of ['click', 'dblclick', 'auxclick', 'pointerdown']) {
            const event = new f.window.Event(type, {
                bubbles: true,
                cancelable: true,
            });
            f.output().dispatchEvent(event);
            assert.equal(event.defaultPrevented, false);
        }
        for (const type of ['keydown', 'keyup'])
            for (const key of ['Enter', ' ', 'ArrowDown', 'Tab']) {
                const event = new f.window.KeyboardEvent(type, {
                    key,
                    bubbles: true,
                    cancelable: true,
                });
                f.output().dispatchEvent(event);
                assert.equal(event.defaultPrevented, false);
            }
    });
}

function assertAccessibleOutput(f: Awaited<ReturnType<typeof fixture>>) {
    const output = f.output();
    const name =
        output.getAttribute('aria-label') ??
        f.container.querySelector(`label[for="${output.id}"]`)?.textContent;
    assert.equal(name, 'Supplied rich text');
    assert.equal(output.getAttribute('aria-busy'), 'false');
    assert.equal(output.getAttribute('aria-invalid'), 'false');
}

for (const [label, value] of [
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '  \n\t  '],
    ['leading zeroes', '0000000000123'],
    ['Markdown', '**Bold** _emphasis_ ~~strike~~ `code`'],
    ['lists and headings', '# Heading\n\n- item one\n  - item two\n> quote'],
    ['fenced code', '```html\n<img src="https://private.invalid">\n```'],
    [
        'link syntax',
        '[label](https://private.invalid) <https://private.invalid>',
    ],
    ['image syntax', '![alt](https://private.invalid/image "title")'],
    [
        'literal markup',
        '<img src="https://private.invalid" onerror="alert(1)"><script>alert(1)</script>',
    ],
    ['entity text', '&lt;b&gt; &amp; &#10;'],
    ['line endings', 'first\r\nsecond\rthird\nlast'],
    ['native whitespace and Unicode', native],
] as const)
    it(`presents Rich Text ${label} literally without native conversion or controls`, async (t) => {
        const f = await fixture(t, { value });
        const before = f.binding.getSnapshot();
        assert.equal(before.canEdit, true);
        assert.equal(f.props().capability.type, 'editable');
        assert.equal(f.props().physicalKind, 'richText');
        for (const node of [
            h(RichTextField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.output().textContent, value ?? '');
            assert.equal(
                f.container.querySelector(
                    'input,textarea,button,a,img,svg,canvas,video,audio,iframe,object,embed,script,link,style,b,strong,em,s,code,pre,h1,ul,li,blockquote,[contenteditable]'
                ),
                null
            );
            assert.equal(f.output().style.whiteSpace, 'pre-wrap');
            assert.equal(f.output().style.overflowWrap, 'anywhere');
            assert.equal(f.binding.getSnapshot().value, before.value);
            assert.equal(f.binding.getSnapshot().dirty, before.dirty);
            assert.equal(f.props().value, before.value);
            await f.render(null);
        }
    });

it('rejects malformed direct and bound values without coercion or owner changes', async (t) => {
    const f = await fixture(t);
    let coercions = 0;
    const poison = () => {
        coercions++;
        throw Error('Non-string values must not be coerced');
    };
    for (const value of [
        42,
        false,
        [],
        ['text'],
        {},
        { text: 'text' },
        { error: 'private' },
        new String('boxed text'),
        Symbol('private'),
        { toString: poison, valueOf: poison, [Symbol.toPrimitive]: poison },
        new Proxy({}, { get: poison, ownKeys: poison, getPrototypeOf: poison }),
    ]) {
        await f.render(
            renderRichTextField({
                ...f.props(),
                value,
            } as unknown as FieldRendererProps<'richText'>)
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
        await f.render(
            h(RichTextField, {
                binding: snapshotBinding({
                    ...f.binding.getSnapshot(),
                    value,
                } as FormFieldSnapshot).binding,
            })
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
        assert.equal(coercions, 0);
        await f.render(null);
    }
    assert.equal(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('masks before reading native values on either configuration surface', async (t) => {
    const f = await fixture(t);
    for (const surface of ['displayConfig', 'writeConfig'] as const)
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
            const props = f.props();
            const other =
                surface === 'displayConfig' ? 'writeConfig' : 'displayConfig';
            Object.assign(props, {
                [surface]: { [flag]: true },
                [other]: { [flag]: false },
            });
            let reads = 0;
            Object.defineProperty(props, 'value', {
                get() {
                    reads++;
                    throw Error('Masked native value must not be read');
                },
            });
            await f.render(renderRichTextField(props));
            assert.equal(reads, 0);
            assert.equal(f.output().textContent, '••••••••');
            assert(!f.container.innerHTML.includes('private.invalid'));
            assert.equal(f.output().getAttribute('aria-invalid'), 'false');
        }
    for (const value of [undefined, null, '', 'a', native]) {
        const props = { ...f.props(), value };
        Object.assign(props, { displayConfig: { obscurePassword: true } });
        await f.render(renderRichTextField(props));
        assert.equal(f.output().textContent, '••••••••');
    }
});

it('masks bound snapshots before reading their native values and resumes supplied text when unmasked', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
        const snapshot = structuredClone(initial);
        Object.assign(snapshot.field!.schema.miniExtConfig!, { [flag]: true });
        Object.defineProperty(snapshot, 'value', {
            get() {
                throw Error('Masked binding value must not be read');
            },
        });
        const pure = snapshotBinding(snapshot);
        await f.render(h(RichTextField, { binding: pure.binding }));
        assert.equal(f.output().textContent, '••••••••');
        await act(async () => pure.update(initial));
        assert.equal(f.output().textContent, native);
    }
});

it('ignores even editable capabilities and all borrowed action getters', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    assert.equal(props.capability.type, 'editable');
    for (const name of ['capability', 'linkedRecords', 'selectAvailability'])
        Object.defineProperty(props, name, {
            get() {
                throw Error(`Rich Text display cannot read ${name}`);
            },
        });
    await f.render(renderRichTextField(props, { className: 'rich-text-test' }));
    assert.equal(f.output().textContent, native);
    assert.ok(f.container.querySelector('.rich-text-test'));
    const pure = snapshotBinding(f.binding.getSnapshot());
    await f.render(h(RichTextField, { binding: pure.binding }));
    assert.equal(f.output().textContent, native);
    assert.deepEqual(f.binding.getSnapshot().value, native);
});

it('omits hidden, blocked and retired bindings before inspecting native values', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    for (const snapshot of [
        {
            ...initial,
            visibility: { type: 'hidden' as const, diagnostics: [] },
        },
        {
            ...initial,
            visibility: {
                type: 'blocked' as const,
                code: 'invalid-native-value' as const,
                diagnostics: [],
            },
        },
        { ...initial, retired: true },
    ]) {
        for (const property of ['field', 'value'])
            Object.defineProperty(snapshot, property, {
                get() {
                    throw Error(`Invisible ${property} must not be inspected`);
                },
            });
        await f.render(
            h(RichTextField, { binding: snapshotBinding(snapshot).binding })
        );
        assert.equal(f.container.textContent, '');
    }
    await f.render(f.tree());
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('output'), null);
    await act(async () => f.owner.destroy());
    await f.render(h(RichTextField, { binding: f.binding }));
    assert.equal(f.container.querySelector('output'), null);
});

it('keeps custom rendering first and refuses the wrong physical field kind', async (t) => {
    const f = await fixture(t);
    await f.render(h(RichTextField, { binding: f.owner.field('number') }));
    assert.match(f.container.textContent!, /supports Rich Text/);
    const initial = f.binding.getSnapshot();
    const retired = snapshotBinding({ ...initial, retired: true });
    await f.render(
        h(RichTextField, {
            binding: retired.binding,
            render: ({ snapshot, binding }) =>
                h(
                    'b',
                    null,
                    `${snapshot.retired}:${binding === retired.binding}`
                ),
        })
    );
    assert.equal(f.container.textContent, 'true:true');
    const wrongMetadata = structuredClone(initial);
    Object.assign(wrongMetadata.field!.schema.airtableField, {
        config: { type: 'singleLineText', options: null },
    });
    await f.render(
        h(RichTextField, { binding: snapshotBinding(wrongMetadata).binding })
    );
    assert.match(f.container.textContent!, /supports Rich Text/);
    assert.equal(f.container.querySelector('output'), null);
});

it('tracks accepted updates, replacement, StrictMode remount and retirement without stale subscriptions', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    const first = snapshotBinding(initial);
    const replacement = '**replacement**\r\n  text';
    const second = snapshotBinding({ ...initial, value: replacement });
    await f.render(h(RichTextField, { binding: first.binding }));
    assert.equal(first.listeners.size, 1);
    await act(async () =>
        first.update({ ...initial, value: '# accepted\n  update' })
    );
    assert.equal(f.output().textContent, '# accepted\n  update');
    await f.render(h(RichTextField, { binding: second.binding }));
    assert.equal(f.output().textContent, replacement);
    assert.equal(first.listeners.size, 0);
    assert.equal(second.listeners.size, 1);
    await act(async () => first.update({ ...initial, value: 'stale' }));
    assert.equal(f.output().textContent, replacement);
    await f.render(null);
    assert.equal(second.listeners.size, 0);
    await f.render(h(RichTextField, { binding: second.binding }));
    assert.equal(f.output().textContent, replacement);
    await act(async () =>
        second.update({ ...initial, retired: true, value: replacement })
    );
    assert.equal(f.container.querySelector('output'), null);
    await f.render(h(RichTextField, { binding: f.binding }));
    assert.equal(second.listeners.size, 0);
    assert.equal(f.output().textContent, native);
    assert.equal(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('output'), null);
});

it('associates unique labels and plain status feedback while preserving hidden titles and empty errors', async (t) => {
    const f = await fixture(t);
    const props = {
        ...f.props(),
        title: ' ',
        pending: true,
        error: '<b>error</b>',
    };
    await f.render(
        h('div', null, renderRichTextField(props), renderRichTextField(props))
    );
    const outputs = f.container.querySelectorAll('output');
    assert.notEqual(outputs[0].id, outputs[1].id);
    for (const output of outputs) {
        assert.equal(
            f.container.querySelector(`label[for="${output.id}"]`)?.textContent,
            'Supplied rich text'
        );
        assert.equal(output.getAttribute('aria-busy'), 'true');
        assert.equal(output.getAttribute('aria-invalid'), 'true');
        assert.equal(
            f.container.querySelector(
                `[id="${output.getAttribute('aria-describedby')}"]`
            )?.textContent,
            '<b>error</b>'
        );
    }
    assert.equal(f.container.querySelector('b'), null);
    const validation = [
        {
            fieldId: 'richText',
            fieldTitle: 'Rich Text',
            errorMessage: 'Validation',
        },
    ];
    await f.render(
        renderRichTextField({
            ...props,
            displayConfig: { showTitle: false },
            error: '',
            validation,
        })
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(f.output().getAttribute('aria-label'), 'Supplied rich text');
    assert.equal(f.output().hasAttribute('aria-describedby'), false);
    assert.equal(f.container.querySelector('[role=status]')?.textContent, '');
    await f.render(renderRichTextField({ ...props, error: null, validation }));
    const feedback = f.container.querySelector('[role=status]');
    assert.equal(feedback?.textContent, 'Validation');
    assert.equal(feedback?.getAttribute('aria-live'), 'polite');
    const maskedProps = { ...props, error: 'Owner status' };
    Object.assign(maskedProps, { displayConfig: { obscurePassword: true } });
    await f.render(renderRichTextField(maskedProps));
    assert.equal(f.output().textContent, '••••••••');
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Owner status'
    );
});

it('isolates mouse, pointer and keyboard row events without cancelling native defaults or editing neighbors', async (t) => {
    const f = await fixture(t);
    let rows = 0;
    await f.render(
        h(
            'div',
            {
                onClick: () => rows++,
                onDoubleClick: () => rows++,
                onAuxClick: () => rows++,
                onPointerDown: () => rows++,
                onKeyDown: () => rows++,
                onKeyUp: () => rows++,
            },
            h(RichTextField, { binding: f.binding }),
            h(NumberField, { binding: f.owner.field('number') })
        )
    );
    await dispatchRowEvents(f);
    assert.equal(rows, 0);
    const input = f.container.querySelector('input')!;
    assert.equal(input.disabled, false);
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )!.set!.call(input, '3.125');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    assert.equal(f.owner.field('number').getSnapshot().value, 3.125);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('renders the existing Rich Text slot through actual Form composition without Save or native conversion', async (t) => {
    const f = await fixture(t);
    const scope = createFormRenderScope({
        fields: f.owner,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    t.after(() => scope.destroy());
    let rows = 0;
    await f.render(
        h(
            'div',
            rowHandlers(() => rows++),
            h(AirtableForm, {
                scope,
                renderers: { renderRichTextField },
                children: (state) =>
                    state.fields
                        .filter((field) => field.fieldId === 'richText')
                        .map((field) => field.node),
            })
        )
    );
    assert.equal(f.output().textContent, native);
    assertAccessibleOutput(f);
    await dispatchRowEvents(f);
    assert.equal(rows, 0);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

for (const layout of ['grid', 'list'] as const)
    it(`renders accepted Portal ${layout} Rich Text details without write controls or added requests`, async (t) => {
        const f = await fixture(t);
        const schema = f.loaded.payload.fieldIdsToSchemas.richText;
        const detail = {
            fieldId: 'richText',
            fieldName: 'Supplied rich text',
            titleOverride: '',
            isHidden: false,
            fieldIsInEditingChildForm: false,
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
                                fields: { richText: native },
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
            getScope: () => ({ ownerId: 'rich-text-portal', revision: 0 }),
        });
        await owner.readFirst(owner.getSnapshot().revision, {
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        let current = true;
        const host = createPortalDetailRendererHost({
            owner,
            client: api.client,
            recordId: 'record_1',
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => {
            host.dispose();
            owner.destroy();
            assert.equal(api.calls.length, 1);
            assert.equal(api.mutations, 0);
        });
        const state = host.getSnapshot();
        assert.equal(state.status, 'ready');
        if (state.status !== 'ready')
            throw Error('Expected Portal Rich Text host');
        assert.equal(state.fields[0].capability.type, 'readonly');
        assert.deepEqual(state.fields[0].value, native);
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderRichTextField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.output().textContent, native);
        const scope = createPortalRenderScope({
            owner,
            client: api.client,
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        t.after(() => scope.destroy());
        const Component = layout === 'grid' ? AirtableGrid : AirtableList;
        let rows = 0;
        await f.render(
            h(
                'div',
                rowHandlers(() => rows++),
                h(Component, {
                    scope,
                    renderers: { renderRichTextField },
                    children: (snapshot) =>
                        snapshot.rows.flatMap((row) =>
                            row.cells.map((cell) => cell.node)
                        ),
                })
            )
        );
        assert.equal(f.output().textContent, native);
        assertAccessibleOutput(f);
        await dispatchRowEvents(f);
        assert.equal(rows, 0);
        assert.equal(state.fields[0].value, native);
        assert.equal(
            f.container.querySelector('input,button,a,img,canvas,video'),
            null
        );
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('output'), null);
    });

for (const value of [undefined, null, '', ' \n\t ', '\r\n'] as const)
    it(`preserves edit hide-empty policy for ${JSON.stringify(value)}`, async (t) => {
        const f = await fixture(t, {
            value,
            config: { hideFieldIfEmpty: true },
            edit: true,
        });
        assert.equal(f.binding.getSnapshot().visibility.type, 'hidden');
        for (const node of [
            h(RichTextField, { binding: f.binding }),
            f.tree(),
        ]) {
            await f.render(node);
            assert.equal(f.container.querySelector('output'), null);
            assert.equal(f.binding.getSnapshot().value, value);
        }
    });

for (const value of ['** **', '#', '<br>', '[]()', native])
    it(`keeps nonblank edit Rich Text literal under hide-empty policy: ${JSON.stringify(value)}`, async (t) => {
        const f = await fixture(t, {
            value,
            config: { hideFieldIfEmpty: true },
            edit: true,
        });
        assert.equal(f.binding.getSnapshot().visibility.type, 'visible');
        await f.render(f.tree());
        assert.equal(f.output().textContent, value);
        assert.equal(f.binding.getSnapshot().value, value);
        assert.equal(f.binding.getSnapshot().dirty, false);
    });

it('keeps a create-mode empty answer visible when owner policy does', async (t) => {
    const f = await fixture(t, {
        value: '',
        config: { hideFieldIfEmpty: true },
    });
    assert.equal(f.binding.getSnapshot().visibility.type, 'visible');
    await f.render(f.tree());
    assert.equal(f.output().textContent, '');
    assert.equal(f.binding.getSnapshot().value, '');
});
