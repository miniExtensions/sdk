import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
    AirtableGrid,
    ReadonlyPortalList,
    type ReadonlyPortalListOpenAction,
} from '../src/react/index.js';
import {
    createBorrowedPortalRenderScope,
    type BorrowedPortalTarget,
} from '../src/ui/borrowedPortalRenderScope.js';
import type { PortalRecordPresentation } from '../src/portals/listOwner.js';
import { loadedForm } from './formsFixtures.js';

function source() {
    const schema = loadedForm().payload.fieldIdsToSchemas.fld_title;
    const second = {
        ...schema.airtableField,
        id: 'fld_second',
        name: 'Second',
    };
    const projection: PortalRecordPresentation = {
        portalFieldId: 'fld_children',
        linkedTableId: 'table_children',
        records: [
            {
                id: 'record_B',
                fields: { fld_title: 'Beta', fld_second: 'B detail' },
            },
            {
                id: 'record_A',
                fields: { fld_title: 'Alpha', fld_second: 'A detail' },
            },
        ],
        table: { airtableFields: [schema.airtableField, second] },
        detailProjection: 'present',
        detailFields: ['fld_title', 'fld_second'].map((fieldId, index) => ({
            fieldId,
            fieldName: index ? 'Second' : 'Title',
            titleOverride: index ? 'Detail label' : 'Name label',
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: schema.miniExtConfig,
        })),
    };
    let stamp = {};
    let current: PortalRecordPresentation | null = projection;
    let stops = 0;
    const listeners = new Set<() => void>();
    const calls: BorrowedPortalTarget[] = [];
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({ stamp, projection: current }),
        isCurrent: (expected) => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                stops++;
                listeners.delete(listener);
            };
        },
        invokeIfCurrent(expected, target, isCurrent) {
            if (expected !== stamp || !isCurrent()) return false;
            calls.push(target);
            return true;
        },
    });
    return {
        scope,
        projection,
        calls,
        get stops() {
            return stops;
        },
        get subscriptions() {
            return listeners.size;
        },
        replace(next: PortalRecordPresentation | null = projection) {
            stamp = {};
            current = next;
            for (const listener of [...listeners]) listener();
        },
    };
}

const renderers = {
    renderSingleLineTextField: (
        props: import('../src/ui/rendererRegistry.js').FieldRendererProps<'singleLineText'>
    ) => {
        assert.equal(props.capability.type, 'readonly');
        return h('span', null, String(props.value ?? ''));
    },
};

function environment(t: TestContext) {
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
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    const container = window.document.createElement('form');
    window.document.body.append(container);
    let submits = 0;
    container.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
        assert.equal(submits, 0);
    });
    return {
        container,
        window,
        render: (node: ReactNode) =>
            act(async () => root.render(h(StrictMode, null, node))),
        click: async (
            node: NonNullable<ReturnType<typeof container.querySelector>>
        ) =>
            act(async () => {
                node.dispatchEvent(
                    new window.MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
            }),
    };
}

it('owns all ordered rows/cells and empty column labels through SSR without reads or child actions', () => {
    const f = source();
    try {
        const html = renderToString(
            h(ReadonlyPortalList, {
                scope: f.scope,
                renderers,
                label: 'Records',
            })
        );
        assert.match(html, /<ul[^>]*aria-label="Records"/);
        assert(html.indexOf('record_B') < html.indexOf('record_A'));
        assert(html.indexOf('Beta') < html.indexOf('B detail'));
        assert(html.indexOf('B detail') < html.indexOf('Alpha'));
        assert.doesNotMatch(html, /<button|<input|<form/);
        f.replace({ ...f.projection, records: [] });
        const empty = renderToString(
            h(ReadonlyPortalList, { scope: f.scope, renderers })
        );
        assert.match(empty, /<h3[^>]*>Name label<\/h3>/);
        assert.match(empty, /<h3[^>]*>Detail label<\/h3>/);
        assert.doesNotMatch(empty, /<li\b|<button/);
        assert.deepEqual(f.calls, []);
    } finally {
        f.scope.destroy();
    }
});

