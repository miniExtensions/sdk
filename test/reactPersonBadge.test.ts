import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ReactNode,
    type FormEvent,
} from 'react';
import { PersonBadge } from '../src/react/index.js';

async function fixture(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
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
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
    };
}

it('retains a native list item/ref, literal supplied label, avatar slot and caller classes/ARIA', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLLIElement>();
    const label = '<img src="https://synthetic.invalid/private"> & Person';
    await f.render(
        h(
            'ul',
            null,
            h(PersonBadge, {
                ref,
                label,
                id: 'person',
                className: 'root',
                'aria-describedby': 'help',
                avatar: h('span', { 'data-avatar': 'caller' }, 'Avatar'),
                avatarClassName: 'avatar',
                bodyClassName: 'body',
                labelClassName: 'label',
            })
        )
    );
    const li = f.container.querySelector('li');
    assert(li);
    assert.equal(ref.current, li);
    assert.equal(li.id, 'person');
    assert.equal(li.className, 'root');
    assert.equal(li.getAttribute('aria-describedby'), 'help');
    assert.equal(
        li.querySelector('.avatar > [data-avatar]')?.textContent,
        'Avatar'
    );
    assert.equal(li.querySelector('.body > .label')?.textContent, label);
    assert.equal(li.querySelector('.label')?.getAttribute('style'), null);
    assert.equal(li.querySelector('img'), null);
    assert.equal(li.querySelector('button'), null);
    await f.render(null);
    assert.equal(ref.current, null);
});

it('uses a native non-submit removal button, current caller handler and disabled/read-only presentation', async (t) => {
    const f = await fixture(t);
    let submissions = 0;
    const writes: string[] = [];
    const render = (disabled = false, readOnly = false) =>
        f.render(
            h(
                'form',
                {
                    onSubmit: (event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        submissions++;
                    },
                },
                h(
                    'ul',
                    null,
                    h(PersonBadge, {
                        label: 'Resolved email',
                        removeButtonClassName: 'remove',
                        removeLabelClassName: 'remove-label',
                        removeIconClassName: 'remove-icon',
                        remove: readOnly
                            ? undefined
                            : {
                                  label: 'Localized remove Resolved email',
                                  buttonProps: {
                                      disabled,
                                      form: 'owner',
                                      'aria-describedby': 'remove-help',
                                  },
                                  onClick: (event) => {
                                      assert.equal(
                                          event.currentTarget.tagName,
                                          'BUTTON'
                                      );
                                      writes.push(
                                          disabled ? 'blocked' : 'current'
                                      );
                                  },
                              },
                    })
                )
            )
        );
    await render();
    const button = f.container.querySelector('button');
    assert(button);
    assert.equal(button.type, 'button');
    assert.equal(button.className, 'remove');
    assert.equal(button.getAttribute('form'), 'owner');
    assert.equal(button.getAttribute('aria-describedby'), 'remove-help');
    assert.equal(
        button.querySelector('.remove-label')?.textContent,
        'Localized remove Resolved email'
    );
    assert.equal(
        button.querySelector('svg')?.getAttribute('aria-hidden'),
        'true'
    );
    await act(async () => button.click());
    assert.deepEqual(writes, ['current']);
    assert.equal(submissions, 0);
    await render(true);
    assert.equal(f.container.querySelector('button'), button);
    await act(async () => button.click());
    assert.deepEqual(writes, ['current']);
    await render(false, true);
    assert.equal(f.container.querySelector('button'), null);
    assert.equal(
        f.container.querySelector('li span')?.textContent,
        'Resolved email'
    );
    assert.equal(submissions, 0);
});

it('keeps empty and zero labels literal and leaves native bubbling and current callback policy with the caller', async (t) => {
    const f = await fixture(t);
    let rows = 0;
    const writes: string[] = [];
    const render = (label: string, owner: string) =>
        f.render(
            h(
                'ul',
                { onClick: () => rows++ },
                h(PersonBadge, {
                    label,
                    remove: {
                        label: 'Remove',
                        onClick: () => writes.push(owner),
                    },
                })
            )
        );
    await render('', 'old');
    assert.equal(f.container.querySelector('li > div > span')?.textContent, '');
    await render('0', 'current');
    assert.equal(
        f.container.querySelector('li > div > span')?.textContent,
        '0'
    );
    await act(async () => f.container.querySelector('button')!.click());
    assert.deepEqual(writes, ['current']);
    assert.equal(rows, 1);
});
