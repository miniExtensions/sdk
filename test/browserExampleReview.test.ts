import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type FormLoadedResult,
    type LoadExtensionInput,
    type PortalLoadedResult,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { invalidForm, loadedForm } from './formsFixtures.js';
import { portalField, portalListPage, portalPage } from './portalFixtures.js';

const root = resolve(process.cwd());
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-review-'));
    await build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
});

after(async () => rm(directory, { recursive: true, force: true }));

const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let turn = 0; turn < 30; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('The actual starter did not reach the expected review state.');
};
const settled = async (): Promise<void> => {
    for (let turn = 0; turn < 4; turn++)
        await new Promise<void>((resolve) => setImmediate(resolve));
};

type ReviewScalarConfig = Extract<
    RuntimeFieldSchema['airtableField']['config'],
    {
        type:
            | 'singleLineText'
            | 'multilineText'
            | 'email'
            | 'url'
            | 'phoneNumber'
            | 'number'
            | 'currency'
            | 'percent'
            | 'rating'
            | 'checkbox'
            | 'barcode';
    }
>;

// Published Form schemas correlate their discriminator with each physical
// config. Construct concrete test arms; the wider metadata union is not a
// valid shortcut through this boundary (and also includes manualSort).
const scalarReviewSchema = (
    id: string,
    name: string,
    config: ReviewScalarConfig
): RuntimeFieldSchema => {
    const metadata = {
        id,
        name,
        description: null,
        isPrimaryField: false,
        isComputed: false,
    };
    switch (config.type) {
        case 'singleLineText':
            return {
                fieldType: 'singleLineText',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'multilineText':
            return {
                fieldType: 'multilineText',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'email':
            return {
                fieldType: 'email',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'url':
            return {
                fieldType: 'url',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'phoneNumber':
            return {
                fieldType: 'phoneNumber',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'number':
            return {
                fieldType: 'number',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'currency':
            return {
                fieldType: 'currency',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'percent':
            return {
                fieldType: 'percent',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'rating':
            return {
                fieldType: 'rating',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'checkbox':
            return {
                fieldType: 'checkbox',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
        case 'barcode':
            return {
                fieldType: 'barcode',
                airtableField: { ...metadata, config },
                miniExtConfig: { readOnly: true },
            };
    }
};

const reviewForm = (): FormLoadedResult => {
    const form = loadedForm();
    const title = form.payload.fieldIdsToSchemas.fld_title;
    const readonly = form.payload.fieldIdsToSchemas.fld_readonly;
    assert.ok(title && readonly);
    form.payload.fieldIdsToSchemas = {
        fld_title: title,
        fld_readonly: readonly,
    };
    form.payload.fieldIdsInForm = ['fld_title', 'fld_readonly'];
    form.payload.publicFields.state = {
        ...form.payload.publicFields.state,
        promptUserBeforeSubmission: true,
    };
    form.payload.formRecord = {
        type: 'create',
        data: {
            fld_title: 'Initial title',
            fld_readonly: 'Locked value',
            fld_hidden_native: ['record_retained'],
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};

const mount = async (
    test: TestContext,
    form: FormLoadedResult,
    options: {
        save?(input: SaveFormInput): Promise<Response>;
        read?(url: URL, init?: RequestInit): Promise<Response>;
        initialPortal?: PortalLoadedResult;
        childLoads?: LoadExtensionInput[];
    } = {}
) => {
    const saves: SaveFormInput[] = [];
    let loads = 0;
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    const markup = await readFile(
        join(root, 'examples/browser/index.html'),
        'utf8'
    );
    window.document.write(
        markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    // HappyDOM lacks the browser Option constructor. Its native option elements
    // still exercise selection, events and the actual Portal renderer.
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        Option,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route');
            if (route === 'fetchExtensionForEndUser') {
                loads += 1;
                if (options.initialPortal != null) {
                    const loaded: LoadExtensionInput = JSON.parse(
                        String(init?.body)
                    );
                    if (!('childExtensionInfo' in loaded))
                        return new Response(
                            JSON.stringify(options.initialPortal)
                        );
                    options.childLoads?.push(structuredClone(loaded));
                }
                return new Response(JSON.stringify(form));
            }
            if (route === 'saveForm') {
                const saved: SaveFormInput = JSON.parse(String(init?.body));
                saves.push(saved);
                return (
                    options.save?.(saved) ??
                    new Response(
                        JSON.stringify({
                            type: 'error',
                            formValidationErrors: [],
                            formErrors: {},
                        })
                    )
                );
            }
            if (options.read != null) return options.read(url, init);
            throw new Error('Unexpected review fixture request.');
        },
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        try {
            // Capturing a fetch payload precedes response handling. Keep the
            // fixture DOM installed until the actual request runner is idle.
            await waitFor(
                () =>
                    window.document
                        .getElementById('screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            }
            await window.happyDOM.close();
        }
    });
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
    );
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    const connection = window.document.getElementById('connection-form');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    assert.ok(connection);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_example';
    connection.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
    await waitFor(() =>
        options.initialPortal == null
            ? window.document.querySelector('[data-field-id="fld_title"]') !==
              null
            : Array.from(window.document.querySelectorAll('button')).some(
                  (node) => node.textContent === 'Load records'
              )
    );
    const field = (id: string) => {
        const input = window.document.querySelector(`[data-field-id="${id}"]`);
        assert.ok(input instanceof window.HTMLInputElement);
        return input;
    };
    const button = (
        text: string,
        within: Pick<Window['document'], 'querySelectorAll'> = window.document
    ) => {
        const node = Array.from(within.querySelectorAll('button')).find(
            (node) => node.textContent?.trim() === text
        );
        assert.ok(
            node instanceof window.HTMLButtonElement,
            `Missing ${text} button.`
        );
        return node;
    };
    const submit = () => {
        const card = field('fld_title').closest('form');
        assert.ok(card);
        card.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
    };
    const openReview = async () => {
        submit();
        await waitFor(
            () => window.document.querySelector('dialog[open]') !== null
        );
        const dialog = window.document.querySelector('dialog[open]');
        assert.ok(dialog instanceof window.HTMLDialogElement);
        return dialog;
    };
    const edit = (id: string, value: string) => {
        const input = field(id);
        input.value = value;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    return {
        window,
        saves,
        field,
        button,
        submit,
        openReview,
        edit,
        loads: () => loads,
    };
};

describe('actual browser starter prepared review', () => {
    it('reviews ordered plain values and fixed password masks, then saves the complete native draft once', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = {
            title: '<b>Semantic secret</b>',
            showTitle: false,
            obscurePassword: true,
        };
        form.payload.formRecord.data.fld_title = 'CaseSensitiveSecret';
        form.payload.formRecord.data.fld_readonly =
            '<img src=x onerror=alert(1)>';
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelector('img, b'), null);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dt'), (row) => row.textContent),
            ['<b>Semantic secret</b>', 'Read only']
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['••••••••', '<img src=x onerror=alert(1)>']
        );
        assert.equal(
            dialog.textContent?.includes('CaseSensitiveSecret'),
            false
        );
        const label = dialog.querySelector('dt');
        const value = dialog.querySelector('dd');
        assert.ok(label && value);
        assert.equal(value.getAttribute('aria-labelledby'), label.id);
        assert.equal(label.getAttribute('data-review-title-hidden'), 'true');
        assert.equal(
            fixture.window.document.activeElement,
            fixture.button('Edit', dialog)
        );
        fixture.button('Edit', dialog).click();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.field('fld_title').value, 'CaseSensitiveSecret');
        fixture.edit('fld_title', 'SecondSecret');
        const second = await fixture.openReview();
        fixture.button('Confirm', second).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            fld_title: 'SecondSecret',
            fld_readonly: '<img src=x onerror=alert(1)>',
            fld_hidden_native: ['record_retained'],
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        assert.equal(fixture.saves[0]?.isComputeMode, false);
    });

    it('uses the canonical conditional projection and emptiness without dropping hidden native Save values', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        form.payload.fieldIdsToSchemas.fld_driver = {
            fieldType: AirtableFieldType.CHECKBOX,
            airtableField: {
                id: 'fld_driver',
                name: 'Show title',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.CHECKBOX,
                    options: { color: 'greenBright', icon: 'check' },
                },
            },
        };
        form.payload.fieldIdsToSchemas.fld_number = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_number',
                name: 'Zero count',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
        };
        title.miniExtConfig = {
            title: 'Hidden title',
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'review_condition',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: AirtableFieldType.CHECKBOX,
                            idOrName: { type: 'id', id: 'fld_driver' },
                            value: true,
                        },
                    },
                ],
            },
        };
        form.payload.fieldIdsInForm = [
            'fld_driver',
            'fld_title',
            'fld_number',
            'fld_readonly',
        ];
        form.payload.formRecord.data.fld_driver = false;
        form.payload.formRecord.data.fld_number = 0;
        form.payload.formRecord.data.fld_readonly = '   ';
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dt'), (row) => row.textContent),
            ['Zero count']
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['0']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
        assert.equal(fixture.saves[0]?.formRecord.data.fld_driver, false);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_number, 0);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_readonly, '   ');
        assert.deepEqual(fixture.saves[0]?.formRecord.data.fld_hidden_native, [
            'record_retained',
        ]);
    });

    it('keeps an ordinary manual Save unchanged when the published review flag is off', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            promptUserBeforeSubmission: false,
        };
        const fixture = await mount(test, form);
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
    });

    it('renders every bounded scalar kind and preserves canonical empty values in Save', async (test) => {
        const form = reviewForm();
        // The metadata API also exposes manualSort; published Form schemas do
        // not. Keep this renderer fixture within its finite physical union.
        const configs: ReviewScalarConfig[] = [
            { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
            { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            { type: AirtableFieldType.EMAIL, options: null },
            { type: AirtableFieldType.URL, options: null },
            { type: AirtableFieldType.PHONE_NUMBER, options: null },
            { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.RATING,
                options: { color: 'yellowBright', icon: 'star', max: 5 },
            },
            {
                type: AirtableFieldType.CHECKBOX,
                options: { color: 'greenBright', icon: 'check' },
            },
            { type: AirtableFieldType.BARCODE, options: null },
        ];
        const values = [
            'Text',
            'Line one\nLine two',
            'person@example.test',
            'https://example.test/path',
            '+1 555 0100',
            0,
            12.5,
            0.2,
            3,
            true,
            { text: '001', type: 'code128' },
        ];
        for (const [index, config] of configs.entries()) {
            const id = `fld_scalar_${index}`;
            const field = scalarReviewSchema(id, config.type, config);
            form.payload.fieldIdsToSchemas[id] = field;
            form.payload.fieldIdsInForm.push(id);
            form.payload.formRecord.data[id] = values[index] ?? null;
        }
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            [
                'Initial title',
                'Locked value',
                'Text',
                'Line one\nLine two',
                'person@example.test',
                'https://example.test/path',
                '+1 555 0100',
                '0',
                '12.5',
                '0.2',
                '3',
                'Checked',
                '001',
            ]
        );
        assert.equal(dialog.querySelector('a, iframe, img'), null);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(
            fixture.saves[0]?.formRecord.data,
            form.payload.formRecord.data
        );
    });

    it('permits an empty review without manufacturing nonempty checkbox, rating or barcode rows', async (test) => {
        const form = reviewForm();
        const fields: Extract<
            RuntimeFieldSchema['airtableField'],
            {
                config: {
                    type: 'checkbox' | 'rating' | 'barcode';
                };
            }
        >[] = [
            {
                id: 'fld_check',
                name: 'Unchecked',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.CHECKBOX,
                    options: { color: 'greenBright', icon: 'check' },
                },
            },
            {
                id: 'fld_rating',
                name: 'Zero rating',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.RATING,
                    options: { color: 'yellowBright', icon: 'star', max: 5 },
                },
            },
            {
                id: 'fld_barcode',
                name: 'Blank barcode',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: { type: AirtableFieldType.BARCODE, options: null },
            },
        ];
        for (const field of fields) {
            form.payload.fieldIdsToSchemas[field.id] = scalarReviewSchema(
                field.id,
                field.name,
                field.config
            );
            form.payload.fieldIdsInForm.push(field.id);
        }
        form.payload.formRecord.data = {
            fld_title: null,
            fld_readonly: '   ',
            fld_check: false,
            fld_rating: 0,
            fld_barcode: { text: ' ', type: 'code128' },
            fld_hidden_native: ['record_retained'],
        };
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        assert.equal(dialog.querySelectorAll('dt, dd').length, 0);
        assert.match(dialog.textContent ?? '', /No nonempty answers to review/);
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(
            fixture.saves[0]?.formRecord.data,
            form.payload.formRecord.data
        );
    });

    it('reviews canonical whitespace across every bounded scalar family without changing native edit Save data', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            multiPageFormMode: 'one-page',
        };
        const configs: ReviewScalarConfig[] = [
            { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
            { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            { type: AirtableFieldType.EMAIL, options: null },
            { type: AirtableFieldType.URL, options: null },
            { type: AirtableFieldType.PHONE_NUMBER, options: null },
            { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.RATING,
                options: { color: 'yellowBright', icon: 'star', max: 5 },
            },
            {
                type: AirtableFieldType.CHECKBOX,
                options: { color: 'greenBright', icon: 'check' },
            },
            { type: AirtableFieldType.BARCODE, options: null },
        ];
        const blankIds: string[] = [];
        const readonlyIds: string[] = [];
        for (const [index, config] of configs.entries()) {
            // Barcode remains a read-only display. The other ten families
            // cover both editable and explicitly read-only visible controls.
            const readonlyModes =
                config.type === AirtableFieldType.BARCODE
                    ? [true]
                    : [false, true];
            for (const readOnly of readonlyModes) {
                const id = `fld_blank_${index}_${readOnly ? 'locked' : 'editable'}`;
                const schema = scalarReviewSchema(id, config.type, config);
                schema.miniExtConfig = {
                    readOnly,
                    hideFieldIfEmpty: false,
                };
                form.payload.fieldIdsToSchemas[id] = schema;
                form.payload.fieldIdsInForm.push(id);
                form.payload.formRecord.data[id] = ' \t\n ';
                blankIds.push(id);
                if (readOnly) readonlyIds.push(id);
            }
        }
        const native = structuredClone(form.payload.formRecord.data);
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = [
            'fld_hidden_native',
            ...blankIds,
        ];
        const fixture = await mount(test, form);
        for (const id of blankIds) {
            const control = fixture.window.document.querySelector(
                `[data-field-id="${id}"]`
            );
            assert.ok(control);
            assert.equal(
                control.closest('[hidden]'),
                null,
                `${id} must remain visible when hideFieldIfEmpty is disabled.`
            );
            if (readonlyIds.includes(id))
                assert.equal(control.hasAttribute('disabled'), true);
        }
        fixture.edit('fld_title', 'Whitespace retained');
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelectorAll('dt').length, 2);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Whitespace retained', 'Locked value']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.saves.length === 1 &&
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: { ...native, fld_title: 'Whitespace retained' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            ...blankIds,
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        assert.equal(fixture.saves.length, 1);
    });

    it('reviews edit Forms with hideFieldIfEmpty whitespace across every bounded scalar family without changing native Save data', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            multiPageFormMode: 'one-page',
        };
        const configs: ReviewScalarConfig[] = [
            { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
            { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            { type: AirtableFieldType.EMAIL, options: null },
            { type: AirtableFieldType.URL, options: null },
            { type: AirtableFieldType.PHONE_NUMBER, options: null },
            { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.RATING,
                options: { color: 'yellowBright', icon: 'star', max: 5 },
            },
            {
                type: AirtableFieldType.CHECKBOX,
                options: { color: 'greenBright', icon: 'check' },
            },
            { type: AirtableFieldType.BARCODE, options: null },
        ];
        const blankIds: string[] = [];
        const readonlyIds: string[] = [];
        for (const [index, config] of configs.entries()) {
            // Barcode remains a read-only display. The other ten families
            // cover both editable and explicitly read-only hidden controls.
            const readonlyModes =
                config.type === AirtableFieldType.BARCODE
                    ? [true]
                    : [false, true];
            for (const readOnly of readonlyModes) {
                const id = `fld_blank_${index}_${readOnly ? 'locked' : 'editable'}`;
                const schema = scalarReviewSchema(id, config.type, config);
                schema.miniExtConfig = {
                    readOnly,
                    hideFieldIfEmpty: true,
                };
                form.payload.fieldIdsToSchemas[id] = schema;
                form.payload.fieldIdsInForm.push(id);
                form.payload.formRecord.data[id] = ' \t\n ';
                blankIds.push(id);
                if (readOnly) readonlyIds.push(id);
            }
        }
        const native = structuredClone(form.payload.formRecord.data);
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = [
            'fld_hidden_native',
            ...blankIds,
        ];
        const fixture = await mount(test, form);
        for (const id of blankIds) {
            const control = fixture.window.document.querySelector(
                `[data-field-id="${id}"]`
            );
            assert.ok(control);
            assert.notEqual(
                control.closest('[hidden]'),
                null,
                `${id} must be hidden by the published edit-mode setting.`
            );
            if (readonlyIds.includes(id))
                assert.equal(control.hasAttribute('disabled'), true);
        }
        fixture.edit('fld_title', 'Whitespace retained');
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelectorAll('dt').length, 2);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Whitespace retained', 'Locked value']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.saves.length === 1 &&
                fixture.window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            recordId: 'record_review_whitespace',
            tableId: 'table_review_whitespace',
            data: { ...native, fld_title: 'Whitespace retained' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            ...blankIds,
            'fld_title',
        ]);
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        assert.equal(fixture.saves.length, 1);
    });

    for (const config of [
        { type: AirtableFieldType.NUMBER, options: { precision: 0 } },
        { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
        {
            type: AirtableFieldType.CURRENCY,
            options: { precision: 2, symbol: '$' },
        },
        {
            type: AirtableFieldType.RATING,
            options: { color: 'yellowBright', icon: 'star', max: 5 },
        },
        {
            type: AirtableFieldType.CHECKBOX,
            options: { color: 'greenBright', icon: 'check' },
        },
        { type: AirtableFieldType.BARCODE, options: null },
    ] satisfies ReviewScalarConfig[]) {
        it(`rejects a nonblank malformed ${config.type} answer after whitespace emptiness normalization`, async (test) => {
            const form = reviewForm();
            const schema = scalarReviewSchema(
                'fld_malformed',
                'Malformed answer',
                config
            );
            // A visible read-only control preserves the malformed native
            // value and isolates Review preparation from control validity.
            schema.miniExtConfig = {
                readOnly: true,
                hideFieldIfEmpty: false,
            };
            form.payload.fieldIdsToSchemas.fld_malformed = schema;
            form.payload.fieldIdsInForm.push('fld_malformed');
            const native = {
                ...form.payload.formRecord.data,
                fld_malformed: 'Nonblank malformed native value',
            };
            form.payload.formRecord = {
                type: 'edit',
                recordId: 'record_review_malformed',
                tableId: 'table_review_malformed',
                data: native,
            };
            form.payload.formFieldIdsWithUnsavedChanges = ['fld_malformed'];
            const fixture = await mount(test, form);
            const control = fixture.window.document.querySelector(
                '[data-field-id="fld_malformed"]'
            );
            assert.ok(control);
            assert.equal(control.closest('[hidden]'), null);
            fixture.submit();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(fixture.window.document.querySelector('dialog'), null);
            assert.match(
                fixture.window.document.getElementById('status')?.textContent ??
                    '',
                /review.*unavailable/i
            );
            assert.equal(fixture.field('fld_title').value, 'Initial title');
        });
    }

    it('rejects a malformed readonly scalar instead of coercing it into a review answer', async (test) => {
        const form = reviewForm();
        form.payload.fieldIdsToSchemas.fld_readonly = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_readonly',
                name: 'Count',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
            miniExtConfig: { readOnly: true },
        };
        form.payload.formRecord.data.fld_readonly = 'Malformed count';
        const fixture = await mount(test, form);
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /review.*unavailable/i
        );
    });

    it('treats Escape and dialog dismissal as Edit, and accepts only one explicit Confirm', async (test) => {
        const fixture = await mount(test, reviewForm());
        const first = await fixture.openReview();
        first.dispatchEvent(
            new fixture.window.Event('cancel', { cancelable: true })
        );
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(first.isConnected, false);
        const second = await fixture.openReview();
        second.close();
        await settled();
        assert.equal(fixture.saves.length, 0);
        const third = await fixture.openReview();
        const confirm = fixture.button('Confirm', third);
        confirm.click();
        confirm.click();
        fixture.submit();
        await waitFor(() => fixture.saves.length === 1);
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
    });

    it('invalidates a prepared review after an accepted draft edit, including edit-away-and-back', async (test) => {
        const fixture = await mount(test, reviewForm());
        const dialog = await fixture.openReview();
        const stale = fixture.button('Confirm', dialog);
        fixture.edit('fld_title', 'Changed while prepared');
        fixture.edit('fld_title', 'Initial title');
        stale.click();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.isConnected, false);
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
    });

    it('invalidates review before an invalid numeric edit can throw or submit the last accepted value', async (test) => {
        const form = reviewForm();
        form.payload.fieldIdsToSchemas.fld_number = {
            fieldType: AirtableFieldType.NUMBER,
            airtableField: {
                id: 'fld_number',
                name: 'Count',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: {
                    type: AirtableFieldType.NUMBER,
                    options: { precision: 0 },
                },
            },
        };
        form.payload.fieldIdsInForm.push('fld_number');
        form.payload.formRecord.data.fld_number = 7;
        const fixture = await mount(test, form);
        const dialog = await fixture.openReview();
        const stale = fixture.button('Confirm', dialog);
        const number = fixture.field('fld_number');
        assert.equal(number.type, 'number');
        const originalValidity = Object.getOwnPropertyDescriptor(
            number,
            'validity'
        );
        // Happy DOM sanitizes bad text without producing native badInput.
        // Supply this contract at the existing control boundary; native
        // keyboard/validity evidence remains a separate Chromium obligation.
        Object.defineProperty(number, 'validity', {
            configurable: true,
            value: { badInput: true, valid: false },
        });
        number.value = '';
        number.dispatchEvent(
            new fixture.window.Event('input', { bubbles: true })
        );
        assert.equal(
            dialog.isConnected,
            false,
            'The invalid edit itself must dismiss review before a stale Confirm can close it.'
        );
        assert.equal(fixture.saves.length, 0);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /Count must be a valid number/
        );
        stale.click();
        await settled();
        assert.equal(dialog.isConnected, false);
        assert.equal(fixture.saves.length, 0);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /Count must be a valid number/
        );
        assert.equal(fixture.field('fld_title').value, 'Initial title');
        fixture.submit();
        await settled();
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.saves.length, 0);
        if (originalValidity == null)
            Reflect.deleteProperty(number, 'validity');
        else Object.defineProperty(number, 'validity', originalValidity);
        fixture.edit('fld_number', '8');
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.equal(fixture.saves[0]?.formRecord.data.fld_number, 8);
        assert.equal(
            fixture.saves[0]?.formRecord.data.fld_title,
            'Initial title'
        );
        assert.deepEqual(fixture.saves[0]?.formRecord.data.fld_hidden_native, [
            'record_retained',
        ]);
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_number',
        ]);
    });

    it('confirms an explicit one-page edit Form with its record identity and complete native draft', async (test) => {
        const form = reviewForm();
        form.payload.publicFields.state = {
            ...form.payload.publicFields.state,
            multiPageFormMode: 'one-page',
        };
        const native = {
            ...form.payload.formRecord.data,
            fld_retained_number: 0,
            fld_retained_barcode: { text: '001', type: 'code128' },
        };
        form.payload.formRecord = {
            type: 'edit',
            recordId: 'record_review_edit',
            tableId: 'table_review_edit',
            data: native,
        };
        form.payload.formFieldIdsWithUnsavedChanges = ['fld_hidden_native'];
        const fixture = await mount(test, form);
        fixture.edit('fld_title', 'Edited request');
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Edited request', 'Locked value']
        );
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'edit',
            recordId: 'record_review_edit',
            tableId: 'table_review_edit',
            data: { ...native, fld_title: 'Edited request' },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_hidden_native',
            'fld_title',
        ]);
        assert.equal(
            fixture.saves[0]?.extensionAccessToken,
            form.payload.extensionAccessToken
        );
        assert.equal(fixture.saves[0]?.isComputeMode, false);
        assert.equal(fixture.saves[0]?.context.type, 'direct-url');
        await settled();
        assert.equal(fixture.saves.length, 1);
    });

    it('retires a prepared intent across visitor A-to-B-to-A and requires a fresh review', async (test) => {
        const fixture = await mount(test, reviewForm());
        const dialog = await fixture.openReview();
        const stale = fixture.button('Confirm', dialog);
        const visitor = fixture.window.document.getElementById('visitor');
        assert.ok(visitor instanceof fixture.window.HTMLSelectElement);
        for (const identity of ['B', 'A']) {
            visitor.value = identity;
            visitor.dispatchEvent(
                new fixture.window.Event('change', { bubbles: true })
            );
        }
        stale.click();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.isConnected, false);
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
    });

    for (const action of [
        'Reload',
        'Discard draft',
        'Disconnect',
        "Clear this visitor's session",
    ]) {
        it(`invalidates prepared confirmation on ${action}`, async (test) => {
            const fixture = await mount(test, reviewForm());
            const dialog = await fixture.openReview();
            const stale = fixture.button('Confirm', dialog);
            fixture.button(action).click();
            stale.click();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(dialog.isConnected, false);
            if (action === 'Reload') assert.equal(fixture.loads(), 2);
            if (action === "Clear this visitor's session")
                assert.match(
                    fixture.window.document.getElementById('status')
                        ?.textContent ?? '',
                    /anonymous again/
                );
        });
    }

    it('opens review before required validation and preserves the backend errors and draft', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = { required: true };
        form.payload.formRecord.data.fld_title = null;
        const fixture = await mount(test, form, {
            save: async () => new Response(JSON.stringify(invalidForm())),
        });
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        assert.equal(dialog.querySelectorAll('dt').length, 1);
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.window.document
                    .querySelector('.error-list')
                    ?.textContent?.includes('A title is required.') === true
        );
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.field('fld_title').value, '');
        fixture.edit('fld_title', 'Repaired title');
        const fresh = await fixture.openReview();
        fixture.button('Edit', fresh).click();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.field('fld_title').value, 'Repaired title');
    });

    it('keeps an unknown Save outcome blocked instead of reopening or replaying confirmation', async (test) => {
        const fixture = await mount(test, reviewForm(), {
            save: async () => {
                throw new Error('Synthetic transport outcome unknown.');
            },
        });
        const dialog = await fixture.openReview();
        fixture.button('Confirm', dialog).click();
        await waitFor(
            () =>
                fixture.window.document
                    .querySelector('.error-list')
                    ?.textContent?.includes('may have completed') === true
        );
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(fixture.button('Save').disabled, true);
        assert.equal(fixture.field('fld_title').value, 'Initial title');
        assert.equal(
            (
                fixture.field('fld_title').closest('.fields') as unknown as {
                    inert: boolean;
                } | null
            )?.inert,
            true,
            'uncertain Review Save keeps the actual field group inert'
        );
    });

    it('blocks a cancelled held Save and ignores its late response without replaying review', async (test) => {
        const held: { resolve?: (response: Response) => void } = {};
        const fixture = await mount(test, reviewForm(), {
            save: async () =>
                new Promise<Response>((resolve) => {
                    held.resolve = resolve;
                }),
        });
        const dialog = await fixture.openReview();
        fixture.button('Confirm', dialog).click();
        await waitFor(() => fixture.saves.length === 1);
        fixture.button('Cancel request').click();
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.ok(held.resolve);
        assert.equal(
            (
                fixture.field('fld_title').closest('.fields') as unknown as {
                    inert: boolean;
                } | null
            )?.inert,
            true,
            'cancelled Review Save keeps the actual field group inert'
        );
        held.resolve(
            new Response(
                JSON.stringify({
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                })
            )
        );
        await settled();
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 1);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.equal(
            (
                fixture.field('fld_title').closest('.fields') as unknown as {
                    inert: boolean;
                } | null
            )?.inert,
            true,
            'late cancelled response cannot unlock untracked field edits'
        );
    });

    for (const config of [
        { multiPageFormMode: 'multi-page' as const },
        { enableFormComputeMode: true },
        { autoSubmitAfterPrefill: true },
    ]) {
        it(`blocks review and Save for unsupported workflow ${Object.keys(config)[0]}`, async (test) => {
            const form = reviewForm();
            form.payload.publicFields.state = {
                ...form.payload.publicFields.state,
                promptUserBeforeSubmission: true,
                ...config,
            };
            const fixture = await mount(test, form);
            fixture.submit();
            await settled();
            assert.equal(fixture.saves.length, 0);
            assert.equal(fixture.window.document.querySelector('dialog'), null);
            assert.match(
                fixture.window.document.getElementById('status')?.textContent ??
                    '',
                /review.*unavailable|review.*supports/i
            );
        });
    }

    it('blocks section plus active edit empty hiding without exposing values', async (test) => {
        const form = reviewForm();
        form.payload.formRecord = {
            type: 'edit',
            tableId: 'tbl_review',
            recordId: 'rec_review',
            data: form.payload.formRecord.data,
        };
        const readonly = form.payload.fieldIdsToSchemas.fld_readonly;
        assert.ok(readonly);
        readonly.miniExtConfig = {
            readOnly: true,
            enableSectionHeader: false,
            headerSectionTitle: 'Retained section',
            hideFieldIfEmpty: true,
        };
        const fixture = await mount(test, form);
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /unavailable|blocked/i
        );
    });

    it('blocks complex rendered answers without sending an incomplete scalar review', async (test) => {
        const form = reviewForm();
        const computed = loadedForm().payload.fieldIdsToSchemas.fld_computed;
        assert.ok(computed);
        form.payload.fieldIdsToSchemas.fld_computed = computed;
        form.payload.fieldIdsInForm.push('fld_computed');
        form.payload.formRecord.data.fld_computed = 'Private formula answer';
        const fixture = await mount(test, form);
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /review.*unavailable/i
        );
    });

    it('denies a noncomputed linked renderer while retaining its adjacent scalar answers', async (test) => {
        const form = reviewForm();
        const linkedConfig = structuredClone(portalField.config);
        assert.ok(
            linkedConfig.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
        );
        form.payload.fieldIdsToSchemas.fld_linked = {
            fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
            airtableField: {
                ...structuredClone(portalField),
                id: 'fld_linked',
                name: 'Linked answer',
                config: linkedConfig,
            },
            miniExtConfig: { readOnly: true },
        };
        form.payload.fieldIdsInForm.push('fld_linked');
        form.payload.formRecord.data.fld_linked = ['record_linked'];
        const fixture = await mount(test, form);
        const linked = fixture.window.document.querySelector(
            '[data-field-id="fld_linked"]'
        );
        assert.ok(linked instanceof fixture.window.HTMLTextAreaElement);
        assert.equal(linked.value, JSON.stringify(['record_linked'], null, 2));
        fixture.submit();
        await settled();
        assert.equal(fixture.saves.length, 0);
        assert.equal(fixture.window.document.querySelector('dialog'), null);
        assert.match(
            fixture.window.document.getElementById('status')?.textContent ?? '',
            /review.*unavailable/i
        );
        assert.equal(fixture.field('fld_title').value, 'Initial title');
        assert.equal(fixture.field('fld_readonly').value, 'Locked value');
        assert.equal(linked.value, JSON.stringify(['record_linked'], null, 2));
    });

    it('retires child review on Back to Portal and confirms a fresh child review with the exact parent context', async (test) => {
        const child = reviewForm();
        child.extensionId = 'extension_child';
        child.payload.hasParentExtension = true;
        child.payload.formRecord.data.fld_parent = ['record_parent'];
        child.payload.formFieldIdsWithUnsavedChanges = ['fld_parent'];
        child.payload.urlPrefilledFieldIds = ['fld_parent'];
        const parent = portalPage();
        const childLoads: LoadExtensionInput[] = [];
        let portalReads = 0;
        const fixture = await mount(test, child, {
            initialPortal: parent,
            childLoads,
            read: async (url) => {
                assert.equal(
                    url.searchParams.get('route'),
                    'fetchRecordsForLinkedTableOnPortal'
                );
                portalReads += 1;
                return new Response(JSON.stringify(portalListPage()));
            },
        });
        const idle = () =>
            fixture.window.document
                .getElementById('screen')
                ?.getAttribute('aria-busy') === 'false';
        fixture.button('Load records').click();
        await waitFor(() => portalReads === 1 && idle());
        fixture.button('Create record').click();
        await waitFor(() => childLoads.length === 1 && idle());
        fixture.edit('fld_title', 'Retained child draft');
        const first = await fixture.openReview();
        const stale = fixture.button('Confirm', first);
        assert.equal(fixture.saves.length, 0);
        fixture.button('Back to Portal').click();
        assert.equal(
            first.isConnected,
            false,
            'Returning to the parent retires the child dialog before any stale action.'
        );
        stale.click();
        await settled();
        assert.equal(first.isConnected, false);
        assert.equal(fixture.saves.length, 0);
        assert.equal(
            fixture.window.document.querySelector(
                '[data-field-id="fld_title"]'
            ),
            null
        );
        fixture.button('Create record').click();
        await waitFor(() => childLoads.length === 2 && idle());
        assert.equal(fixture.field('fld_title').value, 'Retained child draft');
        const fresh = await fixture.openReview();
        assert.deepEqual(
            Array.from(fresh.querySelectorAll('dd'), (row) => row.textContent),
            ['Retained child draft', 'Locked value']
        );
        const parentPrefill = {
            toLinkToParent: {
                reversedFieldIdToPrefill: 'fld_parent',
                parentFormRecordId: 'record_parent',
            },
            prefillQueryForChildExtension: 'prefill_Title=Example',
        };
        for (const loaded of childLoads) {
            assert.ok('childExtensionAccessData' in loaded);
            assert.deepEqual(loaded.context, {
                type: 'modal',
                linkedTableIdOfLinkedRecordField: 'table_children',
                prefillDataForLinkedRecordsForm: parentPrefill,
            });
            assert.deepEqual(loaded.childExtensionAccessData, {
                parentExtensionAccessToken: 'portal_access_example',
                fieldIdUsedToAccessExtension: 'fld_children',
            });
        }
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1 && idle());
        assert.deepEqual(fixture.saves[0]?.context, {
            type: 'modal',
            prefillData: parentPrefill,
        });
        assert.deepEqual(fixture.saves[0]?.formRecord, {
            type: 'create',
            data: {
                fld_title: 'Retained child draft',
                fld_readonly: 'Locked value',
                fld_hidden_native: ['record_retained'],
                fld_parent: ['record_parent'],
            },
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_parent',
            'fld_title',
        ]);
        assert.equal(
            fixture.saves[0]?.extensionAccessToken,
            child.payload.extensionAccessToken
        );
        assert.equal(portalReads, 1);
        assert.equal(childLoads.length, 2);
        assert.equal(fixture.saves.length, 1);
    });

    it('retires held address predictions before capture and resumes only after fresh typing', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = { enableAddressAutocomplete: true };
        let reads = 0;
        const prediction: { resolve?: (response: Response) => void } = {};
        const fixture = await mount(test, form, {
            read: async (url) => {
                assert.equal(
                    url.pathname,
                    '/api/trpc/publicExtensions.autoCompleteAddressField'
                );
                reads += 1;
                return new Promise<Response>((resolve) => {
                    prediction.resolve = resolve;
                });
            },
        });
        fixture.edit('fld_title', '12 Main');
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(reads, 1);
        const dialog = await fixture.openReview();
        assert.equal(fixture.saves.length, 0);
        const resolvePrediction = prediction.resolve;
        assert.ok(resolvePrediction);
        resolvePrediction(
            new Response(
                JSON.stringify({
                    result: {
                        data: [
                            {
                                description: 'Stale provider address',
                                placeId: 'stale_place',
                            },
                        ],
                    },
                })
            )
        );
        await settled();
        assert.equal(
            fixture.window.document.querySelectorAll('[role="option"]').length,
            0
        );
        assert.equal(fixture.field('fld_title').value, '12 Main');
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['12 Main', 'Locked value']
        );
        fixture.button('Edit', dialog).click();
        await settled();
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(reads, 1);
        assert.equal(fixture.saves.length, 0);
        fixture.edit('fld_title', '12 Main Street');
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(reads, 2);
    });

    it('retires a selected address detail intent before review capture and rejects its held formatted completion', async (test) => {
        const form = reviewForm();
        const title = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(title);
        title.miniExtConfig = { enableAddressAutocomplete: true };
        let predictionReads = 0;
        let detailReads = 0;
        const detail: {
            resolve?: (response: Response) => void;
            signal?: AbortSignal | null;
        } = {};
        const fixture = await mount(test, form, {
            read: async (url, init) => {
                if (
                    url.pathname ===
                    '/api/trpc/publicExtensions.autoCompleteAddressField'
                ) {
                    predictionReads += 1;
                    return new Response(
                        JSON.stringify({
                            result: {
                                data: [
                                    {
                                        description:
                                            'Accepted address description',
                                        placeId: 'selected_place',
                                    },
                                ],
                            },
                        })
                    );
                }
                assert.equal(
                    url.pathname,
                    '/api/trpc/publicExtensions.getFormattedAddressFromPlaceId'
                );
                assert.deepEqual(
                    JSON.parse(url.searchParams.get('input') ?? '{}'),
                    {
                        extensionAccessToken: form.payload.extensionAccessToken,
                        fieldId: 'fld_title',
                        placeId: 'selected_place',
                    }
                );
                detailReads += 1;
                detail.signal = init?.signal ?? null;
                return new Promise<Response>((resolve) => {
                    detail.resolve = resolve;
                });
            },
        });
        fixture.edit('fld_title', '12 Main');
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        await waitFor(
            () =>
                fixture.window.document.querySelector('[role="option"]') !==
                null
        );
        const suggestion =
            fixture.window.document.querySelector('[role="option"]');
        assert.ok(suggestion instanceof fixture.window.HTMLButtonElement);
        suggestion.click();
        await waitFor(() => detailReads === 1);
        assert.equal(
            fixture.field('fld_title').value,
            'Accepted address description'
        );
        assert.equal(detail.signal?.aborted, false);
        const dialog = await fixture.openReview();
        assert.equal(
            detail.signal?.aborted,
            true,
            'Review must actively retire the held selected-place intent.'
        );
        assert.equal(fixture.field('fld_title').disabled, true);
        assert.equal(fixture.saves.length, 0);
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Accepted address description', 'Locked value']
        );
        assert.ok(detail.resolve);
        detail.resolve(
            new Response(
                JSON.stringify({
                    result: {
                        data: 'Late formatted address must not replace the accepted description',
                    },
                })
            )
        );
        await settled();
        assert.equal(
            fixture.field('fld_title').value,
            'Accepted address description'
        );
        assert.deepEqual(
            Array.from(dialog.querySelectorAll('dd'), (row) => row.textContent),
            ['Accepted address description', 'Locked value']
        );
        assert.equal(fixture.saves.length, 0);
        fixture.button('Edit', dialog).click();
        await settled();
        assert.equal(fixture.field('fld_title').disabled, false);
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.equal(predictionReads, 1);
        assert.equal(detailReads, 1);
        const fresh = await fixture.openReview();
        fixture.button('Confirm', fresh).click();
        await waitFor(() => fixture.saves.length === 1);
        assert.deepEqual(fixture.saves[0]?.formRecord.data, {
            fld_title: 'Accepted address description',
            fld_readonly: 'Locked value',
            fld_hidden_native: ['record_retained'],
        });
        assert.deepEqual(fixture.saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(predictionReads, 1);
        assert.equal(detailReads, 1);
    });
});
