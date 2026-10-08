import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Window } from 'happy-dom';
import type {
    AirtableValue,
    RuntimeFieldSchema,
} from '../src/runtime/types.js';
import { createSelectFieldModel } from '../src/ui/selectModel.js';
import { createSelectControl, mountSelectControl } from '../src/ui/controls.js';
import type { SelectionState } from '../src/ui/types.js';

const field = (multiple = true): RuntimeFieldSchema => {
    const type = multiple ? 'multipleSelects' : 'singleSelect';
    return {
        fieldType: type,
        airtableField: {
            id: 'fld_select',
            name: 'Choices',
            isComputed: false,
            config: {
                type,
                options: {
                    choices: [
                        { id: 'sel_a', name: 'Alpha' },
                        { id: 'sel_b', name: 'Beta' },
                        { id: 'sel_c', name: 'Gamma' },
                    ],
                },
            },
        },
        miniExtConfig: { maxNumberOfSelections: 1 },
    } as RuntimeFieldSchema;
};

describe('renderer-neutral select field model', () => {
    it('owns limits and native names without a Document; stock and custom consumers agree', async () => {
        const window = new Window();
        try {
            const document = window.document as unknown as Document;
            const writes: AirtableValue[] = [];
            const model = createSelectFieldModel({
                field: field(),
                onChange: (value) => writes.push(value),
            });
            let custom!: SelectionState;
            const unsubscribe = model.subscribe((state) => {
                custom = state;
            });
            const stock = mountSelectControl(model, {
                label: 'Choices',
                document,
            });
            document.body.append(stock.element);
            const select = stock.element.querySelector('select')!;
            select.options[0]!.selected = true;
            select.dispatchEvent(
                new window.Event('change') as unknown as Event
            );
            assert.deepEqual(custom.value, ['Alpha']);
            assert.deepEqual(writes, [['Alpha']]);
            assert.equal(
                custom.options.find((option) => option.value === 'Beta')!
                    .disabled,
                true
            );
            assert.equal(select.options[1]!.disabled, true);
            model.choose(['Alpha', 'Beta']);
            assert.deepEqual(model.getState().value, ['Alpha']);
            assert.equal(writes.length, 1);
            model.choose(['Beta']);
            assert.deepEqual(custom.value, ['Beta']);
            assert.equal(select.options[1]!.selected, true);
            custom.value = [];
            custom.options[0]!.label = 'mutated';
            assert.deepEqual(model.getState().value, ['Beta']);
            assert.equal(model.getState().options[0]!.label, 'Alpha');
            stock.destroy();
            unsubscribe();
            model.destroy();
        } finally {
            await window.happyDOM.close();
        }
    });

    it('ordinary stock unmount/remount preserves model state; retained old DOM is inert', async () => {
        const window = new Window();
        try {
            const document = window.document as unknown as Document;
            const writes: AirtableValue[] = [];
            const model = createSelectFieldModel({
                field: field(false),
                onChange: (value) => writes.push(value),
            });
            const first = mountSelectControl(model, {
                label: 'First',
                document,
            });
            const old = first.element.querySelector('select')!;
            model.choose(['Gamma']);
            first.destroy();
            first.element.remove();
            old.value = 'Alpha';
            old.dispatchEvent(new window.Event('change') as unknown as Event);
            assert.deepEqual(writes, ['Gamma']);
            const second = mountSelectControl(model, {
                label: 'Second',
                document,
            });
            document.body.append(second.element);
            assert.equal(
                second.element.querySelector('select')!.value,
                'Gamma'
            );
            assert.deepEqual(model.getState().value, ['Gamma']);
            second.destroy();
            model.destroy();
        } finally {
            await window.happyDOM.close();
        }
    });

    it('factory and headless model share restricted-option and retained-choice behavior', async () => {
        const window = new Window();
        try {
            const schema = field();
            schema.miniExtConfig = {
                singleOrMultiSelectLimitSelectionOptions: ['sel_b'],
                maxNumberOfSelections: 1,
            };
            const headless = createSelectFieldModel({
                field: schema,
                value: ['Alpha'],
            });
            const stock = createSelectControl({
                field: schema,
                value: ['Alpha'],
                document: window.document as unknown as Document,
            });
            assert.deepEqual(stock.model.getState(), headless.getState());
            for (const choices of [
                ['Alpha', 'Beta'],
                [],
                ['Gamma'],
                ['Beta'],
            ]) {
                headless.choose(choices);
                stock.model.choose(choices);
                assert.deepEqual(stock.model.getState(), headless.getState());
            }
            assert.deepEqual(headless.getState().value, ['Beta']);
            stock.destroy();
            headless.destroy();
        } finally {
            await window.happyDOM.close();
        }
    });

    it('canonical readonly cannot be relaxed; incompatible reset and async loaders still refuse', () => {
        const schema = field(false);
        schema.miniExtConfig = { readOnly: true };
        let writes = 0;
        const model = createSelectFieldModel({
            field: schema,
            value: 'Alpha',
            onChange: () => writes++,
        });
        model.setReadOnly(false);
        model.choose(['Beta']);
        assert.deepEqual(model.getState().value, ['Alpha']);
        assert.equal(writes, 0);
        assert.throws(() => model.reset({ multiple: true }), /Recreate/);
        assert.throws(
            () =>
                model.reset({
                    loadOptions: async () => ({ options: [], offset: null }),
                }),
            /mountSelectionControl/
        );
        model.destroy();
        model.choose(['Beta']);
        assert.equal(writes, 0);
    });
});
