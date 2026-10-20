import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const textInputTypedConsumer = `
import { createElement, createRef } from 'react';
import { TextInput, type TextInputProps } from '@miniextensions/sdk/react';
const props: TextInputProps = { value: '1,', type: 'text', inputMode: 'decimal', form: 'host',
    onChange: event => { const input: HTMLInputElement = event.currentTarget; input.focus(); },
    onCompositionEnd: event => { const data: string = event.data; void data; },
    'aria-describedby': 'description', 'aria-invalid': true };
createElement(TextInput, { ...props, ref: createRef<HTMLInputElement>() });
// @ts-expect-error native display drafts must be strings
const numericValue: TextInputProps = { value: 42 };
// @ts-expect-error this primitive is controlled by its caller
const defaultValue: TextInputProps = { value: '', defaultValue: 'old' };
// @ts-expect-error the forwarded ref is the actual native input
createElement(TextInput, { value: '', ref: createRef<HTMLTextAreaElement>() });
void numericValue; void defaultValue;
`;

export const textInputJsxConsumer = `
import { createRef } from 'react';
import { TextInput } from '@miniextensions/sdk/react';
export const amount = <TextInput ref={createRef<HTMLInputElement>()} type="text" inputMode="decimal"
    value="1," form="host" aria-label="Amount" onChange={event => event.currentTarget.focus()} />;
`;

export async function checkTextInputConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const react = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const cjs = consumer('@miniextensions/sdk/react');
    let checks = 0;
    try {
        for (const api of [esm, cjs]) {
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const ref = react.createRef();
            try {
                await react.act(async () =>
                    root.render(
                        react.createElement(
                            react.StrictMode,
                            null,
                            react.createElement('form', {
                                id: `host-${checks}`,
                            }),
                            react.createElement(api.TextInput, {
                                ref,
                                value: '1,',
                                type: 'text',
                                inputMode: 'decimal',
                                form: `host-${checks}`,
                                readOnly: true,
                                'aria-label': 'Amount',
                                className: 'host',
                            })
                        )
                    )
                );
                const input = container.querySelector('input');
                assert.ok(input);
                assert.equal(ref.current, input);
                assert.equal(input.value, '1,');
                assert.equal(input.inputMode, 'decimal');
                assert.equal(input.form?.id, `host-${checks}`);
                assert.equal(input.className, 'host');
                assert.equal(container.querySelectorAll('input').length, 1);
                checks++;
            } finally {
                await react.act(async () => root.unmount());
                assert.equal(ref.current, null);
                container.remove();
            }
        }
    } finally {
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
    return checks;
}
