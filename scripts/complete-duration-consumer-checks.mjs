import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const completeDurationTypedConsumer = `
import {createElement,createRef,type ComponentProps} from 'react';
import {CompleteDurationField,useDurationInputAdapter} from '@miniextensions/sdk/react';
import {createDurationInputAdapter} from '@miniextensions/sdk/ui';
type DurationProps=ComponentProps<typeof CompleteDurationField>;
const duration:DurationProps={fieldId:'duration',sessionId:'native',format:'h:mm',value:null,onChange(value){const seconds:number|null=value;void seconds;return true;},owner:{token:{},isCurrent:()=>true},inputId:'native-duration',formId:'native-form',inputRef:createRef<HTMLInputElement>(),description:'Timing note',error:'Synthetic error',invalid:true,describedBy:'external-help',clearLabel:'Clear duration'};
createElement(CompleteDurationField,duration);
function hook(){return useDurationInputAdapter(duration);}
const adapter=createDurationInputAdapter({read:()=>({format:duration.format,value:duration.value,onChange:duration.onChange,readOnly:false}),isCurrent:()=>true});
const accepted:boolean=adapter.setInput('7');
const current:boolean=adapter.isCurrent();
const editable:boolean=adapter.canEdit();
// @ts-expect-error canonical Duration values are seconds, never display strings
const textValue:DurationProps={...duration,value:'1:00'};
// @ts-expect-error only the five supported Duration formats are admitted
const invalidFormat:DurationProps={...duration,format:'days'};
// @ts-expect-error a current native owner is mandatory
const missingOwner:DurationProps={fieldId:'duration',sessionId:'native',format:'h:mm',value:0,onChange(){}};
// @ts-expect-error complete Duration owns its markup, not a native-renderer slot
createElement(CompleteDurationField,{...duration,renderInput:()=>null});
void hook;void accepted;void current;void editable;void textValue;void invalidFormat;void missingOwner;
`;

