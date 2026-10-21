import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type LoadExtensionInput,
    type ListPortalLinkedRecordsInput,
    type ListPortalLinkedRecordsResult,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type RuntimeConditionsDefinition,
    type SetKanbanCategoryInput,
    type SetKanbanCategoryResult,
    type UpdateGridCellInput,
} from '../src/runtime/index.js';
import { portalListPage, portalPage } from './portalFixtures.js';
import { formResult } from './runtimeFixtures.js';
import { RecoveryJournal, type RecoveryAttempt } from '../src/forms/index.js';

const root = resolve(process.cwd());
const driver: RuntimeAirtableField = {
    id: 'fld_eligible',
    name: 'Synthetic eligibility',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'checkbox',
        options: { color: 'greenBright', icon: 'check' },
    },
};
const condition = (): RuntimeConditionsDefinition => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic_condition',
            type: 'singleCondition',
            setting: {
                type: 'is',
                fieldType: 'checkbox',
                idOrName: { type: 'id', id: driver.id },
                value: true,
            },
        },
    ],
});
const conditionalPage = (eligible = false): PortalLoadedResult => {
    const page = portalPage({
        customViews: [
            { id: 'view_public', config: { name: 'Available requests' } },
            {
                id: 'view_conditional',
                config: {
                    name: 'Conditional requests',
                    customViewConditions: condition(),
                },
            },
        ],
    });
    page.payload.usersTableFields = [structuredClone(driver)];
    page.payload.formRecord.data[driver.id] = eligible;
    return page;
};
const linkedConfig = (page: PortalLoadedResult) => {
    const schema = page.payload.fieldIdsToSchemas.fld_children;
    assert.equal(schema.fieldType, 'multipleRecordLinks');
    if (
        schema.fieldType !== 'multipleRecordLinks' ||
        !schema.miniExtConfig ||
        !('customViews' in schema.miniExtConfig)
    )
        throw new Error('Missing synthetic linked configuration.');
    return schema.miniExtConfig;
};

