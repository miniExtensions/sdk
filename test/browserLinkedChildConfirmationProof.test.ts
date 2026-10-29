import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { childForm, parentForm } from './formLinkedChildFixtures.js';
import { createOwnedCompiler } from './ownedCompiler.js';

const compiler = createOwnedCompiler();

type MouseCheckpoint = {
    focusedBefore: boolean;
    focusedAfter: boolean;
    changes: number;
    childTitle: string;
    saves: number;
    reads: number;
};
type RoutingInput = {
    extensionAccessToken: string;
    formRecord: {
        type: 'create' | 'edit';
        data: Record<string, string>;
        tableId?: string;
        recordId?: string;
    };
};
type Checkpoint = {
    attempts: number;
    saves: number;
    reads: number;
    dialogs: number;
    banner: { text: string; error: boolean };
    privateDetailVisible: boolean;
    childTitle: string;
    parentTitle: string;
    parentLinks: string[];
};
type MultiPageCheckpoint = {
    reviewEnabled: boolean[];
    saves: number;
    reads: number;
    dialogs: number;
    banner: { text: string; error: boolean };
    answers: Record<string, string>;
    parentTitle: string;
    parentLinks: string[];
};
const {
    assertFailedConfirmation,
    assertEditedMultiPageReview,
    assertChildSaveRouting,
    assertMouseBlurCommit,
} = (await compiler.withService(
    () =>
        import(
            pathToFileURL(
                resolve('scripts/browser-linked-child-confirmation-native.mjs')
            ).href
        )
)) as {
    assertMouseBlurCommit(
        actual: MouseCheckpoint,
        expected: Pick<MouseCheckpoint, 'childTitle' | 'reads'>
    ): void;
    assertChildSaveRouting(input: RoutingInput, mode: 'create' | 'edit'): void;
    assertFailedConfirmation(
        actual: Checkpoint,
        expected: Pick<
            Checkpoint,
            'reads' | 'childTitle' | 'parentTitle' | 'parentLinks'
        >
    ): void;
    assertEditedMultiPageReview(
        actual: MultiPageCheckpoint,
        expected: Pick<
            MultiPageCheckpoint,
            'reads' | 'answers' | 'parentTitle' | 'parentLinks'
        >
    ): void;
};
const expected = {
    reads: 2,
    childTitle: '<strong>Child draft retained</strong>',
    parentTitle: 'Parent draft retained',
    parentLinks: ['rec_existing', 'rec_existing', 'rec_sibling'],
};
const checkpoint = (): Checkpoint => ({
    ...structuredClone(expected),
    attempts: 1,
    saves: 0,
    dialogs: 0,
    banner: {
        text: 'Child Save was not accepted. Retry only after checking its state.',
        error: true,
    },
    privateDetailVisible: false,
});

describe('installed starter confirmation proof acceptance', () => {
    it('accepts a sanitized refusal with untouched drafts and no transport', () => {
        assertFailedConfirmation(checkpoint(), expected);
    });
    const invalid: Array<[string, (actual: Checkpoint) => void]> = [
        ['fault never exercised', (actual) => (actual.attempts = 0)],
        ['Save allocated', (actual) => (actual.saves = 1)],
        ['extra read', (actual) => actual.reads++],
        ['leaked modal', (actual) => (actual.dialogs = 1)],
        [
            'neutral cancellation banner',
            (actual) => (actual.banner.error = false),
        ],
        ['missing failure feedback', (actual) => (actual.banner.text = '')],
        [
            'private detail disclosed',
            (actual) => (actual.privateDetailVisible = true),
        ],
        ['child draft lost', (actual) => (actual.childTitle = '')],
        ['parent draft lost', (actual) => (actual.parentTitle = '')],
        ['parent links changed', (actual) => actual.parentLinks.pop()],
    ];
    for (const [name, mutate] of invalid)
        it(`rejects false proof: ${name}`, () => {
            const actual = checkpoint();
            mutate(actual);
            assert.throws(() => assertFailedConfirmation(actual, expected), {
                code: 'ERR_ASSERTION',
            });
        });
});

