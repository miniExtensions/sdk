import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const fixture = `
import { createElement as h, StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
import { PortalVisitorSort } from '@miniextensions/sdk/react';
let frame = {
    stamp: {
        sessionId: 'session', fieldId: 'portal', viewId: 'view-a',
        configurationRevision: 1, metadataRevision: 1, generation: 1,
    },
    fields: [{id:'title',name:'Title'}, {id:'detail',name:'Detail'}],
    criteria: [],
};
const listeners = new Set();
const commands = [];
const outcomes = [];
let submits = 0;
function publish(next) {
    frame = next;
    for (const listener of listeners) listener();
}
function allocate(command) {
    commands.push(command);
    return 'request-' + commands.length;
}
const port = {
    read: () => frame,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    apply(command) {
        if (command.stamp.generation !== frame.stamp.generation)
            return {type:'stale'};
        const requestId = allocate(command);
        const generation = frame.stamp.generation + 1;
        publish({ ...frame, stamp:{ ...frame.stamp, generation }, criteria:command.criteria });
        return {type:'allocated', requestId, generation};
    },
};
document.querySelector('form').addEventListener('submit', (event) => {
    submits++;
    event.preventDefault();
});
const root = createRoot(document.getElementById('root'));
root.render(h(StrictMode, null, h(PortalVisitorSort, {port, onOutcome: (outcome) => outcomes.push(outcome)})));
globalThis.sortFixture = {
    summary: () => ({ version, commands, outcomes, listeners:listeners.size, submits }),
    cycleViews() {
        const change = (viewId) => publish({
            ...frame,
            stamp: { ...frame.stamp, viewId, generation:frame.stamp.generation + 1 },
        });
        change('view-b');
        change('view-a');
    },
    unmount: () => root.unmount(),
};
`;

const searchFixture = `
import { PortalVisitorSearch } from '@miniextensions/sdk/react';
const searchHost = document.createElement('section');
document.querySelector('form').append(searchHost);
const searchRoot = createRoot(searchHost);
const searchListeners = new Set();
const searchCommands = [];
const searchOutcomes = [];
let scan;
let searchReadFails = false;
let searchFrame = {
    stamp: {...frame.stamp, fieldId: 'search-portal'},
    searchTerm: 'previous',
    publicationRevision: 0,
};
function publishSearch(next) {
    searchFrame = next;
    for (const listener of searchListeners) listener();
}
const searchPort = {
    read() {
        if (searchReadFails) {
            searchReadFails = false;
            throw new Error('temporary search read failure');
        }
        return searchFrame;
    },
    subscribe(listener) {
        searchListeners.add(listener);
        return () => searchListeners.delete(listener);
    },
    apply(command) {
        if (command.stamp.generation !== searchFrame.stamp.generation ||
            command.expectedSearchTerm !== searchFrame.searchTerm ||
            command.expectedPublicationRevision !== searchFrame.publicationRevision)
            return {type:'stale'};
        searchCommands.push(command);
        const unchanged = command.searchTerm === searchFrame.searchTerm;
        const generation = searchFrame.stamp.generation + Number(unchanged);
        const receipt = {type:'allocated', requestId:'search-' + searchCommands.length, generation};
        if (unchanged) {
            publishSearch({...searchFrame, stamp:{...searchFrame.stamp, generation}});
            return receipt;
        }
        const revision = searchFrame.publicationRevision + 1;
        publishSearch({
            ...searchFrame,
            searchTerm: command.searchTerm,
            publicationRevision: revision,
        });
        return {...receipt, committedPublication:{generation, revision}};
    },
};
searchRoot.render(h(StrictMode, null, h(PortalVisitorSearch, {
    port: searchPort,
    onOutcome: (outcome) => searchOutcomes.push(outcome),
    labels: {input: 'Find records', submit: 'Submit search'},
    renderScanner: ({capture, disabled}) => h('button', {
        type: 'button',
        disabled,
        'data-search-generation': searchFrame.stamp.generation,
        'data-search-revision': searchFrame.publicationRevision,
        onClick: () => { scan = capture(); },
    }, 'Open scanner'),
})));
globalThis.searchFixture = {
    summary: () => ({commands:searchCommands, outcomes:searchOutcomes, listeners:searchListeners.size}),
    failNextRead() { searchReadFails = true; },
    hasCurrentInput(value) {
        return searchHost.querySelector('input')?.value === value &&
            Number(searchHost.querySelector('[data-search-generation]')?.dataset.searchGeneration) === searchFrame.stamp.generation &&
            Number(searchHost.querySelector('[data-search-revision]')?.dataset.searchRevision) === searchFrame.publicationRevision;
    },
    rotate() {
        for (const viewId of ['view-b', 'view-a'])
            publishSearch({
                ...searchFrame,
                stamp: {...searchFrame.stamp, viewId, generation:searchFrame.stamp.generation + 1},
                publicationRevision: searchFrame.publicationRevision + 1,
            });
    },
    replaceAfterReadFailure() {
        searchReadFails = true;
        publishSearch({
            stamp: {...searchFrame.stamp, viewId:'replacement', generation:searchFrame.stamp.generation + 1},
            searchTerm: 'replacement term',
            publicationRevision: searchFrame.publicationRevision + 1,
        });
    },
    scan: (value) => scan?.(value),
    unmount: () => searchRoot.unmount(),
};
`;

