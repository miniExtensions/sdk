import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { PortalGridReadonlyLinkedPills } from '../src/react/PortalGridReadonlyLinkedPills.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

it('server-renders literal ordered labels and retains duplicate occurrences', () => {
    const html = renderToString(
        h(PortalGridReadonlyLinkedPills, {
            labels: ['Shared', '', null, '<strong>Literal</strong>', 'Shared'],
        })
    );

    assert.deepEqual(
        Array.from(
            html.matchAll(/<li[^>]*>(.*?)<\/li>/g),
            ([, label]) => label
        ),
        ['Shared', '&lt;strong&gt;Literal&lt;/strong&gt;', 'Shared']
    );
    assert.doesNotMatch(html, /tabindex=|<button|<input|<a(?:\s|>)/);
});

it('lets the host handle clicks and renders blanks as an empty list', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    let clicks = 0;
    const host = (labels: readonly (string | null)[]) =>
        h(
            'div',
            { onClick: () => clicks++ },
            h(PortalGridReadonlyLinkedPills, { labels })
        );

    await fixture.render(host(['Selected']));
    const pill = fixture.container.querySelector('li');
    assert.ok(pill);
    pill.click();
    assert.equal(clicks, 1);
    await fixture.render(host([null, '']));
    assert.equal(fixture.container.querySelector('ul')?.children.length, 0);
});