describe('installed starter multi-page Review proof acceptance', () => {
    const expected = {
        reads: 0,
        answers: {
            fld_title: '<strong>Child draft retained</strong>',
            fld_note: 'Second page answer retained',
            fld_last: 'Final page answer retained',
        },
        parentTitle: 'Parent draft retained',
        parentLinks: ['rec_existing', 'rec_existing', 'rec_sibling'],
    };
    const checkpoint = (): MultiPageCheckpoint => ({
        ...structuredClone(expected),
        reviewEnabled: [false, false, true],
        saves: 0,
        dialogs: 0,
        banner: {
            text: 'Review cancelled. Continue editing the child Form.',
            error: false,
        },
    });
    it('accepts final-page-only admission and Edit with every answer retained', () => {
        assertEditedMultiPageReview(checkpoint(), expected);
    });
    const invalid: Array<[string, (actual: MultiPageCheckpoint) => void]> = [
        ['Review on first page', (actual) => (actual.reviewEnabled[0] = true)],
        ['Review on middle page', (actual) => (actual.reviewEnabled[1] = true)],
        [
            'Review refused on final page',
            (actual) => (actual.reviewEnabled[2] = false),
        ],
        ['page checkpoint omitted', (actual) => actual.reviewEnabled.pop()],
        ['Edit allocated a Save', (actual) => (actual.saves = 1)],
        ['Edit caused a read', (actual) => actual.reads++],
        ['dialog leaked after Edit', (actual) => (actual.dialogs = 1)],
        ['Edit reported an error', (actual) => (actual.banner.error = true)],
        ['Edit feedback missing', (actual) => (actual.banner.text = '')],
        ['first-page answer lost', (actual) => (actual.answers.fld_title = '')],
        ['middle-page answer lost', (actual) => (actual.answers.fld_note = '')],
        ['final-page answer lost', (actual) => (actual.answers.fld_last = '')],
        ['parent edit lost', (actual) => (actual.parentTitle = '')],
        ['parent relationship changed', (actual) => actual.parentLinks.pop()],
    ];
    for (const [name, mutate] of invalid)
        it(`rejects false proof: ${name}`, () => {
            const actual = checkpoint();
            mutate(actual);
            assert.throws(() => assertEditedMultiPageReview(actual, expected), {
                code: 'ERR_ASSERTION',
            });
        });
});

it('commits native text change before resolving a fresh child action', async (test) => {
    const root = process.cwd();
    const directory = await mkdtemp(join(tmpdir(), 'sdk-confirmation-setup-'));
    test.after(async () => {
        if (!compiler.canCleanup())
            throw new Error(
                'Compiler did not close; output directory retained.'
            );
        await rm(directory, { recursive: true, force: true });
    });
    await compiler.build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        alias: Object.fromEntries(
            ['auth', 'ui', 'forms', 'portals', 'formulas']
                .map((name) => [
                    `@miniextensions/sdk/${name}`,
                    join(root, `src/${name}/index.ts`),
                ])
                .concat([
                    ['@miniextensions/sdk', join(root, 'src/runtime/index.ts')],
                ])
        ),
        outfile: join(directory, 'main.mjs'),
    });
    const window = new Window({
        url: 'https://app.example.test/',
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
    const parent = parentForm('edit');
    parent.payload.fieldIdsInForm = ['fld_title', 'fld_children_a'];
    const linked = parent.payload.fieldIdsToSchemas.fld_children_a!;
    assert.ok(linked.fieldType === 'multipleRecordLinks');
    linked.miniExtConfig = {
        ...linked.miniExtConfig,
        recordFinderMode: 'hide-finder',
    };
    let loads = 0;
    const fetch: typeof globalThis.fetch = async (resource, init) => {
        assert.equal(
            new URL(String(resource)).searchParams.get('route'),
            'fetchExtensionForEndUser'
        );
        loads++;
        const input = JSON.parse(String(init?.body));
        const loaded =
            'childExtensionInfo' in input ? childForm('edit') : parent;
        if ('childExtensionInfo' in input)
            loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
        return new Response(JSON.stringify(loaded));
    };
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
        fetch,
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        await window.happyDOM.close();
        for (const [key, descriptor] of previous)
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
    });
    const tick = () => new Promise<void>((done) => setImmediate(done));
    const waitFor = async (predicate: () => boolean) => {
        for (let turn = 0; turn < 120; turn++) {
            if (predicate()) return;
            await tick();
        }
        assert.fail('Starter setup did not settle');
    };
    await import(pathToFileURL(join(directory, 'main.mjs')).href);
    for (const [id, value] of [
        ['api-origin', 'https://synthetic-sdk.invalid'],
        ['share-id', 'share_synthetic_parent'],
        ['record-id', 'rec_parent'],
    ] as const) {
        const control = window.document.getElementById(id);
        assert.ok(control instanceof window.HTMLInputElement);
        control.value = value;
    }
    window.document
        .getElementById('connection-form')!
        .dispatchEvent(
            new window.Event('submit', { bubbles: true, cancelable: true })
        );
    const screen = window.document.getElementById('screen')!;
    await waitFor(
        () => loads === 1 && screen.getAttribute('aria-busy') === 'false'
    );
    const title = screen.querySelector('[data-field-id="fld_title"]');
    assert.ok(title instanceof window.HTMLInputElement);
    title.focus();
    title.value = 'Parent draft retained';
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
    const create = () => {
        const button = Array.from(screen.querySelectorAll('button')).find(
            (node) => node.textContent?.trim() === 'Create linked record'
        );
        assert.ok(button);
        return button;
    };
    const beforeCommit = create();
    title.dispatchEvent(new window.Event('change', { bubbles: true }));
    title.blur();
    assert.equal(beforeCommit.isConnected, false);
    beforeCommit.click();
    await tick();
    assert.equal(loads, 1, 'The replaced action must not open a child');
    const fresh = create();
    assert.notEqual(fresh, beforeCommit);
    fresh.click();
    await waitFor(
        () => loads === 2 && screen.getAttribute('aria-busy') === 'false'
    );
    assert.ok(
        screen.querySelector(
            '[data-linked-child-pane] [data-field-id="fld_title"]'
        )
    );
    assert.equal(title.value, 'Parent draft retained');
});

