import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type FormLoadedResult,
    type RuntimeConditionsDefinition,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';

const root = resolve(process.cwd());
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-visibility-'));
    await build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
            '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
});

after(async () => rm(directory, { recursive: true, force: true }));

const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 30; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('The actual starter did not reach the expected state.');
};

// This oracle observes the mounted control, including any hidden ancestor.
// Retaining a node in memory is allowed; presenting a denied control is not.
const isPresented = (window: Window, fieldId: string): boolean => {
    const input = window.document.querySelector(`[data-field-id="${fieldId}"]`);
    return input !== null && input.closest('[hidden]') === null;
};

const mount = async (
    test: TestContext,
    getForm: () => FormLoadedResult,
    saves: SaveFormInput[]
) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    const markup = await readFile(
        join(root, 'examples/browser/index.html'),
        'utf8'
    );
    window.document.write(
        markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const route = new URL(String(input)).searchParams.get('route');
            if (route === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(getForm()));
            if (route === 'saveForm') {
                saves.push(JSON.parse(String(init?.body)));
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    })
                );
            }
            throw new Error('Unexpected visibility fixture request.');
        },
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
    });
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
    );
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    const connection = window.document.getElementById('connection-form');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    assert.ok(connection);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_example';
    connection.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
    return window;
};

