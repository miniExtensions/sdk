import assert from 'node:assert/strict';
import { it } from 'node:test';
import { groupFormFieldsBySections } from '../src/forms/formSections.js';

// Native contract: FormFieldSections.ts blob
// ec32f746091023c338a40836fea978d21dc3619b. This is presentation grouping,
// independent of canonical record/visibility/page projection.
it('preserves the ungrouped prefix, successive sections and exact field references', () => {
    const prefix = Object.freeze({ id: 'prefix' });
    const first = Object.freeze({ id: 'first' });
    const second = Object.freeze({ id: 'second' });
    const last = Object.freeze({ id: 'last' });
    const input = Object.freeze([
        Object.freeze({ field: prefix }),
        Object.freeze({
            field: first,
            sectionHeader: Object.freeze({
                title: '  Original title\n',
                description: '<p>Original description</p>',
                isExpanded: true,
            }),
        }),
        Object.freeze({ field: second }),
        Object.freeze({
            field: last,
            sectionHeader: Object.freeze({ title: 'Next' }),
        }),
    ]);
    const output = groupFormFieldsBySections(input);
    assert.deepEqual(output, [
        { kind: 'field', field: prefix },
        {
            kind: 'group',
            title: '  Original title\n',
            description: '<p>Original description</p>',
            fieldsInSection: [first, second],
            isExpanded: true,
        },
        {
            kind: 'group',
            title: 'Next',
            description: null,
            fieldsInSection: [last],
            isExpanded: false,
        },
    ]);
    assert.equal(output[0].kind === 'field' && output[0].field, prefix);
    assert.equal(
        output[1].kind === 'group' && output[1].fieldsInSection?.[0],
        first
    );
    assert.equal(
        output[1].kind === 'group' && output[1].fieldsInSection?.[1],
        second
    );
    assert.equal(
        'sectionHeader' in input[1] && input[1].sectionHeader?.title,
        '  Original title\n'
    );
});

it('includes each consecutive boundary field in its own nonempty section from index zero', () => {
    const first = Object.freeze({ id: 'first' });
    const second = Object.freeze({ id: 'second' });
    assert.deepEqual(
        groupFormFieldsBySections([
            {
                field: first,
                sectionHeader: {
                    title: 'First',
                    description: null,
                    isExpanded: false,
                },
            },
            {
                field: second,
                sectionHeader: {
                    enabled: true,
                    title: 'Second',
                    description: '\n <p>Raw description</p> \n',
                    isExpanded: true,
                },
            },
        ]),
        [
            {
                kind: 'group',
                title: 'First',
                description: null,
                fieldsInSection: [first],
                isExpanded: false,
            },
            {
                kind: 'group',
                title: 'Second',
                description: '\n <p>Raw description</p> \n',
                fieldsInSection: [second],
                isExpanded: true,
            },
        ]
    );
});

it('preserves duplicate IDs, repeated exact references and every original position', () => {
    const prefix = Object.freeze({ id: 'same', value: 'prefix' });
    const first = Object.freeze({ id: 'same', value: 'first' });
    const second = Object.freeze({ id: 'same', value: 'second' });
    const fields = Object.freeze([prefix, first, second, first, prefix]);
    const output = groupFormFieldsBySections(
        fields.map((field, index) => ({
            field,
            sectionHeader: index === 1 ? { title: 'Repeated' } : null,
        }))
    );
    const projected = output.flatMap((section) =>
        section.kind === 'field' ? [section.field] : section.fieldsInSection
    );
    assert.equal(projected.length, fields.length);
    projected.forEach((field, index) => assert.equal(field, fields[index]));
    assert.equal(output.length, 2);
});

it('keeps disabled headers in the prefix and does not inherit their metadata', () => {
    const first = Object.freeze({ id: 'disabled' });
    const second = Object.freeze({ id: 'omitted-title' });
    const boundary = Object.freeze({ id: 'boundary' });
    assert.deepEqual(
        groupFormFieldsBySections([
            {
                field: first,
                sectionHeader: {
                    enabled: false,
                    title: 'Disabled',
                    description: 'Do not carry this forward',
                    isExpanded: true,
                },
            },
            { field: second, sectionHeader: {} },
            { field: boundary, sectionHeader: { title: 'Enabled' } },
        ]),
        [
            { kind: 'field', field: first },
            { kind: 'field', field: second },
            {
                kind: 'group',
                title: 'Enabled',
                description: null,
                fieldsInSection: [boundary],
                isExpanded: false,
            },
        ]
    );
});

it('projects each immutable configuration independently without retaining an earlier boundary', () => {
    const field = Object.freeze({ id: 'same-host-node' });
    const first = groupFormFieldsBySections([
        { field, sectionHeader: { title: 'Before', isExpanded: true } },
    ]);
    const second = groupFormFieldsBySections([{ field }]);
    assert.deepEqual(second, [{ kind: 'field', field }]);
    assert.deepEqual(first, [
        {
            kind: 'group',
            title: 'Before',
            description: null,
            fieldsInSection: [field],
            isExpanded: true,
        },
    ]);
});

it('ignores disabled, null and whitespace headers without splitting the current section', () => {
    const fields = ['prefix', 'start', 'disabled', 'blank', 'null', 'tail'].map(
        (id) => Object.freeze({ id })
    );
    const output = groupFormFieldsBySections([
        { field: fields[0], sectionHeader: { title: ' ', isExpanded: true } },
        {
            field: fields[1],
            sectionHeader: { title: 'Start', description: '' },
        },
        {
            field: fields[2],
            sectionHeader: { enabled: false, title: 'Disabled' },
        },
        { field: fields[3], sectionHeader: { title: '\t\n' } },
        { field: fields[4], sectionHeader: { title: null } },
        { field: fields[5] },
    ]);
    assert.deepEqual(output, [
        { kind: 'field', field: fields[0] },
        {
            kind: 'group',
            title: 'Start',
            description: '',
            fieldsInSection: fields.slice(1),
            isExpanded: false,
        },
    ]);
    assert.equal(output.length, 2);
    assert.equal(groupFormFieldsBySections([]).length, 0);
    assert.deepEqual(
        groupFormFieldsBySections(fields.map((field) => ({ field }))),
        fields.map((field) => ({ kind: 'field', field }))
    );
});
