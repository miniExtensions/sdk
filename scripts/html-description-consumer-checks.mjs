import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const htmlDescriptionTypedConsumer = String.raw`import { createElement, createRef } from 'react';
import {
    CompleteHTMLRenderer, type CompleteHTMLRendererProps,
    CompleteQuillHTMLRenderer, type CompleteQuillHTMLRendererProps,
    CompleteTruncatedDescription, type CompleteTruncatedDescriptionProps,
    sanitizeHTML, hasRenderableHTMLContent,
} from '@miniextensions/sdk/react/html';
const ref = createRef<HTMLDivElement>();
const html: CompleteHTMLRendererProps = {
    html: '<p>Literal HTML</p>', inline: false, id: 'html',
    className: 'consumer', style: { height: 96, overflow: 'hidden' },
    role: 'note', 'aria-label': 'Help', onClick() {},
};
createElement(CompleteHTMLRenderer, { ...html, ref });
const quill: CompleteQuillHTMLRendererProps = { html: '<p>Rich text</p>', className: 'consumer' };
createElement(CompleteQuillHTMLRenderer, { ...quill, ref });
const description: CompleteTruncatedDescriptionProps = {
    html: '<p>Long help</p>', resetKey: 'record-a', className: 'description',
    readMoreLabel: 'Read more', showLessLabel: 'Show less',
};
createElement(CompleteTruncatedDescription, description);
createElement(CompleteTruncatedDescription, { html: '' });
const cleaned: string = sanitizeHTML('<p>safe</p>');
const meaningful: boolean = hasRenderableHTMLContent(cleaned);
// @ts-expect-error HTML is a string, not nullable canonical field data
createElement(CompleteHTMLRenderer, { html: null });
// @ts-expect-error HTML descriptions do not own a canonical writer
createElement(CompleteTruncatedDescription, { ...description, onValueChange() {} });
// @ts-expect-error the native description has no forwarded ref
createElement(CompleteTruncatedDescription, { ...description, ref });
// @ts-expect-error HTML is intentionally not exposed by the generic React entry
import { CompleteHTMLRenderer as GenericHTML } from '@miniextensions/sdk/react';
// @ts-expect-error HTML is intentionally not exposed by the headless entry
import { sanitizeHTML as CoreSanitize } from '@miniextensions/sdk';
void meaningful; void GenericHTML; void CoreSanitize;
`;

const policySource = String.raw`function assertHTMLPolicy(api, assert) {
    let checks = 0;
    const clean = api.sanitizeHTML('<h2 style="color:red">Safe</h2><ul><li>Item</li></ul><script>bad()</script><a href="javascript:bad()">Unsafe</a><img src="/owned.svg" onerror="bad()">');
    assert(clean.includes('<h2') && clean.includes('<ul><li>Item</li></ul>'));
    assert(!/<script|onerror|javascript:/i.test(clean)); checks++;
    const sandbox = 'allow-downloads allow-forms allow-popups allow-presentation allow-same-origin allow-scripts';
    const frame = api.sanitizeHTML('<iframe src="https://example.invalid/embed" sandbox="allow-top-navigation" referrerpolicy="unsafe-url" loading="eager" srcdoc="bad"></iframe>');
    assert(frame.includes('src="https://example.invalid/embed"'));
    assert(frame.includes('sandbox="' + sandbox + '"'));
    assert(frame.includes('referrerpolicy="no-referrer"') && frame.includes('loading="lazy"'));
    assert(!/srcdoc|allow-top-navigation/.test(frame)); checks++;
    for (const src of ['http://example.invalid/embed','//example.invalid/embed','/relative','data:text/html,bad','https://','javascript:bad()']) {
        assert(!/<iframe/i.test(api.sanitizeHTML('<iframe src="' + src + '"></iframe>')));
        checks++;
    }
    const controls = api.sanitizeHTML('<form><label>Label</label><input><select><option>Choice</option></select><textarea>Message</textarea><button>Submit</button></form>');
    assert(!/<(?:form|label|input|select|option|textarea|button)\b/i.test(controls));
    assert(controls.includes('Label') && controls.includes('Choice') && controls.includes('Message') && controls.includes('Submit')); checks++;
    for (const html of ['', '<p><br></p>', '<p>&nbsp;\u00a0\u200b</p>']) {
        assert.equal(api.hasRenderableHTMLContent(html),false); checks++;
    }
    for (const html of ['<p>Meaningful</p>','<hr>','<table><tr><td></td></tr></table>']) {
        assert.equal(api.hasRenderableHTMLContent(html),true); checks++;
    }
    return checks;
}
`;

