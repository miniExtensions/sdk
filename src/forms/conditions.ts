import { formatMultiSelectValue } from '../formulas/valueConversion.js';
import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
} from '../runtime/types.js';
import Lexer from '../formulas/lexer/lexer.js';
import TokenTypes from '../formulas/lexer/tokenTypes.js';
import Parser from '../formulas/parser/parser.js';

type DeepReadonly<T> = T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type CompileRuntimeConditionsInput = {
    conditions: DeepReadonly<RuntimeConditionsDefinition> | null;
    airtableFields: readonly DeepReadonly<RuntimeAirtableField>[];
    invalidConditionMode: 'strict' | 'compatibility';
    fieldReferenceMode?: 'saved' | 'name';
};

export type ConditionCompileDiagnostic = {
    code:
        | 'invalid-definition'
        | 'cyclic-definition'
        | 'unsupported-group'
        | 'unsupported-operator'
        | 'unsupported-field-type'
        | 'invalid-reference'
        | 'missing-field'
        | 'incomplete-condition'
        | 'empty-group'
        | 'no-complete-conditions'
        | 'invalid-operand'
        | 'invalid-regex'
        | 'literal-roundtrip'
        | 'field-reference-roundtrip'
        | 'invalid-formula';
    severity: 'warning' | 'error';
    /** Zero-based condition indexes, descending into nested groups. */
    path: readonly number[];
    /** Editor list identity, not a field reference or record value. */
    conditionId?: string;
};

export type CompileRuntimeConditionsResult =
    | {
          type: 'compiled';
          formula: string;
          diagnostics: readonly ConditionCompileDiagnostic[];
      }
    | {
          type: 'unsupported' | 'invalid';
          diagnostics: readonly ConditionCompileDiagnostic[];
      };

const textTypes = [
    'singleLineText',
    'email',
    'url',
    'multilineText',
    'phoneNumber',
    'barcode',
    'richText',
] as const;
const equalityTextTypes = textTypes.filter((type) => type !== 'richText');
const numericTypes = ['number', 'percent', 'currency', 'rating'] as const;

