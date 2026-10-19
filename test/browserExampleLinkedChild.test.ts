import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    createFormFieldBindings,
    type FormFieldBindings,
} from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    FormLoadedResult,
    LoadExtensionInput,
    LoadSelectedRecordsInput,
    RuntimeConditionsDefinition,
    SaveFormInput,
    SaveFormResult,
} from '../src/runtime/types.js';
import {
    childForm,
    childSaved,
    pagedChildForm,
    parentForm,
    validationError,
} from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

type Element = InstanceType<Window['HTMLElement']>;
// The bundle executes the shipped helper. Describe its adapter boundary here so
// compiling the tests does not resolve example imports through a prior dist build.
type PanelModule = {
    createLinkedChildPanel(options: {
        fields: FormFieldBindings;
        fieldId: string;
        recovery: { journal: RecoveryJournal; loadVersion: number };
        isCurrent(): boolean;
        isVisible?(): boolean;
        canStart(): boolean;
        request(
            description: string,
            work: (signal: AbortSignal, current: () => boolean) => Promise<void>
        ): void;
        changed(): void;
        status(message: string, error?: boolean): void;
    }): {
        node: Element;
        refresh(): void;
        blocksParent(): boolean;
        destroy(): void;
        close(): void;
    };
};
const root = resolve(process.cwd());
const fieldId = 'fld_children_a';
let directory: string;
let moduleRevision = 0;
let panelModule: PanelModule;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-linked-child-'));
    const alias = {
        '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
        '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
        '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
        '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
        '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
        '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
    };
    for (const name of ['main', 'linkedChildPanel'])
        await build({
            entryPoints: [join(root, `examples/browser/src/${name}.ts`)],
            alias,
            bundle: true,
            platform: 'node',
            format: 'esm',
            outfile: join(directory, `${name}.mjs`),
            logLevel: 'silent',
        });
    panelModule = (await import(
        pathToFileURL(join(directory, 'linkedChildPanel.mjs')).href
    )) as PanelModule;
});
after(async () => rm(directory, { recursive: true, force: true }));

const settle = () => new Promise<void>((done) => setImmediate(done));
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 120; turn++) {
        if (predicate()) return;
        await settle();
    }
    assert.fail('Actual starter linked-child action did not settle.');
};
const buttons = (node: Element, title: string) =>
    Array.from(node.querySelectorAll('button')).filter(
        (candidate) => candidate.textContent?.trim() === title
    );
const button = (node: Element, title: string) => {
    const matches = buttons(node, title);
    assert.equal(matches.length, 1, `Expected one ${title} button.`);
    return matches[0]!;
};
const fire = (window: Window, node: Element) =>
    node.dispatchEvent(new window.Event('click', { bubbles: true }));
const edit = (window: Window, node: Element, id: string, value: string) => {
    const control = node.querySelector(`[data-field-id="${id}"]`);
    assert.ok(control instanceof window.HTMLInputElement);
    control.value = value;
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    return control;
};
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const configuredParent = (nested = false) => {
    const page = parentForm('edit');
    page.payload.hasParentExtension = nested;
    const linked = page.payload.fieldIdsToSchemas[fieldId]!;
    assert.ok(linked.fieldType === 'multipleRecordLinks');
    linked.miniExtConfig = {
        ...linked.miniExtConfig,
        recordFinderMode: 'hide-finder',
    };
    page.payload.fieldIdsInForm = ['fld_title', fieldId];
    page.payload.fieldNamesToSchemas = Object.fromEntries(
        Object.values(page.payload.fieldIdsToSchemas).map((schema) => [
            schema.airtableField.name,
            schema,
        ])
    );
    return page;
};
const selectedRecords = (parent: FormLoadedResult) => ({
    tbl_child: {
        airtableFields: [
            parent.payload.fieldIdsToSchemas.fld_title!.airtableField,
        ],
        recordIdsToAirtableRecords: Object.fromEntries(
            ['rec_existing', 'rec_sibling'].map((id) => [
                id,
                { id, fields: { fld_title: `Synthetic ${id}` } },
            ])
        ),
    },
});
const loadedChild = (input: LoadExtensionInput, paged = false) => {
    assert.ok('childExtensionInfo' in input);
    const access = input.childExtensionInfo.accessType;
    const page = paged ? pagedChildForm() : childForm('edit');
    if (access.type === 'edit')
        page.payload.formRecord = {
            type: 'edit',
            tableId: 'tbl_child',
            recordId: access.childExtensionRecordId,
            data: structuredClone(page.payload.formRecord.data),
        };
    return page;
};
const savedChild = (input: SaveFormInput): SaveFormResult => {
    const result = childSaved('edit');
    result.record.fields = structuredClone(input.formRecord.data);
    if (input.formRecord.type === 'edit')
        result.record.id = input.formRecord.recordId;
    const context = result.context;
    assert.ok(context.type === 'modal');
    context.newTableIdsToLinkedTableStates.tbl_child!.recordIdsToAirtableRecords =
        { [result.record.id]: structuredClone(result.record) };
    return result;
};

