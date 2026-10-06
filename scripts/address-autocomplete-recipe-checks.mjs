import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const waitFor = async (predicate) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise((done) => setImmediate(done));
    }
    assert.fail('Installed address recipe did not reach its expected state.');
};
const settle = () => new Promise((done) => setImmediate(done));
const debounce = () => new Promise((done) => setTimeout(done, 850));
const deferred = () => {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};
const input = (window, node, value) => {
    node.value = value;
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const key = (window, node, name) => {
    const event = new window.KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
    });
    node.dispatchEvent(event);
    return event;
};
const click = (node, label) => {
    const button = [...node.querySelectorAll('button')].find(
        (entry) => entry.textContent?.trim() === label
    );
    assert(button, `Missing actual address button: ${label}`);
    assert.equal(button.type, 'button');
    button.click();
};
const response = (data) => new Response(JSON.stringify({ result: { data } }));
const saveError = () =>
    new Response(
        JSON.stringify({
            type: 'error',
            formValidationErrors: [],
            formErrors: {},
        })
    );

const assertAttribution = (host, visible) => {
    const popup = host.querySelector('[data-address-suggestions]');
    const list = host.querySelector('[role="listbox"]');
    const attribution = host.querySelector('[data-address-attribution]');
    const logo = attribution?.querySelector('img');
    assert(popup && list && attribution && logo);
    assert.equal(popup.hidden, !visible);
    assert.equal(list.hidden, !visible);
    assert.equal(list.parentElement, popup);
    assert.equal(attribution.parentElement, popup);
    assert.equal(list.contains(logo), false);
    assert.equal(list.querySelector('img'), null);
    assert.equal(logo.alt, 'Google Maps');
    assert.equal(logo.getAttribute('translate'), 'no');
    assert.equal(logo.width, 98);
    assert.equal(logo.height, 18);
    assert.equal(logo.style.width, '98px');
    assert.equal(logo.style.height, '18px');
    assert.equal(attribution.style.paddingTop, '10px');
    assert.equal(attribution.style.paddingRight, '10px');
    assert.equal(attribution.style.paddingBottom, '5px');
    assert.equal(attribution.style.paddingLeft, '10px');
    assert(
        ['#fff', '#ffffff', 'rgb(255,255,255)'].includes(
            attribution.style.backgroundColor.replaceAll(' ', '')
        )
    );
    assert.equal(popup.style.borderWidth, '1px');
    assert.equal(popup.style.borderStyle, 'solid');
    const source = logo.getAttribute('src');
    assert(source?.startsWith('data:image/png;base64,'));
    const bytes = Buffer.from(source.split(',')[1], 'base64');
    assert.equal(bytes.length, 2600);
    assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        'f542cdc1844d0e1a848455dffdc46a5cd618528576a4dba47bc4a096bfa4f60c'
    );
    return { popup, list };
};
const assertHighlight = (window, input, list, index, ordinary) => {
    const options = [...list.children];
    for (const [optionIndex, option] of options.entries()) {
        assert.equal(option.getAttribute('role'), 'option');
        const selected = optionIndex === index;
        assert.equal(option.getAttribute('aria-selected'), String(selected));
        if (selected) {
            assert.notEqual(option.style.backgroundColor, ordinary.background);
            assert.notEqual(option.style.color, ordinary.color);
            assert.equal(option.style.outlineWidth, '2px');
            assert.equal(option.style.outlineStyle, 'solid');
            assert.notEqual(option.style.outlineColor, 'transparent');
        } else {
            assert.equal(option.style.backgroundColor, ordinary.background);
            assert.equal(option.style.color, ordinary.color);
            assert.equal(option.style.outlineColor, 'transparent');
        }
    }
    assert.equal(
        input.getAttribute('aria-activedescendant'),
        options[index].id
    );
    assert.equal(window.document.activeElement, input);
};

