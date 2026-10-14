import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import type {
    FieldRendererHost,
    FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    FieldRenderer,
    renderPhoneNumberField,
    PhoneNumberField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Typed presentation fixtures, not actual Form/Grid/List owners. Their local
// drafts live outside React; no Save, transport, preview, or navigation exists.
let writes = 0;
function make(
    title: string,
    initial: string | null,
    displayConfig: FieldRendererProps<'phoneNumber'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        mask?: boolean;
        error?: string;
    } = {}
) {
    let value = initial,
        writable = !options.readonly,
        retired = false,
        revision = 0;
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    };
    const canEdit = () => writable && !options.pending && !retired;
    const field = {
        id: 'fld_repeated_phone',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'phoneNumber' as const, options: null },
    };
    const config = {
        ...displayConfig,
        maskPasswordOnLoginScreen: options.mask,
    };
    const setValue: FormFieldBinding['setValue'] = (next) => {
        if (!canEdit()) return { accepted: false, reason: 'readonly' };
        if (next !== null && typeof next !== 'string')
            return { accepted: false, reason: 'invalid-value' };
        value = next;
        revision++;
        document.getElementById('writes')!.textContent = String(++writes);
        emit();
        return { accepted: true };
    };
    const host: FieldRendererHost = {
        getSnapshot: () =>
            retired
                ? { status: 'retired', reason: 'Synthetic owner retired.' }
                : {
                      status: 'ready',
                      fields: [
                          {
                              physicalKind: 'phoneNumber',
                              presentation: {
                                  type: 'physical',
                                  config: field.config,
                              },
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
                                  ? { type: 'editable', setValue }
                                  : { type: 'readonly' },
                          },
                      ],
                  },
        subscribe: (listener) => subscribe(() => listener(host.getSnapshot())),
        dispose: () => listeners.clear(),
    };
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'phoneNumber',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'phoneNumber',
                    airtableField: field,
                    miniExtConfig: config,
                },
            },
            value,
            dirty: value !== initial,
            revision,
            visibility: { type: 'visible', diagnostics: [] },
            readOnly: !writable,
            canEdit: canEdit(),
            pending: !!options.pending,
            error: options.error ?? null,
            validation: [],
            selection: null,
            scalar: null,
            date: null,
            retired,
        }),
        subscribe: (listener) =>
            subscribe(() => listener(binding.getSnapshot())),
        setValue,
        selection: null,
        scalar: null,
        date: null,
    };
    return {
        host,
        binding,
        subscribe,
        nativeText: () =>
            retired
                ? 'Retired'
                : options.mask
                  ? 'Masked'
                  : JSON.stringify(value),
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = '  +000 (020) 555-0100 ext. 四  ';
            revision++;
            emit();
        },
        retire: () => {
            retired = true;
            emit();
        },
    };
}
const cards = [
    {
        heading: 'Manual entry',
        note: 'Plus signs, leading zeros, extensions, and unfinished strings stay exactly as entered.',
        ...make('Phone value', null, {
            placeholderText: 'Paste or type a value',
            required: true,
        }),
    },
    {
        heading: 'Country flags stay inert',
        note: 'Country settings add no selector, prefix, or formatting in this manual-entry slice.',
        ...make('Country-configured phone', '001 (020) 555-0100 ext. 09', {
            showCountryCodes: true,
            defaultCountryCode: 'US',
            showTitle: false,
        }),
    },
    {
        heading: 'Masked and read only',
        note: 'The login masking configuration also protects the draft readout.',
        ...make(
            'Private phone',
            '+000 555 0100 private',
            {},
            { readonly: true, mask: true }
        ),
    },
    {
        heading: 'Pending',
        note: 'The existing pending state disables edits and Clear.',
        ...make(
            'Pending phone',
            '+001 (020) 555-0100,;09',
            {},
            { pending: true }
        ),
    },
    {
        heading: 'Owner feedback',
        note: 'Returned feedback is associated with the control; syntax is not validated here.',
        ...make(
            'Reviewed phone',
            'not a phone number',
            {},
            { error: 'Synthetic feedback: review this value.' }
        ),
    },
    {
        heading: 'Binding component',
        note: 'PhoneNumberField uses the same text control and an externally held synthetic binding.',
        ...make('Binding phone', 'not a phone number'),
        bindingView: true,
    },
    {
        heading: 'Custom render',
        note: 'The binding callback can supply a plain-text readout without the stock control.',
        ...make('Custom phone', '  ００１２ ext. 四  '),
        customView: true,
    },
];
const enterHosts = [
    {
        id: 'single',
        title: 'Single-input form',
        submitButton: false,
        ...make('Single-input phone', 'not a phone number'),
    },
    {
        id: 'button',
        title: 'Form with a submit button',
        submitButton: true,
        ...make('Submit-button phone', 'not a phone number'),
    },
];
function NativeValue({
    owner,
    id,
}: {
    owner: ReturnType<typeof make>;
    id: string;
}) {
    const value = useSyncExternalStore(
        owner.subscribe,
        owner.nativeText,
        owner.nativeText
    );
    return h(
        'p',
        { className: 'native' },
        'Native draft: ',
        h('code', { id: `native-${id}` }, value)
    );
}
function EnterHost({ host }: { host: (typeof enterHosts)[number] }) {
    const [submits, setSubmits] = useState(0),
        [clicks, setClicks] = useState(0),
        [keys, setKeys] = useState(0);
    return h(
        'form',
        {
            className: 'card',
            'aria-label': host.title,
            onSubmit: (event: import('react').FormEvent) => {
                event.preventDefault();
                setSubmits((n) => n + 1);
            },
            onKeyDown: () => setKeys((n) => n + 1),
        },
        h('h2', null, host.title),
        h(
            'p',
            { className: 'note' },
            'The host counts native submission and prevents navigation. No Save is connected.'
        ),
        h(FieldRenderer, {
            host: host.host,
            renderers: { renderPhoneNumberField },
            fallback: () => null,
        }),
        host.submitButton
            ? h(
                  'button',
                  {
                      type: 'submit',
                      className: 'host-submit',
                      onClick: () => setClicks((n) => n + 1),
                  },
                  'Count native submission'
              )
            : null,
        h(NativeValue, { owner: host, id: `enter-${host.id}` }),
        h(
            'p',
            { className: 'host-events' },
            'Native submissions: ',
            h('strong', { id: `enter-${host.id}-submits` }, submits),
            ' · Submit-button activations: ',
            h('strong', { id: `enter-${host.id}-clicks` }, clicks),
            ' · Bubbled keydowns: ',
            h('strong', { id: `enter-${host.id}-keys` }, keys)
        )
    );
}
function App() {
    const [mount, setMount] = useState(0),
        [rows, setRows] = useState(0),
        [submits, setSubmits] = useState(0),
        [locked, setLocked] = useState(false),
        [retired, setRetired] = useState(false);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / phone'),
            h('h1', null, 'Keep every character.'),
            h(
                'p',
                { className: 'intro' },
                'Manual phone entry with the shared native text control. Plus signs, leading zeros, and punctuation stay in the owner’s draft.'
            )
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                { type: 'button', onClick: () => setMount((n) => n + 1) },
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
                        cards[0].retire();
                        setRetired(true);
                    },
                },
                'Retire first owner'
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
                'aria-label': 'phone gallery',
                onSubmit: (event: import('react').FormEvent) => {
                    event.preventDefault();
                    setSubmits((n) => n + 1);
                },
            },
            ...cards.map((card, index) =>
                h(
                    'section',
                    {
                        key: index,
                        className: 'card',
                        onClick: () => setRows((n) => n + 1),
                        onKeyDown: () => setRows((n) => n + 1),
                    },
                    h(
                        'p',
                        { className: 'card-number' },
                        String(index + 1).padStart(2, '0')
                    ),
                    h('h2', null, card.heading),
                    h('p', { className: 'note' }, card.note),
                    'customView' in card && card.customView
                        ? h(PhoneNumberField, {
                              binding: card.binding,
                              render: ({ snapshot, binding }) =>
                                  h(
                                      'output',
                                      {
                                          id: 'custom-phone',
                                          'aria-label': 'Custom phone readout',
                                          'data-current-binding': String(
                                              binding === card.binding
                                          ),
                                      },
                                      JSON.stringify(snapshot.value)
                                  ),
                          })
                        : 'bindingView' in card && card.bindingView
                          ? h(PhoneNumberField, {
                                binding: card.binding,
                                className: 'binding-phone',
                                clearLabel: 'Clear binding draft',
                            })
                          : h(FieldRenderer, {
                                host: card.host,
                                renderers: { renderPhoneNumberField },
                                fallback: () => null,
                            }),
                    h(NativeValue, { owner: card, id: String(index) })
                )
            )
        ),
        h(
            'footer',
            null,
            h(
                'span',
                null,
                'Gallery row activations: ',
                h('strong', { id: 'rows' }, rows)
            ),
            h(
                'span',
                null,
                'Gallery submissions: ',
                h('strong', { id: 'submits' }, submits)
            ),
            h('span', null, 'Save calls / external requests: 0')
        ),
        h(
            'section',
            { className: 'enter-hosts', 'aria-label': 'Native Enter hosts' },
            h('h2', null, 'The host owns native submission'),
            h(
                'p',
                { className: 'intro' },
                'Stopping a key event from reaching a row does not cancel native submission. Applications own submit and Save policy.'
            ),
            h(
                'div',
                { className: 'cards' },
                ...enterHosts.map((host) =>
                    h(EnterHost, { key: host.id, host })
                )
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
