import {
    captureReadonlyPrintDocument,
    type ReadonlyPrintCapture,
    type ReadonlyPrintDocument,
} from './readonlyPrintDocument.js';

export type PrintableFormScope = {
    readonly owner: unknown;
    readonly revision: unknown;
};
export type PrintableFormAuthority = {
    readonly scope: PrintableFormScope;
    readonly explicitAllowed: boolean;
    readonly keyboardAllowed: boolean;
    readonly keyboardLease: unknown;
};
export type PrintableFormSource = {
    readAuthority(): PrintableFormAuthority | null;
    isCurrent(expected: PrintableFormScope): boolean;
    capture(expected: PrintableFormScope): ReadonlyPrintCapture;
};
export type PrintableFormAdmission = {
    tryAcquire(): object | null;
    owns(ticket: object): boolean;
    release(ticket: object): boolean;
    keyboardOwner(): unknown;
    setKeyboardOwner(expected: unknown, next: unknown): boolean;
};

/** One instance belongs to one actual document and is shared by every print route. */
export function createPrintableFormAdmission(): PrintableFormAdmission {
    let active: object | null = null;
    let keyboard: unknown = null;
    return {
        tryAcquire() {
            if (active) return null;
            return (active = Object.freeze({}));
        },
        owns: (ticket) => active === ticket,
        release(ticket) {
            if (active !== ticket) return false;
            active = null;
            return true;
        },
        keyboardOwner: () => keyboard,
        setKeyboardOwner(expected, next) {
            if (!Object.is(keyboard, expected)) return false;
            keyboard = next;
            return true;
        },
    };
}

const documentAdmissions = new WeakMap<object, PrintableFormAdmission>();
/** All SDK and native fallback routes in one actual document use this owner. */
export function getDocumentPrintableFormAdmission(
    document: Document
): PrintableFormAdmission {
    let admission = documentAdmissions.get(document);
    if (!admission) {
        admission = createPrintableFormAdmission();
        documentAdmissions.set(document, admission);
    }
    return admission;
}
export type PrintableFormPhase =
    | 'capturing'
    | 'preparing'
    | 'invoking'
    | 'invoked'
    | 'unknown'
    | 'cancelled-before-invoke'
    | 'failed-before-invoke';
export type PrintableFormJobSnapshot = {
    readonly phase: PrintableFormPhase;
    readonly cleaned: boolean;
    /** A lifecycle notification, never evidence of printing or dialog closure. */
    readonly afterPrintObserved: boolean;
};
export type PrintableFormJob = {
    readonly id: object;
    getSnapshot(): PrintableFormJobSnapshot;
    subscribe(changed: () => void): () => void;
    cancelBeforeInvocation(): boolean;
    /** Explicit caller acknowledgement; this neither prints nor retries. */
    finish(basis: 'explicit-dialog-closed'): Promise<boolean>;
};
export type PrintableFormInvocation = {
    readonly status: 'invoked' | 'refused' | 'unknown';
};
export type PrintableFormPreparedDocument = {
    /** The actual browser call must occur inside the supplied admission fence. */
    invoke(
        atBoundary: (browserPrint: () => void) => PrintableFormInvocation
    ): void | Promise<void>;
    /** Idempotent cleanup of this job's exact resources only. */
    dispose(): void | Promise<void>;
};
export type PrintableFormEngine = {
    prepare(
        document: ReadonlyPrintDocument,
        context: {
            isCurrent(): boolean;
            afterPrint(): void;
            job: PrintableFormJob;
        }
    ): Promise<PrintableFormPreparedDocument>;
};
export type PrintableFormRequest =
    | { readonly status: 'admitted'; readonly job: PrintableFormJob }
    | { readonly status: 'busy' }
    | {
          readonly status: 'refused';
          readonly reason:
              | 'retired'
              | 'not-allowed'
              | 'capture-failed'
              | 'invalid-document'
              | 'unsupported-facet';
          readonly fieldKey?: string;
      };
export type PrintableFormControllerSnapshot = {
    readonly job: PrintableFormJob | null;
    readonly outcome: PrintableFormPhase | null;
};
export type PrintableFormController = {
    request(origin?: 'explicit' | 'keyboard'): PrintableFormRequest;
    getSnapshot(): PrintableFormControllerSnapshot;
    subscribe(changed: () => void): () => void;
    retire(): void;
};
type PrintCapture<T> =
    | { readonly status: 'accepted'; readonly document: T }
    | Extract<ReadonlyPrintCapture, { status: 'refused' }>;
