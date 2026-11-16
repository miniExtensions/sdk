/** Canonical proof state belongs to the host, including its compare-and-write receipt. */
export type FormCaptchaToken<T> = Readonly<{
    value: T | null;
    revision: unknown;
    owner: unknown;
    configurationRevision: number;
}>;

export type FormCaptchaScope = Readonly<{
    owner: unknown;
    configurationRevision: number;
}>;

export type FormCaptchaAdmission =
    | { status: 'admitted' }
    | { status: 'refused' };

export type FormCaptchaCallbacks<T> = Readonly<{
    change(value: T | null): void;
    expired(): void;
    error(cause?: unknown): void;
}>;

/** Each handle removes only the resources allocated by that render call. */
export type FormCaptchaWidgetHandle = {
    reset(): void;
    remove(): void;
};

export type FormCaptchaRenderer<T, Options> = {
    render(
        container: HTMLElement,
        options: Options,
        callbacks: FormCaptchaCallbacks<T>
    ): FormCaptchaWidgetHandle | Promise<FormCaptchaWidgetHandle>;
};

export type FormCaptchaProvider<T, Options> = {
    load():
        | FormCaptchaRenderer<T, Options>
        | Promise<FormCaptchaRenderer<T, Options>>;
};

export type FormCaptchaSnapshot<T, Options> = Readonly<{
    /** A committed opaque lease; replacement, including ABA, uses a new lease. */
    owner: unknown;
    /** Monotonically increases for accepted effective provider configuration changes. */
    configurationRevision: number;
    provider: FormCaptchaProvider<T, Options>;
    options: Options;
    enabled: boolean;
    editable: boolean;
    verified: boolean;
    token: FormCaptchaToken<T>;
}>;

export type FormCaptchaNotice = Readonly<{
    kind: 'expired' | 'error' | 'unavailable';
    cause?: unknown;
}>;

/**
 * read/subscribe expose committed state. Publication must atomically recheck the
 * supplied lease, revision and live gate. Invalidation additionally compares the
 * exact token revision and provenance. Neither operation changes verified state,
 * drafts or already allocated requests. Notifications are localized by the host.
 */
export type FormCaptchaHost<T, Options> = {
    read(): FormCaptchaSnapshot<T, Options>;
    subscribe(changed: () => void): () => void;
    publish(scope: FormCaptchaScope, value: T | null): FormCaptchaAdmission;
    invalidate(
        scope: FormCaptchaScope,
        expectedToken: FormCaptchaToken<T>
    ): FormCaptchaAdmission;
    notify(notice: FormCaptchaNotice): void;
};

export type FormCaptchaState = 'hidden' | 'loading' | 'ready' | 'unavailable';

/** Loader-only arbitration; it holds no form, token, owner or verification state. */
export function createFormCaptchaProviderRegistry() {
    const resources = new Map<
        unknown,
        { configuration: unknown; value: unknown }
    >();
    return {
        provider<T, Options>(request: {
            /** Same process-global provider uses the same registry and scope. */
            scope: unknown;
            /** Stable identity for all effective script/global options. */
            configuration: unknown;
            load():
                | FormCaptchaRenderer<T, Options>
                | Promise<FormCaptchaRenderer<T, Options>>;
        }): FormCaptchaProvider<T, Options> {
            return {
                load() {
                    const existing = resources.get(request.scope);
                    if (existing) {
                        if (
                            !Object.is(
                                existing.configuration,
                                request.configuration
                            )
                        )
                            throw new Error(
                                'Conflicting CAPTCHA provider configuration'
                            );
                        return existing.value as Promise<
                            FormCaptchaRenderer<T, Options>
                        >;
                    }
                    // Reserve before calling external code, including reentrant loaders.
                    let resolve!: (
                        value:
                            | FormCaptchaRenderer<T, Options>
                            | PromiseLike<FormCaptchaRenderer<T, Options>>
                    ) => void;
                    let reject!: (reason: unknown) => void;
                    const value = new Promise<FormCaptchaRenderer<T, Options>>(
                        (yes, no) => {
                            resolve = yes;
                            reject = no;
                        }
                    );
                    resources.set(request.scope, {
                        configuration: request.configuration,
                        value,
                    });
                    try {
                        resolve(request.load());
                    } catch (cause) {
                        reject(cause);
                    }
                    return value;
                },
            };
        },
    };
}

type Instance<T, Options> = FormCaptchaScope & {
    container: HTMLElement;
    retired: boolean;
    provider: FormCaptchaProvider<T, Options>;
    options: Options;
    handle?: FormCaptchaWidgetHandle;
    armed: boolean;
    pendingReset: boolean;
    resetting: boolean;
    publication: number;
    activePublications: number;
    admittedPublication: number;
    consumedPublication: number;
};

function open<T, O>(snapshot: FormCaptchaSnapshot<T, O>) {
    return snapshot.enabled && snapshot.editable && !snapshot.verified;
}

