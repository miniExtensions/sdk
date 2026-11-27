import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteFormCompletion,
    CompleteFormCompletionMessage,
    CompleteFormReadonlyFooterActions,
    useFormCompletionCountdown,
    type CompleteFormCompletionProps,
    type CompleteFormReadonlyFooterActionsProps,
} from '../src/react/index.js';
import {
    projectFormCompletion,
    projectFormCompletionNavigation,
    type FormCompletionConfiguration,
    type ProjectFormCompletionInput,
} from '../src/forms/index.js';
import { textField } from './fixtures.js';

const project = (
    configuration: FormCompletionConfiguration,
    options?: Partial<
        Pick<
            ProjectFormCompletionInput,
            'hasParentExtension' | 'hasLogout' | 'language'
        >
    >
) =>
    projectFormCompletion({
        configuration,
        language: 'en',
        filteredValues: {},
        unfilteredValues: {},
        fields: {},
        linkedTableStates: {},
        ...options,
    });

const childActionConfiguration = {
    afterFormSubmission: 'stay',
    successAction: true,
    successMessageCanCreateNewRecord: true,
    allowCopySubmittedToNewForm: true,
    enableLockingFormAfterSubmission: false,
} satisfies FormCompletionConfiguration;

const readonlyFooter = {
    configuration: childActionConfiguration,
    language: 'en',
    context: 'direct-url',
    mode: 'readonly',
    hasParentExtension: false,
    hasExistingRecord: true,
} satisfies Omit<CompleteFormReadonlyFooterActionsProps, 'onCommand'>;

function props(
    configuration: FormCompletionConfiguration,
    onCommand: CompleteFormCompletionProps['onCommand']
): CompleteFormCompletionProps {
    return {
        configuration,
        projection: project(configuration),
        canSubmit: true,
        onCommand,
    };
}
async function fixture(t: TestContext) {
    const window = new Window();
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const descriptors = new Map(
        Object.keys(values).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ])
    );
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    let unmounted = false;
    const unmount = async () => {
        if (!unmounted) {
            await act(async () => root.unmount());
            unmounted = true;
        }
    };
    t.after(async () => {
        await unmount();
        t.mock.timers.reset();
        window.happyDOM.abort();
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
    return {
        container,
        window,
        unmount,
        render: async (node: ReactNode) => {
            await act(async () => root.render(node));
        },
        tick: async (ms: number) => {
            await act(async () => t.mock.timers.tick(ms));
        },
    };
}
it('read-only footer offers only Copy in a child side panel', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    let submits = 0;
    let writes = 0;
    await f.render(
        h(
            StrictMode,
            null,
            h(
                'form',
                {
                    onSubmit(event: import('react').FormEvent) {
                        event.preventDefault();
                        submits++;
                        writes++;
                    },
                },
                h(CompleteFormReadonlyFooterActions, {
                    ...readonlyFooter,
                    context: 'side-panel',
                    hasParentExtension: true,
                    onCommand(command) {
                        calls.push(command);
                    },
                })
            )
        )
    );
    assert.deepEqual(calls, []);
    const buttons = [...f.container.querySelectorAll('button')];
    assert.deepEqual(
        buttons.map((button) => button.textContent),
        ['Copy submission']
    );
    assert.equal(buttons[0]!.type, 'button');
    await act(async () => buttons[0]!.click());
    assert.deepEqual(calls, ['copy_form']);
    assert.equal(submits, 0);
    assert.equal(writes, 0);
});

it('post-save child suppresses both manual actions', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    const c = childActionConfiguration;
    await f.render(
        h(
            StrictMode,
            null,
            h(CompleteFormCompletion, {
                ...props(c, (command) => {
                    calls.push(command);
                }),
                projection: project(c, { hasParentExtension: true }),
            })
        )
    );
    assert(f.container.querySelector('[role="alert"]'));
    assert.equal(f.container.querySelectorAll('button').length, 0);
    await f.tick(1000);
    assert.deepEqual(calls, []);
});

