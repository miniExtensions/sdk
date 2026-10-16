import assert from 'node:assert/strict';
import { it } from 'node:test';
import { File } from 'node:buffer';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import type { FormAttachmentControllerOptions } from '../src/forms/attachmentController.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import type {
    FormLoadedResult,
    UploadFileResult,
} from '../src/runtime/types.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
const fixture = (
    configure?: (loaded: FormLoadedResult) => void,
    adapter?: Pick<
        FormAttachmentControllerOptions,
        'getLoaded' | 'configurationRevision' | 'isCurrent' | 'onAttempt'
    >,
    transport?: typeof globalThis.fetch
) => {
    const loaded = loadedForm();
    configure?.(loaded);
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch:
            transport ??
            (async () => {
                throw Error('No implicit I/O');
            }),
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

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
};
const uploadTransport = (hold?: 'signing' | 'put') => {
    const signing = deferred<Response>();
    const put = deferred<Response>();
    const signingStarted = deferred<void>();
    const putStarted = deferred<void>();
    const counts = { signing: 0, put: 0 };
    const signedResponse = () =>
        new Response(
            JSON.stringify({
                result: {
                    data: {
                        signedUrl:
                            'https://uploads.example.test/synthetic-signed-put',
                        publicUrl:
                            'https://files.example.test/synthetic-uploaded',
                    },
                },
            })
        );
    const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (
            url.pathname === '/api/trpc/publicExtensions.createPublicUploadLink'
        ) {
            assert.equal(init?.method, 'POST');
            counts.signing++;
            signingStarted.resolve(undefined);
            return hold === 'signing' ? signing.promise : signedResponse();
        }
        assert.equal(
            url.href,
            'https://uploads.example.test/synthetic-signed-put'
        );
        assert.equal(init?.method, 'PUT');
        assert.equal(init?.credentials, 'omit');
        counts.put++;
        putStarted.resolve(undefined);
        return hold === 'put'
            ? put.promise
            : new Response(null, { status: 200 });
    };
    return {
        fetch,
        counts,
        signingStarted: signingStarted.promise,
        putStarted: putStarted.promise,
        releaseSigning: () => signing.resolve(signedResponse()),
        releasePut: () => put.resolve(new Response(null, { status: 200 })),
    };
};
const assertKnownUnsent = (f: ReturnType<typeof fixture>) => {
    assert.equal(f.journal.unknown('A').length, 0);
    assert.equal(f.journal.blocking(f.scope, null), undefined);
    assert.equal(f.attachment.blocksForm(), false);
};

it('an onAttempt exception before uploader invocation leaves the same File available for explicit retry', async (test) => {
    const transport = uploadTransport();
    let rejectAttempt = true;
    const f = fixture(
        undefined,
        {
            onAttempt: () => {
                if (rejectAttempt)
                    throw new Error('Synthetic adapter exception');
            },
        },
        transport.fetch
    );
    test.after(() => f.owner.destroy());
    const baseline = structuredClone(
        f.owner.field('fld_files').getSnapshot().value
    );
    const selected = file('selected.txt');
    assert.equal(f.attachment.select([selected]), true);
    assert.equal(await f.attachment.upload(), false);
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assertKnownUnsent(f);
    assert.equal(f.attachment.getSnapshot().phase, 'selected');
    assert.equal(f.attachment.getSnapshot().files[0], selected);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, baseline);
    rejectAttempt = false;
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assert.equal(await f.attachment.upload(), true);
    assert.deepEqual(transport.counts, { signing: 1, put: 1 });
    assert.equal(f.attachment.getSnapshot().files.length, 0);
});

it('subscriber cancellation before uploader invocation does not manufacture uncertainty or replay', async (test) => {
    const transport = uploadTransport();
    const f = fixture(undefined, undefined, transport.fetch);
    test.after(() => f.owner.destroy());
    const selected = file('selected.txt');
    const baseline = structuredClone(
        f.owner.field('fld_files').getSnapshot().value
    );
    assert.equal(f.attachment.select([selected]), true);
    let cancelled = false;
    const stop = f.attachment.subscribe((snapshot) => {
        if (!cancelled && snapshot.phase === 'uploading') {
            cancelled = true;
            f.attachment.cancel();
        }
    });
    test.after(stop);
    assert.equal(await f.attachment.upload(), false);
    assert.equal(cancelled, true);
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assertKnownUnsent(f);
    assert.equal(f.attachment.getSnapshot().phase, 'selected');
    assert.equal(f.attachment.getSnapshot().files[0], selected);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, baseline);
    assert.equal(await f.attachment.upload(), true);
    assert.deepEqual(transport.counts, { signing: 1, put: 1 });
});

