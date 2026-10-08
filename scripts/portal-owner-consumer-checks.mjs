import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export async function checkPortalOwnerConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const root = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const { createPortalListOwner } = await import(
        pathToFileURL(join(root, 'portals/index.js'))
    );
    const { PortalList } = await import(
        pathToFileURL(join(root, 'react/index.js'))
    );
    assert.equal(
        typeof require('@miniextensions/sdk/portals').createPortalListOwner,
        'function'
    );
    assert.equal(
        typeof require('@miniextensions/sdk/react').PortalList,
        'function'
    );
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const host = window.document.createElement('div');
    window.document.body.append(host);
    const renderer = createRoot(host);
    const criteria = {
        selectedCustomViewId: 'view_example',
        searchTerm: 'Exact search',
        searchParamsMap: { retained: 'yes' },
        sortFieldsByEndUser: null,
        filtersByEndUser: null,
        supportsEndUserSortCleanup: true,
        supportsEndUserFilterCleanup: true,
    };
    const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
    let revision = 0,
        responder = () =>
            fixtures.page([fixtures.record('rec_b', 'PRIVATE_NATIVE')], 'next');
    const calls = [];
    const client = {
        getSession: () => ({}),
        portals: {
            listLinkedRecords: async (input) => {
                calls.push(structuredClone(input));
                return responder();
            },
        },
    };
    const owner = createPortalListOwner({
        client,
        portal: fixtures.makePortal(),
        portalFieldId: 'fld_children',
        criteria,
        getScope: () => ({ ownerId: 'visitor', revision }),
    });
    const mount = async (render) =>
        act(async () =>
            renderer.render(
                h(
                    StrictMode,
                    null,
                    h(PortalList, { owner, readOptions, render })
                )
            )
        );
    const click = async (label) =>
        act(async () => {
            const button = [...host.querySelectorAll('button')].find(
                (button) => button.textContent === label
            );
            assert(button && !button.disabled, label);
            button.click();
        });
    let checks = 0;
    try {
        await mount();
        assert.equal(calls.length, 0);
        checks++;
        await click('Load records');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].searchTerm, 'Exact search');
        assert.equal(calls[0].airtableOffset, null);
        assert.equal(host.querySelectorAll('li').length, 1);
        assert(!host.textContent.includes('PRIVATE_NATIVE'));
        checks++;
        responder = () =>
            fixtures.page([fixtures.record('rec_a', 'SECOND_PRIVATE')]);
        await click('Next page');
        assert.equal(calls[1].airtableOffset, 'next');
        assert.deepEqual(owner.getSnapshot().page.recordIds, [
            'rec_b',
            'rec_a',
        ]);
        checks++;
        const copy = owner.getSnapshot();
        copy.page.recordIds.length = 0;
        copy.criteria.searchParamsMap.retained = 'changed';
        assert.equal(owner.getSnapshot().page.recordIds.length, 2);
        assert.equal(
            owner.getSnapshot().criteria.searchParamsMap.retained,
            'yes'
        );
        checks++;
        await act(async () => renderer.render(null));
        await mount();
        assert.equal(calls.length, 2);
        assert.equal(host.querySelectorAll('li').length, 2);
        checks++;
        let held;
        await mount(({ snapshot, owner }) => {
            held = () =>
                owner.setCriteria(snapshot.revision, {
                    ...snapshot.criteria,
                    searchTerm: 'new',
                });
            return h('button', { onClick: held }, 'Apply criteria');
        });
        const stale = held;
        await click('Apply criteria');
        assert.equal(calls.length, 2);
        assert.equal(owner.getSnapshot().readRequired, true);
        assert.equal(owner.getSnapshot().page, null);
        assert.equal(stale(), false);
        checks++;
        responder = () =>
            fixtures.page([], null, { endUserSortCleanup: { sortFields: [] } });
        await mount();
        await click('Load records');
        assert.equal(owner.getSnapshot().phase, 'cleanup');
        const cleanup = owner.getSnapshot();
        await act(async () => {
            assert.equal(owner.acceptCleanup(cleanup.revision), true);
        });
        assert.equal(calls.length, 3);
        assert.deepEqual(owner.getSnapshot().criteria.sortFieldsByEndUser, []);
        assert.equal(owner.getSnapshot().criteria.searchTerm, 'new');
        assert.equal(owner.acceptCleanup(cleanup.revision), false);
        checks++;
        responder = () => fixtures.page([]);
        await click('Load records');
        assert(host.textContent.includes('No records returned.'));
        checks++;
        const delayed = fixtures.deferred();
        responder = () => delayed.promise;
        await act(async () => {
            [...host.querySelectorAll('button')]
                .find((b) => b.textContent === 'Load records')
                .click();
        });
        assert.equal(owner.getSnapshot().pending, true);
        await click('Cancel read');
        assert.equal(owner.getSnapshot().pending, false);
        delayed.resolve(fixtures.page([fixtures.record('rec_late', 'LATE')]));
        await act(async () => {
            await delayed.promise;
        });
        assert.equal(owner.getSnapshot().page, null);
        checks++;
        responder = () => {
            throw Error('synthetic failure');
        };
        await click('Load records');
        assert.equal(owner.getSnapshot().phase, 'error');
        assert.equal(owner.getSnapshot().pending, false);
        checks++;
        revision++;
        await act(async () => {
            owner.getSnapshot();
        });
        assert.equal(owner.getSnapshot().phase, 'retired');
        assert.equal(host.textContent, '');
        assert.equal(stale(), false);
        checks++;
        for (const ending of ['session', 'owner']) {
            let session = {},
                scopeRevision = 0;
            const replacementClient = {
                getSession: () => ({ ...session }),
                portals: {
                    listLinkedRecords: async () =>
                        fixtures.page([
                            fixtures.record('rec_private', 'PRIVATE_SUCCESSOR'),
                        ]),
                },
            };
            const replacement = createPortalListOwner({
                client: replacementClient,
                portal: fixtures.makePortal(),
                portalFieldId: 'fld_children',
                criteria,
                getScope: () => ({ ownerId: 'A', revision: scopeRevision }),
            });
            const stop = replacement.subscribe((state) => {
                if (state.phase === 'ready') {
                    if (ending === 'session') session = { visitor: 'B' };
                    else scopeRevision++;
                }
            });
            await act(async () =>
                renderer.render(
                    h(PortalList, {
                        owner: replacement,
                        readOptions,
                        render: ({ snapshot }) =>
                            h(
                                'p',
                                null,
                                snapshot.page
                                    ? JSON.stringify(
                                          snapshot.page
                                              .tableIdsToLinkedTableStates
                                      )
                                    : snapshot.phase
                            ),
                    })
                )
            );
            await act(async () => {
                assert.equal(
                    await replacement.readFirst(
                        replacement.getSnapshot().revision,
                        readOptions
                    ),
                    false
                );
            });
            assert.equal(host.textContent, 'retired');
            assert(!host.innerHTML.includes('PRIVATE_SUCCESSOR'));
            stop();
            replacement.destroy();
            checks++;
        }
        return { checks };
    } finally {
        await act(async () => renderer.unmount());
        owner.destroy();
        await window.happyDOM.close();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
    }
}
