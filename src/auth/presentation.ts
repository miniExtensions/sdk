import type {
    LoginInput,
    LoginPageResult,
    LoginResult,
} from '../runtime/index.js';

type LoginField = LoginPageResult['payload']['fieldNamesToSchemas'][string];
type Verification = Extract<LoginResult, { type: 'verification-message-sent' }>;

/** Match the hosted login input's explicit mask and visible password/PIN title. */
export function shouldMaskLoginFieldInput(
    field: LoginField | undefined
): boolean {
    if (field === undefined) return false;
    const config = field.miniExtConfig;
    if (
        config != null &&
        'maskPasswordOnLoginScreen' in config &&
        config.maskPasswordOnLoginScreen === true
    )
        return true;
    const title =
        config != null && 'showTitle' in config && config.showTitle === false
            ? ''
            : typeof config?.title === 'string' &&
                config.title.trim().length > 0
              ? config.title
              : field.airtableField.name;
    return /\b(?:password|pin)\b/i.test(title);
}

/**
 * Present a verification destination using the published login field rules.
 * This changes display text only; retain the original challenge and credentials.
 */
export function getLoginVerificationDestination(
    page: LoginPageResult,
    verification: Pick<Verification, 'verificationType' | 'emailOrPhoneNumber'>,
    options: Pick<LoginInput, 'fallbackPhoneVerificationNumber'> = {}
): string {
    if (options.fallbackPhoneVerificationNumber != null)
        return verification.emailOrPhoneNumber;
    const masked = page.payload.loginFieldNames.some((name) => {
        const config = page.payload.fieldNamesToSchemas[name]?.miniExtConfig;
        if (
            config == null ||
            !('maskPasswordOnLoginScreen' in config) ||
            config.maskPasswordOnLoginScreen !== true
        )
            return false;
        return verification.verificationType === 'email'
            ? 'requireEmailVerificationToLogin' in config &&
                  config.requireEmailVerificationToLogin === true
            : 'requirePhoneNumberVerificationToLogin' in config &&
                  config.requirePhoneNumberVerificationToLogin === true;
    });
    return masked ? '••••••••' : verification.emailOrPhoneNumber;
}
