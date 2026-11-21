import assert from 'node:assert/strict';

const allowedView = {
    type: 'table',
    itemId: 'fld_orders',
    viewId: 'view_allowed',
};

function assertAccepted(snapshot, marker) {
    const id = 'rec_' + marker;
    const detail = 'fld_' + marker + '_detail';
    const cursor = 'cursor_' + marker;
    assert.deepEqual(snapshot.selection, allowedView);
    assert.deepEqual(snapshot.frame.recordIds, [id]);
    assert.deepEqual(
        snapshot.frame.details.fields.map(({ fieldId }) => fieldId),
        ['fld_title', detail]
    );
    assert.deepEqual(
        snapshot.frame.schema.map(({ id }) => id),
        ['fld_title', detail]
    );
    assert.equal(snapshot.frame.nextOffset, cursor);
    assert.deepEqual(snapshot.paging, { ids: [id], cursor });
    assert.deepEqual(snapshot.compatibility, {
        mode: 'replace',
        recordIds: [id],
        nextOffset: cursor,
        projection: { marker, detailId: detail },
    });
    assert.deepEqual(snapshot.admitted, [id]);
    assert.deepEqual(snapshot.dom.rows, [
        {
            id,
            cells: [
                ['fld_title', marker + ' order'],
                [detail, marker + ' detail'],
            ],
        },
    ]);
    assert.equal(snapshot.dom.open, 1);
    assert.equal(snapshot.dom.reload, 1);
}

function assertWithdrawn(snapshot) {
    assert.equal(snapshot.selection, null);
    assert.equal(snapshot.active, null);
    assert.equal(snapshot.frame, null);
    assert.equal(snapshot.isReloading, false);
    assert.equal(snapshot.compatibility, null);
    assert.deepEqual(snapshot.paging, { ids: [], cursor: null });
    assert.deepEqual(snapshot.admitted, []);
    assert.deepEqual(snapshot.dom, {
        rows: [],
        open: 0,
        reload: 0,
        status: 'No permitted views',
    });
    assert.equal(snapshot.proof.reads.length, 2);
    assert.deepEqual(snapshot.proof.opens, []);
}

export async function checkPortalViewLoss({ call, click, observe }) {
    await call('start');
    assert.deepEqual(await call('settle', 'read-1', 'initial'), {
        result: 'committed',
        samePublication: false,
    });
    const initial = await observe();
    assertAccepted(initial, 'initial');
    assert.equal(initial.proof.reads.length, 1);
    await call('rememberOpen');

    await click('Reload');
    const reloading = await observe();
    assertAccepted(reloading, 'initial');
    assert.equal(reloading.isReloading, true);
    assert.equal(reloading.scopeRevision, initial.scopeRevision);
    assert.equal(reloading.active, 'read-2');
    assert.deepEqual(reloading.pending, ['read-2']);
    assert.equal(reloading.proof.reads.length, 2);
    assert.equal(reloading.proof.reads[1].parentFrameId, initial.frame.id);

    await call('setAllowed', false);
    await call('setAllowed', false);
    const withdrawn = await observe();
    assertWithdrawn(withdrawn);
    assert.equal(withdrawn.generation, reloading.generation + 1);
    assert.deepEqual(withdrawn.pending, ['read-2']);
    assert.deepEqual(withdrawn.proof.retirements, [
        {
            requestId: 'read-2',
            before: reloading.generation,
            after: withdrawn.generation,
            stillCurrent: false,
        },
    ]);
    assert.equal(await call('tryOldOpen'), false);
    assert.deepEqual(await call('settle', 'read-2', 'obsolete'), {
        result: 'stale',
        samePublication: true,
    });
    const afterLate = await observe();
    assertWithdrawn(afterLate);
    assert.deepEqual(afterLate.pending, []);
    assert.deepEqual(afterLate.proof, withdrawn.proof);

    await call('setAllowed', true);
    await call('setAllowed', true);
    const recovering = await observe();
    assert.deepEqual(recovering.selection, allowedView);
    assert.equal(recovering.active, 'read-3');
    assert.deepEqual(recovering.pending, ['read-3']);
    assert.equal(recovering.frame, null);
    assert.equal(recovering.compatibility, null);
    assert.deepEqual(recovering.paging, { ids: [], cursor: null });
    assert.deepEqual(recovering.admitted, []);
    assert.deepEqual(recovering.dom.rows, []);
    assert.equal(recovering.dom.open, 0);
    assert.equal(recovering.dom.reload, 0);
    assert.equal(recovering.proof.reads.length, 3);
    assert.deepEqual(
        recovering.proof.reads.map(({ id, mode, cursor, viewId }) => ({
            id,
            mode,
            cursor,
            viewId,
        })),
        [
            {
                id: 'read-1',
                mode: 'first',
                cursor: null,
                viewId: 'view_allowed',
            },
            {
                id: 'read-2',
                mode: 'reload',
                cursor: null,
                viewId: 'view_allowed',
            },
            {
                id: 'read-3',
                mode: 'first',
                cursor: null,
                viewId: 'view_allowed',
            },
        ]
    );
    assert.notEqual(
        recovering.proof.reads[2].binding,
        recovering.proof.reads[1].binding
    );
    assert.equal(recovering.proof.reads[2].parentFrameId, null);

    assert.deepEqual(await call('settle', 'read-3', 'fresh'), {
        result: 'committed',
        samePublication: false,
    });
    const fresh = await observe();
    assertAccepted(fresh, 'fresh');
    assert.equal(fresh.active, null);
    assert.deepEqual(fresh.pending, []);
    assert.equal(await call('tryOldOpen'), false);
    await click('Open record');
    const opened = await observe();
    assertAccepted(opened, 'fresh');
    assert.deepEqual(opened.proof.opens, [
        {
            action: 'open-child',
            recordId: 'rec_fresh',
            fieldId: 'fld_orders',
            tableId: 'tbl_orders',
            viewId: 'view_allowed',
            sessionId: 'synthetic-portal',
            frameId: fresh.frame.id,
        },
    ]);
    assert.deepEqual(opened.proof.reads, recovering.proof.reads);
    assert.deepEqual(opened.proof.retirements, withdrawn.proof.retirements);
    assert.deepEqual(opened.proof.publications, [
        initial.compatibility,
        fresh.compatibility,
    ]);
    assert.deepEqual(opened.proof.shellIntents, []);
    assert.deepEqual(opened.proof.unexpected, []);
    assert.equal(opened.proof.commits, fresh.proof.commits);
    assert.equal(opened.proof.writes, 0);
    assert.equal(opened.proof.submits, 0);
    return { initial, reloading, withdrawn, afterLate, recovering, opened };
}
