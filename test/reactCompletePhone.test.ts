import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, createElement as h, createRef, StrictMode } from 'react';
import {
    CompletePhoneNumberField,
    PhoneNumberField,
    type CompletePhoneNumberFieldProps,
    type CompletePhoneCommit,
} from '../src/react/index.js';

/** Real vendor/React events; no native renderer, SDK client or parser substitute. */
async function fixture(
    t: TestContext,
    args: {
        api?: 'complete' | 'canonical';
        country?: boolean;
        deferred?: boolean;
        value?: string | null;
        mobile?: boolean;
        defaultCountry?: string;
    } = {}
) {
    const window = new Window();
    if (args.mobile)
        Object.defineProperty(window.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
        'IS_REACT_ACT_ENVIRONMENT',
        'fetch',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let requests = 0;
    const refuseRequest = async () => {
        requests++;
        throw Error('Unexpected Phone request');
    };
    Object.defineProperty(window, 'fetch', { value: refuseRequest });
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? refuseRequest
                      : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    const form = window.document.createElement('form');
    form.id = 'standalone-phone';
    const adjacent = window.document.createElement('p');
    adjacent.textContent = 'Adjacent value unchanged';
    form.append(container, adjacent);
    window.document.body.append(form);
    const root = createRoot(container as unknown as HTMLElement);
    const inputRef = createRef<HTMLInputElement>();
    let mounted = true;
    let submits = 0;
    let callbacks = 0;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const state = {
        value: args.value as string | null | undefined,
        country: args.country ?? false,
        deferred: args.deferred ?? false,
        defaultCountry: args.defaultCountry,
        readOnly: false,
        disabled: false,
        current: true,
        owner: {},
        target: 'session-A/field-phone/record-A/table-A',
        hint: 'Enter phone',
        feedback: 'phone-help',
        invalid: false,
        clear: args.mobile ? ('mobile' as const) : ('never' as const),
        enforceOwner: true,
        settle: true,
    };
    // Snapshot empty-array assertions so Node assert does not narrow this live
    // callback list to never[] across later asynchronous vendor delivery.
    const writes: Array<{
        value: string | undefined;
        target: string;
        commit: CompletePhoneCommit;
    }> = [];
    const invocations: Array<{
        value: string | undefined;
        target: string;
        commit: CompletePhoneCommit;
        allowedAtCall: boolean;
    }> = [];
    const publish = () => {
        if (!mounted) return;
        const owner = state.owner;
        const target = state.target;
        callbacks++;
        const common = {
            value: state.value,
            showCountryCodes: state.country,
            defaultCountry: state.defaultCountry,
            readOnly: state.readOnly,
            disabled: state.disabled,
            clearButton: state.clear,
            clearLabel: 'Effacer le téléphone',
            settleOnUnmount: state.settle,
            inputRef,
            input: {
                id: 'phone-input',
                name: 'phone',
                form: form.id,
                'aria-label': 'Contact phone',
                'aria-describedby': state.feedback,
                'aria-invalid': state.invalid,
                placeholder: state.hint,
            },
            onValueChange(
                value: string | undefined,
                commit: CompletePhoneCommit
            ) {
                const allowedAtCall =
                    state.current &&
                    (!state.enforceOwner || state.owner === owner) &&
                    !state.readOnly &&
                    !state.disabled;
                // Observe the SDK's attempted host call before any fixture guard.
                // A negative test must prove no invocation, not merely no write.
                invocations.push({ value, target, commit, allowedAtCall });
                if (!allowedAtCall) return;
                assert.equal(commit.ownerToken, owner);
                writes.push({ value, target, commit });
                state.value = value;
                publish();
            },
        };
        const ownerOption = {
            token: owner,
            isCurrent: () =>
                state.current && (!state.enforceOwner || state.owner === owner),
        };
        const props: CompletePhoneNumberFieldProps = state.deferred
            ? { ...common, commit: 'deferred', owner: ownerOption }
            : { ...common, commit: 'immediate', owner: ownerOption };
        root.render(
            h(
                StrictMode,
                null,
                args.api === 'canonical'
                    ? h(PhoneNumberField, props)
                    : h(CompletePhoneNumberField, props)
            )
        );
    };
    const render = async () => {
        await act(async () => publish());
    };
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const select = () => {
        const node = container.querySelector('select');
        assert.ok(node);
        return node;
    };
    const focus = async () => {
        await act(async () => input().focus());
    };
    const blur = async () => {
        await act(async () => input().blur());
    };
    const dispatchEdit = (value: string, inputType = 'insertText') => {
        Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        )!.set!.call(input(), value);
        input().setSelectionRange(value.length, value.length);
        input().dispatchEvent(
            new window.InputEvent('input', {
                bubbles: true,
                inputType,
                data: value,
            })
        );
    };
    const edit = async (value: string, inputType = 'insertText') => {
        await act(async () => dispatchEdit(value, inputType));
    };
    const key = async (name: string, composing = false) => {
        const event = new window.KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: name,
            code: name,
            keyCode: name === 'Backspace' ? 8 : name === 'Enter' ? 13 : 0,
            isComposing: composing,
        });
        await act(async () => {
            input().dispatchEvent(event);
        });
        return event;
    };
    const paste = async (text: string) => {
        await focus();
        await act(async () => {
            const node = input();
            node.setSelectionRange(0, node.value.length);
            const data = new window.DataTransfer();
            data.setData('text/plain', text);
            const event = new window.ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: data,
            });
            node.dispatchEvent(event);
            if (!event.defaultPrevented) {
                // happy-dom does not perform the browser's default paste mutation.
                // Apply that mutation, then let the real vendor parse/format it.
                const start = node.selectionStart ?? 0;
                const end = node.selectionEnd ?? 0;
                node.setRangeText(text, start, end);
                node.setSelectionRange(
                    start + text.length,
                    start + text.length
                );
                node.dispatchEvent(
                    new window.InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertFromPaste',
                        data: text,
                    })
                );
            }
        });
    };
    const country = async (code: string) => {
        await act(async () => {
            select().value = code;
            select().dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
        });
    };
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
    };
    t.after(async () => {
        try {
            await unmount();
            assert.equal(
                submits,
                0,
                'deferred Enter and Clear must not submit'
            );
            assert.equal(adjacent.textContent, 'Adjacent value unchanged');
            assert.equal(requests, 0);
            assert.deepEqual(
                invocations.filter((call) => !call.allowedAtCall),
                [],
                'SDK retirement must prevent disallowed host callbacks before the fixture guard'
            );
        } finally {
            keys.forEach((key, index) => {
                const before = originals[index];
                if (before) Object.defineProperty(globalThis, key, before);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    await render();
    return {
        state,
        writes,
        invocations,
        invocationCount: () => invocations.length,
        container,
        form,
        window,
        inputRef,
        input,
        select,
        focus,
        blur,
        edit,
        dispatchEdit,
        publish,
        key,
        paste,
        country,
        render,
        unmount,
        callbacks: () => callbacks,
    };
}

it('plain input keeps literal values and native form/ref/ARIA associations', async (t) => {
    const f = await fixture(t);
    const input = f.input();
    assert.equal(input.type, 'tel');
    assert.equal(input.autocomplete, 'off');
    assert.equal(input.name, 'phone');
    assert.equal(input.getAttribute('form'), f.form.id);
    assert.equal(input.getAttribute('aria-describedby'), 'phone-help');
    assert.equal(f.inputRef.current, input);
    assert.equal(f.container.querySelector('select'), null);
    for (const value of [
        '  +33 (0)1 23 45 67 89  ',
        'tel:+1202;ext=42',
        'not a phone',
        '',
    ]) {
        await f.edit(value);
        assert.equal(f.input(), input);
        assert.equal(input.value, value);
        assert.equal(f.writes.at(-1)?.value, value);
        assert.equal(f.writes.at(-1)?.commit.reason, 'input');
    }
});

it('country inference/default and metadata-only rerenders retain the real input/caret without writes', async (t) => {
    const f = await fixture(t, {
        country: true,
        value: '+14155552671',
        defaultCountry: 'GH',
    });
    const input = f.input();
    assert.equal(f.select().value, 'US');
    assert.equal(input.value, '+1 415 555 2671');
    assert.equal(input.autocomplete, 'tel');
    assert.equal(f.container.querySelector('img'), null);
    await f.focus();
    input.setSelectionRange(5, 5);
    f.state.defaultCountry = 'GB';
    f.state.hint = 'Updated phone hint';
    f.state.feedback = 'help-current error-current';
    f.state.invalid = true;
    await f.render();
    assert.equal(f.input(), input);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(input.selectionStart, 5);
    assert.equal(f.select().value, 'US');
    assert.equal(input.placeholder, 'Updated phone hint');
    assert.equal(
        input.getAttribute('aria-describedby'),
        'help-current error-current'
    );
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(f.writes.slice(), []);
});

it('actual immediate vendor parsing supports malformed clearing, retry and International selection', async (t) => {
    const f = await fixture(t, { country: true });
    assert.equal(f.select().value, 'ZZ');
    await f.focus();
    await f.edit('not a phone');
    assert.equal(f.writes.at(-1)?.value, undefined);
    await f.edit('+233501112222');
    assert.equal(f.writes.at(-1)?.value, '+233501112222');
    assert.equal(f.select().value, 'GH');
    await f.country('ZZ');
    assert.equal(f.select().value, 'ZZ');
});

for (const country of [false, true])
    for (const commit of ['blur', 'Enter'] as const)
        it(`keeps ${country ? 'formatted' : 'literal'} deferred typing local until ${commit}`, async (t) => {
            const f = await fixture(t, {
                country,
                deferred: true,
                value: '+14155552671',
            });
            const input = f.input();
            await f.focus();
            const typed = country
                ? '+44 (20) 7946-0958'
                : '  literal phone ext. 42  ';
            await f.edit(typed, 'insertFromPaste');
            assert.equal(input.value, typed);
            assert.deepEqual(f.writes.slice(), []);
            if (country)
                assert.equal(
                    f.select().value,
                    'US',
                    'vendor has not consumed deferred typing'
                );
            input.setSelectionRange(6, 6);
            f.state.hint = 'Hint changed during typing';
            f.state.feedback = 'replacement-help';
            await f.render();
            assert.equal(f.input(), input);
            assert.equal(input.value, typed);
            assert.equal(input.selectionStart, 6);
            assert.deepEqual(f.writes.slice(), []);
            if (commit === 'Enter') {
                const event = await f.key('Enter');
                assert.equal(event.defaultPrevented, true);
            } else await f.blur();
            assert.equal(f.writes.length, 1);
            assert.equal(f.writes[0].value, country ? '+442079460958' : typed);
            assert.equal(
                f.writes[0].commit.reason,
                commit === 'Enter' ? 'enter' : 'blur'
            );
            assert.equal(
                f.writes[0].target,
                'session-A/field-phone/record-A/table-A'
            );
            await f.unmount();
            assert.equal(f.writes.length, 1);
        });

it('deferred country Backspace leaves browser default editing intact and does not run vendor key surgery', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        value: '+14155552671',
    });
    await f.focus();
    const input = f.input();
    const before = input.value;
    const event = new f.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace',
        code: 'Backspace',
        keyCode: 8,
    });
    await act(async () => input.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    assert.equal(
        input.value,
        before,
        'Happy DOM has not performed the browser default deletion'
    );
    await f.edit(before.slice(0, -1), 'deleteContentBackward');
    assert.deepEqual(f.writes.slice(), []);
    await f.blur();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, '+1415555267');
});

