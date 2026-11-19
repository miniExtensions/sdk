import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGridButtonCell,
    type PortalGridButtonCellProps,
} from '../src/react/PortalGridButtonCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const action: PortalGridButtonCellProps['button'] = {
    mode: 'controlled',
    form: 'button-grid-form',
    value: { label: 'Run the action', url: '/synthetic-action' },
    config: { openLinkType: 'triggerWebhookPOST' },
};

function grid(overrides: Partial<PortalGridButtonCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridButtonCell, {
                    button: action,
                    cellIdentity: 'row-A-button',
                    displayText: '',
                    selected: false,
                    onSelect() {},
                    rowHeight: 'medium',
                    ...overrides,
                })
            )
        )
    );
}

it('server-renders a readonly Button cell, an authorized link, and a blank value', () => {
    let activations = 0;
    const html = renderToString(
        grid({
            selected: true,
            button: { ...action, onTriggerWebhook: () => activations++ },
        })
    );
    assert.match(html, /mx-sdk-portal-grid-button-cell/);
    assert.match(html, /data-editing="false"/);
    assert.match(html, /data-row-height="medium"/);
    assert.match(html, /mx-sdk-portal-grid-text-cell__selection/);
    assert.match(html, /<button[^>]*type="button"/);
    assert.match(html, /form="button-grid-form"/);
    assert.doesNotMatch(html, /<input/);
    assert.equal(activations, 0);
    assert.match(
        renderToString(
            grid({ button: { ...action, config: { openLinkType: '_self' } } })
        ),
        /href="\/synthetic-action"/
    );
    assert.match(
        renderToString(grid({ button: { ...action, value: null } })),
        /class="read-only-text"><\/span>/
    );
});

it('keeps action activation and its captured authority independent of Grid selection', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    let current = true;
    let selected = 0;
    let activations = 0;
    const button: PortalGridButtonCellProps['button'] = {
        ...action,
        form: fixture.container.id,
        owner: { isCurrent: () => current },
        onTriggerWebhook: () => activations++,
    };
    const onSelect = () => selected++;
    const render = (props: Partial<PortalGridButtonCellProps> = {}) =>
        fixture.render(grid({ button, onSelect, ...props }));
    await render();
    const control = fixture.container.querySelector('button');
    const cell = fixture.container.querySelector('td');
    assert.ok(control instanceof fixture.window.HTMLButtonElement);
    assert.ok(cell instanceof fixture.window.HTMLTableCellElement);
    assert.equal(control.form, fixture.container);
    await act(async () => control.click());
    await render({ button: { ...button, busy: true } });
    const spinner = control.querySelector('.mx-sdk-button-spinner');
    assert.ok(spinner);
    await act(async () => {
        spinner.dispatchEvent(
            new fixture.window.MouseEvent('click', { bubbles: true })
        );
    });
    await render();
    current = false;
    await act(async () => control.click());
    assert.equal(activations, 1);
    assert.equal(selected, 0);
    await act(async () => cell.click());
    assert.equal(selected, 1);
    assert.equal(fixture.window.document.activeElement, cell);

    current = true;
    await render({ cellIdentity: 'row-B-button' });
    const replacement = fixture.container.querySelector('button');
    assert.ok(replacement instanceof fixture.window.HTMLButtonElement);
    assert.notEqual(replacement, control);
    assert.equal(fixture.container.querySelector('td'), cell);
    await act(async () => replacement.click());
    assert.equal(activations, 2);
    assert.equal(selected, 1);
});
