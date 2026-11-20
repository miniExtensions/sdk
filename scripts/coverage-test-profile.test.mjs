import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createTestProfileClassifier } from './coverage-test-profile.mjs';

async function fixture(t, files) {
    const directory = await mkdtemp(
        path.join(tmpdir(), 'sdk-coverage-profile-')
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const root = path.join(directory, 'test');
    await mkdir(root);
    for (const [name, source] of Object.entries(files)) {
        const target = path.join(root, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, source);
    }
    return { directory, root, classify: createTestProfileClassifier(root) };
}

test('direct runtime imports and side effects identify the real happy-dom package only', async (t) => {
    const f = await fixture(t, {
        'direct.test.ts': "import { Window } from 'happy-dom'; new Window();",
        'side-effect.test.ts': "import 'happy-dom';",
        'subpath.test.ts':
            "import Window from 'happy-dom/lib/window/Window.js';",
        'lookalike.test.ts': "import { Window } from 'happy-dom-lookalike';",
    });
    assert.equal(await f.classify('direct.test.ts'), 'component');
    assert.equal(await f.classify('side-effect.test.ts'), 'component');
    assert.equal(await f.classify('subpath.test.ts'), 'component');
    assert.equal(await f.classify('lookalike.test.ts'), 'unit');
});

test('actual helper and transitive re-export dependencies resolve emitted .js to source .ts', async (t) => {
    const f = await fixture(t, {
        'map.test.ts':
            "import { fixture } from './fixtures/bridge.js'; fixture();",
        'fixtures/bridge.ts': "export { fixture } from './dom.js';",
        'fixtures/dom.ts':
            "import { Window } from 'happy-dom'; export const fixture = () => new Window();",
    });
    assert.equal(await f.classify('map.test.ts'), 'component');
});

test('source .ts wins over an existing .js sibling deterministically', async (t) => {
    const f = await fixture(t, {
        'map.test.ts': "import './fixtures/dom.js';",
        'fixtures/dom.ts': "import { Window } from 'happy-dom'; new Window();",
        'fixtures/dom.js':
            "throw Error('The emitted sibling must not be selected');",
    });
    assert.equal(await f.classify('map.test.ts'), 'component');
});

test('cycle reachability is independent of entry order and never caches an in-progress false result', async (t) => {
    const f = await fixture(t, {
        'first.test.ts': "import './a.js';",
        'second.test.ts': "import './b.js';",
        'a.ts': "import './b.js'; import './dom.js';",
        'b.ts': "export * from './a.js';",
        'dom.ts': "import { Window } from 'happy-dom'; new Window();",
        'plain-cycle.test.ts': "import './plain-a.js';",
        'plain-a.ts': "import './plain-b.js';",
        'plain-b.ts': "import './plain-a.js';",
    });
    for (const entry of [
        'first.test.ts',
        'second.test.ts',
        'second.test.ts',
        'first.test.ts',
    ])
        assert.equal(await f.classify(entry), 'component');
    assert.equal(await f.classify('plain-cycle.test.ts'), 'unit');
});

test('no-DOM helpers, comments, ordinary strings and filenames do not invent component execution', async (t) => {
    const f = await fixture(t, {
        'reactPortalMap.component.test.ts':
            "import { owner } from './fixtures/happy-dom-component.js'; owner();",
        'fixtures/happy-dom-component.ts':
            "// import { Window } from 'happy-dom';\nconst note = \"from 'happy-dom'\"; export const owner = () => note;",
    });
    assert.equal(await f.classify('reactPortalMap.component.test.ts'), 'unit');
});

test('bare packages and source imports outside test root are ignored without executing modules', async (t) => {
    const f = await fixture(t, {
        'headless.test.ts':
            "import '@miniextensions/sdk/react'; import 'src/has-dom'; import '../src/has-dom.js'; import './fixtures/never-execute.js';",
        'fixtures/never-execute.ts':
            "throw Error('Classifier must read source, never execute helpers');",
    });
    await mkdir(path.join(f.directory, 'src'));
    await writeFile(
        path.join(f.directory, 'src/has-dom.ts'),
        "import { Window } from 'happy-dom'; throw Error('Outside test root');"
    );
    assert.equal(await f.classify('headless.test.ts'), 'unit');
});

test('type-only imports and re-exports do not imply runtime DOM dependencies', async (t) => {
    const f = await fixture(t, {
        'types.test.ts':
            "import type { Window } from 'happy-dom'; import { type Browser } from 'happy-dom'; export type { Window } from 'happy-dom'; export { type Browser } from 'happy-dom';",
    });
    assert.equal(await f.classify('types.test.ts'), 'unit');
});

test('entry escape and canonical helper escape fail before outside source is read', async (t) => {
    const windows = process.platform === 'win32';
    const f = await fixture(t, {
        'inside.test.ts': windows
            ? "import './escape/outside.js';"
            : "import './escape.js';",
    });
    const outside = path.join(f.directory, 'outside.ts');
    const sentinel =
        "import { Window } from 'happy-dom'; throw Error('Must not be read as a test helper');";
    await writeFile(outside, sentinel);
    if (windows) {
        const external = path.join(f.directory, 'external');
        await mkdir(external);
        await writeFile(path.join(external, 'outside.ts'), sentinel);
        await symlink(external, path.join(f.root, 'escape'), 'junction');
    } else {
        await symlink(outside, path.join(f.root, 'escape.ts'));
    }
    await assert.rejects(
        f.classify('../outside.ts'),
        /entry escapes test root/
    );
    await assert.rejects(
        f.classify('inside.test.ts'),
        /escapes canonical test root/
    );
});

test('an unresolved required local helper fails explicitly rather than silently becoming unit', async (t) => {
    const f = await fixture(t, {
        'missing.test.ts': "import './missing-helper.js';",
    });
    await assert.rejects(
        f.classify('missing.test.ts'),
        /Cannot resolve local coverage test dependency/
    );
});

test('graph limits produce explicit incomplete classification rather than a false unit result', async (t) => {
    const f = await fixture(t, {
        'bounded.test.ts': "import './a.js';",
        'a.ts': "import './dom.js';",
        'dom.ts': "import { Window } from 'happy-dom'; new Window();",
    });
    const classify = createTestProfileClassifier(f.root, { maxFiles: 2 });
    await assert.rejects(classify('bounded.test.ts'), /file limit exceeded/);
    const edges = createTestProfileClassifier(f.root, { maxEdges: 1 });
    await assert.rejects(edges('bounded.test.ts'), /edge limit exceeded/);
    const bytes = createTestProfileClassifier(f.root, { maxBytes: 20 });
    await assert.rejects(bytes('bounded.test.ts'), /byte limit exceeded/);
});

test('malformed source fails explicitly before an incomplete graph can become unit', async (t) => {
    const f = await fixture(t, { 'malformed.test.ts': 'function (' });
    await assert.rejects(
        f.classify('malformed.test.ts'),
        /Cannot parse coverage test dependency/
    );
});
