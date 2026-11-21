import type {
    PostgresCopyPlanningConfig,
    PostgresCopyFieldValueDraft,
    PostgresCopyFieldValuePlan,
    PostgresNativeDraft,
} from '../src/runtime/index.js';
export const copyMapping: PostgresCopyPlanningConfig = {
    fieldsToCopy: ['source'],
    destinationFields: ['destination'],
};
export const copyDraftTag: PostgresCopyFieldValueDraft['type'] =
    'BULK_COPY_FIELD_VALUE';
export const copyExecutionAdmission: PostgresCopyFieldValuePlan['executionAdmission'] =
    'pending';
export const copyNativeArm: Extract<
    PostgresNativeDraft,
    { type: 'BULK_COPY_FIELD_VALUE' }
>['state']['mapping'] = copyMapping;
// @ts-expect-error Private read planning cannot enable execution.
export const unsafeCopyExecution: PostgresCopyFieldValuePlan['executionAdmission'] =
    'enabled';
export const forbiddenCopyPolicy: PostgresCopyPlanningConfig = {
    fieldsToCopy: ['source'],
    destinationFields: ['destination'],
    // @ts-expect-error Exact native copying is fixed; callers cannot opt into skip-empty behavior.
    skipEmpty: true,
};
// @ts-expect-error Native Copy uses its existing extension type, never Form.
export const wrongCopyType: PostgresCopyFieldValueDraft['type'] = 'FORM';

export const copyExactValuePolicy: PostgresCopyFieldValuePlan['valuePolicy'] =
    'exact-native-values';
export const copyOptionalIdentifier: PostgresCopyFieldValueDraft['state']['identifier'] =
    undefined;
// @ts-expect-error Native Copy cannot inherit Airtable skip-empty semantics.
export const wrongCopyValuePolicy: PostgresCopyFieldValuePlan['valuePolicy'] =
    'skip-empty';
