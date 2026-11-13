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
