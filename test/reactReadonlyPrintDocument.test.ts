import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    ReadonlyPrintDocumentView,
    prepareReadonlyPrintDocument,
} from '../src/react/ReadonlyPrintDocumentView.js';
import type {
    ReadonlyPrintDocument,
    ReadonlyPrintField,
    ReadonlyPrintFacet,
} from '../src/ui/readonlyPrintDocument.js';

const field = (
    key: string,
    facet: ReadonlyPrintFacet,
    title = key
): ReadonlyPrintField => ({
    key,
    fieldName: key,
    title,
    semanticTitle: title,
    showTitle: true,
    required: false,
    sameRow: false,
    enableSideBySideOnMobile: false,
    facet,
});
const text = (value: string): ReadonlyPrintFacet => ({
    kind: 'text',
    value,
    emptyLabel: 'No value',
});
const doc = (...fields: ReadonlyPrintField[]): ReadonlyPrintDocument => ({
    language: 'en',
    fields,
});

async function mount(t: TestContext, node: ReactNode) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'Element',
        'Node',
        'MutationObserver',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) =>
            originals[index]
                ? Object.defineProperty(globalThis, key, originals[index]!)
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    });
    const render = async (value: ReactNode) =>
        act(async () => root.render(h(StrictMode, null, value)));
    await render(node);
    return { window, container, render };
}

test('renders complete flat readonly fields, exact masks/custom labels and visible rating print meaning', async (t) => {
    const document = doc(
        field('later-page', text('Full Form later page')),
        field('password', text('********')),
        field('select', {
            kind: 'pills',
            items: [{ label: 'Display second' }, { label: 'Display first' }],
            emptyLabel: 'None',
        }),
        field('rating', {
            kind: 'rating',
            value: 3,
            max: 5,
            icon: 'heart',
            color: '#f00',
            emptyLabel: 'None',
            glyph: {
                path: 'M1 2L3 4',
                viewBox: '0 0 18 18',
                unfilledColor: '#ddd',
            },
        })
    );
    const f = await mount(t, h(ReadonlyPrintDocumentView, { document }));
    assert.deepEqual(
        Array.from(f.container.querySelectorAll('.mx-sdk-field-title')).map(
            (item) => item.textContent
        ),
        ['later-page', 'password', 'select', 'rating']
    );
    assert.match(f.container.textContent ?? '', /Full Form later page/);
    assert.match(f.container.textContent ?? '', /\*{8}/);
    assert.deepEqual(
        Array.from(f.container.querySelectorAll('.mx-sdk-print-pill')).map(
            (item) => item.textContent
        ),
        ['Display second', 'Display first']
    );
    assert.match(
        f.container.querySelector('.mx-sdk-print-rating-summary')
            ?.textContent ?? '',
        /\(3\/5\)/
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-print-rating-icons svg')
            ?.getAttribute('viewBox'),
        '0 0 18 18'
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-print-rating-icons path')
            ?.getAttribute('fill'),
        '#f00'
    );
    assert.equal(
        f.container
            .querySelector('input[type=range]')
            ?.hasAttribute('disabled'),
        true
    );
    const ratingLabel = f.container
        .querySelector('input[type=range]')
        ?.getAttribute('aria-labelledby');
    assert.ok(ratingLabel);
    assert.equal(
        f.window.document.getElementById(ratingLabel)?.textContent,
        'rating'
    );
    const ratingInput = f.container.querySelector('input[type=range]');
    const ratingElement = f.window.document.getElementById(ratingLabel);
    assert.equal(ratingElement?.tagName, 'LABEL');
    assert.equal(
        (ratingElement as unknown as HTMLLabelElement).control,
        ratingInput
    );
    assert.equal(f.container.querySelector('form'), null);
    assert.equal(f.container.querySelector('button[type=submit]'), null);
});

test('same-count config replacement updates chrome, order, errors, semantic identity and row facts', async (t) => {
    const first = doc({
        ...field('one', text('Before')),
        required: true,
        description: {
            html: '<p>Help before</p>',
            imageUrl: null,
            placement: 'bottom',
            truncate: false,
        },
        error: 'Error before',
    });
    const f = await mount(t, h(ReadonlyPrintDocumentView, { document: first }));
    assert.match(f.container.textContent ?? '', /Help before/);
    const second = doc({
        ...field('one', text('After'), ''),
        semanticTitle: 'Configured hidden title',
        showTitle: false,
        sameRow: true,
        enableSideBySideOnMobile: true,
        error: 'New error',
    });
    await f.render(h(ReadonlyPrintDocumentView, { document: second }));
    assert.equal(f.container.textContent?.includes('Help before'), false);
    assert.match(
        f.container.textContent ?? '',
        /Configured hidden title.*After.*New error/s
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-field-row-break')
            ?.getAttribute('data-same-row'),
        'true'
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-field-row-break')
            ?.getAttribute('data-mobile-same-row'),
        'true'
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-field-title')
            ?.classList.contains('mx-sdk-field-sr-only'),
        true
    );
});

