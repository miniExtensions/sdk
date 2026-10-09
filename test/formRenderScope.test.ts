import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormPageOwner } from '../src/forms/pages.js';
import { createFormRenderScope } from '../src/ui/index.js';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';

const fixture = (configure: (loaded: FormLoadedResult) => void = () => {}) => {
    const loaded = loadedForm();
    const template = structuredClone(
        loaded.payload.fieldIdsToSchemas.fld_title!
    );
    assert.equal(template.fieldType, 'singleLineText');
    if (template.fieldType !== 'singleLineText') throw Error('Invalid fixture');
    loaded.payload.fieldIdsInForm = ['a', 'b', 'c'];
    loaded.payload.fieldIdsToSchemas = Object.fromEntries(
        ['a', 'b', 'c'].map((id, index) => [
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
                    headerSectionTitle:
                        index === 1
                            ? 'Second'
                            : index === 2
                              ? 'Third'
                              : undefined,
                },
            },
        ])
    );
    loaded.payload.formRecord = {
        type: 'create',
        data: { a: 'A', b: 'B', c: 'C', untouched: { text: 'native' } },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['untouched'];
    loaded.payload.urlPrefilledFieldIds = [];
    loaded.payload.publicFields.state.multiPageFormMode = 'multi-page';
    loaded.payload.publicFields.state.promptUserBeforeSubmission = false;
    loaded.payload.publicFields.state.enableFormComputeMode = false;
    loaded.payload.publicFields.state.autoSubmitAfterPrefill = false;
    configure(loaded);
    let owner = { ownerId: 'A', revision: 0 },
        configuration = 0,
        current = true;
    const calls: SaveFormInput[] = [];
    let requests = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            requests++;
            throw Error('Unexpected request');
        },
    });
    client.forms.save = async (input) => {
        calls.push(input);
        return invalidForm();
    };
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => owner,
    });
    const options = {
        fields,
        isCurrent: () => current,
        configurationRevision: () => configuration,
    };
    return {
        loaded,
        fields,
        client,
        calls,
        options,
        requests: () => requests,
        setOwner: (value: typeof owner) => {
            owner = value;
        },
        setConfig: (value: number) => {
            configuration = value;
        },
        setCurrent: (value: boolean) => {
            current = value;
        },
    };
};
const ids = (scope: ReturnType<typeof createFormRenderScope>) =>
    scope.getSnapshot().fields.map((field) => field.fieldId);
const lastPage = (scope: ReturnType<typeof createFormRenderScope>) => {
    while (scope.getSnapshot().page.canNext)
        assert.equal(scope.getSnapshot().actions.next().accepted, true);
};
const hiddenCondition = {
    logicalOperator: 'and',
    conditions: [
        {
            id: 'hidden',
            type: 'singleCondition',
            setting: {
                type: 'is',
                fieldType: 'singleLineText',
                idOrName: { type: 'id', id: 'a' },
                value: 'never',
            },
        },
    ],
};

const trackSubscriptions = () => {
    let live = 0;
    const stops: (() => void)[] = [];
    const restores: (() => void)[] = [];
    return {
        count: () => live,
        wrap<S>(
            target: { subscribe(listener: (state: S) => void): () => void },
            after?: () => void
        ) {
            const original = target.subscribe;
            target.subscribe = (listener) => {
                const stop = original.call(target, listener);
                let active = true;
                live++;
                const trackedStop = () => {
                    if (!active) return;
                    active = false;
                    live--;
                    stop();
                };
                stops.push(trackedStop);
                after?.();
                return trackedStop;
            };
            restores.push(() => {
                target.subscribe = original;
            });
        },
        cleanup() {
            stops.forEach((stop) => stop());
            restores.forEach((restore) => restore());
        },
    };
};

