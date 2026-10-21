import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    projectAttachmentPresentation,
    copyAttachmentPresentation,
} from '../src/ui/attachmentPresentation.js';
import { getFormAttachmentPolicy } from '../src/forms/attachments.js';
import { loadedForm } from './formsFixtures.js';

const row = (filename: string, visible = true) => ({
    visible,
    attachment: { filename },
});
const project = (
    readRows: () => unknown,
    configs: unknown[] = [{ hideAttachmentName: false }]
) =>
    projectAttachmentPresentation({
        visible: true,
        current: () => true,
        configs,
        readRows,
    });

it('masks before lazy row reads under either flag, including conflicting policies', () => {
    for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
        for (const value of [true, 'malformed']) {
            let reads = 0;
            assert.deepEqual(
                project(() => {
                    reads++;
                    throw new Error('protected');
                }, [
                    { [flag]: value },
                    { [flag]: false, hideAttachmentName: false },
                ]),
                { status: 'masked' }
            );
            assert.equal(reads, 0);
        }
    }
});
it('hidden and retired owners never invoke lazy reads', () => {
    for (const [visible, current] of [
        [false, true],
        [true, false],
    ]) {
        let reads = 0;
        assert.deepEqual(
            projectAttachmentPresentation({
                visible,
                current: () => current,
                configs: [{ hideAttachmentName: false }],
                readRows: () => {
                    reads++;
                    throw new Error('protected');
                },
            }),
            { status: 'unavailable' }
        );
        assert.equal(reads, 0);
    }
});
it('preserves duplicate visible order and literal filenames without native metadata', () => {
    const literal = '<img src=x onerror=alert(1)> & https://example.test/';
    assert.deepEqual(
        project(() => [
            row(literal),
            row('secret', false),
            row(literal),
            row(''),
        ]),
        {
            status: 'ready',
            rows: [
                { label: literal },
                { label: literal },
                { label: 'Attachment — filename unavailable' },
            ],
        }
    );
});
it('does not access filenames without explicit permission from every policy', () => {
    for (const configs of [
        [{}],
        [{ hideAttachmentName: true }],
        [{ hideAttachmentName: false }, {}],
    ]) {
        const attachment = {
            get filename(): string {
                throw new Error('name');
            },
        };
        assert.deepEqual(
            project(() => [{ visible: true, attachment }], configs),
            {
                status: 'ready',
                rows: [{ label: 'Attachment' }],
            }
        );
    }
    assert.deepEqual(
        project(() => [
            {
                visible: false,
                get attachment() {
                    throw new Error('hidden');
                },
            },
        ]),
        { status: 'ready', rows: [] }
    );
});
it('missing safe metadata and malformed rows fail closed without partial output', () => {
    for (const configs of [
        [],
        [undefined],
        [null],
        [false],
        [{ hideAttachmentName: 'false' }],
    ])
        assert.deepEqual(
            project(() => [row('secret')], configs),
            { status: 'unavailable' }
        );
    for (const rows of [
        null,
        {},
        [row('first'), null],
        new Array(1),
        [{ visible: 'true', attachment: {} }],
        [{ visible: true, attachment: null }],
        [{ visible: true, attachment: { filename: 42 } }],
    ])
        assert.deepEqual(
            project(() => rows),
            { status: 'unavailable' }
        );
    assert.deepEqual(
        project(() => {
            throw new Error('policy');
        }),
        { status: 'unavailable' }
    );
});
it('rechecks ownership after a row getter and before publication', () => {
    let current = true;
    const result = projectAttachmentPresentation({
        visible: true,
        current: () => current,
        configs: [{ hideAttachmentName: false }],
        readRows: () => [
            {
                visible: true,
                attachment: {
                    get filename() {
                        current = false;
                        return 'old owner';
                    },
                },
            },
        ],
    });
    assert.deepEqual(result, { status: 'unavailable' });
});
it('preserves original Form add-only descriptor and persisted URL baseline semantics', () => {
    const loaded = loadedForm();
    const schema = loaded.payload.fieldIdsToSchemas.fld_files;
    assert.ok(schema.fieldType === 'multipleAttachments');
    schema.miniExtConfig = { addOnlyMode: true, hideAttachmentName: false };
    const stored = { url: 'https://example.test/stored', filename: 'stored' };
    const added = { url: 'https://example.test/added', filename: 'added' };
    loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
        fld_files: [stored],
    };
    const readRows = () => {
        const policy = getFormAttachmentPolicy({
            loaded,
            fieldId: 'fld_files',
            value: [stored, added, added],
        });
        return policy.status === 'ready' ? policy.rows : null;
    };
    const before = structuredClone(loaded);
    assert.deepEqual(project(readRows, [schema.miniExtConfig]), {
        status: 'ready',
        rows: [{ label: 'added' }, { label: 'added' }],
    });
    assert.deepEqual(loaded, before);
    delete loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
    assert.deepEqual(project(readRows, [schema.miniExtConfig]), {
        status: 'unavailable',
    });
    // A genuinely read-only original descriptor does not apply editable add-only filtering.
    schema.miniExtConfig.readOnly = true;
    assert.deepEqual(project(readRows, [schema.miniExtConfig]), {
        status: 'ready',
        rows: [{ label: 'stored' }, { label: 'added' }, { label: 'added' }],
    });
});
it('public projection copy rejects native metadata, actions, hidden counts and malformed rows', () => {
    for (const value of [
        null,
        { status: 'masked', count: 1 },
        { status: 'unavailable', rows: [] },
        { status: 'ready', rows: new Array(1) },
        { status: 'other' },
        ...['url', 'id', 'nativeIndex', 'file', 'remove'].map((key) => ({
            status: 'ready',
            rows: [{ label: 'x', [key]: 'secret' }],
        })),
    ])
        assert.equal(copyAttachmentPresentation(value), null);
    const source = { status: 'ready', rows: [{ label: 'literal' }] };
    const copied = copyAttachmentPresentation(source);
    source.rows[0].label = 'changed';
    assert.deepEqual(copied, { status: 'ready', rows: [{ label: 'literal' }] });
});

it('copies validated getter results once so a changing accessor cannot inject raw objects', () => {
    let reads = 0;
    const source = {
        status: 'ready',
        rows: [
            {
                get label() {
                    return ++reads === 1 ? 'safe' : { url: 'private' };
                },
            },
        ],
    };
    assert.deepEqual(copyAttachmentPresentation(source), {
        status: 'ready',
        rows: [{ label: 'safe' }],
    });
    assert.equal(reads, 1);
});
