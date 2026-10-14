import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    Fragment,
    startTransition,
    StrictMode,
    Suspense,
    useState,
    type ReactNode,
} from 'react';
import {
    MultilineTextField,
    FieldRenderer,
    renderMultilineTextField,
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
import {
    createMiniExtensionsClient,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

async function fixture(
    t: TestContext,
    config: FieldConfig<'multilineText'> = {},
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
        'HTMLTextAreaElement',
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
    loaded.payload.fieldIdsInForm.push('multilineText');
    if (!missing) loaded.payload.formRecord.data.multilineText = initial;
    loaded.payload.fieldIdsToSchemas.multilineText = {
        fieldType: 'multilineText',
        airtableField: {
            id: 'multilineText',
            name: 'Notes',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'multilineText', options: null },
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
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            requests++;
            throw Error('No implicit requests');
        },
    });
    const saves: SaveFormInput[] = [];
    let allowSave = false;
    client.forms.save = async (input) => {
        assert.equal(allowSave, true, 'Only the explicit test action can Save');
        saves.push(structuredClone(input));
        return invalidForm();
    };
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client,
        getScope: () => ({ ownerId: 'multiline-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('multilineText');
    let writes = 0;
    const setValue = binding.setValue;
    binding.setValue = (value) => {
        writes++;
        return setValue(value);
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'multilineText',
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
        const node = container.querySelector('textarea');
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
        saves,
        writes: () => writes,
        save: async () => {
            allowSave = true;
            try {
                return await owner.save();
            } finally {
                allowSave = false;
            }
        },
        composition: async (
            type: 'compositionstart' | 'compositionend',
            value?: string
        ) => {
            await act(async () => {
                if (value !== undefined)
                    Object.getOwnPropertyDescriptor(
                        window.HTMLTextAreaElement.prototype,
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
                snapshot.fields[0].physicalKind !== 'multilineText'
            )
                throw Error('Multiline props expected');
            return snapshot.fields[0];
        },
        edit: async (value: string) => {
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype,
                    'value'
                )!.set!.call(input(), value);
                input().dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
    };
}

function replacementOwner(
    t: TestContext,
    f: Awaited<ReturnType<typeof fixture>>,
    value: string
) {
    const loaded = structuredClone(f.loaded);
    loaded.payload.formRecord.data.multilineText = value;
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: f.client,
        getScope: () => ({ ownerId: 'multiline-replacement', revision: 0 }),
    });
    t.after(() => owner.destroy());
    const binding = owner.field('multilineText');
    const setValue = binding.setValue;
    let writes = 0;
    binding.setValue = (next) => {
        writes++;
        return setValue(next);
    };
    return { binding, writes: () => writes };
}

type RetainedEvent = {
    currentTarget: { value: string };
    stopPropagation(): void;
};

// Retain the installed callbacks so replacement/unmount guards are exercised
// even when a late callback has already escaped React's DOM event dispatcher.
function retainedHandlers(node: object) {
    const key = Object.keys(node).find((key) =>
        key.startsWith('__reactProps$')
    );
    assert.ok(key);
    return Reflect.get(node, key) as Record<
        string,
        (event: RetainedEvent) => void
    >;
}

it('keeps multiline whitespace and literal markup in owner drafts and the explicit Save receipt', async (t) => {
    const initial = '  First line\n\nLast line  ';
    const f = await fixture(t, { preserveTrailingWhitespace: false }, initial);
    const before = f.binding.getSnapshot().revision;
    await f.render(
        h(MultilineTextField, { binding: f.binding, className: 'notes' })
    );
    assert.ok(f.container.querySelector('.notes'));
    assert.equal(f.input().getAttribute('rows'), '4');
    assert.equal(f.input().value, initial);
    assert.equal(f.binding.scalar, null);
    assert.equal(f.binding.getSnapshot().revision, before);
    assert.equal(f.writes(), 0);
    const edited =
        '  <b>literal</b>\n<script>text only</script>\n\tLast line  ';
    await f.edit(edited);
    assert.equal(f.binding.getSnapshot().value, edited);
    assert.equal(
        f.container.querySelector('b,script,a,[contenteditable],input'),
        null
    );
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderMultilineTextField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, edited);
    assert.equal(f.saves.length, 0);
    await act(async () => {
        await f.save();
    });
    assert.equal(f.saves.length, 1);
    assert.equal(f.saves[0]!.formRecord.data.multilineText, edited);
    assert.deepEqual(f.saves[0]!.formRecord.data.fld_parent, ['record_parent']);
    assert.equal(f.binding.getSnapshot().value, edited);
});

it('loaded CRLF and CR remain native until a deliberate textarea edit supplies LF', async (t) => {
    const initial = 'First\r\nSecond\rThird\nLast';
    const f = await fixture(t, {}, initial);
    await f.render(h(MultilineTextField, { binding: f.binding }));
    await f.render(null);
    await f.render(h(MultilineTextField, { binding: f.binding }));
    assert.equal(f.binding.getSnapshot().value, initial);
    assert.equal(f.binding.getSnapshot().dirty, false);
    assert.equal(f.writes(), 0);
    // Happy DOM does not normalize textarea line endings. Supply the LF value
    // a native textarea emits; the renderer must not restore or invent CRLF.
    const nativeEdit = 'First\nSecond\nThird\nLast\n';
    await f.edit(nativeEdit);
    assert.equal(f.input().value, nativeEdit);
    assert.equal(f.binding.getSnapshot().value, nativeEdit);
    await act(async () => f.binding.setValue('External\r\nvalue'));
    assert.equal(f.binding.getSnapshot().value, 'External\r\nvalue');
    assert.equal(f.writes(), 2);
});

for (const initial of [null, undefined] as const)
    it(`preserves ${initial === null ? 'null' : 'absence'} across remount and clears deliberately to null`, async (t) => {
        const f = await fixture(t, {}, initial ?? null, initial === undefined);
        await f.render(
            h(MultilineTextField, {
                binding: f.binding,
                clearLabel: 'Clear notes',
            })
        );
        await f.render(null);
        await f.render(
            h(MultilineTextField, {
                binding: f.binding,
                clearLabel: 'Clear notes',
            })
        );
        assert.equal(f.input().value, '');
        assert.equal(f.binding.getSnapshot().value, initial);
        assert.equal(f.writes(), 0);
        await f.edit(' \n\t ');
        assert.equal(f.binding.getSnapshot().value, ' \n\t ');
        const clear = f.container.querySelector('button')!;
        assert.equal(clear.type, 'button');
        assert.equal(clear.getAttribute('aria-label'), 'Clear notes');
        await act(async () => clear.click());
        assert.equal(f.binding.getSnapshot().value, null);
        assert.equal(f.window.document.activeElement, f.input());
        await f.edit('New\ntext');
        await f.edit('');
        assert.equal(f.binding.getSnapshot().value, null);
    });

it('limits deliberate edits from either configuration without truncating loaded values or splitting surrogate pairs', async (t) => {
    const f = await fixture(
        t,
        { characterLimit: 2 },
        'Loaded\ntext exceeds cap'
    );
    await f.render(h(MultilineTextField, { binding: f.binding }));
    assert.equal(f.input().value, 'Loaded\ntext exceeds cap');
    assert.equal(f.writes(), 0);
    await f.edit('A😀B');
    assert.equal(f.binding.getSnapshot().value, 'A');
    const props = f.props();
    for (const [displayConfig, writeConfig] of [
        [{ characterLimit: 5 }, { characterLimit: 3 }],
        [{ characterLimit: 3 }, { characterLimit: 5 }],
    ]) {
        await f.render(
            renderMultilineTextField({ ...props, displayConfig, writeConfig })
        );
        assert.equal(f.input().maxLength, 3);
        await f.edit('😀\nX');
        assert.equal(f.binding.getSnapshot().value, '😀\n');
    }
    await f.render(
        renderMultilineTextField({
            ...f.props(),
            displayConfig: { characterLimit: 0 },
            writeConfig: {},
        })
    );
    await f.edit('Denied');
    assert.equal(f.binding.getSnapshot().value, null);
});

it('associates repeated labels, required/count/plain feedback and leaves Enter uncancelled while containing row events', async (t) => {
    const f = await fixture(t, {
        title: 'Notes title',
        placeholderText: 'Write notes',
        required: true,
        characterLimit: 20,
    });
    let rowEvents = 0;
    const props = { ...f.props(), error: '<b>Review notes</b>' };
    await f.render(
        h(
            'div',
            {
                onKeyDown: () => rowEvents++,
                onClick: () => rowEvents++,
                onCompositionStart: () => rowEvents++,
            },
            renderMultilineTextField(props),
            renderMultilineTextField(props)
        )
    );
    const fields = f.container.querySelectorAll('textarea');
    assert.notEqual(fields[0].id, fields[1].id);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.input().placeholder, 'Write notes');
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const descriptions = f
        .input()
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => f.window.document.getElementById(id)!.textContent);
    assert.ok(descriptions.includes('<b>Review notes</b>'));
    assert.ok(descriptions.includes('0/20'));
    assert.equal(f.container.querySelector('b'), null);
    const enter = new f.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => f.input().dispatchEvent(enter));
    assert.equal(enter.defaultPrevented, false);
    assert.equal(rowEvents, 0);
    await f.edit('First\nSecond');
    assert.equal(f.binding.getSnapshot().value, 'First\nSecond');
    await f.render(
        renderMultilineTextField({
            ...f.props(),
            title: ' ',
            error: '',
            displayConfig: { showTitle: false },
            validation: [
                {
                    fieldId: 'multilineText',
                    fieldTitle: 'Notes',
                    errorMessage: 'Do not replace empty feedback',
                },
            ],
        })
    );
    assert.equal(f.input().getAttribute('aria-label'), 'Notes');
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
});