it('subscriber disposal before uploader invocation retires the UI without an unknown journal entry', async (test) => {
    const transport = uploadTransport();
    const f = fixture(undefined, undefined, transport.fetch);
    test.after(() => f.owner.destroy());
    assert.equal(f.attachment.select([file('selected.txt')]), true);
    const baseline = structuredClone(
        f.owner.field('fld_files').getSnapshot().value
    );
    const stop = f.attachment.subscribe((snapshot) => {
        if (snapshot.phase === 'uploading') f.attachment.dispose();
    });
    test.after(stop);
    assert.equal(await f.attachment.upload(), false);
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assertKnownUnsent(f);
    assert.equal(f.attachment.getSnapshot().retired, true);
    assert.deepEqual(f.attachment.getSnapshot().files, []);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, baseline);
    assert.equal(await f.attachment.upload(), false);
});

it('a pre-invocation configuration change preserves the queue and requires a new explicit upload', async (test) => {
    const transport = uploadTransport();
    let configuration = 0;
    let change = true;
    const f = fixture(
        undefined,
        {
            configurationRevision: () => configuration,
            onAttempt: () => {
                if (change) configuration++;
            },
        },
        transport.fetch
    );
    test.after(() => f.owner.destroy());
    const selected = file('selected.txt');
    const baseline = structuredClone(
        f.owner.field('fld_files').getSnapshot().value
    );
    assert.equal(f.attachment.select([selected]), true);
    assert.equal(await f.attachment.upload(), false);
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assertKnownUnsent(f);
    assert.equal(f.attachment.getSnapshot().phase, 'selected');
    assert.equal(f.attachment.getSnapshot().files[0], selected);
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, baseline);
    change = false;
    assert.equal(await f.attachment.upload(), true);
    assert.deepEqual(transport.counts, { signing: 1, put: 1 });
});

it('a native draft revision changed by a subscriber before invocation keeps the newer edit without upload uncertainty', async (test) => {
    const transport = uploadTransport();
    const f = fixture(undefined, undefined, transport.fetch);
    test.after(() => f.owner.destroy());
    const selected = file('selected.txt');
    const baseline = structuredClone(
        f.owner.field('fld_files').getSnapshot().value
    );
    assert.equal(f.attachment.select([selected]), true);
    let changed = false;
    let writeAccepted = false;
    const stop = f.attachment.subscribe((snapshot) => {
        if (!changed && snapshot.phase === 'uploading') {
            changed = true;
            writeAccepted = f.owner.controller.write(
                'fld_title',
                'Newer native title'
            );
        }
    });
    test.after(stop);
    assert.equal(await f.attachment.upload(), false);
    assert.equal(changed, true);
    assert.equal(writeAccepted, true);
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assertKnownUnsent(f);
    assert.equal(
        f.owner.field('fld_title').getSnapshot().value,
        'Newer native title'
    );
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, baseline);
    assert.equal(f.attachment.getSnapshot().files[0], selected);
    assert.equal(await f.attachment.upload(), true);
    assert.deepEqual(transport.counts, { signing: 1, put: 1 });
});

it('a session change before uploader invocation creates no unknown operation and cannot revive the old owner', async (test) => {
    const transport = uploadTransport();
    let f!: ReturnType<typeof fixture>;
    f = fixture(
        undefined,
        { onAttempt: () => f.client.setSession({ visitor: 'B' }) },
        transport.fetch
    );
    test.after(() => f.owner.destroy());
    assert.equal(f.attachment.select([file('selected.txt')]), true);
    assert.equal(await f.attachment.upload(), false);
    assert.deepEqual(transport.counts, { signing: 0, put: 0 });
    assertKnownUnsent(f);
    assert.equal(f.attachment.getSnapshot().retired, true);
    assert.deepEqual(f.attachment.getSnapshot().files, []);
    assert.equal(await f.attachment.upload(), false);
});

