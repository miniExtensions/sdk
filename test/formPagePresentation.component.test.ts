import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    Fragment,
    StrictMode,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteFormComposition,
    type CompleteFormCompositionProps,
} from '../src/react/CompleteFormComposition.js';
import {
    CompleteFormPageNavigation,
    FormPageNavigationButton,
    type FormPageNavigationDescriptor,
} from '../src/react/CompleteFormPageNavigation.js';
import {
    CompleteFormReview,
    type CompleteFormReviewProps,
    type FormReviewDialogFrameProps,
} from '../src/react/CompleteFormReview.js';
import { createNativeFormPages } from '../src/ui/nativeFormPages.js';

const pages: readonly FormPageNavigationDescriptor[] = [
    {
        title: null,
        description: null,
        fieldIds: ['leading'],
        hidden: false,
    },
    {
        title: 'Contact',
        description: '<p>Tell us <strong>about you</strong>.</p>',
        fieldIds: ['name'],
        hidden: false,
    },
    {
        title: 'Hidden page',
        description: null,
        fieldIds: ['hidden'],
        hidden: true,
    },
    {
        title: 'Details',
        description: null,
        fieldIds: ['detail'],
        hidden: false,
    },
];

const reviewProps = (
    patch: Partial<CompleteFormReviewProps> = {}
): CompleteFormReviewProps => ({
    open: true,
    title: 'Please review your submission',
    editLabel: 'Edit',
    confirmLabel: 'Submit form',
    emptyLabel: 'No set values',
    items: [
        {
            id: 'name',
            title: 'Name',
            semanticTitle: 'Name',
            value: 'First value',
        },
    ],
    onEdit: () => {},
    onDismiss: () => {},
    onConfirm: () => {},
    ...patch,
});

