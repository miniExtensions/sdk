import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const linkedField = 'fld_children_a';
const recordIds = ['rec_existing', 'rec_sibling'];
const titleFor = (id) => `Child ${id}`;

async function exerciseMountedEdits({
    forms,
    ui,
    reactApi,
    consumer,
    fixtures,
}) {
    const {
        createElement: h,
        useLayoutEffect,
        useRef,
        act,
    } = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    const window = new Window();
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const original = Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
    ]);
    for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { configurable: true, value });
    }

    const parent = fixtures.parentForm('edit');
    parent.payload.formRecord.data[linkedField] = [...recordIds];
    parent.payload.fieldIdsInForm = [linkedField, 'fld_title'];
    parent.payload.publicFields.state.multiPageFormMode = 'multi-page';
    parent.payload.fieldIdsToSchemas[
        linkedField
    ].miniExtConfig.requireOpenLinkedRecords = true;
    parent.payload.fieldIdsToSchemas.fld_title.miniExtConfig.headerSectionTitle =
        'Finish';
    const calls = { reads: 0, loads: [], saves: [] };
    const client = {
        getSession: () => ({ visitor: 'synthetic-review-visitor' }),
        linkedRecords: {
            async loadSelectedRecords() {
                calls.reads++;
                return {
                    tbl_child: {
                        airtableFields: [
                            parent.payload.fieldIdsToSchemas.fld_title
                                .airtableField,
                        ],
                        recordIdsToAirtableRecords: Object.fromEntries(
                            recordIds.map((id) => [
                                id,
                                { id, fields: { fld_title: titleFor(id) } },
                            ])
                        ),
                    },
                };
            },
        },
        async loadExtension(input) {
            const access = input.childExtensionInfo.accessType;
            assert.equal(access.type, 'edit');
            const id = access.childExtensionRecordId;
            calls.loads.push(id);
            const child = fixtures.childForm('edit');
            child.payload.formRecord = {
                type: 'edit',
                recordId: id,
                tableId: 'tbl_child',
                data: {
                    ...child.payload.formRecord.data,
                    fld_title: titleFor(id),
                },
            };
            child.payload.fieldIdsInForm = ['fld_title'];
            child.payload.formFieldIdsWithUnsavedChanges = [];
            return child;
        },
        forms: {
            async save(input) {
                calls.saves.push(structuredClone(input));
                const saved = fixtures.childSaved('edit');
                return {
                    ...saved,
                    record: {
                        id: input.formRecord.recordId,
                        fields: input.formRecord.data,
                    },
                    context: { type: 'direct-url' },
                    tableId: 'tbl_parent',
                };
            },
        },
    };
    const fields = forms.createFormFieldBindings({
        loaded: parent,
        client,
        getScope: () => ({ ownerId: 'synthetic-review-parent', revision: 0 }),
        configurationRevision: () => 0,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    const pages = forms.createFormPageOwner({
        fields,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const owner = fields.linkedChild(linkedField, {
        journal: new forms.RecoveryJournal(),
        loadVersion: 1,
    });
    const host = window.document.createElement('main');
    window.document.body.append(host);
    const root = createRoot(host);
    let scope;

    function ChildPresentation({ snapshot }) {
        const dialog = useRef(null);
        useLayoutEffect(() => {
            const presentation = new AbortController();
            assert(dialog.current?.open);
            assert.equal(
                dialog.current.textContent,
                titleFor(snapshot.intent.recordId)
            );
            // The baseline has no owner-bound presentation acknowledgment.
            owner.acknowledgeEditPresentation?.(
                snapshot.revision,
                snapshot.child,
                presentation.signal
            );
            return () => presentation.abort();
        }, [snapshot]);
        return h(
            'dialog',
            { open: true, ref: dialog },
            h(reactApi.AirtableForm, {
                scope,
                renderers: {
                    renderSingleLineTextField: (field) =>
                        h('span', null, field.value),
                },
                children: (form) =>
                    form.fields.map((field) =>
                        h('div', { key: field.fieldId }, field.node)
                    ),
            })
        );
    }

    const open = async (id) => {
        assert.equal(
            await owner.openEdit(id, owner.getSnapshot().revision),
            true
        );
        const snapshot = owner.getSnapshot();
        assert.equal(snapshot.phase, 'ready');
        assert.deepEqual(snapshot.intent, { type: 'edit', recordId: id });
        assert(snapshot.child && snapshot.pages);
        scope = ui.createFormRenderScope({
            fields: snapshot.child,
            pages: snapshot.pages,
            isCurrent: () => owner.getSnapshot().child === snapshot.child,
            configurationRevision: () => 0,
        });
        await act(async () => root.render(h(ChildPresentation, { snapshot })));
        assert.equal(
            host.querySelector('dialog[open]')?.textContent,
            titleFor(id)
        );
    };
    const close = async () => {
        await act(async () => root.render(null));
        scope.destroy();
        scope = undefined;
        assert.equal(owner.closeEdit(owner.getSnapshot().revision), true);
    };
    const assertRefused = async () => {
        assert.equal(pages.next(pages.getSnapshot().revision).accepted, false);
        await assert.rejects(
            pages.submit(pages.getSnapshot().revision),
            forms.FormPageError
        );
        assert.equal(calls.saves.length, 0);
    };
    try {
        assert(await fields.linkedRecords(linkedField).readSelected());
        await open(recordIds[0]);
        await close();
        await assertRefused();
        await open(recordIds[1]);
        await close();
        assert.equal(calls.reads, 1);
        assert.deepEqual(calls.loads, recordIds);
        assert.equal(calls.saves.length, 0);
        assert.deepEqual(
            pages.next(pages.getSnapshot().revision),
            { accepted: true },
            'Both selected child Forms were actually presented in the same parent'
        );
        const result = await pages.submit(pages.getSnapshot().revision);
        assert.equal(result.type, 'saved');
        assert.equal(calls.saves.length, 1);
        assert.equal(calls.saves[0].formRecord.recordId, 'rec_parent');
        assert.deepEqual(
            calls.saves[0].formRecord.data[linkedField],
            recordIds
        );
    } finally {
        await act(async () => root.unmount());
        scope?.destroy();
        pages.dispose();
        fields.destroy();
        host.remove();
        await window.happyDOM.abort();
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}

export async function checkFormRequiredOpenConsumer({ consumerDirectory }) {
    const bundle = await build({
        entryPoints: [
            new URL('../test/formLinkedChildFixtures.ts', import.meta.url)
                .pathname,
        ],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
    });
    const fixtures = await import(
        `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
    );
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const load = (name) =>
        import(
            pathToFileURL(
                join(
                    consumerDirectory,
                    'node_modules/@miniextensions/sdk/dist/esm',
                    name,
                    'index.js'
                )
            )
        );
    const failures = [];
    for (const [format, getModule] of [
        ['ESM', load],
        ['CommonJS', (name) => consumer(`@miniextensions/sdk/${name}`)],
    ]) {
        try {
            const [forms, ui, reactApi] = await Promise.all(
                ['forms', 'ui', 'react'].map(getModule)
            );
            await exerciseMountedEdits({
                forms,
                ui,
                reactApi,
                consumer,
                fixtures,
            });
        } catch (error) {
            failures.push(
                new Error(`${format}: ${error.message}`, { cause: error })
            );
        }
    }
    if (failures.length)
        throw new AggregateError(failures, 'Installed required-open consumer');
    return 2;
}
