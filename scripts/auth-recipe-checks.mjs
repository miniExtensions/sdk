import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

// Complete public metadata, with local synthetic identifiers only.
const screen = (extensionScreen = 'login_page') => ({
    extensionScreen,
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
        ...(extensionScreen === 'login_page'
            ? {
                  publicFields: {},
                  hasParentExtension: false,
                  shareId: 'share_example',
                  loginFieldNames: ['Email'],
                  loginFieldIds: ['fld_email'],
                  fieldNamesToSchemas: {
                      Email: {
                          fieldType: 'email',
                          airtableField: {
                              id: 'fld_email',
                              name: 'Email',
                              config: { type: 'email' },
                          },
                      },
                  },
                  fieldIdsToSchemas: {
                      fld_email: {
                          fieldType: 'email',
                          airtableField: {
                              id: 'fld_email',
                              name: 'Email',
                              config: { type: 'email' },
                          },
                      },
                  },
                  tableId: 'table_example',
                  prefillFieldNamesToValues: {},
                  prefillLoginRecordId: null,
              }
            : {}),
    },
});

const deferred = () => {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const challenge = () => ({
    type: 'verification-message-sent',
    verificationId: 'verification_example',
    emailOrPhoneNumber: 'visitor@example.test',
    verificationType: 'email',
});

function makeClient(responses = {}) {
    let session = {};
    const calls = [];
    let sessionWrites = 0;
    const defaults = {
        verifyExtensionPassword: () => ({
            type: 'correct',
            encryptedExtensionPassword: 'synthetic_password_token',
        }),
        login: challenge,
        confirmVerificationCode: () => ({
            encryptedLoginToken: 'synthetic_login_token',
        }),
        signUp: () => ({ ok: true }),
    };
    const auth = Object.fromEntries(
        Object.entries(defaults).map(([operation, response]) => [
            operation,
            (input, options) => {
                const call = {
                    operation,
                    input: structuredClone(input),
                    options,
                };
                calls.push(call);
                return Promise.resolve(
                    (responses[operation] ?? response)(call)
                );
            },
        ])
    );
    return {
        auth,
        calls,
        get sessionWrites() {
            return sessionWrites;
        },
        getSession: () => ({ ...session }),
        setSession(next) {
            session = { ...next };
            sessionWrites++;
        },
        loadExtension() {
            throw new Error('Auth recipe must not load automatically');
        },
    };
}

function installGlobals(window) {
    const replacements = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        Node: window.Node,
        Event: window.Event,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = new Map();
    for (const [name, value] of Object.entries(replacements)) {
        previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Object.defineProperty(globalThis, name, {
            configurable: true,
            writable: true,
            value,
        });
    }
    return () => {
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    };
}

/** Execute the shipped React recipe beside the consumer's exact SDK archive. */
export async function checkAuthRecipe({
    consumerDirectory,
    guideSources,
    happyDomModulePath,
}) {
    const consumerRoot = realpathSync(consumerDirectory);
    const consumerRequire = createRequire(join(consumerRoot, 'package.json'));
    const installedRoot = realpathSync(
        join(consumerRoot, 'node_modules/@miniextensions/sdk')
    );
    assert(
        realpathSync(
            consumerRequire.resolve('@miniextensions/sdk/auth')
        ).startsWith(`${installedRoot}/dist/cjs/`),
        'Auth CommonJS must resolve the installed archive'
    );
    assert.equal(
        typeof consumerRequire('@miniextensions/sdk/auth').createAuthFlow,
        'function'
    );
    assert(
        !existsSync(join(consumerRoot, 'node_modules/happy-dom')),
        'Happy DOM must remain a root test dependency'
    );
    for (const name of ['react', 'react-dom']) {
        const manifest = consumerRequire.resolve(`${name}/package.json`);
        assert(
            realpathSync(manifest).startsWith(`${consumerRoot}/node_modules/`),
            `${name} must come from the clean consumer`
        );
        assert.equal(
            JSON.parse(readFileSync(manifest, 'utf8')).version,
            '19.2.0'
        );
    }
    const sources = guideSources.map((source) => {
        const path = resolve(consumerRoot, source);
        assert.equal(dirname(path), consumerRoot);
        return { path, text: readFileSync(path, 'utf8') };
    });
    const matches = sources.filter(({ text }) =>
        text.includes('export function AuthPanel(')
    );
    assert.equal(
        matches.length,
        1,
        'Missing unique shipped React AuthPanel recipe'
    );
    const source = matches[0].path;
    const { code } = await transform(matches[0].text, {
        loader: 'tsx',
        jsx: 'automatic',
        format: 'esm',
        target: 'es2022',
        sourcefile: relative(consumerRoot, source),
    });
    // Imports remain unbundled, resolving from the installed consumer package.
    const compiled = `${source}.auth-recipe.mjs`;
    writeFileSync(
        compiled,
        `${code}\nexport const authRecipeSdkUrl = import.meta.resolve('@miniextensions/sdk/auth');\n`
    );
    const owners = sources.filter(({ text }) =>
        text.includes('export function makeAuthScreenOwner(')
    );
    assert.equal(owners.length, 1, 'Missing unique shipped auth owner recipe');
    const ownerCode = await transform(owners[0].text, {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
        sourcefile: relative(consumerRoot, owners[0].path),
    });
    const compiledOwner = `${owners[0].path}.auth-owner.mjs`;
    writeFileSync(compiledOwner, ownerCode.code);
    const { makeAuthScreenOwner } = await import(
        pathToFileURL(compiledOwner).href
    );
    const { Window } = await import(pathToFileURL(happyDomModulePath).href);
    let React;
    let createRoot;
    let AuthPanel;
    const failures = [];
    let checks = 0;
    const check = async (name, exercise) => {
        const window = new Window({ url: 'https://example.test/' });
        const restoreGlobals = installGlobals(window);
        const roots = [];
        const reactErrors = [];
        try {
            // ReactDOM's initial browser capability checks need DOM globals first.
            if (!React) {
                React = await import(
                    pathToFileURL(consumerRequire.resolve('react')).href
                );
                ({ createRoot } = await import(
                    pathToFileURL(consumerRequire.resolve('react-dom/client'))
                        .href
                ));
                const recipe = await import(pathToFileURL(compiled).href);
                AuthPanel = recipe.AuthPanel;
                assert(
                    realpathSync(
                        fileURLToPath(recipe.authRecipeSdkUrl)
                    ).startsWith(`${installedRoot}/dist/esm/`),
                    'Executed auth recipe must resolve installed ESM dist'
                );
            }
            const host = window.document.createElement('div');
            window.document.body.append(host);
            const root = createRoot(host, {
                onUncaughtError: (error) => reactErrors.push(error),
                onRecoverableError: (error) => reactErrors.push(error),
                onCaughtError: (error) => reactErrors.push(error),
            });
            roots.push(root);
            const render = async (props) => {
                await React.act(async () =>
                    root.render(React.createElement(AuthPanel, props))
                );
            };
            const button = (label) =>
                [...host.querySelectorAll('button')].find(
                    (candidate) => candidate.textContent.trim() === label
                );
            const disabled = (target) =>
                !target ||
                target.disabled ||
                !!target.closest('fieldset')?.disabled;
            const click = async (label) => {
                const target = button(label);
                assert(!disabled(target), `Missing enabled ${label} button`);
                await React.act(async () => target.click());
            };
            const complete = async (response, value) => {
                await React.act(async () => response.resolve(value));
            };
            const status = () =>
                host.querySelector('[role="status"]')?.textContent ?? '';
            const input = (label, legend) => {
                const container = legend
                    ? [...host.querySelectorAll('fieldset')].find(
                          (node) =>
                              node
                                  .querySelector('legend')
                                  ?.textContent.trim() === legend
                      )
                    : host;
                const result = [...(container?.querySelectorAll('label') ?? [])]
                    .find((node) => node.textContent.trim() === label)
                    ?.querySelector('input');
                assert(result, `Missing ${label} input`);
                return result;
            };
            const unmount = async () => {
                await React.act(async () => root.unmount());
                roots.splice(roots.indexOf(root), 1);
            };
            await exercise({
                window,
                host,
                root,
                render,
                button,
                click,
                complete,
                React,
                disabled,
                status,
                input,
                unmount,
            });
            assert.equal(
                reactErrors.length,
                0,
                'React rendering must complete without errors'
            );
            checks += 1;
        } catch (error) {
            failures.push(new Error(name, { cause: error }));
        } finally {
            try {
                if (React) {
                    for (const root of roots)
                        await React.act(async () => root.unmount());
                }
            } finally {
                try {
                    await window.happyDOM.close();
                } finally {
                    restoreGlobals();
                }
            }
        }
    };

    const props = (client, page = screen(), overrides = {}) => ({
        client,
        page,
        ownerScope: { ownerId: 'visitor_example', revision: 0 },
        getScope: () => ({ ownerId: 'visitor_example', revision: 0 }),
        onSessionApplied: () => {},
        onReload: () => {},
        ...overrides,
    });

    for (const fieldType of ['email', 'singleLineText']) {
        await check(
            `Canonical masked ${fieldType} login fields hide entered values`,
            async ({ render, input }) => {
                const client = makeClient();
                const page = screen();
                for (const schema of [
                    page.payload.fieldNamesToSchemas.Email,
                    page.payload.fieldIdsToSchemas.fld_email,
                ]) {
                    schema.fieldType = fieldType;
                    schema.airtableField.config.type = fieldType;
                    schema.miniExtConfig = {
                        maskPasswordOnLoginScreen: true,
                    };
                }
                await render(props(client, page));
                assert.equal(input('Email', 'Login').type, 'password');
                assert.equal(client.calls.length, 0);
                assert.equal(client.sessionWrites, 0);
            }
        );
    }

    await check(
        'Visible password/PIN titles mask inputs with native credentials unchanged',
        async ({ render, click, input }) => {
            const client = makeClient({ login: () => ({ type: 'no-record' }) });
            const page = screen();
            page.payload.fieldNamesToSchemas.Email.miniExtConfig = {
                title: 'Portal PIN',
            };
            await render(props(client, page));
            assert.equal(input('Email', 'Login').type, 'password');
            input('Email', 'Login').value = 'Exact Case-Sensitive PIN';
            await click('Log in');
            assert.deepEqual(
                client.calls.map(({ operation }) => operation),
                ['login']
            );
            assert.deepEqual(client.calls[0].input.loginCredentials, {
                Email: 'Exact Case-Sensitive PIN',
            });
            assert.equal(client.sessionWrites, 0);
        }
    );

    for (const verificationType of ['email', 'phoneNumber']) {
        await check(
            `Configured ${verificationType} destinations stay masked through confirmation`,
            async ({ render, click, input, status }) => {
                const destination =
                    verificationType === 'email'
                        ? 'private@example.test'
                        : '+15550102030';
                const client = makeClient({
                    login: () => ({
                        ...challenge(),
                        verificationType,
                        emailOrPhoneNumber: destination,
                    }),
                });
                const page = screen();
                const name = verificationType === 'email' ? 'Email' : 'Phone';
                if (verificationType === 'phoneNumber') {
                    const schema = {
                        fieldType: 'phoneNumber',
                        airtableField: {
                            id: 'fld_phone',
                            name,
                            config: { type: 'phoneNumber' },
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
                await render(props(client, page));
                input(name, 'Login').value = 'Exact credential';
                await click('Log in');
                assert.equal(status(), 'Enter the code sent to ••••••••.');
                input('Verification code').value = '123456';
                await click('Confirm code');
                assert.deepEqual(
                    client.calls.map(({ operation }) => operation),
                    ['login', 'confirmVerificationCode']
                );
                assert.deepEqual(client.calls[0].input.loginCredentials, {
                    [name]: 'Exact credential',
                });
                assert.equal(
                    client.calls[1].input.verificationId,
                    'verification_example'
                );
                assert.equal(client.calls[1].input.verificationCode, '123456');
                assert.equal(client.sessionWrites, 0);
            }
        );
    }

    await check(
        'Authentication, confirmation, application and reload require manual actions',
        async ({ render, click, input, status, button, disabled }) => {
            const client = makeClient();
            let applied = 0;
            let reloaded = 0;
            const loginPage = screen();
            loginPage.payload.fieldNamesToSchemas.Email.miniExtConfig = {
                maskPasswordOnLoginScreen: true,
            };
            loginPage.payload.fieldIdsToSchemas.fld_email.miniExtConfig = {
                maskPasswordOnLoginScreen: true,
            };
            await render(
                props(client, loginPage, {
                    signUpFieldNames: ['Email'],
                    onSessionApplied: () => applied++,
                    onReload: () => reloaded++,
                })
            );
            assert.equal(client.calls.length, 0);
            assert.equal(client.sessionWrites, 0);
            assert.equal(applied + reloaded, 0);
            assert.equal(
                input('Email', 'Login').type,
                'password',
                'Canonical maskPasswordOnLoginScreen login fields must use a masked input'
            );
            input('Email', 'Login').value = 'visitor@example.test';
            await click('Log in');
            assert.deepEqual(
                client.calls.map(({ operation }) => operation),
                ['login']
            );
            assert.deepEqual(client.calls[0].input.loginCredentials, {
                Email: 'visitor@example.test',
            });
            assert.equal(input('Email', 'Login').value, '');
            assert.match(status(), /code sent to visitor@example\.test/);
            assert(disabled(button('Apply session')));
            assert.equal(client.sessionWrites, 0);
            input('Verification code').value = '123456';
            await click('Confirm code');
            assert.deepEqual(
                client.calls.map(({ operation }) => operation),
                ['login', 'confirmVerificationCode']
            );
            assert.equal(client.calls[1].input.verificationCode, '123456');
            assert.match(status(), /Code accepted/);
            assert.equal(client.sessionWrites, 0);
            assert.equal(applied + reloaded, 0);
            await click('Apply session');
            assert.equal(client.sessionWrites, 1);
            assert.equal(applied, 1);
            assert.equal(reloaded, 0);
            await click('Reload');
            assert.equal(reloaded, 1);
            assert.equal(client.calls.length, 2);

            const passwordClient = makeClient();
            await render(
                props(passwordClient, screen('password'), {
                    onSessionApplied: () => applied++,
                    onReload: () => reloaded++,
                })
            );
            assert.equal(passwordClient.calls.length, 0);
            input('Extension password').value = 'synthetic_password_input';
            await click('Verify password');
            assert.equal(
                passwordClient.calls[0].operation,
                'verifyExtensionPassword'
            );
            assert.equal(input('Extension password').value, '');
            assert.match(status(), /Password verified/);
            assert.equal(passwordClient.sessionWrites, 0);
            await click('Apply session');
            assert.equal(passwordClient.sessionWrites, 1);
            assert.equal(applied, 2);
            assert.equal(reloaded, 1);
        }
    );

    await check(
        'Replacement and unmount ignore transports that finish after cleanup',
        async ({
            render,
            click,
            complete,
            status,
            button,
            disabled,
            unmount,
            host,
        }) => {
            const oldResponse = deferred();
            const oldClient = makeClient({ login: () => oldResponse.promise });
            let oldApplied = 0;
            let newApplied = 0;
            await render(
                props(oldClient, screen(), {
                    onSessionApplied: () => oldApplied++,
                })
            );
            await click('Log in');
            assert.equal(oldClient.calls.length, 1);
            const newResponse = deferred();
            const newClient = makeClient({ login: () => newResponse.promise });
            await render(
                props(newClient, screen(), {
                    onSessionApplied: () => newApplied++,
                })
            );
            assert(oldClient.calls[0].options.signal.aborted);
            await complete(oldResponse, challenge());
            assert.equal(status(), '');
            assert(!button('Confirm code'));
            assert(disabled(button('Apply session')));
            assert.equal(oldClient.sessionWrites + newClient.sessionWrites, 0);
            assert.equal(oldApplied + newApplied, 0);
            assert.equal(newClient.calls.length, 0);
            await click('Log in');
            await unmount();
            assert(newClient.calls[0].options.signal.aborted);
            await complete(newResponse, {
                type: 'found-record',
                encryptedLoginToken: 'synthetic_retired_token',
            });
            assert.equal(host.textContent, '');
            assert.equal(newClient.sessionWrites, 0);
            assert.equal(oldApplied + newApplied, 0);
        }
    );

    await check(
        'Owner revisions and the recipe post-await guard prevent stale result rendering',
        async ({ render, click, complete, status, button, disabled }) => {
            const response = deferred();
            const client = makeClient({ login: () => response.promise });
            let cleared = 0;
            let loaded = 0;
            let applied = 0;
            const owner = makeAuthScreenOwner(client, {
                initialOwnerId: 'visitor_example',
                clearVisitorState: () => cleared++,
                onLoaded: () => loaded++,
            });
            await render(
                props(client, screen(), {
                    ownerScope: owner.getScope(),
                    getScope: owner.getScope,
                    onSessionApplied: () => applied++,
                })
            );
            await click('Log in');
            owner.changeOwner('visitor_other');
            owner.changeOwner('visitor_example');
            assert.deepEqual(owner.getScope(), {
                ownerId: 'visitor_example',
                revision: 2,
            });
            assert.equal(cleared, 2);
            await complete(response, {
                type: 'found-record',
                encryptedLoginToken: 'synthetic_retired_token',
            });
            assert(!/accepted|sent to/.test(status()));
            assert(disabled(button('Apply session')));
            assert.equal(client.sessionWrites, 0);
            assert.equal(applied + loaded, 0);

            // The final raw projection arms the helper's final synchronous
            // getSession check. That check still sees the captured scope; its
            // queued transition runs before the panel's await continuation.
            const lateResponse = deferred();
            const lateClient = makeClient({
                login: () => lateResponse.promise,
            });
            const lateOwner = makeAuthScreenOwner(lateClient, {
                initialOwnerId: 'visitor_example',
                clearVisitorState: () => cleared++,
                onLoaded: () => loaded++,
            });
            const readSession = lateClient.getSession;
            let projectionReads = 0;
            let armed = false;
            let transitionQueued = false;
            let activeAtTransition = false;
            lateClient.getSession = () => {
                if (armed && !transitionQueued) {
                    transitionQueued = true;
                    queueMicrotask(() => {
                        activeAtTransition =
                            !lateClient.calls[0].options.signal.aborted;
                        lateOwner.changeOwner('visitor_example');
                    });
                }
                return readSession();
            };
            await render(
                props(lateClient, screen(), {
                    ownerScope: lateOwner.getScope(),
                    getScope: lateOwner.getScope,
                    onSessionApplied: () => applied++,
                })
            );
            await click('Log in');
            const projected = challenge();
            Object.defineProperty(projected, 'verificationType', {
                enumerable: true,
                get() {
                    if (++projectionReads === 2) armed = true;
                    return 'email';
                },
            });
            await complete(lateResponse, projected);
            assert.equal(projectionReads, 2);
            assert(
                transitionQueued,
                'Final helper freshness check was exercised'
            );
            assert(activeAtTransition, 'Transition followed helper acceptance');
            assert.equal(lateOwner.getScope().revision, 1);
            assert(
                !lateClient.calls[0].options.signal.aborted,
                'Accepted helper response no longer has an in-flight request'
            );
            assert(!/accepted|sent to/.test(status()));
            assert(!button('Confirm code'));
            assert(disabled(button('Apply session')));
            assert.equal(lateClient.sessionWrites, 0);
            assert.equal(applied + loaded, 0);
            owner.destroy();
            lateOwner.destroy();
        }
    );

    await check(
        'Cancelled delivery and uncertain sign-up show manual recovery without retries',
        async ({
            render,
            click,
            complete,
            status,
            button,
            disabled,
            React,
        }) => {
            const delivery = deferred();
            const client = makeClient({ login: () => delivery.promise });
            let reloaded = 0;
            await render(
                props(client, screen(), {
                    onReload: () => reloaded++,
                    signUpFieldNames: ['Email'],
                })
            );
            await click('Log in');
            await click('Cancel');
            assert(client.calls[0].options.signal.aborted);
            assert.match(
                status(),
                /Cancelled\. Check any delivery\/sign-up outcome, then Reload/
            );
            assert(disabled(button('Log in')));
            assert(disabled(button('Sign up')));
            await complete(delivery, challenge());
            assert.match(status(), /Cancelled/);
            assert(!button('Confirm code'));
            assert.equal(client.calls.length, 1);
            assert.equal(client.sessionWrites, 0);
            assert.equal(reloaded, 0);
            await click('Reload');
            assert.equal(reloaded, 1);
            assert.equal(client.calls.length, 1);

            const signup = deferred();
            const signupClient = makeClient({ signUp: () => signup.promise });
            await render(
                props(signupClient, screen(), {
                    onReload: () => reloaded++,
                    signUpFieldNames: ['Email'],
                })
            );
            await click('Sign up');
            await React.act(async () =>
                signup.reject(new Error('Synthetic transport interruption'))
            );
            assert.match(
                status(),
                /Action did not complete\. Check its outcome, then Reload/
            );
            assert(disabled(button('Sign up')));
            assert(disabled(button('Log in')));
            assert.equal(signupClient.calls.length, 1);
            assert.equal(signupClient.sessionWrites, 0);
            assert.equal(reloaded, 1);
            await click('Reload');
            assert.equal(reloaded, 2);
            assert.equal(signupClient.calls.length, 1);
        }
    );

    await check(
        'An abort listener can replace an owner load without losing its ownership',
        async () => {
            for (const transition of ['changeOwner', 'load']) {
                const client = makeClient();
                const loads = [];
                const rendered = [];
                const observed = [];
                client.loadExtension = (input, options) => {
                    const response = deferred();
                    loads.push({ input, options, response });
                    return response.promise;
                };
                const owner = makeAuthScreenOwner(client, {
                    initialOwnerId: 'visitor_example',
                    clearVisitorState: () => {},
                    onLoaded: (page, scope) => rendered.push({ page, scope }),
                });
                const loadInput = {
                    shareId: 'share_example',
                    recordId: null,
                    context: { type: 'direct-url' },
                };
                // Observe rejections from creation, including nested requests.
                const outcome = (promise) => {
                    const result = promise.then(
                        () => ({ ok: true }),
                        (error) => ({ error })
                    );
                    observed.push(result);
                    return result;
                };
                let flow;
                try {
                    const original = outcome(owner.load(loadInput));
                    assert.equal(loads.length, 1);
                    let replacement;
                    loads[0].options.signal.addEventListener(
                        'abort',
                        () => {
                            replacement = outcome(owner.load(loadInput));
                        },
                        { once: true }
                    );
                    let outer;
                    if (transition === 'changeOwner')
                        owner.changeOwner('visitor_other');
                    else outer = outcome(owner.load(loadInput));
                    assert.equal(
                        loads.length,
                        2,
                        `${transition} must preserve the nested load instead of dispatching over it`
                    );
                    assert(
                        replacement,
                        'The abort listener started a replacement'
                    );
                    const captured = owner.getScope();
                    const nextPage = screen();
                    loads[1].response.resolve(nextPage);
                    assert.deepEqual(
                        await replacement,
                        { ok: true },
                        `${transition} must not detach the replacement request`
                    );
                    assert.equal(rendered.length, 1);
                    assert.equal(rendered[0].page, nextPage);
                    assert.deepEqual(rendered[0].scope, captured);
                    if (outer)
                        assert(
                            (await outer).error,
                            'The superseded outer load must reject'
                        );
                    loads[0].response.resolve(screen());
                    assert(
                        (await original).error,
                        'The replaced old load must reject'
                    );
                    assert.equal(rendered.length, 1);
                    flow = consumerRequire(
                        '@miniextensions/sdk/auth'
                    ).createAuthFlow({
                        client,
                        page: nextPage,
                        getScope: owner.getScope,
                    });
                    assert(flow.isCurrent());
                    owner.destroy();
                    assert(
                        !flow.isCurrent(),
                        'Destroy must immediately retire bound flows'
                    );
                } finally {
                    owner.destroy();
                    flow?.destroy();
                    for (const load of loads) load.response.resolve(screen());
                    await Promise.all(observed);
                }
            }
        }
    );
    if (failures.length) {
        throw new AggregateError(
            failures,
            'Shipped React auth recipe checks failed'
        );
    }
    return { checks };
}