async function checkInstalled(consumerDirectory, happyDomModulePath) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const cjs = consumer('@miniextensions/sdk/react');
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const ui = consumer('@miniextensions/sdk/ui');
    assert.equal(typeof ui.createDurationInputAdapter, 'function');
    const { getFormattedDuration } = consumer('@miniextensions/sdk/formulas');
    const headlessWrites = [];
    const adapter = ui.createDurationInputAdapter({
        read: () => ({
            format: 'h:mm',
            value: null,
            onChange(value) {
                headlessWrites.push(value);
                return true;
            },
        }),
        isCurrent: () => true,
    });
    assert.equal(adapter.setInput('7'), true);
    assert.deepEqual(headlessWrites, [420]);
    const css = readFileSync(
        consumer.resolve('@miniextensions/sdk/react/complete-duration.css'),
        'utf8'
    );
    assert(css.includes('.mx-sdk-complete-duration'));
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    let groups = 0;
    for (const api of [esm, cjs]) {
        assert.equal(typeof api.useDurationInputAdapter, 'function');
        const state = {
            value: 60,
            format: 'h:mm',
            readonly: false,
            current: true,
            scope: {},
            writer: 'initial',
        };
        const writes = [];
        let mounted = false,
            root;
        const ref = React.createRef();
        const properties = () => {
            const scope = state.scope;
            const writer = state.writer;
            return {
                fieldId: 'duration',
                sessionId: 'duration-session',
                format: state.format,
                value: state.value,
                readOnly: state.readonly,
                owner: {
                    token: scope,
                    isCurrent: () => state.current && scope === state.scope,
                },
                onChange(value) {
                    if (
                        !state.current ||
                        scope !== state.scope ||
                        state.readonly
                    )
                        return false;
                    writes.push({ writer, value });
                    state.value = value;
                    if (mounted) publish();
                    return true;
                },
                title: 'Synthetic duration',
                inputId: 'installed-duration',
                formId: 'native-duration-form',
                description: 'Synthetic timing note',
                error: 'Synthetic duration error',
                describedBy: 'external-help',
                clearLabel: 'Clear duration',
                inputRef: ref,
            };
        };
        const element = (props = properties()) =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.CompleteDurationField, props)
            );
        assert.equal(typeof globalThis.window, 'undefined');
        const html = renderToString(element());
        assert(html.includes('value="0:01"'));
        assert(html.includes('form="native-duration-form"'));
        assert(html.includes('Synthetic duration error'));
        assert.deepEqual(writes, []);
        const defaultHtml = renderToString(
            React.createElement(api.CompleteDurationField, {
                ...properties(),
                inputId: undefined,
                formId: undefined,
                clearLabel: undefined,
            })
        );
        assert(defaultHtml.includes('form="form-duration-session"'));
        assert(!defaultHtml.includes('<button'));

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
        const form = window.document.createElement('form');
        form.id = 'native-duration-form';
        const help = window.document.createElement('p');
        help.id = 'external-help';
        help.textContent = 'External timing help';
        const container = window.document.createElement('div');
        form.append(help, container);
        window.document.body.append(form);
        let submits = 0;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            submits++;
        });
        function publish() {
            root.render(element());
        }
        const setInput = async (input, value) => {
            await React.act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(input, value);
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        };
        try {
            const { createRoot, hydrateRoot } = consumer('react-dom/client');
            container.innerHTML = html;
            const hydrationErrors = [];
            await React.act(async () => {
                root = hydrateRoot(container, element(), {
                    onRecoverableError: (error) => hydrationErrors.push(error),
                });
                mounted = true;
            });
            assert.deepEqual(hydrationErrors, []);
            assert.deepEqual(writes, []);
            await React.act(async () => root.unmount());
            mounted = false;
            container.replaceChildren();
            root = createRoot(container);
            mounted = true;
            await React.act(async () => publish());
            const input = container.querySelector('input');
            assert(input);
            assert.equal(ref.current, input);
            assert.equal(input.id, 'installed-duration');
            assert.equal(input.form, form);
            assert.equal(input.getAttribute('aria-invalid'), 'true');
            const descriptions = input
                .getAttribute('aria-describedby')
                .split(/\s+/);
            assert(descriptions.includes('external-help'));
            assert(
                descriptions.some((id) =>
                    window.document
                        .getElementById(id)
                        ?.textContent.includes('Synthetic timing note')
                )
            );
            assert(
                descriptions.some((id) =>
                    window.document
                        .getElementById(id)
                        ?.textContent.includes('Synthetic duration error')
                )
            );
            await React.act(async () => input.focus());
            await setInput(input, '7');
            assert.deepEqual(writes, [{ writer: 'initial', value: 420 }]);
            assert.equal(input.value, '7');
            input.setSelectionRange(1, 1);
            state.value = 120;
            state.writer = 'current';
            await React.act(async () => publish());
            assert.equal(ref.current, input);
            assert.equal(input.value, '7');
            assert.equal(input.selectionStart, 1);
            await React.act(async () => input.blur());
            assert.equal(input.value, '0:02');
            assert.equal(writes.length, 1);
            await React.act(async () => input.focus());
            state.format = 'h:mm:ss.SSS';
            await React.act(async () => publish());
            assert.equal(
                input.value,
                getFormattedDuration('120', state.format, true)
            );
            assert.equal(writes.length, 1);
            await setInput(input, '-1.25');
            assert.deepEqual(writes.at(-1), {
                writer: 'current',
                value: -1.25,
            });
            await setInput(input, '1:');
            assert.deepEqual(writes.at(-1), { writer: 'current', value: 0 });
            assert.equal(input.value, '1:');
            const beforeBlur = writes.length;
            await React.act(async () => input.blur());
            assert.equal(
                input.value,
                getFormattedDuration('0', state.format, true)
            );
            assert.equal(writes.length, beforeBlur);
            const clear = container.querySelector(
                'button[aria-label="Clear duration"]'
            );
            assert(clear);
            assert.equal(clear.type, 'button');
            await React.act(async () => clear.click());
            assert.deepEqual(writes.at(-1), { writer: 'current', value: null });
            assert.equal(input.value, '');
            state.value = 90;
            state.scope = {};
            await React.act(async () => publish());
            state.readonly = true;
            await React.act(async () => publish());
            const beforeRefusal = writes.length;
            await setInput(input, '8');
            assert.equal(writes.length, beforeRefusal);
            state.readonly = false;
            state.current = false;
            await React.act(async () => publish());
            await setInput(input, '9');
            assert.equal(writes.length, beforeRefusal);
            groups++;
        } finally {
            mounted = false;
            if (root) await React.act(async () => root.unmount());
            assert.equal(ref.current, null);
            assert.equal(submits, 0);
            keys.forEach((key, index) => {
                if (originals[index])
                    Object.defineProperty(globalThis, key, originals[index]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return {
        react: React.version,
        groups,
        scope: 'Installed ESM/CommonJS complete Duration, actual SSR/hydration, native seconds, focus and associations; no native Form/backend claim.',
    };
}

export function checkCompleteDurationReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-complete-duration-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
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
                const name = `complete-duration.${extension}`;
                writeFileSync(
                    join(directory, name),
                    completeDurationTypedConsumer
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
                    name,
                ]);
            }
            const bytes = execFileSync(
                process.execPath,
                [
                    fileURLToPath(import.meta.url),
                    '--run-consumer',
                    directory,
                    happyDomModulePath,
                ],
                { cwd: directory, encoding: 'utf8' }
            );
            const result = JSON.parse(bytes);
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            versions.push(result);
            console.log(
                `Installed complete Duration React${result.react}: 2 ESM/CommonJS groups, actual SSR/hydration, canonical seconds, associations and styles passed.`
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
