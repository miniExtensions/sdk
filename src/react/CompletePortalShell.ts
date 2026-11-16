import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type KeyboardEvent,
    type MouseEvent,
    type CSSProperties,
} from 'react';
import {
    PortalSidebarResize,
    portalSidebarWidth,
    type PortalShellSidebarWidthCommit,
} from './PortalSidebarResize.js';
export type { PortalShellSidebarWidthCommit } from './PortalSidebarResize.js';
import {
    flattenPortalShellMenu,
    portalShellSelectionsEqual,
    projectPortalShellMenu,
    resolvePortalShellSelection,
    type PortalShellIntent,
    type PortalShellMenuItem,
    type PortalShellSelection,
} from '../portals/shell.js';
import {
    CompleteHTMLRenderer,
    CompleteQuillHTMLRenderer,
    CompleteTruncatedDescription,
} from './html/index.js';

export type PortalShellSnapshot = Readonly<{
    /** Changes when the accepted portal/user owner changes. Never include credentials. */
    scope: string;
    /** Host-issued immutable presentation revision. */
    revision: string | number;
    items: readonly PortalShellMenuItem[];
    selection: PortalShellSelection | null;
    header: Readonly<{
        layout: 'sidebar' | 'topbar';
        hidden?: boolean;
        title: string;
        /** Native HTML title, sanitized by the stock renderer. Empty stays blank. */
        titleHtml?: string;
        /** Optional host-owned desktop sidebar width in pixels (120–600). */
        sidebarWidth?: number;
        descriptionHtml?: string;
        /** Omission retains the existing untruncated header description. */
        descriptionOptions?: Readonly<{
            placement?: 'header' | 'navigation';
            truncate?: boolean;
            /** Stable content identity; do not use the presentation revision. */
            resetKey?: string;
        }>;
        /** Layout placement uses sidebar footers and a 640px topbar breakpoint. */
        actionsPlacement?: 'header' | 'layout';
        logoUrl?: string;
    }>;
    hideMenuItems?: boolean;
    user?: Readonly<{
        name: string;
        settingsEnabled?: boolean;
        logoutEnabled?: boolean;
        /** Omission/menu retains the existing text dropdown. Icon/text use direct single actions. */
        presentation?: 'menu' | 'icon' | 'text';
    }>;
    searchAgainEnabled?: boolean;
    welcome?: Readonly<{
        id: string;
        title: string;
        messageHtml: string;
        dismissed: boolean;
    }>;
}>;
export type PortalShellLabels = {
    navigation: string;
    openNavigation: string;
    closeNavigation: string;
    skipToContent: string;
    userMenu: string;
    settings: string;
    logout: string;
    confirmLogout: string;
    cancel: string;
    dismissWelcome: string;
    empty: string;
    externalLink: string;
    searchAgain: string;
    readMore?: string;
    showLess?: string;
    resizeSidebar?: string;
};
const defaultLabels: Required<PortalShellLabels> = {
    navigation: 'Portal navigation',
    openNavigation: 'Open navigation',
    closeNavigation: 'Close navigation',
    skipToContent: 'Skip to content',
    userMenu: 'User menu',
    settings: 'User settings',
    logout: 'Log out',
    confirmLogout: 'Are you sure you want to log out?',
    cancel: 'Cancel',
    dismissWelcome: 'Continue',
    empty: 'No views available',
    externalLink: 'opens in a new tab',
    searchAgain: 'Search again',
    readMore: 'Read more',
    showLess: 'Show less',
    resizeSidebar: 'Resize sidebar',
};
export type CompletePortalShellProps = {
    snapshot: PortalShellSnapshot;
    onIntent: (intent: PortalShellIntent) => void;
    /** End-only resize notification. The host validates the envelope and persists. */
    onSidebarWidthCommit?: (change: PortalShellSidebarWidthCommit) => void;
    /** The host-owned table/collection body. Menus, header, embed and dialogs are SDK-owned. */
    children?: ReactNode;
    labels?: Partial<PortalShellLabels>;
    className?: string;
};

