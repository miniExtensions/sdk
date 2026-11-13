import assert from 'node:assert/strict';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function declarationFiles(root) {
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
        .map((entry) => relative(root, join(entry.parentPath, entry.name)))
        .sort();
}

/** Git preparation compiles source beneath node_modules, unlike a checkout. */
export function assertSourcePackageBuild(root) {
    const temporary = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-source-package-'))
    );
    try {
        const nested = join(
            temporary,
            'node_modules',
            '@miniextensions',
            'sdk'
        );
        mkdirSync(nested, { recursive: true });
        for (const entry of [
            'src',
            'types',
            'scripts',
            'vendor',
            'package.json',
            'tsconfig.json',
            'tsconfig.cjs.json',
        ]) {
            cpSync(join(root, entry), join(nested, entry), { recursive: true });
        }
        // Keep both directories real; reuse resolved dependencies without an
        // install, network request or mutation of the checkout's dependencies.
        const dependencies = join(nested, 'node_modules');
        mkdirSync(dependencies);
        for (const entry of readdirSync(join(root, 'node_modules'))) {
            if (entry === '.bin') continue;
            symlinkSync(
                join(root, 'node_modules', entry),
                join(dependencies, entry)
            );
        }
        const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
            cwd: nested,
            encoding: 'utf8',
            timeout: 120000,
            maxBuffer: 1024 * 1024,
        });
        assert.ifError(result.error);
        // A failed preparation stays failed; do not forward captured compiler
        // output or retry with weaker declaration/module/vendor settings.
        assert.equal(result.status, 0, 'SDK source package build failed');
        let declarations = 0;
        for (const format of ['esm', 'cjs']) {
            const built = join(nested, 'dist', format);
            const control = join(root, 'dist', format);
            const paths = declarationFiles(control);
            assert(paths.length > 0, 'Missing checkout declarations');
            assert.deepEqual(
                declarationFiles(built),
                paths,
                'Source package declaration inventory changed'
            );
            for (const path of paths) {
                assert(
                    readFileSync(join(built, path)).equals(
                        readFileSync(join(control, path))
                    ),
                    `Source package declaration differs: ${format}/${path}`
                );
                declarations++;
            }
        }
        return { formats: 2, declarations };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
