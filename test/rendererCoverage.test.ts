import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createFormLinkedRendererBridge } from '../src/ui/formLinkedRenderer.js';
import { createFormFieldRendererHost } from '../src/ui/rendererHosts.js';
import type {
    LoadSelectedRecordsResult,
    MiniExtensionsClient,
    RuntimeSession,
    RuntimeFieldSchema,
} from '../src/runtime/types.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';
import { createPortalRenderScope } from '../src/ui/portalRenderScope.js';
import { createPortalListOwner } from '../src/portals/listOwner.js';
import { portalFixture, portalListPage, portalPage } from './portalFixtures.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, refuse) => {
        resolve = accept;
        reject = refuse;
    });
    return { promise, resolve, reject };
};
const linkedForm = () => {
    const loaded = loadedForm();
    loaded.payload.fieldIdsInForm.push('fld_link');
    loaded.payload.fieldIdsToSchemas.fld_link = {
        fieldType: 'multipleRecordLinks',
        airtableField: {
            id: 'fld_link',
            name: 'Linked records',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'tbl_linked',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
        },
        miniExtConfig: {},
    };
    loaded.payload.formRecord.data.fld_link = ['rec_selected'];
    return loaded;
};
const hydrated = (): LoadSelectedRecordsResult => ({
    tbl_linked: {
        airtableFields: [
            loadedForm().payload.fieldIdsToSchemas.fld_title.airtableField,
        ],
        recordIdsToAirtableRecords: {
            rec_selected: {
                id: 'rec_selected',
                fields: { fld_title: 'Accepted linked title' },
            },
        },
    },
});
function fixture(
    read: () => Promise<LoadSelectedRecordsResult>,
    loaded = linkedForm()
) {
    let session: RuntimeSession = { visitor: 'first' };
    const calls: AbortSignal[] = [];
    const client = {
        getSession: () => ({ ...session }),
        linkedRecords: {
            loadSelectedRecords: async (
                _input: unknown,
                options: { signal: AbortSignal }
            ) => {
                calls.push(options.signal);
                return read();
            },
        },
    } as unknown as MiniExtensionsClient;
    const fields = createFormFieldBindings({
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'form', revision: 0 }),
    });
    const bridge = createFormLinkedRendererBridge(fields, 'fld_link');
    return {
        fields,
        bridge,
        calls,
        replaceSession: () => {
            session = { visitor: 'second' };
        },
    };
}

function formProps(bridge: ReturnType<typeof createFormLinkedRendererBridge>) {
    const props = bridge.getProps();
    assert.equal(props?.source, 'form');
    if (props?.source !== 'form')
        throw new Error('Expected Form linked renderer');
    return props;
}

it('linked renderer exposes explicit hydration and forwards accepted native selection changes', async () => {
    const pending = deferred<LoadSelectedRecordsResult>();
    const f = fixture(() => pending.promise);
    let notifications = 0;
    const stop = f.bridge.subscribe(
        () => notifications++,
        () => true
    );
    try {
        assert.equal(f.calls.length, 0, 'mounting must not fetch');
        const initial = formProps(f.bridge);
        assert.equal(initial.source, 'form');
        assert.equal(initial.state.phase, 'idle');
        assert.deepEqual(initial.state.unresolvedSelectedIds, ['rec_selected']);
        const read = initial.readSelected();
        await Promise.resolve();
        assert.equal(f.calls.length, 1);
        assert.equal(formProps(f.bridge).state.pending, true);
        pending.resolve(hydrated());
        assert.equal(await read, true);
        assert.deepEqual(formProps(f.bridge).state.selectedRecords, [
            {
                id: 'rec_selected',
                fields: { fld_title: 'Accepted linked title' },
            },
        ]);
        const beforeEdit = notifications;
        assert.deepEqual(f.fields.field('fld_link').setValue([]), {
            accepted: true,
        });
        assert.ok(notifications > beforeEdit);
        assert.deepEqual(formProps(f.bridge).state.selectedRecords, []);
        stop();
        const afterStop = notifications;
        f.fields.controller.write('fld_link', ['rec_selected']);
        assert.equal(notifications, afterStop);
        assert.deepEqual(f.fields.field('fld_link').getSnapshot().value, [
            'rec_selected',
        ]);
        assert.equal(await initial.readSelected(), false);
    } finally {
        stop();
        f.fields.destroy();
    }
});

