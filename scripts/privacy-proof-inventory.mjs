import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// One declared route inventory for the generated proof kit and its guards.
export const privacyScenarioInventory = Object.freeze([
    'pin',
    'password',
    'word',
    'email',
    'phone',
    'portal',
    'choice-single',
    'choice-multiple',
    'choice-add-single',
    'choice-add-multiple',
    'projection-single',
    'projection-multiple',
    'linked-filters',
    'linked-filter-deferred',
    'visibility-draft',
    'visibility-unavailable',
    'visibility-section',
    'address-acceptance',
    'address-failure',
    'address-lifecycle',
    'address-remount',
    'address-ime',
    'teardown-logout',
    'teardown-disconnect',
    'review-answers',
    'review-address',
    'review-validation',
    'review-unknown',
    'hide-empty-edit',
    'hide-empty-create',
    'hide-empty-unavailable',
    'hide-empty-review',
    'hide-empty-review-malformed',
]);

export const privacyAuthScenarioInventory = Object.freeze([
    'pin',
    'password',
    'word',
    'email',
    'phone',
]);

const sorted = (values) => [...values].sort();
const assertRoutes = (actual, expected, label) => {
    assert.equal(
        new Set(actual).size,
        actual.length,
        `${label}: duplicate routes`
    );
    assert.deepEqual(
        sorted(actual),
        sorted(expected),
        `${label}: supported scenario inventory differs`
    );
};

/** Inspect generated declarations and factory construction, never transport or browser execution. */
export async function assertPrivacyProofInventory(outputDirectory) {
    const directory = resolve(outputDirectory);
    const [manifestText, menu, readme] = await Promise.all([
        readFile(join(directory, 'manifest.json'), 'utf8'),
        readFile(join(directory, 'index.html'), 'utf8'),
        readFile(join(directory, 'README.md'), 'utf8'),
    ]);
    const { createPrivacyFixture } = await import(
        pathToFileURL(join(directory, 'fixture.js')).href
    );
    for (const scenario of privacyScenarioInventory) {
        let fixture;
        try {
            fixture = createPrivacyFixture(scenario);
        } catch (cause) {
            throw new Error(`${scenario}: unsupported generated route`, {
                cause,
            });
        }
        assert.equal(
            typeof fixture.fetch,
            'function',
            `${scenario}: missing synthetic transport`
        );
        assert.equal(
            typeof fixture.state.scenario,
            'string',
            `${scenario}: missing generated route identity`
        );
        assert.equal(
            fixture.state.scenario,
            scenario,
            `${scenario}: unsupported generated route`
        );
        assert.equal(
            Array.isArray(fixture.state.calls),
            true,
            `${scenario}: missing transport trace`
        );
        assert.equal(
            Array.isArray(fixture.state.unexpected),
            true,
            `${scenario}: missing failure trace`
        );
        assert.equal(
            fixture.state.calls.length,
            0,
            `${scenario}: constructing a scenario dispatched transport`
        );
        assert.equal(
            fixture.state.unexpected.length,
            0,
            `${scenario}: constructing a scenario failed`
        );
    }
    const manifest = JSON.parse(manifestText);
    assertRoutes(
        manifest.scenarios,
        privacyScenarioInventory,
        'Generated manifest'
    );
    const menuLinks = [
        ...menu.matchAll(
            /href="(starter|auth)\/index\.html\?scenario=([^"]+)"/g
        ),
    ];
    const readmeLinks = [
        ...readme.matchAll(
            /\[[^\]]+\]\((starter|auth)\/index\.html\?scenario=([^)]+)\)/g
        ),
    ];
    for (const [surface, links] of [
        ['Generated menu', menuLinks],
        ['Generated README', readmeLinks],
    ]) {
        assertRoutes(
            links
                .filter((entry) => entry[1] === 'starter')
                .map((entry) => entry[2]),
            privacyScenarioInventory,
            `${surface} starter`
        );
        assertRoutes(
            links
                .filter((entry) => entry[1] === 'auth')
                .map((entry) => entry[2]),
            privacyAuthScenarioInventory,
            `${surface} AuthPanel`
        );
    }
    return {
        scenarios: privacyScenarioInventory.length,
        authScenarios: privacyAuthScenarioInventory.length,
    };
}
