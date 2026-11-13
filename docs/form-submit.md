# Form terminal action control

`FormSubmitButton` is the terminal Submit/Compute/Review presentation. Import
`@miniextensions/sdk/react/form-submit.css` alongside the public React export.
The host supplies `formId`, localized `label`, `mode` (`save`, `compute` or
`review`), `saving` and `canSubmit`.

The button is a real `type="submit"` associated with the existing host form.
There is deliberately no click callback or second submission path. Keep
validation, custom-label resolution, page routing, review guards, Compute
allocation and persistence in that form's existing submit handler. Validation
errors do not automatically disable the button: only saving and surface
admission do. The host retains conditional visibility and settings controls.

The component has no effects, transport, global reads or render-time mutation.
Its style sheet has no Tailwind dependency or global reset. Primary colors
follow native --theme-600/500 when available, with standalone blue fallbacks;
Compute and Review preserve native gray and green modes.

## Qualification still required

This initial source extraction is not native adoption completion. Source DOM
tests cover associated-form click, literal labels, mode changes, admission,
saving and retry. They are authored, not claimed executed. Actual browser Enter
submission, React 18/19 packed ESM/CJS/types/CSS/SSR, native FormLoaded footer
composition and its existing read-only/review/retry regression suite, and normal
exact-head CI must be verified before marking the task complete. The native
footer must directly import this component while preserving the host label
resolution, form handler and settings wrapper. No native SDK pin is changed
by this patch.
