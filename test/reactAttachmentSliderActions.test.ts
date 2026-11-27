import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, Fragment } from 'react';
import {
    AttachmentSliderActions,
    type AttachmentSliderActionsProps,
} from '../src/react/AttachmentSliderActions.js';
import { useAttachmentActionTooltip } from '../src/react/useAttachmentActionTooltip.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const url = '/owned-attachment.svg';
const labels = { delete: 'Retirer', download: 'Télécharger', open: 'Ouvrir' };

test('rendered slider actions honor permissions, current attachment ownership, and explicit download', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const { container, window } = fixture;
    const listeners = new Set<() => void>();
    let current = true;
    const owner = {
        token: 1,
        isCurrent: () => current,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    let deletes = 0;
    const errors: unknown[] = [];
    const saved: Array<{ filename: string; href: string }> = [];
    const requests: Array<{
        url: string;
        resolve(response: Response): void;
        reject(error: Error): void;
    }> = [];
    const readDownload = (requested: string) =>
        new Promise<Response>((resolve, reject) => {
            requests.push({ url: requested, resolve, reject });
        });
    const makeObjectURL = t.mock.method(
        URL,
        'createObjectURL',
        () => 'blob:owned'
    );
    const revokeObjectURL = t.mock.method(URL, 'revokeObjectURL', () => {});
    t.mock.method(
        HTMLAnchorElement.prototype,
        'click',
        function (this: HTMLAnchorElement) {
            saved.push({ filename: this.download, href: this.href });
        }
    );
    const render = (options: Partial<AttachmentSliderActionsProps> = {}) =>
        fixture.render(
            h(AttachmentSliderActions, {
                attachment: { url, filename: 'Owned.svg' },
                downloadIdentity: 'native-occurrence',
                labels,
                canDownload: true,
                canOpen: true,
                onDelete: () => {
                    deletes++;
                },
                readDownload,
                onDownloadError: (error: unknown) => errors.push(error),
                ...options,
            })
        );

    const button = (name: string) => {
        const control = [...container.querySelectorAll('button')].find(
            (element) => element.textContent === name
        );
        assert.ok(control, name);
        assert.equal(control.type, 'button');
        return control;
    };
    const open = () => {
        const link = container.querySelector('a');
        assert.ok(link);
        assert.equal(link.textContent, labels.open);
        return link;
    };
    const staleOpen = async (type: string, button: number) => {
        const link = open();
        const event = new window.MouseEvent(type, {
            button,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            link.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, true);
        assert.equal(link.getAttribute('href'), null);
    };
    const complete = async (index: number) => {
        await act(async () =>
            requests[index].resolve(
                new Response('file', {
                    headers: { 'Content-Length': '4' },
                })
            )
        );
    };

    await render({ canDownload: false, canOpen: false, onDelete: undefined });
    assert.equal(container.querySelector('button,a'), null);
    await render();
    assert.equal(open().getAttribute('href'), url);
    assert.equal(open().target, '_blank');
    assert.equal(
        container.querySelectorAll('svg[aria-hidden="true"]').length,
        3
    );
    await fixture.click(button(labels.delete));
    assert.equal(deletes, 1);

    await render({ presentationOwner: owner });
    assert.equal(open().getAttribute('href'), url);
    await fixture.click(button(labels.delete));
    assert.equal(deletes, 2);
    await fixture.click(button(labels.download));
    assert.deepEqual(
        requests.map((request) => request.url),
        [url]
    );
    assert.equal(button('0%').disabled, true);
    await fixture.click(button('0%'));
    assert.equal(requests.length, 1);

    // Retire authorization without reparsing or replacing the link prop.
    current = false;
    await staleOpen('contextmenu', 2);
    await staleOpen('auxclick', 1);
    await staleOpen('click', 0);
    await fixture.click(button(labels.delete));
    assert.equal(deletes, 2);
    await act(async () => {
        for (const listener of listeners) listener();
    });
    await complete(0);
    assert.deepEqual(saved, []);
    assert.deepEqual(errors, []);
    assert.equal(makeObjectURL.mock.callCount(), 0);

    // A new generation can save even when its approved URL is identical.
    current = true;
    owner.token++;
    await render({ presentationOwner: owner });
    assert.equal(open().getAttribute('href'), url);
    await fixture.click(button(labels.download));
    await complete(1);
    assert.deepEqual(saved, [{ filename: 'Owned.svg', href: 'blob:owned' }]);
    assert.equal(makeObjectURL.mock.callCount(), 1);
    assert.deepEqual(
        revokeObjectURL.mock.calls.map(({ arguments: args }) => args),
        [['blob:owned']]
    );
    assert.equal(window.document.querySelector('a[download]'), null);
    assert.equal(button(labels.download).disabled, false);

    const failure = new Error('Owned download failed');
    await fixture.click(button(labels.download));
    await act(async () => requests[2].reject(failure));
    assert.deepEqual(errors, [failure]);
    assert.deepEqual(
        requests.map((request) => request.url),
        [url, url, url]
    );

    await fixture.render(null);
    assert.equal(listeners.size, 0);
    fixture.unchangedEffects();
});

test('a held slider Download belongs to its original occurrence and permits metadata refresh', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const { container, window } = fixture;
    const reads: string[] = [];
    const saved: string[] = [];
    t.mock.method(
        HTMLAnchorElement.prototype,
        'click',
        function (this: HTMLAnchorElement) {
            saved.push(this.download);
        }
    );
    const render = (identity: string, filename: string) =>
        fixture.render(
            h(AttachmentSliderActions, {
                attachment: { url, filename },
                downloadIdentity: identity,
                labels,
                canDownload: true,
                canOpen: false,
                async readDownload(requested) {
                    reads.push(requested);
                    return new Response('owned bytes');
                },
            })
        );
    await render('front', 'front.svg');
    const button = container.querySelector('button');
    assert(button);
    const pointer = (type: string) =>
        new window.PointerEvent(type, {
            bubbles: true,
            isPrimary: true,
            button: 0,
            pointerId: 1,
            pointerType: 'mouse',
        });
    const down = () =>
        act(async () => {
            button.dispatchEvent(pointer('pointerdown'));
        });
    const release = () =>
        act(async () => {
            button.dispatchEvent(pointer('pointerup'));
            button.dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 1,
                })
            );
        });

    await down();
    await render('rear', 'rear.svg');
    assert.equal(container.querySelector('button'), button);
    await release();
    assert.deepEqual(reads, []);
    assert.deepEqual(saved, []);

    await down();
    await render('rear', 'renamed.svg');
    await release();
    assert.deepEqual(reads, [url]);
    assert.deepEqual(saved, ['renamed.svg']);

    await down();
    await act(async () => {
        button.dispatchEvent(pointer('pointercancel'));
    });
    await release();
    assert.deepEqual(reads, [url]);
    await fixture.click(button);
    assert.deepEqual(reads, [url, url]);
    assert.deepEqual(saved, ['renamed.svg', 'renamed.svg']);
});

