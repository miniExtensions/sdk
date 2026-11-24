import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';

const typedConsumer = String.raw`
import { createElement, createRef } from 'react';
import {
    createFormRecordActionsController,
    type FormRecordActionsPort,
    type FormRecordDeleteOutcome,
} from '@miniextensions/sdk/forms';
import {
    FormRecordActionsFooter,
    FormRecordActionsMenu,
    FormRecordActionsHeaderMenu,
    FormRecordDeleteConfirmation,
    type FormRecordActionsLabels,
} from '@miniextensions/sdk/react';

const scope = {};
const port: FormRecordActionsPort = {
    read: () => ({ scope, delete: { visible: true, disabled: false, pending: false }, comments: { visible: true, disabled: false } }),
    subscribe: () => () => {},
    requestCurrentDelete: () => ({ status: 'refused', reason: 'ineligible' }),
    openCurrentComments: () => 'handed-off',
};
const controller = createFormRecordActionsController(port);
const labels: FormRecordActionsLabels = {
    deleteRecord: 'Remove row', comments: 'Comments', openMenu: 'Actions',
    confirmationTitle: 'Remove this record?', irreversibleWarning: 'This is permanent.',
    confirmDelete: 'Remove', cancel: 'Cancel',
};
createElement(FormRecordActionsFooter, { controller, labels });
createElement(FormRecordActionsMenu, { controller, labels });
createElement(FormRecordActionsHeaderMenu, {
    controller, labels, buttonRef: createRef<HTMLButtonElement>(), buttonTestId: 'record-options',
    icons: { trigger: createElement('svg'), comments: createElement('svg'), deleteRecord: createElement('svg') },
});
createElement(FormRecordDeleteConfirmation, { labels, returnFocus: createRef<HTMLButtonElement>(), onConfirm() {}, onDismiss() {} });
const result: FormRecordDeleteOutcome = { status: 'acknowledged', operationId: {}, localSettlement: 'failed' };
void result;
// @ts-expect-error Presentation state is readonly.
controller.getSnapshot().deleteDisabled = true;
// @ts-expect-error Only the current host scope may be admitted.
port.requestCurrentDelete(scope);
// @ts-expect-error An unknown result has no acknowledged local disposition.
const unknown: FormRecordDeleteOutcome = { status: 'unknown', operationId: {}, localSettlement: 'applied' };
void unknown;
`;