const focusable = 'a[href],button:not([disabled]),summary,[tabindex="0"]';
function visibleControls(node: HTMLElement): HTMLElement[] {
    return Array.from(node.querySelectorAll<HTMLElement>(focusable)).filter(
        (element) => {
            if (element.closest('[hidden]')) return false;
            for (
                let ancestor = element.parentElement;
                ancestor;
                ancestor = ancestor.parentElement
            ) {
                if (
                    ancestor.tagName === 'DETAILS' &&
                    !ancestor.hasAttribute('open') &&
                    Array.from(ancestor.children).find(
                        (child) => child.tagName === 'SUMMARY'
                    ) !== element
                )
                    return false;
            }
            return true;
        }
    );
}
function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const controls = visibleControls(event.currentTarget);
    const first = controls[0],
        last = controls.at(-1);
    if (!first) {
        event.preventDefault();
        event.currentTarget.focus();
    } else if (
        event.shiftKey &&
        (event.currentTarget.ownerDocument.activeElement === first ||
            event.currentTarget.ownerDocument.activeElement ===
                event.currentTarget)
    ) {
        event.preventDefault();
        last!.focus();
    } else if (
        !event.shiftKey &&
        event.currentTarget.ownerDocument.activeElement === last
    ) {
        event.preventDefault();
        first.focus();
    }
}
/** Fixed native Heroicons outlines; MIT notice is retained in THIRD_PARTY_NOTICES.md. */
function UserIcon({ logout = false }: { logout?: boolean }) {
    return h(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            fill: 'none',
            viewBox: '0 0 24 24',
            strokeWidth: 1.5,
            stroke: 'currentColor',
            'aria-hidden': true,
            className: 'mx-sdk-portal-user-icon',
        },
        h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            d: logout
                ? 'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9'
                : 'M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
        })
    );
}
function Dialog(props: {
    title: string;
    children: ReactNode;
    onClose: () => void;
}) {
    const id = useId(),
        ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        const previous = node.ownerDocument.activeElement as HTMLElement | null;
        (visibleControls(node)[0] ?? node).focus();
        return () => {
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return h(
        'div',
        {
            className: 'mx-sdk-portal-backdrop',
            onClick: (event: MouseEvent<HTMLElement>) => {
                if (event.target === event.currentTarget) props.onClose();
            },
        },
        h(
            'div',
            {
                ref,
                role: 'dialog',
                'aria-modal': true,
                'aria-labelledby': id,
                tabIndex: -1,
                className: 'mx-sdk-portal-dialog',
                onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onClose();
                    } else trapFocus(event);
                },
            },
            h('h2', { id }, props.title),
            props.children
        )
    );
}