let directory: string;
let sequence = 0;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-portal-view-conditions-'));
    await build({
        entryPoints: [join(root, 'examples/browser/src/portal.ts')],
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
        outfile: join(directory, 'portal.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const mount = async (
    test: TestContext,
    page = conditionalPage(),
    responses: {
        list?: ListPortalLinkedRecordsResult;
        child?: FormLoadedResult;
        kanban?: SetKanbanCategoryResult;
        refresh?: () => Promise<Response>;
    } = {}
) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        Option,
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    let destroy = () => {};
    test.after(async () => {
        destroy();
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
    });
    const { createPortalView } = await import(
        `${pathToFileURL(join(directory, 'portal.mjs')).href}?case=${++sequence}`
    );
    const reads: ListPortalLinkedRecordsInput[] = [];
    const writes: UpdateGridCellInput[] = [];
    const categoryWrites: SetKanbanCategoryInput[] = [];
    const childLoads: LoadExtensionInput[] = [];
    const children: { page: FormLoadedResult; isCurrent(): boolean }[] = [];
    const failures: unknown[] = [];
    const statuses: string[] = [];
    const journal = new RecoveryJournal();
    const attempts: RecoveryAttempt[] = [];
    let refreshes = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-view-owner' },
        fetch: async (input, init) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route') ?? url.pathname;
            if (route === 'fetchRecordsForLinkedTableOnPortal') {
                reads.push(JSON.parse(String(init?.body)));
                return new Response(
                    JSON.stringify(responses.list ?? portalListPage())
                );
            }
            if (route === 'fetchExtensionForEndUser' && responses.child) {
                childLoads.push(JSON.parse(String(init?.body)));
                return new Response(JSON.stringify(responses.child));
            }
            if (
                route === '/api/trpc/airtable.updateRecordKanbanCategory' &&
                responses.kanban
            ) {
                categoryWrites.push(JSON.parse(String(init?.body)));
                return new Response(
                    JSON.stringify({ result: { data: responses.kanban } })
                );
            }
            if (route === '/api/trpc/airtable.updatePortalRecord') {
                const update = JSON.parse(
                    String(init?.body)
                ) as UpdateGridCellInput;
                writes.push(update);
                const attempt = journal.unknown('synthetic-view-owner')[0];
                assert.ok(attempt);
                attempts.push(attempt);
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                record: {
                                    id: update.recordId,
                                    fields: {
                                        [update.recordFieldId]: update.value,
                                    },
                                },
                                auditTrail: null,
                                auditTrails: [],
                            },
                        },
                    })
                );
            }
            if (route === '/api/trpc/airtable.getUserRecord') {
                refreshes++;
                if (responses.refresh) return responses.refresh();
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                id: page.payload.formRecord.recordId,
                                fields: page.payload.formRecord.data,
                            },
                        },
                    })
                );
            }
            throw new Error(`Unexpected synthetic route: ${route}`);
        },
    });
    const actions: Promise<void>[] = [];
    const scope = { ownerId: 'synthetic-view-owner', revision: 0 };
    const view = createPortalView({
        page,
        client,
        recovery: { journal, owner: scope.ownerId },
        getScope: () => scope,
        run: (
            _description: string,
            action: (context: {
                client: typeof client;
                signal: AbortSignal;
                current(): boolean;
            }) => Promise<void>
        ) => {
            const owner = { ...scope };
            const pending = Promise.resolve()
                .then(() =>
                    action({
                        client,
                        signal: new AbortController().signal,
                        current: () =>
                            view.node.isConnected &&
                            scope.ownerId === owner.ownerId &&
                            scope.revision === owner.revision,
                    })
                )
                .catch((error: unknown) => failures.push(error));
            actions.push(pending.then(() => {}));
            return pending.then(() => {});
        },
        status: (message: string) => statuses.push(message),
        confirm: async () => false,
        openChild: (
            child: FormLoadedResult,
            _context: unknown,
            _parent: unknown,
            recovery?: { isCurrent(): boolean }
        ) => {
            if (!responses.child || !recovery)
                throw new Error('Unexpected synthetic child open.');
            children.push({ page: child, isCurrent: recovery.isCurrent });
        },
    });
    destroy = () => view.destroy();
    window.document.body.append(view.node);
    const node: HTMLElement = view.node;
    const select = node.querySelectorAll('select')[1]!;
    const first = Array.from(node.querySelectorAll('button')).find(
        (button) => button.textContent === 'Load records'
    )!;
    const offered = () =>
        Array.from(select.options).map((option) => option.value);
    const invokeRead = async (beforeSettle?: () => void) => {
        // Retained callbacks must be safe even when a caller dispatches on a
        // disabled control after an accepted parent or owner transition.
        const event = first.ownerDocument.createEvent('Event');
        event.initEvent('click', true, false);
        first.dispatchEvent(event);
        beforeSettle?.();
        await Promise.all(actions);
        assert.deepEqual(failures, []);
    };
    const settle = async () => {
        await Promise.all(actions);
        assert.deepEqual(failures, []);
    };
    return {
        page,
        view,
        node,
        select,
        first,
        reads,
        writes,
        categoryWrites,
        childLoads,
        children,
        scope,
        statuses,
        client,
        journal,
        attempts,
        failures,
        refreshes: () => refreshes,
        drain: () => Promise.all(actions),
        offered,
        invokeRead,
        settle,
    };
};

