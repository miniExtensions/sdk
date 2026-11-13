import { useId, useMemo } from 'react';

/** DOM association only. Never an Airtable field ID or a write capability. */
export type FieldPresentationAssociation = {
    kind: 'input' | 'group' | 'non-labelable';
    controlId: string;
    labelId: string;
    descriptionId?: string;
    errorId?: string;
    formId?: string;
};

/** Additive composition port. The shell is the single chrome owner. */
export type FieldPresentationComposition = {
    association: FieldPresentationAssociation;
    chromeOwner: 'shell';
};

/** Native meaningful-content policy; sanitization stays in public HTML renderers. */
export function hasFieldDescription(html: string | null | undefined): boolean {
    if (typeof html !== 'string') return false;
    if (/<(?:audio|iframe|img|svg|video)\b/i.test(html)) return true;
    return (
        html
            .replace(/<[^>]*>/g, '')
            .replace(/&(?:nbsp|#160|#x0*a0);/gi, ' ')
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .trim().length > 0
    );
}

/** Call once per mounted field; React owns SSR/hydration-safe instance identity. */
export function useFieldPresentationAssociation(options: {
    kind: FieldPresentationAssociation['kind'];
    formId?: string;
    description?: string | null;
    error?: string | null;
}): FieldPresentationAssociation {
    const instanceId = useId();
    const hasDescription = hasFieldDescription(options.description);
    const hasError = options.error != null;
    return useMemo(
        () => ({
            kind: options.kind,
            controlId: `mx-field-${instanceId}`,
            labelId: `mx-field-${instanceId}-label`,
            descriptionId: hasDescription
                ? `mx-field-${instanceId}-description`
                : undefined,
            errorId: hasError ? `mx-field-${instanceId}-error` : undefined,
            formId: options.formId,
        }),
        [instanceId, options.kind, options.formId, hasDescription, hasError]
    );
}

export function fieldPresentationDescribedBy(
    association: FieldPresentationAssociation
): string | undefined {
    return (
        [association.errorId, association.descriptionId]
            .filter(Boolean)
            .join(' ') || undefined
    );
}
