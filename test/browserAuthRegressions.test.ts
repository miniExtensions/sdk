import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOwnedCompiler } from './ownedCompiler.js';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    DEFAULT_API_ORIGIN,
    type LoginPageResult,
    type RuntimeSession,
} from '../src/runtime/index.js';
import {
    deferred,
    loginPage,
    passwordPage,
    verificationSent,
} from './authFixtures.js';
import { loadedForm } from './formsFixtures.js';

// Exercise the actual browser example and optionally its installed SDK archive.
// All responses are synthetic; no external request is possible.
const root = resolve(process.cwd());
const compiler = createOwnedCompiler();
const packedRoot = process.env.SDK_REVIEW_PACKED_ROOT;
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-deep-review-auth-'));
    const entry = (name: string) =>
        packedRoot === undefined
            ? join(root, 'src', name, 'index.ts')
            : join(packedRoot, 'dist/esm', name, 'index.js');
    await compiler.build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': entry('auth'),
            '@miniextensions/sdk/ui': entry('ui'),
            '@miniextensions/sdk/forms': entry('forms'),
            '@miniextensions/sdk/portals': entry('portals'),
            '@miniextensions/sdk/formulas': entry('formulas'),
            '@miniextensions/sdk': entry('runtime'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
});
after(async () => {
    if (!compiler.canCleanup()) {
        throw new Error(
            'Cannot clean up while compiler children may still be running.'
        );
    }
    await rm(directory, { recursive: true, force: true });
});

const environment = async (
    test: TestContext,
    fetchImpl: typeof globalThis.fetch,
    initialApiOrigin?: string
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
    if (initialApiOrigin !== undefined) {
        const origin = window.document.getElementById('api-origin');
        assert.ok(origin instanceof window.HTMLInputElement);
        origin.value = initialApiOrigin;
    }
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        fetch: fetchImpl,
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
    return window;
};

const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
    });
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 60; turn++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.fail('Browser authentication action did not finish.');
};
const findButton = (window: Window, text: string) =>
    Array.from(window.document.querySelectorAll('button')).find(
        (node) => node.textContent?.trim() === text
    );
const submitForm = (window: Window, title: string) => {
    const button = findButton(window, title);
    assert.ok(button, `Missing button ${title}.`);
    const form = button.closest('form');
    assert.ok(form);
    form.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
};
const enterEmail = (window: Window, value: string) => {
    const form = findButton(window, 'Log in and use session')?.closest('form');
    const input = form?.querySelector('input');
    assert.ok(input instanceof window.HTMLInputElement);
    input.value = value;
};
const browserLoginPage = (): LoginPageResult => {
    const page = loginPage();
    page.payload.loginFieldNames = ['Email'];
    page.payload.loginFieldIds = ['field_email'];
    page.payload.prefillFieldNamesToValues = {};
    const schema: LoginPageResult['payload']['fieldNamesToSchemas'][string] = {
        fieldType: AirtableFieldType.EMAIL,
        airtableField: {
            id: 'field_email',
            name: 'Email',
            description: null,
            isComputed: false,
            isPrimaryField: true,
            config: { type: AirtableFieldType.EMAIL, options: null },
        },
    };
    page.payload.fieldNamesToSchemas = { Email: schema };
    page.payload.fieldIdsToSchemas = { field_email: schema };
    return page;
};
const browserIdle = (window: Window): boolean =>
    window.document.getElementById('screen')?.getAttribute('aria-busy') ===
    'false';
const connectBrowser = async (window: Window, page: LoginPageResult) => {
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    origin.value = 'https://sdk.example.test';
    share.value = page.payload.shareId;
    submitForm(window, 'Connect and load');
    await waitFor(
        () =>
            findButton(window, 'Log in and use session') !== undefined &&
            browserIdle(window)
    );
};
const codeControl = (window: Window) => {
    const form = findButton(window, 'Confirm and use session')?.closest('form');
    const code = form?.querySelector('input');
    assert.ok(form instanceof window.HTMLFormElement);
    assert.ok(code instanceof window.HTMLInputElement);
    return { form, code };
};

describe('browser API origin defaults', () => {
    for (const preset of [undefined, 'https://private-deployment.example']) {
        it(`prefills the public origin once and preserves ${preset === undefined ? 'a visitor override' : 'an installed input override'}`, async (test) => {
            const page = browserLoginPage();
            const origins: string[] = [];
            const window = await environment(
                test,
                async (url) => {
                    origins.push(new URL(String(url)).origin);
                    return jsonResponse(page);
                },
                preset
            );
            const origin = window.document.getElementById('api-origin');
            const share = window.document.getElementById('share-id');
            assert.ok(origin instanceof window.HTMLInputElement);
            assert.ok(share instanceof window.HTMLInputElement);
            assert.equal(origin.value, preset ?? DEFAULT_API_ORIGIN);
            assert.deepEqual(origins, []);
            share.value = page.payload.shareId;
            submitForm(window, 'Connect and load');
            await waitFor(() => origins.length === 1 && browserIdle(window));
            assert.deepEqual(origins, [preset ?? DEFAULT_API_ORIGIN]);
            origin.value = 'https://private-deployment.example/';
            submitForm(window, 'Connect and load');
            await waitFor(() => origins.length === 2 && browserIdle(window));
            assert.equal(origins[1], 'https://private-deployment.example');
            origin.value = '';
            const screen =
                window.document.getElementById('screen')!.firstElementChild;
            submitForm(window, 'Connect and load');
            assert.equal(origin.value, '');
            assert.equal(origins.length, 2);
            assert.equal(
                window.document.getElementById('screen')!.firstElementChild,
                screen
            );
            assert.match(
                window.document.getElementById('status')!.textContent!,
                /Connection settings are invalid/
            );
        });
    }
});

