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
import { AiTextField, renderAiTextField } from '../src/react/AiTextField.js';
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
    FieldReadValue,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

type AiTextValue = NonNullable<FieldReadValue<'aiText'>>;
const literal =
    '  **Bold** _emphasis_\r\n雪 <b>literal</b>  \n\t[link](https://private.invalid)\n![image](https://private.invalid/image)';
const native: AiTextValue = {
    state: 'generated',
    value: literal,
    isStale: false,
};

async function fixture(
    t: TestContext,
    options: {
        value?: FieldReadValue<'aiText'>;
        config?: FieldConfig<'aiText'>;
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
    loaded.payload.fieldIdsInForm.push('aiText', 'number');
    const value = Object.hasOwn(options, 'value') ? options.value : native;
    if (value !== undefined) loaded.payload.formRecord.data.aiText = value;
    loaded.payload.fieldIdsToSchemas.aiText = {
        fieldType: 'aiText',
        airtableField: {
            id: 'aiText',
            name: 'Supplied AI text',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'aiText', options: {} },
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
                throw Error('AI Text presentation must not perform I/O');
            },
        }),
        getScope: () => ({ ownerId: 'aiText', revision: 0 }),
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('aiText');
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'aiText',
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
                state.fields[0].physicalKind !== 'aiText'
            )
                throw Error('AI Text props expected');
            return state.fields[0];
        },
        tree: () =>
            h(FieldRenderer, {
                host,
                renderers: { renderAiTextField },
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
            throw Error('AI Text display cannot borrow a setter');
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
                throw Error(`AI Text display cannot read ${name}`);
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
    assert.equal(name, 'Supplied AI text');
    assert.equal(output.getAttribute('aria-busy'), 'false');
    assert.equal(output.getAttribute('aria-invalid'), 'false');
}

const states = ['empty', 'loading', 'generated', 'error'] as const;
for (const state of states)
    for (const isStale of [false, true])
        it(`presents supplied AI Text for ${state}, isStale=${isStale} without inferring status or granting writes`, async (t) => {
            const value = {
                state,
                value: literal,
                isStale,
                errorType: 'private-error-type',
            };
            const f = await fixture(t, { value });
            const before = f.binding.getSnapshot();
            assert.equal(before.canEdit, false);
            assert.equal(before.readOnly, true);
            assert.equal(f.props().computed, true);
            assert.equal(f.props().capability.type, 'readonly');
            assert.equal(f.props().physicalKind, 'aiText');
            for (const node of [
                h(AiTextField, { binding: f.binding }),
                f.tree(),
            ]) {
                await f.render(node);
                assert.equal(f.output().textContent, literal);
                assert.equal(f.output().getAttribute('aria-busy'), 'false');
                assert.equal(f.output().getAttribute('aria-invalid'), 'false');
                assert.equal(
                    f.container.querySelector('[role=status]')?.textContent,
                    ''
                );
                assert.equal(
                    f.container.querySelector(
                        'input,textarea,button,a,img,svg,canvas,video,audio,iframe,object,embed,script,link,style,b,strong,em,s,code,pre,h1,ul,li,blockquote,[contenteditable]'
                    ),
                    null
                );
                assert.equal(f.output().style.whiteSpace, 'pre-wrap');
                assert.equal(f.output().style.overflowWrap, 'anywhere');
                assert.notEqual(f.output().style.userSelect, 'none');
                assert.deepEqual(f.binding.getSnapshot().value, value);
                assert.deepEqual(f.binding.getSnapshot().value, before.value);
                assert.equal(f.binding.getSnapshot().dirty, before.dirty);
                assert.deepEqual(f.props().value, value);
                assert(!f.container.innerHTML.includes('private-error-type'));
                await f.render(null);
            }
        });

for (const [label, value] of [
    ['missing', undefined],
    ['null', null],
    ...states.map(
        (state) => [state, { state, value: '', isStale: false }] as const
    ),
    ['blank', { state: 'generated', value: '  \n\t  ', isStale: true }],
    [
        'line endings and entities',
        {
            state: 'generated',
            value: 'first\r\nsecond\rthird\n&lt;b&gt; &amp; &#10;',
            isStale: false,
        },
    ],
    [
        'literal markup',
        {
            state: 'generated',
            value: '<img src="https://private.invalid" onerror="alert(1)"><script>alert(1)</script>',
            isStale: false,
        },
    ],
] as const)
    it(`preserves AI Text ${label} literally without substituting native state`, async (t) => {
        const f = await fixture(t, { value });
        for (const node of [h(AiTextField, { binding: f.binding }), f.tree()]) {
            await f.render(node);
            assert.equal(f.output().textContent, value?.value ?? '');
            assert.equal(
                f.container.querySelector('img,script,a,button,input,textarea'),
                null
            );
            assert.equal(f.output().getAttribute('aria-invalid'), 'false');
            assert.deepEqual(f.binding.getSnapshot().value, value);
            await f.render(null);
        }
    });

it('rejects malformed direct and bound values without coercion or owner changes', async (t) => {
    const f = await fixture(t);
    let coercions = 0;
    const poison = () => {
        coercions++;
        throw Error('AI Text must not coerce native members');
    };
    for (const value of [
        'generated text',
        42,
        false,
        [],
        [native],
        {},
        { value: 'missing state', isStale: false },
        { state: 'generated', isStale: false },
        { state: 'generated', value: 'missing stale' },
        ...[undefined, null, 0, 1, '', 'false'].map((isStale) => ({
            ...native,
            isStale,
        })),
        ...[undefined, null, 42, true, [], new String('boxed')].map(
            (value) => ({ ...native, value })
        ),
        ...[
            undefined,
            null,
            42,
            true,
            'unknown',
            'Generated',
            ' generated ',
            new String('generated'),
            { toString: poison, valueOf: poison, [Symbol.toPrimitive]: poison },
        ].map((state) => ({ ...native, state })),
        { ...native, errorType: null },
        { ...native, errorType: 42 },
        new String('boxed object'),
        Symbol('private'),
        Object.assign(Object.create(null), native),
        Object.assign(Object.create({ inherited: true }), native),
    ]) {
        await f.render(
            renderAiTextField({
                ...f.props(),
                value,
            } as unknown as FieldRendererProps<'aiText'>)
        );
        assert.equal(f.output().textContent, 'Unavailable');
        assert.equal(f.output().getAttribute('aria-invalid'), 'true');
        await f.render(
            h(AiTextField, {
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
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

it('fails closed on throwing native references and properties without exposing diagnostics', async (t) => {
    const f = await fixture(t);
    for (const property of [
        'reference',
        'state',
        'value',
        'isStale',
        'errorType',
        'prototype',
    ] as const) {
        const props = f.props();
        const snapshot = { ...f.binding.getSnapshot() };
        const poison = () => {
            throw Error('private native failure');
        };
        if (property === 'reference') {
            Object.defineProperty(props, 'value', { get: poison });
            Object.defineProperty(snapshot, 'value', { get: poison });
        } else {
            const value =
                property === 'prototype'
                    ? new Proxy({ ...native }, { getPrototypeOf: poison })
                    : Object.defineProperty({ ...native }, property, {
                          enumerable: true,
                          get: poison,
                      });
            props.value = value;
            snapshot.value = value;
        }
        for (const node of [
            renderAiTextField(props),
            h(AiTextField, { binding: snapshotBinding(snapshot).binding }),
        ]) {
            await f.render(node);
            assert.equal(f.output().textContent, 'Unavailable');
            assert.equal(f.output().getAttribute('aria-invalid'), 'true');
            assert(!f.container.innerHTML.includes('private native failure'));
            await f.render(null);
        }
    }
});

it('captures direct native members once and never reads prompts, references or extra diagnostics', async (t) => {
    const f = await fixture(t);
    const reads = { state: 0, value: 0, isStale: 0, errorType: 0 };
    const first = { ...native, errorType: 'private native error' };
    const value = {} as AiTextValue;
    for (const property of ['state', 'value', 'isStale', 'errorType'] as const)
        Object.defineProperty(value, property, {
            enumerable: true,
            get() {
                reads[property]++;
                if (reads[property] > 1) throw Error('Native property reread');
                return first[property];
            },
        });
    for (const property of [
        'prompt',
        'references',
        'error',
        'generation',
        'retry',
    ])
        Object.defineProperty(value, property, {
            enumerable: true,
            get() {
                throw Error(`Must not inspect ${property}`);
            },
        });
    await f.render(renderAiTextField({ ...f.props(), value }));
    assert.equal(f.output().textContent, literal);
    assert.deepEqual(reads, { state: 1, value: 1, isStale: 1, errorType: 1 });
    assert(!f.container.innerHTML.includes('private native error'));
});

it('masks before native reference or property access on either configuration surface', async (t) => {
    const f = await fixture(t);
    for (const surface of ['displayConfig', 'writeConfig'] as const)
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
            for (const guarded of ['reference', 'properties'] as const) {
                const props = f.props();
                const other =
                    surface === 'displayConfig'
                        ? 'writeConfig'
                        : 'displayConfig';
                Object.assign(props, {
                    [surface]: { [flag]: true },
                    [other]: { [flag]: false },
                });
                let reads = 0;
                const poison = () => {
                    reads++;
                    throw Error('Masked value read');
                };
                if (guarded === 'reference')
                    Object.defineProperty(props, 'value', { get: poison });
                else
                    props.value = new Proxy(
                        { ...native },
                        { get: poison, getPrototypeOf: poison, ownKeys: poison }
                    );
                await f.render(renderAiTextField(props));
                assert.equal(reads, 0);
                assert.equal(f.output().textContent, '••••••••');
                assert.equal(f.output().getAttribute('aria-invalid'), 'false');
                assert(!f.container.innerHTML.includes('private.invalid'));
            }
    for (const value of [
        undefined,
        null,
        {},
        { ...native, value: '' },
        native,
    ]) {
        const props = { ...f.props(), value } as FieldRendererProps<'aiText'>;
        Object.assign(props, { displayConfig: { obscurePassword: true } });
        await f.render(renderAiTextField(props));
        assert.equal(f.output().textContent, '••••••••');
    }
});

it('masks bound native references and properties before inspection and restores supplied text', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
        for (const guarded of ['reference', 'properties'] as const) {
            const snapshot = structuredClone(initial);
            Object.assign(snapshot.field!.schema.miniExtConfig!, {
                [flag]: true,
            });
            let reads = 0;
            const poison = () => {
                reads++;
                throw Error('Masked binding value read');
            };
            if (guarded === 'reference')
                Object.defineProperty(snapshot, 'value', { get: poison });
            else
                snapshot.value = new Proxy(
                    { ...native },
                    { get: poison, getPrototypeOf: poison, ownKeys: poison }
                );
            const pure = snapshotBinding(snapshot);
            await f.render(h(AiTextField, { binding: pure.binding }));
            assert.equal(f.output().textContent, '••••••••');
            assert.equal(reads, 0);
            await act(async () => pure.update(initial));
            assert.equal(f.output().textContent, literal);
        }
});

it('does not borrow computed field actions or inspect supplied capabilities', async (t) => {
    const f = await fixture(t);
    const props = f.props();
    assert.equal(props.capability.type, 'readonly');
    assert.equal(props.computed, true);
    for (const name of ['capability', 'linkedRecords', 'selectAvailability'])
        Object.defineProperty(props, name, {
            get() {
                throw Error(`AI Text display cannot read ${name}`);
            },
        });
    await f.render(renderAiTextField(props, { className: 'ai-text-test' }));
    assert.equal(f.output().textContent, literal);
    assert.ok(f.container.querySelector('.ai-text-test'));
    const pure = snapshotBinding(f.binding.getSnapshot());
    await f.render(
        h(AiTextField, { binding: pure.binding, className: 'bound-ai-text' })
    );
    assert.equal(f.output().textContent, literal);
    assert.ok(f.container.querySelector('.bound-ai-text'));
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
            h(AiTextField, { binding: snapshotBinding(snapshot).binding })
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
    await f.render(h(AiTextField, { binding: f.binding }));
    assert.equal(f.container.querySelector('output'), null);
});

it('keeps custom rendering first and refuses the wrong physical field kind', async (t) => {
    const f = await fixture(t);
    await f.render(h(AiTextField, { binding: f.owner.field('number') }));
    assert.match(f.container.textContent!, /supports AI Text/);
    const initial = f.binding.getSnapshot();
    const retired = snapshotBinding({ ...initial, retired: true });
    await f.render(
        h(AiTextField, {
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
        h(AiTextField, { binding: snapshotBinding(wrongMetadata).binding })
    );
    assert.match(f.container.textContent!, /supports AI Text/);
    assert.equal(f.container.querySelector('output'), null);
});

it('tracks accepted updates, replacement, StrictMode remount and retirement without stale subscriptions', async (t) => {
    const f = await fixture(t);
    const initial = f.binding.getSnapshot();
    const first = snapshotBinding(initial);
    const replacement: AiTextValue = {
        state: 'loading',
        value: '**replacement**\r\n  text',
        isStale: true,
    };
    const second = snapshotBinding({ ...initial, value: replacement });
    await f.render(h(AiTextField, { binding: first.binding }));
    assert.equal(first.listeners.size, 1);
    await act(async () =>
        first.update({
            ...initial,
            value: {
                state: 'error',
                value: '# accepted\n  update',
                isStale: true,
            },
        })
    );
    assert.equal(f.output().textContent, '# accepted\n  update');
    await f.render(h(AiTextField, { binding: second.binding }));
    assert.equal(f.output().textContent, replacement.value);
    assert.equal(first.listeners.size, 0);
    assert.equal(second.listeners.size, 1);
    await act(async () =>
        first.update({
            ...initial,
            value: { state: 'generated', value: 'stale', isStale: false },
        })
    );
    assert.equal(f.output().textContent, replacement.value);
    await f.render(null);
    assert.equal(second.listeners.size, 0);
    await f.render(h(AiTextField, { binding: second.binding }));
    assert.equal(f.output().textContent, replacement.value);
    await act(async () =>
        second.update({ ...initial, retired: true, value: replacement })
    );
    assert.equal(f.container.querySelector('output'), null);
    await f.render(h(AiTextField, { binding: f.binding }));
    assert.equal(second.listeners.size, 0);
    assert.equal(f.output().textContent, literal);
    assert.deepEqual(f.binding.getSnapshot().value, native);
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
        h('div', null, renderAiTextField(props), renderAiTextField(props))
    );
    const outputs = f.container.querySelectorAll('output');
    assert.notEqual(outputs[0].id, outputs[1].id);
    for (const output of outputs) {
        assert.equal(
            f.container.querySelector(`label[for="${output.id}"]`)?.textContent,
            'Supplied AI text'
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
            fieldId: 'aiText',
            fieldTitle: 'AI Text',
            errorMessage: 'Validation',
        },
    ];
    await f.render(
        renderAiTextField({
            ...props,
            displayConfig: { showTitle: false },
            error: '',
            validation,
        })
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(f.output().getAttribute('aria-label'), 'Supplied AI text');
    assert.equal(f.output().hasAttribute('aria-describedby'), false);
    assert.equal(f.container.querySelector('[role=status]')?.textContent, '');
    await f.render(renderAiTextField({ ...props, error: null, validation }));
    const feedback = f.container.querySelector('[role=status]');
    assert.equal(feedback?.textContent, 'Validation');
    assert.equal(feedback?.getAttribute('aria-live'), 'polite');
    const maskedProps = { ...props, error: 'Owner status' };
    Object.assign(maskedProps, { displayConfig: { obscurePassword: true } });
    await f.render(renderAiTextField(maskedProps));
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
            h(AiTextField, { binding: f.binding }),
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

it('renders the existing AI Text slot through actual Form composition without Save or native conversion', async (t) => {
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
                renderers: { renderAiTextField },
                children: (state) =>
                    state.fields
                        .filter((field) => field.fieldId === 'aiText')
                        .map((field) => field.node),
            })
        )
    );
    assert.equal(f.output().textContent, literal);
    assertAccessibleOutput(f);
    await dispatchRowEvents(f);
    assert.equal(rows, 0);
    assert.deepEqual(f.binding.getSnapshot().value, native);
    assert.equal(f.binding.getSnapshot().dirty, false);
});

for (const layout of ['grid', 'list'] as const)
    it(`renders accepted Portal ${layout} AI Text details without write controls or added requests`, async (t) => {
        const f = await fixture(t);
        const schema = f.loaded.payload.fieldIdsToSchemas.aiText;
        const detail = {
            fieldId: 'aiText',
            fieldName: 'Supplied AI text',
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
                                fields: { aiText: native },
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
            getScope: () => ({ ownerId: 'ai-text-portal', revision: 0 }),
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
            throw Error('Expected Portal AI Text host');
        assert.equal(state.fields[0].capability.type, 'readonly');
        assert.deepEqual(state.fields[0].value, native);
        const tree = () =>
            h(FieldRenderer, {
                host,
                renderers: { renderAiTextField },
                fallback: () => null,
            });
        await f.render(tree());
        assert.equal(f.output().textContent, literal);
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
                    renderers: { renderAiTextField },
                    children: (snapshot) =>
                        snapshot.rows.flatMap((row) =>
                            row.cells.map((cell) => cell.node)
                        ),
                })
            )
        );
        assert.equal(f.output().textContent, literal);
        assertAccessibleOutput(f);
        await dispatchRowEvents(f);
        assert.equal(rows, 0);
        assert.deepEqual(state.fields[0].value, native);
        assert.equal(
            f.container.querySelector('input,button,a,img,canvas,video'),
            null
        );
        current = false;
        await f.render(tree());
        assert.equal(f.container.querySelector('output'), null);
    });

it('preserves the existing computed edit hide-empty block without interpreting empty AI states', async (t) => {
    const value: AiTextValue = { state: 'empty', value: '', isStale: false };
    const f = await fixture(t, {
        value,
        config: { hideFieldIfEmpty: true },
        edit: true,
    });
    const snapshot = f.binding.getSnapshot();
    assert.equal(snapshot.visibility.type, 'blocked');
    if (snapshot.visibility.type !== 'blocked')
        throw Error('Expected computed hide-empty block');
    assert.equal(snapshot.visibility.code, 'unsupported-hide-empty');
    for (const node of [h(AiTextField, { binding: f.binding }), f.tree()]) {
        await f.render(node);
        assert.equal(f.container.querySelector('output'), null);
        assert.deepEqual(f.binding.getSnapshot().value, value);
        assert.equal(f.binding.getSnapshot().dirty, false);
    }
});

it('keeps an empty create-mode AI answer visible when its owner policy does', async (t) => {
    const value: AiTextValue = { state: 'empty', value: '', isStale: true };
    const f = await fixture(t, { value, config: { hideFieldIfEmpty: true } });
    assert.equal(f.binding.getSnapshot().visibility.type, 'visible');
    await f.render(f.tree());
    assert.equal(f.output().textContent, '');
    assert.deepEqual(f.binding.getSnapshot().value, value);
});
