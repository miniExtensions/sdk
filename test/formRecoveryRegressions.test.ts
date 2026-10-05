import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    createFormController,
    FormDraftStore,
    openLoadedFormDraft,
} from '../src/forms/index.js';
import {
    AirtableFieldType,
    createMiniExtensionsClient,
    type AirtableValue,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { formSaveOptions, loadedForm, savedForm } from './formsFixtures.js';

// All transport callbacks are local synthetic fixtures; no API is contacted.
const root = resolve(process.cwd());
const packedRoot = process.env.SDK_REVIEW_PACKED_ROOT;
const sdkEntry = (name: string) =>
    packedRoot === undefined
        ? join(root, 'src', name, 'index.ts')
        : join(packedRoot, 'dist/esm', name, 'index.js');
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-deep-review-forms-'));
    await build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': sdkEntry('auth'),
            '@miniextensions/sdk/ui': sdkEntry('ui'),
            '@miniextensions/sdk/forms': sdkEntry('forms'),
            '@miniextensions/sdk/portals': sdkEntry('portals'),
            '@miniextensions/sdk': sdkEntry('runtime'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const environment = async (
    test: TestContext,
    fetch: typeof globalThis.fetch
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
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        Option,
        fetch,
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
    return window;
};

const submit = (window: Window, node: InstanceType<Window['Element']>) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 30; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('Example did not reach its expected state.');
};
const connect = async (window: Window) => {
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    const connection = window.document.getElementById('connection-form');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    assert.ok(connection);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_example';
    submit(window, connection);
    await waitFor(
        () =>
            window.document.querySelector('[data-field-id="fld_title"]') !==
                null &&
            window.document
                .getElementById('screen')
                ?.getAttribute('aria-busy') === 'false'
    );
    const card = window.document
        .querySelector('[data-field-id="fld_title"]')
        ?.closest('form');
    assert.ok(card);
    return card;
};

describe('Form recovery and reset regressions', { concurrency: false }, () => {
    it('retains an omitted store across same-scope and CAPTCHA resets, then adopts a saved baseline', async () => {
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw new Error('No transport call is expected.');
            },
        });
        client.forms.save = async () => savedForm();
        const options = {
            client,
            loaded: loadedForm(),
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'visitor_A', revision: 0 }),
        };
        const controller = createFormController(options);
        controller.write('fld_title', 'Unsaved visitor edit');
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Unsaved visitor edit'
        );
        controller.reset(options);
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Unsaved visitor edit'
        );
        assert.equal(
            controller.getState().draft?.dirtyFieldIds.includes('fld_title'),
            true
        );
        controller.reset({
            ...options,
            saveOptions: {
                ...options.saveOptions,
                captchaVal: 'fresh_captcha',
            },
        });
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Unsaved visitor edit'
        );
        await controller.save();
        const fresh = loadedForm();
        fresh.payload.formRecord.data.fld_title = 'Fresh saved baseline';
        controller.reset({ ...options, loaded: fresh });
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Fresh saved baseline'
        );
        assert.equal(
            controller.getState().draft?.dirtyFieldIds.includes('fld_title'),
            false
        );
        controller.destroy();
    });

    it('retains equivalent context maps but retires drafts when ordered query values change', () => {
        const loaded = loadedForm();
        const saveOptions = formSaveOptions();
        saveOptions.conditionalLinkedRecordFieldIdsToFilteringValues = {
            fld_projects: { fld_region: null, fld_owner: null },
            fld_people: { fld_department: null },
        };
        const store = new FormDraftStore<AirtableValue>();
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw new Error('No transport call is expected.');
            },
        });
        const options = {
            client,
            loaded,
            store,
            saveOptions,
            parent: {
                portalId: 'portal_example',
                recordId: 'record_parent',
                portalFieldId: 'fld_children',
            },
            getScope: () => ({ ownerId: 'visitor_A', revision: 0 }),
        };
        const controller = createFormController(options);
        const handle = openLoadedFormDraft({
            store,
            loaded,
            parent: options.parent,
        });
        const other = store.open(
            { extensionId: 'other_form', recordId: null, parent: null },
            { fld_other: 'Another Form draft' },
            ['fld_other']
        );
        controller.write('fld_title', 'Unsaved visitor edit');
        const reordered = Object.fromEntries(
            Object.entries(saveOptions.searchQuery).reverse()
        );
        assert.deepEqual(reordered, saveOptions.searchQuery);
        const reorderedSaveOptions = { ...saveOptions, searchQuery: reordered };
        reorderedSaveOptions.conditionalLinkedRecordFieldIdsToFilteringValues =
            {
                fld_people: { fld_department: null },
                fld_projects: { fld_owner: null, fld_region: null },
            };
        if (saveOptions.context.type !== 'direct-url') {
            reorderedSaveOptions.context = {
                prefillData: saveOptions.context.prefillData,
                type: saveOptions.context.type,
            };
        }
        controller.reset({
            ...options,
            parent: {
                portalFieldId: options.parent.portalFieldId,
                recordId: options.parent.recordId,
                portalId: options.parent.portalId,
            },
            saveOptions: reorderedSaveOptions,
        });
        assert.equal(store.read(handle, 'fld_title'), 'Unsaved visitor edit');
        assert.equal(store.read(other, 'fld_other'), 'Another Form draft');
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Unsaved visitor edit'
        );
        controller.reset({
            ...options,
            saveOptions: {
                ...saveOptions,
                searchQuery: {
                    ...saveOptions.searchQuery,
                    repeated: ['Two', 'One'],
                },
            },
        });
        assert.equal(store.snapshot(handle), null);
        assert.equal(store.snapshot(other), null);
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Initial title'
        );
        controller.destroy();
    });

    it('blocks invalid numeric text while retaining native values and correctable validation', async (test) => {
        const loaded = loadedForm();
        loaded.payload.fieldIdsInForm = ['fld_title'];
        loaded.payload.fieldIdsToSchemas = {
            fld_title: {
                fieldType: AirtableFieldType.NUMBER,
                airtableField: {
                    ...loaded.payload.fieldIdsToSchemas.fld_title.airtableField,
                    config: {
                        type: AirtableFieldType.NUMBER,
                        options: { precision: 2 },
                    },
                },
            },
        };
        loaded.payload.formRecord = {
            type: 'edit',
            recordId: 'record_existing',
            tableId: 'table_existing',
            data: { fld_title: 7 },
        };
        const saves: SaveFormInput[] = [];
        const window = await environment(test, async (input, init) => {
            const route = new URL(String(input)).searchParams.get('route');
            if (route === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(loaded));
            assert.equal(route, 'saveForm');
            saves.push(JSON.parse(String(init?.body)));
            return new Response(
                JSON.stringify({
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                })
            );
        });
        const card = await connect(window);
        const number = card.querySelector('input[data-field-id="fld_title"]');
        assert.ok(number instanceof window.HTMLInputElement);
        assert.equal(number.value, '7');
        // HappyDOM does not reproduce browsers' badInput state for number
        // text. Supply the native-invalid contract explicitly, as the shipped
        // form recipe checks do; this test makes no live browser claim.
        number.value = '';
        Object.defineProperty(number, 'validity', {
            configurable: true,
            value: { badInput: true, valid: false },
        });
        number.dispatchEvent(new window.Event('input', { bubbles: true }));
        submit(window, card);
        await waitFor(
            () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.equal(saves.length, 0);
        Reflect.deleteProperty(number, 'validity');
        // No input event: the unchanged last valid draft must still be 7.
        number.value = '7';
        submit(window, card);
        await waitFor(
            () =>
                saves.length === 1 &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.equal(saves[0].formRecord.data.fld_title, 7);
        assert.equal(
            saves[0].formFieldIdsWithUnsavedChanges.includes('fld_title'),
            false
        );
        number.value = '1.5';
        number.dispatchEvent(new window.Event('input', { bubbles: true }));
        submit(window, card);
        await waitFor(
            () =>
                saves.length === 2 &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.equal(saves[1].formRecord.data.fld_title, 1.5);
        number.value = '';
        number.dispatchEvent(new window.Event('input', { bubbles: true }));
        submit(window, card);
        await waitFor(
            () =>
                saves.length === 3 &&
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.equal(saves[2].formRecord.data.fld_title, null);
    });

    for (const outcome of ['cancelled', 'lost-response'] as const) {
        it(`blocks create replay after ${outcome} through remounts and in-page reload`, async (test) => {
            const loaded = loadedForm();
            loaded.payload.fieldIdsInForm = ['fld_title'];
            const saves: SaveFormInput[] = [];
            let loads = 0;
            const window = await environment(test, async (input, init) => {
                const route = new URL(String(input)).searchParams.get('route');
                if (route === 'fetchExtensionForEndUser') {
                    loads += 1;
                    return new Response(JSON.stringify(loaded));
                }
                assert.equal(route, 'saveForm');
                saves.push(JSON.parse(String(init?.body)));
                // Synthetic server commit occurs before the response is lost.
                if (saves.length === 1) {
                    if (outcome === 'lost-response')
                        throw new Error(
                            'Response lost after synthetic commit.'
                        );
                    return await new Promise<Response>((_resolve, reject) => {
                        const signal = init?.signal;
                        signal?.addEventListener(
                            'abort',
                            () => reject(signal.reason),
                            { once: true }
                        );
                    });
                }
                return new Response(
                    JSON.stringify({
                        ...savedForm(),
                        context: { type: 'direct-url' },
                        loggedInUserRecord: null,
                    })
                );
            });
            const card = await connect(window);
            submit(window, card);
            await waitFor(() => saves.length === 1);
            if (outcome === 'cancelled') {
                const cancel = window.document.getElementById('cancel');
                assert.ok(cancel instanceof window.HTMLButtonElement);
                cancel.click();
            }
            await waitFor(
                () =>
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.equal(card.isConnected, true);
            const saveButton = card.querySelector('button[type="submit"]');
            assert.ok(saveButton instanceof window.HTMLButtonElement);
            assert.equal(saveButton.disabled, true);
            submit(window, card);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(saves.length, 1);
            const discard = Array.from(card.querySelectorAll('button')).find(
                (button) => button.textContent === 'Discard draft'
            );
            assert.ok(discard);
            assert.equal(discard.disabled, true);
            discard.dispatchEvent(new window.Event('click', { bubbles: true }));
            assert.equal(card.isConnected, true);
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            for (const identity of ['B', 'A']) {
                visitor.value = identity;
                visitor.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
            }
            const restored = window.document
                .querySelector('[data-field-id="fld_title"]')
                ?.closest('form');
            assert.ok(restored);
            assert.notEqual(restored, card);
            const restoredSave = restored.querySelector(
                'button[type="submit"]'
            );
            assert.ok(restoredSave instanceof window.HTMLButtonElement);
            assert.equal(restoredSave.disabled, true);
            submit(window, restored);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(saves.length, 1);
            const reload = window.document.getElementById('reload');
            assert.ok(reload instanceof window.HTMLButtonElement);
            reload.click();
            await waitFor(
                () =>
                    loads === 2 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            const fresh = window.document
                .querySelector('[data-field-id="fld_title"]')
                ?.closest('form');
            assert.ok(fresh);
            const freshSave = fresh.querySelector('button[type="submit"]');
            assert.ok(freshSave instanceof window.HTMLButtonElement);
            assert.equal(freshSave.disabled, true);
            assert.match(
                fresh.textContent ?? '',
                /Earlier outcome not confirmed/
            );
            assert.match(fresh.textContent ?? '', /It may have completed/);
            assert.match(
                fresh.textContent ?? '',
                /standalone form has no authorized request list/
            );
            submit(window, restored);
            submit(window, fresh);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(
                saves.length,
                1,
                'Neither detached nor freshly loaded Forms may replay the uncertain create.'
            );
            assert.equal(saves[0].formRecord.type, 'create');
        });
    }
});
