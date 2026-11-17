import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import type { EventTarget as HappyEventTarget } from 'happy-dom';
import {
    ReadonlyPortalGrid,
    type ReadonlyPortalGridProps,
} from '../src/react/ReadonlyPortalGrid.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

function model(
    overrides: Partial<ReadonlyPortalGridProps> = {}
): ReadonlyPortalGridProps {
    return {
        columns: Object.freeze([
            Object.freeze({
                fieldId: 'primary',
                title: 'Name',
                icon: 'text' as const,
            }),
            Object.freeze({
                fieldId: 'value',
                title: 'Value',
                icon: 'number' as const,
            }),
        ]),
        rows: Object.freeze([
            Object.freeze({
                recordId: 'second',
                label: 'Second',
                cells: Object.freeze([
                    Object.freeze({
                        fieldId: 'value',
                        node: h('span', null, '0'),
                    }),
                    Object.freeze({
                        fieldId: 'primary',
                        node: h('span', null, 'Second'),
                    }),
                ]),
            }),
            Object.freeze({
                recordId: 'first',
                label: 'First',
                cells: Object.freeze([
                    Object.freeze({
                        fieldId: 'primary',
                        node: h('span', null, 'First'),
                    }),
                    Object.freeze({
                        fieldId: 'value',
                        node: h('span', null, 'false'),
                    }),
                ]),
            }),
        ]),
        primaryFieldId: 'primary',
        revision: 1,
        preferenceScopeKey: 'portal:field:original',
        ready: true,
        isCurrent: () => true,
        hiddenColumns: Object.freeze({}),
        columnWidths: Object.freeze({}),
        ...overrides,
    };
}

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;
function button(f: Fixture, text: string) {
    const node = [...f.container.querySelectorAll('button')].find(
        (x) => x.textContent === text
    );
    assert.ok(node);
    return node;
}
function header(f: Fixture, fieldId = 'value') {
    const node = f.container.querySelector(`th[data-field-id="${fieldId}"]`);
    assert.ok(node instanceof f.window.HTMLTableCellElement);
    return node;
}
async function pointer(
    f: Fixture,
    target: HappyEventTarget,
    type: string,
    x: number,
    id = 1
) {
    await act(async () => {
        const event = new f.window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x,
        });
        Object.defineProperty(event, 'pointerId', { value: id });
        target.dispatchEvent(event);
    });
}

it('owns complete table markup, accepted ordering, literal labels and empty headers', async (t) => {
    const f = await htmlPresentationFixture(t);
    const props = model();
    await f.render(h(ReadonlyPortalGrid, props));
    assert.deepEqual(
        [...f.container.querySelectorAll('thead th')].map((x) => x.textContent),
        ['Name', 'Value']
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('tbody tr')].map((x) =>
            x.getAttribute('data-record-id')
        ),
        ['second', 'first']
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('tbody td')].map((x) => x.textContent),
        ['Second', '0', 'First', 'false']
    );
    assert.equal(props.rows[0].cells[0].fieldId, 'value');
    assert.equal(
        f.container.querySelectorAll(
            '.mx-sdk-readonly-grid__cell-content.cell-short'
        ).length,
        4
    );
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({
                rows: [],
                columns: [
                    {
                        fieldId: 'primary',
                        title: '<b>Empty primary</b>',
                        icon: 'text',
                    },
                    {
                        fieldId: 'value',
                        title: 'No row needed',
                        icon: 'number',
                    },
                ],
            })
        )
    );
    assert.equal(f.container.querySelector('thead b'), null);
    assert.equal(f.container.querySelectorAll('thead svg').length, 2);
    assert.equal(f.container.querySelector('tbody')?.children.length, 0);
    assert.equal(
        f.container.querySelector('[role="status"]')?.textContent,
        'No records'
    );
    f.unchangedEffects();
});

