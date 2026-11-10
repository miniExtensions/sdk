import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CompleteSingleCollaboratorField,
    CompleteMultipleCollaboratorsField,
    type CompleteCollaborator,
    type CompleteSingleCollaboratorFieldProps,
} from '../src/react/index.js';

type Person = CompleteCollaborator & { native: { marker: string } };
type Common = Omit<
    CompleteSingleCollaboratorFieldProps<Person>,
    'value' | 'onValueChange'
>;
type NativeValue = Person | null | Person[];
type FixtureState = {
    multiple: boolean;
    single: Person | null;
    many: readonly Person[];
    choices: readonly Person[];
    owner: object;
    current: boolean;
    accept: boolean;
    throwing: Error | undefined;
    authority: (() => boolean) | undefined;
    target: string;
    props: Partial<Common>;
};

const first: Person = Object.freeze({
    id: 'usr-first',
    name: 'Alice Arbor',
    email: 'alice@example.invalid',
    profilePicUrl: 'https://avatars.example.invalid/alice.png',
    native: Object.freeze({ marker: 'original-first' }),
});
const second: Person = Object.freeze({
    id: 'usr-second',
    name: 'Bruno Birch',
    email: 'bruno@example.invalid',
    native: Object.freeze({ marker: 'original-second' }),
});
const retired: Person = Object.freeze({
    id: 'usr-retired',
    name: 'Retained Cedar',
    email: 'retired@example.invalid',
    native: Object.freeze({ marker: 'stored-but-unoffered' }),
});
const personLabel = (person: Person) => person.name || person.email;
const labels = {
    placeholder: 'Choisir un collaborateur',
    availableOptions: 'Collaborateurs disponibles',
    noMatches: 'Aucun résultat',
    empty: 'Aucun collaborateur',
    open: 'Afficher les collaborateurs',
    remove: (label: string) => `Supprimer ${label}`,
};

