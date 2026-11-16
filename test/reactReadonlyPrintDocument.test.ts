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

test('admitted physical and rich facts preserve readonly formatting, literal labels and resource policy', async (t) => {
    const document = doc(
        field('notice', {
            kind: 'notice',
            state: 'unavailable',
            label: 'Unavailable display fact',
        }),
        field('phone', {
            kind: 'phone',
            value: '+1 (555) 010-0200',
            emptyLabel: 'No phone',
        }),
        field('progress', {
            kind: 'numeric',
            text: '37,5 %',
            emptyLabel: 'No number',
            progress: { fraction: 0.375, color: '#123456' },
        }),
        field('zero', {
            kind: 'numeric',
            text: '0.00%',
            emptyLabel: 'No number',
            progress: { fraction: 0, color: '#123456' },
        }),
        field('html', {
            kind: 'html',
            value: '<p><strong>Retained HTML</strong><script>unsafe()</script></p>',
            height: 120,
            emptyLabel: 'No HTML',
        }),
        field('people', {
            kind: 'people',
            items: [
                {
                    label: 'Ava <literal>',
                    avatarUrl: 'https://example.test/avatar.png',
                },
                { label: 'Ava <literal>' },
            ],
            emptyLabel: 'No people',
        }),
        field('checkbox', {
            kind: 'checkbox',
            value: false,
            checkedLabel: 'Checked',
            uncheckedLabel: 'Unchecked',
        }),
        field('barcode', {
            kind: 'barcode',
            text: 'CODE<literal>',
            barcodeType: 'CODE128',
            emptyLabel: 'No code',
        }),
        field('linked-resource', {
            kind: 'resource',
            href: '#admitted-resource',
            label: 'Admitted resource',
        }),
        field('static-resource', {
            kind: 'resource',
            href: null,
            label: 'Resource without navigation',
        })
    );
    const original = JSON.stringify(document);
    const f = await mount(t, h(ReadonlyPrintDocumentView, { document }));
    assert.equal(
        f.container.querySelector('[data-print-state=unavailable]')
            ?.textContent,
        'Unavailable display fact'
    );
    assert.equal(
        f.container.querySelector('a[href^="tel:"]')?.getAttribute('href'),
        'tel:+1 (555) 010-0200'
    );
    const progress = Array.from(
        f.container.querySelectorAll('[role=progressbar]')
    );
    assert.deepEqual(
        progress.map((element) => element.getAttribute('aria-valuenow')),
        ['37.5', '0']
    );
    assert.equal(
        progress[0]?.firstElementChild
            ?.getAttribute('style')
            ?.includes('width: 37.5%'),
        true
    );
    assert.match(f.container.textContent ?? '', /37,5 %.*0\.00%/s);
    assert.equal(
        f.container.querySelector('.mx-sdk-print-html')?.getAttribute('style'),
        'height: 120px;'
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-print-html strong')?.textContent,
        'Retained HTML'
    );
    assert.equal(f.container.querySelector('script'), null);
    assert.equal(f.container.textContent?.includes('unsafe()'), false);
    assert.deepEqual(
        Array.from(f.container.querySelectorAll('.mx-sdk-print-person')).map(
            (element) => element.textContent
        ),
        ['Ava <literal>', 'Ava <literal>']
    );
    assert.equal(
        f.container
            .querySelector('.mx-sdk-print-person img[loading=eager]')
            ?.getAttribute('src'),
        'https://example.test/avatar.png'
    );
    const checkbox = f.container.querySelector('input[type=checkbox]');
    assert.equal(checkbox?.hasAttribute('disabled'), true);
    assert.equal(checkbox?.getAttribute('aria-checked'), 'false');
    assert.equal(checkbox?.hasAttribute('checked'), false);
    assert.match(f.container.textContent ?? '', /CODE<literal>/);
    assert.equal(
        f.container.querySelector('a[href="#admitted-resource"]')?.textContent,
        'Admitted resource'
    );
    assert.equal(
        f.container.querySelector('span.mx-sdk-print-resource')?.textContent,
        'Resource without navigation'
    );
    assert.equal(
        f.container.querySelector('button,[contenteditable=true]'),
        null
    );
    assert.equal(JSON.stringify(document), original);
});

test('empty admitted facets retain host labels without fabricated values or interactive resources', async (t) => {
    const document = doc(
        field('phone', {
            kind: 'phone',
            value: null,
            emptyLabel: 'Empty phone',
        }),
        field('numeric', {
            kind: 'numeric',
            text: null,
            emptyLabel: 'Empty number',
            progress: { fraction: 0.5, color: '#123456' },
        }),
        field('html', { kind: 'html', value: null, emptyLabel: 'Empty HTML' }),
        field('quill', { kind: 'quill', value: '', emptyLabel: 'Empty Quill' }),
        field('pills', {
            kind: 'pills',
            items: [],
            emptyLabel: 'Empty choices',
        }),
        field('people', {
            kind: 'people',
            items: [],
            emptyLabel: 'Empty people',
        }),
        field('attachments', {
            kind: 'attachments',
            items: [],
            layout: 'grid',
            columns: 2,
            fit: 'contain',
            thumbnailSize: 'small',
            showNames: true,
            emptyLabel: 'Empty files',
        }),
        field('linked', {
            kind: 'linkedRecords',
            records: [],
            layout: 'list',
            thumbnailLocation: 'left',
            columns: 1,
            emptyLabel: 'Empty records',
        }),
        field('sequence', {
            kind: 'sequence',
            items: [],
            layout: 'wrap',
            emptyLabel: 'Empty sequence',
        })
    );
    const f = await mount(t, h(ReadonlyPrintDocumentView, { document }));
    for (const label of [
        'Empty phone',
        'Empty number',
        'Empty HTML',
        'Empty Quill',
        'Empty choices',
        'Empty people',
        'Empty files',
        'Empty records',
        'Empty sequence',
    ])
        assert.equal(f.container.textContent?.includes(label), true, label);
    assert.equal(
        f.container.querySelector(
            'a,img,button,input,[role=progressbar],[contenteditable=true]'
        ),
        null
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