async function fixture(t: TestContext) {
    const window = new Window({
        url: 'https://form-pages.example.test/',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
            disableIframePageLoading: true,
        },
    });
    const values: Record<string, unknown> = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLDialogElement: window.HTMLDialogElement,
        Element: window.Element,
        Node: window.Node,
        NodeFilter: window.NodeFilter,
        DocumentFragment: window.DocumentFragment,
        CustomEvent: window.CustomEvent,
        MutationObserver: window.MutationObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = Object.keys(values).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    const host = window.document.createElement('div');
    const form = window.document.createElement('form');
    form.id = 'canonical-form';
    let submits = 0;
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const opener = window.document.createElement('button');
    opener.textContent = 'Open Review';
    window.document.body.append(form, opener, host);
    opener.focus();
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(host as unknown as HTMLElement);
    let mounted = true;
    const unmount = async () => {
        if (!mounted) return;
        mounted = false;
        await act(async () => root.unmount());
    };
    t.after(async () => {
        try {
            await unmount();
        } finally {
            for (const [key, descriptor] of originals) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    const render = async (node: ReactNode) => {
        await act(async () => root.render(h(StrictMode, null, node)));
    };
    const button = (label: string) => {
        const found = [...host.querySelectorAll('button')].find(
            (element) =>
                element.getAttribute('aria-label') === label ||
                element.textContent === label
        );
        assert.ok(found, `Expected button: ${label}`);
        return found;
    };
    return {
        window,
        host,
        opener,
        render,
        button,
        unmount,
        submits: () => submits,
        click: async (label: string) => {
            await act(async () => button(label).click());
        },
    };
}

it('renders complete page and Review presentation in SSR without invoking actions', () => {
    let actions = 0;
    const markup = renderToString(
        h(
            Fragment,
            null,
            h(CompleteFormPageNavigation, {
                pages,
                activePageIndex: 1,
                onSelectTitle: () => actions++,
            }),
            h(
                CompleteFormReview,
                reviewProps({
                    title: '<Review>',
                    onEdit: () => actions++,
                    onDismiss: () => actions++,
                    onConfirm: () => actions++,
                })
            )
        )
    );
    assert.match(markup, /<strong>about you<\/strong>/);
    assert.match(markup, /&lt;Review&gt;/);
    assert.match(markup, /<dl/);
    assert.match(markup, /First value/);
    assert.equal(actions, 0);
    assert.equal(
        renderToString(h(CompleteFormReview, reviewProps({ open: false }))),
        ''
    );
});

it('keeps composed fields stable and routes only the admitted detached form action', async (t) => {
    const f = await fixture(t);
    const formId = 'composed-form';
    const fieldId = 'fld:literal#id';
    const intents: string[] = [];
    const props: CompleteFormCompositionProps = {
        formId,
        onSubmit: () => intents.push('next'),
        items: [
            {
                kind: 'field',
                key: 'ungrouped',
                node: h('input', { id: fieldId, form: formId }),
            },
            {
                kind: 'group',
                key: 'contact',
                group: {
                    title: 'Contact',
                    isExpanded: false,
                    isReadOnlyPage: false,
                    allFieldsHidden: false,
                    hasError: false,
                },
                fields: [
                    {
                        kind: 'field',
                        key: 'grouped',
                        node: h('input', { id: 'grouped', form: formId }),
                    },
                ],
            },
        ],
        slots: { header: h('h1', null, 'Intake') },
        validation: {
            heading: 'Repair below',
            diagnostics: [
                {
                    fieldId,
                    fieldTitle: 'Literal target',
                    errorMessage: 'is required',
                },
            ],
        },
        primary: { kind: 'next', label: 'Next' },
        back: { label: 'Back', onClick: () => intents.push('back') },
        decoratePrimary: (control) => h('div', { id: 'inspector' }, control),
        footerLabel: 'Form actions',
    };
    await f.render(h(CompleteFormComposition, props));
    const form = f.host.querySelector('form');
    const field = f.window.document.getElementById(fieldId);
    assert.ok(form);
    assert.ok(field instanceof f.window.HTMLInputElement);
    assert.equal(form.id, formId);
    assert.equal(form.noValidate, true);
    assert.equal(form.children.length, 0);
    assert.equal(field.form, form);
    assert.equal(f.host.querySelector('h1')?.textContent, 'Intake');
    assert.equal(
        f.host.querySelector('footer')?.getAttribute('aria-label'),
        'Form actions'
    );
    assert.equal(
        f.host.querySelector('a')?.getAttribute('href'),
        '#' + fieldId
    );
    assert.equal(f.window.document.getElementById('grouped'), null);
    await f.click('Contact');
    const grouped = f.window.document.getElementById('grouped');
    assert.ok(grouped instanceof f.window.HTMLInputElement);
    assert.equal(grouped.form, form);
    assert.equal(f.button('Next').closest('#inspector')?.id, 'inspector');
    await f.click('Back');
    await f.click('Next');
    assert.deepEqual(intents, ['back', 'next']);

    const terminal = (canSubmit: boolean, saving = false) =>
        h(CompleteFormComposition, {
            ...props,
            primary: {
                kind: 'terminal',
                mode: 'save',
                label: 'Save',
                canSubmit,
                saving,
            },
            onSubmit: () => intents.push('save'),
        });
    const submit = async (cancelled = false) => {
        const event = new f.window.Event('submit', {
            bubbles: true,
            cancelable: true,
        });
        if (cancelled) event.preventDefault();
        await act(async () => {
            form.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, true);
    };
    await f.render(terminal(false));
    assert.equal(f.button('Save').disabled, true);
    await submit();
    await f.render(terminal(true, true));
    await submit();
    await f.render(terminal(true));
    await submit(true);
    assert.deepEqual(intents, ['back', 'next']);
    assert.equal(f.window.document.getElementById(fieldId), field);
    assert.equal(f.window.document.getElementById('grouped'), grouped);
    await f.click('Save');
    assert.deepEqual(intents, ['back', 'next', 'save']);
    assert.equal(f.submits(), 0);
});

it('focuses each accepted keyboard Next heading through the composed page slot', async (t) => {
    const f = await fixture(t);
    const formId = 'titled-form';
    const titledPages = [
        { ...pages[0]!, title: 'Start' },
        pages[1]!,
        pages[2]!,
        pages[3]!,
    ];
    const intents: string[] = [];
    let rejected = true;
    const navigation = createNativeFormPages({
        pages: titledPages,
        owner: 'session',
        configuration: 'form',
        multiple: true,
        reviewItems: [],
        isCurrent: () => true,
        onNext({ pageIndex, advance }) {
            intents.push(`next:${pageIndex}`);
            if (rejected) {
                f.host.querySelector('input')?.focus();
                return;
            }
            advance();
        },
    });
    function Form({ footerLabel }: { footerLabel: string }) {
        const snapshot = useSyncExternalStore(
            navigation.subscribe,
            navigation.getSnapshot
        );
        const fieldId = snapshot.pages[snapshot.activePageIndex]!.fieldIds[0]!;
        return h(CompleteFormComposition, {
            formId,
            footerLabel,
            onSubmit: () => {
                if (snapshot.isLastPage) intents.push('save');
                else snapshot.actions.next();
            },
            items: [
                {
                    kind: 'field',
                    key: fieldId,
                    node: h('input', { id: fieldId, form: formId }),
                },
            ],
            slots: {
                pageNavigation: h(
                    'div',
                    null,
                    h(CompleteFormPageNavigation, snapshot)
                ),
            },
            primary: snapshot.isLastPage
                ? {
                      kind: 'terminal',
                      mode: 'save',
                      label: 'Save',
                      canSubmit: true,
                      saving: false,
                  }
                : { kind: 'next', label: 'Next' },
        });
    }
    async function keyboardNext() {
        const next = f.button('Next');
        next.focus();
        assert.equal(f.window.document.activeElement, next);
        // Happy DOM does not synthesize a submit click from Enter.
        await act(async () => {
            next.dispatchEvent(
                new f.window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    detail: 0,
                })
            );
        });
    }
    function expectPage(title: string, fieldId: string) {
        const heading = f.host.querySelector('h2');
        assert.equal(heading?.textContent, title);
        assert.equal(f.host.querySelector('input')?.id, fieldId);
        assert.equal(f.window.document.activeElement?.tagName, 'H2');
        assert.equal(f.window.document.activeElement, heading);
        assert.equal(heading?.tabIndex, -1);
        assert.equal(heading?.getAttribute('tabindex'), '-1');
    }

    await f.render(h(Form, { footerLabel: 'Form actions' }));
    assert.equal(f.window.document.activeElement, f.opener);

    await keyboardNext();
    assert.equal(f.host.querySelector('h2')?.textContent, 'Start');
    assert.equal(f.window.document.activeElement?.id, 'leading');
    await f.render(h(Form, { footerLabel: 'Updated actions' }));
    assert.equal(f.window.document.activeElement?.id, 'leading');

    rejected = false;
    await keyboardNext();
    expectPage('Contact', 'name');

    f.host.querySelector('input')?.focus();
    await f.render(h(Form, { footerLabel: 'New actions' }));
    assert.equal(f.window.document.activeElement?.id, 'name');

    await keyboardNext();
    expectPage('Details', 'detail');
    assert.equal(f.button('Save').getAttribute('type'), 'submit');
    assert.deepEqual(intents, ['next:0', 'next:0', 'next:1']);
    assert.equal(f.submits(), 0);
});

it('uses only visible titled pages for progress and delegates preview title selection', async (t) => {
    const f = await fixture(t);
    let selections = 0;
    await f.render(
        h(CompleteFormPageNavigation, {
            pages,
            activePageIndex: 1,
            onSelectTitle: () => selections++,
            progressTestId: 'native-progress',
            progressItemTestId: 'native-progress-item',
        })
    );
    const progress = f.host.querySelector('[data-testid="native-progress"]');
    assert.equal(progress?.getAttribute('aria-hidden'), 'true');
    const items = f.host.querySelectorAll(
        '[data-testid="native-progress-item"]'
    );
    assert.equal(items.length, 2);
    assert.ok(
        items[0]?.classList.contains('mx-sdk-form-pages-progress-item--reached')
    );
    assert.ok(
        !items[1]?.classList.contains(
            'mx-sdk-form-pages-progress-item--reached'
        )
    );
    assert.equal(f.button('Contact').type, 'button');
    await f.click('Contact');
    assert.equal(selections, 1);
    assert.equal(f.submits(), 0);
    await f.render(
        h(CompleteFormPageNavigation, { pages, activePageIndex: 3 })
    );
    assert.equal(f.host.querySelector('button'), null);
    assert.equal(f.host.querySelector('h2')?.textContent, 'Details');
    assert.equal(
        f.host.querySelectorAll('.mx-sdk-form-pages-progress-item--reached')
            .length,
        2
    );
});

it('omits an untitled current page, invalid page and single-page progress', async (t) => {
    const f = await fixture(t);
    for (const activePageIndex of [0, -1, 10]) {
        await f.render(
            h(CompleteFormPageNavigation, { pages, activePageIndex })
        );
        assert.equal(f.host.textContent, '');
    }
    await f.render(
        h(CompleteFormPageNavigation, {
            pages: [pages[1]!],
            activePageIndex: 0,
        })
    );
    assert.equal(
        f.host.querySelector('[data-testid="form-page-progress"]'),
        null
    );
    assert.equal(f.host.querySelector('h2')?.textContent, 'Contact');
});

it('routes Next through the existing associated form while Back stays a command', async (t) => {
    const f = await fixture(t);
    let backs = 0;
    const controls = (loading = false) =>
        h(
            Fragment,
            null,
            h(FormPageNavigationButton, {
                direction: 'back',
                label: 'Back',
                onClick: () => backs++,
            }),
            h(FormPageNavigationButton, {
                direction: 'next',
                label: 'Next',
                form: 'canonical-form',
                loading,
            })
        );
    await f.render(controls());
    assert.equal(f.button('Back').type, 'button');
    assert.equal(f.button('Next').type, 'submit');
    assert.equal(f.button('Next').getAttribute('form'), 'canonical-form');
    await f.click('Back');
    assert.equal(backs, 1);
    assert.equal(f.submits(), 0);
    await f.click('Next');
    assert.equal(f.submits(), 1);
    await f.render(controls(true));
    assert.equal(f.button('Next').disabled, true);
    assert.equal(f.button('Next').getAttribute('aria-busy'), 'true');
    assert.ok(
        f.button('Next').querySelector('.mx-sdk-form-page-button-spinner')
    );
    await f.click('Next');
    assert.equal(f.submits(), 1);
});

it('updates live readonly leaves without dispatch and retains semantic hidden titles', async (t) => {
    const f = await fixture(t);
    let edits = 0;
    let confirms = 0;
    const props = reviewProps({
        onEdit: () => edits++,
        onConfirm: () => confirms++,
    });
    await f.render(h(CompleteFormReview, props));
    const dialog = f.host.querySelector('dialog');
    assert.ok(dialog?.open);
    assert.equal(f.window.document.activeElement, f.button('Edit'));
    const confirm = f.button('Submit form');
    confirm.focus();
    await f.render(
        h(CompleteFormReview, {
            ...props,
            items: [
                {
                    id: 'name',
                    labelId: 'native-name-review-label',
                    title: '',
                    semanticTitle: 'Name',
                    value: h('strong', null, 'Latest value'),
                },
                {
                    id: 'url',
                    title: 'Website',
                    semanticTitle: 'Website',
                    value: h('a', { href: '#admitted-destination' }, 'Site'),
                },
            ],
        })
    );
    assert.equal(f.window.document.activeElement, confirm);
    assert.equal(
        f.host.querySelector('dd strong')?.textContent,
        'Latest value'
    );
    assert.equal(
        f.host.querySelector('dd a')?.getAttribute('href'),
        '#admitted-destination'
    );
    const hiddenTitle = f.host.querySelector('dt');
    assert.equal(hiddenTitle?.textContent, 'Name');
    assert.equal(hiddenTitle?.id, 'native-name-review-label');
    assert.ok(
        hiddenTitle?.classList.contains('mx-sdk-form-review-label--hidden')
    );
    assert.ok(hiddenTitle?.classList.contains('sr-only'));
    assert.equal(
        f.host.querySelector('dd')?.getAttribute('aria-labelledby'),
        hiddenTitle?.id
    );
    assert.equal(edits, 0);
    assert.equal(confirms, 0);
    assert.equal(f.button('Edit').type, 'button');
    assert.equal(confirm.type, 'button');
    await f.click('Edit');
    await f.click('Submit form');
    assert.equal(edits, 1);
    assert.equal(confirms, 1);
    assert.equal(f.submits(), 0);
});

it('shows the supplied empty state and leaves confirmation availability controlled', async (t) => {
    const f = await fixture(t);
    let confirms = 0;
    const props = reviewProps({
        items: [],
        confirmDisabled: true,
        onConfirm: () => confirms++,
    });
    await f.render(h(CompleteFormReview, props));
    assert.equal(f.host.querySelector('dl'), null);
    assert.equal(
        f.host.querySelector('.mx-sdk-form-review-empty')?.textContent,
        'No set values'
    );
    await f.click('Submit form');
    assert.equal(confirms, 0);
    await f.render(h(CompleteFormReview, { ...props, confirmDisabled: false }));
    await f.click('Submit form');
    assert.equal(confirms, 1);
});

it('traps modal keyboard focus and returns it to the connected invoker on close', async (t) => {
    const f = await fixture(t);
    let dismissals = 0;
    const props = reviewProps({ onDismiss: () => dismissals++ });
    await f.render(h(CompleteFormReview, props));
    const edit = f.button('Edit');
    const confirm = f.button('Submit form');
    confirm.focus();
    await act(async () => {
        confirm.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Tab',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(f.window.document.activeElement, edit);
    await act(async () => {
        edit.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Tab',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(f.window.document.activeElement, confirm);
    await act(async () => {
        confirm.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(dismissals, 1);
    await f.render(h(CompleteFormReview, { ...props, open: false }));
    assert.equal(f.host.querySelector('dialog'), null);
    assert.equal(f.window.document.activeElement, f.opener);
});

it('dismisses only the top Review and preserves its invoker when a lower Review unmounts', async (t) => {
    const f = await fixture(t);
    let outerDismissals = 0;
    let innerDismissals = 0;
    const outer = reviewProps({
        title: 'Outer Review',
        onDismiss: () => outerDismissals++,
    });
    const inner = reviewProps({
        title: 'Inner Review',
        onDismiss: () => innerDismissals++,
    });
    await f.render(
        h(
            Fragment,
            null,
            h(CompleteFormReview, { ...outer, key: 'outer' }),
            h(CompleteFormReview, { ...inner, key: 'inner' })
        )
    );
    const dialogs = f.host.querySelectorAll('dialog');
    assert.equal(dialogs.length, 2);
    const labels = [...f.host.querySelectorAll('dd')].map((dd) =>
        dd.getAttribute('aria-labelledby')
    );
    assert.equal(new Set(labels).size, 2);
    await act(async () => {
        f.window.document.activeElement?.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(innerDismissals, 1);
    assert.equal(outerDismissals, 0);
    await f.render(
        h(Fragment, null, h(CompleteFormReview, { ...inner, key: 'inner' }))
    );
    await f.render(null);
    assert.equal(f.window.document.activeElement, f.opener);
});

it('outside dismissal does not invoke Edit or Confirm', async (t) => {
    const f = await fixture(t);
    let edits = 0;
    let dismissals = 0;
    let confirms = 0;
    await f.render(
        h(
            CompleteFormReview,
            reviewProps({
                onEdit: () => edits++,
                onDismiss: () => dismissals++,
                onConfirm: () => confirms++,
            })
        )
    );
    const overlay = f.host.querySelector(
        '[data-testid="dialog-overlay-test-id"]'
    );
    assert.ok(overlay);
    await act(async () => (overlay as unknown as HTMLElement).click());
    assert.equal(edits, 0);
    assert.equal(confirms, 0);
    assert.equal(dismissals, 1);
});

it('delegates only the modal frame while retaining the complete SDK Review panel', async (t) => {
    const f = await fixture(t);
    let dialogCalls = 0;
    let edits = 0;
    let dismissals = 0;
    let confirms = 0;
    const receivedTitles: string[] = [];
    const prototype = f.window.HTMLDialogElement.prototype;
    const showModal = prototype.showModal;
    const close = prototype.close;
    prototype.showModal = () => {
        dialogCalls++;
        throw new Error('A supplied frame must not open a native HTML dialog');
    };
    prototype.close = () => {
        dialogCalls++;
        throw new Error('A supplied frame must not close a native HTML dialog');
    };
    t.after(() => {
        prototype.showModal = showModal;
        prototype.close = close;
    });
    function Frame({ title, onDismiss, children }: FormReviewDialogFrameProps) {
        receivedTitles.push(title);
        return h(
            'section',
            {
                role: 'dialog',
                'aria-label': title,
                'data-testid': 'host-frame',
            },
            h('button', { type: 'button', onClick: onDismiss }, 'Frame close'),
            children
        );
    }
    const props = reviewProps({
        dialogFrame: Frame,
        onEdit: () => edits++,
        onDismiss: () => dismissals++,
        onConfirm: () => confirms++,
    });
    await f.render(h(CompleteFormReview, props));
    assert.ok(receivedTitles.length > 0);
    assert.ok(receivedTitles.every((title) => title === props.title));
    assert.equal(f.host.querySelectorAll('dialog').length, 0);
    assert.equal(dialogCalls, 0);
    assert.ok(
        f.window.document.activeElement === f.opener,
        'The frame, rather than the default dialog, must own focus'
    );
    const frame = f.host.querySelector('[data-testid="host-frame"]');
    assert.ok(frame);
    assert.equal(frame.getAttribute('aria-label'), props.title);
    assert.equal(frame.querySelectorAll('.mx-sdk-form-review-panel').length, 1);
    assert.equal(
        frame.querySelectorAll('[data-testid="dialog-test-id"]').length,
        0
    );
    assert.equal(frame.querySelector('header h2')?.textContent, props.title);
    assert.equal(frame.querySelector('dl dt')?.textContent, 'Name');
    assert.equal(frame.querySelector('dl dd')?.textContent, 'First value');
    assert.equal(f.button('Edit').type, 'button');
    assert.equal(f.button('Submit form').type, 'button');
    await f.click('Edit');
    await f.click('Submit form');
    await f.click('Frame close');
    assert.equal(edits, 1);
    assert.equal(confirms, 1);
    assert.equal(dismissals, 1);
    assert.equal(f.submits(), 0);
    await act(async () => {
        f.opener.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(dismissals, 1, 'The supplied frame owns Escape handling');
    await f.render(h(CompleteFormReview, { ...props, open: false }));
    assert.equal(f.host.childElementCount, 0);
    assert.equal(dialogCalls, 0);
});
