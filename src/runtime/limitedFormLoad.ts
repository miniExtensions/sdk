import type {
    DeviceFingerprint,
    FormLoadedPayload,
    LoadExtensionInput,
    LoadExtensionResult,
    MiniExtensionsClient,
    RuntimeRequestOptions,
    RuntimeSession,
} from './types.js';

export type CollectedDeviceFingerprint = DeviceFingerprint & {
    visitorId: string;
};

/** Explicit host scope. No collector, browser dependency or global cache. */
export type DeviceFingerprintProvider = {
    getFingerprint(): Promise<unknown>;
};

export type LimitedFormLoadErrorCode = 'capability_unavailable' | 'retired';

export class LimitedFormLoadError extends Error {
    constructor(
        readonly code: LimitedFormLoadErrorCode,
        options?: { cause?: unknown }
    ) {
        super(
            code === 'retired'
                ? 'The extension load is no longer current.'
                : 'A valid device identifier is required to load this Form.',
            options
        );
        this.name = 'LimitedFormLoadError';
    }
}

const validateFingerprint = (value: unknown): CollectedDeviceFingerprint => {
    const version =
        value != null && typeof value === 'object' && 'version' in value
            ? value.version
            : undefined;
    const visitorId =
        value != null && typeof value === 'object' && 'visitorId' in value
            ? value.visitorId
            : undefined;
    if (
        version !== 1 ||
        typeof visitorId !== 'string' ||
        visitorId.length < 16 ||
        visitorId.length > 128
    ) {
        throw new LimitedFormLoadError('capability_unavailable');
    }
    return Object.freeze({ version: 1, visitorId });
};

/** Successful identity (including in-flight work) belongs to this instance.
 * Rejection is evicted; a later explicit call may try again. Callers cannot
 * cancel or clear work shared with another load, Compute or Save.
 */
export const createCachedDeviceFingerprintProvider = (
    collect: () => unknown | Promise<unknown>
): DeviceFingerprintProvider => {
    let pending: Promise<CollectedDeviceFingerprint> | undefined;
    return {
        getFingerprint() {
            if (pending == null) {
                pending = Promise.resolve()
                    .then(collect)
                    .then(validateFingerprint)
                    .catch((cause: unknown) => {
                        pending = undefined;
                        throw new LimitedFormLoadError(
                            'capability_unavailable',
                            { cause }
                        );
                    });
            }
            return pending;
        },
    };
};

export const getDeviceFingerprint = async (
    provider?: DeviceFingerprintProvider
): Promise<CollectedDeviceFingerprint> => {
    try {
        if (provider == null || typeof provider.getFingerprint !== 'function') {
            throw new LimitedFormLoadError('capability_unavailable');
        }
        return validateFingerprint(await provider.getFingerprint());
    } catch (cause) {
        throw new LimitedFormLoadError('capability_unavailable', { cause });
    }
};

/** Shared eligibility for loading and the host's allocated Compute/Save prep. */
export const requiresFormDeviceFingerprint = (
    context: { type: string },
    form: Pick<
        FormLoadedPayload,
        'hasParentExtension' | 'formRecord' | 'publicFields'
    >
): boolean =>
    context.type === 'direct-url' &&
    !form.hasParentExtension &&
    form.formRecord.type === 'create' &&
    form.publicFields.state.allowCreatingOnlyOneRecord === true;

export type ExtensionLoadTransport = (
    input: LoadExtensionInput,
    options: RuntimeRequestOptions
) => Promise<LoadExtensionResult>;

type LoadSource =
    | {
          client: Pick<MiniExtensionsClient, 'getSession' | 'loadExtension'>;
          transport?: never;
          session?: never;
      }
    | {
          transport: ExtensionLoadTransport;
          session?: Readonly<RuntimeSession>;
          client?: never;
      };

export type CapabilityExtensionLoadOptions = LoadSource & {
    input: LoadExtensionInput;
    provider?: DeviceFingerprintProvider;
    signal?: AbortSignal;
    /** Host-owned monotonic receipt; once false, this call stays retired. */
    isCurrent: () => boolean;
    /** Optional final-only sink; the host retains its query/store ownership. */
    publish?: (result: LoadExtensionResult) => void;
};

/** One capability request and, only for an eligible root CREATE Form, one
 * identified request. Each transport receives a fresh detached logical DTO.
 * Native transports may still resolve host context and physically retry.
 */
export const loadExtensionWithCapabilities = async (
    options: CapabilityExtensionLoadOptions
): Promise<LoadExtensionResult> => {
    const { signal, isCurrent, provider, publish } = options;
    let retired = false;
    const checkCurrent = (): void => {
        retired = retired || signal?.aborted === true || !isCurrent();
        if (retired) throw new LimitedFormLoadError('retired');
    };
    const boundary = async <T>(work: Promise<T>): Promise<T> => {
        try {
            return await work;
        } finally {
            checkCurrent();
        }
    };
    checkCurrent();
    const input = structuredClone(options.input);
    const client = options.client;
    const session = structuredClone(client?.getSession() ?? options.session);
    const transport: ExtensionLoadTransport = client
        ? (body, requestOptions) => client.loadExtension(body, requestOptions)
        : options.transport;
    const request = (deviceFingerprint?: DeviceFingerprint) => {
        checkCurrent();
        const body = structuredClone(input);
        if (deviceFingerprint != null)
            body.deviceFingerprint = deviceFingerprint;
        return boundary(
            transport(body, { signal, session: structuredClone(session) })
        );
    };
    const directRoot =
        'shareId' in input && input.context.type === 'direct-url';
    let result = await request(
        directRoot ? { version: 1, visitorId: null } : undefined
    );
    checkCurrent();
    if (
        directRoot &&
        result.extensionScreen === 'form_loaded' &&
        requiresFormDeviceFingerprint(input.context, result.payload)
    ) {
        checkCurrent();
        const fingerprint = await boundary(getDeviceFingerprint(provider));
        checkCurrent();
        result = await request(fingerprint);
        checkCurrent();
    }
    checkCurrent();
    publish?.(result);
    return result;
};
