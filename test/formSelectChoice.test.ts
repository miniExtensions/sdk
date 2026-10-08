import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { FormDraftStore } from '../src/forms/drafts.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type SelectFieldChoice,
    type AirtableValue,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const fixture = (configure: (page: FormLoadedResult) => void = () => {}) => {
    const page = loadedForm();
    page.payload.fieldIdsInForm.push('fld_choice');
    page.payload.fieldIdsToSchemas.fld_choice = {
        fieldType: 'multipleSelects',
        airtableField: {
            id: 'fld_choice',
            name: 'Choice',
            isComputed: false,
            isPrimaryField: false,
            description: null,
            config: {
                type: 'multipleSelects',
                options: { choices: [{ id: 'sel_alpha', name: 'Alpha' }] },
            },
        },
        miniExtConfig: { allowAddingNewOptions: true },
    };
    page.payload.formRecord.data.fld_choice = ['Alpha'];
    configure(page);
    let scopeRevision = 0;
    let configuration = 0;
    let visible = true;
    let writable = true;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw Error('No implicit I/O');
        },
    });
    const store = new FormDraftStore<AirtableValue>();
    const owner = createFormFieldBindings({
        client,
        loaded: page,
        saveOptions: formSaveOptions(),
        store,
        getScope: () => ({ ownerId: 'A', revision: scopeRevision }),
        canWriteField: () => visible,
        canWrite: () => writable,
    });
    const journal = new RecoveryJournal();
    const scope = {
        owner: 'A',
        parentFieldId: null,
        tableId: null,
        childExtensionId: 'form',
        context: 'modal' as const,
    };
    const creator = owner.selectChoice(
        'fld_choice',
        { journal, scope, loadVersion: 1 },
        {
            getLoaded: () => page,
            configurationRevision: () => configuration,
        }
    );
    let calls = 0;
    client.forms.addSelectOption = async () => {
        calls++;
        return { newChoice: { id: 'sel_beta', name: 'Beta' } };
    };
    return {
        owner,
        creator,
        journal,
        scope,
        client,
        page,
        store,
        calls: () => calls,
        replace: () => {
            scopeRevision++;
            owner.refresh();
        },
        observe: () => {
            configuration++;
            creator.getSnapshot();
        },
        revoke: () => {
            writable = false;
            owner.refresh();
        },
        hide: () => {
            visible = false;
            owner.refresh();
        },
    };
};

it('explicit creation installs canonical metadata and names, never saves, and survives renderer remount', async () => {
    const f = fixture();
    let saves = 0;
    f.client.forms.save = async () => {
        saves++;
        return invalidForm();
    };
    const binding = f.owner.field('fld_choice');
    const states: string[] = [];
    const stop = binding.subscribe((state) =>
        states.push(state.choiceCreation?.phase ?? 'none')
    );
    assert.equal(f.calls(), 0);
    assert.equal(await f.creator.create('New intent'), true);
    assert.equal(f.calls(), 1);
    assert.equal(saves, 0);
    assert.deepEqual(binding.getSnapshot().value, ['Alpha', 'Beta']);
    assert.equal(binding.getSnapshot().dirty, true);
    assert.equal(
        binding
            .selection!.getState()
            .options.some((item) => item.value === 'Beta'),
        true
    );
    assert.equal(f.creator.getSnapshot().phase, 'created-selected');
    assert.equal(f.journal.unknown('A').length, 0);
    stop();
    assert.equal(
        f.owner.selectChoice('fld_choice', {
            journal: f.journal,
            scope: f.scope,
            loadVersion: 1,
        }),
        f.creator
    );
    assert.equal(binding.choiceCreation, f.creator);
    assert(states.includes('creating'));
    assert(states.includes('created-selected'));
    const output = f.creator.getSnapshot();
    output.choice!.name = 'Mutated';
    assert.equal(f.creator.getSnapshot().choice!.name, 'Beta');
    await f.owner.save();
    assert.equal(saves, 1);
    f.owner.destroy();
});

