import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import { FormLinkedChildEditDialog } from '@miniextensions/sdk/react';
import { createElement as h, StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const fixture = __REACT_EDIT_FIXTURE__;
const recordId = 'rec_existing';
const fieldId = 'fld_children_a';
const calls = { reads: [], loads: [], saves: [], parentSubmits: 0 };
let previous;
let holdSave = false;
window.holdNextReactEditSave = () => {
    holdSave = true;
};

const client = {
    getSession: () => ({}),
    linkedRecords: {
        loadSelectedRecords: async (input) => {
            calls.reads.push(structuredClone(input));
            return structuredClone(fixture.selected);
        },
    },
    loadExtension: async (input) => {
        calls.loads.push(structuredClone(input));
        if (
            input.childExtensionInfo?.accessType?.childExtensionRecordId !==
            recordId
        )
            throw Error('Unexpected selected child read');
        return structuredClone(fixture.child);
    },
    forms: {
        save: async (input) => {
            calls.saves.push(structuredClone(input));
            if (
                input.extensionAccessToken !== 'synthetic_child_token' ||
                input.formRecord.recordId !== recordId
            )
                throw Error('Unexpected parent or sibling Save');
            if (holdSave) {
                holdSave = false;
                await new Promise((resolve) => {
                    window.releaseReactEditSave = resolve;
                });
            }
            const response = structuredClone(fixture.saved);
            response.record.fields = {
                ...response.record.fields,
                ...structuredClone(input.formRecord.data),
                fld_parent_a: ['rec_parent'],
            };
            response.context.newTableIdsToLinkedTableStates.tbl_child.recordIdsToAirtableRecords[
                recordId
            ] = response.record;
            return response;
        },
    },
};

class ObservedJournal extends RecoveryJournal {
    acceptedCount = 0;
    accepted(...args) {
        super.accepted(...args);
        this.acceptedCount++;
    }
}

function createParent(epoch) {
    const journal = new ObservedJournal();
    const loaded = structuredClone(fixture.parent);
    if (epoch)
        loaded.payload.formRecord.data.fld_title = 'Replacement parent title';
    const scope = {
        ownerId: 'synthetic-react-edit-parent-' + epoch,
        revision: epoch,
    };
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
    return {
        fields,
        journal,
        owner: fields.linkedChild(fieldId, { journal, loadVersion: 1 }),
    };
}

let current = createParent(0);
let epoch = 0;

function ChildTitle({ child }) {
    const binding = child.field('fld_title');
    return h('input', {
        'aria-label': 'Child title',
        defaultValue: binding.getSnapshot().value ?? '',
        onChange: (event) => binding.setValue(event.currentTarget.value),
    });
}

function EditAction({ parent }) {
    const [opening, setOpening] = useState(null);
    const accepted = useRef(null);
    const hydrated = useRef(false);
    const busy = useRef(false);
    const open = async (event) => {
        if (busy.current || current !== parent) return;
        const opener = event.currentTarget;
        busy.current = true;
        try {
            if (!hydrated.current) {
                await parent.fields.linkedRecords(fieldId).readSelected();
                hydrated.current = true;
            }
            if (
                current !== parent ||
                !opener.isConnected ||
                !(await parent.owner.openEdit(
                    recordId,
                    parent.owner.getSnapshot().revision
                ))
            )
                return;
            const { child } = parent.owner.getSnapshot();
            if (current !== parent || !opener.isConnected || !child) return;
            const entry = {
                opener,
                child,
                recordId,
                isCurrent: () =>
                    current === parent && accepted.current === entry,
            };
            accepted.current = entry;
            setOpening(entry);
        } finally {
            busy.current = false;
        }
    };
    return h(
        'div',
        null,
        h('button', { type: 'button', onClick: open }, 'Edit selected record'),
        opening &&
            h(FormLinkedChildEditDialog, {
                owner: parent.owner,
                opening,
                renderFields: (child) => h(ChildTitle, { child }),
            })
    );
}

function Parent() {
    const [revision, setRevision] = useState(epoch);
    window.replaceReactEditParent = () => {
        previous = current;
        current = createParent(++epoch);
        previous.fields.destroy();
        setRevision(epoch);
    };
    return h(
        'form',
        {
            onSubmit: (event) => {
                event.preventDefault();
                calls.parentSubmits++;
            },
        },
        h('button', { type: 'submit' }, 'Submit parent'),
        h(EditAction, { key: revision, parent: current })
    );
}

window.readReactEditProof = () => {
    const { fields, owner, journal } = current;
    const { child, phase } = owner.getSnapshot();
    return {
        calls: structuredClone(calls),
        phase,
        accepted: journal.acceptedCount,
        previousAccepted: previous?.journal.acceptedCount ?? 0,
        previousCompletion: previous?.owner.getSnapshot().completion,
        childTitle: child?.field('fld_title').getSnapshot().value,
        childDirty: child?.controller.getState().draft?.dirtyFieldIds,
        parentTitle: fields.field('fld_title').getSnapshot().value,
        links: fields.field(fieldId).getSnapshot().value,
        sibling: fields.field('fld_children_b').getSnapshot().value,
    };
};

const root = createRoot(document.querySelector('#app'));
root.render(h(StrictMode, null, h(Parent)));
