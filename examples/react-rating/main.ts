import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import {
    createNumberFieldModel,
    createDurationFieldModel,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    FieldRenderer,
    renderRatingField,
    NumberField,
    RatingField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/number.css';
import '@miniextensions/sdk/react/currency.css';
import '@miniextensions/sdk/react/duration.css';
import './styles.css';

// Typed synthetic presentation hosts, not actual Form/Grid/List owners. Public
// scalar models and drafts live outside React. No Save or transport is attached.
let writes = 0;
type Kind = 'rating' | 'number' | 'currency' | 'duration';
function make(
    title: string,
    initial: number | null,
    displayConfig: FieldRendererProps<'rating'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        mask?: boolean;
        error?: string;
        noScalar?: boolean;
        kind?: Kind;
    } = {}
) {
    const kind = options.kind ?? 'rating';
    let value = initial,
        writable = !options.readonly,
        hidden = false,
        retired = false;
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
    const config = {
        ...displayConfig,
        maskPasswordOnLoginScreen: options.mask,
    };
    const canEdit = () =>
        writable &&
        !options.pending &&
        !hidden &&
        !retired &&
        !('readOnly' in config && config.readOnly);
    const write = (next: number | boolean | null) => {
        if (!canEdit() || typeof next === 'boolean') return false;
        value = next;
        document.getElementById('writes')!.textContent = String(++writes);
        return true;
    };
    const modelOptions = {
        getValue: () => value,
        canEdit,
        isCurrent: () => !retired,
        write,
    };
    const model =
        options.readonly || options.noScalar
            ? null
            : kind === 'duration'
              ? createDurationFieldModel({
                    ...modelOptions,
                    getDurationFormat: () => 'h:mm:ss',
                })
              : createNumberFieldModel(modelOptions);
    model?.subscribe(emit);
    const metadata = {
        id: 'fld_repeated_rating',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
    };
    const ratingConfig = {
        type: 'rating' as const,
        options: {
            max: 5,
            icon: 'star' as const,
            color: 'yellowBright' as const,
        },
    };
    const numberConfig = { type: 'number' as const, options: { precision: 2 } };
    const currencyConfig = {
        type: 'currency' as const,
        options: { precision: 2, symbol: '$' },
    };
    const durationConfig = {
        type: 'duration' as const,
        options: { durationFormat: 'h:mm:ss' as const },
    };
    const schema =
        kind === 'rating'
            ? {
                  fieldType: 'rating' as const,
                  airtableField: { ...metadata, config: ratingConfig },
                  miniExtConfig: config,
              }
            : kind === 'number'
              ? {
                    fieldType: 'number' as const,
                    airtableField: { ...metadata, config: numberConfig },
                    miniExtConfig: config,
                }
              : kind === 'currency'
                ? {
                      fieldType: 'currency' as const,
                      airtableField: { ...metadata, config: currencyConfig },
                      miniExtConfig: config,
                  }
                : {
                      fieldType: 'duration' as const,
                      airtableField: { ...metadata, config: durationConfig },
                      miniExtConfig: config,
                  };
    const setValue: FormFieldBinding['setValue'] = (next) => {
        if (
            next !== null &&
            (typeof next !== 'number' || !Number.isFinite(next))
        )
            return { accepted: false, reason: 'invalid-value' };
        if (!write(next)) return { accepted: false, reason: 'readonly' };
        model?.refresh();
        emit();
        return { accepted: true };
    };
    const host: FieldRendererHost = {
        getSnapshot: () => {
            if (retired)
                return {
                    status: 'retired',
                    reason: 'Synthetic owner retired.',
                };
            if (hidden)
                return { status: 'hidden', reason: 'Synthetic owner hidden.' };
            const state = model?.getState();
            const capability: FieldRendererProps<'rating'>['capability'] =
                writable
                    ? {
                          type: 'editable',
                          setValue,
                          ...(model && state
                              ? {
                                    scalar: {
                                        state,
                                        setInput: model.setInput,
                                        setChecked: model.setChecked,
                                        ...(model.setFocused
                                            ? { setFocused: model.setFocused }
                                            : {}),
                                    },
                                }
                              : {}),
                      }
                    : { type: 'readonly' };
            const common = {
                fieldId: metadata.id,
                title,
                displayConfig,
                writeConfig: config,
                value,
                context: 'portal-cell' as const,
                computed: false,
                dirty: value !== initial,
                pending: !!options.pending,
                error: options.error ?? null,
                validation: [],
                capability,
            };
            if (kind === 'number')
                return {
                    status: 'ready',
                    fields: [
                        {
                            ...common,
                            physicalKind: 'number',
                            presentation: {
                                type: 'physical',
                                config: numberConfig,
                            },
                            field: { ...metadata, config: numberConfig },
                        },
                    ],
                };
            if (kind === 'currency')
                return {
                    status: 'ready',
                    fields: [
                        {
                            ...common,
                            physicalKind: 'currency',
                            presentation: {
                                type: 'physical',
                                config: currencyConfig,
                            },
                            field: { ...metadata, config: currencyConfig },
                        },
                    ],
                };
            if (kind === 'duration')
                return {
                    status: 'ready',
                    fields: [
                        {
                            ...common,
                            physicalKind: 'duration',
                            capability:
                                writable &&
                                model?.setFocused &&
                                state?.kind === 'duration'
                                    ? {
                                          type: 'editable',
                                          setValue,
                                          scalar: {
                                              state,
                                              setInput: model.setInput,
                                              setChecked: model.setChecked,
                                              setFocused: model.setFocused,
                                          },
                                      }
                                    : { type: 'readonly' },
                            presentation: {
                                type: 'physical',
                                config: durationConfig,
                            },
                            field: { ...metadata, config: durationConfig },
                        },
                    ],
                };
            return {
                status: 'ready',
                fields: [
                    {
                        ...common,
                        physicalKind: 'rating',
                        presentation: {
                            type: 'physical',
                            config: ratingConfig,
                        },
                        field: { ...metadata, config: ratingConfig },
                    },
                ],
            };
        },
        subscribe: (listener) => subscribe(() => listener(host.getSnapshot())),
        dispose: () => {
            model?.destroy();
            listeners.clear();
        },
    };
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: metadata.id,
                title,
                fieldType: kind,
                isComputed: false,
                readOnly: !writable,
                schema,
            },
            value,
            dirty: value !== initial,
            revision: model?.getState().revision ?? 0,
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
            scalar: model?.getState() ?? null,
            date: null,
            retired,
        }),
        subscribe: (listener) =>
            subscribe(() => listener(binding.getSnapshot())),
        setValue,
        selection: null,
        scalar: model,
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
                  : options.mask
                    ? 'Masked'
                    : JSON.stringify(value),
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = -0.987654321;
            model?.refresh();
            emit();
        },
        toggleHidden: () => {
            hidden = !hidden;
            emit();
        },
        retire: () => {
            retired = true;
            model?.destroy();
            emit();
        },
    };
}
const cards = [
    {
        heading: 'Native rating values',
        note: 'Metadata expects a maximum of 5. Manual input still preserves 6, -1.5, or 0.125 without clamping.',
        ...make('Rating value', 3, {
            required: true,
        }),
    },
    {
        heading: 'Precision stays yours',
        note: 'The configured star icon, yellow color, and maximum stay inert; native precision is unchanged.',
        ...make('Precise rating', 0.125),
    },
    {
        heading: 'Masked and read only',
        note: 'The disabled control and native-state readout both protect the value.',
        ...make(
            'Private rating',
            0.87654321,
            {},
            { readonly: true, mask: true }
        ),
    },
    {
        heading: 'Pending',
        note: 'The existing owner’s pending state prevents edits.',
        ...make('Pending rating', 0.75, {}, { pending: true }),
    },
    {
        heading: 'Owner feedback',
        note: 'Returned feedback stays beside its field. The scalar owns numeric parsing.',
        ...make(
            'Reviewed rating',
            null,
            {},
            { error: 'Synthetic feedback: review this rating.' }
        ),
    },
    {
        heading: 'Binding component',
        note: 'RatingField borrows the same scalar. Emptying its input writes null.',
        ...make('Binding rating', 0, { showTitle: false }),
        bindingView: true,
    },
    {
        heading: 'Custom render',
        note: 'A binding callback can show the exact native number as plain text.',
        ...make('Custom rating', 0.125),
        customView: true,
    },
    {
        heading: 'No editing capability',
        note: 'A raw value without an accepted scalar remains disabled.',
        ...make('Unavailable rating', 0.5, {}, { noScalar: true }),
    },
];
const peers = [
    { kind: 'Rating', ...make('Peer rating', 3) },
    {
        kind: 'Number',
        ...make('Peer number', 12.34567, {}, { kind: 'number' }),
    },
    {
        kind: 'Currency',
        ...make('Peer currency', 1234.56789, {}, { kind: 'currency' }),
    },
    {
        kind: 'Duration',
        ...make('Peer duration', 3661.234, {}, { kind: 'duration' }),
    },
];
const enterHosts = [
    {
        id: 'single',
        title: 'Single-input form',
        submitButton: false,
        ...make('Single-input rating', 3),
    },
    {
        id: 'button',
        title: 'Form with a submit button',
        submitButton: true,
        ...make('Submit-button rating', 3),
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
            'The host counts submission and prevents navigation. No Save is connected.'
        ),
        h(FieldRenderer, {
            host: host.host,
            renderers: { renderRatingField },
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
        [locked, setLocked] = useState(false),
        [hidden, setHidden] = useState(false),
        [retired, setRetired] = useState(false),
        [rows, setRows] = useState(0),
        [submits, setSubmits] = useState(0),
        [peer, setPeer] = useState(0);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Rating'),
            h('h1', null, 'Keep the native rating.'),
            h(
                'p',
                { className: 'intro' },
                'Manual rating entry borrows the owner’s numeric draft. Values remain exact; metadata does not become a range or a star control.'
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
                'aria-label': 'rating gallery',
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
                    'customView' in card
                        ? h(RatingField, {
                              binding: card.binding,
                              render: ({ snapshot, binding }) =>
                                  h(
                                      'output',
                                      {
                                          id: 'custom-rating',
                                          'aria-label': 'Custom rating readout',
                                          'data-current-binding': String(
                                              binding === card.binding
                                          ),
                                      },
                                      String(snapshot.value)
                                  ),
                          })
                        : 'bindingView' in card
                          ? h(RatingField, {
                                binding: card.binding,
                                className: 'binding-rating',
                            })
                          : h(FieldRenderer, {
                                host: card.host,
                                renderers: { renderRatingField },
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
            {
                className: 'enter-hosts',
                'aria-label': 'Shared numeric binding',
            },
            h('h2', null, 'One mounted numeric binding'),
            h(
                'p',
                { className: 'intro' },
                'Switch separate owners through the same NumberField component. Each owner keeps its own draft and units.'
            ),
            h(
                'div',
                { className: 'toolbar' },
                ...peers.map((owner, index) =>
                    h(
                        'button',
                        {
                            key: owner.kind,
                            type: 'button',
                            onClick: () => setPeer(index),
                            'aria-pressed': peer === index,
                        },
                        `Show ${owner.kind}`
                    )
                )
            ),
            h(
                'div',
                { className: 'card', id: 'peer-card' },
                h(NumberField, {
                    key: 'same-numeric-field',
                    binding: peers[peer].binding,
                    className: 'peer-control',
                }),
                h(NativeValue, { owner: peers[peer], id: 'peer' })
            )
        ),
        h(
            'section',
            { className: 'enter-hosts', 'aria-label': 'Native Enter hosts' },
            h('h2', null, 'The host owns native submission'),
            h(
                'p',
                { className: 'intro' },
                'Stopping key bubbling does not cancel native submission. Applications own submit and Save policy.'
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
