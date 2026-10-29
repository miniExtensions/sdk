import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { createFormFieldBindings } from '../src/forms/index.js';
import {
    createMiniExtensionsClient,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { formSaveOptions, loadedForm } from './formsFixtures.js';
import { createOwnedCompiler } from './ownedCompiler.js';

const compiler = createOwnedCompiler();

let directory: string;
before(async () => {
    const root = resolve(process.cwd());
    directory = await mkdtemp(join(tmpdir(), 'sdk-validation-presentation-'));
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

describe('actual starter bound validation presentation', () => {
    for (const kind of ['text', 'number'] as const)
        for (const flag of [
            'public',
            'obscurePassword',
            'maskPasswordOnLoginScreen',
        ] as const) {
            it(`preserves parsed ${kind} canonical errors and native data under ${flag} presentation and retirement`, async (test) => {
                const window = new Window();
                const globals = {
                    document: window.document,
                    HTMLInputElement: window.HTMLInputElement,
                    HTMLSelectElement: window.HTMLSelectElement,
                    HTMLTextAreaElement: window.HTMLTextAreaElement,
                };
                const previous = Object.keys(globals).map(
                    (key) =>
                        [
                            key,
                            Object.getOwnPropertyDescriptor(globalThis, key),
                        ] as const
                );
                Object.assign(globalThis, globals);
                test.after(async () => {
                    for (const [key, descriptor] of previous) {
                        if (descriptor)
                            Object.defineProperty(globalThis, key, descriptor);
                        else Reflect.deleteProperty(globalThis, key);
                    }
                    await window.happyDOM.close();
                });
                const loaded = loadedForm();
                const original = loaded.payload.fieldIdsToSchemas.fld_title;
                assert.ok(original);
                const schema: RuntimeFieldSchema =
                    kind === 'number'
                        ? {
                              fieldType: 'number',
                              airtableField: {
                                  ...original.airtableField,
                                  config: {
                                      type: 'number',
                                      options: { precision: 0 },
                                  },
                              },
                          }
                        : original;
                schema.miniExtConfig =
                    flag === 'public' ? {} : { [flag]: true };
                loaded.payload.fieldIdsInForm = ['fld_title'];
                loaded.payload.fieldIdsToSchemas.fld_title = schema;
                loaded.payload.formRecord.data.fld_title =
                    kind === 'number' ? 1234 : 'Initial native value';
                loaded.payload.formFieldIdsWithUnsavedChanges = [];
                loaded.payload.urlPrefilledFieldIds = [];
                const saves: SaveFormInput[] = [];
                const client = createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.test',
                    fetch: async (_input, init) => {
                        saves.push(JSON.parse(String(init?.body)));
                        return new Response(
                            JSON.stringify({
                                type: 'error',
                                formValidationErrors: [
                                    {
                                        fieldId: 'fld_title',
                                        fieldTitle: 'SYNTHETIC_CANONICAL_TITLE',
                                        errorMessage:
                                            'SYNTHETIC_CANONICAL_MESSAGE',
                                    },
                                ],
                                formErrors: {
                                    fld_title: 'SYNTHETIC_CANONICAL_FORM_ERROR',
                                },
                            })
                        );
                    },
                });
                const owner = createFormFieldBindings({
                    client,
                    loaded,
                    saveOptions: formSaveOptions(),
                    getScope: () => ({
                        ownerId: 'validation-presentation',
                        revision: 0,
                    }),
                });
                const binding = owner.field('fld_title');
                const native = kind === 'number' ? 5678 : 'Edited native value';
                assert.equal(binding.setValue(native).accepted, true);
                await owner.save();
                assert.equal(saves.length, 1);
                const canonical = owner.controller.getState();
                const accepted = binding.getSnapshot();
                assert.equal(canonical.status, 'validation-error');
                assert.deepEqual(
                    accepted.validation,
                    canonical.validationErrors
                );
                assert.equal(
                    accepted.validation[0]?.fieldTitle,
                    'SYNTHETIC_CANONICAL_TITLE'
                );
                assert.equal(
                    accepted.validation[0]?.errorMessage,
                    'SYNTHETIC_CANONICAL_MESSAGE'
                );
                assert.equal(
                    accepted.validation[1]?.errorMessage,
                    'SYNTHETIC_CANONICAL_FORM_ERROR'
                );
                assert.equal(accepted.value, native);
                const { mountBoundFormField } = await import(
                    pathToFileURL(join(directory, 'fields.mjs')).href
                );
                const control = mountBoundFormField(binding, schema, () =>
                    assert.fail('Presentation must not edit the draft.')
                );
                test.after(() => {
                    control.destroy();
                    owner.destroy();
                });
                window.document.body.append(control.node);
                const status = control.node.querySelector('[role="status"]');
                assert.ok(status);
                if (flag === 'public') {
                    assert.equal(
                        status.textContent,
                        'SYNTHETIC_CANONICAL_MESSAGE\nSYNTHETIC_CANONICAL_FORM_ERROR'
                    );
                } else {
                    assert.equal(
                        status.textContent,
                        'This field needs attention before saving.'
                    );
                    assert.equal(
                        control.node.outerHTML.includes('SYNTHETIC_CANONICAL'),
                        false
                    );
                }
                control.write(native);
                owner.refresh();
                assert.deepEqual(
                    owner.controller.getState().validationErrors,
                    canonical.validationErrors
                );
                assert.deepEqual(
                    owner.controller.getState().result,
                    canonical.result
                );
                assert.deepEqual(
                    owner.controller.getState().draft,
                    canonical.draft
                );
                assert.deepEqual(
                    binding.getSnapshot().validation,
                    accepted.validation
                );
                assert.equal(binding.getSnapshot().value, native);
                assert.equal(saves[0]?.formRecord.data.fld_title, native);
                assert.deepEqual(saves[0]?.formFieldIdsWithUnsavedChanges, [
                    'fld_title',
                ]);
                owner.destroy();
                assert.equal(binding.getSnapshot().retired, true);
                assert.equal(status.textContent, '');
                assert.equal(control.node.hidden, true);
                assert.equal(saves.length, 1);
            });
        }
});
