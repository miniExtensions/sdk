import {
    createElement as h,
    StrictMode,
    useState,
    type ChangeEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    getReadableStringFromAirtableValue,
    type AirtableField,
    type AirtableValue,
} from '@miniextensions/sdk/formulas';
import { projectPortalSummaryFields } from '@miniextensions/sdk/portals';
import {
    PortalSummaryCards,
    type PortalSummaryCard,
    type PortalSummaryFieldsHeight,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/portal-summary-cards.css';

// Synthetic accepted parent-record facts. A real application supplies its
// already-authorized parent snapshot and keeps admission and refresh ownership.
const fields: Record<
    string,
    { airtableField: Pick<AirtableField, 'name' | 'config'> }
> = {
    balance: {
        airtableField: {
            name: 'Account balance',
            config: { type: 'number', options: { precision: 2 } },
        },
    },
    notes: {
        airtableField: {
            name: 'Account notes',
            config: { type: 'singleLineText' },
        },
    },
    checked: {
        airtableField: {
            name: 'Confirmed',
            config: { type: 'checkbox' },
        },
    },
};
const parentSnapshots: readonly Readonly<Record<string, AirtableValue>>[] = [
    {
        balance: 0,
        notes: 'A long parent-record value. '.repeat(16),
        checked: false,
    },
    {
        balance: 125.5,
        notes: '<b>Literal parent text</b> & current values',
        checked: true,
    },
];
const selected = projectPortalSummaryFields({
    summaryFieldIds: ['balance', 'notes', 'checked', 'deleted', 'balance'],
    fieldIdsToSchemas: fields,
});

function App() {
    const [parent, setParent] = useState(0);
    const [height, setHeight] = useState<PortalSummaryFieldsHeight>('short');
    const [hideTitles, setHideTitles] = useState(false);
    const [mounted, setMounted] = useState(true);
    const cards: readonly PortalSummaryCard[] = selected.map((field) => ({
        ...field,
        readable: getReadableStringFromAirtableValue({
            value: parentSnapshots[parent]![field.fieldId],
            airtableFieldConfig: fields[field.fieldId]!.airtableField.config,
            fieldName: field.fieldName,
            source: {
                type: 'airtableMock',
                linkedTableStates: {},
                dateParsing: 'local',
            },
        }),
    }));
    return h(
        'main',
        null,
        h('h1', null, 'Portal parent-record summaries'),
        h(
            'p',
            null,
            'The host supplies parent values. Cards display inert formatted text without reading or saving records.'
        ),
        h(
            'div',
            { className: 'controls' },
            h(
                'button',
                { type: 'button', onClick: () => setParent(1 - parent) },
                'Replace accepted parent snapshot'
            ),
            h(
                'label',
                null,
                'Card height ',
                h(
                    'select',
                    {
                        value: height,
                        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                            const value = event.currentTarget.value;
                            if (
                                value === 'short' ||
                                value === 'medium' ||
                                value === 'tall' ||
                                value === 'extra tall'
                            ) {
                                setHeight(value);
                            }
                        },
                    },
                    ['short', 'medium', 'tall', 'extra tall'].map((value) =>
                        h('option', { key: value, value }, value)
                    )
                )
            ),
            h(
                'label',
                null,
                h('input', {
                    type: 'checkbox',
                    checked: hideTitles,
                    onChange: (event: ChangeEvent<HTMLInputElement>) =>
                        setHideTitles(event.currentTarget.checked),
                }),
                ' Hide titles'
            ),
            h(
                'button',
                { type: 'button', onClick: () => setMounted(!mounted) },
                mounted ? 'Unmount cards' : 'Mount cards'
            )
        ),
        mounted && h(PortalSummaryCards, { cards, height, hideTitles })
    );
}

const container = document.getElementById('app');
if (!container) throw new Error('Missing example container');
createRoot(container).render(h(StrictMode, null, h(App)));
