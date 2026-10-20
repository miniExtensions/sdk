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
    createBrowserSessionStorage,
    createSessionRestoration,
} from '@miniextensions/sdk/auth';
import { createPortalListOwner } from '@miniextensions/sdk/portals';
import {
    TextField,
    TextInput,
    LiteralText,
    ActionButton,
    useCalendlyBooking,
    RatingInput,
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
if (mode === 'calendly-booking') {
    const writes = [];
    let current;
    let oldSession;
    let oldSource;
    let state;
    function Booking({ owner, booked, enabled, reentrant }) {
        const booking = useCalendlyBooking({
            configuredUrl:
                'https://calendly.com/synthetic/no-bookings?keep=yes',
            email: 'synthetic+qa&team@example.invalid',
            name: 'Synthetic & Team',
            embedDomain: location.origin,
            ownerKey: owner,
            booked,
            enabled,
            onScheduled() {
                writes.push(owner);
                if (reentrant && writes.length === 1) {
                    booking.open();
                    send(oldSource);
                }
            },
        });
        current = booking;
        return h(
            React.Fragment,
            null,
            h(
                ActionButton,
                { id: 'calendly-open', onClick: () => booking.open() },
                'Open synthetic schedule'
            ),
            booking.session
                ? h(
                      React.Fragment,
                      null,
                      h(
                          ActionButton,
                          { onClick: () => booking.session.cancel() },
                          'Cancel schedule'
                      ),
                      React.cloneElement(booking.session.frame, {
                          src: 'about:blank',
                          id: 'calendly-frame',
                      })
                  )
                : null
        );
    }
    const send = (
        source,
        origin = 'https://calendly.com',
        data = { event: 'calendly.event_scheduled' }
    ) =>
        window.dispatchEvent(
            new MessageEvent('message', { source, origin, data })
        );
    snapshot = () => ({
        ...state,
        writes: [...writes],
        url: current?.url,
        calls,
        errors,
    });
    function Host() {
        const [value, setValue] = useState({
            owner: 'A',
            booked: false,
            enabled: true,
            mounted: true,
            reentrant: false,
            submissions: 0,
        });
        state = value;
        return h(
            React.Fragment,
            null,
            h(
                'form',
                {
                    onSubmit: (event) => {
                        event.preventDefault();
                        setValue((v) => ({
                            ...v,
                            submissions: v.submissions + 1,
                        }));
                    },
                },
                value.mounted ? h(Booking, value) : null
            ),
            button('Capture old frame', () => {
                oldSession = current.session;
                oldSource = document.querySelector('iframe')?.contentWindow;
            }),
            button('Send current event', () => {
                const source = document.querySelector('iframe')?.contentWindow;
                send(source);
                send(source);
            }),
            button('Send old event', () => send(oldSource)),
            button('Send wrong origin', () =>
                send(
                    document.querySelector('iframe')?.contentWindow,
                    'https://attacker.invalid'
                )
            ),
            button('Send wrong source', () => send(window)),
            button('Cancel old session', () => oldSession?.cancel()),
            button('Change owner', () =>
                setValue((v) => ({ ...v, owner: v.owner === 'A' ? 'B' : 'A' }))
            ),
            button('Toggle booked', () =>
                setValue((v) => ({ ...v, booked: !v.booked }))
            ),
            button('Toggle enabled', () =>
                setValue((v) => ({ ...v, enabled: !v.enabled }))
            ),
            button('Enable reentrant', () =>
                setValue((v) => ({ ...v, reentrant: true }))
            ),
            button('Unmount schedule', () =>
                setValue((v) => ({ ...v, mounted: false }))
            )
        );
    }
    root.render(h(React.StrictMode, null, h(Host)));
} else if (mode === 'action-button') {
    const initial = {
        busy: false,
        disabled: false,
        mounted: true,
        activations: 0,
        submissions: 0,
        rowClicks: 0,
    };
    let state = initial;
    /** @type {import('react').RefObject<HTMLButtonElement>} */
    const action = React.createRef();
    snapshot = () => ({
        ...state,
        refConnected: action.current?.isConnected ?? false,
        calls,
        errors,
    });
    function Host() {
        const [current, setCurrent] = useState(initial);
        state = current;
        return h(
            React.Fragment,
            null,
            h(
                'form',
                {
                    id: 'action-form',
                    onSubmit: (event) => {
                        event.preventDefault();
                        setCurrent((value) => ({
                            ...value,
                            submissions: value.submissions + 1,
                        }));
                    },
                },
                h('input', {
                    'aria-label': 'Adjacent draft',
                    defaultValue: 'keep draft',
                }),
                h(
                    'div',
                    {
                        onClick: () =>
                            setCurrent((value) => ({
                                ...value,
                                rowClicks: value.rowClicks + 1,
                            })),
                    },
                    current.mounted
                        ? h(
                              ActionButton,
                              {
                                  ref: action,
                                  id: 'shared-action',
                                  busy: current.busy,
                                  disabled: current.disabled,
                                  busyContent: h(
                                      'span',
                                      null,
                                      'Running action'
                                  ),
                                  'aria-label': 'Run action',
                                  onClick: (event) => {
                                      event.stopPropagation();
                                      setCurrent((value) => ({
                                          ...value,
                                          busy: true,
                                          activations: value.activations + 1,
                                      }));
                                  },
                              },
                              'Run action'
                          )
                        : null
                )
            ),
            button('Finish action', () =>
                setCurrent((value) => ({ ...value, busy: false }))
            ),
            button('Disable action', () =>
                setCurrent((value) => ({ ...value, disabled: true }))
            ),
            button('Enable action', () =>
                setCurrent((value) => ({ ...value, disabled: false }))
            ),
            button('Unmount action', () =>
                setCurrent((value) => ({ ...value, mounted: false }))
            )
        );
    }
    root.render(h(Host));
} else if (mode === 'literal-text') {
    const initial = {
        value: '  <img src="https://synthetic.invalid/private">\n字  ',
        custom: false,
        mounted: true,
    };
    let state = initial;
    /** @type {import('react').RefObject<HTMLElement>} */
    const literal = React.createRef();
    snapshot = () => ({
        ...state,
        refConnected: literal.current?.isConnected ?? false,
        calls,
        errors,
    });
    function Host() {
        const [current, setCurrent] = useState(initial);
        state = current;
        return h(
            React.Fragment,
            null,
            current.mounted
                ? h(LiteralText, {
                      ref: literal,
                      value: current.value,
                      as: current.custom ? 'div' : 'output',
                      preserveWhitespace: !current.custom,
                      className: 'literal-display',
                      'aria-label': 'Literal result',
                      empty: h(
                          'em',
                          { id: 'literal-empty' },
                          'Localized empty'
                      ),
                      renderText: current.custom
                          ? (text) => h('p', { id: 'caller-text' }, text)
                          : undefined,
                  })
                : null,
            button('Show literal zero', () =>
                setCurrent((value) => ({ ...value, value: '0' }))
            ),
            button('Show literal empty', () =>
                setCurrent((value) => ({ ...value, value: '' }))
            ),
            button('Use caller container', () =>
                setCurrent((value) => ({
                    ...value,
                    custom: true,
                    value: 'Caller URL https://synthetic.invalid',
                }))
            ),
            button('Unmount literal display', () =>
                setCurrent((value) => ({ ...value, mounted: false }))
            )
        );
    }
    root.render(h(Host));
} else if (mode === 'uncontrolled-text') {
    /** @type {import('react').RefObject<HTMLInputElement>} */
    const sdk = React.createRef();
    /** @type {import('react').RefObject<HTMLInputElement>} */
    const native = React.createRef();
    /** @type {{owner:string,value:string}[]} */
    const changes = [];
    let revision = 0;
    snapshot = () => ({
        revision,
        changes: [...changes],
        refConnected: sdk.current?.isConnected ?? false,
        calls,
        errors,
    });
    function Host() {
        const [current, setCurrent] = useState({ revision: 0, mounted: true });
        revision = current.revision;
        return h(
            React.Fragment,
            null,
            current.mounted
                ? h(
                      'form',
                      { id: 'uncontrolled-form' },
                      h(TextInput, {
                          ref: sdk,
                          defaultValue: 'seed text',
                          'aria-label': 'SDK native search',
                          'aria-describedby': `revision-${current.revision}`,
                          onChange: (event) =>
                              changes.push({
                                  owner: 'sdk',
                                  value: event.currentTarget.value,
                              }),
                      }),
                      h('input', {
                          ref: native,
                          defaultValue: 'seed text',
                          'aria-label': 'Reference native search',
                          onChange: (event) =>
                              changes.push({
                                  owner: 'native',
                                  value: event.currentTarget.value,
                              }),
                      }),
                      h('button', { type: 'reset' }, 'Native reset')
                  )
                : null,
            button('Rerender owner', () =>
                setCurrent((value) => ({
                    ...value,
                    revision: value.revision + 1,
                }))
            ),
            button('Set controller text', () => {
                for (const node of [sdk.current, native.current])
                    if (node) {
                        node.value = 'controller text';
                        node.setSelectionRange(2, 7, 'backward');
                    }
                sdk.current?.focus();
            }),
            button('Unmount native search', () =>
                setCurrent((value) => ({ ...value, mounted: false }))
            )
        );
    }
    root.render(h(Host));
} else if (mode === 'rating') {
    const initial = {
        value: /** @type {number|null} */ (2),
        max: 5,
        disabled: false,
        grid: false,
        mounted: true,
        icon: 'star',
        color: '#FFBA05',
    };
    let state = initial;
    /** @type {(number|null)[]} */
    const changes = [];
    let submits = 0;
    /** @type {(()=>void)|undefined} */
    let retained;
    /** @type {import('react').RefObject<HTMLInputElement>} */
    const input = React.createRef();
    snapshot = () => ({
        value: state.value,
        max: state.max,
        disabled: state.disabled,
        grid: state.grid,
        changes: [...changes],
        submits,
        refCurrent:
            input.current === document.querySelector('input[type=range]'),
        refConnected: input.current?.isConnected ?? false,
        calls,
        errors,
    });
    function Host() {
        const [current, setCurrent] = useState(initial);
        state = current;
        return h(
            React.Fragment,
            null,
            h('p', { id: 'rating-help' }, 'Synthetic native rating'),
            h(
                'form',
                {
                    id: 'rating-form',
                    onSubmit: (event) => {
                        event.preventDefault();
                        submits++;
                    },
                },
                current.mounted
                    ? h(RatingInput, {
                          ref: input,
                          value: current.value,
                          max: current.max,
                          disabled: current.disabled,
                          grid: current.grid,
                          onChange: (value) => {
                              changes.push(value);
                              setCurrent((old) => ({ ...old, value }));
                          },
                          className: 'rating-root',
                          iconsClassName: 'rating-icons',
                          gridSummaryClassName: 'rating-grid-summary',
                          printSummaryClassName: 'rating-print-summary',
                          warningClassName: 'rating-warning',
                          repairClassName: 'rating-repair',
                          repairLabel: 'Repair rating',
                          empty: h(
                              'span',
                              { 'data-empty-rating': true },
                              'No rating'
                          ),
                          warningMessage: ({ value, max }) =>
                              'Synthetic value ' + value + '/' + max + '.',
                          inputProps: {
                              id: 'native-rating',
                              form: 'rating-form',
                              'aria-label': 'Synthetic rating',
                              'aria-describedby': 'rating-help',
                          },
                          renderIcon: (icon) => {
                              if (icon.index === 4 && !retained)
                                  retained = icon.activate;
                              return h(
                                  'svg',
                                  {
                                      width: 24,
                                      height: 24,
                                      viewBox: '0 0 24 24',
                                      'aria-hidden': true,
                                      'data-rating-index': icon.index,
                                      'data-shape': current.icon,
                                      'data-focused': String(icon.focused),
                                      onClick: icon.activate,
                                  },
                                  h('path', {
                                      fill: icon.filled
                                          ? current.color
                                          : '#e5e7eb',
                                      d:
                                          current.icon === 'heart'
                                              ? 'M12 21L2 10C-2 2 8 0 12 6C16 0 26 2 22 10Z'
                                              : 'M12 1L15 8L23 9L17 14L19 23L12 18L5 23L7 14L1 9L9 8Z',
                                  })
                              );
                          },
                      })
                    : null
            ),
            button('Toggle readonly', () =>
                setCurrent((old) => ({ ...old, disabled: !old.disabled }))
            ),
            button('Toggle grid', () =>
                setCurrent((old) => ({ ...old, grid: !old.grid }))
            ),
            button('Theme heart', () =>
                setCurrent((old) => ({
                    ...old,
                    icon: 'heart',
                    color: '#DC043B',
                }))
            ),
            button('Lower maximum', () =>
                setCurrent((old) => ({ ...old, max: 3 }))
            ),
            button('Set stale value', () =>
                setCurrent((old) => ({ ...old, value: 8 }))
            ),
            button('Clear externally', () =>
                setCurrent((old) => ({ ...old, value: null }))
            ),
            button('Invoke captured icon', () => retained?.()),
            button('Unmount rating', () =>
                setCurrent((old) => ({ ...old, mounted: false }))
            )
        );
    }
    root.render(h(Host));
} else if (mode === 'attachment') {
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
    const storage = createBrowserSessionStorage(
        localStorage,
        'persistent',
        window
    );
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
    // Bounded, document-local diagnostics: never record keys or credential bytes.
    /** @param {string} type @param {Record<string, unknown>} [details] */
    const recordSessionEvent = (type, details = {}) => {
        let storageEntries = null;
        try {
            storageEntries = localStorage.length;
        } catch {
            // Diagnostics must not alter restoration when storage is unavailable.
        }
        if (events.length >= 128) events.shift();
        events.push({
            type,
            at: performance.now(),
            phase: owner?.getSnapshot().phase ?? 'memory-only',
            sessionEntries: Object.keys(client.getSession()).length,
            storageEntries,
            ...details,
        });
    };
    owner?.subscribe(() => recordSessionEvent('phase'));
    window.addEventListener('storage', (event) => {
        let area = 'unavailable';
        let matchesStoredKey = false;
        try {
            area =
                event.storageArea === localStorage
                    ? 'local'
                    : event.storageArea === sessionStorage
                      ? 'session'
                      : 'other';
            matchesStoredKey =
                event.key !== null && event.key === localStorage.key(0);
        } catch {
            // Keep the notification observable without reading private values.
        }
        recordSessionEvent('storage-event', {
            area,
            clear: event.key === null,
            matchesStoredKey,
            trusted: event.isTrusted,
        });
    });
    recordSessionEvent('initialized');
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
                recordSessionEvent('login-click');
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
                    recordSessionEvent('login-applied');
                    setStatus('Fake session applied');
                }
            }),
            button('Restore fake visitor', async () => {
                recordSessionEvent('restore-click');
                const result = await owner?.restore();
                recordSessionEvent('restore-settled', {
                    accepted: result != null,
                });
                setStatus(
                    result
                        ? 'Fresh fake load accepted'
                        : 'No remembered session'
                );
            }),
            button('Logout fake visitor', () => {
                recordSessionEvent('logout-click');
                if (owner) owner.clear();
                else client.setSession({});
                recordSessionEvent('logout-settled');
                setStatus('Logged out');
            })
        );
    }
    root.render(h(Host));
} else throw Error('Unknown native verification mode');
window.__nativeProbe = Object.freeze({ snapshot });