it('read-only root footer buttons each emit one distinct intent for host navigation', async (t) => {
    const f = await fixture(t);
    const intents: string[] = [];
    const navigations: URL[] = [];
    let submits = 0;
    let writes = 0;
    const currentURL =
        'https://host.invalid/form/recCurrent?screen=success&recordIdToCopyFrom=recOld&campaign=summer&prefill_Name=Current';
    await f.render(
        h(
            'form',
            {
                onSubmit(event: import('react').FormEvent) {
                    event.preventDefault();
                    submits++;
                    writes++;
                },
            },
            h(CompleteFormReadonlyFooterActions, {
                ...readonlyFooter,
                onCommand(command) {
                    intents.push(command);
                    const [result] = projectFormCompletionNavigation({
                        currentURL,
                        recordId: 'recCurrent',
                        inIframe: false,
                        command,
                    });
                    assert.equal(result?.type, 'navigate');
                    navigations.push(new URL(result.url));
                },
            })
        )
    );
    const [submitAnother, copy] = f.container.querySelectorAll('button');
    assert.equal(submitAnother?.textContent, 'Submit another form');
    assert.equal(copy?.textContent, 'Copy submission');
    for (const [button, pathCount] of [
        [submitAnother, 1],
        [copy, 2],
    ] as const) {
        assert(
            button.classList.contains(
                'mx-sdk-form-readonly-footer-action--styled'
            )
        );
        const icon = button.querySelector('svg');
        assert.equal(icon?.getAttribute('aria-hidden'), 'true');
        assert.equal(icon?.getAttribute('width'), '16');
        assert.equal(icon?.getAttribute('height'), '16');
        assert.equal(icon?.querySelectorAll('path').length, pathCount);
    }
    assert.deepEqual(intents, []);
    await act(async () => submitAnother.click());
    assert.deepEqual(intents, ['submit_another_form']);
    await act(async () => copy.click());
    assert.deepEqual(intents, ['submit_another_form', 'copy_form']);
    assert.equal(navigations[0]!.searchParams.has('recordIdToCopyFrom'), false);
    assert.equal(
        navigations[1]!.searchParams.get('recordIdToCopyFrom'),
        'recCurrent'
    );
    for (const destination of navigations) {
        assert.equal(destination.pathname, '/form');
        assert.equal(destination.searchParams.has('screen'), false);
        assert.equal(destination.searchParams.get('campaign'), 'summer');
        assert.equal(destination.searchParams.get('prefill_Name'), 'Current');
    }
    assert.deepEqual({ submits, writes }, { submits: 0, writes: 0 });
});

it('read-only footer applies each surface, flag, lock and record gate independently', async (t) => {
    const f = await fixture(t);
    const copy = 'Copy submission';
    const submitAnother = 'Submit another form';
    const completionDisabled = {
        ...childActionConfiguration,
        afterFormSubmission: 'redirect',
        successAction: false,
    } satisfies FormCompletionConfiguration;
    type Props = CompleteFormReadonlyFooterActionsProps;
    const cases: [string, Partial<Props>, string[]][] = [
        [
            'locked child',
            {
                context: 'side-panel',
                hasParentExtension: true,
                configuration: {
                    ...childActionConfiguration,
                    enableLockingFormAfterSubmission: true,
                },
            },
            [],
        ],
        ['child modal', { context: 'modal', hasParentExtension: true }, []],
        [
            'locked root',
            {
                configuration: {
                    ...childActionConfiguration,
                    enableLockingFormAfterSubmission: true,
                },
            },
            [submitAnother],
        ],
        [
            'login root',
            {
                configuration: {
                    ...childActionConfiguration,
                    accessingRecordsMethod: 'loginPage',
                },
            },
            [copy],
        ],
        [
            'locked login root',
            {
                configuration: {
                    ...childActionConfiguration,
                    accessingRecordsMethod: 'loginPage',
                    enableLockingFormAfterSubmission: true,
                },
            },
            [],
        ],
        ['editable', { mode: 'editable' }, []],
        ['config preview', { mode: 'config-preview' }, []],
        [
            'only submit flag',
            { configuration: { successMessageCanCreateNewRecord: true } },
            [submitAnother],
        ],
        [
            'only copy flag',
            { configuration: { allowCopySubmittedToNewForm: true } },
            [copy],
        ],
        ['neither flag', { configuration: {} }, []],
        ['no source record', { hasExistingRecord: false }, [submitAnother]],
        ['form layout', { context: 'form-layout' }, [submitAnother, copy]],
        [
            'independent completion settings',
            { configuration: completionDisabled },
            [submitAnother, copy],
        ],
    ];
    const onCommand = () => assert.fail('Mount emitted a footer intent');
    for (const [name, input, labels] of cases) {
        await f.render(
            h(CompleteFormReadonlyFooterActions, {
                ...readonlyFooter,
                onCommand,
                ...input,
            })
        );
        assert.deepEqual(
            [...f.container.querySelectorAll('button')].map(
                (button) => button.textContent
            ),
            labels,
            name
        );
    }
});

