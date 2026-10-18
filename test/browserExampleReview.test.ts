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
    type LoadExtensionInput,
    type PortalLoadedResult,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { invalidForm, loadedForm, savedForm } from './formsFixtures.js';
import { portalField, portalListPage, portalPage } from './portalFixtures.js';

const root = resolve(process.cwd());
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-review-'));
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

const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let turn = 0; turn < 30; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('The actual starter did not reach the expected review state.');
};
const settled = async (): Promise<void> => {
    for (let turn = 0; turn < 4; turn++)
        await new Promise<void>((resolve) => setImmediate(resolve));
};

type ReviewScalarConfig = Extract<
    RuntimeFieldSchema['airtableField']['config'],
    {
        type:
            | 'singleLineText'
            | 'multilineText'
            | 'email'
            | 'url'
            | 'phoneNumber'
            | 'number'
            | 'currency'
            | 'percent'
            | 'rating'
            | 'checkbox'
            | 'barcode';
    }
>;

// Published Form schemas correlate their discriminator with each physical
// config. Construct concrete test arms; the wider metadata union is not a
// valid shortcut through this boundary (and also includes manualSort).
const scalarReviewSchema = (
    id: string,
    name: string,
    config: ReviewScalarConfig
): RuntimeFieldSchema => {
    const metadata = {
        id,
        name,
        description: null,
        isPrimaryField: false,
        isComputed: false,
    };
    switch (config.type) {
        case 'singleLineText':
            return {
                fieldType: 'singleLineText',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'multilineText':
            return {
                fieldType: 'multilineText',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'email':
            return {
                fieldType: 'email',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'url':
            return {
                fieldType: 'url',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'phoneNumber':
            return {
                fieldType: 'phoneNumber',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'number':
            return {
                fieldType: 'number',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'currency':
            return {
                fieldType: 'currency',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'percent':
            return {
                fieldType: 'percent',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'rating':
            return {
                fieldType: 'rating',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'checkbox':
            return {
                fieldType: 'checkbox',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'barcode':
            return {
                fieldType: 'barcode',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
    }
};

const reviewForm = (): FormLoadedResult => {
    const form = loadedForm();
    const title = form.payload.fieldIdsToSchemas.fld_title;
    const readonly = form.payload.fieldIdsToSchemas.fld_readonly;
    assert.ok(title && readonly);
    form.payload.fieldIdsToSchemas = {
        fld_title: title,
        fld_readonly: readonly,
    };
    form.payload.fieldIdsInForm = ['fld_title', 'fld_readonly'];
    form.payload.publicFields.state = {
        ...form.payload.publicFields.state,
        promptUserBeforeSubmission: true,
    };
    form.payload.formRecord = {
        type: 'create',
        data: {
            fld_title: 'Initial title',
            fld_readonly: 'Locked value',
            fld_hidden_native: ['record_retained'],
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};

const mount = async (
    test: TestContext,
    form: FormLoadedResult,
    options: {
        save?(input: SaveFormInput): Promise<Response>;
        read?(url: URL, init?: RequestInit): Promise<Response>;
        initialPortal?: PortalLoadedResult;
        childLoads?: LoadExtensionInput[];
    } = {}
) => {
    const saves: SaveFormInput[] = [];
    let loads = 0;
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
    // HappyDOM lacks the browser Option constructor. Its native option elements
    // still exercise selection, events and the actual Portal renderer.
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
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route');
            if (route === 'fetchExtensionForEndUser') {
                loads += 1;
                if (options.initialPortal != null) {
                    const loaded: LoadExtensionInput = JSON.parse(
                        String(init?.body)
                    );
                    if (!('childExtensionInfo' in loaded))
                        return new Response(
                            JSON.stringify(options.initialPortal)
                        );
                    options.childLoads?.push(structuredClone(loaded));
                }
                return new Response(JSON.stringify(form));
            }
            if (route === 'saveForm') {
                const saved: SaveFormInput = JSON.parse(String(init?.body));
                saves.push(saved);
                return (
                    options.save?.(saved) ??
                    new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    )
                );
            }
            if (options.read != null) return options.read(url, init);
            throw new Error('Unexpected review fixture request.');
        },
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        try {
            // Capturing a fetch payload precedes response handling. Keep the
            // fixture DOM installed until the actual request runner is idle.
            await waitFor(
                () =>
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            }
            await window.happyDOM.close();
        }
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
    await waitFor(() =>
        options.initialPortal == null
            ? window.document.querySelector('[data-field-id="fld_title"]') !==
              null
            : Array.from(window.document.querySelectorAll('button')).some(
                  (node) => node.textContent === 'Load records'
              )
    );
    const field = (id: string) => {
        const input = window.document.querySelector(`[data-field-id="${id}"]`);
        assert.ok(input instanceof window.HTMLInputElement);
        return input;
    };
    const button = (
        text: string,
        within: Pick<Window['document'], 'querySelectorAll'> = window.document
    ) => {
        const node = Array.from(within.querySelectorAll('button')).find(
            (node) => node.textContent?.trim() === text
        );
        assert.ok(
            node instanceof window.HTMLButtonElement,
            `Missing ${text} button.`
        );
        return node;
    };
    const submit = () => {
        const card = field('fld_title').closest('form');
        assert.ok(card);
        card.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
    };
    const openReview = async () => {
        submit();
        await waitFor(
            () => window.document.querySelector('dialog[open]') !== null
        );
        const dialog = window.document.querySelector('dialog[open]');
        assert.ok(dialog instanceof window.HTMLDialogElement);
        return dialog;
    };
    const edit = (id: string, value: string) => {
        const input = field(id);
        input.value = value;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    return {
        window,
        saves,
        field,
        button,
        submit,
        openReview,
        edit,
        loads: () => loads,
    };
};

const navigationForm = (): FormLoadedResult => {
    const form = reviewForm();
    const template = form.payload.fieldIdsToSchemas.fld_title;
    assert.ok(template?.fieldType === 'singleLineText');
    const ids = ['fld_title', 'fld_details', 'fld_final'];
    form.payload.fieldIdsInForm = ids;
    form.payload.fieldIdsToSchemas = Object.fromEntries(
        ids.map((id, index) => [
            id,
            {
                ...structuredClone(template),
                airtableField: {
                    ...structuredClone(template.airtableField),
                    id,
                    name: id,
                },
                miniExtConfig: {
                    required: true,
                    ...(index === 0
                        ? {}
                        : {
                              headerSectionTitle:
                                  index === 1 ? 'Details' : 'Final answers',
                          }),
                },
            },
        ])
    );
    form.payload.publicFields.state.multiPageFormMode = 'multi-page';
    form.payload.publicFields.state.promptUserBeforeSubmission = false;
    form.payload.publicFields.state.enableFormComputeMode = false;
    form.payload.publicFields.state.autoSubmitAfterPrefill = false;
    form.payload.formRecord.data = {
        fld_title: 'First answer',
        fld_details: 'Second answer',
        fld_final: 'Final answer',
        fld_hidden_native: ['record_retained'],
    };
    return form;
};

describe('actual starter manual multipage navigation', () => {
    it('keeps mounted drafts through zero-I/O Back/Next and submits once on the final page', async (test) => {
        const fixture = await mount(test, navigationForm(), {
            save: async () => new Response(JSON.stringify(savedForm())),
        });
        const pageField = (id: string) => {
            const node = fixture.field(id).closest('[data-form-page-field-id]');
            assert.ok(node instanceof fixture.window.HTMLElement);
            return node;
        };
        const originalTitle = fixture.field('fld_title');
        assert.equal(pageField('fld_title').hidden, false);
        assert.equal(pageField('fld_details').hidden, true);
        fixture.edit('fld_title', 'Retained first edit');
        fixture.submit(); // Enter advances; it must not dispatch Save.
        await settled();
        assert.equal(pageField('fld_details').hidden, false);
        fixture.edit('fld_details', 'Retained second edit');
        fixture.button('Back').click();
        await settled();
        assert.equal(fixture.field('fld_title'), originalTitle);
        assert.equal(originalTitle.value, 'Retained first edit');
        fixture.button('Next').click();
        fixture.button('Next').click();
        await settled();
        assert.equal(pageField('fld_final').hidden, false);
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.loads(), 1);
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            fld_title: 'Retained first edit',
            fld_details: 'Retained second edit',
            fld_final: 'Final answer',
            fld_hidden_native: ['record_retained'],
        });
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        await waitFor(
            () =>
                fixture.window.document
                    .getElementById('status')
                    ?.textContent?.includes('Saved record record_saved.') ===
                true
        );
        assert.equal(
            fixture.window.document.querySelector(
                '[data-field-id="fld_title"]'
            ),
            null
        );
    });

    it('keeps rich section descriptions outside the bounded title-only navigation', async (test) => {
        const form = navigationForm();
        const details = form.payload.fieldIdsToSchemas.fld_details;
        assert.ok(details?.fieldType === 'singleLineText');
        details.miniExtConfig = {
            ...details.miniExtConfig,
            headerSectionDescription:
                '<p>Rich instructions</p><img src="https://files.example.test/instructions.png">',
        };
        const fixture = await mount(test, form);
        fixture.button('Next').click();
        const navigation = fixture.window.document.querySelector(
            '[aria-label="Form pages"]'
        );
        assert.ok(navigation);
        assert.equal(navigation.querySelector('h3')?.textContent, 'Details');
        assert.equal(navigation.querySelector('img'), null);
        assert.doesNotMatch(
            navigation.textContent,
            /<p>|Rich instructions|instructions.png/
        );
        assert.equal(fixture.saves.length, 0);
    });

    it('blocks invalid current-page answers and inactive retained-control events without a request', async (test) => {
        const fixture = await mount(test, navigationForm());
        fixture.edit('fld_title', '');
        fixture.button('Next').click();
        fixture.submit();
        await settled();
        assert.equal(
            fixture
                .field('fld_details')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            true
        );
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_title', 'Accepted first answer');
        fixture.button('Next').click();
        fixture.edit('fld_title', 'Inactive injected edit');
        fixture.button('Next').click();
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Accepted first answer'
        );
        assert.equal(fixture.loads(), 1);
    });

    it('skips a conditionally hidden page while preserving its native answer in final Save', async (test) => {
        const form = navigationForm();
        const details = form.payload.fieldIdsToSchemas.fld_details;
        assert.ok(details?.fieldType === 'singleLineText');
        details.miniExtConfig = {
            ...details.miniExtConfig,
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'show-details',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            idOrName: { type: 'id', id: 'fld_title' },
                            value: 'show',
                        },
                    },
                ],
            },
        };
        const fixture = await mount(test, form);
        fixture.button('Next').click();
        await settled();
        assert.equal(
            fixture
                .field('fld_final')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            false
        );
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_details,
            'Second answer'
        );
        assert.equal(fixture.loads(), 1);
    });

    it('revalidates earlier pages after a later answer reveals a required field', async (test) => {
        const form = navigationForm();
        const template = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(template?.fieldType === 'singleLineText');
        form.payload.fieldIdsToSchemas.fld_required = {
            ...structuredClone(template),
            airtableField: {
                ...structuredClone(template.airtableField),
                id: 'fld_required',
                name: 'Earlier required answer',
            },
            miniExtConfig: {
                required: true,
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'later-driver',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'fld_final' },
                                value: 'show',
                            },
                        },
                    ],
                },
            },
        };
        form.payload.fieldIdsInForm.splice(1, 0, 'fld_required');
        form.payload.formRecord.data.fld_required = null;
        const fixture = await mount(test, form);
        fixture.button('Next').click();
        fixture.button('Next').click();
        fixture.edit('fld_final', 'show');
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /No Save was sent/
        );
        assert.doesNotMatch(
            fixture.window.document.body.textContent,
            /Earlier outcome not confirmed/
        );
        fixture.button('Back').click();
        fixture.button('Back').click();
        fixture.edit('fld_required', 'Completed after review');
        fixture.button('Next').click();
        fixture.button('Next').click();
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_required,
            'Completed after review'
        );
    });

    it('blocks navigation for an unuploaded native file and permits explicit clearing', async (test) => {
        const form = navigationForm();
        const attachment = loadedForm().payload.fieldIdsToSchemas.fld_files;
        assert.ok(attachment?.fieldType === 'multipleAttachments');
        form.payload.fieldIdsToSchemas.fld_files = attachment;
        form.payload.fieldIdsInForm.splice(1, 0, 'fld_files');
        form.payload.formRecord.data.fld_files = [];
        const fixture = await mount(test, form);
        const file =
            fixture.window.document.querySelector('input[type="file"]');
        assert.ok(file instanceof fixture.window.HTMLInputElement);
        let selected = [
            new fixture.window.File(['pending'], 'pending.txt', {
                type: 'text/plain',
            }),
        ];
        Object.defineProperty(file, 'files', {
            configurable: true,
            get: () => selected,
        });
        Object.defineProperty(file, 'value', {
            configurable: true,
            get: () => (selected.length ? 'pending.txt' : ''),
            set: () => {
                selected = [];
            },
        });
        file.dispatchEvent(
            new fixture.window.Event('change', { bubbles: true })
        );
        fixture.button('Next').click();
        await settled();
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /Upload or clear/
        );
        assert.equal(
            fixture
                .field('fld_details')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            true
        );
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.loads(), 1);
        fixture.button('Clear pending files').click();
        fixture.button('Next').click();
        await settled();
        assert.equal(
            fixture
                .field('fld_details')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            false
        );
    });

    it('does not retire navigation when an acknowledged Add Choice updates accepted metadata', async (test) => {
        const form = navigationForm();
        form.payload.fieldIdsToSchemas.fld_choice = {
            fieldType: 'singleSelect',
            airtableField: {
                id: 'fld_choice',
                name: 'Choice',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'singleSelect',
                    options: {
                        choices: [{ id: 'sel_existing', name: 'Existing' }],
                    },
                },
            },
            miniExtConfig: { allowAddingNewOptions: true },
        };
        form.payload.fieldIdsInForm.splice(1, 0, 'fld_choice');
        form.payload.formRecord.data.fld_choice = 'Existing';
        let choices = 0;
        const fixture = await mount(test, form, {
            read: async (url) => {
                assert.equal(
                    url.pathname,
                    '/api/trpc/airtable.addNewAirtableOptionForFormField'
                );
                choices++;
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                newChoice: {
                                    id: 'sel_created',
                                    name: 'Created',
                                },
                            },
                        },
                    })
                );
            },
        });
        const choice = fixture.window.document.querySelector(
            'input[placeholder="New choice name"]'
        );
        assert.ok(choice instanceof fixture.window.HTMLInputElement);
        choice.value = 'Created';
        fixture.button('Create choice').click();
        await waitFor(
            () =>
                choices === 1 &&
                choice.value === '' &&
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.equal(fixture.saves.length, 0);
        fixture.button('Next').click();
        fixture.button('Next').click();
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_choice, 'Created');
        assert.equal(choices, 1);
    });

    it('retires retained navigation actions across a visitor round trip', async (test) => {
        const fixture = await mount(test, navigationForm());
        const oldNext = fixture.button('Next');
        const visitor = fixture.window.document.getElementById('visitor');
        assert.ok(visitor instanceof fixture.window.HTMLSelectElement);
        for (const identity of ['B', 'A']) {
            visitor.value = identity;
            visitor.dispatchEvent(new fixture.window.Event('change'));
        }
        oldNext.click();
        await settled();
        assert.equal(
            fixture
                .field('fld_title')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            false
        );
        assert.equal(
            fixture
                .field('fld_details')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            true
        );
        assert.equal(fixture.saves.length, 0);
        fixture.button('Next').click();
        await settled();
        assert.equal(
            fixture
                .field('fld_details')
                .closest('[data-form-page-field-id]')
                ?.hasAttribute('hidden'),
            false
        );
    });

    for (const outcome of ['unknown', 'cancelled'] as const) {
        it(`preserves the existing no-replay recovery gate for ${outcome === 'unknown' ? 'an unknown' : 'a cancelled'} final Save`, async (test) => {
            const held: { resolve?: (response: Response) => void } = {};
            const fixture = await mount(test, navigationForm(), {
                save: async () => {
                    if (outcome === 'unknown')
                        throw new Error('Synthetic lost Save response.');
                    return new Promise<Response>((resolve) => {
                        held.resolve = resolve;
                    });
                },
            });
            fixture.button('Next').click();
            fixture.button('Next').click();
            fixture.submit();
            await waitFor(() => fixture.saves.length === 1);
            if (outcome === 'cancelled')
                fixture.button('Cancel request').click();
            if (outcome === 'unknown')
                await waitFor(
                    () =>
                        fixture.window.document
                            .querySelector('.error-list')
                            ?.textContent?.includes('may have completed') ===
                        true
                );
            else await settled();
            fixture.submit();
            fixture.button('Back').click();
            await settled();
            assert.equal(fixture.saves.length, 1);
            assert.equal(fixture.button('Save').disabled, true);
            assert.equal(
                (
                    fixture
                        .field('fld_final')
                        .closest('.fields') as unknown as {
                        inert: boolean;
                    } | null
                )?.inert,
                true
            );
            if (outcome === 'cancelled') {
                assert.ok(held.resolve);
                held.resolve(new Response(JSON.stringify(invalidForm())));
                await settled();
                fixture.submit();
                await settled();
                assert.equal(fixture.saves.length, 1);
                assert.equal(fixture.button('Save').disabled, true);
            }
        });
    }

    it('keeps an explicitly one-page Form with section headers on the existing Save path', async (test) => {
        const form = navigationForm();
        form.payload.publicFields.state.multiPageFormMode = 'one-page';
        const fixture = await mount(test, form);
        assert.equal(
            Array.from(fixture.window.document.querySelectorAll('button')).some(
                (node) => node.textContent === 'Next'
            ),
            false
        );
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
    });
});

