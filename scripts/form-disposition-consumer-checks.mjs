import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

/** Actual installed ESM/CommonJS; synthetic transport, never persistence acceptance. */
export async function checkFormDispositionConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const root = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const forms = await import(pathToFileURL(join(root, 'forms/index.js')));
    const runtime = await import(pathToFileURL(join(root, 'runtime/index.js')));
    const scope = {
        owner: 'A',
        parentFieldId: null,
        tableId: null,
        childExtensionId: 'form',
        context: 'modal',
    };
    let checks = 0;
    const owners = [];
    const make = () => {
        const page = fixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        page.payload.hasParentExtension = false;
        const client = runtime.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('No network');
            },
        });
        const calls = [];
        const response = {
            type: 'error',
            formValidationErrors: [],
            formErrors: {},
        };
        client.forms.save = async (input) => {
            calls.push(structuredClone(input));
            return response;
        };
        const options = {
            client,
            loaded: page,
            getScope: () => ({ ownerId: 'A', revision: 0 }),
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: { kept: 'exact' },
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        };
        const owner = forms.createFormFieldBindings(options);
        owners.push(owner);
        const journal = new forms.RecoveryJournal();
        const dispositions = [];
        let attempt;
        const lifecycle = (hook = () => {}) => ({
            dispatch() {
                const captured = journal.begin(scope, null, 'save', 1);
                attempt = captured;
                hook();
                return {
                    accepted: () =>
                        journal.accepted(captured, 'validation-error'),
                    finish(disposition) {
                        dispositions.push(disposition);
                        if (disposition === 'not-dispatched')
                            journal.notDispatched(captured);
                        else journal.finishFlight(captured);
                    },
                };
            },
        });
        return {
            page,
            client,
            options,
            owner,
            calls,
            journal,
            dispositions,
            lifecycle,
            get attempt() {
                return attempt;
            },
        };
    };
    try {
        const cjs = require('@miniextensions/sdk/forms');
        const journal = new cjs.RecoveryJournal();
        const pending = journal.begin(scope, null, 'save', 1);
        assert.equal(journal.notDispatched(pending), true);
        assert.equal(pending.outcome, 'not-dispatched');
        checks++;
        {
            const f = make();
            let live = true;
            const before = f.owner.controller.getState().draft;
            await assert.rejects(
                f.owner.save({
                    isCurrent: () => live,
                    lifecycle: f.lifecycle(() => {
                        live = false;
                    }),
                })
            );
            assert.equal(f.calls.length, 0);
            assert.deepEqual(f.dispositions, ['not-dispatched']);
            assert.equal(f.attempt.outcome, 'not-dispatched');
            assert.equal(f.attempt.acknowledgment, 'none');
            assert.equal(f.journal.blocking(scope, null), undefined);
            assert.deepEqual(f.owner.controller.getState().draft, before);
            assert.equal(f.owner.controller.getState().status, 'ready');
            live = true;
            const old = f.attempt;
            await f.owner.save({ lifecycle: f.lifecycle() });
            assert.equal(f.calls.length, 1);
            assert.notEqual(f.attempt.id, old.id);
            assert.deepEqual(f.calls[0].formRecord.data, before.data);
            assert.deepEqual(
                f.calls[0].formFieldIdsWithUnsavedChanges,
                before.dirtyFieldIds
            );
            assert.deepEqual(f.calls[0].searchQuery, { kept: 'exact' });
            checks++;
        }
        {
            const f = make();
            const old = f.owner.field(f.page.payload.fieldIdsInForm[0]);
            const b = structuredClone(f.page);
            b.payload.extensionAccessToken = 'token_B';
            await assert.rejects(
                f.owner.save({
                    lifecycle: f.lifecycle(() =>
                        f.owner.controller.reset({ ...f.options, loaded: b })
                    ),
                })
            );
            const successor = f.owner.controller.getState();
            assert.equal(f.calls.length, 0);
            assert.deepEqual(f.dispositions, ['not-dispatched']);
            assert.equal(f.attempt.outcome, 'not-dispatched');
            assert.equal(f.journal.blocking(scope, null), undefined);
            assert.equal(old.getSnapshot().retired, true);
            assert.equal(successor.status, 'ready');
            assert.deepEqual(successor.draft.data, b.payload.formRecord.data);
            checks++;
        }
        {
            const f = make();
            await assert.rejects(
                f.owner.save({
                    lifecycle: f.lifecycle(() => f.owner.controller.cancel()),
                })
            );
            assert.equal(f.calls.length, 0);
            assert.deepEqual(f.dispositions, ['not-dispatched']);
            assert.equal(f.journal.blocking(scope, null), undefined);
            assert.equal(
                await f.owner.reload({
                    dirty: 'keep',
                    read: async () => structuredClone(f.page),
                }),
                true
            );
            assert.equal(f.calls.length, 0); // Explicit fresh read is not a replay.
            await f.owner.save({ lifecycle: f.lifecycle() });
            assert.equal(f.calls.length, 1);
            checks++;
        }
        {
            const f = make();
            let release;
            f.client.forms.save = (input) => {
                f.calls.push(structuredClone(input));
                return new Promise((resolve) => {
                    release = resolve;
                });
            };
            const pending = f.owner.save({ lifecycle: f.lifecycle() });
            const rejected = assert.rejects(pending);
            assert.equal(f.calls.length, 1);
            f.owner.controller.cancel();
            const b = structuredClone(f.page);
            b.payload.extensionAccessToken = 'token_B';
            f.owner.controller.reset({ ...f.options, loaded: b });
            const successor = f.owner.controller.getState();
            release({
                type: 'error',
                formValidationErrors: [],
                formErrors: {},
            });
            await rejected;
            assert.deepEqual(f.dispositions, ['dispatched']);
            assert.equal(f.attempt.outcome, 'unknown');
            assert.equal(f.attempt.flight, false);
            assert.equal(f.journal.blocking(scope, null), f.attempt);
            assert.equal(f.journal.notDispatched(f.attempt), false);
            assert.deepEqual(
                f.owner.controller.getState().draft,
                successor.draft
            );
            assert.equal(f.calls.length, 1);
            checks++;
        }
        {
            const f = make();
            f.client.forms.save = () => {
                f.calls.push('invoked');
                throw Error('Synchronous transport refusal');
            };
            await assert.rejects(f.owner.save({ lifecycle: f.lifecycle() }));
            assert.deepEqual(f.dispositions, ['dispatched']);
            assert.equal(f.attempt.outcome, 'unknown');
            assert.equal(f.attempt.flight, false);
            assert.equal(f.journal.blocking(scope, null), f.attempt);
            await assert.rejects(f.owner.save());
            assert.equal(f.calls.length, 1);
            checks++;
        }
        {
            const f = make();
            let live = true;
            const operation = f.lifecycle(() => {
                live = false;
            });
            const b = structuredClone(f.page);
            b.payload.extensionAccessToken = 'token_B';
            await assert.rejects(
                f.owner.save({
                    isCurrent: () => live,
                    lifecycle: {
                        dispatch() {
                            const task = operation.dispatch();
                            return {
                                ...task,
                                finish(disposition) {
                                    task.finish(disposition);
                                    f.owner.controller.reset({
                                        ...f.options,
                                        loaded: b,
                                    });
                                    throw Error('Cleanup reentry');
                                },
                            };
                        },
                    },
                })
            );
            assert.equal(f.calls.length, 0);
            assert.equal(f.attempt.outcome, 'not-dispatched');
            assert.equal(f.owner.controller.getState().status, 'ready');
            assert.deepEqual(
                f.owner.controller.getState().draft.data,
                b.payload.formRecord.data
            );
            checks++;
        }
        {
            const f = make();
            let live = true;
            const states = [],
                fields = [];
            const stop = f.owner.controller.subscribe((state) =>
                states.push([state.status, state.canSave])
            );
            const field = f.owner.field('fld_title');
            const stopField = field.subscribe((state) =>
                fields.push([state.pending, state.canEdit])
            );
            await assert.rejects(
                f.owner.save({
                    isCurrent: () => live,
                    lifecycle: f.lifecycle(() => {
                        live = false;
                    }),
                })
            );
            assert.deepEqual(states, [
                ['ready', true],
                ['saving', false],
                ['ready', true],
            ]);
            assert.deepEqual(fields.at(-1), [false, true]);
            assert.equal(f.journal.blocking(scope, null), undefined);
            assert.equal(f.calls.length, 0);
            stop();
            stopField();
            checks++;
        }
        {
            const f = make();
            let live = true,
                armed = false,
                successor,
                release;
            f.client.forms.save = (input) => {
                f.calls.push(structuredClone(input));
                return new Promise((resolve) => {
                    release = resolve;
                });
            };
            const stop = f.owner.controller.subscribe((state) => {
                if (armed && state.status === 'ready' && state.canSave) {
                    armed = false;
                    successor = f.owner.save({ lifecycle: f.lifecycle() });
                }
            });
            await assert.rejects(
                f.owner.save({
                    isCurrent: () => live,
                    lifecycle: f.lifecycle(() => {
                        live = false;
                        armed = true;
                    }),
                })
            );
            assert(successor);
            assert.equal(f.calls.length, 1);
            assert.equal(f.owner.controller.getState().status, 'saving');
            assert.equal(f.owner.controller.getState().canSave, false);
            assert.deepEqual(f.dispositions, ['not-dispatched']);
            release({
                type: 'error',
                formValidationErrors: [],
                formErrors: {},
            });
            await successor;
            assert.deepEqual(f.dispositions, ['not-dispatched', 'dispatched']);
            assert.equal(
                f.owner.controller.getState().status,
                'validation-error'
            );
            stop();
            checks++;
        }
        console.log(
            `Installed Form disposition: ${checks} checkpoints; synthetic dispatch contrast only.`
        );
        return checks;
    } finally {
        for (const owner of owners) owner.destroy();
    }
}
