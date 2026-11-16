import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    captureReadonlyPrintDocument,
    type ReadonlyPrintDocument,
    type ReadonlyPrintFacet,
    type ReadonlyPrintField,
} from '../src/ui/readonlyPrintDocument.js';

function field(facet: ReadonlyPrintFacet, key = 'field'): ReadonlyPrintField {
    return {
        key,
        fieldName: 'Native name',
        title: 'Configured title',
        showTitle: true,
        required: false,
        sameRow: false,
        enableSideBySideOnMobile: false,
        facet,
    };
}
const text = (value = 'Admitted value'): ReadonlyPrintFacet => ({
    kind: 'text',
    value,
    emptyLabel: 'No value',
});
const document = (...fields: ReadonlyPrintField[]): ReadonlyPrintDocument => ({
    language: 'en',
    fields,
});
function accepted(input: ReadonlyPrintDocument) {
    const result = captureReadonlyPrintDocument(input);
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') throw new Error('Expected admission');
    return result.document;
}
function invalid(input: unknown) {
    assert.deepEqual(
        captureReadonlyPrintDocument(input as ReadonlyPrintDocument),
        {
            status: 'refused',
            reason: 'invalid-document',
        }
    );
}

test('capture retains full configured order and duplicate occurrences without mutating input', () => {
    const first = field(text('First page'), 'same-id');
    const second = field(text('Later page'), 'same-id');
    const source = { language: 'en' as const, fields: [first, second, first] };
    const snapshot = accepted(source);
    source.fields.reverse();
    assert.deepEqual(
        snapshot.fields.map((item) =>
            item.facet.kind === 'text' ? item.facet.value : null
        ),
        ['First page', 'Later page', 'First page']
    );
    assert.equal(snapshot.fields.length, 3);
    assert.notEqual(snapshot.fields[0], first);
    assert.notEqual(snapshot.fields[0], snapshot.fields[2]);
    assert.equal(Object.isFrozen(first), false);
});

test('nested labels, selected pill order and formatting facts are detached and deeply frozen', () => {
    const source = {
        language: 'en' as const,
        fields: [
            {
                ...field({
                    kind: 'pills',
                    emptyLabel: 'None',
                    items: [
                        {
                            label: 'Custom second',
                            color: '#fff',
                            backgroundColor: '#000',
                        },
                        { label: 'Custom first' },
                    ],
                }),
                title: 'Before',
                error: 'Localized error',
                description: {
                    html: '<p>Help</p>',
                    imageUrl: null,
                    placement: 'bottom' as const,
                    truncate: true,
                },
            },
        ],
    };
    const snapshot = accepted(source);
    source.fields[0].title = 'After';
    source.fields[0].description.html = '<p>Replaced</p>';
    assert.equal(snapshot.fields[0].title, 'Before');
    assert.equal(snapshot.fields[0].description?.html, '<p>Help</p>');
    const facet = snapshot.fields[0].facet;
    assert.equal(facet.kind, 'pills');
    if (facet.kind !== 'pills') throw new Error('Expected pills');
    assert.deepEqual(
        facet.items.map((item) => item.label),
        ['Custom second', 'Custom first']
    );
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.fields), true);
    assert.equal(Object.isFrozen(facet.items[0]), true);
    assert.throws(
        () => Object.assign(facet.items[0], { label: 'Mutated' }),
        TypeError
    );
});