it('linked renderer reports read failure and requires an explicit successful retry', async () => {
    let attempts = 0;
    const f = fixture(async () => {
        if (++attempts === 1) throw new Error('Synthetic transport failure');
        return hydrated();
    });
    const stop = f.bridge.subscribe(
        () => {},
        () => true
    );
    try {
        assert.equal(await formProps(f.bridge).readSelected(), false);
        const failed = formProps(f.bridge);
        assert.equal(failed.state.phase, 'error');
        assert.equal(failed.state.pending, false);
        assert.equal(
            failed.state.error,
            'Selected linked records could not be loaded. Retry explicitly.'
        );
        assert.deepEqual(failed.state.selectedRecords, []);
        assert.equal(attempts, 1, 'rendering the error must not retry');
        assert.equal(await failed.readSelected(), true);
        assert.equal(formProps(f.bridge).state.phase, 'ready');
        assert.equal(formProps(f.bridge).state.error, null);
        assert.equal(attempts, 2);
    } finally {
        stop();
        f.fields.destroy();
    }
});

it('disposing a renderer during hydration refuses its completion but preserves the borrowed Form read', async () => {
    const pending = deferred<LoadSelectedRecordsResult>();
    const f = fixture(() => pending.promise);
    let notifications = 0;
    f.bridge.subscribe(
        () => notifications++,
        () => true
    );
    try {
        const props = formProps(f.bridge);
        const read = props.readSelected();
        await Promise.resolve();
        f.bridge.dispose();
        f.bridge.dispose();
        const afterDispose = notifications;
        assert.equal(
            f.calls[0].aborted,
            false,
            'presentation does not own the request'
        );
        pending.resolve(hydrated());
        assert.equal(await read, false);
        assert.equal(notifications, afterDispose);
        assert.equal(f.bridge.getProps(), undefined);
        assert.equal(
            f.fields.linkedRecords('fld_link').getSnapshot().phase,
            'ready'
        );
        assert.equal(await props.readSelected(), false);
        assert.equal(f.calls.length, 1);
    } finally {
        f.bridge.dispose();
        f.fields.destroy();
    }
});

it('session replacement during linked hydration prevents old records reaching the renderer', async () => {
    const pending = deferred<LoadSelectedRecordsResult>();
    const f = fixture(() => pending.promise);
    f.bridge.subscribe(
        () => {},
        () => true
    );
    try {
        const props = formProps(f.bridge);
        const read = props.readSelected();
        await Promise.resolve();
        f.replaceSession();
        assert.equal(f.bridge.getProps(), undefined);
        pending.resolve(hydrated());
        assert.equal(await read, false);
        assert.equal(await props.readSelected(), false);
        assert.equal(f.calls.length, 1);
    } finally {
        f.bridge.dispose();
        f.fields.destroy();
    }
});

it('linked renderer releases a synchronous initial subscription when its listener disposes it', () => {
    const f = fixture(async () => hydrated());
    let notifications = 0;
    f.bridge.subscribe(
        () => {
            notifications++;
            f.bridge.dispose();
        },
        () => true
    );
    try {
        assert.equal(notifications, 1);
        assert.equal(f.bridge.getProps(), undefined);
        f.fields.field('fld_link').setValue([]);
        assert.equal(notifications, 1);
        assert.equal(f.calls.length, 0);
    } finally {
        f.bridge.dispose();
        f.fields.destroy();
    }
});

