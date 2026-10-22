/** Minimal real hosted context identity; additional native context fields remain with the caller. */
export type AdjacentChildNavigationContext =
    | { readonly type: 'direct-url' }
    | {
          readonly type: 'modal' | 'side-panel' | 'form-layout';
          readonly recordId: string | null;
          readonly parentFormExtensionSessionId: string;
          readonly fieldIdOfLinkedRecordField: string | null;
          readonly linkedTableIdOfLinkedRecordField: string;
          readonly parentExtensionAccessToken: string;
          readonly childExtensionAccessInfo: {
              readonly childExtensionId: string;
          };
          readonly prefillDataForLinkedRecordsForm?: {
              readonly toLinkToParent?: {
                  readonly parentFormRecordId: string;
                  readonly reversedFieldIdToPrefill: string;
              } | null;
          } | null;
          readonly nextRecordId?: string | null;
          readonly previousRecordId?: string | null;
      };
export type AdjacentChildNavigationInput = Readonly<{
    sourceExtensionSessionId: string;
    type: 'next' | 'previous';
    recordId: string;
}>;
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
    typeof value === 'string' && value.trim() !== '';
const nullableText = (value: unknown) => value === null || text(value);
const read = (value: unknown) => {
    if (
        !object(value) ||
        typeof value.type !== 'string' ||
        !['modal', 'side-panel', 'form-layout'].includes(value.type)
    )
        return null;
    const recordId = value.recordId,
        parent = value.parentFormExtensionSessionId,
        field = value.fieldIdOfLinkedRecordField,
        table = value.linkedTableIdOfLinkedRecordField,
        token = value.parentExtensionAccessToken,
        child = value.childExtensionAccessInfo;
    if (
        !nullableText(recordId) ||
        !text(parent) ||
        !nullableText(field) ||
        !text(table) ||
        !text(token) ||
        !object(child) ||
        !text(child.childExtensionId)
    )
        return null;
    const prefill = value.prefillDataForLinkedRecordsForm;
    if (prefill != null && !object(prefill)) return null;
    const link = prefill?.toLinkToParent;
    if (
        link != null &&
        (!object(link) ||
            !text(link.parentFormRecordId) ||
            !text(link.reversedFieldIdToPrefill))
    )
        return null;
    return {
        recordId,
        scope: [
            value.type,
            parent,
            field,
            table,
            token,
            child.childExtensionId,
            link?.parentFormRecordId ?? null,
            link?.reversedFieldIdToPrefill ?? null,
        ],
    };
};

/**
 * Synchronous lookup only: borrow actual hosted contexts, resolve one declared
 * same-origin sibling, and leave current-owner admission, writes and transport
 * with the caller. This is neither a server authorization nor an SDK Form owner.
 */
export function findAdjacentChildSession(
    contexts: Readonly<
        Record<string, AdjacentChildNavigationContext | undefined>
    >,
    input: AdjacentChildNavigationInput
): string | null {
    try {
        if (
            !object(contexts) ||
            !object(input) ||
            !text(input.sourceExtensionSessionId) ||
            !text(input.recordId) ||
            (input.type !== 'next' && input.type !== 'previous') ||
            !Object.hasOwn(contexts, input.sourceExtensionSessionId)
        )
            return null;
        const source = contexts[input.sourceExtensionSessionId];
        const origin = read(source);
        if (!origin || !source || source.type === 'direct-url') return null;
        const neighbour =
            input.type === 'next'
                ? source.nextRecordId
                : source.previousRecordId;
        if (!text(neighbour) || neighbour !== input.recordId) return null;
        let match: string | null = null;
        for (const sessionId of Object.keys(contexts)) {
            if (sessionId === input.sourceExtensionSessionId) continue;
            const target = read(contexts[sessionId]);
            if (
                !target ||
                target.recordId !== neighbour ||
                !origin.scope.every(
                    (part, index) => part === target.scope[index]
                )
            )
                continue;
            if (match !== null) return null;
            match = sessionId;
        }
        return match;
    } catch {
        return null;
    }
}
