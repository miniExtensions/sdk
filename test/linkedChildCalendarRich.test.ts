import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFormLinkedRecordsOwner } from '../src/forms/linkedRecords.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type { RuntimeAirtableField } from '../src/runtime/types.js';
import { parentForm } from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

const dateField = (id: string): RuntimeAirtableField => ({
    id,
    name: id,
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'dateTime',
        options: {
            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
            timeFormat: { name: '24hour', format: 'HH:mm' },
            timeZone: 'utc',
        },
    },
});
const detail = (fieldId: string, isHidden = false) => ({
    fieldId,
    fieldName: fieldId,
    titleOverride: null,
    miniExtConfig: {},
    isHidden,
    fieldIsInEditingChildForm: false,
    childFormField: null,
});

for (const mode of ['created', 'edited'] as const) {
    for (const variant of [
        'visible',
        'hidden',
        'omitted',
        'undefined',
        'mismatch',
    ] as const) {
        it(`calendar ${mode} presentation ${variant} preserves owner and projection boundaries`, async () => {
            const loaded = parentForm('edit');
            const id = 'fld_children_a';
            loaded.payload.fieldIdsToSchemas[id].miniExtConfig = {
                recordFinderMode: 'calendar',
                calendarModeStartDate: 'fld_start',
                calendarModeEndDate: 'fld_end',
            };
            loaded.payload.linkedRecordFieldIdToDetailFields[id] = [
                detail('fld_title'),
                detail('fld_start', variant === 'hidden'),
            ];
            const title =
                loaded.payload.fieldIdsToSchemas.fld_title.airtableField;
            const start = dateField('fld_start');
            const end = dateField('fld_end');
            const table = { airtableFields: [title, start, end] };
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    throw Error('Unexpected transport');
                },
            });
            client.linkedRecords.loadSelectedRecords = async () => ({
                tbl_child: {
                    ...table,
                    recordIdsToAirtableRecords: {
                        rec_existing: {
                            id: 'rec_existing',
                            fields: {
                                fld_title: 'Original',
                                fld_start: '2027-01-02T00:00:00Z',
                            },
                        },
                    },
                },
            });
            const fields = createFormFieldBindings({
                loaded,
                client,
                saveOptions: formSaveOptions(),
                getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
            });
            let current = true;
            const owner = createFormLinkedRecordsOwner({
                client,
                loaded,
                originalRecordData: loaded.payload.formRecord.data,
                field: (fieldId) => fields.field(fieldId),
                isCurrent: () => current,
            });
            try {
                const facet = owner.field(id);
                await facet.readSelected();
                const target =
                    mode === 'created' ? 'rec_created' : 'rec_existing';
                fields.controller.write(id, [target, target]);
                const native = structuredClone(
                    fields.controller.getState().draft?.data
                );
                const record = {
                    id: target,
                    fields: {
                        fld_title: 'Child title',
                        ...(variant === 'omitted'
                            ? {}
                            : { fld_start: '2027-01-01T00:00:00Z' }),
                        fld_private: 'MUST_NOT_LEAK',
                    },
                };
                if (variant === 'undefined')
                    Object.defineProperty(record.fields, 'fld_start', {
                        value: undefined,
                        enumerable: true,
                    });
                const childTable =
                    variant === 'mismatch'
                        ? {
                              airtableFields: [
                                  title,
                                  start,
                                  { ...end, name: 'different' },
                              ],
                          }
                        : table;
                const install =
                    mode === 'created'
                        ? owner.prepareCreated(id, record, childTable)
                        : owner.prepareEdited(id, record, childTable);
                assert.ok(install);
                install();
                const snapshot = facet.getSnapshot();
                assert.deepEqual(
                    fields.controller.getState().draft?.data,
                    native
                );
                assert.equal(
                    JSON.stringify(snapshot).includes('MUST_NOT_LEAK'),
                    false
                );
                if (variant === 'visible') {
                    assert.equal(snapshot.selectedPolicy.state, 'applied');
                    assert.deepEqual(snapshot.unresolvedSelectedIds, []);
                    assert.deepEqual(
                        snapshot.selectedRecords.map((item) => item.fields),
                        [
                            {
                                fld_title: 'Child title',
                                fld_start: '2027-01-01T00:00:00Z',
                            },
                            {
                                fld_title: 'Child title',
                                fld_start: '2027-01-01T00:00:00Z',
                            },
                        ]
                    );
                } else {
                    assert.deepEqual(snapshot.selectedRecords, []);
                    assert.deepEqual(snapshot.unresolvedSelectedIds, [
                        target,
                        target,
                    ]);
                }
                current = false;
                assert.equal(facet.getSnapshot().phase, 'retired');
                assert.deepEqual(facet.getSnapshot().selectedRecords, []);
                assert.deepEqual(
                    fields.controller.getState().draft?.data,
                    native
                );
            } finally {
                owner.destroy();
                fields.destroy();
            }
        });
    }
}
