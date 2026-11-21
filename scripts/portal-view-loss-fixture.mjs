import {
    createElement as h,
    useMemo,
    useSyncExternalStore,
    version,
} from 'react';
import {
    createNativePortalCollectionKernel,
    resolvePortalShellSelection,
    runNativePortalCollectionRead,
} from '@miniextensions/sdk/portals';
import {
    CompletePortalShell,
    CompleteReadOnlyTextField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const fieldId = 'fld_orders';
const tableId = 'tbl_orders';
const viewId = 'view_allowed';
const sessionId = 'synthetic-portal';
const titleId = 'fld_title';
const menu = (allowed) => [
    {
        type: 'table',
        id: fieldId,
        label: 'Orders',
        views: allowed ? [{ id: viewId, label: 'Allowed orders' }] : [],
    },
];
const binding = (selection, epoch) => ({
    sessionId,
    fieldId,
    linkedTableId: tableId,
    bindingKey: (selection?.viewId ?? 'unavailable') + ':' + epoch,
    fetchOwnerKey: 'synthetic-owner:' + epoch,
    cacheOwnerEpoch: 1,
});
const schemaField = (id, name, primary) => ({
    id,
    name,
    description: null,
    isPrimaryField: primary,
    isComputed: false,
    config: { type: 'singleLineText', options: null },
});
const detail = (fieldId, fieldName) => ({
    fieldId,
    fieldName,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {
        title: fieldName,
        conditionalFields: { logicalOperator: 'and', conditions: [] },
    },
});

function response(marker) {
    const id = 'rec_' + marker;
    const detailId = 'fld_' + marker + '_detail';
    const fields = {
        [titleId]: marker + ' order',
        [detailId]: marker + ' detail',
    };
    const primary = detail(titleId, 'Order');
    return {
        recordIds: [id],
        recordsById: { [id]: { id, fields } },
        schema: [
            schemaField(titleId, 'Order', true),
            schemaField(detailId, marker + ' details', false),
        ],
        linkedTableId: tableId,
        details: {
            presence: 'present',
            fields: [primary, detail(detailId, marker + ' details')],
        },
        primary,
        nextOffset: 'cursor_' + marker,
        projection: { marker, detailId },
    };
}

const renderers = {
    renderSingleLineTextField: ({ value, capability }) => {
        if (capability.type !== 'readonly')
            throw new Error('Editable Portal cell');
        return h(CompleteReadOnlyTextField, { value, language: 'en' });
    },
};

export function createPortalViewLossFixture(container) {
    const kernel = createNativePortalCollectionKernel();
    const listeners = new Set();
    const pending = new Map();
    const outcomes = new Map();
    const proof = {
        reads: [],
        retirements: [],
        publications: [],
        opens: [],
        shellIntents: [],
        unexpected: [],
        commits: 0,
        writes: 0,
        submits: 0,
    };
    const items = menu(true);
    const initialSelection = resolvePortalShellSelection({
        items,
        initialSelection: { viewId },
        phase: 'initial',
    });
    let current = {
        collection: kernel.createState(binding(initialSelection, 1)),
        shell: {
            scope: sessionId,
            revision: 1,
            items,
            selection: initialSelection,
            selectionPolicy: 'host',
            header: { layout: 'sidebar', title: 'Synthetic Orders Portal' },
        },
        compatibility: null,
    };
    let requestNumber = 0;
    let heldOpen;
    const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const getSnapshot = () => current;
    const submit = (event) => {
        event.preventDefault();
        proof.submits++;
    };
    container.addEventListener('submit', submit);

    function publish(next) {
        const old = current.collection;
        if (old.active && next.collection.generation > old.generation) {
            proof.retirements.push({
                requestId: old.active.requestId,
                before: old.generation,
                after: next.collection.generation,
                stillCurrent: kernel.isCurrent(next.collection, old.active),
            });
        }
        current = next;
        proof.commits++;
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch (error) {
                proof.unexpected.push(String(error));
            }
        }
    }

    const host = {
        snapshot: () => current.collection,
        commit(expected, transition) {
            if (current.collection !== expected) return false;
            const publication = transition.compatibility;
            if (publication)
                proof.publications.push(structuredClone(publication));
            publish({
                ...current,
                collection: transition.state,
                compatibility: publication ?? current.compatibility,
            });
            return true;
        },
        allocate(receipt, plan) {
            proof.reads.push({
                id: receipt.requestId,
                viewId: current.shell.selection?.viewId ?? null,
                binding: receipt.scope.bindingKey,
                generation: receipt.generation,
                ...plan,
            });
            if (
                !current.shell.selection ||
                !kernel.isCurrent(current.collection, receipt)
            ) {
                proof.unexpected.push(
                    'Allocation without a committed permitted receipt'
                );
                throw new Error('Unadmitted allocation');
            }
            return new Promise((resolve) =>
                pending.set(receipt.requestId, resolve)
            );
        },
        cleanupScope() {
            proof.unexpected.push('Unexpected correction');
            return current.collection.scope;
        },
        scheduleNotice() {
            proof.unexpected.push('Unexpected notice');
        },
        nextRequestId: () => 'read-' + ++requestNumber,
    };

    function startRead(mode) {
        if (!current.shell.selection) return;
        const requestId = host.nextRequestId();
        const outcome = runNativePortalCollectionRead(kernel, host, {
            requestId,
            mode,
            onlyIfNotFetched: false,
        });
        outcomes.set(requestId, outcome);
    }

    const acceptedFrame = () =>
        current.shell.selection && current.collection.paging.type === 'loaded'
            ? current.collection.frame
            : null;
    const scope = createBorrowedPortalRenderScope({
        capture() {
            const frame = acceptedFrame();
            if (!frame) return null;
            return {
                stamp: frame,
                projection: {
                    portalFieldId: fieldId,
                    linkedTableId: frame.linkedTableId,
                    records: frame.records,
                    table: { airtableFields: frame.schema },
                    detailProjection: frame.details.presence,
                    detailFields: frame.details.fields,
                },
            };
        },
        isCurrent: (stamp) => stamp === acceptedFrame(),
        subscribe,
        invokeIfCurrent(frame, target, isCurrent) {
            if (target.action !== 'open-child') {
                proof.unexpected.push('Unexpected borrowed action');
                return false;
            }
            if (!isCurrent() || frame !== acceptedFrame()) return false;
            proof.opens.push({
                action: target.action,
                recordId: target.recordId,
                fieldId,
                tableId: frame.linkedTableId,
                viewId: current.shell.selection.viewId,
                sessionId,
                frameId: frame.id,
            });
            return true;
        },
    });

    const countWrite = () => {
        proof.writes++;
    };
    const grid = {
        ready: true,
        preferenceScopeKey: sessionId,
        primaryFieldId: titleId,
        hiddenColumns: {},
        columnWidths: {},
        onFieldHiddenChange: countWrite,
        onColumnWidthCommit: countWrite,
    };
    function App() {
        const { shell, collection } = useSyncExternalStore(
            subscribe,
            getSnapshot
        );
        const frame =
            shell.selection && collection.paging.type === 'loaded'
                ? collection.frame
                : null;
        const visible = useMemo(() => scope.getSnapshot(), [frame]);
        const actions = useMemo(
            () =>
                new Map(
                    visible.rows.map(({ recordId }) => [
                        recordId,
                        {
                            revision: visible.revision,
                            activate(isCurrent) {
                                if (isCurrent())
                                    void visible.actions.openChild(recordId);
                            },
                        },
                    ])
                ),
            [visible]
        );
        return h(
            CompletePortalShell,
            {
                snapshot: shell,
                labels: { empty: 'No permitted views' },
                onIntent: (intent) => proof.shellIntents.push(intent.type),
            },
            h(
                'section',
                { 'aria-label': 'Accepted orders' },
                collection.frame &&
                    h(
                        'button',
                        {
                            type: 'button',
                            'data-proof-reload': '',
                            disabled: collection.paging.isReloading,
                            onClick() {
                                startRead('reload');
                            },
                        },
                        'Reload'
                    ),
                h(ReadonlyPortalRecords, {
                    scope,
                    layout: 'list',
                    grid,
                    renderers,
                    openActions: { scope, byRecordId: actions },
                })
            )
        );
    }

    return {
        App,
        start() {
            startRead('first');
        },
        rememberOpen() {
            const visible = scope.getSnapshot();
            const { recordId } = visible.rows[0];
            heldOpen = () => visible.actions.openChild(recordId);
        },
        tryOldOpen() {
            return heldOpen();
        },
        setAllowed(allowed) {
            if (Boolean(current.shell.selection) === allowed) return;
            const items = menu(allowed);
            const selection = resolvePortalShellSelection({
                items,
                selection: current.shell.selection,
                phase: 'reconcile',
            });
            const revision = current.shell.revision + 1;
            const collection = kernel.observe(
                current.collection,
                binding(selection, revision),
                {
                    paging: {
                        type: 'loaded',
                        recordIds: [],
                        nextOffset: null,
                        isPaginating: false,
                        isReloading: false,
                    },
                }
            );
            publish({
                collection,
                shell: { ...current.shell, revision, items, selection },
                compatibility: null,
            });
            if (selection) startRead('first');
        },
        async settle(requestId, marker) {
            const resolve = pending.get(requestId);
            if (!resolve) throw new Error('No deferred read ' + requestId);
            const before = current;
            pending.delete(requestId);
            resolve({ type: 'response', response: response(marker) });
            const result = await outcomes.get(requestId);
            outcomes.delete(requestId);
            return { result, samePublication: before === current };
        },
        observe() {
            const { collection, shell, compatibility } = current;
            const rendered = container.querySelector('.mx-sdk-portal-content');
            const view = scope.getSnapshot();
            return structuredClone({
                react: version,
                generation: collection.generation,
                selection: shell.selection,
                active: collection.active?.requestId ?? null,
                isReloading: collection.paging.isReloading,
                frame: collection.frame,
                paging: {
                    ids: collection.paging.recordIds,
                    cursor: collection.paging.nextOffset,
                },
                compatibility,
                scopeRevision: view.revision,
                admitted: view.rows.map(({ recordId }) => recordId),
                dom: {
                    rows: [
                        ...(rendered?.querySelectorAll('[data-record-id]') ??
                            []),
                    ].map((row) => ({
                        id: row.dataset.recordId,
                        cells: [...row.querySelectorAll('[data-field-id]')].map(
                            (cell) => [cell.dataset.fieldId, cell.textContent]
                        ),
                    })),
                    open:
                        rendered?.querySelectorAll(
                            '.mx-sdk-readonly-portal-list__open'
                        ).length ?? 0,
                    reload:
                        rendered?.querySelectorAll('[data-proof-reload]')
                            .length ?? 0,
                    status:
                        rendered?.querySelector('[role="status"]')
                            ?.textContent ?? null,
                },
                pending: [...pending.keys()],
                proof,
            });
        },
        destroy() {
            const before = listeners.size;
            scope.destroy();
            container.removeEventListener('submit', submit);
            return {
                before,
                after: listeners.size,
                pending: pending.size,
                outcomes: outcomes.size,
            };
        },
    };
}
