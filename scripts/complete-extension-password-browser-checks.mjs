import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const scene = String.raw`
import { createElement as h, StrictMode, useEffect, useState } from 'react';
import { CompleteExtensionPasswordScreen } from './screen.mjs';

export const draft = '  synthetic\u200Dß!?  ';
const labels = {
    password: 'Password',
    submit: 'Next',
    pending: 'Checking password',
    wrong: 'Incorrect password',
    blocked: 'Too many attempts',
    error: 'Unable to check password',
};

export function createScene() {
    const stats = { checks: [], trustedSubmits: 0, hydrated: false, hydrationErrors: [] };
    const pending = [];
    let replace;
    function App() {
        const [owner, setOwner] = useState({ ownerId: 'A', revision: 0 });
        useEffect(() => { stats.hydrated = true; }, []);
        replace = setOwner;
        return ['first', 'second'].map((instance) =>
            h('section', { key: instance, 'data-host': instance },
                h(CompleteExtensionPasswordScreen, {
                    labels,
                    scope: instance === 'first' ? owner : { ownerId: 'B', revision: 0 },
                    async verifyPassword(value) {
                        stats.checks.push({ instance, exactDraft: value === draft, corrected: value === 'corrected' });
                        return new Promise((resolve) => pending.push(resolve));
                    },
                })
            )
        );
    }
    return {
        element: h(StrictMode, null, h(App)),
        stats,
        replace: (ownerId, revision) => replace({ ownerId, revision }),
        settle: (index, type) => pending[index]({ type }),
    };
}
`;

const browserEntry = `
import { version } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createScene } from './scene.mjs';
const main = document.querySelector('main');
const firstInput = main.querySelector('input');
const harness = createScene();
document.addEventListener('submit', (event) => {
    if (event.isTrusted) harness.stats.trustedSubmits++;
});
hydrateRoot(main, harness.element, {
    identifierPrefix: 'password-fixture-',
    onRecoverableError() { harness.stats.hydrationErrors.push(true); },
});
window.passwordProof = {
    snapshot: () => ({
        ...harness.stats,
        react: version,
        hydratedExistingInput: firstInput === main.querySelector('input'),
    }),
    settle: harness.settle,
    replace: (...args) => flushSync(() => harness.replace(...args)),
};
`;

function assertGeometry(geometry, width) {
    const desktop = width >= 640;
    const panelWidth = desktop ? 384 : width;
    assert.equal(geometry.panel.x, (width - panelWidth) / 2);
    assert.equal(geometry.panel.y, 80);
    assert.equal(geometry.panel.width, panelWidth);
    assert(Math.abs(geometry.panel.height - 145) <= 1);
    assert.equal(geometry.panelRadius, desktop ? '8px' : '0px');
    assert.equal(geometry.panelColor, 'rgb(255, 255, 255)');
    assert.equal(geometry.label.x, geometry.panel.x + 16);
    assert(Math.abs(geometry.label.y - geometry.panel.y - 20) <= 2);
    assert.equal(geometry.input.x, geometry.label.x);
    assert(Math.abs(geometry.input.y - geometry.panel.y - 49) <= 1);
    assert.equal(geometry.input.width, panelWidth - 32);
    assert.equal(geometry.input.height, 36);
    assert.equal(geometry.inputRadius, '6px');
    assert.equal(geometry.inputSize, desktop ? '14px' : '16px');
    assert.equal(
        geometry.button.x + geometry.button.width,
        geometry.panel.x + panelWidth - 16
    );
    assert.equal(geometry.button.y, geometry.input.y + 44);
    assert.equal(geometry.button.height, 36);
    assert.equal(geometry.buttonColor, 'rgb(37, 99, 235)');
}

