import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const fixture = JSON.parse(
    readFileSync('test/fixtures/selectConditions.json', 'utf8')
);
const verify = `
let checks = 0;
const compile = (conditions, fields, mode='strict') => compileRuntimeConditions({conditions,airtableFields:fields,invalidConditionMode:mode});
for (const {input,formula,serialized} of fixture.cases) {
 const before=JSON.stringify(input);
 const result=compile(input.conditions,[input.field]);
 if (result.type==='compiled') {
  assert.equal(result.formula,formula,input.name);
  const runner=new FormulaRunner(result.formula);
  // Complete native multi-select values use the canonical serializer, not
  // set membership or comma splitting. Exercise null and native arrays too.
  for (const value of input.field.config.type==='singleSelect' ? [null,'',input.field.config.options.choices[0].name] : [null,[],input.field.config.options.choices.map(c=>c.name)]) {
   runner.context={record:{id:'rec',fields:{fld_choice:value}},airtableFields:[input.field],linkedTableLoadingStates:{}};
   const outcome=runner.runWithOutcome();
   assert.equal(outcome.type,'value',input.name);
  }
 } else {
  assert.equal(result.type,'invalid',input.name);
  assert(result.diagnostics.some(d=>d.code==='literal-roundtrip'),input.name);
  assert(/back|quote|literal/.test(input.name),'unexpected refusal '+input.name);
 }
 assert.equal(JSON.stringify(input),before);
 checks++;
}
const base=fixture.cases[0].input.field;
const def=(type,op,value)=>({logicalOperator:'and',conditions:[{id:'one',type:'singleCondition',setting:{fieldType:type,type:op,value,idOrName:{type:'id',id:base.id}}}]});
for(const saved of ['singleSelect','multipleSelects','singleLineText']) for(const current of ['singleSelect','multipleSelects','singleLineText']) {
 if(saved===current)continue;
 const field={...base,config:{...base.config,type:current}};
 const r=compile(def(saved,'isEmpty'),[field]);assert.equal(r.type,'unsupported');assert(r.diagnostics.some(d=>d.code==='unsupported-field-type'));checks++;
}
for (const type of ['singleSelect','multipleSelects']) {
 const field={...base,config:{...base.config,type}};
 const op=type==='singleSelect'?'isAnyOf':'hasAnyOf';
 for(const value of [[null],[''],[1],[{}],new Array(1),'sel_a']) {
  const r=compile(def(type,op,value),[field]);assert.equal(r.type,'invalid');checks++;
 }
 for(const choices of [[base.config.options.choices[0],base.config.options.choices[0]],[{id:'a',name:'Same'},{id:'b',name:'Same'}],[null],new Array(1),{},null]) {
  const r=compile(def(type,op,['sel_a']),[{...field,config:{type,options:{choices}}}]);assert.equal(r.type,'invalid');checks++;
 }
 for(const value of [null,[]]) for(const selected of ['sel_a','missing']) {
  const conditions=def(type,type==='singleSelect'?'is':'hasAllOf',type==='singleSelect'?selected:[selected]);
  const target={fieldType:'singleLineText',airtableField:{...base,id:'target',name:'Target',config:{type:'singleLineText',options:null}},miniExtConfig:{conditionalFields:conditions}};
  const data={fld_choice:value,target:'preserved'};const input={airtableFields:[field,target.airtableField],data,formRecordType:'create',evaluationMode:'runtime',invalidConditionMode:'strict'};
  assert.equal(evaluateFormFieldVisibility({...input,field:target}).type,'blocked');
  for(const project of [createFlatScalarFormRecordProjection,createScalarFormRecordProjection]) assert.equal(project({fieldIds:['target'],fieldIdsToSchemas:{target},airtableFields:input.airtableFields,data,recordId:'rec',invalidConditionMode:'strict'}).type,'blocked');
  const optionField={fieldType:'singleSelect',airtableField:{...base,id:'option',name:'Option'},miniExtConfig:{enableConditionalOptions:true,conditionsForOptions:[{config:{optionForConditions:'sel_a',conditionsForOption:conditions}}]}};
  const availability=resolveSelectFieldAvailability({field:optionField,airtableFields:input.airtableFields,recordForConditionEvaluation:{id:'rec',fields:data},mode:'runtime',invalidConditionMode:'strict'});
  assert.equal(availability.status,'blocked'); assert.equal(availability.diagnostics[0].code,'unsupported-condition');checks++;
 }
}
const drift=compile(def('singleSelect','matchesRegex','.*'),[base]);assert.equal(drift.type,'unsupported');checks++;
console.log(JSON.stringify({checks}));
`;
export function checkSelectConditions({ consumerDirectory, run }) {
    let checks = 0;
    for (const [name, imports] of [
        [
            'select-conditions.mjs',
            "import {compileRuntimeConditions,evaluateFormFieldVisibility,createFlatScalarFormRecordProjection,createScalarFormRecordProjection} from '@miniextensions/sdk/forms'; import {resolveSelectFieldAvailability} from '@miniextensions/sdk/ui'; import {FormulaRunner} from '@miniextensions/sdk/formulas';",
        ],
        [
            'select-conditions.cjs',
            "const {compileRuntimeConditions,evaluateFormFieldVisibility,createFlatScalarFormRecordProjection,createScalarFormRecordProjection}=require('@miniextensions/sdk/forms'); const {resolveSelectFieldAvailability}=require('@miniextensions/sdk/ui'); const {FormulaRunner}=require('@miniextensions/sdk/formulas');",
        ],
    ]) {
        writeFileSync(
            join(consumerDirectory, name),
            `importPLACEHOLDER\nconst fixture=${JSON.stringify(fixture)};\n${verify}`.replace(
                'importPLACEHOLDER',
                name.endsWith('.cjs')
                    ? "const assert=require('node:assert/strict');" + imports
                    : "import assert from 'node:assert/strict';" + imports
            )
        );
        checks += JSON.parse(run(process.execPath, [name])).checks;
    }
    return checks;
}
