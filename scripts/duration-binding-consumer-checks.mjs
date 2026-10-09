import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

/** Actual installed ESM/CJS and copied renderers; synthetic DOM/transport only. */
export async function checkDurationBindingConsumer({
    consumerDirectory,
    starterDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const packageRoot = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const load = (name) =>
        import(pathToFileURL(join(packageRoot, name, 'index.js')));
    const [ui, forms, portals, api] = await Promise.all(
        ['ui', 'forms', 'portals', 'react'].map(load)
    );
    let checks = 0;
    for (const sdk of [ui, require('@miniextensions/sdk/ui')]) {
        let native = 3600.123456,
            writes = 0,
            current = true,
            format = 'h:mm';
        const model = sdk.createDurationFieldModel({
            getValue: () => native,
            getDurationFormat: () => format,
            canEdit: () => true,
            isCurrent: () => current,
            write(value) {
                native = value;
                writes++;
                return true;
            },
        });
        const display = model.getState().input;
        assert.equal(model.getState().kind, 'duration');
        model.setFocused(true);
        model.setFocused(false);
        assert.equal(native, 3600.123456);
        assert.equal(writes, 0);
        assert.equal(model.getState().input, display);
        for (const invalid of ['1:', '1:2.5', '1:2:3:4', 'Infinity', '1e2']) {
            assert.equal(model.setInput(invalid), false, invalid);
            assert.equal(native, 3600.123456);
            assert.equal(writes, 0);
        }
        for (const [text, seconds] of [
            ['1.5', 90],
            ['1:02', 3720],
            ['1:02:03.5', 3723.5],
            ['', null],
        ]) {
            assert.equal(model.setInput(text), true, text);
            assert.equal(native, seconds);
        }
        format = 'h:mm:ss';
        assert.equal(model.setInput('1:02.5'), false);
        assert.equal(model.getState().retired, true);
        current = false;
        assert.equal(model.setFocused(true), false);
        model.destroy();
        checks++;
        for (const nextFormat of [
            'h:mm:ss',
            'h:mm:ss.S',
            'h:mm:ss.SS',
            'h:mm:ss.SSS',
        ]) {
            let value = null;
            const next = sdk.createDurationFieldModel({
                getValue: () => value,
                getDurationFormat: () => nextFormat,
                canEdit: () => true,
                isCurrent: () => true,
                write: (v) => {
                    value = v;
                    return true;
                },
            });
            assert.equal(next.setInput('1:02.5'), true);
            assert.equal(value, 62.5);
            next.destroy();
            checks++;
        }
    }
    for (const sdk of [ui, require('@miniextensions/sdk/ui')]) {
        for (const action of ['focus', 'invalid-input']) {
            let armed = false,
                format = 'h:mm',
                writes = 0;
            const native = 3600.123456;
            const model = sdk.createDurationFieldModel({
                getValue: () => native,
                getDurationFormat: () => format,
                canEdit() {
                    if (armed) format = 'h:mm:ss.SSS';
                    return true;
                },
                isCurrent: () => true,
                write() {
                    writes++;
                    return true;
                },
            });
            // Initialize before canEdit starts withdrawing the captured configuration.
            assert.equal(model.getState().durationFormat, 'h:mm');
            armed = true;
            assert.equal(
                action === 'focus'
                    ? model.setFocused(true)
                    : model.setInput('1:'),
                false,
                action
            );
            assert.equal(model.getState().retired, true, action);
            assert.equal(writes, 0, action);
            assert.equal(native, 3600.123456, action);
            model.destroy();
            checks++;
        }
    }
    for (const sdk of [ui, require('@miniextensions/sdk/ui')]) {
        for (const native of [1e308, -1e308]) {
            let writes = 0;
            const model = sdk.createDurationFieldModel({
                getValue: () => native,
                getDurationFormat: () => 'h:mm:ss.SSS',
                canEdit: () => true,
                isCurrent: () => true,
                write() {
                    writes++;
                    return true;
                },
            });
            const state = model.getState();
            assert.equal(state.valid, false);
            assert.equal(typeof state.error, 'string');
            assert.doesNotMatch(state.input, /Infinity|NaN|∞/);
            model.setFocused(true);
            model.setFocused(false);
            assert.equal(model.getState().valid, false);
            assert.doesNotMatch(model.getState().input, /Infinity|NaN|∞/);
            assert.equal(writes, 0);
            model.destroy();
            checks++;
        }
    }
    for (const sdk of [ui, require('@miniextensions/sdk/ui')]) {
        let native = 7,
            writes = 0;
        const model = sdk.createDurationFieldModel({
            getValue: () => native,
            getDurationFormat: () => 'h:mm:ss.SSS',
            canEdit: () => true,
            isCurrent: () => true,
            write(value) {
                native = value;
                writes++;
                model.getState();
                return true;
            },
        });
        model.getState();
        model.setFocused(true);
        assert.equal(model.setInput('01:02.500'), true);
        assert.equal(native, 62.5);
        assert.equal(model.getState().input, '01:02.500');
        assert.equal(model.getState().valid, true);
        assert.equal(writes, 1);
        model.setFocused(false);
        assert.equal(model.getState().input, '1:02.500');
        assert.equal(native, 62.5);
        assert.equal(writes, 1);
        model.destroy();
        checks++;
    }
    const pinned = JSON.parse(
        readFileSync(
            new URL(
                '../test/fixtures/duration-input-canonical.json',
                import.meta.url
            ),
            'utf8'
        )
    );
    let comparisons = 0;
    for (const sdk of [ui, require('@miniextensions/sdk/ui')]) {
        for (const sample of pinned.inputCases) {
            let value = 17,
                writes = 0;
            const model = sdk.createDurationFieldModel({
                getValue: () => value,
                getDurationFormat: () => sample.durationFormat,
                canEdit: () => true,
                isCurrent: () => true,
                write(v) {
                    value = v;
                    writes++;
                    return true;
                },
            });
            const accepted = model.setInput(sample.input);
            assert.equal(accepted, sample.admission === 'admitted', sample.id);
            if (accepted) assert.equal(value, sample.seconds, sample.id);
            else {
                assert.equal(value, 17, sample.id);
                assert.equal(writes, 0, sample.id);
            }
            model.destroy();
            comparisons++;
        }
        for (const sample of pinned.nativeCases) {
            const value = Number(sample.secondsText);
            const model = sdk.createDurationFieldModel({
                getValue: () => value,
                getDurationFormat: () => sample.durationFormat,
                canEdit: () => true,
                isCurrent: () => true,
                write() {
                    throw Error('Formatting must not write');
                },
            });
            assert.equal(model.getState().input, sample.formatted, sample.id);
            model.setFocused(true);
            model.setFocused(false);
            assert.equal(model.getState().input, sample.formatted, sample.id);
            model.destroy();
            comparisons++;
        }
    }
    assert.equal(comparisons, 470);
    checks++;
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'HTMLSelectElement',
        'Event',
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
    let root, owner, stock, custom, rendererHost;
    try {
        assert.equal(
            typeof require('@miniextensions/sdk/react').DurationField,
            'function'
        );
        const page = fixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        page.payload.hasParentExtension = false;
        page.payload.fieldIdsInForm = ['fld_duration', 'fld_locked'];
        page.payload.fieldIdsToSchemas = {};
        for (const id of page.payload.fieldIdsInForm)
            page.payload.fieldIdsToSchemas[id] = {
                fieldType: 'duration',
                airtableField: {
                    id,
                    name: id,
                    isComputed: false,
                    isPrimaryField: false,
                    description: null,
                    config: {
                        type: 'duration',
                        options: { durationFormat: 'h:mm:ss.SSS' },
                    },
                },
                miniExtConfig: { readOnly: id === 'fld_locked' },
            };
        page.payload.formRecord = {
            type: 'create',
            data: {
                fld_duration: 3600.123456,
                fld_locked: 17,
                fld_hidden: 'retained',
            },
        };
        page.payload.formFieldIdsWithUnsavedChanges = ['fld_hidden'];
        page.payload.urlPrefilledFieldIds = [];
        let scope = { ownerId: 'A', revision: 0 },
            editable = true;
        const saves = [],
            updates = [];
        const client = {
            getSession: () => ({}),
            forms: {
                save: async (input) => {
                    saves.push(structuredClone(input));
                    return {
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    };
                },
            },
            portals: {
                updateGridCell: async (input) => {
                    updates.push(structuredClone(input));
                    return {
                        auditTrail: null,
                        auditTrails: [],
                        record: {
                            id: 'rec_one',
                            fields: { fld_duration: input.value },
                        },
                    };
                },
            },
        };
        const options = {
            client,
            loaded: page,
            getScope: () => scope,
            canWriteField: () => editable,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        };
        for (const packedForms of [
            forms,
            require('@miniextensions/sdk/forms'),
        ]) {
            const loaded = structuredClone(page);
            loaded.payload.publicFields = {
                type: 'form',
                state: {
                    multiPageFormMode: 'multi-page',
                    promptUserBeforeSubmission: false,
                    enableFormComputeMode: false,
                    autoSubmitAfterPrefill: false,
                },
            };
            for (const id of loaded.payload.fieldIdsInForm)
                Object.assign(
                    loaded.payload.fieldIdsToSchemas[id].miniExtConfig,
                    {
                        enableSectionHeader: true,
                        headerSectionTitle:
                            id === 'fld_duration'
                                ? 'Duration'
                                : 'Locked duration',
                    }
                );
            let dispatches = 0;
            const calls = [];
            const fields = packedForms.createFormFieldBindings({
                ...options,
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async (input) => {
                            calls.push(structuredClone(input));
                            return {
                                type: 'error',
                                formValidationErrors: [],
                                formErrors: {},
                            };
                        },
                    },
                },
            });
            const pages = packedForms.createFormPageOwner({
                fields,
                isCurrent: () => true,
                configurationRevision: () => 1,
            });
            try {
                assert.equal(
                    fields.field('fld_duration').scalar.setInput('-'),
                    false
                );
                assert.equal(
                    fields.field('fld_duration').getSnapshot().value,
                    3600.123456
                );
                assert.equal(pages.getSnapshot().canNext, false);
                assert.equal(
                    pages.next(pages.getSnapshot().revision).accepted,
                    false
                );
                assert.equal(calls.length, 0);
                assert.equal(dispatches, 0);
                assert.equal(
                    fields.field('fld_locked').scalar.setInput('-'),
                    false
                );
                assert.equal(
                    fields.field('fld_locked').getSnapshot().value,
                    17
                );
                assert.equal(
                    fields.field('fld_duration').scalar.setInput('1:02.5'),
                    true
                );
                assert.equal(pages.getSnapshot().canNext, true);
                assert.equal(
                    pages.next(pages.getSnapshot().revision).accepted,
                    true
                );
                assert.equal(calls.length, 0);
                await pages.submit(pages.getSnapshot().revision, {
                    lifecycle: {
                        dispatch() {
                            dispatches++;
                            return { accepted() {}, finish() {} };
                        },
                    },
                });
                assert.equal(dispatches, 1);
                assert.deepEqual(calls, [
                    {
                        ...options.saveOptions,
                        extensionAccessToken:
                            loaded.payload.extensionAccessToken,
                        formRecord: {
                            type: 'create',
                            data: {
                                ...loaded.payload.formRecord.data,
                                fld_duration: 62.5,
                            },
                        },
                        formFieldIdsWithUnsavedChanges: [
                            'fld_hidden',
                            'fld_duration',
                        ],
                    },
                ]);
                checks++;
            } finally {
                pages.dispose();
                fields.destroy();
            }
        }
        const cjsOwner =
            require('@miniextensions/sdk/forms').createFormFieldBindings(
                options
            );
        const cjsHost =
            require('@miniextensions/sdk/ui').createFormFieldRendererHost({
                fields: cjsOwner,
                fieldId: 'fld_duration',
                isCurrent: () => true,
                configurationRevision: () => 1,
            });
        try {
            const props = cjsHost.getSnapshot().fields[0];
            assert.equal(props.physicalKind, 'duration');
            assert.equal(props.capability.scalar.setInput('1:02.5'), true);
            assert.equal(
                cjsOwner.field('fld_duration').getSnapshot().value,
                62.5
            );
            assert.equal(props.capability.scalar.setFocused(true), true);
            checks++;
        } finally {
            cjsHost.dispose();
            cjsOwner.destroy();
        }
        owner = forms.createFormFieldBindings(options);
        const binding = owner.field('fld_duration');
        assert.equal(binding.duration, undefined);
        const container = window.document.createElement('div');
        window.document.body.append(container);
        root = createRoot(container);
        const tree = () =>
            h(
                StrictMode,
                null,
                h(api.DurationField, { binding }),
                h(api.DurationField, {
                    binding,
                    render: ({ snapshot, binding: bound }) =>
                        h('input', {
                            id: 'custom_duration',
                            value: snapshot.scalar.input,
                            onChange: (event) =>
                                bound.scalar.setInput(
                                    event.currentTarget.value
                                ),
                            onFocus: () => bound.scalar.setFocused(true),
                            onBlur: () => bound.scalar.setFocused(false),
                        }),
                })
            );
        await act(async () => root.render(tree()));
        const setText = async (node, text) =>
            act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(node, text);
                node.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        await act(async () => container.querySelector('input').focus());
        await act(async () => container.querySelector('input').blur());
        assert.equal(binding.getSnapshot().value, 3600.123456);
        assert.equal(binding.getSnapshot().dirty, false);
        assert.equal(saves.length, 0);
        checks++;
        await setText(container.querySelector('input'), '1:');
        assert.equal(binding.getSnapshot().scalar.input, '1:');
        assert.equal(binding.getSnapshot().value, 3600.123456);
        let attempts = 0;
        await assert.rejects(
            owner.save({
                lifecycle: {
                    dispatch() {
                        attempts++;
                        throw Error('No journal attempt');
                    },
                },
            })
        );
        assert.equal(attempts, 0);
        assert.equal(saves.length, 0);
        checks++;
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(container.querySelector('#custom_duration').value, '1:');
        checks++;
        await act(async () => binding.scalar.setFocused(true));
        await setText(
            container.querySelector('#custom_duration'),
            '01:02:03.500'
        );
        assert.equal(binding.getSnapshot().scalar.input, '01:02:03.500');
        assert.equal(binding.getSnapshot().value, 3723.5);
        await act(async () => binding.scalar.setFocused(false));
        assert.notEqual(binding.getSnapshot().scalar.input, '01:02:03.500');
        assert.equal(binding.getSnapshot().value, 3723.5);
        await act(async () => owner.save());
        assert.deepEqual(saves[0], {
            ...options.saveOptions,
            extensionAccessToken: page.payload.extensionAccessToken,
            formRecord: {
                type: 'create',
                data: { ...page.payload.formRecord.data, fld_duration: 3723.5 },
            },
            formFieldIdsWithUnsavedChanges: ['fld_hidden', 'fld_duration'],
        });
        assert.deepEqual(
            new Set(saves[0].formFieldIdsWithUnsavedChanges),
            new Set(['fld_hidden', 'fld_duration'])
        );
        checks++;
        assert.equal(owner.field('fld_locked').scalar.setInput('2'), false);
        assert.equal(owner.field('fld_locked').getSnapshot().value, 17);
        editable = false;
        await act(async () => owner.refresh());
        assert.equal(binding.scalar.setInput('9'), false);
        editable = true;
        await act(async () => owner.refresh());
        checks++;
        for (const nested of ['2', '1:']) {
            await act(async () => binding.setValue(0));
            let fired = false;
            const stop = binding.subscribe((snapshot) => {
                if (!fired && snapshot.value === 1) {
                    fired = true;
                    binding.scalar.setInput(nested);
                }
            });
            await act(async () => binding.scalar.setInput('1'));
            stop();
            assert.equal(fired, true);
            assert.equal(binding.scalar.getState().input, nested);
            assert.equal(binding.getSnapshot().value, nested === '2' ? 2 : 1);
            if (nested === '1:') await assert.rejects(owner.save());
            checks++;
        }
        await act(async () => binding.scalar.setInput('3'));
        rendererHost = ui.createFormFieldRendererHost({
            fields: owner,
            fieldId: 'fld_duration',
            isCurrent: () => true,
            configurationRevision: () => 1,
        });
        let props;
        await act(async () =>
            root.render(
                h(api.FieldRenderer, {
                    host: rendererHost,
                    renderers: {
                        renderDurationField: (p) => {
                            props = p;
                            return h(
                                'span',
                                null,
                                p.capability.scalar?.state.input
                            );
                        },
                    },
                    fallback: () => null,
                })
            )
        );
        assert.equal(props.capability.type, 'editable');
        assert.equal(typeof props.capability.scalar.setFocused, 'function');
        await act(async () => props.capability.scalar.setInput('4'));
        assert.equal(binding.getSnapshot().value, 4);
        checks++;
        rendererHost.dispose();
        rendererHost = null;
        const documentation = readFileSync(
            new URL('../docs/field-bindings.md', import.meta.url),
            'utf8'
        );
        const recipe = [
            ...documentation.matchAll(/```tsx\n([\s\S]*?)```/g),
        ].find((match) =>
            match[1].includes('export function DurationClock')
        )?.[1];
        assert.ok(
            recipe,
            'Actual DurationClock documentation recipe is required'
        );
        const recipeFile = join(
            consumerDirectory,
            '.generated/duration-recipe-check.mjs'
        );
        await build({
            absWorkingDir: consumerDirectory,
            stdin: {
                contents: recipe,
                resolveDir: consumerDirectory,
                sourcefile: 'duration-recipe.tsx',
                loader: 'tsx',
            },
            bundle: true,
            external: ['react', 'react-dom', '@miniextensions/sdk/react'],
            format: 'esm',
            platform: 'node',
            outfile: recipeFile,
            logLevel: 'silent',
            jsx: 'automatic',
        });
        const { DurationClock } = await import(pathToFileURL(recipeFile));
        await act(async () =>
            root.render(h(StrictMode, null, h(DurationClock, { binding })))
        );
        await setText(container.querySelector('input'), '1:02.5');
        assert.equal(binding.getSnapshot().value, 62.5);
        assert.equal(
            container.querySelector('input').value,
            binding.scalar.getState().input
        );
        checks++;
        await act(async () => root.unmount());
        root = null;
        const outfile = join(
            consumerDirectory,
            '.generated/duration-stock-check.mjs'
        );
        await build({
            absWorkingDir: starterDirectory,
            stdin: {
                contents:
                    "export { mountBoundFormField } from './src/fields.ts'; export { mountCustomField } from './src/customFieldRenderer.ts';",
                resolveDir: starterDirectory,
                sourcefile: 'duration-stock-check.ts',
            },
            bundle: true,
            format: 'esm',
            platform: 'browser',
            outfile,
            logLevel: 'silent',
        });
        const copied = await import(pathToFileURL(outfile));
        stock = copied.mountBoundFormField(
            binding,
            page.payload.fieldIdsToSchemas.fld_duration,
            () => {}
        );
        custom = copied.mountCustomField(binding, window.document);
        window.document.body.append(stock.node, custom.node);
        const stockInput = stock.node.querySelector('input');
        stockInput.dispatchEvent(new window.Event('focus'));
        stockInput.value = '01:02.50';
        stockInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(binding.getSnapshot().value, 62.5);
        assert.equal(custom.node.querySelector('input').value, '01:02.50');
        stockInput.dispatchEvent(new window.Event('blur'));
        assert.equal(binding.getSnapshot().value, 62.5);
        assert.equal(
            custom.node.querySelector('input').value,
            stockInput.value
        );
        checks++;
        stock.destroy();
        stock = copied.mountBoundFormField(
            binding,
            page.payload.fieldIdsToSchemas.fld_duration,
            () => {}
        );
        assert.equal(
            stock.node.querySelector('input').value,
            binding.scalar.getState().input
        );
        checks++;
        const heldInput = binding.scalar.setInput,
            heldFocus = binding.scalar.setFocused;
        scope = { ownerId: 'B', revision: 1 };
        owner.refresh();
        assert.equal(heldInput('5'), false);
        assert.equal(heldFocus(true), false);
        scope = { ownerId: 'A', revision: 2 };
        owner.refresh();
        assert.equal(heldInput('6'), false);
        checks++;
        const journal = new forms.RecoveryJournal();
        const recovery = {
            journal,
            scope: {
                owner: 'A',
                parentFieldId: 'fld_children',
                tableId: 'table_example',
                childExtensionId: '',
                context: 'modal',
            },
            loadVersion: 1,
        };
        const cell = portals.createPortalCellBinding({
            client,
            input: {
                portalExtensionAccessToken: 'token_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_duration',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
            },
            schema: page.payload.fieldIdsToSchemas.fld_duration,
            value: 3600.123456,
            getScope: () => ({ ownerId: 'A', revision: 0 }),
            isCurrent: () => true,
            recovery,
        });
        try {
            cell.binding.scalar.setFocused(true);
            cell.binding.scalar.setFocused(false);
            assert.equal(cell.binding.getSnapshot().value, 3600.123456);
            assert.equal(cell.binding.scalar.setInput('1:'), false);
            await assert.rejects(cell.save());
            assert.equal(updates.length, 0);
            assert.equal(
                journal.blocking(recovery.scope, 'rec_one'),
                undefined
            );
            assert.equal(cell.binding.scalar.setInput('1:02.5'), true);
            await cell.save();
            assert.equal(updates[0].value, 62.5);
            checks++;
        } finally {
            cell.destroy();
        }
        console.log(
            `Installed duration bindings: ${checks} checkpoints, ${comparisons} pinned comparisons; ESM/CJS, React StrictMode/remount, host, copied-starter and Portal checkpoints; synthetic DOM/dispatch only.`
        );
        return checks;
    } finally {
        rendererHost?.dispose();
        stock?.destroy();
        custom?.destroy();
        if (root) await act(async () => root.unmount());
        owner?.destroy();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
        await window.happyDOM.close();
    }
}

