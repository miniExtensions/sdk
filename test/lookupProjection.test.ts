import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    projectLookupValues,
    type LookupResultConfig,
} from '../src/ui/lookupProjection.js';
import type { FieldMetadata } from '../src/ui/rendererRegistry.js';

const text = { type: 'singleLineText', options: null } as const;
function field(
    result: LookupResultConfig = text,
    valid = true
): FieldMetadata<'multipleLookupValues'> {
    return {
        id: 'lookup',
        name: 'Lookup',
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config: {
            type: 'multipleLookupValues',
            options: valid
                ? {
                      isValid: true,
                      recordLinkFieldId: 'source',
                      fieldIdInLinkedTable: 'result',
                      result,
                  }
                : {
                      isValid: false,
                      recordLinkFieldId: 'source',
                      fieldIdInLinkedTable: 'result',
                      result: null,
                  },
        },
    };
}

it('keeps scalar occurrence order, duplicates, indexes and canonical references', () => {
    const ada = Object.freeze({
        id: 'usrAda',
        name: 'Ada',
        email: 'ada@example.invalid',
        profilePicUrl: 'https://example.invalid/avatar',
    });
    const values = Object.freeze([ada, null, ada]);
    const metadata = field({
        type: 'singleCollaborator',
        options: { choices: [] },
    });
    const before = structuredClone(metadata);
    const output = projectLookupValues({ field: metadata, value: values });
    assert.equal(output.status, 'ready');
    if (output.status !== 'ready') throw Error('ready');
    assert.equal(output.shape, 'scalar-occurrences');
    assert.deepEqual(
        output.occurrences.map((item) => item.index),
        [0, 2]
    );
    assert.equal(output.occurrences[0].value, ada);
    assert.equal(output.occurrences[1].value, ada);
    assert.equal(output.resultConfig, metadata.config.options.result);
    assert.deepEqual(metadata, before);
    assert.deepEqual(values, [ada, null, ada]);
});

const wholeArrayCases: [LookupResultConfig, unknown[]][] = [
    [
        { type: 'multipleAttachments', options: { isReversed: false } },
        [{ filename: 'a.txt', url: 'https://example.invalid/a' }],
    ],
    [
        { type: 'multipleCollaborators', options: { choices: [] } },
        [{ id: 'usrAda', name: 'Ada', email: 'ada@example.invalid' }],
    ],
    [
        {
            type: 'multipleLookupValues',
            options: {
                isValid: true,
                recordLinkFieldId: 'nested-source',
                fieldIdInLinkedTable: 'nested-result',
                result: text,
            },
        },
        ['A', 'A'],
    ],
    [
        {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: 'target',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
        ['rec12345678901234', 'rec12345678901234'],
    ],
    [{ type: 'multipleSelects', options: { choices: [] } }, ['A', 'A']],
];
for (const [result, values] of wholeArrayCases)
    it(`delegates the original whole ${result.type} array, without flattening`, () => {
        Object.freeze(values);
        const output = projectLookupValues({
            field: field(result),
            value: values,
        });
        assert.equal(output.status, 'ready');
        if (output.status !== 'ready') throw Error('ready');
        assert.equal(output.shape, 'whole-array');
        assert.equal(output.occurrences.length, 1);
        assert.equal(output.occurrences[0].value, values);
        assert.equal(output.occurrences[0].index, 0);
    });

it('distinguishes scalar empty answers from all-empty member occurrences', () => {
    for (const value of [undefined, null, []])
        assert.equal(
            projectLookupValues({ field: field(), value }).status,
            'empty'
        );
    const output = projectLookupValues({
        field: field(),
        value: [null, '', '   '],
    });
    assert.equal(output.status, 'ready');
    if (output.status !== 'ready') throw Error('ready');
    assert.deepEqual(output.occurrences, []);
    for (const value of [undefined, null, []]) {
        const array = projectLookupValues({
            field: field({ type: 'multipleSelects', options: { choices: [] } }),
            value,
        });
        assert.equal(array.status, 'ready');
        if (array.status !== 'ready') throw Error('ready');
        assert.equal(array.occurrences[0].value, value);
    }
});

it('preserves native zero, checkbox, rating, barcode and button omission rules', () => {
    const cases: [LookupResultConfig, unknown[], number[]][] = [
        [{ type: 'number', options: { precision: 0 } }, [null, 0, 2], [1, 2]],
        [
            {
                type: 'checkbox',
                options: { icon: 'check', color: 'greenBright' },
            },
            [false, true],
            [1],
        ],
        [
            {
                type: 'rating',
                options: { max: 5, icon: 'star', color: 'yellowBright' },
            },
            [0, 1],
            [1],
        ],
        [
            { type: 'barcode', options: null },
            [
                { text: '  ', type: 'qr' },
                { text: 'value', type: 'qr' },
            ],
            [1],
        ],
        [
            { type: 'button', options: null },
            [
                { url: '', label: 'Empty' },
                { url: 'https://example.invalid', label: 'Go' },
            ],
            [1],
        ],
    ];
    for (const [result, value, indexes] of cases) {
        const output = projectLookupValues({ field: field(result), value });
        assert.equal(output.status, 'ready');
        if (output.status !== 'ready') throw Error('ready');
        assert.deepEqual(
            output.occurrences.map((entry) => entry.index),
            indexes
        );
    }
});

it('fails closed for malformed metadata and hostile nonflat wire shapes', () => {
    const sparse: unknown[] = [];
    sparse[1] = 1;
    for (const value of [
        1,
        'scalar',
        [[1]],
        sparse,
        [{ linkedRecordId: 'r', value: 1 }],
    ])
        assert.equal(
            projectLookupValues({ field: field(), value }).status,
            'unavailable'
        );
    for (const corrupt of [
        (value: FieldMetadata<'multipleLookupValues'>) =>
            Reflect.deleteProperty(value.config.options, 'result'),
        (value: FieldMetadata<'multipleLookupValues'>) =>
            Reflect.set(value.config.options, 'isValid', 'true'),
    ]) {
        const metadata = field();
        corrupt(metadata);
        assert.equal(
            projectLookupValues({ field: metadata, value: ['stale'] }).status,
            'unavailable'
        );
    }
});

it('preserves invalid-result precedence and native error text without stale values', () => {
    let inspected = 0;
    assert.deepEqual(
        projectLookupValues({
            field: field(text, false),
            get value() {
                inspected++;
                throw Error('Invalid metadata must not inspect stale data');
            },
        }),
        { status: 'invalid-result' }
    );
    assert.equal(inspected, 0);
    assert.deepEqual(
        projectLookupValues({ field: field(text, false), value: ['stale'] }),
        { status: 'invalid-result' }
    );
    assert.deepEqual(
        projectLookupValues({
            field: field(text, false),
            value: { error: '#REF!' },
        }),
        { status: 'invalid-result' }
    );
    assert.deepEqual(
        projectLookupValues({ field: field(), value: { error: '#REF!' } }),
        { status: 'native-error', message: '#REF!' }
    );
});

it('conceals before metadata/raw-value inspection and captures a value getter once', () => {
    let inspections = 0;
    assert.deepEqual(
        projectLookupValues({
            masked: true,
            get field() {
                inspections++;
                throw Error('private metadata');
            },
            get value() {
                inspections++;
                throw Error('private value');
            },
        }),
        { status: 'masked' }
    );
    assert.equal(inspections, 0);
    const values = ['once'];
    const output = projectLookupValues({
        field: field(),
        get value() {
            inspections++;
            return values;
        },
    });
    assert.equal(output.status, 'ready');
    assert.equal(inspections, 1);
});
