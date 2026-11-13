import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publishDeferredSelectChoice } from '../src/ui/selectDeferredChoice.js';

describe('deferred select choice publication', () => {
    it('publishes pending metadata before selected canonical name without a provider', () => {
        const events: unknown[] = [];
        assert.deepEqual(
            publishDeferredSelectChoice({
                input: '  New choice  ',
                choices: [],
                selectedNames: [],
                multiple: false,
                isCurrent: () => true,
                publishMetadata: (choice) => {
                    events.push(choice);
                },
                selectName: (name) => {
                    events.push(name);
                },
            }),
            { status: 'selected', name: 'New choice', metadataPublished: true }
        );
        assert.deepEqual(events, [
            { id: '', name: 'New choice', newOption: true },
            'New choice',
        ]);
    });
    it('reuses the exact canonical name and preserves single same-value intent', () => {
        const events: unknown[] = [];
        const args = {
            input: 'alpha',
            choices: [{ name: 'Alpha' }],
            selectedNames: ['Alpha'],
            multiple: false,
            isCurrent: () => true,
            publishMetadata: (choice: unknown) => {
                events.push(choice);
            },
            selectName: (name: string) => {
                events.push(name);
            },
        };
        assert.deepEqual(publishDeferredSelectChoice(args), {
            status: 'selected',
            name: 'Alpha',
            metadataPublished: false,
        });
        assert.deepEqual(events, ['Alpha']);
        assert.deepEqual(
            publishDeferredSelectChoice({ ...args, multiple: true }),
            { status: 'already-selected' }
        );
        assert.deepEqual(events, ['Alpha']);
    });
    it('does not write value or retry if authority retires after metadata', () => {
        const events: unknown[] = [];
        let current = true;
        assert.deepEqual(
            publishDeferredSelectChoice({
                input: 'New',
                choices: [],
                selectedNames: [],
                multiple: true,
                isCurrent: () => current,
                publishMetadata: (choice) => {
                    events.push(choice);
                    current = false;
                },
                selectName: (name) => {
                    events.push(name);
                },
            }),
            { status: 'metadata-published', name: 'New' }
        );
        assert.deepEqual(events, [{ id: '', name: 'New', newOption: true }]);
    });
    it('propagates writer failure and reports explicit refusal without fallback', () => {
        const failure = new Error('native writer refused');
        const args = {
            input: 'Alpha',
            choices: [{ name: 'Alpha' }],
            selectedNames: [],
            multiple: false,
            isCurrent: () => true,
            publishMetadata: () => {
                throw new Error('unexpected metadata');
            },
            selectName: () => {
                throw failure;
            },
        };
        assert.throws(
            () => publishDeferredSelectChoice(args),
            (error) => error === failure
        );
        assert.deepEqual(
            publishDeferredSelectChoice({ ...args, selectName: () => false }),
            { status: 'refused' }
        );
        assert.deepEqual(
            publishDeferredSelectChoice({ ...args, isCurrent: () => false }),
            { status: 'stale' }
        );
        assert.deepEqual(
            publishDeferredSelectChoice({ ...args, input: '  ' }),
            { status: 'empty' }
        );
    });
});
