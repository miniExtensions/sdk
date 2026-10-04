import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    FormulaRunner,
    getReadableStringFromAirtableValue,
} from '../src/formulas/index.js';
import {
    linkedField,
    makeContext,
    makeLinkedState,
    numberField,
    syntheticLinkedRecordId,
    textField,
} from './fixtures.js';

describe('deep review formula field ownership regressions', () => {
    for (const name of ['constructor', 'toString', '__proto__']) {
        it(`resolves an ID-keyed field named ${name} without reading its prototype`, () => {
            const field = { ...numberField, name };
            for (const reference of [field.name, field.id]) {
                const runner = new FormulaRunner(`{${reference}} + 1`);
                runner.context = makeContext({ [field.id]: 4 }, [field]);
                assert.equal(runner.run(), 5);
            }
        });
    }

    it('uses the linked-record fallback when a primary name is only inherited', () => {
        const primary = {
            ...textField,
            name: 'constructor',
            isPrimaryField: true,
        };
        const source = {
            type: 'airtableMock' as const,
            linkedTableStates: makeLinkedState(primary, {}),
        };
        assert.equal(
            getReadableStringFromAirtableValue({
                value: [syntheticLinkedRecordId],
                airtableFieldConfig: linkedField.config,
                source,
                fieldName: linkedField.name,
            }),
            syntheticLinkedRecordId
        );
    });
});
