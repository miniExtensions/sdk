import {
    mountPortalScalarFilterEditor,
    type PortalFilterEditor,
} from './portalFilter.js';
import { mountPortalSortEditor, type PortalSortEditor } from './portalSort.js';
import {
    childQuerySnapshots,
    type ChildQuerySnapshots,
} from './childQueries.js';
import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type RuntimeLinkedRecordDetailField,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '@miniextensions/sdk';
import {
    createPortalCollection,
    createPortalCellBinding,
    type PortalCellBinding,
    getPortalLinkedRecordFieldConfig,
    type PortalCollection,
    type PortalCollectionSnapshot,
    type PortalCollectionCriteria,
    type PortalOwnerScope,
} from '@miniextensions/sdk/portals';
import { button, element, labeled } from './dom.js';
import {
    displayValue,
    mountBoundFormField,
    type FieldControl,
} from './fields.js';
import type { ParentFormDraftScope } from './drafts.js';
import {
    sameRecoveryRelationship,
    RecoveryJournal,
    type RecoveryScope,
    type RecoveryAttempt,
} from './recovery.js';
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
    checkLatestRequests(): void;
    refreshRecovery(): void;
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
        { type: 'multipleRecordLinks' | 'multipleLookupValues' }
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
    displayConfig: unknown;
    inlineEditable: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value != null && !Array.isArray(value);

// A deliberately plain Portal presentation, not a Form policy or an uploader.
// Returned native metadata stays untouched and is never serialized into the DOM.
const attachmentSummary = (value: unknown, displayConfig: unknown): string => {
    if (
        value == null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0)
    )
        return '';
    if (!Array.isArray(value)) return 'Attachment presentation unavailable';
    const showNames =
        isObject(displayConfig) && displayConfig.hideAttachmentName === false;
    const lines: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const attachment: unknown = value[index];
        if (
            !Object.hasOwn(value, index) ||
            !isObject(attachment) ||
            typeof attachment.url !== 'string' ||
            'label' in attachment ||
            (attachment.filename !== undefined &&
                typeof attachment.filename !== 'string')
        )
            return 'Attachment presentation unavailable';
        lines.push(
            showNames &&
                typeof attachment.filename === 'string' &&
                attachment.filename.trim() !== ''
                ? attachment.filename
                : 'Attachment'
        );
    }
    return lines.join('\n');
};

// The canonical grid route denies conditional fields/options and active linked
// filters, even when an option entry only supplies a display label. Static UI
// policy must not present those configurations as eligible inline writes.
const hasInlineBlockingConfig = (
    config: RuntimeFieldSchema['miniExtConfig']
): boolean =>
    config != null &&
    (('conditionalFields' in config &&
        config.conditionalFields != null &&
        config.conditionalFields.conditions.length !== 0) ||
        ('conditionsForOptions' in config &&
            config.conditionsForOptions != null &&
            config.conditionsForOptions.length !== 0) ||
        ('filterLinkedRecordsConditionFields' in config &&
            (!('filterLinkedRecordsToggle' in config) ||
                config.filterLinkedRecordsToggle !== false) &&
            config.filterLinkedRecordsConditionFields != null));

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
                // Returned display policy merges child defaults then Portal
                // overrides. The child-first config above is write authority.
                displayConfig: field.miniExtConfig,
                inlineEditable:
                    (miniExtConfig === undefined ||
                        !('readOnly' in miniExtConfig) ||
                        miniExtConfig.readOnly !== true) &&
                    !hasInlineBlockingConfig(miniExtConfig),
            },
        ];
    });
};