it('fails closed for append, attachments or explicit masking from either policy without exposing native plaintext', async (t) => {
    const secret = 'TOP SECRET\nNATIVE';
    const f = await fixture(t, {}, secret);
    const modes = [
        { addOnlyMode: true },
        { displayAsAttachments: true },
        { obscurePassword: true },
        { maskPasswordOnLoginScreen: true },
        { addOnlyMode: 'enabled' },
        { displayAsAttachments: null },
        { maskPasswordOnLoginScreen: 0 },
    ];
    for (const mode of modes) {
        // Explicit mask flags may arrive from legacy/runtime policy even though
        // they are not a supported multiline editor configuration.
        const policy = mode as unknown as FieldConfig<'multilineText'>;
        for (const which of ['displayConfig', 'writeConfig'] as const) {
            await f.render(
                renderMultilineTextField({
                    ...f.props(),
                    error: secret,
                    validation: [
                        {
                            fieldId: 'multilineText',
                            fieldTitle: 'Notes',
                            errorMessage: secret,
                        },
                    ],
                    displayConfig: {},
                    writeConfig: {},
                    [which]: policy,
                })
            );
            assert.equal(
                f.container.querySelector('textarea,input,button'),
                null
            );
            assert.equal(f.container.querySelector('.mx-sdk-text-count'), null);
            assert.match(
                f.container.querySelector('[role=status]')!.textContent!,
                /custom renderer/i
            );
            assert.equal(f.container.innerHTML.includes('TOP SECRET'), false);
        }
        const original = f.binding.getSnapshot();
        const snapshot = {
            ...original,
            field: {
                ...original.field!,
                schema: { ...original.field!.schema, miniExtConfig: policy },
            },
        };
        const blocked = {
            ...f.binding,
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
        };
        await f.render(h(MultilineTextField, { binding: blocked }));
        assert.equal(f.container.querySelector('textarea'), null);
        assert.equal(f.container.innerHTML.includes('TOP SECRET'), false);
        await f.render(
            h(MultilineTextField, {
                binding: blocked,
                render: () => h('output', null, 'Custom mode'),
            })
        );
        assert.equal(f.container.textContent, 'Custom mode');
    }
    await f.render(
        renderMultilineTextField({
            ...f.props(),
            title: 'Hidden notes title',
            displayConfig: { showTitle: false, addOnlyMode: true },
        })
    );
    assert.equal(f.container.querySelector('.mx-sdk-text-label'), null);
    assert.equal(
        f.container.querySelector('[role=group]')!.getAttribute('aria-label'),
        'Hidden notes title'
    );
    assert.equal(
        f.container.textContent!.includes('Hidden notes title'),
        false
    );
    await f.render(
        renderMultilineTextField({
            ...f.props(),
            displayConfig: { addOnlyMode: false, displayAsAttachments: false },
            writeConfig: {},
        })
    );
    assert.equal(f.input().value, secret);
    assert.equal(f.writes(), 0);
    assert.equal(f.binding.getSnapshot().value, secret);
});

