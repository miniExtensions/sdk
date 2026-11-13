import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement as h, type FormEvent } from 'react';
import { renderToString } from 'react-dom/server';
import {
    LinkedFinderAttachmentCollection,
    type LinkedFinderAttachmentCollectionProps,
} from '../src/react/index.js';
import { scannerDom } from './fixtures/scannerDom.js';

const props = (): LinkedFinderAttachmentCollectionProps => ({
    rows: ['A', 'A', 'B'].map((label, index) => ({
        key: `occurrence-${index}`,
        label,
        openLabel: `Open ${index}`,
        imageSources: [`https://example.test/${index}.png`],
        icon: 'document',
    })),
    layout: 'icon',
    columns: 2,
    fit: 'contain',
    showNames: true,
    owner: { isCurrent: () => true },
    labels: {
        attachments: 'Adjuntos',
        retry: 'Reintentar',
        imageUnavailable: 'Imagen no disponible',
    },
});

test('readonly collection SSR retains occurrences and labels without inventing opening authority', () => {
    const html = renderToString(h(LinkedFinderAttachmentCollection, props()));
    assert.equal((html.match(/<li /g) ?? []).length, 3);
    assert.match(html, /aria-label="Adjuntos"/);
    assert.doesNotMatch(html, /<button[^>]+mx-sdk-finder-attachment-open/);
});

test('List grid presentation retains occurrences and suppresses form captions and column configuration', () => {
    const html = renderToString(
        h(LinkedFinderAttachmentCollection, {
            ...props(),
            layout: 'grid',
            showNames: true,
        })
    );
    assert.match(html, /mx-sdk-finder-attachment-grid/);
    assert.equal((html.match(/<li /g) ?? []).length, 3);
    assert.doesNotMatch(
        html,
        /grid-template-columns|mx-sdk-finder-attachment-name/
    );
});

for (const strict of [false, true]) {
    test(`captured collection opening and retry do not select or submit the containing option (${strict ? 'StrictMode' : 'ordinary'})`, async (t) => {
        const f = await scannerDom(t);
        let admitted = true;
        const opened: number[] = [];
        let selected = 0;
        let submitted = 0;
        const view = {
            ...props(),
            owner: { isCurrent: () => admitted },
            onOpen: (index: number) => {
                opened.push(index);
                return { status: 'admitted' as const };
            },
        };
        const render = () =>
            f.render(
                h(
                    'form',
                    {
                        onSubmit: (event: FormEvent) => {
                            event.preventDefault();
                            submitted++;
                        },
                    },
                    h(
                        'div',
                        {
                            role: 'option',
                            onClick: () => selected++,
                            onKeyDown: () => selected++,
                        },
                        h(LinkedFinderAttachmentCollection, view)
                    )
                ),
                strict
            );
        await render();
        const buttons = [
            ...f.host.querySelectorAll('button.mx-sdk-finder-attachment-open'),
        ] as unknown as HTMLButtonElement[];
        assert.equal(buttons.length, 3);
        await act(async () => buttons[1].click());
        assert.deepEqual(opened, [1]);
        assert.equal(selected, 0);
        assert.equal(submitted, 0);
        admitted = false;
        await act(async () => buttons[2].click());
        assert.deepEqual(opened, [1]);
        await render();
        assert.equal(
            f.host.querySelectorAll(
                'button.mx-sdk-finder-attachment-open:disabled'
            ).length,
            3
        );
    });
}

test('collection image failures use supplied ordered sources and retry without opening', async (t) => {
    const f = await scannerDom(t);
    let opens = 0;
    const value = props();
    await f.render(
        h(LinkedFinderAttachmentCollection, {
            ...value,
            rows: [
                {
                    ...value.rows[0],
                    imageSources: [
                        'https://example.test/thumbnail.png',
                        'https://example.test/original.png',
                    ],
                },
            ],
            onOpen: () => {
                opens++;
                return { status: 'admitted' as const };
            },
        })
    );
    let image = f.host.querySelector('img')!;
    assert.match(image.src, /thumbnail.png$/);
    await act(async () => image.dispatchEvent(new f.window.Event('error')));
    image = f.host.querySelector('img')!;
    assert.match(image.src, /original.png$/);
    await act(async () => image.dispatchEvent(new f.window.Event('error')));
    const retry = f.host.querySelector(
        '.mx-sdk-finder-attachment-retry'
    )! as unknown as HTMLButtonElement;
    await act(async () => retry.click());
    assert.match(f.host.querySelector('img')!.src, /thumbnail.png$/);
    assert.equal(opens, 0);
});
