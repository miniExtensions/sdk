import { assertPostgresCopyPlanningReceiptProvenance } from './postgres-copy-planning-receipts.mjs';
import { bundleKanban } from './kanban-bundle.mjs';
import { bundlePortalMap } from './portal-map-vendor-checks.mjs';
import { build as bundle } from 'esbuild';
import { assertDateVendor } from './date-vendor-checks.mjs';
import { assertPortalSidebarVendor } from './portal-sidebar-vendor-checks.mjs';
import { copyDocumentAssets } from './document-preview-assets.mjs';
import { bundleDocumentPDF } from './document-pdf-bundle.mjs';
import { bundleDatePopover } from './date-popover-vendor.mjs';
import { assertAddressCombobox } from './address-combobox-bundle.mjs';
import assert from 'node:assert/strict';
import { bundlePortalChart } from './portal-chart-vendor-checks.mjs';
import { bundleCalendar } from './calendar-vendor-checks.mjs';
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
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { compilerMetadata, fingerprint } from './build-metadata.mjs';
import { withCommonJsSource } from './commonjs-source.mjs';
import {
    publicContractDependencies,
    publicPostgresRuntimeArtifacts,
} from './distribution-checks.mjs';
import {
    assertPostgresContractDeclarationInventory,
    assertPostgresRuntimeArtifactSet,
    assertPostgresRuntimeEmitter,
    assertPostgresRuntimeContractInventory,
    assertPostgresRuntimeRegistryProvenance,
} from './postgres-runtime-artifact-registry.mjs';
import { assertPostgresConfigReceiptProvenance } from './postgres-config-receipts.mjs';
import { assertPostgresFormAccessReceiptProvenance } from './postgres-form-access-receipts.mjs';
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
assertPortalSidebarVendor();

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
cpSync('vendor/portal-sidebar', 'dist/vendor/portal-sidebar', {
    recursive: true,
});
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

// This vendor release has an ESM-only explicit entry. Produce a genuine
// CommonJS closure rather than relying on require(esm), unavailable on early
// Node 22 hosts admitted by the package's existing engines contract.
const wordEntry = require.resolve('docx-preview/dist/docx-preview.mjs');
assert.equal(
    JSON.parse(readFileSync(require.resolve('docx-preview/package.json')))
        .version,
    '0.3.0'
);
await bundle({
    entryPoints: [wordEntry],
    bundle: true,
    platform: 'neutral',
    format: 'cjs',
    target: 'es2022',
    external: ['jszip'],
    minifyWhitespace: true,
    legalComments: 'inline',
    outfile: 'dist/cjs/react/attachmentPreviewVendor.js',
});
const previewPath = 'dist/cjs/react/AttachmentPreview.js';
const preview = readFileSync(previewPath, 'utf8');
assert(preview.includes('docx-preview/dist/docx-preview.mjs'));
writeFileSync(
    previewPath,
    preview.replace(
        'docx-preview/dist/docx-preview.mjs',
        './attachmentPreviewVendor.js'
    )
);
copyFileSync(
    require.resolve('docx-preview/LICENSE'),
    'dist/cjs/react/docx-preview.LICENSE.txt'
);

// Both compilers have finished; bundle only the Chart adapter closure.
await bundlePortalChart();
await bundleCalendar();
await bundleDocumentPDF();
await bundleCollaboratorPicker();
await bundleScannerDialog();
await bundleKanban();
await bundlePortalMap();
if (process.argv.includes('--capture-date-popover'))
    await bundleDatePopover(process.cwd(), true);
await bundleDatePopover();

mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');