const deletableChild = (): FormLoadedResult => {
    const child = reviewForm();
    child.extensionId = 'extension_child';
    child.payload.hasParentExtension = true;
    child.payload.publicFields.state.tableId = 'table_children';
    child.payload.formRecord = {
        type: 'edit',
        tableId: 'table_children',
        recordId: 'record_deleted',
        data: child.payload.formRecord.data,
    };
    child.payload.publicFields.state.allowDeletingRecords = true;
    return child;
};
const deletionRecords = (child: FormLoadedResult, deleted = false) => {
    const ids = deleted
        ? ['record_remaining']
        : ['record_deleted', 'record_remaining'];
    return portalListPage({
        airtableOffset: deleted ? null : 'cursor_before_delete',
        recordIds: ids,
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [
                    child.payload.fieldIdsToSchemas.fld_title!.airtableField,
                ],
                recordIdsToAirtableRecords: Object.fromEntries(
                    ids.map((id) => [id, { id, fields: { fld_title: id } }])
                ),
            },
        },
    });
};

describe('actual browser starter prepared review', () => {
    it('retires the cached Portal after an acknowledged child Delete and recovers only through explicit Reload', async (test) => {
        const child = deletableChild();
        const childLoads: LoadExtensionInput[] = [];
        let deletes = 0;
        let reads = 0;
        const fixture = await mount(test, child, {
            initialPortal: portalPage(),
            childLoads,
            read: async (url, init) => {
                if (url.pathname === '/api/trpc/airtable.deleteRecord') {
                    deletes++;
                    assert.deepEqual(JSON.parse(String(init?.body)), {
                        extensionAccessToken:
                            child.payload.extensionAccessToken,
                    });
                    if (child.payload.formRecord.type === 'edit')
                        child.payload.formRecord.recordId = 'record_remaining';
                    return new Response(
                        JSON.stringify({ result: { data: null } })
                    );
                }
                assert.equal(
                    url.searchParams.get('route'),
                    'fetchRecordsForLinkedTableOnPortal'
                );
                reads++;
                return new Response(
                    JSON.stringify(deletionRecords(child, deletes !== 0))
                );
            },
        });
        const { document } = fixture.window;
        const idle = () =>
            document.getElementById('screen')?.getAttribute('aria-busy') ===
            'false';
        fixture.button('Load records').click();
        await waitFor(() => reads === 1 && idle());
        const retained = [
            'Load records',
            'Next page',
            'Create record',
            'Open Form',
        ].map((title) => fixture.button(title));
        const oldPortal = retained[0]!.closest('section');
        fixture.button('Open Form').click();
        await waitFor(() => childLoads.length === 1 && idle());
        const oldBack = fixture.button('Back to Portal');
        fixture.button('Delete this record').click();
        await waitFor(() => document.querySelector('dialog[open]') !== null);
        fixture
            .button('Delete record', document.querySelector('dialog[open]')!)
            .click();
        await waitFor(() => deletes === 1 && idle());
        assert.match(
            document.getElementById('screen')!.textContent!,
            /Choose Reload when ready/
        );
        assert.equal(document.querySelector('tbody tr'), null);
        assert.equal(oldPortal?.isConnected, false);
        assert.equal(
            reads,
            1,
            'Acknowledgment must not start a hidden list read.'
        );
        assert.equal(
            fixture.loads(),
            2,
            'Acknowledgment must not start a hidden root or child load.'
        );
        for (const action of [...retained, oldBack])
            action.dispatchEvent(new fixture.window.Event('click'));
        await settled();
        assert.equal(reads, 1);
        assert.equal(
            fixture.loads(),
            2,
            'Retained Portal and Back actions must not revive the deleted context.'
        );
        assert.match(
            document.getElementById('screen')!.textContent!,
            /Choose Reload when ready/
        );
        const reload = document.getElementById('reload');
        assert.ok(reload instanceof fixture.window.HTMLButtonElement);
        reload.click();
        await waitFor(() => fixture.loads() === 3 && idle());
        fixture.button('Load records').click();
        await waitFor(() => reads === 2 && idle());
        assert.deepEqual(
            Array.from(document.querySelectorAll('tbody tr'), (row) =>
                row.getAttribute('data-record-id')
            ),
            ['record_remaining']
        );
        fixture.button('Open Form').click();
        await waitFor(() => childLoads.length === 2 && idle());
        const reopened = childLoads.at(-1);
        assert.ok(reopened && 'childExtensionInfo' in reopened);
        assert.deepEqual(reopened.childExtensionInfo.accessType, {
            type: 'edit',
            childExtensionRecordId: 'record_remaining',
            childExtensionFieldId: null,
        });
        assert.equal(fixture.field('fld_title').isConnected, true);
        const replacementBack = fixture.button('Back to Portal');
        const replacementField = fixture.field('fld_title');
        const replacementForm = replacementField.closest('form');
        assert.ok(replacementForm);
        fixture.edit('fld_title', 'Unsaved replacement child answer');
        assert.equal(oldBack.isConnected, false);
        assert.notEqual(replacementBack, oldBack);
        oldBack.dispatchEvent(new fixture.window.Event('click'));
        await settled();
        assert.equal(
            replacementForm.isConnected,
            true,
            'A detached Back callback must not navigate away from the replacement child.'
        );
        assert.equal(fixture.field('fld_title'), replacementField);
        assert.equal(fixture.button('Back to Portal'), replacementBack);
        assert.equal(replacementBack.isConnected, true);
        assert.equal(
            replacementField.value,
            'Unsaved replacement child answer'
        );
        assert.equal(reads, 2);
        assert.equal(fixture.loads(), 4);
        assert.equal(childLoads.length, 2);
        assert.equal(deletes, 1);
        assert.equal(fixture.saves.length, 0);
        replacementBack.click();
        assert.equal(replacementForm.isConnected, false);
        assert.deepEqual(
            Array.from(document.querySelectorAll('tbody tr'), (row) =>
                row.getAttribute('data-record-id')
            ),
            ['record_remaining'],
            'The current Back control must still return to the refreshed Portal.'
        );
    });

    it('keeps the child Form and cached Portal when Delete confirmation is cancelled', async (test) => {
        const child = deletableChild();
        let reads = 0;
        let deletes = 0;
        const childLoads: LoadExtensionInput[] = [];
        const fixture = await mount(test, child, {
            initialPortal: portalPage(),
            childLoads,
            read: async (url) => {
                if (url.pathname === '/api/trpc/airtable.deleteRecord')
                    deletes++;
                assert.equal(
                    url.searchParams.get('route'),
                    'fetchRecordsForLinkedTableOnPortal',
                    'A cancelled confirmation must not dispatch Delete.'
                );
                reads++;
                return new Response(JSON.stringify(deletionRecords(child)));
            },
        });
        const { document } = fixture.window;
        const idle = () =>
            document.getElementById('screen')?.getAttribute('aria-busy') ===
            'false';
        fixture.button('Load records').click();
        await waitFor(() => reads === 1 && idle());
        const portal = fixture.button('Load records').closest('section');
        fixture.button('Open Form').click();
        await waitFor(() => childLoads.length === 1 && idle());
        fixture.edit('fld_title', 'Unsaved child answer');
        fixture.button('Delete this record').click();
        await waitFor(() => document.querySelector('dialog[open]') !== null);
        fixture
            .button('Cancel', document.querySelector('dialog[open]')!)
            .click();
        await settled();
        assert.equal(fixture.field('fld_title').value, 'Unsaved child answer');
        fixture.button('Back to Portal').click();
        assert.equal(portal?.isConnected, true);
        assert.deepEqual(
            Array.from(document.querySelectorAll('tbody tr'), (row) =>
                row.getAttribute('data-record-id')
            ),
            ['record_deleted', 'record_remaining']
        );
        assert.equal(reads, 1);
        assert.equal(deletes, 0);
        assert.equal(fixture.loads(), 2);
        assert.equal(fixture.saves.length, 0);
    });

    for (const replacement of [
        'visitor round trip',
        'new connection',
    ] as const) {
        it(`ignores a late child Delete acknowledgment after ${replacement}`, async (test) => {
            const child = deletableChild();
            let deletes = 0;
            let reads = 0;
            let acknowledge: (() => void) | undefined;
            const held = new Promise<void>((resolve) => {
                acknowledge = resolve;
            });
            const childLoads: LoadExtensionInput[] = [];
            const fixture = await mount(test, child, {
                initialPortal: portalPage(),
                childLoads,
                read: async (url) => {
                    if (url.pathname === '/api/trpc/airtable.deleteRecord') {
                        deletes++;
                        await held;
                        return new Response(
                            JSON.stringify({ result: { data: null } })
                        );
                    }
                    assert.equal(
                        url.searchParams.get('route'),
                        'fetchRecordsForLinkedTableOnPortal'
                    );
                    reads++;
                    return new Response(JSON.stringify(deletionRecords(child)));
                },
            });
            const { document } = fixture.window;
            const idle = () =>
                document.getElementById('screen')?.getAttribute('aria-busy') ===
                'false';
            fixture.button('Load records').click();
            await waitFor(() => reads === 1 && idle());
            fixture.button('Open Form').click();
            await waitFor(() => childLoads.length === 1 && idle());
            fixture.button('Delete this record').click();
            await waitFor(
                () => document.querySelector('dialog[open]') !== null
            );
            fixture
                .button(
                    'Delete record',
                    document.querySelector('dialog[open]')!
                )
                .click();
            await waitFor(() => deletes === 1);
            fixture.button('Cancel request').click();
            await settled();
            if (replacement === 'visitor round trip') {
                const visitor = document.getElementById('visitor');
                assert.ok(visitor instanceof fixture.window.HTMLSelectElement);
                for (const identity of ['B', 'A']) {
                    visitor.value = identity;
                    visitor.dispatchEvent(new fixture.window.Event('change'));
                }
                assert.equal(fixture.button('Save').disabled, true);
            } else {
                fixture.button('Disconnect').click();
                document.getElementById('connection-form')!.dispatchEvent(
                    new fixture.window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await waitFor(() => fixture.loads() === 3 && idle());
                assert.ok(fixture.button('Load records').isConnected);
            }
            const successor =
                document.getElementById('screen')!.firstElementChild;
            const status = document.getElementById('status')!.textContent;
            assert.ok(acknowledge);
            acknowledge();
            await settled();
            assert.equal(
                document.getElementById('screen')!.firstElementChild,
                successor
            );
            assert.equal(
                document.getElementById('status')!.textContent,
                status
            );
            assert.equal(deletes, 1);
            assert.equal(reads, 1);
            assert.equal(fixture.saves.length, 0);
            if (replacement === 'visitor round trip') {
                const expiredForm = fixture.field('fld_title').closest('form');
                assert.ok(expiredForm);
                assert.equal(
                    fixture.button('Delete this record').disabled,
                    true
                );
                const loadsBeforeBack = fixture.loads();
                fixture.button('Back to Portal').click();
                assert.equal(
                    expiredForm.isConnected,
                    false,
                    'The current Back control must allow navigation from an expired child.'
                );
                assert.equal(fixture.button('Load records').isConnected, true);
                assert.equal(fixture.loads(), loadsBeforeBack);
                assert.equal(reads, 1);
                assert.equal(deletes, 1);
                assert.equal(fixture.saves.length, 0);
            }
        });
    }

    it('reviews ordered plain values and fixed password masks, then saves the complete native draft once', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = {
            title: '<b>Semantic secret</b>',
            showTitle: false,
            obscurePassword: true,
        };
        form.payload.formRecord.data.fld_title = 'CaseSensitiveSecret';
        form.payload.formRecord.data.fld_readonly =
            '<img src=x onerror=alert(1)>';
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelector('img, b'), null);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dt'), (row) => row.textContent),
            ['<b>Semantic secret</b>', 'Read only']
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['••••••••', '<img src=x onerror=alert(1)>']
        );
        assert.equal(
            dialog.textContent?.includes('CaseSensitiveSecret'),
            false
        );
        const label = dialog.querySelector('dt');
        const value = dialog.querySelector('dd');
        assert.ok(label && value);
        assert.equal(value.getAttribute('aria-labelledby'), label.id);
        assert.equal(label.getAttribute('data-review-title-hidden'), 'true');
        assert.equal(
            fixture.window.document.activeElement,
            fixture.button('Edit', dialog)
        );
        fixture.button('Edit', dialog).click();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.field('fld_title').value, 'CaseSensitiveSecret');
        fixture.edit('fld_title', 'SecondSecret');
        const second = await fixture.openReview();
        fixture.button('Confirm', second).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            fld_title: 'SecondSecret',
            fld_readonly: '<img src=x onerror=alert(1)>',
            fld_hidden_native: ['record_retained'],
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        assert.equal(fixture.saves[0]?.isComputeMode, false);
    });

    it('uses the canonical conditional projection and emptiness without dropping hidden native Save values', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        form.payload.fieldIdsToSchemas.fld_driver = {
            fieldType: AirtableFieldType.CHECKBOX,
            airtableField: {
                id: 'fld_driver',
                name: 'Show title',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.CHECKBOX,
                    options: { color: 'greenBright', icon: 'check' },
                },
            },
        };
        form.payload.fieldIdsToSchemas.fld_number = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_number',
                name: 'Zero count',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
        };
        title.miniExtConfig = {
            title: 'Hidden title',
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'review_condition',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: AirtableFieldType.CHECKBOX,
                            idOrName: { type: 'id', id: 'fld_driver' },
                            value: true,
                        },
                    },
                ],
            },
        };
        form.payload.fieldIdsInForm = [
            'fld_driver',
            'fld_title',
            'fld_number',
            'fld_readonly',
        ];
        form.payload.formRecord.data.fld_driver = false;
        form.payload.formRecord.data.fld_number = 0;
        form.payload.formRecord.data.fld_readonly = '   ';
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dt'), (row) => row.textContent),
            ['Zero count']
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['0']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
        assert.equal(fixture.saves[0]?.formRecord.data.fld_driver, false);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_number, 0);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_readonly, '   ');
        assert.deepEqual(fixture.saves[0]?.formRecord.data.fld_hidden_native, [
            'record_retained',
        ]);
    });

    it('keeps an ordinary manual Save unchanged when the published review flag is off', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            promptUserBeforeSubmission: false,
        };
        const fixture = await mount(test, form);
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
    });

    it('renders every bounded scalar kind and preserves canonical empty values in Save', async (test) => {
        const form = reviewForm();
        // The metadata API also exposes manualSort; published Form schemas do
        // not. Keep this renderer fixture within its finite physical union.
        const configs: ReviewScalarConfig[] = [
            { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
            { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            { type: AirtableFieldType.EMAIL, options: null },
            { type: AirtableFieldType.URL, options: null },
            { type: AirtableFieldType.PHONE_NUMBER, options: null },
            { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.RATING,
                options: { color: 'yellowBright', icon: 'star', max: 5 },
            },
            {
                type: AirtableFieldType.CHECKBOX,
                options: { color: 'greenBright', icon: 'check' },
            },
            { type: AirtableFieldType.BARCODE, options: null },
        ];
        const values = [
            'Text',
            'Line one\nLine two',
            'person@example.test',
            'https://example.test/path',
            '+1 555 0100',
            0,
            12.5,
            0.2,
            3,
            true,
            { text: '001', type: 'code128' },
        ];
        for (const [index, config] of configs.entries()) {
            const id = `fld_scalar_${index}`;
            const field = scalarReviewSchema(id, config.type, config);
            form.payload.fieldIdsToSchemas[id] = field;
            form.payload.fieldIdsInForm.push(id);
            form.payload.formRecord.data[id] = values[index] ?? null;
        }
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            [
                'Initial title',
                'Locked value',
                'Text',
                'Line one\nLine two',
                'person@example.test',
                'https://example.test/path',
                '+1 555 0100',
                '0',
                '12.5',
                '0.2',
                '3',
                'Checked',
                '001',
            ]
        );
        assert.equal(dialog.querySelector('a, iframe, img'), null);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(
            fixture.saves[0]?.formRecord.data,
            form.payload.formRecord.data
        );
    });

    it('permits an empty review without manufacturing nonempty checkbox, rating or barcode rows', async (test) => {
        const form = reviewForm();
        const fields: Extract<
            RuntimeFieldSchema['airtableField'],
            {
                config: {
                    type: 'checkbox' | 'rating' | 'barcode';
                };
            }
        >[] = [
            {
                id: 'fld_check',
                name: 'Unchecked',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.CHECKBOX,
                    options: { color: 'greenBright', icon: 'check' },
                },
            },
            {
                id: 'fld_rating',
                name: 'Zero rating',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.RATING,
                    options: { color: 'yellowBright', icon: 'star', max: 5 },
                },
            },
            {
                id: 'fld_barcode',
                name: 'Blank barcode',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: { type: AirtableFieldType.BARCODE, options: null },
            },
        ];
        for (const field of fields) {
            form.payload.fieldIdsToSchemas[field.id] = scalarReviewSchema(
                field.id,
                field.name,
                field.config
            );
            form.payload.fieldIdsInForm.push(field.id);
        }
        form.payload.formRecord.data = {
            fld_title: null,
            fld_readonly: '   ',
            fld_check: false,
            fld_rating: 0,
            fld_barcode: { text: ' ', type: 'code128' },
            fld_hidden_native: ['record_retained'],
        };
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.equal(dialog.querySelectorAll('dt, dd').length, 0);
        assert.match(dialog.textContent ?? '', /No nonempty answers to review/);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(
            fixture.saves[0]?.formRecord.data,
            form.payload.formRecord.data
        );
    });

    it('reviews canonical whitespace across every bounded scalar family without changing native edit Save data', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            multiPageFormMode: 'one-page',
        };
        const configs: ReviewScalarConfig[] = [
            { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
            { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            { type: AirtableFieldType.EMAIL, options: null },
            { type: AirtableFieldType.URL, options: null },
            { type: AirtableFieldType.PHONE_NUMBER, options: null },
            { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.RATING,
                options: { color: 'yellowBright', icon: 'star', max: 5 },
            },
            {
                type: AirtableFieldType.CHECKBOX,
                options: { color: 'greenBright', icon: 'check' },
            },
            { type: AirtableFieldType.BARCODE, options: null },
        ];
        const blankIds: string[] = [];
        const readonlyIds: string[] = [];
        for (const [index, config] of configs.entries()) {
            // Barcode remains a read-only display. The other ten families
            // cover both editable and explicitly read-only visible controls.
            const readonlyModes =
                config.type === AirtableFieldType.BARCODE
                    ? [true]
                    : [false, true];
            for (const readOnly of readonlyModes) {
                const id = `fld_blank_${index}_${readOnly ? 'locked' : 'editable'}`;
                const schema = scalarReviewSchema(id, config.type, config);
                schema.miniExtConfig = {
                    readOnly,
                    hideFieldIfEmpty: false,
                };
                form.payload.fieldIdsToSchemas[id] = schema;
                form.payload.fieldIdsInForm.push(id);
                form.payload.formRecord.data[id] = ' \t\n ';
                blankIds.push(id);
                if (readOnly) readonlyIds.push(id);
            }
        }
        const native = structuredClone(form.payload.formRecord.data);
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = [
            'fld_hidden_native',
            ...blankIds,
        ];
        const fixture = await mount(test, form);
        for (const id of blankIds) {
            const control = fixture.window.document.querySelector(
                `[data-field-id="${id}"]`
            );
            assert.ok(control);
            assert.equal(
                control.closest('[hidden]'),
                null,
                `${id} must remain visible when hideFieldIfEmpty is disabled.`
            );
            if (readonlyIds.includes(id))
                assert.equal(control.hasAttribute('disabled'), true);
        }
        fixture.edit('fld_title', 'Whitespace retained');
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelectorAll('dt').length, 2);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Whitespace retained', 'Locked value']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.saves.length === 1 &&
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: { ...native, fld_title: 'Whitespace retained' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            ...blankIds,
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        assert.equal(fixture.saves.length, 1);
    });

    it('reviews edit Forms with hideFieldIfEmpty whitespace across every bounded scalar family without changing native Save data', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            multiPageFormMode: 'one-page',
        };
        const configs: ReviewScalarConfig[] = [
            { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
            { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            { type: AirtableFieldType.EMAIL, options: null },
            { type: AirtableFieldType.URL, options: null },
            { type: AirtableFieldType.PHONE_NUMBER, options: null },
            { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.RATING,
                options: { color: 'yellowBright', icon: 'star', max: 5 },
            },
            {
                type: AirtableFieldType.CHECKBOX,
                options: { color: 'greenBright', icon: 'check' },
            },
            { type: AirtableFieldType.BARCODE, options: null },
        ];
        const blankIds: string[] = [];
        const readonlyIds: string[] = [];
        for (const [index, config] of configs.entries()) {
            // Barcode remains a read-only display. The other ten families
            // cover both editable and explicitly read-only hidden controls.
            const readonlyModes =
                config.type === AirtableFieldType.BARCODE
                    ? [true]
                    : [false, true];
            for (const readOnly of readonlyModes) {
                const id = `fld_blank_${index}_${readOnly ? 'locked' : 'editable'}`;
                const schema = scalarReviewSchema(id, config.type, config);
                schema.miniExtConfig = {
                    readOnly,
                    hideFieldIfEmpty: true,
                };
                form.payload.fieldIdsToSchemas[id] = schema;
                form.payload.fieldIdsInForm.push(id);
                form.payload.formRecord.data[id] = ' \t\n ';
                blankIds.push(id);
                if (readOnly) readonlyIds.push(id);
            }
        }
        const native = structuredClone(form.payload.formRecord.data);
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = [
            'fld_hidden_native',
            ...blankIds,
        ];
        const fixture = await mount(test, form);
        for (const id of blankIds) {
            const control = fixture.window.document.querySelector(
                `[data-field-id="${id}"]`
            );
            assert.ok(control);
            assert.notEqual(
                control.closest('[hidden]'),
                null,
                `${id} must be hidden by the published edit-mode setting.`
            );
            if (readonlyIds.includes(id))
                assert.equal(control.hasAttribute('disabled'), true);
        }
        fixture.edit('fld_title', 'Whitespace retained');
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelectorAll('dt').length, 2);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Whitespace retained', 'Locked value']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.saves.length === 1 &&
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: { ...native, fld_title: 'Whitespace retained' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            ...blankIds,
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        assert.equal(fixture.saves.length, 1);
    });

    for (const config of [
        { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
        { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
        {
            type: AirtableFieldType.CURRENCY,
            options: { precision: 2, symbol: '$' },
        },
        {
            type: AirtableFieldType.RATING,
            options: { color: 'yellowBright', icon: 'star', max: 5 },
        },
        {
            type: AirtableFieldType.CHECKBOX,
            options: { color: 'greenBright', icon: 'check' },
        },
        { type: AirtableFieldType.BARCODE, options: null },
    ] satisfies ReviewScalarConfig[]) {
        it(`rejects a nonblank malformed ${config.type} answer after whitespace emptiness normalization`, async (test) => {
            const form = reviewForm();
            const schema = scalarReviewSchema(
                'fld_malformed',
                'Malformed answer',
                config
            );
            // A visible read-only control preserves the malformed native
            // value and isolates Review preparation from control validity.
            schema.miniExtConfig = {
                readOnly: true,
                hideFieldIfEmpty: false,
            };
            form.payload.fieldIdsToSchemas.fld_malformed = schema;
            form.payload.fieldIdsInForm.push('fld_malformed');
            const native = {
                ...form.payload.formRecord.data,
                fld_malformed: 'Nonblank malformed native value',
            };
            form.payload.formRecord = {
                type: 'edit',
                recordId: 'record_review_malformed',
                tableId: 'table_review_malformed',
                data: native,
            };
            form.payload.formFieldIdsWithUnsavedChanges = ['fld_malformed'];
            const fixture = await mount(test, form);
            const control = fixture.window.document.querySelector(
                '[data-field-id="fld_malformed"]'
            );
            assert.ok(control);
            assert.equal(control.closest('[hidden]'), null);
            fixture.submit();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(fixture.window.document.querySelector('dialog'), null);
            assert.match(
                fixture.window.document.getElementById('status')?.textContent ??
                    '',
                /review.*unavailable/i
            );
            assert.equal(fixture.field('fld_title').value, 'Initial title');
        });
    }

    it('rejects a malformed readonly scalar instead of coercing it into a review answer', async (test) => {
        const form = reviewForm();
        form.payload.fieldIdsToSchemas.fld_readonly = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_readonly',
                name: 'Count',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
            miniExtConfig: { readOnly: true },
        };
        form.payload.formRecord.data.fld_readonly = 'Malformed count';
        const fixture = await mount(test, form);
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /review.*unavailable/i
        );
    });

    it('treats Escape and dialog dismissal as Edit, and accepts only one explicit Confirm', async (test) => {
        const fixture = await mount(test, reviewForm());
        const first = await fixture.openReview();
        first.dispatchEvent(
            new fixture.window.Event('cancel', { cancelable: true })
        );
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(first.isConnected, false);
        const second = await fixture.openReview();
        second.close();
        await settled();
        assert.equal(fixture.saves.length, 0);
        const third = await fixture.openReview();
        const confirm = fixture.button('Confirm', third);
        confirm.click();
        confirm.click();
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
    });

    it('invalidates a prepared review after an accepted draft edit, including edit-away-and-back', async (test) => {
        const fixture = await mount(test, reviewForm());
        const dialog = await fixture.openReview();
        const stale = fixture.button('Confirm', dialog);
        fixture.edit('fld_title', 'Changed while prepared');
        fixture.edit('fld_title', 'Initial title');
        stale.click();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.isConnected, false);
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
    });

    it('invalidates review before an invalid numeric edit can throw or submit the last accepted value', async (test) => {
        const form = reviewForm();
        form.payload.fieldIdsToSchemas.fld_number = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_number',
                name: 'Count',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
        };
        form.payload.fieldIdsInForm.push('fld_number');
        form.payload.formRecord.data.fld_number = 7;
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        const stale = fixture.button('Confirm', dialog);
        const number = fixture.field('fld_number');
        assert.equal(number.type, 'text');
        assert.equal(number.inputMode, 'decimal');
        number.value = '-';
        number.dispatchEvent(
            new fixture.window.Event('input', { bubbles: true })
        );
        assert.equal(
            dialog.isConnected,
            false,
            'The invalid edit itself must dismiss review before a stale Confirm can close it.'
        );
        assert.equal(fixture.saves.length, 0);
        assert.match(
            number.parentElement?.parentElement?.textContent ?? '',
            /valid finite number/
        );
        stale.click();
        await settled();
        assert.equal(dialog.isConnected, false);
        assert.equal(fixture.saves.length, 0);
        assert.match(
            number.parentElement?.parentElement?.textContent ?? '',
            /valid finite number/
        );
        assert.equal(fixture.field('fld_title').value, 'Initial title');
        fixture.submit();
        await settled();
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_number', '8');
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_number, 8);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord.data.fld_hidden_native, [
            'record_retained',
        ]);
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_number',
        ]);
    });

    it('confirms an explicit one-page edit Form with its record identity and complete native draft', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            multiPageFormMode: 'one-page',
        };
        const native = {
            ...form.payload.formRecord.data,
            fld_retained_number: 0,
            fld_retained_barcode: { text: '001', type: 'code128' },
        };
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_review_edit',
            tableId: 'table_review_edit',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = ['fld_hidden_native'];
        const fixture = await mount(test, form);
        fixture.edit('fld_title', 'Edited request');
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Edited request', 'Locked value']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            recordId: 'record_review_edit',
            tableId: 'table_review_edit',
            data: { ...native, fld_title: 'Edited request' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            'fld_title',
        ]);
        assert.equal(
            fixture.saves[0]?.extensionAccessToken,
            form.payload.extensionAccessToken
        );
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        await settled();
        assert.equal(fixture.saves.length, 1);
    });

    it('retires a prepared intent across visitor A-to-B-to-A and requires a fresh review', async (test) => {
        const fixture = await mount(test, reviewForm());
        const dialog = await fixture.openReview();
        const stale = fixture.button('Confirm', dialog);
        const visitor = fixture.window.document.getElementById('visitor');
        assert.ok(visitor instanceof fixture.window.HTMLSelectElement);
        for (const identity of ['B', 'A']) {
            visitor.value = identity;
            visitor.dispatchEvent(
                new fixture.window.Event('change', { bubbles: true })
            );
        }
        stale.click();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.isConnected, false);
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
    });

    for (const action of [
        'Reload',
        'Discard draft',
        'Disconnect',
        "Clear this visitor's session",
    ]) {
        it(`invalidates prepared confirmation on ${action}`, async (test) => {
            const fixture = await mount(test, reviewForm());
            const dialog = await fixture.openReview();
            const stale = fixture.button('Confirm', dialog);
            fixture.button(action).click();
            stale.click();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(dialog.isConnected, false);
            if (action === 'Reload') assert.equal(fixture.loads(), 2);
            if (action === "Clear this visitor's session")
                assert.match(
                    fixture.window.document.getElementById('status')
                        ?.textContent ?? '',
                    /anonymous again/
                );
        });
    }

    it('opens review before required validation and preserves the backend errors and draft', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = { required: true };
        form.payload.formRecord.data.fld_title = null;
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(invalidForm())),
        });
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelectorAll('dt').length, 1);
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.window.document
                    .querySelector('.error-list')
                    ?.textContent?.includes('A title is required.') === true
        );
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.field('fld_title').value, '');
        fixture.edit('fld_title', 'Repaired title');
        const fresh = await fixture.openReview();
        fixture.button('Edit', fresh).click();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.field('fld_title').value, 'Repaired title');
    });

    for (const scenario of [
        {
            label: 'obscurePassword',
            flags: { obscurePassword: true },
            masked: true,
        },
        {
            label: 'maskPasswordOnLoginScreen',
            flags: { obscurePassword: false, maskPasswordOnLoginScreen: true },
            masked: true,
        },
        {
            label: 'unknown obscurePassword',
            flags: { obscurePassword: 'unexpected' },
            masked: true,
        },
        {
            label: 'unknown maskPasswordOnLoginScreen',
            flags: { maskPasswordOnLoginScreen: 'unexpected' },
            masked: true,
        },
        {
            label: 'null obscurePassword',
            flags: { obscurePassword: null },
            masked: true,
        },
        {
            label: 'null maskPasswordOnLoginScreen',
            flags: { maskPasswordOnLoginScreen: null },
            masked: true,
        },
        {
            label: 'zero obscurePassword',
            flags: { obscurePassword: 0 },
            masked: true,
        },
        {
            label: 'zero maskPasswordOnLoginScreen',
            flags: { maskPasswordOnLoginScreen: 0 },
            masked: true,
        },
        {
            label: 'explicit false flags',
            flags: { obscurePassword: false, maskPasswordOnLoginScreen: false },
            masked: false,
        },
        { label: 'absent flags', flags: {}, masked: false },
    ]) {
        const numberForm = (): FormLoadedResult => {
            const form = reviewForm();
            const numeric = scalarReviewSchema('fld_number', 'Private number', {
                type: AirtableFieldType.NUMBER,
                options: { precision: 0 },
            });
            // Malformed defined flags model runtime metadata conservatively;
            // no public field configuration contract is widened.
            numeric.miniExtConfig = {
                readOnly: false,
                ...scenario.flags,
            } as unknown as RuntimeFieldSchema['miniExtConfig'];
            form.payload.fieldIdsToSchemas.fld_number = numeric;
            form.payload.fieldIdsInForm.push('fld_number');
            form.payload.formRecord.data.fld_number = 1234;
            return form;
        };
        it(`keeps Number recovery references consistent with ${scenario.label} masking`, async (test) => {
            const form = numberForm();
            form.payload.publicFields.state.promptUserBeforeSubmission = false;
            const fixture = await mount(test, form, {
                save: async () => {
                    throw new Error('Synthetic unknown Save outcome.');
                },
            });
            assert.equal(
                fixture.field('fld_number').type,
                scenario.masked ? 'password' : 'text'
            );
            fixture.edit('fld_number', '56781234');
            fixture.edit('fld_title', 'Ordinary reference remains available');
            fixture.submit();
            await waitFor(
                () =>
                    fixture.window.document
                        .querySelector('.error-list')
                        ?.textContent?.includes('may have completed') ===
                        true &&
                    fixture.window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            const reference = fixture.window.document.querySelector(
                'details[aria-label="Earlier local input (reference only)"]'
            );
            assert.ok(reference);
            assert.match(
                reference.textContent ?? '',
                /Ordinary reference remains available/
            );
            assert.equal(
                reference.outerHTML.includes('56781234'),
                !scenario.masked,
                'A password-masked Number must never enter the recovery reference.'
            );
            assert.equal(fixture.saves.length, 1);
            assert.equal(
                fixture.saves[0]?.formRecord.data.fld_number,
                56781234
            );
            assert.ok(
                fixture.saves[0]?.formFieldIdsWithUnsavedChanges.includes(
                    'fld_number'
                )
            );
            fixture.submit();
            await settled();
            assert.equal(fixture.saves.length, 1);
            assert.equal(fixture.button('Save').disabled, true);
        });
        it(`keeps Number Review consistent with ${scenario.label} masking`, async (test) => {
            const fixture = await mount(test, numberForm());
            assert.equal(
                fixture.field('fld_number').type,
                scenario.masked ? 'password' : 'text'
            );
            fixture.edit('fld_number', '56781234');
            let dialog = await fixture.openReview();
            assert.equal(fixture.saves.length, 0);
            assert.equal(
                dialog.outerHTML.includes('56781234'),
                !scenario.masked,
                'A password-masked Number must never enter the Review copy.'
            );
            assert.deepEqual(
                Array.from(
                    dialog.querySelectorAll('dd'),
                    (row) => row.textContent
                ),
                [
                    'Initial title',
                    'Locked value',
                    scenario.masked ? '••••••••' : '56781234',
                ]
            );
            fixture.button('Edit', dialog).click();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(fixture.loads(), 1);
            assert.equal(fixture.field('fld_number').value, '56781234');
            dialog = await fixture.openReview();
            fixture.button('Confirm', dialog).click();
            await waitFor(() => fixture.saves.length === 1);
            assert.equal(
                fixture.saves[0]?.formRecord.data.fld_number,
                56781234
            );
            assert.ok(
                fixture.saves[0]?.formFieldIdsWithUnsavedChanges.includes(
                    'fld_number'
                )
            );
            await settled();
            assert.equal(fixture.saves.length, 1);
        });
    }

    it('keeps an unknown Save outcome blocked instead of reopening or replaying confirmation', async (test) => {
        const fixture = await mount(test, reviewForm(), {
            save: async () => {
                throw new Error('Synthetic transport outcome unknown.');
            },
        });
        const dialog = await fixture.openReview();
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.window.document
                    .querySelector('.error-list')
                    ?.textContent?.includes('may have completed') === true
        );
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.button('Save').disabled, true);
        assert.equal(fixture.field('fld_title').value, 'Initial title');
        assert.equal(
            (
                fixture.field('fld_title').closest('.fields') as unknown as {
                    inert: boolean;
                } | null
            )?.inert,
            true,
            'uncertain Review Save keeps the actual field group inert'
        );
    });

    it('blocks a cancelled held Save and ignores its late response without replaying review', async (test) => {
        const held: { resolve?: (response: Response) => void } = {};
        const fixture = await mount(test, reviewForm(), {
            save: async () =>
                new Promise<Response>((resolve) => {
                    held.resolve = resolve;
                }),
        });
        const dialog = await fixture.openReview();
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        fixture.button('Cancel request').click();
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.ok(held.resolve);
        assert.equal(
            (
                fixture.field('fld_title').closest('.fields') as unknown as {
                    inert: boolean;
                } | null
            )?.inert,
            true,
            'cancelled Review Save keeps the actual field group inert'
        );
        held.resolve(
            new Response(
                JSON.stringify({
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                })
            )
        );
        await settled();
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(
            (
                fixture.field('fld_title').closest('.fields') as unknown as {
                    inert: boolean;
                } | null
            )?.inert,
            true,
            'late cancelled response cannot unlock untracked field edits'
        );
    });

    for (const config of [
        { multiPageFormMode: 'unsupported-mode' as 'one-page' },
        { enableFormComputeMode: true },
        { autoSubmitAfterPrefill: true },
    ]) {
        it(`blocks review and Save for unsupported workflow ${Object.keys(config)[0]}`, async (test) => {
            const form = reviewForm();
            form.payload.publicFields.state = {
                ...form.payload.publicFields.state,
                promptUserBeforeSubmission: true,
                ...config,
            };
            const fixture = await mount(test, form);
            fixture.submit();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(fixture.window.document.querySelector('dialog'), null);
            assert.match(
                fixture.window.document.getElementById('status')?.textContent ??
                    '',
                /review.*unavailable|review.*supports/i
            );
        });
    }

    it('reviews an ordinary section with its header disabled and saves the complete native edit draft', async (test) => {
        const form = reviewForm();
        const readonly = form.payload.fieldIdsToSchemas.fld_readonly;
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(readonly && title);
        readonly.miniExtConfig = {
            readOnly: true,
            enableSectionHeader: false,
            headerSectionTitle: 'Retained section',
            hideFieldIfEmpty: true,
        };
        const inside = scalarReviewSchema('fld_inside', 'Inside answer', {
            type: 'singleLineText',
            options: null,
        });
        inside.miniExtConfig = { readOnly: true, hideFieldIfEmpty: true };
        form.payload.fieldIdsToSchemas.fld_inside = inside;
        form.payload.fieldIdsInForm.push('fld_inside');
        const native = {
            ...form.payload.formRecord.data,
            fld_readonly: '   ',
            fld_inside: 'Inside retained answer',
            fld_unrendered_number: 0,
        };
        form.payload.formRecord = {
            type: 'edit',
            tableId: 'tbl_inside_review',
            recordId: 'rec_inside_review',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = [
            'fld_hidden_native',
            'fld_readonly',
        ];
        const fixture = await mount(test, form);
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_title', 'Edited ordinary section');
        const dialog = await fixture.openReview();
        assert.ok(
            fixture.window.document.querySelector('dialog[open]') !== null,
            'Expected Review for the ordinary section with its header disabled.'
        );
        assert.equal(fixture.saves.length, 0);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dt'), (row) => row.textContent),
            ['Request title', 'Inside answer']
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Edited ordinary section', 'Inside retained answer']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            tableId: 'tbl_inside_review',
            recordId: 'rec_inside_review',
            data: { ...native, fld_title: 'Edited ordinary section' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            'fld_readonly',
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        await settled();
        assert.equal(fixture.saves.length, 1);
    });

    it('blocks applied-condition section plus active edit empty hiding without exposing values', async (test) => {
        const form = reviewForm();
        form.payload.formRecord = {
            type: 'edit',
            tableId: 'tbl_review',
            recordId: 'rec_review',
            data: form.payload.formRecord.data,
        };
        const readonly = form.payload.fieldIdsToSchemas.fld_readonly;
        assert.ok(readonly);
        readonly.miniExtConfig = {
            readOnly: true,
            enableSectionHeader: false,
            headerSectionTitle: 'Retained section',
            hideFieldIfEmpty: true,
            applyFieldConditionsToSection: true,
        };
        const fixture = await mount(test, form);
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.ok(
            fixture.window.document.querySelector('dialog') === null,
            'Applied-section refusal must keep Review closed.'
        );
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /unavailable|blocked/i
        );
    });

    it('blocks complex rendered answers without sending an incomplete scalar review', async (test) => {
        const form = reviewForm();
        const computed = loadedForm().payload.fieldIdsToSchemas.fld_computed;
        assert.ok(computed);
        form.payload.fieldIdsToSchemas.fld_computed = computed;
        form.payload.fieldIdsInForm.push('fld_computed');
        form.payload.formRecord.data.fld_computed = 'Private formula answer';
        const fixture = await mount(test, form);
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /review.*unavailable/i
        );
    });

    it('presents an unhydrated linked answer generically while retaining its native ID and adjacent scalar answers', async (test) => {
        const form = reviewForm();
        const linkedConfig = structuredClone(portalField.config);
        assert.ok(
            linkedConfig.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
        );
        form.payload.fieldIdsToSchemas.fld_linked = {
            fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
            airtableField: {
                ...structuredClone(portalField),
                id: 'fld_linked',
                name: 'Linked answer',
                config: linkedConfig,
            },
            miniExtConfig: { readOnly: true },
        };
        form.payload.fieldIdsInForm.push('fld_linked');
        form.payload.formRecord.data.fld_linked = ['record_linked'];
        const fixture = await mount(test, form);
        const linked = fixture.window.document.querySelector(
            '[data-field-id="fld_linked"]'
        );
        assert.ok(linked instanceof fixture.window.HTMLTextAreaElement);
        assert.equal(linked.value, JSON.stringify(['record_linked'], null, 2));
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        const dialog = fixture.window.document.querySelector('dialog');
        assert.ok(dialog);
        const row = dialog.querySelector('[data-review-field-id="fld_linked"]');
        assert.equal(
            row?.nextElementSibling?.textContent,
            'Selected record — details unavailable'
        );
        assert.equal(dialog.textContent?.includes('record_linked'), false);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0].formRecord.data.fld_linked, [
            'record_linked',
        ]);
        assert.equal(fixture.field('fld_title').value, 'Initial title');
        assert.equal(fixture.field('fld_readonly').value, 'Locked value');
        assert.equal(linked.value, JSON.stringify(['record_linked'], null, 2));
    });

    it('retires child review on Back to Portal and confirms a fresh child review with the exact parent context', async (test) => {
        const child = reviewForm();
        child.extensionId = 'extension_child';
        child.payload.hasParentExtension = true;
        child.payload.formRecord.data.fld_parent = ['record_parent'];
        child.payload.formFieldIdsWithUnsavedChanges = ['fld_parent'];
        child.payload.urlPrefilledFieldIds = ['fld_parent'];
        const parent = portalPage();
        const childLoads: LoadExtensionInput[] = [];
        let portalReads = 0;
        const fixture = await mount(test, child, {
            initialPortal: parent,
            childLoads,
            read: async (url) => {
                assert.equal(
                    url.searchParams.get('route'),
                    'fetchRecordsForLinkedTableOnPortal'
                );
                portalReads += 1;
                return new Response(JSON.stringify(portalListPage()));
            },
        });
        const idle = () =>
            fixture.window.document
                .getElementById('screen')
                ?.getAttribute('aria-busy') === 'false';
        fixture.button('Load records').click();
        await waitFor(() => portalReads === 1 && idle());
        fixture.button('Create record').click();
        await waitFor(() => childLoads.length === 1 && idle());
        fixture.edit('fld_title', 'Retained child draft');
        const first = await fixture.openReview();
        const stale = fixture.button('Confirm', first);
        assert.equal(fixture.saves.length, 0);
        fixture.button('Back to Portal').click();
        assert.equal(
            first.isConnected,
            false,
            'Returning to the parent retires the child dialog before any stale action.'
        );
        stale.click();
        await settled();
        assert.equal(first.isConnected, false);
        assert.equal(fixture.saves.length, 0);
        assert.equal(
            fixture.window.document.querySelector(
                '[data-field-id="fld_title"]'
            ),
            null
        );
        fixture.button('Create record').click();
        await waitFor(() => childLoads.length === 2 && idle());
        assert.equal(fixture.field('fld_title').value, 'Retained child draft');
        const fresh = await fixture.openReview();
        assert.deepEqual(
            Array.from(fresh.querySelectorAll('dd'), (row) => row.textContent),
            ['Retained child draft', 'Locked value']
        );
        const parentPrefill = {
            toLinkToParent: {
                reversedFieldIdToPrefill: 'fld_parent',
                parentFormRecordId: 'record_parent',
            },
            prefillQueryForChildExtension: 'prefill_Title=Example',
        };
        for (const loaded of childLoads) {
            assert.ok('childExtensionAccessData' in loaded);
            assert.deepEqual(loaded.context, {
                type: 'modal',
                linkedTableIdOfLinkedRecordField: 'table_children',
                prefillDataForLinkedRecordsForm: parentPrefill,
            });
            assert.deepEqual(loaded.childExtensionAccessData, {
                parentExtensionAccessToken: 'portal_access_example',
                fieldIdUsedToAccessExtension: 'fld_children',
            });
        }
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1 && idle());
        assert.deepEqual(fixture.saves[0]?.context, {
            type: 'modal',
            prefillData: parentPrefill,
        });
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'create',
            data: {
                fld_title: 'Retained child draft',
                fld_readonly: 'Locked value',
                fld_hidden_native: ['record_retained'],
                fld_parent: ['record_parent'],
            },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_parent',
            'fld_title',
        ]);
        assert.equal(
            fixture.saves[0]?.extensionAccessToken,
            child.payload.extensionAccessToken
        );
        assert.equal(portalReads, 1);
        assert.equal(childLoads.length, 2);
        assert.equal(fixture.saves.length, 1);
    });

    it('retires held address predictions before capture and resumes only after fresh typing', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = { enableAddressAutocomplete: true };
        let reads = 0;
        const prediction: { resolve?: (response: Response) => void } = {};
        const fixture = await mount(test, form, {
            read: async (url) => {
                assert.equal(
                    url.pathname,
                    '/api/trpc/publicExtensions.autoCompleteAddressField'
                );
                reads += 1;
                return new Promise<Response>((resolve) => {
                    prediction.resolve = resolve;
                });
            },
        });
        fixture.edit('fld_title', '12 Main');
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(reads, 1);
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        const resolvePrediction = prediction.resolve;
        assert.ok(resolvePrediction);
        resolvePrediction(
            new Response(
                JSON.stringify({
                    result: {
                        data: [
                            {
                                description: 'Stale provider address',
                                placeId: 'stale_place',
                            },
                        ],
                    },
                })
            )
        );
        await settled();
        assert.equal(
            fixture.window.document.querySelectorAll('[role="option"]').length,
            0
        );
        assert.equal(fixture.field('fld_title').value, '12 Main');
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['12 Main', 'Locked value']
        );
        fixture.button('Edit', dialog).click();
        await settled();
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(reads, 1);
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_title', '12 Main Street');
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(reads, 2);
    });

    it('retires a selected address detail intent before review capture and rejects its held formatted completion', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = { enableAddressAutocomplete: true };
        let predictionReads = 0;
        let detailReads = 0;
        const detail: {
            resolve?: (response: Response) => void;
            signal?: AbortSignal | null;
        } = {};
        const fixture = await mount(test, form, {
            read: async (url, init) => {
                if (
                    url.pathname ===
                    '/api/trpc/publicExtensions.autoCompleteAddressField'
                ) {
                    predictionReads += 1;
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: [
                                    {
                                        description:
                                            'Accepted address description',
                                        placeId: 'selected_place',
                                    },
                                ],
                            },
                        })
                    );
                }
                assert.equal(
                    url.pathname,
                    '/api/trpc/publicExtensions.getFormattedAddressFromPlaceId'
                );
                assert.deepEqual(
                    JSON.parse(url.searchParams.get('input') ?? '{}'),
                    {
                        extensionAccessToken: form.payload.extensionAccessToken,
                        fieldId: 'fld_title',
                        placeId: 'selected_place',
                    }
                );
                detailReads += 1;
                detail.signal = init?.signal ?? null;
                return new Promise<Response>((resolve) => {
                    detail.resolve = resolve;
                });
            },
        });
        fixture.edit('fld_title', '12 Main');
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        await waitFor(
            () =>
                fixture.window.document.querySelector('[role="option"]') !==
                null
        );
        const suggestion =
            fixture.window.document.querySelector('[role="option"]');
        assert.ok(suggestion instanceof fixture.window.HTMLButtonElement);
        suggestion.click();
        await waitFor(() => detailReads === 1);
        assert.equal(
            fixture.field('fld_title').value,
            'Accepted address description'
        );
        assert.equal(detail.signal?.aborted, false);
        const dialog = await fixture.openReview();
        assert.equal(
            detail.signal?.aborted,
            true,
            'Review must actively retire the held selected-place intent.'
        );
        assert.equal(fixture.field('fld_title').disabled, true);
        assert.equal(fixture.saves.length, 0);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Accepted address description', 'Locked value']
        );
        assert.ok(detail.resolve);
        detail.resolve(
            new Response(
                JSON.stringify({
                    result: {
                        data: 'Late formatted address must not replace the accepted description',
                    },
                })
            )
        );
        await settled();
        assert.equal(
            fixture.field('fld_title').value,
            'Accepted address description'
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Accepted address description', 'Locked value']
        );
        assert.equal(fixture.saves.length, 0);
        fixture.button('Edit', dialog).click();
        await settled();
        assert.equal(fixture.field('fld_title').disabled, false);
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(predictionReads, 1);
        assert.equal(detailReads, 1);
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            fld_title: 'Accepted address description',
            fld_readonly: 'Locked value',
            fld_hidden_native: ['record_retained'],
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(predictionReads, 1);
        assert.equal(detailReads, 1);
    });
});

