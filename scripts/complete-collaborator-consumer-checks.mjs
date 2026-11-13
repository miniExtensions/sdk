import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    singleCollaboratorReactTypedConsumer,
    singleCollaboratorNodeTypedConsumer,
} from './single-collaborator-consumer-checks.mjs';
import {
    multipleCollaboratorsNodeTypedConsumer,
    multipleCollaboratorsReactTypedConsumer,
} from './multiple-collaborators-consumer-checks.mjs';

export const completeCollaboratorTypedConsumer = String.raw`import { createElement } from 'react';
import {
    SingleCollaboratorField, BindingSingleCollaboratorField, CompleteSingleCollaboratorField, CompleteMultipleCollaboratorsField, MultipleCollaboratorsField, CreatedByField,
    type CreatedByFieldProps, type BindingCreatedByFieldProps, type ControlledCreatedByFieldProps,
    type ControlledSingleCollaboratorFieldProps, type SingleCollaboratorFieldProps,
    type CompleteCollaborator, type CompleteCollaboratorEditOwner,
    type CompleteSingleCollaboratorFieldProps,
    type CompleteMultipleCollaboratorsFieldProps, type ControlledMultipleCollaboratorsFieldProps,
    type CollaboratorAvatarPolicy,
} from '@miniextensions/sdk/react';
type Native = CompleteCollaborator & { nativeMetadata: { order: number } };
const a: Native = { id: 'usr_a', name: '<b>Literal</b>', email: 'a@example.invalid', nativeMetadata: { order: 2 } };
const choices: readonly Native[] = [a];
const owner: CompleteCollaboratorEditOwner = { token: {}, isCurrent: () => true };
const creator: ControlledCreatedByFieldProps<Native> = { mode: 'controlled', value: a, title: 'Creator', labels: { empty: 'No creator' } };
createElement(CreatedByField<Native>, creator);
declare const legacyCreator: CreatedByFieldProps;
const bindingCreator: BindingCreatedByFieldProps = legacyCreator;
createElement(CreatedByField, bindingCreator);
// @ts-expect-error computed creators cannot receive edit authority
const creatorOwner: ControlledCreatedByFieldProps<Native> = { ...creator, owner };
// @ts-expect-error computed creators cannot receive a write callback
const creatorWrite: ControlledCreatedByFieldProps<Native> = { ...creator, onValueChange() {} };
// @ts-expect-error readonly cannot be disabled for a computed creator
const creatorEditable: ControlledCreatedByFieldProps<Native> = { ...creator, readOnly: false };
// @ts-expect-error computed creators have no removal label callback
const creatorRemove: ControlledCreatedByFieldProps<Native> = { ...creator, labels: { remove: () => 'Remove' } };
// @ts-expect-error controlled creators cannot borrow bindings or render overrides
createElement(CreatedByField<Native>, { ...creator, binding: legacyCreator.binding });
// @ts-expect-error projected creator identities are objects, not strings
const creatorId: ControlledCreatedByFieldProps<Native> = { ...creator, value: 'usr_a' };
const avatarPolicy: CollaboratorAvatarPolicy = { type: 'source', getSource(url) { return { src: '/optimized?url=' + encodeURIComponent(url), srcSet: '/small 1x, /large 2x', sizes: '32px', loading: 'lazy', decoding: 'async' }; } };
const single: CompleteSingleCollaboratorFieldProps<Native> = {
    value: a, choices, owner, inputId: 'single', formId: 'owner-form',
    describedBy: 'help error', invalid: true, ariaLabel: 'Assignee', avatarPolicy,
    onValueChange(value) { const original: Native | null = value; void original; },
};
const multiple: CompleteMultipleCollaboratorsFieldProps<Native> = {
    choices, owner, value: [a, a], readOnly: true,
    labels: { empty: 'No people', remove: (label) => 'Remove ' + label },
    onValueChange(value) { const originals: Native[] = value; void originals; },
};
const controlledSingle: ControlledSingleCollaboratorFieldProps<Native> = { ...single, mode: 'controlled' };
createElement(SingleCollaboratorField<Native>, controlledSingle);
createElement(SingleCollaboratorField<Native>, { ...controlledSingle, value: null });
declare const legacySingle: SingleCollaboratorFieldProps;
createElement(SingleCollaboratorField, legacySingle);
createElement(BindingSingleCollaboratorField, legacySingle);
// @ts-expect-error binding and controlled capabilities cannot be combined
createElement(SingleCollaboratorField<Native>, { ...controlledSingle, binding: legacySingle.binding });
// @ts-expect-error the complete contract requires explicit controlled discrimination
createElement(SingleCollaboratorField<Native>, single);
createElement(CompleteSingleCollaboratorField<Native>, single);
createElement(CompleteSingleCollaboratorField<Native>, { ...single, value: null });
createElement(CompleteMultipleCollaboratorsField<Native>, multiple);
const controlled: ControlledMultipleCollaboratorsFieldProps<Native> = { ...multiple, mode: 'controlled' };
createElement(MultipleCollaboratorsField<Native>, controlled);
// @ts-expect-error the controlled contract requires its explicit discriminator
createElement(MultipleCollaboratorsField<Native>, multiple);
// @ts-expect-error binding/custom rendering must not enter controlled mode
createElement(MultipleCollaboratorsField<Native>, { ...controlled, binding: {} });
// @ts-expect-error the SDK owns the complete runtime DOM
createElement(MultipleCollaboratorsField<Native>, { ...controlled, render: () => null });

// @ts-expect-error native collaborator objects are not ID strings
const ids: CompleteSingleCollaboratorFieldProps<Native> = { ...single, value: 'usr_a' };
// @ts-expect-error writes retain native object arrays, not scalar strings
const scalar: CompleteMultipleCollaboratorsFieldProps<Native> = { ...multiple, onValueChange(value: string) { void value; } };
// @ts-expect-error editable complete fields require explicit current authority
createElement(CompleteSingleCollaboratorField<Native>, { value: a, choices, onValueChange() {} });
// @ts-expect-error the SDK owns the picker and avatar DOM
createElement(CompleteMultipleCollaboratorsField<Native>, { ...multiple, renderAvatar() { return null; } });
// @ts-expect-error a second uncontrolled selection store is not accepted
createElement(CompleteSingleCollaboratorField<Native>, { ...single, defaultValue: a });
// @ts-expect-error complete React controls do not enter the React-free core
import { CompleteSingleCollaboratorField as CoreField } from '@miniextensions/sdk';
void ids; void scalar; void CoreField;
`;

