import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { AirtableFieldType } from '../src/formulas/types.js';
import type {
    AirtableValue,
    RuntimeFieldSchema,
} from '../src/runtime/types.js';
import {
    createSelectControl,
    mountSelectionControl,
    type MountedSelectionControl,
    type SelectControl,
} from '../src/ui/controls.js';
import { createSelectionModel } from '../src/ui/model.js';
import { getSelectFieldPolicy } from '../src/ui/selectPolicy.js';
import type { SelectionLoader, SelectionPage } from '../src/ui/types.js';

const environment = (test: TestContext) => {
    const window = new Window({ url: 'https://ui.example.test' });
    test.after(() => window.happyDOM.close());
    const document = window.document as unknown as Document;
    const dispatch = (element: HTMLElement, type: string): void => {
        element.dispatchEvent(
            new window.Event(type, { bubbles: true }) as unknown as Event
        );
    };
    return { document, dispatch };
};

type SelectFieldSchema = Extract<
    RuntimeFieldSchema,
    { fieldType: 'singleSelect' | 'multipleSelects' }
>;

const field = (multiple = false): SelectFieldSchema => {
    const metadata = {
        id: 'fld_choices',
        name: 'Colors',
        description: null,
        isComputed: false,
        isPrimaryField: false,
    };
    const options = {
        choices: [
            { id: 'sel_red', name: 'Red' },
            { id: 'sel_blue', name: 'Blue' },
        ],
    };
    return multiple
        ? {
              fieldType: AirtableFieldType.MULTIPLE_SELECTS,
              airtableField: {
                  ...metadata,
                  config: { type: AirtableFieldType.MULTIPLE_SELECTS, options },
              },
          }
        : {
              fieldType: AirtableFieldType.SINGLE_SELECT,
              airtableField: {
                  ...metadata,
                  config: { type: AirtableFieldType.SINGLE_SELECT, options },
              },
          };
};

const part = <Element extends HTMLElement>(
    root: HTMLElement,
    name: string
): Element => {
    const element = root.querySelector<Element>(`[data-ui="${name}"]`);
    assert.ok(element, `Missing ${name}`);
    return element;
};