/** Real public controls and real Headless UI/Fuse, with only a browser platform. */
async function fixture(
    t: TestContext,
    args: {
        multiple?: boolean;
        value?: Person | readonly Person[] | null;
        choices?: readonly Person[];
        props?: Partial<Common>;
        /** Let a cold-runtime scenario arrange real synchronous commits first. */
        deferInitialRender?: boolean;
    } = {}
) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'Window',
        'Document',
        'DocumentFragment',
        'EventTarget',
        'Node',
        'NodeFilter',
        'Element',
        'HTMLElement',
        'SVGElement',
        'ShadowRoot',
        'Event',
        'CustomEvent',
        'MouseEvent',
        'PointerEvent',
        'KeyboardEvent',
        'FocusEvent',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'HTMLSelectElement',
        'HTMLAnchorElement',
        'HTMLIFrameElement',
        'HTMLButtonElement',
        'HTMLFieldSetElement',
        'HTMLLegendElement',
        'HTMLFormElement',
        'MutationObserver',
        'ResizeObserver',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'getComputedStyle',
        'IS_REACT_ACT_ENVIRONMENT',
        'fetch',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let requests = 0;
    const refuseRequest = async () => {
        requests++;
        throw new Error('Collaborator picker must not discover identities');
    };
    Object.defineProperty(window, 'fetch', { value: refuseRequest });
    for (const key of keys) {
        const value =
            key === 'IS_REACT_ACT_ENVIRONMENT'
                ? true
                : key === 'fetch'
                  ? refuseRequest
                  : key === 'Window'
                    ? Window
                    : key === 'requestAnimationFrame'
                      ? window.requestAnimationFrame.bind(window)
                      : key === 'cancelAnimationFrame'
                        ? window.cancelAnimationFrame.bind(window)
                        : key === 'getComputedStyle'
                          ? window.getComputedStyle.bind(window)
                          : window[key as keyof Window];
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const form = window.document.createElement('form');
    form.id = 'collaborator-form';
    const help = window.document.createElement('p');
    help.id = 'collaborator-help';
    help.textContent = 'Choose from the supplied people';
    const error = window.document.createElement('p');
    error.id = 'collaborator-error';
    error.textContent = 'Synthetic field feedback';
    const container = window.document.createElement('div');
    const adjacent = window.document.createElement('input');
    adjacent.setAttribute('aria-label', 'Adjacent field');
    adjacent.value = 'Keep adjacent dirty value';
    form.append(help, error, container, adjacent);
    window.document.body.append(form);
    let root = createRoot(container as unknown as HTMLElement);
    let mounted = true;
    let submits = 0;
    const parentEvents: string[] = [];
    for (const name of [
        'click',
        'auxclick',
        'dblclick',
        'pointerdown',
        'keydown',
        'keyup',
    ])
        form.addEventListener(name, (event) => {
            if (
                event.target instanceof window.Node &&
                container.contains(event.target)
            )
                parentEvents.push(name);
        });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const reported: unknown[] = [];
    window.addEventListener('error', (event) => {
        if (event instanceof window.ErrorEvent) reported.push(event.error);
        event.preventDefault();
    });
    const initial = args.value ?? null;
    const state: FixtureState = {
        multiple: args.multiple === true,
        single: Array.isArray(initial) ? null : (initial as Person | null),
        many: Array.isArray(initial) ? initial : [],
        choices: args.choices ?? [first, second],
        owner: {},
        current: true,
        accept: true,
        throwing: undefined,
        authority: undefined,
        target: 'session-A/record-A/field-collaborator',
        props: {
            inputId: 'collaborator-input',
            formId: form.id,
            title: 'Assigned collaborator',
            describedBy: `${help.id} ${error.id}`,
            invalid: false,
            labels,
            ...args.props,
        },
    };
    const invocations: {
        value: NativeValue;
        target: string;
        owner: object;
    }[] = [];
    const publish = () => {
        if (!mounted) return;
        const owner = state.owner;
        const target = state.target;
        const common: Common = {
            ...state.props,
            choices: state.choices,
            owner: {
                token: owner,
                isCurrent: () =>
                    state.authority?.() ??
                    (state.current && state.owner === owner),
            },
        };
        const write = (value: NativeValue) => {
            // Record before refusal: negative cases must prove no writer call.
            invocations.push({ value, target, owner });
            if (state.throwing) throw state.throwing;
            if (!state.accept) return;
            if (state.multiple) {
                assert.ok(Array.isArray(value));
                state.many = value;
            } else {
                assert.ok(!Array.isArray(value));
                state.single = value;
            }
            publish();
        };
        const control = state.multiple
            ? h(CompleteMultipleCollaboratorsField<Person>, {
                  ...common,
                  value: state.many,
                  onValueChange: write,
              })
            : h(CompleteSingleCollaboratorField<Person>, {
                  ...common,
                  value: state.single,
                  onValueChange: write,
              });
        root.render(h(StrictMode, null, control));
    };
    const writableControlIsReady = () => {
        if (
            !mounted ||
            state.props.visible === false ||
            state.props.readOnly ||
            state.props.disabled
        )
            return true;
        if (state.multiple || state.single == null) {
            const control = container.querySelector('input');
            return Boolean(
                control &&
                    control.getAttribute('role') === 'combobox' &&
                    !control.disabled &&
                    control.getAttribute('aria-disabled') !== 'true'
            );
        }
        // Native single cardinality hides its picker once one value is stored.
        // Its enabled removal control is the observable interactive readiness.
        const name =
            state.props.labels?.remove?.(personLabel(state.single)) ??
            `Remove collaborator ${personLabel(state.single)}`;
        return Array.from(container.querySelectorAll('button')).some(
            (control) =>
                !control.disabled &&
                (control.getAttribute('aria-label') === name ||
                    control.textContent === name)
        );
    };
    const ready = async () => {
        // Match the existing lazy Rich Text fixture: yield to real module/effect
        // work while observing the actual control, never replace the runtime or
        // extend a fixed sleep. Readonly/static output needs no browser runtime.
        for (let turn = 0; turn < 100; turn++) {
            if (writableControlIsReady()) return;
            await act(async () => {
                await new Promise<void>((resolve) => setImmediate(resolve));
            });
        }
        assert.ok(
            writableControlIsReady(),
            'The actual enabled collaborator control did not finish mounting'
        );
    };
    const render = async () => {
        await act(async () => publish());
        await ready();
    };
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node, 'the complete field must render its own combobox');
        assert.equal(node.getAttribute('role'), 'combobox');
        return node;
    };
    const options = () =>
        Array.from(window.document.querySelectorAll('[role="option"]')).filter(
            (node): node is InstanceType<Window['HTMLElement']> =>
                node instanceof window.HTMLElement
        );
    const option = (person: Person) => {
        const node = options().find((node) =>
            node.textContent.includes(person.email)
        );
        assert.ok(node, `offered option ${person.email} must be rendered`);
        return node;
    };
    const button = (name: string) => {
        const node = Array.from(container.querySelectorAll('button')).find(
            (node) =>
                node.getAttribute('aria-label') === name ||
                node.textContent === name
        );
        assert.ok(node, `accessible button ${name} must be rendered`);
        return node;
    };
    const removal = (person: Person) =>
        button(labels.remove(personLabel(person)));
    const frame = async () => {
        // Settle the actual popup library's animation-frame focus continuation.
        await act(async () => {
            await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve())
            );
        });
        await ready();
    };
    const focus = async () => {
        await act(async () => input().focus());
    };
    const key = async (name: string) => {
        const node = input();
        const codes: Record<string, number> = {
            ArrowDown: 40,
            ArrowUp: 38,
            Enter: 13,
            Escape: 27,
            Backspace: 8,
        };
        const event = new window.KeyboardEvent('keydown', {
            key: name,
            code: name,
            keyCode: codes[name] ?? 0,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            node.dispatchEvent(event);
            node.dispatchEvent(
                new window.KeyboardEvent('keyup', {
                    key: name,
                    code: name,
                    bubbles: true,
                })
            );
        });
        await frame();
        return event;
    };
    const search = async (text: string) => {
        await focus();
        const node = input();
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(node, text);
            node.dispatchEvent(
                new window.InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: text,
                })
            );
        });
        await frame();
    };
    type DomElement = ReturnType<Window['document']['createElement']>;
    const pointer = async (node: DomElement) => {
        await act(async () => {
            node.dispatchEvent(
                new window.PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    pointerType: 'mouse',
                    button: 0,
                })
            );
            node.dispatchEvent(
                new window.MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                })
            );
            node.dispatchEvent(
                new window.PointerEvent('pointerup', {
                    bubbles: true,
                    pointerType: 'mouse',
                    button: 0,
                })
            );
            node.dispatchEvent(
                new window.MouseEvent('mouseup', { bubbles: true, button: 0 })
            );
            node.click();
        });
        await frame();
    };
    const keyboardRemove = async (person: Person) => {
        const node = removal(person);
        await act(async () => node.focus());
        await act(async () => {
            const event = new window.KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                bubbles: true,
                cancelable: true,
            });
            node.dispatchEvent(event);
            // HappyDOM lacks a trusted button's Enter activation default.
            if (!event.defaultPrevented) node.click();
            node.dispatchEvent(
                new window.KeyboardEvent('keyup', {
                    key: 'Enter',
                    code: 'Enter',
                    bubbles: true,
                })
            );
        });
        await frame();
    };
    const open = async () => {
        await focus();
        await key('ArrowDown');
    };
    const unmountNow = () => {
        if (!mounted) return;
        mounted = false;
        root.unmount();
    };
    const unmount = async () => {
        await act(async () => unmountNow());
    };
    t.after(async () => {
        try {
            await unmount();
            assert.equal(submits, 0, 'collaborator controls must not submit');
            assert.equal(adjacent.value, 'Keep adjacent dirty value');
            assert.equal(
                requests,
                0,
                'no collaborator identity/backend lookup'
            );
            assert.deepEqual(parentEvents, [], 'field gestures remain bounded');
        } finally {
            keys.forEach((key, index) => {
                const before = originals[index];
                if (before) Object.defineProperty(globalThis, key, before);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    if (!args.deferInitialRender) await render();
    return {
        window,
        form,
        container,
        adjacent,
        state,
        invocations,
        reported,
        flushSync,
        publish,
        ready,
        render,
        input,
        options,
        option,
        button,
        removal,
        key,
        open,
        search,
        pointer,
        keyboardRemove,
        async focusAdjacent() {
            await pointer(adjacent);
            await act(async () => adjacent.focus());
        },
        unmount,
        unmountNow,
        async remount() {
            assert.equal(mounted, false);
            root = createRoot(container as unknown as HTMLElement);
            mounted = true;
            await render();
        },
        count: () => invocations.length,
    };
}

it('server-renders readonly native occurrences literally without a DOM, writer or avatar request', () => {
    assert.equal(typeof document, 'undefined');
    const literal = { ...first, name: '<script>literal</script>' };
    let writes = 0;
    const common = {
        choices: [],
        owner: { token: {}, isCurrent: () => true },
        readOnly: true,
        labels,
        onValueChange: () => writes++,
    };
    const html = renderToStaticMarkup(
        h(
            'div',
            null,
            h(CompleteSingleCollaboratorField<Person>, {
                ...common,
                value: literal,
            }),
            h(CompleteMultipleCollaboratorsField<Person>, {
                ...common,
                value: [literal, retired, literal],
            })
        )
    );
    assert.match(html, /&lt;script&gt;literal&lt;\/script&gt;/);
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img'));
    assert.ok(!html.includes('<button'));
    assert.ok(!html.includes('role="combobox"'));
    assert.equal(writes, 0);
    assert.equal(typeof document, 'undefined');
});

// Keep this before every editable mount: it needs the actual first runtime load,
// not an injected promise, reset module, patched import or fake picker.
it('accepted cold removal does not reclaim focus after an adjacent-to-body focus ABA', async (t) => {
    const f = await fixture(t, { value: first, deferInitialRender: true });
    const body = f.window.document.body;
    body.tabIndex = -1;
    act(() => {
        body.focus();
        assert.equal(f.window.document.activeElement, body);
        f.flushSync(() => f.publish());
        assert.ok(f.removal(first));
        f.flushSync(() => f.removal(first).click());
        assert.equal(f.count(), 1);
        assert.equal(f.invocations[0]?.value, null);
        assert.equal(f.state.single, null);

        // All arrangement stays in this JavaScript stack: the real lazy module
        // cannot fulfill between removal and these observed focus transitions.
        const loading = f.container.querySelector('input');
        assert.ok(loading, 'accepted removal exposes the actual loading input');
        assert.equal(loading.disabled, true);
        assert.equal(loading.getAttribute('aria-busy'), 'true');
        assert.equal(f.container.querySelector('[role="combobox"]'), null);
        assert.equal(f.window.document.activeElement, body);
        f.adjacent.focus();
        assert.equal(f.window.document.activeElement, f.adjacent);
        body.focus();
        assert.equal(f.window.document.activeElement, body);
    });
    await f.ready();
    assert.equal(f.input().disabled, false);
    assert.equal(f.window.document.activeElement, body);
    assert.equal(f.count(), 1);
    assert.equal(f.container.querySelector('li'), null);
});

it('single keyboard selection/removal/reselection publishes original objects and null with controlled focus', async (t) => {
    const f = await fixture(t);
    const original = f.input();
    assert.equal(original.id, 'collaborator-input');
    assert.equal(original.getAttribute('form'), f.form.id);
    assert.equal(original.form, f.form);
    assert.equal(
        original.getAttribute('aria-describedby'),
        'collaborator-help collaborator-error'
    );
    assert.equal(original.placeholder, labels.placeholder);
    assert.equal(f.button(labels.open).type, 'button');
    assert.equal(f.button(labels.open).form, f.form);
    assert.equal(
        f.container.querySelector('label')?.getAttribute('for'),
        original.id
    );
    await f.search(first.email.toUpperCase());
    assert.equal(f.options().length, 1);
    await f.key('ArrowDown');
    const selectionKey = await f.key('Enter');
    assert.equal(selectionKey.defaultPrevented, true);
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, first);
    assert.equal(f.state.single, first);
    assert.equal(f.container.querySelector('[role="combobox"]'), null);
    assert.equal(f.window.document.activeElement, f.removal(first));
    await f.keyboardRemove(first);
    assert.equal(f.count(), 2);
    assert.equal(f.invocations[1]?.value, null);
    assert.equal(f.state.single, null);
    assert.equal(f.window.document.activeElement, f.input());
    await f.search(second.email);
    await f.key('ArrowDown');
    await f.key('Enter');
    assert.equal(f.count(), 3);
    assert.equal(f.invocations[2]?.value, second);
    assert.equal(f.window.document.activeElement, f.removal(second));
});

it('single pointer selection/removal uses the same complete picker and never submits', async (t) => {
    const f = await fixture(t);
    await f.search(second.email);
    await f.pointer(f.option(second));
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, second);
    assert.equal(f.window.document.activeElement, f.removal(second));
    assert.equal(f.removal(second).type, 'button');
    assert.equal(f.removal(second).form, f.form);
    await f.pointer(f.removal(second));
    assert.equal(f.count(), 2);
    assert.equal(f.invocations[1]?.value, null);
    assert.equal(f.window.document.activeElement, f.input());
});

it('empty-input pointer opening and focused reopening retain the offered rows without proposing a value', async (t) => {
    const f = await fixture(t);
    const input = f.input();
    assert.equal(input.value, '');
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(f.options().length, 0);

    await f.pointer(input);
    assert.equal(f.input(), input);
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
        f.options().map((option) => option.textContent),
        [first, second].map((person) => person.name + person.email)
    );
    assert.equal(input.value, '');
    assert.equal(f.state.single, null);
    assert.equal(f.count(), 0);
    assert.equal(f.window.document.activeElement, input);

    await f.key('Escape');
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(f.options().length, 0);
    assert.equal(f.window.document.activeElement, input);

    // Focus did not change: reopening must follow the actual input click,
    // rather than depending only on an on-focus or query-change handler.
    await f.pointer(input);
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
        f.options().map((option) => option.textContent),
        [first, second].map((person) => person.name + person.email)
    );
    assert.equal(input.value, '');
    assert.equal(f.state.single, null);
    assert.equal(f.count(), 0);

    await f.pointer(f.option(second));
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, second);
    assert.equal(f.state.single, second);
    assert.equal(f.window.document.activeElement, f.removal(second));
});

