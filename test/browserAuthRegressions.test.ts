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
    type LoginPageResult,
    type RuntimeSession,
} from '../src/runtime/index.js';
import { deferred, loginPage, verificationSent } from './authFixtures.js';

// Exercise the actual browser example and optionally its installed SDK archive.
// All responses are synthetic; no external request is possible.
const root = resolve(process.cwd());
const packedRoot = process.env.SDK_REVIEW_PACKED_ROOT;
let directory: string;
let moduleRevision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-deep-review-auth-'));
    const entry = (name: string) =>
        packedRoot === undefined
            ? join(root, 'src', name, 'index.ts')
            : join(packedRoot, 'dist/esm', name, 'index.js');
    await build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': entry('auth'),
            '@miniextensions/sdk/ui': entry('ui'),
            '@miniextensions/sdk/forms': entry('forms'),
            '@miniextensions/sdk/portals': entry('portals'),
            '@miniextensions/sdk': entry('runtime'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const environment = async (
    test: TestContext,
    fetchImpl: typeof globalThis.fetch
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

describe(
    'deep review browser authentication ownership',
    { concurrency: false },
    () => {
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
                        return jsonResponse(page);
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
                                    'Account B login denied.'
                                ) === true
                              : status?.textContent?.includes(
                                    'No matching login record'
                                ) === true)
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
                    status?.textContent?.includes(
                        'Wrong verification code.'
                    ) === true && browserIdle(window)
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
            assert.equal(loadedSessions.length, 1);
            const reload = window.document.getElementById('reload');
            assert.ok(reload instanceof window.HTMLButtonElement);
            reload.click();
            await waitFor(
                () => loadedSessions.length === 2 && browserIdle(window)
            );
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
            assert.equal(loadedSessions.length, 1);
            const reload = window.document.getElementById('reload');
            assert.ok(reload instanceof window.HTMLButtonElement);
            reload.click();
            await waitFor(
                () => loadedSessions.length === 2 && browserIdle(window)
            );
            assert.deepEqual(Object.values(loadedSessions[1]), [
                'encrypted_account_b',
            ]);
        });
    }
);
