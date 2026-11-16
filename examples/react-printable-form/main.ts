import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrintableForm } from '@miniextensions/sdk/react';
import {
    captureReadonlyPrintDocument,
    getDocumentPrintableFormAdmission,
    type PrintableFormSource,
    type ReadonlyPrintDocument,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/printable-form.css';

const owner = Object.freeze({});
const revision = Object.freeze({});
const keyboardLease = Object.freeze({});
const document: ReadonlyPrintDocument = {
    language: 'en',
    title: 'Printable Form — synthetic acceptance',
    fields: [
        {
            key: 'name',
            fieldName: 'Name',
            title: 'Name',
            semanticTitle: 'Name',
            showTitle: true,
            required: true,
            sameRow: false,
            enableSideBySideOnMobile: false,
            description: {
                html: '<p>Complete configured-order document.</p>',
                imageUrl: null,
                placement: 'top',
                truncate: false,
            },
            facet: {
                kind: 'text',
                value: 'Synthetic Person',
                emptyLabel: 'No value',
            },
        },
        {
            key: 'masked',
            fieldName: 'Password',
            title: 'Password',
            semanticTitle: 'Password',
            showTitle: true,
            required: false,
            sameRow: false,
            enableSideBySideOnMobile: false,
            facet: { kind: 'text', value: '••••••••', emptyLabel: 'No value' },
        },
        {
            key: 'selection',
            fieldName: 'Selections',
            title: 'Selections',
            semanticTitle: 'Selections',
            showTitle: true,
            required: false,
            sameRow: false,
            enableSideBySideOnMobile: false,
            facet: {
                kind: 'pills',
                items: [
                    {
                        label: 'Second display label',
                        color: '#111827',
                        backgroundColor: '#ddd6fe',
                    },
                    {
                        label: 'First display label',
                        color: '#111827',
                        backgroundColor: '#bfdbfe',
                    },
                ],
                emptyLabel: 'No selection',
            },
        },
        ...Array.from({ length: 24 }, (_, index) => ({
            key: `paragraph-${index}`,
            fieldName: `Paragraph ${index + 1}`,
            title: `Paragraph ${index + 1}`,
            semanticTitle: `Paragraph ${index + 1}`,
            showTitle: true,
            required: false,
            sameRow: false,
            enableSideBySideOnMobile: false,
            facet: {
                kind: 'markdown' as const,
                value: '**Synthetic print content.** All configured fields remain in order across print pages.\n\nA second paragraph preserves spacing and long document pagination.',
                emptyLabel: 'No value',
            },
        })),
    ],
};
const source: PrintableFormSource = {
    readAuthority: () => ({
        scope: { owner, revision },
        explicitAllowed: true,
        keyboardAllowed: true,
        keyboardLease,
    }),
    isCurrent: (expected) =>
        expected.owner === owner && expected.revision === revision,
    capture: () => captureReadonlyPrintDocument(document),
};
const admission = getDocumentPrintableFormAdmission(globalThis.document);
admission.setKeyboardOwner(null, keyboardLease);
const container = globalThis.document.getElementById('root');
if (!container) throw new Error('Example root missing');
createRoot(container).render(
    h(
        StrictMode,
        null,
        h('h1', null, 'Printable Form — synthetic acceptance'),
        h(
            'p',
            null,
            'Print the complete readonly document, inspect preview and cancel the dialog. Then acknowledge that the dialog has closed. This example contains synthetic data only.'
        ),
        h(PrintableForm, {
            source,
            admission,
            labels: {
                print: 'Print document',
                preparing: 'Preparing document…',
                cancel: 'Cancel preparation',
                invoked: 'Browser print method called.',
                unknown: 'Print status is unknown.',
                failed: 'The document could not be prepared.',
                done: 'I have closed the print dialog',
            },
        })
    )
);
