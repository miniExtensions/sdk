import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    FormDraftStore,
    type FormDraftScope,
} from '../examples/browser/src/drafts.js';

type Attachment = { url: string; filename: string; size: number };
type Value = string | null | Attachment[];
const scope: FormDraftScope = {
    extensionId: 'form_example',
    recordId: null,
    parent: null,
};
const upload: Attachment = {
    url: 'https://files.example/uploaded-note.txt',
    filename: 'uploaded-note.txt',
    size: 17,
};

describe('browser example Form drafts', () => {
    it('reconstructs edited fields, completed uploads, and loaded prefills after leaving the screen', () => {
        const visitor = new FormDraftStore<Value>();
        const baseline = {
            title: 'Original title',
            hiddenParent: 'parent_record',
            attachment: [],
        };
        const draft = visitor.open(scope, baseline, ['hiddenParent']);
        visitor.write(draft, 'title', 'Visitor A unsaved draft');
        visitor.write(draft, 'attachment', [upload]);

        // The renderer is reconstructed from the original server payload.
        const restored = visitor.open(scope, baseline, ['hiddenParent']);
        assert.deepEqual(visitor.snapshot(restored), {
            data: {
                title: 'Visitor A unsaved draft',
                hiddenParent: 'parent_record',
                attachment: [upload],
            },
            dirtyFieldIds: ['hiddenParent', 'title', 'attachment'],
        });
        assert.deepEqual(baseline, {
            title: 'Original title',
            hiddenParent: 'parent_record',
            attachment: [],
        });
    });

    it('keeps visitor, record, and parent Portal field drafts independent', () => {
        const a = new FormDraftStore<Value>();
        const b = new FormDraftStore<Value>();
        const recordA = { ...scope, recordId: 'record_a' };
        const recordB = { ...scope, recordId: 'record_b' };
        const parent = {
            portalId: 'portal_example',
            recordId: 'portal_user',
            portalFieldId: 'projects_field',
        };
        const firstChildScope = { ...scope, parent };
        const secondChildScope = {
            ...scope,
            parent: { ...parent, portalFieldId: 'tasks_field' },
        };
        a.write(
            a.open(recordA, { title: 'Original' }, []),
            'title',
            'A record A draft'
        );
        a.write(
            a.open(recordB, { title: 'Original' }, []),
            'title',
            'A record B draft'
        );
        b.write(
            b.open(recordA, { title: 'Original' }, []),
            'title',
            'B record A draft'
        );
        a.write(
            a.open(firstChildScope, { title: null }, []),
            'title',
            'Project draft'
        );
        a.write(
            a.open(secondChildScope, { title: null }, []),
            'title',
            'Task draft'
        );

        assert.equal(
            a.read(a.open(recordA, {}, []), 'title'),
            'A record A draft'
        );
        assert.equal(
            a.read(a.open(recordB, {}, []), 'title'),
            'A record B draft'
        );
        assert.equal(
            b.read(b.open(recordA, {}, []), 'title'),
            'B record A draft'
        );
        assert.equal(
            a.read(a.open(firstChildScope, {}, []), 'title'),
            'Project draft'
        );
        assert.equal(
            a.read(a.open(secondChildScope, {}, []), 'title'),
            'Task draft'
        );
    });

    it('retains newly created select choice metadata and its unsaved selection', () => {
        const visitor = new FormDraftStore<Value>();
        const draft = visitor.open(scope, { category: null }, []);
        const choice = {
            id: 'choice_example',
            name: 'New choice',
            color: 'blueLight2',
            newOption: true,
        };
        visitor.addChoice(draft, 'category', choice);
        visitor.write(draft, 'category', choice.name);

        const restored = visitor.open(scope, { category: null }, []);
        assert.equal(visitor.read(restored, 'category'), 'New choice');
        assert.deepEqual(visitor.choices(restored, 'category'), [choice]);
        assert.deepEqual(visitor.snapshot(restored)?.dirtyFieldIds, [
            'category',
        ]);
    });

    it('discards only the saved or explicitly discarded Form and rejects its old asynchronous handle', () => {
        const visitor = new FormDraftStore<Value>();
        const first = visitor.open(
            { ...scope, recordId: 'record_a' },
            { title: 'A original' },
            []
        );
        const second = visitor.open(
            { ...scope, recordId: 'record_b' },
            { title: 'B original' },
            []
        );
        visitor.write(first, 'title', 'A draft');
        visitor.write(second, 'title', 'B draft');
        visitor.discard(first);
        const replacement = visitor.open(
            { ...scope, recordId: 'record_a' },
            { title: 'A saved' },
            []
        );

        assert.equal(visitor.write(first, 'attachment', [upload]), false);
        assert.equal(
            visitor.addChoice(first, 'category', {
                id: 'late_choice',
                name: 'Late choice',
            }),
            false
        );
        assert.deepEqual(visitor.snapshot(replacement), {
            data: { title: 'A saved' },
            dirtyFieldIds: [],
        });
        assert.equal(visitor.read(second, 'title'), 'B draft');
        visitor.discard(first);
        assert.equal(visitor.read(replacement, 'title'), 'A saved');
    });

    it('clears a replaced session or connection without accepting an old upload completion', async () => {
        const visitor = new FormDraftStore<Value>();
        const old = visitor.open(scope, { title: 'Old screen' }, []);
        let finishUpload: (value: Value) => void = () => {
            throw new Error('Upload not started.');
        };
        const pendingUpload = new Promise<Value>((resolve) => {
            finishUpload = resolve;
        });
        const completion = pendingUpload.then((attachment) =>
            visitor.write(old, 'attachment', attachment)
        );
        visitor.write(old, 'title', 'Old unsaved draft');
        visitor.clear();
        const fresh = visitor.open(scope, { title: 'New session screen' }, []);
        finishUpload([upload]);

        assert.equal(await completion, false);
        assert.deepEqual(visitor.snapshot(fresh), {
            data: { title: 'New session screen' },
            dirtyFieldIds: [],
        });
        assert.equal(visitor.snapshot(old), null);
    });

    it('copies native values and schema metadata so callers cannot mutate another render or the save baseline', () => {
        const visitor = new FormDraftStore<Value>();
        const initial = { attachment: [upload] };
        const draft = visitor.open(scope, initial, []);
        const selected: Attachment[] = [
            { ...upload, filename: 'selected.txt' },
        ];
        visitor.write(draft, 'attachment', selected);
        selected[0].filename = 'external mutation.txt';
        const values = visitor.snapshot(draft);
        if (values == null || !Array.isArray(values.data.attachment))
            throw new Error('Expected a native attachment draft.');
        values.data.attachment[0].filename = 'snapshot mutation.txt';
        const choice = { id: 'choice_example', name: 'Created choice' };
        visitor.addChoice(draft, 'category', choice);
        choice.name = 'external choice mutation';
        visitor.choices(draft, 'category')[0].name = 'snapshot choice mutation';

        assert.deepEqual(visitor.read(draft, 'attachment'), [
            { ...upload, filename: 'selected.txt' },
        ]);
        assert.deepEqual(visitor.choices(draft, 'category'), [
            { id: 'choice_example', name: 'Created choice' },
        ]);
        assert.deepEqual(initial, { attachment: [upload] });
    });
});
