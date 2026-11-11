import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const typedConsumer = `
import {createElement,createRef,type CSSProperties} from 'react';
import {ThemeBoundary,getThemePortalProps,useThemeSnapshot,type ThemeSnapshot} from '@miniextensions/sdk/react';
import {getThemeStyles,DEFAULT_THEME_COLOR,type ThemeTokens} from '@miniextensions/sdk/ui';
const tokens:ThemeTokens={...getThemeStyles(DEFAULT_THEME_COLOR),'--theme-600':'1 2 3'};
const snapshot:ThemeSnapshot={theme:'yellow-light',tokens};
const nativeStyle:CSSProperties={display:'contents'};
createElement(ThemeBoundary,{theme:'blue',style:nativeStyle});
createElement(ThemeBoundary,{...snapshot,ref:createRef<HTMLDivElement>(),style:{backgroundColor:'white','--theme-500':'4 5 6','--mx-sdk-accent':'purple'}},'Content');
createElement('div',getThemePortalProps(snapshot));
function hook(){return getThemePortalProps(useThemeSnapshot());}
// @ts-expect-error an effective snapshot must contain all ten raw tokens
const partial:ThemeTokens={'--theme-600':'1 2 3'};
// @ts-expect-error detached portals require an explicit snapshot
getThemePortalProps();
// @ts-expect-error palette names remain finite
createElement(ThemeBoundary,{theme:'magenta'});
void partial;void hook;
`;

async function checkInstalled(directory, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const ui = consumer('@miniextensions/sdk/ui');
    const esm = await import(
        pathToFileURL(
            join(
                directory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const cjs = consumer('@miniextensions/sdk/react');
    assert.equal(ui.ALL_THEME_COLORS.length, 27);
    assert.equal(ui.DEFAULT_THEME_COLOR, 'blue');
    assert.equal(ui.getThemeStyles('indigo')['--theme-600'], '79 70 229');
    assert(
        readFileSync(
            consumer.resolve('@miniextensions/sdk/react/theme.css'),
            'utf8'
        ).includes('.mx-sdk-theme')
    );
    const h = React.createElement;
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    let groups = 0;
    for (const api of [esm, cjs]) {
        assert.equal(typeof globalThis.window, 'undefined');
        const custom = { ...ui.getThemeStyles('rose'), '--theme-600': '1 2 3' };
        const element = (theme = 'rose', show = false) =>
            h(
                React.StrictMode,
                null,
                h(
                    api.ThemeBoundary,
                    {
                        theme,
                        tokens: {
                            ...ui.getThemeStyles(theme),
                            '--theme-600': custom['--theme-600'],
                        },
                        id: 'boundary',
                    },
                    h(api.ThemeBoundary, { id: 'inherit' }, h(Portal, { show }))
                )
            );
        let portal;
        function Portal({ show }) {
            const snapshot = api.useThemeSnapshot();
            return show
                ? consumer('react-dom').createPortal(
                      h(
                          'div',
                          {
                              ...api.getThemePortalProps(snapshot),
                              id: 'detached',
                          },
                          'Detached'
                      ),
                      portal
                  )
                : h('span', null, 'SSR content');
        }
        const html = renderToString(element());
        assert(html.includes('--theme-600:1 2 3'));
        assert(
            !renderToString(h(api.ThemeBoundary, null, 'Inherit')).includes(
                '--theme-'
            )
        );
        const window = new Window();
        const originals = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        keys.forEach((key) =>
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
            })
        );
        const container = window.document.createElement('div');
        const other = window.document.createElement('div');
        portal = window.document.createElement('div');
        window.document.body.append(container, other, portal);
        container.innerHTML = html;
        const errors = [];
        let root, second;
        try {
            const { hydrateRoot, createRoot } = consumer('react-dom/client');
            const before = container.firstElementChild;
            await React.act(async () => {
                root = hydrateRoot(container, element(), {
                    onRecoverableError: (error) => errors.push(String(error)),
                });
            });
            assert.equal(
                container.firstElementChild,
                before,
                'must hydrate the existing DOM'
            );
            second = createRoot(other);
            await React.act(async () =>
                second.render(
                    h(
                        api.ThemeBoundary,
                        { theme: 'blue', id: 'editor' },
                        'Editor'
                    )
                )
            );
            for (const theme of ['rose', 'green', 'rose']) {
                await React.act(async () => root.render(element(theme, true)));
                const detached = portal.querySelector('#detached');
                assert.equal(
                    detached.style.getPropertyValue('--theme-600'),
                    '1 2 3'
                );
                assert.equal(
                    detached.style.getPropertyValue('--theme-500'),
                    ui.getThemeStyles(theme)['--theme-500']
                );
                assert.equal(
                    container
                        .querySelector('#inherit')
                        .style.getPropertyValue('--theme-600'),
                    ''
                );
                assert.equal(
                    other
                        .querySelector('#editor')
                        .style.getPropertyValue('--theme-600'),
                    '37 99 235'
                );
            }
            await React.act(async () => root.unmount());
            root = null;
            assert.equal(portal.childElementCount, 0);
            assert.equal(
                other
                    .querySelector('#editor')
                    .style.getPropertyValue('--theme-600'),
                '37 99 235'
            );
            assert.equal(window.document.documentElement.style.length, 0);
            assert.equal(window.document.head.childElementCount, 0);
            assert.deepEqual(errors, []);
            groups++;
        } finally {
            if (root) await React.act(async () => root.unmount());
            if (second) await React.act(async () => second.unmount());
            keys.forEach((key, i) => {
                if (originals[i])
                    Object.defineProperty(globalThis, key, originals[i]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return { react: React.version, groups };
}

export function checkThemeReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-theme-'));
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
    const versions = [];
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: { '@miniextensions/sdk': `file:${archivePath}` },
            })
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = `theme.${extension}`;
                writeFileSync(join(directory, name), typedConsumer);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    name,
                ]);
            }
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        '--run-consumer',
                        directory,
                        happyDomModulePath,
                    ],
                    { cwd: directory, encoding: 'utf8' }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            versions.push(result);
            console.log(
                `Installed theme React ${result.react}: ESM/CJS/types/SSR/hydration/nested roots/custom portal/teardown passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
if (process.argv[2] === '--run-consumer')
    console.log(
        JSON.stringify(await checkInstalled(process.argv[3], process.argv[4]))
    );
