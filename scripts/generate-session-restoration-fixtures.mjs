import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

// Maintainer-only execution. Ordinary CI consumes the committed provenance fixture.
const checkout = process.argv[2];
if (!checkout)
    throw new Error('Supply the explicit pinned canonical checkout.');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: checkout,
    encoding: 'utf8',
}).trim();
assert.equal(revision, '58f73d575ab10baa0a10693660d8002f204368e1');
const sources = [
    'components/PublicExtension/helpers/generateStorageKeyForCredentials.ts',
    'types/executeApiRequest/miniExtLocalStorage.ts',
];
const [keyPath, storagePath] = sources.map((path) => resolve(checkout, path));
const input = {
    extensionId: 'extension_example',
    tableId: 'table_example',
    fieldNames: ['Émail', 'Password'],
};
const output = await build({
    stdin: {
        contents: `import { generateStorageKeyForCredentials } from ${JSON.stringify(keyPath)};
import { setValueInMiniExtStorage, getAllValuesInMiniExtStorage } from ${JSON.stringify(storagePath)};
const key = generateStorageKeyForCredentials(${JSON.stringify(input)});
setValueInMiniExtStorage({key,context:'share_example',value:'SYNTHETIC_ENCRYPTED_LOGIN',expiration:{type:'never-expires'}});
const remembered = getAllValuesInMiniExtStorage('share_example');
const otherContext = getAllValuesInMiniExtStorage('other');
setValueInMiniExtStorage({key:'expired',context:'share_example',value:'SYNTHETIC_EXPIRED',expiration:{type:'expires',expiresIn:-1}});
const afterExpired = getAllValuesInMiniExtStorage('share_example');
setValueInMiniExtStorage({key,context:'share_example',value:'',expiration:{type:'never-expires'}});
export const result = {key,remembered,otherContext,afterExpired,afterLogout:getAllValuesInMiniExtStorage('share_example')};`,
        resolveDir: resolve(checkout),
        loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    plugins: [
        {
            name: 'synthetic-storage-only',
            setup(plugin) {
                plugin.onResolve(
                    { filter: /^local-storage-fallback$/ },
                    () => ({ path: 'storage', namespace: 'fixture' })
                );
                plugin.onResolve(
                    { filter: /assertRunningOnFrontend$/ },
                    () => ({ path: 'frontend', namespace: 'fixture' })
                );
                plugin.onLoad(
                    { filter: /.*/, namespace: 'fixture' },
                    ({ path }) => ({
                        contents:
                            path === 'storage'
                                ? 'const map=new Map(); export default {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};'
                                : 'export const assertRunningOnFrontend=()=>{};',
                        loader: 'js',
                    })
                );
            },
        },
    ],
});
const module = { exports: {} };
runInNewContext(output.outputFiles[0].text, {
    module,
    exports: module.exports,
    Buffer,
    Date,
});
const result = JSON.parse(JSON.stringify(module.exports.result));
assert.deepEqual(result.afterLogout, {});
assert.deepEqual(result.otherContext, {});
assert.deepEqual(result.afterExpired, result.remembered);
const fixture = {
    canonicalRevision: revision,
    sources: sources.map((path) => ({
        path,
        sha256: createHash('sha256')
            .update(readFileSync(resolve(checkout, path)))
            .digest('hex'),
    })),
    generatorSha256: createHash('sha256')
        .update(readFileSync(new URL(import.meta.url)))
        .digest('hex'),
    execution:
        'Canonical key/storage helpers executed with synthetic in-memory storage; frontend-only assertion stubbed. No hosted login/backend execution.',
    input,
    result,
};
writeFileSync(
    'test/fixtures/sessionRestorationCanonical.json',
    await format(JSON.stringify(fixture), {
        ...(await resolveConfig(
            'test/fixtures/sessionRestorationCanonical.json'
        )),
        parser: 'json',
    })
);
console.log(
    'Pinned canonical key, context isolation, expiry filtering and empty-value logout fixture generated.'
);
