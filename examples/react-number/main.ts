import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    createNumberFieldModel,
    type FieldRendererHost,
    type FieldRendererHostSnapshot,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import { FieldRenderer, renderNumberField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/number.css';
import './styles.css';

// Synthetic accepted hosts. Owners live outside React and use the public scalar
// model; a real Form/Portal supplies those owners and its separate Save action.
let writes = 0;
function make(
    title: string,
    initial: number | null,
    config: FieldRendererProps<'number'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        noScalar?: boolean;
    } = {}
) {
    let value = initial;
    let writable = !options.readonly && !options.pending;
    const listeners = new Set<(state: FieldRendererHostSnapshot) => void>();
    const write = (next: number | boolean | null) => {
        if (!writable || typeof next === 'boolean') return false;
        value = next;
        document.getElementById('writes')!.textContent = String(++writes);
        document.getElementById('native')!.textContent = JSON.stringify(
            cards[0].getValue()
        );
        // Match an owner that notifies its hosts during a synchronous native write.
        emit();
        return true;
    };
    const scalar = createNumberFieldModel({
        getValue: () => value,
        canEdit: () => writable,
        isCurrent: () => true,
        write,
    });
    const emit = () => {
        for (const listener of listeners) listener(host.getSnapshot());
    };
    const host: FieldRendererHost = {
        getSnapshot: () => ({
            status: 'ready',
            fields: [
                {
                    physicalKind: 'number',
                    presentation: {
                        type: 'physical',
                        config: { type: 'number', options: { precision: 2 } },
                    },
                    fieldId: 'fld_repeated_number',
                    title,
                    field: {
                        id: 'fld_repeated_number',
                        name: title,
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                        config: { type: 'number', options: { precision: 2 } },
                    },
                    displayConfig: config,
                    value,
                    context: 'portal-cell',
                    computed: false,
                    dirty: value !== initial,
                    pending: !!options.pending,
                    error: options.error ?? null,
                    validation: [],
                    capability: writable
                        ? {
                              type: 'editable',
                              setValue: (next) => {
                                  if (!write(next))
                                      return {
                                          accepted: false,
                                          reason: 'readonly',
                                      };
                                  scalar.refresh();
                                  return { accepted: true };
                              },
                              ...(options.noScalar
                                  ? {}
                                  : {
                                        scalar: {
                                            state: scalar.getState(),
                                            setInput: scalar.setInput,
                                            setChecked: scalar.setChecked,
                                        },
                                    }),
                          }
                        : { type: 'readonly' },
                },
            ],
        }),
        subscribe: (listener) => {
            listeners.add(listener);
            listener(host.getSnapshot());
            return () => {
                listeners.delete(listener);
            };
        },
        dispose: () => {
            listeners.clear();
        },
    };
    scalar.subscribe(emit);
    return {
        host,
        getValue: () => value,
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = 42.125;
            document.getElementById('native')!.textContent =
                JSON.stringify(value);
            scalar.refresh();
        },
    };
}
const cards = [
    {
        heading: 'Room for unfinished input',
        note: 'Try a minus sign or an unfinished exponent. Your last valid value stays intact.',
        ...make('Quantity', null, {
            required: true,
            placeholderText: 'Enter a quantity',
        }),
    },
    {
        heading: 'Zero is a value',
        note: 'An empty field and a numeric zero keep their distinct meanings.',
        ...make('Balance', 0),
    },
    {
        heading: 'Precision stays yours',
        note: 'Values are never rounded just because the control is displayed.',
        ...make('Measurement', 1.234567),
    },
    {
        heading: 'Read only',
        note: 'Configured login masking remains in place for a read-only value.',
        ...make(
            'Access code',
            1234,
            { maskPasswordOnLoginScreen: true },
            { readonly: true }
        ),
    },
    {
        heading: 'Saving',
        note: 'Pending changes keep the input disabled.',
        ...make('Reserved seats', 24, {}, { pending: true }),
    },
    {
        heading: 'A little guidance',
        note: 'Feedback stays beside the field it belongs to.',
        ...make(
            'Attendees',
            null,
            {},
            { error: 'Enter the total number of attendees.' }
        ),
    },
    {
        heading: 'Compact row',
        note: 'The visible title is hidden; the accessible name remains.',
        ...make('Compact amount', 3.5, { showTitle: false }),
    },
    {
        heading: 'Waiting for an editor',
        note: 'A numeric value alone does not supply an input model.',
        ...make('Unavailable editor', 34, {}, { noScalar: true }),
    },
];

function App() {
    const [mount, setMount] = useState(0);
    const [locked, setLocked] = useState(false);
    const [rows, setRows] = useState(0);
    const [submits, setSubmits] = useState(0);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Number'),
            h('h1', null, 'Every value, in its own time.'),
            h(
                'p',
                { className: 'intro' },
                'A number can begin with a single character. Keep typing, change your mind, and pick up where you left off.'
            )
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount renderers'
            ),
            h(
                'button',
                {
                    type: 'button',
                    onClick: () => {
                        cards[0].togglePermission();
                        setLocked(!locked);
                    },
                },
                locked ? 'Allow editing' : 'Lock first field'
            ),
            h(
                'button',
                { type: 'button', onClick: () => cards[0].replaceValue() },
                'Update first draft'
            ),
            h(
                'span',
                null,
                'Local draft writes: ',
                h('strong', { id: 'writes' }, writes)
            )
        ),
        h(
            'form',
            {
                key: mount,
                className: 'cards',
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    setSubmits(submits + 1);
                },
            },
            ...cards.map((card, index) =>
                h(
                    'section',
                    {
                        key: index,
                        className: 'card',
                        onClick: () => setRows(rows + 1),
                        onKeyDown: () => setRows(rows + 1),
                    },
                    h(
                        'p',
                        { className: 'card-number' },
                        String(index + 1).padStart(2, '0')
                    ),
                    h('h2', null, card.heading),
                    h('p', { className: 'note' }, card.note),
                    h(FieldRenderer, {
                        host: card.host,
                        renderers: { renderNumberField },
                        fallback: () => null,
                    })
                )
            )
        ),
        h(
            'footer',
            null,
            h(
                'span',
                null,
                'First native draft: ',
                h(
                    'strong',
                    { id: 'native' },
                    JSON.stringify(cards[0].getValue())
                )
            ),
            h(
                'span',
                null,
                'Row activations: ',
                h('strong', { id: 'rows' }, rows)
            ),
            h(
                'span',
                null,
                'Form submissions: ',
                h('strong', { id: 'submits' }, submits)
            ),
            h('span', null, 'Backend requests: 0')
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
