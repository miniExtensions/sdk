import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    TextField,
    FieldRenderer,
    renderSingleLineTextField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormFieldRendererHost } from '../src/ui/rendererHosts.js';
import type {
    FieldConfig,
    FieldRendererProps,
} from '../src/ui/rendererRegistry.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

async function fixture(
    t: TestContext,
    config: FieldConfig<'singleLineText'> = {},
    initial: string | null = null
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
    loaded.payload.formRecord.data.fld_title = initial;
    const schema = loaded.payload.fieldIdsToSchemas.fld_title;
    if (schema.fieldType !== 'singleLineText') throw Error('Expected text');
    schema.miniExtConfig = config;
    let requests = 0,
        writes = 0;
    const scope = { writable: true, visible: true, revision: 0 };
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
        getScope: () => ({ ownerId: 'text-test', revision: 0 }),
        canWrite: () => scope.writable,
        canWriteField: () => scope.visible,
    });
    const binding = owner.field('fld_title');
    const setExternal = binding.setValue;
    binding.setValue = (value) => {
        writes++;
        return setExternal(value);
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_title',
        isCurrent: () => true,
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
    const nativeValue = (value: string) =>
        Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        )!.set!.call(input(), value);
    return {
        window,
        container,
        binding,
        host,
        owner,
        scope,
        input,
        setExternal,
        writes: () => writes,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        props: () => {
            const snapshot = host.getSnapshot();
            if (
                snapshot.status !== 'ready' ||
                snapshot.fields[0].physicalKind !== 'singleLineText'
            )
                throw Error('Text props expected');
            return snapshot.fields[0];
        },
        edit: async (value: string) => {
            await act(async () => {
                nativeValue(value);
                input().dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
        composition: async (
            type: 'compositionstart' | 'compositionend',
            value?: string
        ) => {
            await act(async () => {
                if (value !== undefined) nativeValue(value);
                input().dispatchEvent(
                    new window.CompositionEvent(type, {
                        bubbles: true,
                    })
                );
            });
        },
    };
}

it('binding and slot preserve null, exact whitespace, native clearing, external edits and StrictMode/remount drafts', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(TextField, {
            binding: f.binding,
            className: 'custom',
            clearLabel: 'Effacer le texte',
        })
    );
    assert.equal(f.input().value, '');
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.writes(), 0);
    assert.ok(f.container.querySelector('.custom'));
    await f.edit('  <b>Exact text</b>  ');
    assert.equal(f.binding.getSnapshot().value, '  <b>Exact text</b>  ');
    assert.equal(f.container.querySelector('b'), null);
    assert.equal(f.writes(), 1);
    await f.render(null);
    await f.render(
        h(FieldRenderer, {
            host: f.host,
            renderers: { renderSingleLineTextField },
            fallback: () => null,
        })
    );
    assert.equal(f.input().value, '  <b>Exact text</b>  ');
    assert.equal(f.writes(), 1);
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.window.document.activeElement, f.input());
    assert.equal(f.writes(), 2);
    assert.equal(f.container.querySelector('button')!.disabled, true);
    await act(async () => {
        f.setExternal('External update');
    });
    assert.equal(f.input().value, 'External update');
    await f.edit('');
    assert.equal(f.binding.getSnapshot().value, null);
});

it('provides unique labels, placeholder, required/count/validation associations and Portal event containment', async (t) => {
    const f = await fixture(t, {
        title: 'Project',
        placeholderText: 'Type here',
        characterLimit: 12,
        required: true,
    });
    let rows = 0,
        submits = 0;
    const row = () => {
        rows++;
    };
    const props = { ...f.props(), error: '<img src=x> Fix this' };
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
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            renderSingleLineTextField(props),
            renderSingleLineTextField(props)
        )
    );
    const ids = Array.from(f.container.querySelectorAll('[id]')).map(
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(f.container.querySelector('label')!.htmlFor, f.input().id);
    assert.equal(f.container.querySelector('label')!.textContent, 'Project');
    assert.equal(f.input().placeholder, 'Type here');
    assert.equal(f.input().maxLength, 12);
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    const descriptions = f
        .input()
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((id) => f.window.document.getElementById(id)!.textContent);
    assert.deepEqual(descriptions, ['<img src=x> Fix this', '0/12']);
    assert.equal(f.container.querySelector('img'), null);
    await f.edit('Hello');
    await act(async () => {
        for (const type of [
            'click',
            'dblclick',
            'auxclick',
            'pointerdown',
            'keydown',
            'keyup',
        ])
            f.input().dispatchEvent(
                new f.window.Event(type, { bubbles: true })
            );
    });
    assert.equal(rows, 0);
    assert.equal(submits, 0);
});

