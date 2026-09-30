import type {
    MiniExtensionsClient,
    MiniExtensionsClientOptions,
    RuntimeOperation,
    RuntimeRequestOptions,
} from './types.js';

export type SDKErrorKind = 'network' | 'http' | 'api' | 'protocol';

/** Transport failures are distinct from a Form's returned validation errors. */
export class SDKError extends Error {
    readonly kind: SDKErrorKind;
    readonly status?: number;
    readonly code?: string;

    constructor(
        message: string,
        options: {
            kind: SDKErrorKind;
            status?: number;
            code?: string;
            cause?: unknown;
        }
    ) {
        super(message, { cause: options.cause });
        this.name = 'SDKError';
        this.kind = options.kind;
        this.status = options.status;
        this.code = options.code;
    }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

const rethrowCancellation = (error: unknown, signal?: AbortSignal): void => {
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof Error && error.name === 'AbortError') throw error;
};

export const createMiniExtensionsClient = (
    options: MiniExtensionsClientOptions
): MiniExtensionsClient => {
    let origin: URL;
    try {
        origin = new URL(options.apiOrigin);
    } catch {
        throw new TypeError('apiOrigin must be an HTTP(S) origin.');
    }
    if (
        (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
        origin.username !== '' ||
        origin.password !== '' ||
        origin.pathname !== '/' ||
        origin.search !== '' ||
        origin.hash !== ''
    ) {
        throw new TypeError('apiOrigin must be an HTTP(S) origin.');
    }
    if (
        typeof options.publishableKey !== 'string' ||
        options.publishableKey.trim() === '' ||
        /[\r\n]/.test(options.publishableKey)
    ) {
        throw new TypeError('publishableKey must be a nonempty string.');
    }

    const endpoint = new URL('/api/sdk', origin).href;
    const publishableKey = options.publishableKey.trim();
    const fetchImpl =
        options.fetch ??
        (typeof globalThis.fetch === 'function'
            ? globalThis.fetch.bind(globalThis)
            : null);
    if (fetchImpl == null)
        throw new TypeError('A fetch implementation is required.');
    let session = { ...options.session };

    const request = async <Result extends object>(
        operation: RuntimeOperation,
        input: object,
        requestOptions: RuntimeRequestOptions = {}
    ): Promise<Result> => {
        const signal = requestOptions.signal;
        signal?.throwIfAborted();
        const snapshot = { ...(requestOptions.session ?? session) };
        const body = JSON.stringify({ operation, input, session: snapshot });

        let response: Response;
        try {
            response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${publishableKey}`,
                },
                credentials: 'omit',
                body,
                signal,
            });
        } catch (cause) {
            rethrowCancellation(cause, signal);
            throw new SDKError('The network request failed.', {
                kind: 'network',
                cause,
            });
        }

        let data: unknown;
        try {
            data = await response.json();
        } catch (cause) {
            rethrowCancellation(cause, signal);
            throw new SDKError(
                response.ok
                    ? 'The server returned invalid JSON.'
                    : 'The request failed.',
                {
                    kind: response.ok ? 'protocol' : 'http',
                    status: response.status,
                    cause,
                }
            );
        }
        signal?.throwIfAborted();
        const endpointError = isObject(data) && data.error === true;
        if (!response.ok || endpointError) {
            throw new SDKError(
                isObject(data) &&
                typeof data.message === 'string' &&
                data.message.trim() !== ''
                    ? data.message
                    : 'The request failed.',
                {
                    kind: endpointError ? 'api' : 'http',
                    status: response.status,
                    code:
                        isObject(data) && typeof data.code === 'string'
                            ? data.code
                            : undefined,
                }
            );
        }
        if (!isObject(data)) {
            throw new SDKError('The server returned an invalid response.', {
                kind: 'protocol',
                status: response.status,
            });
        }
        return data as Result;
    };

    return {
        getSession: () => ({ ...session }),
        setSession: (next) => {
            session = { ...next };
        },
        loadExtension: (input, requestOptions) =>
            request('loadExtension', input, requestOptions),
        auth: {
            verifyExtensionPassword: (input, requestOptions) =>
                request('auth.verifyExtensionPassword', input, requestOptions),
            login: (input, requestOptions) =>
                request('auth.login', input, requestOptions),
            confirmVerificationCode: (input, requestOptions) =>
                request('auth.confirmVerificationCode', input, requestOptions),
            signUp: (input, requestOptions) =>
                request('auth.signUp', input, requestOptions),
        },
        forms: {
            save: (input, requestOptions) =>
                request('forms.save', input, requestOptions),
        },
    };
};