for (const replace of [false, true]) {
    it(`pre-invocation cancellation preserves a ${replace ? 'replacement' : 'cleared'} queue`, async (test) => {
        const transport = uploadTransport();
        const f = fixture(undefined, undefined, transport.fetch);
        test.after(() => f.owner.destroy());
        const selected = file('selected.txt');
        const replacement = file('replacement.txt');
        assert.equal(f.attachment.select([selected]), true);
        let cancelled = false;
        const stop = f.attachment.subscribe((snapshot) => {
            if (!cancelled && snapshot.phase === 'uploading') {
                cancelled = true;
                if (replace)
                    assert.equal(f.attachment.select([replacement]), true);
                else f.attachment.clear();
                f.attachment.cancel();
            }
        });
        test.after(stop);
        assert.equal(await f.attachment.upload(), false);
        assert.deepEqual(transport.counts, { signing: 0, put: 0 });
        assertKnownUnsent(f);
        const snapshot = f.attachment.getSnapshot();
        assert.deepEqual(snapshot.files, replace ? [replacement] : []);
        assert.equal(snapshot.phase, replace ? 'selected' : 'idle');
    });
}

for (const synchronous of [false, true]) {
    it(`an invoked uploader's ${synchronous ? 'synchronous throw' : 'rejected AbortError'} remains unknown without replay`, async (test) => {
        const f = fixture();
        test.after(() => f.owner.destroy());
        let calls = 0;
        f.client.attachments.uploadFile = () => {
            calls++;
            const cause = new DOMException(
                'Synthetic upload interruption',
                'AbortError'
            );
            if (synchronous) throw cause;
            return Promise.reject(cause);
        };
        const selected = file('selected.txt');
        const baseline = structuredClone(
            f.owner.field('fld_files').getSnapshot().value
        );
        assert.equal(f.attachment.select([selected]), true);
        assert.equal(await f.attachment.upload(), false);
        assert.equal(f.journal.unknown('A').length, 1);
        assert.equal(f.attachment.getSnapshot().phase, 'uncertain');
        assert.equal(f.attachment.blocksForm(), true);
        assert.equal(f.attachment.getSnapshot().files[0], selected);
        assert.deepEqual(
            f.owner.field('fld_files').getSnapshot().value,
            baseline
        );
        assert.equal(await f.attachment.upload(), false);
        assert.equal(calls, 1);
    });
}

it('cancellation after signing starts remains unknown even if PUT never begins', async (test) => {
    const transport = uploadTransport('signing');
    const f = fixture(undefined, undefined, transport.fetch);
    test.after(() => f.owner.destroy());
    const selected = file('selected.txt');
    const baseline = structuredClone(
        f.owner.field('fld_files').getSnapshot().value
    );
    assert.equal(f.attachment.select([selected]), true);
    const pending = f.attachment.upload();
    await transport.signingStarted;
    f.attachment.cancel();
    transport.releaseSigning();
    assert.equal(await pending, false);
    assert.deepEqual(transport.counts, { signing: 1, put: 0 });
    assert.equal(f.journal.unknown('A').length, 1);
    assert.equal(f.attachment.getSnapshot().phase, 'uncertain');
    assert.equal(f.attachment.blocksForm(), true);
    assert.equal(await f.attachment.upload(), false);
    assert.deepEqual(transport.counts, { signing: 1, put: 0 });
    assert.deepEqual(f.owner.field('fld_files').getSnapshot().value, baseline);
});

for (const retireSession of [false, true]) {
    it(`a started PUT remains unknown after ${retireSession ? 'session retirement' : 'cancellation'} and a late success`, async (test) => {
        const transport = uploadTransport('put');
        const f = fixture(undefined, undefined, transport.fetch);
        test.after(() => f.owner.destroy());
        const selected = file('selected.txt');
        assert.equal(f.attachment.select([selected]), true);
        const pending = f.attachment.upload();
        await transport.putStarted;
        if (retireSession) {
            f.client.setSession({ visitor: 'B' });
            assert.equal(f.attachment.getSnapshot().retired, true);
        } else f.attachment.cancel();
        transport.releasePut();
        assert.equal(await pending, false);
        assert.deepEqual(transport.counts, { signing: 1, put: 1 });
        assert.equal(f.journal.unknown('A').length, 1);
        assert.equal(await f.attachment.upload(), false);
        assert.deepEqual(transport.counts, { signing: 1, put: 1 });
        if (!retireSession) {
            assert.equal(f.attachment.getSnapshot().phase, 'uncertain');
            assert.equal(f.attachment.getSnapshot().files[0], selected);
            assert.deepEqual(
                f.owner.field('fld_files').getSnapshot().value,
                f.loaded.payload.formRecord.data.fld_files
            );
        }
    });
}
