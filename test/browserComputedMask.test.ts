import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import {
    createFormFieldBindings,
    type FormFieldBinding,
} from '../src/forms/index.js';
import {
    createMiniExtensionsClient,
    type AirtableValue,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { formSaveOptions, loadedForm } from './formsFixtures.js';
import { createOwnedCompiler } from './ownedCompiler.js';

const compiler = createOwnedCompiler();

let directory: string;
before(async () => {
    const root = resolve(process.cwd());
    directory = await mkdtemp(join(tmpdir(), 'sdk-computed-mask-'));
    await compiler.build({
        entryPoints: [join(root, 'examples/browser/src/fields.ts')],
        alias: {
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'fields.mjs'),
        logLevel: 'silent',
    });
});
after(async () => {
    if (!compiler.canCleanup())
        throw new Error('Compiler did not close; output directory retained.');
    await rm(directory, { recursive: true, force: true });
});

const schema = (
    kind: 'formula' | 'rollup',
    numeric: boolean,
    policy: RuntimeFieldSchema['miniExtConfig'],
    id = 'fld_computed'
): RuntimeFieldSchema => {
    const field = {
        id,
        name: 'Synthetic computed',
        description: null,
        isPrimaryField: false,
        isComputed: true,
    };
    const options = {
        isValid: true as const,
        result: numeric
            ? { type: 'number' as const, options: { precision: 2 } }
            : { type: 'singleLineText' as const, options: null },
    };
    return kind === 'formula'
        ? {
              fieldType: 'formula',
              airtableField: { ...field, config: { type: 'formula', options } },
              miniExtConfig: policy,
          }
        : {
              fieldType: 'rollup',
              airtableField: { ...field, config: { type: 'rollup', options } },
              miniExtConfig: policy,
          };
};

async function environment(test: TestContext) {
    const window = new Window();
    const globals = {
        document: window.document,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, value] of previous) {
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    });
    const fields = await import(
        pathToFileURL(join(directory, 'fields.mjs')).href
    );
    return { window, ...fields };
}

