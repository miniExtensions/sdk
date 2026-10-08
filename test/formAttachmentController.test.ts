import assert from 'node:assert/strict';
import { it } from 'node:test';
import { File } from 'node:buffer';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import type {
    FormLoadedResult,
    UploadFileResult,
} from '../src/runtime/types.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
const fixture = (
    configure?: (loaded: FormLoadedResult) => void,
    adapter?: {
        getLoaded?(): FormLoadedResult;
        configurationRevision?(): string | number;
    }
) => {
    const loaded = loadedForm();
    configure?.(loaded);
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
    const attachment = owner.attachment(
        'fld_files',
        { journal, scope, loadVersion: 1 },
        adapter
    );
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

it('existing rows remove exact duplicate occurrences with no I/O and retain native metadata', async () => {
    const row = {
        url: 'https://files.example.test/private',
        filename: 'PRIVATE_name.txt',
        thumbnails: {
            small: {
                url: 'https://files.example.test/private-thumbnail',
                width: 1,
                height: 2,
            },
        },
    };
    const other = {
        url: 'https://files.example.test/other',
        filename: 'Other',
    };
    const f = fixture((loaded) => {
        loaded.payload.formRecord.data.fld_files = [row, row, other];
    });
    let saves = 0;
    f.client.forms.save = async (input) => {
        saves++;
        assert.deepEqual(input.formRecord.data.fld_files, [row, other]);
        assert.ok(input.formFieldIdsWithUnsavedChanges.includes('fld_files'));
        return { type: 'error', formErrors: {}, formValidationErrors: [] };
    };
    const rendered = f.attachment.getSnapshot();
    assert.deepEqual(
        rendered.rows.map((row) => row.label),
        ['Attachment', 'Attachment', 'Attachment']
    );
    assert.equal(JSON.stringify(rendered.rows).includes('PRIVATE'), false);
    assert.equal(f.attachment.remove(rendered.valuesRevision, 1), true);
    assert.equal(saves, 0);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [
        row,
        other,
    ]);
    assert.equal(f.attachment.remove(rendered.valuesRevision, 0), false);
    await f.owner.save();
    assert.equal(saves, 1);
    f.owner.destroy();
});
it('add-only hides persisted rows without losing their native indexes or capacity', () => {
    const persisted = {
        url: 'https://files.example.test/stored',
        filename: 'PRIVATE_stored',
    };
    const newRow = {
        url: 'https://files.example.test/new',
        filename: 'PRIVATE_new',
    };
    const f = fixture((loaded) => {
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
            addOnlyMode: true,
            hideAttachmentName: false,
            allowedFiles: 2,
        };
        loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
            fld_files: [persisted],
        };
        loaded.payload.formRecord.data.fld_files = [persisted, newRow];
    });
    const view = f.attachment.getSnapshot();
    assert.deepEqual(
        view.rows.map((row) => row.nativeIndex),
        [1]
    );
    assert.equal(view.rows[0].label, 'PRIVATE_new');
    assert.equal(f.attachment.select([file('capacity.txt')]), false);
    assert.equal(f.attachment.remove(view.valuesRevision, 0), false);
    assert.equal(f.attachment.remove(view.valuesRevision, 1), true);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [
        persisted,
    ]);
    assert.equal(f.attachment.select([file('capacity.txt')]), true);
    f.owner.destroy();
});
it('missing baseline and malformed answers fail closed without modifying native data', () => {
    for (const value of [
        { url: 'https://files.example.test/not-array' },
        [null],
        ['bad'],
    ]) {
        const f = fixture((loaded) => {
            loaded.payload.formRecord.data.fld_files = value as never;
        });
        const view = f.attachment.getSnapshot();
        assert.equal(view.presentation, 'unavailable');
        assert.deepEqual(view.rows, []);
        assert.equal(f.attachment.remove(view.valuesRevision, 0), false);
        assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, value);
        f.owner.destroy();
    }
    const f = fixture((loaded) => {
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
            addOnlyMode: true,
        };
        delete loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
    });
    assert.equal(f.attachment.getSnapshot().presentation, 'unavailable');
    f.owner.destroy();
});
it('canonical empty attachment values are ready and stay untouched', () => {
    for (const value of [null, undefined, '', '  ', []]) {
        const f = fixture((loaded) => {
            loaded.payload.formRecord.data.fld_files = value as never;
            loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
                addOnlyMode: true,
            };
            delete loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
        });
        assert.equal(f.attachment.getSnapshot().presentation, 'ready');
        assert.deepEqual(f.attachment.getSnapshot().rows, []);
        assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, value);
        f.owner.destroy();
    }
});
it('pending files, uncertainty, removal and owner disposal remain distinct', async () => {
    const f = fixture();
    const selected = file('PRIVATE_pending.txt');
    assert.equal(f.attachment.select([selected]), true);
    const view = f.attachment.getSnapshot();
    assert.equal(f.attachment.remove(view.valuesRevision, 0), true);
    assert.equal(f.attachment.getSnapshot().files[0], selected);
    f.client.attachments.uploadFile = async () => {
        throw Error('lost');
    };
    assert.equal(await f.attachment.upload(), false);
    const uncertain = f.attachment.getSnapshot();
    assert.equal(f.attachment.remove(uncertain.valuesRevision, 0), false);
    f.attachment.clear();
    assert.equal(f.attachment.getSnapshot().phase, 'uncertain');
    assert.equal(f.journal.unknown('A').length, 1);
    f.owner.destroy();
    assert.equal(f.attachment.remove(view.valuesRevision, 0), false);
    assert.deepEqual(f.attachment.getSnapshot().rows, []);
});
it('readonly and filename configuration use policy rather than renderer guesses', () => {
    for (const show of [undefined, null, true, false]) {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
                readOnly: true,
                hideAttachmentName: show,
            } as never;
        });
        const view = f.attachment.getSnapshot();
        assert.equal(view.rows[0].removeAllowed, false);
        assert.equal(
            view.rows[0].label,
            show === false ? 'prefill.txt' : 'Attachment'
        );
        assert.equal(f.attachment.remove(view.valuesRevision, 0), false);
        f.owner.destroy();
    }
});