it('disables accepted readonly, pending and computed controls and refuses stale edits or clear', async (t) => {
    const initial = 'Original\nnotes';
    const f = await fixture(t, {}, initial);
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
    ]) {
        await f.render(renderMultilineTextField({ ...f.props(), ...override }));
        assert.equal(f.input().disabled, true);
        assert.equal(f.container.querySelector('button')!.disabled, true);
        await f.edit('Rejected\nedit');
        assert.equal(f.binding.getSnapshot().value, initial);
    }
    assert.equal(f.writes(), 0);
    await f.render(renderMultilineTextField(f.props()));
    f.scope.revision++;
    await f.edit('Stale\nedit');
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.binding.getSnapshot().value, initial);
    await f.render(h(MultilineTextField, { binding: f.binding }));
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('textarea'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('textarea'), null);
});

it('buffers composed multiline input until completion, applies the cap once and ignores the trailing duplicate', async (t) => {
    const f = await fixture(t, { characterLimit: 4 });
    await f.render(h(MultilineTextField, { binding: f.binding }));
    await f.composition('compositionstart');
    await f.edit('日本\n語文');
    assert.equal(f.input().value, '日本\n語文');
    assert.equal(f.input().hasAttribute('maxlength'), false);
    assert.equal(f.container.querySelector('button')!.disabled, true);
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.writes(), 0);
    await f.composition('compositionend', '日本\n語文');
    assert.equal(f.binding.getSnapshot().value, '日本\n語');
    assert.equal(f.writes(), 1);
    await f.edit('日本\n語文');
    assert.equal(f.writes(), 1);
    assert.equal(f.input().value, '日本\n語');
});

