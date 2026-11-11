import type { RuntimeLanguage } from '../runtime/types.js';
import type {
    AirtableField,
    AirtableValue,
    TableIdsToLinkedTableLoadingStates,
} from '../formulas/types.js';
import {
    getReadableStringFromAirtableValue,
    type GetReadableStringSource,
} from '../formulas/valueConversion.js';
import { hasRenderableHTMLContent } from '../react/html/sanitizeHTML.js';
import {
    formCompletionLabels,
    type FormCompletionLabels,
} from './completionLabels.js';

export type { FormCompletionLabels } from './completionLabels.js';
export { formCompletionLabels } from './completionLabels.js';

/** Completion-only configuration, structurally compatible with native Form state. */
export type FormCompletionConfiguration = {
    afterFormSubmission?:
        | 'stay'
        | 'readonly'
        | 'redirect'
        | 'newForm'
        | 'close'
        | null;
    successAction?: boolean | null;
    successMessageType?: 'static' | 'airtableField' | null;
    successMessageStatic?: string | null;
    successMessageField?: string | null;
    successMessageDelay?: number | null;
    redirectURLType?: 'static' | 'airtableField' | null;
    redirectURLStatic?: string | null;
    redirectURLField?: string | null;
    enableRedirectDelay?: boolean | null;
    redirectDelay?: number | null;
    reloadFormDelay?: number | null;
    closeDelay?: number | null;
    accessingRecordsMethod?: string | null;
    sessionExpiration?: 'logout' | 'keep' | null;
    successMessageCanCreateNewRecord?: boolean | null;
    successMessageNewRecordText?: string | null;
    allowCopySubmittedToNewForm?: boolean | null;
    allowCopySubmittedToNewFormButtonText?: string | null;
    enableLockingFormAfterSubmission?: boolean | null;
    embeddedFormRedirectType?: '_self' | '_top' | null;
    autoSubmitAfterPrefill?: boolean | null;
};

export type FormCompletionFields = Readonly<
    Record<string, { airtableField: AirtableField } | undefined>
>;
export type ProjectFormCompletionInput = {
    configuration: FormCompletionConfiguration;
    language: RuntimeLanguage;
    /** Messages intentionally use the visible/filtered projection only. */
    filteredValues: Readonly<Record<string, AirtableValue>>;
    /** Redirects intentionally retain the native unfiltered value policy. */
    unfilteredValues: Readonly<Record<string, AirtableValue>>;
    fields: FormCompletionFields;
    linkedTableStates: TableIdsToLinkedTableLoadingStates;
    hasParentExtension?: boolean;
    hasLogout?: boolean;
};
export type FormCompletionProjection = {
    message: { text: string; format: 'html' | 'text' };
    redirectURL: string | null;
    canSubmitAnother: boolean;
    canCopy: boolean;
    /** Seconds selected at the first eligible lifecycle activation. */
    duration: number;
    action: 'close' | 'logout' | 'newForm' | 'redirect' | 'none';
    labels: FormCompletionLabels;
};

const labelsFor = (language: RuntimeLanguage): FormCompletionLabels => {
    const labels = formCompletionLabels[language];
    if (labels === undefined)
        throw new Error(`Unexpected: ${String(language)}`);
    return labels;
};
export const makeDefaultSuccessMessage = (language: RuntimeLanguage): string =>
    labelsFor(language).defaultSuccess;
export const makeRedirectingToNewFormSuccessMessage = (
    language: RuntimeLanguage
): string => labelsFor(language).redirectingToNewForm;
export const makeRedirectingToURLSuccessMessage = (
    language: RuntimeLanguage
): string => labelsFor(language).redirecting;
export const makeDefaultSubmitAnotherFormLabel = (
    language: RuntimeLanguage
): string => labelsFor(language).submitAnother;
export const makeDefaultCopySubmittedFormLabel = (
    language: RuntimeLanguage
): string => labelsFor(language).copySubmitted;
export const resolveSubmitAnotherFormLabel = (args: {
    configuredLabel: string | null | undefined;
    language: RuntimeLanguage;
}): string =>
    args.configuredLabel?.trim()
        ? args.configuredLabel
        : makeDefaultSubmitAnotherFormLabel(args.language);
export const canOfferRootNewRecordActions = (args: {
    accessingRecordsMethod: string | null | undefined;
    hasParentExtension: boolean;
}): boolean =>
    !args.hasParentExtension && args.accessingRecordsMethod !== 'loginPage';
