import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import { createElement as h, StrictMode, useState } from 'react';
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
let current = createParent(fixture.parent, {
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
const root = createRoot(document.querySelector('#app'));
root.render(h(StrictMode, null, h(Parent)));
