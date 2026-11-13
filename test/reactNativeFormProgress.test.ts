import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import * as ui from '../src/react/index.js';
import * as forms from '../src/forms/index.js';

it('owns committed saved-progress lifecycle, ordered storage, cancellation, Restore, retry and complete conflict presentation', async () => {
    const { assertSavedProgressConsumer } = await import(
        pathToFileURL(resolve('scripts/saved-progress-consumer-checks.mjs'))
            .href
    );
    const result = await assertSavedProgressConsumer({
        React,
        ui,
        forms,
        Window,
        createRoot,
        renderToString,
    });
    assert.equal(result.ssrCalls, 0);
    assert.equal(result.pendingLocks, 0);
});
