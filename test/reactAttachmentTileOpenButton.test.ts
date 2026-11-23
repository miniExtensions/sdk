import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, type KeyboardEvent } from 'react';
import { AttachmentTileOpenButton } from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

test('the tile open button follows resource identity and preserves host focus', async (t) => {
    const { window, container, render } = await htmlPresentationFixture(t);
    const renderTile = (resourceKey: string, label: string) =>
        render(
            h(
                'div',
                null,
                h(AttachmentTileOpenButton, {
                    resourceKey,
                    label,
                    onOpen: () => {},
                }),
                h('button', { type: 'button' }, 'Host control')
            )
        );

    await renderTile('raw/first.png', 'Open first attachment');
    const [original, hostControl] = container.querySelectorAll('button');
    assert.ok(original && hostControl);
    original.focus();
    assert.equal(window.document.activeElement, original);

    await renderTile('raw/first.png', 'Open renamed attachment');
    assert.equal(container.querySelector('button'), original);
    assert.equal(
        original.getAttribute('aria-label'),
        'Open renamed attachment'
    );
    assert.equal(window.document.activeElement, original);

    await renderTile('raw/second.png', 'Open renamed attachment');
    const replacement = container.querySelector('button');
    assert.ok(replacement && replacement !== original);
    assert.equal(original.isConnected, false);
    assert.equal(window.document.activeElement, replacement);

    hostControl.focus();
    await renderTile('raw/third.png', 'Open renamed attachment');
    assert.equal(replacement.isConnected, false);
    assert.equal(window.document.activeElement, hostControl);
});

test('the tile open button delegates activation and only prevents repeated Space', async (t) => {
    const { window, container, render, click } =
        await htmlPresentationFixture(t);
    const clickCalls: string[] = [];
    const keyCalls: Array<[string, boolean, boolean]> = [];
    await render(
        h(
            'div',
            {
                onClick: () => clickCalls.push('host'),
                onKeyDown: (event: KeyboardEvent) =>
                    keyCalls.push([
                        event.key,
                        event.repeat,
                        event.defaultPrevented,
                    ]),
            },
            h(AttachmentTileOpenButton, {
                resourceKey: 'raw/first.png',
                label: 'Open first attachment',
                onOpen: () => clickCalls.push('open'),
            })
        )
    );
    const button = container.querySelector('button');
    assert.ok(button);
    assert.equal(button.type, 'button');
    await click(button);
    assert.deepEqual(clickCalls, ['open', 'host']);

    const press = async (key: string, repeat: boolean) => {
        const event = new window.KeyboardEvent('keydown', {
            key,
            repeat,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            button.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };
    assert.equal(await press(' ', false), false);
    assert.equal(await press(' ', true), true);
    assert.equal(await press('Enter', true), false);
    assert.deepEqual(keyCalls, [
        [' ', false, false],
        [' ', true, true],
        ['Enter', true, false],
    ]);
});