it('stale native indexes cannot remove replacement or reordered same-owner arrays', () => {
    const a = { url: 'https://files.example.test/a', filename: 'A' };
    const b = { url: 'https://files.example.test/b', filename: 'B' };
    const f = fixture((loaded) => {
        loaded.payload.formRecord.data.fld_files = [a, b];
    });
    const old = f.attachment.getSnapshot();
    assert.equal(f.owner.field('fld_files').setValue([b, a]).accepted, true);
    assert.equal(f.attachment.remove(old.valuesRevision, 0), false);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [b, a]);
    const next = f.attachment.getSnapshot();
    assert.equal(f.attachment.remove(next.valuesRevision, 0), true);
    assert.equal(f.attachment.remove(next.valuesRevision, 1), false);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [a]);
    f.owner.destroy();
});
it('removal notification cannot overwrite a subscriber replacement or reuse its old revision', () => {
    const a = { url: 'https://files.example.test/a', filename: 'A' };
    const b = { url: 'https://files.example.test/b', filename: 'B' };
    const successor = {
        url: 'https://files.example.test/successor',
        filename: 'Successor',
    };
    const f = fixture((loaded) => {
        loaded.payload.formRecord.data.fld_files = [a, b];
    });
    const old = f.attachment.getSnapshot();
    let replaced = false;
    const stop = f.owner.field('fld_files').subscribe((snapshot) => {
        if (snapshot.dirty && !replaced) {
            replaced = true;
            assert.equal(
                f.owner.field('fld_files').setValue([successor]).accepted,
                true
            );
        }
    });
    assert.equal(f.attachment.remove(old.valuesRevision, 0), true);
    assert.equal(replaced, true);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, [
        successor,
    ]);
    assert.equal(f.attachment.remove(old.valuesRevision, 0), false);
    stop();
    f.owner.destroy();
});