describe('actual starter final Review for manual pages', () => {
    const reviewed = () => {
        const form = navigationForm();
        form.payload.publicFields.state.promptUserBeforeSubmission = true;
        return form;
    };
    const finalPage = (fixture: Awaited<ReturnType<typeof mount>>) => {
        fixture.button('Next').click();
        fixture.button('Next').click();
    };
    const idle = (fixture: Awaited<ReturnType<typeof mount>>) =>
        fixture.window.document
            .getElementById('screen')
            ?.getAttribute('aria-busy') === 'false';
    it('keeps page navigation and opens final Review only after the last page', async (test) => {
        const form = navigationForm();
        form.payload.publicFields.state.promptUserBeforeSubmission = true;
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(savedForm())),
        });
        const details = fixture.field('fld_details');
        assert.ok(
            details.closest('[hidden]'),
            'Review must not flatten all configured pages into one screen'
        );
        const title = fixture.field('fld_title');
        fixture.edit('fld_title', 'First reviewed answer');
        fixture.button('Next').click();
        assert.equal(details.closest('[hidden]'), null);
        fixture.edit('fld_details', 'Second reviewed answer');
        fixture.button('Next').click();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.loads(), 1);
        const dialog = await fixture.openReview();
        assert.match(dialog.textContent ?? '', /First reviewed answer/);
        assert.match(dialog.textContent ?? '', /Second reviewed answer/);
        assert.match(dialog.textContent ?? '', /Final answer/);
        fixture.button('Edit', dialog).click();
        await settled();
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.field('fld_title'), title);
        assert.ok(fixture.field('fld_title').closest('[hidden]'));
        assert.equal(fixture.field('fld_final').closest('[hidden]'), null);
        assert.equal(fixture.saves.length, 0);
        const nextDialog = await fixture.openReview();
        fixture.button('Confirm', nextDialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            fld_title: 'First reviewed answer',
            fld_details: 'Second reviewed answer',
            fld_final: 'Final answer',
            fld_hidden_native: ['record_retained'],
        });
        await waitFor(
            () =>
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /Saved record record_saved/
        );
    });

    it('enforces Next validation but allows final Review before ordinary required validation succeeds', async (test) => {
        const fixture = await mount(test, reviewed());
        fixture.edit('fld_title', '');
        fixture.button('Next').click();
        fixture.submit();
        await settled();
        assert.equal(fixture.field('fld_title').closest('[hidden]'), null);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_title', 'Accepted first answer');
        finalPage(fixture);
        fixture.edit('fld_final', '');
        assert.equal(fixture.button('Review answers').disabled, false);
        const dialog = await fixture.openReview();
        fixture.button('Confirm', dialog).click();
        await waitFor(() => idle(fixture));
        assert.equal(
            fixture.saves.length,
            0,
            'Confirm must retain all-page validation'
        );
        assert.equal(fixture.field('fld_final').closest('[hidden]'), null);
        assert.equal(fixture.button('Back').disabled, false);
        fixture.edit('fld_final', 'Completed last answer');
        const fresh = await fixture.openReview();
        fixture.button('Edit', fresh).click();
        await waitFor(() => idle(fixture));
        assert.equal(fixture.field('fld_final').value, 'Completed last answer');
    });

    it('revalidates an earlier required answer revealed by a later-page value before final Save', async (test) => {
        const form = reviewed();
        const template = form.payload.fieldIdsToSchemas.fld_title!;
        assert.ok(template.fieldType === 'singleLineText');
        form.payload.fieldIdsToSchemas.fld_required = {
            ...structuredClone(template),
            airtableField: {
                ...structuredClone(template.airtableField),
                id: 'fld_required',
                name: 'Earlier required',
            },
            miniExtConfig: {
                required: true,
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'show-earlier',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'fld_final' },
                                value: 'show',
                            },
                        },
                    ],
                },
            },
        };
        form.payload.fieldIdsInForm.splice(1, 0, 'fld_required');
        form.payload.formRecord.data.fld_required = null;
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(savedForm())),
        });
        finalPage(fixture);
        fixture.edit('fld_final', 'show');
        const first = await fixture.openReview();
        fixture.button('Confirm', first).click();
        await waitFor(() => idle(fixture));
        assert.equal(fixture.saves.length, 0);
        fixture.button('Back').click();
        fixture.button('Back').click();
        assert.equal(fixture.field('fld_required').closest('[hidden]'), null);
        fixture.edit('fld_required', 'Completed earlier answer');
        finalPage(fixture);
        const fresh = await fixture.openReview();
        assert.match(fresh.textContent ?? '', /Completed earlier answer/);
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1 && idle(fixture));
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_required,
            'Completed earlier answer'
        );
    });

    it('skips hidden pages, masks the existing password presentation and preserves complete native answers', async (test) => {
        const form = reviewed();
        const title = form.payload.fieldIdsToSchemas.fld_title!;
        title.miniExtConfig = { ...title.miniExtConfig, obscurePassword: true };
        form.payload.formRecord.data.fld_title = 'PRIVATE_MASKED_ANSWER';
        form.payload.formRecord.data.fld_details = 'PRIVATE_HIDDEN_ANSWER';
        const details = form.payload.fieldIdsToSchemas.fld_details!;
        details.miniExtConfig = {
            ...details.miniExtConfig,
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'hidden-middle',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            idOrName: { type: 'id', id: 'fld_title' },
                            value: 'show',
                        },
                    },
                ],
            },
        };
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(savedForm())),
        });
        fixture.button('Next').click();
        assert.equal(fixture.field('fld_final').closest('[hidden]'), null);
        const dialog = await fixture.openReview();
        assert.doesNotMatch(
            dialog.textContent ?? '',
            /PRIVATE_MASKED_ANSWER|PRIVATE_HIDDEN_ANSWER/
        );
        assert.match(dialog.textContent ?? '', /••••••••/);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1 && idle(fixture));
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'PRIVATE_MASKED_ANSWER'
        );
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_details,
            'PRIVATE_HIDDEN_ANSWER'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord.data.fld_hidden_native, [
            'record_retained',
        ]);
        assert.equal(fixture.loads(), 1);
    });

    it('refuses an unsupported computed Review without losing final-page controls or native answers', async (test) => {
        const form = reviewed();
        const computed = loadedForm().payload.fieldIdsToSchemas.fld_computed;
        assert.ok(computed);
        form.payload.fieldIdsToSchemas.fld_computed = computed;
        form.payload.fieldIdsInForm.push('fld_computed');
        form.payload.formRecord.data.fld_computed = 'PRIVATE_FORMULA_ANSWER';
        const fixture = await mount(test, form);
        finalPage(fixture);
        const final = fixture.field('fld_final');
        fixture.submit();
        await waitFor(() => idle(fixture));
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.field('fld_final'), final);
        assert.equal(final.value, 'Final answer');
        assert.equal(final.closest('[hidden]'), null);
        assert.equal(fixture.button('Back').disabled, false);
        assert.equal(fixture.button('Review answers').disabled, false);
        const status =
            fixture.window.document.getElementById('status')?.textContent ?? '';
        assert.match(status, /review.*unavailable/i);
        assert.doesNotMatch(status, /PRIVATE_FORMULA_ANSWER/);
        assert.equal(fixture.loads(), 1);
    });

    it('presents a final-page unhydrated link generically and saves its exact native ID without another read', async (test) => {
        const form = reviewed();
        const linkedConfig = structuredClone(portalField.config);
        assert.ok(
            linkedConfig.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
        );
        form.payload.fieldIdsToSchemas.fld_linked = {
            fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
            airtableField: {
                ...structuredClone(portalField),
                id: 'fld_linked',
                name: 'Linked answer',
                config: linkedConfig,
            },
            miniExtConfig: { readOnly: true },
        };
        form.payload.fieldIdsInForm.push('fld_linked');
        form.payload.formRecord.data.fld_linked = ['record_linked'];
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(savedForm())),
        });
        finalPage(fixture);
        const dialog = await fixture.openReview();
        const row = dialog.querySelector('[data-review-field-id="fld_linked"]');
        assert.equal(
            row?.nextElementSibling?.textContent,
            'Selected record — details unavailable'
        );
        assert.doesNotMatch(dialog.textContent ?? '', /record_linked/);
        assert.equal(fixture.loads(), 1);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1 && idle(fixture));
        assert.deepEqual(fixture.saves[0]?.formRecord.data.fld_linked, [
            'record_linked',
        ]);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'First answer'
        );
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_final,
            'Final answer'
        );
        assert.equal(fixture.loads(), 1);
    });

    it('blocks final Review for a pending native file until explicit Clear', async (test) => {
        const form = reviewed();
        form.payload.fieldIdsToSchemas.fld_files =
            loadedForm().payload.fieldIdsToSchemas.fld_files!;
        form.payload.fieldIdsInForm.push('fld_files');
        form.payload.formRecord.data.fld_files = [];
        const fixture = await mount(test, form);
        finalPage(fixture);
        const input =
            fixture.window.document.querySelector('input[type="file"]');
        assert.ok(input instanceof fixture.window.HTMLInputElement);
        let selected = [
            new fixture.window.File(['synthetic'], 'PRIVATE_PENDING.txt'),
        ];
        Object.defineProperty(input, 'files', {
            configurable: true,
            get: () => selected,
        });
        Object.defineProperty(input, 'value', {
            configurable: true,
            get: () => (selected.length ? 'PRIVATE_PENDING.txt' : ''),
            set: () => {
                selected = [];
            },
        });
        input.dispatchEvent(
            new fixture.window.Event('change', { bubbles: true })
        );
        fixture.submit();
        await settled();
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.saves.length, 0);
        fixture.button('Clear pending files').click();
        const dialog = await fixture.openReview();
        assert.doesNotMatch(dialog.textContent ?? '', /PRIVATE_PENDING/);
        fixture.button('Edit', dialog).click();
        await waitFor(() => idle(fixture));
        assert.equal(fixture.field('fld_final').closest('[hidden]'), null);
    });

    it('retires an old confirmation on input changes and cannot close or submit a successor Review', async (test) => {
        const fixture = await mount(test, reviewed());
        finalPage(fixture);
        const first = await fixture.openReview();
        const oldConfirm = fixture.button('Confirm', first);
        fixture.edit('fld_final', 'Changed during Review');
        await waitFor(() => idle(fixture));
        assert.equal(first.isConnected, false);
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_final', 'Fresh reviewed answer');
        const fresh = await fixture.openReview();
        oldConfirm.dispatchEvent(new fixture.window.Event('click'));
        await settled();
        assert.equal(fresh.isConnected, true);
        assert.match(fresh.textContent ?? '', /Fresh reviewed answer/);
        assert.equal(fixture.saves.length, 0);
        fixture.button('Edit', fresh).click();
        await waitFor(() => idle(fixture));
    });

    it('Cancel request before Confirm returns to the same final-page controls without Save', async (test) => {
        const fixture = await mount(test, reviewed());
        finalPage(fixture);
        const final = fixture.field('fld_final');
        const dialog = await fixture.openReview();
        const confirm = fixture.button('Confirm', dialog);
        fixture.button('Cancel request').click();
        await waitFor(
            () => idle(fixture) && !fixture.button('Review answers').disabled
        );
        assert.equal(dialog.isConnected, false);
        assert.equal(fixture.field('fld_final'), final);
        assert.equal(final.closest('[hidden]'), null);
        assert.equal(fixture.button('Review answers').disabled, false);
        confirm.dispatchEvent(new fixture.window.Event('click'));
        await settled();
        assert.equal(fixture.saves.length, 0);
    });

    for (const outcome of ['validation', 'unknown', 'cancelled'] as const) {
        it(`preserves draft/recovery semantics after a ${outcome} confirmed Save`, async (test) => {
            let resolve: ((response: Response) => void) | undefined;
            const fixture = await mount(test, reviewed(), {
                save: async () => {
                    if (outcome === 'validation')
                        return new Response(JSON.stringify(invalidForm()));
                    if (outcome === 'unknown')
                        throw new Error('Synthetic lost Save response');
                    return new Promise<Response>((done) => {
                        resolve = done;
                    });
                },
            });
            finalPage(fixture);
            const final = fixture.field('fld_final');
            const dialog = await fixture.openReview();
            const confirm = fixture.button('Confirm', dialog);
            confirm.click();
            await waitFor(() => fixture.saves.length === 1);
            if (outcome === 'cancelled')
                fixture.button('Cancel request').click();
            await waitFor(() => idle(fixture));
            assert.equal(fixture.field('fld_final'), final);
            assert.equal(final.value, 'Final answer');
            if (outcome === 'validation') {
                assert.equal(fixture.button('Back').disabled, false);
                assert.match(
                    fixture.window.document.querySelector('.error-list')
                        ?.textContent ?? '',
                    /invalid|error|Required|Title/i
                );
            } else {
                assert.equal(fixture.button('Review answers').disabled, true);
                assert.equal(fixture.button('Back').disabled, true);
                fixture.submit();
                confirm.dispatchEvent(new fixture.window.Event('click'));
                await settled();
                assert.equal(fixture.saves.length, 1);
            }
            if (resolve) {
                resolve(new Response(JSON.stringify(savedForm())));
                await settled();
                assert.equal(fixture.saves.length, 1);
                assert.equal(fixture.button('Review answers').disabled, true);
            }
        });
    }
});