function Shell(props: CompletePortalShellProps) {
    const { snapshot } = props;
    const labels = { ...defaultLabels, ...props.labels };
    const id = useId(),
        navId = `${id}-navigation`,
        mainId = `${id}-content`;
    const items = projectPortalShellMenu(snapshot.items);
    const selection = resolvePortalShellSelection({
        items,
        selection: snapshot.selection,
        phase: 'reconcile',
    });
    const active = flattenPortalShellMenu(items).find(
        (item) => item.id === selection?.itemId
    );
    const [mobile, setMobile] = useState(false),
        [open, setOpen] = useState(false);
    // A committed replacement allocates a distinct confirmation owner even
    // when a previous snapshot/callback pair returns after A-B-A.
    const logoutAuthority = useMemo(
        () => ({ snapshot, onIntent: props.onIntent }),
        [snapshot, props.onIntent]
    );
    const committedLogoutAuthority = useRef<typeof logoutAuthority | null>(
            null
        ),
        activeLogoutAuthority = useRef<typeof logoutAuthority | null>(null);
    const [logoutRequest, setLogoutRequest] = useState<
        typeof logoutAuthority | null
    >(null);
    const logout = logoutRequest === logoutAuthority;
    const toggle = useRef<HTMLButtonElement>(null),
        nav = useRef<HTMLDivElement>(null),
        main = useRef<HTMLElement>(null),
        container = useRef<HTMLDivElement>(null);
    const controlledSidebar =
        snapshot.header.layout === 'sidebar' &&
        !snapshot.header.hidden &&
        (snapshot.header.sidebarWidth !== undefined ||
            props.onSidebarWidthCommit !== undefined);
    const layoutActions = snapshot.header.actionsPlacement === 'layout';
    const mobileLimit =
        layoutActions && snapshot.header.layout === 'topbar' ? 639 : 1023;
    const actionsInNavigation =
        layoutActions &&
        !snapshot.header.hidden &&
        (snapshot.header.layout === 'sidebar' || mobile);
    const showNavigation =
        (!snapshot.hideMenuItems && items.length > 0) ||
        (!snapshot.header.hidden &&
            (layoutActions ||
                (snapshot.header.descriptionOptions?.placement ===
                    'navigation' &&
                    snapshot.header.descriptionHtml != null)));
    const sidebarWidth = portalSidebarWidth(snapshot.header.sidebarWidth);
    const commandToken = { snapshot, onIntent: props.onIntent };
    const accepted = useRef<typeof commandToken | null>(null);
    const pending = useRef<{
        snapshot: PortalShellSnapshot;
        key: string;
    } | null>(null);
    const overlay = mobile || snapshot.header.hidden === true;
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        accepted.current = commandToken;
        return () => {
            if (accepted.current === commandToken) accepted.current = null;
        };
    });
    useCommitEffect(() => {
        committedLogoutAuthority.current = logoutAuthority;
        if (activeLogoutAuthority.current !== logoutAuthority)
            activeLogoutAuthority.current = null;
        setLogoutRequest((request) =>
            request &&
            (request !== logoutAuthority ||
                activeLogoutAuthority.current !== logoutAuthority)
                ? null
                : request
        );
        return () => {
            if (committedLogoutAuthority.current === logoutAuthority)
                committedLogoutAuthority.current = null;
            if (activeLogoutAuthority.current === logoutAuthority)
                activeLogoutAuthority.current = null;
        };
    }, [logoutAuthority]);
    useCommitEffect(() => {
        // Preview writes are imperative so dragging never remounts host content.
        // React may otherwise skip an equal style value when resize is withdrawn.
        if (controlledSidebar)
            container.current?.style.setProperty(
                '--mx-portal-sidebar-width',
                `${sidebarWidth}px`
            );
    }, [
        controlledSidebar,
        sidebarWidth,
        snapshot.revision,
        props.onSidebarWidthCommit,
        mobile,
    ]);
    useEffect(() => {
        const query = main.current?.ownerDocument.defaultView?.matchMedia(
            `(max-width: ${mobileLimit}px)`
        );
        if (!query) return;
        const change = () => setMobile(query.matches);
        change();
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, [mobileLimit]);
    useEffect(() => {
        if (!overlay || !open) return;
        (nav.current && visibleControls(nav.current)[0])?.focus();
        return () => {
            if (toggle.current?.isConnected) toggle.current.focus();
        };
    }, [overlay, open]);
    useEffect(() => {
        setOpen(false);
    }, [snapshot.scope, snapshot.revision]);
    useEffect(() => {
        const document = main.current?.ownerDocument;
        if (!document || snapshot.header.layout !== 'topbar' || overlay) return;
        const outside = (event: globalThis.MouseEvent) => {
            if (
                event.target instanceof document.defaultView!.Node &&
                !nav.current?.contains(event.target)
            )
                nav.current
                    ?.querySelectorAll('details[open]')
                    .forEach((details) => details.removeAttribute('open'));
        };
        document.addEventListener('click', outside);
        return () => document.removeEventListener('click', outside);
    }, [snapshot.header.layout, overlay]);
    function emit(
        intent:
            | Omit<
                  Extract<PortalShellIntent, { type: 'navigate' }>,
                  'scope' | 'revision'
              >
            | Omit<
                  Extract<PortalShellIntent, { type: 'dismiss-welcome' }>,
                  'scope' | 'revision'
              >
            | { type: 'logout' | 'user-settings' | 'search-again' }
    ) {
        if (accepted.current !== commandToken) return;
        const key = JSON.stringify(intent);
        const deduplicate =
            intent.type === 'navigate' ||
            intent.type === 'dismiss-welcome' ||
            intent.type === 'logout';
        if (
            deduplicate &&
            pending.current?.snapshot === snapshot &&
            pending.current.key === key
        )
            return;
        if (deduplicate) pending.current = { snapshot, key };
        props.onIntent({
            ...intent,
            scope: snapshot.scope,
            revision: snapshot.revision,
        });
    }
    function beginLogout() {
        if (
            accepted.current !== commandToken ||
            committedLogoutAuthority.current !== logoutAuthority ||
            !snapshot.user?.logoutEnabled
        )
            return;
        activeLogoutAuthority.current = logoutAuthority;
        setLogoutRequest(logoutAuthority);
    }
    function closeLogout() {
        if (activeLogoutAuthority.current === logoutRequest)
            activeLogoutAuthority.current = null;
        setLogoutRequest((current) =>
            current === logoutRequest ? null : current
        );
    }
    function confirmLogout() {
        if (
            logoutRequest !== logoutAuthority ||
            committedLogoutAuthority.current !== logoutAuthority ||
            activeLogoutAuthority.current !== logoutAuthority ||
            accepted.current !== commandToken ||
            !snapshot.user?.logoutEnabled
        )
            return;
        // Consume before host publication, including synchronous replacement.
        activeLogoutAuthority.current = null;
        setLogoutRequest(null);
        emit({ type: 'logout' });
    }
    const close = () => setOpen(false);
    function navigate(next: PortalShellSelection, source: HTMLElement) {
        if (!overlay && snapshot.header.layout === 'topbar') {
            const summary = source.closest('details')?.querySelector('summary');
            nav.current
                ?.querySelectorAll('details[open]')
                .forEach((details) => details.removeAttribute('open'));
            summary?.focus();
        }
        close();
        if (!portalShellSelectionsEqual(selection, next))
            emit({
                type: 'navigate',
                selection: next,
                previousSelection: selection,
            });
    }
    function keyboard(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape') {
            const details = (event.target as HTMLElement).closest(
                'details[open]'
            );
            if (details) {
                event.preventDefault();
                event.stopPropagation();
                details.removeAttribute('open');
                details.querySelector('summary')?.focus();
                return;
            }
            if (overlay) {
                event.preventDefault();
                close();
            }
            return;
        }
        if (overlay && open) trapFocus(event);
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
            return;
        const controls = visibleControls(event.currentTarget);
        const index = controls.indexOf(
            event.currentTarget.ownerDocument.activeElement as HTMLElement
        );
        const next =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? controls.length - 1
                  : (index +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        controls.length) %
                    controls.length;
        if (controls[next]) {
            event.preventDefault();
            controls[next]!.focus();
        }
    }
    function menu(list: readonly PortalShellMenuItem[]): ReactNode {
        return h(
            'ul',
            { className: 'mx-sdk-portal-menu' },
            ...list.map((item) => {
                const label = h(
                    'span',
                    { className: 'mx-sdk-portal-menu-label' },
                    item.label,
                    item.badge
                        ? h(
                              'span',
                              { className: 'mx-sdk-portal-badge' },
                              item.badge
                          )
                        : null
                );
                if (item.type === 'group')
                    return h(
                        'li',
                        { key: item.id },
                        snapshot.header.hidden
                            ? menu(item.items)
                            : h(
                                  'details',
                                  { className: 'mx-sdk-portal-group' },
                                  h('summary', null, label),
                                  menu(item.items)
                              )
                    );
                if (item.type === 'external')
                    return h(
                        'li',
                        { key: item.id },
                        h(
                            'a',
                            {
                                href: item.url,
                                target: item.target ?? '_blank',
                                rel: 'noopener noreferrer',
                                onClick: close,
                            },
                            label,
                            (item.target ?? '_blank') === '_blank'
                                ? h(
                                      'span',
                                      { className: 'mx-sdk-portal-sr-only' },
                                      ` (${labels.externalLink})`
                                  )
                                : null
                        )
                    );
                if (item.type === 'table' && item.views !== undefined)
                    return h(
                        'li',
                        { key: item.id },
                        h(
                            'details',
                            { className: 'mx-sdk-portal-group' },
                            h(
                                'summary',
                                {
                                    'data-active':
                                        selection?.itemId === item.id
                                            ? 'true'
                                            : undefined,
                                },
                                label
                            ),
                            h(
                                'ul',
                                { className: 'mx-sdk-portal-menu' },
                                ...item.views.map((view) =>
                                    h(
                                        'li',
                                        { key: view.id },
                                        h(
                                            'button',
                                            {
                                                type: 'button',
                                                'aria-current':
                                                    selection?.type ===
                                                        'table' &&
                                                    selection.itemId ===
                                                        item.id &&
                                                    selection.viewId === view.id
                                                        ? 'page'
                                                        : undefined,
                                                onClick: (
                                                    event: MouseEvent<HTMLButtonElement>
                                                ) =>
                                                    navigate(
                                                        {
                                                            type: 'table',
                                                            itemId: item.id,
                                                            viewId: view.id,
                                                        },
                                                        event.currentTarget
                                                    ),
                                            },
                                            view.label
                                        )
                                    )
                                )
                            )
                        )
                    );
                return h(
                    'li',
                    { key: item.id },
                    h(
                        'button',
                        {
                            type: 'button',
                            'aria-current':
                                selection?.itemId === item.id
                                    ? 'page'
                                    : undefined,
                            onClick: (event: MouseEvent<HTMLButtonElement>) =>
                                navigate(
                                    item.type === 'embedded'
                                        ? {
                                              type: 'embedded',
                                              itemId: item.id,
                                              url: item.url,
                                          }
                                        : {
                                              type: 'table',
                                              itemId: item.id,
                                              viewId: null,
                                          },
                                    event.currentTarget
                                ),
                        },
                        label
                    )
                );
            })
        );
    }
    const user = snapshot.user;
    const configuredUser =
        user?.presentation === 'icon' || user?.presentation === 'text';
    const userLabel =
        user?.presentation === 'icon'
            ? h(UserIcon)
            : configuredUser
              ? user?.name
              : user?.name || labels.userMenu;
    const directUserAction =
        user &&
        configuredUser &&
        Boolean(user.settingsEnabled) !== Boolean(user.logoutEnabled)
            ? h(
                  'button',
                  {
                      type: 'button',
                      className: 'mx-sdk-portal-user-direct',
                      'aria-label': user.logoutEnabled
                          ? labels.logout
                          : user.presentation === 'icon' || user.name === ''
                            ? labels.settings
                            : undefined,
                      onClick: () => {
                          if (user.settingsEnabled)
                              emit({ type: 'user-settings' });
                          else beginLogout();
                      },
                  },
                  user.settingsEnabled
                      ? userLabel
                      : h(UserIcon, { logout: true })
              )
            : null;
    const descriptionOptions = snapshot.header.descriptionOptions;
    const descriptionInNavigation =
        descriptionOptions?.placement === 'navigation';
    const description = (
        descriptionOptions
            ? snapshot.header.descriptionHtml != null
            : Boolean(snapshot.header.descriptionHtml)
    )
        ? descriptionOptions?.truncate
            ? h(CompleteTruncatedDescription, {
                  html: snapshot.header.descriptionHtml!,
                  resetKey: descriptionOptions.resetKey,
                  readMoreLabel: labels.readMore,
                  showLessLabel: labels.showLess,
              })
            : h(CompleteQuillHTMLRenderer, {
                  html: snapshot.header.descriptionHtml!,
              })
        : null;
    const actions = h(
        'div',
        { className: 'mx-sdk-portal-actions' },
        snapshot.searchAgainEnabled
            ? h(
                  'button',
                  {
                      type: 'button',
                      onClick: () => emit({ type: 'search-again' }),
                  },
                  labels.searchAgain
              )
            : null,
        directUserAction ??
            (user && (user.settingsEnabled || user.logoutEnabled)
                ? h(
                      'details',
                      {
                          className: `mx-sdk-portal-user${user.presentation === 'icon' ? ' mx-sdk-portal-user--icon' : ''}`,
                          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                              if (event.key === 'Escape') {
                                  event.currentTarget.removeAttribute('open');
                                  event.currentTarget
                                      .querySelector('summary')
                                      ?.focus();
                              }
                          },
                      },
                      h(
                          'summary',
                          { 'aria-label': labels.userMenu },
                          userLabel
                      ),
                      h(
                          'div',
                          null,
                          user.settingsEnabled
                              ? h(
                                    'button',
                                    {
                                        type: 'button',
                                        onClick: (
                                            event: MouseEvent<HTMLElement>
                                        ) => {
                                            event.currentTarget
                                                .closest('details')
                                                ?.removeAttribute('open');
                                            event.currentTarget
                                                .closest('details')
                                                ?.querySelector('summary')
                                                ?.focus();
                                            emit({ type: 'user-settings' });
                                        },
                                    },
                                    labels.settings
                                )
                              : null,
                          user.logoutEnabled
                              ? h(
                                    'button',
                                    {
                                        type: 'button',
                                        onClick: (
                                            event: MouseEvent<HTMLElement>
                                        ) => {
                                            event.currentTarget
                                                .closest('details')
                                                ?.removeAttribute('open');
                                            event.currentTarget
                                                .closest('details')
                                                ?.querySelector('summary')
                                                ?.focus();
                                            beginLogout();
                                        },
                                    },
                                    labels.logout
                                )
                              : null
                      )
                  )
                : null)
    );
    const welcome = snapshot.welcome;
    return h(
        'div',
        {
            ref: container,
            style: controlledSidebar
                ? ({
                      '--mx-portal-sidebar-width': `${sidebarWidth}px`,
                  } as CSSProperties)
                : undefined,
            className: [
                'mx-sdk-portal-shell',
                `mx-sdk-portal-shell--${snapshot.header.layout}`,
                snapshot.header.hidden ? 'mx-sdk-portal-shell--hidden' : '',
                controlledSidebar ? 'mx-sdk-portal-shell--resizable' : '',
                layoutActions ? 'mx-sdk-portal-shell--layout-actions' : '',
                props.className,
            ]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'a',
            {
                className: 'mx-sdk-portal-skip',
                href: `#${mainId}`,
                onClick: () => main.current?.focus(),
            },
            labels.skipToContent
        ),
        h(
            'header',
            { className: 'mx-sdk-portal-header' },
            !snapshot.header.hidden
                ? h(
                      'div',
                      { className: 'mx-sdk-portal-brand' },
                      snapshot.header.logoUrl
                          ? h('img', {
                                src: snapshot.header.logoUrl,
                                alt: '',
                                className: 'mx-sdk-portal-logo',
                            })
                          : null,
                      h(
                          'div',
                          null,
                          snapshot.header.titleHtml != null
                              ? h(CompleteHTMLRenderer, {
                                    html: snapshot.header.titleHtml,
                                    className: 'mx-sdk-portal-title-html',
                                })
                              : h(
                                    'h1',
                                    { className: 'mx-sdk-portal-title' },
                                    snapshot.header.title
                                ),
                          descriptionInNavigation ? null : description
                      )
                  )
                : null,
            showNavigation
                ? h(
                      'button',
                      {
                          ref: toggle,
                          type: 'button',
                          className: 'mx-sdk-portal-toggle',
                          'aria-expanded': open,
                          'aria-controls': navId,
                          onClick: () => setOpen(!open),
                      },
                      open ? labels.closeNavigation : labels.openNavigation
                  )
                : null,
            actionsInNavigation ? null : actions
        ),
        showNavigation
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-portal-navigation-wrap',
                      'data-open': open ? 'true' : 'false',
                      onClick: (event: MouseEvent<HTMLElement>) => {
                          if (overlay && event.target === event.currentTarget)
                              close();
                      },
                  },
                  h(
                      'div',
                      {
                          ref: nav,
                          id: navId,
                          hidden: overlay && !open,
                          className: 'mx-sdk-portal-navigation',
                          role: overlay && open ? 'dialog' : undefined,
                          'aria-modal': overlay && open ? true : undefined,
                          'aria-label': labels.navigation,
                          tabIndex: -1,
                          onKeyDown: keyboard,
                      },
                      overlay
                          ? h(
                                'button',
                                { type: 'button', onClick: close },
                                labels.closeNavigation
                            )
                          : null,
                      h(
                          'nav',
                          { 'aria-label': labels.navigation },
                          snapshot.hideMenuItems ? null : menu(items),
                          descriptionInNavigation && !snapshot.header.hidden
                              ? description
                              : null
                      ),
                      actionsInNavigation ? actions : null
                  )
              )
            : null,
        controlledSidebar && !mobile && props.onSidebarWidthCommit
            ? h(PortalSidebarResize, {
                  scope: snapshot.scope,
                  revision: snapshot.revision,
                  width: sidebarWidth,
                  label: labels.resizeSidebar,
                  onCommit: props.onSidebarWidthCommit,
                  onPreview: (width) =>
                      container.current?.style.setProperty(
                          '--mx-portal-sidebar-width',
                          `${width}px`
                      ),
              })
            : null,
        h(
            'main',
            {
                key: 'host-content',
                ref: main,
                id: mainId,
                tabIndex: -1,
                className: 'mx-sdk-portal-content',
            },
            selection?.type === 'embedded'
                ? h('iframe', {
                      key: `${selection.itemId}:${selection.url}`,
                      title: active?.label ?? snapshot.header.title,
                      src: selection.url,
                      className: 'mx-sdk-portal-embed',
                      referrerPolicy: 'no-referrer',
                      allow: 'fullscreen',
                  })
                : selection
                  ? props.children
                  : h('p', { role: 'status' }, labels.empty)
        ),
        welcome && !welcome.dismissed && welcome.messageHtml.trim()
            ? h(Dialog, {
                  title: welcome.title,
                  onClose: () =>
                      emit({ type: 'dismiss-welcome', welcomeId: welcome.id }),
                  children: h(
                      'div',
                      null,
                      h(CompleteQuillHTMLRenderer, {
                          html: welcome.messageHtml,
                      }),
                      h(
                          'button',
                          {
                              type: 'button',
                              onClick: () =>
                                  emit({
                                      type: 'dismiss-welcome',
                                      welcomeId: welcome.id,
                                  }),
                          },
                          labels.dismissWelcome
                      )
                  ),
              })
            : null,
        logout && user?.logoutEnabled
            ? h(Dialog, {
                  title: labels.confirmLogout,
                  onClose: closeLogout,
                  children: h(
                      'div',
                      { className: 'mx-sdk-portal-dialog-actions' },
                      h(
                          'button',
                          { type: 'button', onClick: closeLogout },
                          labels.cancel
                      ),
                      h(
                          'button',
                          {
                              type: 'button',
                              onClick: confirmLogout,
                          },
                          labels.logout
                      )
                  ),
              })
            : null
    );
}

/** Fully controlled presentation: no URL/storage/auth/record reads or mount-time intents. */
export function CompletePortalShell(
    props: CompletePortalShellProps
): ReactNode {
    return h(Shell, { ...props, key: props.snapshot.scope });
}