describe('starter readonly computed masking', () => {
    for (const kind of ['formula', 'rollup'] as const)
        for (const numeric of [false, true])
            for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
                it(`masks ${kind} ${numeric ? 'number' : 'text'} under ${flag} before DOM assignment`, async (test) => {
                    const { window, formFieldControl } =
                        await environment(test);
                    let changes = 0;
                    const initial = numeric
                        ? 98765
                        : 'SYNTHETIC_PRIVATE_INITIAL';
                    const next = numeric
                        ? 54321
                        : 'SYNTHETIC_PRIVATE_REPLACEMENT';
                    const control = formFieldControl(
                        schema(kind, numeric, { [flag]: true }),
                        initial,
                        () => changes++
                    );
                    test.after(() => control.destroy());
                    window.document.body.append(control.node);
                    const input = control.node.querySelector('textarea');
                    assert.ok(input);
                    const check = (native: AirtableValue) => {
                        assert.equal(input.value, '••••••••');
                        assert.equal(input.textContent, '');
                        assert.equal(
                            control.node.outerHTML.includes(String(native)),
                            false
                        );
                        assert.equal(control.read(), native);
                        assert.equal(input.readOnly, true);
                        assert.equal(input.disabled, true);
                        assert.equal(control.editable, false);
                    };
                    check(initial);
                    control.write(next);
                    check(next);
                    input.dispatchEvent(new window.Event('input'));
                    input.dispatchEvent(new window.Event('change'));
                    assert.equal(changes, 0);
                    control.destroy();
                    assert.equal(input.value, '');
                    control.write(initial);
                    input.dispatchEvent(new window.Event('change'));
                    assert.equal(input.value, '');
                    assert.equal(control.read(), next);
                    assert.equal(changes, 0);
                });

    it('masks blanks, arrays and error objects without formatting; preserves unmasked values', async (test) => {
        const { formFieldControl } = await environment(test);
        let conversions = 0;
        const error = {
            error: 'SYNTHETIC_ERROR',
            toJSON() {
                conversions++;
                throw new Error('Masked values must not be formatted.');
            },
        };
        for (const value of [null, '', ' \t ', 0, ['SYNTHETIC_LINK'], error]) {
            const control = formFieldControl(
                schema('formula', false, { obscurePassword: true }),
                value,
                () => assert.fail('Readonly presentation cannot edit.')
            );
            assert.equal(
                control.node.querySelector('textarea')?.value,
                '••••••••'
            );
            assert.equal(control.read(), value);
            control.write(value);
            assert.equal(
                control.node.querySelector('textarea')?.value,
                '••••••••'
            );
            control.destroy();
        }
        assert.equal(conversions, 0);
        for (const value of [null, '', ' \t ', 0, 12.5, 'Public value']) {
            const control = formFieldControl(
                schema('rollup', false, {
                    obscurePassword: false,
                    maskPasswordOnLoginScreen: false,
                }),
                value,
                () => {}
            );
            assert.equal(
                control.node.querySelector('textarea')?.value,
                value == null ? '' : String(value)
            );
            assert.equal(control.read(), value);
            control.destroy();
        }
    });

    it('refreshes current masking without a draft revision and preserves native Save data', async (test) => {
        const { window, mountBoundFormField } = await environment(test);
        const loaded = loadedForm();
        const computed = schema('formula', false, {});
        loaded.payload.fieldIdsInForm = ['fld_title', 'fld_computed'];
        loaded.payload.fieldIdsToSchemas.fld_computed = computed;
        loaded.payload.formRecord.data.fld_computed =
            'SYNTHETIC_PRIVATE_NATIVE';
        loaded.payload.formFieldIdsWithUnsavedChanges = [];
        loaded.payload.urlPrefilledFieldIds = [];
        const saves: SaveFormInput[] = [];
        const owner = createFormFieldBindings({
            client: createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async (_input, init) => {
                    saves.push(JSON.parse(String(init?.body)));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                },
            }),
            loaded,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'computed-mask', revision: 0 }),
        });
        const binding = owner.field('fld_computed');
        assert.equal(binding.scalar, null);
        assert.equal(binding.date, null);
        // The owner clones its initial payload. Model a caller's accepted
        // metadata notifications without mutating that private owner snapshot.
        let acceptedSchema = computed;
        let visible = true;
        const presentationBinding: FormFieldBinding = {
            ...binding,
            getSnapshot() {
                const state = binding.getSnapshot();
                if (state.field) state.field.schema = acceptedSchema;
                if (!visible)
                    state.visibility = { type: 'hidden', diagnostics: [] };
                return state;
            },
            subscribe(listener) {
                return binding.subscribe(() =>
                    listener(presentationBinding.getSnapshot())
                );
            },
        };
        const control = mountBoundFormField(presentationBinding, computed, () =>
            assert.fail('Readonly presentation cannot edit.')
        );
        test.after(() => {
            control.destroy();
            owner.destroy();
        });
        window.document.body.append(control.node);
        const input = control.node.querySelector('textarea');
        assert.ok(input);
        const revision = binding.getSnapshot().revision;
        assert.equal(input.value, 'SYNTHETIC_PRIVATE_NATIVE');
        computed.miniExtConfig = { maskPasswordOnLoginScreen: true };
        owner.refresh();
        assert.equal(binding.getSnapshot().revision, revision);
        assert.equal(input.value, '••••••••');
        computed.miniExtConfig.maskPasswordOnLoginScreen = false;
        owner.refresh();
        assert.equal(input.value, 'SYNTHETIC_PRIVATE_NATIVE');
        visible = false;
        owner.refresh();
        assert.equal(binding.getSnapshot().revision, revision);
        assert.equal(input.value, '');
        assert.equal(control.node.hidden, true);
        control.write('SYNTHETIC_PRIVATE_NATIVE');
        assert.equal(input.value, '');
        visible = true;
        owner.refresh();
        assert.equal(input.value, 'SYNTHETIC_PRIVATE_NATIVE');
        acceptedSchema = schema('formula', false, { obscurePassword: true });
        owner.refresh();
        assert.equal(binding.getSnapshot().revision, revision);
        assert.equal(input.value, '••••••••');
        control.write('SYNTHETIC_PRIVATE_NATIVE');
        assert.equal(input.value, '••••••••');
        assert.equal(binding.setValue('Forbidden edit').accepted, false);
        assert.equal(
            owner.field('fld_title').setValue('Edited neighbor').accepted,
            true
        );
        await owner.save();
        assert.equal(saves.length, 1);
        assert.equal(
            saves[0]?.formRecord.data.fld_computed,
            'SYNTHETIC_PRIVATE_NATIVE'
        );
        assert.equal(saves[0]?.formRecord.data.fld_title, 'Edited neighbor');
        assert.deepEqual(saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        owner.destroy();
        assert.equal(binding.getSnapshot().retired, true);
        assert.equal(input.value, '');
        assert.equal(control.node.hidden, true);
        control.write('SYNTHETIC_RETIRED_REPLACEMENT');
        assert.equal(input.value, '');
        assert.equal(
            loaded.payload.formRecord.data.fld_computed,
            'SYNTHETIC_PRIVATE_NATIVE'
        );
        assert.equal(saves.length, 1);
    });

    for (const newRevision of [false, true])
        it(`never formats the old masked value when a replacement is unmasked with ${newRevision ? 'a new' : 'the same'} revision`, async (test) => {
            const { mountBoundFormField } = await environment(test);
            const loaded = loadedForm();
            const computed = schema('formula', false, {
                obscurePassword: true,
            });
            loaded.payload.fieldIdsInForm = ['fld_title', 'fld_computed'];
            loaded.payload.fieldIdsToSchemas.fld_computed = computed;
            loaded.payload.formRecord.data.fld_computed =
                'Native retained answer';
            const owner = createFormFieldBindings({
                client: createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.test',
                    fetch: async () =>
                        assert.fail('Presentation must perform no request.'),
                }),
                loaded,
                saveOptions: formSaveOptions(),
                getScope: () => ({ ownerId: 'computed-order', revision: 0 }),
            });
            const binding = owner.field('fld_computed');
            let conversions = 0;
            const oldValue = {
                error: 'SYNTHETIC_OLD_MASKED',
                toJSON() {
                    conversions++;
                    throw new Error('Old masked answer formatted.');
                },
            };
            let value: AirtableValue = oldValue;
            let currentSchema = computed;
            let revision = binding.getSnapshot().revision!;
            const current = () => {
                const state = binding.getSnapshot();
                if (state.field) state.field.schema = currentSchema;
                state.value = value;
                state.revision = revision;
                return state;
            };
            let notify = () => {};
            const wrappedBinding: FormFieldBinding = {
                ...binding,
                getSnapshot: current,
                subscribe(listener) {
                    notify = () => listener(current());
                    return () => {
                        notify = () => {};
                    };
                },
            };
            const control = mountBoundFormField(wrappedBinding, computed, () =>
                assert.fail('Readonly presentation cannot edit.')
            );
            test.after(() => {
                control.destroy();
                owner.destroy();
            });
            assert.equal(
                control.node.querySelector('textarea')?.value,
                '••••••••'
            );
            value = 'Public replacement';
            currentSchema = schema('formula', false, {});
            if (newRevision) revision++;
            notify();
            assert.equal(conversions, 0);
            assert.equal(
                control.node.querySelector('textarea')?.value,
                'Public replacement'
            );
            assert.equal(control.read(), 'Public replacement');
        });
});