describe('actual browser starter Portal custom-view eligibility', () => {
    it('omits a condition-false view while retaining an unconditional neighbor', async (test) => {
        const app = await mount(test);
        assert.deepEqual(app.offered(), ['view_public']);
        await app.invokeRead();
        assert.equal(app.reads.length, 1);
        assert.equal(app.reads[0]?.selectedCustomViewId, 'view_public');
    });

    it('preserves true conditional views and their exact selected identity', async (test) => {
        const app = await mount(test, conditionalPage(true));
        assert.deepEqual(app.offered(), ['view_public', 'view_conditional']);
        app.select.value = 'view_conditional';
        app.select.dispatchEvent(
            new app.select.ownerDocument.defaultView!.Event('change')
        );
        await app.invokeRead();
        assert.equal(app.reads[0]?.selectedCustomViewId, 'view_conditional');
    });

    it('does not invent a legacy default when every configured view is hidden', async (test) => {
        const page = conditionalPage();
        linkedConfig(page).customViews?.shift();
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), []);
        assert.equal(app.first.disabled, true);
        await app.invokeRead();
        assert.equal(app.reads.length, 0);
        assert.match(app.node.textContent ?? '', /no available views/i);
    });

    it('keeps a genuinely unconfigured legacy view usable without condition metadata', async (test) => {
        const app = await mount(test, portalPage({ customViews: [] }));
        assert.deepEqual(app.offered(), ['']);
        await app.invokeRead();
        assert.equal(app.reads[0]?.selectedCustomViewId, '');
    });

    it('reports an unavailable view when its condition driver metadata is missing', async (test) => {
        const page = conditionalPage(true);
        page.payload.usersTableFields = [];
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), ['view_public']);
        assert.match(app.node.textContent ?? '', /view.*unavailable/i);
    });

    it('reports malformed conditions without exposing their configured view name', async (test) => {
        const page = conditionalPage(true);
        const view = linkedConfig(page).customViews?.[1];
        assert.ok(view?.config);
        view.config.customViewConditions = JSON.parse(
            '{"logicalOperator":"and","conditions":null}'
        );
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), ['view_public']);
        assert.match(app.node.textContent ?? '', /view.*unavailable/i);
        assert.equal(
            app.node.textContent?.includes('Conditional requests'),
            false
        );
    });

    it('reports unsupported computed drivers without dropping an unconditional neighbor', async (test) => {
        const page = conditionalPage(true);
        page.payload.usersTableFields[0]!.isComputed = true;
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), ['view_public']);
        assert.match(app.node.textContent ?? '', /view.*unavailable/i);
    });

    it('refuses duplicate configured view IDs before filtering a hidden duplicate', async (test) => {
        const page = conditionalPage();
        linkedConfig(page).customViews?.push({
            id: 'view_conditional',
            config: { name: 'Duplicate view' },
        });
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), ['view_public']);
        assert.match(app.node.textContent ?? '', /view.*unavailable/i);
        await app.invokeRead();
        assert.equal(app.reads[0]?.selectedCustomViewId, 'view_public');
    });

    it('blocks a Portal field whose own conditions are false before any list read', async (test) => {
        const page = conditionalPage();
        linkedConfig(page).conditionalFields = condition();
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), []);
        await app.invokeRead();
        assert.equal(app.reads.length, 0);
    });

    it('retires a now-hidden selected view after accepted parent data changes', async (test) => {
        const page = conditionalPage(true);
        linkedConfig(page).customViews?.shift();
        const app = await mount(test, page);
        await app.invokeRead();
        assert.equal(app.reads.length, 1);
        page.payload.formRecord.data[driver.id] = false;
        app.view.refreshRequired();
        assert.deepEqual(app.offered(), []);
        await app.invokeRead();
        assert.equal(app.reads.length, 1);
    });

    it('does not dispatch a queued read after its owner changes', async (test) => {
        const app = await mount(test, conditionalPage(true));
        await app.invokeRead(() => {
            app.scope.revision += 1;
        });
        assert.equal(app.reads.length, 0);
    });
});

const actionFixture = () => {
    const page = conditionalPage(true);
    linkedConfig(page).customViews?.shift();
    const field: RuntimeAirtableField = {
        id: 'fld_title',
        name: 'Synthetic request title',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    };
    const recordId = 'rec_synthetic_request';
    const list = portalListPage({
        recordIds: [recordId],
        customViewDetailFields: {
            fld_children: [
                {
                    fieldId: field.id,
                    fieldName: field.name,
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: {
                        idOrName: { type: 'id', id: field.id },
                        config: {
                            type: 'singleLineText',
                            config: { readOnly: false },
                        },
                    },
                    miniExtConfig: { readOnly: false },
                },
            ],
        },
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [field],
                recordIdsToAirtableRecords: {
                    [recordId]: {
                        id: recordId,
                        fields: { [field.id]: 'Original synthetic title' },
                    },
                },
            },
        },
    });
    const child = structuredClone(formResult);
    child.extensionId = 'extension_child';
    child.payload.formRecord = {
        type: 'edit',
        tableId: 'table_children',
        recordId,
        data: { [field.id]: 'Original synthetic title' },
    };
    child.payload.fieldIdsToSchemas[field.id] = {
        fieldType: 'singleLineText',
        airtableField: field,
        miniExtConfig: { readOnly: false },
    };
    return { page, list, child, recordId, fieldId: field.id };
};
const dispatch = (node: HTMLElement, type: string) => {
    const event = node.ownerDocument.createEvent('Event');
    event.initEvent(type, true, true);
    node.dispatchEvent(event);
};
const buttonNamed = (node: HTMLElement, title: string) => {
    const matches = Array.from(node.querySelectorAll('button')).filter(
        (button) => button.textContent === title
    );
    assert.equal(matches.length, 1, `Expected one actual ${title} control`);
    return matches[0]!;
};