describe('actual browser starter post-save feedback', () => {
    const sent = 'saveAndContinueUpdateLinkEmailSent';
    const failed = 'saveAndContinueUpdateLinkEmailFailed';
    const accepted = (notifications?: unknown[], warnings?: unknown[]) => ({
        ...savedForm(),
        loggedInUserRecord: null,
        context: { type: 'direct-url' },
        postSubmissionNotifications: notifications,
        postSubmissionWarnings: warnings,
    });
    const savedFeedback = async (
        test: TestContext,
        result: ReturnType<typeof accepted>,
        review = true
    ) => {
        const form = reviewForm();
        form.payload.publicFields.state.promptUserBeforeSubmission = review;
        let extraRequests = 0;
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(result)),
            read: async () => {
                extraRequests++;
                throw new Error('No post-save request is authorized.');
            },
        });
        fixture.edit('fld_title', 'Feedback request');
        const staleCard = fixture.field('fld_title').closest('form');
        assert.ok(staleCard);
        if (review) {
            const dialog = await fixture.openReview();
            assert.equal(fixture.saves.length, 0);
            fixture.button('Confirm', dialog).click();
        } else fixture.submit();
        await waitFor(
            () =>
                fixture.window.document
                    .getElementById('status')
                    ?.textContent?.startsWith('Saved record record_saved.') ===
                    true &&
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        const message =
            fixture.window.document.getElementById('status')?.textContent;
        assert.equal(fixture.window.document.querySelector('.fields'), null);
        assert.equal(fixture.saves.length, 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            ...form.payload.formRecord.data,
            fld_title: 'Feedback request',
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        staleCard.dispatchEvent(
            new fixture.window.Event('submit', {
                bubbles: true,
                cancelable: true,
            })
        );
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.loads(), 1);
        assert.equal(extraRequests, 0);
        assert.equal(
            fixture.window.document.getElementById('status')?.textContent,
            message
        );
        return { fixture, message };
    };

    for (const review of [false, true]) {
        it(`shows only accepted update-link email sent feedback ${review ? 'after Review' : 'after ordinary Save'}`, async (test) => {
            const { message } = await savedFeedback(
                test,
                accepted([{ type: sent }], []),
                review
            );
            assert.equal(
                message,
                'Saved record record_saved. An update link email was sent.'
            );
        });
        it(`keeps known Save success when the update-link email fails ${review ? 'after Review' : 'after ordinary Save'}`, async (test) => {
            const { message } = await savedFeedback(
                test,
                accepted([], [{ type: failed }]),
                review
            );
            assert.equal(
                message,
                'Saved record record_saved. The update link email could not be sent.'
            );
        });
    }
    for (const [type, text] of [
        [
            'userConfirmationEmailFailed',
            'The confirmation email could not be sent.',
        ],
        [
            'adminNotificationEmailFailed',
            'The administrator notification email could not be sent.',
        ],
        [
            'smsConfirmationFailed',
            'The confirmation text message could not be sent.',
        ],
    ]) {
        it(`presents fixed copy for accepted ${type}`, async (test) => {
            const { message } = await savedFeedback(
                test,
                accepted([], [{ type }])
            );
            assert.equal(message, `Saved record record_saved. ${text}`);
        });
    }
    for (const arrays of [false, true]) {
        it(`does not invent an email outcome for ${arrays ? 'empty' : 'absent'} result metadata`, async (test) => {
            const { message } = await savedFeedback(
                test,
                arrays ? accepted([], []) : accepted()
            );
            assert.equal(message, 'Saved record record_saved.');
        });
    }
    it('tolerates malformed metadata without exposing tags, recipients or links after known Save success', async (test) => {
        const marker = 'UNTRUSTED_POST_SAVE_METADATA';
        const { fixture, message } = await savedFeedback(
            test,
            accepted(
                [
                    null,
                    marker,
                    [],
                    { type: marker },
                    { type: sent, recipient: marker, url: marker },
                ],
                [
                    null,
                    marker,
                    [],
                    { type: marker, recipient: marker, url: marker },
                ]
            )
        );
        assert.equal(
            message,
            'Saved record record_saved. An update link email was sent. An additional post-submission warning was reported.'
        );
        assert.equal(
            fixture.window.document.body.outerHTML.includes(marker),
            false
        );
        assert.equal(
            fixture.window.document.body.outerHTML.includes(sent),
            false
        );
    });
    it('does not claim sent when accepted metadata also reports update-link email failure', async (test) => {
        const { message } = await savedFeedback(
            test,
            accepted([{ type: sent }], [{ type: failed }])
        );
        assert.equal(
            message,
            'Saved record record_saved. The update link email could not be sent.'
        );
    });
    it('does not present email metadata from a rejected Save result', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state.promptUserBeforeSubmission = false;
        const fixture = await mount(test, form, {
            save: async () =>
                new Response(
                    JSON.stringify({
                        ...invalidForm(),
                        postSubmissionNotifications: [{ type: sent }],
                        postSubmissionWarnings: [{ type: failed }],
                    })
                ),
        });
        fixture.edit('fld_title', 'Rejected feedback request');
        fixture.submit();
        await waitFor(
            () =>
                fixture.window.document
                    .querySelector('.error-list')
                    ?.textContent?.includes('A title is required.') === true
        );
        assert.equal(fixture.saves.length, 1);
        assert.equal(
            fixture.field('fld_title').value,
            'Rejected feedback request'
        );
        assert.equal(
            fixture.window.document.getElementById('status')?.textContent,
            'The Form was not saved. Review the validation errors.'
        );
    });
    it('does not infer an email outcome from an unknown Save outcome or replay it', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state.promptUserBeforeSubmission = false;
        const fixture = await mount(test, form, {
            save: async () => {
                throw new Error('Synthetic lost Save response.');
            },
        });
        fixture.submit();
        await waitFor(
            () =>
                fixture.window.document
                    .querySelector('.error-list')
                    ?.textContent?.includes('may have completed') === true
        );
        assert.doesNotMatch(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /Saved record|email/i
        );
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.button('Save').disabled, true);
    });
    for (const transition of ['cancel', 'visitor'] as const) {
        for (const outcome of ['sent', 'failed'] as const) {
            it(`ignores late ${outcome} email metadata after ${transition} retirement`, async (test) => {
                const form = reviewForm();
                form.payload.publicFields.state.promptUserBeforeSubmission = false;
                const held: { resolve?: (response: Response) => void } = {};
                const fixture = await mount(test, form, {
                    save: async () =>
                        new Promise<Response>((resolve) => {
                            held.resolve = resolve;
                        }),
                });
                fixture.submit();
                await waitFor(() => fixture.saves.length === 1);
                if (transition === 'cancel')
                    fixture.button('Cancel request').click();
                else {
                    const visitor =
                        fixture.window.document.getElementById('visitor');
                    assert.ok(
                        visitor instanceof fixture.window.HTMLSelectElement
                    );
                    for (const identity of ['B', 'A']) {
                        visitor.value = identity;
                        visitor.dispatchEvent(
                            new fixture.window.Event('change', {
                                bubbles: true,
                            })
                        );
                    }
                }
                await settled();
                const before =
                    fixture.window.document.getElementById(
                        'status'
                    )?.textContent;
                assert.ok(held.resolve);
                held.resolve(
                    new Response(
                        JSON.stringify(
                            outcome === 'sent'
                                ? accepted([{ type: sent }], [])
                                : accepted([], [{ type: failed }])
                        )
                    )
                );
                await settled();
                assert.equal(
                    fixture.window.document.getElementById('status')
                        ?.textContent,
                    before
                );
                assert.doesNotMatch(before ?? '', /Saved record|email/i);
                fixture.submit();
                await settled();
                assert.equal(fixture.saves.length, 1);
            });
        }
    }
});