export const createPortalView = (options: {
    page: PortalLoadedResult;
    client: MiniExtensionsClient;
    getScope(): PortalOwnerScope;
    run: Run;
    status(message: string, error?: boolean): void;
    confirm(options: ConfirmationOptions): Promise<boolean>;
    /** Optional complete owned criteria; no implicit persistence or filter editor. */
    initialCriteria?: PortalCollectionCriteria;
    recovery?: { journal: RecoveryJournal; owner: string };
    openChild(
        page: FormLoadedResult,
        context: SaveFormInput['context'],
        scope: ParentFormDraftScope,
        recovery?: {
            candidate?: RecoveryAttempt;
            newAttempt?: RecoveryAttempt;
            isCurrent(): boolean;
        },
        queries?: ChildQuerySnapshots
    ): void;
}): PortalView => {
    const { run, status } = options;
    // Configuration stays detached; accepted parent data advances after a
    // successful child Save without changing this view's identity or settings.
    const page = structuredClone(options.page);
    const acceptParentData = (data: typeof page.payload.formRecord.data) => {
        page.payload.formRecord.data = structuredClone(data);
        options.page.payload.formRecord.data = structuredClone(data);
    };
    const card = element('section', undefined, 'card');
    card.append(element('h2', page.payload.extensionName ?? 'Custom Portal'));
    card.append(
        element(
            'p',
            `Signed in record: ${page.payload.formRecord.recordId}`,
            'hint'
        )
    );
    const fields = page.payload.fieldIdsInPortal.filter((fieldId) => {
        const schema = page.payload.fieldIdsToSchemas[fieldId];
        return (
            schema?.airtableField.id === fieldId &&
            schema.fieldType === schema.airtableField.config.type &&
            getPortalLinkedRecordFieldConfig(schema.airtableField) !== null
        );
    });
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
    const sorting = element('section');
    const filtering = element('section');
    const cleanupPanel = element('section');
    cleanupPanel.setAttribute('aria-label', 'Portal criteria cleanup');
    const recoveryPanel = element('section');
    recoveryPanel.setAttribute('aria-label', 'Earlier request recovery');
    recoveryPanel.setAttribute('aria-live', 'polite');
    const editor = element('section');
    let editorControl: FieldControl | null = null;
    let cellOwner: PortalCellBinding | null = null;
    const cellJournal = options.recovery?.journal ?? new RecoveryJournal();
    const closeEditor = (): void => {
        cellOwner?.destroy();
        cellOwner = null;
        editorControl?.destroy();
        editorControl = null;
        editor.replaceChildren();
    };
    card.append(
        actions,
        sorting,
        filtering,
        cleanupPanel,
        recoveryPanel,
        results,
        editor
    );
    let data: PortalCollectionSnapshot | null = null;
    let dataScope: PortalOwnerScope | null = null;
    let collection: PortalCollection | null = null;
    let needsRefresh = false;
    let readRequired = false;
    let criteriaReadRequired = false;
    let destroyed = false;
    let criteriaEpoch = 0;
    let mountEpoch = 0;
    let sortEditor: PortalSortEditor | null = null;
    let filterEditor: PortalFilterEditor | null = null;
    let cleanupRequired = false;
    let criteria: PortalCollectionCriteria = structuredClone(
        options.initialCriteria ?? {
            selectedCustomViewId: '',
            searchTerm: null,
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            searchParamsMap: {},
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        }
    );
    const retireCriteriaEditors = (): void => {
        mountEpoch += 1;
        const previous = sortEditor;
        sortEditor = null;
        if (previous?.type === 'ready') previous.destroy();
        const previousFilter = filterEditor;
        filterEditor = null;
        if (previousFilter?.type === 'ready') previousFilter.destroy();
        sorting.replaceChildren();
        filtering.replaceChildren();
    };
    const clearCleanup = (): void => {
        cleanupRequired = false;
        cleanupPanel.replaceChildren();
    };
    const retireCollection = (): void => {
        // Retire eligibility before abort callbacks can reenter.
        const previous = collection;
        collection = null;
        readRequired = true;
        next.disabled = true;
        create.disabled = true;
        retireCriteriaEditors();
        clearCleanup();
        previous?.destroy();
    };
    const getCollection = (): PortalCollection => {
        if (destroyed) throw new Error('This Portal view has been replaced.');
        return (collection ??= createPortalCollection({
            client: options.client,
            portal: page,
            portalFieldId: fieldSelect.value,
            criteria: structuredClone(criteria),
            getScope: options.getScope,
        }));
    };

    const schema = () => page.payload.fieldIdsToSchemas[fieldSelect.value];
    const config = (): PortalFieldConfig | undefined => schema()?.miniExtConfig;
    const field = () => schema()?.airtableField;
    const tableId = (): string | null =>
        getPortalLinkedRecordFieldConfig(field())?.options.linkedTableId ??
        null;
    const directRelationship = (): boolean =>
        schema()?.fieldType === AirtableFieldType.MULTIPLE_RECORD_LINKS;
    const creatingChildId = (): string | null =>
        directRelationship() ? configuredChildId(config(), true) : null;
    const recoveryScope = (childExtensionId: string): RecoveryScope | null =>
        options.recovery == null
            ? null
            : {
                  owner: options.recovery.owner,
                  parentFieldId: fieldSelect.value,
                  tableId: tableId(),
                  childExtensionId,
                  context: 'modal',
              };
    const pendingForField = (): RecoveryAttempt[] => {
        const scope = recoveryScope(creatingChildId() ?? '');
        return scope == null
            ? []
            : options
                  .recovery!.journal.unknown(scope.owner)
                  .filter(
                      (attempt) =>
                          sameRecoveryRelationship(attempt.scope, scope) &&
                          attempt.acknowledgment === 'none'
                  );
    };
    const renderRecovery = (): void => {
        recoveryPanel.replaceChildren();
        const unknown =
            options.recovery?.journal.unknown(options.recovery.owner) ?? [];
        if (unknown.length === 0) return;
        recoveryPanel.append(element('h3', 'Earlier outcome not confirmed'));
        for (const attempt of unknown)
            recoveryPanel.append(
                element(
                    'p',
                    `${attempt.id}: the earlier ${attempt.operation} may have completed. Its outcome remains unconfirmed.${
                        attempt.acknowledgment === 'existing-request'
                            ? ' You chose to use an existing request; that is not confirmation of the earlier save.'
                            : attempt.acknowledgment === 'new-intent'
                              ? ' You chose a separate new request; the earlier attempt will not be replayed.'
                              : ''
                    }`
                )
            );
        recoveryPanel.append(
            element(
                'p',
                'Check the latest requests, then open a request you recognize. Matching text or a missing result cannot confirm whether the earlier save completed.'
            ),
            button('Check latest requests', () => fetchRecords(false))
        );
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
        criteriaEpoch += 1;
        criteria = {
            ...structuredClone(criteria),
            selectedCustomViewId: viewSelect.value,
            searchTerm: search.value || null,
        };
        cancelConfirmation();
        retireCollection();
        readRequired = criteriaReadRequired;
        data = null;
        dataScope = null;
        closeEditor();
        results.replaceChildren(
            element('p', 'Choose Load records to fetch this view.', 'hint')
        );
        next.disabled = true;
        create.disabled =
            readRequired || needsRefresh || creatingChildId() == null;
        renderRecovery();
    };

    // Apply/cleanup must not use reset(), which permits ordinary initial Create.
    const awaitExplicitRead = (): void => {
        criteriaReadRequired = true;
        retireCollection();
        closeEditor();
        data = null;
        dataScope = null;
        results.replaceChildren(
            element(
                'p',
                'Criteria changed. Choose Load records before opening or editing records.',
                'hint'
            )
        );
    };
    const mountCriteriaEditors = (): void => {
        retireCriteriaEditors();
        if (
            data == null ||
            collection == null ||
            readRequired ||
            !card.isConnected
        )
            return;
        const acceptedCollection = collection;
        const acceptedSnapshot = data;
        const acceptedEpoch = mountEpoch;
        const acceptedCriteriaEpoch = criteriaEpoch;
        const scope = { ...options.getScope() };
        const owned = (): boolean => {
            const current = options.getScope();
            return (
                !destroyed &&
                card.isConnected &&
                collection === acceptedCollection &&
                data === acceptedSnapshot &&
                mountEpoch === acceptedEpoch &&
                criteriaEpoch === acceptedCriteriaEpoch &&
                !readRequired &&
                current.ownerId === scope.ownerId &&
                current.revision === scope.revision &&
                acceptedCollection.isCurrent()
            );
        };
        sortEditor = mountPortalSortEditor({
            portal: page,
            portalFieldId: fieldSelect.value,
            criteria,
            snapshot: acceptedSnapshot,
            isCurrent: owned,
            onApply: (nextCriteria) => {
                if (!owned()) return;
                criteria = structuredClone(nextCriteria);
                criteriaEpoch += 1;
                awaitExplicitRead();
                status(
                    'Sort applied. Choose Load records to fetch the new order.'
                );
            },
        });
        sorting.append(
            sortEditor.type === 'ready'
                ? sortEditor.node
                : element('p', sortEditor.diagnostic, 'hint')
        );
        filterEditor = mountPortalScalarFilterEditor({
            portal: page,
            portalFieldId: fieldSelect.value,
            criteria,
            snapshot: acceptedSnapshot,
            isCurrent: owned,
            onApply: (nextCriteria) => {
                if (!owned()) return;
                criteria = structuredClone(nextCriteria);
                criteriaEpoch += 1;
                awaitExplicitRead();
                status(
                    'Filter applied. Choose Load records to fetch matching records.'
                );
            },
        });
        filtering.append(
            filterEditor.type === 'ready'
                ? filterEditor.node
                : element('p', filterEditor.diagnostic, 'hint')
        );
    };
    const proposeCleanup = (
        owner: PortalCollection,
        raw: import('@miniextensions/sdk').ListPortalLinkedRecordsResult
    ): void => {
        const proposal = structuredClone(raw);
        const acceptedCriteria = structuredClone(criteria);
        const epoch = criteriaEpoch;
        const scope = { ...options.getScope() };
        const owned = (): boolean => {
            const current = options.getScope();
            return (
                !destroyed &&
                card.isConnected &&
                collection === owner &&
                criteriaEpoch === epoch &&
                owner.isCurrent() &&
                current.ownerId === scope.ownerId &&
                current.revision === scope.revision
            );
        };
        // Cleanup is not an empty successful read and grants no actions.
        criteriaReadRequired = true;
        readRequired = true;
        next.disabled = true;
        create.disabled = true;
        closeEditor();
        data = null;
        dataScope = null;
        results.replaceChildren(
            element(
                'p',
                'The server returned a criteria cleanup proposal, not records.'
            )
        );
        clearCleanup();
        cleanupRequired = true;
        const replacements = {
            ...(proposal.endUserSortCleanup === undefined
                ? {}
                : {
                      sortFieldsByEndUser:
                          proposal.endUserSortCleanup.sortFields,
                  }),
            ...(proposal.endUserFilterCleanup === undefined
                ? {}
                : { filtersByEndUser: proposal.endUserFilterCleanup.filters }),
        };
        cleanupPanel.append(
            element('pre', JSON.stringify(replacements, null, 2))
        );
        cleanupPanel.append(
            button('Review criteria cleanup', () => {
                if (!owned()) return;
                void (async () => {
                    const yes = await options.confirm({
                        title: 'Accept criteria cleanup?',
                        message: JSON.stringify(replacements, null, 2),
                        confirmLabel: 'Accept criteria cleanup',
                    });
                    if (!yes || !owned()) return;
                    criteria = {
                        ...acceptedCriteria,
                        ...structuredClone(replacements),
                    };
                    criteriaEpoch += 1;
                    awaitExplicitRead();
                    status(
                        'Cleanup accepted. Choose Load records; another cleanup proposal may follow.'
                    );
                })().catch(() => {
                    if (owned())
                        status(
                            'Cleanup confirmation failed. Review the proposal again.',
                            true
                        );
                });
            })
        );
        status(
            'Saved sorts or filters need cleanup. Review the returned proposal before loading again.',
            true
        );
    };

    const openChild = async (
        recordId: string | null,
        candidate?: RecoveryAttempt
    ): Promise<void> => {
        const creating = recordId == null;
        const childId = creating
            ? creatingChildId()
            : configuredChildId(config(), false);
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
        if (destroyed || !card.isConnected) return;
        const before = getCollection();
        const prior = creating
            ? pendingForField().find((attempt) => attempt.recordId == null)
            : candidate;
        if (
            candidate != null &&
            (!data?.recordIds.includes(recordId!) ||
                !pendingForField().includes(candidate))
        )
            return;
        if (prior?.flight) {
            status(
                'Wait for the browser action to stop, then check the latest requests. The server outcome may still be unknown.',
                true
            );
            return;
        }
        if (creating && prior != null) {
            if (
                !(await options.confirm({
                    title: 'Start a separate request?',
                    message:
                        'The earlier request may still have saved. Starting another could create a duplicate. This opens a fresh form without copying earlier edits or files and does not retry the earlier attempt.',
                    confirmLabel: 'Start separate request',
                }))
            )
                return;
            if (
                destroyed ||
                !card.isConnected ||
                collection !== before ||
                !before.isCurrent() ||
                prior.flight ||
                prior.outcome !== 'unknown' ||
                prior.acknowledgment !== 'none'
            )
                return;
        }
        void run(
            creating
                ? 'Loading the create Form…'
                : 'Loading the authorized record Form…',
            async ({ client, signal, current }) => {
                const owner = getCollection();
                retireCriteriaEditors();
                clearCleanup();
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
                const dispatchedDynamic =
                    plan.input.context.prefillDataForLinkedRecordsForm
                        ?.prefillQueryForChildExtension;
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
                if (
                    candidate != null &&
                    (candidate.flight ||
                        candidate.outcome !== 'unknown' ||
                        candidate.acknowledgment !== 'none' ||
                        !pendingForField().includes(candidate))
                )
                    return;
                let newAttempt: RecoveryAttempt | undefined;
                if (creating && prior != null && options.recovery != null) {
                    if (
                        prior.flight ||
                        prior.outcome !== 'unknown' ||
                        prior.acknowledgment !== 'none'
                    )
                        return;
                    options.recovery.journal.acknowledgeNewIntent(prior);
                    const scope = recoveryScope(loaded.extensionId);
                    if (scope != null)
                        newAttempt = options.recovery.journal.prepare(
                            scope,
                            null,
                            0
                        );
                }
                options.openChild(
                    loaded,
                    structuredClone(plan.saveContext),
                    structuredClone(plan.parent),
                    {
                        candidate,
                        newAttempt,
                        isCurrent: plan.isCurrent,
                    },
                    childQuerySnapshots(dispatchedDynamic, loaded)
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
        value: AirtableValue,
        miniExtConfig: RuntimeFieldSchema['miniExtConfig'],
        displayConfig: unknown,
        title: string | null
    ): void => {
        const owner = { ...options.getScope() };
        const sameOwner = (): boolean => {
            const current = options.getScope();
            return (
                current.ownerId === owner.ownerId &&
                current.revision === owner.revision &&
                dataScope?.ownerId === owner.ownerId &&
                dataScope.revision === owner.revision
            );
        };
        if (
            destroyed ||
            !card.isConnected ||
            criteriaReadRequired ||
            !sameOwner() ||
            data == null ||
            !data.recordIds.includes(recordId)
        ) {
            status('Load a fresh Portal view before editing a cell.', true);
            return;
        }
        closeEditor();
        const form = element('form', undefined, 'card');
        const acceptedData = data;
        const portalFieldId = fieldSelect.value;
        const selectedCustomViewId = viewSelect.value;
        if (
            recordField.config.type === AirtableFieldType.MULTIPLE_ATTACHMENTS
        ) {
            // Preview only: native values never pass through a textarea or a
            // submit handler. Display policy is independent of edit authority.
            form.append(
                element('h3', title ?? 'Attachments'),
                element('p', attachmentSummary(value, displayConfig)),
                element(
                    'p',
                    'Use the child Form to change attachments.',
                    'hint'
                )
            );
            const currentPreview = (): boolean =>
                !destroyed &&
                form.isConnected &&
                card.isConnected &&
                editor.firstElementChild === form &&
                data === acceptedData &&
                fieldSelect.value === portalFieldId &&
                viewSelect.value === selectedCustomViewId &&
                sameOwner();
            form.append(
                button('Close', () => {
                    if (currentPreview()) closeEditor();
                })
            );
            form.addEventListener('submit', (event) => event.preventDefault());
            editor.append(form);
            status(
                'Attachment preview is read-only. Use the child Form to make changes.'
            );
            return;
        }
        const cellSchema = {
            fieldType: recordField.config.type,
            airtableField: recordField,
            miniExtConfig,
        } as RuntimeFieldSchema;
        let policyRetired = false;
        let mounting = true;
        const capturedPolicy = JSON.stringify([
            recordField,
            miniExtConfig,
            displayConfig,
        ]);
        const editorIsCurrent = (): boolean => {
            if (
                JSON.stringify([recordField, miniExtConfig, displayConfig]) !==
                capturedPolicy
            )
                policyRetired = true;
            return (
                !policyRetired &&
                !destroyed &&
                (mounting || (form.isConnected && editorControl === control)) &&
                sameOwner() &&
                data === acceptedData &&
                fieldSelect.value === portalFieldId &&
                viewSelect.value === selectedCustomViewId
            );
        };
        const cell = createPortalCellBinding({
            client: options.client,
            input: {
                portalExtensionAccessToken: page.payload.extensionAccessToken,
                portalFieldId,
                recordFieldId: recordField.id,
                recordId,
                selectedCustomViewId,
            },
            schema: cellSchema,
            value,
            getScope: options.getScope,
            isCurrent: editorIsCurrent,
            recovery: {
                journal: cellJournal,
                scope: {
                    owner: options.recovery?.owner ?? owner.ownerId,
                    parentFieldId: portalFieldId,
                    tableId: tableId(),
                    childExtensionId: '',
                    context: 'modal',
                },
                loadVersion: owner.revision,
            },
        });
        const control = mountBoundFormField(cell.binding, cellSchema, () => {});
        cellOwner = cell;
        editorControl = control;
        form.append(element('h3', `Edit ${recordField.name}`), control.node);
        if (
            recordField.config.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
        ) {
            const search = element('input');
            search.placeholder = 'Search permitted linked records';
            const choices = element('div', undefined, 'choice-list');
            let offset: string | null = null;
            let optionGeneration = 0;
            // Paging admission uses the accepted unfiltered list, never a searched snapshot.
            let loadedOptions: { value: string; label: string }[] = [];
            const fetchOptions = (more: boolean): void => {
                const expectedGeneration = ++optionGeneration;
                const query = search.value;
                void run(
                    'Loading permitted linked choices…',
                    async ({ client, signal, current }) => {
                        if (
                            !editorIsCurrent() ||
                            !cell.binding.getSnapshot().canEdit
                        )
                            return;
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
                                        searchTerm: query,
                                    },
                                    offset: more ? offset : null,
                                },
                                { signal }
                            );
                        if (
                            !current() ||
                            !editorIsCurrent() ||
                            optionGeneration !== expectedGeneration ||
                            search.value !== query
                        )
                            return;
                        if (!more) choices.replaceChildren();
                        offset = result.offset;
                        loadedOptions = [
                            ...(more ? loadedOptions : []),
                            ...result.records.map((option) => ({
                                value: option.id,
                                label: 'Linked record',
                            })),
                        ];
                        cell.binding.selection?.setOptions(loadedOptions);
                        for (const option of result.records) {
                            const checkbox = element('input');
                            checkbox.type = 'checkbox';
                            const currentValue = control.read();
                            checkbox.checked =
                                Array.isArray(currentValue) &&
                                currentValue.includes(option.id);
                            checkbox.addEventListener('change', () => {
                                if (
                                    !editorIsCurrent() ||
                                    !cell.binding.getSnapshot().canEdit
                                )
                                    return;
                                const previous =
                                    cell.binding.getSnapshot().value;
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
                                cell.binding.setValue([...selected]);
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
                if (!editorIsCurrent() || !cell.binding.getSnapshot().canEdit)
                    return;
                optionGeneration += 1;
                cell.binding.selection?.setSearchInput(search.value);
                choices.replaceChildren();
                loadedOptions = [];
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
            // Cached Portal drafts may survive a visitor switch, but their
            // old owner revision and disposed controls cannot dispatch writes.
            if (!editorIsCurrent()) {
                status(
                    'Load a fresh Portal view before saving this cell.',
                    true
                );
                return;
            }
            void run(
                'Saving the grid cell…',
                async ({ client, signal, current }) => {
                    if (!current() || !editorIsCurrent()) return;
                    if (needsRefresh)
                        throw new Error(
                            'Reload the Portal before saving another cell.'
                        );
                    signal.throwIfAborted();
                    const result = await cell.save({
                        signal,
                        dispatched: () => {
                            retireCollection();
                            needsRefresh = true;
                        },
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
                        const previousFields = {
                            ...records[recordId]?.fields,
                        };
                        // Airtable omits cleared values from this sparse response.
                        delete previousFields[recordField.id];
                        records[recordId] = {
                            id: recordId,
                            fields: {
                                ...previousFields,
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
                    if (user != null) acceptParentData(user.fields);
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
        mounting = false;
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
        const columns = detailFields(data.detailFields).filter((column) =>
            state.airtableFields.some((field) => field.id === column.fieldId)
        );
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
        const renderedData = data;
        const renderedOwner = dataScope == null ? null : { ...dataScope };
        const renderedFieldId = fieldSelect.value;
        const renderedViewId = viewSelect.value;
        for (const recordId of data.recordIds) {
            const record = state.recordIdsToAirtableRecords[recordId];
            if (record == null) continue;
            const row = element('tr');
            row.dataset.recordId = recordId;
            for (const column of columns) {
                const recordField = state.airtableFields.find(
                    (entry) => entry.id === column.fieldId
                );
                const value = record.fields[column.fieldId];
                const obscured =
                    recordField?.config.type ===
                        AirtableFieldType.SINGLE_LINE_TEXT &&
                    column.miniExtConfig != null &&
                    'obscurePassword' in column.miniExtConfig &&
                    column.miniExtConfig.obscurePassword === true &&
                    typeof value === 'string' &&
                    value.length > 0;
                const cell = element(
                    'td',
                    recordField?.config.type ===
                        AirtableFieldType.MULTIPLE_ATTACHMENTS
                        ? attachmentSummary(value, column.displayConfig)
                        : obscured
                          ? '••••••••'
                          : displayValue(value)
                );
                const gridMode = (layoutSetting('layout') ?? 'grid') === 'grid';
                if (
                    gridMode &&
                    allowEditing &&
                    column.inlineEditable &&
                    recordField != null &&
                    !recordField.isComputed &&
                    layoutSetting('disableInlineEdit') !== true
                ) {
                    cell.append(
                        button('Edit cell', () => {
                            // Attachment entry carries a captured display policy.
                            // A retained row must never promote it into a newer
                            // snapshot/owner with the same native record ID.
                            {
                                const owner = options.getScope();
                                if (
                                    destroyed ||
                                    !row.isConnected ||
                                    !card.isConnected ||
                                    data !== renderedData ||
                                    renderedOwner == null ||
                                    owner.ownerId !== renderedOwner.ownerId ||
                                    owner.revision !== renderedOwner.revision ||
                                    fieldSelect.value !== renderedFieldId ||
                                    viewSelect.value !== renderedViewId
                                )
                                    return;
                            }
                            editCell(
                                recordId,
                                recordField,
                                record.fields[column.fieldId],
                                column.miniExtConfig,
                                column.displayConfig,
                                column.title
                            );
                        })
                    );
                }
                row.append(cell);
            }
            const controls = element('td', undefined, 'record-actions');
            if (allowEditing && configuredChildId(config(), false) != null)
                controls.append(
                    button('Open Form', () => {
                        void openChild(recordId);
                    })
                );
            const pending = pendingForField().find(
                (attempt) =>
                    attempt.recordId == null || attempt.recordId === recordId
            );
            if (
                allowEditing &&
                configuredChildId(config(), false) != null &&
                pending != null
            ) {
                const acceptedOwner = collection;
                controls.append(
                    button('Inspect earlier request', () => {
                        if (
                            collection !== acceptedOwner ||
                            acceptedOwner == null ||
                            !acceptedOwner.isCurrent() ||
                            readRequired ||
                            needsRefresh ||
                            !row.isConnected
                        )
                            return;
                        void openChild(recordId, pending);
                    })
                );
            }
            if (
                directRelationship() &&
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
                                if (needsRefresh)
                                    throw new Error(
                                        'Reload the Portal before moving another category.'
                                    );
                                const input = {
                                    extensionAccessToken:
                                        page.payload.extensionAccessToken,
                                    portalFieldId: fieldSelect.value,
                                    recordId,
                                    categoryFieldValue:
                                        categorySelect.value || null,
                                    selectedCustomViewId: viewSelect.value,
                                };
                                signal.throwIfAborted();
                                // A lost response can hide a committed move
                                // and changed parent prefills. Keep the selected
                                // category, but retire its read/child context.
                                retireCollection();
                                needsRefresh = true;
                                const result =
                                    await client.portals.setKanbanCategory(
                                        input,
                                        { signal }
                                    );
                                if (!current()) return;
                                if (result.type === 'no-login') {
                                    status(
                                        'Category moved, but the Portal user was not refreshed. Choose Reload before taking another action.',
                                        true
                                    );
                                    return;
                                }
                                acceptParentData(
                                    result.loggedInUserRecord.fields
                                );
                                needsRefresh = false;
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
        if (
            (options.recovery?.journal.unknown(options.recovery.owner).length ??
                0) > 0
        )
            results.append(
                element(
                    'p',
                    `Showing only the selected view (${viewSelect.selectedOptions[0]?.textContent ?? viewSelect.value}) and search (${search.value || 'none'}). ${data.airtableOffset == null ? 'This read reached the end of this view.' : 'More pages remain; this list is incomplete.'} Missing results do not prove an earlier save failed.`,
                    'hint'
                )
            );
        renderRecovery();
    };

    const fetchRecords = (more: boolean): void => {
        if (destroyed || !card.isConnected) return;
        if (cleanupRequired) {
            status(
                'Review and accept the criteria cleanup proposal before loading again.',
                true
            );
            return;
        }
        if (more && (readRequired || collection == null)) return;
        if (needsRefresh) {
            status('Choose Reload before using this Portal token again.', true);
            return;
        }
        void run(
            'Loading the permitted Portal records…',
            async ({ signal, current }) => {
                signal.throwIfAborted();
                retireCriteriaEditors();
                if (!more) {
                    // Fresh first read creates a new immutable collection with owned criteria.
                    retireCollection();
                    closeEditor();
                    data = null;
                    dataScope = null;
                }
                const owner = getCollection();
                criteriaReadRequired = true;
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
                        proposeCleanup(owner, result.raw);
                        return;
                    }
                    if (result != null) {
                        data = result.snapshot;
                        dataScope = { ...options.getScope() };
                    }
                    criteriaReadRequired = false;
                    readRequired = false;
                    create.disabled = creatingChildId() == null;
                    closeEditor();
                    renderRecords();
                    mountCriteriaEditors();
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
        void openChild(null);
    });
    actions.append(first, next, create);
    fieldSelect.addEventListener('change', () => {
        if (destroyed || !card.isConnected) return;
        fillViews();
        criteria = {
            ...criteria,
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            searchParamsMap: {},
        };
        reset();
    });
    viewSelect.addEventListener('change', () => {
        if (destroyed || !card.isConnected) return;
        criteria = {
            ...criteria,
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
        };
        reset();
    });
    search.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            fetchRecords(false);
        }
    });
    search.addEventListener('input', () => {
        if (!destroyed && card.isConnected) reset();
    });
    fillViews();
    if (options.initialCriteria != null) {
        viewSelect.value = criteria.selectedCustomViewId;
        search.value = criteria.searchTerm ?? '';
    }
    reset();
    if (fields.length === 0)
        status('This Portal has no configured linked-record tables.', true);
    return {
        node: card,
        checkLatestRequests: () => fetchRecords(false),
        refreshRecovery: renderRecovery,
        closeEditor,
        retireCollection,
        destroy: () => {
            destroyed = true;
            retireCollection();
            closeEditor();
        },
        refreshRequired: () => {
            acceptParentData(options.page.payload.formRecord.data);
            needsRefresh = false;
            reset();
        },
    };
};
