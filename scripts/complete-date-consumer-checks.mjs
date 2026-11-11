import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const completeDateTypedConsumer = `
import {createElement,createRef} from 'react';
import {CompleteDateField,type CompleteDateFieldProps} from '@miniextensions/sdk/react/date';
const date:CompleteDateFieldProps={id:'date',sessionId:'session',airtableDateConfig:{type:'dateTime',options:{dateFormat:{format:'M/D/YYYY'},timeFormat:{format:'h:mma'},timeZone:'America/New_York'}},value:'2024-07-01T10:30:12.345-04:00',setValue(value){const native:string|null=value;void native;return true;},language:'en',owner:{token:{},isCurrent:()=>true},calendarAlign:'end',inputRef:createRef<HTMLInputElement>(),title:'Appointment',description:'Help',error:'Error',formId:'native-form'};
createElement(CompleteDateField,date);
// @ts-expect-error native dates are canonical string/null values
const wrongValue:CompleteDateFieldProps={...date,value:12};
// @ts-expect-error no native picker/render slot is needed or admitted
createElement(CompleteDateField,{...date,renderInput:()=>null});
// @ts-expect-error range values retain the existing finite native contract
const wrongRange:CompleteDateFieldProps={...date,dateRange:'tomorrow'};
void wrongValue;void wrongRange;
`;
const initial = {
    id: 'installed-date',
    sessionId: 'session',
    value: '2024-07-01T10:30:12.345-04:00',
    airtableDateConfig: {
        type: 'dateTime',
        options: {
            dateFormat: { format: 'YYYY-MM-DD' },
            timeFormat: { format: 'HH:mm' },
            timeZone: 'UTC',
        },
    },
    language: 'en',
    title: 'Appointment',
    description: 'Synthetic help',
    error: 'Synthetic error',
    formId: 'native-form',
};

async function load(consumer, format) {
    return format === 'cjs'
        ? consumer('@miniextensions/sdk/react/date')
        : import(
              pathToFileURL(
                  consumer
                      .resolve('@miniextensions/sdk/react/date')
                      .replace('/cjs/', '/esm/')
              ).href
          );
}

async function server(directory, format) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    assert.equal(consumer('react-dom/package.json').version, React.version);
    const api = await load(consumer, format);
    let writes = 0;
    assert.equal(typeof document, 'undefined');
    const html = consumer('react-dom/server').renderToString(
        React.createElement(api.CompleteDateField, {
            ...initial,
            setValue() {
                writes++;
            },
        })
    );
    assert.equal(writes, 0);
    assert.equal(typeof document, 'undefined');
    assert(html.includes('value="2024-07-01 14:30"'));
    return { html, react: React.version };
}

