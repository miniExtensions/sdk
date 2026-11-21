import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    postgresTextColumnPresentationDefinition,
    resolvePostgresTextColumnPresentation,
    PostgresTextColumnPresentationError,
} from '../src/runtime/index.js';

it('uses the authored text default without materializing or granting settings', () => {
    assert.equal(
        postgresTextColumnPresentationDefinition.sourceType,
        'postgres'
    );
    assert.equal(postgresTextColumnPresentationDefinition.columnKind, 'text');
    assert.equal(
        postgresTextColumnPresentationDefinition.settingId,
        'displayAs'
    );
    assert.deepEqual(
        postgresTextColumnPresentationDefinition.choices.map(
            (choice) => choice.value
        ),
        ['text', 'attachments-public-urls']
    );
    for (const state of [{}, { displayAs: undefined }, { displayAs: 'text' }]) {
        const before = Object.getOwnPropertyDescriptors(state);
        const presentation = resolvePostgresTextColumnPresentation(
            Object.freeze(state)
        );
        assert.equal(presentation.renderer, 'text');
        assert.equal(presentation.storedValue, 'text');
        assert.equal(presentation.nativeValueInput, 'applicable');
        assert.equal(presentation.fileOpening, 'none');
        assert.equal(presentation.attachmentMutation, 'excluded');
        assert.equal(presentation.generatedAttachmentOutput, 'excluded');
        assert(!('canEdit' in presentation));
        assert.deepEqual(Object.keys(state), Object.keys(before));
    }
});

it('keeps public-URL presentation read-only regardless of a readOnly setting or hosted access', (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', () => {
        throw new Error('Unexpected network access');
    });
    const state = Object.freeze({
        displayAs: 'attachments-public-urls',
        readOnly: false,
    });
    const presentation = resolvePostgresTextColumnPresentation(state);
    assert.equal(presentation.renderer, 'public-url-attachments');
    assert.equal(presentation.storedValue, 'text');
    assert.equal(presentation.nativeValueInput, 'read-only');
    assert.equal(presentation.fileOpening, 'existing-public-http-urls');
    assert.equal(presentation.attachmentMutation, 'excluded');
    assert.equal(presentation.generatedAttachmentOutput, 'excluded');
    assert.equal(state.readOnly, false);
    assert.equal(fetch.mock.calls.length, 0);
});

it('refuses null and unknown presentations with a safe native reason', () => {
    for (const displayAs of [
        null,
        '',
        false,
        0,
        [],
        {},
        'upload',
        'private-mode',
    ])
        assert.throws(
            () => resolvePostgresTextColumnPresentation({ displayAs }),
            (error) => {
                assert(error instanceof PostgresTextColumnPresentationError);
                assert.equal(error.reason, 'INVALID_PRESENTATION');
                assert(!error.message.includes('private-mode'));
                return true;
            }
        );
});
