import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('dist/customer-chat-browser');
mkdirSync(output, { recursive: true });
await build({
    entryPoints: ['examples/customer-chat/main.ts'],
    bundle: true,
    format: 'esm',
    outfile: output + '/main.js',
    sourcemap: true,
});
copyFileSync('examples/customer-chat/index.html', output + '/index.html');
const server = createServer((request, response) => {
    const file = request.url === '/main.js' ? 'main.js' : 'index.html';
    response.setHeader(
        'Content-Type',
        file.endsWith('.js') ? 'application/javascript' : 'text/html'
    );
    response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'"
    );
    response.end(readFileSync(output + '/' + file));
});
server.listen(0, '127.0.0.1', () =>
    console.log(
        'Synthetic customer-chat fixture: http://127.0.0.1:' +
            server.address().port
    )
);
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close());
