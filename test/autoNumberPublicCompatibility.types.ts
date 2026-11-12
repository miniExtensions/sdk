import { createElement as h } from 'react';
import type { FormFieldBinding } from '../src/forms/index.js';
import {
    AutoNumberField,
    BindingAutoNumberField,
    type AutoNumberBindingProps,
    type AutoNumberControlledProps,
    type AutoNumberFieldProps,
    type FieldRenderState,
} from '../src/react/index.js';

/** Positive public contracts; intentionally blocked until the real barrel is composed. */
export function autoNumberPublicCompatibilityContracts(
    binding: FormFieldBinding
) {
    const legacy: AutoNumberFieldProps = { binding };
    const explicit: AutoNumberBindingProps = { ...legacy, mode: 'binding' };
    const controlled: AutoNumberControlledProps = {
        mode: 'controlled',
        value: '0',
        language: 'en',
    };

    h(BindingAutoNumberField, legacy);
    h(AutoNumberField, legacy);
    h(AutoNumberField, { binding, mode: 'binding' });
    h(AutoNumberField, explicit);
    h(AutoNumberField, controlled);
    h(AutoNumberField, {
        ...legacy,
        render: ({ snapshot }: FieldRenderState) =>
            h('span', null, String(snapshot.value ?? '')),
    });

    return { legacy, explicit, controlled };
}
