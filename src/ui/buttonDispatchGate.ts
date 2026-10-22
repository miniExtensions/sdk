export type ButtonDispatchGateOptions = {
    /** Current committed host owner; a false result permanently retires this gate. */
    isCurrent(): boolean;
    /** Host-owned URL/source/mode availability, not server authorization. */
    canTrigger(): boolean;
    /** Existing host transport and feedback continuation, including its retry policy. */
    dispatch(): Promise<void>;
    /** Presentation only. Exceptions cannot cancel or replay an allocated action. */
    pendingChanged?(pending: boolean): void;
};
export type ButtonDispatchGate = {
    /** True means dispatch completed, not that a webhook succeeded. Rejections propagate. */
    run(): Promise<boolean>;
    /** Refuse new intents; never abort or discard an already-allocated host promise. */
    dispose(): void;
};

/** Clientless Button admission/singleflight only; no draft, journal or recovery owner. */
export function createButtonDispatchGate(
    options: ButtonDispatchGateOptions
): ButtonDispatchGate {
    const { isCurrent, canTrigger, dispatch, pendingChanged } = options;
    let retired = false;
    let flight: object | null = null;
    const current = () => {
        if (retired) return false;
        try {
            if (isCurrent() !== true) retired = true;
        } catch {
            retired = true;
        }
        return !retired;
    };
    const admitted = () => {
        if (!current()) return false;
        let available: boolean;
        try {
            available = canTrigger();
        } catch {
            return false;
        }
        return current() && available === true;
    };
    const notify = (pending: boolean) => {
        try {
            pendingChanged?.(pending);
        } catch {
            // Presentation cannot change the disposition of host-owned work.
        }
    };
    return {
        async run() {
            if (retired || flight !== null) return false;
            // Claim before every host callback, including availability and presentation.
            const ticket = {};
            flight = ticket;
            let published = false;
            try {
                if (!admitted()) return false;
                published = true;
                notify(true);
                // A pending observer may retire the owner or change availability.
                if (!admitted()) return false;
                await dispatch();
                return true;
            } finally {
                if (flight === ticket) {
                    // Keep the slot during notification so a reentrant observer
                    // cannot replay the action as pending presentation clears.
                    if (published && current()) notify(false);
                    flight = null;
                }
            }
        },
        dispose() {
            retired = true;
        },
    };
}
