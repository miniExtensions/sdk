import { SDKError } from '../runtime/client.js';
import { withExtensionPassword, withLoginToken } from '../runtime/session.js';
import type {
    LoginPageResult,
    PasswordRequiredResult,
    RuntimeLanguage,
    RuntimeSession,
} from '../runtime/types.js';
import type {
    AuthCredentialGrant,
    AuthFlow,
    AuthFlowErrorCode,
    AuthFlowOptions,
    AuthOwnerScope,
    AuthPage,
    AuthRequestOptions,
    AuthVerificationChallenge,
    LoginAuthFlow,
    PasswordAuthFlow,
} from './types.js';

export class AuthFlowError extends Error {
    readonly code: AuthFlowErrorCode;

    constructor(code: AuthFlowErrorCode, message: string) {
        super(message);
        this.name = 'AuthFlowError';
        this.code = code;
    }
}

type Metadata =
    | { screen: 'password'; extensionId: string }
    | {
          screen: 'login_page';
          extensionId: string;
          tableId: string;
          loginFieldNames: string[];
          language: RuntimeLanguage;
      };
type Phase =
    | 'active'
    | 'applied'
    | 'cancelled'
    | 'disposed'
    | 'stale'
    | 'uncertain';
type Grant = { token: string; generation: number; type: 'password' | 'login' };
type Challenge = { verificationId: string; generation: number };
type Attempt = {
    controller: AbortController;
    generation: number;
    dispatched: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const requireString = (value: unknown, description: string): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${description} must be a nonempty string.`);
    }
    return value;
};
const readScope = (getScope: () => AuthOwnerScope): AuthOwnerScope => {
    const scope = getScope();
    if (
        typeof scope?.ownerId !== 'string' ||
        scope.ownerId.trim() === '' ||
        !Number.isSafeInteger(scope.revision) ||
        scope.revision < 0
    )
        throw new TypeError(
            'An owner ID and nonnegative scope revision are required.'
        );
    return { ownerId: scope.ownerId, revision: scope.revision };
};
const sameScope = (a: AuthOwnerScope, b: AuthOwnerScope): boolean =>
    a.ownerId === b.ownerId && a.revision === b.revision;
const readSession = (value: RuntimeSession): RuntimeSession => {
    if (
        !isObject(value) ||
        Object.values(value).some((entry) => typeof entry !== 'string')
    ) {
        throw new TypeError(
            'The client session must contain string credentials.'
        );
    }
    return { ...value };
};
const sameSession = (a: RuntimeSession, b: RuntimeSession): boolean =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);

const readMetadata = (page: AuthPage): Metadata => {
    const extensionId = requireString(page.extensionId, 'Extension ID');
    if (page.extensionScreen === 'password')
        return { screen: 'password', extensionId };
    if (page.extensionScreen !== 'login_page' || !isObject(page.payload)) {
        throw new TypeError('A loaded password or login page is required.');
    }
    const tableId = requireString(page.payload.tableId, 'Login table ID');
    if (!Array.isArray(page.payload.loginFieldNames)) {
        throw new TypeError('Login field names must be an array.');
    }
    const loginFieldNames = page.payload.loginFieldNames.map((name) =>
        requireString(name, 'Login field name')
    );
    requireString(page.language, 'Login page language');
    return {
        screen: 'login_page',
        extensionId,
        tableId,
        loginFieldNames,
        language: page.language,
    };
};

const copyCredentials = (
    credentials: Record<string, string>
): Record<string, string> => {
    if (
        !isObject(credentials) ||
        Object.values(credentials).some((value) => typeof value !== 'string')
    ) {
        throw new TypeError(
            'Authentication credentials must be keyed by field name with string values.'
        );
    }
    return { ...credentials };
};

const handle = <Handle extends object>(): Handle =>
    Object.freeze(Object.create(null)) as Handle;

export function createAuthFlow(
    options: AuthFlowOptions<PasswordRequiredResult>
): PasswordAuthFlow;
export function createAuthFlow(
    options: AuthFlowOptions<LoginPageResult>
): LoginAuthFlow;
export function createAuthFlow(options: AuthFlowOptions<AuthPage>): AuthFlow;
export function createAuthFlow(options: AuthFlowOptions<AuthPage>): AuthFlow {
    const client = options.client;
    const getScope = options.getScope;
    const metadata = readMetadata(options.page);
    let capturedSession: RuntimeSession | null = readSession(
        client.getSession()
    );
    const ownerScope = readScope(getScope);
    const checkedSession = readSession(client.getSession());
    if (
        !sameScope(readScope(getScope), ownerScope) ||
        !sameSession(checkedSession, capturedSession)
    ) {
        throw new AuthFlowError(
            'scope-changed',
            'The authentication context changed while creating the flow.'
        );
    }
    let phase: Phase = 'active';
    let generation = 0;
    let grants = new WeakMap<AuthCredentialGrant, Grant>();
    let challenges = new WeakMap<AuthVerificationChallenge, Challenge>();
    let active: Attempt | null = null;
    let checkingFreshness = false;

    const lifecycleError = () => {
        if (phase === 'disposed')
            return new AuthFlowError(
                'disposed',
                'The authentication flow was disposed.'
            );
        if (phase === 'cancelled')
            return new AuthFlowError(
                'cancelled',
                'The authentication flow was cancelled. Create a fresh flow.'
            );
        if (phase === 'stale')
            return new AuthFlowError(
                'scope-changed',
                'The authentication owner or session changed. Create a fresh flow.'
            );
        return new AuthFlowError(
            'reload-required',
            'Reload the extension and create a fresh authentication flow.'
        );
    };
    const releaseHandles = () => {
        grants = new WeakMap();
        challenges = new WeakMap();
    };
    const retire = (next: Exclude<Phase, 'active'>, reason?: unknown) => {
        const previous = active;
        generation += 1;
        active = null;
        phase = next;
        releaseHandles();
        capturedSession = null;
        // Detach and retire first: abort handlers cannot revive or consume old handles.
        previous?.controller.abort(reason ?? lifecycleError());
    };
    const isCurrent = (): boolean => {
        if (phase !== 'active' || capturedSession === null || checkingFreshness)
            return false;
        const observedGeneration = generation;
        checkingFreshness = true;
        try {
            const first = readScope(getScope);
            if (
                generation !== observedGeneration ||
                phase !== 'active' ||
                capturedSession === null
            )
                return false;
            const second = readScope(getScope);
            if (
                generation !== observedGeneration ||
                phase !== 'active' ||
                capturedSession === null
            )
                return false;
            const session = readSession(client.getSession());
            if (
                generation !== observedGeneration ||
                phase !== 'active' ||
                capturedSession === null
            )
                return false;
            const last = readScope(getScope);
            if (
                generation !== observedGeneration ||
                phase !== 'active' ||
                capturedSession === null
            )
                return false;
            if (
                sameScope(first, ownerScope) &&
                sameScope(second, ownerScope) &&
                sameScope(last, ownerScope) &&
                sameSession(session, capturedSession)
            )
                return true;
        } catch {
            // Scope providers are application-owned; an unreadable scope is stale.
        } finally {
            checkingFreshness = false;
        }
        if (phase === 'active' && generation === observedGeneration)
            retire('stale');
        return false;
    };
    const requireCurrent = (expectedGeneration: number) => {
        if (
            !isCurrent() ||
            generation !== expectedGeneration ||
            phase !== 'active'
        )
            throw lifecycleError();
    };
    const requireAttempt = (attempt: Attempt) => {
        attempt.controller.signal.throwIfAborted();
        requireCurrent(attempt.generation);
        if (active !== attempt) throw lifecycleError();
    };
    const issueGrant = (
        token: string,
        type: Grant['type'],
        attempt: Attempt
    ): AuthCredentialGrant => {
        requireString(token, 'Returned encrypted credential');
        requireAttempt(attempt);
        const grant = handle<AuthCredentialGrant>();
        grants.set(grant, { token, type, generation: attempt.generation });
        return grant;
    };
    const run = async <Raw, Result>(
        invalidatePrevious: boolean,
        requestOptions: AuthRequestOptions | undefined,
        invoke: (signal: AbortSignal, session: RuntimeSession) => Promise<Raw>,
        project: (raw: Raw, attempt: Attempt) => Result
    ): Promise<Result> => {
        if (phase !== 'active') throw lifecycleError();
        if (active !== null)
            throw new AuthFlowError(
                'busy',
                'An authentication request is already in progress.'
            );
        requestOptions?.signal?.throwIfAborted();
        const attempt: Attempt = {
            controller: new AbortController(),
            generation,
            dispatched: false,
        };
        active = attempt;
        const externalSignal = requestOptions?.signal;
        const forwardAbort = () => retire('cancelled', externalSignal?.reason);
        externalSignal?.addEventListener('abort', forwardAbort, { once: true });
        try {
            if (externalSignal?.aborted) forwardAbort();
            requireAttempt(attempt);
            if (invalidatePrevious) {
                generation += 1;
                attempt.generation = generation;
                releaseHandles();
            } else {
                // Explicit confirmation may retry its current challenge after an API rejection.
                grants = new WeakMap();
            }
            requireAttempt(attempt);
            const session = { ...capturedSession! };
            attempt.dispatched = true;
            const raw = await invoke(attempt.controller.signal, session);
            requireAttempt(attempt);
            const result = project(raw, attempt);
            requireAttempt(attempt);
            return result;
        } catch (error) {
            if (attempt.controller.signal.aborted)
                throw attempt.controller.signal.reason ?? error;
            if (
                phase !== 'active' ||
                generation !== attempt.generation ||
                active !== attempt
            )
                throw lifecycleError();
            requireAttempt(attempt);
            // A completed API rejection can be shown and corrected explicitly. Other
            // failures may hide server effects (such as OTP delivery or sign-up).
            if (
                attempt.dispatched &&
                !(error instanceof SDKError && error.kind === 'api')
            )
                retire('uncertain', error);
            throw error;
        } finally {
            externalSignal?.removeEventListener('abort', forwardAbort);
            if (active === attempt) active = null;
        }
    };

    const common = {
        isCurrent,
        applySession: (grant: AuthCredentialGrant): RuntimeSession => {
            if (active !== null)
                throw new AuthFlowError(
                    'busy',
                    'An authentication request is already in progress.'
                );
            requireCurrent(generation);
            const credential = isObject(grant) ? grants.get(grant) : undefined;
            if (
                credential === undefined ||
                credential.generation !== generation
            ) {
                throw new AuthFlowError(
                    'invalid-grant',
                    'This credential grant does not belong to the current flow.'
                );
            }
            const session = capturedSession!;
            const next =
                credential.type === 'password'
                    ? withExtensionPassword(session, {
                          extensionId: metadata.extensionId,
                          encryptedExtensionPassword: credential.token,
                      })
                    : withLoginToken(session, {
                          extensionId: metadata.extensionId,
                          tableId: (
                              metadata as Extract<
                                  Metadata,
                                  { screen: 'login_page' }
                              >
                          ).tableId,
                          loginFieldNames: (
                              metadata as Extract<
                                  Metadata,
                                  { screen: 'login_page' }
                              >
                          ).loginFieldNames,
                          encryptedLoginToken: credential.token,
                      });
            // One use, even when a custom client's synchronous setter reenters.
            grants.delete(grant);
            retire('applied');
            client.setSession(next);
            return { ...next };
        },
        cancel: () => {
            if (phase === 'active') retire('cancelled');
        },
        destroy: () => {
            if (phase !== 'disposed') retire('disposed');
        },
    };

    if (metadata.screen === 'password') {
        return Object.freeze({
            ...common,
            screen: 'password' as const,
            verifyPassword: async (input, requestOptions) => {
                if (typeof input?.extensionPassword !== 'string')
                    throw new TypeError(
                        'An extension password string is required.'
                    );
                const extensionPassword = input.extensionPassword;
                return run(
                    true,
                    requestOptions,
                    (signal, session) =>
                        client.auth.verifyExtensionPassword(
                            {
                                extensionId: metadata.extensionId,
                                extensionPassword,
                            },
                            { signal, session }
                        ),
                    (raw, attempt) => {
                        if (!isObject(raw))
                            throw new TypeError(
                                'The password result is malformed.'
                            );
                        if (raw.type === 'wrong' || raw.type === 'blocked')
                            return { type: raw.type };
                        if (raw.type !== 'correct')
                            throw new TypeError(
                                'The password result is malformed.'
                            );
                        return {
                            type: 'correct',
                            grant: issueGrant(
                                raw.encryptedExtensionPassword,
                                'password',
                                attempt
                            ),
                        };
                    }
                );
            },
        } satisfies PasswordAuthFlow);
    }
    return Object.freeze({
        ...common,
        screen: 'login_page' as const,
        login: async (input, requestOptions) => {
            const loginCredentials = copyCredentials(input?.loginCredentials);
            const optional = {
                ...(input.loginRecordId === undefined
                    ? {}
                    : {
                          loginRecordId: requireString(
                              input.loginRecordId,
                              'Login record ID'
                          ),
                      }),
                ...(input.fallbackPhoneVerificationNumber === undefined
                    ? {}
                    : {
                          fallbackPhoneVerificationNumber:
                              input.fallbackPhoneVerificationNumber,
                      }),
            };
            if (
                optional.fallbackPhoneVerificationNumber !== undefined &&
                typeof optional.fallbackPhoneVerificationNumber !== 'string'
            )
                throw new TypeError(
                    'The fallback phone verification number must be a string.'
                );
            return run(
                true,
                requestOptions,
                (signal, session) =>
                    client.auth.login(
                        {
                            extensionId: metadata.extensionId,
                            loginCredentials,
                            ...optional,
                        },
                        { signal, session }
                    ),
                (raw, attempt) => {
                    if (!isObject(raw))
                        throw new TypeError('The login result is malformed.');
                    if (raw.type === 'no-record') return { type: 'no-record' };
                    if (raw.type === 'found-record')
                        return {
                            type: 'found-record',
                            grant: issueGrant(
                                raw.encryptedLoginToken,
                                'login',
                                attempt
                            ),
                        };
                    if (
                        raw.type !== 'verification-message-sent' ||
                        typeof raw.emailOrPhoneNumber !== 'string' ||
                        (raw.verificationType !== 'email' &&
                            raw.verificationType !== 'phoneNumber')
                    )
                        throw new TypeError('The login result is malformed.');
                    const verificationId = requireString(
                        raw.verificationId,
                        'Returned verification ID'
                    );
                    requireAttempt(attempt);
                    const challenge = handle<AuthVerificationChallenge>();
                    challenges.set(challenge, {
                        verificationId,
                        generation: attempt.generation,
                    });
                    return {
                        type: 'verification-message-sent',
                        challenge,
                        emailOrPhoneNumber: raw.emailOrPhoneNumber,
                        verificationType: raw.verificationType,
                    };
                }
            );
        },
        confirmVerificationCode: async (input, requestOptions) => {
            requireCurrent(generation);
            if (typeof input?.verificationCode !== 'string')
                throw new TypeError('A verification code string is required.');
            const challengeHandle = input.challenge;
            const challenge = isObject(challengeHandle)
                ? challenges.get(challengeHandle)
                : undefined;
            if (challenge === undefined || challenge.generation !== generation)
                throw new AuthFlowError(
                    'invalid-challenge',
                    'This verification challenge does not belong to the current flow.'
                );
            const verificationCode = input.verificationCode;
            return run(
                false,
                requestOptions,
                (signal, session) =>
                    client.auth.confirmVerificationCode(
                        {
                            verificationId: challenge.verificationId,
                            verificationCode,
                            language: metadata.language,
                        },
                        { signal, session }
                    ),
                (raw, attempt) => {
                    if (!isObject(raw))
                        throw new TypeError(
                            'The verification result is malformed.'
                        );
                    const grant = issueGrant(
                        raw.encryptedLoginToken,
                        'login',
                        attempt
                    );
                    challenges.delete(challengeHandle);
                    return grant;
                }
            );
        },
        signUp: async (input, requestOptions) => {
            const signUpCredentials = copyCredentials(input?.signUpCredentials);
            return run(
                true,
                requestOptions,
                (signal, session) =>
                    client.auth.signUp(
                        {
                            extensionId: metadata.extensionId,
                            signUpCredentials,
                        },
                        { signal, session }
                    ),
                (raw) => {
                    if (!isObject(raw) || typeof raw.ok !== 'boolean')
                        throw new TypeError('The sign-up result is malformed.');
                    return { ok: raw.ok };
                }
            );
        },
    } satisfies LoginAuthFlow);
}
