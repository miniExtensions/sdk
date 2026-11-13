import type { AirtableAttachment } from '../runtime/types.js';

export type SignatureMethod = 'type' | 'draw' | 'upload';
export type SignatureAuthority = Readonly<{
    ownerIdentity: string | null;
    fieldId: string;
    method: SignatureMethod;
    operationId: string;
}>;
export type SignatureReceiptState =
    | 'pending'
    | 'transferred'
    | 'released'
    | 'uncertain';
export type SignatureReleaseResult =
    | 'released'
    | 'already-released'
    | 'uncertain';
export type TemporarySignature = Readonly<{
    attachment: AirtableAttachment;
    /** Authority over this operation's temporary object only. */
    release: () => Promise<SignatureReleaseResult>;
}>;
export type SignatureStorage = {
    /** Owns cleanup on failure before returning a receipt. Never retries. */
    store: (
        file: File,
        authority: SignatureAuthority
    ) => Promise<TemporarySignature>;
};
export type SignatureAppend = (
    request: SignatureAuthority & {
        attachment: AirtableAttachment;
        /** Latest committed host list, never the upload-start snapshot. */
        value: readonly AirtableAttachment[];
    }
) => 'appended' | 'retired';
export type SignatureRecovery = {
    authority: SignatureAuthority;
    phase: 'store' | 'append' | 'release';
    error?: unknown;
    state: 'uncertain';
};

/** Keeps the original transport failure and its independent cleanup outcome. */
export class SignatureStorageError extends Error {
    constructor(
        readonly originalError: unknown,
        readonly cleanup: SignatureReleaseResult,
        readonly cleanupError?: unknown
    ) {
        super('Unable to store signature', { cause: originalError });
        this.name = 'SignatureStorageError';
    }
}

/** A one-shot lease. A throwing append is never evidence of non-commit. */
export class SignatureReceipt {
    #state: SignatureReceiptState = 'pending';
    #settled = false;
    constructor(
        readonly temporary: TemporarySignature,
        readonly authority: SignatureAuthority
    ) {}

    get state(): SignatureReceiptState {
        return this.#state;
    }

    async settle(
        current: () => {
            value: readonly AirtableAttachment[];
            append: SignatureAppend;
        } | null,
        report: (recovery: SignatureRecovery) => void
    ): Promise<SignatureReceiptState> {
        if (this.#settled) return this.#state;
        this.#settled = true;
        try {
            const host = current();
            if (host != null) {
                const result = host.append({
                    ...this.authority,
                    attachment: this.temporary.attachment,
                    value: host.value,
                });
                if (result === 'appended') {
                    this.#state = 'transferred';
                    return this.#state;
                }
                if (result !== 'retired') {
                    throw new Error('Unknown signature append outcome');
                }
            }
        } catch (error) {
            this.#state = 'uncertain';
            report({
                authority: this.authority,
                phase: 'append',
                error,
                state: 'uncertain',
            });
            return this.#state;
        }

        // Only a positive non-commit permits invoking deletion authority.
        try {
            const result = await this.temporary.release();
            if (result === 'released' || result === 'already-released') {
                this.#state = 'released';
            } else {
                this.#state = 'uncertain';
                report({
                    authority: this.authority,
                    phase: 'release',
                    state: 'uncertain',
                });
            }
        } catch (error) {
            this.#state = 'uncertain';
            report({
                authority: this.authority,
                phase: 'release',
                error,
                state: 'uncertain',
            });
        }
        return this.#state;
    }
}