async function checkInstalledFormat({
    browser,
    consumer,
    format,
    output,
    width,
}) {
    const cssSpecifier =
        '@miniextensions/sdk/react/complete-extension-password.css';
    const requireFromConsumer = createRequire(join(consumer, 'package.json'));
    const css = readFileSync(requireFromConsumer.resolve(cssSpecifier));
    const sdkPackage = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    const directory = mkdtempSync(join(consumer, '.password-browser-'));
    let context;
    let server;
    try {
        const mode = format === 'cjs' ? 'cjs' : 'mjs';
        writeFileSync(
            join(directory, `import-screen.${mode}`),
            format === 'cjs'
                ? "exports.CompleteExtensionPasswordScreen = require('@miniextensions/sdk/react').CompleteExtensionPasswordScreen;"
                : "export { CompleteExtensionPasswordScreen } from '@miniextensions/sdk/react';"
        );
        writeFileSync(
            join(directory, 'screen.mjs'),
            `export { CompleteExtensionPasswordScreen } from './import-screen.${mode}';`
        );
        writeFileSync(join(directory, 'scene.mjs'), scene);
        writeFileSync(join(directory, 'browser.mjs'), browserEntry);
        writeFileSync(
            join(directory, 'render.mjs'),
            `
import { renderToString } from 'react-dom/server';
import { createScene } from './scene.mjs';
process.stdout.write(renderToString(createScene().element, { identifierPrefix: 'password-fixture-' }));
`
        );
        const markup = execFileSync(
            process.execPath,
            [join(directory, 'render.mjs')],
            {
                cwd: consumer,
                encoding: 'utf8',
            }
        );
        const built = await build({
            absWorkingDir: consumer,
            entryPoints: [join(directory, 'browser.mjs')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            loader: { '.png': 'dataurl', '.svg': 'dataurl' },
            define: { 'process.env.NODE_ENV': '"production"' },
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(built.metafile, consumer);
        const installedComponent = Object.keys(built.metafile.inputs).find(
            (input) =>
                input.endsWith(
                    `/dist/${format}/react/CompleteExtensionPasswordScreen.js`
                )
        );
        assert(
            installedComponent,
            `The browser bundle must use installed ${format}`
        );
        assert(
            realpathSync(join(consumer, installedComponent)).startsWith(
                sdkPackage + '/'
            )
        );
        server = createServer((req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'"
            );
            if (req.url === '/proof.js') {
                res.setHeader('Content-Type', 'text/javascript');
                res.end(built.outputFiles[0].contents);
            } else if (req.url === '/password.css') {
                res.setHeader('Content-Type', 'text/css');
                res.end(css);
            } else if (req.url === '/') {
                res.setHeader('Content-Type', 'text/html');
                res.end(
                    `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Extension password fixture</title><link rel="stylesheet" href="/password.css"><style>body{margin:0;background:#f9fafb}</style><main>${markup}</main><script type="module" src="/proof.js"></script>`
                );
            } else {
                res.writeHead(404).end();
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width, height: 820 },
            reducedMotion: 'reduce',
            serviceWorkers: 'block',
        });
        await context.addInitScript(() => {
            window.passwordEffects = { storage: 0, policy: 0 };
            for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) {
                Object.defineProperty(window, key, {
                    configurable: true,
                    get() {
                        window.passwordEffects.storage++;
                        throw new Error('Unexpected storage access');
                    },
                });
            }
            document.addEventListener('securitypolicyviolation', () => {
                window.passwordEffects.policy++;
            });
        });
        const unexpectedRequests = [];
        const fixtureAssets = new Map([
            [`${origin}/`, 'document'],
            [`${origin}/proof.js`, 'script'],
            [`${origin}/password.css`, 'stylesheet'],
        ]);
        const servedAssets = [];
        await context.route('**/*', (route) => {
            const asset = fixtureAssets.get(route.request().url());
            if (asset === route.request().resourceType()) {
                servedAssets.push(asset);
                return route.continue();
            }
            unexpectedRequests.push(route.request().resourceType());
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        let navigations = 0;
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) navigations++;
        });
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.name));
        await page.goto(origin);
        await page.waitForFunction(
            () => window.passwordProof?.snapshot().hydrated
        );
        const first = page.locator('[data-host=first]');
        const second = page.locator('[data-host=second]');
        const input = first.getByLabel('Password', { exact: true });
        const secondInput = second.getByLabel('Password', { exact: true });
        const button = first.getByRole('button', { name: 'Next' });
        const secondButton = second.getByRole('button', { name: 'Next' });
        const snapshot = () =>
            page.evaluate(() => window.passwordProof.snapshot());
        const settle = (index, type) =>
            page.evaluate(
                ([index, type]) => window.passwordProof.settle(index, type),
                [index, type]
            );
        const replace = (id, revision) =>
            page.evaluate(
                ([id, revision]) => window.passwordProof.replace(id, revision),
                [id, revision]
            );
        const geometry = await first.locator('form').evaluate((form) => {
            const label = form.querySelector('label');
            const input = form.querySelector('input');
            const button = form.querySelector('button');
            return {
                panel: form.getBoundingClientRect().toJSON(),
                label: label.getBoundingClientRect().toJSON(),
                input: input.getBoundingClientRect().toJSON(),
                button: button.getBoundingClientRect().toJSON(),
                panelRadius: getComputedStyle(form).borderRadius,
                panelColor: getComputedStyle(form).backgroundColor,
                inputRadius: getComputedStyle(input).borderRadius,
                inputSize: getComputedStyle(input).fontSize,
                buttonColor: getComputedStyle(button).backgroundColor,
            };
        });
        assertGeometry(geometry, width);
        const screenshot = async (name) => {
            if (output)
                await first.screenshot({
                    path: join(
                        output,
                        `password-${format}-${width}-${name}.png`
                    ),
                });
        };
        const initial = await snapshot();
        assert.equal(initial.hydratedExistingInput, true);
        assert.equal(await button.isDisabled(), true);
        assert.equal(await secondButton.isDisabled(), true);
        assert.notEqual(
            await input.getAttribute('id'),
            await secondInput.getAttribute('id')
        );
        await screenshot('empty');
        await input.press('Enter');
        assert.deepEqual((await snapshot()).checks, []);
        const privateDraft = '  synthetic\u200Dß!?  ';
        await input.fill(privateDraft);
        assert.equal(await input.getAttribute('value'), null);
        assert.equal(
            await input.evaluate(
                (node) =>
                    getComputedStyle(node).outlineStyle === 'solid' &&
                    getComputedStyle(node).outlineOffset === '2px' &&
                    getComputedStyle(node).boxShadow.includes(
                        'rgb(79, 70, 229)'
                    )
            ),
            true
        );
        await screenshot('focus');
        await input.press('Enter');
        await button.waitFor();
        assert.equal(await button.isDisabled(), true);
        assert.equal(await input.isEditable(), true);
        assert.equal(
            await first.getByRole('status').textContent(),
            'Checking password'
        );
        const spinner = await first.locator('button svg').boundingBox();
        assert.equal(spinner?.width, 16);
        assert.equal(spinner?.height, 16);
        await screenshot('pending');
        await input.fill('corrected');
        assert.equal(await input.getAttribute('value'), null);
        await input.press('Enter');
        assert.deepEqual((await snapshot()).checks, [
            { instance: 'first', exactDraft: true, corrected: false },
        ]);
        await settle(0, 'wrong');
        await first.getByRole('alert').waitFor();
        assert.equal(
            await first.getByRole('alert').textContent(),
            'Incorrect password'
        );
        assert.equal(await button.isEnabled(), true);
        await screenshot('wrong');
        await secondInput.fill('other');
        await secondInput.press('Enter');
        await settle(1, 'wrong');
        await second.getByRole('alert').waitFor();
        const firstErrorId = await input.getAttribute('aria-describedby');
        const secondErrorId =
            await secondInput.getAttribute('aria-describedby');
        assert(firstErrorId && secondErrorId);
        assert.notEqual(firstErrorId, secondErrorId);
        assert.equal(
            firstErrorId,
            await first.getByRole('alert').getAttribute('id')
        );
        assert.equal(
            secondErrorId,
            await second.getByRole('alert').getAttribute('id')
        );
        await input.press('Enter');
        await settle(2, 'blocked');
        await first.getByText('Too many attempts').waitFor();
        assert.equal(await button.isDisabled(), true);
        await screenshot('blocked');
        await input.fill('locked edit');
        await input.press('Enter');
        assert.equal((await snapshot()).checks.length, 3);
        await replace('replacement', 0);
        assert.equal(await input.inputValue(), '');
        assert.equal(await first.getByRole('alert').count(), 0);
        await input.fill('retired');
        await input.press('Enter');
        await replace('A', 0);
        assert.equal(await input.inputValue(), '');
        await input.fill('current');
        await input.press('Enter');
        await settle(3, 'blocked');
        assert.equal(
            await first.getByRole('status').textContent(),
            'Checking password'
        );
        assert.equal(await first.getByRole('alert').count(), 0);
        assert.equal(await input.inputValue(), 'current');
        await settle(4, 'correct');
        await page.waitForFunction(
            () => document.querySelector('[data-host=first] input').value === ''
        );
        assert.equal(await button.isDisabled(), true);
        assert.equal(
            await second.getByRole('alert').textContent(),
            'Incorrect password'
        );
        const final = await snapshot();
        assert.deepEqual(
            final.checks.map(({ instance }) => instance),
            ['first', 'second', 'first', 'first', 'first']
        );
        assert.equal(final.checks[2].corrected, true);
        assert.equal(final.trustedSubmits, 5);
        assert.deepEqual(final.hydrationErrors, []);
        assert.deepEqual(servedAssets.sort(), [
            'document',
            'script',
            'stylesheet',
        ]);
        assert.deepEqual(unexpectedRequests, []);
        assert.deepEqual(pageErrors, []);
        assert.equal(navigations, 1);
        assert.deepEqual(await page.evaluate(() => window.passwordEffects), {
            storage: 0,
            policy: 0,
        });
        return {
            format,
            width,
            geometry,
            cssSha256: createHash('sha256').update(css).digest('hex'),
            react: final.react,
            trustedSubmits: final.trustedSubmits,
            exactDraft: final.checks[0].exactDraft,
            corrected: final.checks[2].corrected,
            hydrationErrors: 0,
            unexpectedRequests: 0,
            navigationsAfterInitialLoad: 0,
            storageAccesses: 0,
            realVerificationCalls: 0,
        };
    } finally {
        try {
            if (context) await context.close();
        } finally {
            if (server?.listening) {
                server.closeAllConnections();
                await new Promise((resolve) => server.close(resolve));
            }
            rmSync(directory, { recursive: true, force: true });
        }
    }
}

export async function checkCompleteExtensionPasswordBrowser({
    browser,
    consumer,
    evidence,
    output,
    expectedReactVersion,
}) {
    evidence.status = 'running';
    evidence.results = [];
    try {
        for (const format of ['esm', 'cjs']) {
            for (const width of [390, 1024]) {
                const result = await checkInstalledFormat({
                    browser,
                    consumer,
                    format,
                    output,
                    width,
                });
                assert.equal(result.react, expectedReactVersion);
                evidence.results.push(result);
            }
        }
        evidence.status = 'passed';
    } catch (error) {
        evidence.status = 'failed';
        throw error;
    }
}
