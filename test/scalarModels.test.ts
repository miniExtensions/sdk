import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createNumberFieldModel,
    createCheckboxFieldModel,
} from '../src/ui/scalarModels.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import {
    createMiniExtensionsClient,
    AirtableFieldType,
} from '../src/runtime/index.js';
import type {
    FormLoadedResult,
    RuntimeFieldSchema,
    SaveFormInput,
} from '../src/runtime/types.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';

const scalarForm = () => {
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm.push(
        'fld_number',
        'fld_percent',
        'fld_checkbox'
    );
    for (const [id, type] of [
        ['fld_number', AirtableFieldType.NUMBER],
        ['fld_percent', AirtableFieldType.PERCENT],
        ['fld_checkbox', AirtableFieldType.CHECKBOX],
    ] as const) {
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
                        type === AirtableFieldType.CHECKBOX
                            ? { icon: 'check', color: 'greenBright' }
                            : { precision: 2 },
                },
            },
            miniExtConfig: {
                conditionalFields: { logicalOperator: 'and', conditions: [] },
            },
        } as RuntimeFieldSchema;
    }
    loaded.payload.formRecord.data.fld_number = null;
    loaded.payload.formRecord.data.fld_percent = 0.25;
    loaded.payload.formRecord.data.fld_checkbox = null;
    return loaded;
};
describe('renderer-neutral scalar models', () => {
    it('preserves canonical empty native whitespace without synthesizing a write', () => {
        for (const create of [
            createNumberFieldModel,
            createCheckboxFieldModel,
        ]) {
            for (const value of [null, undefined, '', ' \t ']) {
                const model = create({
                    getValue: () => value,
                    canEdit: () => true,
                    isCurrent: () => true,
                    write: () => {
                        throw new Error('No load-time write');
                    },
                });
                assert.equal(model.getState().valid, true);
                assert.equal(model.getState().input, '');
                assert.equal(model.getState().checked, false);
                model.destroy();
            }
        }
    });

    it('keeps incomplete/invalid numeric input without writing or accepting nonfinite values', () => {
        let value: unknown = null;
        const writes: unknown[] = [];
        let current = true;
        const model = createNumberFieldModel({
            getValue: () => value,
            isCurrent: () => current,
            canEdit: () => true,
            write: (v) => {
                writes.push(v);
                value = v;
                return true;
            },
        });
        for (const invalid of [
            '-',
            '1e',
            ' ',
            'NaN',
            'Infinity',
            '1e400',
            '0x10',
        ]) {
            assert.equal(model.setInput(invalid), false);
            assert.equal(model.getState().input, invalid);
            assert.equal(model.getState().valid, false);
            assert.equal(value, null);
        }
        assert.equal(writes.length, 0);
        for (const [input, native] of [
            ['0', 0],
            ['-1.5', -1.5],
            ['.25', 0.25],
            ['1e2', 100],
            ['', null],
        ] as const) {
            assert.equal(model.setInput(input), true);
            assert.equal(value, native);
            assert.equal(model.getState().valid, true);
        }
        current = false;
        assert.equal(model.setInput('7'), false);
        assert.equal(model.getState().input, '');
        current = true;
        assert.equal(model.setInput('8'), false);
    });
    it('checkbox actions preserve booleans/null and honor read-only/retirement', () => {
        let value: unknown = null;
        let writable = true;
        const model = createCheckboxFieldModel({
            getValue: () => value,
            isCurrent: () => true,
            canEdit: () => writable,
            write: (v) => {
                value = v;
                return true;
            },
        });
        assert.equal(model.getState().checked, false);
        assert.equal(value, null);
        assert.equal(model.setChecked(true), true);
        assert.equal(value, true);
        writable = false;
        assert.equal(model.setChecked(false), false);
        assert.equal(value, true);
        writable = true;
        assert.equal(model.setChecked(false), true);
        assert.equal(value, false);
        model.destroy();
        assert.equal(model.setChecked(true), false);
    });
    it('shares native validation and explicit Save with custom renderers while preserving percent fractions', async () => {
        const loaded = scalarForm();
        const calls: SaveFormInput[] = [];
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('No automatic I/O');
            },
        });
        client.forms.save = async (input) => {
            calls.push(input);
            return invalidForm();
        };
        let scope = { ownerId: 'A', revision: 0 };
        let writable = true;
        const owner = createFormFieldBindings({
            client,
            loaded,
            saveOptions: formSaveOptions(),
            getScope: () => scope,
            canWriteField: () => writable,
        });
        const number = owner.field('fld_number'),
            percent = owner.field('fld_percent'),
            checkbox = owner.field('fld_checkbox');
        assert.equal(percent.scalar?.getState().input, '0.25');
        for (const bad of [NaN, Infinity, -Infinity, '3', true, []] as const)
            assert.equal(number.setValue(bad as never).accepted, false);
        assert.equal(number.scalar?.setInput('-'), false);
        await assert.rejects(owner.save());
        assert.equal(calls.length, 0);
        assert.equal(number.setValue(3).accepted, true);
        assert.equal(number.scalar?.getState().valid, true);
        assert.equal(percent.scalar?.setInput('0.125'), true);
        assert.equal(checkbox.scalar?.setChecked(true), true);
        writable = false;
        owner.refresh();
        assert.equal(number.scalar?.setInput('9'), false);
        writable = true;
        owner.refresh();
        await owner.save();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].formRecord.data.fld_number, 3);
        assert.equal(calls[0].formRecord.data.fld_percent, 0.125);
        assert.equal(calls[0].formRecord.data.fld_checkbox, true);
        const native = owner.controller.getState().draft!.data;
        assert.equal(
            native.fld_title,
            loaded.payload.formRecord.data.fld_title
        );
        assert.deepEqual(
            native.fld_parent,
            loaded.payload.formRecord.data.fld_parent
        );
        scope = { ownerId: 'B', revision: 1 };
        assert.equal(number.scalar?.setInput('10'), false);
        scope = { ownerId: 'A', revision: 2 };
        assert.equal(number.scalar?.setInput('11'), false);
        owner.destroy();
    });
    it('binding notifications cannot let an outer edit overwrite newer valid or invalid input', async () => {
        for (const nested of ['2', '-']) {
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    throw Error('No implicit I/O');
                },
            });
            const calls: SaveFormInput[] = [];
            client.forms.save = async (input) => {
                calls.push(input);
                return invalidForm();
            };
            const owner = createFormFieldBindings({
                client,
                loaded: scalarForm(),
                saveOptions: formSaveOptions(),
                getScope: () => ({ ownerId: 'A', revision: 0 }),
            });
            const number = owner.field('fld_number');
            let entered = false;
            const stop = number.subscribe((state) => {
                if (state.value === 1 && !entered) {
                    entered = true;
                    number.scalar!.setInput(nested);
                }
            });
            number.scalar!.setInput('1');
            assert.equal(number.scalar!.getState().input, nested);
            if (nested === '2') {
                assert.equal(number.getSnapshot().value, 2);
                await owner.save();
                assert.equal(calls[0].formRecord.data.fld_number, 2);
            } else {
                assert.equal(number.getSnapshot().value, 1);
                assert.equal(number.scalar!.getState().valid, false);
                await assert.rejects(owner.save());
                assert.equal(calls.length, 0);
            }
            stop();
            owner.destroy();
        }
    });
    it('raw binding replacement cannot discard a newer invalid renderer input', () => {
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('No implicit I/O');
            },
        });
        const owner = createFormFieldBindings({
            client,
            loaded: scalarForm(),
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'A', revision: 0 }),
        });
        const number = owner.field('fld_number');
        let entered = false;
        const stop = number.subscribe((state) => {
            if (state.value === 1 && !entered) {
                entered = true;
                number.scalar!.setInput('-');
            }
        });
        number.setValue(1);
        assert.equal(number.scalar!.getState().input, '-');
        assert.equal(number.scalar!.getState().valid, false);
        assert.equal(number.getSnapshot().value, 1);
        stop();
        owner.destroy();
    });
    it('accepted reload creates new models while retained actions cannot touch successor values', async () => {
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('No automatic I/O');
            },
        });
        const owner = createFormFieldBindings({
            client,
            loaded: scalarForm(),
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'A', revision: 0 }),
        });
        const old = owner.field('fld_number');
        old.scalar!.setInput('8');
        const fresh = scalarForm();
        fresh.payload.formRecord.data.fld_number = 12;
        assert.equal(
            await owner.reload({ dirty: 'discard', read: async () => fresh }),
            true
        );
        const next = owner.field('fld_number');
        assert.equal(next.getSnapshot().value, 12);
        assert.equal(old.scalar!.setInput('20'), false);
        assert.equal(next.getSnapshot().value, 12);
        owner.destroy();
    });
});
