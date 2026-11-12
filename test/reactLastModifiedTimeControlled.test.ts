import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import moment from 'moment-timezone';
import { act, createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    LastModifiedTimeField,
    BindingLastModifiedTimeField,
    type LastModifiedTimeFieldProps,
    type BindingLastModifiedTimeFieldProps,
    type ControlledLastModifiedTimeFieldProps,
} from '../src/react/index.js';

const base: ControlledLastModifiedTimeFieldProps = {
    value: '2026-11-12T12:30:00Z',
    language: 'fr',
    fieldConfig: {
        type: 'lastModifiedTime',
        options: {
            isValid: true,
            result: {
                type: 'dateTime',
                options: {
                    dateFormat: { format: 'dddd D MMMM YYYY' },
                    timeFormat: { format: 'HH:mm' },
                    timeZone: 'America/New_York',
                },
            },
        },
    },
};
const markup = (props: ControlledLastModifiedTimeFieldProps) =>
    renderToStaticMarkup(h(LastModifiedTimeField, props));

function compatibility(
    old: LastModifiedTimeFieldProps,
    controlled: ControlledLastModifiedTimeFieldProps
) {
    const alias: BindingLastModifiedTimeFieldProps = old;
    const original: LastModifiedTimeFieldProps = alias;
    h(BindingLastModifiedTimeField, original);
    h(LastModifiedTimeField, old);
    h(LastModifiedTimeField, controlled);
    h(LastModifiedTimeField, {
        binding: old.binding,
        render: ({ snapshot, binding }) => {
            const same: typeof old.binding = binding;
            return snapshot.retired ? null : String(same.getSnapshot().value);
        },
    });
    // @ts-expect-error Controlled data cannot replace historical binding props.
    const incompatible: LastModifiedTimeFieldProps = controlled;
    // @ts-expect-error No mixed binding/value authority even through spreads.
    h(LastModifiedTimeField, { ...controlled, binding: old.binding });
    // @ts-expect-error Controlled-only presentation cannot enter binding mode.
    h(LastModifiedTimeField, { ...old, inert: true });
    // @ts-expect-error Controlled-only identity cannot enter binding mode.
    h(LastModifiedTimeField, { ...old, identity: {} });
    // @ts-expect-error No native renderer injection.
    h(LastModifiedTimeField, { ...controlled, render: () => null });
    // @ts-expect-error No setter authority.
    h(LastModifiedTimeField, { ...controlled, setValue: () => {} });
    h(LastModifiedTimeField, {
        value: null,
        language: 'en',
        // @ts-expect-error Wrapper metadata is required, no outer DateTime alias.
        dateConfig: base.fieldConfig.options.result,
    });
    void incompatible;
}

it('unwraps last-modified result and preserves native English text with localized UI labels', () => {
    const original = moment.locale();
    moment.locale('es');
    try {
        assert.match(markup(base), /Thursday 12 November 2026 07:30/);
        assert.match(markup({ ...base, value: null }), /Pas de Valeur/);
        assert.match(
            markup({ ...base, dateLanguage: 'fr' }),
            /jeudi 12 novembre 2026 07:30/
        );
        assert.equal(moment.locale(), 'es');
    } finally {
        moment.locale(original);
    }
});

it('blanks invalid configuration without reading result metadata or coercing physical values', () => {
    const invalid = {
        type: 'lastModifiedTime' as const,
        options: {
            isValid: false,
            get result(): never {
                throw Error('Invalid configuration must not unwrap result');
            },
        },
    };
    assert.match(markup({ ...base, fieldConfig: invalid }), /Pas de Valeur/);
    const value = {
        toString: () => {
            throw Error('No coercion');
        },
    } as unknown as string;
    assert.match(
        markup({
            ...base,
            fieldConfig: invalid,
            value,
            invalidValueLabel: 'Malformed timestamp',
        }),
        /Malformed timestamp/
    );
    assert.match(
        markup({ ...base, value: '2026-02-30T12:30:00Z' }),
        /Invalid date/
    );
});