const publicOperationFields = [
    'operation',
    'input',
    'output',
    'route',
    'kind',
    'transport',
];
for (const name of ['generated', 'postgres.generated']) {
    // The detailed source manifest remains the generator's internal --check input.
    const internal = JSON.parse(
        readFileSync(`src/runtime/contracts/${name}.provenance.json`, 'utf8')
    );
    const declarations = readFileSync(
        `dist/esm/runtime/contracts/${name}.d.ts`
    );
    assert(
        declarations.equals(
            readFileSync(`dist/cjs/runtime/contracts/${name}.d.ts`)
        ),
        'Module formats must distribute identical contract declarations'
    );
    let runtimeArtifacts;
    if (name === 'postgres.generated') {
        assertPostgresCopyPlanningReceiptProvenance(
            internal,
            createHash('sha256')
                .update(
                    readFileSync(
                        new URL(
                            './postgres-copy-planning-receipts.mjs',
                            import.meta.url
                        )
                    )
                )
                .digest('hex'),
            declarations
        );
        assertPostgresFormAccessReceiptProvenance(
            internal,
            createHash('sha256')
                .update(
                    readFileSync(
                        new URL(
                            './postgres-form-access-receipts.mjs',
                            import.meta.url
                        )
                    )
                )
                .digest('hex'),
            declarations
        );
        assertPostgresRuntimeRegistryProvenance(internal);
        assertPostgresConfigReceiptProvenance(
            internal,
            createHash('sha256')
                .update(
                    readFileSync(
                        new URL(
                            './postgres-config-receipts.mjs',
                            import.meta.url
                        )
                    )
                )
                .digest('hex'),
            declarations
        );
        assertPostgresContractDeclarationInventory(internal, declarations);
        runtimeArtifacts = publicPostgresRuntimeArtifacts(
            internal.runtimeArtifacts,
            internal.configurationValidation
        );
        const specifications = assertPostgresRuntimeArtifactSet(
            internal.runtimeArtifacts,
            internal.configurationValidation
        );
        for (const format of ['esm', 'cjs'])
            assertPostgresRuntimeContractInventory(
                readdirSync(`dist/${format}/runtime/contracts`, {
                    recursive: true,
                }),
                internal.configurationValidation
            );
        for (const [index, artifact] of runtimeArtifacts.entries()) {
            const recorded = internal.runtimeArtifacts[index];
            const specification = assertPostgresRuntimeEmitter(
                recorded,
                internal.configurationValidation
            );
            assert.equal(specification.module, specifications[index].module);
            const source = readFileSync(
                `src/runtime/contracts/${artifact.module}.ts`,
                'utf8'
            );
            const expected = specification.outputHashes(source);
            assert.deepEqual(
                {
                    generatedSha256: artifact.generatedSha256,
                    moduleSha256: artifact.moduleSha256,
                    declarationsSha256: artifact.declarationsSha256,
                },
                expected,
                'Generated PostgreSQL display runtime is stale'
            );
            assert(
                internal.sources.some(
                    ({ path, sha256 }) =>
                        path === recorded.sourcePath &&
                        sha256 === recorded.sourceSha256
                ),
                'PostgreSQL runtime source is not bound to canonical provenance'
            );
            for (const format of ['esm', 'cjs']) {
                const prefix = `dist/${format}/runtime/contracts/${artifact.module}`;
                assert.equal(
                    createHash('sha256')
                        .update(readFileSync(prefix + '.js'))
                        .digest('hex'),
                    artifact.moduleSha256[format],
                    'Compiled PostgreSQL display runtime differs from generated output'
                );
                assert.equal(
                    createHash('sha256')
                        .update(readFileSync(prefix + '.d.ts'))
                        .digest('hex'),
                    artifact.declarationsSha256,
                    'Compiled PostgreSQL display runtime declarations differ from generated output'
                );
            }
        }
    }
    const publicProvenance = {
        schemaVersion: 1,
        ...(name === 'postgres.generated'
            ? {
                  contractFamily: internal.contractFamily,
                  aliases: internal.aliases,
                  runtimeArtifacts,
              }
            : {}),
        compilerVersion: internal.compilerVersion,
        generatorSha256: internal.generatorSha256,
        transport: internal.transport,
        declarationCount: internal.declarationCount,
        generatedSha256: internal.generatedSha256,
        contractDeclarationsSha256: createHash('sha256')
            .update(declarations)
            .digest('hex'),
        operations: (internal.operations ?? []).map((operation) =>
            Object.fromEntries(
                publicOperationFields.map((field) => [field, operation[field]])
            )
        ),
        dependencies: publicContractDependencies(internal.dependencies),
    };
    for (const format of ['esm', 'cjs']) {
        const modulePath = `dist/${format}/runtime/contracts/${name}.js`;
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
            `dist/${format}/runtime/contracts/${name}.provenance.json`,
            JSON.stringify(publicProvenance, null, 4) + '\n'
        );
    }
}

for (const format of ['esm', 'cjs']) {
    for (const name of [
        'portal-shell',
        'portal-visitor-view-buttons',
        'signature',
        'theme',
        'button',
        'checkbox',
        'text',
        'number',
        'rating',
        'localized-numeric',
        'form-tracking',
        'form-captcha',
        'automatic-prefill',
        'printable-form',
        'form-group',
        'csv-export',
        'kanban',
        'portal-map',
        'form-completion',
        'form-header',
        'form-submit',
        'form-composition',
        'form-record-actions',
        'form-validation-summary',
        'portal-summary-cards',
        'readonly-portal-list',
        'portal-gallery',
        'readonly-portal-grid',
        'portal-grid-single-line-text-cell',
        'portal-grid-empty-cell',
        'form-progress',
        'form-pages',
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
        'complete-extension-password',
        'login-existing-values-picker',
        'complete-image-annotation',
        'complete-barcode-scanner',
        'barcode',
        'complete-portal-chart',
        'attachment-preview',
        'attachment-device-input',
        'attachment-url-input',
        'attachment-upload-progress',
        'readonly-url-gallery',
        'lookup',
        'computed',
        'complete-address',
        'address-field',
        'single-line-text',
        'complete-collaborators',
        'complete-date',
        'date',
        'calendar',
        'calendar-complete',
        'datetime',
        'duration',
        'currency',
        'multiple-select',
        'linked-records',
        'complete-linked-finder',
        'single-select',
        'controlled-select',
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
