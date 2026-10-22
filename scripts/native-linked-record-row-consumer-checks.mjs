import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const nativeLinkedRecordRowsTypedConsumer = `
import {projectNativeLinkedRecordRows, type NativeLinkedRecordRow} from '@miniextensions/sdk/ui';
const nativeLinkedRecord = {id:'rec_native',fields:{primary:'Chosen label',date:new Date(),attachments:[{id:'att_native'}]}};
const nativeLinkedDisplay = {type:'loaded' as const,data:{record:nativeLinkedRecord,primaryDetailField:{stringValue:'Chosen label'}}};
const nativeLinkedRows:NativeLinkedRecordRow<typeof nativeLinkedDisplay>[]=projectNativeLinkedRecordRows(['rec_native'] as const,()=>nativeLinkedDisplay);
const nativeLinkedExact:typeof nativeLinkedDisplay=nativeLinkedRows[0].data;
const nativeLinkedDate:Date=nativeLinkedExact.data.record.fields.date;
// @ts-expect-error native IDs remain strings
projectNativeLinkedRecordRows([42],()=>nativeLinkedDisplay);
// @ts-expect-error caller projection must be an explicit resolver
projectNativeLinkedRecordRows(['rec_native'],nativeLinkedDisplay);
// @ts-expect-error opaque rich data does not become an untyped bag
const nativeLinkedWrong:number=nativeLinkedRows[0].data;
// @ts-expect-error projection does not introduce canonical write authority
nativeLinkedRows[0].setValue(['rec_other']);
// @ts-expect-error no client or draft is required or accepted
projectNativeLinkedRecordRows(['rec_native'],()=>nativeLinkedDisplay,{client:{},draft:{}});
void nativeLinkedDate; void nativeLinkedWrong;
`;

export async function checkNativeLinkedRecordRowsConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'native-linked-record-rows-public.mjs'
    );
    writeFileSync(
        loader,
        "export {projectNativeLinkedRecordRows} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        const nativeFile = new File(['native'], 'native.txt');
        const nativeRecord = {
            id: 'rec_a',
            fields: {
                primary: 'Chosen native label — 選択',
                date: new Date('2026-01-01T00:00:00Z'),
                files: [nativeFile],
            },
        };
        const display = {
            type: 'loaded',
            data: {
                record: nativeRecord,
                primaryDetailField: {
                    stringValue: nativeRecord.fields.primary,
                },
            },
        };
        const ids = Object.freeze([
            'rec_b',
            'rec_a',
            'rec_b',
            'rec_unknown',
            'rec_a',
        ]);
        const unavailable = Object.freeze({
            type: 'failed',
            errorMessage: 'Localized unavailable',
        });
        const calls = [];
        const rows = api.projectNativeLinkedRecordRows(ids, (id) => {
            calls.push(id);
            return id === 'rec_unknown' ? unavailable : display;
        });
        assert.deepEqual(
            rows.map((row) => row.recordId),
            ['rec_b', 'rec_a', 'rec_unknown']
        );
        assert.deepEqual(calls, ['rec_b', 'rec_a', 'rec_unknown']);
        assert.deepEqual(ids, [
            'rec_b',
            'rec_a',
            'rec_b',
            'rec_unknown',
            'rec_a',
        ]);
        assert.equal(rows[0].data, display);
        assert.equal(rows[0].data.data.record, nativeRecord);
        assert.equal(rows[0].data.data.record.fields.files[0], nativeFile);
        assert.equal(
            rows[0].data.data.record.fields.date,
            nativeRecord.fields.date
        );
        assert.equal(
            rows[0].data.data.primaryDetailField.stringValue,
            'Chosen native label — 選択'
        );
        assert.equal(rows[2].data, unavailable);
        let reads = 0;
        const opaque = Object.defineProperties(
            {},
            Object.fromEntries(
                ['raw', 'label', 'then'].map((name) => [
                    name,
                    {
                        get() {
                            reads++;
                            throw Error('opaque hosted data');
                        },
                    },
                ])
            )
        );
        assert.equal(
            api.projectNativeLinkedRecordRows(['rec_a'], () => opaque)[0].data,
            opaque
        );
        assert.equal(reads, 0);
        const sparse = new Array(4);
        sparse[1] = 'rec_a';
        sparse[3] = 'rec_a';
        assert.deepEqual(
            api.projectNativeLinkedRecordRows(sparse, (id) => id),
            [{ recordId: 'rec_a', data: 'rec_a' }]
        );
        const changing = ['rec_a'];
        assert.deepEqual(
            api
                .projectNativeLinkedRecordRows(changing, (id) => {
                    changing.push('rec_b');
                    return id;
                })
                .map((row) => row.recordId),
            ['rec_a']
        );
        assert.deepEqual(
            api
                .projectNativeLinkedRecordRows(['', 'rec_a', ''], (id) => id)
                .map((row) => row.recordId),
            ['', 'rec_a']
        );
        const fresh = { primary: 'fresh' };
        assert.equal(
            api.projectNativeLinkedRecordRows(['rec_a'], () => fresh)[0].data,
            fresh
        );
        for (const failure of [
            new Error('native resolver failure'),
            null,
            undefined,
        ]) {
            const notThrown = Symbol();
            let caught = notThrown;
            try {
                api.projectNativeLinkedRecordRows(['rec_a'], () => {
                    throw failure;
                });
            } catch (error) {
                caught = error;
            }
            assert.equal(caught, failure);
        }
        assert.deepEqual(
            api.projectNativeLinkedRecordRows([], () => {
                throw Error('empty read');
            }),
            []
        );
    }
    console.log(
        'Installed native linked rows: public ESM/CommonJS native identity, selected labels, first-occurrence order, opaque data, sparse IDs and error parity passed; strict NodeNext/Bundler declarations included.'
    );
    return 2;
}
