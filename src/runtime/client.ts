import type {
    CanonicalOperationTransports,
    CreateUploadUrlResult,
    MiniExtensionsClient,
    MiniExtensionsClientOptions,
    RuntimeOperation,
    RuntimeRequestOptions,
    UploadFileInput,
    UploadFileResult,
} from './types.js';
import { createTRPCUntypedClient, httpLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { copyVisitorSession } from './session.js';

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
    if (signal?.aborted) throw signal.reason;
    if (error instanceof Error && error.name === 'AbortError') throw error;
};

const v1Routes = {
    loadExtension: 'fetchExtensionForEndUser',
    'auth.verifyExtensionPassword': 'verifyExtensionPassword',
    'auth.login': 'loginIntoExtensionUsingLoginPageExtension',
    'auth.confirmVerificationCode': 'confirmVerificationCodeForLogin',
    'auth.signUp': 'signUpForLoginPageExtension',
    'forms.save': 'saveForm',
    'portals.listLinkedRecords': 'fetchRecordsForLinkedTableOnPortal',
    'linkedRecords.listFormOptions': 'fetchRecordsForFormLinkedRecordsSelector',
    'linkedRecords.listPortalOptions':
        'fetchRecordsForPortalLinkedRecordsSelector',
} as const satisfies {
    [Operation in RuntimeOperation as CanonicalOperationTransports[Operation]['transport'] extends 'v1'
        ? Operation
        : never]: CanonicalOperationTransports[Operation]['route'];
};

const trpcRoutes = {
    'forms.deleteCurrentRecord': ['mutation', 'airtable.deleteRecord'],
    'forms.addSelectOption': [
        'mutation',
        'airtable.addNewAirtableOptionForFormField',
    ],
    'portals.getUserRecord': ['query', 'airtable.getUserRecord'],
    'portals.updateGridCell': ['mutation', 'airtable.updatePortalRecord'],
    'portals.unlinkRecord': ['mutation', 'airtable.unlinkPortalRecord'],
    'portals.setKanbanCategory': [
        'mutation',
        'airtable.updateRecordKanbanCategory',
    ],
    'linkedRecords.loadSelectedRecords': [
        'query',
        'publicExtensions.fetchInitialTableIdsToLinkedTableStates',
    ],
    'attachments.createUploadUrl': [
        'mutation',
        'publicExtensions.createPublicUploadLink',
    ],
    'comments.listForRecord': [
        'query',
        'airtable.getAirtableCommentsForRecord',
    ],
    'comments.addToRecord': [
        'mutation',
        'airtable.addAirtableCommentForRecord',
    ],
} as const satisfies {
    [Operation in RuntimeOperation as CanonicalOperationTransports[Operation]['transport'] extends 'trpc'
        ? Operation
        : never]: readonly [
        CanonicalOperationTransports[Operation]['kind'],
        CanonicalOperationTransports[Operation]['route'],
    ];
};

const assertVisitorInput = (input: object): void => {
    if (
        !isObject(input) ||
        'miniExtSession' in input ||
        'miniExtStorageV4' in input ||
        typeof input.toJSON === 'function'
    ) {
        throw new TypeError(
            'Runtime input cannot override transport-owned visitor credentials.'
        );
    }
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
    const fetchImpl =
        options.fetch ??
        (typeof globalThis.fetch === 'function'
            ? globalThis.fetch.bind(globalThis)
            : null);
    if (fetchImpl == null)
        throw new TypeError('A fetch implementation is required.');
    let session = copyVisitorSession(options.session);

    const request = async <Result>(
        operation: RuntimeOperation,
        input: object,
        requestOptions: RuntimeRequestOptions = {}
    ): Promise<Result> => {
        const signal = requestOptions.signal;
        signal?.throwIfAborted();
        assertVisitorInput(input);
        const inputSnapshot = { ...input };
        assertVisitorInput(inputSnapshot);
        const snapshot = copyVisitorSession(
            requestOptions.session === undefined
                ? session
                : requestOptions.session
        );

        if (operation in trpcRoutes) {
            const [method, path] =
                trpcRoutes[operation as keyof typeof trpcRoutes];
            // Keep the official protocol, plain JSON transformer, and native
            // query GET / mutation POST behavior. Each call owns its session
            // snapshot; no cookies, retry link, or mutable shared context.
            const client = createTRPCUntypedClient<AnyRouter>({
                links: [
                    httpLink({
                        url: new URL('/api/trpc', origin).href,
                        headers: {
                            'miniext-context': JSON.stringify({
                                miniExtStorageV4: snapshot,
                            }),
                        },
                        fetch: (url, init) => {
                            signal?.throwIfAborted();
                            return fetchImpl(url, {
                                // Match the canonical HTTP adapter: this JSON
                                // link supplies a string body, while the pinned
                                // fetch type also permits binary ArrayBufferLike.
                                ...(init as RequestInit | undefined),
                                credentials: 'omit',
                                cache: 'no-store',
                                signal:
                                    signal == null
                                        ? init?.signal
                                        : init?.signal == null
                                          ? signal
                                          : AbortSignal.any([
                                                signal,
                                                init.signal,
                                            ]),
                            });
                        },
                    }),
                ],
            });
            try {
                const result = await client[method](path, inputSnapshot);
                signal?.throwIfAborted();
                return result as Result;
            } catch (error) {
                rethrowCancellation(error, signal);
                // Preserve native tRPC errors, including their shape and data.
                throw error;
            }
        }

        const route = v1Routes[operation as keyof typeof v1Routes];
        const endpoint = new URL('/api/v1', origin);
        endpoint.searchParams.set('route', route);
        const body = JSON.stringify({
            ...inputSnapshot,
            miniExtStorageV4: snapshot,
        });

        let response: Response;
        try {
            response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'omit',
                cache: 'no-store',
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
        if (isObject(data)) return data as Result;
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
            !isObject(upload) ||
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
            session = copyVisitorSession(next);
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