const submitCell = (app: Awaited<ReturnType<typeof mount>>) => {
    dispatch(buttonNamed(app.node, 'Edit cell'), 'click');
    const input = app.node.querySelector<HTMLInputElement>(
        'input[data-field-id="fld_title"]'
    );
    assert.ok(input);
    input.value = 'Edited synthetic title';
    dispatch(input, 'input');
    const form = input.closest('form');
    assert.ok(form);
    dispatch(form, 'submit');
    return form;
};
const savedAttempt = (app: Awaited<ReturnType<typeof mount>>) => {
    assert.equal(app.attempts.length, 1);
    const attempt = app.attempts[0]!;
    assert.deepEqual(
        {
            recordId: attempt.recordId,
            fieldId: attempt.fieldId,
            scope: attempt.scope,
            operation: attempt.operation,
            loadVersion: attempt.loadVersion,
            outcome: attempt.outcome,
            flight: attempt.flight,
            acknowledgment: attempt.acknowledgment,
        },
        {
            recordId: 'rec_synthetic_request',
            fieldId: 'fld_title',
            scope: {
                owner: 'synthetic-view-owner',
                parentFieldId: 'fld_children',
                tableId: 'table_children',
                childExtensionId: '',
                context: 'modal',
            },
            operation: 'save',
            loadVersion: 0,
            outcome: 'saved',
            flight: false,
            acknowledgment: 'none',
        }
    );
    assert.deepEqual(app.journal.unknown('synthetic-view-owner'), []);
    return attempt;
};

const kanbanActionFixture = () => {
    const fixture = actionFixture();
    const config = linkedConfig(fixture.page);
    config.layout = 'kanban';
    config.kanbanCategoryField = 'fld_status';
    const category: RuntimeAirtableField = {
        id: 'fld_status',
        name: 'Synthetic status',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'singleSelect',
            options: {
                choices: [
                    { id: 'sel_pending', name: 'Pending', color: 'blueBright' },
                    { id: 'sel_done', name: 'Done', color: 'greenBright' },
                ],
            },
        },
    };
    const table = fixture.list.tableIdsToLinkedTableStates.table_children!;
    table.airtableFields.push(category);
    table.recordIdsToAirtableRecords[fixture.recordId]!.fields.fld_status =
        'Pending';
    return fixture;
};

