import assert from 'node:assert/strict';
import { it } from 'node:test';
import Papa from 'papaparse';
import {
    projectCSVExport,
    createCSVExportController,
    type CSVExportInput,
    type CSVExportRow,
    type CSVExportFieldValue,
    type CSVExportRequest,
    type CSVExportPlatform,
} from '../src/portals/csvExport.js';
import { serializeCSVExportDocument } from '../src/portals/csvSerialization.js';
import {
    AirtableFieldType,
    type AirtableValue,
} from '../src/formulas/types.js';

function field(
    name: string,
    value: AirtableValue,
    id = `field_${name}`
): CSVExportFieldValue {
    return {
        field: {
            id,
            name,
            config: { type: AirtableFieldType.SINGLE_LINE_TEXT },
        },
        value,
    };
}
function row(fields: readonly CSVExportFieldValue[]): CSVExportRow {
    return { status: 'loaded', viewType: 'list', fields };
}
function input(count = 1): CSVExportInput {
    return {
        admission: {
            allowed: true,
            borrowedRecords: false,
            cohort: 'portal-grid',
        },
        columns: [{ key: 'Name', title: 'Name' }],
        rows: Array.from({ length: count }, () =>
            row([field('Name', 'Original')])
        ),
    };
}
function ready(value: CSVExportInput) {
    const result = projectCSVExport(value);
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready')
        throw new Error('Expected projected document');
    return result.document;
}
function platform(clickFails = false) {
    const texts: string[] = [],
        revoked: string[] = [],
        clicks: Record<string, string>[] = [];
    let urls = 0;
    const boundary: CSVExportPlatform = {
        createBlob(text) {
            texts.push(text);
            return {};
        },
        createObjectURL() {
            return `blob:synthetic-${++urls}`;
        },
        revokeObjectURL(url) {
            revoked.push(url);
        },
        createAnchor() {
            const attrs: Record<string, string> = Object.create(null);
            return {
                setAttribute(name, value) {
                    attrs[name] = value;
                },
                click() {
                    clicks.push(attrs);
                    if (clickFails)
                        throw new TypeError('Private row/header/token');
                },
            };
        },
    };
    return {
        boundary,
        texts,
        revoked,
        clicks,
        get urls() {
            return urls;
        },
    };
}

it('denies borrowed or unadmitted export without formatting or browser resources', async () => {
    for (const admission of [
        {
            allowed: false,
            borrowedRecords: false,
            cohort: 'portal-grid' as const,
        },
        {
            allowed: true,
            borrowedRecords: true,
            cohort: 'form-linked-grid' as const,
        },
    ]) {
        let formatted = 0;
        const f = platform();
        const current = {
            input: {
                ...input(100),
                admission,
                formatField() {
                    formatted++;
                    return 'Never';
                },
            },
            filename: 'Never',
            platform: f.boundary,
        };
        const controller = createCSVExportController({
            readCurrent: () => current,
        });
        const outcome = await controller.request();
        assert.equal(outcome.status, 'blocked');
        assert.equal(
            outcome.status === 'blocked' && outcome.failure.reason,
            'denied'
        );
        assert.equal(controller.getSnapshot().confirmationOpen, false);
        assert.equal(formatted, 0);
        assert.equal(f.urls, 0);
    }
});

it('preserves native failed/loading/schema precedence before formatting', () => {
    const valid = row([field('Name', 'Value')]);
    const vectors: readonly [readonly CSVExportRow[], string][] = [
        [[{ status: 'loading' }, { status: 'failed' }], 'failed'],
        [
            [
                {
                    status: 'loaded',
                    viewType: 'list',
                    fields: [],
                    hasError: true,
                },
            ],
            'failed',
        ],
        [[{ status: 'loading' }], 'loading'],
        [
            [
                {
                    ...valid,
                    status: 'loaded',
                    viewType: 'list',
                    fields: [],
                    isPaginating: true,
                },
            ],
            'loading',
        ],
        [
            [
                {
                    status: 'loaded',
                    viewType: 'list',
                    fields: [],
                    isReloading: true,
                },
            ],
            'loading',
        ],
        [[{ status: 'loaded', viewType: 'grid', fields: [] }], 'schema'],
        [[row([])], 'schema'],
    ];
    for (const [rows, reason] of vectors) {
        const result = projectCSVExport({ ...input(), rows });
        assert.equal(
            result.status === 'blocked' && result.failure.reason,
            reason
        );
    }
});

