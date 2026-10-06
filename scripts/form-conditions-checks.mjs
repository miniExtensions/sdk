import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Every consumer imports the actual installed archive through its public
// exports. These are synthetic compilation/evaluation checks, not browser,
// provider, validation or authorization evidence.
const runtimeConsumer = `
const cases = [];
function check(name, verify) {
    verify();
    cases.push(name);
}
function freeze(value) {
    if (value !== null && typeof value === 'object') {
        for (const member of Object.values(value)) freeze(member);
        Object.freeze(value);
    }
    return value;
}
const title = {id:'fld_title',name:'Title',config:{type:'singleLineText',options:null}};
const quantity = {id:'fld_quantity',name:'Quantity',config:{type:'number',options:{precision:2}}};
const percent = {id:'fld_percent',name:'Percent',config:{type:'percent',options:{precision:2}}};
const fields = freeze([title, quantity, percent]);
function leaf(id, fieldType, type, value, reference = {type:'id',id:'fld_title'}) {
    return {id,type:'singleCondition',setting:{fieldType,type,value,idOrName:reference}};
}
function compile(conditions, options = {}) {
    return compileRuntimeConditions({conditions,airtableFields:fields,invalidConditionMode:'strict',...options});
}
function definition(...conditions) {
    return {logicalOperator:'and',conditions};
}
function evaluate(formula, values = {}) {
    const runner = new FormulaRunner(formula);
    runner.context = freeze({record:{id:'rec_synthetic',fields:values},airtableFields:fields,linkedTableLoadingStates:{}});
    return runner.runWithOutcome();
}
function compiled(result) {
    assert.equal(result.type, 'compiled');
    assert.equal(typeof result.formula, 'string');
    return result.formula;
}
function blocked(result, type, code) {
    assert.equal(result.type, type);
    assert.equal(Object.hasOwn(result, 'formula'), false);
    assert(result.diagnostics.some(diagnostic => diagnostic.code === code));
    assert.deepEqual(Object.keys(result).sort(), ['diagnostics','type']);
}

check('nested AND/OR and canonical NOT operator compile then evaluate', () => {
    const input = freeze(definition(
        leaf('has-needle','singleLineText','contains','needle'),
        {id:'alternatives',type:'groupCondition',logicalOperator:'or',conditions:[
            leaf('not-blocked','singleLineText','doesNotContain','blocked'),
            leaf('quantity','number','greaterThan',10,{type:'id',id:'fld_quantity'})
        ]}
    ));
    const before = JSON.stringify(input);
    const result = compile(input);
    const formula = compiled(result);
    assert(formula.startsWith('AND('));
    assert(formula.includes('OR('));
    assert(formula.includes('NOT('));
    assert.deepEqual(evaluate(formula,{fld_title:'A NEEDLE',fld_quantity:1}),{type:'value',value:1});
    assert.deepEqual(evaluate(formula,{fld_title:'needle blocked',fld_quantity:1}),{type:'value',value:0});
    assert.deepEqual(evaluate(formula,{fld_title:'needle blocked',fld_quantity:11}),{type:'value',value:1});
    assert.equal(JSON.stringify(input), before);
    assert(Object.isFrozen(input.conditions[1].conditions));
});
check('null and empty root definitions retain canonical constant predicate', () => {
    assert.equal(compiled(compile(null)), '1');
    assert.equal(compiled(compile(definition())), '1');
});
check('strict incomplete input blocks the entire sibling formula', () => {
    blocked(compile(definition(leaf('valid','singleLineText','contains','needle'),leaf('incomplete','singleLineText','is',null))), 'invalid', 'incomplete-condition');
});
check('explicit compatibility omission returns a warning and surviving formula', () => {
    const result = compile(definition(leaf('valid','singleLineText','contains','needle'),leaf('incomplete','singleLineText','is',null)),{invalidConditionMode:'compatibility'});
    assert.equal(compiled(result), compiled(compile(definition(leaf('valid','singleLineText','contains','needle')))));
    assert.deepEqual(result.diagnostics, [{code:'incomplete-condition',severity:'warning',path:[1],conditionId:'incomplete'}]);
});
check('compatibility never turns all omitted conditions into a true predicate', () => {
    blocked(compile(definition(leaf('incomplete','singleLineText','is',null)),{invalidConditionMode:'compatibility'}), 'invalid', 'no-complete-conditions');
});
check('unsupported lookup blocks supported siblings without a partial formula', () => {
    blocked(compile(definition(leaf('valid','singleLineText','contains','needle'),leaf('lookup','multipleLookupValues','contains','needle'))), 'unsupported', 'unsupported-field-type');
});
check('unsupported date operator cannot silently become scalar visibility', () => {
    blocked(compile(definition(leaf('date','date','IsWithin',{type:'today'}))), 'unsupported', 'unsupported-operator');
});
check('unsupported AST NOT group never produces an arbitrary expression', () => {
    blocked(compile({logicalOperator:'not',conditions:[leaf('valid','singleLineText','contains','needle')]}), 'unsupported', 'unsupported-group');
});
check('invalid regular expression blocks all formula emission', () => {
    blocked(compile(definition(leaf('regex','singleLineText','matchesRegex','['))), 'invalid', 'invalid-regex');
});
check('missing supported field emits an explicit false leaf and diagnostic', () => {
    const result = compile(definition(leaf('missing','singleLineText','is','needle',{type:'id',id:'fld_missing'})));
    assert.equal(compiled(result),'FALSE()');
    assert.deepEqual(result.diagnostics,[{code:'missing-field',severity:'warning',path:[0],conditionId:'missing'}]);
    assert.deepEqual(evaluate(result.formula),{type:'value',value:0});
});
check('current metadata cannot grant unsupported computed field compatibility', () => {
    const computedTitle = {id:'fld_title',name:'Title',config:{type:'formula',options:{isValid:true,result:title.config}}};
    blocked(compile(definition(leaf('computed','singleLineText','contains','needle')),{airtableFields:[computedTitle]}), 'unsupported', 'unsupported-field-type');
});
check('saved and current numeric pair membership preserves current percent scaling', () => {
    const result = compile(definition(leaf('percentage','number','equals',25,{type:'id',id:'fld_percent'})));
    assert.equal(compiled(result),'{fld_percent} = 0.25');
    assert.deepEqual(evaluate(result.formula,{fld_percent:0.25}),{type:'value',value:1});
});
check('explicit name references resolve current field metadata', () => {
    const result = compile(definition(leaf('named','singleLineText','is','needle')),{fieldReferenceMode:'name'});
    assert.equal(compiled(result),"{Title} = 'needle'");
    assert.deepEqual(evaluate(result.formula,{fld_title:'needle'}),{type:'value',value:1});
});
check('null and empty text values follow the existing primitive engine', () => {
    const formula = compiled(compile(definition(leaf('empty','singleLineText','isEmpty',null))));
    assert.deepEqual(evaluate(formula,{fld_title:null}),{type:'value',value:1});
    assert.deepEqual(evaluate(formula,{fld_title:''}),{type:'value',value:1});
    assert.deepEqual(evaluate(formula,{fld_title:' '}),{type:'value',value:0});
});
check('non-finite compiler operand is invalid instead of coerced to formula text', () => {
    blocked(compile(definition(leaf('infinite','number','equals',Infinity,{type:'id',id:'fld_quantity'}))), 'invalid', 'invalid-operand');
});
check('JavaScript-shaped literals are ordinary data and never execute', () => {
    const literal = 'globalThis.__miniConditionsExecuted = true';
    assert.equal(Object.hasOwn(globalThis,'__miniConditionsExecuted'),false);
    const result = compile(definition(leaf('data','singleLineText','is',literal)));
    assert.deepEqual(evaluate(compiled(result),{fld_title:literal}),{type:'value',value:1});
    assert.equal(Object.hasOwn(globalThis,'__miniConditionsExecuted'),false);
    assert.deepEqual(Object.keys(result).sort(),['diagnostics','formula','type']);
});
check('diagnostics expose location and code without record data or authority', () => {
    const literal = 'sensitive-synthetic-operand[';
    const result = compile(definition(leaf('regex','singleLineText','matchesRegex',literal)));
    blocked(result,'invalid','invalid-regex');
    assert.equal(JSON.stringify(result).includes(literal),false);
    assert.deepEqual(Object.keys(result.diagnostics[0]).sort(),['code','conditionId','path','severity']);
});

const regexFault = 'REGEX_MATCH("sample", "[")';
for (const formula of [regexFault,'AND(0, '+regexFault+')','OR(1, '+regexFault+')','NOT('+regexFault+')','AND(1, OR(0, NOT('+regexFault+')))','IF(1, 42, '+regexFault+')']) {
    check('runtime fault provenance: '+formula, () => {
        const runner = new FormulaRunner(formula);
        assert.equal(runner.run(),AIRTABLE_FORMULA_ERROR_VALUE);
        assert.deepEqual(runner.runWithOutcome(),{type:'error',code:'runtime-error'});
    });
}
for (const formula of ['1 / 0','AND(1, 1 / 0)','OR(1, 0 / 0)','NOT(VALUE("not-a-number"))','IF(1, 42, 1 / 0)']) {
    check('non-finite fault provenance: '+formula, () => {
        assert.deepEqual(new FormulaRunner(formula).runWithOutcome(),{type:'error',code:'non-finite-result'});
    });
}
check('ordinary error-looking literals remain data and static classifiers remain compatible', () => {
    assert.deepEqual(new FormulaRunner('"#ERROR!"').runWithOutcome(),{type:'value',value:'#ERROR!'});
    assert.deepEqual(new FormulaRunner('AND(1, "#ERROR!")').runWithOutcome(),{type:'value',value:1});
    assert.equal(FormulaRunner.isErrorValue('#ERROR!'),false);
    assert.equal(FormulaRunner.isFalsyValue('#ERROR!'),false);
    assert.equal(new FormulaRunner('1 / 0').run(),Infinity);
});
check('native error objects differ from literal marker values through installed engine', () => {
    const computed = {id:'fld_computed',name:'Computed',config:{type:'formula',options:{isValid:true,result:title.config}}};
    for (const [value, expected] of [[{error:'Synthetic failure'},{type:'error',code:'runtime-error'}],['#ERROR!',{type:'value',value:'#ERROR!'}]]) {
        const runner = new FormulaRunner('{Computed}');
        runner.context = freeze({record:{id:'rec_synthetic',fields:{fld_computed:value}},airtableFields:[computed],linkedTableLoadingStates:{}});
        assert.deepEqual(runner.runWithOutcome(),expected);
    }
});
check('missing outcomes are explicit errors while legacy returns remain unchanged', () => {
    const missing = new FormulaRunner('IF(1)');
    assert.equal(missing.run(),undefined);
    assert.deepEqual(missing.runWithOutcome(),{type:'error',code:'runtime-error'});
    const date = {id:'fld_date',name:'Due',config:{type:'date',options:{dateFormat:{format:'YYYY-MM-DD'}}}};
    const runner = new FormulaRunner('{Due}');
    runner.context = {record:{id:'rec_synthetic',fields:{fld_date:'2040-99-99'}},airtableFields:[date],linkedTableLoadingStates:{}};
    assert.equal(runner.run(),null);
    assert.deepEqual(runner.runWithOutcome(),{type:'error',code:'runtime-error'});
});
check('unknown functions are not converted to silent false or runtime outcome', () => {
    assert.throws(() => new FormulaRunner('UNSUPPORTED_FUNCTION(1)').runWithOutcome(), /Unexpected: UNSUPPORTED_FUNCTION/);
});
console.log(JSON.stringify({checks:cases.length,cases}));
`;

