import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FormValidationMessage } from '@miniextensions/sdk/forms';
import { formValidationPresentation } from '../examples/browser/src/presentation.js';

const generic = {
    fieldId: '',
    fieldTitle: 'Form',
    errorMessage:
        'The Form could not be saved. A configured field needs attention.',
};
const message = (fieldId: string): FormValidationMessage => ({
    fieldId,
    fieldTitle: `${fieldId} title sentinel`,
    errorMessage: `${fieldId} value sentinel`,
});

describe('Form validation presentation', () => {
    it('retains visible canonical messages and projects every undisclosed field to one generic blocker', () => {
        const errors = [
            message('visible'),
            message('hidden'),
            message('masked'),
            message('unavailable'),
            message('unknown'),
            message('visible'),
        ];
        const original = structuredClone(errors);
        const summary = formValidationPresentation(errors, (fieldId) => {
            switch (fieldId) {
                case 'visible':
                    return { type: 'visible' };
                case 'hidden':
                    return { type: 'hidden' };
                case 'masked':
                    return { type: 'masked' };
                case 'unavailable':
                    return { type: 'unavailable' };
                default:
                    return undefined;
            }
        });
        assert.deepEqual(summary, [errors[0], generic, errors[5]]);
        assert.deepEqual(errors, original);
        assert.notEqual(summary[0], errors[0]);
        summary[0]!.errorMessage = 'A consumer edit';
        assert.deepEqual(errors, original);
    });

    it('contains callback failures without disclosing their field titles or messages', () => {
        const errors = [message('throwing'), message('visible')];
        assert.deepEqual(
            formValidationPresentation(errors, (fieldId) => {
                if (fieldId === 'throwing')
                    throw new Error('Policy failure sentinel');
                return { type: 'visible' };
            }),
            [generic, errors[1]]
        );
        assert.deepEqual(
            formValidationPresentation([], () => undefined),
            []
        );
    });
});
