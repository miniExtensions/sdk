import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const textInputTypedConsumer = `
import { createElement, createRef } from 'react';
import { LiteralText, type LiteralTextProps, TextInput, type TextInputProps, InputClearButton, type InputClearButtonProps, TextareaInput, type TextareaInputProps } from '@miniextensions/sdk/react';
const literal: LiteralTextProps = {value:' <b>literal</b>',as:'p',empty:'None',preserveWhitespace:false,
    renderText:text=>text, 'aria-label':'Result'};
createElement(LiteralText,{...literal,ref:createRef<HTMLElement>()});
// @ts-expect-error display text is supplied as text, never a native object or number
const numericLiteral: LiteralTextProps = {value:42};
// @ts-expect-error literal presentation does not accept an HTML injection prop
const htmlLiteral: LiteralTextProps = {value:'text',dangerouslySetInnerHTML:{__html:'bad'}};
void numericLiteral;void htmlLiteral;
const props: TextInputProps = { value: '1,', type: 'text', inputMode: 'decimal', form: 'host',
    onChange: event => { const input: HTMLInputElement = event.currentTarget; input.focus(); },
    onCompositionEnd: event => { const data: string = event.data; void data; },
    'aria-describedby': 'description', 'aria-invalid': true };
createElement(TextInput, { ...props, ref: createRef<HTMLInputElement>() });
const nativeUncontrolled: TextInputProps = {defaultValue:'initial', role:'combobox'};
createElement(TextInput, {...nativeUncontrolled, ref:createRef<HTMLInputElement>()});
createElement(TextInput, {role:'combobox', ref:createRef<HTMLInputElement>()});
// @ts-expect-error native initial display text must remain a string
const numericDefault: TextInputProps = {defaultValue:42};
void numericDefault;

// @ts-expect-error native display drafts must be strings
const numericValue: TextInputProps = { value: 42 };
// @ts-expect-error controlled and uncontrolled ownership cannot be mixed
const defaultValue: TextInputProps = { value: '', defaultValue: 'old' };
// @ts-expect-error the forwarded ref is the actual native input
createElement(TextInput, { value: '', ref: createRef<HTMLTextAreaElement>() });
const clear: InputClearButtonProps = { label: 'Clear', disabled: true, form: 'host',
    onClick: event => { const button: HTMLButtonElement = event.currentTarget; button.focus(); } };
createElement(InputClearButton, { ...clear, ref: createRef<HTMLButtonElement>() });
// @ts-expect-error clear presentation cannot request native form submission
const submitClear: InputClearButtonProps = { label: 'Clear', type: 'submit' };
// @ts-expect-error clear presentation requires an accessible localized name
const unnamedClear: InputClearButtonProps = {};
const notes: TextareaInputProps = {value:'literal', autoSize:{minRows:3,maxRows:30}, rows:4, form:'host',
    onChange:event => { const node: HTMLTextAreaElement = event.currentTarget; node.setSelectionRange(1,2); }};
createElement(TextareaInput, {...notes, ref:createRef<HTMLTextAreaElement>()});
// @ts-expect-error textarea ref must be the actual textarea
createElement(TextareaInput, {...notes, ref:createRef<HTMLInputElement>()});
// @ts-expect-error controlled textarea cannot accept defaultValue
const uncontrolledNotes: TextareaInputProps = {value:'',defaultValue:'old'};
void uncontrolledNotes;
void numericValue; void defaultValue; void submitClear; void unnamedClear;
`;

