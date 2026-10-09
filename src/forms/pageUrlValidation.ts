import emailValidator from 'email-validator';

const literalControlCharacterPattern = /[\u0000-\u001f\u007f]/;
const encodedControlCharacterPattern = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const explicitSchemePattern = /^[a-z][a-z\d+.-]*:/i;
const httpSchemePattern = /^https?:\/\//i;
const mailtoSchemePattern = /^mailto:/i;
const bareHostWithPortPattern = /^[^/?#]+:\d+(?:[/?#]|$)/;

const hasValidHostname = (hostname: string): boolean => {
    const normalizedHostname = hostname.endsWith('.')
        ? hostname.slice(0, -1)
        : hostname;
    const labels = normalizedHostname.split('.');

    if (
        normalizedHostname.length === 0 ||
        normalizedHostname.length > 253 ||
        labels.length < 2
    ) {
        return false;
    }

    if (labels.every((label) => /^\d+$/.test(label))) {
        return (
            labels.length === 4 &&
            labels.every((label) => {
                const value = Number(label);
                return value >= 0 && value <= 255;
            })
        );
    }

    return labels.every(
        (label) =>
            label.length > 0 &&
            label.length <= 63 &&
            /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    );
};

const hasUnsafeUrlText = (url: string): boolean =>
    url.length === 0 ||
    /\s/.test(url) ||
    url.includes('\\') ||
    literalControlCharacterPattern.test(url) ||
    encodedControlCharacterPattern.test(url);

/**
 * Returns the exact href supported by Form URL fields, or null when the value
 * is not safe to activate. Bare hosts retain their historical HTTPS default.
 */
const getValidUrlHref = (url: string): string | null => {
    if (hasUnsafeUrlText(url)) return null;

    const hasExplicitScheme = explicitSchemePattern.test(url);
    const isHttpUrl = httpSchemePattern.test(url);
    const isMailtoUrl = mailtoSchemePattern.test(url);
    const isBareHostWithPort = bareHostWithPortPattern.test(url);

    if (
        hasExplicitScheme &&
        !isHttpUrl &&
        !isMailtoUrl &&
        !isBareHostWithPort
    ) {
        return null;
    }

    const candidate = isHttpUrl || isMailtoUrl ? url : `https://${url}`;

    try {
        const parsedUrl = new URL(candidate);

        if (parsedUrl.protocol === 'mailto:') {
            if (!isMailtoUrl || /^mailto:\/\//i.test(url)) return null;

            const recipients = decodeURIComponent(parsedUrl.pathname).split(
                ','
            );
            if (
                recipients.length === 0 ||
                recipients.some(
                    (recipient) =>
                        recipient.length === 0 ||
                        !emailValidator.validate(recipient)
                )
            ) {
                return null;
            }

            return candidate;
        }

        if (
            (parsedUrl.protocol !== 'http:' &&
                parsedUrl.protocol !== 'https:') ||
            parsedUrl.username !== '' ||
            parsedUrl.password !== '' ||
            !hasValidHostname(parsedUrl.hostname)
        ) {
            return null;
        }

        return candidate;
    } catch {
        return null;
    }
};

// Internal page admission only; never replace the native answer with an href.
export const checkIfPageUrlIsValid = (value: string): boolean =>
    getValidUrlHref(value) != null;
