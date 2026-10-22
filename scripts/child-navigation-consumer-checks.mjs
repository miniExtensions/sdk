import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const childNavigationTypedConsumer = `
import {findAdjacentChildSession,type AdjacentChildNavigationContext,type AdjacentChildNavigationInput} from '@miniextensions/sdk/ui';
const navigationOrigin:AdjacentChildNavigationContext={type:'modal',recordId:'current',parentFormExtensionSessionId:'parent',fieldIdOfLinkedRecordField:'links',linkedTableIdOfLinkedRecordField:'table',parentExtensionAccessToken:'token',childExtensionAccessInfo:{childExtensionId:'child'},nextRecordId:'next'};
const navigationInput:AdjacentChildNavigationInput={sourceExtensionSessionId:'origin',type:'next',recordId:'next'};
const navigationResult:string|null=findAdjacentChildSession(Object.freeze({origin:navigationOrigin,target:{...navigationOrigin,recordId:'next'}}),navigationInput);
// @ts-expect-error only actual adjacent directions are accepted
findAdjacentChildSession({origin:navigationOrigin},{...navigationInput,type:'later'});
// @ts-expect-error source session identity is required
findAdjacentChildSession({origin:navigationOrigin},{type:'next',recordId:'next'});
// @ts-expect-error context record identity remains text or null
findAdjacentChildSession({origin:{...navigationOrigin,recordId:17}},navigationInput);
void navigationResult;
`;
export async function checkChildNavigationConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'child-navigation-public.mjs');
    writeFileSync(
        loader,
        "export {findAdjacentChildSession} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const child = (recordId, type = 'modal') => ({
        type,
        recordId,
        parentFormExtensionSessionId: 'parent',
        fieldIdOfLinkedRecordField: 'links',
        linkedTableIdOfLinkedRecordField: 'table',
        parentExtensionAccessToken: 'token',
        childExtensionAccessInfo: { childExtensionId: 'child' },
        nextRecordId: 'next',
        previousRecordId: 'previous',
    });
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        for (const type of ['modal', 'side-panel', 'form-layout'])
            for (const direction of ['next', 'previous']) {
                const origin = Object.freeze(child('current', type));
                const target = Object.freeze({
                    ...child(direction, type),
                    get privateNativePayload() {
                        throw new Error('PRIVATE_NATIVE');
                    },
                });
                const input = {
                    sourceExtensionSessionId: 'origin',
                    type: direction,
                    recordId: direction,
                };
                const contexts = Object.freeze({
                    origin,
                    target,
                    direct: Object.freeze({ type: 'direct-url' }),
                });
                assert.equal(
                    api.findAdjacentChildSession(contexts, input),
                    'target'
                );
                assert.equal(
                    api.findAdjacentChildSession(
                        { origin, target, duplicate: target },
                        input
                    ),
                    null
                );
                assert.equal(
                    api.findAdjacentChildSession({ target }, input),
                    null
                );
                assert.equal(
                    api.findAdjacentChildSession(contexts, {
                        ...input,
                        recordId: 'wrong',
                    }),
                    null
                );
                for (const patch of [
                    { parentFormExtensionSessionId: 'other' },
                    { fieldIdOfLinkedRecordField: 'other' },
                    { linkedTableIdOfLinkedRecordField: 'other' },
                    { parentExtensionAccessToken: 'other' },
                    { childExtensionAccessInfo: { childExtensionId: 'other' } },
                    {
                        prefillDataForLinkedRecordsForm: {
                            toLinkToParent: {
                                parentFormRecordId: 'other',
                                reversedFieldIdToPrefill: 'reverse',
                            },
                        },
                    },
                ]) {
                    // Build owner metadata directly; spreading target would itself
                    // invoke the intentionally throwing private-payload getter.
                    const foreign = { ...child(direction, type), ...patch };
                    assert.equal(
                        api.findAdjacentChildSession(
                            { origin, target, foreign },
                            input
                        ),
                        'target'
                    );
                    assert.equal(
                        api.findAdjacentChildSession(
                            { origin, foreign },
                            input
                        ),
                        null
                    );
                }
                assert.equal(
                    api.findAdjacentChildSession(
                        { origin: { type: 'direct-url' }, target },
                        input
                    ),
                    null
                );
                assert.equal(target.recordId, direction);
            }
    }
    console.log(
        'Installed adjacent-child compatibility: public ESM/CommonJS owner collisions, declared order, ambiguity, immutable native contexts and strict NodeNext/Bundler declarations passed; no client, request or writer.'
    );
    return 2;
}
