import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import type {
    AddRecordCommentInput,
    FormLoadedResult,
    ListRecordCommentsInput,
    ListRecordCommentsResult,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';
import { createOwnedCompiler } from './ownedCompiler.js';

const compiler = createOwnedCompiler();

const root = resolve(process.cwd());
let directory: string;
let prepared = false;
let moduleRevision = 0;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-comments-'));
    await compiler.build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
            '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
    prepared = true;
});
after(async () => {
    if (directory === undefined) return;
    if (!prepared || !compiler.canCleanup()) {
        console.error(`Compiler output directory retained: ${directory}`);
        return;
    }
    await rm(directory, { recursive: true, force: true });
});

const settle = () => new Promise<void>((done) => setImmediate(done));
const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 120; turn++) {
        if (predicate()) return;
        await settle();
    }
    assert.fail('The actual browser comments action did not settle.');
};
const deferred = <Value>() => {
    let resolve!: (value: Value) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Value>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
};
const childForm = (token = 'child_access_A'): FormLoadedResult => {
    const form = loadedForm();
    form.source = { type: 'table', tableExtensionId: 'table_extension' };
    form.enableCommentsOnChildForms = true;
    form.payload.baseId = 'native:workspace_example';
    form.payload.extensionAccessToken = token;
    form.payload.hasParentExtension = true;
    form.payload.formRecord = {
        type: 'edit',
        tableId: 'table_projects',
        recordId: `record_${token}`,
        data: { fld_title: 'Synthetic child' },
    };
    form.payload.fieldIdsInForm = ['fld_title'];
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    form.payload.publicFields.state.multiPageFormMode = 'one-page';
    return form;
};
const nativePage = (
    ids: number[],
    nextCursor?: string,
    disableSending = false
): ListRecordCommentsResult => ({
    comments: ids.map((id) => ({
        id: `comment_${id}`,
        text: `Comment ${id}`,
        createdTime: `2026-01-01T00:00:${String(id).padStart(2, '0')}.000Z`,
        lastUpdatedTime: null,
        actor: { type: 'public', extensionId: 'child_extension' },
        authorLabel: 'Form visitor',
    })),
    readableVersionOfRecordPrimaryValue: 'Synthetic visitor',
    includeCommenterPrefix: false,
    disableSending,
    ...(nextCursor === undefined ? {} : { nextCursor }),
});
type ReadCall = { input: ListRecordCommentsInput; signal: AbortSignal | null };
const mount = async (
    test: TestContext,
    options: {
        read(
            call: ReadCall,
            index: number
        ): ListRecordCommentsResult | Promise<ListRecordCommentsResult>;
        form?: FormLoadedResult;
    }
) => {
    const window = new Window({
        url: 'https://app.example.test',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    window.document.write(
        (
            await readFile(join(root, 'examples/browser/index.html'), 'utf8')
        ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    let form = options.form ?? childForm();
    const reads: ReadCall[] = [];
    const adds: AddRecordCommentInput[] = [];
    let loads = 0;
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
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        Option,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.searchParams.get('route') === 'fetchExtensionForEndUser') {
                loads++;
                return new Response(JSON.stringify(form));
            }
            if (
                url.pathname ===
                '/api/trpc/airtable.getAirtableCommentsForRecord'
            ) {
                assert.equal(init?.method ?? 'GET', 'GET');
                const call = {
                    input: JSON.parse(
                        url.searchParams.get('input') ?? 'null'
                    ) as ListRecordCommentsInput,
                    signal: init?.signal ?? null,
                };
                reads.push(call);
                // Deliberately do not settle on abort: the real client and UI
                // must reject a late response from a transport that ignores it.
                const result = await options.read(call, reads.length - 1);
                return new Response(
                    JSON.stringify({ result: { data: result } })
                );
            }
            if (
                url.pathname ===
                '/api/trpc/airtable.addAirtableCommentForRecord'
            ) {
                assert.equal(init?.method, 'POST');
                adds.push(JSON.parse(String(init?.body)));
                return new Response(JSON.stringify({ result: { data: null } }));
            }
            assert.fail(
                `Unexpected synthetic comments request: ${url.pathname}`
            );
        },
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous)
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        await window.happyDOM.close();
    });
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++moduleRevision}`
    );
    const input = (id: string) => {
        const node = window.document.getElementById(id);
        assert.ok(node instanceof window.HTMLInputElement);
        return node;
    };
    input('api-origin').value = 'https://sdk.example.test';
    input('share-id').value = 'share_example';
    window.document
        .getElementById('connection-form')!
        .dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
    const findButton = (label: string) =>
        Array.from(window.document.querySelectorAll('button')).find(
            (button) => button.textContent?.trim() === label
        );
    const button = (label: string) => {
        const node = findButton(label);
        assert.ok(node, `Expected mounted ${label} button.`);
        return node;
    };
    const idle = () =>
        window.document.getElementById('screen')?.getAttribute('aria-busy') ===
        'false';
    await waitFor(
        () => loads === 1 && idle() && findButton('Load comments') !== undefined
    );
    const click = (label: string) => {
        const node = button(label);
        assert.equal(node.disabled, false, `${label} must be available.`);
        assert.equal(node.closest('[hidden]'), null);
        node.click();
    };
    const read = async (label = 'Load comments') => {
        const count = reads.length;
        click(label);
        await waitFor(() => reads.length === count + 1 && idle());
    };
    return {
        window,
        reads,
        adds,
        button,
        findButton,
        click,
        read,
        idle,
        texts: () =>
            Array.from(
                window.document.querySelectorAll('.comment'),
                (node) => node.textContent
            ),
        exhausted: () => {
            const older = findButton('Load older comments');
            assert.ok(
                !older || older.disabled || older.closest('[hidden]'),
                'No older-page action after cursor exhaustion.'
            );
        },
        replaceForm(next: FormLoadedResult) {
            form = next;
        },
        async reload() {
            const count = loads;
            const reload = window.document.getElementById('reload');
            assert.ok(reload instanceof window.HTMLButtonElement);
            assert.equal(reload.disabled, false);
            reload.click();
            await waitFor(
                () =>
                    loads === count + 1 &&
                    idle() &&
                    findButton('Load comments') !== undefined
            );
        },
        cancel() {
            const cancel = window.document.getElementById('cancel');
            assert.ok(cancel instanceof window.HTMLButtonElement);
            assert.equal(cancel.disabled, false);
            cancel.click();
        },
        switchVisitor(value: 'A' | 'B') {
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            visitor.value = value;
            visitor.dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
        },
    };
};
const texts = (...ids: number[]) => ids.map((id) => `Comment ${id}`);
const cursor1 = 'tc_11111111-1111-4111-8111-111111111111';
const cursor2 = 'tc_22222222-2222-4222-8222-222222222222';

describe('actual browser starter comment pagination', () => {
    it('loads native four-plus-one pages with the exact opaque cursor and prepends older comments', async (test) => {
        const f = await mount(test, {
            read: (_, index) =>
                index === 0
                    ? nativePage([2, 3, 4, 5], cursor1)
                    : nativePage([1]),
        });
        await f.read();
        assert.deepEqual(f.texts(), texts(2, 3, 4, 5));
        assert.deepEqual(f.reads[0]!.input, {
            childExtensionAccessToken: 'child_access_A',
        });
        await f.read('Load older comments');
        assert.deepEqual(f.reads[1]!.input, {
            childExtensionAccessToken: 'child_access_A',
            cursor: cursor1,
        });
        assert.deepEqual(f.texts(), texts(1, 2, 3, 4, 5));
        f.exhausted();
        assert.equal(f.reads.length, 2);
    });

    it('admits only one request for rapid initial and older-page double clicks', async (test) => {
        const initial = deferred<ListRecordCommentsResult>();
        const older = deferred<ListRecordCommentsResult>();
        const f = await mount(test, {
            read: (_, index) =>
                index === 0
                    ? initial.promise
                    : index === 1
                      ? older.promise
                      : nativePage([1]),
        });
        f.click('Load comments');
        f.click('Load comments');
        await waitFor(() => f.reads.length === 1);
        await settle();
        assert.equal(f.reads.length, 1);
        assert.equal(f.idle(), false);
        assert.deepEqual(f.reads[0]!.input, {
            childExtensionAccessToken: 'child_access_A',
        });
        assert.deepEqual(f.texts(), []);
        f.exhausted();
        initial.resolve(nativePage([4, 5], cursor1));
        await waitFor(f.idle);
        await settle();
        assert.equal(f.reads.length, 1, 'No queued duplicate initial read.');
        assert.deepEqual(f.texts(), texts(4, 5));

        f.click('Load older comments');
        f.click('Load older comments');
        await waitFor(() => f.reads.length === 2);
        await settle();
        assert.equal(f.reads.length, 2);
        assert.equal(f.idle(), false);
        assert.deepEqual(f.reads[1]!.input, {
            childExtensionAccessToken: 'child_access_A',
            cursor: cursor1,
        });
        assert.deepEqual(f.texts(), texts(4, 5));
        older.resolve(nativePage([2, 3], cursor2));
        await waitFor(f.idle);
        await settle();
        assert.equal(f.reads.length, 2, 'No queued duplicate older read.');
        assert.deepEqual(f.texts(), texts(2, 3, 4, 5));
        assert.equal(
            f.window.document.getElementById('status')!.textContent,
            'Loaded 4 comments.'
        );
        await f.read('Load older comments');
        assert.equal(f.reads[2]!.input.cursor, cursor2);
        assert.deepEqual(f.texts(), texts(1, 2, 3, 4, 5));
        assert.equal(f.reads.length, 3);
        f.exhausted();
    });

    it('retains empty or existing history after an initial-page failure and waits for explicit retry', async (test) => {
        const f = await mount(test, {
            read: (_, index) => {
                if (index === 0 || index === 2)
                    throw Error('Synthetic private initial-page failure');
                return index === 1
                    ? nativePage([3, 4], cursor1)
                    : nativePage([1, 2]);
            },
        });
        await f.read();
        assert.deepEqual(f.texts(), []);
        f.exhausted();
        assert.equal(f.idle(), true);
        assert.equal(f.button('Load comments').disabled, false);
        const status = f.window.document.getElementById('status')!.textContent;
        assert.match(status ?? '', /The request failed/);
        assert.doesNotMatch(status ?? '', /Synthetic private/);
        await settle();
        assert.equal(f.reads.length, 1, 'No automatic initial-page retry.');

        await f.read();
        assert.deepEqual(
            f.reads.slice(0, 2).map((call) => call.input),
            [
                { childExtensionAccessToken: 'child_access_A' },
                { childExtensionAccessToken: 'child_access_A' },
            ]
        );
        assert.deepEqual(f.texts(), texts(3, 4));
        assert.equal(
            f.window.document.getElementById('status')!.textContent,
            'Loaded 2 comments.'
        );

        // A failed refresh also leaves the accepted history and cursor intact.
        await f.read();
        assert.equal('cursor' in f.reads[2]!.input, false);
        assert.deepEqual(f.texts(), texts(3, 4));
        assert.equal(f.idle(), true);
        assert.equal(f.button('Load older comments').disabled, false);
        await settle();
        assert.equal(f.reads.length, 3, 'No automatic refresh retry.');
        await f.read('Load older comments');
        assert.equal(f.reads[3]!.input.cursor, cursor1);
        assert.deepEqual(f.texts(), texts(1, 2, 3, 4));
        assert.equal(
            f.window.document.getElementById('status')!.textContent,
            'Loaded 4 comments.'
        );
        assert.equal(f.reads.length, 4);
        f.exhausted();
    });

    it('advances multiple opaque cursors and stops at exhaustion without automatic requests', async (test) => {
        const pages = [
            nativePage([5, 6], cursor1),
            nativePage([3, 4], cursor2),
            nativePage([1, 2]),
        ];
        const f = await mount(test, { read: (_, index) => pages[index]! });
        await f.read();
        assert.equal(f.reads.length, 1);
        await f.read('Load older comments');
        assert.deepEqual(f.texts(), texts(3, 4, 5, 6));
        await f.read('Load older comments');
        assert.deepEqual(f.texts(), texts(1, 2, 3, 4, 5, 6));
        assert.deepEqual(
            f.reads.map((call) => call.input.cursor),
            [undefined, cursor1, cursor2]
        );
        f.exhausted();
        await settle();
        assert.equal(f.reads.length, 3);
    });

    it('keeps legacy Airtable responses without cursors as one complete page', async (test) => {
        const form = childForm();
        delete form.source;
        form.payload.baseId = 'app_example';
        const f = await mount(test, {
            form,
            read: () => ({
                readableVersionOfRecordPrimaryValue: 'Legacy visitor',
                comments: [
                    {
                        id: 'legacy_comment',
                        text: 'Legacy text',
                        createdTime: '2026-01-01T00:00:00.000Z',
                        lastUpdatedTime: null,
                        author: {
                            id: 'usr_example',
                            name: null,
                            email: 'synthetic@example.test',
                        },
                        mentioned: {},
                    },
                ],
            }),
        });
        await f.read();
        assert.deepEqual(f.texts(), ['Legacy text']);
        f.exhausted();
        assert.equal(f.reads.length, 1);
        assert.equal('cursor' in f.reads[0]!.input, false);
    });

    it('retains history and cursor after an older-page failure, then retries only on explicit intent', async (test) => {
        const f = await mount(test, {
            read: (_, index) => {
                if (index === 0) return nativePage([2, 3], cursor1);
                if (index === 1) throw Error('Synthetic older-page failure');
                return nativePage([1]);
            },
        });
        await f.read();
        await f.read('Load older comments');
        assert.deepEqual(f.texts(), texts(2, 3));
        assert.equal(f.reads.length, 2);
        await settle();
        assert.equal(f.reads.length, 2);
        await f.read('Load older comments');
        assert.deepEqual(
            f.reads.slice(1).map((call) => call.input.cursor),
            [cursor1, cursor1]
        );
        assert.deepEqual(f.texts(), texts(1, 2, 3));
        f.exhausted();
    });

    it('discards an aborted older response and retains the cursor for an explicit retry', async (test) => {
        const late = deferred<ListRecordCommentsResult>();
        const f = await mount(test, {
            read: (_, index) =>
                index === 0
                    ? nativePage([2, 3], cursor1)
                    : index === 1
                      ? late.promise
                      : nativePage([1]),
        });
        await f.read();
        f.click('Load older comments');
        await waitFor(() => f.reads.length === 2);
        f.cancel();
        assert.equal(f.reads[1]!.signal?.aborted, true);
        late.resolve(nativePage([99]));
        await settle();
        await settle();
        assert.deepEqual(f.texts(), texts(2, 3));
        await f.read('Load older comments');
        assert.equal(f.reads[2]!.input.cursor, cursor1);
        assert.deepEqual(f.texts(), texts(1, 2, 3));
    });

    for (const replacement of ['visitor', 'form'] as const) {
        it(`retires old history and discards late older results after ${replacement} replacement`, async (test) => {
            const late = deferred<ListRecordCommentsResult>();
            const f = await mount(test, {
                read: (_, index) =>
                    index === 0
                        ? nativePage([2, 3], cursor1)
                        : index === 1
                          ? late.promise
                          : nativePage([8, 9]),
            });
            await f.read();
            f.click('Load older comments');
            await waitFor(() => f.reads.length === 2);
            if (replacement === 'visitor') f.switchVisitor('B');
            else f.cancel();
            assert.equal(f.reads[1]!.signal?.aborted, true);
            f.replaceForm(childForm('child_access_replacement'));
            await f.reload();
            assert.deepEqual(f.texts(), []);
            f.exhausted();
            await f.read();
            assert.deepEqual(f.reads[2]!.input, {
                childExtensionAccessToken: 'child_access_replacement',
            });
            late.resolve(nativePage([99], cursor2));
            await settle();
            await settle();
            assert.deepEqual(f.texts(), texts(8, 9));
            f.exhausted();
            if (replacement === 'visitor') {
                f.switchVisitor('A');
                assert.deepEqual(f.texts(), []);
                f.exhausted();
            }
        });
    }

    it('does not overwrite a replacement visitor status when an old page rejects late', async (test) => {
        const late = deferred<ListRecordCommentsResult>();
        const f = await mount(test, {
            read: (_, index) =>
                index === 0
                    ? nativePage([2, 3], cursor1)
                    : index === 1
                      ? late.promise
                      : nativePage([8, 9]),
        });
        await f.read();
        f.click('Load older comments');
        await waitFor(() => f.reads.length === 2);
        f.switchVisitor('B');
        f.replaceForm(childForm('child_access_B'));
        await f.reload();
        await f.read();
        const status = f.window.document.getElementById('status')!.textContent;
        late.reject(Error('Synthetic retired visitor failure'));
        await settle();
        await settle();
        assert.deepEqual(f.texts(), texts(8, 9));
        assert.equal(
            f.window.document.getElementById('status')!.textContent,
            status
        );
        assert.equal(f.idle(), true);
        assert.equal(f.button('Load comments').disabled, false);
        f.exhausted();
    });

    it('replaces history and cursor on an explicit refresh after adding, without duplicates', async (test) => {
        const pages = [
            nativePage([3, 4, 5], cursor1),
            nativePage([1, 2]),
            nativePage([4, 5, 6], cursor2),
            nativePage([1, 2, 3]),
        ];
        const f = await mount(test, { read: (_, index) => pages[index]! });
        await f.read();
        await f.read('Load older comments');
        assert.deepEqual(f.texts(), texts(1, 2, 3, 4, 5));
        const input = f.window.document.querySelector(
            'textarea[placeholder="Write a comment"]'
        );
        assert.ok(input instanceof f.window.HTMLTextAreaElement);
        input.value = 'New explicit comment';
        f.click('Add comment');
        await waitFor(() => f.adds.length === 1 && f.idle());
        assert.deepEqual(f.adds, [
            {
                childExtensionAccessToken: 'child_access_A',
                comment: 'New explicit comment',
            },
        ]);
        assert.equal(
            f.reads.length,
            2,
            'Adding does not implicitly fetch or replay a page.'
        );
        await f.read();
        assert.equal('cursor' in f.reads[2]!.input, false);
        assert.deepEqual(f.texts(), texts(4, 5, 6));
        await f.read('Load older comments');
        assert.equal(f.reads[3]!.input.cursor, cursor2);
        assert.deepEqual(f.texts(), texts(1, 2, 3, 4, 5, 6));
        f.exhausted();
    });

    it('allows pagination while sending is disabled and refreshes the sending state with a fresh page', async (test) => {
        const pages = [
            nativePage([2, 3], cursor1, true),
            nativePage([1], undefined, true),
            nativePage([4]),
        ];
        const f = await mount(test, { read: (_, index) => pages[index]! });
        await f.read();
        assert.equal(f.button('Add comment').disabled, true);
        await f.read('Load older comments');
        assert.deepEqual(f.texts(), texts(1, 2, 3));
        assert.equal(f.button('Add comment').disabled, true);
        f.button('Add comment').click();
        assert.equal(f.adds.length, 0);
        await f.read();
        assert.deepEqual(f.texts(), texts(4));
        f.exhausted();
        assert.equal(f.button('Add comment').disabled, false);
    });
});
