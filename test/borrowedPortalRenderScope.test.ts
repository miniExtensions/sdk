import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AirtableGrid, AirtableList } from '../src/react/index.js';
import { loadedForm } from './formsFixtures.js';
import type { PortalRecordPresentation } from '../src/portals/listOwner.js';
import {
    createBorrowedPortalRenderScope,
    type BorrowedPortalPort,
    type BorrowedPortalTarget,
} from '../src/ui/borrowedPortalRenderScope.js';

function fixture() {
    const schema = loadedForm().payload.fieldIdsToSchemas.fld_title;
    const projection: PortalRecordPresentation = {
        portalFieldId: 'fld_children',
        linkedTableId: 'table_children',
        records: [
            {
                id: 'record_2',
                fields: { fld_title: 'Second', fld_hidden: 'Secret' },
            },
            { id: 'record_1', fields: { fld_title: 'First' } },
        ],
        table: {
            airtableFields: [
                schema.airtableField,
                { ...schema.airtableField, id: 'fld_hidden' },
            ],
        },
        detailProjection: 'present',
        detailFields: ['fld_title', 'fld_hidden'].map((fieldId) => ({
            fieldId,
            fieldName: 'Name',
            titleOverride: 'Accepted title',
            isHidden: fieldId === 'fld_hidden',
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: schema.miniExtConfig,
        })),
    };
    let stamp = {};
    let currentProjection: PortalRecordPresentation | null = projection;
    const listeners = new Set<() => void>();
    const calls: BorrowedPortalTarget[] = [];
    let stops = 0;
    const port: BorrowedPortalPort<object> = {
        capture: () => ({ stamp, projection: currentProjection }),
        isCurrent: (expected) => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                stops++;
                listeners.delete(listener);
            };
        },
        invokeIfCurrent(expected, target, isCurrent) {
            if (expected !== stamp || !isCurrent()) return false;
            calls.push(target);
            return true;
        },
    };
    return {
        port,
        projection,
        calls,
        get stops() {
            return stops;
        },
        replace(next: PortalRecordPresentation | null = projection) {
            stamp = {};
            currentProjection = next;
        },
        notify() {
            for (const listener of [...listeners]) listener();
        },
    };
}
it('supported factory supplies readonly slots, accepted order/titles/values and no hidden cells to both shells', () => {
    const f = fixture();
    const scope = createBorrowedPortalRenderScope(f.port);
    for (const Shell of [AirtableList, AirtableGrid]) {
        const html = renderToStaticMarkup(
            createElement(Shell, {
                scope,
                renderers: {
                    renderSingleLineTextField: (props) => {
                        assert.equal(props.capability.type, 'readonly');
                        return createElement(
                            'span',
                            { 'data-slot': props.fieldId },
                            `${props.title}:${props.value}`
                        );
                    },
                },
                children: (state) =>
                    createElement(
                        'div',
                        null,
                        state.rows.map((row) =>
                            createElement(
                                'div',
                                { key: row.recordId },
                                row.cells.map((cell) =>
                                    createElement(
                                        'div',
                                        { key: cell.fieldId },
                                        cell.node
                                    )
                                )
                            )
                        )
                    ),
            })
        );
        assert.equal(
            html,
            '<div><div><div><span data-slot="fld_title">Accepted title:Second</span></div></div><div><div><span data-slot="fld_title">Accepted title:First</span></div></div></div>'
        );
    }
    assert.deepEqual(f.calls, []);
    scope.destroy();
});
it('present-empty, missing, null and withheld details never use cached schema/values as fallback', () => {
    const f = fixture();
    const scope = createBorrowedPortalRenderScope(f.port);
    for (const detailProjection of ['present', 'missing', 'null'] as const) {
        f.replace({
            ...f.projection,
            detailProjection,
            detailFields:
                detailProjection === 'present' ? [] : f.projection.detailFields,
        });
        assert.deepEqual(
            scope.getSnapshot().rows.map((row) => row.cells),
            [[], []]
        );
    }
    f.replace(null);
    assert.deepEqual(scope.getSnapshot().rows, []);
    scope.destroy();
});
it('old row/child callbacks and retained hosts refuse before notification, including equal-data ABA; fresh callbacks recover', async () => {
    const f = fixture();
    const scope = createBorrowedPortalRenderScope(f.port);
    const old = scope.getSnapshot();
    const host = old.rows[0].cells[0].host;
    assert.equal(await old.actions.openChild('record_2', 'fld_hidden'), false);
    assert.equal(await old.actions.openRow('cached_record'), false);
    assert.equal(await old.actions.openChild('record_2', 'fld_title'), true);
    f.replace(null);
    f.replace(); // Same data, new host-owned generation; no notification yet.
    assert.equal(await old.actions.openRow('record_2'), false);
    assert.equal(await old.actions.openChild('record_2', 'fld_title'), false);
    assert.equal(host.getSnapshot().status, 'retired');
    assert.equal(f.calls.length, 1);
    assert.equal(await scope.getSnapshot().actions.openRow('record_2'), true);
    scope.destroy();
    assert.equal(await scope.getSnapshot().actions.openRow('record_2'), false);
    assert.equal(f.stops, 1);
});
it('a native deferred admission rechecks after its wait and cannot report stale success', async () => {
    const f = fixture();
    let resume!: () => void;
    const wait = new Promise<void>((resolve) => {
        resume = resolve;
    });
    f.port.invokeIfCurrent = async (_stamp, target, isCurrent) => {
        await wait;
        if (!isCurrent()) return false;
        f.calls.push(target);
        return true;
    };
    const scope = createBorrowedPortalRenderScope(f.port);
    const pending = scope
        .getSnapshot()
        .actions.openChild('record_2', 'fld_title');
    f.replace();
    resume();
    assert.equal(await pending, false);
    assert.deepEqual(f.calls, []);
    scope.destroy();
});
it('an earlier snapshot read does not consume the subscription notification; retirement is once-only', () => {
    const f = fixture();
    const scope = createBorrowedPortalRenderScope(f.port);
    const seen: number[] = [];
    scope.subscribe((snapshot) => {
        seen.push(snapshot.revision);
    });
    f.replace();
    const changed = scope.getSnapshot();
    f.notify();
    f.notify();
    assert.deepEqual(seen, [1, changed.revision]);
    scope.destroy();
    scope.destroy();
    assert.equal(seen.length, 3);
    assert.equal(f.stops, 1);
});
