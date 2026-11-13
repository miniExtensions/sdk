import assert from 'node:assert/strict';
import { it } from 'node:test';
import { projectPortalSummaryFields } from '../src/portals/index.js';

it('projects current names in first configured ID order and omits stale IDs', () => {
    const schema = Object.freeze({
        a: Object.freeze({
            airtableField: Object.freeze({ name: 'Renamed A' }),
        }),
        b: Object.freeze({ airtableField: Object.freeze({ name: 'B' }) }),
    });
    const ids = Object.freeze(['b', 'missing', 'a', 'b', 'a']);
    assert.deepEqual(
        projectPortalSummaryFields({
            summaryFieldIds: ids,
            fieldIdsToSchemas: schema,
        }),
        [
            { fieldId: 'b', fieldName: 'B' },
            { fieldId: 'a', fieldName: 'Renamed A' },
        ]
    );
    assert.deepEqual(ids, ['b', 'missing', 'a', 'b', 'a']);
    assert.deepEqual(
        projectPortalSummaryFields({
            summaryFieldIds: ['a'],
            fieldIdsToSchemas: { a: { airtableField: { name: 'New A' } } },
        }),
        [{ fieldId: 'a', fieldName: 'New A' }]
    );
});

it('omits absent configuration/schema without reading record values or prototypes', () => {
    for (const summaryFieldIds of [undefined, null, [], ['stale']]) {
        assert.deepEqual(
            projectPortalSummaryFields({
                summaryFieldIds,
                fieldIdsToSchemas: {},
            }),
            []
        );
    }
    const inherited = Object.create({
        inherited: { airtableField: { name: 'private' } },
    });
    assert.deepEqual(
        projectPortalSummaryFields({
            summaryFieldIds: ['deleted'],
            fieldIdsToSchemas: { deleted: undefined },
        }),
        []
    );
    assert.deepEqual(
        projectPortalSummaryFields({
            summaryFieldIds: ['inherited', 'toString', '__proto__'],
            fieldIdsToSchemas: inherited,
        }),
        []
    );
});
