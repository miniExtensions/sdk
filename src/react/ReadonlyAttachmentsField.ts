import {
    createElement as h,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import {
    copyAttachmentPresentation,
    type AttachmentPresentation,
} from '../ui/attachmentPresentation.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';

export type ReadonlyAttachmentsFieldOptions = { className?: string };
export type ReadonlyAttachmentsFieldProps = ReadonlyAttachmentsFieldOptions & {
    /** Borrow the accepted label-only facet; no native value or action fallback. */
    field: FieldRendererProps<'multipleAttachments'>;
};

const unavailable: AttachmentPresentation = { status: 'unavailable' };
const plain = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

function presentation(
    field: ReadonlyAttachmentsFieldProps['field']
): AttachmentPresentation {
    try {
        const configs: Record<string, unknown>[] = [];
        for (const config of [field.displayConfig, field.writeConfig]) {
            if (config == null) continue;
            const candidate: unknown = config;
            if (!plain(candidate)) return unavailable;
            configs.push(candidate);
            // Conceal before inspecting the facet, including malformed mask flags.
            const obscure = candidate.obscurePassword;
            const loginMask = candidate.maskPasswordOnLoginScreen;
            if (
                (obscure !== undefined && obscure !== false) ||
                (loginMask !== undefined && loginMask !== false)
            )
                return { status: 'masked' };
        }
        if (!configs.length) return unavailable;
        for (const config of configs)
            for (const key of [
                'hideAttachmentName',
                'readOnly',
                'addOnlyMode',
                'showExistingValuesForAddOnlyMode',
            ]) {
                const value = config[key];
                if (value !== undefined && typeof value !== 'boolean')
                    return unavailable;
            }
        if (
            field.physicalKind !== 'multipleAttachments' ||
            field.field.config.type !== 'multipleAttachments' ||
            field.presentation.type !== 'physical' ||
            field.presentation.config.type !== 'multipleAttachments' ||
            field.computed !== false ||
            !['form', 'portal-detail'].includes(field.context)
        )
            return unavailable;
        // The approved copy boundary captures each supplied label once and rejects
        // partial, sparse or metadata-bearing facets without reading native data.
        return (
            copyAttachmentPresentation(field.attachmentPresentation) ??
            unavailable
        );
    } catch {
        return unavailable;
    }
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Read-only labels from an accepted Form or Portal-detail renderer snapshot. */
export function ReadonlyAttachmentsField({
    field,
    className,
}: ReadonlyAttachmentsFieldProps): ReactNode {
    const id = useId();
    const view = presentation(field);
    let title = 'Attachments';
    let showTitle = true;
    try {
        const suppliedTitle = field.title;
        if (typeof suppliedTitle === 'string' && suppliedTitle.trim())
            title = suppliedTitle;
        else {
            const name = field.field.name;
            if (typeof name === 'string') title = name;
        }
        const display: unknown = field.displayConfig;
        showTitle = !plain(display) || display.showTitle !== false;
    } catch {
        // Field metadata is optional presentation, never an attachment fallback.
    }
    const isolation = {
        onClick: stop,
        onAuxClick: stop,
        onDoubleClick: stop,
        onPointerDown: stop,
        onPointerUp: stop,
        onKeyDown: (event: import('react').KeyboardEvent) => {
            stop(event);
            if (event.key === 'Enter') event.preventDefault();
        },
        onKeyUp: stop,
    };
    const classes = ['mx-sdk-readonly-attachments-field', className]
        .filter(Boolean)
        .join(' ');
    if (view.status !== 'ready')
        return h(
            'span',
            { className: classes, ...isolation },
            showTitle ? h('label', { htmlFor: id }, title) : null,
            h(
                'output',
                { id, 'aria-label': showTitle ? undefined : title },
                view.status === 'masked'
                    ? '••••••••'
                    : 'Attachment presentation unavailable'
            )
        );
    return h(
        'section',
        {
            className: classes,
            'aria-labelledby': showTitle ? `${id}-title` : undefined,
            'aria-label': showTitle ? undefined : title,
            style: {
                display: 'grid',
                gap: '0.5rem',
                minWidth: 0,
                overflowWrap: 'anywhere',
            },
            ...isolation,
        },
        showTitle ? h('strong', { id: `${id}-title` }, title) : null,
        h(
            'ul',
            {
                'aria-labelledby': showTitle ? `${id}-title` : undefined,
                'aria-label': showTitle ? undefined : title,
                style: { margin: 0, paddingInlineStart: '1.5rem' },
            },
            ...view.rows.map((row, index) =>
                h(
                    'li',
                    {
                        key: index,
                        style: {
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                        },
                    },
                    row.label
                )
            )
        ),
        view.rows.length === 0 ? h('p', null, 'No attachments') : null
    );
}

/** Register under the existing physical renderMultipleAttachmentsField slot. */
export function renderReadonlyAttachmentsField(
    field: FieldRendererProps<'multipleAttachments'>,
    options: ReadonlyAttachmentsFieldOptions = {}
): ReactNode {
    return h(ReadonlyAttachmentsField, { field, className: options.className });
}