it('uses current registered Open commands, preserves keys/cosmetic focus and never submits', async (t) => {
    const dom = environment(t),
        f = source();
    t.after(() => f.scope.destroy());
    let guard: (() => boolean) | undefined;
    let returnFocus: (() => void) | undefined;
    const snapshot = f.scope.getSnapshot();
    const actions = new Map<string, ReadonlyPortalListOpenAction>(
        snapshot.rows.map((row) => [
            row.recordId,
            {
                revision: snapshot.revision,
                activate(isCurrent, restore) {
                    guard = isCurrent;
                    returnFocus = restore;
                    if (isCurrent())
                        void snapshot.actions.openChild(row.recordId);
                },
            },
        ])
    );
    const view = (label = 'Open record') =>
        h(ReadonlyPortalList, {
            scope: f.scope,
            renderers,
            openActions: actions,
            openRecordLabel: label,
        });
    await dom.render(view());
    const rows = [...dom.container.querySelectorAll('li')];
    const button = rows[0]!.querySelector('button')!;
    assert.equal(button.type, 'button');
    assert.equal(f.subscriptions, 1);
    assert.deepEqual(f.calls, []);
    await dom.click(button);
    assert.deepEqual(f.calls, [
        { action: 'open-child', recordId: 'record_B', fieldId: undefined },
    ]);
    assert.equal(guard?.(), true);
    await dom.render(view('Open this record'));
    assert.equal(dom.container.querySelector('li'), rows[0]);
    dom.window.document.body.focus();
    returnFocus?.();
    assert.equal(dom.window.document.activeElement, button);
    const oldGuard = guard,
        oldFocus = returnFocus;
    await act(async () => {
        f.replace({
            ...f.projection,
            records: [...f.projection.records].reverse(),
        });
    });
    assert.equal(oldGuard?.(), false);
    assert.equal(dom.container.querySelectorAll('button').length, 0);
    await dom.click(button);
    assert.equal(f.calls.length, 1);
    oldFocus?.();
    assert.notEqual(dom.window.document.activeElement, button);
});

it('suppresses preview/no-child actions and rejects stale capability revisions', async (t) => {
    const dom = environment(t),
        f = source();
    t.after(() => f.scope.destroy());
    let opens = 0;
    const stale = new Map<string, ReadonlyPortalListOpenAction>([
        [
            'record_B',
            {
                revision: -1,
                activate() {
                    opens++;
                },
            },
        ],
    ]);
    await dom.render(
        h(ReadonlyPortalList, { scope: f.scope, renderers, openActions: stale })
    );
    assert.equal(dom.container.querySelectorAll('button').length, 0);
    await dom.render(h(ReadonlyPortalList, { scope: f.scope, renderers }));
    assert.equal(dom.container.querySelectorAll('li').length, 2);
    assert.equal(dom.container.querySelectorAll('button').length, 0);
    assert.equal(opens, 0);
    assert.deepEqual(f.calls, []);
});

it('keeps one borrowed owner across List/Grid/List and retires held guards/focus on unmount', async (t) => {
    const dom = environment(t),
        f = source();
    t.after(() => f.scope.destroy());
    let guard: (() => boolean) | undefined, restore: (() => void) | undefined;
    const snapshot = f.scope.getSnapshot();
    const actions = new Map<string, ReadonlyPortalListOpenAction>([
        [
            'record_B',
            {
                revision: snapshot.revision,
                activate(check, returnFocus) {
                    guard = check;
                    restore = returnFocus;
                },
            },
        ],
    ]);
    const list = () =>
        h(ReadonlyPortalList, {
            scope: f.scope,
            renderers,
            openActions: actions,
        });
    await dom.render(list());
    const old = dom.container.querySelector('button')!;
    await dom.click(old);
    await dom.render(
        h(AirtableGrid, {
            scope: f.scope,
            renderers,
            children: (state) =>
                h(
                    'table',
                    null,
                    h(
                        'tbody',
                        null,
                        state.rows.map((row) =>
                            h(
                                'tr',
                                { key: row.recordId },
                                row.cells.map((cell) =>
                                    h('td', { key: cell.fieldId }, cell.node)
                                )
                            )
                        )
                    )
                ),
        })
    );
    assert.equal(guard?.(), false);
    restore?.();
    assert.notEqual(dom.window.document.activeElement, old);
    assert.equal(f.stops, 0);
    assert.equal(f.subscriptions, 1);
    await dom.render(list());
    assert.equal(dom.container.querySelectorAll('li').length, 2);
    assert.equal(f.stops, 0);
    assert.deepEqual(f.calls, []);
    await dom.render(null);
    assert.equal(f.stops, 0);
    assert.equal(f.subscriptions, 1);
    await act(async () => f.scope.destroy());
    assert.equal(f.stops, 1);
});

it('removes presentation and captured commands on scope retirement without destroying a host during render', async (t) => {
    const dom = environment(t),
        f = source();
    let guard: (() => boolean) | undefined;
    const revision = f.scope.getSnapshot().revision;
    await dom.render(
        h(ReadonlyPortalList, {
            scope: f.scope,
            renderers,
            openActions: new Map([
                [
                    'record_B',
                    {
                        revision,
                        activate(check: () => boolean) {
                            guard = check;
                        },
                    },
                ],
            ]),
        })
    );
    await dom.click(dom.container.querySelector('button')!);
    await act(async () => f.scope.destroy());
    assert.equal(dom.container.childElementCount, 0);
    assert.equal(guard?.(), false);
    assert.deepEqual(f.calls, []);
});
