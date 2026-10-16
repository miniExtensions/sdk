import {
    checkBarcodeConsumer,
    barcodeReactTypedConsumer,
} from './barcode-consumer-checks.mjs';
import {
    checkLookupConsumer,
    lookupReactTypedConsumer,
} from './lookup-consumer-checks.mjs';
import {
    checkRollupConsumer,
    rollupReactTypedConsumer,
} from './rollup-consumer-checks.mjs';
import {
    checkFormulaConsumer,
    formulaReactTypedConsumer,
} from './formula-consumer-checks.mjs';
import {
    checkLinkedRecordsRendererConsumer,
    linkedRecordsReactTypedConsumer,
} from './linked-records-renderer-consumer-checks.mjs';
import { checkCheckboxConsumer } from './checkbox-consumer-checks.mjs';
import {
    checkMultipleSelectConsumer,
    multipleSelectReactTypedConsumer,
} from './multiple-select-consumer-checks.mjs';
import {
    checkCreatedTimeConsumer,
    createdTimeReactTypedConsumer,
} from './created-time-consumer-checks.mjs';
import { checkTextConsumer } from './text-consumer-checks.mjs';
import {
    checkReactSingleSelectConsumer,
    reactSingleSelectTypedConsumer,
    reactSingleSelectCommonJsTypedConsumer,
} from './react-single-select-consumer-checks.mjs';
import {
    checkLastModifiedTimeConsumer,
    lastModifiedTimeReactTypedConsumer,
} from './last-modified-time-consumer-checks.mjs';
import {
    checkLastModifiedByConsumer,
    lastModifiedByReactTypedConsumer,
} from './last-modified-by-consumer-checks.mjs';
import {
    checkCreatedByConsumer,
    createdByReactTypedConsumer,
} from './created-by-consumer-checks.mjs';
import {
    checkExternalSyncSourceConsumer,
    externalSyncSourceReactTypedConsumer,
} from './external-sync-source-consumer-checks.mjs';
import {
    checkMultilineTextConsumer,
    multilineTextReactTypedConsumer,
} from './multiline-text-consumer-checks.mjs';
import {
    checkPhoneNumberConsumer,
    phoneNumberReactTypedConsumer,
} from './phone-number-consumer-checks.mjs';
import {
    checkUrlConsumer,
    urlReactTypedConsumer,
} from './url-consumer-checks.mjs';
import {
    checkEmailConsumer,
    emailReactTypedConsumer,
} from './email-consumer-checks.mjs';
import { checkNumberConsumer } from './number-consumer-checks.mjs';
import {
    checkCountConsumer,
    countReactTypedConsumer,
} from './count-consumer-checks.mjs';
import {
    checkAutoNumberConsumer,
    autoNumberReactTypedConsumer,
} from './autonumber-consumer-checks.mjs';
import {
    checkRatingConsumer,
    ratingReactTypedConsumer,
} from './rating-consumer-checks.mjs';
import {
    checkPercentConsumer,
    percentReactTypedConsumer,
} from './percent-consumer-checks.mjs';
import {
    checkDateRendererConsumer,
    dateRendererReactTypedConsumer,
} from './date-renderer-consumer-checks.mjs';
import {
    checkDateTimeRendererConsumer,
    dateTimeRendererReactTypedConsumer,
} from './datetime-renderer-consumer-checks.mjs';
import {
    checkDurationRendererConsumer,
    durationRendererReactTypedConsumer,
} from './duration-renderer-consumer-checks.mjs';
import {
    checkCurrencyRendererConsumer,
    currencyRendererReactTypedConsumer,
} from './currency-renderer-consumer-checks.mjs';
import {
    checkPortalButtonCompositionConsumer,
    portalButtonCompositionTypedConsumer,
    portalButtonCompositionReactTypedConsumer,
} from './portal-button-composition-consumer-checks.mjs';
import {
    checkLinkedRecordsConsumer,
    linkedRecordsTypedConsumer,
} from './linked-records-consumer-checks.mjs';
import { checkLinkedRendererConsumer } from './linked-renderer-consumer-checks.mjs';
import {
    checkLinkedChildConsumer,
    linkedChildTypedConsumer,
} from './linked-child-consumer-checks.mjs';
import {
    checkLinkedChildEditConsumer,
    linkedChildEditTypedConsumer,
} from './linked-child-edit-consumer-checks.mjs';
import {
    checkLinkedChildEditFreshnessConsumer,
    linkedChildEditFreshnessConsumerCheckCount,
} from './linked-child-edit-freshness-consumer-checks.mjs';
import { checkPortalLinkedPillConsumer } from './portal-linked-pill-consumer-checks.mjs';
import { checkCollaboratorValidationConsumer } from './collaborator-validation-consumer-checks.mjs';
import { checkConditionalPageValidationConsumer } from './conditional-page-validation-consumer-checks.mjs';
import {
    checkCrossPageChoiceConsumer,
    crossPageChoiceTypedConsumer,
} from './cross-page-choice-consumer-checks.mjs';
import {
    checkSelectAvailabilityBridgeConsumer,
    selectAvailabilityBridgeTypedConsumer,
} from './select-availability-bridge-consumer-checks.mjs';
import { checkSelectAvailabilityBridgeRecipe } from './select-availability-bridge-recipe-checks.mjs';
import { checkSelectOptionDriverConsumer } from './select-option-driver-consumer-checks.mjs';
import { checkSingleSelectFormDriverConsumer } from './single-select-form-driver-consumer-checks.mjs';
import { checkSingleSelectFormDriverRecipe } from './single-select-form-driver-recipe-checks.mjs';
import { checkMultipleSelectFormDriverConsumer } from './multi-select-form-driver-consumer-checks.mjs';
import { checkMultipleSelectFormDriverRecipe } from './multi-select-form-driver-recipe-checks.mjs';
import { checkSelectedRecordPolicyConsumer } from './selected-record-policy-checks.mjs';
import {
    checkButtonConsumer,
    buttonTypedConsumer,
    buttonReactTypedConsumer,
} from './button-consumer-checks.mjs';
import { rendererTypeConsumer } from './renderer-type-consumer.mjs';
import {
    checkRendererConsumer,
    rendererTypedConsumer,
    rendererReactTypedConsumer,
} from './renderer-consumer-checks.mjs';
import {
    checkFormPageConsumer,
    formPageTypedConsumer,
} from './form-page-consumer-checks.mjs';
import {
    checkFormCompositionConsumer,
    formCompositionTypedConsumer,
} from './form-composition-consumer-checks.mjs';
import {
    checkPortalCompositionConsumer,
    portalCompositionTypedConsumer,
} from './portal-composition-consumer-checks.mjs';
import { checkPortalEditorConsumer } from './portal-editor-consumer-checks.mjs';
import { checkDateBindingConsumer } from './date-binding-consumer-checks.mjs';
import { checkDateRangeConsumer } from './date-range-consumer-checks.mjs';
import { checkFormDispositionConsumer } from './form-disposition-consumer-checks.mjs';
import { checkFormSaveIdentityConsumer } from './form-save-identity-consumer-checks.mjs';
import { checkPortalOwnerConsumer } from './portal-owner-consumer-checks.mjs';
import {
    checkPortalViewAvailabilityConsumer,
    portalViewAvailabilityTypedConsumer,
} from './portal-view-availability-consumer-checks.mjs';
import {
    checkPortalReadFailureConsumer,
    checkPortalReadFailureRecipeConsumer,
    portalReadFailureTypedConsumer,
} from './portal-read-failure-consumer-checks.mjs';
import { checkSelectChoiceConsumer } from './select-choice-consumer-checks.mjs';
import { checkExistingAttachmentConsumer } from './existing-attachment-consumer-checks.mjs';
import { checkScalarBindingConsumer } from './scalar-binding-consumer-checks.mjs';
import {
    checkDurationBindingConsumer,
    durationTypedConsumer,
    durationReactTypedConsumer,
} from './duration-binding-consumer-checks.mjs';
import { checkReactBindingConsumer } from './react-binding-consumer-checks.mjs';
import { checkFieldBindingRecipe } from './field-binding-recipe-checks.mjs';
import { checkSelectConditions } from './select-condition-checks.mjs';
import { checkBrowserChildQueryExample } from './browser-child-query-example-checks.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
    assertBrowserInputs,
    assertInstalledArchive,
    assertPackedDocLinks,
} from './package-checks.mjs';
import { checkUiRecipes } from './ui-recipe-checks.mjs';
import { checkSelectAvailabilityRecipe } from './select-availability-recipe-checks.mjs';
import {
    checkAddressAutocompleteRecipe,
    checkAddressCompositionRecipe,
    checkBrowserAddressExample,
    checkBrowserAddressCompositionExample,
} from './address-autocomplete-recipe-checks.mjs';
import { checkFormRecipe } from './form-recipe-checks.mjs';
import { checkFormAttachmentRecipe } from './form-attachment-recipe-checks.mjs';
import { checkFormLinkedFilterRecipe } from './form-linked-filter-recipe-checks.mjs';
import { checkPortalRecipe } from './portal-recipe-checks.mjs';
import { checkAuthRecipe } from './auth-recipe-checks.mjs';
import { checkSessionRestoration } from './session-restoration-checks.mjs';
import { checkAdditionalRuntimeOperations } from './additional-runtime-recipe-checks.mjs';
import { checkFormConditions } from './form-conditions-checks.mjs';
import { checkScalarVisibilityRecipe } from './scalar-visibility-recipe-checks.mjs';
import {
    checkFormVisibilityRecipe,
    checkBrowserVisibilityExample,
    checkEditHideEmptyRecipe,
    checkBrowserEditHideEmptyExample,
} from './form-visibility-recipe-checks.mjs';
import { checkBrowserPortalExample } from './browser-portal-example-checks.mjs';
import { checkBrowserSelectExample } from './browser-select-example-checks.mjs';
import { checkSectionProjectionRecipe } from './section-projection-recipe-checks.mjs';
import { checkFormPageReviewRecipe } from './form-page-review-recipe-checks.mjs';
import { checkFormReviewRecipe } from './form-review-recipe-checks.mjs';
import { runPackedTailChecks } from './packed-tail-checks.mjs';
import { checkLinkedReviewRecipe } from './linked-review-recipe-checks.mjs';
import { checkBrowserCombinedEmptyReviewExample } from './browser-review-example-checks.mjs';
import { checkBrowserLinkedFilterExample } from './browser-linked-filter-example-checks.mjs';
import { createHash } from 'node:crypto';
import { buildPrivacyBrowserProof } from './build-privacy-browser-proof.mjs';
import { retainCheckedPackage } from './retain-checked-package.mjs';
import { assertPublicDistribution } from './distribution-checks.mjs';
import { assertModuleFormatReceipt } from './module-format-checks.mjs';

const require = createRequire(import.meta.url);
const temporaryDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-sdk-'))
);
// A sibling temp root has no generic consumer node_modules in its ancestry.
const browserKitDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-browser-'))
);
const browserDirectory = join(browserKitDirectory, 'examples/browser');
const uiDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-ui-'))
);
const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
let packageConsumerCleanupSafe = true;
let browserPortalChecks = 0;
let browserPortalSortChecks = 0;
let browserPortalFilterChecks = 0;
let browserSelectChecks = 0;
let browserLinkedFilterChecks = 0;
let browserChildQueryChecks = 0;
let browserVisibilityChecks = 0;
let browserEditHideEmptyChecks = 0;
let browserAddressChecks = 0;
let browserAddressCompositionChecks = 0;
let formReviewRecipeChecks = 0;
let formPageReviewRecipeChecks = 0;
let linkedReviewRecipeChecks = 0;
let attachmentReviewChecks = 0;
let browserAttachmentReviewChecks = 0;
let sectionProjectionChecks = 0;
let browserReviewChecks = 0;
let browserCombinedReviewChecks = 0;
const browserStarterFiles = [
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'index.html',
    'styles.css',
    'build.mjs',
    'dev.mjs',
    'src/main.ts',
    'src/fields.ts',
    'src/customFieldRenderer.ts',
    'src/portal.ts',
    'src/confirmation.ts',
    'src/review.ts',
    'src/linkedReview.ts',
    'src/pendingFiles.ts',
    'src/attachmentPresentation.ts',
    'src/attachmentUpload.ts',
    'src/dom.ts',
    'src/drafts.ts',
    'src/recovery.ts',
    'src/linkedFilters.ts',
    'src/choiceAvailability.ts',
    'src/childQueries.ts',
    'src/portalSort.ts',
    'src/portalFilter.ts',
    'src/rememberedSession.ts',
].map((path) => `examples/browser/${path}`);

