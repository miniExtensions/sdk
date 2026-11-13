import { createElement as h, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AirtableFieldType } from '@miniextensions/sdk';
import type { AirtableField } from '@miniextensions/sdk/formulas';
import type { FormDisplaySource } from '@miniextensions/sdk/forms';
import {
    CompleteFormHeader,
    CompleteFormCover,
    CompleteFormFooterDescription,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-header.css';
import '@miniextensions/sdk/react/html-description.css';
import './styles.css';

const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="216" viewBox="0 0 900 216"><rect width="900" height="216" fill="#c7ddd1"/><circle cx="690" cy="30" r="180" fill="#86b8a2"/><path d="M0 180L270 45L520 216H0Z" fill="#347b68"/><path d="M270 216L540 70L900 216Z" fill="#e6f0de"/></svg>')}`;
const logo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="208" height="48" viewBox="0 0 208 48"><rect width="48" height="48" rx="12" fill="#1c6756"/><path d="M12 29L24 13L36 29H29V37H19V29Z" fill="white"/><text x="62" y="31" font-family="sans-serif" font-size="22" fill="#164e43">Fieldnotes</text></svg>')}`;
const field: AirtableField = {
    id: 'fld_header_demo',
    name: 'Project summary',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
};
const details = [
    '<p>Small observations lead to better projects. Share what you noticed, what surprised you, and where you would like to go next.</p>',
    '<p><strong>Before you begin</strong>, take a moment to review your notes. Every detail helps the team see the complete picture.</p>',
    '<p>This description belongs to the current record. Its disclosure resets as you move between records, even when the text remains the same.</p>',
    '<p>Use the controls to compare static text, accepted field values, a missing field, and a valid blank field. In preview, blank fields keep their named source placeholder.</p>',
    '<p>Public consumers receive the same complete presentation without builder actions. Selected content still passes through the shared safe HTML renderer.</p>',
    '<p>Thanks for making space for thoughtful work.</p>',
].join('');
type Mode = 'static' | 'field' | 'missing' | 'blank' | 'none';
function source(mode: Mode, text: string): FormDisplaySource {
    switch (mode) {
        case 'none':
            return { type: 'none' };
        case 'static':
            return { type: 'static', value: text };
        case 'missing':
            return { type: 'field', field: { status: 'missing' } };
        case 'blank':
            return {
                type: 'field',
                field: { status: 'resolved', field, value: '' },
            };
        case 'field':
            return {
                type: 'field',
                field: { status: 'resolved', field, value: text },
            };
    }
}
function App() {
    const [mode, setMode] = useState<Mode>('field');
    const [record, setRecord] = useState<'A' | 'B'>('A');
    const [child, setChild] = useState(false);
    const [enabled, setEnabled] = useState(true);
    const [truncate, setTruncate] = useState(true);
    const [preview, setPreview] = useState(false);
    const [media, setMedia] = useState(false);
    const [events, setEvents] = useState<string[]>([]);
    const [title, setTitle] = useState('A new perspective');
    const identity = {
        owner: 'standalone-demo',
        configuration: JSON.stringify({
            mode,
            child,
            enabled,
            truncate,
            preview,
            media,
        }),
        record: `projects:${record}`,
    };
    const capability = preview
        ? {
              showPlaceholders: true,
              showFieldSources: true,
              onOpenSettings: (target: string) =>
                  setEvents((items) => [...items, target]),
          }
        : undefined;
    const description = source(
        mode,
        media ? `<p><img src="${image}" alt="" /></p>` : details
    );
    const checkbox = (label: string, checked: boolean, toggle: () => void) =>
        h(
            'label',
            null,
            h('input', { type: 'checkbox', checked, onChange: toggle }),
            label
        );
    return h(
        'main',
        null,
        h(
            'div',
            { className: 'introduction' },
            h('p', { className: 'eyebrow' }, 'miniExtensions SDK'),
            h('h1', null, 'A welcoming start. A thoughtful finish.'),
            h(
                'p',
                null,
                'Explore the complete Form header, cover, and footer using local sample content.'
            )
        ),
        h(
            'section',
            { className: 'controls', 'aria-label': 'Presentation settings' },
            h(
                'label',
                null,
                'Source',
                h(
                    'select',
                    {
                        value: mode,
                        onChange: (
                            event: import('react').ChangeEvent<HTMLSelectElement>
                        ) => {
                            const value = event.currentTarget.value;
                            if (
                                value === 'static' ||
                                value === 'field' ||
                                value === 'missing' ||
                                value === 'blank' ||
                                value === 'none'
                            )
                                setMode(value);
                        },
                    },
                    ...(
                        ['static', 'field', 'missing', 'blank', 'none'] as const
                    ).map((value) => h('option', { key: value, value }, value))
                )
            ),
            h(
                'div',
                {
                    className: 'records',
                    role: 'group',
                    'aria-label': 'Current record',
                },
                ...(['A', 'B'] as const).map((value) =>
                    h(
                        'button',
                        {
                            key: value,
                            type: 'button',
                            'aria-pressed': record === value,
                            onClick: () => setRecord(value),
                        },
                        `Record ${value}`
                    )
                )
            ),
            checkbox('Child Form', child, () => setChild(!child)),
            checkbox('Enable description and footer', enabled, () =>
                setEnabled(!enabled)
            ),
            checkbox('Truncate description', truncate, () =>
                setTruncate(!truncate)
            ),
            checkbox('Config preview', preview, () => setPreview(!preview)),
            checkbox('Media-only description', media, () => setMedia(!media)),
            h(
                'label',
                { className: 'title-control' },
                'Current title',
                h('input', {
                    type: 'text',
                    value: title,
                    onChange: (
                        event: import('react').ChangeEvent<HTMLInputElement>
                    ) => setTitle(event.currentTarget.value),
                })
            )
        ),
        h(
            'article',
            { className: 'form-preview', 'aria-label': 'Form presentation' },
            h(CompleteFormCover, {
                identity,
                src: image,
                isChildForm: child,
                preview: capability,
                testId: 'example-cover',
            }),
            h(
                'div',
                {
                    className: child
                        ? 'form-content'
                        : 'form-content form-content--covered',
                },
                h(CompleteFormHeader, {
                    identity,
                    title: source(mode, `${title} · Record ${record}`),
                    extensionName: 'Project fieldnotes',
                    logo: { type: 'static', value: logo },
                    description: { enabled, source: description, truncate },
                    isChildForm: child,
                    language: 'en',
                    preview: capability,
                    testId: 'example-header',
                }),
                h(
                    'section',
                    { className: 'sample-field' },
                    h('label', { htmlFor: 'observation' }, 'Your observation'),
                    h('textarea', {
                        id: 'observation',
                        placeholder: 'What did you notice?',
                        rows: 4,
                    })
                ),
                h(CompleteFormFooterDescription, {
                    identity,
                    enabled,
                    source: source(
                        mode,
                        '<p>Thank you for sharing your perspective. <strong>Your observations matter.</strong></p>'
                    ),
                    preview: capability,
                })
            )
        ),
        h(
            'section',
            { className: 'events', 'aria-label': 'Preview commands' },
            h('h2', null, 'Preview commands'),
            h(
                'p',
                null,
                'Optional settings commands appear here. Public mode has no builder capabilities.'
            ),
            h(
                'output',
                { 'aria-live': 'polite' },
                events.length ? events.join(' → ') : 'No commands'
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
