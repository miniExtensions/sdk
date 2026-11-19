import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LinkedChildCreateAction } from './installed-create-example.ts';

const fixture = __LINKED_CHILD_CREATE_FIXTURES__;
const calls = { loads: [], saves: [], parentSubmits: 0 };
const loaded = fixture.parent;
const scope = { ownerId: 'synthetic-parent', revision: 0 };
let holdSave = false;
window.holdNextCreateSave = () => {
    holdSave = true;
};
const client = {
    getSession: () => ({}),
    loadExtension: async (input) => {
        calls.loads.push(structuredClone(input));
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
    window.retireCreateView = (staleButton) => {
        parentEpoch++;
        // The old event runs before React commits the replacement markup.
        staleButton?.click();
        setEpoch(parentEpoch);
    };
    return h(
        'form',
        {
            onSubmit: (event) => {
                event.preventDefault();
                calls.parentSubmits++;
            },
        },
        h('button', { id: 'parent-submit', type: 'submit' }, 'Submit parent'),
        h('button', { id: 'outside-focus', type: 'button' }, 'Outside focus'),
        h(LinkedChildCreateAction, {
            key: epoch,
            owner,
            parentIsCurrent: () => epoch === parentEpoch,
            renderFields: (child) => h(ChildTitle, { child }),
        })
    );
}

window.readCreateProof = () => ({
    calls: structuredClone(calls),
    phase: owner.getSnapshot().phase,
    childTitle: owner.getSnapshot().child?.field('fld_title').getSnapshot()
        .value,
    parentTitle: fields.field('fld_title').getSnapshot().value,
    links: fields.field('fld_children_a').getSnapshot().value,
    sibling: fields.field('fld_children_b').getSnapshot().value,
});
const root = createRoot(document.querySelector('#app'));
root.render(h(StrictMode, null, h(Parent)));
