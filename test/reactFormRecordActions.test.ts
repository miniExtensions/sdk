import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    createFormRecordActionsController,
    type FormRecordActionsFrame,
    type FormRecordActionsPort,
    type FormRecordDeleteOutcome,
} from '../src/forms/recordActions.js';
import {
    FormRecordActionsFooter,
    FormRecordActionsMenu,
    type FormRecordActionsLabels,
} from '../src/react/FormRecordActions.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const labels: FormRecordActionsLabels = {
    deleteRecord: 'Supprimer <enregistrement>',
    comments: 'Commentaires',
    openMenu: 'Options de cet enregistrement',
    confirmationTitle: 'Supprimer cet enregistrement ?',
    irreversibleWarning: 'Cette action est irréversible.',
    confirmDelete: 'Oui, supprimer',
    cancel: 'Annuler',
};

function editable(scope: object): FormRecordActionsFrame {
    return {
        scope,
        delete: { visible: true, disabled: false, pending: false },
        comments: { visible: true, disabled: false },
    };
}

function makeHost(initial: FormRecordActionsFrame | null) {
    let frame = initial;
    let beforeDelete: (() => void) | undefined;
    const changes = new Set<() => void>();
    const allocations: {
        scope: object;
        id: object;
        resolve(outcome: FormRecordDeleteOutcome): void;
        finished: Promise<FormRecordDeleteOutcome>;
    }[] = [];
    const comments: object[] = [];
    const port: FormRecordActionsPort = {
        // Simulate selectors that return a fresh but equivalent frame.
        read: () => frame && { ...frame },
        subscribe(changed) {
            changes.add(changed);
            return () => {
                changes.delete(changed);
            };
        },
        requestCurrentDelete() {
            beforeDelete?.();
            assert.ok(
                frame?.delete.visible &&
                    !frame.delete.disabled &&
                    !frame.delete.pending
            );
            const id = {};
            let resolve!: (outcome: FormRecordDeleteOutcome) => void;
            const settled = new Promise<FormRecordDeleteOutcome>((finish) => {
                resolve = finish;
            });
            allocations.push({
                scope: frame.scope,
                id,
                resolve,
                finished: settled,
            });
            return { status: 'allocated', operation: { id, settled } };
        },
        openCurrentComments() {
            assert.ok(frame?.comments.visible && !frame.comments.disabled);
            comments.push(frame.scope);
            return 'handed-off';
        },
    };
    const controller = createFormRecordActionsController(port);
    return {
        controller,
        allocations,
        comments,
        setFrame(next: FormRecordActionsFrame | null, publish = true) {
            frame = next;
            if (publish) for (const changed of changes) changed();
        },
        beforeDelete(callback: () => void) {
            beforeDelete = callback;
        },
        subscriptionCount: () => changes.size,
    };
}

function button(
    f: Awaited<ReturnType<typeof htmlPresentationFixture>>,
    label: string
) {
    const found = [...f.container.querySelectorAll('button')].find(
        (node) =>
            node.textContent === label ||
            node.getAttribute('aria-label') === label
    );
    assert.ok(found, `Missing button ${label}`);
    assert.equal(found.type, 'button');
    return found;
}

it('renders localized record actions in SSR without starting an interaction', () => {
    const host = makeHost(editable({}));
    const props = { controller: host.controller, labels };
    const html = renderToString(
        h('form', null, h(FormRecordActionsFooter, props))
    );
    assert.match(html, /Supprimer &lt;enregistrement&gt;/);
    assert.match(html, /type="button"/);
    assert.doesNotMatch(html, /<dialog/);
    assert.equal(host.subscriptionCount(), 0);
    assert.deepEqual(host.allocations, []);
    assert.deepEqual(host.comments, []);
});

it('opens a named warning with Cancel focused and dismisses without an allocation', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = makeHost(editable({}));
    await f.render(
        h(FormRecordActionsFooter, { controller: host.controller, labels })
    );
    const opener = button(f, labels.deleteRecord);
    assert.equal(f.container.querySelector('enregistrement'), null);
    for (const dismiss of ['cancel', 'escape', 'native-cancel', 'backdrop']) {
        opener.focus();
        await f.click(opener);
        const dialog = f.container.querySelector('dialog');
        assert.ok(dialog?.open);
        assert.equal(dialog.getAttribute('role'), 'alertdialog');
        assert.equal(
            f.window.document.getElementById(
                dialog.getAttribute('aria-labelledby') ?? ''
            )?.textContent,
            labels.confirmationTitle
        );
        assert.equal(
            f.window.document.getElementById(
                dialog.getAttribute('aria-describedby') ?? ''
            )?.textContent,
            labels.irreversibleWarning
        );
        const cancel = button(f, labels.cancel);
        assert.equal(f.window.document.activeElement, cancel);
        assert.ok(
            button(f, labels.confirmDelete).classList.contains(
                'mx-sdk-form-record-actions__danger'
            )
        );
        if (dismiss === 'cancel') await f.click(cancel);
        else if (dismiss === 'escape')
            await act(async () => {
                cancel.dispatchEvent(
                    new f.window.KeyboardEvent('keydown', {
                        bubbles: true,
                        cancelable: true,
                        key: 'Escape',
                    })
                );
            });
        else if (dismiss === 'native-cancel')
            await act(async () => {
                dialog.dispatchEvent(
                    new f.window.Event('cancel', { cancelable: true })
                );
            });
        else await f.click(dialog);
        assert.equal(f.container.querySelector('dialog'), null);
        assert.equal(f.window.document.activeElement, opener);
        assert.deepEqual(host.allocations, []);
    }
    f.unchangedEffects();
});