const runtime = String.raw`import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
const require = createRequire(import.meta.url);
const mode = process.argv[2], format = process.argv[3];
const installed = join(dirname(fileURLToPath(import.meta.url)), 'node_modules/@miniextensions/sdk');
assert.throws(() => require.resolve('@headlessui/react'), { code: 'MODULE_NOT_FOUND' });
const apiPath = format === 'esm' ? fileURLToPath(import.meta.resolve('@miniextensions/sdk/react')) : require.resolve('@miniextensions/sdk/react');
assert(apiPath.startsWith(join(installed, 'dist', format, 'react')));
assert.equal('CompleteSingleCollaboratorField' in require('@miniextensions/sdk'), false);
const a = { id: 'usr_a', name: 'Alpha', email: 'alpha@example.invalid', profilePicUrl: 'https://avatars.example.invalid/a.png', nativeMetadata: { order: 1 } };
const b = { id: 'usr_b', name: 'Beta', email: 'beta@example.invalid', nativeMetadata: { order: 2 } };
const retired = { id: 'usr_retired', name: '<img src=x onerror=alert(1)>', email: 'retired@example.invalid' };
const duplicate = { ...a, name: 'Alpha occurrence' };
const load = () => format === 'esm' ? import('@miniextensions/sdk/react') : Promise.resolve(require('@miniextensions/sdk/react'));
const creatorServerNode = api => React.createElement(api.CreatedByField, { mode: 'controlled', value: retired, title: 'Created by', inputId: 'ssr-creator' });
const editableServerNode = (api, common) => React.createElement('form', { id: 'ssr-form' },
    React.createElement('label', { id: 'ssr-label', htmlFor: 'ssr-person' }, 'Assignee'),
    React.createElement('span', { id: 'ssr-help' }, 'Choose a person'),
    React.createElement('span', { id: 'ssr-error' }, 'Required'),
    React.createElement(api.SingleCollaboratorField, { mode: 'controlled',
        ...common, value: null, inputId: 'ssr-person', formId: 'ssr-form',
        ariaLabel: 'Assignee', labelledBy: 'ssr-label',
        describedBy: 'ssr-help ssr-error', invalid: true,
    }));
if (mode === 'ssr') {
    assert.equal(typeof globalThis.document, 'undefined');
    const api = await load();
    assert.equal(Object.keys(require.cache).filter((path) => /[/\\]react-dom[/\\]/.test(path)).length, 0,
        'cold public field/display import must not eagerly initialize React DOM');
    const { renderToString } = await import('react-dom/server');
    let writes = 0;
    const owner = { token: {}, isCurrent: () => true };
    const common = { choices: [a, b], owner, onValueChange() { writes++; } };
    const html = renderToString(React.createElement(api.MultipleCollaboratorsField, { mode: 'controlled', ...common, value: [a, retired, duplicate], readOnly: true }));
    assert.equal(html, renderToString(React.createElement(api.CompleteMultipleCollaboratorsField, { ...common, value: [a, retired, duplicate], readOnly: true })));
    assert(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert(!html.includes('src="https://avatars.example.invalid/a.png"'), 'no image network authority by default');
    assert(!html.includes('role="combobox"'));
    const editable = renderToString(editableServerNode(api, common));
    const loadingInputs = editable.match(/<input\b[^>]*>/g) ?? [];
    assert.equal(loadingInputs.length, 1, 'cold SSR presents exactly one associated loading input');
    for (const attribute of ['id="ssr-person"', 'form="ssr-form"', 'aria-label="Assignee"', 'aria-labelledby="ssr-label"', 'aria-describedby="ssr-help ssr-error"', 'aria-invalid="true"', 'aria-busy="true"', 'disabled=""'])
        assert(loadingInputs[0].includes(attribute), 'loading input retains ' + attribute);
    assert(/\sreadonly=""(?:\s|\/?>)/i.test(loadingInputs[0]),
        'loading input retains the HTML readonly attribute: ' + loadingInputs[0]);
    assert(!editable.includes('role="combobox"'), 'SSR loading input must not pretend the client picker is ready');
    assert(!editable.includes('role="option"'));
    assert(editable.includes('<label id="ssr-label" for="ssr-person">Assignee</label>'));
    const fieldGroup = (editable.match(/<div\b[^>]*role="group"[^>]*>/g) ?? []);
    assert.equal(fieldGroup.length, 1);
    assert(fieldGroup[0].includes('aria-labelledby="ssr-label"'));
    assert(fieldGroup[0].includes('aria-describedby="ssr-help ssr-error"'));
    assert(fieldGroup[0].includes('aria-invalid="true"'));
    assert(/<div\b[^>]*aria-busy="true"[^>]*>/.test(editable), 'real picker loading container advertises busy state');
    const avatars = renderToString(React.createElement(api.MultipleCollaboratorsField, { mode: 'controlled', ...common, value: [a], readOnly: true, avatarPolicy: { type: 'direct', allowedOrigins: ['https://avatars.example.invalid'] } }));
    assert(avatars.includes('src="https://avatars.example.invalid/a.png"'));
    assert(avatars.includes('alt=""') && avatars.includes('width="32"') && avatars.includes('height="32"'));
    assert.equal(writes, 0);
    assert.equal(typeof globalThis.document, 'undefined', 'import and SSR must not create DOM');
    const creator = renderToString(creatorServerNode(api));
    assert(creator.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert(!/<(?:input|button|img)\b/.test(creator));
    console.log(JSON.stringify({ react: React.version, format, mode, groups: 2, writes, html, editable, creator, cleanup: 'completed' }));
} else {
    assert.equal(mode, 'dom');
    const { Window } = await import(pathToFileURL(process.argv[4]).href);
    const window = new Window();
    let requests = 0, submits = 0, root;
    const reject = async () => { requests++; throw Error('Collaborator picker must not issue identity/backend requests'); };
    Object.defineProperty(window, 'fetch', { configurable: true, value: reject });
    const keys = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'HTMLFieldSetElement', 'HTMLLegendElement', 'HTMLFormElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'SVGElement', 'Document', 'DocumentFragment', 'ShadowRoot', 'NodeFilter', 'MutationObserver', 'ResizeObserver', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'];
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
    for (const key of keys) {
        let value = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'fetch' ? reject : window[key];
        if (['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'].includes(key) && typeof value === 'function') value = value.bind(window);
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const restore = () => keys.forEach((key, index) => {
        if (originals[index]) Object.defineProperty(globalThis, key, originals[index]);
        else Reflect.deleteProperty(globalThis, key);
    });
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const model = { mode: 'single', value: null, choices: [a, b], token: {}, current: true, readOnly: false, visible: true, refuse: false, placeholder: 'Select a person' };
    const writes = [];
    let mounted = false, api, groups = 0;
    const node = () => {
        const token = model.token;
        const Component = model.mode === 'single' ? api.SingleCollaboratorField : api.MultipleCollaboratorsField;
        return React.createElement(React.StrictMode, null,
            React.createElement('form', { id: 'people-form', onSubmit(event) { event.preventDefault(); submits++; } },
                React.createElement('label', { htmlFor: 'person' }, 'Assigned people'),
                React.createElement('span', { id: 'person-help' }, 'Choose supplied people'),
                React.createElement('span', { id: 'person-error' }, 'Required'),
                React.createElement(Component, {
                    mode: 'controlled',
                    choices: model.choices, value: model.value,
                    owner: { token, isCurrent: () => model.current && model.token === token },
                    readOnly: model.readOnly, visible: model.visible,
                    inputId: 'person', formId: 'people-form', describedBy: 'person-help person-error', invalid: true,
                    labels: { placeholder: model.placeholder, availableOptions: 'Available people', noMatches: 'No matching people', empty: 'Nobody selected', open: 'Open people', remove: (label) => 'Remove ' + label },
                    avatarPolicy: { type: 'direct', allowedOrigins: ['https://avatars.example.invalid'] },
                    onValueChange(next) {
                        writes.push(next);
                        if (!model.refuse) { model.value = next; if (mounted) root.render(node()); }
                    },
                }),
                React.createElement('input', { 'aria-label': 'Adjacent', defaultValue: 'Keep adjacent' }),
                React.createElement('button', { type: 'submit' }, 'Explicit Save')));
    };
    try {
        api = await load();
        const { createRoot, hydrateRoot } = await import('react-dom/client');
        const settle = async () => React.act(async () => { await new Promise((done) => window.requestAnimationFrame(done)); });
        const waitFor = async (read, message) => {
            const deadline = Date.now() + 5000;
            for (;;) {
                const result = read();
                if (result) return result;
                assert(Date.now() < deadline, message);
                await settle();
            }
        };
        const server = JSON.parse(readFileSync(process.argv[5], 'utf8'));
        const hydrationErrors = [];
        const hydrationCommon = { choices: [a, b], owner: { token: {}, isCurrent: () => true }, onValueChange() { throw Error('Hydration must not propose a collaborator edit'); } };
        for (const [html, rendered, selector] of [
            [server.html, React.createElement(api.MultipleCollaboratorsField, { mode: 'controlled', ...hydrationCommon, value: [a, retired, duplicate], readOnly: true }), 'li'],
            [server.editable, editableServerNode(api, hydrationCommon), 'input'],
            [server.creator, creatorServerNode(api), 'li'],
        ]) {
            const host = window.document.createElement('div');
            host.innerHTML = html; window.document.body.append(host);
            const initial = host.querySelector(selector);
            if (selector === 'input') {
                assert(initial.disabled, 'server input is the real loading presentation');
                assert(initial.readOnly);
                assert.equal(initial.form.id, 'ssr-form');
                assert.equal(initial.labels[0].textContent, 'Assignee');
                assert.equal(initial.getAttribute('aria-busy'), 'true');
                assert.equal(initial.getAttribute('aria-labelledby'), 'ssr-label');
            }
            let hydrated;
            try {
                await React.act(async () => {
                    hydrated = hydrateRoot(host, rendered, { onRecoverableError(error) { hydrationErrors.push(String(error)); } });
                });
                if (selector === 'li')
                    assert.equal(host.querySelector(selector), initial, 'hydrate actual cold-server badge output without replacing it');
                else {
                    const enabled = await waitFor(() => host.querySelector('input[role="combobox"]:not(:disabled)'), 'actual lazy picker must become enabled after committed mount');
                    assert.equal(enabled.id, 'ssr-person');
                    assert.equal(enabled.form.id, 'ssr-form');
                    assert.equal(enabled.getAttribute('aria-label'), 'Assignee');
                    assert.equal(enabled.getAttribute('aria-labelledby'), 'ssr-label');
                    assert.equal(enabled.getAttribute('aria-describedby'), 'ssr-help ssr-error');
                    assert.equal(enabled.getAttribute('aria-invalid'), 'true');
                    assert.equal(enabled.labels[0].textContent, 'Assignee');
                    assert.equal(host.querySelector('[role="option"]'), null);
                }
                assert.deepEqual(hydrationErrors, []);
            } finally {
                if (hydrated) await React.act(async () => hydrated.unmount());
                host.remove();
            }
        }
        groups++;
        root = createRoot(container);
        await React.act(async () => root.render(node()));
        mounted = true;
        const field = () => container.querySelector('input[role="combobox"]');
        await waitFor(() => field() && !field().disabled, 'actual mounted collaborator picker must become enabled');
        const adjacent = container.querySelector('[aria-label="Adjacent"]');
        adjacent.value = 'Keep neighboring dirty value';
        const publish = async (patch = {}) => {
            Object.assign(model, patch);
            await React.act(async () => root.render(node()));
            if (model.visible && !model.readOnly && (model.mode === 'multiple' || model.value == null))
                await waitFor(() => field() && !field().disabled, 'current owner must admit its actual enabled picker');
            assert.equal(adjacent.value, 'Keep neighboring dirty value');
        };
        const edit = async (text) => {
            await waitFor(() => field() && !field().disabled, 'search requires the actual enabled picker');
            await React.act(async () => {
                field().focus();
                Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field(), text);
                field().dispatchEvent(new window.Event('input', { bubbles: true }));
            });
            await settle();
            if (model.choices.length)
                await waitFor(() => container.querySelector('[role="option"]'), 'current offered search results must render');
        };
        const key = async (name) => {
            await React.act(async () => {
                field().dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
                field()?.dispatchEvent(new window.KeyboardEvent('keyup', { key: name, bubbles: true, cancelable: true }));
            });
            await settle();
        };
        const pointer = async (element) => {
            assert(element, 'actual rendered target required');
            await React.act(async () => {
                element.dispatchEvent(new window.PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true, cancelable: true, button: 0 }));
                element.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
                element.dispatchEvent(new window.PointerEvent('pointerup', { pointerType: 'mouse', bubbles: true, cancelable: true, button: 0 }));
                element.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
                element.click();
            });
            await settle();
        };
        const remove = (label) => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Remove ' + label);
        assert.equal(field().form.id, 'people-form');
        assert.equal(field().id, 'person');
        assert.equal(field().getAttribute('aria-describedby'), 'person-help person-error');
        assert.equal(field().getAttribute('aria-invalid'), 'true');
        const emptyInput = field();
        await pointer(emptyInput);
        await waitFor(() => container.querySelectorAll('[role="option"]').length === 2, 'clicking the empty input opens current supplied choices');
        let offered = [...container.querySelectorAll('[role="option"]')];
        assert(offered[0].textContent.includes('Alpha') && offered[0].textContent.includes(a.email));
        assert(offered[1].textContent.includes('Beta') && offered[1].textContent.includes(b.email));
        assert.equal(writes.length, 0);
        await key('Escape');
        await waitFor(() => container.querySelector('[role="option"]') === null, 'Escape closes the actual options');
        assert.equal(field(), emptyInput); assert.equal(window.document.activeElement, emptyInput);
        await pointer(emptyInput);
        await waitFor(() => container.querySelectorAll('[role="option"]').length === 2, 'clicking the same focused empty input reopens the actual options');
        offered = [...container.querySelectorAll('[role="option"]')];
        assert(offered[0].textContent.includes(a.email)); assert(offered[1].textContent.includes(b.email));
        assert.equal(writes.length, 0);
        await key('Escape');
        await waitFor(() => container.querySelector('[role="option"]') === null, 'Escape closes the reopened options');
        assert.equal(window.document.activeElement, emptyInput); assert.equal(writes.length, 0);
        await pointer(container.querySelector('button[aria-label="Open people"]'));
        await waitFor(() => container.querySelectorAll('[role="option"]').length === 2, 'mouse arrow opens current supplied choices');
        assert.equal(writes.length, 0);
        await key('Escape');
        await waitFor(() => container.querySelector('[role="option"]') === null, 'Escape closes after mouse-arrow history');
        assert.equal(window.document.activeElement, emptyInput);
        await pointer(emptyInput);
        await waitFor(() => container.querySelectorAll('[role="option"]').length === 2, 'input click reopens after real mouse-arrow pointer history');
        offered = [...container.querySelectorAll('[role="option"]')];
        assert(offered[0].textContent.includes(a.email)); assert(offered[1].textContent.includes(b.email));
        await key('Escape');
        await waitFor(() => container.querySelector('[role="option"]') === null, 'Escape closes after input reopening');
        assert.equal(window.document.activeElement, emptyInput);
        let space;
        await React.act(async () => {
            space = new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
            emptyInput.dispatchEvent(space);
            emptyInput.dispatchEvent(new window.KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
        });
        assert.equal(space.defaultPrevented, false, 'input Space remains available for native text insertion');
        assert.equal(emptyInput.readOnly, false);
        assert.equal(container.querySelector('[role="option"]'), null, 'input Space must not act as a button toggle');
        assert.equal(writes.length, 0); assert.equal(submits, 0);
        await edit('ALPHA@EXAMPLE.INVALID');
        offered = [...container.querySelectorAll('[role="option"]')];
        assert.equal(offered.length, 2, 'native Fuse also admits the close full-email match');
        assert(offered[0].textContent.includes(a.email));
        assert(offered[1].textContent.includes(b.email));
        assert.equal(writes.length, 0, 'full-email fuzzy search itself proposes no edit');
        await edit('BETA@EXAMPLE.INVALID');
        offered = [...container.querySelectorAll('[role="option"]')];
        assert.equal(offered.length, 2);
        assert(offered[0].textContent.includes(b.email));
        assert(offered[1].textContent.includes(a.email));
        assert.equal(writes.length, 0);
        await edit('ALPHA@');
        assert.equal(container.querySelectorAll('[role="option"]').length, 1);
        assert(container.querySelector('[role="option"]').textContent.includes(a.email));
        await key('ArrowDown'); await key('Enter');
        assert.equal(writes.length, 1); assert.equal(writes[0], a);
        assert.equal(field(), null);
        assert.equal(window.document.activeElement, remove('Alpha'));
        await pointer(remove('Alpha'));
        assert.equal(writes.at(-1), null);
        assert.equal(window.document.activeElement, field());
        await edit('beta@');
        await pointer(container.querySelector('[role="option"]'));
        assert.equal(writes.at(-1), b);
        assert.equal(window.document.activeElement, remove('Beta'));
        assert.equal(submits, 0); groups++;

        await pointer(remove('Beta'));
        await publish({ refuse: true });
        const beforeRefusal = writes.length;
        await edit('alpha@'); await key('ArrowDown'); await key('Enter');
        assert.equal(writes.length, beforeRefusal + 1); assert.equal(writes.at(-1), a);
        assert.equal(model.value, null); assert(field());
        await React.act(async () => adjacent.focus());
        await publish({ value: b });
        assert.equal(window.document.activeElement, adjacent, 'refused selection cannot retain a future focus request');
        assert.equal(submits, 0); groups++;

        await publish({ mode: 'multiple', value: [a, retired, duplicate, b], refuse: false, token: {} });
        await edit('alpha@');
        const selected = container.querySelector('[role="option"]');
        assert.equal(selected.getAttribute('aria-selected'), 'true');
        await pointer(selected);
        assert.equal(writes.at(-1).length, 2);
        assert.equal(writes.at(-1)[0], retired); assert.equal(writes.at(-1)[1], b);
        assert.equal(container.querySelectorAll('.mx-sdk-collaborator-badge').length, 2);
        await pointer(remove(retired.name));
        assert.equal(writes.at(-1).length, 1); assert.equal(writes.at(-1)[0], b);
        assert.equal(window.document.activeElement === field(), true, 'accepted multiple badge removal focuses its current input');
        await pointer(remove('Beta'));
        assert.deepEqual(writes.at(-1), []);
        assert.equal(window.document.activeElement === field(), true, 'last removal preserves input focus');
        await publish({ value: [b], refuse: true });
        await pointer(remove('Beta'));
        assert.equal(model.value[0], b);
        await React.act(async () => adjacent.focus());
        await publish({ value: [], refuse: false });
        assert.equal(window.document.activeElement === adjacent, true, 'refused multiple removal cannot focus a later external clear'); groups++;

        await publish({ choices: [], value: [retired], token: {} });
        await edit('retired@example.invalid');
        assert.equal(container.querySelectorAll('[role="option"]').length, 0);
        assert(container.textContent.includes('No matching people'));
        assert(container.textContent.includes(retired.name));
        assert.equal(container.querySelector('img[onerror]'), null);
        await pointer(remove(retired.name));
        assert.deepEqual(writes.at(-1), []); groups++;

        await publish({ choices: [a, b], value: [], token: {} });
        await edit('beta@');
        const sameInput = field();
        await publish({ placeholder: 'Current hint', choices: [a, b], value: [] });
        assert.equal(field(), sameInput); assert.equal(field().value, 'beta@');
        assert.equal(window.document.activeElement, sameInput);
        const count = writes.length;
        model.current = false;
        await key('ArrowDown'); await key('Enter');
        assert.equal(writes.length, count, 'revoked current owner cannot select');
        const firstToken = model.token;
        await publish({ token: {}, current: true });
        await publish({ token: firstToken });
        await pointer(sameInput);
        assert.equal(writes.length, count, 'observed owner ABA does not revive retired input'); groups++;

        await publish({ value: [a, duplicate, retired], readOnly: true });
        assert.equal(field(), null); assert.equal(container.querySelectorAll('.mx-sdk-collaborator-badge').length, 3);
        assert.equal(container.querySelectorAll('.mx-sdk-collaborator-badge button').length, 0);
        assert.equal(container.querySelectorAll('img').length, 2);
        for (const image of container.querySelectorAll('img')) { assert.equal(image.alt, ''); assert.equal(image.width, 32); assert.equal(image.height, 32); }
        await publish({ value: [] });
        assert(container.textContent.includes('Nobody selected'));
        assert.equal(writes.length, count); groups++;

        await publish({ readOnly: false, value: [], choices: [a, b], token: {} });
        const retiredInput = field();
        await publish({ visible: false });
        assert.equal(field(), null);
        await pointer(retiredInput);
        assert.equal(writes.length, count);
        await React.act(async () => root.unmount()); root = null;
        await pointer(retiredInput);
        assert.equal(writes.length, count); assert.equal(submits, 0); assert.equal(requests, 0); groups++;
        console.log(JSON.stringify({ react: React.version, format, mode, groups, writes: writes.length, submits, requests, cleanup: 'completed' }));
    } finally {
        try { if (root) await React.act(async () => root.unmount()); }
        finally { restore(); await window.happyDOM.close(); }
    }
}
`;