it('limits deliberate edits without changing loaded data or splitting surrogate pairs', async (t) => {
    const f = await fixture(t, { characterLimit: 3 }, 'Already longer');
    await f.render(h(TextField, { binding: f.binding }));
    assert.equal(f.input().value, 'Already longer');
    assert.equal(f.writes(), 0);
    await f.edit('ab😀');
    assert.equal(f.binding.getSnapshot().value, 'ab');
    await f.edit('😀aX');
    assert.equal(f.binding.getSnapshot().value, '😀a');
    for (const limit of [-1, 1.5, NaN, Infinity]) {
        await f.render(
            renderSingleLineTextField({
                ...f.props(),
                displayConfig: { characterLimit: limit },
                writeConfig: {},
            })
        );
        assert.equal(f.input().hasAttribute('maxlength'), false);
    }
    await f.render(
        renderSingleLineTextField({
            ...f.props(),
            displayConfig: { characterLimit: 8 },
            writeConfig: { characterLimit: 2 },
        })
    );
    assert.equal(f.input().maxLength, 2);
    await f.render(
        renderSingleLineTextField({
            ...f.props(),
            displayConfig: { characterLimit: 0 },
            writeConfig: {},
        })
    );
    await f.edit('x');
    assert.equal(f.binding.getSnapshot().value, null);
});

