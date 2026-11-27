import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalVisitorViewButtons,
    type PortalVisitorViewButtonsProps,
} from '../src/react/PortalVisitorViewButtons.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const views = [
    { id: 'grid', label: 'Grid' },
    { id: 'list', label: null, showBadge: true },
    { id: 'gallery', label: 'Gallery' },
] satisfies PortalVisitorViewButtonsProps['views'];

const defaultProps: PortalVisitorViewButtonsProps = {
    views,
    unnamedViewLabel: 'Vue sans nom',
    selectedViewId: 'grid',
    ownerToken: 'test-owner',
    groupLabel: 'Vues',
    onSelect: () => assert.fail('unexpected view selection'),
};

it('renders the host order, selection, localized fallback and decorative badge on the server', () => {
    const html = renderToString(h(PortalVisitorViewButtons, defaultProps));
    assert.match(html, /role="group"/);
    assert.match(html, /type="button"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /Grid.*Vue sans nom.*Gallery/);
    assert.match(html, /aria-hidden="true"/);
    assert.equal(
        renderToString(
            h(PortalVisitorViewButtons, { ...defaultProps, views: [] })
        ),
        ''
    );
    assert.equal(
        renderToString(
            h(PortalVisitorViewButtons, {
                ...defaultProps,
                views: views.slice(0, 1),
            })
        ),
        ''
    );
});

it('waits for the host to publish selection and sends one intent from its own root', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const commands: string[] = [];
    const props = {
        ...defaultProps,
        onSelect: (id: string) => {
            commands.push(id);
        },
    };
    const tree = (
        selectedViewId: string,
        available: PortalVisitorViewButtonsProps['views'] = views
    ) =>
        h(
            'div',
            null,
            h(PortalVisitorViewButtons, {
                ...props,
                views: available,
                selectedViewId,
            }),
            h(PortalVisitorViewButtons, {
                ...defaultProps,
                groupLabel: 'Other root',
            })
        );
    for (const [label, expected] of [
        ['', 'Vue sans nom'],
        ['   ', 'Vue sans nom'],
        [null, 'Vue sans nom'],
        ['  Vue rédigée  ', '  Vue rédigée  '],
    ] as const) {
        await fixture.render(tree('grid', [views[0], { ...views[1], label }]));
        assert.equal(
            fixture.container.querySelectorAll('button')[1].textContent,
            expected,
            `view label ${JSON.stringify(label)}`
        );
    }
    await fixture.render(tree('grid'));
    let [grid, list, gallery, otherGrid] =
        fixture.container.querySelectorAll('button');
    assert.equal(grid.getAttribute('aria-pressed'), 'true');
    assert.equal(list.textContent, 'Vue sans nom');
    await act(async () => {
        grid.click();
    });
    assert.deepEqual(commands, []);
    await act(async () => {
        list.click();
    });
    assert.deepEqual(commands, ['list']);
    assert.equal(list.getAttribute('aria-pressed'), 'false');
    await fixture.render(tree('list'));
    assert.equal(list.getAttribute('aria-pressed'), 'true');
    assert.equal(otherGrid.getAttribute('aria-pressed'), 'true');
    await fixture.render(tree('grid', views.slice(0, 2)));
    await act(async () => {
        gallery.click();
    });
    assert.deepEqual(commands, ['list']);
    [grid, list] = fixture.container.querySelectorAll('button');
    await act(async () => {
        list.click();
    });
    assert.deepEqual(commands, ['list', 'list']);
    assert.equal(grid.getAttribute('aria-pressed'), 'true');
});

it('retires pointer and Space presses across an owner change without replacing the focused button', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const commands: string[] = [];
    const render = (ownerToken: string, callback: string) =>
        fixture.render(
            h(PortalVisitorViewButtons, {
                ...defaultProps,
                ownerToken,
                onSelect: (id) => commands.push(callback + ':' + id),
            })
        );
    await render('owner-a', 'a');
    const button = fixture.container.querySelectorAll('button')[1];
    assert.ok(button);
    await act(async () => button.focus());
    const pointerDown = () =>
        button.dispatchEvent(
            new fixture.window.PointerEvent('pointerdown', {
                bubbles: true,
                button: 0,
                isPrimary: true,
                pointerId: 1,
            })
        );
    const click = (detail: number) =>
        button.dispatchEvent(
            new fixture.window.MouseEvent('click', {
                bubbles: true,
                button: 0,
                detail,
            })
        );

    await act(async () => {
        pointerDown();
    });
    await render('owner-b', 'b');
    await act(async () => {
        click(1);
    });
    assert.deepEqual(commands, []);
    assert.ok(fixture.window.document.activeElement === button);

    await act(async () => {
        button.dispatchEvent(
            new fixture.window.KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
            })
        );
    });
    await render('owner-a', 'a-again');
    await render('owner-b', 'b-again');
    await act(async () => {
        click(0);
    });
    assert.deepEqual(commands, []);
    assert.ok(fixture.window.document.activeElement === button);

    await act(async () => {
        pointerDown();
    });
    await render('owner-b', 'same-owner-new-callback');
    await act(async () => {
        click(1);
    });
    assert.deepEqual(commands, ['same-owner-new-callback:list']);
});

it('hydrates in StrictMode without a selection and preserves the focused DOM button', async () => {
    const commands: string[] = [];
    const chooser = (selectedViewId: string) =>
        h(
            StrictMode,
            null,
            h(PortalVisitorViewButtons, {
                ...defaultProps,
                selectedViewId,
                onSelect: (id) => {
                    commands.push(id);
                },
            })
        );
    const tree = chooser('grid');
    const html = renderToString(tree);
    const window = new Window();
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = Object.keys(values).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    let root: import('react-dom/client').Root | undefined;
    try {
        for (const [key, value] of Object.entries(values))
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value,
            });
        const container = window.document.createElement('div');
        window.document.body.append(container);
        container.innerHTML = html;
        const secondButton = container.querySelectorAll('button')[1];
        assert.ok(secondButton);
        secondButton.focus();
        const errors: unknown[] = [];
        const { hydrateRoot } = await import('react-dom/client');
        await act(async () => {
            root = hydrateRoot(container as unknown as HTMLElement, tree, {
                onRecoverableError: (error) => errors.push(error),
            });
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(commands, []);
        assert.equal(window.document.activeElement, secondButton);
        await act(async () => {
            secondButton.click();
        });
        assert.deepEqual(commands, ['list']);
        await act(async () => {
            root?.render(chooser('list'));
        });
        assert.equal(container.querySelectorAll('button')[1], secondButton);
        assert.equal(window.document.activeElement, secondButton);
        assert.equal(secondButton.getAttribute('aria-pressed'), 'true');
        await act(async () => {
            secondButton.click();
        });
        assert.deepEqual(commands, ['list']);
    } finally {
        await act(async () => root?.unmount());
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    }
});