it('non-phone deferred country text is refused locally and IME Enter does not settle or submit', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        value: '+14155552671',
    });
    await f.focus();
    await f.edit('not a phone');
    assert.equal(f.input().value, '+1 415 555 2671');
    await f.edit('+1 415 555 2672');
    const composingEnter = await f.key('Enter', true);
    assert.equal(composingEnter.defaultPrevented, true);
    assert.equal(f.window.document.activeElement, f.input());
    assert.deepEqual(f.writes.slice(), []);
    const enter = await f.key('Enter');
    assert.equal(enter.defaultPrevented, true);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, '+14155552672');
});

it('country selection publishes immediately even while the input commit mode is deferred', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        defaultCountry: 'GH',
    });
    assert.equal(f.select().value, 'GH');
    assert.deepEqual(f.writes.slice(), []);
    await f.country('GB');
    assert.equal(f.select().value, 'GB');
    assert.equal(f.writes.length, 1);
    // Country selection uses e164 directly; +44 is a canonical partial value.
    assert.equal(f.writes[0].value, '+44');
    assert.equal(f.writes[0].commit.reason, 'input');
    await f.unmount();
    assert.equal(f.writes.length, 1);
});

for (const deferred of [false, true])
    for (const value of ['+14155552671', undefined])
        it(`actual mobile Clear preserves native canonical re-emission and display (deferred=${deferred}, full=${value != null})`, async (t) => {
            const f = await fixture(t, {
                country: true,
                deferred,
                mobile: true,
                value,
                defaultCountry: 'GH',
            });
            const input = f.input();
            const before = input.value;
            const selected = f.select().value;
            await f.focus();
            const clear = f.container.querySelector('button');
            assert.ok(clear);
            assert.equal(clear.type, 'button');
            assert.equal(
                clear.getAttribute('aria-label'),
                'Effacer le téléphone'
            );
            await act(async () => {
                const down = new f.window.MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                });
                clear.dispatchEvent(down);
                assert.equal(down.defaultPrevented, false);
                // Browser pointer default focus; Happy DOM click() does not do it.
                clear.focus();
                clear.click();
            });
            assert.equal(f.input(), input);
            assert.equal(f.window.document.activeElement === input, false);
            assert.equal(input.value, deferred ? '' : before);
            assert.equal(f.select().value, selected);
            assert.equal(f.writes.length, 1);
            assert.equal(f.writes[0].value, value);
            assert.equal(f.writes[0].commit.reason, 'clear');
            await f.unmount();
            assert.equal(f.writes.length, 1);
        });

