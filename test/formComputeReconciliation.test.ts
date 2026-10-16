import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import {
    reconcileFormComputeResult,
    type ReconcileFormComputeResultInput,
} from '../src/forms/index.js';
import type { AirtableValue } from '../src/runtime/index.js';

const input = (
    overrides: Partial<ReconcileFormComputeResultInput> = {}
): ReconcileFormComputeResultInput => ({
    submittedData: {},
    latestData: {},
    latestDirtyFieldIds: [],
    retainDirtyFieldIds: new Set(),
    serverData: {},
    addOnlyTextFieldIds: new Set(),
    areValuesEquivalent: isDeepStrictEqual,
    ...overrides,
});

describe('accepted Form compute reconciliation', () => {
    it('keeps committed frontend bytes and server-only computed values without mutating frozen inputs', () => {
        const submittedData = Object.freeze({
            fld_text: '  Submitted\n\ntext  ',
            fld_number: 0,
            fld_flag: false,
            fld_blank: null,
        });
        const latestData = Object.freeze({ ...submittedData });
        const serverData = Object.freeze({
            fld_text: 'Submitted\ntext',
            fld_number: 0,
            fld_flag: false,
            fld_blank: null,
            fld_computed: 42,
        });
        const latestDirtyFieldIds = Object.freeze(Object.keys(latestData));
        const result = reconcileFormComputeResult(
            Object.freeze(
                input({
                    submittedData,
                    latestData,
                    latestDirtyFieldIds,
                    serverData,
                    retainDirtyFieldIds: Object.freeze(new Set<string>()),
                    addOnlyTextFieldIds: Object.freeze(new Set<string>()),
                })
            )
        );
        assert.deepEqual(result, {
            data: { ...submittedData, fld_computed: 42 },
            dirtyFieldIds: [],
        });
        assert.notEqual(result.data, serverData);
        Object.assign(result.data, { fld_text: 'Detached result' });
        assert.equal(serverData.fld_text, 'Submitted\ntext');
        assert.equal(submittedData.fld_text, '  Submitted\n\ntext  ');
        assert.deepEqual(latestDirtyFieldIds, Object.keys(latestData));
    });

    it('retains hidden, unsubmitted and changed values in ordered dirty IDs, including duplicates', () => {
        const comparisons: [
            AirtableValue | undefined,
            AirtableValue | undefined,
        ][] = [];
        const result = reconcileFormComputeResult(
            input({
                submittedData: {
                    fld_changed: 1,
                    fld_committed: 'Committed',
                },
                latestData: {
                    fld_hidden: 'Hidden after',
                    fld_changed: 2,
                    fld_new: false,
                    fld_committed: 'Committed',
                },
                latestDirtyFieldIds: [
                    'fld_hidden',
                    'fld_changed',
                    'fld_new',
                    'fld_committed',
                    'fld_changed',
                ],
                serverData: {
                    fld_hidden: 'Old server value',
                    fld_changed: 1,
                    fld_new: true,
                    fld_committed: 'Server spelling',
                },
                areValuesEquivalent: (latest, start) => {
                    comparisons.push([latest, start]);
                    return isDeepStrictEqual(latest, start);
                },
            })
        );
        assert.deepEqual(result, {
            data: {
                fld_hidden: 'Hidden after',
                fld_changed: 2,
                fld_new: false,
                fld_committed: 'Committed',
            },
            dirtyFieldIds: [
                'fld_hidden',
                'fld_changed',
                'fld_new',
                'fld_changed',
            ],
        });
        assert.deepEqual(comparisons, [
            [2, 1],
            ['Committed', 'Committed'],
        ]);
    });

    it('clears only committed add-only text and keeps newer, hidden and unsubmitted entries', () => {
        const result = reconcileFormComputeResult(
            input({
                submittedData: {
                    fld_committed: 'Append this',
                    fld_changed: 'Earlier append',
                },
                latestData: {
                    fld_committed: 'Append this',
                    fld_changed: 'Next append',
                    fld_hidden: 'Hidden append',
                    fld_new: 'Unsubmitted append',
                },
                latestDirtyFieldIds: [
                    'fld_committed',
                    'fld_changed',
                    'fld_hidden',
                    'fld_new',
                ],
                serverData: {
                    fld_committed: 'Existing text\nAppend this',
                    fld_changed: 'Existing text\nEarlier append',
                    fld_hidden: 'Existing text',
                },
                addOnlyTextFieldIds: new Set([
                    'fld_committed',
                    'fld_changed',
                    'fld_hidden',
                    'fld_new',
                ]),
            })
        );
        assert.deepEqual(result, {
            data: {
                fld_committed: '',
                fld_changed: 'Next append',
                fld_hidden: 'Hidden append',
                fld_new: 'Unsubmitted append',
            },
            dirtyFieldIds: ['fld_changed', 'fld_hidden', 'fld_new'],
        });
    });

    it('retains original attachment arrays, duplicate order and native metadata until final save', () => {
        const attachment = Object.freeze({
            url: 'https://uploads.example.test/temporary',
            filename: 'Original name.png',
            type: 'image/png',
            size: 0,
        });
        const attachments = Object.freeze([attachment, attachment]);
        const returnedAttachments = Object.freeze([
            {
                ...attachment,
                id: 'att_persisted',
                url: 'https://airtable.test/new',
            },
        ]);
        const result = reconcileFormComputeResult(
            input({
                submittedData: { fld_files: attachments },
                latestData: { fld_files: attachments },
                latestDirtyFieldIds: ['fld_files'],
                serverData: { fld_files: returnedAttachments },
            })
        );
        assert.equal(result.data.fld_files, attachments);
        assert.deepEqual(result.dirtyFieldIds, []);
        assert.equal(attachments.length, 2);
        assert.equal(attachments[0], attachment);
        assert.equal(attachments[1], attachment);
        assert.equal(returnedAttachments[0].id, 'att_persisted');
    });

    it('preserves changed native array/object references rather than formatting them', () => {
        const links = ['rec_new', 'rec_existing'];
        const barcode = { text: '0089', type: 'code128' };
        const nativeArray = [null, false, { text: 'native code' }];
        const result = reconcileFormComputeResult(
            input({
                submittedData: {
                    fld_links: ['rec_existing'],
                    fld_barcode: { text: '0088', type: 'code128' },
                    fld_array: [null],
                },
                latestData: {
                    fld_links: links,
                    fld_barcode: barcode,
                    fld_array: nativeArray,
                },
                latestDirtyFieldIds: ['fld_links', 'fld_barcode', 'fld_array'],
                serverData: {},
            })
        );
        assert.equal(result.data.fld_links, links);
        assert.equal(result.data.fld_barcode, barcode);
        assert.equal(result.data.fld_array, nativeArray);
        assert.deepEqual(result.dirtyFieldIds, [
            'fld_links',
            'fld_barcode',
            'fld_array',
        ]);
    });

    it('uses the explicit cosmetic equivalence policy and restores submitted bytes, not the latest spelling', () => {
        const requestStartValue = 'Line one\n\nLine two';
        const latestValue = 'Line one\r\n\r\nLine two  ';
        let comparisons = 0;
        const result = reconcileFormComputeResult(
            input({
                submittedData: { fld_rich: requestStartValue },
                latestData: { fld_rich: latestValue },
                latestDirtyFieldIds: ['fld_rich'],
                serverData: { fld_rich: 'Line one\nLine two' },
                areValuesEquivalent: (latest, start) => {
                    comparisons++;
                    assert.equal(latest, latestValue);
                    assert.equal(start, requestStartValue);
                    return (
                        String(latest).replaceAll('\r\n', '\n').trimEnd() ===
                        start
                    );
                },
            })
        );
        assert.equal(comparisons, 1);
        assert.deepEqual(result, {
            data: { fld_rich: requestStartValue },
            dirtyFieldIds: [],
        });
    });

    it('compares submitted values without inventing dirty IDs for untracked changes', () => {
        let comparisons = 0;
        const result = reconcileFormComputeResult(
            input({
                submittedData: { fld_submitted: 'Submitted' },
                latestData: {
                    fld_submitted: 'Untracked change',
                    fld_untracked: 'Local only',
                },
                serverData: {
                    fld_submitted: 'Server',
                    fld_untracked: 'Server only',
                },
                areValuesEquivalent: (latest, submitted) => {
                    comparisons++;
                    assert.equal(latest, 'Untracked change');
                    assert.equal(submitted, 'Submitted');
                    return false;
                },
            })
        );
        assert.deepEqual(result, {
            data: { fld_submitted: 'Server', fld_untracked: 'Server only' },
            dirtyFieldIds: [],
        });
        assert.equal(comparisons, 1);
    });

    it('copies a server-only response even when there are no submitted or dirty fields', () => {
        const files = [{ url: 'https://example.test/persisted' }];
        const serverData = { fld_files: files, fld_formula: 3 };
        const result = reconcileFormComputeResult(input({ serverData }));
        assert.notEqual(result.data, serverData);
        assert.equal(result.data.fld_files, files);
        assert.deepEqual(result, { data: serverData, dirtyFieldIds: [] });
    });

    it('omits a missing latest dirty value without inventing undefined or copying server history', () => {
        const result = reconcileFormComputeResult(
            input({
                latestDirtyFieldIds: ['fld_new'],
                serverData: { fld_new: 'Old server value' },
                areValuesEquivalent: () => {
                    assert.fail('An unsubmitted field is retained directly');
                },
            })
        );
        assert.equal(Object.hasOwn(result.data, 'fld_new'), false);
        assert.equal(result.data.fld_new, undefined);
        assert.deepEqual(result.dirtyFieldIds, ['fld_new']);
    });

    it('never acknowledges inherited submission keys and retains their current dirty values', () => {
        const submittedData: Record<string, AirtableValue> = Object.create({
            fld_inherited: 'Submitted inherited value',
        });
        submittedData.fld_own = 'Own value';
        const comparisons: (AirtableValue | undefined)[] = [];
        const result = reconcileFormComputeResult(
            input({
                submittedData,
                latestData: {
                    fld_inherited: 'Submitted inherited value',
                    fld_own: 'Own value',
                },
                latestDirtyFieldIds: ['fld_inherited', 'fld_own'],
                serverData: { fld_inherited: 'Returned inherited value' },
                areValuesEquivalent: (latest, start) => {
                    comparisons.push(start);
                    return latest === start;
                },
            })
        );
        assert.deepEqual(comparisons, ['Own value']);
        assert.deepEqual(result, {
            data: {
                fld_inherited: 'Submitted inherited value',
                fld_own: 'Own value',
            },
            dirtyFieldIds: ['fld_inherited'],
        });
        assert.equal(Object.hasOwn(submittedData, 'fld_inherited'), false);
    });

    it('copies special own keys as data without changing the result prototype', () => {
        const submittedData = Object.fromEntries([
            ['__proto__', 'Committed prototype text'],
            ['constructor', 'Old constructor text'],
            ['toString', 'Committed toString text'],
        ]);
        const latestData = Object.fromEntries([
            ['__proto__', 'Committed prototype text'],
            ['constructor', 'New constructor text'],
            ['toString', 'Committed toString text'],
        ]);
        const serverData = Object.fromEntries([
            ['__proto__', 'Server prototype text'],
            ['constructor', 'Server constructor text'],
            ['toString', 'Server toString text'],
        ]);
        const result = reconcileFormComputeResult(
            input({
                submittedData,
                latestData,
                latestDirtyFieldIds: ['__proto__', 'constructor', 'toString'],
                serverData,
            })
        );
        assert.equal(Object.getPrototypeOf(result.data), Object.prototype);
        assert.deepEqual(Object.keys(result.data), [
            '__proto__',
            'constructor',
            'toString',
        ]);
        assert.equal(result.data.__proto__, 'Committed prototype text');
        assert.equal(result.data.constructor, 'New constructor text');
        assert.equal(result.data.toString, 'Committed toString text');
        assert.deepEqual(result.dirtyFieldIds, ['constructor']);
    });

    it('accepts the server total already present in the latest draft while retaining newer and omitted edits', () => {
        const result = reconcileFormComputeResult(
            input({
                submittedData: { fld_quantity: 1, fld_title: 'Frontend title' },
                latestData: {
                    fld_quantity: 2,
                    fld_title: 'Frontend title',
                    fld_total: 10,
                    fld_readonly: 'Earlier readonly value',
                    fld_hidden: 'Hidden local draft',
                },
                latestDirtyFieldIds: [
                    'fld_quantity',
                    'fld_title',
                    'fld_hidden',
                ],
                serverData: {
                    fld_quantity: 1,
                    fld_title: 'Server-normalized title',
                    fld_total: 20,
                    fld_readonly: 'Fresh readonly value',
                    fld_hidden: 'Earlier hidden value',
                },
            })
        );
        assert.deepEqual(result, {
            data: {
                fld_quantity: 2,
                fld_title: 'Frontend title',
                fld_total: 20,
                fld_readonly: 'Fresh readonly value',
                fld_hidden: 'Hidden local draft',
            },
            dirtyFieldIds: ['fld_quantity', 'fld_hidden'],
        });
    });

    it('keeps unsubmitted blank append inputs even when not dirty and omits absent append history', () => {
        const result = reconcileFormComputeResult(
            input({
                latestData: { fld_blank: '', fld_undefined: undefined },
                serverData: {
                    fld_blank: 'Stored history',
                    fld_undefined: 'Other stored history',
                    fld_absent: 'History without a current append input',
                },
                addOnlyTextFieldIds: new Set([
                    'fld_blank',
                    'fld_undefined',
                    'fld_absent',
                ]),
                areValuesEquivalent: () =>
                    assert.fail('No actual submitted values can acknowledge.'),
            })
        );
        assert.equal(result.data.fld_blank, '');
        assert.equal(Object.hasOwn(result.data, 'fld_undefined'), true);
        assert.equal(result.data.fld_undefined, undefined);
        assert.equal(Object.hasOwn(result.data, 'fld_absent'), false);
        assert.deepEqual(result.dirtyFieldIds, []);
    });

    it('snapshots own enumerable values and never acknowledges undefined, nonenumerable or inherited provenance', () => {
        const submittedData: Record<string, AirtableValue> = Object.create({
            fld_inherited: 'Inherited submission',
        });
        Object.defineProperty(submittedData, 'fld_nonenum', {
            value: 'Nonenumerable submission',
            enumerable: false,
        });
        Object.defineProperty(submittedData, 'fld_undefined', {
            value: undefined,
            enumerable: true,
        });
        submittedData.fld_missing_latest = 'Prototype-only latest value';
        const latestData: Record<string, AirtableValue | undefined> =
            Object.assign(
                Object.create({
                    fld_missing_latest: 'Prototype-only latest value',
                }),
                {
                    fld_inherited: 'Inherited submission',
                    fld_nonenum: 'Nonenumerable submission',
                    fld_undefined: 'Local unsent value',
                    fld_own_undefined: undefined,
                }
            );
        let submittedReads = 0;
        let latestReads = 0;
        Object.defineProperty(submittedData, 'fld_ack', {
            configurable: true,
            enumerable: true,
            get: () => {
                submittedReads++;
                return 'Submitted bytes';
            },
        });
        Object.defineProperty(latestData, 'fld_ack', {
            configurable: true,
            enumerable: true,
            get: () => {
                latestReads++;
                return 'Submitted bytes';
            },
        });
        const comparisons: string[] = [];
        const result = reconcileFormComputeResult(
            input({
                submittedData,
                latestData,
                latestDirtyFieldIds: [
                    'fld_inherited',
                    'fld_nonenum',
                    'fld_undefined',
                    'fld_missing_latest',
                    'fld_own_undefined',
                    'fld_ack',
                ],
                serverData: {
                    fld_inherited: 'Server inherited value',
                    fld_nonenum: 'Server nonenumerable value',
                    fld_undefined: 'Server omitted-key value',
                    fld_missing_latest: 'Server prototype value',
                    fld_own_undefined: 'Server old value',
                    fld_ack: 'Server normalization',
                },
                areValuesEquivalent: (latest, submitted) => {
                    assert.equal(submittedReads, 1);
                    assert.equal(latestReads, 1);
                    comparisons.push(String(submitted));
                    Object.defineProperty(submittedData, 'fld_ack', {
                        value: 'Changed after capture',
                    });
                    Object.defineProperty(latestData, 'fld_ack', {
                        value: 'Changed after capture',
                    });
                    return latest === submitted;
                },
            })
        );
        assert.deepEqual(comparisons, ['Submitted bytes']);
        assert.equal(submittedReads, 1);
        assert.equal(latestReads, 1);
        assert.deepEqual(result, {
            data: {
                fld_inherited: 'Inherited submission',
                fld_nonenum: 'Nonenumerable submission',
                fld_undefined: 'Local unsent value',
                fld_own_undefined: undefined,
                fld_ack: 'Submitted bytes',
            },
            dirtyFieldIds: [
                'fld_inherited',
                'fld_nonenum',
                'fld_undefined',
                'fld_missing_latest',
                'fld_own_undefined',
            ],
        });
        assert.equal(Object.hasOwn(result.data, 'fld_missing_latest'), false);
        assert.equal(Object.hasOwn(result.data, 'fld_own_undefined'), true);
    });

    it('retains newer A to B to A edit intent using captured dirty generations rather than value equality', () => {
        const retainDirtyFieldIds = new Set(['fld_append', 'fld_quantity']);
        const addOnlyTextFieldIds = new Set(['fld_append', 'fld_committed']);
        const latestDirtyFieldIds = [
            'fld_append',
            'fld_ack',
            'fld_committed',
            'fld_quantity',
            'fld_append',
        ];
        const comparisons: (AirtableValue | undefined)[] = [];
        const result = reconcileFormComputeResult(
            input({
                submittedData: {
                    fld_ack: 'Same',
                    fld_committed: 'Commit this',
                    fld_append: 'A',
                    fld_quantity: 1,
                },
                latestData: {
                    fld_ack: 'Same',
                    fld_committed: 'Commit this',
                    fld_append: 'A',
                    fld_quantity: 1,
                },
                latestDirtyFieldIds,
                retainDirtyFieldIds,
                addOnlyTextFieldIds,
                serverData: {
                    fld_ack: 'Normalized',
                    fld_committed: 'History\nCommit this',
                    fld_append: 'History\nA',
                    fld_quantity: 1,
                },
                areValuesEquivalent: (latest, submitted) => {
                    comparisons.push(submitted);
                    retainDirtyFieldIds.clear();
                    addOnlyTextFieldIds.clear();
                    latestDirtyFieldIds.length = 0;
                    return latest === submitted;
                },
            })
        );
        assert.deepEqual(comparisons, ['Same', 'Commit this']);
        assert.equal(retainDirtyFieldIds.size, 0);
        assert.deepEqual(result, {
            data: {
                fld_ack: 'Same',
                fld_committed: '',
                fld_append: 'A',
                fld_quantity: 1,
            },
            dirtyFieldIds: ['fld_append', 'fld_quantity', 'fld_append'],
        });
    });

    it('propagates comparison errors without mutating the input records or applying a partial result', () => {
        const submittedData = Object.freeze({ fld_text: 'Start' });
        const latestData = Object.freeze({ fld_text: 'Latest' });
        const serverData = Object.freeze({ fld_text: 'Returned' });
        const error = new Error('Comparison failed');
        assert.throws(
            () =>
                reconcileFormComputeResult(
                    input({
                        submittedData,
                        latestData,
                        latestDirtyFieldIds: Object.freeze(['fld_text']),
                        serverData,
                        areValuesEquivalent: () => {
                            throw error;
                        },
                    })
                ),
            (caught) => caught === error
        );
        assert.deepEqual(submittedData, { fld_text: 'Start' });
        assert.deepEqual(latestData, { fld_text: 'Latest' });
        assert.deepEqual(serverData, { fld_text: 'Returned' });
    });

    it('leaves owner rechecks with the caller when comparison has effects', () => {
        let currentOwner = 'Original visitor';
        const acceptedOwner = currentOwner;
        const result = reconcileFormComputeResult(
            input({
                submittedData: { fld_text: 'Submitted' },
                latestData: { fld_text: 'Submitted' },
                latestDirtyFieldIds: ['fld_text'],
                serverData: { fld_text: 'Returned' },
                areValuesEquivalent: (latest, start) => {
                    currentOwner = 'Replacement visitor';
                    return latest === start;
                },
            })
        );
        assert.deepEqual(result, {
            data: { fld_text: 'Submitted' },
            dirtyFieldIds: [],
        });
        assert.notEqual(currentOwner, acceptedOwner);
    });
});