const coldRuntime =
    String.raw`import assert from 'node:assert/strict';
import { createRequire, builtinModules } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';
const require = createRequire(import.meta.url);
const [format,order,happyDomPath,esbuildPath] = process.argv.slice(2);
const packageNames = ['@miniextensions/sdk','@miniextensions/sdk-html-second-copy'];
const load = (name,path) => format === 'esm' ? import(name + path) : Promise.resolve(require(name + path));
assert.equal(typeof globalThis.window,'undefined');
await load(packageNames[0],'/react');
assert(!Object.keys(require.cache).some((path) => /[/\\]jsdom[/\\]/.test(path)),
    'the generic React entry must not load the opt-in parser');
const apis = [];
if (order === 'sdk-first') for (const name of packageNames) apis.push(await load(name,'/react/html'));
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
assert.equal(require('dompurify/package.json').version,'2.4.7');
assert.equal(require('jsdom/package.json').version,'20.0.3');
const appWindow = new JSDOM('<!doctype html>').window;
const app = createDOMPurify(appWindow);
let hookCalls = 0, globalReads = 0, globalWrites = 0;
app.addHook('afterSanitizeAttributes',(node) => {
    hookCalls++;
    if (node.tagName.toLowerCase() === 'p') node.setAttribute('data-app-owned','yes');
});
app.setConfig({ADD_TAGS:['iframe'],ADD_ATTR:['sandbox'],FORBID_TAGS:['em']});
const appInput = '<p><em>App text</em></p><iframe src="https://example.invalid/embed" sandbox="allow-top-navigation"></iframe>';
const appBaseline = app.sanitize(appInput);
const originalPurifier = Object.getOwnPropertyDescriptor(globalThis,'DOMPurify');
const globalDescriptor = {configurable:true,get() {globalReads++;return app;},set() {globalWrites++;}};
Object.defineProperty(globalThis,'DOMPurify',globalDescriptor);
const directory = dirname(fileURLToPath(import.meta.url));
` +
    policySource +
    String.raw`
let policyChecks = 0, hydrationGroups = 0, refGroups = 0, stableHTMLGroups = 0;
try {
    if (order === 'app-first') for (const name of packageNames) apis.push(await load(name,'/react/html'));
    assert.notEqual(apis[0].sanitizeHTML,apis[1].sanitizeHTML,'two installed public package instances must be observed');
    assert.equal(typeof globalThis.window,'undefined');
    const beforePolicyHookCalls = hookCalls;
    for (let index = 0; index < apis.length; index++) {
        const api = apis[index],name = packageNames[index];
        const publicEntry = format === 'esm' ? fileURLToPath(import.meta.resolve(name + '/react/html')) : require.resolve(name + '/react/html');
        assert(publicEntry.includes('/node_modules/' + name + '/dist/' + format + '/react/html/'));
        policyChecks += assertHTMLPolicy(api,assert);
        assert(api.sanitizeHTML('<em>Private emphasis</em>').includes('<em>'));
        assert(!api.sanitizeHTML('<p>Private</p>').includes('data-app-owned'));
        assert.equal(hookCalls,beforePolicyHookCalls);
        const css = readFileSync(require.resolve(name + '/react/html-description.css'),'utf8');
        assert(css.includes('.mx-sdk-html') && css.includes('.mx-sdk-quill') && css.includes('.mx-sdk-description'));
        assert(!css.includes('@tailwind') && !css.includes('@apply'));
    }
    assert.equal(app.sanitize(appInput),appBaseline,'foreign hooks and config remain intact');
    const hooksBeforeUI = hookCalls;
    assert.equal(globalReads,0);assert.equal(globalWrites,0);
    const { Window } = await import(pathToFileURL(happyDomPath).href);
    for (const api of apis) {
        const window = new Window(),container = window.document.createElement('div');
        window.document.body.append(container);
        const keys = ['window','document','navigator','HTMLElement','HTMLDivElement','IS_REACT_ACT_ENVIRONMENT','fetch'];
        const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis,key));
        let root,submits = 0,requests = 0;
        const htmlRef = React.createRef(),quillRef = React.createRef();
        const model = {html:'<p>Initial</p>',height:96,quill:'<a href="#owned" target="_self" rel="opener">Owned</a>',quillClass:'consumer',description:'<p>Long help</p>'.repeat(8)};
        const node = () => React.createElement('form',{onSubmit(event) {event.preventDefault();submits++;}},
            React.createElement(api.CompleteHTMLRenderer,{
                ref:htmlRef,html:model.html,id:'html',role:'note',inline:false,
                style:{height:model.height,overflow:'hidden',position:'fixed',contain:'none',isolation:'auto'},
            }),
            React.createElement(api.CompleteQuillHTMLRenderer,{ref:quillRef,html:model.quill,className:model.quillClass}),
            React.createElement(api.CompleteTruncatedDescription,{html:model.description,resetKey:'a'}),
            React.createElement('input',{'aria-label':'Adjacent',defaultValue:'Keep draft'}));
        const markup = renderToString(node());
        assert.equal(typeof globalThis.window,'undefined');
        assert(markup.includes('Initial') && markup.includes('Read more'));
        container.innerHTML = markup;
        const before = container.querySelector('#html');
        for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,
            value:key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === 'fetch' ? async () => {requests++;throw Error('No HTML UI fetch');} : window[key]});
        Object.defineProperty(window,'DOMPurify',globalDescriptor);
        const errors = [];
        try {
            const { hydrateRoot, createRoot } = await import('react-dom/client');
            await React.act(async () => {root = hydrateRoot(container,node(),{onRecoverableError(error) {errors.push(String(error));}});});
            assert.equal(htmlRef.current,before);
            assert.equal(quillRef.current,container.querySelector('.mx-sdk-quill__editor'));
            assert.equal(htmlRef.current.style.contain,'paint');
            assert.equal(htmlRef.current.style.isolation,'isolate');
            assert.equal(htmlRef.current.style.position,'relative');
            assert.equal(htmlRef.current.style.overflow,'hidden');
            const link = quillRef.current.querySelector('a');
            assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
            const paragraph = htmlRef.current.querySelector('p');
            model.height = 128;model.quillClass = 'consumer-next';
            await React.act(async () => root.render(node()));
            assert.equal(htmlRef.current,before);assert.equal(htmlRef.current.style.height,'128px');
            assert.equal(htmlRef.current.querySelector('p'),paragraph,
                'same HTML and a style update must retain its actual content node');
            assert.equal(quillRef.current.querySelector('a'),link,
                'same HTML and a class update must retain the actual isolated link');
            assert(quillRef.current.classList.contains('consumer-next'));
            assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
            const quotedHTML = model.quill.replaceAll('"', "'");
            assert.equal(api.sanitizeHTML(quotedHTML),api.sanitizeHTML(model.quill));
            model.quill = quotedHTML;
            await React.act(async () => root.render(node()));
            assert.equal(quillRef.current.querySelector('a'),link,
                'equivalent sanitized content must retain the native string-equality boundary');
            assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
            stableHTMLGroups++;
            const adjacent = container.querySelector('input');adjacent.value = 'Retained draft';
            model.html = '<p>Updated</p>';model.quill = '**Literal** [Help](#owned)';
            await React.act(async () => root.render(node()));
            assert.equal(htmlRef.current,before);assert.equal(adjacent.value,'Retained draft');
            assert.equal(quillRef.current.textContent,model.quill);
            assert.equal(quillRef.current.querySelector('a,strong'),null);
            const toggle = container.querySelector('button');
            assert.equal(toggle.type,'button');
            await React.act(async () => toggle.click());
            assert(container.textContent.includes('Show less'));
            assert.equal(submits,0);assert.equal(requests,0);assert.deepEqual(errors,[]);
            await React.act(async () => root.unmount());root = undefined;
            assert.equal(htmlRef.current,null);assert.equal(quillRef.current,null);
            hydrationGroups++;
            for (const Component of ['div',api.CompleteHTMLRenderer,api.CompleteQuillHTMLRenderer]) {
                const events = [],mounted = [];
                const callback = (name) => (node) => {
                    if (node == null) {events.push(name + ':null');return;}
                    assert.equal(node.tagName,'DIV');mounted.push(node);events.push(name + ':mount');
                    if (React.version.startsWith('19.')) return () => events.push(name + ':cleanup');
                };
                const a = callback('A'),b = callback('B');
                const element = (ref) => React.createElement(Component,{ref,html:'<p>Ref</p>'});
                root = createRoot(container);
                await React.act(async () => root.render(element(a)));
                await React.act(async () => root.render(element(b)));
                assert.equal(mounted.length,2);assert.equal(mounted[0],mounted[1]);
                await React.act(async () => root.unmount());root = undefined;
                const retired = React.version.startsWith('19.') ? 'cleanup' : 'null';
                assert.deepEqual(events,['A:mount','A:' + retired,'B:mount','B:' + retired]);
                refGroups++;
            }
        } finally {
            try {if (root) await React.act(async () => root.unmount());}
            finally {
                keys.forEach((key,index) => descriptors[index] ? Object.defineProperty(globalThis,key,descriptors[index]) : Reflect.deleteProperty(globalThis,key));
                await window.happyDOM.close();
            }
        }
    }
    let browserFormats = 0;
    if (order === 'app-first') {
        const esbuild = require(esbuildPath);
        for (const browserFormat of ['esm','cjs']) {
            const entry = join(directory,'browser-import-' + browserFormat + (browserFormat === 'esm' ? '.mjs' : '.cjs'));
            const text = browserFormat === 'esm'
                ? packageNames.map((name,index) => 'export * as copy' + index + ' from ' + JSON.stringify(name + '/react/html') + ';').join('\n')
                : 'module.exports = [' + packageNames.map((name) => 'require(' + JSON.stringify(name + '/react/html') + ')').join(',') + '];';
            writeFileSync(entry,text);
            const built = await esbuild.build({entryPoints:[entry],absWorkingDir:directory,bundle:true,
                platform:'browser',format:browserFormat,target:'es2022',write:false,metafile:true,
                define:{'process.env.NODE_ENV':'"production"'}});
            const inputs = Object.keys(built.metafile.inputs);
            assert.equal(inputs.filter((name) => name.endsWith('/html/htmlPurifier.browser.js')).length,2);
            assert(!inputs.some((name) => /[/\\]jsdom[/\\]/.test(name) || name.endsWith('/html/htmlPurifier.js')));
            const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/,'')));
            for (const output of Object.values(built.metafile.outputs)) for (const item of output.imports)
                assert(!item.external || !builtins.has(item.path.replace(/^node:/,'')));
            const output = join(directory,'browser-lazy.' + (browserFormat === 'esm' ? 'mjs' : 'cjs'));
            writeFileSync(output,built.outputFiles[0].contents);
            assert.equal(typeof globalThis.window,'undefined');
            const imported = browserFormat === 'esm' ? await import(pathToFileURL(output).href) : require(output);
            const first = browserFormat === 'esm' ? imported.copy0 : imported[0];
            assert.throws(() => first.sanitizeHTML('<p>Not a browser</p>'),/browser document/);
            browserFormats++;
        }
    }
    assert.equal(hookCalls,hooksBeforeUI,'UI and browser-import checks must not use the foreign sanitizer');
    assert.equal(app.sanitize(appInput),appBaseline,'foreign hooks/config survive the complete consumer lifecycle');
    assert.equal(globalReads,0);assert.equal(globalWrites,0);
    console.log(JSON.stringify({react:React.version,format,order,copies:2,policyChecks,hydrationGroups,refGroups,stableHTMLGroups,browserFormats,
        globalReads,globalWrites,cleanup:'completed'}));
} finally {
    if (originalPurifier) Object.defineProperty(globalThis,'DOMPurify',originalPurifier);
    else Reflect.deleteProperty(globalThis,'DOMPurify');
    appWindow.close();
}
`;

