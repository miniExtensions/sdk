import {
    createElement as h,
    Fragment,
    useRef,
    useState,
    type FormEventHandler,
    type ReactElement,
    type ReactNode,
} from 'react';
import {
    CompleteFormCompletion,
    type CompleteFormCompletionProps,
} from './CompleteFormCompletion.js';
import {
    CompleteFormFooterDescription,
    CompleteFormHeader,
    type CompleteFormFooterDescriptionProps,
    type CompleteFormHeaderProps,
} from './CompleteFormHeader.js';
import {
    CompleteFormPageNavigation,
    FormNextKeyboardFocusContext,
    FormPageNavigationButton,
    type CompleteFormPageNavigationProps,
    type FormPageNavigationButtonProps,
} from './CompleteFormPageNavigation.js';
import {
    CompleteFormReview,
    type CompleteFormReviewProps,
} from './CompleteFormReview.js';
import {
    CompleteFormTrackingDisclosure,
    type CompleteFormTrackingDisclosureProps,
} from './CompleteFormTrackingDisclosure.js';
import { FormCaptcha, type FormCaptchaProps } from './FormCaptcha.js';
import { FormGroup, type FormGroupProps } from './FormGroup.js';
import {
    FormSubmitButton,
    type FormSubmitButtonProps,
} from './FormSubmitButton.js';
import {
    FormValidationSummary,
    type FormValidationSummaryProps,
} from './FormValidationSummary.js';

export type FormCompositionField = Readonly<{
    kind: 'field';
    key: string;
    /** An existing, host-authorized field node and its original form association. */
    node: ReactNode;
}>;

export type FormCompositionItem =
    | FormCompositionField
    | Readonly<{
          kind: 'group';
          key: string;
          /** Accepted visibility, error and initial disclosure state. */
          group: Omit<FormGroupProps, 'children'>;
          fields: readonly FormCompositionField[];
      }>;

export type FormCompositionPrimaryAction =
    | Readonly<
          { kind: 'next' } & Omit<
              FormPageNavigationButtonProps,
              'direction' | 'type' | 'form' | 'onClick'
          >
      >
    | Readonly<{ kind: 'terminal' } & Omit<FormSubmitButtonProps, 'formId'>>;

/** Existing host-adapted leaves, including their settings wrappers and refs. */
export type FormCompositionHostSlots = Readonly<{
    header?: ReactNode;
    pageNavigation?: ReactNode;
    captcha?: ReactNode;
    footerDescription?: ReactNode;
    review?: ReactNode;
    completion?: ReactNode;
}>;

export type CompleteFormCompositionProps<CaptchaOptions = unknown> = Readonly<{
    formId: string;
    /** The host admits the current Next, Compute, Review or Save intent. */
    onSubmit: FormEventHandler<HTMLFormElement>;
    items: readonly FormCompositionItem[];
    emptyMessage?: ReactNode;
    header?: CompleteFormHeaderProps;
    pageNavigation?: CompleteFormPageNavigationProps;
    captcha?: FormCaptchaProps<string, CaptchaOptions>;
    validation?: FormValidationSummaryProps;
    footerDescription?: CompleteFormFooterDescriptionProps;
    tracking?: CompleteFormTrackingDisclosureProps;
    review?: CompleteFormReviewProps;
    completion?: CompleteFormCompletionProps;
    back?: Omit<FormPageNavigationButtonProps, 'direction' | 'type' | 'form'>;
    primary?: FormCompositionPrimaryAction;
    /** A native authoring decoration around the existing public primary control. */
    decoratePrimary?: (control: ReactElement) => ReactNode;
    /** An existing in-body host notification or completion adapter. */
    afterFields?: ReactNode;
    /** Host-only feedback, such as an administrative or transport error notice. */
    feedback?: ReactNode;
    /** An admitted existing host record-action surface. */
    recordActions?: ReactNode;
    footerLabel?: string;
    slots?: FormCompositionHostSlots;
    className?: string;
    bodyClassName?: string;
    fieldsClassName?: string;
    footerClassName?: string;
    footerDetailsClassName?: string;
    actionsClassName?: string;
}>;

function renderField(field: FormCompositionField): ReactElement {
    return h(Fragment, { key: field.key }, field.node);
}

function renderItem(item: FormCompositionItem): ReactElement {
    if (item.kind === 'field') return renderField(item);
    return h(FormGroup, {
        ...item.group,
        key: item.key,
        children: item.fields.map(renderField),
    });
}

/**
 * Complete layout over existing render nodes and admitted host actions.
 * Bind controls to the detached form ID and pass this view the current host
 * decisions. It has no draft, navigation, validation or transport owner.
 * Import @miniextensions/sdk/react/form-composition.css for the stock styles.
 */
