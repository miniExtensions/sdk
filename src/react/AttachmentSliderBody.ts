import {
    Component,
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useRef,
    type Dispatch,
    type ReactNode,
    type SetStateAction,
} from 'react';
import type { AttachmentPreviewSource } from '../ui/attachmentPreview.js';
import { ActionButton } from './ActionButton.js';
import {
    AttachmentSliderPreview,
    type AttachmentPreviewLabels,
} from './AttachmentPreview.js';
import { AttachmentSliderNavigation } from './AttachmentSliderNavigation.js';
import { AttachmentSliderThumbnailRail } from './AttachmentSliderThumbnailRail.js';

export type AttachmentSliderBodyRow = AttachmentPreviewSource & {
    readonly id?: string | null;
    readonly thumbnailUrl?: string | null;
};

export type AttachmentSliderBodyProps = {
    rows: readonly AttachmentSliderBodyRow[];
    currentIndex: number;
    setCurrentIndex: Dispatch<SetStateAction<number>>;
    labels: AttachmentPreviewLabels & { previous: string; next: string };
    presentationOwner?: { isCurrent(): boolean };
    navigationOwner?: string;
    covered?: boolean;
    /** The rail is the surrounding dialog's initial focus target. */
    thumbnailRailRef: { readonly current: HTMLDivElement | null };
};

const body = 'mx-sdk-attachment-slider-body';
const ownsPresentation = (
    owner: AttachmentSliderBodyProps['presentationOwner']
) => {
    try {
        return owner == null || owner.isCurrent() === true;
    } catch {
        return false;
    }
};

type AttachmentSliderFocusProps = Pick<
    AttachmentSliderBodyProps,
    'navigationOwner' | 'presentationOwner' | 'thumbnailRailRef' | 'covered'
> & {
    sdkNavigation: AttachmentSliderBodyProps['thumbnailRailRef'];
    children: ReactNode;
};

class AttachmentSliderFocus extends Component<AttachmentSliderFocusProps> {
    private keyboardDialog: HTMLElement | null = null;
    private readonly arrowOwners = new Map<string, string>();

    private releaseArrow = (event: KeyboardEvent) => {
        this.arrowOwners.delete(event.key);
    };

