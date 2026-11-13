import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CreatedTimeField,
    BindingCreatedTimeField,
    type CreatedTimeFieldProps,
    type BindingCreatedTimeFieldProps,
    type ControlledCreatedTimeFieldProps,
} from '../src/react/index.js';
import {
    createFormFieldBindings,
    type FormFieldBinding,
} from '../src/forms/bindings.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

const controlled: ControlledCreatedTimeFieldProps = {
    value: '2026-11-12T12:30:00Z',
    language: 'en',
    dateConfig: {
        type: 'dateTime',
        options: {
            dateFormat: { format: 'YYYY-MM-DD' },
            timeFormat: { format: 'HH:mm' },
            timeZone: 'America/New_York',
        },
    },
};

function publicTypes(old: CreatedTimeFieldProps) {
    const binding: FormFieldBinding = old.binding;
    const explicit: BindingCreatedTimeFieldProps = old;
    const unchanged: CreatedTimeFieldProps = explicit;
    h(CreatedTimeField, unchanged);
    h(BindingCreatedTimeField, explicit);
    h(CreatedTimeField, controlled);
    h(CreatedTimeField, { ...controlled, dateLanguage: 'en' });
    // @ts-expect-error The date override uses the same supported language contract.
    h(CreatedTimeField, { ...controlled, dateLanguage: 'unsupported' });
    // @ts-expect-error A caller must choose binding or controlled data.
    h(CreatedTimeField, { ...controlled, binding });
    // @ts-expect-error A controlled field cannot inject a binding renderer.
    h(CreatedTimeField, { ...controlled, render: () => null });
    // @ts-expect-error Computed display never accepts a writer.
    h(CreatedTimeField, { ...controlled, setValue: () => {} });
    // @ts-expect-error Binding compatibility does not silently accept controlled flags.
    h(CreatedTimeField, { ...old, displayAsButton: true });
    // @ts-expect-error Date display options do not broaden legacy binding props.
    h(CreatedTimeField, { ...old, dateLanguage: 'en' });
    // @ts-expect-error The explicit binding alias still requires its binding.
    h(BindingCreatedTimeField, controlled);
    return binding;
}

it('exports the natural public controlled API without a provider or binding', () => {
    const text = renderToStaticMarkup(h(CreatedTimeField, controlled));
    assert.match(text, /2026-11-12 07:30/);
    assert.doesNotMatch(text, /<input|<button/);
    const link = renderToStaticMarkup(
        h(CreatedTimeField, {
            ...controlled,
            value: 'example.com/resource',
            displayAsButton: true,
            buttonLabel: 'Open supplied resource',
        })
    );
    assert.match(link, /href="https:\/\/example.com\/resource"/);
    assert.match(link, /Open supplied resource/);
});

it('keeps missing, false and throwing display owners explicit', () => {
    assert.match(
        renderToStaticMarkup(h(CreatedTimeField, controlled)),
        /2026-11-12/
    );
    for (const isCurrent of [
        () => false,
        () => {
            throw Error('Retired owner');
        },
    ]) {
        assert.equal(
            renderToStaticMarkup(
                h(CreatedTimeField, {
                    ...controlled,
                    owner: { isCurrent },
                })
            ),
            ''
        );
    }
});

it('preserves actual raw binding behavior through both natural and explicit public entries', () => {
    const loaded = loadedForm();
    const native = '2024-11-03T01:30:00.120-07:00';
    loaded.payload.fieldIdsInForm.push('created');
    loaded.payload.formRecord.data.created = native;
    loaded.payload.fieldIdsToSchemas.created = {
        fieldType: 'createdTime',
        airtableField: {
            id: 'created',
            name: 'Created time',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'createdTime',
                options: {
                    result: {
                        type: 'dateTime',
                        options: {
                            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                            timeFormat: { name: '24hour', format: 'HH:mm' },
                            timeZone: 'utc',
                        },
                    },
                },
            },
        },
        miniExtConfig: {},
    };
    let requests = 0;
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async () => {
                requests++;
                throw Error('Unexpected source request');
            },
        }),
        getScope: () => ({ ownerId: 'created-public', revision: 0 }),
    });
    const binding = owner.field('created');
    let writes = 0;
    binding.setValue = () => {
        writes++;
        throw Error('No Created-time writer');
    };
    try {
        const natural = renderToStaticMarkup(h(CreatedTimeField, { binding }));
        const explicit = renderToStaticMarkup(
            h(BindingCreatedTimeField, { binding })
        );
        for (const markup of [natural, explicit]) {
            assert.match(markup, /value="2024-11-03T01:30:00.120-07:00"/);
            assert.match(markup, /disabled/);
        }
        assert.equal(binding.getSnapshot().value, native);
        owner.destroy();
        assert.equal(
            renderToStaticMarkup(h(CreatedTimeField, { binding })),
            ''
        );
        assert.equal(
            renderToStaticMarkup(h(BindingCreatedTimeField, { binding })),
            ''
        );
        assert.equal(requests, 0);
        assert.equal(writes, 0);
    } finally {
        owner.destroy();
    }
});
