export function assertPortalShellNavigationConsumer(input: {
    React: typeof import('react');
    ui: Pick<typeof import('../src/react/index.js'), 'CompletePortalShell'>;
    Window: typeof import('happy-dom').Window;
    createRoot: typeof import('react-dom/client').createRoot;
    renderToString: typeof import('react-dom/server').renderToString;
}): Promise<{
    activations: number;
    legacyNavigationIntents: number;
    hoverNotifications: number;
    settingsRequests: number;
    precommitAdmission: 'rejected';
    providerRequests: number;
    submitEvents: number;
    preservedIframe: boolean;
    externalLinkClosure: 'passed';
    tabExitHandoff: 'passed';
    accountKeyboardAndMobileTrap: 'passed';
    hostSelectionAcrossMenuDrift: 'passed';
    closedNavigationKeyboard: 'passed';
}>;
