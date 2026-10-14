import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    createNumberFieldModel,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import {
    CurrencyField,
    FieldRenderer,
    renderCurrencyField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/currency.css';
import './styles.css';

// Synthetic owners live outside React. Real applications supply accepted
// Form/Portal owners, which retain drafts and provide deliberate Save actions.
let writes = 0;
const make = (
    title: string,
    initial: number | null,
    symbol: string,
    displayConfig: FieldRendererProps<'currency'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        mask?: boolean;
    } = {}
) => {
    let value = initial;
    let savedValue = initial;
    let writable = !options.readonly;
    let hidden = false;
    let retired = false;
    const currencyConfig = {
        type: 'currency' as const,
        options: { symbol, precision: 2 },
    };
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const canEdit = () =>
        writable &&
        !options.pending &&
        !hidden &&
        !retired &&
        !(
            displayConfig &&
            'readOnly' in displayConfig &&
            displayConfig.readOnly
        );
    const write = (next: number | boolean | null) => {
        if (!canEdit() || typeof next === 'boolean') return false;
        value = next;
        document.querySelector('#writes')!.textContent = String(++writes);
        return true;
    };
    // The read-only host displays native numbers without an editing model.
    const model = options.readonly
        ? null
        : createNumberFieldModel({
              getValue: () => value,
              canEdit,
              isCurrent: () => !retired,
              write,
          });
    model?.subscribe(emit);
    const field = {
        id: 'fld_repeated_currency',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: currencyConfig,
    };
    const config = {
        ...displayConfig,
        maskPasswordOnLoginScreen: options.mask,
    };
    const setValue: FormFieldBinding['setValue'] = (next) => {
        if (
            (next !== null &&
                (typeof next !== 'number' || !Number.isFinite(next))) ||
            model?.getState().retired ||
            !write(next)
        )
            return { accepted: false, reason: 'invalid-value' };
        model?.refresh();
        emit();
        return { accepted: true };
    };
    const subscribe = (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    const host: FieldRendererHost = {
        getSnapshot: () => {
            if (retired) return { status: 'retired', reason: 'Owner retired.' };
            if (hidden) return { status: 'hidden', reason: 'Field hidden.' };
            const scalar = model?.getState();
            if (scalar?.retired)
                return {
                    status: 'retired',
                    reason: 'Owner retired.',
                };
            return {
                status: 'ready',
                fields: [
                    {
                        physicalKind: 'currency',
                        presentation: {
                            type: 'physical',
                            config: currencyConfig,
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
                        capability:
                            writable && model && scalar
                                ? {
                                      type: 'editable',
                                      setValue,
                                      scalar: {
                                          state: scalar,
                                          setInput: model.setInput,
                                          setChecked: model.setChecked,
                                      },
                                  }
                                : { type: 'readonly' },
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
                fieldId: field.id,
                title,
                fieldType: 'currency',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'currency',
                    airtableField: field,
                    miniExtConfig: config,
                },
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
            retired: retired || model?.getState().retired === true,
        }),
        subscribe: (listener) => {
            listener(binding.getSnapshot());
            return subscribe(() => listener(binding.getSnapshot()));
        },
        setValue,
        selection: null,
        scalar: model,
        date: null,
    };
    const safeText = (candidate: number | null) =>
        retired || model?.getState().retired
            ? 'Retired'
            : hidden
              ? 'Hidden'
              : options.mask
                ? 'Masked'
                : JSON.stringify(candidate);
    return {
        host,
        binding,
        subscribe,
        nativeText: () => safeText(value),
        savedText: () => safeText(savedValue),
        // A local checkpoint only. Real apps call their owner's explicit Save.
        save: () => {
            const state = model?.getState();
            if (!canEdit() || !state?.canEdit || !state.valid || state.retired)
                return false;
            savedValue = value;
            emit();
            return true;
        },
        togglePermission: () => {
            writable = !writable;
            emit();
        },
        replaceValue: () => {
            value = -9876.54321;
            model?.refresh();
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
        changeSymbol: () => {
            currencyConfig.options.symbol = 'CHF';
            currencyConfig.options.precision = 0;
            emit();
        },
    };
};
const cards = [
    {
        heading: 'Precision stays in the draft',
        note: 'Initial precision metadata is 2; the loaded native precision remains in the input and draft.',
        ...make('Project budget', 1234.56789, '$', { required: true }),
    },
    {
        heading: 'A different symbol',
        note: 'The literal symbol sits outside the raw numeric input.',
        ...make('Euro amount', 12.3, '€'),
    },
    {
        heading: 'Literal configuration',
        note: 'Markup-like symbol text is displayed as plain text.',
        ...make('Custom-symbol amount', 25, '<coin>'),
    },
    {
        heading: 'Long symbol',
        note: 'Custom symbols wrap without widening a narrow layout.',
        ...make(
            'Long-symbol amount',
            12.34567,
            'VeryLongCurrencySymbolWithoutBreaksForPreview'
        ),
    },
    {
        heading: 'Read only',
        note: 'Native precision is visible without an editing model or write capability.',
        ...make('Recorded amount', 9876.54321, 'US$', {}, { readonly: true }),
    },
    {
        heading: 'Masked amount',
        note: 'The amount is masked in its input and omitted from the native readout.',
        ...make('Private amount', 88.76543, '£', {}, { mask: true }),
    },
    {
        heading: 'Saving',
        note: 'Pending state prevents further edits.',
        ...make('Pending amount', 72.5, '¥', {}, { pending: true }),
    },
    {
        heading: 'Validation',
        note: 'Returned feedback and the symbol description are associated with this input.',
        ...make(
            'Review amount',
            null,
            'CAD',
            {},
            { error: 'Enter the review amount.' }
        ),
    },
    {
        heading: 'Compact zero',
        note: 'Zero remains distinct from an empty answer. The hidden title retains its accessible name.',
        ...make('Compact amount', 0, '₹', { showTitle: false }),
    },
    {
        heading: 'Binding component',
        note: 'CurrencyField shares the owner’s input buffer and native draft.',
        ...make('Binding amount', 61.23456, 'A$'),
    },
    {
        heading: 'Configuration read only',
        note: 'Returned display policy can further restrict an otherwise editable owner.',
        ...make('Configured readonly amount', 150.12345, 'R$', {
            readOnly: true,
        }),
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
function SavedValue() {
    const saved = useSyncExternalStore(
        cards[0].subscribe,
        cards[0].savedText,
        cards[0].savedText
    );
    return h(
        'p',
        { className: 'checkpoint' },
        'First draft saved locally: ',
        h('code', { id: 'saved' }, saved)
    );
}
function App() {
    const [mount, setMount] = useState(0);
    const [rowEvents, setRowEvents] = useState(0);
    const [submits, setSubmits] = useState(0);
    const [locked, setLocked] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [retired, setRetired] = useState(false);
    const [symbolChanged, setSymbolChanged] = useState(false);
    const [saves, setSaves] = useState(0);
    const [saveMessage, setSaveMessage] = useState(
        'Typing only changes the local draft.'
    );
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Currency'),
            h('h1', null, 'Amounts, without rounding surprises.'),
            h(
                'p',
                { className: 'intro' },
                'Raw numbers with a configured currency symbol. The existing owner keeps partial input, exact native values and permission checks; the application decides when to Save.'
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
                    disabled: symbolChanged,
                    onClick: () => {
                        cards[0].changeSymbol();
                        setSymbolChanged(true);
                    },
                },
                'Change currency symbol'
            ),
            h(
                'button',
                {
                    type: 'button',
                    disabled: retired,
                    onClick: () => {
                        const accepted = cards[0].save();
                        if (accepted) setSaves(saves + 1);
                        setSaveMessage(
                            accepted
                                ? 'Saved first draft locally.'
                                : 'Save blocked: the first draft must be editable and valid.'
                        );
                    },
                },
                'Save first draft locally'
            ),
            h(
                'span',
                null,
                'Local draft writes: ',
                h('strong', { id: 'writes' }, writes)
            )
        ),
        h(
            'div',
            { className: 'save-summary' },
            h(SavedValue),
            h('p', { id: 'save-status', role: 'status' }, saveMessage)
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
                    index === 9
                        ? h(CurrencyField, {
                              binding: card.binding,
                              className: 'binding-currency',
                              clearLabel: 'Clear binding currency',
                          })
                        : h(FieldRenderer, {
                              host: card.host,
                              renderers: { renderCurrencyField },
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
            h('span', null, 'Backend requests: 0'),
            h(
                'span',
                null,
                'Explicit local saves: ',
                h('strong', { id: 'saves' }, saves)
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