for (const reason of [
    'denied',
    'readonly',
    'computed',
    'restricted',
    'limit',
    'blank',
    'hidden',
    'malformed-native',
    'blocked-condition',
] as const) {
    it(`${reason} preflight has no request and no journal attempt`, async () => {
        const f = fixture((page) => {
            const schema = page.payload.fieldIdsToSchemas.fld_choice!;
            const mini = schema.miniExtConfig! as Record<string, unknown>;
            if (reason === 'denied') mini.allowAddingNewOptions = false;
            if (reason === 'readonly') mini.readOnly = true;
            if (reason === 'computed') schema.airtableField.isComputed = true;
            if (reason === 'restricted')
                mini.singleOrMultiSelectLimitSelectionOptions = ['sel_alpha'];
            if (reason === 'limit') mini.maxNumberOfSelections = 1;

            if (reason === 'blocked-condition') {
                mini.enableConditionalOptions = true;
                mini.conditionsForOptions = 'invalid';
            }
        });
        if (reason === 'hidden') f.hide();
        if (reason === 'malformed-native')
            f.owner.controller.write('fld_choice', ['Alpha', null]);
        assert.equal(
            await f.creator.create(reason === 'blank' ? '  ' : 'Beta'),
            false
        );
        assert.equal(f.calls(), 0);
        assert.deepEqual(f.journal.unknown('A'), []);
        f.owner.destroy();
    });
}

it('false option condition creates metadata without selecting or saving', async () => {
    const f = fixture((page) => {
        page.payload.fieldIdsInForm = ['fld_title', 'fld_choice'];
        page.payload.fieldIdsToSchemas = {
            fld_title: page.payload.fieldIdsToSchemas.fld_title!,
            fld_choice: page.payload.fieldIdsToSchemas.fld_choice!,
        };
        const config = page.payload.fieldIdsToSchemas.fld_choice!
            .miniExtConfig! as Record<string, unknown>;
        config.enableConditionalOptions = true;
        config.conditionsForOptions = [
            {
                id: 'rule_beta',
                config: {
                    optionForConditions: 'sel_beta',
                    conditionsForOption: {
                        logicalOperator: 'and',
                        conditions: [
                            {
                                id: 'condition',
                                type: 'singleCondition',
                                setting: {
                                    type: 'is',
                                    fieldType: 'singleLineText',
                                    idOrName: { type: 'id', id: 'fld_title' },
                                    value: 'Other',
                                },
                            },
                        ],
                    },
                },
            },
        ];
    });
    assert.equal(await f.creator.create('Beta'), true);
    assert.equal(f.creator.getSnapshot().phase, 'created-not-selected');
    assert.deepEqual(f.owner.field('fld_choice').getSnapshot().value, [
        'Alpha',
    ]);
    assert.equal(
        f.owner
            .field('fld_choice')
            .selection!.getState()
            .options.some((item) => item.value === 'Beta'),
        false
    );
    assert.equal(f.journal.unknown('A').length, 0);
    f.owner.destroy();
});

for (const change of [
    'owner',
    'token',
    'configuration-aba',
    'session',
    'draft',
    'dispose',
    'hidden',
    'write-lease',
] as const) {
    it(`held creation rejects ${change}, retains uncertainty and never touches successor values`, async () => {
        const f = fixture();
        const held = deferred<{ newChoice: SelectFieldChoice }>();
        let calls = 0;
        f.client.forms.addSelectOption = async () => {
            calls++;
            return held.promise;
        };
        const creating = f.creator.create('Beta');
        assert.equal(f.creator.getSnapshot().busy, true);
        assert.equal(await f.creator.create('Duplicate'), false);
        if (change === 'owner') f.replace();
        if (change === 'token') {
            f.page.payload.extensionAccessToken = 'replacement_token';
            f.creator.getSnapshot();
        }
        if (change === 'configuration-aba') {
            f.observe();
            f.observe();
        }
        if (change === 'session') f.client.setSession({ visitor: 'B' });
        if (change === 'draft')
            f.owner.controller.write('fld_title', 'New edit');
        if (change === 'dispose') f.owner.destroy();
        if (change === 'hidden') f.hide();
        if (change === 'write-lease') f.revoke();
        held.resolve({ newChoice: { id: 'sel_beta', name: 'Beta' } });
        assert.equal(await creating, false);
        assert.equal(calls, 1);
        assert.equal(f.journal.unknown('A').length, 1);
        assert.equal(f.journal.unknown('A')[0]!.flight, false);
        assert.equal(
            JSON.stringify(f.journal.unknown('A')).includes('Beta'),
            false
        );
        assert.equal(f.creator.getSnapshot().choice, null);
        f.owner.destroy();
    });
}