it('cancels composed drafts on observed value, action, config or mode ABA changes without writing either owner', async (t) => {
    const f = await fixture(t, {}, 'Base\nnotes');
    const props = f.props();
    for (const replacement of [
        { value: 'Replacement\nnotes' },
        { pending: true },
        { displayConfig: { characterLimit: 2 } },
        { displayConfig: { addOnlyMode: true } },
        {
            writeConfig: {
                maskPasswordOnLoginScreen: true,
            } as FieldConfig<'multilineText'>,
        },
        {
            capability: {
                type: 'editable' as const,
                setValue: () => {
                    throw Error('Successor cannot inherit composition');
                },
            },
        },
    ]) {
        await f.render(renderMultilineTextField(props));
        await f.composition('compositionstart');
        await f.edit('unfinished\ncomposition');
        await f.render(renderMultilineTextField({ ...props, ...replacement }));
        await f.render(renderMultilineTextField(props));
        await f.composition('compositionend', 'Late\ntext');
        await f.edit('Late\ntext');
        assert.equal(f.binding.getSnapshot().value, 'Base\nnotes');
        assert.equal(f.input().value, 'Base\nnotes');
        assert.equal(f.writes(), 0);
    }
});

for (const composing of [false, true])
    it(`keeps the committed owner's ${composing ? 'composition' : 'editing'} authority while a replacement transition suspends`, async (t) => {
        const f = await fixture(t, {}, 'A\nvalue');
        const replacement = replacementOwner(t, f, 'B\nvalue');
        const waiting = new Promise<never>(() => {});
        let selectReplacement: () => void = () => {
            throw Error('App must be mounted');
        };
        let replacementRenders = 0;
        function Wait({ blocked }: { blocked: boolean }): ReactNode {
            if (blocked) {
                replacementRenders++;
                throw waiting;
            }
            return null;
        }
        function App() {
            const [replacing, setReplacing] = useState(false);
            selectReplacement = () => setReplacing(true);
            return h(
                Fragment,
                null,
                h(MultilineTextField, {
                    binding: replacing ? replacement.binding : f.binding,
                }),
                h(Wait, { blocked: replacing })
            );
        }
        await f.render(
            h(Suspense, { fallback: h('output', null, 'Loading') }, h(App))
        );
        const committedInput = f.input();
        if (composing) {
            await f.composition('compositionstart');
            await f.edit('A unfinished\n日本');
            assert.equal(f.writes(), 0);
        }
        await act(async () => startTransition(selectReplacement));
        assert.ok(replacementRenders > 0);
        assert.equal(f.input(), committedInput);
        assert.equal(f.container.querySelector('output'), null);
        assert.equal(
            f.input().value,
            composing ? 'A unfinished\n日本' : 'A\nvalue'
        );
        if (composing)
            await f.composition('compositionend', 'A finished\n日本');
        else await f.edit('A edited\nnotes');
        const expected = composing ? 'A finished\n日本' : 'A edited\nnotes';
        assert.equal(f.binding.getSnapshot().value, expected);
        assert.equal(f.input().value, expected);
        assert.equal(f.writes(), 1);
        assert.equal(replacement.binding.getSnapshot().value, 'B\nvalue');
        assert.equal(replacement.writes(), 0);
        assert.equal(f.saves.length, 0);
    });

