import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as forms from '../src/forms/index.js';
import * as runtime from '../src/runtime/index.js';
import * as ui from '../src/ui/index.js';
import { loadedForm } from './formsFixtures.js';

it('admits bounded native select option drivers through the actual Form owner', async () => {
    const { checkSelectOptionDriverModules } = await import(
        pathToFileURL(
            resolve('scripts/select-option-driver-consumer-checks.mjs')
        ).href
    );
    assert.equal(
        await checkSelectOptionDriverModules(forms, runtime, ui, loadedForm),
        192
    );
});
