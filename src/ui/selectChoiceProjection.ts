/** Native choices may include host-pending empty IDs; this helper does not validate published metadata. */
export type SelectChoiceEvaluation<T> =
    | { type: 'skip' }
    | { type: 'unavailable' }
    | { type: 'evaluate'; matches(choice: T): boolean };

export type SelectChoiceProjectionInput<T extends { id: string }> = {
    choices: readonly T[];
    selectedValues: readonly string[];
    /** Canonical native value, e.g. host choice.name or published option.value. */
    getValue(choice: T): string;
    allowedOptionIds: readonly string[] | null;
    /** List controls retain selected choices even outside current limits/conditions. */
    retainSelected: boolean;
    /** The actual caller evaluator owns its hydrated record, compiler and context. */
    evaluation: SelectChoiceEvaluation<T>;
};

export type SelectChoiceProjection<T> =
    | { status: 'ready'; choices: readonly T[] }
    | {
          status: 'retained-selected';
          reason: 'unavailable-evaluation' | 'evaluation-error';
          choices: readonly T[];
      };

/** Pure display/availability projection; never changes native selections or grants Save/Add Choice authority. */
export function projectSelectChoices<T extends { id: string }>(
    input: SelectChoiceProjectionInput<T>
): SelectChoiceProjection<T> {
    const selected = (choice: T) =>
        input.selectedValues.includes(input.getValue(choice));
    const retained = (choice: T) => input.retainSelected && selected(choice);
    const allowedIds = input.allowedOptionIds;
    const limited =
        allowedIds === null
            ? input.choices
            : input.choices.filter(
                  (choice) => allowedIds.includes(choice.id) || retained(choice)
              );
    if (input.evaluation.type === 'skip')
        return { status: 'ready', choices: limited };
    const fallback = (
        reason: 'unavailable-evaluation' | 'evaluation-error'
    ): SelectChoiceProjection<T> => ({
        status: 'retained-selected',
        reason,
        choices: input.choices.filter(selected),
    });
    if (input.evaluation.type === 'unavailable')
        return fallback('unavailable-evaluation');
    const evaluation = input.evaluation;
    try {
        return {
            status: 'ready',
            choices: limited.filter(
                (choice) => retained(choice) || evaluation.matches(choice)
            ),
        };
    } catch {
        return fallback('evaluation-error');
    }
}