it('mouse use of the arrow preserves focused input reopening and Space typing before keyboard selection', async (t) => {
    const f = await fixture(t);
    const input = f.input();
    await f.pointer(f.button(labels.open));
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(f.options().length, 2);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(input.value, '');
    assert.equal(f.state.single, null);
    assert.equal(f.count(), 0);

    await f.key('Escape');
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(f.window.document.activeElement, input);
    await f.pointer(input);
    assert.equal(f.input(), input);
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    assert.equal(f.options().length, 2);
    assert.equal(input.value, '');
    assert.equal(f.state.single, null);
    assert.equal(f.count(), 0);

    const space = await f.key(' ');
    assert.equal(space.defaultPrevented, false);
    // HappyDOM does not insert a character as a keydown default. Exercise the
    // real native input/change path with the name containing that space.
    await f.search(first.name);
    assert.equal(input.value, first.name);
    assert.equal(f.options().length, 1);
    assert.equal(f.option(first).textContent, first.name + first.email);
    assert.equal(f.count(), 0);
    await f.key('ArrowDown');
    await f.key('Enter');
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, first);
    assert.equal(f.state.single, first);
    assert.equal(f.window.document.activeElement, f.removal(first));
});

for (const presentation of [
    'selected-single',
    'readonly-single',
    'readonly-multiple',
] as const)
    it(`${presentation} retains a rendered field group associated with its actual title, help and error nodes`, async (t) => {
        const multiple = presentation === 'readonly-multiple';
        const f = await fixture(t, {
            multiple,
            value: multiple ? [first, retired] : first,
            props: {
                readOnly: presentation !== 'selected-single',
                invalid: true,
            },
        });
        assert.equal(f.container.querySelector('[role="combobox"]'), null);
        const group = f.container.querySelector('[role="group"]');
        assert.ok(
            group,
            'selected and readonly values keep their field context'
        );
        const referencedText = (attribute: string) => {
            const ids = (group.getAttribute(attribute) ?? '')
                .split(/\s+/)
                .filter(Boolean);
            assert.ok(
                ids.length > 0,
                `${attribute} must reference rendered nodes`
            );
            return ids
                .map((id) => {
                    const node = f.window.document.getElementById(id);
                    assert.ok(node, `field context ${id} must actually exist`);
                    return node.textContent;
                })
                .join(' ');
        };
        assert.equal(
            referencedText('aria-labelledby'),
            'Assigned collaborator'
        );
        assert.equal(
            referencedText('aria-describedby'),
            'Choose from the supplied people Synthetic field feedback'
        );
        assert.equal(group.getAttribute('aria-invalid'), 'true');
        assert.ok(group.textContent.includes(first.name));
        if (multiple) assert.ok(group.textContent.includes(retired.name));
        if (presentation === 'selected-single') assert.ok(f.removal(first));
        else assert.equal(group.querySelector('button'), null);
        assert.equal(f.count(), 0);
    });

