import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    createSelectionModel,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    FieldRenderer,
    renderMultipleRecordLinksField,
    useFieldRendererHost,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/linked-records.css';
import './styles.css';

// Synthetic accepted hosts and the existing selection model. No backend writes.
const initial = ['rec_alpha', 'rec_filtered', 'rec_alpha', 'rec_missing'];
const primary = {
    id: 'name',
    name: 'Name',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: 'singleLineText', options: null },
} as const;
const field: FieldRendererProps<'multipleRecordLinks'>['field'] = {
    id: 'links',
    name: 'Projects',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'multipleRecordLinks',
        options: {
            linkedTableId: 'projects',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
};
let reads = 0,
    searches = 0,
    pages = 0;
const count = (id: string, value: number) => {
    document.getElementById(id)!.textContent = String(value);
};
function make(title: string, mode: 'form' | 'grid' | 'list' | 'masked') {
    let value = [...initial],
        hydrated = false,
        current = true;
    const listeners = new Set<() => void>();
    const notify = () => {
        for (const listener of listeners) listener();
    };
    const model = createSelectionModel({
        multiple: true,
        value,
        loadOptions: async (request) => {
            if (request.offset) count('pages', ++pages);
            else count('searches', ++searches);
            return {
                options: request.offset
                    ? [{ value: 'rec_gamma', label: 'Gamma' }]
                    : [
                          { value: 'rec_beta', label: 'Beta' },
                          { value: 'rec_no_label', label: 'rec_no_label' },
                      ],
                offset: request.offset ? null : 'more',
            };
        },
        onChange: (next) => {
            value = [...next];
            notify();
        },
    });
    const host: FieldRendererHost = {
        getSnapshot: () => {
            if (!current)
                return { status: 'retired', reason: 'Synthetic owner retired' };
            const props: FieldRendererProps<'multipleRecordLinks'> = {
                physicalKind: 'multipleRecordLinks',
                presentation: { type: 'physical', config: field.config },
                fieldId: 'links',
                field,
                title,
                context:
                    mode === 'grid'
                        ? 'portal-cell'
                        : mode === 'list'
                          ? 'portal-detail'
                          : 'form',
                displayConfig:
                    mode === 'masked'
                        ? { maskPasswordOnLoginScreen: true }
                        : {},
                writeConfig: {},
                value,
                computed: false,
                dirty: false,
                pending: false,
                error: null,
                validation: [],
                linkedRecords:
                    mode === 'form' || mode === 'masked'
                        ? {
                              source: 'form',
                              state: {
                                  phase: hydrated ? 'ready' : 'idle',
                                  pending: false,
                                  error: null,
                                  linkedTableId: 'projects',
                                  selectedRecords: hydrated
                                      ? [
                                            {
                                                id: 'rec_alpha',
                                                fields: { name: 'Alpha' },
                                            },
                                            {
                                                id: 'rec_beta',
                                                fields: { name: 'Beta' },
                                            },
                                            {
                                                id: 'rec_gamma',
                                                fields: { name: 'Gamma' },
                                            },
                                        ]
                                      : [],
                                  unresolvedSelectedIds: [],
                                  candidateRecords: [],
                                  table: { airtableFields: [primary] },
                                  detailFields: [
                                      {
                                          fieldId: 'name',
                                          fieldName: 'Name',
                                          titleOverride: null,
                                          isHidden: false,
                                          fieldIsInEditingChildForm: false,
                                          childFormField: null,
                                          miniExtConfig: {},
                                      },
                                  ],
                                  detailProjection: 'present',
                                  selectedPolicy: {
                                      supported: true,
                                      reasons: [],
                                      state: 'applied',
                                      diagnostics: [],
                                  },
                              },
                              readSelected: async () => {
                                  if (!current) return false;
                                  count('reads', ++reads);
                                  hydrated = true;
                                  notify();
                                  return true;
                              },
                          }
                        : {
                              source: 'portal-pills',
                              items: value.map((id, nativeIndex) =>
                                  id === 'rec_alpha'
                                      ? {
                                            nativeIndex,
                                            state: 'resolved',
                                            label: 'Alpha',
                                        }
                                      : {
                                            nativeIndex,
                                            state: 'unavailable',
                                            label: null,
                                        }
                              ),
                          },
                capability:
                    mode === 'list'
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
                                  toggle: (id) => {
                                      if (current) model.toggle(id);
                                  },
                                  clear: () => {
                                      if (current) model.clear();
                                  },
                                  setSearchInput: model.setSearchInput,
                                  reload: model.reload,
                                  loadMore: model.loadMore,
                                  cancel: model.cancel,
                              },
                          },
            };
            return { status: 'ready', fields: [props] };
        },
        subscribe: (listener) => {
            const notify = () => listener(host.getSnapshot());
            listeners.add(notify);
            const stop = model.subscribe(notify);
            return () => {
                listeners.delete(notify);
                stop();
            };
        },
        dispose: () => {
            current = false;
            model.destroy();
            notify();
        },
    };
    return { host, title };
}
const cards = [
    make('Form projects', 'form'),
    make('Grid projects', 'grid'),
    make('List projects', 'list'),
    make('Masked projects', 'masked'),
];
function Native({ host, index }: { host: FieldRendererHost; index: number }) {
    const state = useFieldRendererHost(host);
    return h(
        'output',
        { id: `native-${index}` },
        state.status === 'ready'
            ? JSON.stringify(state.fields[0].value)
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
                'miniExtensions SDK / Linked Records'
            ),
            h('h1', null, 'Find records. Keep control.'),
            h(
                'p',
                { className: 'intro' },
                'Load labels and search only when requested. Selection updates the draft; saving remains an explicit application action.'
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
                { type: 'button', onClick: () => cards[0].host.dispose() },
                'Retire Form owner'
            )
        ),
        h(
            'form',
            {
                key: mount,
                className: 'cards',
                onSubmit: (event) => {
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
                        renderers: { renderMultipleRecordLinksField },
                        fallback: () => null,
                    }),
                    h(Native, { host: card.host, index })
                )
            )
        ),
        h(
            'footer',
            null,
            ...[
                ['reads', reads],
                ['searches', searches],
                ['pages', pages],
                ['saves', 0],
                ['rows', rows],
                ['submits', submits],
            ].map(([id, value]) =>
                h(
                    'span',
                    { key: id },
                    `${id}: `,
                    h('strong', { id: String(id) }, value)
                )
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