/** Execute the actual shipped fence against the exact installed UI package. */
export async function checkAddressAutocompleteRecipe({
    consumerDirectory,
    guideSources,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(join(consumer, 'package.json'));
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    assert(
        realpathSync(require.resolve('@miniextensions/sdk/ui')).startsWith(
            `${installed}/dist/`
        )
    );
    const matches = guideSources
        .map((name) => join(consumer, name))
        .filter((path) =>
            readFileSync(path, 'utf8').includes(
                'export function mountAddressAutocomplete('
            )
        );
    assert.equal(
        matches.length,
        1,
        'Expected one actual shipped address recipe'
    );
    const { code } = await transform(readFileSync(matches[0], 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${matches[0]}.address.mjs`;
    writeFileSync(compiled, code);
    const { mountAddressAutocomplete } = await import(
        pathToFileURL(compiled).href
    );
    const { Window } = await import(pathToFileURL(happyDomModulePath).href);
    const window = new Window({ url: 'https://address.example.test' });
    let mounted;
    try {
        const host = window.document.createElement('div');
        window.document.body.append(host);
        let current = true;
        let queries = 0;
        let detailCalls = 0;
        const detail = deferred();
        const changes = [];
        mounted = mountAddressAutocomplete(host, {
            label: 'Address',
            value: 'Loaded value remains whole',
            characterLimit: 5,
            input: {
                extensionAccessToken: 'access_recipe',
                fieldId: 'fld_address',
            },
            isCurrent: () => current,
            onChange: (value) => changes.push(value),
            reads: {
                listPredictions: async (request) => {
                    queries++;
                    assert.equal(request.addressFieldValue, 'Manua');
                    return [
                        {
                            description: 'Selected address',
                            placeId: 'place_recipe',
                        },
                        {
                            description: '<img src=x> second address',
                            placeId: 'place_other',
                        },
                    ];
                },
                getFormattedAddress: async (request) => {
                    detailCalls++;
                    assert.equal(request.placeId, 'place_recipe');
                    return detail.promise;
                },
            },
        });
        const control = mounted.control;
        assertAttribution(host, false);
        assert.equal(control.getValue(), 'Loaded value remains whole');
        assert.equal(changes.length, 0);
        input(window, control.input, 'Manual address');
        assert.equal(control.getValue(), 'Manua');
        await debounce();
        await waitFor(() => host.querySelector('[role="option"]') !== null);
        assert.equal(queries, 1);
        const { list } = assertAttribution(host, true);
        assert.equal(list.children.length, 2);
        const ordinary = {
            background: list.children[0].style.backgroundColor,
            color: list.children[0].style.color,
        };
        control.input.focus();
        key(window, control.input, 'ArrowDown');
        assertHighlight(window, control.input, list, 0, ordinary);
        key(window, control.input, 'ArrowDown');
        assertHighlight(window, control.input, list, 1, ordinary);
        key(window, control.input, 'ArrowUp');
        assertHighlight(window, control.input, list, 0, ordinary);
        assert.equal(
            key(window, control.input, 'Enter').defaultPrevented,
            true
        );
        assert.equal(control.getValue(), 'Selec');
        assertAttribution(host, false);
        assert.equal(list.children.length, 0);
        assert.equal(detailCalls, 1);
        detail.resolve('Formatted address');
        await settle();
        assert.equal(control.getValue(), 'Forma');
        assert.deepEqual(changes, ['Manua', 'Selec', 'Forma']);
        control.setValue('Restored whole value');
        assert.equal(control.getValue(), 'Restored whole value');
        assert.equal(changes.length, 3);
        input(window, control.input, 'Manual again');
        mounted.setActive(false);
        mounted.setActive(true);
        assertAttribution(host, false);
        await debounce();
        assert.equal(queries, 1);
        assert.equal(control.getValue(), 'Manua');
        current = false;
        input(window, control.input, 'Foreign edit');
        assert.equal(control.getValue(), 'Manua');
        mounted.dispose();
        mounted.dispose();
        assert.equal(host.children.length, 0);
        return { checks: 6 };
    } finally {
        mounted?.dispose();
        await window.happyDOM.close();
    }
}

/** Synthetic native dispatches through the actual installed, copied starter. */
export async function checkBrowserAddressExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(consumer, '.generated/address-main-checks.mjs');
    const bundled = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(bundled.metafile, consumer);
    const form = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    const title = form.payload.fieldIdsToSchemas.fld_title;
    title.miniExtConfig = {
        enableAddressAutocomplete: true,
        conditionalFields: {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'address-visible',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'checkbox',
                        idOrName: { type: 'id', id: 'fld_driver' },
                        value: true,
                    },
                },
            ],
        },
    };
    form.payload.fieldIdsInForm = ['fld_driver', 'fld_title'];
    form.payload.fieldIdsToSchemas = {
        fld_title: title,
        fld_driver: {
            fieldType: 'checkbox',
            airtableField: {
                id: 'fld_driver',
                name: 'Show address',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'checkbox',
                    options: { icon: 'check', color: 'greenBright' },
                },
            },
        },
    };
    form.payload.hasParentExtension = false;
    form.payload.formRecord = {
        type: 'create',
        data: {
            fld_driver: true,
            fld_title: 'Loaded address',
            fld_adjacent: ['Retained adjacent value'],
        },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    const predictions = [];
    const details = [];
    const saves = [];
    const save = deferred();
    const window = new Window({
        url: 'https://address.example.test',
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
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        fetch: async (request, init) => {
            const url = new URL(String(request));
            const route = url.searchParams.get('route') ?? url.pathname;
            if (route === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(form));
            if (route === 'saveForm') {
                saves.push(JSON.parse(String(init?.body)));
                return save.promise;
            }
            if (
                route === '/api/trpc/publicExtensions.autoCompleteAddressField'
            ) {
                const read = deferred();
                predictions.push(read);
                return read.promise;
            }
            if (
                route ===
                '/api/trpc/publicExtensions.getFormattedAddressFromPlaceId'
            ) {
                const read = deferred();
                read.signal = init?.signal;
                details.push(read);
                return read.promise;
            }
            throw new Error('Unexpected installed address fixture request.');
        },
    };
    const previous = Object.keys(globals).map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
    ]);
    Object.assign(globalThis, globals);
    try {
        await import(pathToFileURL(outfile).href);
        const document = window.document;
        document.getElementById('api-origin').value =
            'https://sdk.example.test';
        document.getElementById('share-id').value = 'share_example';
        document
            .getElementById('connection-form')
            .dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        const address = () =>
            document.querySelector('input[data-field-id="fld_title"]');
        await waitFor(
            () =>
                address() !== null &&
                document.getElementById('screen').inert === false
        );
        assert.equal(address().disabled, false);
        input(window, address(), 'Typed address');
        await debounce();
        await waitFor(() => predictions.length === 1);
        assert.equal(document.getElementById('screen').inert, false);
        predictions[0].resolve(
            response([
                {
                    description: 'Selected native address',
                    placeId: 'place_one',
                },
                {
                    description: 'Second native address',
                    placeId: 'place_two',
                },
            ])
        );
        await waitFor(() => document.querySelector('[role="option"]') !== null);
        const { list } = assertAttribution(document, true);
        assert.equal(list.children.length, 2);
        const ordinary = {
            background: list.children[0].style.backgroundColor,
            color: list.children[0].style.color,
        };
        address().focus();
        key(window, address(), 'ArrowDown');
        assertHighlight(window, address(), list, 0, ordinary);
        key(window, address(), 'ArrowDown');
        assertHighlight(window, address(), list, 1, ordinary);
        key(window, address(), 'ArrowUp');
        assertHighlight(window, address(), list, 0, ordinary);
        key(window, address(), 'Enter');
        assertAttribution(document, false);
        await waitFor(() => details.length === 1);
        assert.equal(address().value, 'Selected native address');
        assert.equal(saves.length, 0);
        address()
            .closest('form')
            .dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
        await waitFor(() => saves.length === 1);
        assert.equal(address().disabled, true);
        assertAttribution(document, false);
        assert.equal(
            saves[0].formRecord.data.fld_title,
            'Selected native address'
        );
        assert.deepEqual(saves[0].formRecord.data.fld_adjacent, [
            'Retained adjacent value',
        ]);
        assert.deepEqual(saves[0].formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(details[0].signal?.aborted, true);
        details[0].resolve(response('Stale after Save'));
        await settle();
        assert.equal(address().value, 'Selected native address');
        save.resolve(saveError());
        await waitFor(() => document.getElementById('screen').inert === false);
        assert.equal(address().disabled, false);
        input(window, address(), 'Pending before hide');
        await debounce();
        await waitFor(() => predictions.length === 2);
        const driver = document.querySelector(
            'input[data-field-id="fld_driver"]'
        );
        driver.checked = false;
        driver.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(address().disabled, true);
        assert.ok(address().closest('[hidden]'));
        assertAttribution(document, false);
        driver.checked = true;
        driver.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(address().disabled, false);
        predictions[1].resolve(
            response([{ description: 'Stale after reveal', placeId: 'stale' }])
        );
        await settle();
        assert.equal(document.querySelector('[role="option"]'), null);
        assertAttribution(document, false);
        assert.equal(address().value, 'Pending before hide');
        const visitor = document.getElementById('visitor');
        visitor.value = 'B';
        visitor.dispatchEvent(new window.Event('change', { bubbles: true }));
        visitor.value = 'A';
        visitor.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(address().disabled, false);
        assert.equal(address().value, 'Pending before hide');
        assert.equal(predictions.length, 2);
        click(document.getElementById('screen'), 'Discard draft');
        assert.equal(address().disabled, false);
        assert.equal(address().value, 'Loaded address');
        assert.equal(saves.length, 1);
        input(window, address(), 'Discarded owner pending');
        document.getElementById('disconnect').click();
        await debounce();
        assert.equal(predictions.length, 2);
        assert.equal(document.querySelector('[role="option"]'), null);
        assert.equal(
            document.querySelector('[data-address-suggestions]'),
            null
        );
        return { checks: 6 };
    } finally {
        for (const pending of predictions) pending.resolve(response([]));
        for (const pending of details) pending.resolve(response('Late'));
        save.resolve(saveError());
        await settle();
        for (const [name, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, name);
            else Object.defineProperty(globalThis, name, descriptor);
        }
        await window.happyDOM.close();
    }
}