it('validates the full schema union including hidden conflicts while allowing missing per-row cells', async () => {
    const base = {
        ...input(),
        rows: [row([field('Name', 'First')]), row([field('Other', 'Second')])],
    };
    assert.equal(
        await serializeCSVExportDocument(ready(base)),
        'Name\nFirst\n\n'
    );
    const result = projectCSVExport({
        ...base,
        rows: [
            row([field('Name', 'First'), field('Hidden', 'A', 'one')]),
            row([field('Hidden', 'B', 'two')]),
        ],
    });
    assert.equal(
        result.status === 'blocked' && result.failure.reason,
        'schema'
    );
    const delivery = platform();
    const conflictingName = createCSVExportController({
        readCurrent: () => ({
            input: {
                ...base,
                rows: [
                    row([field('Name', 'First')]),
                    row([field('Name', 'Second', 'other')]),
                ],
                formatField: () =>
                    assert.fail(
                        'Conflicting schema must refuse before formatting'
                    ),
            },
            filename: 'Synthetic CSV',
            platform: delivery.boundary,
        }),
    });
    const refusal = await conflictingName.request();
    assert.equal(
        refusal.status === 'blocked' && refusal.failure.reason,
        'schema'
    );
    assert.deepEqual(delivery.texts, []);
    assert.deepEqual(delivery.clicks, []);
    assert.equal(delivery.urls, 0);
});

it('falls back only to a unique nonhidden alias of the visible field identity', async () => {
    const current = field('Name', 'Current', 'fldName');
    const legacy = field('Former name', 'Renamed', 'fldName');
    const unread = (name: string, id: string) => ({
        field: field(name, null, id).field,
        get value(): AirtableValue {
            return assert.fail(`Ineligible descriptor was read: ${name}`);
        },
    });
    const source: CSVExportInput = {
        ...input(),
        columns: [
            { key: 'Name', title: 'Visible name' },
            { key: 'Hidden alias', title: 'Hidden', isHidden: true },
        ],
        rows: [
            row([legacy]),
            row([current, unread('Later alias', 'fldName')]),
            row([unread('Hidden alias', 'fldName')]),
            row([unread('Other field', 'fldOther')]),
            row([
                unread('Another alias', 'fldName'),
                unread('Ambiguous alias', 'fldName'),
            ]),
            row([]),
        ],
        formatField({ field: metadata, value }) {
            assert.equal(metadata, current.field);
            return String(value);
        },
    };
    assert.equal(
        await serializeCSVExportDocument(ready(source)),
        'Visible name\nRenamed\nCurrent\n\n\n\n\n'
    );
    assert.equal(
        await serializeCSVExportDocument(
            ready({
                ...input(),
                rows: [
                    row([field('Name', 'Exact', '')]),
                    row([unread('No identity', '')]),
                ],
            })
        ),
        'Name\nExact\n\n'
    );
});

it('uses the last compatible union metadata for every row and permits zero visible columns', async () => {
    const first = field('Name', 'First');
    const last = field('Name', 'Last');
    const metadata = {
        ...last.field,
        config: { type: AirtableFieldType.MULTILINE_TEXT as const },
    };
    const seen: CSVExportFieldValue[] = [];
    const source: CSVExportInput = {
        ...input(),
        rows: [row([first]), row([{ field: metadata, value: last.value }])],
        formatField(descriptor) {
            seen.push(descriptor);
            return String(descriptor.value);
        },
    };
    assert.equal(
        await serializeCSVExportDocument(ready(source)),
        'Name\nFirst\nLast\n'
    );
    assert.deepEqual(
        seen.map((descriptor) => descriptor.value),
        ['First', 'Last']
    );
    assert(seen.every((descriptor) => descriptor.field === metadata));
    const hidden = ready({
        ...source,
        columns: [{ key: 'Name', title: 'Hidden', isHidden: true }],
    });
    assert.equal(hidden.columns.length, 0);
    assert.deepEqual(hidden.rows, [[], []]);
    assert.equal(seen.length, 2);
});

