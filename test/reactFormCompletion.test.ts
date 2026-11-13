import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteFormCompletion,
    CompleteFormCompletionMessage,
    useFormCompletionCountdown,
    type CompleteFormCompletionProps,
} from '../src/react/index.js';
import {
    projectFormCompletion,
    type FormCompletionConfiguration,
} from '../src/forms/index.js';

const project = (configuration: FormCompletionConfiguration) =>
    projectFormCompletion({
        configuration,
        language: 'en',
        filteredValues: {},
        unfilteredValues: {},
        fields: {},
        linkedTableStates: {},
    });
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
            CompleteFormCompletion,
            props(c, (command) => {
                calls.push(command);
            })
        )
    );
    const buttons = f.container.querySelectorAll('button');
    await act(async () => {
        buttons[0]!.click();
        buttons[1]!.click();
    });
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