it('linked renderer reacquires a replacement facet after Form reload and refuses retained callbacks', async () => {
    const f = fixture(async () => hydrated());
    f.bridge.subscribe(
        () => {},
        () => true
    );
    const replacement = deferred<ReturnType<typeof linkedForm>>();
    try {
        const old = formProps(f.bridge);
        const reload = f.fields.reload({
            dirty: 'discard',
            read: () => replacement.promise,
        });
        assert.equal(
            f.bridge.getProps(),
            undefined,
            'reload temporarily prohibits facet acquisition'
        );
        assert.equal(await old.readSelected(), false);
        replacement.resolve(linkedForm());
        assert.equal(await reload, true);
        f.bridge.refresh();
        const next = formProps(f.bridge);
        assert.equal(next.state.phase, 'idle');
        assert.equal(await old.readSelected(), false);
        assert.equal(await next.readSelected(), true);
        assert.equal(
            next.state.selectedRecords.length,
            0,
            'earlier presentation remains detached'
        );
        assert.equal(
            formProps(f.bridge).state.selectedRecords[0].id,
            'rec_selected'
        );
    } finally {
        f.bridge.dispose();
        f.fields.destroy();
    }
});

it('Form host keeps readonly and computed fields without exposing edit capabilities', () => {
    const f = fixture(async () => hydrated());
    try {
        for (const fieldId of ['fld_readonly', 'fld_computed']) {
            const host = createFormFieldRendererHost({
                fields: f.fields,
                fieldId,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            try {
                const state = host.getSnapshot();
                assert.equal(state.status, 'ready');
                if (state.status !== 'ready')
                    throw new Error('Expected ready field');
                assert.equal(state.fields[0].fieldId, fieldId);
                assert.equal(state.fields[0].capability.type, 'readonly');
                assert.equal('setValue' in state.fields[0].capability, false);
            } finally {
                host.dispose();
            }
        }
        assert.equal(f.calls.length, 0);
    } finally {
        f.fields.destroy();
    }
});

it('Portal render child requests lose authority when presentation is destroyed without retiring the borrowed owner', async () => {
    const api = portalFixture(async () =>
        portalListPage({
            recordIds: ['record_1'],
            tableIdsToLinkedTableStates: {
                table_children: {
                    airtableFields: [
                        loadedForm().payload.fieldIdsToSchemas.fld_title
                            .airtableField,
                    ],
                    recordIdsToAirtableRecords: {
                        record_1: {
                            id: 'record_1',
                            fields: { fld_title: 'Accepted row' },
                        },
                    },
                },
            },
        })
    );
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage(),
        portalFieldId: 'fld_children',
        criteria: {
            selectedCustomViewId: 'view_example',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: 'portal', revision: 0 }),
    });
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const read = { pagesToFetch: 1, refreshLoggedInPortalRecord: false };
    const child = {
        access: { type: 'edit' as const, recordId: 'record_1' },
        configuredChildExtensionId: 'extension_child',
    };
    try {
        assert.equal(await scope.getSnapshot().actions.load(read), true);
        const accepted = scope.getSnapshot();
        const request = accepted.actions.childFormRequest(child);
        assert.equal(request.isCurrent(), true);
        const ownerRequest = owner.childFormRequest(
            owner.getSnapshot().revision,
            child
        );
        scope.destroy();
        assert.equal(request.isCurrent(), false);
        assert.equal(
            ownerRequest.isCurrent(),
            true,
            'renderer does not own the caller’s detail request'
        );
        assert.throws(
            () => accepted.actions.childFormRequest(child),
            /current accepted Portal page/
        );
        assert.equal(await accepted.actions.more(read), false);
        assert.equal(accepted.actions.acceptCleanup(), false);
        assert.equal(accepted.actions.dismissCleanup(), false);
        assert.equal(
            accepted.actions.setField('fld_children', accepted.owner.criteria!),
            false
        );
        accepted.actions.cancel();
        assert.equal(owner.getSnapshot().phase, 'ready');
        assert.equal(api.calls.length, 1);
        assert.equal(api.mutations, 0);
    } finally {
        scope.destroy();
        owner.destroy();
    }
});

