import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    evaluateAutomaticPrefill,
    hasPersistableAutomaticURLPrefill,
    type AutomaticPrefillFacts,
} from '../src/forms/automaticPrefill.js';

const facts = (
    change: Partial<AutomaticPrefillFacts> = {}
): AutomaticPrefillFacts => ({
    enabled: true,
    captchaEnabled: false,
    preview: false,
    suppressed: false,
    hasNonemptyURLPrefill: true,
    acceptedURLFieldIds: ['accepted'],
    projectedValues: { accepted: 'loaded URL value' },
    ...change,
});

describe('automatic-prefill admitted provenance and final projection', () => {
    for (const [name, value] of [
        ['zero', 0],
        ['false', false],
        ['whitespace', ' '],
        ['nonempty array', ['']],
        ['nonempty record references', ['rec_a']],
        ['structured admitted value', { name: 'accepted collaborator' }],
    ] as const) {
        it(`preserves native persistable ${name}`, () => {
            assert.deepEqual(
                evaluateAutomaticPrefill(
                    facts({ projectedValues: { accepted: value } })
                ),
                { mode: 'automatic', eligible: true }
            );
        });
    }
    for (const [name, value] of [
        ['null', null],
        ['undefined', undefined],
        ['empty string', ''],
        ['empty array', []],
    ] as const) {
        it(`refuses ${name} without making a Save request`, () => {
            assert.deepEqual(
                evaluateAutomaticPrefill(
                    facts({ projectedValues: { accepted: value } })
                ),
                { mode: 'automatic', eligible: false, reason: 'no-prefills' }
            );
        });
    }
    it('does not substitute static, restored, copied or unrelated values for URL provenance', () => {
        const projectedValues = { accepted: 'A', other: 'B' };
        for (const acceptedURLFieldIds of [undefined, [], ['notProjected']])
            assert.equal(
                hasPersistableAutomaticURLPrefill({
                    projectedValues,
                    acceptedURLFieldIds,
                }),
                false
            );
    });
    it('does not use inherited properties as final projected values', () => {
        const projectedValues: Record<string, unknown> = Object.create({
            accepted: 'inherited',
        });
        assert.equal(
            hasPersistableAutomaticURLPrefill({
                projectedValues,
                acceptedURLFieldIds: ['accepted'],
            }),
            false
        );
    });
    it('keeps genuinely owned special field identifiers', () => {
        const projectedValues: Record<string, unknown> = Object.create(null);
        projectedValues.__proto__ = 'accepted own value';
        assert.equal(
            hasPersistableAutomaticURLPrefill({
                projectedValues,
                acceptedURLFieldIds: ['__proto__'],
            }),
            true
        );
    });
    it('requires both current nonempty URL presence and accepted projected provenance', () => {
        assert.deepEqual(
            evaluateAutomaticPrefill(facts({ hasNonemptyURLPrefill: false })),
            { mode: 'automatic', eligible: false, reason: 'no-prefills' }
        );
    });
    it('does not mutate or retain accepted arrays or final values', () => {
        const acceptedURLFieldIds = Object.freeze(['missing', 'accepted']);
        const value = Object.freeze(['rec_a']);
        const projectedValues = Object.freeze({ accepted: value });
        assert.equal(
            hasPersistableAutomaticURLPrefill({
                acceptedURLFieldIds,
                projectedValues,
            }),
            true
        );
        assert.deepEqual(acceptedURLFieldIds, ['missing', 'accepted']);
        assert.equal(projectedValues.accepted, value);
    });
    for (const [flag, reason] of [
        ['captchaEnabled', 'captcha'],
        ['suppressed', 'suppressed'],
        ['preview', 'preview'],
    ] as const) {
        it(`keeps ${reason} on the manual path despite an eligible URL prefill`, () => {
            assert.deepEqual(
                evaluateAutomaticPrefill(facts({ [flag]: true })),
                {
                    mode: 'manual',
                    reason,
                }
            );
        });
    }
    it('keeps disabled automatic mode on the manual path', () => {
        assert.deepEqual(evaluateAutomaticPrefill(facts({ enabled: false })), {
            mode: 'manual',
            reason: 'disabled',
        });
    });
    it('uses accepted readonly provenance rather than inventing a field-readonly veto', () => {
        // Synthetic policy boundary only. The genuine load/Form zero-versus-one
        // allocation oracle is a separate required native integration test.
        assert.deepEqual(
            evaluateAutomaticPrefill(facts({ acceptedURLFieldIds: [] })),
            { mode: 'automatic', eligible: false, reason: 'no-prefills' }
        );
        assert.deepEqual(evaluateAutomaticPrefill(facts()), {
            mode: 'automatic',
            eligible: true,
        });
    });
});