const viewButtonsFixture = `
import { PortalVisitorViewButtons } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/portal-visitor-view-buttons.css';
const viewHost = document.createElement('section');
const otherViewHost = document.createElement('section');
document.querySelector('form').append(viewHost, otherViewHost);
viewHost.style.width = '9rem';
const viewRoot = createRoot(viewHost);
const otherViewRoot = createRoot(otherViewHost);
const choices = [
    { id: 'list', label: 'Long List View' },
    { id: 'grid', label: null, showBadge: true },
    { id: 'gallery', label: 'Gallery' }
];
let selection = 'list';
let ownerToken = 1;
const intents = [];
const otherIntents = [];
let visible = choices;
function renderViews() {
    viewRoot.render(h(StrictMode, null, h(PortalVisitorViewButtons, {
        views: visible, selectedViewId: selection, ownerToken,
        testId: 'view-owner-' + ownerToken,
        unnamedViewLabel: 'Vue sans nom', groupLabel: 'Primary views',
        onSelect(id) {
            intents.push(id);
            selection = id;
            renderViews();
        },
    })));
}
otherViewRoot.render(h(StrictMode, null, h(PortalVisitorViewButtons, {
    views: choices, selectedViewId: 'list', ownerToken: 'other',
    unnamedViewLabel: 'Vue sans nom', groupLabel: 'Other views',
    onSelect(id) { otherIntents.push(id); },
})));
renderViews();
globalThis.viewButtonsFixture = {
    summary: () => ({ intents, otherIntents, submits }),
    narrow(n) { visible = choices.slice(0, n); renderViews(); },
    replaceOwner(token) { ownerToken = token; renderViews(); },
    unmount() { viewRoot.unmount(); otherViewRoot.unmount(); },
};
`;

