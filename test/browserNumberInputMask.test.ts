import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { createOwnedCompiler } from './ownedCompiler.js';

const compiler = createOwnedCompiler();

const root = resolve(process.cwd());
let directory: string;
let revision = 0;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-number-input-mask-'));
    const alias = {
        '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
        '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
        '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
        '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
        '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
        '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
    };
    for (const entry of ['main', 'fields'])
        await compiler.build({
            entryPoints: [join(root, `examples/browser/src/${entry}.ts`)],
            alias,
            bundle: true,
            platform: 'node',
            format: 'esm',
            outfile: join(directory, `${entry}.mjs`),
            logLevel: 'silent',
        });
    await compiler.build({
        stdin: {
            contents:
                "export {createFormFieldBindings} from './src/forms/index.ts'; export {createMiniExtensionsClient} from './src/runtime/index.ts';",
            resolveDir: root,
        },
        alias,
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'owner.mjs'),
        logLevel: 'silent',
    });
});
after(async () => {
    if (!compiler.canCleanup())
        throw new Error('Compiler did not close; output directory retained.');
    await rm(directory, { recursive: true, force: true });
});
const example = (name: string) =>
    import(
        `${pathToFileURL(join(directory, `${name}.mjs`)).href}?case=${++revision}`
    );
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise<void>((done) => setImmediate(done));
    }
    assert.fail('The actual Number starter did not reach the expected state.');
};
const environment = (test: TestContext, fetch?: typeof globalThis.fetch) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        ...(fetch === undefined ? {} : { fetch }),
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous)
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        await window.happyDOM.close();
    });
    return window;
};
type Mask = 'obscurePassword' | 'maskPasswordOnLoginScreen' | 'none';
const numberForm = (
    mask: Mask,
    readOnly = false,
    native: AirtableValue = 1234
) => {
    const form = loadedForm();
    const previous = form.payload.fieldIdsToSchemas.fld_title;
    assert.ok(previous);
    // The observed synthetic Number payload includes obscurePassword even though
    // its generated Number config union does not declare that property.
    const schema = {
        fieldType: AirtableFieldType.NUMBER,
        airtableField: {
            ...previous.airtableField,
            config: {
                type: AirtableFieldType.NUMBER,
                options: { precision: 0 },
            },
        },
        miniExtConfig: {
            obscurePassword: mask === 'obscurePassword',
            maskPasswordOnLoginScreen: mask === 'maskPasswordOnLoginScreen',
            readOnly,
        },
    } as unknown as RuntimeFieldSchema;
    form.payload.fieldIdsInForm = ['fld_title'];
    form.payload.fieldIdsToSchemas = { fld_title: schema };
    form.payload.fieldNamesToSchemas = { Title: schema };
    form.payload.publicFields.state.tableId = 'table_number_synthetic';
    form.payload.formRecord = {
        type: 'edit',
        recordId: 'record_number_synthetic',
        tableId: 'table_number_synthetic',
        data: { fld_title: native },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return { form, schema };
};
const inputIn = (window: Window, node = window.document) => {
    const input = node.querySelector('[data-field-id="fld_title"]');
    assert.ok(input instanceof window.HTMLInputElement);
    return input;
};
const edit = (
    window: Window,
    input: InstanceType<Window['HTMLInputElement']>,
    value: string
) => {
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const mountMain = async (test: TestContext, form: FormLoadedResult) => {
    const saves: SaveFormInput[] = [];
    const window = environment(test, async (resource, init) => {
        const url = new URL(String(resource));
        assert.equal(url.origin, 'https://sdk.example.test');
        const route = url.searchParams.get('route');
        if (route === 'fetchExtensionForEndUser')
            return new Response(JSON.stringify(form));
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
        throw new Error('Unexpected synthetic Number request.');
    });
    window.document.write(
        (
            await readFile(join(root, 'examples/browser/index.html'), 'utf8')
        ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    await example('main');
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    const connection = window.document.getElementById('connection-form');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    assert.ok(connection);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_number_synthetic';
    connection.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
    await waitFor(
        () =>
            window.document.querySelector('[data-field-id="fld_title"]') !==
                null &&
            window.document
                .getElementById('screen')
                ?.getAttribute('aria-busy') === 'false'
    );
    return { window, saves, input: inputIn(window) };
};
const mountFallback = async (
    test: TestContext,
    mask: Mask,
    readOnly = false,
    extraMask: Record<string, unknown> = {}
) => {
    const window = environment(test);
    const { schema } = numberForm(mask);
    schema.miniExtConfig = {
        ...schema.miniExtConfig,
        ...extraMask,
    } as RuntimeFieldSchema['miniExtConfig'];
    const { fieldControl } = await example('fields');
    let changes = 0;
    const control = fieldControl(
        schema.airtableField,
        schema.miniExtConfig,
        1234,
        () => changes++,
        readOnly
    );
    test.after(() => control.destroy());
    window.document.body.append(control.node);
    return {
        window,
        schema,
        control,
        input: inputIn(window),
        changes: () => changes,
    };
};

const mountBinding = async (
    test: TestContext,
    mask: Mask,
    readOnly = false,
    native: AirtableValue = 1234,
    extraMask: Record<string, unknown> = {}
) => {
    const window = environment(test);
    const { form, schema } = numberForm(mask, readOnly, native);
    schema.miniExtConfig = {
        ...schema.miniExtConfig,
        ...extraMask,
    } as RuntimeFieldSchema['miniExtConfig'];
    const { createFormFieldBindings, createMiniExtensionsClient } =
        await example('owner');
    const { mountBoundFormField } = await example('fields');
    const saves: SaveFormInput[] = [];
    let finishSave: (() => void) | undefined;
    let heldSave = false;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw new Error('No implicit Number transport');
        },
    });
    client.forms.save = async (input: SaveFormInput) => {
        saves.push(input);
        if (heldSave)
            await new Promise<void>((done) => {
                finishSave = done;
            });
        return { type: 'error', formValidationErrors: [], formErrors: {} };
    };
    let scope = { ownerId: 'number_synthetic', revision: 0 };
    let fieldLease = true;
    const owner = createFormFieldBindings({
        client,
        loaded: form,
        saveOptions: formSaveOptions(),
        getScope: () => scope,
        canWriteField: () => fieldLease,
    });
    const owned = owner.field('fld_title');
    // A caller-owned binding can supply a newer accepted presentation schema
    // while retaining its scalar model. The control must not use mount-time policy.
    let presentation = schema;
    const binding = {
        ...owned,
        getSnapshot() {
            const state = owned.getSnapshot();
            if (state.field) state.field.schema = presentation;
            return state;
        },
        subscribe(listener: () => void) {
            return owned.subscribe(listener);
        },
    };
    let changes = 0;
    const control = mountBoundFormField(binding, schema, () => changes++);
    window.document.body.append(control.node);
    test.after(() => {
        control.destroy();
        owner.destroy();
    });
    return {
        window,
        owner,
        binding,
        control,
        saves,
        input: inputIn(window),
        changes: () => changes,
        setPolicy(mask: Mask) {
            presentation = numberForm(mask, readOnly, native).schema;
            control.write(native);
        },
        setMaskFlag(
            flag: 'obscurePassword' | 'maskPasswordOnLoginScreen',
            value: unknown
        ) {
            presentation = {
                ...presentation,
                miniExtConfig: { ...presentation.miniExtConfig, [flag]: value },
            } as RuntimeFieldSchema;
            control.write(native);
        },
        setFieldLease(allowed: boolean) {
            fieldLease = allowed;
            owner.refresh();
        },
        retire() {
            scope = { ...scope, revision: scope.revision + 1 };
            control.write(native);
        },
        holdSave() {
            heldSave = true;
        },
        finishSave() {
            assert.ok(finishSave);
            finishSave();
        },
    };
};

describe(
    'actual browser starter Number input masking',
    { concurrency: false },
    () => {
        // Equivalent to Abdennour's f356c118 eight failures/four controls. All data
        // and Save responses are synthetic; this does not claim persistence proof.
        for (const mask of [
            'obscurePassword',
            'maskPasswordOnLoginScreen',
            'none',
        ] as const)
            for (const path of ['bound', 'fallback'] as const)
                for (const readOnly of [false, true])
                    it(`${mask} ${path} ${readOnly ? 'readonly' : 'editable'} preserves native Number behavior`, async (test) => {
                        if (path === 'bound') {
                            const h = await mountMain(
                                test,
                                numberForm(mask, readOnly).form
                            );
                            assert.equal(
                                h.input.type,
                                mask === 'none' ? 'text' : 'password'
                            );
                            assert.equal(h.input.value, '1234');
                            assert.equal(h.input.disabled, readOnly);
                            if (readOnly) {
                                h.input.dispatchEvent(
                                    new h.window.Event('input', {
                                        bubbles: true,
                                    })
                                );
                                assert.equal(h.input.value, '1234');
                                assert.equal(h.saves.length, 0);
                                return;
                            }
                            edit(h.window, h.input, '5678');
                            const card = h.input.closest('form');
                            assert.ok(card);
                            card.dispatchEvent(
                                new h.window.Event('submit', {
                                    bubbles: true,
                                    cancelable: true,
                                })
                            );
                            await waitFor(
                                () =>
                                    h.saves.length === 1 &&
                                    h.window.document
                                        .getElementById('screen')
                                        ?.getAttribute('aria-busy') === 'false'
                            );
                            assert.equal(
                                h.saves[0].formRecord.data.fld_title,
                                5678
                            );
                            assert.deepEqual(
                                h.saves[0].formFieldIdsWithUnsavedChanges,
                                ['fld_title']
                            );
                            assert.equal(h.saves.length, 1);
                        } else {
                            const h = await mountFallback(test, mask, readOnly);
                            assert.equal(
                                h.input.type,
                                mask === 'none' ? 'number' : 'password'
                            );
                            assert.equal(h.input.disabled, readOnly);
                            assert.equal(h.control.editable, !readOnly);
                            assert.equal(h.control.read(), 1234);
                            if (!readOnly) {
                                edit(h.window, h.input, '5678');
                                assert.equal(h.control.read(), 5678);
                                assert.equal(h.changes(), 1);
                            }
                            h.control.write(2468);
                            assert.equal(h.control.read(), 2468);
                            if (readOnly) assert.equal(h.changes(), 0);
                        }
                    });
    }
);

describe(
    'Number masking stays isolated from other numeric starter controls',
    { concurrency: false },
    () => {
        const otherNumericFields = [
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '' },
            },
            {
                type: AirtableFieldType.PERCENT,
                options: { precision: 2 },
            },
            {
                type: AirtableFieldType.DURATION,
                options: { durationFormat: 'h:mm:ss' },
            },
            {
                type: AirtableFieldType.RATING,
                options: { max: 5, icon: 'star', color: 'yellowBright' },
            },
        ];
        const numericForm = (physical: (typeof otherNumericFields)[number]) => {
            const { form, schema: numberSchema } = numberForm('none', false, 3);
            const schema = {
                ...numberSchema,
                fieldType: physical.type,
                airtableField: {
                    ...numberSchema.airtableField,
                    config: physical,
                },
                miniExtConfig: {
                    obscurePassword: true,
                    maskPasswordOnLoginScreen: true,
                },
            } as unknown as RuntimeFieldSchema;
            form.payload.fieldIdsToSchemas = { fld_title: schema };
            form.payload.fieldNamesToSchemas = { Title: schema };
            return { form, schema };
        };

        for (const physical of otherNumericFields) {
            it(`keeps fallback ${physical.type} ordinary with both Number mask flags`, async (test) => {
                const window = environment(test);
                const { schema } = numericForm(physical);
                const { fieldControl } = await example('fields');
                let changes = 0;
                const control = fieldControl(
                    schema.airtableField,
                    schema.miniExtConfig,
                    3,
                    () => changes++
                );
                test.after(() => control.destroy());
                window.document.body.append(control.node);
                const input = inputIn(window);
                assert.equal(input.type, 'number');
                assert.equal(input.inputMode, '');
                assert.equal(input.value, '3');
                assert.equal(control.read(), 3);
                edit(window, input, '4');
                assert.equal(control.read(), 4);
                assert.equal(changes, 1);
                control.write(0);
                assert.equal(input.type, 'number');
                assert.equal(control.read(), 0);
                control.write(null);
                assert.equal(control.read(), null);
            });

            if (physical.type === AirtableFieldType.DURATION) continue;
            it(`keeps bound ${physical.type} ordinary with both Number mask flags`, async (test) => {
                const window = environment(test);
                const { form, schema } = numericForm(physical);
                const { createFormFieldBindings, createMiniExtensionsClient } =
                    await example('owner');
                const { mountBoundFormField } = await example('fields');
                let requests = 0;
                const client = createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.test',
                    fetch: async () => {
                        requests++;
                        throw new Error('No implicit non-Number transport');
                    },
                });
                const owner = createFormFieldBindings({
                    client,
                    loaded: form,
                    saveOptions: formSaveOptions(),
                    getScope: () => ({
                        ownerId: 'numeric_isolation_synthetic',
                        revision: 0,
                    }),
                });
                const binding = owner.field('fld_title');
                let changes = 0;
                const control = mountBoundFormField(
                    binding,
                    schema,
                    () => changes++
                );
                test.after(() => {
                    control.destroy();
                    owner.destroy();
                });
                window.document.body.append(control.node);
                const input = inputIn(window);
                assert.equal(binding.getSnapshot().scalar?.kind, 'number');
                assert.equal(binding.getSnapshot().canEdit, true);
                assert.equal(input.type, 'text');
                assert.equal(input.inputMode, 'decimal');
                assert.equal(input.value, '3');
                edit(window, input, '4');
                assert.equal(binding.getSnapshot().value, 4);
                assert.equal(control.read(), 4);
                assert.equal(changes, 1);
                binding.setValue(0);
                assert.equal(input.value, '0');
                assert.equal(input.type, 'text');
                assert.equal(requests, 0);
            });
        }
    }
);

