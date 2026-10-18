import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { browserMain } from './build-rich-text-browser-proof.mjs';
import { richTextLoadedFixture } from './rich-text-consumer-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

// Synthetic DOM checks of the actual serialized proof program and SDK source.
// These do not qualify native selection, clipboard, layout or screen readers.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { outputFiles } = await build({
    stdin: {
        resolveDir: root,
        contents: `
import React from 'react';
import {createRoot as actualCreateRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createMiniExtensionsClient} from './src/runtime/index.ts';
import {createFormFieldBindings as actualBindings} from './src/forms/index.ts';
import {createPortalListOwner} from './src/portals/index.ts';
import {createFormRenderScope,createPortalRenderScope} from './src/ui/index.ts';
import {AirtableForm,AirtableGrid,AirtableList,RichTextField,renderRichTextField} from './src/react/index.ts';
let bindingsCreated = 0;
const createFormFieldBindings = (...args) => {
    const bindings = actualBindings(...args);
    if (++bindingsCreated === 2) {
        if (window.testFault === 'replacement') bindings.reload = async () => false;
        if (window.testFault === 'retirement') bindings.destroy = () => {};
    }
    return bindings;
};
const createRoot = (...args) => {
    const root = actualCreateRoot(...args);
    const render = root.render.bind(root);
    let rendered = false;
    root.render = (...args) => {
        if (rendered && window.testFault === 'remount') return;
        rendered = true;
        return render(...args);
    };
    return root;
};
(${browserMain.toString()})(${JSON.stringify({
            ...richTextLoadedFixture(),
            portal: portalRecipeFixtures.makePortal(),
        })});`,
    },
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
});

async function fixture(t, fault) {
    const window = new Window();
    const names = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'MouseEvent',
        'PointerEvent',
        'KeyboardEvent',
        'getComputedStyle',
    ];
    const originals = names.map((name) =>
        Object.getOwnPropertyDescriptor(globalThis, name)
    );
    for (const name of names)
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value:
                name === 'window'
                    ? window
                    : name === 'getComputedStyle'
                      ? window.getComputedStyle.bind(window)
                      : window[name],
        });
    t.after(async () => {
        window.dispatchEvent(new window.Event('pagehide'));
        await window.happyDOM.close();
        names.forEach((name, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, name, originals[index]);
            else delete globalThis[name];
        });
    });
    window.testFault = fault;
    window.document.body.innerHTML = `
<button id="run"></button><button id="remount"></button>
<button id="replace"></button><button id="retire"></button>
<p id="proof-result" data-state="pending"></p><p id="counters"></p>
<ul id="checks"></ul><pre id="proof-evidence"></pre><div id="app"></div>`;
    new Function(outputFiles[0].text)();
    await window.happyDOM.waitUntilComplete();
    const document = window.document;
    const result = () => document.getElementById('proof-result');
    assert.equal(result().dataset.state, 'pass', result().textContent);
    return {
        window,
        document,
        result,
        action: async (name) => {
            await document.getElementById(name).onclick();
            await window.happyDOM.waitUntilComplete();
        },
        evidence: () =>
            JSON.parse(document.getElementById('proof-evidence').textContent),
    };
}

function assertFailed(page, message) {
    assert.equal(page.result().dataset.state, 'fail');
    assert.match(page.result().textContent, message);
    assert.equal(page.document.getElementById('checks').children.length, 0);
}

test('baseline cannot claim lifecycle actions; real transitions and counted events are retained', async (t) => {
    const page = await fixture(t);
    assert.deepEqual(page.evidence(), {
        lifecycle: { remount: null, replacement: null, retirement: null },
        interactions: [],
    });
    assert.match(
        page.result().textContent,
        /lifecycle pending: remount, replacement, retirement/
    );
    assert.doesNotMatch(
        page.document.getElementById('checks').textContent,
        /Verified lifecycle/
    );
    await page.action('run');
    const active = page.evidence().interactions[0];
    assert.equal(active.status, 'passed');
    assert.deepEqual(active.targets, { output: 31, label: 24, status: 31 });
    assert.equal(active.targetCount, 86);
    assert.equal(active.totalDispatched, 516);
    assert.equal(active.totalReceived, 516);
    for (const type of [
        'click',
        'auxclick',
        'dblclick',
        'pointerdown',
        'keydown',
        'keyup',
    ]) {
        assert.equal(active.dispatched[type], 86);
        assert.equal(active.received[type], 86);
        assert.equal(active.defaultPrevented[type], 0);
    }
    assert.equal(active.rowsBefore, 0);
    assert.equal(active.rowsAfter, 0);
    await page.action('remount');
    const remount = page.evidence().lifecycle.remount;
    assert.notEqual(remount.beforeId, remount.afterId);
    assert.match(
        page.result().textContent,
        /lifecycle pending: replacement, retirement/
    );
    await page.action('replace');
    const replacement = page.evidence().lifecycle.replacement;
    assert.equal(replacement.previousRetired, true);
    assert.equal(replacement.ownerReads, 1);
    assert.notEqual(replacement.beforeText, replacement.afterText);
    assert.match(replacement.afterText, /Replacement Ω/);
    await page.action('run');
    assert.equal(page.evidence().interactions[1].targetCount, 86);
    await page.action('retire');
    assert.equal(page.evidence().lifecycle.retirement.outputRemoved, true);
    assert.match(page.result().textContent, /lifecycle complete/);
    await page.action('run');
    const retired = page.evidence().interactions[2];
    assert.equal(retired.status, 'passed');
    assert.deepEqual(retired.targets, { output: 30, label: 23, status: 30 });
    assert.equal(retired.targetCount, 83);
    assert.equal(retired.totalDispatched, 498);
    assert.equal(retired.totalReceived, 498);
    assert.equal(page.result().dataset.state, 'pass');
});