it('formats date-only, UTC and DST transitions using accepted result metadata', () => {
    const date = {
        type: 'date' as const,
        options: { dateFormat: { format: 'YYYY-MM-DD' } },
    };
    assert.match(
        markup({
            ...base,
            value: '2026-11-12',
            fieldConfig: {
                type: 'lastModifiedTime',
                options: { isValid: true, result: date },
            },
        }),
        /2026-11-12/
    );
    assert.match(
        markup({ ...base, value: '2026-11-01T05:30:00Z' }),
        /Sunday 1 November 2026 01:30/
    );
    assert.match(
        markup({ ...base, value: '2026-11-01T06:30:00Z' }),
        /Sunday 1 November 2026 01:30/
    );
    const result = base.fieldConfig.options.result;
    assert.equal(result.type, 'dateTime');
    if (result.type === 'dateTime')
        assert.match(
            markup({
                ...base,
                fieldConfig: {
                    type: 'lastModifiedTime',
                    options: {
                        isValid: true,
                        result: {
                            ...result,
                            options: { ...result.options, timeZone: 'UTC' },
                        },
                    },
                },
            }),
            /12:30/
        );
});

it('dispatches safe attachments before button and metadata, preserving editable text behavior', () => {
    const fieldConfig = new Proxy(
        {},
        {
            get: () => {
                throw Error('No resource metadata access');
            },
        }
    ) as ControlledLastModifiedTimeFieldProps['fieldConfig'];
    assert.match(
        markup({
            ...base,
            fieldConfig,
            value: 'example.com/photo.jpg',
            displayAsAttachments: true,
            displayAsButton: true,
            attachmentOptions: { displayMode: 'icon' },
        }),
        /src="https:\/\/example.com\/photo.jpg"/
    );
    const button = markup({
        ...base,
        fieldConfig,
        value: 'mailto:user@example.com',
        displayAsAttachments: true,
        displayAsButton: true,
        buttonLabel: '  Contact  ',
    });
    assert.match(button, />Contact</);
    assert.match(button, /href="mailto:user@example.com"/);
    assert.match(
        markup({
            ...base,
            displayContext: 'editable',
            displayAsAttachments: true,
            displayAsButton: true,
        }),
        /Thursday 12 November/
    );
    assert.match(
        markup({
            ...base,
            value: 'javascript:alert(1)',
            displayAsButton: true,
        }),
        /disabled/
    );
    assert.match(markup({ ...base, fieldConfig, masked: true }), /••••••••/);
    assert.equal(
        markup({ ...base, fieldConfig, owner: { isCurrent: () => false } }),
        ''
    );
});

it('replaces validity, result and values without changing neighboring draft or granting Save authority', async () => {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const original = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        })
    );
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    let submits = 0;
    const render = async (props: ControlledLastModifiedTimeFieldProps) =>
        act(async () =>
            root.render(
                h(
                    'form',
                    {
                        onSubmit: (e: import('react').FormEvent) => {
                            e.preventDefault();
                            submits++;
                        },
                    },
                    h(LastModifiedTimeField, props),
                    h('input', { defaultValue: 'neighbor' })
                )
            )
        );
    try {
        await render(base);
        const neighbor = container.querySelector('input')!;
        neighbor.value = 'retained draft';
        await render({
            ...base,
            fieldConfig: {
                ...base.fieldConfig,
                options: { ...base.fieldConfig.options, isValid: false },
            },
        });
        assert.match(container.textContent!, /Pas de Valeur/);
        await render({ ...base, value: null });
        assert.match(container.textContent!, /Pas de Valeur/);
        await render({ ...base, value: 42 as unknown as string });
        assert.match(container.textContent!, /Unexpected field value/);
        await render({
            ...base,
            value: '2026-11-13',
            fieldConfig: {
                type: 'lastModifiedTime',
                options: {
                    isValid: true,
                    result: {
                        type: 'date',
                        options: { dateFormat: { format: 'YYYY-MM-DD' } },
                    },
                },
            },
        });
        assert.match(container.textContent!, /2026-11-13/);
        assert.equal(container.querySelector('input'), neighbor);
        assert.equal(neighbor.value, 'retained draft');
        assert.equal(container.querySelector('button,select,textarea'), null);
        assert.equal(submits, 0);
    } finally {
        await act(async () => root.unmount());
        original.forEach((descriptor, index) =>
            descriptor
                ? Object.defineProperty(globalThis, keys[index]!, descriptor)
                : Reflect.deleteProperty(globalThis, keys[index]!)
        );
        await window.happyDOM.close();
    }
});
