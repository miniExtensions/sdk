import { createElement as h, type ComponentProps } from 'react';
import {
    DurationField,
    CompleteDurationField,
    ReadOnlyDurationField,
    type DurationFieldProps,
    type ControlledDurationFieldProps,
} from '../src/react/index.js';

declare const binding: DurationFieldProps['binding'];
const legacy: DurationFieldProps = { binding, clearLabel: 'Clear duration' };
const controlled: ControlledDurationFieldProps = {
    fieldId: 'elapsed',
    sessionId: 'native',
    value: 0,
    format: 'h:mm:ss.SSS',
    owner: { token: {}, isCurrent: () => true },
    onChange() {},
};
h(DurationField, legacy);
h(DurationField, controlled);
h(CompleteDurationField, controlled);
const inferred: ComponentProps<typeof DurationField> = controlled;
h(DurationField, inferred);
h(ReadOnlyDurationField, { value: 0, format: 'h:mm', language: 'en' });
// @ts-expect-error controlled editing requires genuine native authority
h(DurationField, {
    value: 0,
    format: 'h:mm',
    fieldId: 'elapsed',
    sessionId: 'native',
    onChange() {},
});
// @ts-expect-error binding and controlled authorities cannot be mixed
h(DurationField, { ...controlled, binding });
// @ts-expect-error canonical values are seconds, never display strings
h(DurationField, { ...controlled, value: '1:00' });
h(ReadOnlyDurationField, {
    value: 0,
    format: 'h:mm',
    language: 'en',
    // @ts-expect-error readonly presentation has no canonical writer
    onChange() {},
});
