import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as portals from '../src/portals/index.js';
import {
    resolvePortalShellSelection as resolve,
    projectPortalShellMenu,
    isPortalShellUrl,
    portalShellSelectionsEqual,
    type PortalShellMenuItem,
} from '../src/portals/index.js';

const items: readonly PortalShellMenuItem[] = [
    {
        type: 'table',
        id: 'orders',
        label: 'Orders',
        views: [
            { id: 'open', label: 'Open' },
            { id: 'done', label: 'Done' },
        ],
        defaultViewId: 'done',
    },
    {
        type: 'group',
        id: 'help',
        label: '',
        items: [
            {
                type: 'embedded',
                id: 'guide',
                label: 'Guide',
                url: 'https://example.test/new',
            },
            {
                type: 'external',
                id: 'docs',
                label: 'Docs',
                url: 'https://example.test/docs',
            },
        ],
    },
    { type: 'table', id: 'people', label: 'People' },
];

it('public API owns the complete Portal shell and a pure selection resolver', () => {
    assert.equal(
        typeof Reflect.get(portals, 'resolvePortalShellSelection'),
        'function'
    );
});

it('consumes URL view only initially; preserves the accepted view across reconfiguration/remount', () => {
    const restoredSelection = {
        type: 'table' as const,
        itemId: 'people',
        viewId: null,
    };
    assert.deepEqual(
        resolve({
            items,
            restoredSelection,
            initialSelection: { itemId: 'people', viewId: 'open' },
            phase: 'initial',
        }),
        { type: 'table', itemId: 'orders', viewId: 'open' }
    );
    const selection = {
        type: 'table' as const,
        itemId: 'orders',
        viewId: 'done',
    };
    const reconfigured = structuredClone(items);
    assert.deepEqual(
        resolve({
            items: reconfigured,
            selection,
            initialSelection: { viewId: 'open' },
            restoredSelection,
            phase: 'reconcile',
        }),
        selection
    );
    assert.deepEqual(
        resolve({
            items: reconfigured,
            selection,
            initialSelection: { viewId: 'open' },
            phase: 'initial',
        }),
        selection
    );
    assert.deepEqual(
        resolve({
            items,
            restoredSelection,
            initialSelection: { viewId: 'hidden', itemId: 'people' },
            phase: 'initial',
        }),
        restoredSelection
    );
});

it('restores eligible tables/embedded snapshots without disclosure mount effects; revokes invalid destinations', () => {
    const restoredSelection = {
        type: 'embedded' as const,
        itemId: 'guide',
        url: 'https://example.test/captured',
    };
    assert.deepEqual(
        resolve({ items, restoredSelection, phase: 'initial' }),
        restoredSelection
    );
    assert.deepEqual(
        resolve({ items, selection: restoredSelection, phase: 'reconcile' }),
        restoredSelection
    );
    assert.deepEqual(
        resolve({
            items,
            restoredSelection,
            initialSelection: { viewId: 'open' },
            phase: 'initial',
        }),
        { type: 'table', itemId: 'orders', viewId: 'open' }
    );
    assert.deepEqual(
        resolve({
            items: [
                {
                    type: 'embedded',
                    id: 'guide',
                    label: 'Invalid',
                    url: 'javascript:alert(1)',
                },
                items[2]!,
            ],
            selection: restoredSelection,
            phase: 'reconcile',
        }),
        { type: 'table', itemId: 'people', viewId: null }
    );
    assert.deepEqual(
        resolve({
            items,
            selection: { ...restoredSelection, url: 'javascript:bad' },
            phase: 'reconcile',
        }),
        { ...restoredSelection, url: 'https://example.test/new' }
    );
});

it('falls back on hidden/deleted tables and views; does not resurrect saved or initial selections later', () => {
    assert.deepEqual(
        resolve({
            items,
            selection: { type: 'table', itemId: 'orders', viewId: 'hidden' },
            phase: 'reconcile',
        }),
        { type: 'table', itemId: 'orders', viewId: 'done' }
    );
    assert.deepEqual(
        resolve({
            items: [items[2]!],
            selection: { type: 'table', itemId: 'orders', viewId: 'open' },
            restoredSelection: {
                type: 'embedded',
                itemId: 'guide',
                url: 'https://example.test',
            },
            initialSelection: { viewId: 'open' },
            phase: 'reconcile',
        }),
        { type: 'table', itemId: 'people', viewId: null }
    );
    assert.equal(resolve({ items: [], phase: 'initial' }), null);
    assert.equal(
        resolve({
            items: [
                {
                    type: 'external',
                    id: 'x',
                    label: 'Outside',
                    url: 'https://example.test',
                },
            ],
            phase: 'reconcile',
        }),
        null
    );
    assert.deepEqual(
        resolve({
            items: [
                {
                    type: 'table',
                    id: 'a',
                    label: 'A',
                    views: [{ id: 'first', label: 'First' }],
                },
            ],
            phase: 'initial',
        }),
        { type: 'table', itemId: 'a', viewId: 'first' }
    );
});

it('omits empty groups, ambiguous identities and unsafe URLs without evaluating conditions or mutating input', () => {
    const source: readonly PortalShellMenuItem[] = [
        ...items,
        { type: 'group', id: 'empty', label: 'Empty', items: [] },
        { type: 'table', id: 'duplicate', label: 'A' },
        {
            type: 'embedded',
            id: 'duplicate',
            label: 'B',
            url: 'https://example.test',
        },
        {
            type: 'table',
            id: 'views',
            label: 'No eligible views',
            views: [
                { id: 'x', label: 'X' },
                { id: 'x', label: 'Y' },
            ],
        },
        {
            type: 'external',
            id: 'bad',
            label: 'Bad',
            url: 'http://example.test',
        },
        { type: 'table', id: ' ', label: 'Blank' },
    ];
    const before = structuredClone(source);
    assert.deepEqual(
        projectPortalShellMenu(source).map((item) => item.id),
        ['orders', 'help', 'people']
    );
    assert.equal(projectPortalShellMenu(source)[1]!.label, 'More');
    assert.deepEqual(source, before);
    assert.equal(isPortalShellUrl('/relative'), false);
    assert.equal(isPortalShellUrl('https://user:password@example.test'), false);
    assert.equal(isPortalShellUrl('https://example.test/path?x=1#part'), true);
    assert.equal(portalShellSelectionsEqual(null, null), true);
    assert.equal(
        portalShellSelectionsEqual(
            { type: 'table', itemId: 'a', viewId: null },
            { type: 'table', itemId: 'a', viewId: null }
        ),
        true
    );
    assert.equal(
        portalShellSelectionsEqual(
            { type: 'embedded', itemId: 'a', url: 'https://a.test' },
            { type: 'embedded', itemId: 'a', url: 'https://b.test' }
        ),
        false
    );
});
