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
    renderUrlField,
    UrlField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Typed presentation fixtures, not actual Form/Grid/List owners. Their local
// drafts live outside React; no Save, transport, preview, or navigation exists.
let writes = 0;
function make(
    title: string,
    initial: string | null,
    displayConfig: FieldRendererProps<'url'>['displayConfig'] = {},
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
        id: 'fld_repeated_url',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'url' as const, options: null },
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
                              physicalKind: 'url',
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
                fieldType: 'url',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'url',
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
            value = '  External.Example.TEST/道  ';
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
        note: 'Bare hosts, Unicode, and unfinished strings stay exactly as entered.',
        ...make('Website value', null, {
            placeholderText: 'Paste or type a value',
            required: true,
        }),
    },
    {
        heading: 'Display flags stay inert',
        note: 'Button and attachment flags grant no navigation or preview authority.',
        ...make('Inert display value', '例え.テスト/道?q=One%20Two#片', {
            displayAsButton: true,
            displayAsAttachments: true,
            showTitle: false,
        }),
    },
    {
        heading: 'Masked and read only',
        note: 'The login masking configuration also protects the draft readout.',
        ...make(
            'Private URL',
            'https://demo:synthetic@example.test/private',
            {},
            { readonly: true, mask: true }
        ),
    },
    {
        heading: 'Pending',
        note: 'The existing pending state disables edits and Clear.',
        ...make('Pending URL', 'data:text/plain,inert', {}, { pending: true }),
    },
    {
        heading: 'Owner feedback',
        note: 'Returned feedback is associated with the control; syntax is not validated here.',
        ...make(
            'Reviewed URL',
            'javascript:void(0)',
            {},
            { error: 'Synthetic feedback: review this value.' }
        ),
    },
    {
        heading: 'Binding component',
        note: 'UrlField uses the same text control and an externally held synthetic binding.',
        ...make('Binding URL', 'not a url'),
        bindingView: true,
    },
];
const enterHosts = [
    {
        id: 'single',
        title: 'Single-input form',
        submitButton: false,
        ...make('Single-input URL', 'not a url'),
    },
    {
        id: 'button',
        title: 'Form with a submit button',
        submitButton: true,
        ...make('Submit-button URL', 'not a url'),
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
            renderers: { renderUrlField },
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
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / URL'),
            h('h1', null, 'Keep the value as entered.'),
            h(
                'p',
                { className: 'intro' },
                'Manual URL entry with the shared native text control. Exact strings stay in the owner’s draft; nothing opens, previews, or sends.'
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
                'aria-label': 'URL gallery',
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
                    'bindingView' in card && card.bindingView
                        ? h(UrlField, {
                              binding: card.binding,
                              className: 'binding-url',
                              clearLabel: 'Clear binding draft',
                          })
                        : h(FieldRenderer, {
                              host: card.host,
                              renderers: { renderUrlField },
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
