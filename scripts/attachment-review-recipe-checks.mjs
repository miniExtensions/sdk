import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { addSelectReviewAnswers } from './form-review-recipe-checks.mjs';
import { addLinkedReviewAnswers } from './linked-review-recipe-checks.mjs';

export function addAttachmentReviewAnswers(page) {
    const stored = {
        id: 'att_stored',
        url: 'https://files.invalid/PRIVATE_STORED_URL',
        filename: 'PRIVATE_STORED_NAME',
        size: 500,
        thumbnails: {
            full: {
                url: 'https://files.invalid/PRIVATE_THUMB',
                width: 1,
                height: 1,
            },
        },
    };
    const added = {
        id: null,
        url: 'https://files.invalid/PRIVATE_NEW_URL',
        filename: '<b>Exact filename</b>',
        type: 'text/plain',
        size: 3,
    };
    for (const [id, config, values] of [
        [
            'fld_review_files',
            {
                hideAttachmentName: false,
                addOnlyMode: true,
                showExistingValuesForAddOnlyMode: false,
            },
            [stored, added, added],
        ],
        ['fld_review_private_files', { hideAttachmentName: true }, [stored]],
    ]) {
        page.payload.fieldIdsInForm.push(id);
        page.payload.fieldIdsToSchemas[id] = {
            fieldType: 'multipleAttachments',
            airtableField: {
                id,
                name: id,
                isComputed: false,
                config: {
                    type: 'multipleAttachments',
                    options: { isReversed: false },
                },
            },
            miniExtConfig: config,
        };
        page.payload.formRecord.data[id] = structuredClone(values);
    }
    page.payload.persistedAddOnlyAttachmentValuesByFieldId = {
        fld_review_files: [structuredClone(stored)],
    };
    return { stored, added };
}

