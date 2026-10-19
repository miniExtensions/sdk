import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

export function addLinkedReviewAnswers(page) {
    const fields = ['fld_link_title', 'fld_link_secret'].map((id, index) => ({
        id,
        name: id,
        isComputed: false,
        isPrimaryField: index === 0,
        config: { type: 'singleLineText' },
    }));
    const detail = (field, config = {}) => ({
        fieldId: field.id,
        fieldName: field.name,
        isHidden: false,
        miniExtConfig: config,
    });
    const ids = [
        'fld_review_link',
        'fld_review_masked_link',
        'fld_review_generic_link',
    ];
    for (const [index, id] of ids.entries()) {
        page.payload.fieldIdsInForm.push(id);
        page.payload.fieldIdsToSchemas[id] = {
            fieldType: 'multipleRecordLinks',
            airtableField: {
                id,
                name: id,
                isComputed: false,
                config: {
                    type: 'multipleRecordLinks',
                    options: {
                        linkedTableId: 'tbl_review_link',
                        inverseLinkFieldId: 'fld_inverse',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
            miniExtConfig: {
                readOnly: true,
                ...(index === 1
                    ? { customPrimaryField: 'fld_link_secret' }
                    : {}),
            },
        };
        page.payload.formRecord.data[id] = [
            'rec_original',
            'rec_missing',
            'rec_original',
        ];
        if (index < 2)
            page.payload.linkedRecordFieldIdToDetailFields[id] = fields.map(
                (field) =>
                    detail(field, index === 1 ? { obscurePassword: true } : {})
            );
    }
    const records = [
        {
            id: 'rec_original',
            fields: {
                fld_link_title: '<b>Authorized name</b>',
                fld_link_secret: 'PRIVATE_MASKED_VALUE',
            },
        },
        {
            id: 'rec_new',
            fields: {
                fld_link_title: '<b>Authorized name</b>',
                fld_link_secret: 'PRIVATE_NEW_VALUE',
            },
        },
        {
            id: 'rec_aggregated_other_field',
            fields: {
                fld_link_title: 'PRIVATE_OTHER_FIELD',
                fld_link_secret: 'PRIVATE_OTHER_SECRET',
            },
        },
    ];
    const table = {
        airtableFields: fields,
        recordIdsToAirtableRecords: Object.fromEntries(
            records.map((record) => [record.id, record])
        ),
    };
    return {
        ids,
        records,
        table,
        tables: { tbl_review_link: table },
        options: {
            records: records.slice(0, 2),
            offset: null,
            tableIdsToLinkedTableStates: { tbl_review_link: table },
        },
    };
}

/** The same privacy boundary runs against source and the installed recipe. */
export function checkLinkedReviewMasking({
    create,
    review,
    generic,
    createFormSaveInput,
}) {
    const mask = '••••••••';
    const fieldId = 'fld_review_masked_link';
    const configs = [
        { type: 'singleLineText' },
        { type: 'multilineText' },
        { type: 'email' },
        { type: 'phoneNumber' },
        { type: 'number', options: { precision: 0 } },
        { type: 'currency', options: { precision: 2, symbol: '$' } },
        { type: 'percent', options: { precision: 0 } },
        {
            type: 'rating',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
        },
        { type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    ];
    const setup = (config, policy, custom) => {
        const page = createReviewFixture('review-answers').page();
        const fixture = addLinkedReviewAnswers(page);
        // Isolate the one linked field under test; unrelated raw labels have
        // independent accepted policies and are not part of this assertion.
        page.payload.fieldIdsInForm = page.payload.fieldIdsInForm.filter(
            (id) => !['fld_review_link', 'fld_review_generic_link'].includes(id)
        );
        const index = custom ? 1 : 0;
        const primary = fixture.table.airtableFields[index];
        primary.config = config;
        if (!custom)
            delete page.payload.fieldIdsToSchemas[fieldId].miniExtConfig
                .customPrimaryField;
        const detail =
            page.payload.linkedRecordFieldIdToDetailFields[fieldId][index];
        detail.miniExtConfig = policy;
        for (const record of fixture.records)
            record.fields[primary.id] =
                config.type === 'checkbox'
                    ? false
                    : ['number', 'currency', 'percent', 'rating'].includes(
                            config.type
                        )
                      ? 0
                      : 'SYNTHETIC_PRIVATE_LINKED_LABEL';
        return { page, fixture, primary, detail };
    };
    const accept = (scope, fixture, source) =>
        source === 'hydration'
            ? scope.acceptHydration(fixture.tables)
            : scope.acceptOptions(fieldId, fixture.options);
    const sourceKinds = ['hydration', 'options'];
    let checks = 0;
    for (const config of configs)
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen'])
            for (const custom of [false, true])
                for (const source of sourceKinds) {
                    const { page, fixture, primary } = setup(
                        config,
                        { [flag]: true },
                        custom
                    );
                    const before = structuredClone({ page, fixture });
                    const scope = create(page, () => true);
                    accept(scope, fixture, source);
                    const snapshot = scope.snapshot();
                    assert.equal(snapshot.label(fieldId, 'rec_original'), mask);
                    assert.equal(
                        snapshot.label(fieldId, 'rec_new'),
                        source === 'options' ? mask : generic,
                        'hydration cannot authorize new linked membership'
                    );
                    assert.equal(
                        review(
                            page,
                            page.payload.formRecord.data,
                            snapshot
                        ).find((row) => row.fieldId === fieldId).value,
                        [mask, generic, mask].join('\n'),
                        'masking preserves native linked ID order and duplicates'
                    );
                    assert.deepEqual({ page, fixture }, before);
                    const dirtyFieldIds = [fieldId, 'fld_review_title'];
                    const saved = createFormSaveInput({
                        loaded: page,
                        draft: {
                            data: page.payload.formRecord.data,
                            dirtyFieldIds,
                        },
                        options: {
                            context: { type: 'direct-url' },
                            isComputeMode: false,
                            captchaVal: null,
                            searchQuery: {},
                            conditionalLinkedRecordFieldIdsToFilteringValues:
                                {},
                        },
                    });
                    assert.deepEqual(saved.formRecord, page.payload.formRecord);
                    assert.deepEqual(
                        saved.formFieldIdsWithUnsavedChanges,
                        dirtyFieldIds
                    );
                    let rawReads = 0;
                    for (const record of fixture.records)
                        Object.defineProperty(record.fields, primary.id, {
                            configurable: true,
                            get() {
                                rawReads++;
                                assert.fail('Masked native value was read.');
                            },
                        });
                    const guarded = create(page, () => true);
                    accept(guarded, fixture, source);
                    assert.equal(
                        guarded.snapshot().label(fieldId, 'rec_original'),
                        mask
                    );
                    assert.equal(rawReads, 0);
                    assert.deepEqual(page, before.page);
                    checks++;
                }
    for (const source of sourceKinds)
        for (const change of [
            ({ detail }) => (detail.isHidden = true),
            ({ primary }) => (primary.config = { type: 'url' }),
            ({ primary }) => (primary.isComputed = true),
            ({ fixture }) =>
                (fixture.table.airtableFields[1].isPrimaryField = true),
            ({ detail }) => (detail.fieldName = 'contradiction'),
            ({ detail }) => (detail.miniExtConfig = []),
            ...['obscurePassword', 'maskPasswordOnLoginScreen'].flatMap(
                (flag) =>
                    [null, 'true', 1, {}].map(
                        (value) =>
                            ({ detail }) =>
                                (detail.miniExtConfig = { [flag]: value })
                    )
            ),
        ]) {
            const state = setup(
                configs[0],
                { maskPasswordOnLoginScreen: true },
                false
            );
            change(state);
            for (const record of state.fixture.records)
                Object.defineProperty(record.fields, state.primary.id, {
                    get() {
                        assert.fail('Unaccepted linked label was read.');
                    },
                });
            const scope = create(state.page, () => true);
            accept(scope, state.fixture, source);
            assert.equal(
                scope.snapshot().label(fieldId, 'rec_original'),
                generic
            );
            checks++;
        }
    for (const source of sourceKinds)
        for (const policy of [
            {},
            { obscurePassword: false, maskPasswordOnLoginScreen: false },
        ]) {
            const { page, fixture } = setup(configs[0], policy, true);
            const scope = create(page, () => true);
            accept(scope, fixture, source);
            assert.equal(
                scope.snapshot().label(fieldId, 'rec_original'),
                'SYNTHETIC_PRIVATE_LINKED_LABEL',
                'an accepted public label remains readable'
            );
            checks++;
        }
    return { checks };
}

/** Executes the archive-installed presentation recipe; no fetch or transport. */
export async function checkLinkedReviewRecipe({ consumerDirectory }) {
    const consumer = consumerDirectory;
    for (const name of ['linkedReview.ts', 'review.ts', 'privacy.ts'])
        assert.deepEqual(
            readFileSync(join(consumer, 'src', name)),
            readFileSync(
                join(
                    consumer,
                    'node_modules/@miniextensions/sdk/examples/browser/src',
                    name
                )
            )
        );
    const entry = join(consumer, '.generated/linked-review-entry.ts');
    writeFileSync(
        entry,
        "export { createLinkedReviewPresentation, unavailableLinkedAnswer } from '../src/linkedReview.js';\nexport { prepareFormReviewRows } from '../src/review.js';\nexport { createFormSaveInput } from '@miniextensions/sdk/forms';\n"
    );
    const outfile = join(consumer, '.generated/linked-review-checks.mjs');
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        metafile: true,
        logLevel: 'silent',
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    assert(
        Object.keys(bundle.metafile.inputs).some((path) =>
            path.endsWith('src/linkedReview.ts')
        )
    );
    const {
        createLinkedReviewPresentation: create,
        prepareFormReviewRows: review,
        unavailableLinkedAnswer: generic,
        createFormSaveInput,
    } = await import(pathToFileURL(outfile).href);
    const page = createReviewFixture('review-answers').page();
    const fixture = addLinkedReviewAnswers(page);
    const native = structuredClone(page.payload.formRecord.data);
    const before = structuredClone(page);
    let owner = true;
    const scope = create(page, () => owner);
    const values = (snapshot = scope.snapshot(), data = native) =>
        review(page, data, snapshot)
            .slice(-3)
            .map((row) => row.value);
    const genericThree = [generic, generic, generic].join('\n');
    assert.deepEqual(values(), [genericThree, genericThree, genericThree]);
    scope.acceptHydration(fixture.tables);
    const accepted = scope.snapshot();
    const title = '<b>Authorized name</b>';
    assert.deepEqual(values(), [
        [title, generic, title].join('\n'),
        ['••••••••', generic, '••••••••'].join('\n'),
        genericThree,
    ]);
    const newNative = {
        ...native,
        fld_review_link: [
            'rec_new',
            'rec_aggregated_other_field',
            'rec_original',
            'rec_new',
        ],
    };
    assert.equal(
        values(undefined, newNative)[0],
        [generic, generic, title, generic].join('\n'),
        'table hydration cannot authorize new field membership'
    );
    scope.acceptOptions('fld_review_link', fixture.options);
    assert.equal(accepted.current(), false);
    assert.equal(
        values(undefined, newNative)[0],
        [title, generic, title, title].join('\n')
    );
    assert(!JSON.stringify(values()).includes('PRIVATE'));
    fixture.records[0].fields.fld_link_title = 'MUTATED_SOURCE';
    assert(!JSON.stringify(values()).includes('MUTATED_SOURCE'));
    assert.deepEqual(page, before);
    assert.deepEqual(native, before.payload.formRecord.data);
    let checks = 5;
    for (const bad of [
        'rec_original',
        {},
        [null],
        [''],
        [' \t '],
        [1],
        new Array(1),
    ]) {
        assert.throws(
            () =>
                review(
                    page,
                    { ...native, fld_review_link: bad },
                    scope.snapshot()
                ),
            /Review is unavailable/
        );
        checks++;
    }
    assert(
        !review(
            page,
            { ...native, fld_review_link: [] },
            scope.snapshot()
        ).some((row) => row.fieldId === 'fld_review_link')
    );
    for (const empty of [null, undefined, '', ' \t ', []]) {
        const emptyData = { ...native, fld_review_link: empty };
        assert(
            !review(page, emptyData, scope.snapshot()).some(
                (row) => row.fieldId === 'fld_review_link'
            )
        );
        assert.deepEqual(emptyData.fld_review_link, empty);
        checks++;
    }
    const missing = { ...native };
    delete missing.fld_review_link;
    assert(
        !review(page, missing, scope.snapshot()).some(
            (row) => row.fieldId === 'fld_review_link'
        )
    );
    assert(!Object.hasOwn(missing, 'fld_review_link'));
    checks++;
    for (const change of [
        (p) =>
            delete p.payload.linkedRecordFieldIdToDetailFields.fld_review_link,
        (p) =>
            (p.payload.linkedRecordFieldIdToDetailFields.fld_review_link =
                null),
        (p) =>
            (p.payload.linkedRecordFieldIdToDetailFields.fld_review_link = []),
        (p) =>
            (p.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].isHidden = true),
        (p) =>
            p.payload.linkedRecordFieldIdToDetailFields.fld_review_link.push(
                p.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0]
            ),
        (p) =>
            (p.payload.fieldIdsToSchemas.fld_review_link.miniExtConfig.customPrimaryField =
                'missing'),
    ]) {
        const p = structuredClone(before);
        change(p);
        const s = create(p, () => true);
        s.acceptHydration(fixture.tables);
        assert.equal(
            review(p, native, s.snapshot()).find(
                (row) => row.fieldId === 'fld_review_link'
            ).value,
            genericThree
        );
        checks++;
    }
    const mismatched = structuredClone(before);
    mismatched.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].fieldName =
        'contradiction';
    const mismatchedScope = create(mismatched, () => true);
    mismatchedScope.acceptHydration(fixture.tables);
    assert.equal(
        review(mismatched, native, mismatchedScope.snapshot()).find(
            (row) => row.fieldId === 'fld_review_link'
        ).value,
        genericThree
    );
    checks++;
    for (const mutate of [
        (t) => t.airtableFields.push(structuredClone(t.airtableFields[0])),
        (t) => (t.airtableFields[1].isPrimaryField = true),
        (t) => (t.airtableFields[0].config.type = 'richText'),
        (t) => (t.airtableFields[0].config.type = 'url'),
        (t) =>
            (t.recordIdsToAirtableRecords.rec_original.fields.fld_link_title =
                {}),
        (t) =>
            (t.recordIdsToAirtableRecords.rec_original.fields.fld_link_title =
                ' '),
        (t) => delete t.recordIdsToAirtableRecords.rec_original,
    ]) {
        const t = structuredClone(fixture.table);
        mutate(t);
        const s = create(before, () => true);
        s.acceptHydration({ tbl_review_link: t });
        assert.equal(
            review(before, native, s.snapshot()).find(
                (row) => row.fieldId === 'fld_review_link'
            ).value,
            genericThree
        );
        checks++;
    }
    const conflicting = structuredClone(fixture.options);
    conflicting.records.push({
        ...conflicting.records[0],
        fields: { fld_link_title: 'CONFLICT_PRIVATE' },
    });
    scope.acceptOptions('fld_review_link', conflicting);
    assert.equal(values()[0], genericThree);
    assert(!JSON.stringify(values()).includes('CONFLICT_PRIVATE'));
    // No raw value read occurs after hidden/mask decisions, even with hostile getters.
    const hidden = structuredClone(before);
    hidden.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].isHidden = true;
    const record = { id: 'rec_original', fields: {} };
    for (const id of ['fld_link_title', 'fld_link_secret'])
        Object.defineProperty(record.fields, id, {
            get() {
                assert.fail('private raw value read');
            },
        });
    const privateScope = create(hidden, () => true);
    privateScope.acceptOptions('fld_review_link', {
        ...fixture.options,
        records: [record],
    });
    privateScope.acceptOptions('fld_review_masked_link', {
        ...fixture.options,
        records: [record],
    });
    assert.equal(
        privateScope.snapshot().label('fld_review_link', 'rec_original'),
        generic
    );
    assert.equal(
        privateScope.snapshot().label('fld_review_masked_link', 'rec_original'),
        '••••••••'
    );
    for (const flag of ['displayAsAttachments', 'displayAsButton']) {
        const rich = structuredClone(before);
        rich.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].miniExtConfig[
            flag
        ] = true;
        rich.payload.linkedRecordFieldIdToDetailFields.fld_review_masked_link[1].miniExtConfig[
            flag
        ] = true;
        const richScope = create(rich, () => true);
        richScope.acceptOptions('fld_review_link', {
            ...fixture.options,
            records: [record],
        });
        richScope.acceptOptions('fld_review_masked_link', {
            ...fixture.options,
            records: [record],
        });
        assert.equal(
            richScope.snapshot().label('fld_review_link', 'rec_original'),
            generic
        );
        assert.equal(
            richScope
                .snapshot()
                .label('fld_review_masked_link', 'rec_original'),
            '••••••••',
            'masking precedes rich-mode fallback without reading raw content'
        );
        checks++;
    }
    const duplicateLabels = create(before, () => true);
    duplicateLabels.acceptOptions('fld_review_link', {
        ...fixture.options,
        records: ['rec_label_a', 'rec_label_b'].map((id) => ({
            id,
            fields: { fld_link_title: 'Same label' },
        })),
    });
    assert.equal(
        review(
            before,
            {
                ...native,
                fld_review_link: ['rec_label_b', 'rec_label_a', 'rec_label_b'],
            },
            duplicateLabels.snapshot()
        ).find((row) => row.fieldId === 'fld_review_link').value,
        'Same label\nSame label\nSame label'
    );
    checks++;
    const held = scope.snapshot();
    assert.equal(held.signal.aborted, false);
    owner = false;
    scope.acceptOptions('fld_review_link', fixture.options);
    assert.equal(held.current(), false);
    scope.retire();
    assert.equal(held.signal.aborted, true);
    owner = true;
    scope.acceptHydration(fixture.tables);
    assert.equal(held.current(), false);
    assert.equal(
        scope.snapshot().label('fld_review_link', 'rec_original'),
        generic
    );
    // Replacement A→B→A creates distinct render epochs; old scope stays retired.
    const replacement = create(before, () => true);
    replacement.acceptHydration(fixture.tables);
    const a = replacement.snapshot();
    replacement.acceptOptions('fld_review_link', fixture.options);
    replacement.acceptHydration(fixture.tables);
    assert.equal(a.current(), false);
    assert.equal(a.signal.aborted, true);
    assert.equal(replacement.snapshot().signal.aborted, false);
    // An abort listener sees committed replacement state and may reenter.
    const old = replacement.snapshot();
    let reentered;
    old.signal.addEventListener(
        'abort',
        () => {
            replacement.acceptHydration(fixture.tables);
            reentered = replacement.snapshot();
        },
        { once: true }
    );
    replacement.acceptOptions('fld_review_link', fixture.options);
    assert.equal(old.signal.aborted, true);
    assert.equal(reentered.signal.aborted, false);
    assert.equal(reentered.current(), true);
    const retiredDuringHydration = create(before, () => true);
    const retiring = retiredDuringHydration.snapshot();
    retiring.signal.addEventListener(
        'abort',
        () => retiredDuringHydration.retire(),
        { once: true }
    );
    retiredDuringHydration.acceptHydration(fixture.tables);
    assert.equal(retiring.signal.aborted, true);
    assert.equal(retiredDuringHydration.snapshot().signal.aborted, true);
    assert.equal(retiredDuringHydration.snapshot().current(), false);
    retiredDuringHydration.acceptHydration(fixture.tables);
    assert.equal(retiredDuringHydration.snapshot().signal.aborted, true);
    const configPage = structuredClone(before);
    const configScope = create(configPage, () => true);
    configScope.acceptHydration(fixture.tables);
    const configSnapshot = configScope.snapshot();
    configPage.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].isHidden = true;
    assert.equal(configSnapshot.current(), false);
    assert.equal(configSnapshot.signal.aborted, true);
    configPage.payload.linkedRecordFieldIdToDetailFields.fld_review_link[0].isHidden = false;
    assert.equal(
        configSnapshot.current(),
        false,
        'observed configuration A→B→A cannot restore an old epoch'
    );
    assert.equal(
        configScope.snapshot().label('fld_review_link', 'rec_original'),
        generic
    );
    assert.throws(
        () => review(structuredClone(before), native, replacement.snapshot()),
        /Review is unavailable/,
        'foreign loaded Form cannot borrow a presentation snapshot'
    );
    const hiddenPage = structuredClone(before);
    hiddenPage.payload.fieldIdsToSchemas.fld_review_link.miniExtConfig.conditionalFields =
        structuredClone(
            hiddenPage.payload.fieldIdsToSchemas.fld_review_conditional
                .miniExtConfig.conditionalFields
        );
    const hiddenNative = { ...native, fld_review_show: false };
    assert(
        !review(hiddenPage, hiddenNative).some(
            (row) => row.fieldId === 'fld_review_link'
        )
    );
    assert.deepEqual(hiddenNative.fld_review_link, native.fld_review_link);
    const draft = {
        data: native,
        dirtyFieldIds: ['fld_review_link', 'fld_review_title'],
    };
    const saved = createFormSaveInput({
        loaded: before,
        draft,
        options: {
            context: { type: 'direct-url' },
            isComputeMode: false,
            captchaVal: null,
            searchQuery: {},
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    assert.deepEqual(saved.formRecord, {
        ...before.payload.formRecord,
        data: native,
    });
    assert.deepEqual(saved.formFieldIdsWithUnsavedChanges, draft.dirtyFieldIds);
    return {
        checks:
            checks +
            5 +
            checkLinkedReviewMasking({
                create,
                review,
                generic,
                createFormSaveInput,
            }).checks,
    };
}