it('preserves prototype keys, duplicate column labels/order and repeated rows', async () => {
    const record = row([
        field('__proto__', 'Proto'),
        field('constructor', 'Constructor'),
    ]);
    const document = ready({
        ...input(),
        columns: [
            { key: 'constructor', title: 'Same' },
            { key: '__proto__', title: 'Same' },
            { key: 'constructor', title: 'Same' },
        ],
        rows: [record, record],
    });
    assert.deepEqual(
        document.columns.map((c) => c.key),
        ['constructor', '__proto__', 'constructor']
    );
    assert.equal(
        await serializeCSVExportDocument(document),
        'Same,Same,Same\nConstructor,Proto,Constructor\nConstructor,Proto,Constructor\n'
    );
});

it('uses raw numeric classification and the exact accepted header/cell neutralization oracle', async () => {
    const numeric = {
        field: {
            id: 'number',
            name: 'Number',
            config: {
                type: AirtableFieldType.NUMBER as const,
                options: { precision: 0 },
            },
        },
        value: -42,
    };
    const document = ready({
        ...input(),
        columns: [
            { key: 'Number', title: '=Header' },
            { key: 'String', title: '+Header' },
            { key: 'Array', title: '@Header' },
        ],
        rows: [
            row([
                numeric,
                field('String', '-42'),
                {
                    field: {
                        id: 'array',
                        name: 'Array',
                        config: { type: AirtableFieldType.MULTIPLE_SELECTS },
                    },
                    value: ['-42'],
                },
            ]),
        ],
    });
    assert.equal(document.rows[0][0].rawWasNumber, true);
    assert.equal(
        await serializeCSVExportDocument(document),
        "'=Header,'+Header,'@Header\n-42,'-42,'-42\n"
    );
    for (const [text, expected] of [
        ['=A', "'=A"],
        ['+A', "'+A"],
        ['-A', "'-A"],
        ['@A', "'@A"],
        ['\tA', "'\tA"],
        [' safe', ' safe'],
    ]) {
        assert.equal(
            await serializeCSVExportDocument({
                columns: [{ key: 'x', title: 'Text' }],
                rows: [[{ readableValue: text, rawWasNumber: false }]],
            }),
            `Text\n${expected}\n`
        );
    }
});

it('preserves header-only Unicode, quotes and newlines without mutating lookup keys', async () => {
    const document = Object.freeze({
        columns: Object.freeze([
            Object.freeze({ key: '__proto__', title: '=世界,"Q"\nNext' }),
        ]),
        rows: Object.freeze([]),
    });
    assert.equal(
        await serializeCSVExportDocument(document),
        '"\'=世界,""Q""\nNext"\n'
    );
    assert.equal(document.columns[0].key, '__proto__');
});

it('detaches raw metadata/values synchronously and refuses asynchronous formatter output', () => {
    const descriptor = field('Name', 'Before');
    const columns = [{ key: 'Name', title: 'Before header' }];
    const source = { ...input(), columns, rows: [row([descriptor])] };
    const document = ready(source);
    descriptor.field.name = 'After';
    columns[0].title = 'After header';
    assert.equal(document.columns[0].title, 'Before header');
    assert.equal(document.rows[0][0].readableValue, 'Before');
    const result = projectCSVExport({
        ...input(),
        // @ts-expect-error JavaScript consumers must not return an async formatter
        formatField: () => Promise.resolve('Wrong'),
    });
    assert.equal(
        result.status === 'blocked' && result.failure.reason,
        'unexpected'
    );
});

it('keeps unresolved linked labels private with the standalone formatter', () => {
    const descriptor: CSVExportFieldValue = {
        field: {
            id: 'linked',
            name: 'Name',
            config: {
                type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                options: {
                    linkedTableId: 'table',
                },
            },
        },
        value: ['recSecret12345678'],
    };
    const document = ready({
        ...input(),
        rows: [row([descriptor])],
        unavailableLinkedRecordPlaceholder: 'Unavailable',
    });
    assert.equal(document.rows[0][0].readableValue, 'Unavailable');
    assert(!JSON.stringify(document).includes('recSecret'));
});

