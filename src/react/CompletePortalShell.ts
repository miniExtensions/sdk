import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
    type KeyboardEvent,
    type FocusEvent,
    type MouseEvent,
    type CSSProperties,
} from 'react';
import {
    PortalSidebarResize,
    portalSidebarWidth,
    type PortalShellSidebarWidthCommit,
} from './PortalSidebarResize.js';
export type { PortalShellSidebarWidthCommit } from './PortalSidebarResize.js';

export type PortalShellSettingsTarget =
    | Readonly<{ type: 'title' | 'description' | 'profile' }>
    | Readonly<{ type: 'item'; itemId: string }>;
export type PortalShellSettingsRequest = Readonly<{
    scope: string;
    revision: string | number;
    target: PortalShellSettingsTarget;
}>;
import {
    flattenPortalShellMenu,
    portalShellSelectionsEqual,
    projectPortalShellMenu,
    resolvePortalShellSelection,
    isPortalShellUrl,
    type PortalShellIntent,
    type PortalShellMenuItem,
    type PortalShellSelection,
} from '../portals/shell.js';
import {
    CompleteHTMLRenderer,
    CompleteQuillHTMLRenderer,
    CompleteTruncatedDescription,
} from './html/index.js';
import { PortalViewLayoutIcon } from './PortalViewLayoutIcon.js';

export type PortalShellSnapshot = Readonly<{
    /** Changes when the accepted portal/user owner changes. Never include credentials. */
    scope: string;
    /** Host-issued immutable presentation revision. */
    revision: string | number;
    items: readonly PortalShellMenuItem[];
    selection: PortalShellSelection | null;
    /** Host mode validates the supplied selection without independently choosing a fallback. */
    selectionPolicy?: 'resolve' | 'host';
    embed?: Readonly<{
        referrerPolicy?: 'no-referrer' | 'browser-default';
        fullscreen?: boolean;
        preserveElement?: boolean;
    }>;
    header: Readonly<{
        layout: 'sidebar' | 'topbar';
        hidden?: boolean;
        /** Repeat configured branding inside an open overlay drawer. Omission retains header-only branding. */
        showBrandInNavigation?: boolean;
        /** Opt into the native row, including rich titles and settings with the desktop option. */
        topbarLayout?: 'native' | 'native-desktop';
        /** Use a leading menu icon for the visible sidebar's narrow header. */
        sidebarToggle?: 'icon';
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
        /** Opt-in topbar hover/keyboard menus and parent-summary activation. */
        menuInteraction?: 'disclosure' | 'menu';
        logoUrl?: string;
    }>;
    hideMenuItems?: boolean;
    /** Already admitted authoring controls. Native configuration paths stay with the host. */
    settings?: Readonly<{
        title?: string;
        description?: string;
        profile?: string;
        items?: readonly Readonly<{
            itemId: string;
            label: string;
            includeViews?: boolean;
            visibleIn?: 'all' | 'sidebar';
        }>[];
    }>;
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
    /** Opens the existing host editor; never navigation, account settings or a renderer. */
    onOpenSettings?: (request: PortalShellSettingsRequest) => void;
    /** Every explicit selection activation, including reselection; replaces the ordinary navigate notification when supplied. */
    onSelectionActivate?: (request: PortalShellSelectionActivation) => void;
    /** Pointer-only notification. The existing host owns all prefetch/state operations. */
    onItemHover?: (request: PortalShellItemHoverRequest) => void;
    /** The host-owned table/collection body. Menus, header, embed and dialogs are SDK-owned. */
    children?: ReactNode;
    labels?: Partial<PortalShellLabels>;
    className?: string;
};
export type PortalShellSelectionActivation = Extract<
    PortalShellIntent,
    { type: 'navigate' }
>;
export type PortalShellItemHoverRequest = Readonly<{
    scope: string;
    revision: string | number;
    itemId: string;
    viewId: string | null;
}>;

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
/** Editor gears keep Tab/pointer access while arrows traverse destinations. */
function navigationControls(node: HTMLElement): HTMLElement[] {
    return visibleControls(node).filter(
        (element) => !element.classList.contains('mx-sdk-portal-settings')
    );
}

