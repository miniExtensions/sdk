import {
    createElement as h,
    Fragment,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from 'react';
import { ActionButton } from './ActionButton.js';
import {
    resourceOwnerCurrent,
    type ReadonlyResourceOwner,
} from './readonlyResourceOwner.js';
import { useAttachmentActionTooltip } from './useAttachmentActionTooltip.js';
import { useAttachmentDownload } from './useAttachmentDownload.js';

export type AttachmentSliderActionsProps = {
    attachment: {
        readonly url: string;
        readonly filename?: string | null;
    };
    downloadIdentity: unknown;
    labels: { delete: string; download: string; open: string };
    onDelete?: () => void;
    canDownload: boolean;
    canOpen: boolean;
    presentationOwner?: ReadonlyResourceOwner;
    tooltipsSuspended?: boolean;
    readDownload(url: string): Promise<Response>;
    onDownloadError?(error: unknown): void;
};

const actions = 'mx-sdk-attachment-slider-actions';
const iconPaths = {
    delete: 'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0',
    download:
        'M12 9.75v6.75m0 0-3-3m3 3 3-3m-8.25 6a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z',
    open: 'M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25',
};

function AttachmentSliderAction({
    icon,
    label,
    href,
    isCurrent,
    onClick,
    disabled,
    tooltipsSuspended,
}: {
    icon: keyof typeof iconPaths;
    label: string;
    href?: string;
    isCurrent?(): boolean;
    onClick?(): void;
    disabled?: boolean;
    tooltipsSuspended?: boolean;
}) {
    const anchor = useRef<HTMLAnchorElement | null>(null);
    const { triggerRef, triggerProps, show, tooltip } =
        useAttachmentActionTooltip(label, tooltipsSuspended);
    const attachAnchor = useCallback(
        (node: HTMLAnchorElement | null) => {
            anchor.current = node;
            triggerRef(node);
        },
        [triggerRef]
    );
    const useCommitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        if (!isCurrent) return;
        const node = anchor.current;
        if (node && isCurrent() && href) node.setAttribute('href', href);
        else node?.removeAttribute('href');
        return () => node?.removeAttribute('href');
    }, [isCurrent, href]);

    const guard = (event: MouseEvent<HTMLElement>) => {
        if (isCurrent?.() === false) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.removeAttribute('href');
            return false;
        }
        return true;
    };
    const control = {
        ...triggerProps,
        className: `${actions}__control`,
        onClick: (event: MouseEvent<HTMLElement>) => {
            if (!guard(event)) return;
            onClick?.();
            show();
        },
    };
    const content = h(
        Fragment,
        null,
        h('span', { className: `${actions}__label` }, label),
        h(
            'svg',
            {
                xmlns: 'http://www.w3.org/2000/svg',
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.5,
                'aria-hidden': 'true',
                'data-slot': 'icon',
                className: `${actions}__icon`,
            },
            h('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                d: iconPaths[icon],
            })
        )
    );
    return h(
        Fragment,
        null,
        href === undefined
            ? h(
                  ActionButton,
                  { ...control, ref: triggerRef, disabled },
                  content
              )
            : h(
                  'a',
                  {
                      ...control,
                      ref: attachAnchor,
                      href: isCurrent?.() === false ? undefined : href,
                      target: '_blank',
                      onAuxClick: guard,
                      onContextMenu: guard,
                  },
                  content
              ),
        tooltip
    );
}

/** Slider header actions for a host-selected attachment occurrence. */
export function AttachmentSliderActions({
    attachment,
    downloadIdentity,
    labels,
    onDelete,
    canDownload,
    canOpen,
    presentationOwner,
    tooltipsSuspended,
    readDownload,
    onDownloadError,
}: AttachmentSliderActionsProps): ReactNode {
    const lease = useMemo(
        () => ({ attachment, owner: presentationOwner }),
        [attachment, presentationOwner]
    );
    const active = useRef<typeof lease | null>(lease);
    const [committed, setCommitted] = useState(() => ({ lease }));
    const useCommitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        active.current = lease;
        if (presentationOwner) {
            // Child link effects run before the parent commits this lease.
            // Republish on every commit, including Strict Mode effect replay.
            setCommitted({ lease });
        }
        return () => {
            if (active.current === lease) active.current = null;
        };
    }, [lease, presentationOwner]);
    const isCurrent = presentationOwner
        ? () =>
              committed.lease === lease &&
              active.current === lease &&
              resourceOwnerCurrent(presentationOwner)
        : undefined;
    const { progress, start } = useAttachmentDownload({
        identity: downloadIdentity,
        url: canDownload ? attachment.url : null,
        filename: attachment.filename,
        owner: presentationOwner,
        read: readDownload,
        onError: onDownloadError,
    });

    return h(
        'div',
        { className: actions },
        h(
            'div',
            { className: `${actions}__row` },
            onDelete == null
                ? null
                : h(AttachmentSliderAction, {
                      icon: 'delete',
                      label: labels.delete,
                      onClick: onDelete,
                      isCurrent,
                      tooltipsSuspended,
                  }),
            canDownload
                ? h(AttachmentSliderAction, {
                      icon: 'download',
                      label:
                          progress == null
                              ? labels.download
                              : `${progress.toFixed()}%`,
                      onClick: start,
                      disabled: progress != null,
                      isCurrent,
                      tooltipsSuspended,
                  })
                : null,
            canOpen
                ? h(AttachmentSliderAction, {
                      icon: 'open',
                      label: labels.open,
                      href: attachment.url,
                      isCurrent,
                      tooltipsSuspended,
                  })
                : null
        )
    );
}
