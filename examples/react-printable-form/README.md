# Printable Form consumer

This external-style consumer imports only public SDK exports and CSS. It owns a
synthetic admitted display snapshot and explicitly designates its keyboard lease.
The SDK owns the actual renderer, async preparation, print frame and job controls.

After building the SDK, run `node examples/react-printable-form/dev.mjs` using the
repository's normal resource guard. The default localhost port is 4200. A packed
consumer can use these same files after its normal dependency-policy admission.

Inspect the actual Chrome print preview, page order, styles and Cancel control.
Check the help/value separation, both synthetic images and the heart Rating's
3/5 summary, including the final paragraph on the last page.
After closing the dialog, use the explicit acknowledgement to release the job.
No automated dialog callback proves a printed or cancelled document. This example
contains no live Form, account, token, provider, Save action or customer data.