for (const malformed of [
    null,
    {},
    { id: '', name: 'Beta' },
    { id: 'sel_beta', name: '' },
    { id: 'sel_alpha', name: 'Beta' },
    { id: 'sel_beta', name: 'Alpha' },
]) {
    it('malformed or conflicting returned metadata remains uncertain without overwriting choices', async () => {
        const f = fixture();
        f.client.forms.addSelectOption = async () => ({
            newChoice: malformed as SelectFieldChoice,
        });
        assert.equal(await f.creator.create('Beta'), false);
        assert.deepEqual(f.owner.field('fld_choice').getSnapshot().value, [
            'Alpha',
        ]);
        assert.equal(f.creator.getSnapshot().phase, 'uncertain');
        assert.equal(await f.creator.create('Retry'), false);
        assert.equal(f.calls(), 0); // This local override is the only explicit dispatch.
        f.owner.destroy();
    });
}

for (const ending of ['lost', 'cancelled'] as const) {
    it(`${ending} request blocks Save and replay until explicit inspection/new intent`, async () => {
        const f = fixture();
        const held = deferred<{ newChoice: SelectFieldChoice }>();
        f.client.forms.addSelectOption = () => held.promise;
        const creating = f.creator.create('Beta');
        if (ending === 'cancelled') f.creator.cancel();
        held.reject(Error('Lost response'));
        assert.equal(await creating, false);
        assert.equal(f.creator.getSnapshot().phase, 'uncertain');
        await assert.rejects(f.owner.save());
        assert.equal(await f.creator.create('Beta'), false);
        f.journal.acknowledgeNewIntent(f.journal.unknown('A')[0]!);
        f.client.forms.addSelectOption = async () => ({
            newChoice: { id: 'sel_gamma', name: 'Gamma' },
        });
        assert.equal(await f.creator.create('Deliberate new intent'), true);
        assert.deepEqual(f.owner.field('fld_choice').getSnapshot().value, [
            'Alpha',
            'Gamma',
        ]);
        f.owner.destroy();
    });
}

it('accepted metadata/native commit settles before publication disposal and cannot replay', async () => {
    const f = fixture();
    const stop = f.owner.field('fld_choice').subscribe((state) => {
        if (state.dirty) f.owner.destroy();
    });
    assert.equal(await f.creator.create('Beta'), true);
    assert.equal(f.journal.unknown('A').length, 0);
    assert.equal(f.creator.getSnapshot().phase, 'retired');
    assert.equal(await f.creator.create('Again'), false);
    stop();
});

for (const selected of [true, false]) {
    it('exact returned identity reuse is accepted without duplicate metadata/native values or dirty changes', async () => {
        const f = fixture();
        if (!selected) f.owner.field('fld_choice').selection!.choose([]);
        const before = f.owner.field('fld_choice').getSnapshot();
        f.client.forms.addSelectOption = async () => ({
            newChoice: { id: 'sel_alpha', name: 'Alpha' },
        });
        assert.equal(await f.creator.create(' alpha '), true);
        assert.deepEqual(f.owner.field('fld_choice').getSnapshot().value, [
            'Alpha',
        ]);
        assert.equal(
            f.owner.getLoaded().payload.fieldIdsToSchemas.fld_choice!
                .airtableField.config.type,
            'multipleSelects'
        );
        const config =
            f.owner.getLoaded().payload.fieldIdsToSchemas.fld_choice!
                .airtableField.config;
        if (config.type === 'multipleSelects')
            assert.equal(config.options?.choices.length, 1);
        if (selected)
            assert.equal(
                f.owner.field('fld_choice').getSnapshot().revision,
                before.revision
            );
        assert.equal(f.journal.unknown('A').length, 0);
        f.owner.destroy();
    });
}