// Expose the generated fixture for root-owned lightweight syntax verification.
export const htmlDescriptionColdConsumerSource = coldRuntime;

export function checkHTMLDescriptionReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-html-description-'));
    const profiles = [];
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + resolve(archivePath),
                    '@miniextensions/sdk-html-second-copy':
                        'file:' + resolve(archivePath),
                    dompurify: '2.4.7',
                    jsdom: '20.0.3',
                },
            })
        );
        writeFileSync(join(directory, 'html-runtime.mjs'), coldRuntime);
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
                'react@' + version.react,
                'react-dom@' + version.react,
                '@types/react@' + version.types,
                '@types/react-dom@' + version.domTypes,
            ]);
            for (const extension of ['mts', 'cts']) {
                const file = 'html-consumer.' + extension;
                writeFileSync(
                    join(directory, file),
                    htmlDescriptionTypedConsumer
                );
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
                    file,
                ]);
            }
            for (const format of ['esm', 'cjs'])
                for (const order of ['app-first', 'sdk-first']) {
                    const result = JSON.parse(
                        execFileSync(
                            process.execPath,
                            [
                                join(directory, 'html-runtime.mjs'),
                                format,
                                order,
                                happyDomModulePath,
                                esbuildModulePath,
                            ],
                            { cwd: directory, encoding: 'utf8' }
                        )
                    );
                    assert.equal(result.react, version.react);
                    assert.equal(result.copies, 2);
                    assert.equal(result.policyChecks, 30);
                    assert.equal(result.hydrationGroups, 2);
                    assert.equal(result.refGroups, 6);
                    assert.equal(result.stableHTMLGroups, 2);
                    assert.equal(
                        result.browserFormats,
                        order === 'app-first' ? 2 : 0
                    );
                    assert.equal(result.globalReads, 0);
                    assert.equal(result.globalWrites, 0);
                    profiles.push(result);
                }
            console.log(
                'Installed HTML description React' +
                    version.react +
                    ': strict ESM/CJS, two copies/import orders, private purifier, SSR/hydration/ref cleanup and browser resolution passed.'
            );
        }
        return { profiles, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

export const htmlDescriptionBrowserImagePath = '/html-description-owned.svg';
export const htmlDescriptionBrowserImageSource =
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="160"><rect width="80" height="160" fill="#93c5fd"/></svg>';

export const htmlDescriptionRichTextReference = Object.freeze({
    commit: '1b891110981e867e8efe3ff9c500159e23377cc5',
    dependency: '@miniextensions/sdk-rich-text-reference',
    specifier:
        'git+https://github.com/miniExtensions/sdk.git#1b891110981e867e8efe3ff9c500159e23377cc5',
    react: '18.3.1',
    publicEntry: '@miniextensions/sdk-rich-text-reference/react',
    publicCSS: '@miniextensions/sdk-rich-text-reference/react/rich-text.css',
});

/** CI-only standard package preparation. No fallback build or access route. */
export function prepareHTMLDescriptionEditorReference({
    archivePath,
    directory,
    evidenceDirectory,
    pnpmCommand = 'pnpm',
}) {
    assert.equal(
        process.env.CI,
        'true',
        'The separately owned immutable editor reference is CI-only'
    );
    const version = execFileSync(pnpmCommand, ['--version'], {
        encoding: 'utf8',
    }).trim();
    assert.equal(version, '10.28.2');
    const manifest = {
        private: true,
        type: 'module',
        packageManager: 'pnpm@10.28.2',
        dependencies: {
            '@miniextensions/sdk': 'file:' + resolve(archivePath),
            [htmlDescriptionRichTextReference.dependency]:
                htmlDescriptionRichTextReference.specifier,
            react: htmlDescriptionRichTextReference.react,
            'react-dom': htmlDescriptionRichTextReference.react,
        },
        pnpm: { onlyBuiltDependencies: ['@miniextensions/sdk'] },
    };
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify(manifest, null, 2)
    );
    const installed = spawnSync(
        pnpmCommand,
        ['install', '--strict-peer-dependencies', '--no-frozen-lockfile'],
        { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    // Persist outside the temporary consumer before any completion assertion.
    // Existing native-output hashing and archival retain both success/failure.
    const installLog = join(
        evidenceDirectory,
        'html-editor-reference-install.log'
    );
    const receiptPath = join(
        evidenceDirectory,
        'html-editor-reference-install.json'
    );
    const retainedLock = join(
        evidenceDirectory,
        'html-editor-reference-lock.yaml'
    );
    writeFileSync(
        installLog,
        String(installed.stdout ?? '') + '\n' + String(installed.stderr ?? '')
    );
    const localLock = join(directory, 'pnpm-lock.yaml');
    const hasLock = existsSync(localLock);
    if (hasLock) writeFileSync(retainedLock, readFileSync(localLock));
    const installReceipt = {
        schemaVersion: 1,
        ...htmlDescriptionRichTextReference,
        pnpm: version,
        command: [
            pnpmCommand,
            'install',
            '--strict-peer-dependencies',
            '--no-frozen-lockfile',
        ],
        status: installed.status === 0 ? 'installed' : 'failed',
        exitCode: installed.status,
        signal: installed.signal,
        spawnError: installed.error?.message ?? null,
        installLog,
        lockfile: hasLock ? retainedLock : null,
    };
    writeFileSync(receiptPath, JSON.stringify(installReceipt, null, 2));
    if (installed.error) throw installed.error;
    assert.equal(
        installed.status,
        0,
        'Normal immutable reference installation failed; no fallback build is permitted'
    );
    const lock = readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8');
    assert(lock.includes(htmlDescriptionRichTextReference.commit));
    const require = createRequire(join(directory, 'package.json'));
    const htmlEntry = require.resolve('@miniextensions/sdk/react/html');
    const editorEntry = require.resolve(
        htmlDescriptionRichTextReference.publicEntry
    );
    const htmlReact = realpathSync(createRequire(htmlEntry).resolve('react'));
    const editorReact = realpathSync(
        createRequire(editorEntry).resolve('react')
    );
    const consumerReact = realpathSync(require.resolve('react'));
    const reactDOMReact = realpathSync(
        createRequire(require.resolve('react-dom/client')).resolve('react')
    );
    assert.equal(
        htmlReact,
        editorReact,
        'actual installed packages must share the consumer React'
    );
    assert.equal(htmlReact, consumerReact);
    assert.equal(editorReact, reactDOMReact);
    assert.equal(
        require('react').version,
        htmlDescriptionRichTextReference.react
    );
    const receipt = {
        ...installReceipt,
        status: 'prepared',
        htmlEntry,
        editorEntry,
        editorCSS: require.resolve(htmlDescriptionRichTextReference.publicCSS),
        reactResolution: editorReact,
        consumerReact,
        reactDOMReact,
        receiptPath,
        scope: 'Normal immutable Git prepack via pinned pnpm; installation alone is not runtime coexistence proof.',
    };
    writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    return receipt;
}

export const htmlDescriptionBrowserStyle = String.raw`html {font-size:16px}
body {font-family:Arial,sans-serif;font-size:16px;line-height:24px;margin:16px;color:#111827}
.description-host {width:360px}
.fixture-controls {display:flex;gap:12px;margin:12px 0}
#unrelated {padding:13px;font-size:17px;line-height:25px;white-space:normal}
`;

export const htmlDescriptionBrowserSource =
    String.raw`import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import createDOMPurify from 'dompurify';
const app = createDOMPurify(window);
let appHooks = 0,expectedAppHooks = 0;
app.addHook('afterSanitizeAttributes',(node) => {
    appHooks++;
    if (node.tagName.toLowerCase() === 'p') node.setAttribute('data-app-owned','yes');
});
app.setConfig({ADD_TAGS:['iframe'],ADD_ATTR:['sandbox'],FORBID_TAGS:['em']});
const appInput = '<p><em>App text</em></p><iframe src="https://example.invalid/embed" sandbox="allow-top-navigation"></iframe>';
const appBaseline = app.sanitize(appInput);
expectedAppHooks = appHooks;
const state = {errors:[],requests:0,submits:0,clicks:0,globalReads:0,globalWrites:0,revision:0,committed:0};
Object.defineProperty(window,'DOMPurify',{configurable:true,
    get() {state.globalReads++;return app;},set() {state.globalWrites++;}});
const api = await import('@miniextensions/sdk/react/html');
` +
    policySource +
    String.raw`
const fixtureAssert = Object.assign((value) => {if (!value) throw Error('Policy assertion failed');},{
    equal(a,b) {if (a !== b) throw Error('Policy equality failed');},
});
const policyChecks = assertHTMLPolicy(api,fixtureAssert);
const rows = (prefix) => Array.from({length:12},(_,index) => '<p>' + prefix + ' ' + index + '</p>').join('');
const model = {surface:'description',html:rows('Description'),width:360,resetKey:'a',
    readMoreLabel:undefined,showLessLabel:undefined,inline:false,visible:true,multiple:false};
const htmlRef = React.createRef(),quillRef = React.createRef();
const pending = new Map();
let root;
const viewport = () => document.querySelector('.mx-sdk-description__viewport');
function snapshot() {
    const view = viewport(),toggle = document.querySelector('.mx-sdk-description__toggle');
    return {...state,errors:[...state.errors],reactVersion:React.version,policyChecks,
        foreignHookCalls:appHooks - expectedAppHooks,
        viewport:view ? {id:view.id,height:view.getBoundingClientRect().height,client:view.clientHeight,
            scroll:view.scrollHeight,maxHeight:view.style.maxHeight,overflow:getComputedStyle(view).overflow} : null,
        toggle:toggle ? {label:toggle.textContent,expanded:toggle.getAttribute('aria-expanded'),controls:toggle.getAttribute('aria-controls'),type:toggle.type} : null,
        htmlRef:htmlRef.current?.className ?? null,quillRef:quillRef.current?.className ?? null,
        adjacent:document.getElementById('adjacent')?.value ?? null,
        links:Array.from(document.querySelectorAll('.mx-sdk-description a')).map((node) => ({
            id:node.id,tabIndex:node.getAttribute('tabindex'),ariaHidden:node.getAttribute('aria-hidden'),
            target:node.target,rel:node.rel,
        }))};
}
window.__nativeProbe = {snapshot};
window.addEventListener('error',(event) => state.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection',(event) => state.errors.push(String(event.reason)));
window.fetch = async () => {state.requests++;throw Error('No HTML fixture fetch');};
XMLHttpRequest.prototype.open = function () {state.requests++;throw Error('No HTML fixture XHR');};
function publish() {
    const revision = ++state.revision;
    const committed = new Promise((resolve) => pending.set(revision,resolve));
    root.render(React.createElement(App,{revision}));
    return committed;
}
function App({revision}) {
    useEffect(() => {
        state.committed = revision;
        for (const [key,resolve] of pending) if (key <= revision) {pending.delete(key);resolve();}
    },[revision]);
    let content = null;
    if (model.visible) {
        if (model.surface === 'html') content = React.createElement(api.CompleteHTMLRenderer,{
            ref:htmlRef,html:model.html,inline:model.inline,id:'rendered-html',role:'note',
            'aria-label':'HTML help',className:'consumer-class',
            style:{height:96,overflow:'hidden',contain:'none',isolation:'auto',position:'fixed'},
            onClick() {state.clicks++;},
        });
        else if (model.surface === 'quill') content = React.createElement(api.CompleteQuillHTMLRenderer,{
            ref:quillRef,html:model.html,className:'consumer-quill',
        });
        else content = React.createElement(React.Fragment,null,
            React.createElement(api.CompleteTruncatedDescription,{
                html:model.html,resetKey:model.resetKey,className:'consumer-description',
                readMoreLabel:model.readMoreLabel,showLessLabel:model.showLessLabel,
            }),
            model.multiple ? React.createElement(api.CompleteTruncatedDescription,{
                html:model.html,resetKey:'independent',className:'second-description',
            }) : null);
    }
    return React.createElement('form',{onSubmit(event) {event.preventDefault();state.submits++;}},
        React.createElement('button',{id:'before',type:'button'},'Before'),
        React.createElement('section',{className:'description-host',style:{width:model.width}},content),
        React.createElement('button',{id:'after',type:'button'},'After'),
        React.createElement('input',{id:'adjacent',defaultValue:'Keep draft'}),
        React.createElement('div',{id:'unrelated',className:'ql-editor'},
            React.createElement('p',null,'Unrelated ordinary DOM')));
}
window.__htmlFixture = {
    async update(patch) {Object.assign(model,patch);await publish();return snapshot();},
    async reset(patch = {}) {
        Object.assign(model,{surface:'description',html:rows('Description'),width:360,resetKey:'a',
            readMoreLabel:undefined,showLessLabel:undefined,inline:false,visible:true,multiple:false},patch);
        await publish();return snapshot();
    },
    async flush() {await publish();return snapshot();},
    appCheck() {
        const unexpected = appHooks - expectedAppHooks;
        const unchanged = app.sanitize(appInput) === appBaseline;
        expectedAppHooks = appHooks;
        return {unexpected,unchanged,globalReads:state.globalReads,globalWrites:state.globalWrites};
    },
    captureRefs() {window.__htmlSavedRefs = {html:htmlRef.current,quill:quillRef.current};},
    sameRefs() {return {html:window.__htmlSavedRefs?.html === htmlRef.current,quill:window.__htmlSavedRefs?.quill === quillRef.current};},
    saveLinks() {window.__htmlSavedLinks = Array.from(document.querySelectorAll('.mx-sdk-description a'));},
    savedLinks() {return (window.__htmlSavedLinks ?? []).map((node) => ({
        connected:node.isConnected,id:node.id,tabIndex:node.getAttribute('tabindex'),ariaHidden:node.getAttribute('aria-hidden'),
    }));},
};
root = createRoot(document.getElementById('root'));
void publish();
`;

export async function checkHTMLDescriptionBrowser({ page, evidence }) {
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    const reset = (patch = {}) =>
        page.evaluate((patch) => window.__htmlFixture.reset(patch), patch);
    const update = (patch) =>
        page.evaluate((patch) => window.__htmlFixture.update(patch), patch);
    const flush = () => page.evaluate(() => window.__htmlFixture.flush());
    const toggle = () => page.locator('.mx-sdk-description__toggle').first();
    const view = () => page.locator('.mx-sdk-description__viewport').first();
    const groups = [];
    const check = async (name) => {
        const value = await flush();
        assert.deepEqual(value.errors, []);
        assert.equal(value.requests, 0);
        assert.equal(value.submits, 0);
        assert.equal(value.globalReads, 0);
        assert.equal(value.globalWrites, 0);
        assert.equal(value.foreignHookCalls, 0);
        assert.equal(value.adjacent, 'Keep draft');
        groups.push({ name, state: value });
        return value;
    };
    assert.deepEqual(
        await page.evaluate(() => window.__htmlFixture.appCheck()),
        { unexpected: 0, unchanged: true, globalReads: 0, globalWrites: 0 }
    );
    assert.equal((await flush()).policyChecks, 15);
    await check(
        'private browser sanitizer policy and foreign app hooks/config/global isolation'
    );

    await reset({
        surface: 'html',
        html: '<h2>Safe heading</h2><ul><li>Safe item</li></ul>',
    });
    await page.evaluate(() => window.__htmlFixture.captureRefs());
    assert.equal(
        await page.locator('#rendered-html').getAttribute('role'),
        'note'
    );
    assert.equal(
        await page.locator('#rendered-html').getAttribute('aria-label'),
        'HTML help'
    );
    const containment = await page
        .locator('#rendered-html')
        .evaluate((node) => {
            const style = getComputedStyle(node);
            return {
                contain: style.contain,
                isolation: style.isolation,
                position: style.position,
                overflow: style.overflow,
                height: style.height,
            };
        });
    assert.deepEqual(containment, {
        contain: 'paint',
        isolation: 'isolate',
        position: 'relative',
        overflow: 'hidden',
        height: '96px',
    });
    await update({ html: '<p>Updated safe HTML</p>' });
    assert.equal(
        (await page.evaluate(() => window.__htmlFixture.sameRefs())).html,
        true
    );
    await check(
        'actual HTML div ref/native props and forced containment retain caller overflow'
    );

    await reset({ surface: 'quill', html: '**Literal** [Help](#owned)' });
    assert.equal(
        await page.locator('.mx-sdk-quill__editor').textContent(),
        '**Literal** [Help](#owned)'
    );
    assert.equal(
        await page
            .locator('.mx-sdk-quill__editor strong,.mx-sdk-quill__editor a')
            .count(),
        0
    );
    await page.evaluate(() => window.__htmlFixture.captureRefs());
    await update({
        html: '<a id="owned-link" href="#owned" target="_self" rel="opener">Owned</a>',
    });
    await page.waitForFunction(
        () =>
            document.getElementById('owned-link')?.getAttribute('rel') ===
            'noopener noreferrer'
    );
    assert.equal(
        await page.locator('#owned-link').getAttribute('target'),
        '_blank'
    );
    assert.equal(
        (await page.evaluate(() => window.__htmlFixture.sameRefs())).quill,
        true
    );
    await check(
        'literal Markdown stays literal and actual rich links isolate tabs on rerender'
    );

    await reset({
        surface: 'html',
        html: '<h1>Heading</h1><blockquote>Quote</blockquote><ul><li>Item</li></ul>',
    });
    const standalone = await page.evaluate(() => {
        const root = document.getElementById('rendered-html');
        return {
            heading: getComputedStyle(root.querySelector('h1')).fontSize,
            list: getComputedStyle(root.querySelector('ul')).listStyleType,
            unrelatedPadding: getComputedStyle(
                document.getElementById('unrelated')
            ).padding,
            unrelatedSize: getComputedStyle(
                document.getElementById('unrelated')
            ).fontSize,
        };
    });
    assert.equal(standalone.heading, '24px');
    assert.equal(standalone.list, 'disc');
    assert.equal(standalone.unrelatedPadding, '13px');
    assert.equal(standalone.unrelatedSize, '17px');
    await reset({
        surface: 'quill',
        html: '<p class="ql-align-center"><strong>Rich</strong> <em>style</em></p>',
    });
    const snow = await page
        .locator('.mx-sdk-quill__editor p')
        .evaluate((node) => ({
            align: getComputedStyle(node).textAlign,
            weight: getComputedStyle(node.querySelector('strong')).fontWeight,
            emphasis: getComputedStyle(node.querySelector('em')).fontStyle,
        }));
    assert.equal(snow.align, 'center');
    assert.equal(snow.emphasis, 'italic');
    assert(Number(snow.weight) >= 600);
    await check(
        'standalone scoped native block and Snow presentation without Tailwind/global Quill'
    );

    await reset();
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().toggle?.expanded === 'false'
    );
    const collapsed = (await flush()).viewport;
    assert.equal(collapsed.maxHeight, '4.5rem');
    assert.equal(collapsed.overflow, 'hidden');
    assert(Math.abs(collapsed.height - 72) <= 1);
    assert(collapsed.scroll > collapsed.client);
    const initialId = collapsed.id;
    assert.equal(await toggle().getAttribute('aria-controls'), initialId);
    await toggle().click();
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().toggle?.expanded === 'true'
    );
    const expanded = (await flush()).viewport;
    assert.equal(expanded.id, initialId);
    assert.equal(expanded.maxHeight, 'none');
    assert(expanded.height > 72);
    await toggle().click();
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().toggle?.expanded === 'false'
    );
    await check(
        'real 4.5rem viewport expands/collapses with stable controls identity and no submit'
    );

    await reset({
        html: '<p>' + 'wrapping words '.repeat(30) + '</p>',
        width: 160,
    });
    await page.waitForFunction(() => !!window.__nativeProbe.snapshot().toggle);
    await toggle().click();
    await update({ width: 1200 });
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().viewport.height < 72
    );
    assert.equal(
        (await flush()).toggle.expanded,
        'true',
        'expanded shrink keeps Show less until deliberate collapse'
    );
    await toggle().click();
    await page.waitForFunction(() => !window.__nativeProbe.snapshot().toggle);
    await check(
        'expanded width shrink keeps reachable Show less and remeasures after collapse'
    );

    await reset({
        multiple: true,
        readMoreLabel: 'Leer más',
        showLessLabel: 'Mostrar menos',
    });
    await page.waitForFunction(
        () =>
            document.querySelectorAll('.mx-sdk-description__toggle').length ===
            2
    );
    const ids = await page
        .locator('.mx-sdk-description__toggle')
        .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('aria-controls'))
        );
    assert.notEqual(ids[0], ids[1]);
    await toggle().click();
    assert.equal((await flush()).toggle.expanded, 'true');
    assert.equal(
        await page
            .locator('.mx-sdk-description__toggle')
            .nth(1)
            .getAttribute('aria-expanded'),
        'false'
    );
    await update({ resetKey: 'next' });
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().toggle?.expanded === 'false'
    );
    await toggle().click();
    await update({ html: '<p>New content</p>'.repeat(12) });
    await page.waitForFunction(
        () => window.__nativeProbe.snapshot().toggle?.expanded === 'false'
    );
    await check(
        'localized labels/independent disclosure and same-mounted resetKey/html collapse'
    );

    const links =
        '<p><a id="visible-link" href="#owned">Visible</a></p>' +
        '<p>Spacer</p>'.repeat(10) +
        '<p><a id="clipped-link" href="#owned" tabindex="3" aria-hidden="false">Clipped</a></p>';
    await reset({ html: links });
    await page.waitForFunction(
        () =>
            document
                .getElementById('clipped-link')
                ?.getAttribute('tabindex') === '-1'
    );
    assert.equal(
        await page.locator('#clipped-link').getAttribute('aria-hidden'),
        'true'
    );
    await page.locator('#before').focus();
    await page.keyboard.press('Tab');
    assert.equal(
        await page
            .locator('#visible-link')
            .evaluate((node) => document.activeElement === node),
        true
    );
    await page.keyboard.press('Tab');
    assert.equal(
        await toggle().evaluate((node) => document.activeElement === node),
        true
    );
    await toggle().click();
    await page.waitForFunction(
        () =>
            document
                .getElementById('clipped-link')
                ?.getAttribute('tabindex') === '3'
    );
    assert.equal(
        await page.locator('#clipped-link').getAttribute('aria-hidden'),
        'false'
    );
    await page.locator('#before').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(
        await page
            .locator('#clipped-link')
            .evaluate((node) => document.activeElement === node),
        true
    );
    await toggle().click();
    await page.waitForFunction(
        () =>
            document
                .getElementById('clipped-link')
                ?.getAttribute('tabindex') === '-1'
    );
    await page.evaluate(() => window.__htmlFixture.saveLinks());
    await update({ visible: false });
    const restored = await page.evaluate(() =>
        window.__htmlFixture.savedLinks()
    );
    assert.deepEqual(restored, [
        {
            connected: false,
            id: 'visible-link',
            tabIndex: null,
            ariaHidden: null,
        },
        {
            connected: false,
            id: 'clipped-link',
            tabIndex: '3',
            ariaHidden: 'false',
        },
    ]);
    await check(
        'real Tab clipping and exact original attributes restore on expand and cleanup'
    );

    for (const html of ['<p>Everything fits.</p>', '<p><br></p>', '<p> </p>']) {
        await reset({ html });
        await page.waitForFunction(
            () => !window.__nativeProbe.snapshot().toggle
        );
        assert(
            (await flush()).viewport.scroll <= (await flush()).viewport.client
        );
    }
    await check(
        'short/markup-empty/whitespace descriptions with measurable layout need no disclosure'
    );

    const ownedImageURL = new URL(htmlDescriptionBrowserImagePath, page.url())
        .href;
    assert.equal(new URL(ownedImageURL).origin, new URL(page.url()).origin);
    // Persist diagnostics before any wait so a failed image observation retains
    // its actual canonical source, transport result and cleanup disposition.
    const ownedImageLoad = {
        url: ownedImageURL,
        requests: [],
        responses: [],
        requestFailures: [],
        routeErrors: [],
        before: null,
        after: null,
        final: null,
        cleanup: {
            released: false,
            routeRemoved: false,
            responseListenerRemoved: false,
            failureListenerRemoved: false,
            errors: [],
        },
    };
    evidence.ownedImageLoad = ownedImageLoad;
    let releaseImage;
    const heldImage = new Promise((resolve) => {
        releaseImage = resolve;
    });
    const imageRoutes = [];
    const holdOwnedImage = (route) => {
        const pending = (async () => {
            try {
                const request = route.request();
                ownedImageLoad.requests.push({
                    url: request.url(),
                    method: request.method(),
                    resourceType: request.resourceType(),
                });
                // Include actual route admission in the existing browser wait,
                // rather than racing a DOM-only fit observation against CDP.
                await page.evaluate(() => {
                    window.__htmlFixture.ownedImageAdmitted = true;
                });
                await heldImage;
                // Continue through the existing context-level origin guard and
                // real owned server asset; never fulfill or synthesize an image.
                await route.fallback();
            } catch (error) {
                ownedImageLoad.routeErrors.push(String(error));
            }
        })();
        imageRoutes.push(pending);
        return pending;
    };
    const recordImageResponse = (response) => {
        if (response.url() !== ownedImageURL) return;
        ownedImageLoad.responses.push({
            url: response.url(),
            status: response.status(),
            contentType: response.headers()['content-type'] ?? null,
        });
    };
    const recordImageFailure = (request) => {
        if (request.url() !== ownedImageURL) return;
        ownedImageLoad.requestFailures.push({
            url: request.url(),
            error: request.failure()?.errorText ?? null,
        });
    };
    const readOwnedImage = () =>
        page.evaluate(() => {
            const image = document.getElementById('owned-image');
            const state = window.__nativeProbe.snapshot();
            const bounds = image?.getBoundingClientRect();
            return {
                image: image
                    ? {
                          src: image.getAttribute('src'),
                          currentSrc: image.currentSrc,
                          complete: image.complete,
                          naturalWidth: image.naturalWidth,
                          naturalHeight: image.naturalHeight,
                          width: bounds.width,
                          height: bounds.height,
                      }
                    : null,
                viewport: state.viewport,
                toggle: state.toggle,
                requestAdmitted:
                    window.__htmlFixture.ownedImageAdmitted === true,
            };
        });
    let imageLayout;
    await page.evaluate(() => {
        window.__htmlFixture.ownedImageAdmitted = false;
    });
    await page.route(ownedImageURL, holdOwnedImage);
    page.on('response', recordImageResponse);
    page.on('requestfailed', recordImageFailure);
    try {
        await reset({
            html: `<p>Project diagram</p><p><img id="owned-image" alt="Owned diagram" src="${htmlDescriptionBrowserImagePath}"></p>`,
        });
        ownedImageLoad.before = await readOwnedImage();
        await page.waitForFunction(() => {
            const image = document.getElementById('owned-image');
            const state = window.__nativeProbe.snapshot();
            return (
                window.__htmlFixture.ownedImageAdmitted === true &&
                image &&
                !image.complete &&
                image.naturalHeight === 0 &&
                state.viewport.client > 0 &&
                state.viewport.scroll <= state.viewport.client &&
                !state.toggle
            );
        });
        ownedImageLoad.before = await readOwnedImage();
        assert.equal(
            ownedImageLoad.before.image.src,
            htmlDescriptionBrowserImagePath
        );
        assert.equal(ownedImageLoad.before.image.naturalWidth, 0);
        assert.equal(ownedImageLoad.responses.length, 0);
        assert(
            ownedImageLoad.requests.length > 0,
            'The exact owned image request must be intercepted before release'
        );
        releaseImage();
        ownedImageLoad.cleanup.released = true;
        await page.waitForFunction(() => {
            const image = document.getElementById('owned-image');
            return (
                image?.complete &&
                image.naturalHeight === 160 &&
                !!window.__nativeProbe.snapshot().toggle
            );
        });
        ownedImageLoad.after = await readOwnedImage();
        assert.equal(ownedImageLoad.after.image.currentSrc, ownedImageURL);
        assert.equal(ownedImageLoad.after.image.naturalWidth, 80);
        assert(ownedImageLoad.requests.length > 0);
        assert(
            ownedImageLoad.requests.every(
                (request) =>
                    request.url === ownedImageURL &&
                    request.method === 'GET' &&
                    request.resourceType === 'image'
            )
        );
        assert(ownedImageLoad.responses.length > 0);
        for (const response of ownedImageLoad.responses) {
            assert.equal(response.status, 200);
            assert.match(
                response.contentType ?? '',
                /^image\/svg\+xml(?:;|$)/i
            );
        }
        assert.deepEqual(ownedImageLoad.requestFailures, []);
        assert.deepEqual(ownedImageLoad.routeErrors, []);
        imageLayout = (await flush()).viewport;
        assert(imageLayout.scroll > imageLayout.client);
        await check(
            'one fixed same-origin owned image load remeasures actual overflow'
        );
    } catch (error) {
        ownedImageLoad.error = String(error);
        throw error;
    } finally {
        // A failed pre-load observation must not leave the real request held or
        // remove the shared harness's context-level network guard.
        releaseImage();
        ownedImageLoad.cleanup.released = true;
        try {
            await page.unroute(ownedImageURL, holdOwnedImage);
            ownedImageLoad.cleanup.routeRemoved = true;
        } catch (error) {
            ownedImageLoad.cleanup.errors.push(String(error));
        } finally {
            try {
                // Settle admitted handlers and capture the final DOM while the
                // exact-target transport diagnostics are still attached.
                await Promise.all(imageRoutes);
                ownedImageLoad.final = await readOwnedImage();
            } catch (error) {
                ownedImageLoad.cleanup.errors.push(String(error));
            } finally {
                page.off('response', recordImageResponse);
                ownedImageLoad.cleanup.responseListenerRemoved = true;
                page.off('requestfailed', recordImageFailure);
                ownedImageLoad.cleanup.failureListenerRemoved = true;
                try {
                    await page.evaluate(() => {
                        delete window.__htmlFixture.ownedImageAdmitted;
                    });
                    ownedImageLoad.cleanup.admissionMarkerRemoved = true;
                } catch (error) {
                    ownedImageLoad.cleanup.errors.push(String(error));
                }
            }
        }
    }
    assert.deepEqual(ownedImageLoad.cleanup.errors, []);

    await reset({ html: '<p>' + 'wrapping '.repeat(25) + '</p>', width: 150 });
    await page.waitForFunction(() => !!window.__nativeProbe.snapshot().toggle);
    await update({ width: 1200 });
    await page.waitForFunction(() => !window.__nativeProbe.snapshot().toggle);
    await update({ width: 150 });
    await page.waitForFunction(() => !!window.__nativeProbe.snapshot().toggle);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await check(
        'real container layout plus native ResizeObserver/window resize stay synchronized'
    );

    await reset({ surface: 'quill', html: '<p>Last help</p>' });
    await page.locator('#adjacent').fill('Keep draft');
    assert.deepEqual(
        await page.evaluate(() => window.__htmlFixture.appCheck()),
        { unexpected: 0, unchanged: true, globalReads: 0, globalWrites: 0 }
    );
    await update({ visible: false });
    const final = await check(
        'metadata/unmount leave surrounding Form, draft and foreign sanitizer untouched'
    );
    assert.equal(final.htmlRef, null);
    assert.equal(final.quillRef, null);
    assert.equal(groups.length, 12);
    Object.assign(evidence, {
        groups,
        containment,
        standalone,
        snow,
        collapsed,
        expanded,
        restored,
        imageLayout,
        ownedImage: htmlDescriptionBrowserImagePath,
        scope: 'Actual candidate public HTML components/CSS and private browser purifier in ordinary Chromium. One fixed owned image request; no provider/Form persistence or editor-runtime coexistence claim.',
        cleanup:
            'Existing shared harness owns page/context/browser/server. No foreign purifier hooks are removed.',
    });
}

