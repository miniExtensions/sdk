import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    reconcileLinkedChildCreate,
    reconcileLinkedChildEdit,
} from '../src/forms/linkedChildPolicy.js';
import { childForm, parentForm } from './formLinkedChildFixtures.js';

describe('accepted child Save with a nonpublic inverse', () => {
    for (const mode of ['create', 'edit'] as const)
        it(`${mode} retains only an entirely omitted inverse, refusing partial or contradictory projections`, () => {
            for (const mutation of [
                'none',
                'configured-missing-value',
                'inherited-schema',
                'schema-alias',
                'name-only',
                'form-only',
                'returned-without-schema',
                'inherited-value',
                'reciprocal-alias',
            ] as const) {
                const parent = parentForm('edit');
                const child = childForm('edit');
                const inverse = child.payload.fieldIdsToSchemas.fld_parent_a!;
                delete child.payload.fieldIdsToSchemas.fld_parent_a;
                delete child.payload.fieldNamesToSchemas.fld_parent_a;
                child.payload.fieldIdsInForm = ['fld_title', 'fld_parent_b'];
                delete child.payload.formRecord.data.fld_parent_a;
                if (mode === 'edit')
                    child.payload.formRecord = {
                        type: 'edit',
                        recordId: 'rec_existing',
                        tableId: 'tbl_child',
                        data: child.payload.formRecord.data,
                    };
                const fields: Record<string, string[]> = {};
                if (mutation === 'configured-missing-value')
                    child.payload.fieldIdsToSchemas.fld_parent_a = inverse;
                if (mutation === 'inherited-schema')
                    Object.setPrototypeOf(child.payload.fieldIdsToSchemas, {
                        fld_parent_a: inverse,
                    });
                if (mutation === 'schema-alias')
                    child.payload.fieldIdsToSchemas.fld_alias = inverse;
                if (mutation === 'name-only')
                    child.payload.fieldNamesToSchemas.fld_parent_a = inverse;
                if (mutation === 'form-only')
                    child.payload.fieldIdsInForm.push('fld_parent_a');
                if (mutation === 'returned-without-schema')
                    fields.fld_parent_a = ['rec_parent'];
                if (mutation === 'inherited-value')
                    Object.setPrototypeOf(fields, {
                        fld_parent_a: ['rec_parent'],
                    });
                if (mutation === 'reciprocal-alias') {
                    inverse.airtableField.id = 'fld_other_inverse';
                    child.payload.fieldIdsToSchemas.fld_other_inverse = inverse;
                }
                const data = {
                    fld_children_a: [
                        'rec_existing',
                        'rec_existing',
                        'rec_sibling',
                    ],
                };
                const result = (
                    mode === 'create'
                        ? reconcileLinkedChildCreate
                        : reconcileLinkedChildEdit
                )({
                    parent,
                    child,
                    fieldId: 'fld_children_a',
                    data,
                    savedRecord: {
                        id: mode === 'create' ? 'rec_new' : 'rec_existing',
                        fields,
                    },
                    recordId: 'rec_existing',
                    maximum: null,
                    selectedCount: data.fld_children_a.length,
                });
                assert.deepEqual(
                    result,
                    mutation === 'none'
                        ? {
                              type: 'available',
                              nativeIds:
                                  mode === 'create'
                                      ? [...data.fld_children_a, 'rec_new']
                                      : data.fld_children_a,
                              changed: mode === 'create',
                              exemptCreatedRecord: mode === 'create',
                          }
                        : {
                              type: 'unavailable',
                              reason: 'unavailable-inverse',
                          },
                    mutation
                );
                assert.deepEqual(data.fld_children_a, [
                    'rec_existing',
                    'rec_existing',
                    'rec_sibling',
                ]);
            }
        });
});
