import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

// Native FormLoaded and Button at c0780ad5. Restrict the CSS reference to
// the used Tailwind layout, typography, primary theme and focus utilities.
const nativeRevision = 'c0780ad5fe65bd4ef84365637182630020301a08';
const nativeCSS = `
    * { box-sizing: border-box; border: 0 solid; }
    html { font-family: Arial, sans-serif; font-size: 16px; line-height: 1.5; }
    body { margin: 0; padding: 16px; color: #1f2937; background: white; }
    button { font: inherit; color: inherit; margin: 0; padding: 0; background: transparent; }
    section { margin-bottom: 16px; }
    .child { max-width: 520px; }
    .footer-row { display: flex; flex-direction: column; width: 100%; max-width: 20rem; margin-inline: auto; gap: .375rem; padding-block: .5rem; }
    .child .footer-row { padding-inline: .5rem; }
    @media (min-width: 640px) { .footer-row { flex-direction: row; max-width: none; margin-inline: 0; } }
    .native-primary {
        display: inline-flex; align-items: center; justify-content: center; white-space: nowrap;
        background-color: #2563eb; color: #fff; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        padding: .5rem .75rem; font-size: .875rem; line-height: 1.25rem;
        font-weight: 600; border-radius: .375rem;
    }
    .native-primary:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .native-footer-icon { display: block; width: 1rem; height: 1rem; margin-right: .5rem; }
`;
const reference = readFileSync(
    new URL('./form-readonly-footer-native-icons.json', import.meta.url),
    'utf8'
);
const fixture = readFileSync(
    new URL('./form-readonly-footer-parity-fixture.mjs', import.meta.url),
    'utf8'
);

const [archiveArg, expectedSha256, outputArg, chromePath] =
    process.argv.slice(2);
assert(archiveArg && outputArg && chromePath);
assert.match(expectedSha256, /^[a-f0-9]{64}$/);
const archive = realpathSync(archiveArg);
const hash = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(hash(readFileSync(archive)), expectedSha256);
const output = resolve(outputArg);
mkdirSync(output);
const readArchive = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256,
});
const report = {
    nativeRevision,
    archiveSha256: expectedSha256,
    fixtureSha256: hash(fixture),
    profiles: [],
    cleanup: {},
};
const origin = 'http://footer-parity.test';
const html =
    '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Read-only Form footer parity</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/native.css"><link rel="stylesheet" href="/footer.css"><main></main><script src="/icons.js" defer></script><script src="/footer.js" defer></script></html>';
const failures = [];

async function bundle(root, format) {
    const entry = format === 'esm' ? 'fixture.mjs' : 'fixture.cjs';
    writeFileSync(join(root, entry), transformSync(fixture, { format }).code);
    const result = await build({
        absWorkingDir: root,
        entryPoints: [entry],
        outfile: 'footer.js',
        write: false,
        bundle: true,
        metafile: true,
        platform: 'browser',
    });
    await assertBrowserInputs(result.metafile, root);
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const used = [];
    for (const input of Object.keys(result.metafile.inputs)) {
        const path = realpathSync(resolve(root, input));
        if (!path.startsWith(installed + sep)) continue;
        const member =
            'package/' + relative(installed, path).split(sep).join('/');
        assert.deepEqual(readFileSync(path), readArchive(member), member);
        used.push(member);
    }
    assert(
        used.includes(
            'package/dist/' +
                format +
                '/react/CompleteFormReadonlyFooterActions.js'
        )
    );
    assert(
        used.some((member) => member.endsWith('/react/form-completion.css'))
    );
    return new Map([
        ['/native.css', ['text/css', nativeCSS]],
        [
            '/icons.js',
            ['text/javascript', 'globalThis.nativeFooterIcons = ' + reference],
        ],
        ...result.outputFiles.map((file) => [
            '/' + file.path.split(sep).at(-1),
            [
                file.path.endsWith('.css') ? 'text/css' : 'text/javascript',
                file.text,
            ],
        ]),
    ]);
}

function assertGeometry(result, react) {
    const { snapshot, evidence, focused, focusColor, width, language } = result;
    assert.equal(evidence.react, react);
    assert.deepEqual(snapshot['candidate-root'], snapshot['reference-root']);
    assert.deepEqual(snapshot['candidate-child'], snapshot['reference-child']);
    for (const controls of Object.values(snapshot)) {
        for (const button of controls) {
            assert.deepEqual(button.icon?.slice(2), [16, 16]);
            assert.equal(button.gap, 8);
            assert.equal(button.hidden, 'true');
            assert.equal(button.type, 'button');
        }
    }
    assert.equal(snapshot['candidate-root'][0].button[0], 0);
    assert.equal(snapshot['candidate-child'][0].button[0], 8);
    assert.equal(snapshot.standalone[0].border, '1px');
    assert.equal(snapshot.standalone[0].background, 'rgba(0, 0, 0, 0)');
    assert.equal(focused, true);
    assert.equal(focusColor, 'rgb(37, 99, 235)');
    const expectedRoutes = [
        [
            'candidate-root',
            'submit_another_form',
            '/survey?campaign=footer#details',
        ],
        [
            'candidate-root',
            'copy_form',
            '/survey?campaign=footer&recordIdToCopyFrom=recSource#details',
        ],
        [
            'candidate-child',
            'copy_form',
            '/survey?campaign=footer&recordIdToCopyFrom=recSource#details',
        ],
    ];
    assert.deepEqual(
        evidence.navigations.map(({ surface, command, destination }) => [
            surface,
            command,
            destination,
        ]),
        expectedRoutes,
        width + '/' + language
    );
    assert.equal(evidence.location, expectedRoutes[2][2]);
    assert.equal(evidence.submits, 0);
    assert.deepEqual(evidence.clicks, [
        { trusted: true, detail: 0 },
        { trusted: true, detail: 0 },
        { trusted: true, detail: 0 },
    ]);
}

