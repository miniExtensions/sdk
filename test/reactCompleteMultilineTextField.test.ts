import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    useState,
    version as reactVersion,
    type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import {
    CompleteMultilineTextField,
    type CompleteMultilineTextFieldProps,
} from '../src/react/index.js';
import { NativeMultilineTextField } from './fixtures/nativeMultilineOracle.js';

/*
 * Native component: Git blob 71fa0096ade72c65179d19aaf6cd65caaf19fc08.
 * These use the real public TextareaInput through both implementations. The
 * frozen oracle documents its scalar-prop/import/clsx substitutions explicitly.
 *
 * happyDOM events, selection and programmatic paste/composition below are
 * synthetic DOM evidence. They do not prove trusted input constraints, OS IME
 * ordering, layout geometry, provider writes, or Form/Portal field authority.
 * Existing TextareaInput autosize tests and the packed browser checks retain
 * their separate geometry and real-browser responsibilities.
 */
type Props = CompleteMultilineTextFieldProps;
type Implementation = 'native' | 'sdk';
const implementations: Implementation[] = ['native', 'sdk'];
const pageURL = 'https://multiline.example.test/';

function props(overrides: Partial<Props> = {}): Props {
    return {
        value: 'seed',
        onChange: () => assert.fail('Unexpected canonical change'),
        id: 'multiline-answer',
        form: 'native-multiline-form',
        ...overrides,
    };
}

function view(implementation: Implementation, inputProps: Props): ReactNode {
    return implementation === 'native'
        ? h(NativeMultilineTextField, inputProps)
        : h(CompleteMultilineTextField, inputProps);
}

