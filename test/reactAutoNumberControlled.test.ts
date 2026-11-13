import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Fragment, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Window } from 'happy-dom';
import {
    ControlledAutoNumberField,
    type AutoNumberControlledProps,
} from '../src/react/AutoNumberField.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

if (false) {
    h(ControlledAutoNumberField, {
        mode: 'controlled',
        // @ts-expect-error native numbers must pass through the owner's readonly conversion
        value: 0,
        language: 'en',
    });
    h(ControlledAutoNumberField, {
        mode: 'controlled',
        value: '0',
        language: 'en',
        // @ts-expect-error controlled display owns no canonical writer
        onValueChange() {},
    });
    // @ts-expect-error language is explicit, without a provider dependency
    h(ControlledAutoNumberField, { mode: 'controlled', value: null });
}

it('controlled AutoNumber keeps projected zero distinct from empty values', () => {
    const render = (
        value: string | null | undefined,
        language: 'en' | 'fr' = 'en'
    ) =>
        renderToStaticMarkup(
            h(ControlledAutoNumberField, {
                mode: 'controlled',
                value,
                language,
            })
        );
    assert.match(render('0'), />0<\/p>/);
    assert.doesNotMatch(render('0'), /no-value-test-id/);
    for (const value of [null, undefined, '']) {
        assert.match(render(value), /No Value/);
        assert.match(render(value, 'fr'), /Pas de Valeur/);
    }
});

it('controlled AutoNumber reuses complete literal, link and layout presentation', () => {
    const html = renderToStaticMarkup(
        h(ControlledAutoNumberField, {
            mode: 'controlled',
            value: '  <b>0007</b> https://example.com javascript:alert(1)  ',
            language: 'en',
            textSize: 'large',
            layout: 'cell-short',
            className: 'sequence',
        })
    );
    assert.match(html, /mx-sdk-complete-readonly-text sequence/);
    assert.match(html, /data-layout="cell-short"/);
    assert.match(html, /text-lg/);
    assert.match(html, /&lt;b&gt;0007&lt;\/b&gt;/);
    assert.match(html, /href="https:\/\/example.com"/);
    assert.doesNotMatch(html, /href="javascript:|<b>|<input|<button|<select/);
});

it('controlled replacements preserve sibling drafts and do not gain actions from malformed props', async (t) => {
    const f = await htmlPresentationFixture(t);
    const window: Window = f.window;
    let rowClicks = 0;
    const refuseAction = () =>
        assert.fail('AutoNumber display must not borrow actions');
    const render = async (
        value: string | null,
        language: 'en' | 'es' = 'en'
    ) => {
        const props = Object.assign(
            {
                mode: 'controlled',
                value,
                language,
            } as AutoNumberControlledProps,
            {
                onValueChange: refuseAction,
                setValue: refuseAction,
                renderText: refuseAction,
                fetch: refuseAction,
            }
        );
        await f.render(
            h(
                Fragment,
                null,
                h(
                    'section',
                    { onClick: () => rowClicks++ },
                    h(ControlledAutoNumberField, props)
                ),
                h('input', {
                    'aria-label': 'Sibling draft',
                    defaultValue: 'Keep draft',
                })
            )
        );
    };
    await render(null, 'es');
    assert.equal(
        f.container.querySelector('[data-testid="no-value-test-id"]')
            ?.textContent,
        'Sin Valor'
    );
    const sibling = f.container.querySelector('input')!;
    sibling.value = 'Unsaved neighboring edit';
    for (const value of [
        '0',
        '0007',
        '<img src=x onerror=alert(1)>',
        'https://example.com',
    ]) {
        await render(value);
        assert.equal(f.container.querySelector('input'), sibling);
        assert.equal(sibling.value, 'Unsaved neighboring edit');
        assert.equal(
            f.container.querySelector('.read-only-text')?.textContent,
            value
        );
        assert.equal(
            f.container.querySelectorAll('input,button,textarea,select').length,
            1
        );
        assert.equal(f.container.querySelector('img,script'), null);
    }
    const link = f.container.querySelector('a')!;
    link.addEventListener('click', (event) => event.preventDefault());
    link.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true })
    );
    assert.equal(rowClicks, 0);
    await render(null);
    assert.equal(
        f.container.querySelector('[data-testid="no-value-test-id"]')
            ?.textContent,
        'No Value'
    );
    f.unchangedEffects();
});

it('composes readonly AutoNumber with existing field labels, help, errors and preview shell', async (t) => {
    const f = await htmlPresentationFixture(t);
    const { CompleteFormFieldPresentation } = await import(
        '../src/react/CompleteFormFieldPresentation.js'
    );
    const render = (value: string | null, preview: boolean) =>
        f.render(
            h(CompleteFormFieldPresentation, {
                title: 'Sequence label',
                fieldName: 'Auto number',
                associationKind: 'group',
                formId: f.container.id,
                description: '<p>Generated sequence help</p>',
                error: 'Literal <invalid> feedback',
                preview,
                children: () =>
                    h(ControlledAutoNumberField, {
                        mode: 'controlled',
                        value,
                        language: 'en',
                    }),
            })
        );
    await render(null, true);
    const group = f.container.querySelector('[role="group"]')!;
    const id = group.id;
    const labelId = group.getAttribute('aria-labelledby')!;
    assert.equal(
        f.window.document.getElementById(labelId)?.textContent,
        'Sequence label'
    );
    assert.equal(group.getAttribute('aria-invalid'), 'true');
    const descriptions = group
        .getAttribute('aria-describedby')!
        .split(' ')
        .map((target) => f.window.document.getElementById(target)?.textContent);
    assert.deepEqual(descriptions, [
        'Literal <invalid> feedback',
        'Generated sequence help',
    ]);
    await render('0', false);
    assert.equal(f.container.querySelector('[role="group"]'), group);
    assert.equal(group.id, id);
    assert.equal(group.querySelector('.read-only-text')?.textContent, '0');
    assert.equal(
        f.container.querySelector('input,button,textarea,select'),
        null
    );
    f.unchangedEffects();
});