test('all explicit display cohorts and nested state notices remain distinct', () => {
    const facets: ReadonlyPrintFacet[] = [
        text('********'),
        ...(['phone', 'date', 'duration', 'address'] as const).map((kind) => ({
            kind,
            value: 'Formatted',
            emptyLabel: 'None',
        })),
        {
            kind: 'numeric',
            text: '12,5%',
            emptyLabel: 'None',
            progress: { fraction: 0.125, color: '#abc' },
        },
        ...(['html', 'quill', 'markdown'] as const).map((kind) => ({
            kind,
            value: '<b>Body</b>',
            emptyLabel: 'None',
            height: 150,
        })),
        {
            kind: 'people',
            items: [
                {
                    label: 'Person',
                    avatarUrl: 'https://example.test/avatar.png',
                },
            ],
            emptyLabel: 'None',
        },
        {
            kind: 'checkbox',
            value: false,
            checkedLabel: 'Checked',
            uncheckedLabel: 'Unchecked',
        },
        {
            kind: 'rating',
            icon: 'heart',
            value: 3,
            max: 5,
            color: '#fab',
            emptyLabel: 'None',
            glyph: {
                path: 'M0 0',
                viewBox: '0 0 24 24',
                unfilledColor: '#ddd',
            },
        },
        {
            kind: 'barcode',
            text: '123',
            barcodeType: 'code128',
            emptyLabel: 'None',
        },
        { kind: 'resource', label: 'Visit', href: 'https://example.test' },
        {
            kind: 'attachments',
            items: [
                {
                    key: 'file',
                    label: 'Image',
                    kind: 'image',
                    url: 'https://example.test/image',
                    imageSources: [
                        'https://example.test/first',
                        'https://example.test/second',
                    ],
                },
            ],
            layout: 'thumbnail',
            columns: 3,
            fit: 'contain',
            thumbnailSize: 'medium',
            showNames: true,
            emptyLabel: 'None',
        },
        {
            kind: 'linkedRecords',
            layout: 'gallery',
            thumbnailLocation: 'left',
            columns: 2,
            emptyLabel: 'None',
            records: [
                {
                    key: 'one',
                    status: 'present',
                    primary: 'Record',
                    fields: [field(text('Nested'))],
                },
                { key: 'two', status: 'unavailable', label: 'Unavailable' },
                { key: 'three', status: 'loading', label: 'Loading' },
            ],
        },
        {
            kind: 'sequence',
            items: [
                text('First'),
                {
                    kind: 'sequence',
                    items: [text('Nested')],
                    layout: 'inline',
                    emptyLabel: 'None',
                },
            ],
            layout: 'stack',
            emptyLabel: 'None',
        },
        ...(['empty', 'unavailable', 'loading', 'invalid'] as const).map(
            (state) => ({ kind: 'notice' as const, state, label: state })
        ),
    ];
    const snapshot = accepted(
        document(...facets.map((facet, i) => field(facet, String(i))))
    );
    assert.deepEqual(
        snapshot.fields.map((item) => item.facet.kind),
        facets.map((facet) => facet.kind)
    );
    assert.equal(snapshot.fields[10].facet.kind, 'checkbox');
});

test('unsupported descendant refuses the entire job before any partial document is returned', () => {
    const result = captureReadonlyPrintDocument(
        document(
            field(text('Valid')),
            field(
                {
                    kind: 'linkedRecords',
                    layout: 'list',
                    thumbnailLocation: 'right',
                    columns: 1,
                    emptyLabel: 'None',
                    records: [
                        {
                            key: 'record',
                            status: 'present',
                            primary: 'Visible',
                            fields: [
                                field({
                                    kind: 'sequence',
                                    layout: 'wrap',
                                    emptyLabel: 'None',
                                    items: [
                                        {
                                            kind: 'unsupported',
                                            reason: 'unavailable-projection',
                                        },
                                    ],
                                }),
                            ],
                        },
                    ],
                },
                'refused-field'
            )
        )
    );
    assert.deepEqual(result, {
        status: 'refused',
        reason: 'unsupported-facet',
        fieldKey: 'refused-field',
    });
    assert.equal('document' in result, false);
});

test('callbacks, owners, clients and unrecognized metadata never cross the display DTO', () => {
    for (const extra of [
        { onChange() {} },
        { owner: { isCurrent: () => true } },
        { client: { authorization: 'synthetic-private-value' } },
        { rawPassword: 'synthetic-private-value' },
        { constructor: 'unexpected' },
    ])
        invalid({ ...document(field(text())), ...extra });
    invalid({
        ...document(),
        fields: [
            {
                ...field(text()),
                facet: { ...text(), rawValue: 'synthetic-private-value' },
            },
        ],
    });
});

