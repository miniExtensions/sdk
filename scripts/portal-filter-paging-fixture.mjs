import React from 'react';
import { createRoot } from 'react-dom/client';
import {
    PortalPagingControls,
    PortalVisitorFilter,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import * as ui from '@miniextensions/sdk/ui';
import { createListFixture } from './list-fixture.mjs';

const h = React.createElement;
const root = createRoot(document.querySelector('main'));
const records = createListFixture(ui);
const subscribers = new Set();
const requests = [];
const outcomes = [];
const keyboard = [];
const pending = new Map();
let activeRequest;
let offer;
let admittedRetry;
let staleOffer;
let staleSettlement;
let submits = 0;
let state = { type: 'ready', hasNextPage: false };
let cursor = null;
let frame = {
    stamp: {
        sessionId: 'visitor',
        fieldId: records.initial.portalFieldId,
        viewId: 'first-view',
        configurationRevision: 1,
        metadataRevision: 1,
        generation: 1,
    },
    fields: [
        {
            id: 'fld_title',
            name: 'Title',
            operators: [
                {
                    label: 'Contains',
                    setting: {
                        fieldType: 'singleLineText',
                        type: 'contains',
                        idOrName: { type: 'id', id: 'fld_title' },
                        value: 'Keep',
                    },
                    operand: { kind: 'text' },
                },
            ],
        },
    ],
    criteria: null,
};

function publishFrame(change) {
    frame = {
        ...frame,
        ...change,
        stamp: {
            ...frame.stamp,
            ...change.stamp,
            generation: frame.stamp.generation + 1,
        },
    };
    for (const listener of subscribers) listener();
}

function showRow(recordId, title) {
    const [row] = records.initial.records;
    records.replace({
        ...records.initial,
        records: [
            {
                ...row,
                id: recordId,
                fields: { ...row.fields, fld_title: title },
            },
        ],
    });
}

function startRead(intent, offset = null) {
    const { generation } = frame.stamp;
    const requestId = 'read-' + (requests.length + 1);
    activeRequest = { intent, requestId, generation, cursor: offset };
    requests.push(activeRequest);
    pending.set(requestId, activeRequest);
    offer = undefined;
    state = { type: offset === null ? 'initial-loading' : 'next-loading' };
    draw();
    return { type: 'allocated', requestId, generation };
}

function settleFirst(requestId, result) {
    const receipt = pending.get(requestId);
    if (!receipt) throw new Error('Attempted to settle a missing First');
    pending.delete(requestId);
    if (
        receipt !== activeRequest ||
        receipt.generation !== frame.stamp.generation
    )
        return 'retired';
    activeRequest = undefined;
    if (result.type === 'failed') {
        state = {
            type: 'first-error',
            message: 'Primera página no disponible',
        };
        const failedGeneration = receipt.generation;
        const failedOffer = {
            activate(intent, isCurrent) {
                const current = isCurrent();
                const admitted =
                    offer === failedOffer &&
                    frame.stamp.generation === failedGeneration &&
                    current &&
                    intent === 'retry-first-page';
                if (!admitted) return { current, admitted };
                admittedRetry = {
                    offer: failedOffer,
                    isCurrent,
                    current,
                    receipt: startRead(intent),
                };
                return { current, admitted };
            },
        };
        offer = failedOffer;
    } else {
        showRow(result.id, result.title);
        state = { type: 'ready', hasNextPage: false };
    }
    draw();
    return 'settled';
}

const port = {
    read: () => frame,
    subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
    },
    apply(command) {
        if (JSON.stringify(command.stamp) !== JSON.stringify(frame.stamp))
            return { type: 'stale' };
        publishFrame({ criteria: command.criteria });
        return startRead('filter-first');
    },
};

function draw() {
    root.render(
        h(
            React.StrictMode,
            null,
            h(PortalVisitorFilter, {
                port,
                onOutcome: (outcome) => outcomes.push(outcome),
            }),
            h(
                'section',
                { 'data-fixture': 'rows' },
                h(ReadonlyPortalRecords, {
                    scope: records.scope,
                    layout: 'list',
                    label: 'Records',
                    grid: {
                        ready: true,
                        preferenceScopeKey: 'view',
                        primaryFieldId: null,
                        hiddenColumns: {},
                        columnWidths: {},
                    },
                    renderers: {
                        renderSingleLineTextField(field) {
                            return h('span', null, String(field.value ?? ''));
                        },
                    },
                })
            ),
            h(PortalPagingControls, {
                state,
                offer,
                labels: { loadMore: 'Más registros', retry: 'Reintentar' },
            })
        )
    );
}

document.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    submits++;
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.textContent === 'Reintentar')
        keyboard.push({
            trusted: event.isTrusted,
            label: event.target.textContent,
        });
});

showRow('rec_original', 'Previously accepted');
draw();
globalThis.filterPaging = {
    failFirst: () => settleFirst(requests[0].requestId, { type: 'failed' }),
    redraw: draw,
    replaceQuery() {
        publishFrame({ stamp: { viewId: 'replacement' }, criteria: null });
        activeRequest = undefined;
        cursor = 'replacement-page';
        const replacementGeneration = frame.stamp.generation;
        const replacementOffer = {
            activate(intent, isCurrent) {
                if (
                    offer === replacementOffer &&
                    frame.stamp.generation === replacementGeneration &&
                    intent === 'next-page' &&
                    isCurrent()
                )
                    startRead(intent, cursor);
            },
        };
        offer = replacementOffer;
        showRow('rec_replacement', 'Replacement row');
        state = { type: 'ready', hasNextPage: true };
        draw();
    },
    deliverRetired() {
        const { offer, isCurrent, receipt } = admittedRetry;
        staleOffer = offer.activate('retry-first-page', isCurrent);
        staleSettlement = settleFirst(receipt.requestId, {
            type: 'accepted',
            id: 'rec_retired',
            title: 'Retired row',
        });
    },
    snapshot: () => ({
        requests,
        outcomes,
        keyboard,
        submits,
        cursor,
        state,
        staleOffer,
        staleSettlement,
        criteria: frame.criteria,
        generation: frame.stamp.generation,
        pending: [...pending.keys()],
        retryAdmittedWhileCurrent: admittedRetry?.current === true,
        react: React.version,
    }),
    close() {
        root.unmount();
        records.scope.destroy();
        return { filter: subscribers.size, records: records.subscriptions };
    },
};
