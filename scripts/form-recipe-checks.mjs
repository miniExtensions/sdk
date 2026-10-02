import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

// Complete synthetic public Form metadata. No real key, record or API request.
const makeForm = () => {
    const fields = [
        ['fld_title', 'Title', 'singleLineText'],
        ['fld_number', 'Quantity', 'number'],
        ['fld_flag', 'Approved', 'checkbox'],
    ].map(([id, name, type]) => ({
        fieldType: type,
        airtableField: {
            id,
            name,
            config:
                type === 'number'
                    ? { type, options: { precision: 2 } }
                    : { type },
        },
    }));
    return {
        extensionScreen: 'form_loaded',
        extensionId: 'extension_example',
        language: 'en',
        themeColor: 'blue',
        enableCommentsOnChildForms: false,
        workspaceId: 'workspace_example',
        extensionOwnerUID: 'owner_example',
        faviconUrl: null,
        googleAnalyticsMeasurementId: null,
        isStarterExtension: false,
        payload: {
            extensionType: 'form',
            extensionAccessToken: 'access_example',
            extensionName: 'Example Form',
            hasParentExtension: false,
            formRecord: {
                type: 'create',
                data: {
                    fld_title: 'Initial title',
                    fld_number: 2,
                    fld_flag: false,
                },
            },
            formErrors: {},
            publicFields: {},
            fieldIdsInForm: fields.map((field) => field.airtableField.id),
            fieldNamesToSchemas: Object.fromEntries(
                fields.map((field) => [field.airtableField.name, field])
            ),
            fieldIdsToSchemas: Object.fromEntries(
                fields.map((field) => [field.airtableField.id, field])
            ),
            formFieldIdsWithUnsavedChanges: [],
            urlPrefilledFieldIds: [],
            linkedRecordFieldIdToDetailFields: {},
            cookieKeyForLoginToken: null,
            baseId: 'base_example',
            loggedInUserCanEditExtension: false,
            showMiniExtensionsBranding: true,
            onFreePlan: true,
            trialExpiresAtUnixEpoch: null,
        },
    };
};

function makeClient() {
    let session = {};
    const saves = [];
    return {
        saves,
        getSession: () => ({ ...session }),
        setSession: (next) => {
            session = { ...next };
        },
        loadExtension: async (_input, { signal }) => {
            signal.throwIfAborted();
            return makeForm();
        },
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
    };
}

const mountOptions = (client, nodes, overrides = {}) => ({
    client,
    input: {
        shareId: 'share_example',
        recordId: null,
        context: { type: 'direct-url' },
    },
    saveOptions: {
        captchaVal: null,
        isComputeMode: false,
        searchQuery: {},
        context: { type: 'direct-url' },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
    },
    getScope: () => ({ ownerId: 'visitor_example', revision: 0 }),
    signal: new AbortController().signal,
    fieldIds: {
        title: 'fld_title',
        quantity: 'fld_number',
        approved: 'fld_flag',
    },
    ...nodes,
    ...overrides,
});

const makeNodes = (document) => {
    const inputs = Object.fromEntries(
        ['title', 'quantity', 'approved'].map((key) => [
            key,
            document.createElement('input'),
        ])
    );
    const inlineErrors = Object.fromEntries(
        ['title', 'quantity', 'approved'].map((key) => [
            key,
            document.createElement('span'),
        ])
    );
    const saveButton = document.createElement('button');
    const message = document.createElement('p');
    document.body.append(
        ...Object.values(inputs),
        ...Object.values(inlineErrors),
        saveButton,
        message
    );
    return { inputs, inlineErrors, saveButton, message };
};

