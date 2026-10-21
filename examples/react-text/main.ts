import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
    FieldRendererHost,
    FieldRendererProps,
    FieldRendererHostSnapshot,
} from '@miniextensions/sdk/ui';
import {
    FieldRenderer,
    renderSingleLineTextField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Synthetic accepted hosts, created outside React. Real apps provide their
// Form/Portal hosts; those owners guard writes and expose a separate Save action.
let writes = 0;
const make = (
    title: string,
    initial: string | null,
    config: FieldRendererProps<'singleLineText'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        mask?: boolean;
    } = {}
) => {
    let value = initial;
    let writable = !options.readonly && !options.pending;
    const listeners = new Set<(snapshot: FieldRendererHostSnapshot) => void>();
    const emit = () => {
        for (const listener of listeners) listener(host.getSnapshot());
    };
    const setValue: Extract<
        FieldRendererProps<'singleLineText'>['capability'],
        { type: 'editable' }
    >['setValue'] = (next) => {
        if (!writable) return { accepted: false, reason: 'readonly' };
        value = next;
        document.querySelector('#writes')!.textContent = String(++writes);
        emit();
        return { accepted: true };
    };
    const host: FieldRendererHost = {
        getSnapshot: () => ({
            status: 'ready',
            fields: [
                {
                    physicalKind: 'singleLineText',
                    presentation: {
                        type: 'physical',
                        config: { type: 'singleLineText', options: null },
                    },
                    fieldId: 'fld_repeated_text',
                    title,
                    field: {
                        id: 'fld_repeated_text',
                        name: title,
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                        config: { type: 'singleLineText', options: null },
                    },
                    displayConfig: config,
                    writeConfig: { obscurePassword: options.mask },
                    value,
                    context: 'portal-cell',
                    computed: false,
                    dirty: value !== initial,
                    pending: !!options.pending,
                    error: options.error ?? null,
                    validation: [],
                    capability: writable
                        ? { type: 'editable', setValue }
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
        dispose: () => listeners.clear(),
    };
    return {
        host,
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = 'External update';
            emit();
        },
    };
};
const cards = [
    {
        heading: 'Ready to edit',
        note: 'Start with a blank draft. Clear keeps focus here.',
        ...make('Project name', null, {
            placeholderText: 'Give your project a name',
            required: true,
        }),
    },
    {
        heading: 'Character limit',
        note: 'A short name with a live count. Compose text before committing it.',
        ...make('Short name', 'Studio', { characterLimit: 12 }),
    },
    {
        heading: 'Masked text',
        note: 'Masking from the edit configuration is preserved.',
        ...make('Access phrase', 'sample phrase', {}, { mask: true }),
    },
    {
        heading: 'Read only',
        note: 'An existing value without edit permission.',
        ...make('Reference', 'REF-042', {}, { readonly: true }),
    },
    {
        heading: 'Validation',
        note: 'Configured feedback is linked to the input.',
        ...make(
            'Team name',
            '',
            { placeholderText: 'Enter a team name' },
            { error: 'Please enter a team name.' }
        ),
    },
    {
        heading: 'Saving',
        note: 'Pending changes keep the input disabled.',
        ...make('Release name', 'October release', {}, { pending: true }),
    },
    {
        heading: 'Compact row',
        note: 'Hidden visual title, accessible name retained.',
        ...make('Compact note', 'Ready for review', { showTitle: false }),
    },
    {
        heading: 'Manual address',
        note: 'Optional lookup and scanning need their own integration.',
        ...make('Address', null, {
            enableAddressAutocomplete: true,
            enableQRCodeScannerForFormField: true,
            placeholderText: 'Enter an address',
        }),
    },
];
function App() {
    const [mount, setMount] = useState(0);
    const [rowEvents, setRowEvents] = useState(0);
    const [submits, setSubmits] = useState(0);
    const [locked, setLocked] = useState(false);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Text'),
            h('h1', null, 'Room for the right words.'),
            h(
                'p',
                { className: 'intro' },
                'A native text input connected to the existing field owner. Optional defaults, ready for your application’s style.'
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
                        onClick: () => setRowEvents(rowEvents + 1),
                        onKeyDown: () => setRowEvents(rowEvents + 1),
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
                        renderers: { renderSingleLineTextField },
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
                'Row activations: ',
                h('strong', { id: 'rows' }, rowEvents)
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
