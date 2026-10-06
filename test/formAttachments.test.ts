import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    getFormAttachmentPolicy,
    checkFormAttachmentFiles,
    createFormSaveInput,
    FormDraftStore,
    openLoadedFormDraft,
    type AttachmentFileDescriptor,
    type AttachmentTypeGroup,
} from '../src/forms/index.js';
import type {
    AirtableValue,
    RuntimeFieldSchema,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

type Config = Extract<
    NonNullable<
        Extract<
            RuntimeFieldSchema,
            { fieldType: 'multipleAttachments' }
        >['miniExtConfig']
    >,
    { allowedAttachmentTypes?: readonly unknown[] }
>;
const stored = {
    id: 'att_stored',
    url: 'https://files.example/stored',
    filename: 'original.png',
    type: 'image/png',
    size: 100,
    thumbnails: {
        small: { url: 'https://files.example/thumb', width: 10, height: 20 },
    },
};
// Canonical load tests include an ID-bearing pending prefill. ID != persisted.
const added = {
    id: 'att_pending_prefill',
    url: 'https://files.example/new',
    filename: 'pending.png',
    type: 'image/png',
    size: 50,
};
function input(
    config: Config = {},
    value: AirtableValue | undefined = [stored, added]
) {
    const loaded = loadedForm();
    const schema = loaded.payload.fieldIdsToSchemas.fld_files;
    assert.equal(schema.fieldType, 'multipleAttachments');
    if (schema.fieldType !== 'multipleAttachments')
        throw new Error('Fixture type');
    schema.miniExtConfig = config;
    loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
        fld_files: [stored],
    };
    return { loaded, fieldId: 'fld_files', value };
}
function ready(
    config: Config = {},
    value: AirtableValue | undefined = [stored, added]
) {
    const policy = getFormAttachmentPolicy(input(config, value));
    assert.equal(policy.status, 'ready');
    if (policy.status !== 'ready') throw new Error('Fixture policy');
    return policy;
}