it('protects primary visibility and treats only true as a hidden preference', async (t) => {
    const f = await htmlPresentationFixture(t);
    for (const hidden of [false, null, undefined, 'true', 1]) {
        await f.render(
            h(
                ReadonlyPortalGrid,
                model({ hiddenColumns: { primary: true, value: hidden } })
            )
        );
        assert.equal(f.container.querySelectorAll('thead th').length, 2);
    }
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({
                hiddenColumns: { primary: true, value: true, unknown: true },
            })
        )
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('thead th')].map((x) => x.textContent),
        ['Name']
    );
    f.unchangedEffects();
});

it('suppresses unavailable/stale scopes without invoking action or preference ports', async (t) => {
    const f = await htmlPresentationFixture(t);
    const effects: unknown[] = [];
    for (const overrides of [
        { ready: false },
        { preferenceScopeKey: null },
        { isCurrent: () => false },
        {
            isCurrent: () => {
                throw new Error('retired');
            },
        },
    ]) {
        await f.render(
            h(
                ReadonlyPortalGrid,
                model({
                    ...overrides,
                    allowHideColumns: true,
                    onFieldHiddenChange: (x) => effects.push(x),
                    onColumnWidthCommit: (x) => effects.push(x),
                    onOpenRecord: (...x) => effects.push(x),
                })
            )
        );
        assert.equal(f.container.querySelector('table'), null);
        assert.equal(f.container.querySelector('button'), null);
        assert.equal(
            f.container.querySelector('[role="status"]')?.textContent,
            'Grid is not ready.'
        );
    }
    assert.deepEqual(effects, []);
    f.unchangedEffects();
});

it('owns rich header descriptions even for empty rows and uses real keyboard tooltip presentation', async (t) => {
    const f = await htmlPresentationFixture(t);
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({
                rows: [],
                columns: [
                    { fieldId: 'primary', title: 'Name' },
                    {
                        fieldId: 'value',
                        title: 'Value',
                        description:
                            '<p><strong>Rich header</strong><script>unsafe()</script></p>',
                    },
                ],
            })
        )
    );
    const trigger = f.container.querySelector(
        'button[aria-label="Field description for Value"]'
    );
    assert.ok(trigger instanceof f.window.HTMLButtonElement);
    assert.equal(trigger.type, 'button');
    assert.equal(f.container.querySelector('script'), null);
    assert.equal(
        f.container.querySelector('.mx-sdk-field-sr-only strong')?.textContent,
        'Rich header'
    );
    await act(async () => trigger.focus());
    const tooltip = f.window.document.body.querySelector('[role="tooltip"]');
    assert.ok(tooltip);
    assert.equal(tooltip.querySelector('strong')?.textContent, 'Rich header');
    assert.equal(trigger.getAttribute('aria-describedby'), tooltip.id);
    await act(async () =>
        trigger.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
            })
        )
    );
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    assert.equal(f.window.document.activeElement, trigger);
    f.unchangedEffects();
});

it('reuses the description image failure latch and retires its popup with the admitted header', async (t) => {
    const f = await htmlPresentationFixture(t);
    const image =
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
    const props = model({
        columns: [
            { fieldId: 'primary', title: 'Name' },
            { fieldId: 'value', title: 'Value', descriptionImageUrl: image },
        ],
    });
    await f.render(h(ReadonlyPortalGrid, props));
    const trigger = f.container.querySelector(
        'button[aria-label="Field description for Value"]'
    );
    assert.ok(trigger instanceof f.window.HTMLButtonElement);
    assert.equal(
        f.window.document.body.querySelector('img'),
        null,
        'No image before description activation'
    );
    await act(async () => trigger.focus());
    const img = f.window.document.body.querySelector('img');
    assert.ok(img);
    assert.equal(img.src, image);
    await f.imageEvent(img, 'error');
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
    assert.equal(
        f.container.querySelector(
            'button[aria-label="Field description for Value"]'
        ),
        null
    );
    await f.render(h(ReadonlyPortalGrid, { ...props, rowHeight: 'medium' }));
    assert.equal(
        f.container.querySelector(
            'button[aria-label="Field description for Value"]'
        ),
        null,
        'Same failed image does not restart on ordinary rerender'
    );
    await f.render(
        h(ReadonlyPortalGrid, {
            ...props,
            revision: 2,
            columns: [
                { fieldId: 'primary', title: 'Name' },
                {
                    fieldId: 'value',
                    title: 'Value',
                    description: '<p>Replacement help</p>',
                },
            ],
        })
    );
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null,
        'Replacement header does not inherit an open popup'
    );
    f.unchangedEffects();
});

