import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    cleanupProofOutput,
    createProofOutput,
    prepareProofOutput,
    writeProofAsset,
} from './build-rich-text-browser-proof.mjs';

const builder = fileURLToPath(
    new URL('./build-rich-text-browser-proof.mjs', import.meta.url)
);
const repository = dirname(dirname(builder));

const linkDirectory = (target, alias) =>
    symlinkSync(
        target,
        alias,
        process.platform === 'win32' ? 'junction' : 'dir'
    );

function linkFile(t, target, alias) {
    try {
        symlinkSync(target, alias, 'file');
        return true;
    } catch (error) {
        if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
        t.skip('This Windows account cannot create a file symlink (EPERM).');
        return false;
    }
}

const moduleArgument = (index) =>
    `import { pathToFileURL } from 'node:url'; await import(pathToFileURL(process.argv[${index}]).href); console.log('import-only');`;
const commonJsArgument =
    "void import(require('node:url').pathToFileURL(process.argv[1]).href).then(() => console.log('import-only'));";

function runNode(arguments_, input) {
    const result = spawnSync(process.execPath, arguments_, {
        cwd: repository,
        encoding: 'utf8',
        input,
        timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
}

function assertMainExecuted(entry, nodeArguments = []) {
    const result = runNode([...nodeArguments, entry]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(
        result.stderr,
        /Pass the tested tarball and a fresh output directory\./
    );
}

function assertImportOnly(arguments_, input, stdout = 'import-only\n') {
    const result = runNode(arguments_, input);
    assert.equal(result.status, 0, result.stderr);
    if (Array.isArray(stdout))
        assert(stdout.includes(result.stdout), result.stdout);
    else assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, '');
}

const importSource = (entry) =>
    `await import(${JSON.stringify(pathToFileURL(entry).href)}); console.log('import-only');`;

function entryFixture(t) {
    // Keep the lexical /tmp spelling on macOS to cover its /private/tmp alias.
    const directory = mkdtempSync(
        join(
            process.platform === 'darwin' ? '/tmp' : tmpdir(),
            'rich-text-cli-'
        )
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test('canonical proof builder invocation executes argument validation', () => {
    assertMainExecuted(realpathSync(builder));
});

test('relative proof builder invocation executes argument validation', () => {
    assertMainExecuted('scripts/build-rich-text-browser-proof.mjs');
});

test('proof builder invocation through a parent alias executes argument validation', (t) => {
    const alias = join(entryFixture(t), 'checkout');
    linkDirectory(repository, alias);
    assertMainExecuted(
        join(alias, 'scripts/build-rich-text-browser-proof.mjs')
    );
});

test('proof builder invocation through a script symlink executes argument validation', (t) => {
    const alias = join(entryFixture(t), 'builder.mjs');
    if (!linkFile(t, builder, alias)) return;
    assertMainExecuted(alias);
});

test('importing the proof builder from another entry does not execute main', (t) => {
    const wrapper = join(entryFixture(t), 'import-only.mjs');
    writeFileSync(wrapper, importSource(builder));
    assertImportOnly([wrapper]);
});

test('importing the proof builder through a file symlink does not execute main', (t) => {
    const directory = entryFixture(t);
    const alias = join(directory, 'builder.mjs');
    const wrapper = join(directory, 'import-only.mjs');
    if (!linkFile(t, builder, alias)) return;
    writeFileSync(wrapper, importSource(alias));
    assertImportOnly([wrapper]);
});

test('importing the proof builder from eval does not execute main', () => {
    assertImportOnly(['--input-type=module', '--eval', importSource(builder)]);
});

test('importing the proof builder from stdin does not execute main', () => {
    assertImportOnly(['--input-type=module', '-'], importSource(builder));
});

test('eval import with the builder path argument does not execute main', () => {
    assertImportOnly([
        '--input-type=module',
        '--eval',
        moduleArgument(1),
        builder,
    ]);
});

test('eval spellings and surrounding Node options preserve import-only execution', () => {
    const source = moduleArgument(1);
    for (const arguments_ of [
        ['--input-type=module', '-e', source, builder],
        ['--input-type=module', `--eval=${source}`, builder],
        ['--no-warnings', '--input-type=module', '--eval', source, builder],
        ['--input-type=module', '--eval', source, '--no-warnings', builder],
        ['--input-type=commonjs', '--eval', commonJsArgument, builder],
    ]) {
        assertImportOnly(arguments_);
    }
});

function assertEvalImportArgument(entry) {
    assertImportOnly(['--input-type=module', '-e', moduleArgument(1), entry]);
}

test('eval import arguments may use canonical, relative and parent alias paths', (t) => {
    const parentAlias = join(entryFixture(t), 'checkout');
    linkDirectory(repository, parentAlias);
    for (const entry of [
        realpathSync(builder),
        './scripts/build-rich-text-browser-proof.mjs',
        join(parentAlias, 'scripts/build-rich-text-browser-proof.mjs'),
    ]) {
        assertEvalImportArgument(entry);
    }
});

test('eval import arguments may use a file symlink path', (t) => {
    const alias = join(entryFixture(t), 'builder.mjs');
    if (!linkFile(t, builder, alias)) return;
    assertEvalImportArgument(alias);
});

test('print and negative print inline imports do not execute the builder main', () => {
    const source = commonJsArgument;
    for (const flag of ['-p', '-pe', '--print', '--print=false']) {
        assertImportOnly(
            ['--input-type=commonjs', flag, source, builder],
            undefined,
            ['undefined\nimport-only\n', 'import-only\nundefined\n']
        );
    }
    for (const flag of ['--no-print', '--no_print', '--no-print=false']) {
        assertImportOnly(['--input-type=commonjs', flag, source, builder]);
    }
    assertImportOnly([
        '--input-type=commonjs',
        '--print',
        source,
        '--no-print',
        '--',
        builder,
    ]);
});

test('print flags without inline source preserve direct builder execution', () => {
    for (const arguments_ of [
        ['-p', '--'],
        ['--print', '--'],
        ['--print=false', '--'],
        ['--print', '--no-print', '--'],
        ['--no-print', '--'],
    ]) {
        assertMainExecuted(builder, arguments_);
    }
});

test('Node option values resembling eval flags preserve direct builder execution', () => {
    for (const arguments_ of [
        ['--title=--eval'],
        ['--title=-e'],
        ['--title=--print'],
        ['--title', '\\--eval'],
    ]) {
        assertMainExecuted(builder, arguments_);
    }
});

test('wrapper and stdin imports remain inert with a builder path argument', (t) => {
    const wrapper = join(entryFixture(t), 'import-argument.mjs');
    const source = moduleArgument(2);
    writeFileSync(wrapper, source);
    assertImportOnly([wrapper, builder]);
    assertImportOnly(['--input-type=module', '-', builder], source);
});

function fixture(t) {
    const directory = realpathSync(
        mkdtempSync(join(tmpdir(), 'rich-text-output-'))
    );
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const checkout = join(directory, 'sdk');
    const outside = join(directory, 'external');
    mkdirSync(checkout);
    mkdirSync(outside);
    return { directory, checkout, outside };
}

test('a fresh nested sibling output is created, written and safely cleaned', (t) => {
    const { directory, checkout } = fixture(t);
    const output = join(directory, 'sdk-proof', 'nested', 'proof');
    const state = createProofOutput(prepareProofOutput(checkout, output));
    writeProofAsset(state, 'index.html', '<p>synthetic</p>');
    writeProofAsset(state, 'receipt.json', '{}');
    assert.equal(
        readFileSync(join(output, 'index.html'), 'utf8'),
        '<p>synthetic</p>'
    );
    assert.equal(cleanupProofOutput(state), true);
    assert.equal(existsSync(output), false);
});

test('a symlink to an external parent resolves to its canonical output', (t) => {
    const { directory, checkout, outside } = fixture(t);
    const alias = join(directory, 'safe-parent');
    linkDirectory(outside, alias);
    const plan = prepareProofOutput(checkout, join(alias, 'nested', 'proof'));
    assert.equal(plan.output, join(outside, 'nested', 'proof'));
    const state = createProofOutput(plan);
    writeProofAsset(state, 'receipt.json', '{}');
    assert.equal(readFileSync(join(plan.output, 'receipt.json'), 'utf8'), '{}');
});

test('direct output inside the checkout is rejected before creation', (t) => {
    const { checkout } = fixture(t);
    const output = join(checkout, 'missing', 'proof');
    assert.throws(
        () => prepareProofOutput(checkout, output),
        /outside the checkout/
    );
    assert.equal(existsSync(join(checkout, 'missing')), false);
});

test('a missing output below a symlink into the checkout is rejected', (t) => {
    const { directory, checkout } = fixture(t);
    const alias = join(directory, 'checkout-link');
    linkDirectory(checkout, alias);
    assert.throws(
        () => prepareProofOutput(checkout, join(alias, 'missing', 'proof')),
        /outside the checkout/
    );
    assert.equal(existsSync(join(checkout, 'missing')), false);
});

test('checkout aliases are canonicalized before containment checks', (t) => {
    const { directory, checkout } = fixture(t);
    const alias = join(directory, 'checkout-alias');
    linkDirectory(checkout, alias);
    assert.throws(
        () => prepareProofOutput(alias, join(checkout, 'proof')),
        /outside the checkout/
    );
});

test('dangling symlink ancestors are rejected without creating their target', (t) => {
    const { directory, checkout } = fixture(t);
    const target = join(directory, 'missing-target');
    const alias = join(directory, 'dangling');
    linkDirectory(target, alias);
    assert.throws(
        () => prepareProofOutput(checkout, join(alias, 'nested', 'proof')),
        { code: 'ENOENT' }
    );
    assert.equal(existsSync(target), false);
});

test('existing output directories and dangling output links are never reused', (t) => {
    const { checkout, outside } = fixture(t);
    const output = join(outside, 'proof');
    mkdirSync(output);
    assert.throws(() => prepareProofOutput(checkout, output), /already exists/);
    const dangling = join(outside, 'dangling');
    linkDirectory(join(outside, 'missing'), dangling);
    assert.throws(
        () => prepareProofOutput(checkout, dangling),
        /already exists/
    );
});

test('a regular file cannot be an output parent', (t) => {
    const { checkout, outside } = fixture(t);
    const parent = join(outside, 'file');
    writeFileSync(parent, 'keep');
    const requested = join(parent, 'proof');
    assert.throws(
        () => prepareProofOutput(checkout, requested),
        (error) =>
            error.code === 'ENOTDIR' ||
            error.message === 'Output ancestor must be a directory.'
    );
    assert.equal(existsSync(requested), false);
    assert.equal(readFileSync(parent, 'utf8'), 'keep');
});

test('an output created after planning is not reused or deleted', (t) => {
    const { checkout, outside } = fixture(t);
    const output = join(outside, 'proof');
    const plan = prepareProofOutput(checkout, output);
    mkdirSync(output);
    writeFileSync(join(output, 'existing'), 'keep');
    assert.throws(() => createProofOutput(plan), /already exists/);
    assert.equal(readFileSync(join(output, 'existing'), 'utf8'), 'keep');
});

test('a replaced ancestor is rejected between planning and creation', (t) => {
    const { checkout, outside } = fixture(t);
    const plan = prepareProofOutput(checkout, join(outside, 'proof'));
    renameSync(outside, `${outside}-old`);
    mkdirSync(outside);
    assert.throws(() => createProofOutput(plan), /ancestor.*changed/);
    assert.equal(existsSync(plan.output), false);
});

test('a newly inserted symlink parent is rejected before creating nested directories', (t) => {
    const { checkout, outside } = fixture(t);
    const plan = prepareProofOutput(
        checkout,
        join(outside, 'new', 'nested', 'proof')
    );
    linkDirectory(checkout, join(outside, 'new'));
    assert.throws(() => createProofOutput(plan), /outside the checkout/);
    assert.equal(existsSync(join(checkout, 'nested')), false);
});

test('a changed ancestor prevents writes and uncertain cleanup', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    renameSync(outside, `${outside}-old`);
    linkDirectory(checkout, outside);
    assert.throws(
        () => writeProofAsset(state, 'index.html', 'blocked'),
        /ancestor.*changed/
    );
    assert.equal(cleanupProofOutput(state), false);
    assert.equal(existsSync(join(checkout, 'proof')), false);
    assert.equal(existsSync(join(`${outside}-old`, 'proof')), true);
});

test('a replaced output directory prevents writes and is not removed', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    renameSync(state.output, `${state.output}-old`);
    mkdirSync(state.output);
    writeFileSync(join(state.output, 'existing'), 'keep');
    assert.throws(
        () => writeProofAsset(state, 'index.html', 'blocked'),
        /identity changed/
    );
    assert.equal(cleanupProofOutput(state), false);
    assert.equal(readFileSync(join(state.output, 'existing'), 'utf8'), 'keep');
});

test('an output replaced by a checkout symlink is not written or removed', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    renameSync(state.output, `${state.output}-old`);
    linkDirectory(checkout, state.output);
    assert.throws(
        () => writeProofAsset(state, 'index.html', 'blocked'),
        /remain the created directory/
    );
    assert.equal(cleanupProofOutput(state), false);
    assert.equal(existsSync(join(checkout, 'index.html')), false);
});

test('exclusive asset writes reject existing files', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    writeProofAsset(state, 'receipt.json', 'original');
    assert.throws(() => writeProofAsset(state, 'receipt.json', 'replacement'), {
        code: 'EEXIST',
    });
    assert.equal(
        readFileSync(join(state.output, 'receipt.json'), 'utf8'),
        'original'
    );
});

test('exclusive asset writes reject file symlinks without touching their target', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    const protectedFile = join(checkout, 'protected');
    writeFileSync(protectedFile, 'keep');
    if (!linkFile(t, protectedFile, join(state.output, 'index.html'))) return;
    assert.throws(() => writeProofAsset(state, 'index.html', 'blocked'), {
        code: 'EEXIST',
    });
    assert.equal(readFileSync(protectedFile, 'utf8'), 'keep');
});

test('asset names cannot escape the fresh output', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    for (const name of ['', '.', '..', '../outside', '/absolute'])
        assert.throws(
            () => writeProofAsset(state, name, 'blocked'),
            /simple file name/
        );
});
