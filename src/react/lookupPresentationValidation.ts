import { createRendererProps } from '../ui/rendererRegistry.js';
import { isDurationFormat } from '../ui/durationInput.js';
import type { LookupResultPresentation } from './lookupFieldTypes.js';

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const textValue = (value: unknown) => value == null || string(value);
const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
const oneOf = (value: unknown, choices: readonly string[]) =>
    string(value) && choices.includes(value);
function dense(
    value: unknown,
    accepts: (item: unknown) => boolean
): value is unknown[] {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index++)
        if (!Object.hasOwn(value, index) || !accepts(value[index]))
            return false;
    return true;
}
const owner = (value: unknown) =>
    value === undefined ||
    (object(value) &&
        typeof value.isCurrent === 'function' &&
        (value.subscribe === undefined ||
            typeof value.subscribe === 'function'));
const choice = (value: unknown) =>
    object(value) &&
    string(value.id) &&
    string(value.name) &&
    optionalString(value.displayName) &&
    optionalString(value.color) &&
    optionalString(value.backgroundColor);
const person = (value: unknown) =>
    object(value) &&
    string(value.id) &&
    string(value.name) &&
    string(value.email) &&
    (value.profilePicUrl === undefined || string(value.profilePicUrl));
const image = (value: unknown) => object(value) && string(value.url);
const finderImage = (value: unknown) =>
    image(value) &&
    object(value) &&
    optionalString(value.id) &&
    optionalString(value.filename) &&
    textValue(value.largeUrl);
const optionalBoolean = (value: unknown) =>
    value === undefined || typeof value === 'boolean';
const optionalString = (value: unknown) => value === undefined || string(value);
const optionalFlags = (
    value: Record<string, unknown>,
    names: readonly string[]
) => names.every((name) => optionalBoolean(value[name]));
const textLabels = (value: unknown) =>
    value === undefined ||
    (object(value) && Object.values(value).every(optionalString));
const choiceLabels = (value: unknown) =>
    value === undefined ||
    (object(value) &&
        Object.entries(value).every(([key, item]) =>
            key === 'remove'
                ? item === undefined || typeof item === 'function'
                : optionalString(item)
        ));
const avatarPolicy = (value: unknown) =>
    value === undefined ||
    (object(value) &&
        (value.type === 'none' ||
            (value.type === 'direct' && dense(value.allowedOrigins, string)) ||
            (value.type === 'source' &&
                typeof value.getSource === 'function')));

const readonlyText = (value: Record<string, unknown>) =>
    optionalString(value.emptyLabel) &&
    optionalString(value.className) &&
    (value.textSize === undefined ||
        oneOf(value.textSize, ['small', 'medium', 'large', 'very large'])) &&
    (value.layout === undefined ||
        oneOf(value.layout, [
            'default',
            'linked-list',
            'cell-short',
            'cell-medium',
            'cell-tall',
            'cell-extra-tall',
            'cell-fit-content',
        ]));

function documentOptions(value: unknown): boolean {
    if (!object(value) || !object(value.source) || !textLabels(value.labels))
        return false;
    const source = value.source;
    return (
        ((source.kind === 'uri' && optionalString(source.mimeType)) ||
            (source.kind === 'bytes' &&
                Object.hasOwn(source, 'revision') &&
                string(source.mimeType) &&
                source.bytes instanceof Uint8Array)) &&
        ((value.pdfWorkerUrl === undefined &&
            value.pdfResourceBaseUrl === undefined) ||
            (string(value.pdfWorkerUrl) && string(value.pdfResourceBaseUrl)))
    );
}

function attachmentOptions(value: unknown): boolean {
    return (
        value === undefined ||
        (object(value) &&
            optionalFlags(value, [
                'isInGrid',
                'hideAttachmentName',
                'disableOpenFiles',
                'disableDownloadFiles',
            ]) &&
            (value.displayMode === undefined ||
                oneOf(value.displayMode, ['thumbnail', 'icon'])) &&
            (value.thumbnailSize === undefined ||
                oneOf(value.thumbnailSize, ['small', 'medium', 'large'])) &&
            (value.thumbFitType === undefined ||
                oneOf(value.thumbFitType, ['cover', 'contain'])) &&
            (value.documentPreview === undefined ||
                documentOptions(value.documentPreview)))
    );
}