it('keeps linked Formula values together for the default Portal Grid formatter', () => {
    const descriptor: CSVExportFieldValue = {
        field: {
            id: 'formula-links',
            name: 'Name',
            config: {
                type: AirtableFieldType.FORMULA,
                options: {
                    isValid: true,
                    result: {
                        type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                        options: { linkedTableId: 'table' },
                    },
                },
            },
        },
        value: ['rec12345678901234', 'Supplied label'],
    };
    const data = {
        ...input(),
        unavailableLinkedRecordPlaceholder: 'Unavailable',
        rows: [
            row([descriptor]),
            row([{ ...descriptor, value: [] }]),
            row([{ ...descriptor, value: null }]),
            row([{ ...descriptor, value: 'Supplied label' }]),
            row([{ ...descriptor, value: 'rec12345678901234' }]),
        ],
    };
    assert.deepEqual(
        ready(data).rows.map(([cell]) => cell.readableValue),
        ['Unavailable, Supplied label', '', '', 'Supplied label', 'Unavailable']
    );
    assert.deepEqual(
        projectCSVExport({
            ...data,
            admission: { ...data.admission, cohort: 'form-linked-grid' },
        }).status,
        'blocked'
    );
});

it('downloads admitted collaborator labels in order without recovering unavailable email', async () => {
    const zeta = {
        id: 'usrZeta',
        name: 'Zeta Person',
        email: 'z@example.invalid',
    };
    const fallback = {
        id: 'usrEmail',
        name: '',
        email: 'fallback@example.invalid',
    };
    const alpha = {
        id: 'usrAlpha',
        name: 'Alpha Person',
        email: 'a@example.invalid',
    };
    const unavailable = { id: 'usrUnavailable', name: '', email: '' };
    const hiddenEmail = 'unavailable@example.invalid';
    const choices = [{ ...unavailable, email: hiddenEmail }];
    const team = {
        id: 'fldTeam',
        name: 'Collaborators',
        config: {
            type: AirtableFieldType.MULTIPLE_COLLABORATORS,
            options: { choices },
        },
    } as const;
    const owner = {
        id: 'fldOwner',
        name: 'Owner',
        config: {
            type: AirtableFieldType.SINGLE_COLLABORATOR,
            options: { choices },
        },
    } as const;
    let hiddenReads = 0;
    const hidden = {
        field: { ...owner, id: 'fldHidden', name: 'Redacted column' },
        get value() {
            hiddenReads++;
            return choices[0]!;
        },
    };
    const recEmail = row([
        { field: team, value: [fallback] },
        { field: owner, value: fallback },
        hidden,
    ]);
    const recTeam = row([
        { field: team, value: [zeta, fallback, alpha, zeta] },
        { field: owner, value: zeta },
    ]);
    const recEmpty = row([{ field: team, value: [] }]);
    const recUnavailable = row([
        { field: team, value: [unavailable] },
        { field: owner, value: unavailable },
    ]);
    const f = platform();
    const controller = createCSVExportController({
        readCurrent: () => ({
            input: {
                ...input(),
                columns: [
                    { key: team.name, title: team.name },
                    { key: owner.name, title: owner.name },
                    {
                        key: hidden.field.name,
                        title: hidden.field.name,
                        isHidden: true,
                    },
                ],
                rows: [recEmail, recTeam, recEmpty, recUnavailable],
            },
            filename: 'Synthetic collaborators.csv',
            platform: f.boundary,
        }),
    });

    assert.equal((await controller.request()).status, 'delivered');
    assert.equal(f.clicks.length, 1);
    assert.equal(f.clicks[0]?.download, 'Synthetic collaborators.csv');
    assert.equal(f.texts.length, 1);
    assert.equal(hiddenReads, 0);
    assert(!f.texts[0]!.includes(hiddenEmail));
    const parsed = Papa.parse(f.texts[0]!.trimEnd(), {
        delimiter: ',',
        dynamicTyping: false,
        worker: false,
        download: false,
    });
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.data, [
        ['Collaborators', 'Owner'],
        ['fallback@example.invalid', 'fallback@example.invalid'],
        [
            'Zeta Person, fallback@example.invalid, Alpha Person, Zeta Person',
            'Zeta Person',
        ],
        ['', ''],
        ['', ''],
    ]);
});

