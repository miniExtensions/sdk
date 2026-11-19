// Ports the two-record control from BorrowedNativePortalList.test.tsx.
// Each run imports its React and SDK from the same installed consumer fixture.
export const readonlyPortalRecordsConsumer = String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createListFixture } from './fixture.mjs';

const require = createRequire(import.meta.url);
const [, , format, happyDomPath] = process.argv;
const load = name => format === 'esm' ? import(name) : require(name);
const React = await load('react');
const { ReadonlyPortalRecords } = await load('@miniextensions/sdk/react');
assert.equal(typeof ReadonlyPortalRecords, 'function', 'The installed SDK owns both layouts');
const { renderToString } = await load('react-dom/server');
const fixture = createListFixture(await load('@miniextensions/sdk/ui'));
const h = React.createElement;
let subscriptions = 0;
let active = 0;
const scope = {
    getSnapshot: () => fixture.scope.getSnapshot(),
    subscribe(listener) {
        subscriptions++;
        active++;
        const stop = fixture.scope.subscribe(listener);
        return () => { active--; stop(); };
    },
};
let layout = 'list';
let openActions;
let status;
let commandIsCurrent;
let restoreFocus;
let releaseOpen;
let holdOpen = false;
let preferenceWrites = 0;
let legacyOpens = 0;
const hiddenColumns = Object.freeze({ fld_detail: true });
const columnWidths = Object.freeze({ fld_title: 211 });
const grid = {
    ready: true,
    preferenceScopeKey: 'portal/field/view',
    primaryFieldId: 'fld_title',
    hiddenColumns,
    columnWidths,
    allowHideColumns: true,
    onFieldHiddenChange() { preferenceWrites++; },
    onColumnWidthCommit() { preferenceWrites++; },
    // A caller may pass a structurally wider legacy Grid options object.
    onOpenRecord() { legacyOpens++; },
    openRecordTestIds: { rec_B: 'legacy-open' },
};
const renderers = {
    renderSingleLineTextField(field) {
        assert.equal(field.capability.type, 'readonly');
        return h('span', null, String(field.value ?? ''));
    },
};
const element = () => h(ReadonlyPortalRecords, {
    scope, layout, grid,
    openActions: openActions && { scope, byRecordId: openActions },
    renderers, label: 'Accepted records', status,
});
function admitChildren() {
    const snapshot = scope.getSnapshot();
    return new Map(snapshot.rows.map(row => [row.recordId, {
        revision: snapshot.revision,
        testId: 'open-' + row.recordId,
        activate(isCurrent, returnFocus) {
            commandIsCurrent = isCurrent;
            restoreFocus = returnFocus;
            releaseOpen = async () => {
                if (isCurrent()) await snapshot.actions.openChild(row.recordId);
                returnFocus();
            };
            if (!holdOpen && isCurrent()) void snapshot.actions.openChild(row.recordId);
        },
    }]));
}