for (const fault of ['remount', 'replacement', 'retirement']) {
    test(`failed ${fault} action cannot record lifecycle success`, async (t) => {
        const page = await fixture(t, fault);
        await page.action(
            fault === 'replacement'
                ? 'replace'
                : fault === 'retirement'
                  ? 'retire'
                  : fault
        );
        assertFailed(
            page,
            /Remount did not replace|not accepted|Lifecycle retirement mismatch/
        );
        assert.equal(page.evidence().lifecycle[fault], null);
    });
}

test('retirement first leaves other actions pending and disabled replacement cannot fabricate evidence', async (t) => {
    const page = await fixture(t);
    await page.action('retire');
    assert.match(
        page.result().textContent,
        /lifecycle pending: remount, replacement/
    );
    await page.action('replace');
    assertFailed(page, /Replacement is unavailable/);
    assert.equal(page.evidence().lifecycle.replacement, null);
    const retirement = page.evidence().lifecycle.retirement;
    await page.action('retire');
    assertFailed(page, /Binding already retired/);
    assert.deepEqual(page.evidence().lifecycle.retirement, retirement);
});

for (const fault of [
    'empty',
    'missing-label',
    'missing-status',
    'wrong-kind',
    'duplicate',
    'detached',
]) {
    test(`${fault} event target set fails before dispatch`, async (t) => {
        const page = await fixture(t);
        const query = page.document.querySelectorAll.bind(page.document);
        page.document.querySelectorAll = (selector) => {
            const nodes = [...query(selector)];
            if (selector !== '.proof-surface .mx-sdk-rich-text-field > *')
                return nodes;
            if (fault === 'empty') return [];
            if (fault === 'missing-label' || fault === 'missing-status') {
                const index = nodes.findIndex((node) =>
                    fault === 'missing-label'
                        ? node.tagName === 'LABEL'
                        : node.getAttribute('role') === 'status'
                );
                return nodes.filter((_, i) => i !== index);
            }
            if (fault === 'duplicate') return [...nodes, nodes[0]];
            if (fault === 'detached')
                return [nodes[0].cloneNode(true), ...nodes.slice(1)];
            const extra = page.document.createElement('div');
            page.document.body.append(extra);
            return [extra, ...nodes.slice(1)];
        };
        await page.action('run');
        assertFailed(
            page,
            /Event target count mismatch|Unexpected event target kind|Duplicate event target|Detached event target/
        );
        const record = page.evidence().interactions[0];
        assert.equal(record.status, 'failed');
        assert.equal(
            Object.values(record.dispatched).reduce((sum, n) => sum + n),
            0
        );
    });
}

test('dispatch without an at-target receipt fails and removes temporary listeners', async (t) => {
    const page = await fixture(t);
    const target = page.document.querySelector(
        '.mx-sdk-rich-text-field output'
    );
    const dispatch = target.dispatchEvent.bind(target);
    target.dispatchEvent = () => true;
    await page.action('run');
    assertFailed(page, /Event dispatch\/receipt mismatch/);
    const first = page.evidence().interactions[0];
    assert.equal(first.dispatched.click, 2);
    assert.equal(first.received.click, 1);
    target.dispatchEvent = dispatch;
    await page.action('run');
    assert.equal(page.evidence().interactions[1].received.click, 86);
    assert.deepEqual(page.evidence().interactions[0], first);
});

test('redirecting a dispatch to another probed target cannot balance missing receipts', async (t) => {
    const page = await fixture(t);
    const [earlier, target] = page.document.querySelectorAll(
        '.mx-sdk-rich-text-field output'
    );
    target.dispatchEvent = (event) => earlier.dispatchEvent(event);
    await page.action('run');
    assertFailed(page, /Event dispatch\/receipt mismatch/);
    const record = page.evidence().interactions[0];
    assert.equal(record.status, 'failed');
    assert(record.received.click > 0);
    assert.equal(record.dispatched.click, record.received.click + 1);
});

test('canceled event default cannot pass', async (t) => {
    const page = await fixture(t);
    page.document
        .querySelector('.mx-sdk-rich-text-field output')
        .addEventListener('click', (event) => event.preventDefault());
    await page.action('run');
    assertFailed(page, /Event default was prevented: click/);
    assert.equal(page.evidence().interactions[0].defaultPrevented.click, 1);
});

test('row event leakage cannot pass counted interaction checks', async (t) => {
    const page = await fixture(t);
    const section = page.document.getElementById('form-proof');
    page.document
        .querySelector('.mx-sdk-rich-text-field output')
        .addEventListener(
            'click',
            () => {
                section.dispatchEvent(
                    new page.window.MouseEvent('click', { bubbles: true })
                );
            },
            { once: true }
        );
    await page.action('run');
    assertFailed(page, /Injected event escaped to a row/);
    assert.equal(page.evidence().interactions[0].rowsAfter, 1);
});
