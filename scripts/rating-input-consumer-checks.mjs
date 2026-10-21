import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ratingInputTypedConsumer = `
import {createElement as ratingElement,createRef as ratingRef} from 'react';
import {RatingInput,RatingField,renderRatingField,type RatingInputProps,type RatingFieldOptions} from '@miniextensions/sdk/react';
import type {FormFieldBinding as RatingBinding} from '@miniextensions/sdk/forms';
import type {FieldRendererProps as RatingRendererProps} from '@miniextensions/sdk/ui';
const ratingProps:RatingInputProps={value:2,max:5,onChange:value=>{const native:number|null=value;void native;},
    inputProps:{form:'host','aria-describedby':'help',onFocus:event=>{const node:HTMLInputElement=event.currentTarget;node.focus();}},
    renderIcon:state=>ratingElement('svg',{onClick:state.activate,'aria-hidden':true}),
    warningMessage:state=>'Loaded '+state.value+'/'+state.max,repairLabel:'Repair'};
ratingElement(RatingInput,{...ratingProps,ref:ratingRef<HTMLInputElement>()});
declare const ratingBinding:RatingBinding;
declare const ratingRendererProps:RatingRendererProps<'rating'>;
ratingElement(RatingField,{binding:ratingBinding,iconInput:{renderIcon:ratingProps.renderIcon}});
renderRatingField(ratingRendererProps,{iconInput:{grid:true}});
// @ts-expect-error the input is controlled by a native numeric value
const badRatingValue:RatingInputProps={value:'2',max:5,onChange:()=>{}};
// @ts-expect-error native input kind is owned by this control
const badRatingType:RatingInputProps={value:2,max:5,onChange:()=>{},inputProps:{type:'text'}};
// @ts-expect-error appearance cannot override an accepted owner's write policy
const badRatingPolicy:RatingFieldOptions={iconInput:{disabled:false}};
// @ts-expect-error the forwarded ref is the actual range input
ratingElement(RatingInput,{...ratingProps,ref:ratingRef<HTMLTextAreaElement>()});
void badRatingValue;void badRatingType;void badRatingPolicy;
`;
export const ratingInputJsxConsumer = `
import {createRef as jsxRatingRef} from 'react';
import {RatingInput as JsxRatingInput} from '@miniextensions/sdk/react';
export const nativeRating=<JsxRatingInput ref={jsxRatingRef<HTMLInputElement>()} value={2} max={5}
    onChange={value=>{const native:number|null=value;void native;}} inputProps={{form:'host','aria-label':'Rating'}}
    renderIcon={state=><svg aria-hidden="true" onClick={state.activate} data-filled={state.filled} />} />;
`;

export async function checkRatingInputConsumer({
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
    let checks = 0;
    try {
        for (const api of [esm, consumer('@miniextensions/sdk/react')]) {
            assert.equal(typeof api.RatingField, 'function');
            assert.equal(typeof api.renderRatingField, 'function');
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const ref = react.createRef();
            const changes = [];
            let submits = 0;
            const view = (value, extra = {}) =>
                react.createElement(
                    react.StrictMode,
                    null,
                    react.createElement(
                        'form',
                        {
                            id: 'rating-form',
                            onSubmit: (event) => {
                                event.preventDefault();
                                submits++;
                            },
                        },
                        react.createElement(api.RatingInput, {
                            ref,
                            value,
                            max: 3,
                            onChange: (value) => changes.push(value),
                            inputProps: {
                                form: 'rating-form',
                                'aria-label': 'Rank',
                            },
                            gridSummaryClassName: 'grid-summary',
                            warningClassName: 'warning',
                            repairClassName: 'repair',
                            repairLabel: 'Repair',
                            warningMessage: (state) =>
                                'Loaded ' + state.value + '/' + state.max,
                            renderIcon: (state) =>
                                react.createElement('svg', {
                                    'data-index': state.index,
                                    'aria-hidden': true,
                                    onClick: state.activate,
                                }),
                            ...extra,
                        })
                    )
                );
            try {
                await react.act(async () => root.render(view(8)));
                const input = container.querySelector('input');
                assert(input);
                assert.equal(ref.current, input);
                assert.equal(input.type, 'range');
                assert.equal(input.form?.id, 'rating-form');
                assert.equal(input.max, '3');
                assert.equal(container.querySelectorAll('svg').length, 3);
                assert.equal(changes.length, 0);
                assert.match(
                    container.querySelector('.warning').textContent,
                    /Loaded 8\/3/
                );
                const repair = container.querySelector('.repair');
                assert.equal(repair.type, 'button');
                assert.equal(repair.textContent, 'Repair');
                await react.act(async () => repair.click());
                assert.deepEqual(changes, [3]);
                assert.equal(submits, 0);
                await react.act(async () => root.render(view(3)));
                await react.act(async () =>
                    container
                        .querySelector('[data-index="3"]')
                        .dispatchEvent(
                            new window.MouseEvent('click', { bubbles: true })
                        )
                );
                assert.deepEqual(changes, [3, null]);
                assert.equal(
                    window.document.activeElement,
                    container.querySelector('input')
                );
                await react.act(async () =>
                    root.render(view(3, { disabled: true, grid: true }))
                );
                assert.equal(ref.current, null);
                assert.equal(container.querySelector('input'), null);
                assert.equal(
                    container.querySelector('.grid-summary').textContent,
                    '(3/3)'
                );
                await react.act(async () =>
                    container
                        .querySelector('svg')
                        .dispatchEvent(
                            new window.MouseEvent('click', { bubbles: true })
                        )
                );
                assert.deepEqual(changes, [3, null]);
                checks++;
            } finally {
                await react.act(async () => root.unmount());
                container.remove();
                assert.equal(ref.current, null);
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