it('Portal render cancellation aborts the active read and late success cannot publish records', async () => {
    const pending = deferred<ReturnType<typeof portalListPage>>();
    const api = portalFixture(() => pending.promise);
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage(),
        portalFieldId: 'fld_children',
        criteria: {
            selectedCustomViewId: 'view_example',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: 'portal', revision: 0 }),
    });
    const scope = createPortalRenderScope({
        owner,
        client: api.client,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    try {
        const loading = scope.getSnapshot().actions.load({
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: false,
        });
        await Promise.resolve();
        assert.equal(api.calls.length, 1);
        const current = scope.getSnapshot();
        current.actions.cancel();
        assert.equal(api.calls[0].options?.signal?.aborted, true);
        pending.resolve(portalListPage({ recordIds: ['record_late'] }));
        assert.equal(await loading, false);
        assert.deepEqual(scope.getSnapshot().rows, []);
        assert.equal(scope.getSnapshot().records, null);
        assert.equal(scope.getSnapshot().retired, false);
        assert.equal(api.mutations, 0);
    } finally {
        scope.destroy();
        owner.destroy();
    }
});

it('Form renderer scalar and date adapters preserve partial input and reject edits from retired hosts', () => {
    const loaded = linkedForm();
    for (const [id, type, options, value] of [
        ['duration', 'duration', { durationFormat: 'h:mm:ss' }, 60],
        [
            'checkbox',
            'checkbox',
            { icon: 'check', color: 'greenBright' },
            false,
        ],
        [
            'date',
            'date',
            { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
            '2024-02-29',
        ],
    ] as const) {
        loaded.payload.fieldIdsInForm.push(id);
        loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: type,
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type, options },
            },
            miniExtConfig: {},
        } as RuntimeFieldSchema;
    }
    const f = fixture(async () => hydrated(), loaded);
    let current = true;
    const hosts = ['duration', 'checkbox', 'date'].map((fieldId) =>
        createFormFieldRendererHost({
            fields: f.fields,
            fieldId,
            isCurrent: () => current,
            configurationRevision: () => 0,
        })
    );
    const editable = (index: number) => {
        const snapshot = hosts[index].getSnapshot();
        if (
            snapshot.status !== 'ready' ||
            snapshot.fields[0].capability.type !== 'editable'
        )
            throw new Error('Expected editable host');
        return snapshot.fields[0].capability;
    };
    try {
        const scalar = (index: number) => {
            const capability = editable(index);
            if (!('scalar' in capability) || !capability.scalar)
                throw new Error('Expected scalar actions');
            return capability.scalar;
        };
        const dateActions = () => {
            const capability = editable(2);
            if (!('date' in capability) || !capability.date)
                throw new Error('Expected date actions');
            return capability.date;
        };
        const duration = scalar(0);
        assert.equal(duration.state.kind, 'duration');
        if (
            !('setFocused' in duration) ||
            typeof duration.setFocused !== 'function'
        )
            throw new Error('Expected duration focus action');
        assert.equal(duration.setFocused(true), true);
        assert.equal(duration.setInput('not a duration'), false);
        assert.equal(f.fields.field('duration').getSnapshot().value, 60);
        assert.equal(scalar(0).state.input, 'not a duration');
        assert.equal(duration.setInput('0:02:30'), true);
        assert.equal(f.fields.field('duration').getSnapshot().value, 150);
        assert.equal(duration.setFocused(false), true);
        const checkbox = scalar(1);
        assert.equal(checkbox.setChecked(true), true);
        assert.equal(f.fields.field('checkbox').getSnapshot().value, true);
        const date = dateActions();
        assert.equal(date.setInput('2024-'), false);
        assert.equal(f.fields.field('date').getSnapshot().value, '2024-02-29');
        assert.equal(dateActions().state.input, '2024-');
        assert.equal(date.setInput('2024-03-01'), true);
        assert.equal(f.fields.field('date').getSnapshot().value, '2024-03-01');
        assert.equal(date.clear(), true);
        assert.equal(f.fields.field('date').getSnapshot().value, null);
        current = false;
        assert.equal(duration.setInput('0:05:00'), false);
        assert.equal(duration.setFocused(true), false);
        assert.equal(checkbox.setChecked(false), false);
        assert.equal(date.setInput('2025-01-01'), false);
        assert.equal(date.clear(), false);
        assert.equal(f.fields.field('duration').getSnapshot().value, 150);
        assert.equal(f.fields.field('checkbox').getSnapshot().value, true);
        assert.equal(f.fields.field('date').getSnapshot().value, null);
        assert.equal(f.calls.length, 0);
    } finally {
        hosts.forEach((host) => host.dispose());
        f.fields.destroy();
    }
});