it('queued Clear then country change keeps distinct captured actions without refilling an unmount draft', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        mobile: true,
        defaultCountry: 'GH',
    });
    await f.focus();
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    await act(async () => {
        clear.focus();
        clear.click();
        f.select().value = 'GB';
        f.select().dispatchEvent(
            new f.window.Event('change', { bubbles: true })
        );
    });
    assert.deepEqual(
        f.writes.map(({ value, commit }) => ({ value, reason: commit.reason })),
        [
            { value: undefined, reason: 'clear' },
            { value: '+44', reason: 'input' },
        ]
    );
    assert.equal(f.select().value, 'GB');
    await f.unmount();
    assert.equal(f.writes.length, 2);
});

it('plain mobile Clear remains literal empty and disarms unmount settlement', async (t) => {
    const f = await fixture(t, {
        deferred: true,
        mobile: true,
        value: 'plain number',
    });
    await f.focus();
    const input = f.input();
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    await act(async () => {
        clear.focus();
        clear.click();
    });
    assert.equal(f.input(), input);
    assert.equal(input.value, '');
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, '');
    assert.equal(f.writes[0].commit.reason, 'clear');
    await f.unmount();
    assert.equal(f.writes.length, 1);
});

for (const country of [false, true])
    for (const admitted of [true, false])
        it(`actual detached ${country ? 'country' : 'plain'} unmount ${admitted ? 'settles once' : 'rejects'}`, async (t) => {
            const f = await fixture(t, {
                country,
                deferred: true,
                value: '+14155552671',
            });
            await f.focus();
            const input = f.input();
            await f.edit('+44 (20) 7946-0958', 'insertFromPaste');
            assert.deepEqual(f.writes.slice(), []);
            f.state.current = admitted;
            await f.unmount();
            assert.equal(input.isConnected, false);
            assert.equal(f.inputRef.current, null);
            assert.equal(f.writes.length, admitted ? 1 : 0);
            assert.equal(f.invocationCount(), admitted ? 1 : 0);
            assert.deepEqual(
                f.invocations.filter((call) => !call.allowedAtCall),
                []
            );
            if (admitted) {
                assert.equal(
                    f.writes[0].value,
                    country ? '+442079460958' : '+44 (20) 7946-0958'
                );
                assert.equal(f.writes[0].commit.reason, 'unmount');
                assert.equal(
                    f.writes[0].target,
                    'session-A/field-phone/record-A/table-A'
                );
            }
        });

