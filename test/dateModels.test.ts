import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createDateFieldModel,
    isDateFieldNativeValue,
} from '../src/ui/dateModel.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import {
    createMiniExtensionsClient,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';
const config = (
    kind: 'date' | 'dateTime',
    zone = 'UTC'
): RuntimeAirtableField['config'] =>
    ({
        type: kind,
        options: {
            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
            ...(kind === 'dateTime'
                ? {
                      timeFormat: { name: '24hour', format: 'HH:mm' },
                      timeZone: zone,
                  }
                : {}),
        },
    }) as RuntimeAirtableField['config'];
const setup = (kind: 'date' | 'dateTime', initial: unknown, zone = 'UTC') => {
    let native = initial,
        current = true,
        canEdit = true,
        client = 'America/Los_Angeles',
        metadata = config(kind, zone),
        writes = 0;
    const model = createDateFieldModel({
        kind,
        getValue: () => native,
        getConfig: () => metadata,
        getClientTimeZone: () => client,
        isCurrent: () => current,
        canEdit: () => canEdit,
        write: (value) => {
            native = value;
            writes++;
            return true;
        },
    });
    return {
        model,
        value: () => native,
        writes: () => writes,
        retire: () => {
            current = false;
        },
        readonly: () => {
            canEdit = false;
        },
        zone: (zone: string) => {
            client = zone;
        },
        config: (value: RuntimeAirtableField['config']) => {
            metadata = value;
        },
    };
};
for (const kind of ['date', 'dateTime'] as const) {
    it(`${kind} keeps canonical empty and invalid loaded native values without writes`, () => {
        for (const native of [null, undefined, '', ' \t ', 42, [], 'partial']) {
            const f = setup(kind, native);
            f.model.getState();
            assert.equal(f.value(), native);
            assert.equal(f.writes(), 0);
            f.model.destroy();
        }
    });
    it(`${kind} retains partial text outside native value, explicit clear and old actions retire`, () => {
        const initial =
            kind === 'date' ? '2024-02-29' : '2024-02-29T12:30:00+05:45';
        const f = setup(kind, initial);
        assert.equal(f.model.setInput('2024-'), false);
        assert.equal(f.model.getState().input, '2024-');
        assert.equal(f.value(), initial);
        assert.equal(f.writes(), 0);
        assert.equal(f.model.setInput(initial), true);
        assert.equal(f.value(), initial);
        assert.equal(f.model.clear(), true);
        assert.equal(f.value(), null);
        f.retire();
        assert.equal(f.model.setInput(initial), false);
        assert.equal(f.model.getState().input, '');
    });
    it(`${kind} preserves read-only native bytes and declines edits`, () => {
        const f = setup(
            kind,
            kind === 'date' ? '2011-12-30' : '2024-01-01T12:00:00.120Z'
        );
        f.readonly();
        assert.equal(f.model.clear(), false);
        assert.equal(f.writes(), 0);
        assert.equal(f.model.getState().canEdit, false);
    });
}
it('calendar admission is independent of DST/UTC offset, rejects normalized and malformed dates', () => {
    for (const value of ['2011-12-30', '2024-02-29', '2000-02-29'])
        assert.equal(isDateFieldNativeValue('date', value), true);
    for (const value of [
        '2023-02-29',
        '1900-02-29',
        '2024-02-30',
        '2024-2-01',
        '2024-01-01T00:00:00Z',
        [],
        '',
    ])
        assert.equal(isDateFieldNativeValue('date', value), false);
});
it('dateTime strict grammar admits only explicit instants and preserves fractional/offset bytes', () => {
    for (const value of [
        '2024-03-10T02:30:00-08:00',
        '2024-11-03T01:30:00-07:00',
        '2024-11-03T01:30:00-08:00',
        '2024-01-01T12:30:00.120+05:45',
    ]) {
        const f = setup('dateTime', null);
        assert.equal(f.model.setInput(value), true);
        assert.equal(f.value(), value);
    }
    for (const value of [
        '2024-01-01T12:00:00',
        '2024-01-01 12:00:00Z',
        '2024-001T12:00:00Z',
        '2024-W01-1T12:00:00Z',
        '2024-01-01T24:00:00Z',
        '2024-01-01T12:00:00-00:00',
        '2024-01-01T12:00:60Z',
        '2024-01-01T12:00:00.1234Z',
    ])
        assert.equal(isDateFieldNativeValue('dateTime', value), false);
});
it('configured versus explicit client zone affects display only; zone change retires only dependent client editor', () => {
    const native = '2024-07-01T12:00:00Z';
    const fixed = setup('dateTime', native, 'Asia/Kathmandu');
    assert.equal(fixed.model.getState().display, '2024-07-01 17:45');
    fixed.zone('Pacific/Apia');
    assert.equal(fixed.model.getState().retired, false);
    const client = setup('dateTime', native, 'client');
    assert.equal(client.model.getState().display, '2024-07-01 05:00');
    client.zone('Asia/Kathmandu');
    assert.equal(client.model.getState().retired, true);
    assert.equal(client.model.clear(), false);
    assert.equal(client.value(), native);
    const date = setup('date', '2011-12-30');
    date.zone('Pacific/Apia');
    assert.equal(date.model.getState().display, '2011-12-30');
    assert.equal(date.model.getState().retired, false);
});
it('unsupported pinned zones and mismatched format pairs fail closed without substituting guessed zones', () => {
    const unsupported = setup(
        'dateTime',
        '2024-07-01T12:00:00Z',
        'America/Coyhaique'
    );
    assert.equal(unsupported.model.getState().canEdit, false);
    assert.equal(unsupported.model.setInput('2024-07-01T12:00:00Z'), false);
    assert.equal(unsupported.writes(), 0);
    const changed = setup('date', '2024-01-01');
    changed.model.getState();
    changed.config({
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'LL' } },
    } as unknown as RuntimeAirtableField['config']);
    assert.equal(changed.model.getState().retired, true);
});
it('Form binding shares native/partial state across remount, rejects invalid Save and preserves complete envelope/dirty IDs', async () => {
    const page = loadedForm();
    page.payload.fieldIdsInForm = ['fld_date', 'fld_time'];
    for (const [id, kind] of [
        ['fld_date', 'date'],
        ['fld_time', 'dateTime'],
    ] as const)
        page.payload.fieldIdsToSchemas[id] = {
            fieldType: kind,
            airtableField: {
                id,
                name: id,
                isComputed: false,
                isPrimaryField: false,
                description: null,
                config: config(kind),
            },
        } as RuntimeFieldSchema;
    page.payload.formRecord.data.fld_date = '2011-12-30';
    page.payload.formRecord.data.fld_time = '2024-01-01T00:00:00.120+05:45';
    const expected = structuredClone(page.payload.formRecord);
    let calls = 0,
        saved: SaveFormInput | null = null;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('No automatic request');
        },
    });
    client.forms.save = async (input) => {
        calls++;
        saved = input;
        return invalidForm();
    };
    const owner = createFormFieldBindings({
        client,
        loaded: page,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    const binding = owner.field('fld_date');
    assert.equal(
        binding.getSnapshot().canEdit,
        true,
        JSON.stringify(binding.getSnapshot())
    );
    assert.equal(binding.date!.setInput('2024-'), false);
    assert.equal(owner.field('fld_date'), binding);
    assert.equal(binding.getSnapshot().date!.input, '2024-');
    await assert.rejects(owner.save());
    assert.equal(calls, 0);
    assert.equal(binding.setValue('2024-02-30').accepted, false);
    assert.equal(binding.date!.setInput('2011-12-30'), true);
    await owner.save();
    assert.equal(calls, 1);
    assert.deepEqual(saved!.formRecord, expected);
    assert.deepEqual(
        new Set(saved!.formFieldIdsWithUnsavedChanges),
        new Set([
            ...page.payload.formFieldIdsWithUnsavedChanges,
            ...(page.payload.urlPrefilledFieldIds ?? []),
            'fld_date',
        ])
    );
    owner.destroy();
    assert.equal(binding.date!.clear(), false);
});