it('masks either configuration surface and preserves hidden-title accessibility and custom rendering', async (t) => {
    const f = await fixture(
        t,
        { obscurePassword: true, showTitle: false, title: 'Secret' },
        'private'
    );
    await f.render(h(TextField, { binding: f.binding, clearLabel: 'Effacer' }));
    assert.equal(f.input().type, 'password');
    assert.equal(f.input().getAttribute('aria-label'), 'Secret');
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(
        f.container.querySelector('button')!.getAttribute('aria-label'),
        'Effacer'
    );
    for (const which of ['displayConfig', 'writeConfig'] as const) {
        for (const mask of [
            { obscurePassword: true },
            { maskPasswordOnLoginScreen: true },
        ]) {
            await f.render(
                renderSingleLineTextField(
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
            assert.equal(f.input().getAttribute('aria-label'), 'Title');
            assert.equal(
                f.container.querySelector('button')!.getAttribute('aria-label'),
                'Clear Title'
            );
        }
    }
    await f.render(
        h(TextField, {
            binding: f.binding,
            render: ({ snapshot }) =>
                h('output', null, snapshot.dirty ? 'edited' : 'custom'),
        })
    );
    assert.equal(f.container.textContent, 'custom');
});

it('read-only/missing capability, pending and computed controls cannot write or navigate', async (t) => {
    const f = await fixture(t, {}, 'https://example.test');
    for (const override of [
        { capability: { type: 'readonly' as const } },
        { pending: true },
        { computed: true },
        { displayConfig: { readOnly: true } },
        { writeConfig: { readOnly: true } },
    ]) {
        await f.render(
            renderSingleLineTextField({ ...f.props(), ...override })
        );
        assert.equal(f.input().disabled, true);
        assert.equal(f.container.querySelector('button')!.disabled, true);
        assert.equal(f.container.querySelector('a'), null);
        await f.edit('Rejected');
        assert.equal(f.binding.getSnapshot().value, 'https://example.test');
    }
    assert.equal(f.writes(), 0);
    await f.render(
        renderSingleLineTextField({
            ...f.props(),
            error: '',
            validation: [
                {
                    fieldId: 'fld_title',
                    fieldTitle: 'Title',
                    errorMessage: 'Do not replace empty feedback',
                },
            ],
        })
    );
    assert.equal(f.container.querySelector('[role=status]')!.textContent, '');
    await f.render(
        renderSingleLineTextField({
            ...f.props(),
            validation: [
                {
                    fieldId: 'fld_title',
                    fieldTitle: 'Title',
                    errorMessage: 'Configured error',
                },
            ],
        })
    );
    assert.equal(
        f.container.querySelector('[role=status]')!.textContent,
        'Configured error'
    );
});

it('retained slot actions reject stale context; hidden and retired bindings remove controls', async (t) => {
    const f = await fixture(t, {}, 'Original');
    await f.render(renderSingleLineTextField(f.props()));
    f.scope.revision++;
    await f.edit('Stale');
    assert.equal(f.binding.getSnapshot().value, 'Original');
    assert.equal(f.input().value, 'Original');
    await act(async () => f.container.querySelector('button')!.click());
    assert.equal(f.binding.getSnapshot().value, 'Original');
    await f.render(h(TextField, { binding: f.binding }));
    await act(async () => {
        f.scope.visible = false;
        f.owner.refresh();
    });
    assert.equal(f.container.querySelector('input'), null);
    await act(async () => f.owner.destroy());
    assert.equal(f.container.querySelector('input'), null);
});

it('buffers IME until completion, applies the cap once and ignores the trailing duplicate input', async (t) => {
    const f = await fixture(t, { characterLimit: 3 });
    await f.render(h(TextField, { binding: f.binding }));
    await f.composition('compositionstart');
    await f.edit('にほんご');
    assert.equal(f.input().value, 'にほんご');
    assert.equal(f.input().hasAttribute('maxlength'), false);
    assert.equal(f.binding.getSnapshot().value, null);
    assert.equal(f.writes(), 0);
    await f.composition('compositionend', '日本語文');
    assert.equal(f.binding.getSnapshot().value, '日本語');
    assert.equal(f.input().value, '日本語');
    assert.equal(f.writes(), 1);
    await f.edit('日本語文');
    assert.equal(f.binding.getSnapshot().value, '日本語');
    assert.equal(f.writes(), 1);
    await f.edit('新');
    assert.equal(f.binding.getSnapshot().value, '新');
    assert.equal(f.writes(), 2);
});

it('owner/config/value replacements cancel composition, including observed ABA, without writing either owner', async (t) => {
    const f = await fixture(t, {}, 'Base');
    const props = f.props();
    for (const replacement of [
        { value: 'Replacement' },
        { pending: true },
        { displayConfig: { obscurePassword: true } },
        { displayConfig: { characterLimit: 2 } },
        {
            capability: {
                type: 'editable' as const,
                setValue: () => {
                    throw Error('Successor cannot inherit composition');
                },
            },
        },
    ]) {
        await f.render(renderSingleLineTextField(props));
        await f.composition('compositionstart');
        await f.edit('unfinished');
        await f.render(renderSingleLineTextField({ ...props, ...replacement }));
        await f.render(renderSingleLineTextField(props));
        await f.composition('compositionend', 'Late text');
        await f.edit('Late text');
        assert.equal(f.binding.getSnapshot().value, 'Base');
        assert.equal(f.input().value, 'Base');
        assert.equal(f.writes(), 0);
    }
});

it('remounting discards unfinished composition without changing the accepted native draft', async (t) => {
    const f = await fixture(t, {}, 'Base');
    await f.render(h(TextField, { binding: f.binding }));
    await f.composition('compositionstart');
    await f.edit('unfinished');
    await f.render(null);
    await f.render(h(TextField, { binding: f.binding }));
    assert.equal(f.input().value, 'Base');
    assert.equal(f.writes(), 0);
    await f.composition('compositionend', 'Late');
    assert.equal(f.binding.getSnapshot().value, 'Base');
});

it('the accepted slot preserves absent values in every Form/Portal context without triggering optional integrations', async (t) => {
    const f = await fixture(t);
    for (const context of [
        'form',
        'portal-cell',
        'portal-detail',
        'linked-detail',
    ] as const) {
        const props: FieldRendererProps<'singleLineText'> = {
            ...f.props(),
            value: undefined,
            context,
            displayConfig: {
                enableAddressAutocomplete: true,
                enableQRCodeScannerForFormField: true,
                autoStartCamera: true,
                autoSubmitFormAfterScan: true,
                displayAsButton: true,
                displayAsAttachments: true,
            },
        };
        await f.render(renderSingleLineTextField(props));
        assert.equal(f.input().value, '');
        assert.equal(f.container.querySelector('a, iframe, video'), null);
    }
    assert.equal(f.writes(), 0);
});
