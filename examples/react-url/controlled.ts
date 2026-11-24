import {
    createElement as h,
    useState,
    type FormEvent,
    type MouseEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { UrlField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/url-field.css';

type RecordId = 'a' | 'b';
const destination = new URL('/url-destination', location.origin).href;
const initial = { a: destination, b: 'https://example.test/record-b' };

function App() {
    const [record, setRecord] = useState<RecordId>('a');
    const [values, setValues] = useState(initial);
    const [writes, setWrites] = useState<string[]>([]);
    const [submits, setSubmits] = useState(0);
    return h(
        'form',
        {
            id: 'controlled-form',
            onSubmit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                setSubmits((count) => count + 1);
            },
        },
        h(
            'button',
            {
                type: 'button',
                onMouseDown: (event: MouseEvent<HTMLButtonElement>) =>
                    event.preventDefault(),
                onClick: () => setRecord('b'),
            },
            'Show record B'
        ),
        h(UrlField, {
            mode: 'controlled',
            id: 'controlled-url',
            form: 'controlled-form',
            title: 'Controlled website',
            value: values[record],
            enableInlineEdit: true,
            owner: { token: record, isCurrent: () => true },
            onChange(value) {
                setWrites((items) => [...items, record + ': ' + value]);
                setValues((current) => ({ ...current, [record]: value }));
            },
        }),
        h('button', { type: 'button' }, 'After URL'),
        h('output', { id: 'controlled-writes' }, JSON.stringify(writes)),
        h('output', { id: 'controlled-submits' }, submits)
    );
}

createRoot(document.getElementById('app')!).render(h(App));
