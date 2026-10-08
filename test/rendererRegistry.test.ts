import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { UploadFileResult } from '../src/runtime/types.js';
import {
    createRendererProps,
    dispatchField,
    FIELD_RENDERER_SLOTS,
    isFieldReadValue,
    type RendererPropsInput,
} from '../src/ui/rendererRegistry.js';
const input = (): RendererPropsInput => ({
    physicalKind: 'singleLineText',
    fieldId: 'fld1',
    title: 'Title',
    field: {
        id: 'fld1',
        name: 'Title',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    displayConfig: undefined,
    value: '',
    context: 'form',
    computed: false,
    dirty: false,
    pending: false,
    validation: [],
    error: null,
    capability: { type: 'readonly' },
});
it('dispatches all 33 physical slots with explicit fallback', () => {
    assert.equal(Object.keys(FIELD_RENDERER_SLOTS).length, 33);
    const props = createRendererProps(input());
    assert.ok(props);
    assert.equal(
        dispatchField(
            { renderSingleLineTextField: (props) => props.value },
            props,
            () => 'missing'
        ),
        ''
    );
    assert.equal(
        dispatchField({}, props, (_, reason) => reason),
        'missing-renderer'
    );
});
it('detaches native data and preserves canonical empty values', () => {
    const source = input();
    const props = createRendererProps(source);
    assert.ok(props);
    props.field.name = 'Changed';
    assert.equal((source.field as { name: string }).name, 'Title');
    assert.equal(props.value, '');
    assert.equal(props.displayConfig, undefined);
    for (const value of [null, undefined, ''])
        assert.equal(isFieldReadValue('singleLineText', value), true);
    assert.equal(isFieldReadValue('checkbox', false), true);
    assert.equal(isFieldReadValue('number', 0), true);
});
it('rejects mismatched metadata, malformed containers and native shapes', () => {
    assert.equal(
        createRendererProps({ ...input(), physicalKind: 'number' }),
        null
    );
    assert.equal(createRendererProps({ ...input(), displayConfig: [] }), null);
    assert.equal(
        createRendererProps({ ...input(), value: { error: 'private' } }),
        null
    );
    assert.equal(isFieldReadValue('number', Infinity), false);
    assert.equal(isFieldReadValue('multipleRecordLinks', new Array(1)), false);
    assert.equal(isFieldReadValue('aiText', 'generated text'), false);
    assert.equal(
        isFieldReadValue('aiText', {
            state: 'generated',
            value: 'text',
            isStale: false,
        }),
        true
    );
    assert.equal(
        isFieldReadValue('multipleAttachments', [
            { url: 'https://example.test', size: Infinity },
        ]),
        false
    );
    assert.equal(
        isFieldReadValue('formula', [
            { error: 'error' },
            { specialValue: 'NaN' },
        ]),
        true
    );
});
it('keeps physical computed kinds separate from returned result presentation', () => {
    const props = createRendererProps({
        ...input(),
        physicalKind: 'formula',
        computed: true,
        value: 0,
        field: {
            id: 'fld1',
            name: 'Title',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'number', options: { precision: 0 } },
                },
            },
        },
    });
    assert.ok(props);
    assert.equal(props.physicalKind, 'formula');
    assert.equal(props.presentation.type, 'computed-result');
    assert.equal(props.presentation.config?.type, 'number');
    assert.equal(
        createRendererProps({
            ...input(),
            computed: true,
            capability: {
                type: 'editable',
                setValue: () => ({ accepted: true }),
            },
        }),
        null
    );
});

it('derives computed status without changing physical metadata', () => {
    const source: RendererPropsInput = {
        ...input(),
        physicalKind: 'formula',
        computed: false,
        value: 0,
        field: {
            id: 'fld1',
            name: 'Title',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'number', options: { precision: 0 } },
                },
            },
        },
    };
    const props = createRendererProps(source);
    assert.ok(props);
    assert.equal(props.computed, true);
    assert.equal(props.field.isComputed, false);
    assert.equal(props.capability.type, 'readonly');
    assert.equal(
        createRendererProps({
            ...source,
            capability: {
                type: 'editable',
                setValue: () => ({ accepted: true }),
            },
        }),
        null
    );
    const nativeComputed = {
        ...input(),
        field: { ...(input().field as object), isComputed: true },
    };
    assert.equal(createRendererProps(nativeComputed)?.computed, true);
    assert.equal(
        createRendererProps({
            ...nativeComputed,
            capability: {
                type: 'editable',
                setValue: () => ({ accepted: true }),
            },
        }),
        null
    );
});

// Compile-time consumers retain native value and physical-kind boundaries.
const typeProof = (
    props: import('../src/ui/rendererRegistry.js').FieldRendererPropsUnion
) => {
    if (
        props.physicalKind === 'number' &&
        props.capability.type === 'editable'
    ) {
        props.capability.setValue(1);
        // @ts-expect-error Numeric renderers cannot write strings.
        props.capability.setValue('1');
        // @ts-expect-error Native writes exclude undefined.
        props.capability.setValue(undefined);
        // @ts-expect-error Numeric renderers do not expose selection facades.
        props.capability.selection;
    }
    if (props.physicalKind === 'formula') {
        // @ts-expect-error Formula fields never expose native write actions.
        props.capability.setValue;
    }
    if (props.physicalKind === 'aiText') {
        const value = props.value;
        if (value) value.isStale;
    }
};
void typeProof;

it('admits canonical upload attachment IDs with precise optional metadata', () => {
    const uploaded: UploadFileResult = {
        id: null,
        url: 'https://example.test/file',
        filename: 'file.txt',
        size: 4,
        type: 'text/plain',
    };
    assert.equal(isFieldReadValue('multipleAttachments', [uploaded]), true);
    for (const id of [undefined, null, 'att1']) {
        assert.equal(
            isFieldReadValue('multipleAttachments', [{ ...uploaded, id }]),
            true
        );
    }
    assert.equal(
        isFieldReadValue('multipleAttachments', [{ ...uploaded, id: 1 }]),
        false
    );
    assert.equal(
        isFieldReadValue('multipleAttachments', [
            { ...uploaded, filename: null },
        ]),
        false
    );
    assert.equal(
        isFieldReadValue('multipleAttachments', [{ ...uploaded, type: null }]),
        false
    );
});

it('preserves native lookup errors when returned result metadata is invalid', () => {
    const source: RendererPropsInput = {
        ...input(),
        physicalKind: 'multipleLookupValues',
        computed: true,
        value: { error: '#REF!' },
        field: {
            id: 'fld1',
            name: 'Title',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: {
                type: 'multipleLookupValues',
                options: {
                    isValid: false,
                    recordLinkFieldId: 'fldLink',
                    fieldIdInLinkedTable: 'fldDeleted',
                    result: null,
                },
            },
        },
    };
    const props = createRendererProps(source);
    assert.ok(props);
    assert.equal(props.physicalKind, 'multipleLookupValues');
    assert.deepEqual(props.value, { error: '#REF!' });
    assert.deepEqual(props.presentation, {
        type: 'computed-result',
        config: null,
    });
    assert.equal(props.computed, true);
    assert.equal(props.capability.type, 'readonly');
    assert.equal(createRendererProps({ ...source, value: { error: 1 } }), null);
    assert.equal(
        createRendererProps({ ...source, value: { specialValue: 'NaN' } }),
        null
    );
    assert.equal(
        isFieldReadValue('multipleLookupValues', [{ error: '#REF!' }, null, 0]),
        true
    );
});
