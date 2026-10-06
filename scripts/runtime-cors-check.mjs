import assert from 'node:assert/strict';
import { createContext, Script } from 'node:vm';
import ts from 'typescript';

export const canonicalCorsPolicyPath = 'backend-src/trpc/publicRuntimeCors.ts';

// Execute the canonical transport helper, not a parsed/copied allowlist. This
// is trusted maintainer-supplied source, not a sandbox for untrusted programs.
// Type-only imports erase; runtime dependencies require an explicit redesign.
export function assertRuntimeCorsPolicy(source, operations) {
    const parsed = ts.createSourceFile(
        canonicalCorsPolicyPath,
        source,
        ts.ScriptTarget.ES2022,
        true
    );
    const rejectRuntimeImport = (node) => {
        if (
            (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
            ts.isImportEqualsDeclaration(node) ||
            ts.isExportDeclaration(node) ||
            (ts.isCallExpression(node) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                    (ts.isIdentifier(node.expression) &&
                        node.expression.text === 'require')))
        ) {
            throw new Error(
                'Canonical CORS helper must remain standalone with type-only imports; ' +
                    'use a canonical backend test adapter if runtime dependencies are added.'
            );
        }
        ts.forEachChild(node, rejectRuntimeImport);
    };
    rejectRuntimeImport(parsed);
    const compiled = ts.transpileModule(source, {
        fileName: canonicalCorsPolicyPath,
        reportDiagnostics: true,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
        },
    });
    const errors = [
        ...parsed.parseDiagnostics,
        ...(compiled.diagnostics ?? []),
    ].filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    );
    assert.equal(
        errors.length,
        0,
        ts.formatDiagnostics(errors, {
            getCanonicalFileName: (name) => name,
            getCurrentDirectory: () => '.',
            getNewLine: () => '\n',
        })
    );
    const context = createContext({ exports: {} });
    new Script(compiled.outputText, {
        filename: canonicalCorsPolicyPath,
    }).runInContext(context, { timeout: 1000 });
    assert.equal(
        typeof context.exports.handlePublicRuntimeTrpcCors,
        'function',
        'Canonical CORS helper export is missing.'
    );
    const invoke = new Script(
        'exports.handlePublicRuntimeTrpcCors(request, response)'
    );
    const probe = (method, selector, headers) => {
        const values = new Map();
        context.request = { method, query: { trpc: selector }, headers };
        context.response = {
            statusCode: 200,
            writableEnded: false,
            setHeader(name, value) {
                values.set(name.toLowerCase(), value);
            },
            end() {
                this.writableEnded = true;
            },
        };
        return {
            handled: invoke.runInContext(context, { timeout: 1000 }),
            response: context.response,
            header: (name) => values.get(name.toLowerCase()),
        };
    };
    const publicOperations = operations.filter(
        ({ transport }) => transport === 'trpc'
    );
    assert(
        publicOperations.length > 0,
        'No generated public tRPC operations to check.'
    );
    const failures = [];
    let probes = 0;
    const check = (label, run) => {
        probes++;
        try {
            run();
        } catch (error) {
            failures.push(`${label}: ${error.message.split('\n')[0]}`);
        }
    };
    const origin = 'https://sdk-cors-check.invalid';
    const contextHeaders = {
        origin,
        'miniext-context': JSON.stringify({ miniExtStorageV4: {} }),
    };
    const preflight = (method, headers = 'content-type,miniext-context') => ({
        origin,
        'access-control-request-method': method,
        'access-control-request-headers': headers,
    });
    const noGrant = (result) => {
        for (const header of [
            'Access-Control-Allow-Origin',
            'Access-Control-Allow-Methods',
            'Access-Control-Allow-Headers',
            'Access-Control-Allow-Credentials',
        ])
            assert.equal(
                result.header(header),
                undefined,
                `${header} must remain absent`
            );
    };
    for (const { operation, route, kind } of publicOperations) {
        assert(
            kind === 'query' || kind === 'mutation',
            `${operation}: unsupported tRPC kind ${kind}`
        );
        const method = kind === 'query' ? 'GET' : 'POST';
        check(`${operation} ${method} ${route} preflight`, () => {
            const result = probe('OPTIONS', route, preflight(method));
            assert.equal(
                result.header('Access-Control-Allow-Origin'),
                '*',
                'public route omitted from CORS grant for Content-Type/miniext-context'
            );
            assert(
                String(result.header('Access-Control-Allow-Methods'))
                    .split(',')
                    .map((value) => value.trim())
                    .includes(method),
                `${method} method omitted from preflight grant`
            );
            assert.equal(
                result.header('Access-Control-Allow-Credentials'),
                undefined
            );
            assert.equal(result.handled, true);
            assert.equal(result.response.statusCode, 204);
            assert.equal(result.response.writableEnded, true);
            for (const name of ['content-type', 'miniext-context'])
                assert(
                    String(result.header('Access-Control-Allow-Headers'))
                        .toLowerCase()
                        .split(',')
                        .map((x) => x.trim())
                        .includes(name),
                    `${name} header omitted`
                );
        });
        check(`${operation} ${method} ${route} actual`, () => {
            const result = probe(method, route, {
                ...contextHeaders,
                ...(method === 'POST'
                    ? { 'content-type': 'application/json' }
                    : {}),
            });
            assert.equal(
                result.header('Access-Control-Allow-Origin'),
                '*',
                'public route omitted from CORS grant'
            );
            assert.equal(
                result.header('Access-Control-Allow-Credentials'),
                undefined
            );
            assert.equal(result.header('Cache-Control'), 'private, no-store');
            assert.equal(
                result.handled,
                false,
                'CORS helper must not dispatch/end actual requests'
            );
            assert.equal(result.response.writableEnded, false);
        });
        // workspaces.byId is the existing canonical ingress test's private case.
        // Unknown/exact-prefix/mixed selectors also guard against global grants.
        for (const selector of [
            'workspaces.byId',
            `${route}.extra`,
            `${route},workspaces.byId`,
            `workspaces.byId,${route}`,
            `${route},`,
            `,${route}`,
            [route, 'workspaces.byId'],
        ]) {
            check(
                `${operation} denied selector ${JSON.stringify(selector)}`,
                () => {
                    noGrant(probe(method, selector, contextHeaders));
                    const result = probe(
                        'OPTIONS',
                        selector,
                        preflight(method)
                    );
                    noGrant(result);
                    assert.equal(result.handled, true);
                    assert.equal(result.response.statusCode, 204);
                    assert.equal(result.response.writableEnded, true);
                }
            );
        }
        for (const deniedMethod of ['PUT', 'PATCH', 'DELETE', 'HEAD']) {
            check(`${operation} denied method ${deniedMethod}`, () => {
                noGrant(probe(deniedMethod, route, contextHeaders));
                noGrant(probe('OPTIONS', route, preflight(deniedMethod)));
            });
        }
        for (const headers of [
            'authorization',
            'miniext-context,cookie',
            'miniext-context,',
        ])
            check(`${operation} denied headers ${headers}`, () =>
                noGrant(probe('OPTIONS', route, preflight(method, headers)))
            );
    }
    if (failures.length)
        throw new Error(
            'Generated public tRPC operations do not match canonical CORS policy:\n' +
                failures.join('\n')
        );
    return { publicOperations: publicOperations.length, probes };
}