const resource = (value: unknown) =>
    value === undefined ||
    (object(value) &&
        owner(value.owner) &&
        optionalBoolean(value.inert) &&
        textLabels(value.labels) &&
        attachmentOptions(value.attachmentOptions));

/** Image descriptors cannot smuggle DOM event handlers into a readonly leaf. */
export function isLookupImageSource(value: unknown): boolean {
    return (
        object(value) &&
        Object.keys(value).every((key) =>
            ['src', 'srcSet', 'sizes', 'loading', 'decoding'].includes(key)
        ) &&
        string(value.src) &&
        optionalString(value.srcSet) &&
        optionalString(value.sizes) &&
        (value.loading === undefined ||
            oneOf(value.loading, ['lazy', 'eager'])) &&
        (value.decoding === undefined ||
            oneOf(value.decoding, ['async', 'sync', 'auto']))
    );
}

function gallery(value: unknown): boolean {
    return (
        object(value) &&
        owner(value.owner) &&
        textLabels(value.labels) &&
        optionalFlags(value, [
            'isInGrid',
            'hideAttachmentName',
            'disableOpenFiles',
            'disableDownloadFiles',
        ]) &&
        (value.displayMode === undefined ||
            oneOf(value.displayMode, ['thumbnail', 'icon'])) &&
        (value.thumbnailSize === undefined ||
            oneOf(value.thumbnailSize, ['small', 'medium', 'large'])) &&
        (value.thumbFitType === undefined ||
            oneOf(value.thumbFitType, ['cover', 'contain'])) &&
        dense(
            value.entries,
            (entry) =>
                object(entry) &&
                image(entry) &&
                textValue(entry.filename) &&
                textValue(entry.type) &&
                textValue(entry.id) &&
                textValue(entry.thumbnailUrl) &&
                (entry.thumbnails == null ||
                    (object(entry.thumbnails) &&
                        (entry.thumbnails.full == null ||
                            image(entry.thumbnails.full))))
        )
    );
}
const writeKeys = [
    'binding',
    'render',
    'onValueChange',
    'onChange',
    'setValue',
    'publishMetadata',
    'transport',
    'ref',
];
function displayOnly(value: Record<string, unknown>) {
    return !writeKeys.some((key) => Object.hasOwn(value, key));
}
function keys(
    value: unknown,
    accepts: (item: Record<string, unknown>) => boolean
) {
    const used = new Set<string>();
    return dense(value, (item) => {
        if (!object(item) || !string(item.key) || used.has(item.key))
            return false;
        used.add(item.key);
        return accepts(item);
    });
}