it('refuses stale header focus/hover/click and portaled image retry/link activation before rerender', async (t) => {
    const f = await htmlPresentationFixture(t);
    let live = true;
    const props = model({
        isCurrent: () => live,
        preview: true,
        columns: [
            { fieldId: 'primary', title: 'Name' },
            {
                fieldId: 'value',
                title: 'Value',
                description:
                    '<p><a href="https://example.invalid/stale-help">Help link</a></p>',
                descriptionImageUrl:
                    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
            },
        ],
    });
    await f.render(h(ReadonlyPortalGrid, props));
    const trigger = f.container.querySelector(
        'button[aria-label="Field description for Value"]'
    );
    assert.ok(trigger instanceof f.window.HTMLButtonElement);
    live = false;
    await act(async () => trigger.focus());
    await f.click(trigger);
    await act(async () =>
        trigger.dispatchEvent(
            new f.window.MouseEvent('mouseover', { bubbles: true })
        )
    );
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]') === null,
        true,
        'Retired header cannot activate a tooltip'
    );
    assert.equal(
        f.window.document.body.querySelector('img') === null,
        true,
        'Retired header cannot load an image'
    );
    live = true;
    await act(async () => {
        trigger.blur();
        trigger.focus();
    });
    const img = f.window.document.body.querySelector('img');
    assert.ok(img);
    await f.imageEvent(img, 'error');
    const retry = [...f.window.document.body.querySelectorAll('button')].find(
        (n) => n.textContent === 'Try again'
    );
    const link = f.window.document.body.querySelector('[role="tooltip"] a');
    assert.ok(retry);
    assert.ok(link instanceof f.window.HTMLAnchorElement);
    live = false;
    await f.click(retry);
    assert.equal(
        f.window.document.body.querySelector('img') === null,
        true,
        'Retired popup cannot retry its image'
    );
    await f.click(link);
    for (const [type, button] of [
        ['auxclick', 1],
        ['contextmenu', 2],
    ] as const) {
        await act(async () => {
            const event = new f.window.MouseEvent(type, {
                button,
                bubbles: true,
                cancelable: true,
            });
            assert.equal(
                link.dispatchEvent(event),
                false,
                `Retired ${type} default must be cancelled`
            );
            assert.equal(event.defaultPrevented, true);
        });
    }
    f.unchangedEffects();
    live = true;
    await f.render(h(ReadonlyPortalGrid, { ...props, revision: 2 }));
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]'),
        null
    );
});

it('retires admitted header help before its delayed popup/media commit', async (t) => {
    const f = await htmlPresentationFixture(t);
    let live = true;
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({
                isCurrent: () => live,
                columns: [
                    { fieldId: 'primary', title: 'Name' },
                    {
                        fieldId: 'value',
                        title: 'Value',
                        description: '<p>Deferred help</p>',
                        descriptionImageUrl:
                            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
                    },
                ],
            })
        )
    );
    const trigger = f.container.querySelector(
        'button[aria-label="Field description for Value"]'
    );
    assert.ok(trigger instanceof f.window.HTMLButtonElement);
    await act(async () => {
        trigger.focus();
        live = false;
    });
    assert.equal(
        f.window.document.body.querySelector('[role="tooltip"]') === null,
        true
    );
    assert.equal(f.window.document.body.querySelector('img') === null, true);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    f.unchangedEffects();
});