const filterFixture = `
import { PortalVisitorFilter } from '@miniextensions/sdk/react';
const filterForm = document.createElement('form');
const filterHost = document.createElement('section');
filterForm.append(filterHost);
document.body.append(filterForm);
const filterRoot = createRoot(filterHost);
const filterListeners = new Set();
const filterCommands = [];
const filterOutcomes = [];
const heldSelectKeys = [];
let filterFormSubmits = 0;
filterForm.addEventListener('submit', (event) => {
    filterFormSubmits++;
    event.preventDefault();
});
filterForm.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && event.target instanceof HTMLSelectElement && event.target.multiple)
        heldSelectKeys.push({repeat: event.repeat, trusted: event.isTrusted});
});
const currentTitle = {
    fieldType: 'singleLineText', type: 'contains',
    idOrName: {type: 'id', id: 'title'}, value: 'Keep',
};
const quickChoices = [{value: 'red', label: 'Red'}, {value: 'blue', label: 'Blue'}, {value: 'green', label: 'Green'}, {value: 'yellow', label: 'Yellow'}];
let filterFrame = {
    stamp: {...frame.stamp, fieldId: 'filter-portal'},
    fields: [{
        id: 'title', name: 'Title',
        operators: [{label: 'Contains', setting: currentTitle, operand: {kind: 'text'}}],
    }, {
        id: 'status', name: 'Status',
        operators: [{label: 'Is', operand: {kind: 'choice', choices: quickChoices},
            setting: {fieldType: 'singleSelect', type: 'is', idOrName: {type: 'id', id: 'status'}, value: 'red'}}],
    }, {
        id: 'labels', name: 'Labels',
        operators: [{label: 'Any of', operand: {kind: 'choices', choices: quickChoices},
            setting: {fieldType: 'multipleSelects', type: 'hasAnyOf', idOrName: {type: 'id', id: 'labels'}, value: []}}],
    }],
    dropdownFieldIds: ['status', 'labels'],
    criteria: {
        logicalOperator: 'or',
        conditions: [{
            id: 'saved', type: 'singleCondition',
            setting: {...currentTitle, idOrName: {type: 'name', name: 'Former title'}},
        }],
    },
    effectiveSettings: {saved: currentTitle},
};
function publishFilter(next) {
    filterFrame = next;
    for (const listener of filterListeners) listener();
}
const filterPort = {
    read: () => filterFrame,
    subscribe(listener) {
        filterListeners.add(listener);
        return () => filterListeners.delete(listener);
    },
    apply(command) {
        if (command.stamp.generation !== filterFrame.stamp.generation)
            return {type: 'stale'};
        filterCommands.push(command);
        const generation = filterFrame.stamp.generation + 1;
        publishFilter({
            ...filterFrame, stamp: {...filterFrame.stamp, generation},
            criteria: command.criteria, effectiveSettings: {},
        });
        return {type: 'allocated', requestId: 'filter-' + filterCommands.length, generation};
    },
};
filterRoot.render(h(StrictMode, null, h(PortalVisitorFilter, {
    port: filterPort, showDropdowns: true, onOutcome: (outcome) => filterOutcomes.push(outcome),
})));
globalThis.filterFixture = {
    summary: () => ({commands: filterCommands, outcomes: filterOutcomes, listeners: filterListeners.size, submits: filterFormSubmits, heldSelectKeys}),
    seedHeldChoice() {
        const criteria = filterFrame.criteria ?? {logicalOperator: 'and', conditions: []};
        publishFilter({ ...filterFrame, stamp: {...filterFrame.stamp, generation: filterFrame.stamp.generation + 1},
            criteria: {...criteria, conditions: [{id:'held-seed', type:'singleCondition', setting:{fieldType:'multipleSelects', type:'hasAnyOf', idOrName:{type:'id',id:'labels'}, value:['red']}}, ...criteria.conditions]} });
    },
    cycleViews() {
        for (const viewId of ['view-b', 'view-a'])
            publishFilter({...filterFrame, stamp: {...filterFrame.stamp, viewId, generation: filterFrame.stamp.generation + 1}});
    },
    unmount: () => filterRoot.unmount(),
};
`;

async function checkHeldQuickFilter(page) {
    const labels = page
        .getByRole('group', { name: 'Quick filters' })
        .getByRole('listbox', { name: 'Labels' });
    const summary = () =>
        page.evaluate(() => globalThis.filterFixture.summary());
    const waitForCount = (count) =>
        page.waitForFunction(
            (expected) =>
                globalThis.filterFixture.summary().commands.length === expected,
            count
        );
    const initial = await summary();
    const offset = initial.commands.length;
    await page.evaluate(() => globalThis.filterFixture.seedHeldChoice());
    await page.waitForFunction(
        () => document.querySelector('select[multiple]')?.value === 'red'
    );
    await labels.focus();
    const retained = await labels.elementHandle();
    assert.ok(retained);
    try {
        await page.keyboard.down('ArrowDown');
        await waitForCount(offset + 1);
        await page.keyboard.down('ArrowDown');
        await waitForCount(offset + 2);
        assert.equal(
            await retained.evaluate(
                (element) => element === document.activeElement
            ),
            true
        );
        await page.evaluate(() => globalThis.filterFixture.cycleViews());
        await page.keyboard.down('ArrowDown');
        await page.getByRole('status').waitFor({ state: 'visible' });
        assert.equal((await summary()).commands.length, offset + 2);
    } finally {
        await page.keyboard.up('ArrowDown');
        await retained.dispose();
    }
    await page.keyboard.press('ArrowDown');
    await waitForCount(offset + 3);
    const end = await summary();
    assert.deepEqual(
        end.commands
            .slice(offset)
            .map((command) => command.criteria.conditions[0].setting.value),
        [['blue'], ['green'], ['yellow']]
    );
    assert.deepEqual(
        end.heldSelectKeys.slice(initial.heldSelectKeys.length),
        [false, true, true, false].map((repeat) => ({ repeat, trusted: true }))
    );
    assert.equal(end.submits, 0);
    return {
        freshAndRepeatedCommands: 3,
        retiredRepeatRefused: true,
        trustedKeys: true,
    };
}