describe('opt-in Form attachment presentation and native identity', () => {
    it('protects only the canonical native URL baseline, preserving duplicate indexes and complete metadata', () => {
        const args = input(
            { addOnlyMode: true, showExistingValuesForAddOnlyMode: true },
            [stored, added, stored]
        );
        const before = structuredClone(args);
        const policy = getFormAttachmentPolicy(args);
        assert.equal(policy.status, 'ready');
        if (policy.status !== 'ready') throw new Error('Fixture policy');
        assert.deepEqual(
            policy.rows.map(
                ({ nativeIndex, persisted, visible, removeAllowed }) => ({
                    nativeIndex,
                    persisted,
                    visible,
                    removeAllowed,
                })
            ),
            [
                {
                    nativeIndex: 0,
                    persisted: true,
                    visible: true,
                    removeAllowed: false,
                },
                {
                    nativeIndex: 1,
                    persisted: false,
                    visible: true,
                    removeAllowed: true,
                },
                {
                    nativeIndex: 2,
                    persisted: true,
                    visible: true,
                    removeAllowed: false,
                },
            ]
        );
        assert.deepEqual(
            policy.rows.map((row) => row.attachment),
            [stored, added, stored]
        );
        assert.deepEqual(args, before);
        assert.notEqual(
            policy.rows[0].attachment.thumbnails,
            stored.thumbnails
        );
    });
    it('hides persisted rows without pruning Save data, capacity or dirty IDs', () => {
        for (const configuredShow of [false, true]) {
            const args = input({
                addOnlyMode: true,
                showExistingValuesForAddOnlyMode: configuredShow,
                allowedFiles: 2,
            });
            const store = new FormDraftStore<AirtableValue>();
            const handle = openLoadedFormDraft({ store, loaded: args.loaded });
            assert.equal(store.write(handle, args.fieldId, args.value!), true);
            const snapshot = store.snapshot(handle)!;
            const policy = getFormAttachmentPolicy({
                ...args,
                hidePersistedAddOnlyValues: true,
            });
            assert.equal(policy.status, 'ready');
            if (policy.status !== 'ready') throw new Error('Fixture policy');
            assert.deepEqual(
                policy.rows.map((row) => row.visible),
                [false, true]
            );
            assert.deepEqual(
                policy.rows.map((row) => row.nativeIndex),
                [0, 1]
            );
            assert.equal(policy.upload.remainingSlots, 0);
            assert.equal(policy.upload.allowed, false);
            const save = createFormSaveInput({
                loaded: args.loaded,
                draft: snapshot,
                options: formSaveOptions(),
            });
            assert.deepEqual(save.formRecord.data.fld_files, [stored, added]);
            assert.ok(
                save.formFieldIdsWithUnsavedChanges.includes('fld_files')
            );
            assert.deepEqual(store.snapshot(handle), snapshot);
        }
    });
    it('keeps configuration Open/Download permissions independent across writable, readonly and computed fields', () => {
        for (const readOnly of [false, true])
            for (const disableOpenFiles of [false, true])
                for (const disableDownloadFiles of [false, true]) {
                    const args = input({
                        readOnly,
                        addOnlyMode: true,
                        disableOpenFiles,
                        disableDownloadFiles,
                    });
                    if (readOnly)
                        delete args.loaded.payload
                            .persistedAddOnlyAttachmentValuesByFieldId;
                    const policy = getFormAttachmentPolicy(args);
                    assert.equal(policy.status, 'ready');
                    if (policy.status !== 'ready')
                        throw new Error('Fixture policy');
                    assert.equal(policy.openAllowed, !disableOpenFiles);
                    assert.equal(policy.downloadAllowed, !disableDownloadFiles);
                    assert.equal(policy.addOnly, !readOnly);
                    assert.deepEqual(
                        policy.rows.map((row) => row.removeAllowed),
                        readOnly ? [false, false] : [false, true]
                    );
                    if (readOnly)
                        assert.equal(policy.upload.status, 'read-only');
                }
        const args = input();
        args.loaded.payload.fieldIdsToSchemas.fld_files.airtableField.isComputed = true;
        const policy = getFormAttachmentPolicy(args);
        assert.equal(policy.status, 'ready');
        if (policy.status !== 'ready') throw new Error('Fixture policy');
        assert.equal(policy.readOnly, true);
        assert.equal(
            policy.rows.every((row) => !row.removeAllowed),
            true
        );
    });
    it('declines a missing whole map only for effective writable add-only; a missing entry is empty', () => {
        const args = input({ addOnlyMode: true });
        delete args.loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
        assert.deepEqual(getFormAttachmentPolicy(args), {
            status: 'unavailable',
            reason: 'missing-persisted-baseline',
        });
        assert.equal(
            checkFormAttachmentFiles({ ...args, files: [] }).batchError,
            'unavailable-policy'
        );
        args.loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {};
        const policy = getFormAttachmentPolicy(args);
        assert.equal(policy.status, 'ready');
        if (policy.status !== 'ready') throw new Error('Fixture policy');
        assert.ok(
            policy.rows.every(
                (row) => !row.persisted && row.visible && row.removeAllowed
            )
        );
        for (const config of [
            {},
            { addOnlyMode: false },
            { addOnlyMode: true, readOnly: true },
        ]) {
            const legacy = input(config);
            delete legacy.loaded.payload
                .persistedAddOnlyAttachmentValuesByFieldId;
            assert.equal(getFormAttachmentPolicy(legacy).status, 'ready');
        }
    });
    it('recomputes from the same load baseline across remount/restore, and a new load locks accepted additions', () => {
        const args = input({
            addOnlyMode: true,
            showExistingValuesForAddOnlyMode: true,
        });
        for (let mount = 0; mount < 2; mount++) {
            const policy = getFormAttachmentPolicy(structuredClone(args));
            assert.equal(policy.status, 'ready');
            if (policy.status !== 'ready') throw new Error('Fixture policy');
            assert.deepEqual(
                policy.rows.map((row) => row.removeAllowed),
                [false, true]
            );
        }
        args.loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
            fld_files: [stored, added],
        };
        const policy = getFormAttachmentPolicy(args);
        assert.equal(policy.status, 'ready');
        if (policy.status !== 'ready') throw new Error('Fixture policy');
        assert.ok(policy.rows.every((row) => !row.removeAllowed));
    });
    it('accepts canonical empty values and rejects malformed/non-attachment fields without effects', () => {
        for (const value of [undefined, null, []]) {
            const policy = getFormAttachmentPolicy({ ...input(), value });
            assert.equal(policy.status, 'ready');
            if (policy.status !== 'ready') throw new Error('Fixture policy');
            assert.deepEqual(policy.rows, []);
        }
        for (const value of ['text', 1, [{}], [{ url: 1 }], Array(1)])
            assert.throws(
                () =>
                    getFormAttachmentPolicy(input({}, value as AirtableValue)),
                TypeError
            );
        assert.throws(
            () => getFormAttachmentPolicy({ ...input(), fieldId: 'fld_title' }),
            TypeError
        );
        assert.throws(
            () => getFormAttachmentPolicy({ ...input(), fieldId: 'unknown' }),
            TypeError
        );
    });
});