describe(
    'deep review browser authentication ownership',
    { concurrency: false },
    () => {
        for (const remember of [false, true]) {
            it(`continues an explicit login with one authenticated load (remember=${remember})`, async (test) => {
                const page = browserLoginPage();
                const accepted = loadedForm();
                accepted.extensionId = page.extensionId;
                const calls: { route: string; session: RuntimeSession }[] = [];
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    )!;
                    const body = JSON.parse(String(init?.body));
                    calls.push({ route, session: body.miniExtStorageV4 });
                    assert.equal(init?.credentials, 'omit');
                    if (route === 'loginIntoExtensionUsingLoginPageExtension') {
                        assert.deepEqual(body.loginCredentials, {
                            Email: 'pilot@example.test',
                        });
                        return jsonResponse({
                            type: 'found-record',
                            encryptedLoginToken: 'SYNTHETIC_CONTINUE',
                        });
                    }
                    assert.equal(route, 'fetchExtensionForEndUser');
                    return jsonResponse(
                        Object.values(body.miniExtStorageV4).includes(
                            'SYNTHETIC_CONTINUE'
                        )
                            ? accepted
                            : page
                    );
                });
                browserInput(window, 'remember-session').checked = remember;
                await connectBrowser(window, page);
                enterEmail(window, 'pilot@example.test');
                submitForm(window, 'Log in and use session');
                await waitFor(
                    () =>
                        calls.length === 3 &&
                        browserIdle(window) &&
                        window.document
                            .getElementById('status')!
                            .textContent!.includes('Loaded form')
                );
                assert.deepEqual(
                    calls.map(({ route }) => route),
                    [
                        'fetchExtensionForEndUser',
                        'loginIntoExtensionUsingLoginPageExtension',
                        'fetchExtensionForEndUser',
                    ]
                );
                assert.deepEqual(calls[0].session, {});
                assert.deepEqual(Object.values(calls[2].session), [
                    'SYNTHETIC_CONTINUE',
                ]);
                assert.equal(
                    findButton(window, 'Log in and use session'),
                    undefined
                );
                assert.match(
                    window.document.getElementById('session-summary')!
                        .textContent!,
                    /Authenticated/
                );
                assert.equal(window.sessionStorage.length, remember ? 1 : 0);
            });

            it(`retries a failed post-login load without replaying authentication (remember=${remember})`, async (test) => {
                const page = browserLoginPage();
                const accepted = loadedForm();
                accepted.extensionId = page.extensionId;
                const sessions: RuntimeSession[] = [];
                let logins = 0;
                let failLoad = true;
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    );
                    const body = JSON.parse(String(init?.body));
                    if (route === 'loginIntoExtensionUsingLoginPageExtension') {
                        logins++;
                        return jsonResponse({
                            type: 'found-record',
                            encryptedLoginToken: 'SYNTHETIC_READ_RETRY',
                        });
                    }
                    assert.equal(route, 'fetchExtensionForEndUser');
                    sessions.push(body.miniExtStorageV4);
                    if (Object.keys(body.miniExtStorageV4).length === 0)
                        return jsonResponse(page);
                    if (failLoad)
                        throw new Error('Synthetic authenticated read failed');
                    return jsonResponse(accepted);
                });
                browserInput(window, 'remember-session').checked = remember;
                await connectBrowser(window, page);
                enterEmail(window, 'pilot@example.test');
                submitForm(window, 'Log in and use session');
                await waitFor(
                    () =>
                        sessions.length === 2 &&
                        browserIdle(window) &&
                        window.document
                            .getElementById('status')!
                            .classList.contains('error')
                );
                assert.equal(logins, 1);
                assert.match(
                    window.document.getElementById('session-summary')!
                        .textContent!,
                    /Authenticated/
                );
                assert.equal(
                    findButton(window, 'Log in and use session'),
                    undefined
                );
                assert.equal(window.sessionStorage.length, remember ? 1 : 0);
                failLoad = false;
                clickById(window, 'reload');
                await waitFor(
                    () =>
                        sessions.length === 3 &&
                        browserIdle(window) &&
                        window.document
                            .getElementById('status')!
                            .textContent!.includes('Loaded form')
                );
                assert.equal(logins, 1);
                assert.deepEqual(sessions[1], sessions[2]);
                assert.deepEqual(Object.values(sessions[2]), [
                    'SYNTHETIC_READ_RETRY',
                ]);
            });
        }

        it('does not continue loading when explicit login finds no record', async (test) => {
            const page = browserLoginPage();
            const routes: string[] = [];
            const window = await environment(test, async (url) => {
                const route = new URL(String(url)).searchParams.get('route')!;
                routes.push(route);
                return jsonResponse(
                    route === 'fetchExtensionForEndUser'
                        ? page
                        : { type: 'no-record' }
                );
            });
            await connectBrowser(window, page);
            enterEmail(window, 'missing@example.test');
            submitForm(window, 'Log in and use session');
            await waitFor(() => browserIdle(window));
            assert.deepEqual(routes, [
                'fetchExtensionForEndUser',
                'loginIntoExtensionUsingLoginPageExtension',
            ]);
            assert.ok(findButton(window, 'Log in and use session'));
            assert.match(
                window.document.getElementById('status')!.textContent!,
                /No matching login record/
            );
        });

        for (const resultType of ['correct', 'wrong'] as const) {
            it(`continues only a successful explicit password submission (${resultType})`, async (test) => {
                const page = passwordPage();
                const accepted = loadedForm();
                accepted.extensionId = page.extensionId;
                const routes: string[] = [];
                const sessions: RuntimeSession[] = [];
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    )!;
                    const body = JSON.parse(String(init?.body));
                    routes.push(route);
                    if (route === 'verifyExtensionPassword') {
                        assert.equal(body.extensionPassword, 'Exact Password');
                        return jsonResponse(
                            resultType === 'correct'
                                ? {
                                      type: 'correct',
                                      encryptedExtensionPassword:
                                          'SYNTHETIC_PASSWORD_CONTINUE',
                                  }
                                : { type: 'wrong' }
                        );
                    }
                    assert.equal(route, 'fetchExtensionForEndUser');
                    sessions.push(body.miniExtStorageV4);
                    return jsonResponse(
                        Object.keys(body.miniExtStorageV4).length === 0
                            ? page
                            : accepted
                    );
                });
                browserInput(window, 'api-origin').value =
                    'https://sdk.example.test';
                browserInput(window, 'share-id').value =
                    browserLoginPage().payload.shareId;
                submitForm(window, 'Connect and load');
                await waitFor(() => browserIdle(window));
                const password = findButton(window, 'Verify and use password')!
                    .closest('form')!
                    .querySelector('input')!;
                password.value = 'Exact Password';
                submitForm(window, 'Verify and use password');
                await waitFor(() => browserIdle(window));
                assert.deepEqual(routes, [
                    'fetchExtensionForEndUser',
                    'verifyExtensionPassword',
                    ...(resultType === 'correct'
                        ? ['fetchExtensionForEndUser']
                        : []),
                ]);
                if (resultType === 'correct') {
                    assert.deepEqual(Object.values(sessions[1]), [
                        'SYNTHETIC_PASSWORD_CONTINUE',
                    ]);
                    assert.match(
                        window.document.getElementById('status')!.textContent!,
                        /Loaded form/
                    );
                } else {
                    assert.equal(sessions.length, 1);
                    assert.match(
                        window.document.getElementById('status')!.textContent!,
                        /Incorrect password/
                    );
                }
            });
        }

        for (const action of ['cancel', 'visitor switch'] as const) {
            it(`rejects a late post-login load after ${action}`, async (test) => {
                const page = browserLoginPage();
                const accepted = loadedForm();
                accepted.extensionId = page.extensionId;
                const held = deferred<Response>();
                const sessions: RuntimeSession[] = [];
                let logins = 0;
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    );
                    const body = JSON.parse(String(init?.body));
                    if (route === 'loginIntoExtensionUsingLoginPageExtension') {
                        logins++;
                        return jsonResponse({
                            type: 'found-record',
                            encryptedLoginToken: 'SYNTHETIC_HELD_LOAD',
                        });
                    }
                    assert.equal(route, 'fetchExtensionForEndUser');
                    sessions.push(body.miniExtStorageV4);
                    return Object.keys(body.miniExtStorageV4).length > 0
                        ? held.promise
                        : jsonResponse(page);
                });
                await connectBrowser(window, page);
                enterEmail(window, 'pilot@example.test');
                submitForm(window, 'Log in and use session');
                await waitFor(() => sessions.length === 2);
                assert.equal(browserIdle(window), false);
                if (action === 'cancel') clickById(window, 'cancel');
                else {
                    const selector = window.document.getElementById('visitor');
                    assert.ok(selector instanceof window.HTMLSelectElement);
                    selector.value = 'B';
                    selector.dispatchEvent(new window.Event('change'));
                }
                held.resolve(jsonResponse(accepted));
                await new Promise<void>((resolve) => setImmediate(resolve));
                assert.equal(logins, 1);
                assert.equal(sessions.length, 2);
                assert.equal(browserIdle(window), true);
                assert.equal(
                    Array.from(
                        window.document.querySelectorAll(
                            '#screen input[data-field-id="fld_title"]'
                        )
                    ).some(
                        (node) =>
                            node instanceof window.HTMLInputElement &&
                            node.value === 'Initial title'
                    ),
                    false
                );
                assert.doesNotMatch(
                    window.document.getElementById('status')!.textContent!,
                    /Loaded form/
                );
                if (action === 'visitor switch') {
                    clickById(window, 'reload');
                    await waitFor(
                        () => sessions.length === 3 && browserIdle(window)
                    );
                    assert.deepEqual(sessions[2], {});
                    assert.equal(logins, 1);
                }
            });
        }

        for (const [title, expected] of [
            ['Portal PIN', 'password'],
            ['Account password', 'password'],
            ['Shipping email', 'email'],
            ['Spinning class', 'email'],
        ] as const) {
            it(`uses the canonical visible login title ${title}`, async (test) => {
                const page = browserLoginPage();
                page.payload.fieldNamesToSchemas.Email.miniExtConfig = {
                    title,
                };
                const logins: Record<string, string>[] = [];
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    );
                    if (route === 'fetchExtensionForEndUser')
                        return jsonResponse(page);
                    assert.equal(
                        route,
                        'loginIntoExtensionUsingLoginPageExtension'
                    );
                    const body = JSON.parse(String(init?.body));
                    logins.push(body.loginCredentials);
                    return jsonResponse({ type: 'no-record' });
                });
                await connectBrowser(window, page);
                const input = findButton(window, 'Log in and use session')
                    ?.closest('form')
                    ?.querySelector('input');
                assert.ok(input instanceof window.HTMLInputElement);
                assert.equal(input.type, expected);
                input.value = 'Exact Case-Sensitive Credential';
                submitForm(window, 'Log in and use session');
                await waitFor(() => browserIdle(window));
                assert.deepEqual(logins, [
                    { Email: 'Exact Case-Sensitive Credential' },
                ]);
            });
        }

        for (const verificationType of ['email', 'phoneNumber'] as const) {
            it(`masks the configured ${verificationType} verification destination and still confirms`, async (test) => {
                const page = browserLoginPage();
                const accepted = loadedForm();
                accepted.extensionId = page.extensionId;
                const name = verificationType === 'email' ? 'Email' : 'Phone';
                if (verificationType === 'phoneNumber') {
                    const schema: LoginPageResult['payload']['fieldNamesToSchemas'][string] =
                        {
                            fieldType: AirtableFieldType.PHONE_NUMBER,
                            airtableField: {
                                id: 'fld_phone',
                                name,
                                description: null,
                                isComputed: false,
                                isPrimaryField: true,
                                config: {
                                    type: AirtableFieldType.PHONE_NUMBER,
                                    options: null,
                                },
                            },
                        };
                    page.payload.loginFieldNames = [name];
                    page.payload.loginFieldIds = ['fld_phone'];
                    page.payload.fieldNamesToSchemas = { [name]: schema };
                    page.payload.fieldIdsToSchemas = { fld_phone: schema };
                }
                page.payload.fieldNamesToSchemas[name].miniExtConfig = {
                    maskPasswordOnLoginScreen: true,
                    ...(verificationType === 'email'
                        ? { requireEmailVerificationToLogin: true }
                        : { requirePhoneNumberVerificationToLogin: true }),
                };
                const destination =
                    verificationType === 'email'
                        ? 'private@example.test'
                        : '+15550102030';
                const calls: {
                    route: string;
                    body: Record<string, unknown>;
                }[] = [];
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    )!;
                    const body = JSON.parse(String(init?.body));
                    calls.push({ route, body });
                    if (route === 'fetchExtensionForEndUser')
                        return jsonResponse(
                            Object.values(
                                body.miniExtStorageV4 as RuntimeSession
                            ).includes('synthetic_confirmed_token')
                                ? accepted
                                : page
                        );
                    if (route === 'loginIntoExtensionUsingLoginPageExtension')
                        return jsonResponse({
                            ...verificationSent(),
                            verificationType,
                            emailOrPhoneNumber: destination,
                        });
                    assert.equal(route, 'confirmVerificationCodeForLogin');
                    return jsonResponse({
                        encryptedLoginToken: 'synthetic_confirmed_token',
                    });
                });
                await connectBrowser(window, page);
                enterEmail(window, 'Exact Credential');
                submitForm(window, 'Log in and use session');
                await waitFor(
                    () =>
                        findButton(window, 'Confirm and use session') !==
                            undefined && browserIdle(window)
                );
                assert.match(
                    window.document.getElementById('status')!.textContent!,
                    /••••••••/
                );
                assert.equal(
                    window.document.body.textContent!.includes(destination),
                    false
                );
                const { form, code } = codeControl(window);
                code.value = '123456';
                form.dispatchEvent(
                    new window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await waitFor(() => browserIdle(window));
                assert.deepEqual(
                    calls.map(({ route }) => route),
                    [
                        'fetchExtensionForEndUser',
                        'loginIntoExtensionUsingLoginPageExtension',
                        'confirmVerificationCodeForLogin',
                        'fetchExtensionForEndUser',
                    ]
                );
                assert.deepEqual(calls[1].body.loginCredentials, {
                    [name]: 'Exact Credential',
                });
                assert.equal(
                    calls[2].body.verificationId,
                    'verification_example'
                );
                assert.equal(calls[2].body.verificationCode, '123456');
                assert.deepEqual(
                    Object.values(
                        calls[3].body.miniExtStorageV4 as RuntimeSession
                    ),
                    ['synthetic_confirmed_token']
                );
                assert.match(
                    window.document.getElementById('status')!.textContent!,
                    /Loaded form/
                );
            });
        }

        for (const fieldType of [
            AirtableFieldType.EMAIL,
            AirtableFieldType.SINGLE_LINE_TEXT,
        ] as const) {
            it(`masks a canonical ${fieldType} login field`, async (test) => {
                const page = loginPage();
                page.payload.loginFieldNames = ['Password'];
                page.payload.loginFieldIds = ['field_password'];
                page.payload.prefillFieldNamesToValues = {};
                const metadata = {
                    id: 'field_password',
                    name: 'Password',
                    description: null,
                    isComputed: false,
                    isPrimaryField: true,
                };
                const schema: LoginPageResult['payload']['fieldNamesToSchemas'][string] =
                    fieldType === AirtableFieldType.EMAIL
                        ? {
                              fieldType: AirtableFieldType.EMAIL,
                              airtableField: {
                                  ...metadata,
                                  config: {
                                      type: AirtableFieldType.EMAIL,
                                      options: null,
                                  },
                              },
                              miniExtConfig: {
                                  maskPasswordOnLoginScreen: true,
                              },
                          }
                        : {
                              fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
                              airtableField: {
                                  ...metadata,
                                  config: {
                                      type: AirtableFieldType.SINGLE_LINE_TEXT,
                                      options: null,
                                  },
                              },
                              miniExtConfig: {
                                  maskPasswordOnLoginScreen: true,
                              },
                          };
                page.payload.fieldNamesToSchemas = { Password: schema };
                page.payload.fieldIdsToSchemas = { field_password: schema };
                const window = await environment(test, async (url) => {
                    assert.equal(
                        new URL(String(url)).searchParams.get('route'),
                        'fetchExtensionForEndUser'
                    );
                    return jsonResponse(page);
                });
                const origin = window.document.getElementById('api-origin');
                const share = window.document.getElementById('share-id');
                assert.ok(origin instanceof window.HTMLInputElement);
                assert.ok(share instanceof window.HTMLInputElement);
                origin.value = 'https://sdk.example.test';
                share.value = page.payload.shareId;
                submitForm(window, 'Connect and load');
                await waitFor(
                    () =>
                        findButton(window, 'Log in and use session') !==
                            undefined && browserIdle(window)
                );
                const form = findButton(
                    window,
                    'Log in and use session'
                )?.closest('form');
                const input = form?.querySelector('input');
                assert.ok(input instanceof window.HTMLInputElement);
                test.diagnostic(
                    JSON.stringify({
                        sdk: packedRoot ?? 'source aliases',
                        fieldType,
                        canonicalMask: true,
                        actualInputType: input.type,
                    })
                );
                assert.equal(
                    input.type,
                    'password',
                    'Canonical maskPasswordOnLoginScreen must take priority over the Airtable field type.'
                );
                schema.miniExtConfig = {
                    maskPasswordOnLoginScreen: false,
                    title: 'Visitor credential',
                };
                const reload = window.document.getElementById('reload');
                assert.ok(reload instanceof window.HTMLButtonElement);
                reload.click();
                await waitFor(() => browserIdle(window));
                const ordinaryInput = findButton(
                    window,
                    'Log in and use session'
                )
                    ?.closest('form')
                    ?.querySelector('input');
                assert.ok(ordinaryInput instanceof window.HTMLInputElement);
                assert.equal(
                    ordinaryInput.type,
                    fieldType === AirtableFieldType.EMAIL ? 'email' : 'text'
                );
            });
        }

        for (const nextAttempt of [
            'login-no-record',
            'login-api-error',
            'sign-up',
        ] as const) {
            it(`retires account A's challenge before a different ${nextAttempt} attempt`, async (test) => {
                const page = loginPage();
                page.payload.loginFieldNames = ['Email'];
                page.payload.loginFieldIds = ['field_email'];
                page.payload.prefillFieldNamesToValues = {};
                const schema: LoginPageResult['payload']['fieldNamesToSchemas'][string] =
                    {
                        fieldType: AirtableFieldType.EMAIL,
                        airtableField: {
                            id: 'field_email',
                            name: 'Email',
                            description: null,
                            isComputed: false,
                            isPrimaryField: true,
                            config: {
                                type: AirtableFieldType.EMAIL,
                                options: null,
                            },
                        },
                    };
                page.payload.fieldNamesToSchemas = { Email: schema };
                page.payload.fieldIdsToSchemas = { field_email: schema };
                const confirmedIds: string[] = [];
                const loadedSessions: RuntimeSession[] = [];
                let logins = 0;
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    );
                    const body = JSON.parse(String(init?.body)) as {
                        miniExtStorageV4: RuntimeSession;
                        verificationId?: string;
                        loginCredentials?: Record<string, string>;
                        signUpCredentials?: Record<string, string>;
                    };
                    if (route === 'fetchExtensionForEndUser') {
                        loadedSessions.push(body.miniExtStorageV4);
                        return jsonResponse(page);
                    }
                    if (route === 'loginIntoExtensionUsingLoginPageExtension') {
                        logins += 1;
                        assert.equal(
                            body.loginCredentials?.Email,
                            logins === 1
                                ? 'account-a@example.test'
                                : 'account-b@example.test'
                        );
                        return jsonResponse(
                            logins === 1
                                ? verificationSent('verification_account_a')
                                : nextAttempt === 'login-api-error'
                                  ? {
                                        error: true,
                                        message: 'Account B login denied.',
                                    }
                                  : { type: 'no-record' }
                        );
                    }
                    if (route === 'signUpForLoginPageExtension') {
                        assert.equal(
                            body.signUpCredentials?.Email,
                            'account-b@example.test'
                        );
                        return jsonResponse({ ok: true });
                    }
                    if (route === 'confirmVerificationCodeForLogin') {
                        confirmedIds.push(body.verificationId!);
                        return jsonResponse({
                            encryptedLoginToken: 'encrypted_account_a',
                        });
                    }
                    throw new Error(`Unexpected synthetic route ${route}.`);
                });
                const origin = window.document.getElementById('api-origin');
                const share = window.document.getElementById('share-id');
                assert.ok(origin instanceof window.HTMLInputElement);
                assert.ok(share instanceof window.HTMLInputElement);
                origin.value = 'https://sdk.example.test';
                share.value = page.payload.shareId;
                submitForm(window, 'Connect and load');
                const status = window.document.getElementById('status');
                const idle = () =>
                    findButton(window, 'Log in and use session') !==
                        undefined && browserIdle(window);
                await waitFor(() => loadedSessions.length === 1 && idle());
                enterEmail(window, 'account-a@example.test');
                submitForm(window, 'Log in and use session');
                await waitFor(
                    () =>
                        findButton(window, 'Confirm and use session') !==
                            undefined && idle()
                );
                const oldControl = codeControl(window);
                oldControl.code.value = 'abandoned_code';
                enterEmail(window, 'account-b@example.test');
                if (nextAttempt === 'sign-up')
                    findButton(window, 'Sign up')!.click();
                else submitForm(window, 'Log in and use session');
                assert.equal(oldControl.code.value, '');
                assert.equal(oldControl.form.isConnected, false);
                await waitFor(
                    () =>
                        idle() &&
                        (nextAttempt === 'sign-up'
                            ? status?.textContent?.includes(
                                  'Sign-up accepted.'
                              ) === true
                            : nextAttempt === 'login-api-error'
                              ? status?.textContent?.includes(
                                    'The request failed.'
                                ) === true
                              : status?.textContent?.includes(
                                    'No matching login record'
                                ) === true)
                );
                if (nextAttempt === 'login-api-error')
                    assert.equal(
                        status?.textContent?.includes(
                            'Account B login denied.'
                        ),
                        false
                    );
                oldControl.form.dispatchEvent(
                    new window.Event('submit', {
                        bubbles: true,
                        cancelable: true,
                    })
                );
                await waitFor(idle);
                // Exercise only a still-visible control, exactly as a visitor can.
                const staleConfirmation = findButton(
                    window,
                    'Confirm and use session'
                );
                if (staleConfirmation !== undefined) {
                    const code = staleConfirmation
                        .closest('form')
                        ?.querySelector('input');
                    assert.ok(code instanceof window.HTMLInputElement);
                    code.value = '111111';
                    submitForm(window, 'Confirm and use session');
                    await waitFor(
                        () =>
                            status?.textContent?.includes(
                                'Login applied to this visitor.'
                            ) === true
                    );
                }
                const reload = window.document.getElementById('reload');
                assert.ok(reload instanceof window.HTMLButtonElement);
                reload.click();
                await waitFor(() => loadedSessions.length === 2 && idle());
                test.diagnostic(
                    JSON.stringify({
                        sdk: packedRoot ?? 'source aliases',
                        nextAttempt,
                        confirmedIds,
                        sessionAfterReload: loadedSessions[1],
                    })
                );
                assert.deepEqual(
                    confirmedIds,
                    [],
                    'A new authentication attempt must retire the previous account challenge.'
                );
                assert.deepEqual(
                    loadedSessions[1],
                    {},
                    'The abandoned account A must not become this visitor session.'
                );
            });
        }

        it('keeps a current verification challenge usable after a wrong-code API rejection', async (test) => {
            const page = browserLoginPage();
            const confirmations: { id: string; code: string }[] = [];
            const loadedSessions: RuntimeSession[] = [];
            const window = await environment(test, async (url, init) => {
                const route = new URL(String(url)).searchParams.get('route');
                const body = JSON.parse(String(init?.body)) as {
                    miniExtStorageV4: RuntimeSession;
                    verificationId: string;
                    verificationCode: string;
                };
                if (route === 'fetchExtensionForEndUser') {
                    loadedSessions.push(body.miniExtStorageV4);
                    return jsonResponse(page);
                }
                if (route === 'loginIntoExtensionUsingLoginPageExtension')
                    return jsonResponse(
                        verificationSent('verification_account_a')
                    );
                if (route === 'confirmVerificationCodeForLogin') {
                    confirmations.push({
                        id: body.verificationId,
                        code: body.verificationCode,
                    });
                    return jsonResponse(
                        confirmations.length === 1
                            ? {
                                  error: true,
                                  message: 'Wrong verification code.',
                              }
                            : { encryptedLoginToken: 'encrypted_account_a' }
                    );
                }
                throw new Error(`Unexpected synthetic route ${route}.`);
            });
            await connectBrowser(window, page);
            enterEmail(window, 'account-a@example.test');
            submitForm(window, 'Log in and use session');
            await waitFor(
                () =>
                    findButton(window, 'Confirm and use session') !==
                        undefined && browserIdle(window)
            );
            const currentControl = codeControl(window);
            const status = window.document.getElementById('status');
            currentControl.code.value = 'wrong_code';
            submitForm(window, 'Confirm and use session');
            assert.equal(currentControl.code.value, '');
            await waitFor(
                () =>
                    status?.textContent?.includes('The request failed.') ===
                        true && browserIdle(window)
            );
            assert.equal(
                status?.textContent?.includes('Wrong verification code.'),
                false
            );
            assert.equal(currentControl.form.isConnected, true);
            assert.equal(loadedSessions.length, 1);
            currentControl.code.value = 'correct_code';
            submitForm(window, 'Confirm and use session');
            await waitFor(
                () =>
                    status?.textContent?.includes(
                        'Login applied to this visitor.'
                    ) === true && browserIdle(window)
            );
            assert.deepEqual(confirmations, [
                { id: 'verification_account_a', code: 'wrong_code' },
                { id: 'verification_account_a', code: 'correct_code' },
            ]);
            assert.equal(loadedSessions.length, 2);
            assert.deepEqual(Object.values(loadedSessions[1]), [
                'encrypted_account_a',
            ]);
        });

        it('retires A before a pending login B and confirms only the replacement challenge', async (test) => {
            const page = browserLoginPage();
            const nextLogin = deferred<Response>();
            const confirmedIds: string[] = [];
            const loadedSessions: RuntimeSession[] = [];
            let logins = 0;
            const window = await environment(test, async (url, init) => {
                const route = new URL(String(url)).searchParams.get('route');
                const body = JSON.parse(String(init?.body)) as {
                    miniExtStorageV4: RuntimeSession;
                    verificationId: string;
                };
                if (route === 'fetchExtensionForEndUser') {
                    loadedSessions.push(body.miniExtStorageV4);
                    return jsonResponse(page);
                }
                if (route === 'loginIntoExtensionUsingLoginPageExtension') {
                    logins += 1;
                    return logins === 1
                        ? jsonResponse(
                              verificationSent('verification_account_a')
                          )
                        : nextLogin.promise;
                }
                if (route === 'confirmVerificationCodeForLogin') {
                    confirmedIds.push(body.verificationId);
                    return jsonResponse({
                        encryptedLoginToken: 'encrypted_account_b',
                    });
                }
                throw new Error(`Unexpected synthetic route ${route}.`);
            });
            await connectBrowser(window, page);
            enterEmail(window, 'account-a@example.test');
            submitForm(window, 'Log in and use session');
            await waitFor(
                () =>
                    findButton(window, 'Confirm and use session') !==
                        undefined && browserIdle(window)
            );
            const abandoned = codeControl(window);
            abandoned.code.value = 'abandoned_code';
            enterEmail(window, 'account-b@example.test');
            submitForm(window, 'Log in and use session');
            assert.equal(abandoned.code.value, '');
            assert.equal(abandoned.form.isConnected, false);
            assert.equal(
                findButton(window, 'Confirm and use session'),
                undefined
            );
            nextLogin.resolve(
                jsonResponse(verificationSent('verification_account_b'))
            );
            await waitFor(
                () =>
                    findButton(window, 'Confirm and use session') !==
                        undefined && browserIdle(window)
            );
            abandoned.form.dispatchEvent(
                new window.Event('submit', { bubbles: true, cancelable: true })
            );
            await waitFor(() => browserIdle(window));
            assert.deepEqual(confirmedIds, []);
            const replacement = codeControl(window);
            assert.notEqual(replacement.form, abandoned.form);
            replacement.code.value = 'account_b_code';
            submitForm(window, 'Confirm and use session');
            const status = window.document.getElementById('status');
            await waitFor(
                () =>
                    status?.textContent?.includes(
                        'Login applied to this visitor.'
                    ) === true && browserIdle(window)
            );
            assert.deepEqual(confirmedIds, ['verification_account_b']);
            assert.equal(loadedSessions.length, 2);
            assert.deepEqual(Object.values(loadedSessions[1]), [
                'encrypted_account_b',
            ]);
        });
    }
);

