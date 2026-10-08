import assert from 'node:assert/strict';
import { it } from 'node:test';
import { File } from 'node:buffer';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import type { UploadFileResult } from '../src/runtime/types.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
const fixture = () => {
    const loaded = loadedForm();
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw Error('No implicit I/O');
        },
    });
    const owner = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    const journal = new RecoveryJournal();
    const scope = {
        owner: 'A',
        parentFieldId: null,
        tableId: null,
        childExtensionId: 'form',
        context: 'modal' as const,
    };
    const attachment = owner.attachment('fld_files', {
        journal,
        scope,
        loadVersion: 1,
    });
    return { owner, client, journal, scope, attachment, loaded };
};
const file = (name: string) =>
    new File(['content'], name, {
        type: 'text/plain',
    }) as unknown as globalThis.File;
it('accepted old upload appends once but cannot clear a replacement queue', async () => {
    const f = fixture();
    const original = file('old.txt');
    const replacement = file('new.txt');
    let resolve!: (value: UploadFileResult) => void;
    let calls = 0;
    f.client.attachments.uploadFile = async () => {
        calls++;
        return await new Promise((yes) => {
            resolve = yes;
        });
    };
    assert.equal(f.attachment.select([original]), true);
    const uploading = f.attachment.upload();
    assert.equal(f.attachment.getSnapshot().busy, true);
    assert.equal(f.attachment.select([replacement]), true);
    resolve({
        url: 'https://files.example.test/accepted',
        filename: 'old.txt',
        id: null,
        size: 7,
        type: 'text/plain',
    });
    assert.equal(await uploading, true);
    assert.equal(calls, 1);
    assert.equal(f.attachment.getSnapshot().files[0], replacement);
    const values = f.owner.field('fld_files').getSnapshot().value;
    assert.deepEqual(values, [
        ...(f.loaded.payload.formRecord.data.fld_files as unknown[]),
        {
            url: 'https://files.example.test/accepted',
            filename: 'old.txt',
            id: null,
            size: 7,
            type: 'text/plain',
        },
    ]);
    assert.equal(f.owner.field('fld_files').getSnapshot().dirty, true);
    assert.equal(f.journal.unknown('A').length, 0);
    f.owner.destroy();
});
it('unknown upload retains queue and tombstone, blocks replay and Save', async () => {
    const f = fixture();
    let calls = 0;
    f.client.attachments.uploadFile = async () => {
        calls++;
        throw Error('Lost response');
    };
    const selected = file('PRIVATE.txt');
    assert.equal(f.attachment.select([selected]), true);
    assert.equal(await f.attachment.upload(), false);
    assert.equal(f.attachment.getSnapshot().phase, 'uncertain');
    assert.equal(f.attachment.getSnapshot().files[0], selected);
    assert.equal(await f.attachment.upload(), false);
    await assert.rejects(f.owner.save());
    assert.equal(calls, 1);
    assert.equal(
        JSON.stringify(f.journal.unknown('A')).includes('PRIVATE'),
        false
    );
    assert.deepEqual(
        f.owner.field('fld_files').getSnapshot().value,
        f.loaded.payload.formRecord.data.fld_files
    );
    f.owner.destroy();
});
it('native append is accepted before a subscriber disposes the old owner', async () => {
    const f = fixture();
    f.client.attachments.uploadFile = async () => ({
        id: null,
        url: 'https://files.example.test/accepted',
        filename: 'uploaded.txt',
        size: 7,
        type: 'text/plain',
    });
    assert.equal(f.attachment.select([file('uploaded.txt')]), true);
    const stop = f.owner.field('fld_files').subscribe((snapshot) => {
        if (snapshot.dirty) f.owner.destroy();
    });
    assert.equal(await f.attachment.upload(), true);
    assert.equal(f.journal.unknown('A').length, 0);
    assert.equal(f.attachment.getSnapshot().retired, true);
    stop();
});
