import type { FormController } from './controller.js';

// Internal conditional native handoff only. Public write signatures are unchanged.
const admissions = new WeakMap<() => void, () => boolean>();
const controllerAdmissions = new WeakMap<FormController, () => boolean>();

export function guardFormControllerMutations(
    controller: FormController,
    admission: () => boolean
): void {
    controllerAdmissions.set(controller, admission);
}

export function admitsFormControllerMutation(
    controller: FormController
): boolean {
    return controllerAdmissions.get(controller)?.() ?? true;
}

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
