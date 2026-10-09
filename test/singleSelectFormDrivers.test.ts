import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as forms from '../src/forms/index.js';
import * as runtime from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';
import { createFormConditionRecordProjection } from '../src/forms/projection.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Shared assertions execute against source here and both installed module formats.
const { readSingleSelectFormDriverOracle, runSingleSelectFormDriverChecks } =
    await import(
        pathToFileURL(
            resolve('scripts/single-select-form-driver-consumer-checks.mjs')
        ).href
    );

describe('single-select native Form visibility and advanced-validation drivers', () => {
    it('pins the executed canonical sources and all 48 named fixture cases', () => {
        assert.equal(readSingleSelectFormDriverOracle().cases.length, 48);
    });
    it('admits exact direct drivers, preserves canonical truth and refuses unsafe native/configuration inputs', async () => {
        assert(
            (await runSingleSelectFormDriverChecks(
                forms,
                runtime,
                loadedForm,
                createFormConditionRecordProjection
            )) > 80
        );
    });
});
