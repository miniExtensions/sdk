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
    renderMultilineTextField,
    MultilineTextField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Typed presentation fixtures, not actual Form/Grid/List owners. Their local
// drafts live outside React; no Save, transport, preview, or navigation exists.
let writes = 0;
function make(
    title: string,
    initial: string | null,
    displayConfig: FieldRendererProps<'multilineText'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        writeConfig?: FieldRendererProps<'multilineText'>['displayConfig'];
        password?: boolean;
        error?: string;
    } = {}
) {
    let value = initial,
        writable = !options.readonly,
        retired = false,
        hidden = false,
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
    const canEdit = () => writable && !options.pending && !hidden && !retired;
    const field = {
        id: 'fld_repeated_multiline',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'multilineText' as const, options: null },
    };
    // A legacy runtime password flag is deliberately exercised even though the
    // current multiline configuration contract does not advertise that option.
    const config = {
        showTitle: true,
        ...(options.writeConfig ?? displayConfig),
        ...(options.password ? { maskPasswordOnLoginScreen: true } : {}),
    };
    const unavailable = () =>
        [displayConfig, config].some(
            (value) =>
                value &&
                (('addOnlyMode' in value && value.addOnlyMode === true) ||
                    ('displayAsAttachments' in value &&
                        value.displayAsAttachments === true) ||
                    ('maskPasswordOnLoginScreen' in value &&
                        value.maskPasswordOnLoginScreen === true) ||
                    ('obscurePassword' in value &&
                        value.obscurePassword === true))
        );
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
                : hidden
                  ? { status: 'hidden', reason: 'Synthetic owner hidden.' }
                  : {
                        status: 'ready',
                        fields: [
                            {
                                physicalKind: 'multilineText',
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
                fieldType: 'multilineText',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'multilineText',
                    airtableField: field,
                    miniExtConfig: config,
                },
            },
            value,
            dirty: value !== initial,
            revision,
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
                : hidden
                  ? 'Hidden'
                  : unavailable()
                    ? 'Unavailable'
                    : JSON.stringify(value),
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = 'Owner\nreplacement  ';
            revision++;
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
}
const cards = [
    {
        heading: 'Room for every line',
        note: 'Blank lines, tabs, Unicode, and trailing spaces stay in the owner’s exact draft.',
        ...make('Notes', null, {
            required: true,
            placeholderText: 'Write a few lines',
            addOnlyMode: false,
            displayAsAttachments: false,
        }),
    },
    {
        heading: 'Line endings belong to the owner',
        note: 'The owner starts with CRLF. The browser displays LF; mounting does not rewrite the owner.',
        ...make('CRLF notes', 'First\r\n\r\nSecond\r\n'),
    },
    {
        heading: 'Read only',
        note: 'The exact stored text remains visible with editing and Clear disabled.',
        ...make(
            'Read-only notes',
            'Recorded\n  exactly  ',
            {},
            { readonly: true }
        ),
    },
    {
        heading: 'Pending',
        note: 'The owner’s pending state disables edits and Clear.',
        ...make('Pending notes', 'Pending\nnotes', {}, { pending: true }),
    },
    {
        heading: 'Owner feedback',
        note: 'Returned feedback is associated with this textarea.',
        ...make(
            'Reviewed notes',
            '<b>literal text</b>\nSecond line',
            {},
            { error: 'Synthetic feedback: review this note.' }
        ),
    },
    {
        heading: 'Binding component',
        note: 'An externally held binding survives remounts. Empty and Clear both write null.',
        ...make('Binding notes', 'Binding\ninitial', { showTitle: false }),
        bindingView: true,
    },
    {
        heading: 'Custom render',
        note: 'The application can supply its own presentation for an unsupported mode.',
        ...make('Custom notes', 'CUSTOM_PRIVATE_NATIVE', { addOnlyMode: true }),
        customView: true,
    },
    {
        heading: 'Add-only mode',
        note: 'This plain editor cannot enforce append-only editing; it shows an accessible status.',
        ...make('Add-only notes', 'ADD_ONLY_PRIVATE_NATIVE', {
            addOnlyMode: true,
        }),
    },
    {
        heading: 'Attachment display',
        note: 'A write-side attachment mode supplies no textarea, preview, or native readout.',
        ...make(
            'Attachment notes',
            'ATTACHMENT_PRIVATE_NATIVE',
            {},
            { writeConfig: { displayAsAttachments: true } }
        ),
    },
    {
        heading: 'Password configuration',
        note: 'Plain textareas cannot mask passwords. The stock renderer withholds the control and value.',
        ...make(
            'Private notes',
            'PASSWORD_PRIVATE_NATIVE',
            {},
            { password: true }
        ),
    },
];
const switched = [
    make('First switched notes', 'First owner\nvalue'),
    make('Second switched notes', 'Second owner\nvalue'),
];
const enterHosts = [
    {
        id: 'single',
        title: 'Single-textarea form',
        submitButton: false,
        ...make('Single textarea', 'Line one'),
    },
    {
        id: 'button',
        title: 'Form with a submit button',
        submitButton: true,
        ...make('Submit-button textarea', 'Line one'),
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
            'Enter inserts a newline. The host owns form submission; no Save is connected.'
        ),
        h(FieldRenderer, {
            host: host.host,
            renderers: { renderMultilineTextField },
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
        [retired, setRetired] = useState(false),
        [hidden, setHidden] = useState(false),
        [selected, setSelected] = useState(0);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h(
                'p',
                { className: 'eyebrow' },
                'miniExtensions SDK / Multiline text'
            ),
            h('h1', null, 'Keep every line.'),
            h(
                'p',
                { className: 'intro' },
                'Plain text with room to breathe. The owner keeps every character; Enter adds a line and Save stays with the application.'
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
                'aria-label': 'Multiline gallery',
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
                        ? h(MultilineTextField, {
                              binding: card.binding,
                              render: ({ binding }) =>
                                  h(
                                      'output',
                                      {
                                          id: 'custom-multiline',
                                          'aria-label':
                                              'Custom multiline readout',
                                          'data-current-binding': String(
                                              binding === card.binding
                                          ),
                                      },
                                      'Custom presentation supplied by the application.'
                                  ),
                          })
                        : 'bindingView' in card && card.bindingView
                          ? h(MultilineTextField, {
                                binding: card.binding,
                                className: 'binding-multiline',
                                clearLabel: 'Clear binding draft',
                            })
                          : h(FieldRenderer, {
                                host: card.host,
                                renderers: { renderMultilineTextField },
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
            { className: 'enter-hosts', 'aria-label': 'Switched binding' },
            h('h2', null, 'One mounted binding, two owners'),
            h(
                'p',
                { className: 'intro' },
                'Switching the accepted owner keeps each draft separate and cancels stale composition.'
            ),
            h(
                'div',
                { className: 'toolbar' },
                h(
                    'button',
                    { type: 'button', onClick: () => setSelected(0) },
                    'Show first owner'
                ),
                h(
                    'button',
                    { type: 'button', onClick: () => setSelected(1) },
                    'Show second owner'
                )
            ),
            h(
                'div',
                { className: 'card', id: 'switch-card' },
                h(MultilineTextField, {
                    key: 'same-multiline-field',
                    binding: switched[selected].binding,
                }),
                h(NativeValue, { owner: switched[selected], id: 'switch' })
            )
        ),
        h(
            'section',
            { className: 'enter-hosts', 'aria-label': 'Native Enter hosts' },
            h('h2', null, 'Enter belongs inside the text'),
            h(
                'p',
                { className: 'intro' },
                'Textarea Enter inserts a newline, including in a form with a submit button. Applications still own explicit submission and Save policy.'
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
