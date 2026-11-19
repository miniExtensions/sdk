import type { FormSaveLifecycle } from './controller.js';

// Internal page admission only. The public lifecycle/current contracts stay
// unchanged, and response acceptance never rechecks a wall-clock rule.
const admissions = new WeakMap<
    FormSaveLifecycle,
    { admission(): void; finalAdmission?(): void }
>();

export const withFormSaveAdmission = (
    lifecycle: FormSaveLifecycle,
    admission: () => void,
    finalAdmission?: () => void
): FormSaveLifecycle => {
    admissions.set(lifecycle, { admission, finalAdmission });
    return lifecycle;
};

export const requireFormSaveAdmission = (lifecycle?: FormSaveLifecycle) => {
    if (lifecycle) admissions.get(lifecycle)?.admission();
};

/** Recheck page-specific state that can change during the final scope read. */
export const requireFinalFormSaveAdmission = (
    lifecycle?: FormSaveLifecycle
) => {
    if (lifecycle) admissions.get(lifecycle)?.finalAdmission?.();
};