it('explicit no-settlement unmount drops the draft without invoking the host', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        value: '+14155552671',
    });
    await f.focus();
    await f.edit('+44 (20) 7946-0958');
    f.state.settle = false;
    await f.render();
    await f.unmount();
    assert.deepEqual(f.writes.slice(), []);
    assert.equal(f.invocationCount(), 0);
});

it('committed owner A→B→A and readonly/mode replacement cannot transfer a deferred draft', async (t) => {
    const f = await fixture(t, { deferred: true, value: 'baseline' });
    const original = f.state.owner;
    await f.focus();
    await f.edit('discard old A');
    f.state.owner = {};
    f.state.target = 'session-B/field-phone/record-B/table-B';
    await f.render();
    f.state.owner = original;
    f.state.target = 'session-A/field-phone/record-A/table-A';
    await f.render();
    await f.focus();
    await f.blur();
    assert.deepEqual(f.writes.slice(), []);
    assert.equal(f.invocationCount(), 0);
    await f.focus();
    await f.edit('discard on readonly');
    f.state.readOnly = true;
    await f.render();
    assert.equal(f.input().disabled, true);
    f.state.readOnly = false;
    await f.render();
    await f.focus();
    await f.blur();
    assert.deepEqual(f.writes.slice(), []);
    assert.equal(f.invocationCount(), 0);
    await f.focus();
    await f.edit('discard on country mode');
    f.state.country = true;
    await f.render();
    f.state.country = false;
    await f.render();
    assert.deepEqual(f.writes.slice(), []);
    assert.equal(f.invocationCount(), 0);
    await f.focus();
    await f.edit('fresh current A');
    await f.blur();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, 'fresh current A');
});

