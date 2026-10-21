import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    createRef,
    type ReactNode,
} from 'react';
import {
    RatingField,
    RatingInput,
    FieldRenderer,
    renderRatingField,
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
    config: FieldConfig<'rating'> = {},
    initial: number | null | undefined = undefined
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
    loaded.payload.fieldIdsInForm.push('rating');
    if (initial !== undefined) loaded.payload.formRecord.data.rating = initial;
    loaded.payload.fieldIdsToSchemas.rating = {
        fieldType: 'rating',
        airtableField: {
            id: 'rating',
            name: 'Quantity',
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
        getScope: () => ({ ownerId: 'number-test', revision: 0 }),
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
                throw Error('Number props expected');
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

const icon = ({
    index,
    filled,
    focused,
    activate,
}: import('../src/react/RatingInput.js').RatingIconState) =>
    h('svg', {
        'aria-hidden': true,
        'data-index': index,
        'data-filled': String(filled),
        'data-focused': String(focused),
        onClick: activate,
    });

it('reuses controlled native range/ref/form/ARIA and decorative icons for selection, toggle-clear and keyboard-zero intent', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLInputElement>();
    const values: (number | null)[] = [];
    const view = (value: number | null) =>
        h(
            'div',
            null,
            h('form', { id: 'host-rating' }),
            h(RatingInput, {
                ref,
                value,
                max: 5,
                onChange: (value) => {
                    values.push(value);
                },
                renderIcon: icon,
                inputProps: {
                    id: 'rating',
                    form: 'host-rating',
                    'aria-describedby': 'help',
                    'aria-invalid': true,
                    className: 'range-style',
                },
                className: 'root-style',
                iconsClassName: 'icons-style',
            })
        );
    await f.render(view(2));
    assert.equal(ref.current, f.input());
    assert.equal(f.input().type, 'range');
    assert.equal(f.input().form?.id, 'host-rating');
    assert.equal(f.input().getAttribute('min'), '1');
    assert.equal(f.input().getAttribute('max'), '5');
    assert.equal(f.input().getAttribute('aria-describedby'), 'help');
    assert.equal(f.input().getAttribute('aria-invalid'), 'true');
    assert.equal(f.input().className, 'range-style');
    const icons = () => f.container.querySelectorAll('svg');
    assert.equal(icons().length, 5);
    assert.equal(icons()[0]!.parentElement?.className, 'icons-style');
    assert.equal(icons()[0]!.getAttribute('data-filled'), 'true');
    assert.equal(icons()[2]!.getAttribute('data-filled'), 'false');
    await act(async () =>
        icons()[3]!.dispatchEvent(
            new f.window.MouseEvent('click', { bubbles: true })
        )
    );
    assert.deepEqual(values, [4]);
    assert.equal(f.window.document.activeElement, f.input());
    await f.render(view(4));
    await act(async () =>
        icons()[3]!.dispatchEvent(
            new f.window.MouseEvent('click', { bubbles: true })
        )
    );
    assert.deepEqual(values, [4, null]);
    f.input().removeAttribute('min');
    await f.edit('0');
    assert.equal(values.at(-1), null);
    await f.render(null);
    assert.equal(ref.current, null);
});

it('keeps explicit maximum repair and feedback descriptive, never submits a parent form or repairs on mount', async (t) => {
    const f = await fixture(t);
    const values: (number | null)[] = [];
    let submits = 0;
    await f.render(
        h(
            'form',
            {
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    submits++;
                },
            },
            h(RatingInput, {
                value: 8,
                max: 3,
                onChange: (value) => {
                    values.push(value);
                },
                warningId: 'warning',
                feedback: 'Validation',
                inputProps: { 'aria-describedby': 'help' },
            })
        )
    );
    assert.equal(values.length, 0);
    assert.match(f.container.querySelector('p')!.textContent!, /8\/3/);
    assert.equal(
        f
            .input()
            .getAttribute('aria-describedby')
            ?.split(' ')
            .slice(0, 2)
            .join(' '),
        'help warning'
    );
    const button = f.container.querySelector('button');
    assert(button);
    assert.equal(button.type, 'button');
    await act(async () => button.click());
    assert.deepEqual(values, [3]);
    assert.equal(submits, 0);
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Validation'
    );
});