describe('Form render composition scope', () => {
    for (const phase of ['configuration', 'getState'] as const) {
        for (const borrowed of [false, true]) {
            it(`releases only owned page subscriptions after initial ${phase} failure (borrowed=${borrowed})`, () => {
                const f = fixture(),
                    tracking = trackSubscriptions();
                let armed = false;
                const originalState = f.fields.controller.getState;
                const failure = Error('Constructor probe');
                let pages: ReturnType<typeof createFormPageOwner> | undefined;
                try {
                    tracking.wrap(f.fields.controller);
                    for (const id of ['a', 'b', 'c'])
                        tracking.wrap(
                            f.fields.field(id),
                            id === 'c'
                                ? () => {
                                      armed = true;
                                  }
                                : undefined
                        );
                    if (borrowed) pages = createFormPageOwner(f.options);
                    if (phase === 'getState')
                        f.fields.controller.getState = () => {
                            if (armed) throw failure;
                            return originalState();
                        };
                    const configurationRevision = () => {
                        if (phase === 'configuration' && armed) throw failure;
                        return 0;
                    };
                    assert.throws(
                        () =>
                            createFormRenderScope({
                                ...f.options,
                                pages,
                                configurationRevision,
                            }),
                        failure
                    );
                    assert.equal(tracking.count(), borrowed ? 4 : 0);
                    armed = false;
                    if (pages) {
                        assert.equal(pages.getSnapshot().status, 'ready');
                        assert.equal(
                            pages.next(pages.getSnapshot().revision).accepted,
                            true
                        );
                        pages.dispose();
                        assert.equal(tracking.count(), 0);
                    }
                    assert.equal(
                        f.fields.field('a').setValue('Still owned').accepted,
                        true
                    );
                    assert.equal(f.calls.length, 0);
                } finally {
                    armed = false;
                    f.fields.controller.getState = originalState;
                    pages?.dispose();
                    tracking.cleanup();
                    f.fields.destroy();
                }
            });
        }
    }
    it('uses the exact supplied owner and follows its configured field order without I/O', () => {
        const f = fixture();
        const pages = createFormPageOwner(f.options);
        const scope = createFormRenderScope({ ...f.options, pages });
        assert.equal(scope.pages, pages);
        assert.equal(scope.ownsPages, false);
        assert.deepEqual(ids(scope), ['a']);
        assert.equal(scope.getSnapshot().actions.next().accepted, true);
        assert.deepEqual(ids(scope), ['b']);
        assert.equal(scope.getSnapshot().actions.back().accepted, true);
        assert.deepEqual(ids(scope), ['a']);
        assert.equal(f.requests(), 0);
        assert.equal(f.calls.length, 0);
        scope.destroy();
        pages.dispose();
        f.fields.destroy();
    });
    it('destroy retires owned hosts while leaving supplied pages and bindings usable', () => {
        const f = fixture(),
            pages = createFormPageOwner(f.options);
        const scope = createFormRenderScope({ ...f.options, pages });
        const host = scope.getSnapshot().fields[0]!.host;
        scope.destroy();
        scope.destroy();
        assert.equal(host.getSnapshot().status, 'retired');
        assert.equal(scope.getSnapshot().retired, true);
        assert.equal(pages.getSnapshot().status, 'ready');
        assert.equal(pages.next(pages.getSnapshot().revision).accepted, true);
        assert.equal(
            f.fields.field('a').setValue('Still owned').accepted,
            true
        );
        pages.dispose();
        f.fields.destroy();
    });
    it('creates and disposes its own page owner without disposing caller bindings', () => {
        const f = fixture(),
            scope = createFormRenderScope(f.options);
        assert.equal(scope.ownsPages, true);
        scope.destroy();
        assert.equal(scope.pages.getSnapshot().status, 'retired');
        assert.equal(f.fields.field('a').setValue('Survives').accepted, true);
        assert.deepEqual(f.fields.controller.getState().draft?.data.untouched, {
            text: 'native',
        });
        f.fields.destroy();
    });
    it('rejects a foreign supplied page owner without destroying either caller resource', () => {
        const first = fixture(),
            second = fixture();
        const pages = createFormPageOwner(second.options);
        assert.throws(() => createFormRenderScope({ ...first.options, pages }));
        assert.equal(pages.getSnapshot().status, 'ready');
        assert.equal(pages.next(pages.getSnapshot().revision).accepted, true);
        assert.equal(first.fields.field('a').setValue('First').accepted, true);
        assert.equal(
            second.fields.field('a').setValue('Second').accepted,
            true
        );
        pages.dispose();
        first.fields.destroy();
        second.fields.destroy();
    });
    it('captures page revision in retained navigation actions after native edits', () => {
        const f = fixture(),
            scope = createFormRenderScope(f.options);
        const retained = scope.getSnapshot();
        assert.equal(f.fields.field('a').setValue('Edited').accepted, true);
        assert.deepEqual(retained.actions.next(), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert.equal(scope.getSnapshot().page.activePageIndex, 0);
        assert.equal(scope.getSnapshot().actions.next().accepted, true);
        assert.equal(f.calls.length, 0);
        scope.destroy();
        f.fields.destroy();
    });
    it('captures page revision in retained Submit and never dispatches stale native drafts', async () => {
        const f = fixture(),
            scope = createFormRenderScope(f.options);
        lastPage(scope);
        const retained = scope.getSnapshot();
        assert.equal(f.fields.field('c').setValue('Changed').accepted, true);
        await assert.rejects(retained.actions.submit());
        assert.equal(f.calls.length, 0);
        assert.equal(f.fields.field('c').getSnapshot().value, 'Changed');
        scope.destroy();
        f.fields.destroy();
    });
    it('excludes hidden fields, retains read-only native values, and saves the complete native record', async () => {
        const f = fixture((loaded) => {
            loaded.payload.publicFields.state.multiPageFormMode = 'one-page';
            loaded.payload.fieldIdsToSchemas.b!.miniExtConfig = {
                conditionalFields: hiddenCondition as never,
            };
            loaded.payload.fieldIdsToSchemas.c!.miniExtConfig = {
                readOnly: true,
            };
        });
        const scope = createFormRenderScope(f.options);
        assert.deepEqual(ids(scope), ['a', 'c']);
        assert.equal(f.fields.field('c').setValue('Forbidden').accepted, false);
        await scope.getSnapshot().actions.submit();
        assert.equal(f.calls.length, 1);
        assert.deepEqual(
            f.calls[0]!.formRecord.data,
            f.loaded.payload.formRecord.data
        );
        assert.deepEqual(f.calls[0]!.formFieldIdsWithUnsavedChanges, [
            'untouched',
        ]);
        scope.destroy();
        f.fields.destroy();
    });
    it('retains unavailable and blocked fields as generic hosts', () => {
        const f = fixture((loaded) => {
            loaded.payload.publicFields.state.multiPageFormMode = 'one-page';
            loaded.payload.formRecord.data.b = { text: 'Malformed text shape' };
            loaded.payload.fieldIdsToSchemas.c!.miniExtConfig = {
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'bad',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'multipleRecordLinks',
                                idOrName: { type: 'id', id: 'c' },
                                value: 'rec',
                            },
                        },
                    ],
                } as never,
            };
        });
        const scope = createFormRenderScope(f.options);
        assert.deepEqual(ids(scope), ['a', 'b', 'c']);
        assert.equal(
            scope.getSnapshot().fields[1]!.host.getSnapshot().status,
            'unavailable'
        );
        assert.equal(
            scope.getSnapshot().fields[2]!.host.getSnapshot().status,
            'blocked'
        );
        assert.equal(scope.getSnapshot().canSave, false);
        assert.equal(f.calls.length, 0);
        scope.destroy();
        f.fields.destroy();
    });
    it('reports a missing field through the retained page owner without fabricating a host', () => {
        const f = fixture((loaded) => {
            loaded.payload.publicFields.state.multiPageFormMode = 'one-page';
            delete loaded.payload.fieldIdsToSchemas.b;
        });
        const scope = createFormRenderScope(f.options);
        assert.deepEqual(ids(scope), ['a', 'c']);
        assert(
            scope.getSnapshot().page.problems.some((p) => p.fieldId === 'b')
        );
        assert.equal(scope.getSnapshot().canSave, false);
        scope.destroy();
        f.fields.destroy();
    });
    it('converges subscribers after eager reads and a reentrant native edit', () => {
        const f = fixture(),
            scope = createFormRenderScope(f.options);
        const eager = f.fields.field('b').subscribe(() => scope.getSnapshot());
        let armed = false;
        const deliveries: number[] = [];
        const first = scope.subscribe((state) => {
            if (armed && state.page.activePageIndex === 1) {
                armed = false;
                f.fields.field('b').setValue('');
            }
        });
        const second = scope.subscribe((state) =>
            deliveries.push(state.revision)
        );
        armed = true;
        scope.getSnapshot().actions.next();
        assert.equal(scope.getSnapshot().page.canNext, false);
        assert.equal(deliveries.at(-1), scope.getSnapshot().revision);
        eager();
        first();
        second();
        scope.destroy();
        f.fields.destroy();
    });
    it('delivers retirement to every subscriber when another subscriber destroys the scope', () => {
        const f = fixture(),
            scope = createFormRenderScope(f.options);
        let armed = false;
        scope.subscribe(() => {
            if (armed) {
                armed = false;
                scope.destroy();
            }
        });
        const states: boolean[] = [];
        scope.subscribe((state) => states.push(state.retired));
        armed = true;
        f.fields.field('a').setValue('Changed');
        assert.equal(states.at(-1), true);
        assert.equal(scope.getSnapshot().retired, true);
        assert.equal(f.fields.field('a').getSnapshot().value, 'Changed');
        f.fields.destroy();
    });
    for (const kind of [
        'owner',
        'session',
        'configuration',
        'current',
    ] as const) {
        it(`observed ${kind} ABA permanently retires the old scope and its actions`, () => {
            const f = fixture(),
                scope = createFormRenderScope(f.options),
                retained = scope.getSnapshot();
            const change = (away: boolean) => {
                if (kind === 'owner')
                    f.setOwner({
                        ownerId: away ? 'B' : 'A',
                        revision: away ? 1 : 0,
                    });
                if (kind === 'session')
                    f.client.setSession({ visitor: away ? 'B' : 'A' });
                if (kind === 'configuration') f.setConfig(away ? 1 : 0);
                if (kind === 'current') f.setCurrent(!away);
            };
            change(true);
            assert.equal(scope.getSnapshot().retired, true);
            change(false);
            assert.equal(scope.getSnapshot().retired, true);
            assert.deepEqual(ids(scope), []);
            assert.equal(retained.actions.next().accepted, false);
            assert.equal(f.calls.length, 0);
            scope.destroy();
            f.fields.destroy();
        });
    }
    it('reentrant current callback destruction cannot navigate or mutate a successor draft', () => {
        const f = fixture();
        let armed = false;
        let scope: ReturnType<typeof createFormRenderScope>;
        scope = createFormRenderScope({
            ...f.options,
            isCurrent: () => {
                if (armed) {
                    armed = false;
                    scope.destroy();
                    f.fields.controller.reset({
                        client: f.client,
                        loaded: successor,
                        saveOptions: formSaveOptions(),
                        getScope: () => ({ ownerId: 'B', revision: 1 }),
                    });
                }
                return true;
            },
        });
        const retained = scope.getSnapshot();
        const successor = structuredClone(f.loaded);
        successor.payload.formRecord.data.a = 'Successor';
        armed = true;
        assert.equal(retained.actions.next().accepted, false);
        assert.equal(scope.getSnapshot().retired, true);
        assert.equal(f.fields.controller.getState().draft?.data.a, 'Successor');
        assert.equal(f.calls.length, 0);
        scope.destroy();
        f.fields.destroy();
    });
    it('refuses configured submission review through the existing page authority', async () => {
        const f = fixture((loaded) => {
            loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
        });
        const scope = createFormRenderScope(f.options);
        assert.equal(scope.getSnapshot().page.status, 'blocked');
        assert.equal(scope.getSnapshot().canSave, false);
        await assert.rejects(scope.getSnapshot().actions.submit());
        assert.equal(f.calls.length, 0);
        assert.equal(f.requests(), 0);
        scope.destroy();
        f.fields.destroy();
    });
});
