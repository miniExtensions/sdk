import type {
    CreateUploadUrlResult,
    MiniExtensionsClient,
    MiniExtensionsClientOptions,
    RuntimeOperation,
    RuntimeRequestOptions,
    UploadFileInput,
    UploadFileResult,
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

const voidResponseOperations: ReadonlySet<RuntimeOperation> = new Set([
    'forms.deleteCurrentRecord',
    'portals.unlinkRecord',
    'comments.addToRecord',
]);

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

    const request = async <Result>(
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
        if (voidResponseOperations.has(operation)) {
            if (data === null) return undefined as Result;
        } else if (
            isObject(data) ||
            (operation === 'portals.getUserRecord' && data === null)
        ) {
            return data as Result;
        }
        throw new SDKError('The server returned an invalid response.', {
            kind: 'protocol',
            status: response.status,
        });
    };

    const uploadFile = async (
        input: UploadFileInput,
        requestOptions: RuntimeRequestOptions = {}
    ): Promise<UploadFileResult> => {
        const { file, filename } = input;
        const signal = requestOptions.signal;
        const upload = await request<CreateUploadUrlResult>(
            'attachments.createUploadUrl',
            {
                fileType: file.type,
                filename,
                fileSize: file.size,
                authority: {
                    type: 'form',
                    extensionAccessToken: input.extensionAccessToken,
                    fieldId: input.fieldId,
                },
            },
            requestOptions
        );
        if (
            typeof upload.signedUrl !== 'string' ||
            upload.signedUrl.length === 0 ||
            typeof upload.publicUrl !== 'string' ||
            upload.publicUrl.length === 0
        ) {
            throw new SDKError('The server returned an invalid response.', {
                kind: 'protocol',
            });
        }
        signal?.throwIfAborted();
        let response: Response;
        try {
            response = await fetchImpl(upload.signedUrl, {
                method: 'PUT',
                headers: { 'Content-Type': file.type },
                credentials: 'omit',
                body: file,
                signal,
            });
        } catch (cause) {
            rethrowCancellation(cause, signal);
            throw new SDKError('The attachment upload failed.', {
                kind: 'network',
                cause,
            });
        }
        signal?.throwIfAborted();
        if (!response.ok) {
            throw new SDKError('The attachment upload failed.', {
                kind: 'http',
                status: response.status,
            });
        }
        return {
            id: null,
            url: upload.publicUrl,
            filename,
            size: file.size,
            type: file.type,
        };
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
            deleteCurrentRecord: (input, requestOptions) =>
                request('forms.deleteCurrentRecord', input, requestOptions),
            addSelectOption: (input, requestOptions) =>
                request('forms.addSelectOption', input, requestOptions),
        },
        portals: {
            listLinkedRecords: (input, requestOptions) =>
                request('portals.listLinkedRecords', input, requestOptions),
            getUserRecord: (input, requestOptions) =>
                request('portals.getUserRecord', input, requestOptions),
            updateGridCell: (input, requestOptions) =>
                request('portals.updateGridCell', input, requestOptions),
            unlinkRecord: (input, requestOptions) =>
                request('portals.unlinkRecord', input, requestOptions),
            setKanbanCategory: (input, requestOptions) =>
                request('portals.setKanbanCategory', input, requestOptions),
        },
        linkedRecords: {
            listFormOptions: (input, requestOptions) =>
                request('linkedRecords.listFormOptions', input, requestOptions),
            listPortalOptions: (input, requestOptions) =>
                request(
                    'linkedRecords.listPortalOptions',
                    input,
                    requestOptions
                ),
            loadSelectedRecords: (input, requestOptions) =>
                request(
                    'linkedRecords.loadSelectedRecords',
                    input,
                    requestOptions
                ),
        },
        attachments: {
            createUploadUrl: (input, requestOptions) =>
                request('attachments.createUploadUrl', input, requestOptions),
            uploadFile,
        },
        comments: {
            listForRecord: (input, requestOptions) =>
                request('comments.listForRecord', input, requestOptions),
            addToRecord: (input, requestOptions) =>
                request('comments.addToRecord', input, requestOptions),
        },
    };
};