const { Window } = await import(happyDomPath);
const window = new Window({ url: 'https://consumer.invalid/records' });
const previous = new Map();
let requests = 0;
let submits = 0;
const globals = {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => { requests++; throw new Error('Unexpected rendering request'); },
};
let root;
try {
    openActions = admitChildren();
    const html = renderToString(element());
    assert(html.indexOf('Beta') < html.indexOf('Alpha'));
    for (const [key, value] of Object.entries(globals)) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const container = window.document.createElement('form');
    container.innerHTML = html;
    container.addEventListener('submit', event => { submits++; event.preventDefault(); });
    window.document.body.append(container);
    const originalRow = container.querySelector('li');
    const hydrationErrors = [];
    const { hydrateRoot } = await load('react-dom/client');
    await React.act(async () => {
        root = hydrateRoot(container, element(), { onRecoverableError: error => hydrationErrors.push(String(error)) });
    });
    assert.equal(container.querySelector('li'), originalRow);
    assert.deepEqual(hydrationErrors, []);
    function assertOrder(selector) {
        assert.deepEqual([...container.querySelectorAll(selector)].map(row => row.dataset.recordId), ['rec_B', 'rec_A']);
        assert.equal(subscriptions, 1);
        assert.equal(active, 1);
        assert.equal(fixture.subscriptions, 1);
    }
    const click = button => React.act(async () => {
        button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const oldOpen = container.querySelector('[data-testid="open-rec_B"]');
    assert.equal(oldOpen.type, 'button');
    assertOrder('li');
    assert.match(originalRow.textContent, /B detail/);

    layout = 'grid';
    await React.act(async () => root.render(element()));
    assertOrder('tbody tr');
    assert.equal(container.querySelector('th[data-field-id="fld_title"]').style.width, '211px');
    assert.equal(container.querySelector('[data-field-id="fld_detail"]'), null);
    assert.equal(container.querySelector('input,textarea,[contenteditable="true"]'), null);
    await click(oldOpen);
    assert.equal(fixture.calls.length, 0);

    // A newly accepted frame must retire the old registrations in both layouts.
    await React.act(async () => fixture.replace());
    assert.equal(container.querySelector('[data-testid="open-rec_B"]'), null);
    assert.equal(container.querySelector('[data-testid="legacy-open"]'), null);
    layout = 'list';
    await React.act(async () => root.render(element()));
    assertOrder('li');
    assert.equal(container.querySelector('[data-testid="open-rec_B"]'), null);
    assert.match(container.querySelector('li').textContent, /B detail/);
    openActions = admitChildren();
    await React.act(async () => root.render(element()));
    const listOpen = container.querySelector('[data-testid="open-rec_B"]');
    const siblingOpen = container.querySelector('[data-testid="open-rec_A"]');
    const originalActions = openActions;
    const registrationRevision = scope.getSnapshot().revision;
    holdOpen = true;
    await click(siblingOpen);
    const siblingIsCurrent = commandIsCurrent;
    await click(listOpen);
    const oldRegistrationIsCurrent = commandIsCurrent;
    const completeOldOpen = releaseOpen;
    openActions = new Map(originalActions);
    await React.act(async () => root.render(element()));
    assert.equal(oldRegistrationIsCurrent(), true, 'An equivalent map preserves the current registration');

    openActions = new Map(originalActions).set('rec_B', { ...originalActions.get('rec_B') });
    await React.act(async () => root.render(element()));
    assert.equal(oldRegistrationIsCurrent(), false);
    openActions = originalActions;
    await React.act(async () => root.render(element()));
    assert.equal(scope.getSnapshot().revision, registrationRevision);
    assert.equal(container.querySelector('[data-testid="open-rec_B"]'), listOpen);
    assert.equal(siblingIsCurrent(), true, 'Replacing one row keeps its sibling registration current');
    const otherFocus = window.document.createElement('button');
    window.document.body.append(otherFocus);
    otherFocus.focus();
    await completeOldOpen();
    const staleRegistration = {
        oldRegistrationCurrent: oldRegistrationIsCurrent(),
        opened: fixture.calls.length,
        focusStayed: window.document.activeElement === otherFocus,
    };
    assert.deepEqual(staleRegistration, { oldRegistrationCurrent: false, opened: 0, focusStayed: true }, 'A restored registration must not revive its old command');
    holdOpen = false;
    await click(listOpen);
    assert.deepEqual(fixture.calls.map(call => call.recordId), ['rec_B']);
    restoreFocus();
    assert.equal(window.document.activeElement, listOpen);
    const freshRegistration = { opened: fixture.calls.length, focusRestored: window.document.activeElement === listOpen };

    layout = 'grid';
    await React.act(async () => root.render(element()));
    assertOrder('tbody tr');
    assert.equal(container.querySelector('th[data-field-id="fld_title"]').style.width, '211px');
    assert.equal(container.querySelector('[data-field-id="fld_detail"]'), null);
    const freshOpen = container.querySelector('[data-testid="open-rec_B"]');
    assert.equal(freshOpen.type, 'button');
    holdOpen = true;
    await click(freshOpen);
    assert.deepEqual(fixture.calls.map(call => call.recordId), ['rec_B']);
    assert.equal(commandIsCurrent(), true);
    restoreFocus();
    assert.equal(window.document.activeElement, freshOpen);
    grid.preferenceScopeKey = 'portal/field/other-view';
    await React.act(async () => root.render(element()));
    grid.preferenceScopeKey = 'portal/field/view';
    await React.act(async () => root.render(element()));
    assert.equal(commandIsCurrent(), false);
    assert.equal(freshOpen.isConnected, true, 'A retired scope key cannot revive its connected trigger');
    holdOpen = true;
    await click(freshOpen);
    assert.equal(commandIsCurrent(), true);
    grid.ready = false;
    await React.act(async () => root.render(element()));
    assert.equal(freshOpen.isConnected, false);
    assert.equal(commandIsCurrent(), false);
    assert.equal(container.querySelector('table'), null);
    grid.ready = true;
    await React.act(async () => root.render(element()));
    assert.notEqual(container.querySelector('[data-testid="open-rec_B"]'), freshOpen);
    layout = 'list';
    await React.act(async () => root.render(element()));
    assertOrder('li');
    assert.equal(commandIsCurrent(), false);
    restoreFocus();
    assert.notEqual(window.document.activeElement, freshOpen);
    assert.equal(requests, 0);
    assert.equal(submits, 0);
    assert.equal(preferenceWrites, 0);
    assert.equal(legacyOpens, 0);
    assert.deepEqual(fixture.calls.map(call => call.recordId), ['rec_B']);
    assert.equal(window.localStorage.length, 0);
    assert.equal(window.sessionStorage.length, 0);
    for (const [kind, role] of [['loading', 'status'], ['unavailable', 'status'], ['error', 'alert']]) {
        status = { kind, message: kind + ' records' };
        await React.act(async () => root.render(element()));
        assert.equal(container.querySelector('[role="' + role + '"]').textContent, status.message);
        assert.equal(container.querySelector('li,table,[data-testid="open-rec_B"]'), null);
        assert.equal(subscriptions, 1);
    }
    status = undefined;
    await React.act(async () => {
        fixture.replace({ ...fixture.initial, records: [] });
        root.render(element());
    });
    assert.deepEqual([...container.querySelectorAll('h3')].map(node => node.textContent), ['Name label', 'Detail label']);
    assert.equal(container.querySelector('li,button'), null);
    await React.act(async () => root.unmount());
    root = undefined;
    assert.equal(active, 0);
    assert.equal(fixture.subscriptions, 1, 'Unmount must keep the host-owned scope alive');
    console.log(JSON.stringify({ format, react: React.version, subscriptions, opens: fixture.calls.length, requests, preferenceWrites, submits, staleRegistration, freshRegistration }));
} finally {
    if (root) await React.act(async () => root.unmount());
    fixture.scope.destroy();
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    await window.happyDOM.close();
}
`;