async function checkQuickFilter(page, startingCriteria) {
    const root = page.getByRole('group', { name: 'Quick filters' });
    const status = root.getByRole('combobox', { name: 'Status' });
    const labels = root.getByRole('listbox', { name: 'Labels' });
    const summary = () =>
        page.evaluate(() => globalThis.filterFixture.summary());
    const waitForCount = (count) =>
        page.waitForFunction(
            (expected) =>
                globalThis.filterFixture.summary().commands.length === expected,
            count
        );
    const choose = async (control, values, count) => {
        await control.dispatchEvent('pointerdown', {
            button: 0,
            isPrimary: true,
        });
        await control.selectOption(values);
        await waitForCount(count);
    };
    await status.waitFor();
    await labels.waitFor();
    await status.focus();
    const retained = await status.elementHandle();
    assert.ok(retained);
    try {
        await page.evaluate(() => globalThis.filterFixture.cycleViews());
        assert.equal(
            await retained.evaluate(
                (element) =>
                    element.isConnected && element === document.activeElement
            ),
            true
        );
        await retained.selectOption('red');
        assert.equal((await summary()).commands.length, 2);
        assert.match(await page.getByRole('status').textContent(), /changed/);
    } finally {
        await retained.dispose();
    }
    await choose(status, 'red', 3);
    let current = await summary();
    assert.deepEqual(current.commands[2].criteria.conditions[0].setting, {
        fieldType: 'singleSelect',
        type: 'is',
        idOrName: { type: 'id', id: 'status' },
        value: 'red',
    });
    assert.deepEqual(
        current.commands[2].criteria.conditions.slice(1),
        startingCriteria.conditions
    );
    await choose(labels, ['blue', 'red'], 4);
    current = await summary();
    assert.deepEqual(current.commands[3].criteria.conditions[0].setting.value, [
        'red',
        'blue',
    ]);
    await root
        .getByRole('button', { name: 'Clear filters Labels' })
        .press('Enter');
    await waitForCount(5);
    assert.equal(
        await labels.evaluate((element) => element === document.activeElement),
        true
    );
    const hadStatus = (await summary()).commands[2].criteria;
    assert.deepEqual((await summary()).commands[4].criteria, hadStatus);
    await choose(status, '', 6);
    const end = await summary();
    assert.deepEqual(end.commands[5].criteria, startingCriteria);
    assert.equal(end.submits, 0);
    return {
        commands: 4,
        staleGestureRefused: true,
        priorTreeRestored: true,
        clearFocus: true,
        formSubmits: 0,
    };
}

