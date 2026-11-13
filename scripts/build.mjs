import { assertDateVendor } from './date-vendor-checks.mjs';
import { copyDocumentAssets } from './document-preview-assets.mjs';
import { bundleDocumentPDF } from './document-pdf-bundle.mjs';
import { bundleDatePopover } from './date-popover-vendor.mjs';
import { assertAddressCombobox } from './address-combobox-bundle.mjs';
import assert from 'node:assert/strict';
import { bundlePortalChart } from './portal-chart-vendor-checks.mjs';
import {
    bundleCollaboratorPicker,
    bundleScannerDialog,
} from './collaborator-picker-vendor-checks.mjs';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    cpSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { compilerMetadata, fingerprint } from './build-metadata.mjs';
import { withCommonJsSource } from './commonjs-source.mjs';
import { publicContractDependencies } from './distribution-checks.mjs';
import {
    assertModuleFormats,
    moduleFormatReceiptPath,
} from './module-format-checks.mjs';
import {
    assertRichTextVendor,
    richTextRuntimeFilter,
} from './rich-text-vendor-checks.mjs';

import {
    assertPhoneVendor,
    phoneRuntimeFilter,
} from './phone-vendor-checks.mjs';

await assertAddressCombobox();
const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');
assertRichTextVendor();
assertPhoneVendor();
assertDateVendor();

for (const directory of ['dist/esm', 'dist/cjs', 'dist/vendor']) {
    rmSync(directory, { recursive: true, force: true });
}

// Each private CommonJS closure is shared by both output formats. Keep its
// owning filter so one vendor's excluded files cannot enter through the other.
cpSync('vendor/rich-markdown-editor', 'dist/vendor/rich-markdown-editor', {
    recursive: true,
    filter: richTextRuntimeFilter,
});
cpSync('vendor/date-time', 'dist/vendor/date-time', { recursive: true });
copyDocumentAssets();
cpSync('vendor/headlessui-address', 'dist/vendor/headlessui-address', {
    recursive: true,
});
cpSync('vendor/phone-number-input', 'dist/vendor/phone-number-input', {
    recursive: true,
    filter: phoneRuntimeFilter,
});

for (const project of ['tsconfig.json', 'tsconfig.cjs.json']) {
    const compile = (actualProject) => {
        console.error(
            '[sdk-build-compiler]',
            JSON.stringify(
                compilerMetadata(
                    compiler,
                    project,
                    spawnSync,
                    process.env.NODE_OPTIONS ?? '',
                    actualProject
                )
            )
        );
        return spawnSync(
            process.execPath,
            [compiler, '--project', actualProject],
            {
                stdio: 'inherit',
            }
        );
    };
    const result =
        project === 'tsconfig.cjs.json'
            ? withCommonJsSource(process.cwd(), compile)
            : compile(project);
    // A failed CJS compiler must return through stage cleanup before exiting.
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
    const format = project === 'tsconfig.json' ? 'esm' : 'cjs';
    for (const name of ['auth/flow', 'formulas/index']) {
        console.error(
            '[sdk-build-output]',
            JSON.stringify({
                path: `dist/${format}/${name}.js`,
                source: fingerprint(`src/${name}.ts`),
                output: fingerprint(`dist/${format}/${name}.js`),
            })
        );
    }
}

// Both compilers have finished; bundle only the Chart adapter closure.
await bundlePortalChart();
await bundleDocumentPDF();
await bundleCollaboratorPicker();
await bundleScannerDialog();
if (process.argv.includes('--capture-date-popover'))
    await bundleDatePopover(process.cwd(), true);
await bundleDatePopover();

mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');

// The detailed source manifest remains the generator's internal --check input.
const internal = JSON.parse(
    readFileSync('src/runtime/contracts/generated.provenance.json', 'utf8')
);
const declarations = readFileSync('dist/esm/runtime/contracts/generated.d.ts');
assert(
    declarations.equals(
        readFileSync('dist/cjs/runtime/contracts/generated.d.ts')
    ),
    'Module formats must distribute identical contract declarations'
);
const publicOperationFields = [
    'operation',
    'input',
    'output',
    'route',
    'kind',
    'transport',
];
const publicProvenance = {
    schemaVersion: 1,
    compilerVersion: internal.compilerVersion,
    generatorSha256: internal.generatorSha256,
    transport: internal.transport,
    declarationCount: internal.declarationCount,
    generatedSha256: internal.generatedSha256,
    contractDeclarationsSha256: createHash('sha256')
        .update(declarations)
        .digest('hex'),
    operations: internal.operations.map((operation) =>
        Object.fromEntries(
            publicOperationFields.map((field) => [field, operation[field]])
        )
    ),
    dependencies: publicContractDependencies(internal.dependencies),
};
for (const format of ['esm', 'cjs']) {
    const modulePath = `dist/${format}/runtime/contracts/generated.js`;
    const module = readFileSync(modulePath, 'utf8');
    const privateComment = `// Canonical monorepo revision: ${internal.sourceRevision}\n`;
    assert.equal(
        module.split(privateComment).length,
        2,
        'Expected one generated revision comment'
    );
    // Remove only this comment; emitted code and other comments stay intact.
    writeFileSync(modulePath, module.replace(privateComment, ''));
    writeFileSync(
        `dist/${format}/runtime/contracts/generated.provenance.json`,
        JSON.stringify(publicProvenance, null, 4) + '\n'
    );
}

for (const format of ['esm', 'cjs']) {
    for (const name of [
        'signature',
        'theme',
        'button',
        'checkbox',
        'text',
        'number',
        'localized-numeric',
        'form-tracking',
        'form-group',
        'form-completion',
        'form-header',
        'field-presentation',
        'complete-checkbox',
        'complete-phone',
        'complete-readonly-text',
        'complete-clearable-text-input',
        'complete-multiline',
        'complete-duration',
        'search-gate',
        'complete-calendly',
        'complete-record-comments',
        'complete-verification',
        'complete-barcode-scanner',
        'barcode',
        'complete-portal-chart',
        'complete-address',
        'address-field',
        'complete-collaborators',
        'complete-date',
        'date',
        'datetime',
        'duration',
        'currency',
        'multiple-select',
        'linked-records',
        'single-select',
        'rich-text',
    ]) {
        copyFileSync(
            `src/react/${name}.css`,
            `dist/${format}/react/${name}.css`
        );
    }
    copyFileSync(
        'src/react/html/html-description.css',
        `dist/${format}/react/html-description.css`
    );
}

// Prepack inherits this boundary: malformed output must never become a TGZ.
writeFileSync(
    moduleFormatReceiptPath,
    JSON.stringify(assertModuleFormats(process.cwd()), null, 4) + '\n'
);
