import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    FormValidationSummary,
    type FormValidationDiagnostic,
    type FormValidationSummaryProps,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const heading = 'Please correct the following fields';
const diagnostics: readonly FormValidationDiagnostic[] = Object.freeze([
    Object.freeze({
        fieldId: 'fld_name',
        fieldTitle: 'Full name',
        errorMessage: 'Field is required',
    }),
    Object.freeze({
        fieldId: 'fld_email',
        fieldTitle: 'Email address',
        errorMessage: 'Enter a valid email address',
    }),
]);
function summary(
    entries: readonly FormValidationDiagnostic[] = diagnostics,
    title = heading
) {
    const props: FormValidationSummaryProps = {
        heading: title,
        diagnostics: entries,
    };
    return h(FormValidationSummary, props);
}

it('server-renders the public summary without a browser or host renderer', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    const html = renderToStaticMarkup(summary());
    assert.match(html, /role="alert"/);
    assert.match(html, /data-testid="alert-test-id"/);
    assert.match(html, /<h3[^>]*>Please correct the following fields<\/h3>/);
    assert.match(html, /<ul[^>]*role="list"/);
    assert.match(html, /href="#fld_name"/);
    assert.match(html, /Full name<\/a> \(Field is required\)/);
    assert.ok(html.indexOf('Full name') < html.indexOf('Email address'));
    assert.equal(renderToStaticMarkup(summary([])), '');
});

it('owns the error alert, localized heading, ordered list and literal field anchors', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert.ok(f.window instanceof Window);
    await f.render(summary(diagnostics, 'Corrigez les champs suivants'));
    const alert = f.container.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.equal(alert.getAttribute('data-testid'), 'alert-test-id');
    assert.equal(
        alert.querySelector('h3')?.textContent,
        'Corrigez les champs suivants'
    );
    assert.equal(
        alert.querySelector('svg')?.getAttribute('aria-hidden'),
        'true'
    );
    const list = alert.querySelector('ul[role="list"]');
    assert.ok(list);
    const items = [...list.querySelectorAll('li')];
    assert.deepEqual(
        items.map((item) => item.getAttribute('data-testid')),
        ['field-fld_name-error', 'field-fld_email-error']
    );
    assert.deepEqual(
        items.map((item) => item.textContent),
        [
            'Full name (Field is required)',
            'Email address (Enter a valid email address)',
        ]
    );
    assert.deepEqual(
        items.map((item) => item.querySelector('a')?.getAttribute('href')),
        ['#fld_name', '#fld_email']
    );
    assert.deepEqual(
        items.map((item) => item.querySelector('a')?.textContent),
        ['Full name', 'Email address']
    );
    assert.equal(alert.querySelectorAll('button, input').length, 0);
    f.unchangedEffects();
});

it('retains the semantic title supplied for a field whose native label is hidden', async (t) => {
    const f = await htmlPresentationFixture(t);
    const hiddenField = {
        fieldId: 'fld_hidden_title',
        fieldTitle: 'Semantic title of the hidden-label field',
        errorMessage: 'Field is required',
    } as const satisfies FormValidationDiagnostic;
    await f.render(
        h(
            'section',
            null,
            h('label', { hidden: true, htmlFor: hiddenField.fieldId }, ''),
            h('input', { id: hiddenField.fieldId }),
            summary([hiddenField])
        )
    );
    const item = f.container.querySelector('li');
    assert.equal(
        item?.textContent,
        'Semantic title of the hidden-label field (Field is required)'
    );
    assert.equal(
        item?.querySelector('a')?.getAttribute('href'),
        '#fld_hidden_title'
    );
    assert.equal(f.container.querySelector('label')?.hidden, true);
    assert.equal(f.container.querySelector('label')?.textContent, '');
});

it('updates and reorders keyed diagnostics, removes cleared errors and restores current data', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(summary());
    const initial = [...f.container.querySelectorAll('li')];
    const revised = Object.freeze({
        ...diagnostics[0]!,
        fieldTitle: 'Updated name',
        errorMessage: 'Use at least two characters',
    });
    await f.render(summary([diagnostics[1]!, revised], 'Updated heading'));
    const reordered = [...f.container.querySelectorAll('li')];
    assert.equal(reordered[0], initial[1]);
    assert.equal(reordered[1], initial[0]);
    assert.equal(
        reordered[1]?.textContent,
        'Updated name (Use at least two characters)'
    );
    assert.equal(
        f.container.querySelector('h3')?.textContent,
        'Updated heading'
    );
    assert.ok(!f.container.textContent.includes('Field is required'));

    await f.render(summary([revised]));
    assert.equal(f.container.querySelector('li'), initial[0]);
    assert.equal(f.container.querySelectorAll('li').length, 1);
    assert.ok(!f.container.textContent.includes('Email address'));

    await f.render(summary([]));
    assert.equal(f.container.querySelector('[role="alert"]'), null);
    assert.equal(f.container.querySelector('[role="list"]'), null);
    assert.equal(f.container.textContent, '');

    await f.render(summary([diagnostics[1]!]));
    assert.equal(f.container.querySelectorAll('li').length, 1);
    assert.equal(
        f.container.querySelector('li')?.textContent,
        'Email address (Enter a valid email address)'
    );
    assert.ok(!f.container.textContent.includes('Updated name'));
    f.unchangedEffects();
});

it('preserves literal target IDs and treats heading, titles and messages as plain text', async (t) => {
    const f = await htmlPresentationFixture(t);
    const fieldId = ' fld[raw]:a/b ?#% ';
    const diagnostic = Object.freeze({
        fieldId,
        fieldTitle: '<b>Hidden & semantic</b>',
        errorMessage: '<script>private()</script> & invalid',
    });
    const title = '<em>Correct & retry</em>';
    await f.render(summary(Object.freeze([diagnostic]), title));
    const link = f.container.querySelector('a');
    assert.equal(link?.getAttribute('href'), `#${fieldId}`);
    assert.equal(link?.textContent, diagnostic.fieldTitle);
    assert.equal(
        f.container.querySelector('li')?.getAttribute('data-testid'),
        `field-${fieldId}-error`
    );
    assert.equal(
        f.container.querySelector('li')?.textContent,
        `${diagnostic.fieldTitle} (${diagnostic.errorMessage})`
    );
    assert.equal(f.container.querySelector('h3')?.textContent, title);
    assert.equal(f.container.querySelector('b, script, em'), null);
    assert.equal(link?.getAttribute('target'), null);
    assert.equal(link?.getAttribute('onclick'), null);
    f.unchangedEffects();
});

it('renders no heading or alert for an initially empty diagnostic collection', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(summary(Object.freeze([])));
    assert.equal(f.container.childElementCount, 0);
    assert.equal(f.container.textContent, '');
    f.unchangedEffects();
});