const productionBuild = String.raw`import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { build } = await import(pathToFileURL(process.argv[2]).href);
const format = process.argv[3];
const sdk = resolve('node_modules/@miniextensions/sdk');
const script = format === 'esm'
 ? "import {CreatedByField,SingleCollaboratorField,CompleteSingleCollaboratorField,CompleteMultipleCollaboratorsField,MultipleCollaboratorsField} from '@miniextensions/sdk/react'; export {CreatedByField,SingleCollaboratorField,CompleteSingleCollaboratorField,CompleteMultipleCollaboratorsField,MultipleCollaboratorsField};"
 : "const {CreatedByField,SingleCollaboratorField,CompleteSingleCollaboratorField,CompleteMultipleCollaboratorsField,MultipleCollaboratorsField}=require('@miniextensions/sdk/react'); module.exports={CreatedByField,SingleCollaboratorField,CompleteSingleCollaboratorField,CompleteMultipleCollaboratorsField,MultipleCollaboratorsField};";
writeFileSync('production-entry.' + (format === 'esm' ? 'mjs' : 'cjs'), script);
const result = await build({ entryPoints: ['production-entry.' + (format === 'esm' ? 'mjs' : 'cjs')], bundle: true, platform: 'browser', format: 'esm', minify: true, write: false, metafile: true, define: {'process.env.NODE_ENV':'"production"'} });
const inputs = Object.keys(result.metafile.inputs);
assert(inputs.some((path) => resolve(path) === join(sdk, 'dist', format, 'react/CompleteCollaboratorField.js')));
assert(inputs.some((path) => resolve(path) === join(sdk, 'dist', format, 'react/CreatedByField.js')));
assert(inputs.some((path) => resolve(path) === join(sdk, 'dist', format, 'react/completeCollaboratorPickerRuntime.js')));
assert(!inputs.some((path) => /[/\\](?:next|@headlessui)[/\\]/.test(path)), 'consumer must not supply native Next or dev Headless UI');
assert(result.outputFiles[0].contents.length > 0);
const provenance = JSON.parse(readFileSync(join(sdk, 'dist', format, 'react/complete-collaborators.provenance.json'), 'utf8'));
assert(provenance.packages.some((item) => item.name === '@headlessui/react' && item.version === '2.2.9'));
assert(provenance.inputs.length > 0);
console.log(JSON.stringify({ format, production: true, packedPickerInput: true, bundledVendorProvenance: true }));
`;

