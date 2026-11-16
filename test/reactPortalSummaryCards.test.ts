import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    PortalSummaryCards,
    type PortalSummaryCard,
    type PortalSummaryFieldsHeight,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const cards: readonly PortalSummaryCard[] = Object.freeze([
    Object.freeze({ fieldId: 'zero', fieldName: 'Zero', readable: '0.00' }),
    Object.freeze({ fieldId: 'false', fieldName: 'Unchecked', readable: '' }),
    Object.freeze({ fieldId: 'blank', fieldName: 'Blank', readable: '   ' }),
    Object.freeze({ fieldId: 'null', fieldName: 'Null', readable: '' }),
]);

it('renders complete definition cards server-side with no browser or host controls', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    const markup = renderToStaticMarkup(h(PortalSummaryCards, { cards }));
    assert.match(markup, /^<dl/);
    assert.match(markup, /title="0.00"/);
    assert.equal(
        renderToStaticMarkup(h(PortalSummaryCards, { cards: [] })),
        ''
    );
});

it('keeps zero, false, blank and null display facts, all heights and independent titles', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert.ok(f.window instanceof Window);
    for (const height of [
        undefined,
        'short',
        'medium',
        'tall',
        'extra tall',
    ] as const satisfies readonly (PortalSummaryFieldsHeight | undefined)[]) {
        for (const hideTitles of [undefined, false, true]) {
            await f.render(
                h(PortalSummaryCards, { cards, height, hideTitles })
            );
            assert.equal(
                f.container.querySelector('dl')?.getAttribute('data-height'),
                height ?? 'short'
            );
            assert.deepEqual(
                [...f.container.querySelectorAll('dd')].map(
                    (e) => e.textContent
                ),
                ['0.00', '', '   ', '']
            );
            assert.deepEqual(
                [...f.container.querySelectorAll('dd')].map((e) =>
                    e.getAttribute('title')
                ),
                ['0.00', '', '   ', '']
            );
            assert.deepEqual(
                [...f.container.querySelectorAll('dt')].map(
                    (e) => e.textContent
                ),
                hideTitles === true
                    ? []
                    : ['Zero', 'Unchecked', 'Blank', 'Null']
            );
        }
    }
    assert.equal(
        f.container.querySelectorAll('button, input, a, iframe').length,
        0
    );
    f.unchangedEffects();
});

it('updates order, labels, values and parent replacement with no retained data or effects', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(h(PortalSummaryCards, { cards }));
    const zero = f.container.querySelector('dd');
    await f.render(
        h(PortalSummaryCards, {
            cards: [
                cards[1]!,
                { ...cards[0]!, fieldName: 'Renamed', readable: '12.50' },
            ],
        })
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('dt')].map((e) => e.textContent),
        ['Unchecked', 'Renamed']
    );
    assert.equal(f.container.querySelectorAll('dd')[1], zero);
    assert.equal(zero?.textContent, '12.50');
    await f.render(h(PortalSummaryCards, { cards: [] }));
    assert.equal(f.container.textContent, '');
    await f.render(
        h(PortalSummaryCards, {
            cards: [
                {
                    fieldId: 'other',
                    fieldName: 'Other parent',
                    readable: 'fresh',
                },
            ],
        })
    );
    assert.equal(f.container.querySelector('dd')?.textContent, 'fresh');
    assert.ok(!f.container.textContent.includes('Renamed'));
    f.unchangedEffects();
});

it('escapes labels, values and full-value tooltips as inert text', async (t) => {
    const f = await htmlPresentationFixture(t);
    const card = {
        fieldId: '<id>',
        fieldName: '<img src=x onerror=private()>',
        readable: '<script>private()</script> & "quoted"',
    };
    await f.render(h(PortalSummaryCards, { cards: [card] }));
    assert.equal(f.container.querySelector('dt')?.textContent, card.fieldName);
    assert.equal(f.container.querySelector('dd')?.textContent, card.readable);
    assert.equal(
        f.container.querySelector('dd')?.getAttribute('title'),
        card.readable
    );
    assert.equal(f.container.querySelector('script, img, a'), null);
    f.unchangedEffects();
});

it('allows explicit host decoration around the complete SDK card with identical presentation', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(h(PortalSummaryCards, { cards: [cards[0]!] }));
    const ordinary = f.container.querySelector(
        '.mx-sdk-portal-summary-card'
    )?.outerHTML;
    await f.render(
        h(PortalSummaryCards, {
            cards: [cards[0]!],
            decorateCard: (card, content) =>
                h('section', { 'data-host-field': card.fieldId }, content),
        })
    );
    assert.equal(
        f.container.querySelector('section')?.getAttribute('data-host-field'),
        'zero'
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-summary-card')?.outerHTML,
        ordinary
    );
    assert.equal(
        f.container.querySelector('dt')?.nextElementSibling?.tagName,
        'DD'
    );
    f.unchangedEffects();
});
