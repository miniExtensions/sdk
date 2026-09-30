import type { RuntimeSession } from './types.js';

/** Return a new session; the caller chooses when and where to persist it. */
export const withExtensionPassword = (
    session: Readonly<RuntimeSession>,
    credential: { extensionId: string; encryptedExtensionPassword: string }
): RuntimeSession => ({
    ...session,
    [`miniExtb7BuZl-${credential.extensionId}`]:
        credential.encryptedExtensionPassword,
});

const base64Alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const encodeBase64Utf8 = (value: string): string => {
    const bytes = new TextEncoder().encode(value);
    let encoded = '';
    for (let index = 0; index < bytes.length; index += 3) {
        const first = bytes[index];
        const second = bytes[index + 1];
        const third = bytes[index + 2];
        encoded += base64Alphabet[first >> 2];
        encoded += base64Alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
        encoded +=
            second == null
                ? '='
                : base64Alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
        encoded += third == null ? '=' : base64Alphabet[third & 63];
    }
    return encoded;
};

/** Supply table ID and login field names from the loaded login-page payload. */
export const withLoginToken = (
    session: Readonly<RuntimeSession>,
    credential: {
        extensionId: string;
        tableId: string;
        loginFieldNames: readonly string[];
        encryptedLoginToken: string;
    }
): RuntimeSession => {
    const sortedFieldNames = [...credential.loginFieldNames].sort();
    const key = encodeURIComponent(
        encodeBase64Utf8(
            sortedFieldNames.join('') +
                credential.tableId +
                credential.extensionId
        )
    );
    return { ...session, [key]: credential.encryptedLoginToken };
};
