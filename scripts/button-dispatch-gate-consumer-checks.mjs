import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const buttonDispatchGateTypedConsumer = `
import {createButtonDispatchGate,type ButtonDispatchGate,type ButtonDispatchGateOptions} from '@miniextensions/sdk/ui';
const buttonGateOptions:ButtonDispatchGateOptions={isCurrent:()=>true,canTrigger:()=>true,dispatch:async()=>{},pendingChanged:(pending:boolean)=>{void pending;}};
const buttonGate:ButtonDispatchGate=createButtonDispatchGate(buttonGateOptions);
const buttonAdmission:Promise<boolean>=buttonGate.run();
buttonGate.dispose();
// @ts-expect-error current committed ownership is required
createButtonDispatchGate({canTrigger:()=>true,dispatch:async()=>{}});
// @ts-expect-error availability is boolean, not a server permission object
createButtonDispatchGate({...buttonGateOptions,canTrigger:()=>({allowed:true})});
// @ts-expect-error dispatch must expose its asynchronous host settlement
createButtonDispatchGate({...buttonGateOptions,dispatch:()=>true});
// @ts-expect-error this gate never owns transport cancellation
buttonGate.cancel();
// @ts-expect-error no fabricated client or accepted Form owner is requested
createButtonDispatchGate({...buttonGateOptions,client:{}});
void buttonAdmission;
`;

export async function checkButtonDispatchGateConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'button-dispatch-gate-public.mjs');
    writeFileSync(
        loader,
        "export {createButtonDispatchGate} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        const events = [];
        let requests = 0;
        let gate;
        const error = new Error('synthetic host failure');
        const nested = [];
        gate = api.createButtonDispatchGate({
            isCurrent: () => true,
            canTrigger: () => true,
            pendingChanged: (pending) => {
                events.push(pending);
                nested.push(gate.run());
            },
            dispatch: async () => {
                requests++;
                if (requests === 1) throw error;
            },
        });
        await assert.rejects(gate.run(), (cause) => cause === error);
        assert.equal(await gate.run(), true);
        assert.deepEqual(events, [true, false, true, false]);
        assert.equal(requests, 2);
        assert.ok(
            (await Promise.all(nested)).every((value) => value === false)
        );
        gate.dispose();
        assert.equal(await gate.run(), false);

        let release;
        const held = new Promise((resolve) => {
            release = resolve;
        });
        const pending = [];
        const allocated = api.createButtonDispatchGate({
            isCurrent: () => true,
            canTrigger: () => true,
            dispatch: () => held,
            pendingChanged: (busy) => pending.push(busy),
        });
        const running = allocated.run();
        assert.equal(await allocated.run(), false);
        allocated.dispose();
        release();
        assert.equal(await running, true);
        assert.deepEqual(pending, [true]);
        assert.equal(await allocated.run(), false);

        let current = false;
        let calls = 0;
        const retired = api.createButtonDispatchGate({
            isCurrent: () => current,
            canTrigger: () => true,
            dispatch: async () => {
                calls++;
            },
        });
        assert.equal(await retired.run(), false);
        current = true;
        assert.equal(await retired.run(), false);
        assert.equal(calls, 0);
    }
    console.log(
        'Installed Button dispatch gate: ESM/CommonJS retry, reentrant singleflight, permanent owner retirement and allocated settlement passed; strict NodeNext/Bundler declarations included.'
    );
    return 2;
}