it('read-only footer preserves custom and intentional blank labels with localized defaults', async (t) => {
    const f = await fixture(t);
    const onCommand = () =>
        assert.fail('Disabled button emitted a footer intent');
    const cases = [
        {
            submit: ' Nouveau ',
            copy: ' Dupliquer ',
            labels: [' Nouveau ', ' Dupliquer '],
            accessibleCopy: null,
        },
        {
            submit: null,
            copy: null,
            labels: ['Soumettre un autre formulaire', 'Copier la soumission'],
            accessibleCopy: null,
        },
        {
            submit: '  ',
            copy: '',
            labels: ['Soumettre un autre formulaire', ''],
            accessibleCopy: 'Copier la soumission',
        },
        {
            submit: '',
            copy: '  ',
            labels: ['Soumettre un autre formulaire', '  '],
            accessibleCopy: 'Copier la soumission',
        },
    ];
    for (const { submit, copy, labels, accessibleCopy } of cases) {
        await f.render(
            h(CompleteFormReadonlyFooterActions, {
                ...readonlyFooter,
                configuration: {
                    ...childActionConfiguration,
                    successMessageNewRecordText: submit,
                    allowCopySubmittedToNewFormButtonText: copy,
                },
                language: 'fr',
                disabled: true,
                buttonClassName: 'host-footer-button',
                onCommand,
            })
        );
        const buttons = [...f.container.querySelectorAll('button')];
        assert.deepEqual(
            buttons.map((button) => button.textContent),
            labels
        );
        assert.equal(buttons[1]?.getAttribute('aria-label'), accessibleCopy);
        for (const button of buttons) {
            assert(button.disabled);
            assert(button.classList.contains('host-footer-button'));
            await act(async () => button.click());
        }
    }
});

it('post-save root actions preserve stay, session, lock, label and disabled rules', async (t) => {
    const f = await fixture(t);
    const both = ['Soumettre un autre formulaire', 'Copier la soumission'];
    type Options = Parameters<typeof project>[1];
    const cases: [
        string,
        FormCompletionConfiguration,
        Options,
        boolean,
        string[],
        string?,
    ][] = [
        ['default labels', {}, {}, true, both],
        [
            'configured labels',
            {
                successMessageNewRecordText: ' Nouveau ',
                allowCopySubmittedToNewFormButtonText: ' Dupliquer ',
            },
            {},
            true,
            [' Nouveau ', ' Dupliquer '],
        ],
        [
            'blank labels',
            {
                successMessageNewRecordText: '  ',
                allowCopySubmittedToNewFormButtonText: '',
            },
            {},
            true,
            [both[0]!],
        ],
        [
            'space-only Copy caption',
            { allowCopySubmittedToNewFormButtonText: '  ' },
            {},
            true,
            [both[0]!, '  '],
            both[1],
        ],
        [
            'locked',
            { enableLockingFormAfterSubmission: true },
            {},
            true,
            [both[0]!],
        ],
        ['login', { accessingRecordsMethod: 'loginPage' }, {}, true, []],
        ['logout', {}, { hasLogout: true }, true, []],
        ['completion actions off', { successAction: false }, {}, true, []],
        ['disabled', {}, {}, false, both],
        ...(['readonly', 'redirect', 'newForm', 'close'] as const).map(
            (mode) =>
                [mode, { afterFormSubmission: mode }, {}, true, []] as [
                    string,
                    FormCompletionConfiguration,
                    Options,
                    boolean,
                    string[],
                ]
        ),
    ];
    const calls: string[] = [];
    for (const [name, input, options, canSubmit, labels, copyName] of cases) {
        const configuration = { ...childActionConfiguration, ...input };
        await f.render(
            h(CompleteFormCompletion, {
                ...props(configuration, (command) => {
                    calls.push(command);
                }),
                key: name,
                projection: project(configuration, {
                    ...options,
                    language: 'fr',
                }),
                canSubmit,
            })
        );
        const buttons = [...f.container.querySelectorAll('button')];
        assert.deepEqual(
            buttons.map((button) => button.textContent),
            labels,
            name
        );
        assert.equal(
            buttons[1]?.getAttribute('aria-label') ?? null,
            copyName ?? null,
            name
        );
        if (!canSubmit)
            for (const button of buttons) {
                assert(button.disabled);
                await act(async () => button.click());
            }
        assert.deepEqual(calls, [], name);
    }
});

