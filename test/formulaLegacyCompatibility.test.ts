import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import moment from 'moment';
import 'moment/locale/fr.js';
import {
    AIRTABLE_FORMULA_ERROR_VALUE,
    AirtableFieldType,
    FormulaRunner,
    Interpreter,
    Identifier,
    Lexer,
    Parser,
    type AirtableField,
    type AirtableValue,
    type FormulaInterpreterOptions,
} from '../src/formulas/index.js';
import { dateField, makeContext, numberField, textField } from './fixtures.js';

const legacyOptions = {
    legacyRuntime: true,
} satisfies FormulaInterpreterOptions;
const legacyRun = (source: string) =>
    new FormulaRunner(source, false, legacyOptions).run();
const divergenceCases: ReadonlyArray<readonly [string, string | number]> = [
    ['(1 / 0) + 1', Infinity],
    ['(1 / 0) - 1', Infinity],
    ['(1 / 0) * 2', Infinity],
    ['1 / (1 / 0)', 0],
    ['(1 / 0) = (1 / 0)', 1],
    ['(1 / 0) != 0', 1],
    ['(1 / 0) > 0', 1],
    ['0 < (1 / 0)', 1],
    ['(1 / 0) >= 0', 1],
    ['0 <= (1 / 0)', 1],
    ['"prefix" & (1 / 0)', 'prefixInfinity'],
    ['-(1 / 0)', -Infinity],
    ['AND(1, 1 / 0)', 0],
    ['OR(1, 0 / 0)', 1],
    ['NOT(1 / 0)', 1],
    ['TRUE(1 / 0)', 1],
    ['FALSE(1, 0 / 0)', 0],
    ['IF(1, 42, 1 / 0)', 42],
    ['"prefix" & IF(1)', 'prefixundefined'],
    ['AND(1, REGEX_MATCH("sample", "["))', 1],
    ['ISERROR(REGEX_MATCH("sample", "["))', 0],
    ['ISERROR(REGEX_MATCH(1, "sample"))', 0],
    ['ISERROR(1, 1 / 0)', 0],
];

