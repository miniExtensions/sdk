import { createElement as h, StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AirtableFieldType } from '@miniextensions/sdk';
import {
    dispatchFormCompletionCommands,
    projectFormCompletion,
    projectFormCompletionClose,
    projectFormCompletionNavigation,
    type FormCompletionConfiguration,
} from '@miniextensions/sdk/forms';
import {
    CompleteFormCompletion,
    type FormCompletionAction,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-completion.css';
import './styles.css';

function App() {
    const [mode, setMode] =
        useState<
            NonNullable<FormCompletionConfiguration['afterFormSubmission']>
        >('stay');
    const [dynamic, setDynamic] = useState(false);
    const [zero, setZero] = useState(false);
    const [preview, setPreview] = useState(false);
    const [mount, setMount] = useState(0);
    const [events, setEvents] = useState<string[]>([]);
    const [message, setMessage] = useState(
        'Your response is ready. Visit https://example.com/thanks'
    );
    const configuration: FormCompletionConfiguration = {
        afterFormSubmission: mode,
        successAction: true,
        successMessageCanCreateNewRecord: true,
        allowCopySubmittedToNewForm: true,
        successMessageType: dynamic ? 'airtableField' : 'static',
        successMessageStatic:
            '<p><strong>Thank you.</strong> Your response has been saved.</p>',
        successMessageField: 'message',
        successMessageDelay: zero ? 0 : 1,
        redirectURLType: 'static',
        redirectURLStatic: '/thanks',
        enableRedirectDelay: true,
        redirectDelay: zero ? 0 : 3,
        reloadFormDelay: zero ? 0 : 3,
        closeDelay: zero ? 0 : 3,
        autoSubmitAfterPrefill: true,
    };
    const projection = useMemo(
        () =>
            projectFormCompletion({
                configuration,
                language: 'en',
                filteredValues: { message },
                unfilteredValues: { message },
                fields: {
                    message: {
                        airtableField: {
                            id: 'message',
                            name: 'Completion message',
                            description: null,
                            isComputed: false,
                            isPrimaryField: false,
                            config: {
                                type: AirtableFieldType.SINGLE_LINE_TEXT,
                                options: null,
                            },
                        },
                    },
                },
                linkedTableStates: {},
            }),
        [mode, dynamic, zero, message]
    );
    const onCommand = (command: FormCompletionAction) => {
        const commands =
            command === 'close'
                ? [
                      projectFormCompletionClose({
                          currentURL:
                              'https://example.com/form/recDemo?screen=2&prefill_Project=Demo#answer',
                          inIframe: false,
                      }),
                  ]
                : projectFormCompletionNavigation({
                      currentURL:
                          'https://example.com/form/recDemo?screen=2&prefill_Project=Demo#answer',
                      inIframe: false,
                      recordId: 'recDemo',
                      redirectURL: projection.redirectURL,
                      autoSubmitAfterPrefill: true,
                      command: command === 'navigate' ? undefined : command,
                  });
        return dispatchFormCompletionCommands(commands, {
            isCurrent: () => true,
            dispatch(effect) {
                setEvents((previous) => [...previous, JSON.stringify(effect)]);
            },
        });
    };
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK'),
            h('h1', null, 'A clear finish for every form.'),
            h(
                'p',
                null,
                'Explore the complete success presenter. Commands appear below so this demo stays on the page.'
            )
        ),
        h(
            'section',
            { className: 'controls', 'aria-label': 'Completion settings' },
            h(
                'label',
                null,
                'After submission',
                h(
                    'select',
                    {
                        value: mode,
                        onChange: (
                            event: import('react').ChangeEvent<HTMLSelectElement>
                        ) => {
                            setMode(event.currentTarget.value as typeof mode);
                            setMount((value) => value + 1);
                        },
                    },
                    ...(
                        [
                            'stay',
                            'readonly',
                            'redirect',
                            'newForm',
                            'close',
                        ] as const
                    ).map((value) => h('option', { key: value, value }, value))
                )
            ),
            h(
                'label',
                null,
                h('input', {
                    type: 'checkbox',
                    checked: dynamic,
                    onChange: () => setDynamic(!dynamic),
                }),
                ' Dynamic plain text'
            ),
            h(
                'label',
                null,
                h('input', {
                    type: 'checkbox',
                    checked: zero,
                    onChange: () => {
                        setZero(!zero);
                        setMount((value) => value + 1);
                    },
                }),
                ' Immediate action'
            ),
            h(
                'label',
                null,
                h('input', {
                    type: 'checkbox',
                    checked: preview,
                    onChange: () => setPreview(!preview),
                }),
                ' Preview'
            ),
            h(
                'label',
                { className: 'message' },
                'Current dynamic message',
                h('input', {
                    value: message,
                    onChange: (
                        event: import('react').ChangeEvent<HTMLInputElement>
                    ) => setMessage(event.currentTarget.value),
                })
            ),
            h(
                'button',
                {
                    type: 'button',
                    onClick: () => setMount((value) => value + 1),
                },
                'Show a new completion'
            )
        ),
        h(
            'section',
            { className: 'preview', 'aria-label': 'Completion preview' },
            h(CompleteFormCompletion, {
                key: mount,
                projection,
                configuration,
                canSubmit: !preview,
                onCommand,
            })
        ),
        h(
            'section',
            { className: 'events' },
            h('h2', null, 'Dispatched commands'),
            h(
                'p',
                null,
                'Each line records an attempted command. This demo does not navigate, close a window, or contact a backend.'
            ),
            h(
                'ol',
                { 'aria-live': 'polite' },
                ...events.map((event, index) =>
                    h('li', { key: index }, h('code', null, event))
                )
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
