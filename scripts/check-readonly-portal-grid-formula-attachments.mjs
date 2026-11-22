// Pass a packed SDK, its SHA-256, a new result directory, and a Chromium executable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const [archivePath, archiveSha256, outputPath, chromePath] =
    process.argv.slice(2);
assert(
    archivePath &&
        outputPath &&
        chromePath &&
        /^[a-f0-9]{64}$/.test(archiveSha256),
    'Provide the archive, SHA-256, new result directory, and Chromium executable'
);
const archive = realpathSync(archivePath);
const output = resolve(outputPath);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const [checkout, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const fixture = readFileSync(
    new URL(
        './readonly-portal-grid-formula-attachments-fixture.mjs',
        import.meta.url
    ),
    'utf8'
);
assert.equal(hash(readFileSync(archive)), archiveSha256);
const readArchive = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256: archiveSha256,
});
mkdirSync(output);

const stylesheetNames = [
    'readonly-portal-grid.css',
    'field-presentation.css',
    'html-description.css',
    'complete-readonly-text.css',
    'complete-checkbox.css',
    'readonly-url-gallery.css',
    'attachment-preview.css',
];
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Formula gallery fixture</title>
    <link rel="icon" href="data:,"><link rel="stylesheet" href="/readonly-portal-grid.css"><link rel="stylesheet" href="/readonly-url-gallery.css"><link rel="stylesheet" href="/attachment-preview.css">
    <style>body{font:16px system-ui;margin:18px}#root{width:550px;max-width:100%}#before-gallery{margin:0 0 8px}</style>
    <main id="root"></main><script defer src="/fixture.js"></script></html>`;
const images = {
    '/first.png': { width: 120, height: 80, type: 'image/png' },
    '/second.jpg': { width: 96, height: 110, type: 'image/jpeg' },
};
const imageAssets = Object.entries(images).map(([path, { type }]) => [
    path,
    {
        type,
        bytes: readFileSync(
            new URL(`../test/fixtures/formula-grid${path}`, import.meta.url)
        ),
    },
]);

async function buildProfile(directory, format) {
    const file = format === 'esm' ? 'fixture.mjs' : 'fixture.cjs';
    writeFileSync(
        join(directory, file),
        transformSync(fixture, { format, loader: 'js', target: 'es2022' }).code
    );
    const bundle = await build({
        entryPoints: [file],
        absWorkingDir: directory,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
    });
    await assertBrowserInputs(bundle.metafile, directory);
    const installed = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    const inputs = Object.keys(bundle.metafile.inputs).map((input) =>
        realpathSync(resolve(directory, input))
    );
    const modules = [
        'react/index.js',
        'react/ReadonlyPortalGrid.js',
        'react/ReadOnlyURLGallery.js',
        'ui/index.js',
    ];
    for (const module of modules) {
        const path = `dist/${format}/${module}`;
        const installedPath = join(installed, path);
        assert(inputs.includes(installedPath), `Missing packed entry ${path}`);
        assert.deepEqual(
            readFileSync(installedPath),
            readArchive(`package/${path}`)
        );
    }
    assert(
        !inputs.some((path) =>
            path.startsWith(
                join(installed, 'dist', format === 'esm' ? 'cjs' : 'esm') + '/'
            )
        ),
        'Mixed installed SDK export conditions'
    );
    const styles = stylesheetNames.map((name) => {
        const member = `dist/esm/react/${name}`;
        const bytes = readFileSync(join(installed, member));
        assert.deepEqual(bytes, readArchive(`package/${member}`));
        return ['/' + name, { type: 'text/css', bytes }];
    });
    return new Map([
        ['/', { type: 'text/html', bytes: html }],
        [
            '/fixture.js',
            { type: 'text/javascript', bytes: bundle.outputFiles[0].contents },
        ],
        ...styles,
        ...imageAssets,
    ]);
}

async function tabTo(page, target) {
    for (let index = 0; index < 12; index++) {
        await page.keyboard.press('Tab');
        if (await target.evaluate((node) => document.activeElement === node))
            return index + 1;
    }
    throw new Error('Tab did not reach the expected gallery control');
}

async function imageView(page, dialog, path, position) {
    await dialog.getByText(position, { exact: true }).waitFor();
    const image = dialog.locator('.mx-sdk-url-gallery__preview img');
    await image.waitFor({ state: 'visible' });
    await image.evaluate((node) => node.decode());
    const view = await dialog.evaluate((node) => {
        const image = node.querySelector('.mx-sdk-url-gallery__preview img');
        const grid = document
            .querySelector('.mx-sdk-readonly-grid__viewport')
            ?.getBoundingClientRect();
        const rect = node.getBoundingClientRect();
        const picture = image.getBoundingClientRect();
        const withinViewport = (box) =>
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= innerWidth &&
            box.bottom <= innerHeight &&
            box.width > 0 &&
            box.height > 0;
        const points = [
            [rect.left + 14, rect.top + 14],
            [rect.right - 14, rect.top + 14],
            [rect.left + 14, rect.bottom - 14],
            [rect.right - 14, rect.bottom - 14],
            [picture.x + picture.width / 2, picture.y + picture.height / 2],
        ];
        return {
            position: node.querySelector('.mx-sdk-url-gallery__position')
                .textContent,
            imagePath: new URL(image.currentSrc).pathname,
            naturalSize: [image.naturalWidth, image.naturalHeight],
            dialog: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            },
            imageInsideViewport: withinViewport(picture),
            dialogInsideViewport: withinViewport(rect),
            imageHit: document.elementFromPoint(...points.at(-1)) === image,
            paintedPoints: points.map(([x, y]) => ({
                inDialog:
                    document
                        .elementFromPoint(x, y)
                        ?.closest('[role="dialog"]') === node,
                outsideGrid:
                    grid == null ||
                    x < grid.left ||
                    x > grid.right ||
                    y < grid.top ||
                    y > grid.bottom,
            })),
        };
    });
    const { width, height } = images[path];
    assert.equal(view.imagePath, path);
    assert.equal(view.position, position);
    assert.deepEqual(view.naturalSize, [width, height]);
    assert(
        view.imageInsideViewport && view.dialogInsideViewport && view.imageHit,
        JSON.stringify(view)
    );
    assert(
        view.paintedPoints.every(({ inDialog }) => inDialog),
        JSON.stringify(view)
    );
    assert(
        view.paintedPoints.some(({ outsideGrid }) => outsideGrid),
        JSON.stringify(view)
    );
    assert(
        view.dialog.width > page.viewportSize().width * 0.8,
        'Dialog should span the viewport, not the Formula cell'
    );
    return view;
}

async function exercise(browser, origin, assets, mode, screenshotPath) {
    const context = await browser.newContext({
        viewport: { width: 1000, height: 700 },
        serviceWorkers: 'block',
    });
    const imageRequests = [],
        unexpected = [],
        errors = [],
        navigations = [];
    let interactive = false;
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const asset = assets.get(url.pathname);
            const image = Object.hasOwn(images, url.pathname);
            if (
                url.origin === origin &&
                request.method() === 'GET' &&
                asset &&
                (!interactive || image)
            ) {
                if (image)
                    imageRequests.push({
                        path: url.pathname,
                        type: request.resourceType(),
                    });
                return route.continue();
            }
            unexpected.push({
                path: url.pathname,
                method: request.method(),
                origin: url.origin,
            });
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(
            mode === 'standalone' ? origin + '/?standalone' : origin
        );
        page.on('framenavigated', (frame) => navigations.push(frame.url()));
        const trigger = page.getByRole('button', {
            name: origin + '/first.png',
            exact: true,
        });
        await trigger.waitFor({ state: 'attached' });
        interactive = true;
        assert.equal(
            await trigger.evaluate((node) =>
                node.closest('.mx-sdk-url-gallery').getAttribute('data-grid')
            ),
            String(mode === 'grid')
        );
        const exactTrigger = await trigger.elementHandle();
        const neighbor = page.locator('[data-record-id="recNeighbor"]');
        const neighborNode =
            mode === 'grid' ? await neighbor.elementHandle() : null;
        const viewport = page.locator('.mx-sdk-readonly-grid__viewport');
        if (mode === 'grid') {
            assert.equal(
                await neighbor.locator('[data-primary="true"]').textContent(),
                'Keep neighbor'
            );
            await viewport.evaluate((node) => {
                node.scrollLeft = 350;
            });
        }
        await page.locator('#before-gallery').focus();
        const tabsToThumbnail = await tabTo(page, trigger);
        const scrollLeft =
            mode === 'grid'
                ? await viewport.evaluate((node) => node.scrollLeft)
                : null;
        if (mode === 'grid')
            assert(
                scrollLeft > 0,
                'Thumbnail must be activated in a horizontally scrolled Grid'
            );
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
            name: 'Formula attachment preview',
        });
        const close = dialog.getByRole('button', {
            name: 'Close',
            exact: true,
        });
        await close.waitFor({ state: 'visible' });
        assert(
            await close.evaluate((node) => document.activeElement === node),
            'Close receives initial focus'
        );
        const first = await imageView(page, dialog, '/first.png', '1 / 2');
        if (screenshotPath) await page.screenshot({ path: screenshotPath });
        const next = dialog.getByRole('button', { name: 'Next', exact: true });
        const tabsToNext = await tabTo(page, next);
        await page.keyboard.press('Enter');
        const second = await imageView(page, dialog, '/second.jpg', '2 / 2');
        assert(
            await close.evaluate((node) => document.activeElement === node),
            'Next focuses Close at the final attachment'
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        const exactFocusReturn = await exactTrigger.evaluate(
            (node) => node.isConnected && document.activeElement === node
        );
        assert(
            exactFocusReturn,
            'Escape must return focus to the original thumbnail node'
        );
        if (mode === 'grid')
            assert.equal(
                await viewport.evaluate((node) => node.scrollLeft),
                scrollLeft
            );
        let neighborStable = null;
        if (neighborNode) {
            neighborStable = await neighborNode.evaluate(
                (node) =>
                    node.isConnected &&
                    document.querySelector('[data-record-id="recNeighbor"]') ===
                        node &&
                    node.querySelector('[data-primary="true"]').textContent ===
                        'Keep neighbor'
            );
            assert(neighborStable);
        }
        const state = await page.evaluate(() => window.readFormulaGallery());
        assert.deepEqual(state.effects, {
            opens: 0,
            writes: 0,
            submits: 0,
            runtimeRequests: 0,
        });
        assert(state.recordsUnchanged);
        if (mode === 'grid')
            assert.deepEqual(state.deliveries.fldFormula, {
                context: 'portal-detail',
                physicalKind: 'formula',
                computed: true,
                capability: 'readonly',
                type: 'formula',
            });
        const actionKeys = state.trusted.filter(({ key }) => key !== 'Tab');
        assert.deepEqual(actionKeys.slice(0, 2), [
            { key: 'Enter', trusted: true, action: origin + '/first.png' },
            { key: 'Enter', trusted: true, action: 'Next' },
        ]);
        assert.equal(actionKeys.length, 3);
        assert(
            actionKeys[2].key === 'Escape' && actionKeys[2].trusted === true
        );
        assert(
            state.trusted
                .filter(({ key }) => key === 'Tab')
                .every(({ trusted }) => trusted)
        );
        assert(imageRequests.every(({ type }) => type === 'image'));
        assert.deepEqual(
            [...new Set(imageRequests.map(({ path }) => path))].sort(),
            Object.keys(images)
        );
        assert.deepEqual(unexpected, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(navigations, []);
        return {
            mode,
            scrollLeft,
            tabsToThumbnail,
            tabsToNext,
            first,
            second,
            exactFocusReturn,
            neighborStable,
            state,
            imageRequests,
            unexpected,
            errors,
            navigations,
        };
    } finally {
        await context.close();
    }
}

async function runProfile(browser, assets, react, format) {
    const rejected = [];
    const server = createServer((request, response) => {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        const asset = request.method === 'GET' && assets.get(path);
        if (!asset) {
            rejected.push(path);
            response.writeHead(404).end();
            return;
        }
        response
            .writeHead(200, {
                'Content-Type': asset.type,
                'Cache-Control': 'no-store',
            })
            .end(asset.bytes);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    try {
        const results = [];
        for (const mode of ['standalone', 'grid']) {
            try {
                const screenshotPath =
                    react === '19.2.0' && format === 'esm'
                        ? join(output, `${mode}-dialog.png`)
                        : undefined;
                results.push(
                    await exercise(
                        browser,
                        origin,
                        assets,
                        mode,
                        screenshotPath
                    )
                );
            } catch (error) {
                results.push({ mode, error: error.message });
            }
        }
        return { format, results, rejected };
    } finally {
        server.closeAllConnections();
        await new Promise((done, reject) =>
            server.close((error) => (error ? reject(error) : done()))
        );
    }
}

const receipt = {
    checkout,
    tree,
    archiveSha256,
    runnerSha256: hash(readFileSync(new URL(import.meta.url))),
    fixtureSha256: hash(fixture),
    imageSha256: Object.fromEntries(
        imageAssets.map(([path, { bytes }]) => [path, hash(bytes)])
    ),
    profiles: [],
};
let browser;
try {
    browser = await chromium.launch({
        executablePath: chromePath,
        headless: true,
        chromiumSandbox: true,
    });
    receipt.browser = browser.version();
    for (const react of ['18.3.1', '19.2.0']) {
        const directory = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-formula-grid-'))
        );
        try {
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archive}`,
                        react,
                        'react-dom': react,
                    },
                })
            );
            const installation = installAgeQualifiedConsumer({
                directory,
                args: ['install'],
            });
            assert.equal(installation.archiveSha256, archiveSha256);
            for (const peer of ['react', 'react-dom']) {
                assert.equal(
                    JSON.parse(
                        readFileSync(
                            join(
                                directory,
                                'node_modules',
                                peer,
                                'package.json'
                            )
                        )
                    ).version,
                    react
                );
            }
            for (const format of ['esm', 'cjs']) {
                const profile = await runProfile(
                    browser,
                    await buildProfile(directory, format),
                    react,
                    format
                );
                receipt.profiles.push({ react, ...profile });
                console.log(
                    JSON.stringify({
                        react,
                        format,
                        results: profile.results.map(({ mode, error }) => ({
                            mode,
                            error,
                        })),
                    })
                );
            }
        } finally {
            rmSync(directory, { recursive: true });
        }
    }
    assert.equal(hash(readFileSync(archive)), archiveSha256);
    for (const { react, format, results, rejected } of receipt.profiles) {
        for (const result of results)
            assert.equal(
                result.error,
                undefined,
                `${react} ${format} ${result.mode}: ${result.error}`
            );
        assert.deepEqual(rejected, []);
        assert.deepEqual(results[1].first.dialog, results[0].first.dialog);
        assert.deepEqual(results[1].second.dialog, results[0].second.dialog);
    }
    receipt.status = 'passed';
} catch (error) {
    receipt.status = 'failed';
    receipt.error = error.message;
    throw error;
} finally {
    try {
        if (browser) await browser.close();
    } finally {
        await stop();
        writeFileSync(
            join(output, 'report.json'),
            JSON.stringify(receipt, null, 2) + '\n'
        );
    }
}
