// @ts-check
// Verification-only host. The packed SDK owns all behavior; this file supplies
// fake responses, explicit controls and read-only inspection, never app logic.
import React, { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMiniExtensionsClient } from '@miniextensions/sdk';
import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import {
    createAuthFlow,
    createSessionRestoration,
} from '@miniextensions/sdk/auth';
import { createPortalListOwner } from '@miniextensions/sdk/portals';
import {
    TextField,
    AttachmentField,
    AttachmentDialog,
    PortalList,
} from '@miniextensions/sdk/react';

const data = __FIXTURES__;
const mode = new URL(location.href).searchParams.get('mode');
const events = [];
const calls = [];
const scope = { ownerId: 'SYNTHETIC_A', revision: 0 };
const client = createMiniExtensionsClient({
    apiOrigin: 'https://synthetic-sdk.invalid',
    fetch: async () => {
        throw Error('Unexpected I/O');
    },
});
const button = (name, onClick) =>
    h('button', { type: 'button', onClick }, name);
let snapshot;
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
window.addEventListener('unhandledrejection', (e) =>
    errors.push(String(e.reason))
);
const root = createRoot(document.querySelector('main'));
if (mode === 'attachment') {
    client.forms.save = async (input) => {
        calls.push({ operation: 'save', input });
        return { type: 'error', formValidationErrors: [], formErrors: {} };
    };
    client.attachments.uploadFile = async () => {
        throw Error('No upload permitted');
    };
    const owner = createFormFieldBindings({
        client,
        loaded: data.form,
        getScope: () => scope,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        },
    });
    const model = owner.attachment('fld_review_files', {
        journal: new RecoveryJournal(),
        loadVersion: 1,
        scope: {
            owner: 'SYNTHETIC_A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: data.form.extensionId,
            context: 'direct-url',
        },
    });
    snapshot = () => ({
        draft: owner.controller.getState().draft,
        pending: model.getSnapshot().files.map((f) => f.name),
        events,
        calls,
        errors,
    });
    function Host() {
        const [open, setOpen] = useState(true);
        return h(
            React.Fragment,
            null,
            button('Open attachment editor', () => setOpen(true)),
            open
                ? h(AttachmentDialog, {
                      onClose: () => {
                          events.push('closed');
                          setOpen(false);
                      },
                      children: h(
                          React.Fragment,
                          null,
                          h(TextField, {
                              binding: owner.field('fld_review_title'),
                          }),
                          h(AttachmentField, {
                              binding: owner.field('fld_review_files'),
                              controller: model,
                          }),
                          button('Save synthetic Form', () => {
                              void owner.save();
                          })
                      ),
                  })
                : null
        );
    }
    root.render(h(Host));
    document.addEventListener(
        'cancel',
        (event) =>
            events.push({
                type: 'cancel',
                target:
                    event.target instanceof HTMLElement
                        ? event.target.tagName
                        : 'unknown',
                trusted: event.isTrusted,
            }),
        true
    );
} else if (mode === 'portal') {
    let release;
    client.portals.listLinkedRecords = async (input) => {
        calls.push({ operation: 'list', input: structuredClone(input) });
        if (calls.length === 1)
            return new Promise((resolve) => {
                release = () => resolve(data.oldPage);
            });
        return structuredClone(data.newPage);
    };
    const owner = createPortalListOwner({
        client,
        portal: data.portal,
        portalFieldId: 'fld_children',
        criteria: data.criteria,
        getScope: () => ({ ...scope }),
        isCurrent: () => scope.revision === 0,
    });
    snapshot = () => ({ state: owner.getSnapshot(), calls, events, errors });
    const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: true };
    root.render(
        h(PortalList, {
            owner,
            readOptions,
            render: ({ snapshot: state }) =>
                h(
                    React.Fragment,
                    null,
                    h('p', { role: 'status' }, state.phase),
                    button('Load records', () => {
                        void owner
                            .readFirst(state.revision, readOptions)
                            .then((accepted) =>
                                events.push({ type: 'read-settled', accepted })
                            );
                    }),
                    button('Apply new search', () =>
                        owner.setCriteria(state.revision, {
                            ...state.criteria,
                            searchTerm: 'new query',
                        })
                    ),
                    button('Release old response', () => {
                        release?.();
                        events.push('released');
                    }),
                    button('Replace visitor', () => {
                        scope.revision++;
                        owner.getSnapshot();
                    }),
                    h(
                        'ol',
                        null,
                        ...(state.page?.recordIds ?? []).map((id) =>
                            h('li', { key: id }, id)
                        )
                    )
                ),
        })
    );
} else if (mode === 'session-off' || mode === 'session-on') {
    client.auth.login = async () => ({
        type: 'found-record',
        encryptedLoginToken: 'FAKE_ENCRYPTED_NATIVE_LOGIN',
    });
    client.loadExtension = async (input, options) => {
        calls.push({
            operation: 'load',
            credentialMatched: Object.values(options.session).includes(
                'FAKE_ENCRYPTED_NATIVE_LOGIN'
            ),
        });
        return structuredClone({
            ...data.portal,
            extensionId: data.auth.extensionId,
        });
    };
    /** @type {import('@miniextensions/sdk/auth').SessionRestorationStorage} */
    const storage = {
        mode: 'persistent',
        getItem: (key) => localStorage.getItem(key),
        setItem: (key, value) => localStorage.setItem(key, value),
        removeItem: (key) => localStorage.removeItem(key),
        subscribe(listener) {
            const handler = (event) => listener(event.key);
            window.addEventListener('storage', handler);
            return () => window.removeEventListener('storage', handler);
        },
    };
    const remembered = mode === 'session-on';
    const owner = remembered
        ? createSessionRestoration({
              client,
              page: data.auth,
              apiOrigin: 'https://synthetic-sdk.invalid',
              context: 'privacy_share_synthetic',
              loadInput: {
                  shareId: 'privacy_share_synthetic',
                  recordId: null,
                  query: {},
                  context: { type: 'direct-url' },
              },
              storage,
              getScope: () => scope,
          })
        : null;
    const flow =
        owner?.flow ??
        createAuthFlow({ client, page: data.auth, getScope: () => scope });
    snapshot = () => ({
        sessionEntries: Object.keys(client.getSession()).length,
        storageEntries: localStorage.length,
        calls,
        events,
        phase: owner?.getSnapshot().phase ?? 'memory-only',
        errors,
    });
    function Host() {
        const [status, setStatus] = useState(
            remembered ? 'Explicit restore required' : 'Memory only'
        );
        return h(
            React.Fragment,
            null,
            h('p', { role: 'status' }, status),
            button('Login fake visitor', async () => {
                if (flow.screen !== 'login_page')
                    throw Error('Expected synthetic login screen');
                const result = await flow.login({
                    loginCredentials: {
                        [data.auth.payload.loginFieldNames[0]]:
                            'FAKE_RAW_NOT_PERSISTED',
                    },
                });
                if (result.type === 'found-record') {
                    (owner ?? flow).applySession(result.grant);
                    setStatus('Fake session applied');
                }
            }),
            button('Restore fake visitor', async () => {
                const result = await owner?.restore();
                setStatus(
                    result
                        ? 'Fresh fake load accepted'
                        : 'No remembered session'
                );
            }),
            button('Logout fake visitor', () => {
                if (owner) owner.clear();
                else client.setSession({});
                setStatus('Logged out');
            })
        );
    }
    root.render(h(Host));
} else throw Error('Unknown native verification mode');
window.__nativeProbe = Object.freeze({ snapshot });
