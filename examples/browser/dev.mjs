import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url);
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag < 0 ? 34851 : process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Use --port followed by a port between 1024 and 65535.');
}

const build = await context({
    entryPoints: [fileURLToPath(new URL('src/main.ts', root))],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: fileURLToPath(new URL('.generated/main.js', root)),
    sourcemap: true,
});
await build.rebuild();
await build.watch();

const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/main.js', ['.generated/main.js', 'text/javascript; charset=utf-8']],
    ['/main.js.map', ['.generated/main.js.map', 'application/json']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const entry = files.get(pathname);
    if (request.method !== 'GET' || entry == null) {
        response.writeHead(404).end('Not found');
        return;
    }
    try {
        const data = await readFile(new URL(entry[0], root));
        response.writeHead(200, {
            'Content-Type': entry[1],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        response.end(data);
    } catch {
        response.writeHead(500).end('Build unavailable; check the terminal.');
    }
});
server.listen(port, '127.0.0.1', () => {
    console.log(`Browser example: http://127.0.0.1:${port}`);
});
server.on('error', async (error) => {
    console.error(error.message);
    await build.dispose();
    process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
        server.close();
        await build.dispose();
    });
}
