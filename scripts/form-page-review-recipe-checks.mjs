import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { addSelectReviewAnswers } from './form-review-recipe-checks.mjs';
import { addAttachmentReviewAnswers } from './attachment-review-recipe-checks.mjs';
import { addDateReviewAnswers } from './review-date-recipe-checks.mjs';
import { addLinkedReviewAnswers } from './linked-review-recipe-checks.mjs';

/** Execute shipped rows/dialog against the installed consumer, without a Save. */
export async function checkFormPageReviewRecipe({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    for (const name of [
        'review.ts',
        'confirmation.ts',
        'dom.ts',
        'linkedReview.ts',
    ])
        assert.deepEqual(
            readFileSync(join(consumer, 'src', name)),
            readFileSync(join(installed, 'examples/browser/src', name))
        );
    const entry = join(consumer, '.generated/form-page-review-entry.ts');
    const guide = readFileSync(join(installed, 'docs/forms.md'), 'utf8');
    const start = guide.indexOf('async function reviewPage(');
    const end = guide.indexOf('// Pass review: reviewPage', start);
    assert(
        start >= 0 && end > start,
        'Packed multipage Review adapter required'
    );
    const adapter = guide.slice(start, end);
    writeFileSync(
        entry,
        "import { prepareFormReviewRows, captureReviewDateContext } from '../src/review.js';\nimport { requestConfirmation, cancelConfirmation } from '../src/confirmation.js';\nimport type { FormPageReviewRequest, FormPageReviewDecision } from '@miniextensions/sdk/forms';\nlet presentation: any;\nexport const setReviewPresentation = (value: any) => { presentation = value; };\nconst captureReviewPresentation = () => presentation;\nexport { prepareFormReviewRows, requestConfirmation, cancelConfirmation };\nexport " +
            adapter
    );
    const outfile = join(consumer, '.generated/form-page-review-checks.mjs');
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
    for (const suffix of [
        'src/review.ts',
        'src/confirmation.ts',
        'dist/esm/forms/projection.js',
    ])
        assert(
            Object.keys(bundle.metafile.inputs).some((path) =>
                path.endsWith(suffix)
            )
        );
    const {
        prepareFormReviewRows,
        requestConfirmation,
        cancelConfirmation,
        reviewPage,
        setReviewPresentation,
    } = await import(pathToFileURL(outfile).href);
    let checks = 0;
    const page = createReviewFixture('review-answers').page();
    addSelectReviewAnswers(page);
    addAttachmentReviewAnswers(page);
    addDateReviewAnswers(page);
    addLinkedReviewAnswers(page);
    const native = structuredClone(page.payload.formRecord.data);
    native.fld_review_show = false;
    const before = structuredClone(native);
    const onePageRows = prepareFormReviewRows(page, native);
    page.payload.publicFields.state.multiPageFormMode = 'multi-page';
    const rows = prepareFormReviewRows(page, native);
    assert.deepEqual(rows, onePageRows);
    assert.deepEqual(native, before);
    assert(rows.some((row) => row.value === '••••••••'));
    assert(rows.some((row) => row.value === '0'));
    assert(rows.some((row) => row.fieldId === 'fld_review_date'));
    assert(rows.some((row) => row.fieldId === 'fld_review_multi'));
    assert(rows.some((row) => row.fieldId === 'fld_review_link'));
    assert(!rows.some((row) => row.fieldId === 'fld_review_conditional'));
    assert(!JSON.stringify(rows).includes('PRIVATE_STORED_URL'));
    assert(!JSON.stringify(rows).includes('PRIVATE_STORED_NAME'));
    checks++;
    for (const patch of [
        { multiPageFormMode: 'invalid-mode' },
        { enableFormComputeMode: true },
        { autoSubmitAfterPrefill: true },
    ]) {
        const variant = structuredClone(page);
        Object.assign(variant.payload.publicFields.state, patch);
        assert.throws(
            () => prepareFormReviewRows(variant, native),
            /Review is unavailable/
        );
        assert.deepEqual(native, before);
        checks++;
    }
    for (const kind of ['computed', 'rich']) {
        const variant = structuredClone(page);
        const schema = variant.payload.fieldIdsToSchemas.fld_review_readonly;
        if (kind === 'computed') schema.airtableField.isComputed = true;
        else {
            schema.fieldType = 'richText';
            schema.airtableField.config = { type: 'richText' };
        }
        assert.throws(
            () => prepareFormReviewRows(variant, native),
            /Review is unavailable/
        );
        assert.deepEqual(native, before);
        checks++;
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window({ url: 'https://form-page-review.example.test' });
    const globals = {
        document: window.document,
        HTMLElement: window.HTMLElement,
    };
    const prior = Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
    ]);
    Object.assign(globalThis, globals);
    try {
        const trigger = window.document.createElement('button');
        window.document.body.append(trigger);
        const options = {
            title: 'Review',
            message: 'Captured answers',
            confirmLabel: 'Confirm',
            cancelLabel: 'Edit',
            rows,
        };
        let writes = 0;
        const open = (signal) => {
            trigger.focus();
            const decision = requestConfirmation({ ...options, signal }).then(
                (accepted) => {
                    if (accepted) writes++;
                    return accepted;
                }
            );
            const dialog = window.document.querySelector('dialog[open]');
            assert(dialog);
            const [edit, confirm] = dialog.querySelectorAll('button');
            assert.equal(window.document.activeElement, edit);
            assert.deepEqual(
                [...dialog.querySelectorAll('dd')].map(
                    (node) => node.textContent
                ),
                rows.map((row) => row.value)
            );
            assert.equal(dialog.querySelectorAll('a,img,b,i').length, 0);
            for (const witness of [
                'CaseSensitiveReviewSecret',
                'PRIVATE_STORED_URL',
                'PRIVATE_NEW_URL',
                'PRIVATE_THUMB',
                'PRIVATE_STORED_NAME',
                'PRIVATE_MASKED_VALUE',
                'Retained conditional answer',
            ])
                assert(!dialog.outerHTML.includes(witness));
            return { decision, dialog, edit, confirm };
        };
        let prompt = open();
        prompt.edit.click();
        assert.equal(await prompt.decision, false);
        prompt = open();
        prompt.dialog.dispatchEvent(
            new window.Event('cancel', { cancelable: true })
        );
        assert.equal(await prompt.decision, false);
        const controller = new AbortController();
        prompt = open(controller.signal);
        controller.abort();
        prompt.confirm.click();
        assert.equal(await prompt.decision, false);
        assert.equal(writes, 0);
        assert.equal(window.document.activeElement, trigger);
        checks += 3;

        const oldController = new AbortController();
        const old = open(oldController.signal);
        const successor = open();
        assert.equal(await old.decision, false);
        oldController.abort();
        old.confirm.click();
        old.dialog.dispatchEvent(new window.Event('close'));
        assert.equal(successor.dialog.isConnected, true);
        assert.equal(window.document.activeElement, successor.edit);
        // An initially aborted request must not disturb the current prompt.
        assert.equal(
            await requestConfirmation({
                ...options,
                signal: oldController.signal,
            }),
            false
        );
        assert.equal(successor.dialog.isConnected, true);
        cancelConfirmation();
        assert.equal(await successor.decision, false);
        assert.equal(writes, 0);
        checks++;

        // Prior-dialog close cleanup can synchronously open a newer dialog.
        const first = open();
        let newestDecision;
        first.dialog.addEventListener(
            'close',
            () => {
                newestDecision = requestConfirmation({
                    ...options,
                    title: 'Newest',
                });
            },
            { once: true }
        );
        const superseded = requestConfirmation({
            ...options,
            title: 'Superseded',
        });
        assert.equal(await first.decision, false);
        assert.equal(await superseded, false);
        assert.equal(
            window.document.querySelector('dialog h2').textContent,
            'Newest'
        );
        cancelConfirmation();
        assert.equal(await newestDecision, false);
        assert.equal(writes, 0);
        checks++;

        prompt = open();
        prompt.confirm.click();
        prompt.confirm.click();
        assert.equal(await prompt.decision, true);
        assert.equal(writes, 1);
        assert.deepEqual(native, before);
        checks++;

        // Run the exact packed guide adapter with real shipped rows and dialog.
        // Page-owner transport/validation behavior is checked separately.
        let ownerCurrent = true;
        let presentationCurrent = true;
        let observedIds;
        setReviewPresentation({
            linked: {
                forPage: () => true,
                label: () => 'Selected record — details unavailable',
            },
            isCurrent: (ids) => {
                observedIds = [...ids];
                return presentationCurrent;
            },
        });
        const request = {
            loaded: structuredClone(page),
            draft: { data: structuredClone(native) },
            signal: new AbortController().signal,
            isCurrent: () => ownerCurrent,
        };
        const adapterDecision = reviewPage(request);
        const adapterDialog = window.document.querySelector('dialog[open]');
        assert(adapterDialog);
        assert.deepEqual(
            [...adapterDialog.querySelectorAll('dd')].map(
                (node) => node.textContent
            ),
            rows.map((row) => row.value)
        );
        // The request is detached; even application mutation cannot rewrite the
        // native draft or the already rendered presentation copy.
        request.draft.data.fld_review_title = 'Detached callback mutation';
        assert.deepEqual(native, before);
        adapterDialog.querySelectorAll('button')[1].click();
        const confirmed = await adapterDecision;
        assert.equal(confirmed.type, 'confirm');
        assert.equal(confirmed.isCurrent(), true);
        assert.deepEqual(
            observedIds,
            rows.map((row) => row.fieldId)
        );
        // Pending-file/presentation invalidation and owner retirement each
        // independently refuse the same confirmed decision.
        presentationCurrent = false;
        assert.equal(confirmed.isCurrent(), false);
        presentationCurrent = true;
        ownerCurrent = false;
        assert.equal(confirmed.isCurrent(), false);
        assert.equal(writes, 1);
        checks++;

        for (const stale of ['presentation', 'owner']) {
            ownerCurrent = stale !== 'owner';
            presentationCurrent = stale !== 'presentation';
            await assert.rejects(
                reviewPage({
                    ...request,
                    draft: { data: structuredClone(native) },
                }),
                /Review is unavailable for the current presentation/
            );
            assert.equal(window.document.querySelector('dialog'), null);
            assert.equal(writes, 1);
            assert.deepEqual(native, before);
            checks++;
        }
        ownerCurrent = true;
        presentationCurrent = true;
        for (const action of ['edit', 'escape', 'abort']) {
            const abort = new AbortController();
            const decision = reviewPage({
                ...request,
                draft: { data: structuredClone(native) },
                signal: abort.signal,
            });
            const dialog = window.document.querySelector('dialog[open]');
            if (action === 'edit') dialog.querySelector('button').click();
            else if (action === 'escape')
                dialog.dispatchEvent(
                    new window.Event('cancel', { cancelable: true })
                );
            else abort.abort();
            assert.deepEqual(await decision, { type: 'edit' });
            assert.equal(writes, 1);
            assert.deepEqual(native, before);
            checks++;
        }
        const previousTZ = process.env.TZ;
        try {
            for (const mode of [
                'client',
                'fixed',
                'date-only',
                'hidden-client',
                'empty-client',
            ]) {
                process.env.TZ = 'America/Los_Angeles';
                const loaded = structuredClone(page);
                const data = structuredClone(native);
                const datetime =
                    loaded.payload.fieldIdsToSchemas.fld_review_datetime;
                if (mode !== 'fixed')
                    datetime.airtableField.config.options.timeZone = 'client';
                if (mode === 'date-only')
                    loaded.payload.fieldIdsInForm = ['fld_review_date'];
                if (mode === 'empty-client') data.fld_review_datetime = null;
                if (mode === 'hidden-client') {
                    datetime.miniExtConfig.conditionalFields = structuredClone(
                        loaded.payload.fieldIdsToSchemas.fld_review_conditional
                            .miniExtConfig.conditionalFields
                    );
                    data.fld_review_datetime = 'PRIVATE_INVALID_HIDDEN_DATE';
                }
                const capturedData = structuredClone(data);
                ownerCurrent = true;
                presentationCurrent = true;
                const pendingDecision = reviewPage({
                    loaded,
                    draft: { data },
                    signal: new AbortController().signal,
                    isCurrent: () => ownerCurrent,
                });
                const dialog = window.document.querySelector('dialog[open]');
                assert(dialog);
                assert(
                    !dialog.outerHTML.includes('PRIVATE_INVALID_HIDDEN_DATE')
                );
                process.env.TZ = 'America/New_York';
                dialog.querySelectorAll('button')[1].click();
                const decision = await pendingDecision;
                assert.equal(decision.type, 'confirm');
                assert.equal(decision.isCurrent(), mode !== 'client', mode);
                presentationCurrent = false;
                assert.equal(decision.isCurrent(), false);
                assert.deepEqual(data, capturedData);
                assert.deepEqual(native, before);
                assert.equal(writes, 1);
                checks++;
            }
        } finally {
            if (previousTZ === undefined) delete process.env.TZ;
            else process.env.TZ = previousTZ;
        }
    } finally {
        cancelConfirmation();
        for (const [key, descriptor] of prior) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    }
    return { checks };
}
