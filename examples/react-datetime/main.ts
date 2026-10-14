import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    createDateFieldModel,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import {
    DateTimeField,
    FieldRenderer,
    renderDateTimeField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/datetime.css';
import './styles.css';

// Synthetic owners live outside React. Real applications supply accepted
// Form/Portal owners and their separate, deliberate Save action.
let writes = 0;
const make = (
    title: string,
    initial: string | null,
    displayConfig: FieldRendererProps<'dateTime'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        mask?: boolean;
        clientZone?: boolean;
    } = {}
) => {
    let value = initial;
    let writable = !options.readonly;
    let hidden = false;
    let retired = false;
    let clientZone = 'America/Los_Angeles';
    const dateConfig = {
        type: 'dateTime',
        options: {
            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
            timeFormat: { name: '24hour', format: 'HH:mm' },
            timeZone: options.clientZone ? 'client' : 'utc',
        },
    } as const;
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const canEdit = () => writable && !options.pending && !hidden && !retired;
    const model = createDateFieldModel({
        kind: 'dateTime',
        getValue: () => value,
        getConfig: () => dateConfig,
        getClientTimeZone: () => clientZone,
        canEdit,
        isCurrent: () => !retired,
        write: (next) => {
            if (!canEdit()) return false;
            value = next;
            document.querySelector('#writes')!.textContent = String(++writes);
            return true;
        },
    });
    model.subscribe(emit);
    const field = {
        id: 'fld_repeated_datetime',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: dateConfig,
    };
    const config = {
        ...displayConfig,
        maskPasswordOnLoginScreen: options.mask,
    };
    const setValue: FormFieldBinding['setValue'] = (next) => {
        const accepted =
            next === null
                ? model.clear()
                : typeof next === 'string' && model.setInput(next);
        return accepted
            ? { accepted: true }
            : { accepted: false, reason: 'invalid-value' };
    };
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const host: FieldRendererHost = {
        getSnapshot: () => {
            if (retired) return { status: 'retired', reason: 'Owner retired.' };
            if (hidden) return { status: 'hidden', reason: 'Field hidden.' };
            const date = model.getState();
            if (date.retired)
                return {
                    status: 'retired',
                    reason: 'DateTime context changed.',
                };
            return {
                status: 'ready',
                fields: [
                    {
                        physicalKind: 'dateTime',
                        presentation: { type: 'physical', config: dateConfig },
                        fieldId: field.id,
                        title,
                        field,
                        displayConfig,
                        writeConfig: config,
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
                                  setValue,
                                  date: {
                                      state: date,
                                      setInput: model.setInput,
                                      clear: model.clear,
                                  },
                              }
                            : { type: 'readonly' },
                    },
                ],
            };
        },
        subscribe: (listener) => subscribe(() => listener(host.getSnapshot())),
        dispose: () => {
            model.destroy();
            listeners.clear();
        },
    };
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'dateTime',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'dateTime',
                    airtableField: field,
                    miniExtConfig: config,
                },
            },
            value,
            dirty: value !== initial,
            revision: model.getState().revision,
            visibility: {
                type: hidden ? 'hidden' : 'visible',
                diagnostics: [],
            },
            readOnly: !writable,
            canEdit: canEdit(),
            pending: !!options.pending,
            error: options.error ?? null,
            validation: [],
            selection: null,
            scalar: null,
            date: model.getState(),
            retired: retired || model.getState().retired,
        }),
        subscribe: (listener) => {
            listener(binding.getSnapshot());
            return subscribe(() => listener(binding.getSnapshot()));
        },
        setValue,
        selection: null,
        scalar: null,
        date: model,
    };
    return {
        host,
        binding,
        subscribe,
        nativeText: () =>
            retired || model.getState().retired
                ? 'Retired'
                : hidden
                  ? 'Hidden'
                  : options.mask
                    ? 'Masked'
                    : JSON.stringify(value),
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = '2024-11-03T01:30:00.120-04:00';
            model.refresh();
        },
        changeClientZone: () => {
            clientZone = 'Asia/Kathmandu';
            emit();
        },
        toggleHidden: () => {
            hidden = !hidden;
            emit();
        },
        retire: () => {
            retired = true;
            emit();
        },
    };
};
const cards = [
    {
        heading: 'An instant in progress',
        note: 'Keep seconds, subseconds and an explicit offset exactly as entered. This owner uses a fixed UTC display zone.',
        ...make('Target datetime', '2026-10-14T09:30:00.120+05:45', {
            required: true,
        }),
    },
    {
        heading: 'Masked datetime',
        note: 'The edit configuration keeps this instant out of plain text.',
        ...make(
            'Private milestone',
            '2025-06-17T08:45:00Z',
            {},
            { mask: true }
        ),
    },
    {
        heading: 'Read only',
        note: 'The accepted native value is visible without edit permission.',
        ...make(
            'Archive datetime',
            '2020-01-31T12:00:00Z',
            {},
            { readonly: true }
        ),
    },
    {
        heading: 'Validation',
        note: 'Returned feedback is associated with its control.',
        ...make(
            'Review datetime',
            null,
            {},
            { error: 'Choose a review instant.' }
        ),
    },
    {
        heading: 'Saving',
        note: 'Pending state prevents additional input.',
        ...make(
            'Release datetime',
            '2026-11-01T14:00:00+05:45',
            {},
            { pending: true }
        ),
    },
    {
        heading: 'Compact row',
        note: 'A hidden visual title retains an accessible name.',
        ...make('Compact datetime', '2026-12-31T23:59:59.999Z', {
            showTitle: false,
        }),
    },
    {
        heading: 'Binding component',
        note: 'DateTimeField uses the same owner and explicit-offset semantics as the slot.',
        ...make('Binding datetime', '2024-02-29T12:30:00Z'),
    },
    {
        heading: 'Client timezone',
        note: 'Changing the accepted client timezone retires this owner. A fresh owner is required; the fixed-zone field remains usable.',
        ...make(
            'Client-zone appointment',
            '2024-07-01T12:00:00Z',
            {},
            { clientZone: true }
        ),
    },
];
function NativeValue({
    card,
    index,
}: {
    card: (typeof cards)[number];
    index: number;
}) {
    const value = useSyncExternalStore(
        card.subscribe,
        card.nativeText,
        card.nativeText
    );
    return h(
        'p',
        { className: 'native' },
        'Native draft: ',
        h('code', { id: `native-${index}` }, value)
    );
}
function App() {
    const [mount, setMount] = useState(0);
    const [rowEvents, setRowEvents] = useState(0);
    const [submits, setSubmits] = useState(0);
    const [locked, setLocked] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [retired, setRetired] = useState(false);
    const [zoneChanged, setZoneChanged] = useState(false);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / DateTime'),
            h('h1', null, 'An instant, with its offset.'),
            h(
                'p',
                { className: 'intro' },
                'Explicit timestamps with room for unfinished input. The existing owner keeps the native draft; no browser-local time or daylight-saving guess is needed.'
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
                    disabled: retired,
                    onClick: () => {
                        cards[0].togglePermission();
                        setLocked(!locked);
                    },
                },
                locked ? 'Allow editing' : 'Lock first field'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired,
                    onClick: () => cards[0].replaceValue(),
                },
                'Update first draft'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired,
                    onClick: () => {
                        cards[0].toggleHidden();
                        setHidden(!hidden);
                    },
                },
                hidden ? 'Show first field' : 'Hide first field'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired,
                    onClick: () => {
                        cards[0].retire();
                        setRetired(true);
                    },
                },
                'Retire first owner'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: zoneChanged,
                    onClick: () => {
                        cards[0].changeClientZone();
                        cards[7].changeClientZone();
                        setZoneChanged(true);
                    },
                },
                'Change client timezone'
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
                    index === 6
                        ? h(DateTimeField, {
                              binding: card.binding,
                              className: 'binding-datetime',
                              clearLabel: 'Clear binding datetime',
                          })
                        : h(FieldRenderer, {
                              host: card.host,
                              renderers: { renderDateTimeField },
                              fallback: () => null,
                          }),
                    h(NativeValue, { card, index })
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
