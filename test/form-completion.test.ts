import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    projectFormCompletion,
    projectFormCompletionNavigation,
    projectFormCompletionClose,
    normalizeFormCompletionRedirectURL,
    resolveDynamicFormCompletionRedirect,
    makeDefaultSuccessMessage,
    makeDefaultSubmitAnotherFormLabel,
    makeDefaultCopySubmittedFormLabel,
    makeRedirectingToNewFormSuccessMessage,
    makeRedirectingToURLSuccessMessage,
    resolveSubmitAnotherFormLabel,
    canOfferRootNewRecordActions,
    automaticNewFormAutoSubmitGuardKey,
    type ProjectFormCompletionInput,
    type ProjectFormCompletionNavigationInput,
    type FormCompletionConfiguration,
    type FormCompletionNavigateCommand,
} from '../src/forms/index.js';
import {
    AirtableFieldType,
    type AirtableField,
    type AirtableValue,
} from '../src/formulas/index.js';
import type { RuntimeLanguage } from '../src/runtime/types.js';
import {
    textField,
    numberField,
    dateField,
    linkedField,
    makeLinkedState,
    syntheticLinkedRecordId,
} from './fixtures.js';

function project(
    configuration: FormCompletionConfiguration = {},
    patch: Partial<ProjectFormCompletionInput> = {}
) {
    return projectFormCompletion({
        configuration,
        language: 'en',
        filteredValues: {},
        unfilteredValues: {},
        fields: {},
        linkedTableStates: {},
        ...patch,
    });
}
const lookup: AirtableField = {
    id: 'fld_actual_lookup',
    name: 'Destination lookup',
    config: {
        type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
        options: { isValid: true, result: textField.config },
    },
};
const dynamic = (field: AirtableField, value: AirtableValue) =>
    project(
        {
            afterFormSubmission: 'redirect',
            redirectURLType: 'airtableField',
            redirectURLField: 'configured-key',
        },
        {
            fields: { 'configured-key': { airtableField: field } },
            unfilteredValues: { [field.id]: value },
        }
    );