describe('Portal mutation parent refresh identity', () => {
    for (const operation of ['cell Save', 'Kanban move'] as const)
        for (const refused of [
            {
                name: 'another parent',
                record: () => ({
                    id: 'record_foreign',
                    fields: {
                        [driver.id]: false,
                        fld_prefill: 'FOREIGN_PARENT_REFRESH',
                    },
                }),
            },
            {
                name: 'a missing parent identity',
                record: () => ({ fields: { [driver.id]: false } }),
            },
            {
                name: 'missing parent fields',
                record: (id: string) => ({ id }),
            },
            {
                name: 'null parent fields',
                record: (id: string) => ({ id, fields: null }),
            },
            {
                name: 'array parent fields',
                record: (id: string) => ({ id, fields: [] }),
            },
            { name: 'a missing parent record', record: () => null },
        ])
            it(`refuses ${refused.name} after an acknowledged ${operation}`, async (test) => {
                const fixture =
                    operation === 'cell Save'
                        ? actionFixture()
                        : kanbanActionFixture();
                fixture.list.airtableOffset = 'synthetic-next-page';
                const parent = structuredClone(
                    fixture.page.payload.formRecord.data
                );
                const record = refused.record(
                    fixture.page.payload.formRecord.recordId
                );
                const app = await mount(test, fixture.page, {
                    ...fixture,
                    refresh: async () =>
                        new Response(
                            JSON.stringify({ result: { data: record } })
                        ),
                    // Deliberately malformed transport data must not gain parent authority.
                    kanban: {
                        type: 'logged-in',
                        loggedInUserRecord: record,
                    } as SetKanbanCategoryResult,
                });
                await app.invokeRead();
                let category: HTMLSelectElement | null = null;
                if (operation === 'cell Save') submitCell(app);
                else {
                    category = app.node.querySelector<HTMLSelectElement>(
                        `select[aria-label="Category for ${fixture.recordId}"]`
                    );
                    assert.ok(category);
                    category.value = 'Done';
                    dispatch(category, 'change');
                    dispatch(buttonNamed(app.node, 'Move category'), 'click');
                }
                await app.settle();
                assert.equal(
                    app.writes.length,
                    operation === 'cell Save' ? 1 : 0
                );
                assert.equal(
                    app.categoryWrites.length,
                    operation === 'Kanban move' ? 1 : 0
                );
                if (operation === 'cell Save') savedAttempt(app);
                assert.deepEqual(fixture.page.payload.formRecord.data, parent);
                assert.deepEqual(app.offered(), ['view_conditional']);
                assert.match(
                    app.statuses.at(-1) ?? '',
                    /not refreshed.*Reload/
                );
                assert.equal(
                    app.node.textContent?.includes('FOREIGN_PARENT_REFRESH'),
                    false
                );
                if (category) {
                    assert.equal(category.isConnected, true);
                    assert.equal(category.value, 'Done');
                }
                for (const title of [
                    'Load records',
                    'Create record',
                    'Next page',
                ])
                    dispatch(buttonNamed(app.node, title), 'click');
                await app.settle();
                assert.equal(app.reads.length, 1);
                assert.equal(app.childLoads.length, 0);
                assert.equal(
                    app.writes.length,
                    operation === 'cell Save' ? 1 : 0
                );
                assert.equal(
                    app.categoryWrites.length,
                    operation === 'Kanban move' ? 1 : 0
                );
            });

    const matchingFields: Extract<
        SetKanbanCategoryResult,
        { type: 'logged-in' }
    >['loggedInUserRecord']['fields'][] = [
        {},
        {
            [driver.id]: true,
            fld_prefill: 'prefill_Title=Refreshed',
            fld_zero: 0,
            fld_false: false,
            fld_empty: null,
            fld_array: ['native-a', 'native-b'],
        },
    ];
    for (const operation of ['cell Save', 'Kanban move'] as const)
        for (const fields of matchingFields)
            it(`accepts matching ${Object.keys(fields).length === 0 ? 'sparse' : 'native'} parent fields after ${operation}`, async (test) => {
                const fixture =
                    operation === 'cell Save'
                        ? actionFixture()
                        : kanbanActionFixture();
                const record = {
                    id: fixture.page.payload.formRecord.recordId,
                    fields,
                };
                const app = await mount(test, fixture.page, {
                    ...fixture,
                    refresh: async () =>
                        new Response(
                            JSON.stringify({ result: { data: record } })
                        ),
                    kanban: {
                        type: 'logged-in',
                        loggedInUserRecord: record,
                    },
                });
                await app.invokeRead();
                if (operation === 'cell Save') submitCell(app);
                else {
                    const category = app.node.querySelector<HTMLSelectElement>(
                        `select[aria-label="Category for ${fixture.recordId}"]`
                    );
                    assert.ok(category);
                    category.value = 'Done';
                    dispatch(category, 'change');
                    dispatch(buttonNamed(app.node, 'Move category'), 'click');
                }
                await app.settle();
                assert.deepEqual(fixture.page.payload.formRecord.data, fields);
                assert.match(
                    app.statuses.at(-1) ?? '',
                    operation === 'cell Save'
                        ? /Cell saved and Portal user refreshed/
                        : /Category moved\. Load records/
                );
                assert.deepEqual(
                    app.offered(),
                    Object.keys(fields).length === 0 ? [] : ['view_conditional']
                );
                assert.equal(app.reads.length, 1);
                if (Object.keys(fields).length !== 0) {
                    await app.invokeRead();
                    assert.equal(app.reads.length, 2);
                }
                assert.equal(
                    app.writes.length,
                    operation === 'cell Save' ? 1 : 0
                );
                assert.equal(
                    app.categoryWrites.length,
                    operation === 'Kanban move' ? 1 : 0
                );
                if (operation === 'cell Save') savedAttempt(app);
            });
});