it('uses the current scope at confirmation, closes before admission and deduplicates reentry', async (t) => {
    const f = await htmlPresentationFixture(t);
    const old = {};
    const current = {};
    const host = makeHost(editable(old));
    await f.render(
        h(FormRecordActionsFooter, { controller: host.controller, labels })
    );
    await f.click(button(f, labels.deleteRecord));
    const opening = host.controller.getSnapshot().confirmation;
    assert.ok(opening);
    host.setFrame(editable(current), false);
    host.beforeDelete(() => {
        assert.equal(host.controller.getSnapshot().confirmation, null);
        host.controller.openDeleteConfirmation();
        host.controller.confirmDelete(opening);
    });
    await f.click(button(f, labels.confirmDelete));
    assert.equal(f.container.querySelector('dialog'), null);
    assert.deepEqual(
        host.allocations.map((operation) => operation.scope),
        [current]
    );
    assert.equal(button(f, labels.deleteRecord).disabled, true);
    assert.equal(
        button(f, labels.deleteRecord).getAttribute('aria-busy'),
        'true'
    );
    await f.click(button(f, labels.deleteRecord));
    assert.equal(host.allocations.length, 1);
    const operation = host.allocations[0];
    await act(async () =>
        operation.resolve({ status: 'unknown', operationId: operation.id })
    );
    assert.equal(button(f, labels.deleteRecord).disabled, false);
    assert.equal(host.allocations.length, 1);
    f.unchangedEffects();
});

it('refuses a retired scope at confirmation and ignores an older dialog identity', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = makeHost(editable({}));
    await f.render(
        h(FormRecordActionsFooter, { controller: host.controller, labels })
    );
    await f.click(button(f, labels.deleteRecord));
    const opening = host.controller.getSnapshot().confirmation;
    assert.ok(opening);
    host.setFrame(null, false);
    await f.click(button(f, labels.confirmDelete));
    assert.equal(f.container.querySelector('dialog'), null);
    assert.deepEqual(host.allocations, []);
    await act(async () => host.setFrame(editable({})));
    await f.click(button(f, labels.deleteRecord));
    host.controller.confirmDelete(opening);
    assert.ok(f.container.querySelector('dialog')?.open);
    await f.click(button(f, labels.cancel));
    assert.deepEqual(host.allocations, []);
});

it('the menu hands off only current comments and uses the same confirmation path', async (t) => {
    const f = await htmlPresentationFixture(t);
    const current = {};
    const host = makeHost(editable({}));
    await f.render(
        h(FormRecordActionsMenu, { controller: host.controller, labels })
    );
    const toggle = button(f, labels.openMenu);
    await f.click(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    host.setFrame(editable(current), false);
    await f.click(button(f, labels.comments));
    assert.deepEqual(host.comments, [current]);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(host.allocations, []);
    await f.click(toggle);
    await f.click(button(f, labels.deleteRecord));
    assert.equal(f.window.document.activeElement, button(f, labels.cancel));
    await f.click(button(f, labels.cancel));
    assert.equal(f.window.document.activeElement, toggle);
    assert.deepEqual(host.allocations, []);
    f.unchangedEffects();
});

it('leaves an allocated original operation with the host when the presentation unmounts', async (t) => {
    const f = await htmlPresentationFixture(t);
    const first = {};
    const host = makeHost(editable(first));
    await f.render(
        h(FormRecordActionsFooter, { controller: host.controller, labels })
    );
    await f.click(button(f, labels.deleteRecord));
    await f.click(button(f, labels.confirmDelete));
    const operation = host.allocations[0];
    assert.equal(operation.scope, first);
    await f.render(h('div'));
    assert.equal(host.subscriptionCount(), 0);
    host.setFrame(editable({}));
    operation.resolve({
        status: 'acknowledged',
        operationId: operation.id,
        localSettlement: 'retired',
    });
    assert.equal((await operation.finished).status, 'acknowledged');
    assert.equal(host.allocations.length, 1);
    f.unchangedEffects();
});

it('retires an unconfirmed opening when its presentation unmounts', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = makeHost(editable({}));
    const footer = h(FormRecordActionsFooter, {
        controller: host.controller,
        labels,
    });
    await f.render(footer);
    await f.click(button(f, labels.deleteRecord));
    const opening = host.controller.getSnapshot().confirmation;
    assert.ok(opening);
    await f.render(h('div'));
    host.controller.confirmDelete(opening);
    await f.render(footer);
    assert.equal(f.container.querySelector('dialog'), null);
    assert.deepEqual(host.allocations, []);
    f.unchangedEffects();
});
