/** Conservative presentation policy; never changes native Form or Save values. */
export const hasMaskedValuePolicy = (config: unknown): boolean => {
    if (config === undefined || config === null) return false;
    if (typeof config !== 'object' || Array.isArray(config)) return true;
    for (const key of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
        const value = (config as Record<string, unknown>)[key];
        if (value !== undefined && value !== false) return true;
    }
    return false;
};
