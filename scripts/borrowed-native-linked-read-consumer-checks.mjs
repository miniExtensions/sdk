import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const borrowedNativeLinkedReadTypedConsumer = `
import {createBorrowedNativeLinkedReadSource,type BorrowedNativeLinkedReadPort,type BorrowedNativeLinkedReadResult,type BorrowedNativeLinkedPage} from '@miniextensions/sdk/ui';
type BorrowedConsumerRow={id:string;fields:{label:string;file:File;date:Date}};
type BorrowedConsumerFilter={source:'manual'|'barcode'|'calendar';native:object};
declare const borrowedPort:BorrowedNativeLinkedReadPort<BorrowedConsumerRow,BorrowedConsumerFilter,BorrowedConsumerRow,{revision:number},{offset:string|null}>;
const borrowedSource=createBorrowedNativeLinkedReadSource(borrowedPort);
const borrowedLease=borrowedSource.capture();
const borrowedKind:'host-native'=borrowedSource.source;
if(borrowedLease){
    const borrowedValues:readonly string[]|null|undefined=borrowedLease.selected()?.nativeValue;
    const borrowedNativeFile:File|undefined=borrowedLease.selected()?.rows[0].data.fields.file;
    const borrowedHydration:Promise<BorrowedNativeLinkedReadResult<BorrowedNativeLinkedPage<BorrowedConsumerRow,{offset:string|null}>>>=borrowedLease.hydrateSelected();
    void [borrowedValues,borrowedNativeFile,borrowedHydration];
    borrowedLease.query({filter:{source:'calendar',native:{}},offset:null});
    // @ts-expect-error native filter provenance is not widened to arbitrary strings
    borrowedLease.query({filter:{source:'untrusted',native:{}},offset:null});
    // @ts-expect-error the lease has no canonical mutation authority
    borrowedLease.setValue(['rec_new']);
    // @ts-expect-error the lease has no client or Save authority
    borrowedLease.client.forms.save({});
    // @ts-expect-error a borrowed source is not an accepted SDK Form facet
    const borrowedAccepted:import('@miniextensions/sdk/forms').FormLinkedRecordsFacet=borrowedLease;
    void borrowedAccepted;
}
// @ts-expect-error cache admission must remain synchronous and host-owned
createBorrowedNativeLinkedReadSource({...borrowedPort,publishIfCurrent:async()=>true});
// @ts-expect-error no runtime client is required or accepted
createBorrowedNativeLinkedReadSource({...borrowedPort,client:{}});
void borrowedKind;
`;

export async function checkBorrowedNativeLinkedReadConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'borrowed-native-linked-read-public.mjs'
    );
    writeFileSync(
        loader,
        "export {createBorrowedNativeLinkedReadSource} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        let revision = 1,
            hidden = false,
            selectedReads = 0,
            publications = 0,
            publicationAttempts = 0;
        const listeners = new Set();
        const nativeFile = new File(['native'], 'borrowed.txt');
        const record = {
            id: 'rec_borrowed',
            fields: {
                label: 'Chosen label — 選択',
                file: nativeFile,
                date: new Date(),
            },
        };
        const page = { records: [record], metadata: { offset: null } };
        const selected = {
            nativeValue: Object.freeze([
                'rec_borrowed',
                'rec_missing',
                'rec_borrowed',
            ]),
            rows: [{ recordId: record.id, data: record }],
            unresolved: [{ nativeIndex: 1, recordId: 'rec_missing' }],
        };
        const queries = [],
            hydrations = [];
        const port = {
            source: 'host-native',
            fieldId: 'fld_native',
            linkedTableId: 'tbl_native',
            capture() {
                assert.equal(this, port);
                return { stamp: revision, readable: !hidden };
            },
            isCurrent(stamp) {
                assert.equal(this, port);
                return stamp === revision && !hidden;
            },
            selected() {
                selectedReads++;
                return selected;
            },
            query(_stamp, input) {
                return new Promise((resolve, reject) =>
                    queries.push({ input, resolve, reject })
                );
            },
            hydrateSelected(_stamp, signal) {
                return new Promise((resolve, reject) =>
                    hydrations.push({ signal, resolve, reject })
                );
            },
            publishIfCurrent(stamp, _kind, result) {
                assert.equal(this, port);
                publicationAttempts++;
                if (!this.isCurrent(stamp)) return false;
                assert.equal(result, page);
                publications++;
                return true;
            },
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        };
        const source = api.createBorrowedNativeLinkedReadSource(port);
        const lease = source.capture();
        assert.equal(lease.selected(), selected);
        assert.equal(lease.selected().nativeValue, selected.nativeValue);
        assert.equal(lease.selected().rows[0].data, record);
        assert.equal(lease.selected().rows[0].data.fields.file, nativeFile);
        const readSelection = port.selected;
        for (const nativeValue of [null, undefined, []]) {
            const empty = { nativeValue, rows: [], unresolved: [] };
            port.selected = () => empty;
            assert.equal(lease.selected(), empty);
            assert.equal(lease.selected().nativeValue, nativeValue);
        }
        port.selected = readSelection;
        const filter = {
            source: 'barcode',
            native: { date: new Date(), scanner: ['native'] },
        };
        const query = lease.query({ filter, offset: 'next' }),
            hydrate = lease.hydrateSelected();
        await Promise.resolve();
        assert.equal(queries.length, 1);
        assert.equal(hydrations.length, 1);
        assert.equal(queries[0].input.filter, filter);
        assert.equal(queries[0].input.offset, 'next');
        queries[0].resolve(page);
        hydrations[0].resolve(page);
        for (const result of await Promise.all([query, hydrate])) {
            assert.equal(result.status, 'published');
            assert.equal(result.page, page);
        }
        assert.equal(publications, 2);
        const stale = lease.hydrateSelected();
        await Promise.resolve();
        revision += 2; // Native same-identity/ABA generation, not value equality.
        for (const listener of listeners) listener();
        assert.equal(hydrations[1].signal.aborted, true);
        hydrations[1].resolve(page);
        assert.deepEqual(await stale, { status: 'retired' });
        assert.equal(publications, 2);
        assert.equal(publicationAttempts, 2);
        const fresh = source.capture();
        const error = { kind: 'original-native-error' };
        const failed = fresh.hydrateSelected();
        await Promise.resolve();
        hydrations[2].reject(error);
        await assert.rejects(failed, (cause) => cause === error);
        hidden = true;
        const priorReads = selectedReads;
        assert.equal(source.capture(), null);
        assert.equal(fresh.selected(), null);
        assert.equal(selectedReads, priorReads);
        source.destroy();
        assert.equal(listeners.size, 0);
        assert.equal(source.capture(), null);
        assert.equal('setValue' in lease, false);
        assert.equal('client' in source, false);
    }
    return 2;
}