test('recursive rich print collections retain all occurrences and state without action controls', async (t) => {
    const media: Extract<ReadonlyPrintFacet, { kind: 'attachments' }> = {
        kind: 'attachments',
        layout: 'thumbnail',
        columns: 2,
        fit: 'contain',
        thumbnailSize: 'large',
        thumbnailHeight: 120,
        showNames: true,
        emptyLabel: 'None',
        items: ['one', 'one', 'two'].map((key) => ({
            key,
            kind: 'image',
            label: key,
            url: `https://example.test/${key}`,
            imageSources: [`https://example.test/${key}`],
        })),
    };
    const document = doc(
        field('linked', {
            kind: 'linkedRecords',
            layout: 'gallery',
            columns: 2,
            thumbnailLocation: 'right',
            emptyLabel: 'None',
            records: [
                {
                    key: 'record',
                    status: 'present',
                    primary: 'Visible primary',
                    thumbnail: media,
                    fields: [
                        field('detail', {
                            kind: 'sequence',
                            layout: 'stack',
                            emptyLabel: 'None',
                            items: [
                                text('Detail'),
                                {
                                    kind: 'quill',
                                    value: '<p>Rich body</p>',
                                    emptyLabel: 'None',
                                },
                            ],
                        }),
                    ],
                },
                { key: 'record', status: 'unavailable', label: 'Unavailable' },
            ],
        })
    );
    const f = await mount(t, h(ReadonlyPrintDocumentView, { document }));
    assert.match(
        f.container.textContent ?? '',
        /Visible primary.*Detail.*Rich body.*Unavailable/s
    );
    assert.equal(f.container.querySelectorAll('figure').length, 3);
    assert.equal(f.container.querySelectorAll('img[loading=eager]').length, 3);
    assert.equal(f.container.querySelectorAll('button').length, 0);
    assert.equal(
        f.container.querySelector('[data-print-state=unavailable]')
            ?.textContent,
        'Unavailable'
    );
});

test('unsupported thumbnails and unsafe resources refuse before any partial DOM exists', async (t) => {
    const invalid = doc(
        field('valid', text('Must not render')),
        field('resource', {
            kind: 'resource',
            label: 'Unsafe',
            href: 'javascript:alert(1)',
        })
    );
    assert.deepEqual(prepareReadonlyPrintDocument(invalid), {
        status: 'refused',
        reason: 'unsupported-facet',
        fieldKey: 'resource',
    });
    const f = await mount(
        t,
        h(ReadonlyPrintDocumentView, { document: invalid })
    );
    assert.equal(f.container.firstChild, null);
    await f.render(
        h(ReadonlyPrintDocumentView, {
            document: doc(
                field('media', {
                    kind: 'attachments',
                    layout: 'thumbnail',
                    columns: 1,
                    fit: 'cover',
                    thumbnailSize: 'medium',
                    showNames: true,
                    emptyLabel: 'None',
                    items: [
                        {
                            key: 'pdf',
                            kind: 'document',
                            label: 'PDF',
                            url: 'https://example.test/file.pdf',
                            imageSources: [],
                        },
                    ],
                })
            ),
        })
    );
    assert.equal(f.container.firstChild, null);
});

test('server render stays free of browser/job effects and preserves literal display escaping', () => {
    assert.equal(typeof globalThis.document, 'undefined');
    const html = renderToString(
        h(ReadonlyPrintDocumentView, {
            document: doc(field('safe', text('<script>secret()</script>'))),
        })
    );
    assert.match(html, /&lt;script&gt;secret\(\)&lt;\/script&gt;/);
    assert.equal(html.includes('<iframe'), false);
    assert.equal(html.includes('<script>'), false);
});

test('icon attachments retain image recovery and respect hidden filename presentation', async (t) => {
    const document = doc(
        field('files', {
            kind: 'attachments',
            layout: 'icon',
            columns: 1,
            fit: 'contain',
            thumbnailSize: 'small',
            showNames: false,
            emptyLabel: 'No attachments',
            unavailableLabel: 'Image unavailable',
            items: [
                {
                    key: 'image',
                    kind: 'image',
                    label: 'Hidden filename',
                    url: 'https://example.test/original.png',
                    imageSources: [
                        'https://example.test/thumbnail.png',
                        'https://example.test/original.png',
                    ],
                },
                {
                    key: 'audio',
                    kind: 'audio',
                    label: 'Hidden audio filename',
                    url: 'https://example.test/audio.mp3',
                    imageSources: [],
                },
            ],
        })
    );
    const f = await mount(t, h(ReadonlyPrintDocumentView, { document }));
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        'https://example.test/thumbnail.png'
    );
    assert.equal(f.container.querySelector('figcaption'), null);
    assert.equal(f.container.textContent?.includes('Hidden filename'), false);
    await act(async () =>
        f.container
            .querySelector('img')
            ?.dispatchEvent(new f.window.Event('error'))
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        'https://example.test/original.png'
    );
    await act(async () =>
        f.container
            .querySelector('img')
            ?.dispatchEvent(new f.window.Event('error'))
    );
    assert.match(f.container.textContent ?? '', /Image unavailable/);
    assert.equal(f.container.textContent?.includes('Hidden filename'), false);
});
