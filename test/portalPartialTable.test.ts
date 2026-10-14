import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    mergePortalPartialFields,
    mergePortalPartialRecords,
    mergePortalPartialTableState,
    type PortalPartialRecords,
    type PortalPartialTableState,
} from '../src/portals/index.js';
import { mergePage } from '../src/portals/helpers.js';
import {
    AirtableFieldType,
    type AirtableValue,
    type RuntimeAirtableField,
} from '../src/runtime/index.js';
import { portalListPage } from './portalFixtures.js';

const title: RuntimeAirtableField = {
    id: 'fld_title',
    name: 'Title',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
};
const checkbox: RuntimeAirtableField = {
    ...title,
    id: 'fld_done',
    name: 'Done',
    isPrimaryField: false,
    config: {
        type: AirtableFieldType.CHECKBOX,
        options: { icon: 'check', color: 'greenBright' },
    },
};
const formula: RuntimeAirtableField = {
    ...title,
    id: 'fld_formula',
    name: 'Formula',
    isComputed: true,
    isPrimaryField: false,
    config: {
        type: AirtableFieldType.FORMULA,
        options: {
            isValid: true,
            result: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
        },
    },
};
const table = (
    airtableFields: RuntimeAirtableField[],
    recordIdsToAirtableRecords: PortalPartialRecords
): PortalPartialTableState => ({
    airtableFields,
    recordIdsToAirtableRecords,
});

