import {
    autoUpdate,
    flip,
    offset,
    shift,
    useFloating,
    useMergeRefs,
} from '@floating-ui/react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import {
    createElement as h,
    forwardRef,
    type ButtonHTMLAttributes,
    type ReactElement,
    type ReactNode,
    type RefObject,
} from 'react';

const HeaderActionButton = forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement> & { unavailable?: boolean }
>(function HeaderActionButton({ unavailable, ...props }, ref) {
    // Apply ARIA after MenuItem merges its props so the row stays in arrow order.
    return h('button', {
        ...props,
        ref,
        'aria-disabled': unavailable || props['aria-disabled'],
    });
});

export type FormRecordActionsHeaderMenuRuntimeProps = Readonly<{
    label: string;
    buttonRef: RefObject<HTMLButtonElement | null>;
    buttonClassName?: string;
    buttonTestId?: string;
    triggerIcon: ReactNode;
    items: readonly {
        kind: 'comments' | 'delete';
        label: string;
        icon: ReactNode;
        disabled: boolean;
        pending?: boolean;
        onSelect(): void;
    }[];
}>;

export function FormRecordActionsHeaderMenuRuntime({
    label,
    buttonRef,
    buttonClassName,
    buttonTestId,
    triggerIcon,
    items,
}: FormRecordActionsHeaderMenuRuntimeProps): ReactElement {
    const { refs, floatingStyles, isPositioned } =
        useFloating<HTMLButtonElement>({
            placement: 'bottom-start',
            strategy: 'fixed',
            middleware: [offset(4), flip(), shift()],
            whileElementsMounted: autoUpdate,
        });
    // React 18 types place null in RefObject.current, while React 19 includes it in the type parameter.
    const setButton = useMergeRefs([
        buttonRef as RefObject<HTMLButtonElement>,
        refs.setReference,
    ]);
    return h(
        Menu<'div'>,
        { as: 'div', className: 'mx-sdk-form-record-actions-header' },
        h(
            MenuButton<'button'>,
            {
                ref: setButton,
                type: 'button',
                className: [
                    'mx-sdk-form-record-actions-header__trigger',
                    buttonClassName,
                ]
                    .filter(Boolean)
                    .join(' '),
                'aria-label': label,
                ...{ 'data-testid': buttonTestId },
            },
            triggerIcon
        ),
        h(
            MenuItems<'div'>,
            {
                ref: refs.setFloating,
                portal: true,
                modal: false,
                className: 'mx-sdk-form-record-actions-header__items',
                style: {
                    ...floatingStyles,
                    opacity: isPositioned ? undefined : 0,
                },
            },
            items.map((item) =>
                h(
                    MenuItem<typeof HeaderActionButton>,
                    {
                        key: item.kind,
                        as: HeaderActionButton,
                        type: 'button',
                        className:
                            item.kind === 'delete'
                                ? 'mx-sdk-form-record-actions-header__item mx-sdk-form-record-actions-header__item--danger'
                                : 'mx-sdk-form-record-actions-header__item',
                        'aria-busy': item.pending || undefined,
                        // The native menu keeps unavailable actions in arrow order.
                        ...{ 'data-unavailable': item.disabled || undefined },
                        unavailable: item.kind === 'delete' && item.disabled,
                        onClick: item.disabled ? undefined : item.onSelect,
                    },
                    h(
                        'span',
                        {
                            'aria-hidden': true,
                            className:
                                'mx-sdk-form-record-actions-header__icon',
                        },
                        item.icon
                    ),
                    item.label
                )
            )
        )
    );
}
