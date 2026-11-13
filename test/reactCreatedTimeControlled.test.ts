import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import moment from 'moment-timezone';
import 'moment/min/locales.js';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    ControlledCreatedTimeField,
    createdTimeInput,
    type ControlledCreatedTimeFieldProps,
} from '../src/react/CreatedTimeField.js';

const base: ControlledCreatedTimeFieldProps = {
    value: '2026-11-12T12:30:00.000Z',
    language: 'en',
    dateConfig: {
        type: 'dateTime',
        options: {
            dateFormat: { format: 'YYYY-MM-DD' },
            timeFormat: { format: 'HH:mm' },
            timeZone: 'America/New_York',
        },
    },
};

function readonlyTypes(props: ControlledCreatedTimeFieldProps) {
    // @ts-expect-error A controlled Created time display has no writer.
    props.setValue(null);
    // @ts-expect-error A display does not acquire binding/provider authority.
    const mixed: ControlledCreatedTimeFieldProps = { ...props, binding: {} };
    const injected: ControlledCreatedTimeFieldProps = {
        ...props,
        // @ts-expect-error Controlled display cannot inject a host renderer.
        render: () => null,
    };
    void mixed;
    void injected;
}

it('formats controlled timestamps without changing the legacy raw-string contract', () => {
    const markup = renderToStaticMarkup(h(ControlledCreatedTimeField, base));
    assert.match(markup, /2026-11-12 07:30/);
    assert.doesNotMatch(markup, /<input|<button|contenteditable/i);
    assert.equal(createdTimeInput(base.value), base.value);
    assert.equal(createdTimeInput(42), '');
});

it('resolves configured attachment mode before date metadata and before button mode', () => {
    const dateConfig = new Proxy(
        {},
        {
            get: () => {
                throw Error('Resource modes must not read date metadata');
            },
        }
    ) as ControlledCreatedTimeFieldProps['dateConfig'];
    const configured = {
        ...base,
        value: 'example.com/photo.jpg',
        dateConfig,
        displayAsAttachments: true,
        displayAsButton: true,
        attachmentOptions: { displayMode: 'icon' as const },
    };
    const markup = renderToStaticMarkup(
        h(ControlledCreatedTimeField, configured)
    );
    assert.match(markup, /src="https:\/\/example\.com\/photo\.jpg"/);
    assert.doesNotMatch(markup, /Invalid date|Invalid link/);
});

it('uses the existing date formatter locale without changing the global locale', () => {
    const original = moment.locale();
    moment.locale('es');
    try {
        const markup = renderToStaticMarkup(
            h(ControlledCreatedTimeField, {
                ...base,
                language: 'fr',
                dateConfig: {
                    type: 'date',
                    options: { dateFormat: { format: 'D MMMM YYYY' } },
                },
                value: '2026-11-12',
            })
        );
        assert.match(markup, /12 novembre 2026/);
        assert.equal(moment.locale(), 'es');
    } finally {
        moment.locale(original);
    }
});

it('preserves an explicit date language separately from localized empty text in both native contexts', () => {
    const original = moment.locale();
    moment.locale('es');
    try {
        const dateConfig: ControlledCreatedTimeFieldProps['dateConfig'] = {
            type: 'dateTime',
            options: {
                dateFormat: { format: 'dddd D MMMM YYYY' },
                timeFormat: { format: 'HH:mm' },
                timeZone: 'America/New_York',
            },
        };
        const configured = {
            ...base,
            language: 'fr' as const,
            dateLanguage: 'en' as const,
            dateConfig,
        };
        for (const displayContext of ['readonly', 'editable'] as const) {
            const markup = renderToStaticMarkup(
                h(ControlledCreatedTimeField, { ...configured, displayContext })
            );
            assert.match(markup, /Thursday 12 November 2026 07:30/);
            assert.match(
                renderToStaticMarkup(
                    h(ControlledCreatedTimeField, {
                        ...configured,
                        displayContext,
                        value: null,
                    })
                ),
                /Pas de Valeur/
            );
        }
        const fallback = { ...configured, dateLanguage: undefined };
        assert.match(
            renderToStaticMarkup(h(ControlledCreatedTimeField, fallback)),
            /jeudi 12 novembre 2026 07:30/
        );
        assert.equal(moment.locale(), 'es');
    } finally {
        moment.locale(original);
    }
});