export const automaticNewFormAutoSubmitGuardKey =
    'miniExtSkipAutomaticPrefillSubmitOnce';

/** Preserve exact native singleton lookup, computed failure and blank behavior. */
export function resolveDynamicFormCompletionRedirect(args: {
    value: AirtableValue;
    field: AirtableField;
    source: GetReadableStringSource;
}): string | null {
    const meaningfulValues = Array.isArray(args.value)
        ? args.value.filter((value) => value != null && value !== '')
        : null;
    if (meaningfulValues != null && meaningfulValues.length !== 1) return null;
    const valueToRead = meaningfulValues ?? args.value;
    const valuesToInspect = Array.isArray(valueToRead)
        ? valueToRead
        : [valueToRead];
    if (
        valuesToInspect.some(
            (value) =>
                value != null &&
                typeof value === 'object' &&
                ('error' in value || 'specialValue' in value)
        )
    )
        return null;
    try {
        const value = getReadableStringFromAirtableValue({
            value: valueToRead,
            airtableFieldConfig: args.field.config,
            source: args.source,
            fieldName: args.field.name,
            doNotRemoveMarkdownFormatting: true,
        }).trim();
        return value === '' ? null : value;
    } catch {
        return null;
    }
}

/** Pure current-render projection. It performs no Save, timers or navigation. */
export function projectFormCompletion(
    input: ProjectFormCompletionInput
): FormCompletionProjection {
    const c = input.configuration;
    const defaults = labelsFor(input.language);
    const labels: FormCompletionLabels = {
        ...defaults,
        submitAnother: resolveSubmitAnotherFormLabel({
            configuredLabel: c.successMessageNewRecordText,
            language: input.language,
        }),
        // Unlike Submit another, native copy treats a configured empty label as intentional.
        copySubmitted:
            c.allowCopySubmittedToNewFormButtonText ?? defaults.copySubmitted,
    };
    const source: GetReadableStringSource = {
        type: 'airtableMock',
        linkedTableStates: input.linkedTableStates,
        dateParsing: 'local',
    };
    let redirectURL: string | null = null;
    if (c.afterFormSubmission === 'redirect') {
        if (c.redirectURLType == null || c.redirectURLType === 'static') {
            redirectURL = c.redirectURLStatic ?? null;
        } else {
            const field =
                c.redirectURLField == null
                    ? undefined
                    : input.fields[c.redirectURLField]?.airtableField;
            const value = field ? input.unfilteredValues[field.id] : null;
            if (field != null && value != null && value != '') {
                redirectURL = resolveDynamicFormCompletionRedirect({
                    value,
                    field,
                    source,
                });
            }
        }
    }
    const fallback =
        c.accessingRecordsMethod !== 'loginPage' ||
        c.sessionExpiration === 'keep'
            ? defaults.defaultSuccess
            : defaults.redirecting;
    let message: FormCompletionProjection['message'];
    if (c.successMessageType == null || c.successMessageType === 'static') {
        message = {
            text:
                c.successMessageStatic != null &&
                hasRenderableHTMLContent(c.successMessageStatic)
                    ? c.successMessageStatic
                    : fallback,
            format: 'html',
        };
    } else {
        const field =
            c.successMessageField == null
                ? undefined
                : input.fields[c.successMessageField]?.airtableField;
        const value = field ? input.filteredValues[field.id] : null;
        const text =
            field != null && value != null
                ? getReadableStringFromAirtableValue({
                      value,
                      airtableFieldConfig: field.config,
                      source,
                      fieldName: field.name,
                      doNotRemoveMarkdownFormatting: true,
                  })
                : '';
        message = {
            text: text.trim() === '' ? fallback : text,
            format: 'text',
        };
    }
    const rootActions =
        !input.hasLogout &&
        canOfferRootNewRecordActions({
            accessingRecordsMethod: c.accessingRecordsMethod,
            hasParentExtension: input.hasParentExtension === true,
        }) &&
        c.afterFormSubmission === 'stay' &&
        c.successAction === true;
    const action =
        c.afterFormSubmission === 'close'
            ? 'close'
            : input.hasLogout
              ? 'logout'
              : c.afterFormSubmission === 'newForm'
                ? 'newForm'
                : redirectURL
                  ? 'redirect'
                  : 'none';
    const duration =
        (c.successMessageDelay ?? 0) +
        (c.afterFormSubmission === 'newForm'
            ? (c.reloadFormDelay ?? 5)
            : c.afterFormSubmission === 'redirect'
              ? c.enableRedirectDelay === true
                  ? (c.redirectDelay ?? 2)
                  : 2
              : (c.closeDelay ?? 2));
    return {
        message,
        redirectURL,
        canSubmitAnother:
            rootActions && c.successMessageCanCreateNewRecord === true,
        canCopy:
            rootActions &&
            c.allowCopySubmittedToNewForm === true &&
            c.enableLockingFormAfterSubmission !== true,
        duration,
        action,
        labels,
    };
}