export function CompleteFormComposition<CaptchaOptions = unknown>(
    props: CompleteFormCompositionProps<CaptchaOptions>
): ReactElement {
    const keyboardClick = useRef<{
        button: HTMLButtonElement;
        event: MouseEvent;
    } | null>(null);
    const [keyboardNext, setKeyboardNext] = useState<{
        submitter: HTMLButtonElement;
    } | null>(null);
    const { primary } = props;
    let primaryControl: ReactElement | null = null;
    let admitted = false;
    if (primary?.kind === 'next') {
        admitted = !primary.disabled && !primary.loading;
        primaryControl = h(FormPageNavigationButton, {
            direction: 'next',
            type: 'submit',
            form: props.formId,
            label: primary.label,
            loading: primary.loading,
            disabled: primary.disabled,
            className: primary.className,
            onClick(event) {
                const button = event.currentTarget;
                if (
                    event.detail !== 0 ||
                    button.ownerDocument.activeElement !== button
                )
                    return;
                const activation = { button, event: event.nativeEvent };
                keyboardClick.current = activation;
                // The browser can run microtasks before the click's submit
                // default action. Expire an unsubmitted click in the next task.
                setTimeout(() => {
                    if (keyboardClick.current === activation)
                        keyboardClick.current = null;
                }, 0);
            },
        });
    } else if (primary?.kind === 'terminal') {
        admitted = primary.canSubmit && !primary.saving;
        primaryControl = h(FormSubmitButton, {
            formId: props.formId,
            label: primary.label,
            mode: primary.mode,
            saving: primary.saving,
            canSubmit: primary.canSubmit,
        });
    }

    const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
        const activation = keyboardClick.current;
        keyboardClick.current = null;
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (!admitted) return;
        if (
            primary?.kind === 'next' &&
            activation &&
            !activation.event.defaultPrevented &&
            (event.nativeEvent as SubmitEvent).submitter === activation.button
        )
            setKeyboardNext({ submitter: activation.button });
        props.onSubmit(event);
    };
    const controls = h(
        'div',
        {
            className: [
                'mx-sdk-form-composition__actions',
                props.actionsClassName,
            ]
                .filter(Boolean)
                .join(' '),
        },
        props.back &&
            h(FormPageNavigationButton, {
                direction: 'back',
                type: 'button',
                label: props.back.label,
                loading: props.back.loading,
                disabled: props.back.disabled,
                onClick: props.back.onClick,
                className: props.back.className,
            }),
        primaryControl &&
            (props.decoratePrimary
                ? props.decoratePrimary(primaryControl)
                : primaryControl)
    );

    return h(
        'section',
        {
            className: ['mx-sdk-form-composition', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'div',
            {
                className: [
                    'mx-sdk-form-composition__body',
                    props.bodyClassName,
                ]
                    .filter(Boolean)
                    .join(' '),
            },
            props.slots?.header ??
                (props.header && h(CompleteFormHeader, props.header)),
            h(
                FormNextKeyboardFocusContext.Provider,
                { value: keyboardNext },
                props.slots?.pageNavigation ??
                    (props.pageNavigation &&
                        h(CompleteFormPageNavigation, props.pageNavigation))
            ),
            h('form', {
                id: props.formId,
                noValidate: true,
                onSubmit: handleSubmit,
            }),
            h(
                'div',
                {
                    className: [
                        'mx-sdk-form-composition__fields',
                        props.fieldsClassName,
                    ]
                        .filter(Boolean)
                        .join(' '),
                },
                props.items.length === 0
                    ? props.emptyMessage
                    : props.items.map(renderItem)
            ),
            props.slots?.captcha ??
                (props.captcha &&
                    h(FormCaptcha<string, CaptchaOptions>, props.captcha)),
            props.afterFields
        ),
        props.feedback,
        props.validation && h(FormValidationSummary, props.validation),
        h(
            'footer',
            {
                className: [
                    'mx-sdk-form-composition__footer',
                    props.footerClassName,
                ]
                    .filter(Boolean)
                    .join(' '),
                'aria-label': props.footerLabel,
            },
            h(
                'div',
                {
                    className: [
                        'mx-sdk-form-composition__footer-details',
                        props.footerDetailsClassName,
                    ]
                        .filter(Boolean)
                        .join(' '),
                },
                props.slots?.footerDescription ??
                    (props.footerDescription &&
                        h(
                            CompleteFormFooterDescription,
                            props.footerDescription
                        )),
                props.tracking &&
                    h(CompleteFormTrackingDisclosure, props.tracking)
            ),
            controls,
            props.recordActions
        ),
        props.slots?.review ??
            (props.review && h(CompleteFormReview, props.review)),
        props.slots?.completion ??
            (props.completion && h(CompleteFormCompletion, props.completion))
    );
}