it('an external field label names readonly SDK output through its actual DOM reference', async (t) => {
    const f = await fixture(t, { value: first, props: { readOnly: true } });
    const label = f.window.document.createElement('label');
    label.id = 'external-collaborator-label';
    label.textContent = 'External collaborator field';
    f.form.insertBefore(label, f.container);
    f.state.props.labelledBy = label.id;
    f.state.props.showLabel = false;
    await f.render();
    const group = f.container.querySelector('[role="group"]');
    assert.ok(group);
    const name = group.getAttribute('aria-labelledby');
    assert.equal(name, label.id);
    assert.ok(name);
    assert.equal(
        f.window.document.getElementById(name)?.textContent,
        'External collaborator field'
    );
    assert.equal(group.getAttribute('aria-label'), null);
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(f.container.querySelector('input'), null);
    assert.ok(group.textContent.includes(first.name));
    assert.equal(f.count(), 0);
});

it('multiple preserves selected order, extra metadata and exact objects while toggling supplied rows', async (t) => {
    const f = await fixture(t, { multiple: true, value: [retired] });
    await f.search(second.email);
    await f.pointer(f.option(second));
    assert.equal(f.count(), 1);
    const added = f.invocations[0]?.value;
    assert.ok(Array.isArray(added));
    assert.equal(added.length, 2);
    assert.equal(added[0], retired);
    assert.equal(added[1], second);
    assert.equal(added[0]?.native, retired.native);
    await f.search(first.email);
    await f.key('ArrowDown');
    await f.key('Enter');
    assert.equal(f.count(), 2);
    assert.equal(f.state.many[0], retired);
    assert.equal(f.state.many[1], second);
    assert.equal(f.state.many[2], first);
    await f.search(second.email);
    assert.equal(f.option(second).getAttribute('aria-selected'), 'true');
    await f.pointer(f.option(second));
    assert.equal(f.count(), 3);
    assert.equal(f.state.many.length, 2);
    assert.equal(f.state.many[0], retired);
    assert.equal(f.state.many[1], first);
    assert.equal(f.container.querySelectorAll('li').length, 2);
});