describe('complete Form current projection', () => {
    it('runs without a browser and keeps projection separate from external effects', () => {
        assert.equal(typeof window, 'undefined');
        assert.equal(typeof document, 'undefined');
        assert.deepEqual(project().message, {
            text: 'Form submitted successfully',
            format: 'html',
        });
        assert.equal(project().action, 'none');
    });
    for (const html of [
        '',
        '<p><br></p>',
        '<p>&nbsp;\u200b</p>',
        '<script>untrusted()</script>',
        '<input value="private">',
    ]) {
        it(`uses localized fallback for nonrenderable static content ${JSON.stringify(html)}`, () => {
            assert.deepEqual(
                project({ successMessageStatic: html }, { language: 'fr' })
                    .message,
                {
                    text: 'Formulaire soumis avec succès',
                    format: 'html',
                }
            );
        });
    }
    for (const html of [
        '<p>Saved <strong>well</strong></p>',
        '<img src="https://example.invalid/picture">',
        '<iframe src="https://example.invalid/embed"></iframe>',
    ]) {
        it(`retains meaningful static HTML for the shared semantic renderer ${JSON.stringify(html)}`, () => {
            assert.deepEqual(project({ successMessageStatic: html }).message, {
                text: html,
                format: 'html',
            });
        });
    }
    it('reads message only from filtered values and redirect only from unfiltered schema IDs', () => {
        const output = project(
            {
                successMessageType: 'airtableField',
                successMessageField: 'configured-message',
                afterFormSubmission: 'redirect',
                redirectURLType: 'airtableField',
                redirectURLField: 'configured-redirect',
            },
            {
                fields: {
                    'configured-message': { airtableField: textField },
                    'configured-redirect': {
                        airtableField: { ...textField, id: 'fld_destination' },
                    },
                },
                filteredValues: {
                    [textField.id]:
                        '<b>literal</b> https://example.invalid/visible',
                    fld_destination: '/wrong-filtered',
                },
                unfilteredValues: {
                    [textField.id]: 'hidden message must not appear',
                    fld_destination: ' /parent-relative?next=1#hash ',
                },
            }
        );
        assert.deepEqual(output.message, {
            text: '<b>literal</b> https://example.invalid/visible',
            format: 'text',
        });
        assert.equal(output.redirectURL, '/parent-relative?next=1#hash');
    });
    it('does not look up configured field keys directly in record values', () => {
        const output = project(
            {
                successMessageType: 'airtableField',
                successMessageField: 'alias',
                afterFormSubmission: 'redirect',
                redirectURLType: 'airtableField',
                redirectURLField: 'alias',
            },
            {
                fields: { alias: { airtableField: textField } },
                filteredValues: { alias: 'wrong message' },
                unfilteredValues: { alias: 'wrong.invalid' },
            }
        );
        assert.equal(output.message.text, makeDefaultSuccessMessage('en'));
        assert.equal(output.message.format, 'text');
        assert.equal(output.redirectURL, null);
    });
    it('retains dynamic whitespace around nonblank readable messages', () => {
        const output = project(
            {
                successMessageType: 'airtableField',
                successMessageField: 'message',
            },
            {
                fields: { message: { airtableField: textField } },
                filteredValues: { [textField.id]: '  **Saved**\n  ' },
            }
        );
        assert.deepEqual(output.message, {
            text: '  **Saved**\n  ',
            format: 'text',
        });
    });
    it('uses logout-style message fallback for login expiry and the ordinary fallback for keep', () => {
        for (const successMessageType of ['static', 'airtableField'] as const) {
            assert.equal(
                project({
                    accessingRecordsMethod: 'loginPage',
                    successMessageType,
                }).message.text,
                'Redirecting...'
            );
            assert.equal(
                project({
                    accessingRecordsMethod: 'loginPage',
                    sessionExpiration: 'keep',
                    successMessageType,
                }).message.text,
                'Form submitted successfully'
            );
        }
    });
    it('converts linked values with current linked state and preserves local readable date policy', () => {
        const common = {
            successMessageType: 'airtableField',
            successMessageField: 'message',
        } as const;
        assert.equal(
            project(common, {
                fields: { message: { airtableField: linkedField } },
                filteredValues: { [linkedField.id]: [syntheticLinkedRecordId] },
                linkedTableStates: makeLinkedState(undefined, {
                    [textField.id]: 'Current title',
                }),
            }).message.text,
            'Current title'
        );
        assert.equal(
            project(common, {
                fields: { message: { airtableField: dateField } },
                filteredValues: { [dateField.id]: '2026-11-11' },
            }).message.text,
            '2026-11-11'
        );
    });
    it('retains message converter failures while dynamic redirect converts failures to no target', () => {
        assert.throws(
            () =>
                project(
                    {
                        successMessageType: 'airtableField',
                        successMessageField: 'message',
                    },
                    {
                        fields: { message: { airtableField: numberField } },
                        filteredValues: { [numberField.id]: 'invalid number' },
                    }
                ),
            Error
        );
        assert.equal(dynamic(numberField, 'invalid number').redirectURL, null);
    });
    for (const [label, value, expected] of [
        [
            'one nonblank URL',
            [null, '', ' https://example.invalid/path ', undefined],
            'https://example.invalid/path',
        ],
        ['empty list', [], null],
        ['only blanks', [null, '', undefined], null],
        ['multiple targets', ['one.invalid', 'two.invalid'], null],
        ['single whitespace', ['   '], null],
        ['computed error', [{ error: '#ERROR!' }], null],
        ['computed special value', [{ specialValue: 'NaN' }], null],
    ] satisfies [string, AirtableValue, string | null][]) {
        it(`uses exact singleton lookup redirect policy for ${label}`, () => {
            assert.equal(dynamic(lookup, value).redirectURL, expected);
        });
    }
    it('rejects direct computed failures without stringifying error objects', () => {
        assert.equal(
            dynamic(numberField, { error: '#ERROR!' }).redirectURL,
            null
        );
        assert.equal(
            dynamic(numberField, { specialValue: 'Infinity' }).redirectURL,
            null
        );
        assert.equal(
            resolveDynamicFormCompletionRedirect({
                value: [1, 2],
                field: numberField,
                source: {
                    type: 'airtableMock',
                    linkedTableStates: {},
                    dateParsing: 'local',
                },
            }),
            null
        );
    });
    it('does not read redirect fields outside redirect mode and keeps static redirect whitespace', () => {
        assert.equal(
            project({
                afterFormSubmission: 'stay',
                redirectURLStatic: 'wrong.invalid',
            }).redirectURL,
            null
        );
        assert.equal(
            project({
                afterFormSubmission: 'redirect',
                redirectURLStatic: ' example.invalid ',
            }).redirectURL,
            ' example.invalid '
        );
    });
    for (const [configuration, expected] of [
        [{ afterFormSubmission: 'newForm' }, 5],
        [
            {
                afterFormSubmission: 'newForm',
                reloadFormDelay: 0,
                successMessageDelay: 0,
            },
            0,
        ],
        [
            {
                afterFormSubmission: 'newForm',
                reloadFormDelay: 3,
                successMessageDelay: 2,
            },
            5,
        ],
        [
            {
                afterFormSubmission: 'redirect',
                redirectDelay: 9,
                successMessageDelay: 1,
            },
            3,
        ],
        [
            {
                afterFormSubmission: 'redirect',
                enableRedirectDelay: true,
                redirectDelay: 0,
                successMessageDelay: 1,
            },
            1,
        ],
        [
            {
                afterFormSubmission: 'redirect',
                enableRedirectDelay: true,
                redirectDelay: null,
            },
            2,
        ],
        [
            {
                afterFormSubmission: 'close',
                closeDelay: 0,
                successMessageDelay: 2,
            },
            2,
        ],
        [{ afterFormSubmission: 'stay' }, 2],
    ] satisfies [FormCompletionConfiguration, number][]) {
        it(`projects selected action duration ${JSON.stringify(configuration)}`, () => {
            assert.equal(project(configuration).duration, expected);
        });
    }
    it('keeps close exclusive, then logout, new form and redirect action precedence', () => {
        assert.equal(
            project({ afterFormSubmission: 'close' }, { hasLogout: true })
                .action,
            'close'
        );
        assert.equal(
            project({ afterFormSubmission: 'newForm' }, { hasLogout: true })
                .action,
            'logout'
        );
        assert.equal(
            project({ afterFormSubmission: 'newForm' }).action,
            'newForm'
        );
        assert.equal(
            project({
                afterFormSubmission: 'redirect',
                redirectURLStatic: '/next',
            }).action,
            'redirect'
        );
        assert.equal(
            project({ afterFormSubmission: 'redirect', redirectURLStatic: '' })
                .action,
            'none'
        );
        assert.equal(
            project({ afterFormSubmission: 'readonly' }).action,
            'none'
        );
    });
    it('offers root new/copy actions only in stay with success enabled and distinct locking rules', () => {
        const configuration: FormCompletionConfiguration = {
            afterFormSubmission: 'stay',
            successAction: true,
            successMessageCanCreateNewRecord: true,
            allowCopySubmittedToNewForm: true,
        };
        assert.equal(project(configuration).canSubmitAnother, true);
        assert.equal(project(configuration).canCopy, true);
        assert.equal(
            project({
                ...configuration,
                enableLockingFormAfterSubmission: true,
            }).canSubmitAnother,
            true
        );
        assert.equal(
            project({
                ...configuration,
                enableLockingFormAfterSubmission: true,
            }).canCopy,
            false
        );
        for (const patch of [
            { hasLogout: true },
            { hasParentExtension: true },
        ]) {
            assert.equal(project(configuration, patch).canSubmitAnother, false);
            assert.equal(project(configuration, patch).canCopy, false);
        }
        for (const patch of [
            { accessingRecordsMethod: 'loginPage' },
            { successAction: false },
            { afterFormSubmission: 'readonly' as const },
            { afterFormSubmission: 'redirect' as const },
            { afterFormSubmission: 'newForm' as const },
            { afterFormSubmission: 'close' as const },
        ]) {
            assert.equal(
                project({ ...configuration, ...patch }).canSubmitAnother,
                false
            );
            assert.equal(
                project({ ...configuration, ...patch }).canCopy,
                false
            );
        }
    });
    it('keeps custom submit whitespace fallback distinct from configured empty copy label', () => {
        assert.equal(
            resolveSubmitAnotherFormLabel({
                configuredLabel: ' \n ',
                language: 'fr',
            }),
            'Soumettre un autre formulaire'
        );
        assert.equal(
            resolveSubmitAnotherFormLabel({
                configuredLabel: ' Custom  ',
                language: 'fr',
            }),
            ' Custom  '
        );
        assert.equal(
            project({ allowCopySubmittedToNewFormButtonText: '' }).labels
                .copySubmitted,
            ''
        );
        assert.equal(
            project({ allowCopySubmittedToNewFormButtonText: ' ' }).labels
                .copySubmitted,
            ' '
        );
        assert.equal(
            canOfferRootNewRecordActions({
                accessingRecordsMethod: 'loginPage',
                hasParentExtension: false,
            }),
            false
        );
        assert.equal(
            canOfferRootNewRecordActions({
                accessingRecordsMethod: 'recordId',
                hasParentExtension: true,
            }),
            false
        );
    });
    for (const [language, expected] of [
        ['en', 'Form submitted successfully'],
        ['es', 'Formulario enviado con éxito'],
        ['fr', 'Formulaire soumis avec succès'],
        ['vi', 'Đã gửi biểu mẫu thành công'],
        ['nl', 'Formulier succesvol verzonden'],
        ['de', 'Formular erfolgreich übermittelt'],
        ['ja', 'フォームが正常に送信されました'],
        ['ko', '양식이 성공적으로 제출되었습니다'],
        ['pt', 'Formulário enviado com sucesso'],
        ['cs', 'Formulář byl úspěšně odeslán'],
        ['he', 'טופס נשלח בהצלחה'],
        ['it', 'Modulo inviato con successo'],
        ['ka', 'ფორმა წარმოებულია წარმატებით'],
        ['zh-Hans', '表单已成功提交'],
        ['ca', 'Formulari enviat correctament'],
    ] satisfies [RuntimeLanguage, string][]) {
        it(`projects native completion and action labels in ${language}`, () => {
            const output = project({}, { language });
            assert.equal(output.message.text, expected);
            assert.equal(
                output.labels.submitAnother,
                makeDefaultSubmitAnotherFormLabel(language)
            );
            assert.equal(
                output.labels.copySubmitted,
                makeDefaultCopySubmittedFormLabel(language)
            );
            assert.equal(
                output.labels.redirectingToNewForm,
                makeRedirectingToNewFormSuccessMessage(language)
            );
            assert.equal(
                output.labels.redirecting,
                makeRedirectingToURLSuccessMessage(language)
            );
        });
    }
});