/** Internal DOM lifecycle; React commits provide the container and current ports. */
export function mountFormCaptcha<T, Options>(
    container: HTMLElement,
    initialHost: FormCaptchaHost<T, Options>,
    stateChanged: (state: FormCaptchaState) => void
) {
    let host = initialHost;
    let hostRevision = 0;
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    let instance: Instance<T, Options> | undefined;
    let previous: FormCaptchaScope | undefined;
    let failed: FormCaptchaScope | undefined;
    let blockedInvalidation:
        | {
              scope: FormCaptchaScope;
              tokenScope: FormCaptchaScope;
              tokenRevision: unknown;
          }
        | undefined;
    let syncing = false;
    let again = false;
    let state: FormCaptchaState | undefined;
    const show = (next: FormCaptchaState) => {
        if (!disposed && state !== next) {
            state = next;
            stateChanged(next);
        }
    };
    const same = (a: FormCaptchaScope, b: FormCaptchaScope) =>
        Object.is(a.owner, b.owner) &&
        a.configurationRevision === b.configurationRevision;
    function retire(current: Instance<T, Options>) {
        if (current.retired) return;
        current.retired = true;
        current.armed = current.pendingReset = false;
        if (instance === current) instance = undefined;
        // Retirement precedes provider cleanup; callbacks from remove are inert.
        current.container.remove();
        current.handle?.remove();
    }
    function valid(current: Instance<T, Options>) {
        if (disposed || current.retired || instance !== current) return false;
        const authority = host;
        const authorityRevision = hostRevision;
        const snapshot = authority.read();
        if (
            disposed ||
            current.retired ||
            instance !== current ||
            host !== authority ||
            hostRevision !== authorityRevision
        )
            return false;
        if (same(current, snapshot) && open(snapshot)) return snapshot;
        retire(current);
        sync();
        return false;
    }
    function notify(current: Instance<T, Options>, notice: FormCaptchaNotice) {
        if (!valid(current)) return;
        try {
            host.notify(notice);
        } finally {
            valid(current);
        }
    }
    function reset(current: Instance<T, Options>) {
        if (
            !current.pendingReset ||
            !current.handle ||
            current.activePublications
        )
            return;
        const snapshot = valid(current);
        if (!snapshot) return;
        if (snapshot.token.value !== null) {
            current.pendingReset = false;
            return;
        }
        current.pendingReset = false;
        current.resetting = true;
        try {
            current.handle.reset();
        } finally {
            current.resetting = false;
            valid(current);
        }
    }
    function publish(current: Instance<T, Options>, value: T | null) {
        if (current.resetting || !valid(current)) return false;
        // Arm before publication: canonical subscribers may synchronously reenter.
        current.armed = true;
        const publication = ++current.publication;
        current.activePublications++;
        let receipt: FormCaptchaAdmission | undefined;
        try {
            receipt = host.publish(
                {
                    owner: current.owner,
                    configurationRevision: current.configurationRevision,
                },
                value
            );
        } finally {
            current.activePublications--;
            if (receipt?.status === 'admitted')
                current.admittedPublication = Math.max(
                    current.admittedPublication,
                    publication
                );
            current.armed =
                current.activePublications > 0 ||
                current.admittedPublication > current.consumedPublication;
        }
        if (!valid(current)) return false;
        sync();
        return receipt.status === 'admitted' && !!valid(current);
    }
    function failure(current: Instance<T, Options>, cause: unknown) {
        if (!valid(current)) return;
        const failedIntent = hostRevision;
        failed = {
            owner: current.owner,
            configurationRevision: current.configurationRevision,
        };
        retire(current);
        if (disposed || hostRevision !== failedIntent || instance) return;
        show('unavailable');
        const authority = host;
        const snapshot = authority.read();
        if (
            !disposed &&
            host === authority &&
            !instance &&
            same(current, snapshot) &&
            open(snapshot)
        )
            authority.notify({ kind: 'unavailable', cause });
    }
    function render(
        current: Instance<T, Options>,
        renderer: FormCaptchaRenderer<T, Options>
    ) {
        if (!valid(current)) return;
        const callbacks: FormCaptchaCallbacks<T> = {
            change: (value) => {
                publish(current, value);
            },
            expired: () => {
                if (publish(current, null))
                    notify(current, { kind: 'expired' });
            },
            error: (cause) => {
                notify(current, { kind: 'error', cause });
            },
        };
        let rendered:
            | FormCaptchaWidgetHandle
            | Promise<FormCaptchaWidgetHandle>;
        try {
            rendered = renderer.render(
                current.container,
                current.options,
                callbacks
            );
        } catch (cause) {
            failure(current, cause);
            return;
        }
        Promise.resolve(rendered).then(
            (handle) => {
                if (!valid(current)) {
                    handle.remove();
                    return;
                }
                current.handle = handle;
                show('ready');
                sync();
            },
            (cause) => failure(current, cause)
        );
    }
    function sync() {
        if (disposed) return;
        if (syncing) {
            again = true;
            return;
        }
        syncing = true;
        try {
            do {
                again = false;
                let snapshot = host.read();
                if (disposed) break;
                if (instance && (!same(instance, snapshot) || !open(snapshot)))
                    retire(instance);
                // remove/host callbacks may have changed the committed frame.
                snapshot = host.read();
                if (disposed) break;
                if (!open(snapshot)) {
                    failed = undefined;
                    show('hidden');
                    continue;
                }
                if (
                    !Number.isSafeInteger(snapshot.configurationRevision) ||
                    snapshot.configurationRevision < 0
                ) {
                    show('unavailable');
                    continue;
                }
                if (failed && same(failed, snapshot)) {
                    show('unavailable');
                    continue;
                }
                if (instance) {
                    if (snapshot.token.value !== null)
                        instance.pendingReset = false;
                    if (instance.activePublications) continue;
                    if (instance.armed && snapshot.token.value === null) {
                        instance.armed = false;
                        instance.consumedPublication =
                            instance.admittedPublication;
                        instance.pendingReset = true;
                    }
                    reset(instance);
                    continue;
                }
                if (
                    previous &&
                    Object.is(previous.owner, snapshot.owner) &&
                    snapshot.configurationRevision <
                        previous.configurationRevision
                ) {
                    show('unavailable');
                    continue;
                }
                const token = snapshot.token;
                if (
                    token.value !== null &&
                    Object.is(token.owner, snapshot.owner) &&
                    token.configurationRevision !==
                        snapshot.configurationRevision
                ) {
                    if (
                        blockedInvalidation &&
                        same(blockedInvalidation.scope, snapshot) &&
                        Object.is(
                            blockedInvalidation.tokenRevision,
                            token.revision
                        ) &&
                        same(blockedInvalidation.tokenScope, token)
                    ) {
                        show('unavailable');
                        continue;
                    }
                    if (
                        !Number.isSafeInteger(token.configurationRevision) ||
                        token.configurationRevision < 0 ||
                        token.configurationRevision >
                            snapshot.configurationRevision
                    ) {
                        show('unavailable');
                        continue;
                    }
                    const before = snapshot;
                    const authorityRevision = hostRevision;
                    const receipt = host.invalidate(
                        {
                            owner: token.owner,
                            configurationRevision: token.configurationRevision,
                        },
                        token
                    );
                    snapshot = host.read();
                    if (disposed) break;
                    if (hostRevision !== authorityRevision) {
                        again = true;
                        continue;
                    }
                    if (!same(before, snapshot) || !open(snapshot)) {
                        again = true;
                        continue;
                    }
                    if (
                        receipt.status !== 'admitted' ||
                        (snapshot.token.value !== null &&
                            same(snapshot.token, token))
                    ) {
                        blockedInvalidation = {
                            scope: {
                                owner: before.owner,
                                configurationRevision:
                                    before.configurationRevision,
                            },
                            tokenScope: {
                                owner: token.owner,
                                configurationRevision:
                                    token.configurationRevision,
                            },
                            tokenRevision: token.revision,
                        };
                        show('unavailable');
                        continue;
                    }
                    // Re-evaluate all provenance against the latest canonical frame.
                    again = true;
                    continue;
                }
                const ownedContainer =
                    container.ownerDocument.createElement('div');
                ownedContainer.className = 'mx-sdk-form-captcha-instance';
                const current: Instance<T, Options> = {
                    container: ownedContainer,
                    owner: snapshot.owner,
                    configurationRevision: snapshot.configurationRevision,
                    retired: false,
                    provider: snapshot.provider,
                    options: snapshot.options,
                    armed: false,
                    pendingReset: false,
                    resetting: false,
                    publication: 0,
                    activePublications: 0,
                    admittedPublication: 0,
                    consumedPublication: 0,
                };
                previous = {
                    owner: current.owner,
                    configurationRevision: current.configurationRevision,
                };
                blockedInvalidation = undefined;
                failed = undefined;
                instance = current;
                container.append(ownedContainer);
                show('loading');
                if (!valid(current)) continue;
                try {
                    Promise.resolve(current.provider.load()).then(
                        (renderer) => render(current, renderer),
                        (cause) => failure(current, cause)
                    );
                } catch (cause) {
                    failure(current, cause);
                }
            } while (again && !disposed);
        } finally {
            syncing = false;
        }
    }
    function listen(next: FormCaptchaHost<T, Options>) {
        const intent = ++hostRevision;
        const previousUnsubscribe = unsubscribe;
        unsubscribe = undefined;
        host = next;
        try {
            previousUnsubscribe?.();
        } catch (cause) {
            if (hostRevision === intent && instance) retire(instance);
            throw cause;
        }
        if (disposed || hostRevision !== intent) return;
        const stop = next.subscribe(sync);
        if (disposed || hostRevision !== intent) stop();
        else unsubscribe = stop;
        sync();
    }
    listen(initialHost);
    return {
        updateHost(next: FormCaptchaHost<T, Options>) {
            if (!disposed) {
                if (host === next) sync();
                else listen(next);
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            try {
                unsubscribe?.();
            } finally {
                if (instance) retire(instance);
            }
        },
    };
}