it('ID removal deletes every matching occurrence without cloning or deduplicating its neighbors', async (t) => {
    const duplicate = {
        ...first,
        name: 'Lookup occurrence',
        email: 'copy@invalid',
    };
    const selected = Object.freeze([first, retired, duplicate, retired]);
    const f = await fixture(t, { multiple: true, value: selected });
    assert.equal(f.container.querySelectorAll('li').length, 4);
    await f.pointer(f.removal(first));
    assert.equal(f.count(), 1);
    const value = f.invocations[0]?.value;
    assert.ok(Array.isArray(value));
    assert.equal(value.length, 2);
    assert.equal(value[0], retired);
    assert.equal(value[1], retired);
    assert.equal(selected[0], first);
    assert.equal(selected[2], duplicate);
    await f.pointer(f.removal(retired));
    assert.equal(f.count(), 2);
    assert.deepEqual(f.invocations[1]?.value, []);
});

it('stored retired identities remain removable but are never discovered or merged into offered choices', async (t) => {
    const f = await fixture(t, { value: retired });
    assert.ok(f.container.textContent.includes(retired.name));
    await f.pointer(f.removal(retired));
    assert.equal(f.invocations[0]?.value, null);
    await f.search(retired.email);
    assert.equal(f.options().length, 0);
    assert.ok(f.container.textContent.includes(labels.noMatches));
    f.state.choices = [];
    await f.render();
    await f.search(first.name);
    assert.equal(f.options().length, 0);
    assert.equal(f.count(), 1);
    f.state.choices = [second];
    await f.render();
    await f.search(second.email);
    await f.pointer(f.option(second));
    assert.equal(f.count(), 2);
    assert.equal(f.invocations[1]?.value, second);
});

it('fuzzy name/email search keeps offered duplicate occurrences and returns their original objects', async (t) => {
    const copy = { ...first, email: 'other-alice@example.invalid' };
    const f = await fixture(t, {
        multiple: true,
        choices: [first, copy, second],
    });
    await f.open();
    assert.equal(f.options().length, 3);
    assert.ok(f.container.textContent.includes(labels.availableOptions));
    assert.ok(f.options()[0]?.textContent.includes(first.email));
    assert.ok(f.options()[1]?.textContent.includes(copy.email));
    await f.search('ALICE ARBOR');
    assert.equal(f.options().length, 2);
    await f.search(copy.email.toUpperCase());
    assert.equal(f.options().length, 1);
    await f.pointer(f.option(copy));
    const value = f.invocations[0]?.value;
    assert.ok(Array.isArray(value));
    assert.equal(value.length, 1);
    assert.equal(value[0], copy);
    await f.search('nothing-in-supplied-choices');
    assert.equal(f.options().length, 0);
    assert.ok(f.container.textContent.includes(labels.noMatches));
});

