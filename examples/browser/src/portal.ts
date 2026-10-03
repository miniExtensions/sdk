import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type RuntimeGridCellValue,
    type RuntimeLinkedRecordDetailField,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '@miniextensions/sdk';
import {
    createPortalCollection,
    type PortalCollection,
    type PortalCollectionSnapshot,
    type PortalOwnerScope,
} from '@miniextensions/sdk/portals';
import { button, element, labeled } from './dom.js';
import { displayValue, fieldControl, type FieldControl } from './fields.js';
import type { ParentFormDraftScope } from './drafts.js';
import {
    cancelConfirmation,
    type ConfirmationOptions,
} from './confirmation.js';

type Run = (
    description: string,
    action: (context: {
        client: MiniExtensionsClient;
        signal: AbortSignal;
        current(): boolean;
    }) => Promise<void>
) => Promise<void>;
export type PortalView = {
    node: HTMLElement;
    refreshRequired(): void;
    closeEditor(): void;
    retireCollection(): void;
    destroy(): void;
};
type PortalFieldConfig = NonNullable<
    Extract<
        NonNullable<
            PortalLoadedResult['payload']['publicFields']['state']['portalFields']
        >[number]['config'],
        { type: 'multipleRecordLinks' }
    >['config']
>;
type CanonicalCustomView = NonNullable<
    PortalFieldConfig['customViews']
>[number];
type CustomView = {
    id: string;
    config: CanonicalCustomView['config'] | null;
};
type DetailField = {
    fieldId: string;
    title: string | null;
    miniExtConfig?: RuntimeFieldSchema['miniExtConfig'];
    inlineEditable: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value != null && !Array.isArray(value);

const customViews = (config: PortalFieldConfig | undefined): CustomView[] => {
    if (!Array.isArray(config?.customViews)) return [];
    return config.customViews.flatMap((view): CustomView[] =>
        isObject(view) && typeof view.id === 'string'
            ? [
                  {
                      id: view.id,
                      config: isObject(view.config) ? view.config : null,
                  },
              ]
            : []
    );
};
const configuredChildId = (
    config: PortalFieldConfig | undefined,
    creating: boolean
): string | null => {
    if (config == null) return null;
    if (
        creating &&
        config.layout !== 'form' &&
        config.allowCreatingRecords !== true
    )
        return null;
    if (!creating && config.allowEditingRecords !== true) return null;
    const sameForm =
        config.allowEditingRecords === true &&
        config.allowCreatingRecords === true &&
        (config.formsForEditingAndCreating == null ||
            config.formsForEditingAndCreating === 'same-form') &&
        (!creating || config.layout !== 'form');
    const value = sameForm
        ? config.extensionIdForCreatingAndEditing
        : creating
          ? config.extensionIdForCreating
          : config.extensionIdForEditing;
    return typeof value === 'string' && value !== '' ? value : null;
};
const detailFields = (
    value: RuntimeLinkedRecordDetailField[] | undefined
): DetailField[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((field): DetailField[] => {
        if (
            !isObject(field) ||
            typeof field.fieldId !== 'string' ||
            field.isHidden === true
        )
            return [];
        // Inline authorization uses the child Form config when present,
        // including its defaults, and otherwise the published detail config.
        const config =
            field.childFormField != null
                ? field.childFormField.config.config
                : field.miniExtConfig;
        const miniExtConfig = isObject(config) ? config : undefined;
        return [
            {
                fieldId: field.fieldId,
                title:
                    typeof field.titleOverride === 'string'
                        ? field.titleOverride
                        : null,
                miniExtConfig,
                inlineEditable:
                    miniExtConfig === undefined ||
                    !('readOnly' in miniExtConfig) ||
                    miniExtConfig.readOnly !== true,
            },
        ];
    });
};
const gridValue = (value: AirtableValue): RuntimeGridCellValue => {
    if (value == null) return null;
    if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number'
    )
        return value;
    if (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string')
    )
        return value.filter(
            (entry): entry is string => typeof entry === 'string'
        );
    throw new Error('Use the child Form for this complex field type.');
};

