import * as React from 'react';
import {
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type CSSProperties,
    type ReactElement,
    type ReactNode,
} from 'react';
import { createAddressRuntime } from '../../vendor/headlessui-address/sdk-runtime.js';
import {
    createNativeLinkedFinderCascadeDriver,
    type NativeLinkedFinderCascadeDriver,
    type NativeLinkedFinderCascadeHost,
    type NativeLinkedFinderCascadeUrlValue,
    type NativeLinkedFinderCascadeValue,
} from '../ui/nativeLinkedFinderCascade.js';

const { Combobox } = createAddressRuntime(React);

export type NativeLinkedFinderCascadeDescriptor = {
    readonly fieldId: string;
    readonly fieldName: string;
    readonly title: string | null;
    readonly urlSearchValue: NativeLinkedFinderCascadeUrlValue;
    readonly hidden: boolean;
};

export type NativeLinkedFinderCascadeLabels = {
    readonly loading: string;
    readonly noMatches: string;
};

export type NativeLinkedFinderCascadeProps<Owner extends object> = {
    owner: Owner;
    /** Stable captured ports for this committed owner; no SDK client/store. */
    host: NativeLinkedFinderCascadeHost<Owner>;
    /** Valid partial metadata survivors in native order. */
    drivers: readonly NativeLinkedFinderCascadeDescriptor[];
    /** Exact committed native driver pairs, including equal-label IDs. */
    values: Readonly<
        Record<string, NativeLinkedFinderCascadeValue | null | undefined>
    >;
    /** Native outer Form readonly suppresses drivers and their effects. */
    formReadOnly: boolean;
    labels: NativeLinkedFinderCascadeLabels;
    className?: string;
    style?: CSSProperties;
    testing?: boolean;
    /** Optional host reporting only; never clears the native prefill flag/status. */
    onPrefillFailure?(error: unknown): void;
};

type DriverProps<Owner extends object> = Omit<
    NativeLinkedFinderCascadeProps<Owner>,
    'drivers' | 'formReadOnly'
> & {
    driver: NativeLinkedFinderCascadeDescriptor;
    previousFieldId: string | null;
};

