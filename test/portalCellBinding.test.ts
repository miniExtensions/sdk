import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPortalCellBinding } from '../src/portals/cell.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    UpdateGridCellInput,
    UpdateGridCellResult,
    RuntimeFieldSchema,
} from '../src/runtime/types.js';
import { loadedForm } from './formsFixtures.js';

const fixture = (respond?: () => Promise<UpdateGridCellResult>) => {
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw new Error('No read');
        },
        session: { visitor: 'A' },
    });
    const calls: UpdateGridCellInput[] = [];
    client.portals.updateGridCell = async (input) => {
        calls.push(structuredClone(input));
        return respond
            ? respond()
            : ({
                  auditTrail: null,
                  auditTrails: [],
                  record: { id: 'rec_one', fields: { fld_title: input.value } },
              } as UpdateGridCellResult);
    };
    let owner = { ownerId: 'A', revision: 0 };
    let lease = true;
    const journal = new RecoveryJournal();
    const options = {
        client,
        input: {
            portalExtensionAccessToken: 'token',
            portalFieldId: 'fld_children',
            recordFieldId: 'fld_title',
            recordId: 'rec_one',
            selectedCustomViewId: 'view_one',
        },
        schema: loadedForm().payload.fieldIdsToSchemas.fld_title,
        value: 'Initial',
        getScope: () => owner,
        isCurrent: () => lease,
        recovery: {
            journal,
            scope: {
                owner: 'A',
                parentFieldId: 'fld_children',
                tableId: 'tbl_children',
                childExtensionId: '',
                context: 'modal' as const,
            },
            loadVersion: 1,
        },
    };
    return {
        client,
        calls,
        journal,
        options,
        replace: () => {
            owner = { ownerId: 'B', revision: 1 };
        },
        retire: () => {
            lease = false;
        },
    };
};

describe('Portal cell shared binding and journal', () => {
    it('subscribed stock/custom remount retains native draft and sends exactly one canonical cell write', async () => {
        const f = fixture();
        const cell = createPortalCellBinding(f.options);
        let observed: unknown;
        const stop = cell.binding.subscribe((s) => {
            observed = s.value;
        });
        cell.binding.setValue('Edited');
        stop();
        assert.equal(observed, 'Edited');
        assert.equal(cell.binding.getSnapshot().dirty, true);
        const next = cell.binding.subscribe((s) => {
            observed = s.value;
        });
        assert.equal(observed, 'Edited');
        await cell.save();
        assert.deepEqual(f.calls, [{ ...f.options.input, value: 'Edited' }]);
        assert.equal(cell.binding.getSnapshot().dirty, false);
        await assert.rejects(cell.save());
        assert.equal(f.calls.length, 1);
        next();
        cell.destroy();
    });
    it('unknown/cancelled outcome retains no replay across a fresh owner with the same native record', async () => {
        let resolve!: (r: UpdateGridCellResult) => void;
        const f = fixture(
            () =>
                new Promise((r) => {
                    resolve = r;
                })
        );
        const cell = createPortalCellBinding(f.options);
        const saving = cell.save();
        cell.cancel();
        resolve({
            auditTrail: null,
            auditTrails: [],
            record: { id: 'rec_one', fields: {} },
        } as UpdateGridCellResult);
        await assert.rejects(saving);
        assert.equal(f.journal.unknown('A').length, 1);
        const replacement = createPortalCellBinding(f.options);
        assert.equal(replacement.binding.getSnapshot().canEdit, false);
        await assert.rejects(replacement.save());
        assert.equal(f.calls.length, 1);
        cell.destroy();
        replacement.destroy();
    });
    it('late owner/session outcomes cannot accept the old attempt or change successor state', async () => {
        for (const kind of ['owner', 'session', 'lease']) {
            let resolve!: (r: UpdateGridCellResult) => void;
            const f = fixture(
                () =>
                    new Promise((r) => {
                        resolve = r;
                    })
            );
            const cell = createPortalCellBinding(f.options);
            const saving = cell.save();
            if (kind === 'owner') f.replace();
            else if (kind === 'session') f.client.setSession({ visitor: 'B' });
            else f.retire();
            assert.equal(cell.binding.setValue('old').accepted, false);
            resolve({
                auditTrail: null,
                auditTrails: [],
                record: { id: 'rec_one', fields: { fld_title: 'late' } },
            } as UpdateGridCellResult);
            await assert.rejects(saving);
            assert.equal(f.journal.unknown('A').length, 1);
            assert.equal(cell.binding.getSnapshot().retired, true);
            cell.destroy();
        }
    });
    it('accepted mutation stays accepted when a presentation subscriber throws', async () => {
        const f = fixture();
        const cell = createPortalCellBinding(f.options);
        let initial = true;
        cell.binding.subscribe(() => {
            if (!initial) throw new Error('renderer');
        });
        initial = false;
        await cell.save();
        assert.equal(f.journal.unknown('A').length, 0);
        await assert.rejects(cell.save());
        cell.destroy();
    });
    it('select atomic replacement reuses shared policy and native names, not labels', async () => {
        const f = fixture();
        const schema = {
            fieldType: 'multipleSelects',
            airtableField: {
                id: 'fld_title',
                name: 'Choices',
                isComputed: false,
                config: {
                    type: 'multipleSelects',
                    options: {
                        choices: [
                            { id: 'a', name: 'Alpha' },
                            { id: 'b', name: 'Beta' },
                        ],
                    },
                },
            },
            miniExtConfig: { maxNumberOfSelections: 1 },
        } as RuntimeFieldSchema;
        const cell = createPortalCellBinding({
            ...f.options,
            schema,
            value: ['Alpha'],
        });
        assert.equal(cell.binding.setValue(['Beta']).accepted, true);
        assert.equal(cell.binding.setValue(['Alpha', 'Beta']).accepted, false);
        await cell.save();
        assert.deepEqual(f.calls[0].value, ['Beta']);
        cell.destroy();
    });
    it('readonly, conditional and attachments never become an inline upload or mutation capability', async () => {
        const f = fixture();
        const readonly = structuredClone(f.options.schema);
        readonly.miniExtConfig = { readOnly: true };
        const cell = createPortalCellBinding({
            ...f.options,
            schema: readonly,
        });
        assert.equal(cell.binding.setValue('No').accepted, false);
        await assert.rejects(cell.save());
        assert.equal(f.calls.length, 0);
        cell.destroy();
        const invalid = structuredClone(f.options.schema);
        invalid.fieldType = 'multipleAttachments';
        assert.throws(() =>
            createPortalCellBinding({ ...f.options, schema: invalid })
        );
    });
});
