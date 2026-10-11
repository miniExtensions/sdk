import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const metrics = ['lines', 'branches', 'functions', 'statements'];
export function aggregate(files) {
    return Object.fromEntries(
        metrics.map((metric) => {
            const total = files.reduce(
                (sum, file) => sum + file[metric].total,
                0
            );
            const covered = files.reduce(
                (sum, file) => sum + file[metric].covered,
                0
            );
            return [metric, total === 0 ? 100 : (100 * covered) / total];
        })
    );
}
export function enforce(label, actual, minimum) {
    const failures = [];
    for (const [metric, threshold] of Object.entries(minimum)) {
        if (!Number.isFinite(actual[metric]) || actual[metric] < threshold) {
            failures.push(
                `${label} ${metric}: ${actual[metric]?.toFixed(2)}% < ${threshold}%`
            );
        }
    }
    return failures;
}
export function sourceCoverage(root, summary) {
    const files = new Map();
    for (const [name, value] of Object.entries(summary)) {
        if (name === 'total') continue;
        const source = path
            .relative(root, name)
            .split(path.sep)
            .join('/')
            .replace(/^dist\/coverage-test\//, '')
            .replace(/\.js$/, '.ts');
        if (files.has(source))
            throw new Error(`Duplicate coverage for ${source}`);
        files.set(source, value);
    }
    return files;
}
async function sourceFiles(directory, prefix = 'src') {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            result.push(
                ...(await sourceFiles(
                    path.join(directory, entry.name),
                    relative
                ))
            );
        } else if (entry.name.endsWith('.ts')) result.push(relative);
    }
    return result;
}
export function hasRuntimeStatements(javascript) {
    const ast = ts.createSourceFile(
        'emitted.js',
        javascript,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    return ast.statements.some(
        (statement) =>
            !(
                ts.isExportDeclaration(statement) &&
                statement.moduleSpecifier == null &&
                statement.exportClause != null &&
                ts.isNamedExports(statement.exportClause) &&
                statement.exportClause.elements.length === 0
            )
    );
}
export async function checkCoverage(root) {
    const policy = JSON.parse(
        await readFile(path.join(root, 'coverage-policy.json'), 'utf8')
    );
    const expected = (await sourceFiles(path.join(root, 'src'))).sort();
    const typeOnly = new Set();
    for (const source of expected) {
        const emitted = await readFile(
            path.join(
                root,
                'dist/coverage-test',
                source.replace(/\.ts$/, '.js')
            ),
            'utf8'
        );
        if (!hasRuntimeStatements(emitted)) typeOnly.add(source);
    }
    console.log(
        `Type-only source (verified empty JavaScript, retained in raw reports): ${[...typeOnly].join(', ')}`
    );
    const failures = [];
    const evidence = {
        sourceFiles: expected,
        typeOnly: [...typeOnly],
        groups: {},
    };
    for (const [group, rules] of Object.entries(policy)) {
        const summary = JSON.parse(
            await readFile(
                path.join(root, `coverage/${group}/coverage-summary.json`),
                'utf8'
            )
        );
        const files = sourceCoverage(root, summary);
        const runtimeFiles = [...files.entries()]
            .filter(([name]) => !typeOnly.has(name))
            .map(([, value]) => value);
        evidence.groups[group] = {
            raw: summary.total,
            executable: aggregate(runtimeFiles),
            scopes: {},
        };
        const reported = [...files.keys()].sort();
        if (JSON.stringify(reported) !== JSON.stringify(expected)) {
            throw new Error(
                `${group}: coverage must report every TypeScript source exactly once. Missing: ${expected.filter((name) => !files.has(name)).join(', ')}; unexpected: ${reported.filter((name) => !expected.includes(name)).join(', ')}`
            );
        }
        for (const [scope, minimum] of Object.entries(rules)) {
            const selected = [...files.entries()]
                .filter(
                    ([name]) =>
                        !typeOnly.has(name) &&
                        (scope === 'all' || name.startsWith(`src/${scope}/`))
                )
                .map(([, value]) => value);
            if (selected.length === 0)
                throw new Error(`Empty coverage scope ${scope}`);
            const actual = aggregate(selected);
            evidence.groups[group].scopes[scope] = { actual, minimum };
            console.log(
                `${group}/${scope}: ${metrics.map((m) => `${m}=${actual[m].toFixed(2)}%`).join(' ')}`
            );
            failures.push(...enforce(`${group}/${scope}`, actual, minimum));
        }
    }
    await writeFile(
        path.join(root, 'coverage/source-metrics.json'),
        `${JSON.stringify(evidence, null, 2)}\n`
    );
    if (failures.length)
        throw new Error(`Coverage thresholds failed:\n${failures.join('\n')}`);
}
