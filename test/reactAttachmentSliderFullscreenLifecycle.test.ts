import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, useState } from 'react';
import type { AttachmentSliderProps } from '../src/react/attachment-slider.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const labels = {
    attachments: 'Pièces jointes',
    previewNotAvailable: 'Aperçu inaccessible',
    previous: 'Précédent',
    next: 'Suivant',
    delete: 'Supprimer',
    download: 'Télécharger',
    open: 'Ouvrir',
    close: 'Fermer',
};
const rows: AttachmentSliderProps['rows'] = [
    {
        id: 'photo',
        filename: 'Photo.png',
        url: '/photo.png',
        type: 'image/png',
    },
    {
        id: 'audio',
        filename: 'Audio.mp3',
        url: '/audio.mp3',
        type: 'audio/mpeg',
    },
];

test('the public fullscreen viewer hands off the modal layer and restores the real opener and scroll', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const { window, container } = fixture;
    const { document } = window;

    // Supply browser primitives for the real portal and focus trap. The
    // shared fixture owns the DOM, React root, observers and denied I/O.
    const globals = {
        Window: window.constructor,
        Document: window.Document,
        EventTarget: window.EventTarget,
        Event: window.Event,
        MouseEvent: window.MouseEvent,
        FocusEvent: window.FocusEvent,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLIFrameElement: window.HTMLIFrameElement,
        SVGElement: window.SVGElement,
        ShadowRoot: window.ShadowRoot,
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    };
    const originals = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    t.after(() => {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });

    const { AttachmentSlider } = await import(
        '../src/react/attachment-slider.js'
    );
    const { AttachmentSlider: LazySlider } = await import(
        '../src/react/AttachmentSlider.js'
    );
    const { ThemeBoundary } = await import('../src/react/ThemeBoundary.js');
    const rootStyle = document.documentElement.style;
    const scrollReturns: number[][] = [];
    Object.defineProperties(window, {
        innerWidth: { configurable: true, value: 1000 },
        scrollY: { configurable: true, value: 24 },
        scrollTo: {
            configurable: true,
            value: (x: number, y: number) => scrollReturns.push([x, y]),
        },
    });
    Object.defineProperties(window.navigator, {
        platform: { configurable: true, value: 'MacIntel' },
        maxTouchPoints: { configurable: true, value: 2 },
    });
    Object.defineProperties(document.documentElement, {
        clientWidth: { configurable: true, value: 980 },
        offsetWidth: { configurable: true, value: 985 },
    });
    rootStyle.setProperty('overflow', 'auto', 'important');
    rootStyle.setProperty('padding-right', '3px');
    rootStyle.setProperty('position', 'relative');
    rootStyle.setProperty('margin-top', '2px');

    let dismisses = 0;
    let removes = 0;
    function Host({ covered, lazy }: { covered?: boolean; lazy?: boolean }) {
        const [open, setOpen] = useState(false);
        const [currentIndex, setCurrentIndex] = useState(0);
        const Viewer = lazy ? LazySlider : AttachmentSlider;
        return h(
            ThemeBoundary,
            { theme: lazy ? undefined : 'purple' },
            h(
                'button',
                { type: 'button', onClick: () => setOpen(true) },
                'Show attachments'
            ),
            h(Viewer, {
                rows: open ? rows : [],
                currentIndex,
                setCurrentIndex,
                navigationOwner: 'files',
                downloadIdentity: currentIndex,
                labels,
                covered,
                intercomOpen: !lazy,
                canOpen: true,
                canDownload: false,
                readDownload: async () => {
                    throw new Error('This viewer grants no download');
                },
                onDelete: lazy ? undefined : () => removes++,
                onDismiss: () => {
                    dismisses++;
                    setOpen(false);
                },
            })
        );
    }
    const render = (props: Parameters<typeof Host>[0] = {}) =>
        fixture.render(h(Host, props), false);
    const dialog = () => {
        const node = document.querySelector('[role="dialog"]');
        assert.ok(node);
        return node;
    };
    const button = (label: string) => {
        const node = [...dialog().querySelectorAll('button')].find(
            (entry) =>
                entry.getAttribute('aria-label') === label ||
                entry.textContent === label
        );
        assert.ok(node, `Expected ${label} in the viewer`);
        return node;
    };
    const key = async (
        name: string,
        { repeat = false, prevented = false } = {}
    ) => {
        const event = new window.KeyboardEvent('keydown', {
            key: name,
            repeat,
            bubbles: true,
            cancelable: true,
        });
        if (prevented) event.preventDefault();
        await act(async () => {
            dialog().dispatchEvent(event);
        });
        return event.defaultPrevented;
    };
    const assertReleased = () => {
        assert.equal(rootStyle.getPropertyValue('overflow'), 'auto');
        assert.equal(rootStyle.getPropertyPriority('overflow'), 'important');
        assert.equal(rootStyle.getPropertyValue('padding-right'), '3px');
        assert.equal(rootStyle.getPropertyValue('position'), 'relative');
        assert.equal(rootStyle.getPropertyValue('margin-top'), '2px');
        assert.equal(rootStyle.getPropertyValue('width'), '');
    };

    try {
        await render();
        const opener = container.querySelector('button');
        assert.ok(opener);
        assert.equal(document.querySelector('[role="dialog"]'), null);
        opener.focus();
        await fixture.click(opener);

        const viewer = dialog();
        const rail = viewer.querySelector('.mx-sdk-attachment-thumbnail-rail');
        assert.ok(rail);
        assert.equal(document.activeElement, rail);
        assert.equal(viewer.getAttribute('aria-modal'), 'true');
        assert.ok(
            viewer.classList.contains('mx-sdk-attachment-slider--intercom')
        );
        const viewport = viewer.querySelector(
            '.mx-sdk-attachment-slider__viewport'
        );
        assert.ok(viewport);
        assert.equal(viewport.getAttribute('data-mx-theme'), 'purple');
        assert.equal(rootStyle.getPropertyValue('overflow'), 'hidden');
        assert.equal(rootStyle.getPropertyValue('padding-right'), '25px');
        assert.equal(rootStyle.getPropertyValue('position'), 'fixed');
        assert.equal(rootStyle.getPropertyValue('margin-top'), '-24px');
        assert.equal(rootStyle.getPropertyValue('width'), '100%');

        const panel = viewer.querySelector('[data-testid="dialog-test-id"]');
        const backdrop = viewer.querySelector(
            '[data-testid="dialog-overlay-test-id"]'
        );
        assert.ok(panel && backdrop);
        await act(async () => {
            panel.dispatchEvent(
                new window.MouseEvent('click', { bubbles: true })
            );
        });
        assert.equal(dismisses, 0);
        await fixture.click(button(labels.next));
        assert.equal(
            viewer.querySelector('audio')?.getAttribute('src'),
            '/audio.mp3'
        );
        assert.equal(
            viewer.querySelector('[aria-live]')?.textContent,
            'Audio.mp3'
        );
        assert.equal(
            viewer.querySelector('a[target="_blank"]')?.getAttribute('href'),
            '/audio.mp3'
        );
        assert.equal(await key('Enter'), false);
        assert.equal(await key('Escape', { prevented: true }), true);

        await fixture.click(button(labels.delete));
        assert.equal(removes, 1);
        const tooltip = document.querySelector('[role="tooltip"]');
        assert.equal(tooltip?.textContent, labels.delete);
        assert.equal(await key('Escape'), true);
        assert.equal(document.querySelector('[role="tooltip"]'), null);
        assert.equal(dismisses, 0);

        await render({ covered: true });
        assert.equal(dialog(), viewer);
        assert.equal(viewer.getAttribute('aria-modal'), null);
        assertReleased();
        assert.deepEqual(scrollReturns, [[0, 24]]);
        await fixture.click(button(labels.delete));
        await fixture.click(button(labels.close));
        await act(async () => {
            backdrop.dispatchEvent(
                new window.MouseEvent('click', { bubbles: true })
            );
        });
        assert.equal(await key('Escape'), false);
        assert.equal(removes, 1);
        assert.equal(dismisses, 0);

        await render();
        assert.equal(viewer.getAttribute('aria-modal'), 'true');
        assert.equal(rootStyle.getPropertyValue('overflow'), 'hidden');
        assert.equal(
            viewer.querySelector('[aria-live]')?.textContent,
            'Audio.mp3'
        );
        assert.equal(await key('Escape', { repeat: true }), true);
        assert.equal(dismisses, 0);
        assert.equal(await key('Escape'), true);
        assert.equal(dismisses, 1);
        assert.equal(viewer.isConnected, false);
        assert.equal(document.activeElement, opener);
        assertReleased();
        assert.deepEqual(scrollReturns, [
            [0, 24],
            [0, 24],
        ]);

        Object.defineProperty(window.navigator, 'platform', { value: 'Linux' });
        await render({ lazy: true });
        await fixture.click(opener);
        await act(async () => {});
        const lazyViewer = dialog();
        assert.equal(lazyViewer.querySelector('[data-mx-theme]'), null);
        assert.equal(rootStyle.getPropertyValue('position'), 'relative');
        await fixture.click(button(labels.close));
        assert.equal(dismisses, 2);
        assert.equal(lazyViewer.isConnected, false);
        assert.equal(document.activeElement, opener);
        assertReleased();
        assert.deepEqual(scrollReturns, [
            [0, 24],
            [0, 24],
        ]);
        fixture.unchangedEffects();
    } finally {
        await fixture.render(null, false);
    }
});
