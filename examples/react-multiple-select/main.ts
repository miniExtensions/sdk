import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    createSelectFieldModel,
    type FieldRendererHost,
    type FieldRendererProps,
    type FieldSchema,
} from '@miniextensions/sdk/ui';
import {
    FieldRenderer,
    renderMultipleSelectsField,
    useFieldRendererHost,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/multiple-select.css';
import './styles.css';

// Local synthetic owners only. Applications supply their accepted Form/Grid/List
// hosts and explicitly install a Form choice controller when creation is allowed.
let writes = 0,
    creations = 0;
const schema: FieldSchema<'multipleSelects'> = {
    fieldType: 'multipleSelects',
    airtableField: {
        id: 'colors',
        name: 'Colors',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'multipleSelects',
            options: {
                choices: [
                    { id: 'red', name: 'Red' },
                    { id: 'blue', name: 'Blue' },
                    { id: 'green', name: 'Green' },
                ],
            },
        },
    },
    miniExtConfig: {
        allowAddingNewOptions: true,
        maxNumberOfSelections: 2,
        enableConditionalOptions: true,
        conditionsForOptions: [
            {
                id: 'blue-label',
                config: {
                    optionForConditions: 'blue',
                    name: 'Azure',
                    conditionsForOption: {
                        logicalOperator: 'and',
                        conditions: [],
                    },
                },
            },
        ],
    },
};
const make = (
    title: string,
    initial: string[],
    mode: 'form' | 'grid' | 'list' | 'blocked' | 'readonly' | 'pending',
    create = false
) => {
    let value = initial;
    let current = true;
    const model = createSelectFieldModel({
        field: schema,
        value,
        disabled: mode === 'pending',
        readOnly: mode === 'readonly' || mode === 'list',
        onChange: (next) => {
            if (!current || !Array.isArray(next)) return;
            value = [...next] as string[];
            document.querySelector('#writes')!.textContent = String(++writes);
        },
    });
    if (mode === 'blocked') model.setOptions([]);
    const host: FieldRendererHost = {
        getSnapshot: () => {
            if (!current)
                return { status: 'retired', reason: 'Example owner retired' };
            const props: FieldRendererProps<'multipleSelects'> = {
                physicalKind: 'multipleSelects',
                presentation: {
                    type: 'physical',
                    config: schema.airtableField.config,
                },
                fieldId: 'colors',
                field: schema.airtableField,
                title,
                displayConfig: schema.miniExtConfig ?? null,
                value,
                context:
                    mode === 'grid'
                        ? 'portal-cell'
                        : mode === 'list'
                          ? 'portal-detail'
                          : 'form',
                computed: false,
                dirty: value !== initial,
                pending: mode === 'pending',
                error: null,
                validation: [],
                selectAvailability:
                    mode === 'blocked'
                        ? { status: 'blocked', code: 'unavailable-record' }
                        : { status: 'ready' },
                capability:
                    mode === 'readonly' || mode === 'list'
                        ? { type: 'readonly' }
                        : {
                              type: 'editable',
                              setValue: () => ({
                                  accepted: false,
                                  reason: 'readonly',
                              }),
                              selection: {
                                  state: model.getState(),
                                  choose: (next) => {
                                      if (current) model.choose(next);
                                  },
                                  toggle: (name) => {
                                      if (current) model.toggle(name);
                                  },
                                  clear: () => {
                                      if (current) model.clear();
                                  },
                                  setSearchInput: model.setSearchInput,
                                  reload: model.reload,
                                  loadMore: model.loadMore,
                                  cancel: model.cancel,
                              },
                              choice: create
                                  ? {
                                        state: {
                                            phase: 'idle',
                                            canCreate: value.length < 2,
                                            busy: false,
                                            error: null,
                                            revision: 0,
                                            choice: null,
                                        },
                                        create: async (name) => {
                                            if (
                                                !current ||
                                                value.length >= 2 ||
                                                !name.trim()
                                            )
                                                return false;
                                            document.querySelector(
                                                '#creations'
                                            )!.textContent = String(
                                                ++creations
                                            );
                                            model.setOptions([
                                                ...model.getState().options,
                                                { value: name, label: name },
                                            ]);
                                            model.toggle(name);
                                            return true;
                                        },
                                        cancel: () => {},
                                    }
                                  : undefined,
                          },
            };
            return { status: 'ready', fields: [props] };
        },
        subscribe: (listener) =>
            model.subscribe(() => listener(host.getSnapshot())),
        dispose: () => model.destroy(),
    };
    return {
        title,
        host,
        value: () => value,
        retire: () => {
            current = false;
            model.setDisabled(true);
        },
    };
};
const cards = [
    make('Form colors', ['Red'], 'form', true),
    make('Grid colors', ['Blue', 'Red'], 'grid'),
    make('List colors', ['Blue', 'Legacy'], 'list'),
    make('Blocked colors', ['Legacy', 'Red'], 'blocked'),
    make('Read-only colors', ['Green'], 'readonly'),
    make('Pending colors', ['Red'], 'pending'),
];
function NativeValue({
    host,
    index,
}: {
    host: FieldRendererHost;
    index: number;
}) {
    const snapshot = useFieldRendererHost(host);
    return h(
        'output',
        { id: `native-${index}` },
        snapshot.status === 'ready'
            ? JSON.stringify(snapshot.fields[0].value)
            : 'Retired'
    );
}
function App() {
    const [mount, setMount] = useState(0);
    const [rows, setRows] = useState(0);
    const [submits, setSubmits] = useState(0);
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h(
                'p',
                { className: 'eyebrow' },
                'miniExtensions SDK / Multiple Select'
            ),
            h('h1', null, 'Choose more. Keep the order.'),
            h(
                'p',
                { className: 'intro' },
                'Select and remove choices in a local draft. Creating a choice is separate from saving the record.'
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
                { type: 'button', onClick: cards[0].retire },
                'Retire Form owner'
            ),
            h(
                'span',
                null,
                'Draft writes: ',
                h('strong', { id: 'writes' }, writes),
                ' · Choices created: ',
                h('strong', { id: 'creations' }, creations)
            )
        ),
        h(
            'form',
            {
                key: mount,
                className: 'cards',
                'aria-label': 'Multiple Select examples',
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
                        onClick: () => setRows(rows + 1),
                        onKeyDown: () => setRows(rows + 1),
                        onDoubleClick: () => setRows(rows + 1),
                        onPointerDown: () => setRows(rows + 1),
                    },
                    h('h2', null, card.title),
                    h(FieldRenderer, {
                        host: card.host,
                        renderers: { renderMultipleSelectsField },
                        fallback: () => null,
                    }),
                    h(NativeValue, { host: card.host, index })
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
                h('strong', { id: 'rows' }, rows)
            ),
            h(
                'span',
                null,
                'Form submissions: ',
                h('strong', { id: 'submits' }, submits)
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