async function checkFilter(page) {
    const trigger = page.getByRole('button', { name: 'Filter', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Filter records' });
    const firstValue = dialog.getByRole('textbox', { name: 'Value' }).first();
    const done = dialog.getByRole('button', { name: 'Done', exact: true });
    const summary = () =>
        page.evaluate(() => globalThis.filterFixture.summary());
    const open = async () => {
        await trigger.press('Enter');
        await dialog.waitFor({ state: 'visible' });
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Filter records'
        );
    };
    const closed = async (outcomes) => {
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
            (count) =>
                globalThis.filterFixture.summary().outcomes.length === count,
            outcomes
        );
        assert.equal(
            await trigger.evaluate(
                (button) => button === document.activeElement
            ),
            true
        );
    };
    await open();
    assert.equal(await firstValue.inputValue(), 'Keep');
    await firstValue.press('Enter');
    const afterOperandEnter = await summary();
    await firstValue.fill('Transient change');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds);
    await page.mouse.click(bounds.x + 4, bounds.y + 4);
    assert.deepEqual(
        {
            operandEnterSubmits: afterOperandEnter.submits,
            operandEnterCommands: afterOperandEnter.commands.length,
            paddingKeptOpen: await dialog.isVisible(),
            commandsAfterPadding: (await summary()).commands.length,
        },
        {
            operandEnterSubmits: 0,
            operandEnterCommands: 0,
            paddingKeptOpen: true,
            commandsAfterPadding: 0,
        }
    );
    await firstValue.fill('Keep');
    await done.press('Enter');
    await closed(1);
    assert.deepEqual((await summary()).commands, []);
    assert.deepEqual((await summary()).outcomes, [{ type: 'unchanged' }]);

    await open();
    await firstValue.fill('Changed');
    const add = dialog.getByRole('button', { name: 'Add group', exact: true });
    await add.click();
    const topLevel = dialog.locator('fieldset').first();
    await topLevel
        .getByRole('button', { name: 'Add group', exact: true })
        .click();
    const secondLevel = topLevel.locator('fieldset');
    assert.equal(
        await secondLevel
            .getByRole('button', { name: 'Add group', exact: true })
            .isDisabled(),
        true
    );
    await secondLevel
        .getByRole('button', { name: 'Add condition', exact: true })
        .click();
    await secondLevel
        .getByRole('textbox', { name: 'Value' })
        .fill('Nested condition');
    assert.deepEqual((await summary()).commands, []);
    await page.keyboard.press('Escape');
    await closed(2);
    const accepted = await summary();
    assert.equal(accepted.commands.length, 1);
    const [first, group] = accepted.commands[0].criteria.conditions;
    assert.deepEqual(first.setting.idOrName, { type: 'id', id: 'title' });
    assert.equal(first.setting.value, 'Changed');
    assert.equal(
        group.conditions[0].conditions[0].setting.value,
        'Nested condition'
    );
    assert.deepEqual(accepted.outcomes[1], {
        type: 'allocated',
        requestId: 'filter-1',
        generation: accepted.commands[0].stamp.generation + 1,
    });

    await open();
    await firstValue.fill('Stale change');
    await page.evaluate(() => globalThis.filterFixture.cycleViews());
    await dialog.getByRole('status').waitFor({ state: 'visible' });
    await done.press('Enter');
    await closed(3);
    assert.equal((await summary()).commands.length, 1);
    assert.equal((await summary()).outcomes.at(-1).type, 'stale');

    await open();
    await firstValue.fill('Backdrop change');
    const backdrop = await dialog.boundingBox();
    assert.ok(backdrop && backdrop.x > 4);
    await page.mouse.click(backdrop.x - 4, backdrop.y + 4);
    await closed(4);
    const dismissed = await summary();
    assert.equal(dismissed.commands.length, 2);
    assert.equal(
        dismissed.commands[1].criteria.conditions[0].setting.value,
        'Backdrop change'
    );
    assert.equal(dismissed.outcomes.at(-1).requestId, 'filter-2');
    assert.equal(dismissed.submits, 0);
    const quick = await checkQuickFilter(page, dismissed.commands[1].criteria);
    const heldQuick = await checkHeldQuickFilter(page);
    await page.evaluate(() => globalThis.filterFixture.unmount());
    assert.equal((await summary()).listeners, 0);
    return {
        allocation: 'filter-1',
        editAndRevert: 'unchanged',
        activeGroupDepth: 2,
        staleDraft: 'refused',
        paddingIsInert: true,
        operandEnterSubmits: 0,
        backdropAllocation: 'filter-2',
        quick,
        heldQuick,
        focusRestored: true,
        cleanup: 'completed',
    };
}

