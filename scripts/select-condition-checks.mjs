import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const fixture = JSON.parse(
    readFileSync('test/fixtures/selectConditions.json', 'utf8')
);
const acceptance = JSON.parse(
    readFileSync('test/fixtures/selectConditionAcceptance.json', 'utf8')
);
const verify = `
const compiledIds = new Set(acceptance.compiledIds), refusedIds = new Set(acceptance.refusedIds);
assert.equal(compiledIds.size,390);assert.equal(refusedIds.size,42);
assert.deepEqual([...compiledIds,...refusedIds].sort(),fixture.cases.map(c=>c.input.name).sort());
let checks = 0;
const compile = (conditions, fields, mode='strict') => compileRuntimeConditions({conditions,airtableFields:fields,invalidConditionMode:mode});
for (const {input,formula,serialized} of fixture.cases) {
 const before=JSON.stringify(input);
 const result=compile(input.conditions,[input.field]);
 if (compiledIds.has(input.name)) {
  assert.equal(result.type,'compiled',input.name);
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
  assert(refusedIds.has(input.name),'unlisted refusal '+input.name);
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
  // Direct multi-select null/empty arrays now have canonical false membership;
  // single-select arrays retain their malformed-value refusal.
  assert.equal(evaluateFormFieldVisibility({...input,field:target}).type,type==='multipleSelects'||value===null?'hidden':'blocked');
  for(const project of [createFlatScalarFormRecordProjection,createScalarFormRecordProjection]) assert.equal(project({fieldIds:['target'],fieldIdsToSchemas:{target},airtableFields:input.airtableFields,data,recordId:'rec',invalidConditionMode:'strict'}).type,'blocked');
  const optionField={fieldType:'singleSelect',airtableField:{...base,id:'option',name:'Option'},miniExtConfig:{enableConditionalOptions:true,conditionsForOptions:[{config:{optionForConditions:'sel_a',conditionsForOption:conditions}}]}};
  const availability=resolveSelectFieldAvailability({field:optionField,airtableFields:input.airtableFields,recordForConditionEvaluation:{id:'rec',fields:data},mode:'runtime',invalidConditionMode:'strict'});
  assert.equal(availability.status,'blocked'); assert.equal(availability.diagnostics[0].code,'unsupported-condition');checks++;
 }
}
for(const logicalOperator of ['and','or']) for(const mode of ['strict','compatibility']) for(const op of ['is','isNot']) {
 const invalid=def('singleSelect',op,[]).conditions[0];
 const valid=def('singleSelect','is','sel_a').conditions[0];
 const r=compile({logicalOperator,conditions:[invalid,valid]},[base],mode);
 assert.equal(r.type,'invalid');assert(r.diagnostics.some(d=>d.code==='invalid-operand'&&d.severity==='error'));assert(!r.diagnostics.some(d=>d.code==='incomplete-condition'));assert(!Object.hasOwn(r,'formula'));checks++;
}
// Independent truth tables. These assert membership results, not only value
// outcomes, and run against actual installed ESM and CommonJS engines.
for(const names of [['Alpha','Beta','Alphabet'],['comma, value','double "quote"','emoji 🦋']]) {
 const choices=names.map((name,index)=>({id:['a','b','c'][index],name}));
 for(const type of ['singleSelect','multipleSelects']) {
  const field={...base,config:{type,options:{choices}}};
  const records=type==='singleSelect'?[names[0],names[1],names[2],null,'','Unknown']:[null,[],[names[0]],[names[1]],[names[0],names[1]],[names[0],names[1],names[2]],[names[2]],[names[1],names[0]],[names[0],names[0]]];
  const table=type==='singleSelect'?[
   ['is','a',[true,false,false,false,false,false]],
   ['isNot','a',[false,true,true,true,true,true]],
   ['isAnyOf',['a','b'],[true,true,false,false,false,false]],
   ['isNoneOf',['a','b'],[false,false,true,true,true,true]],
   ['isEmpty',undefined,[false,false,false,true,true,false]],
   ['isNotEmpty',undefined,[true,true,true,false,false,true]]
  ]:[
   ['hasAnyOf',['a','b'],[false,false,true,true,true,true,false,true,true]],
   ['hasAllOf',['a','b'],[false,false,false,false,true,true,false,true,false]],
   ['hasNoneOf',['a','b'],[true,true,false,false,false,false,true,false,false]],
   ['isExactly',['a','b'],[false,false,false,false,true,false,false,true,false]],
   ['isEmpty',undefined,[true,true,false,false,false,false,false,false,false]],
   ['isNotEmpty',undefined,[false,false,true,true,true,true,true,true,true]]
  ];
  for(const [op,operand,expected] of table) {
   const compiled=compile(def(type,op,operand),[field]);assert.equal(compiled.type,'compiled');
   for(let index=0;index<records.length;index++) {
    const runner=new FormulaRunner(compiled.formula);runner.context={record:{id:'rec',fields:{fld_choice:records[index]}},airtableFields:[field],linkedTableLoadingStates:{}};
    const outcome=runner.runWithOutcome();assert.equal(outcome.type,'value');assert.equal(!FormulaRunner.isFalsyValue(outcome.value),expected[index],type+'/'+op+'/'+index);checks++;
   }
  }
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
            `importPLACEHOLDER\nconst fixture=${JSON.stringify(fixture)}; const acceptance=${JSON.stringify(acceptance)};\n${verify}`.replace(
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
