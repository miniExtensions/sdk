import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { act, createElement as h } from 'react';
import { FormPageNavigationButton } from '../src/react/CompleteFormPageNavigation.js';
import {
    BorrowedFormLinkedChildCreateDialog,
    type BorrowedFormLinkedChildCreateDialogProps,
    type BorrowedFormLinkedChildCreateOwner,
    type BorrowedFormLinkedChildCreateRef,
    type BorrowedFormLinkedChildCreateSaveOutcome,
    type BorrowedFormLinkedChildCreateSnapshot,
} from '../src/react/FormLinkedChildCreateDialog.js';
import {
    ThemeBoundary,
    type ThemeBoundaryProps,
} from '../src/react/ThemeBoundary.js';
import { createNativeFormPages } from '../src/ui/nativeFormPages.js';
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
    ) => Promise<BorrowedFormLinkedChildCreateSaveOutcome> = async () => saved,
    initialPrimaryAction?: BorrowedFormLinkedChildCreateDialogProps<string>['primaryAction']
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
                    fields:
                        outcome.type === 'saved' && outcome.link === 'unlinked'
                            ? null
                            : state.fields,
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
    const render = (
        primaryAction = initialPrimaryAction,
        presentation?: Pick<
            BorrowedFormLinkedChildCreateDialogProps<string>,
            'className' | 'closeIcon'
        >,
        theme?: ThemeBoundaryProps['theme']
    ) => {
        const opening = identity;
        const child = h(BorrowedFormLinkedChildCreateDialog<string>, {
            owner,
            opening: {
                identity: opening,
                opener: openerElement,
                isCurrent: () => opening === identity,
            },
            renderFields: (value) =>
                h('input', {
                    value,
                    form: primaryAction?.formId,
                    readOnly: true,
                    'aria-label': 'Native child',
                }),
            primaryAction,
            ...presentation,
        });
        return dom.render(theme ? h(ThemeBoundary, { theme }, child) : child);
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
    assert.equal(f.dialog()?.getAttribute('class'), null);
    assert.equal(f.dialog()?.querySelector('h2')?.getAttribute('class'), null);
    assert.equal(f.button('Close').getAttribute('aria-label'), null);
    assert.equal(f.button('Save').type, 'button');
    assert.equal(f.dialog()?.querySelector('form'), null);
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

it('keeps navigation and Review idle until the latest explicit confirmation', async (t) => {
    let settle!: () => void;
    const heldSave = new Promise<void>((resolve) => {
        settle = resolve;
    });
    const f = await fixture(t, async () => {
        await heldSave;
        return saved;
    });
    let nextClicks = 0;
    await f.render({
        label: 'Next',
        onAction() {
            nextClicks++;
        },
    });
    await f.click(f.button('Next'));
    assert.equal(nextClicks, 1);
    assert.deepEqual(f.saves, []);

    const confirmations: Array<() => Promise<void>> = [];
    const review = {
        label: 'Review',
        onAction(confirm: () => Promise<void>) {
            confirmations.push(confirm);
        },
    };
    await f.render(review);
    await f.edit('Keep these native answers');
    await f.click(f.button('Review'));
    await f.click(f.button('Review'));
    const [superseded, confirm] = confirmations;
    assert(superseded);
    assert(confirm);
    await f.render({ ...review, onAction: (save) => review.onAction(save) });
    await act(superseded);
    assert.equal(f.button('Close').disabled, false);
    assert.equal(
        f.dialog()?.querySelector('input')?.value,
        'Keep these native answers'
    );
    assert.deepEqual(f.saves, []);

    const expected = f.read().ref;
    await act(async () => {
        void confirm();
        void confirm();
    });
    assert.deepEqual(f.saves, [expected]);
    assert.equal(f.button('Close').disabled, true);
    assert.equal(f.button('Review').disabled, true);
    await act(async () => settle());
    assert.equal(f.dialog(), null);
    assert.equal(f.doc.activeElement, f.opener);
});

it('refuses deferred Save after the native draft or opening changes', async (t) => {
    const confirmations: Array<() => Promise<void>> = [];
    const f = await fixture(t, undefined, {
        label: 'Review',
        onAction: (confirm) => {
            confirmations.push(confirm);
        },
    });
    await f.render();
    await f.click(f.button('Review'));
    await f.edit('The draft changed');
    const [oldDraft] = confirmations;
    assert(oldDraft);
    await act(oldDraft);
    await f.click(f.button('Review'));
    const [, oldOpening] = confirmations;
    assert(oldOpening);
    await f.replace();
    await act(oldOpening);
    assert.deepEqual(f.saves, []);
    assert.equal(f.dialog()?.querySelector('input')?.value, 'Successor draft');

    await f.click(f.button('Review'));
    const [, , current] = confirmations;
    assert(current);
    const expected = f.read().ref;
    await act(current);
    assert.deepEqual(f.saves, [expected]);
});

it('keeps the admitted Save when native Review declines a second activation', async (t) => {
    const pages = createNativeFormPages({
        owner: {},
        configuration: {},
        pages: [
            { title: null, description: null, fieldIds: [], hidden: false },
        ],
        multiple: false,
        reviewItems: [],
        isCurrent: () => true,
        onNext() {},
    });
    const admissions: boolean[] = [];
    const f = await fixture(t, undefined, {
        label: 'Review',
        onAction(save) {
            const admitted = pages.openReview(save);
            admissions.push(admitted);
            return admitted;
        },
    });
    await f.render();
    await f.click(f.button('Review'));
    await f.click(f.button('Review'));
    assert.deepEqual(admissions, [true, false]);
    assert.deepEqual(f.saves, []);
    const expected = f.read().ref;
    await act(async () => {
        await pages.confirmReview();
        await pages.confirmReview();
    });
    assert.deepEqual(f.saves, [expected]);
    assert.equal(f.dialog(), null);
    assert.equal(f.doc.activeElement, f.opener);
});

it('associates the native field and primary with one guarded form submit', async (t) => {
    let settle!: () => void;
    const heldSave = new Promise<void>((resolve) => {
        settle = resolve;
    });
    const confirmations: Array<() => Promise<void>> = [];
    const f = await fixture(
        t,
        async () => {
            await heldSave;
            return saved;
        },
        {
            label: 'Review',
            formId: 'native-child-form',
            onAction(confirm) {
                confirmations.push(confirm);
            },
        }
    );
    await f.render();
    const dialog = f.dialog();
    assert(dialog);
    const form = dialog.querySelector('form');
    const input = dialog.querySelector('input');
    const primary = f.button('Review');
    assert(form);
    assert(input);
    assert.equal(dialog.querySelectorAll('form').length, 1);
    assert.equal(form.childElementCount, 0);
    assert.equal(form.noValidate, true);
    assert.equal(input.form, form);
    assert.equal(primary.form, form);
    assert.equal(primary.type, 'submit');

    const submits: Array<{ defaultPrevented: boolean }> = [];
    form.addEventListener('submit', (event) => submits.push(event));
    await f.click(primary);
    await act(async () => form.requestSubmit(primary));
    assert.equal(confirmations.length, 2);
    assert.equal(submits.length, 2);
    assert(submits.every((event) => event.defaultPrevented));
    assert.deepEqual(f.saves, []);
    const confirm = confirmations[1];
    assert(confirm);
    const expected = f.read().ref;
    await act(async () => {
        void confirm();
    });
    assert.equal(primary.disabled, true);
    await act(async () => form.requestSubmit());
    assert.equal(confirmations.length, 2);
    assert.deepEqual(f.saves, [expected]);
    await act(async () => settle());
    assert.equal(f.dialog(), null);
    assert.equal(f.doc.activeElement, f.opener);
});

it('renders themed Create layout hooks with the standard associated Next and Review controls', async (t) => {
    const f = await fixture(t);
    const formId = 'native-themed-child';
    const presentation = {
        className: 'custom-child',
        closeIcon: h('svg', { 'aria-hidden': true }),
    };
    let advances = 0;
    await f.render(
        {
            formId,
            label: 'Next',
            mode: 'next',
            onAction() {
                advances++;
            },
        },
        presentation,
        'green'
    );
    const dialog = f.dialog();
    assert(dialog);
    assert.equal(dialog.parentElement, f.doc.body);
    assert(dialog.classList.contains('custom-child'));
    assert(dialog.classList.contains('mx-sdk-theme'));
    assert.equal(dialog.getAttribute('data-mx-theme'), 'green');
    assert.notEqual(dialog.style.getPropertyValue('--theme-600'), '');
    assert.equal(
        dialog.querySelector('.mx-sdk-linked-child-create__title')?.id,
        dialog.getAttribute('aria-labelledby')
    );
    const close = dialog.querySelector('.mx-sdk-linked-child-create__close');
    assert(close);
    assert.equal(close.getAttribute('aria-label'), 'Close');
    assert(close.querySelector('svg[aria-hidden=true]'));
    const body = dialog.querySelector('.mx-sdk-linked-child-create__body');
    const form = dialog.querySelector('form');
    assert(body);
    assert(form);
    assert(body.contains(form));
    assert.equal(body.querySelector('input')?.form, form);
    const actions = dialog.querySelector(
        '.mx-sdk-linked-child-create__actions'
    );
    assert(actions);
    const next = f.button('Next');
    assert(actions.contains(next));
    assert(next.classList.contains('mx-sdk-form-page-button--next'));
    assert.equal(next.form, form);
    await act(async () => form.requestSubmit(next));
    assert.equal(advances, 1);
    assert.deepEqual(f.saves, []);

    let backs = 0;
    let confirm: (() => Promise<void>) | undefined;
    await f.render(
        {
            formId,
            label: 'Review',
            mode: 'review',
            beforePrimary: h(FormPageNavigationButton, {
                direction: 'back',
                label: 'Back',
                onClick() {
                    backs++;
                },
            }),
            onAction(save) {
                confirm = save;
            },
        },
        presentation,
        'green'
    );
    const back = f.button('Back');
    const review = f.button('Review');
    assert.deepEqual([...actions.querySelectorAll('button')], [back, review]);
    assert.equal(back.type, 'button');
    assert(review.classList.contains('mx-sdk-form-submit'));
    assert.equal(review.getAttribute('data-mode'), 'review');
    assert.equal(review.form, form);
    await f.click(back);
    assert.equal(backs, 1);
    assert.equal(confirm, undefined);
    await f.click(review);
    assert.deepEqual(f.saves, []);
    assert(confirm);
    await act(confirm);
    assert.equal(f.saves.length, 1);
    assert.equal(f.dialog(), null);
    assert.equal(f.doc.activeElement, f.opener);
});

it('does not close the borrowed Create dialog on a descendant dialog cancel', async (t) => {
    const f = await fixture(t);
    await f.render();
    const outer = f.dialog();
    assert(outer);
    const nested = f.doc.createElement('dialog');
    outer.append(nested);
    const nestedCancel = new f.window.Event('cancel', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        nested.dispatchEvent(nestedCancel);
    });
    assert.equal(nestedCancel.defaultPrevented, false);
    assert.equal(outer.open, true);
    assert.deepEqual(f.closes, []);
    await act(async () => {
        outer.dispatchEvent(new f.window.Event('cancel', { cancelable: true }));
    });
    assert.equal(f.closes.length, 1);
    assert.equal(f.dialog(), null);
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

it('keeps a saved but unlinked record terminal until an explicit Close', async (t) => {
    const unlinked = { ...saved, link: 'unlinked' } as const;
    const f = await fixture(t, async () => unlinked);
    f.opener.focus();
    await f.render();
    await f.edit('Saved native child');
    await f.click(f.button('Save'));
    assert(f.dialog()?.open);
    assert.equal(f.dialog()?.querySelector('input'), null);
    assert.match(
        f.dialog()?.textContent ?? '',
        /record was saved but could not be linked/
    );
    assert.deepEqual(f.read().outcome, unlinked);
    assert.notEqual(f.doc.activeElement, f.opener);
    assert.equal(f.button('Save').disabled, true);
    await f.click(f.button('Save'));
    assert.equal(f.saves.length, 1);
    assert.deepEqual(f.closes, []);
    await f.click(f.button('Close'));
    assert.equal(f.dialog(), null);
    assert.equal(f.closes.length, 1);
    assert.equal(f.saves.length, 1);
    assert.deepEqual(f.read().outcome, unlinked);
    assert.equal(f.doc.activeElement, f.opener);
});
