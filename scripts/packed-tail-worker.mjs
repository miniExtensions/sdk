import assert from 'node:assert/strict';
import { stop } from 'esbuild';

const suites = {
    attachment: [
        './attachment-review-recipe-checks.mjs',
        'checkAttachmentReviewRecipe',
    ],
    review: [
        './browser-review-example-checks.mjs',
        'checkBrowserReviewExample',
    ],
};
let result;
let suite;
let started = false;
const observe = (phase) =>
    new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            process.off('message', acknowledged);
            process.off('disconnect', disconnected);
            if (error) reject(error);
            else resolve();
        };
        const acknowledged = (message) => {
            try {
                assert.deepEqual(message, {
                    schemaVersion: 1,
                    suite,
                    phase,
                    accepted: true,
                });
                finish();
            } catch (error) {
                finish(error);
            }
        };
        const disconnected = () =>
            finish(
                new Error('Parent disconnected before cohort acknowledgement')
            );
        const timer = setTimeout(
            () => finish(new Error('Worker cohort acknowledgement timed out')),
            10000
        );
        process.on('message', acknowledged);
        process.once('disconnect', disconnected);
        try {
            process.send({ schemaVersion: 1, suite, phase }, (error) => {
                if (error) finish(error);
            });
        } catch (error) {
            finish(error);
        }
    });
try {
    const args = process.argv.slice(2);
    assert.equal(args.length, 3);
    [suite] = args;
    assert(Object.hasOwn(suites, suite), 'Unknown packed-tail suite');
    assert.equal(
        typeof process.send,
        'function',
        'Parent IPC channel required'
    );
    await observe('start');
    started = true;
    const [path, name] = suites[suite];
    const helper = await import(new URL(path, import.meta.url).href);
    result = await helper[name]({
        consumerDirectory: args[1],
        happyDomModulePath: args[2],
    });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    // Each worker owns its service. No parent build can be stopped here.
    try {
        await stop();
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
try {
    if (started && process.connected) await observe('finish');
    if (!process.exitCode)
        await new Promise((resolve, reject) => {
            process.send({ schemaVersion: 1, suite, result }, (error) =>
                error ? reject(error) : resolve()
            );
        });
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    if (process.connected) process.disconnect();
}