const runtimeConsumer = String.raw`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';

const require = createRequire(import.meta.url);
const [format, happyDomModulePath] = process.argv.slice(2);
assert.equal(typeof document, 'undefined');
const forms = format === 'esm' ? await import('@miniextensions/sdk/forms') : require('@miniextensions/sdk/forms');
const ui = format === 'esm' ? await import('@miniextensions/sdk/react') : require('@miniextensions/sdk/react');
const { renderToString } = await import('react-dom/server');
const style = '@miniextensions/sdk/react/form-record-actions.css';
const css = readFileSync(require.resolve(style), 'utf8');
assert.equal(readFileSync(fileURLToPath(import.meta.resolve(style)), 'utf8'), css);
assert.equal(readFileSync('node_modules/@miniextensions/sdk/dist/cjs/react/form-record-actions.css', 'utf8'), css);
assert.match(css, /\.mx-sdk-form-record-actions__dialog::backdrop/);
assert.match(css, /\.mx-sdk-form-record-actions-header__items/);
assert.equal(typeof ui.FormRecordActionsHeaderMenu, 'function');

const oldScope = {};
const currentScope = {};
let scope = oldScope;
const listeners = new Set();
const comments = [];
let requests = 0;
const controller = forms.createFormRecordActionsController({
    read: () => ({ scope, delete: { visible: true, disabled: false, pending: false }, comments: { visible: true, disabled: false } }),
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    requestCurrentDelete() {
        requests++;
        return { status: 'refused', reason: 'ineligible' };
    },
    openCurrentComments() {
        comments.push(scope);
        return 'handed-off';
    },
});
const labels = {
    deleteRecord: 'Supprimer <élément>', comments: 'Commentaires', openMenu: 'Options',
    confirmationTitle: 'Supprimer cet élément ?', irreversibleWarning: 'Cette action est irréversible.',
    confirmDelete: 'Supprimer', cancel: 'Annuler',
};
const element = (Component) => React.createElement(
    React.StrictMode, null, React.createElement(Component, { controller, labels })
);
const html = renderToString(element(ui.FormRecordActionsFooter));
assert.match(html, /Supprimer &lt;élément&gt;/);
assert.doesNotMatch(html, /<dialog/);
assert.equal(listeners.size, 0);
assert.equal(requests, 0);

let networkRequests = 0;
const rejectRequest = () => {
    networkRequests++;
    throw new Error('A presentation may not use the network');
};
const { Window } = require(happyDomModulePath);
const window = new Window({
    url: 'https://consumer.invalid/form',
    settings: { fetch: { interceptor: { beforeAsyncRequest: rejectRequest, beforeSyncRequest: rejectRequest } } },
});
const globals = {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, fetch: rejectRequest,
};
const previous = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
let root;
try {
    const styles = window.document.createElement('style');
    styles.textContent = css;
    window.document.head.append(styles);
    const container = window.document.createElement('form');
    window.document.body.append(container);
    container.innerHTML = html;
    const original = container.firstChild;
    let submits = 0;
    container.addEventListener('submit', event => {
        event.preventDefault();
        submits++;
    });
    const errors = [];
    const { hydrateRoot } = await import('react-dom/client');
    await React.act(async () => {
        root = hydrateRoot(container, element(ui.FormRecordActionsFooter), {
            onRecoverableError: error => errors.push(error.message),
        });
    });
    assert.deepEqual(errors, []);
    assert.equal(container.firstChild, original);
    const button = label => {
        const found = Array.from(container.querySelectorAll('button')).find(
            node => node.textContent === label || node.getAttribute('aria-label') === label
        );
        assert(found, 'Missing button: ' + label);
        assert.equal(found.type, 'button');
        return found;
    };
    const click = async node => React.act(async () => node.click());
    const opener = button(labels.deleteRecord);
    opener.focus();
    await click(opener);
    assert.equal(container.querySelector('dialog[role="alertdialog"]').open, true);
    const cancel = button(labels.cancel);
    assert.equal(window.document.activeElement, cancel);
    await click(cancel);
    assert.equal(container.querySelector('dialog'), null);
    assert.equal(window.document.activeElement, opener);
    assert.equal(requests, 0);

    await React.act(async () => root.render(element(ui.FormRecordActionsMenu)));
    const toggle = button(labels.openMenu);
    await click(toggle);
    scope = currentScope;
    await click(button(labels.comments));
    assert.deepEqual(comments, [currentScope]);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(requests, 0);
    assert.equal(submits, 0);
    assert.equal(networkRequests, 0);
    assert.equal(window.location.href, 'https://consumer.invalid/form');
    console.log(JSON.stringify({ format, react: React.version, hydrationErrors: errors.length, networkRequests, submits }));
} finally {
    if (root) await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
    await window.happyDOM.close();
}
assert.equal(listeners.size, 0);
`;

export function checkFormRecordActionsReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-form-record-actions-'));
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            ...options,
        });
    const versions = [];
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + resolve(archivePath),
                },
            })
        );
        writeFileSync(join(directory, 'runtime.mjs'), runtimeConsumer);
        for (const extension of ['mts', 'cts'])
            writeFileSync(
                join(directory, 'consumer.' + extension),
                typedConsumer
            );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            runAgeQualifiedConsumerInstall(run, [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                'react@' + version.react,
                'react-dom@' + version.react,
                '@types/react@' + version.types,
                '@types/react-dom@' + version.domTypes,
            ]);
            run(process.execPath, [
                typescriptBin,
                '--noEmit',
                '--strict',
                '--skipLibCheck',
                'false',
                '--target',
                'ES2022',
                '--module',
                'NodeNext',
                '--moduleResolution',
                'NodeNext',
                'consumer.mts',
                'consumer.cts',
            ]);
            const formats = [];
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    run(
                        process.execPath,
                        ['runtime.mjs', format, happyDomModulePath],
                        {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'inherit'],
                        }
                    )
                );
                assert.equal(result.react, version.react);
                formats.push(result);
            }
            versions.push({ react: version.react, formats });
            console.log(
                'Installed Form record actions: React ' +
                    version.react +
                    ' ESM/CJS, strict types, CSS, SSR and hydration passed.'
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
