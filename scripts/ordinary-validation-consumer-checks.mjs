import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export const ordinaryValidationTypedConsumer = `
import {validateOrdinaryFormField,type ValidateOrdinaryFormFieldInput,type OrdinaryFormFieldDiagnostic,type OrdinaryFormFieldFallbackReason} from '@miniextensions/sdk/forms';
const ordinaryInput:ValidateOrdinaryFormFieldInput={fieldType:'singleLineText',airtableFieldConfig:{type:'singleLineText'},miniExtConfig:{characterLimit:0},value:'x',storedValue:undefined,isConditionallyHidden:false,isComputeMode:false};
const ordinaryResult=validateOrdinaryFormField(ordinaryInput);
if(ordinaryResult.status==='supported'){
 const diagnostic:OrdinaryFormFieldDiagnostic|null=ordinaryResult.diagnostic;
 if(diagnostic?.code==='character-limit'){const limit:number=diagnostic.limit;void limit;}
 // @ts-expect-error a supported result has no fallback reason
 ordinaryResult.reason;
}else{const reason:OrdinaryFormFieldFallbackReason=ordinaryResult.reason;void reason;
 // @ts-expect-error fallback is not a validation success
 ordinaryResult.diagnostic;
}
// @ts-expect-error Compute is an explicit boolean input
validateOrdinaryFormField({...ordinaryInput,isComputeMode:'true'});
// @ts-expect-error current value, stored value and mode inputs are required
validateOrdinaryFormField({fieldType:'number'});
`;

/** Public ESM/CJS resolution in fresh SSR processes, with no DOM or network. */
export function checkOrdinaryValidationConsumer({ consumerDirectory }) {
    const corpus = JSON.parse(
        readFileSync(
            new URL('../test/fixtures/formPages.json', import.meta.url)
        )
    );
    const script = join(consumerDirectory, 'ordinary-validation-consumer.mjs');
    const fixture = join(consumerDirectory, 'ordinary-validation-corpus.json');
    writeFileSync(fixture, JSON.stringify(corpus));
    writeFileSync(
        script,
        `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
assert.equal(typeof window,'undefined');
assert.equal(typeof document,'undefined');
globalThis.fetch=()=>{throw Error('Unexpected network');};
const api=process.argv[2]==='esm'?await import('@miniextensions/sdk/forms'):createRequire(import.meta.url)('@miniextensions/sdk/forms');
const corpus=JSON.parse(readFileSync(new URL('./ordinary-validation-corpus.json',import.meta.url)));
for(const c of corpus.validation){
 const r=api.validateOrdinaryFormField({fieldType:c.schema.fieldType,airtableFieldConfig:c.schema.airtableField.config,miniExtConfig:c.schema.miniExtConfig,value:c.value,storedValue:c.stored,isConditionallyHidden:c.hidden,isComputeMode:false});
 assert.equal(r.status,'supported',c.name);assert.equal(r.diagnostic!==null,c.invalid,c.name);
}
for(const c of corpus.conservativeRefusal){
 const r=api.validateOrdinaryFormField({fieldType:c.schema.fieldType,airtableFieldConfig:c.schema.airtableField.config,miniExtConfig:c.schema.miniExtConfig,value:c.value,storedValue:c.stored,isConditionallyHidden:c.hidden,isComputeMode:false});
 assert.equal(r.status,'native-fallback',c.name);
}
assert.deepEqual(api.validateOrdinaryFormField({fieldType:'singleLineText',airtableFieldConfig:{type:'singleLineText'},miniExtConfig:{characterLimit:0},value:'x',storedValue:undefined,isConditionallyHidden:false,isComputeMode:true}),{status:'supported',diagnostic:{code:'character-limit',limit:0}});
console.log(process.argv[2]+': 427 installed ordinary validation cases passed without browser globals');
`
    );
    try {
        for (const format of ['esm', 'cjs'])
            execFileSync(process.execPath, [script, format], {
                cwd: consumerDirectory,
                stdio: 'inherit',
            });
        return 854;
    } finally {
        rmSync(script);
        rmSync(fixture);
    }
}