/** Runtime rejection is data-only and exception-contained, before child effects. */
export function isLookupResultPresentation(
    value: unknown
): value is LookupResultPresentation {
    const seen = new Set<object>();
    const visit = (input: unknown, cardSequence = false): boolean => {
        if (!object(input) || seen.has(input) || !string(input.kind))
            return false;
        seen.add(input);
        try {
            if (input.kind === 'sequence')
                return cardSequence
                    ? dense(input.leaves, (child) => visit(child, true))
                    : keys(input.leaves, (child) => visit(child.result));
            switch (input.kind) {
                case 'literal':
                    return string(input.text);
                case 'error':
                    return string(input.message);
                case 'html':
                case 'quill':
                    return string(input.html);
                case 'markdown':
                    return (
                        textValue(input.value) &&
                        string(input.identity) &&
                        string(input.emptyLabel)
                    );
                case 'checkbox':
                    return (
                        (input.value === null ||
                            typeof input.value === 'boolean') &&
                        string(input.checkedLabel) &&
                        string(input.uncheckedLabel)
                    );
                case 'rating':
                    return (
                        (input.value === null || finite(input.value)) &&
                        finite(input.max) &&
                        string(input.icon) &&
                        string(input.color) &&
                        string(input.label) &&
                        optionalString(input.emptyLabel)
                    );
                case 'pills':
                    return dense(
                        input.items,
                        (item) =>
                            object(item) &&
                            string(item.label) &&
                            optionalString(item.color) &&
                            optionalString(item.backgroundColor)
                    );
                case 'linkedPills':
                    return dense(input.labels, string);
                case 'people':
                    return dense(
                        input.items,
                        (item) =>
                            object(item) &&
                            string(item.label) &&
                            (item.avatar === undefined ||
                                finderImage(item.avatar)) &&
                            (item.avatarSource === undefined ||
                                isLookupImageSource(item.avatarSource))
                    );
                case 'attachmentImages':
                    return (
                        dense(input.images, finderImage) &&
                        (input.entries === undefined ||
                            dense(
                                input.entries,
                                (entry) =>
                                    object(entry) &&
                                    optionalString(entry.id) &&
                                    (entry.thumbnailUrl === null ||
                                        string(entry.thumbnailUrl)) &&
                                    string(entry.filename)
                            )) &&
                        oneOf(input.empty, ['none', 'no-values']) &&
                        string(input.emptyLabel)
                    );
                case 'button':
                    return (
                        object(input.accepted) &&
                        input.accepted.mode === 'controlled' &&
                        optionalFlags(input.accepted, ['busy', 'disabled']) &&
                        textLabels(input.accepted.messages) &&
                        optionalString(input.accepted.loadingLabel) &&
                        (input.accepted.config === undefined ||
                            (object(input.accepted.config) &&
                                (input.accepted.config.openLinkType ===
                                    undefined ||
                                    oneOf(input.accepted.config.openLinkType, [
                                        '_self',
                                        '_blank',
                                        '_parent',
                                        'triggerWebhookGET',
                                        'triggerWebhookPOST',
                                    ])) &&
                                optionalString(
                                    input.accepted.config.buttonColor
                                ))) &&
                        owner(input.accepted.owner) &&
                        (input.accepted.onTriggerWebhook === undefined ||
                            typeof input.accepted.onTriggerWebhook ===
                                'function') &&
                        (input.accepted.value === null ||
                            (object(input.accepted.value) &&
                                string(input.accepted.value.label) &&
                                textValue(input.accepted.value.url)))
                    );
            }
            const display = input.display;
            if (!object(display)) return false;
            switch (input.kind) {
                case 'checkboxField':
                    return (
                        displayOnly(display) &&
                        (display.value === null ||
                            typeof display.value === 'boolean') &&
                        optionalBoolean(display.isInGrid) &&
                        optionalString(display.checkedStateLabel) &&
                        optionalString(display.uncheckedStateLabel)
                    );
                case 'ratingField':
                    return (
                        displayOnly(display) &&
                        display.mode === 'controlled' &&
                        (display.value === null || finite(display.value)) &&
                        finite(display.max) &&
                        oneOf(display.icon, [
                            'star',
                            'heart',
                            'thumbsUp',
                            'flag',
                            'dot',
                        ]) &&
                        optionalFlags(display, [
                            'grid',
                            'showLabel',
                            'invalid',
                        ]) &&
                        optionalString(display.color) &&
                        optionalString(display.title) &&
                        optionalString(display.feedback) &&
                        textLabels(display.labels)
                    );
                case 'text':
                    return (
                        displayOnly(display) &&
                        textValue(display.value) &&
                        readonlyText(display)
                    );
                case 'singleLine':
                    return (
                        display.mode === 'readOnly' &&
                        displayOnly(display) &&
                        readonlyText(display) &&
                        optionalFlags(display, [
                            'displayAsButton',
                            'displayAsAttachments',
                            'obscurePassword',
                        ]) &&
                        textValue(display.value) &&
                        textValue(display.validButtonLabel) &&
                        textValue(display.invalidButtonLabel) &&
                        resource(display.resource)
                    );
                case 'numeric': {
                    if (
                        !string(input.emptyLabel) ||
                        !object(display.capability) ||
                        display.capability.type !== 'readonly' ||
                        !oneOf(display.physicalKind, [
                            'number',
                            'percent',
                            'currency',
                        ]) ||
                        !string(display.physicalKind) ||
                        !string(display.fieldId) ||
                        !string(display.title) ||
                        typeof display.computed !== 'boolean' ||
                        typeof display.dirty !== 'boolean' ||
                        typeof display.pending !== 'boolean' ||
                        !oneOf(display.context, [
                            'form',
                            'portal-cell',
                            'portal-detail',
                            'linked-detail',
                        ]) ||
                        !dense(
                            display.validation,
                            (item) => object(item) && string(item.errorMessage)
                        ) ||
                        !(display.error === null || string(display.error))
                    )
                        return false;
                    return (
                        createRendererProps({
                            physicalKind: display.physicalKind,
                            fieldId: display.fieldId,
                            title: display.title,
                            field: display.field,
                            displayConfig: display.displayConfig,
                            writeConfig: display.writeConfig,
                            value: display.value,
                            context: 'form',
                            computed: display.computed,
                            dirty: display.dirty,
                            pending: display.pending,
                            validation: [],
                            error: display.error,
                            capability: { type: 'readonly' },
                        }) !== null
                    );
                }
                case 'date':
                case 'dateTime':
                    return (
                        textValue(display.value) &&
                        object(display.airtableDateConfig) &&
                        display.airtableDateConfig.type === input.kind &&
                        object(display.airtableDateConfig.options) &&
                        object(display.airtableDateConfig.options.dateFormat) &&
                        string(
                            display.airtableDateConfig.options.dateFormat.format
                        ) &&
                        (input.kind === 'date' ||
                            (object(
                                display.airtableDateConfig.options.timeFormat
                            ) &&
                                string(
                                    display.airtableDateConfig.options
                                        .timeFormat.format
                                ) &&
                                string(
                                    display.airtableDateConfig.options.timeZone
                                )))
                    );
                case 'phone':
                    return (
                        textValue(display.value) && string(display.emptyLabel)
                    );
                case 'duration':
                    return (
                        readonlyText(display) &&
                        isDurationFormat(display.format) &&
                        (display.value == null ||
                            (finite(display.value) &&
                                Number.isFinite(display.value * 1000)))
                    );
                case 'barcode':
                    return (
                        display.value === null ||
                        (object(display.value) && string(display.value.text))
                    );
                case 'urlButton':
                    return (
                        textValue(display.href) &&
                        textValue(display.buttonLabel) &&
                        optionalBoolean(display.inert) &&
                        owner(display.owner) &&
                        textLabels(display.labels)
                    );
                case 'attachmentCollection':
                    return (
                        owner(display.owner) &&
                        object(display.owner) &&
                        oneOf(display.layout, ['grid', 'thumbnail', 'icon']) &&
                        typeof display.columns === 'number' &&
                        [2, 3, 4].includes(display.columns) &&
                        oneOf(display.fit, ['cover', 'contain']) &&
                        typeof display.showNames === 'boolean' &&
                        object(display.labels) &&
                        string(display.labels.attachments) &&
                        string(display.labels.retry) &&
                        string(display.labels.imageUnavailable) &&
                        (display.onOpen === undefined ||
                            typeof display.onOpen === 'function') &&
                        keys(
                            display.rows,
                            (row) =>
                                string(row.label) &&
                                string(row.openLabel) &&
                                optionalString(row.imageUnavailableLabel) &&
                                dense(row.imageSources, string) &&
                                oneOf(row.icon, ['play', 'document']) &&
                                (row.document === undefined ||
                                    (object(row.document) &&
                                        string(row.document.uri) &&
                                        documentOptions(row.document.options)))
                        )
                    );
                case 'singleSelect':
                case 'multipleSelects':
                    return (
                        displayOnly(display) &&
                        choiceLabels(display.labels) &&
                        dense(display.choices, choice) &&
                        dense(display.availableChoices, choice) &&
                        oneOf(display.presentation, ['list', 'dropdown']) &&
                        (input.kind === 'singleSelect'
                            ? display.value === null || string(display.value)
                            : dense(display.value, string))
                    );
                case 'singleCollaborator':
                case 'multipleCollaborators':
                    return (
                        displayOnly(display) &&
                        optionalString(display.title) &&
                        optionalBoolean(display.showLabel) &&
                        avatarPolicy(display.avatarPolicy) &&
                        choiceLabels(display.labels) &&
                        dense(display.choices, person) &&
                        (input.kind === 'singleCollaborator'
                            ? display.value === null || person(display.value)
                            : dense(display.value, person))
                    );
                case 'formula':
                    return (
                        display.mode === 'controlled' &&
                        displayOnly(display) &&
                        readonlyText(display) &&
                        textLabels(display.buttonLabels) &&
                        textValue(display.validUrlButtonLabel) &&
                        textValue(display.invalidUrlButtonLabel) &&
                        (display.select === undefined ||
                            (object(display.select) &&
                                dense(display.select.choices, choice) &&
                                choiceLabels(display.select.labels) &&
                                optionalBoolean(display.select.isInGrid))) &&
                        optionalFlags(display, [
                            'obscurePassword',
                            'renderFormulaAsHTML',
                            'renderFormulaAsAttachment',
                            'displayAsButton',
                            'formattingFailed',
                        ]) &&
                        (display.gallery === undefined ||
                            gallery(display.gallery)) &&
                        resource(display.resource) &&
                        typeof display.isValid === 'boolean' &&
                        (!display.isValid ||
                            display.obscurePassword === true ||
                            (string(display.resultType) &&
                                textValue(display.formattedValue)))
                    );
                case 'rollup':
                    return (
                        display.mode === 'controlled' &&
                        displayOnly(display) &&
                        readonlyText(display) &&
                        typeof display.isValid === 'boolean' &&
                        (!display.isValid || textValue(display.value))
                    );
                case 'richText':
                    return (
                        displayOnly(display) &&
                        !Object.hasOwn(display, 'emptyContent') &&
                        textValue(display.value) &&
                        string(display.emptyLabel) &&
                        string(display.language)
                    );
                case 'urlGallery':
                    return gallery(display);
                case 'linkedCollection': {
                    if (
                        !object(display.labels) ||
                        !string(display.labels.empty) ||
                        !string(display.labels.loading) ||
                        !string(display.labels.unavailable) ||
                        !optionalString(display.labels.loadMore) ||
                        !textValue(display.error) ||
                        !oneOf(display.phase, ['loading', 'ready', 'error']) ||
                        (display.loadMore !== undefined &&
                            (!object(display.loadMore) ||
                                typeof display.loadMore.busy !== 'boolean' ||
                                typeof display.loadMore.run !== 'function'))
                    )
                        return false;
                    const validOpen = (row: Record<string, unknown>) =>
                        row.open === undefined ||
                        (object(row.open) &&
                            string(row.open.label) &&
                            typeof row.open.run === 'function');
                    if (display.layout === 'table')
                        return (
                            keys(display.columns, (column) =>
                                string(column.title)
                            ) &&
                            keys(
                                display.rows,
                                (row) =>
                                    validOpen(row) &&
                                    keys(row.cells, (cell) =>
                                        visit(cell.result)
                                    )
                            )
                        );
                    if (!oneOf(display.layout, ['list', 'gallery']))
                        return false;
                    return keys(display.rows, (row) => {
                        if (!validOpen(row) || !object(row.card)) return false;
                        const card = row.card;
                        if (
                            card.status === 'loading' ||
                            card.status === 'unavailable'
                        )
                            return string(card.label);
                        return (
                            card.status === 'present' &&
                            string(card.primary) &&
                            keys(
                                card.fields,
                                (field) =>
                                    textValue(field.title) &&
                                    visit(field.leaf, true)
                            ) &&
                            oneOf(card.layout, ['list', 'gallery', 'kanban']) &&
                            oneOf(card.imageFit, ['cover', 'contain']) &&
                            finite(card.imageHeight) &&
                            typeof card.shouldRenderThumbnail === 'boolean' &&
                            oneOf(card.thumbnailLocation, ['left', 'right']) &&
                            finite(card.fieldsPerCardRow) &&
                            object(card.labels) &&
                            string(card.labels.previousImage) &&
                            string(card.labels.nextImage) &&
                            string(card.labels.noImage) &&
                            optionalString(card.labels.viewImage) &&
                            dense(card.images, finderImage)
                        );
                    });
                }
                default:
                    return false;
            }
        } finally {
            seen.delete(input);
        }
    };
    try {
        return visit(value);
    } catch {
        return false;
    }
}