describe('Portal cell Save parent refresh recovery', () => {
    it('keeps a completed cell Save behind Reload when the parent refresh returns null', async (test) => {
        const fixture = actionFixture();
        fixture.list.airtableOffset = 'synthetic-next-page';
        const parent = structuredClone(fixture.page.payload.formRecord.data);
        const app = await mount(test, fixture.page, {
            ...fixture,
            refresh: async () =>
                new Response(JSON.stringify({ result: { data: null } })),
        });
        await app.invokeRead();
        assert.equal(buttonNamed(app.node, 'Create record').disabled, false);
        assert.equal(buttonNamed(app.node, 'Next page').disabled, false);
        const originalForm = submitCell(app);
        await app.settle();
        const attempt = savedAttempt(app);
        assert.equal(app.writes.length, 1);
        assert.deepEqual(app.writes[0], {
            portalExtensionAccessToken:
                fixture.page.payload.extensionAccessToken,
            portalFieldId: 'fld_children',
            recordFieldId: fixture.fieldId,
            recordId: fixture.recordId,
            selectedCustomViewId: 'view_conditional',
            value: 'Edited synthetic title',
        });
        assert.equal(app.refreshes(), 1);
        assert.deepEqual(fixture.page.payload.formRecord.data, parent);
        assert.match(
            app.statuses.at(-1) ?? '',
            /Cell saved, but.*not refreshed.*Reload/
        );
        assert.equal(
            app.statuses.some((message) =>
                message.includes('and Portal user refreshed')
            ),
            false
        );
        assert.equal(
            app.node.querySelector('input[data-field-id="fld_title"]'),
            null
        );
        assert.match(app.node.textContent ?? '', /Edited synthetic title/);
        dispatch(originalForm, 'submit');
        for (const title of ['Load records', 'Create record', 'Next page'])
            dispatch(buttonNamed(app.node, title), 'click');
        await app.settle();
        assert.equal(app.reads.length, 1);
        assert.equal(app.childLoads.length, 0);
        submitCell(app);
        await app.drain();
        assert.equal(app.failures.length, 1);
        assert.match(
            String(app.failures[0]),
            /Reload the Portal before saving another cell/
        );
        assert.equal(app.writes.length, 1);
        assert.equal(app.refreshes(), 1);
        assert.equal(savedAttempt(app), attempt);
        // The host accepts fresh parent data only after an explicit Portal Reload.
        fixture.page.payload.formRecord.data = {
            ...parent,
            fld_prefill: 'prefill_Title=Reloaded',
        };
        app.view.refreshRequired();
        dispatch(app.first, 'click');
        await app.drain();
        assert.equal(app.reads.length, 2);
        assert.equal(
            app.failures.length,
            1,
            'The explicit fresh Load must succeed.'
        );
        assert.equal(buttonNamed(app.node, 'Create record').disabled, false);
        assert.equal(buttonNamed(app.node, 'Next page').disabled, false);
        assert.equal(
            app.writes.length,
            1,
            'Reload must never replay the completed Save.'
        );
        assert.equal(savedAttempt(app), attempt);
    });

    it('adopts a matching parent and permits explicit Load before Create or Next', async (test) => {
        const fixture = actionFixture();
        fixture.list.airtableOffset = 'synthetic-next-page';
        const fields = {
            ...fixture.page.payload.formRecord.data,
            fld_prefill: 'prefill_Title=Refreshed',
        };
        const app = await mount(test, fixture.page, {
            ...fixture,
            refresh: async () =>
                new Response(
                    JSON.stringify({
                        result: { data: { id: 'record_parent', fields } },
                    })
                ),
        });
        await app.invokeRead();
        submitCell(app);
        await app.settle();
        const attempt = savedAttempt(app);
        assert.deepEqual(fixture.page.payload.formRecord.data, fields);
        assert.match(
            app.statuses.at(-1) ?? '',
            /Cell saved and Portal user refreshed/
        );
        assert.equal(buttonNamed(app.node, 'Create record').disabled, true);
        assert.equal(buttonNamed(app.node, 'Next page').disabled, true);
        dispatch(buttonNamed(app.node, 'Create record'), 'click');
        dispatch(buttonNamed(app.node, 'Next page'), 'click');
        await app.settle();
        assert.equal(app.childLoads.length, 0);
        assert.equal(app.reads.length, 1);
        await app.invokeRead();
        assert.equal(app.reads[1]?.refreshLoggedInPortalRecord, true);
        assert.equal(buttonNamed(app.node, 'Create record').disabled, false);
        assert.equal(buttonNamed(app.node, 'Next page').disabled, false);
        assert.equal(app.writes.length, 1);
        assert.equal(app.refreshes(), 1);
        assert.equal(savedAttempt(app), attempt);
    });

    it('preserves the accepted Save and Reload gate when only the parent refresh fails', async (test) => {
        const fixture = actionFixture();
        const parent = structuredClone(fixture.page.payload.formRecord.data);
        const app = await mount(test, fixture.page, {
            ...fixture,
            refresh: async () => {
                throw new Error('Synthetic refresh transport failure');
            },
        });
        await app.invokeRead();
        const originalForm = submitCell(app);
        await app.drain();
        const attempt = savedAttempt(app);
        assert.equal(app.failures.length, 1);
        assert.deepEqual(fixture.page.payload.formRecord.data, parent);
        for (const title of ['Load records', 'Create record', 'Next page'])
            dispatch(buttonNamed(app.node, title), 'click');
        dispatch(originalForm, 'submit');
        await app.drain();
        assert.equal(app.writes.length, 1);
        assert.equal(app.reads.length, 1);
        assert.equal(app.refreshes(), 1);
        assert.equal(app.childLoads.length, 0);
        assert.equal(savedAttempt(app), attempt);
    });

    for (const retirement of ['owner', 'session'])
        it(`ignores a late parent refresh after ${retirement} retirement`, async (test) => {
            const fixture = actionFixture();
            const parent = structuredClone(
                fixture.page.payload.formRecord.data
            );
            let release!: (response: Response) => void;
            const held = new Promise<Response>((resolve) => {
                release = resolve;
            });
            let started!: () => void;
            const refreshing = new Promise<void>((resolve) => {
                started = resolve;
            });
            const app = await mount(test, fixture.page, {
                ...fixture,
                refresh: async () => {
                    started();
                    return held;
                },
            });
            await app.invokeRead();
            submitCell(app);
            await refreshing;
            const attempt = savedAttempt(app);
            const messages = [...app.statuses];
            if (retirement === 'owner')
                app.scope.ownerId = 'synthetic-successor';
            else {
                app.scope.revision++;
                app.client.setSession({ visitor: 'synthetic-successor' });
            }
            app.view.retireCollection();
            const retainedDOM = app.node.outerHTML;
            const successor = app.node.ownerDocument.createElement('section');
            successor.textContent = 'Current successor Portal';
            app.node.ownerDocument.body.append(successor);
            release(
                new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                id: 'record_parent',
                                fields: {
                                    ...parent,
                                    fld_prefill: 'LATE_REFRESH_MUST_NOT_ADOPT',
                                },
                            },
                        },
                    })
                )
            );
            await app.settle();
            assert.deepEqual(fixture.page.payload.formRecord.data, parent);
            assert.deepEqual(app.statuses, messages);
            assert.equal(app.node.outerHTML, retainedDOM);
            assert.equal(successor.textContent, 'Current successor Portal');
            assert.equal(app.writes.length, 1);
            assert.equal(app.refreshes(), 1);
            assert.equal(app.reads.length, 1);
            assert.equal(savedAttempt(app), attempt);
        });
});