it('an initially empty authoritative offer stays empty while stored multiple values remain displayed', async (t) => {
    const f = await fixture(t, {
        multiple: true,
        value: [retired],
        choices: [],
    });
    await f.open();
    assert.equal(f.options().length, 0);
    assert.ok(f.container.textContent.includes(labels.noMatches));
    assert.ok(f.container.textContent.includes(retired.name));
    await f.search(retired.email);
    assert.equal(f.options().length, 0);
    assert.equal(f.count(), 0);
    await f.pointer(f.removal(retired));
    assert.equal(f.count(), 1);
    assert.deepEqual(f.invocations[0]?.value, []);
    assert.equal(f.state.many.length, 0);
    assert.equal(f.options().length, 0);
});

it('readonly lookup occurrences remain literal, ordered, duplicate-preserving and action-free', async (t) => {
    const literal = { ...first, name: '<img src=x onerror=literal>' };
    const fallback = { ...second, name: '', email: '<b>email fallback</b>' };
    const blank = { ...retired, name: '', email: '' };
    const f = await fixture(t, {
        multiple: true,
        value: [literal, fallback, literal, blank],
        props: { readOnly: true },
    });
    const rows = Array.from(f.container.querySelectorAll('li'));
    assert.equal(rows.length, 4);
    assert.equal(rows[0]?.textContent, literal.name);
    assert.equal(rows[1]?.textContent, fallback.email);
    assert.equal(rows[2]?.textContent, literal.name);
    assert.equal(rows[3]?.textContent, '');
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(f.container.querySelector('b'), null);
    assert.equal(f.container.querySelector('button'), null);
    assert.equal(f.container.querySelector('input'), null);
    assert.equal(f.count(), 0);
    f.state.many = [];
    await f.render();
    assert.ok(f.container.textContent.includes(labels.empty));
    assert.equal(f.count(), 0);
});

it('direct avatars require an explicit exact HTTP origin and render decorative SDK-owned image DOM', async (t) => {
    const people = [
        first,
        {
            ...second,
            profilePicUrl: 'https://avatars.example.invalid.evil/a.png',
        },
        { ...retired, profilePicUrl: 'javascript:literal-label' },
        { ...first, id: 'data', profilePicUrl: 'data:image/svg+xml,literal' },
        {
            ...second,
            id: 'relative',
            profilePicUrl: '//avatars.example.invalid/a.png',
        },
    ];
    const f = await fixture(t, {
        multiple: true,
        value: people,
        props: {
            readOnly: true,
            avatarPolicy: {
                type: 'direct',
                allowedOrigins: ['https://avatars.example.invalid'],
            },
        },
    });
    const images = f.container.querySelectorAll('img');
    assert.equal(images.length, 1);
    assert.equal(images[0]?.getAttribute('src'), first.profilePicUrl);
    assert.equal(images[0]?.getAttribute('alt'), '');
    assert.equal(images[0]?.getAttribute('width'), '32');
    assert.equal(images[0]?.getAttribute('height'), '32');
    f.state.props.avatarPolicy = { type: 'none' };
    await f.render();
    assert.equal(f.container.querySelector('img'), null);
});

it('data-only avatar delivery retains optimizer sources without a caller renderer or identity lookup', async (t) => {
    const urls: string[] = [];
    const f = await fixture(t, {
        value: first,
        props: {
            avatarPolicy: {
                type: 'source',
                getSource(url) {
                    urls.push(url);
                    return {
                        src: '/_next/image?url=permitted-avatar&w=32&q=75',
                        srcSet: '/_next/image?url=permitted-avatar&w=64&q=75 2x',
                        sizes: '32px',
                        loading: 'lazy',
                        decoding: 'async',
                    };
                },
            },
        },
    });
    const image = f.container.querySelector('img');
    assert.ok(image);
    assert.equal(
        image.getAttribute('src'),
        '/_next/image?url=permitted-avatar&w=32&q=75'
    );
    assert.equal(
        image.getAttribute('srcset'),
        '/_next/image?url=permitted-avatar&w=64&q=75 2x'
    );
    assert.equal(image.getAttribute('sizes'), '32px');
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.ok(urls.length > 0);
    assert.ok(urls.every((url) => url === first.profilePicUrl));
    assert.equal(f.count(), 0);
});

it('a refused selection has no private committed value and cannot steal later external focus', async (t) => {
    const f = await fixture(t);
    f.state.accept = false;
    await f.search(first.email);
    await f.key('ArrowDown');
    await f.key('Enter');
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, first);
    assert.equal(f.state.single, null);
    assert.equal(f.container.querySelector('li'), null);
    assert.equal(f.window.document.activeElement, f.input());
    await f.focusAdjacent();
    f.state.single = first;
    await f.render();
    assert.ok(f.removal(first));
    assert.equal(f.window.document.activeElement, f.adjacent);
    f.state.single = null;
    await f.render();
    assert.ok(f.input());
    assert.equal(f.window.document.activeElement, f.adjacent);
    assert.equal(f.count(), 1);
});