type PrintSource<T> = Omit<PrintableFormSource, 'capture'> & {
    capture(expected: PrintableFormScope): PrintCapture<T>;
};
type PrintEngine<T> = {
    prepare(
        document: T,
        context: Parameters<PrintableFormEngine['prepare']>[1]
    ): Promise<PrintableFormPreparedDocument>;
};

/** Whole legacy readonly fallback only; never a field slot in the SDK document. */
export type ReadonlyDOMPrintRoot = {
    readonly element: HTMLElement;
    /** Retain the exact borrowed root until this idempotent release. */
    release(): void | Promise<void>;
};
export type ReadonlyDOMPrintSource = PrintSource<ReadonlyDOMPrintRoot>;
export type ReadonlyDOMPrintEngine = PrintEngine<ReadonlyDOMPrintRoot>;
type Job = {
    grant: object;
    authority: PrintableFormAuthority;
    origin: 'explicit' | 'keyboard';
    ticket: PrintableFormJob;
    phase: PrintableFormPhase;
    snapshot: PrintableFormJobSnapshot;
    listeners: Set<() => void>;
    prepared: PrintableFormPreparedDocument | null;
    releaseCapture: (() => void | Promise<void>) | null;
    preparePending: boolean;
    invokePending: boolean;
    didInvoke: boolean;
    afterPrint: boolean;
    cleaned: boolean;
    cleanup: Promise<boolean> | null;
};

