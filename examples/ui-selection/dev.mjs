import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// One build, then a loopback-only server. No watch loop or runtime credentials.
await import('./build.mjs');
const root = new URL('.generated/', import.meta.url);
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag < 0 ? 34921 : process.argv[portFlag + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Use --port followed by a port between 1024 and 65535.');
}
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/main.js', ['main.js', 'text/javascript; charset=utf-8']],
    ['/main.js.map', ['main.js.map', 'application/json']],
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
    console.log(`UI selection example: http://127.0.0.1:${port}`);
});
server.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close());
}
