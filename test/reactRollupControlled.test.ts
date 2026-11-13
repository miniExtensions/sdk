import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import { createElement as h, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    RollupField,
    type ControlledRollupFieldProps,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

it('public controlled Rollup uses supplied validity and complete readonly text', () => {
    const render = (value: string | null | undefined) =>
        renderToStaticMarkup(
            h(RollupField, {
                mode: 'controlled',
                isValid: true,
                value,
                language: 'fr',
            })
        );
    assert.match(render('CHF 0.000'), />CHF 0.000<\/p>/);
    assert.match(render('false'), />false<\/p>/);
    assert.match(render('1, 0, false'), />1, 0, false<\/p>/);
    for (const value of [null, undefined, ''])
        assert.match(render(value), /Pas de Valeur/);
    const invalid = renderToStaticMarkup(
        h(RollupField, {
            mode: 'controlled',
            isValid: false,
            language: 'en',
        })
    );
    assert.match(invalid, /role="alert"/);
    assert.match(
        invalid,
        /This field has an invalid value. Check the field in Airtable./
    );
    assert.doesNotMatch(invalid, /No Value|<input|<button/);
});

it('controlled Rollup replaces text, currency, invalid, null and recovered values without disturbing siblings', async (t) => {
    const f = await htmlPresentationFixture(t);
    const window: Window = f.window;
    let rowClicks = 0;
    const refuse = () =>
        assert.fail('Rollup must not borrow rendering or writes');
    const render = (props: ControlledRollupFieldProps) =>
        f.render(
            h(
                Fragment,
                null,
                h(
                    'section',
                    { onClick: () => rowClicks++ },
                    h(
                        RollupField,
                        Object.assign({}, props, {
                            setValue: refuse,
                            onChange: refuse,
                            renderText: refuse,
                        })
                    )
                ),
                h('input', {
                    'aria-label': 'Sibling draft',
                    defaultValue: 'Keep draft',
                })
            )
        );
    const valid = (value: string | null, language: 'en' | 'es' = 'en') =>
        render({
            mode: 'controlled',
            isValid: true,
            value,
            language,
            textSize: 'large',
            layout: 'cell-medium',
        });
    await valid('Alpha');
    const sibling = f.container.querySelector('input')!;
    sibling.value = 'Unsaved adjacent edit';
    await valid('€1,234.50');
    assert.equal(
        f.container.querySelector('.read-only-text')?.textContent,
        '€1,234.50'
    );
    await render({ mode: 'controlled', isValid: false, language: 'en' });
    assert.match(
        f.container.querySelector('[role="alert"]')!.textContent!,
        /invalid value/
    );
    assert.equal(f.container.querySelector('.read-only-text'), null);
    await valid(null, 'es');
    assert.equal(f.container.querySelector('[role="alert"]'), null);
    assert.equal(
        f.container.querySelector('[data-testid="no-value-test-id"]')
            ?.textContent,
        'Sin Valor'
    );
    const literal = '<img src=x onerror=bad()> https://example.test/recovered';
    await valid(literal);
    assert.equal(
        f.container.querySelector('.read-only-text')?.textContent,
        literal
    );
    assert.equal(f.container.querySelector('img,iframe,script,button'), null);
    assert.equal(
        f.container.querySelector('[data-layout]')?.getAttribute('data-layout'),
        'cell-medium'
    );
    const link = f.container.querySelector('a')!;
    assert.equal(link.getAttribute('target'), '_blank');
    link.addEventListener('click', (event) => event.preventDefault());
    link.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    assert.equal(rowClicks, 0);
    f.container
        .querySelector('.read-only-text')!
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(rowClicks, 1);
    assert.equal(f.container.querySelector('input'), sibling);
    assert.equal(sibling.value, 'Unsaved adjacent edit');
    assert.equal(
        f.container.querySelectorAll('input,textarea,select').length,
        1
    );
    f.unchangedEffects();
});
