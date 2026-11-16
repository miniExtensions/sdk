import {
    Component,
    createElement as h,
    useLayoutEffect,
    type ReactNode,
} from 'react';
import type { PrintableFormEngine } from '../ui/printableForm.js';
import { preparePrintableDOM } from '../ui/printableDOM.js';
import {
    prepareReadonlyPrintDocument,
    ReadonlyPrintDocumentView,
} from './ReadonlyPrintDocumentView.js';
import {
    PrintableFormJobControls,
    type PrintableFormJobLabels,
} from './PrintableFormJobControls.js';

class PrintBoundary extends Component<
    { failed(): void; children: ReactNode },
    { failed: boolean }
> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch() {
        this.props.failed();
    }
    render() {
        return this.state.failed ? null : this.props.children;
    }
}
function Committed({ ready }: { ready(): void }) {
    useLayoutEffect(ready, [ready]);
    return null;
}

/** Lazily creates its own retained SDK renderer. Public import and SSR are inert. */
export function createBrowserPrintableFormEngine(
    ownerDocument: Document,
    labels: PrintableFormJobLabels
): PrintableFormEngine {
    return {
        async prepare(document, context) {
            const accepted = prepareReadonlyPrintDocument(document);
            if (accepted.status !== 'accepted' || !context.isCurrent())
                throw new Error('Print document refused');
            const { createRoot } = await import('react-dom/client');
            if (!context.isCurrent()) throw new Error('Print owner retired');
            const container = ownerDocument.createElement('div');
            container.dataset.mxSdkPrintJob = '';
            ownerDocument.body.appendChild(container);
            let root;
            try {
                root = createRoot(container);
            } catch {
                container.remove();
                throw new Error('Print root unavailable');
            }
            const abort = new AbortController();
            const unsubscribe = context.job.subscribe(() => {
                if (
                    context.job.getSnapshot().phase ===
                    'cancelled-before-invoke'
                )
                    abort.abort();
            });
            let disposed = false;
            const dispose = () => {
                if (disposed) return;
                unsubscribe();
                abort.abort();
                root.unmount();
                container.remove();
                disposed = true;
            };
            try {
                let source: HTMLDivElement | null = null;
                await new Promise<void>((resolve, reject) => {
                    const fail = () => {
                        abort.abort();
                        reject(new Error('Print render failed'));
                    };
                    abort.signal.addEventListener('abort', fail, {
                        once: true,
                    });
                    root.render(
                        h(PrintBoundary, {
                            failed: fail,
                            children: h(
                                'div',
                                null,
                                h(
                                    'div',
                                    {
                                        ref: (
                                            element: HTMLDivElement | null
                                        ) => {
                                            source = element;
                                            element?.setAttribute('inert', '');
                                        },
                                        lang: document.language,
                                        'data-mx-sdk-print-source': '',
                                        'aria-hidden': true,
                                        style: {
                                            position: 'fixed',
                                            left: '-100000px',
                                            top: 0,
                                            width: '816px',
                                            opacity: 0,
                                            pointerEvents: 'none',
                                        },
                                    },
                                    h(ReadonlyPrintDocumentView, {
                                        document: accepted.document,
                                    })
                                ),
                                h(Committed, {
                                    ready: () => {
                                        abort.signal.removeEventListener(
                                            'abort',
                                            fail
                                        );
                                        resolve();
                                    },
                                }),
                                h(PrintableFormJobControls, {
                                    job: context.job,
                                    labels,
                                })
                            ),
                        })
                    );
                });
                if (!source || !context.isCurrent())
                    throw new Error('Print owner retired');
                const prepared = await preparePrintableDOM(source, {
                    isCurrent: context.isCurrent,
                    afterPrint: context.afterPrint,
                    signal: abort.signal,
                    title: document.title,
                });
                return {
                    invoke: (boundary) => prepared.invoke(boundary),
                    async dispose() {
                        await prepared.dispose();
                        dispose();
                    },
                };
            } catch {
                dispose();
                throw new Error('Print preparation failed');
            }
        },
    };
}