function positionNavigationAccountMenu(
    account: HTMLDetailsElement,
    navigation: HTMLElement,
    clipToHost: boolean
) {
    const viewport = navigation.ownerDocument.defaultView;
    if (!account.open || !navigation.clientHeight || !viewport) return;
    const trigger = account.querySelector(':scope > summary');
    const panel = account.querySelector<HTMLDivElement>(':scope > div');
    if (!trigger || !panel) return;

    const triggerBounds = trigger.getBoundingClientRect();
    const navigationTop =
        navigation.getBoundingClientRect().top + navigation.clientTop;
    let visibleTop = Math.max(0, navigationTop);
    let visibleBottom = Math.min(
        viewport.innerHeight,
        navigationTop + navigation.clientHeight
    );
    if (clipToHost) {
        for (
            let host = navigation.parentElement;
            host && host !== navigation.ownerDocument.body;
            host = host.parentElement
        ) {
            if (viewport.getComputedStyle(host).overflowY === 'visible')
                continue;
            const top = host.getBoundingClientRect().top + host.clientTop;
            visibleTop = Math.max(visibleTop, top);
            visibleBottom = Math.min(visibleBottom, top + host.clientHeight);
        }
    }
    const above = Math.max(0, triggerBounds.top - visibleTop);
    const below = Math.max(0, visibleBottom - triggerBounds.bottom);
    // Include scrollable content if a previous placement constrained the panel.
    const panelHeight =
        panel.getBoundingClientRect().height +
        panel.scrollHeight -
        panel.clientHeight;
    const opensAbove = panelHeight > below && above > below;
    account.toggleAttribute('data-open-above', opensAbove);
    panel.style.setProperty(
        '--mx-portal-account-menu-space',
        `${opensAbove ? above : below}px`
    );
}