export const htmlDescriptionEditorReferenceBrowserStyle = String.raw`html {overflow-y:scroll}
body {font-family:Arial,sans-serif;margin:16px}
#reference-editor-mount {width:560px}
#reference-html-mount {width:360px;margin-top:24px}
`;

/** Separate real reference package. Its public stylesheet loads before baseline. */
export const htmlDescriptionEditorReferenceBrowserSource = String.raw`import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CompleteRichTextEditor} from '@miniextensions/sdk-rich-text-reference/react';
import {CompleteHTMLRenderer,CompleteQuillHTMLRenderer,CompleteTruncatedDescription} from '@miniextensions/sdk/react/html';
const markdown = '# Style heading\n\n**Strong** *Emphasis*\n\n- Ordinary list\n\n1. Ordered list\n\n[Owned link](#owned)\n\n- [x] Checked item';
const editorRef = React.createRef();
const state = {value:markdown,writes:[],generation:0,errors:[],requests:0,submits:0};
let root,savedDOM;
window.addEventListener('error',(event) => state.errors.push(String(event.error || event.message)));
window.addEventListener('unhandledrejection',(event) => state.errors.push(String(event.reason)));
window.fetch = async () => {state.requests++;throw Error('No reference fixture fetch');};
XMLHttpRequest.prototype.open = function () {state.requests++;throw Error('No reference fixture XHR');};
function attached() {
    const mount = document.getElementById('reference-editor-mount');
    const handle = editorRef.current,dom = handle?.view?.dom;
    const wrapper = dom?.closest('.me-rich-text');
    return !!(dom instanceof HTMLElement && dom.isConnected && mount?.contains(dom) &&
        handle.element?.contains(dom) && mount.querySelectorAll('.ProseMirror').length === 1 &&
        mount.querySelector('.ProseMirror') === dom && dom.getAttribute('role') === 'textbox' &&
        dom.getAttribute('contenteditable') === 'true' && dom.id === 'reference-editor' &&
        dom.getAttribute('aria-labelledby') === 'reference-editor-label' &&
        wrapper?.getAttribute('aria-busy') !== 'true');
}
function metrics() {
    const dom = editorRef.current?.view?.dom;
    if (!attached()) return null;
    const wrapper = dom.closest('.me-rich-text');
    const nodes = {editor:dom,frame:wrapper.querySelector('.me-rich-text-editor'),
        heading:dom.querySelector('h1'),strong:dom.querySelector('strong'),em:dom.querySelector('em'),
        unordered:dom.querySelector('ul'),ordered:dom.querySelector('ol'),link:dom.querySelector('a[href="#owned"]'),
        checkbox:dom.querySelector('input[type="checkbox"]')};
    return Object.fromEntries(Object.entries(nodes).map(([name,node]) => {
        if (!node) return [name,null];
        const style = getComputedStyle(node),box = node.getBoundingClientRect();
        return [name,{fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,
            fontStyle:style.fontStyle,lineHeight:style.lineHeight,color:style.color,
            backgroundColor:style.backgroundColor,whiteSpace:style.whiteSpace,
            padding:style.padding,margin:style.margin,border:style.border,borderRadius:style.borderRadius,
            listStyleType:style.listStyleType,textDecoration:style.textDecoration,
            maxHeight:style.maxHeight,overflowY:style.overflowY,
            width:box.width,height:box.height,checked:node instanceof HTMLInputElement ? node.checked : null}];
    }));
}
function snapshot() {
    const dom = editorRef.current?.view?.dom;
    return {...state,writes:[...state.writes],errors:[...state.errors],reactVersion:React.version,
        attached:attached(),sameDOM:savedDOM === dom,text:dom?.textContent ?? null,metrics:metrics()};
}
window.__nativeProbe = {snapshot};
function EditorHolder() {
    const [value,setValue] = useState(state.value);
    const change = useCallback((next) => {state.writes.push(next);state.value = next;setValue(next);},[]);
    return React.createElement(CompleteRichTextEditor,{
        ref:editorRef,value,onValueChange:change,identity:'html-style-' + state.generation,
        id:'reference-editor',ariaLabelledBy:'reference-editor-label',readOnly:false,
        linkColor:'#123456',linkHoverColor:'#123456',
    });
}
function App() {
    return React.createElement('form',{onSubmit(event) {event.preventDefault();state.submits++;}},
        React.createElement('button',{id:'reference-before',type:'button'},'Before'),
        React.createElement('label',{id:'reference-editor-label'},'Real reference editor'),
        React.createElement('section',{id:'reference-editor-mount'},
            React.createElement(EditorHolder,{key:state.generation})),
        React.createElement('section',{id:'reference-html-mount'},
            React.createElement(CompleteHTMLRenderer,{html:'<h2>HTML sibling</h2><ul><li>Item</li></ul>'}),
            React.createElement(CompleteQuillHTMLRenderer,{html:'<p><strong>Quill sibling</strong></p>'}),
            React.createElement(CompleteTruncatedDescription,{html:'<p>Description sibling</p>'.repeat(12)})));
}
window.__htmlEditorReference = {
    capture() {savedDOM = editorRef.current?.view?.dom;return snapshot();},
    resetEditor() {state.value = null;state.generation++;root.render(React.createElement(App));},
};
root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
`;