function CascadeDriver<Owner extends object>(
    props: DriverProps<Owner>
): ReactElement | null {
    const { owner, host, driver, previousFieldId } = props;
    const previousValue =
        previousFieldId !== null ? props.values[previousFieldId] : undefined;
    const [runtime, setRuntime] = useState<{
        owner: Owner;
        host: NativeLinkedFinderCascadeHost<Owner>;
        controller: NativeLinkedFinderCascadeDriver;
    } | null>(null);
    const active = useRef<NativeLinkedFinderCascadeDriver | null>(null);
    const [, refresh] = useState(0);
    const button = useRef<HTMLButtonElement>(null);
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;

    useEffect(() => {
        const controller = createNativeLinkedFinderCascadeDriver({
            owner,
            host,
            fieldId: driver.fieldId,
            previousFieldId,
            previousValue,
            urlSearchValue: driver.urlSearchValue,
            testing: props.testing,
        });
        active.current = controller;
        const unsubscribe = controller.subscribe(() =>
            refresh((value) => value + 1)
        );
        setRuntime({ owner, host, controller });
        // Two independent producers, in native mount order. Never await the
        // prefill before scheduling the predecessor's ordinary request.
        const prefill = controller.prefillNow();
        if (props.onPrefillFailure) {
            void prefill.catch((error: unknown) => {
                if (active.current === controller && host.isCurrent(owner))
                    props.onPrefillFailure?.(error);
            });
        } else void prefill;
        controller.predecessorChanged();
        return () => {
            if (active.current === controller) active.current = null;
            unsubscribe();
            controller.destroy();
        };
        // Raw URL/value echoes update ordinary inputs below; native prefill is
        // mount-only for this field/owner, not a serial hydration recipe.
    }, [owner, host, driver.fieldId]);

    useCommittedEffect(() => {
        active.current?.setUrlSearchValue(driver.urlSearchValue);
        active.current?.setPredecessor(previousFieldId, previousValue);
    }, [
        owner,
        host,
        driver.fieldId,
        driver.urlSearchValue,
        previousFieldId,
        previousValue,
    ]);
    useEffect(() => {
        active.current?.predecessorChanged();
    }, [
        owner,
        host,
        driver.fieldId,
        previousFieldId === null ? undefined : previousValue?.stringValue,
    ]);

    const controller =
        runtime?.owner === owner && runtime.host === host
            ? runtime.controller
            : null;
    const state = controller?.getSnapshot() ?? {
        status: driver.urlSearchValue ? 'fetching-prefill' : 'idle',
        options: [],
        error: undefined,
        pending: [],
    };
    let current = false;
    try {
        current = host.isCurrent(owner);
    } catch {
        /* Unknown owner is inert. */
    }
    const disabled =
        !current ||
        state.status === 'fetching-prefill' ||
        state.status === 'retired';
    const selected = current ? (props.values[driver.fieldId] ?? null) : null;
    // Hidden drivers retain the same mounted effects and canonical host writes.
    if (driver.hidden) return null;
    const children =
        state.status === 'loading'
            ? h(
                  'li',
                  { role: 'presentation', className: 'mx-sdk-finder-feedback' },
                  h('span', { role: 'status' }, props.labels.loading)
              )
            : state.error
              ? h(
                    'li',
                    {
                        role: 'presentation',
                        className: 'mx-sdk-finder-feedback',
                    },
                    h('p', { role: 'alert' }, state.error)
                )
              : state.options.length === 0
                ? h(
                      'li',
                      {
                          role: 'presentation',
                          className: 'mx-sdk-finder-feedback',
                      },
                      props.labels.noMatches
                  )
                : state.options.map((option) =>
                      h(Combobox.Option<'li', NativeLinkedFinderCascadeValue>, {
                          key: option.recordId,
                          value: option,
                          className: ({ active }) =>
                              `mx-sdk-finder-option${active ? ' mx-sdk-finder-option-active' : ''}`,
                          children: ({ selected }: { selected: boolean }) =>
                              h(
                                  Fragment,
                                  null,
                                  h(
                                      'span',
                                      {
                                          className: selected
                                              ? 'mx-sdk-finder-selected-label'
                                              : undefined,
                                      },
                                      option.stringValue
                                  ),
                                  selected
                                      ? h(
                                            'span',
                                            {
                                                'aria-hidden': true,
                                                className:
                                                    'mx-sdk-finder-check',
                                            },
                                            '✓'
                                        )
                                      : null
                              ),
                      })
                  );
    return h(
        'div',
        {
            className: ['mx-sdk-native-linked-cascade', props.className]
                .filter(Boolean)
                .join(' '),
            style: props.style,
            'data-field-id': driver.fieldId,
            'data-pending-requests': state.pending.length,
        },
        h<{
            nullable: true;
            multiple: false;
            value: NativeLinkedFinderCascadeValue | null;
            disabled: boolean;
            by(
                left: NativeLinkedFinderCascadeValue | null,
                right: NativeLinkedFinderCascadeValue | null
            ): boolean;
            onChange(value: NativeLinkedFinderCascadeValue | null): void;
            children: ReactNode;
        }>(Combobox, {
            nullable: true,
            multiple: false,
            disabled,
            value: selected,
            by: (left, right) => left?.recordId === right?.recordId,
            onChange: (value) => {
                controller?.choose(value);
            },
            children: h(
                Fragment,
                null,
                h(
                    Combobox.Label,
                    { className: 'mx-sdk-finder-label' },
                    driver.title ?? driver.fieldName
                ),
                h(
                    'div',
                    { className: 'mx-sdk-finder-input-wrap' },
                    h(Combobox.Input<'input', NativeLinkedFinderCascadeValue>, {
                        disabled,
                        className: 'mx-sdk-finder-input',
                        autoComplete: 'off',
                        displayValue: (value) =>
                            state.status === 'fetching-prefill'
                                ? props.labels.loading
                                : (value?.stringValue ?? ''),
                        onChange: (event: ChangeEvent<HTMLInputElement>) =>
                            controller?.search(event.target.value),
                        onFocus: () => {
                            if (!disabled) button.current?.click();
                        },
                    }),
                    h(Combobox.Button, {
                        ref: button,
                        className: 'mx-sdk-finder-hidden-toggle',
                        disabled,
                        onClick: () => controller?.open(),
                    }),
                    h(
                        'svg',
                        {
                            viewBox: '0 0 24 24',
                            'aria-hidden': true,
                            className: 'mx-sdk-finder-chevron',
                            fill: 'none',
                            stroke: 'currentColor',
                            strokeWidth: 1.8,
                        },
                        h('path', { d: 'm8 9 4-4 4 4m-8 6 4 4 4-4' })
                    ),
                    h(
                        Combobox.Options,
                        { className: 'mx-sdk-finder-options' },
                        children
                    )
                )
            ),
        })
    );
}

/** Actual searchable native-compatible selectors, without a client or native JSX slots. */
export function NativeLinkedFinderCascade<Owner extends object>(
    props: NativeLinkedFinderCascadeProps<Owner>
): ReactElement | null {
    if (props.formReadOnly) return null;
    return h(
        Fragment,
        null,
        ...props.drivers.map((driver, index) =>
            h(CascadeDriver<Owner>, {
                ...props,
                key: driver.fieldId,
                driver,
                previousFieldId:
                    index === 0 ? null : props.drivers[index - 1].fieldId,
            })
        )
    );
}
