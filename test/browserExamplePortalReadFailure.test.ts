import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
    createMiniExtensionsClient,
    SDKError,
    type MiniExtensionsClient,
} from '../src/runtime/index.js';
import {
    createPortalListOwner,
    type PortalCollectionCriteria,
} from '../src/portals/index.js';
import { portalListPage, portalPage } from './portalFixtures.js';

const root = resolve(process.cwd());
const privateMarker = 'PRIVATE_SYNTHETIC_READ_FAILURE';
const transientCopy =
    'The Portal read could not complete. Choose Load records to try a fresh read.';
const deniedCopy =
    'Access to these Portal records was denied. Check the permitted view or contact the workspace owner.';
const genericCopy =
    'The Portal read did not complete. Use an explicit fresh Load.';
const readOptions = {
    pagesToFetch: 1 as const,
    refreshLoggedInPortalRecord: false,
};
const criteria = (): PortalCollectionCriteria => ({
    selectedCustomViewId: 'view_example',
    searchTerm: null,
    searchParamsMap: {},
    sortFieldsByEndUser: null,
    filtersByEndUser: null,
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
});
let directory: string;
let sequence = 0;
before(async () => {
    // Keep the source-only bundle below this checkout so its external React
    // import resolves to the same peer instance as this mounted test.
    directory = await mkdtemp(join(root, 'dist', 'sdk-portal-read-failure-'));
    const alias = Object.fromEntries(
        ['auth', 'ui', 'forms', 'portals', 'formulas'].map((entry) => [
            `@miniextensions/sdk/${entry}`,
            join(root, `src/${entry}/index.ts`),
        ])
    );
    alias['@miniextensions/sdk'] = join(root, 'src/runtime/index.ts');
    const guide = await readFile(join(root, 'docs/portals.md'), 'utf8');
    const recipes = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].filter(
        ([, source]) =>
            source.includes('export function PortalReadFailureList(')
    );
    assert.equal(
        recipes.length,
        1,
        'Missing actual shipped read-failure recipe'
    );
    await build({
        stdin: {
            contents: recipes[0]![1]!,
            loader: 'ts',
            resolveDir: root,
            sourcefile: 'portal-read-failure-recipe.ts',
        },
        alias: {
            ...alias,
            '@miniextensions/sdk/react': join(root, 'src/react/index.ts'),
        },
        bundle: true,
        platform: 'node',
        external: ['react', 'react-dom'],
        format: 'esm',
        outfile: join(directory, 'recipe.mjs'),
        logLevel: 'silent',
    });
    await build({
        entryPoints: [join(root, 'examples/browser/src/portal.ts')],
        alias,
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'portal.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const dom = (test: TestContext) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        window,
        document: window.document,
        location: window.location,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        Option,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const old = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    let dispose: () => void | Promise<void> = () => {};
    test.after(async () => {
        try {
            await dispose();
        } finally {
            for (const [key, descriptor] of old) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    return {
        window,
        cleanup(next: typeof dispose) {
            dispose = next;
        },
    };
};
type Respond = () => Response | Promise<Response>;
const transport = (respond: Respond) => {
    let answer = respond;
    let requests = 0;
    let sessionChanges = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-read-owner' },
        fetch: async (input) => {
            assert.equal(
                new URL(String(input)).searchParams.get('route'),
                'fetchRecordsForLinkedTableOnPortal'
            );
            requests++;
            return answer();
        },
    });
    const initialSession = client.getSession();
    const setSession = client.setSession;
    client.setSession = (next) => {
        sessionChanges++;
        setSession(next);
    };
    return {
        client,
        get requests() {
            return requests;
        },
        setResponse(next: Respond) {
            answer = next;
        },
        assertSession() {
            assert.equal(sessionChanges, 0);
            assert.deepEqual(client.getSession(), initialSession);
        },
    };
};
const success = () => new Response(JSON.stringify(portalListPage()));
const settle = async () => {
    for (let turn = 0; turn < 3; turn++)
        await new Promise<void>((done) => setImmediate(done));
};
const mountRecipe = async (test: TestContext, respond: Respond) => {
    const screen = dom(test);
    const api = transport(respond);
    const scope = { ownerId: 'synthetic-read-owner', revision: 0 };
    const owner = createPortalListOwner({
        client: api.client,
        portal: portalPage(),
        portalFieldId: 'fld_children',
        criteria: criteria(),
        getScope: () => scope,
    });
    const { PortalReadFailureList } = await import(
        `${pathToFileURL(join(directory, 'recipe.mjs')).href}?case=${++sequence}`
    );
    const container = screen.window.document.createElement('div');
    screen.window.document.body.append(container);
    const renderer = createRoot(
        container as unknown as Parameters<typeof createRoot>[0]
    );
    screen.cleanup(async () => {
        await act(async () => renderer.unmount());
        owner.destroy();
    });
    await act(async () =>
        renderer.render(
            createElement(PortalReadFailureList, {
                owner,
                readOptions,
            })
        )
    );
    return {
        ...api,
        // Preserve getters rather than copying the current request count.
        requests: () => api.requests,
        owner,
        container,
        scope,
        load: async () =>
            act(async () => {
                const button = container.querySelector('button');
                assert.ok(button);
                button.click();
                await settle();
            }),
    };
};

describe('actual shipped PortalList custom host consuming owner.failure', () => {
    for (const item of [
        {
            name: 'network',
            respond: () => {
                throw Error(privateMarker);
            },
            copy: transientCopy,
        },
        {
            name: 'HTTP 503',
            respond: () =>
                new Response(JSON.stringify({ message: privateMarker }), {
                    status: 503,
                }),
            copy: transientCopy,
        },
        {
            name: 'HTTP 403',
            respond: () =>
                new Response(JSON.stringify({ message: privateMarker }), {
                    status: 403,
                }),
            copy: deniedCopy,
        },
        {
            name: 'API envelope with a misleading private code',
            respond: () =>
                new Response(
                    JSON.stringify({
                        error: true,
                        message: privateMarker,
                        code: 'HTTP_503',
                    })
                ),
            copy: genericCopy,
        },
    ]) {
        it(`${item.name} renders finite host copy and waits for an explicit fresh Load`, async (test) => {
            const app = await mountRecipe(test, item.respond);
            assert.equal(app.requests(), 0);
            await app.load();
            assert.equal(app.requests(), 1);
            assert.ok(app.container.textContent?.includes(item.copy));
            assert.equal(
                app.container.innerHTML.includes(privateMarker),
                false
            );
            assert.equal(app.container.querySelector('a'), null);
            assert.equal(
                app.container.textContent?.toLowerCase().includes('log in'),
                false
            );
            await settle();
            assert.equal(app.requests(), 1);
            app.setResponse(success);
            await app.load();
            assert.equal(app.requests(), 2);
            assert.equal(app.owner.getSnapshot().failure, null);
            assert.equal(app.container.textContent?.includes(item.copy), false);
            app.assertSession();
        });
    }
    it('retires the actual custom UI before an old denied response can publish feedback', async (test) => {
        let release!: (response: Response) => void;
        const app = await mountRecipe(
            test,
            () =>
                new Promise<Response>((resolve) => {
                    release = resolve;
                })
        );
        await app.load();
        assert.equal(app.requests(), 1);
        await act(async () => {
            app.scope.revision++;
            app.owner.getSnapshot();
            release(
                new Response(JSON.stringify({ message: privateMarker }), {
                    status: 403,
                })
            );
            await settle();
        });
        assert.equal(app.owner.getSnapshot().phase, 'retired');
        assert.equal(app.owner.getSnapshot().failure, null);
        assert.equal(app.container.textContent, '');
        assert.equal(app.requests(), 1);
        app.assertSession();
    });
});

// The unchanged vanilla starter uses PortalCollection directly. These cases
// certify generic delegation/manual reads and owner fences, not consumption of
// the new PortalListOwner failure property or the main.ts global error renderer.
const mountVanilla = async (test: TestContext, respond: Respond) => {
    const screen = dom(test);
    const api = transport(respond);
    const scope = { ownerId: 'synthetic-read-owner', revision: 0 };
    const errors: unknown[] = [];
    const actions: Promise<void>[] = [];
    const statuses: string[] = [];
    const { createPortalView } = await import(
        `${pathToFileURL(join(directory, 'portal.mjs')).href}?case=${++sequence}`
    );
    const view = createPortalView({
        page: portalPage(),
        client: api.client,
        getScope: () => scope,
        status: (message: string) => statuses.push(message),
        confirm: async () => false,
        openChild: () => {
            throw Error('No child operation is permitted');
        },
        run: (
            _description: string,
            action: (context: {
                client: MiniExtensionsClient;
                signal: AbortSignal;
                current(): boolean;
            }) => Promise<void>
        ) => {
            const captured = { ...scope };
            const current = () =>
                view.node.isConnected &&
                scope.ownerId === captured.ownerId &&
                scope.revision === captured.revision;
            const pending = Promise.resolve()
                .then(() =>
                    action({
                        client: api.client,
                        signal: new AbortController().signal,
                        current,
                    })
                )
                .catch((error: unknown) => {
                    errors.push(error);
                });
            actions.push(pending);
            return pending;
        },
    });
    screen.cleanup(() => view.destroy());
    screen.window.document.body.append(view.node);
    const node: HTMLElement = view.node;
    const first = Array.from(node.querySelectorAll('button')).find(
        (button) => button.textContent === 'Load records'
    );
    assert.ok(first);
    return {
        ...api,
        requests: () => api.requests,
        scope,
        errors,
        statuses,
        node,
        start() {
            first.click();
        },
        async finish() {
            await Promise.all(actions);
        },
    };
};
describe('unchanged vanilla starter direct-collection failure compatibility', () => {
    for (const item of [
        {
            name: 'network',
            respond: () => {
                throw Error(privateMarker);
            },
            kind: 'network',
        },
        {
            name: 'HTTP 403',
            respond: () =>
                new Response(JSON.stringify({ message: privateMarker }), {
                    status: 403,
                }),
            kind: 'http',
        },
    ]) {
        it(`${item.name} keeps generic failure delegation, explicit Load and the same visitor session`, async (test) => {
            const app = await mountVanilla(test, item.respond);
            const before = app.node.textContent;
            assert.equal(app.requests(), 0);
            app.start();
            await app.finish();
            assert.equal(app.requests(), 1);
            assert.equal(app.errors.length, 1);
            assert.ok(app.errors[0] instanceof SDKError);
            assert.equal(app.errors[0].kind, item.kind);
            assert.equal(app.node.textContent, before);
            assert.equal(app.node.innerHTML.includes(privateMarker), false);
            await settle();
            assert.equal(app.requests(), 1);
            app.setResponse(success);
            app.start();
            await app.finish();
            assert.equal(app.requests(), 2);
            assert.equal(app.errors.length, 1);
            app.assertSession();
        });
    }
    it('suppresses a late old-owner rejection without changing the visitor session', async (test) => {
        let release!: (response: Response) => void;
        const app = await mountVanilla(
            test,
            () =>
                new Promise<Response>((resolve) => {
                    release = resolve;
                })
        );
        app.start();
        await settle();
        assert.equal(app.requests(), 1);
        app.scope.revision++;
        release(
            new Response(JSON.stringify({ message: privateMarker }), {
                status: 403,
            })
        );
        await app.finish();
        assert.deepEqual(app.errors, []);
        assert.equal(app.node.innerHTML.includes(privateMarker), false);
        assert.equal(
            app.statuses.some((message) => message.includes(privateMarker)),
            false
        );
        assert.equal(app.requests(), 1);
        app.assertSession();
    });
});
