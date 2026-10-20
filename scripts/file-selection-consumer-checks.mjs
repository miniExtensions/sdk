import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const fileSelectionTypedConsumer = `
import {createElement as fileElement,createRef as fileRef} from 'react';
import {useFileSelection,type FileSelectionOptions} from '@miniextensions/sdk/react';
export function NativeFilePicker(options:FileSelectionOptions){const selection=useFileSelection<HTMLDivElement>(options);const files=(chosen:File[])=>void chosen;void files;return fileElement('div',selection.dropProps,fileElement('input',{...selection.inputProps,ref:fileRef<HTMLInputElement>(),multiple:true,accept:'image/*',form:'native-form','aria-label':'Choose files'}));}
// @ts-expect-error native File objects are not URL strings
const wrongFileSelection:FileSelectionOptions={onFiles(files:string[]){void files;}};
void wrongFileSelection;
`;

export async function checkFileSelectionConsumer({
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
    const React = consumer('react'),
        { createRoot } = consumer('react-dom/client');
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
                received = [];
            let parentDrops = 0;
            function Picker() {
                const selection = api.useFileSelection({
                    onFiles: (files) => received.push(files),
                });
                return React.createElement(
                    'div',
                    { onDrop: () => parentDrops++ },
                    React.createElement(
                        'section',
                        selection.dropProps,
                        React.createElement('input', {
                            ...selection.inputProps,
                            multiple: true,
                            'aria-label': 'Select native files',
                        }),
                        React.createElement(
                            'output',
                            null,
                            selection.isDragActive ? 'active' : 'idle'
                        )
                    )
                );
            }
            try {
                await React.act(async () =>
                    root.render(React.createElement(Picker))
                );
                const input = container.querySelector('input'),
                    target = container.querySelector('section');
                const file = new window.File(['native'], 'native.txt', {
                    type: 'text/plain',
                });
                for (let i = 0; i < 2; i++) {
                    Object.defineProperty(input, 'files', {
                        configurable: true,
                        value: [file],
                    });
                    await React.act(async () =>
                        input.dispatchEvent(
                            new window.Event('change', { bubbles: true })
                        )
                    );
                    assert.equal(input.value, '');
                }
                const drop = new window.Event('drop', {
                    bubbles: true,
                    cancelable: true,
                });
                Object.defineProperty(drop, 'dataTransfer', {
                    value: { files: [file] },
                });
                await React.act(async () => target.dispatchEvent(drop));
                assert.equal(received.length, 3);
                for (const files of received) assert.equal(files[0], file);
                assert.equal(drop.defaultPrevented, true);
                assert.equal(parentDrops, 0);
                groups++;
            } finally {
                await React.act(async () => root.unmount());
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
