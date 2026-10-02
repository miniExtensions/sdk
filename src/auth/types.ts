import type {
    LoginInput,
    LoginPageResult,
    MiniExtensionsClient,
    PasswordRequiredResult,
    RuntimeSession,
    SignUpInput,
    SignUpResult,
    VerifyExtensionPasswordInput,
} from '../runtime/types.js';

declare const grantBrand: unique symbol;
declare const challengeBrand: unique symbol;

/** Flow-owned identity only; encrypted credentials are never object properties. */
export type AuthCredentialGrant = { readonly [grantBrand]: true };
/** Flow-owned identity only; verification IDs and entered codes are not exposed. */
export type AuthVerificationChallenge = { readonly [challengeBrand]: true };

/** Advance revision on visitor, connection, loaded page or session transitions. */
export type AuthOwnerScope = { ownerId: string; revision: number };
export type AuthPage = PasswordRequiredResult | LoginPageResult;
export type AuthFlowOptions<Page extends AuthPage = AuthPage> = {
    client: MiniExtensionsClient;
    page: Page;
    getScope(): AuthOwnerScope;
};
export type AuthRequestOptions = { signal?: AbortSignal };

export type AuthPasswordResult =
    | { type: 'correct'; grant: AuthCredentialGrant }
    | { type: 'wrong' }
    | { type: 'blocked' };
export type AuthLoginResult =
    | { type: 'found-record'; grant: AuthCredentialGrant }
    | { type: 'no-record' }
    | {
          type: 'verification-message-sent';
          challenge: AuthVerificationChallenge;
          emailOrPhoneNumber: string;
          verificationType: 'email' | 'phoneNumber';
      };

export type AuthFlowErrorCode =
    | 'scope-changed'
    | 'busy'
    | 'invalid-grant'
    | 'invalid-challenge'
    | 'cancelled'
    | 'disposed'
    | 'reload-required';

export type AuthFlowBase = {
    /** Freshness guard for application-owned rendering after an await. */
    isCurrent(): boolean;
    /** Explicit, one-use application; then retire this flow and reload separately. */
    applySession(grant: AuthCredentialGrant): RuntimeSession;
    /** Does not undo message delivery, account creation or another server effect. */
    cancel(): void;
    destroy(): void;
};
export type PasswordAuthFlow = AuthFlowBase & {
    readonly screen: 'password';
    verifyPassword(
        input: Omit<VerifyExtensionPasswordInput, 'extensionId'>,
        options?: AuthRequestOptions
    ): Promise<AuthPasswordResult>;
};
export type LoginAuthFlow = AuthFlowBase & {
    readonly screen: 'login_page';
    login(
        input: Omit<LoginInput, 'extensionId'>,
        options?: AuthRequestOptions
    ): Promise<AuthLoginResult>;
    confirmVerificationCode(
        input: {
            challenge: AuthVerificationChallenge;
            verificationCode: string;
        },
        options?: AuthRequestOptions
    ): Promise<AuthCredentialGrant>;
    signUp(
        input: Omit<SignUpInput, 'extensionId'>,
        options?: AuthRequestOptions
    ): Promise<SignUpResult>;
};
export type AuthFlow = PasswordAuthFlow | LoginAuthFlow;
