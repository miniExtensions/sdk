import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const radioInputTypedConsumer = `
import {createElement as createRadio,createRef as radioRef} from 'react';
import {RadioInput,type RadioInputProps} from '@miniextensions/sdk/react';
const radioProps:RadioInputProps={checked:true,allowDeselect:true,form:'choice-form',readOnly:false,onCheckedChange(checked,event){const native:HTMLInputElement=event.currentTarget;const selected:boolean=checked;void native;void selected;}};
createRadio(RadioInput,{...radioProps,ref:radioRef<HTMLInputElement>()});
// @ts-expect-error selection is a controlled boolean
const badRadioChecked:RadioInputProps={...radioProps,checked:'on'};
// @ts-expect-error native type cannot change the radio contract
const badRadioType:RadioInputProps={...radioProps,type:'checkbox'};
// @ts-expect-error controlled radios cannot have a defaultChecked owner
const badRadioDefault:RadioInputProps={...radioProps,defaultChecked:true};
// @ts-expect-error one explicit checked-intent callback avoids duplicate native change writes
const duplicateRadioChange:RadioInputProps={...radioProps,onChange(){}};
void badRadioChecked;void badRadioType;void badRadioDefault;void duplicateRadioChange;
`;

export async function checkRadioInputConsumer({
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
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const React = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    let groups = 0;
    try {
        for (const api of [esm, consumer('@miniextensions/sdk/react')]) {
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const ref = React.createRef();
            const intents = [];
            let submits = 0;
            const render = (checked, extra = {}) =>
                React.act(async () =>
                    root.render(
                        React.createElement(
                            'form',
                            {
                                id: 'radio-form',
                                onSubmit: (e) => {
                                    e.preventDefault();
                                    submits++;
                                },
                            },
                            React.createElement(api.RadioInput, {
                                checked,
                                ref,
                                form: 'radio-form',
                                'aria-label': 'Priority',
                                onCheckedChange(next, event) {
                                    assert.equal(
                                        event.currentTarget,
                                        ref.current
                                    );
                                    intents.push(next);
                                },
                                ...extra,
                            })
                        )
                    )
                );
            try {
                await render(false);
                const input = ref.current;
                assert.equal(input.type, 'radio');
                assert.equal(input.getAttribute('form'), 'radio-form');
                assert.equal(input.getAttribute('aria-label'), 'Priority');
                await React.act(async () => input.click());
                assert.deepEqual(intents, [true]);
                assert.equal(input.checked, false);
                await render(true);
                await React.act(async () => input.click());
                assert.deepEqual(intents, [true]);
                await render(true, { allowDeselect: true });
                await React.act(async () => input.click());
                assert.deepEqual(intents, [true, false]);
                assert.equal(input.checked, true);
                for (const extra of [
                    { disabled: true },
                    { readOnly: true },
                    { onClickCapture: (e) => e.preventDefault() },
                ]) {
                    await render(false, extra);
                    await React.act(async () => input.click());
                    assert.deepEqual(intents, [true, false]);
                    assert.equal(input.checked, false);
                }
                assert.equal(submits, 0);
                groups++;
            } finally {
                await React.act(async () => root.unmount());
                assert.equal(ref.current, null);
                container.remove();
            }
        }
        return groups;
    } finally {
        keys.forEach((key, i) =>
            originals[i]
                ? Object.defineProperty(globalThis, key, originals[i])
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    }
}
