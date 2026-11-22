import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPostgresContractDeclarationInventory as inventory } from './postgres-runtime-artifact-registry.mjs';

const aliases = ['PostgresValue', 'PostgresNativeDraft'];
const declarations = Buffer.from(`
export type CanonicalPostgresValue = string | null;
type Internal = { type: 'form' | 'portal' };
export type CanonicalPostgresNativeDraft = Internal;
`);

test('native declaration inventory follows actual exports independently of manifest order', () => {
    inventory({ aliases }, declarations);
    inventory({ aliases }, Buffer.from(declarations + '\nexport {};'));
    inventory({ aliases: [...aliases].reverse() }, declarations);
});

test('native declaration inventory rejects manifest edits and actual export drift', () => {
    for (const edited of [
        [],
        ['PostgresValue'],
        [...aliases, 'PostgresFormDraft'],
        [...aliases, 'PostgresValue'],
        ['PostgresValue', 'not-a-native-alias'],
    ])
        assert.throws(
            () => inventory({ aliases: edited }, declarations),
            /inventory/
        );
    for (const changed of [
        declarations
            .toString()
            .replace(
                'export type CanonicalPostgresNativeDraft = Internal;',
                ''
            ),
        declarations + '\nexport type CanonicalPostgresNativeDraft = unknown;',
        declarations + '\nexport type CanonicalPostgresFormDraft = unknown;',
        declarations + '\nexport type Unrecorded = unknown;',
        declarations + '\nexport interface Unexpected {}',
        declarations + '\nexport { Internal };',
        declarations + '\nexport as namespace Unexpected;',
        declarations + '\ndeclare global { interface UnexpectedGlobal {} }',
        declarations + '\nexport type Broken = ;',
    ])
        assert.throws(
            () => inventory({ aliases }, Buffer.from(changed)),
            /inventory/
        );
});