it('delegates Open with the actual trigger and refuses retained stale/ABA intents', async (t) => {
    const f = await htmlPresentationFixture(t);
    let epoch = 1;
    const calls: { recordId: string; trigger: HTMLButtonElement }[] = [];
    const props = model({
        isCurrent: () => epoch === 1,
        onOpenRecord: (recordId, trigger) => calls.push({ recordId, trigger }),
    });
    await f.render(h(ReadonlyPortalGrid, props));
    const open = button(f, 'Open record');
    assert.equal(open.getAttribute('type'), 'button');
    await f.click(open);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].recordId, 'second');
    assert.equal(calls[0].trigger, open);
    epoch = 2;
    await f.click(open);
    epoch = 3;
    await f.click(open);
    assert.equal(calls.length, 1);
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({
                revision: 3,
                isCurrent: () => epoch === 3,
                onOpenRecord: (recordId, trigger) =>
                    calls.push({ recordId, trigger }),
            })
        )
    );
    await f.click(button(f, 'Open record'));
    assert.equal(calls[1].recordId, 'second');
    f.unchangedEffects();
});

it('hydrates finite width values without inventing a clamp and defaults invalid input to 200', async (t) => {
    const f = await htmlPresentationFixture(t);
    let revision = 0;
    for (const [width, expected] of [
        [120, 120],
        ['180', 180],
        ['', 0],
        [0, 0],
        [-5, -5],
        [null, 200],
        [undefined, 200],
        ['no', 200],
        [Infinity, 200],
        [NaN, 200],
        [{}, 200],
    ] as const) {
        await f.render(
            h(
                ReadonlyPortalGrid,
                model({
                    revision: ++revision,
                    columnWidths: { value: width },
                    onColumnWidthCommit: () => {},
                })
            )
        );
        assert.equal(
            header(f)
                .querySelector('[role="separator"]')
                ?.getAttribute('aria-valuenow'),
            String(expected)
        );
    }
    f.unchangedEffects();
});

it('settles pointer resize to measured geometry rather than accumulated delta', async (t) => {
    const f = await htmlPresentationFixture(t);
    const changes: unknown[] = [];
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({
                columnWidths: { value: '150' },
                onColumnWidthCommit: (x) => changes.push(x),
            })
        )
    );
    const th = header(f);
    Object.defineProperty(th, 'clientWidth', {
        configurable: true,
        get: () => 241,
    });
    const handle = th.querySelector('[role="separator"]');
    assert.ok(handle);
    await pointer(f, handle, 'pointerdown', 100);
    await pointer(f, f.window.document, 'pointermove', 999, 2);
    assert.equal(th.style.width, '150px');
    await pointer(f, f.window.document, 'pointermove', 120);
    assert.equal(th.style.width, '170px');
    assert.deepEqual(changes, []);
    await pointer(f, f.window.document, 'pointerup', 120);
    assert.deepEqual(changes, [{ fieldId: 'value', width: 241 }]);
    assert.equal(th.style.width, '241px');
    f.unchangedEffects();
});

it('retires cancelled, replaced and stale drags without preference writes', async (t) => {
    const f = await htmlPresentationFixture(t);
    let live = true;
    const changes: unknown[] = [];
    const props = model({
        isCurrent: () => live,
        onColumnWidthCommit: (x) => changes.push(x),
    });
    await f.render(h(ReadonlyPortalGrid, props));
    let handle = header(f).querySelector('[role="separator"]');
    assert.ok(handle);
    await pointer(f, handle, 'pointerdown', 20);
    await pointer(f, f.window.document, 'pointercancel', 30);
    await pointer(f, f.window.document, 'pointerup', 30);
    await pointer(f, handle, 'pointerdown', 20);
    live = false;
    await pointer(f, f.window.document, 'pointermove', 40);
    await pointer(f, f.window.document, 'pointerup', 40);
    live = true;
    await pointer(f, handle, 'pointerdown', 20);
    await f.render(
        h(ReadonlyPortalGrid, {
            ...props,
            revision: 2,
            preferenceScopeKey: 'portal:field:another',
            columnWidths: { value: 321 },
        })
    );
    await pointer(f, f.window.document, 'pointerup', 40);
    handle = header(f).querySelector('[role="separator"]');
    assert.ok(handle);
    assert.equal(header(f).style.width, '321px');
    assert.deepEqual(changes, []);
    f.unchangedEffects();
});

