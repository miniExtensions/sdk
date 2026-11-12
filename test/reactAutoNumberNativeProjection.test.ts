import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    AirtableFieldType,
    getReadableStringFromAirtableValue,
    type AirtableValue,
    type GetReadableStringSource,
} from '../src/formulas/index.js';
import { ControlledAutoNumberField } from '../src/react/AutoNumberField.js';

/** Source-level native projection handoff, not public-barrel/native dispatcher acceptance. */
it('retains native AutoNumber error/special/zero projection as literal readonly text', async (t) => {
    const window = new Window();
    t.after(() => window.happyDOM.close());
    const source: GetReadableStringSource = {
        type: 'airtableMock',
        linkedTableStates: {},
    };
    const cases: {
        name: string;
        value: AirtableValue;
        expected: string;
        language: 'en' | 'fr';
    }[] = [
        { name: 'undefined', value: undefined, expected: '', language: 'fr' },
        { name: 'null', value: null, expected: '', language: 'fr' },
        { name: 'zero', value: 0, expected: '0', language: 'en' },
        { name: 'negative zero', value: -0, expected: '0', language: 'fr' },
        {
            name: 'number stays ungrouped in French',
            value: 123456.75,
            expected: '123456.75',
            language: 'fr',
        },
        {
            name: 'error object stays literal',
            value: { error: '<b>Sequence error</b> https://example.com' },
            expected: '<b>Sequence error</b> https://example.com',
            language: 'en',
        },
        {
            name: 'NaN object',
            value: { specialValue: 'NaN' },
            expected: 'NaN',
            language: 'en',
        },
        {
            name: 'Infinity object',
            value: { specialValue: 'Infinity' },
            expected: 'Infinity',
            language: 'en',
        },
        {
            name: 'negative Infinity object',
            value: { specialValue: '-Infinity' },
            expected: '-Infinity',
            language: 'en',
        },
        { name: 'numeric NaN', value: NaN, expected: 'NaN', language: 'en' },
        {
            name: 'numeric Infinity',
            value: Infinity,
            expected: 'Infinity',
            language: 'en',
        },
        {
            name: 'numeric negative Infinity',
            value: -Infinity,
            expected: '-Infinity',
            language: 'en',
        },
    ];

    for (const item of cases) {
        const projected = getReadableStringFromAirtableValue({
            value: item.value,
            airtableFieldConfig: { type: AirtableFieldType.AUTO_NUMBER },
            source,
            fieldName: 'Record sequence',
        });
        assert.equal(projected, item.expected, item.name);
        const container = window.document.createElement('section');
        container.innerHTML = renderToStaticMarkup(
            h(ControlledAutoNumberField, {
                mode: 'controlled',
                value: projected,
                language: item.language,
            })
        );
        assert.equal(
            container.textContent,
            item.expected === '' ? 'Pas de Valeur' : item.expected,
            item.name
        );
        assert.equal(
            container.querySelector(
                'b,script,img,iframe,input,button,textarea,select,form'
            ),
            null,
            item.name
        );
        assert.equal(
            container.querySelector('[data-testid="no-value-test-id"]') !==
                null,
            item.expected === '',
            item.name
        );
        if (item.name === 'error object stays literal') {
            assert.equal(
                container.querySelector('a')?.getAttribute('href'),
                'https://example.com'
            );
        }
    }
    assert.deepEqual(source, { type: 'airtableMock', linkedTableStates: {} });
});
