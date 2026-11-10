import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import {
    useLocalizedNumericInputAdapter,
    type LocalizedNumericInputAdapterProps,
} from '../src/react/index.js';

it('uses the committed controlled writer, refuses field/owner ABA, and creates no mount/echo writes', async (t) => {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('main');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const writes: (number | null)[] = [],
        echoes: (number | null)[] = [];
    const firstToken = {};
    let current = true;
    let props: LocalizedNumericInputAdapterProps = {
        extensionSessionId: 'supplied-native-session',
        airtableField: {
            id: 'A',
            config: { type: 'number', options: { precision: 2 } },
        },
        miniExtFieldConfig: { numberSeparator: 'period-comma' },
        value: 0,
        setValue: (value) => {
            writes.push(value);
        },
        owner: { token: firstToken, isCurrent: () => current },
    };
    const observed: {
        adapter?: ReturnType<typeof useLocalizedNumericInputAdapter>;
    } = {};
    function Probe() {
        observed.adapter = useLocalizedNumericInputAdapter(props);
        return null;
    }
    const read = () => {
        assert.ok(observed.adapter);
        return observed.adapter;
    };
    const publish = async () => {
        await act(async () => root.render(h(StrictMode, null, h(Probe))));
    };
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            const descriptor = originals[index];
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    await publish();
    const old = read();
    assert.deepEqual(writes, []);
    props = {
        ...props,
        value: 2,
        setValue: (value) => {
            echoes.push(value);
        },
    };
    await publish();
    assert.equal(read(), old);
    act(() => assert.equal(old.setInput('3,5'), true));
    assert.deepEqual(writes, []);
    assert.deepEqual(echoes, [3.5]);
    props = { ...props, airtableField: { ...props.airtableField, id: 'B' } };
    await publish();
    props = { ...props, airtableField: { ...props.airtableField, id: 'A' } };
    await publish();
    act(() => assert.equal(old.setInput('7'), false));
    assert.deepEqual(echoes, [3.5]);
    const fieldSuccessor = read();
    props = { ...props, owner: { token: {}, isCurrent: () => current } };
    await publish();
    props = {
        ...props,
        owner: { token: firstToken, isCurrent: () => current },
    };
    await publish();
    act(() => assert.equal(fieldSuccessor.setInput('8'), false));
    assert.deepEqual(echoes, [3.5]);
    act(() => assert.equal(read().setInput('9'), true));
    assert.deepEqual(echoes, [3.5, 9]);
    current = false;
    act(() => assert.equal(read().setInput('10'), false));
    assert.deepEqual(echoes, [3.5, 9]);
});
