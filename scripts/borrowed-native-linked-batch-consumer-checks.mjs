import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const borrowedNativeLinkedBatchTypedConsumer = `
import {createBorrowedNativeLinkedHydrationBatch,type BorrowedNativeLinkedBatchPort,type BorrowedNativeLinkedBatchResult,type BorrowedNativeLinkedBatchSelection} from '@miniextensions/sdk/ui';
type BatchConsumerNative={nativeValue:readonly string[]|readonly (readonly string[])[]|null|undefined;rows:readonly {nativePath:readonly number[];recordId:string;data:{label:string;file:File;date:Date}}[];unresolved:readonly {nativePath:readonly number[];recordId:string}[]};
type BatchConsumerPage={nativeTables:object};
declare const nativeBatchPort:BorrowedNativeLinkedBatchPort<{generation:number},BatchConsumerNative,BatchConsumerPage>;
const nativeBatch=createBorrowedNativeLinkedHydrationBatch(nativeBatchPort);
const nativeBatchKind:'host-native'=nativeBatch.source;
const nativeBatchLease=nativeBatch.capture();
if(nativeBatchLease){
 const selectedBatch:readonly BorrowedNativeLinkedBatchSelection<BatchConsumerNative>[]|null=nativeBatchLease.selected();
 if(selectedBatch?.[0].status==='available'){
  const nativeBatchFile:File|undefined=selectedBatch[0].selection.rows[0]?.data.file;
  const nativeBatchValue:BatchConsumerNative['nativeValue']=selectedBatch[0].selection.nativeValue;
  void [nativeBatchFile,nativeBatchValue];
 }
 const nativeBatchHydration:Promise<BorrowedNativeLinkedBatchResult<BatchConsumerPage>>=nativeBatchLease.hydrateSelected();
 void nativeBatchHydration;
 // @ts-expect-error a native batch has no canonical mutation authority
 nativeBatchLease.setValue(['rec_other']);
 // @ts-expect-error a native batch has no client or Save authority
 nativeBatchLease.client.forms.save({});
 // @ts-expect-error a borrowed batch is not an accepted SDK Form linked facet
 const nativeBatchAccepted:import('@miniextensions/sdk/forms').FormLinkedRecordsFacet=nativeBatchLease;
 void nativeBatchAccepted;
}
// @ts-expect-error source descriptors are immutable metadata
nativeBatch.fields[0].fieldId='forged';
// @ts-expect-error final cache publication is synchronous and explicit-true
createBorrowedNativeLinkedHydrationBatch({...nativeBatchPort,publishIfCurrent:async()=>true});
// @ts-expect-error per-field readability is synchronous host authority
createBorrowedNativeLinkedHydrationBatch({...nativeBatchPort,isFieldReadable:async()=>true});
// @ts-expect-error no client/draft authority is accepted
createBorrowedNativeLinkedHydrationBatch({...nativeBatchPort,client:{}});
void nativeBatchKind;
`;

export async function checkBorrowedNativeLinkedBatchConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'borrowed-native-linked-batch-public.mjs'
    );
    writeFileSync(
        loader,
        "export {createBorrowedNativeLinkedHydrationBatch} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        let version = 1,
            hidden = false,
            publishAttempts = 0;
        const masked = new Set(),
            listeners = new Set(),
            selectedCalls = [],
            requests = [];
        const row = {
            id: 'rec_native',
            fields: {
                label: 'Chosen native label',
                file: new File(['native'], 'native.txt'),
                date: new Date(),
            },
        };
        const direct = ['rec_native', 'rec_missing', 'rec_native'];
        const nested = [direct, direct];
        const selections = {
            fld_direct: {
                nativeValue: direct,
                rows: [{ nativePath: [0], recordId: row.id, data: row }],
                unresolved: [{ nativePath: [1], recordId: 'rec_missing' }],
            },
            fld_lookup: {
                nativeValue: nested,
                rows: [{ nativePath: [1, 2], recordId: row.id, data: row }],
                unresolved: [{ nativePath: [0, 1], recordId: 'rec_missing' }],
            },
        };
        Object.defineProperty(selections.fld_lookup, 'opaque', {
            enumerable: true,
            get() {
                assert.fail('Batch must not traverse opaque native selections');
            },
        });
        const page = { nativeTables: { direct: row, lookup: row } };
        Object.defineProperty(page, 'opaque', {
            enumerable: true,
            get() {
                assert.fail('Batch must not traverse native pages');
            },
        });
        const notify = () => {
            for (const listener of [...listeners]) listener();
        };
        const source = api.createBorrowedNativeLinkedHydrationBatch({
            source: 'host-native',
            fields: [
                { fieldId: 'fld_direct', linkedTableId: 'tbl_direct' },
                { fieldId: 'fld_lookup', linkedTableId: 'tbl_lookup' },
            ],
            capture: () => ({ stamp: version, readable: !hidden }),
            isCurrent: (stamp) => !hidden && stamp === version,
            isFieldReadable: (_stamp, id) => !masked.has(id),
            selected: (_stamp, id) => {
                assert.equal(masked.has(id), false);
                selectedCalls.push(id);
                return selections[id];
            },
            hydrateSelected: (_stamp, signal) =>
                new Promise((resolve, reject) =>
                    requests.push({ signal, resolve, reject })
                ),
            publishIfCurrent: (stamp, current) => {
                publishAttempts++;
                if (stamp !== version) return false;
                assert.equal(current, page);
                version++;
                notify();
                return true;
            },
            subscribe: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        });
        const lease = source.capture();
        assert.ok(lease);
        const selected = lease.selected();
        assert.equal(selected[0].selection, selections.fld_direct);
        assert.equal(selected[1].selection, selections.fld_lookup);
        assert.equal(selected[1].selection.nativeValue, nested);
        assert.equal(nested[0], direct);
        assert.equal(nested[1], direct);
        assert.equal(selected[1].selection.rows[0].data, row);
        assert.equal(
            selected[1].selection.rows[0].data.fields.file,
            row.fields.file
        );
        assert.equal(
            selected[1].selection.unresolved,
            selections.fld_lookup.unresolved
        );
        const current = lease.hydrateSelected();
        await Promise.resolve();
        assert.equal(requests.length, 1);
        requests[0].resolve(page);
        const accepted = await current;
        assert.equal(accepted.status, 'published');
        assert.equal(accepted.page, page);
        assert.equal(publishAttempts, 1);
        assert.equal(lease.isCurrent(), false);
        masked.add('fld_lookup');
        version++;
        notify();
        const priorLookupReads = selectedCalls.filter(
            (id) => id === 'fld_lookup'
        ).length;
        const maskedSelected = source.capture().selected();
        assert.equal(maskedSelected[0].status, 'available');
        assert.equal(maskedSelected[1].status, 'unavailable');
        assert.equal(
            selectedCalls.filter((id) => id === 'fld_lookup').length,
            priorLookupReads
        );
        masked.clear();
        version++;
        notify();
        const stale = source.capture().hydrateSelected();
        await Promise.resolve();
        version += 2;
        notify();
        assert.equal(requests[1].signal.aborted, true);
        requests[1].resolve(page);
        assert.deepEqual(await stale, { status: 'retired' });
        assert.equal(publishAttempts, 1);
        const failed = source.capture().hydrateSelected();
        await Promise.resolve();
        const original = { kind: 'original-native-batch-failure' };
        requests[2].reject(original);
        await assert.rejects(failed, (cause) => cause === original);
        const retiring = source.capture();
        const before = requests.length;
        const unallocated = retiring.hydrateSelected();
        retiring.retire();
        assert.deepEqual(await unallocated, { status: 'retired' });
        assert.equal(requests.length, before);
        for (const nativeValue of [null, undefined]) {
            selections.fld_lookup = { nativeValue, rows: [], unresolved: [] };
            version++;
            notify();
            const empty = source.capture().selected()[1];
            assert.equal(empty.status, 'available');
            assert.equal(empty.selection.nativeValue, nativeValue);
        }
        hidden = true;
        version++;
        notify();
        const priorReads = selectedCalls.length;
        assert.equal(source.capture(), null);
        assert.equal(selectedCalls.length, priorReads);
        source.destroy();
        assert.equal(listeners.size, 0);
        assert.equal(source.capture(), null);
        assert.equal('client' in source, false);
        assert.equal('setValue' in lease, false);
        assert.deepEqual(direct, ['rec_native', 'rec_missing', 'rec_native']);
        assert.equal(nested[0], nested[1]);
    }
    console.log(
        'Installed native linked hydration batch: ESM/CommonJS mixed direct/lookup native identity, single batch publication, privacy, ABA/error/cleanup and strict NodeNext/Bundler declarations passed.'
    );
    return 2;
}
