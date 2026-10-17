import assert from 'node:assert/strict';
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
import { join } from 'node:path';
import test from 'node:test';
import {
    cleanupProofOutput,
    createProofOutput,
    prepareProofOutput,
    writeProofAsset,
} from './build-rich-text-browser-proof.mjs';

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
    symlinkSync(outside, alias, 'dir');
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
    symlinkSync(checkout, alias, 'dir');
    assert.throws(
        () => prepareProofOutput(checkout, join(alias, 'missing', 'proof')),
        /outside the checkout/
    );
    assert.equal(existsSync(join(checkout, 'missing')), false);
});

test('checkout aliases are canonicalized before containment checks', (t) => {
    const { directory, checkout } = fixture(t);
    const alias = join(directory, 'checkout-alias');
    symlinkSync(checkout, alias, 'dir');
    assert.throws(
        () => prepareProofOutput(alias, join(checkout, 'proof')),
        /outside the checkout/
    );
});

test('dangling symlink ancestors are rejected without creating their target', (t) => {
    const { directory, checkout } = fixture(t);
    const target = join(directory, 'missing-target');
    const alias = join(directory, 'dangling');
    symlinkSync(target, alias, 'dir');
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
    symlinkSync(join(outside, 'missing'), dangling, 'dir');
    assert.throws(
        () => prepareProofOutput(checkout, dangling),
        /already exists/
    );
});

test('a regular file cannot be an output parent', (t) => {
    const { checkout, outside } = fixture(t);
    const parent = join(outside, 'file');
    writeFileSync(parent, 'keep');
    assert.throws(() => prepareProofOutput(checkout, join(parent, 'proof')), {
        code: 'ENOTDIR',
    });
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
    symlinkSync(checkout, join(outside, 'new'), 'dir');
    assert.throws(() => createProofOutput(plan), /outside the checkout/);
    assert.equal(existsSync(join(checkout, 'nested')), false);
});

test('a changed ancestor prevents writes and uncertain cleanup', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    renameSync(outside, `${outside}-old`);
    symlinkSync(checkout, outside, 'dir');
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
    symlinkSync(checkout, state.output, 'dir');
    assert.throws(
        () => writeProofAsset(state, 'index.html', 'blocked'),
        /remain the created directory/
    );
    assert.equal(cleanupProofOutput(state), false);
    assert.equal(existsSync(join(checkout, 'index.html')), false);
});

test('exclusive asset writes reject existing files and symlinks', (t) => {
    const { checkout, outside } = fixture(t);
    const state = createProofOutput(
        prepareProofOutput(checkout, join(outside, 'proof'))
    );
    writeProofAsset(state, 'receipt.json', 'original');
    assert.throws(() => writeProofAsset(state, 'receipt.json', 'replacement'), {
        code: 'EEXIST',
    });
    const protectedFile = join(checkout, 'protected');
    writeFileSync(protectedFile, 'keep');
    symlinkSync(protectedFile, join(state.output, 'index.html'));
    assert.throws(() => writeProofAsset(state, 'index.html', 'blocked'), {
        code: 'EEXIST',
    });
    assert.equal(readFileSync(protectedFile, 'utf8'), 'keep');
    assert.equal(
        readFileSync(join(state.output, 'receipt.json'), 'utf8'),
        'original'
    );
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
