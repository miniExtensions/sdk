import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import {
    BorrowedFormLinkedChildCreateDialog,
    type BorrowedFormLinkedChildCreateOwner,
    type BorrowedFormLinkedChildCreateRef,
    type BorrowedFormLinkedChildCreateSaveOutcome,
    type BorrowedFormLinkedChildCreateSnapshot,
} from '../src/react/FormLinkedChildCreateDialog.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const saved = {
    type: 'saved',
    recordId: 'rec_child',
    link: 'linked',
} as const;

async function fixture(
    t: TestContext,
    send: (
        ref: BorrowedFormLinkedChildCreateRef
    ) => Promise<BorrowedFormLinkedChildCreateSaveOutcome> = async () => saved
) {
    const dom = await htmlPresentationFixture(t);
    const doc = dom.window.document;
    const opener = doc.createElement('button');
    opener.style.visibility = 'visible';
    Object.defineProperty(opener, 'getClientRects', { value: () => [{}] });
    doc.body.append(opener);
    const openerElement = opener as unknown as HTMLButtonElement;
    const listeners = new Set<() => void>();
    let identity = {};
    let state: BorrowedFormLinkedChildCreateSnapshot<string> = {
        ref: { opening: identity, revision: 0 },
        phase: 'ready',
        fields: '',
        dirty: false,
        error: null,
        outcome: null,
    };
    const publish = (next: BorrowedFormLinkedChildCreateSnapshot<string>) => {
        state = next;
        for (const notify of listeners) notify();
    };
    const saves: BorrowedFormLinkedChildCreateRef[] = [];
    const closes: BorrowedFormLinkedChildCreateRef[] = [];
    const owner: BorrowedFormLinkedChildCreateOwner<string> = {
        getSnapshot: () => state,
        subscribe(notify) {
            listeners.add(notify);
            return () => listeners.delete(notify);
        },
        async save(expected) {
            saves.push(expected);
            assert.equal(expected, state.ref);
            publish({ ...state, phase: 'saving' });
            const outcome = await send(expected);
            if (expected.opening === identity)
                publish({
                    ...state,
                    outcome,
                    phase:
                        outcome.type === 'saved'
                            ? 'saved'
                            : outcome.type === 'unknown'
                              ? 'unknown'
                              : 'ready',
                    error:
                        outcome.type === 'rejected'
                            ? 'Native validation error'
                            : null,
                });
            return outcome;
        },
        dismiss(expected) {
            closes.push(expected);
            assert.equal(expected, state.ref);
            publish({ ...state, phase: 'closed' });
            return 'closed';
        },
    };
    const render = () => {
        const opening = identity;
        return dom.render(
            h(BorrowedFormLinkedChildCreateDialog<string>, {
                owner,
                opening: {
                    identity: opening,
                    opener: openerElement,
                    isCurrent: () => opening === identity,
                },
                renderFields: (value) =>
                    h('input', {
                        value,
                        readOnly: true,
                        'aria-label': 'Native child',
                    }),
            })
        );
    };
    const dialog = () => doc.querySelector('dialog');
    const button = (name: string) => {
        const result = [...(dialog()?.querySelectorAll('button') ?? [])].find(
            (control) => control.textContent === name
        );
        assert(result, `Expected ${name}`);
        return result;
    };
    const edit = (value: string) =>
        act(async () =>
            publish({
                ...state,
                ref: { opening: identity, revision: state.ref.revision + 1 },
                fields: value,
                dirty: true,
            })
        );
    const replace = (staleControl?: { click(): void }) =>
        act(async () => {
            identity = {};
            staleControl?.click();
            publish({
                ref: { opening: identity, revision: 0 },
                phase: 'ready',
                fields: 'Successor draft',
                dirty: false,
                error: null,
                outcome: null,
            });
            await render();
        });
    return {
        ...dom,
        doc,
        opener,
        dialog,
        button,
        edit,
        render,
        replace,
        saves,
        closes,
        read: () => state,
    };
}

it('borrows the native dirty fields and confirms Close exactly once', async (t) => {
    const f = await fixture(t);
    f.opener.focus();
    await f.render();
    assert(f.dialog()?.open);
    await f.edit('Keep this draft');
    await f.click(f.button('Close'));
    assert.equal(f.dialog()?.querySelectorAll('[role=alert]').length, 1);
    assert.equal(f.doc.activeElement, f.button('Keep editing'));
    await f.click(f.button('Keep editing'));
    assert.equal(f.dialog()?.querySelector('input')?.value, 'Keep this draft');
    assert.deepEqual(f.closes, []);
    await f.click(f.button('Close'));
    await f.click(f.button('Close without saving'));
    assert.equal(f.closes.length, 1);
    assert.equal(f.dialog(), null);
    assert.equal(f.doc.activeElement, f.opener);
    assert.deepEqual(f.saves, []);
});

it('retires a captured confirmation and Save control when the opening changes', async (t) => {
    const f = await fixture(t);
    await f.render();
    await f.edit('Old draft');
    const oldSave = f.button('Save');
    await f.click(f.button('Close'));
    await f.replace(f.button('Close without saving'));
    assert.deepEqual(f.closes, []);
    assert.equal(oldSave.isConnected, false);
    await f.click(oldSave);
    assert.deepEqual(f.saves, []);
    assert.equal(f.dialog()?.querySelector('input')?.value, 'Successor draft');
    assert.notEqual(f.doc.activeElement, f.opener);
    const expected = f.read().ref;
    await f.click(f.button('Save'));
    assert.deepEqual(f.saves, [expected]);
    assert.equal(f.doc.activeElement, f.opener);
});

it('keeps a held Save with its original opening and releases the successor latch', async (t) => {
    let settle!: (outcome: BorrowedFormLinkedChildCreateSaveOutcome) => void;
    const held = new Promise<BorrowedFormLinkedChildCreateSaveOutcome>(
        (resolve) => {
            settle = resolve;
        }
    );
    let sends = 0;
    const f = await fixture(t, async () => (++sends === 1 ? held : saved));
    await f.render();
    const first = f.read().ref;
    const save = f.button('Save');
    await act(async () => {
        save.click();
        save.click();
    });
    assert.deepEqual(f.saves, [first]);
    assert.equal(f.button('Close').disabled, true);
    await f.replace();
    const current = f.read().ref;
    const close = f.button('Close');
    assert.equal(f.doc.activeElement, close);
    await act(async () => settle({ ...saved, link: 'superseded' }));
    assert.equal(f.doc.activeElement, close);
    assert.equal(f.read().phase, 'ready');
    await f.click(f.button('Save'));
    assert.deepEqual(f.saves, [first, current]);
});

it('shows native rejection and retains the unresolved attempt through Close', async (t) => {
    const unknown = { type: 'unknown', attemptId: 'attempt_child' } as const;
    let sends = 0;
    const f = await fixture(t, async () =>
        ++sends === 1 ? { type: 'rejected' } : unknown
    );
    await f.render();
    await f.edit('Review the child draft');
    await f.click(f.button('Save'));
    assert.match(f.dialog()?.textContent ?? '', /Native validation error/);
    await f.click(f.button('Save'));
    assert.equal(f.button('Save').disabled, true);
    assert.equal(f.button('Close').disabled, false);
    assert.equal(f.saves.length, 2);
    await f.click(f.button('Close'));
    await f.click(f.button('Close without saving'));
    assert.equal(f.closes.length, 1);
    assert.deepEqual(f.read().outcome, unknown);
    assert.equal(f.doc.activeElement, f.opener);
});
