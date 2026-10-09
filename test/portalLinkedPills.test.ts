import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { createPortalCellBinding } from '../src/portals/cell.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import {
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
} from '../src/ui/rendererHosts.js';
import type { PortalCollectionCriteria } from '../src/portals/types.js';
import type { FieldRendererHost } from '../src/ui/rendererRegistry.js';
import type {
    ListPortalLinkedRecordsResult,
    RuntimeFieldSchema,
    UpdateGridCellInput,
    UpdateGridCellResult,
} from '../src/runtime/types.js';
import { loadedForm } from './formsFixtures.js';
import {
    portalFixture,
    portalField,
    portalListPage,
    portalPage,
} from './portalFixtures.js';

const criteria: PortalCollectionCriteria = {
    selectedCustomViewId: 'view_example',
    searchTerm: '',
    searchParamsMap: {},
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
};
const read = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
const link = (id: string, target = 'table_labels') => ({
    ...structuredClone(portalField),
    id,
    name: id,
    config: {
        type: 'multipleRecordLinks' as const,
        options: {
            linkedTableId: target,
            inverseLinkFieldId: 'fld_inverse',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
});
const primary = () => ({
    ...structuredClone(
        loadedForm().payload.fieldIdsToSchemas.fld_title.airtableField
    ),
    id: 'fld_label',
    name: 'Label',
    isPrimaryField: true,
});
const detail = (fieldId: string) => ({
    fieldId,
    fieldName: fieldId,
    titleOverride: null,
    isHidden: false,
    fieldIsInEditingChildForm: true,
    childFormField: null,
    miniExtConfig: {},
});
async function fixture(change?: (page: ListPortalLinkedRecordsResult) => void) {
    const page = portalListPage({
        recordIds: ['record_1', 'record_2'],
        airtableOffset: 'next_page',
        customViewDetailFields: {
            fld_children: [
                detail('fld_a'),
                detail('fld_b'),
                detail('fld_self'),
            ],
        },
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [
                    link('fld_a'),
                    link('fld_b'),
                    link('fld_self', 'table_children'),
                    { ...primary(), id: 'fld_row_label' },
                ],
                recordIdsToAirtableRecords: {
                    record_1: {
                        id: 'record_1',
                        fields: {
                            fld_row_label: 'Row One',
                            fld_a: [
                                'label_1',
                                'label_blank',
                                'label_missing',
                                'label_1',
                            ],
                            fld_b: ['label_2'],
                            fld_self: ['record_2'],
                        },
                    },
                    record_2: {
                        id: 'record_2',
                        fields: {
                            fld_row_label: 'Row Two',
                            fld_a: ['label_2'],
                            fld_b: ['label_1'],
                        },
                    },
                },
            },
            table_labels: {
                airtableFields: [primary()],
                recordIdsToAirtableRecords: {
                    label_1: { id: 'label_1', fields: { fld_label: 'First' } },
                    label_2: { id: 'label_2', fields: { fld_label: 'Second' } },
                    label_blank: {
                        id: 'label_blank',
                        fields: { fld_label: '' },
                    },
                    label_new: {
                        id: 'label_new',
                        fields: { fld_label: 'Cached New' },
                    },
                },
            },
        },
    });
    change?.(page);
    const api = portalFixture(async () => structuredClone(page));
    let scope = { ownerId: 'A', revision: 0 };
    let configuration = 0;
    let current = true;
    const portal = portalPage({
        disableInlineEdit: false,
        customViews: [
            { id: 'view_example', config: { name: 'Example' } },
            { id: 'view_other', config: { name: 'Other' } },
        ],
    });
    portal.payload.linkedRecordFieldIdToDetailFields.fld_children = [
        detail('fld_a'),
        detail('fld_b'),
        detail('fld_self'),
    ];
    const owner = createPortalListOwner({
        client: api.client,
        portal,
        portalFieldId: 'fld_children',
        criteria,
        getScope: () => scope,
    });
    const options = {
        owner,
        client: api.client,
        recordId: 'record_1',
        isCurrent: () => current,
        configurationRevision: () => configuration,
    };
    assert.equal(api.calls.length, 0);
    await owner.readFirst(owner.getSnapshot().revision, read);
    const hosts: FieldRendererHost[] = [];
    const cells: ReturnType<typeof createPortalCellBinding>[] = [];
    const detailHost = (
        recordId = 'record_1',
        isCurrent = options.isCurrent
    ) => {
        const host = createPortalDetailRendererHost({
            ...options,
            recordId,
            isCurrent,
        });
        hosts.push(host);
        return host;
    };
    const cellHost = (fieldId = 'fld_a', recordId = 'record_1') => {
        const field =
            page.tableIdsToLinkedTableStates.table_children.airtableFields.find(
                (field) => field.id === fieldId
            )!;
        const schema: RuntimeFieldSchema = {
            fieldType: 'multipleRecordLinks',
            airtableField: field,
            miniExtConfig: {},
        } as RuntimeFieldSchema;
        const cell = createPortalCellBinding({
            client: api.client,
            schema,
            value: page.tableIdsToLinkedTableStates.table_children
                .recordIdsToAirtableRecords[recordId].fields[fieldId],
            input: {
                portalExtensionAccessToken: 'portal_access_example',
                portalFieldId: 'fld_children',
                recordId,
                recordFieldId: fieldId,
                selectedCustomViewId: 'view_example',
            },
            getScope: () => scope,
            isCurrent: () => current,
            recovery: {
                journal: new RecoveryJournal(),
                scope: {
                    owner: 'A',
                    parentFieldId: 'fld_children',
                    tableId: 'table_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        cells.push(cell);
        const host = createPortalCellRendererHost({
            ...options,
            recordId,
            fieldId,
            cell,
        });
        hosts.push(host);
        return { cell, host };
    };
    return {
        api,
        page,
        owner,
        detailHost,
        cellHost,
        replaceConfiguration: () => {
            configuration += 1;
        },
        replaceOwner: () => {
            scope = { ownerId: 'B', revision: 1 };
        },
        retire: () => {
            current = false;
        },
        destroy: () => {
            hosts.forEach((host) => host.dispose());
            cells.forEach((cell) => cell.destroy());
            owner.destroy();
        },
    };
}
function props(host: FieldRendererHost, fieldId = 'fld_a') {
    const snapshot = host.getSnapshot();
    assert.equal(snapshot.status, 'ready');
    if (snapshot.status !== 'ready') throw Error('Expected ready host');
    const field = snapshot.fields.find((field) => field.fieldId === fieldId)!;
    assert.equal(field.physicalKind, 'multipleRecordLinks');
    if (field.physicalKind !== 'multipleRecordLinks')
        throw Error('Expected physical link');
    assert.equal(field.linkedRecords?.source, 'portal-pills');
    if (field.linkedRecords?.source !== 'portal-pills')
        throw Error('Expected Portal pills');
    return field;
}
function items(host: FieldRendererHost, fieldId = 'fld_a') {
    const field = props(host, fieldId);
    if (field.linkedRecords?.source !== 'portal-pills')
        throw Error('Expected Portal pills');
    return field.linkedRecords.items;
}
it('Portal labels isolate two rows and two fields while retaining duplicates, blanks and self links without mount I/O', async () => {
    const f = await fixture();
    try {
        const first = f.detailHost(),
            second = f.detailHost('record_2');
        const stop = first.subscribe(() => {});
        assert.deepEqual(items(first), [
            { nativeIndex: 0, state: 'resolved', label: 'First' },
            { nativeIndex: 1, state: 'blank', label: null },
            { nativeIndex: 2, state: 'unavailable', label: null },
            { nativeIndex: 3, state: 'resolved', label: 'First' },
        ]);
        assert.deepEqual(items(first, 'fld_b'), [
            { nativeIndex: 0, state: 'resolved', label: 'Second' },
        ]);
        assert.deepEqual(items(second), [
            { nativeIndex: 0, state: 'resolved', label: 'Second' },
        ]);
        assert.deepEqual(items(second, 'fld_b'), [
            { nativeIndex: 0, state: 'resolved', label: 'First' },
        ]);
        assert.deepEqual(items(first, 'fld_self'), [
            { nativeIndex: 0, state: 'resolved', label: 'Row Two' },
        ]);
        assert.equal(props(first).capability.type, 'readonly');
        const detached = items(first);
        if (detached[0].state !== 'resolved')
            throw Error('Expected resolved label');
        detached[0].label = 'Tampered snapshot';
        assert.equal(items(first)[0].label, 'First');
        assert.equal(f.api.calls.length, 1);
        assert.equal(f.api.mutations, 0);
        assert.deepEqual(Object.keys(props(first).linkedRecords!).sort(), [
            'items',
            'source',
        ]);
        stop();
    } finally {
        f.destroy();
    }
});
it('cell drafts preserve native ordering and exact Save while added cached IDs remain generic', async () => {
    const f = await fixture();
    try {
        const { host, cell } = f.cellHost();
        const saved: UpdateGridCellInput[] = [];
        f.api.client.portals.updateGridCell = async (input) => {
            saved.push(structuredClone(input));
            return {
                auditTrail: null,
                auditTrails: [],
                record: { id: 'record_1', fields: { fld_a: input.value } },
            } as UpdateGridCellResult;
        };
        const field = props(host);
        assert.equal(field.capability.type, 'editable');
        if (field.capability.type !== 'editable')
            throw Error('Expected editable cell');
        cell.binding.selection!.setOptions([
            { value: 'label_1', label: 'First' },
            { value: 'label_blank', label: 'Blank' },
            { value: 'label_2', label: 'Second' },
            { value: 'label_new', label: 'New' },
        ]);
        assert.equal(
            field.capability.setValue([
                'label_blank',
                'label_1',
                'label_new',
                'label_2',
            ]).accepted,
            true
        );
        assert.deepEqual(items(host), [
            { nativeIndex: 0, state: 'blank', label: null },
            { nativeIndex: 1, state: 'resolved', label: 'First' },
            { nativeIndex: 2, state: 'unavailable', label: null },
            { nativeIndex: 3, state: 'unavailable', label: null },
        ]);
        assert.equal(saved.length, 0);
        await cell.save();
        assert.equal(saved.length, 1);
        assert.deepEqual(saved[0].value, [
            'label_blank',
            'label_1',
            'label_new',
            'label_2',
        ]);
        assert.equal(saved[0].recordFieldId, 'fld_a');
        assert.equal(saved[0].recordId, 'record_1');
        assert.equal(f.api.calls.length, 1);
    } finally {
        f.destroy();
    }
});
for (const mode of [
    'no-policy',
    'empty-policy',
    'null-policy',
    'computed',
    'missing-id',
    'duplicate-primary',
    'conflicting-alias',
    'duplicate-name',
    'wrong-record-id',
] as const) {
    it(`Portal primary labels respect ${mode} provenance`, async () => {
        const f = await fixture((page) => {
            const table = page.tableIdsToLinkedTableStates.table_labels;
            if (mode === 'no-policy') delete page.customViewDetailFields!.fld_a;
            if (mode === 'empty-policy')
                page.customViewDetailFields!.fld_a = [];
            if (mode === 'null-policy') page.customViewDetailFields = null;
            if (mode === 'computed') table.airtableFields[0].isComputed = true;
            if (mode === 'missing-id')
                table.recordIdsToAirtableRecords.label_1.fields = {
                    Label: 'Alias Must Not Resolve',
                };
            if (mode === 'duplicate-primary')
                table.airtableFields.push(
                    structuredClone(table.airtableFields[0])
                );
            if (mode === 'conflicting-alias')
                table.recordIdsToAirtableRecords.label_1.fields.Label =
                    'Conflicting alias';
            if (mode === 'duplicate-name')
                table.airtableFields.push({
                    ...primary(),
                    id: 'fld_other',
                    isPrimaryField: false,
                });
            if (mode === 'wrong-record-id')
                table.recordIdsToAirtableRecords.label_1.id = 'label_other';
        });
        try {
            if (mode === 'wrong-record-id') {
                assert.equal(f.owner.getSnapshot().phase, 'error');
                assert.equal(
                    f.detailHost().getSnapshot().status,
                    'unavailable'
                );
                return;
            }
            const item = items(f.detailHost())[0];
            assert.deepEqual(item, {
                nativeIndex: 0,
                state: [
                    'missing-id',
                    'duplicate-primary',
                    'conflicting-alias',
                    'duplicate-name',
                    'wrong-record-id',
                ].includes(mode)
                    ? 'unavailable'
                    : 'resolved',
                label: [
                    'missing-id',
                    'duplicate-primary',
                    'conflicting-alias',
                    'duplicate-name',
                    'wrong-record-id',
                ].includes(mode)
                    ? null
                    : 'First',
            });
        } finally {
            f.destroy();
        }
    });
}
for (const boundary of [
    'configuration',
    'owner',
    'session',
    'criteria',
    'view',
    'paging',
    'lease',
] as const) {
    it(`retained Portal pill hosts and callbacks retire across ${boundary}`, async () => {
        const f = await fixture();
        try {
            const { host } = f.cellHost();
            const field = props(host);
            if (field.capability.type !== 'editable')
                throw Error('Expected editable cell');
            const setValue = field.capability.setValue;
            if (boundary === 'configuration') f.replaceConfiguration();
            if (boundary === 'owner') f.replaceOwner();
            if (boundary === 'session')
                f.api.client.setSession({ visitor: 'visitor_B' });
            if (boundary === 'criteria')
                f.owner.setCriteria(f.owner.getSnapshot().revision, {
                    ...criteria,
                    searchTerm: 'Changed',
                });
            if (boundary === 'view')
                f.owner.setCriteria(f.owner.getSnapshot().revision, {
                    ...criteria,
                    selectedCustomViewId: 'view_other',
                });
            if (boundary === 'paging')
                await f.owner.readNext(f.owner.getSnapshot().revision, read);
            if (boundary === 'lease') f.retire();
            assert.equal(host.getSnapshot().status, 'retired');
            assert.equal(setValue(['label_2']).accepted, false);
            assert.equal(f.api.mutations, 0);
        } finally {
            f.destroy();
        }
    });
}
it('computed numeric primary labels use the existing scalar formatter', async () => {
    const f = await fixture((page) => {
        const table = page.tableIdsToLinkedTableStates.table_labels;
        table.airtableFields[0] = {
            ...primary(),
            isComputed: true,
            config: {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'number', options: { precision: 2 } },
                },
            },
        };
        table.recordIdsToAirtableRecords.label_1.fields.fld_label = 12.5;
    });
    try {
        assert.deepEqual(items(f.detailHost())[0], {
            nativeIndex: 0,
            state: 'resolved',
            label: '12.50',
        });
        assert.equal(f.api.calls.length, 1);
        assert.equal(f.api.mutations, 0);
    } finally {
        f.destroy();
    }
});
it('computed linked primary labels remain generic without legacy ID fallback', async () => {
    const f = await fixture((page) => {
        const table = page.tableIdsToLinkedTableStates.table_labels;
        table.airtableFields[0] = {
            ...primary(),
            isComputed: true,
            config: {
                type: 'formula',
                options: { isValid: true, result: link('fld_result').config },
            },
        };
        table.recordIdsToAirtableRecords.label_1.fields.fld_label = [
            'record_short',
        ];
    });
    try {
        assert.deepEqual(items(f.detailHost())[0], {
            nativeIndex: 0,
            state: 'unavailable',
            label: null,
        });
        assert.equal(f.api.calls.length, 1);
        assert.equal(f.api.mutations, 0);
    } finally {
        f.destroy();
    }
});
it('attachment and button primary labels expose no rich metadata', async () => {
    for (const kind of ['multipleAttachments', 'button'] as const) {
        const f = await fixture((page) => {
            const table = page.tableIdsToLinkedTableStates.table_labels;
            table.airtableFields[0] =
                kind === 'button'
                    ? {
                          ...primary(),
                          config: { type: 'button', options: null },
                      }
                    : {
                          ...primary(),
                          config: {
                              type: 'multipleAttachments',
                              options: { isReversed: false },
                          },
                      };
            table.recordIdsToAirtableRecords.label_1.fields.fld_label =
                kind === 'button'
                    ? {
                          label: 'Open',
                          url: 'https://example.test/private-action',
                      }
                    : [
                          {
                              id: 'att_example',
                              url: 'https://example.test/private-file',
                              filename: 'private.png',
                              size: 10,
                              type: 'image/png',
                          },
                      ];
        });
        try {
            const pills = items(f.detailHost());
            assert.deepEqual(pills[0], {
                nativeIndex: 0,
                state: 'unavailable',
                label: null,
            });
            assert(!JSON.stringify(pills).includes('private'));
            assert.equal(f.api.calls.length, 1);
            assert.equal(f.api.mutations, 0);
        } finally {
            f.destroy();
        }
    }
});
it('reentrant host leases retire configuration or owner replacements before returning old labels', async () => {
    for (const boundary of ['configuration', 'owner'] as const) {
        for (const replaceOnCall of [1, 2]) {
            const f = await fixture();
            try {
                let armed = false;
                let calls = 0;
                let replaced = false;
                const host = f.detailHost('record_1', () => {
                    if (armed && ++calls === replaceOnCall) {
                        armed = false;
                        replaced = true;
                        if (boundary === 'configuration')
                            f.replaceConfiguration();
                        else f.replaceOwner();
                    }
                    return true;
                });
                assert.equal(items(host)[0].label, 'First');
                armed = true;
                const snapshot = host.getSnapshot();
                assert.equal(
                    replaced,
                    true,
                    `${boundary} replacement on lease call ${replaceOnCall} must execute`
                );
                assert.equal(
                    snapshot.status,
                    'retired',
                    `${boundary} replacement on lease call ${replaceOnCall}`
                );
                assert(!JSON.stringify(snapshot).includes('First'));
                assert.equal(f.api.calls.length, 1);
                assert.equal(f.api.mutations, 0);
            } finally {
                f.destroy();
            }
        }
    }
});
