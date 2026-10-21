import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    createCheckboxFieldModel,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import { FieldRenderer, renderCheckboxField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/checkbox.css';
import './styles.css';

// Synthetic owners are created once, outside React. A real app supplies its
// accepted Form/Portal host here; writes and Save remain in those owners.
let writes = 0;
const make = (
    title: string,
    initial: boolean | null,
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        hideTitle?: boolean;
        calendly?: boolean;
    } = {}
) => {
    let value = initial;
    let writable = !options.readonly && !options.pending && !options.calendly;
    const model = createCheckboxFieldModel({
        getValue: () => value,
        canEdit: () => writable,
        isCurrent: () => true,
        write: (next) => {
            if (!writable || typeof next !== 'boolean') return false;
            value = next;
            document.querySelector('#writes')!.textContent = String(++writes);
            return true;
        },
    });
    const host: FieldRendererHost = {
        getSnapshot: () => {
            const field: FieldRendererProps<'checkbox'> = {
                physicalKind: 'checkbox',
                presentation: {
                    type: 'physical',
                    config: {
                        type: 'checkbox',
                        options: { icon: 'check', color: 'blueBright' },
                    },
                },
                fieldId: 'fld_repeated_checkbox',
                title,
                field: {
                    id: 'fld_repeated_checkbox',
                    name: title,
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: 'checkbox',
                        options: { icon: 'check', color: 'blueBright' },
                    },
                },
                displayConfig: {
                    showTitle: !options.hideTitle,
                    enableCalendlyIntegration: options.calendly,
                },
                value,
                context: 'portal-cell',
                computed: false,
                dirty: value !== initial,
                pending: !!options.pending,
                error: options.error ?? null,
                validation: [],
                capability: options.readonly
                    ? { type: 'readonly' }
                    : {
                          type: 'editable',
                          setValue: (next) =>
                              typeof next === 'boolean' &&
                              model.setChecked(next)
                                  ? { accepted: true }
                                  : { accepted: false, reason: 'readonly' },
                          scalar: {
                              state: model.getState(),
                              setInput: model.setInput,
                              setChecked: model.setChecked,
                          },
                      },
            };
            return { status: 'ready', fields: [field] };
        },
        subscribe: (listener) =>
            model.subscribe(() => listener(host.getSnapshot())),
        dispose: () => model.destroy(),
    };
    return {
        host,
        model,
        value: () => value,
        togglePermission: () => {
            writable = !writable;
            model.refresh();
        },
    };
};
const cards = [
    {
        heading: 'Ready to edit',
        note: 'Starts empty. A deliberate click writes true or false.',
        ...make('Approve this request', null),
    },
    {
        heading: 'Already checked',
        note: 'An existing native value. Space toggles the control.',
        ...make('Email me project updates', true),
    },
    {
        heading: 'Read only',
        note: 'Visible value with no edit capability.',
        ...make('Review completed', true, { readonly: true }),
    },
    {
        heading: 'Validation',
        note: 'Feedback is plain text and linked to its control.',
        ...make('I have reviewed the details', false, {
            error: 'Please confirm that you have reviewed the details.',
        }),
    },
    {
        heading: 'Saving',
        note: 'Pending state disables further changes.',
        ...make('Include in the next release', true, { pending: true }),
    },
    {
        heading: 'Compact row',
        note: 'Hidden visual title, accessible name retained.',
        ...make('Compact row approval', false, { hideTitle: true }),
    },
    {
        heading: 'Scheduling configured',
        note: 'Booking needs its own integration. This control stays read only.',
        ...make('Meeting booked', false, { calendly: true }),
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
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Checkbox'),
            h('h1', null, 'One choice. Clear state.'),
            h(
                'p',
                { className: 'intro' },
                'A small native control, connected to the existing field owner. Optional defaults; your application owns the look.'
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
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    setSubmits(submits + 1);
                },
                className: 'cards',
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
                        renderers: { renderCheckboxField },
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