it('SSR renders complete sanitized default UI and localized stock actions without effects or browser access', () => {
    let calls = 0;
    const c = {
        afterFormSubmission: 'stay',
        successAction: true,
        successMessageStatic:
            '<p>Hello <strong>world</strong><script>alert(1)</script></p>',
        successMessageCanCreateNewRecord: true,
        allowCopySubmittedToNewForm: true,
    } satisfies FormCompletionConfiguration;
    const html = renderToString(
        h(
            CompleteFormCompletion,
            props(c, () => {
                calls++;
            })
        )
    );
    assert(html.includes('role="alert"'));
    const icon = html.match(
        /<svg[^>]*class="mx-sdk-form-completion-icon"[^>]*>.*?<\/svg>/
    )?.[0];
    assert(icon);
    assert(icon.includes('viewBox="0 0 24 24"'));
    assert(icon.includes('aria-hidden="true"'));
    assert(icon.includes('d="M2.25 12c0-5.385'));
    assert(html.includes('<strong>world</strong>'));
    assert(!html.includes('<script>'));
    assert(html.includes('Submit another form'));
    assert(html.includes('Copy submission'));
    assert.equal(calls, 0);
});
it('first eligible duration is retained while current config, values and callbacks choose the dispatched action', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    const original = {
        afterFormSubmission: 'redirect',
        redirectURLStatic: '/first',
        enableRedirectDelay: true,
        redirectDelay: 3,
        successAction: true,
        successMessageStatic: 'First',
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            CompleteFormCompletion,
            props(original, (command) => {
                calls.push(`old:${command}`);
            })
        )
    );
    await f.tick(1000);
    const current = {
        ...original,
        afterFormSubmission: 'close',
        closeDelay: 90,
        successMessageStatic: 'Current',
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            CompleteFormCompletion,
            props(current, (command) => {
                calls.push(`current:${command}`);
            })
        )
    );
    assert(f.container.textContent.includes('Current'));
    await f.tick(1999);
    assert.deepEqual(calls.slice(), []);
    await f.tick(1);
    assert.deepEqual(calls.slice(), ['current:close']);
    assert(f.container.textContent.includes(project(current).labels.canClose));
    await f.render(
        h(
            CompleteFormCompletion,
            props(original, (command) => {
                calls.push(command);
            })
        )
    );
    await f.tick(100000);
    assert.deepEqual(calls.slice(), ['current:close']);
});
it('zero action delay is immediate and the independently mounted message clock survives countdown stop/reset', async (t) => {
    const f = await fixture(t);
    let count!: ReturnType<typeof useFormCompletionCountdown>;
    let calls = 0;
    function Harness() {
        count = useFormCompletionCountdown({
            start: 10,
            onComplete: () => {
                calls++;
            },
        });
        return h(CompleteFormCompletionMessage, {
            message: { text: 'Delayed body', format: 'text' },
            delay: 5,
        });
    }
    await f.render(h(Harness));
    await act(async () => count.start(0));
    await f.tick(0);
    assert.equal(calls, 1);
    assert(f.container.querySelector('[role="status"]'));
    await act(async () => {
        count.reset(2);
        count.stop();
    });
    await f.tick(4999);
    assert(f.container.querySelector('[role="status"]'));
    assert.equal(calls, 1);
    await f.tick(1);
    assert.equal(f.container.textContent, 'Delayed body');
    assert.equal(calls, 1);
});

