import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormLinkedFilterModel } from '../src/forms/index.js';
import type {
    RuntimeFieldSchema,
    RuntimeTableStates,
    RuntimeQuery,
    ListConditionalFilterPrimaryValuesResult,
} from '../src/runtime/index.js';
type Schema = Extract<RuntimeFieldSchema, { fieldType: 'multipleRecordLinks' }>;
const definitions = ['country', 'region', 'city'];
const field = (id: string) => ({
    id,
    name: `Current ${id}`,
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'multipleRecordLinks' as const,
        options: {
            linkedTableId: 'tbl_places',
            inverseLinkFieldId: 'fld_parent',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
});
const schema = (): Schema => ({
    fieldType: 'multipleRecordLinks',
    airtableField: field('outer'),
    miniExtConfig: {
        conditionalLinkedRecordFilteringFieldsType: 'hide',
        conditionalLinkedRecordFilterFields: definitions.map((id) => ({
            idOrName: { type: 'id', id },
            config: { type: 'multipleRecordLinks', config: { title: id } },
        })),
    },
});
const metadata = (): RuntimeTableStates => ({
    tbl_places: {
        airtableFields: definitions.map(field),
        recordIdsToAirtableRecords: {},
    },
});
const choices = [
    { recordId: 'one', stringValue: 'Duplicate' },
    { recordId: 'two', stringValue: 'Duplicate' },
];
const result = (prefill = false): ListConditionalFilterPrimaryValuesResult => ({
    primaryValues: structuredClone(choices),
    prefillValue: prefill ? structuredClone(choices[1]!) : null,
});
const fixture = (query: RuntimeQuery = {}) => {
    const model = createFormLinkedFilterModel({ schema: schema(), query });
    assert.equal(model.initialize(metadata()).status, 'ready');
    return model;
};
const plan = (
    model: ReturnType<typeof fixture>,
    id = 'country',
    usePrefill = false
) => {
    const request = model.prepareRead(id, { usePrefill });
    assert.equal(request.status, 'ready');
    if (request.status !== 'ready') throw new Error('Fixture plan');
    return request;
};
const select = (
    model: ReturnType<typeof fixture>,
    id = 'country',
    record = 'two'
) => {
    const request = plan(model, id);
    assert.equal(model.accept(request.ticket, result()).status, 'accepted');
    assert.equal(model.choose(id, record), true);
};
describe('one pure Form cascade with canonical pairs and owned tickets', () => {
    it('resolves hidden prefills in order, using only the immediately preceding string', () => {
        const model = fixture(
            Object.fromEntries(
                definitions.map((id) => [`prefill_Current ${id}`, 'Duplicate'])
            )
        );
        for (const [index, id] of definitions.entries()) {
            const read = plan(model, id, true);
            assert.deepEqual(
                read.input.filterData,
                index === 0
                    ? null
                    : {
                          previousFilterFieldId: definitions[index - 1],
                          previousFilterPrimaryValue: 'Duplicate',
                      }
            );
            assert.equal(
                model.accept(read.ticket, result(true)).status,
                'accepted'
            );
        }
        assert.equal(model.state().hidden, true);
        assert.deepEqual(
            model.snapshot(),
            Object.fromEntries(definitions.map((id) => [id, choices[1]]))
        );
    });
    it('rejects same-search superseded, replayed, copied and foreign tickets', () => {
        const model = fixture();
        const first = plan(model);
        const second = plan(model);
        assert.ok(second.ticket.request > first.ticket.request);
        assert.equal(model.accept(first.ticket, result()).status, 'stale');
        assert.equal(
            model.accept({ ...second.ticket }, result()).status,
            'stale'
        );
        assert.equal(fixture().accept(second.ticket, result()).status, 'stale');
        assert.equal(model.accept(second.ticket, result()).status, 'accepted');
        assert.equal(model.accept(second.ticket, result()).status, 'stale');
    });
    it('invalidates pending child reads and clears downstream selection/search/candidates on driver change', () => {
        const model = fixture();
        select(model);
        select(model, 'region');
        select(model, 'city');
        model.search('region', 'Find');
        const pending = plan(model, 'city');
        assert.equal(model.choose('country', 'one'), true);
        assert.equal(model.accept(pending.ticket, result()).status, 'stale');
        assert.deepEqual(
            model
                .state()
                .filters.slice(1)
                .map((f) => [f.search, f.selected, f.candidates]),
            [
                ['', null, []],
                ['', null, []],
            ]
        );
    });
    it('search invalidates candidates/tickets but preserves every selected pair', () => {
        const model = fixture();
        select(model);
        select(model, 'region');
        const before = model.snapshot();
        const pending = plan(model, 'region');
        model.search('country', 'New');
        assert.equal(model.accept(pending.ticket, result()).status, 'stale');
        assert.deepEqual(model.snapshot(), before);
        assert.deepEqual(model.state().filters[0]!.candidates, []);
    });
    it('validates response identities and matching prefill atomically without unlocking replay', () => {
        for (const malformed of [
            { primaryValues: [choices[0], choices[0]], prefillValue: null },
            {
                primaryValues: [{ recordId: 'x', stringValue: null }],
                prefillValue: null,
            },
            { primaryValues: Array(1), prefillValue: null },
            {
                primaryValues: choices,
                prefillValue: { recordId: 'two', stringValue: 'Wrong' },
            },
        ]) {
            const model = fixture({ 'prefill_Current country': 'Duplicate' });
            const before = model.snapshot();
            const read = plan(model, 'country', true);
            assert.equal(
                model.accept(
                    read.ticket,
                    malformed as ListConditionalFilterPrimaryValuesResult
                ).status,
                'invalid'
            );
            assert.deepEqual(model.snapshot(), before);
            assert.deepEqual(model.state().filters[0]!.candidates, []);
            assert.equal(
                model.accept(read.ticket, result(true)).status,
                'stale'
            );
        }
    });
    it('copies schema, query, metadata, plans, outputs and pairs at every boundary', () => {
        const source = schema();
        const query = { 'prefill_Current country': 'Duplicate' };
        const meta = metadata();
        const model = createFormLinkedFilterModel({ schema: source, query });
        source.airtableField.id = 'changed';
        query['prefill_Current country'] = 'changed';
        model.initialize(meta);
        meta.tbl_places!.airtableFields[0]!.name = 'changed';
        const read = plan(model, 'country', true);
        assert.equal(read.input.mainTableLinkedRecordsFieldId, 'outer');
        assert.equal(read.input.searchTerm, 'Duplicate');
        const response = result(true);
        model.accept(read.ticket, response);
        response.primaryValues[1]!.stringValue = 'changed';
        const snapshot = model.snapshot();
        snapshot.country!.stringValue = 'changed';
        const state = model.state();
        state.filters[0]!.selected!.stringValue = 'changed';
        assert.equal(model.snapshot().country!.stringValue, 'Duplicate');
    });
    it('treats an ID-bearing empty primary string as empty and keeps adding/removing independent', () => {
        const source = schema();
        const config = source.miniExtConfig!;
        if (!('conditionalLinkedRecordFilterFields' in config))
            throw new Error('Fixture');
        for (const rule of config.conditionalLinkedRecordFilterFields!)
            rule.config.config = {
                disableRemovingIfConditionalFilterIsEmpty: true,
            };
        const model = createFormLinkedFilterModel({
            schema: source,
            query: {},
        });
        model.initialize(metadata());
        assert.equal(model.canChange(true), true);
        assert.equal(model.canChange(false), false);
        for (const id of definitions) {
            const read = plan(model, id);
            model.accept(read.ticket, {
                primaryValues: [{ recordId: 'present', stringValue: '' }],
                prefillValue: null,
            });
            model.choose(id, 'present');
        }
        assert.equal(model.canChange(false), false);
        assert.equal(model.canChange(true), true);
    });
    it('unavailable metadata preserves otherwise unrestricted transitions and an empty Save filter map', () => {
        const model = createFormLinkedFilterModel({
            schema: schema(),
            query: {},
        });
        assert.equal(model.initialize({}).status, 'unavailable');
        assert.ok(model.state().diagnostics.length);
        assert.equal(model.canChange(true), true);
        assert.equal(model.canChange(false), true);
        assert.deepEqual(model.snapshot(), {});
    });
    it('rejects unsupported name descriptors and malformed/duplicate configuration or metadata explicitly', () => {
        for (const kind of ['name', 'duplicate', 'flags']) {
            const source = schema();
            const config = source.miniExtConfig!;
            if (!('conditionalLinkedRecordFilterFields' in config))
                throw new Error('Fixture');
            const rules = config.conditionalLinkedRecordFilterFields!;
            if (kind === 'name')
                rules[0]!.idOrName = { type: 'name', name: 'country' };
            else if (kind === 'duplicate')
                rules.push(structuredClone(rules[0]!));
            else
                rules[0]!.config.config = {
                    disableAddingIfConditionalFilterIsEmpty: 'yes',
                } as never;
            const model = createFormLinkedFilterModel({
                schema: source,
                query: {},
            });
            assert.equal(model.initialize(metadata()).status, 'unavailable');
            assert.ok(model.state().diagnostics.length);
            if (kind !== 'flags') assert.equal(model.canChange(true), true);
        }
        for (const meta of [
            null,
            { tbl_places: { airtableFields: Array(1) } },
            {
                tbl_places: {
                    airtableFields: [field('country'), field('country')],
                },
            },
        ])
            assert.equal(
                createFormLinkedFilterModel({
                    schema: schema(),
                    query: {},
                }).initialize(meta as unknown as RuntimeTableStates).status,
                'unavailable'
            );
    });
    it('reports malformed configuration containers and linked table identity without throwing or reading', () => {
        for (const config of [true, 'invalid', []]) {
            const source = schema();
            source.miniExtConfig = config as never;
            const model = createFormLinkedFilterModel({
                schema: source,
                query: {},
            });
            assert.equal(model.initialize(metadata()).status, 'unavailable');
            assert.ok(model.state().diagnostics.length);
        }
        const source = schema();
        source.airtableField.config.options.linkedTableId = '';
        assert.equal(
            createFormLinkedFilterModel({
                schema: source,
                query: {},
            }).initialize(metadata()).status,
            'unavailable'
        );
    });
    it('rejects repeated configured URL prefills while preserving ordinary requests and ignores old names', () => {
        const model = fixture({
            'prefill_Current country': ['a', 'b'],
            prefill_country: 'ignored',
        });
        assert.equal(
            model.prepareRead('country', { usePrefill: true }).status,
            'unavailable'
        );
        assert.equal(plan(model).input.urlSearchValue, null);
        assert.equal(model.canChange(true), true);
    });
    it('does not replay prefills after edits or successful resolution and retires disposed instances', () => {
        const model = fixture({ 'prefill_Current country': 'Duplicate' });
        const read = plan(model, 'country', true);
        model.accept(read.ticket, result(true));
        assert.equal(
            model.prepareRead('country', { usePrefill: true }).status,
            'resolved'
        );
        model.search('region', 'Edit');
        assert.equal(
            model.prepareRead('country', { usePrefill: true }).status,
            'unavailable'
        );
        const pending = plan(model);
        model.dispose();
        assert.equal(model.accept(pending.ticket, result()).status, 'stale');
        assert.equal(model.canChange(true), false);
        assert.deepEqual(model.snapshot(), {});
        assert.equal(model.initialize(metadata()).status, 'unavailable');
    });
    it('retires interrupted/invalid tickets without completing prefills; validated null completes', () => {
        const model = fixture({ 'prefill_Current country': 'Duplicate' });
        const old = plan(model, 'country', true);
        model.discard(old.ticket);
        const invalid = plan(model, 'country', true);
        assert.equal(
            model.accept(invalid.ticket, {
                primaryValues: [],
                prefillValue: choices[0]!,
            }).status,
            'invalid'
        );
        const retry = plan(model, 'country', true);
        model.discard(old.ticket);
        assert.equal(model.accept(old.ticket, result(true)).status, 'stale');
        assert.equal(model.isCurrent(retry.ticket), true);
        assert.equal(
            model.accept(retry.ticket, {
                primaryValues: [],
                prefillValue: null,
            }).status,
            'accepted'
        );
        assert.equal(
            model.prepareRead('country', { usePrefill: true }).status,
            'resolved'
        );
        model.search('region', 'edited');
        assert.equal(
            model.prepareRead('country', { usePrefill: true }).status,
            'unavailable'
        );
    });
});