/** Retained print lifetime only; no canonical Form values, queue or Save authority. */
function createPrintController<T>({
    source,
    admission,
    engine,
    validate,
    releaseCapture,
}: {
    source: PrintSource<T>;
    admission: PrintableFormAdmission;
    engine: PrintEngine<T>;
    validate(input: T): PrintCapture<T>;
    releaseCapture?: (input: T) => void | Promise<void>;
}): PrintableFormController {
    let retired = false;
    let active: Job | null = null;
    let snapshot: PrintableFormControllerSnapshot = Object.freeze({
        job: null,
        outcome: null,
    });
    const listeners = new Set<() => void>();
    const current = (job: Job) => {
        try {
            if (
                retired ||
                active !== job ||
                job.cleaned ||
                !admission.owns(job.grant)
            )
                return false;
            if (source.isCurrent(job.authority.scope) !== true) return false;
            const now = source.readAuthority();
            return (
                now !== null &&
                Object.is(now.scope.owner, job.authority.scope.owner) &&
                Object.is(now.scope.revision, job.authority.scope.revision) &&
                (job.origin === 'explicit'
                    ? now.explicitAllowed === true
                    : now.keyboardAllowed === true &&
                      now.keyboardLease != null &&
                      Object.is(
                          now.keyboardLease,
                          job.authority.keyboardLease
                      ) &&
                      Object.is(
                          admission.keyboardOwner(),
                          now.keyboardLease
                      )) &&
                source.isCurrent(job.authority.scope) === true &&
                // Host predicates may synchronously publish or retire this job.
                !retired &&
                active === job &&
                !job.cleaned
            );
        } catch {
            return false;
        }
    };
    const publish = (job: Job) => {
        job.snapshot = Object.freeze({
            phase: job.phase,
            cleaned: job.cleaned,
            afterPrintObserved: job.afterPrint,
        });
        if (active === job)
            snapshot = Object.freeze({ job: job.ticket, outcome: null });
        let accepted = true;
        for (const changed of [...job.listeners, ...listeners]) {
            try {
                changed();
            } catch {
                accepted = false;
            }
        }
        return accepted;
    };
    const release = (job: Job) => {
        if (job.cleaned) return true;
        try {
            if (!admission.release(job.grant)) return false;
        } catch {
            return false;
        }
        job.cleaned = true;
        job.prepared = null;
        job.releaseCapture = null;
        if (active === job) {
            active = null;
            snapshot = Object.freeze({ job: null, outcome: job.phase });
        }
        publish(job);
        return true;
    };
    const clean = (job: Job): Promise<boolean> => {
        if (job.cleaned) return Promise.resolve(true);
        if (job.preparePending || job.invokePending)
            return Promise.resolve(false);
        if (job.cleanup) return job.cleanup;
        const operation = Promise.resolve().then(async () => {
            try {
                await job.releaseCapture?.();
                await job.prepared?.dispose();
            } catch {
                job.phase = 'unknown';
                publish(job);
                return false;
            }
            return release(job);
        });
        job.cleanup = operation;
        void operation.then((done) => {
            if (!done && job.cleanup === operation) job.cleanup = null;
        });
        return operation;
    };
    const cancel = (job: Job) => {
        if (
            job.didInvoke ||
            job.cleaned ||
            active !== job ||
            job.phase === 'cancelled-before-invoke'
        )
            return false;
        job.phase = 'cancelled-before-invoke';
        publish(job);
        void clean(job);
        return true;
    };
    const fail = (job: Job) => {
        if (job.cleaned || job.phase === 'cancelled-before-invoke') return;
        job.phase = job.didInvoke ? 'unknown' : 'failed-before-invoke';
        publish(job);
        if (!job.didInvoke) void clean(job);
    };
    const boundary = (
        job: Job,
        browserPrint: () => void
    ): PrintableFormInvocation => {
        if (
            job.didInvoke ||
            job.phase !== 'preparing' ||
            !current(job) ||
            job.phase !== 'preparing'
        ) {
            cancel(job);
            return { status: 'refused' };
        }
        job.phase = 'invoking';
        if (
            !publish(job) ||
            job.phase !== 'invoking' ||
            !current(job) ||
            retired ||
            active !== job ||
            job.cleaned ||
            job.phase !== 'invoking'
        ) {
            cancel(job);
            return { status: 'refused' };
        }
        // Set this before entering a possibly blocking or throwing browser call.
        job.didInvoke = true;
        try {
            browserPrint();
            job.phase = 'invoked';
        } catch {
            job.phase = 'unknown';
        }
        publish(job);
        if (!current(job) && job.phase !== 'unknown') {
            job.phase = 'unknown';
            publish(job);
        }
        return { status: job.phase === 'invoked' ? 'invoked' : 'unknown' };
    };
    const run = async (job: Job, document: T) => {
        try {
            if (!current(job)) {
                job.preparePending = false;
                cancel(job);
                return;
            }
            job.prepared = await engine.prepare(document, {
                isCurrent: () =>
                    current(job) && !job.didInvoke && job.phase === 'preparing',
                afterPrint: () => {
                    if (!job.cleaned && active === job) {
                        job.afterPrint = true;
                        publish(job);
                    }
                },
                job: job.ticket,
            });
            job.preparePending = false;
            if (job.phase !== 'preparing' || !current(job)) {
                cancel(job);
                await clean(job);
                return;
            }
            job.invokePending = true;
            try {
                await job.prepared.invoke((print) => boundary(job, print));
            } finally {
                job.invokePending = false;
            }
            if (!job.didInvoke && job.phase === 'preparing') fail(job);
        } catch {
            job.preparePending = false;
            job.invokePending = false;
            fail(job);
        } finally {
            if (
                !job.didInvoke &&
                (job.phase === 'cancelled-before-invoke' ||
                    job.phase === 'failed-before-invoke')
            )
                await clean(job);
        }
    };
    const controller: PrintableFormController = {
        request(origin = 'explicit') {
            if (retired) return { status: 'refused', reason: 'retired' };
            if (active) return { status: 'busy' };
            let authority: PrintableFormAuthority | null;
            try {
                authority = source.readAuthority();
                if (
                    !authority ||
                    (origin === 'explicit'
                        ? authority.explicitAllowed !== true
                        : authority.keyboardAllowed !== true ||
                          authority.keyboardLease == null ||
                          !Object.is(
                              admission.keyboardOwner(),
                              authority.keyboardLease
                          ))
                )
                    return { status: 'refused', reason: 'not-allowed' };
                authority = Object.freeze({
                    scope: Object.freeze({
                        owner: authority.scope.owner,
                        revision: authority.scope.revision,
                    }),
                    explicitAllowed: authority.explicitAllowed === true,
                    keyboardAllowed: authority.keyboardAllowed === true,
                    keyboardLease: authority.keyboardLease,
                });
            } catch {
                return { status: 'refused', reason: 'not-allowed' };
            }
            let grant: object | null;
            try {
                grant = admission.tryAcquire();
            } catch {
                return { status: 'refused', reason: 'not-allowed' };
            }
            if (!grant) return { status: 'busy' };
            let job: Job;
            const ticket: PrintableFormJob = {
                id: Object.freeze({}),
                getSnapshot: () => job.snapshot,
                subscribe(changed) {
                    job.listeners.add(changed);
                    return () => {
                        job.listeners.delete(changed);
                    };
                },
                cancelBeforeInvocation: () => cancel(job),
                async finish(basis) {
                    if (
                        basis !== 'explicit-dialog-closed' ||
                        active !== job ||
                        (job.phase !== 'invoked' && job.phase !== 'unknown') ||
                        job.preparePending ||
                        job.invokePending
                    )
                        return false;
                    return clean(job);
                },
            };
            job = {
                grant,
                authority,
                origin,
                ticket,
                phase: 'capturing',
                snapshot: Object.freeze({
                    phase: 'capturing',
                    cleaned: false,
                    afterPrintObserved: false,
                }),
                listeners: new Set(),
                prepared: null,
                releaseCapture: null,
                preparePending: true,
                invokePending: false,
                didInvoke: false,
                afterPrint: false,
                cleaned: false,
                cleanup: null,
            };
            active = job;
            const refuse = (
                reason:
                    | 'retired'
                    | 'capture-failed'
                    | 'invalid-document'
                    | 'unsupported-facet',
                fieldKey?: string
            ): PrintableFormRequest => {
                job.phase =
                    reason === 'retired'
                        ? 'cancelled-before-invoke'
                        : 'failed-before-invoke';
                job.preparePending = false;
                if (job.releaseCapture) void clean(job);
                else release(job);
                return {
                    status: 'refused',
                    reason,
                    ...(fieldKey === undefined ? {} : { fieldKey }),
                };
            };
            if (!publish(job) || !current(job) || job.phase !== 'capturing')
                return refuse('retired');
            let captured: PrintCapture<T>;
            try {
                captured = source.capture(authority.scope);
            } catch {
                return refuse('capture-failed');
            }
            if (captured.status !== 'accepted')
                return refuse(captured.reason, captured.fieldKey);
            const input = captured.document;
            if (releaseCapture)
                job.releaseCapture = () => releaseCapture(input);
            try {
                captured = validate(input);
            } catch {
                return refuse('invalid-document');
            }
            if (captured.status !== 'accepted')
                return refuse(captured.reason, captured.fieldKey);
            if (!current(job) || job.phase !== 'capturing')
                return refuse('retired');
            job.phase = 'preparing';
            if (!publish(job) || !current(job) || job.phase !== 'preparing')
                return refuse('retired');
            job.preparePending = true;
            void run(job, captured.document);
            return { status: 'admitted', job: ticket };
        },
        getSnapshot: () => snapshot,
        subscribe(changed) {
            listeners.add(changed);
            return () => {
                listeners.delete(changed);
            };
        },
        retire() {
            if (retired) return;
            retired = true;
            if (!active) return;
            if (!active.didInvoke) cancel(active);
            else {
                active.phase = 'unknown';
                publish(active);
            }
        },
    };
    return controller;
}

/** The complete SDK renderer consumes only detached whitelisted display data. */
export function createPrintableFormController(options: {
    source: PrintableFormSource;
    admission: PrintableFormAdmission;
    engine: PrintableFormEngine;
}): PrintableFormController {
    return createPrintController({
        ...options,
        validate: captureReadonlyPrintDocument,
    });
}

/** A separately admitted whole-native fallback shares the same job protections. */
export function createReadonlyDOMPrintController(options: {
    source: ReadonlyDOMPrintSource;
    admission: PrintableFormAdmission;
    engine: ReadonlyDOMPrintEngine;
}): PrintableFormController {
    return createPrintController({
        ...options,
        validate(input) {
            return input?.element?.nodeType === 1 &&
                typeof input.release === 'function'
                ? {
                      status: 'accepted',
                      document: Object.freeze({
                          element: input.element,
                          release: input.release,
                      }),
                  }
                : { status: 'refused', reason: 'invalid-document' };
        },
        releaseCapture: (input) => {
            if (typeof input?.release === 'function') return input.release();
        },
    });
}
