import {
    AIRTABLE_FORMULA_ERROR_VALUE,
    AirtableFieldType,
    type AirtableField,
    type AirtableRecord,
    type AirtableValue,
    type TableIdsToLinkedTableLoadingStates,
} from '../types.js';
import TokenTypes from '../lexer/tokenTypes.js';
import {
    type Visitor,
    type Expr,
    Binary,
    Literal,
    Unary,
    FunctionCall,
    Grouping,
    Identifier,
} from '../parser/ast.js';
import FormulaRunner, { type FormulaRunOutcome } from '../runner.js';
import moment, { type unitOfTime } from 'moment';
import {
    type AirtablePrimitive,
    arrayJoinSeparator,
    convertAirtableValueToPrimitive,
    formatDateToAirtableDateTimeString,
    formatMultiSelectValue,
    assertUnreachable,
} from '../valueConversion.js';

export type InterpreterContext = {
    record: AirtableRecord;
    airtableFields: AirtableField[];
    linkedTableLoadingStates: TableIdsToLinkedTableLoadingStates;
};

export enum FormulaFunctions {
    RECORD_ID = 'RECORD_ID',
    FIND = 'FIND',
    LOWER = 'LOWER',
    TRIM = 'TRIM',
    SEARCH = 'SEARCH',
    AND = 'AND',
    OR = 'OR',
    LEN = 'LEN',
    NOT = 'NOT',
    TRUE = 'TRUE',
    REGEX_MATCH = 'REGEX_MATCH',
    IS_BEFORE = 'IS_BEFORE',
    IS_AFTER = 'IS_AFTER',
    DATESTR = 'DATESTR',
    TODAY = 'TODAY',
    WEEKDAY = 'WEEKDAY',
    DATEADD = 'DATEADD',
    IF = 'IF',
    ISERROR = 'ISERROR',
    FALSE = 'FALSE',
    DATETIME_FORMAT = 'DATETIME_FORMAT',
    REGEX_REPLACE = 'REGEX_REPLACE',
    VALUE = 'VALUE',
}

type FormulaFunctionType = `${FormulaFunctions}`;

/**
 * Formula errors that need to be returned as an airtable formula error value
 */
