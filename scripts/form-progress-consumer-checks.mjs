import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const formProgressTypedConsumer = `
import {createFormProgressStorage,type FormProgressValues,type FormProgressToken,type FormProgressSnapshot,type FormProgressStorageAdapter,type FormProgressLockManager,type FormProgressStorageOptions,type FormProgressStorage,type FormProgressReadResult,type FormProgressWriteResult,type FormProgressRemovalResult} from '@miniextensions/sdk/forms';
const progressValues:FormProgressValues={text:'synthetic',number:0,boolean:false,empty:null};
const progressAdapter:FormProgressStorageAdapter={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const progressLocks:FormProgressLockManager={request:async <Result,>(name:string,callback:()=>Result):Promise<Result>=>callback()};
const progressOptions:FormProgressStorageOptions={scope:'synthetic',getStorage:()=>progressAdapter,getLocks:()=>progressLocks,createId:()=> 'unique-synthetic-id',isCurrent:()=>true};
const progressStorage:FormProgressStorage=createFormProgressStorage(progressOptions);
const progressRead:FormProgressReadResult=progressStorage.read();
if(progressRead.status==='read' && progressRead.snapshot){
    const snapshot:FormProgressSnapshot=progressRead.snapshot;
    const token:FormProgressToken=snapshot.token;
    const write:Promise<FormProgressWriteResult>=progressStorage.write({expected:token,values:snapshot.values});
    const removal:Promise<FormProgressRemovalResult>=progressStorage.remove(token);
    void [write,removal];
}
void progressStorage.write({expected:null,values:progressValues});
createFormProgressStorage({...progressOptions,getStorage:()=>undefined,getLocks:()=>undefined});
progressStorage.destroy();
// @ts-expect-error arrays are not scalar progress cells
const progressArray:FormProgressValues={field:['record']};
// @ts-expect-error objects are not scalar progress cells
const progressObject:FormProgressValues={field:{id:'record'}};
// @ts-expect-error undefined is not a persisted scalar
const progressUndefined:FormProgressValues={field:undefined};
// @ts-expect-error dates are not scalar progress cells
const progressDate:FormProgressValues={field:new Date()};
// @ts-expect-error bigint is not a persisted scalar
const progressBigint:FormProgressValues={field:1n};
// @ts-expect-error both token IDs are required
progressStorage.remove({draftId:'draft'});
// @ts-expect-error expected ownership must be explicit
progressStorage.write({values:progressValues});
void [progressArray,progressObject,progressUndefined,progressDate,progressBigint];
`;

// Synthetic cooperating exclusivity only; this is not a Web Locks polyfill.
class Locks {
    tails = new Map();
    names = [];
    request(name, callback) {
        this.names.push(name);
        const pending = (this.tails.get(name) ?? Promise.resolve()).then(
            callback
        );
        this.tails.set(
            name,
            pending.catch(() => {})
        );
        return pending;
    }
    hold(name) {
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        this.request(name, () => gate);
        return release;
    }
}

function fixture() {
    const bytes = new Map();
    const calls = {
        reads: 0,
        writes: 0,
        removals: 0,
        storage: 0,
        locks: 0,
        ids: 0,
        current: 0,
    };
    const locks = new Locks();
    const scope = 'installed-synthetic-progress';
    const key = `miniExtensions-sdk:create-progress:v1:${scope}`;
    const adapter = {
        getItem(name) {
            calls.reads++;
            return bytes.get(name) ?? null;
        },
        setItem(name, value) {
            calls.writes++;
            bytes.set(name, value);
        },
        removeItem(name) {
            calls.removals++;
            bytes.delete(name);
        },
    };
    const options = {
        scope,
        getStorage() {
            calls.storage++;
            return adapter;
        },
        getLocks() {
            calls.locks++;
            return locks;
        },
        createId() {
            return `synthetic-${++calls.ids}`;
        },
        isCurrent() {
            calls.current++;
            return true;
        },
    };
    return { bytes, calls, locks, key, adapter, options };
}
function written(result) {
    assert.equal(result.status, 'written');
    return result.snapshot;
}
function read(owner) {
    const result = owner.read();
    assert.equal(result.status, 'read');
    return result.snapshot;
}
const token = { draftId: 'synthetic-draft', writeId: 'synthetic-write' };

