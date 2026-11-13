import {
    createElement as h,
    StrictMode,
    useEffect,
    useState,
    type ChangeEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    CompleteLinkedFinder,
    NativeLinkedFinderCascade,
    type LinkedFinderCardProjection,
} from '@miniextensions/sdk/react';
import type {
    CompleteLinkedFinderHost,
    NativeLinkedFinderCascadeHost,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/complete-linked-finder.css';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/rich-text.css';

type Row = { id: string };
let owner = { generation: 1 };
const canonical = ['hidden', 'alpha', 'alpha'];
const subscribers = new Set<() => void>();
const counts = { queries: 0, publications: 0, toggles: 0, closes: 0 };
const admitted = { status: 'admitted' } as const,
    refused = { status: 'refused' } as const;
const notify = () => {
    for (const subscriber of subscribers) subscriber();
};
const host: CompleteLinkedFinderHost<Row, string, typeof owner> = {
    captureOwner: () => owner,
    isOwnerCurrent: (expected) => expected === owner,
    subscribe(listener) {
        subscribers.add(listener);
        return () => {
            subscribers.delete(listener);
        };
    },
    captureRead(expected, request) {
        return {
            mode: 'public',
            isCurrent: () => expected === owner,
            async query() {
                counts.queries++;
                notify();
                await new Promise((resolve) =>
                    setTimeout(resolve, request.filter === 'slow' ? 1500 : 80)
                );
                if (request.filter === 'failure')
                    throw Error('Synthetic failure');
                const ids =
                    request.filter === 'duplicate'
                        ? ['alpha', 'alpha']
                        : ['alpha', 'beta', 'private'].filter(
                              (id) =>
                                  !request.filter || id.includes(request.filter)
                          );
                return { records: ids.map((id) => ({ id })), offset: null };
            },
            publish() {
                if (expected !== owner) return refused;
                counts.publications++;
                notify();
                return admitted;
            },
        };
    },
    selection: () => ({
        ids: canonical,
        enabled: true,
        autoSelectScannedRecord: true,
    }),
    recordId: (row) => row.id,
    isOptionEnabled: () => true,
    toggle(expected, id) {
        if (expected !== owner) return refused;
        counts.toggles++;
        const next = canonical.includes(id)
            ? canonical.filter((value) => value !== id)
            : [...canonical, id];
        canonical.splice(0, canonical.length, ...next);
        notify();
        return admitted;
    },
    close(expected) {
        if (expected !== owner) return refused;
        counts.closes++;
        notify();
        return admitted;
    },
    errorMessage: () => 'Synthetic query unavailable',
};
const driverValues: Record<
    string,
    { recordId: string; stringValue: string } | null
> = {};
const cascadeHost: NativeLinkedFinderCascadeHost<typeof owner> = {
    isCurrent: (expected) => expected === owner,
    captureRead(expected) {
        return {
            isCurrent: () => expected === owner,
            async query() {
                return {
                    primaryValues: [
                        { recordId: 'country-A', stringValue: 'Same label' },
                        { recordId: 'country-B', stringValue: 'Same label' },
                    ],
                    prefillValue: null,
                };
            },
        };
    },
    publish(expected, field, value) {
        if (expected !== owner) return refused;
        driverValues[field] = value;
        notify();
        return admitted;
    },
    clear(expected, field) {
        if (expected !== owner) return refused;
        driverValues[field] = null;
        notify();
        return admitted;
    },
    setPrefillLoading() {},
    reportOrdinaryError() {},
    errorMessage: () => 'Synthetic driver unavailable',
};
const thumbnail = (color: string, label: string) =>
    'data:image/svg+xml,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160"><rect width="360" height="160" fill="${color}"/><text x="24" y="90" font-family="sans-serif" font-size="28" fill="white">${label}</text></svg>`
    );
