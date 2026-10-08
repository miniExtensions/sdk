import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

/** Actual installed SDK/React and copied starter; synthetic transport, no native/persistence claim. */
export async function checkDateBindingConsumer({
    consumerDirectory,
    starterDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const packageRoot = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const forms = await import(
        pathToFileURL(join(packageRoot, 'forms/index.js'))
    );
    const ui = await import(pathToFileURL(join(packageRoot, 'ui/index.js')));
    const api = await import(
        pathToFileURL(join(packageRoot, 'react/index.js'))
    );
    const portals = await import(
        pathToFileURL(join(packageRoot, 'portals/index.js'))
    );
    const runtime = await import(
        pathToFileURL(join(packageRoot, 'runtime/index.js'))
    );
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
    let owner, root, stock, custom;
    let checks = 0;
    const config = (type, timeZone = 'UTC') => ({
        type,
        options: {
            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
            ...(type === 'dateTime'
                ? { timeFormat: { name: '24hour', format: 'HH:mm' }, timeZone }
                : {}),
        },
    });
    try {
        for (const name of ['DateField', 'DateTimeField'])
            assert.equal(
                typeof require('@miniextensions/sdk/react')[name],
                'function'
            );
        const cjs = require('@miniextensions/sdk/ui');
        let native = null;
        const cjsModel = cjs.createDateFieldModel({
            kind: 'date',
            getValue: () => native,
            getConfig: () => config('date'),
            canEdit: () => true,
            isCurrent: () => true,
            write: (value) => {
                native = value;
                return true;
            },
        });
        assert.equal(cjsModel.setInput('2011-12-30'), true);
        assert.equal(native, '2011-12-30');
        cjsModel.destroy();
        checks++;
        const pinned = JSON.parse(
            readFileSync(
                new URL('../test/fixtures/reviewDates.json', import.meta.url),
                'utf8'
            )
        );
        let comparisons = 0;
        for (const sample of pinned.cases) {
            if (sample.normalized) continue; // Canonical local-midnight normalization is deliberately not the calendar editor contract.
            const model = ui.createDateFieldModel({
                kind: sample.config.type,
                getValue: () => sample.value,
                getConfig: () => sample.config,
                getClientTimeZone: () => sample.localZone,
                canEdit: () => true,
                isCurrent: () => true,
                write: () => {
                    throw Error('No formatting write');
                },
            });
            assert.equal(model.getState().display, sample.expected);
            model.destroy();
            comparisons++;
        }
        assert(comparisons > 400);
        checks++;
        const page = fixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        page.payload.hasParentExtension = false;
        page.payload.fieldIdsInForm = ['fld_date', 'fld_time', 'fld_locked'];
        page.payload.fieldIdsToSchemas = {};
        for (const [id, type, readOnly] of [
            ['fld_date', 'date', false],
            ['fld_time', 'dateTime', false],
            ['fld_locked', 'date', true],
        ])
            page.payload.fieldIdsToSchemas[id] = {
                fieldType: type,
                airtableField: {
                    id,
                    name: id,
                    isComputed: false,
                    config: config(type),
                },
                miniExtConfig: { readOnly },
            };
        page.payload.formRecord = {
            type: 'create',
            data: {
                fld_date: '2011-12-30',
                fld_time: '2024-11-03T01:30:00.120-07:00',
                fld_locked: '2024-02-29',
                fld_hidden: 'Retained native',
                fld_hidden_date: '2011-12-30',
            },
        };
        page.payload.formFieldIdsWithUnsavedChanges = ['fld_hidden'];
        page.payload.urlPrefilledFieldIds = [];
        let scope = 0,
            zone = 'America/Los_Angeles';
        const saves = [];
        const client = runtime.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('No automatic I/O');
            },
        });
        client.forms.save = async (input) => {
            saves.push(structuredClone(input));
            return { type: 'error', formValidationErrors: [], formErrors: {} };
        };
        const options = {
            client,
            loaded: page,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                context: { type: 'direct-url' },
                searchQuery: {},
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
            getScope: () => ({ ownerId: 'A', revision: scope }),
            getClientTimeZone: () => zone,
        };
        owner = forms.createFormFieldBindings(options);
        const date = owner.field('fld_date'),
            time = owner.field('fld_time');
        const host = window.document.createElement('div');
        window.document.body.append(host);
        root = createRoot(host);
        const tree = () =>
            h(
                StrictMode,
                null,
                h(api.DateField, { binding: date }),
                h(api.DateTimeField, {
                    binding: time,
                    render: ({ snapshot, binding }) =>
                        h(
                            'label',
                            null,
                            'Custom timestamp',
                            h('input', {
                                id: 'custom_time',
                                value: snapshot.date.input,
                                disabled: !snapshot.date.canEdit,
                                onChange: (event) =>
                                    binding.date.setInput(
                                        event.currentTarget.value
                                    ),
                            }),
                            h('span', null, snapshot.date.error)
                        ),
                })
            );
        await act(async () => root.render(tree()));
        assert.equal(saves.length, 0);
        checks++;
        const input = host.querySelector('input');
        const inputText = async (node, text) =>
            act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(node, text);
                node.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                node.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
            });
        await inputText(input, '2024-');
        assert.equal(date.getSnapshot().date.input, '2024-');
        assert.equal(date.getSnapshot().value, '2011-12-30');
        await assert.rejects(owner.save());
        assert.equal(saves.length, 0);
        checks++;
        await act(async () => root.render(null));
        await act(async () => root.render(tree()));
        assert.equal(host.querySelector('input').value, '2024-');
        checks++;
        await inputText(host.querySelector('input'), '2024-02-29');
        await inputText(
            host.querySelector('#custom_time'),
            '2024-11-03T01:30:00.120-08:00'
        );
        assert.equal(time.getSnapshot().value, '2024-11-03T01:30:00.120-08:00');
        await act(async () => owner.save());
        assert.deepEqual(saves[0].formRecord, {
            type: 'create',
            data: {
                ...page.payload.formRecord.data,
                fld_date: '2024-02-29',
                fld_time: '2024-11-03T01:30:00.120-08:00',
            },
        });
        assert.deepEqual(
            new Set(saves[0].formFieldIdsWithUnsavedChanges),
            new Set(['fld_hidden', 'fld_date', 'fld_time'])
        );
        checks++;
        assert.equal(owner.field('fld_locked').date.clear(), false);
        assert.equal(
            owner.field('fld_locked').getSnapshot().value,
            '2024-02-29'
        );
        checks++;
        const held = time.date.setInput;
        await act(async () => {
            scope++;
            owner.refresh();
        });
        assert.equal(held('2024-01-01T12:00:00Z'), false);
        assert.equal(saves.length, 1);
        checks++;
        await act(async () => root.unmount());
        root = null;
        owner.destroy();
        owner = forms.createFormFieldBindings(options);
        const outfile = join(
            consumerDirectory,
            '.generated/date-stock-check.mjs'
        );
        const built = await build({
            absWorkingDir: starterDirectory,
            stdin: {
                contents:
                    "export { mountBoundFormField } from './src/fields.ts'; export { mountCustomField } from './src/customFieldRenderer.ts';",
                resolveDir: starterDirectory,
                sourcefile: 'date-stock-check.ts',
            },
            bundle: true,
            format: 'esm',
            platform: 'browser',
            outfile,
            metafile: true,
            logLevel: 'silent',
        });
        const copied = await import(pathToFileURL(outfile));
        const binding = owner.field('fld_date');
        stock = copied.mountBoundFormField(
            binding,
            page.payload.fieldIdsToSchemas.fld_date,
            () => {}
        );
        custom = copied.mountCustomField(binding, window.document);
        window.document.body.append(stock.node, custom.node);
        const stockInput = stock.node.querySelector('input');
        stockInput.value = '2024-';
        stockInput.dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(custom.node.querySelector('input').value, '2024-');
        assert.equal(binding.getSnapshot().value, '2011-12-30');
        checks++;
        custom.node.querySelector('input').value = '2024-03-01';
        custom.node
            .querySelector('input')
            .dispatchEvent(new window.Event('input', { bubbles: true }));
        assert.equal(stockInput.value, '2024-03-01');
        assert.equal(binding.getSnapshot().value, '2024-03-01');
        checks++;
        stock.destroy();
        stock = copied.mountBoundFormField(
            binding,
            page.payload.fieldIdsToSchemas.fld_date,
            () => {}
        );
        assert.equal(stock.node.querySelector('input').value, '2024-03-01');
        checks++;
        {
            let clientZone = 'America/Los_Angeles';
            const native = '2024-07-01T12:00:00Z';
            const model = ui.createDateFieldModel({
                kind: 'dateTime',
                getValue: () => native,
                getConfig: () => config('dateTime', 'client'),
                getClientTimeZone: () => clientZone,
                canEdit: () => true,
                isCurrent: () => true,
                write: () => {
                    throw Error('No stale edit');
                },
            });
            assert.equal(model.getState().display, '2024-07-01 05:00');
            clientZone = 'America/Coyhaique';
            assert.equal(model.getState().retired, true);
            assert.equal(model.clear(), false);
            model.destroy();
            checks++;
        }
        {
            const clientPage = structuredClone(page);
            clientPage.payload.fieldIdsToSchemas.fld_time.airtableField.config.options.timeZone =
                'client';
            const fresh = forms.createFormFieldBindings({
                ...options,
                loaded: clientPage,
            });
            const binding = fresh.field('fld_time');
            const host = window.document.createElement('div');
            window.document.body.append(host);
            const renderer = createRoot(host);
            await act(async () =>
                renderer.render(h(api.DateTimeField, { binding }))
            );
            assert(host.querySelector('input'));
            zone = 'Asia/Kathmandu';
            await act(async () =>
                renderer.render(h(api.DateTimeField, { binding }))
            );
            assert.equal(host.querySelector('input'), null);
            assert(host.textContent.includes('Load a fresh Form'));
            await assert.rejects(fresh.save());
            assert.equal(saves.length, 1);
            await act(async () => renderer.unmount());
            fresh.destroy();
            checks++;
        }
        const journal = new forms.RecoveryJournal();
        let writes = 0;
        client.portals.updateGridCell = async (input) => {
            writes++;
            assert.equal(input.value, '2024-02-29');
            return {
                auditTrail: null,
                auditTrails: [],
                record: { id: 'rec_one', fields: { fld_date: input.value } },
            };
        };
        const cell = portals.createPortalCellBinding({
            client,
            input: {
                portalExtensionAccessToken: 'token_example',
                portalFieldId: 'fld_children',
                recordFieldId: 'fld_date',
                recordId: 'rec_one',
                selectedCustomViewId: 'view_example',
            },
            schema: page.payload.fieldIdsToSchemas.fld_date,
            value: '2011-12-30',
            getScope: () => ({ ownerId: 'A', revision: 0 }),
            isCurrent: () => true,
            recovery: {
                journal,
                scope: {
                    owner: 'A',
                    parentFieldId: 'fld_children',
                    tableId: 'table_example',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        });
        assert.equal(cell.binding.date.setInput('2024-'), false);
        await assert.rejects(cell.save());
        assert.equal(writes, 0);
        assert.equal(cell.binding.date.setInput('2024-02-29'), true);
        await cell.save();
        assert.equal(writes, 1);
        await assert.rejects(cell.save());
        cell.destroy();
        checks++;
        console.log(
            `Installed date bindings: ${checks} checkpoints, ${comparisons} pinned presentation comparisons; synthetic dispatch only.`
        );
        return checks;
    } finally {
        stock?.destroy();
        custom?.destroy();
        owner?.destroy();
        if (root) await act(async () => root.unmount());
        await window.happyDOM.close();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
    }
}