async function checkViewButtons(page) {
    const root = page.getByRole('group', { name: 'Primary views' });
    const other = page.getByRole('group', { name: 'Other views' });
    await root.waitFor();
    await other.waitFor();
    const buttons = root.getByRole('button');
    const summary = () =>
        page.evaluate(() => globalThis.viewButtonsFixture.summary());
    assert.deepEqual(await buttons.allTextContents(), [
        'Long List View',
        'Vue sans nom',
        'Gallery',
    ]);
    const first = buttons.first();
    const second = buttons.nth(1);
    const third = buttons.nth(2);
    assert.equal(await first.getAttribute('aria-pressed'), 'true');
    assert.equal(await second.getAttribute('aria-pressed'), 'false');
    assert.equal(await second.locator('[aria-hidden=true]').count(), 1);
    assert.equal((await summary()).intents.length, 0);
    const computed = await root.evaluate((element) => ({
        wrapping: getComputedStyle(element).flexWrap,
        rows: [...element.querySelectorAll('button')].map(
            (button) => button.offsetTop
        ),
    }));
    assert.equal(computed.wrapping, 'wrap');
    assert.ok(new Set(computed.rows).size > 1);
    const selectedBackground = await first.evaluate(
        (button) => getComputedStyle(button).backgroundColor
    );
    assert.notEqual(selectedBackground, 'rgba(0, 0, 0, 0)');
    const replaceOwner = async (token) => {
        await page.evaluate(
            (value) => globalThis.viewButtonsFixture.replaceOwner(value),
            token
        );
        await page.getByTestId('view-owner-' + token).waitFor();
    };
    const bounds = await second.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
    );
    await page.mouse.down();
    try {
        await replaceOwner(2);
    } finally {
        await page.mouse.up();
    }
    assert.deepEqual((await summary()).intents, []);
    await second.focus();
    await page.keyboard.down('Space');
    try {
        await replaceOwner(3);
        await replaceOwner(2);
    } finally {
        await page.keyboard.up('Space');
    }
    assert.deepEqual((await summary()).intents, []);
    assert.equal(
        await second.evaluate((button) => button === document.activeElement),
        true
    );
    await first.click();
    assert.deepEqual((await summary()).intents, []);
    await page.keyboard.press('Tab');
    assert.equal(
        await second.evaluate((button) => button === document.activeElement),
        true
    );
    assert.equal(
        await second.evaluate(
            (button) => getComputedStyle(button).outlineStyle
        ),
        'solid'
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        () => document.activeElement?.getAttribute('aria-pressed') === 'true'
    );
    assert.equal(
        await second.evaluate((button) => button === document.activeElement),
        true
    );
    await page.keyboard.press('Space');
    assert.deepEqual((await summary()).intents, ['grid']);
    await page.keyboard.press('Tab');
    assert.equal(
        await third.evaluate((button) => button === document.activeElement),
        true
    );
    await page.keyboard.press('Space');
    await page.waitForFunction(
        () => globalThis.viewButtonsFixture.summary().intents.length === 2
    );
    await first.click();
    await page.waitForFunction(
        () => globalThis.viewButtonsFixture.summary().intents.length === 3
    );
    assert.deepEqual((await summary()).intents, ['grid', 'gallery', 'list']);
    assert.equal(
        await other
            .getByRole('button', { name: 'Long List View' })
            .getAttribute('aria-pressed'),
        'true'
    );
    assert.deepEqual((await summary()).otherIntents, []);
    assert.equal((await summary()).submits, 0);
    const retired = await third.elementHandle();
    await page.evaluate(() => globalThis.viewButtonsFixture.narrow(1));
    await root.waitFor({ state: 'detached' });
    await retired.evaluate((button) => button.click());
    await retired.dispose();
    await page.evaluate(() => globalThis.viewButtonsFixture.narrow(0));
    assert.equal(await root.count(), 0);
    assert.deepEqual((await summary()).intents, ['grid', 'gallery', 'list']);
    await page.evaluate(() => globalThis.viewButtonsFixture.unmount());
    await other.waitFor({ state: 'detached' });
    return { intents: 3, tabFocus: true, formSubmits: 0, cleanup: 'completed' };
}