const declarationConsumer = `
import type { RuntimeAirtableField, RuntimeConditionsDefinition } from '@miniextensions/sdk';
import { compileRuntimeConditions, type CompileRuntimeConditionsInput, type CompileRuntimeConditionsResult, type ConditionCompileDiagnostic } from '@miniextensions/sdk/forms';
import { FormulaRunner, type FormulaRunOutcome } from '@miniextensions/sdk/formulas';

const readonlyInput: CompileRuntimeConditionsInput = {
    conditions: Object.freeze({
        logicalOperator:'and',
        conditions:Object.freeze([Object.freeze({
            id:'readonly-condition',type:'singleCondition',
            setting:Object.freeze({type:'contains',fieldType:'singleLineText',value:'needle',idOrName:Object.freeze({type:'id',id:'fld_title'})})
        })])
    }),
    airtableFields:Object.freeze([Object.freeze({
        id:'fld_title',name:'Title',description:null,isComputed:false,isPrimaryField:false,
        config:Object.freeze({type:'singleLineText',options:null})
    })]),
    invalidConditionMode:'strict',fieldReferenceMode:'saved'
};
// Canonical mutable metadata is accepted too; callers need not reconstruct it.
export function compileCanonical(conditions: RuntimeConditionsDefinition, airtableFields: RuntimeAirtableField[]): CompileRuntimeConditionsResult {
    return compileRuntimeConditions({conditions,airtableFields,invalidConditionMode:'compatibility'});
}
export function narrow(result: CompileRuntimeConditionsResult): string | number | null {
    const diagnostics: readonly ConditionCompileDiagnostic[] = result.diagnostics;
    for (const diagnostic of diagnostics) {
        const severity:'warning'|'error' = diagnostic.severity;
        const location:readonly number[] = diagnostic.path;
        void [severity,location,diagnostic.conditionId];
        // @ts-expect-error diagnostics do not grant permission or expose operands
        void diagnostic.permission;
    }
    if (result.type === 'compiled') {
        const formula:string = result.formula;
        const outcome:FormulaRunOutcome = new FormulaRunner(formula).runWithOutcome();
        if (outcome.type === 'value') {
            const value:string|number = outcome.value;
            // @ts-expect-error successful values do not have an error code
            void outcome.code;
            return value;
        }
        const code:'runtime-error'|'non-finite-result' = outcome.code;
        // @ts-expect-error error outcomes do not carry a value to coerce to true
        void outcome.value;
        void code;
        return null;
    }
    // @ts-expect-error unsupported/invalid compilation never exposes a partial formula
    void result.formula;
    return null;
}
// @ts-expect-error incomplete-condition omission always requires an explicit finite mode
const invalidMode:CompileRuntimeConditionsInput['invalidConditionMode'] = 'loose';
// @ts-expect-error canonical condition AST has AND/OR groups, not an invented NOT group
const notGroup:RuntimeConditionsDefinition['logicalOperator'] = 'not';
// @ts-expect-error compilation does not accept backend permission grants
compileRuntimeConditions({...readonlyInput,permission:true});
// @ts-expect-error compilation does not accept arbitrary execution callbacks
compileRuntimeConditions({...readonlyInput,evaluate:()=>true});
// @ts-expect-error omission behavior cannot be selected by leaving the mode absent
compileRuntimeConditions({conditions:null,airtableFields:[]});
// @ts-expect-error diagnostics preserve readonly location paths
compileRuntimeConditions(readonlyInput).diagnostics[0]?.path.push(0);
void [invalidMode,notGroup,narrow(compileRuntimeConditions(readonlyInput))];
`;

