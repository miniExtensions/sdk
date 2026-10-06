import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    saves: SaveFormInput[],
    details: string[] = []
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
                                {
                                    description: '12 Side Street, Example City',
                                    placeId: 'place_side',
                                },
                            ],
                        },
                    })
                );
            }
            if (
                route ===
                '/api/trpc/publicExtensions.getFormattedAddressFromPlaceId'
            ) {
                details.push(
                    JSON.parse(url.searchParams.get('input') ?? '{}').placeId
                );
                return new Response(
                    JSON.stringify({ result: { data: '東京都千代田区' } })
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
    it('preserves unfinished Japanese input without reads or keyboard acceptance and resumes after compositionend', async (test) => {
        const form = loadedForm();
        const field = form.payload.fieldIdsToSchemas.fld_title;
        assert.ok(field);
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
        const details: string[] = [];
        const window = await mount(test, form, reads, saves, details);
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
        input.dispatchEvent(new window.CompositionEvent('compositionstart'));
        input.value = '東京未完';
        input.dispatchEvent(
            new window.InputEvent('input', { bubbles: true, isComposing: true })
        );
        await new Promise((done) => setTimeout(done, 850));
        assert.equal(reads.length, 0);
        assert.equal(saves.length, 0);
        for (const name of ['ArrowDown', 'Enter']) {
            const event = new window.KeyboardEvent('keydown', {
                key: name,
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(event);
            assert.equal(event.defaultPrevented, false);
        }
        assert.equal(input.value, '東京未完');
        assert.deepEqual(details, []);
        input.value = '東京';
        input.dispatchEvent(new window.CompositionEvent('compositionend'));
        input.dispatchEvent(
            new window.InputEvent('input', {
                bubbles: true,
                isComposing: false,
            })
        );
        await new Promise((done) => setTimeout(done, 850));
        await waitFor(
            () => window.document.querySelector('[role="option"]') !== null
        );
        assert.deepEqual(
            reads.map((request) => request.addressFieldValue),
            ['東京']
        );
        for (const name of ['ArrowDown', 'Enter']) {
            const event = new window.KeyboardEvent('keydown', {
                key: name,
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(event);
            assert.equal(event.defaultPrevented, true);
        }
        await waitFor(() => input.value === '東京都千代田区');
        assert.deepEqual(details, ['place_main']);
        assert.equal(saves.length, 0);
        const card = input.closest('form');
        assert.ok(card);
        card.dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
        await waitFor(() => saves.length === 1);
        assert.equal(saves[0]?.formRecord.data.fld_title, '東京都千代田区');
        assert.equal(
            saves[0]?.formRecord.data.fld_adjacent,
            'Retained adjacent native value'
        );
        await waitFor(
            () =>
                window.document
                    .getElementById('screen')
                    ?.getAttribute('aria-busy') === 'false'
        );
    });

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
        const popup = window.document.querySelector(
            '[data-address-suggestions]'
        );
        const list = window.document.querySelector('[role="listbox"]');
        const attribution = window.document.querySelector(
            '[data-address-attribution]'
        );
        const logo = attribution?.querySelector('img');
        assert.ok(popup instanceof window.HTMLElement);
        assert.ok(list instanceof window.HTMLElement);
        assert.ok(attribution instanceof window.HTMLElement);
        assert.ok(logo instanceof window.HTMLImageElement);
        assert.equal(popup.hidden, false);
        assert.equal(list.parentElement, popup);
        assert.equal(attribution.parentElement, popup);
        assert.equal(list.contains(logo), false);
        assert.equal(list.children.length, 2);
        assert.equal(logo.alt, 'Google Maps');
        assert.equal(logo.getAttribute('translate'), 'no');
        assert.equal(logo.width, 98);
        assert.equal(logo.height, 18);
        assert.equal(
            createHash('sha256')
                .update(Buffer.from(logo.src.split(',')[1]!, 'base64'))
                .digest('hex'),
            'f542cdc1844d0e1a848455dffdc46a5cd618528576a4dba47bc4a096bfa4f60c'
        );
        const options = Array.from(list.querySelectorAll('[role="option"]'));
        assert.ok(options[0] instanceof window.HTMLButtonElement);
        assert.ok(options[1] instanceof window.HTMLButtonElement);
        const ordinaryBackground = options[0].style.backgroundColor;
        const ordinaryColor = options[0].style.color;
        input.focus();
        const key = (name: string): void => {
            const event = new window.KeyboardEvent('keydown', {
                key: name,
                bubbles: true,
                cancelable: true,
            });
            input.dispatchEvent(event);
            assert.equal(event.defaultPrevented, true);
            assert.equal(window.document.activeElement, input);
        };
        key('ArrowDown');
        assert.equal(options[0].getAttribute('aria-selected'), 'true');
        assert.notEqual(options[0].style.backgroundColor, ordinaryBackground);
        assert.notEqual(options[0].style.color, ordinaryColor);
        assert.equal(options[0].style.outlineWidth, '2px');
        key('ArrowDown');
        assert.equal(options[1].getAttribute('aria-selected'), 'true');
        assert.equal(options[0].style.backgroundColor, ordinaryBackground);
        assert.equal(options[0].style.color, ordinaryColor);
        key('ArrowUp');
        assert.equal(
            input.getAttribute('aria-activedescendant'),
            options[0].id
        );
        assert.equal(options[1].style.backgroundColor, ordinaryBackground);
        key('Escape');
        assert.equal(popup.hidden, true);
        assert.equal(list.children.length, 0);
        assert.equal(input.hasAttribute('aria-activedescendant'), false);
        assert.equal(
            saves.length,
            1,
            'Suggestion reads must not submit a Save.'
        );
    });
});
