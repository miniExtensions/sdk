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

type PagingFocusRequest = {
    button: HTMLButtonElement;
    intent: PortalPagingIntent;
    sawPending: boolean;
    cancel(): void;
};

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
    const buttonRef = useRef<HTMLButtonElement>(null);
    const pagingFocus = useRef<PagingFocusRequest | null>(null);
    const [used] = useState(() => new WeakSet<PortalPagingOffer>());
    useCommitEffect(() => {
        current.current = captured;
        return () => {
            current.current = null;
        };
    }, [captured]);
    useCommitEffect(() => () => pagingFocus.current?.cancel(), []);
    useCommitEffect(() => {
        const request = pagingFocus.current;
        if (!request) return;
        const button = buttonRef.current;
        if (state.type === 'next-loading' && button === request.button) {
            request.sawPending = true;
            return;
        }
        request.cancel();
        if (
            request.sawPending &&
            button === request.button &&
            captured &&
            (captured.intent === 'retry-next-page' ||
                (request.intent === 'next-page' &&
                    captured.intent === 'next-page')) &&
            !used.has(captured.offer) &&
            button.ownerDocument.activeElement === button.ownerDocument.body
        ) {
            button.focus({ preventScroll: true });
        }
    }, [captured, state.type, used]);

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
                      ref: buttonRef,
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
                              // A later click from the same gesture can reach a new Retry offer.
                              event.detail > 1 ||
                              captured == null ||
                              current.current !== captured ||
                              (started !== undefined && started !== captured) ||
                              used.has(captured.offer)
                          )
                              return;
                          used.add(captured.offer);
                          pagingFocus.current?.cancel();
                          const button = event.currentTarget;
                          const document = button.ownerDocument;
                          if (
                              event.detail === 0 &&
                              started === captured &&
                              captured.intent !== 'retry-first-page' &&
                              document.activeElement === button
                          ) {
                              // Native disabling blurs the control. A visitor who
                              // focuses elsewhere gives up the keyboard handoff.
                              const releaseOnFocus = (event: FocusEvent) => {
                                  if (
                                      event.target !== button &&
                                      event.target !== document.body
                                  )
                                      request.cancel();
                              };
                              const request: PagingFocusRequest = {
                                  button,
                                  intent: captured.intent,
                                  sawPending: false,
                                  cancel() {
                                      document.removeEventListener(
                                          'focusin',
                                          releaseOnFocus,
                                          true
                                      );
                                      if (pagingFocus.current === request)
                                          pagingFocus.current = null;
                                  },
                              };
                              pagingFocus.current = request;
                              document.addEventListener(
                                  'focusin',
                                  releaseOnFocus,
                                  true
                              );
                          }
                          const request = pagingFocus.current;
                          try {
                              captured.offer.activate(
                                  captured.intent,
                                  () => current.current === captured
                              );
                          } catch (error) {
                              request?.cancel();
                              throw error;
                          }
                      },
                  },
                  intent === 'next-page' || pending
                      ? (labels?.loadMore ?? 'Load more')
                      : (labels?.retry ?? 'Retry')
              )
            : null
    );
}