describe(
    'masked Number native values, policies and owner admission',
    { concurrency: false },
    () => {
        for (const mask of [
            'obscurePassword',
            'maskPasswordOnLoginScreen',
        ] as const) {
            it(`${mask} keeps bound zero/null and native numeric Save types`, async (test) => {
                const h = await mountMain(
                    test,
                    numberForm(mask, false, 0).form
                );
                assert.equal(h.input.type, 'password');
                assert.equal(h.input.value, '0');
                edit(h.window, h.input, '5678');
                edit(h.window, h.input, '0');
                const form = h.input.closest('form');
                assert.ok(form);
                form.dispatchEvent(
                    new h.window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await waitFor(
                    () =>
                        h.saves.length === 1 &&
                        h.window.document
                            .getElementById('screen')
                            ?.getAttribute('aria-busy') === 'false'
                );
                assert.equal(h.saves[0].formRecord.data.fld_title, 0);
                edit(h.window, h.input, '');
                form.dispatchEvent(
                    new h.window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await waitFor(
                    () =>
                        h.saves.length === 2 &&
                        h.window.document
                            .getElementById('screen')
                            ?.getAttribute('aria-busy') === 'false'
                );
                assert.equal(h.saves[1].formRecord.data.fld_title, null);
                assert.deepEqual(h.saves[1].formFieldIdsWithUnsavedChanges, [
                    'fld_title',
                ]);
            });

            it(`${mask} fallback keeps finite decimal/exponent numbers and refuses invalid drafts`, async (test) => {
                const h = await mountFallback(test, mask);
                for (const [draft, native] of [
                    ['0', 0],
                    ['-0', -0],
                    ['-.5', -0.5],
                    ['1.25', 1.25],
                    ['-12.5e+2', -1250],
                    ['1E-3', 0.001],
                ] as const) {
                    edit(h.window, h.input, draft);
                    assert.equal(h.control.read(), native);
                }
                for (const draft of [
                    ' ',
                    '\t',
                    '0x10',
                    'Infinity',
                    'NaN',
                    '+1',
                    '1.',
                    '1e',
                    '-',
                    '.',
                    '12junk',
                    '1e9999',
                ]) {
                    edit(h.window, h.input, draft);
                    assert.throws(
                        () => h.control.read(),
                        /must be a (valid )?number/
                    );
                    assert.equal(
                        h.input.value,
                        draft,
                        'Invalid password drafts must not be silently discarded.'
                    );
                }
                h.control.write(0);
                assert.equal(h.input.value, '0');
                assert.equal(h.control.read(), 0);
                h.control.write(null);
                assert.equal(h.input.value, '');
                assert.equal(h.control.read(), null);
                edit(h.window, h.input, '5678');
                assert.equal(h.control.read(), 5678);
            });
        }

        it('bound invalid drafts retain native data, block Save and recover without coercion', async (test) => {
            const h = await mountBinding(test, 'obscurePassword');
            for (const draft of [' ', '0x10', 'Infinity', '1e', '12junk']) {
                edit(h.window, h.input, draft);
                assert.equal(h.input.type, 'password');
                assert.equal(h.input.value, draft);
                assert.equal(h.input.getAttribute('aria-invalid'), 'true');
                assert.equal(h.binding.getSnapshot().value, 1234);
                assert.throws(() => h.control.read(), /valid value/);
                assert.equal(h.saves.length, 0);
            }
            edit(h.window, h.input, '0');
            assert.equal(h.control.read(), 0);
            assert.equal(h.input.getAttribute('aria-invalid'), 'false');
            edit(h.window, h.input, '');
            assert.equal(h.control.read(), null);
            assert.equal(h.binding.getSnapshot().dirty, true);
        });

        it('actual starter refuses an invalid masked draft before Save and then saves its numeric recovery', async (test) => {
            const h = await mountMain(
                test,
                numberForm('maskPasswordOnLoginScreen').form
            );
            const form = h.input.closest('form');
            assert.ok(form);
            edit(h.window, h.input, '1e');
            form.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            for (let turn = 0; turn < 5; turn++)
                await new Promise<void>((done) => setImmediate(done));
            assert.equal(h.saves.length, 0);
            assert.equal(h.input.value, '1e');
            assert.equal(h.input.getAttribute('aria-invalid'), 'true');
            edit(h.window, h.input, '5678');
            form.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(
                () =>
                    h.saves.length === 1 &&
                    h.window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.equal(h.saves[0].formRecord.data.fld_title, 5678);
            assert.deepEqual(h.saves[0].formFieldIdsWithUnsavedChanges, [
                'fld_title',
            ]);
        });

        it('bound current policy transitions preserve native data and an invalid scalar draft', async (test) => {
            const h = await mountBinding(test, 'none');
            edit(h.window, h.input, '1e');
            for (const mask of [
                'obscurePassword',
                'maskPasswordOnLoginScreen',
                'none',
            ] as const) {
                h.setPolicy(mask);
                assert.equal(
                    h.input.type,
                    mask === 'none' ? 'text' : 'password'
                );
                assert.equal(h.input.value, '1e');
                assert.equal(h.binding.getSnapshot().value, 1234);
                assert.equal(h.binding.getSnapshot().dirty, false);
            }
            edit(h.window, h.input, '5678');
            h.setPolicy('obscurePassword');
            assert.equal(h.control.read(), 5678);
            assert.equal(h.input.value, '5678');
            assert.equal(h.changes(), 1);
        });

        it('fallback current mask policy refreshes on reads/writes without sanitizing denied drafts', async (test) => {
            const h = await mountFallback(test, 'none');
            const config = h.schema.miniExtConfig as unknown as Record<
                string,
                unknown
            >;
            config.obscurePassword = true;
            assert.equal(h.control.read(), 1234);
            assert.equal(h.input.type, 'password');
            edit(h.window, h.input, '1e');
            config.obscurePassword = false;
            assert.throws(() => h.control.read(), /must be a number/);
            assert.equal(h.input.value, '1e');
            h.control.write(0);
            assert.equal(h.input.type, 'number');
            assert.equal(h.control.read(), 0);
            config.maskPasswordOnLoginScreen = true;
            h.control.write(null);
            assert.equal(h.input.type, 'password');
            assert.equal(h.control.read(), null);
            config.maskPasswordOnLoginScreen = false;
            h.control.write(2468);
            assert.equal(h.input.type, 'number');
            assert.equal(h.control.read(), 2468);
        });

        for (const reason of [
            'readonly',
            'hidden',
            'pending',
            'retired',
            'destroyed',
        ] as const)
            it(`bound masking preserves ${reason} write admission`, async (test) => {
                const h = await mountBinding(
                    test,
                    'maskPasswordOnLoginScreen',
                    reason === 'readonly'
                );
                let pending: Promise<unknown> | undefined;
                if (reason === 'hidden') h.setFieldLease(false);
                if (reason === 'pending') {
                    edit(h.window, h.input, '2468');
                    h.holdSave();
                    pending = h.owner.save();
                    await waitFor(() => h.binding.getSnapshot().pending);
                }
                if (reason === 'retired') h.retire();
                if (reason === 'destroyed') h.control.destroy();
                const before = h.binding.getSnapshot();
                const changes = h.changes();
                edit(h.window, h.input, '5678');
                assert.equal(h.changes(), changes);
                assert.equal(h.binding.getSnapshot().value, before.value);
                if (reason === 'hidden')
                    assert.equal(h.control.node.hidden, true);
                if (reason === 'retired')
                    assert.equal(h.binding.getSnapshot().retired, true);
                if (reason !== 'destroyed')
                    assert.equal(h.input.disabled, true);
                if (reason === 'pending') {
                    assert.equal(h.saves.length, 1);
                    assert.equal(h.saves[0].formRecord.data.fld_title, 2468);
                    h.finishSave();
                    await pending;
                } else assert.equal(h.saves.length, 0);
            });

        it('fallback destroy prevents notifications and programmatic writes', async (test) => {
            const h = await mountFallback(test, 'obscurePassword');
            h.control.destroy();
            h.control.destroy();
            edit(h.window, h.input, '5678');
            h.control.write(2468);
            assert.equal(h.input.value, '5678');
            assert.equal(h.changes(), 0);
        });
        it('a superseded bound control cannot change the accepted replacement draft', async (test) => {
            const h = await mountBinding(test, 'obscurePassword');
            edit(h.window, h.input, '2468');
            const next = numberForm('maskPasswordOnLoginScreen').form;
            assert.equal(
                await h.owner.reload({ dirty: 'keep', read: async () => next }),
                true
            );
            assert.equal(h.binding.getSnapshot().retired, true);
            const replacement = h.owner.field('fld_title');
            const { mountBoundFormField } = await example('fields');
            let changes = 0;
            const control = mountBoundFormField(
                replacement,
                next.payload.fieldIdsToSchemas.fld_title,
                () => changes++
            );
            test.after(() => control.destroy());
            h.window.document.body.append(control.node);
            const input = control.node.querySelector('input');
            assert.ok(input instanceof h.window.HTMLInputElement);
            assert.equal(input.type, 'password');
            assert.equal(input.value, '2468');
            const oldChanges = h.changes();
            edit(h.window, h.input, '5678');
            assert.equal(h.changes(), oldChanges);
            assert.equal(replacement.getSnapshot().value, 2468);
            edit(h.window, input, '0');
            assert.equal(replacement.getSnapshot().value, 0);
            assert.equal(changes, 1);
            assert.equal(h.saves.length, 0);
        });
        for (const flag of [
            'obscurePassword',
            'maskPasswordOnLoginScreen',
        ] as const)
            for (const value of ['true', null])
                for (const path of ['bound', 'fallback'] as const)
                    it(`${flag}=${JSON.stringify(value)} ${path} conceals an admitted malformed mask without changing native data`, async (test) => {
                        const h =
                            path === 'bound'
                                ? await mountBinding(
                                      test,
                                      'none',
                                      false,
                                      1234,
                                      { [flag]: value }
                                  )
                                : await mountFallback(test, 'none', false, {
                                      [flag]: value,
                                  });
                        assert.equal(h.input.type, 'password');
                        assert.equal(h.input.value, '1234');
                        assert.equal(h.control.read(), 1234);
                        assert.equal(h.input.disabled, false);
                        edit(h.window, h.input, '5678');
                        assert.equal(h.control.read(), 5678);
                    });

        it('bound unknown mask policy transitions conceal values while false and undefined retain ordinary numeric input', async (test) => {
            const h = await mountBinding(test, 'none');
            edit(h.window, h.input, '1e');
            for (const flag of [
                'obscurePassword',
                'maskPasswordOnLoginScreen',
            ] as const) {
                for (const value of ['false', 0, {}, [], null]) {
                    h.setMaskFlag(flag, value);
                    assert.equal(h.input.type, 'password');
                    assert.equal(h.input.value, '1e');
                    assert.equal(h.binding.getSnapshot().value, 1234);
                }
                for (const value of [false, undefined]) {
                    h.setMaskFlag(flag, value);
                    assert.equal(h.input.type, 'text');
                    assert.equal(h.input.value, '1e');
                    assert.equal(h.binding.getSnapshot().value, 1234);
                }
            }
            assert.equal(h.changes(), 0);
            assert.equal(h.saves.length, 0);
        });

        it('fallback unknown mask transitions conceal finite native values without broadening read or readonly behavior', async (test) => {
            const h = await mountFallback(test, 'none', true);
            const config = h.schema.miniExtConfig as unknown as Record<
                string,
                unknown
            >;
            for (const flag of [
                'obscurePassword',
                'maskPasswordOnLoginScreen',
            ] as const) {
                for (const value of ['false', 0, {}, [], null]) {
                    config[flag] = value;
                    assert.equal(h.control.read(), 1234);
                    assert.equal(h.input.type, 'password');
                    assert.equal(h.input.disabled, true);
                }
                for (const value of [false, undefined]) {
                    config[flag] = value;
                    assert.equal(h.control.read(), 1234);
                    assert.equal(h.input.type, 'number');
                    assert.equal(h.input.disabled, true);
                }
            }
            assert.equal(h.changes(), 0);
        });
    }
);
