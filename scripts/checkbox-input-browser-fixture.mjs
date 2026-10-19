import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckboxInput } from '@miniextensions/sdk/react';

function App() {
    const [mount, setMount] = useState(0);
    const [state, setState] = useState(() => ({
        checked: false,
        disabled: false,
        readOnly: false,
        accepting: true,
        changes: [],
        currentTargets: [],
        events: { click: 0, change: 0, pointerdown: 0, keydown: 0, keyup: 0 },
        submits: 0,
    }));
    const countEvent = (name, event) => {
        if (event.target !== document.getElementById('bare-checkbox')) return;
        setState((previous) => ({
            ...previous,
            events: {
                ...previous.events,
                [name]: previous.events[name] + 1,
            },
        }));
    };
    const toggle = (name) =>
        setState((previous) => ({ ...previous, [name]: !previous[name] }));
    const button = (label, onClick) =>
        h('button', { type: 'button', onClick }, label);
    return h(
        'main',
        null,
        h('label', { htmlFor: 'bare-checkbox' }, 'Host consent'),
        h('form', {
            id: 'bare-form',
            onSubmit: (event) => {
                event.preventDefault();
                setState((previous) => ({
                    ...previous,
                    submits: previous.submits + 1,
                }));
            },
        }),
        h('p', { id: 'bare-help' }, 'Host help'),
        h('p', { id: 'bare-error' }, 'Host error'),
        h(
            'section',
            {
                id: 'bare-host',
                onClick: (event) => countEvent('click', event),
                onChange: (event) => countEvent('change', event),
                onPointerDown: (event) => countEvent('pointerdown', event),
                onKeyDown: (event) => countEvent('keydown', event),
                onKeyUp: (event) => countEvent('keyup', event),
            },
            h(CheckboxInput, {
                key: mount,
                checked: state.checked,
                disabled: state.disabled,
                readOnly: state.readOnly,
                id: 'bare-checkbox',
                form: 'bare-form',
                className: 'host-checkbox',
                'aria-describedby': 'bare-help bare-error',
                'aria-invalid': true,
                onChange: (event) => {
                    const checked = event.currentTarget.checked;
                    const currentTarget =
                        event.currentTarget ===
                        document.getElementById('bare-checkbox');
                    setState((previous) => ({
                        ...previous,
                        checked: previous.accepting
                            ? checked
                            : previous.checked,
                        changes: [...previous.changes, checked],
                        currentTargets: [
                            ...previous.currentTargets,
                            currentTarget,
                        ],
                    }));
                },
            })
        ),
        button('Reset host value', () =>
            setState((previous) => ({ ...previous, checked: false }))
        ),
        button('Remount input', () => setMount((previous) => previous + 1)),
        button('Toggle disabled', () => toggle('disabled')),
        button('Toggle readOnly', () => toggle('readOnly')),
        button('Toggle acceptance', () => toggle('accepting')),
        h('output', { id: 'bare-state' }, JSON.stringify(state))
    );
}

createRoot(document.getElementById('app')).render(h(App));
