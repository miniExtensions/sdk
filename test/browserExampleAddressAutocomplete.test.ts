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
    type ListAddressPredictionsInput,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';

const root = resolve(process.cwd());
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-address-'));
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
    assert.fail('The actual starter did not reach the expected state.');
};

const mount = async (
    test: TestContext,
    form: FormLoadedResult,
    reads: ListAddressPredictionsInput[],
    saves: SaveFormInput[]
) => {
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
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route') ?? url.pathname;
            if (route === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(form));
            if (route === 'saveForm') {
                saves.push(JSON.parse(String(init?.body)));
                // Keep this mounted draft open so the ordinary typed-string
                // Save and later suggestion read share the same Form owner.
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    })
                );
            }
            if (
                route === '/api/trpc/publicExtensions.autoCompleteAddressField'
            ) {
                reads.push(JSON.parse(url.searchParams.get('input') ?? '{}'));
                return new Response(
                    JSON.stringify({
                        result: {
                            data: [
                                {
                                    description: '12 Main Street, Example City',
                                    placeId: 'place_main',
                                },
                            ],
                        },
                    })
                );
            }
            throw new Error('Unexpected address fixture request.');
        },
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
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
    return window;
};

describe('actual browser starter address autocomplete', () => {
    it('keeps a typed native draft and reads configured suggestions after the canonical debounce', async (test) => {
        const form = loadedForm();
        const field = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(field);
        assert.equal(field.fieldType, AirtableFieldType.SINGLE_LINE_TEXT);
        assert.equal(field.airtableField.isComputed, false);
        field.miniExtConfig = {
            title: 'Address',
            enableAddressAutocomplete: true,
        };
        form.payload.fieldIdsInForm = ['fld_title'];
        form.payload.formRecord = {
            type: 'create',
            data: {
                fld_title: null,
                fld_adjacent: 'Retained adjacent native value',
            },
        };
        form.payload.formFieldIdsWithUnsavedChanges = [];
        form.payload.urlPrefilledFieldIds = [];
        const reads: ListAddressPredictionsInput[] = [];
        const saves: SaveFormInput[] = [];
        const window = await mount(test, form, reads, saves);
        await waitFor(
            () =>
                window.document.querySelector(
                    'input[data-field-id="fld_title"]'
                ) !== null
        );
        const input = window.document.querySelector(
            'input[data-field-id="fld_title"]'
        );
        assert.ok(input instanceof window.HTMLInputElement);
        assert.equal(input.disabled, false);
        input.value = '12 Main';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        const card = input.closest('form');
        assert.ok(card);
        card.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
        await waitFor(() => saves.length === 1);
        assert.equal(saves[0]?.formRecord.data.fld_title, '12 Main');
        assert.equal(
            saves[0]?.formRecord.data.fld_adjacent,
            'Retained adjacent native value'
        );
        assert.deepEqual(saves[0]?.formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(reads.length, 0);

        await waitFor(
            () =>
                (
                    window.document.getElementById(
                        'screen'
                    ) as unknown as HTMLElement | null
                )?.inert === false
        );
        // Save suspends pending field reads. Resume typing deliberately
        // after its validation response in the same mounted draft.
        input.value = '12 Mai';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        input.value = '12 Main';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        // Observe the real configured field and existing runtime transport.
        // This baseline does not import or assert a proposed helper export.
        await new Promise<void>((resolve) => setTimeout(resolve, 850));
        assert.deepEqual(reads, [
            {
                extensionAccessToken: form.payload.extensionAccessToken,
                fieldId: 'fld_title',
                addressFieldValue: '12 Main',
            },
        ]);
        await waitFor(() =>
            Array.from(
                window.document.querySelectorAll('[role="option"]')
            ).some(
                (option) =>
                    option.textContent === '12 Main Street, Example City'
            )
        );
        assert.equal(input.value, '12 Main');
        assert.equal(
            saves.length,
            1,
            'Suggestion reads must not submit a Save.'
        );
    });
});