export function assertAttachmentReviewMatrix(review, createFormSaveInput) {
    const page = createReviewFixture('review-answers').page();
    addAttachmentReviewAnswers(page);
    const before = structuredClone(page);
    const id = 'fld_review_files';
    const rows = (p = page, data = p.payload.formRecord.data) =>
        review(p, data).filter((row) => row.fieldId === id);
    assert.equal(
        rows()[0].value,
        '<b>Exact filename</b>\n<b>Exact filename</b>'
    );
    const generic = 'Attachment';
    let checks = 1;
    for (const empty of [null, undefined, '', ' \t ', []]) {
        const p = structuredClone(page);
        delete p.payload.persistedAddOnlyAttachmentValuesByFieldId;
        assert.deepEqual(
            rows(p, { ...p.payload.formRecord.data, [id]: empty }),
            []
        );
        checks++;
    }
    for (const flag of [undefined, true, false, null, 'false']) {
        const p = structuredClone(page);
        p.payload.fieldIdsToSchemas[id].miniExtConfig.hideAttachmentName = flag;
        assert.equal(
            rows(p)[0].value,
            Array(2)
                .fill(flag === false ? '<b>Exact filename</b>' : generic)
                .join('\n')
        );
        checks++;
    }
    for (const flag of [undefined, null, true, false]) {
        for (const filename of [undefined, '', ' \t ']) {
            const p = structuredClone(page);
            p.payload.fieldIdsToSchemas[id].miniExtConfig.hideAttachmentName =
                flag;
            for (const attachment of p.payload.formRecord.data[id]) {
                if (filename === undefined) delete attachment.filename;
                else attachment.filename = filename;
            }
            const native = structuredClone(p.payload.formRecord.data);
            assert.equal(
                rows(p)[0].value,
                Array(2)
                    .fill(
                        flag === false
                            ? 'Attachment — filename unavailable'
                            : 'Attachment'
                    )
                    .join('\n')
            );
            assert.deepEqual(p.payload.formRecord.data, native);
            checks++;
        }
    }
    for (const value of [
        {},
        'PRIVATE_BAD',
        [null],
        [1],
        new Array(1),
        [{ url: '' }],
        [{ url: 'private', filename: null }],
        [{ url: 'private', size: '1' }],
    ]) {
        assert.throws(
            () => rows(page, { ...page.payload.formRecord.data, [id]: value }),
            (error) =>
                error.message.startsWith('Review is unavailable') &&
                !error.message.includes('PRIVATE')
        );
        checks++;
    }
    for (const baseline of [
        undefined,
        null,
        [],
        { [id]: null },
        { [id]: undefined },
        { [id]: [null] },
    ]) {
        const p = structuredClone(page);
        p.payload.persistedAddOnlyAttachmentValuesByFieldId = baseline;
        assert.throws(() => rows(p), /Review is unavailable/);
        checks++;
    }
    const absent = structuredClone(page);
    absent.payload.persistedAddOnlyAttachmentValuesByFieldId = {};
    assert.equal(
        rows(absent)[0].value,
        'PRIVATE_STORED_NAME\n<b>Exact filename</b>\n<b>Exact filename</b>'
    );
    checks++;
    const hidden = structuredClone(page);
    hidden.payload.formRecord.data[id] = [
        hidden.payload.formRecord.data[id][0],
    ];
    assert.deepEqual(rows(hidden), []);
    checks++;
    for (const config of [
        {
            allowedFiles: 0,
            sizeLimit: 0.00001,
            allowedAttachmentTypes: ['images'],
        },
        { fieldMode: 'upload-url' },
        { fieldMode: 'hand-signature' },
        { readOnly: true },
    ]) {
        const p = structuredClone(page);
        Object.assign(p.payload.fieldIdsToSchemas[id].miniExtConfig, config);
        assert(
            rows(p).length === 1,
            'existing answers are not upload admission'
        );
        checks++;
    }
    const saved = createFormSaveInput({
        loaded: page,
        draft: { data: page.payload.formRecord.data, dirtyFieldIds: [id] },
        options: {
            context: { type: 'direct-url' },
            isComputeMode: false,
            captchaVal: null,
            searchQuery: {},
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    assert.deepEqual(saved.formRecord, page.payload.formRecord);
    assert.deepEqual(saved.formFieldIdsWithUnsavedChanges, [id]);
    assert.deepEqual(page, before);
    return checks + 1;
}

const malformedReturns = [
    null,
    undefined,
    [],
    {},
    { url: '' },
    { url: 'x', size: NaN },
    { url: 'x', size: -1 },
    { url: 'x', filename: null },
    { url: 'x', type: 1 },
    { url: 'x', id: {} },
];
const refusalNames = [
    'type',
    'size',
    'capacity',
    'over-capacity',
    'readonly',
    'computed',
    'mode',
    'signature',
    'missing-baseline',
    'bad-baseline',
    'malformed',
    'hidden',
    'blocked',
    'review',
    'request',
    'empty-missing',
    'empty-null',
    'empty-blank',
    'empty-array',
];
const responseNames = [
    'valid',
    'replacement',
    'cleared',
    'presentation-throw',
    'write-failed',
    'type',
    'size',
    'capacity',
    'readonly',
    'mode',
    'baseline',
    'config-aba',
    'draft',
    'handle',
    'draft-aba',
    'session',
    'session-aba',
    'session-error',
    'token',
    'token-aba',
    'token-error',
    'parent',
    'parent-aba',
    'parent-error',
    'owner',
    'owner-aba',
    'load',
    'successor-session',
    'successor-token',
    'successor-parent',
];
const uploadScenarios = [
    ...refusalNames.map((name) => `admission-${name}`),
    ...responseNames.map((name) => `response-${name}`),
    ...malformedReturns.map((_, index) => `return-${index}`),
];

function configureRefusal(name, page, probe, config) {
    if (name === 'type') config.allowedAttachmentTypes = ['images'];
    if (name === 'size') config.sizeLimit = 0.000001;
    if (name === 'capacity') config.allowedFiles = 3;
    if (name === 'over-capacity') config.allowedFiles = 1;
    if (name === 'readonly') config.readOnly = true;
    if (name === 'computed')
        page.payload.fieldIdsToSchemas.fld_review_files.airtableField.isComputed = true;
    if (name === 'mode') config.fieldMode = 'upload-url';
    if (name === 'signature') config.fieldMode = 'hand-signature';
    if (name === 'missing-baseline')
        delete page.payload.persistedAddOnlyAttachmentValuesByFieldId;
    if (name === 'bad-baseline')
        page.payload.persistedAddOnlyAttachmentValuesByFieldId.fld_review_files =
            null;
    if (name === 'malformed') probe.write('fld_review_files', [null]);
    if (name === 'hidden') {
        config.conditionalFields = structuredClone(
            page.payload.fieldIdsToSchemas.fld_review_conditional.miniExtConfig
                .conditionalFields
        );
        probe.write('fld_review_show', false);
    }
    if (name === 'blocked')
        config.conditionalFields = {
            id: 'invalid',
            conditions: [{ id: 'invalid' }],
        };
    if (name.startsWith('empty-')) {
        const values = {
            missing: undefined,
            null: null,
            blank: ' \t ',
            array: [],
        };
        probe.write('fld_review_files', values[name.slice(6)]);
        config.allowedAttachmentTypes = ['images'];
    }
}

function changeResponseScope(name, page, probe, config, observations, window) {
    const successor = name.startsWith('successor-');
    if (successor) name = name.slice('successor-'.length);
    if (['type', 'size', 'capacity', 'readonly', 'mode'].includes(name))
        configureRefusal(name, page, probe, config);
    if (name === 'baseline')
        page.payload.persistedAddOnlyAttachmentValuesByFieldId.fld_review_files =
            null;
    if (name === 'handle') probe.clearDraft();
    if (name === 'draft' || name === 'draft-aba') {
        const old = probe.snapshot().data.fld_review_title;
        probe.write('fld_review_title', 'Changed during upload');
        if (name === 'draft-aba') probe.write('fld_review_title', old);
    }
    if (name.startsWith('session')) {
        probe.session({ loginToken: 'synthetic-replacement' });
        observations.observeAttachmentConfigurationForTest();
        if (name === 'session-aba') probe.session({});
    }
    if (name.startsWith('token')) {
        const old = page.payload.extensionAccessToken;
        page.payload.extensionAccessToken = 'synthetic-replacement';
        observations.observeAttachmentConfigurationForTest();
        if (name === 'token-aba') page.payload.extensionAccessToken = old;
    }
    if (name.startsWith('parent')) {
        probe.context({
            type: 'modal',
            prefillData: {
                toLinkToParent: {
                    reversedFieldIdToPrefill: 'fld_parent',
                    parentFormRecordId: 'rec_replacement_parent',
                },
                prefillQueryForChildExtension: null,
            },
        });
        observations.observeAttachmentConfigurationForTest();
        if (name === 'parent-aba') probe.context({ type: 'direct-url' });
    }
    if (name === 'config-aba') {
        config.allowedFiles = 0;
        observations.observeAttachmentConfigurationForTest();
        delete config.allowedFiles;
    }
    if (name === 'owner' || name === 'owner-aba') {
        window.document.getElementById('visitor').value = 'B';
        window.document
            .getElementById('visitor')
            .dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    if (name === 'owner-aba') {
        window.document.getElementById('visitor').value = 'A';
        window.document
            .getElementById('visitor')
            .dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    if (name === 'load') probe.replaceLoad();
    if (successor) probe.replaceMount();
}

function assertUploadAdmissionMatrix(admit, append) {
    const page = createReviewFixture('review-answers').page();
    const { stored, added } = addAttachmentReviewAnswers(page);
    const id = 'fld_review_files';
    const value = structuredClone(page.payload.formRecord.data[id]);
    const descriptor = { type: 'text/plain', size: 3 };
    const before = structuredClone(page);
    let checks = 0;
    assert.deepEqual(admit(page, id, value, descriptor), value);
    checks++;
    const complete = append(page, id, value, descriptor, {
        url: 'https://files.invalid/new',
        filename: 'exact',
        type: 'text/plain',
        size: 3,
    });
    assert.deepEqual(complete.slice(0, 3), value);
    checks++;
    complete[0].thumbnails.full.url = 'mutated copy';
    assert.deepEqual(page, before);
    checks++;
    for (const empty of [undefined, null, '', ' \t ', []]) {
        assert.deepEqual(admit(page, id, empty, descriptor), []);
        checks++;
    }
    for (const file of [
        { type: 1, size: 3 },
        { type: 'x', size: -1 },
        { type: 'x', size: Infinity },
        { type: 'x', size: NaN },
        { type: 'x', size: '3' },
    ]) {
        assert.throws(
            () => admit(page, id, value, file),
            /current Form settings/
        );
        checks++;
    }
    for (const name of refusalNames.filter(
        (name) => !['review', 'request', 'hidden', 'blocked'].includes(name)
    )) {
        const p = structuredClone(page);
        let native = p.payload.formRecord.data[id];
        configureRefusal(
            name,
            p,
            {
                write: (_, v) => {
                    native = v;
                },
            },
            p.payload.fieldIdsToSchemas[id].miniExtConfig
        );
        assert.throws(
            () => admit(p, id, native, descriptor),
            /current Form settings/,
            name
        );
        checks++;
    }
    for (const returned of malformedReturns) {
        assert.throws(
            () => append(page, id, value, descriptor, returned),
            /current Form settings/
        );
        checks++;
    }
    for (const value of [false, 1, {}, 'PRIVATE_BAD', [null], new Array(1)]) {
        assert.throws(
            () => admit(page, id, value, descriptor),
            (error) =>
                error.message ===
                'The attachment cannot be added with the current Form settings.'
        );
        checks++;
    }
    for (const [config, file, allowed] of [
        [
            { allowedAttachmentTypes: ['images'] },
            { type: ' IMAGE/PNG ; charset=utf-8 ', size: 0 },
            true,
        ],
        [
            { allowedAttachmentTypes: ['documents'] },
            { type: 'application/pdf', size: 0 },
            true,
        ],
        [
            { allowedAttachmentTypes: ['compressedFiles'] },
            { type: 'application/zip', size: 0 },
            true,
        ],
        [{ allowedAttachmentTypes: [] }, descriptor, true],
        [{ sizeLimit: 1 }, { type: '', size: 1048576 }, true],
        [{ sizeLimit: 1 }, { type: '', size: 1048577 }, false],
        [{ sizeLimit: 0 }, descriptor, true],
        [{ sizeLimit: null }, descriptor, true],
        [{ sizeLimit: -1 }, descriptor, false],
        [{ sizeLimit: Infinity }, descriptor, false],
        [{ allowedFiles: 4.9 }, descriptor, true],
        [{ allowedFiles: 3.9 }, descriptor, false],
        [{ allowedFiles: null }, descriptor, true],
        [{ allowedFiles: 0 }, descriptor, false],
        [{ allowedFiles: Infinity }, descriptor, false],
    ]) {
        const p = structuredClone(page);
        Object.assign(p.payload.fieldIdsToSchemas[id].miniExtConfig, config);
        if (allowed) assert.deepEqual(admit(p, id, value, file), value);
        else
            assert.throws(
                () => admit(p, id, value, file),
                /current Form settings/
            );
        checks++;
    }
    assert.deepEqual(page, before);
    checks++;
    return checks;
}

const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Actual attachment starter did not reach expected state.');
};
const settled = async () => {
    for (let i = 0; i < 8; i++)
        await new Promise((resolve) => setImmediate(resolve));
};

/** Installed recipe and entire copied starter; synthetic requests only. */
export async function checkAttachmentReviewRecipe({
    consumerDirectory: consumer,
    happyDomModulePath,
}) {
    for (const name of [
        'main.ts',
        'review.ts',
        'pendingFiles.ts',
        'attachmentPresentation.ts',
        'attachmentUpload.ts',
    ])
        assert.deepEqual(
            readFileSync(join(consumer, 'src', name)),
            readFileSync(
                join(
                    consumer,
                    'node_modules/@miniextensions/sdk/examples/browser/src',
                    name
                )
            )
        );
    const entry = join(consumer, '.generated/attachment-review-entry.ts');
    writeFileSync(
        entry,
        "export { prepareFormReviewRows } from '../src/review.js';\nexport { createFormSaveInput } from '@miniextensions/sdk/forms';\nexport { formAttachmentControl } from '../src/attachmentPresentation.js';\nexport { admittedAttachmentValues, appendedAttachmentValues } from '../src/attachmentUpload.js';\n"
    );
    const outfile = join(consumer, '.generated/attachment-review-recipe.mjs');
    const recipe = await build({
        absWorkingDir: consumer,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        metafile: true,
        logLevel: 'silent',
    });
    await assertBrowserInputs(recipe.metafile, consumer);
    assert(
        Object.keys(recipe.metafile.inputs).some((path) =>
            path.endsWith('dist/esm/forms/attachments.js')
        )
    );
    const {
        prepareFormReviewRows,
        createFormSaveInput,
        formAttachmentControl,
        admittedAttachmentValues,
        appendedAttachmentValues,
    } = await import(pathToFileURL(outfile).href);
    let matrixChecks = assertAttachmentReviewMatrix(
        prepareFormReviewRows,
        createFormSaveInput
    );
    matrixChecks += assertUploadAdmissionMatrix(
        admittedAttachmentValues,
        appendedAttachmentValues
    );
    const main = join(consumer, '.generated/attachment-review-main.mjs');
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile: main,
        metafile: true,
        logLevel: 'silent',
        plugins: [
            {
                name: 'accepted-scope-observer',
                setup(build) {
                    build.onLoad({ filter: /\/src\/main\.ts$/ }, (args) => ({
                        loader: 'ts',
                        contents:
                            readFileSync(args.path, 'utf8').replace(
                                '    const readFilterMetadata = (context:',
                                '    attachmentUploadProbe = { snapshot: () => visitor.drafts.snapshot(draft), revision: () => visitor.drafts.revision(draft), write: (id: string, value: AirtableValue) => visitor.drafts.write(draft, id, value), attempts: () => (recovery as unknown as {attempts: RecoveryAttempt[]}).attempts, session: (value: RuntimeSession) => formClient!.setSession(value), context: (value: SaveFormInput["context"]) => {visitor.formContext = value;}, malformedReturn: (value: unknown) => {const upload = formClient!.attachments.uploadFile; formClient!.attachments.uploadFile = async (...args) => {await upload(...args); return value as never;};}, presentationThrow: () => {controls.get("fld_review_files")!.write = () => {throw new Error("Synthetic presentation failure");};}, rejectWrite: () => {visitor.drafts.write = () => false;}, replaceMount: () => {render(); setBusy(false); status("Accepted replacement UI.");}, clearDraft: () => {visitor.drafts.discard(draft);}, replaceLoad: () => {visitor.formLoadVersion++; render(); setBusy(false); status("Accepted replacement load.");}, activeRequest: () => {request = new AbortController();}, active: () => activeUpload };\n    attachmentObserveForTest = () => updateFormActivity();\n    attachmentRetainedForTest = () => recovery.unknown(scope.owner).map(a => a.retainedInput);\n    const readFilterMetadata = (context:'
                            ) +
                            '\nlet attachmentUploadProbe: unknown;\nexport const uploadProbeForTest = () => attachmentUploadProbe;\nlet attachmentObserveForTest: () => void;\nexport const observeAttachmentConfigurationForTest = () => attachmentObserveForTest();\nexport const attachmentPageForTest = () => visitors[activeVisitor].screen;\nlet attachmentRetainedForTest: () => unknown;\nexport const attachmentAttemptsForTest = () => attachmentRetainedForTest();\n',
                    }));
                },
            },
        ],
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    assert(
        Object.keys(bundle.metafile.inputs).some((path) =>
            path.endsWith('src/pendingFiles.ts')
        )
    );
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const scenarios = [
        ...uploadScenarios,
        'mixed',
        'pending-clear',
        'hidden-clear',
        'upload',
        'upload-replacement',
        'upload-cancel',
        'upload-error',
        'upload-stale',
        'pending-aba',
        'baseline-aba',
        'config-aba',
        'draft-aba',
        'owner-aba',
        'custom-title-clear',
        'dispose-observer',
        'chooser-cancel',
        'recovery-reload-error',
        'recovery-reload-cancel',
        ...[
            'missing',
            'null',
            'blank',
            'array',
            'bad-value',
            'bad-baseline',
            'missing-baseline',
            'all-hidden',
            'over-capacity',
            'non-upload-mode',
            'filename-default',
            'filename-true',
            'filename-blank',
        ].map((name) => `matrix-${name}`),
    ];
    for (const [index, scenario] of scenarios.entries()) {
        const fixture = createReviewFixture('review-answers');
        const page = fixture.page();
        addSelectReviewAnswers(page);
        addLinkedReviewAnswers(page);
        addAttachmentReviewAnswers(page);
        if (scenario === 'custom-title-clear' || scenario === 'hidden-clear') {
            page.payload.fieldIdsToSchemas.fld_review_files.airtableField.name =
                'PRIVATE_RAW_ATTACHMENT_TITLE';
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig.title =
                'Configured attachment title';
        }
        if (scenario === 'hidden-clear')
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig.conditionalFields =
                structuredClone(
                    page.payload.fieldIdsToSchemas.fld_review_conditional
                        .miniExtConfig.conditionalFields
                );
        const attachmentConfig =
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig;
        if (scenario === 'matrix-missing')
            delete page.payload.formRecord.data.fld_review_files;
        if (scenario === 'matrix-null')
            page.payload.formRecord.data.fld_review_files = null;
        if (scenario === 'matrix-blank')
            page.payload.formRecord.data.fld_review_files = ' \t ';
        if (scenario === 'matrix-array')
            page.payload.formRecord.data.fld_review_files = [];
        if (scenario === 'matrix-bad-value')
            page.payload.formRecord.data.fld_review_files = [null];
        if (scenario === 'matrix-bad-baseline')
            page.payload.persistedAddOnlyAttachmentValuesByFieldId.fld_review_files =
                null;
        if (scenario === 'matrix-missing-baseline')
            delete page.payload.persistedAddOnlyAttachmentValuesByFieldId;
        if (scenario === 'matrix-all-hidden')
            page.payload.formRecord.data.fld_review_files =
                page.payload.formRecord.data.fld_review_files.slice(0, 1);
        if (scenario === 'matrix-over-capacity')
            Object.assign(attachmentConfig, {
                allowedFiles: 0,
                sizeLimit: 0.00001,
                allowedAttachmentTypes: ['images'],
            });
        if (scenario === 'matrix-non-upload-mode')
            attachmentConfig.fieldMode = 'upload-url';
        if (scenario === 'matrix-filename-default')
            delete attachmentConfig.hideAttachmentName;
        if (scenario === 'matrix-filename-true')
            attachmentConfig.hideAttachmentName = true;
        if (scenario === 'matrix-filename-blank')
            for (const row of page.payload.formRecord.data.fld_review_files)
                row.filename = ' \t ';
        if (scenario.startsWith('recovery-')) {
            page.payload.fieldIdsToSchemas.fld_review_files.airtableField.name =
                'PRIVATE_RECOVERY_FIELD_TITLE';
            page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig.hideAttachmentName = true;
        }
        const initial = structuredClone(page.payload.formRecord.data);
        const window = new Window({
            url: 'https://attachment-review.invalid',
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        window.document.write(
            readFileSync(join(consumer, 'index.html'), 'utf8').replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/g,
                ''
            )
        );
        const calls = [];
        let releaseUpload;
        const uploadGate = new Promise((resolve) => {
            releaseUpload = resolve;
        });
        const globals = {
            document: window.document,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            fetch: async (input, init = {}) => {
                const url = new URL(String(input));
                const route =
                    url.searchParams.get('route') ??
                    (url.pathname ===
                    '/api/trpc/publicExtensions.createPublicUploadLink'
                        ? 'createPublicUploadLink'
                        : null);
                calls.push({
                    route: route ?? 'PUT',
                    method: init.method,
                    input:
                        init.body && typeof init.body === 'string'
                            ? JSON.parse(init.body)
                            : null,
                });
                if (route === 'fetchExtensionForEndUser')
                    return new Response(JSON.stringify(page));
                if (route === 'createPublicUploadLink')
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: {
                                    signedUrl:
                                        'https://attachment-put.invalid/PRIVATE',
                                    publicUrl:
                                        'https://files.invalid/PRIVATE_UPLOADED',
                                },
                            },
                        })
                    );
                if (url.origin === 'https://attachment-put.invalid') {
                    await uploadGate;
                    if (
                        scenario === 'upload-error' ||
                        scenario === 'recovery-reload-error' ||
                        [
                            'response-session-error',
                            'response-token-error',
                            'response-parent-error',
                        ].includes(scenario)
                    )
                        throw new Error('Synthetic upload failure');
                    return new Response('', { status: 200 });
                }
                if (route === 'saveForm')
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    );
                assert.fail(`Unexpected synthetic route ${route}`);
            },
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            const probe = await import(
                `${pathToFileURL(main).href}?attachment=${index}`
            );
            const document = window.document;
            const button = (label, within = document) => {
                const found = [...within.querySelectorAll('button')].filter(
                    (node) => node.textContent.trim() === label
                );
                assert.equal(found.length, 1, label);
                return found[0];
            };
            document.getElementById('api-origin').value =
                'https://synthetic-sdk.invalid';
            document.getElementById('share-id').value = 'attachment_synthetic';
            document.getElementById('connection-form').dispatchEvent(
                new window.Event('submit', {
                    bubbles: true,
                    cancelable: true,
                })
            );
            await waitFor(
                () =>
                    document.querySelector(
                        'input[data-pending-field-id="fld_review_files"]'
                    ) != null
            );
            const file = document.querySelector(
                'input[data-pending-field-id="fld_review_files"]'
            );
            const field = (id) =>
                document.querySelector(`[data-field-id="${id}"]`);
            const edit = (id, value) => {
                field(id).value = value;
                field(id).dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            };
            const setFile = (name = 'new-file.txt') => {
                const transfer = new window.DataTransfer();
                transfer.items.add(
                    new window.File(['abc'], name, { type: 'text/plain' })
                );
                file.files = transfer.files;
                file.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                return file.files[0];
            };
            const formNode = field('fld_review_title').closest('form');
            const submit = () =>
                formNode.dispatchEvent(
                    new window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
            const open = async () => {
                submit();
                await waitFor(
                    () => document.querySelector('dialog[open]') != null
                );
                return document.querySelector('dialog[open]');
            };
            const saves = () =>
                calls.filter((call) => call.route === 'saveForm');
            const clear = () => button('Clear pending files').click();
            const expected = structuredClone(initial);
            const scan = (root) => {
                for (const node of [root, ...root.querySelectorAll('*')]) {
                    assert(!node.textContent.includes('PRIVATE_STORED'));
                    assert(!node.textContent.includes('PRIVATE_NEW_URL'));
                    assert(!node.textContent.includes('PRIVATE_THUMB'));
                    if ('value' in node && node.type !== 'file')
                        assert(!String(node.value).includes('PRIVATE'));
                    for (const attr of node.attributes)
                        assert(!attr.value.includes('PRIVATE'), attr.name);
                }
            };
            scan(formNode);
            assert.equal(file.hidden, true);
            assert.equal(file.getAttribute('aria-hidden'), 'true');
            assert.equal(file.tabIndex, -1);
            assert.equal(file.parentElement.querySelector('textarea'), null);
            const presentation = file.parentElement.querySelectorAll('p')[1];
            if (
                scenario.startsWith('matrix-') &&
                [
                    'matrix-bad-value',
                    'matrix-bad-baseline',
                    'matrix-missing-baseline',
                ].includes(scenario)
            )
                assert.equal(
                    presentation.textContent,
                    'Attachment presentation unavailable'
                );
            else if (
                !scenario.startsWith('recovery-') &&
                !scenario.startsWith('matrix-')
            )
                assert.equal(
                    presentation.textContent,
                    '<b>Exact filename</b>\n<b>Exact filename</b>'
                );
            // Installed pure presenter: safe fallback, native snapshot and retirement.
            const standalone = formAttachmentControl(
                page,
                'fld_review_files',
                initial.fld_review_files
            );
            assert.deepEqual(
                standalone.read(),
                initial.fld_review_files ?? null
            );
            scan(standalone.node);
            standalone.destroy();
            const prior = standalone.node.textContent;
            standalone.write([
                { url: 'https://files.invalid/PRIVATE_NEW_URL' },
            ]);
            standalone.refresh();
            assert.equal(standalone.node.textContent, prior);
            if (uploadScenarios.includes(scenario)) {
                const uploadProbe = probe.uploadProbeForTest();
                const currentPage = probe.attachmentPageForTest();
                const config =
                    currentPage.payload.fieldIdsToSchemas.fld_review_files
                        .miniExtConfig;
                const uploadButton = [
                    ...file.parentElement.querySelectorAll('button'),
                ].find((node) => node.textContent === 'Upload selected file');
                assert(uploadButton);
                const fire = () =>
                    uploadButton.dispatchEvent(
                        new window.Event('click', { bubbles: true })
                    );
                const selected = setFile();
                const beforeState = uploadProbe.snapshot();
                const beforeAttempts = uploadProbe.attempts().length;
                if (scenario.startsWith('admission-')) {
                    configureRefusal(
                        scenario.slice('admission-'.length),
                        currentPage,
                        uploadProbe,
                        config
                    );
                    if (scenario === 'admission-review') {
                        clear();
                        await open();
                    }
                    if (scenario === 'admission-request')
                        uploadProbe.activeRequest();
                    const emptyBefore = uploadProbe.snapshot();
                    const before = calls.length;
                    fire();
                    await settled();
                    assert.equal(
                        calls.length,
                        before,
                        'Preflight must perform zero I/O.'
                    );
                    assert.equal(
                        uploadProbe.attempts().length,
                        beforeAttempts,
                        'Preflight must create no uncertain attempt.'
                    );
                    assert.deepEqual(uploadProbe.snapshot(), emptyBefore);
                    if (scenario !== 'admission-review')
                        assert.equal(file.files[0], selected);
                } else {
                    if (scenario.startsWith('return-'))
                        uploadProbe.malformedReturn(
                            malformedReturns[Number(scenario.slice(7))]
                        );
                    fire();
                    fire();
                    await waitFor(() =>
                        calls.some((call) => call.route === 'PUT')
                    );
                    assert.equal(uploadProbe.active().outcome, 'unknown');
                    if (scenario === 'response-replacement')
                        setFile('replacement.txt');
                    if (scenario === 'response-cleared') clear();
                    if (scenario === 'response-presentation-throw')
                        uploadProbe.presentationThrow();
                    if (scenario === 'response-write-failed')
                        uploadProbe.rejectWrite();
                    if (
                        scenario.startsWith('response-') &&
                        ![
                            'response-valid',
                            'response-replacement',
                            'response-cleared',
                            'response-presentation-throw',
                            'response-write-failed',
                        ].includes(scenario)
                    )
                        changeResponseScope(
                            scenario.slice('response-'.length),
                            currentPage,
                            uploadProbe,
                            config,
                            probe,
                            window
                        );
                    const beforeRelease = uploadProbe.snapshot();
                    const uiBefore = {
                        status: document.getElementById('status').textContent,
                        recovery: document.querySelector(
                            '[aria-label="Earlier request recovery"]'
                        )?.outerHTML,
                        busy: document
                            .getElementById('screen')
                            .getAttribute('aria-busy'),
                    };
                    releaseUpload();
                    await settled();
                    assert.equal(
                        calls.filter(
                            (call) => call.route === 'createPublicUploadLink'
                        ).length,
                        1
                    );
                    assert.equal(
                        calls.filter((call) => call.route === 'PUT').length,
                        1
                    );
                    assert.equal(saves().length, 0);
                    const accepted = [
                        'response-valid',
                        'response-replacement',
                        'response-cleared',
                        'response-presentation-throw',
                    ].includes(scenario);
                    const attempt = uploadProbe.attempts().at(-1);
                    assert.equal(
                        attempt.outcome,
                        accepted ? 'uploaded' : 'unknown'
                    );
                    assert.equal(attempt.flight, false);
                    if (accepted) {
                        const appended = {
                            ...beforeState.data,
                            fld_review_files: [
                                ...beforeState.data.fld_review_files,
                                {
                                    id: null,
                                    url: 'https://files.invalid/PRIVATE_UPLOADED',
                                    filename: selected.name,
                                    size: selected.size,
                                    type: selected.type,
                                },
                            ],
                        };
                        assert.deepEqual(uploadProbe.snapshot().data, appended);
                        assert.deepEqual(uploadProbe.snapshot().dirtyFieldIds, [
                            'fld_review_files',
                        ]);
                        if (scenario === 'response-replacement')
                            assert.equal(file.files[0].name, 'replacement.txt');
                        else assert.equal(file.files.length, 0);
                        if (scenario === 'response-presentation-throw')
                            assert(
                                document
                                    .getElementById('status')
                                    .textContent.includes('added to the draft')
                            );
                        if (scenario !== 'response-replacement') fire();
                        await settled();
                        assert.equal(
                            calls.filter((call) => call.route === 'PUT').length,
                            1,
                            'Committed append must not replay automatically.'
                        );
                        if (scenario !== 'response-presentation-throw') {
                            if (scenario === 'response-replacement') clear();
                            const dialog = await open();
                            scan(dialog);
                            button('Confirm', dialog).click();
                            await waitFor(() => saves().length === 1);
                            assert.deepEqual(saves()[0].input.formRecord, {
                                ...currentPage.payload.formRecord,
                                data: appended,
                            });
                            assert.deepEqual(
                                saves()[0].input.formFieldIdsWithUnsavedChanges,
                                ['fld_review_files']
                            );
                        }
                    } else {
                        assert.deepEqual(
                            uploadProbe.snapshot(),
                            beforeRelease,
                            'Unsafe response must not append.'
                        );
                        const beforeRetry = calls.length;
                        fire();
                        await settled();
                        assert.equal(
                            calls.length,
                            beforeRetry,
                            'Unknown outcomes must not replay.'
                        );
                        if (
                            [
                                'response-successor-session',
                                'response-successor-token',
                                'response-successor-parent',
                                'response-owner',
                                'response-owner-aba',
                                'response-load',
                            ].includes(scenario)
                        ) {
                            assert.equal(
                                document.getElementById('status').textContent,
                                uiBefore.status
                            );
                            assert.equal(
                                document.querySelector(
                                    '[aria-label="Earlier request recovery"]'
                                )?.outerHTML,
                                uiBefore.recovery
                            );
                            assert.equal(
                                document
                                    .getElementById('screen')
                                    .getAttribute('aria-busy'),
                                uiBefore.busy
                            );
                        } else {
                            assert.equal(
                                document
                                    .getElementById('screen')
                                    .getAttribute('aria-busy'),
                                'false'
                            );
                            assert.equal(
                                document.getElementById('screen').inert,
                                false
                            );
                            assert.equal(
                                document.getElementById('connection-form')
                                    .inert,
                                false
                            );
                            assert.equal(
                                document.getElementById('reload').disabled,
                                false
                            );
                            const recovery = document.querySelector(
                                '[aria-label="Earlier request recovery"]'
                            );
                            assert(
                                recovery.textContent.includes(
                                    'Earlier outcome not confirmed'
                                )
                            );
                            assert(
                                recovery.textContent.includes(
                                    'will not be uploaded again automatically'
                                )
                            );
                            assert.equal(recovery.closest('[inert]'), null);
                            assert(
                                document
                                    .getElementById('status')
                                    .textContent.includes('needs inspection')
                            );
                        }
                    }
                }
                console.log(`Packed attachment upload: ${scenario} passed`);
                continue;
            }
            if (scenario === 'mixed') {
                for (const patch of [
                    { hideAttachmentName: undefined },
                    { hideAttachmentName: null },
                    { hideAttachmentName: 'false' },
                    { hideAttachmentName: true },
                    { hideAttachmentName: false },
                    { readOnly: true },
                    { fieldMode: 'hand-signature' },
                ]) {
                    const detached = structuredClone(page);
                    Object.assign(
                        detached.payload.fieldIdsToSchemas.fld_review_files
                            .miniExtConfig,
                        patch
                    );
                    const native =
                        detached.payload.formRecord.data.fld_review_files;
                    const presenter = formAttachmentControl(
                        detached,
                        'fld_review_files',
                        native
                    );
                    assert.deepEqual(presenter.read(), native);
                    assert(
                        !presenter.node.outerHTML.includes('PRIVATE_NEW_URL')
                    );
                    assert(!presenter.node.outerHTML.includes('PRIVATE_THUMB'));
                    if (
                        patch.hideAttachmentName !== false &&
                        !patch.readOnly &&
                        !patch.fieldMode
                    )
                        assert(
                            !presenter.node.textContent.includes(
                                'Exact filename'
                            )
                        );
                    presenter.destroy();
                }
            }
            if (scenario.startsWith('matrix-')) {
                const beforeRequests = calls.length;
                if (
                    [
                        'matrix-bad-value',
                        'matrix-bad-baseline',
                        'matrix-missing-baseline',
                    ].includes(scenario)
                ) {
                    submit();
                    await settled();
                    assert.equal(document.querySelector('dialog'), null);
                    assert(
                        document
                            .getElementById('status')
                            .textContent.startsWith('Review is unavailable')
                    );
                    assert(
                        !document
                            .getElementById('status')
                            .textContent.includes('PRIVATE')
                    );
                    assert.equal(calls.length, beforeRequests);
                    assert.equal(saves().length, 0);
                } else {
                    const dialog = await open();
                    const label = dialog.querySelector(
                        '[data-review-field-id="fld_review_files"]'
                    );
                    if (
                        [
                            'matrix-missing',
                            'matrix-null',
                            'matrix-blank',
                            'matrix-array',
                            'matrix-all-hidden',
                        ].includes(scenario)
                    )
                        assert.equal(label, null);
                    else
                        assert.equal(
                            label.nextElementSibling.textContent,
                            Array(2)
                                .fill(
                                    [
                                        'matrix-filename-default',
                                        'matrix-filename-true',
                                        'matrix-filename-blank',
                                    ].includes(scenario)
                                        ? scenario === 'matrix-filename-blank'
                                            ? 'Attachment — filename unavailable'
                                            : 'Attachment'
                                        : '<b>Exact filename</b>'
                                )
                                .join('\n')
                        );
                    assert.equal(calls.length, beforeRequests);
                    button('Confirm', dialog).click();
                    await waitFor(() => saves().length === 1);
                    assert.deepEqual(saves()[0].input.formRecord, {
                        ...page.payload.formRecord,
                        data: expected,
                    });
                    assert.deepEqual(
                        saves()[0].input.formFieldIdsWithUnsavedChanges,
                        []
                    );
                }
            } else if (scenario === 'chooser-cancel') {
                let clicks = 0;
                file.addEventListener('click', () => clicks++);
                const choose = [
                    ...file.parentElement.querySelectorAll('button'),
                ].find((n) => n.textContent === 'Choose a file');
                assert(choose);
                choose.click();
                assert.equal(clicks, 1);
                assert.equal(file.files.length, 0);
                assert.equal(
                    file.parentElement.querySelector('[role=status]')
                        .textContent,
                    'No file selected.'
                );
                const selected = setFile('PRIVATE_PENDING_NAME');
                choose.click(); // no selection event means the prior File survives.
                assert.equal(file.files[0], selected);
                assert(
                    !file.parentElement.textContent.includes(
                        'PRIVATE_PENDING_NAME'
                    )
                );
                assert.equal(calls.length, 1);
                clear();
                button('Edit', await open()).click();
                assert.equal(saves().length, 0);
            } else if (scenario === 'mixed') {
                edit('fld_review_title', 'Edited secret');
                expected.fld_review_title = 'Edited secret';
                const dialog = await open();
                assert.equal(
                    dialog.querySelector(
                        '[data-review-field-id="fld_review_files"]'
                    ).nextElementSibling.textContent,
                    '<b>Exact filename</b>\n<b>Exact filename</b>'
                );
                assert.equal(
                    dialog.querySelector(
                        '[data-review-field-id="fld_review_private_files"]'
                    ).nextElementSibling.textContent,
                    'Attachment'
                );
                assert(!dialog.textContent.includes('PRIVATE'));
                for (const node of [dialog, ...dialog.querySelectorAll('*')])
                    for (const attribute of node.attributes)
                        assert(!attribute.value.includes('PRIVATE'));
                assert.equal(
                    dialog.querySelectorAll('a,img,video,audio').length,
                    0
                );
                assert.equal(calls.length, 1, 'Review makes no requests');
                button('Edit', dialog).click();
                await settled();
                assert.equal(saves().length, 0);
                const escaped = await open();
                escaped.dispatchEvent(
                    new window.Event('cancel', { cancelable: true })
                );
                await settled();
                assert.equal(saves().length, 0);
                button('Confirm', await open()).click();
                await waitFor(
                    () =>
                        saves().length === 1 &&
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assert.deepEqual(saves()[0].input.formRecord, {
                    ...page.payload.formRecord,
                    data: expected,
                });
                assert.deepEqual(
                    saves()[0].input.formFieldIdsWithUnsavedChanges,
                    ['fld_review_title']
                );
            } else if (
                [
                    'pending-clear',
                    'hidden-clear',
                    'custom-title-clear',
                ].includes(scenario)
            ) {
                const clearControl = button('Clear pending files');
                assert.equal(
                    clearControl.hidden,
                    true,
                    'no selection means no clear action'
                );
                setFile();
                assert.equal(clearControl.hidden, false);
                const panel = clearControl.closest(
                    '[aria-label="Pending attachment selections"]'
                );
                assert(
                    !panel.textContent.includes('PRIVATE_RAW_ATTACHMENT_TITLE')
                );
                assert(
                    !panel.textContent.includes('Configured attachment title')
                );
                for (const node of [panel, ...panel.querySelectorAll('*')])
                    for (const attribute of node.attributes) {
                        assert(
                            !attribute.value.includes(
                                'PRIVATE_RAW_ATTACHMENT_TITLE'
                            )
                        );
                        assert(
                            !attribute.value.includes(
                                'Configured attachment title'
                            )
                        );
                    }
                if (scenario === 'custom-title-clear')
                    assert.equal(
                        file.parentElement.querySelector('p').textContent,
                        'Configured attachment title'
                    );
                if (scenario === 'hidden-clear') {
                    const toggle = field('fld_review_show');
                    toggle.checked = false;
                    toggle.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    assert.equal(file.parentElement.hidden, true);
                }
                submit();
                await settled();
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(calls.length, 1);
                assert(
                    document
                        .getElementById('status')
                        .textContent.includes('Upload or clear')
                );
                assert.equal(
                    button('Clear pending files').closest('[hidden]'),
                    null
                );
                clear();
                assert.equal(clearControl.hidden, true);
                assert.equal(file.files.length, 0);
                button('Edit', await open()).click();
                assert.equal(saves().length, 0);
            } else if (scenario === 'dispose-observer') {
                const accepted = probe.attachmentPageForTest();
                const oldInput = file;
                setFile();
                const oldClear = button('Clear pending files');
                const oldChoose = [
                    ...oldInput.parentElement.querySelectorAll('button'),
                ].find((n) => n.textContent === 'Choose a file');
                let chooserClicks = 0;
                oldInput.addEventListener('click', () => chooserClicks++);
                button('Disconnect').click();
                await settled();
                for (const key of [
                    'extensionAccessToken',
                    'persistedAddOnlyAttachmentValuesByFieldId',
                ])
                    Object.defineProperty(accepted.payload, key, {
                        configurable: true,
                        get() {
                            assert.fail(
                                'disposed attachment configuration was read'
                            );
                        },
                    });
                probe.observeAttachmentConfigurationForTest();
                oldInput.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
                oldChoose.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                assert.equal(chooserClicks, 0);
                oldClear.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                assert.equal(oldInput.files.length, 1);
                assert.equal(calls.length, 1);
                assert.equal(saves().length, 0);
            } else if (
                scenario.startsWith('upload') ||
                scenario.startsWith('recovery-')
            ) {
                const first = setFile(
                    scenario.startsWith('recovery-')
                        ? 'PRIVATE_PENDING_NAME'
                        : 'new-file.txt'
                );
                const upload = [
                    ...file.parentElement.querySelectorAll('button'),
                ].find((node) => node.textContent === 'Upload selected file');
                assert(upload);
                upload.click();
                upload.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                await waitFor(() => calls.some((call) => call.route === 'PUT'));
                submit();
                await settled();
                assert.equal(document.querySelector('dialog'), null);
                if (scenario === 'upload-replacement')
                    setFile('replacement.txt');
                if (
                    scenario === 'upload-cancel' ||
                    scenario === 'recovery-reload-cancel'
                )
                    document.getElementById('cancel').click();
                if (scenario === 'upload-stale') {
                    document.getElementById('visitor').value = 'B';
                    document
                        .getElementById('visitor')
                        .dispatchEvent(
                            new window.Event('change', { bubbles: true })
                        );
                }
                releaseUpload();
                await waitFor(
                    () =>
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false'
                );
                assert.equal(
                    calls.filter(
                        (call) => call.route === 'createPublicUploadLink'
                    ).length,
                    1
                );
                assert.equal(
                    calls.filter((call) => call.route === 'PUT').length,
                    1
                );
                assert.equal(saves().length, 0);
                if (scenario === 'upload') {
                    assert.equal(file.files.length, 0);
                    const dialog = await open();
                    assert(dialog.textContent.includes('new-file.txt'));
                    button('Confirm', dialog).click();
                    await waitFor(() => saves().length === 1);
                    expected.fld_review_files.push({
                        id: null,
                        url: 'https://files.invalid/PRIVATE_UPLOADED',
                        filename: first.name,
                        size: first.size,
                        type: first.type,
                    });
                    assert.deepEqual(
                        saves()[0].input.formRecord.data,
                        expected
                    );
                    assert.deepEqual(
                        saves()[0].input.formFieldIdsWithUnsavedChanges,
                        ['fld_review_files']
                    );
                } else if (scenario === 'upload-replacement') {
                    assert.equal(file.files[0].name, 'replacement.txt');
                    submit();
                    await settled();
                    assert.equal(document.querySelector('dialog'), null);
                    clear();
                    const review = await open();
                    assert(review.textContent.includes('new-file.txt'));
                    assert(!review.textContent.includes('replacement.txt'));
                    button('Edit', review).click();
                } else {
                    assert.equal(file.files[0], first);
                    const before = calls.length;
                    file.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    submit();
                    await settled();
                    assert.equal(calls.length, before);
                    assert.equal(saves().length, 0);
                    if (scenario.startsWith('recovery-')) {
                        const journal = document.querySelector(
                            '[aria-label="Earlier request recovery"]'
                        );
                        assert(journal);
                        const retained = JSON.stringify(
                            probe.attachmentAttemptsForTest()
                        );
                        assert(!retained.includes('PRIVATE'));
                        assert(!retained.includes('fld_review_files'));
                        assert(
                            retained.includes(
                                'Attachment details are not retained.'
                            )
                        );
                        assert(!journal.textContent.includes('PRIVATE'));
                        assert(
                            !journal.textContent.includes('fld_review_files')
                        );
                        assert(
                            journal.textContent.includes(
                                'Attachment details are not retained.'
                            )
                        );
                        page.payload.fieldIdsToSchemas.fld_review_files.miniExtConfig.hideAttachmentName = true;
                        document.getElementById('reload').click();
                        await waitFor(
                            () =>
                                calls.filter(
                                    (c) =>
                                        c.route === 'fetchExtensionForEndUser'
                                ).length === 2
                        );
                        await settled();
                        const panel = document.querySelector(
                            '[aria-label="Earlier request recovery"]'
                        );
                        assert(!panel.textContent.includes('PRIVATE'));
                        assert(!panel.textContent.includes('fld_review_files'));
                        assert(
                            panel.textContent.includes(
                                'Attachment details are not retained.'
                            )
                        );
                        assert.equal(
                            calls.filter((c) => c.route === 'PUT').length,
                            1
                        );
                        assert.equal(saves().length, 0);
                    }
                }
            } else {
                const dialog = await open();
                const held = button('Confirm', dialog);
                if (scenario === 'pending-aba') {
                    setFile();
                    clear();
                }
                if (scenario === 'draft-aba') {
                    edit('fld_review_title', 'Temporary');
                    edit('fld_review_title', initial.fld_review_title);
                }
                if (scenario === 'baseline-aba' || scenario === 'config-aba') {
                    const accepted = probe.attachmentPageForTest();
                    const object =
                        scenario === 'baseline-aba'
                            ? accepted.payload
                            : accepted.payload.fieldIdsToSchemas
                                  .fld_review_files.miniExtConfig;
                    const key =
                        scenario === 'baseline-aba'
                            ? 'persistedAddOnlyAttachmentValuesByFieldId'
                            : 'hideAttachmentName';
                    const old = object[key];
                    object[key] = scenario === 'baseline-aba' ? {} : true;
                    probe.observeAttachmentConfigurationForTest();
                    if (scenario === 'config-aba')
                        assert(
                            !file.parentElement.textContent.includes(
                                'Exact filename'
                            )
                        );
                    object[key] = old;
                    probe.observeAttachmentConfigurationForTest();
                }
                if (scenario === 'owner-aba') {
                    const visitor = document.getElementById('visitor');
                    visitor.value = 'B';
                    visitor.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    visitor.value = 'A';
                    visitor.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                }
                held.dispatchEvent(
                    new window.Event('click', { bubbles: true })
                );
                await settled();
                assert.equal(saves().length, 0);
                if (scenario !== 'owner-aba') {
                    button('Confirm', await open()).click();
                    await waitFor(() => saves().length === 1);
                    assert.deepEqual(
                        saves()[0].input.formRecord.data,
                        expected
                    );
                }
            }
            await settled();
            console.log(`Packed attachment Review: ${scenario} passed`);
        } finally {
            releaseUpload();
            await settled();
            for (const [key, descriptor] of previous)
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            await window.happyDOM.close();
        }
    }
    if (process.env.SDK_ATTACHMENT_NATIVE_PLAYWRIGHT) {
        const { checkNativeAttachmentPresentation } = await import(
            './browser-attachment-presentation-native.mjs'
        );
        await checkNativeAttachmentPresentation({ consumer, bundle: main });
    }
    return { checks: matrixChecks, browserChecks: scenarios.length };
}
