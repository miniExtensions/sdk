import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const importedCss = /@import\s+(['"])([^'"]+)\1\s*;/g;

/** Preserve the complete, unchanged packed CSS import graph on localhost. */
export function calendarCompleteStyleAssets(
    installedPackage,
    readArchiveMember
) {
    assert.equal(typeof readArchiveMember, 'function');
    const root = realpathSync(installedPackage);
    const entry = 'dist/esm/react/calendar-complete.css';
    const assets = new Map();
    const inputs = [];
    const visited = new Set();
    const visit = (file) => {
        const path = resolve(root, file);
        assert(
            path.startsWith(root + sep),
            'Calendar CSS must remain inside the installed package'
        );
        assert(
            lstatSync(path).isFile(),
            'Calendar CSS input must be a regular file'
        );
        assert.equal(
            realpathSync(path),
            path,
            'Calendar CSS input must not traverse symlinks'
        );
        const local = relative(root, path).replaceAll('\\', '/');
        if (visited.has(local)) return;
        visited.add(local);
        const bytes = readFileSync(path);
        const member = `package/${local}`;
        assert.deepEqual(
            bytes,
            readArchiveMember(member),
            'Calendar CSS differs from admitted TGZ'
        );
        const route = `/calendar-assets/${local}`;
        assets.set(route, bytes);
        inputs.push({
            member,
            route,
            bytes: bytes.length,
            sha256: hash(bytes),
        });
        const source = bytes.toString('utf8').replace(/\/\*[\s\S]*?\*\//g, '');
        const imports = [...source.matchAll(importedCss)];
        assert(
            !/@import\b/i.test(source.replace(importedCss, '')),
            'Unsupported Calendar CSS import syntax'
        );
        for (const match of imports) {
            assert(
                /^(?:\.\.?\/)[A-Za-z0-9_./-]+\.css$/.test(match[2]),
                'Calendar CSS imports must be local package styles'
            );
            visit(relative(root, resolve(dirname(path), match[2])));
        }
    };
    visit(entry);
    for (const required of [
        'calendar.css',
        'complete-linked-finder.css',
        'complete-readonly-text.css',
        'html-description.css',
        'rich-text.css',
        'localized-numeric.css',
        'date.css',
        'datetime.css',
        'complete-phone.css',
        'duration.css',
        'complete-checkbox.css',
        'barcode.css',
        'button.css',
    ])
        assert(
            visited.has(`dist/esm/react/${required}`),
            `Missing shared Calendar leaf stylesheet: ${required}`
        );
    return {
        assets,
        href: `/calendar-assets/${entry}`,
        inputs: inputs.sort((a, b) => a.member.localeCompare(b.member)),
    };
}
