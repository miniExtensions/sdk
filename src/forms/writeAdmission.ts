// Internal conditional native handoff only. Public write signatures are unchanged.
const admissions = new WeakMap<() => void, () => boolean>();
export function withFormWriteAdmission(
    afterCommit: () => void,
    admission: () => boolean
): () => void {
    admissions.set(afterCommit, admission);
    return afterCommit;
}
export function admitsFormWrite(afterCommit?: () => void): boolean {
    return afterCommit ? (admissions.get(afterCommit)?.() ?? true) : true;
}
