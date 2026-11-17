import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Included in the normal installed .mts/.cts/Bundler declaration consumers.
export const linkedProjectionTypedConsumer = `
import {
    createLinkedFormRecordProjection as publicLinkedProjection,
    type CreateLinkedFormRecordProjectionInput as PublicLinkedProjectionInput,
    type LinkedFormRecordProjection as PublicLinkedProjectionResult,
    type LinkedFormProjectionDiagnostic as PublicLinkedProjectionDiagnostic,
    type FormProjectionLinkedFilters as PublicLinkedProjectionFilters,
    type FormProjectionLinkedTableStates as PublicLinkedProjectionStates,
    createNonLinkedFormRecordProjection as publicNonLinkedProjection,
    type CreateNonLinkedFormRecordProjectionInput as PublicNonLinkedProjectionInput,
    type NonLinkedFormRecordProjection as PublicNonLinkedProjectionResult,
} from '@miniextensions/sdk/forms';
import type { RuntimeFormRecord as PublicLinkedProjectionRecord } from '@miniextensions/sdk';
export function consumePublicLinkedProjection(snapshot: PublicLinkedProjectionInput) {
    const filters: PublicLinkedProjectionFilters = snapshot.conditionalLinkedRecordFieldIdsToFilteringValues;
    const states: PublicLinkedProjectionStates = snapshot.linkedTableLoadingStates;
    const result: PublicLinkedProjectionResult = publicLinkedProjection(snapshot);
    if (result.type === 'available') {
        const record: PublicLinkedProjectionRecord = result.formRecord;
        const hidden: readonly string[] = result.hiddenFieldIds;
        // JSON normalization does not preserve a caller-specific narrowed record.
        // @ts-expect-error An output record does not promise arbitrary metadata.
        const narrowed: { metadata: { literal: 1 } } = result.formRecord;
        void record; void hidden; void narrowed;
    } else {
        const diagnostics: readonly PublicLinkedProjectionDiagnostic[] = result.diagnostics;
        // @ts-expect-error A blocked projection never exposes partial output.
        result.formRecord;
        void diagnostics;
    }
    // @ts-expect-error The accepted snapshot data is readonly.
    snapshot.formRecord.data.changed = true;
    // @ts-expect-error Compatibility is explicit, not an arbitrary profile.
    publicLinkedProjection({...snapshot, compatibility: 'other'});
    void filters; void states;
}
export function consumePublicNonLinkedProjection(snapshot: PublicNonLinkedProjectionInput) {
    const result: PublicNonLinkedProjectionResult = publicNonLinkedProjection(snapshot);
    if (result.type === 'available') {
        const record: PublicLinkedProjectionRecord = result.formRecord;
        const hidden: readonly string[] = result.hiddenFieldIds;
        // @ts-expect-error JSON normalization does not preserve arbitrary metadata.
        const narrowed: { metadata: { literal: 1 } } = result.formRecord;
        void record; void hidden; void narrowed;
    } else {
        const diagnostics: readonly PublicLinkedProjectionDiagnostic[] = result.diagnostics;
        // @ts-expect-error A blocked projection never exposes partial output.
        result.formRecord;
        void diagnostics;
    }
    // @ts-expect-error The nonlinked public input omits linked loading state.
    snapshot.linkedTableLoadingStates;
    // @ts-expect-error The nonlinked public input omits linked filtering state.
    snapshot.conditionalLinkedRecordFieldIdsToFilteringValues;
    // @ts-expect-error The accepted snapshot data is readonly.
    snapshot.formRecord.data.changed = true;
    // @ts-expect-error Compatibility remains an explicit finite policy.
    publicNonLinkedProjection({...snapshot, compatibility: 'other'});
    // @ts-expect-error Linked state cannot be silently discarded by this API.
    publicNonLinkedProjection({...snapshot, linkedTableLoadingStates: {}});
    // @ts-expect-error Linked filters cannot be silently discarded by this API.
    publicNonLinkedProjection({...snapshot, conditionalLinkedRecordFieldIdsToFilteringValues: {}});
}
`;

