/** A captured host resource lifetime; a URL or record ID is not authority. */
export type ReadonlyResourceOwner = {
    readonly token?: unknown;
    isCurrent(): boolean;
    subscribe?(listener: () => void): () => void;
};

export function resourceOwnerCurrent(owner?: ReadonlyResourceOwner): boolean {
    if (owner === undefined) return true;
    try {
        return owner.isCurrent() === true;
    } catch {
        return false;
    }
}

export function resourceOwnerGeneration(
    owner?: ReadonlyResourceOwner
): unknown {
    return owner?.token === undefined ? owner : owner.token;
}

/** Release immediately on retirement, even if an allocated request never settles. */
export function watchResourceOwner(
    owner: ReadonlyResourceOwner | undefined,
    retired: () => void
): () => void {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const release = () => {
        if (disposed) return;
        disposed = true;
        unsubscribe?.();
    };
    const check = () => {
        if (!disposed && !resourceOwnerCurrent(owner)) {
            try {
                retired();
            } finally {
                release();
            }
        }
    };
    try {
        if (owner?.subscribe !== undefined) {
            unsubscribe = owner.subscribe(check);
            if (disposed) unsubscribe();
        }
        check();
    } catch {
        if (disposed) return release;
        try {
            retired();
        } finally {
            release();
        }
    }
    return release;
}
