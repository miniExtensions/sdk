import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import type {
    FieldRendererHost,
    FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    EmailField,
    FieldRenderer,
    renderEmailField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';
import {
    formOwner,
    gridOwner,
    listOwner,
    ready,
    getOwnerReceipt,
    subscribeOwnerReceipt,
} from './owners.js';

// Accepted public owners and synthetic presentation fixtures live outside React.
// Only the toolbar's deliberate local Save actions reach the injected transport.
let fixtureWrites = 0;
function make(
    title: string,
    initial: string | null,
    config: FieldRendererProps<'email'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        mask?: boolean;
        computed?: boolean;
    } = {}
) {
    let value = initial;
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const writable = !options.readonly && !options.pending && !options.computed;
    const setValue: Extract<
        FieldRendererProps<'email'>['capability'],
        { type: 'editable' }
    >['setValue'] = (next) => {
        if (!writable) return { accepted: false, reason: 'readonly' };
        value = next;
        document.getElementById('fixture-writes')!.textContent = String(
            ++fixtureWrites
        );
        emit();
        return { accepted: true };
    };
    const host: FieldRendererHost = {
        getSnapshot: () => ({
            status: 'ready',
            fields: [
                {
                    physicalKind: 'email',
                    presentation: {
                        type: 'physical',
                        config: { type: 'email', options: null },
                    },
                    fieldId: 'fld_repeated_email',
                    title,
                    field: {
                        id: 'fld_repeated_email',
                        name: title,
                        description: null,
                        isComputed: !!options.computed,
                        isPrimaryField: false,
                        config: { type: 'email', options: null },
                    },
                    displayConfig: config,
                    writeConfig: { maskPasswordOnLoginScreen: options.mask },
                    value,
                    context: 'portal-cell',
                    computed: !!options.computed,
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
            const notify = () => listener(host.getSnapshot());
            listeners.add(notify);
            return () => listeners.delete(notify);
        },
        dispose: () => listeners.clear(),
    };
    return {
        host,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        valueText: () => (options.mask ? 'Masked' : JSON.stringify(value)),
    };
}
const cards = [
    {
        heading: 'Form owner',
        note: 'The public Form binding keeps exact strings. Save is a separate local action.',
        owner: formOwner,
        binding: true,
    },
    {
        heading: 'Grid owner',
        note: 'An accepted editable Grid cell holds a draft until its deliberate local Save.',
        owner: gridOwner,
    },
    {
        heading: 'List owner',
        note: 'Accepted List detail stays read only and renders its value as text.',
        owner: listOwner,
    },
    {
        heading: 'Unfinished composition',
        note: 'The shared text control buffers unfinished composition before updating the owner.',
        owner: make('Composed email', 'Studio'),
    },
    {
        heading: 'Masked value',
        note: 'Masking remains in force, including in this example’s draft readout.',
        owner: make(
            'Private email',
            'private@example.test',
            {},
            { mask: true }
        ),
    },
    {
        heading: 'Owner feedback',
        note: 'The renderer displays returned feedback; it does not invent email validation.',
        owner: make(
            'Reviewed email',
            'invalid sample',
            {},
            { error: 'Synthetic owner feedback: review this value.' }
        ),
    },
    {
        heading: 'Pending',
        note: 'A pending owner disables edits and Clear.',
        owner: make(
            'Pending email',
            'pending@example.test',
            {},
            { pending: true }
        ),
    },
    {
        heading: 'Compact row',
        note: 'The visual label can be hidden while the accessible name remains.',
        owner: make('Compact email', 'compact@example.test', {
            showTitle: false,
        }),
    },
    {
        heading: 'Computed',
        note: 'Computed values remain read only.',
        owner: make(
            'Computed email',
            'computed@example.test',
            {},
            { computed: true }
        ),
    },
];
const enterHosts = [
    {
        id: 'single',
        title: 'Single-input form',
        input: 'Single-input email',
        submitButton: false,
        owner: make('Single-input email', 'not-an-email'),
    },
    {
        id: 'button',
        title: 'Form with a submit button',
        input: 'Submit-button email',
        submitButton: true,
        owner: make('Submit-button email', 'not-an-email'),
    },
];
function NativeValue({
    owner,
    id,
}: {
    owner: { subscribe(listener: () => void): () => void; valueText(): string };
    id: string;
}) {
    const value = useSyncExternalStore(
        owner.subscribe,
        owner.valueText,
        owner.valueText
    );
    return h(
        'p',
        { className: 'native' },
        'Native draft: ',
        h('code', { id: `native-${id}` }, value)
    );
}
function OwnerReceipt() {
    const value = useSyncExternalStore(
        subscribeOwnerReceipt,
        () => JSON.stringify(getOwnerReceipt()),
        () => JSON.stringify(getOwnerReceipt())
    );
    return h(
        'section',
        { className: 'receipt', 'aria-label': 'Synthetic owner receipt' },
        h('h2', null, 'Local owner receipt'),
        h(
            'p',
            { className: 'note' },
            'Injected in-memory responses only. No live request, email sending, verification, or server validation.'
        ),
        h('code', { id: 'owner-receipt' }, value)
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
            'The host counts native submission and prevents navigation. This form never invokes Save.'
        ),
        h(FieldRenderer, {
            host: host.owner.host,
            renderers: { renderEmailField },
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
        h(NativeValue, { owner: host.owner, id: `enter-${host.id}` }),
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
    const receipt = JSON.parse(
        useSyncExternalStore(
            subscribeOwnerReceipt,
            () => JSON.stringify(getOwnerReceipt()),
            () => JSON.stringify(getOwnerReceipt())
        )
    ) as ReturnType<typeof getOwnerReceipt>;
    const [mount, setMount] = useState(0),
        [rows, setRows] = useState(0),
        [submits, setSubmits] = useState(0);
    const [locked, setLocked] = useState(false),
        [retired, setRetired] = useState(false);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Email'),
            h('h1', null, 'Your text, kept exactly.'),
            h(
                'p',
                { className: 'intro' },
                'An email presentation using the shared native text control. The existing owner holds the draft and decides when to Save.'
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
                        formOwner.togglePermission();
                        setLocked(!locked);
                    },
                },
                locked ? 'Allow editing' : 'Lock Form field'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired,
                    onClick: () => formOwner.replaceValue(),
                },
                'Update Form draft'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired,
                    onClick: () => {
                        formOwner.retire();
                        setRetired(true);
                    },
                },
                'Retire Form owner'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired || receipt.formSaves > 0,
                    onClick: () => void formOwner.save(),
                },
                'Save Form draft locally'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: receipt.gridSaves > 0,
                    onClick: () => void gridOwner.save(),
                },
                'Save Grid draft locally'
            ),
            h(
                'span',
                null,
                'Presentation-fixture writes: ',
                h('strong', { id: 'fixture-writes' }, fixtureWrites)
            )
        ),
        h(
            'form',
            {
                key: mount,
                className: 'cards',
                'aria-label': 'Email gallery',
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
                    card.binding
                        ? h(EmailField, {
                              binding: formOwner.binding,
                              className: 'binding-email',
                              clearLabel: 'Clear Form draft',
                          })
                        : h(FieldRenderer, {
                              host: card.owner.host,
                              renderers: { renderEmailField },
                              fallback: () => null,
                          }),
                    h(NativeValue, { owner: card.owner, id: String(index) })
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
            h('span', null, 'External requests: 0')
        ),
        h(OwnerReceipt),
        h(
            'section',
            { className: 'enter-hosts', 'aria-label': 'Native Enter hosts' },
            h('h2', null, 'The host owns native submission'),
            h(
                'p',
                { className: 'intro' },
                'Row-event isolation does not cancel native Enter submission. These fields are text inputs: email syntax creates no browser constraint here.'
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
await ready;
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
