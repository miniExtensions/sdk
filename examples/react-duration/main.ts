import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    createDurationFieldModel,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import type { DurationFormat } from '@miniextensions/sdk/formulas';
import {
    DurationField,
    FieldRenderer,
    renderDurationField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/duration.css';
import './styles.css';

// Synthetic owners live outside React. Real applications supply accepted
// Form/Portal owners, which retain drafts and provide deliberate Save actions.
let writes = 0;
const make = (
    title: string,
    initial: number | null,
    initialFormat: DurationFormat,
    displayConfig: FieldRendererProps<'duration'>['displayConfig'] = {},
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
    const durationConfig = {
        type: 'duration' as const,
        options: { durationFormat: initialFormat },
    };
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const canEdit = () => writable && !options.pending && !hidden && !retired;
    const write = (next: number | boolean | null) => {
        if (!canEdit() || typeof next === 'boolean') return false;
        value = next;
        document.querySelector('#writes')!.textContent = String(++writes);
        return true;
    };
    // The read-only fixture has no editing model: the slot formats native seconds.
    const model = options.readonly
        ? null
        : createDurationFieldModel({
              getValue: () => value,
              getDurationFormat: () => durationConfig.options.durationFormat,
              canEdit,
              isCurrent: () => !retired,
              write,
          });
    model?.subscribe(emit);
    const field = {
        id: 'fld_repeated_duration',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: durationConfig,
    };
    const config = {
        ...displayConfig,
        maskPasswordOnLoginScreen: options.mask,
    };
    const setValue: FormFieldBinding['setValue'] = (next) => {
        if (
            (next !== null &&
                (typeof next !== 'number' ||
                    !Number.isFinite(next) ||
                    !Number.isFinite(next * 1000))) ||
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
                    reason: 'Duration format changed.',
                };
            return {
                status: 'ready',
                fields: [
                    {
                        physicalKind: 'duration',
                        presentation: {
                            type: 'physical',
                            config: durationConfig,
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
                                          setFocused: model.setFocused,
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
                fieldType: 'duration',
                isComputed: false,
                readOnly: !writable,
                schema: {
                    fieldType: 'duration',
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
    return {
        host,
        binding,
        subscribe,
        nativeText: () =>
            retired || model?.getState().retired
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
            value = -7322.34567;
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
        changeFormat: () => {
            durationConfig.options.durationFormat = 'h:mm';
            emit();
        },
    };
};
const cards = [
    {
        heading: 'Milliseconds · h:mm:ss.SSS',
        note: 'Formatting rounds the display. Focus and blur leave the original native seconds untouched.',
        ...make('Work duration', 3661.23456, 'h:mm:ss.SSS', { required: true }),
    },
    {
        heading: 'Minutes · h:mm',
        note: 'A plain number means minutes in this format. Try 90 or an overflowing clock such as 1:90.',
        ...make('Meeting duration', 3661.23456, 'h:mm'),
    },
    {
        heading: 'Seconds · h:mm:ss',
        note: 'A plain number means seconds; two components mean minutes and seconds.',
        ...make('Travel duration', 3661.23456, 'h:mm:ss'),
    },
    {
        heading: 'Tenths · h:mm:ss.S',
        note: 'The existing formatter supplies the displayed precision.',
        ...make('Lap duration', 61.23456, 'h:mm:ss.S'),
    },
    {
        heading: 'Hundredths · h:mm:ss.SS',
        note: 'Subsecond input remains raw while focused and formats on blur.',
        ...make('Stage duration', 61.23456, 'h:mm:ss.SS'),
    },
    {
        heading: 'Read only',
        note: 'The slot formats native seconds without an editing model.',
        ...make(
            'Recorded duration',
            9876.54321,
            'h:mm:ss.SS',
            {},
            { readonly: true }
        ),
    },
    {
        heading: 'Masked duration',
        note: 'The value is masked in the input and omitted from the native readout.',
        ...make('Private duration', 55.123, 'h:mm:ss.SSS', {}, { mask: true }),
    },
    {
        heading: 'Saving',
        note: 'Pending state prevents further edits.',
        ...make('Pending duration', 61, 'h:mm:ss', {}, { pending: true }),
    },
    {
        heading: 'Validation',
        note: 'Returned feedback is associated with the input.',
        ...make(
            'Review duration',
            null,
            'h:mm:ss',
            {},
            { error: 'Enter the review duration.' }
        ),
    },
    {
        heading: 'Compact zero',
        note: 'Zero is a value, distinct from an empty answer. The hidden title remains accessible.',
        ...make('Compact duration', 0, 'h:mm:ss', { showTitle: false }),
    },
    {
        heading: 'Binding component',
        note: 'DurationField shares the same owner-held input, focus and native state.',
        ...make('Binding duration', 61.23456, 'h:mm:ss.SSS'),
    },
    {
        heading: 'Configuration replacement',
        note: 'Changing this format retires the accepted owner. A fresh owner is required for editing.',
        ...make('Configurable duration', 7322.3456, 'h:mm:ss.SSS'),
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
        'Native seconds: ',
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
    const [formatChanged, setFormatChanged] = useState(false);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK / Duration'),
            h('h1', null, 'Time, without losing precision.'),
            h(
                'p',
                { className: 'intro' },
                'Five clock formats over native seconds. The existing owner keeps unfinished input, exact values and permission checks; your application owns the presentation.'
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
                    disabled: formatChanged,
                    onClick: () => {
                        cards[11].changeFormat();
                        setFormatChanged(true);
                    },
                },
                'Change duration format'
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
                    index === 10
                        ? h(DurationField, {
                              binding: card.binding,
                              className: 'binding-duration',
                              clearLabel: 'Clear binding duration',
                          })
                        : h(FieldRenderer, {
                              host: card.host,
                              renderers: { renderDurationField },
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