it('keeps null, malformed timestamps and invalid shapes distinct', () => {
    for (const value of [null, undefined]) {
        const markup = renderToStaticMarkup(
            h(ControlledCreatedTimeField, { ...base, value })
        );
        assert.match(markup, /No Value/);
        assert.doesNotMatch(markup, /Invalid date/);
    }
    const invalidDate = renderToStaticMarkup(
        h(ControlledCreatedTimeField, {
            ...base,
            value: '2026-02-30T12:00:00Z',
        })
    );
    assert.match(invalidDate, /Invalid date/);
    const invalidShape = renderToStaticMarkup(
        h(ControlledCreatedTimeField, {
            ...base,
            value: {
                toString: () => {
                    throw Error('Do not coerce values');
                },
            } as unknown as string,
            invalidValueLabel: 'Unexpected timestamp value',
        })
    );
    assert.match(invalidShape, /Unexpected timestamp value/);
    assert.match(invalidShape, /role="alert"/);
});

it('conceals before formatting and suppresses retired owners', () => {
    const dateConfig = new Proxy(
        {},
        {
            get: () => {
                throw Error('Concealed or retired metadata must not be read');
            },
        }
    ) as ControlledCreatedTimeFieldProps['dateConfig'];
    const value = {
        toString: () => {
            throw Error('Do not coerce values');
        },
    } as unknown as string;
    const masked = renderToStaticMarkup(
        h(ControlledCreatedTimeField, {
            ...base,
            dateConfig,
            value,
            masked: true,
        })
    );
    assert.match(masked, /••••••••/);
    assert.doesNotMatch(masked, /role="alert"/);
    assert.equal(
        renderToStaticMarkup(
            h(ControlledCreatedTimeField, {
                ...base,
                dateConfig,
                value,
                owner: { isCurrent: () => false },
            })
        ),
        ''
    );
    assert.equal(
        renderToStaticMarkup(
            h(ControlledCreatedTimeField, {
                ...base,
                dateConfig,
                value,
                owner: {
                    isCurrent: () => {
                        throw Error('Retired display authority');
                    },
                },
            })
        ),
        ''
    );
});

it('retains shell label, help and error associations', () => {
    const markup = renderToStaticMarkup(
        h(ControlledCreatedTimeField, {
            ...base,
            presentation: {
                chromeOwner: 'shell',
                association: {
                    kind: 'non-labelable',
                    controlId: 'created-display',
                    labelId: 'created-label',
                    descriptionId: 'created-help',
                    errorId: 'created-error',
                    formId: 'form-one',
                },
            },
        })
    );
    assert.match(markup, /id="created-display"/);
    assert.match(markup, /aria-labelledby="created-label"/);
    assert.match(markup, /aria-describedby="created-error created-help"/);
    assert.match(markup, /aria-invalid="true"/);
    assert.doesNotMatch(markup, /<label|<form|<input/);
});

it('replaces mounted owner data while preserving neighboring drafts and making no requests', async () => {
    const window = new Window();
    let requests = 0;
    const rejectRequest = async () => {
        requests++;
        throw Error('Unexpected source fetch');
    };
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'fetch',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    window.fetch = rejectRequest;
    try {
        for (const key of keys)
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value:
                    key === 'IS_REACT_ACT_ENVIRONMENT'
                        ? true
                        : key === 'fetch'
                          ? rejectRequest
                          : window[key as keyof Window],
            });
        const { createRoot } = await import('react-dom/client');
        const container = window.document.createElement('div');
        window.document.body.append(container);
        const root = createRoot(container as unknown as HTMLElement);
        const render = async (props: ControlledCreatedTimeFieldProps) => {
            await act(async () => {
                root.render(
                    h(
                        'div',
                        null,
                        h(ControlledCreatedTimeField, props),
                        h('input', {
                            'data-neighbor': true,
                            defaultValue: 'neighbor',
                        })
                    )
                );
            });
        };
        try {
            await render(base);
            const neighbor = container.querySelector('input[data-neighbor]');
            assert.ok(neighbor instanceof window.HTMLInputElement);
            neighbor.value = 'kept draft';
            await render({ ...base, owner: { isCurrent: () => false } });
            assert.doesNotMatch(container.textContent ?? '', /2026-11-12/);
            await render({
                ...base,
                value: '2026-11-13T13:45:00Z',
                owner: { isCurrent: () => true },
            });
            assert.match(container.textContent ?? '', /2026-11-13 08:45/);
            assert.equal(
                container.querySelector('input[data-neighbor]'),
                neighbor
            );
            assert.equal(neighbor.value, 'kept draft');
        } finally {
            await act(async () => root.unmount());
        }
    } finally {
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
        assert.equal(requests, 0);
    }
});
