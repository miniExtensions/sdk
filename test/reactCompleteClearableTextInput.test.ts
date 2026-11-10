import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ComponentProps,
    type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CompleteClearableTextInput,
    CompleteDeferredClearableTextInput,
    resolveCurrentClearableInputMobile,
} from '../src/react/index.js';
import { NativeClearableTextInput } from './fixtures/nativeClearableOracle.js';

/*
 * Native reference: host cf0fc85c4f26a9ebfc52c78c1247823e1d51dfa3.
 * Clearable wrapper b91b4eb045502f4a1e574658ba4dc53aca8bbfeb;
 * deferred control 3fd226d290eb8eba86a49d716280406c642dd97a;
 * existing test ae6b1758d8d0ce972f9a54516f0c4cc6e89a4408.
 *
 * The frozen fixture documents its mechanical import/label/mobile bridge.
 * In particular, native dirty pointer-Clear may commit on focus-transfer blur
 * before the Clear click. These tests retain that result rather than silently
 * changing the host's write/queue contract.
 *
 * happyDOM event/focus sequences below are simulated DOM evidence. They do not
 * certify trusted browser input ordering, CSS geometry, Form/Portal authority,
 * provider persistence, or actual device detection.
 */
type Props = ComponentProps<typeof CompleteClearableTextInput>;
type Implementation = 'native' | 'sdk';
const pageURL = 'https://clearable-input.example.test/';

function props(overrides: Partial<Props> = {}): Props {
    return {
        value: 'seed',
        onChange: () => assert.fail('Unexpected canonical change'),
        onClear: () => assert.fail('Unexpected Clear action'),
        clearLabel: 'Clear answer',
        initialMobile: true,
        enableInlineEdit: false,
        'aria-label': 'Answer',
        ...overrides,
    };
}

function view(implementation: Implementation, inputProps: Props): ReactNode {
    return implementation === 'native'
        ? h(NativeClearableTextInput, inputProps)
        : h(CompleteClearableTextInput, inputProps);
}

