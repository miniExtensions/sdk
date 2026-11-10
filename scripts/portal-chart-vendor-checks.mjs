import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const expected = {
    'dist/index.js':
        '6feec351b5524eebade3581e4e6a42642cbae027cbd794548a3b01fb5fde8c45',
    'dist/index.cjs':
        'c6690eb297ffac414a632350d8d64f9684fef5318a0d3d204618f16766ff0061',
    LICENSE: '0d18348c715c41254b8bc1d1b400ffc9e9f0fd21b106d85c7e504c45462f83e2',
};

/** Inline only the verified MIT adapter so React remains an optional SDK peer. */
export async function bundlePortalChart(root = process.cwd()) {
    root = resolve(root);
    const require = createRequire(join(root, 'package.json'));
    const vendor = dirname(dirname(require.resolve('react-chartjs-2')));
    const manifest = JSON.parse(readFileSync(join(vendor, 'package.json')));
    assert.equal(manifest.version, '5.3.1');
    assert.equal(manifest.license, 'MIT');
    for (const [path, sha256] of Object.entries(expected)) {
        assert.equal(
            createHash('sha256')
                .update(readFileSync(join(vendor, path)))
                .digest('hex'),
            sha256
        );
    }
    const receipts = [];
    for (const [directory, format] of [
        ['esm', 'esm'],
        ['cjs', 'cjs'],
    ]) {
        const output = join(
            root,
            'dist',
            directory,
            'react/CompletePortalChart.js'
        );
        const result = await build({
            absWorkingDir: root,
            stdin: {
                contents: readFileSync(output, 'utf8'),
                resolveDir: dirname(output),
                sourcefile: 'CompletePortalChart.js',
                loader: 'js',
            },
            bundle: true,
            platform: 'neutral',
            format,
            target: 'es2022',
            outfile: output,
            write: false,
            metafile: true,
            external: ['react', 'react/*', 'chart.js', 'chart.js/*'],
            legalComments: 'inline',
        });
        const inputs = Object.keys(result.metafile.inputs);
        assert.ok(
            inputs.some((path) =>
                /react-chartjs-2[/\\]dist[/\\]index\.(?:js|cjs)$/.test(path)
            )
        );
        assert.ok(
            !inputs.some((path) =>
                /node_modules[/\\](?:react|chart\.js)[/\\]/.test(path)
            ),
            'React and Chart.js must remain external'
        );
        assert.ok(
            !Object.values(result.metafile.outputs)
                .flatMap((entry) => entry.imports)
                .some((entry) => entry.path === 'react-chartjs-2')
        );
        assert.equal(result.outputFiles.length, 1);
        const bytes = result.outputFiles[0].contents;
        writeFileSync(output, bytes);
        receipts.push({
            format,
            path: output.slice(root.length + 1),
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        });
    }
    console.error(
        '[sdk-portal-chart-bundle]',
        JSON.stringify({
            adapter: 'react-chartjs-2@5.3.1',
            verifiedInputs: expected,
            outputs: receipts,
        })
    );
}