it('a refused removal is consumed before a later external clear or replacement', async (t) => {
    const f = await fixture(t, { value: first });
    f.state.accept = false;
    await f.keyboardRemove(first);
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, null);
    assert.equal(f.state.single, first);
    assert.ok(f.removal(first));
    await f.focusAdjacent();
    f.state.single = null;
    await f.render();
    assert.equal(f.window.document.activeElement, f.adjacent);
    f.state.single = second;
    await f.render();
    assert.ok(f.removal(second));
    assert.equal(f.window.document.activeElement, f.adjacent);
    assert.equal(f.count(), 1);
});

it('multiple refused addition and removal never become private badge or selected-row state', async (t) => {
    const f = await fixture(t, { multiple: true, value: [first] });
    f.state.accept = false;
    await f.search(second.email);
    await f.pointer(f.option(second));
    assert.equal(f.count(), 1);
    const addition = f.invocations[0]?.value;
    assert.ok(Array.isArray(addition));
    assert.equal(addition[0], first);
    assert.equal(addition[1], second);
    assert.equal(f.state.many.length, 1);
    assert.equal(f.state.many[0], first);
    assert.equal(f.container.querySelectorAll('li').length, 1);
    assert.equal(f.option(second).getAttribute('aria-selected'), 'false');
    await f.search(first.email);
    await f.pointer(f.option(first));
    assert.equal(f.count(), 2);
    assert.deepEqual(f.invocations[1]?.value, []);
    assert.equal(f.state.many[0], first);
    assert.equal(f.option(first).getAttribute('aria-selected'), 'true');
    f.state.many = [second];
    await f.render();
    assert.equal(f.count(), 2);
    assert.ok(f.container.textContent.includes(second.name));
});

it('a throwing canonical writer cannot commit private selection or retain a future focus request', async (t) => {
    const f = await fixture(t);
    const fault = new Error('Original collaborator writer failure');
    f.state.throwing = fault;
    await f.search(first.email);
    let thrown: unknown;
    try {
        await f.pointer(f.option(first));
    } catch (error) {
        thrown = error;
    }
    assert.equal(f.count(), 1);
    assert.equal(f.invocations[0]?.value, first);
    assert.ok(thrown === fault || f.reported.includes(fault));
    assert.equal(f.state.single, null);
    assert.equal(f.container.querySelector('li'), null);
    await f.focusAdjacent();
    f.state.throwing = undefined;
    f.state.single = second;
    await f.render();
    assert.equal(f.window.document.activeElement, f.adjacent);
    assert.ok(f.removal(second));
    assert.equal(f.count(), 1);
});

it('metadata and equal controlled-value echoes preserve the actual query, input and focus', async (t) => {
    const f = await fixture(t, { multiple: true, value: [first] });
    await f.search(second.email);
    const input = f.input();
    assert.equal(f.options().length, 1);
    f.state.many = [...f.state.many];
    f.state.props.title = 'Updated collaborator title';
    f.state.props.describedBy = 'updated-help updated-error';
    f.state.props.invalid = true;
    f.state.props.labels = { ...labels, placeholder: 'Nouveau texte' };
    f.state.props.ariaLabel = 'Rechercher un collaborateur';
    f.state.props.showLabel = false;
    // These explicit values are semantically equal to the omitted defaults.
    f.state.props.readOnly = false;
    f.state.props.disabled = false;
    f.state.props.visible = true;
    await f.render();
    assert.equal(f.input(), input);
    assert.equal(input.value, second.email);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(
        input.getAttribute('aria-describedby'),
        'updated-help updated-error'
    );
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(
        input.getAttribute('aria-label'),
        'Rechercher un collaborateur'
    );
    assert.equal(f.container.querySelector('label'), null);
    assert.equal(input.placeholder, 'Nouveau texte');
    assert.equal(f.options().length, 1);
    assert.ok(f.option(second));
    assert.equal(f.count(), 0);
    await f.pointer(f.option(second));
    assert.equal(f.count(), 1);
    assert.equal(f.state.many[0], first);
    assert.equal(f.state.many[1], second);
});

for (const action of ['selection', 'removal'] as const)
    it(`live owner revocation refuses ${action} before any canonical callback`, async (t) => {
        const f = await fixture(t, {
            multiple: true,
            value: action === 'removal' ? [first] : [],
        });
        if (action === 'selection') await f.search(second.email);
        const retained =
            action === 'selection' ? f.option(second) : f.removal(first);
        // No rerender: the real retained control remains mounted and actionable.
        f.state.current = false;
        await f.pointer(retained);
        assert.equal(f.count(), 0);
        assert.equal(f.state.many.length, action === 'removal' ? 1 : 0);
        // Observed revocation is permanent for this mounted owner generation.
        f.state.current = true;
        await f.pointer(retained);
        assert.equal(f.count(), 0);
        f.state.owner = {};
        await f.render();
        if (action === 'selection') {
            await f.search(second.email);
            await f.pointer(f.option(second));
            assert.equal(f.state.many[0], second);
        } else {
            await f.pointer(f.removal(first));
            assert.equal(f.state.many.length, 0);
        }
        assert.equal(f.count(), 1);
    });

