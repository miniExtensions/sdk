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
    requestStartData: {},
    latestData: {},
    latestDirtyFieldIds: [],
    serverData: {},
    conditionallyHiddenDirtyFieldIds: new Set(),
    addOnlyTextFieldIds: new Set(),
    areValuesEquivalent: isDeepStrictEqual,
    ...overrides,
});

describe('accepted Form compute reconciliation', () => {
    it('keeps committed frontend bytes and server-only computed values without mutating frozen inputs', () => {
        const requestStartData = Object.freeze({
            fld_text: '  Submitted\n\ntext  ',
            fld_number: 0,
            fld_flag: false,
            fld_blank: null,
        });
        const latestData = Object.freeze({ ...requestStartData });
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
                    requestStartData,
                    latestData,
                    latestDirtyFieldIds,
                    serverData,
                    conditionallyHiddenDirtyFieldIds: Object.freeze(
                        new Set<string>()
                    ),
                    addOnlyTextFieldIds: Object.freeze(new Set<string>()),
                })
            )
        );
        assert.deepEqual(result, {
            data: { ...requestStartData, fld_computed: 42 },
            dirtyFieldIds: [],
        });
        assert.notEqual(result.data, serverData);
        Object.assign(result.data, { fld_text: 'Detached result' });
        assert.equal(serverData.fld_text, 'Submitted\ntext');
        assert.equal(requestStartData.fld_text, '  Submitted\n\ntext  ');
        assert.deepEqual(latestDirtyFieldIds, Object.keys(latestData));
    });

    it('retains hidden, unsubmitted and changed values in ordered dirty IDs, including duplicates', () => {
        const comparisons: [
            AirtableValue | undefined,
            AirtableValue | undefined,
        ][] = [];
        const result = reconcileFormComputeResult(
            input({
                requestStartData: {
                    fld_hidden: 'Hidden before',
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
                conditionallyHiddenDirtyFieldIds: new Set(['fld_hidden']),
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
            [2, 1],
        ]);
    });

    it('clears only committed add-only text and keeps newer, hidden and unsubmitted entries', () => {
        const result = reconcileFormComputeResult(
            input({
                requestStartData: {
                    fld_committed: 'Append this',
                    fld_changed: 'Earlier append',
                    fld_hidden: 'Hidden append',
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
                conditionallyHiddenDirtyFieldIds: new Set(['fld_hidden']),
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
                requestStartData: { fld_files: attachments },
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
        const lookup = [null, false, { text: 'lookup code' }];
        const result = reconcileFormComputeResult(
            input({
                requestStartData: {
                    fld_links: ['rec_existing'],
                    fld_barcode: { text: '0088', type: 'code128' },
                    fld_lookup: [null],
                },
                latestData: {
                    fld_links: links,
                    fld_barcode: barcode,
                    fld_lookup: lookup,
                },
                latestDirtyFieldIds: ['fld_links', 'fld_barcode', 'fld_lookup'],
                serverData: {},
            })
        );
        assert.equal(result.data.fld_links, links);
        assert.equal(result.data.fld_barcode, barcode);
        assert.equal(result.data.fld_lookup, lookup);
        assert.deepEqual(result.dirtyFieldIds, [
            'fld_links',
            'fld_barcode',
            'fld_lookup',
        ]);
    });

    it('uses the explicit cosmetic equivalence policy and restores submitted bytes, not the latest spelling', () => {
        const requestStartValue = 'Line one\n\nLine two';
        const latestValue = 'Line one\r\n\r\nLine two  ';
        let comparisons = 0;
        const result = reconcileFormComputeResult(
            input({
                requestStartData: { fld_rich: requestStartValue },
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

    it('does not derive dirty state from untracked latest values', () => {
        const result = reconcileFormComputeResult(
            input({
                requestStartData: { fld_submitted: 'Submitted' },
                latestData: {
                    fld_submitted: 'Untracked change',
                    fld_untracked: 'Local only',
                },
                serverData: {
                    fld_submitted: 'Server',
                    fld_untracked: 'Server only',
                },
                areValuesEquivalent: () => {
                    assert.fail('No dirty fields require comparison');
                },
            })
        );
        assert.deepEqual(result, {
            data: { fld_submitted: 'Submitted', fld_untracked: 'Server only' },
            dirtyFieldIds: [],
        });
    });

    it('copies a server-only response even when there are no submitted or dirty fields', () => {
        const files = [{ url: 'https://example.test/persisted' }];
        const serverData = { fld_files: files, fld_formula: 3 };
        const result = reconcileFormComputeResult(input({ serverData }));
        assert.notEqual(result.data, serverData);
        assert.equal(result.data.fld_files, files);
        assert.deepEqual(result, { data: serverData, dirtyFieldIds: [] });
    });

    it('retains a missing latest dirty value without coercion', () => {
        const result = reconcileFormComputeResult(
            input({
                latestDirtyFieldIds: ['fld_new'],
                serverData: { fld_new: 'Old server value' },
                areValuesEquivalent: () => {
                    assert.fail('An unsubmitted field is retained directly');
                },
            })
        );
        assert.equal(Object.hasOwn(result.data, 'fld_new'), true);
        assert.equal(result.data.fld_new, undefined);
        assert.deepEqual(result.dirtyFieldIds, ['fld_new']);
    });

    it('preserves inherited request presence while restoring committed own keys only', () => {
        const requestStartData: Record<string, AirtableValue> = Object.create({
            fld_inherited: 'Submitted inherited value',
        });
        requestStartData.fld_own = 'Own value';
        const comparisons: (AirtableValue | undefined)[] = [];
        const result = reconcileFormComputeResult(
            input({
                requestStartData,
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
        assert.deepEqual(comparisons, [
            'Submitted inherited value',
            'Own value',
        ]);
        assert.deepEqual(result, {
            data: {
                fld_inherited: 'Returned inherited value',
                fld_own: 'Own value',
            },
            dirtyFieldIds: [],
        });
        assert.equal(Object.hasOwn(requestStartData, 'fld_inherited'), false);
    });

    it('copies special own keys as data without changing the result prototype', () => {
        const requestStartData = Object.fromEntries([
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
                requestStartData,
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

    it('propagates comparison errors without mutating the input records or applying a partial result', () => {
        const requestStartData = Object.freeze({ fld_text: 'Start' });
        const latestData = Object.freeze({ fld_text: 'Latest' });
        const serverData = Object.freeze({ fld_text: 'Returned' });
        const error = new Error('Comparison failed');
        assert.throws(
            () =>
                reconcileFormComputeResult(
                    input({
                        requestStartData,
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
        assert.deepEqual(requestStartData, { fld_text: 'Start' });
        assert.deepEqual(latestData, { fld_text: 'Latest' });
        assert.deepEqual(serverData, { fld_text: 'Returned' });
    });

    it('leaves owner rechecks with the caller when comparison has effects', () => {
        let currentOwner = 'Original visitor';
        const acceptedOwner = currentOwner;
        const result = reconcileFormComputeResult(
            input({
                requestStartData: { fld_text: 'Submitted' },
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
