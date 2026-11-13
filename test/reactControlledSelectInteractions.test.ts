import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import type {
    ControlledSelectChoice,
    ControlledSingleSelectFieldProps,
} from '../src/react/index.js';

const initialChoices: ControlledSelectChoice[] = [
    { id: 'a', name: 'Alpha', displayName: 'First' },
    { id: 'b', name: 'Beta', displayName: 'Second' },
];
async function fixture(t: TestContext) {
    const window = new Window();
    const globals = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'Node',
        'Event',
        'MouseEvent',
        'KeyboardEvent',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = globals.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of globals)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    // React DOM snapshots DOM/event support on first import. Install the real
    // fixture globals before loading either entry point, including flushSync.
    // The public barrel also loads the Rich Text portal runtime, so defer it.
    const { SingleSelectField } = await import('../src/react/index.js');
    const { flushSync } = await import('react-dom');
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    let token = {};
    let current = true;
    let accept = true;
    let readOnly = false;
    let presentation: 'list' | 'dropdown' = 'dropdown';
    let value: string | null = null;
    let choices = [...initialChoices];
    let receipt = false;
    const writes: (string | null)[] = [];
    const metadata: string[] = [];
    const parentEvents: string[] = [];
    let publication: ((name: string) => boolean | void) | undefined;
    const render = () =>
        root.render(
            h(
                StrictMode,
                null,
                h(
                    'div',
                    {
                        onClick: () => parentEvents.push('click'),
                        onPointerDown: () => parentEvents.push('pointerdown'),
                        onKeyDown: () => parentEvents.push('keydown'),
                    },
                    h(SingleSelectField, {
                        choices,
                        availableChoices: choices,
                        value,
                        owner: {
                            token,
                            isCurrent: () => current,
                            canContinueMetadataPublication: () => receipt,
                        },
                        presentation,
                        readOnly,
                        inputId: 'choice',
                        ariaLabel: 'Decision',
                        allowAddingNewOptions: true,
                        publishMetadata: (choice) => {
                            metadata.push(choice.name);
                            return publication?.(choice.name);
                        },
                        onValueChange: (next) => {
                            writes.push(next);
                            if (!accept) return false;
                            value = next;
                            render();
                        },
                    } satisfies ControlledSingleSelectFieldProps)
                )
            )
        );
    await act(async () => render());
    t.after(async () => {
        await act(async () => root.unmount());
        globals.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const focus = async () => {
        await act(async () => {
            input().focus();
            input().click();
        });
    };
    const type = async (text: string) => {
        await focus();
        await act(async () => {
            const node = input();
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )!.set!.call(node, text);
            node.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    const key = async (name: string, composing = false) => {
        await act(async () => {
            input().dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    bubbles: true,
                    key: name,
                    isComposing: composing,
                })
            );
        });
    };
    const option = (name: string) => {
        const node = [...container.querySelectorAll('[role=option]')].find(
            (node) => node.textContent === name
        );
        assert.ok(node);
        return node;
    };
    const create = async () => {
        const button = [...container.querySelectorAll('li')].find(
            (node) =>
                node.getAttribute('role') === 'option' &&
                node.textContent?.startsWith('Add new option')
        );
        assert.ok(button);
        await act(async () => button.click());
    };
    return {
        window,
        container,
        input,
        focus,
        type,
        key,
        option,
        create,
        writes,
        metadata,
        parentEvents,
        render,
        setAccept(next: boolean) {
            accept = next;
        },
        setOwner(next: object) {
            token = next;
        },
        setReadOnly(next: boolean) {
            readOnly = next;
        },
        setPresentation(next: 'list' | 'dropdown') {
            presentation = next;
        },
        setCurrent(next: boolean) {
            current = next;
        },
        setPublication(next: typeof publication) {
            publication = next;
        },
        publishAndFlush(name: string) {
            choices = [...choices, { id: '', name }];
            token = {};
            receipt = true;
            flushSync(render);
        },
        rerender: async () => {
            await act(async () => render());
        },
    };
}
function retainedClick(node: object) {
    const key = Object.keys(node).find((key) =>
        key.startsWith('__reactProps$')
    );
    assert.ok(key);
    const props: unknown = Reflect.get(node, key);
    assert.ok(props && typeof props === 'object');
    const action: unknown = Reflect.get(props, 'onClick');
    assert.equal(typeof action, 'function');
    return () => {
        if (typeof action === 'function') action({ stopPropagation() {} });
    };
}

it('dropdown searches displayed and canonical names, ignores IME Enter, selects by keyboard and Escape preserves focus', async (t) => {
    const f = await fixture(t);
    await f.type('Second');
    assert.equal(f.option('Second').textContent, 'Second');
    await f.key('Enter', true);
    assert.deepEqual(f.writes, []);
    await f.key('Enter');
    assert.deepEqual(f.writes, ['Beta']);
    assert.ok(
        f.window.document.activeElement === f.input(),
        'the combobox must retain focus'
    );
    await f.type('Alpha');
    assert.equal(f.option('First').textContent, 'First');
    await f.key('Escape');
    assert.equal(f.container.querySelector('[role=listbox]'), null);
    assert.ok(
        f.window.document.activeElement === f.input(),
        'the combobox must retain focus'
    );
    assert.deepEqual(f.writes, ['Beta']);
});