/** Check the real installed ESM/CommonJS exports and their shipped types. */
export function checkFormConditions({ consumerDirectory, run, typescriptBin }) {
    let checks = 0;
    for (const [filename, imports] of [
        [
            'form-conditions-consumer.mjs',
            "import assert from 'node:assert/strict';\nimport { compileRuntimeConditions } from '@miniextensions/sdk/forms';\nimport { FormulaRunner, AIRTABLE_FORMULA_ERROR_VALUE } from '@miniextensions/sdk/formulas';\n",
        ],
        [
            'form-conditions-consumer.cjs',
            "const assert = require('node:assert/strict');\nconst { compileRuntimeConditions } = require('@miniextensions/sdk/forms');\nconst { FormulaRunner, AIRTABLE_FORMULA_ERROR_VALUE } = require('@miniextensions/sdk/formulas');\n",
        ],
    ]) {
        writeFileSync(
            join(consumerDirectory, filename),
            imports + runtimeConsumer
        );
        const result = JSON.parse(run(process.execPath, [filename]));
        assert.equal(result.checks, result.cases.length);
        assert.equal(new Set(result.cases).size, result.checks);
        assert(result.checks > 0);
        checks += result.checks;
    }
    for (const [filename, module, moduleResolution] of [
        ['form-conditions-consumer.mts', 'NodeNext', 'NodeNext'],
        ['form-conditions-consumer.cts', 'NodeNext', 'NodeNext'],
        ['form-conditions-browser-consumer.ts', 'ESNext', 'Bundler'],
    ]) {
        writeFileSync(join(consumerDirectory, filename), declarationConsumer);
        run(process.execPath, [
            typescriptBin,
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            'false',
            '--target',
            'ES2022',
            '--module',
            module,
            '--moduleResolution',
            moduleResolution,
            filename,
        ]);
    }
    return { checks, typedConsumers: 3 };
}