it('Form renderer selection adapters page explicitly, cancel late results and refuse stale selection actions', async () => {
    const f = fixture(async () => hydrated());
    const second = deferred<{
        options: { value: string; label: string }[];
        offset: null;
    }>();
    const calls: {
        searchTerm: string;
        offset: string | null;
        signal: AbortSignal;
    }[] = [];
    f.fields.setLinkedLoader('fld_link', async (request) => {
        calls.push(request);
        if (request.offset) return second.promise;
        return {
            options: [{ value: 'rec_choice', label: 'Choice' }],
            offset: 'next_page',
        };
    });
    let current = true;
    const host = createFormFieldRendererHost({
        fields: f.fields,
        fieldId: 'fld_link',
        isCurrent: () => current,
        configurationRevision: () => 0,
    });
    const selection = () => {
        const snapshot = host.getSnapshot();
        if (
            snapshot.status !== 'ready' ||
            snapshot.fields[0].capability.type !== 'editable'
        )
            throw new Error('Expected editable linked host');
        const capability = snapshot.fields[0].capability;
        if (!('selection' in capability))
            throw new Error('Expected selection capability');
        const model = capability.selection;
        if (!model) throw new Error('Expected selection adapter');
        return model;
    };
    try {
        const actions = selection();
        actions.setSearchInput('Choice');
        assert.equal(calls.length, 0, 'input alone must not dispatch');
        await actions.reload();
        assert.equal(calls.length, 1);
        assert.equal(calls[0].searchTerm, 'Choice');
        assert.equal(calls[0].offset, null);
        actions.clear();
        assert.deepEqual(f.fields.field('fld_link').getSnapshot().value, []);
        actions.toggle('rec_choice');
        assert.deepEqual(f.fields.field('fld_link').getSnapshot().value, [
            'rec_choice',
        ]);
        const paging = actions.loadMore();
        await Promise.resolve();
        assert.equal(calls.length, 2);
        assert.equal(calls[1].offset, 'next_page');
        actions.cancel();
        assert.equal(calls[1].signal.aborted, true);
        second.resolve({
            options: [{ value: 'rec_late', label: 'Late' }],
            offset: null,
        });
        await paging;
        assert.equal(selection().state.loading, false);
        assert.equal(
            selection().state.options.some(
                (option) => option.value === 'rec_late'
            ),
            false
        );
        current = false;
        actions.clear();
        actions.toggle('rec_choice');
        actions.setSearchInput('Foreign query');
        await actions.reload();
        await actions.loadMore();
        actions.cancel();
        assert.equal(calls.length, 2);
        assert.deepEqual(f.fields.field('fld_link').getSnapshot().value, [
            'rec_choice',
        ]);
        assert.equal(
            f.fields.field('fld_link').selection!.getState().searchTerm,
            'Choice'
        );
    } finally {
        host.dispose();
        f.fields.destroy();
    }
});
