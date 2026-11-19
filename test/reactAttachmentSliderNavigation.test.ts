import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachmentSliderNavigation } from '../src/react/index.js';

const labels = { navigation: 'Dateien', previous: 'Zurück', next: 'Weiter' };
const rows = [{ filename: 'One' }, { filename: 'Two' }];

function render(
    selectedIndex: number,
    attachments = rows,
    collectionOwner: string | null = 'form-a'
) {
    return renderToStaticMarkup(
        h(
            'form',
            null,
            h(
                AttachmentSliderNavigation,
                {
                    rows: attachments,
                    collectionOwner,
                    selectedIndex,
                    labels,
                    onSelect: () =>
                        assert.fail('render changed host selection'),
                },
                h('output', null, 'Host preview')
            )
        )
    );
}

test('announces the host selection with localized non-submit boundary actions', () => {
    const first = render(0);
    assert.match(first, /aria-live="polite">One</);
    assert.match(
        first,
        /aria-label="Zurück" aria-disabled="true" type="button"/
    );
    assert.match(
        first,
        /aria-label="Weiter" aria-disabled="false" type="button"/
    );
    const last = render(1);
    assert.match(last, /aria-live="polite">Two</);
    assert.match(
        last,
        /aria-label="Weiter" aria-disabled="true" type="button"/
    );
    assert.match(last, /Host preview/);
});

test('renders no stale preview or controls when selection is invalid or retired', () => {
    for (const index of [-1, 2, 0.5, NaN])
        assert.equal(render(index), '<form></form>');
    assert.equal(render(1, [rows[0]]), '<form></form>');
    assert.equal(render(0, []), '<form></form>');
    assert.equal(render(0, rows, null), '<form></form>');
    assert.equal(render(0, rows, ''), '<form></form>');
});

test('only focused navigation emits bounded intent and the host applies it', async (t) => {
    const window = new Window({ url: 'https://slider.example.test/' });
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
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, { value, configurable: true });
    const { createRoot } = await import('react-dom/client');
    const form = window.document.createElement('form');
    const intents: number[] = [];
    let submissions = 0;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submissions++;
    });
    window.document.body.append(form);
    const root = createRoot(form as unknown as HTMLElement);
    t.after(async () => {
        try {
            await act(async () => root.unmount());
            await window.happyDOM.close();
        } finally {
            for (const [key, descriptor] of originals) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
        }
    });
    const mount = (
        selectedIndex: number,
        collectionOwner: string | null = 'form-a',
        attachments = rows
    ) =>
        act(async () =>
            root.render(
                h(
                    AttachmentSliderNavigation,
                    {
                        rows: attachments,
                        collectionOwner,
                        selectedIndex,
                        labels,
                        onSelect: (index) => intents.push(index),
                    },
                    h('input', { 'aria-label': 'Host preview field' })
                )
            )
        );
    const element = (selector: string) => {
        const found = form.querySelector(selector);
        if (!found) throw new Error(`Missing mounted control: ${selector}`);
        return found;
    };
    const press = async (
        selector: string,
        key: string,
        modifiers: Partial<
            Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>
        > = {},
        alreadyHandled = false
    ) => {
        const target = element(selector);
        (target as typeof window.HTMLElement.prototype).focus();
        const event = new window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...modifiers,
        });
        if (alreadyHandled) event.preventDefault();
        await act(async () => {
            target.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };

    await mount(0);
    const previous = 'button[aria-label="Zurück"]';
    const next = 'button[aria-label="Weiter"]';
    const group = '[role="group"]';
    await act(async () => {
        (
            element(previous) as typeof window.HTMLButtonElement.prototype
        ).click();
    });
    assert.deepEqual(intents, []);
    await act(async () => {
        (element(next) as typeof window.HTMLButtonElement.prototype).click();
    });
    assert.deepEqual(intents, [1]);
    assert.equal(element('[aria-live]').textContent, 'One');
    assert.equal(await press(group, 'ArrowRight'), true);
    for (const modifier of [
        'altKey',
        'ctrlKey',
        'metaKey',
        'shiftKey',
    ] as const)
        assert.equal(
            await press(group, 'ArrowRight', { [modifier]: true }),
            false
        );
    assert.equal(await press(group, 'Home'), false);
    assert.equal(await press(group, 'ArrowRight', {}, true), true);
    assert.equal(await press('input', 'ArrowRight'), false);
    assert.deepEqual(intents, [1, 1]);

    await mount(1);
    assert.equal(element('[aria-live]').textContent, 'Two');
    assert.equal(await press(next, 'ArrowRight'), true);
    assert.deepEqual(intents, [1, 1]);
    assert.equal(await press(next, 'ArrowLeft'), true);
    await act(async () => {
        (
            element(previous) as typeof window.HTMLButtonElement.prototype
        ).click();
    });
    assert.deepEqual(intents, [1, 1, 0, 0]);
    assert.equal(submissions, 0);

    const originalNext = element(next);
    await mount(
        0,
        'form-a',
        rows.map((row) => ({ ...row }))
    );
    assert.equal(element(next), originalNext);
    await mount(0, 'form-b');
    assert.notEqual(element(next), originalNext);
    assert.equal(originalNext.isConnected, false);

    const sparse = new Array<(typeof rows)[number]>(3);
    sparse[0] = rows[0];
    sparse[2] = rows[1];
    await mount(0, 'form-b', sparse);
    assert.equal(element(next).getAttribute('aria-disabled'), 'true');
    assert.equal(await press(next, 'ArrowRight'), true);
    assert.deepEqual(intents, [1, 1, 0, 0]);
    await mount(1, 'form-b', sparse);
    assert.equal(form.querySelector(group), null);
    await mount(0, null);
    assert.equal(form.querySelector(group), null);
});
