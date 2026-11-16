import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    cpSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
    unlinkSync,
    symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertPortalSidebarVendor } from './portal-sidebar-vendor-checks.mjs';

test('freezes the actual engine and external renderer peers', () => {
    assert.equal(assertPortalSidebarVendor().version, '6.11.2');
});
for (const mutation of [
    'engine bytes',
    'extra file',
    'symlink',
    'receipt hash',
]) {
    test(`refuses changed sidebar vendor ${mutation}`, (t) => {
        const root = mkdtempSync(join(tmpdir(), 'sdk-sidebar-vendor-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        const target = join(root, 'vendor/portal-sidebar');
        cpSync('vendor/portal-sidebar', target, { recursive: true });
        if (mutation === 'engine bytes')
            writeFileSync(
                join(target, 'index.js'),
                'exports.Resizable = null;\n'
            );
        if (mutation === 'extra file')
            writeFileSync(join(target, 'unowned.js'), '');
        if (mutation === 'symlink') {
            unlinkSync(join(target, 'index.js'));
            symlinkSync(
                join(process.cwd(), 'vendor/portal-sidebar/index.js'),
                join(target, 'index.js')
            );
        }
        if (mutation === 'receipt hash')
            writeFileSync(join(target, 'UPSTREAM.json'), '{}');
        assert.throws(() => assertPortalSidebarVendor(root));
    });
}
