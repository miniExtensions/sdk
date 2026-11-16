import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PercentField } from '../src/react/index.js';
import { createRendererProps } from '../src/ui/rendererRegistry.js';

it('public controlled Percent imports and renders readonly percentage output without a browser or writes', () => {
    assert.equal(typeof document, 'undefined');
    const field = createRendererProps({
        physicalKind: 'percent',
        fieldId: 'ratio',
        title: 'Ratio',
        field: {
            id: 'ratio',
            name: 'Ratio',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'percent', options: { precision: 2 } },
        },
        value: 0.75,
        displayConfig: {},
        writeConfig: null,
        context: 'form',
        computed: false,
        dirty: false,
        pending: false,
        error: null,
        validation: [],
        capability: {
            type: 'editable',
            setValue: () => {
                assert.fail('SSR must never write or save');
            },
        },
    });
    assert.ok(field?.physicalKind === 'percent');
    const markup = renderToString(
        createElement(PercentField, {
            mode: 'controlled',
            field,
            options: { presentation: 'display' },
        })
    );
    assert.match(markup, /75\.00%/);
    assert.doesNotMatch(markup, /<input|<button/);
});
