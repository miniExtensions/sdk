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
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    AutoNumberField,
    FieldRenderer,
    NumberField,
    renderAutoNumberField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/number.css';
import './styles.css';

// Typed synthetic presentation fixtures, not actual Form/Grid/List owners.
// AutoNumber has no scalar, generator or write capability. The neighboring
// Number alone borrows a public scalar model, created outside React.
const counts = { autoWrites: 0, writes: 0, rowEvents: 0 };
function increment(key: keyof typeof counts, id: string) {
    document.getElementById(id)!.textContent = String(++counts[key]);
}
function store() {
    const listeners = new Set<() => void>();
    return {
        emit: () => {
            for (const listener of listeners) listener();
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispose: () => listeners.clear(),
    };
}
type Config = FieldRendererProps<'autoNumber'>['displayConfig'];
function makeAuto(
    title: string,
    initial: number | null | undefined,
    options: {
        display?: Config;
        write?: Config;
        pending?: boolean;
        error?: string;
        fieldName?: string;
        masked?: boolean;
    } = {}
) {
    let value = initial,
        hidden = false,
        retired = false,
        revision = 0;
    const state = store();
    const field = {
        id: 'fld_repeated_sequence',
        name: options.fieldName ?? title,
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config: { type: 'autoNumber' as const, options: null },
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
                                physicalKind: 'autoNumber',
                                presentation: {
                                    type: 'physical',
                                    config: field.config,
                                },
                                fieldId: field.id,
                                title,
                                field,
                                displayConfig: options.display ?? {},
                                writeConfig: options.write ?? {},
                                value,
                                context: 'portal-cell',
                                computed: true,
                                dirty: false,
                                pending: !!options.pending,
                                error: options.error ?? null,
                                validation: [],
                                capability: { type: 'readonly' },
                            },
                        ],
                    },
        subscribe: (listener) =>
            state.subscribe(() => listener(host.getSnapshot())),
        dispose: state.dispose,
    };
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'autoNumber',
                isComputed: true,
                readOnly: true,
                schema: {
                    fieldType: 'autoNumber',
                    airtableField: field,
                    miniExtConfig: { ...options.display, ...options.write },
                },
            },
            value,
            dirty: false,
            revision,
            visibility: {
                type: hidden ? 'hidden' : 'visible',
                diagnostics: [],
            },
            readOnly: true,
            canEdit: false,
            pending: !!options.pending,
            error: options.error ?? null,
            validation: [],
            scalar: null,
            selection: null,
            date: null,
            retired,
        }),
        subscribe: (listener) =>
            state.subscribe(() => listener(binding.getSnapshot())),
        setValue: () => {
            increment('autoWrites', 'auto-writes');
            return { accepted: false, reason: 'readonly' };
        },
        scalar: null,
        selection: null,
        date: null,
    };
    return {
        host,
        binding,
        subscribe: state.subscribe,
        nativeText: () =>
            retired
                ? 'Retired'
                : hidden
                  ? 'Hidden'
                  : options.masked
                    ? 'Masked'
                    : value === undefined
                      ? 'Missing'
                      : JSON.stringify(value),
        replace: () => {
            value = 101;
            revision++;
            state.emit();
        },
        toggleHidden: () => {
            hidden = !hidden;
            state.emit();
        },
        retire: () => {
            retired = true;
            state.emit();
        },
    };
}
function makeNumber(
    title: string,
    initial: number,
    error: string | null = null
) {
    let value: number | null = initial;
    const state = store();
    const field = {
        id: 'fld_neighbor',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'number' as const, options: { precision: 2 } },
    };
    const model = createNumberFieldModel({
        getValue: () => value,
        canEdit: () => true,
        isCurrent: () => true,
        write: (next) => {
            if (typeof next === 'boolean') return false;
            value = next;
            increment('writes', 'writes');
            return true;
        },
    });
    model.subscribe(state.emit);
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'number',
                isComputed: false,
                readOnly: false,
                schema: {
                    fieldType: 'number',
                    airtableField: field,
                    miniExtConfig: {},
                },
            },
            value,
            dirty: value !== initial,
            revision: model.getState().revision,
            visibility: { type: 'visible', diagnostics: [] },
            readOnly: false,
            canEdit: true,
            pending: false,
            error,
            validation: [],
            scalar: model.getState(),
            selection: null,
            date: null,
            retired: false,
        }),
        subscribe: (listener) =>
            state.subscribe(() => listener(binding.getSnapshot())),
        setValue: () => ({ accepted: false, reason: 'readonly' }),
        scalar: model,
        selection: null,
        date: null,
    };
    return {
        binding,
        subscribe: state.subscribe,
        nativeText: () => JSON.stringify(value),
    };
}
const sequence = makeAuto('Sequence number', 42);
const lifecycle = makeAuto('Lifecycle value', 99);
const neighbor = makeNumber('Editable neighbor', 7);
const wrong = makeNumber('Other field kind', 777, 'Not an AutoNumber binding.');
const cards = [
    {
        heading: 'Existing sequence',
        note: 'A read-only slot displays the supplied value. Nothing is generated.',
        owner: sequence,
        slot: true,
    },
    {
        heading: 'Zero stays zero',
        note: 'The bound field preserves an explicit zero.',
        owner: makeAuto('Bound zero', 0),
    },
    {
        heading: 'No numeric normalization',
        note: 'Fractions and negative values display as supplied.',
        owner: makeAuto('Fractional value', -1.125),
        slot: true,
    },
    {
        heading: 'Native numeric precision',
        note: 'Large values use the native JavaScript string representation.',
        owner: makeAuto('Exponent value', 1e21),
        slot: true,
    },
    {
        heading: 'No value yet',
        note: 'Null stays blank; rendering does not allocate a sequence.',
        owner: makeAuto('Empty value', null),
    },
    {
        heading: 'Missing snapshot value',
        note: 'A missing slot value stays blank too.',
        owner: makeAuto('Missing value', undefined),
        slot: true,
    },
    {
        heading: 'Display masking',
        note: 'The display configuration masks the disabled control.',
        owner: makeAuto('Display mask', 987, {
            display: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Write configuration masking',
        note: 'Masking applies from either configuration without granting writes.',
        owner: makeAuto('Write mask', 654, {
            write: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Pending owner',
        note: 'Busy state remains visible while the field stays disabled.',
        owner: makeAuto('Pending value', 27, { pending: true }),
    },
    {
        heading: 'Owner feedback',
        note: 'The owner supplies feedback; presentation does not validate or save.',
        owner: makeAuto('Feedback value', 28, {
            error: 'Synthetic read-only feedback.',
        }),
        slot: true,
    },
    {
        heading: 'Accessible hidden title',
        note: 'A hidden visual label keeps its accessible name.',
        owner: makeAuto('Hidden title', 314, { display: { showTitle: false } }),
        slot: true,
    },
    {
        heading: 'Field-name fallback',
        note: 'A blank configured title falls back to the physical field name.',
        owner: makeAuto('   ', 2718, { fieldName: 'Fallback sequence' }),
        slot: true,
    },
    {
        heading: 'Editable Number neighbor',
        note: 'Only this separate Number model accepts edits and partial drafts.',
        owner: neighbor,
        number: true,
    },
    {
        heading: 'Wrong physical binding',
        note: 'AutoNumber refuses another physical kind even if it has a scalar.',
        owner: wrong,
        wrong: true,
    },
    {
        heading: 'Application override',
        note: 'An explicit custom renderer owns its safe presentation.',
        owner: wrong,
        custom: true,
    },
    {
        heading: 'Owner lifecycle',
        note: 'Retiring the binding removes the control and its native readout.',
        owner: lifecycle,
    },
];
function Card({ index }: { index: number }) {
    const card = cards[index];
    const native = useSyncExternalStore(
        card.owner.subscribe,
        card.owner.nativeText
    );
    return h(
        'section',
        {
            className: 'card',
            id: `card-${index}`,
            onClick: () => increment('rowEvents', 'row-events'),
            onPointerDown: () => increment('rowEvents', 'row-events'),
            onKeyDown: () => increment('rowEvents', 'row-events'),
        },
        h(
            'p',
            { className: 'card-number' },
            String(index + 1).padStart(2, '0')
        ),
        h('h2', null, card.heading),
        h('p', { className: 'note' }, card.note),
        card.custom
            ? h(AutoNumberField, {
                  binding: card.owner.binding,
                  render: () =>
                      h(
                          'p',
                          { role: 'status' },
                          'Application-owned read-only presentation.'
                      ),
              })
            : card.number
              ? h(NumberField, { binding: card.owner.binding })
              : card.slot && 'host' in card.owner
                ? h(FieldRenderer, {
                      host: card.owner.host,
                      renderers: {
                          renderAutoNumberField: (props) =>
                              renderAutoNumberField(props, {
                                  className: 'custom-autonumber',
                              }),
                      },
                  })
                : h(AutoNumberField, { binding: card.owner.binding }),
        h(
            'p',
            { className: 'native' },
            'Native snapshot: ',
            h(
                'code',
                { id: `native-${index}` },
                card.wrong || card.custom ? 'Unavailable' : native
            )
        )
    );
}
function App() {
    const [mount, setMount] = useState(0);
    return h(
        'main',
        null,
        h('p', { className: 'eyebrow' }, 'miniExtensions SDK · React'),
        h('h1', null, 'AutoNumber, read only'),
        h(
            'p',
            { className: 'intro' },
            'Existing sequence values, exactly as supplied. This synthetic gallery has no number generator, Save action, transport, or live data.'
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                { type: 'button', onClick: sequence.replace },
                'Replace sequence value'
            ),
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount controls'
            ),
            h(
                'button',
                { type: 'button', onClick: sequence.toggleHidden },
                'Toggle sequence visibility'
            ),
            h(
                'button',
                { type: 'button', onClick: lifecycle.retire },
                'Retire lifecycle binding'
            )
        ),
        h(
            'div',
            { className: 'cards', key: mount },
            cards.map((_, index) => h(Card, { key: index, index }))
        ),
        h(
            'footer',
            null,
            h(
                'span',
                null,
                'AutoNumber setter calls: ',
                h('b', { id: 'auto-writes' }, String(counts.autoWrites))
            ),
            h(
                'span',
                null,
                'Number writes: ',
                h('b', { id: 'writes' }, String(counts.writes))
            ),
            h('span', null, 'Save calls: ', h('b', { id: 'saves' }, '0')),
            h(
                'span',
                null,
                'Parent row events: ',
                h('b', { id: 'row-events' }, String(counts.rowEvents))
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