it('preserves native focus/blur callbacks, current icon focus and readonly/grid/empty presentation without writes', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLInputElement>();
    let writes = 0;
    let focus = 0;
    let blur = 0;
    const view = (value: number | null, disabled = false, grid = false) =>
        h(RatingInput, {
            ref,
            value,
            max: 4,
            disabled,
            grid,
            onChange: () => {
                writes++;
            },
            renderIcon: icon,
            empty: h('span', null, 'Empty'),
            gridSummaryClassName: 'sr-only',
            printSummaryClassName: 'print-summary',
            inputProps: {
                onFocus: () => {
                    focus++;
                },
                onBlur: () => {
                    blur++;
                },
            },
        });
    await f.render(view(2));
    await act(async () => f.input().focus());
    assert.equal(focus, 1);
    assert.equal(
        f.container
            .querySelector('[data-index="2"]')
            ?.getAttribute('data-focused'),
        'true'
    );
    await act(async () => f.input().blur());
    assert.equal(blur, 1);
    await f.render(view(2, true, true));
    assert.equal(ref.current, null);
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.container.querySelector('.sr-only')?.textContent, '(2/4)');
    assert.equal(f.container.querySelector('.print-summary'), null);
    await act(async () =>
        f.container
            .querySelector('svg')!
            .dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(writes, 0);
    await f.render(view(null, true));
    assert.equal(f.container.querySelectorAll('svg').length, 0);
    assert.match(f.container.textContent!, /Empty/);
    assert.equal(ref.current, f.input());
    assert(f.input().disabled);
    assert.equal(writes, 0);
});

it('replaces maximum/value/icon presentation in one mount and never normalizes out-of-range data implicitly', async (t) => {
    const f = await fixture(t);
    const values: (number | null)[] = [];
    await f.render(
        h(RatingInput, {
            value: 8,
            max: 10,
            onChange: (value) => {
                values.push(value);
            },
            renderIcon: icon,
        })
    );
    assert.equal(f.container.querySelectorAll('svg').length, 10);
    await f.render(
        h(RatingInput, {
            value: 8,
            max: 3,
            onChange: (value) => {
                values.push(value);
            },
            renderIcon: (state) =>
                h('svg', {
                    'data-replaced': state.index,
                    onClick: state.activate,
                }),
        })
    );
    assert.equal(f.container.querySelectorAll('[data-replaced]').length, 3);
    assert.equal(values.length, 0);
    await f.render(
        h(RatingInput, {
            value: 8,
            max: 3,
            disabled: true,
            onChange: (value) => {
                values.push(value);
            },
            renderIcon: icon,
        })
    );
    assert.equal(f.container.querySelector('button'), null);
    await f.edit('1');
    assert.equal(values.length, 0);
});