let browser;
try {
    browser = await chromium.launch({
        executablePath: realpathSync(chromePath),
        chromiumSandbox: true,
    });
    report.chromium = browser.version();
    for (const react of ['18.3.1', '19.2.0']) {
        const root = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-form-footer-'))
        );
        try {
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    private: true,
                    dependencies: {
                        '@miniextensions/sdk': 'file:' + archive,
                        react,
                        'react-dom': react,
                    },
                })
            );
            const install = installAgeQualifiedConsumer({
                directory: root,
                args: ['install'],
            });
            assert.equal(install.archiveSha256, expectedSha256);
            for (const format of ['esm', 'cjs']) {
                const assets = await bundle(root, format);
                const profile = { react, format, scenarios: [] };
                report.profiles.push(profile);
                for (const [width, language] of [
                    [1280, 'en'],
                    [375, 'fr'],
                ]) {
                    const context = await browser.newContext({
                        viewport: { width, height: 860 },
                        locale: language,
                    });
                    const result = {
                        width,
                        language,
                        requests: [],
                        errors: [],
                    };
                    profile.scenarios.push(result);
                    try {
                        await context.route('**/*', async (route) => {
                            const url = new URL(route.request().url());
                            const asset =
                                url.pathname === '/'
                                    ? ['text/html', html]
                                    : assets.get(url.pathname);
                            if (
                                route.request().method() === 'GET' &&
                                url.origin === origin &&
                                asset
                            )
                                return route.fulfill({
                                    contentType: asset[0],
                                    body: asset[1],
                                    headers: {
                                        'Content-Security-Policy':
                                            "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'none'; form-action 'none'",
                                    },
                                });
                            result.requests.push(route.request().url());
                            return route.abort();
                        });
                        const page = await context.newPage();
                        page.setDefaultTimeout(5000);
                        page.on('pageerror', (error) =>
                            result.errors.push(error.message)
                        );
                        await page.goto(origin + '/?lang=' + language);
                        const rootButtons = page.locator(
                            '[data-surface="candidate-root"] button'
                        );
                        await rootButtons.nth(1).waitFor();
                        result.snapshot = await page.evaluate(() =>
                            window.footerProof.snapshot()
                        );
                        await page.keyboard.press('Tab');
                        await page.keyboard.press('Tab');
                        await page.keyboard.press('Tab');
                        result.focused = await rootButtons
                            .nth(0)
                            .evaluate(
                                (button) =>
                                    button === document.activeElement &&
                                    button.matches(':focus-visible')
                            );
                        result.focusColor = await rootButtons
                            .nth(0)
                            .evaluate(
                                (button) =>
                                    getComputedStyle(button).outlineColor
                            );
                        const screenshot =
                            [react, format, width, language].join('-') + '.png';
                        await page.screenshot({
                            path: join(output, screenshot),
                            animations: 'disabled',
                        });
                        result.screenshot = screenshot;
                        await page.keyboard.press('Enter');
                        await page.keyboard.press('Tab');
                        await page.keyboard.press('Enter');
                        const childCopy = page.locator(
                            '[data-surface="candidate-child"] button'
                        );
                        await childCopy.focus();
                        await page.keyboard.press('Enter');
                        result.evidence = await page.evaluate(() =>
                            window.footerProof.evidence()
                        );
                        await page.evaluate(() => window.footerProof.unmount());
                        assert.equal(
                            await page.locator('main button').count(),
                            0
                        );
                        assert.deepEqual(result.requests, []);
                        assert.deepEqual(result.errors, []);
                        assertGeometry(result, react);
                        result.status = 'passed';
                    } catch (error) {
                        result.status = 'failed';
                        failures.push([
                            react,
                            format,
                            width,
                            language,
                            error.message,
                        ]);
                    } finally {
                        await context.close();
                    }
                }
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }
    report.cleanup.consumersRemoved = true;
} finally {
    try {
        await browser?.close();
        report.cleanup.browserClosed = true;
    } finally {
        await stop();
        report.failures = failures;
        writeFileSync(
            join(output, 'report.json'),
            JSON.stringify(report, null, 2) + '\n'
        );
    }
}
console.log(
    JSON.stringify({
        output,
        profiles: report.profiles.length,
        failures: failures.map((entry) => entry.slice(0, 4)),
        cleanup: report.cleanup,
    })
);
assert.equal(
    failures.length,
    0,
    'Read-only Form footer parity failed. See report.json.'
);