export type FormCompletionNavigationAction =
    | 'copy_form'
    | 'submit_another_form'
    | 'automatic_new_form';
export type FormCompletionNavigateCommand = {
    type: 'navigate';
    /** Raw relative targets stay relative to the host route that receives them. */
    url: string;
    route: 'self' | 'parent' | 'generated-parent';
    iframeId?: string;
};
export type FormCompletionCloseCommand = {
    type: 'close';
    route: 'self' | 'generated-parent';
    iframeId?: string;
};
export type FormCompletionCommand =
    | { type: 'logout' }
    | FormCompletionNavigateCommand
    | FormCompletionCloseCommand;
export type ProjectFormCompletionNavigationInput = {
    currentURL: string;
    redirectURL?: string | null;
    embeddedFormRedirectType?: '_self' | '_top' | null;
    inIframe: boolean;
    recordId?: string | null;
    hasLogout?: boolean;
    autoSubmitAfterPrefill?: boolean | null;
    command?: FormCompletionNavigationAction;
};

/** Compatibility normalization, not receiver protocol/source authorization. */
export function normalizeFormCompletionRedirectURL(url: string): string {
    return !/^(https?:\/\/|mailto:|tel:)/i.test(url) && !url.startsWith('/')
        ? `https://${url}`
        : url;
}

/** Ordered commands only; dispatch does not acknowledge navigation or logout. */
export function projectFormCompletionNavigation(
    input: ProjectFormCompletionNavigationInput
): FormCompletionCommand[] {
    const current = new URL(input.currentURL);
    // Native redirect routing uses the final query value when a key is repeated.
    const iframeId = Object.fromEntries(current.searchParams.entries())[
        'miniExtIframeId'
    ];
    const route =
        input.inIframe && input.embeddedFormRedirectType === '_top'
            ? iframeId
                ? 'generated-parent'
                : 'parent'
            : 'self';
    const navigate = (url: string): FormCompletionNavigateCommand => ({
        type: 'navigate',
        url,
        route,
        ...(route === 'generated-parent' ? { iframeId } : {}),
    });
    const redirectURL = input.redirectURL
        ? normalizeFormCompletionRedirectURL(input.redirectURL)
        : input.redirectURL;
    if (input.hasLogout) {
        return redirectURL
            ? [{ type: 'logout' }, navigate(redirectURL)]
            : [{ type: 'logout' }];
    }
    if (redirectURL) return [navigate(redirectURL)];
    if (input.command === 'copy_form') {
        if (input.recordId == null) throw new Error('recordId is needed');
        current.searchParams.set('recordIdToCopyFrom', input.recordId);
    } else if (input.command != null) {
        current.searchParams.delete('recordIdToCopyFrom');
        if (
            input.command === 'automatic_new_form' &&
            input.autoSubmitAfterPrefill === true
        ) {
            current.searchParams.set(
                automaticNewFormAutoSubmitGuardKey,
                'true'
            );
        }
    }
    const recordIdIndex = current.pathname.indexOf('/rec');
    if (recordIdIndex !== -1) {
        current.searchParams.delete('screen');
        current.pathname = current.pathname.slice(0, recordIdIndex);
    }
    return [navigate(current.toString())];
}

export type ProjectFormCompletionCloseInput = {
    currentURL: string;
    inIframe: boolean;
};
export function projectFormCompletionClose(
    input: ProjectFormCompletionCloseInput
): FormCompletionCloseCommand {
    const iframeId = new URL(input.currentURL).searchParams.get(
        'miniExtIframeId'
    );
    return input.inIframe && iframeId != null
        ? { type: 'close', route: 'generated-parent', iframeId }
        : { type: 'close', route: 'self' };
}
