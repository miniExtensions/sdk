import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteExtensionPasswordScreen,
    type CompleteExtensionPasswordScreenProps,
    type CompleteExtensionPasswordScreenResult,
} from '../src/react/CompleteExtensionPasswordScreen.js';

const scope = { ownerId: 'first', revision: 0 };
const labels = {
    password: 'Password',
    submit: 'Submit',
    pending: 'Checking password',
    wrong: 'Incorrect password',
    blocked: 'Too many attempts',
    error: 'Unable to check password',
};
const ignoredVerify = async () => {
    assert.fail('Unexpected verification');
};

async function setup(t: TestContext) {
    const window = new Window();
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        try {
            await act(async () => root.unmount());
        } finally {
            for (const [key, original] of originals) {
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });

    const query = <Selector extends 'input' | 'button' | 'form'>(
        selector: Selector
    ) => {
        const element = container.querySelector(selector);
        assert.ok(element);
        return element;
    };
    const input = () => query('input');
    const submit = () => {
        const event = new window.Event('submit', {
            bubbles: true,
            cancelable: true,
        });
        query('form').dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
    };
    const requests: string[] = [];
    const attempts: Array<{
        resolve: (result: CompleteExtensionPasswordScreenResult) => void;
        reject: (error: Error) => void;
    }> = [];
    const props: CompleteExtensionPasswordScreenProps = {
        scope,
        labels,
        verifyPassword: (password) => {
            requests.push(password);
            return new Promise((resolve, reject) =>
                attempts.push({ resolve, reject })
            );
        },
    };
    return {
        requests,
        attempts,
        input,
        submit,
        button: () => query('button'),
        feedback: () => container.querySelector('[role=alert]'),
        status: () => container.querySelector('[role=status]')?.textContent,
        render: async (
            patch: Partial<CompleteExtensionPasswordScreenProps> = {}
        ) =>
            act(async () =>
                root.render(
                    h(
                        StrictMode,
                        null,
                        h(CompleteExtensionPasswordScreen, {
                            ...props,
                            ...patch,
                        })
                    )
                )
            ),
        edit: async (value: string) =>
            act(async () => {
                const set = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )?.set;
                assert.ok(set);
                set.call(input(), value);
                input().dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            }),
    };
}

it('renders independent accessible SSR prompts without contacting the host', () => {
    const props = { scope, labels, verifyPassword: ignoredVerify };
    const html = renderToString(
        h(
            'main',
            null,
            h(CompleteExtensionPasswordScreen, props),
            h(CompleteExtensionPasswordScreen, {
                ...props,
                className: 'custom',
                accentColor: '#0f766e',
            })
        )
    );
    const labelIds = [...html.matchAll(/<label for="([^"]+)"/g)].map(
        (match) => match[1]
    );
    const inputIds = [...html.matchAll(/<input[^>]* id="([^"]+)"/g)].map(
        (match) => match[1]
    );
    assert.deepEqual(inputIds, labelIds);
    assert.equal(new Set(labelIds).size, 2);
    assert.equal([...html.matchAll(/type="submit" disabled=""/g)].length, 2);
    assert.equal([...html.matchAll(/type="password"/g)].length, 2);
    assert.match(html, /mx-sdk-extension-password custom/);
    assert.match(html, /--mx-sdk-extension-password-accent:#0f766e/);
});

it('submits the exact draft once, permits editing and retries, then locks a blocked owner', async (t) => {
    const screen = await setup(t);
    await screen.render();
    assert.equal(screen.button().disabled, true);
    await act(async () => screen.submit());
    assert.equal(screen.requests.length, 0);
    const expected = '  a\u200Dbß!?  ';
    await screen.edit(expected);
    assert.equal(screen.input().hasAttribute('value'), false);
    await act(async () => {
        screen.submit();
        screen.submit();
    });
    assert.equal(screen.requests.length, 1);
    assert.equal(screen.requests[0] === expected, true);
    assert.equal(screen.button().disabled, true);
    assert.equal(screen.input().disabled, false);
    assert.equal(screen.input().readOnly, false);
    assert.equal(screen.status(), labels.pending);
    await screen.edit('corrected');
    assert.equal(screen.input().hasAttribute('value'), false);
    await act(async () => {
        screen.submit();
        screen.attempts[0].resolve({ type: 'wrong' });
    });
    assert.equal(screen.requests.length, 1);
    assert.equal(screen.feedback()?.textContent, labels.wrong);
    assert.equal(
        screen.input().getAttribute('aria-describedby'),
        screen.feedback()?.id
    );
    assert.equal(screen.input().getAttribute('aria-invalid'), 'true');
    assert.equal(screen.button().disabled, false);
    assert.equal(screen.input().value, 'corrected');
    await screen.render({ scope: { ...scope } });
    assert.equal(screen.input().value, 'corrected');
    await act(async () => screen.submit());
    assert.deepEqual(screen.requests.slice(1), ['corrected']);
    await act(async () => screen.attempts[1].resolve({ type: 'blocked' }));
    await screen.edit('still editable');
    await act(async () => screen.submit());
    assert.equal(screen.requests.length, 2);
    assert.equal(screen.button().disabled, true);
    assert.equal(screen.feedback()?.textContent, labels.blocked);
});

it('retires blocked and late outcomes across owner and revision changes, including A–B–A', async (t) => {
    const screen = await setup(t);
    await screen.render();
    await screen.edit('retired draft');
    await act(async () => screen.submit());
    await screen.render({ scope: { ownerId: 'second', revision: 0 } });
    assert.equal(screen.input().value, '');
    assert.equal(screen.feedback(), null);
    await screen.edit('second draft');
    await act(async () => screen.submit());
    await act(async () => screen.attempts[1].resolve({ type: 'blocked' }));
    assert.equal(screen.button().disabled, true);
    assert.equal(screen.feedback()?.textContent, labels.blocked);
    await screen.render();
    assert.equal(screen.input().value, '');
    assert.equal(screen.feedback(), null);
    await screen.edit('fresh first draft');
    await act(async () => screen.submit());
    await act(async () => screen.attempts[0].resolve({ type: 'blocked' }));
    assert.equal(screen.status(), labels.pending);
    assert.equal(screen.feedback(), null);
    assert.equal(screen.input().value, 'fresh first draft');
    await screen.render({ scope: { ...scope, revision: 1 } });
    await act(async () =>
        screen.attempts[2].reject(new Error('retired diagnostic'))
    );
    assert.equal(screen.status(), '');
    assert.equal(screen.feedback(), null);
    assert.equal(screen.input().value, '');
});

it('renders localized generic failure and clears and locks after an accepted result', async (t) => {
    const screen = await setup(t);
    await screen.render();
    await screen.edit('synthetic value');
    await act(async () => screen.submit());
    await act(async () =>
        screen.attempts[0].reject(new Error('private synthetic diagnostic'))
    );
    assert.equal(screen.feedback()?.textContent, labels.error);
    assert.equal(screen.button().disabled, false);
    await act(async () => screen.submit());
    await act(async () => screen.attempts[1].resolve({ type: 'error' }));
    assert.equal(screen.feedback()?.textContent, labels.error);
    await act(async () => screen.submit());
    await act(async () => screen.attempts[2].resolve({ type: 'correct' }));
    assert.equal(screen.input().value, '');
    assert.equal(screen.feedback(), null);
    assert.equal(screen.input().hasAttribute('aria-describedby'), false);
    await screen.edit('after acceptance');
    await act(async () => screen.submit());
    assert.equal(screen.button().disabled, true);
    assert.equal(screen.requests.length, 3);
});
