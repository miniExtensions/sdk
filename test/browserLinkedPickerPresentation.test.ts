import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOwnedCompiler } from './ownedCompiler.js';
import {
    AirtableFieldType,
    createMiniExtensionsClient,
    type SaveFormInput,
    type UpdateGridCellInput,
} from '../src/runtime/index.js';
import {
    createFormFieldBindings,
    createFormSaveInput,
    RecoveryJournal,
} from '../src/forms/index.js';
import { createPortalCellBinding } from '../src/portals/index.js';
import { formSaveOptions, loadedForm } from './formsFixtures.js';

type Projection = {
    caption(record: unknown, table: unknown): string;
};
let create: (options: {
    config(): unknown;
    details(): unknown;
    current(): boolean;
    useCustomPrimary?: boolean;
    onRetire?(caption: string): void;
}) => Projection;
const compiler = createOwnedCompiler();
let directory: string | undefined;
let prepared = false;

before(async () => {
    const root = resolve(process.cwd());
    directory = await mkdtemp(join(tmpdir(), 'sdk-linked-picker-caption-'));
    const outfile = join(directory, 'presentation.mjs');
    await compiler.build({
        entryPoints: [
            join(root, 'examples/browser/src/linkedPickerPresentation.ts'),
        ],
        alias: {
            '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        logLevel: 'silent',
    });
    create = (await import(pathToFileURL(outfile).href))
        .createLinkedPickerPresentation;
    prepared = true;
});

after(async () => {
    if (directory === undefined) return;
    if (!prepared || !compiler.canCleanup()) {
        console.error(`Linked picker caption fixture retained: ${directory}`);
        return;
    }
    await rm(directory, { recursive: true, force: true });
});

const neutral = 'Linked record';
const mask = '••••••••';
const fixture = () => {
    const primary: Record<string, unknown> = {
        id: 'fld_name',
        name: 'Name',
        description: null,
        isComputed: false,
        isPrimaryField: true,
        config: { type: 'singleLineText', options: null },
    };
    const detail: Record<string, unknown> = {
        fieldId: 'fld_name',
        fieldName: 'Name',
        isHidden: false,
        miniExtConfig: {},
        titleOverride: null,
        childFormField: null,
        fieldIsInEditingChildForm: false,
    };
    const policy = {
        config: {} as unknown,
        details: [detail] as unknown,
        current: true,
    };
    const table = { airtableFields: [primary] };
    const record = {
        id: 'rec_private_id',
        fields: { fld_name: 'Public name' },
    };
    return {
        primary,
        detail,
        policy,
        table,
        record,
        create: () =>
            create({
                config: () => policy.config,
                details: () => policy.details,
                current: () => policy.current,
            }),
    };
};
type Fixture = ReturnType<typeof fixture>;
const unreadableRecord = () => {
    let reads = 0;
    return {
        record: {
            id: 'rec_private_id',
            get fields(): never {
                reads += 1;
                throw new Error('Private candidate values must not be read.');
            },
        },
        reads: () => reads,
    };
};

describe('private linked picker captions', () => {
    it('keeps valid plain captions, including zero and false, without exposing IDs', () => {
        for (const [type, value, expected] of [
            ['singleLineText', 'Public name', 'Public name'],
            ['multilineText', '<b>Plain text</b>', '<b>Plain text</b>'],
            ['email', 'person@example.test', 'person@example.test'],
            ['phoneNumber', '+1 555 0100', '+1 555 0100'],
            ['number', 0, '0'],
            ['currency', 0, '0'],
            ['percent', 0, '0'],
            ['rating', 0, '0'],
            ['checkbox', false, 'false'],
            ['checkbox', true, 'true'],
        ] as const) {
            const f = fixture();
            f.primary.config = { type, options: null };
            assert.equal(
                f
                    .create()
                    .caption(
                        { id: f.record.id, fields: { fld_name: value } },
                        f.table
                    ),
                expected,
                type
            );
        }
    });

    it('requires complete, visible and unambiguous display authority before value access', () => {
        const cases: [string, (f: Fixture) => void][] = [
            ['missing details', (f) => (f.policy.details = undefined)],
            ['malformed details', (f) => (f.policy.details = {})],
            ['empty details', (f) => (f.policy.details = [])],
            ['hidden primary', (f) => (f.detail.isHidden = true)],
            ['missing visibility', (f) => delete f.detail.isHidden],
            ['malformed visibility', (f) => (f.detail.isHidden = 'false')],
            ['mismatched name', (f) => (f.detail.fieldName = 'Other name')],
            [
                'duplicate detail',
                (f) => (f.policy.details = [f.detail, { ...f.detail }]),
            ],
            ['missing primary', (f) => (f.primary.isPrimaryField = false)],
            [
                'malformed primary flag',
                (f) => (f.primary.isPrimaryField = 'true'),
            ],
            [
                'duplicate primary',
                (f) =>
                    f.table.airtableFields.push({
                        ...f.primary,
                        id: 'fld_other',
                    }),
            ],
            [
                'duplicate metadata ID',
                (f) =>
                    f.table.airtableFields.push({
                        ...f.primary,
                        isPrimaryField: false,
                    }),
            ],
            ['malformed field config', (f) => (f.primary.config = [])],
            ['malformed link config', (f) => (f.policy.config = [])],
            [
                'blank custom primary',
                (f) => (f.policy.config = { customPrimaryField: ' ' }),
            ],
            [
                'missing custom primary',
                (f) => (f.policy.config = { customPrimaryField: 'fld_absent' }),
            ],
            [
                'malformed custom primary',
                (f) => (f.policy.config = { customPrimaryField: 1 }),
            ],
            ['malformed display config', (f) => (f.detail.miniExtConfig = [])],
        ];
        for (const [label, mutate] of cases) {
            const f = fixture();
            mutate(f);
            const privateValue = unreadableRecord();
            assert.equal(
                f.create().caption(privateValue.record, f.table),
                neutral,
                label
            );
            assert.equal(privateValue.reads(), 0, label);
        }
        for (const table of [
            undefined,
            null,
            {},
            [],
            { airtableFields: null },
        ]) {
            const f = fixture();
            const privateValue = unreadableRecord();
            assert.equal(
                f.create().caption(privateValue.record, table),
                neutral
            );
            assert.equal(privateValue.reads(), 0);
        }
    });

    it('uses a unique authorized custom primary without falling back to the physical primary', () => {
        const f = fixture();
        f.policy.config = { customPrimaryField: 'fld_custom' };
        f.table.airtableFields.push({
            ...f.primary,
            id: 'fld_custom',
            name: 'Custom',
            isPrimaryField: false,
        });
        f.policy.details = [
            { ...f.detail, fieldId: 'fld_custom', fieldName: 'Custom' },
        ];
        const projection = f.create();
        assert.equal(
            projection.caption(
                {
                    id: 'rec_private_id',
                    fields: {
                        fld_name: 'Hidden physical name',
                        fld_custom: 'Custom title',
                    },
                },
                f.table
            ),
            'Custom title'
        );
        assert.equal(
            projection.caption(
                {
                    id: 'rec_private_id',
                    fields: { fld_name: 'Hidden physical name' },
                },
                f.table
            ),
            neutral
        );
    });

    it('keeps the Portal physical primary when Form custom-primary selection is disabled', () => {
        const f = fixture();
        f.policy.config = { customPrimaryField: 'fld_custom' };
        f.table.airtableFields.push({
            ...f.primary,
            id: 'fld_custom',
            name: 'Custom',
            isPrimaryField: false,
        });
        f.policy.details = [
            f.detail,
            { ...f.detail, fieldId: 'fld_custom', fieldName: 'Custom' },
        ];
        const projection = create({
            config: () => f.policy.config,
            details: () => f.policy.details,
            current: () => f.policy.current,
            useCustomPrimary: false,
        });
        assert.equal(
            projection.caption(
                {
                    id: 'rec_private_id',
                    fields: {
                        fld_name: 'Physical title',
                        fld_custom: 'Form custom title',
                    },
                },
                f.table
            ),
            'Physical title'
        );
    });

    it('honors own ID properties even when blank or undefined and only falls back to an own name', () => {
        for (const value of [undefined, null, '', ' \t ']) {
            const f = fixture();
            assert.equal(
                f.create().caption(
                    {
                        id: f.record.id,
                        fields: {
                            fld_name: value,
                            Name: 'Must not replace own ID',
                        },
                    },
                    f.table
                ),
                neutral
            );
        }
        const f = fixture();
        assert.equal(
            f
                .create()
                .caption(
                    { id: f.record.id, fields: { Name: 'Own name fallback' } },
                    f.table
                ),
            'Own name fallback'
        );
        for (const fields of [
            Object.create({ fld_name: 'Inherited ID' }),
            Object.create({ Name: 'Inherited name' }),
        ]) {
            assert.equal(
                f.create().caption({ id: f.record.id, fields }, f.table),
                neutral
            );
        }
        const fields = Object.create({ fld_name: 'Inherited ID' });
        fields.Name = 'Own name fallback';
        assert.equal(
            f.create().caption({ id: f.record.id, fields }, f.table),
            'Own name fallback'
        );
    });

    it('refuses ambiguous name fallback while retaining an explicit own ID', () => {
        for (const sibling of [
            { id: 'fld_sibling', name: 'Name' },
            { id: 'Name', name: 'Sibling' },
        ]) {
            const f = fixture();
            f.table.airtableFields.push({
                ...f.primary,
                ...sibling,
                isPrimaryField: false,
            });
            assert.equal(
                f
                    .create()
                    .caption(
                        { id: f.record.id, fields: { Name: 'Ambiguous name' } },
                        f.table
                    ),
                neutral
            );
            assert.equal(
                f.create().caption(
                    {
                        id: f.record.id,
                        fields: {
                            fld_name: 'Own ID title',
                            Name: 'Ambiguous name',
                        },
                    },
                    f.table
                ),
                'Own ID title'
            );
        }
    });

    it('applies both mask flags before reading the fields object for every supported type', () => {
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
            for (const type of [
                'singleLineText',
                'multilineText',
                'email',
                'phoneNumber',
                'number',
                'currency',
                'percent',
                'rating',
                'checkbox',
            ]) {
                const f = fixture();
                f.primary.config = { type, options: null };
                f.detail.miniExtConfig = { [flag]: true };
                const privateValue = unreadableRecord();
                assert.equal(
                    f.create().caption(privateValue.record, f.table),
                    mask,
                    `${flag}: ${type}`
                );
                assert.equal(privateValue.reads(), 0);
            }
            for (const value of ['false', 1, {}, null]) {
                const f = fixture();
                f.detail.miniExtConfig = { [flag]: value };
                const privateValue = unreadableRecord();
                assert.equal(
                    f.create().caption(privateValue.record, f.table),
                    neutral
                );
                assert.equal(privateValue.reads(), 0);
            }
        }
    });

    it('also applies linked-field display masks before reading candidate fields', () => {
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
            for (const value of [true, 'false', 1, null]) {
                const f = fixture();
                f.policy.config = { [flag]: value };
                const privateValue = unreadableRecord();
                assert.equal(
                    f.create().caption(privateValue.record, f.table),
                    value === true ? mask : neutral
                );
                assert.equal(privateValue.reads(), 0);
            }
        }
    });

    it('does not inspect rich or computed values, and never coerces malformed scalar objects', () => {
        for (const mutate of [
            (f: Fixture) => (f.primary.isComputed = true),
            (f: Fixture) => (f.primary.config = { type: 'url', options: null }),
            (f: Fixture) =>
                (f.detail.miniExtConfig = { displayAsAttachments: true }),
            (f: Fixture) =>
                (f.detail.miniExtConfig = { displayAsButton: true }),
        ]) {
            const f = fixture();
            mutate(f);
            const privateValue = unreadableRecord();
            assert.equal(
                f.create().caption(privateValue.record, f.table),
                neutral
            );
            assert.equal(privateValue.reads(), 0);
        }
        let conversions = 0;
        const badObject = {
            toString() {
                conversions++;
                return 'PRIVATE';
            },
            toJSON() {
                conversions++;
                return 'PRIVATE';
            },
        };
        for (const value of [badObject, [badObject], NaN, Infinity, false, 0]) {
            const f = fixture();
            assert.equal(
                f
                    .create()
                    .caption(
                        { id: f.record.id, fields: { fld_name: value } },
                        f.table
                    ),
                neutral
            );
        }
        assert.equal(conversions, 0);
    });

    it('permanently retires an observed owner or policy change, including A-to-B-to-A', () => {
        for (const change of ['owner', 'policy'] as const) {
            const f = fixture();
            const projection = f.create();
            assert.equal(projection.caption(f.record, f.table), 'Public name');
            if (change === 'owner') f.policy.current = false;
            else f.detail.isHidden = true;
            const privateValue = unreadableRecord();
            assert.equal(
                projection.caption(privateValue.record, f.table),
                neutral
            );
            if (change === 'owner') f.policy.current = true;
            else f.detail.isHidden = false;
            assert.equal(
                projection.caption(privateValue.record, f.table),
                neutral
            );
            assert.equal(privateValue.reads(), 0);
            assert.equal(f.create().caption(f.record, f.table), 'Public name');
        }
    });

    it('rechecks owner and display authority after value access before returning text', () => {
        for (const change of ['owner', 'policy', 'table'] as const) {
            const f = fixture();
            const projection = f.create();
            const record = {
                id: 'rec_private_id',
                fields: {
                    get fld_name() {
                        if (change === 'owner') f.policy.current = false;
                        else if (change === 'policy') f.detail.isHidden = true;
                        else f.primary.name = 'Changed name';
                        return 'PRIVATE_REENTRANT_VALUE';
                    },
                },
            };
            assert.equal(projection.caption(record, f.table), neutral, change);
            f.policy.current = true;
            f.detail.isHidden = false;
            f.primary.name = 'Name';
            assert.equal(
                projection.caption(f.record, f.table),
                neutral,
                change
            );
        }
    });

    it('notifies mounted captions once when a lifetime retires', () => {
        for (const change of ['owner', 'policy', 'table'] as const) {
            const f = fixture();
            const notifications: string[] = [];
            const projection = create({
                config: () => f.policy.config,
                details: () => f.policy.details,
                current: () => f.policy.current,
                onRetire: (caption) => notifications.push(caption),
            });
            assert.equal(projection.caption(f.record, f.table), 'Public name');
            assert.deepEqual(notifications, []);
            if (change === 'owner') f.policy.current = false;
            else if (change === 'policy') f.detail.isHidden = true;
            const candidate = {
                id: 'rec_private_id',
                fields: {
                    get fld_name() {
                        f.primary.name = 'Changed name';
                        return 'Retired title';
                    },
                },
            };
            assert.equal(projection.caption(candidate, f.table), neutral);
            assert.deepEqual(notifications, [neutral], change);
            f.policy.current = true;
            f.detail.isHidden = false;
            f.primary.name = 'Name';
            assert.equal(projection.caption(f.record, f.table), neutral);
            assert.deepEqual(notifications, [neutral], change);
        }
    });

    it('contains access failures without leaking diagnostics or retaining candidate values', () => {
        const f = fixture();
        const projection = f.create();
        const privateValue = unreadableRecord();
        assert.equal(projection.caption(privateValue.record, f.table), neutral);
        const replacement = f.create();
        const candidate = {
            id: 'rec_private_id',
            fields: { fld_name: 'First title' },
        };
        assert.equal(replacement.caption(candidate, f.table), 'First title');
        candidate.fields.fld_name = 'Replacement title';
        assert.equal(
            replacement.caption(candidate, f.table),
            'Replacement title'
        );
        assert.deepEqual(candidate, {
            id: 'rec_private_id',
            fields: { fld_name: 'Replacement title' },
        });
    });

    it('leaves native selected IDs, dirty state, Save payload and read counts untouched', async (test) => {
        const loaded = loadedForm();
        loaded.payload.fieldIdsInForm = ['fld_link'];
        loaded.payload.fieldIdsToSchemas = {
            fld_link: {
                fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                airtableField: {
                    id: 'fld_link',
                    name: 'Links',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                        options: {
                            linkedTableId: 'tbl_links',
                            isReversed: false,
                            prefersSingleRecordLink: false,
                        },
                    },
                },
                miniExtConfig: {},
            },
        };
        loaded.payload.formRecord.data = { fld_link: ['rec_original'] };
        loaded.payload.formFieldIdsWithUnsavedChanges = [];
        loaded.payload.urlPrefilledFieldIds = [];
        const saves: SaveFormInput[] = [];
        const owner = createFormFieldBindings({
            client: createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async (_input, init) => {
                    saves.push(JSON.parse(String(init?.body)));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                },
            }),
            loaded,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'picker-test', revision: 0 }),
        });
        test.after(() => owner.destroy());
        const binding = owner.field('fld_link');
        assert.equal(binding.getSnapshot().dirty, false);
        owner.setLinkedOptions('fld_link', [
            { value: 'rec_private_id', label: 'Linked record' },
        ]);
        assert.deepEqual(binding.setValue(['rec_original', 'rec_private_id']), {
            accepted: true,
        });
        assert.equal(binding.getSnapshot().dirty, true);
        const before = binding.getSnapshot();
        const beforeSave = createFormSaveInput({
            loaded,
            draft: owner.controller.getState().draft!,
            options: formSaveOptions(),
        });
        for (const mode of ['plain', 'masked', 'hidden']) {
            const f = fixture();
            if (mode === 'masked')
                f.detail.miniExtConfig = { obscurePassword: true };
            if (mode === 'hidden') f.detail.isHidden = true;
            const original = structuredClone({
                policy: f.policy,
                table: f.table,
                record: f.record,
            });
            f.create().caption(f.record, f.table);
            assert.deepEqual(
                { policy: f.policy, table: f.table, record: f.record },
                original
            );
        }
        assert.deepEqual(binding.getSnapshot(), before);
        assert.deepEqual(
            createFormSaveInput({
                loaded,
                draft: owner.controller.getState().draft!,
                options: formSaveOptions(),
            }),
            beforeSave
        );
        assert.equal(
            saves.length,
            0,
            'caption projection does not dispatch a read or write'
        );
        await owner.save();
        assert.equal(saves.length, 1);
        assert.deepEqual(saves[0], { ...beforeSave, miniExtStorageV4: {} });
        assert.deepEqual(saves[0].formRecord.data.fld_link, [
            'rec_original',
            'rec_private_id',
        ]);
    });

    it('leaves Portal cell dirty state and native Save payload unchanged across caption modes', async (test) => {
        const input = {
            portalExtensionAccessToken: 'synthetic_portal_token',
            portalFieldId: 'fld_children',
            recordFieldId: 'fld_link',
            recordId: 'rec_parent',
            selectedCustomViewId: 'view_one',
        };
        const writes: UpdateGridCellInput[] = [];
        let requests = 0;
        const cell = createPortalCellBinding({
            client: createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async (url, init) => {
                    requests++;
                    assert.equal(
                        new URL(String(url)).pathname,
                        '/api/trpc/airtable.updatePortalRecord'
                    );
                    assert.equal(init?.method, 'POST');
                    const body = JSON.parse(String(init?.body));
                    writes.push(body);
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    record: {
                                        id: 'rec_parent',
                                        fields: { fld_link: body.value },
                                    },
                                    auditTrail: null,
                                    auditTrails: [],
                                },
                            },
                        })
                    );
                },
            }),
            input,
            schema: {
                fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                airtableField: {
                    id: 'fld_link',
                    name: 'Links',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                        options: {
                            linkedTableId: 'tbl_links',
                            isReversed: false,
                            prefersSingleRecordLink: false,
                        },
                    },
                },
                miniExtConfig: {},
            },
            value: ['rec_original'],
            getScope: () => ({ ownerId: 'picker-test', revision: 0 }),
            isCurrent: () => true,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'picker-test',
                    parentFieldId: 'fld_children',
                    tableId: 'tbl_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        test.after(() => cell.destroy());
        cell.binding.selection!.setOptions([
            { value: 'rec_private_id', label: 'Linked record' },
        ]);
        for (const dirty of [false, true]) {
            if (dirty)
                assert.deepEqual(
                    cell.binding.setValue(['rec_original', 'rec_private_id']),
                    { accepted: true }
                );
            const before = cell.binding.getSnapshot();
            assert.equal(before.dirty, dirty);
            for (const [mode, expected] of [
                ['plain', 'Public name'],
                ['masked', mask],
                ['hidden', neutral],
            ]) {
                const f = fixture();
                if (mode === 'masked')
                    f.detail.miniExtConfig = {
                        maskPasswordOnLoginScreen: true,
                    };
                if (mode === 'hidden') f.detail.isHidden = true;
                assert.equal(f.create().caption(f.record, f.table), expected);
                assert.deepEqual(cell.binding.getSnapshot(), before);
                assert.equal(
                    requests,
                    0,
                    'caption projection dispatches no reads or writes'
                );
            }
        }
        await cell.save();
        assert.equal(requests, 1);
        assert.deepEqual(writes, [
            { ...input, value: ['rec_original', 'rec_private_id'] },
        ]);
    });
});