describe('explicit hosted partial-table cache policy', () => {
    it('unions record IDs, overwrites incoming cells and retains native partial cells', () => {
        const previous = table([title, checkbox, formula], {
            rec_updated: {
                id: 'rec_updated',
                fields: {
                    fld_title: 'old title',
                    fld_done: true,
                    fld_formula: 'formula fetched earlier',
                    fld_links: ['rec_linked'],
                },
            },
            rec_unfetched: {
                id: 'rec_unfetched',
                fields: { fld_done: true, fld_title: 'not in this fetch' },
            },
        });
        const incoming = table([title, checkbox, formula], {
            rec_updated: {
                id: 'rec_updated',
                fields: { fld_title: 'new title' },
            },
            rec_new: {
                id: 'rec_new',
                fields: {
                    fld_title: 'new record',
                    fld_files: [
                        {
                            url: 'https://uploads.example.test/incoming.png',
                            filename: 'incoming.png',
                        },
                    ],
                },
            },
        });
        const before = structuredClone({ previous, incoming });
        const result = mergePortalPartialTableState(previous, incoming);

        assert.deepEqual(result.recordIdsToAirtableRecords, {
            rec_updated: {
                id: 'rec_updated',
                fields: {
                    fld_title: 'new title',
                    fld_formula: 'formula fetched earlier',
                    fld_links: ['rec_linked'],
                },
            },
            rec_unfetched: {
                id: 'rec_unfetched',
                fields: { fld_done: true, fld_title: 'not in this fetch' },
            },
            rec_new: {
                id: 'rec_new',
                fields: {
                    fld_title: 'new record',
                    fld_files: [
                        {
                            url: 'https://uploads.example.test/incoming.png',
                            filename: 'incoming.png',
                        },
                    ],
                },
            },
        });
        assert.deepEqual({ previous, incoming }, before);
        assert.equal(
            result.recordIdsToAirtableRecords.rec_updated.fields.fld_links,
            previous.recordIdsToAirtableRecords.rec_updated.fields.fld_links
        );
        assert.equal(
            result.recordIdsToAirtableRecords.rec_new.fields.fld_files,
            incoming.recordIdsToAirtableRecords.rec_new.fields.fld_files
        );
        assert.notEqual(result, previous);
        assert.notEqual(
            result.recordIdsToAirtableRecords.rec_updated.fields,
            previous.recordIdsToAirtableRecords.rec_updated.fields
        );
    });

    it('clears only fetched earlier booleans on absent, null or undefined cells', () => {
        const previous: PortalPartialRecords<AirtableValue | undefined> = {
            rec: {
                id: 'rec',
                fields: {
                    absent: true,
                    explicitNull: false,
                    explicitUndefined: true,
                    explicitFalse: true,
                    unfetched: true,
                    text: 'retained',
                    number: 0,
                    formula: ['retained formula'],
                    nullable: null,
                },
            },
        };
        const result = mergePortalPartialRecords<AirtableValue | undefined>(
            { recordIdsToAirtableRecords: previous },
            {
                fieldKeysIncludedInRecords: [
                    'absent',
                    'explicitNull',
                    'explicitUndefined',
                    'explicitFalse',
                    'text',
                    'number',
                    'formula',
                    'nullable',
                ],
                recordIdsToAirtableRecords: {
                    rec: {
                        id: 'rec',
                        fields: {
                            explicitNull: null,
                            explicitUndefined: undefined,
                            explicitFalse: false,
                        },
                    },
                },
            }
        );
        assert.deepEqual(result.rec.fields, {
            explicitFalse: false,
            unfetched: true,
            text: 'retained',
            number: 0,
            formula: ['retained formula'],
            nullable: null,
        });
    });

    it('preserves omitted checkboxes when fetched keys are unspecified', () => {
        const previous = { rec: { id: 'rec', fields: { fld_done: true } } };
        const result = mergePortalPartialRecords(
            { recordIdsToAirtableRecords: previous },
            { recordIdsToAirtableRecords: { rec: { id: 'rec', fields: {} } } }
        );
        assert.deepEqual(result, previous);
        assert.deepEqual(
            mergePortalPartialRecords(
                { recordIdsToAirtableRecords: {} },
                { recordIdsToAirtableRecords: {} }
            ),
            {}
        );
    });

    for (const key of ['fld_formula', 'Formula']) {
        it(`uses explicit null to replace a formula cell keyed by ${key}`, () => {
            const result = mergePortalPartialTableState(
                table([formula], {
                    rec: { id: 'rec', fields: { [key]: 'old formula' } },
                }),
                table([formula], {
                    rec: { id: 'rec', fields: { [key]: null } },
                })
            );
            assert.deepEqual(result.recordIdsToAirtableRecords.rec.fields, {
                [key]: null,
            });
        });
    }

    it('uses names when neither record map contains an incoming field ID', () => {
        const result = mergePortalPartialTableState(
            table([title, checkbox, formula], {
                rec: {
                    id: 'rec',
                    fields: {
                        Title: 'retained',
                        Done: true,
                        Formula: 'retained',
                    },
                },
            }),
            table([checkbox, formula], { rec: { id: 'rec', fields: {} } })
        );
        assert.deepEqual(result.recordIdsToAirtableRecords.rec.fields, {
            Title: 'retained',
            Formula: 'retained',
        });
    });

    it('detects ID mode from an incoming record as well as the earlier cache', () => {
        const result = mergePortalPartialTableState(
            table([checkbox], {
                rec: { id: 'rec', fields: { Done: true } },
            }),
            table([checkbox], {
                rec: { id: 'rec', fields: {} },
                rec_id_witness: {
                    id: 'rec_id_witness',
                    fields: { fld_done: false },
                },
            })
        );
        assert.deepEqual(result.recordIdsToAirtableRecords.rec.fields, {
            Done: true,
        });
        assert.deepEqual(
            result.recordIdsToAirtableRecords.rec_id_witness.fields,
            { fld_done: false }
        );
    });

    it('retains earlier metadata and appends every repeated new incoming ID', () => {
        const renamed = { ...title, name: 'Renamed Title' };
        const repeated = { ...checkbox, name: 'Repeated Done' };
        const previous = [title, title];
        const incoming = [renamed, checkbox, repeated];
        const result = mergePortalPartialFields(previous, incoming);
        assert.deepEqual(result, [title, title, checkbox, repeated]);
        assert.equal(result[0], title);
        assert.equal(result[3], repeated);
        assert.deepEqual(previous, [title, title]);
        assert.deepEqual(incoming, [renamed, checkbox, repeated]);
    });

    it('uses the last repeated incoming field name for fetched boolean clearing', () => {
        const renamed = { ...checkbox, name: 'Renamed Done' };
        const result = mergePortalPartialTableState(
            table([checkbox], {
                rec: {
                    id: 'rec',
                    fields: { Done: true, 'Renamed Done': true },
                },
            }),
            table([checkbox, renamed], { rec: { id: 'rec', fields: {} } })
        );
        assert.deepEqual(result.recordIdsToAirtableRecords.rec.fields, {
            Done: true,
        });
        assert.deepEqual(result.airtableFields, [checkbox]);
    });

    it('treats special record and cell keys as own data without inherited records', () => {
        const previous: PortalPartialRecords = {
            ['__proto__']: {
                id: 'earlier id is replaced by its map key',
                fields: { ['__proto__']: 'earlier', constructor: 'retained' },
            },
            constructor: { id: 'constructor', fields: { fld_done: true } },
        };
        const incoming: PortalPartialRecords = {
            ['__proto__']: {
                id: '__proto__',
                fields: { ['__proto__']: 'new value' },
            },
            toString: { id: 'toString', fields: { fld_title: 'own record' } },
        };
        Object.setPrototypeOf(incoming, {
            constructor: { id: 'inherited', fields: {} },
            inherited: { id: 'inherited', fields: {} },
        });
        const result = mergePortalPartialRecords(
            { recordIdsToAirtableRecords: previous },
            {
                recordIdsToAirtableRecords: incoming,
                fieldKeysIncludedInRecords: ['fld_done'],
            }
        );
        assert.deepEqual(Object.keys(result), [
            '__proto__',
            'constructor',
            'toString',
        ]);
        assert.equal(Object.getPrototypeOf(result), Object.prototype);
        assert.deepEqual(result['__proto__'], {
            id: '__proto__',
            fields: { ['__proto__']: 'new value', constructor: 'retained' },
        });
        assert.deepEqual(result.constructor, {
            id: 'constructor',
            fields: { fld_done: true },
        });
        assert.deepEqual(result.toString, {
            id: 'toString',
            fields: { fld_title: 'own record' },
        });
    });

    it('accepts special incoming field IDs without changing object prototypes', () => {
        const special = {
            ...checkbox,
            id: '__proto__',
            name: 'Special checkbox',
        };
        const result = mergePortalPartialTableState(
            table([special], {
                rec: {
                    id: 'rec',
                    fields: { ['__proto__']: true, 'Special checkbox': true },
                },
            }),
            table([special], { rec: { id: 'rec', fields: {} } })
        );
        assert.deepEqual(result.recordIdsToAirtableRecords.rec.fields, {
            'Special checkbox': true,
        });
        assert.equal(
            Object.getPrototypeOf(result.recordIdsToAirtableRecords.rec.fields),
            Object.prototype
        );
    });

    it('does not treat inherited incoming cell values as fetched cells', () => {
        const incomingFields = {};
        Object.setPrototypeOf(incomingFields, { fld_done: true });
        const result = mergePortalPartialRecords(
            {
                recordIdsToAirtableRecords: {
                    rec: { id: 'rec', fields: { fld_done: true } },
                },
            },
            {
                fieldKeysIncludedInRecords: ['fld_done'],
                recordIdsToAirtableRecords: {
                    rec: { id: 'rec', fields: incomingFields },
                },
            }
        );
        assert.deepEqual(result.rec.fields, {});
    });

    it('leaves normal SDK Portal page merging as whole-record replacement', () => {
        const previous = portalListPage({
            recordIds: ['rec', 'rec_previous'],
            tableIdsToLinkedTableStates: {
                tbl: table([title, checkbox], {
                    rec: {
                        id: 'rec',
                        fields: { fld_title: 'old', fld_done: true },
                    },
                    rec_previous: {
                        id: 'rec_previous',
                        fields: { fld_title: 'kept' },
                    },
                }),
            },
        });
        const incoming = portalListPage({
            recordIds: ['rec', 'rec'],
            tableIdsToLinkedTableStates: {
                tbl: table([title], {
                    rec: { id: 'rec', fields: { fld_title: 'new' } },
                }),
            },
        });
        const result = mergePage(previous, incoming);
        assert.deepEqual(result.recordIds, ['rec', 'rec_previous']);
        assert.deepEqual(
            result.tableIdsToLinkedTableStates.tbl.airtableFields,
            [title]
        );
        assert.deepEqual(
            result.tableIdsToLinkedTableStates.tbl.recordIdsToAirtableRecords,
            {
                rec: { id: 'rec', fields: { fld_title: 'new' } },
                rec_previous: {
                    id: 'rec_previous',
                    fields: { fld_title: 'kept' },
                },
            }
        );
    });
});
