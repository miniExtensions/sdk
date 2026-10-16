import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import type { FormLoadedResult, SaveFormInput } from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';

const root = resolve(process.cwd());
const progressPrefix = 'miniExtensions-sdk:create-progress:v1:';
const ownerPrefix = 'sdk-create-progress-owner:v1:';
const rememberedTitle = 'Synthetic remembered answer';
const omittedAnswer = 'Synthetic unselected answer';
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-create-progress-browser-'));
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

const nextTurn = () => new Promise<void>((done) => setImmediate(done));
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 120; turn++) {
        if (predicate()) return;
        await nextTurn();
    }
    assert.fail(
        'The actual starter did not finish its create-progress action.'
    );
};

// Cooperative exclusive locks are the only simulated browser capability. The
// actual starter and SDK still own admission, revisions, storage and transport.
const exclusiveLocks = () => {
    const tails = new Map<string, Promise<void>>();
    let gate: Promise<void> | undefined;
    let waiting = 0;
    return {
        request<Result>(name: string, callback: () => Result): Promise<Result> {
            const held = gate;
            waiting++;
            const pending = (tails.get(name) ?? Promise.resolve()).then(
                async () => {
                    if (held) await held;
                    waiting--;
                    return callback();
                }
            );
            tails.set(
                name,
                pending.then(
                    () => {},
                    () => {}
                )
            );
            return pending;
        },
        hold() {
            assert.equal(gate, undefined);
            let release!: () => void;
            gate = new Promise<void>((done) => {
                release = done;
            });
            return () => {
                gate = undefined;
                release();
            };
        },
        get waiting() {
            return waiting;
        },
        async settle() {
            for (let turn = 0; turn < 3; turn++) {
                await Promise.all([...tails.values()]);
                await nextTurn();
            }
        },
    };
};

