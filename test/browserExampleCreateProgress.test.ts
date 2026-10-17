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
import type { RecoveryAttempt } from '../src/forms/index.js';
import { invalidForm, loadedForm } from './formsFixtures.js';

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
        entryPoints: [
            join(root, 'test/fixtures/browserCreateProgressEntry.mjs'),
        ],
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

// Cooperative exclusive locks model browser storage scheduling. The test entry
// observes the actual journal and permits one controlled pre-transport Cancel;
// the actual starter and SDK still own admission, revisions and outcomes.
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
const storedToken = (window: Window) => {
    const entries = progressEntries(window);
    assert.equal(entries.length, 1);
    const { draftId, writeId } = JSON.parse(entries[0]!.bytes) as {
        draftId: string;
        writeId: string;
    };
    assert.equal(typeof draftId, 'string');
    assert.ok(draftId);
    assert.equal(typeof writeId, 'string');
    assert.ok(writeId);
    return { draftId, writeId };
};
const submitForm = (window: Window) => {
    const form = button(window, 'Save').closest('form');
    assert.ok(form);
    form.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
};
const idle = (window: Window) =>
    window.document.getElementById('screen')?.getAttribute('aria-busy') ===
    'false';

type FixtureControls = {
    saveOutcome?: 'validation' | 'unknown';
    afterJournalBegin?(attempt: RecoveryAttempt): void;
};
const fixture = async (
    test: TestContext,
    form = progressForm(),
    controls: FixtureControls = {}
) => {
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
    const saveOutcomeReached = { saved: 0, validation: 0, unknown: 0 };
    const journalBegins: RecoveryAttempt[] = [];
    const notDispatched: Array<{
        attempt: RecoveryAttempt;
        settled: boolean;
    }> = [];
    const unexpected: string[] = [];
    const globals = {
        __sdkCreateProgressProofHooks: {
            afterBegin(attempt: RecoveryAttempt) {
                journalBegins.push(attempt);
                controls.afterJournalBegin?.(attempt);
            },
            afterNotDispatched(attempt: RecoveryAttempt, settled: boolean) {
                notDispatched.push({ attempt, settled });
            },
        },
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
                if (controls.saveOutcome !== undefined) {
                    assert.equal(init?.method, 'POST');
                    assert.equal(input.isComputeMode, false);
                    const record =
                        input.formRecord as SaveFormInput['formRecord'];
                    assert.equal(record.type, 'create');
                    assert.equal(record.data.fld_title, rememberedTitle);
                    assert.deepEqual(progressAtSave.at(-1), []);
                }
                if (controls.saveOutcome === 'validation') {
                    saveOutcomeReached.validation++;
                    return new Response(JSON.stringify(invalidForm()));
                }
                if (controls.saveOutcome === 'unknown') {
                    saveOutcomeReached.unknown++;
                    throw new TypeError(
                        'Synthetic dispatched Save response unavailable.'
                    );
                }
                saveOutcomeReached.saved++;
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
        saveOutcomeReached,
        journalBegins,
        notDispatched,
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

        it('resumes selected-answer storage after an accepted validation error without replaying Save', async (test) => {
            const h = await fixture(test, progressForm(), {
                saveOutcome: 'validation',
            });
            await h.rememberTitle();
            edit(h.window, 'fld_unselected', omittedAnswer);
            await h.locks.settle();
            const previous = storedToken(h.window);

            submitForm(h.window);
            await waitFor(
                () => h.saveOutcomeReached.validation === 1 && idle(h.window)
            );
            await h.locks.settle();
            assert.deepEqual(h.saveOutcomeReached, {
                saved: 0,
                validation: 1,
                unknown: 0,
            });
            assert.equal(h.saves.length, 1);
            assert.deepEqual(h.progressAtSave, [[]]);
            assert.equal(h.journalBegins.length, 1);
            assert.equal(h.journalBegins[0]!.outcome, 'validation-error');
            assert.equal(h.journalBegins[0]!.flight, false);
            assert.deepEqual(h.notDispatched, []);
            assert.equal(fieldInput(h.window).value, rememberedTitle);
            assert.equal(
                fieldInput(h.window, 'fld_unselected').value,
                omittedAnswer
            );
            assert.match(
                h.window.document.getElementById('status')!.textContent!,
                /not saved.*validation errors/i
            );
            assert.match(
                h.window.document.body.textContent!,
                /A title is required\./
            );
            assert.equal(button(h.window, 'Save').disabled, false);
            assert.equal(
                button(h.window, 'Discard remembered answers').disabled,
                false
            );
            assert.deepEqual(storedValues(h.window), [
                { fld_title: rememberedTitle },
            ]);
            const resumed = storedToken(h.window);
            assert.notEqual(resumed.draftId, previous.draftId);
            assert.notEqual(resumed.writeId, previous.writeId);

            const corrected = 'Synthetic corrected answer after validation';
            edit(h.window, 'fld_title', corrected);
            await h.locks.settle();
            assert.deepEqual(storedValues(h.window), [
                { fld_title: corrected },
            ]);
            assert.equal(storedToken(h.window).draftId, resumed.draftId);
            assert.notEqual(storedToken(h.window).writeId, resumed.writeId);
            assert.equal(h.saves.length, 1);
            assert.equal(h.saveOutcomeReached.validation, 1);
        });

        it('keeps create progress suspended after a counted dispatched Save transport failure', async (test) => {
            const h = await fixture(test, progressForm(), {
                saveOutcome: 'unknown',
            });
            await h.rememberTitle();
            const writesAfterRemember: string[] = [];
            const setItem = h.window.sessionStorage.setItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'setItem', {
                configurable: true,
                value: (key: string, bytes: string) => {
                    if (key.startsWith(progressPrefix))
                        writesAfterRemember.push(bytes);
                    setItem(key, bytes);
                },
            });
            submitForm(h.window);
            await waitFor(
                () => h.saveOutcomeReached.unknown === 1 && idle(h.window)
            );
            await h.locks.settle();
            assert.deepEqual(h.saveOutcomeReached, {
                saved: 0,
                validation: 0,
                unknown: 1,
            });
            assert.equal(h.saves.length, 1);
            assert.deepEqual(h.progressAtSave, [[]]);
            assert.equal(h.journalBegins.length, 1);
            assert.equal(h.journalBegins[0]!.outcome, 'unknown');
            assert.equal(h.journalBegins[0]!.flight, false);
            assert.deepEqual(h.notDispatched, []);
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(fieldInput(h.window).value, rememberedTitle);
            assert.equal(button(h.window, 'Save').disabled, true);
            assert.equal(
                button(h.window, 'Restore remembered answers').disabled,
                true
            );
            assert.equal(
                button(h.window, 'Discard remembered answers').disabled,
                true
            );
            assert.match(
                h.window.document.body.textContent!,
                /could not confirm the earlier attempt.*may have completed/i
            );
            assert.match(
                h.window.document.getElementById('status')!.textContent!,
                /request failed.*inspect/i
            );
            // Even a retained submit listener must respect the real journal's
            // unknown blocker; no second transport or storage resumption follows.
            submitForm(h.window);
            await nextTurn();
            await h.locks.settle();
            assert.equal(h.saves.length, 1);
            assert.equal(h.saveOutcomeReached.unknown, 1);
            assert.equal(h.journalBegins.length, 1);
            assert.deepEqual(writesAfterRemember, []);
            assert.deepEqual(progressEntries(h.window), []);
        });

        it('resumes progress only after the actual journal settles a controlled pre-transport Cancel as not dispatched', async (test) => {
            const controls: FixtureControls = {};
            const h = await fixture(test, progressForm(), controls);
            await h.rememberTitle();
            const previous = storedToken(h.window);
            let cancelReached = 0;
            const progressAtBegin: ReturnType<typeof progressEntries>[] = [];
            controls.afterJournalBegin = (attempt) => {
                if (cancelReached !== 0) return;
                assert.equal(attempt.operation, 'save');
                assert.equal(attempt.outcome, 'unknown');
                assert.equal(attempt.flight, true);
                assert.equal(h.saves.length, 0);
                progressAtBegin.push(progressEntries(h.window));
                const cancel = button(h.window, 'Cancel request');
                assert.equal(cancel.disabled, false);
                cancelReached++;
                cancel.click();
            };

            submitForm(h.window);
            await waitFor(() => h.notDispatched.length === 1 && idle(h.window));
            await h.locks.settle();
            assert.equal(cancelReached, 1);
            assert.deepEqual(progressAtBegin, [[]]);
            assert.equal(h.journalBegins.length, 1);
            assert.equal(h.notDispatched[0]!.settled, true);
            assert.equal(h.notDispatched[0]!.attempt, h.journalBegins[0]);
            assert.equal(h.journalBegins[0]!.outcome, 'not-dispatched');
            assert.equal(h.journalBegins[0]!.flight, false);
            assert.deepEqual(h.journalBegins[0]!.retainedInput, []);
            assert.equal(h.saves.length, 0);
            assert.deepEqual(h.saveOutcomeReached, {
                saved: 0,
                validation: 0,
                unknown: 0,
            });
            assert.deepEqual(h.progressAtSave, []);
            assert.equal(fieldInput(h.window).value, rememberedTitle);
            assert.equal(button(h.window, 'Save').disabled, false);
            assert.equal(
                button(h.window, 'Discard remembered answers').disabled,
                false
            );
            assert.doesNotMatch(
                h.window.document.body.textContent!,
                /Earlier outcome not confirmed/
            );
            assert.deepEqual(storedValues(h.window), [
                { fld_title: rememberedTitle },
            ]);
            const resumed = storedToken(h.window);
            assert.notEqual(resumed.draftId, previous.draftId);
            assert.notEqual(resumed.writeId, previous.writeId);

            // A separate explicit Save remains usable after the one-shot Cancel.
            controls.afterJournalBegin = undefined;
            submitForm(h.window);
            await waitFor(
                () => h.saveOutcomeReached.saved === 1 && idle(h.window)
            );
            await h.locks.settle();
            assert.equal(h.saves.length, 1);
            assert.equal(h.journalBegins.length, 2);
            assert.equal(h.journalBegins[0]!.outcome, 'not-dispatched');
            assert.equal(h.journalBegins[1]!.outcome, 'saved');
            assert.equal(h.notDispatched.length, 1);
            assert.deepEqual(h.progressAtSave, [[]]);
            assert.deepEqual(progressEntries(h.window), []);
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
            h.window.sessionStorage.setItem(
                'unrelated-progress-test',
                'retained'
            );
            const ownerKey =
                ownerPrefix + JSON.stringify(['https://app.example.test', 'A']);
            const owner = h.window.sessionStorage.getItem(ownerKey);
            assert.ok(owner);
            const queuedAnswer = 'Synthetic queued answer from retired owner';
            const physicalWrites: string[] = [];
            const setItem = h.window.sessionStorage.setItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'setItem', {
                configurable: true,
                value: (key: string, bytes: string) => {
                    if (
                        key.startsWith(progressPrefix) &&
                        bytes.includes(queuedAnswer)
                    )
                        physicalWrites.push(bytes);
                    setItem(key, bytes);
                },
            });
            assert.equal(h.locks.waiting, 0);
            const release = h.locks.hold();
            test.after(release);
            edit(h.window, 'fld_title', queuedAnswer);
            await waitFor(() => h.locks.waiting > 0);
            button(h.window, "Clear this visitor's session").click();
            release();
            await h.locks.settle();
            assert.deepEqual(physicalWrites, []);
            assert.notEqual(h.window.sessionStorage.getItem(ownerKey), owner);
            assert.equal(
                progressEntries(h.window).some(({ bytes }) =>
                    bytes.includes(queuedAnswer)
                ),
                false
            );
            assert.equal(
                h.window.sessionStorage.getItem('unrelated-progress-test'),
                'retained'
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
            assert.deepEqual(physicalWrites, []);
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

type PriorDocumentProgressOptions = {
    visitor?: string;
    namespace?: string;
    appOrigin?: string;
    setOwner?: boolean;
    draftId?: string;
    title?: string;
};
const seedPriorDocumentProgress = (
    window: Window,
    options: PriorDocumentProgressOptions = {}
) => {
    const visitor = options.visitor ?? 'A';
    const namespace = options.namespace ?? 'synthetic-prior-document-owner';
    const appOrigin = options.appOrigin ?? 'https://app.example.test';
    const ownerKey = ownerPrefix + JSON.stringify([appOrigin, visitor]);
    const key =
        progressPrefix +
        JSON.stringify([
            'browser-create-progress',
            1,
            appOrigin,
            'https://sdk.example.test',
            'share_progress_synthetic',
            visitor,
            namespace,
            loadedForm().extensionId,
            'table_progress_synthetic',
            'version_progress_synthetic',
        ]);
    const draftId = options.draftId ?? randomUUID();
    const bytes = JSON.stringify({
        kind: 'miniExtensions-sdk-create-progress',
        version: 1,
        draftId,
        writeId: randomUUID(),
        values: { fld_title: options.title ?? rememberedTitle },
    });
    if (options.setOwner !== false)
        window.sessionStorage.setItem(ownerKey, namespace);
    window.sessionStorage.setItem(key, bytes);
    return { key, bytes, ownerKey, namespace, draftId };
};
const cleanupFailure = async (window: Window) => {
    const status = window.document.getElementById('status')!;
    await waitFor(() => status.classList.contains('error'));
    assert.match(status.textContent!, /remember|progress|storage/i);
    assert.doesNotMatch(status.textContent!, /This Form draft was discarded/);
};

describe(
    'actual starter prior-document create progress cleanup',
    { concurrency: false },
    () => {
        it('unchecked Discard draft discovers and removes prior-document progress before later opt-in', async (test) => {
            const h = await fixture(test);
            const prior = seedPriorDocumentProgress(h.window);
            assert.equal(
                checkbox(h.window, 'Remember selected answers in this tab')
                    .checked,
                false
            );
            edit(
                h.window,
                'fld_title',
                'Synthetic current draft before Discard'
            );
            const reads = h.reads.length;
            button(h.window, 'Discard draft').click();
            await h.locks.settle();
            await waitFor(
                () =>
                    h.window.document.getElementById('status')!.textContent ===
                    'This Form draft was discarded. No record was saved.'
            );
            assert.equal(h.window.sessionStorage.getItem(prior.key), null);
            assert.equal(fieldInput(h.window).value, 'Initial title');
            await h.chooseTitle();
            assert.equal(
                button(h.window, 'Restore remembered answers').disabled,
                true
            );
            assert.equal(
                progressEntries(h.window).some(({ bytes }) =>
                    bytes.includes(rememberedTitle)
                ),
                false
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
        });

        it('pending Discard cleanup retains a newer edit and resumes the same live progress owner', async (test) => {
            const h = await fixture(test);
            const prior = seedPriorDocumentProgress(h.window);
            assert.equal(
                checkbox(h.window, 'Remember selected answers in this tab')
                    .checked,
                false
            );
            edit(
                h.window,
                'fld_title',
                'Synthetic current draft before pending Discard'
            );
            const input = fieldInput(h.window);
            const reads = h.reads.length;
            const release = h.locks.hold();
            test.after(release);
            button(h.window, 'Discard draft').click();
            await waitFor(() => h.locks.waiting > 0);

            // The cleanup has captured the earlier remembered token, but this
            // same Form and its native draft are still accepting actual input.
            assert.equal(input.isConnected, true);
            assert.equal(input.disabled, false);
            const newer = 'Synthetic newer answer while Discard cleanup waits';
            edit(h.window, 'fld_title', newer);
            assert.ok(
                fieldInput(h.window) === input,
                'Expected the surviving input for pending Discard.'
            );
            assert.equal(input.value, newer);
            assert.equal(h.saves.length, 0);
            release();
            await h.locks.settle();

            // Removing remembered bytes is permitted. It is not permission to
            // discard the newer in-memory draft or publish the old success.
            assert.equal(h.window.sessionStorage.getItem(prior.key), null);
            assert.deepEqual(progressEntries(h.window), []);
            assert.ok(
                fieldInput(h.window) === input,
                'Expected the surviving input for pending Discard.'
            );
            assert.equal(input.isConnected, true);
            assert.equal(input.value, newer);
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);
            assert.equal(h.notDispatched.length, 0);

            // DOM text alone could hide an expired draft handle. Exercise the
            // public remembering flow again to prove the current native owner
            // survived and its cleanup suspension was released explicitly.
            await h.chooseTitle();
            const afterCleanup =
                'Synthetic answer explicitly remembered after stale Discard';
            edit(h.window, 'fld_title', afterCleanup);
            await h.locks.settle();
            assert.ok(
                fieldInput(h.window) === input,
                'Expected the surviving input for pending Discard.'
            );
            assert.equal(input.value, afterCleanup);
            assert.deepEqual(storedValues(h.window), [
                { fld_title: afterCleanup },
            ]);
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);
            assert.equal(h.notDispatched.length, 0);
        });

        it('Discard cleanup handed to an active Review resumes remembering after Edit without discarding newer answers', async (test) => {
            const form = progressForm();
            form.payload.fieldIdsInForm = ['fld_title', 'fld_readonly'];
            form.payload.publicFields.state.promptUserBeforeSubmission = true;
            const h = await fixture(test, form);
            const prior = seedPriorDocumentProgress(h.window);
            h.window.sessionStorage.setItem(
                'synthetic-pending-review-discard-unrelated',
                'Synthetic retained unrelated bytes'
            );
            const reads = h.reads.length;
            edit(
                h.window,
                'fld_title',
                'Synthetic original answer before Review handoff'
            );
            const input = fieldInput(h.window);
            const release = h.locks.hold();
            test.after(release);
            button(h.window, 'Discard draft').click();
            await waitFor(() => h.locks.waiting > 0);

            // The ordinary input is still editable before opening the modal.
            // Do not manufacture input events through Review's inert field owner.
            const newer = 'Synthetic newer answer captured by active Review';
            edit(h.window, 'fld_title', newer);
            submitForm(h.window);
            await waitFor(
                () =>
                    h.window.document.querySelector(
                        'dialog[data-form-review][open]'
                    ) !== null
            );
            const dialog = h.window.document.querySelector(
                'dialog[data-form-review][open]'
            );
            assert.ok(dialog instanceof h.window.HTMLDialogElement);
            assert.ok(dialog.textContent!.includes(newer));
            const fields = input.closest('.fields');
            assert.ok(fields instanceof h.window.HTMLElement);
            assert.equal(fields.inert, true);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);

            release();
            await h.locks.settle();
            assert.equal(h.window.sessionStorage.getItem(prior.key), null);
            assert.deepEqual(progressEntries(h.window), []);
            assert.ok(
                fieldInput(h.window) === input,
                'Pending cleanup must retain the original live input during Review.'
            );
            assert.equal(input.value, newer);
            assert.equal(dialog.isConnected && dialog.open, true);
            assert.equal(fields.inert, true);
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);

            button(h.window, 'Edit').click();
            await waitFor(
                () =>
                    h.window.document.querySelector(
                        'dialog[data-form-review][open]'
                    ) === null
            );
            await h.locks.settle();
            assert.ok(
                fieldInput(h.window) === input,
                'Review Edit must retain the same newer native input.'
            );
            assert.equal(input.value, newer);
            assert.equal(fields.inert, false);

            // Successful remembered-byte cleanup suspended the old operation.
            // Edit returning ownership must now release that suspension without
            // confirming Review, replaying Save or replacing the native handle.
            await h.chooseTitle();
            const afterEdit =
                'Synthetic answer remembered after Review cancelled pending Discard';
            edit(h.window, 'fld_title', afterEdit);
            await h.locks.settle();
            assert.ok(
                fieldInput(h.window) === input,
                'Remembering after Review Edit must use the surviving input.'
            );
            assert.equal(input.value, afterEdit);
            assert.deepEqual(storedValues(h.window), [
                { fld_title: afterEdit },
            ]);
            assert.equal(
                h.window.sessionStorage.getItem(
                    'synthetic-pending-review-discard-unrelated'
                ),
                'Synthetic retained unrelated bytes'
            );
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);
            assert.equal(h.notDispatched.length, 0);
        });

        it('Discard cleanup handed to a concurrent unknown Save cannot resume progress or replay the mutation', async (test) => {
            const h = await fixture(test, progressForm(), {
                saveOutcome: 'unknown',
            });
            await h.rememberTitle();
            const input = fieldInput(h.window);
            const reads = h.reads.length;
            const writesAfterRemember: string[] = [];
            const setItem = h.window.sessionStorage.setItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'setItem', {
                configurable: true,
                value: (key: string, bytes: string) => {
                    if (key.startsWith(progressPrefix))
                        writesAfterRemember.push(bytes);
                    setItem(key, bytes);
                },
            });
            const release = h.locks.hold();
            test.after(release);
            button(h.window, 'Discard draft').click();
            await waitFor(() => h.locks.waiting > 0);

            // The pending Discard and the newer explicit Save both clear the
            // captured remembered token through real queued Web Locks. The
            // Save owns the request before either cleanup can finish.
            submitForm(h.window);
            await waitFor(() => !idle(h.window) && h.locks.waiting >= 2);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);
            release();
            await waitFor(
                () => h.saveOutcomeReached.unknown === 1 && idle(h.window)
            );
            await h.locks.settle();

            assert.deepEqual(h.saveOutcomeReached, {
                saved: 0,
                validation: 0,
                unknown: 1,
            });
            assert.equal(h.saves.length, 1);
            assert.deepEqual(h.progressAtSave, [[]]);
            assert.equal(
                h.saves[0]!.formRecord.data.fld_title,
                rememberedTitle
            );
            assert.equal(h.journalBegins.length, 1);
            const attempt = h.journalBegins[0]!;
            assert.equal(attempt.operation, 'save');
            assert.equal(attempt.outcome, 'unknown');
            assert.equal(attempt.flight, false);
            assert.equal(attempt.acknowledgment, 'none');
            assert.deepEqual(h.notDispatched, []);
            assert.ok(
                fieldInput(h.window) === input,
                'Unknown Save must retain the current input instead of applying stale Discard.'
            );
            assert.equal(input.value, rememberedTitle);
            const fields = input.closest('.fields');
            assert.ok(fields instanceof h.window.HTMLElement);
            assert.equal(fields.inert, true);
            assert.equal(button(h.window, 'Save').disabled, true);
            assert.equal(button(h.window, 'Discard draft').disabled, true);
            assert.equal(
                button(h.window, 'Restore remembered answers').disabled,
                true
            );
            assert.equal(
                button(h.window, 'Discard remembered answers').disabled,
                true
            );
            assert.deepEqual(writesAfterRemember, []);
            assert.deepEqual(progressEntries(h.window), []);
            assert.match(
                h.window.document.body.textContent!,
                /could not confirm the earlier attempt.*may have completed/i
            );
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );

            // A retained submit handler must still obey the actual unknown
            // journal blocker. Clearing the pending-resume handoff is not an
            // acknowledgment, a new intent, or permission for another Save.
            submitForm(h.window);
            await nextTurn();
            await h.locks.settle();
            assert.equal(h.saves.length, 1);
            assert.equal(h.saveOutcomeReached.unknown, 1);
            assert.equal(h.journalBegins.length, 1);
            assert.equal(attempt.outcome, 'unknown');
            assert.equal(attempt.acknowledgment, 'none');
            assert.deepEqual(writesAfterRemember, []);
            assert.deepEqual(progressEntries(h.window), []);
            assert.equal(h.reads.length, reads);
            assert.equal(input.value, rememberedTitle);
        });

        it('Cancel during concurrent Discard and Save cleanup resumes only the surviving newer draft after cleanup settles', async (test) => {
            const h = await fixture(test);
            await h.rememberTitle();
            const previous = storedToken(h.window);
            const input = fieldInput(h.window);
            const reads = h.reads.length;
            const writesAfterRemember: string[] = [];
            const setItem = h.window.sessionStorage.setItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'setItem', {
                configurable: true,
                value: (key: string, bytes: string) => {
                    if (key.startsWith(progressPrefix))
                        writesAfterRemember.push(bytes);
                    setItem(key, bytes);
                },
            });
            const release = h.locks.hold();
            test.after(release);
            button(h.window, 'Discard draft').click();
            await waitFor(() => h.locks.waiting > 0);
            submitForm(h.window);
            await waitFor(() => !idle(h.window) && h.locks.waiting >= 2);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);

            // Cancel releases the UI request lease, but the actual beforeSave
            // cleanup promise and both Web Lock operations are still pending.
            button(h.window, 'Cancel request').click();
            await waitFor(() => idle(h.window));
            assert.ok(
                fieldInput(h.window) === input,
                'Pre-transport Cancel must retain the live input.'
            );
            assert.equal(input.disabled, false);
            const fields = input.closest('.fields');
            assert.ok(fields instanceof h.window.HTMLElement);
            assert.equal(fields.inert, false);
            assert.equal(
                checkbox(h.window, 'Remember selected answers in this tab')
                    .checked,
                true
            );
            assert.equal(checkbox(h.window, 'Remember Title').checked, true);
            assert.equal(checkbox(h.window, 'Remember Title').disabled, true);
            const newer =
                'Synthetic newer answer after Cancel while cleanup is held';
            edit(h.window, 'fld_title', newer);
            await nextTurn();
            assert.equal(input.value, newer);
            assert.ok(h.locks.waiting >= 2);
            assert.deepEqual(writesAfterRemember, []);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);

            release();
            await h.locks.settle();
            assert.ok(
                fieldInput(h.window) === input,
                'Settled cleanup must preserve the newer same-owner input.'
            );
            assert.equal(input.value, newer);
            assert.equal(fields.inert, false);
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );
            assert.equal(h.saves.length, 0);
            assert.deepEqual(h.saveOutcomeReached, {
                saved: 0,
                validation: 0,
                unknown: 0,
            });
            assert.equal(h.journalBegins.length, 0);
            assert.deepEqual(h.notDispatched, []);

            // Consent and field selection were already explicit. The cancelled
            // request must resume that surviving progress bridge only after the
            // actual cleanup has settled; no new opt-in or Form remount masks it.
            assert.equal(checkbox(h.window, 'Remember Title').disabled, false);
            assert.deepEqual(storedValues(h.window), [{ fld_title: newer }]);
            assert.ok(writesAfterRemember.length > 0);
            assert.ok(
                writesAfterRemember.every(
                    (bytes) => JSON.parse(bytes).values.fld_title === newer
                ),
                'Only the newer answer may be written after cleanup.'
            );
            const resumed = storedToken(h.window);
            assert.notEqual(resumed.draftId, previous.draftId);
            assert.notEqual(resumed.writeId, previous.writeId);
            assert.equal(h.reads.length, reads);
        });

        it('a newer Review open and Edit-close obsoletes pending Discard even when the native answer never changes', async (test) => {
            const form = progressForm();
            form.payload.fieldIdsInForm = ['fld_title', 'fld_readonly'];
            form.payload.publicFields.state.promptUserBeforeSubmission = true;
            const h = await fixture(test, form);
            const prior = seedPriorDocumentProgress(h.window);
            const unsaved =
                'Synthetic unsaved answer established before Discard';
            edit(h.window, 'fld_title', unsaved);
            const input = fieldInput(h.window);
            let inputChangesDuringCleanup = 0;
            input.addEventListener('input', () => {
                inputChangesDuringCleanup++;
            });
            input.addEventListener('change', () => {
                inputChangesDuringCleanup++;
            });
            const reads = h.reads.length;
            const release = h.locks.hold();
            test.after(release);
            button(h.window, 'Discard draft').click();
            await waitFor(() => h.locks.waiting > 0);

            // This bound scalar's Review read only reads its native snapshot.
            // No input/change event or native-value edit occurs during cleanup;
            // only the newer Review intent goes false -> true -> false.
            submitForm(h.window);
            await waitFor(
                () =>
                    h.window.document.querySelector(
                        'dialog[data-form-review][open]'
                    ) !== null
            );
            const dialog = h.window.document.querySelector(
                'dialog[data-form-review][open]'
            );
            assert.ok(dialog instanceof h.window.HTMLDialogElement);
            assert.ok(dialog.textContent!.includes(unsaved));
            const fields = input.closest('.fields');
            assert.ok(fields instanceof h.window.HTMLElement);
            assert.equal(fields.inert, true);
            button(h.window, 'Edit').click();
            await waitFor(
                () =>
                    h.window.document.querySelector(
                        'dialog[data-form-review][open]'
                    ) === null && fields.inert === false
            );
            await nextTurn();
            assert.equal(idle(h.window), true);
            assert.ok(h.locks.waiting > 0);
            assert.equal(inputChangesDuringCleanup, 0);
            assert.equal(input.value, unsaved);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);

            release();
            await h.locks.settle();
            assert.equal(h.window.sessionStorage.getItem(prior.key), null);
            assert.deepEqual(progressEntries(h.window), []);
            assert.ok(
                fieldInput(h.window) === input,
                'A completed newer Review intent must preserve the same unsaved input.'
            );
            assert.equal(input.value, unsaved);
            assert.equal(inputChangesDuringCleanup, 0);
            assert.equal(fields.inert, false);
            assert.doesNotMatch(
                h.window.document.getElementById('status')!.textContent!,
                /This Form draft was discarded/
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);
            assert.deepEqual(h.notDispatched, []);

            // Prove both the native handle and remembering are live without
            // another native-value edit that could conceal the ABA failure.
            await h.chooseTitle();
            assert.deepEqual(storedValues(h.window), [{ fld_title: unsaved }]);
            assert.ok(
                fieldInput(h.window) === input,
                'Remembering after Review ABA must retain the original native owner.'
            );
            assert.equal(input.value, unsaved);
            assert.equal(inputChangesDuringCleanup, 0);
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
            assert.equal(h.journalBegins.length, 0);
        });

        for (const action of ['logout', 'disconnect'] as const)
            it(`${action} discovers prior-document owned slots across namespaces and preserves unrelated storage`, async (test) => {
                const h = await fixture(test);
                const active = seedPriorDocumentProgress(h.window);
                const older = seedPriorDocumentProgress(h.window, {
                    namespace: 'synthetic-older-document-owner',
                    setOwner: false,
                });
                const otherVisitor = seedPriorDocumentProgress(h.window, {
                    visitor: 'B',
                    namespace: 'synthetic-visitor-B-owner',
                });
                const unrelatedVisitor = seedPriorDocumentProgress(h.window, {
                    visitor: 'C',
                    namespace: 'synthetic-unrelated-visitor-owner',
                });
                const otherOrigin = seedPriorDocumentProgress(h.window, {
                    appOrigin: 'https://other-app.example.test',
                    setOwner: false,
                });
                const foreignKey =
                    progressPrefix +
                    JSON.stringify(['synthetic-foreign-producer', 1, 'A']);
                h.window.sessionStorage.setItem(
                    foreignKey,
                    'Synthetic foreign producer bytes'
                );
                h.window.sessionStorage.setItem(
                    'synthetic-unrelated-storage',
                    'Retained unrelated bytes'
                );
                const reads = h.reads.length;
                button(
                    h.window,
                    action === 'logout'
                        ? "Clear this visitor's session"
                        : 'Disconnect'
                ).click();
                await h.locks.settle();
                assert.equal(h.window.sessionStorage.getItem(active.key), null);
                assert.equal(h.window.sessionStorage.getItem(older.key), null);
                assert.equal(
                    h.window.sessionStorage.getItem(otherVisitor.key),
                    action === 'disconnect' ? null : otherVisitor.bytes
                );
                assert.equal(
                    h.window.sessionStorage.getItem(unrelatedVisitor.key),
                    unrelatedVisitor.bytes
                );
                assert.equal(
                    h.window.sessionStorage.getItem(unrelatedVisitor.ownerKey),
                    unrelatedVisitor.namespace
                );
                assert.equal(
                    h.window.sessionStorage.getItem(otherOrigin.key),
                    otherOrigin.bytes
                );
                assert.equal(
                    h.window.sessionStorage.getItem(foreignKey),
                    'Synthetic foreign producer bytes'
                );
                assert.equal(
                    h.window.sessionStorage.getItem(
                        'synthetic-unrelated-storage'
                    ),
                    'Retained unrelated bytes'
                );
                assert.notEqual(
                    h.window.sessionStorage.getItem(active.ownerKey),
                    active.namespace
                );
                assert.equal(
                    h.window.document
                        .getElementById('status')!
                        .classList.contains('error'),
                    false
                );
                assert.equal(h.reads.length, reads);
                assert.equal(h.saves.length, 0);
            });

        for (const action of ['Discard draft', 'logout'] as const)
            it(`${action} preserves newer same-slot bytes and a new namespace after cleanup captured an older token`, async (test) => {
                const h = await fixture(test);
                const prior = seedPriorDocumentProgress(h.window);
                edit(
                    h.window,
                    'fld_title',
                    'Synthetic live answer during cleanup conflict'
                );
                const removed: string[] = [];
                const removeItem = h.window.sessionStorage.removeItem.bind(
                    h.window.sessionStorage
                );
                Object.defineProperty(h.window.sessionStorage, 'removeItem', {
                    configurable: true,
                    value: (key: string) => {
                        removed.push(key);
                        removeItem(key);
                    },
                });
                const reads = h.reads.length;
                const release = h.locks.hold();
                test.after(release);
                if (action === 'logout')
                    button(h.window, "Clear this visitor's session").click();
                else button(h.window, action).click();
                await waitFor(() => h.locks.waiting > 0);
                const successor = seedPriorDocumentProgress(h.window, {
                    namespace: prior.namespace,
                    setOwner: false,
                    draftId: prior.draftId,
                    title: 'Synthetic newer same-slot answer',
                });
                const namespace =
                    action === 'logout'
                        ? h.window.sessionStorage.getItem(prior.ownerKey)!
                        : 'synthetic-new-document-successor-owner';
                assert.notEqual(namespace, prior.namespace);
                const newScope = seedPriorDocumentProgress(h.window, {
                    namespace,
                    title: 'Synthetic new namespace answer',
                });
                release();
                await h.locks.settle();
                await cleanupFailure(h.window);
                assert.equal(
                    h.window.sessionStorage.getItem(successor.key),
                    successor.bytes
                );
                assert.equal(
                    h.window.sessionStorage.getItem(newScope.key),
                    newScope.bytes
                );
                assert.equal(removed.includes(successor.key), false);
                assert.equal(removed.includes(newScope.key), false);
                if (action === 'Discard draft')
                    assert.equal(
                        fieldInput(h.window).value,
                        'Synthetic live answer during cleanup conflict'
                    );
                assert.equal(h.reads.length, reads);
                assert.equal(h.saves.length, 0);
            });

        for (const failure of ['denied removal', 'malformed envelope'] as const)
            it(`unchecked Discard draft reports ${failure} and retains the current draft and stored bytes`, async (test) => {
                const h = await fixture(test);
                const prior = seedPriorDocumentProgress(h.window);
                if (failure === 'malformed envelope')
                    h.window.sessionStorage.setItem(
                        prior.key,
                        '{Synthetic malformed progress'
                    );
                else {
                    const removeItem = h.window.sessionStorage.removeItem.bind(
                        h.window.sessionStorage
                    );
                    Object.defineProperty(
                        h.window.sessionStorage,
                        'removeItem',
                        {
                            configurable: true,
                            value: (key: string) => {
                                if (key === prior.key)
                                    throw new Error(
                                        'Synthetic denied prior-document cleanup'
                                    );
                                removeItem(key);
                            },
                        }
                    );
                }
                const bytes = h.window.sessionStorage.getItem(prior.key);
                edit(
                    h.window,
                    'fld_title',
                    'Synthetic current answer retained on cleanup failure'
                );
                const reads = h.reads.length;
                button(h.window, 'Discard draft').click();
                await h.locks.settle();
                await cleanupFailure(h.window);
                assert.equal(h.window.sessionStorage.getItem(prior.key), bytes);
                assert.equal(
                    fieldInput(h.window).value,
                    'Synthetic current answer retained on cleanup failure'
                );
                assert.equal(h.reads.length, reads);
                assert.equal(h.saves.length, 0);
            });

        it('Logout reports denied prior-document cleanup while rotating the owner and retaining inaccessible bytes', async (test) => {
            const h = await fixture(test);
            const prior = seedPriorDocumentProgress(h.window);
            const removeItem = h.window.sessionStorage.removeItem.bind(
                h.window.sessionStorage
            );
            Object.defineProperty(h.window.sessionStorage, 'removeItem', {
                configurable: true,
                value: (key: string) => {
                    if (key === prior.key)
                        throw new Error(
                            'Synthetic denied prior-document Logout cleanup'
                        );
                    removeItem(key);
                },
            });
            const reads = h.reads.length;
            button(h.window, "Clear this visitor's session").click();
            await h.locks.settle();
            await cleanupFailure(h.window);
            assert.equal(
                h.window.sessionStorage.getItem(prior.key),
                prior.bytes
            );
            assert.notEqual(
                h.window.sessionStorage.getItem(prior.ownerKey),
                prior.namespace
            );
            assert.match(
                h.window.document.getElementById('status')!.textContent!,
                /could not be fully cleared/i
            );
            assert.equal(h.reads.length, reads);
            assert.equal(h.saves.length, 0);
        });
    }
);
