import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createLocalizedNumericInputAdapter,
    isLocalizedNumericInputValid,
    type LocalizedNumericInputOwner,
} from '../src/ui/index.js';

for (const type of ['number', 'currency', 'percent'] as const) {
    it(`portable ${type} adapter applies native units and finite/negative policy before the raw scalar`, () => {
        const writes: (number | null)[] = [];
        const owner: LocalizedNumericInputOwner = {
            airtableField: {
                id: 'portable-number',
                config: { type, options: { precision: 2 } },
            },
            miniExtFieldConfig: {
                numberSeparator: 'period-comma',
                allowNegativeNumbers: false,
            },
            value: 0,
            setValue(value) {
                writes.push(value);
                owner.value = value;
            },
        };
        const adapter = createLocalizedNumericInputAdapter({
            read: () => owner,
            isCurrent: () => true,
        });
        for (const input of [
            '-0,5',
            '1e3',
            '1.234,56',
            '9'.repeat(400),
            '.',
            'NaN',
            'Infinity',
        ]) {
            assert.equal(isLocalizedNumericInputValid(input, owner), false);
            assert.equal(adapter.setInput(input), false);
        }
        assert.deepEqual(writes, []);
        assert.equal(adapter.setInput('42,755'), true);
        assert.deepEqual(writes, [type === 'percent' ? 42.755 / 100 : 42.76]);
        assert.equal(adapter.setInput('0,'), true);
        assert.equal(writes.at(-1), 0);
        assert.equal(adapter.setInput(''), true);
        assert.equal(writes.at(-1), null);
        owner.miniExtFieldConfig = {
            numberSeparator: 'period-comma',
            allowNegativeNumbers: true,
        };
        assert.equal(adapter.setInput('-'), true);
        assert.equal(writes.at(-1), null);
        assert.equal(adapter.setInput('-0,'), true);
        assert.ok(Object.is(writes.at(-1), type === 'percent' ? -0 : 0));
    });
}

it('portable adapter refuses unavailable, retired, readonly and explicitly refused native writes', () => {
    let calls = 0,
        current = true;
    const owner: LocalizedNumericInputOwner = {
        airtableField: {
            id: 'portable-number',
            config: { type: 'number', options: { precision: 2 } },
        },
        value: 0,
        setValue() {
            calls++;
            return false;
        },
    };
    let available: LocalizedNumericInputOwner | null = null;
    const adapter = createLocalizedNumericInputAdapter({
        read: () => available,
        isCurrent: () => current,
    });
    assert.equal(adapter.setInput('5'), false);
    assert.equal(calls, 0);
    available = owner;
    current = false;
    assert.equal(adapter.setInput('5'), false);
    assert.equal(calls, 0);
    current = true;
    owner.miniExtFieldConfig = { readOnly: true };
    assert.equal(adapter.setInput('5'), false);
    assert.equal(calls, 0);
    owner.miniExtFieldConfig = {};
    assert.equal(adapter.setInput('5'), false);
    assert.equal(calls, 1);
});
