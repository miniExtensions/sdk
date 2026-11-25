import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import {
    BorrowedFormLinkedChildEditDialog,
    type BorrowedFormLinkedChildEditOwner,
    type BorrowedFormLinkedChildEditRef,
    type BorrowedFormLinkedChildEditSnapshot,
} from '../src/react/FormLinkedChildCreateDialog.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

async function fixture(t: TestContext, truncateTitle = false) {
    const dom = await htmlPresentationFixture(t);
    const doc = dom.window.document;
    const opener = doc.createElement('button');
    opener.style.visibility = 'visible';
    Object.defineProperty(opener, 'getClientRects', { value: () => [{}] });
    doc.body.append(opener);

    let identity = {};
    let current = true;
    let revision = 0;
    let currentValue = 'Stored title';
    let snapshot: BorrowedFormLinkedChildEditSnapshot = {
        ref: { opening: identity, revision },
        phase: 'presented',
        dirty: false,
        canDismiss: true,
    };
    const subscribers = new Set<() => void>();
    const closes: BorrowedFormLinkedChildEditRef[] = [];
    let childSaves = 0;
    let parentSaves = 0;
    const notify = () => {
        for (const listener of subscribers) listener();
    };
    const settle = (phase: 'closed' | 'retired') => {
        snapshot = { ref: snapshot.ref, phase };
        notify();
    };
    const owner: BorrowedFormLinkedChildEditOwner = {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        dismiss(ref) {
            assert.equal(ref, snapshot.ref);
            closes.push(ref);
            settle('closed');
            return 'closed';
        },
    };
    const render = () => {
        const renderedIdentity = identity;
        const opening = {
            identity: renderedIdentity,
            opener: opener as unknown as HTMLButtonElement,
            isCurrent: () => current && renderedIdentity === identity,
        };
        return dom.render(
            h(
                'div',
                { onSubmit: () => parentSaves++ },
                h(BorrowedFormLinkedChildEditDialog, {
                    owner,
                    opening,
                    truncateTitle,
                    labels: {
                        title: 'Native Edit',
                        keepEditing: 'Cancel',
                        confirmClose: 'Confirm',
                    },
                    children: h(
                        'form',
                        {
                            onSubmit(event) {
                                event.preventDefault();
                                childSaves++;
                                settle('closed');
                            },
                        },
                        h('input', {
                            'aria-label': 'Native title',
                            value: currentValue,
                            readOnly: true,
                        }),
                        h('button', { type: 'submit' }, 'Native Save')
                    ),
                })
            )
        );
    };
    const edit = (value: string) => {
        currentValue = value;
        snapshot = {
            ref: { opening: identity, revision: ++revision },
            phase: 'presented',
            dirty: true,
            canDismiss: true,
        };
    };
    const button = (label: string) => {
        const value = [...doc.querySelectorAll('dialog button')].find(
            (node) => node.textContent === label
        );
        assert(value);
        return value as unknown as HTMLButtonElement;
    };
    const publishEdit = async (value: string) => {
        edit(value);
        await render();
        await act(async () => notify());
    };
    opener.focus();
    await render();
    return {
        doc,
        opener,
        button,
        edit,
        publishEdit,
        render,
        closes,
        replaceOpening: async () => {
            identity = {};
            edit('Successor draft');
            await render();
            await act(async () => notify());
        },
        retire: async () => {
            current = false;
            await act(async () => settle('retired'));
        },
        saves: () => ({ childSaves, parentSaves }),
    };
}

it('sizes the optional caption separately and keeps the dialog name and initial Close', async (t) => {
    const f = await fixture(t, true);
    const dialog = f.doc.querySelector('dialog')!;
    const heading = dialog.querySelector('h2')!;
    const caption = heading.querySelector(
        '.mx-sdk-linked-child-create__title-text'
    )!;
    assert.equal(caption.textContent, 'Native Edit');
    assert.equal(caption.getAttribute('title'), 'Native Edit');
    assert.equal(dialog.getAttribute('aria-labelledby'), heading.id);
    assert.equal(f.doc.activeElement, f.button('Close'));
});

it('borrows Close and retains the native single form and Save', async (t) => {
    const f = await fixture(t);
    assert.equal(f.doc.querySelectorAll('dialog form').length, 1);
    assert.equal(
        f.doc.querySelectorAll('dialog button[type="submit"]').length,
        1
    );

    await f.publishEdit('Retained draft');
    await act(async () => f.button('Close').click());
    assert.equal(f.doc.activeElement, f.button('Cancel'));
    await act(async () => f.button('Cancel').click());
    assert.equal(f.doc.activeElement, f.button('Close'));
    assert.equal(
        f.doc.querySelector('dialog input')?.getAttribute('value'),
        'Retained draft'
    );
    assert.equal(f.closes.length, 0);
    assert.deepEqual(f.saves(), { childSaves: 0, parentSaves: 0 });

    await act(async () => f.button('Native Save').click());
    assert.deepEqual(f.saves(), { childSaves: 1, parentSaves: 0 });
    assert.equal(f.closes.length, 0);
    assert.equal(f.doc.querySelector('dialog'), null);
    assert.equal(f.doc.activeElement, f.opener);
});

it('refuses a dirty Close decision from an older native revision', async (t) => {
    const f = await fixture(t);
    await f.publishEdit('First draft');
    await act(async () => f.button('Close').click());
    const stale = f.button('Confirm');
    f.edit('Newer draft');
    await act(async () => stale.click());
    assert.equal(f.closes.length, 0);

    await f.render();
    await act(async () => f.button('Close').click());
    await act(async () => f.button('Confirm').click());
    assert.equal(f.closes.length, 1);
    assert.equal(f.closes[0].revision, 2);
    assert.equal(f.doc.querySelector('dialog'), null);
    assert.equal(f.doc.activeElement, f.opener);
    assert.deepEqual(f.saves(), { childSaves: 0, parentSaves: 0 });
});

it('does not refocus the opener on retirement', async (t) => {
    const f = await fixture(t);
    await f.retire();
    assert.equal(f.doc.querySelector('dialog'), null);
    assert.notEqual(f.doc.activeElement, f.opener);
    assert.equal(f.closes.length, 0);
});

it('remounts controls when a successor opening replaces the current one', async (t) => {
    const f = await fixture(t);
    const previousClose = f.button('Close');
    await f.replaceOpening();
    assert.notEqual(f.button('Close'), previousClose);
    await act(async () => previousClose.click());
    assert.equal(f.closes.length, 0);
    assert.equal(
        f.doc.querySelector('dialog input')?.getAttribute('value'),
        'Successor draft'
    );
});