function trapFocus(
    event: KeyboardEvent<HTMLElement>,
    boundary = event.currentTarget
) {
    if (event.key !== 'Tab') return;
    const controls = visibleControls(boundary);
    const first = controls[0],
        last = controls.at(-1);
    if (!first) {
        event.preventDefault();
        boundary.focus();
    } else if (
        event.shiftKey &&
        (boundary.ownerDocument.activeElement === first ||
            boundary.ownerDocument.activeElement === boundary)
    ) {
        event.preventDefault();
        last!.focus();
    } else if (
        !event.shiftKey &&
        boundary.ownerDocument.activeElement === last
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
    initialFocus?: RefObject<HTMLElement | null>;
}) {
    const id = useId(),
        ref = useRef<HTMLDivElement>(null);
    const { initialFocus } = props;
    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        const previous = node.ownerDocument.activeElement as HTMLElement | null;
        (initialFocus?.current ?? visibleControls(node)[0] ?? node).focus();
        return () => {
            if (previous?.isConnected) previous.focus();
        };
    }, [initialFocus]);
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
    const resolvedSelection = resolvePortalShellSelection({
        items,
        selection: snapshot.selection,
        phase: 'reconcile',
    });
    const suppliedSelection = snapshot.selection;
    // The host's view/error/loading owner is authoritative. Do not replace a
    // table's pending view or captured embed when its current menu changes.
    // The host retires its accepted owner; this layer only checks the shape
    // and existing HTTPS policy, independently of current menu membership.
    const hostIdentity =
        suppliedSelection != null &&
        typeof suppliedSelection.itemId === 'string' &&
        suppliedSelection.itemId.trim() !== '';
    const hostSelection =
        hostIdentity &&
        suppliedSelection?.type === 'table' &&
        (suppliedSelection.viewId === null ||
            typeof suppliedSelection.viewId === 'string')
            ? suppliedSelection
            : hostIdentity &&
                suppliedSelection?.type === 'embedded' &&
                typeof suppliedSelection.url === 'string' &&
                isPortalShellUrl(suppliedSelection.url)
              ? suppliedSelection
              : null;
    const selection =
        snapshot.selectionPolicy === 'host' ? hostSelection : resolvedSelection;
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
    const settingsAuthority = useMemo(
        () => ({ snapshot, onOpenSettings: props.onOpenSettings }),
        [snapshot, props.onOpenSettings]
    );
    const committedSettingsAuthority = useRef<typeof settingsAuthority | null>(
        null
    );
    const committedLogoutAuthority = useRef<typeof logoutAuthority | null>(
            null
        ),
        activeLogoutAuthority = useRef<typeof logoutAuthority | null>(null);
    const logoutCancel = useRef<HTMLButtonElement>(null);
    const [logoutRequest, setLogoutRequest] = useState<
        typeof logoutAuthority | null
    >(null);
    const logout = logoutRequest === logoutAuthority;
    const openingNavigationEdge = useRef<'first' | 'last' | null>(null);
    const lastNavigationFocus = useRef<HTMLElement | null>(null);
    const toggle = useRef<HTMLButtonElement>(null),
        nav = useRef<HTMLDivElement>(null),
        accountMenu = useRef<HTMLDetailsElement>(null),
        main = useRef<HTMLElement>(null),
        container = useRef<HTMLDivElement>(null);
    const controlledSidebar =
        snapshot.header.layout === 'sidebar' &&
        !snapshot.header.hidden &&
        (snapshot.header.sidebarWidth !== undefined ||
            props.onSidebarWidthCommit !== undefined);
    const layoutActions = snapshot.header.actionsPlacement === 'layout';
    const supportsNativeTopbar =
        layoutActions &&
        snapshot.header.layout === 'topbar' &&
        !snapshot.header.hidden &&
        !snapshot.header.logoUrl &&
        !snapshot.header.descriptionHtml;
    const nativeTopbar =
        supportsNativeTopbar &&
        snapshot.header.topbarLayout === 'native' &&
        snapshot.header.titleHtml == null &&
        snapshot.settings == null;
    const nativeDesktopTopbar =
        supportsNativeTopbar &&
        snapshot.header.topbarLayout === 'native-desktop';
    const navigationInHeader = nativeTopbar || nativeDesktopTopbar;
    const sidebarIconToggle =
        snapshot.header.layout === 'sidebar' &&
        !snapshot.header.hidden &&
        snapshot.header.sidebarToggle === 'icon';
    const richSidebarTitle =
        sidebarIconToggle &&
        layoutActions &&
        Boolean(snapshot.header.titleHtml?.trim()) &&
        !snapshot.header.logoUrl &&
        !snapshot.header.descriptionHtml;
    const richSidebarDrawer =
        richSidebarTitle && snapshot.header.showBrandInNavigation;
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
        committedSettingsAuthority.current = settingsAuthority;
        return () => {
            if (committedSettingsAuthority.current === settingsAuthority)
                committedSettingsAuthority.current = null;
        };
    }, [settingsAuthority]);
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
        if (snapshot.header.menuInteraction === 'menu')
            nav.current
                ?.querySelectorAll<HTMLDetailsElement>('.mx-sdk-portal-group')
                .forEach((details) => {
                    delete details.dataset.hoverOpen;
                    details.open = details.dataset.sidebarExpanded === 'true';
                });
        const edge = openingNavigationEdge.current;
        openingNavigationEdge.current = null;
        const focusRoot =
            edge != null || snapshot.header.menuInteraction === 'menu'
                ? nav.current?.querySelector('nav')
                : nav.current;
        const controlsIn =
            snapshot.header.menuInteraction === 'menu'
                ? navigationControls
                : visibleControls;
        const destinations = focusRoot ? controlsIn(focusRoot) : [];
        const controls =
            destinations.length || !nav.current
                ? destinations
                : controlsIn(nav.current);
        (
            (edge === 'last' ? controls.at(-1) : controls[0]) ?? nav.current
        )?.focus();
        return () => {
            if (toggle.current?.isConnected) toggle.current.focus();
        };
    }, [overlay, open, snapshot.header.menuInteraction]);
    const navigationRevision =
        snapshot.header.menuInteraction === 'menu' ? null : snapshot.revision;
    useEffect(() => {
        openingNavigationEdge.current = null;
        lastNavigationFocus.current = null;
        setOpen(false);
    }, [
        snapshot.scope,
        navigationRevision,
        snapshot.header.menuInteraction,
        snapshot.header.layout,
        snapshot.header.hidden,
        showNavigation,
    ]);
    useCommitEffect(() => {
        const root = nav.current,
            previous = lastNavigationFocus.current;
        if (
            !root ||
            !overlay ||
            !open ||
            snapshot.header.menuInteraction !== 'menu' ||
            !previous ||
            previous.isConnected
        )
            return;
        const document = root.ownerDocument;
        // Reclaim focus only when this drawer's focused control disappeared.
        // A native profile dialog or other legitimate outside focus stays owned.
        if (
            document.activeElement !== document.body &&
            document.activeElement !== document.documentElement
        )
            return;
        const destinations = navigationControls(
            root.querySelector('nav') ?? root
        );
        (destinations[0] ?? navigationControls(root)[0] ?? root).focus();
    });
    useEffect(() => {
        const document = main.current?.ownerDocument;
        const menuMode = snapshot.header.menuInteraction === 'menu';
        if (
            !document ||
            (!menuMode && (snapshot.header.layout !== 'topbar' || overlay))
        )
            return;
        const outside = (event: globalThis.MouseEvent) => {
            if (
                menuMode &&
                event.target instanceof document.defaultView!.Node
            ) {
                const candidates =
                    container.current?.querySelectorAll<HTMLDetailsElement>(
                        snapshot.header.layout === 'topbar' && !overlay
                            ? '.mx-sdk-portal-user[open], .mx-sdk-portal-group[open]'
                            : '.mx-sdk-portal-user[open]'
                    );
                candidates?.forEach((details) => {
                    if (details.contains(event.target as Node)) return;
                    delete details.dataset.hoverOpen;
                    details.removeAttribute('open');
                });
                return;
            }
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
    }, [snapshot.header.layout, snapshot.header.menuInteraction, overlay]);
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
    function closeTopbarDetails(source: HTMLElement) {
        if (overlay || snapshot.header.layout !== 'topbar') return;
        const summary = source.closest('details')?.querySelector('summary');
        nav.current
            ?.querySelectorAll<HTMLDetailsElement>('details[open]')
            .forEach((details) => {
                delete details.dataset.hoverOpen;
                details.removeAttribute('open');
            });
        summary?.focus();
    }
    function externalLink(event: MouseEvent<HTMLAnchorElement>) {
        if (accepted.current !== commandToken) {
            event.preventDefault();
            return;
        }
        if (snapshot.header.menuInteraction === 'menu')
            closeTopbarDetails(event.currentTarget);
        close();
    }
    function navigate(
        next: PortalShellSelection,
        source: HTMLElement,
        closeDisclosure = true
    ) {
        if (accepted.current !== commandToken) return;
        if (closeDisclosure) closeTopbarDetails(source);
        if (closeDisclosure) close();
        if (props.onSelectionActivate) {
            props.onSelectionActivate({
                type: 'navigate',
                scope: snapshot.scope,
                revision: snapshot.revision,
                selection: next,
                previousSelection: selection,
            });
        } else if (!portalShellSelectionsEqual(selection, next))
            emit({
                type: 'navigate',
                selection: next,
                previousSelection: selection,
            });
    }
    const topbarPresentation = snapshot.header.layout === 'topbar' && !overlay;
    const topbarMenu =
        snapshot.header.menuInteraction === 'menu' && topbarPresentation;
    const desktopMenuSelector =
        'nav > ul > li > .mx-sdk-portal-group > .mx-sdk-portal-menu';
    function sizeDesktopMenu(details: HTMLElement | null) {
        if (!details || !nativeDesktopTopbar || !topbarPresentation) return;
        const popup = details.querySelector<HTMLElement>(
            ':scope > .mx-sdk-portal-menu'
        );
        const header = details.closest('header');
        if (!header || !popup?.matches(desktopMenuSelector)) return;
        popup.style.setProperty(
            '--mx-portal-desktop-header-bottom',
            `${Math.max(0, header.getBoundingClientRect().bottom)}px`
        );
    }
    function focusNavigationControl(control: HTMLElement | undefined) {
        if (!control) return;
        const popup =
            nativeDesktopTopbar && topbarMenu
                ? control.closest<HTMLElement>(desktopMenuSelector)
                : null;
        if (!popup) {
            control.focus();
            return;
        }
        sizeDesktopMenu(popup.parentElement);
        control.focus({ preventScroll: true });
        const bounds = popup.getBoundingClientRect();
        const row = control.getBoundingClientRect();
        if (row.top < bounds.top) popup.scrollTop += row.top - bounds.top;
        else if (row.bottom > bounds.bottom)
            popup.scrollTop += row.bottom - bounds.bottom;
    }
    function hoverItem(itemId: string, viewId: string | null) {
        if (accepted.current !== commandToken) return;
        props.onItemHover?.({
            scope: snapshot.scope,
            revision: snapshot.revision,
            itemId,
            viewId,
        });
    }
    function hoverMenu(event: MouseEvent<HTMLElement>, enter: boolean) {
        if (!topbarMenu || accepted.current !== commandToken) return;
        const details = event.currentTarget.querySelector('details');
        if (!details) return;
        if (enter && !details.open) {
            details.dataset.hoverOpen = 'true';
            sizeDesktopMenu(details);
            details.open = true;
        } else if (!enter && details.dataset.hoverOpen === 'true') {
            delete details.dataset.hoverOpen;
            details.open = false;
        }
    }
    function summaryActivation(event: MouseEvent<HTMLElement>) {
        const details = event.currentTarget.closest('details');
        if (details && !details.open) sizeDesktopMenu(details);
        if (topbarMenu && details?.dataset.hoverOpen === 'true') {
            delete details.dataset.hoverOpen;
            if (details.open) event.preventDefault();
        }
    }
    function exitMenuOnTab(event: KeyboardEvent<HTMLElement>): boolean {
        if (snapshot.header.menuInteraction !== 'menu' || event.key !== 'Tab')
            return false;
        if (event.defaultPrevented) return true;
        const details = (
            event.target as HTMLElement
        ).closest<HTMLDetailsElement>('details[open]');
        const trigger = details?.querySelector<HTMLElement>(':scope > summary');
        if (
            !details ||
            !trigger ||
            (!topbarMenu && !details.classList.contains('mx-sdk-portal-user'))
        )
            return false;
        event.stopPropagation();
        delete details.dataset.hoverOpen;
        details.open = false;
        // Preserve the browser's sequential order for host editors and other
        // focus targets. Only the outer mobile drawer may cancel an actual wrap.
        trigger.focus({ preventScroll: true });
        if (overlay && open && nav.current?.contains(trigger))
            trapFocus(event, nav.current);
        return true;
    }
    function keyboard(event: KeyboardEvent<HTMLElement>) {
        if (exitMenuOnTab(event)) return;
        if (event.key === 'Escape') {
            if (overlay && snapshot.header.menuInteraction === 'menu') {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
            }
            const details = (event.target as HTMLElement).closest(
                'details[open]'
            );
            if (details) {
                event.preventDefault();
                event.stopPropagation();
                details.removeAttribute('open');
                details.querySelector('summary')?.focus({
                    preventScroll: nativeDesktopTopbar && topbarMenu,
                });
                return;
            }
            if (overlay) {
                event.preventDefault();
                close();
            }
            return;
        }
        if (overlay && open) trapFocus(event);
        if (topbarMenu && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            const target = event.target as HTMLElement;
            const details = target.closest('details');
            if (target.tagName === 'SUMMARY' && details) {
                event.preventDefault();
                delete details.dataset.hoverOpen;
                sizeDesktopMenu(details);
                details.open = true;
                const controls = navigationControls(details).filter(
                    (node) => node !== target
                );
                focusNavigationControl(
                    event.key === 'ArrowDown' ? controls[0] : controls.at(-1)
                );
                return;
            }
            if (details) delete details.dataset.hoverOpen;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
            return;
        const popup =
            snapshot.header.menuInteraction === 'menu'
                ? (event.target as HTMLElement).closest<HTMLDetailsElement>(
                      'details[open]'
                  )
                : null;
        const summary = popup?.querySelector(':scope > summary');
        const navigationDestinations =
            overlay && snapshot.header.menuInteraction === 'menu'
                ? nav.current?.querySelector('nav')
                : null;
        const controlsIn =
            snapshot.header.menuInteraction === 'menu'
                ? navigationControls
                : visibleControls;
        let controls = controlsIn(
            popup ?? navigationDestinations ?? event.currentTarget
        ).filter((node) => node !== summary);
        if (!popup && navigationDestinations && controls.length === 0)
            controls = controlsIn(event.currentTarget);
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
            focusNavigationControl(controls[next]);
        }
    }
    // Fixed native lucide-react0.417 Settings outline; installed ISC notice retained.
    function settingsButton(
        target: PortalShellSettingsTarget,
        label: string | undefined
    ): ReactNode {
        if (!props.onOpenSettings || !label?.trim()) return null;
        return h(
            'button',
            {
                type: 'button',
                className: 'mx-sdk-portal-settings',
                'aria-label': label,
                'data-config-preview-canvas-control': 'true',
                onClick: (event: MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    if (
                        committedSettingsAuthority.current !==
                            settingsAuthority ||
                        !settingsAuthority.onOpenSettings
                    )
                        return;
                    settingsAuthority.onOpenSettings({
                        scope: snapshot.scope,
                        revision: snapshot.revision,
                        target,
                    });
                },
            },
            h(
                'svg',
                {
                    viewBox: '0 0 24 24',
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 2,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    'aria-hidden': true,
                },
                h('path', {
                    d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
                }),
                h('circle', { cx: 12, cy: 12, r: 3 })
            )
        );
    }
    function itemSettings(itemId: string, forView = false): ReactNode {
        const matches = snapshot.settings?.items?.filter(
            (item) => item.itemId === itemId
        );
        return matches?.length === 1 &&
            (!forView || matches[0]!.includeViews !== false) &&
            (matches[0]!.visibleIn !== 'sidebar' ||
                snapshot.header.layout === 'sidebar' ||
                overlay)
            ? settingsButton({ type: 'item', itemId }, matches[0]!.label)
            : null;
    }
    function configured(content: ReactNode, control: ReactNode): ReactNode {
        return control
            ? h(
                  'div',
                  { className: 'mx-sdk-portal-configurable' },
                  content,
                  control
              )
            : content;
    }
    function menu(list: readonly PortalShellMenuItem[]): ReactNode {
        return h(
            'ul',
            { className: 'mx-sdk-portal-menu' },
            ...list.map((item) => {
                const control = itemSettings(item.id);
                const viewControl = itemSettings(item.id, true);
                const row = {
                    key: item.id,
                    className: control
                        ? 'mx-sdk-portal-configurable'
                        : undefined,
                    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
                        if (
                            (event.target as Element).closest(
                                '.mx-sdk-portal-settings'
                            )
                        )
                            return;
                        if (
                            item.type === 'group' ||
                            (item.type === 'table' && item.views !== undefined)
                        )
                            hoverMenu(event, true);
                        if (
                            item.type === 'table' &&
                            (topbarPresentation ||
                                (snapshot.header.hidden &&
                                    item.views === undefined))
                        )
                            hoverItem(item.id, null);
                    },
                    onMouseLeave: (event: MouseEvent<HTMLElement>) =>
                        hoverMenu(event, false),
                };
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
                        row,
                        snapshot.header.hidden
                            ? menu(item.items)
                            : h(
                                  'details',
                                  {
                                      className: 'mx-sdk-portal-group',
                                      'data-sidebar-expanded':
                                          snapshot.header.menuInteraction ===
                                          'menu'
                                              ? String(
                                                    item.sidebarInitiallyExpanded ===
                                                        true
                                                )
                                              : undefined,
                                      open:
                                          item.sidebarInitiallyExpanded &&
                                          (snapshot.header.layout ===
                                              'sidebar' ||
                                              overlay)
                                              ? true
                                              : undefined,
                                  },
                                  h(
                                      'summary',
                                      { onClick: summaryActivation },
                                      label
                                  ),
                                  menu(item.items)
                              ),
                        control
                    );
                if (item.type === 'external')
                    return h(
                        'li',
                        row,
                        h(
                            'a',
                            {
                                href: item.url,
                                target: item.target ?? '_blank',
                                rel: 'noopener noreferrer',
                                onClick: externalLink,
                            },
                            label,
                            (item.target ?? '_blank') === '_blank'
                                ? h(
                                      'span',
                                      { className: 'mx-sdk-portal-sr-only' },
                                      ` (${labels.externalLink})`
                                  )
                                : null
                        ),
                        control
                    );
                if (item.type === 'table' && item.views !== undefined)
                    return h(
                        'li',
                        row,
                        h(
                            'details',
                            {
                                className: 'mx-sdk-portal-group',
                                'data-sidebar-expanded':
                                    snapshot.header.menuInteraction === 'menu'
                                        ? String(
                                              item.sidebarInitiallyExpanded ===
                                                  true
                                          )
                                        : undefined,
                                open:
                                    item.sidebarInitiallyExpanded &&
                                    (snapshot.header.layout === 'sidebar' ||
                                        overlay)
                                        ? true
                                        : undefined,
                            },
                            h(
                                'summary',
                                {
                                    'data-active':
                                        selection?.itemId === item.id
                                            ? 'true'
                                            : undefined,
                                    onClick: (
                                        event: MouseEvent<HTMLElement>
                                    ) => {
                                        summaryActivation(event);
                                        if (!topbarMenu) return;
                                        if (
                                            props.onSelectionActivate ||
                                            snapshot.selectionPolicy === 'host'
                                        ) {
                                            navigate(
                                                {
                                                    type: 'table',
                                                    itemId: item.id,
                                                    viewId: null,
                                                },
                                                event.currentTarget,
                                                false
                                            );
                                            return;
                                        }
                                        const next =
                                            resolvePortalShellSelection({
                                                items: [item],
                                                phase: 'reconcile',
                                                selection: {
                                                    type: 'table',
                                                    itemId: item.id,
                                                    viewId:
                                                        selection?.type ===
                                                            'table' &&
                                                        selection.itemId ===
                                                            item.id
                                                            ? selection.viewId
                                                            : (item.defaultViewId ??
                                                              null),
                                                },
                                            });
                                        if (next)
                                            navigate(
                                                next,
                                                event.currentTarget,
                                                false
                                            );
                                    },
                                },
                                label
                            ),
                            h(
                                'ul',
                                { className: 'mx-sdk-portal-menu' },
                                ...item.views.map((view) =>
                                    h(
                                        'li',
                                        {
                                            key: view.id,
                                            className: viewControl
                                                ? 'mx-sdk-portal-configurable'
                                                : undefined,
                                        },
                                        h(
                                            'button',
                                            {
                                                type: 'button',
                                                className:
                                                    view.layout !== undefined ||
                                                    view.badge
                                                        ? 'mx-sdk-portal-view'
                                                        : undefined,
                                                onMouseEnter: () => {
                                                    if (!topbarPresentation)
                                                        hoverItem(
                                                            item.id,
                                                            view.id
                                                        );
                                                },
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
                                            view.badge
                                                ? h('span', {
                                                      className:
                                                          'mx-sdk-portal-view-badge',
                                                      'aria-hidden': true,
                                                  })
                                                : null,
                                            view.layout !== undefined
                                                ? h(PortalViewLayoutIcon, {
                                                      layout: view.layout,
                                                      hidden:
                                                          snapshot.header
                                                              .layout ===
                                                              'topbar' &&
                                                          !overlay,
                                                  })
                                                : null,
                                            view.label
                                        ),
                                        viewControl
                                    )
                                )
                            )
                        ),
                        control
                    );
                return h(
                    'li',
                    row,
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
                    ),
                    control
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
                      className:
                          user.settingsEnabled && user.presentation === 'text'
                              ? 'mx-sdk-portal-user-direct mx-sdk-portal-user-direct--profile-text'
                              : 'mx-sdk-portal-user-direct',
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
    const descriptionContent = (
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
    const description = configured(
        descriptionContent,
        snapshot.header.descriptionHtml != null
            ? settingsButton(
                  { type: 'description' },
                  snapshot.settings?.description
              )
            : null
    );
    const hasAccountMenu = Boolean(
        !directUserAction && (user?.settingsEnabled || user?.logoutEnabled)
    );
    const constrainAccountMenu =
        actionsInNavigation &&
        (mobile
            ? open
            : user?.settingsEnabled === true && user.logoutEnabled === true);
    useCommitEffect(() => {
        const account = accountMenu.current;
        const navigation = nav.current;
        if (!constrainAccountMenu || !hasAccountMenu || !account || !navigation)
            return;

        const position = () =>
            positionNavigationAccountMenu(account, navigation, !mobile);
        const panel = account.querySelector<HTMLDivElement>(':scope > div');
        const viewport = navigation.ownerDocument.defaultView;
        const onViewportScroll = (event: Event) => {
            if (event.target === navigation) return;
            if (
                event.target instanceof Element &&
                !event.target.contains(navigation)
            )
                return;
            position();
        };
        const observer =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(position)
                : null;
        observer?.observe(navigation);
        observer?.observe(account);
        if (panel) observer?.observe(panel);
        account.addEventListener('toggle', position);
        navigation.addEventListener('scroll', position, { passive: true });
        // Element scroll events do not bubble. Capture parent scrolling on desktop.
        viewport?.addEventListener('scroll', onViewportScroll, {
            capture: !mobile,
            passive: true,
        });
        viewport?.addEventListener('resize', position);
        position();
        return () => {
            observer?.disconnect();
            account.removeEventListener('toggle', position);
            navigation.removeEventListener('scroll', position);
            viewport?.removeEventListener('scroll', onViewportScroll, !mobile);
            viewport?.removeEventListener('resize', position);
            account.removeAttribute('data-open-above');
            panel?.style.removeProperty('--mx-portal-account-menu-space');
        };
    }, [
        constrainAccountMenu,
        hasAccountMenu,
        mobile,
        navigationInHeader,
        snapshot.revision,
    ]);
    const userActions =
        directUserAction ??
        (hasAccountMenu && user
            ? h(
                  'details',
                  {
                      ref: accountMenu,
                      className: `mx-sdk-portal-user${user.presentation === 'icon' ? ' mx-sdk-portal-user--icon' : ''}`,
                      'data-menu-interaction': snapshot.header.menuInteraction,
                      'data-constrain-to-navigation': constrainAccountMenu
                          ? ''
                          : undefined,
                      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                          if (exitMenuOnTab(event)) return;
                          if (
                              snapshot.header.menuInteraction === 'menu' &&
                              (event.target as HTMLElement).tagName ===
                                  'SUMMARY' &&
                              ['ArrowDown', 'ArrowUp'].includes(event.key)
                          ) {
                              event.preventDefault();
                              event.stopPropagation();
                              const details =
                                  event.currentTarget as HTMLDetailsElement;
                              details.open = true;
                              if (constrainAccountMenu && nav.current)
                                  positionNavigationAccountMenu(
                                      details,
                                      nav.current,
                                      !mobile
                                  );
                              const controls = navigationControls(
                                  details
                              ).filter((node) => node.tagName !== 'SUMMARY');
                              (event.key === 'ArrowDown'
                                  ? controls[0]
                                  : controls.at(-1)
                              )?.focus();
                              return;
                          }
                          if (
                              snapshot.header.menuInteraction === 'menu' &&
                              ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(
                                  event.key
                              )
                          ) {
                              event.stopPropagation();
                              keyboard(event);
                              return;
                          }
                          if (event.key === 'Escape') {
                              if (
                                  snapshot.header.menuInteraction === 'menu' &&
                                  event.currentTarget.hasAttribute('open')
                              ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                              }
                              event.currentTarget.removeAttribute('open');
                              event.currentTarget
                                  .querySelector('summary')
                                  ?.focus();
                          }
                      },
                  },
                  h('summary', { 'aria-label': labels.userMenu }, userLabel),
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
            : null);
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
        configured(
            userActions,
            user?.settingsEnabled
                ? settingsButton(
                      { type: 'profile' },
                      snapshot.settings?.profile
                  )
                : null
        )
    );
    const welcome = snapshot.welcome;
    const brand = (includeDescription: boolean) =>
        !snapshot.header.hidden
            ? h(
                  'div',
                  {
                      className: `mx-sdk-portal-brand${
                          richSidebarTitle
                              ? ' mx-sdk-portal-brand--rich-sidebar-title'
                              : ''
                      }${
                          props.onOpenSettings &&
                          snapshot.settings?.title?.trim()
                              ? ' mx-sdk-portal-configurable'
                              : ''
                      }`,
                  },
                  snapshot.header.logoUrl
                      ? h('img', {
                            src: snapshot.header.logoUrl,
                            alt: '',
                            className:
                                snapshot.header.title === '' &&
                                snapshot.header.titleHtml === ''
                                    ? 'mx-sdk-portal-logo mx-sdk-portal-logo--only'
                                    : 'mx-sdk-portal-logo',
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
                      includeDescription && !descriptionInNavigation
                          ? description
                          : null
                  ),
                  settingsButton({ type: 'title' }, snapshot.settings?.title)
              )
            : null;
    const iconToggle = sidebarIconToggle || nativeTopbar;
    const toggleLabel = open ? labels.closeNavigation : labels.openNavigation;
    const navigationToggle = showNavigation
        ? h(
              'button',
              {
                  ref: toggle,
                  type: 'button',
                  className: 'mx-sdk-portal-toggle',
                  'aria-expanded': open,
                  'aria-controls': navId,
                  'aria-label': iconToggle ? toggleLabel : undefined,
                  onClick: () => {
                      openingNavigationEdge.current = null;
                      setOpen(!open);
                  },
                  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                      if (
                          event.defaultPrevented ||
                          !overlay ||
                          snapshot.header.menuInteraction !== 'menu' ||
                          !['ArrowDown', 'ArrowUp'].includes(event.key)
                      )
                          return;
                      event.preventDefault();
                      openingNavigationEdge.current =
                          event.key === 'ArrowUp' ? 'last' : 'first';
                      setOpen(true);
                  },
              },
              iconToggle
                  ? h(
                        'svg',
                        {
                            width: 24,
                            height: 24,
                            viewBox: '0 0 24 24',
                            fill: 'currentColor',
                            'aria-hidden': true,
                        },
                        h('path', {
                            fillRule: 'evenodd',
                            clipRule: 'evenodd',
                            d: 'M3 6.75A.75.75 0 0 1 3.75 6h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 6.75ZM3 12a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 12Zm0 5.25a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z',
                        })
                    )
                  : toggleLabel
          )
        : null;
    const navigation = showNavigation
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
                      className:
                          overlay && richSidebarDrawer
                              ? 'mx-sdk-portal-navigation mx-sdk-portal-navigation--rich-title'
                              : 'mx-sdk-portal-navigation',
                      role: overlay && open ? 'dialog' : undefined,
                      'aria-modal': overlay && open ? true : undefined,
                      'aria-label': labels.navigation,
                      tabIndex: -1,
                      onFocusCapture: (event: FocusEvent<HTMLElement>) => {
                          lastNavigationFocus.current = event.target;
                      },
                      onBlurCapture: (event: FocusEvent<HTMLElement>) => {
                          if (
                              event.relatedTarget != null
                                  ? !event.currentTarget.contains(
                                        event.relatedTarget
                                    )
                                  : event.target.isConnected
                          )
                              lastNavigationFocus.current = null;
                      },
                      onKeyDown: keyboard,
                  },
                  overlay
                      ? h(
                            'button',
                            {
                                type: 'button',
                                onClick: close,
                                ...(richSidebarDrawer
                                    ? {
                                          className:
                                              'mx-sdk-portal-navigation-close',
                                          'aria-label': labels.closeNavigation,
                                      }
                                    : {}),
                            },
                            richSidebarDrawer
                                ? h(
                                      'svg',
                                      {
                                          width: 24,
                                          height: 24,
                                          viewBox: '0 0 24 24',
                                          fill: 'none',
                                          stroke: 'currentColor',
                                          strokeWidth: 1.5,
                                          'aria-hidden': true,
                                      },
                                      h('path', {
                                          strokeLinecap: 'round',
                                          strokeLinejoin: 'round',
                                          d: 'M6 18 18 6M6 6l12 12',
                                      })
                                  )
                                : labels.closeNavigation
                        )
                      : null,
                  overlay && snapshot.header.showBrandInNavigation
                      ? brand(false)
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
        : null;
    const nativeDirectLogout = Boolean(
        snapshot.header.layout === 'sidebar' &&
            !snapshot.header.hidden &&
            snapshot.header.actionsPlacement === 'layout' &&
            directUserAction &&
            user?.logoutEnabled
    );
    const cancelLogoutButton = h(
        'button',
        {
            key: 'cancel',
            ref: logoutCancel,
            type: 'button',
            onClick: closeLogout,
        },
        labels.cancel
    );
    const confirmLogoutButton = h(
        'button',
        {
            key: 'confirm',
            type: 'button',
            'data-danger': nativeDirectLogout || undefined,
            onClick: confirmLogout,
        },
        labels.logout
    );
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
                nativeTopbar ? 'mx-sdk-portal-shell--native-topbar' : '',
                nativeDesktopTopbar
                    ? 'mx-sdk-portal-shell--native-desktop-topbar'
                    : '',
                sidebarIconToggle
                    ? 'mx-sdk-portal-shell--sidebar-icon-toggle'
                    : '',
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
            sidebarIconToggle ? navigationToggle : null,
            brand(true),
            sidebarIconToggle ? null : navigationToggle,
            navigationInHeader ? navigation : null,
            actionsInNavigation ? null : actions
        ),
        navigationInHeader ? null : navigation,
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
                      key: snapshot.embed?.preserveElement
                          ? 'portal-embed'
                          : `${selection.itemId}:${selection.url}`,
                      title: active?.label ?? snapshot.header.title,
                      src: selection.url,
                      className: 'mx-sdk-portal-embed',
                      referrerPolicy:
                          snapshot.embed?.referrerPolicy === 'browser-default'
                              ? undefined
                              : 'no-referrer',
                      allow:
                          snapshot.embed?.fullscreen === false
                              ? undefined
                              : 'fullscreen',
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
                  initialFocus: logoutCancel,
                  children: h(
                      'div',
                      {
                          className: 'mx-sdk-portal-dialog-actions',
                          'data-native-direct-logout':
                              nativeDirectLogout || undefined,
                      },
                      ...(nativeDirectLogout
                          ? [confirmLogoutButton, cancelLogoutButton]
                          : [cancelLogoutButton, confirmLogoutButton])
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
