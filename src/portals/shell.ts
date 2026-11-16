/** Already evaluated presentation data. Visibility/auth/record queries stay with the host. */
export type PortalShellView = Readonly<{ id: string; label: string }>;
type MenuBase = Readonly<{ id: string; label: string; badge?: string }>;
export type PortalShellMenuItem = MenuBase &
    (
        | Readonly<{
              type: 'table';
              views?: readonly PortalShellView[];
              defaultViewId?: string;
          }>
        | Readonly<{ type: 'embedded'; url: string }>
        | Readonly<{
              type: 'external';
              url: string;
              target?: '_blank' | '_self';
          }>
        | Readonly<{ type: 'group'; items: readonly PortalShellMenuItem[] }>
    );
export type PortalShellSelection =
    | Readonly<{ type: 'table'; itemId: string; viewId: string | null }>
    | Readonly<{ type: 'embedded'; itemId: string; url: string }>;
export type PortalShellInitialSelection = Readonly<{
    itemId?: string;
    viewId?: string;
}>;
export type PortalShellIntent = Readonly<{
    scope: string;
    revision: string | number;
}> &
    (
        | Readonly<{
              type: 'navigate';
              selection: PortalShellSelection;
              previousSelection: PortalShellSelection | null;
          }>
        | Readonly<{ type: 'dismiss-welcome'; welcomeId: string }>
        | Readonly<{ type: 'user-settings' | 'logout' | 'search-again' }>
    );

/** Only absolute HTTPS URLs are admitted; the host resolves dynamic values first. */
export function isPortalShellUrl(url: string): boolean {
    try {
        const value = new URL(url);
        return (
            value.protocol === 'https:' &&
            value.username === '' &&
            value.password === ''
        );
    } catch {
        return false;
    }
}

/** Remove ambiguous identities, invalid destinations and empty groups without evaluating conditions. */
export function projectPortalShellMenu(
    items: readonly PortalShellMenuItem[]
): readonly PortalShellMenuItem[] {
    const counts = new Map<string, number>();
    const count = (list: readonly PortalShellMenuItem[]) => {
        for (const item of list) {
            counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
            if (item.type === 'group') count(item.items);
        }
    };
    count(items);
    const project = (
        list: readonly PortalShellMenuItem[]
    ): PortalShellMenuItem[] =>
        list.flatMap((item): PortalShellMenuItem[] => {
            if (item.id.trim() === '' || counts.get(item.id) !== 1) return [];
            if (item.type === 'group') {
                const children = project(item.items);
                return children.length
                    ? [
                          {
                              ...item,
                              label: item.label.trim() || 'More',
                              items: children,
                          },
                      ]
                    : [];
            }
            if (item.type === 'external' || item.type === 'embedded')
                return isPortalShellUrl(item.url) ? [item] : [];
            if (item.views === undefined) return [item];
            const views = item.views.filter(
                (view, _index, all) =>
                    view.id.trim() !== '' &&
                    all.filter((other) => other.id === view.id).length === 1
            );
            return views.length ? [{ ...item, views }] : [];
        });
    return project(items);
}

export function flattenPortalShellMenu(
    items: readonly PortalShellMenuItem[]
): readonly Exclude<PortalShellMenuItem, { type: 'group' }>[] {
    return items.flatMap((item) =>
        item.type === 'group' ? flattenPortalShellMenu(item.items) : [item]
    );
}

/** Pure, mount-independent selection. Call with phase=initial only once per host page lifetime. */
export function resolvePortalShellSelection(input: {
    items: readonly PortalShellMenuItem[];
    selection?: PortalShellSelection | null;
    restoredSelection?: PortalShellSelection | null;
    initialSelection?: PortalShellInitialSelection;
    phase: 'initial' | 'reconcile';
}): PortalShellSelection | null {
    const items = flattenPortalShellMenu(projectPortalShellMenu(input.items));
    const resolve = (
        selection: PortalShellSelection | null | undefined
    ): PortalShellSelection | null => {
        if (!selection) return null;
        const item = items.find(
            (candidate) => candidate.id === selection.itemId
        );
        if (item?.type === 'embedded' && selection.type === 'embedded')
            return {
                type: 'embedded',
                itemId: item.id,
                url: isPortalShellUrl(selection.url) ? selection.url : item.url,
            };
        if (item?.type !== 'table' || selection.type !== 'table') return null;
        const viewId =
            item.views === undefined
                ? null
                : (item.views.find((view) => view.id === selection.viewId)
                      ?.id ??
                  item.views.find((view) => view.id === item.defaultViewId)
                      ?.id ??
                  item.views[0]!.id);
        return { type: 'table', itemId: item.id, viewId };
    };
    const current = resolve(input.selection);
    if (current) return current;
    if (input.phase === 'initial') {
        const initial = input.initialSelection;
        if (initial?.viewId) {
            const matching = items.filter(
                (item) =>
                    item.type === 'table' &&
                    item.views?.some((view) => view.id === initial.viewId)
            );
            if (matching.length === 1)
                return resolve({
                    type: 'table',
                    itemId: matching[0]!.id,
                    viewId: initial.viewId,
                });
        }
        if (initial?.itemId) {
            const item = items.find(
                (candidate) => candidate.id === initial.itemId
            );
            const selected =
                item?.type === 'table'
                    ? resolve({ type: 'table', itemId: item.id, viewId: null })
                    : null;
            if (selected) return selected;
        }
        const restored = resolve(input.restoredSelection);
        if (restored) return restored;
    }
    const first = items.find(
        (item) => item.type === 'table' || item.type === 'embedded'
    );
    return first?.type === 'table'
        ? resolve({ type: 'table', itemId: first.id, viewId: null })
        : first?.type === 'embedded'
          ? { type: 'embedded', itemId: first.id, url: first.url }
          : null;
}

export function portalShellSelectionsEqual(
    a: PortalShellSelection | null,
    b: PortalShellSelection | null
): boolean {
    return (
        a === b ||
        (a != null &&
            b != null &&
            a.type === b.type &&
            a.itemId === b.itemId &&
            (a.type === 'table' && b.type === 'table'
                ? a.viewId === b.viewId
                : a.type === 'embedded' &&
                  b.type === 'embedded' &&
                  a.url === b.url))
    );
}
