import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export async function checkReadonlyAttachmentConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    let checks = 0;
    for (const format of ['esm', 'cjs']) {
        const load = (name) =>
            format === 'cjs'
                ? require(
                      `@miniextensions/sdk${name === 'runtime' ? '' : '/' + name}`
                  )
                : import(
                      pathToFileURL(
                          join(
                              consumerDirectory,
                              'node_modules/@miniextensions/sdk/dist/esm',
                              name,
                              'index.js'
                          )
                      )
                  );
        const [runtime, forms, ui] = await Promise.all(
            ['runtime', 'forms', 'ui'].map(load)
        );
        assert.equal('captureFormControllerDraftRevision' in forms, false);
        assert.equal('captureFormVisibilityRevision' in forms, false);
        for (const { config, hideAt, notification = false } of [
            { config: { readOnly: true, hideAttachmentName: false } },
            { config: { readOnly: false, hideAttachmentName: false } },
            { config: { readOnly: true, hideAttachmentName: true } },
            { config: { readOnly: true, obscurePassword: true } },
            { config: { readOnly: true, maskPasswordOnLoginScreen: true } },
            {
                config: { readOnly: true, hideAttachmentName: false },
                hideAt: 5,
            },
            {
                config: { readOnly: false, hideAttachmentName: false },
                hideAt: 5,
            },
            ...[true, false].flatMap((readOnly) =>
                [false, true].map((hide) => ({
                    config: { readOnly, hideAttachmentName: false },
                    hideAt: hide ? 5 : undefined,
                    notification: true,
                }))
            ),
        ]) {
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm.push('fld_files');
            loaded.payload.fieldIdsToSchemas.fld_files = {
                fieldType: 'multipleAttachments',
                airtableField: {
                    id: 'fld_files',
                    name: 'Files',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: 'multipleAttachments',
                        options: { isReversed: false },
                    },
                },
                miniExtConfig: {
                    ...config,
                    ...(hideAt || notification
                        ? {
                              conditionalFields: {
                                  logicalOperator: 'and',
                                  conditions: [
                                      {
                                          id: 'visible-title',
                                          type: 'singleCondition',
                                          setting: {
                                              type: 'is',
                                              fieldType: 'singleLineText',
                                              idOrName: {
                                                  type: 'id',
                                                  id: 'fld_title',
                                              },
                                              value: 'Initial child',
                                          },
                                      },
                                  ],
                              },
                          }
                        : {}),
                },
            };
            const native = {
                url: 'https://files.example.test/private',
                id: 'private',
                filename: '<b>literal & text</b>',
            };
            loaded.payload.formRecord.data.fld_files = [native, native];
            let requests = 0,
                revision = 0;
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    requests++;
                    throw new Error('Unexpected request');
                },
            });
            const fields = forms.createFormFieldBindings({
                loaded,
                client,
                getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            fields.attachment = () => {
                throw new Error('No attachment controller');
            };
            const title = fields.field('fld_title');
            let ownershipChecks = 0,
                armed = !notification,
                hidden = false;
            const hostOptions = {
                fields,
                fieldId: 'fld_files',
                isCurrent: () => {
                    if (armed && ++ownershipChecks === hideAt) {
                        assert.equal(title.setValue('Hidden').accepted, true);
                        hidden = true;
                    }
                    return true;
                },
                configurationRevision: () => revision,
            };
            const host = ui.createFormFieldRendererHost(hostOptions);
            if (notification) {
                const second = ui.createFormFieldRendererHost(hostOptions);
                const observed = [];
                const listen = (snapshot) =>
                    observed.push({ snapshot, hidden });
                const stops = [
                    host.subscribe(listen),
                    host.subscribe(listen),
                    second.subscribe(listen),
                ];
                assert.equal(
                    host.getSnapshot().fields[0].attachmentPresentation.status,
                    'ready'
                );
                observed.length = 0;
                armed = true;
                assert.equal(
                    fields.controller.write('fld_title', 'Initial child'),
                    true
                );
                assert.ok(ownershipChecks >= 5);
                assert.ok(observed.length > 0);
                if (hideAt) {
                    assert.ok(observed.some((entry) => entry.hidden));
                    for (const entry of observed.filter(
                        (entry) => entry.hidden
                    ))
                        if (entry.snapshot.status === 'ready')
                            assert.deepEqual(
                                entry.snapshot.fields[0].attachmentPresentation,
                                { status: 'unavailable' }
                            );
                    assert.equal(host.getSnapshot().status, 'hidden');
                } else {
                    assert.ok(
                        observed.some(
                            (entry) =>
                                entry.snapshot.status === 'ready' &&
                                entry.snapshot.fields[0].attachmentPresentation
                                    .status === 'ready'
                        )
                    );
                }
                assert.equal(requests, 0);
                assert.equal(fields.hasPendingFiles(), false);
                stops.forEach((stop) => stop());
                second.dispose();
                host.dispose();
                fields.destroy();
                checks++;
                continue;
            }
            const snapshot = host.getSnapshot();
            assert.equal(snapshot.status, 'ready');
            const props = snapshot.fields[0];
            assert.equal(
                props.capability.type,
                config.readOnly ? 'readonly' : 'editable'
            );
            const expected = hideAt
                ? { status: 'unavailable' }
                : config.obscurePassword || config.maskPasswordOnLoginScreen
                  ? { status: 'masked' }
                  : {
                        status: 'ready',
                        rows: [0, 1].map(() => ({
                            label:
                                config.hideAttachmentName === false
                                    ? native.filename
                                    : 'Attachment',
                        })),
                    };
            assert.deepEqual(props.attachmentPresentation, expected);
            assert.deepEqual(props.value, [native, native]);
            assert.equal(
                ui.dispatchField(
                    {
                        renderMultipleAttachmentsField: (p) =>
                            JSON.stringify(p.attachmentPresentation),
                    },
                    props,
                    () => 'missing'
                ),
                JSON.stringify(expected)
            );
            if (hideAt) {
                assert.equal(ownershipChecks, 5);
                assert.equal(host.getSnapshot().status, 'hidden');
                fields.field('fld_title').setValue('Initial child');
                assert.deepEqual(
                    host.getSnapshot().fields[0].attachmentPresentation,
                    {
                        status: 'ready',
                        rows: [
                            { label: native.filename },
                            { label: native.filename },
                        ],
                    }
                );
            }
            assert.equal(requests, 0);
            assert.equal(fields.hasPendingFiles(), false);
            revision++;
            assert.equal(host.getSnapshot().status, 'retired');
            revision--;
            assert.equal(host.getSnapshot().status, 'retired');
            host.dispose();
            fields.destroy();
            checks++;
        }
    }
    return checks;
}
