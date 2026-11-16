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
`;
    for (const extension of ['mjs', 'cjs']) {
        const imports =
            extension === 'mjs'
                ? `import assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nimport {createLinkedFormRecordProjection as project} from '@miniextensions/sdk/forms';\n`
                : `const assert=require('node:assert/strict');\nconst {readFileSync}=require('node:fs');\nconst {createLinkedFormRecordProjection:project}=require('@miniextensions/sdk/forms');\n`;
        const filename = `linked-projection-consumer.${extension}`;
        writeFileSync(join(consumerDirectory, filename), imports + body);
        run(process.execPath, [filename]);
    }
    assert.equal(fixture.passes.length, 3);
    return { formats: 2, comparisons: 156, refusals: 12 };
}
