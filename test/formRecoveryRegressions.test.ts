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
            '@miniextensions/sdk/formulas': sdkEntry('formulas'),
            '@miniextensions/sdk': sdkEntry('runtime'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
    await build({
        entryPoints: [join(root, 'examples/browser/src/recovery.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'recovery.mjs'),
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
    it('scrubs journal reference input without changing operation guards or restoring input on a late flight finish', async () => {
        const { RecoveryJournal } = await import(
            pathToFileURL(join(directory, 'recovery.mjs')).href
        );
        const journal = new RecoveryJournal();
        const scope = {
            owner: 'privacy_owner',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'privacy_form',
            context: 'direct-url',
        };
        const active = journal.begin(scope, null, 'save', 7);
        const upload = journal.begin(
            scope,
            'record_upload',
            'upload',
            8,
            'fld_files'
        );
        const acknowledged = journal.begin(
            scope,
            'record_acknowledged',
            'save',
            9
        );
        journal.finishFlight(acknowledged);
        journal.acknowledgeExisting(acknowledged, 'record_selected');
        const prepared = journal.prepare(scope, 'record_prepared', 10);
        const completed = journal.begin(scope, 'record_completed', 'save', 11);
        journal.accepted(completed, 'saved');
        const attempts = [active, upload, acknowledged, prepared, completed];
        for (const attempt of attempts)
            attempt.retainedInput = [
                { title: 'Private label', value: 'Private input' },
            ];
        const operationState = (attempt: typeof active) => {
            const { retainedInput: _input, ...state } = attempt;
            return structuredClone(state);
        };
        const before = attempts.map(operationState);
        const lateCompletion = Promise.resolve().then(() =>
            journal.finishFlight(active)
        );
        journal.scrubRetainedInput();
        assert.deepEqual(attempts.map(operationState), before);
        assert.deepEqual(
            attempts.map((attempt) => attempt.retainedInput),
            [[], [], [], [], []]
        );
        assert.equal(journal.blocking(scope, null), active);
        assert.throws(
            () => journal.begin(scope, null, 'save', 12),
            /Inspect the earlier attempt/
        );
        await lateCompletion;
        assert.equal(active.flight, false);
        assert.equal(active.outcome, 'unknown');
        assert.deepEqual(active.retainedInput, []);
        assert.equal(journal.blocking(scope, null), active);
        assert.equal(upload.flight, true);
        assert.equal(acknowledged.acknowledgment, 'existing-request');
        assert.equal(acknowledged.associatedRecordId, 'record_selected');
        assert.equal(journal.prepare(scope, 'record_next', 12).id, 'attempt-6');
    });

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

    for (const teardown of ['Logout', 'Disconnect'] as const) {
        it(`scrubs retained private input on ${teardown} while preserving the uncertain create tombstone`, async (test) => {
            const privateText = 'Previous visitor private narrative';
            const privateFilename = 'previous-visitor-private-attachment.pdf';
            const privateTitle = 'Previous visitor private field label';
            const first = loadedForm();
            first.payload.fieldIdsInForm = ['fld_title', 'fld_files'];
            first.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                title: privateTitle,
            };
            first.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                privateTitle;
            first.payload.formRecord.data.fld_files = [
                {
                    url: 'https://files.example.test/private-reference',
                    filename: privateFilename,
                },
            ];
            first.payload.formFieldIdsWithUnsavedChanges = ['fld_files'];
            const fresh = structuredClone(first);
            fresh.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                title: 'Current public title',
            };
            fresh.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                'Current public title';
            fresh.payload.formRecord.data.fld_title = 'Fresh public baseline';
            fresh.payload.formRecord.data.fld_files = [];
            fresh.payload.formFieldIdsWithUnsavedChanges = [];
            const saves: SaveFormInput[] = [];
            let loads = 0;
            const window = await environment(test, async (input, init) => {
                const route = new URL(String(input)).searchParams.get('route');
                if (route === 'fetchExtensionForEndUser') {
                    loads += 1;
                    return new Response(
                        JSON.stringify(loads === 1 ? first : fresh)
                    );
                }
                assert.equal(route, 'saveForm');
                saves.push(JSON.parse(String(init?.body)));
                throw new Error('Response lost after a synthetic commit.');
            });
            const idle = () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false';
            const earlierInput = () =>
                window.document.querySelector(
                    'details[aria-label="Earlier local input (reference only)"]'
                );
            const firstCard = await connect(window);
            const title = window.document.querySelector(
                '[data-field-id="fld_title"]'
            );
            assert.ok(title instanceof window.HTMLInputElement);
            title.value = privateText;
            title.dispatchEvent(new window.Event('input', { bubbles: true }));
            submit(window, firstCard);
            await waitFor(() => saves.length === 1 && idle());
            assert.equal(saves[0].formRecord.data.fld_title, privateText);
            assert.match(
                earlierInput()?.textContent ?? '',
                /private narrative/
            );
            assert.doesNotMatch(
                earlierInput()?.textContent ?? '',
                /previous-visitor-private-attachment\.pdf/
            );
            assert.match(
                earlierInput()?.textContent ?? '',
                /Attachment details are not retained/
            );
            const reload = window.document.getElementById('reload');
            assert.ok(reload instanceof window.HTMLButtonElement);
            reload.click();
            await waitFor(() => loads === 2 && idle());
            // Reload keeps the same person's reference-only recovery. It must
            // not clear the uncertain operation or copy its input into a draft.
            const reloadedTitle = window.document.querySelector(
                '[data-field-id="fld_title"]'
            );
            assert.ok(reloadedTitle instanceof window.HTMLInputElement);
            assert.equal(reloadedTitle.value, 'Fresh public baseline');
            assert.ok(earlierInput()?.textContent?.includes(privateText));
            assert.equal(
                earlierInput()?.textContent?.includes(privateFilename),
                false
            );
            assert.ok(earlierInput()?.textContent?.includes(privateTitle));
            const teardownButton = window.document.getElementById(
                teardown === 'Logout' ? 'logout' : 'disconnect'
            );
            assert.ok(teardownButton instanceof window.HTMLButtonElement);
            teardownButton.click();
            for (const secret of [privateText, privateFilename, privateTitle])
                assert.equal(
                    window.document.body.textContent?.includes(secret),
                    false
                );
            if (teardown === 'Logout') {
                reload.click();
                await waitFor(() => loads === 3 && idle());
            } else await connect(window);
            assert.equal(loads, 3);
            const currentTitle = window.document.querySelector(
                '[data-field-id="fld_title"]'
            );
            assert.ok(currentTitle instanceof window.HTMLInputElement);
            assert.equal(currentTitle.value, 'Fresh public baseline');
            assert.equal(
                earlierInput() === null,
                true,
                `${teardown} must remove the earlier private reference after anonymous reconnect.`
            );
            for (const secret of [privateText, privateFilename, privateTitle])
                assert.equal(
                    window.document.body.textContent?.includes(secret),
                    false,
                    `${teardown} must prevent earlier private reference input from reappearing after anonymous reconnect.`
                );
            assert.match(
                window.document.getElementById('session-summary')
                    ?.textContent ?? '',
                /Anonymous/
            );
            const currentCard = currentTitle.closest('form');
            assert.ok(currentCard);
            const currentSave = currentCard.querySelector(
                'button[type="submit"]'
            );
            assert.ok(currentSave instanceof window.HTMLButtonElement);
            assert.equal(currentSave.disabled, true);
            assert.match(
                currentCard.textContent ?? '',
                /Earlier outcome not confirmed/
            );
            submit(window, firstCard);
            submit(window, currentCard);
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.equal(
                saves.length,
                1,
                'Privacy teardown must not permit an uncertain create to replay.'
            );
        });
    }

    for (const teardown of ['Logout', 'Disconnect'] as const) {
        it(`keeps a late in-flight Save private after direct ${teardown} and anonymous reload`, async (test) => {
            const privateText = 'In-flight visitor private narrative';
            const privateTitle = 'In-flight visitor private field label';
            const privateFilename = 'in-flight-private-attachment.pdf';
            const first = loadedForm();
            first.payload.fieldIdsInForm = ['fld_title', 'fld_files'];
            first.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                title: privateTitle,
            };
            first.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                privateTitle;
            first.payload.formRecord.data.fld_files = [
                {
                    url: 'https://files.example.test/in-flight-reference',
                    filename: privateFilename,
                },
            ];
            first.payload.formFieldIdsWithUnsavedChanges = ['fld_files'];
            const fresh = structuredClone(first);
            fresh.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                title: 'Fresh public title',
            };
            fresh.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                'Fresh public title';
            fresh.payload.formRecord.data.fld_title = 'Fresh public baseline';
            fresh.payload.formRecord.data.fld_files = [];
            fresh.payload.formFieldIdsWithUnsavedChanges = [];
            const saves: SaveFormInput[] = [];
            const held: {
                resolve?: (response: Response) => void;
                signal?: AbortSignal;
                returned: boolean;
            } = { returned: false };
            let loads = 0;
            const window = await environment(test, async (input, init) => {
                const route = new URL(String(input)).searchParams.get('route');
                if (route === 'fetchExtensionForEndUser') {
                    loads += 1;
                    return new Response(
                        JSON.stringify(loads === 1 ? first : fresh)
                    );
                }
                assert.equal(route, 'saveForm');
                saves.push(JSON.parse(String(init?.body)));
                // Keep the original held flight drainable even if a broken
                // guard permits replay. Record that call, then reject it
                // before it can replace the callback or allocate a new hold.
                if (saves.length !== 1)
                    throw new Error('Unexpected additional in-flight Save.');
                held.signal = init?.signal ?? undefined;
                // The transport ignores abort. Only the starter's retired
                // owner and the SDK's signal guard may reject its late result.
                const response = await new Promise<Response>((resolve) => {
                    held.resolve = resolve;
                });
                held.returned = true;
                return response;
            });
            const idle = () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false';
            const lateResponse = () =>
                new Response(
                    JSON.stringify({
                        ...savedForm(),
                        record: {
                            id: 'record_late_save',
                            fields: {
                                fld_title: privateText,
                                fld_files:
                                    first.payload.formRecord.data.fld_files,
                            },
                        },
                        context: { type: 'direct-url' },
                        loggedInUserRecord: null,
                    })
                );
            const assertPrivateInputAbsent = () => {
                assert.equal(
                    window.document.querySelector(
                        'details[aria-label="Earlier local input (reference only)"]'
                    ) === null,
                    true
                );
                for (const secret of [
                    privateText,
                    privateTitle,
                    privateFilename,
                ])
                    assert.equal(
                        window.document.body.textContent?.includes(secret),
                        false
                    );
            };
            const assertBlockedFreshForm = () => {
                const title = window.document.querySelector(
                    '[data-field-id="fld_title"]'
                );
                assert.ok(title instanceof window.HTMLInputElement);
                assert.equal(title.value, 'Fresh public baseline');
                const card = title.closest('form');
                assert.ok(card);
                const save = card.querySelector('button[type="submit"]');
                assert.ok(save instanceof window.HTMLButtonElement);
                assert.equal(save.disabled, true);
                assert.match(
                    card.textContent ?? '',
                    /Earlier outcome not confirmed/
                );
                assert.match(card.textContent ?? '', /attempt-1:/);
                assertPrivateInputAbsent();
                return card;
            };
            try {
                const firstCard = await connect(window);
                const title = firstCard.querySelector(
                    '[data-field-id="fld_title"]'
                );
                assert.ok(title instanceof window.HTMLInputElement);
                title.value = privateText;
                title.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                submit(window, firstCard);
                await waitFor(() => saves.length === 1 && held.resolve != null);
                assert.equal(idle(), false);
                assert.equal(held.signal?.aborted, false);
                assert.equal(saves[0].formRecord.data.fld_title, privateText);
                // Native Save includes the loaded URL-prefilled fields even
                // when this privacy fixture renders only title and files.
                assert.deepEqual(saves[0].formFieldIdsWithUnsavedChanges, [
                    'fld_files',
                    'fld_prefill',
                    'fld_parent',
                    'fld_title',
                ]);
                assert.deepEqual(
                    saves[0].formRecord.data.fld_files,
                    first.payload.formRecord.data.fld_files
                );
                const teardownButton = window.document.getElementById(
                    teardown === 'Logout' ? 'logout' : 'disconnect'
                );
                assert.ok(teardownButton instanceof window.HTMLButtonElement);
                if (teardown === 'Logout')
                    assert.equal(teardownButton.disabled, true);
                // Native Logout is disabled while busy; Disconnect is inside
                // the inert connection form. This direct event intentionally
                // proves the source lifecycle guard, not a browser gesture.
                teardownButton.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                assert.equal(held.signal?.aborted, true);
                assert.equal(firstCard.isConnected, false);
                assert.equal(idle(), true);
                assertPrivateInputAbsent();
                const reload = window.document.getElementById('reload');
                assert.ok(reload instanceof window.HTMLButtonElement);
                if (teardown === 'Logout') {
                    reload.click();
                    await waitFor(() => loads === 2 && idle());
                } else await connect(window);
                assert.equal(loads, 2);
                assert.equal(held.returned, false);
                const current = assertBlockedFreshForm();
                assert.match(
                    window.document.getElementById('session-summary')
                        ?.textContent ?? '',
                    /Anonymous/
                );
                submit(window, firstCard);
                submit(window, current);
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.equal(saves.length, 1);
                const statusBeforeLateResult =
                    window.document.getElementById('status')?.textContent;
                assert.ok(held.resolve);
                held.resolve(lateResponse());
                await waitFor(() => held.returned && idle());
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.equal(current.isConnected, true);
                assert.equal(
                    window.document.getElementById('status')?.textContent,
                    statusBeforeLateResult
                );
                assertBlockedFreshForm();
                reload.click();
                await waitFor(() => loads === 3 && idle());
                const afterLateReload = assertBlockedFreshForm();
                submit(window, firstCard);
                submit(window, current);
                submit(window, afterLateReload);
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.equal(saves.length, 1);
                await waitFor(idle);
            } finally {
                // Drain the held local transport even if an assertion fails,
                // before environment() restores this starter's DOM globals.
                held.resolve?.(lateResponse());
                if (held.resolve != null) {
                    await waitFor(() => held.returned && idle());
                    await new Promise<void>((resolve) => setImmediate(resolve));
                } else await waitFor(idle);
            }
        });

        it(`scrubs both visitor slots on ${teardown} without clearing either uncertain create blocker`, async (test) => {
            const secrets = {
                A: {
                    text: 'Visitor A retained private narrative',
                    title: 'Visitor A retained private field label',
                    filename: 'visitor-a-retained-private-attachment.pdf',
                },
                B: {
                    text: 'Visitor B retained private narrative',
                    title: 'Visitor B retained private field label',
                    filename: 'visitor-b-retained-private-attachment.pdf',
                },
            };
            const first = { A: loadedForm(), B: loadedForm() };
            for (const identity of ['A', 'B'] as const) {
                const form = first[identity];
                form.payload.fieldIdsInForm = ['fld_title', 'fld_files'];
                form.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                    title: secrets[identity].title,
                };
                form.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                    secrets[identity].title;
                form.payload.formRecord.data.fld_files = [
                    {
                        url: `https://files.example.test/visitor-${identity}-reference`,
                        filename: secrets[identity].filename,
                    },
                ];
                form.payload.formFieldIdsWithUnsavedChanges = ['fld_files'];
            }
            const fresh = structuredClone(first);
            for (const identity of ['A', 'B'] as const) {
                const form = fresh[identity];
                form.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                    title: `Current public title ${identity}`,
                };
                form.payload.fieldIdsToSchemas.fld_title.airtableField.name = `Current public title ${identity}`;
                form.payload.formRecord.data.fld_title = `Fresh public baseline ${identity}`;
                form.payload.formRecord.data.fld_files = [];
                form.payload.formFieldIdsWithUnsavedChanges = [];
            }
            const saves: SaveFormInput[] = [];
            const loads = { A: 0, B: 0 };
            let activeIdentity: 'A' | 'B' = 'A';
            const window = await environment(test, async (input, init) => {
                const route = new URL(String(input)).searchParams.get('route');
                if (route === 'fetchExtensionForEndUser') {
                    loads[activeIdentity] += 1;
                    return new Response(
                        JSON.stringify(
                            loads[activeIdentity] === 1
                                ? first[activeIdentity]
                                : fresh[activeIdentity]
                        )
                    );
                }
                assert.equal(route, 'saveForm');
                saves.push(JSON.parse(String(init?.body)));
                throw new Error('Response lost after a synthetic commit.');
            });
            const idle = () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false';
            const earlierInput = () =>
                window.document.querySelector(
                    'details[aria-label="Earlier local input (reference only)"]'
                );
            const visitor = window.document.getElementById('visitor');
            const reload = window.document.getElementById('reload');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            assert.ok(reload instanceof window.HTMLButtonElement);
            const selectVisitor = (identity: 'A' | 'B') => {
                activeIdentity = identity;
                visitor.value = identity;
                visitor.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                assert.match(
                    window.document.getElementById('session-summary')
                        ?.textContent ?? '',
                    new RegExp(`Visitor ${identity}`)
                );
            };
            const createUnknownAttempt = async (
                identity: 'A' | 'B',
                expectedSaves: number
            ) => {
                const title = window.document.querySelector(
                    '[data-field-id="fld_title"]'
                );
                assert.ok(title instanceof window.HTMLInputElement);
                const card = title.closest('form');
                assert.ok(card);
                title.value = secrets[identity].text;
                title.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                submit(window, card);
                await waitFor(() => saves.length === expectedSaves && idle());
                for (const secret of [
                    secrets[identity].text,
                    secrets[identity].title,
                ])
                    assert.equal(
                        earlierInput()?.textContent?.includes(secret),
                        true
                    );
                assert.equal(
                    earlierInput()?.textContent?.includes(
                        secrets[identity].filename
                    ),
                    false
                );
                assert.match(
                    earlierInput()?.textContent ?? '',
                    /Attachment details are not retained/
                );
                assert.deepEqual(
                    saves[expectedSaves - 1].formFieldIdsWithUnsavedChanges,
                    ['fld_files', 'fld_prefill', 'fld_parent', 'fld_title']
                );
                assert.equal(
                    saves[expectedSaves - 1].formRecord.data.fld_title,
                    secrets[identity].text
                );
                return card;
            };
            const assertBlockedSlot = (
                identity: 'A' | 'B',
                freshLoad: boolean
            ) => {
                assert.equal(earlierInput() === null, true);
                const title = window.document.querySelector(
                    '[data-field-id="fld_title"]'
                );
                assert.ok(title instanceof window.HTMLInputElement);
                const card = title.closest('form');
                assert.ok(card);
                const save = card.querySelector('button[type="submit"]');
                assert.ok(save instanceof window.HTMLButtonElement);
                assert.equal(save.disabled, true);
                assert.match(
                    card.textContent ?? '',
                    /Earlier outcome not confirmed/
                );
                assert.match(
                    card.textContent ?? '',
                    identity === 'A' ? /attempt-1:/ : /attempt-2:/
                );
                if (freshLoad) {
                    assert.equal(
                        title.value,
                        `Fresh public baseline ${identity}`
                    );
                    for (const slot of Object.values(secrets))
                        for (const secret of Object.values(slot))
                            assert.equal(
                                window.document.body.textContent?.includes(
                                    secret
                                ),
                                false
                            );
                }
                submit(window, card);
                return card;
            };
            try {
                await connect(window);
                const originalA = await createUnknownAttempt('A', 1);
                selectVisitor('B');
                reload.click();
                await waitFor(() => loads.B === 1 && idle());
                const originalB = await createUnknownAttempt('B', 2);
                assert.equal(
                    earlierInput()?.textContent?.includes(secrets.A.text),
                    false
                );
                selectVisitor('A');
                for (const secret of [secrets.A.text, secrets.A.title])
                    assert.equal(
                        earlierInput()?.textContent?.includes(secret),
                        true
                    );
                assert.equal(saves.length, 2);
                const teardownButton = window.document.getElementById(
                    teardown === 'Logout' ? 'logout' : 'disconnect'
                );
                assert.ok(teardownButton instanceof window.HTMLButtonElement);
                teardownButton.click();
                assert.equal(earlierInput() === null, true);
                if (teardown === 'Logout') {
                    reload.click();
                    await waitFor(() => loads.A === 2 && idle());
                } else await connect(window);
                assert.deepEqual(loads, { A: 2, B: 1 });
                const currentA = assertBlockedSlot('A', true);
                selectVisitor('B');
                // Logout preserves the other slot's own loaded Form/draft.
                // Its journal reference must already be gone before Reload;
                // Disconnect clears both screens and requires fresh reads.
                if (teardown === 'Logout') assertBlockedSlot('B', false);
                else
                    assert.equal(
                        window.document.querySelector(
                            '[data-field-id="fld_title"]'
                        ) === null,
                        true
                    );
                reload.click();
                await waitFor(() => loads.B === 2 && idle());
                const currentB = assertBlockedSlot('B', true);
                selectVisitor('A');
                assertBlockedSlot('A', true);
                reload.click();
                await waitFor(() => loads.A === 3 && idle());
                const reloadedA = assertBlockedSlot('A', true);
                submit(window, originalA);
                submit(window, originalB);
                submit(window, currentA);
                submit(window, currentB);
                submit(window, reloadedA);
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.equal(
                    saves.length,
                    2,
                    'Neither slot may replay its uncertain create after privacy teardown.'
                );
                assert.deepEqual(loads, { A: 3, B: 2 });
                await waitFor(idle);
            } finally {
                await waitFor(idle);
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
        });
    }
});
