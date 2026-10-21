import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    getCollaboratorSelectionPresentation,
    removeCollaboratorSelection,
} from '../src/ui/index.js';

it('opens an empty editable selector and hides it for one single selection', () => {
    assert.deepEqual(
        getCollaboratorSelectionPresentation({
            selectedCount: 0,
            readOnly: false,
            limitToOneSelection: true,
        }),
        { showSelector: true, showEmpty: false, canRemove: true }
    );
    assert.deepEqual(
        getCollaboratorSelectionPresentation({
            selectedCount: 1,
            readOnly: false,
            limitToOneSelection: true,
        }),
        { showSelector: false, showEmpty: false, canRemove: true }
    );
});

it('keeps multi selection open and preserves the existing overfull single presentation', () => {
    for (const limitToOneSelection of [undefined, false, true]) {
        assert.deepEqual(
            getCollaboratorSelectionPresentation({
                selectedCount: 2,
                readOnly: false,
                limitToOneSelection,
            }),
            { showSelector: true, showEmpty: false, canRemove: true }
        );
    }
});

it('hides all edits in read-only mode and exposes only the empty-state admission', () => {
    for (const selectedCount of [0, 1, 2]) {
        assert.deepEqual(
            getCollaboratorSelectionPresentation({
                selectedCount,
                readOnly: true,
                limitToOneSelection: true,
            }),
            {
                showSelector: false,
                showEmpty: selectedCount === 0,
                canRemove: false,
            }
        );
    }
});

it('removes every matching ID while preserving duplicate lookup neighbors and native identity', () => {
    const first = Object.freeze({ id: 'usrFirst', name: 'Same label' });
    const duplicate = Object.freeze({ id: 'usrFirst', name: 'Lookup copy' });
    const neighbor = Object.freeze({
        id: 'usrNeighbor',
        name: 'Same label',
        email: 'neighbor@example.invalid',
        extraNativeMetadata: { retained: true },
    });
    const selected = Object.freeze([first, neighbor, duplicate, neighbor]);
    const remaining = removeCollaboratorSelection(selected, first.id);
    assert.deepEqual(remaining, [neighbor, neighbor]);
    assert.equal(remaining[0], neighbor);
    assert.equal(remaining[1], neighbor);
    assert.equal(selected.length, 4);
    assert.equal(selected[0], first);
    assert.equal(selected[2], duplicate);
});

it('keeps unknown removals, empty values and ID collisions literal without validation or lookup', () => {
    const selected = Object.freeze([
        Object.freeze({ id: '', name: 'Empty native ID' }),
        Object.freeze({ id: '__proto__', name: 'Literal native ID' }),
    ]);
    assert.deepEqual(
        removeCollaboratorSelection(selected, 'missing'),
        selected
    );
    assert.equal(removeCollaboratorSelection(selected, '')[0], selected[1]);
    assert.equal(
        removeCollaboratorSelection(selected, '__proto__')[0],
        selected[0]
    );
    assert.deepEqual(removeCollaboratorSelection([], 'missing'), []);
});