it('retained callbacks cannot erase a replacement owner composition or write after detachment', async (t) => {
    const f = await fixture(t, {}, 'A\nvalue');
    const replacement = replacementOwner(t, f, 'B\nvalue');
    await f.render(h(MultilineTextField, { binding: f.binding }));
    const reusedInput = f.input();
    const previous = retainedHandlers(reusedInput);
    const previousClear = retainedHandlers(
        f.container.querySelector('button')!
    );
    await f.render(h(MultilineTextField, { binding: replacement.binding }));
    assert.equal(f.input(), reusedInput);
    await f.composition('compositionstart');
    await f.edit('B unfinished\n日本');
    const event: RetainedEvent = {
        currentTarget: reusedInput,
        stopPropagation() {},
    };
    for (const handler of [
        previous.onCompositionStart,
        previous.onCompositionEnd,
        previous.onChange,
        previous.onBlur,
        previousClear.onClick,
    ]) {
        await act(async () => handler(event));
        assert.equal(f.input().value, 'B unfinished\n日本');
        assert.equal(f.container.querySelector('button')!.disabled, true);
        assert.equal(f.binding.getSnapshot().value, 'A\nvalue');
        assert.equal(replacement.binding.getSnapshot().value, 'B\nvalue');
        assert.equal(f.writes(), 0);
        assert.equal(replacement.writes(), 0);
    }
    await f.edit('B continued\n日本語');
    assert.equal(replacement.writes(), 0);
    await f.composition('compositionend', 'B finished\n日本語');
    assert.equal(replacement.binding.getSnapshot().value, 'B finished\n日本語');
    assert.equal(replacement.writes(), 1);
    const detached = retainedHandlers(f.input());
    await f.render(null);
    reusedInput.value = 'Detached\nlate text';
    await act(async () => detached.onChange(event));
    assert.equal(replacement.binding.getSnapshot().value, 'B finished\n日本語');
    assert.equal(replacement.writes(), 1);
    assert.equal(f.writes(), 0);
    assert.equal(f.saves.length, 0);
});