describe('starter safe error presentation', { concurrency: false }, () => {
    const credential = 'SYNTHETIC_PRIVATE_CREDENTIAL_Ω';
    const privateCode = 'SYNTHETIC_PRIVATE_ERROR_CODE_🔒';
    const privateMessage = `The rejected credential was ${credential}.`;
    const assertRedacted = (window: Window) => {
        const status = window.document.getElementById('status');
        assert.ok(status);
        // An input intentionally retains its value. This oracle covers visible
        // text and error presentation, without claiming the DOM holds no secret.
        for (const value of [credential, privateCode]) {
            assert.equal(
                window.document.body.textContent!.includes(value),
                false,
                'Private error details must not enter visible starter text.'
            );
            assert.equal(
                status.outerHTML.includes(value),
                false,
                'Private error details must not enter status markup.'
            );
        }
        assert.equal(status.classList.contains('error'), true);
        assert.ok(status.textContent!.trim().length > 0);
        assert.equal(window.sessionStorage.length, 0);
        assert.equal(window.localStorage.length, 0);
    };

    for (const statusCode of [200, 401, 403, 429, 500]) {
        it(`redacts login error message/code at HTTP ${statusCode} and permits an explicit retry`, async (test) => {
            const page = browserLoginPage();
            page.payload.fieldNamesToSchemas.Email.miniExtConfig = {
                maskPasswordOnLoginScreen: true,
            };
            const routes: string[] = [];
            let loginAttempts = 0;
            const window = await environment(test, async (url, init) => {
                const target = new URL(String(url));
                assert.equal(target.origin, 'https://sdk.example.test');
                const route = target.searchParams.get('route')!;
                routes.push(route);
                if (route === 'fetchExtensionForEndUser')
                    return jsonResponse(page);
                assert.equal(
                    route,
                    'loginIntoExtensionUsingLoginPageExtension'
                );
                const body = JSON.parse(String(init?.body));
                loginAttempts++;
                assert.equal(
                    body.loginCredentials.Email ===
                        (loginAttempts === 1 ? credential : 'corrected-value'),
                    true,
                    'The real SDK must receive the intended native credential.'
                );
                if (loginAttempts > 1)
                    return jsonResponse({ type: 'no-record' });
                return new Response(
                    JSON.stringify({
                        ...(statusCode === 200 ? { error: true } : {}),
                        message: privateMessage,
                        code: privateCode,
                    }),
                    {
                        status: statusCode,
                        headers: { 'Content-Type': 'application/json' },
                    }
                );
            });
            await connectBrowser(window, page);
            enterEmail(window, credential);
            submitForm(window, 'Log in and use session');
            await waitFor(() => browserIdle(window));

            assertRedacted(window);
            if (statusCode >= 400)
                assert.equal(
                    window.document
                        .getElementById('status')!
                        .textContent!.includes(`HTTP ${statusCode}`),
                    true,
                    'A bounded HTTP status remains useful without server copy.'
                );
            const login = findButton(window, 'Log in and use session');
            assert.ok(login);
            assert.equal(login.disabled, false);
            assert.equal(loginAttempts, 1, 'A failure must not replay login.');
            enterEmail(window, 'corrected-value');
            submitForm(window, 'Log in and use session');
            await waitFor(() => browserIdle(window));
            assert.equal(
                window.document
                    .getElementById('status')!
                    .textContent!.includes('No matching login record'),
                true
            );
            assert.deepEqual(routes, [
                'fetchExtensionForEndUser',
                'loginIntoExtensionUsingLoginPageExtension',
                'loginIntoExtensionUsingLoginPageExtension',
            ]);
        });
    }

    for (const failure of ['SDK HTTP error', 'external abort error'] as const) {
        it(`redacts ${failure} on Reload while retaining read-only retry`, async (test) => {
            const page = browserLoginPage();
            let reads = 0;
            let failedSignal: AbortSignal | null | undefined;
            const window = await environment(test, async (url, init) => {
                const target = new URL(String(url));
                assert.equal(target.origin, 'https://sdk.example.test');
                assert.equal(
                    target.searchParams.get('route'),
                    'fetchExtensionForEndUser'
                );
                reads++;
                if (reads !== 2) return jsonResponse(page);
                failedSignal = init?.signal;
                if (failure === 'external abort error') {
                    // The runtime deliberately preserves an external AbortError.
                    // Its app-owned signal is still current, so run() must not
                    // publish that arbitrary Error.message as customer copy.
                    const error = new Error(privateMessage);
                    error.name = 'AbortError';
                    throw error;
                }
                return new Response(
                    JSON.stringify({
                        message: privateMessage,
                        code: privateCode,
                    }),
                    { status: 503 }
                );
            });
            await connectBrowser(window, page);
            const reload = window.document.getElementById('reload');
            assert.ok(reload instanceof window.HTMLButtonElement);
            reload.click();
            await waitFor(() => browserIdle(window));

            assertRedacted(window);
            assert.equal(failedSignal?.aborted, false);
            assert.equal(reload.disabled, false);
            assert.equal(reads, 2, 'A failed read must not retry itself.');
            reload.click();
            await waitFor(() => reads === 3 && browserIdle(window));
            assert.ok(findButton(window, 'Log in and use session'));
            assert.equal(
                window.document
                    .getElementById('status')!
                    .textContent!.includes('Loaded login page'),
                true
            );
        });
    }

    it('retains controlled wrong-password feedback and a deliberate corrected retry', async (test) => {
        const page = passwordPage();
        const accepted = loadedForm();
        accepted.extensionId = page.extensionId;
        const readSessions: RuntimeSession[] = [];
        let reads = 0;
        let verifications = 0;
        const window = await environment(test, async (url, init) => {
            const target = new URL(String(url));
            assert.equal(target.origin, 'https://sdk.example.test');
            const route = target.searchParams.get('route');
            if (route === 'fetchExtensionForEndUser') {
                const body = JSON.parse(String(init?.body));
                reads++;
                readSessions.push(body.miniExtStorageV4);
                return jsonResponse(
                    Object.values(body.miniExtStorageV4).includes(
                        'synthetic-password-token'
                    )
                        ? accepted
                        : page
                );
            }
            assert.equal(route, 'verifyExtensionPassword');
            const body = JSON.parse(String(init?.body));
            verifications++;
            assert.equal(
                body.extensionPassword ===
                    (verifications === 1 ? credential : 'corrected-password'),
                true
            );
            return jsonResponse(
                verifications === 1
                    ? { type: 'wrong' }
                    : {
                          type: 'correct',
                          encryptedExtensionPassword:
                              'synthetic-password-token',
                      }
            );
        });
        browserInput(window, 'api-origin').value = 'https://sdk.example.test';
        browserInput(window, 'share-id').value = 'share_example';
        submitForm(window, 'Connect and load');
        await waitFor(
            () =>
                findButton(window, 'Verify and use password') !== undefined &&
                browserIdle(window)
        );
        const verify = findButton(window, 'Verify and use password')!;
        const password = verify.closest('form')!.querySelector('input');
        assert.ok(password instanceof window.HTMLInputElement);
        password.value = credential;
        submitForm(window, 'Verify and use password');
        await waitFor(() => browserIdle(window));
        assert.equal(
            window.document.getElementById('status')!.textContent,
            'Incorrect password.'
        );
        assert.equal(verify.disabled, false);
        assert.equal(verifications, 1);
        assert.equal(reads, 1, 'A wrong password must not continue loading.');
        password.value = 'corrected-password';
        submitForm(window, 'Verify and use password');
        await waitFor(
            () =>
                reads === 2 &&
                browserIdle(window) &&
                window.document
                    .getElementById('status')!
                    .textContent!.includes('Loaded form')
        );
        assert.equal(verifications, 2);
        assert.equal(
            reads,
            2,
            'Successful password submission continues with exactly one authenticated read.'
        );
        assert.deepEqual(readSessions[0], {});
        assert.deepEqual(Object.values(readSessions[1]), [
            'synthetic-password-token',
        ]);
        assert.match(
            window.document.getElementById('status')!.textContent!,
            /Loaded form/
        );
        assert.equal(findButton(window, 'Verify and use password'), undefined);
        assert.ok(
            Array.from(window.document.querySelectorAll('#screen input')).some(
                (node) =>
                    node instanceof window.HTMLInputElement &&
                    node.value === 'Initial title'
            )
        );
        assert.equal(
            window.document
                .getElementById('session-summary')!
                .textContent!.includes('Authenticated session'),
            true
        );
        assert.equal(window.sessionStorage.length, 0);
    });
});