const progressForm = (): FormLoadedResult => {
    const form = loadedForm();
    const title = form.payload.fieldIdsToSchemas.fld_title!;
    assert.ok(title.fieldType === 'singleLineText');
    title.miniExtConfig = { title: 'Request title' };
    for (const [id, name, masked] of [
        ['fld_unselected', 'Unselected', false],
        ['fld_secret', 'Synthetic password', true],
    ] as const) {
        form.payload.fieldIdsToSchemas[id] = {
            ...structuredClone(title),
            airtableField: {
                ...structuredClone(title.airtableField),
                id,
                name,
            },
            miniExtConfig: masked ? { obscurePassword: true } : {},
        };
    }
    form.payload.fieldIdsInForm = [
        'fld_title',
        'fld_unselected',
        'fld_secret',
        'fld_readonly',
        'fld_files',
        'fld_computed',
    ];
    form.payload.fieldNamesToSchemas = Object.fromEntries(
        Object.values(form.payload.fieldIdsToSchemas).map((schema) => [
            schema.airtableField.name,
            schema,
        ])
    );
    form.payload.publicFields.state.saveFormProgress = true;
    form.payload.publicFields.state.tableId = 'table_progress_synthetic';
    form.publishedVersionId = 'version_progress_synthetic';
    form.payload.formRecord = {
        type: 'create',
        data: {
            ...form.payload.formRecord.data,
            fld_title: 'Initial title',
            fld_unselected: 'Initial unselected answer',
            fld_secret: 'Synthetic excluded password',
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};

const button = (window: Window, title: string) => {
    const matches = Array.from(
        window.document.querySelectorAll('button')
    ).filter((node) => node.textContent?.trim() === title);
    assert.equal(matches.length, 1, `Expected one ${title} button.`);
    return matches[0]!;
};
const checkbox = (window: Window, title: string) => {
    const labels = Array.from(window.document.querySelectorAll('label')).filter(
        (node) => node.textContent?.trim() === title
    );
    assert.equal(labels.length, 1, `Expected one ${title} label.`);
    const input = labels[0]!.querySelector('input[type=checkbox]');
    assert.ok(input instanceof window.HTMLInputElement);
    return input;
};
const selectCheckbox = (window: Window, title: string) => {
    const input = checkbox(window, title);
    assert.equal(
        input.checked,
        false,
        `${title} must require an explicit choice.`
    );
    input.checked = true;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
};
const fieldInput = (window: Window, fieldId = 'fld_title') => {
    const input = window.document.querySelector(`[data-field-id="${fieldId}"]`);
    assert.ok(input instanceof window.HTMLInputElement);
    return input;
};
const edit = (window: Window, fieldId: string, value: string) => {
    const input = fieldInput(window, fieldId);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const storageKeys = (window: Window) =>
    Array.from(
        { length: window.sessionStorage.length },
        (_, index) => window.sessionStorage.key(index)!
    );
const progressEntries = (window: Window) =>
    storageKeys(window)
        .filter((key) => key.startsWith(progressPrefix))
        .map((key) => ({ key, bytes: window.sessionStorage.getItem(key)! }));
const storedValues = (window: Window) =>
    progressEntries(window).map(
        ({ bytes }) => JSON.parse(bytes).values as Record<string, unknown>
    );
const idle = (window: Window) =>
    window.document.getElementById('screen')?.getAttribute('aria-busy') ===
    'false';

const fixture = async (test: TestContext, form = progressForm()) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    const locks = exclusiveLocks();
    Object.defineProperty(window.navigator, 'locks', {
        configurable: true,
        value: locks,
    });
    Object.defineProperty(window.crypto, 'randomUUID', {
        configurable: true,
        value: randomUUID,
    });
    const reads: Record<string, unknown>[] = [];
    const saves: SaveFormInput[] = [];
    const progressAtSave: ReturnType<typeof progressEntries>[] = [];
    const unexpected: string[] = [];
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        fetch: (async (resource, init) => {
            const url = new URL(String(resource));
            assert.equal(url.origin, 'https://sdk.example.test');
            const route = url.searchParams.get('route');
            const input = JSON.parse(String(init?.body)) as Record<
                string,
                unknown
            >;
            if (route === 'fetchExtensionForEndUser') {
                reads.push(structuredClone(input));
                const accepted = structuredClone(form);
                const context = input.context as {
                    localStorageRecord?: Record<string, string>;
                };
                if (context.localStorageRecord !== undefined) {
                    accepted.payload.formRecord.data = {
                        ...accepted.payload.formRecord.data,
                        ...context.localStorageRecord,
                    };
                    accepted.payload.formFieldIdsWithUnsavedChanges =
                        Object.keys(context.localStorageRecord);
                }
                return new Response(JSON.stringify(accepted));
            }
            if (route === 'saveForm') {
                progressAtSave.push(progressEntries(window));
                saves.push(structuredClone(input) as unknown as SaveFormInput);
                return new Response(
                    JSON.stringify({
                        type: 'saved',
                        record: {
                            id: 'record_progress_synthetic',
                            fields:
                                input.formRecord &&
                                (
                                    input.formRecord as SaveFormInput['formRecord']
                                ).data,
                        },
                        tableId: form.payload.publicFields.state.tableId,
                        loggedInUserRecord: null,
                        context: { type: 'direct-url' },
                    })
                );
            }
            unexpected.push(route ?? url.pathname);
            throw new Error('Unexpected create-progress transport.');
        }) as typeof globalThis.fetch,
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    test.after(async () => {
        for (const [key, descriptor] of previous)
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        await window.happyDOM.close();
        assert.deepEqual(unexpected, []);
    });
    window.document.write(
        (
            await readFile(join(root, 'examples/browser/index.html'), 'utf8')
        ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
    );
    const connect = async () => {
        for (const [id, value] of [
            ['api-origin', 'https://sdk.example.test'],
            ['share-id', 'share_progress_synthetic'],
        ]) {
            const input = window.document.getElementById(id!);
            assert.ok(input instanceof window.HTMLInputElement);
            input.value = value!;
        }
        const count = reads.length;
        button(window, 'Connect and load').click();
        await waitFor(() => reads.length === count + 1 && idle(window));
        fieldInput(window);
    };
    await connect();
    const chooseTitle = async () => {
        selectCheckbox(window, 'Remember selected answers in this tab');
        selectCheckbox(window, 'Remember Title');
        await locks.settle();
    };
    const rememberTitle = async () => {
        await chooseTitle();
        edit(window, 'fld_title', rememberedTitle);
        await locks.settle();
        assert.deepEqual(storedValues(window), [
            { fld_title: rememberedTitle },
        ]);
    };
    return {
        window,
        locks,
        reads,
        saves,
        progressAtSave,
        connect,
        chooseTitle,
        rememberTitle,
    };
};

describe(
    'actual starter explicit create Form progress',
    { concurrency: false },
    () => {
        it('does not persist answers without both explicit form and field opt-in', async (test) => {
            const h = await fixture(test);
            assert.equal(
                checkbox(h.window, 'Remember selected answers in this tab')
                    .checked,
                false
            );
            assert.equal(checkbox(h.window, 'Remember Title').checked, false);
            edit(h.window, 'fld_title', rememberedTitle);
            await h.locks.settle();
            assert.deepEqual(progressEntries(h.window), []);
            selectCheckbox(h.window, 'Remember selected answers in this tab');
            edit(h.window, 'fld_title', 'Still not selected');
            await h.locks.settle();
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(h.saves.length, 0);
        });

        it('persists only the selected Title and offers no masked, readonly, attachment or computed choices', async (test) => {
            const h = await fixture(test);
            for (const title of [
                'Synthetic password',
                'Read only',
                'Files',
                'Computed',
            ])
                assert.equal(
                    Array.from(
                        h.window.document.querySelectorAll('label')
                    ).some(
                        (label) =>
                            label.textContent?.trim() === `Remember ${title}`
                    ),
                    false
                );
            assert.equal(
                checkbox(h.window, 'Remember Unselected').checked,
                false
            );
            await h.rememberTitle();
            edit(h.window, 'fld_unselected', omittedAnswer);
            edit(h.window, 'fld_secret', 'Synthetic excluded edited password');
            await h.locks.settle();
            assert.deepEqual(storedValues(h.window), [
                { fld_title: rememberedTitle },
            ]);
            const bytes = progressEntries(h.window)[0]!.bytes;
            for (const excluded of [
                omittedAnswer,
                'password',
                'prefill.txt',
                'Locked value',
                'Server formula value',
            ])
                assert.equal(bytes.includes(excluded), false);
            assert.equal(h.window.localStorage.length, 0);
            assert.equal(h.saves.length, 0);
        });

        for (const action of ['Reload', 'reconnect'] as const)
            it(`${action} restores selected answers only after an explicit fresh load, without Save`, async (test) => {
                const h = await fixture(test);
                await h.rememberTitle();
                const previousReads = h.reads.length;
                if (action === 'reconnect') await h.connect();
                else {
                    button(h.window, 'Reload').click();
                    await waitFor(
                        () =>
                            h.reads.length === previousReads + 1 &&
                            idle(h.window)
                    );
                }
                assert.equal(fieldInput(h.window).value, 'Initial title');
                assert.equal(
                    h.reads.some(
                        (read) =>
                            (read.context as Record<string, unknown>)
                                .localStorageRecord !== undefined
                    ),
                    false
                );
                await h.chooseTitle();
                const beforeRestore = h.reads.length;
                button(h.window, 'Restore remembered answers').click();
                await waitFor(
                    () => h.reads.length === beforeRestore + 1 && idle(h.window)
                );
                assert.deepEqual(
                    (h.reads.at(-1)!.context as Record<string, unknown>)
                        .localStorageRecord,
                    { fld_title: rememberedTitle }
                );
                assert.equal(fieldInput(h.window).value, rememberedTitle);
                assert.equal(
                    fieldInput(h.window, 'fld_unselected').value,
                    'Initial unselected answer'
                );
                assert.equal(h.saves.length, 0);
            });

        it('Restore retains an unselected current edit and refuses to replace the live Form', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const stored = progressEntries(h.window);
            const beforeReload = h.reads.length;
            button(h.window, 'Reload').click();
            await waitFor(
                () => h.reads.length === beforeReload + 1 && idle(h.window)
            );
            assert.equal(fieldInput(h.window).value, 'Initial title');
            await h.chooseTitle();
            const currentAnswer =
                'Synthetic unselected current edit before Restore';
            edit(h.window, 'fld_unselected', currentAnswer);
            await h.locks.settle();
            const beforeRestore = h.reads.length;
            const restore = button(h.window, 'Restore remembered answers');
            assert.equal(restore.disabled, false);
            restore.click();
            await waitFor(() =>
                h.window.document
                    .getElementById('status')!
                    .textContent!.includes('Current answers were retained')
            );
            await h.locks.settle();
            assert.equal(h.reads.length, beforeRestore);
            assert.equal(
                h.reads.some(
                    (read) =>
                        (read.context as Record<string, unknown>)
                            .localStorageRecord !== undefined
                ),
                false
            );
            assert.equal(fieldInput(h.window).value, 'Initial title');
            assert.equal(
                fieldInput(h.window, 'fld_unselected').value,
                currentAnswer
            );
            assert.deepEqual(progressEntries(h.window), stored);
            assert.equal(h.saves.length, 0);
            assert.match(
                h.window.document.getElementById('status')!.textContent!,
                /Reload replaces current inputs/
            );
        });

        it('removes the remembered candidate before an explicit successful Save dispatch', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const form = button(h.window, 'Save').closest('form');
            assert.ok(form);
            form.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(() => h.saves.length === 1 && idle(h.window));
            await h.locks.settle();
            assert.deepEqual(h.progressAtSave, [[]]);
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(h.saves[0]!.formRecord.type, 'create');
            assert.equal(
                h.saves[0]!.formRecord.data.fld_title,
                rememberedTitle
            );
            assert.equal(h.saves.length, 1);
        });

        it('Save proceeds after consent withdrawal when Web Locks are unavailable and storage confirms no progress', async (test) => {
            const h = await fixture(test);
            Object.defineProperty(h.window.navigator, 'locks', {
                configurable: true,
                value: undefined,
            });
            await h.chooseTitle();
            edit(
                h.window,
                'fld_title',
                'Synthetic current answer without Web Locks'
            );
            await h.locks.settle();
            assert.deepEqual(progressEntries(h.window), []);
            const optIn = checkbox(
                h.window,
                'Remember selected answers in this tab'
            );
            assert.equal(optIn.checked, true);
            optIn.checked = false;
            optIn.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            await h.locks.settle();
            const progressReadsBeforeSave: number[] = [];
            const getItem = h.window.sessionStorage.getItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'getItem', {
                configurable: true,
                value: (key: string) => {
                    const value = getItem(key);
                    if (key.startsWith(progressPrefix))
                        progressReadsBeforeSave.push(h.saves.length);
                    return value;
                },
            });
            const form = button(h.window, 'Save').closest('form');
            assert.ok(form);
            form.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(() => h.saves.length === 1 && idle(h.window));
            await h.locks.settle();
            assert.ok(progressReadsBeforeSave.length > 0);
            assert.ok(progressReadsBeforeSave.every((saves) => saves === 0));
            assert.deepEqual(h.progressAtSave, [[]]);
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(
                h.saves[0]!.formRecord.data.fld_title,
                'Synthetic current answer without Web Locks'
            );
            assert.equal(h.saves.length, 1);
        });

        it('explicit discard removes remembered answers without discarding the current Form draft', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            h.window.sessionStorage.setItem(
                'unrelated-progress-test',
                'retained'
            );
            button(h.window, 'Discard remembered answers').click();
            await h.locks.settle();
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(fieldInput(h.window).value, rememberedTitle);
            assert.equal(
                h.window.sessionStorage.getItem('unrelated-progress-test'),
                'retained'
            );
            assert.equal(h.saves.length, 0);
        });

        it('withdrawing consent prevents an admitted queued answer from physically reaching storage', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const newAnswer =
                'Synthetic queued answer after consent withdrawal';
            const physicalWrites: string[] = [];
            const setItem = h.window.sessionStorage.setItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'setItem', {
                configurable: true,
                value: (key: string, bytes: string) => {
                    if (
                        key.startsWith(progressPrefix) &&
                        bytes.includes(newAnswer)
                    )
                        physicalWrites.push(bytes);
                    setItem(key, bytes);
                },
            });
            const reads = h.reads.length;
            const release = h.locks.hold();
            test.after(release);
            edit(h.window, 'fld_title', newAnswer);
            await waitFor(() => h.locks.waiting > 0);
            const optIn = checkbox(
                h.window,
                'Remember selected answers in this tab'
            );
            assert.equal(optIn.checked, true);
            optIn.checked = false;
            optIn.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            release();
            await h.locks.settle();
            assert.deepEqual(physicalWrites, []);
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(fieldInput(h.window).value, newAnswer);
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
        });

        it('denied progress cleanup prevents Save transport and retains the current answers', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const stored = progressEntries(h.window);
            const remove = h.window.sessionStorage.removeItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'removeItem', {
                configurable: true,
                value: (key: string) => {
                    if (key.startsWith(progressPrefix))
                        throw new Error('Synthetic denied progress removal');
                    remove(key);
                },
            });
            const form = button(h.window, 'Save').closest('form');
            assert.ok(form);
            form.dispatchEvent(
                new h.window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await h.locks.settle();
            await waitFor(() => idle(h.window));
            assert.equal(h.saves.length, 0);
            assert.deepEqual(progressEntries(h.window), stored);
            assert.equal(fieldInput(h.window).value, rememberedTitle);
            assert.match(
                h.window.document.getElementById('status')!.textContent!,
                /remember|progress|storage/i
            );
        });

        it('Logout retires a queued write and rotates the visitor namespace before later reconnect', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const ownerKey =
                ownerPrefix + JSON.stringify(['https://app.example.test', 'A']);
            const owner = h.window.sessionStorage.getItem(ownerKey);
            assert.ok(owner);
            const release = h.locks.hold();
            test.after(release);
            edit(
                h.window,
                'fld_title',
                'Synthetic queued answer from retired owner'
            );
            await waitFor(() => h.locks.waiting > 0);
            button(h.window, "Clear this visitor's session").click();
            release();
            await h.locks.settle();
            assert.notEqual(h.window.sessionStorage.getItem(ownerKey), owner);
            assert.equal(
                progressEntries(h.window).some(({ bytes }) =>
                    bytes.includes('Synthetic queued answer from retired owner')
                ),
                false
            );
            await h.connect();
            assert.equal(fieldInput(h.window).value, 'Initial title');
            await h.chooseTitle();
            const restore = Array.from(
                h.window.document.querySelectorAll('button')
            ).find(
                (node) =>
                    node.textContent?.trim() === 'Restore remembered answers'
            );
            assert.ok(restore === undefined || restore.disabled);
            assert.equal(h.saves.length, 0);
            assert.equal(
                h.reads.some(
                    (read) =>
                        (read.context as Record<string, unknown>)
                            .localStorageRecord !== undefined
                ),
                false
            );
        });

        it('Visitor B does not receive Visitor A remembered answers in the same tab', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const visitor = h.window.document.getElementById('visitor');
            assert.ok(visitor instanceof h.window.HTMLSelectElement);
            visitor.value = 'B';
            visitor.dispatchEvent(
                new h.window.Event('change', { bubbles: true })
            );
            const before = h.reads.length;
            button(h.window, 'Reload').click();
            await waitFor(
                () => h.reads.length === before + 1 && idle(h.window)
            );
            assert.equal(fieldInput(h.window).value, 'Initial title');
            await h.chooseTitle();
            const restore = Array.from(
                h.window.document.querySelectorAll('button')
            ).find(
                (node) =>
                    node.textContent?.trim() === 'Restore remembered answers'
            );
            assert.ok(restore === undefined || restore.disabled);
            assert.equal(
                h.reads.some(
                    (read) =>
                        (read.context as Record<string, unknown>)
                            .localStorageRecord !== undefined
                ),
                false
            );
            assert.equal(h.saves.length, 0);
        });
    }
);
