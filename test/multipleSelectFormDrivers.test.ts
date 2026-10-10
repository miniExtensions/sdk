import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as forms from '../src/forms/index.js';
import * as runtime from '../src/runtime/index.js';
import * as ui from '../src/ui/index.js';
import { loadedForm } from './formsFixtures.js';
import { createFormConditionRecordProjection } from '../src/forms/projection.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {
    readMultipleSelectFormDriverOracle,
    runMultipleSelectFormDriverChecks,
} = await import(
    pathToFileURL(
        resolve('scripts/multi-select-form-driver-consumer-checks.mjs')
    ).href
);
describe('multiple-select native Form visibility and advanced-validation drivers', () => {
    it('pins canonical sources, generator, and unique named fixture cases', () => {
        assert.equal(readMultipleSelectFormDriverOracle().cases.length, 68);
    });
    it('preserves canonical results and native drafts while refusing unsafe inputs and stale actions', async () => {
        assert(
            (await runMultipleSelectFormDriverChecks(
                forms,
                runtime,
                loadedForm,
                createFormConditionRecordProjection,
                ui
            )) > 60
        );
    });
});
