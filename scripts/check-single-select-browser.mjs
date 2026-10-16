// Synthetic installed-package localhost proof; no credentials or live services.
// node scripts/check-single-select-browser.mjs /path/to/sdk.tgz [evidence-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
    copyFileSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertBrowserInputs } from './package-checks.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const exampleDirectory = join(repository, 'examples/react-single-select');
assert(process.argv[2], 'Pass the tested SDK tarball');
const tarball = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'dist/single-select-browser');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'sdk-single-select-browser-'));
let browser, server, primaryFailure;
const receipt = { status: 'running', consumer: temporary, cleanup: {} };
try {
    writeFileSync(
        join(temporary, 'package.json'),
        '{"private":true,"type":"module"}'
    );
    execFileSync(
        'npm',
        [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            tarball,
            'react@18.3.1',
            'react-dom@18.3.1',
        ],
        {
            cwd: temporary,
            env: {
                ...process.env,
                npm_config_cache: join(temporary, 'npm-cache'),
            },
            stdio: 'pipe',
        }
    );
    const exampleSources = ['main.ts', 'styles.css', 'index.html'].map(
        (name) => ({
            path: `examples/react-single-select/${name}`,
            sha256: createHash('sha256')
                .update(readFileSync(join(exampleDirectory, name)))
                .digest('hex'),
        })
    );
    for (const name of ['main.ts', 'styles.css'])
        copyFileSync(join(exampleDirectory, name), join(temporary, name));
    const sourceParts = execFileSync(
        'git',
        ['rev-parse', 'HEAD', 'HEAD^{tree}'],
        { cwd: repository, encoding: 'utf8' }
    )
        .trim()
        .split('\n');
    assert.equal(sourceParts.length, 2);
    assert(sourceParts.every((part) => /^[a-f0-9]{40}$/.test(part)));
    const source = { commit: sourceParts[0], tree: sourceParts[1] };
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [join(temporary, 'main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outdir: output,
        write: false,
        metafile: true,
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const bundleInputs = Object.keys(bundle.metafile.inputs).map((path) => ({
        path: relative(temporary, resolve(temporary, path)),
        sha256: createHash('sha256')
            .update(readFileSync(resolve(temporary, path)))
            .digest('hex'),
    }));
    const assets = new Map(
        bundle.outputFiles.map((file) => [
            '/' + file.path.split('/').at(-1),
            file.contents,
        ])
    );
    server = createServer((request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/') {
            response.setHeader('content-type', 'text/html');
            response.end(readFileSync(join(exampleDirectory, 'index.html')));
        } else if (assets.has(path)) {
            response.setHeader(
                'content-type',
                path.endsWith('.css') ? 'text/css' : 'text/javascript'
            );
            response.end(assets.get(path));
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        executablePath:
            process.env.SDK_SINGLE_SELECT_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        chromiumSandbox: true,
        args: ['--disable-gpu'],
    });
    const context = await browser.newContext({
        viewport: { width: 1180, height: 940 },
        reducedMotion: 'reduce',
    });
    const external = [],
        errors = [],
        popups = [],
        navigations = [],
        transports = [];
    await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
            return route.continue();
        external.push(route.request().url());
        return route.abort();
    });
    context.on('request', (request) => {
        if (['fetch', 'xhr'].includes(request.resourceType()))
            transports.push(request.url());
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('popup', (popup) => popups.push(popup.url()));
    await page.goto(origin);
    await page.waitForFunction(() => !!window.__singleSelectProof);
    await page.locator('#card-primary select').waitFor();
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
    });
    const checks = [];
    const checked = (name) => checks.push(name);
    const read = () => page.evaluate(() => window.__singleSelectProof.read());
    const card = (id) => page.locator(`#card-${id}`);
    const select = (id) => card(id).locator('select');
    const waitValue = (key, value) =>
        page.waitForFunction(
            ({ key, value }) =>
                window.__singleSelectProof.read()[key] === value,
            { key, value }
        );
    const noSaves = async () => {
        const state = await read();
        assert.equal(state.counts.formSaves, 0);
        assert.equal(state.counts.gridSaves, 0);
    };
    assert.equal(await page.locator('article.card').count(), 12);
    let state = await read();
    assert.equal(state.counts.portalReads, 2);
    assert.equal(state.primary, 'Routine');
    assert.equal(state.grid, 'Routine');
    assert.equal(state.list, 'Soon');
    assert.equal(state.counts.draftChanges, 0);
    assert.equal(await page.locator('#save-grid').isDisabled(), true);
    await noSaves();
    checked(
        'Accepted Form, Grid cell and Grid/List detail owners mount without implicit record writes'
    );

    const labelled = await page
        .locator('.mx-sdk-single-select')
        .evaluateAll((controls) =>
            controls.map((control) => ({
                id: control.id,
                label: document.querySelector(
                    `label[for="${CSS.escape(control.id)}"]`
                )?.textContent,
                aria: control.getAttribute('aria-label'),
            }))
        );
    assert.equal(
        new Set(labelled.map((item) => item.id)).size,
        labelled.length
    );
    assert.ok(labelled.every((item) => item.id && (item.label || item.aria)));
    assert.equal(
        await select('compact').getAttribute('aria-label'),
        'Compact priority'
    );
    assert.equal(
        await select('compact').locator('option').first().textContent(),
        'Choose when ready'
    );
    checked(
        'Repeated instances have unique IDs; hidden-title control retains an accessible name and empty label'
    );

    await page.screenshot({
        path: join(output, 'single-select-idle.png'),
        fullPage: true,
    });
    await select('primary').focus();
    await page.screenshot({
        path: join(output, 'single-select-focus.png'),
        fullPage: true,
    });
    assert.equal(
        await select('primary').evaluate(
            (element) => document.activeElement === element
        ),
        true
    );
    checked('Native dropdown receives keyboard focus with its paired label');

    await select('primary').selectOption('Urgent');
    await waitValue('primary', 'Urgent');
    assert.equal(await select('repeated').inputValue(), 'Urgent');
    assert.equal((await read()).primary, 'Urgent');
    await noSaves();
    checked(
        'Choosing a native name updates the shared Form draft and repeated binding without Save'
    );

    await card('repeated')
        .getByRole('button', { name: 'Clear repeated priority', exact: true })
        .click();
    await waitValue('primary', null);
    assert.equal(await select('primary').inputValue(), '');
    assert.equal(
        await select('repeated').evaluate(
            (element) => document.activeElement === element
        ),
        true
    );
    assert.equal(
        await card('repeated')
            .getByRole('button', {
                name: 'Clear repeated priority',
                exact: true,
            })
            .isDisabled(),
        true
    );
    checked(
        'Clear writes native null, synchronizes both instances and returns focus to the dropdown'
    );

    await select('primary').focus();
    await page.keyboard.press('r');
    await waitValue('primary', 'Routine');
    assert.equal(await select('repeated').inputValue(), 'Routine');
    await page.keyboard.press('Tab');
    assert.equal(
        await card('primary')
            .locator('.mx-sdk-single-select-clear')
            .evaluate((element) => document.activeElement === element),
        true
    );
    await page.keyboard.press('Space');
    await waitValue('primary', null);
    assert.equal(
        await select('primary').evaluate(
            (element) => document.activeElement === element
        ),
        true
    );
    await select('primary').selectOption('Soon');
    await waitValue('primary', 'Soon');
    assert.equal(await select('repeated').inputValue(), 'Soon');
    checked(
        'Native type-ahead chooses a canonical name; Tab and Space clear it and return focus'
    );

    const retained = select('restricted').locator('option[value="Legacy"]');
    assert.equal(await select('restricted').inputValue(), 'Legacy');
    assert.equal(await retained.isDisabled(), true);
    assert.equal(
        await select('restricted')
            .locator('option[value="Soon"]')
            .textContent(),
        'Next up'
    );
    assert.equal(
        await select('restricted').locator('option[value="Routine"]').count(),
        0
    );
    await select('restricted').selectOption('Soon');
    await waitValue('restricted', 'Soon');
    checked(
        'Restricted metadata retains the unavailable current choice while display labels never replace native names'
    );

    await card('restricted')
        .getByRole('button', { name: 'Clear Delivery window', exact: true })
        .click();
    await waitValue('restricted', null);
    checked(
        'A restricted choice can be explicitly removed without inventing an eligible value'
    );

    await select('grid').selectOption('Urgent');
    await waitValue('grid', 'Urgent');
    assert.equal(await select('grid-detail').inputValue(), 'Routine');
    await noSaves();
    checked(
        'Accepted Grid cell updates only its draft; readonly detail retains the original record'
    );

    for (const id of ['grid-detail', 'list-detail', 'locked']) {
        assert.equal(await select(id).isDisabled(), true);
        assert.equal(
            await card(id).locator('.mx-sdk-single-select-clear').isDisabled(),
            true
        );
        await select(id).evaluate((element) => {
            element.value = 'Urgent';
            element.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
    state = await read();
    assert.equal(state.list, 'Soon');
    assert.equal(state.locked, 'Urgent');
    checked(
        'Readonly details and published permissions reject hostile change events'
    );

    const mask = card('masked').locator('input[type="password"]');
    assert.equal(await mask.isDisabled(), true);
    assert.equal(await mask.inputValue(), '••••••••');
    assert.equal(
        await card('masked')
            .locator('select, option, .mx-sdk-single-select-choice')
            .count(),
        0
    );
    assert.equal(
        (await card('masked').innerHTML()).includes('SECRET_PRIORITY_X'),
        false
    );
    assert.equal(
        (await page.locator('body').innerText()).includes('SECRET_PRIORITY_X'),
        false
    );
    assert.equal((await read()).masked, 'SECRET_PRIORITY_X');
    checked(
        'Masking exposes fixed bullets only while retaining the native owner value privately'
    );

    const createName = card('creator').getByRole('textbox', {
        name: 'New choice name',
        exact: true,
    });
    await createName.fill('Review <b>today</b>');
    await createName.press('Enter');
    assert.equal((await read()).counts.choiceCalls, 0);
    assert.equal((await read()).counts.submits, 0);
    await noSaves();
    checked(
        'Typing and Enter in the creation input do not create a choice or submit the host form'
    );

    await card('creator')
        .getByRole('button', { name: 'Create choice', exact: true })
        .click();
    await waitValue('creator', 'Review <b>today</b>');
    assert.equal(await createName.inputValue(), '');
    assert.equal(await select('creator').inputValue(), 'Review <b>today</b>');
    assert.equal(await card('creator').locator('b').count(), 0);
    assert.equal((await read()).counts.choiceCalls, 1);
    await noSaves();
    assert.match(
        await card('creator').innerText(),
        /Save to update the record/
    );
    checked(
        'Explicit Create installs and selects the canonical literal name but does not save the record'
    );

    const heldName = card('held').getByRole('textbox', {
        name: 'New choice name',
        exact: true,
    });
    await heldName.fill('Late choice');
    await card('held')
        .getByRole('button', { name: 'Create choice', exact: true })
        .click();
    await page.waitForFunction(
        () => window.__singleSelectProof.read().heldPhase === 'creating'
    );
    assert.equal(await select('held').isDisabled(), true);
    assert.equal(await heldName.isDisabled(), true);
    assert.equal(
        await card('held')
            .getByRole('button', {
                name: 'Cancel choice creation',
                exact: true,
            })
            .isEnabled(),
        true
    );
    checked(
        'Pending choice creation disables editing while Cancel stays available'
    );

    await card('held')
        .getByRole('button', { name: 'Cancel choice creation', exact: true })
        .click();
    assert.equal((await read()).held, 'Soon');
    assert.equal((await read()).heldPhase, 'uncertain');
    await page.locator('#release-choice').click();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.equal((await read()).held, 'Soon');
    assert.equal(
        await select('held').locator('option[value="Late choice"]').count(),
        0
    );
    assert.equal((await read()).counts.choiceCalls, 2);
    await noSaves();
    checked(
        'Cancel and a late synthetic response preserve the old draft and never install a stale choice'
    );

    await select('compact').selectOption('Routine');
    await waitValue('compact', 'Routine');
    await select('compact').press('Tab');
    assert.equal(
        await card('compact')
            .locator('.mx-sdk-single-select-clear')
            .evaluate((element) => document.activeElement === element),
        true
    );
    await page.keyboard.press('Space');
    await waitValue('compact', null);
    checked(
        'Keyboard Tab and Space reach Clear without activating an enclosing row'
    );

    const detached = await select('lifecycle').elementHandle();
    await page.locator('#retire-owner').click();
    await page.waitForFunction(
        () => window.__singleSelectProof.read().lifecycleStatus === 'retired'
    );
    assert.equal(await select('lifecycle').count(), 0);
    await detached.evaluate((element) => {
        element.value = 'Urgent';
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal((await read()).lifecycle, 'Routine');
    checked(
        'Permanent owner retirement removes the editor and detached stale events cannot write'
    );

    state = await read();
    assert.equal(state.counts.rowEvents, 0);
    assert.equal(state.counts.submits, 0);
    assert.equal(state.counts.formSaves, 0);
    assert.equal(state.counts.gridSaves, 0);
    checked(
        'All selection, clearing, creation, cancellation and keyboard actions remain contained with zero automatic Save'
    );

    await select('primary').selectOption('Urgent');
    await waitValue('primary', 'Urgent');
    await page.locator('#save-form').click();
    await page.waitForFunction(
        () => window.__singleSelectProof.read().counts.formSaves === 1
    );
    state = await read();
    assert.equal(state.formPayloads[0].formRecord.data.fld_priority, 'Urgent');
    assert.equal(
        JSON.stringify(state.formPayloads[0]).includes('sel_urgent'),
        false
    );
    checked(
        'Explicit Form Save sends the chosen native name through one local synthetic transport'
    );

    await page.locator('#save-created').click();
    await page.waitForFunction(
        () => window.__singleSelectProof.read().counts.formSaves === 2
    );
    state = await read();
    assert.equal(
        state.formPayloads[1].formRecord.data.fld_priority,
        'Review <b>today</b>'
    );
    assert.equal(
        JSON.stringify(state.formPayloads[1]).includes('sel_local_creator'),
        false
    );
    checked(
        'A created name reaches record Save only after its separate explicit Save button'
    );

    await page.locator('#save-grid').click();
    await page.waitForFunction(
        () => window.__singleSelectProof.read().counts.gridSaves === 1
    );
    await page.waitForFunction(
        () => document.querySelector('#save-grid').disabled
    );
    state = await read();
    assert.equal(state.gridPayloads[0].value, 'Urgent');
    checked('Explicit Grid Save sends exactly one canonical native cell value');

    await page.emulateMedia({ forcedColors: 'active' });
    await page.screenshot({
        path: join(output, 'single-select-forced-colors.png'),
        fullPage: true,
    });
    assert.equal(
        await page.evaluate(
            () => matchMedia('(forced-colors: active)').matches
        ),
        true
    );
    checked(
        'Forced-colors presentation remains available for all gallery states'
    );
    // Allow the macOS headless compositor to paint the resized/scrolled viewport.
    const settleViewport = () =>
        page.evaluate(
            () =>
                new Promise((done) =>
                    requestAnimationFrame(() => requestAnimationFrame(done))
                )
        );
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleViewport();
    await page.screenshot({
        path: join(output, 'single-select-mobile.png'),
        fullPage: false,
    });
    await card('creator').evaluate((element) =>
        element.scrollIntoView({ block: 'start' })
    );
    await settleViewport();
    await page.screenshot({
        path: join(output, 'single-select-mobile-creation.png'),
        fullPage: false,
    });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
    );
    checked(
        'Mobile gallery stays inside the viewport without horizontal overflow'
    );

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(popups, []);
    assert.deepEqual(navigations, []);
    assert.deepEqual(transports, []);
    state = await read();
    assert.equal(state.counts.requests, 0);
    assert.equal(state.counts.rowEvents, 0);
    assert.equal(state.counts.submits, 0);
    checked(
        'No runtime fetch, external request, popup, navigation, host submit or propagated row event'
    );
    Object.assign(receipt, {
        status: 'passed',
        packageSha256: createHash('sha256')
            .update(readFileSync(tarball))
            .digest('hex'),
        source,
        bundleInputs,
        exampleSources,
        sandbox: true,
        checks,
        count: checks.length,
        browserVersion: browser.version(),
        limits: [
            'Native popup arrow navigation is not covered. The preserved historical macOS Chrome155 proof reported unchanged native ArrowDown/menu sequences. This current proof retains native type-ahead, Tab and Space assertions.',
        ],
        counts: state.counts,
        state,
        external,
        errors,
        popups,
        navigations,
        transports,
        screenshots: [
            'single-select-idle.png',
            'single-select-focus.png',
            'single-select-forced-colors.png',
            'single-select-mobile.png',
            'single-select-mobile-creation.png',
        ],
    });
} catch (error) {
    primaryFailure = { error };
    receipt.status = 'failed';
    receipt.error = String(error?.stack ?? error);
} finally {
    const cleanupErrors = [];
    for (const [name, cleanup] of [
        ['browser', () => browser?.close()],
        [
            'server',
            () =>
                server
                    ? new Promise((done, reject) =>
                          server.close((error) =>
                              error ? reject(error) : done()
                          )
                      )
                    : undefined,
        ],
        ['consumer', () => rmSync(temporary, { recursive: true, force: true })],
    ]) {
        if (
            (name === 'browser' && !browser) ||
            (name === 'server' && !server)
        ) {
            receipt.cleanup[name] = 'not-started';
            continue;
        }
        try {
            await cleanup();
            receipt.cleanup[name] = 'completed';
        } catch (error) {
            receipt.cleanup[name] = 'failed';
            cleanupErrors.push(error);
        }
    }
    if (cleanupErrors.length) receipt.status = 'failed';
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(receipt, null, 2) + '\n'
    );
    if (cleanupErrors.length)
        throw new AggregateError(
            [
                ...(primaryFailure ? [primaryFailure.error] : []),
                ...cleanupErrors,
            ],
            'Single Select proof cleanup failed'
        );
    if (primaryFailure) throw primaryFailure.error;
}
console.log(JSON.stringify(receipt, null, 2));
