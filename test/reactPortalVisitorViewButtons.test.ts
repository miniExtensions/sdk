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
    const tree = (selectedViewId: string, available = views) =>
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
