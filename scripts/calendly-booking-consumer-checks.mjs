import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const calendlyBookingTypedConsumer = `
import { useCalendlyBooking, composeCalendlyUrl, type CalendlyBookingOptions, type CalendlyBookingSession } from '@miniextensions/sdk/react';
const calendlyOptions: CalendlyBookingOptions = { configuredUrl:'https://calendly.com/synthetic', email:null, name:null,
    embedDomain:'https://synthetic.invalid', ownerKey:'session/record/field', booked:false, enabled:true,
    onScheduled() {}, frameTitle:'Schedule', frameClassName:'host' };
export function typedCalendly() {
    const booking = useCalendlyBooking(calendlyOptions);
    const opened: boolean = booking.open();
    const session: CalendlyBookingSession | null = booking.session;
    const canceled: boolean | undefined = session?.cancel();
    const url: URL | null = composeCalendlyUrl(calendlyOptions);
    return {opened,canceled,url,frame:session?.frame};
}
// @ts-expect-error a caller context identity is required
const unownedCalendly: CalendlyBookingOptions = {configuredUrl:'https://calendly.com/synthetic',email:null,name:null,embedDomain:'https://synthetic.invalid',onScheduled(){}};
void unownedCalendly;
`;
export const calendlyBookingJsxConsumer = `
import { ActionButton as CalendlyAction, useCalendlyBooking as useJsxCalendly } from '@miniextensions/sdk/react';
export function CalendlyConsumer({ownerKey,onScheduled}:{ownerKey:string,onScheduled():void}) {
    const booking = useJsxCalendly({configuredUrl:'https://calendly.com/synthetic',email:null,name:null,
        embedDomain:'https://synthetic.invalid',ownerKey,onScheduled});
    return <><CalendlyAction onClick={()=>booking.open()}>Schedule</CalendlyAction>{booking.session?.frame}</>;
}
`;

export async function checkCalendlyBookingConsumer({
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
    const cjs = consumer('@miniextensions/sdk/react');
    let checks = 0;
    try {
        for (const api of [esm, cjs]) {
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            let booking;
            let writes = 0;
            let ownerKey = 'record-A';
            function Host() {
                booking = api.useCalendlyBooking({
                    configuredUrl: 'https://calendly.com/synthetic',
                    email: null,
                    name: null,
                    embedDomain: 'https://synthetic.invalid',
                    ownerKey,
                    onScheduled() {
                        writes++;
                    },
                });
                return booking.session
                    ? React.cloneElement(booking.session.frame, {
                          src: 'about:blank',
                      })
                    : null;
            }
            const send = (source) =>
                window.dispatchEvent(
                    new window.MessageEvent('message', {
                        source,
                        origin: 'https://calendly.com',
                        data: { event: 'calendly.event_scheduled' },
                    })
                );
            try {
                await React.act(async () =>
                    root.render(
                        React.createElement(
                            React.StrictMode,
                            null,
                            React.createElement(Host)
                        )
                    )
                );
                await React.act(async () => assert.equal(booking.open(), true));
                const first = container.querySelector('iframe');
                const firstSource = first.contentWindow;
                const oldSession = booking.session;
                await React.act(async () =>
                    assert.equal(oldSession.cancel(), true)
                );
                await React.act(async () => booking.open());
                const second = container.querySelector('iframe');
                assert.notEqual(second, first);
                await React.act(async () => {
                    send(firstSource);
                    assert.equal(oldSession.cancel(), false);
                });
                assert.equal(writes, 0);
                await React.act(async () => {
                    send(second.contentWindow);
                    send(second.contentWindow);
                });
                assert.equal(writes, 1);
                await React.act(async () => booking.open());
                const staleSource =
                    container.querySelector('iframe').contentWindow;
                ownerKey = 'record-B';
                await React.act(async () =>
                    root.render(
                        React.createElement(
                            React.StrictMode,
                            null,
                            React.createElement(Host)
                        )
                    )
                );
                assert.equal(booking.session, null);
                await React.act(async () => send(staleSource));
                assert.equal(writes, 1);
                checks++;
            } finally {
                await React.act(async () => root.unmount());
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
