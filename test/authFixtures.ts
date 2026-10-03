import {
    createMiniExtensionsClient,
    type ConfirmVerificationCodeInput,
    type ConfirmVerificationCodeResult,
    type LoginInput,
    type LoginPageResult,
    type LoginResult,
    type PasswordRequiredResult,
    type RuntimeRequestOptions,
    type SignUpInput,
    type SignUpResult,
    type VerifyExtensionPasswordInput,
    type VerifyExtensionPasswordResult,
} from '../src/runtime/index.js';
import { formResult, publicFormFields } from './runtimeFixtures.js';

export const passwordPage = (): PasswordRequiredResult => ({
    ...structuredClone(formResult),
    extensionScreen: 'password',
    payload: {
        baseId: 'base_example',
        loggedInUserCanEditExtension: false,
        showMiniExtensionsBranding: true,
        onFreePlan: false,
        trialExpiresAtUnixEpoch: null,
    },
});
export const loginPage = (): LoginPageResult => ({
    ...passwordPage(),
    extensionScreen: 'login_page',
    language: 'fr',
    payload: {
        ...passwordPage().payload,
        publicFields: {
            ...publicFormFields(),
            state: {
                ...publicFormFields().state,
                ifRecordDoesNotExist: 'signUp',
            },
        },
        hasParentExtension: false,
        shareId: 'share_example',
        loginFieldNames: ['Émail', 'Password'],
        loginFieldIds: ['field_email', 'field_password'],
        fieldNamesToSchemas: {},
        fieldIdsToSchemas: {},
        tableId: 'table_example',
        prefillFieldNamesToValues: { Émail: 'prefill@example.test' },
        prefillLoginRecordId: 'record_prefill',
    },
});

export type AuthCall =
    | {
          operation: 'password';
          input: VerifyExtensionPasswordInput;
          options?: RuntimeRequestOptions;
      }
    | { operation: 'login'; input: LoginInput; options?: RuntimeRequestOptions }
    | {
          operation: 'confirm';
          input: ConfirmVerificationCodeInput;
          options?: RuntimeRequestOptions;
      }
    | {
          operation: 'signup';
          input: SignUpInput;
          options?: RuntimeRequestOptions;
      };
export type AuthHandlers = {
    password?: (
        call: Extract<AuthCall, { operation: 'password' }>
    ) => Promise<VerifyExtensionPasswordResult>;
    login?: (
        call: Extract<AuthCall, { operation: 'login' }>
    ) => Promise<LoginResult>;
    confirm?: (
        call: Extract<AuthCall, { operation: 'confirm' }>
    ) => Promise<ConfirmVerificationCodeResult>;
    signup?: (
        call: Extract<AuthCall, { operation: 'signup' }>
    ) => Promise<SignUpResult>;
};

/** All auth responses are synthetic and local; unexpected network use fails. */
export const authFixture = (handlers: AuthHandlers = {}) => {
    const calls: AuthCall[] = [];
    const applied: Record<string, string>[] = [];
    let loads = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { previous: 'encrypted_previous' },
        fetch: async () => {
            throw new Error('Unexpected fixture network request.');
        },
    });
    const setSession = client.setSession;
    client.setSession = (session) => {
        applied.push({ ...session });
        setSession(session);
    };
    client.loadExtension = async () => {
        loads += 1;
        return passwordPage();
    };
    client.auth.verifyExtensionPassword = (input, options) => {
        const call = { operation: 'password' as const, input, options };
        calls.push(call);
        return (
            handlers.password?.(call) ??
            Promise.resolve({
                type: 'correct',
                encryptedExtensionPassword: 'encrypted_password_example',
            })
        );
    };
    client.auth.login = (input, options) => {
        const call = { operation: 'login' as const, input, options };
        calls.push(call);
        return (
            handlers.login?.(call) ??
            Promise.resolve({
                type: 'found-record',
                encryptedLoginToken: 'encrypted_login_example',
            })
        );
    };
    client.auth.confirmVerificationCode = (input, options) => {
        const call = { operation: 'confirm' as const, input, options };
        calls.push(call);
        return (
            handlers.confirm?.(call) ??
            Promise.resolve({
                encryptedLoginToken: 'encrypted_confirm_example',
            })
        );
    };
    client.auth.signUp = (input, options) => {
        const call = { operation: 'signup' as const, input, options };
        calls.push(call);
        return handlers.signup?.(call) ?? Promise.resolve({ ok: true });
    };
    return {
        client,
        calls,
        applied,
        get loads() {
            return loads;
        },
    };
};

export const verificationSent = (
    id = 'verification_example'
): Extract<LoginResult, { type: 'verification-message-sent' }> => ({
    type: 'verification-message-sent',
    verificationId: id,
    emailOrPhoneNumber: 'masked@example.test',
    verificationType: 'email',
});

export const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
};