export const textInputJsxConsumer = `
import { createRef } from 'react';
import { LiteralText, TextInput, InputClearButton, TextareaInput } from '@miniextensions/sdk/react';
export const literalDisplay = <LiteralText value="0" empty={<em>None</em>} ref={createRef<HTMLElement>()} />;
export const amount = <TextInput ref={createRef<HTMLInputElement>()} type="text" inputMode="decimal"
    value="1," form="host" aria-label="Amount" onChange={event => event.currentTarget.focus()} />;
export const nativeSearch = <TextInput role="combobox" defaultValue="seed" ref={createRef<HTMLInputElement>()} />;
export const notes = <TextareaInput value="literal" autoSize={{minRows:3,maxRows:30}} ref={createRef<HTMLTextAreaElement>()} onChange={event => event.currentTarget.focus()} />;
export const clear = <InputClearButton ref={createRef<HTMLButtonElement>()} label="Clear" disabled
    onClick={event => event.currentTarget.focus()} />;
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
        'HTMLTextAreaElement',
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
                await react.act(async () => root.render(null));
                const uncontrolledRef = react.createRef();
                let inputEvents = 0;
                const uncontrolled = (description) =>
                    react.createElement(api.TextInput, {
                        ref: uncontrolledRef,
                        defaultValue: 'seed',
                        role: 'combobox',
                        'aria-describedby': description,
                        onChange: () => {
                            inputEvents++;
                        },
                    });
                await react.act(async () => root.render(uncontrolled('first')));
                const nativeSearch = container.querySelector('input');
                assert.equal(uncontrolledRef.current, nativeSearch);
                assert.equal(nativeSearch.value, 'seed');
                nativeSearch.value = 'controller text';
                nativeSearch.focus();
                nativeSearch.setSelectionRange(2, 7, 'backward');
                await react.act(async () =>
                    root.render(uncontrolled('second'))
                );
                assert.equal(uncontrolledRef.current, nativeSearch);
                assert.equal(nativeSearch.value, 'controller text');
                assert.equal(nativeSearch.selectionStart, 2);
                assert.equal(nativeSearch.selectionEnd, 7);
                assert.equal(nativeSearch.selectionDirection, 'backward');
                assert.equal(inputEvents, 0);
                await react.act(async () => root.render(null));
                assert.equal(uncontrolledRef.current, null);
                const literalRef = react.createRef();
                const literalValue =
                    '  <img src="https://synthetic.invalid/private">\n字  ';
                await react.act(async () =>
                    root.render(
                        react.createElement(api.LiteralText, {
                            ref: literalRef,
                            value: literalValue,
                            'aria-label': 'Result',
                        })
                    )
                );
                assert.equal(
                    literalRef.current,
                    container.querySelector('output')
                );
                assert.equal(container.textContent, literalValue);
                assert.equal(container.querySelector('img'), null);
                assert.equal(literalRef.current.style.whiteSpace, 'pre-wrap');
                await react.act(async () =>
                    root.render(
                        react.createElement(api.LiteralText, {
                            value: '0',
                            as: 'div',
                            preserveWhitespace: false,
                            empty: 'None',
                            renderText: (text) =>
                                react.createElement('p', null, text),
                        })
                    )
                );
                assert.equal(container.firstElementChild.tagName, 'DIV');
                assert.equal(
                    container.firstElementChild.getAttribute('style'),
                    null
                );
                assert.equal(container.textContent, '0');
                await react.act(async () =>
                    root.render(
                        react.createElement(api.LiteralText, {
                            value: '',
                            empty: react.createElement(
                                'em',
                                null,
                                'Localized empty'
                            ),
                        })
                    )
                );
                assert.equal(container.firstElementChild.tagName, 'EM');
                assert.equal(container.querySelector('output'), null);
                let actions = 0,
                    submits = 0;
                await react.act(async () =>
                    root.render(
                        react.createElement(
                            'form',
                            {
                                onSubmit: (event) => {
                                    event.preventDefault();
                                    submits++;
                                },
                            },
                            react.createElement(api.InputClearButton, {
                                label: 'Clear',
                                onClick: () => {
                                    actions++;
                                },
                            })
                        )
                    )
                );
                const button = container.querySelector('button');
                assert.ok(button);
                assert.equal(button.type, 'button');
                assert.equal(button.getAttribute('aria-label'), 'Clear');
                await react.act(async () => button.click());
                assert.equal(actions, 1);
                assert.equal(submits, 0);
                const textareaRef = react.createRef();
                await react.act(async () =>
                    root.render(
                        react.createElement(api.TextareaInput, {
                            ref: textareaRef,
                            value: 'literal\\ntext',
                            rows: 4,
                            readOnly: true,
                            'aria-label': 'Notes',
                            autoSize: { minRows: 3, maxRows: 30 },
                            form: 'host',
                            maxLength: 100,
                        })
                    )
                );
                const textarea = container.querySelector('textarea');
                assert.ok(textarea);
                assert.equal(textareaRef.current, textarea);
                assert.equal(textarea.value, 'literal\\ntext');
                assert.equal(textarea.getAttribute('rows'), '4');
                assert.equal(textarea.readOnly, true);
                assert.equal(textarea.getAttribute('maxlength'), '100');
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