it('observed display-policy replacement retires old removal across restoration', () => {
    let page!: FormLoadedResult;
    const f = fixture(
        (loaded) => {
            page = loaded;
            loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
                hideAttachmentName: false,
            };
        },
        { getLoaded: () => page }
    );
    const old = f.attachment.getSnapshot();
    assert.equal(old.rows[0].label, 'prefill.txt');
    page.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
        hideAttachmentName: true,
    };
    assert.equal(f.attachment.getSnapshot().rows[0].label, 'Attachment');
    page.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
        hideAttachmentName: false,
    };
    const fresh = f.attachment.getSnapshot();
    assert.equal(fresh.rows[0].label, 'prefill.txt');
    assert.equal(f.attachment.remove(old.valuesRevision, 0), false);
    assert.equal(f.attachment.remove(fresh.valuesRevision, 0), true);
    f.owner.destroy();
});
it('missing filename and masking use generic labels without exposing metadata', () => {
    for (const privacy of [true, 'true', null]) {
        const f = fixture((loaded) => {
            loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
                hideAttachmentName: false,
                obscurePassword: privacy,
            } as never;
        });
        assert.equal(f.attachment.getSnapshot().rows[0].label, 'Attachment');
        f.owner.destroy();
    }
    const f = fixture((loaded) => {
        loaded.payload.formRecord.data.fld_files = [
            { url: 'https://files.example.test/private' },
        ];
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
            hideAttachmentName: false,
            disableOpenFiles: true,
            disableDownloadFiles: false,
        };
    });
    const row = f.attachment.getSnapshot().rows[0];
    assert.equal(row.label, 'Attachment — filename unavailable');
    assert.equal(row.openAllowed, false);
    assert.equal(row.downloadAllowed, true);
    assert.equal('url' in row, false);
    f.owner.destroy();
});

it('nested queue clearing or replacement cannot deliver obsolete state to a later renderer', () => {
    for (const replacement of [false, true]) {
        const f = fixture((loaded) => {
            loaded.payload.formRecord.data.fld_files = [
                { url: 'https://files.example.test/a' },
                { url: 'https://files.example.test/b' },
            ];
        });
        const selected = file('queued.txt');
        const newer = file('newer.txt');
        f.attachment.select([selected]);
        let nested = false;
        const stopFirst = f.attachment.subscribe((snapshot) => {
            if (!nested && snapshot.rows.length === 1) {
                nested = true;
                if (replacement)
                    assert.equal(f.attachment.select([newer]), true);
                else f.attachment.clear();
            }
        });
        let rendered = f.attachment.getSnapshot();
        const stopRenderer = f.attachment.subscribe((snapshot) => {
            rendered = snapshot;
        });
        const old = f.attachment.getSnapshot();
        assert.equal(f.attachment.remove(old.valuesRevision, 0), true);
        assert.equal(nested, true);
        assert.deepEqual(rendered.files, replacement ? [newer] : []);
        assert.equal(rendered.phase, replacement ? 'selected' : 'idle');
        assert.deepEqual(rendered, f.attachment.getSnapshot());
        stopFirst();
        stopRenderer();
        f.owner.destroy();
    }
});

it('nested rejected admission cannot erase the newer error in a later renderer', () => {
    const f = fixture((loaded) => {
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig = {
            allowedAttachmentTypes: ['images'],
        };
        loaded.payload.formRecord.data.fld_files = [
            { url: 'https://files.example.test/a' },
            { url: 'https://files.example.test/b' },
        ];
    });
    let rejected = false;
    const stopFirst = f.attachment.subscribe((snapshot) => {
        if (!rejected && snapshot.rows.length === 1) {
            rejected = true;
            assert.equal(f.attachment.select([file('bad.txt')]), false);
        }
    });
    let rendered = f.attachment.getSnapshot();
    const stopRenderer = f.attachment.subscribe((snapshot) => {
        rendered = snapshot;
    });
    const old = f.attachment.getSnapshot();
    assert.equal(f.attachment.remove(old.valuesRevision, 0), true);
    assert.equal(rejected, true);
    assert.match(rendered.error ?? '', /cannot be added/);
    assert.deepEqual(rendered, f.attachment.getSnapshot());
    stopFirst();
    stopRenderer();
    f.owner.destroy();
});
