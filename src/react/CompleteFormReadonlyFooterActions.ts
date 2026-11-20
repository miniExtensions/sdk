import { createElement as h, Fragment, type ReactElement } from 'react';
import {
    canOfferRootNewRecordActions,
    makeDefaultCopySubmittedFormLabel,
    resolveSubmitAnotherFormLabel,
    type FormCompletionConfiguration,
    type FormCompletionNavigationAction,
} from '../forms/completion.js';
import type { RuntimeLanguage, SaveFormInput } from '../runtime/types.js';

export type FormReadonlyFooterAction = Extract<
    FormCompletionNavigationAction,
    'submit_another_form' | 'copy_form'
>;

export type CompleteFormReadonlyFooterActionsProps = {
    configuration: Pick<
        FormCompletionConfiguration,
        | 'accessingRecordsMethod'
        | 'successMessageCanCreateNewRecord'
        | 'successMessageNewRecordText'
        | 'allowCopySubmittedToNewForm'
        | 'allowCopySubmittedToNewFormButtonText'
        | 'enableLockingFormAfterSubmission'
    >;
    language: RuntimeLanguage;
    mode: 'readonly' | 'editable' | 'config-preview';
    context: SaveFormInput['context']['type'];
    hasParentExtension: boolean;
    /** The host owns the actual record ID used by Copy. */
    hasExistingRecord: boolean;
    /** The host handles navigation using its current Form and record context. */
    onCommand: (command: FormReadonlyFooterAction) => void;
    disabled?: boolean;
    /** Added to each button. The host owns the surrounding footer layout. */
    buttonClassName?: string;
};

/** Read-only Form footer controls, independent of post-save completion. */
export function CompleteFormReadonlyFooterActions({
    configuration,
    language,
    mode,
    context,
    hasParentExtension,
    hasExistingRecord,
    onCommand,
    disabled,
    buttonClassName,
}: CompleteFormReadonlyFooterActionsProps): ReactElement | null {
    if (mode !== 'readonly' || context === 'modal') return null;
    const canSubmitAnother =
        configuration.successMessageCanCreateNewRecord === true &&
        canOfferRootNewRecordActions({
            hasParentExtension,
            accessingRecordsMethod: configuration.accessingRecordsMethod,
        });
    const canCopy =
        hasExistingRecord &&
        configuration.allowCopySubmittedToNewForm === true &&
        configuration.enableLockingFormAfterSubmission !== true;
    if (!canSubmitAnother && !canCopy) return null;

    const className = ['mx-sdk-form-readonly-footer-action', buttonClassName]
        .filter(Boolean)
        .join(' ');
    const button = (
        command: FormReadonlyFooterAction,
        label: string,
        accessibleLabel?: string
    ) =>
        h(
            'button',
            {
                type: 'button',
                className,
                'aria-label': accessibleLabel,
                disabled,
                onClick: () => {
                    if (!disabled) onCommand(command);
                },
            },
            label
        );

    let copyButton: ReactElement | null = null;
    if (canCopy) {
        const label = configuration.allowCopySubmittedToNewFormButtonText;
        const defaultLabel = makeDefaultCopySubmittedFormLabel(language);
        copyButton = button(
            'copy_form',
            label ?? defaultLabel,
            label?.trim() === '' ? defaultLabel : undefined
        );
    }
    return h(
        Fragment,
        null,
        canSubmitAnother &&
            button(
                'submit_another_form',
                resolveSubmitAnotherFormLabel({
                    configuredLabel: configuration.successMessageNewRecordText,
                    language,
                })
            ),
        copyButton
    );
}