describe('actual browser starter conditional visibility', () => {
    it('hides and restores controls without clearing native edit drafts or changing Save types', async (test) => {
        const form = loadedForm();
        const predicate: RuntimeConditionsDefinition = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'visibility_driver',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: AirtableFieldType.CHECKBOX,
                        idOrName: { type: 'id', id: 'fld_driver' },
                        value: true,
                    },
                },
            ],
        };
        const title = form.payload.fieldIdsToSchemas.fld_title;
        const readonly = form.payload.fieldIdsToSchemas.fld_readonly;
        assert.ok(title && readonly);
        title.miniExtConfig = { conditionalFields: predicate };
        readonly.miniExtConfig = {
            readOnly: true,
            conditionalFields: predicate,
        };
        form.payload.fieldIdsToSchemas.fld_driver = {
            fieldType: AirtableFieldType.CHECKBOX,
            airtableField: {
                id: 'fld_driver',
                name: 'Show details',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.CHECKBOX,
                    options: { icon: 'check', color: 'greenBright' },
                },
            },
        };
        form.payload.fieldIdsToSchemas.fld_number = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_number',
                name: 'Number',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 2 },
                },
            },
            miniExtConfig: { conditionalFields: predicate },
        };
        form.payload.fieldIdsInForm = [
            'fld_driver',
            'fld_title',
            'fld_readonly',
            'fld_number',
        ];
        const native = {
            fld_driver: false,
            fld_title: 'Retained title',
            fld_readonly: 'Locked value',
            fld_number: 0,
            fld_select: ['Legacy', 'Red'],
            fld_linked: ['record_parent'],
            fld_barcode: { text: '001', type: 'code128' },
        };
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_visibility',
            tableId: 'table_visibility',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = [];
        form.payload.urlPrefilledFieldIds = [];
        const saves: SaveFormInput[] = [];
        const window = await mount(test, () => form, saves);
        await waitFor(() => isPresented(window, 'fld_driver'));
        assert.equal(
            isPresented(window, 'fld_title'),
            false,
            'A false published scalar predicate must hide the actual target control.'
        );
        assert.equal(isPresented(window, 'fld_readonly'), false);
        const driver = window.document.querySelector(
            '[data-field-id="fld_driver"]'
        );
        assert.ok(driver instanceof window.HTMLInputElement);
        const toggle = (value: boolean) => {
            driver.checked = value;
            driver.dispatchEvent(new window.Event('change', { bubbles: true }));
        };
        toggle(true);
        assert.equal(isPresented(window, 'fld_title'), true);
        assert.equal(isPresented(window, 'fld_readonly'), true);
        const target = window.document.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.ok(target instanceof window.HTMLInputElement);
        assert.equal(target.value, 'Retained title');
        target.value = 'Accepted draft title';
        target.dispatchEvent(new window.Event('input', { bubbles: true }));
        const number = window.document.querySelector(
            '[data-field-id="fld_number"]'
        );
        assert.ok(number instanceof window.HTMLInputElement);
        number.value = '1e309';
        number.dispatchEvent(new window.Event('input', { bubbles: true }));
        toggle(false);
        assert.equal(isPresented(window, 'fld_title'), false);
        assert.equal(isPresented(window, 'fld_readonly'), false);
        assert.equal(isPresented(window, 'fld_number'), false);
        const card = driver.closest('form');
        assert.ok(card);
        card.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
        await waitFor(() => saves.length === 1);
        assert.deepEqual(saves[0].formRecord, {
            type: 'edit',
            recordId: 'record_visibility',
            tableId: 'table_visibility',
            data: { ...native, fld_title: 'Accepted draft title' },
        });
        assert.deepEqual(
            new Set(saves[0].formFieldIdsWithUnsavedChanges),
            new Set(['fld_driver', 'fld_title'])
        );
        await waitFor(
            () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        toggle(true);
        assert.equal(isPresented(window, 'fld_title'), true);
        assert.equal(target.value, 'Accepted draft title');
    });

    it('presents an unsupported published predicate as unavailable, denies Save, and recovers after supported reload', async (test) => {
        let form = loadedForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        const adjacent = form.payload.fieldIdsToSchemas.fld_readonly;
        assert.ok(title && adjacent);
        const unsupported: RuntimeConditionsDefinition = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'published_multiselect_condition',
                    type: 'singleCondition',
                    setting: {
                        type: 'hasAnyOf',
                        fieldType: AirtableFieldType.MULTIPLE_SELECTS,
                        idOrName: { type: 'id', id: 'fld_select' },
                        value: ['sel_red'],
                    },
                },
            ],
        };
        title.miniExtConfig = { conditionalFields: unsupported };
        adjacent.miniExtConfig = {};
        form.payload.fieldIdsToSchemas.fld_select = {
            fieldType: AirtableFieldType.MULTIPLE_SELECTS,
            airtableField: {
                id: 'fld_select',
                name: 'Selection',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.MULTIPLE_SELECTS,
                    options: { choices: [{ id: 'sel_red', name: 'Red' }] },
                },
            },
        };
        form.payload.fieldIdsInForm = ['fld_title', 'fld_readonly'];
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_blocked',
            tableId: 'table_blocked',
            data: {
                fld_title: 'Kept target',
                fld_readonly: 'Adjacent native',
                fld_select: ['Red'],
                fld_number: 0,
                fld_linked: ['record_parent'],
            },
        };
        form.payload.formFieldIdsWithUnsavedChanges = [];
        form.payload.urlPrefilledFieldIds = [];
        const baseline = structuredClone(form.payload.formRecord);
        const saves: SaveFormInput[] = [];
        const window = await mount(test, () => form, saves);
        await waitFor(
            () =>
                isPresented(window, 'fld_readonly') &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.equal(isPresented(window, 'fld_title'), false);
        const unavailable = Array.from(
            window.document.querySelectorAll('[role="alert"]')
        ).find((node) =>
            node.textContent?.includes('Some fields cannot be displayed')
        );
        assert.ok(unavailable instanceof window.HTMLElement);
        assert.equal(
            unavailable.hidden,
            false,
            'Blocked is an explicit unavailable presentation, not an ordinary false predicate.'
        );
        const input = window.document.querySelector(
            '[data-field-id="fld_readonly"]'
        );
        assert.ok(input instanceof window.HTMLInputElement);
        input.value = 'Adjacent accepted draft';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        const card = input.closest('form');
        assert.ok(card);
        card.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
        await waitFor(
            () =>
                window.document.getElementById('status')?.textContent ===
                'Review the unavailable fields before saving this Form.'
        );
        assert.equal(
            saves.length,
            0,
            'Unavailable visibility must stop at the actual Save dispatch gate.'
        );
        assert.equal(input.value, 'Adjacent accepted draft');
        const retained = window.document.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.ok(retained instanceof window.HTMLInputElement);
        assert.equal(retained.value, 'Kept target');
        assert.deepEqual(form.payload.formRecord, baseline);
        // A normal visitor round trip remounts A's controls from its actual
        // draft store, proving the denied submit preserved accepted values.
        const visitor = window.document.getElementById('visitor');
        assert.ok(visitor instanceof window.HTMLSelectElement);
        for (const identity of ['B', 'A']) {
            visitor.value = identity;
            visitor.dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
        }
        const restoredAdjacent = window.document.querySelector(
            '[data-field-id="fld_readonly"]'
        );
        const restoredTarget = window.document.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.ok(restoredAdjacent instanceof window.HTMLInputElement);
        assert.ok(restoredTarget instanceof window.HTMLInputElement);
        assert.equal(restoredAdjacent.value, 'Adjacent accepted draft');
        assert.equal(restoredTarget.value, 'Kept target');
        assert.equal(saves.length, 0);

        form = structuredClone(form);
        form.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
            conditionalFields: { logicalOperator: 'and', conditions: [] },
        };
        const reload = window.document.getElementById('reload');
        assert.ok(reload instanceof window.HTMLButtonElement);
        reload.click();
        await waitFor(
            () =>
                isPresented(window, 'fld_title') &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        const recoveredMessage = Array.from(
            window.document.querySelectorAll('[role="alert"]')
        ).find((node) =>
            node.textContent?.includes('Some fields cannot be displayed')
        );
        assert.ok(recoveredMessage instanceof window.HTMLElement);
        assert.equal(recoveredMessage.hidden, true);
        const fresh = window.document.querySelector(
            '[data-field-id="fld_readonly"]'
        );
        assert.ok(fresh instanceof window.HTMLInputElement);
        assert.equal(fresh.value, 'Adjacent native');
        fresh.value = 'After reload accepted';
        fresh.dispatchEvent(new window.Event('input', { bubbles: true }));
        const freshCard = fresh.closest('form');
        assert.ok(freshCard);
        freshCard.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
        await waitFor(
            () =>
                saves.length === 1 &&
                window.document.getElementById('status')?.textContent ===
                    'The Form was not saved. Review the validation errors.' &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(saves[0].formRecord, {
            ...baseline,
            data: { ...baseline.data, fld_readonly: 'After reload accepted' },
        });
        assert.deepEqual(saves[0].formFieldIdsWithUnsavedChanges, [
            'fld_readonly',
        ]);
    });
});
