import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const recoverableImageTypedConsumer = `
import {createElement as imageElement,createRef as imageRef} from 'react';
import {RecoverableImage as NativeRecoveryImage,type RecoverableImageProps as NativeRecoveryImageProps} from '@miniextensions/sdk/react';
const nativeRecoveryProps:NativeRecoveryImageProps={sources:Object.freeze(['thumbnail','original']),alt:'Attachment',loading:'lazy',crossOrigin:'anonymous',onLoad(event){const native:HTMLImageElement=event.currentTarget;void native;},renderFallback(retry){return imageElement('button',{type:'button',onClick:retry},'Retry');}};
imageElement(NativeRecoveryImage,{...nativeRecoveryProps,ref:imageRef<HTMLImageElement>()});
// @ts-expect-error native recovery owns the ordered image src
const overriddenRecoverySrc:NativeRecoveryImageProps={...nativeRecoveryProps,src:'override'};
// @ts-expect-error browser srcSet must not bypass ordered source recovery
const overriddenRecoverySet:NativeRecoveryImageProps={...nativeRecoveryProps,srcSet:'other 2x'};
// @ts-expect-error the caller cannot replace the recovery error handler
const overriddenRecoveryError:NativeRecoveryImageProps={...nativeRecoveryProps,onError(){}};
// @ts-expect-error the caller supplies explicit accessible or decorative alt
const missingRecoveryAlt:NativeRecoveryImageProps={sources:[],renderFallback:()=>null};
void overriddenRecoverySrc;void overriddenRecoverySet;void overriddenRecoveryError;void missingRecoveryAlt;
`;
export const recoverableImageJsxConsumer = `
import {RecoverableImage as NativeJsxRecoveryImage} from '@miniextensions/sdk/react';
export const NativeImagePreview=()=> <NativeJsxRecoveryImage sources={['thumbnail','original']} alt="Attachment" renderFallback={retry=><button type="button" onClick={retry}>Retry</button>}/>;
`;

export async function checkRecoverableImageConsumer({
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
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const React = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    let groups = 0;
    try {
        for (const api of [
            await import(
                pathToFileURL(consumer.resolve('@miniextensions/sdk/react'))
                    .href
            ),
            consumer('@miniextensions/sdk/react'),
        ]) {
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container),
                ref = React.createRef();
            let oldRetry;
            const render = (sources) =>
                React.act(async () =>
                    root.render(
                        React.createElement(api.RecoverableImage, {
                            ref,
                            sources,
                            alt: 'Native preview',
                            loading: 'lazy',
                            renderFallback: (retry) => {
                                oldRetry = retry;
                                return React.createElement(
                                    'button',
                                    { type: 'button', onClick: retry },
                                    'Localized retry'
                                );
                            },
                        })
                    )
                );
            const fail = () =>
                React.act(async () =>
                    container
                        .querySelector('img')
                        .dispatchEvent(new window.Event('error'))
                );
            try {
                await render(['', 'thumb', 'thumb', 'original']);
                const first = container.querySelector('img');
                assert.equal(ref.current, first);
                assert.equal(first.getAttribute('src'), 'thumb');
                assert.equal(first.getAttribute('loading'), 'lazy');
                await React.act(async () => {
                    first.dispatchEvent(new window.Event('error'));
                    first.dispatchEvent(new window.Event('error'));
                });
                const original = container.querySelector('img');
                assert.equal(original.getAttribute('src'), 'original');
                await render(['thumb', 'original']);
                assert.equal(container.querySelector('img'), original);
                await fail();
                assert.equal(ref.current, null);
                assert.equal(container.textContent, 'Localized retry');
                await React.act(async () =>
                    container.querySelector('button').click()
                );
                assert.equal(
                    container.querySelector('img').getAttribute('src'),
                    'thumb'
                );
                assert.notEqual(container.querySelector('img'), first);
                await render(['current']);
                const current = container.querySelector('img');
                await React.act(async () => oldRetry());
                assert.equal(container.querySelector('img'), current);
                assert.equal(current.getAttribute('src'), 'current');
                await render([]);
                assert.equal(container.querySelector('img'), null);
                assert.equal(container.textContent, 'Localized retry');
                groups++;
            } finally {
                await React.act(async () => root.unmount());
                assert.equal(ref.current, null);
                container.remove();
            }
        }
    } finally {
        keys.forEach((key, i) => {
            if (previous[i])
                Object.defineProperty(globalThis, key, previous[i]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
    return groups;
}