for (const replacement of ['owner', 'readonly', 'unmount'] as const)
    for (const action of ['selection', 'removal'] as const)
        it(`reentrant ${replacement} during the final ${action} authority check cannot call the retired writer`, async (t) => {
            const f = await fixture(t, { multiple: true, value: [first] });
            if (action === 'selection') await f.search(second.email);
            const retained =
                action === 'selection' ? f.option(second) : f.removal(first);
            let checks = 0;
            f.state.authority = () => {
                checks++;
                if (checks === 2) {
                    // This is the caller's real public authority predicate.
                    // Publish during propose's final recheck, then deliberately
                    // return true: that truth must not revive the replaced props.
                    f.flushSync(() => {
                        if (replacement === 'unmount') f.unmountNow();
                        else {
                            if (replacement === 'owner') {
                                f.state.owner = {};
                                f.state.target = 'reentrant successor owner';
                            } else f.state.props.readOnly = true;
                            f.publish();
                        }
                    });
                }
                return true;
            };
            await f.pointer(retained);
            assert.equal(
                checks,
                2,
                'the distinguishing final recheck was reached'
            );
            assert.equal(
                f.count(),
                0,
                'no callback to the retired canonical writer'
            );
            assert.equal(f.state.many.length, 1);
            assert.equal(f.state.many[0], first);

            f.state.authority = undefined;
            f.state.owner = {};
            f.state.target = `legitimate ${replacement} successor`;
            f.state.props.readOnly = false;
            if (replacement === 'unmount') await f.remount();
            else await f.render();
            if (action === 'selection') {
                await f.search(second.email);
                await f.pointer(f.option(second));
                assert.equal(f.state.many[0], first);
                assert.equal(f.state.many[1], second);
            } else {
                await f.pointer(f.removal(first));
                assert.equal(f.state.many.length, 0);
            }
            assert.equal(f.count(), 1);
            assert.equal(f.invocations[0]?.target, f.state.target);
        });

for (const replacement of [
    'owner',
    'readonly',
    'disabled',
    'hidden',
    'field',
    'form',
] as const)
    it(`retained picker actions cannot cross ${replacement} replacement`, async (t) => {
        const f = await fixture(t, { multiple: true, value: [first] });
        await f.search(second.email);
        const previousInput = f.input();
        const previousOption = f.option(second);
        const previousRemove = f.removal(first);
        if (replacement === 'owner') {
            f.state.owner = {};
            f.state.target = 'session-B/record-B/field-collaborator';
        } else if (replacement === 'readonly') f.state.props.readOnly = true;
        else if (replacement === 'disabled') f.state.props.disabled = true;
        else if (replacement === 'hidden') f.state.props.visible = false;
        else if (replacement === 'field')
            f.state.props.inputId = 'replacement-collaborator-field';
        else f.state.props.formId = 'replacement-form';
        await f.render();
        await f.pointer(previousOption);
        await f.pointer(previousRemove);
        assert.equal(f.count(), 0);
        assert.equal(f.state.many[0], first);
        if (
            replacement === 'owner' ||
            replacement === 'field' ||
            replacement === 'form'
        ) {
            assert.notEqual(f.input(), previousInput);
            await f.search(second.email);
            await f.pointer(f.option(second));
            assert.equal(f.count(), 1);
            assert.equal(f.invocations[0]?.target, f.state.target);
            assert.equal(f.state.many[0], first);
            assert.equal(f.state.many[1], second);
        }
    });

it('observed owner A to B to A never revives the first input, row or removal action', async (t) => {
    const f = await fixture(t, { multiple: true, value: [first] });
    await f.search(second.email);
    const originalOwner = f.state.owner;
    const originalInput = f.input();
    const originalOption = f.option(second);
    const originalRemove = f.removal(first);
    f.state.owner = {};
    await f.render();
    f.state.owner = originalOwner;
    await f.render();
    assert.notEqual(f.input(), originalInput);
    await f.pointer(originalOption);
    await f.pointer(originalRemove);
    assert.equal(f.count(), 0);
    await f.search(second.email);
    await f.pointer(f.option(second));
    assert.equal(f.count(), 1);
    assert.equal(f.state.many[0], first);
    assert.equal(f.state.many[1], second);
});

it('replacement offered objects govern subsequent selection without reviving retired rows', async (t) => {
    const f = await fixture(t, { multiple: true });
    await f.search(first.email);
    const old = f.option(first);
    const replacement = { ...second, native: { marker: 'new-offer' } };
    f.state.choices = [replacement];
    await f.render();
    await f.pointer(old);
    assert.equal(f.count(), 0);
    await f.search(replacement.email);
    await f.pointer(f.option(replacement));
    assert.equal(f.count(), 1);
    assert.equal(f.state.many[0], replacement);
    assert.equal(f.invocations[0]?.value instanceof Array, true);
});

it('unmount retires real retained picker and badge controls without a final write', async (t) => {
    const f = await fixture(t, { multiple: true, value: [first] });
    await f.search(second.email);
    const oldOption = f.option(second);
    const oldRemove = f.removal(first);
    await f.unmount();
    await f.pointer(oldOption);
    await f.pointer(oldRemove);
    assert.equal(f.count(), 0);
    assert.equal(f.state.many[0], first);
    assert.equal(f.container.textContent, '');
});
