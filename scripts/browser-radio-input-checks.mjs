import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

// Installed public API only. All radio activation uses trusted browser input.
export async function checkRadioInputBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'building',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const bounded = async (label, operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.radio-input-native-'));
        const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RadioInput} from '@miniextensions/sdk/react';
const refs=new Map(),intents=[];let current,submits=0;
const initial={primary:'a',secondary:'a',accept:true,readOnly:false,disabled:false,cancel:false,allowDeselect:true};
function App(){
 const [state,setState]=useState(initial);current=state;
 const toggle=key=>setState(old=>({...old,[key]:!old[key]}));
 return h(React.Fragment,null,
  ...['primary','secondary'].map(group=>h('form',{id:group+'-form',key:group,onSubmit:event=>{event.preventDefault();submits++;}})),
  h('p',{id:'radio-help'},'Synthetic choices only'),
  ...['primary','secondary'].map(group=>h('fieldset',{key:group,onClickCapture:event=>{if(state.cancel)event.preventDefault();}},
   h('legend',null,group==='primary'?'Primary choice':'Secondary choice'),
   ...['a','b'].map(value=>{const id=group+'-'+value;return h('div',{key:value},
    h(RadioInput,{id,name:'sdk-native-choice',value,form:group+'-form','aria-describedby':'radio-help',checked:state[group]===value,allowDeselect:state.allowDeselect,readOnly:state.readOnly,disabled:state.disabled,
     ref:node=>{if(node)refs.set(id,node);else refs.delete(id);},
     onCheckedChange:(checked,event)=>{intents.push({group,value:event.currentTarget.value,checked,type:event.type,trusted:event.nativeEvent.isTrusted,native:event.currentTarget===refs.get(id),detail:event.detail});if(state.accept)setState(old=>({...old,[group]:checked?value:null}));}}),
    h('label',{htmlFor:id},(group==='primary'?'Primary ':'Secondary ')+(value==='a'?'Alpha':'Beta')));
   }))),
  ...[['accept','Toggle writes'],['readOnly','Toggle readonly'],['disabled','Toggle disabled'],['cancel','Toggle cancellation'],['allowDeselect','Toggle repeat clear']].map(([key,label])=>h('button',{key,type:'button',onClick:()=>toggle(key)},label)));
}
const app=createRoot(document.querySelector('main'));app.render(h(React.StrictMode,null,h(App)));
window.radioInputProbe={snapshot:()=>({reactVersion:React.version,state:{...current},intents:[...intents],submits,refCount:refs.size,refsValid:[...refs].every(([id,node])=>node===document.getElementById(id)&&node.tagName==='INPUT'&&node.type==='radio'),checked:Object.fromEntries([...refs].sort(([a],[b])=>a.localeCompare(b)).map(([id,node])=>[id,node.checked])),forms:Object.fromEntries([...refs].map(([id,node])=>[id,node.form?.id])),focused:document.activeElement?.id})};
`;
        writeFileSync(join(directory, 'host.mjs'), source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [join(directory, 'host.mjs')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((p) =>
            p.includes('/sdk/dist/')
        );
        assert(inputs.some((p) => p.endsWith('/react/RadioInput.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        evidence.sdkInputs = inputs;
        evidence.harnessModuleSha256 = createHash('sha256')
            .update(readFileSync(new URL(import.meta.url)))
            .digest('hex');
        evidence.hostSha256 = createHash('sha256').update(source).digest('hex');
        evidence.bundleSha256 = createHash('sha256')
            .update(bundle.outputFiles[0].contents)
            .digest('hex');
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            if (request.url === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (request.url === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><title>Synthetic native radio proof</title><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'radio server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({ serviceWorkers: 'block' });
        page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        await page.route('**/*', (route) =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : (evidence.unexpectedRequests.push(
                      new URL(route.request().url()).origin
                  ),
                  route.abort())
        );
        const snapshot = () =>
            page.evaluate(() => window.radioInputProbe.snapshot());
        const checked = async (primary, secondary) => {
            const expected = {
                'primary-a': primary === 'a',
                'primary-b': primary === 'b',
                'secondary-a': secondary === 'a',
                'secondary-b': secondary === 'b',
            };
            await page.waitForFunction(
                (expected) =>
                    JSON.stringify(
                        window.radioInputProbe.snapshot().checked
                    ) === JSON.stringify(expected),
                expected
            );
            const state = await snapshot();
            assert.deepEqual(state.checked, expected);
            assert.equal(state.refsValid, true);
            assert.equal(state.refCount, 4);
            assert.equal(state.submits, 0);
            return state;
        };
        const start = async (name) => {
            evidence.phase = name;
            await page.goto(origin);
            await page
                .getByRole('radio', { name: 'Primary Alpha', exact: true })
                .waitFor();
            await checked('a', 'a');
        };
        const finish = async (name) => {
            const state = await snapshot();
            assert(
                state.intents.every(
                    (item) =>
                        item.trusted && item.native && item.type === 'click'
                )
            );
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            evidence.reactVersion = state.reactVersion;
            evidence.results.push({
                name,
                status: 'passed',
                state,
                ax: await page.locator('body').ariaSnapshot(),
            });
            await page.screenshot({
                path: join(output, 'radio-' + name + '.png'),
                fullPage: true,
            });
        };

        await start('label-space');
        const primaryB = page.getByRole('radio', {
            name: 'Primary Beta',
            exact: true,
        });
        await page.locator('label[for=primary-b]').click();
        let state = await checked('b', 'a');
        assert.deepEqual(
            state.intents.map(({ group, value, checked }) => ({
                group,
                value,
                checked,
            })),
            [{ group: 'primary', value: 'b', checked: true }]
        );
        assert.equal(
            await primaryB.evaluate((node) => document.activeElement === node),
            true
        );
        await page.keyboard.press('Space');
        state = await checked(null, 'a');
        assert.equal(state.intents.at(-1).checked, false);
        assert.equal(state.intents.at(-1).detail, 0);
        await page
            .getByRole('button', { name: 'Toggle repeat clear', exact: true })
            .click();
        await page.locator('label[for=primary-b]').click();
        await checked('b', 'a');
        const accepted = (await snapshot()).intents.length;
        await primaryB.focus();
        await page.keyboard.press('Space');
        state = await checked('b', 'a');
        assert.equal(state.intents.length, accepted);
        await finish('label-space');

        await start('arrows-groups');
        await page
            .getByRole('radio', { name: 'Primary Alpha', exact: true })
            .focus();
        await page.keyboard.press('ArrowRight');
        state = await checked('b', 'a');
        assert.equal(state.focused, 'primary-b');
        assert.equal(state.intents.at(-1).detail, 0);
        await page.keyboard.press('ArrowLeft');
        await checked('a', 'a');
        await page.keyboard.press('ArrowRight');
        await checked('b', 'a');
        await page
            .getByRole('radio', { name: 'Secondary Alpha', exact: true })
            .focus();
        await page.keyboard.press('ArrowRight');
        state = await checked('b', 'b');
        assert.equal(state.focused, 'secondary-b');
        assert.equal(state.forms['primary-b'], 'primary-form');
        assert.equal(state.forms['secondary-b'], 'secondary-form');
        assert.equal(await primaryB.getAttribute('name'), 'sdk-native-choice');
        assert.equal(
            await page
                .getByRole('radio', { name: 'Secondary Beta', exact: true })
                .getAttribute('name'),
            'sdk-native-choice'
        );
        await page.keyboard.press('Space');
        await checked('b', null);
        await finish('arrows-groups');

        await start('refusal-policy');
        await page
            .getByRole('button', { name: 'Toggle writes', exact: true })
            .click();
        await page.locator('label[for=primary-b]').click();
        await checked('a', 'a');
        await page
            .getByRole('radio', { name: 'Primary Alpha', exact: true })
            .focus();
        await page.keyboard.press('ArrowRight');
        await checked('a', 'a');
        await primaryB.focus();
        await page.keyboard.press('Space');
        state = await checked('a', 'a');
        assert.equal(state.intents.length, 3);
        assert(state.intents.every((item) => item.checked === true));
        await page
            .getByRole('button', { name: 'Toggle writes', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Toggle readonly', exact: true })
            .click();
        await page.locator('label[for=primary-b]').click();
        await checked('a', 'a');
        await primaryB.focus();
        await page.keyboard.press('Space');
        await checked('a', 'a');
        await page
            .getByRole('radio', { name: 'Primary Alpha', exact: true })
            .focus();
        await page.keyboard.press('ArrowRight');
        await checked('a', 'a');
        assert.equal((await snapshot()).intents.length, 3);
        await page
            .getByRole('button', { name: 'Toggle readonly', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Toggle disabled', exact: true })
            .click();
        await page.locator('label[for=primary-b]').click();
        assert.equal(await primaryB.isDisabled(), true);
        await checked('a', 'a');
        assert.equal((await snapshot()).intents.length, 3);
        await page
            .getByRole('button', { name: 'Toggle disabled', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Toggle cancellation', exact: true })
            .click();
        await primaryB.click();
        await checked('a', 'a');
        assert.equal((await snapshot()).intents.length, 3);
        await finish('refusal-policy');
        assert.equal(evidence.results.length, 3);
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.radioInputProbe?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'radio-failure.png'),
                    fullPage: true,
                });
            } catch (snapshotError) {
                evidence.failureCaptureError = snapshotError.message;
            }
        }
    } finally {
        for (const [name, cleanup] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    new Promise((resolve, reject) => {
                        if (!server) return resolve();
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    }),
            ],
            [
                'fixture',
                () => {
                    if (directory)
                        rmSync(directory, { recursive: true, force: true });
                },
            ],
        ]) {
            try {
                await bounded('radio cleanup ' + name, cleanup);
                evidence.cleanup[name] =
                    (name === 'context' && !context) ||
                    (name === 'server' && !server) ||
                    (name === 'fixture' && !directory)
                        ? 'not-started'
                        : 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                failure ??= error;
            }
        }
    }
    if (failure) throw failure;
}
