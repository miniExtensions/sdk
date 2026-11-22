import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h, createRef } from 'react';
import {
    AttachmentSliderThumbnailRail,
    type AttachmentSliderThumbnail,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

test('the thumbnail rail retains duplicate occurrences and emits selection without owning it', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const ref = createRef<HTMLDivElement>();
    const rows: AttachmentSliderThumbnail[] = [
        {
            key: 'open-a:duplicate:0',
            filename: 'Same name',
            thumbnailUrl: '/projected/first.png',
        },
        { key: 'open-a:duplicate:1', filename: 'Same name' },
    ];
    const intents: number[] = [];
    const render = (currentRows: AttachmentSliderThumbnail[], index: number) =>
        fixture.render(
            h(AttachmentSliderThumbnailRail, {
                ref,
                rows: currentRows,
                selectedIndex: index,
                onSelect: (position) => intents.push(position),
            })
        );
    await render(rows, 0);
    const rail = ref.current;
    assert.ok(rail);
    assert.equal(rail.getAttribute('tabindex'), '-1');
    const buttons = Array.from(rail.querySelectorAll('button'));
    assert.equal(buttons.length, 2);
    assert.deepEqual(
        buttons.map((button) => button.textContent),
        ['Same name', 'Same name']
    );
    assert.ok(buttons.every((button) => button.type === 'button'));
    assert.equal(
        rail.querySelector('img')?.getAttribute('src'),
        '/projected/first.png'
    );
    assert.equal(rail.querySelector('img')?.alt, '');
    assert.equal(
        rail.querySelector('svg')?.getAttribute('aria-hidden'),
        'true'
    );

    await fixture.click(buttons[1]);
    assert.deepEqual(intents, [1]);
    assert.deepEqual(
        buttons.map((button) => button.dataset.selected),
        ['true', 'false']
    );

    await render([rows[1], rows[0]], 0);
    assert.equal(ref.current, rail);
    const reordered = Array.from(rail.querySelectorAll('button'));
    assert.ok(reordered[0] === buttons[1] && reordered[1] === buttons[0]);
    assert.deepEqual(
        reordered.map((button) => button.dataset.selected),
        ['true', 'false']
    );
    await fixture.click(reordered[1]);
    assert.deepEqual(intents, [1, 1]);

    await render(
        rows.map((row) => ({ ...row, key: `open-b:${row.key}` })),
        1
    );
    assert.equal(ref.current, rail);
    assert.ok(buttons.every((button) => !button.isConnected));
    assert.deepEqual(intents, [1, 1]);
    fixture.unchangedEffects();
});
