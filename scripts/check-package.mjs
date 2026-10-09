import {
    checkLinkedRecordsConsumer,
    linkedRecordsTypedConsumer,
} from './linked-records-consumer-checks.mjs';
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
import { checkPortalEditorConsumer } from './portal-editor-consumer-checks.mjs';
import { checkDateBindingConsumer } from './date-binding-consumer-checks.mjs';
import { checkFormDispositionConsumer } from './form-disposition-consumer-checks.mjs';
import { checkPortalOwnerConsumer } from './portal-owner-consumer-checks.mjs';
import { checkSelectChoiceConsumer } from './select-choice-consumer-checks.mjs';
import { checkExistingAttachmentConsumer } from './existing-attachment-consumer-checks.mjs';
import { checkScalarBindingConsumer } from './scalar-binding-consumer-checks.mjs';
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
import { checkFormReviewRecipe } from './form-review-recipe-checks.mjs';
import { checkAttachmentReviewRecipe } from './attachment-review-recipe-checks.mjs';
import { checkLinkedReviewRecipe } from './linked-review-recipe-checks.mjs';
import {
    checkBrowserReviewExample,
    checkBrowserCombinedEmptyReviewExample,
} from './browser-review-example-checks.mjs';
import { checkBrowserLinkedFilterExample } from './browser-linked-filter-example-checks.mjs';
import { createHash } from 'node:crypto';
import { buildPrivacyBrowserProof } from './build-privacy-browser-proof.mjs';
import { retainCheckedPackage } from './retain-checked-package.mjs';
import { assertPublicDistribution } from './distribution-checks.mjs';

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
                browserStarterFiles.includes(path) ||
                path.startsWith('dist/esm/') ||
                path.startsWith('dist/cjs/'),
            `Unexpected packed file: ${path}`
        );
    }
    for (const path of ['docs/browser-lifecycle.md', ...browserStarterFiles]) {
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
    const portalsGuideSources = [
        ...portalsGuide.matchAll(/```ts\n([\s\S]*?)\n```/g),
    ].map(([, code], index) => {
        const filename = code.includes(
            'export function createPortalScreenOwner('
        )
            ? 'portal-owner.ts'
            : `portals-guide-${index}.ts`;
        writeFileSync(join(temporaryDirectory, filename), code);
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
        ...portalsGuideSources,
    ]);
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

    const consumer = `
import { FormulaRunner, AirtableFieldType } from '@miniextensions/sdk/formulas';
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
`;
    const javascriptConsumer = consumer.replace(
        'interface NumericOptions { precision: number; }\nconst numericOptions: NumericOptions',
        'const numericOptions'
    );
    writeFileSync(join(temporaryDirectory, 'consumer.mjs'), javascriptConsumer);
    run(process.execPath, ['consumer.mjs']);

    writeFileSync(
        join(temporaryDirectory, 'consumer.cjs'),
        `const { FormulaRunner } = require('@miniextensions/sdk/formulas');
const { createMiniExtensionsClient } = require('@miniextensions/sdk');
if (Object.keys(createMiniExtensionsClient({ apiOrigin: 'https://api.example.com' }).getSession()).length !== 0) throw new Error('CommonJS runtime client failed');
if (new FormulaRunner('2 + 3 * 4').run() !== 14) throw new Error('CommonJS formula evaluation failed');
`
    );
    run(process.execPath, ['consumer.cjs']);

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
        `
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
        writeFileSync(join(temporaryDirectory, filename), declarationConsumer);
        const linkedRecordsFilename = `linked-records-${filename}`;
        writeFileSync(
            join(temporaryDirectory, linkedRecordsFilename),
            linkedRecordsTypedConsumer
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
        !Object.keys(bundled.metafile.inputs).some((path) =>
            /\/sdk\/dist\/esm\/(?:ui|forms|portals|auth)\//.test(path)
        ),
        'Core consumer unexpectedly bundled optional UI/Form/Portal/Auth helpers'
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
        join(temporaryDirectory, 'button-react-consumer.tsx'),
        buttonReactTypedConsumer
    );
    reactSources.push('button-react-consumer.tsx');
    writeFileSync(
        join(temporaryDirectory, 'renderer-react-consumer.tsx'),
        rendererReactTypedConsumer
    );
    reactSources.push('renderer-react-consumer.tsx');
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
    const buttonProof = await checkButtonConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(buttonProof.checks, 67);
    console.log(
        `Installed Button model and custom React renderers: ${buttonProof.checks} checkpoints passed; synthetic dispatch only.`
    );
    const linkedRecordsProof = await checkLinkedRecordsConsumer({
        consumerDirectory: temporaryDirectory,
    });
    assert.equal(linkedRecordsProof.checks, 12);
    console.log(
        `Installed rich linked records: ${linkedRecordsProof.checks} ESM/CJS groups passed; synthetic transport only.`
    );
    const rendererProof = await checkRendererConsumer({
        consumerDirectory: temporaryDirectory,
        happyDomModulePath: require.resolve('happy-dom'),
    });
    assert.equal(rendererProof.checks, 15);
    console.log(
        `Installed renderer hosts: all 33 slots and ${rendererProof.checks} owner/remount groups passed; synthetic transport only.`
    );
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
            assert.equal(
                await checkFormPageConsumer({
                    consumerDirectory: temporaryDirectory,
                }),
                354
            );
            assert.equal(
                await checkFormDispositionConsumer({
                    consumerDirectory: temporaryDirectory,
                }),
                19
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
            linkedReviewRecipeChecks = (
                await checkLinkedReviewRecipe({ consumerDirectory: directory })
            ).checks;
            const attachmentReview = await checkAttachmentReviewRecipe({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
            attachmentReviewChecks = attachmentReview.checks;
            browserAttachmentReviewChecks = attachmentReview.browserChecks;
            const reviewExample = await checkBrowserReviewExample({
                consumerDirectory: directory,
                happyDomModulePath: require.resolve('happy-dom'),
            });
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
        `${packageMetadata.name}: packed core/UI/Form/Portal/Auth ESM/CommonJS and optional React renderer consumers, declarations, installed React StrictMode/remount and synthetic picker-cancel group, doc links/recipes (7 UI, 4 Form, ${attachmentRecipe.checks} attachment, ${linkedFilterRecipe.checks} cascade, ${portalRecipe.checks} Portal and ${authRecipeChecks.checks} Auth cases), ${additionalRuntimeChecks.checks} additional runtime transport cases, ${browserPortalChecks} actual packed browser Portal cases, ${browserPortalSortChecks} actual installed Portal-sort recipe/starter cases, ${browserPortalFilterChecks} installed scalar-filter groups, ${browserSelectChecks} actual packed browser select cases, ${browserLinkedFilterChecks} actual packed browser linked-filter cases, ${browserChildQueryChecks} actual packed Portal-child query cases, ${selectAvailabilityRecipeChecks} actual installed configured-choice recipe cases, ${browserVisibilityChecks} actual packed browser field-visibility cases, ${formVisibilityRecipe.checks} installed one-page field-visibility recipe cases, ${editHideEmptyRecipe.checks} installed edit empty-hiding checkpoints, ${browserEditHideEmptyChecks} actual packed browser edit empty-hiding cases, ${addressAutocompleteRecipe.checks} actual installed address recipe checkpoints, ${browserAddressChecks} actual packed browser address checkpoints, ${addressCompositionRecipe.checks} actual installed address DOM-composition checkpoints and ${browserAddressCompositionChecks} actual packed browser address DOM-composition checkpoints (no OS IME proof), ${sectionProjectionChecks} canonical/installed section-projection checks, ${attachmentReviewChecks} installed attachment-review checkpoints and ${browserAttachmentReviewChecks} copied-starter attachment-review cases, ${linkedReviewRecipeChecks} installed linked-review checkpoints, ${formReviewRecipeChecks} actual installed prepared-review recipe checkpoints, ${browserReviewChecks} actual packed browser prepared-review cases, ${scalarVisibilityRecipe.checks} actual installed scalar visibility recipe cases, ${formConditionsChecks.checks} installed scalar compiler/formula outcome cases with ${formConditionsChecks.typedConsumers} strict declaration consumers, and full browser/UI examples typecheck/build passed (${packed.integrity})`
    );
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    rmSync(browserKitDirectory, { recursive: true, force: true });
    rmSync(uiDirectory, { recursive: true, force: true });
}
