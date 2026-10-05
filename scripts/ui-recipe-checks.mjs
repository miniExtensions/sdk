import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

// Full public Form envelope, using only synthetic field/token identifiers.
// No client here can authenticate, save, or contact a server.
const makeForm = () => {
    const fields = [
        ['fld_single', 'Single', 'singleSelect'],
        ['fld_multiple', 'Multiple', 'multipleSelects'],
        ['fld_linked', 'Linked', 'multipleRecordLinks'],
    ].map(([id, name, type]) => ({
        fieldType: type,
        airtableField: {
            id,
            name,
            config: {
                type,
                options:
                    type === 'multipleRecordLinks'
                        ? {
                              linkedTableId: 'tbl_example',
                              isReversed: false,
                              prefersSingleRecordLink: false,
                          }
                        : {
                              choices: [
                                  { id: 'sel_first', name: 'First' },
                                  { id: 'sel_second', name: 'Second' },
                              ],
                          },
            },
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
        publishedVersionId: 'version_example',
        payload: {
            extensionType: 'form',
            extensionAccessToken: 'access_example',
            extensionName: 'Example form',
            hasParentExtension: false,
            formRecord: {
                type: 'create',
                data: {
                    fld_single: 'First',
                    fld_multiple: ['First'],
                    fld_linked: [],
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

const loadInput = {
    shareId: 'share_example',
    recordId: null,
    context: { type: 'direct-url' },
    query: {},
    clientTimeZone: 'UTC',
    deviceFingerprint: { version: 1, visitorId: 'visitor_example' },
};
const emptyPage = () => ({
    records: [],
    offset: null,
    tableIdsToLinkedTableStates: {},
});
const deferred = () => {
    let resolvePromise;
    const promise = new Promise((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
};
const observe = (promise) =>
    promise.then(
        (value) => ({ value }),
        (error) => ({ error })
    );

function makeClient(form, listOptions = async () => emptyPage()) {
    let session = {};
    return {
        getSession: () => ({ ...session }),
        setSession: (next) => {
            session = { ...next };
        },
        loadExtension: async (_input, { signal }) => {
            signal.throwIfAborted();
            return structuredClone(form);
        },
        linkedRecords: {
            listFormOptions: listOptions,
            loadSelectedRecords: async () => {
                throw new Error(
                    'An empty selected value must not hydrate records.'
                );
            },
        },
    };
}

function trackAbort() {
    const controller = new AbortController();
    const listeners = new Set();
    const { signal } = controller;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (type, listener, options) => {
        if (type === 'abort') listeners.add(listener);
        add(type, listener, options);
    };
    signal.removeEventListener = (type, listener, options) => {
        if (type === 'abort') listeners.delete(listener);
        remove(type, listener, options);
    };
    return { controller, signal, listeners };
}

/** Run actual shipped, typechecked fences against the installed exact archive. */
export async function checkUiRecipes({
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
            consumerRequire.resolve('@miniextensions/sdk/ui')
        ).startsWith(`${installedRoot}/dist/`),
        'UI recipes must use the consumer archive, never repository sources'
    );
    assert(
        !existsSync(join(consumerRoot, 'node_modules/happy-dom')),
        'Happy DOM must remain a test-only root dependency'
    );
    const recipes = {};
    for (const name of ['mountFormSelects', 'mountFormLinkedField']) {
        const matches = guideSources
            .map((source) => resolve(consumerRoot, source))
            .filter((source) => {
                assert.equal(dirname(source), consumerRoot);
                return readFileSync(source, 'utf8').includes(
                    `export async function ${name}(`
                );
            });
        assert.equal(
            matches.length,
            1,
            `Missing unique shipped ${name} recipe`
        );
        const source = matches[0];
        const { code } = await transform(readFileSync(source, 'utf8'), {
            loader: 'ts',
            format: 'esm',
            target: 'es2022',
            sourcefile: relative(consumerRoot, source),
        });
        const compiled = `${source}.mjs`;
        writeFileSync(compiled, code);
        recipes[name] = (await import(pathToFileURL(compiled).href))[name];
    }
    const { Window } = await import(pathToFileURL(happyDomModulePath).href);
    const failures = [];
    const check = async (name, exercise) => {
        const window = new Window({ url: 'https://example.com/' });
        const previousDocument = Object.getOwnPropertyDescriptor(
            globalThis,
            'document'
        );
        globalThis.document = window.document;
        const host = window.document.createElement('div');
        window.document.body.append(host);
        try {
            await exercise({ window, host });
        } catch (error) {
            failures.push(new Error(name, { cause: error }));
        } finally {
            if (previousDocument) {
                Object.defineProperty(globalThis, 'document', previousDocument);
            } else {
                delete globalThis.document;
            }
            await window.happyDOM.close();
        }
    };
    const mountLinked = (client, host, signal) =>
        recipes.mountFormLinkedField(
            client,
            makeForm(),
            'fld_linked',
            host,
            signal,
            {}
        );
    const replacement = (host) => {
        const next = host.ownerDocument.createElement('p');
        next.textContent = 'Replacement view';
        host.replaceChildren(next);
        return next;
    };

    await check(
        'Pending linked mount abort rejects without returning a handle',
        async ({ host }) => {
            const started = deferred();
            let requestSignal;
            const client = makeClient(makeForm(), (_input, { signal }) => {
                requestSignal = signal;
                started.resolve();
                return new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        { once: true }
                    );
                });
            });
            const tracked = trackAbort();
            const outcome = observe(mountLinked(client, host, tracked.signal));
            await started.promise;
            tracked.controller.abort();
            const result = await outcome;
            assert.equal(requestSignal.aborted, true);
            assert.equal(
                result.error?.name,
                'AbortError',
                'Cancelled helper must reject'
            );
            assert.equal(
                Object.hasOwn(result, 'value'),
                false,
                'No destroyed handle may escape'
            );
            assert.equal(host.childElementCount, 0);
            assert.equal(
                tracked.listeners.size,
                0,
                'Abort listener must be released'
            );
        }
    );
    await check(
        'Abort during pending linked reload preserves the replacement',
        async ({ host }) => {
            const started = deferred();
            const client = makeClient(makeForm(), (_input, { signal }) => {
                started.resolve();
                return new Promise((_resolve, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => reject(new DOMException('Aborted', 'AbortError')),
                        { once: true }
                    );
                });
            });
            const tracked = trackAbort();
            const outcome = observe(mountLinked(client, host, tracked.signal));
            await started.promise;
            const next = replacement(host);
            tracked.controller.abort();
            const result = await outcome;
            assert(
                host.firstChild === next,
                'Abort may remove only its own mounted node'
            );
            assert.equal(result.error?.name, 'AbortError');
            assert.equal(tracked.listeners.size, 0);
        }
    );
    await check(
        'Repeated successful linked destroy preserves the replacement',
        async ({ host }) => {
            const tracked = trackAbort();
            const handle = await mountLinked(
                makeClient(makeForm()),
                host,
                tracked.signal
            );
            const next = replacement(host);
            handle.destroy();
            handle.destroy();
            tracked.controller.abort();
            assert(
                host.firstChild === next,
                'Old destroy may remove only its own mounted node'
            );
            assert.equal(
                tracked.listeners.size,
                0,
                'Successful destroy must remove its abort listener'
            );
            handle.model.choose(['rec_example']);
            assert.deepEqual(handle.getDraftValue(), []);
        }
    );
    await check(
        'Abort after successful linked mount preserves the replacement',
        async ({ host }) => {
            const tracked = trackAbort();
            const handle = await mountLinked(
                makeClient(makeForm()),
                host,
                tracked.signal
            );
            const next = replacement(host);
            tracked.controller.abort();
            handle.destroy();
            assert(
                host.firstChild === next,
                'Old abort may remove only its own mounted node'
            );
            assert.equal(tracked.listeners.size, 0);
        }
    );
    await check(
        'Changed visitor during linked reload rejects and cleans up',
        async ({ host }) => {
            const started = deferred();
            const page = deferred();
            const client = makeClient(makeForm(), () => {
                started.resolve();
                return page.promise;
            });
            const tracked = trackAbort();
            const outcome = observe(mountLinked(client, host, tracked.signal));
            await started.promise;
            client.setSession({ visitor_example: 'replacement_example' });
            page.resolve(emptyPage());
            const result = await outcome;
            assert.match(result.error?.message ?? '', /visitor changed/i);
            assert.equal(Object.hasOwn(result, 'value'), false);
            assert.equal(host.childElementCount, 0);
            assert.equal(tracked.listeners.size, 0);
        }
    );
    await check(
        'Repeated native select destroy preserves replacement and removes handlers',
        async ({ window, host }) => {
            const controller = new AbortController();
            const handle = await recipes.mountFormSelects(
                makeClient(makeForm()),
                loadInput,
                host,
                { single: 'fld_single', multiple: 'fld_multiple' },
                controller.signal
            );
            const selects = [...host.querySelectorAll('select')];
            assert.equal(selects.length, 2);
            const next = replacement(host);
            handle.destroy();
            handle.destroy();
            controller.abort();
            assert(
                host.firstChild === next,
                'Native helper may remove only its own controls'
            );
            selects[0].value = 'Second';
            selects[0].dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
            assert.equal(handle.getDraft().data.fld_single, 'First');
            assert.deepEqual(handle.getChangedFieldIds(), []);
        }
    );
    await check(
        'Installed native policy retains names and caps hidden choose/toggle options',
        async ({ window, host }) => {
            const { createSelectControl, getSelectFieldPolicy } =
                consumerRequire('@miniextensions/sdk/ui');
            const form = makeForm();
            const field = form.payload.fieldIdsToSchemas.fld_multiple;
            field.airtableField.config.options.choices.push({
                id: 'sel_third',
                name: 'Third',
            });
            field.miniExtConfig = {
                allowAddingNewOptions: true,
                singleOrMultiSelectLimitSelectionOptions: [
                    'sel_first',
                    'sel_second',
                    'sel_third',
                ],
                maxNumberOfSelections: 2,
            };
            assert.equal(
                getSelectFieldPolicy(field).allowAddingNewOptions,
                false
            );
            const changes = [];
            const control = createSelectControl({
                field,
                value: ['First', 'Second'],
                onChange: (value) => changes.push(value),
            });
            host.append(control.element);
            await control.model.setSearchTerm('no-match');
            assert.deepEqual(control.model.getState().options, []);
            control.model.choose(['First', 'Second', 'Third']);
            control.model.toggle('Third');
            assert.deepEqual(control.model.getState().value, [
                'First',
                'Second',
            ]);
            assert.deepEqual(changes, []);
            control.model.setOptions([
                { value: 'Third', label: 'Third' },
                { value: 'Forbidden', label: 'Forbidden' },
            ]);
            control.model.toggle('First');
            control.model.toggle('Third');
            assert.deepEqual(changes, [['Second'], ['Second', 'Third']]);
            control.model.reset({ value: ['Legacy', 'First', 'Second'] });
            assert.deepEqual(control.model.getState().value, [
                'Legacy',
                'First',
                'Second',
            ]);
            control.model.toggle('Third');
            assert.equal(changes.length, 2);
            const select = host.querySelector('select');
            control.destroy();
            select.dispatchEvent(new window.Event('change', { bubbles: true }));
            control.model.choose(['First']);
            assert.equal(changes.length, 2);
        }
    );
    if (failures.length) {
        throw new AggregateError(
            failures,
            'Shipped UI recipe lifecycle checks failed'
        );
    }
    return { checks: 7 };
}