class FormulaRuntimeError extends Error {
    constructor(
        readonly code: 'runtime-error' | 'non-finite-result' = 'runtime-error'
    ) {
        super();
        // We need to manually adjust the prototype chain when transpiling to es5
        // https://github.com/Microsoft/TypeScript-wiki/blob/main/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export default class Interpreter implements Visitor<AirtablePrimitive> {
    private _context: InterpreterContext | null = null;

    constructor(
        private expr: Expr,
        private doNotThrowForUnknownFields = false
    ) {}

    execute() {
        try {
            return this.convertPrimitiveToStringOrNumber(this._execute());
        } catch (e) {
            if (e instanceof FormulaRuntimeError)
                return AIRTABLE_FORMULA_ERROR_VALUE;
            throw e;
        }
    }

    executeWithOutcome(): FormulaRunOutcome {
        try {
            const value = this.convertPrimitiveToStringOrNumber(
                this._execute()
            );
            this.assertConsumableValue(value);
            if (typeof value !== 'string' && typeof value !== 'number')
                throw new FormulaRuntimeError();
            return { type: 'value', value };
        } catch (e) {
            if (e instanceof FormulaRuntimeError)
                return { type: 'error', code: e.code };
            throw e;
        }
    }

    private assertConsumableValue(value: unknown): void {
        if (
            value == null ||
            (value instanceof Date && !Number.isFinite(value.getTime()))
        )
            throw new FormulaRuntimeError();
        if (FormulaRunner.isErrorValue(value))
            throw new FormulaRuntimeError('non-finite-result');
    }

    private _execute() {
        return this.expr.accept(this);
    }

    private convertPrimitiveToStringOrNumber(
        value: AirtablePrimitive
    ): string | number {
        if (value instanceof Date)
            return formatDateToAirtableDateTimeString(value);
        return value;
    }

    /**
     * Handles interpreting binary expressions. Recursively evaluates the left value and then the right
     * and applies the required operator to the two values.
     * @param node
     * @returns
     */
    visitBinaryExpr(node: Binary): string | number {
        const _left = node.left.accept(this);
        const _right = node.right.accept(this);

        const convertedLeft = this.convertPrimitiveToStringOrNumber(_left);
        const convertedRight = this.convertPrimitiveToStringOrNumber(_right);
        // Evaluate both operands before classifying consumption, preserving
        // eager ordering and exceptions from the later operand.
        this.assertConsumableValue(convertedLeft);
        this.assertConsumableValue(convertedRight);

        switch (node.operator.type) {
            case TokenTypes.PLUS:
                return Math.round(
                    Number(convertedLeft) + Number(convertedRight)
                );
            case TokenTypes.MINUS:
                return Math.round(
                    Number(convertedLeft) - Number(convertedRight)
                );
            case TokenTypes.AMPERSAND:
                return String(convertedLeft) + String(convertedRight);
            case TokenTypes.FSLASH:
                if (
                    typeof convertedRight === 'string' ||
                    typeof convertedLeft === 'string'
                )
                    throw new FormulaRuntimeError();
                return Math.round(
                    Number(convertedLeft) / Number(convertedRight)
                );
            case TokenTypes.STAR:
                if (
                    typeof convertedLeft === 'string' ||
                    typeof convertedRight === 'string'
                )
                    throw new FormulaRuntimeError();
                return Math.round(
                    Number(convertedLeft) * Number(convertedRight)
                );
            case TokenTypes.EQUAL_TO:
                return Number(convertedLeft == convertedRight);
            case TokenTypes.GREATER_THAN:
                return Number(convertedLeft > convertedRight);
            case TokenTypes.LESS_THAN:
                return Number(convertedLeft < convertedRight);
            case TokenTypes.NOT_EQ:
                return Number(convertedLeft != convertedRight);
            case TokenTypes.GREATER_THAN_EQ:
                return Number(convertedLeft >= convertedRight);
            case TokenTypes.LESS_THAN_EQ:
                return Number(convertedLeft <= convertedRight);
            default:
                throw new Error(
                    'Unknown binary operator ' + node.operator.type
                );
        }
    }

    /**
     * Evaluates the value of a literal expression. This simply mean returning the literal value
     * within the node itself.
     * @param node
     * @returns
     */
    visitLiteralExpr(node: Literal): string | number {
        return node.value;
    }

    /**
     * Evaluates the value of a unary expression. It recusively evaluates the expression in the left node
     * into a value and applies a unary operation to it. Only negation is permitted.
     * @param node
     * @returns
     */
    visitUnaryExpr(node: Unary): string | number {
        const value = node.left.accept(this);
        this.assertConsumableValue(value);

        switch (node.operator.type) {
            case TokenTypes.MINUS:
                return -Number(value);
            default:
                throw new Error('Unknown unary operator ' + node.operator.type);
        }
    }

    /**
     * This will evaluate the function calls
     * @param node
     */
    visitFunctionCallExpr(node: FunctionCall): string | number {
        const name = node.callee as FormulaFunctionType;
        try {
            const functionArguments = node.arguments.map((argument) =>
                argument.accept(this)
            );
            return this.handleFunctionCall(name, functionArguments);
        } catch (e) {
            if (name === 'ISERROR' && e instanceof FormulaRuntimeError) {
                return 1;
            } else {
                throw e;
            }
        }
    }

    /**
     * Evaluates grouping expressions by visiting the expression held within
     * the grouping node.
     * @param node
     * @returns
     */
    visitGroupExpr(node: Grouping): AirtablePrimitive {
        return node.expr.accept(this);
    }

    visitIdentifierExpr(node: Identifier): AirtablePrimitive {
        const context = this.context;
        if (context == null)
            throw new Error(
                'Interpreter context must be set for resolving identifiers'
            );

        const field = context.airtableFields.find(
            (field) => field.id === node.value || field.name == node.value
        );

        if (field == null)
            if (this.doNotThrowForUnknownFields) return '';
            else throw new Error(`Field ${node.value} does not exist.`);

        const recordFields = context.record.fields;
        const value = Object.hasOwn(recordFields, field.name)
            ? recordFields[field.name]
            : Object.hasOwn(recordFields, field.id)
              ? recordFields[field.id]
              : undefined;
        return this.getFieldReferenceValue(field, value);
    }

    private getFieldReferenceValue(
        field: AirtableField,
        value: AirtableValue
    ): AirtablePrimitive {
        if (this.context == null) {
            throw new Error(
                'Interpreter context must be set for resolving identifiers'
            );
        }
        // Shared readable formatting deliberately presents native errors as
        // text. Formula evaluation must retain their provenance before that
        // conversion; literal marker strings remain ordinary data.
        const arrayValue = Array.isArray(value);
        for (const member of arrayValue ? value : [value]) {
            if (
                member != null &&
                typeof member === 'object' &&
                Object.hasOwn(member, 'error') &&
                'error' in member &&
                typeof member.error === 'string'
            )
                throw new FormulaRuntimeError();
            if (
                arrayValue &&
                (FormulaRunner.isErrorValue(member) ||
                    (member != null &&
                        typeof member === 'object' &&
                        Object.hasOwn(member, 'specialValue') &&
                        'specialValue' in member &&
                        (member.specialValue === 'NaN' ||
                            member.specialValue === 'Infinity' ||
                            member.specialValue === '-Infinity')))
            )
                throw new FormulaRuntimeError('non-finite-result');
        }
        const primitive = convertAirtableValueToPrimitive({
            value,
            airtableFieldConfig: field.config,
            source: {
                type: 'airtableMock',
                linkedTableStates: this.context.linkedTableLoadingStates,
            },
            fieldName: field.name,
        });

        if (!Array.isArray(primitive)) {
            return primitive;
        }
        for (const member of primitive) this.assertConsumableValue(member);

        if (field.config.type !== AirtableFieldType.MULTIPLE_SELECTS) {
            return primitive.join(arrayJoinSeparator);
        }

        return (primitive as string[])
            .map(formatMultiSelectValue)
            .join(arrayJoinSeparator);
    }

    private isDateOrString(value: AirtablePrimitive): value is Date | string {
        return typeof value === 'string' || value instanceof Date;
    }

    private handleFunctionCall(
        functionName: FormulaFunctionType,
        unconvertedArgs: AirtablePrimitive[]
    ) {
        const convertedArgs = unconvertedArgs.map((arg) =>
            this.convertPrimitiveToStringOrNumber(arg)
        );
        // Unknown callees keep their regular exception, including when an
        // argument is non-finite. ISERROR handles private faults itself.
        if (
            functionName !== 'ISERROR' &&
            (functionName !== 'RECORD_ID' || this.context != null) &&
            Object.hasOwn(FormulaFunctions, functionName)
        )
            for (const argument of convertedArgs)
                this.assertConsumableValue(argument);
        switch (functionName) {
            case 'RECORD_ID':
                if (this.context == null)
                    throw new Error(
                        'Interpreter context must be set for resolving record id'
                    );
                return this.context.record.id;
            case 'LOWER': {
                const arg = convertedArgs[0];
                if (typeof arg !== 'string') throw new FormulaRuntimeError();
                return arg.toLowerCase();
            }
            case 'TRIM': {
                const arg = convertedArgs[0];
                if (typeof arg !== 'string') throw new FormulaRuntimeError();
                return arg.trim();
            }
            case 'FIND':
            case 'SEARCH': {
                const stringToFind = convertedArgs[0];
                const whereToFind = convertedArgs[1];
                const startPosition = Number(convertedArgs[2]) ?? 0;

                if (
                    typeof stringToFind !== 'string' ||
                    typeof whereToFind !== 'string'
                )
                    throw new FormulaRuntimeError();

                const foundIndex =
                    whereToFind.indexOf(stringToFind, startPosition) + 1;

                if (!foundIndex)
                    return functionName === 'FIND' ? foundIndex : '';

                return foundIndex;
            }
            case 'OR':
                return Number(
                    convertedArgs.some(
                        (val) => !FormulaRunner.isFalsyValue(val)
                    )
                );
            case 'AND':
                return Number(
                    convertedArgs.every(
                        (val) => !FormulaRunner.isFalsyValue(val)
                    )
                );
            case 'LEN':
                if (typeof convertedArgs[0] != 'string')
                    throw new FormulaRuntimeError();
                return convertedArgs[0].length;
            case 'NOT':
                return Number(
                    FormulaRunner.isFalsyValue(convertedArgs[0]) ? true : false
                );
            case 'REGEX_MATCH': {
                const value = convertedArgs[0];
                const regexString = convertedArgs[1];
                if (
                    typeof regexString !== 'string' ||
                    typeof value !== 'string'
                )
                    throw new FormulaRuntimeError();
                try {
                    const regex = new RegExp(regexString);
                    return Number(regex.test(value));
                } catch (e) {
                    if (e instanceof SyntaxError)
                        throw new FormulaRuntimeError();
                    throw e;
                }
            }
            case 'REGEX_REPLACE': {
                const value = convertedArgs[0];
                const regexString = convertedArgs[1];
                const replacement = convertedArgs[2];
                if (
                    typeof regexString !== 'string' ||
                    typeof value !== 'string' ||
                    typeof replacement !== 'string'
                )
                    throw new FormulaRuntimeError();
                const regex = new RegExp(regexString, 'g');
                const result = value.replaceAll(regex, replacement);
                return result;
            }
            case 'IS_BEFORE': {
                const date1 = unconvertedArgs[0];
                const date2 = unconvertedArgs[1];
                if (!this.isDateOrString(date1) || !this.isDateOrString(date2))
                    throw new FormulaRuntimeError();
                return Number(moment.utc(date1).isBefore(moment.utc(date2)));
            }
            case 'IS_AFTER': {
                const date1 = unconvertedArgs[0];
                const date2 = unconvertedArgs[1];
                if (!this.isDateOrString(date1) || !this.isDateOrString(date2))
                    throw new FormulaRuntimeError();
                return Number(moment.utc(date1).isAfter(moment.utc(date2)));
            }
            case 'DATESTR': {
                const date = unconvertedArgs[0];
                if (!this.isDateOrString(date)) throw new FormulaRuntimeError();
                if (date === '') return '';
                let parsedDate = moment.utc(date);
                if (!parsedDate.isValid()) {
                    // The date could be in the 'YYYY-MM-DD h:mma' format if it's a result of DATEADD.
                    parsedDate = moment.utc(date, 'YYYY-MM-DD h:mma');
                }
                if (!parsedDate.isValid()) throw new FormulaRuntimeError();
                return parsedDate.format('YYYY-MM-DD');
            }
            case 'DATEADD': {
                const date = unconvertedArgs[0];
                const howMuchToAdd = unconvertedArgs[1];
                const unit = unconvertedArgs[2];
                if (
                    !this.isDateOrString(date) ||
                    typeof howMuchToAdd !== 'number' ||
                    !isTimeUnit(unit)
                ) {
                    throw new FormulaRuntimeError();
                }

                const result = moment.utc(date).add(howMuchToAdd, unit);

                const format =
                    // Airtable doesn't display time if it's the start of day (00:00)
                    moment(result).startOf('day').valueOf() ===
                    moment(result).valueOf()
                        ? 'YYYY-MM-DD'
                        : 'YYYY-MM-DD h:mma';

                return result.format(format);
            }
            case 'VALUE': {
                const value = convertedArgs[0];
                if (typeof value !== 'string') throw new FormulaRuntimeError();
                return Number(value);
            }
            case 'DATETIME_FORMAT': {
                const date = convertedArgs[0];
                const format = convertedArgs[1];
                if (typeof format !== 'string') throw new FormulaRuntimeError();
                return moment.utc(date).format(format);
            }
            case 'WEEKDAY': {
                const date = unconvertedArgs[0];
                if (!this.isDateOrString(date)) throw new FormulaRuntimeError();
                return moment.utc(date).isoWeekday() % 7;
            }
            case 'TODAY': {
                return moment().format('YYYY-MM-DD');
            }
            case 'TRUE':
                return 1;
            case 'FALSE':
                return 0;
            case 'IF': {
                const condition = convertedArgs[0];
                const trueValue = convertedArgs[1];
                const falseValue = convertedArgs[2];

                return FormulaRunner.isFalsyValue(condition)
                    ? falseValue
                    : trueValue;
            }
            case 'ISERROR':
                for (const argument of convertedArgs)
                    this.assertConsumableValue(argument);
                return 0;
            default:
                assertUnreachable(functionName);
        }
    }

    get context() {
        return this._context;
    }

    set context(record: InterpreterContext | null) {
        this._context = record;
    }
}

const isTimeUnit = (testedValue: unknown): testedValue is unitOfTime.Base => {
    return (
        testedValue === 'year' ||
        testedValue === 'years' ||
        testedValue === 'y' ||
        testedValue === 'month' ||
        testedValue === 'months' ||
        testedValue === 'M' ||
        testedValue === 'week' ||
        testedValue === 'weeks' ||
        testedValue === 'w' ||
        testedValue === 'day' ||
        testedValue === 'days' ||
        testedValue === 'd' ||
        testedValue === 'hour' ||
        testedValue === 'hours' ||
        testedValue === 'h' ||
        testedValue === 'minute' ||
        testedValue === 'minutes' ||
        testedValue === 'm' ||
        testedValue === 'second' ||
        testedValue === 'seconds' ||
        testedValue === 's' ||
        testedValue === 'millisecond' ||
        testedValue === 'milliseconds' ||
        testedValue === 'ms'
    );
};
