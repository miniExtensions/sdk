export function assertPortalShellConsumer(input: {
    React: typeof import('react');
    ui: Pick<typeof import('../src/react/index.js'), 'CompletePortalShell'>;
    portals: Pick<
        typeof import('../src/portals/index.js'),
        'resolvePortalShellSelection'
    >;
    Window: typeof import('happy-dom').Window;
    createRoot: typeof import('react-dom/client').createRoot;
    renderToString: typeof import('react-dom/server').renderToString;
}): Promise<{
    navigationIntents: number;
    storageEffects: number;
    customViewReads: number;
    dismissals: number;
    implicitNetworkRequests: number;
    ssrEffects: number;
}>;

export function assertPortalShellSidebarConsumer(
    input: Omit<Parameters<typeof assertPortalShellConsumer>[0], 'portals'>
): Promise<{
    endOnlyCommits: number;
    staleCommits: number;
    bodyRemountsDuringResize: number;
}>;

export function assertPortalShellPresentationConsumer(
    input: Omit<Parameters<typeof assertPortalShellConsumer>[0], 'portals'>
): Promise<{
    availabilityCases: number;
    authorityRetirements: number;
    logoutIntents: number;
    submitEvents: number;
    bodyRemountsWhileSelected: number;
    implicitNetworkRequests: number;
    synchronousPublications: number;
    siblingLogoutIntents: number;
}>;
