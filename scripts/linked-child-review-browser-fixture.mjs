// Verification-only mounted host. All backend results are synthetic.
import { createMiniExtensionsClient } from '@miniextensions/sdk';
import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
const data = __FIXTURES__;
const params = new URL(location.href).searchParams;
const edit = params.get('edit') === 'true';
const scenario = params.get('scenario');
const loaded = structuredClone(edit ? data.edit : data.create);
if (params.get('multipage') === 'false')
    loaded.payload.publicFields.state.multiPageFormMode = 'one-page';
let configuration = 0;
const calls = { saves: [], begins: 0, reviews: 0, settled: 0, errors: [] };
window.addEventListener('error', (e) => calls.errors.push(e.message));
window.addEventListener('unhandledrejection', (e) =>
    calls.errors.push(String(e.reason))
);
const client = createMiniExtensionsClient({
    apiOrigin: 'https://synthetic-sdk.invalid',
    fetch: async () => {
        throw Error('Unexpected network');
    },
});
client.loadExtension = async () => structuredClone(loaded);
client.linkedRecords.loadSelectedRecords = async () => ({
    tbl_child: {
        airtableFields: [
            data.parent.payload.fieldIdsToSchemas.fld_title.airtableField,
        ],
        recordIdsToAirtableRecords: Object.fromEntries(
            ['rec_existing', 'rec_sibling'].map((id) => [
                id,
                { id, fields: { fld_title: id } },
            ])
        ),
    },
});
client.forms.save = async (input) => {
    calls.saves.push(structuredClone(input));
    if (scenario === 'unknown') throw Error('Synthetic lost response');
    if (scenario === 'backend-validation')
        return structuredClone(data.validation);
    return {
        ...structuredClone(data.saved),
        record: {
            id: edit ? 'rec_existing' : 'rec_created',
            fields: structuredClone(input.formRecord.data),
        },
    };
};
class Journal extends RecoveryJournal {
    begin(...args) {
        calls.begins++;
        return super.begin(...args);
    }
}
const fields = createFormFieldBindings({
    loaded: data.parent,
    client,
    getScope: () => ({ ownerId: 'synthetic-owner', revision: 0 }),
    configurationRevision: () => configuration,
    saveOptions: {
        captchaVal: null,
        isComputeMode: false,
        searchQuery: {},
        context: { type: 'direct-url' },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
    },
});
const dialog = document.querySelector('dialog');
let settle;
let request;
let presentation;
const owner = fields.linkedChild('fld_children_a', {
    journal: new Journal(),
    loadVersion: 1,
    review: async (next) => {
        calls.reviews++;
        request = next;
        presentation = new AbortController();
        document.querySelector('#answers').textContent = JSON.stringify(
            next.draft
        );
        dialog.showModal();
        next.signal.addEventListener(
            'abort',
            () => {
                dialog.close();
                settle?.({ type: 'edit' });
            },
            { once: true }
        );
        return new Promise((resolve) => {
            settle = resolve;
        });
    },
});
function decide(decision) {
    dialog.close();
    settle(decision);
}
function confirm(reentrant = false) {
    const current = request;
    decide({
        type: 'confirm',
        signal: presentation.signal,
        isCurrent: () => {
            if (reentrant)
                owner
                    .getSnapshot()
                    .child.field('fld_title')
                    .setValue('Reentrant edit');
            return current.isCurrent();
        },
    });
}
dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    decide({ type: 'edit' });
});
const on = (id, fn) =>
    document.getElementById(id).addEventListener('click', fn);
on('confirm', () => confirm());
on('edit', () => decide({ type: 'edit' }));
on('cancel', () => decide({ type: 'edit' }));
on('close', () => {
    owner.close();
    dialog.close();
});
on('retire', () => {
    configuration++;
    fields.refresh();
});
on('stale', () => {
    owner.getSnapshot().child.field('fld_title').setValue('Stale edit');
    confirm();
});
on('reentrant', () => confirm(true));
on('parent-edit', () =>
    fields.field('fld_title').setValue('Unrelated parent edit')
);
const save = async () => {
    try {
        await owner.save(owner.getSnapshot().revision);
    } catch (error) {
        calls.lastFailure = String(error);
    } finally {
        calls.settled++;
        render();
    }
};
on('save', save);
on('retry', save);
on('next', () => {
    const p = owner.getSnapshot().pages;
    p.next(p.getSnapshot().revision);
    render();
});
on('back', () => {
    const p = owner.getSnapshot().pages;
    p.back(p.getSnapshot().revision);
    render();
});
on('invalidate', () => {
    owner.getSnapshot().child.field('fld_title').setValue('');
    render();
});
function render() {
    const s = owner.getSnapshot();
    const p = s.pages?.getSnapshot();
    for (const name of ['title', 'note', 'last']) {
        document.querySelector(`#row-${name}`).hidden =
            !p?.currentFieldIds.includes(`fld_${name}`);
    }
    document.querySelector('#save').disabled = !p?.canReview;
    document.querySelector('#next').disabled = !p?.canNext;
    document.querySelector('#back').disabled = !p?.canBack;
    document.querySelector('#status').textContent = JSON.stringify({
        phase: s.phase,
        completion: s.completion,
        page: p?.activePageIndex,
    });
}
owner.subscribe(render);
on('open', async () => {
    if (edit) await fields.linkedRecords('fld_children_a').readSelected();
    const opened = edit
        ? await owner.openEdit('rec_existing', owner.getSnapshot().revision)
        : await owner.openCreate();
    if (!opened) throw Error('Child did not open');
    for (const name of ['title', 'note', 'last']) {
        const input = document.querySelector(`#${name}`);
        input.value = owner
            .getSnapshot()
            .child.controller.getState().draft.data[`fld_${name}`];
        input.onchange = () => {
            owner
                .getSnapshot()
                .child.field(`fld_${name}`)
                .setValue(input.value);
            render();
        };
    }
    window.opened = true;
    render();
});
window.proof = () => ({
    ...structuredClone(calls),
    phase: owner.getSnapshot().phase,
    completion: owner.getSnapshot().completion,
    parent: structuredClone(fields.controller.getState().draft.data),
    aborted: request?.signal.aborted,
});
