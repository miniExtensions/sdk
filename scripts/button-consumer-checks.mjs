import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
};
const nativeField = () => ({
    id: 'fld_button',
    name: 'Action',
    description: null,
    isComputed: true,
    isPrimaryField: false,
    config: { type: 'button', options: null },
});
const makeCore = (ui, forms, configure = () => {}) => {
    const data = {
        field: nativeField(),
        value: { url: 'action.example.test/run', label: 'Run action' },
        config: { openLinkType: 'triggerWebhookPOST' },
        language: 'en',
        source: { type: 'current-record', recordId: 'rec_current' },
        extensionAccessToken: 'fake_consumer_button_token',
        visible: true,
    };
    configure(data);
    const calls = [];
    let session = { visitor: 'A' };
    const client = {
        getSession: () => ({ ...session }),
        setSession: (next) => {
            session = { ...next };
        },
        buttons: {
            triggerWebhook: async (input) => {
                calls.push(structuredClone(input));
                return { success: true };
            },
        },
    };
    const journal = new forms.RecoveryJournal();
    const options = {
        client,
        adapter: {
            read: () => data,
            isCurrent: () => true,
            configurationRevision: () => 1,
        },
        recovery: {
            journal,
            scope: {
                owner: 'A',
                parentFieldId: null,
                tableId: 'tbl_current',
                childExtensionId: 'form',
                context: 'modal',
            },
            loadVersion: 1,
        },
    };
    return {
        model: ui.createButtonFieldModel(options),
        client,
        data,
        calls,
        journal,
        options,
    };
};

