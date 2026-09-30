import {
    AirtableFieldType,
    type FormLoadedResult,
    type JsonObject,
    type ListPortalLinkedRecordsResult,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type RuntimeGridCellValue,
    type SaveFormInput,
} from '@miniextensions/sdk';
import type { AirtableValue } from '@miniextensions/sdk/formulas';
import { button, element, labeled } from './dom.js';
import { displayValue, fieldControl } from './fields.js';
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
export type PortalView = { node: HTMLElement; refreshRequired(): void };
type CustomView = { id: string; config: JsonObject | null };
type DetailField = { fieldId: string; title: string | null };

const isObject = (value: unknown): value is JsonObject =>
    typeof value === 'object' && value != null && !Array.isArray(value);

const customViews = (config: JsonObject | undefined): CustomView[] => {
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
    config: JsonObject | undefined,
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
        config.layout !== 'form';
    const value = sameForm
        ? config.extensionIdForCreatingAndEditing
        : creating
          ? config.extensionIdForCreating
          : config.extensionIdForEditing;
    return typeof value === 'string' && value !== '' ? value : null;
};
const detailFields = (value: unknown): DetailField[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((field): DetailField[] =>
        isObject(field) &&
        typeof field.fieldId === 'string' &&
        field.isHidden !== true
            ? [
                  {
                      fieldId: field.fieldId,
                      title:
                          typeof field.titleOverride === 'string'
                              ? field.titleOverride
                              : null,
                  },
              ]
            : []
    );
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
    card.append(actions, results, editor);
    let data: ListPortalLinkedRecordsResult | null = null;
    let needsRefresh = false;
    let returnedRecordIds: string[] = [];

    const schema = () => page.payload.fieldIdsToSchemas[fieldSelect.value];
    const config = () => schema()?.miniExtConfig;
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
    const layoutSetting = (key: string) =>
        selectedView()?.config?.viewBehavior === 'custom'
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
        data = null;
        returnedRecordIds = [];
        editor.replaceChildren();
        results.replaceChildren(
            element('p', 'Choose Load records to fetch this view.', 'hint')
        );
        next.disabled = true;
        create.disabled = configuredChildId(config(), true) == null;
    };

    const openChild = (recordId: string | null): void => {
        const creating = recordId == null;
        const childId = configuredChildId(config(), creating);
        const linkedTableId = tableId();
        const selected = field();
        if (childId == null || linkedTableId == null || selected == null) {
            status('No child Form is configured for this action.', true);
            return;
        }
        const inverseId =
            selected.config.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
                ? selected.config.options.inverseLinkFieldId
                : null;
        const prefillField = config()?.prefillFieldForCreatingChildExtension;
        const prefillValue =
            typeof prefillField === 'string'
                ? page.payload.formRecord.data[prefillField]
                : null;
        const prefillData = creating
            ? {
                  toLinkToParent:
                      inverseId == null
                          ? null
                          : {
                                reversedFieldIdToPrefill: inverseId,
                                parentFormRecordId:
                                    page.payload.formRecord.recordId,
                            },
                  prefillQueryForChildExtension:
                      typeof prefillValue === 'string' ? prefillValue : null,
              }
            : null;
        void run(
            creating
                ? 'Loading the create Form…'
                : 'Loading the authorized record Form…',
            async ({ client, signal, current }) => {
                const loaded = await client.loadExtension(
                    {
                        childExtensionAccessData: {
                            parentExtensionAccessToken:
                                page.payload.extensionAccessToken,
                            fieldIdUsedToAccessExtension: fieldSelect.value,
                        },
                        childExtensionInfo: {
                            childExtensionId: childId,
                            accessType:
                                recordId == null
                                    ? { type: 'create' }
                                    : {
                                          type: 'edit',
                                          childExtensionRecordId: recordId,
                                          childExtensionFieldId: null,
                                      },
                        },
                        context: {
                            type: 'modal',
                            linkedTableIdOfLinkedRecordField: linkedTableId,
                            prefillDataForLinkedRecordsForm: prefillData,
                        },
                        query: {},
                        clientTimeZone:
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                    { signal }
                );
                if (!current()) return;
                if (loaded.extensionScreen !== 'form_loaded')
                    throw new Error(
                        'The child did not return a Form. Reload the Portal and its selected view.'
                    );
                options.openChild(
                    loaded,
                    { type: 'modal', prefillData },
                    {
                        portalId: page.extensionId,
                        recordId: page.payload.formRecord.recordId,
                        portalFieldId: fieldSelect.value,
                    }
                );
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
        value: AirtableValue
    ): void => {
        editor.replaceChildren();
        const form = element('form', undefined, 'card');
        const control = fieldControl(
            { fieldType: recordField.config.type, airtableField: recordField },
            value,
            () => {}
        );
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
        buttons.append(
            save,
            button('Cancel', () => editor.replaceChildren())
        );
        form.append(buttons);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void run(
                'Saving the grid cell…',
                async ({ client, signal, current }) => {
                    const result = await client.portals.updateGridCell(
                        {
                            portalExtensionAccessToken:
                                page.payload.extensionAccessToken,
                            portalFieldId: fieldSelect.value,
                            recordFieldId: recordField.id,
                            recordId,
                            value: gridValue(control.read()),
                            selectedCustomViewId: viewSelect.value,
                        },
                        { signal }
                    );
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
                    editor.replaceChildren();
                    renderRecords();
                    status('Cell saved and Portal user refreshed.');
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
        let columns = detailFields(
            data.customViewDetailFields?.[fieldSelect.value] ??
                page.payload.linkedRecordFieldIdToDetailFields[
                    fieldSelect.value
                ]
        );
        if (columns.length === 0) {
            const primary =
                state.airtableFields.find((column) => column.isPrimaryField) ??
                state.airtableFields[0];
            if (primary != null)
                columns = [{ fieldId: primary.id, title: null }];
        }
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
        for (const recordId of returnedRecordIds) {
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
                    recordField != null &&
                    !recordField.isComputed &&
                    layoutSetting('disableInlineEdit') !== true
                ) {
                    cell.append(
                        button('Edit cell', () =>
                            editCell(
                                recordId,
                                recordField,
                                record.fields[column.fieldId]
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
                            fieldSelect.value !== portalFieldId ||
                            viewSelect.value !== selectedCustomViewId
                        )
                            return;
                        await run(
                            'Unlinking this record…',
                            async ({ client, signal, current }) => {
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
                                // Unlink retires the parent token. Reload it before any action.
                                needsRefresh = true;
                                reset();
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
                `${returnedRecordIds.length} loaded records${data.airtableOffset == null ? '' : ' · more available'}`,
                'hint'
            ),
            table
        );
        if (returnedRecordIds.length === 0)
            results.append(element('p', 'No matching records.', 'hint'));
        next.disabled = data.airtableOffset == null;
    };

    const fetchRecords = (more: boolean): void => {
        if (needsRefresh) {
            status('Choose Reload before using this Portal token again.', true);
            return;
        }
        void run(
            'Loading the permitted Portal records…',
            async ({ client, signal, current }) => {
                const result = await client.portals.listLinkedRecords(
                    {
                        extensionAccessToken: page.payload.extensionAccessToken,
                        portalFieldId: fieldSelect.value,
                        selectedCustomViewId: viewSelect.value,
                        alreadyLoadedRecordIds: more ? returnedRecordIds : [],
                        airtableOffset: more
                            ? (data?.airtableOffset ?? null)
                            : null,
                        pagesToFetch: 1,
                        searchTerm: search.value || null,
                        sortFieldsByEndUser: null,
                        filtersByEndUser: null,
                        searchParamsMap: {},
                        refreshLoggedInPortalRecord: !more,
                    },
                    { signal }
                );
                if (!current()) return;
                if (
                    result.endUserFilterCleanup != null ||
                    result.endUserSortCleanup != null
                ) {
                    status(
                        'Saved filters or sorts need cleanup. This example has no persisted criteria; reload the Portal.',
                        true
                    );
                    return;
                }
                if (more && data != null) {
                    for (const [id, table] of Object.entries(
                        result.tableIdsToLinkedTableStates
                    )) {
                        const previous = data.tableIdsToLinkedTableStates[id];
                        result.tableIdsToLinkedTableStates[id] = {
                            airtableFields: table.airtableFields,
                            recordIdsToAirtableRecords: {
                                ...previous?.recordIdsToAirtableRecords,
                                ...table.recordIdsToAirtableRecords,
                            },
                        };
                    }
                    // Preserve nested tables not included in this page.
                    result.tableIdsToLinkedTableStates = {
                        ...data.tableIdsToLinkedTableStates,
                        ...result.tableIdsToLinkedTableStates,
                    };
                    returnedRecordIds = [
                        ...new Set([...returnedRecordIds, ...result.recordIds]),
                    ];
                } else returnedRecordIds = [...result.recordIds];
                data = result;
                editor.replaceChildren();
                renderRecords();
                status(
                    `Loaded ${result.recordIds.length} records. This read grants only the selected view's permitted actions.`
                );
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
    search.addEventListener('input', () => {
        next.disabled = true;
    });
    fillViews();
    reset();
    if (fields.length === 0)
        status('This Portal has no configured linked-record tables.', true);
    return {
        node: card,
        refreshRequired: () => {
            needsRefresh = false;
            reset();
        },
    };
};
