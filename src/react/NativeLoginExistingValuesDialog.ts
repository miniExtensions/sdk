import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactElement,
    type SyntheticEvent,
} from 'react';
import type { SelectionState } from '../ui/types.js';
import type {
    LoginExistingValuesLabels,
    LoginExistingValuesPickerProps,
} from './LoginExistingValuesPicker.js';
import { wrapDialogTab } from './dialogFocus.js';

type NativeDialogProps = Pick<
    LoginExistingValuesPickerProps,
    | 'titleAction'
    | 'searchPlaceholder'
    | 'testIds'
    | 'renderError'
    | 'renderLoading'
> & {
    id: string;
    opener: HTMLButtonElement | null;
    labels: LoginExistingValuesLabels;
    state: SelectionState;
    debouncing: boolean;
    dismiss(): void;
    changeQuery(query: string): void;
    choose(occurrence: string): void;
    load(append: boolean): void;
};

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

export function NativeLoginExistingValuesDialog({
    id,
    opener,
    labels,
    state,
    debouncing,
    titleAction,
    searchPlaceholder,
    testIds,
    renderError,
    renderLoading,
    dismiss,
    changeQuery,
    choose,
    load,
}: NativeDialogProps): ReactElement {
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const [activeOccurrence, setActiveOccurrence] = useState<string | null>(
        null
    );
    const optionsId = id + '-options';
    const titleId = id + '-title';
    const showLoading = debouncing || (state.loading && state.offset === null);
    const showOptions =
        !showLoading && state.error === null && state.options.length > 0;
    const options = showOptions ? state.options : [];
    const activeIndex = options.findIndex(
        ({ value }) => value === activeOccurrence
    );
    const activeOption = options[activeIndex];

    useCommitEffect(() => {
        const panel = dialog.current;
        if (!panel) return;
        panel.showModal();
        input.current?.focus();
        return () => {
            panel.close();
            if (opener?.isConnected) opener.focus();
        };
    }, [opener]);

    function optionId(occurrence: string) {
        return optionsId + '-' + occurrence;
    }

    function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
        if (event.nativeEvent.isComposing) return;

        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat && activeOption) choose(activeOption.value);
            return;
        }
        if (event.key === 'Tab' && activeOption) {
            // The browser continues Tab from the restored trigger after closing.
            event.stopPropagation();
            if (event.repeat) event.preventDefault();
            else choose(activeOption.value);
            return;
        }

        if (
            options.length === 0 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
        ) {
            return;
        }

        const last = options.length - 1;
        let index: number;
        switch (event.key) {
            case 'ArrowDown':
                index = Math.min(activeIndex + 1, last);
                break;
            case 'ArrowUp':
                index = activeIndex < 0 ? last : Math.max(activeIndex - 1, 0);
                break;
            case 'Home':
            case 'PageUp':
                index = 0;
                break;
            case 'End':
            case 'PageDown':
                index = last;
                break;
            default:
                return;
        }
        const option = options[index];
        if (!option) return;
        event.preventDefault();
        event.stopPropagation();
        setActiveOccurrence(option.value);
        event.currentTarget.ownerDocument
            .getElementById(optionId(option.value))
            ?.scrollIntoView?.({ block: 'nearest' });
    }

    const rows = h(
        'ul',
        { id: optionsId, role: 'listbox', hidden: !showOptions },
        options.map(({ value, label }) =>
            h(
                'li',
                {
                    key: value,
                    id: optionId(value),
                    role: 'option',
                    'aria-selected': value === activeOption?.value,
                    'aria-label':
                        label.trim() === '' ? labels.blank : undefined,
                    onMouseDown: (event: MouseEvent<HTMLLIElement>) =>
                        event.preventDefault(),
                    onPointerMove: (event: PointerEvent<HTMLLIElement>) => {
                        if (event.pointerType !== 'touch')
                            setActiveOccurrence(value);
                    },
                    onPointerLeave: (event: PointerEvent<HTMLLIElement>) => {
                        if (event.pointerType !== 'touch') {
                            setActiveOccurrence((current) =>
                                current === value ? null : current
                            );
                        }
                    },
                    onClick: () => choose(value),
                },
                label
            )
        )
    );

    function action(label: string, append: boolean) {
        return h(
            'button',
            {
                type: 'button',
                className: 'mx-sdk-login-values-native__action',
                disabled: state.loading || debouncing,
                onClick: () => load(append),
            },
            label
        );
    }

    return h(
        'dialog',
        {
            ref: dialog,
            id: id + '-panel',
            className: 'mx-sdk-login-values-native',
            'aria-labelledby': titleId,
            'aria-modal': true,
            'data-testid': testIds?.dialog,
            onSubmit: (event: SyntheticEvent<HTMLDialogElement>) =>
                event.stopPropagation(),
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                dismiss();
            },
            onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
                if (
                    (event.key !== 'Tab' && event.key !== 'Escape') ||
                    event.defaultPrevented ||
                    event.nativeEvent.isComposing ||
                    !(event.target instanceof Element) ||
                    event.target.closest(
                        'dialog, [role="dialog"], [role="alertdialog"]'
                    ) !== event.currentTarget
                ) {
                    return;
                }
                if (event.key === 'Tab') {
                    wrapDialogTab(event);
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) dismiss();
            },
        },
        h('div', {
            className: 'mx-sdk-login-values-native__overlay',
            'aria-hidden': true,
            'data-testid': testIds?.overlay,
            onMouseDown: (event: MouseEvent<HTMLDivElement>) =>
                event.preventDefault(),
            onClick: dismiss,
        }),
        h(
            'div',
            { className: 'mx-sdk-login-values-native__card' },
            h(
                'div',
                { className: 'mx-sdk-login-values-native__header' },
                h('h2', { id: titleId }, labels.title),
                titleAction
            ),
            h(
                'div',
                { className: 'mx-sdk-login-values-native__body' },
                h('input', {
                    ref: input,
                    type: 'text',
                    role: 'combobox',
                    'aria-label': labels.search,
                    'aria-controls': optionsId,
                    'aria-expanded': showOptions,
                    'aria-autocomplete': 'list',
                    'aria-activedescendant':
                        activeOption && optionId(activeOption.value),
                    autoComplete: 'off',
                    placeholder: searchPlaceholder,
                    value: state.searchTerm,
                    onChange: (event: ChangeEvent<HTMLInputElement>) => {
                        setActiveOccurrence(null);
                        changeQuery(event.currentTarget.value);
                    },
                    onKeyDown: handleSearchKey,
                }),
                rows,
                showLoading
                    ? (renderLoading?.() ??
                          h('span', {
                              role: 'status',
                              'aria-label': labels.loading,
                              className: 'mx-sdk-login-values-native__loading',
                          }))
                    : state.error !== null
                      ? h(
                            'div',
                            { className: 'mx-sdk-login-values-native__error' },
                            renderError?.(state.error) ??
                                h('div', { role: 'alert' }, labels.error),
                            action(labels.retry, state.offset !== null)
                        )
                      : !showOptions
                        ? h(
                              'p',
                              {
                                  role: 'status',
                                  className:
                                      'mx-sdk-login-values-native__empty',
                              },
                              labels.empty
                          )
                        : null,
                state.offset !== null ? action(labels.more, true) : null
            )
        )
    );
}