export const durationTypedConsumer = `
import { createDurationFieldModel, type DurationFieldModel, type ScalarFieldModel, type FieldRendererSlots } from '@miniextensions/sdk/ui';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
export function typedDuration(binding: FormFieldBinding) {
    const model: DurationFieldModel = createDurationFieldModel({ getValue: () => 0, getDurationFormat: () => 'h:mm', canEdit: () => true, isCurrent: () => true, write: () => true });
    const retainedFocus: (focused: boolean) => boolean = model.setFocused;
    const focused: boolean = model.getState().focused;
    const scalar: ScalarFieldModel = model;
    scalar.setFocused?.(focused);
    binding.scalar?.setFocused?.(true);
    // @ts-expect-error there is one scalar owner, no duration owner
    binding.duration;
    return retainedFocus;
}
export const durationRegistry: FieldRendererSlots<unknown> = { renderDurationField(props) {
    if (props.capability.type === 'editable' && props.capability.scalar) {
        const held: (focused: boolean) => boolean = props.capability.scalar.setFocused;
        held(true);
    }
    return null;
} };
`;
export const durationReactTypedConsumer = `
import { createElement } from 'react';
import { DurationField } from '@miniextensions/sdk/react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
export function typedDurationReact(binding: FormFieldBinding) {
    return createElement(DurationField, { binding, render: ({ binding: bound, snapshot }) => {
        const focus = bound.scalar?.setFocused;
        focus?.(true);
        return createElement('input', { value: snapshot.scalar?.input, onFocus: () => focus?.(true), onBlur: () => focus?.(false) });
    } });
}
`;