it('keeps default SDK numeric rating editing and opts real binding/slot owners into the shared icon control', async (t) => {
    const f = await fixture(t, {}, 2);
    await f.render(h(RatingField, { binding: f.binding }));
    assert.equal(f.input().type, 'text');
    await f.render(
        h(RatingField, { binding: f.binding, iconInput: { renderIcon: icon } })
    );
    assert.equal(f.input().type, 'range');
    assert.equal(f.container.querySelectorAll('svg').length, 5);
    assert.equal(f.binding.getSnapshot().value, 2);
    await act(async () =>
        f.container
            .querySelector('[data-index="4"]')!
            .dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(f.binding.getSnapshot().value, 4);
    await f.render(
        renderRatingField(f.props(), {
            iconInput: {
                renderIcon: icon,
                grid: true,
                gridSummaryClassName: 'sr-only',
            },
        })
    );
    assert.equal(f.container.querySelector('.sr-only')?.textContent, '(4/5)');
    assert.equal(f.container.querySelector('input'), null);
    f.scope.writable = false;
    await f.render(
        renderRatingField(f.props(), { iconInput: { renderIcon: icon } })
    );
    await act(async () =>
        f.container
            .querySelector('[data-index="1"]')!
            .dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(f.binding.getSnapshot().value, 4);
});

it('does not revive captured icon callbacks across readonly or props A-to-B-to-A replacement and unmount', async (t) => {
    const f = await fixture(t);
    let activate: (() => void) | undefined;
    const values: (number | null)[] = [];
    const view = (disabled = false) =>
        h(RatingInput, {
            value: 8,
            max: 5,
            disabled,
            onChange: (value) => {
                values.push(value);
            },
            renderIcon: (state) => {
                activate = state.activate;
                return icon(state);
            },
        });
    const first = view();
    await f.render(first);
    const oldActivate = activate!;
    await f.render(view(true));
    await f.render(first);
    await act(async () => {
        oldActivate();
    });
    assert.equal(values.length, 0);
    const live = activate!;
    await act(async () => live());
    assert.deepEqual(values, [5]);
    const after = activate!;
    await f.render(null);
    await act(async () => {
        after();
    });
    assert.deepEqual(values, [5]);
});

it('retains owner masking instead of exposing icon or numeric summaries in either opt-in API', async (t) => {
    const f = await fixture(t, { maskPasswordOnLoginScreen: true }, 4);
    await f.render(
        h(RatingField, {
            binding: f.binding,
            iconInput: { renderIcon: icon, grid: true },
        })
    );
    assert.equal(f.input().type, 'password');
    assert.equal(f.container.querySelector('svg'), null);
    assert.doesNotMatch(f.container.textContent!, /4\/5/);
    await f.render(
        renderRatingField(
            {
                ...f.props(),
                displayConfig: {},
                writeConfig: { maskPasswordOnLoginScreen: true },
            },
            { iconInput: { renderIcon: icon, grid: true } }
        )
    );
    assert.equal(f.input().type, 'password');
    assert.equal(f.container.querySelector('svg'), null);
    assert.doesNotMatch(f.container.textContent!, /4\/5/);
    assert.equal(f.binding.getSnapshot().value, 4);
});

it('keeps accepted rating field interactions inside the field host while public native controls still bubble normally', async (t) => {
    const f = await fixture(t, {}, 2);
    let opens = 0;
    const surrounding = (node: ReactNode) =>
        h(
            'div',
            {
                onClick: () => {
                    opens++;
                },
                onKeyDown: () => {
                    opens++;
                },
            },
            node
        );
    await f.render(
        surrounding(
            h(RatingInput, {
                value: 2,
                max: 5,
                onChange: () => {},
                renderIcon: icon,
            })
        )
    );
    await act(async () =>
        f.container
            .querySelector('svg')!
            .dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(opens, 1);
    opens = 0;
    await f.render(
        surrounding(
            h(RatingField, {
                binding: f.binding,
                iconInput: { renderIcon: icon },
            })
        )
    );
    await act(async () =>
        f.container
            .querySelector('[data-index="4"]')!
            .dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(opens, 0);
    assert.equal(f.binding.getSnapshot().value, 4);
    await f.render(
        surrounding(
            renderRatingField(f.props(), { iconInput: { renderIcon: icon } })
        )
    );
    await act(async () =>
        f.input().dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowLeft',
                bubbles: true,
            })
        )
    );
    assert.equal(opens, 0);
});

it('retains native absence until explicit intent and carries accepted required policy through both icon APIs', async (t) => {
    const f = await fixture(t, { required: true });
    await f.render(
        h(RatingField, {
            binding: f.binding,
            iconInput: {
                renderIcon: icon,
                inputProps: { 'aria-required': false },
            },
        })
    );
    assert.equal(f.binding.getSnapshot().value, undefined);
    assert.equal(f.binding.getSnapshot().dirty, false);
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    await f.render(
        renderRatingField(f.props(), {
            iconInput: {
                renderIcon: icon,
                inputProps: { 'aria-required': false },
            },
        })
    );
    assert.equal(f.input().getAttribute('aria-required'), 'true');
    assert.equal(f.binding.getSnapshot().value, undefined);
    assert.equal(f.binding.getSnapshot().dirty, false);
    await act(async () =>
        f.container
            .querySelector('[data-index="1"]')!
            .dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(f.binding.getSnapshot().value, 1);
    assert.equal(f.binding.getSnapshot().dirty, true);
});