async function qualify(create, successorCreate) {
    const f = fixture();
    const owner = create(f.options);
    assert.deepEqual(Object.values(f.calls), Array(7).fill(0));
    assert.equal(f.bytes.size, 0);
    assert.equal(f.locks.names.length, 0);
    assert.equal(read(owner), null);
    assert.equal(
        f.calls.writes + f.calls.removals + f.calls.ids + f.calls.locks,
        0
    );

    const values = {
        text: 'synthetic',
        number: -1.25,
        zero: 0,
        yes: true,
        no: false,
        empty: null,
    };
    const release = f.locks.hold(f.key);
    const pending = owner.write({ expected: null, values });
    values.text = 'caller mutation while queued';
    assert.equal(f.calls.writes, 0);
    release();
    const first = written(await pending);
    assert.deepEqual(first.values, {
        text: 'synthetic',
        number: -1.25,
        zero: 0,
        yes: true,
        no: false,
        empty: null,
    });
    const expectedFirst = structuredClone(first);
    const firstBytes = f.bytes.get(f.key);
    first.values.text = 'returned snapshot mutation';
    first.token.writeId = 'returned token mutation';
    const detached = read(owner);
    assert.deepEqual(detached, expectedFirst);
    detached.values.text = 'read mutation';
    detached.token.draftId = 'read token mutation';
    assert.deepEqual(read(owner), expectedFirst);
    assert.equal(f.bytes.get(f.key), firstBytes);

    // Continue using the exact token through the opposite installed format.
    const successor = successorCreate(f.options);
    const second = written(
        await successor.write({
            expected: expectedFirst.token,
            values: { text: 'successor' },
        })
    );
    assert.equal(second.token.draftId, expectedFirst.token.draftId);
    assert.notEqual(second.token.writeId, expectedFirst.token.writeId);
    const successorBytes = f.bytes.get(f.key);
    for (const stale of [
        expectedFirst.token,
        { draftId: 'wrong-draft', writeId: second.token.writeId },
    ]) {
        assert.deepEqual(
            await owner.write({ expected: stale, values: { text: 'stale' } }),
            { status: 'conflict' }
        );
        assert.deepEqual(await owner.remove(stale), { status: 'conflict' });
        assert.equal(f.bytes.get(f.key), successorBytes);
    }
    assert.deepEqual(await owner.write({ expected: null, values: {} }), {
        status: 'conflict',
    });
    assert.equal(f.bytes.get(f.key), successorBytes);
    assert.deepEqual(await successor.remove(second.token), {
        status: 'removed',
    });
    assert.deepEqual(await successor.remove(second.token), {
        status: 'absent',
    });
    assert.equal(read(owner), null);
    assert.equal(f.bytes.size, 0);
    assert.ok(f.locks.names.every((name) => name === f.key));

    // Two independent owners compete for the same absent slot under one queue.
    const race = fixture();
    const a = create(race.options);
    const b = successorCreate(race.options);
    const results = await Promise.all([
        a.write({ expected: null, values: { winner: 'first' } }),
        b.write({ expected: null, values: { winner: 'second' } }),
    ]);
    assert.equal(results[0].status, 'written');
    assert.deepEqual(results[1], { status: 'conflict' });
    assert.deepEqual(read(b), results[0].snapshot);
    assert.equal(race.calls.writes, 1);

    for (const retirement of ['destroy', 'isCurrent']) {
        for (const operation of ['write', 'remove']) {
            const queued = fixture();
            let current = true;
            const old = create({ ...queued.options, isCurrent: () => current });
            const accepted = written(
                await old.write({
                    expected: null,
                    values: { text: 'retained' },
                })
            );
            const before = queued.bytes.get(queued.key);
            const unblock = queued.locks.hold(queued.key);
            const work =
                operation === 'write'
                    ? old.write({
                          expected: accepted.token,
                          values: { text: 'late' },
                      })
                    : old.remove(accepted.token);
            if (retirement === 'destroy') old.destroy();
            else current = false;
            const callsBefore = { ...queued.calls };
            unblock();
            assert.deepEqual(await work, { status: 'retired' });
            assert.equal(queued.bytes.get(queued.key), before);
            for (const name of [
                'storage',
                'reads',
                'writes',
                'removals',
                'ids',
            ])
                assert.equal(queued.calls[name], callsBefore[name]);
            current = true;
            assert.deepEqual(old.read(), { status: 'retired' });
            assert.deepEqual(
                await old.write({ expected: accepted.token, values: {} }),
                { status: 'retired' }
            );
            assert.deepEqual(await old.remove(accepted.token), {
                status: 'retired',
            });
        }
    }

    for (const getLocks of [
        () => undefined,
        () => {
            throw Error('synthetic denied');
        },
        () => ({
            request: async () => {
                throw Error('synthetic denied');
            },
        }),
    ]) {
        const denied = fixture();
        const writer = create(denied.options);
        const existing = written(
            await writer.write({
                expected: null,
                values: { text: 'preserved' },
            })
        );
        const before = denied.bytes.get(denied.key);
        const blocked = create({ ...denied.options, getLocks });
        assert.deepEqual(read(blocked), existing);
        const callsBefore = { ...denied.calls };
        assert.deepEqual(
            await blocked.write({ expected: existing.token, values: {} }),
            { status: 'unavailable' }
        );
        assert.deepEqual(await blocked.remove(existing.token), {
            status: 'unavailable',
        });
        assert.equal(denied.bytes.get(denied.key), before);
        for (const name of ['storage', 'reads', 'writes', 'removals', 'ids'])
            assert.equal(denied.calls[name], callsBefore[name]);
    }

    const envelope = {
        kind: 'miniExtensions-sdk-create-progress',
        version: 1,
        ...token,
        values: {},
    };
    for (const malformed of [
        '{',
        'null',
        '[]',
        JSON.stringify({ ...envelope, version: 2 }),
        JSON.stringify({ ...envelope, values: { field: [] } }),
        JSON.stringify({ ...envelope, writeId: token.draftId }),
    ]) {
        const bad = fixture();
        bad.bytes.set(bad.key, malformed);
        const reader = create(bad.options);
        assert.deepEqual(reader.read(), { status: 'invalid' });
        assert.deepEqual(await reader.write({ expected: null, values: {} }), {
            status: 'invalid',
        });
        assert.deepEqual(await reader.remove(token), { status: 'invalid' });
        assert.equal(bad.bytes.get(bad.key), malformed);
        assert.equal(bad.calls.writes + bad.calls.removals, 0);
    }
    for (const cell of [[], {}, undefined, NaN, Infinity, 1n]) {
        const invalid = fixture();
        const writer = create(invalid.options);
        assert.deepEqual(
            await writer.write({ expected: null, values: { field: cell } }),
            { status: 'invalid' }
        );
        assert.equal(
            invalid.calls.storage + invalid.calls.locks + invalid.calls.ids,
            0
        );
        assert.equal(invalid.bytes.size, 0);
    }
    for (const failure of [
        'missing',
        'provider',
        'getItem',
        'setItem',
        'removeItem',
    ]) {
        const failed = fixture();
        const writer = create(failed.options);
        const existing = written(
            await writer.write({
                expected: null,
                values: { text: 'preserved' },
            })
        );
        const before = failed.bytes.get(failed.key);
        const denied = () => {
            throw Error('synthetic storage failure');
        };
        const adapter = { ...failed.adapter };
        if (failure.endsWith('Item')) adapter[failure] = denied;
        const blocked = create({
            ...failed.options,
            getStorage:
                failure === 'missing'
                    ? () => undefined
                    : failure === 'provider'
                      ? denied
                      : () => adapter,
        });
        if (['missing', 'provider', 'getItem'].includes(failure)) {
            assert.deepEqual(blocked.read(), { status: 'unavailable' });
            assert.deepEqual(
                await blocked.write({ expected: existing.token, values: {} }),
                { status: 'unavailable' }
            );
            assert.deepEqual(await blocked.remove(existing.token), {
                status: 'unavailable',
            });
        } else if (failure === 'setItem') {
            assert.deepEqual(
                await blocked.write({ expected: existing.token, values: {} }),
                { status: 'unavailable' }
            );
        } else {
            assert.deepEqual(await blocked.remove(existing.token), {
                status: 'unavailable',
            });
        }
        assert.equal(failed.bytes.get(failed.key), before);
    }
}

export async function checkFormProgressConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'form-progress-public.mjs');
    writeFileSync(
        loader,
        "export {createFormProgressStorage} from '@miniextensions/sdk/forms';\nexport const resolved = import.meta.resolve('@miniextensions/sdk/forms');\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const cjs = require('@miniextensions/sdk/forms');
    const installed = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    assert.equal(
        realpathSync(fileURLToPath(esm.resolved)),
        realpathSync(join(installed, 'dist/esm/forms/index.js'))
    );
    assert.equal(
        realpathSync(require.resolve('@miniextensions/sdk/forms')),
        realpathSync(join(installed, 'dist/cjs/forms/index.js'))
    );
    for (const [format, primary, successor] of [
        ['ESM', esm, cjs],
        ['CommonJS', cjs, esm],
    ]) {
        await qualify(
            primary.createFormProgressStorage,
            successor.createFormProgressStorage
        );
        console.log(
            `Installed Form progress ${format}: provenance, scalar detachment, cross-format token ownership, queued retirement and failure preservation passed (synthetic storage/locks only).`
        );
    }
    return 2;
}