/** Actual TGZ public exports in fresh Node ESM/CJS processes, without DOM. */
export function checkLinkedProjectionConsumer({ consumerDirectory, run }) {
    const fixture = JSON.parse(
        readFileSync('test/fixtures/linkedProjection.json', 'utf8')
    );
    writeFileSync(
        join(consumerDirectory, 'linked-projection-native.json'),
        JSON.stringify(fixture)
    );
    const body = `
if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('Expected a server consumer');
const fixture = JSON.parse(readFileSync('linked-projection-native.json', 'utf8'));
const freeze = value => {if(value && typeof value === 'object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
let comparisons=0, refusals=0;
for(const pass of fixture.passes) for(const entry of pass.cases){
    const input=freeze(entry.input);
    const before=structuredClone(input);
    const result=project(input);
    if(entry.nativeFallbackReason){
        assert.deepEqual(result,{type:'blocked',code:entry.nativeFallbackReason,diagnostics:[{code:entry.nativeFallbackReason}]});
        refusals++;
    }else{
        assert.equal(result.type,'available');
        assert.deepEqual(result.formRecord,entry.expected.formRecord);
        assert.deepEqual(result.hiddenFieldIds,entry.expected.hiddenFieldIds);
        comparisons++;
    }
    assert.deepEqual(input,before);
}
assert.equal(comparisons,78); assert.equal(refusals,6);
console.log(JSON.stringify({comparisons,refusals,source:'installed public forms export; native snapshot corpus, no live Form/Save claim'}));

// A second independent finite corpus uses only the installed public API. Each
// family has visible/hidden witnesses in both native create and edit records.
const choiceMetadata=[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}];
const physical=(type='singleLineText')=>({id:'driver',name:'driver',description:null,isComputed:false,isPrimaryField:false,config:{type,options:type==='singleLineText'?null:type==='singleSelect'||type==='multipleSelects'?{choices:structuredClone(choiceMetadata)}:type==='currency'?{precision:2,symbol:'$'}:type==='rating'?{max:10,icon:'star',color:'yellowBright'}:{precision:2}}});
const computed=type=>({...physical(),isComputed:true,config:{type:'formula',options:{isValid:true,referencedFieldIds:['unavailable-source'],result:{type,options:type==='singleLineText'?null:type==='currency'?{precision:2,symbol:'$'}:{precision:2}}}}});
const rule=(fieldType,operator,operand)=>({logicalOperator:'and',conditions:[{id:'synthetic-condition',type:'singleCondition',setting:{fieldType,type:operator,value:operand,idOrName:{type:'id',id:'driver'}}}]});
const schema=(field,miniExtConfig={})=>({fieldType:field.config.type,airtableField:field,miniExtConfig});
const makeInput=(driver,definition,value,type='edit')=>{
    const target={...physical(),id:'target',name:'target'};
    const formRecord={type,...(type==='edit'?{recordId:'synthetic-output',tableId:'synthetic-table'}:{}),metadata:{retained:['value']},data:{driver:value,target:'Retained answer'}};
    return {compatibility:'native-form-v1',formRecord,formFields:[schema(driver),schema(target,{conditionalFields:definition})],airtableFields:[driver,target]};
};
const families=[];
for(const [operator,operand,yes,no] of [
    ['is','a','Alpha','Beta'],['isNot','a','Beta','Alpha'],
    ['isAnyOf',['a'],'Alpha','Beta'],['isNoneOf',['a'],'Beta','Alpha'],
    ['isEmpty',null,null,'Alpha'],['isNotEmpty',null,'Alpha',null],
]) families.push({driver:physical('singleSelect'),fieldType:'singleSelect',operator,operand,yes,no});
for(const [operator,operand,yes,no] of [
    ['hasAllOf',['a','b'],['Alpha','Beta'],['Alpha']],
    ['hasAnyOf',['a'],['Alpha'],['Beta']],
    ['hasNoneOf',['a'],['Beta'],['Alpha']],
    ['isExactly',['a'],['Alpha'],['Alpha','Beta']],
    ['isEmpty',null,[],['Alpha']],['isNotEmpty',null,['Alpha'],[]],
]) families.push({driver:physical('multipleSelects'),fieldType:'multipleSelects',operator,operand,yes,no});
for(const fieldType of ['number','percent','currency','rating'])
    for(const [operator,yes,no] of [
        ['equals',5,4],['notEquals',4,5],['greaterThan',6,5],['lessThan',4,5],
        ['greaterThanOrEqualsTo',5,4],['lessThanOrEqualsTo',5,6],
        ['isEmpty',fieldType==='rating'?0:null,1],['isNotEmpty',1,fieldType==='rating'?0:null],
    ]) families.push({driver:physical(fieldType),fieldType,operator,operand:fieldType==='percent'?500:5,yes,no});
assert.equal(families.length,44);
for(const fieldType of ['singleLineText','number','percent','currency'])
    families.push({driver:computed(fieldType),fieldType,operator:fieldType==='singleLineText'?'is':'equals',operand:fieldType==='singleLineText'?'ready':fieldType==='percent'?50:5,yes:fieldType==='singleLineText'?'ready':fieldType==='percent'?0.5:5,no:fieldType==='singleLineText'?'waiting':4});
families.push({driver:physical(),fieldType:'singleLineText',operator:'is',operand:'ready',yes:'ready',no:'waiting'});
assert.equal(families.length,49);
let nonLinkedComparisons=0,nonLinkedRefusals=0;
const refuse=input=>{
    const before=structuredClone(input);
    const result=projectNonLinked(freeze(input));
    assert.equal(result.type,'blocked');
    assert.deepEqual(result.diagnostics,[{code:result.code}]);
    assert.equal(Object.hasOwn(result,'formRecord'),false);
    assert.equal(Object.hasOwn(result,'hiddenFieldIds'),false);
    assert.deepEqual(input,before);
    nonLinkedRefusals++;
};
for(const family of families) for(const type of ['create','edit']) for(const visible of [true,false]){
    const input=freeze(makeInput(structuredClone(family.driver),rule(family.fieldType,family.operator,family.operand),structuredClone(visible?family.yes:family.no),type));
    const before=structuredClone(input);
    const expected=JSON.parse(JSON.stringify(input.formRecord));
    if(!visible)delete expected.data.target;
    const result=projectNonLinked(input);
    assert.equal(result.type,'available');
    assert.deepEqual(result.formRecord,expected);
    assert.deepEqual(result.hiddenFieldIds,visible?[]:['target']);
    assert.deepEqual(input,before);
    assert.notEqual(result.formRecord,input.formRecord);
    assert.notEqual(result.formRecord.data,input.formRecord.data);
    nonLinkedComparisons++;
}
assert.equal(nonLinkedComparisons,196);
const ordinary=()=>makeInput(physical('number'),rule('number','equals',5),5);
refuse({...ordinary(),linkedTableLoadingStates:{}});
refuse({...ordinary(),conditionalLinkedRecordFieldIdsToFilteringValues:{}});
refuse({...ordinary(),compatibility:'other'});
const named=ordinary(); named.formFields[1].miniExtConfig.conditionalFields.conditions[0].setting.idOrName={type:'name',name:'driver'};refuse(named);
const mixed=ordinary();mixed.formFields[1].miniExtConfig.conditionalFields.conditions.push(...rule('number','matchesRegex','.*').conditions);refuse(mixed);
for(const [fieldType,value] of [['singleLineText',5],['number','5'],['number',NaN],['number',Infinity]])refuse(makeInput(computed(fieldType),rule(fieldType,fieldType==='singleLineText'?'is':'equals',fieldType==='singleLineText'?'ready':5),value));
const mismatch=makeInput(physical('singleSelect'),rule('singleSelect','is','a'),'Alpha');mismatch.formFields=structuredClone(mismatch.formFields);mismatch.formFields[0].airtableField.config.options.choices[0].name='Changed';refuse(mismatch);
assert.equal(nonLinkedRefusals,10);
const cloneInput=ordinary();cloneInput.formRecord.omitted=undefined;cloneInput.formRecord.metadata={retained:['value'],omitted:undefined};cloneInput.formRecord.data.zero=-0;cloneInput.formRecord.data.nonfinite=NaN;
const cloneBefore=structuredClone(cloneInput);const cloned=projectNonLinked(freeze(cloneInput));assert.equal(cloned.type,'available');assert.equal(Object.hasOwn(cloned.formRecord,'omitted'),false);assert.equal(Object.hasOwn(cloned.formRecord.metadata,'omitted'),false);assert.equal(Object.is(cloned.formRecord.data.zero,-0),false);assert.equal(cloned.formRecord.data.nonfinite,null);cloned.formRecord.metadata.retained.push('output-only');assert.deepEqual(cloneInput,cloneBefore);
const legacy=rule('singleLineText','is','ready');assert.equal(compileSelect(legacy,[physical()]).type,'native');
for(const driver of [physical('singleSelect'),computed('number')]){
    const select=driver.config.type==='singleSelect';const definition=rule(select?'singleSelect':'number',select?'is':'equals',select?'a':5);const input=makeInput(driver,definition,select?'Alpha':5);
    const oldInput={fieldIds:input.formFields.map(field=>field.airtableField.id),fieldIdsToSchemas:Object.fromEntries(input.formFields.map(field=>[field.airtableField.id,field])),airtableFields:input.airtableFields,data:input.formRecord.data,recordId:'synthetic-output',invalidConditionMode:'strict'};
    assert.equal(legacyScalar(oldInput).type,'blocked');assert.equal(legacyFlat(oldInput).type,'blocked');
    if(!select)assert.equal(publicCompile({conditions:definition,airtableFields:[driver],invalidConditionMode:'strict'}).type,'unsupported');
}
console.log(JSON.stringify({nonLinkedPairFamilies:families.length,nonLinkedComparisons,nonLinkedRefusals,clone:true,legacy:true,source:'installed public nonlinked forms export; no private imports, DOM or Form/Save operations'}));
`;
    for (const extension of ['mjs', 'cjs']) {
        const imports =
            extension === 'mjs'
                ? `import assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nimport {createLinkedFormRecordProjection as project,createNonLinkedFormRecordProjection as projectNonLinked,createScalarFormRecordProjection as legacyScalar,createFlatScalarFormRecordProjection as legacyFlat,compileRuntimeConditions as publicCompile,compileSelectConditions as compileSelect} from '@miniextensions/sdk/forms';\n`
                : `const assert=require('node:assert/strict');\nconst {readFileSync}=require('node:fs');\nconst {createLinkedFormRecordProjection:project,createNonLinkedFormRecordProjection:projectNonLinked,createScalarFormRecordProjection:legacyScalar,createFlatScalarFormRecordProjection:legacyFlat,compileRuntimeConditions:publicCompile,compileSelectConditions:compileSelect}=require('@miniextensions/sdk/forms');\n`;
        const filename = `linked-projection-consumer.${extension}`;
        writeFileSync(join(consumerDirectory, filename), imports + body);
        run(process.execPath, [filename]);
    }
    assert.equal(fixture.passes.length, 3);
    return { formats: 2, comparisons: 156, refusals: 12 };
}
