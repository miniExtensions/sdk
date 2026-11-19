import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachmentSliderNavigation } from '../src/react/index.js';

const labels = { navigation: 'Dateien', previous: 'Zurück', next: 'Weiter' };
const rows = [{ filename: 'One' }, { filename: 'Two' }];

function render(selectedIndex: number, attachments = rows) {
    return renderToStaticMarkup(
        h(
            'form',
            null,
            h(
                AttachmentSliderNavigation,
                {
                    rows: attachments,
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
});