const currentURL =
    'https://form.invalid/p/extension/recOriginal?prefill_Title=Keep&recordIdToCopyFrom=recOld&screen=success&miniExtIframeId=frame-1#section';
function plan(patch: Partial<ProjectFormCompletionNavigationInput> = {}) {
    return projectFormCompletionNavigation({
        currentURL,
        inIframe: false,
        ...patch,
    });
}
function target(
    commands: ReturnType<typeof plan>
): FormCompletionNavigateCommand {
    const value = commands.find((command) => command.type === 'navigate');
    assert.ok(value && value.type === 'navigate');
    return value;
}

describe('pure completion navigation commands', () => {
    it('orders logout before raw-relative generated-parent redirect without claiming success', () => {
        assert.deepEqual(
            plan({
                redirectURL: '/parent-target?q=1#hash',
                hasLogout: true,
                inIframe: true,
                embeddedFormRedirectType: '_top',
            }),
            [
                { type: 'logout' },
                {
                    type: 'navigate',
                    url: '/parent-target?q=1#hash',
                    route: 'generated-parent',
                    iframeId: 'frame-1',
                },
            ]
        );
        assert.deepEqual(
            plan({ hasLogout: true, command: 'copy_form', recordId: null }),
            [{ type: 'logout' }]
        );
    });
    it('gives configured redirect precedence over manual copy/new path rewriting', () => {
        assert.deepEqual(
            plan({
                redirectURL: 'example.invalid/path',
                command: 'copy_form',
                recordId: null,
            }),
            [
                {
                    type: 'navigate',
                    url: 'https://example.invalid/path',
                    route: 'self',
                },
            ]
        );
    });
    for (const [value, expected] of [
        ['/relative', '/relative'],
        ['//protocol-relative.invalid', '//protocol-relative.invalid'],
        ['HTTPS://example.invalid', 'HTTPS://example.invalid'],
        ['hTtP://example.invalid', 'hTtP://example.invalid'],
        ['mailto:hello@example.invalid', 'mailto:hello@example.invalid'],
        ['TEL:+123', 'TEL:+123'],
        ['example.invalid/path', 'https://example.invalid/path'],
    ]) {
        it(`normalizes compatible protocol without resolving ${value}`, () => {
            assert.equal(normalizeFormCompletionRedirectURL(value), expected);
            assert.equal(target(plan({ redirectURL: value })).url, expected);
        });
    }
    it('projects self, plain-parent and generated-parent routing explicitly', () => {
        assert.equal(target(plan({ inIframe: true })).route, 'self');
        assert.equal(
            target(plan({ inIframe: false, embeddedFormRedirectType: '_top' }))
                .route,
            'self'
        );
        assert.deepEqual(
            target(
                plan({
                    currentURL: 'https://form.invalid/p/ext',
                    inIframe: true,
                    embeddedFormRedirectType: '_top',
                    redirectURL: '/next',
                })
            ),
            { type: 'navigate', route: 'parent', url: '/next' }
        );
        assert.equal(
            target(plan({ inIframe: true, embeddedFormRedirectType: '_top' }))
                .route,
            'generated-parent'
        );
    });
    it('sets copy source, strips record segment/screen and preserves prefills/hash', () => {
        const url = new URL(
            target(plan({ command: 'copy_form', recordId: 'recSubmitted' })).url
        );
        assert.equal(url.pathname, '/p/extension');
        assert.equal(
            url.searchParams.get('recordIdToCopyFrom'),
            'recSubmitted'
        );
        assert.equal(url.searchParams.has('screen'), false);
        assert.equal(url.searchParams.get('prefill_Title'), 'Keep');
        assert.equal(url.searchParams.get('miniExtIframeId'), 'frame-1');
        assert.equal(url.hash, '#section');
    });
    it('rejects copy without a record only when copy path is actually needed', () => {
        assert.throws(() => plan({ command: 'copy_form' }), Error);
    });
    it('distinguishes manual new from guarded automatic new', () => {
        const manual = new URL(
            target(
                plan({
                    command: 'submit_another_form',
                    autoSubmitAfterPrefill: true,
                })
            ).url
        );
        const automatic = new URL(
            target(
                plan({
                    command: 'automatic_new_form',
                    autoSubmitAfterPrefill: true,
                })
            ).url
        );
        const noAutoSubmit = new URL(
            target(
                plan({
                    command: 'automatic_new_form',
                    autoSubmitAfterPrefill: false,
                })
            ).url
        );
        for (const url of [manual, automatic, noAutoSubmit]) {
            assert.equal(url.searchParams.has('recordIdToCopyFrom'), false);
            assert.equal(url.searchParams.has('screen'), false);
            assert.equal(url.hash, '#section');
        }
        assert.equal(
            manual.searchParams.has(automaticNewFormAutoSubmitGuardKey),
            false
        );
        assert.equal(
            automatic.searchParams.get(automaticNewFormAutoSubmitGuardKey),
            'true'
        );
        assert.equal(
            noAutoSubmit.searchParams.has(automaticNewFormAutoSubmitGuardKey),
            false
        );
    });
    it('keeps screen on a root path and retains query state for commandless navigation', () => {
        const url = new URL(
            target(
                plan({
                    currentURL:
                        'https://form.invalid/p/ext?screen=review&recordIdToCopyFrom=recOld#kept',
                })
            ).url
        );
        assert.equal(url.searchParams.get('screen'), 'review');
        assert.equal(url.searchParams.get('recordIdToCopyFrom'), 'recOld');
        assert.equal(url.hash, '#kept');
    });
    it('preserves native final redirect iframe ID versus first close iframe ID', () => {
        const url =
            'https://form.invalid/p/ext?miniExtIframeId=first&miniExtIframeId=last';
        assert.equal(
            target(
                plan({
                    currentURL: url,
                    inIframe: true,
                    embeddedFormRedirectType: '_top',
                })
            ).iframeId,
            'last'
        );
        assert.deepEqual(
            projectFormCompletionClose({ currentURL: url, inIframe: true }),
            { type: 'close', route: 'generated-parent', iframeId: 'first' }
        );
    });
    it('uses generated close independently of redirect target setting and never invents an acknowledgment', () => {
        assert.deepEqual(
            projectFormCompletionClose({ currentURL, inIframe: true }),
            { type: 'close', route: 'generated-parent', iframeId: 'frame-1' }
        );
        assert.deepEqual(
            projectFormCompletionClose({ currentURL, inIframe: false }),
            { type: 'close', route: 'self' }
        );
        assert.deepEqual(
            projectFormCompletionClose({
                currentURL: 'https://form.invalid/?miniExtIframeId=',
                inIframe: true,
            }),
            { type: 'close', route: 'generated-parent', iframeId: '' }
        );
        assert.deepEqual(
            projectFormCompletionClose({
                currentURL: 'https://form.invalid/',
                inIframe: true,
            }),
            { type: 'close', route: 'self' }
        );
    });
});
