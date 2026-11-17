import assert from 'node:assert/strict';
import { it } from 'node:test';
import { projectComputedLookup } from '../src/ui/computedProjection.js';
import type { LookupResultConfig } from '../src/ui/lookupProjection.js';
import type { FieldMetadata } from '../src/ui/rendererRegistry.js';

const text = { type: 'singleLineText', options: null } as const;
function field(
    result: LookupResultConfig = text,
    valid = true
): FieldMetadata<'multipleLookupValues'> {
    return {
        id: 'physical-lookup',
        name: 'Computed source',
        description: 'Original description',
        isPrimaryField: false,
        isComputed: true,
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

it('preserves physical identity and computed provenance while replacing only result config', () => {
    const source = Object.freeze(field());
    const config = Object.freeze({ displayAsButton: true, readOnly: false });
    const output = projectComputedLookup({
        field: source,
        value: ['A'],
        displayConfig: config,
    });
    assert.equal(output.status, 'ready');
    if (output.status !== 'ready') throw Error('ready');
    assert.equal(output.sourceField, source);
    assert.equal(output.resultField.config, text);
    assert.equal(output.resultConfig, text);
    assert.deepEqual(output.resultField, { ...source, config: text });
    assert.equal(output.resultField.isComputed, true);
    assert.equal(output.displayConfig, config);
    assert.equal(source.config.type, 'multipleLookupValues');
});

it('overlays readonly configuration without mutating the inherited configuration', () => {
    const config = Object.freeze({ readOnly: false, mask: 'inherited' });
    const output = projectComputedLookup({
        field: field(),
        value: ['A'],
        displayConfig: config,
        forceReadOnly: true,
    });
    assert.equal(output.status, 'ready');
    if (output.status !== 'ready') throw Error('ready');
    assert.notEqual(output.displayConfig, config);
    assert.deepEqual(output.displayConfig, {
        readOnly: true,
        mask: 'inherited',
    });
    assert.equal(config.readOnly, false);
});

it('retains original scalar indexes, duplicate references and explicit occurrence prefixes', () => {
    const value = Object.freeze({
        id: 'usrA',
        name: 'A',
        email: 'a@example.invalid',
    });
    const values = Object.freeze([value, null, value]);
    const output = projectComputedLookup({
        field: field({ type: 'singleCollaborator', options: { choices: [] } }),
        value: values,
        displayConfig: {},
        keyPrefix: 'parent:4/lookup',
    });
    assert.equal(output.status, 'ready');
    if (output.status !== 'ready') throw Error('ready');
    assert.deepEqual(
        output.occurrences.map(({ key, index }) => ({ key, index })),
        [
            { key: 'parent:4/lookup:0', index: 0 },
            { key: 'parent:4/lookup:2', index: 2 },
        ]
    );
    assert.equal(output.occurrences[0].value, value);
    assert.equal(output.occurrences[1].value, value);
});

for (const value of [
    undefined,
    null,
    Object.freeze([]),
    Object.freeze(['A', 'A']),
])
    it(`keeps a whole-array result as its original ${value == null ? String(value) : 'array'} value`, () => {
        const output = projectComputedLookup({
            field: field({ type: 'multipleSelects', options: { choices: [] } }),
            value,
            displayConfig: {},
        });
        assert.equal(output.status, 'ready');
        if (output.status !== 'ready') throw Error('ready');
        assert.equal(output.shape, 'whole-array');
        assert.equal(output.occurrences[0].value, value);
        assert.equal(output.occurrences[0].key, 'physical-lookup:0');
    });

it('masks before reading field, value, configuration, readonly policy or key getters', () => {
    const denied = () => {
        throw Error('concealed getter');
    };
    assert.deepEqual(
        projectComputedLookup({
            masked: true,
            get field() {
                return denied();
            },
            get value() {
                return denied();
            },
            get displayConfig(): object {
                return denied();
            },
            get forceReadOnly(): boolean {
                return denied();
            },
            get keyPrefix(): string {
                return denied();
            },
        }),
        { status: 'masked' }
    );
});

it('rejects malformed mask policy before any concealed input can be inspected', () => {
    for (const masked of [null, 'true', 1, {}]) {
        assert.deepEqual(
            projectComputedLookup({
                masked,
                get field() {
                    throw Error('concealed field');
                },
                get value() {
                    throw Error('concealed value');
                },
                get displayConfig() {
                    throw Error('concealed config');
                },
            } as never),
            { status: 'unavailable' }
        );
    }
});

it('fails closed when the mask getter throws, without inspecting other input', () => {
    assert.deepEqual(
        projectComputedLookup({
            get masked(): boolean {
                throw Error('unknown mask');
            },
            get field() {
                throw Error('concealed field');
            },
            get value() {
                throw Error('concealed value');
            },
            get displayConfig(): object {
                throw Error('concealed config');
            },
        }),
        { status: 'unavailable' }
    );
});

it('returns invalid metadata before values or presentation configuration are inspected', () => {
    assert.deepEqual(
        projectComputedLookup({
            field: field(text, false),
            get value() {
                throw Error('invalid value inspected');
            },
            get displayConfig(): object {
                throw Error('invalid configuration inspected');
            },
        }),
        { status: 'invalid-result' }
    );
});

it('keeps native error distinct and does not request presentation configuration', () => {
    assert.deepEqual(
        projectComputedLookup({
            field: field(),
            value: { error: '#ERROR!' },
            get displayConfig(): object {
                throw Error('error configuration inspected');
            },
        }),
        { status: 'native-error', message: '#ERROR!' }
    );
});

it('keeps outer empty separate from a ready answer whose scalar members are omitted', () => {
    const empty = projectComputedLookup({
        field: field(),
        value: [],
        displayConfig: {},
    });
    const omitted = projectComputedLookup({
        field: field(),
        value: [null, '', '  '],
        displayConfig: {},
    });
    assert.equal(empty.status, 'empty');
    assert.equal(omitted.status, 'ready');
    if (omitted.status !== 'ready') throw Error('ready');
    assert.deepEqual(omitted.occurrences, []);
});

it('retains the nested lookup descriptor and extends exact occurrence identity', () => {
    const nested = {
        type: 'multipleLookupValues',
        options: {
            isValid: true,
            recordLinkFieldId: 'nested-source',
            fieldIdInLinkedTable: 'nested-result',
            result: text,
        },
    } as const;
    const values = Object.freeze(['A', 'A']);
    const outer = projectComputedLookup({
        field: field(nested),
        value: values,
        displayConfig: {},
    });
    assert.equal(outer.status, 'ready');
    if (outer.status !== 'ready') throw Error('ready');
    const inner = projectComputedLookup({
        field: outer.resultField,
        value: outer.occurrences[0].value,
        displayConfig: outer.displayConfig,
        keyPrefix: outer.occurrences[0].key + '/lookup',
    });
    assert.equal(inner.status, 'ready');
    if (inner.status !== 'ready') throw Error('ready');
    assert.deepEqual(
        inner.occurrences.map((x) => x.key),
        ['physical-lookup:0/lookup:0', 'physical-lookup:0/lookup:1']
    );
    assert.equal(inner.resultField.id, outer.resultField.id);
    assert.equal(inner.resultField.isComputed, true);
});

it('fails closed for malformed display configuration, policy and key inputs', () => {
    for (const extra of [
        { displayConfig: null },
        { displayConfig: [] },
        { forceReadOnly: 'true' },
        {
            keyPrefix: {
                toString() {
                    throw Error('coercion');
                },
            },
        },
    ]) {
        assert.equal(
            projectComputedLookup({
                field: field(),
                value: ['A'],
                displayConfig: {},
                ...extra,
            } as never).status,
            'unavailable'
        );
    }
});

it('captures the source field and raw value once without granting resource or action ports', () => {
    let fieldReads = 0;
    let valueReads = 0;
    const source = field();
    const output = projectComputedLookup({
        get field() {
            fieldReads++;
            return source;
        },
        get value() {
            valueReads++;
            return ['A'];
        },
        displayConfig: {},
    });
    assert.equal(output.status, 'ready');
    assert.equal(fieldReads, 1);
    assert.equal(valueReads, 1);
    if (output.status !== 'ready') throw Error('ready');
    assert.deepEqual(Object.keys(output).sort(), [
        'displayConfig',
        'occurrences',
        'resultConfig',
        'resultField',
        'shape',
        'sourceField',
        'status',
    ]);
});
