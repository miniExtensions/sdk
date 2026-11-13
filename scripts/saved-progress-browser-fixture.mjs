import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createNativeFormProgressStorage } from '@miniextensions/sdk/forms';
import {
    useNativeFormProgress,
    FormProgressConflictAlert,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-progress.css';

const bytes = new Map(),
    jobs = [],
    trace = [];
let denied = false,
    record = {
        type: 'create',
        data: { visible: 'Hydrated answer', hidden: 'Retained hidden answer' },
    },
    surfaceEnabled = true,
    configurationEligible = true,
    root;
const storage = {
    getItem(key) {
        trace.push('read');
        return bytes.get(key) ?? null;
    },
    setItem(key, value) {
        trace.push('write');
        if (denied) throw Error('Synthetic quota');
        bytes.set(key, value);
    },
    removeItem(key) {
        trace.push('remove');
        bytes.delete(key);
    },
};
const factory = (shareId, writerId = 'writer') =>
    createNativeFormProgressStorage({
        shareId,
        writerId,
        getStorage: () => storage,
        getLocks: () => ({
            request(name, callback) {
                return new Promise((resolve, reject) =>
                    jobs.push(() => {
                        try {
                            resolve(callback());
                        } catch (error) {
                            reject(error);
                        }
                    })
                );
            },
        }),
        onWarning() {},
    });
const ports = {
    readSnapshot: (share) => factory(share).read(),
    remove: (share) => factory(share).remove(),
    getWriterId: () => 'writer',
    write: (args) => factory(args.shareId, args.writerId).write(args),
    subscribeStorage(listener) {
        window.addEventListener('storage', listener);
        return () => window.removeEventListener('storage', listener);
    },
};
function Form() {
    const { hasConflict } = useNativeFormProgress({
        shareId: 'synthetic',
        surfaceEnabled,
        configurationEligible,
        record,
        ports,
    });
    return React.createElement(
        React.Fragment,
        null,
        hasConflict ? React.createElement(FormProgressConflictAlert) : null,
        React.createElement('p', { id: 'entries' }, record.data.visible),
        React.createElement(
            'p',
            { id: 'hidden-answer', hidden: true },
            record.data.hidden
        )
    );
}
const render = () => flushSync(() => root.render(React.createElement(Form)));
const api = {
    bytes,
    jobs,
    trace,
    get snapshot() {
        return factory('synthetic').read();
    },
    get react() {
        return React.version;
    },
    mount() {
        root = createRoot(document.querySelector('#app'));
        render();
    },
    publish(data) {
        record = { type: 'create', data };
        render();
    },
    surface(value) {
        surfaceEnabled = value;
        render();
    },
    config(value) {
        configurationEligible = value;
        render();
    },
    adopt() {
        record = { ...record, type: 'edit' };
        render();
    },
    release() {
        if (jobs.length === 0) throw Error('No held lock');
        jobs.shift()();
    },
    deny(value) {
        denied = value;
    },
    emit(key, newValue) {
        window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
    },
    unmount() {
        flushSync(() => root.unmount());
    },
    reset() {
        api.unmount();
        bytes.clear();
        trace.length = 0;
        record = {
            type: 'create',
            data: {
                visible: 'Hydrated answer',
                hidden: 'Retained hidden answer',
            },
        };
        surfaceEnabled = true;
        configurationEligible = true;
        denied = false;
        api.mount();
    },
};
window.progress = api;
document.querySelector('#edit').onclick = () =>
    api.publish({ visible: 'Edited answer', hidden: 'Retained hidden answer' });
document.querySelector('#baseline').onclick = () =>
    api.publish({
        visible: 'Hydrated answer',
        hidden: 'Retained hidden answer',
    });
document.querySelector('#release').onclick = () => api.release();
document.querySelector('#off').onclick = () => api.config(false);
document.querySelector('#on').onclick = () => api.config(true);
document.querySelector('#save').onclick = () => api.adopt();
document.querySelector('#foreign').onclick = () =>
    api.emit(
        'form-progress-synthetic',
        JSON.stringify({
            kind: 'miniExtensions-form-progress',
            schemaVersion: 1,
            revision: 9,
            writerId: 'foreign',
            record: { newer: true },
        })
    );
api.mount();
