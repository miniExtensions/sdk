import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * TypeScript uses the nearest source package type beneath node_modules, even
 * with CommonJS/Node10 options. Compile a detached CommonJS source scope; the
 * original ESM sources and output layout remain unchanged.
 */
export function withCommonJsSource(root, compile) {
    const distribution = join(root, 'dist');
    mkdirSync(distribution, { recursive: true });
    const stage = mkdtempSync(join(distribution, '.cjs-source-'));
    try {
        cpSync(join(root, 'src'), stage, {
            recursive: true,
            dereference: true,
        });
        const purifier = join(stage, 'react/html/htmlPurifier.ts');
        if (existsSync(purifier)) {
            const source = readFileSync(purifier, 'utf8');
            if (source.split('createRequire(import.meta.url)').length !== 2)
                throw new Error('Expected one lazy HTML parser resolver');
            writeFileSync(
                purifier,
                source.replace(
                    'createRequire(import.meta.url)',
                    'createRequire(__filename)'
                )
            );
        }
        writeFileSync(join(stage, 'package.json'), '{"type":"commonjs"}\n');
        const project = join(stage, 'tsconfig.json');
        writeFileSync(
            project,
            JSON.stringify({
                extends: '../../tsconfig.cjs.json',
                compilerOptions: { rootDir: '.', outDir: '../cjs' },
                include: ['**/*.ts', '../../types/**/*.d.ts'],
            }) + '\n'
        );
        return compile(project);
    } finally {
        // This invocation exclusively created stage. Never clean a shared name.
        rmSync(stage, { recursive: true, force: true });
    }
}
