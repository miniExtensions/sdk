import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    evaluatePortalViewAvailability,
    type PortalViewAvailability,
} from '../src/portals/index.js';
import type {
    PortalLoadedResult,
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
} from '../src/runtime/index.js';
import { lookupPortalPage, portalPage } from './portalFixtures.js';

type PortalConfig = NonNullable<Parameters<typeof portalPage>[0]>;
const evaluate = (
    portal: PortalLoadedResult,
    portalFieldId = 'fld_children'
): PortalViewAvailability =>
    evaluatePortalViewAvailability({
        portal,
        portalFieldId,
    });

const driver: RuntimeAirtableField = {
    id: 'fld_eligible',
    name: 'Synthetic eligibility',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'checkbox',
        options: { color: 'greenBright', icon: 'check' },
    },
};
const condition = (fieldId = driver.id): RuntimeConditionsDefinition => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic_view_condition',
            type: 'singleCondition',
            setting: {
                type: 'is',
                fieldType: 'checkbox',
                idOrName: { type: 'id', id: fieldId },
                value: true,
            },
        },
    ],
});
const withUser = (config: PortalConfig, eligible: boolean) => {
    const portal = portalPage(config);
    portal.payload.usersTableFields = [structuredClone(driver)];
    portal.payload.formRecord.data[driver.id] = eligible;
    return portal;
};
const configOf = (portal: PortalLoadedResult): PortalConfig => {
    const schema = portal.payload.fieldIdsToSchemas.fld_children;
    if (schema.fieldType !== 'multipleRecordLinks')
        throw new Error('Expected canonical direct-link fixture.');
    assert.ok(schema.miniExtConfig);
    return schema.miniExtConfig;
};
const unavailable = {
    views: [],
    legacy: false,
    unavailable: true,
};
const freeze = (value: unknown): void => {
    if (value !== null && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
};

describe('public Portal view availability', () => {
    it('selects the exact eligible neighbor when the first configured view is hidden', () => {
        const hidden = {
            id: 'synthetic-hidden-view',
            config: {
                name: 'Hidden synthetic view',
                customViewConditions: condition(),
            },
        };
        const visible = {
            id: ' exact-visible-view ',
            config: { name: 'Visible synthetic view' },
        };
        const portal = withUser({ customViews: [hidden, visible] }, false);

        assert.deepEqual(evaluate(portal), {
            views: [visible],
            legacy: false,
            unavailable: false,
        });

        portal.payload.formRecord.data[driver.id] = true;
        assert.deepEqual(evaluate(portal), {
            views: [hidden, visible],
            legacy: false,
            unavailable: false,
        });
    });

    it('distinguishes eligible legacy lists from configured or owning-field hidden views', () => {
        const absent = portalPage();
        const schema = absent.payload.fieldIdsToSchemas.fld_children;
        assert.equal(schema.fieldType, 'multipleRecordLinks');
        assert.ok(schema.miniExtConfig);
        Reflect.deleteProperty(schema.miniExtConfig, 'customViews');

        for (const portal of [absent, portalPage({ customViews: [] })]) {
            assert.deepEqual(evaluate(portal), {
                views: [],
                legacy: true,
                unavailable: false,
            });
        }

        const configuredHidden = withUser(
            {
                customViews: [
                    {
                        id: 'synthetic-hidden-view',
                        config: { customViewConditions: condition() },
                    },
                ],
            },
            false
        );
        const fieldHidden = withUser(
            { conditionalFields: condition(), customViews: [] },
            false
        );
        for (const portal of [configuredHidden, fieldHidden]) {
            assert.deepEqual(evaluate(portal), {
                views: [],
                legacy: false,
                unavailable: false,
            });
        }
    });

    it('requires both the owning-field condition and the view condition', () => {
        const second = { ...structuredClone(driver), id: 'fld_second' };
        const view = {
            id: 'view_both',
            config: { customViewConditions: condition(second.id) },
        };
        const portal = withUser(
            { conditionalFields: condition(), customViews: [view] },
            true
        );
        portal.payload.usersTableFields.push(second);
        for (const [fieldVisible, viewVisible] of [
            [false, false],
            [false, true],
            [true, false],
            [true, true],
        ] as const) {
            portal.payload.formRecord.data[driver.id] = fieldVisible;
            portal.payload.formRecord.data[second.id] = viewVisible;
            assert.deepEqual(evaluate(portal), {
                views: fieldVisible && viewVisible ? [view] : [],
                legacy: false,
                unavailable: false,
            });
        }
    });

    it('counts duplicate identities before visibility in either order and preserves a neighbor', () => {
        const hidden = {
            id: 'view_duplicate',
            config: {
                name: 'Private hidden duplicate',
                customViewConditions: condition(),
            },
        };
        const visible = {
            id: 'view_duplicate',
            config: { name: 'Visible duplicate' },
        };
        const neighbor = {
            id: 'view_neighbor',
            config: { name: 'Eligible neighbor' },
        };
        for (const twins of [
            [hidden, visible],
            [visible, hidden],
        ]) {
            const portal = withUser(
                { customViews: [...twins, neighbor] },
                false
            );
            assert.deepEqual(evaluate(portal), {
                views: [neighbor],
                legacy: false,
                unavailable: true,
            });
        }
    });

    it('refuses malformed defined lists instead of inventing legacy', () => {
        for (const list of [null, {}, 'view_example']) {
            const portal = portalPage();
            Reflect.set(configOf(portal), 'customViews', list);
            assert.deepEqual(evaluate(portal), unavailable);
        }
    });

    it('omits blank identities and malformed configs while preserving an eligible neighbor', () => {
        const neighbor = {
            id: 'view_neighbor',
            config: { name: 'Eligible neighbor' },
        };
        for (const invalid of [
            { id: '   ', config: { name: 'Blank identity' } },
            { id: 'view_bad_config', config: { name: 'Invalid config' } },
        ]) {
            const portal = portalPage({ customViews: [invalid, neighbor] });
            if (invalid.id === 'view_bad_config') {
                Reflect.set(configOf(portal).customViews![0]!, 'config', 'bad');
            }
            assert.deepEqual(evaluate(portal), {
                views: [neighbor],
                legacy: false,
                unavailable: true,
            });
        }
    });

    it('reports missing or computed condition drivers without dropping an unconditional neighbor', () => {
        const conditional = {
            id: 'view_conditional',
            config: { customViewConditions: condition() },
        };
        const neighbor = {
            id: 'view_neighbor',
            config: { name: 'Eligible neighbor' },
        };
        for (const mode of ['missing', 'computed', 'invalid-native']) {
            const portal = withUser(
                { customViews: [conditional, neighbor] },
                true
            );
            if (mode === 'missing') portal.payload.usersTableFields = [];
            if (mode === 'computed') {
                portal.payload.usersTableFields[0]!.isComputed = true;
            }
            if (mode === 'invalid-native') {
                portal.payload.formRecord.data[driver.id] = 'not a checkbox';
            }
            assert.deepEqual(evaluate(portal), {
                views: [neighbor],
                legacy: false,
                unavailable: true,
            });
        }
    });

    it('does not fall back to legacy when owning-field evaluation is unavailable', () => {
        const portal = withUser(
            { conditionalFields: condition(), customViews: [] },
            true
        );
        portal.payload.usersTableFields = [];
        assert.deepEqual(evaluate(portal), unavailable);
    });

    it('requires user metadata to be an array but accepts the canonical empty array', () => {
        const portal = portalPage();
        const expected = {
            views: [{ id: 'view_example', config: { name: 'Example view' } }],
            legacy: false,
            unavailable: false,
        };
        assert.deepEqual(portal.payload.usersTableFields, []);
        assert.deepEqual(evaluate(portal), expected);
        Reflect.deleteProperty(portal.payload, 'usersTableFields');
        assert.deepEqual(evaluate(portal), unavailable);
        Reflect.set(portal.payload, 'usersTableFields', {});
        assert.deepEqual(evaluate(portal), unavailable);
    });

    it('requires published membership and an own schema with matching outer identity and physical type', () => {
        const absent = portalPage();
        absent.payload.fieldIdsInPortal = [];
        assert.deepEqual(evaluate(absent), unavailable);

        const inherited = portalPage();
        inherited.payload.fieldIdsToSchemas = Object.create(
            inherited.payload.fieldIdsToSchemas
        );
        assert.deepEqual(evaluate(inherited), unavailable);

        const mismatchedId = portalPage();
        mismatchedId.payload.fieldIdsToSchemas.fld_children.airtableField.id =
            'fld_other';
        assert.deepEqual(evaluate(mismatchedId), unavailable);

        const mismatchedType = portalPage();
        Reflect.set(
            mismatchedType.payload.fieldIdsToSchemas.fld_children,
            'fieldType',
            'singleLineText'
        );
        assert.deepEqual(evaluate(mismatchedType), unavailable);
    });

    it('requires an accepted loaded Portal and an edit native user record', () => {
        const wrongScreen = portalPage();
        Reflect.set(wrongScreen, 'extensionScreen', 'form_loaded');
        assert.deepEqual(evaluate(wrongScreen), unavailable);

        const creating = portalPage();
        Reflect.set(creating.payload.formRecord, 'type', 'create');
        assert.deepEqual(evaluate(creating), unavailable);

        const malformedData = portalPage();
        Reflect.set(malformedData.payload.formRecord, 'data', null);
        assert.deepEqual(evaluate(malformedData), unavailable);
    });

    it('supports direct and valid computed lookup relationships using only the published outer ID', () => {
        const view = { id: 'view_lookup', config: { name: 'Lookup view' } };
        const direct = portalPage({ customViews: [view] });
        const lookup = lookupPortalPage({ customViews: [view] });
        assert.equal(
            lookup.payload.fieldIdsToSchemas.fld_children.airtableField
                .isComputed,
            true
        );
        for (const portal of [direct, lookup]) {
            assert.deepEqual(evaluate(portal), {
                views: [view],
                legacy: false,
                unavailable: false,
            });
        }
        assert.deepEqual(evaluate(lookup, 'fld_lookup_driver'), unavailable);
        assert.deepEqual(evaluate(lookup, 'fld_lookup_source'), unavailable);
    });

    it('refuses unsupported direct types and invalid lookup relationships', () => {
        const unsupported = portalPage();
        const schema = unsupported.payload.fieldIdsToSchemas.fld_children;
        Reflect.set(schema, 'fieldType', 'singleLineText');
        Reflect.set(schema.airtableField, 'config', {
            type: 'singleLineText',
            options: null,
        });
        assert.deepEqual(evaluate(unsupported), unavailable);

        const invalidLookup = lookupPortalPage();
        const lookupConfig =
            invalidLookup.payload.fieldIdsToSchemas.fld_children.airtableField
                .config;
        assert.equal(lookupConfig.type, 'multipleLookupValues');
        if (lookupConfig.type !== 'multipleLookupValues')
            throw new Error('Expected canonical lookup fixture.');
        assert.ok(lookupConfig.options);
        Reflect.set(lookupConfig.options, 'isValid', false);
        assert.deepEqual(evaluate(invalidLookup), unavailable);
    });

    it('normalizes omitted and null view configs without inventing names or IDs', () => {
        const portal = portalPage({
            customViews: [{ id: 'view_omitted' }, { id: 'view_null' }],
        });
        Reflect.set(configOf(portal).customViews![1]!, 'config', null);
        assert.deepEqual(evaluate(portal), {
            views: [
                { id: 'view_omitted', config: null },
                { id: 'view_null', config: null },
            ],
            legacy: false,
            unavailable: false,
        });
    });

    it('detaches nested opaque config and own undefined keys without mutating accepted input', () => {
        const portal = portalPage({
            customViews: [
                { id: 'view_snapshot', config: { name: 'Snapshot view' } },
            ],
        });
        const original = configOf(portal).customViews![0]!.config;
        assert.ok(original);
        Object.assign(original, {
            opaque: { nested: { labels: ['source'] } },
            opaqueUndefined: undefined,
        });
        const before = structuredClone(portal);
        freeze(portal);

        const first = evaluate(portal);
        const second = evaluate(portal);
        const left = first.views[0]!.config;
        const right = second.views[0]!.config;
        assert.ok(left);
        assert.ok(right);
        assert.notEqual(first, second);
        assert.notEqual(first.views, second.views);
        assert.notEqual(left, original);
        assert.notEqual(left, right);
        assert.equal(Object.hasOwn(left, 'opaqueUndefined'), true);
        assert.equal(Reflect.get(left, 'opaqueUndefined'), undefined);
        assert.deepEqual(Object.keys(left), Object.keys(original));

        type Opaque = { nested: { labels: string[] } };
        const originalOpaque = Reflect.get(original, 'opaque') as Opaque;
        const leftOpaque = Reflect.get(left, 'opaque') as Opaque;
        const rightOpaque = Reflect.get(right, 'opaque') as Opaque;
        assert.notEqual(leftOpaque, originalOpaque);
        assert.notEqual(leftOpaque.nested, originalOpaque.nested);
        assert.notEqual(leftOpaque.nested.labels, originalOpaque.nested.labels);
        assert.notEqual(leftOpaque.nested.labels, rightOpaque.nested.labels);
        Reflect.set(leftOpaque.nested.labels, '0', 'changed result');
        Reflect.set(left, 'opaqueUndefined', 'changed result');
        assert.deepEqual(rightOpaque.nested.labels, ['source']);
        assert.deepEqual(portal, before);
        assert.equal(Object.hasOwn(original, 'opaqueUndefined'), true);
        assert.equal(Reflect.get(original, 'opaqueUndefined'), undefined);
    });

    it('isolates an uncloneable config while preserving eligible neighbors in order', () => {
        const before = { id: 'view_before', config: { name: 'Before' } };
        const rejected = {
            id: 'uncloneable_identity_marker',
            config: { name: 'Uncloneable synthetic config' },
        };
        const after = { id: 'view_after', config: { name: 'After' } };
        const portal = portalPage({ customViews: [before, rejected, after] });
        const original = configOf(portal).customViews![1]!.config;
        assert.ok(original);
        const opaqueUncloneable = () => 'synthetic';
        Object.assign(original, { opaqueUncloneable });
        freeze(portal);

        const result = evaluate(portal);
        assert.deepEqual(result, {
            views: [before, after],
            legacy: false,
            unavailable: true,
        });
        assert.doesNotMatch(
            JSON.stringify(result),
            /uncloneable_identity_marker/
        );
        assert.equal(configOf(portal).customViews![1]!.config, original);
        assert.equal(
            Reflect.get(original, 'opaqueUncloneable'),
            opaqueUncloneable
        );
        assert.deepEqual(Object.keys(original), ['name', 'opaqueUncloneable']);
    });

    it('returns only generic availability rather than refused descriptors or native credentials', () => {
        const portal = withUser(
            {
                customViews: [
                    {
                        id: 'refused_identity_marker',
                        config: {
                            name: 'refused_name_marker',
                            customViewConditions: condition(),
                        },
                    },
                    {
                        id: 'view_visible',
                        config: { name: 'Visible view' },
                    },
                ],
            },
            false
        );
        portal.payload.extensionAccessToken = 'synthetic_token_marker';
        portal.payload.formRecord.data.fld_private = 'native_record_marker';
        const result = evaluate(portal);
        assert.deepEqual(Object.keys(result).sort(), [
            'legacy',
            'unavailable',
            'views',
        ]);
        assert.deepEqual(result, {
            views: [{ id: 'view_visible', config: { name: 'Visible view' } }],
            legacy: false,
            unavailable: false,
        });
        assert.doesNotMatch(
            JSON.stringify(result),
            /refused_identity_marker|refused_name_marker|synthetic_token_marker|native_record_marker/
        );
    });

    it('evaluates synchronously without making a network request', (test) => {
        const request = test.mock.method(globalThis, 'fetch', async () => {
            throw new Error('Unexpected availability network request.');
        });
        assert.deepEqual(evaluate(portalPage()), {
            views: [{ id: 'view_example', config: { name: 'Example view' } }],
            legacy: false,
            unavailable: false,
        });
        assert.equal(request.mock.callCount(), 0);
    });
});