it('remount and non-multiline bindings do not transfer unfinished text; custom render stays available', async (t) => {
    const f = await fixture(t, {}, 'Native\nnotes');
    const other = f.owner.field('fld_title');
    await f.render(h(MultilineTextField, { binding: f.binding }));
    await f.composition('compositionstart');
    await f.edit('unfinished\ntext');
    await f.render(null);
    await f.render(h(MultilineTextField, { binding: f.binding }));
    assert.equal(f.input().value, 'Native\nnotes');
    await f.composition('compositionend', 'Late\ntext');
    assert.equal(f.writes(), 0);
    await f.render(h(MultilineTextField, { binding: other }));
    assert.equal(f.container.querySelector('textarea,input'), null);
    assert.equal(f.container.innerHTML.includes('Initial title'), false);
    await f.render(
        h(MultilineTextField, {
            binding: other,
            render: ({ snapshot, binding }) =>
                h('output', null, `${snapshot.value}:${binding === other}`),
        })
    );
    assert.equal(f.container.textContent, 'Initial title:true');
});

for (const layout of ['grid', 'list'] as const)
    it(`uses accepted synthetic Portal ${layout} hosts without implicit reads or saves`, async (t) => {
        const initial = '  First line\nSecond line  ';
        const f = await fixture(t, {}, initial);
        const schema = f.loaded.payload.fieldIdsToSchemas.multilineText;
        const detail = {
            fieldId: 'multilineText',
            fieldName: 'Notes',
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
                                fields: { multilineText: initial },
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
            getScope: () => ({ ownerId: 'multiline-portal', revision: 0 }),
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
                recordFieldId: 'multilineText',
                selectedCustomViewId: 'view_example',
            },
            getScope: () => ({ ownerId: 'multiline-portal', revision: 0 }),
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'multiline-portal',
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
                      fieldId: 'multilineText',
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
            snapshot.fields[0].physicalKind !== 'multilineText'
        )
            throw Error('Multiline Portal props expected');
        const props = snapshot.fields[0];
        await f.render(
            h(FieldRenderer, {
                host,
                renderers: { renderMultilineTextField },
                fallback: () => null,
            })
        );
        assert.equal(f.input().value, String(initial));
        assert.equal(f.input().disabled, layout === 'list');
        if (layout === 'grid') {
            assert.equal(props.capability.type, 'editable');
            await f.edit('  New line\n\nLast line  ');
            assert.equal(
                cell.binding.getSnapshot().value,
                '  New line\n\nLast line  '
            );
            await f.edit('<b>literal HTML</b>\n<em>still text</em>');
            await f.render(null);
            await f.render(
                h(FieldRenderer, {
                    host,
                    renderers: { renderMultilineTextField },
                    fallback: () => null,
                })
            );
            assert.equal(
                f.input().value,
                '<b>literal HTML</b>\n<em>still text</em>'
            );
            assert.equal(
                cell.binding.getSnapshot().value,
                '<b>literal HTML</b>\n<em>still text</em>'
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
                renderers: { renderMultilineTextField },
                fallback: () => null,
            })
        );
        assert.equal(f.container.querySelector('textarea'), null);
        if (props.capability.type === 'editable') {
            assert.equal(
                props.capability.setValue('rejected\ntext').accepted,
                false
            );
        }
    });