it('announces a delayed confirmation in the Form language until its five-second deadline', async (t) => {
    const f = await fixture(t);
    const fetch = t.mock.method(globalThis, 'fetch', () => {
        throw new Error('Unexpected network request');
    });
    const calls: string[] = [];
    const configuration = {
        afterFormSubmission: 'stay',
        successAction: true,
        successMessageDelay: 5,
    } satisfies FormCompletionConfiguration;
    for (const [language, loading, success] of [
        ['en', 'Loading', 'Form submitted successfully'],
        ['fr', 'Chargement', 'Formulaire soumis avec succès'],
    ] as const) {
        await f.render(
            h(CompleteFormCompletion, {
                key: language,
                ...props(configuration, (command) => {
                    calls.push(command);
                }),
                projection: project(configuration, { language }),
            })
        );
        await f.tick(4999);
        const status = f.container.querySelector('[role="status"]');
        assert(status);
        assert.deepEqual(
            [status.getAttribute('aria-label'), status.textContent],
            [loading, `${loading}...`],
            language
        );
        assert(!f.container.textContent.includes(success));
        await f.tick(1);
        assert(!f.container.querySelector('[role="status"]'));
        assert.equal(f.container.textContent, success);
    }
    assert.deepEqual(calls, []);
    assert.equal(fetch.mock.callCount(), 0);
});

it('configured zero message and close clocks complete once through StrictMode', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    const c = {
        afterFormSubmission: 'close',
        closeDelay: 0,
        successMessageDelay: 0,
        successAction: true,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            StrictMode,
            null,
            h(
                CompleteFormCompletion,
                props(c, (command) => {
                    calls.push(command);
                })
            )
        )
    );
    assert(f.container.querySelector('[role="status"]'));
    await f.tick(0);
    assert.deepEqual(calls.slice(), ['close']);
    assert(!f.container.querySelector('[role="status"]'));
    await f.tick(5000);
    assert.deepEqual(calls.slice(), ['close']);
});

for (const [successMessageDelay, redirectDelay, expectedMs] of [
    [-5, 0, 0],
    [-1, 2, 1000],
] as const) {
    it(`redirects once at ${expectedMs} ms with Airtable message delay ${successMessageDelay} and redirect delay ${redirectDelay}`, async (t) => {
        const f = await fixture(t);
        const message = 'Saved delivery reference A17';
        const configuration = {
            afterFormSubmission: 'redirect',
            successAction: true,
            successMessageType: 'airtableField',
            successMessageField: textField.id,
            successMessageDelay,
            redirectURLStatic: '/thanks',
            enableRedirectDelay: true,
            redirectDelay,
        } satisfies FormCompletionConfiguration;
        const projection = projectFormCompletion({
            configuration,
            language: 'en',
            fields: { [textField.id]: { airtableField: textField } },
            filteredValues: { [textField.id]: message },
            unfilteredValues: {},
            linkedTableStates: {},
        });
        const navigate = t.mock.fn((_destination: string) => {});
        await f.render(
            h(
                StrictMode,
                null,
                h(CompleteFormCompletion, {
                    configuration,
                    projection,
                    canSubmit: true,
                    onCommand(command) {
                        assert.equal(command, 'navigate');
                        assert(projection.redirectURL);
                        navigate(projection.redirectURL);
                    },
                })
            )
        );
        if (expectedMs === 1000) {
            await f.tick(999);
            assert.equal(navigate.mock.callCount(), 0);
            await f.tick(1);
        } else {
            await f.tick(0);
        }
        assert.deepEqual(
            navigate.mock.calls.map((call) => call.arguments),
            [['/thanks']]
        );
        assert(f.container.textContent.includes(message));

        await f.tick(5000 - expectedMs);
        assert.equal(navigate.mock.callCount(), 1);
    });
}

