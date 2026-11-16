import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import {
    PrintableForm,
    type PrintableFormHandle,
} from '../src/react/PrintableForm.js';
import {
    createPrintableFormAdmission,
    type PrintableFormSource,
    type PrintableFormRequest,
} from '../src/ui/printableForm.js';

const labels = {
    print: 'Print document',
    preparing: 'Preparing document',
    cancel: 'Cancel preparation',
    invoked: 'Print method called',
    unknown: 'Print status unknown',
    failed: 'Preparation failed',
    done: 'I have closed the print dialog',
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function source() {
    const owner = {};
    const revision = {};
    const lease = {};
    let captures = 0;
    const port: PrintableFormSource = {
        readAuthority: () => ({
            scope: { owner, revision },
            explicitAllowed: true,
            keyboardAllowed: true,
            keyboardLease: lease,
        }),
        isCurrent: (scope) =>
            scope.owner === owner && scope.revision === revision,
        capture: () => {
            captures++;
            return {
                status: 'accepted',
                document: {
                    language: 'en',
                    fields: [
                        {
                            key: 'name',
                            fieldName: 'Name',
                            title: 'Name',
                            semanticTitle: 'Name',
                            showTitle: true,
                            required: false,
                            sameRow: false,
                            enableSideBySideOnMobile: false,
                            facet: {
                                kind: 'text',
                                value: 'Captured value',
                                emptyLabel: 'None',
                            },
                        },
                    ],
                },
            };
        },
    };
    return {
        port,
        lease,
        get captures() {
            return captures;
        },
    };
}

async function browser(t: TestContext) {
    const window = new Window({ url: 'http://127.0.0.1:4200/print-test' });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'Element',
        'Node',
        'MutationObserver',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    let prints = 0;
    // External browser printing only: the real SDK renderer and preparation run.
    const prototype = window.HTMLIFrameElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        'contentWindow'
    )!;
    Object.defineProperty(prototype, 'contentWindow', {
        ...descriptor,
        get() {
            const target = descriptor.get!.call(this) as Window | null;
            if (target)
                Object.defineProperty(target, 'print', {
                    configurable: true,
                    value() {
                        prints++;
                    },
                });
            return target;
        },
    });
    t.after(async () => {
        await act(async () => root.unmount());
        Object.defineProperty(prototype, 'contentWindow', descriptor);
        keys.forEach((key, index) =>
            originals[index]
                ? Object.defineProperty(globalThis, key, originals[index]!)
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        root,
        get prints() {
            return prints;
        },
    };
}

test('complete print controls SSR creates no browser resources or private snapshot', () => {
    const f = source();
    const html = renderToString(h(PrintableForm, { source: f.port, labels }));
    assert.match(html, /Print document/);
    assert.match(html, /disabled/);
    assert.equal(f.captures, 0);
});

test('StrictMode uses the actual renderer/owned engine and retained acknowledgement survives parent unmount', async (t) => {
    const b = await browser(t);
    const f = source();
    const admission = createPrintableFormAdmission();
    admission.setKeyboardOwner(null, f.lease);
    const ref = createRef<PrintableFormHandle>();
    await act(async () =>
        b.root.render(
            h(
                StrictMode,
                null,
                h(PrintableForm, { ref, source: f.port, admission, labels })
            )
        )
    );
    let request: PrintableFormRequest | undefined;
    await act(async () => {
        request = ref.current!.request();
        await turn();
    });
    assert.equal(request?.status, 'admitted');
    if (request?.status !== 'admitted') throw Error('Expected job');
    const job = request.job;
    assert.equal(job.getSnapshot().phase, 'invoked');
    assert.equal(b.prints, 1);
    assert.equal(f.captures, 1);
    const frame = b.window.document.querySelector(
        'iframe[data-mx-sdk-print-frame]'
    ) as unknown as HTMLIFrameElement;
    assert.match(frame.contentDocument!.body.textContent, /Captured value/);
    const staging = b.window.document.querySelector(
        '[data-mx-sdk-print-source]'
    )!;
    assert.equal(staging.hasAttribute('inert'), true);
    assert.equal(staging.getAttribute('aria-hidden'), 'true');
    assert.equal(
        frame
            .contentDocument!.querySelector('[data-mx-sdk-print-source]')!
            .hasAttribute('inert'),
        false
    );
    await act(async () => b.root.render(null));
    assert.equal(job.getSnapshot().phase, 'unknown');
    assert.equal(frame.isConnected, true);
    const controls = b.window.document.querySelector(
        '.mx-sdk-print-job-controls'
    )!;
    assert.match(controls.textContent, /Print status unknown/);
    await act(async () => {
        controls.querySelector('button')!.click();
        await turn();
    });
    assert.equal(job.getSnapshot().cleaned, true);
    assert.equal(
        b.window.document.querySelector('[data-mx-sdk-print-job]'),
        null
    );
    assert.equal(
        b.window.document.querySelector('[data-mx-sdk-print-frame]'),
        null
    );
    assert.ok(admission.tryAcquire());
});

test('two mounted public controls route only exact lowercase Ctrl+p to the selected lease', async (t) => {
    const b = await browser(t);
    const first = source();
    const second = source();
    const admission = createPrintableFormAdmission();
    admission.setKeyboardOwner(null, second.lease);
    await act(async () =>
        b.root.render(
            h(
                StrictMode,
                null,
                h(PrintableForm, { source: first.port, admission, labels }),
                h(PrintableForm, { source: second.port, admission, labels })
            )
        )
    );
    for (const key of ['P', 'x']) {
        const event = new b.window.KeyboardEvent('keydown', {
            key,
            ctrlKey: true,
            cancelable: true,
        });
        b.window.document.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
    }
    const gesture = new b.window.KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true,
        cancelable: true,
    });
    await act(async () => {
        b.window.document.dispatchEvent(gesture);
        await turn();
    });
    assert.equal(gesture.defaultPrevented, true);
    assert.equal(first.captures, 0);
    assert.equal(second.captures, 1);
    assert.equal(b.prints, 1);
    const again = new b.window.KeyboardEvent('keydown', {
        key: 'p',
        ctrlKey: true,
        cancelable: true,
    });
    await act(async () => b.window.document.dispatchEvent(again));
    assert.equal(again.defaultPrevented, true);
    assert.equal(second.captures, 1);
    const controls = b.window.document.querySelector(
        '.mx-sdk-print-job-controls'
    )!;
    await act(async () => {
        controls.querySelector('button')!.click();
        await turn();
    });
    assert.equal(
        b.window.document.querySelectorAll('[data-mx-sdk-print-frame]').length,
        0
    );
});
