import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isNumberInputCompatible as checkIfValueIsValid,
    formatNumberInputCompatibility as getFormattedValue,
    parseNumberInputCompatibility as getValidNumber,
} from '../src/ui/index.js';

describe('native number input compatibility', () => {
    const config = { type: 'number', options: { precision: 2 } } as const;

    it('preserves lexical admission independently from permissive coercion', () => {
        for (const type of ['number', 'percent', 'currency'] as const) {
            for (const value of [
                '1e3',
                '.5',
                '-.5',
                '+1',
                ' 1',
                '1 ',
                '1,000',
                '1 000',
                '.',
                'Infinity',
            ]) {
                assert.equal(
                    checkIfValueIsValid(value, type, {
                        allowNegativeNumbers: true,
                    }),
                    false
                );
            }
            for (const value of ['', '-', '0.', '-0.', '001.50']) {
                assert.equal(
                    checkIfValueIsValid(value, type, {
                        allowNegativeNumbers: true,
                    }),
                    true
                );
            }
            assert.equal(checkIfValueIsValid('-', type, undefined), false);
            assert.equal(checkIfValueIsValid('-1', type, undefined), false);
            // Preserve parseFloat's negative-zero behavior, including comma fractions.
            assert.equal(checkIfValueIsValid('-0', type, undefined), true);
            assert.equal(checkIfValueIsValid('-0.1', type, undefined), false);
            assert.equal(
                checkIfValueIsValid('-0,1', type, {
                    numberSeparator: 'space-comma',
                }),
                true
            );
            assert.equal(
                checkIfValueIsValid('0,', type, {
                    numberSeparator: 'period-comma',
                }),
                true
            );
        }
        assert.equal(getValidNumber('1e3', config), 1000);
        assert.equal(getValidNumber('.5', config), 0.5);
        assert.equal(getValidNumber('12junk', config), 12);
        assert.equal(getValidNumber('-', config), null);
    });

    it('retains Intl versus toFixed rounding and grouping overrides', () => {
        assert.equal(getFormattedValue(1.005, config, 'comma-period'), '1.01');
        assert.equal(getFormattedValue(1.005, config, 'space-period'), '1.00');
        assert.equal(
            getFormattedValue(-1.005, config, 'period-comma'),
            '-1,01'
        );
        assert.equal(getFormattedValue(-1.005, config, 'space-comma'), '-1,00');
        assert.equal(getValidNumber('1.005', config), 1);
        assert.equal(getFormattedValue(1234.5, config, 'none'), '1234.50');
        assert.equal(
            getFormattedValue(1234.5, config, 'none', true),
            '1,234.50'
        );
        assert.equal(
            getFormattedValue(0, { ...config, options: { precision: 0 } }),
            '0'
        );
        assert.equal(getFormattedValue('', config), '');
        assert.equal(getFormattedValue('-', config), '');
    });

    it('keeps percent native conversion unrounded and preserves zero signs', () => {
        const percent = { type: 'percent', options: { precision: 0 } } as const;
        assert.equal(getValidNumber('12,34567', percent), 12.34567 / 100);
        assert.equal(Object.is(getValidNumber('-0', percent), -0), true);
        assert.equal(Object.is(getValidNumber('-0', config), 0), true);
        assert.equal(getValidNumber('9'.repeat(400), config), Infinity);
        assert.equal(getFormattedValue('not a number', config), 'NaN');
    });
});
