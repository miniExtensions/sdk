import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeProof = String.raw`
const duplicate = '  duplicate@example.com  ';
const pages = [
    { labels: [duplicate, '', duplicate], offset: 'raw-page-2' },
    { labels: ['', duplicate, 'Last option'], offset: null },
];
const owner = {
    extensionSessionId: 'synthetic-session',
    extensionId: 'synthetic-extension',
    fieldId: 'synthetic-field',
    viewMode: 'published',
};
const reads = [];
const selections = [];
const errors = [];
let submits = 0;
let settingsActions = 0;
const h = React.createElement;
const app = h(React.StrictMode, null, h('form', {
    onSubmit(event) { event.preventDefault(); submits++; },
}, h(LoginExistingValuesPicker, {
    owner,
    allowSearchFromExistingValuesInLogin: true,
    labels: { title: 'Valeurs existantes' },
    titleAction: h('button', {
        type: 'button',
        onClick() { settingsActions++; },
    }, 'Réglages'),
    async loadOptions({ signal, offset, searchTerm, ...actual }) {
        assert.deepEqual(actual, owner);
        assert.equal(signal.aborted, false);
        reads.push([searchTerm, offset]);
        return offset === null ? pages[0] : pages[1];
    },
    onSelect(label) { selections.push(label); },
})));
const markup = renderToString(app);
assert.match(markup, /Find an existing value/);
assert.doesNotMatch(markup, /role="dialog"/);
assert.doesNotMatch(markup, /Réglages/);
assert.deepEqual(reads, []);
const window = new Window({ url: 'https://login.example.invalid/' });
let root;
try {
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = window.document.createElement('main');
    container.innerHTML = markup;
    window.document.body.append(container);
    const trigger = container.querySelector('button');
    await React.act(async () => {
        root = hydrateRoot(container, app, {
            onRecoverableError(error) { errors.push(error.message); },
        });
    });
    assert.equal(container.querySelector('button'), trigger);
    assert.deepEqual(reads, []);
    const click = async node => React.act(async () => { node.click(); });
    const options = () => [...container.querySelectorAll('[role=dialog] li button')];
    await click(trigger);
    assert.equal(window.document.activeElement.type, 'search');
    assert.deepEqual(options().map(node => node.textContent), pages[0].labels);
    const dialog = container.querySelector('[role=dialog]');
    const heading = window.document.getElementById(dialog.getAttribute('aria-labelledby'));
    assert.equal(heading.textContent, 'Valeurs existantes');
    const settings = heading.nextElementSibling;
    assert.equal(settings.textContent, 'Réglages');
    await click(settings);
    assert.equal(settingsActions, 1);
    assert.deepEqual(selections, []);
    assert.equal(submits, 0);
    assert.deepEqual(reads, [['', null]]);
    assert.equal(container.querySelector('[role=dialog]'), dialog);
    await click([...container.querySelectorAll('button')].find(node => node.textContent === 'Load more'));
    assert.deepEqual(options().map(node => node.textContent), [...pages[0].labels, ...pages[1].labels]);
    assert.equal(options()[3].getAttribute('aria-label'), 'Blank value');
    await click(options()[3]);
    assert.equal(window.document.activeElement, trigger);
    assert.deepEqual(selections, ['']);
    assert.equal(container.querySelector('[role=dialog]'), null);
    await click(trigger);
    await click(options()[2]);
    assert.deepEqual(selections, ['', duplicate]);
    assert.deepEqual(reads, [['', null], ['', 'raw-page-2'], ['', null]]);
    assert.deepEqual(errors, []);
    assert.equal(submits, 0);
    assert.equal(window.document.activeElement, trigger);
    console.log(JSON.stringify({ react: React.version, selections, reads, submits, settingsActions }));
} finally {
    if (root) await React.act(async () => root.unmount());
    await window.happyDOM.close();
}
`;

export function checkInstalledLoginExistingValuesPicker({
    directory,
    react,
    typescriptBin,
    happyDomModulePath,
}) {
    const docs = readFileSync(
        join(directory, 'node_modules/@miniextensions/sdk/docs/ui.md'),
        'utf8'
    );
    const guide = docs
        .split('## Login existing values picker\n')[1]
        ?.match(/```tsx\n([\s\S]*?)\n```/)?.[1];
    assert(guide, 'Missing packed Login picker guide');
    const run = (args) =>
        execFileSync(process.execPath, args, {
            cwd: directory,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit'],
        });
    for (const [type, format] of [
        ['mts', 'mjs'],
        ['cts', 'cjs'],
    ]) {
        const typeFile = join(directory, `login-existing-values.${type}`);
        const runtimeFile = join(directory, `login-existing-values.${format}`);
        try {
            writeFileSync(typeFile, guide);
            run([
                typescriptBin,
                '--noEmit',
                '--strict',
                '--target',
                'ES2022',
                '--module',
                'NodeNext',
                '--moduleResolution',
                'NodeNext',
                typeFile,
            ]);
            const dom = JSON.stringify(pathToFileURL(happyDomModulePath).href);
            const esm = format === 'mjs';
            const imports = esm
                ? String.raw`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { LoginExistingValuesPicker } from '@miniextensions/sdk/react';
assert.match(import.meta.resolve('@miniextensions/sdk/react'), /\/dist\/esm\/react\/index\.js$/);
const css = fileURLToPath(import.meta.resolve('@miniextensions/sdk/react/login-existing-values-picker.css'));
`
                : String.raw`
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToString } = require('react-dom/server');
const { hydrateRoot } = require('react-dom/client');
const { LoginExistingValuesPicker } = require('@miniextensions/sdk/react');
assert.match(require.resolve('@miniextensions/sdk/react'), /\/dist\/cjs\/react\/index\.js$/);
const css = require.resolve('@miniextensions/sdk/react/login-existing-values-picker.css');
`;
            // Keep both public resolution conditions real and isolate React's
            // module state between SSR/hydration runs and peer versions.
            const proof = `
assert.match(readFileSync(css, 'utf8'), /mx-sdk-login-values-panel/);
const { Window } = await import(${dom});
${runtimeProof}`;
            writeFileSync(
                runtimeFile,
                esm
                    ? imports + proof
                    : imports +
                          `
(async () => {${proof}})().catch(error => { console.error(error); process.exitCode = 1; });
`
            );
            const result = JSON.parse(run([runtimeFile]));
            assert.equal(result.react, react);
            assert.deepEqual(result.selections, [
                '',
                '  duplicate@example.com  ',
            ]);
            assert.equal(result.submits, 0);
            assert.equal(result.settingsActions, 1);
        } finally {
            rmSync(typeFile, { force: true });
            rmSync(runtimeFile, { force: true });
        }
    }
    console.log(
        `Installed Login picker React ${react}: ESM/CJS declarations, CSS, SSR, hydration, title action, raw choice, and focus passed.`
    );
}
