import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const defaults = {
    maxFiles: 2048,
    maxEdges: 16384,
    maxBytes: 64 * 1024 * 1024,
};
const scriptExtensions = new Set([
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
]);

function within(root, candidate) {
    const relative = path.relative(root, candidate);
    return (
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep) &&
        !path.isAbsolute(relative)
    );
}

function valueImport(clause) {
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (
        clause.name ||
        !clause.namedBindings ||
        ts.isNamespaceImport(clause.namedBindings)
    )
        return true;
    return (
        clause.namedBindings.elements.length === 0 ||
        clause.namedBindings.elements.some((element) => !element.isTypeOnly)
    );
}

function staticSpecifiers(source, filename) {
    const ast = ts.createSourceFile(
        filename,
        source,
        ts.ScriptTarget.Latest,
        true
    );
    if (ast.parseDiagnostics.length)
        throw Error('Cannot parse coverage test dependency: ' + filename);
    const result = [];
    for (const statement of ast.statements) {
        if (
            ts.isImportDeclaration(statement) &&
            valueImport(statement.importClause) &&
            ts.isStringLiteral(statement.moduleSpecifier)
        )
            result.push(statement.moduleSpecifier.text);
        else if (
            ts.isExportDeclaration(statement) &&
            !statement.isTypeOnly &&
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier) &&
            (!statement.exportClause ||
                !ts.isNamedExports(statement.exportClause) ||
                statement.exportClause.elements.length === 0 ||
                statement.exportClause.elements.some(
                    (element) => !element.isTypeOnly
                ))
        )
            result.push(statement.moduleSpecifier.text);
        else if (
            ts.isImportEqualsDeclaration(statement) &&
            !statement.isTypeOnly &&
            ts.isExternalModuleReference(statement.moduleReference) &&
            statement.moduleReference.expression &&
            ts.isStringLiteral(statement.moduleReference.expression)
        )
            result.push(statement.moduleReference.expression.text);
    }
    return result;
}

function candidates(target) {
    const extension = path.extname(target);
    // TypeScript source for an emitted .js import wins deterministically.
    if (extension === '.js')
        return [
            target.slice(0, -3) + '.ts',
            target.slice(0, -3) + '.tsx',
            target,
        ];
    if (extension === '.jsx') return [target.slice(0, -4) + '.tsx', target];
    if (extension === '.mjs') return [target.slice(0, -4) + '.mts', target];
    if (extension === '.cjs') return [target.slice(0, -4) + '.cts', target];
    if (!extension)
        return [
            target + '.ts',
            target + '.tsx',
            target + '.js',
            path.join(target, 'index.ts'),
            path.join(target, 'index.js'),
        ];
    return scriptExtensions.has(extension) ? [target] : [];
}

/**
 * One source-only classifier per immutable test invocation. Cache parsed module
 * edges, never a partial transitive false result: cycles must not hide a later
 * reachable DOM fixture. Limits apply per entry; the parsed-edge cache lasts
 * for this immutable invocation. No dependency module is imported or executed.
 */
export function createTestProfileClassifier(testDirectory, options = {}) {
    const limits = { ...defaults, ...options };
    for (const key of Object.keys(defaults))
        if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0)
            throw Error('Invalid coverage test graph limit: ' + key);
    const rootPromise = realpath(path.resolve(testDirectory));
    const parsed = new Map();

    async function resolveLocal(root, target, required) {
        if (!within(root, target)) {
            if (required) throw Error('Coverage test entry escapes test root');
            return null; // Ordinary ../src imports are not fixture graph inputs.
        }
        const choices = candidates(target);
        for (const choice of choices) {
            let canonical;
            try {
                canonical = await realpath(choice);
            } catch (error) {
                if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
                    continue;
                throw error;
            }
            if (!within(root, canonical))
                throw Error(
                    'Coverage test dependency escapes canonical test root'
                );
            const stat = await lstat(canonical);
            if (!stat.isFile()) continue;
            if (stat.size > limits.maxBytes)
                throw Error('Coverage test graph byte limit exceeded');
            return canonical;
        }
        if (required || choices.length)
            throw Error(
                'Cannot resolve local coverage test dependency: ' +
                    path.relative(root, target)
            );
        return null; // CSS/data imports contain no JavaScript import graph.
    }

    function moduleSource(filename) {
        if (!parsed.has(filename))
            parsed.set(
                filename,
                (async () => {
                    const source = await readFile(filename, 'utf8');
                    return {
                        bytes: Buffer.byteLength(source),
                        specifiers: staticSpecifiers(source, filename),
                    };
                })()
            );
        return parsed.get(filename);
    }

    return async function testProfile(entry) {
        const root = await rootPromise;
        const first = await resolveLocal(root, path.resolve(root, entry), true);
        const pending = [first],
            seen = new Set();
        let bytes = 0,
            edges = 0;
        while (pending.length) {
            const filename = pending.pop();
            if (seen.has(filename)) continue;
            seen.add(filename);
            if (seen.size > limits.maxFiles)
                throw Error('Coverage test graph file limit exceeded');
            const source = await moduleSource(filename);
            bytes += source.bytes;
            if (bytes > limits.maxBytes)
                throw Error('Coverage test graph byte limit exceeded');
            let direct = false;
            for (const specifier of source.specifiers) {
                edges++;
                if (edges > limits.maxEdges)
                    throw Error('Coverage test graph edge limit exceeded');
                if (
                    specifier === 'happy-dom' ||
                    specifier.startsWith('happy-dom/')
                ) {
                    direct = true;
                    continue;
                }
                // Never resolve bare packages, aliases or modules outside test/.
                if (!specifier.startsWith('./') && !specifier.startsWith('../'))
                    continue;
                const dependency = await resolveLocal(
                    root,
                    path.resolve(path.dirname(filename), specifier),
                    false
                );
                if (dependency) pending.push(dependency);
            }
            if (direct) return 'component';
        }
        return 'unit';
    };
}
