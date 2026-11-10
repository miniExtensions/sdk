import assert from 'node:assert/strict';
import {
    cpSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
    assertAddressCombobox,
    buildAddressCombobox,
} from './address-combobox-bundle.mjs';

test('frozen Address code is identical in pnpm symlink and flat Git-prepare layouts', async (t) => {
    const require = createRequire(import.meta.url);
    const installed = dirname(dirname(require.resolve('@headlessui/react')));
    const temporary = mkdtempSync(join(tmpdir(), 'address-prepare-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const flat = join(temporary, 'node_modules/@headlessui/react');
    mkdirSync(dirname(flat), { recursive: true });
    cpSync(installed, flat, { recursive: true, dereference: true });
    const original = await buildAddressCombobox(installed);
    assert.equal(await buildAddressCombobox(flat), original);
    await assertAddressCombobox(installed);
    await assertAddressCombobox(flat);
    const source = join(flat, 'dist/components/combobox/combobox.js');
    writeFileSync(
        source,
        readFileSync(source, 'utf8') + '\nexport const alteredVendor = true;\n'
    );
    await assert.rejects(assertAddressCombobox(flat), {
        code: 'ERR_ASSERTION',
    });
});
