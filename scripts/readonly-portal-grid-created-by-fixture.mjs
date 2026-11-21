import { getReadableStringFromAirtableValue } from '@miniextensions/sdk/formulas';
import {
    CompleteReadOnlyTextField,
    CreatedByField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';
import { createElement as h, StrictMode, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const creator = {
    id: 'usrFixtureCreator',
    name: 'Fixture Creator',
    email: 'creator@example.invalid',
    profilePicUrl: 'https://media.example.invalid/approved',
};
const other = {
    id: 'usrOtherCreator',
    name: 'https://literal.example.invalid',
    email: 'other@example.invalid',
    profilePicUrl: 'https://media.example.invalid/denied',
};
const rows = [
    {
        id: 'recCreator',
        title: 'Approved avatar',
        value: creator,
        label: creator.name,
    },
    {
        id: 'recOther',
        title: 'Unmapped avatar',
        value: other,
        label: other.name,
    },
    { id: 'recNull', title: 'Explicit null', value: null, label: '' },
    { id: 'recOmitted', title: 'Omitted', label: '' },
    {
        id: 'recEmptyName',
        title: 'Empty name',
        value: { ...other, name: '' },
        label: '',
    },
];
const columns = [
    ['fldName', 'Name', 'singleLineText'],
    ['fldCreator', 'Created By', 'createdBy'],
    ['fldNote', 'Note', 'singleLineText'],
];
const fields = columns.map(([id, name, type]) => ({
    id,
    name,
    description: '',
    isPrimaryField: id === 'fldName',
    isComputed: type === 'createdBy',
    config: { type, options: type === 'createdBy' ? { choices: [] } : null },
}));
const detailFields = fields.map(({ id, name }) => ({
    fieldId: id,
    fieldName: name,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {
        title: name,
        readOnly: true,
        conditionalFields: { logicalOperator: 'and', conditions: [] },
    },
}));
const copyRecords = (ordered) =>
    ordered.map(({ id, title, value }) => ({
        id,
        fields: {
            fldName: title,
            ...(value === undefined ? {} : { fldCreator: value }),
            fldNote: `Keep ${title}`,
        },
    }));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

const container = document.getElementById('grid');
const root = createRoot(container);
const listeners = new Set();
const originalNodes = new Map();
const delivered = new Set();
const effects = { opens: [], requests: 0, writes: 0, submits: 0 };
const avatarPath = window.location.pathname + 'avatar.svg';
const avatarPolicy = {
    type: 'source',
    getSource(url) {
        return url === creator.profilePicUrl
            ? { src: avatarPath, loading: 'eager' }
            : null;
    },
};
const originalFetch = window.fetch;
const originalXhrOpen = XMLHttpRequest.prototype.open;
const refuseRequest = () => {
    effects.requests++;
    throw new Error('Unexpected provider request');
};
window.fetch = async () => refuseRequest();
XMLHttpRequest.prototype.open = refuseRequest;
let stamp = {};
let ordered = rows;
let records = copyRecords(ordered);
let subscriptions = 0;
const owned = createBorrowedPortalRenderScope({
    capture: () => ({
        stamp,
        projection: {
            portalFieldId: 'fldBooks',
            linkedTableId: 'tblBooks',
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
    invokeIfCurrent(expected, target, isCurrent) {
        assert(expected === stamp && isCurrent(), 'Retired Open action');
        effects.opens.push(target);
        return true;
    },
});
const scope = {
    ...owned,
    subscribe(listener) {
        const unsubscribe = owned.subscribe(listener);
        subscriptions++;
        return () => {
            unsubscribe();
            subscriptions--;
        };
    },
};
const grid = {
    ready: true,
    preferenceScopeKey: 'readonly-created-by-grid',
    primaryFieldId: 'fldName',
    columnWidths: {},
    hiddenColumns: {},
    recordLabel: (id) => rows.find((row) => row.id === id)?.title ?? null,
};
const renderers = {
    renderSingleLineTextField: ({ value }) =>
        h(CompleteReadOnlyTextField, { value, language: 'en' }),
    renderCreatedByField(field) {
        equal(
            [
                field.fieldId,
                field.context,
                field.physicalKind,
                field.computed,
                field.capability.type,
            ],
            ['fldCreator', 'portal-detail', 'createdBy', true, 'readonly'],
            'Expected the readonly physical Created By detail slot'
        );
        equal(field.field.config, fields[1].config, 'Created By schema');
        delivered.add(JSON.stringify([field.value === undefined, field.value]));
        // Match the native Grid gate before calling the controlled display.
        if (
            field.value == null ||
            getReadableStringFromAirtableValue({
                value: field.value,
                airtableFieldConfig: field.field.config,
                fieldName: field.field.name,
                source: {
                    type: 'airtableMock',
                    linkedTableStates: {},
                    dateParsing: 'local',
                },
            }) === ''
        )
            return h('span', { className: 'read-only-text' });
        return h(CreatedByField, {
            mode: 'controlled',
            value: field.value,
            title: field.title,
            showLabel: false,
            avatarPolicy,
        });
    },
};

function tree() {
    const visible = scope.getSnapshot();
    const byRecordId = new Map(
        visible.rows.map(({ recordId }) => [
            recordId,
            {
                revision: visible.revision,
                activate(isCurrent) {
                    if (isCurrent()) void visible.actions.openRow(recordId);
                },
            },
        ])
    );
    return h(
        StrictMode,
        null,
        h(
            'form',
            {
                onInput() {
                    effects.writes++;
                },
                onChange() {
                    effects.writes++;
                },
                onSubmit(event) {
                    event.preventDefault();
                    effects.submits++;
                },
            },
            h(ReadonlyPortalRecords, {
                scope,
                layout: 'grid',
                grid,
                renderers,
                openActions: { scope, byRecordId },
            })
        )
    );
}

function observe(republished = false) {
    const headers = [...container.querySelectorAll('th[data-field-id]')];
    equal(
        headers.map((node) => [node.dataset.fieldId, node.textContent.trim()]),
        columns.map(([id, title]) => [id, title]),
        'Field identities'
    );
    const domRows = [...container.querySelectorAll('tr[data-record-id]')];
    equal(
        domRows.map((row) => row.dataset.recordId),
        ordered.map(({ id }) => id),
        'Record order and identities'
    );
    const editors =
        'input,button,a,textarea,select,[tabindex],[contenteditable],[role="combobox"],[data-testid="no-value-test-id"]';
    let retained = 0;
    const cells = domRows.map((domRow, index) => {
        const { id, title, value, label } = ordered[index];
        const entries = [...domRow.querySelectorAll('td[data-field-id]')];
        const values = entries.map((cell) => [
            cell.dataset.fieldId,
            cell.dataset.primary,
            cell.textContent.trim(),
        ]);
        equal(
            values,
            [
                ['fldName', 'true', title],
                ['fldCreator', 'false', label],
                ['fldNote', 'false', `Keep ${title}`],
            ],
            `Read-only text cells for ${id}`
        );
        equal(
            Object.hasOwn(records[index].fields, 'fldCreator'),
            value !== undefined,
            `Raw presence for ${id}`
        );
        assert(
            !entries[1].querySelector(editors),
            `Created By control for ${id}`
        );
        const badge = entries[1].querySelector('.mx-sdk-collaborator-name');
        const images = [...entries[1].querySelectorAll('img')];
        const group = entries[1].querySelector('[role="group"]');
        equal(badge?.textContent ?? '', label, `Literal badge label for ${id}`);
        equal(
            group?.getAttribute('aria-label') ?? null,
            label ? 'Created By' : null,
            `Accessible group for ${id}`
        );
        if (!label)
            equal(
                entries[1].firstElementChild.innerHTML,
                '<span class="read-only-text"></span>',
                `Native blank for ${id}`
            );
        equal(
            images.map((img) => [
                img.getAttribute('src'),
                img.getAttribute('alt'),
                img.getAttribute('width'),
                img.getAttribute('height'),
            ]),
            id === 'recCreator' ? [[avatarPath, '', '32', '32']] : [],
            `Owned avatar for ${id}`
        );
        for (const node of [domRow, ...entries]) {
            const key = `${id}/${node.dataset.fieldId ?? ''}`;
            if (republished) {
                assert(originalNodes.get(key) === node, `Remounted ${key}`);
                retained++;
            } else originalNodes.set(key, node);
        }
        return {
            id,
            values,
            label,
            hasValue: value !== undefined,
            avatar: images.length,
        };
    });
    equal(
        delivered.size,
        rows.length,
        'Raw present, null and omitted slot values'
    );
    assert(
        rows.every(({ value }) =>
            delivered.has(JSON.stringify([value === undefined, value]))
        ),
        'Raw Created By slot emissions'
    );
    equal(
        container.querySelectorAll('button').length,
        rows.length,
        'Only separate Open buttons'
    );
    equal(
        container.querySelectorAll('[aria-selected="true"]').length,
        0,
        'No selected record or cell'
    );
    equal(window.getSelection()?.toString() ?? '', '', 'No selected text');
    return {
        cells,
        retained,
        effects: { ...effects, opens: [...effects.opens] },
    };
}

flushSync(() => root.render(tree()));
const initial = observe();
window.createdByGrid = {
    observe() {
        return { react: version, ...observe(true) };
    },
    initial,
    republish() {
        delivered.clear();
        const before = scope.getSnapshot().revision;
        flushSync(() => {
            stamp = {};
            ordered = [...rows].reverse();
            records = copyRecords(ordered);
            for (const listener of [...listeners]) listener();
            root.render(tree());
        });
        assert(scope.getSnapshot().revision > before, 'No fresh projection');
        return observe(true);
    },
    dispose() {
        try {
            flushSync(() => root.unmount());
        } finally {
            owned.destroy();
            window.fetch = originalFetch;
            XMLHttpRequest.prototype.open = originalXhrOpen;
        }
        equal(
            [listeners.size, subscriptions, container.childElementCount],
            [0, 0, 0],
            'Grid teardown'
        );
        return {
            listeners: listeners.size,
            subscriptions,
            effects: { ...effects, opens: [...effects.opens] },
        };
    },
};
