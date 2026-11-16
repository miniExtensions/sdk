import {
    createElement as h,
    forwardRef,
    useEffect,
    useLayoutEffect,
    useRef,
    useImperativeHandle,
    useState,
    useSyncExternalStore,
    type ForwardRefExoticComponent,
    type RefAttributes,
} from 'react';
import {
    createPrintableFormController,
    getDocumentPrintableFormAdmission,
    type PrintableFormAdmission,
    type PrintableFormController,
    type PrintableFormControllerSnapshot,
    type PrintableFormEngine,
    type PrintableFormRequest,
    type PrintableFormSource,
} from '../ui/printableForm.js';
import { createBrowserPrintableFormEngine } from './printableFormEngine.js';

export type PrintableFormHandle = {
    request(origin?: 'explicit' | 'keyboard'): PrintableFormRequest;
};
export type PrintableFormProps = {
    source: PrintableFormSource;
    ownerDocument?: Document;
    admission?: PrintableFormAdmission;
    /** Optional external print engine port; the default owns actual SDK DOM. */
    engine?: PrintableFormEngine;
    showButton?: boolean;
    labels: {
        print: string;
        preparing: string;
        cancel: string;
        done: string;
        invoked: string;
        unknown: string;
        failed: string;
    };
};
const idle: PrintableFormControllerSnapshot = Object.freeze({
    job: null,
    outcome: null,
});
const noopSubscribe = () => () => {};

/** Complete bounded print controls; the host explicitly chooses its keyboard lease. */
export const PrintableForm: ForwardRefExoticComponent<
    PrintableFormProps & RefAttributes<PrintableFormHandle>
> = forwardRef<PrintableFormHandle, PrintableFormProps>(
    function PrintableForm(props, ref) {
        const [controller, setController] =
            useState<PrintableFormController | null>(null);
        const committed = useRef<object | null>(null);
        const currentController = useRef<PrintableFormController | null>(null);
        const useCommitEffect =
            typeof globalThis.document === 'undefined'
                ? useEffect
                : useLayoutEffect;
        useCommitEffect(() => {
            const stamp = {};
            committed.current = stamp;
            return () => {
                if (committed.current === stamp) committed.current = null;
                currentController.current?.retire();
            };
        }, [props.ownerDocument, props.admission, props.engine, props.source]);
        useEffect(() => {
            const stamp = committed.current;
            if (!stamp) return;
            const document = props.ownerDocument ?? globalThis.document;
            if (!document) return;
            const admission =
                props.admission ?? getDocumentPrintableFormAdmission(document);
            const owned = createPrintableFormController({
                source: {
                    readAuthority: () =>
                        committed.current === stamp
                            ? props.source.readAuthority()
                            : null,
                    isCurrent: (scope) =>
                        committed.current === stamp &&
                        props.source.isCurrent(scope) &&
                        committed.current === stamp,
                    capture: (scope) => props.source.capture(scope),
                },
                admission,
                engine:
                    props.engine ??
                    createBrowserPrintableFormEngine(document, props.labels),
            });
            setController(owned);
            currentController.current = owned;
            const keyboard = (event: KeyboardEvent) => {
                if (event.key !== 'p' || !event.ctrlKey) return;
                try {
                    const authority = props.source.readAuthority();
                    if (
                        !authority?.keyboardAllowed ||
                        authority.keyboardLease == null ||
                        !Object.is(
                            authority.keyboardLease,
                            admission.keyboardOwner()
                        ) ||
                        !props.source.isCurrent(authority.scope)
                    )
                        return;
                    const receipt = owned.request('keyboard');
                    if (
                        receipt.status === 'admitted' ||
                        receipt.status === 'busy'
                    )
                        event.preventDefault();
                } catch {
                    /* Refusal cannot confer keyboard authority. */
                }
            };
            document.addEventListener('keydown', keyboard);
            return () => {
                document.removeEventListener('keydown', keyboard);
                // Preparation is cancelled; an invoked/unknown job stays quarantined.
                owned.retire();
                if (currentController.current === owned)
                    currentController.current = null;
            };
        }, [props.ownerDocument, props.admission, props.engine, props.source]);
        useImperativeHandle(
            ref,
            () => ({
                request: (origin) =>
                    controller?.request(origin) ?? {
                        status: 'refused',
                        reason: 'retired',
                    },
            }),
            [controller]
        );
        const state = useSyncExternalStore(
            controller?.subscribe ?? noopSubscribe,
            controller?.getSnapshot ?? (() => idle),
            () => idle
        );
        const job = state.job;
        const status = useSyncExternalStore(
            job?.subscribe ?? noopSubscribe,
            job?.getSnapshot ?? (() => null),
            () => null
        );
        const phase = status?.phase;
        const preparing =
            phase === 'capturing' ||
            phase === 'preparing' ||
            phase === 'invoking';
        return h(
            'div',
            { className: 'mx-sdk-print-controls' },
            props.showButton !== false
                ? h(
                      'button',
                      {
                          type: 'button',
                          disabled: !controller || !!job,
                          onClick: () => controller?.request(),
                      },
                      props.labels.print
                  )
                : null,
            job && status && preparing
                ? h(
                      'div',
                      { role: 'status' },
                      h(
                          'span',
                          null,
                          preparing
                              ? props.labels.preparing
                              : phase === 'invoked'
                                ? props.labels.invoked
                                : phase === 'unknown'
                                  ? props.labels.unknown
                                  : props.labels.failed
                      ),
                      phase === 'capturing' || phase === 'preparing'
                          ? h(
                                'button',
                                {
                                    type: 'button',
                                    onClick: () => job.cancelBeforeInvocation(),
                                },
                                props.labels.cancel
                            )
                          : null
                  )
                : state.outcome === 'failed-before-invoke'
                  ? h('span', { role: 'status' }, props.labels.failed)
                  : null
        );
    }
);
