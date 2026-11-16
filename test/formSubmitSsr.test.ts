import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormSubmitButton } from '../src/react/index.js';

it('renders the public submit control without browser globals or implicit actions', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    for (const mode of ['save', 'compute', 'review'] as const) {
        const html = renderToStaticMarkup(
            createElement(FormSubmitButton, {
                formId: 'form-external',
                label: 'Submit <literal>',
                mode,
                saving: false,
                canSubmit: true,
            })
        );
        assert.match(html, /type="submit"/);
        assert.match(html, /form="form-external"/);
        assert.match(html, /Submit &lt;literal&gt;/);
        assert(html.includes(`data-mode="${mode}"`));
        assert(!html.includes('disabled'));
        assert(!html.includes('<svg'));
    }
    const busy = renderToStaticMarkup(
        createElement(FormSubmitButton, {
            formId: 'form-external',
            label: 'Saving',
            mode: 'save',
            saving: true,
            canSubmit: true,
        })
    );
    assert.match(busy, /disabled=""/);
    assert.match(busy, /<svg/);
    assert.match(busy, /aria-hidden="true"/);
});
