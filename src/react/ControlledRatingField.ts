import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';
import { RatingInput } from './RatingInput.js';
import { ratingColors, ratingPaths } from './ratingPresentation.js';

/** Host data and current write authority; this field owns no draft or Save. */
export type ControlledRatingFieldProps = {
    mode: 'controlled';
    binding?: never;
    render?: never;
    iconInput?: never;
    value: number | null;
    onChange(value: number | null): void;
    max: number;
    icon: keyof typeof ratingPaths;
    color?: string;
    disabled?: boolean;
    grid?: boolean;
    enableInlineEdit?: boolean;
    owner?: { token: unknown; isCurrent(): boolean };
    id?: string;
    form?: string;
    title?: string;
    showLabel?: boolean;
    describedBy?: string;
    labelledBy?: string;
    invalid?: boolean;
    feedback?: string;
    className?: string;
    labels?: {
        empty?: string;
        repair?: string;
        /** Plain text with {value} and {max} placeholders. */
        outOfRange?: string;
    };
};

/** Complete configured rating presentation, composed over the existing engine. */
export function ControlledRatingField(
    props: ControlledRatingFieldProps
): ReactNode {
    const presentation = useMemo(() => ({}), [props]);
    const committed = useRef<object | null>(null);
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommittedEffect(() => {
        committed.current = presentation;
        return () => {
            if (committed.current === presentation) committed.current = null;
        };
    }, [presentation]);
    const empty = props.labels?.empty ?? 'No rating';
    const warning =
        props.labels?.outOfRange ??
        'The current value of this field is greater than the maximum allowed ({value}/{max}).';
    return h(RatingInput, {
        value: props.value,
        max: props.max,
        onChange: (value) => {
            if (committed.current !== presentation) return;
            const admitted = !props.owner || props.owner.isCurrent();
            if (admitted && committed.current === presentation)
                props.onChange(value);
        },
        disabled: props.disabled,
        grid: props.grid,
        title: props.title,
        showTitle: props.showLabel,
        feedback: props.feedback,
        className: ['mx-sdk-rating', props.className].filter(Boolean).join(' '),
        iconsClassName: 'mx-sdk-rating-icons',
        gridSummaryClassName: 'mx-sdk-rating-sr-only',
        printSummaryClassName: 'mx-sdk-rating-print',
        warningClassName: 'mx-sdk-rating-warning',
        repairClassName: 'mx-sdk-rating-repair',
        repairLabel: props.labels?.repair ?? 'Fix it',
        warningMessage: ({ value, max }) =>
            warning
                .replaceAll('{value}', String(value))
                .replaceAll('{max}', String(max)),
        inputProps: {
            id: props.id,
            form: props.form,
            'aria-describedby': props.describedBy,
            'aria-labelledby': props.labelledBy,
            'aria-label':
                !props.showLabel && !props.labelledBy ? props.title : undefined,
            'aria-invalid': props.invalid,
            'aria-valuetext': props.value == null ? empty : undefined,
            className: 'mx-sdk-rating-range',
        },
        empty: h(
            'p',
            {
                className: 'mx-sdk-rating-empty',
                'data-testid': 'no-value-test-id',
            },
            h(
                'svg',
                { viewBox: '0 0 24 24', 'aria-hidden': true },
                h('path', {
                    fillRule: 'evenodd',
                    clipRule: 'evenodd',
                    d: 'm6.72 5.66 11.62 11.62A8.25 8.25 0 0 0 6.72 5.66Zm10.56 12.68L5.66 6.72a8.25 8.25 0 0 0 11.62 11.62ZM5.105 5.106c3.807-3.808 9.98-3.808 13.788 0 3.808 3.807 3.808 9.98 0 13.788-3.807 3.808-9.98 3.808-13.788 0-3.808-3.807-3.808-9.98 0-13.788Z',
                })
            ),
            empty
        ),
        renderIcon: ({ filled, focused, activate }) =>
            h(
                'svg',
                {
                    'aria-hidden': true,
                    viewBox: '0 0 18 18',
                    className: [
                        'mx-sdk-rating-icon',
                        props.disabled && !props.enableInlineEdit
                            ? 'mx-sdk-rating-icon-disabled'
                            : 'mx-sdk-rating-icon-interactive',
                        focused && 'mx-sdk-rating-icon-focused',
                    ]
                        .filter(Boolean)
                        .join(' '),
                    onClick: activate,
                },
                h('path', {
                    fillRule: 'evenodd',
                    fill: filled
                        ? Object.hasOwn(ratingColors, props.color ?? '')
                            ? ratingColors[props.color!]
                            : 'gray'
                        : '#e5e7eb',
                    d: ratingPaths[props.icon],
                })
            ),
    });
}