it('preview gates automatic and manual commands; later eligible start selects its current duration', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    const stay = {
        afterFormSubmission: 'stay',
        successAction: true,
        successMessageCanCreateNewRecord: true,
        allowCopySubmittedToNewForm: true,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(CompleteFormCompletion, {
            ...props(stay, (c) => {
                calls.push(c);
            }),
            canSubmit: false,
        })
    );
    for (const button of f.container.querySelectorAll('button'))
        assert(button.disabled);
    await f.tick(10000);
    assert.deepEqual(calls.slice(), []);
    const c = {
        afterFormSubmission: 'newForm',
        reloadFormDelay: 3,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            CompleteFormCompletion,
            props(c, (command) => {
                calls.push(command);
            })
        )
    );
    await f.tick(2999);
    assert.deepEqual(calls.slice(), []);
    await f.tick(1);
    assert.deepEqual(calls.slice(), ['automatic_new_form']);
});
it('manual new and copy remain explicit actions without creating an automatic countdown', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    const c = {
        afterFormSubmission: 'stay',
        successAction: true,
        successMessageCanCreateNewRecord: true,
        allowCopySubmittedToNewForm: true,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            'form',
            { onSubmit: () => assert.fail('Manual action submitted the Form') },
            h(
                CompleteFormCompletion,
                props(c, (command) => {
                    calls.push(command);
                })
            )
        )
    );
    const buttons = f.container.querySelectorAll('button');
    assert.deepEqual(calls, []);
    await act(async () => buttons[0]!.click());
    assert.deepEqual(calls, ['submit_another_form']);
    await act(async () => buttons[1]!.click());
    await f.tick(100000);
    assert.deepEqual(calls.slice(), ['submit_another_form', 'copy_form']);
});
it('unmount cancels future effects and a fresh mount has a fresh lifecycle for the same completion values', async (t) => {
    const f = await fixture(t);
    let calls = 0;
    const c = {
        afterFormSubmission: 'close',
        closeDelay: 2,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(CompleteFormCompletion, {
            ...props(c, () => {
                calls++;
            }),
            key: 'first',
        })
    );
    await f.tick(1000);
    await f.render(null);
    await f.tick(5000);
    assert.equal(calls, 0);
    await f.render(
        h(CompleteFormCompletion, {
            ...props(c, () => {
                calls++;
            }),
            key: 'second',
        })
    );
    await f.tick(2000);
    assert.equal(calls, 1);
    await f.render(null);
    await f.render(
        h(CompleteFormCompletion, {
            ...props(c, () => {
                calls++;
            }),
            key: 'third',
        })
    );
    await f.tick(2000);
    assert.equal(calls, 2);
});
it('revoked effect authority consumes the scheduled activation and cannot replay after ABA', async (t) => {
    const f = await fixture(t);
    let current = true;
    let calls = 0;
    const c = {
        afterFormSubmission: 'close',
        closeDelay: 2,
    } satisfies FormCompletionConfiguration;
    const p = {
        ...props(c, () => {
            calls++;
        }),
        isCurrent: () => current,
    };
    await f.render(h(CompleteFormCompletion, p));
    current = false;
    await f.tick(2000);
    current = true;
    await f.render(h(CompleteFormCompletion, p));
    await f.tick(5000);
    assert.equal(calls, 0);
});
it('dynamic content is escaped and linkified; static content uses the shared sanitized HTML renderer', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(CompleteFormCompletionMessage, {
            message: {
                text: '<b>literal</b> https://example.test/path',
                format: 'text',
            },
        })
    );
    assert.equal(f.container.querySelector('b'), null);
    assert(f.container.textContent.includes('<b>literal</b>'));
    assert.equal(
        f.container.querySelector('a')?.href,
        'https://example.test/path'
    );
    assert.equal(f.container.querySelector('a')?.target, '_blank');
    await f.render(
        h(CompleteFormCompletionMessage, {
            message: {
                text: '<p>Static <b>bold</b><img src=x onerror=alert(1)></p>',
                format: 'html',
            },
        })
    );
    assert.equal(f.container.querySelector('b')?.textContent, 'bold');
    assert.equal(f.container.querySelector('[onerror]'), null);
});
it('a thrown or pending adapter is attempted once, never replayed, and reports no delivery success', async (t) => {
    const f = await fixture(t);
    let calls = 0;
    const errors: unknown[] = [];
    const error = new Error('synthetic uncertain close');
    const c = {
        afterFormSubmission: 'close',
        closeDelay: 0,
    } satisfies FormCompletionConfiguration;
    const p = {
        ...props(c, () => {
            calls++;
            throw error;
        }),
        onError: (e: unknown) => errors.push(e),
    };
    await f.render(h(CompleteFormCompletion, p));
    await f.tick(0);
    await f.render(h(CompleteFormCompletion, p));
    await f.tick(5000);
    assert.equal(calls, 1);
    assert.deepEqual(errors, [error]);
    assert(f.container.textContent.includes(project(c).labels.canClose));
    let resolve!: () => void;
    await f.render(null);
    await f.render(
        h(
            CompleteFormCompletion,
            props(c, () => {
                calls++;
                return new Promise<void>((done) => {
                    resolve = done;
                });
            })
        )
    );
    await f.tick(0);
    assert.equal(calls, 2);
    await f.tick(5000);
    assert.equal(calls, 2);
    await f.unmount();
    await act(async () => resolve());
    assert.equal(calls, 2);
});
it('hook start is idempotent, running reset replaces its deadline and callback replacement stays current', async (t) => {
    const f = await fixture(t);
    let countdown!: ReturnType<typeof useFormCompletionCountdown>;
    const calls: string[] = [];
    function Harness({ name }: { name: string }) {
        countdown = useFormCompletionCountdown({
            start: 3,
            onComplete: () => {
                calls.push(name);
            },
        });
        return h('output', null, String(countdown.count));
    }
    await f.render(h(Harness, { name: 'old' }));
    await act(async () => {
        countdown.start();
        countdown.start(90);
    });
    await f.tick(1000);
    assert.equal(f.container.textContent, '2');
    await act(async () => countdown.reset(5));
    await f.render(h(Harness, { name: 'current' }));
    await f.tick(4999);
    assert.deepEqual(calls.slice(), []);
    await f.tick(1);
    assert.deepEqual(calls.slice(), ['current']);
});