describe('Portal eligibility compatibility and retained actions', () => {
    it('preserves the absent-list legacy positive control', async (test) => {
        const page = portalPage();
        delete linkedConfig(page).customViews;
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), ['']);
        await app.invokeRead();
        assert.equal(app.reads[0]?.selectedCustomViewId, '');
    });

    it('reports a defined null view list as unavailable without dispatch', async (test) => {
        const page = portalPage();
        linkedConfig(page).customViews = JSON.parse('null');
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), []);
        assert.match(app.node.textContent ?? '', /view.*unavailable/i);
        await app.invokeRead();
        assert.equal(app.reads.length, 0);
    });

    it('re-evaluates an initially hidden view after accepted parent refresh', async (test) => {
        const page = conditionalPage();
        linkedConfig(page).customViews?.shift();
        const app = await mount(test, page);
        assert.deepEqual(app.offered(), []);
        page.payload.formRecord.data[driver.id] = true;
        app.view.refreshRequired();
        assert.deepEqual(app.offered(), ['view_conditional']);
        assert.equal(app.first.disabled, false);
        await app.invokeRead();
        assert.equal(app.reads.length, 1);
        assert.equal(app.reads[0]?.selectedCustomViewId, 'view_conditional');
    });

    it('allows an ordinary inline edit in an eligible conditional view', async (test) => {
        const fixture = actionFixture();
        const app = await mount(test, fixture.page, fixture);
        await app.invokeRead();
        dispatch(buttonNamed(app.node, 'Edit cell'), 'click');
        const input = app.node.querySelector<HTMLInputElement>(
            'input[data-field-id="fld_title"]'
        );
        assert.ok(input);
        input.value = 'Edited synthetic title';
        dispatch(input, 'input');
        const form = input.closest('form');
        assert.ok(form);
        dispatch(form, 'submit');
        await app.settle();
        assert.equal(app.writes.length, 1);
        assert.deepEqual(app.writes[0], {
            portalExtensionAccessToken:
                fixture.page.payload.extensionAccessToken,
            portalFieldId: 'fld_children',
            recordFieldId: fixture.fieldId,
            recordId: fixture.recordId,
            selectedCustomViewId: 'view_conditional',
            value: 'Edited synthetic title',
        });
    });

    it('revokes a retained inline Save after the selected view becomes hidden', async (test) => {
        const fixture = actionFixture();
        const app = await mount(test, fixture.page, fixture);
        await app.invokeRead();
        dispatch(buttonNamed(app.node, 'Edit cell'), 'click');
        const input = app.node.querySelector<HTMLInputElement>(
            'input[data-field-id="fld_title"]'
        );
        assert.ok(input);
        input.value = 'Must remain unsent';
        dispatch(input, 'input');
        const form = input.closest('form');
        assert.ok(form);
        fixture.page.payload.formRecord.data[driver.id] = false;
        app.view.refreshRequired();
        dispatch(form, 'submit');
        await app.settle();
        assert.equal(app.writes.length, 0);
        assert.deepEqual(app.offered(), []);
    });

    it('opens an eligible conditional child and revokes its handed-off currentness after refresh', async (test) => {
        const fixture = actionFixture();
        const app = await mount(test, fixture.page, fixture);
        await app.invokeRead();
        const open = buttonNamed(app.node, 'Open Form');
        dispatch(open, 'click');
        await app.settle();
        assert.equal(app.childLoads.length, 1);
        assert.equal(app.children.length, 1);
        assert.equal(app.children[0]?.page.extensionId, 'extension_child');
        assert.equal(app.children[0]?.isCurrent(), true);
        fixture.page.payload.formRecord.data[driver.id] = false;
        app.view.refreshRequired();
        assert.equal(app.children[0]?.isCurrent(), false);
        dispatch(open, 'click');
        await app.settle();
        assert.equal(app.childLoads.length, 1);
        assert.equal(app.children.length, 1);
    });

    it('keeps conditional Kanban choices across an owner round trip and retires actions when the accepted move hides the view', async (test) => {
        const fixture = actionFixture();
        const config = linkedConfig(fixture.page);
        config.layout = 'kanban';
        config.kanbanCategoryField = 'fld_status';
        const categoryField: RuntimeAirtableField = {
            id: 'fld_status',
            name: 'Synthetic status',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'singleSelect',
                options: {
                    choices: [
                        {
                            id: 'sel_pending',
                            name: 'Pending',
                            color: 'blueBright',
                        },
                        { id: 'sel_done', name: 'Done', color: 'greenBright' },
                    ],
                },
            },
        };
        const table = fixture.list.tableIdsToLinkedTableStates.table_children;
        assert.ok(table);
        table.airtableFields.push(categoryField);
        table.recordIdsToAirtableRecords[fixture.recordId]!.fields.fld_status =
            'Pending';
        const app = await mount(test, fixture.page, {
            ...fixture,
            kanban: {
                type: 'logged-in',
                loggedInUserRecord: {
                    id: fixture.page.payload.formRecord.recordId,
                    fields: {
                        fld_prefill: 'prefill_Title=Example',
                        [driver.id]: false,
                    },
                },
            },
        });
        await app.invokeRead();
        const category = app.node.querySelector<HTMLSelectElement>(
            `select[aria-label="Category for ${fixture.recordId}"]`
        );
        assert.ok(category);
        assert.equal(category.value, 'Pending');
        category.value = 'Done';
        dispatch(category, 'change');
        const move = buttonNamed(app.node, 'Move category');
        const open = buttonNamed(app.node, 'Open Form');
        const host = app.node.parentElement;
        assert.ok(host);
        const firstOwner = app.scope.ownerId;
        app.scope.ownerId = 'synthetic-other-owner';
        app.scope.revision += 1;
        app.view.retireCollection();
        app.node.remove();
        app.scope.ownerId = firstOwner;
        app.scope.revision += 1;
        app.view.retireCollection();
        host.append(app.node);
        assert.equal(
            app.node.querySelector(
                `select[aria-label="Category for ${fixture.recordId}"]`
            ),
            category
        );
        assert.equal(category.value, 'Done');
        assert.equal(app.reads.length, 1);
        assert.equal(app.categoryWrites.length, 0);
        dispatch(move, 'click');
        await app.settle();
        assert.deepEqual(app.categoryWrites, [
            {
                extensionAccessToken: fixture.page.payload.extensionAccessToken,
                portalFieldId: 'fld_children',
                recordId: fixture.recordId,
                categoryFieldValue: 'Done',
                selectedCustomViewId: 'view_conditional',
            },
        ]);
        assert.deepEqual(app.offered(), []);
        dispatch(move, 'click');
        dispatch(open, 'click');
        await app.settle();
        assert.equal(app.categoryWrites.length, 1);
        assert.equal(app.childLoads.length, 0);
        assert.equal(
            app.reads.length,
            1,
            'The accepted move does not automatically reread.'
        );
    });
});
