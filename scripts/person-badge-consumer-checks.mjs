import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const personBadgeTypedConsumer = `
import { createElement as createPersonElement, createRef as createPersonRef } from 'react';
import { PersonBadge, type PersonBadgeProps } from '@miniextensions/sdk/react';
const personProps:PersonBadgeProps={label:'Resolved person',avatar:createPersonElement('span',null,'Avatar'),
    className:'host',bodyClassName:'pill',labelClassName:'label',remove:{label:'Localized remove',
        buttonProps:{disabled:false,form:'host','aria-describedby':'help'},onClick:event=>{const native:HTMLButtonElement=event.currentTarget;native.focus();}}};
createPersonElement(PersonBadge,{...personProps,ref:createPersonRef<HTMLLIElement>()});
// @ts-expect-error labels must be supplied literal strings
const numericPerson:PersonBadgeProps={label:42};
// @ts-expect-error removals require a localized label
const unnamedPerson:PersonBadgeProps={label:'Person',remove:{onClick(){}}};
// @ts-expect-error removals cannot submit native forms
const submittingPerson:PersonBadgeProps={label:'Person',remove:{label:'Remove',onClick(){},buttonProps:{type:'submit'}}};
// @ts-expect-error arbitrary HTML cannot replace the literal label
const htmlPerson:PersonBadgeProps={label:'Person',dangerouslySetInnerHTML:{__html:'bad'}};
void numericPerson;void unnamedPerson;void submittingPerson;void htmlPerson;
`;
export const personBadgeJsxConsumer = `
import { PersonBadge as JsxPersonBadge } from '@miniextensions/sdk/react';
export const PersonDisplay=()=> <ul><JsxPersonBadge label="Resolved person" avatar={<span>Avatar</span>} remove={{label:'Remove person',onClick:event=>event.currentTarget.focus()}} /></ul>;
`;
export async function checkPersonBadgeConsumer({
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
    let checks = 0;
    try {
        for (const api of [esm, consumer('@miniextensions/sdk/react')]) {
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const ref = React.createRef();
            let writes = 0;
            let submits = 0;
            const render = (remove) =>
                React.act(async () =>
                    root.render(
                        React.createElement(
                            React.StrictMode,
                            null,
                            React.createElement(
                                'form',
                                {
                                    onSubmit: (event) => {
                                        event.preventDefault();
                                        submits++;
                                    },
                                },
                                React.createElement(
                                    'ul',
                                    null,
                                    React.createElement(api.PersonBadge, {
                                        ref,
                                        label: '<b>person</b>',
                                        avatar: React.createElement(
                                            'span',
                                            { 'data-avatar': 'caller' },
                                            'Avatar'
                                        ),
                                        remove,
                                    })
                                )
                            )
                        )
                    )
                );
            try {
                await render({
                    label: 'Remove person',
                    onClick() {
                        writes++;
                    },
                });
                const li = container.querySelector('li');
                assert.equal(ref.current, li);
                assert.equal(li.querySelector('b'), null);
                assert.equal(
                    li.querySelector('[data-avatar]')?.textContent,
                    'Avatar'
                );
                const button = li.querySelector('button');
                assert.equal(button.type, 'button');
                await React.act(async () => button.click());
                assert.equal(writes, 1);
                assert.equal(submits, 0);
                await render(undefined);
                assert.equal(container.querySelector('button'), null);
                assert.equal(ref.current, li);
                checks++;
            } finally {
                await React.act(async () => root.unmount());
                assert.equal(ref.current, null);
                container.remove();
            }
        }
        return checks;
    } finally {
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