const deferred = () => {
    let resolve!: (value: SelectionPage) => void;
    let reject!: (cause: Error) => void;
    const promise = new Promise<SelectionPage>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

describe('native select controls', () => {
    it('limits new choices by metadata ID while retaining and removing native baseline names', (test) => {
        const { document, dispatch } = environment(test);
        for (const multiple of [false, true]) {
            const schema = field(multiple);
            schema.miniExtConfig = {
                singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
                allowAddingNewOptions: true,
            };
            const changes: AirtableValue[] = [];
            const control = createSelectControl({
                field: schema,
                value: multiple ? ['Legacy', 'Red'] : 'Red',
                document,
                onChange: (value) => changes.push(value),
            });
            test.after(() => control.destroy());
            const select = part<HTMLSelectElement>(control.element, 'select');
            assert.equal(
                getSelectFieldPolicy(schema).allowAddingNewOptions,
                false
            );
            assert.deepEqual(
                control.model.getState().options.map((option) => option.value),
                ['Blue']
            );
            assert.deepEqual(
                new Set(
                    Array.from(select.selectedOptions, (option) => option.value)
                ),
                new Set(multiple ? ['Legacy', 'Red'] : ['Red'])
            );
            dispatch(select, 'change');
            assert.deepEqual(changes, []);
            control.model.clear();
            control.model.setOptions([
                { value: 'Red', label: 'Forbidden' },
                { value: 'Blue', label: 'Allowed' },
            ]);
            control.model.choose(['Red']);
            assert.deepEqual(control.model.getState().value, []);
            control.model.choose(['sel_blue']);
            assert.deepEqual(control.model.getState().value, []);
            control.model.choose(['Blue']);
            assert.deepEqual(control.model.getState().value, ['Blue']);
            assert.deepEqual(changes, [
                multiple ? [] : null,
                multiple ? ['Blue'] : 'Blue',
            ]);
            control.model.reset({
                value: ['Red'],
                options: [{ value: 'Red', label: 'Owner baseline' }],
            });
            assert.deepEqual(control.model.getState().value, ['Red']);
            assert.equal(changes.length, 2);
            control.model.clear();
            control.model.toggle('Red');
            assert.deepEqual(control.model.getState().value, []);
            const count = changes.length;
            control.destroy();
            select.value = 'Blue';
            dispatch(select, 'change');
            control.model.choose(['Blue']);
            assert.equal(changes.length, count);
        }
        for (const limits of [undefined, []]) {
            const schema = field();
            schema.miniExtConfig = {
                allowAddingNewOptions: true,
                singleOrMultiSelectLimitSelectionOptions: limits,
            };
            assert.equal(
                getSelectFieldPolicy(schema).allowAddingNewOptions,
                true
            );
        }
        const schema = field();
        schema.miniExtConfig = {
            singleOrMultiSelectLimitSelectionOptions: ['Blue'],
        };
        const control = createSelectControl({ field: schema, document });
        test.after(() => control.destroy());
        assert.deepEqual(control.model.getState().options, []);
    });

    it('keeps over-limit baselines, permits removal, and blocks additions across every user entrypoint', async (test) => {
        const { document, dispatch } = environment(test);
        const schema = field(true);
        schema.airtableField.config.options.choices.push({
            id: 'sel_green',
            name: 'Green',
        });
        schema.miniExtConfig = { maxNumberOfSelections: 2 };
        const changes: AirtableValue[] = [];
        const control = createSelectControl({
            field: schema,
            value: ['Legacy', 'Red', 'Blue'],
            document,
            onChange: (value) => changes.push(value),
        });
        test.after(() => control.destroy());
        const select = part<HTMLSelectElement>(control.element, 'select');
        assert.deepEqual(control.model.getState().value, [
            'Legacy',
            'Red',
            'Blue',
        ]);
        control.model.toggle('Green');
        control.model.choose(['Legacy', 'Red', 'Blue', 'Green']);
        const green = Array.from(select.options).find(
            (option) => option.value === 'Green'
        );
        assert.ok(green);
        assert.equal(green.disabled, true);
        green.selected = true;
        dispatch(select, 'change');
        assert.deepEqual(changes, []);
        assert.equal(green.selected, false);
        control.model.toggle('Legacy');
        control.model.toggle('Red');
        control.model.toggle('Green');
        assert.deepEqual(control.model.getState().value, ['Blue', 'Green']);
        assert.deepEqual(changes, [
            ['Red', 'Blue'],
            ['Blue'],
            ['Blue', 'Green'],
        ]);
        control.model.reset({ value: ['Legacy', 'Red', 'Blue'] });
        assert.deepEqual(control.model.getState().value, [
            'Legacy',
            'Red',
            'Blue',
        ]);
        assert.equal(changes.length, 3);
        control.model.choose(['Legacy', 'Red']);
        assert.deepEqual(control.model.getState().value, ['Legacy', 'Red']);
        control.model.toggle('Green');
        assert.equal(changes.length, 4);
        control.model.setValue(['Red', 'Blue']);
        await control.model.setSearchTerm('no-match');
        assert.deepEqual(control.model.getState().options, []);
        control.model.choose(['Red', 'Blue', 'Green']);
        control.model.toggle('Green');
        assert.deepEqual(control.model.getState().value, ['Red', 'Blue']);
        assert.equal(changes.length, 4);
    });

    it('renders configured labels safely and saves only canonical names', (test) => {
        const { document, dispatch } = environment(test);
        const schema = field(true);
        schema.miniExtConfig = {
            enableConditionalOptions: true,
            conditionsForOptions: [
                {
                    id: 'label_red',
                    config: {
                        optionForConditions: 'sel_red',
                        name: ' Color ',
                        conditionsForOption: {
                            logicalOperator: 'and',
                            conditions: [],
                        },
                    },
                },
                {
                    id: 'label_blue',
                    config: {
                        optionForConditions: 'sel_blue',
                        name: 'Color',
                        conditionsForOption: {
                            logicalOperator: 'and',
                            conditions: [],
                        },
                    },
                },
            ],
        };
        const changes: AirtableValue[] = [];
        const control = createSelectControl({
            field: schema,
            value: ['Red'],
            document,
            onChange: (value) => changes.push(value),
        });
        test.after(() => control.destroy());
        const select = part<HTMLSelectElement>(control.element, 'select');
        assert.deepEqual(
            Array.from(select.options, (option) => [
                option.value,
                option.textContent,
            ]),
            [
                ['Red', 'Color (Red)'],
                ['Blue', 'Color (Blue)'],
            ]
        );
        select.options[1]!.selected = true;
        dispatch(select, 'change');
        assert.deepEqual(changes, [['Red', 'Blue']]);
        control.model.setOptions([{ value: 'Blue', label: 'Replaced by app' }]);
        assert.equal(select.selectedOptions[0]?.textContent, 'Color (Blue)');
        schema.miniExtConfig.conditionsForOptions![0]!.config!.name =
            '<img src=x onerror=alert(1)>';
        schema.miniExtConfig.conditionsForOptions![1]!.config!.name = '   ';
        const safe = createSelectControl({ field: schema, document });
        test.after(() => safe.destroy());
        assert.equal(safe.element.querySelector('img'), null);
        assert.deepEqual(
            getSelectFieldPolicy(schema).options.map((option) => option.label),
            ['<img src=x onerror=alert(1)>', 'Blue']
        );
        schema.miniExtConfig.enableConditionalOptions = false;
        assert.deepEqual(
            getSelectFieldPolicy(schema).options.map((option) => option.label),
            ['Red', 'Blue']
        );
    });

    it('uses choice names, emits one user change, and updates silently from the model', (test) => {
        const { document, dispatch } = environment(test);
        const changes: AirtableValue[] = [];
        const control = createSelectControl({
            field: field(),
            value: 'Blue',
            label: '<img src=x onerror=alert(1)>',
            document,
            onChange: (value) => changes.push(value),
        });
        test.after(() => control.destroy());
        document.body.append(control.element);
        const select = part<HTMLSelectElement>(control.element, 'select');
        assert.equal(select.multiple, false);
        assert.equal(select.value, 'Blue');
        assert.equal(select.options[1]?.value, 'Red');
        assert.equal(control.element.querySelector('img'), null);
        assert.equal(
            part<HTMLLabelElement>(control.element, 'label').htmlFor,
            select.id
        );
        select.value = 'Red';
        dispatch(select, 'change');
        assert.deepEqual(changes, ['Red']);
        control.model.setValue(['Blue']);
        assert.equal(select.value, 'Blue');
        assert.deepEqual(changes, ['Red']);
        select.value = '';
        dispatch(select, 'change');
        assert.deepEqual(changes, ['Red', null]);
        control.model.reset({
            options: [{ value: 'Green', label: 'Green' }],
            value: ['Green'],
        });
        assert.equal(select.value, 'Green');
        assert.deepEqual(changes, ['Red', null]);
    });

    it('retains unknown multi selections without erasing them on an unrelated edit', (test) => {
        const { document, dispatch } = environment(test);
        const changes: AirtableValue[] = [];
        const control = createSelectControl({
            field: field(true),
            value: ['Legacy', 'Red'],
            document,
            onChange: (value) => changes.push(value),
        });
        test.after(() => control.destroy());
        const select = part<HTMLSelectElement>(control.element, 'select');
        assert.equal(select.multiple, true);
        assert.deepEqual(
            Array.from(select.selectedOptions, (option) => option.value),
            ['Red', 'Legacy']
        );
        assert.equal(
            Array.from(select.options).find(
                (option) => option.value === 'Legacy'
            )?.textContent,
            'Legacy'
        );
        dispatch(select, 'change');
        assert.deepEqual(changes, []);
        select.options[1]!.selected = true;
        dispatch(select, 'change');
        assert.deepEqual(changes, [['Legacy', 'Red', 'Blue']]);
        control.model.setOptions([{ value: 'Blue', label: 'Blue now' }]);
        assert.deepEqual(
            new Set(
                Array.from(select.selectedOptions, (option) => option.value)
            ),
            new Set(['Red', 'Blue', 'Legacy'])
        );
        control.model.setValue(
            ['rec_unknown'],
            [{ value: 'rec_unknown', label: 'Retained name' }]
        );
        assert.equal(select.selectedOptions[0]?.textContent, 'Retained name');
    });

    it('honors disabled, read-only, and computed metadata even for synthetic events', (test) => {
        const { document, dispatch } = environment(test);
        for (const schema of [
            { ...field(), miniExtConfig: { readOnly: true } },
            {
                ...field(),
                airtableField: { ...field().airtableField, isComputed: true },
            },
        ]) {
            const changes: AirtableValue[] = [];
            const control = createSelectControl({
                field: schema,
                value: 'Red',
                document,
                readOnly: false,
                onChange: (value) => changes.push(value),
            });
            test.after(() => control.destroy());
            const select = part<HTMLSelectElement>(control.element, 'select');
            control.model.setReadOnly(false);
            assert.equal(select.disabled, true);
            control.model.choose(['Blue']);
            control.model.toggle('Blue');
            control.model.clear();
            assert.deepEqual(control.model.getState().value, ['Red']);
            select.value = 'Blue';
            dispatch(select, 'change');
            assert.equal(select.value, 'Red');
            assert.deepEqual(changes, []);
        }
        const control = createSelectControl({ field: field(), document });
        test.after(() => control.destroy());
        const select = part<HTMLSelectElement>(control.element, 'select');
        control.model.setDisabled(true);
        assert.equal(select.disabled, true);
        control.model.setDisabled(false);
        control.model.setReadOnly(true);
        assert.equal(select.disabled, true);
        control.model.setReadOnly(false);
        assert.equal(select.disabled, false);
    });

    it('fails safely for unsupported, inconsistent, and malformed schemas or values', (test) => {
        const { document } = environment(test);
        const invalid = [
            { ...field(), fieldType: AirtableFieldType.NUMBER },
            { ...field(), airtableField: { ...field().airtableField, id: '' } },
            {
                ...field(),
                airtableField: { ...field().airtableField, name: '' },
            },
            {
                ...field(),
                airtableField: {
                    ...field().airtableField,
                    isComputed: 'false',
                },
            },
            { ...field(), miniExtConfig: { readOnly: 'false' } },
            {
                ...field(),
                miniExtConfig: {
                    singleOrMultiSelectLimitSelectionOptions: [''],
                },
            },
            {
                ...field(),
                miniExtConfig: {
                    singleOrMultiSelectLimitSelectionOptions: 'sel_blue',
                },
            },
            { ...field(true), miniExtConfig: { maxNumberOfSelections: -1 } },
            {
                ...field(true),
                miniExtConfig: { maxNumberOfSelections: Number.NaN },
            },
            {
                ...field(),
                airtableField: {
                    ...field().airtableField,
                    config: {
                        type: AirtableFieldType.NUMBER,
                        options: { precision: 0 },
                    },
                },
            },
            {
                ...field(),
                airtableField: {
                    ...field().airtableField,
                    config: {
                        type: AirtableFieldType.SINGLE_SELECT,
                        options: {
                            choices: [
                                { id: 'sel_a', name: 'Same' },
                                { id: 'sel_b', name: 'Same' },
                            ],
                        },
                    },
                },
            },
            {
                ...field(),
                airtableField: {
                    ...field().airtableField,
                    config: {
                        type: AirtableFieldType.SINGLE_SELECT,
                        options: { choices: 'bad' },
                    },
                },
            },
        ];
        for (const schema of invalid) {
            assert.throws(
                () =>
                    createSelectControl({
                        field: schema as unknown as RuntimeFieldSchema,
                        document,
                    }),
                TypeError
            );
        }
        assert.throws(
            () => createSelectControl({ field: field(), value: 42, document }),
            TypeError
        );
        assert.throws(
            () =>
                createSelectControl({
                    field: field(true),
                    value: ['Red', 42],
                    document,
                }),
            TypeError
        );
        assert.throws(
            () =>
                createSelectControl({
                    field: field(true),
                    value: new Array<string>(1),
                    document,
                }),
            TypeError
        );
        assert.throws(
            () => createSelectControl({ field: field() }),
            /Document is required/
        );
    });

    it('binds resets to the canonical mode, defaults, permission flags, and typed callback', (test) => {
        const { document, dispatch } = environment(test);
        const changes: AirtableValue[] = [];
        let genericChanges = 0;
        const control = createSelectControl({
            field: field(true),
            document,
            onChange: (value) => changes.push(value),
        });
        test.after(() => control.destroy());
        control.model.reset({
            value: ['Red'],
            onChange: () => genericChanges++,
        });
        const select = part<HTMLSelectElement>(control.element, 'select');
        assert.equal(select.multiple, true);
        assert.equal(select.options.length, 2);
        select.options[1]!.selected = true;
        dispatch(select, 'change');
        assert.deepEqual(changes, [['Red', 'Blue']]);
        assert.equal(genericChanges, 0);
        assert.throws(
            () => control.model.reset({ multiple: false }),
            /field mode/
        );
        assert.throws(
            () =>
                control.model.reset({
                    loadOptions: async () => ({ options: [], offset: null }),
                }),
            /async selection model/
        );
        assert.equal(select.multiple, true);
        const locked = createSelectControl({
            field: { ...field(), miniExtConfig: { readOnly: true } },
            document,
        });
        test.after(() => locked.destroy());
        locked.model.reset({ readOnly: false, value: ['Blue'] });
        assert.equal(locked.model.getState().readOnly, true);
        assert.equal(
            part<HTMLSelectElement>(locked.element, 'select').disabled,
            true
        );
    });

    it('destroys its owned model and removes DOM handlers', (test) => {
        const { document, dispatch } = environment(test);
        const changes: AirtableValue[] = [];
        const control = createSelectControl({
            field: field(),
            value: 'Red',
            document,
            onChange: (value) => changes.push(value),
        });
        const select = part<HTMLSelectElement>(control.element, 'select');
        control.destroy();
        control.destroy();
        const disposedValue = control.model.getState().value;
        control.model.setValue(['Blue']);
        control.model.reset({ multiple: true });
        select.value = 'Blue';
        dispatch(select, 'change');
        assert.deepEqual(control.model.getState().value, disposedValue);
        assert.deepEqual(changes, []);
    });

    it('respects resets and disposal during the factory change callback', (test) => {
        const { document, dispatch } = environment(test);
        let resetControl!: SelectControl;
        resetControl = createSelectControl({
            field: field(),
            document,
            onChange: () =>
                resetControl.model.reset({
                    value: ['Fresh'],
                    selectedOptions: [
                        { value: 'Fresh', label: 'New visitor choice' },
                    ],
                }),
        });
        test.after(() => resetControl.destroy());
        const resetSelect = part<HTMLSelectElement>(
            resetControl.element,
            'select'
        );
        resetSelect.value = 'Blue';
        dispatch(resetSelect, 'change');
        assert.equal(resetSelect.value, 'Fresh');
        assert.equal(
            resetSelect.selectedOptions[0]?.textContent,
            'New visitor choice'
        );
        let disposedControl!: SelectControl;
        let valueAtDisposal = '';
        disposedControl = createSelectControl({
            field: field(),
            document,
            onChange: () => {
                valueAtDisposal = part<HTMLSelectElement>(
                    disposedControl.element,
                    'select'
                ).value;
                disposedControl.destroy();
            },
        });
        const disposedSelect = part<HTMLSelectElement>(
            disposedControl.element,
            'select'
        );
        disposedSelect.value = 'Blue';
        dispatch(disposedSelect, 'change');
        assert.equal(disposedSelect.value, valueAtDisposal);
        assert.equal(disposedSelect.value, 'Blue');
    });
});

describe('async selection controls', () => {
    it('keeps only the replacement scope when a formatter resets during immediate subscription', (test) => {
        const { document } = environment(test);
        for (const hasOptions of [true, false]) {
            const model = createSelectionModel({
                options: hasOptions
                    ? [{ value: 'old', label: 'Previous visitor' }]
                    : [],
                value: ['old'],
                selectedOptions: [{ value: 'old', label: 'Previous visitor' }],
            });
            test.after(() => model.destroy());
            let replaced = false;
            const control = mountSelectionControl(model, {
                label: 'Records',
                document,
                formatLabel: (option) => {
                    if (!replaced && option.value === 'old') {
                        replaced = true;
                        model.reset({
                            options: [
                                { value: 'new', label: 'Current visitor' },
                            ],
                            value: ['new'],
                        });
                    }
                    return option.label;
                },
            });
            test.after(() => control.destroy());
            assert.equal(
                control.element.textContent?.includes('Previous visitor'),
                false
            );
            assert.equal(
                part<HTMLInputElement>(control.element, 'choice-input').value,
                'new'
            );
            assert.equal(
                part(control.element, 'selected-text').textContent,
                'Current visitor'
            );
            assert.equal(
                control.element.querySelectorAll('[data-ui="choice-input"]')
                    .length,
                1
            );
            assert.equal(model.getState().error, null);
        }
    });

    it('stops DOM writes and removes handlers when a formatter disposes the mount', (test) => {
        const { document, dispatch } = environment(test);
        const changes: string[][] = [];
        const model = createSelectionModel({
            options: [{ value: 'a', label: 'Original label' }],
            onChange: (value) => changes.push([...value]),
        });
        test.after(() => model.destroy());
        let dispose = false;
        let control!: MountedSelectionControl;
        control = mountSelectionControl(model, {
            label: 'Records',
            document,
            formatLabel: (option) => {
                if (dispose) control.destroy();
                return option.label;
            },
        });
        const originalDOM = control.element.outerHTML;
        const originalInput = part<HTMLInputElement>(
            control.element,
            'choice-input'
        );
        dispose = true;
        model.setOptions([{ value: 'a', label: 'Must never be written' }]);
        assert.equal(control.element.outerHTML, originalDOM);
        originalInput.checked = true;
        dispatch(originalInput, 'change');
        assert.equal(changes.length, 0);
        assert.deepEqual(model.getState().value, []);
        model.setValue(['a']);
        assert.equal(control.element.outerHTML, originalDOM);
    });

    it('clears old labels immediately when a formatter invalidates the captured scope', (test) => {
        const { document } = environment(test);
        let scopeCurrent = true;
        const loadOptions: SelectionLoader = async () => ({
            options: [],
            offset: null,
        });
        loadOptions.isCurrent = () => scopeCurrent;
        const changes: string[][] = [];
        const model = createSelectionModel({
            options: [{ value: 'old', label: 'Previous visitor label' }],
            value: ['old'],
            loadOptions,
            onChange: (value) => changes.push([...value]),
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
            formatLabel: (option) => {
                scopeCurrent = false;
                return option.label;
            },
        });
        test.after(() => control.destroy());
        // No explicit model call is needed to remove the retired visitor's UI.
        assert.equal(
            control.element.textContent?.includes('Previous visitor label'),
            false
        );
        assert.equal(
            control.element.querySelectorAll('[data-ui="choice-input"]').length,
            0
        );
        assert.equal(
            control.element.querySelectorAll('[data-ui="selected-option"]')
                .length,
            0
        );
        assert.match(
            part(control.element, 'error').textContent!,
            /context changed/
        );
        assert.deepEqual(changes, []);
    });

    it('uses labeled native radio/checkbox inputs and independent radio groups', (test) => {
        const { document, dispatch } = environment(test);
        const model = createSelectionModel({
            options: [
                { value: 'a', label: '<script>unsafe</script>' },
                { value: 'b', label: 'Bee' },
            ],
        });
        test.after(() => model.destroy());
        const first = mountSelectionControl(model, {
            label: 'Records',
            description: 'Choose an allowed record',
            document,
            formatLabel: (option) => `Label: ${option.label}`,
        });
        const second = mountSelectionControl(model, {
            label: 'Other records',
            document,
            search: false,
        });
        test.after(() => {
            first.destroy();
            second.destroy();
        });
        document.body.append(first.element, second.element);
        const radio = part<HTMLInputElement>(first.element, 'choice-input');
        const otherRadio = part<HTMLInputElement>(
            second.element,
            'choice-input'
        );
        assert.equal(radio.type, 'radio');
        assert.notEqual(radio.name, otherRadio.name);
        assert.notEqual(radio.id, otherRadio.id);
        assert.equal(
            part<HTMLLabelElement>(first.element, 'choice-label').htmlFor,
            radio.id
        );
        assert.equal(
            first.element.querySelector('legend')?.textContent,
            'Records'
        );
        assert.equal(first.element.querySelector('script'), null);
        assert.equal(
            part(first.element, 'choice-label').textContent,
            'Label: <script>unsafe</script>'
        );
        assert.equal(part(second.element, 'search').hidden, true);
        radio.checked = true;
        dispatch(radio, 'change');
        assert.deepEqual(model.getState().value, ['a']);
        assert.equal(otherRadio.checked, true);
        model.reset({
            multiple: true,
            options: [
                { value: 'a', label: 'Aye' },
                { value: 'b', label: 'Bee' },
            ],
        });
        assert.equal(radio.type, 'checkbox');
        radio.checked = true;
        dispatch(radio, 'change');
        const checkboxB = Array.from(
            first.element.querySelectorAll<HTMLInputElement>(
                '[data-ui="choice-input"]'
            )
        ).find((input) => input.value === 'b')!;
        checkboxB.checked = true;
        dispatch(checkboxB, 'change');
        assert.deepEqual(model.getState().value, ['a', 'b']);
        part<HTMLButtonElement>(first.element, 'clear').click();
        assert.deepEqual(model.getState().value, []);
    });

    it('renders loading, More, empty, safe error text, and Retry while retaining focus', async (test) => {
        const { document, dispatch } = environment(test);
        let request = deferred();
        const model = createSelectionModel({
            multiple: true,
            loadOptions: () => request.promise,
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
            messages: { empty: 'Nothing here', loading: 'Working' },
        });
        test.after(() => control.destroy());
        document.body.append(control.element);
        assert.equal(
            part(control.element, 'status').textContent,
            'Nothing here'
        );
        const initial = model.reload();
        assert.equal(part(control.element, 'status').textContent, 'Working');
        assert.equal(
            part(control.element, 'status').getAttribute('aria-live'),
            'polite'
        );
        await Promise.resolve();
        request.resolve({
            options: [{ value: 'a', label: 'Aye' }],
            offset: 'next',
        });
        await initial;
        const first = part<HTMLInputElement>(control.element, 'choice-input');
        first.focus();
        request = deferred();
        part<HTMLButtonElement>(control.element, 'more').click();
        const next = model.loadMore();
        assert.equal(document.activeElement, first);
        assert.equal(part(control.element, 'status').textContent, 'Working');
        await Promise.resolve();
        request.resolve({
            options: [{ value: 'b', label: 'Bee' }],
            offset: null,
        });
        await next;
        assert.equal(part(control.element, 'choice-input'), first);
        assert.equal(document.activeElement, first);
        assert.equal(
            control.element.querySelectorAll('[data-ui="choice-input"]').length,
            2
        );
        request = deferred();
        const reload = model.reload();
        assert.equal(document.activeElement, first);
        await Promise.resolve();
        request.resolve({
            options: [{ value: 'a', label: 'Aye updated' }],
            offset: null,
        });
        await reload;
        assert.equal(document.activeElement, first);
        request = deferred();
        const search = part<HTMLInputElement>(control.element, 'search');
        search.focus();
        search.value = 'missing';
        dispatch(search, 'input');
        const searching = model.loadMore();
        assert.equal(document.activeElement, search);
        assert.equal(model.getState().searchTerm, 'missing');
        await Promise.resolve();
        request.resolve({ options: [], offset: null });
        await searching;
        assert.equal(
            part(control.element, 'status').textContent,
            'Nothing here'
        );
        request = deferred();
        const failure = model.reload();
        await Promise.resolve();
        request.reject(new Error('<script>network error</script>'));
        await failure;
        assert.equal(part(control.element, 'error').hidden, false);
        assert.equal(
            part(control.element, 'error').getAttribute('role'),
            'alert'
        );
        assert.equal(control.element.querySelector('script'), null);
        assert.match(
            part(control.element, 'error').textContent!,
            /network error/
        );
        request = deferred();
        part<HTMLButtonElement>(control.element, 'retry').click();
        const retrying = model.loadMore();
        await Promise.resolve();
        request.resolve({
            options: [{ value: 'c', label: 'See' }],
            offset: null,
        });
        await retrying;
        assert.equal(part(control.element, 'error').hidden, true);
        assert.equal(part(control.element, 'retry').hidden, true);
    });

    it('retains selected labels across filters and removes only the requested selection', async (test) => {
        const { document } = environment(test);
        const changes: string[][] = [];
        const model = createSelectionModel({
            multiple: true,
            options: [{ value: 'a', label: 'Aye' }],
            value: ['a', 'legacy'],
            selectedOptions: [{ value: 'legacy', label: '<b>Old record</b>' }],
            onChange: (value) => changes.push([...value]),
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
        });
        test.after(() => control.destroy());
        await model.setSearchTerm('unmatched');
        assert.equal(
            control.element.querySelectorAll('[data-ui="choice-input"]').length,
            0
        );
        assert.equal(
            control.element.querySelectorAll('[data-ui="selected-option"]')
                .length,
            2
        );
        assert.equal(control.element.querySelector('b'), null);
        const buttons =
            control.element.querySelectorAll<HTMLButtonElement>(
                '[data-ui="remove"]'
            );
        assert.match(buttons[1]!.getAttribute('aria-label')!, /Old record/);
        buttons[1]!.click();
        assert.deepEqual(model.getState().value, ['a']);
        assert.deepEqual(changes, [['a']]);
    });

    it('preserves the focused keyed input and selection button when existing rows reorder', (test) => {
        const { document } = environment(test);
        const model = createSelectionModel({
            multiple: true,
            options: [
                { value: 'a', label: 'Aye' },
                { value: 'b', label: 'Bee' },
            ],
            value: ['a', 'b'],
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
        });
        test.after(() => control.destroy());
        document.body.append(control.element);
        const inputs = control.element.querySelectorAll<HTMLInputElement>(
            '[data-ui="choice-input"]'
        );
        const focusedInput = inputs[1]!;
        focusedInput.focus();
        model.setOptions([
            { value: 'b', label: 'Bee updated' },
            { value: 'a', label: 'Aye' },
        ]);
        assert.equal(part(control.element, 'choice-input'), focusedInput);
        assert.equal(document.activeElement, focusedInput);
        const focusedRemove = part<HTMLButtonElement>(
            control.element,
            'remove'
        );
        focusedRemove.focus();
        model.setValue(['b', 'a']);
        assert.equal(document.activeElement, focusedRemove);
        assert.equal(
            control.element.querySelectorAll('[data-ui="remove"]')[1],
            focusedRemove
        );
    });

    it('does not restore old rows after a focus callback replaces the scope', (test) => {
        const { document } = environment(test);
        const model = createSelectionModel({
            multiple: true,
            options: [
                { value: 'a', label: 'Old A' },
                { value: 'b', label: 'Old B' },
            ],
            value: ['a', 'b'],
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
        });
        test.after(() => control.destroy());
        document.body.append(control.element);
        const inputB = control.element.querySelectorAll<HTMLInputElement>(
            '[data-ui="choice-input"]'
        )[1]!;
        inputB.focus();
        inputB.addEventListener(
            'focus',
            () =>
                model.reset({
                    options: [{ value: 'new', label: 'Fresh scope' }],
                    value: ['new'],
                }),
            { once: true }
        );
        model.setOptions([
            { value: 'b', label: 'Old B reordered' },
            { value: 'a', label: 'Old A' },
        ]);
        assert.equal(control.element.textContent?.includes('Old'), false);
        assert.equal(
            part<HTMLInputElement>(control.element, 'choice-input').value,
            'new'
        );
        assert.equal(
            part(control.element, 'selected-text').textContent,
            'Fresh scope'
        );
    });

    it('blocks selection in read-only mode, permits browsing, and disables every action when disabled', async (test) => {
        const { document, dispatch } = environment(test);
        let loads = 0;
        const changes: string[][] = [];
        const model = createSelectionModel({
            value: ['a'],
            selectedOptions: [{ value: 'a', label: 'Aye' }],
            readOnly: true,
            loadOptions: async () => {
                loads++;
                return {
                    options: [
                        { value: 'a', label: 'Aye' },
                        { value: 'b', label: 'Bee' },
                    ],
                    offset: 'next',
                };
            },
            onChange: (value) => changes.push([...value]),
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
        });
        test.after(() => control.destroy());
        await model.reload();
        const choice = Array.from(
            control.element.querySelectorAll<HTMLInputElement>(
                '[data-ui="choice-input"]'
            )
        ).find((input) => input.value === 'b')!;
        assert.equal(choice.disabled, true);
        choice.checked = true;
        dispatch(choice, 'change');
        part<HTMLButtonElement>(control.element, 'clear').click();
        part<HTMLButtonElement>(control.element, 'remove').click();
        assert.deepEqual(model.getState().value, ['a']);
        assert.deepEqual(changes, []);
        const search = part<HTMLInputElement>(control.element, 'search');
        assert.equal(search.disabled, false);
        search.value = 'Bee';
        dispatch(search, 'input');
        await model.loadMore();
        assert.equal(loads, 2);
        model.setDisabled(true);
        assert.equal(search.disabled, true);
        assert.equal(
            part<HTMLButtonElement>(control.element, 'more').disabled,
            true
        );
        search.value = 'blocked';
        dispatch(search, 'input');
        dispatch(part(control.element, 'more'), 'click');
        await Promise.resolve();
        assert.equal(loads, 2);
        model.setDisabled(false);
        model.setReadOnly(false);
        model.setValue(['b']);
        assert.equal(
            part<HTMLButtonElement>(control.element, 'clear').disabled,
            false
        );
        assert.deepEqual(changes, []);
    });

    it('rejects old-scope DOM choices and clears retained labels until explicit reset', (test) => {
        const { document, dispatch } = environment(test);
        let currentScope = true;
        let loads = 0;
        const loadOptions: SelectionLoader = async () => {
            loads++;
            return { options: [], offset: null };
        };
        loadOptions.isCurrent = () => currentScope;
        const changes: string[][] = [];
        const model = createSelectionModel({
            options: [{ value: 'old', label: 'Previous visitor record' }],
            value: ['old'],
            loadOptions,
            onChange: (value) => changes.push([...value]),
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
        });
        test.after(() => control.destroy());
        const oldRadio = part<HTMLInputElement>(
            control.element,
            'choice-input'
        );
        currentScope = false;
        oldRadio.checked = true;
        dispatch(oldRadio, 'change');
        assert.deepEqual(model.getState().value, []);
        assert.equal(changes.length, 0);
        assert.equal(
            control.element.textContent?.includes('Previous visitor record'),
            false
        );
        dispatch(part(control.element, 'retry'), 'click');
        assert.equal(loads, 0);
        model.reset({
            options: [{ value: 'new', label: 'Current visitor record' }],
            onChange: (value) => changes.push([...value]),
        });
        const newRadio = part<HTMLInputElement>(
            control.element,
            'choice-input'
        );
        newRadio.checked = true;
        dispatch(newRadio, 'change');
        assert.deepEqual(changes, [['new']]);
    });

    it('unsubscribes and removes handlers without disposing the shared model', (test) => {
        const { document, dispatch } = environment(test);
        const model = createSelectionModel({
            options: [{ value: 'a', label: 'Aye' }],
            value: ['a'],
        });
        test.after(() => model.destroy());
        const control = mountSelectionControl(model, {
            label: 'Records',
            document,
        });
        const radio = part<HTMLInputElement>(control.element, 'choice-input');
        const text = control.element.textContent;
        control.destroy();
        control.destroy();
        model.setOptions([{ value: 'b', label: 'Bee' }]);
        model.setValue(['b']);
        assert.deepEqual(model.getState().value, ['b']);
        assert.equal(control.element.textContent, text);
        radio.checked = true;
        dispatch(radio, 'change');
        dispatch(part(control.element, 'clear'), 'click');
        dispatch(part(control.element, 'remove'), 'click');
        assert.deepEqual(model.getState().value, ['b']);
        assert.throws(
            () => mountSelectionControl(model, { label: 'Needs document' }),
            /Document is required/
        );
    });
});