it('a pending country draft cannot settle across committed owner A→B→A even while both host targets remain permitted', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        value: '+14155552671',
    });
    // Both records remain host-authorized. The SDK's committed generation, not
    // a fixture callback filter, must retire the old editor's unmount replay.
    f.state.enforceOwner = false;
    const originalOwner = f.state.owner;
    await f.focus();
    await f.edit('+44 (20) 7946-0958');
    assert.deepEqual(f.writes.slice(), []);
    assert.equal(f.invocationCount(), 0);
    f.state.owner = {};
    f.state.target = 'session-B/field-phone/record-B/table-B';
    f.state.value = '+233201234567';
    await f.render();
    assert.deepEqual(f.writes.slice(), []);
    assert.equal(f.invocationCount(), 0);
    assert.equal(f.input().value, '+233 20 123 4567');
    f.state.owner = originalOwner;
    f.state.target = 'session-A/field-phone/record-A/table-A';
    f.state.value = '+14155552671';
    await f.render();
    assert.equal(f.invocationCount(), 0);
    assert.equal(f.input().value, '+1 415 555 2671');
    await f.focus();
    await f.edit('+14155552672');
    assert.equal(f.invocationCount(), 0);
    await f.blur();
    assert.equal(f.invocationCount(), 1);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, '+14155552672');
    assert.equal(f.writes[0].target, 'session-A/field-phone/record-A/table-A');
    assert.equal(f.writes[0].commit.reason, 'blur');
});

it('server renders real country formatting and native associations without a document or a host write', async () => {
    assert.equal(typeof globalThis.document, 'undefined');
    let writes = 0;
    const html = renderToStaticMarkup(
        h(CompletePhoneNumberField, {
            value: '+14155552671',
            showCountryCodes: true,
            defaultCountry: 'GH',
            onValueChange() {
                writes++;
            },
            input: {
                id: 'ssr-phone',
                form: 'existing-form',
                'aria-label': 'Contact phone',
            },
        })
    );
    const window = new Window();
    try {
        window.document.body.innerHTML = html;
        const input = window.document.querySelector('input');
        assert.ok(input);
        assert.equal(input.value, '+1 415 555 2671');
        assert.equal(input.getAttribute('form'), 'existing-form');
        assert.equal(input.getAttribute('aria-label'), 'Contact phone');
        // React SSR declares exactly one selected option. Happy DOM 20's
        // incremental option attachment can misassign the selected property;
        // it is not the serialization oracle. CSR selection is tested above.
        const selected = html.match(/<option\b[^>]*\sselected=""[^>]*>/g) ?? [];
        assert.equal(selected.length, 1);
        assert.ok(selected[0].includes(' value="US"'));
        assert.equal(window.document.querySelector('img'), null);
        assert.equal(writes, 0);
    } finally {
        await window.happyDOM.close();
    }
});

