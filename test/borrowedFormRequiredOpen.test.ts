import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    projectBorrowedFormRequiredOpenDebt,
    resolveBorrowedFormRequiredOpenCredit,
    type BorrowedFormRequiredOpenField,
    type BorrowedFormRequiredOpenFrame,
    type BorrowedFormRequiredOpenPresentation,
} from '../src/forms/index.js';

function field(
    fieldId: string,
    selectedRecordIds: readonly string[],
    reviewedRecordIds: readonly string[] = []
): BorrowedFormRequiredOpenField {
    return { fieldId, selectedRecordIds, reviewedRecordIds };
}

function presentation(
    parentOwner: object,
    fieldId: string,
    recordId: string,
    envelope: object
): BorrowedFormRequiredOpenPresentation {
    return { kind: 'edit', parentOwner, fieldId, recordId, envelope };
}

test('projects current ordered selections against native field-specific history', () => {
    const reviewed = Object.freeze(['A']);
    const selected = Object.freeze(['B', 'A', 'C']);
    assert.deepEqual(
        projectBorrowedFormRequiredOpenDebt([
            field('projects', selected, reviewed),
            field('related', ['A']),
            field('empty', []),
        ]),
        { projects: ['B', 'C'], related: ['A'], empty: [] }
    );
    // Unlink and reselect reads the same native history. A fresh parent owns a
    // different history even if its selected record and field are identical.
    assert.deepEqual(
        projectBorrowedFormRequiredOpenDebt([field('projects', [], reviewed)]),
        { projects: [] }
    );
    assert.deepEqual(
        projectBorrowedFormRequiredOpenDebt([
            field('projects', ['A'], reviewed),
        ]),
        { projects: [] }
    );
    assert.deepEqual(
        projectBorrowedFormRequiredOpenDebt([field('projects', ['A'])]),
        { projects: ['A'] }
    );
});

test('accepts only the exact mounted Edit receipt for the current native parent and field', () => {
    const parentOwner = {};
    const itemA = presentation(parentOwner, 'projects', 'A', {
        type: 'success',
    });
    // Native can mount a nonnull error envelope. Its presentation is the
    // witness here, independent of whether the child has an editable draft.
    const itemB = presentation(parentOwner, 'projects', 'B', { type: 'error' });
    const fields = [field('projects', ['A', 'B']), field('related', ['A'])];
    const pending: BorrowedFormRequiredOpenFrame = {
        parentOwner,
        fields,
        currentPresentation: null,
    };
    assert.equal(resolveBorrowedFormRequiredOpenCredit(pending, itemB), null);

    const mountedA = { ...pending, currentPresentation: itemA };
    assert.equal(
        resolveBorrowedFormRequiredOpenCredit(mountedA, { ...itemA }),
        null
    );
    assert.deepEqual(resolveBorrowedFormRequiredOpenCredit(mountedA, itemA), {
        fieldId: 'projects',
        recordId: 'A',
    });

    // The reducer appends A to its own history before B mounts.
    const afterA = {
        ...pending,
        fields: [field('projects', ['A', 'B'], ['A']), fields[1]!],
    };
    assert.deepEqual(projectBorrowedFormRequiredOpenDebt(afterA.fields), {
        projects: ['B'],
        related: ['A'],
    });
    assert.equal(
        resolveBorrowedFormRequiredOpenCredit(
            { ...afterA, currentPresentation: itemA },
            itemA
        ),
        null
    );
    assert.deepEqual(
        resolveBorrowedFormRequiredOpenCredit(
            { ...afterA, currentPresentation: itemB },
            itemB
        ),
        { fieldId: 'projects', recordId: 'B' }
    );
});

test('refuses a replaced parent, replacement mount, hidden or unselected record', () => {
    const parentOwner = {};
    const initial = presentation(parentOwner, 'projects', 'A', {});
    const repaired = presentation(parentOwner, 'projects', 'A', {});
    const current = {
        parentOwner,
        fields: [field('projects', ['A'])],
        currentPresentation: repaired,
    };
    assert.equal(resolveBorrowedFormRequiredOpenCredit(current, initial), null);
    assert.equal(
        resolveBorrowedFormRequiredOpenCredit(
            { ...current, parentOwner: {} },
            repaired
        ),
        null
    );
    assert.equal(
        resolveBorrowedFormRequiredOpenCredit(
            { ...current, fields: [] },
            repaired
        ),
        null
    );
    assert.equal(
        resolveBorrowedFormRequiredOpenCredit(
            { ...current, fields: [field('projects', ['B'])] },
            repaired
        ),
        null
    );
});

test('refuses invalid native input and create or absent envelopes', () => {
    assert.equal(
        projectBorrowedFormRequiredOpenDebt([
            field('duplicate', []),
            field('duplicate', ['A']),
        ]),
        null
    );
    assert.equal(projectBorrowedFormRequiredOpenDebt([field('x', [''])]), null);
    const sparse = new Array<string>(1);
    assert.equal(
        projectBorrowedFormRequiredOpenDebt([field('x', sparse)]),
        null
    );

    const parentOwner = {};
    const current = presentation(parentOwner, 'projects', 'A', {});
    for (const candidate of [
        { ...current, kind: 'create' },
        { ...current, envelope: null },
        { ...current, envelope: [] },
    ]) {
        const malformed = candidate as BorrowedFormRequiredOpenPresentation;
        assert.equal(
            resolveBorrowedFormRequiredOpenCredit(
                {
                    parentOwner,
                    fields: [field('projects', ['A'])],
                    currentPresentation: malformed,
                },
                malformed
            ),
            null
        );
    }
});
