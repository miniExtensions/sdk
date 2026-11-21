import { createElement as h, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
    dispatchFormCompletionCommands,
    projectFormCompletion,
    projectFormCompletionNavigation,
} from '@miniextensions/sdk/forms';
import {
    CompleteFormCompletion,
    CompleteFormReadonlyFooterActions,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-completion.css';

const recordId = 'recSource';
const evidenceKey = 'standalone-child-copy-evidence';
const output = document.querySelector('#receipt');
const container = document.querySelector('#root');

if (window.location.pathname === '/form') {
    const carried = sessionStorage.getItem(evidenceKey);
    sessionStorage.removeItem(evidenceKey);
    output.textContent = JSON.stringify({
        landedURL: window.location.href,
        topLevel: window.top === window,
        react: version,
        source: carried ? JSON.parse(carried) : null,
        evidenceKeyRemoved: sessionStorage.getItem(evidenceKey) === null,
    });
    container.textContent = 'Copied Form destination';
} else {
    const configuration = {
        allowCopySubmittedToNewForm: true,
        successMessageCanCreateNewRecord: true,
        enableLockingFormAfterSubmission: false,
        afterFormSubmission: 'stay',
        successAction: true,
        successMessageStatic: '<p>Saved child Form</p>',
    };
    const evidence = {
        sourceURL: window.location.href,
        react: version,
        topLevel: window.top === window,
        keys: [],
        clicks: [],
        intents: [],
        dispatched: [],
        receipt: null,
        submits: 0,
        controlActivations: 0,
        blockedConnections: 0,
    };
    const publish = () => {
        output.textContent = JSON.stringify(evidence);
    };
    const surfaceFor = (element) =>
        element instanceof Element
            ? (element.closest('[data-surface]')?.dataset.surface ?? null)
            : null;
    const observeKey = (event) => {
        if (event.key !== 'Tab' && event.key !== 'Enter') return;
        evidence.keys.push({
            key: event.key,
            shift: event.shiftKey,
            trusted: event.isTrusted,
            surface: surfaceFor(event.target),
        });
        publish();
    };
    const observePolicy = (event) => {
        if (event.effectiveDirective !== 'connect-src') return;
        evidence.blockedConnections++;
        publish();
    };
    document.addEventListener('keydown', observeKey, true);
    document.addEventListener('securitypolicyviolation', observePolicy);

    let current = true;
    const commandFor = (surface) => (intent) => {
        evidence.intents.push({ surface, intent });
        const commands = projectFormCompletionNavigation({
            command: intent,
            currentURL: window.location.href,
            inIframe: window.top !== window,
            recordId,
        });
        evidence.receipt = dispatchFormCompletionCommands(commands, {
            isCurrent: () => current,
            dispatch(command) {
                if (
                    command.type !== 'navigate' ||
                    command.route !== 'self' ||
                    new URL(command.url).origin !== window.location.origin
                )
                    throw new Error(
                        'Fixture only allows same-origin self navigation'
                    );
                evidence.dispatched.push(command);
                // The visitor host uses real document navigation for a self route.
                window.location.href = command.url;
            },
        });
        sessionStorage.setItem(evidenceKey, JSON.stringify(evidence));
        publish();
    };
    const footer = (surface, label, changes = {}) =>
        h(
            'section',
            { 'aria-label': label, 'data-surface': surface },
            h(CompleteFormReadonlyFooterActions, {
                configuration,
                language: 'en',
                mode: 'readonly',
                context: 'side-panel',
                hasParentExtension: true,
                hasExistingRecord: true,
                ...changes,
                onCommand: commandFor(surface),
            })
        );
    const postSave = projectFormCompletion({
        configuration,
        language: 'en',
        filteredValues: {},
        unfilteredValues: {},
        fields: {},
        linkedTableStates: {},
        hasParentExtension: true,
    });
    const root = createRoot(container);
    flushSync(() =>
        root.render(
            h(
                'form',
                {
                    onSubmit(event) {
                        event.preventDefault();
                        evidence.submits++;
                        publish();
                    },
                    onClickCapture(event) {
                        evidence.clicks.push({
                            trusted: event.isTrusted,
                            surface: surfaceFor(event.target),
                        });
                        publish();
                    },
                },
                footer('eligible', 'Eligible child'),
                footer('locked', 'Locked child', {
                    configuration: {
                        ...configuration,
                        enableLockingFormAfterSubmission: true,
                    },
                }),
                footer('disabled', 'Disabled child', { disabled: true }),
                h(
                    'section',
                    {
                        'aria-label': 'Child post-save',
                        'data-surface': 'post-save',
                    },
                    h(CompleteFormCompletion, {
                        configuration,
                        projection: postSave,
                        canSubmit: true,
                        isCurrent: () => current,
                        onCommand: commandFor('post-save'),
                    })
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        'data-surface': 'keyboard-control',
                        onClick() {
                            evidence.controlActivations++;
                            publish();
                        },
                    },
                    'Keyboard control'
                )
            )
        )
    );
    publish();
    window.addEventListener(
        'pagehide',
        () => {
            current = false;
            document.removeEventListener('keydown', observeKey, true);
            document.removeEventListener(
                'securitypolicyviolation',
                observePolicy
            );
            root.unmount();
        },
        { once: true }
    );
}