async function fixture(t: TestContext) {
    const window = new Window({ url: pageURL });
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        IS_REACT_ACT_ENVIRONMENT: true,
        fetch: async () => {
            requests++;
            throw new Error('Unexpected request from multiline presentation');
        },
    };
    const originals = Object.keys(values).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    let requests = 0;
    let submits = 0;
    let root: Root | undefined;
    const unchangedEffects = () => {
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        assert.equal(window.location.href, pageURL);
    };
    // Register before replacing globals so partial setup failures still restore
    // every original descriptor and close the fixture's own Window.
    t.after(async () => {
        try {
            if (root) await act(async () => root?.unmount());
            unchangedEffects();
        } finally {
            for (const [key, original] of originals) {
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    Object.defineProperty(window, 'fetch', { value: values.fetch });
    for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'native-multiline-form';
    container.addEventListener('submit', (event) => {
        submits++;
        event.preventDefault();
    });
    window.document.body.append(container);
    root = createRoot(container as unknown as HTMLElement);
    const textarea = () => {
        const node = container.querySelector('textarea');
        assert.ok(node);
        return node;
    };
    const counter = () => container.querySelector('p[title="Character Limit"]');
    const render = async (node: ReactNode, strict = true) => {
        await act(async () => {
            root?.render(strict ? h(StrictMode, null, node) : node);
        });
        unchangedEffects();
    };
    const edit = async (
        value: string,
        selectionStart = value.length,
        selectionEnd = selectionStart,
        isComposing = false
    ) => {
        await act(async () => {
            const node = textarea();
            node.focus();
            // Bypass React's value tracker just as an external native edit
            // does; dispatch alone after the instance setter is insufficient.
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value'
            )?.set;
            assert.ok(setter);
            setter.call(node, value);
            node.setSelectionRange(selectionStart, selectionEnd);
            node.dispatchEvent(
                new window.InputEvent('input', {
                    bubbles: true,
                    data: value,
                    inputType: isComposing
                        ? 'insertCompositionText'
                        : 'insertText',
                    isComposing,
                })
            );
        });
        unchangedEffects();
    };
    const composition = async (
        type: 'compositionstart' | 'compositionend',
        data: string
    ) => {
        await act(async () => {
            const event = new window.CompositionEvent(type, { bubbles: true });
            // Happy DOM exposes the generic initializer for this constructor.
            // Retain the browser event's data without widening library types.
            Object.defineProperty(event, 'data', { value: data });
            textarea().dispatchEvent(event);
        });
        unchangedEffects();
    };
    return {
        window,
        container,
        textarea,
        counter,
        render,
        edit,
        composition,
        unchangedEffects,
    };
}

function snapshot(dom: Awaited<ReturnType<typeof fixture>>) {
    const node = dom.textarea();
    return {
        value: node.value,
        disabled: node.disabled,
        readOnly: node.getAttribute('readonly'),
        maxLengthAttribute: node.getAttribute('maxlength'),
        maxLengthProperty: node.maxLength,
        autocomplete: node.getAttribute('autocomplete'),
        placeholder: node.getAttribute('placeholder'),
        id: node.id,
        form: node.getAttribute('form'),
        describedBy: node.getAttribute('aria-describedby'),
        invalid: node.getAttribute('aria-invalid'),
        classes: node.className,
        counter: dom.counter()?.textContent ?? null,
        counterClasses: dom.counter()?.className ?? null,
    };
}

it('renders escaped literal values and nullable values without a browser', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    const empty = renderToStaticMarkup(
        h(
            CompleteMultilineTextField,
            props({
                value: null,
                characterLimit: 0,
            })
        )
    );
    assert.match(empty, /data-limit-reached="false"/);
    assert.match(empty, /maxlength="0"/);
    assert.match(empty, />0\/0<\/p>/);
    const literal = renderToStaticMarkup(
        h(
            CompleteMultilineTextField,
            props({
                value: '  <b>literal</b> & "quoted"\nnext',
                hasErrorMessage: true,
                hasDescription: true,
            })
        )
    );
    assert.match(literal, /&lt;b&gt;literal&lt;\/b&gt;/);
    assert.match(
        literal,
        /aria-describedby="multiline-answer-error multiline-answer-description"/
    );
    assert.doesNotMatch(literal, /<b>|<script|<input|<button/);
});

it('matches the native editable limit and counter baseline on the same node', async (t) => {
    const dom = await fixture(t);
    for (const implementation of implementations) {
        await dom.render(null);
        await dom.render(
            view(implementation, props({ value: '1234', characterLimit: 5 }))
        );
        const node = dom.textarea();
        assert.equal(node.getAttribute('maxlength'), '5');
        assert.equal(dom.counter()?.textContent, '4/5');
        assert.match(node.className, /focus:border-theme-500/);
        await dom.render(
            view(implementation, props({ value: '12345', characterLimit: 5 }))
        );
        assert.equal(dom.textarea(), node);
        assert.equal(dom.counter()?.textContent, '5/5');
        assert.match(node.className, /focus:border-red-500/);
        await dom.render(view(implementation, props({ value: '12345' })));
        assert.equal(dom.textarea(), node);
        assert.equal(node.getAttribute('maxlength'), null);
        assert.equal(dom.counter(), null);
    }
});

it('matches native placeholder replacement and removal without emitting a change', async (t) => {
    const dom = await fixture(t);
    for (const implementation of implementations) {
        await dom.render(null);
        await dom.render(
            view(
                implementation,
                props({ value: '', placeholder: 'First hint' })
            )
        );
        const node = dom.textarea();
        assert.equal(node.getAttribute('placeholder'), 'First hint');
        await dom.render(
            view(implementation, props({ value: '', placeholder: 'Next hint' }))
        );
        assert.equal(dom.textarea(), node);
        assert.equal(node.getAttribute('placeholder'), 'Next hint');
        await dom.render(view(implementation, props({ value: '' })));
        assert.equal(node.getAttribute('placeholder'), null);
        assert.equal(node.value, '');
    }
});

it('matches native literal editing, focused-node caret restoration and accessibility metadata', async (t) => {
    const dom = await fixture(t);
    for (const implementation of implementations) {
        await dom.render(null);
        const changes: string[] = [];
        let acknowledge: (value: string | null) => void = () =>
            assert.fail('Host not mounted');
        function Host({ metadata = true }: { metadata?: boolean }) {
            const [value, setValue] = useState<string | null>('abcdef');
            acknowledge = setValue;
            return view(
                implementation,
                props({
                    value,
                    onChange: (next) => {
                        changes.push(next);
                        setValue(next);
                    },
                    characterLimit: 100,
                    hasErrorMessage: metadata,
                    hasDescription: metadata,
                })
            );
        }
        await dom.render(h(Host));
        const node = dom.textarea();
        assert.equal(node.getAttribute('form'), 'native-multiline-form');
        assert.equal(node.getAttribute('autocomplete'), 'off');
        assert.equal(
            node.getAttribute('aria-describedby'),
            'multiline-answer-error multiline-answer-description'
        );
        assert.equal(node.getAttribute('aria-invalid'), 'true');
        assert.match(node.className, /block w-full resize-y rounded-md/);
        await dom.edit('abQef', 3);
        assert.deepEqual(changes, ['abQef']);
        assert.equal(dom.textarea(), node);
        assert.equal(dom.window.document.activeElement, node);
        assert.equal(node.selectionStart, 3);
        // A changed canonical acknowledgement would otherwise move the caret
        // to the end. The native range effect restores its last captured range.
        await act(async () => acknowledge('abQef!'));
        assert.equal(node.value, 'abQef!');
        assert.equal(node.selectionStart, 3);
        assert.equal(node.selectionEnd, 3);
        await dom.render(h(Host, { metadata: false }));
        assert.equal(dom.textarea(), node);
        assert.equal(dom.window.document.activeElement, node);
        assert.equal(node.getAttribute('aria-describedby'), null);
        assert.equal(node.getAttribute('aria-invalid'), 'false');
        assert.deepEqual(changes, ['abQef']);
        await dom.edit('  literal <b>\nsecond');
        assert.equal(node.value, '  literal <b>\nsecond');
        assert.equal(dom.counter()?.textContent, '20/100');
        assert.deepEqual(changes, ['abQef', '  literal <b>\nsecond']);
    }
});

it('matches disabled native read-only presentation and removes editable limits without emissions', async (t) => {
    const dom = await fixture(t);
    for (const implementation of implementations) {
        await dom.render(null);
        await dom.render(
            view(
                implementation,
                props({
                    value: 'protected\ntext',
                    readOnly: true,
                    characterLimit: 3,
                })
            )
        );
        const node = dom.textarea();
        assert.equal(node.disabled, true);
        assert.equal(node.getAttribute('readonly'), null);
        assert.equal(node.getAttribute('maxlength'), null);
        assert.equal(dom.counter(), null);
        assert.equal(node.value, 'protected\ntext');
        assert.match(
            node.className,
            /disabled:resize-none disabled:bg-gray-100 disabled:text-gray-600/
        );
        await dom.render(
            view(
                implementation,
                props({
                    value: 'new canonical value',
                    readOnly: true,
                    characterLimit: 0,
                    placeholder: 'Readonly hint',
                    hasErrorMessage: true,
                })
            )
        );
        assert.equal(dom.textarea(), node);
        assert.equal(node.value, 'new canonical value');
        assert.equal(node.disabled, true);
        assert.equal(node.getAttribute('maxlength'), null);
        assert.equal(dom.counter(), null);
        await dom.render(null);
        // Trusted typing refusal on disabled controls is browser-owned. A
        // synthetic input forcibly dispatched here would call the native
        // handler too, so it must not manufacture a stronger readonly policy.
    }
});

it('matches native null, empty, whitespace, markup and Unicode display without conversion', async (t) => {
    const dom = await fixture(t);
    for (const value of [
        null,
        '',
        '0',
        '  \n\t',
        '<b>literal</b> & "quoted"\nnext',
        'A😀Z',
    ]) {
        const projections = [];
        for (const implementation of implementations) {
            await dom.render(null);
            await dom.render(view(implementation, props({ value })));
            assert.equal(dom.textarea().value, value ?? '');
            assert.equal(dom.container.querySelector('b'), null);
            assert.equal(dom.container.querySelector('script'), null);
            projections.push(snapshot(dom));
        }
        assert.deepEqual(projections[1], projections[0]);
    }
});

it('preserves raw zero, negative and fractional limits and the native DOM projection', async (t) => {
    const dom = await fixture(t);
    const cases = [
        { value: null, characterLimit: 0, reached: false, counter: '0/0' },
        { value: '', characterLimit: 0, reached: true, counter: '0/0' },
        { value: '0', characterLimit: 0, reached: true, counter: '1/0' },
        { value: 'ab', characterLimit: -2, reached: true, counter: '2/-2' },
        { value: 'ab', characterLimit: 1.5, reached: true, counter: '2/1.5' },
        { value: 'ab', characterLimit: 2, reached: true, counter: '2/2' },
        { value: 'ab', characterLimit: 3, reached: false, counter: '2/3' },
        { value: 'longer', characterLimit: 3, reached: true, counter: '6/3' },
    ];
    for (const { value, characterLimit, reached, counter } of cases) {
        const projections = [];
        for (const implementation of implementations) {
            await dom.render(null);
            await dom.render(
                view(implementation, props({ value, characterLimit }))
            );
            assert.equal(
                dom.textarea().getAttribute('maxlength'),
                String(characterLimit)
            );
            assert.equal(dom.counter()?.textContent, counter);
            assert.equal(
                dom.textarea().className.includes('focus:border-red-500'),
                reached
            );
            assert.equal(
                dom.counter()?.className.includes('text-red-500'),
                reached
            );
            if (implementation === 'sdk') {
                assert.equal(
                    dom
                        .textarea()
                        .parentElement?.getAttribute('data-limit-reached'),
                    String(reached)
                );
            }
            projections.push(snapshot(dom));
        }
        // The browser/DOM primitive owns projection of invalid numeric
        // metadata into .maxLength. Compare the actual native primitive rather
        // than inventing clamping or an integer normalization in this test.
        assert.deepEqual(projections[1], projections[0]);
    }
});

it('uses the current callback immediately and does not defer changes to blur, Enter or unmount', async (t) => {
    const dom = await fixture(t);
    for (const implementation of implementations) {
        await dom.render(null);
        const changes: string[] = [];
        await dom.render(
            view(
                implementation,
                props({
                    onChange: (value) => changes.push(`A:${value}`),
                })
            )
        );
        const node = dom.textarea();
        await dom.render(
            view(
                implementation,
                props({
                    onChange: (value) => changes.push(`B:${value}`),
                })
            )
        );
        assert.equal(dom.textarea(), node);
        await dom.edit('literal pending');
        assert.deepEqual(changes, ['B:literal pending']);
        await act(async () => {
            node.dispatchEvent(
                new dom.window.KeyboardEvent('keydown', {
                    key: 'Enter',
                    bubbles: true,
                    cancelable: true,
                })
            );
            node.blur();
        });
        await dom.render(null);
        assert.deepEqual(changes, ['B:literal pending']);
    }
});

it('delivers synthetic composition intermediates directly with no composition-end or cleanup flush', async (t) => {
    const dom = await fixture(t);
    const results = [];
    for (const implementation of implementations) {
        await dom.render(null);
        const changes: string[] = [];
        function Host() {
            const [value, setValue] = useState<string | null>('');
            return view(
                implementation,
                props({
                    value,
                    onChange: (next) => {
                        changes.push(next);
                        setValue(next);
                    },
                })
            );
        }
        await dom.render(h(Host));
        const node = dom.textarea();
        await dom.composition('compositionstart', '');
        await dom.edit('漢', 1, 1, true);
        assert.deepEqual(changes, ['漢']);
        await dom.edit('漢字', 2, 2, true);
        assert.deepEqual(changes, ['漢', '漢字']);
        await dom.composition('compositionend', '漢字');
        assert.deepEqual(changes, ['漢', '漢字']);
        await dom.edit('漢字x');
        assert.equal(dom.textarea(), node);
        assert.equal(node.value, '漢字x');
        await dom.render(null);
        assert.deepEqual(changes, ['漢', '漢字', '漢字x']);
        results.push(changes);
    }
    assert.deepEqual(results[1], results[0]);
});

it('retains UTF-16 length and literal synthetic paste input without SDK truncation', async (t) => {
    const dom = await fixture(t);
    for (const implementation of implementations) {
        await dom.render(null);
        const changes: string[] = [];
        function Host() {
            const [value, setValue] = useState<string | null>('');
            return view(
                implementation,
                props({
                    value,
                    characterLimit: 3,
                    onChange: (next) => {
                        changes.push(next);
                        setValue(next);
                    },
                })
            );
        }
        await dom.render(h(Host));
        await act(async () => {
            dom.textarea().dispatchEvent(
                new dom.window.Event('paste', {
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
        assert.deepEqual(changes, []);
        // Explicitly synthetic insertion: a trusted browser paste enforces its
        // own maxlength policy before input; this checks only SDK forwarding.
        await dom.edit('A😀Z');
        assert.equal('A😀Z'.length, 4);
        assert.deepEqual(changes, ['A😀Z']);
        assert.equal(dom.textarea().value, 'A😀Z');
        assert.equal(dom.counter()?.textContent, '4/3');
        assert.match(dom.textarea().className, /focus:border-red-500/);
    }
});

it('forwards the actual textarea object ref through replacement and unmount', async (t) => {
    const dom = await fixture(t);
    const first = createRef<HTMLTextAreaElement>();
    const second = createRef<HTMLTextAreaElement>();
    await dom.render(h(CompleteMultilineTextField, { ...props(), ref: first }));
    const node = dom.textarea();
    assert.equal(first.current, node);
    await dom.render(
        h(CompleteMultilineTextField, { ...props(), ref: second })
    );
    assert.equal(dom.textarea(), node);
    assert.equal(first.current, null);
    assert.equal(second.current, node);
    await dom.render(null);
    assert.equal(second.current, null);
});

it('preserves React-owned callback ref detach semantics against a direct textarea control', async (t) => {
    const dom = await fixture(t);
    const usesReturnedCleanup = Number(reactVersion.split('.')[0]) >= 19;
    const results = [];
    // The ordinary SDK source job is React 18. The same bounded control runs
    // returned cleanup under React 19 in the actual packed React matrix; no
    // React 19 source-runtime claim is inferred from React 18 null callbacks.
    for (const implementation of ['textarea', 'sdk'] as const) {
        await dom.render(null, false);
        const events: string[] = [];
        const callback =
            (label: string) => (node: HTMLTextAreaElement | null) => {
                if (node === null) {
                    events.push(`${label}:null`);
                    return;
                }
                assert.equal(node.tagName, 'TEXTAREA');
                assert.equal(node.isConnected, true);
                events.push(`${label}:node`);
                if (usesReturnedCleanup)
                    return () => {
                        events.push(`${label}:cleanup`);
                    };
            };
        const first = callback('A');
        const second = callback('B');
        const renderRef = (ref: typeof first) =>
            implementation === 'textarea'
                ? h('textarea', { value: 'seed', onChange: () => {}, ref })
                : h(CompleteMultilineTextField, { ...props(), ref });
        await dom.render(renderRef(first), false);
        const node = dom.textarea();
        assert.deepEqual(events, ['A:node']);
        await dom.render(renderRef(first), false);
        assert.equal(dom.textarea(), node);
        assert.deepEqual(events, ['A:node']);
        await dom.render(renderRef(second), false);
        assert.equal(dom.textarea(), node);
        assert.deepEqual(events, [
            'A:node',
            usesReturnedCleanup ? 'A:cleanup' : 'A:null',
            'B:node',
        ]);
        await dom.render(null, false);
        assert.deepEqual(events, [
            'A:node',
            usesReturnedCleanup ? 'A:cleanup' : 'A:null',
            'B:node',
            usesReturnedCleanup ? 'B:cleanup' : 'B:null',
        ]);
        results.push(events);
    }
    assert.deepEqual(results[1], results[0]);
});