async function fixture(t: TestContext) {
    const window = new Window({ url: pageURL });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLButtonElement',
        'IS_REACT_ACT_ENVIRONMENT',
        'fetch',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let requests = 0;
    let submits = 0;
    const rejectRequest = async () => {
        requests++;
        throw new Error('Unexpected request from input presentation');
    };
    Object.defineProperty(window, 'fetch', { value: rejectRequest });
    for (const key of keys) {
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? rejectRequest
                      : window[key as keyof Window],
        });
    }
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'host-form';
    container.addEventListener('submit', (event) => {
        submits++;
        event.preventDefault();
    });
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const unchangedEffects = () => {
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        assert.equal(window.location.href, pageURL);
    };
    t.after(async () => {
        try {
            await act(async () => root.unmount());
            unchangedEffects();
        } finally {
            keys.forEach((key, index) => {
                const original = originals[index];
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const button = () => {
        const node = container.querySelector('button');
        assert.ok(node);
        return node;
    };
    const render = async (node: ReactNode) => {
        await act(async () => root.render(h(StrictMode, null, node)));
        unchangedEffects();
    };
    const edit = async (value: string) => {
        await act(async () => {
            input().focus();
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            assert.ok(setter);
            setter.call(input(), value);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
        unchangedEffects();
    };
    const blur = async () => {
        await act(async () => input().blur());
        unchangedEffects();
    };
    const key = async (keyValue: string, isComposing = false) => {
        const event = new window.KeyboardEvent('keydown', {
            key: keyValue,
            isComposing,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            input().dispatchEvent(event);
        });
        unchangedEffects();
        return event;
    };
    const pointerClear = async () => {
        const clear = button();
        await act(async () => {
            clear.dispatchEvent(
                new window.PointerEvent('pointerdown', {
                    bubbles: true,
                    cancelable: true,
                    pointerType: 'mouse',
                    button: 0,
                })
            );
            clear.dispatchEvent(
                new window.MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    button: 0,
                })
            );
        });
        // HappyDOM does not perform a trusted pointer's focus default action.
        // Perform the real focus transition separately, flushing blur before
        // the later click, as a browser pointer sequence does.
        await act(async () => clear.focus());
        assert.equal(window.document.activeElement, clear);
        await act(async () => {
            clear.dispatchEvent(
                new window.PointerEvent('pointerup', {
                    bubbles: true,
                    pointerType: 'mouse',
                    button: 0,
                })
            );
            clear.dispatchEvent(
                new window.MouseEvent('mouseup', { bubbles: true, button: 0 })
            );
            clear.click();
        });
        unchangedEffects();
    };
    const keyboardClear = async () => {
        const clear = button();
        // Tab/focus movement blurs the input before Space activation.
        await act(async () => clear.focus());
        await act(async () => {
            clear.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: ' ',
                    bubbles: true,
                    cancelable: true,
                })
            );
            clear.dispatchEvent(
                new window.KeyboardEvent('keyup', { key: ' ', bubbles: true })
            );
            // Space's trusted activation default is represented explicitly.
            clear.click();
        });
        unchangedEffects();
    };
    return {
        window,
        container,
        input,
        button,
        render,
        edit,
        blur,
        key,
        pointerClear,
        keyboardClear,
        unchangedEffects,
    };
}

it('server-renders both complete inputs from explicit mobile data without browser globals or policy-prop leakage', () => {
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(resolveCurrentClearableInputMobile(), false);
    const html = renderToStaticMarkup(
        h(
            'div',
            null,
            h(
                CompleteClearableTextInput,
                props({ value: '0', clearLabel: 'Erase <answer>' })
            ),
            h(CompleteDeferredClearableTextInput, {
                value: 'literal',
                onChange: () => assert.fail('SSR change'),
                onClear: () => assert.fail('SSR Clear'),
                clearLabel: 'Effacer',
                initialMobile: true,
            })
        )
    );
    assert.match(html, /value="0"/);
    assert.match(html, /value="literal"/);
    assert.match(html, /aria-label="Erase &lt;answer&gt;"/);
    assert.equal((html.match(/type="button"/g) ?? []).length, 2);
    assert.doesNotMatch(
        html,
        /initialMobile|enableInlineEdit|clearLabel|validateInput/
    );
    assert.equal(typeof globalThis.window, 'undefined');
});

for (const enableInlineEdit of [false, true]) {
    for (const autoComplete of [
        undefined,
        'off',
        'on',
        'section-contact email',
    ]) {
        it(
            'preserves native autocomplete ' +
                String(autoComplete) +
                ' for deferred=' +
                String(enableInlineEdit),
            async (t) => {
                const f = await fixture(t);
                const observations: (string | null)[] = [];
                for (const implementation of ['native', 'sdk'] as const) {
                    await f.render(
                        view(
                            implementation,
                            props({ enableInlineEdit, autoComplete })
                        )
                    );
                    observations.push(f.input().getAttribute('autocomplete'));
                    await f.render(null);
                }
                const expected = enableInlineEdit
                    ? (autoComplete ?? null)
                    : (autoComplete ?? 'on');
                assert.deepEqual(observations, [expected, expected]);
            }
        );
    }
}

for (const enableInlineEdit of [false, true]) {
    it(
        'forwards ref, form, literal label, native attributes and focused selection for deferred=' +
            String(enableInlineEdit),
        async (t) => {
            const f = await fixture(t);
            const ref = createRef<HTMLInputElement>();
            const nextRef = createRef<HTMLInputElement>();
            const renderInput = (description: string, useNextRef = false) => {
                const shared = {
                    ref: useNextRef ? nextRef : ref,
                    value: 'seed',
                    onChange: () => assert.fail('Presentation changed value'),
                    onClear: () => assert.fail('No Clear activation'),
                    clearLabel: 'Effacer <réponse>',
                    initialMobile: true,
                    id: 'answer',
                    form: 'host-form',
                    name: 'email',
                    type: 'email',
                    inputMode: 'email' as const,
                    required: true,
                    maxLength: 40,
                    placeholder: 'Email address',
                    className: 'host-input',
                    'aria-describedby': description,
                    'aria-invalid': true,
                };
                return enableInlineEdit
                    ? h(CompleteDeferredClearableTextInput, shared)
                    : h(CompleteClearableTextInput, {
                          ...shared,
                          enableInlineEdit: false,
                      });
            };
            await f.render(renderInput('first-description'));
            const node = f.input();
            assert.equal(ref.current, node);
            assert.equal(node.form?.id, 'host-form');
            assert.equal(node.name, 'email');
            assert.equal(node.type, 'email');
            assert.equal(node.inputMode, 'email');
            assert.equal(node.required, true);
            assert.equal(node.maxLength, 40);
            assert.equal(node.placeholder, 'Email address');
            assert.equal(node.classList.contains('host-input'), true);
            assert.equal(node.getAttribute('aria-invalid'), 'true');
            assert.equal(f.button().type, 'button');
            assert.equal(
                f.button().getAttribute('aria-label'),
                'Effacer <réponse>'
            );
            assert.equal(f.container.querySelector('réponse,b'), null);
            // Email inputs do not expose setSelectionRange; use a supported
            // ordinary text input for the subsequent selection preservation.
            await f.render(
                h(
                    CompleteClearableTextInput,
                    props({
                        enableInlineEdit,
                        ref,
                        className: 'host-input',
                        'aria-describedby': 'first-description',
                    })
                )
            );
            const text = f.input();
            await act(async () => {
                text.focus();
                text.setSelectionRange(1, 3, 'backward');
            });
            await f.render(
                h(
                    CompleteClearableTextInput,
                    props({
                        enableInlineEdit,
                        ref,
                        className: 'host-input',
                        'aria-describedby': 'second-description',
                    })
                )
            );
            assert.equal(f.input(), text);
            assert.equal(f.window.document.activeElement, text);
            assert.equal(text.selectionStart, 1);
            assert.equal(text.selectionEnd, 3);
            assert.equal(text.selectionDirection, 'backward');
            await f.render(
                h(
                    CompleteClearableTextInput,
                    props({ enableInlineEdit, ref: nextRef })
                )
            );
            assert.equal(ref.current, null);
            assert.equal(nextRef.current, f.input());
            await f.render(null);
            assert.equal(nextRef.current, null);
        }
    );
}

it('keeps immediate literal changes and Clear separate and leaves validateInput unused', async (t) => {
    const f = await fixture(t);
    const changes: string[] = [];
    let clears = 0;
    let validations = 0;
    const p = props({
        onChange: (value) => changes.push(value),
        onClear: () => clears++,
        validateInput: () => {
            validations++;
            return false;
        },
    });
    await f.render(h(CompleteClearableTextInput, p));
    await f.edit('  0 & <b>literal</b>  ');
    assert.deepEqual(changes, ['  0 & <b>literal</b>  ']);
    assert.equal(f.input().value, 'seed');
    await f.render(h(CompleteClearableTextInput, { ...p, value: '0' }));
    assert.equal(f.input().value, '0');
    assert.ok(f.button());
    await f.pointerClear();
    assert.equal(clears, 1);
    assert.deepEqual(changes, ['  0 & <b>literal</b>  ']);
    assert.equal(validations, 0);
    assert.equal(f.input().value, '0');
    await f.render(null);
    assert.deepEqual(changes, ['  0 & <b>literal</b>  ']);
});

it('validates only deferred typing and preserves rejected drafts, blur and explicit Clear', async (t) => {
    const f = await fixture(t);
    const changes: string[] = [];
    const validations: string[] = [];
    let clears = 0;
    const p = props({
        enableInlineEdit: true,
        onChange: (value) => changes.push(value),
        onClear: () => clears++,
        validateInput: (value) => {
            validations.push(value);
            return !value.includes('?');
        },
    });
    await f.render(h(CompleteClearableTextInput, p));
    assert.deepEqual(validations, []);
    await f.edit('seed!');
    await f.edit('seed!?');
    assert.equal(f.input().value, 'seed!');
    assert.deepEqual(changes, []);
    await f.blur();
    assert.deepEqual(changes, ['seed!']);
    await f.render(h(CompleteClearableTextInput, { ...p, value: 'settled' }));
    assert.equal(f.input().value, 'settled');
    await f.pointerClear();
    assert.equal(f.input().value, '');
    assert.equal(f.container.querySelector('button'), null);
    assert.equal(clears, 1);
    assert.deepEqual(validations, ['seed!', 'seed!?']);
    await f.render(null);
    assert.deepEqual(changes, ['seed!']);
});

it('keeps newer focused deferred typing across prop acknowledgements until explicit blur', async (t) => {
    const f = await fixture(t);
    const changes: string[] = [];
    const p = props({
        enableInlineEdit: true,
        onChange: (value) => changes.push(value),
    });
    await f.render(h(CompleteClearableTextInput, p));
    const node = f.input();
    await f.edit('new draft');
    node.setSelectionRange(2, 5);
    await f.render(
        h(CompleteClearableTextInput, { ...p, value: 'older acknowledgement' })
    );
    assert.equal(f.input(), node);
    assert.equal(node.value, 'new draft');
    assert.equal(node.selectionStart, 2);
    assert.equal(node.selectionEnd, 5);
    assert.deepEqual(changes, []);
    await f.edit('even newer draft');
    await f.render(h(CompleteClearableTextInput, { ...p, value: 'new draft' }));
    assert.equal(node.value, 'even newer draft');
    await f.blur();
    assert.deepEqual(changes, ['even newer draft']);
    await f.render(null);
    assert.deepEqual(changes, ['even newer draft']);
});

it('reconciles clean external values without validating or emitting canonical changes', async (t) => {
    const f = await fixture(t);
    const p = props({
        enableInlineEdit: true,
        validateInput: () =>
            assert.fail('External acknowledgement was validated'),
    });
    await f.render(h(CompleteClearableTextInput, p));
    const node = f.input();
    await f.render(h(CompleteClearableTextInput, { ...p, value: '' }));
    assert.equal(f.input(), node);
    assert.equal(node.value, '');
    assert.equal(f.container.querySelector('button'), null);
    await f.render(h(CompleteClearableTextInput, { ...p, value: 'restored' }));
    assert.equal(node.value, 'restored');
    assert.ok(f.button());
    await f.render(null);
});

it('uses the current ordinary-blur callback rather than the mount cleanup callback', async (t) => {
    const f = await fixture(t);
    const callbacks: string[] = [];
    const p = props({
        enableInlineEdit: true,
        onChange: (value) => callbacks.push('mounted:' + value),
    });
    await f.render(h(CompleteClearableTextInput, p));
    await f.edit('typed');
    await f.render(
        h(CompleteClearableTextInput, {
            ...p,
            onChange: (value) => callbacks.push('current:' + value),
        })
    );
    await f.blur();
    await f.render(null);
    assert.deepEqual(callbacks, ['current:typed']);
});

it('settles pending unmount to the original mounted callback with the latest local draft', async (t) => {
    const f = await fixture(t);
    const callbacks: string[] = [];
    const p = props({
        enableInlineEdit: true,
        onChange: (value) => callbacks.push('mounted:' + value),
    });
    await f.render(h(CompleteClearableTextInput, p));
    await f.edit('first');
    await f.render(
        h(CompleteClearableTextInput, {
            ...p,
            onChange: (value) => callbacks.push('successor:' + value),
        })
    );
    await f.edit('latest');
    await f.render(null);
    assert.deepEqual(callbacks, ['mounted:latest']);
});

it('does not replay a settled blur on unmount and permits a later distinct draft', async (t) => {
    const f = await fixture(t);
    const changes: string[] = [];
    const p = props({
        enableInlineEdit: true,
        onChange: (value) => changes.push(value),
    });
    await f.render(h(CompleteClearableTextInput, p));
    await f.edit('first');
    await f.blur();
    assert.deepEqual(changes, ['first']);
    await f.edit('second');
    await f.render(h(CompleteClearableTextInput, { ...p, value: 'first' }));
    assert.equal(f.input().value, 'second');
    await f.blur();
    await f.render(null);
    assert.deepEqual(changes, ['first', 'second']);
});

for (const scenario of [
    'pristine-pointer',
    'dirty-pointer',
    'dirty-keyboard',
] as const) {
    it(
        'matches frozen native event settlement for ' + scenario + ' Clear',
        async (t) => {
            const f = await fixture(t);
            const observations: {
                events: string[];
                value: string;
                hasClear: boolean;
            }[] = [];
            for (const implementation of ['native', 'sdk'] as const) {
                const events: string[] = [];
                await f.render(
                    view(
                        implementation,
                        props({
                            enableInlineEdit: true,
                            onChange: (value) => events.push('change:' + value),
                            onClear: () => events.push('clear'),
                        })
                    )
                );
                await act(async () => f.input().focus());
                if (scenario !== 'pristine-pointer') await f.edit('seed!');
                if (scenario === 'dirty-keyboard') await f.keyboardClear();
                else await f.pointerClear();
                const outcome = {
                    events,
                    value: f.input().value,
                    hasClear: f.container.querySelector('button') != null,
                };
                await f.render(null);
                observations.push(outcome);
            }
            assert.deepEqual(observations[1], observations[0]);
            assert.deepEqual(observations[1], {
                events:
                    scenario === 'pristine-pointer'
                        ? ['clear']
                        : ['change:seed!', 'clear'],
                value: '',
                hasClear: false,
            });
        }
    );
}

it('keeps composing Enter focused and uncommitted, then prevents ordinary Enter submit and blurs once', async (t) => {
    const f = await fixture(t);
    const changes: string[] = [];
    const compositions: string[] = [];
    await f.render(
        h(
            CompleteClearableTextInput,
            props({
                enableInlineEdit: true,
                onChange: (value) => changes.push(value),
                onCompositionStart: () => compositions.push('start'),
                onCompositionEnd: () => compositions.push('end'),
            })
        )
    );
    await act(async () => {
        f.input().focus();
        f.input().dispatchEvent(
            new f.window.CompositionEvent('compositionstart', { bubbles: true })
        );
    });
    await f.edit('漢字');
    const composing = await f.key('Enter', true);
    assert.equal(composing.defaultPrevented, true);
    assert.equal(f.window.document.activeElement, f.input());
    assert.deepEqual(changes, []);
    await act(async () => {
        f.input().dispatchEvent(
            new f.window.CompositionEvent('compositionend', { bubbles: true })
        );
    });
    const ordinary = await f.key('Enter');
    assert.equal(ordinary.defaultPrevented, true);
    assert.notEqual(f.window.document.activeElement, f.input());
    assert.deepEqual(compositions, ['start', 'end']);
    assert.deepEqual(changes, ['漢字']);
    await f.render(null);
    assert.deepEqual(changes, ['漢字']);
});

for (const enableInlineEdit of [false, true]) {
    it(
        'preserves native supplied-event override behavior for deferred=' +
            String(enableInlineEdit),
        async (t) => {
            const f = await fixture(t);
            const observations: { hostEvents: string[]; changes: string[] }[] =
                [];
            for (const implementation of ['native', 'sdk'] as const) {
                const hostEvents: string[] = [];
                const changes: string[] = [];
                await f.render(
                    view(
                        implementation,
                        props({
                            enableInlineEdit,
                            onChange: (value) => changes.push(value),
                            onFocus: () => hostEvents.push('focus'),
                            onBlur: () => hostEvents.push('blur'),
                            onKeyDown: () => hostEvents.push('keydown'),
                        })
                    )
                );
                await f.edit('typed');
                await f.key('ArrowLeft');
                await f.blur();
                await f.render(null);
                observations.push({ hostEvents, changes });
            }
            assert.deepEqual(observations[1], observations[0]);
            assert.deepEqual(observations[1], {
                hostEvents: enableInlineEdit
                    ? ['focus']
                    : ['focus', 'keydown', 'blur'],
                changes: ['typed'],
            });
        }
    );
}

for (const enableInlineEdit of [false, true]) {
    for (const policy of ['disabled', 'readOnly'] as const) {
        it(
            'keeps ' +
                policy +
                ' Clear inert for deferred=' +
                String(enableInlineEdit),
            async (t) => {
                const f = await fixture(t);
                await f.render(
                    h(
                        CompleteClearableTextInput,
                        props({ enableInlineEdit, [policy]: true })
                    )
                );
                const input = f.input();
                assert.equal(input[policy], true);
                assert.equal(f.button().disabled, true);
                await act(async () => f.button().click());
                assert.equal(input.value, 'seed');
                await f.render(null);
            }
        );
    }
}

it('captures mobile visibility per mount while allowing literal labels to update', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(CompleteClearableTextInput, props({ initialMobile: false }))
    );
    assert.equal(f.container.querySelector('button'), null);
    await f.render(
        h(
            CompleteClearableTextInput,
            props({ initialMobile: true, clearLabel: 'Borrar' })
        )
    );
    assert.equal(f.container.querySelector('button'), null);
    await f.render(
        h(
            CompleteClearableTextInput,
            props({
                key: 'new-mount',
                initialMobile: true,
                clearLabel: 'Borrar',
            })
        )
    );
    assert.equal(f.button().getAttribute('aria-label'), 'Borrar');
    await f.render(
        h(
            CompleteClearableTextInput,
            props({
                key: 'new-mount',
                initialMobile: false,
                clearLabel: 'Effacer',
            })
        )
    );
    assert.equal(f.button().getAttribute('aria-label'), 'Effacer');
});

