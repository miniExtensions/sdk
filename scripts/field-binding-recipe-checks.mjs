import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export async function checkFieldBindingRecipe({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(
        consumerDirectory,
        '.generated/field-binding-checks.mjs'
    );
    await build({
        absWorkingDir: consumerDirectory,
        stdin: {
            contents: `
        export { createFormFieldBindings, RecoveryJournal } from '@miniextensions/sdk/forms';
        export { createPortalCellBinding } from '@miniextensions/sdk/portals';
        export { mountBoundFormField } from './src/fields.ts';
        export { mountCustomField } from './src/customFieldRenderer.ts';
    `,
            resolveDir: consumerDirectory,
            sourcefile: 'binding-consumer.ts',
        },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
    });
    const window = new Window();
    const old = new Map(
        [
            'window',
            'document',
            'HTMLElement',
            'HTMLInputElement',
            'HTMLTextAreaElement',
            'HTMLSelectElement',
            'Event',
        ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
    );
    for (const key of old.keys()) globalThis[key] = window[key];
    try {
        const {
            createFormFieldBindings,
            createPortalCellBinding,
            RecoveryJournal,
            mountBoundFormField,
            mountCustomField,
        } = await import(pathToFileURL(outfile));
        const loaded = portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        loaded.payload.hasParentExtension = false;
        const select = {
            fieldType: 'multipleSelects',
            airtableField: {
                id: 'fld_choices',
                name: 'Choices',
                isComputed: false,
                config: {
                    type: 'multipleSelects',
                    options: {
                        choices: [
                            { id: 'a', name: 'Alpha' },
                            { id: 'b', name: 'Beta' },
                        ],
                    },
                },
            },
            miniExtConfig: { maxNumberOfSelections: 1 },
        };
        loaded.payload.fieldIdsInForm.push('fld_choices', 'fld_parent');
        loaded.payload.fieldIdsToSchemas.fld_choices = select;
        loaded.payload.formRecord.data.fld_choices = [];
        const saves = [];
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
        let fieldLease = true;
        const owner = createFormFieldBindings({
            loaded,
            client,
            getScope: () => ({ ownerId: 'A', revision: 0 }),
            canWriteField: () => fieldLease,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: {},
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        const text = owner.field('fld_title');
        let stock = mountBoundFormField(
            text,
            loaded.payload.fieldIdsToSchemas.fld_title,
            () => {}
        );
        let custom = mountCustomField(text, window.document);
        window.document.body.append(stock.node, custom.node);
        const input = stock.node.matches('input')
            ? stock.node
            : stock.node.querySelector('input');
        input.value = 'Stock edit';
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(custom.node.querySelector('input').value, 'Stock edit');
        const customInput = custom.node.querySelector('input');
        customInput.value = 'Custom edit';
        customInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(text.getSnapshot().value, 'Custom edit');
        assert.equal(input.value, 'Custom edit');
        fieldLease = false;
        input.value = 'Retained forbidden edit';
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(text.getSnapshot().value, 'Custom edit');
        assert.equal(input.value, 'Custom edit');
        assert.equal(saves.length, 0);
        fieldLease = true;
        owner.refresh();

        stock.destroy();
        stock.node.remove();
        custom.destroy();
        stock = mountBoundFormField(
            text,
            loaded.payload.fieldIdsToSchemas.fld_title,
            () => {}
        );
        custom = mountCustomField(text, window.document);
        window.document.body.append(stock.node, custom.node);
        assert.equal(custom.node.querySelector('input').value, 'Custom edit');
        assert.equal(text.getSnapshot().dirty, true);
        const choices = owner.field('fld_choices');
        const selectStock = mountBoundFormField(choices, select, () => {});
        const selectCustom = mountCustomField(choices, window.document);
        window.document.body.append(selectStock.node, selectCustom.node);
        selectCustom.node.querySelector('button').click();
        assert.deepEqual(choices.getSnapshot().value, ['Alpha']);
        assert.equal(
            selectStock.node.querySelector('select').selectedOptions[0].value,
            'Alpha'
        );
        const linked = owner.field('fld_parent');
        owner.setLinkedOptions('fld_parent', [
            { value: 'rec_user', label: 'Parent' },
            { value: 'rec_new', label: 'New authorized parent' },
        ]);
        const linkedStock = mountBoundFormField(
            linked,
            loaded.payload.fieldIdsToSchemas.fld_parent,
            () => {}
        );
        const linkedCustom = mountCustomField(linked, window.document);
        window.document.body.append(linkedStock.node, linkedCustom.node);
        [...linkedCustom.node.querySelectorAll('button')]
            .find((button) => button.textContent === 'New authorized parent')
            .click();
        assert.deepEqual(linked.getSnapshot().value, ['rec_user', 'rec_new']);
        assert.equal(saves.length, 0);
        await owner.save();
        assert.equal(saves.length, 1);
        assert.deepEqual(saves[0].formRecord.data, {
            ...loaded.payload.formRecord.data,
            fld_title: 'Custom edit',
            fld_choices: ['Alpha'],
            fld_parent: ['rec_user', 'rec_new'],
        });
        for (const id of ['fld_title', 'fld_choices', 'fld_parent'])
            assert(saves[0].formFieldIdsWithUnsavedChanges.includes(id));
        for (const renderer of [
            stock,
            custom,
            selectStock,
            selectCustom,
            linkedStock,
            linkedCustom,
        ])
            renderer.destroy();
        owner.destroy();
        // Installed Portal owner consumed by the actual shipped stock/custom renderers.
        const gridCalls = [];
        const gridClient = {
            getSession: () => ({}),
            portals: {
                updateGridCell: async (input) => {
                    gridCalls.push(structuredClone(input));
                    return {
                        record: {
                            id: input.recordId,
                            fields: { [input.recordFieldId]: input.value },
                        },
                        auditTrail: null,
                        auditTrails: [],
                    };
                },
            },
        };
        const journal = new RecoveryJournal();
        const cell = createPortalCellBinding({
            client: gridClient,
            input: {
                portalExtensionAccessToken: 'portal-token',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_title',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
            },
            schema: loaded.payload.fieldIdsToSchemas.fld_title,
            value: 'Portal initial',
            getScope: () => ({ ownerId: 'A', revision: 0 }),
            isCurrent: () => true,
            recovery: {
                journal,
                scope: {
                    owner: 'A',
                    parentFieldId: 'fld_children',
                    tableId: 'tbl_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        let cellStock = mountBoundFormField(
            cell.binding,
            loaded.payload.fieldIdsToSchemas.fld_title,
            () => {}
        );
        let cellCustom = mountCustomField(cell.binding, window.document);
        window.document.body.append(cellStock.node, cellCustom.node);
        const cellInput = cellCustom.node.querySelector('input');
        cellInput.value = 'Portal custom edit';
        cellInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(
            cellStock.node.querySelector('input').value,
            'Portal custom edit'
        );
        cellStock.destroy();
        cellStock.node.remove();
        cellCustom.destroy();
        cellStock = mountBoundFormField(
            cell.binding,
            loaded.payload.fieldIdsToSchemas.fld_title,
            () => {}
        );
        cellCustom = mountCustomField(cell.binding, window.document);
        window.document.body.append(cellStock.node, cellCustom.node);
        assert.equal(
            cellCustom.node.querySelector('input').value,
            'Portal custom edit'
        );
        assert.equal(gridCalls.length, 0);
        await cell.save();
        assert.deepEqual(gridCalls, [
            {
                portalExtensionAccessToken: 'portal-token',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_title',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
                value: 'Portal custom edit',
            },
        ]);
        await assert.rejects(cell.save());
        assert.equal(gridCalls.length, 1);
        cellStock.destroy();
        cellCustom.destroy();
        cell.destroy();
        return { checks: 2 };
    } finally {
        window.happyDOM.abort();
        for (const [key, descriptor] of old) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}