async function mounted(directory, format, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    for (const key of [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'Node',
        'NodeFilter',
        'Element',
        'CustomEvent',
        'MutationObserver',
        'ResizeObserver',
    ])
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value: window[key],
        });
    globalThis.getComputedStyle = window.getComputedStyle.bind(window);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const React = consumer('react');
    assert.equal(consumer('react-dom/package.json').version, React.version);
    const { hydrateRoot } = consumer('react-dom/client');
    const api = await load(consumer, format);
    const ssr = JSON.parse(
        execFileSync(
            process.execPath,
            [fileURLToPath(import.meta.url), '--ssr', directory, format],
            { encoding: 'utf8' }
        )
    );
    assert.equal(ssr.react, React.version);
    const form = document.createElement('form');
    form.id = 'native-form';
    const container = document.createElement('div');
    form.append(container);
    document.body.append(form);
    container.innerHTML = ssr.html;
    const originalInput = container.querySelector('input');
    let props = { ...initial },
        writes = [],
        submits = 0,
        root;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const element = () =>
        React.createElement(api.CompleteDateField, {
            ...props,
            setValue(value) {
                writes.push(value);
                props = { ...props, value };
                publish();
            },
        });
    let shell = (child) => child;
    const publish = () => root.render(shell(element()));
    const render = async (patch) => {
        props = { ...props, ...patch };
        await React.act(async () => publish());
    };
    const input = () => container.querySelector('input');
    const edit = async (value) =>
        React.act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            ).set.call(input(), value);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    const key = async (isComposing = false) => {
        const event = new window.KeyboardEvent('keydown', {
            key: 'Enter',
            isComposing,
            bubbles: true,
            cancelable: true,
        });
        await React.act(async () => input().dispatchEvent(event));
        assert.equal(event.defaultPrevented, true);
    };
    const click = async (selector) => {
        const node = document.querySelector(selector);
        assert(node, selector);
        await React.act(async () =>
            node.dispatchEvent(
                new window.MouseEvent('click', { bubbles: true })
            )
        );
    };
    try {
        await React.act(async () => {
            root = hydrateRoot(container, element());
        });
        assert.equal(
            input(),
            originalInput,
            'Hydration must retain the actual input'
        );
        assert.deepEqual(writes, []);
        assert.equal(
            input().getAttribute('aria-describedby'),
            'installed-date-description installed-date-error'
        );
        assert.equal(input().form, form);
        await edit('2024-07-');
        input().setSelectionRange(5, 5);
        await render({
            placeholder: 'Cosmetic hint',
            airtableDateConfig: structuredClone(props.airtableDateConfig),
        });
        assert.equal(input().value, '2024-07-');
        assert.equal(input().selectionStart, 5);
        await render({
            airtableDateConfig: {
                ...props.airtableDateConfig,
                options: {
                    ...props.airtableDateConfig.options,
                    timeZone: 'America/New_York',
                },
            },
        });
        assert.equal(input().value, '2024-07-01 10:30');
        assert.deepEqual(writes, []);
        await edit('2024-07-01 10:31');
        await key(true);
        assert.deepEqual(writes, []);
        await key();
        assert.deepEqual(writes, ['2024-07-01T14:31:00.000Z']);
        await render({ readOnly: true, dateRange: 'today or in the future' });
        assert.equal(input().disabled, true);
        await key();
        assert.equal(writes.length, 1);
        const iso = {
            type: 'date',
            options: { dateFormat: { format: 'YYYY-MM-DD' } },
        };
        for (const year of [2024, 2025]) {
            await render({
                readOnly: false,
                dateRange: undefined,
                airtableDateConfig: iso,
                value: `${year}-02-01`,
                sessionId: String(year),
            });
            await React.act(async () =>
                input().dispatchEvent(
                    new window.FocusEvent('focusin', { bubbles: true })
                )
            );
            assert.equal(input().getAttribute('aria-expanded'), 'true');
            await click('.rdtOld[data-value="31"]');
            assert.equal(writes.at(-1), `${year}-01-31`);
            await React.act(async () =>
                input().dispatchEvent(
                    new window.FocusEvent('focusin', { bubbles: true })
                )
            );
            await click('.rdtNext');
            await click('.rdtPrev');
            await window.happyDOM.waitUntilComplete();
            await React.act(async () => {
                document.body.dispatchEvent(
                    new window.MouseEvent('mousedown', { bubbles: true })
                );
                document.body.dispatchEvent(
                    new window.Event('pointerdown', { bubbles: true })
                );
            });
            assert.equal(
                input().getAttribute('aria-expanded'),
                'false',
                'Outside pointer dismisses the actual popup'
            );
            await React.act(async () =>
                input().dispatchEvent(
                    new window.FocusEvent('focusout', { bubbles: true })
                )
            );
        }
        const count = writes.length;
        await render({ owner: { token: {}, isCurrent: () => false } });
        await edit('2024-02-29');
        await key();
        assert.equal(writes.length, count);
        assert.equal(submits, 0);
        const css = readFileSync(
            consumer.resolve('@miniextensions/sdk/react/complete-date.css'),
            'utf8'
        );
        assert(css.includes('.mx-sdk-complete-date-popup'));
        assert(css.includes('.mx-sdk-complete-date-input'));
        const installed = join(directory, 'node_modules/@miniextensions/sdk');
        const vendor = createRequire(
            join(installed, 'dist/vendor/date-time/index.cjs')
        );
        assert.equal(vendor('react'), React);
        assert.equal(vendor('react-dom'), consumer('react-dom'));
        const Dialog = consumer('@radix-ui/react-dialog');
        props = { ...initial };
        shell = (child) =>
            React.createElement(
                Dialog.Root,
                { defaultOpen: true },
                React.createElement(
                    Dialog.Portal,
                    null,
                    React.createElement(
                        Dialog.Content,
                        {
                            'aria-label': 'External native dialog',
                            'aria-describedby': undefined,
                        },
                        React.createElement(
                            Dialog.Title,
                            null,
                            'External native dialog'
                        ),
                        child
                    )
                )
            );
        await React.act(async () => publish());
        const externalDialog = document.querySelector(
            '[role="dialog"][aria-label="External native dialog"]'
        );
        assert(externalDialog, 'Actual external Radix dialog mounted');
        const nestedInput = externalDialog.querySelector('input');
        assert(nestedInput);
        await React.act(async () => nestedInput.focus());
        assert.equal(nestedInput.getAttribute('aria-expanded'), 'true');
        const nestedPopup = document.getElementById(
            nestedInput.getAttribute('aria-controls')
        );
        assert(nestedPopup && externalDialog.contains(nestedPopup));
        // Exercise Escape from popup focus as well as from the input. The
        // independently bundled popup must not dismiss the native dialog.
        await React.act(async () => nestedPopup.focus());
        await React.act(async () =>
            nestedPopup.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(
            externalDialog.isConnected,
            true,
            'Escape preserves the parent dialog'
        );
        assert.equal(nestedInput.getAttribute('aria-expanded'), 'false');
        assert.equal(document.activeElement, nestedInput);
        await React.act(async () =>
            nestedInput.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(
            externalDialog.isConnected,
            false,
            'A later Escape still dismisses the native dialog'
        );
        assert.equal(submits, 0);
        return {
            react: React.version,
            format,
            groups: 1,
            hydration: true,
            mountedMonthBoundaryYears: [2024, 2025],
            externalRadixDialogEscape: true,
            submits,
        };
    } finally {
        if (root) await React.act(async () => root.unmount());
        await window.happyDOM.close();
    }
}

export function checkCompleteDateReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const temporary = mkdtempSync(join(tmpdir(), 'sdk-complete-date-'));
    const versions = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const directory = join(temporary, version.react);
            mkdirSync(directory);
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                    },
                })
            );
            execFileSync(
                'npm',
                [
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
                    '@radix-ui/react-dialog@1.1.14',
                ],
                { cwd: directory, stdio: 'inherit' }
            );
            for (const extension of ['mts', 'cts']) {
                const name = `complete-date.${extension}`;
                writeFileSync(join(directory, name), completeDateTypedConsumer);
                execFileSync(
                    process.execPath,
                    [
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
                    ],
                    { cwd: directory, stdio: 'inherit' }
                );
            }
            const profiles = [];
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    execFileSync(
                        process.execPath,
                        [
                            fileURLToPath(import.meta.url),
                            '--mounted',
                            directory,
                            format,
                            happyDomModulePath,
                        ],
                        { cwd: directory, encoding: 'utf8' }
                    )
                );
                assert.equal(result.react, version.react);
                assert.equal(result.groups, 1);
                profiles.push(result);
            }
            versions.push({ react: version.react, profiles });
            console.log(
                `Installed complete Date React${version.react}: ESM/CommonJS/types/styles, cold SSR/hydration, actual fork mount/update/outside-click/unmount passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
if (process.argv[2] === '--ssr')
    console.log(JSON.stringify(await server(process.argv[3], process.argv[4])));
if (process.argv[2] === '--mounted')
    console.log(
        JSON.stringify(
            await mounted(process.argv[3], process.argv[4], process.argv[5])
        )
    );