const environment = async (
    test: TestContext,
    fetch: typeof globalThis.fetch,
    fullStarter = false
) => {
    const window = new Window({
        url: 'https://app.example.test/',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    if (fullStarter)
        window.document.write(
            (
                await readFile(
                    join(root, 'examples/browser/index.html'),
                    'utf8'
                )
            ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
        );
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
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        Option,
        fetch,
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous)
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        await window.happyDOM.close();
    });
    return window;
};

const fixture = async (
    test: TestContext,
    options: {
        parent?: FormLoadedResult;
        paged?: boolean;
        load?: (input: LoadExtensionInput) => Promise<FormLoadedResult>;
        save?: (input: SaveFormInput) => Promise<SaveFormResult>;
    } = {}
) => {
    const window = await environment(test, async () => {
        assert.fail('Linked-child fixture must never use real transport.');
    });
    const parent = options.parent ?? configuredParent();
    const calls = {
        loads: [] as LoadExtensionInput[],
        reads: [] as LoadSelectedRecordsInput[],
        saves: [] as SaveFormInput[],
        errors: [] as unknown[],
        changed: 0,
    };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-A' },
        fetch: async () => {
            assert.fail('Linked-child fixture must never use real transport.');
        },
    });
    client.loadExtension = async (input) => {
        calls.loads.push(structuredClone(input));
        return options.load
            ? options.load(input)
            : loadedChild(input, options.paged);
    };
    client.forms.save = async (input) => {
        calls.saves.push(structuredClone(input));
        return options.save ? options.save(input) : savedChild(input);
    };
    client.linkedRecords.loadSelectedRecords = async (input) => {
        calls.reads.push(structuredClone(input));
        return selectedRecords(parent);
    };
    let scope = { ownerId: 'synthetic-starter', revision: 0 };
    let configuration = 0;
    let current = true;
    let canStart = true;
    let visible = true;
    const fields = createFormFieldBindings({
        loaded: parent,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => scope,
        configurationRevision: () => configuration,
    });
    const journal = new RecoveryJournal();
    const owner = fields.linkedChild(fieldId, { journal, loadVersion: 1 });
    const panel = panelModule.createLinkedChildPanel({
        fields,
        fieldId,
        recovery: { journal, loadVersion: 1 },
        isCurrent: () => current,
        isVisible: () => visible,
        canStart: () => canStart,
        request: (_description, work) => {
            const abort = new AbortController();
            void work(abort.signal, () => current).catch((error) => {
                calls.errors.push(error);
            });
        },
        changed: () => {
            calls.changed++;
        },
        status: () => {},
    });
    window.document.body.append(panel.node);
    panel.refresh();
    test.after(() => {
        current = false;
        panel.destroy();
        owner.close();
        fields.destroy();
    });
    return {
        window,
        parent,
        fields,
        owner,
        panel,
        calls,
        native: () => fields.controller.getState().draft!.data[fieldId],
        expireConfiguration: () => configuration++,
        expireVisitor: () => client.setSession({ visitor: 'synthetic-B' }),
        expireOwner: () => {
            scope = { ownerId: 'synthetic-starter', revision: 1 };
        },
        retireControl: () => {
            current = false;
        },
        setCanStart: (value: boolean) => {
            canStart = value;
        },
        setVisible: (value: boolean) => {
            visible = value;
        },
    };
};
type Fixture = Awaited<ReturnType<typeof fixture>>;
const openCreate = async (f: Fixture) => {
    button(f.panel.node, 'Create linked record').click();
    await waitFor(() => f.owner.getSnapshot().phase === 'ready');
    assert.equal(f.calls.loads.length, 1);
};
const saveChild = async (f: Fixture) => {
    button(f.panel.node, 'Save child').click();
    await waitFor(
        () => !['ready', 'saving'].includes(f.owner.getSnapshot().phase)
    );
};