it('uses current confirmation data/policy and zero/99/100 row boundaries', async () => {
    const f = platform();
    let current: CSVExportRequest = {
        input: input(100),
        filename: 'Original filename',
        platform: f.boundary,
    };
    const controller = createCSVExportController({
        readCurrent: () => current,
    });
    assert.equal((await controller.request()).status, 'confirmation');
    assert.equal(f.urls, 0);
    current = { ...current, input: input(0) };
    assert.equal((await controller.confirm()).status, 'empty');
    assert.equal(f.urls, 0);
    current = { ...current, input: input(100) };
    await controller.request();
    controller.dismiss();
    assert.equal(f.urls, 0);
    await controller.request();
    current = {
        ...current,
        input: {
            ...input(),
            admission: { ...input().admission, borrowedRecords: true },
        },
    };
    assert.equal((await controller.confirm()).status, 'blocked');
    assert.equal(f.urls, 0);
    current = { ...current, input: input(99), filename: 'Current filename' };
    assert.equal((await controller.request()).status, 'delivered');
    assert.equal(f.texts[0].split('\n').length, 101);
    assert.equal(f.clicks[0].download, 'Current filename');
    assert.deepEqual(f.revoked, ['blob:synthetic-1']);
});

it('completes each detached allocated attempt after input replacement and permits explicit repeats', async () => {
    const f = platform();
    let current: CSVExportRequest = {
        input: input(),
        filename: 'Captured filename',
        platform: f.boundary,
    };
    const controller = createCSVExportController({
        readCurrent: () => current,
    });
    const first = controller.request();
    current = {
        ...current,
        input: { ...input(), rows: [row([field('Name', 'Replacement')])] },
        filename: 'Replacement filename',
    };
    const second = controller.request();
    assert.equal((await first).status, 'delivered');
    assert.equal((await second).status, 'delivered');
    assert.equal(f.texts[0], 'Name\nOriginal\n');
    assert.equal(f.texts[1], 'Name\nReplacement\n');
    assert.deepEqual(
        f.clicks.map((x) => x.download),
        ['Captured filename', 'Replacement filename']
    );
    assert.deepEqual(f.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
    assert.equal(controller.getSnapshot().pendingCount, 0);
});

it('classifies formatter failure without resource allocation or data-bearing diagnostics', async () => {
    const f = platform();
    const controller = createCSVExportController({
        readCurrent: () => ({
            input: {
                ...input(),
                formatField() {
                    throw new TypeError('Private headers/tokens/rows');
                },
            },
            filename: 'Private filename',
            platform: f.boundary,
        }),
    });
    const result = await controller.request();
    assert.equal(result.status, 'blocked');
    if (result.status !== 'blocked') throw new Error('Expected failure');
    assert.equal(result.failure.errorType, 'TypeError');
    assert.equal(result.failure.message, 'CSV export failed: unexpected');
    assert(!JSON.stringify(result.failure).includes('Private'));
    assert.equal(f.urls, 0);
    assert.equal(f.texts.length, 0);
});

it('revokes the exact allocated URL when anchor creation or click throws without automatic retry', async () => {
    for (const failurePoint of ['anchor', 'click']) {
        const f = platform(true);
        const boundary =
            failurePoint === 'click'
                ? f.boundary
                : {
                      ...f.boundary,
                      createAnchor() {
                          throw new TypeError('Private anchor failure');
                      },
                  };
        const controller = createCSVExportController({
            readCurrent: () => ({
                input: input(),
                filename: 'Exact name',
                platform: boundary,
            }),
        });
        const result = await controller.request();
        assert.equal(result.status, 'blocked');
        assert.equal(f.clicks.length, failurePoint === 'click' ? 1 : 0);
        assert.equal(f.urls, 1);
        assert.deepEqual(f.revoked, ['blob:synthetic-1']);
        assert.equal(controller.getSnapshot().pendingCount, 0);
    }
});
