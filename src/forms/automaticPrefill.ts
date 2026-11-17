/**
 * Already admitted native facts. These are display/trigger inputs, never Save
 * authority. The host still rechecks its original owner at actual allocation.
 */
export type AutomaticPrefillFacts = Readonly<{
    enabled: boolean;
    captchaEnabled: boolean;
    preview: boolean;
    /** Captured for this Form lifetime, even after its URL guard is removed. */
    suppressed: boolean;
    /** The host's exact nonempty prefill-key test; not arbitrary URL truthiness. */
    hasNonemptyURLPrefill: boolean;
    /** Accepted load provenance, not schema membership or dirty/static values. */
    acceptedURLFieldIds: readonly string[] | undefined;
    /** Final canonical projection, after native visibility/readonly policy. */
    projectedValues: Readonly<Record<string, unknown>>;
}>;

export type AutomaticPrefillDecision =
    | {
          mode: 'manual';
          reason: 'disabled' | 'captcha' | 'suppressed' | 'preview';
      }
    | { mode: 'automatic'; eligible: true }
    | {
          mode: 'automatic';
          eligible: false;
          reason: 'no-prefills';
      };

/**
 * Preserve native accepted-URL/final-projection semantics. In particular, zero,
 * false, whitespace and nonempty arrays count. A raw URL or a static/restored
 * value alone cannot create accepted provenance. No values are copied/retained.
 */
export function hasPersistableAutomaticURLPrefill(
    facts: Pick<
        AutomaticPrefillFacts,
        'acceptedURLFieldIds' | 'projectedValues'
    >
): boolean {
    return (facts.acceptedURLFieldIds ?? []).some((fieldId) => {
        if (
            !Object.prototype.hasOwnProperty.call(
                facts.projectedValues,
                fieldId
            )
        )
            return false;
        const value = facts.projectedValues[fieldId];
        return (
            value != null &&
            value !== '' &&
            (!Array.isArray(value) || value.length > 0)
        );
    });
}

/**
 * Automatic mode precedes manual Review, but never disables CAPTCHA or the
 * mount-captured Restore/new-Form suppression. A field's readonly flag is not
 * another gate: the load producer decides whether its URL prefill was accepted.
 */
export function evaluateAutomaticPrefill(
    facts: AutomaticPrefillFacts
): AutomaticPrefillDecision {
    if (!facts.enabled) return { mode: 'manual', reason: 'disabled' };
    if (facts.captchaEnabled) return { mode: 'manual', reason: 'captcha' };
    if (facts.suppressed) return { mode: 'manual', reason: 'suppressed' };
    if (facts.preview) return { mode: 'manual', reason: 'preview' };
    return facts.hasNonemptyURLPrefill &&
        hasPersistableAutomaticURLPrefill(facts)
        ? { mode: 'automatic', eligible: true }
        : { mode: 'automatic', eligible: false, reason: 'no-prefills' };
}