it('forwards raw mobile input to a newly mounted deferred mode instead of the coordinator old capture', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(CompleteClearableTextInput, props({ initialMobile: false }))
    );
    await f.render(
        h(CompleteClearableTextInput, props({ initialMobile: true }))
    );
    assert.equal(f.container.querySelector('button'), null);
    await f.render(
        h(
            CompleteClearableTextInput,
            props({ initialMobile: true, enableInlineEdit: true })
        )
    );
    assert.ok(f.button());
    assert.equal(f.input().getAttribute('autocomplete'), null);
    await f.render(
        h(
            CompleteClearableTextInput,
            props({ initialMobile: false, enableInlineEdit: true })
        )
    );
    assert.ok(f.button());
    await f.render(
        h(
            CompleteClearableTextInput,
            props({ initialMobile: true, enableInlineEdit: false })
        )
    );
    assert.equal(f.container.querySelector('button'), null);
    assert.equal(f.input().getAttribute('autocomplete'), 'on');
});

it('retains original cleanup through callback A-B-A without rebinding to the returned callback', async (t) => {
    const f = await fixture(t);
    const events: string[] = [];
    const p = props({
        enableInlineEdit: true,
        onChange: (value) => events.push('A-mounted:' + value),
    });
    await f.render(h(CompleteClearableTextInput, p));
    await f.edit('pending');
    await f.render(
        h(CompleteClearableTextInput, {
            ...p,
            onChange: (value) => events.push('B-current:' + value),
        })
    );
    await f.render(
        h(CompleteClearableTextInput, {
            ...p,
            onChange: (value) => events.push('A-returned:' + value),
        })
    );
    await f.render(null);
    assert.deepEqual(events, ['A-mounted:pending']);
});