describe('actual browser starter child parent refresh identity', () => {
    const marker = 'prefill_Title=ACCEPTED_PARENT_REFRESH';
    const parentPage = (initialMarker = false) => {
        const parent = portalPage({
            customViews: [
                { id: 'view_example', config: { name: 'Example view' } },
                {
                    id: 'view_refresh',
                    config: {
                        name: 'Refreshed parent view',
                        customViewConditions: {
                            logicalOperator: 'and',
                            conditions: [
                                {
                                    type: 'singleCondition',
                                    id: 'condition_parent_refresh',
                                    setting: {
                                        type: 'is',
                                        idOrName: {
                                            type: 'id',
                                            id: 'fld_prefill',
                                        },
                                        fieldType: 'singleLineText',
                                        value: marker,
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        });
        parent.payload.usersTableFields = [
            structuredClone(
                parent.payload.fieldIdsToSchemas.fld_prefill!.airtableField
            ),
        ];
        if (initialMarker) parent.payload.formRecord.data.fld_prefill = marker;
        return parent;
    };
    const success = (
        parent: { id: string; fields: Record<string, unknown> } | null
    ) => ({
        ...savedForm(),
        record: {
            id: 'record_deleted',
            fields: { fld_title: 'Saved child answer' },
        },
        tableId: 'table_children',
        loggedInUserRecord: parent,
        context: { type: 'modal', newTableIdsToLinkedTableStates: {} },
        postSubmissionWarnings: [],
        postSubmissionNotifications: [],
    });
    const open = async (
        test: TestContext,
        parent: PortalLoadedResult,
        save: (input: SaveFormInput) => Promise<Response>,
        review = false
    ) => {
        const child = deletableChild();
        child.payload.publicFields.state.promptUserBeforeSubmission = review;
        const childLoads: LoadExtensionInput[] = [];
        let reads = 0;
        const fixture = await mount(test, child, {
            initialPortal: parent,
            childLoads,
            read: async (url) => {
                assert.equal(
                    url.searchParams.get('route'),
                    'fetchRecordsForLinkedTableOnPortal'
                );
                reads++;
                return new Response(JSON.stringify(deletionRecords(child)));
            },
            save,
        });
        const { document } = fixture.window;
        const idle = () =>
            document.getElementById('screen')?.getAttribute('aria-busy') ===
            'false';
        const viewOffered = () =>
            Array.from(document.querySelectorAll('option')).some(
                (option) => option.textContent === 'Refreshed parent view'
            );
        fixture.button('Load records').click();
        await waitFor(() => reads === 1 && idle());
        const initialViewOffered = viewOffered();
        const retained = [
            'Load records',
            'Next page',
            'Create record',
            'Open Form',
        ].map((label) => fixture.button(label));
        const oldPortal = retained[0]!.closest('section');
        assert.ok(oldPortal);
        fixture.button('Open Form').click();
        await waitFor(() => childLoads.length === 1 && idle());
        const oldBack = fixture.button('Back to Portal');
        const oldForm = fixture.field('fld_title').closest('form');
        assert.ok(oldForm);
        fixture.edit('fld_title', 'Saved child answer');
        const submit = async () => {
            if (review) {
                const dialog = await fixture.openReview();
                fixture.button('Confirm', dialog).click();
            } else fixture.submit();
        };
        const saved = async () => {
            await submit();
            await waitFor(
                () =>
                    idle() &&
                    document
                        .getElementById('status')
                        ?.textContent?.startsWith(
                            'Saved record record_deleted.'
                        ) === true
            );
            assert.equal(fixture.saves.length, 1);
            assert.equal(fixture.saves[0]?.formRecord.type, 'edit');
            assert.equal(
                fixture.saves[0]?.formRecord.data.fld_title,
                'Saved child answer'
            );
            assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
                'fld_title',
            ]);
            assert.equal(fixture.saves[0]?.isComputeMode, false);
            assert.equal(reads, 1);
            assert.equal(fixture.loads(), 2);
            assert.doesNotMatch(
                document.getElementById('screen')?.textContent ?? '',
                /may have completed/
            );
        };
        return {
            fixture,
            document,
            idle,
            viewOffered,
            initialViewOffered,
            retained,
            oldPortal,
            oldBack,
            oldForm,
            childLoads,
            reads: () => reads,
            submit,
            saved,
        };
    };
    for (const review of [false, true]) {
        for (const parentId of ['record_foreign', ' record_parent ']) {
            it(`retires the cached Portal for parent ${JSON.stringify(parentId)} after ${review ? 'Review' : 'ordinary'} child Save without losing known success`, async (test) => {
                const h = await open(
                    test,
                    parentPage(),
                    async () =>
                        new Response(
                            JSON.stringify(
                                success({
                                    id: parentId,
                                    fields: { fld_prefill: marker },
                                })
                            )
                        ),
                    review
                );
                assert.equal(h.initialViewOffered, false);
                await h.saved();
                assert.equal(
                    h.viewOffered(),
                    false,
                    'Foreign parent fields must not activate an eligible view.'
                );
                assert.equal(
                    h.oldPortal.isConnected,
                    false,
                    'A mismatched parent refresh must not revive the cached Portal.'
                );
                assert.equal(h.oldForm.isConnected, false);
                assert.equal(h.oldBack.isConnected, false);
                assert.match(
                    h.document.getElementById('screen')?.textContent ?? '',
                    /parent Portal refresh did not match/
                );
                assert.match(
                    h.document.getElementById('screen')?.textContent ?? '',
                    /Choose Reload when ready/
                );
                for (const action of [...h.retained, h.oldBack])
                    action.dispatchEvent(new h.fixture.window.Event('click'));
                h.oldForm.dispatchEvent(
                    new h.fixture.window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await settled();
                assert.equal(h.reads(), 1);
                assert.equal(h.fixture.loads(), 2);
                assert.equal(h.fixture.saves.length, 1);
                h.fixture.button('Reload').click();
                await waitFor(() => h.fixture.loads() === 3 && h.idle());
                assert.equal(h.viewOffered(), false);
                h.fixture.button('Load records').click();
                await waitFor(() => h.reads() === 2 && h.idle());
                h.fixture.button('Open Form').click();
                await waitFor(() => h.childLoads.length === 2 && h.idle());
                assert.equal(h.fixture.field('fld_title').isConnected, true);
                assert.equal(h.fixture.button('Save').disabled, false);
                assert.equal(
                    h.fixture.saves.length,
                    1,
                    'Explicit reads must not replay the earlier accepted Save.'
                );
                h.fixture.edit('fld_title', 'Fresh unsaved child answer');
                const freshForm = h.fixture.field('fld_title').closest('form');
                for (const action of [...h.retained, h.oldBack])
                    action.dispatchEvent(new h.fixture.window.Event('click'));
                h.oldForm.dispatchEvent(
                    new h.fixture.window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await settled();
                assert.equal(h.reads(), 2);
                assert.equal(h.fixture.loads(), 4);
                assert.equal(h.fixture.saves.length, 1);
                assert.equal(freshForm?.isConnected, true);
                assert.equal(
                    h.fixture.field('fld_title').value,
                    'Fresh unsaved child answer'
                );
            });
        }
    }
    it('accepts a matching parent identity and applies its authoritative field replacement', async (test) => {
        const h = await open(
            test,
            parentPage(),
            async () =>
                new Response(
                    JSON.stringify(
                        success({
                            id: 'record_parent',
                            fields: { fld_prefill: marker },
                        })
                    )
                )
        );
        await h.saved();
        assert.equal(h.oldPortal.isConnected, true);
        assert.equal(h.viewOffered(), true);
        assert.doesNotMatch(
            h.document.getElementById('screen')?.textContent ?? '',
            /parent Portal refresh did not match/
        );
    });
    it('accepts a matching sparse parent as a replacement that removes prior eligibility', async (test) => {
        const h = await open(
            test,
            parentPage(true),
            async () =>
                new Response(
                    JSON.stringify(success({ id: 'record_parent', fields: {} }))
                )
        );
        assert.equal(h.initialViewOffered, true);
        await h.saved();
        assert.equal(h.oldPortal.isConnected, true);
        assert.equal(h.viewOffered(), false);
        assert.doesNotMatch(
            h.document.getElementById('screen')?.textContent ?? '',
            /parent Portal refresh did not match/
        );
    });
    it('preserves the existing null-parent Save completion', async (test) => {
        const h = await open(
            test,
            parentPage(),
            async () => new Response(JSON.stringify(success(null)))
        );
        await h.saved();
        assert.equal(h.oldPortal.isConnected, false);
        assert.match(
            h.document.getElementById('screen')?.textContent ?? '',
            /Choose Reload when ready/
        );
        assert.doesNotMatch(
            h.document.getElementById('screen')?.textContent ?? '',
            /parent Portal refresh did not match/
        );
    });
});
