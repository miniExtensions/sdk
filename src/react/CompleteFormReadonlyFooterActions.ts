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

const iconPaths = {
    submit_another_form: [
        {
            d: 'M12 5.25c1.213 0 2.415.046 3.605.135a3.256 3.256 0 0 1 3.01 3.01c.044.583.077 1.17.1 1.759L17.03 8.47a.75.75 0 1 0-1.06 1.06l3 3a.75.75 0 0 0 1.06 0l3-3a.75.75 0 0 0-1.06-1.06l-1.752 1.751c-.023-.65-.06-1.296-.108-1.939a4.756 4.756 0 0 0-4.392-4.392 49.422 49.422 0 0 0-7.436 0A4.756 4.756 0 0 0 3.89 8.282c-.017.224-.033.447-.046.672a.75.75 0 1 0 1.497.092c.013-.217.028-.434.044-.651a3.256 3.256 0 0 1 3.01-3.01c1.19-.09 2.392-.135 3.605-.135Zm-6.97 6.22a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 1 0 1.06 1.06l1.752-1.751c.023.65.06 1.296.108 1.939a4.756 4.756 0 0 0 4.392 4.392 49.413 49.413 0 0 0 7.436 0 4.756 4.756 0 0 0 4.392-4.392c.017-.223.032-.447.046-.672a.75.75 0 0 0-1.497-.092c-.013.217-.028.434-.044.651a3.256 3.256 0 0 1-3.01 3.01 47.953 47.953 0 0 1-7.21 0 3.256 3.256 0 0 1-3.01-3.01 47.759 47.759 0 0 1-.1-1.759L6.97 15.53a.75.75 0 0 0 1.06-1.06l-3-3Z',
            fillRule: 'evenodd',
            clipRule: 'evenodd',
        },
    ],
    copy_form: [
        {
            d: 'M7.5 3.375c0-1.036.84-1.875 1.875-1.875h.375a3.75 3.75 0 0 1 3.75 3.75v1.875C13.5 8.161 14.34 9 15.375 9h1.875A3.75 3.75 0 0 1 21 12.75v3.375C21 17.16 20.16 18 19.125 18h-9.75A1.875 1.875 0 0 1 7.5 16.125V3.375Z',
        },
        {
            d: 'M15 5.25a5.23 5.23 0 0 0-1.279-3.434 9.768 9.768 0 0 1 6.963 6.963A5.23 5.23 0 0 0 17.25 7.5h-1.875A.375.375 0 0 1 15 7.125V5.25ZM4.875 6H6v10.125A3.375 3.375 0 0 0 9.375 19.5H16.5v1.125c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V7.875C3 6.839 3.84 6 4.875 6Z',
        },
    ],
};

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
    /** Use the host's button styles while retaining the footer icon layout. */
    unstyled?: boolean;
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
    unstyled,
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

    const className = [
        'mx-sdk-form-readonly-footer-action',
        !unstyled && 'mx-sdk-form-readonly-footer-action--styled',
        buttonClassName,
    ]
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
            h(
                'svg',
                {
                    className: 'mx-sdk-form-readonly-footer-icon',
                    width: 16,
                    height: 16,
                    viewBox: '0 0 24 24',
                    fill: 'currentColor',
                    'aria-hidden': true,
                    focusable: 'false',
                },
                ...iconPaths[command].map((path) => h('path', path))
            ),
            h('span', null, label)
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