    private guardHeldArrow = (event: KeyboardEvent) => {
        const { navigationOwner } = this.props;
        const { key, target } = event;
        if (
            navigationOwner == null ||
            (key !== 'ArrowLeft' && key !== 'ArrowRight')
        )
            return;
        if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            (target instanceof Element &&
                target.closest(
                    'input, textarea, select, [contenteditable], audio, video'
                ))
        ) {
            if (!event.repeat) this.arrowOwners.delete(key);
            return;
        }
        if (!event.repeat) {
            this.arrowOwners.set(key, navigationOwner);
        } else if (this.arrowOwners.get(key) !== navigationOwner) {
            // Stop a predecessor's held key before either navigation handler.
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private setKeyboardDialog(dialog: HTMLElement | null) {
        if (dialog === this.keyboardDialog) return;
        const previous = this.keyboardDialog;
        previous?.removeEventListener('keydown', this.guardHeldArrow, true);
        previous?.ownerDocument.defaultView?.removeEventListener(
            'keyup',
            this.releaseArrow,
            true
        );
        this.arrowOwners.clear();
        this.keyboardDialog = dialog;
        dialog?.addEventListener('keydown', this.guardHeldArrow, true);
        dialog?.ownerDocument.defaultView?.addEventListener(
            'keyup',
            this.releaseArrow,
            true
        );
    }

    private syncKeyboardDialog() {
        const { navigationOwner, thumbnailRailRef, covered } = this.props;
        this.setKeyboardDialog(
            covered || navigationOwner == null
                ? null
                : (thumbnailRailRef.current?.closest<HTMLElement>(
                      '[role="dialog"]'
                  ) ?? null)
        );
    }

    componentDidMount() {
        this.syncKeyboardDialog();
    }

    getSnapshotBeforeUpdate(previous: AttachmentSliderFocusProps) {
        const { navigationOwner, sdkNavigation, thumbnailRailRef, covered } =
            this.props;
        if (
            covered ||
            previous.covered ||
            navigationOwner == null ||
            previous.navigationOwner == null
        )
            return null;

        // Capture focus before React removes controls on replacement or shrink.
        const rail = thumbnailRailRef.current;
        const focused = rail?.ownerDocument.activeElement;
        return focused &&
            (sdkNavigation.current?.contains(focused) ||
                rail?.contains(focused))
            ? focused
            : null;
    }

    componentDidUpdate(
        _previousProps: AttachmentSliderFocusProps,
        _previousState: unknown,
        retiredFocus: Element | null
    ) {
        this.syncKeyboardDialog();
        const { presentationOwner, thumbnailRailRef } = this.props;
        if (retiredFocus == null || retiredFocus.isConnected) return;
        const rail = thumbnailRailRef.current;
        if (!rail?.isConnected || !ownsPresentation(presentationOwner)) return;
        const document = rail.ownerDocument;
        if (
            document.activeElement == null ||
            document.activeElement === document.body
        )
            rail.focus({ preventScroll: true });
    }

    componentWillUnmount() {
        this.setKeyboardDialog(null);
    }

    render() {
        return h('div', { className: body }, this.props.children);
    }
}

const chevronPaths = {
    previous:
        'M7.72 12.53a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 1 1 1.06 1.06L9.31 12l6.97 6.97a.75.75 0 1 1-1.06 1.06l-7.5-7.5Z',
    next: 'M16.28 11.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 0 1 1.06-1.06l7.5 7.5Z',
};

function legacyArrow(
    direction: keyof typeof chevronPaths,
    label: string,
    onClick: () => void
) {
    return h(
        ActionButton,
        { className: `${body}__legacy-arrow`, onClick },
        h('span', { className: `${body}__sr-only` }, label),
        h(
            'svg',
            {
                xmlns: 'http://www.w3.org/2000/svg',
                viewBox: '0 0 24 24',
                fill: 'currentColor',
                'aria-hidden': 'true',
                'data-slot': 'icon',
                className: `${body}__chevron`,
            },
            h('path', {
                fillRule: 'evenodd',
                clipRule: 'evenodd',
                d: chevronPaths[direction],
            })
        )
    );
}

/** Controlled slider content. The host owns the dialog and canonical row actions. */
export function AttachmentSliderBody({
    rows,
    currentIndex,
    setCurrentIndex,
    labels,
    presentationOwner,
    navigationOwner,
    thumbnailRailRef,
    covered,
}: AttachmentSliderBodyProps): ReactNode {
    const sdkNavigation = useRef<HTMLDivElement>(null);
    const showSdkNavigation = navigationOwner != null && rows.length > 1;
    const useCommitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;

    useCommitEffect(() => {
        if (covered || rows.length === 0) return;
        const handler = (event: KeyboardEvent) => {
            const { key } = event;
            if (key !== 'ArrowRight' && key !== 'ArrowLeft') return;
            if (!ownsPresentation(presentationOwner)) return;
            if (navigationOwner != null) {
                // Navigation controls consume their own keys. Other focus
                // targets inside the dialog still use the legacy listener.
                const target = event.target;
                if (
                    !showSdkNavigation ||
                    event.defaultPrevented ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.shiftKey ||
                    !(target instanceof Node) ||
                    !thumbnailRailRef.current
                        ?.closest('[role="dialog"]')
                        ?.contains(target) ||
                    sdkNavigation.current?.contains(target)
                )
                    return;
                event.preventDefault();
            }
            if (key === 'ArrowRight') {
                setCurrentIndex((index) =>
                    Math.min(index + 1, rows.length - 1)
                );
            } else {
                setCurrentIndex((index) => Math.max(index - 1, 0));
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [
        setCurrentIndex,
        rows.length,
        presentationOwner,
        navigationOwner,
        showSdkNavigation,
        thumbnailRailRef,
        covered,
    ]);

    const attachment = rows[currentIndex];
    if (attachment == null) return null;

    const selectAttachment = (index: number) => {
        if (!covered && ownsPresentation(presentationOwner))
            setCurrentIndex(index);
    };
    const move = (step: -1 | 1) => {
        if (!covered && ownsPresentation(presentationOwner))
            setCurrentIndex((index) => index + step);
    };
    const preview = h(
        'div',
        { className: `${body}__preview` },
        h(AttachmentSliderPreview, { attachment, labels })
    );

    return h(AttachmentSliderFocus, {
        covered,
        navigationOwner,
        presentationOwner,
        sdkNavigation,
        thumbnailRailRef,
        children: h(
            Fragment,
            null,
            showSdkNavigation
                ? h(
                      'div',
                      { className: `${body}__navigation`, ref: sdkNavigation },
                      h(
                          AttachmentSliderNavigation,
                          {
                              collectionOwner: navigationOwner,
                              rows,
                              selectedIndex: currentIndex,
                              labels: {
                                  navigation: labels.attachments,
                                  previous: labels.previous,
                                  next: labels.next,
                              },
                              onSelect: selectAttachment,
                          },
                          preview
                      )
                  )
                : h(
                      Fragment,
                      null,
                      h(
                          'p',
                          { className: `${body}__name` },
                          attachment.filename
                      ),
                      h(
                          'div',
                          { className: `${body}__legacy-navigation` },
                          h(
                              'div',
                              { className: `${body}__legacy-side` },
                              currentIndex > 0
                                  ? legacyArrow(
                                        'previous',
                                        labels.previous,
                                        () => move(-1)
                                    )
                                  : null
                          ),
                          preview,
                          h(
                              'div',
                              { className: `${body}__legacy-side` },
                              currentIndex < rows.length - 1
                                  ? legacyArrow('next', labels.next, () =>
                                        move(1)
                                    )
                                  : null
                          )
                      )
                  ),
            h(AttachmentSliderThumbnailRail, {
                ref: thumbnailRailRef,
                rows: rows.map(({ id, filename, thumbnailUrl }, index) => ({
                    // Retire old controls on admission and keep equal rows distinct.
                    key: `${navigationOwner == null ? '' : navigationOwner + ':'}${id}-${index}`,
                    filename,
                    thumbnailUrl,
                })),
                selectedIndex: currentIndex,
                onSelect: selectAttachment,
            })
        ),
    });
}
