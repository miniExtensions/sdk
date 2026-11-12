import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Fragment, createElement as h } from 'react';
import type { Window } from 'happy-dom';
import {
    AutoNumberField,
    BindingAutoNumberField,
    type AutoNumberBindingProps,
    type AutoNumberControlledProps,
    type FieldRenderState,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/index.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

/** Real public barrel and real Form owner; no replacement export or renderer injection. */
async function fixture(t: TestContext) {
    const f = await htmlPresentationFixture(t);
    const window: Window = f.window;
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm.push('autoPublic');
    loaded.payload.fieldIdsToSchemas.autoPublic = {
        fieldType: 'autoNumber',
        airtableField: {
            id: 'autoPublic',
            name: 'Record sequence',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'autoNumber', options: null },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.autoPublic = 42;
    let requests = 0;
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://autonumber-public.example.test',
            fetch: async () => {
                requests++;
                throw new Error('AutoNumber presentation must not perform I/O');
            },
        }),
        getScope: () => ({
            ownerId: 'autonumber-public-contract',
            revision: 0,
        }),
    });
    const binding = owner.field('autoPublic');
    const originalData = JSON.stringify(
        owner.controller.getState().draft!.data
    );
    const originalRevision = binding.getSnapshot().revision;
    const unchanged = () => {
        assert.equal(binding.getSnapshot().value, 42);
        assert.equal(binding.getSnapshot().dirty, false);
        assert.equal(binding.getSnapshot().revision, originalRevision);
        assert.equal(
            JSON.stringify(owner.controller.getState().draft!.data),
            originalData
        );
        assert.equal(requests, 0);
        f.unchangedEffects();
    };
    t.after(() => {
        unchanged();
        owner.destroy();
    });
    assert.equal(binding.getSnapshot().canEdit, false);
    assert.equal(binding.getSnapshot().readOnly, true);
    assert.equal(binding.scalar, null);
    return { ...f, window, owner, binding, unchanged };
}

it('public binding compatibility export retains the real readonly binding and render override', async (t) => {
    const f = await fixture(t);
    await f.render(h(BindingAutoNumberField, { binding: f.binding }));
    const input = f.container.querySelector('input');
    assert.ok(input);
    assert.equal(input.value, '42');
    assert.equal(input.disabled, true);
    await f.render(
        h(BindingAutoNumberField, {
            binding: f.binding,
            render: ({ snapshot, binding }: FieldRenderState) => {
                assert.equal(binding, f.binding);
                return h(
                    'strong',
                    { 'data-public-override': true },
                    String(snapshot.value)
                );
            },
        })
    );
    assert.equal(
        f.container.querySelector('[data-public-override]')?.textContent,
        '42'
    );
    assert.equal(
        f.container.querySelector('input,button,textarea,select'),
        null
    );
    f.unchanged();
});

it('same mounted public AutoNumber switches legacy/explicit binding and controlled modes without sibling or owner effects', async (t) => {
    const f = await fixture(t);
    const render = async (
        props: AutoNumberBindingProps | AutoNumberControlledProps
    ) => {
        await f.render(
            h(
                Fragment,
                null,
                h(
                    'section',
                    { 'data-public-autonumber': true },
                    h(AutoNumberField, props)
                ),
                h('input', {
                    'aria-label': 'Sibling draft',
                    defaultValue: 'Keep draft',
                })
            )
        );
        f.unchanged();
    };
    const leaf = () => f.container.querySelector('[data-public-autonumber]')!;
    const readonlyBinding = () => {
        const input = leaf().querySelector('input');
        assert.ok(input);
        assert.equal(input.value, '42');
        assert.equal(input.disabled, true);
    };
    await render({ binding: f.binding });
    readonlyBinding();
    const sibling = f.container.querySelector('[aria-label="Sibling draft"]')!;
    assert.ok(sibling instanceof f.window.HTMLInputElement);
    sibling.value = 'Unsaved neighboring edit';

    for (const controlled of [
        { mode: 'controlled', value: '0', language: 'en' },
        { mode: 'controlled', value: null, language: 'fr' },
        { mode: 'controlled', value: '  <b>0007</b>  ', language: 'en' },
    ] satisfies AutoNumberControlledProps[]) {
        await render(controlled);
        assert.equal(
            leaf().querySelector('input,button,textarea,select,b'),
            null
        );
        assert.equal(leaf().textContent, controlled.value ?? 'Pas de Valeur');
        assert.equal(
            f.container.querySelector('[aria-label="Sibling draft"]'),
            sibling
        );
        assert.equal(sibling.value, 'Unsaved neighboring edit');

        await render({ mode: 'binding', binding: f.binding });
        readonlyBinding();
        assert.equal(
            f.container.querySelector('[aria-label="Sibling draft"]'),
            sibling
        );
        assert.equal(sibling.value, 'Unsaved neighboring edit');
    }
    await render({ binding: f.binding });
    readonlyBinding();
    f.unchanged();
});
