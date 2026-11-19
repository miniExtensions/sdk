import type { FormSaveLifecycle } from './controller.js';

// Internal page admission only. The public lifecycle/current contracts stay
// unchanged, and response acceptance never rechecks a wall-clock rule.
type FinalAdmission = (requireScope: () => void) => void;

const admissions = new WeakMap<
    FormSaveLifecycle,
    { admission(): void; finalAdmission?: FinalAdmission }
>();

export const withFormSaveAdmission = (
    lifecycle: FormSaveLifecycle,
    admission: () => void,
    finalAdmission?: FinalAdmission
): FormSaveLifecycle => {
    admissions.set(lifecycle, { admission, finalAdmission });
    return lifecycle;
};

export const requireFormSaveAdmission = (lifecycle?: FormSaveLifecycle) => {
    if (lifecycle) admissions.get(lifecycle)?.admission();
};

/** Recheck page-specific state that can change during the final scope read. */
export const requireFinalFormSaveAdmission = (
    lifecycle: FormSaveLifecycle | undefined,
    requireScope: () => void
) => {
    if (lifecycle) admissions.get(lifecycle)?.finalAdmission?.(requireScope);
};