it('StrictMode and keyed owner replacement leave retirement policy with the captured native writer', async (t) => {
    const f = await fixture(t);
    const attempted: string[] = [];
    const accepted: string[] = [];
    const a = {};
    const b = {};
    const returnedA = {};
    let current = a;
    const owned = (key: string, owner: object, value: string) =>
        h(
            CompleteClearableTextInput,
            props({
                key,
                enableInlineEdit: true,
                value,
                onChange: (next) => {
                    attempted.push(key + ':' + next);
                    if (current === owner) accepted.push(key + ':' + next);
                },
            })
        );
    await f.render(owned('A', a, 'a'));
    assert.deepEqual(attempted, []);
    await f.edit('a-pending');
    current = b;
    await f.render(owned('B', b, 'b'));
    assert.deepEqual(attempted, ['A:a-pending']);
    assert.deepEqual(accepted, []);
    assert.equal(f.input().value, 'b');
    current = returnedA;
    await f.render(owned('A-returned', returnedA, 'a-new'));
    await f.edit('a-current');
    await f.blur();
    await f.render(null);
    assert.deepEqual(attempted, ['A:a-pending', 'A-returned:a-current']);
    assert.deepEqual(accepted, ['A-returned:a-current']);
});

it('resolves classic current mobile/tablet/desktop UA inputs without viewport heuristics', async (t) => {
    const f = await fixture(t);
    const cases: readonly [string, boolean][] = [
        [
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
            true,
        ],
        [
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
            false,
        ],
        [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            false,
        ],
    ];
    Object.defineProperty(f.window, 'innerWidth', {
        configurable: true,
        value: 280,
    });
    for (const [userAgent, expected] of cases) {
        Object.defineProperty(f.window.navigator, 'userAgent', {
            configurable: true,
            value: userAgent,
        });
        assert.equal(resolveCurrentClearableInputMobile(), expected);
    }
    f.unchangedEffects();
});