function run(command, args, cwd = temporaryDirectory) {
    return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            npm_config_cache: join(temporaryDirectory, 'npm-cache'),
        },
        timeout: 120000,
    });
}

try {
    // check:package also works alone; never pack leftover build output.
    run(process.execPath, ['scripts/build.mjs'], process.cwd());
    const packed = JSON.parse(
        run(
            'npm',
            [
                'pack',
                '--json',
                '--ignore-scripts',
                '--pack-destination',
                temporaryDirectory,
            ],
            process.cwd()
        )
    )[0];
    for (const { path } of packed.files) {
        assert(
            path === 'package.json' ||
                path === 'README.md' ||
                path === 'LICENSE' ||
                path === 'THIRD_PARTY_NOTICES.md' ||
                path === 'docs/formulas.md' ||
                path === 'docs/runtime.md' ||
                path === 'docs/ui.md' ||
                path === 'docs/forms.md' ||
                path === 'docs/field-bindings.md' ||
                path === 'docs/portals.md' ||
                path === 'docs/auth.md' ||
                path === 'docs/browser-lifecycle.md' ||
                path === 'docs/testing.md' ||
                browserStarterFiles.includes(path) ||
                path.startsWith('dist/esm/') ||
                path.startsWith('dist/cjs/'),
            `Unexpected packed file: ${path}`
        );
    }
    for (const path of [
        'docs/browser-lifecycle.md',
        'docs/testing.md',
        'dist/esm/react/button.css',
        'dist/cjs/react/button.css',
        'dist/esm/react/checkbox.css',
        'dist/cjs/react/checkbox.css',
        'dist/esm/react/single-select.css',
        'dist/cjs/react/single-select.css',
        'dist/esm/react/text.css',
        'dist/cjs/react/text.css',
        'dist/esm/react/number.css',
        'dist/cjs/react/number.css',
        'dist/esm/react/date.css',
        'dist/cjs/react/date.css',
        'dist/esm/react/datetime.css',
        'dist/cjs/react/datetime.css',
        'dist/esm/react/duration.css',
        'dist/cjs/react/duration.css',
        'dist/esm/react/currency.css',
        'dist/cjs/react/currency.css',
        'dist/esm/react/multiple-select.css',
        'dist/cjs/react/multiple-select.css',
        'dist/esm/react/linked-records.css',
        'dist/cjs/react/linked-records.css',
        ...browserStarterFiles,
    ]) {
        assert(
            packed.files.some((file) => file.path === path),
            `Missing shipped browser starter file: ${path}`
        );
    }
    writeFileSync(
        join(temporaryDirectory, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
    );
    run('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        join(temporaryDirectory, packed.filename),
    ]);
    const installedPackage = join(
        temporaryDirectory,
        'node_modules/@miniextensions/sdk'
    );
    await assertInstalledArchive(
        temporaryDirectory,
        join(temporaryDirectory, packed.filename),
        packed
    );
    assertModuleFormatReceipt(installedPackage);
    await assertPublicDistribution(
        installedPackage,
        packed.files.map(({ path }) => path),
        JSON.parse(
            readFileSync(
                'src/runtime/contracts/generated.provenance.json',
                'utf8'
            )
        )
    );
    await assertPackedDocLinks(
        installedPackage,
        packed.files.map(({ path }) => path)
    );

    // Compile the actual shipped quickstart against installed declarations.
    const runtimeGuide = readFileSync(
        join(installedPackage, 'docs/runtime.md'),
        'utf8'
    );
    const quickstart = runtimeGuide
        .split('## Packaged Form quickstart\n')[1]
        ?.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    assert(quickstart, 'Missing packaged Form quickstart');
    const guideExamples = [...runtimeGuide.matchAll(/```ts\n([\s\S]*?)\n```/g)]
        .map(([, code]) => code)
        .join('\n');
    writeFileSync(join(temporaryDirectory, 'runtime-guide.ts'), guideExamples);
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        'runtime-guide.ts',
    ]);
    const uiGuide = readFileSync(join(installedPackage, 'docs/ui.md'), 'utf8');
    const uiGuideSources = [...uiGuide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(
        ([, code], index) => {
            const filename = `ui-guide-${index}.ts`;
            writeFileSync(join(temporaryDirectory, filename), code);
            return filename;
        }
    );
    assert(uiGuideSources.length > 0, 'Missing complete UI guide examples');
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        ...uiGuideSources,
    ]);

    await checkUiRecipes({
        consumerDirectory: temporaryDirectory,
        guideSources: uiGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    const selectAvailabilityRecipeChecks = await checkSelectAvailabilityRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: uiGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    const addressAutocompleteRecipe = await checkAddressAutocompleteRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: uiGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    const addressCompositionRecipe = await checkAddressCompositionRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: uiGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });

    const formsGuide = readFileSync(
        join(installedPackage, 'docs/forms.md'),
        'utf8'
    );
    // Typecheck local recipe imports against the exact archive's shipped source.
    cpSync(
        join(installedPackage, 'examples/browser/src'),
        join(temporaryDirectory, 'src'),
        { recursive: true }
    );
    const formsGuideSources = [
        ...formsGuide.matchAll(/```ts\n([\s\S]*?)\n```/g),
    ].map(([, code], index) => {
        const filename = `forms-guide-${index}.ts`;
        writeFileSync(join(temporaryDirectory, filename), code);
        return filename;
    });
    assert(
        formsGuideSources.length > 0,
        'Missing complete Form helper recipes'
    );
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        ...formsGuideSources,
    ]);
    await checkFormRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: formsGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    const attachmentRecipe = await checkFormAttachmentRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: formsGuideSources,
    });
    const linkedFilterRecipe = await checkFormLinkedFilterRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: formsGuideSources,
    });
    const scalarVisibilityRecipe = await checkScalarVisibilityRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: formsGuideSources,
    });
    const formVisibilityRecipe = await checkFormVisibilityRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: formsGuideSources,
    });
    const editHideEmptyRecipe = await checkEditHideEmptyRecipe({
        consumerDirectory: temporaryDirectory,
    });

    const portalsGuide = readFileSync(
        join(installedPackage, 'docs/portals.md'),
        'utf8'
    );
    const portalsReactGuideSources = [];
    const portalsGuideSources = [
        ...portalsGuide.matchAll(/```ts\n([\s\S]*?)\n```/g),
    ].map(([, code], index) => {
        const filename = code.includes(
            'export function createPortalScreenOwner('
        )
            ? 'portal-owner.ts'
            : `portals-guide-${index}.ts`;
        writeFileSync(join(temporaryDirectory, filename), code);
        if (
            /\b(?:from\s*|(?:import|require)\s*(?:\(\s*)?)['"](?:react(?:-dom)?(?:\/[^'"]*)?|@miniextensions\/sdk\/react(?:\/[^'"]*)?)['"]/.test(
                code
            )
        )
            portalsReactGuideSources.push(filename);
        return filename;
    });
    assert(portalsGuideSources.length > 0, 'Missing complete Portal recipes');
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        ...portalsGuideSources.filter(
            (filename) => !portalsReactGuideSources.includes(filename)
        ),
    ]);
    // Keep the complete exact-doc provenance input, including deferred React
    // blocks; this headless recipe runner executes only its named owner block.
    const portalRecipe = await checkPortalRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: portalsGuideSources,
    });

    const formulasGuide = readFileSync(
        join(installedPackage, 'docs/formulas.md'),
        'utf8'
    );
    const formulasGuideSources = [
        ...formulasGuide.matchAll(/```ts\n([\s\S]*?)\n```/g),
    ].map(([, code], index) => {
        const filename = `formulas-guide-${index}.ts`;
        writeFileSync(join(temporaryDirectory, filename), code);
        return filename;
    });
    assert(formulasGuideSources.length > 0, 'Missing formula context recipes');

    const fieldKindsConsumer = `
import { AirtableFieldType } from '@miniextensions/sdk/field-types';
if (AirtableFieldType.NUMBER !== 'number' || AirtableFieldType.MANUAL_SORT !== 'manualSort') throw new Error('Field kind values changed');
export const numericKind = AirtableFieldType.NUMBER;
`;
    writeFileSync(
        join(temporaryDirectory, 'field-kinds.mjs'),
        fieldKindsConsumer
    );
    run(process.execPath, ['field-kinds.mjs']);
    const fieldKindsBundle = await build({
        stdin: { contents: fieldKindsConsumer, resolveDir: temporaryDirectory },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        metafile: true,
    });
    assert(
        Object.keys(fieldKindsBundle.metafile.inputs).every(
            (path) =>
                path === '<stdin>' ||
                /\/dist\/esm\/(field-types|formulas\/types)\.js$/.test(path)
        ),
        'Field kinds browser entry must not load the formula runtime'
    );

    const parserChecks = String.raw`
// Preserve deep-input compatibility through installed entry points.
for (const [prefix, suffix, depth] of [['-', '', 8000], ['(', ')', 500], ['SUM(', ')', 500]]) {
    const source = prefix.repeat(depth) + '1' + suffix.repeat(depth);
    const tokens = new Lexer(source).tokenize();
    const expression = new Parser(tokens).parse();
    if (!expression || new Parser(tokens).parse() !== expression) throw new Error('Default parser compatibility failed');
    if (new Parser(tokens).parse({cache:false}) === expression) throw new Error('Unbounded parser bypass failed');
}
const boundedTokens = new Lexer('{Price}+SUM({Tax})').tokenize({cache:false,maxTokens:8192});
const boundedExpr = new Parser(boundedTokens).parse({cache:false,maxDepth:48});
if (extractIdentifiersFromExpr(boundedExpr).join(',') !== 'Price,Tax') throw new Error('Bounded installed parser lost identifiers');
function expectParserLimit(action, message) {
    try { action(); } catch (error) {
        if (error instanceof RangeError && error.message === message) return;
        throw error;
    }
    throw new Error('Installed parser limit was not enforced');
}
if (new Lexer('1 '.repeat(8192)).tokenize({cache:false,maxTokens:8192}).length !== 8192) throw new Error('Exact token boundary failed');
expectParserLimit(() => new Lexer('1 "unterminated').tokenize({cache:false,maxTokens:1}), 'Formula token limit exceeded');
const exactDepth = new Lexer('-'.repeat(47)+'1').tokenize({cache:false});
new Parser(exactDepth).parse({cache:false,maxDepth:48});
expectParserLimit(() => new Parser(new Lexer('-'.repeat(20000)+'1').tokenize({cache:false})).parse({cache:false,maxDepth:48}), 'Formula depth limit exceeded');
const sharedTokens = new Lexer('{InstalledCacheWitness}+7').tokenize();
if (new Lexer('{InstalledCacheWitness}+7').tokenize({cache:false}) === sharedTokens) throw new Error('Lexer bypass read cache');
const uncachedExpr = new Parser(sharedTokens).parse({cache:false});
const sharedExpr = new Parser(sharedTokens).parse();
if (uncachedExpr === sharedExpr || new Parser(sharedTokens).parse({cache:false}) === sharedExpr) throw new Error('Parser bypass touched cache');
expectParserLimit(() => new Parser(sharedTokens).parse({maxDepth:1}), 'Formula depth limit exceeded');
`;
    const formattingChecks = String.raw`
for (const [input, expected] of [
    ['', ''], ['Alpha', 'Alpha'], ['North, West', '"North, West"'],
    ['Say "hello"', '"Say ""hello"""'],
]) {
    if (formatMultiSelectValue(input) !== expected) throw new Error('Multi-select formatting failed');
}
for (const [input, expected] of [
    ['', ''], ['**Hello** [world](https://example.com)', 'Hello [world](https://example.com)'],
    ['**Hello** [world](https://example.com)', 'Hello [world](https://example.com)'],
]) {
    if (removeMarkdown(input) !== expected) throw new Error('Markdown display formatting failed');
}
for (const [format, expected] of [
    ['h:mm', '-1:01'], ['h:mm:ss', '-1:01:20'],
    ['h:mm:ss.S', '-1:01:20.4'], ['h:mm:ss.SS', '-1:01:20.40'],
    ['h:mm:ss.SSS', '-1:01:20.400'],
]) {
    if (getFormattedDuration('-3680.4', format, true) !== expected) throw new Error('Native duration formatting failed');
}
if (getFormattedDuration('', 'h:mm') !== '') throw new Error('Empty duration formatting failed');
if (getFormattedDuration('60', 'h:mm') !== '1:00') throw new Error('Default duration minutes failed');
if (getFormattedDuration('60', 'h:mm', true) !== '0:01') throw new Error('Explicit duration seconds failed');
`;
    const consumer = `
import { FormulaRunner, Lexer, Parser, extractIdentifiersFromExpr, AirtableFieldType, formatMultiSelectValue, removeMarkdown, getFormattedDuration } from '@miniextensions/sdk/formulas';
import { AirtableFieldType as PublicFieldType } from '@miniextensions/sdk/field-types';
if (PublicFieldType !== AirtableFieldType) throw new Error('ESM field enum identity changed');
import { createMiniExtensionsClient, withExtensionPassword, withLoginToken } from '@miniextensions/sdk';
const client = createMiniExtensionsClient({ apiOrigin: 'https://api.example.com' });
client.setSession(withExtensionPassword({}, { extensionId: 'extExample', encryptedExtensionPassword: 'password-token' }));
client.setSession(withLoginToken(client.getSession(), { extensionId: 'extExample', tableId: 'tblExample', loginFieldNames: ['Email'], encryptedLoginToken: 'login-token' }));
if (Object.keys(client.getSession()).length !== 2) throw new Error('Session helper failed');
interface NumericOptions { precision: number; }
const numericOptions: NumericOptions = { precision: 0 };
const runner = new FormulaRunner('{Quantity} * 3');
runner.context = {
    record: { id: 'recExample', fields: { fldQuantity: 4 } },
    airtableFields: [{
        id: 'fldQuantity', name: 'Quantity', isPrimaryField: true,
        config: { type: AirtableFieldType.NUMBER, options: numericOptions }
    }],
    linkedTableLoadingStates: {}
};
if (runner.run() !== 12) throw new Error('Formula context did not resolve');
export const result = runner.run();
export const display: string = formatMultiSelectValue(removeMarkdown('**Alpha**')) + getFormattedDuration('60', 'h:mm', true);
`;
    const javascriptConsumer = consumer
        .replace(
            'interface NumericOptions { precision: number; }\nconst numericOptions: NumericOptions',
            'const numericOptions'
        )
        .replace('export const display: string', 'export const display');
    writeFileSync(
        join(temporaryDirectory, 'consumer.mjs'),
        javascriptConsumer + formattingChecks + parserChecks
    );
    run(process.execPath, ['consumer.mjs']);

    writeFileSync(
        join(temporaryDirectory, 'consumer.cjs'),
        `const before = new Set(Object.keys(require.cache));
const { AirtableFieldType } = require('@miniextensions/sdk/field-types');
const loaded = Object.keys(require.cache).filter(path => !before.has(path));
if (!loaded.every(path => path.endsWith('/dist/cjs/field-types.js') || path.endsWith('/dist/cjs/formulas/types.js'))) throw new Error('Field kinds CommonJS entry loaded the formula runtime');
const { FormulaRunner, Lexer, Parser, extractIdentifiersFromExpr, AirtableFieldType: FormulaFieldType, formatMultiSelectValue, removeMarkdown, getFormattedDuration } = require('@miniextensions/sdk/formulas');
if (AirtableFieldType !== FormulaFieldType) throw new Error('CommonJS field enum identity changed');
const { createMiniExtensionsClient } = require('@miniextensions/sdk');
if (Object.keys(createMiniExtensionsClient({ apiOrigin: 'https://api.example.com' }).getSession()).length !== 0) throw new Error('CommonJS runtime client failed');
if (new FormulaRunner('2 + 3 * 4').run() !== 14) throw new Error('CommonJS formula evaluation failed');
${formattingChecks}
${parserChecks}`
    );
    run(process.execPath, ['consumer.cjs']);

    // Start cold with a deliberately small stack: a warm/default-stack process
    // can hide recursive unary parsing failures on other Node builds.
    const unaryChecks = `
const tokens = new Lexer('-'.repeat(8000) + '1').tokenize({cache:false});
for (const maxDepth of [undefined, 8001]) {
    let expression = new Parser(tokens).parse({cache:false,maxDepth});
    for (let index = 0; index < 8000; index++) {
        assert.ok(expression instanceof Unary);
        assert.strictEqual(expression.operator, tokens[index]);
        expression = expression.left;
    }
    assert.ok(expression instanceof Literal);
    assert.equal(expression.value, 1);
}
assert.throws(() => new Parser(tokens).parse({maxDepth:8000}), {
    name: 'RangeError', message: 'Formula depth limit exceeded'
});
`;
    for (const [extension, imports] of [
        [
            'mjs',
            "import assert from 'node:assert/strict'; import {Lexer, Parser, Unary, Literal} from '@miniextensions/sdk/formulas';",
        ],
        [
            'cjs',
            "const assert = require('node:assert/strict'); const {Lexer, Parser, Unary, Literal} = require('@miniextensions/sdk/formulas');",
        ],
    ]) {
        const filename = `unary-cold.${extension}`;
        writeFileSync(
            join(temporaryDirectory, filename),
            imports + unaryChecks
        );
        run(process.execPath, ['--stack-size=256', filename]);
        // Grouping/calls must also start cold; unary-chain warmup can mask a
        // larger frame reducing the existing non-unary recursion capacity.
        for (const [kind, prefix, depth, maxDepth] of [
            ['groups', '(', 950],
            ['calls', 'SUM(', 950],
            ['unary-groups', '-(', 850],
            ['unary-calls', '-SUM(', 850],
            ['double-unary-groups', '--(', 780],
            ['double-unary-calls', '--SUM(', 780],
            ['triple-unary-groups', '---(', 710],
            ['triple-unary-calls', '---SUM(', 710],
            ['bounded-unary-groups', '-(', 700, 1401],
            ['bounded-unary-calls', '-SUM(', 700, 1401],
            ['bounded-double-unary-groups', '--(', 600, 1801],
            ['bounded-double-unary-calls', '--SUM(', 600, 1801],
        ]) {
            const nestedFilename = `${kind}-cold.${extension}`;
            writeFileSync(
                join(temporaryDirectory, nestedFilename),
                imports +
                    `
const tokens = new Lexer(${JSON.stringify(prefix)}.repeat(${depth}) + '1' + ')'.repeat(${depth})).tokenize();
const maxDepth = ${maxDepth};
const expression = new Parser(tokens).parse({maxDepth});
assert.ok(expression);
if (maxDepth === undefined) {
    assert.strictEqual(new Parser(tokens).parse(), expression);
} else {
    assert.throws(() => new Parser(tokens).parse({maxDepth:maxDepth-1}), {
        name: 'RangeError', message: 'Formula depth limit exceeded'
    });
}
assert.notStrictEqual(new Parser(tokens).parse({cache:false,maxDepth}), expression);
`
            );
            // High nesting is not a portable default-stack promise. Keep an
            // explicit common budget plus the Linux x64 regression witness.
            const stackSizes =
                process.platform === 'linux' && process.arch === 'x64'
                    ? [2048, 984]
                    : [2048];
            for (const stackSize of stackSizes)
                run(process.execPath, [
                    `--stack-size=${stackSize}`,
                    nestedFilename,
                ]);
        }
    }

    for (const dependency of ['react', 'react-dom', 'vue', 'happy-dom']) {
        assert(
            !existsSync(join(temporaryDirectory, 'node_modules', dependency)),
            `UI/test dependency leaked into package consumers: ${dependency}`
        );
    }
    const uiConsumer = `
import { createSelectionModel, createSelectControl, mountSelectionControl, createFormLinkedRecordLoader, createPortalLinkedRecordLoader } from '@miniextensions/sdk/ui';
if ([createSelectControl, mountSelectionControl, createFormLinkedRecordLoader, createPortalLinkedRecordLoader].some(value => typeof value !== 'function')) throw new Error('Missing public UI export');
const selection = createSelectionModel({ multiple: true, options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] });
selection.choose(['one', 'two']);
if (selection.getState().value.join(',') !== 'one,two') throw new Error('Packed selection model failed');
selection.destroy();
`;
    writeFileSync(join(temporaryDirectory, 'ui-consumer.mjs'), uiConsumer);
    run(process.execPath, ['ui-consumer.mjs']);
    writeFileSync(
        join(temporaryDirectory, 'ui-consumer.cjs'),
        `const { createSelectionModel, createSelectControl } = require('@miniextensions/sdk/ui');
if (typeof createSelectControl !== 'function') throw new Error('Missing CJS UI export');
const selection = createSelectionModel({options:[{value:'one',label:'One'}]});
selection.choose(['one']);
if (selection.getState().value[0] !== 'one') throw new Error('Packed CJS selection failed');
selection.destroy();\n`
    );
    run(process.execPath, ['ui-consumer.cjs']);

    const formsConsumer = `
import { FormDraftStore, openLoadedFormDraft, createFormSaveInput, normalizeFormSaveResult, describeLoadedFormFields, createFormController } from '@miniextensions/sdk/forms';
if ([openLoadedFormDraft, createFormSaveInput, normalizeFormSaveResult, describeLoadedFormFields, createFormController].some(value => typeof value !== 'function')) throw new Error('Missing Form helper export');
const store = new FormDraftStore();
const draft = store.open({extensionId:'extExample',recordId:null,parent:null},{fldExample:['Design']},[]);
store.write(draft,'fldExample',['Design','Support']);
if (store.snapshot(draft)?.data.fldExample.join(',') !== 'Design,Support') throw new Error('Packed Form draft failed');
store.clear();
if (store.snapshot(draft) !== null) throw new Error('Packed Form draft did not expire');
`;
    writeFileSync(
        join(temporaryDirectory, 'forms-consumer.mjs'),
        formsConsumer
    );
    run(process.execPath, ['forms-consumer.mjs']);
    writeFileSync(
        join(temporaryDirectory, 'forms-consumer.cjs'),
        `const { FormDraftStore, createFormController } = require('@miniextensions/sdk/forms');
if (typeof createFormController !== 'function') throw new Error('Missing CommonJS Form controller export');
const store = new FormDraftStore();
const draft = store.open({extensionId:'extExample',recordId:null,parent:null},{fldExample:'Draft'},[]);
if (store.snapshot(draft)?.data.fldExample !== 'Draft') throw new Error('CommonJS Form draft failed');
store.clear();\n`
    );
    run(process.execPath, ['forms-consumer.cjs']);

    const portalsConsumer = `
import { createPortalCollection, PortalCollectionError } from '@miniextensions/sdk/portals';
if ([createPortalCollection, PortalCollectionError].some(value => typeof value !== 'function')) throw new Error('Missing Portal collection export');
export const helperType = typeof createPortalCollection;
`;
    writeFileSync(
        join(temporaryDirectory, 'portals-consumer.mjs'),
        portalsConsumer
    );
    run(process.execPath, ['portals-consumer.mjs']);
    writeFileSync(
        join(temporaryDirectory, 'portals-consumer.cjs'),
        `const { createPortalCollection, PortalCollectionError } = require('@miniextensions/sdk/portals');
if ([createPortalCollection, PortalCollectionError].some(value => typeof value !== 'function')) throw new Error('Missing CommonJS Portal collection export');\n`
    );
    run(process.execPath, ['portals-consumer.cjs']);

    const authPage = {
        extensionScreen: 'password',
        extensionId: 'extension_example',
        language: 'en',
        themeColor: 'blue',
        enableCommentsOnChildForms: false,
        workspaceId: 'workspace_example',
        extensionOwnerUID: 'owner_example',
        faviconUrl: null,
        googleAnalyticsMeasurementId: null,
        isStarterExtension: false,
        payload: {
            baseId: 'base_example',
            loggedInUserCanEditExtension: false,
            showMiniExtensionsBranding: true,
            onFreePlan: true,
            trialExpiresAtUnixEpoch: null,
        },
    };
    const authConsumerBody = `
const flow = createAuthFlow({
    client: createMiniExtensionsClient({apiOrigin:'https://api.example.com'}),
    page: ${JSON.stringify(authPage)},
    getScope: () => ({ownerId:'visitor_example',revision:0})
});
if (!flow.isCurrent() || flow.screen !== 'password') throw new Error('Packed auth flow failed');
flow.destroy();
export const disposed = !flow.isCurrent();
if (!disposed) throw new Error('Packed auth flow did not dispose');
`;
    writeFileSync(
        join(temporaryDirectory, 'auth-consumer.mjs'),
        `import { createAuthFlow } from '@miniextensions/sdk/auth';
import { createMiniExtensionsClient } from '@miniextensions/sdk';
${authConsumerBody}`
    );
    run(process.execPath, ['auth-consumer.mjs']);
    writeFileSync(
        join(temporaryDirectory, 'auth-consumer.cjs'),
        `const { createAuthFlow } = require('@miniextensions/sdk/auth');
const { createMiniExtensionsClient } = require('@miniextensions/sdk');
${authConsumerBody.replace('export const disposed', 'const disposed')}`
    );
    run(process.execPath, ['auth-consumer.cjs']);

    const declarationConsumer =
        consumer +
        rendererTypeConsumer +
        buttonTypedConsumer +
        portalButtonCompositionTypedConsumer +
        durationTypedConsumer +
        portalViewAvailabilityTypedConsumer +
        portalReadFailureTypedConsumer +
        `
import type { DurationFormat } from '@miniextensions/sdk/formulas';
const publicDurationFormat: DurationFormat = 'h:mm:ss.SSS';
export const durationDisplay: string = getFormattedDuration('1.234', publicDurationFormat, true);
// @ts-expect-error unsupported duration display formats are not public inputs
const unsupportedDurationFormat: DurationFormat = 'mm:ss';
const publicNumber: PublicFieldType.NUMBER = AirtableFieldType.NUMBER;
const formulaNumber: AirtableFieldType.NUMBER = PublicFieldType.NUMBER;
// @ts-expect-error unrelated field kinds must not satisfy numeric enum members
const invalidNumber: PublicFieldType.NUMBER = PublicFieldType.DATE;
import type { ListConditionalFilterPrimaryValuesInput, ConditionalFilterPrimaryValue, ConditionalFilterData, ListAddressPredictionsInput, AddressPrediction, GetFormattedAddressInput, TriggerConfiguredButtonWebhookInput, ConfiguredButtonWebhookSource, TriggerConfiguredButtonWebhookResult } from '@miniextensions/sdk';
export async function checkAdditionalRuntimeTypes(client: MiniExtensionsClient, signal: AbortSignal) {
    const filterData: ConditionalFilterData = {previousFilterFieldId:'fldCountry', previousFilterPrimaryValue:'United States'};
    const conditional: ListConditionalFilterPrimaryValuesInput = {extensionAccessToken:'formToken',linkedRecordsFilterFieldId:'fldRegion',mainTableLinkedRecordsFieldId:'fldProjects',searchTerm:'North',filterData,urlSearchValue:null};
    const values = await client.linkedRecords.listConditionalFilterPrimaryValues(conditional, {signal,session:{visitor:'requestVisitor'}});
    const first: ConditionalFilterPrimaryValue | undefined = values.primaryValues[0];
    const prefill: ConditionalFilterPrimaryValue | null = values.prefillValue;
    const address: ListAddressPredictionsInput = {extensionAccessToken:'formToken',fieldId:'fldAddress',addressFieldValue:'12 Main'};
    const predictions: AddressPrediction[] = await client.addresses.listPredictions(address, {signal});
    const place: GetFormattedAddressInput = {extensionAccessToken:'formToken',fieldId:'fldAddress',placeId:predictions[0]?.placeId ?? 'placeExample'};
    const formatted: string = await client.addresses.getFormattedAddress(place, {signal});
    const current: ConfiguredButtonWebhookSource = {type:'current-record',recordId:'recCurrent'};
    const linked: ConfiguredButtonWebhookSource = {type:'linked-record',linkedRecordId:'recChild',linkedTableId:'tblChildren',parentLinkedRecordFieldId:'fldChildren',selectedCustomViewId:null};
    const button: TriggerConfiguredButtonWebhookInput = {extensionAccessToken:'formToken',fieldId:'fldButton',source:current};
    const result: TriggerConfiguredButtonWebhookResult = await client.buttons.triggerWebhook(button, {signal});
    await client.buttons.triggerWebhook({...button,source:linked}, {signal});
    // @ts-expect-error only configured current-record and linked-record sources are supported
    const arbitrary: ConfiguredButtonWebhookSource = {type:'url',url:'https://other.example'};
    // @ts-expect-error linked source requires the configured outer parent field ID
    const missingParent: ConfiguredButtonWebhookSource = {type:'linked-record',linkedRecordId:'recChild',linkedTableId:'tblChildren'};
    // @ts-expect-error callers do not supply a webhook URL or HTTP method
    const redirected: TriggerConfiguredButtonWebhookInput = {extensionAccessToken:'formToken',fieldId:'fldButton',source:current,url:'https://other.example',method:'POST'};
    return [first?.recordId,prefill?.stringValue,formatted,result.success,arbitrary,missingParent,redirected];
}
import { createSelectControl, mountSelectionControl, createSelectionModel, createFormLinkedRecordLoader, createPortalLinkedRecordLoader, type SelectionLoader } from '@miniextensions/sdk/ui';
import type { MiniExtensionsClient, ListFormLinkedRecordOptionsInput, ListPortalLinkedRecordOptionsInput } from '@miniextensions/sdk';
export function checkUiTypes(field: RuntimeFieldSchema, host: HTMLElement, client: MiniExtensionsClient, form: Omit<ListFormLinkedRecordOptionsInput, 'filter'|'offset'>, portal: Omit<ListPortalLinkedRecordOptionsInput, 'filter'|'offset'>) {
    const native = createSelectControl({field, value: null, onChange: value => void value});
    host.append(native.element);
    const formLoader: SelectionLoader = createFormLinkedRecordLoader({client, input: form, linkedTableId: 'tblExample'});
    const portalLoader: SelectionLoader = createPortalLinkedRecordLoader({client, input: portal, linkedTableId: 'tblExample'});
    const model = createSelectionModel({multiple: true, loadOptions: formLoader});
    const linked = mountSelectionControl(model, {label: 'Projects', formatLabel: option => option.label});
    host.append(linked.element);
    model.reset({loadOptions: portalLoader});
    linked.destroy(); model.destroy(); native.destroy();
}
import type { FormLoadedResult, RuntimeFieldSchema } from '@miniextensions/sdk';
import { FormDraftStore, openLoadedFormDraft, createFormSaveInput, normalizeFormSaveResult, describeLoadedFormFields, createFormController, type FormSaveOptions, type FormOwnerScope } from '@miniextensions/sdk/forms';
export function checkFormHelpers(loaded: FormLoadedResult, client: MiniExtensionsClient, options: FormSaveOptions, getScope: () => FormOwnerScope) {
    const store = new FormDraftStore<AirtableValue>();
    const draft = openLoadedFormDraft({store, loaded});
    const snapshot = store.snapshot(draft);
    if (snapshot !== null) createFormSaveInput({loaded, draft: snapshot, options});
    const descriptors = describeLoadedFormFields(loaded);
    const controller = createFormController({client, loaded, saveOptions: options, getScope, store});
    controller.subscribe(state => void state.validationErrors);
    controller.write(descriptors[0]?.fieldId ?? 'fldExample', ['Design']);
    controller.save().then(result => normalizeFormSaveResult(result.raw, loaded));
    controller.destroy();
}
import type { AirtableValue } from '@miniextensions/sdk';
import type { PortalLoadedResult } from '@miniextensions/sdk';
import { createPortalCollection, type PortalCollectionCriteria, type PortalOwnerScope, type PortalReadOptions, type PortalChildFormRequest, type PortalCollectionSnapshot } from '@miniextensions/sdk/portals';
export async function checkPortalHelpers(portal: PortalLoadedResult, client: MiniExtensionsClient, criteria: PortalCollectionCriteria, getScope: () => PortalOwnerScope, options: PortalReadOptions) {
    const collection = createPortalCollection({client, portal, portalFieldId: 'fldExample', criteria, getScope});
    const outcome = await collection.readFirst(options);
    if (outcome.type === 'loaded' && collection.isCurrent()) {
        const snapshot: PortalCollectionSnapshot = outcome.snapshot;
        const child: PortalChildFormRequest = collection.childFormRequest({access: {type: 'edit', recordId: snapshot.recordIds[0] ?? 'recExample'}, configuredChildExtensionId: 'childExample', query: {}, clientTimeZone: 'UTC', deviceFingerprint: {version: 1, visitorId: null}});
        if (child.isCurrent()) void child.saveContext;
    }
    await collection.readNext(options);
    collection.destroy();
}
import { createAuthFlow, type AuthOwnerScope } from '@miniextensions/sdk/auth';
import type { PasswordRequiredResult, LoginPageResult } from '@miniextensions/sdk';
export async function checkAuthTypes(page: PasswordRequiredResult | LoginPageResult, client: MiniExtensionsClient, getScope: () => AuthOwnerScope) {
    const flow = createAuthFlow({client, page, getScope});
    try {
        if (flow.screen === 'password') {
            const result = await flow.verifyPassword({extensionPassword:'Entered password'});
            if (result.type === 'correct' && flow.isCurrent()) flow.applySession(result.grant);
        } else {
            const result = await flow.login({loginCredentials:{Email:'person@example.test'},loginRecordId:'recExample',fallbackPhoneVerificationNumber:'+15555550100'});
            if (result.type === 'found-record' && flow.isCurrent()) flow.applySession(result.grant);
            if (result.type === 'verification-message-sent' && flow.isCurrent()) {
                const grant = await flow.confirmVerificationCode({challenge:result.challenge,verificationCode:'123456'});
                if (flow.isCurrent()) flow.applySession(grant);
            }
        }
    } finally { flow.destroy(); }
}
export async function checkSignupTypes(page: LoginPageResult, client: MiniExtensionsClient, getScope: () => AuthOwnerScope) {
    const flow = createAuthFlow({client,page,getScope});
    try { const result = await flow.signUp({signUpCredentials:{Email:'person@example.test'}}); return result.ok; }
    finally { flow.destroy(); }
}
export function renderChoiceNames(field: RuntimeFieldSchema): string[] {
    const config = field.airtableField.config;
    switch (config.type) {
        case AirtableFieldType.SINGLE_SELECT:
        case AirtableFieldType.MULTIPLE_SELECTS:
        case AirtableFieldType.EXTERNAL_SYNC_SOURCE:
            return config.options?.choices.map((choice) => {
                const color: string | undefined = choice.color;
                const newOption: boolean | undefined = choice.newOption;
                return choice.id + choice.name + (color ?? '') + (newOption ?? false);
            }) ?? [];
        case AirtableFieldType.SINGLE_COLLABORATOR:
        case AirtableFieldType.MULTIPLE_COLLABORATORS:
        case AirtableFieldType.CREATED_BY:
        case AirtableFieldType.LAST_MODIFIED_BY:
            return config.options?.choices.map((choice) => {
                const avatar: string | undefined = choice.profilePicUrl;
                return choice.id + choice.name + choice.email + (avatar ?? '');
            }) ?? [];
        default:
            return [];
    }
}
export function renderAttachmentPreview(extension: FormLoadedResult): {
    url: string | undefined;
    width: number | undefined;
    height: number | undefined;
} {
    const attachment = extension.payload.persistedAddOnlyAttachmentValuesByFieldId?.fldFiles?.[0];
    const small = attachment?.thumbnails?.small;
    const large = attachment?.thumbnails?.large;
    const full = attachment?.thumbnails?.full;
    return {
        url: large?.url ?? small?.url ?? full?.url,
        width: large?.width,
        height: large?.height,
    };
}
import type { RuntimeTableStates } from '@miniextensions/sdk';
import type { AirtableField as FormulaField, InterpreterContext } from '@miniextensions/sdk/formulas';
type FormulaLinkedStates = RuntimeTableStates | PortalLoadedResult['payload']['initialLinkedTableStates'];
function formulaLinkedStates(states: FormulaLinkedStates): InterpreterContext['linkedTableLoadingStates'] {
    const linked: InterpreterContext['linkedTableLoadingStates'] = {};
    for (const [tableId, state] of Object.entries(states)) {
        linked[tableId] = {type: 'loaded', data: {state}};
    }
    return linked;
}
export function checkLoadedFormFormula(form: FormLoadedResult, linkedStates: RuntimeTableStates) {
    const airtableFields: InterpreterContext['airtableFields'] =
        Object.values(form.payload.fieldIdsToSchemas).map(({airtableField}) => airtableField);
    if (form.payload.formRecord.type !== 'edit') return;
    const formula = new FormulaRunner('{Quantity} * 3');
    formula.context = {
        record: {id: form.payload.formRecord.recordId, fields: form.payload.formRecord.data},
        airtableFields,
        linkedTableLoadingStates: formulaLinkedStates(linkedStates),
    };
    return formula.run();
}
export function checkLoadedPortalFormula(portal: PortalLoadedResult, linkedStates: FormulaLinkedStates = portal.payload.initialLinkedTableStates) {
    const airtableFields: InterpreterContext['airtableFields'] = portal.payload.usersTableFields;
    const formula = new FormulaRunner('{Quantity} * 3');
    formula.context = {
        record: {id: portal.payload.formRecord.recordId, fields: portal.payload.formRecord.data},
        airtableFields,
        linkedTableLoadingStates: formulaLinkedStates(linkedStates),
    };
    return formula.run();
}
export function narrowFormulaNumber(config: FormulaField['config']): number | null {
    if (config.type === AirtableFieldType.NUMBER || config.type === AirtableFieldType.PERCENT) {
        return config.options.precision;
    }
    return null;
}
const enumFormulaConfig: FormulaField['config'] = {type: AirtableFieldType.NUMBER, options: {precision: 2}};
const literalFormulaConfig: FormulaField['config'] = {type: 'formula', options: {isValid: true, result: {type: 'currency', options: {precision: 2, symbol: '$'}}}};
// @ts-expect-error numeric fields require their options; they cannot enter the unformatted fallback
const missingNumberOptions: FormulaField['config'] = {type: 'number'};
// @ts-expect-error date fields require a date format
const missingDateFormat: FormulaField['config'] = {type: 'date', options: {dateFormat: {}}};
// @ts-expect-error linked-record fields require their linked table ID
const missingLinkedTable: FormulaField['config'] = {type: 'multipleRecordLinks', options: {}};
// @ts-expect-error a valid computed field requires its result config
const missingComputedResult: FormulaField['config'] = {type: 'formula', options: {isValid: true, result: null}};
// @ts-expect-error nested computed results retain currency's required symbol
const missingNestedSymbol: FormulaField['config'] = {type: 'rollup', options: {isValid: true, result: {type: 'currency', options: {precision: 2}}}};
// @ts-expect-error field discriminators remain a finite set
const unknownFormulaKind: FormulaField['config'] = {type: 'futureField'};
void [enumFormulaConfig, literalFormulaConfig, missingNumberOptions, missingDateFormat, missingLinkedTable, missingComputedResult, missingNestedSymbol, unknownFormulaKind];
`;

    for (const [filename, module, moduleResolution] of [
        ['consumer.mts', 'NodeNext', 'NodeNext'],
        ['consumer.cts', 'NodeNext', 'NodeNext'],
        ['browser-consumer.ts', 'ESNext', 'Bundler'],
    ]) {
        writeFileSync(
            join(temporaryDirectory, filename),
            declarationConsumer +
                `
const tokenOptions: import('@miniextensions/sdk/formulas').TokenizeOptions = {cache:false,maxTokens:8192};
const parseOptions: import('@miniextensions/sdk/formulas').ParseOptions = {cache:false,maxDepth:48};
new Parser(new Lexer('{Price}').tokenize(tokenOptions)).parse(parseOptions);
// @ts-expect-error token limits are numeric
new Lexer('1').tokenize({maxTokens:'8192'});
// @ts-expect-error depth limits are numeric
new Parser([]).parse({maxDepth:'48'});
`
        );
        const linkedRecordsFilename = `linked-records-${filename}`;
        writeFileSync(
            join(temporaryDirectory, linkedRecordsFilename),
            linkedRecordsTypedConsumer
        );
        const linkedChildFilename = `linked-child-${filename}`;
        writeFileSync(
            join(temporaryDirectory, linkedChildFilename),
            linkedChildTypedConsumer
        );
        const linkedChildEditFilename = `linked-child-edit-${filename}`;
        writeFileSync(
            join(temporaryDirectory, linkedChildEditFilename),
            linkedChildEditTypedConsumer
        );
        const rendererFilename = `renderers-${filename}`;
        writeFileSync(
            join(temporaryDirectory, rendererFilename),
            rendererTypedConsumer
        );
        const pageFilename = `form-pages-${filename}`;
        writeFileSync(
            join(temporaryDirectory, pageFilename),
            formPageTypedConsumer
        );
        run(process.execPath, [
            require.resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            'false',
            '--target',
            'ES2022',
            '--module',
            module,
            '--moduleResolution',
            moduleResolution,
            filename,
            rendererFilename,
            linkedRecordsFilename,
            linkedChildFilename,
            linkedChildEditFilename,
            pageFilename,
            ...formulasGuideSources,
        ]);
    }

    const bundled = await build({
        entryPoints: [join(temporaryDirectory, 'consumer.mjs')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'miniExtensionsFormulaExample',
        write: false,
        logLevel: 'silent',
        metafile: true,
    });
    assert(
        !Object.keys(bundled.metafile.inputs).some((path) => {
            const normalized = path.replace(/\\/g, '/');
            return (
                /\/sdk\/dist\/(?:esm|cjs)\/(?:ui|forms|portals|auth|react)\//.test(
                    normalized
                ) ||
                /(?:^|\/)node_modules\/(?:react|react-dom)(?:\/|$)/.test(
                    normalized
                )
            );
        }),
        'Core consumer unexpectedly bundled optional UI/Form/Portal/Auth/React helpers'
    );
    const browserContext = { URL, TextEncoder, fetch };
    runInNewContext(bundled.outputFiles[0].text, browserContext, {
        timeout: 10000,
    });
    assert.equal(browserContext.miniExtensionsFormulaExample.result, 12);

    const portalBundle = await build({
        absWorkingDir: temporaryDirectory,
        entryPoints: ['portals-consumer.mjs'],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'miniExtensionsPortalExample',
        write: false,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(portalBundle.metafile, temporaryDirectory);
    const portalBrowserContext = { URL, TextEncoder, fetch };
    runInNewContext(portalBundle.outputFiles[0].text, portalBrowserContext, {
        timeout: 10000,
    });
    assert.equal(
        portalBrowserContext.miniExtensionsPortalExample.helperType,
        'function'
    );

    // React is an optional host framework, never an SDK dependency. Check the
    // actual documented recipe only after proving dependency-free UI imports.
    const reactRecipes = [...uiGuide.matchAll(/```tsx\n([\s\S]*?)\n```/g)];
    assert(reactRecipes.length > 0, 'Missing React mount/dispose recipe');
    run('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        'react@19.2.0',
        'react-dom@19.2.0',
        '@types/react@19.2.2',
        '@types/react-dom@19.2.2',
    ]);
    const reactSources = reactRecipes.map(([, code], index) => {
        const filename = `ui-react-${index}.tsx`;
        writeFileSync(join(temporaryDirectory, filename), code);
        return filename;
    });
    // These exact Portal doc blocks retain strict compilation, after the normal
    // optional React peers/types have been installed in this consumer.
    reactSources.push(...portalsReactGuideSources);
    writeFileSync(
        join(temporaryDirectory, 'field-bindings-react.tsx'),
        `
import { TextField, NumberField, CheckboxField, SelectField, LinkedField, AttachmentField, AttachmentDialog } from '@miniextensions/sdk/react';
import type { FormFieldBinding, FormAttachmentController } from '@miniextensions/sdk/forms';
export function Fields({binding, attachment}: {binding: FormFieldBinding; attachment: FormAttachmentController}) {
    return <AttachmentDialog onClose={() => {}}>
        <TextField binding={binding} render={({snapshot, binding}) => <input value={typeof snapshot.value === 'string' ? snapshot.value : ''} onChange={e => binding.setValue(e.currentTarget.value)} />} />
        <NumberField binding={binding} /><CheckboxField binding={binding} />
        <SelectField binding={binding} /><LinkedField binding={binding} />
        <AttachmentField binding={binding} controller={attachment} render={({attachment, controller}) => <button disabled={attachment.busy} onClick={() => void controller.upload()}>Upload</button>} />
    </AttachmentDialog>;
}
`
    );
    reactSources.push('field-bindings-react.tsx');
    writeFileSync(
        join(temporaryDirectory, 'multiple-select-react-consumer.tsx'),
        multipleSelectReactTypedConsumer
    );
    reactSources.push('multiple-select-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'linked-records-react-consumer.tsx'),
        linkedRecordsReactTypedConsumer
    );
    reactSources.push('linked-records-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'button-react-consumer.tsx'),
        buttonReactTypedConsumer
    );
    reactSources.push('button-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'renderer-react-consumer.tsx'),
        rendererReactTypedConsumer
    );
    reactSources.push('renderer-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'single-select-react-consumer.tsx'),
        reactSingleSelectTypedConsumer
    );
    reactSources.push('single-select-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'single-select-react-consumer.cts'),
        reactSingleSelectCommonJsTypedConsumer
    );
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'single-select-react-consumer.cts',
    ]);
    writeFileSync(
        join(temporaryDirectory, 'last-modified-time-react-consumer.tsx'),
        lastModifiedTimeReactTypedConsumer
    );
    reactSources.push('last-modified-time-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'created-time-react-consumer.tsx'),
        createdTimeReactTypedConsumer
    );
    reactSources.push('created-time-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'last-modified-by-react-consumer.tsx'),
        lastModifiedByReactTypedConsumer
    );
    reactSources.push('last-modified-by-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'created-by-react-consumer.tsx'),
        createdByReactTypedConsumer
    );
    reactSources.push('created-by-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'external-sync-source-react-consumer.tsx'),
        externalSyncSourceReactTypedConsumer
    );
    reactSources.push('external-sync-source-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'count-react-consumer.tsx'),
        countReactTypedConsumer
    );
    reactSources.push('count-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'formula-react-consumer.tsx'),
        formulaReactTypedConsumer
    );
    reactSources.push('formula-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'rollup-react-consumer.tsx'),
        rollupReactTypedConsumer
    );
    reactSources.push('rollup-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'lookup-react-consumer.tsx'),
        lookupReactTypedConsumer
    );
    reactSources.push('lookup-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'barcode-react-consumer.tsx'),
        barcodeReactTypedConsumer
    );
    reactSources.push('barcode-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'autonumber-react-consumer.tsx'),
        autoNumberReactTypedConsumer
    );
    reactSources.push('autonumber-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'rating-react-consumer.tsx'),
        ratingReactTypedConsumer
    );
    reactSources.push('rating-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'multiline-text-react-consumer.tsx'),
        multilineTextReactTypedConsumer
    );
    reactSources.push('multiline-text-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'percent-react-consumer.tsx'),
        percentReactTypedConsumer
    );
    reactSources.push('percent-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'phone-number-react-consumer.tsx'),
        phoneNumberReactTypedConsumer
    );
    reactSources.push('phone-number-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'url-react-consumer.tsx'),
        urlReactTypedConsumer
    );
    reactSources.push('url-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'email-react-consumer.tsx'),
        emailReactTypedConsumer
    );
    reactSources.push('email-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'duration-react-consumer.tsx'),
        durationReactTypedConsumer
    );
    reactSources.push('duration-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'date-renderer-react-consumer.tsx'),
        dateRendererReactTypedConsumer
    );
    reactSources.push('date-renderer-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'datetime-renderer-react-consumer.tsx'),
        dateTimeRendererReactTypedConsumer
    );
    reactSources.push('datetime-renderer-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'duration-renderer-react-consumer.tsx'),
        durationRendererReactTypedConsumer
    );
    reactSources.push('duration-renderer-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'currency-renderer-react-consumer.tsx'),
        currencyRendererReactTypedConsumer
    );
    reactSources.push('currency-renderer-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'form-composition-consumer.ts'),
        formCompositionTypedConsumer
    );
    reactSources.push('form-composition-consumer.ts');
    writeFileSync(
        join(temporaryDirectory, 'cross-page-choice-consumer.ts'),
        crossPageChoiceTypedConsumer
    );
    reactSources.push('cross-page-choice-consumer.ts');
    writeFileSync(
        join(temporaryDirectory, 'select-availability-bridge-consumer.ts'),
        selectAvailabilityBridgeTypedConsumer
    );
    reactSources.push('select-availability-bridge-consumer.ts');
    writeFileSync(
        join(temporaryDirectory, 'portal-composition-consumer.ts'),
        portalCompositionTypedConsumer
    );
    reactSources.push('portal-composition-consumer.ts');
    writeFileSync(
        join(temporaryDirectory, 'portal-button-composition-consumer.ts'),
        portalButtonCompositionReactTypedConsumer
    );
    reactSources.push('portal-button-composition-consumer.ts');
    const linkedChildRecipes = [
        ...formsGuide.matchAll(/```tsx\n([\s\S]*?)\n```/g),
    ].filter(([, code]) =>
        code.includes('export function createLinkedChildPanel(')
    );
    assert.equal(
        linkedChildRecipes.length,
        1,
        'Missing shipped linked-child panel'
    );
    writeFileSync(
        join(temporaryDirectory, 'linked-child-guide.tsx'),
        linkedChildRecipes[0][1]
    );
    reactSources.push('linked-child-guide.tsx');
    const compositionRecipes = [
        ...readFileSync(
            join(installedPackage, 'docs/field-bindings.md'),
            'utf8'
        ).matchAll(/```(ts|tsx)\n([\s\S]*?)\n```/g),
    ].filter(
        ([, , code]) =>
            code.includes('export function createFormPresentation(') ||
            code.includes('export function CustomForm(')
    );
    assert.equal(
        compositionRecipes.length,
        2,
        'Missing shipped Form composition recipes'
    );
    for (const [, language, code] of compositionRecipes) {
        const path = `form-composition-guide-${reactSources.length}.${language}`;
        writeFileSync(join(temporaryDirectory, path), code);
        reactSources.push(path);
    }
    const portalCompositionRecipes = [
        ...readFileSync(
            join(installedPackage, 'docs/field-bindings.md'),
            'utf8'
        ).matchAll(/```(ts|tsx)\n([\s\S]*?)\n```/g),
    ].filter(
        ([, , code]) =>
            code.includes('export function createPortalPresentation(') ||
            code.includes('export function CustomPortal(')
    );
    assert.equal(
        portalCompositionRecipes.length,
        2,
        'Missing shipped Portal composition recipes'
    );
    for (const [, language, code] of portalCompositionRecipes) {
        const path = `portal-composition-guide-${reactSources.length}.${language}`;
        writeFileSync(join(temporaryDirectory, path), code);
        reactSources.push(path);
    }
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--jsx',
        'react-jsx',
        ...reactSources,
    ]);

    assert.equal(
        await checkPortalEditorConsumer({
            consumerDirectory: temporaryDirectory,
            happyDomModulePath: require.resolve('happy-dom'),
        }),
        17
    );
    // Resolve CSS and React through the installed archive, not checkout aliases.
    for (const name of [
        'button',
        'checkbox',
        'multiple-select',
        'linked-records',
        'single-select',
        'text',
        'last-modified-time',
        'last-modified-by',
        'created-by',
        'created-time',
        'external-sync-source',
        'multiline-text',
        'phone-number',
        'url',
        'number',
        'autonumber',
        'rating',
        'percent',
        'count',
        'date',
        'datetime',
        'duration',
        'email',
        'currency',
    ]) {
        const stylesheet =
            name === 'last-modified-time'
                ? 'datetime'
                : ['autonumber', 'percent', 'rating', 'count'].includes(name)
                  ? 'number'
                  : [
                          'email',
                          'url',
                          'phone-number',
                          'multiline-text',
                          'last-modified-by',
                          'created-by',
                          'external-sync-source',
                      ].includes(name)
                    ? 'text'
                    : name === 'created-time'
                      ? 'datetime'
                      : name;
        if (name === 'autonumber') {
            const sources = [
                '.gitignore',
                'README.md',
                'build.mjs',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
            ].map((file) => `examples/react-autonumber/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing AutoNumber example source: ${path}`
                );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-autonumber/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'AutoNumber preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'AutoNumber example sources must remain unignored'
            );
        }
        if (name === 'currency') {
            const sourcePaths = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-currency/${file}`);
            for (const path of sourcePaths)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Currency example source: ${path}`
                );
            const generatedPaths = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-currency/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generatedPaths],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generatedPaths,
                'Currency preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sourcePaths],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Currency example sources must remain unignored'
            );
        }
        if (name === 'count') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-count/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Count example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'Count example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-count/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'Count preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Count example sources must remain unignored'
            );
        }
        if (name === 'single-select') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-single-select/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Single Select example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'Single Select example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-single-select/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'Single Select preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Single Select example sources must remain unignored'
            );
        }
        if (name === 'last-modified-time') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-last-modified-time/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Last Modified Time example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'Last Modified Time example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-last-modified-time/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'Last Modified Time preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Last Modified Time example sources must remain unignored'
            );
        }
        if (name === 'created-time') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-created-time/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Created Time example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'Created Time example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-created-time/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'Created Time preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Created Time example sources must remain unignored'
            );
        }
        if (name === 'last-modified-by') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-last-modified-by/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Last Modified By example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'Last Modified By example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-last-modified-by/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'Last Modified By preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Last Modified By example sources must remain unignored'
            );
        }
        if (name === 'created-by') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-created-by/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing Created By example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'Created By example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) => `examples/react-created-by/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'Created By preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'Created By example sources must remain unignored'
            );
        }
        if (name === 'external-sync-source') {
            const sources = [
                '.gitignore',
                'README.md',
                'dev.mjs',
                'index.html',
                'main.ts',
                'styles.css',
                'tsconfig.json',
            ].map((file) => `examples/react-external-sync-source/${file}`);
            for (const path of sources)
                assert(
                    existsSync(join(process.cwd(), path)),
                    `Missing External Sync Source example source: ${path}`
                );
            assert.deepEqual(
                run(
                    'git',
                    ['ls-files', '--error-unmatch', ...sources],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                sources,
                'External Sync Source example sources must remain tracked'
            );
            const generated = ['index.html', 'main.js', 'main.css'].map(
                (file) =>
                    `examples/react-external-sync-source/.generated/${file}`
            );
            assert.deepEqual(
                run(
                    'git',
                    ['check-ignore', '--no-index', ...generated],
                    process.cwd()
                )
                    .trim()
                    .split(/\r?\n/),
                generated,
                'External Sync Source preview outputs must remain ignored'
            );
            assert.throws(
                () =>
                    run(
                        'git',
                        ['check-ignore', '--no-index', ...sources],
                        process.cwd()
                    ),
                (error) =>
                    error.status === 1 &&
                    String(error.stdout ?? '').trim() === '',
                'External Sync Source example sources must remain unignored'
            );
        }
        const exampleDirectory = join(temporaryDirectory, `${name}-example`);
        mkdirSync(exampleDirectory);
        const exampleFiles = ['main.ts', 'styles.css'];
        if (name === 'email') exampleFiles.push('owners.ts');
        for (const file of exampleFiles) {
            cpSync(
                join(process.cwd(), `examples/react-${name}`, file),
                join(exampleDirectory, file)
            );
        }
        run(process.execPath, [
            require.resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            `${name}-example/main.ts`,
        ]);
        const exampleBundle = await build({
            absWorkingDir: temporaryDirectory,
            entryPoints: [`${name}-example/main.ts`],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            outdir: `${name}-example/dist`,
            write: false,
        });
        assert(
            exampleBundle.outputFiles.some(
                (file) =>
                    file.path.endsWith('.css') &&
                    file.text.includes(`.mx-sdk-${stylesheet}`)
            )
        );
        assert.equal(
            readFileSync(
                join(installedPackage, `dist/esm/react/${stylesheet}.css`),
                'utf8'
            ),
            readFileSync(
                join(installedPackage, `dist/cjs/react/${stylesheet}.css`),
                'utf8'
            )
        );
    }
    const buttonProof = await checkButtonConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(buttonProof.checks, 67);
    console.log(
        `Installed Button model, stock renderer, CSS and local example: ${buttonProof.checks} checkpoints passed; synthetic dispatch only.`
    );
    const checkboxProof = await checkCheckboxConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(checkboxProof.checks, 6);
    console.log(
        `Installed Checkbox renderer, binding, CSS and local example: ${checkboxProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const linkedRecordsRendererProof = await checkLinkedRecordsRendererConsumer(
        {
            consumerDirectory: temporaryDirectory,
            happyDomModulePath: require.resolve('happy-dom'),
        }
    );
    assert.equal(linkedRecordsRendererProof.checks, 6);
    console.log(
        `Installed bounded Linked Records renderer, Form/Grid/List declarations, CSS and example: ${linkedRecordsRendererProof.checks} ESM/CJS groups passed.`
    );
    const multipleSelectProof = await checkMultipleSelectConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(multipleSelectProof.checks, 4);
    console.log(
        `Installed Multiple Select component, Form/Grid/List declarations, CSS and example: ${multipleSelectProof.checks} ESM/CJS groups passed.`
    );
    const singleSelectProof = await checkReactSingleSelectConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(singleSelectProof.checks, 24);
    console.log(
        `Installed Single Select renderer, native choice drafts, explicit Add Choice/Save, accepted Portal surfaces, CSS and local example: ${singleSelectProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const lastModifiedTimeProof = await checkLastModifiedTimeConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(lastModifiedTimeProof.checks, 20);
    console.log(
        `Installed Last Modified Time renderer, validity-gated native timestamps, shared DateTime CSS and local example: ${lastModifiedTimeProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const createdTimeProof = await checkCreatedTimeConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(createdTimeProof.checks, 20);
    console.log(
        `Installed Created Time renderer, readonly native timestamp text, shared DateTime CSS and local example: ${createdTimeProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const lastModifiedByProof = await checkLastModifiedByConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(lastModifiedByProof.checks, 20);
    console.log(
        `Installed Last Modified By renderer, readonly native names, shared Text CSS and local example: ${lastModifiedByProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const createdByProof = await checkCreatedByConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(createdByProof.checks, 20);
    console.log(
        `Installed Created By renderer, readonly native names, shared Text CSS and local example: ${createdByProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const externalSyncSourceProof = await checkExternalSyncSourceConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(externalSyncSourceProof.checks, 20);
    console.log(
        `Installed External Sync Source renderer, readonly SDK strings, shared Text CSS and local example: ${externalSyncSourceProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const textProof = await checkTextConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(textProof.checks, 8);
    console.log(
        `Installed Text renderer, binding, CSS and local example: ${textProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const multilineTextProof = await checkMultilineTextConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(multilineTextProof.checks, 20);
    console.log(
        `Installed Multiline Text renderer, binding, shared Text CSS and local example: ${multilineTextProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const phoneNumberProof = await checkPhoneNumberConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(phoneNumberProof.checks, 12);
    console.log(
        `Installed Phone Number renderer, binding, shared Text CSS and local example: ${phoneNumberProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const urlProof = await checkUrlConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(urlProof.checks, 12);
    console.log(
        `Installed URL renderer, binding, shared Text CSS and local example: ${urlProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const emailProof = await checkEmailConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(emailProof.checks, 12);
    console.log(
        `Installed Email renderer, binding, shared Text CSS and local example: ${emailProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const numberProof = await checkNumberConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(numberProof.checks, 8);
    console.log(
        `Installed Number renderer, scalar binding, CSS and local example: ${numberProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const formulaProof = await checkFormulaConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(formulaProof.checks, 26);
    console.log(
        `Installed Formula presentation: ${formulaProof.checks} ESM/CJS scenarios passed; synthetic owners only.`
    );
    const rollupProof = await checkRollupConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(rollupProof.checks, 26);
    console.log(
        `Installed Rollup presentation: ${rollupProof.checks} ESM/CJS scenarios passed; synthetic owners only.`
    );
    const lookupProof = await checkLookupConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(lookupProof.checks, 44);
    console.log(
        `Installed Lookup presentation: ${lookupProof.checks} ESM/CJS scenarios passed; synthetic owners only.`
    );
    const barcodeProof = await checkBarcodeConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(barcodeProof.checks, 60);
    console.log(
        `Installed Barcode presentation: ${barcodeProof.checks} ESM/CJS scenarios passed; synthetic owners only.`
    );
    const countProof = await checkCountConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(countProof.checks, 20);
    console.log(
        `Installed Count renderer, readonly native display, shared Number CSS and local example: ${countProof.checks} ESM/CJS groups passed; synthetic owners only.`
    );
    const autoNumberProof = await checkAutoNumberConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(autoNumberProof.checks, 16);
    console.log(
        `Installed AutoNumber renderer, readonly owners, shared Number CSS and local example: ${autoNumberProof.checks} ESM/CJS groups passed; synthetic data only.`
    );
    const ratingProof = await checkRatingConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(ratingProof.checks, 18);
    console.log(
        `Installed Rating renderer, native scalar, shared Number CSS and local example: ${ratingProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const percentProof = await checkPercentConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(percentProof.checks, 16);
    console.log(
        `Installed Percent renderer, native scalar, shared Number CSS and local example: ${percentProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const dateRendererProof = await checkDateRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(dateRendererProof.checks, 16);
    console.log(
        `Installed Date renderer, binding, CSS and local example: ${dateRendererProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const dateTimeRendererProof = await checkDateTimeRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(dateTimeRendererProof.checks, 18);
    console.log(
        `Installed DateTime renderer, binding, CSS and local example: ${dateTimeRendererProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const durationRendererProof = await checkDurationRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(durationRendererProof.checks, 80);
    console.log(
        `Installed Duration renderer, binding, CSS and local example: ${durationRendererProof.checks} ESM/CJS groups across five formats passed; synthetic drafts only.`
    );
    const currencyRendererProof = await checkCurrencyRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(currencyRendererProof.checks, 20);
    console.log(
        `Installed Currency renderer, binding, CSS and local example: ${currencyRendererProof.checks} ESM/CJS groups passed; synthetic drafts only.`
    );
    const linkedRecordsProof = await checkLinkedRecordsConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(linkedRecordsProof.checks, 12);
    console.log(
        `Installed rich linked records: ${linkedRecordsProof.checks} ESM/CJS groups passed; synthetic transport only.`
    );
    const linkedChildProof = await checkLinkedChildConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(linkedChildProof, 64);
    console.log(
        `Installed configured linked-child create: ${linkedChildProof} ESM/CJS and React groups passed; synthetic Save dispatch only.`
    );
    const linkedChildEditProof = await checkLinkedChildEditConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(linkedChildEditProof, 34);
    console.log(
        `Installed configured linked-child edit: ${linkedChildEditProof} ESM/CJS and React groups passed; synthetic Save dispatch only.`
    );
    const editFreshnessProof = await checkLinkedChildEditFreshnessConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(
        editFreshnessProof,
        linkedChildEditFreshnessConsumerCheckCount
    );
    console.log(
        `Installed linked-child Edit freshness: ${editFreshnessProof} ESM/CJS and React groups passed; synthetic Save dispatch only.`
    );
    const selectedPolicyProof = await checkSelectedRecordPolicyConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(
        selectedPolicyProof.checks,
        selectedPolicyProof.fixtureCases * 2 +
            selectedPolicyProof.lifecycleGroups
    );
    assert.equal(selectedPolicyProof.aliasChecks, 14);
    console.log(
        `Installed selected-record policy: ${selectedPolicyProof.checks} ESM/CJS fixture and lifecycle groups plus ${selectedPolicyProof.aliasChecks} dependency-alias checks passed; synthetic transport only.`
    );
    const rendererProof = await checkRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(rendererProof.checks, 15);
    console.log(
        `Installed renderer hosts: all 33 slots and ${rendererProof.checks} owner/remount groups passed; synthetic transport only.`
    );
    const linkedRendererProof = await checkLinkedRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(linkedRendererProof.checks, 16);
    const portalPillProof = await checkPortalLinkedPillConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(portalPillProof.checks, 53);
    console.log(
        `Installed Portal linked pills: ${portalPillProof.checks} ESM/CJS and shipped React recipe groups passed; synthetic DOM/transport only.`
    );
    console.log(
        `Installed Form linked renderer bridge: ${linkedRendererProof.checks} ESM/CJS and shipped React recipe groups passed; synthetic transport only.`
    );
    assert.equal(
        await checkFormCompositionConsumer({
            consumerDirectory: temporaryDirectory,
        }),
        26
    );
    const conditionalValidationChecks =
        await checkConditionalPageValidationConsumer({
            consumerDirectory: temporaryDirectory,
        });
    assert.equal(conditionalValidationChecks, 126);
    console.log(
        `Installed configured conditional validation: ${conditionalValidationChecks} ESM/CJS, canonical and shipped React recipe checkpoints passed; synthetic dispatch only.`
    );
    const crossPageChoiceChecks = await checkCrossPageChoiceConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(crossPageChoiceChecks, 76);
    const selectAvailabilityBridgeChecks =
        await checkSelectAvailabilityBridgeConsumer({
            consumerDirectory: temporaryDirectory,
        });
    const selectOptionDriverChecks = await checkSelectOptionDriverConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(selectOptionDriverChecks, 384);
    console.log(
        `Installed select-driven option eligibility: ${selectOptionDriverChecks} ESM/CJS canonical and Form-owner checkpoints passed; synthetic transport only.`
    );
    const selectAvailabilityBridgeRecipeChecks =
        await checkSelectAvailabilityBridgeRecipe({
            consumerDirectory: temporaryDirectory,
            happyDomModulePath: require.resolve('happy-dom'),
        });
    console.log(
        `Installed select-availability bridge: ${selectAvailabilityBridgeChecks} ESM/CJS groups and ${selectAvailabilityBridgeRecipeChecks} shipped React/custom-renderer groups passed; synthetic DOM/transport only.`
    );
    const singleSelectFormDriverChecks =
        await checkSingleSelectFormDriverConsumer({
            consumerDirectory: temporaryDirectory,
        });
    assert.equal(singleSelectFormDriverChecks, 220);
    let singleSelectFormDriverRecipeChecks = 0;
    for (const flavor of ['esm', 'cjs']) {
        const result = await checkSingleSelectFormDriverRecipe({
            consumerDirectory: temporaryDirectory,
            flavor,
        });
        assert.equal(result.checks, 42);
        singleSelectFormDriverRecipeChecks += result.checks;
    }
    console.log(
        `Installed single-select Form drivers: ${singleSelectFormDriverChecks} ESM/CJS groups and ${singleSelectFormDriverRecipeChecks} actual shipped AirtableForm recipe groups passed; synthetic DOM/transport only.`
    );
    const multipleSelectFormDriverChecks =
        await checkMultipleSelectFormDriverConsumer({
            consumerDirectory: temporaryDirectory,
        });
    assert.equal(multipleSelectFormDriverChecks, 332);
    let multipleSelectFormDriverRecipeChecks = 0;
    for (const flavor of ['esm', 'cjs']) {
        const result = await checkMultipleSelectFormDriverRecipe({
            consumerDirectory: temporaryDirectory,
            flavor,
        });
        assert.equal(result.checks, 46);
        multipleSelectFormDriverRecipeChecks += result.checks;
    }
    console.log(
        `Installed multi-select Form drivers: ${multipleSelectFormDriverChecks} ESM/CJS groups and ${multipleSelectFormDriverRecipeChecks} actual shipped AirtableForm recipe groups passed; synthetic DOM/transport only.`
    );
    assert.equal(
        await checkPortalCompositionConsumer({
            consumerDirectory: temporaryDirectory,
            happyDomModulePath: require.resolve('happy-dom'),
        }),
        37
    );
    const portalButtonCompositionProof =
        await checkPortalButtonCompositionConsumer({
            consumerDirectory: temporaryDirectory,
            happyDomModulePath: require.resolve('happy-dom'),
        });
    assert.equal(portalButtonCompositionProof.checks, 66);
    const reactBindingProof = await checkReactBindingConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(reactBindingProof.checks, 1);
    const portalOwnerProof = await checkPortalOwnerConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(portalOwnerProof.checks, 19);
    console.log('Installed Portal owner checkpoints: 19');
    const portalViewAvailabilityChecks = checkPortalViewAvailabilityConsumer({
        consumerDirectory: temporaryDirectory,
        run,
    });
    assert.equal(portalViewAvailabilityChecks, 16);
    console.log(
        `Installed Portal view availability: ${portalViewAvailabilityChecks} ESM/CommonJS behavior groups passed; strict NodeNext/Bundler declarations checked.`
    );
    const portalReadFailureChecks = checkPortalReadFailureConsumer({
        consumerDirectory: temporaryDirectory,
        run,
    });
    assert.equal(portalReadFailureChecks, 16);
    console.log(
        `Installed Portal read failures: ${portalReadFailureChecks} ESM/CommonJS groups passed; strict NodeNext/Bundler declarations checked; synthetic transport only.`
    );
    const portalReadFailureRecipeChecks =
        await checkPortalReadFailureRecipeConsumer({
            consumerDirectory: temporaryDirectory,
            happyDomModulePath: require.resolve('happy-dom'),
        });
    assert.equal(portalReadFailureRecipeChecks, 3);
    console.log(
        `Installed Portal read failure host recipe: ${portalReadFailureRecipeChecks} actual PortalList/custom-render groups passed; synthetic DOM/transport only.`
    );

    const authGuide = readFileSync(
        join(installedPackage, 'docs/auth.md'),
        'utf8'
    );
    const authGuideSources = [
        ...authGuide.matchAll(/```(ts|tsx)\n([\s\S]*?)\n```/g),
    ].map(([, language, code], index) => {
        const filename = `auth-guide-${index}.${language}`;
        writeFileSync(join(temporaryDirectory, filename), code);
        return filename;
    });
    assert(authGuideSources.length > 0, 'Missing copyable auth recipes');
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--jsx',
        'react-jsx',
        ...authGuideSources,
    ]);
    const authRecipeChecks = await checkAuthRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: authGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(authRecipeChecks.checks, 19);
    assert.equal(
        await checkSessionRestoration({
            consumerDirectory: temporaryDirectory,
            authPage,
            happyDomModulePath: require.resolve('happy-dom'),
        }),
        39
    );
    const authBundled = await build({
        absWorkingDir: temporaryDirectory,
        entryPoints: [join(temporaryDirectory, 'auth-consumer.mjs')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'miniExtensionsAuthExample',
        write: false,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(authBundled.metafile, temporaryDirectory);
    const authBrowserContext = {
        URL,
        TextEncoder,
        fetch,
        AbortController,
        DOMException,
        structuredClone,
    };
    runInNewContext(authBundled.outputFiles[0].text, authBrowserContext, {
        timeout: 10000,
    });
    assert.equal(authBrowserContext.miniExtensionsAuthExample.disposed, true);

    for (const [example, directory] of [
        ['browser', browserDirectory],
        ['ui-selection', uiDirectory],
    ]) {
        mkdirSync(directory, { recursive: true });
        const exampleSource = resolve(
            example === 'browser'
                ? join(installedPackage, 'examples/browser')
                : `examples/${example}`
        );
        cpSync(exampleSource, directory, {
            recursive: true,
            // The shipped starter itself lives under the installed package's
            // node_modules. Exclude generated/dependency paths only within it.
            filter: (path) =>
                !/(?:^|[/\\])(?:node_modules|\.generated)(?:[/\\]|$)/.test(
                    relative(exampleSource, path)
                ),
        });
        if (example === 'browser') {
            await checkDateRangeConsumer({
                consumerDirectory: temporaryDirectory,
            });
            const collaboratorValidationProof =
                await checkCollaboratorValidationConsumer({
                    consumerDirectory: temporaryDirectory,
                    happyDomModulePath: require.resolve('happy-dom'),
                });
            assert.equal(collaboratorValidationProof.checks, 94);
            assert.equal(
                await checkFormPageConsumer({
                    consumerDirectory: temporaryDirectory,
                }),
                1092
            );
            assert.equal(
                await checkFormDispositionConsumer({
                    consumerDirectory: temporaryDirectory,
                }),
                19
            );
            const formSaveIdentityProof = await checkFormSaveIdentityConsumer({
                consumerDirectory: temporaryDirectory,
            });
            assert.equal(formSaveIdentityProof, 34);
            console.log(
                `Installed Form Save response identity: ${formSaveIdentityProof} ESM/CJS checkpoints passed; synthetic transport only.`
            );
            // A customer copies only the shipped starter and documentation,
            // then installs the supplied TGZ. No checkout source/dist is copied.
            const copiedDocs = packed.files
                .map(({ path }) => path)
                .filter(
                    (path) =>
                        path.startsWith('docs/') ||
                        [
                            'README.md',
                            'LICENSE',
                            'THIRD_PARTY_NOTICES.md',
                        ].includes(path)
                );
            for (const path of copiedDocs) {
                const destination = join(browserKitDirectory, path);
                mkdirSync(join(destination, '..'), { recursive: true });
                cpSync(join(installedPackage, path), destination, {
                    recursive: true,
                });
            }
            for (const path of browserStarterFiles) {
                assert.deepEqual(
                    readFileSync(join(browserKitDirectory, path)),
                    readFileSync(join(installedPackage, path)),
                    `Copied starter differs from shipped file: ${path}`
                );
            }
            await assertPackedDocLinks(browserKitDirectory, [
                ...copiedDocs,
                ...browserStarterFiles,
            ]);
        }
        const archivePath = join(temporaryDirectory, packed.filename);
        const archiveSpec = `file:${archivePath}`;
        const browserManifestPath = join(directory, 'package.json');
        const browserLockPath = join(directory, 'package-lock.json');
        const browserManifest = JSON.parse(
            readFileSync(browserManifestPath, 'utf8')
        );
        const browserLock = JSON.parse(readFileSync(browserLockPath, 'utf8'));
        for (const [name, spec] of Object.entries({
            ...browserManifest.dependencies,
            ...browserManifest.devDependencies,
        })) {
            assert(
                name === packageMetadata.name || /^\d+\.\d+\.\d+$/.test(spec),
                `Browser dependency must be pinned to the registry: ${name}`
            );
        }
        if (example === 'browser') {
            // Execute the customer command, including npm's replacement of the
            // stale same-version SDK file pin and integrity in the shipped lock.
            const registryPins = (lock) =>
                Object.fromEntries(
                    Object.entries(lock.packages)
                        .filter(([, entry]) =>
                            /^https?:/.test(entry.resolved ?? '')
                        )
                        .map(([path, entry]) => [
                            path,
                            {
                                version: entry.version,
                                resolved: entry.resolved,
                                integrity: entry.integrity,
                            },
                        ])
                );
            run(
                'npm',
                [
                    'install',
                    '--ignore-scripts',
                    '--no-audit',
                    '--no-fund',
                    archivePath,
                ],
                directory
            );
            assert.deepEqual(
                registryPins(JSON.parse(readFileSync(browserLockPath, 'utf8'))),
                registryPins(browserLock),
                'Customer install changed committed registry resolutions'
            );
        } else {
            // The unshipped UI sandbox keeps its existing frozen-lock route.
            browserManifest.dependencies[packageMetadata.name] = archiveSpec;
            browserLock.packages[''].dependencies[packageMetadata.name] =
                archiveSpec;
            browserLock.packages[`node_modules/${packageMetadata.name}`] = {
                version: packageMetadata.version,
                resolved: archiveSpec,
                integrity: packed.integrity,
                license: packageMetadata.license,
                dependencies: packageMetadata.dependencies,
                engines: packageMetadata.engines,
            };
            writeFileSync(browserManifestPath, JSON.stringify(browserManifest));
            writeFileSync(browserLockPath, JSON.stringify(browserLock));
            run(
                'npm',
                ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                directory
            );
        }
        await assertInstalledArchive(directory, archivePath, packed);
        const compiled = new Set(
            run('npm', ['run', 'typecheck', '--', '--listFiles'], directory)
                .split(/\r?\n/)
                .map((path) => resolve(path))
        );
        await assertBrowserInputs(
            {
                inputs: Object.fromEntries(
                    [...compiled]
                        .filter((path) => path.endsWith('.ts'))
                        .map((path) => [path, {}])
                ),
            },
            directory
        );
        function checkExampleSources(directory) {
            for (const entry of readdirSync(directory, {
                withFileTypes: true,
            })) {
                const path = join(directory, entry.name);
                if (entry.isDirectory()) checkExampleSources(path);
                else if (path.endsWith('.ts')) {
                    assert(
                        compiled.has(path),
                        `Example source not compiled: ${path}`
                    );
                }
            }
        }
        checkExampleSources(join(directory, 'src'));
        run('npm', ['run', 'build'], directory);
        await assertBrowserInputs(
            JSON.parse(
                readFileSync(
                    join(directory, '.generated/metafile.json'),
                    'utf8'
                )
            ),
            directory
        );
        for (const filename of ['main.js', 'index.html', 'styles.css']) {
            assert(
                readFileSync(join(directory, '.generated', filename)).length >
                    0,
                `Missing browser build output: ${filename}`
            );
        }
        if (example === 'browser') {
            await checkDurationBindingConsumer({
                consumerDirectory: temporaryDirectory,
                starterDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            assert.equal(
                await checkDateBindingConsumer({
                    consumerDirectory: temporaryDirectory,
                    starterDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                }),
                18
            );
            assert.equal(
                await checkScalarBindingConsumer({
                    consumerDirectory: temporaryDirectory,
                    starterDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                }),
                17
            );
            assert.equal(
                await checkExistingAttachmentConsumer({
                    consumerDirectory: temporaryDirectory,
                    happyDomModulePath: require.resolve('happy-dom'),
                }),
                16
            );
            assert.equal(
                await checkSelectChoiceConsumer({
                    consumerDirectory: temporaryDirectory,
                    happyDomModulePath: require.resolve('happy-dom'),
                }),
                33
            );
            await checkFieldBindingRecipe({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            const result = await checkBrowserPortalExample({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            browserPortalChecks = result.checks;
            browserPortalSortChecks = result.sortChecks;
            browserPortalFilterChecks = result.filterChecks;
            const selectResult = await checkBrowserSelectExample({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            browserSelectChecks = selectResult.checks;
            const linkedFilterResult = await checkBrowserLinkedFilterExample({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            browserLinkedFilterChecks = linkedFilterResult.checks;
            browserChildQueryChecks = (
                await checkBrowserChildQueryExample({
                    consumerDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                })
            ).checks;
            const visibilityResult = await checkBrowserVisibilityExample({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            browserVisibilityChecks = visibilityResult.checks;
            const emptyVisibilityResult =
                await checkBrowserEditHideEmptyExample({
                    consumerDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                });
            browserEditHideEmptyChecks = emptyVisibilityResult.checks;
            const addressResult = await checkBrowserAddressExample({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            browserAddressChecks = addressResult.checks;
            const addressCompositionResult =
                await checkBrowserAddressCompositionExample({
                    consumerDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                });
            browserAddressCompositionChecks = addressCompositionResult.checks;
            const sectionProjection = await checkSectionProjectionRecipe({
                consumerDirectory: temporaryDirectory,
                guideSources: formsGuideSources,
                browserDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            sectionProjectionChecks = sectionProjection.checks;
            const reviewRecipe = await checkFormReviewRecipe({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            formReviewRecipeChecks = reviewRecipe.checks;
            formPageReviewRecipeChecks = (
                await checkFormPageReviewRecipe({
                    consumerDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                })
            ).checks;
            linkedReviewRecipeChecks = (
                await checkLinkedReviewRecipe({ consumerDirectory: directory })
            ).checks;
            let tail;
            try {
                tail = await runPackedTailChecks({
                    consumerDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                });
            } catch (error) {
                if (error.cleanupSafe === false)
                    packageConsumerCleanupSafe = false;
                throw error;
            }
            const attachmentReview = tail.attachment;
            attachmentReviewChecks = attachmentReview.checks;
            browserAttachmentReviewChecks = attachmentReview.browserChecks;
            const reviewExample = tail.review;
            browserReviewChecks = reviewExample.checks;
            const combinedReview = await checkBrowserCombinedEmptyReviewExample(
                {
                    consumerDirectory: directory,
                    happyDomModulePath: require.resolve('happy-dom'),
                }
            );
            browserCombinedReviewChecks = combinedReview.checks;
        }
    }

    function checkPortableOutput(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                checkPortableOutput(path);
            } else if (
                entry.name.endsWith('.js') ||
                entry.name.endsWith('.ts')
            ) {
                assert.doesNotMatch(
                    readFileSync(path, 'utf8'),
                    /@type-system\/|['"]@\/|\/Users\//,
                    `Non-portable package reference: ${entry.name}`
                );
            }
        }
    }
    checkPortableOutput(
        join(temporaryDirectory, 'node_modules/@miniextensions/sdk/dist')
    );
    if (
        process.env.SDK_CHECKED_ARTIFACT_DIR ||
        process.env.SDK_BROWSER_PROOF_ARTIFACT_DIR
    ) {
        const [commit, tree] = run(
            'git',
            ['rev-parse', 'HEAD', 'HEAD^{tree}'],
            process.cwd()
        )
            .trim()
            .split('\n');
        const ci = {
            repository: process.env.GITHUB_REPOSITORY,
            event: process.env.GITHUB_EVENT_NAME,
            runId: process.env.GITHUB_RUN_ID,
            runAttempt: process.env.GITHUB_RUN_ATTEMPT,
            workflowSha: process.env.GITHUB_SHA,
            pullRequestHeadSha: process.env.SDK_PR_HEAD_SHA || undefined,
        };
        if (process.env.SDK_CHECKED_ARTIFACT_DIR) {
            retainCheckedPackage({
                archivePath: join(temporaryDirectory, packed.filename),
                packed,
                installedPackage,
                outputDirectory: process.env.SDK_CHECKED_ARTIFACT_DIR,
                source: { commit, tree },
                ci: {
                    repository: process.env.GITHUB_REPOSITORY,
                    event: process.env.GITHUB_EVENT_NAME,
                    runId: process.env.GITHUB_RUN_ID,
                    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
                    workflowSha: process.env.GITHUB_SHA,
                    pullRequestHeadSha:
                        process.env.SDK_PR_HEAD_SHA || undefined,
                },
                browserPortalChecks,
            });
        }
        if (process.env.SDK_BROWSER_PROOF_ARTIFACT_DIR) {
            const result = await buildPrivacyBrowserProof({
                browserConsumerDirectory: browserDirectory,
                authConsumerDirectory: temporaryDirectory,
                outputDirectory: process.env.SDK_BROWSER_PROOF_ARTIFACT_DIR,
                source: { commit, tree },
                ci,
                packageSha256: createHash('sha256')
                    .update(
                        readFileSync(join(temporaryDirectory, packed.filename))
                    )
                    .digest('hex'),
            });
            console.log(
                `Synthetic manual browser fixture generated (${result.manifestSha256}); browser execution pending`
            );
        }
    }
    const additionalRuntimeChecks = await checkAdditionalRuntimeOperations({
        consumerDirectory: temporaryDirectory,
    });
    const selectConditionsChecks = checkSelectConditions({
        consumerDirectory: temporaryDirectory,
        run,
    });
    console.log(
        `Installed select compiler: ${selectConditionsChecks} checks passed.`
    );
    const formConditionsChecks = checkFormConditions({
        consumerDirectory: temporaryDirectory,
        run,
        typescriptBin: require.resolve('typescript/bin/tsc'),
    });
    console.log(
        `${browserCombinedReviewChecks} actual packed browser combined empty-hiding/Review cases`
    );
    console.log(
        `${packageMetadata.name}: packed core/UI/Form/Portal/Auth ESM/CommonJS and optional React renderer consumers, declarations, installed React StrictMode/remount and synthetic picker-cancel group, doc links/recipes (7 UI, 4 Form, ${attachmentRecipe.checks} attachment, ${linkedFilterRecipe.checks} cascade, ${portalRecipe.checks} Portal and ${authRecipeChecks.checks} Auth cases), ${additionalRuntimeChecks.checks} additional runtime transport cases, ${browserPortalChecks} actual packed browser Portal cases, ${browserPortalSortChecks} actual installed Portal-sort recipe/starter cases, ${browserPortalFilterChecks} installed scalar-filter groups, ${browserSelectChecks} actual packed browser select cases, ${browserLinkedFilterChecks} actual packed browser linked-filter cases, ${browserChildQueryChecks} actual packed Portal-child query cases, ${selectAvailabilityRecipeChecks} actual installed configured-choice recipe cases, ${browserVisibilityChecks} actual packed browser field-visibility cases, ${formVisibilityRecipe.checks} installed one-page field-visibility recipe cases, ${editHideEmptyRecipe.checks} installed edit empty-hiding checkpoints, ${browserEditHideEmptyChecks} actual packed browser edit empty-hiding cases, ${addressAutocompleteRecipe.checks} actual installed address recipe checkpoints, ${browserAddressChecks} actual packed browser address checkpoints, ${addressCompositionRecipe.checks} actual installed address DOM-composition checkpoints and ${browserAddressCompositionChecks} actual packed browser address DOM-composition checkpoints (no OS IME proof), ${sectionProjectionChecks} canonical/installed section-projection checks, ${attachmentReviewChecks} installed attachment-review checkpoints and ${browserAttachmentReviewChecks} copied-starter attachment-review cases, ${linkedReviewRecipeChecks} installed linked-review checkpoints, ${formPageReviewRecipeChecks} installed multipage Review row/dialog cases, ${formReviewRecipeChecks} actual installed prepared-review recipe checkpoints, ${browserReviewChecks} actual packed browser prepared-review cases, ${scalarVisibilityRecipe.checks} actual installed scalar visibility recipe cases, ${formConditionsChecks.checks} installed scalar compiler/formula outcome cases with ${formConditionsChecks.typedConsumers} strict declaration consumers, and full browser/UI examples typecheck/build passed (${packed.integrity})`
    );
} finally {
    if (packageConsumerCleanupSafe) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
        rmSync(browserKitDirectory, { recursive: true, force: true });
        rmSync(uiDirectory, { recursive: true, force: true });
    } else {
        console.error(
            'Packed-tail process cleanup is unconfirmed; temporary package consumers were retained:',
            { temporaryDirectory, browserKitDirectory, uiDirectory }
        );
    }
}
