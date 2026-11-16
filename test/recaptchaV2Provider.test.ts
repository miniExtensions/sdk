import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFormCaptchaProviderRegistry } from '../src/ui/formCaptcha.js';
import {
    createRecaptchaV2Provider,
    type RecaptchaV2Api,
} from '../src/ui/recaptchaV2Provider.js';

test('the SDK adapter maps the exact v2 callbacks and owns only each widget ID, including zero', async () => {
    const registry = createFormCaptchaProviderRegistry();
    let loads = 0;
    const resets: number[] = [];
    const renders: Parameters<RecaptchaV2Api<object>['render']>[] = [];
    const api: RecaptchaV2Api<object> = {
        render(...args) {
            renders.push(args);
            return renders.length - 1;
        },
        reset(id) {
            resets.push(id);
            renders[id][1].callback(null);
        },
    };
    const provider = createRecaptchaV2Provider<object>({
        registry,
        scope: {},
        configuration: {},
        load() {
            loads++;
            return api;
        },
    });
    const renderer = await provider.load();
    assert.equal(renderer, await provider.load());
    assert.equal(loads, 1);
    let removes = 0;
    const container = {
        replaceChildren() {
            removes++;
        },
    } as unknown as HTMLElement;
    const changes: (object | null)[] = [];
    let expired = 0;
    const errors: unknown[] = [];
    const callbacks = {
        change(value: object | null) {
            changes.push(value);
        },
        expired() {
            expired++;
        },
        error(cause?: unknown) {
            errors.push(cause);
        },
    };
    const one = await renderer.render(
        container,
        {
            sitekey: 'synthetic-config',
            theme: 'dark',
            size: 'compact',
            tabindex: 2,
            hl: 'es',
        },
        callbacks
    );
    const two = await renderer.render(
        container,
        { sitekey: 'synthetic-other' },
        callbacks
    );
    assert.equal(renders[0][0], container);
    assert.equal(renders[0][1].hl, 'es');
    assert.equal(renders[0][1].theme, 'dark');
    const value = {};
    const error = {};
    renders[0][1].callback(value);
    renders[0][1]['expired-callback']();
    renders[0][1]['error-callback'](error);
    assert.deepEqual(changes, [value]);
    assert.equal(expired, 1);
    assert.deepEqual(errors, [error]);
    one.reset();
    assert.deepEqual(resets, [0]);
    assert.equal(changes.at(-1), null);
    one.remove();
    one.remove();
    one.reset();
    renders[0][1].callback({});
    renders[0][1]['expired-callback']();
    renders[0][1]['error-callback']();
    assert.deepEqual(resets, [0, 0]);
    assert.equal(removes, 1);
    assert.equal(changes.length, 2);
    assert.equal(expired, 1);
    assert.equal(errors.length, 1);
    two.reset();
    assert.deepEqual(resets, [0, 0, 1]);
    two.remove();
});

test('failed render detaches only its mount and irreversibly fences captured provider callbacks', async () => {
    let held!: Parameters<RecaptchaV2Api<object>['render']>[1];
    let clears = 0;
    let publications = 0;
    const provider = createRecaptchaV2Provider<object>({
        registry: createFormCaptchaProviderRegistry(),
        scope: {},
        configuration: {},
        load: () => ({
            render(_node, options) {
                held = options;
                throw Error('synthetic provider render');
            },
            reset() {
                throw Error('no allocated widget ID');
            },
        }),
    });
    const renderer = await provider.load();
    assert.throws(
        () =>
            renderer.render(
                {
                    replaceChildren() {
                        clears++;
                    },
                } as unknown as HTMLElement,
                { sitekey: 'synthetic-config' },
                {
                    change() {
                        publications++;
                    },
                    expired() {
                        publications++;
                    },
                    error() {
                        publications++;
                    },
                }
            ),
        /synthetic provider render/
    );
    held.callback({});
    held['expired-callback']();
    held['error-callback']();
    assert.equal(publications, 0);
    assert.equal(clears, 1);
});