test('getters and toJSON are not invoked, and refusal does not expose private exception content', () => {
    let invoked = 0;
    const source = document(field(text()));
    Object.defineProperty(source.fields[0], 'title', {
        get() {
            invoked++;
            throw new Error('synthetic-private-value');
        },
        enumerable: true,
    });
    invalid(source);
    invalid({
        ...document(field(text())),
        toJSON() {
            invoked++;
            return 'synthetic-private-value';
        },
    });
    assert.equal(invoked, 0);
});

test('cycles, class instances, symbols, sparse arrays and non-finite display values refuse safely', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    invalid(cycle);
    invalid(new Date());
    invalid({ ...document(field(text())), [Symbol('private')]: 'value' });
    invalid({ language: 'en', fields: new Array(2) });
    invalid(
        document(
            field({
                kind: 'rating',
                icon: 'star',
                value: NaN,
                max: 5,
                color: '#f00',
                emptyLabel: 'None',
                glyph: { path: '', viewBox: '', unfilledColor: '' },
            })
        )
    );
    invalid(
        document(
            field({
                kind: 'attachments',
                items: [],
                layout: 'grid',
                columns: -1,
                fit: 'cover',
                thumbnailSize: 'small',
                showNames: true,
                emptyLabel: 'None',
            })
        )
    );
});

test('an empty admitted Form stays empty and import/capture requires no browser globals', () => {
    const snapshot = accepted(document());
    assert.equal(snapshot.fields.length, 0);
    assert.equal(typeof globalThis.document, 'undefined');
});

test('array index accessors and extra array metadata refuse without invoking authority', () => {
    let invoked = 0;
    const fields: unknown[] = new Array(1);
    Object.defineProperty(fields, '0', {
        enumerable: true,
        get() {
            invoked++;
            return field(text());
        },
    });
    invalid({ language: 'en', fields });
    const metadata = [field(text())];
    Object.defineProperty(metadata, 'owner', {
        enumerable: true,
        value: {
            isCurrent() {
                invoked++;
                return true;
            },
        },
    });
    invalid({ language: 'en', fields: metadata });
    assert.equal(invoked, 0);
});

test('linked gallery thumbnail facts retain sizing, duplicate media order and placement', () => {
    const snapshot = accepted(
        document(
            field({
                kind: 'linkedRecords',
                layout: 'gallery',
                columns: 2,
                thumbnailLocation: 'right',
                emptyLabel: 'None',
                records: [
                    {
                        key: 'record',
                        status: 'present',
                        primary: 'Record',
                        fields: [],
                        thumbnail: {
                            kind: 'attachments',
                            layout: 'thumbnail',
                            columns: 2,
                            fit: 'contain',
                            thumbnailSize: 'large',
                            thumbnailHeight: 240,
                            showNames: true,
                            emptyLabel: 'None',
                            items: ['one', 'one', 'two'].map((key) => ({
                                key,
                                kind: 'image',
                                label: key,
                                url: `https://example.test/${key}`,
                                imageSources: [`https://example.test/${key}`],
                            })),
                        },
                    },
                ],
            })
        )
    );
    const facet = snapshot.fields[0].facet;
    assert.equal(facet.kind, 'linkedRecords');
    if (facet.kind !== 'linkedRecords')
        throw new Error('Expected linked records');
    assert.equal(facet.thumbnailLocation, 'right');
    const record = facet.records[0];
    if (record.status !== 'present') throw new Error('Expected present record');
    assert.equal(record.thumbnail?.thumbnailSize, 'large');
    assert.equal(record.thumbnail?.thumbnailHeight, 240);
    assert.deepEqual(
        record.thumbnail?.items.map((item) => item.key),
        ['one', 'one', 'two']
    );
});