export const createPortalView = (options: {
    page: PortalLoadedResult;
    client: MiniExtensionsClient;
    getScope(): PortalOwnerScope;
    run: Run;
    status(message: string, error?: boolean): void;
    confirm(options: ConfirmationOptions): Promise<boolean>;
    openChild(
        page: FormLoadedResult,
        context: SaveFormInput['context'],
        scope: ParentFormDraftScope
    ): void;
}): PortalView => {
    const { page, run, status } = options;
    const card = element('section', undefined, 'card');
    card.append(element('h2', page.payload.extensionName ?? 'Custom Portal'));
    card.append(
        element(
            'p',
            `Signed in record: ${page.payload.formRecord.recordId}`,
            'hint'
        )
    );
    const fields = page.payload.fieldIdsInPortal.filter(
        (fieldId) =>
            page.payload.fieldIdsToSchemas[fieldId]?.fieldType ===
            AirtableFieldType.MULTIPLE_RECORD_LINKS
    );
    const fieldSelect = element('select');
    const viewSelect = element('select');
    const search = element('input');
    search.placeholder = 'Search this table';
    search.maxLength = 1000;
    for (const fieldId of fields) {
        const schema = page.payload.fieldIdsToSchemas[fieldId];
        fieldSelect.append(
            new Option(schema?.airtableField.name ?? fieldId, fieldId)
        );
    }
    const toolbar = element('div', undefined, 'toolbar');
    toolbar.append(
        labeled('Table', fieldSelect),
        labeled('Configured view', viewSelect),
        labeled('Search', search)
    );
    card.append(toolbar);
    const actions = element('div', undefined, 'actions');
    const results = element('div', undefined, 'table-scroll');
    const editor = element('section');
    let editorControl: FieldControl | null = null;
    const closeEditor = (): void => {
        editorControl?.destroy();
        editorControl = null;
        editor.replaceChildren();
    };
    card.append(actions, results, editor);
    let data: PortalCollectionSnapshot | null = null;
    let collection: PortalCollection | null = null;
    let needsRefresh = false;
    let readRequired = false;
    let destroyed = false;
    const retireCollection = (): void => {
        collection?.destroy();
        collection = null;
        readRequired = true;
        next.disabled = true;
        create.disabled = true;
    };
    const getCollection = (): PortalCollection => {
        if (destroyed) throw new Error('This Portal view has been replaced.');
        return (collection ??= createPortalCollection({
            client: options.client,
            portal: page,
            portalFieldId: fieldSelect.value,
            criteria: {
                selectedCustomViewId: viewSelect.value,
                searchTerm: search.value || null,
                sortFieldsByEndUser: null,
                filtersByEndUser: null,
                searchParamsMap: {},
            },
            getScope: options.getScope,
        }));
    };

    const schema = () => page.payload.fieldIdsToSchemas[fieldSelect.value];
    const config = (): PortalFieldConfig | undefined => schema()?.miniExtConfig;
    const field = () => schema()?.airtableField;
    const tableId = (): string | null => {
        const selected = field();
        return selected?.config.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
            ? selected.config.options.linkedTableId
            : null;
    };
    const selectedView = () =>
        customViews(config()).find((view) => view.id === viewSelect.value);
    // Custom views replace these layout settings, including omitted values.
    const layoutSetting = (
        key: keyof Pick<
            PortalFieldConfig,
            | 'layout'
            | 'disableInlineEdit'
            | 'allowUsersToUnlinkRecords'
            | 'kanbanCategoryField'
        >
    ) =>
        data != null
            ? data.layoutSettings[key]
            : selectedView()?.config?.viewBehavior === 'custom'
              ? selectedView()?.config?.[key]
              : config()?.[key];
    const fillViews = (): void => {
        viewSelect.replaceChildren();
        for (const view of customViews(config())) {
            viewSelect.append(
                new Option(
                    typeof view.config?.name === 'string'
                        ? view.config.name
                        : 'Default view',
                    view.id
                )
            );
        }
        if (viewSelect.options.length === 0)
            viewSelect.append(new Option('Legacy default view', ''));
    };
    const reset = (): void => {
        cancelConfirmation();
        retireCollection();
        readRequired = false;
        data = null;
        closeEditor();
        results.replaceChildren(
            element('p', 'Choose Load records to fetch this view.', 'hint')
        );
        next.disabled = true;
        create.disabled =
            needsRefresh || configuredChildId(config(), true) == null;
    };

    const openChild = (recordId: string | null): void => {
        const creating = recordId == null;
        const childId = configuredChildId(config(), creating);
        if (needsRefresh || readRequired) {
            status(
                needsRefresh
                    ? 'Reload the Portal before opening a child Form.'
                    : 'Load a fresh Portal view before opening a child Form.',
                true
            );
            return;
        }
        if (childId == null) {
            status('No child Form is configured for this action.', true);
            return;
        }
        void run(
            creating
                ? 'Loading the create Form…'
                : 'Loading the authorized record Form…',
            async ({ client, signal, current }) => {
                const owner = getCollection();
                const plan = owner.childFormRequest({
                    access:
                        recordId == null
                            ? { type: 'create' }
                            : { type: 'edit', recordId },
                    configuredChildExtensionId: childId,
                    query: {},
                    clientTimeZone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
                const accepted = () =>
                    current() && collection === owner && plan.isCurrent();
                if (!accepted() || client !== options.client) return;
                const loaded = await client.loadExtension(plan.input, {
                    signal,
                });
                if (!accepted()) return;
                if (loaded.extensionScreen !== 'form_loaded')
                    throw new Error(
                        'The child did not return a Form. Reload the Portal and its selected view.'
                    );
                const record = loaded.payload.formRecord;
                if (
                    loaded.extensionId !== childId ||
                    (creating
                        ? record.type !== 'create'
                        : record.type !== 'edit' ||
                          record.recordId !== recordId ||
                          record.tableId !==
                              plan.input.context
                                  .linkedTableIdOfLinkedRecordField)
                )
                    throw new Error(
                        'The child Form does not match this request.'
                    );
                if (!accepted()) return;
                // After this guarded handoff, the existing Form owner keeps
                // its explicit Save context and cached visitor draft behavior.
                options.openChild(loaded, plan.saveContext, plan.parent);
                status(
                    creating
                        ? 'Create Form loaded. No record has been created yet.'
                        : 'Record Form loaded.'
                );
            }
        );
    };

    const editCell = (
        recordId: string,
        recordField: RuntimeAirtableField,
        value: AirtableValue,
        miniExtConfig: RuntimeFieldSchema['miniExtConfig']
    ): void => {
        closeEditor();
        const form = element('form', undefined, 'card');
        const control = fieldControl(
            recordField,
            miniExtConfig,
            value,
            () => {}
        );
        editorControl = control;
        form.append(element('h3', `Edit ${recordField.name}`), control.node);
        if (
            recordField.config.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
        ) {
            const search = element('input');
            search.placeholder = 'Search permitted linked records';
            const choices = element('div', undefined, 'choice-list');
            let offset: string | null = null;
            const fetchOptions = (more: boolean): void => {
                void run(
                    'Loading permitted linked choices…',
                    async ({ client, signal, current }) => {
                        const portalTableId = tableId();
                        if (portalTableId == null) return;
                        const result =
                            await client.linkedRecords.listPortalOptions(
                                {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                    linkedRecordFieldId: recordField.id,
                                    portalTableId,
                                    portalFieldId: fieldSelect.value,
                                    filter: {
                                        viewType: 'list',
                                        searchTerm: search.value,
                                    },
                                    offset: more ? offset : null,
                                },
                                { signal }
                            );
                        if (!current()) return;
                        if (!more) choices.replaceChildren();
                        offset = result.offset;
                        for (const option of result.records) {
                            const checkbox = element('input');
                            checkbox.type = 'checkbox';
                            const currentValue = control.read();
                            checkbox.checked =
                                Array.isArray(currentValue) &&
                                currentValue.includes(option.id);
                            checkbox.addEventListener('change', () => {
                                const previous = control.read();
                                const selected = new Set(
                                    Array.isArray(previous)
                                        ? previous.filter(
                                              (entry): entry is string =>
                                                  typeof entry === 'string'
                                          )
                                        : []
                                );
                                if (checkbox.checked) selected.add(option.id);
                                else selected.delete(option.id);
                                control.write([...selected]);
                            });
                            const linkedTableId =
                                recordField.config.type ===
                                AirtableFieldType.MULTIPLE_RECORD_LINKS
                                    ? recordField.config.options.linkedTableId
                                    : '';
                            const primary = result.tableIdsToLinkedTableStates[
                                linkedTableId
                            ]?.airtableFields.find(
                                (column) => column.isPrimaryField
                            );
                            choices.append(
                                labeled(
                                    primary == null
                                        ? option.id
                                        : displayValue(
                                              option.fields[primary.id]
                                          ) || option.id,
                                    checkbox
                                )
                            );
                        }
                        moreButton.disabled = offset == null;
                        status(
                            'Permitted linked choices loaded. Save cell to apply the selection.'
                        );
                    }
                );
            };
            const moreButton = button('More choices', () => fetchOptions(true));
            moreButton.disabled = true;
            search.addEventListener('input', () => {
                offset = null;
                moreButton.disabled = true;
            });
            form.append(
                labeled('Search choices', search),
                button('Search choices', () => fetchOptions(false)),
                moreButton,
                choices
            );
        }
        const save = element('button', 'Save cell');
        save.type = 'submit';
        const buttons = element('div', undefined, 'actions');
        buttons.append(save, button('Cancel', closeEditor));
        form.append(buttons);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void run(
                'Saving the grid cell…',
                async ({ client, signal, current }) => {
                    if (needsRefresh)
                        throw new Error(
                            'Reload the Portal before saving another cell.'
                        );
                    const input = {
                        portalExtensionAccessToken:
                            page.payload.extensionAccessToken,
                        portalFieldId: fieldSelect.value,
                        recordFieldId: recordField.id,
                        recordId,
                        value: gridValue(control.read()),
                        selectedCustomViewId: viewSelect.value,
                    };
                    signal.throwIfAborted();
                    // Once dispatched, even cancellation or a lost response
                    // can leave changed parent data on the server. Keep the
                    // inline draft, but retire its captured child/read context.
                    retireCollection();
                    needsRefresh = true;
                    const result = await client.portals.updateGridCell(input, {
                        signal,
                    });
                    if (!current()) return;
                    const linkedTableId = tableId();
                    if (
                        linkedTableId != null &&
                        data != null &&
                        data.tableIdsToLinkedTableStates[linkedTableId] != null
                    ) {
                        const records =
                            data.tableIdsToLinkedTableStates[linkedTableId]
                                .recordIdsToAirtableRecords;
                        records[recordId] = {
                            id: recordId,
                            fields: {
                                ...records[recordId]?.fields,
                                ...result.record.fields,
                            },
                        };
                    }
                    const user = await client.portals.getUserRecord(
                        {
                            extensionAccessToken:
                                page.payload.extensionAccessToken,
                        },
                        { signal }
                    );
                    if (!current()) return;
                    if (user != null)
                        page.payload.formRecord.data = { ...user.fields };
                    needsRefresh = false;
                    closeEditor();
                    renderRecords();
                    status(
                        'Cell saved and Portal user refreshed. Load records before paging or opening a child Form.'
                    );
                }
            );
        });
        editor.append(form);
        control.node
            .querySelector('input, select, textarea')
            ?.scrollIntoView({ block: 'nearest' });
    };

    const renderRecords = (): void => {
        results.replaceChildren();
        const linkedTableId = tableId();
        if (linkedTableId == null || data == null) return;
        const state = data.tableIdsToLinkedTableStates[linkedTableId];
        if (state == null) {
            results.append(element('p', 'No table data was returned.', 'hint'));
            return;
        }
        const columns = detailFields(data.detailFields);
        const table = element('table');
        const head = element('tr');
        for (const column of columns)
            head.append(
                element(
                    'th',
                    column.title ??
                        state.airtableFields.find(
                            (entry) => entry.id === column.fieldId
                        )?.name ??
                        column.fieldId
                )
            );
        head.append(element('th', 'Actions'));
        const thead = element('thead');
        thead.append(head);
        table.append(thead);
        const tbody = element('tbody');
        const view = selectedView();
        const allowEditing = view?.config?.disableEditingForCustomView !== true;
        for (const recordId of data.recordIds) {
            const record = state.recordIdsToAirtableRecords[recordId];
            if (record == null) continue;
            const row = element('tr');
            row.dataset.recordId = recordId;
            for (const column of columns) {
                const cell = element(
                    'td',
                    displayValue(record.fields[column.fieldId])
                );
                const recordField = state.airtableFields.find(
                    (entry) => entry.id === column.fieldId
                );
                const gridMode = layoutSetting('layout') === 'grid';
                if (
                    gridMode &&
                    allowEditing &&
                    column.inlineEditable &&
                    recordField != null &&
                    !recordField.isComputed &&
                    layoutSetting('disableInlineEdit') !== true
                ) {
                    cell.append(
                        button('Edit cell', () =>
                            editCell(
                                recordId,
                                recordField,
                                record.fields[column.fieldId],
                                column.miniExtConfig
                            )
                        )
                    );
                }
                row.append(cell);
            }
            const controls = element('td', undefined, 'record-actions');
            if (allowEditing && configuredChildId(config(), false) != null)
                controls.append(button('Open Form', () => openChild(recordId)));
            if (
                allowEditing &&
                layoutSetting('allowUsersToUnlinkRecords') === true
            )
                controls.append(
                    button('Unlink', async () => {
                        const owner = collection;
                        if (
                            readRequired ||
                            owner == null ||
                            !owner.isCurrent()
                        ) {
                            status(
                                'Load a fresh Portal view before unlinking.',
                                true
                            );
                            return;
                        }
                        const portalFieldId = fieldSelect.value;
                        const selectedCustomViewId = viewSelect.value;
                        if (
                            !(await options.confirm({
                                title: 'Unlink this record?',
                                message:
                                    'Remove this record from the current Portal user. The Airtable record itself remains.',
                                confirmLabel: 'Unlink record',
                            }))
                        )
                            return;
                        if (
                            collection !== owner ||
                            !owner.isCurrent() ||
                            fieldSelect.value !== portalFieldId ||
                            viewSelect.value !== selectedCustomViewId
                        )
                            return;
                        await run(
                            'Unlinking this record…',
                            async ({ client, signal, current }) => {
                                // Retire before dispatch: even a cancelled or failed unlink
                                // may have changed the parent token on the server.
                                needsRefresh = true;
                                reset();
                                await client.portals.unlinkRecord(
                                    {
                                        extensionAccessToken:
                                            page.payload.extensionAccessToken,
                                        portalFieldId,
                                        recordIdToUnlink: recordId,
                                        selectedCustomViewId,
                                    },
                                    { signal }
                                );
                                if (!current()) return;
                                status(
                                    'Record unlinked. Choose Reload to obtain a fresh Portal token.'
                                );
                            }
                        );
                    })
                );
            const categoryId = layoutSetting('kanbanCategoryField');
            const category =
                typeof categoryId === 'string'
                    ? state.airtableFields.find(
                          (column) => column.id === categoryId
                      )
                    : null;
            if (
                allowEditing &&
                layoutSetting('layout') === 'kanban' &&
                category?.config.type === AirtableFieldType.SINGLE_SELECT
            ) {
                const categorySelect = element('select');
                categorySelect.setAttribute(
                    'aria-label',
                    `Category for ${recordId}`
                );
                categorySelect.append(new Option('Uncategorized', ''));
                for (const choice of category.config.options?.choices ?? [])
                    categorySelect.append(new Option(choice.name, choice.name));
                categorySelect.value =
                    typeof record.fields[category.id] === 'string'
                        ? String(record.fields[category.id])
                        : '';
                controls.append(
                    categorySelect,
                    button('Move category', () => {
                        void run(
                            'Moving the record category…',
                            async ({ client, signal, current }) => {
                                const result =
                                    await client.portals.setKanbanCategory(
                                        {
                                            extensionAccessToken:
                                                page.payload
                                                    .extensionAccessToken,
                                            portalFieldId: fieldSelect.value,
                                            recordId,
                                            categoryFieldValue:
                                                categorySelect.value || null,
                                            selectedCustomViewId:
                                                viewSelect.value,
                                        },
                                        { signal }
                                    );
                                if (!current()) return;
                                if (result.type === 'logged-in')
                                    page.payload.formRecord.data = {
                                        ...result.loggedInUserRecord.fields,
                                    };
                                reset();
                                status(
                                    'Category moved. Load records to refresh this view.'
                                );
                            }
                        );
                    })
                );
            }
            row.append(controls);
            tbody.append(row);
        }
        table.append(tbody);
        results.append(
            element(
                'p',
                `${data.recordIds.length} loaded records${data.airtableOffset == null ? '' : ' · more available'}`,
                'hint'
            ),
            table
        );
        if (data.recordIds.length === 0)
            results.append(element('p', 'No matching records.', 'hint'));
        next.disabled = readRequired || data.airtableOffset == null;
    };

    const fetchRecords = (more: boolean): void => {
        if (needsRefresh) {
            status('Choose Reload before using this Portal token again.', true);
            return;
        }
        void run(
            'Loading the permitted Portal records…',
            async ({ signal, current }) => {
                signal.throwIfAborted();
                if (!more) reset();
                const owner = getCollection();
                readRequired = true;
                next.disabled = true;
                create.disabled = true;
                const accepted = () =>
                    current() && collection === owner && owner.isCurrent();
                try {
                    const readOptions = {
                        pagesToFetch: 1 as const,
                        refreshLoggedInPortalRecord: !more,
                        signal,
                    };
                    const result = more
                        ? await owner.readNext(readOptions)
                        : await owner.readFirst(readOptions);
                    if (!accepted()) return;
                    if (result?.type === 'criteria-cleanup-required') {
                        needsRefresh = true;
                        reset();
                        status(
                            'Saved filters or sorts need cleanup. This example has no persisted criteria; reload the Portal.',
                            true
                        );
                        return;
                    }
                    if (result != null) data = result.snapshot;
                    readRequired = false;
                    create.disabled = configuredChildId(config(), true) == null;
                    closeEditor();
                    renderRecords();
                    status(
                        result == null
                            ? 'This view has no more pages.'
                            : `Loaded ${result.raw.recordIds.length} records. This read grants only the selected view's permitted actions.`
                    );
                } catch (error) {
                    if (collection !== owner || !owner.isCurrent()) return;
                    // The helper owns failure/cancellation recovery. Keep any
                    // last accepted next-page rows for display only.
                    if (collection === owner) {
                        next.disabled = true;
                        create.disabled = true;
                    }
                    throw error;
                }
            }
        );
    };
    const first = button('Load records', () => fetchRecords(false));
    const next = button('Next page', () => fetchRecords(true));
    const create = button('Create record', () => {
        if (needsRefresh) {
            status('Reload the Portal before creating a record.', true);
            return;
        }
        openChild(null);
    });
    actions.append(first, next, create);
    fieldSelect.addEventListener('change', () => {
        fillViews();
        reset();
    });
    viewSelect.addEventListener('change', reset);
    search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            fetchRecords(false);
        }
    });
    search.addEventListener('input', reset);
    fillViews();
    reset();
    if (fields.length === 0)
        status('This Portal has no configured linked-record tables.', true);
    return {
        node: card,
        closeEditor,
        retireCollection,
        destroy: () => {
            destroyed = true;
            retireCollection();
            closeEditor();
        },
        refreshRequired: () => {
            needsRefresh = false;
            reset();
        },
    };
};