export async function checkHTMLDescriptionEditorStyleCoexistence({
    page,
    evidence,
    htmlCSSPath = '/html-description.css',
}) {
    await page.waitForFunction(() => {
        const value = window.__nativeProbe?.snapshot();
        return (
            value?.attached === true &&
            value.metrics &&
            Object.values(value.metrics).every(Boolean) &&
            value.metrics.checkbox.checked === true
        );
    });
    await page.locator('#reference-before').focus();
    const before = await page.evaluate(() =>
        window.__htmlEditorReference.capture()
    );
    assert.equal(before.reactVersion, htmlDescriptionRichTextReference.react);
    assert.equal(before.attached, true);
    assert.deepEqual(before.writes, []);
    for (const [name, value] of Object.entries(before.metrics))
        assert(value, 'Actual editor node missing: ' + name);
    assert.equal(before.metrics.link.color, 'rgb(18, 52, 86)');
    assert.equal(before.metrics.checkbox.checked, true);
    assert.equal(before.metrics.strong.fontWeight, '600');
    assert.equal(before.metrics.checkbox.width, 14);
    assert.equal(before.metrics.checkbox.height, 14);
    assert.equal(before.metrics.frame.maxHeight, '640px');
    assert.equal(before.metrics.frame.overflowY, 'auto');
    await page.evaluate(
        (path) =>
            new Promise((resolve, reject) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = path;
                link.onload = () => resolve();
                link.onerror = () =>
                    reject(Error('Owned HTML stylesheet did not load'));
                document.head.append(link);
            }),
        htmlCSSPath
    );
    await page
        .locator('#reference-html-mount .mx-sdk-description__toggle')
        .click();
    await page
        .locator('#reference-html-mount .mx-sdk-description__toggle')
        .click();
    await page.locator('#reference-before').focus();
    const after = await page.evaluate(() => window.__nativeProbe.snapshot());
    assert.equal(after.attached, true);
    assert.equal(after.sameDOM, true);
    assert.equal(after.value, before.value);
    assert.deepEqual(after.writes, before.writes);
    assert.deepEqual(
        after.metrics,
        before.metrics,
        'HTML stylesheet/controls must not restyle real sibling editor nodes'
    );
    assert.deepEqual(after.errors, []);
    assert.equal(after.requests, 0);
    assert.equal(after.submits, 0);
    await page.evaluate(() => window.__htmlEditorReference.resetEditor());
    await page.waitForFunction(() => {
        const value = window.__nativeProbe.snapshot();
        const dom = document.querySelector(
            '#reference-editor-mount .ProseMirror'
        );
        return (
            value.attached &&
            !value.sameDOM &&
            value.value === null &&
            value.writes.length === 0 &&
            dom?.querySelectorAll('p').length === 1 &&
            dom.textContent === ''
        );
    });
    const fresh = await page.evaluate(() =>
        window.__htmlEditorReference.capture()
    );
    assert.equal(fresh.attached, true);
    assert.equal(fresh.value, null);
    assert.deepEqual(fresh.writes, []);
    await page.locator('#reference-editor').focus();
    assert.equal(
        await page
            .locator('#reference-editor')
            .evaluate((node) => document.activeElement === node),
        true
    );
    await page.keyboard.insertText('CoexistenceEdit');
    await page.waitForFunction(() => {
        const value = window.__nativeProbe.snapshot();
        return (
            value.attached &&
            value.value === 'CoexistenceEdit' &&
            value.text === 'CoexistenceEdit' &&
            value.writes.length > 0
        );
    });
    const edited = await page.evaluate(() => window.__nativeProbe.snapshot());
    assert.deepEqual(edited.errors, []);
    assert.equal(edited.requests, 0);
    assert.equal(edited.submits, 0);
    assert.equal(
        edited.sameDOM,
        true,
        'the fresh attached editor must survive controlled callback readback'
    );
    assert.equal(edited.writes.at(-1), 'CoexistenceEdit');
    Object.assign(evidence, {
        reference: htmlDescriptionRichTextReference,
        before,
        after,
        fresh,
        edited,
        scope: 'Real immutable public editor package, unchanged sibling metrics/value while candidate HTML CSS and disclosure operate, plus fresh public ordinary edit. Not full combined SDK/One engine, NodeView or host qualification.',
        cleanup:
            'Existing harness owns page/context/browser and separately prepared reference fixture.',
    });
}
