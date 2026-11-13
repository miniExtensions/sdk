import {
    createElement as h,
    StrictMode,
    useState,
    type FormEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    RollupField,
    type ControlledRollupFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';

// Synthetic already-converted values. Native owners retain conversion/context;
// the public component supplies the complete display without a client or binding.
const states: Array<{ label: string; props: ControlledRollupFieldProps }> = [
    {
        label: 'Text',
        props: {
            mode: 'controlled',
            isValid: true,
            value: 'Alpha',
            language: 'en',
        },
    },
    {
        label: 'Currency',
        props: {
            mode: 'controlled',
            isValid: true,
            value: 'CHF 0.000',
            language: 'en',
        },
    },
    {
        label: 'Invalid',
        props: { mode: 'controlled', isValid: false, language: 'en' },
    },
    {
        label: 'Empty',
        props: {
            mode: 'controlled',
            isValid: true,
            value: null,
            language: 'es',
        },
    },
    {
        label: 'Recovered',
        props: {
            mode: 'controlled',
            isValid: true,
            value: '<b>Literal result</b> https://example.test/result',
            language: 'en',
        },
    },
    {
        label: 'Array',
        props: {
            mode: 'controlled',
            isValid: true,
            value: '0.00, 2.35',
            language: 'en',
        },
    },
    {
        label: 'Host labels',
        props: {
            mode: 'controlled',
            isValid: true,
            value: 'Host mapped label, Existing fallback',
            language: 'en',
        },
    },
];
function App() {
    const [index, setIndex] = useState(0);
    const [rowClicks, setRowClicks] = useState(0);
    const [submits, setSubmits] = useState(0);
    return h(
        'main',
        null,
        h('h1', null, 'Rollup results, completely presented.'),
        h(
            'p',
            null,
            'Synthetic public SDK controlled presentation on localhost.'
        ),
        h(
            'nav',
            { 'aria-label': 'Result states' },
            states.map((state, i) =>
                h(
                    'button',
                    {
                        key: state.label,
                        type: 'button',
                        onClick: () => setIndex(i),
                    },
                    state.label
                )
            )
        ),
        h(
            'form',
            {
                onSubmit: (event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    setSubmits((n) => n + 1);
                },
            },
            h(
                'section',
                {
                    'aria-label': 'Rollup result',
                    onClick: () => setRowClicks((n) => n + 1),
                },
                h(RollupField, {
                    ...states[index]!.props,
                    textSize: 'large',
                    layout: 'default',
                })
            ),
            h(
                'label',
                null,
                'Sibling draft',
                h('input', {
                    'aria-label': 'Sibling draft',
                    defaultValue: 'Keep draft',
                })
            )
        ),
        h(
            'p',
            null,
            'Row clicks: ',
            h('output', { id: 'row-clicks' }, rowClicks)
        ),
        h('p', null, 'Form submits: ', h('output', { id: 'submits' }, submits))
    );
}
const root = createRoot(document.getElementById('app')!);
root.render(h(StrictMode, null, h(App)));