async function checkSearch(page) {
    const entry = page.getByRole('textbox', { name: 'Find records' });
    const scanner = page.getByRole('button', { name: 'Open scanner' });
    const search = () =>
        page.evaluate(() => globalThis.searchFixture.summary());
    const waitForTerm = (term) =>
        page.waitForFunction(
            (value) => globalThis.searchFixture.hasCurrentInput(value),
            term
        );
    await entry.fill('  café  ');
    assert.deepEqual((await search()).commands, []);
    await entry.press('Enter');
    await waitForTerm('  café  ');
    const submit = page.getByRole('button', { name: 'Submit search' });
    await page.evaluate(() => globalThis.searchFixture.failNextRead());
    await submit.press('Enter');
    assert.equal((await search()).commands.length, 1);
    assert.equal(await submit.isEnabled(), true);
    await submit.press('Enter');
    assert.equal((await search()).commands.length, 2);
    await page.waitForFunction(
        () => globalThis.searchFixture.summary().outcomes.length === 2
    );
    await scanner.press('Enter');
    await page.evaluate(() => {
        globalThis.searchFixture.rotate();
        globalThis.searchFixture.scan('stale camera result');
    });
    assert.equal((await search()).commands.length, 2);
    await waitForTerm('  café  ');
    await scanner.press('Enter');
    await page.evaluate(() => {
        globalThis.searchFixture.scan('  001-α  ');
        globalThis.searchFixture.scan('duplicate camera result');
    });
    await waitForTerm('  001-α  ');
    assert.equal((await search()).commands.length, 3);
    await page.getByRole('button', { name: 'Clear search' }).press('Enter');
    await waitForTerm('');
    assert.equal(await entry.inputValue(), '');
    await page.waitForFunction(
        () => globalThis.searchFixture.summary().outcomes.length === 4
    );
    await scanner.press('Enter');
    await page.evaluate(() =>
        globalThis.searchFixture.replaceAfterReadFailure()
    );
    assert.equal(await entry.inputValue(), '');
    await submit.press('Enter');
    await waitForTerm('replacement term');
    assert.equal((await search()).commands.length, 4);
    await page.evaluate(() =>
        globalThis.searchFixture.scan('retired camera result')
    );
    assert.equal((await search()).commands.length, 4);
    await submit.press('Enter');
    await page.waitForFunction(
        () => globalThis.searchFixture.summary().outcomes.length === 5
    );
    const { commands, outcomes } = await search();
    assert.deepEqual(
        commands.map(
            ({
                source,
                expectedSearchTerm,
                expectedPublicationRevision,
                searchTerm,
            }) => [
                source,
                expectedSearchTerm,
                expectedPublicationRevision,
                searchTerm,
            ]
        ),
        [
            ['submit', 'previous', 0, '  café  '],
            ['submit', '  café  ', 1, '  café  '],
            ['scan', '  café  ', 3, '  001-α  '],
            ['clear', '  001-α  ', 4, ''],
            ['submit', 'replacement term', 6, 'replacement term'],
        ]
    );
    assert.deepEqual(
        outcomes.map((outcome) => [
            outcome.type,
            outcome.committedPublication?.revision,
        ]),
        [
            ['allocated', 1],
            ['allocated', undefined],
            ['allocated', 4],
            ['allocated', 5],
            ['allocated', undefined],
        ]
    );
    assert.equal(outcomes[1].generation, outcomes[0].generation + 1);
    assert.equal(commands.at(-1).stamp.viewId, 'replacement');
    await page.evaluate(() => globalThis.searchFixture.unmount());
    assert.equal((await search()).listeners, 0);
    return {
        commands: commands.length,
        staleScanRejected: true,
        transientReadRecovered: true,
        replacementNotificationRecovered: true,
        sameTermGenerationReported: true,
        cleanup: 'completed',
    };
}