describe('Explicit host formula compatibility', () => {
    for (const [source, expected] of divergenceCases) {
        it(`preserves legacy run while keeping default evaluation strict: ${source}`, () => {
            assert.equal(legacyRun(source), expected);
            const strict = new FormulaRunner(source);
            assert.equal(
                strict.run(),
                source.startsWith('ISERROR') ? 1 : AIRTABLE_FORMULA_ERROR_VALUE
            );
            const compatible = new FormulaRunner(source, false, legacyOptions);
            assert.deepEqual(
                compatible.runWithOutcome(),
                strict.runWithOutcome()
            );
            assert.equal(compatible.run(), expected);
        });
    }

    it('retains ordinary runtime faults, eager arguments and escaping exceptions', () => {
        for (const options of [{}, legacyOptions]) {
            assert.equal(
                new FormulaRunner('ISERROR(LOWER(1))', false, options).run(),
                1
            );
            assert.equal(
                new FormulaRunner(
                    'IF(1, "allowed", LOWER(1))',
                    false,
                    options
                ).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
            assert.throws(
                () =>
                    new FormulaRunner(
                        'ISERROR(REGEX_REPLACE("x", "[", "r"))',
                        false,
                        options
                    ).run(),
                SyntaxError
            );
            assert.throws(
                () =>
                    new FormulaRunner(
                        'ISERROR(UNSUPPORTED(1 / 0))',
                        false,
                        options
                    ).run(),
                Error
            );
        }
        assert.ok(Number.isNaN(legacyRun('-IF(1)')));
        assert.equal(
            new FormulaRunner('-IF(1)').run(),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
    });

    it('retains legacy inherited-name precedence without changing default own-key lookup', () => {
        const fields = Object.setPrototypeOf(
            { [textField.id]: 'own ID' },
            { [textField.name]: 'inherited name' }
        );
        const context = makeContext(fields, [textField]);
        const compatible = new FormulaRunner('{Title}', false, legacyOptions);
        const strict = new FormulaRunner('{Title}');
        compatible.context = context;
        strict.context = context;
        assert.equal(compatible.run(), 'inherited name');
        assert.equal(strict.run(), 'own ID');
        assert.deepEqual(compatible.runWithOutcome(), {
            type: 'value',
            value: 'own ID',
        });
        assert.equal(compatible.run(), 'inherited name');
    });

    it('keeps native fault provenance in strict outcomes and readable legacy data', () => {
        const computed = {
            ...textField,
            config: {
                type: AirtableFieldType.FORMULA,
                options: { isValid: true, result: numberField.config },
            },
        } satisfies AirtableField;
        for (const nativeValue of [
            { error: '#ERROR!' },
            [{ error: '#ERROR!' }],
            [NaN],
            [{ specialValue: 'Infinity' }],
        ] satisfies AirtableValue[]) {
            const compatible = new FormulaRunner(
                'ISERROR({Title})',
                false,
                legacyOptions
            );
            const strict = new FormulaRunner('ISERROR({Title})');
            const context = makeContext({ Title: nativeValue }, [computed]);
            compatible.context = context;
            strict.context = context;
            assert.equal(compatible.run(), 0);
            assert.equal(strict.run(), 1);
            assert.deepEqual(compatible.runWithOutcome(), {
                type: 'value',
                value: 1,
            });
        }
    });

    it('preserves invalid-date legacy results while strict outcomes reject consumption', () => {
        const compatible = new FormulaRunner(
            '"prefix" & {Due date}',
            false,
            legacyOptions
        );
        const strict = new FormulaRunner('"prefix" & {Due date}');
        const context = makeContext({ 'Due date': '2040-99-99' }, [dateField]);
        compatible.context = context;
        strict.context = context;
        assert.equal(compatible.run(), 'prefixnull');
        assert.equal(strict.run(), AIRTABLE_FORMULA_ERROR_VALUE);
        assert.deepEqual(compatible.runWithOutcome(), {
            type: 'error',
            code: 'runtime-error',
        });
    });
});

describe('Host field snapshots', () => {
    it('keeps host date presentation in legacy runs and strict outcomes', () => {
        const originalLocale = moment.locale();
        moment.locale('en');
        try {
            const hostDateRuntime = new Proxy(moment, {
                apply(target, receiver, argumentsList) {
                    return Reflect.apply(
                        target,
                        receiver,
                        argumentsList
                    ).locale('fr');
                },
                get(target, property, receiver) {
                    if (property === 'utc') {
                        return (...args: Parameters<typeof moment.utc>) =>
                            moment.utc(...args).locale('fr');
                    }
                    return Reflect.get(target, property, receiver);
                },
            });
            const source = 'DATETIME_FORMAT("2040-06-15", "MMMM")';
            const runner = new FormulaRunner(source, false, {
                legacyRuntime: true,
                dateRuntime: hostDateRuntime,
            });
            assert.equal(runner.run(), 'juin');
            assert.deepEqual(runner.runWithOutcome(), {
                type: 'value',
                value: 'juin',
            });
            assert.equal(new FormulaRunner(source).run(), 'June');
        } finally {
            moment.locale(originalLocale);
        }
    });
    it('accepts numeric identifier nodes through the exported AST visitor API', () => {
        let observed: string | number | undefined;
        const interpreter = new Interpreter(new Identifier(7), false, {
            legacyRuntime: true,
            resolveFieldReference: (identifier) => {
                observed = identifier;
                return { nativeValue: 9, toPrimitive: () => 9 };
            },
        });
        assert.equal(interpreter.execute(), 9);
        assert.equal(observed, 7);
        assert.deepEqual(interpreter.executeWithOutcome(), {
            type: 'value',
            value: 9,
        });
    });

    it('uses supplied data in both methods without requiring SDK metadata', () => {
        let hostValue = 4;
        const options: FormulaInterpreterOptions = {
            legacyRuntime: true,
            resolveFieldReference: () => {
                const value = hostValue;
                return { nativeValue: value, toPrimitive: () => value };
            },
        };
        const runner = new FormulaRunner('{Host} + 1', false, options);
        const interpreter = new Interpreter(
            new Parser(new Lexer('{Host} + 1').tokenize()).parse(),
            false,
            options
        );
        for (const value of [4, 9, 4]) {
            hostValue = value;
            assert.equal(runner.run(), value + 1);
            assert.deepEqual(runner.runWithOutcome(), {
                type: 'value',
                value: value + 1,
            });
            assert.equal(interpreter.execute(), value + 1);
            assert.deepEqual(interpreter.executeWithOutcome(), {
                type: 'value',
                value: value + 1,
            });
        }
    });

    it('checks the native snapshot before conversion and reads each cell once', () => {
        for (const nativeValue of ['#ERROR!', { error: '#ERROR!' }]) {
            let reads = 0;
            let conversions = 0;
            const cells = {
                get Title() {
                    reads += 1;
                    return reads === 1
                        ? nativeValue
                        : typeof nativeValue === 'string'
                          ? { error: nativeValue }
                          : '#ERROR!';
                },
            };
            const runner = new FormulaRunner('{Title}', false, {
                legacyRuntime: true,
                resolveFieldReference: () => {
                    const value = cells.Title;
                    return {
                        nativeValue: value,
                        toPrimitive: () => {
                            conversions += 1;
                            return typeof value === 'string'
                                ? value
                                : value.error;
                        },
                    };
                },
            });
            runner.context = makeContext(cells, [textField]);
            assert.deepEqual(
                runner.runWithOutcome(),
                typeof nativeValue === 'string'
                    ? { type: 'value', value: '#ERROR!' }
                    : { type: 'error', code: 'runtime-error' }
            );
            assert.equal(reads, 1);
            assert.equal(conversions, typeof nativeValue === 'string' ? 1 : 0);
            assert.equal(runner.run(), '#ERROR!');
            assert.equal(reads, 2);
            assert.equal(conversions, typeof nativeValue === 'string' ? 2 : 1);
        }
    });

    it('retains scalar and array non-finite native provenance before host formatting', () => {
        for (const nativeValue of [
            NaN,
            Infinity,
            -Infinity,
            { specialValue: 'NaN' },
            { specialValue: 'Infinity' },
            { specialValue: '-Infinity' },
            [Infinity],
            [{ specialValue: 'NaN' }],
        ]) {
            const runner = new FormulaRunner('{Host}', false, {
                legacyRuntime: true,
                resolveFieldReference: () => ({
                    nativeValue,
                    toPrimitive: () => 'host formatting',
                }),
            });
            assert.equal(runner.run(), 'host formatting');
            assert.deepEqual(runner.runWithOutcome(), {
                type: 'error',
                code: 'non-finite-result',
            });
            assert.equal(runner.run(), 'host formatting');
        }
    });

    it('does not change legacy mode during a reentrant strict outcome', () => {
        let nested = false;
        let nestedResult: string | number | undefined;
        const options: FormulaInterpreterOptions = Object.freeze({
            legacyRuntime: true,
            resolveFieldReference: () => ({
                nativeValue: 0,
                toPrimitive: () => {
                    if (!nested) {
                        nested = true;
                        nestedResult = runner.run();
                        nested = false;
                    }
                    return Infinity;
                },
            }),
        });
        const runner = new FormulaRunner('NOT({Host})', false, options);
        const context = Object.freeze(makeContext());
        runner.context = context;
        assert.deepEqual(runner.runWithOutcome(), {
            type: 'error',
            code: 'non-finite-result',
        });
        assert.equal(nestedResult, 1);
        assert.equal(runner.run(), 1);
        assert.equal(Object.isFrozen(options), true);
        assert.equal(context.record.fields.Title, undefined);
    });
});