it('queued deferred typing→blur→Clear retains both native canonical actions without duplicate cleanup', async (t) => {
    const f = await fixture(t, {
        country: true,
        deferred: true,
        mobile: true,
        value: '+14155552671',
    });
    await f.focus();
    const input = f.input();
    await f.edit('+44 (20) 7946-0958');
    assert.deepEqual(f.writes.slice(), []);
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    await act(async () => {
        clear.focus();
        clear.click();
    });
    assert.deepEqual(
        f.writes.map(({ value, commit }) => ({ value, reason: commit.reason })),
        [
            { value: '+442079460958', reason: 'blur' },
            { value: '+442079460958', reason: 'clear' },
        ]
    );
    assert.equal(f.input(), input);
    assert.equal(f.window.document.activeElement === input, false);
    // A changed formatted vendor value may reconcile presentation, as in the
    // native value effect. This case proves action/value attribution, not a new
    // persistent-blank policy for a simultaneous canonical value replacement.
    await f.unmount();
    assert.equal(f.writes.length, 2);
});

it('natural PhoneNumberField preserves controlled null, literal input and empty-string Clear without implicit writes', async (t) => {
    const f = await fixture(t, { api: 'canonical', value: null, mobile: true });
    assert.equal(f.input().type, 'tel');
    assert.equal(f.input().value, '');
    assert.equal(f.input().getAttribute('form'), f.form.id);
    assert.equal(f.input().getAttribute('aria-describedby'), 'phone-help');
    assert.equal(f.inputRef.current, f.input());
    assert.equal(f.invocationCount(), 0);
    f.state.value = undefined;
    await f.render();
    assert.equal(f.invocationCount(), 0);
    await f.edit('  malformed telephone  ');
    assert.equal(f.writes.at(-1)?.value, '  malformed telephone  ');
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    await act(async () => clear.click());
    assert.equal(f.writes.at(-1)?.value, '');
    assert.equal(f.writes.at(-1)?.commit.reason, 'clear');
    await f.unmount();
    assert.equal(f.writes.length, 2);
});

it('natural PhoneNumberField retires deferred A→B→A drafts and accepts only the fresh owner input', async (t) => {
    const f = await fixture(t, {
        api: 'canonical',
        deferred: true,
        value: 'Original A',
    });
    const originalOwner = f.state.owner;
    const originalTarget = f.state.target;
    await f.focus();
    await f.edit('Retired A draft');
    f.state.owner = {};
    f.state.target = 'session-B/field-phone/record-B/table-B';
    f.state.value = 'Stored B';
    await f.render();
    f.state.owner = originalOwner;
    f.state.target = originalTarget;
    f.state.value = 'Restored A';
    await f.render();
    await f.blur();
    assert.equal(f.invocationCount(), 0);
    assert.equal(f.input().value, 'Restored A');
    await f.focus();
    await f.edit('Fresh A');
    await f.key('Enter');
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0]!.value, 'Fresh A');
    assert.equal(f.writes[0]!.commit.reason, 'enter');
    assert.equal(f.writes[0]!.target, originalTarget);
});

it('natural PhoneNumberField retains both real country blur→Clear callbacks in native order', async (t) => {
    const f = await fixture(t, {
        api: 'canonical',
        country: true,
        deferred: true,
        mobile: true,
        value: '+14155552671',
    });
    await f.focus();
    await f.edit('+44 (20) 7946-0958');
    assert.equal(f.invocationCount(), 0);
    const clear = f.container.querySelector('button');
    assert.ok(clear);
    await act(async () => {
        clear.focus();
        clear.click();
    });
    assert.deepEqual(
        f.writes.map(({ value, commit }) => ({ value, reason: commit.reason })),
        [
            { value: '+442079460958', reason: 'blur' },
            { value: '+442079460958', reason: 'clear' },
        ]
    );
    await f.unmount();
    assert.equal(f.writes.length, 2);
});