/** Exercise trusted keyboard events on an installed, synthetic host fixture. */
export async function checkPortalVisitorSortBrowser({
    browser,
    consumer,
    evidence,
    expectedReactVersion,
    includeSearch = false,
    includeViewButtons = false,
    includeFilter = false,
}) {
    const scratch = mkdtempSync(join(consumer, 'visitor-sort-browser-'));
    let context;
    let server;
    const external = [];
    const requests = [];
    const errors = [];
    const cleanup = {};
    Object.assign(evidence, {
        external,
        requests,
        errors,
        cleanup,
        passed: false,
    });
    try {
        const entry = join(scratch, 'fixture.mjs');
        writeFileSync(
            entry,
            fixture +
                (includeSearch ? searchFixture : '') +
                (includeViewButtons ? viewButtonsFixture : '') +
                (includeFilter ? filterFixture : '')
        );
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'iife',
            outfile: join(scratch, 'app.js'),
            metafile: true,
            write: false,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        const app = bundle.outputFiles.find((file) =>
            file.path.endsWith('/app.js')
        ).contents;
        const css = bundle.outputFiles.find((file) =>
            file.path.endsWith('/app.css')
        )?.contents;
        if (includeViewButtons) assert.ok(css);
        server = createServer((request, response) => {
            if (request.url === '/') {
                response.setHeader('content-type', 'text/html; charset=utf-8');
                response.end(
                    '<!doctype html><html><head><title>Portal visitor query fixture</title><link rel="icon" href="data:,">' +
                        (css ? '<link rel="stylesheet" href="/app.css">' : '') +
                        '<script defer src="/app.js"></script></head><body><form><main id="root"></main></form></body></html>'
                );
            } else if (request.url === '/app.js') {
                response.setHeader(
                    'content-type',
                    'text/javascript; charset=utf-8'
                );
                response.end(app);
            } else if (request.url === '/app.css' && css) {
                response.setHeader('content-type', 'text/css; charset=utf-8');
                response.end(css);
            } else {
                response.writeHead(404).end();
            }
        });
        await new Promise((done, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', done);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        evidence.origin = origin;
        context = await browser.newContext({ serviceWorkers: 'block' });
        context.setDefaultTimeout(5000);
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                ['/', '/app.js', ...(css ? ['/app.css'] : [])].includes(
                    url.pathname
                )
            )
                return route.continue();
            external.push(url.href);
            return route.abort();
        });
        context.on('request', (request) => {
            if (['xhr', 'fetch'].includes(request.resourceType()))
                requests.push(request.url());
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (['warning', 'error'].includes(message.type()))
                errors.push(message.text());
        });
        await page.goto(origin);
        if (includeViewButtons)
            evidence.viewButtons = await checkViewButtons(page);
        const summary = () =>
            page.evaluate(() => globalThis.sortFixture.summary());
        const trigger = page.getByRole('button', { name: 'Sort', exact: true });
        const dialog = page.getByRole('dialog');
        const add = dialog.getByRole('button', { name: 'Add sort condition' });
        const done = dialog.getByRole('button', { name: 'Done' });
        const open = async () => {
            await trigger.press('Enter');
            await dialog.waitFor({ state: 'visible' });
            assert.equal(
                await page.evaluate(() => document.activeElement.textContent),
                'Sort records'
            );
        };
        await open();
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .press('Shift+Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Done'
        );
        await page.keyboard.press('Tab');
        assert.equal(
            await page.evaluate(() => document.activeElement.textContent),
            'Close'
        );
        await add.press('Enter');
        await add.press('Enter');
        assert.equal(
            await page.evaluate(() =>
                document.activeElement.getAttribute('aria-label')
            ),
            'Field 2'
        );
        await dialog
            .getByRole('combobox', { name: 'Direction 2' })
            .selectOption('desc');
        assert.deepEqual(
            await dialog
                .locator('select[aria-label^="Field"]')
                .evaluateAll((selects) =>
                    selects.map((select) => select.value)
                ),
            ['title', 'detail']
        );
        assert.deepEqual((await summary()).commands, []);
        await done.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
            () => document.activeElement.textContent === 'Sort'
        );
        assert.deepEqual(
            (await summary()).commands[0].criteria.map(
                (rule) => rule.idOrName.id
            ),
            ['title', 'detail']
        );
        assert.deepEqual(
            (await summary()).commands[0].criteria.map((rule) => rule.type),
            ['asc', 'desc']
        );
        assert.deepEqual((await summary()).outcomes, [
            { type: 'allocated', requestId: 'request-1', generation: 2 },
        ]);

        await open();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await summary()).commands.length, 1);
        assert.equal((await summary()).outcomes.at(-1).type, 'unchanged');

        await open();
        await dialog
            .getByRole('button', { name: 'Delete sort condition 1' })
            .press('Enter');
        await page.evaluate(() => globalThis.sortFixture.cycleViews());
        await dialog.getByRole('status').waitFor({ state: 'visible' });
        await done.press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal((await summary()).commands.length, 1);
        assert.equal((await summary()).outcomes.at(-1).type, 'stale');

        await open();
        await dialog
            .getByRole('button', { name: 'Delete sort condition 1' })
            .press('Enter');
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        if (includeSearch) {
            try {
                evidence.search = await checkSearch(page);
            } catch (error) {
                evidence.search = await page.evaluate(() =>
                    globalThis.searchFixture.summary()
                );
                throw error;
            }
        }
        if (includeFilter) evidence.filter = await checkFilter(page);
        const end = await summary();
        assert.equal(end.version, expectedReactVersion);
        assert.deepEqual(
            end.commands.map((command) =>
                command.criteria.map((rule) => rule.idOrName.id)
            ),
            [['title', 'detail'], ['detail']]
        );
        assert.equal(end.commands[1].criteria[0].type, 'desc');
        assert.equal(end.listeners, 0);
        assert.equal(end.submits, 0);
        assert.deepEqual(external, []);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        await page.evaluate(() => globalThis.sortFixture.unmount());
        Object.assign(evidence, {
            react: end.version,
            outcomes: end.outcomes,
            passed: true,
        });
    } finally {
        try {
            if (context) {
                await context.close();
                cleanup.context = 'completed';
            }
        } finally {
            try {
                if (server?.listening) {
                    server.closeAllConnections();
                    await new Promise((done, reject) =>
                        server.close((error) =>
                            error ? reject(error) : done()
                        )
                    );
                    cleanup.server = 'completed';
                }
            } finally {
                rmSync(scratch, { recursive: true });
                cleanup.scratch = 'completed';
            }
        }
    }
}
