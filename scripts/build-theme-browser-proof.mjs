// Build installed synthetic pages; exercise them with the supported browser tool.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

export function browserMain() {
    const h = React.createElement;
    const owner = { token: {}, isCurrent: () => true };
    const writes = [];
    const numeric = {
        physicalKind: 'number',
        presentation: {
            type: 'physical',
            config: { type: 'number', options: { precision: 2 } },
        },
        fieldId: 'number',
        title: 'Amount',
        field: {
            id: 'number',
            name: 'Amount',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        displayConfig: { numberSeparator: 'period-comma' },
        value: 12.3,
        context: 'form',
        computed: false,
        dirty: false,
        pending: false,
        validation: [],
        error: null,
        capability: {
            type: 'editable',
            setValue(value) {
                writes.push(value);
                return { accepted: true };
            },
        },
    };
    const roots = [
        createRoot(document.getElementById('preview')),
        createRoot(document.getElementById('editor')),
    ];
    // Independent React root beneath a DOM-only semantic override: omission inherits.
    const domParent = document.createElement('section');
    for (const [key, value] of Object.entries(
        UI.getThemeStyles('yellow-light')
    ))
        domParent.style.setProperty(key, value);
    domParent.style.setProperty(
        '--mx-sdk-button-foreground',
        'rgb(11, 12, 13)'
    );
    domParent.className = 'mx-sdk-theme';
    domParent.dataset.mxTheme = 'yellow-light';
    document.body.append(domParent);
    const inner = document.createElement('div');
    domParent.append(inner);
    const third = createRoot(inner);
    flushSync(() =>
        third.render(
            h(
                SDK.ThemeBoundary,
                { id: 'unnamed' },
                h(
                    'button',
                    { className: 'mx-sdk-button', id: 'unnamed-button' },
                    'Unnamed inherited boundary'
                )
            )
        )
    );
    let theme = 'green',
        custom = false,
        visible = true;
    function Portal() {
        return createPortal(
            h(
                'div',
                {
                    ...SDK.getThemePortalProps(SDK.useThemeSnapshot()),
                    id: 'detached',
                },
                h(
                    'button',
                    { className: 'mx-sdk-button', id: 'portal-button' },
                    'Portal button'
                )
            ),
            document.getElementById('portal')
        );
    }
    const button = (id, label, color, disabled = false) =>
        h(
            'div',
            { id },
            h(SDK.ButtonField, {
                revision: 0,
                phase: 'idle',
                busy: false,
                canLink: false,
                canTrigger: !disabled,
                feedback: null,
                language: 'en',
                field: {
                    id,
                    name: label,
                    description: null,
                    isComputed: true,
                    isPrimaryField: false,
                    config: { type: 'button', options: null },
                },
                value: { label, url: 'synthetic.invalid' },
                config: {
                    openLinkType: 'triggerWebhookPOST',
                    buttonColor: color,
                },
                prepareLink: () => null,
                triggerWebhook: async () => ({
                    type: 'refused',
                    reason: 'Synthetic presentation only',
                }),
                cancel: () => false,
                acknowledgeNewIntent: () => false,
            })
        );
    const fields = () =>
        h(
            React.Fragment,
            null,
            h(SDK.CompleteLocalizedNumericField, {
                field: numeric,
                options: {
                    owner,
                    input: { id: 'numeric' },
                    className: 'native-numeric',
                },
            }),
            h(SDK.CompleteDurationField, {
                fieldId: 'duration',
                sessionId: 'synthetic',
                format: 'h:mm',
                value: 60,
                onChange: (value) => writes.push(value),
                owner,
                title: 'Duration',
                inputId: 'duration',
                className: 'native-complete-duration',
            }),
            button('inherited-button', 'Inherited button'),
            button(
                'configured-button',
                'Configured light button',
                'yellow-light'
            ),
            button('disabled-button', 'Disabled button', undefined, true),
            h(SDK.CompleteLocalizedNumericField, {
                field: { ...numeric, error: 'Synthetic invalid' },
                options: {
                    owner,
                    input: { id: 'invalid-numeric' },
                    className: 'native-numeric',
                },
            }),
            h(SDK.CompleteDurationField, {
                fieldId: 'invalid-duration',
                sessionId: 'synthetic',
                format: 'h:mm',
                value: 60,
                onChange: () => {},
                owner,
                title: 'Invalid Duration',
                inputId: 'invalid-duration',
                invalid: true,
                className: 'native-complete-duration',
            }),
            h(SDK.TextInput, {
                'aria-label': 'Fixed text',
                id: 'fixed',
                value: 'Fixed default',
                readOnly: true,
            }),
            h(
                SDK.ThemeBoundary,
                { theme: 'indigo', id: 'nested' },
                h(
                    'button',
                    { className: 'mx-sdk-button', id: 'nested-button' },
                    'Nested indigo'
                )
            ),
            h(Portal)
        );
    function publish() {
        flushSync(() =>
            roots[0].render(
                visible
                    ? h(
                          React.StrictMode,
                          null,
                          h(
                              SDK.ThemeBoundary,
                              {
                                  theme,
                                  tokens: custom
                                      ? {
                                            ...UI.getThemeStyles(theme),
                                            '--theme-600': '1 2 3',
                                        }
                                      : undefined,
                                  id: 'theme-root',
                                  style: {
                                      backgroundColor: 'rgb(var(--theme-100))',
                                      padding: 20,
                                  },
                              },
                              fields()
                          )
                      )
                    : null
            )
        );
    }
    flushSync(() =>
        roots[1].render(
            h(
                SDK.ThemeBoundary,
                { theme: 'blue', id: 'editor-root' },
                h(
                    'button',
                    { className: 'mx-sdk-button', id: 'editor-button' },
                    'Editor blue'
                ),
                h(
                    SDK.ThemeBoundary,
                    {
                        theme: 'green',
                        id: 'semantic-parent',
                        style: {
                            '--mx-sdk-accent': 'rgb(90 80 70)',
                            '--mx-sdk-button-foreground': 'rgb(11 12 13)',
                        },
                    },
                    h(
                        SDK.ThemeBoundary,
                        { id: 'semantic-inherit' },
                        h(
                            'button',
                            {
                                className: 'mx-sdk-button',
                                id: 'semantic-button',
                            },
                            'Inherited semantic override'
                        ),
                        h(SDK.CompleteDurationField, {
                            fieldId: 'semantic-duration',
                            sessionId: 'semantic',
                            owner,
                            format: 'h:mm',
                            value: 60,
                            onChange: (value) => writes.push(value),
                            title: 'Inherited Duration',
                            inputId: 'semantic-duration',
                        })
                    )
                )
            )
        )
    );
    publish();
    const settleTransitions = async () => {
        await new Promise(requestAnimationFrame);
        await Promise.all(
            document
                .getAnimations()
                .filter(
                    (animation) =>
                        animation.effect?.getComputedTiming().iterations !==
                        Infinity
                )
                .map((animation) => animation.finished.catch(() => {}))
        );
    };
    const results = document.getElementById('results');
    const rgb = (raw) => `rgb(${raw.split(' ').join(', ')})`;
    const check = (condition, message) => {
        if (!condition) throw Error(message);
    };
    const style = (id) => {
        const node = document.getElementById(id);
        return getComputedStyle(
            [
                'inherited-button',
                'configured-button',
                'disabled-button',
            ].includes(id)
                ? node.querySelector('.mx-sdk-button')
                : node
        );
    };
    document.getElementById('run').onclick = async () => {
        try {
            const noCSS = document.body.dataset.noCss === 'true';
            const originalDocument = document.documentElement.style.cssText;
            for (const palette of ['green', 'rose', 'green']) {
                theme = palette;
                custom = false;
                visible = true;
                publish();
                check(
                    document
                        .getElementById('theme-root')
                        .style.getPropertyValue('--theme-600') ===
                        UI.getThemeStyles(palette)['--theme-600'],
                    'raw projection'
                );
                check(
                    document
                        .getElementById('detached')
                        .style.getPropertyValue('--theme-600') ===
                        UI.getThemeStyles(palette)['--theme-600'],
                    'explicit portal'
                );
                check(
                    style('theme-root').backgroundColor ===
                        rgb(UI.getThemeStyles(palette)['--theme-100']),
                    'native background rule'
                );
                check(
                    style('inherited-button').backgroundColor ===
                        rgb(
                            UI.getThemeStyles(noCSS ? 'blue' : palette)[
                                '--theme-600'
                            ]
                        ),
                    'inherited button'
                );
                check(
                    style('editor-button').backgroundColor ===
                        'rgb(37, 99, 235)',
                    'independent editor'
                );
                check(
                    style('nested-button').backgroundColor ===
                        rgb(
                            UI.getThemeStyles(noCSS ? 'blue' : 'indigo')[
                                '--theme-600'
                            ]
                        ),
                    'nested palette'
                );
                check(
                    style('configured-button').backgroundColor ===
                        'rgb(240, 240, 0)',
                    'configured leaf palette'
                );
                check(
                    style('configured-button').color === 'rgb(17, 24, 39)',
                    'light foreground'
                );
                document.getElementById('numeric').focus();
                await settleTransitions();
                check(
                    style('numeric').borderTopColor ===
                        rgb(UI.getThemeStyles(palette)['--theme-600']),
                    'native numeric600 local override'
                );
                document.getElementById('duration').focus();
                await settleTransitions();
                check(
                    style('duration').borderTopColor ===
                        rgb(UI.getThemeStyles(palette)['--theme-500']),
                    'native Duration500 local override'
                );
                check(
                    document
                        .getElementById('disabled-button')
                        .querySelector('button').disabled &&
                        style('disabled-button').opacity === '0.55',
                    'disabled semantics'
                );
                document.getElementById('invalid-numeric').focus();
                await settleTransitions();
                check(
                    style('invalid-numeric').borderTopColor ===
                        'rgb(185, 28, 28)',
                    'numeric invalid color'
                );
                document.getElementById('invalid-duration').focus();
                await settleTransitions();
                check(
                    style('invalid-duration').borderTopColor ===
                        'rgb(185, 28, 28)',
                    'Duration invalid color'
                );
            }
            check(
                style('unnamed-button').color === 'rgb(11, 12, 13)',
                'unnamed boundary preserves DOM ancestor foreground'
            );
            check(
                document
                    .getElementById('unnamed')
                    .getAttribute('data-mx-theme') === null,
                'no named default injection'
            );
            check(
                style('semantic-button').color === 'rgb(11, 12, 13)',
                'omitted nested boundary preserves semantic foreground'
            );
            check(
                style('semantic-button')
                    .getPropertyValue('--mx-sdk-accent')
                    .trim() === 'rgb(90 80 70)',
                'omitted nested boundary preserves semantic accent'
            );
            document.getElementById('semantic-duration').focus();
            await settleTransitions();
            check(
                style('semantic-duration').borderTopColor === 'rgb(90, 80, 70)',
                'omitted nested boundary preserves actual Duration focus accent'
            );
            custom = true;
            publish();
            check(
                document
                    .getElementById('detached')
                    .style.getPropertyValue('--theme-600') === '1 2 3',
                'custom raw snapshot'
            );
            if (!noCSS)
                check(
                    style('portal-button').backgroundColor === 'rgb(1, 2, 3)',
                    'custom detached paint'
                );
            visible = false;
            publish();
            check(!document.getElementById('detached'), 'portal teardown');
            check(
                style('editor-button').backgroundColor === 'rgb(37, 99, 235)',
                'other root after teardown'
            );
            check(
                document.documentElement.style.cssText === originalDocument,
                'document unchanged'
            );
            visible = true;
            custom = false;
            publish();
            check(
                writes.length === 0,
                'style qualification must not write canonical values'
            );
            results.textContent =
                'PASS: palettes, nested/independent roots, A-B-A, custom detached paint, local numeric600/Duration500, light foreground, disabled, background, teardown and no writes.';
            results.dataset.state = 'passed';
        } catch (error) {
            results.textContent = String(error);
            results.dataset.state = 'failed';
            throw error;
        }
    };
    document.getElementById('palette').onchange = (event) => {
        theme = event.target.value;
        publish();
    };
    document.getElementById('custom').onclick = () => {
        custom = !custom;
        publish();
    };
    document.getElementById('teardown').onclick = () => {
        visible = !visible;
        publish();
    };
    window.themeProof = {
        react: React.version,
        format: document.body.dataset.format,
    };
}

export async function buildThemeBrowserProof(archivePath, outputPath) {
    const archive = realpathSync(archivePath),
        output = resolve(outputPath);
    assert(!existsSync(output), 'Use a fresh output directory.');
    const sha256 = createHash('sha256')
        .update(readFileSync(archive))
        .digest('hex');
    const directory = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-theme-browser-'))
    );
    const receipts = [];
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        mkdirSync(output, { recursive: true });
        for (const version of ['18.3.1', '19.2.0']) {
            execFileSync(
                'npm',
                [
                    'install',
                    '--offline',
                    '--ignore-scripts',
                    '--no-audit',
                    '--no-fund',
                    archive,
                    `react@${version}`,
                    `react-dom@${version}`,
                ],
                { cwd: directory, stdio: 'pipe' }
            );
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            assert.equal(realpathSync(installed), installed);
            const lock = JSON.parse(
                readFileSync(join(directory, 'package-lock.json'), 'utf8')
            );
            assert.equal(
                lock.packages['node_modules/@miniextensions/sdk'].integrity,
                `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
            );
            for (const format of ['esm', 'cjs']) {
                const name = `react${version.startsWith('18') ? '18' : '19'}-${format}`;
                const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {createPortal,flushSync} from 'react-dom';import * as SDK from './node_modules/@miniextensions/sdk/dist/${format}/react/index.js';import * as UI from './node_modules/@miniextensions/sdk/dist/${format}/ui/index.js';(${browserMain.toString()})();`;
                writeFileSync(join(directory, 'entry.js'), entry);
                const bundle = await build({
                    absWorkingDir: directory,
                    entryPoints: ['entry.js'],
                    outfile: 'main.js',
                    bundle: true,
                    platform: 'browser',
                    format: 'esm',
                    target: 'es2022',
                    metafile: true,
                    write: false,
                    define: { 'process.env.NODE_ENV': '"development"' },
                });
                await assertBrowserInputs(bundle.metafile, directory);
                writeFileSync(
                    join(output, `${name}.js`),
                    bundle.outputFiles[0].contents
                );
                for (const noCSS of [false, true]) {
                    const page = name + (noCSS ? '-no-theme-css' : '');
                    const css =
                        [
                            'button',
                            'text',
                            'localized-numeric',
                            'complete-duration',
                            ...(noCSS ? [] : ['theme']),
                        ]
                            .map((file) =>
                                readFileSync(
                                    join(
                                        installed,
                                        `dist/esm/react/${file}.css`
                                    ),
                                    'utf8'
                                )
                            )
                            .join('\n') +
                        `\n.native-numeric {--mx-sdk-accent:rgb(var(--theme-600));}.native-complete-duration{--mx-sdk-accent:rgb(var(--theme-500));}body{font:16px system-ui;padding:20px}#preview,#editor,#portal{margin-top:20px}button,input{margin:8px}#results{white-space:pre-wrap}`;
                    writeFileSync(join(output, `${page}.css`), css);
                    writeFileSync(
                        join(output, `${page}.html`),
                        `<!doctype html><html><head><meta charset="utf-8"><title>Theme composition ${page}</title><link rel="stylesheet" href="${page}.css"></head><body data-format="${format}" data-no-css="${noCSS}"><h1>Installed theme composition · React ${version} ${format}</h1><p>Archive ${sha256}</p><button id="run">Run style checks</button><select id="palette" aria-label="Palette">${['green', 'rose', 'blue', 'yellow-light'].map((c) => `<option>${c}</option>`).join('')}</select><button id="custom">Toggle custom tokens</button><button id="teardown">Toggle preview</button><p id="results" role="status">Ready for checks</p><div id="preview"></div><div id="editor"></div><div id="portal"></div><script type="module" src="${name}.js"></script></body></html>`
                    );
                }
                receipts.push({
                    react: version,
                    format,
                    inputs: Object.keys(bundle.metafile.inputs),
                });
            }
        }
        writeFileSync(
            join(output, 'receipt.json'),
            JSON.stringify(
                {
                    archive,
                    sha256,
                    profiles: receipts,
                    browserExecution: 'pending',
                },
                null,
                2
            )
        );
        writeFileSync(
            join(output, 'index.html'),
            receipts
                .flatMap((r) =>
                    [false, true].map((no) => {
                        const n = `react${r.react.startsWith('18') ? '18' : '19'}-${r.format}${no ? '-no-theme-css' : ''}`;
                        return `<p><a href="${n}.html">${n}</a></p>`;
                    })
                )
                .join('\n')
        );
        return { output, sha256, profiles: receipts.length };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
if (process.argv[1]?.endsWith('build-theme-browser-proof.mjs'))
    console.log(await buildThemeBrowserProof(process.argv[2], process.argv[3]));
