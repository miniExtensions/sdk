import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Installed package and copied starter; local synthetic responses, no browser/backend claim. */
export async function checkScalarBindingConsumer({
    consumerDirectory,
    starterDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'HTMLSelectElement',
        'Event',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    let root = null;
    let owner = null;
    let stock = null;
    let custom = null;
    let checks = 0;
    try {
        const packageRoot = join(
            consumerDirectory,
            'node_modules/@miniextensions/sdk'
        );
        const forms = await import(
            pathToFileURL(join(packageRoot, 'dist/esm/forms/index.js'))
        );
        const api = await import(
            pathToFileURL(join(packageRoot, 'dist/esm/react/index.js'))
        );
        const ui = await import(
            pathToFileURL(join(packageRoot, 'dist/esm/ui/index.js'))
        );
        const react = require('react');
        const { createElement, StrictMode, act } = react;
        const { createRoot } = require('react-dom/client');
        for (const name of ['NumberField', 'CheckboxField'])
            assert.equal(
                typeof require('@miniextensions/sdk/react')[name],
                'function'
            );
        for (const name of [
            'createNumberFieldModel',
            'createCheckboxFieldModel',
        ]) {
            assert.equal(typeof ui[name], 'function');
            assert.equal(
                typeof require('@miniextensions/sdk/ui')[name],
                'function'
            );
        }
        const loaded = portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        loaded.payload.hasParentExtension = false;
        for (const [id, type] of [
            ['fld_number', 'number'],
            ['fld_percent', 'percent'],
            ['fld_checkbox', 'checkbox'],
        ]) {
            loaded.payload.fieldIdsInForm.push(id);
            loaded.payload.fieldIdsToSchemas[id] = {
                fieldType: type,
                airtableField: {
                    id,
                    name: id,
                    isComputed: false,
                    isPrimaryField: false,
                    description: null,
                    config: {
                        type,
                        options:
                            type === 'checkbox'
                                ? { icon: 'check', color: 'greenBright' }
                                : { precision: 2 },
                    },
                },
                miniExtConfig: {
                    conditionalFields: {
                        logicalOperator: 'and',
                        conditions: [],
                    },
                },
            };
        }
        Object.assign(loaded.payload.formRecord.data, {
            fld_number: null,
            fld_percent: 0.25,
            fld_checkbox: null,
        });
        const saves = [];
        let scope = { ownerId: 'A', revision: 0 };
        let editable = true;
        const client = {
            getSession: () => ({}),
            forms: {
                save: async (input) => {
                    saves.push(structuredClone(input));
                    return {
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    };
                },
            },
        };
        const options = {
            client,
            loaded,
            getScope: () => scope,
            canWriteField: () => editable,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        };
        owner = forms.createFormFieldBindings(options);
        const container = window.document.createElement('div');
        window.document.body.append(container);
        root = createRoot(container);
        const tree = () =>
            createElement(
                StrictMode,
                null,
                createElement(api.NumberField, {
                    binding: owner.field('fld_number'),
                }),
                createElement(api.NumberField, {
                    binding: owner.field('fld_number'),
                    render: ({ snapshot, binding }) =>
                        createElement('input', {
                            'aria-label': 'Custom number',
                            value: snapshot.scalar.input,
                            disabled: !snapshot.canEdit,
                            onChange: (event) =>
                                binding.scalar.setInput(
                                    event.currentTarget.value
                                ),
                        }),
                }),
                createElement(api.CheckboxField, {
                    binding: owner.field('fld_checkbox'),
                }),
                createElement(api.CheckboxField, {
                    binding: owner.field('fld_checkbox'),
                    render: ({ snapshot, binding }) =>
                        createElement(
                            'button',
                            {
                                'data-checkbox-custom': 'true',
                                disabled: !snapshot.canEdit,
                                onClick: () =>
                                    binding.scalar.setChecked(
                                        !snapshot.scalar.checked
                                    ),
                            },
                            String(snapshot.scalar.checked)
                        ),
                }),
                createElement(api.NumberField, {
                    binding: owner.field('fld_percent'),
                })
            );
        await act(async () => root.render(tree()));
        const stockNumber = () =>
            container.querySelector('label input[inputmode=decimal]');
        const setValue = async (input, value) =>
            act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(input, value);
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        await setValue(stockNumber(), '12.5');
        assert.equal(owner.field('fld_number').getSnapshot().value, 12.5);
        assert.equal(
            container.querySelector('[aria-label="Custom number"]').value,
            '12.5'
        );
        checks++;
        await setValue(
            container.querySelector('[aria-label="Custom number"]'),
            '1e2'
        );
        assert.equal(stockNumber().value, '1e2');
        assert.equal(owner.field('fld_number').getSnapshot().value, 100);
        checks++;
        await setValue(stockNumber(), '-');
        assert.equal(owner.field('fld_number').getSnapshot().value, 100);
        assert.equal(
            container.querySelector('[aria-label="Custom number"]').value,
            '-'
        );
        await assert.rejects(owner.save());
        assert.equal(saves.length, 0);
        checks++;
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(stockNumber().value, '-');
        assert.equal(owner.field('fld_number').getSnapshot().dirty, true);
        checks++;
        await setValue(stockNumber(), '3');
        await act(async () =>
            container.querySelector('input[type=checkbox]').click()
        );
        assert.equal(owner.field('fld_checkbox').getSnapshot().value, true);
        assert.equal(
            container.querySelector('[data-checkbox-custom]').textContent,
            'true'
        );
        await act(async () =>
            container.querySelector('[data-checkbox-custom]').click()
        );
        assert.equal(owner.field('fld_checkbox').getSnapshot().value, false);
        assert.equal(
            container.querySelector('input[type=checkbox]').checked,
            false
        );
        checks++;
        const heldCheckbox = container.querySelector('input[type=checkbox]');
        await act(async () => {
            editable = false;
            owner.refresh();
        });
        await act(async () =>
            heldCheckbox.dispatchEvent(
                new window.Event('click', { bubbles: true })
            )
        );
        assert.equal(
            owner.field('fld_checkbox').scalar.setChecked(true),
            false
        );
        assert.equal(owner.field('fld_checkbox').getSnapshot().value, false);
        await act(async () => {
            editable = true;
            owner.refresh();
        });
        checks++;
        const percent = owner.field('fld_percent');
        assert.equal(percent.getSnapshot().value, 0.25);
        await act(async () => percent.scalar.setInput('0.125'));
        await act(async () => owner.save());
        assert.equal(saves.length, 1);
        assert.equal(saves[0].formRecord.data.fld_number, 3);
        assert.equal(saves[0].formRecord.data.fld_percent, 0.125);
        assert.equal(saves[0].formRecord.data.fld_checkbox, false);
        assert.equal(
            saves[0].formRecord.data.fld_title,
            loaded.payload.formRecord.data.fld_title
        );
        checks++;
        const oldNumber = owner.field('fld_number');
        await act(async () => {
            scope = { ownerId: 'B', revision: 1 };
            owner.refresh();
        });
        assert.equal(oldNumber.scalar.setInput('999'), false);
        await act(async () => {
            scope = { ownerId: 'A', revision: 2 };
            owner.refresh();
        });
        assert.equal(oldNumber.scalar.setInput('1000'), false);
        checks++;
        await act(async () => root.unmount());
        root = null;
        owner.destroy();
        owner = forms.createFormFieldBindings(options);
        // Execute the actual installed/copy-starter stock and custom rendering adapters.
        const outfile = join(
            consumerDirectory,
            '.generated/scalar-stock-check.mjs'
        );
        const result = await build({
            absWorkingDir: starterDirectory,
            stdin: {
                contents: `export { mountBoundFormField } from './src/fields.ts'; export { mountCustomField } from './src/customFieldRenderer.ts';`,
                resolveDir: starterDirectory,
                sourcefile: 'scalar-stock-check.ts',
            },
            bundle: true,
            format: 'esm',
            platform: 'browser',
            outfile,
            metafile: true,
            logLevel: 'silent',
        });
        assert.ok(
            Object.keys(result.metafile.inputs).some((path) =>
                path.endsWith('/ui/scalarModels.js')
            )
        );
        const copied = await import(pathToFileURL(outfile));
        const binding = owner.field('fld_number');
        stock = copied.mountBoundFormField(
            binding,
            loaded.payload.fieldIdsToSchemas.fld_number,
            () => {}
        );
        custom = copied.mountCustomField(binding, window.document);
        window.document.body.append(stock.node, custom.node);
        const input = stock.node.querySelector('input');
        input.value = '4.5';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(custom.node.querySelector('input').value, '4.5');
        assert.equal(binding.getSnapshot().value, 4.5);
        checks++;
        custom.node.querySelector('input').value = '-';
        custom.node
            .querySelector('input')
            .dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(input.value, '-');
        assert.equal(binding.getSnapshot().value, 4.5);
        const before = saves.length;
        await assert.rejects(owner.save());
        assert.equal(saves.length, before);
        checks++;
        stock.destroy();
        stock.node.remove();
        stock = copied.mountBoundFormField(
            binding,
            loaded.payload.fieldIdsToSchemas.fld_number,
            () => {}
        );
        assert.equal(stock.node.querySelector('input').value, '-');
        checks++;
        binding.setValue(null);
        assert.equal(stock.node.querySelector('input').value, '');
        assert.equal(custom.node.querySelector('input').value, '');
        assert.equal(binding.getSnapshot().value, null);
        checks++;
        stock.destroy();
        custom.destroy();
        stock = null;
        custom = null;
        const checkbox = owner.field('fld_checkbox');
        stock = copied.mountBoundFormField(
            checkbox,
            loaded.payload.fieldIdsToSchemas.fld_checkbox,
            () => {}
        );
        custom = copied.mountCustomField(checkbox, window.document);
        const stockCheckbox = stock.node.querySelector('input');
        stockCheckbox.checked = true;
        stockCheckbox.dispatchEvent(
            new window.Event('change', { bubbles: true })
        );
        assert.equal(custom.node.querySelector('input').checked, true);
        assert.equal(checkbox.getSnapshot().value, true);
        checks++;
        custom.node.querySelector('input').checked = false;
        custom.node
            .querySelector('input')
            .dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(stockCheckbox.checked, false);
        assert.equal(checkbox.getSnapshot().value, false);
        checks++;
        for (const nested of ['2', '-']) {
            const number = owner.field('fld_number');
            number.setValue(0);
            let fired = false;
            const stop = number.subscribe((snapshot) => {
                if (!fired && snapshot.value === 1) {
                    fired = true;
                    number.scalar.setInput(nested);
                }
            });
            number.scalar.setInput('1');
            stop();
            assert.equal(fired, true);
            assert.equal(number.scalar.getState().input, nested);
            assert.equal(number.getSnapshot().value, nested === '2' ? 2 : 1);
            assert.equal(number.scalar.getState().valid, nested === '2');
            const before = saves.length;
            if (nested === '-') {
                await assert.rejects(owner.save());
                assert.equal(saves.length, before);
            } else {
                await owner.save();
                assert.equal(saves.at(-1).formRecord.data.fld_number, 2);
            }
            checks++;
        }
        const number = owner.field('fld_number');
        number.setValue(0);
        let fired = false;
        const stop = number.subscribe((snapshot) => {
            if (!fired && snapshot.value === 1) {
                fired = true;
                number.scalar.setInput('-');
            }
        });
        number.setValue(1);
        stop();
        assert.equal(number.scalar.getState().input, '-');
        assert.equal(number.scalar.getState().valid, false);
        await assert.rejects(owner.save());
        checks++;
        console.log(
            `Installed scalar bindings: ${checks} React/copy-starter checkpoints passed (synthetic DOM and Save validation response, no native browser or persistence).`
        );
        return checks;
    } finally {
        stock?.destroy();
        custom?.destroy();
        if (root) await require('react').act(async () => root.unmount());
        owner?.destroy();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