const restartBrowser = async (window: Window) => {
    const markup = await readFile(
        join(root, 'examples/browser/index.html'),
        'utf8'
    );
    window.document.body.innerHTML = markup
        .match(/<body>([\s\S]*?)<\/body>/)![1]
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
    );
};
const browserInput = (window: Window, id: string) => {
    const input = window.document.getElementById(id);
    assert.ok(input instanceof window.HTMLInputElement);
    return input;
};
const clickById = (window: Window, id: string) => {
    const button = window.document.getElementById(id);
    assert.ok(button instanceof window.HTMLButtonElement);
    button.click();
};
const beginRememberedConnection = (window: Window, page: LoginPageResult) => {
    browserInput(window, 'api-origin').value = 'https://sdk.example.test';
    browserInput(window, 'share-id').value = page.payload.shareId;
    browserInput(window, 'remember-session').checked = true;
    submitForm(window, 'Connect and load');
};

describe(
    'browser starter opt-in remembered sessions',
    { concurrency: false },
    () => {
        const setup = async (test: TestContext) => {
            const page = browserLoginPage();
            const accepted = loadedForm();
            accepted.extensionId = page.extensionId;
            const calls: RuntimeSession[] = [];
            const signals: (AbortSignal | null | undefined)[] = [];
            let mode: 'accepted' | 'revoked' | 'failure' | 'held' = 'accepted';
            const held = deferred<Response>();
            const window = await environment(test, async (url, init) => {
                const route = new URL(String(url)).searchParams.get('route');
                const body = JSON.parse(String(init?.body));
                if (route === 'loginIntoExtensionUsingLoginPageExtension')
                    return jsonResponse({
                        type: 'found-record',
                        encryptedLoginToken: 'SYNTHETIC_REMEMBERED',
                    });
                assert.equal(
                    route,
                    'fetchExtensionForEndUser',
                    'No mutation or unrelated read'
                );
                calls.push(body.miniExtStorageV4);
                signals.push(init?.signal);
                if (
                    !Object.values(body.miniExtStorageV4).includes(
                        'SYNTHETIC_REMEMBERED'
                    )
                )
                    return jsonResponse(page);
                if (mode === 'failure')
                    throw new Error('Synthetic validation transport failure');
                if (mode === 'held') return held.promise;
                return jsonResponse(mode === 'revoked' ? page : accepted);
            });
            beginRememberedConnection(window, page);
            await waitFor(() => browserIdle(window));
            enterEmail(window, 'pilot@example.test');
            submitForm(window, 'Log in and use session');
            await waitFor(() => browserIdle(window));
            assert.equal(calls.length, 2);
            assert.equal(window.sessionStorage.length, 1);
            const stored = window.sessionStorage.getItem(
                window.sessionStorage.key(0)!
            )!;
            assert.equal(stored.includes('pilot@example.test'), false);
            assert.equal(stored.includes('SYNTHETIC_REMEMBERED'), true);
            return {
                window,
                page,
                accepted,
                calls,
                signals,
                held,
                mode: (next: typeof mode) => {
                    mode = next;
                },
            };
        };

        it('does not remember by default, even after a successful login', async (test) => {
            const page = browserLoginPage();
            const window = await environment(test, async (url) =>
                jsonResponse(
                    new URL(String(url)).searchParams.get('route') ===
                        'fetchExtensionForEndUser'
                        ? page
                        : {
                              type: 'found-record',
                              encryptedLoginToken: 'SYNTHETIC_DEFAULT',
                          }
                )
            );
            await connectBrowser(window, page);
            assert.equal(
                browserInput(window, 'remember-session').checked,
                false
            );
            enterEmail(window, 'pilot@example.test');
            submitForm(window, 'Log in and use session');
            await waitFor(() => browserIdle(window));
            assert.equal(window.sessionStorage.length, 0);
            assert.equal(window.localStorage.length, 0);
        });

        it('refresh/reconnect validates the remembered credential before publishing a Form and logout forgets it', async (test) => {
            const f = await setup(test);
            await restartBrowser(f.window);
            f.mode('held');
            beginRememberedConnection(f.window, f.page);
            await waitFor(() => f.calls.length === 4);
            assert.equal(
                findButton(f.window, 'Log in and use session'),
                undefined
            );
            assert.doesNotMatch(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
            f.held.resolve(jsonResponse(f.accepted));
            await waitFor(() => browserIdle(f.window));
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /Loaded form/
            );
            assert.match(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
            clickById(f.window, 'logout');
            assert.equal(f.window.sessionStorage.length, 0);
            f.mode('accepted');
            clickById(f.window, 'reload');
            await waitFor(() => browserIdle(f.window));
            assert.deepEqual(f.calls.at(-1), {});
            assert.ok(findButton(f.window, 'Log in and use session'));
        });

        it('revoked remembered credentials return to login and remove only the rejected visitor entry', async (test) => {
            const f = await setup(test);
            f.window.sessionStorage.setItem('unrelated-app', 'retained');
            await restartBrowser(f.window);
            f.mode('revoked');
            beginRememberedConnection(f.window, f.page);
            await waitFor(() => browserIdle(f.window));
            assert.ok(findButton(f.window, 'Log in and use session'));
            assert.equal(f.window.sessionStorage.length, 1);
            assert.equal(
                f.window.sessionStorage.getItem('unrelated-app'),
                'retained'
            );
            assert.doesNotMatch(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
        });

        it('validation transport failure remains anonymous, retains the entry, and retries only on explicit action', async (test) => {
            const f = await setup(test);
            await restartBrowser(f.window);
            f.mode('failure');
            beginRememberedConnection(f.window, f.page);
            await waitFor(() => browserIdle(f.window));
            assert.ok(findButton(f.window, 'Retry session restoration'));
            assert.equal(
                findButton(f.window, 'Log in and use session'),
                undefined
            );
            assert.equal(f.window.sessionStorage.length, 1);
            assert.doesNotMatch(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
            assert.equal(f.calls.length, 4);
            f.mode('accepted');
            findButton(f.window, 'Retry session restoration')!.click();
            await waitFor(() => browserIdle(f.window));
            assert.equal(f.calls.length, 6);
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /Loaded form/
            );
        });

        it('cancelled validation cannot authenticate late and logout still forgets its retired remembered entry', async (test) => {
            const f = await setup(test);
            await restartBrowser(f.window);
            f.mode('held');
            beginRememberedConnection(f.window, f.page);
            await waitFor(() => f.calls.length === 4);
            clickById(f.window, 'cancel');
            f.held.resolve(jsonResponse(f.accepted));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.doesNotMatch(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
            clickById(f.window, 'logout');
            assert.equal(f.window.sessionStorage.length, 0);
        });

        it('a failed authenticated Reload retains the edited Form draft and does not dispatch a Save', async (test) => {
            const f = await setup(test);
            clickById(f.window, 'reload');
            await waitFor(() => browserIdle(f.window));
            const input = Array.from(
                f.window.document.querySelectorAll('#screen input')
            ).find(
                (node) =>
                    node instanceof f.window.HTMLInputElement &&
                    node.value === 'Initial title'
            );
            assert.ok(input instanceof f.window.HTMLInputElement);
            input.value = 'Unsaved draft survives';
            input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
            f.mode('failure');
            clickById(f.window, 'reload');
            await waitFor(() => browserIdle(f.window));
            assert.equal(input.isConnected, true);
            assert.equal(input.value, 'Unsaved draft survives');
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /failure|failed/i
            );
            assert.equal(f.window.sessionStorage.length, 1);
        });

        it('denied storage offers explicit login without claiming restoration or remembering', async (test) => {
            const page = browserLoginPage();
            const accepted = loadedForm();
            const calls: { route: string | null; session: RuntimeSession }[] =
                [];
            const window = await environment(test, async (url, init) => {
                const route = new URL(String(url)).searchParams.get('route');
                const body = JSON.parse(String(init?.body)) as {
                    miniExtStorageV4: RuntimeSession;
                };
                calls.push({ route, session: body.miniExtStorageV4 });
                if (route === 'fetchExtensionForEndUser')
                    return jsonResponse(
                        Object.values(body.miniExtStorageV4).includes(
                            'SYNTHETIC_MEMORY_ONLY'
                        )
                            ? accepted
                            : page
                    );
                if (route === 'loginIntoExtensionUsingLoginPageExtension')
                    return jsonResponse({
                        type: 'found-record',
                        encryptedLoginToken: 'SYNTHETIC_MEMORY_ONLY',
                    });
                throw new Error(`Unexpected synthetic route ${route}.`);
            });
            Object.defineProperty(window, 'sessionStorage', {
                configurable: true,
                get() {
                    throw new Error('Synthetic storage denial');
                },
            });
            beginRememberedConnection(window, page);
            await waitFor(() => browserIdle(window));
            assert.ok(findButton(window, 'Retry session restoration'));
            assert.equal(
                findButton(window, 'Log in and use session'),
                undefined
            );
            findButton(window, 'Continue with login')!.click();
            enterEmail(window, 'pilot@example.test');
            submitForm(window, 'Log in and use session');
            await waitFor(() => browserIdle(window));
            assert.match(
                window.document.getElementById('status')!.textContent!,
                /storage|remember/i
            );
            assert.match(
                window.document.getElementById('session-summary')!.textContent!,
                /Authenticated/
            );
            assert.match(
                window.document.getElementById('status')!.textContent!,
                /Loaded form loaded/
            );
            assert.deepEqual(
                calls.map((call) => call.route),
                [
                    'fetchExtensionForEndUser',
                    'loginIntoExtensionUsingLoginPageExtension',
                    'fetchExtensionForEndUser',
                ]
            );
            assert.deepEqual(Object.values(calls[2].session), [
                'SYNTHETIC_MEMORY_ONLY',
            ]);
            clickById(window, 'logout');
            assert.match(
                window.document.getElementById('status')!.textContent!,
                /could not be cleared/
            );
            assert.doesNotMatch(
                window.document.getElementById('session-summary')!.textContent!,
                /Authenticated/
            );
        });

        describe('reconnect settings preflight', () => {
            const storageBytes = (window: Window) =>
                Array.from(
                    { length: window.sessionStorage.length },
                    (_, index) => {
                        const key = window.sessionStorage.key(index)!;
                        return [key, window.sessionStorage.getItem(key)];
                    }
                ).sort();
            const titleInput = (window: Window) => {
                const input = window.document.querySelector(
                    '[data-field-id="fld_title"]'
                );
                assert.ok(input instanceof window.HTMLInputElement);
                return input;
            };
            const editTitle = (window: Window, value: string) => {
                const input = titleInput(window);
                input.value = value;
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
                return input;
            };
            const switchVisitor = (window: Window, identity: 'A' | 'B') => {
                const select = window.document.getElementById('visitor');
                assert.ok(select instanceof window.HTMLSelectElement);
                select.value = identity;
                select.dispatchEvent(
                    new window.Event('change', { bubbles: true })
                );
            };
            const retainedFeedback = (window: Window) => {
                const message =
                    window.document.getElementById('status')!.textContent!;
                assert.match(message, /connection settings.*invalid/i);
                assert.match(message, /retained|unchanged/i);
                assert.doesNotMatch(
                    message,
                    /SYNTHETIC_REMEMBERED|PRIVATE_INPUT/
                );
            };
            for (const candidate of [
                {
                    name: 'endpoint path',
                    origin: 'https://sdk.example.test/api/v1',
                    remember: false,
                },
                {
                    name: 'query',
                    origin: 'https://sdk.example.test/?PRIVATE_INPUT=1',
                    remember: false,
                },
                {
                    name: 'fragment',
                    origin: 'https://sdk.example.test/#PRIVATE_INPUT',
                    remember: false,
                },
                {
                    name: 'credentials',
                    origin: 'https://PRIVATE_INPUT:PRIVATE_INPUT@sdk.example.test',
                    remember: false,
                },
                {
                    name: 'non-HTTP scheme',
                    origin: 'ftp://sdk.example.test',
                    remember: false,
                },
                {
                    name: 'empty trimmed share ID',
                    origin: 'https://sdk.example.test',
                    shareId: '   ',
                    remember: false,
                },
                {
                    name: 'endpoint path with remembering retained',
                    origin: 'https://sdk.example.test/api/v1',
                    remember: true,
                },
            ]) {
                it(`rejects ${candidate.name} without changing current input, session or owned storage`, async (test) => {
                    const f = await setup(test);
                    const input = editTitle(
                        f.window,
                        'Keep this unsaved answer'
                    );
                    const fileInput =
                        f.window.document.querySelector('input[type="file"]');
                    assert.ok(fileInput instanceof f.window.HTMLInputElement);
                    const file = new f.window.File(
                        ['synthetic'],
                        'PRIVATE_INPUT.txt'
                    );
                    Object.defineProperty(fileInput, 'files', {
                        configurable: true,
                        value: [file],
                    });
                    fileInput.dispatchEvent(
                        new f.window.Event('change', { bubbles: true })
                    );
                    const bytes = storageBytes(f.window);
                    assert.equal(
                        bytes.length,
                        1,
                        'real starter-owned remembered credential'
                    );
                    const before = f.calls.length;
                    browserInput(f.window, 'api-origin').value =
                        candidate.origin;
                    browserInput(f.window, 'share-id').value =
                        candidate.shareId ?? f.page.payload.shareId;
                    browserInput(f.window, 'remember-session').checked =
                        candidate.remember;
                    submitForm(f.window, 'Connect and load');
                    assert.equal(
                        input.isConnected,
                        true,
                        'invalid settings must not render a replacement screen'
                    );
                    assert.equal(input.value, 'Keep this unsaved answer');
                    assert.equal(fileInput.isConnected, true);
                    assert.equal(fileInput.files?.[0], file);
                    assert.deepEqual(storageBytes(f.window), bytes);
                    assert.equal(
                        f.calls.length,
                        before,
                        'rejected settings perform no request'
                    );
                    assert.match(
                        f.window.document.getElementById('session-summary')!
                            .textContent!,
                        /Authenticated/
                    );
                    retainedFeedback(f.window);
                });
            }

            it("keeps both visitors' native drafts and authenticated owners after a rejected reconnect", async (test) => {
                const f = await setup(test);
                editTitle(f.window, 'Visitor A retained answer');
                switchVisitor(f.window, 'B');
                clickById(f.window, 'reload');
                await waitFor(() => browserIdle(f.window));
                enterEmail(f.window, 'synthetic-b@example.test');
                submitForm(f.window, 'Log in and use session');
                await waitFor(() => browserIdle(f.window));
                editTitle(f.window, 'Visitor B retained answer');
                switchVisitor(f.window, 'A');
                const input = titleInput(f.window);
                const before = f.calls.length;
                const bytes = storageBytes(f.window);
                assert.equal(bytes.length, 2);
                browserInput(f.window, 'api-origin').value =
                    'https://sdk.example.test/api/v1';
                browserInput(f.window, 'remember-session').checked = false;
                submitForm(f.window, 'Connect and load');
                assert.equal(input.isConnected, true);
                assert.equal(input.value, 'Visitor A retained answer');
                switchVisitor(f.window, 'B');
                assert.equal(
                    titleInput(f.window).value,
                    'Visitor B retained answer'
                );
                assert.match(
                    f.window.document.getElementById('session-summary')!
                        .textContent!,
                    /Authenticated/
                );
                switchVisitor(f.window, 'A');
                assert.equal(
                    titleInput(f.window).value,
                    'Visitor A retained answer'
                );
                assert.deepEqual(storageBytes(f.window), bytes);
                assert.equal(f.calls.length, before);
                f.mode('failure');
                clickById(f.window, 'reload');
                await waitFor(() => browserIdle(f.window));
                assert.deepEqual(
                    f.calls.at(-1),
                    f.calls[1],
                    'original authenticated client remains usable'
                );
                assert.equal(
                    titleInput(f.window).value,
                    'Visitor A retained answer'
                );
            });

            it('does not abort an existing request when retained Connect dispatch rejects settings', async (test) => {
                const f = await setup(test);
                f.mode('held');
                clickById(f.window, 'reload');
                await waitFor(() => f.calls.length === 3);
                const signal = f.signals.at(-1);
                assert.ok(signal);
                assert.equal(signal.aborted, false);
                browserInput(f.window, 'api-origin').value =
                    'https://sdk.example.test/api/v1';
                browserInput(f.window, 'remember-session').checked = false;
                submitForm(f.window, 'Connect and load');
                assert.equal(signal.aborted, false);
                assert.equal(f.calls.length, 3);
                f.held.resolve(jsonResponse(f.accepted));
                await waitFor(() => browserIdle(f.window));
                assert.match(
                    f.window.document.getElementById('status')!.textContent!,
                    /Loaded form/
                );
                assert.match(
                    f.window.document.getElementById('session-summary')!
                        .textContent!,
                    /Authenticated/
                );
            });

            it('validates all local settings reads before storage cleanup or owner retirement', async (test) => {
                const f = await setup(test);
                const input = editTitle(
                    f.window,
                    'Keep answers on a local settings failure'
                );
                const bytes = storageBytes(f.window);
                const before = f.calls.length;
                browserInput(f.window, 'remember-session').checked = false;
                const descriptor = Object.getOwnPropertyDescriptor(
                    Intl,
                    'DateTimeFormat'
                )!;
                try {
                    Object.defineProperty(Intl, 'DateTimeFormat', {
                        configurable: true,
                        value() {
                            throw new Error('PRIVATE_INPUT timezone failure');
                        },
                    });
                    submitForm(f.window, 'Connect and load');
                } finally {
                    Object.defineProperty(Intl, 'DateTimeFormat', descriptor);
                }
                assert.equal(input.isConnected, true);
                assert.equal(
                    input.value,
                    'Keep answers on a local settings failure'
                );
                assert.deepEqual(storageBytes(f.window), bytes);
                assert.equal(f.calls.length, before);
                retainedFeedback(f.window);
            });

            for (const invalid of ['origin', 'share'] as const)
                it(`keeps an initial invalid ${invalid} disconnected without a request`, async (test) => {
                    let calls = 0;
                    const window = await environment(test, async () => {
                        calls++;
                        throw new Error('No request permitted');
                    });
                    browserInput(window, 'api-origin').value =
                        invalid === 'origin'
                            ? 'https://sdk.example.test/api/v1'
                            : 'https://sdk.example.test';
                    browserInput(window, 'share-id').value =
                        invalid === 'share' ? '   ' : 'share_synthetic';
                    submitForm(window, 'Connect and load');
                    assert.equal(calls, 0);
                    assert.equal(window.sessionStorage.length, 0);
                    assert.equal(
                        window.document.querySelector('#screen form'),
                        null
                    );
                    assert.match(
                        window.document.getElementById('session-summary')!
                            .textContent!,
                        /Not connected/
                    );
                    retainedFeedback(window);
                });

            it('still commits a valid reconnect with fresh separate visitors and explicit remembering opt-out', async (test) => {
                const f = await setup(test);
                const old = editTitle(
                    f.window,
                    'Explicitly replaced connection answer'
                );
                const before = f.calls.length;
                browserInput(f.window, 'api-origin').value =
                    'https://sdk.example.test/';
                browserInput(f.window, 'remember-session').checked = false;
                submitForm(f.window, 'Connect and load');
                await waitFor(() => browserIdle(f.window));
                assert.equal(f.calls.length, before + 1);
                assert.deepEqual(f.calls.at(-1), {});
                assert.equal(old.isConnected, false);
                assert.equal(f.window.sessionStorage.length, 0);
                enterEmail(f.window, 'synthetic-a@example.test');
                submitForm(f.window, 'Log in and use session');
                await waitFor(() => browserIdle(f.window));
                assert.equal(titleInput(f.window).value, 'Initial title');
                switchVisitor(f.window, 'B');
                clickById(f.window, 'reload');
                await waitFor(() => browserIdle(f.window));
                assert.deepEqual(
                    f.calls.at(-1),
                    {},
                    'A login must not authenticate the new B client'
                );
                assert.ok(findButton(f.window, 'Log in and use session'));
            });
        });

        it('refused opt-out preserves the current Form draft and connection when storage cannot be cleared', async (test) => {
            const f = await setup(test);
            clickById(f.window, 'reload');
            await waitFor(() => browserIdle(f.window));
            const input = Array.from(
                f.window.document.querySelectorAll('#screen input')
            ).find(
                (node) =>
                    node instanceof f.window.HTMLInputElement &&
                    node.value === 'Initial title'
            );
            assert.ok(input instanceof f.window.HTMLInputElement);
            input.value = 'Keep this draft';
            input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
            const count = f.calls.length;
            Object.defineProperty(f.window.sessionStorage, 'removeItem', {
                configurable: true,
                value() {
                    throw new Error('Synthetic storage removal denial');
                },
            });
            browserInput(f.window, 'remember-session').checked = false;
            submitForm(f.window, 'Connect and load');
            assert.equal(f.calls.length, count);
            assert.equal(input.isConnected, true);
            assert.equal(input.value, 'Keep this draft');
            assert.equal(f.window.sessionStorage.length, 1);
            assert.match(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /drafts are retained/
            );
        });

        it('logout with readable but unremovable storage cannot restore the old identity on Reload', async (test) => {
            const f = await setup(test);
            Object.defineProperty(f.window.sessionStorage, 'removeItem', {
                configurable: true,
                value() {
                    throw new Error('Synthetic removal denial');
                },
            });
            clickById(f.window, 'logout');
            assert.equal(f.window.sessionStorage.length, 1);
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /could not be cleared/
            );
            const before = f.calls.length;
            clickById(f.window, 'reload');
            await waitFor(() => browserIdle(f.window));
            assert.equal(f.calls.length, before + 1);
            assert.deepEqual(f.calls.at(-1), {});
            assert.ok(findButton(f.window, 'Log in and use session'));
            assert.doesNotMatch(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /Authenticated/
            );
        });

        for (const action of ['opt-out reconnect', 'Disconnect'] as const) {
            it(`retains failed logout cleanup through ${action} and retries forgetting without restoration`, async (test) => {
                const f = await setup(test);
                const storage = f.window.sessionStorage;
                storage.setItem('unrelated-app', 'retained');
                const removeItem = storage.removeItem.bind(storage);
                Object.defineProperty(storage, 'removeItem', {
                    configurable: true,
                    value() {
                        throw new Error('Synthetic removal denial');
                    },
                });
                clickById(f.window, 'logout');
                const before = f.calls.length;
                const retryCleanup = () => {
                    if (action === 'Disconnect')
                        clickById(f.window, 'disconnect');
                    else {
                        browserInput(f.window, 'remember-session').checked =
                            false;
                        submitForm(f.window, 'Connect and load');
                    }
                };
                retryCleanup();
                await waitFor(() => browserIdle(f.window));
                assert.equal(f.calls.length, before);
                assert.equal(storage.length, 2);
                assert.match(
                    f.window.document.getElementById('status')!.textContent!,
                    /could not be cleared/
                );
                assert.doesNotMatch(
                    f.window.document.getElementById('session-summary')!
                        .textContent!,
                    /Authenticated/
                );
                Object.defineProperty(storage, 'removeItem', {
                    configurable: true,
                    value: removeItem,
                });
                retryCleanup();
                await waitFor(() => browserIdle(f.window));
                assert.equal(storage.length, 1);
                assert.equal(storage.getItem('unrelated-app'), 'retained');
                assert.doesNotMatch(
                    f.window.document.getElementById('status')!.textContent!,
                    /could not be cleared/
                );
                if (action === 'opt-out reconnect') {
                    assert.deepEqual(f.calls.at(-1), {});
                    assert.ok(findButton(f.window, 'Log in and use session'));
                }
            });
        }

        it('keeps failed logout cleanup owned after opting in to another connection', async (test) => {
            const f = await setup(test);
            const storage = f.window.sessionStorage;
            const removeItem = storage.removeItem.bind(storage);
            Object.defineProperty(storage, 'removeItem', {
                configurable: true,
                value() {
                    throw new Error('Synthetic removal denial');
                },
            });
            clickById(f.window, 'logout');
            browserInput(f.window, 'api-origin').value =
                'https://other.example.test';
            submitForm(f.window, 'Connect and load');
            await waitFor(() => browserIdle(f.window));
            assert.match(
                f.window.document.getElementById('session-summary')!
                    .textContent!,
                /storage cleanup pending/
            );
            assert.deepEqual(f.calls.at(-1), {});
            Object.defineProperty(storage, 'removeItem', {
                configurable: true,
                value: removeItem,
            });
            clickById(f.window, 'disconnect');
            assert.equal(storage.length, 0);
        });

        for (const gate of ['password', 'verification'] as const) {
            it(`remembers the opted-in ${gate} flow and restores only after fresh validation`, async (test) => {
                const login = browserLoginPage();
                const page = gate === 'password' ? passwordPage() : login;
                const accepted = loadedForm();
                accepted.extensionId = page.extensionId;
                let confirmations = 0;
                const window = await environment(test, async (url, init) => {
                    const route = new URL(String(url)).searchParams.get(
                        'route'
                    );
                    const body = JSON.parse(String(init?.body));
                    if (route === 'fetchExtensionForEndUser')
                        return jsonResponse(
                            Object.values(body.miniExtStorageV4).includes(
                                'SYNTHETIC_GATE_CREDENTIAL'
                            )
                                ? accepted
                                : page
                        );
                    if (route === 'verifyExtensionPassword')
                        return jsonResponse({
                            type: 'correct',
                            encryptedExtensionPassword:
                                'SYNTHETIC_GATE_CREDENTIAL',
                        });
                    if (route === 'loginIntoExtensionUsingLoginPageExtension')
                        return jsonResponse(verificationSent());
                    assert.equal(route, 'confirmVerificationCodeForLogin');
                    confirmations++;
                    return jsonResponse(
                        confirmations === 1
                            ? {
                                  error: true,
                                  message: 'Wrong verification code.',
                              }
                            : {
                                  encryptedLoginToken:
                                      'SYNTHETIC_GATE_CREDENTIAL',
                              }
                    );
                });
                beginRememberedConnection(window, login);
                await waitFor(() => browserIdle(window));
                if (gate === 'password') {
                    const input = findButton(window, 'Verify and use password')!
                        .closest('form')!
                        .querySelector('input')!;
                    input.value = 'raw-password-not-retained';
                    submitForm(window, 'Verify and use password');
                } else {
                    enterEmail(window, 'pilot@example.test');
                    submitForm(window, 'Log in and use session');
                    await waitFor(() => browserIdle(window));
                    codeControl(window).code.value = 'wrong';
                    submitForm(window, 'Confirm and use session');
                    await waitFor(() => browserIdle(window));
                    assert.equal(window.sessionStorage.length, 0);
                    codeControl(window).code.value = '123456';
                    submitForm(window, 'Confirm and use session');
                }
                await waitFor(() => browserIdle(window));
                assert.equal(window.sessionStorage.length, 1);
                const saved = window.sessionStorage.getItem(
                    window.sessionStorage.key(0)!
                )!;
                assert.equal(
                    saved.includes('raw-password-not-retained'),
                    false
                );
                assert.equal(saved.includes('123456'), false);
                assert.match(
                    window.document.getElementById('status')!.textContent!,
                    /Loaded form/
                );
                await restartBrowser(window);
                beginRememberedConnection(window, login);
                await waitFor(() => browserIdle(window));
                assert.match(
                    window.document.getElementById('status')!.textContent!,
                    /Loaded form/
                );
                clickById(window, 'logout');
                assert.equal(window.sessionStorage.length, 0);
            });
        }

        it('opting out on reconnect forgets the earlier remembered credential before reporting logout', async (test) => {
            const f = await setup(test);
            browserInput(f.window, 'remember-session').checked = false;
            submitForm(f.window, 'Connect and load');
            await waitFor(() => browserIdle(f.window));
            assert.equal(f.window.sessionStorage.length, 0);
            assert.deepEqual(f.calls.at(-1), {});
            clickById(f.window, 'logout');
            beginRememberedConnection(f.window, f.page);
            await waitFor(() => browserIdle(f.window));
            assert.ok(findButton(f.window, 'Log in and use session'));
            assert.deepEqual(f.calls.at(-1), {});
        });

        it('cancelled restoration offers a new explicit login flow rather than a retired adapter', async (test) => {
            const f = await setup(test);
            await restartBrowser(f.window);
            f.mode('held');
            beginRememberedConnection(f.window, f.page);
            await waitFor(() => f.calls.length === 4);
            clickById(f.window, 'cancel');
            assert.ok(findButton(f.window, 'Retry session restoration'));
            findButton(f.window, 'Continue with login')!.click();
            f.mode('accepted');
            enterEmail(f.window, 'pilot@example.test');
            submitForm(f.window, 'Log in and use session');
            await waitFor(() => browserIdle(f.window));
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /Login applied/
            );
            f.held.resolve(jsonResponse(f.accepted));
            await new Promise<void>((resolve) => setImmediate(resolve));
            assert.match(
                f.window.document.getElementById('status')!.textContent!,
                /Login applied/
            );
        });

        it('Visitor B cannot restore A and disconnect clears only this connection’s remembered entries', async (test) => {
            const f = await setup(test);
            f.window.sessionStorage.setItem('unrelated-app', 'retained');
            const selector = f.window.document.getElementById('visitor')!;
            assert.ok(selector instanceof f.window.HTMLSelectElement);
            selector.value = 'B';
            selector.dispatchEvent(new f.window.Event('change'));
            clickById(f.window, 'reload');
            await waitFor(() => browserIdle(f.window));
            assert.deepEqual(f.calls.at(-1), {});
            assert.ok(findButton(f.window, 'Log in and use session'));
            clickById(f.window, 'disconnect');
            assert.equal(f.window.sessionStorage.length, 1);
            assert.equal(
                f.window.sessionStorage.getItem('unrelated-app'),
                'retained'
            );
        });
    }
);