function TooltipTrigger({ suspended }: { suspended: boolean }) {
    const { show, triggerRef, triggerProps, tooltip } =
        useAttachmentActionTooltip('Attachment action', suspended);
    return h(
        Fragment,
        null,
        h(
            'button',
            {
                ...triggerProps,
                id: 'attachment-tooltip-trigger',
                ref: triggerRef,
                type: 'button',
                onClick: show,
            },
            'Trigger'
        ),
        tooltip
    );
}

test('the rendered tooltip owns pointer, keyboard, layout, cover and listener lifetimes', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const { container, window } = fixture;
    await import('react-dom');
    const added = t.mock.method(window.document, 'addEventListener');
    const removed = t.mock.method(window.document, 'removeEventListener');
    const windowAdded = t.mock.method(window, 'addEventListener');
    const windowRemoved = t.mock.method(window, 'removeEventListener');
    const prototype = window.HTMLElement.prototype;
    const nativeRect = prototype.getBoundingClientRect;
    let anchor = new window.DOMRect(-8, 60, 24, 12);
    t.mock.method(
        prototype,
        'getBoundingClientRect',
        function (this: typeof prototype) {
            if (this.id === 'attachment-tooltip-trigger') return anchor;
            if (this.getAttribute('role') === 'tooltip')
                return new window.DOMRect(0, 0, 40, 10);
            return nativeRect.call(this);
        }
    );
    Object.defineProperties(window, {
        innerWidth: { value: 100, configurable: true },
        innerHeight: { value: 80, configurable: true },
    });

    const render = (suspended = false) =>
        fixture.render(
            h(
                Fragment,
                null,
                h(
                    'div',
                    { id: 'attachment-tooltip-scroll' },
                    h(TooltipTrigger, { suspended })
                ),
                h(
                    'button',
                    { id: 'attachment-tooltip-outside', type: 'button' },
                    'Outside'
                )
            )
        );
    await render();
    const trigger = container.querySelector('#attachment-tooltip-trigger');
    const outside = container.querySelector('#attachment-tooltip-outside');
    const scroller = container.querySelector('#attachment-tooltip-scroll');
    assert.ok(trigger instanceof window.HTMLButtonElement);
    assert.ok(outside instanceof window.HTMLButtonElement);
    assert.ok(scroller);
    const popup = () => {
        const note = window.document.querySelector('[role="tooltip"]');
        return note instanceof window.HTMLDivElement ? note : null;
    };
    const opened = () => {
        const note = popup();
        assert.ok(note);
        assert.equal(note.parentElement, window.document.body);
        assert.equal(note.textContent, 'Attachment action');
        assert.equal(trigger.getAttribute('aria-describedby'), note.id);
        return note;
    };
    const pointer = async (
        target: typeof window.HTMLElement.prototype,
        type: string,
        pointerType = 'mouse',
        relatedTarget?: typeof window.HTMLElement.prototype
    ) => {
        await act(async () => {
            target.dispatchEvent(
                new window.PointerEvent(type, {
                    bubbles: true,
                    pointerType,
                    relatedTarget,
                })
            );
        });
    };
    const focus = async (
        element: typeof window.HTMLButtonElement.prototype
    ) => {
        await act(async () => element.focus());
    };
    const key = async (key: string, alreadyHandled = false) => {
        const event = new window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        if (alreadyHandled) event.preventDefault();
        await act(async () => {
            trigger.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };

    await pointer(trigger, 'pointermove', 'touch');
    assert.equal(popup(), null);
    await pointer(trigger, 'pointermove');
    let note = opened();
    assert.equal(note.getAttribute('data-side'), 'top');
    assert.equal(note.style.left, '0px');
    assert.equal(note.style.top, '42px');
    await pointer(trigger, 'pointermove');
    assert.equal(opened(), note);
    await pointer(note, 'pointerdown');
    assert.equal(opened(), note);
    await pointer(trigger, 'pointerout', 'mouse', note);
    assert.equal(opened(), note);
    await pointer(note, 'pointerout', 'mouse', trigger);
    assert.equal(opened(), note);

    anchor = new window.DOMRect(90, 10, 20, 10);
    await fixture.resize();
    assert.equal(note.getAttribute('data-side'), 'bottom');
    assert.equal(note.style.left, '60px');
    assert.equal(note.style.top, '28px');
    await act(async () => {
        outside.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    });
    assert.equal(opened(), note);
    assert.equal(await key('Home'), false);
    assert.equal(await key('Escape', true), true);
    assert.equal(opened(), note);
    assert.equal(await key('Escape'), true);
    assert.equal(popup(), null);
    assert.equal(await key('Escape'), false);

    await fixture.click(trigger);
    note = opened();
    await pointer(note, 'pointerout', 'mouse', outside);
    assert.equal(popup(), null);
    await fixture.click(trigger);
    opened();
    await pointer(outside, 'pointerdown');
    assert.equal(popup(), null);
    await fixture.click(trigger);
    opened();
    await act(async () => {
        scroller.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    });
    assert.equal(popup(), null);
    await fixture.click(trigger);
    opened();
    await act(async () => {
        window.document.dispatchEvent(new window.CustomEvent('tooltip.open'));
    });
    assert.equal(popup(), null);

    await focus(outside);
    await pointer(trigger, 'pointerdown');
    await focus(trigger);
    assert.equal(popup(), null);
    await act(async () => {
        window.dispatchEvent(new window.PointerEvent('pointercancel'));
    });
    await focus(outside);
    await focus(trigger);
    opened();
    await render(true);
    assert.equal(popup(), null);
    await fixture.click(trigger);
    await pointer(trigger, 'pointermove');
    assert.equal(popup(), null);
    await focus(outside);
    await render();
    await focus(trigger);
    assert.equal(popup(), null);
    await focus(outside);
    await focus(trigger);
    opened();

    await pointer(trigger, 'pointerdown');
    assert.equal(popup(), null);
    await fixture.render(null);
    for (const name of ['tooltip.open', 'keydown', 'pointerdown']) {
        const registered = added.mock.calls.filter(
            ({ arguments: args }) => args[0] === name
        );
        assert.ok(registered.length > 0, name);
        assert.ok(
            registered.every(({ arguments: args }) =>
                removed.mock.calls.some(
                    ({ arguments: cleanup }) =>
                        cleanup[0] === name && cleanup[1] === args[1]
                )
            ),
            name
        );
    }
    for (const name of [
        'resize',
        'scroll',
        'pointerup',
        'pointercancel',
        'blur',
    ]) {
        const registered = windowAdded.mock.calls.filter(
            ({ arguments: args }) => args[0] === name
        );
        assert.ok(registered.length > 0, name);
        assert.ok(
            registered.every(({ arguments: args }) =>
                windowRemoved.mock.calls.some(
                    ({ arguments: cleanup }) =>
                        cleanup[0] === name && cleanup[1] === args[1]
                )
            ),
            name
        );
    }
    assert.equal(popup(), null);
    fixture.unchangedEffects();
});