describe('browser starter standalone linked-child integration', () => {
    it('mounts passively and offers hide-finder Create with explicitly hydrated Edit', async (test) => {
        const f = await fixture(test);
        assert.equal(f.calls.loads.length, 0);
        assert.equal(f.calls.reads.length, 0);
        assert.equal(f.calls.saves.length, 0);
        assert.equal(
            button(f.panel.node, 'Create linked record').disabled,
            false
        );
        assert.equal(
            buttons(f.panel.node, 'Edit linked record rec_existing').length,
            0
        );

        button(f.panel.node, 'Load selected records').click();
        await waitFor(
            () => f.owner.getSnapshot().editableRecordIds.length === 2
        );
        assert.deepEqual(f.calls.reads, [
            { extensionAccessToken: 'synthetic_parent_token' },
        ]);
        assert.equal(f.calls.loads.length, 0);
        assert.equal(
            button(f.panel.node, 'Edit linked record rec_existing').disabled,
            false
        );
        button(f.panel.node, 'Edit linked record rec_existing').click();
        await waitFor(() => f.owner.getSnapshot().phase === 'ready');
        assert.deepEqual(f.owner.getSnapshot().intent, {
            type: 'edit',
            recordId: 'rec_existing',
        });
        assert.equal(f.calls.saves.length, 0);
    });

    it('saves through the child owner and reconciles only created native IDs into the parent', async (test) => {
        const f = await fixture(test);
        const before = structuredClone(
            f.fields.controller.getState().draft!.data
        );
        await openCreate(f);
        const control = f.panel.node.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.ok(control instanceof f.window.HTMLInputElement);
        control.focus();
        edit(
            f.window,
            f.panel.node,
            'fld_title',
            'Synthetic created child title'
        );
        assert.ok(
            f.panel.node.querySelector('[data-field-id="fld_title"]') ===
                control,
            'The current child input must survive its native edit.'
        );
        assert.ok(
            f.window.document.activeElement === control,
            'The current child input must retain focus.'
        );
        assert.equal(
            f.owner.getSnapshot().child!.field('fld_title').getSnapshot().value,
            'Synthetic created child title'
        );
        assert.equal(f.calls.saves.length, 0);
        await saveChild(f);

        assert.equal(f.calls.saves.length, 1);
        assert.equal(f.calls.saves[0]!.formRecord.type, 'create');
        assert.equal(
            f.calls.saves[0]!.formRecord.data.fld_title,
            'Synthetic created child title'
        );
        assert.equal(f.calls.saves[0]!.context.type, 'modal');
        assert.equal(
            f.calls.saves[0]!.extensionAccessToken,
            'synthetic_child_token'
        );
        assert.deepEqual(f.native(), [
            ...(before[fieldId] as string[]),
            'rec_created',
        ]);
        assert.equal(
            f.fields.controller.getState().draft!.data.fld_title,
            before.fld_title
        );
        assert.deepEqual(
            f.fields.controller.getState().draft!.data.fld_children_b,
            before.fld_children_b
        );
        assert.deepEqual(f.fields.controller.getState().draft!.dirtyFieldIds, [
            'fld_title',
            fieldId,
        ]);
        assert.equal(f.owner.getSnapshot().completion, 'reconciled');
        assert.equal(f.panel.blocksParent(), false);
        const savedInput = f.panel.node.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.ok(savedInput instanceof f.window.HTMLInputElement);
        const child = f.owner.getSnapshot().child!;
        const savedValue = child.field('fld_title').getSnapshot().value;
        savedInput.value = 'Synthetic edit after saved receipt';
        savedInput.dispatchEvent(
            new f.window.Event('input', { bubbles: true })
        );
        assert.equal(child.field('fld_title').getSnapshot().value, savedValue);
        assert.ok(f.calls.changed > 0);
        assert.deepEqual(f.calls.errors, []);
    });

    it('offers Edit for hydrated native records at parent readonly/full capacity without offering Create', async (test) => {
        const parent = configuredParent();
        const schema = parent.payload.fieldIdsToSchemas[fieldId]!;
        assert.ok(schema.fieldType === 'multipleRecordLinks');
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            readOnly: true,
            customMaxRecordsToSelect: 1,
        };
        const f = await fixture(test, { parent });
        const before = structuredClone(f.native());
        const create = buttons(f.panel.node, 'Create linked record')[0];
        assert.ok(create === undefined || create.disabled);
        button(f.panel.node, 'Load selected records').click();
        await waitFor(
            () => f.owner.getSnapshot().editableRecordIds.length === 2
        );
        button(f.panel.node, 'Edit linked record rec_existing').click();
        await waitFor(() => f.owner.getSnapshot().phase === 'ready');
        edit(
            f.window,
            f.panel.node,
            'fld_title',
            'Synthetic readonly-parent child edit'
        );
        await saveChild(f);
        assert.equal(f.calls.saves.length, 1);
        assert.equal(f.calls.saves[0]!.formRecord.type, 'edit');
        assert.deepEqual(f.native(), before);
        assert.equal(f.owner.getSnapshot().completion, 'reconciled');
    });

    it('does not turn unresolved native IDs or finder candidates into child Edit actions', async (test) => {
        const parent = configuredParent();
        parent.payload.formRecord.data[fieldId] = [
            'rec_existing',
            'rec_unresolved',
        ];
        const f = await fixture(test, { parent });
        f.fields.setLinkedOptions(fieldId, [
            {
                value: 'rec_finder_candidate',
                label: 'Synthetic finder candidate',
            },
        ]);
        button(f.panel.node, 'Load selected records').click();
        await waitFor(
            () =>
                f.calls.reads.length === 1 &&
                f.owner.getSnapshot().editableRecordIds.length === 1
        );
        assert.equal(
            buttons(f.panel.node, 'Edit linked record rec_existing').length,
            1
        );
        assert.equal(
            buttons(f.panel.node, 'Edit linked record rec_unresolved').length,
            0
        );
        assert.equal(
            buttons(f.panel.node, 'Edit linked record rec_finder_candidate')
                .length,
            0
        );
        assert.deepEqual(f.native(), ['rec_existing', 'rec_unresolved']);
        assert.equal(f.calls.loads.length, 0);
    });

    it('edits a displayed child without changing parent selections or submitting the parent', async (test) => {
        const f = await fixture(test);
        const before = structuredClone(f.native());
        button(f.panel.node, 'Load selected records').click();
        await waitFor(
            () => f.owner.getSnapshot().editableRecordIds.length === 2
        );
        button(f.panel.node, 'Edit linked record rec_existing').click();
        await waitFor(() => f.owner.getSnapshot().phase === 'ready');
        edit(
            f.window,
            f.panel.node,
            'fld_title',
            'Synthetic edited child title'
        );
        await saveChild(f);

        assert.equal(f.calls.saves.length, 1);
        assert.equal(f.calls.saves[0]!.formRecord.type, 'edit');
        assert.equal(
            f.calls.saves[0]!.formRecord.data.fld_title,
            'Synthetic edited child title'
        );
        assert.deepEqual(f.native(), before);
        assert.equal(f.owner.getSnapshot().completion, 'reconciled');
        assert.deepEqual(f.calls.errors, []);
    });

    it('uses child manual pages and displays validation without a second automatic Save', async (test) => {
        let rejectSave = true;
        const f = await fixture(test, {
            paged: true,
            save: async (input) =>
                rejectSave
                    ? structuredClone(validationError)
                    : savedChild(input),
        });
        await openCreate(f);
        const first = f.panel.node.querySelector('[data-field-id="fld_title"]');
        assert.ok(first);
        assert.ok(
            f.panel.node
                .querySelector('[data-field-id="fld_note"]')
                ?.closest('[hidden]')
        );
        edit(f.window, f.panel.node, 'fld_title', '');
        button(f.panel.node, 'Child Next').click();
        await settle();
        assert.equal(
            f.owner.getSnapshot().pages!.getSnapshot().activePageIndex,
            0
        );
        assert.equal(f.calls.saves.length, 0);
        edit(f.window, f.panel.node, 'fld_title', 'Synthetic first answer');
        button(f.panel.node, 'Child Next').click();
        await waitFor(
            () =>
                f.owner.getSnapshot().pages!.getSnapshot().activePageIndex === 1
        );
        assert.ok(first instanceof f.window.HTMLInputElement);
        first.value = 'Synthetic inactive page edit';
        first.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        first.dispatchEvent(new f.window.Event('change', { bubbles: true }));
        assert.equal(
            f.owner.getSnapshot().child!.field('fld_title').getSnapshot().value,
            'Synthetic first answer'
        );
        edit(f.window, f.panel.node, 'fld_note', 'Synthetic second answer');
        button(f.panel.node, 'Child Next').click();
        await waitFor(
            () =>
                f.owner.getSnapshot().pages!.getSnapshot().activePageIndex === 2
        );
        assert.equal(f.calls.saves.length, 0);
        const staleSave = button(f.panel.node, 'Save child');
        button(f.panel.node, 'Child Back').click();
        await waitFor(
            () =>
                f.owner.getSnapshot().pages!.getSnapshot().activePageIndex === 1
        );
        fire(f.window, staleSave);
        await settle();
        assert.equal(f.calls.saves.length, 0);
        button(f.panel.node, 'Child Next').click();
        await waitFor(
            () =>
                f.owner.getSnapshot().pages!.getSnapshot().activePageIndex === 2
        );
        button(f.panel.node, 'Save child').click();
        await waitFor(
            () =>
                f.calls.saves.length === 1 &&
                f.owner.getSnapshot().phase === 'ready'
        );
        assert.match(
            f.panel.node.textContent ?? '',
            /Synthetic validation error/
        );
        await settle();
        assert.equal(f.calls.saves.length, 1);
        rejectSave = false;
        for (let turn = 0; turn < 2; turn++)
            if (f.owner.getSnapshot().pages!.getSnapshot().activePageIndex > 0)
                button(f.panel.node, 'Child Back').click();
        assert.equal(
            f.owner.getSnapshot().pages!.getSnapshot().activePageIndex,
            0
        );
        edit(
            f.window,
            f.panel.node,
            'fld_title',
            'Synthetic corrected first answer'
        );
        button(f.panel.node, 'Child Next').click();
        await waitFor(
            () =>
                f.owner.getSnapshot().pages!.getSnapshot().activePageIndex === 1
        );
        button(f.panel.node, 'Child Next').click();
        await waitFor(
            () =>
                f.owner.getSnapshot().pages!.getSnapshot().activePageIndex === 2
        );
        button(f.panel.node, 'Save child').click();
        await waitFor(() => f.owner.getSnapshot().phase === 'saved');
        assert.equal(f.calls.saves.length, 2);
        assert.equal(
            f.calls.saves[1]!.formRecord.data.fld_note,
            'Synthetic second answer'
        );
    });

    it('rejects captured events after a child field becomes conditionally hidden', async (test) => {
        const child = childForm('edit');
        const dependent = structuredClone(
            child.payload.fieldIdsToSchemas.fld_title!
        );
        dependent.airtableField.id = 'fld_conditional';
        dependent.airtableField.name = 'Conditional answer';
        dependent.airtableField.isPrimaryField = false;
        dependent.miniExtConfig = {
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'synthetic-child-condition',
                        type: 'singleCondition',
                        setting: {
                            type: 'contains',
                            fieldType: 'singleLineText',
                            value: 'show',
                            idOrName: { type: 'id', id: 'fld_title' },
                        },
                    },
                ],
            } satisfies RuntimeConditionsDefinition,
        };
        child.payload.fieldIdsToSchemas.fld_conditional = dependent;
        child.payload.fieldNamesToSchemas['Conditional answer'] = dependent;
        child.payload.fieldIdsInForm = ['fld_title', 'fld_conditional'];
        child.payload.formRecord.data.fld_title = 'show';
        child.payload.formRecord.data.fld_conditional =
            'Synthetic retained answer';
        const f = await fixture(test, { load: async () => child });
        await openCreate(f);
        const control = f.panel.node.querySelector(
            '[data-field-id="fld_conditional"]'
        );
        assert.ok(control instanceof f.window.HTMLInputElement);
        assert.ok(control.closest('[hidden]') === null);
        edit(f.window, f.panel.node, 'fld_title', 'hide');
        assert.ok(control.closest('[hidden]'));
        control.value = 'Synthetic denied hidden edit';
        control.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        control.dispatchEvent(new f.window.Event('change', { bubbles: true }));
        assert.equal(
            f.owner.getSnapshot().child!.field('fld_conditional').getSnapshot()
                .value,
            'Synthetic retained answer'
        );
        assert.equal(f.calls.saves.length, 0);
    });

    it('cannot reuse controls or Save callbacks from a cancelled child in its successor', async (test) => {
        const f = await fixture(test);
        await openCreate(f);
        const oldInput = f.panel.node.querySelector(
            '[data-field-id="fld_title"]'
        );
        assert.ok(oldInput instanceof f.window.HTMLInputElement);
        const oldSave = button(f.panel.node, 'Save child');
        button(f.panel.node, 'Cancel child').click();
        button(f.panel.node, 'Create linked record').click();
        await waitFor(
            () =>
                f.calls.loads.length === 2 &&
                f.owner.getSnapshot().phase === 'ready'
        );
        const successor = f.owner.getSnapshot().child!;
        assert.ok(
            f.panel.node.querySelector('[data-field-id="fld_title"]') !==
                oldInput,
            'A successor child must receive its own input control.'
        );
        oldInput.value = 'Synthetic predecessor edit';
        oldInput.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        fire(f.window, oldSave);
        await settle();
        assert.equal(f.calls.saves.length, 0);
        assert.equal(
            successor.field('fld_title').getSnapshot().value,
            'Child native title'
        );
    });

    for (const boundary of [
        'configuration',
        'visitor',
        'owner',
        'control',
    ] as const)
        it(`refuses captured child Save and edit callbacks after ${boundary} replacement`, async (test) => {
            const f = await fixture(test);
            await openCreate(f);
            const staleInput = f.panel.node.querySelector(
                '[data-field-id="fld_title"]'
            );
            assert.ok(staleInput instanceof f.window.HTMLInputElement);
            const staleSave = button(f.panel.node, 'Save child');
            const before = structuredClone(f.native());
            if (boundary === 'configuration') f.expireConfiguration();
            if (boundary === 'visitor') f.expireVisitor();
            if (boundary === 'owner') f.expireOwner();
            if (boundary === 'control') f.retireControl();
            staleInput.value = 'Synthetic obsolete edit';
            staleInput.dispatchEvent(
                new f.window.Event('input', { bubbles: true })
            );
            fire(f.window, staleSave);
            await settle();
            assert.equal(f.calls.saves.length, 0);
            const parent = f.fields.controller.getState();
            if (parent.draft === null) assert.equal(parent.status, 'stale');
            else assert.deepEqual(parent.draft.data[fieldId], before);
        });

    it('rejects held child completion after the control is retired', async (test) => {
        const pending = deferred<FormLoadedResult>();
        const f = await fixture(test, { load: async () => pending.promise });
        button(f.panel.node, 'Create linked record').click();
        await waitFor(() => f.calls.loads.length === 1);
        f.retireControl();
        f.panel.destroy();
        pending.resolve(childForm('edit'));
        await settle();
        await settle();
        assert.ok(
            f.panel.node.querySelector('[data-field-id="fld_title"]') === null
        );
        assert.equal(f.calls.saves.length, 0);
    });

    it('retains one known Save receipt without parent reconciliation after an observed configuration replacement', async (test) => {
        const pending = deferred<SaveFormResult>();
        const f = await fixture(test, { save: async () => pending.promise });
        const before = structuredClone(f.native());
        await openCreate(f);
        const save = button(f.panel.node, 'Save child');
        save.click();
        await waitFor(() => f.calls.saves.length === 1);
        f.expireConfiguration();
        f.fields.refresh();
        f.panel.refresh();
        // A subsequent accepted configuration receives another epoch. Returning
        // to the prior presentation cannot revive this already retired intent.
        f.expireConfiguration();
        pending.resolve(savedChild(f.calls.saves[0]!));
        await waitFor(
            () => f.owner.getSnapshot().completion === 'saved-not-reconciled'
        );
        fire(f.window, save);
        await settle();
        assert.equal(f.calls.saves.length, 1);
        assert.deepEqual(f.native(), before);
        assert.equal(f.panel.blocksParent(), true);
    });

    it('keeps a dispatched unknown Save blocked and never replays a captured Save click', async (test) => {
        const f = await fixture(test, {
            save: async () => {
                throw Error('Synthetic lost transport response');
            },
        });
        const before = structuredClone(f.native());
        await openCreate(f);
        const staleSave = button(f.panel.node, 'Save child');
        staleSave.click();
        await waitFor(() => f.owner.getSnapshot().phase === 'unknown');
        fire(f.window, staleSave);
        f.panel.refresh();
        await settle();
        assert.equal(f.calls.saves.length, 1);
        assert.deepEqual(f.native(), before);
        assert.equal(f.panel.blocksParent(), true);
        button(f.panel.node, 'Cancel child').click();
        assert.equal(f.panel.blocksParent(), true);
        assert.equal(buttons(f.panel.node, 'Create linked record').length, 0);
        fire(f.window, staleSave);
        await settle();
        assert.equal(f.calls.saves.length, 1);
    });

    it('retains a known unreconciled child receipt and blocks repeated Save and parent submission', async (test) => {
        const parent = configuredParent();
        const schema = parent.payload.fieldIdsToSchemas[fieldId]!;
        assert.ok(schema.fieldType === 'multipleRecordLinks');
        schema.miniExtConfig = { ...schema.miniExtConfig, readOnly: true };
        const f = await fixture(test, {
            parent,
            save: async (input) => {
                const result = savedChild(input);
                assert.ok(result.type === 'saved');
                result.record.fields.fld_parent_a = [];
                return result;
            },
        });
        const before = structuredClone(f.native());
        button(f.panel.node, 'Load selected records').click();
        await waitFor(
            () => f.owner.getSnapshot().editableRecordIds.length === 2
        );
        button(f.panel.node, 'Edit linked record rec_existing').click();
        await waitFor(() => f.owner.getSnapshot().phase === 'ready');
        const save = button(f.panel.node, 'Save child');
        save.click();
        await waitFor(
            () => f.owner.getSnapshot().completion === 'saved-not-reconciled'
        );
        fire(f.window, save);
        await settle();
        assert.equal(f.calls.saves.length, 1);
        assert.equal(f.panel.blocksParent(), true);
        assert.deepEqual(f.native(), before);
        assert.match(
            f.panel.node.textContent ?? '',
            /parent draft was not updated/
        );
        button(f.panel.node, 'Cancel child').click();
        assert.equal(f.panel.blocksParent(), true);
        assert.equal(buttons(f.panel.node, 'Create linked record').length, 0);
        fire(f.window, save);
        await settle();
        assert.equal(f.calls.saves.length, 1);
    });

    it('checks the live parent admission again when a captured Create callback fires', async (test) => {
        const f = await fixture(test);
        const create = button(f.panel.node, 'Create linked record');
        f.setCanStart(false);
        fire(f.window, create);
        await settle();
        assert.equal(f.calls.loads.length, 0);
        assert.equal(f.calls.reads.length, 0);
        assert.equal(f.calls.saves.length, 0);
    });

    it('keeps Cancel reachable when the parent linked field leaves the visible page', async (test) => {
        const f = await fixture(test);
        const before = structuredClone(f.native());
        await openCreate(f);
        const child = f.owner.getSnapshot().child!;
        const childValue = child.field('fld_title').getSnapshot().value;
        const input = f.panel.node.querySelector('[data-field-id="fld_title"]');
        assert.ok(input instanceof f.window.HTMLInputElement);
        f.setVisible(false);
        f.setCanStart(false);
        f.panel.refresh();
        assert.equal(f.panel.node.hidden, false);
        const cancel = button(f.panel.node, 'Cancel child');
        assert.ok(
            cancel.isConnected,
            'The active child Cancel must remain connected.'
        );
        assert.ok(
            cancel.closest('[hidden], [inert]') === null,
            'Cancel must have no hidden or inert ancestor.'
        );
        assert.equal(cancel.disabled, false);
        assert.equal(buttons(f.panel.node, 'Create linked record').length, 0);
        assert.equal(buttons(f.panel.node, 'Load selected records').length, 0);
        input.value = 'Synthetic inactive child edit';
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
        input.dispatchEvent(new f.window.Event('change', { bubbles: true }));
        assert.equal(child.field('fld_title').getSnapshot().value, childValue);
        cancel.click();
        assert.equal(f.panel.blocksParent(), false);
        assert.equal(f.panel.node.hidden, true);
        assert.deepEqual(f.native(), before);
        assert.equal(f.calls.saves.length, 0);
    });
});

