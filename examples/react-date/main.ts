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
    DateField,
    FieldRenderer,
    renderDateField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/date.css';
import './styles.css';

// Synthetic owners live outside React. Real applications supply accepted
// Form/Portal owners and their separate, deliberate Save action.
let writes = 0;
const dateConfig = {
    type: 'date',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
} as const;
const make = (
    title: string,
    initial: string | null,
    displayConfig: FieldRendererProps<'date'>['displayConfig'] = {},
    options: {
        readonly?: boolean;
        pending?: boolean;
        error?: string;
        mask?: boolean;
    } = {}
) => {
    let value = initial;
    let writable = !options.readonly;
    let hidden = false;
    let retired = false;
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const canEdit = () => writable && !options.pending && !hidden && !retired;
    const model = createDateFieldModel({
        kind: 'date',
        getValue: () => value,
        getConfig: () => dateConfig,
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
        id: 'fld_repeated_date',
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
            return {
                status: 'ready',
                fields: [
                    {
                        physicalKind: 'date',
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
                fieldType: 'date',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'date',
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
            retired,
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
            value = '2011-12-30';
            model.refresh();
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
        heading: 'A date in progress',
        note: 'Partial text stays here. The native draft changes only for a valid calendar date.',
        ...make('Target date', '2026-10-14', { required: true }),
    },
    {
        heading: 'Masked date',
        note: 'The edit configuration keeps this date out of plain text.',
        ...make('Private milestone', '2025-06-17', {}, { mask: true }),
    },
    {
        heading: 'Read only',
        note: 'The accepted native value is visible without edit permission.',
        ...make('Archive date', '2020-01-31', {}, { readonly: true }),
    },
    {
        heading: 'Validation',
        note: 'Returned feedback is associated with its control.',
        ...make('Review date', null, {}, { error: 'Choose a review date.' }),
    },
    {
        heading: 'Saving',
        note: 'Pending state prevents additional input.',
        ...make('Release date', '2026-11-01', {}, { pending: true }),
    },
    {
        heading: 'Compact row',
        note: 'A hidden visual title retains an accessible name.',
        ...make('Compact date', '2026-12-31', { showTitle: false }),
    },
    {
        heading: 'Binding component',
        note: 'DateField uses the same owner and calendar-date semantics as the slot.',
        ...make('Binding date', '2024-02-29'),
    },
];
const enterHosts = [
    {
        id: 'single',
        title: 'Single-input form',
        note: 'One text input and no submit button. The host counts submit events and prevents navigation.',
        submitButton: false,
        ...make('Single-input date', '2024-02-29'),
    },
    {
        id: 'button',
        title: 'Form with a submit button',
        note: 'A native submit button belongs to this host. Counting its activation never calls Save.',
        submitButton: true,
        ...make('Submit-button date', '2024-02-29'),
    },
];
function NativeValue({
    card,
    index,
}: {
    card: ReturnType<typeof make>;
    index: number | string;
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
function EnterHostExample({ host }: { host: (typeof enterHosts)[number] }) {
    const [submits, setSubmits] = useState(0);
    const [buttonClicks, setButtonClicks] = useState(0);
    const [keyEvents, setKeyEvents] = useState(0);
    return h(
        'form',
        {
            className: 'card enter-host',
            'aria-label': host.title,
            onSubmit: (event: import('react').FormEvent) => {
                // The enclosing application owns submission policy. This
                // synthetic host only observes it; no Save is connected.
                event.preventDefault();
                setSubmits((count) => count + 1);
            },
            onKeyDown: () => setKeyEvents((count) => count + 1),
        },
        h('h2', null, host.title),
        h('p', { className: 'note' }, host.note),
        h(FieldRenderer, {
            host: host.host,
            renderers: { renderDateField },
            fallback: () => null,
        }),
        host.submitButton
            ? h(
                  'button',
                  {
                      type: 'submit',
                      className: 'host-submit',
                      onClick: () => setButtonClicks((count) => count + 1),
                  },
                  'Count native submission'
              )
            : null,
        h(NativeValue, { card: host, index: `enter-${host.id}` }),
        h(
            'p',
            { className: 'host-events' },
            'Native submissions: ',
            h('strong', { id: `enter-${host.id}-submits` }, submits),
            ' · Submit-button activations: ',
            h('strong', { id: `enter-${host.id}-clicks` }, buttonClicks),
            ' · Bubbled keydowns: ',
            h('strong', { id: `enter-${host.id}-keys` }, keyEvents)
        )
    );
}
function App() {
    const [mount, setMount] = useState(0);
    const [rowEvents, setRowEvents] = useState(0);
    const [submits, setSubmits] = useState(0);
    const [locked, setLocked] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [retired, setRetired] = useState(false);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Date'),
            h('h1', null, 'A day, exactly as entered.'),
            h(
                'p',
                { className: 'intro' },
                'Calendar dates with room for unfinished input. The existing owner keeps the draft; optional styles keep the presentation in your hands.'
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
                'aria-label': 'Date gallery',
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
                    index === cards.length - 1
                        ? h(DateField, {
                              binding: card.binding,
                              className: 'binding-date',
                              clearLabel: 'Clear binding date',
                          })
                        : h(FieldRenderer, {
                              host: card.host,
                              renderers: { renderDateField },
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
        ),
        h(
            'section',
            { className: 'enter-hosts', 'aria-label': 'Native Enter hosts' },
            h('h2', null, 'Native Enter belongs to the host form'),
            h(
                'p',
                { className: 'intro' },
                'Stopping keyboard events from reaching a row does not cancel native form submission. These isolated hosts show the browser behavior; the application decides when to Save.'
            ),
            h(
                'div',
                { className: 'cards' },
                ...enterHosts.map((host) =>
                    h(EnterHostExample, { key: host.id, host })
                )
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
