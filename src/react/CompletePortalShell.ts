import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useId,
    useRef,
    useState,
    type ReactNode,
    type KeyboardEvent,
    type MouseEvent,
} from 'react';
import {
    flattenPortalShellMenu,
    portalShellSelectionsEqual,
    projectPortalShellMenu,
    resolvePortalShellSelection,
    type PortalShellIntent,
    type PortalShellMenuItem,
    type PortalShellSelection,
} from '../portals/shell.js';
import { CompleteQuillHTMLRenderer } from './html/index.js';

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
        descriptionHtml?: string;
        logoUrl?: string;
    }>;
    hideMenuItems?: boolean;
    user?: Readonly<{
        name: string;
        settingsEnabled?: boolean;
        logoutEnabled?: boolean;
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
};
const defaultLabels: PortalShellLabels = {
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
};
export type CompletePortalShellProps = {
    snapshot: PortalShellSnapshot;
    onIntent: (intent: PortalShellIntent) => void;
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
        [open, setOpen] = useState(false),
        [logout, setLogout] = useState(false);
    const toggle = useRef<HTMLButtonElement>(null),
        nav = useRef<HTMLDivElement>(null),
        main = useRef<HTMLElement>(null);
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
    useEffect(() => {
        const query = main.current?.ownerDocument.defaultView?.matchMedia(
            '(max-width: 1023px)'
        );
        if (!query) return;
        const change = () => setMobile(query.matches);
        change();
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, []);
    useEffect(() => {
        if (!overlay || !open) return;
        (nav.current && visibleControls(nav.current)[0])?.focus();
        return () => {
            if (toggle.current?.isConnected) toggle.current.focus();
        };
    }, [overlay, open]);
    useEffect(() => {
        setOpen(false);
        setLogout(false);
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
        user && (user.settingsEnabled || user.logoutEnabled)
            ? h(
                  'details',
                  {
                      className: 'mx-sdk-portal-user',
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
                      user.name || labels.userMenu
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
                                        setLogout(true);
                                    },
                                },
                                labels.logout
                            )
                          : null
                  )
              )
            : null
    );
    const welcome = snapshot.welcome;
    return h(
        'div',
        {
            className: [
                'mx-sdk-portal-shell',
                `mx-sdk-portal-shell--${snapshot.header.layout}`,
                snapshot.header.hidden ? 'mx-sdk-portal-shell--hidden' : '',
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
                          h('h1', null, snapshot.header.title),
                          snapshot.header.descriptionHtml
                              ? h(CompleteQuillHTMLRenderer, {
                                    html: snapshot.header.descriptionHtml,
                                })
                              : null
                      )
                  )
                : null,
            !snapshot.hideMenuItems && items.length > 0
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
            actions
        ),
        !snapshot.hideMenuItems && items.length > 0
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
                      h('nav', { 'aria-label': labels.navigation }, menu(items))
                  )
              )
            : null,
        h(
            'main',
            {
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
                  onClose: () => setLogout(false),
                  children: h(
                      'div',
                      { className: 'mx-sdk-portal-dialog-actions' },
                      h(
                          'button',
                          { type: 'button', onClick: () => setLogout(false) },
                          labels.cancel
                      ),
                      h(
                          'button',
                          {
                              type: 'button',
                              onClick: () => {
                                  setLogout(false);
                                  emit({ type: 'logout' });
                              },
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