it('refused selection preserves canonical value and entered search, without a second writer', async (t) => {
    const f = await fixture(t);
    f.setAccept(false);
    await f.type('First');
    await f.key('Enter');
    assert.deepEqual(f.writes, ['Alpha']);
    assert.equal(f.input().value, 'First');
    assert.equal(
        f.container.querySelector('[aria-label="selected options"]')
            ?.textContent,
        ''
    );
    assert.deepEqual(f.metadata, []);
});

it('retained option actions cannot write through A/B/A replacement or a readonly transition', async (t) => {
    const f = await fixture(t);
    const a = {};
    f.setOwner(a);
    await f.rerender();
    await f.focus();
    const retained = retainedClick(f.option('First'));
    f.setOwner({});
    await f.rerender();
    f.setOwner(a);
    await f.rerender();
    await act(async () => retained());
    assert.deepEqual(f.writes, []);
    await f.focus();
    const fresh = retainedClick(f.option('First'));
    f.setReadOnly(true);
    await f.rerender();
    await act(async () => fresh());
    assert.deepEqual(f.writes, []);
});

it('metadata owner retirement stops value publication and does not retry against a successor', async (t) => {
    const f = await fixture(t);
    f.setPublication(() => {
        f.setCurrent(false);
    });
    await f.type('New');
    await f.create();
    assert.deepEqual(f.metadata, ['New']);
    assert.deepEqual(f.writes, []);
});

it('an exact metadata receipt continues through a synchronous metadata-only render', async (t) => {
    const f = await fixture(t);
    f.setPublication((name) => {
        f.publishAndFlush(name);
    });
    await f.type('New');
    await f.create();
    assert.deepEqual(f.metadata, ['New']);
    assert.deepEqual(f.writes, ['New']);
    assert.equal(
        f.container
            .querySelector('[aria-label="selected options"]')
            ?.textContent?.includes('New'),
        true
    );
});

it('dropdown Arrow/Home/End navigation uses current offers and Tab never commits', async (t) => {
    const f = await fixture(t);
    await f.focus();
    await f.key('ArrowDown');
    const first = f.input().getAttribute('aria-activedescendant');
    assert.ok(first);
    assert.equal(f.window.document.getElementById(first)?.textContent, 'First');
    await f.key('End');
    const last = f.input().getAttribute('aria-activedescendant');
    assert.ok(last);
    assert.equal(f.window.document.getElementById(last)?.textContent, 'Second');
    await f.key('Home');
    assert.equal(f.input().getAttribute('aria-activedescendant'), first);
    await f.key('Tab');
    assert.deepEqual(f.writes, []);
    assert.equal(f.container.querySelector('[role=listbox]'), null);
});

it('list Add Choice retains prompt cancellation/equivalent-label suppression and one admission while busy', async (t) => {
    const f = await fixture(t);
    f.setPresentation('list');
    await f.rerender();
    assert.equal(f.container.querySelector('input:not([type=radio])'), null);
    let answer: string | null = null;
    let prompts = 0;
    Object.defineProperty(f.window, 'prompt', {
        configurable: true,
        value: () => {
            prompts++;
            return answer;
        },
    });
    const add = () => {
        const button = [...f.container.querySelectorAll('button')].find(
            (node) => node.textContent === 'Add new option'
        );
        assert.ok(button);
        return button;
    };
    await act(async () => add().click());
    assert.equal(prompts, 1);
    assert.deepEqual(f.metadata, []);
    assert.deepEqual(f.writes, []);
    answer = '  First  ';
    await act(async () => add().click());
    assert.deepEqual(f.metadata, []);
    assert.deepEqual(f.writes, []);
    answer = '  New  ';
    await act(async () => {
        const button = add();
        button.click();
        button.click();
    });
    assert.deepEqual(f.metadata, ['New']);
    assert.deepEqual(f.writes, ['New']);
    assert.equal(prompts, 3);
});

it('readonly Select content lets the host activate its grid cell while editable controls contain events', async (t) => {
    const f = await fixture(t);
    for (const readOnly of [false, true]) {
        f.setReadOnly(readOnly);
        await f.rerender();
        f.parentEvents.length = 0;
        const control = f.container.querySelector('.mx-sdk-select')!;
        await act(async () => {
            for (const type of ['click', 'pointerdown', 'keydown'])
                control.dispatchEvent(
                    new f.window.Event(type, { bubbles: true })
                );
        });
        assert.deepEqual(
            f.parentEvents,
            readOnly ? ['click', 'pointerdown', 'keydown'] : []
        );
        assert.deepEqual(f.writes, []);
    }
});
