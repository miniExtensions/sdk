import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    getFieldPresentationPolicy,
    primaryFieldPresentationPolicy,
    presentPublicLabel,
    safeLinkedRecordLabel,
    presentPortalCellSummary,
} from '../examples/browser/src/presentation.js';
import {
    createLinkedReviewPresentation,
    unavailableLinkedAnswer,
} from '../examples/browser/src/linkedReview.js';
import { selectionOptionsFromRecords } from '../src/ui/loaders.js';
import {
    AirtableFieldType,
    type AirtableRecord,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';

const detail = {
    fieldId: 'fld_primary_synthetic',
    isHidden: false,
    miniExtConfig: {},
};
const primary = {
    ...loadedForm().payload.fieldIdsToSchemas.fld_title.airtableField,
    id: detail.fieldId,
    name: 'Synthetic primary',
    isPrimaryField: true,
};
const table = { airtableFields: [primary], recordIdsToAirtableRecords: {} };
const nativeRecord = (value = 'Visible target'): AirtableRecord => ({
    id: 'rec_synthetic_native',
    fields: { [primary.id]: value },
});
it('checks Portal summary policy before reading native cells and again after formatting', () => {
    for (const type of ['masked', 'hidden', 'unavailable'] as const) {
        let reads = 0;
        const record = nativeRecord();
        Object.defineProperty(record.fields, primary.id, {
            enumerable: true,
            get() {
                reads++;
                return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
            },
        });
        assert.equal(
            presentPortalCellSummary(
                () => ({ type }),
                () => String(record.fields[primary.id])
            ),
            type === 'masked' ? '••••••••' : 'Value unavailable'
        );
        assert.equal(reads, 0);
    }
    let current = true;
    let reads = 0;
    assert.equal(
        presentPortalCellSummary(
            () => ({ type: current ? 'visible' : 'unavailable' }),
            () => {
                reads++;
                current = false;
                return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
            }
        ),
        'Value unavailable'
    );
    assert.equal(reads, 1);
    assert.equal(
        presentPortalCellSummary(
            () => ({ type: 'visible' }),
            () => 'Permitted summary'
        ),
        'Permitted summary'
    );
});
it('honors both accepted password mask settings before reading or formatting captions', () => {
    for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
        for (const value of [true, 'false', null, 0, {}]) {
            const policy = primaryFieldPresentationPolicy({
                fieldId: primary.id,
                detailFields: [{ ...detail, miniExtConfig: { [flag]: value } }],
                isCurrent: true,
            });
            const expected = value === true ? 'masked' : 'unavailable';
            assert.equal(policy.type, expected, flag);
            let reads = 0;
            let formatted = 0;
            const record = nativeRecord();
            Object.defineProperty(record.fields, primary.id, {
                enumerable: true,
                get() {
                    reads++;
                    return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
                },
            });
            assert.equal(
                safeLinkedRecordLabel({
                    record,
                    table,
                    detailFields: [
                        { ...detail, miniExtConfig: { [flag]: value } },
                    ],
                    isCurrent: () => true,
                    formatValue: () => {
                        formatted++;
                        return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
                    },
                }),
                expected === 'masked' ? '••••' : 'Linked record'
            );
            assert.equal(reads, 0, flag);
            assert.equal(formatted, 0, flag);
        }
        for (const value of [false, undefined])
            assert.equal(
                safeLinkedRecordLabel({
                    record: nativeRecord(),
                    table,
                    detailFields: [
                        { ...detail, miniExtConfig: { [flag]: value } },
                    ],
                    isCurrent: () => true,
                }),
                'Visible target'
            );
    }
});
it('withholds active or malformed rich caption values and preserves masking priority', () => {
    for (const flag of [
        'displayAsButton',
        'displayAsAttachments',
        'renderFormulaAsHTML',
        'renderFormulaAsAttachment',
    ]) {
        for (const value of [true, 'false', null, {}, 0]) {
            let reads = 0;
            let formatted = 0;
            const record = nativeRecord();
            Object.defineProperty(record.fields, primary.id, {
                enumerable: true,
                get() {
                    reads++;
                    return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
                },
            });
            for (const masked of [false, true]) {
                assert.equal(
                    safeLinkedRecordLabel({
                        record,
                        table,
                        detailFields: [
                            {
                                ...detail,
                                miniExtConfig: {
                                    [flag]: value,
                                    obscurePassword: masked,
                                },
                            },
                        ],
                        isCurrent: () => true,
                        formatValue: () => {
                            formatted++;
                            return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
                        },
                    }),
                    masked ? '••••' : 'Linked record'
                );
                assert.equal(reads, 0, flag);
                assert.equal(formatted, 0, flag);
                assert.equal(record.id, 'rec_synthetic_native');
            }
        }
        for (const value of [undefined, false])
            assert.equal(
                safeLinkedRecordLabel({
                    record: nativeRecord(),
                    table,
                    detailFields: [
                        { ...detail, miniExtConfig: { [flag]: value } },
                    ],
                    isCurrent: () => true,
                }),
                'Visible target'
            );
    }
});
it('uses the existing SDK custom formatter without reading hidden or masked native cells', () => {
    for (const mode of [
        'hidden',
        'masked',
        'visible',
        'missing',
        'blank',
    ] as const) {
        const record = nativeRecord();
        let valuesRead = 0;
        let formatted = 0;
        Object.defineProperty(record.fields, primary.id, {
            enumerable: true,
            get() {
                valuesRead++;
                return mode === 'blank'
                    ? ''
                    : mode === 'visible'
                      ? 'Visible target'
                      : 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
            },
        });
        const projection =
            mode === 'missing'
                ? undefined
                : [
                      {
                          ...detail,
                          isHidden: mode === 'hidden',
                          miniExtConfig: { obscurePassword: mode === 'masked' },
                      },
                  ];
        assert.deepEqual(
            selectionOptionsFromRecords([record], table, (record, table) =>
                safeLinkedRecordLabel({
                    record,
                    table,
                    detailFields: projection,
                    isCurrent: () => true,
                    formatValue: (value) => {
                        formatted++;
                        return String(value);
                    },
                })
            ),
            [
                {
                    value: record.id,
                    label:
                        mode === 'masked'
                            ? '••••'
                            : mode === 'visible'
                              ? 'Visible target'
                              : 'Linked record',
                },
            ]
        );
        const visible = mode === 'visible' || mode === 'blank';
        assert.equal(valuesRead, visible ? 1 : 0);
        assert.equal(formatted, visible ? 1 : 0);
    }
});
it('rechecks currentness and explicit display policy after the private formatter', () => {
    for (const mode of ['hidden', 'masked', 'retired'] as const) {
        const record = nativeRecord('SYNTHETIC_SECRET_DO_NOT_DISPLAY');
        const projection = [
            { ...detail, miniExtConfig: { obscurePassword: false } },
        ];
        let current = true;
        let formatted = 0;
        const label = safeLinkedRecordLabel({
            record,
            table,
            detailFields: projection,
            isCurrent: () => current,
            formatValue: (value) => {
                formatted++;
                projection[0].isHidden = mode === 'hidden';
                projection[0].miniExtConfig.obscurePassword = mode === 'masked';
                current = mode !== 'retired';
                return String(value);
            },
        });
        assert.equal(label, mode === 'masked' ? '••••' : 'Linked record');
        assert.equal(formatted, 1);
        assert.equal(label.includes('SYNTHETIC_SECRET_DO_NOT_DISPLAY'), false);
        assert.equal(
            record.fields[primary.id],
            'SYNTHETIC_SECRET_DO_NOT_DISPLAY'
        );
    }
});
it('uses only an own unique primary name when the ID key is absent', () => {
    const record: AirtableRecord = {
        id: 'rec_synthetic_native',
        fields: { [primary.name]: 'Legacy name caption' },
    };
    const input = {
        record,
        table,
        detailFields: [detail],
        isCurrent: () => true,
    };
    assert.equal(safeLinkedRecordLabel(input), 'Legacy name caption');
    for (const idValue of [undefined, '', '   ']) {
        Object.defineProperty(record.fields, primary.id, {
            value: idValue,
            enumerable: true,
            configurable: true,
            writable: true,
        });
        assert.equal(safeLinkedRecordLabel(input), 'Linked record');
    }
    record.fields[primary.id] = 'ID caption';
    assert.equal(safeLinkedRecordLabel(input), 'ID caption');
    delete record.fields[primary.id];
    let nameReads = 0;
    Object.defineProperty(record.fields, primary.name, {
        enumerable: true,
        get() {
            nameReads++;
            return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
        },
    });
    for (const mode of [
        'hidden',
        'masked',
        'omitted',
        'ambiguous',
        'retired',
    ] as const) {
        const label = safeLinkedRecordLabel({
            ...input,
            table:
                mode === 'ambiguous'
                    ? {
                          airtableFields: [
                              primary,
                              {
                                  ...primary,
                                  id: 'fld_other',
                                  isPrimaryField: false,
                              },
                          ],
                      }
                    : table,
            detailFields:
                mode === 'omitted'
                    ? []
                    : [
                          {
                              ...detail,
                              isHidden: mode === 'hidden',
                              miniExtConfig: {
                                  obscurePassword: mode === 'masked',
                              },
                          },
                      ],
            isCurrent: () => mode !== 'retired',
        });
        assert.equal(label, mode === 'masked' ? '••••' : 'Linked record');
        assert.equal(nameReads, 0, mode);
    }
    record.fields = Object.create({ [primary.name]: 'Inherited secret' });
    assert.equal(safeLinkedRecordLabel(input), 'Linked record');
});
it('linked Review preserves native IDs, own-name precedence and retirement without subtitle authority', () => {
    const field = {
        id: 'fld_synthetic_links',
        name: 'Synthetic links',
        description: null,
        isPrimaryField: false,
        isComputed: false,
        config: {
            type: 'multipleRecordLinks' as const,
            options: {
                linkedTableId: 'tbl_synthetic_targets',
                inverseLinkFieldId: 'fld_synthetic_inverse',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    };
    const make = (withPrimary = true) => {
        const form = loadedForm();
        form.payload.fieldIdsInForm = [field.id];
        form.payload.fieldIdsToSchemas = {
            [field.id]: {
                fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                airtableField: field,
                miniExtConfig: {},
            },
        };
        form.payload.formRecord = {
            type: 'create',
            data: { [field.id]: ['rec_synthetic_native'] },
        };
        form.payload.linkedRecordFieldIdToDetailFields = {
            [field.id]: withPrimary
                ? [
                      {
                          ...detail,
                          fieldName: primary.name,
                          titleOverride: null,
                          fieldIsInEditingChildForm: false,
                          childFormField: null,
                      },
                  ]
                : [],
        };
        return {
            form,
            review: createLinkedReviewPresentation(form, () => true),
        };
    };
    for (const idValue of ['absent', undefined, '', 'ID caption'] as const) {
        const { form, review } = make();
        const record: AirtableRecord = {
            id: 'rec_synthetic_native',
            fields: { [primary.name]: 'Legacy name caption' },
        };
        if (idValue !== 'absent')
            Object.defineProperty(record.fields, primary.id, {
                value: idValue,
                enumerable: true,
            });
        review.acceptOptions(field.id, {
            records: [record],
            offset: null,
            tableIdsToLinkedTableStates: {
                [field.config.options.linkedTableId]: table,
            },
        });
        assert.equal(
            review.snapshot().label(field.id, record.id),
            idValue === 'absent'
                ? 'Legacy name caption'
                : idValue === 'ID caption'
                  ? idValue
                  : unavailableLinkedAnswer
        );
        assert.deepEqual(form.payload.formRecord.data[field.id], [record.id]);
        const retained = review.snapshot();
        review.retire();
        assert.equal(
            retained.label(field.id, record.id),
            unavailableLinkedAnswer
        );
    }
    const { review } = make(false);
    const record: AirtableRecord = {
        id: 'rec_synthetic_native',
        fields: { [primary.name]: 'SYNTHETIC_SECRET_DO_NOT_DISPLAY' },
    };
    review.acceptOptions(field.id, {
        records: [record],
        offset: null,
        tableIdsToLinkedTableStates: {
            [field.config.options.linkedTableId]: table,
        },
    });
    assert.equal(
        review.snapshot().label(field.id, record.id),
        unavailableLinkedAnswer
    );
    review.retire();
});
it('does not let linked Review cloning turn a custom display prototype into caption permission', () => {
    class CustomDisplayConfig {
        obscurePassword = false;
    }
    const config = new CustomDisplayConfig();
    assert.equal(
        Object.getPrototypeOf(structuredClone(config)),
        Object.prototype
    );
    const form = loadedForm();
    const field = {
        id: 'fld_synthetic_links',
        name: 'Synthetic links',
        description: null,
        isPrimaryField: false,
        isComputed: false,
        config: {
            type: 'multipleRecordLinks' as const,
            options: {
                linkedTableId: 'tbl_synthetic_targets',
                inverseLinkFieldId: 'fld_synthetic_inverse',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    };
    form.payload.fieldIdsInForm = [field.id];
    form.payload.fieldIdsToSchemas = {
        [field.id]: {
            fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
            airtableField: field,
            miniExtConfig: {},
        },
    };
    const record = nativeRecord('SYNTHETIC_SECRET_DO_NOT_DISPLAY');
    form.payload.formRecord = {
        type: 'create',
        data: { [field.id]: [record.id] },
    };
    form.payload.linkedRecordFieldIdToDetailFields = {
        [field.id]: [
            {
                ...detail,
                fieldName: primary.name,
                titleOverride: null,
                fieldIsInEditingChildForm: false,
                childFormField: null,
                miniExtConfig: config,
            },
        ],
    };
    const review = createLinkedReviewPresentation(form, () => true);
    review.acceptOptions(field.id, {
        records: [record],
        offset: null,
        tableIdsToLinkedTableStates: {
            [field.config.options.linkedTableId]: table,
        },
    });
    assert.equal(
        review.snapshot().label(field.id, record.id),
        unavailableLinkedAnswer
    );
    review.retire();
});
it('requires explicit matching display provenance before reading a label', () => {
    for (const detailFields of [
        undefined,
        null,
        [],
        [{ ...detail, fieldId: 'fld_other' }],
        [detail, detail],
        [{ ...detail, miniExtConfig: undefined }],
        [{ ...detail, miniExtConfig: { obscurePassword: 'false' } }],
        [{ ...detail, isHidden: 'false' }],
        [{ fieldId: detail.fieldId, miniExtConfig: {} }],
    ]) {
        const policy = primaryFieldPresentationPolicy({
            fieldId: detail.fieldId,
            detailFields,
            isCurrent: true,
        });
        assert.equal(policy.type, 'unavailable');
        let formatted = 0;
        assert.equal(
            presentPublicLabel(policy, () => {
                formatted++;
                return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
            }),
            'Linked record'
        );
        assert.equal(formatted, 0);
    }
});
it('hidden and masked primary captions never invoke native formatting', () => {
    for (const mode of ['hidden', 'masked'] as const) {
        const policy = primaryFieldPresentationPolicy({
            fieldId: detail.fieldId,
            detailFields: [
                {
                    ...detail,
                    isHidden: mode === 'hidden',
                    miniExtConfig: { obscurePassword: mode === 'masked' },
                },
            ],
            isCurrent: true,
        });
        assert.equal(policy.type, mode);
        let formatted = 0;
        assert.equal(
            presentPublicLabel(policy, () => {
                formatted++;
                return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
            }),
            mode === 'masked' ? '••••' : 'Linked record'
        );
        assert.equal(formatted, 0, mode);
    }
});
it('never evaluates changing disclosure accessors or caller-controlled projection traversal', () => {
    for (const failure of [
        'hidden-getter',
        'masked-getter',
        'index-getter',
        'filter-override',
        'hidden-nonenumerable',
        'masked-nonenumerable',
    ] as const) {
        const projection = [{ ...detail, miniExtConfig: {} }];
        let reads = 0;
        if (failure === 'hidden-getter')
            Object.defineProperty(projection[0], 'isHidden', {
                enumerable: true,
                get() {
                    return ++reads <= 2;
                },
            });
        if (failure === 'masked-getter')
            Object.defineProperty(
                projection[0].miniExtConfig,
                'obscurePassword',
                {
                    enumerable: true,
                    get() {
                        return ++reads <= 2;
                    },
                }
            );
        if (failure === 'index-getter')
            Object.defineProperty(projection, '0', {
                enumerable: true,
                get() {
                    reads++;
                    return {
                        ...detail,
                        isHidden: reads === 1,
                        miniExtConfig: {},
                    };
                },
            });
        if (failure === 'filter-override')
            Object.defineProperty(projection, 'filter', {
                value() {
                    reads++;
                    return [detail];
                },
            });
        if (failure === 'hidden-nonenumerable')
            Object.defineProperty(projection[0], 'isHidden', {
                value: true,
                enumerable: false,
            });
        if (failure === 'masked-nonenumerable')
            Object.defineProperty(
                projection[0].miniExtConfig,
                'obscurePassword',
                {
                    value: true,
                    enumerable: false,
                }
            );
        const policy = primaryFieldPresentationPolicy({
            fieldId: detail.fieldId,
            detailFields: projection,
            isCurrent: true,
        });
        assert.equal(policy.type, 'unavailable');
        assert.equal(reads, 0);
        let formatted = 0;
        assert.equal(
            presentPublicLabel(policy, () => {
                formatted++;
                return 'SYNTHETIC_SECRET_DO_NOT_DISPLAY';
            }),
            'Linked record'
        );
        assert.equal(formatted, 0, failure);
        assert.equal(reads, 0, failure);
    }
});
it('preserves visible labels and fails closed for retired or unreadable policy', () => {
    assert.equal(
        presentPublicLabel(
            primaryFieldPresentationPolicy({
                fieldId: detail.fieldId,
                detailFields: [detail],
                isCurrent: true,
            }),
            () => 'Visible primary'
        ),
        'Visible primary'
    );
    assert.equal(
        primaryFieldPresentationPolicy({
            fieldId: detail.fieldId,
            detailFields: [detail],
            isCurrent: false,
        }).type,
        'unavailable'
    );
    assert.equal(
        getFieldPresentationPolicy({
            fieldId: detail.fieldId,
            descriptor: {
                fieldId: detail.fieldId,
                get displayConfig() {
                    throw new Error('Synthetic unreadable policy');
                },
            },
            visible: true,
            isCurrent: true,
        }).type,
        'unavailable'
    );
    assert.equal(
        presentPublicLabel(undefined, () => 'Secret'),
        'Linked record'
    );
    assert.equal(
        presentPublicLabel({ type: 'visible' }, () => ''),
        'Linked record'
    );
    assert.equal(
        presentPublicLabel({ type: 'visible' }, () => {
            throw Error('Synthetic format failure');
        }),
        'Linked record'
    );
});
it('ignores inherited disclosure getters while reading only own accepted policy data', () => {
    const previous = Object.getOwnPropertyDescriptor(
        Object.prototype,
        'obscurePassword'
    );
    let reads = 0;
    Object.defineProperty(Object.prototype, 'obscurePassword', {
        configurable: true,
        get() {
            return ++reads <= 2;
        },
    });
    try {
        assert.equal(
            primaryFieldPresentationPolicy({
                fieldId: detail.fieldId,
                detailFields: [detail],
                isCurrent: true,
            }).type,
            'visible'
        );
        assert.equal(reads, 0);
    } finally {
        if (previous)
            Object.defineProperty(
                Object.prototype,
                'obscurePassword',
                previous
            );
        else Reflect.deleteProperty(Object.prototype, 'obscurePassword');
    }
});
