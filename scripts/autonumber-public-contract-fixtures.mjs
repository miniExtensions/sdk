/**
 * Actual installed-package positive contracts for the canonical export.
 * Compiled from the actual packed React export; no replacement export is supplied.
 */
export const autoNumberPublicCompatibilityTypedConsumer = String.raw`import { createElement } from 'react';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
import {
    AutoNumberField,
    BindingAutoNumberField,
    type AutoNumberBindingProps,
    type AutoNumberControlledProps,
    type AutoNumberFieldProps,
    type FieldRenderState,
} from '@miniextensions/sdk/react';

declare const binding: FormFieldBinding;
const legacy: AutoNumberFieldProps = { binding };
const explicit: AutoNumberBindingProps = { binding, mode: 'binding' };
const controlled: AutoNumberControlledProps = {
    mode: 'controlled', value: '0', language: 'en',
};

createElement(BindingAutoNumberField, legacy);
createElement(AutoNumberField, legacy);
createElement(AutoNumberField, { binding, mode: 'binding' });
createElement(AutoNumberField, explicit);
createElement(AutoNumberField, controlled);
createElement(AutoNumberField, {
    ...legacy,
    render: ({ snapshot }: FieldRenderState) =>
        createElement('span', null, String(snapshot.value ?? '')),
});
`;