it('preserves real vendor current-navigator hints in an isolated browser-initialized module realm', () => {
    // UAParser binds its IIFE window at import. This child initializes actual
    // browser globals BEFORE importing the actual compiled public SDK entry,
    // rather than mutating a server-imported vendor cache or mocking UAParser.
    const script = [
        "import assert from 'node:assert/strict';",
        "import { Window } from 'happy-dom';",
        "const window = new Window({url:'https://mobile-policy.example.test/'});",
        "for (const key of ['window','document','navigator']) Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?window:window[key]});",
        'const { resolveCurrentClearableInputMobile } = await import(process.argv[1]);',
        'let entropyReads = 0;',
        'let requests = 0;',
        "const rejectRequest = () => { requests++; throw new Error('Unexpected device-policy request'); };",
        "Object.defineProperty(globalThis,'fetch',{configurable:true,value:rejectRequest});",
        "Object.defineProperty(window,'fetch',{configurable:true,value:rejectRequest});",
        "const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';",
        "const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';",
        'const set = (key,value) => Object.defineProperty(window.navigator,key,{configurable:true,value});',
        "set('userAgent', desktop);",
        "set('userAgentData',{mobile:true,getHighEntropyValues(){ entropyReads++; throw new Error('High entropy not permitted'); }});",
        'assert.equal(resolveCurrentClearableInputMobile(),true);',
        "set('userAgentData',{mobile:false,getHighEntropyValues(){ entropyReads++; throw new Error('High entropy not permitted'); }});",
        'assert.equal(resolveCurrentClearableInputMobile(),false);',
        "set('userAgent',mac);",
        "set('userAgentData',{mobile:true,getHighEntropyValues(){ entropyReads++; throw new Error('High entropy not permitted'); }});",
        "set('standalone',false);",
        "set('maxTouchPoints',5);",
        'assert.equal(resolveCurrentClearableInputMobile(),false);',
        'assert.equal(entropyReads,0);',
        'assert.equal(requests,0);',
        "assert.equal(window.location.href,'https://mobile-policy.example.test/');",
        'await window.happyDOM.close();',
        "process.stdout.write('bounded-current-device-ok');",
    ].join('\n');
    const result = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            script,
            new URL('../src/react/index.js', import.meta.url).href,
        ],
        { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'bounded-current-device-ok');
});