function App() {
    const [search, setSearch] = useState('');
    const [layout, setLayout] = useState<'list' | 'gallery' | 'kanban'>('list');
    const [, refresh] = useState(0);
    useEffect(() => {
        const listener = () => refresh((value) => value + 1);
        subscribers.add(listener);
        return () => {
            subscribers.delete(listener);
        };
    }, []);
    return h(
        StrictMode,
        null,
        h('h1', null, 'Complete linked finder'),
        h(
            'p',
            null,
            'Synthetic public-package consumer on Runner 2. No camera, remote images, account or native transport is used.'
        ),
        h(
            'div',
            { className: 'controls' },
            h(
                'label',
                null,
                'Card layout ',
                h(
                    'select',
                    {
                        value: layout,
                        onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                            setLayout(event.target.value as typeof layout),
                    },
                    ['list', 'gallery', 'kanban'].map((value) =>
                        h('option', { key: value, value }, value)
                    )
                )
            ),
            h(
                'button',
                {
                    type: 'button',
                    onClick: () => {
                        owner = { generation: owner.generation + 1 };
                        notify();
                    },
                },
                'Replace owner'
            ),
            h(
                'button',
                {
                    type: 'button',
                    onClick: () =>
                        document
                            .querySelector('.mx-sdk-finder-card img')
                            ?.dispatchEvent(new Event('error')),
                },
                'Fail current image'
            )
        ),
        h(CompleteLinkedFinder<Row, string, typeof owner>, {
            host,
            filter: search,
            queryKey: 'synthetic-context',
            searchTerm: search,
            onSearchTermChange: setSearch,
            filterForSearch: (value) => value,
            labels: {
                search: 'Find a record',
                loading: 'Loading records',
                noMatches: 'No matching records',
                unavailable: 'Unavailable',
                loadMore: 'More records',
            },
            candidates: (_expected, ids) =>
                ids
                    .filter((id) => id !== 'private')
                    .map((id) => ({
                        id,
                        projection: {
                            status: 'present',
                            primary:
                                id === 'alpha'
                                    ? 'Alpha · already selected twice'
                                    : 'Beta · available',
                            language: 'en',
                            layout,
                            imageFit: 'cover',
                            imageHeight: layout === 'list' ? 100 : 180,
                            shouldRenderThumbnail: true,
                            thumbnailLocation: 'left',
                            fieldsPerCardRow: 1,
                            images: [
                                {
                                    id: 'one',
                                    url: thumbnail('#2563eb', 'First image'),
                                    filename: 'First image',
                                },
                                {
                                    id: 'two',
                                    url: thumbnail('#7c3aed', 'Second image'),
                                    filename: 'Second image',
                                },
                            ],
                            labels: {
                                previousImage: 'Previous image',
                                nextImage: 'Next image',
                                noImage: 'No image',
                                viewImage: 'View image {index}',
                            },
                            fields: [
                                {
                                    key: 'status',
                                    title: 'Status',
                                    leaf: {
                                        kind: 'pills',
                                        items: [
                                            {
                                                label: 'Admitted',
                                                color: '#166534',
                                                backgroundColor: '#dcfce7',
                                            },
                                        ],
                                    },
                                },
                                {
                                    key: 'details',
                                    title: 'Description',
                                    leaf: {
                                        kind: 'html',
                                        html: '<strong>Rich detail</strong> with filtered, admitted content.',
                                    },
                                },
                                {
                                    key: 'phone',
                                    title: 'Phone',
                                    leaf: {
                                        kind: 'phone',
                                        display: {
                                            value: '+12025550123',
                                            emptyLabel: 'No value',
                                        },
                                    },
                                },
                            ],
                        } satisfies LinkedFinderCardProjection,
                    })),
            scanner: { enabled: false, autoStartCamera: false },
        }),
        h('h2', null, 'Native-compatible cascade'),
        h(NativeLinkedFinderCascade, {
            owner,
            host: cascadeHost,
            values: driverValues,
            formReadOnly: false,
            drivers: [
                {
                    fieldId: 'country',
                    fieldName: 'Country',
                    title: 'Choose a driver by ID',
                    hidden: false,
                    urlSearchValue: undefined,
                },
            ],
            labels: {
                loading: 'Loading driver',
                noMatches: 'No matching options',
            },
        }),
        h(
            'pre',
            { id: 'evidence', 'aria-live': 'polite' },
            JSON.stringify(
                {
                    ownerGeneration: owner.generation,
                    canonicalIds: canonical,
                    driverValues,
                    counts,
                },
                null,
                2
            )
        )
    );
}
createRoot(document.getElementById('root')!).render(h(App));
