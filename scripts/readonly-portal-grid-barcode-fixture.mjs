import { StrictMode, createElement as h, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BarcodeField, ReadonlyPortalRecords } from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const destination = 'https://example.invalid/scan/00042';
const cases = [
    ['Leading zero', { text: '0000042189', type: 'code128' }],
    [
        'Unicode and punctuation',
        { text: '雪 / café <tag> [#] & "quote" + ?!', type: 'qr' },
    ],
    ['URL-shaped', { text: destination, type: 'qr' }],
    ['Empty', { text: '', type: 'qr' }],
    ['Null', null],
    ['Omitted', undefined],
];
const columns = [
    ['fldName', 'Name', 'singleLineText'],
    ['fldBarcode', 'Barcode', 'barcode'],
    ['fldNeighbor', 'Neighbor', 'singleLineText'],
];
const fields = columns.map(([id, name, type]) => ({
    id,
    name,
    description: null,
    isComputed: false,
    isPrimaryField: id === 'fldName',
    config: { type, options: null },
}));
const detailFields = fields.map((field) => ({
    fieldId: field.id,
    fieldName: field.name,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {
        title: field.name,
        conditionalFields: { logicalOperator: 'and', conditions: [] },
    },
}));
const freezeRecords = (rows) =>
    Object.freeze(
        rows.map(({ id, fields: record }) => {
            if (record.fldBarcode) Object.freeze(record.fldBarcode);
            return Object.freeze({ id, fields: Object.freeze(record) });
        })
    );
const recordId = (index) => `recBarcode${index + 1}`;
const originalRecords = freezeRecords(
    cases.map(([name, value], index) => ({
        id: recordId(index),
        fields: {
            fldName: name,
            ...(value === undefined ? {} : { fldBarcode: value }),
            fldNeighbor: `Keep ${index + 1}`,
        },
    }))
);

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const equal = (actual, expected, message) =>
    assert(JSON.stringify(actual) === JSON.stringify(expected), message);
const effects = {
    intent: 0,
    input: 0,
    write: 0,
    submit: 0,
    request: 0,
    camera: 0,
};
const trusted = { click: 0, Enter: 0, Escape: 0 };
const delivered = new Set();
const listeners = new Set();
let consumers = 0;
let records = originalRecords;
let stamp = {};
const owner = createBorrowedPortalRenderScope({
    capture: () => ({
        stamp,
        projection: {
            portalFieldId: 'fldBarcodeRecords',
            linkedTableId: 'tblBarcodeRecords',
            records,
            table: { airtableFields: fields },
            detailProjection: 'present',
            detailFields,
        },
    }),
    isCurrent: (expected) => expected === stamp,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    invokeIfCurrent() {
        effects.intent++;
        return false;
    },
});
const scope = {
    ...owner,
    subscribe(listener) {
        consumers++;
        const unsubscribe = owner.subscribe(listener);
        return () => {
            consumers--;
            unsubscribe();
        };
    },
};
const renderers = {
    renderSingleLineTextField: ({ value }) => h('span', null, value),
    renderBarcodeField(field) {
        assert(
            field.fieldId === 'fldBarcode' &&
                field.context === 'portal-detail' &&
                field.physicalKind === 'barcode' &&
                !field.computed &&
                field.capability.type === 'readonly',
            'Expected the admitted physical Barcode slot'
        );
        const value = field.value;
        delivered.add(
            value === undefined
                ? 'omitted'
                : value === null
                  ? 'null'
                  : JSON.stringify(value)
        );
        // Native Grid keeps a blank cell before delegating to ReadOnlyField.
        return value?.text
            ? h(BarcodeField, {
                  mode: 'controlled',
                  displayOnly: true,
                  readOnly: true,
                  value,
                  language: 'en',
                  onChange: () => effects.write++,
              })
            : null;
    },
};

const node = document.getElementById('grid');
const output = document.getElementById('receipt');
const republish = document.getElementById('republish');
const dispose = document.getElementById('dispose');
const app = createRoot(node);
const startingUrl = location.href;
const events = new AbortController();
const initialFetch = window.fetch;
const initialOpen = XMLHttpRequest.prototype.open;
const media = navigator.mediaDevices;
const getUserMedia = media?.getUserMedia;
const denied = () => {
    effects.request++;
    throw new Error('Unexpected Grid request');
};
window.fetch = async () => denied();
XMLHttpRequest.prototype.open = denied;
if (getUserMedia)
    media.getUserMedia = async () => {
        effects.camera++;
        throw new Error('Unexpected Grid camera access');
    };
node.addEventListener(
    'click',
    (event) => {
        if (
            event.isTrusted &&
            event.target.closest(
                'tr[data-record-id="recBarcode1"] td[data-field-id="fldBarcode"]'
            )
        )
            trusted.click++;
    },
    { signal: events.signal }
);
document.addEventListener(
    'keydown',
    (event) => {
        if (
            event.isTrusted &&
            (event.key === 'Enter' || event.key === 'Escape')
        )
            trusted[event.key]++;
    },
    { signal: events.signal }
);