// Comparison vectors traced to canonical AttachmentsField helpers (35–69),
// sanitizer (300–405), and source-owned MIME/count/MiB interaction regressions.
// Reviewer confirmed the relevant source identical at 58f73d5 and 9cd94be2.
describe('canonical Form attachment metadata admission comparison', () => {
    it('defaults to file upload and explicitly excludes every other producer mode', () => {
        assert.equal(ready({}, []).upload.mode, 'upload-file');
        for (const fieldMode of [
            'upload-url',
            'hand-signature',
            'image-annotation',
        ] as const) {
            assert.equal(
                ready({ fieldMode }, []).upload.status,
                'unsupported-mode'
            );
            assert.equal(
                checkFormAttachmentFiles({
                    ...input({ fieldMode }, []),
                    files: [{ type: 'image/png', size: 1 }],
                }).batchError,
                'unsupported-mode'
            );
        }
    });
    it('matches each canonical MIME group, normalized essences and exact near-miss denials', () => {
        const vectors: readonly [AttachmentTypeGroup, string, boolean][] = [
            ['images', ' IMAGE/PNG ; charset=binary', true],
            ['images', 'image/', false],
            ['images', 'image/png/extra', false],
            ['videos', 'video/mp4', true],
            ['videos', 'audio/mp4', false],
            ['audios', 'audio/mpeg', true],
            ['audios', 'video/mpeg', false],
            ['documents', 'application/pdf', true],
            ['documents', 'application/msword', true],
            [
                'documents',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                true,
            ],
            [
                'documents',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                false,
            ],
            ['documents', 'application/pdf-extra', false],
            ['compressedFiles', ' APPLICATION/X-ZIP-COMPRESSED ; x=y', true],
            ['compressedFiles', 'application/zip', true],
            ['compressedFiles', 'application/x-zip', true],
            ['compressedFiles', 'application/notzip', false],
            ['compressedFiles', 'application/gzip', false],
            ['compressedFiles', 'application/zip-extra', false],
        ];
        for (const [group, type, allowed] of vectors) {
            const result = checkFormAttachmentFiles({
                ...input({ allowedAttachmentTypes: [group] }, []),
                files: [{ type, size: 1 }],
            });
            assert.deepEqual(result, {
                acceptedIndexes: allowed ? [0] : [],
                rejected: allowed ? [] : [{ index: 0, reason: 'type' }],
                batchError: null,
            });
        }
        for (const allowedAttachmentTypes of [undefined, null, []])
            assert.deepEqual(
                checkFormAttachmentFiles({
                    ...input({ allowedAttachmentTypes } as Config, []),
                    files: [{ type: '', size: 0 }],
                }).acceptedIndexes,
                [0]
            );
        for (const group of [
            'images',
            'videos',
            'audios',
            'documents',
            'compressedFiles',
        ] as const)
            assert.equal(
                checkFormAttachmentFiles({
                    ...input({ allowedAttachmentTypes: [group] }, []),
                    files: [{ type: '', size: 0 }],
                }).rejected[0].reason,
                'type'
            );
        assert.deepEqual(
            checkFormAttachmentFiles({
                ...input(
                    { allowedAttachmentTypes: ['images', 'documents'] },
                    []
                ),
                files: [{ type: 'application/pdf', size: 1 }],
            }).acceptedIndexes,
            [0]
        );
    });
    it('matches canonical count boundaries, legacy normalization and existing-over-cap even with no valid files', () => {
        const caps: readonly [number | undefined, number | null][] = [
            [undefined, null],
            [2, 2],
            [2.5, 2],
            [0, 0],
            [-1, 0],
            [0.5, 0],
            [NaN, 0],
            [Infinity, 0],
            [-Infinity, 0],
        ];
        for (const [allowedFiles, expected] of caps)
            assert.equal(ready({ allowedFiles }, []).upload.maxFiles, expected);
        for (const n of [0, 1, 2, 3]) {
            const value = Array.from({ length: n }, () => stored);
            const result = checkFormAttachmentFiles({
                ...input({ allowedFiles: 2 }, value),
                files: [{ type: 'image/png', size: 1 }],
            });
            assert.equal(result.batchError, n + 1 > 2 ? 'count' : null);
            assert.deepEqual(result.acceptedIndexes, n + 1 > 2 ? [] : [0]);
        }
        for (const files of [[], [{ type: 'text/plain', size: 1 }]])
            assert.equal(
                checkFormAttachmentFiles({
                    ...input(
                        { allowedFiles: 1, allowedAttachmentTypes: ['images'] },
                        [stored, added]
                    ),
                    files,
                }).batchError,
                'count'
            );
        assert.equal(
            checkFormAttachmentFiles({
                ...input({ allowedFiles: 2 }, [stored, added]),
                files: [],
            }).batchError,
            null
        );
        assert.equal(
            checkFormAttachmentFiles({
                ...input({ readOnly: true, allowedFiles: 0 }),
                files: [],
            }).batchError,
            'read-only'
        );
    });
    it('matches fractional MiB and legacy size boundaries without guessing actual file contents', () => {
        for (const sizeLimit of [undefined, 0])
            assert.deepEqual(
                checkFormAttachmentFiles({
                    ...input({ sizeLimit }, []),
                    files: [{ type: '', size: 104857600 }],
                }).acceptedIndexes,
                [0]
            );
        for (const sizeLimit of [-1, NaN, Infinity, -Infinity]) {
            assert.equal(ready({ sizeLimit }, []).upload.maxFileBytes, 0);
            assert.deepEqual(
                checkFormAttachmentFiles({
                    ...input({ sizeLimit }, []),
                    files: [
                        { type: '', size: 0 },
                        { type: '', size: 1 },
                    ],
                }),
                {
                    acceptedIndexes: [0],
                    rejected: [{ index: 1, reason: 'size' }],
                    batchError: null,
                }
            );
        }
        for (const sizeLimit of [0.5, 1.25, 5 / 1048576]) {
            const max = sizeLimit * 1048576;
            assert.deepEqual(
                checkFormAttachmentFiles({
                    ...input({ sizeLimit }, []),
                    files: [
                        { type: '', size: max - 1 },
                        { type: '', size: max },
                        { type: '', size: max + 1 },
                    ],
                }),
                {
                    acceptedIndexes: [0, 1],
                    rejected: [{ index: 2, reason: 'size' }],
                    batchError: null,
                }
            );
        }
    });
    it('keeps mixed-invalid batches ordered, applies type before size, and rejects valid-batch count overflow atomically', () => {
        const args = input(
            {
                allowedFiles: 2,
                sizeLimit: 1 / 1048576,
                allowedAttachmentTypes: ['images'],
            },
            [stored]
        );
        const before = structuredClone(args);
        const files = [
            { type: 'application/notzip', size: 100 },
            { type: 'image/png', size: 2 },
            { type: 'image/png', size: 1 },
        ];
        assert.deepEqual(checkFormAttachmentFiles({ ...args, files }), {
            acceptedIndexes: [2],
            rejected: [
                { index: 0, reason: 'type' },
                { index: 1, reason: 'size' },
            ],
            batchError: null,
        });
        assert.deepEqual(
            checkFormAttachmentFiles({
                ...args,
                files: [...files, { type: 'image/png', size: 0 }],
            }),
            {
                acceptedIndexes: [],
                rejected: [
                    { index: 0, reason: 'type' },
                    { index: 1, reason: 'size' },
                ],
                batchError: 'count',
            }
        );
        assert.deepEqual(args, before);
    });
    it('validates every structural descriptor before readonly/unavailable admission without requiring DOM objects', () => {
        const malformed = [
            { type: 1, size: 1 },
            { type: '', size: -1 },
            { type: '', size: NaN },
            { type: '', size: Infinity },
            { type: '', size: '1' },
            null,
        ];
        for (const config of [{}, { readOnly: true }, { addOnlyMode: true }])
            for (const file of malformed) {
                const args = input(config, []);
                delete args.loaded.payload
                    .persistedAddOnlyAttachmentValuesByFieldId;
                assert.throws(
                    () =>
                        checkFormAttachmentFiles({
                            ...args,
                            files: [
                                file,
                            ] as unknown as AttachmentFileDescriptor[],
                        }),
                    TypeError
                );
            }
        assert.throws(
            () =>
                checkFormAttachmentFiles({ ...input({}, []), files: Array(1) }),
            TypeError
        );
        // Parent-approved structural domain includes finite fractional sizes.
        assert.deepEqual(
            checkFormAttachmentFiles({
                ...input({}, []),
                files: [{ type: '', size: 0.5 }],
            }).acceptedIndexes,
            [0]
        );
    });
});