// Exact direct-field intersection of the canonical v105 condition declarations:
// twenty operators, fourteen physical field types, ninety-nine pairs.
const supportedPairs: Readonly<Record<string, readonly string[]>> = {
    matchesRegex: textTypes,
    is: [...equalityTextTypes, 'checkbox', 'singleSelect'],
    isNot: [...equalityTextTypes, 'singleSelect'],
    contains: textTypes,
    doesNotContain: textTypes,
    isOfLength: textTypes,
    isEmpty: [...textTypes, ...numericTypes, 'singleSelect', 'multipleSelects'],
    isNotEmpty: [
        ...textTypes,
        ...numericTypes,
        'singleSelect',
        'multipleSelects',
    ],
    isAnyOf: ['singleSelect'],
    isNoneOf: ['singleSelect'],
    hasAnyOf: ['multipleSelects'],
    hasAllOf: ['multipleSelects'],
    hasNoneOf: ['multipleSelects'],
    isExactly: ['multipleSelects'],
    equals: numericTypes,
    notEquals: numericTypes,
    greaterThan: numericTypes,
    lessThan: numericTypes,
    greaterThanOrEqualsTo: numericTypes,
    lessThanOrEqualsTo: numericTypes,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const quoted = (value: string) => `'${value.replace(/'/g, "\\'")}'`;
const referenced = (value: string, escapeName: boolean) =>
    `{${escapeName ? value.replace(/}/g, '\\}') : value}}`;

/** Pure compilation only: no formula evaluation, record reads or write authority. */
export function compileRuntimeConditions(
    input: CompileRuntimeConditionsInput
): CompileRuntimeConditionsResult {
    const diagnostics: ConditionCompileDiagnostic[] = [];
    let invalid = false;
    let unsupported = false;
    const activeGroups = new WeakSet<object>();

    const report = (
        code: ConditionCompileDiagnostic['code'],
        path: readonly number[],
        condition: unknown,
        severity: ConditionCompileDiagnostic['severity'] = 'error'
    ) => {
        diagnostics.push({
            code,
            severity,
            path: [...path],
            ...(isObject(condition) && typeof condition.id === 'string'
                ? { conditionId: condition.id }
                : {}),
        });
        if (severity === 'warning') return;
        if (code.startsWith('unsupported-')) unsupported = true;
        else invalid = true;
    };

    const incomplete = (
        code: 'incomplete-condition' | 'empty-group',
        path: readonly number[],
        condition: unknown
    ) => {
        report(
            code,
            path,
            condition,
            input.invalidConditionMode === 'compatibility' ? 'warning' : 'error'
        );
        return null;
    };

    // Canonical quote/brace escaping is retained. Refuse a formula whose
    // existing lexer would change the saved literal or reference bytes.
    const roundtrips = (
        formula: string,
        expected: string,
        type: TokenTypes.STRING | TokenTypes.IDENTIFIER
    ) => {
        try {
            const tokens = new Lexer(formula).tokenize();
            new Parser(tokens).parse();
            return (
                tokens.length === 1 &&
                tokens[0].type === type &&
                tokens[0].value === expected
            );
        } catch {
            return false;
        }
    };

    const leaf = (
        condition: Record<string, unknown>,
        path: readonly number[]
    ) => {
        const setting = condition.setting;
        if (!isObject(setting)) {
            report('invalid-definition', path, condition);
            return null;
        }
        const operator = setting.type;
        if (typeof operator !== 'string') {
            report('invalid-definition', path, condition);
            return null;
        }
        if (!Object.hasOwn(supportedPairs, operator)) {
            report('unsupported-operator', path, condition);
            return null;
        }
        const allowedTypes = supportedPairs[operator];
        if (typeof setting.fieldType !== 'string') {
            report('invalid-definition', path, condition);
            return null;
        }
        if (!allowedTypes.includes(setting.fieldType)) {
            report('unsupported-field-type', path, condition);
            return null;
        }
        const identifier = setting.idOrName;
        if (
            !isObject(identifier) ||
            (identifier.type !== 'id' && identifier.type !== 'name')
        ) {
            report('invalid-reference', path, condition);
            return null;
        }
        const savedReference =
            identifier.type === 'id' ? identifier.id : identifier.name;
        if (typeof savedReference !== 'string' || savedReference.length === 0) {
            report('invalid-reference', path, condition);
            return null;
        }
        const field = input.airtableFields.find((candidate) =>
            identifier.type === 'id'
                ? candidate.id === savedReference
                : candidate.name === savedReference
        );
        const isSelect = (type: unknown) =>
            type === 'singleSelect' || type === 'multipleSelects';
        if (
            field != null &&
            (!allowedTypes.includes(field.config.type) ||
                ((isSelect(setting.fieldType) || isSelect(field.config.type)) &&
                    setting.fieldType !== field.config.type))
        ) {
            report('unsupported-field-type', path, condition);
            return null;
        }

        const reference =
            input.fieldReferenceMode === 'name' && field != null
                ? field.name
                : savedReference;
        const fieldFormula = referenced(
            reference,
            identifier.type === 'name' || input.fieldReferenceMode === 'name'
        );
        if (!roundtrips(fieldFormula, reference, TokenTypes.IDENTIFIER)) {
            report('field-reference-roundtrip', path, condition);
            return null;
        }

        // Select operands are choice IDs, never native answer names. Keep this
        // branch ahead of scalar parsing and the numeric switch fallback.
        if (isSelect(setting.fieldType)) {
            const empty = operator === 'isEmpty' || operator === 'isNotEmpty';
            const equality = operator === 'is' || operator === 'isNot';
            const value = setting.value;
            if (
                !empty &&
                (value == null ||
                    value === '' ||
                    (!equality && Array.isArray(value) && value.length === 0))
            )
                return incomplete('incomplete-condition', path, condition);
            if (
                !empty &&
                (equality
                    ? typeof value !== 'string'
                    : !Array.isArray(value) ||
                      Array.from(value).some(
                          (v) => typeof v !== 'string' || v === ''
                      ))
            ) {
                report('invalid-operand', path, condition);
                return null;
            }
            if (field == null) {
                report('missing-field', path, condition, 'warning');
                return 'FALSE()';
            }
            const options = field.config.options;
            const choices =
                isObject(options) && 'choices' in options
                    ? options.choices
                    : null;
            if (!Array.isArray(choices)) {
                report('invalid-definition', path, condition);
                return null;
            }
            const ids = new Set<string>(),
                names = new Set<string>();
            const byId = new Map<string, string>();
            for (const choice of Array.from(choices)) {
                if (
                    !isObject(choice) ||
                    typeof choice.id !== 'string' ||
                    !choice.id ||
                    typeof choice.name !== 'string' ||
                    !choice.name ||
                    ids.has(choice.id) ||
                    names.has(choice.name)
                ) {
                    report('invalid-definition', path, condition);
                    return null;
                }
                ids.add(choice.id);
                names.add(choice.name);
                byId.set(choice.id, choice.name);
            }
            if (empty)
                return `LEN('' & ${fieldFormula}) ${operator === 'isEmpty' ? '=' : '!='} 0`;
            const selectedIds = equality
                ? [value as string]
                : [...new Set(value as string[])];
            const selectedNames = selectedIds.map((id) => byId.get(id));
            if (
                selectedNames.some((v) => v === undefined) &&
                (equality ||
                    operator === 'hasAllOf' ||
                    operator === 'isExactly')
            )
                return 'FALSE()';
            const known = selectedNames.filter(
                (v): v is string => v !== undefined
            );
            if (!known.length) return 'FALSE()';
            const literal = (v: string): string | null => {
                const result = quoted(v);
                if (!roundtrips(result, v, TokenTypes.STRING)) {
                    report('literal-roundtrip', path, condition);
                    return null;
                }
                return result;
            };
            if (setting.fieldType === 'singleSelect') {
                const values = known.map(literal);
                if (values.some((v) => v === null)) return null;
                if (equality)
                    return `${fieldFormula} ${operator === 'is' ? '=' : '!='} ${values[0]}`;
                const formula = `OR(${values.map((v) => `${fieldFormula} = ${v}`).join(',')})`;
                return operator === 'isAnyOf' ? formula : `NOT(${formula})`;
            }
            const serialized = known.map(formatMultiSelectValue);
            // Canonical escaping order is quote escaping BEFORE regex escaping.
            const regexEscape = (v: string) =>
                v.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
            const patterns = serialized.map(
                (v) => `(^|, )${regexEscape(v.replace(/'/g, "\\'"))}(,|$)`
            );
            const literals = patterns.map((v, index) => {
                const result = `'${v}'`;
                // Require the lexer to preserve the intended regex bytes.
                const expected = `(^|, )${regexEscape(serialized[index]!)}(,|$)`;
                if (!roundtrips(result, expected, TokenTypes.STRING)) {
                    report('literal-roundtrip', path, condition);
                    return null;
                }
                return result;
            });
            if (literals.some((v) => v === null)) return null;
            const clauses = literals
                .map((v) => `REGEX_MATCH(${fieldFormula}, ${v})`)
                .join(',');
            if (operator === 'hasAllOf') return `AND(${clauses})`;
            if (operator === 'hasAnyOf') return `OR(${clauses})`;
            if (operator === 'hasNoneOf') return `NOT(OR(${clauses}))`;
            return `AND(LEN(${fieldFormula}) = ${serialized.join(', ').length}, ${clauses})`;
        }

        const isEmpty = operator === 'isEmpty' || operator === 'isNotEmpty';
        const isNumeric = numericTypes.some(
            (type) => type === setting.fieldType
        );
        const isLength = operator === 'isOfLength';
        const isCheckbox = setting.fieldType === 'checkbox';
        const value = setting.value;
        let textValue = '';
        let numberValue = 0;
        let booleanValue = false;
        if (!isEmpty) {
            if (
                value == null ||
                ((operator === 'is' || operator === 'isNot') && value === '')
            ) {
                return incomplete('incomplete-condition', path, condition);
            }
            if (isNumeric || isLength) {
                if (typeof value !== 'number' || !Number.isFinite(value)) {
                    report('invalid-operand', path, condition);
                    return null;
                }
                numberValue = value;
                try {
                    const effectiveNumber =
                        !isLength && field?.config.type === 'percent'
                            ? numberValue / 100
                            : numberValue;
                    new Parser(
                        new Lexer(String(effectiveNumber)).tokenize()
                    ).parse();
                } catch {
                    report('invalid-formula', path, condition);
                    return null;
                }
            } else if (isCheckbox) {
                if (typeof value !== 'boolean') {
                    report('invalid-operand', path, condition);
                    return null;
                }
                booleanValue = value;
            } else {
                if (typeof value !== 'string') {
                    report('invalid-operand', path, condition);
                    return null;
                }
                textValue = value;
                if (
                    !roundtrips(quoted(textValue), textValue, TokenTypes.STRING)
                ) {
                    report('literal-roundtrip', path, condition);
                    return null;
                }
                if (operator === 'matchesRegex') {
                    try {
                        // Same pattern grammar as the existing portable engine;
                        // this validates syntax without testing a record value.
                        new RegExp(textValue);
                    } catch {
                        report('invalid-regex', path, condition);
                        return null;
                    }
                }
            }
        }

        if (field == null) {
            report('missing-field', path, condition, 'warning');
            return 'FALSE()';
        }

        switch (operator) {
            case 'matchesRegex':
                return `REGEX_MATCH(${fieldFormula}, ${quoted(textValue)})`;
            case 'is':
            case 'isNot': {
                const effectiveValue = isCheckbox
                    ? String(Number(booleanValue))
                    : quoted(textValue);
                return `${fieldFormula} ${operator === 'is' ? '=' : '!='} ${effectiveValue}`;
            }
            case 'isOfLength':
                return `LEN(${fieldFormula}) = ${numberValue}`;
            case 'contains':
            case 'doesNotContain': {
                const formula = `FIND(LOWER(${quoted(textValue)}), LOWER(${fieldFormula} & ''))`;
                return operator === 'contains' ? formula : `NOT(${formula})`;
            }
            case 'isEmpty':
            case 'isNotEmpty': {
                const sign = operator === 'isEmpty' ? '=' : '!=';
                return setting.fieldType === 'rating'
                    ? `${fieldFormula} ${sign} 0`
                    : `LEN('' & ${fieldFormula}) ${sign} 0`;
            }
            default: {
                const sign =
                    operator === 'equals'
                        ? '='
                        : operator === 'notEquals'
                          ? '!='
                          : operator === 'greaterThan'
                            ? '>'
                            : operator === 'lessThan'
                              ? '<'
                              : operator === 'greaterThanOrEqualsTo'
                                ? '>='
                                : '<=';
                const numericValue =
                    field.config.type === 'percent'
                        ? numberValue / 100
                        : numberValue;
                return `${fieldFormula} ${sign} ${numericValue}`;
            }
        }
    };

    const group = (
        definition: unknown,
        path: readonly number[],
        topLevel = false
    ): string | null => {
        if (!isObject(definition) || !Array.isArray(definition.conditions)) {
            report('invalid-definition', path, definition);
            return null;
        }
        if (activeGroups.has(definition)) {
            report('cyclic-definition', path, definition);
            return null;
        }
        const operator = definition.logicalOperator;
        if (operator !== 'and' && operator !== 'or') {
            report(
                typeof operator === 'string'
                    ? 'unsupported-group'
                    : 'invalid-definition',
                path,
                definition
            );
            return null;
        }
        if (definition.conditions.length === 0) {
            return topLevel ? '1' : incomplete('empty-group', path, definition);
        }
        activeGroups.add(definition);
        const sections: string[] = [];
        try {
            for (const [index, condition] of definition.conditions.entries()) {
                const childPath = [...path, index];
                if (!isObject(condition)) {
                    report('invalid-definition', childPath, condition);
                    continue;
                }
                const formula =
                    condition.type === 'groupCondition'
                        ? group(condition, childPath)
                        : condition.type === 'singleCondition'
                          ? leaf(condition, childPath)
                          : (report('invalid-definition', childPath, condition),
                            null);
                if (formula != null) sections.push(formula);
            }
        } finally {
            activeGroups.delete(definition);
        }
        if (sections.length === 0) {
            report('no-complete-conditions', path, definition);
            return null;
        }
        return sections.length === 1
            ? sections[0]
            : `${operator.toUpperCase()}(${sections.join(', ')})`;
    };

    let formula: string | null = null;
    try {
        if (
            !isObject(input) ||
            !Array.isArray(input.airtableFields) ||
            !['strict', 'compatibility'].includes(input.invalidConditionMode) ||
            (input.fieldReferenceMode != null &&
                input.fieldReferenceMode !== 'saved' &&
                input.fieldReferenceMode !== 'name')
        ) {
            report('invalid-definition', [], null);
        } else {
            formula =
                input.conditions === null
                    ? '1'
                    : group(input.conditions, [], true);
        }
        if (!unsupported && !invalid && formula != null) {
            try {
                new Parser(new Lexer(formula).tokenize()).parse();
            } catch {
                report('invalid-formula', [], null);
            }
        }
    } catch {
        // Malformed external data (including recursion overflow) never escapes
        // as a copied exception or becomes a partially compiled predicate.
        report('invalid-definition', [], null);
    }
    if (unsupported) return { type: 'unsupported', diagnostics };
    if (invalid || formula == null) return { type: 'invalid', diagnostics };
    return { type: 'compiled', formula, diagnostics };
}