/** Actual packed ESM/CommonJS and synthetic happy-dom React behavior; no native-browser proof. */
export async function checkButtonConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const packageRoot = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    const installed = async (entry) =>
        import(pathToFileURL(join(packageRoot, `dist/esm/${entry}/index.js`)));
    const esm = {
        ui: await installed('ui'),
        forms: await installed('forms'),
        portals: await installed('portals'),
        react: await installed('react'),
    };
    const cjs = {
        ui: consumer('@miniextensions/sdk/ui'),
        forms: consumer('@miniextensions/sdk/forms'),
        portals: consumer('@miniextensions/sdk/portals'),
        react: consumer('@miniextensions/sdk/react'),
    };
    let checks = 0;
    for (const api of [esm, cjs]) {
        assert.equal(typeof api.ui.createButtonFieldModel, 'function');
        assert.equal(typeof api.ui.createFormButtonFieldModel, 'function');
        assert.equal(typeof api.ui.createPortalButtonFieldModel, 'function');
        assert.equal(typeof api.react.useButtonField, 'function');
        checks++;
        for (const mode of [undefined, '_self', '_blank', '_parent']) {
            const f = makeCore(api.ui, api.forms, (data) => {
                data.config = { openLinkType: mode };
            });
            assert.deepEqual(
                f.model.prepareLink(f.model.getSnapshot().revision),
                {
                    href: 'https://action.example.test/run',
                    target: mode ?? '_blank',
                    rel: 'noreferrer',
                }
            );
            assert.equal(
                (await f.model.triggerWebhook(f.model.getSnapshot().revision))
                    .type,
                'refused'
            );
            assert.equal(f.calls.length, 0);
            f.model.dispose();
            checks++;
        }
        for (const source of [
            { type: 'current-record', recordId: 'rec_current' },
            {
                type: 'linked-record',
                linkedRecordId: 'rec_child',
                linkedTableId: 'tbl_children',
                parentLinkedRecordFieldId: 'fld_children',
                selectedCustomViewId: 'view_current',
            },
        ]) {
            const f = makeCore(api.ui, api.forms, (data) => {
                data.source = source;
                data.config.triggerWebhookSuccessMessage = '';
            });
            assert.equal(
                (await f.model.triggerWebhook(f.model.getSnapshot().revision))
                    .type,
                'reported-success'
            );
            assert.deepEqual(f.calls, [
                {
                    extensionAccessToken: 'fake_consumer_button_token',
                    fieldId: 'fld_button',
                    source,
                },
            ]);
            assert.deepEqual(f.model.getSnapshot().feedback, {
                kind: 'success',
                text: '',
            });
            assert.equal(f.journal.unknown('A').length, 0);
            f.model.dispose();
            checks++;
        }
        const uncertain = makeCore(api.ui, api.forms);
        uncertain.client.buttons.triggerWebhook = async (input) => {
            uncertain.calls.push(input);
            return { success: false };
        };
        assert.equal(
            (
                await uncertain.model.triggerWebhook(
                    uncertain.model.getSnapshot().revision
                )
            ).type,
            'uncertain'
        );
        assert.equal(
            (
                await uncertain.model.triggerWebhook(
                    uncertain.model.getSnapshot().revision
                )
            ).type,
            'refused'
        );
        assert.equal(uncertain.calls.length, 1);
        assert.equal(uncertain.journal.unknown('A').length, 1);
        assert.equal(
            uncertain.model.acknowledgeNewIntent(
                uncertain.model.getSnapshot().revision
            ),
            true
        );
        uncertain.client.buttons.triggerWebhook = async (input) => {
            uncertain.calls.push(input);
            return { success: true };
        };
        assert.equal(
            (
                await uncertain.model.triggerWebhook(
                    uncertain.model.getSnapshot().revision
                )
            ).type,
            'reported-success'
        );
        assert.equal(uncertain.calls.length, 2);
        uncertain.model.dispose();
        checks++;
        for (const unavailable of ['hidden', 'create', 'null-value']) {
            const f = makeCore(api.ui, api.forms, (data) => {
                if (unavailable === 'hidden') data.visible = false;
                if (unavailable === 'create') data.source = null;
                if (unavailable === 'null-value') data.value = null;
            });
            assert.equal(
                (await f.model.triggerWebhook(f.model.getSnapshot().revision))
                    .type,
                'refused'
            );
            assert.equal(f.calls.length, 0);
            assert.equal(f.journal.unknown('A').length, 0);
            f.model.dispose();
            checks++;
        }

        const formClient = {
            getSession: () => ({ visitor: 'A' }),
            buttons: {
                triggerWebhook: async (input) => {
                    formCalls.push(structuredClone(input));
                    return { success: true };
                },
            },
            forms: {
                save: async () => {
                    throw Error('Button consumers never implicitly save');
                },
            },
        };
        const formCalls = [];
        for (const type of ['edit', 'create']) {
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.publicFields = {
                type: 'form',
                state: { formFields: null, tableId: 'tbl_children' },
            };
            loaded.payload.fieldIdsInForm = ['fld_button'];
            loaded.payload.fieldIdsToSchemas = {
                fld_button: {
                    fieldType: 'button',
                    airtableField: nativeField(),
                    miniExtConfig: { openLinkType: 'triggerWebhookPOST' },
                },
            };
            loaded.payload.formRecord =
                type === 'edit'
                    ? {
                          type,
                          tableId: 'tbl_children',
                          recordId: 'rec_edit',
                          data: {
                              fld_button: {
                                  url: 'form.example.test/action',
                                  label: 'Form action',
                              },
                          },
                      }
                    : {
                          type,
                          data: {
                              fld_button: {
                                  url: 'form.example.test/action',
                                  label: 'Form action',
                              },
                          },
                      };
            const fields = api.forms.createFormFieldBindings({
                client: formClient,
                loaded,
                getScope: () => ({ ownerId: 'A', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const before = fields.field('fld_button').getSnapshot();
            assert.equal(before.canEdit, false);
            const model = api.ui.createFormButtonFieldModel({
                client: formClient,
                fields,
                fieldId: 'fld_button',
                isCurrent: () => true,
                configurationRevision: () => 0,
                recovery: {
                    journal: new api.forms.RecoveryJournal(),
                    scope: {
                        owner: 'A',
                        parentFieldId: null,
                        tableId: 'tbl_children',
                        childExtensionId: loaded.extensionId,
                        context: 'modal',
                    },
                    loadVersion: 1,
                },
            });
            assert.equal(model.getSnapshot().canTrigger, type === 'edit');
            assert.equal(
                (await model.getRenderProps().triggerWebhook()).type,
                type === 'edit' ? 'reported-success' : 'refused'
            );
            assert.deepEqual(
                fields.field('fld_button').getSnapshot().value,
                before.value
            );
            assert.equal(fields.field('fld_button').getSnapshot().dirty, false);
            model.dispose();
            fields.destroy();
            checks++;
        }
        assert.deepEqual(formCalls, [
            {
                extensionAccessToken: 'child_access_example',
                fieldId: 'fld_button',
                source: { type: 'current-record', recordId: 'rec_edit' },
            },
        ]);

        const portal = portalRecipeFixtures.makePortal();
        portal.payload.publicFields = {
            type: 'portal',
            state: { portalFields: null },
        };
        portal.payload.linkedRecordFieldIdToDetailFields.fld_children = [
            {
                fieldId: 'fld_button',
                fieldName: 'Action',
                titleOverride: 'Returned action',
                isHidden: false,
                fieldIsInEditingChildForm: false,
                childFormField: null,
                miniExtConfig: { openLinkType: 'triggerWebhookGET' },
            },
        ];
        const page = portalRecipeFixtures.page([
            {
                id: 'rec_child',
                fields: {
                    fld_button: {
                        url: 'portal.example.test/action',
                        label: 'Portal action',
                    },
                },
            },
        ]);
        page.tableIdsToLinkedTableStates.tbl_children.airtableFields = [
            nativeField(),
        ];
        const portalCalls = [];
        const portalClient = {
            getSession: () => ({ visitor: 'A' }),
            buttons: {
                triggerWebhook: async (input) => {
                    portalCalls.push(structuredClone(input));
                    return { success: true };
                },
            },
            portals: { listLinkedRecords: async () => page },
        };
        const criteria = {
            selectedCustomViewId: 'view_example',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        };
        const owner = api.portals.createPortalListOwner({
            client: portalClient,
            portal,
            portalFieldId: 'fld_children',
            criteria,
            getScope: () => ({ ownerId: 'A', revision: 0 }),
        });
        assert.equal(
            await owner.readFirst(owner.getSnapshot().revision, {
                pagesToFetch: 1,
                refreshLoggedInPortalRecord: false,
            }),
            true
        );
        const portalOptions = {
            client: portalClient,
            owner,
            portal,
            recordId: 'rec_child',
            fieldId: 'fld_button',
            isCurrent: () => true,
            configurationRevision: () => 0,
            recovery: {
                journal: new api.forms.RecoveryJournal(),
                scope: {
                    owner: 'A',
                    parentFieldId: 'fld_children',
                    tableId: 'tbl_children',
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: 1,
            },
        };
        const portalModel = api.ui.createPortalButtonFieldModel(portalOptions);
        assert.equal(portalModel.getSnapshot().config.title, 'Returned action');
        assert.equal(
            (await portalModel.getRenderProps().triggerWebhook()).type,
            'reported-success'
        );
        assert.deepEqual(portalCalls, [
            {
                extensionAccessToken: 'portal_access_example',
                fieldId: 'fld_button',
                source: {
                    type: 'linked-record',
                    linkedRecordId: 'rec_child',
                    linkedTableId: 'tbl_children',
                    parentLinkedRecordFieldId: 'fld_children',
                    selectedCustomViewId: 'view_example',
                },
            },
        ]);
        const missing = api.ui.createPortalButtonFieldModel({
            ...portalOptions,
            recordId: 'unlisted',
        });
        assert.equal(
            (await missing.getRenderProps().triggerWebhook()).type,
            'refused'
        );
        assert.equal(portalCalls.length, 1);
        const retained = portalModel.getRenderProps();
        owner.setCriteria(owner.getSnapshot().revision, {
            ...criteria,
            searchTerm: 'replacement',
        });
        assert.equal((await retained.triggerWebhook()).type, 'refused');
        assert.equal(portalModel.getSnapshot().phase, 'retired');
        assert.equal(portalCalls.length, 1);
        missing.dispose();
        portalModel.dispose();
        owner.destroy();
        checks++;
    }

    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLButtonElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const react = consumer('react');
    const { createElement, StrictMode, act } = react;
    const { createRoot } = consumer('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container);
    const models = [];
    let lastAction;
    const CustomButton = ({ model }) => {
        const props = esm.react.useButtonField(model);
        return createElement(
            'section',
            { 'data-phase': props.phase },
            createElement(
                'button',
                {
                    type: 'button',
                    disabled: !props.canTrigger,
                    onClick: () => {
                        lastAction = props.triggerWebhook();
                    },
                },
                props.value?.label ?? 'Unavailable'
            ),
            createElement('output', null, props.feedback?.text ?? '')
        );
    };
    const tree = (model) =>
        createElement(StrictMode, null, createElement(CustomButton, { model }));
    try {
        const f = makeCore(esm.ui, esm.forms);
        models.push(f.model);
        const held = deferred();
        f.client.buttons.triggerWebhook = (input) => {
            f.calls.push(input);
            return held.promise;
        };
        await act(async () => root.render(tree(f.model)));
        assert.equal(f.calls.length, 0);
        await act(async () => container.querySelector('button').click());
        assert.equal(f.calls.length, 1);
        assert.equal(
            container.querySelector('section').dataset.phase,
            'pending'
        );
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree(f.model)));
        assert.equal(f.model.getSnapshot().busy, true);
        assert.equal(container.querySelector('button').disabled, true);
        assert.equal(f.calls.length, 1);
        await act(async () => {
            held.resolve({ success: false });
            await lastAction;
        });
        assert.equal(
            container.querySelector('section').dataset.phase,
            'uncertain'
        );
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree(f.model)));
        assert.equal(
            container.querySelector('section').dataset.phase,
            'uncertain'
        );
        assert.equal(f.calls.length, 1);
        assert.equal(
            JSON.stringify(f.model.getRenderProps()).includes(
                'fake_consumer_button_token'
            ),
            false
        );
        checks++;
        await act(async () =>
            f.model.acknowledgeNewIntent(f.model.getSnapshot().revision)
        );
        const late = deferred();
        f.client.buttons.triggerWebhook = (input) => {
            f.calls.push(input);
            return late.promise;
        };
        await act(async () => container.querySelector('button').click());
        const oldAction = lastAction;
        const successor = makeCore(esm.ui, esm.forms, (data) => {
            data.value.label = 'Visitor B action';
            data.config.triggerWebhookSuccessMessage = 'B success';
        });
        successor.client.setSession({ visitor: 'B' });
        // A replacement owner captures the new visitor before it reaches the hook.
        successor.model.dispose();
        successor.model = esm.ui.createButtonFieldModel(successor.options);
        models.push(successor.model);
        await act(async () => {
            f.client.setSession({ visitor: 'B' });
            f.model.getSnapshot();
            root.render(tree(successor.model));
        });
        assert.equal(
            container.querySelector('button').textContent,
            'Visitor B action'
        );
        await act(async () => {
            container.querySelector('button').click();
            await lastAction;
        });
        assert.equal(
            container.querySelector('output').textContent,
            'B success'
        );
        await act(async () => {
            late.resolve({ success: true });
            await oldAction;
        });
        assert.equal(f.model.getSnapshot().phase, 'retired');
        assert.equal(
            container.querySelector('button').textContent,
            'Visitor B action'
        );
        assert.equal(
            container.querySelector('output').textContent,
            'B success'
        );
        assert.equal(successor.calls.length, 1);
        checks++;
        return {
            checks,
            reactVersion: react.version,
            proof: 'installed ESM/CommonJS and React StrictMode with happy-dom synthetic clicks; no native-browser proof',
        };
    } finally {
        await act(async () => root.unmount());
        models.forEach((model) => model.dispose());
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}

export const buttonTypedConsumer = `
import type { ButtonFieldModel, ButtonFieldRenderProps, ButtonFieldModelOptions } from '@miniextensions/sdk/ui';
import { createButtonFieldModel } from '@miniextensions/sdk/ui';
import { createFormButtonFieldModel } from '@miniextensions/sdk/ui';
import { createPortalButtonFieldModel } from '@miniextensions/sdk/ui';
export function typedButtonConsumer(options: ButtonFieldModelOptions): ButtonFieldRenderProps {
    const model: ButtonFieldModel = createButtonFieldModel(options);
    const props: ButtonFieldRenderProps = model.getRenderProps();
    const prepared = props.prepareLink();
    const href: string | undefined = prepared?.href;
    void href;
    void props.triggerWebhook();
    props.cancel();
    props.acknowledgeNewIntent();
    // @ts-expect-error renderer state never exposes extension credentials
    props.extensionAccessToken;
    // @ts-expect-error renderer state never exposes configured record sources
    props.source;
    // @ts-expect-error headless actions require the captured numeric revision
    model.triggerWebhook();
    return props;
}
export const typedFormButtonFactory: typeof createFormButtonFieldModel = createFormButtonFieldModel;
export const typedPortalButtonFactory: typeof createPortalButtonFieldModel = createPortalButtonFieldModel;
`;

export const buttonReactTypedConsumer = `
import type { ButtonFieldModel, ButtonFieldRenderProps } from '@miniextensions/sdk/ui';
import { useButtonField } from '@miniextensions/sdk/react';
export function typedReactButtonConsumer(model: ButtonFieldModel): ButtonFieldRenderProps {
    const props: ButtonFieldRenderProps = useButtonField(model);
    const prepared = props.prepareLink();
    const href: string | undefined = prepared?.href;
    void href;
    void props.triggerWebhook();
    props.cancel();
    props.acknowledgeNewIntent();
    // @ts-expect-error renderer state never exposes extension credentials
    props.extensionAccessToken;
    // @ts-expect-error renderer state never exposes configured record sources
    props.source;
    return props;
}
`;