describe('installed starter child Save routing proof acceptance', () => {
    for (const mode of ['create', 'edit'] as const) {
        const input = (): RoutingInput => ({
            extensionAccessToken: 'synthetic_child_token',
            formRecord: {
                type: mode,
                data: { fld_title: 'Retained child answer' },
                ...(mode === 'edit'
                    ? { tableId: 'tbl_child', recordId: 'rec_existing' }
                    : {}),
            },
        });
        it(`accepts correct ${mode} routing`, () => {
            assertChildSaveRouting(input(), mode);
        });
        const invalid: Array<[string, (actual: RoutingInput) => void]> = [
            [
                'parent token',
                (actual) =>
                    (actual.extensionAccessToken = 'synthetic_parent_token'),
            ],
            [
                'wrong mode',
                (actual) =>
                    (actual.formRecord.type =
                        mode === 'edit' ? 'create' : 'edit'),
            ],
            [
                'parent table',
                (actual) => (actual.formRecord.tableId = 'tbl_parent'),
            ],
            [
                'parent record',
                (actual) => (actual.formRecord.recordId = 'rec_parent'),
            ],
        ];
        if (mode === 'edit')
            invalid.push(
                [
                    'missing table',
                    (actual) => {
                        delete actual.formRecord.tableId;
                    },
                ],
                [
                    'missing record',
                    (actual) => {
                        delete actual.formRecord.recordId;
                    },
                ],
                [
                    'sibling record',
                    (actual) => (actual.formRecord.recordId = 'rec_sibling'),
                ]
            );
        for (const [name, mutate] of invalid)
            it(`rejects ${mode} routing: ${name}`, () => {
                const actual = input();
                mutate(actual);
                assert.throws(() => assertChildSaveRouting(actual, mode), {
                    code: 'ERR_ASSERTION',
                });
            });
    }
});

describe('installed starter mouse-blur proof acceptance', () => {
    const expected = { childTitle: 'Current required answer', reads: 0 };
    const checkpoint = (): MouseCheckpoint => ({
        ...expected,
        focusedBefore: true,
        focusedAfter: false,
        changes: 1,
        saves: 0,
    });
    it('accepts one mouse-blur change without transport', () => {
        assertMouseBlurCommit(checkpoint(), expected);
    });
    const invalid: Array<[string, (actual: MouseCheckpoint) => void]> = [
        ['already blurred', (actual) => (actual.focusedBefore = false)],
        ['still focused', (actual) => (actual.focusedAfter = true)],
        ['change never committed', (actual) => (actual.changes = 0)],
        ['duplicate change', (actual) => (actual.changes = 2)],
        ['stale answer', (actual) => (actual.childTitle = 'Previous answer')],
        ['autosave', (actual) => (actual.saves = 1)],
        ['extra read', (actual) => actual.reads++],
    ];
    for (const [name, mutate] of invalid)
        it(`rejects false mouse-blur proof: ${name}`, () => {
            const actual = checkpoint();
            mutate(actual);
            assert.throws(() => assertMouseBlurCommit(actual, expected), {
                code: 'ERR_ASSERTION',
            });
        });
});
