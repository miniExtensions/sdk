import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, createRef } from 'react';
import {
    AttachmentSliderBody,
    type AttachmentSliderBodyProps,
} from '../src/react/AttachmentSliderBody.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const labels = {
    attachments: 'Pièces jointes',
    previewNotAvailable: 'Aperçu inaccessible',
    previous: 'Précédent',
    next: 'Suivant',
};

const rows: AttachmentSliderBodyProps['rows'] = [
    {
        id: 'repeat',
        filename: 'Photo.png',
        url: '/photo.png',
        thumbnailUrl: '/thumb.png',
        type: 'image/png',
    },
    {
        id: 'repeat',
        filename: 'Audio.mp3',
        url: '/audio.mp3',
        type: 'audio/mpeg',
    },
    { filename: 'Archive.bin', url: '/archive.bin' },
];

test('the controlled slider body preserves focus, keyboard admission and native fallback layouts', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const { window, container } = fixture;
    const railRef = createRef<HTMLDivElement>();
    const intents: number[] = [];
    const mount = async (opts: Partial<AttachmentSliderBodyProps> = {}) => {
        const currentIndex = opts.currentIndex ?? 0;
        await fixture.render(
            h(
                'div',
                { role: 'dialog' },
                h(AttachmentSliderBody, {
                    rows,
                    currentIndex,
                    thumbnailRailRef: railRef,
                    labels,
                    setCurrentIndex: (next) =>
                        intents.push(
                            typeof next === 'function'
                                ? next(currentIndex)
                                : next
                        ),
                    ...opts,
                })
            ),
            false
        );
    };
    const rail = () => {
        const element = container.querySelector(
            '.mx-sdk-attachment-thumbnail-rail'
        );
        assert.ok(element);
        return element;
    };
    const group = () =>
        container.querySelector('[role="group"][aria-label="Pièces jointes"]');
    const textButton = (label: string) => {
        const button = [...container.querySelectorAll('button')].find(
            (node) => node.textContent === label
        );
        assert.ok(button, `Expected button ${label}`);
        return button;
    };
    const press = async (
        target: ReturnType<typeof rail> | typeof window,
        key: string,
        options: {
            repeat?: boolean;
            altKey?: boolean;
            prevented?: boolean;
        } = {}
    ) => {
        const { prevented, ...modifiers } = options;
        const event = new window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...modifiers,
        });
        if (prevented) event.preventDefault();
        await act(async () => {
            target.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };

    await mount({ navigationOwner: 'first' });
    const firstRail = rail();
    const firstNext = group()?.querySelector('button[aria-label="Suivant"]');
    assert.ok(firstNext);
    assert.equal(
        group()?.querySelector('[aria-live]')?.textContent,
        'Photo.png'
    );
    assert.equal(
        group()?.querySelector('img')?.getAttribute('src'),
        '/photo.png'
    );
    assert.equal(await press(firstRail, 'ArrowRight', { altKey: true }), false);
    assert.equal(await press(window, 'ArrowRight'), false);
    assert.equal(await press(firstRail, 'Escape'), false);
    assert.deepEqual(intents, []);
    assert.equal(await press(firstRail, 'ArrowRight'), true);
    assert.deepEqual(intents, [1]);

    await mount({ navigationOwner: 'successor', currentIndex: 1 });
    assert.equal(rail(), firstRail);
    assert.equal(firstNext.isConnected, false);
    assert.equal(
        group()?.querySelector('audio')?.getAttribute('src'),
        '/audio.mp3'
    );
    assert.equal(await press(firstRail, 'ArrowRight', { repeat: true }), true);
    assert.deepEqual(intents, [1]);
    await act(async () => {
        firstRail.dispatchEvent(
            new window.KeyboardEvent('keyup', {
                key: 'ArrowRight',
                bubbles: true,
            })
        );
    });
    assert.equal(await press(firstRail, 'ArrowRight'), true);
    assert.deepEqual(intents, [1, 2]);

    const next = [...(group()?.querySelectorAll('button') ?? [])].find(
        (button) => button.getAttribute('aria-label') === labels.next
    );
    assert.ok(next);
    next.focus();
    assert.equal(window.document.activeElement, next);
    await mount({ rows: rows.slice(0, 1), navigationOwner: 'successor' });
    assert.equal(next.isConnected, false);
    assert.equal(window.document.activeElement, firstRail);
    assert.equal(group(), null);
    assert.equal(container.querySelector('p')?.textContent, 'Photo.png');
    assert.equal(await press(firstRail, 'ArrowLeft'), false);

    await mount({ navigationOwner: 'covered', currentIndex: 2, covered: true });
    assert.ok(container.textContent?.includes(labels.previewNotAvailable));
    await fixture.click(textButton('Photo.png'));
    assert.equal(await press(firstRail, 'ArrowLeft'), false);
    assert.deepEqual(intents, [1, 2]);

    const retired = {
        isCurrent() {
            throw new Error('The host has retired this readonly presentation');
        },
    };
    await mount({ currentIndex: 1, presentationOwner: retired });
    await fixture.click(textButton(labels.next));
    await fixture.click(textButton('Photo.png'));
    await press(firstRail, 'ArrowLeft');
    assert.deepEqual(intents, [1, 2]);

    await mount({ currentIndex: 1 });
    assert.equal(group(), null);
    await fixture.click(textButton(labels.previous));
    await fixture.click(textButton(labels.next));
    await fixture.click(textButton('Audio.mp3'));
    await press(firstRail, 'ArrowLeft');
    await press(firstRail, 'ArrowRight');
    assert.deepEqual(intents, [1, 2, 0, 2, 1, 0, 2]);

    await mount({ rows: [] });
    assert.equal(
        container.querySelector('.mx-sdk-attachment-slider-body'),
        null
    );
    await press(window, 'ArrowLeft');
    assert.deepEqual(intents, [1, 2, 0, 2, 1, 0, 2]);
    fixture.unchangedEffects();
});
