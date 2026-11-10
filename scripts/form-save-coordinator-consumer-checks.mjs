import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const formSaveCoordinatorTypedConsumer = `
import { createFormSaveCoordinator, type FormSaveCoordinator, type FormSaveInvocation, type FormSaveCoordinatorOptions } from '@miniextensions/sdk/forms';
type SaveSnapshot = { record: { value: string }; dirty: readonly string[] } | null;
const coordinatorOptions: FormSaveCoordinatorOptions<SaveSnapshot> = {isEqual: (a, b) => a === b};
const coordinator: FormSaveCoordinator<symbol, SaveSnapshot> = createFormSaveCoordinator<symbol, SaveSnapshot>(coordinatorOptions);
const invocation: FormSaveInvocation<symbol, SaveSnapshot> = {sessionKey: Symbol(), readSnapshot: () => null, allocate: () => Promise.resolve({stored: false})};
const completion: Promise<void> = coordinator.run(invocation);
// @ts-expect-error An opaque key must keep its declared type.
coordinator.run({...invocation, sessionKey: 'other'});
// @ts-expect-error Snapshot callbacks retain their host type.
coordinator.run({...invocation, readSnapshot: () => 5});
// @ts-expect-error The guarded callback must return its operation Promise.
coordinator.run({...invocation, allocate: () => 5});
void completion;
`;

/** Installed public imports, no Redux, Form client, React or browser globals. */
export async function checkFormSaveCoordinatorConsumer({
    consumerDirectory,
    run,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/forms/index.js'
            )
        )
    );
    const cjs = require('@miniextensions/sdk/forms');
    for (const { createFormSaveCoordinator } of [esm, cjs]) {
        let release;
        const pending = new Promise((resolve) => {
            release = resolve;
        });
        const coordinator = createFormSaveCoordinator({ isEqual: Object.is });
        const sessionKey = Symbol('host-session');
        let snapshot = null;
        const allocated = [];
        const invoke = () =>
            coordinator.run({
                sessionKey,
                readSnapshot: () => snapshot,
                allocate: () => {
                    allocated.push(snapshot);
                    return allocated.length === 1
                        ? pending
                        : Promise.resolve({ stored: false });
                },
            });
        const original = invoke();
        assert.deepEqual(allocated, [null], 'synchronous guarded allocation');
        assert.equal(
            await invoke(),
            undefined,
            'equal null completes before release'
        );
        snapshot = 'explicit changed intent';
        const changed = invoke();
        snapshot = 'latest host state';
        assert.equal(allocated.length, 1);
        release();
        await Promise.all([original, changed]);
        assert.deepEqual(allocated, [null, 'latest host state']);
        assert.equal(
            await coordinator.run({
                sessionKey,
                readSnapshot: () => snapshot,
                allocate: () => Promise.resolve(),
            }),
            undefined
        );
        // Fulfilled normalized failure and refused allocation have no Save-success meaning.
        const error = new Error('synthetic guarded allocation failure');
        await assert.rejects(
            coordinator.run({
                sessionKey,
                readSnapshot: () => snapshot,
                allocate: () => {
                    throw error;
                },
            }),
            (e) => e === error
        );
        await invoke();
        assert.equal(
            allocated.length,
            3,
            'fresh explicit correction, no automatic replay'
        );
    }
    for (const extension of ['mts', 'cts']) {
        const filename = `save-coordinator-types.${extension}`;
        writeFileSync(
            join(consumerDirectory, filename),
            formSaveCoordinatorTypedConsumer
        );
        run(process.execPath, [
            createRequire(import.meta.url).resolve('typescript/bin/tsc'),
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
            filename,
        ]);
    }
    // Fresh processes prove server imports without inherited DOM globals.
    for (const extension of ['mjs', 'cjs']) {
        const filename = `save-coordinator-ssr.${extension}`;
        const source =
            extension === 'mjs'
                ? "import { createFormSaveCoordinator } from '@miniextensions/sdk/forms';"
                : "const { createFormSaveCoordinator } = require('@miniextensions/sdk/forms');";
        writeFileSync(
            join(consumerDirectory, filename),
            source +
                `
if (typeof window !== 'undefined' || typeof document !== 'undefined') throw new Error('SSR proof requires no DOM');
const saves = createFormSaveCoordinator({isEqual: Object.is});
saves.run({sessionKey: Symbol(), readSnapshot: () => null, allocate: () => Promise.resolve()}).catch(error => {console.error(error); process.exitCode = 1;});
`
        );
        run(process.execPath, [filename]);
    }
    return 2;
}
