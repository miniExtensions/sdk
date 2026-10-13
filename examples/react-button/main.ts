import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMiniExtensionsClient } from '@miniextensions/sdk';
import { RecoveryJournal } from '@miniextensions/sdk/forms';
import {
    createButtonFieldModel,
    type ButtonFieldData,
    type ButtonFieldModel,
} from '@miniextensions/sdk/ui';
import {
    ButtonField,
    useButtonField,
    renderButtonField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/button.css';
import './styles.css';

// Owners are created outside React. StrictMode and the Remount control only subscribe.
let requests = 0;
const make = (
    config: ButtonFieldData['config'],
    label: string,
    result = true,
    language: ButtonFieldData['language'] = 'en',
    empty = false
) => {
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            throw Error('This demo must never use the network');
        },
    });
    client.buttons.triggerWebhook = async () => {
        requests++;
        document.querySelector('#requests')!.textContent = String(requests);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return { success: result };
    };
    const data: ButtonFieldData = {
        field: {
            id: 'fld_repeated_button',
            name: 'Action',
            description: null,
            isPrimaryField: false,
            isComputed: true,
            config: { type: 'button', options: null },
        },
        value: empty ? null : { label, url: '/?opened=button' },
        config,
        language,
        source: { type: 'current-record', recordId: `synthetic-${label}` },
        extensionAccessToken: 'synthetic-demo',
        visible: true,
    };
    const model = createButtonFieldModel({
        client,
        adapter: {
            read: () => data,
            isCurrent: () => true,
            configurationRevision: () => 1,
        },
        recovery: {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: label,
                tableId: 'synthetic',
                childExtensionId: 'demo',
                parentFieldId: null,
                context: 'modal',
            },
        },
    });
    return { data, model };
};
const examples = [
    {
        title: 'Open a link',
        detail: 'Native link · new tab',
        ...make({ openLinkType: '_blank' }, 'View project'),
    },
    {
        title: 'Run an action',
        detail: 'Synthetic success · configured feedback',
        ...make(
            {
                openLinkType: 'triggerWebhookPOST',
                buttonColor: 'indigo',
                triggerWebhookSuccessMessage:
                    'Request received. Your project is ready.',
            },
            'Prepare project'
        ),
    },
    {
        title: 'Localized feedback',
        detail: 'French · default success message',
        ...make(
            { openLinkType: 'triggerWebhookGET', buttonColor: 'emerald' },
            'Envoyer',
            true,
            'fr'
        ),
    },
    {
        title: 'Uncertain outcome',
        detail: 'Stays disabled · no automatic retry',
        ...make(
            { openLinkType: 'triggerWebhookPOST', buttonColor: 'rose' },
            'Run once',
            false
        ),
    },
    {
        title: 'Quiet success',
        detail: 'An intentionally empty configured message',
        ...make(
            {
                openLinkType: 'triggerWebhookPOST',
                buttonColor: 'yellow-light',
                triggerWebhookSuccessMessage: '',
            },
            'Confirm'
        ),
    },
    {
        title: 'No value',
        detail: 'Localized, noninteractive empty presentation',
        ...make(undefined, '', true, 'en', true),
    },
];
function OwnedButton({ model }: { model: ButtonFieldModel }) {
    return h(ButtonField, useButtonField(model));
}
function App() {
    const [mount, setMount] = useState(0);
    const [rows, setRows] = useState(0);
    const readonly = examples[0].data;
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h('p', { className: 'eyebrow' }, 'MINIEXTENSIONS / SDK UI'),
            h('h1', null, 'Small button. Clear action.'),
            h(
                'p',
                { className: 'intro' },
                'A compact React renderer with themed controls, accessible states, and behavior owned by the SDK.'
            )
        ),
        h(
            'section',
            { className: 'toolbar', 'aria-label': 'Demo controls' },
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount renderers'
            ),
            h(
                'span',
                null,
                'Synthetic requests: ',
                h('strong', { id: 'requests' }, String(requests))
            ),
            h('span', null, 'Row activations: ', String(rows))
        ),
        h(
            'section',
            { className: 'cards', key: mount },
            ...examples.map(({ title, detail, model }) =>
                h(
                    'article',
                    { key: title, onClick: () => setRows(rows + 1) },
                    h('h2', null, title),
                    h('p', null, detail),
                    h(OwnedButton, { model })
                )
            ),
            h(
                'article',
                null,
                h('h2', null, 'Missing capability'),
                h('p', null, 'Read-only slot · raw URLs grant no action'),
                renderButtonField({
                    physicalKind: 'button',
                    fieldId: readonly.field.id,
                    title: 'Action',
                    field: readonly.field,
                    presentation: {
                        type: 'physical',
                        config: readonly.field.config,
                    },
                    displayConfig: { openLinkType: '_blank' },
                    value: readonly.value,
                    context: 'portal-cell',
                    computed: true,
                    dirty: false,
                    pending: false,
                    validation: [],
                    error: null,
                    capability: { type: 'readonly' },
                })
            )
        ),
        h(
            'footer',
            null,
            'Local synthetic transport only. Remount while an action is pending: it stays with its owner and never dispatches twice.'
        )
    );
}
createRoot(document.querySelector('#app')!).render(h(StrictMode, null, h(App)));
