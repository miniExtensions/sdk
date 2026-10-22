import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    findAdjacentChildSession,
    type AdjacentChildNavigationContext,
} from '../src/ui/index.js';
type Child = Exclude<AdjacentChildNavigationContext, { type: 'direct-url' }>;
const child = (recordId: string): Child => ({
    type: 'modal',
    recordId,
    parentFormExtensionSessionId: 'parent',
    fieldIdOfLinkedRecordField: 'links',
    linkedTableIdOfLinkedRecordField: 'table',
    parentExtensionAccessToken: 'token',
    childExtensionAccessInfo: { childExtensionId: 'child' },
    prefillDataForLinkedRecordsForm: null,
    nextRecordId: 'next',
    previousRecordId: 'previous',
});
for (const direction of ['next', 'previous'] as const) {
    it(`resolves only the actual declared ${direction} sibling and never reads native payloads or mutates contexts`, () => {
        const origin = Object.freeze(child('current'));
        const target = Object.freeze({
            ...child(direction),
            get privateNativeValue() {
                throw new Error('PRIVATE_NATIVE');
            },
        });
        const contexts = Object.freeze({
            origin,
            target,
            direct: Object.freeze({ type: 'direct-url' as const }),
        });
        assert.equal(
            findAdjacentChildSession(contexts, {
                sourceExtensionSessionId: 'origin',
                type: direction,
                recordId: direction,
            }),
            'target'
        );
        assert.equal(
            findAdjacentChildSession(contexts, {
                sourceExtensionSessionId: 'origin',
                type: direction,
                recordId: 'other',
            }),
            null
        );
        assert.equal(target.recordId, direction);
    });
    for (const mode of [
        'parent',
        'field',
        'table',
        'child',
        'token',
        'surface',
        'link-parent',
        'reverse-field',
    ] as const) {
        it(`does not select a foreign ${mode} context with the same ${direction} record ID`, () => {
            let origin = child('current'),
                owned = child(direction);
            let foreign: Child = { ...owned };
            if (mode === 'parent')
                foreign = { ...foreign, parentFormExtensionSessionId: 'other' };
            if (mode === 'field')
                foreign = { ...foreign, fieldIdOfLinkedRecordField: 'other' };
            if (mode === 'table')
                foreign = {
                    ...foreign,
                    linkedTableIdOfLinkedRecordField: 'other',
                };
            if (mode === 'child')
                foreign = {
                    ...foreign,
                    childExtensionAccessInfo: { childExtensionId: 'other' },
                };
            if (mode === 'token')
                foreign = { ...foreign, parentExtensionAccessToken: 'other' };
            if (mode === 'surface')
                foreign = { ...foreign, type: 'side-panel' };
            if (mode === 'link-parent' || mode === 'reverse-field') {
                const link = {
                    parentFormRecordId: 'parent-record',
                    reversedFieldIdToPrefill: 'reverse',
                };
                origin = {
                    ...origin,
                    prefillDataForLinkedRecordsForm: { toLinkToParent: link },
                };
                owned = {
                    ...owned,
                    prefillDataForLinkedRecordsForm: { toLinkToParent: link },
                };
                foreign = {
                    ...foreign,
                    prefillDataForLinkedRecordsForm: {
                        toLinkToParent: {
                            ...link,
                            ...(mode === 'link-parent'
                                ? { parentFormRecordId: 'other' }
                                : { reversedFieldIdToPrefill: 'other' }),
                        },
                    },
                };
            }
            const input = {
                sourceExtensionSessionId: 'origin',
                type: direction,
                recordId: direction,
            };
            assert.equal(
                findAdjacentChildSession({ origin, owned, foreign }, input),
                'owned'
            );
            assert.equal(
                findAdjacentChildSession({ origin, foreign }, input),
                null
            );
        });
    }
}
it('accepts each matching native surface and rejects missing/direct/ambiguous origins and targets', () => {
    for (const type of ['modal', 'side-panel', 'form-layout'] as const) {
        const origin = { ...child('current'), type },
            target = { ...child('next'), type },
            input = {
                sourceExtensionSessionId: 'origin',
                type: 'next' as const,
                recordId: 'next',
            };
        assert.equal(
            findAdjacentChildSession({ origin, target }, input),
            'target'
        );
        assert.equal(findAdjacentChildSession({ target }, input), null);
        assert.equal(
            findAdjacentChildSession(
                { origin: { type: 'direct-url' }, target },
                input
            ),
            null
        );
        assert.equal(
            findAdjacentChildSession(
                { origin, target, duplicate: target },
                input
            ),
            null
        );
        assert.equal(findAdjacentChildSession({ origin }, input), null);
    }
});
it('preserves nullable profile/create context identities without rewriting access or inline-field metadata', () => {
    const origin = {
        ...child('current'),
        recordId: null,
        fieldIdOfLinkedRecordField: null,
    };
    const target = {
        ...child('next'),
        fieldIdOfLinkedRecordField: null,
        childExtensionAccessInfo: {
            childExtensionId: 'child',
            accessType: { type: 'create' },
        },
        nativeInlineField: null,
    };
    const before = JSON.stringify(target);
    assert.equal(
        findAdjacentChildSession(
            { origin, target },
            {
                sourceExtensionSessionId: 'origin',
                type: 'next',
                recordId: 'next',
            }
        ),
        'target'
    );
    assert.equal(JSON.stringify(target), before);
});

it('fails closed for malformed runtime input without throwing or coercing identity', () => {
    const origin = child('current'),
        target = child('next'),
        input = {
            sourceExtensionSessionId: 'origin',
            type: 'next',
            recordId: 'next',
        };
    for (const contexts of [
        null,
        [],
        { origin: { ...origin, parentExtensionAccessToken: '' }, target },
        { origin: { ...origin, fieldIdOfLinkedRecordField: 17 }, target },
        { origin: { ...origin, prefillDataForLinkedRecordsForm: [] }, target },
        Object.create({ origin, target }),
    ])
        assert.equal(
            Reflect.apply(findAdjacentChildSession, undefined, [
                contexts,
                input,
            ]),
            null
        );
    for (const patch of [
        { type: 'later' },
        { sourceExtensionSessionId: '' },
        { recordId: 17 },
    ])
        assert.equal(
            Reflect.apply(findAdjacentChildSession, undefined, [
                { origin, target },
                { ...input, ...patch },
            ]),
            null
        );
    assert.equal(
        findAdjacentChildSession(
            {
                origin,
                get target(): AdjacentChildNavigationContext {
                    throw new Error('PRIVATE_OWNER');
                },
            },
            { ...input, type: 'next' }
        ),
        null
    );
});