describe('actual starter root versus nested linked-child admission', () => {
    for (const mode of ['root', 'readonly-root', 'nested'] as const)
        it(`${mode} Form keeps child actions within the configured owner boundary`, async (test) => {
            const nested = mode === 'nested';
            const readOnly = mode === 'readonly-root';
            const form = configuredParent(nested);
            if (readOnly) {
                const schema = form.payload.fieldIdsToSchemas[fieldId]!;
                assert.ok(schema.fieldType === 'multipleRecordLinks');
                schema.miniExtConfig = {
                    ...schema.miniExtConfig,
                    readOnly: true,
                    customMaxRecordsToSelect: 1,
                };
            }
            const requests: LoadExtensionInput[] = [];
            const saves: SaveFormInput[] = [];
            const reads: LoadSelectedRecordsInput[] = [];
            const fetch: typeof globalThis.fetch = async (resource, init) => {
                const url = new URL(String(resource));
                assert.equal(url.origin, 'https://sdk.example.test');
                const route = url.searchParams.get('route');
                if (route === 'fetchExtensionForEndUser') {
                    const input: LoadExtensionInput = JSON.parse(
                        String(init?.body)
                    );
                    requests.push(input);
                    return new Response(
                        JSON.stringify(
                            'childExtensionInfo' in input
                                ? loadedChild(input)
                                : form
                        )
                    );
                }
                if (
                    url.pathname ===
                    '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
                ) {
                    reads.push(
                        JSON.parse(url.searchParams.get('input') ?? 'null')
                    );
                    return new Response(
                        JSON.stringify({
                            result: { data: selectedRecords(form) },
                        })
                    );
                }
                if (route === 'saveForm') {
                    const input: SaveFormInput = JSON.parse(String(init?.body));
                    saves.push(input);
                    return new Response(JSON.stringify(savedChild(input)));
                }
                assert.fail(
                    `Unexpected synthetic route: ${url.pathname} ${route}`
                );
            };
            const window = await environment(test, fetch, true);
            await import(
                `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
            );
            await settle();
            assert.equal(requests.length, 0);
            assert.equal(reads.length, 0);
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            const record = window.document.getElementById('record-id');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            assert.ok(record instanceof window.HTMLInputElement);
            origin.value = 'https://sdk.example.test';
            share.value = 'share_synthetic_parent';
            record.value = 'rec_parent';
            window.document.getElementById('connection-form')!.dispatchEvent(
                new window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(
                () =>
                    window.document.querySelector(
                        `[data-field-id="${fieldId}"]`
                    ) !== null &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            const body = window.document.body;
            assert.equal(requests.length, 1);
            assert.equal(reads.length, 0);
            assert.equal(saves.length, 0);
            assert.equal(
                buttons(body, 'Create linked record').length,
                nested || readOnly ? 0 : 1
            );
            assert.equal(
                buttons(body, 'Load selected records').length,
                nested ? 0 : 1
            );
            if (nested) return;
            const parentRaw = window.document.querySelector(
                `[data-field-id="${fieldId}"]`
            );
            assert.ok(parentRaw instanceof window.HTMLTextAreaElement);
            const parentCard = parentRaw.closest('form');
            assert.ok(parentCard);
            const parentSave = button(body, 'Save');
            const parentDiscard = button(body, 'Discard draft');
            if (readOnly) {
                button(body, 'Load selected records').click();
                await waitFor(
                    () =>
                        buttons(body, 'Edit linked record rec_existing')
                            .length === 1 &&
                        window.document
                            .getElementById('screen')
                            ?.getAttribute('aria-busy') === 'false'
                );
                button(body, 'Edit linked record rec_existing').click();
            } else button(body, 'Create linked record').click();
            await waitFor(
                () =>
                    buttons(body, 'Save child').length === 1 &&
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
            assert.equal(requests.length, 2);
            assert.equal(saves.length, 0);
            assert.equal(parentSave.disabled, true);
            // A captured callback may be invoked even while native controls are
            // disabled or inert. The parent mutation boundary must still refuse.
            parentCard.dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
            fire(window, parentDiscard);
            await settle();
            await settle();
            assert.equal(saves.length, 0);
            assert.equal(parentCard.isConnected, true);
            assert.equal(buttons(body, 'Save child').length, 1);
            assert.deepEqual(JSON.parse(parentRaw.value), [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
            ]);
            button(body, 'Save child').click();
            await waitFor(() => saves.length === 1);
            await waitFor(
                () =>
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false' &&
                    !parentSave.disabled
            );
            assert.equal(
                saves[0]!.extensionAccessToken,
                'synthetic_child_token'
            );
            assert.equal(
                saves[0]!.formRecord.type,
                readOnly ? 'edit' : 'create'
            );
            assert.deepEqual(
                JSON.parse(parentRaw.value),
                readOnly
                    ? ['rec_existing', 'rec_existing', 'rec_sibling']
                    : [
                          'rec_existing',
                          'rec_existing',
                          'rec_sibling',
                          'rec_created',
                      ]
            );
        });
});
