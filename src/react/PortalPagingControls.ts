import {
    createElement,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactElement,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    useRef,
} from 'react';

export type PortalPagingControlsState =
    | { readonly type: 'initial-loading' | 'next-loading' }
    | { readonly type: 'ready'; readonly hasNextPage: boolean }
    | {
          readonly type: 'first-error' | 'next-error' | 'configuration-error';
          readonly message: string;
      };

export type PortalPagingIntent =
    | 'next-page'
    | 'retry-first-page'
    | 'retry-next-page';

/** A single activation opportunity for a host-owned query and page. Provide a
 * stable object for this opportunity and a fresh one to enable another attempt.
 * The host must also check its live query and cursor before starting transport. */
export type PortalPagingOffer = Readonly<{
    activate(intent: PortalPagingIntent, isCurrent: () => boolean): void;
}>;

export type PortalPagingControlsLabels = Readonly<{
    loadMore: string;
    retry: string;
}>;

export type PortalPagingControlsProps = Readonly<{
    state: PortalPagingControlsState;
    offer?: PortalPagingOffer;
    labels?: Partial<PortalPagingControlsLabels>;
    className?: string;
}>;

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

function pagingIntent(
    state: PortalPagingControlsState
): PortalPagingIntent | null {
    switch (state.type) {
        case 'ready':
            return state.hasNextPage ? 'next-page' : null;
        case 'first-error':
            return 'retry-first-page';
        case 'next-error':
            return 'retry-next-page';
        default:
            return null;
    }
}

/** Place beside host-owned records. Mounting and updates start no reads. */
export function PortalPagingControls({
    state,
    offer,
    labels,
    className,
}: PortalPagingControlsProps): ReactElement | null {
    const intent = pagingIntent(state);
    const captured = useMemo(
        () => (offer && intent ? { offer, intent } : null),
        [offer, intent]
    );
    const current = useRef<typeof captured>(null);
    const pointerPress = useRef<typeof captured>();
    const keyboardPress = useRef<typeof captured>();
    const [used] = useState(() => new WeakSet<PortalPagingOffer>());
    useCommitEffect(() => {
        current.current = captured;
        return () => {
            current.current = null;
        };
    }, [captured]);

    const pending = state.type === 'next-loading';
    const error = 'message' in state ? state.message : null;
    if (intent == null && !pending && error == null) return null;

    return createElement(
        'div',
        { className },
        error != null ? createElement('p', { role: 'alert' }, error) : null,
        intent != null || pending
            ? createElement(
                  'button',
                  {
                      type: 'button',
                      disabled: captured == null,
                      'aria-busy': pending || undefined,
                      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
                          if (event.isPrimary && event.button === 0)
                              pointerPress.current = captured;
                      },
                      onPointerCancel(event: PointerEvent<HTMLButtonElement>) {
                          if (event.isPrimary) pointerPress.current = null;
                      },
                      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
                          if (event.key !== ' ' && event.key !== 'Enter')
                              return;
                          if (event.repeat) event.preventDefault();
                          else keyboardPress.current = captured;
                      },
                      onBlur() {
                          keyboardPress.current = undefined;
                      },
                      onClick(event: MouseEvent<HTMLButtonElement>) {
                          const press =
                              event.detail === 0 ? keyboardPress : pointerPress;
                          const started = press.current;
                          press.current = undefined;
                          if (
                              captured == null ||
                              current.current !== captured ||
                              (started !== undefined && started !== captured) ||
                              used.has(captured.offer)
                          )
                              return;
                          used.add(captured.offer);
                          captured.offer.activate(
                              captured.intent,
                              () => current.current === captured
                          );
                      },
                  },
                  intent === 'next-page' || pending
                      ? (labels?.loadMore ?? 'Load more')
                      : (labels?.retry ?? 'Retry')
              )
            : null
    );
}