const receipt = {
    react: version,
    initial: null,
    republished: null,
    disposed: null,
    error: null,
};
let initialNodes;
function run(action) {
    try {
        action();
    } catch (error) {
        receipt.error = String(error.message ?? error);
        throw error;
    } finally {
        output.textContent = JSON.stringify(receipt);
    }
}
function assertInert() {
    assert(location.href === startingUrl, 'Grid navigated');
    assert(
        Object.values(effects).every((value) => value === 0),
        'Unexpected Grid effect'
    );
    assert(
        !document.querySelector(
            '#grid :is(input,button,select,textarea,[contenteditable="true"],[role="button"],[aria-selected="true"]), dialog, [role="dialog"], video'
        ),
        'Unexpected editor, Open, Clear, scanner, or row selection'
    );
}
function capture() {
    const headers = [...node.querySelectorAll('thead th[data-field-id]')];
    equal(
        headers.map((header) => [
            header.dataset.fieldId,
            header.innerText.trim(),
        ]),
        columns.map(([id, name]) => [id, name]),
        'Stable and named headers'
    );
    const rows = [...node.querySelectorAll('tbody tr[data-record-id]')];
    equal(
        rows.map((row) => row.dataset.recordId),
        cases.map((_, index) => recordId(index)),
        'Stable row keys'
    );
    const nodes = rows.flatMap((row) => [row, ...row.querySelectorAll('td')]);
    const stableNodes = initialNodes
        ? nodes.filter((item, index) => item === initialNodes[index]).length
        : 0;
    assert(
        !initialNodes || stableNodes === nodes.length,
        'Equivalent republication replaced rows or cells'
    );
    initialNodes ??= nodes;
    const cells = rows.map((row, index) => {
        const [name, value] = cases[index];
        const data = [...row.querySelectorAll('td[data-field-id]')];
        equal(
            data.map((cell) => [cell.dataset.fieldId, cell.innerText.trim()]),
            [
                ['fldName', name],
                ['fldBarcode', value?.text ?? ''],
                ['fldNeighbor', `Keep ${index + 1}`],
            ],
            `Incorrect Barcode or neighbor for ${name}`
        );
        const cell = data[1];
        const links = [...cell.querySelectorAll('a')];
        assert(
            links.length === (index === 2 ? 1 : 0),
            `Unexpected link count for ${name}`
        );
        if (links.length) {
            equal(
                [links[0].innerText, links[0].getAttribute('href')],
                [destination, destination],
                'URL display or destination changed'
            );
        }
        assert(
            !cell.querySelector('tag'),
            'Literal punctuation rendered as markup'
        );
        assert(
            value?.text || cell.childElementCount === 0,
            'Blank cell inherited leaf placeholder'
        );
        return {
            row: row.dataset.recordId,
            barcode: cell.innerText.trim(),
            href: links[0]?.getAttribute('href') ?? null,
            neighbor: data[2].innerText.trim(),
        };
    });
    for (const [, value] of cases) {
        const category =
            value === undefined
                ? 'omitted'
                : value === null
                  ? 'null'
                  : JSON.stringify(value);
        assert(
            delivered.has(category),
            `Barcode slot did not receive ${category}`
        );
    }
    equal(
        [
            Object.hasOwn(records[3].fields, 'fldBarcode'),
            Object.hasOwn(records[4].fields, 'fldBarcode'),
            Object.hasOwn(records[5].fields, 'fldBarcode'),
        ],
        [true, true, false],
        'Original blank variants changed'
    );
    assertInert();
    return {
        revision: scope.getSnapshot().revision,
        stableNodes,
        cells,
        cameraGuard: typeof getUserMedia === 'function',
    };
}
run(() => {
    flushSync(() =>
        app.render(
            h(
                StrictMode,
                null,
                h(
                    'form',
                    {
                        'aria-label': 'Read-only Barcode fixture',
                        onInput: () => effects.input++,
                        onSubmit(event) {
                            event.preventDefault();
                            effects.submit++;
                        },
                    },
                    h(ReadonlyPortalRecords, {
                        layout: 'grid',
                        scope,
                        renderers,
                        grid: {
                            ready: true,
                            preferenceScopeKey: 'readonly-barcode-grid',
                            primaryFieldId: 'fldName',
                            hiddenColumns: {},
                            columnWidths: {},
                        },
                    })
                )
            )
        )
    );
    assert(
        consumers > 0 && listeners.size === 1,
        'Grid did not subscribe to its owner'
    );
    receipt.initial = capture();
});
republish.addEventListener('click', () =>
    run(() => {
        equal(
            trusted,
            { click: 1, Enter: 1, Escape: 1 },
            'Expected one trusted click, Enter and Escape'
        );
        records = freezeRecords(structuredClone(originalRecords));
        stamp = {};
        flushSync(() => {
            for (const listener of listeners) listener();
        });
        receipt.republished = capture();
        assert(
            receipt.republished.revision > receipt.initial.revision,
            'Grid ignored equivalent host republication'
        );
        equal(
            receipt.republished.cells,
            receipt.initial.cells,
            'Barcode moved on republication'
        );
        receipt.republished.trusted = { ...trusted };
    })
);
dispose.addEventListener('click', () =>
    run(() => {
        flushSync(() => app.unmount());
        assert(
            consumers === 0 && listeners.size === 1,
            'Grid or owner subscription lifetime differed'
        );
        owner.destroy();
        events.abort();
        assert(
            listeners.size === 0 && node.childElementCount === 0,
            'Disposed fixture retained rendered or subscribed state'
        );
        assertInert();
        window.fetch = initialFetch;
        XMLHttpRequest.prototype.open = initialOpen;
        if (getUserMedia) media.getUserMedia = getUserMedia;
        republish.disabled = true;
        dispose.disabled = true;
        receipt.disposed = {
            gridSubscriptions: consumers,
            hostSubscriptions: listeners.size,
            renderedChildren: node.childElementCount,
            effects: { ...effects },
        };
    })
);
