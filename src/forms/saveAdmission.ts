import type { FormSaveLifecycle } from './controller.js';

// Internal page admission only. The public lifecycle/current contracts stay
// unchanged, and response acceptance never rechecks a wall-clock rule.
const admissions = new WeakMap<FormSaveLifecycle, () => void>();

export const withFormSaveAdmission = (
    lifecycle: FormSaveLifecycle,
    admission: () => void
): FormSaveLifecycle => {
    admissions.set(lifecycle, admission);
    return lifecycle;
};

export const requireFormSaveAdmission = (lifecycle?: FormSaveLifecycle) => {
    if (lifecycle) admissions.get(lifecycle)?.();
};