it('contains throwing authority reads and diagnostics without effects or replay', async (t) => {
    const f = await fixture(t);
    const error = new Error('synthetic authority failure');
    let commands = 0,
        reports = 0;
    const configuration = {
        afterFormSubmission: 'close',
        closeDelay: 0,
    } satisfies FormCompletionConfiguration;
    const p = {
        ...props(configuration, () => {
            commands++;
        }),
        isCurrent: () => {
            throw error;
        },
        onError: (value: unknown) => {
            assert.equal(value, error);
            reports++;
            throw new Error('synthetic reporting failure');
        },
    };
    await f.render(h(CompleteFormCompletion, p));
    await f.tick(5000);
    assert.equal(commands, 0);
    assert.equal(reports, 1);
    await f.render(null);
    await f.render(
        h(CompleteFormCompletion, {
            ...props(configuration, () => {
                commands++;
                return { status: 'failed', attempted: 1, error };
            }),
            onError: p.onError,
        })
    );
    await f.tick(5000);
    assert.equal(commands, 1);
    assert.equal(reports, 2);
});

it('remounts the independently delayed body across native presentation groups while retaining the action deadline', async (t) => {
    const f = await fixture(t);
    const calls: string[] = [];
    const redirect = {
        afterFormSubmission: 'redirect',
        successAction: true,
        successMessageDelay: 2,
        redirectURLStatic: '/next',
        enableRedirectDelay: true,
        redirectDelay: 4,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            CompleteFormCompletion,
            props(redirect, (command) => {
                calls.push(command);
            })
        )
    );
    await f.tick(2000);
    assert(!f.container.querySelector('[role="status"]'));
    const close = {
        ...redirect,
        afterFormSubmission: 'close',
        closeDelay: 99,
    } satisfies FormCompletionConfiguration;
    await f.render(
        h(
            CompleteFormCompletion,
            props(close, (command) => {
                calls.push(command);
            })
        )
    );
    assert(f.container.querySelector('[role="status"]'));
    await f.tick(1999);
    assert(f.container.querySelector('[role="status"]'));
    await f.tick(1);
    assert(!f.container.querySelector('[role="status"]'));
    await f.tick(1999);
    assert.deepEqual(calls.slice(), []);
    await f.tick(1);
    assert.deepEqual(calls.slice(), ['close']);
});
