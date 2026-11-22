import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const stylesheet = 'complete-extension-password.css';
const packageName = '@miniextensions/sdk';
const runSsrFlag = '--run-extension-password-consumer-ssr';

const typedConsumer = String.raw`
import { createElement, version } from 'react';
import { renderToString } from 'react-dom/server';
import type { AuthOwnerScope } from '@miniextensions/sdk/auth';
import {
    CompleteExtensionPasswordScreen,
    type CompleteExtensionPasswordScreenLabels,
    type CompleteExtensionPasswordScreenProps,
    type CompleteExtensionPasswordScreenResult,
} from '@miniextensions/sdk/react';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Props = CompleteExtensionPasswordScreenProps;
type Result = CompleteExtensionPasswordScreenResult;

type PropsKeys = Assert<Equal<keyof Props,
    'scope' | 'labels' | 'verifyPassword' | 'className' | 'accentColor'>>;
type ExactScope = Assert<Equal<Props['scope'], AuthOwnerScope>>;
type ExactVerifier = Assert<Equal<Props['verifyPassword'],
    (password: string) => Promise<Result>>>;
type ExactResult = Assert<Equal<Result, Readonly<{
    type: 'correct' | 'wrong' | 'blocked' | 'error';
}>>>;
type ReactOnly = Assert<Equal<Extract<'CompleteExtensionPasswordScreen',
    keyof typeof import('@miniextensions/sdk') | keyof typeof import('@miniextensions/sdk/auth')>, never>>;

const labels: CompleteExtensionPasswordScreenLabels = {
    password: 'Mot de passe',
    submit: 'Suivant',
    pending: 'Vérification en cours',
    wrong: 'Mot de passe incorrect',
    blocked: 'Trop de tentatives',
    error: 'Vérification impossible',
};

export function renderConsumers() {
    let verifications = 0;
    const first: Props = {
        scope: { ownerId: 'synthetic-form', revision: 1 },
        labels,
        async verifyPassword(password) {
            const literal: string = password;
            void literal;
            verifications++;
            return { type: 'wrong' };
        },
    };
    const second: Props = { ...first, scope: { ownerId: 'synthetic-portal', revision: 2 } };
    const html = renderToString(createElement('main', null,
        createElement(CompleteExtensionPasswordScreen, first),
        createElement(CompleteExtensionPasswordScreen, second)
    ));
    return { react: version, html, verifications };
}
`;

async function verifyServerRendering(
    directory,
    output,
    react,
    happyDomModulePath
) {
    const consumer = createRequire(join(directory, 'package.json'));
    const entry = `${packageName}/react`;
    const sdkRoot = join(directory, 'node_modules', packageName);
    const { exports } = JSON.parse(
        readFileSync(join(sdkRoot, 'package.json'), 'utf8')
    );
    const stylesheetExport = `./react/${stylesheet}`;
    const esmStylesheet = `./dist/esm/react/${stylesheet}`;
    assert.deepEqual(
        Object.keys(exports).filter((key) => key.endsWith(`/${stylesheet}`)),
        [stylesheetExport]
    );
    assert.equal(exports[stylesheetExport], esmStylesheet);
    const cssPath = consumer.resolve(`${entry}/${stylesheet}`);
    assert.equal(cssPath, realpathSync(join(sdkRoot, esmStylesheet)));
    const css = readFileSync(cssPath);
    assert.deepEqual(
        css,
        readFileSync(join(sdkRoot, 'dist/cjs/react', stylesheet))
    );
    assert(css.includes('.mx-sdk-extension-password-panel'));
    assert(css.includes('.mx-sdk-extension-password-spinner'));

    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const esm = await import(pathToFileURL(join(output, 'consumer.mjs')).href);
    const cjs = consumer(join(output, 'consumer.cjs'));
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    for (const module of [esm, cjs]) {
        const rendered = module.renderConsumers();
        assert.equal(rendered.react, react);
        assert.equal(rendered.verifications, 0);

        const window = new Window();
        try {
            window.document.body.innerHTML = rendered.html;
            const forms = Array.from(window.document.querySelectorAll('form'));
            assert.equal(forms.length, 2);
            const inputIds = forms.map((form) => {
                const label = form.querySelector('label');
                const input = form.querySelector('input');
                const button = form.querySelector('button');
                assert(label && input && button);
                assert.equal(label.textContent, 'Mot de passe');
                assert.equal(button.textContent, 'Suivant');
                assert(input.id);
                assert.equal(label.htmlFor, input.id);
                assert.equal(input.type, 'password');
                assert.equal(input.value, '');
                assert.equal(button.type, 'submit');
                assert.equal(button.disabled, true);
                return input.id;
            });
            assert.equal(new Set(inputIds).size, forms.length);
        } finally {
            await window.happyDOM.close();
        }
    }
}

/** Compile and render the public entry using the caller's installed consumer. */
export function checkInstalledCompleteExtensionPassword({
    directory,
    react,
    typescriptBin,
    happyDomModulePath,
}) {
    const consumerDirectory = resolve(directory);
    const scratch = mkdtempSync(join(consumerDirectory, 'extension-password-'));
    try {
        const output = join(scratch, 'emitted');
        const sources = ['consumer.mts', 'consumer.cts'];
        for (const source of sources) {
            writeFileSync(join(scratch, source), typedConsumer, { flag: 'wx' });
        }
        execFileSync(
            process.execPath,
            [
                typescriptBin,
                '--strict',
                '--skipLibCheck',
                'false',
                '--target',
                'ES2022',
                '--module',
                'NodeNext',
                '--moduleResolution',
                'NodeNext',
                '--noEmitOnError',
                '--outDir',
                output,
                ...sources,
            ],
            { cwd: scratch, stdio: 'inherit' }
        );
        execFileSync(
            process.execPath,
            [
                fileURLToPath(import.meta.url),
                runSsrFlag,
                consumerDirectory,
                output,
                react,
                happyDomModulePath,
            ],
            { cwd: consumerDirectory, stdio: 'inherit' }
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
    return { react, formats: ['esm', 'cjs'], cleanup: 'completed' };
}

if (process.argv[2] === runSsrFlag) {
    await verifyServerRendering(...process.argv.slice(3));
}