/** Independent installed public consumers; synthetic DOM is not native-browser proof. */
export function checkCompleteCollaboratorReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    archivePath = resolve(archivePath);
    const parent = mkdtempSync(
        join(tmpdir(), 'sdk-complete-collaborator-consumers-')
    );
    const profiles = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const directory = mkdtempSync(join(parent, version.react + '-'));
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: directory,
                    encoding: 'utf8',
                    timeout: 120000,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react: version.react,
                        'react-dom': version.react,
                        '@types/react': version.types,
                        '@types/react-dom': version.domTypes,
                    },
                })
            );
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
            ]);
            writeFileSync(
                join(directory, 'legacy-multiple.mjs'),
                `import {checkMultipleCollaboratorsConsumer} from ${JSON.stringify(
                    new URL(
                        './multiple-collaborators-consumer-checks.mjs',
                        import.meta.url
                    ).href
                )};
const result = await checkMultipleCollaboratorsConsumer({consumerDirectory:process.cwd(),happyDomModulePath:process.argv[2]});
console.log(JSON.stringify(result));`
            );
            const legacy = JSON.parse(
                run(process.execPath, [
                    'legacy-multiple.mjs',
                    happyDomModulePath,
                ]).trim()
            );
            assert.equal(legacy.checks, 86);
            writeFileSync(
                join(directory, 'legacy-multiple.tsx'),
                multipleCollaboratorsReactTypedConsumer
            );
            run(process.execPath, [
                typescriptBin,
                '--noEmit',
                '--strict',
                '--skipLibCheck',
                'false',
                '--module',
                'ESNext',
                '--moduleResolution',
                'Bundler',
                '--target',
                'ES2022',
                '--jsx',
                'react-jsx',
                'legacy-multiple.tsx',
            ]);
            writeFileSync(join(directory, 'consumer-runtime.mjs'), runtime);
            writeFileSync(
                join(directory, 'legacy-consumer.tsx'),
                singleCollaboratorReactTypedConsumer
            );
            run(process.execPath, [
                typescriptBin,
                '--noEmit',
                '--strict',
                '--skipLibCheck',
                'false',
                '--module',
                'NodeNext',
                '--moduleResolution',
                'NodeNext',
                '--target',
                'ES2022',
                '--jsx',
                'react-jsx',
                'legacy-consumer.tsx',
            ]);
            const legacyHelper = fileURLToPath(
                new URL(
                    './single-collaborator-consumer-checks.mjs',
                    import.meta.url
                )
            );
            writeFileSync(
                join(directory, 'legacy-consumer.mjs'),
                `import { checkSingleCollaboratorConsumer } from ${JSON.stringify(pathToFileURL(legacyHelper).href)}; console.log(JSON.stringify(await checkSingleCollaboratorConsumer({consumerDirectory:process.cwd(),happyDomModulePath:process.argv[2]})));`
            );
            const legacySingle = JSON.parse(
                run(process.execPath, [
                    'legacy-consumer.mjs',
                    happyDomModulePath,
                ])
            );
            assert.equal(legacySingle.checks, 94);
            const creatorHelper = new URL(
                './created-by-consumer-checks.mjs',
                import.meta.url
            ).href;
            writeFileSync(
                join(directory, 'creator-consumer.mjs'),
                `import {checkCreatedByConsumer} from ${JSON.stringify(creatorHelper)};console.log(JSON.stringify(await checkCreatedByConsumer({consumerDirectory:process.cwd(),happyDomModulePath:process.argv[2]})));`
            );
            const creator = JSON.parse(
                run(process.execPath, [
                    'creator-consumer.mjs',
                    happyDomModulePath,
                ]).trim()
            );
            assert.equal(creator.checks, 28);

            writeFileSync(
                join(directory, 'production-build.mjs'),
                productionBuild
            );
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            const css = readFileSync(
                join(installed, 'dist/esm/react/complete-collaborators.css')
            );
            assert(css.includes('.mx-sdk-complete-collaborators'));
            assert(!css.includes('@tailwind') && !css.includes('@apply'));
            for (const format of ['esm', 'cjs']) {
                const formatCssPath = `dist/${format}/react/complete-collaborators.css`;
                const formatCss = readFileSync(join(installed, formatCssPath));
                assert(formatCss.equals(css));
                assert(
                    formatCss.equals(
                        execFileSync('tar', [
                            '-xOf',
                            archivePath,
                            'package/' + formatCssPath,
                        ])
                    )
                );
                const suffix = format === 'esm' ? 'mts' : 'cts';
                const typed = `complete-collaborators.${suffix}`;
                const legacyTyped = `legacy-multiple.${suffix}`;
                writeFileSync(
                    join(directory, legacyTyped),
                    multipleCollaboratorsNodeTypedConsumer
                );
                writeFileSync(
                    join(directory, typed),
                    completeCollaboratorTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    typed,
                    legacyTyped,
                ]);
                const legacySingleTyped = `legacy-binding.${suffix}`;
                writeFileSync(
                    join(directory, legacySingleTyped),
                    singleCollaboratorNodeTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    legacySingleTyped,
                ]);
                const relative = `dist/${format}/react/CompleteCollaboratorField.js`;
                const child = readFileSync(join(installed, relative));
                assert(
                    child.equals(
                        execFileSync('tar', [
                            '-xOf',
                            archivePath,
                            'package/' + relative,
                        ])
                    )
                );
                const runtimeRelative = `dist/${format}/react/completeCollaboratorPickerRuntime.js`;
                const pickerRuntime = readFileSync(
                    join(installed, runtimeRelative)
                );
                assert(
                    pickerRuntime.equals(
                        execFileSync('tar', [
                            '-xOf',
                            archivePath,
                            'package/' + runtimeRelative,
                        ])
                    )
                );
                const declarations = readFileSync(
                    join(
                        installed,
                        `dist/${format}/react/CompleteCollaboratorField.d.ts`
                    ),
                    'utf8'
                );
                assert(
                    !declarations.includes('@headlessui') &&
                        !declarations.includes('fuse.js'),
                    'private picker dependency types must not leak'
                );
                for (const asset of ['LICENSES.txt', 'provenance.json']) {
                    const path = `dist/${format}/react/complete-collaborators.${asset}`;
                    assert(
                        readFileSync(join(installed, path)).equals(
                            execFileSync('tar', [
                                '-xOf',
                                archivePath,
                                'package/' + path,
                            ])
                        )
                    );
                }
                const ssr = JSON.parse(
                    run(process.execPath, [
                        'consumer-runtime.mjs',
                        'ssr',
                        format,
                    ]).trim()
                );
                const hydrationFile = `hydration-${format}.json`;
                writeFileSync(
                    join(directory, hydrationFile),
                    JSON.stringify({
                        html: ssr.html,
                        editable: ssr.editable,
                        creator: ssr.creator,
                    })
                );
                const dom = JSON.parse(
                    run(process.execPath, [
                        'consumer-runtime.mjs',
                        'dom',
                        format,
                        happyDomModulePath,
                        join(directory, hydrationFile),
                    ]).trim()
                );
                const production = JSON.parse(
                    run(process.execPath, [
                        'production-build.mjs',
                        esbuildModulePath,
                        format,
                    ]).trim()
                );
                assert.equal(ssr.react, version.react);
                assert.equal(ssr.groups, 2);
                assert.equal(ssr.cleanup, 'completed');
                assert.equal(dom.react, version.react);
                assert.equal(dom.groups, 8);
                assert.equal(dom.submits, 0);
                assert.equal(dom.requests, 0);
                assert.equal(dom.cleanup, 'completed');
                assert.equal(production.production, true);
                profiles.push({
                    react: version.react,
                    format,
                    ssr: true,
                    legacyBindingChecks: legacy.checks,
                    legacySingleBindingChecks: legacySingle.checks,
                    createdByChecks: creator.checks,
                    syntheticGroups: dom.groups,
                    production: true,
                    childSha256: createHash('sha256')
                        .update(child)
                        .digest('hex'),
                    runtimeSha256: createHash('sha256')
                        .update(pickerRuntime)
                        .digest('hex'),
                    cssSha256: createHash('sha256').update(css).digest('hex'),
                });
            }
            console.log(
                `Installed complete Collaborator React${version.react}: actual ESM/CJS picker/search/native objects/refusal/focus/readonly, strict types, SSR and production browser bundles passed in synthetic DOM; native browser acceptance remains separate.`
            );
        }
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
    return { profiles, cleanup: 'completed' };
}
