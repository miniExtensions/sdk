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

/** Failure-only metadata; compiler messages and absolute paths stay private. */
export function sourcePackageFailureReceipt(result, ownedSourcePaths) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const diagnostics = [];
    for (const match of output.matchAll(
        /^(.+?)\((\d+),(\d+)\): error (TS\d{4,6}):/gm
    )) {
        const path = match[1].replaceAll('\\', '/');
        const start = path.lastIndexOf('/src/');
        const relative = start < 0 ? path : path.slice(start + 1);
        if (!ownedSourcePaths.has(relative)) continue;
        diagnostics.push({
            code: match[4],
            path: relative,
            line: Number(match[2]),
            column: Number(match[3]),
        });
        if (diagnostics.length === 8) break;
    }
    return {
        status: result.status,
        signal: ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT'].includes(
            result.signal
        )
            ? result.signal
            : null,
        codes: [...new Set(output.match(/\bTS\d{4,6}\b/g) ?? [])].slice(0, 8),
        stages: [
            ...new Set(
                [
                    ...output.matchAll(
                        /"project":"(tsconfig(?:\.cjs)?\.json)"/g
                    ),
                ].map((match) => match[1])
            ),
        ],
        failures: [
            ...new Set(
                output.match(
                    /\b(?:ENOSPC|ENOMEM|EACCES|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_ASSERTION)\b/g
                ) ?? []
            ),
        ],
        diagnostics,
    };
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
        // A failed preparation stays failed. Emit bounded codes/owned source
        // positions, never raw compiler messages or weaker compiler settings.
        const ownedSources = new Set(
            readdirSync(join(root, 'src'), {
                recursive: true,
                withFileTypes: true,
            })
                .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
                .map((entry) =>
                    relative(
                        root,
                        join(entry.parentPath, entry.name)
                    ).replaceAll('\\', '/')
                )
        );
        assert.equal(
            result.status,
            0,
            `SDK source package build failed: ${JSON.stringify(sourcePackageFailureReceipt(result, ownedSources))}`
        );
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
