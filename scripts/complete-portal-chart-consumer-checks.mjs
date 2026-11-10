import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const typedConsumer = String.raw`import { createElement } from 'react';
import { CompletePortalChart, type CompletePortalChartProps, type PortalChartRow } from '@miniextensions/sdk/react';
const rows: readonly PortalChartRow[] = [{ data: { type: 'loaded', data: { viewType: 'chart', xAxisValue: 'Same', yAxisValue: -2.75 } } }];
const props: CompletePortalChartProps = { rows, title: '', fieldName: 'Requests', xAxisFieldName: 'Name', yAxisFieldName: 'Amount', backgroundColor: 'rgb(37 99 235)' };
createElement(CompletePortalChart, props);
// @ts-expect-error chart data retains numeric values, not formatted labels
const bad: PortalChartRow = { data: { type: 'loaded', data: { viewType: 'chart', xAxisValue: 'A', yAxisValue: '2' } } };
// @ts-expect-error no native theme registry or renderer slot in the complete component
createElement(CompletePortalChart, { ...props, themeColor: 'blue' });
// @ts-expect-error a complete chart retains its portable color input
createElement(CompletePortalChart, { rows, fieldName: '', xAxisFieldName: '', yAxisFieldName: '' });
void bad;
`;

function runtime(format) {
    const imports =
        format === 'esm'
            ? `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import { CompletePortalChart } from '@miniextensions/sdk/react';`
            : `const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server'); const { CompletePortalChart } = require('@miniextensions/sdk/react');`;
    return `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
${imports}
assert.throws(() => require.resolve('react-chartjs-2'), { code: 'MODULE_NOT_FOUND' });
const rows = [
 { data: { type: 'loaded', data: { viewType: 'chart', xAxisValue: 'Same', yAxisValue: 0 } } },
 { data: { type: 'loading' } },
 { data: { type: 'loaded', data: { viewType: 'calendar' } } },
 { data: { type: 'loaded', data: { viewType: 'chart', xAxisValue: 'Same', yAxisValue: -2.75 } } },
 { data: { type: 'loaded', data: { viewType: 'chart', xAxisValue: 'Last', yAxisValue: 4.5 } } },
];
const before = JSON.stringify(rows);
const render = (value) => renderToStaticMarkup(React.createElement(CompletePortalChart, { rows: value, title: '', fieldName: 'Requests', xAxisFieldName: 'Name', yAxisFieldName: 'Amount', backgroundColor: '#2563eb' }));
const html = render(rows);
assert.match(html, /<canvas[^>]*aria-hidden="true"/);
assert.ok(html.includes('<dt>Same</dt><dd>0</dd>'));
assert.ok(html.includes('<dt>Same</dt><dd>-2.75</dd>'));
assert.ok(html.includes('<dt>Last</dt><dd>4.5</dd>'));
assert.equal((html.match(/<dt>/g) ?? []).length, 3);
assert.equal(JSON.stringify(rows), before);
assert.ok(!render([]).includes('<dt>'));
console.log(JSON.stringify({ react: React.version, format: '${format}', serverImport: true, pairs: 3, adapterDependencyAbsent: true }));
`;
}

/** Cold public package consumers; no checkout aliases, dev adapter, canvas shim or app CSS. */
export function checkCompletePortalChartReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = resolve(archivePath);
    const parent = mkdtempSync(join(tmpdir(), 'sdk-portal-chart-consumers-'));
    const profiles = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const root = mkdtempSync(join(parent, version.react + '-'));
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react: version.react,
                        'react-dom': version.react,
                        '@types/react': version.types,
                        '@types/react-dom': version.domTypes,
                        '@types/node': '22.20.5',
                    },
                })
            );
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: root,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 120000,
                });
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
            ]);
            const pkg = join(root, 'node_modules/@miniextensions/sdk');
            const css = readFileSync(
                join(pkg, 'dist/esm/react/complete-portal-chart.css')
            );
            assert.match(css.toString(), /\.mx-sdk-portal-chart__data/);
            assert.match(css.toString(), /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
            for (const format of ['esm', 'cjs']) {
                const extension = format === 'esm' ? 'mts' : 'cts';
                writeFileSync(
                    join(root, 'consumer.' + extension),
                    typedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--noEmit',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    'consumer.' + extension,
                ]);
                const dts = readFileSync(
                    join(pkg, `dist/${format}/react/CompletePortalChart.d.ts`),
                    'utf8'
                );
                assert.ok(
                    !dts.includes('react-chartjs-2'),
                    'dev-only vendor types must not leak'
                );
                const js = readFileSync(
                    join(pkg, `dist/${format}/react/CompletePortalChart.js`)
                );
                const member = execFileSync('tar', [
                    '-xOf',
                    archivePath,
                    `package/dist/${format}/react/CompletePortalChart.js`,
                ]);
                assert.ok(
                    js.equals(member),
                    'consumer must execute the actual packed Chart module'
                );
                writeFileSync(join(root, 'runtime.mjs'), runtime(format));
                const result = JSON.parse(
                    run(process.execPath, ['runtime.mjs']).trim()
                );
                assert.equal(result.react, version.react);
                profiles.push({
                    ...result,
                    strictTypes: true,
                    childModuleSha256: createHash('sha256')
                        .update(js)
                        .digest('hex'),
                    cssSha256: createHash('sha256').update(css).digest('hex'),
                });
            }
        }
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
    return { profiles, cleanup: 'completed' };
}
