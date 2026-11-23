import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import {
    createElement as h,
    StrictMode,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { BorrowedFormLinkedChildCreateDialog } from '@miniextensions/sdk/react';
import { createRoot } from 'react-dom/client';
import { LinkedChildCreateAction } from './installed-create-example.ts';

const fixture = __LINKED_CHILD_CREATE_FIXTURES__;
const calls = { loads: [], saves: [], parentSubmits: 0 };
let holdSave = false;
let holdLoad = false;
window.holdNextCreateSave = () => {
    holdSave = true;
};
window.holdNextCreateLoad = () => {
    holdLoad = true;
};
const client = {
    getSession: () => ({}),
    loadExtension: async (input) => {
        calls.loads.push(structuredClone(input));
        if (holdLoad) {
            holdLoad = false;
            await new Promise((resolve) => {
                window.releaseCreateLoad = resolve;
            });
        }
        return structuredClone(fixture.child);
    },
    forms: {
        save: async (input) => {
            calls.saves.push(structuredClone(input));
            if (input.extensionAccessToken !== 'synthetic_child_token')
                throw Error('Unexpected parent transport');
            if (holdSave) {
                holdSave = false;
                await new Promise((resolve) => {
                    window.releaseCreateSave = resolve;
                });
            }
            const saved = structuredClone(fixture.saved);
            saved.record.fields = structuredClone(input.formRecord.data);
            saved.context.newTableIdsToLinkedTableStates.tbl_child.recordIdsToAirtableRecords.rec_created =
                saved.record;
            return saved;
        },
    },
};
function createParent(loaded, scope) {
    const fields = createFormFieldBindings({
        loaded,
        client,
        getScope: () => scope,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    const owner = fields.linkedChild('fld_children_a', {
        journal: new RecoveryJournal(),
        loadVersion: 1,
    });
    return { fields, owner };
}
const borrowNative = new URLSearchParams(location.search).has('borrowed');
let current = borrowNative
    ? null
    : createParent(fixture.parent, {
          ownerId: 'synthetic-parent',
          revision: 0,
      });
let parentEpoch = 0;

function ChildTitle({ child }) {
    const binding = child.field('fld_title');
    return h(
        'label',
        null,
        'Child title',
        h('input', {
            'aria-label': 'Child title',
            defaultValue: binding.getSnapshot().value ?? '',
            onChange: (event) => binding.setValue(event.currentTarget.value),
        })
    );
}

function Parent() {
    const [epoch, setEpoch] = useState(parentEpoch);
    const [parentCurrent, setParentCurrent] = useState(true);
    window.setParentPresentationCurrent = setParentCurrent;
    window.retireCreateView = (staleButton) => {
        parentEpoch++;
        // The old event runs before React commits the replacement markup.
        staleButton?.click();
        setEpoch(parentEpoch);
    };
    window.replaceNativeParent = (nextLinks) => {
        const previous = current;
        const replacement = structuredClone(fixture.parent);
        replacement.payload.formRecord.recordId = 'rec_parent_replacement';
        replacement.payload.formRecord.data.fld_title = 'Replacement parent';
        replacement.payload.formRecord.data.fld_children_a = nextLinks;
        current = createParent(replacement, {
            ownerId: 'synthetic-parent-replacement',
            revision: 1,
        });
        previous.fields.destroy();
        window.previousCreateCompletion = () =>
            previous.owner.getSnapshot().completion;
        parentEpoch++;
        setEpoch(parentEpoch);
    };
    return h(
        'form',
        {
            'data-parent-current': parentCurrent,
            onSubmit: (event) => {
                event.preventDefault();
                calls.parentSubmits++;
            },
        },
        h('button', { id: 'parent-submit', type: 'submit' }, 'Submit parent'),
        h('button', { id: 'outside-focus', type: 'button' }, 'Outside focus'),
        h(LinkedChildCreateAction, {
            key: epoch,
            owner: current.owner,
            parentIsCurrent: () => parentCurrent && epoch === parentEpoch,
            renderFields: (child) => h(ChildTitle, { child }),
        })
    );
}

window.readCreateProof = () => {
    const { fields, owner } = current;
    const snapshot = owner.getSnapshot();
    return {
        calls: structuredClone(calls),
        phase: snapshot.phase,
        canCreate: snapshot.canCreate,
        childTitle: snapshot.child?.field('fld_title').getSnapshot().value,
        parentTitle: fields.field('fld_title').getSnapshot().value,
        links: fields.field('fld_children_a').getSnapshot().value,
        sibling: fields.field('fld_children_b').getSnapshot().value,
    };
};

let nativeSnapshot = null;
let nativeOpening = null;
let nextOpening = 0;
let nativeParent = { links: ['rec_initial'] };
const nativeCalls = {
    saves: [],
    saveRefs: [],
    dismisses: 0,
    parentSubmits: 0,
    openerFocuses: 0,
    permissionHelpOpens: 0,
};
const subscriptions = new Set();
function publishNative(snapshot) {
    nativeSnapshot = snapshot;
    for (const notify of subscriptions) notify();
}
function openNative(opener) {
    const identity = { number: ++nextOpening };
    const parent = nativeParent;
    const opening = {
        identity,
        opener,
        isCurrent: () => nativeOpening === opening && nativeParent === parent,
    };
    nativeOpening = opening;
    publishNative({
        ref: { opening: identity, revision: 0 },
        phase: 'ready',
        fields: { title: '' },
        dirty: false,
        error: null,
        outcome: null,
    });
}
function replaceNative(expected, change, allowTerminalDismissal = false) {
    const canDismissTerminal =
        allowTerminalDismissal &&
        (nativeSnapshot.phase === 'unknown' ||
            (nativeSnapshot.phase === 'saved' &&
                nativeSnapshot.outcome?.link === 'unlinked'));
    if (
        !nativeOpening?.isCurrent() ||
        nativeSnapshot.ref.opening !== expected.opening ||
        nativeSnapshot.ref.revision !== expected.revision ||
        (nativeSnapshot.phase !== 'ready' && !canDismissTerminal)
    )
        return false;
    publishNative({
        ...nativeSnapshot,
        ...change,
        ref: { ...nativeSnapshot.ref, revision: expected.revision + 1 },
    });
    return true;
}
const nativeOwner = {
    getSnapshot: () => nativeSnapshot,
    subscribe(notify) {
        subscriptions.add(notify);
        return () => subscriptions.delete(notify);
    },
    async save(expected) {
        const parent = nativeParent;
        const opening = nativeOpening;
        const title = nativeSnapshot.fields.title;
        if (!replaceNative(expected, { phase: 'saving' }))
            return { type: 'not-dispatched', reason: 'superseded' };
        nativeCalls.saves.push(title);
        nativeCalls.saveRefs.push({
            opening: expected.opening.number,
            revision: expected.revision,
        });
        const id = 'rec_created_' + nativeCalls.saves.length;
        if (window.holdBorrowedSave) {
            window.holdBorrowedSave = false;
            await new Promise((resolve) => {
                window.releaseBorrowedSave = resolve;
            });
        }
        const error = window.nextBorrowedSaveError;
        window.nextBorrowedSaveError = undefined;
        if (error != null) {
            const unknown = window.nextBorrowedSaveUnknown === true;
            window.nextBorrowedSaveUnknown = false;
            const outcome = unknown
                ? { type: 'unknown', attemptId: id }
                : { type: 'rejected' };
            if (opening.isCurrent())
                publishNative({
                    ...nativeSnapshot,
                    phase: unknown ? 'unknown' : 'ready',
                    error,
                    outcome,
                });
            return outcome;
        }
        if (window.nextBorrowedSaveUnknown) {
            window.nextBorrowedSaveUnknown = false;
            const outcome = { type: 'unknown', attemptId: id };
            if (opening.isCurrent())
                publishNative({ ...nativeSnapshot, phase: 'unknown', outcome });
            return outcome;
        }
        const unlinked = window.nextBorrowedSaveUnlinked === true;
        window.nextBorrowedSaveUnlinked = false;
        const current = opening.isCurrent();
        const outcome = {
            type: 'saved',
            recordId: id,
            link: current ? (unlinked ? 'unlinked' : 'linked') : 'superseded',
        };
        if (current) {
            if (!unlinked) parent.links.push(id);
            publishNative({
                ...nativeSnapshot,
                phase: 'saved',
                fields: unlinked ? null : nativeSnapshot.fields,
                outcome,
            });
        }
        window.borrowedSaveOutcome = outcome;
        return outcome;
    },
    dismiss(expected) {
        if (!replaceNative(expected, { phase: 'closed' }, true))
            return 'superseded';
        nativeCalls.dismisses++;
        return 'closed';
    },
};
window.replaceBorrowedParent = (staleConfirm) => {
    nativeParent = { links: ['rec_successor'] };
    // Deliver an already-captured click before committing the new render.
    staleConfirm?.click();
    openNative(nativeOpening.opener);
};
window.readBorrowedCreate = () => ({
    ...structuredClone(nativeCalls),
    links: [...nativeParent.links],
    title: nativeSnapshot?.fields?.title,
    phase: nativeSnapshot?.phase,
    opening: nativeSnapshot?.ref.opening.number,
    revision: nativeSnapshot?.ref.revision,
    outcome: nativeSnapshot?.outcome,
});
function NativeParent() {
    useSyncExternalStore(nativeOwner.subscribe, nativeOwner.getSnapshot);
    const opener = useRef(null);
    return h(
        'form',
        {
            'data-native-opening': nativeSnapshot?.ref.opening.number,
            onSubmit: (event) => {
                event.preventDefault();
                nativeCalls.parentSubmits++;
            },
        },
        h(
            'button',
            {
                type: 'button',
                ref: opener,
                onFocus: () => nativeCalls.openerFocuses++,
                onClick: () => openNative(opener.current),
            },
            'Open native child'
        ),
        nativeOpening &&
            h(BorrowedFormLinkedChildCreateDialog, {
                owner: nativeOwner,
                // Cosmetic renders intentionally create a new descriptor for the same identity.
                opening: { ...nativeOpening },
                renderErrorAction: (error) =>
                    error.includes(fixture.permissionError)
                        ? h(
                              'button',
                              {
                                  type: 'button',
                                  onClick: () =>
                                      nativeCalls.permissionHelpOpens++,
                              },
                              'How can I fix permissions-related issues?'
                          )
                        : null,
                renderFields: (fields) =>
                    h(
                        'label',
                        {
                            ref: (element) => {
                                element?.toggleAttribute(
                                    'inert',
                                    nativeSnapshot.phase !== 'ready'
                                );
                            },
                        },
                        'Native child title',
                        h('input', {
                            'aria-label': 'Native child title',
                            value: fields.title,
                            onChange: (event) =>
                                replaceNative(nativeSnapshot.ref, {
                                    fields: {
                                        title: event.currentTarget.value,
                                    },
                                    dirty: true,
                                }),
                        })
                    ),
            })
    );
}
const root = createRoot(document.querySelector('#app'));
root.render(h(StrictMode, null, h(borrowNative ? NativeParent : Parent)));
