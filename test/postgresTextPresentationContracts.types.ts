import {
    postgresTextColumnPresentationDefinition,
    resolvePostgresTextColumnPresentation,
    PostgresTextColumnPresentationError,
    type PostgresTextColumnPresentation,
} from '../src/runtime/index.js';

type Equivalent<A, B> = [A] extends [B]
    ? [B] extends [A]
        ? true
        : false
    : false;
type Assert<T extends true> = T;
export type PresentationContracts = [
    Assert<
        Equivalent<
            ReturnType<typeof resolvePostgresTextColumnPresentation>,
            PostgresTextColumnPresentation
        >
    >,
    Assert<Equivalent<PostgresTextColumnPresentation['storedValue'], 'text'>>,
    Assert<
        Equivalent<
            PostgresTextColumnPresentation['attachmentMutation'],
            'excluded'
        >
    >,
    Assert<
        Equivalent<
            PostgresTextColumnPresentation['generatedAttachmentOutput'],
            'excluded'
        >
    >,
];

export function postgresTextPresentationContracts() {
    const defaultValue: 'text' =
        postgresTextColumnPresentationDefinition.defaultValue;
    const sourceType: 'postgres' =
        postgresTextColumnPresentationDefinition.sourceType;
    const columnKind: 'text' =
        postgresTextColumnPresentationDefinition.columnKind;
    const presentation = resolvePostgresTextColumnPresentation({
        displayAs: 'attachments-public-urls',
    });
    if (presentation.renderer === 'public-url-attachments') {
        const input: 'read-only' = presentation.nativeValueInput;
        const opening: 'existing-public-http-urls' = presentation.fileOpening;
        return { defaultValue, sourceType, columnKind, input, opening };
    }
    const input: 'applicable' = presentation.nativeValueInput;
    const reason: 'INVALID_PRESENTATION' =
        new PostgresTextColumnPresentationError().reason;
    // @ts-expect-error Read-only metadata cannot be weakened by a consumer.
    postgresTextColumnPresentationDefinition.choices[1].presentation.nativeValueInput =
        'read-only';
    resolvePostgresTextColumnPresentation({
        displayAs: 'text',
        // @ts-expect-error No per-record permission evaluator belongs in this pure presentation API.
        permissions: () => true,
    });
    return { defaultValue, sourceType, columnKind, input, reason };
}