/** Execute the actual shipped Form fence beside its installed exact archive. */
export async function checkFormRecipe({
    consumerDirectory,
    guideSources,
    happyDomModulePath,
}) {
    const consumerRoot = realpathSync(consumerDirectory);
    const consumerRequire = createRequire(join(consumerRoot, 'package.json'));
    const installedRoot = realpathSync(
        join(consumerRoot, 'node_modules/@miniextensions/sdk')
    );
    assert(
        realpathSync(
            consumerRequire.resolve('@miniextensions/sdk/forms')
        ).startsWith(`${installedRoot}/dist/`),
        'Form recipe must use the installed archive, never repository sources'
    );
    assert(
        !existsSync(join(consumerRoot, 'node_modules/happy-dom')),
        'Happy DOM must remain a root test dependency'
    );
    const matches = guideSources
        .map((source) => resolve(consumerRoot, source))
        .filter((source) => {
            assert.equal(dirname(source), consumerRoot);
            return readFileSync(source, 'utf8').includes(
                'export async function attachStandaloneFormEditor('
            );
        });
    assert.equal(
        matches.length,
        1,
        'Missing unique shipped Form editor recipe'
    );
    const source = matches[0];
    const { code } = await transform(readFileSync(source, 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
        sourcefile: relative(consumerRoot, source),
    });
    // No bundling/aliases: these imports resolve from the clean consumer.
    const compiled = `${source}.form-recipe.mjs`;
    writeFileSync(
        compiled,
        `${code}\nexport const recipeFormsUrl = import.meta.resolve('@miniextensions/sdk/forms');\n`
    );
    const { attachStandaloneFormEditor: mount, recipeFormsUrl } = await import(
        pathToFileURL(compiled).href
    );
    assert(
        realpathSync(fileURLToPath(recipeFormsUrl)).startsWith(
            `${installedRoot}/dist/esm/`
        ),
        'Executed Form recipe must resolve installed ESM dist'
    );
    const { Window } = await import(pathToFileURL(happyDomModulePath).href);
    const failures = [];
    const check = async (name, exercise) => {
        const window = new Window({ url: 'https://example.com/' });
        const handles = [];
        try {
            await exercise({
                window,
                nodes: makeNodes(window.document),
                handles,
            });
        } catch (error) {
            failures.push(new Error(name, { cause: error }));
        } finally {
            for (const handle of handles) handle.destroy();
            await window.happyDOM.close();
        }
    };

    await check(
        'Replacement owns events and survives repeated old cleanup',
        async ({ window, nodes, handles }) => {
            const client = makeClient();
            const oldAbort = new AbortController();
            const old = await mount(
                mountOptions(client, nodes, { signal: oldAbort.signal })
            );
            handles.push(old);
            const replacement = await mount(mountOptions(client, nodes));
            handles.push(replacement);
            nodes.inputs.title.value = 'Replacement title';
            nodes.inputs.title.dispatchEvent(new window.Event('input'));
            nodes.inputs.quantity.value = '1.5';
            nodes.inputs.quantity.dispatchEvent(new window.Event('input'));
            nodes.inputs.approved.checked = true;
            nodes.inputs.approved.dispatchEvent(new window.Event('change'));
            assert.deepEqual(
                old.controller.getState().draft.data,
                makeForm().payload.formRecord.data,
                'Old listeners must ignore replacement inputs'
            );
            assert.deepEqual(replacement.controller.getState().draft.data, {
                fld_title: 'Replacement title',
                fld_number: 1.5,
                fld_flag: true,
            });
            nodes.saveButton.click();
            await new Promise(setImmediate);
            assert.equal(
                client.saves.length,
                1,
                'Only replacement Save handler may dispatch'
            );
            nodes.inlineErrors.title.textContent = 'Replacement feedback';
            nodes.message.textContent = 'Replacement status';
            old.destroy();
            old.destroy();
            oldAbort.abort();
            assert.equal(nodes.inputs.title.value, 'Replacement title');
            assert.equal(nodes.inputs.quantity.value, '1.5');
            assert.equal(nodes.inputs.approved.checked, true);
            assert.equal(nodes.inputs.title.disabled, false);
            assert.equal(
                nodes.inlineErrors.title.textContent,
                'Replacement feedback'
            );
            assert.equal(nodes.message.textContent, 'Replacement status');
            assert.equal(nodes.saveButton.disabled, false);
        }
    );

    await check(
        'Invalid numeric input blocks Save without null or old-value submission',
        async ({ window, nodes, handles }) => {
            const client = makeClient();
            const handle = await mount(mountOptions(client, nodes));
            handles.push(handle);
            const quantity = nodes.inputs.quantity;
            assert.equal(
                quantity.step,
                'any',
                'Generic number must not impose an integer-only default'
            );
            quantity.value = '1.5';
            quantity.dispatchEvent(new window.Event('input'));
            assert.equal(quantity.checkValidity(), true);
            assert.equal(
                handle.controller.getState().draft.data.fld_number,
                1.5
            );
            // Happy DOM sanitizes bad numeric text without browser badInput. Supply
            // that native-invalid contract explicitly; it is not browser evidence.
            const checkValidity = quantity.checkValidity;
            const reportValidity = quantity.reportValidity;
            Object.defineProperty(quantity, 'validity', {
                configurable: true,
                value: { badInput: true, valid: false },
            });
            quantity.checkValidity = () => false;
            quantity.reportValidity = () => false;
            quantity.value = '';
            quantity.dispatchEvent(new window.Event('input'));
            assert.equal(
                handle.controller.getState().draft.data.fld_number,
                1.5,
                'badInput must not become null'
            );
            nodes.inputs.title.value = 'Another field edited';
            nodes.inputs.title.dispatchEvent(new window.Event('input'));
            nodes.inputs.approved.checked = true;
            nodes.inputs.approved.dispatchEvent(new window.Event('change'));
            assert.equal(
                quantity.value,
                '',
                'Other field emissions must not overwrite invalid numeric input'
            );
            assert.equal(
                handle.controller.getState().draft.data.fld_number,
                1.5,
                'Other field edits preserve the last valid draft without clearing badInput'
            );
            nodes.saveButton.click();
            assert.equal(
                client.saves.length,
                0,
                'badInput must not save the last valid value'
            );
            delete quantity.validity;
            quantity.checkValidity = checkValidity;
            quantity.reportValidity = reportValidity;
            quantity.min = '2';
            quantity.value = '1.5';
            quantity.dispatchEvent(new window.Event('input'));
            nodes.saveButton.click();
            assert.equal(
                client.saves.length,
                0,
                'Native min validation must block Save'
            );
            quantity.removeAttribute('min');
            nodes.saveButton.click();
            await new Promise(setImmediate);
            assert.equal(client.saves.length, 1);
            assert.equal(client.saves[0].formRecord.data.fld_number, 1.5);
            const configured = makeNodes(window.document);
            configured.inputs.quantity.step = '0.25';
            handles.push(await mount(mountOptions(client, configured)));
            assert.equal(
                configured.inputs.quantity.step,
                '0.25',
                'Explicit app step must remain intact'
            );
        }
    );

    await check(
        'Captured load cannot bind another visitor session or claim its nodes',
        async ({ nodes }) => {
            const client = makeClient();
            let complete;
            client.loadExtension = () =>
                new Promise((resolveLoad) => {
                    complete = resolveLoad;
                });
            nodes.inputs.title.value = 'Unclaimed view';
            const pending = mount(mountOptions(client, nodes));
            client.setSession({ visitor_example: 'replacement_example' });
            complete(makeForm());
            await assert.rejects(pending, /Scope changed during load/);
            assert.equal(nodes.inputs.title.value, 'Unclaimed view');
            assert.equal(client.saves.length, 0);
        }
    );

    await check(
        'Synchronous setup cancellation rejects instead of returning a disposed editor',
        async ({ nodes }) => {
            const client = makeClient();
            const early = new AbortController();
            let scopeReads = 0;
            nodes.inputs.title.value = 'Unclaimed view';
            await assert.rejects(
                mount(
                    mountOptions(client, nodes, {
                        signal: early.signal,
                        getScope: () => {
                            if (++scopeReads === 3) early.abort();
                            return { ownerId: 'visitor_example', revision: 0 };
                        },
                    })
                ),
                (error) => error.name === 'AbortError'
            );
            assert.equal(nodes.inputs.title.value, 'Unclaimed view');
            const late = new AbortController();
            await assert.rejects(
                mount(
                    mountOptions(client, nodes, {
                        signal: late.signal,
                        getScope: () => {
                            if (nodes.inputs.quantity.type === 'number')
                                late.abort();
                            return { ownerId: 'visitor_example', revision: 0 };
                        },
                    })
                ),
                (error) => error.name === 'AbortError'
            );
            assert.equal(nodes.inputs.title.value, '');
            assert.equal(nodes.saveButton.disabled, true);
            nodes.saveButton.click();
            assert.equal(client.saves.length, 0);
        }
    );

    if (failures.length)
        throw new AggregateError(failures, 'Shipped Form recipe checks failed');
    return { checks: 4 };
}