it('retires width authority withdrawn mid-gesture without reviving it on restoration', async (t) => {
    const f = await htmlPresentationFixture(t);
    const changes: unknown[] = [];
    const props = model({
        onColumnWidthCommit: (change) => changes.push(change),
    });
    await f.render(h(ReadonlyPortalGrid, props));
    const th = header(f);
    const handle = th.querySelector('[role="separator"]');
    assert.ok(handle);
    await pointer(f, handle, 'pointerdown', 20);
    await pointer(f, f.window.document, 'pointermove', 40);
    await f.render(
        h(ReadonlyPortalGrid, { ...props, onColumnWidthCommit: undefined })
    );
    assert.equal(th.querySelector('[role="separator"]'), null);
    await pointer(f, f.window.document, 'pointerup', 40);
    assert.deepEqual(
        changes,
        [],
        'Withdrawn authority cannot receive the old gesture'
    );
    await f.render(h(ReadonlyPortalGrid, props));
    await pointer(f, f.window.document, 'pointerup', 40);
    assert.deepEqual(
        changes,
        [],
        'Restoring a port cannot revive a retired gesture'
    );

    const restored = th.querySelector('[role="separator"]');
    assert.ok(restored);
    await pointer(f, restored, 'pointerdown', 20);
    await f.render(
        h(ReadonlyPortalGrid, { ...props, labels: { empty: 'Still empty' } })
    );
    await pointer(f, f.window.document, 'pointermove', 40);
    await pointer(f, f.window.document, 'pointerup', 40);
    assert.equal(
        changes.length,
        1,
        'A same-current ordinary rerender preserves the admitted gesture'
    );

    await act(async () =>
        restored.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    await f.render(
        h(ReadonlyPortalGrid, { ...props, onColumnWidthCommit: undefined })
    );
    await f.render(h(ReadonlyPortalGrid, props));
    const last = th.querySelector('[role="separator"]');
    assert.ok(last);
    await act(async () =>
        last.dispatchEvent(
            new f.window.KeyboardEvent('keyup', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(
        changes.length,
        1,
        'Withdrawn keyboard authority stays retired after restoration'
    );
    f.unchangedEffects();
});

it('supports keyboard resize with measured settlement and Escape cancellation', async (t) => {
    const f = await htmlPresentationFixture(t);
    const changes: unknown[] = [];
    await f.render(
        h(
            ReadonlyPortalGrid,
            model({ onColumnWidthCommit: (x) => changes.push(x) })
        )
    );
    const th = header(f);
    Object.defineProperty(th, 'clientWidth', {
        configurable: true,
        get: () => 245,
    });
    const handle = th.querySelector('[role="separator"]');
    assert.ok(handle);
    await act(async () => {
        handle.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowRight',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(th.style.width, '255px');
    await act(async () => {
        handle.dispatchEvent(
            new f.window.KeyboardEvent('keyup', {
                key: 'ArrowRight',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.deepEqual(changes, [{ fieldId: 'value', width: 245 }]);
    await act(async () => {
        handle.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowLeft',
                bubbles: true,
                cancelable: true,
            })
        );
        handle.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(th.style.width, '200px');
    assert.equal(changes.length, 1);
    f.unchangedEffects();
});

it('owns the hide dialog, excludes primary and emits only current controlled intents', async (t) => {
    const f = await htmlPresentationFixture(t);
    const changes: unknown[] = [];
    let live = true;
    const props = model({
        allowHideColumns: true,
        isCurrent: () => live,
        onFieldHiddenChange: (x) => changes.push(x),
    });
    await f.render(h(ReadonlyPortalGrid, props));
    const trigger = button(f, 'Hide columns');
    await f.click(trigger);
    assert.equal(f.container.querySelectorAll('[role="switch"]').length, 1);
    const toggle = f.container.querySelector('[role="switch"]');
    assert.ok(toggle instanceof f.window.HTMLButtonElement);
    assert.equal(toggle.getAttribute('aria-label'), 'Value');
    await f.click(toggle);
    assert.deepEqual(changes, [{ fieldId: 'value', isHidden: true }]);
    await f.render(
        h(ReadonlyPortalGrid, { ...props, hiddenColumns: { value: true } })
    );
    assert.equal(toggle.getAttribute('aria-checked'), 'false');
    assert.equal(f.container.querySelectorAll('thead th').length, 1);
    live = false;
    await f.click(toggle);
    assert.equal(changes.length, 1);
    live = true;
    await f.click(button(f, 'Close'));
    assert.equal(f.container.querySelector('dialog'), null);
    assert.equal(f.window.document.activeElement, trigger);
    f.unchangedEffects();
});

it('uses strict copy policy data, row-height inheritance and DOM-free SSR', () => {
    for (const policy of [undefined, null, false, 'true', 1]) {
        const html = renderToString(
            h(
                ReadonlyPortalGrid,
                model({
                    doNotAllowUserToCopyTextOnGrid: policy as
                        | boolean
                        | null
                        | undefined,
                    rowHeight: 'fit-content',
                })
            )
        );
        assert.ok(html.includes('data-copy-restricted="false"'));
        assert.ok(html.includes('cell-fit-content'));
        assert.ok(!html.includes('<dialog'));
    }
    assert.ok(
        renderToString(
            h(
                ReadonlyPortalGrid,
                model({
                    doNotAllowUserToCopyTextOnGrid: true,
                })
            )
        ).includes('data-copy-restricted="true"')
    );
});

for (const retirement of ['ready', 'current'] as const) {
    it(`does not revive an old hide dialog after ${retirement} retires and recovers`, async (t) => {
        const f = await htmlPresentationFixture(t);
        let admitted = true;
        const changes: unknown[] = [];
        const props = model({
            allowHideColumns: true,
            isCurrent: () => retirement === 'ready' || admitted,
            onFieldHiddenChange: (change) => changes.push(change),
        });
        await f.render(h(ReadonlyPortalGrid, props));
        await f.click(button(f, 'Hide columns'));
        assert.ok(f.container.querySelector('dialog'));
        admitted = false;
        await f.render(
            h(ReadonlyPortalGrid, {
                ...props,
                ready: retirement === 'ready' ? false : true,
            })
        );
        assert.equal(f.container.querySelector('dialog'), null);
        admitted = true;
        await f.render(h(ReadonlyPortalGrid, props));
        assert.equal(f.container.querySelector('dialog'), null);
        await f.click(button(f, 'Hide columns'));
        assert.ok(f.container.querySelector('dialog'));
        assert.deepEqual(changes, []);
        f.unchangedEffects();
    });
}

it('ships standalone native content-wrapper sizing independently of host CSS', async (t) => {
    const f = await htmlPresentationFixture(t);
    const style = f.window.document.createElement('style');
    style.textContent = readFileSync(
        process.env.SDK_READONLY_PORTAL_GRID_CSS ??
            'src/react/readonly-portal-grid.css',
        'utf8'
    );
    f.window.document.head.append(style);
    for (const [rowHeight, height] of [
        ['short', '24px'],
        ['medium', '52px'],
        ['tall', '84px'],
        ['extra-tall', '140px'],
        ['fit-content', 'auto'],
    ] as const) {
        await f.render(h(ReadonlyPortalGrid, model({ rowHeight })));
        const content = f.container.querySelector(
            '.mx-sdk-readonly-grid__cell-content'
        );
        assert.ok(content);
        assert.equal(f.window.getComputedStyle(content).height, height);
    }
    style.remove();
    f.unchangedEffects();
});
