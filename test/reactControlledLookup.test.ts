import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import {
    LookupField,
    type ControlledLookupFieldProps,
    type LookupPresentationOwner,
    type LookupPresentationState,
    type LookupResultPresentation,
} from '../src/react/index.js';

const literal = (text: string): LookupPresentationState => ({
    status: 'ready',
    result: { kind: 'literal', text },
});
async function fixture(t: TestContext) {
    const window = new Window({ url: 'https://lookup.example.test/' });
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        Node: window.Node,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const descriptors = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            value,
            writable: true,
            configurable: true,
        });
    let root: Root | undefined;
    let requests = 0,
        opens = 0,
        rows = 0,
        submits = 0;
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        throw Error('No Lookup provider request');
    });
    t.mock.method(window, 'open', () => {
        opens++;
        return null;
    });
    t.after(async () => {
        try {
            if (root) await act(async () => root?.unmount());
            assert.equal(requests, 0);
            assert.equal(opens, 0);
            assert.equal(rows, 0);
            assert.equal(submits, 0);
            assert.equal(fetch.mock.callCount(), 0);
        } finally {
            for (const [key, descriptor] of descriptors) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    const { createRoot } = await import('react-dom/client');
    const host = window.document.createElement('form');
    host.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    window.document.body.append(host);
    root = createRoot(host as unknown as HTMLElement);
    let active: unknown;
    function capture() {
        const token = {};
        active = token;
        const listeners = new Set<() => void>();
        const owner: LookupPresentationOwner = {
            token,
            isCurrent: () => active === token,
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        };
        return {
            owner,
            retire: async (notify = true) => {
                if (active === token) active = null;
                if (notify)
                    await act(async () => {
                        for (const listener of [...listeners]) listener();
                    });
            },
            listeners,
        };
    }
    const first = capture();
    const props = (
        state: LookupPresentationState,
        owner = first.owner
    ): ControlledLookupFieldProps => ({
        mode: 'controlled',
        state,
        owner,
        identity: owner.token,
    });
    const render = (input: ControlledLookupFieldProps) =>
        act(async () =>
            root?.render(
                h(
                    StrictMode,
                    null,
                    h(
                        'div',
                        {
                            onClick: () => {
                                rows++;
                            },
                            onKeyDown: () => {
                                rows++;
                            },
                            onPointerDown: () => {
                                rows++;
                            },
                        },
                        h(LookupField, input)
                    )
                )
            )
        );
    const click = async (node: { click(): void }) =>
        act(async () => node.click());
    return {
        host,
        window,
        first,
        capture,
        props,
        render,
        click,
        text: () => host.textContent ?? '',
    };
}

it('admits a successor owner/identity without an extra parent render', async (t) => {
    const f = await fixture(t);
    await f.render(f.props(literal('First')));
    assert.match(f.text(), /First/);
    const second = f.capture();
    await f.render(f.props(literal('Successor'), second.owner));
    assert.match(f.text(), /Successor/);
    assert.doesNotMatch(f.text(), /First|Unavailable/);
    const third = f.capture();
    await f.render(f.props(literal('First again'), third.owner));
    assert.match(f.text(), /First again/);
    assert.equal(f.first.owner.isCurrent(), false);
    assert.equal(second.owner.isCurrent(), false);
});

it('retires once for initially stale and notified owners', async (t) => {
    const f = await fixture(t);
    await f.first.retire(false);
    await f.render(f.props(literal('Hidden stale value')));
    assert.match(f.text(), /Unavailable/);
    assert.doesNotMatch(f.text(), /Hidden stale/);
    const next = f.capture();
    await f.render(f.props(literal('Current'), next.owner));
    await next.retire();
    assert.match(f.text(), /Unavailable/);
    assert.doesNotMatch(f.text(), /Current/);
    assert.equal(next.listeners.size, 0);
});

it('contains readonly row interaction and never reads a concealed projection', async (t) => {
    const f = await fixture(t);
    let inspected = 0;
    const state: LookupPresentationState = { status: 'masked' };
    Object.defineProperty(state, 'result', {
        get() {
            inspected++;
            throw Error('Private result');
        },
    });
    await f.render(f.props(state));
    assert.match(f.text(), /••••••••/);
    const control = f.host.querySelector('.mx-sdk-controlled-lookup')!;
    for (const type of [
        'click',
        'auxclick',
        'dblclick',
        'pointerdown',
        'keydown',
        'keyup',
    ])
        await act(async () => {
            control.dispatchEvent(new f.window.Event(type, { bubbles: true }));
        });
    assert.equal(inspected, 0);
});

it('rejects cyclic, sparse, duplicate and throwing presentation data and recovers', async (t) => {
    const f = await fixture(t);
    const cyclic: LookupResultPresentation = { kind: 'sequence', leaves: [] };
    Reflect.set(cyclic, 'leaves', [{ key: 'self', result: cyclic }]);
    const sparse: unknown[] = [];
    sparse[1] = { key: '1', result: { kind: 'literal', text: 'Do not leak' } };
    const sparseResult: LookupResultPresentation = {
        kind: 'sequence',
        leaves: [],
    };
    Reflect.set(sparseResult, 'leaves', sparse);
    const throwing: LookupResultPresentation = {
        kind: 'literal',
        text: 'Do not leak',
    };
    Object.defineProperty(throwing, 'kind', {
        get() {
            throw Error('Malformed kind');
        },
    });
    const duplicate: LookupResultPresentation = {
        kind: 'sequence',
        leaves: [
            { key: 'same', result: { kind: 'literal', text: 'Do not leak' } },
            { key: 'same', result: { kind: 'literal', text: 'Do not leak' } },
        ],
    };
    for (const result of [cyclic, sparseResult, throwing, duplicate]) {
        await f.render(f.props({ status: 'ready', result }));
        assert.match(f.text(), /Unavailable/);
        assert.doesNotMatch(f.text(), /Do not leak/);
    }
    const props = f.props(literal('Recovered'));
    Reflect.set(props, 'validation', [null]);
    await f.render(props);
    assert.match(f.text(), /Recovered/);
    assert.equal(
        f.host
            .querySelector('.mx-sdk-controlled-lookup')
            ?.getAttribute('aria-invalid'),
        'true'
    );
});

it('rejects malformed resource flags and undeclared image event ports before rendering', async (t) => {
    const f = await fixture(t);
    let invoked = 0;
    const avatar = { src: 'https://avatar.example.invalid/image' };
    Reflect.set(avatar, 'onLoad', () => {
        invoked++;
    });
    const people: LookupResultPresentation = {
        kind: 'people',
        items: [{ label: 'Private label', avatarSource: avatar }],
    };
    const formula: LookupResultPresentation = {
        kind: 'formula',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            resultType: 'singleLineText',
            value: 'https://resource.example.invalid/file',
            formattedValue: 'Private label',
            gallery: {
                entries: [
                    {
                        url: 'https://resource.example.invalid/file',
                        type: 'image/png',
                    },
                ],
            },
        },
    };
    Reflect.set(formula.display, 'renderFormulaAsAttachment', 'false');
    const attachments: LookupResultPresentation = {
        kind: 'attachmentCollection',
        display: {
            rows: [
                {
                    key: 'a0',
                    label: 'Private label',
                    openLabel: 'Open',
                    imageSources: [],
                    icon: 'document',
                },
            ],
            layout: 'icon',
            columns: 2,
            fit: 'contain',
            showNames: false,
            owner: { isCurrent: () => true },
            labels: {
                attachments: 'Attachments',
                retry: 'Retry',
                imageUnavailable: 'Unavailable',
            },
        },
    };
    Reflect.set(attachments.display, 'showNames', 'false');
    const editor: LookupResultPresentation = {
        kind: 'richText',
        display: {
            value: 'Private label',
            emptyLabel: 'Empty',
            language: 'en',
        },
    };
    Reflect.set(editor.display, 'ref', () => {
        invoked++;
    });
    const masked: LookupResultPresentation = {
        kind: 'singleLine',
        display: { mode: 'readOnly', language: 'en', value: 'Private label' },
    };
    Reflect.set(masked.display, 'obscurePassword', 'true');
    const sentinel = h(() => {
        invoked++;
        return h('span', null, 'Private label');
    });
    const text: LookupResultPresentation = {
        kind: 'text',
        display: { value: null, language: 'en' },
    };
    Reflect.set(text.display, 'emptyLabel', sentinel);
    const choice = { id: 'urgent', name: 'Urgent' };
    Reflect.set(choice, 'displayName', sentinel);
    const select: LookupResultPresentation = {
        kind: 'singleSelect',
        display: {
            choices: [choice],
            availableChoices: [choice],
            value: 'Urgent',
            presentation: 'dropdown',
        },
    };
    const gallery: LookupResultPresentation = {
        kind: 'urlGallery',
        display: { entries: [], labels: {} },
    };
    Reflect.set(gallery.display.labels!, 'empty', sentinel);
    for (const result of [
        people,
        formula,
        attachments,
        editor,
        masked,
        text,
        select,
        gallery,
    ]) {
        await f.render(f.props({ status: 'ready', result }));
        assert.match(f.text(), /Unavailable/);
        assert.doesNotMatch(f.text(), /Private label/);
        assert.equal(f.host.querySelector('img,video,audio,iframe'), null);
    }
    assert.equal(invoked, 0);
});

it('admits only data-only resolved collaborator image sources', async (t) => {
    const f = await fixture(t);
    let invoked = 0;
    const source = { src: 'https://avatar.example.invalid/image' };
    Reflect.set(source, 'onLoad', () => {
        invoked++;
    });
    await f.render(
        f.props({
            status: 'ready',
            result: {
                kind: 'singleCollaborator',
                display: {
                    value: {
                        id: 'ada',
                        name: 'Ada',
                        email: 'private@example.invalid',
                        profilePicUrl: 'https://avatar.example.invalid/image',
                    },
                    choices: [],
                    avatarPolicy: { type: 'source', getSource: () => source },
                },
            },
        })
    );
    assert.match(f.text(), /Ada/);
    assert.equal(f.host.querySelector('img'), null);
    assert.equal(invoked, 0);
});

for (const kind of ['singleLine', 'formula'] as const)
    it(`fences ${kind} URL actions when no resource object was supplied`, async (t) => {
        const f = await fixture(t);
        const value = 'https://resource.example.invalid/explicit';
        const result: LookupResultPresentation =
            kind === 'singleLine'
                ? {
                      kind,
                      display: {
                          mode: 'readOnly',
                          value,
                          language: 'en',
                          displayAsButton: true,
                          validButtonLabel: 'Open',
                      },
                  }
                : {
                      kind,
                      display: {
                          mode: 'controlled',
                          language: 'en',
                          isValid: true,
                          resultType: 'singleLineText',
                          value,
                          formattedValue: value,
                          displayAsButton: true,
                          validUrlButtonLabel: 'Open',
                      },
                  };
        await f.render(f.props({ status: 'ready', result }));
        const link = f.host.querySelector('a[href]');
        assert.ok(link, f.host.innerHTML);
        await f.first.retire(false);
        for (const type of ['click', 'auxclick']) {
            const event = new f.window.MouseEvent(type, {
                bubbles: true,
                cancelable: true,
            });
            await act(async () => {
                link.dispatchEvent(event);
            });
            assert.equal(event.defaultPrevented, true);
        }
    });

it('owns complete readonly Select and collaborator presentations without edit ports', async (t) => {
    const f = await fixture(t);
    const values = ['Urgent', 'Urgent'];
    await f.render(
        f.props({
            status: 'ready',
            result: {
                kind: 'multipleSelects',
                display: {
                    value: values,
                    choices: [{ id: 'urgent', name: 'Urgent', color: 'red' }],
                    availableChoices: [
                        { id: 'urgent', name: 'Urgent', color: 'red' },
                        { id: 'later', name: 'Later' },
                    ],
                    presentation: 'list',
                },
            },
        })
    );
    const inputs = f.host.querySelectorAll('input');
    assert.equal(inputs.length, 2);
    assert.ok(Array.from(inputs).every((input) => input.disabled));
    for (const input of inputs) await f.click(input);
    assert.deepEqual(values, ['Urgent', 'Urgent']);
    const ada = {
        id: 'usrAda',
        name: 'Ada',
        email: 'private@example.invalid',
        profilePicUrl: 'https://private.invalid/avatar',
    };
    const people = [ada, ada];
    await f.render(
        f.props({
            status: 'ready',
            result: {
                kind: 'multipleCollaborators',
                display: {
                    value: people,
                    choices: [],
                    avatarPolicy: { type: 'none' },
                },
            },
        })
    );
    assert.equal(
        f.host.querySelectorAll('.mx-sdk-collaborator-badge').length,
        2
    );
    assert.doesNotMatch(f.text(), /private@example/);
    assert.equal(f.host.querySelector('img'), null);
    assert.deepEqual(people, [ada, ada]);
});

it('renders a genuine table projection without list cards and captures its real Open trigger', async (t) => {
    const f = await fixture(t);
    let opened = 0;
    let trigger: HTMLElement | undefined;
    await f.render(
        f.props({
            status: 'ready',
            result: {
                kind: 'linkedCollection',
                display: {
                    layout: 'table',
                    phase: 'ready',
                    columns: [{ key: 'value', title: 'Value' }],
                    labels: {
                        empty: 'Empty',
                        loading: 'Loading',
                        unavailable: 'Unavailable',
                    },
                    rows: [
                        {
                            key: 'occurrence0',
                            cells: [
                                {
                                    key: 'value',
                                    result: {
                                        kind: 'literal',
                                        text: 'Native cell',
                                    },
                                },
                            ],
                            open: {
                                label: 'Open row',
                                run(node) {
                                    opened++;
                                    trigger = node;
                                },
                            },
                        },
                    ],
                },
            },
        })
    );
    assert.match(f.text(), /Value.*Native cell/);
    const button = Array.from(f.host.querySelectorAll('button')).find(
        (node) => node.textContent === 'Open row'
    )!;
    await f.click(button);
    assert.equal(opened, 1);
    assert.equal(trigger, button);
    await f.first.retire(false);
    await f.click(button);
    assert.equal(opened, 1);
});

it('fences stale inline HTML links while preserving the canonical sanitizer policy', async (t) => {
    const f = await fixture(t);
    await f.render(
        f.props({
            status: 'ready',
            result: {
                kind: 'html',
                html: '<a href="https://resource.example.invalid/page">Read</a><form><button>Submit</button><input type="submit"></form>',
            },
        })
    );
    const link = f.host.querySelector('a[href]');
    assert.ok(link, f.host.innerHTML);
    assert.equal(
        f.host.querySelector(
            '.mx-sdk-controlled-lookup form, .mx-sdk-controlled-lookup button, .mx-sdk-controlled-lookup input'
        ),
        null
    );
    const currentContextMenu = new f.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        link.dispatchEvent(currentContextMenu);
    });
    assert.equal(currentContextMenu.defaultPrevented, false);
    await f.first.retire(false);
    for (const type of ['click', 'auxclick', 'contextmenu']) {
        const event = new f.window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            link.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, true);
    }
    const enter = new f.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        link.dispatchEvent(enter);
    });
    assert.equal(enter.defaultPrevented, true);
    const tab = new f.window.KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        link.dispatchEvent(tab);
    });
    assert.equal(tab.defaultPrevented, false);
});

it('does not advance a retired rich card carousel or failed image to a new resource', async (t) => {
    const f = await fixture(t);
    await f.render(
        f.props({
            status: 'ready',
            result: {
                kind: 'linkedCollection',
                display: {
                    layout: 'gallery',
                    phase: 'ready',
                    labels: {
                        empty: 'Empty',
                        loading: 'Loading',
                        unavailable: 'Unavailable',
                    },
                    rows: [
                        {
                            key: 'row0',
                            card: {
                                status: 'present',
                                primary: 'Native card',
                                fields: [],
                                language: 'en',
                                layout: 'gallery',
                                images: [
                                    {
                                        id: 'first',
                                        url: 'https://images.example.invalid/first',
                                        filename: 'First',
                                    },
                                    {
                                        id: 'second',
                                        url: 'https://images.example.invalid/second',
                                        filename: 'Second',
                                    },
                                ],
                                imageFit: 'contain',
                                imageHeight: 80,
                                shouldRenderThumbnail: true,
                                thumbnailLocation: 'left',
                                fieldsPerCardRow: 1,
                                labels: {
                                    previousImage: 'Previous image',
                                    nextImage: 'Next image',
                                    noImage: 'No image',
                                },
                            },
                        },
                    ],
                },
            },
        })
    );
    const next = f.host.querySelector('button[aria-label="Next image"]');
    assert.ok(next instanceof f.window.HTMLButtonElement, f.host.innerHTML);
    await f.click(next);
    assert.equal(
        f.host.querySelector('img[data-visible="true"]')?.getAttribute('alt'),
        'Second'
    );
    const before = f.host.querySelector('.mx-sdk-finder-carousel')!.innerHTML;
    await f.first.retire(false);
    await f.click(next);
    assert.equal(
        f.host.querySelector('.mx-sdk-finder-carousel')!.innerHTML,
        before
    );
    await act(async () => {
        f.host
            .querySelector('img[data-visible="true"]')!
            .dispatchEvent(new f.window.Event('error'));
    });
    assert.equal(
        f.host.querySelector('.mx-sdk-finder-carousel')!.innerHTML,
        before
    );
});

const numericBase = {
    fieldId: 'lookup',
    title: 'Lookup',
    context: 'form',
    computed: true,
    dirty: false,
    pending: false,
    validation: [],
    error: null,
    capability: { type: 'readonly' },
} as const;
const numberConfig = { type: 'number', options: { precision: 2 } } as const;
const currencyConfig = {
    type: 'currency',
    options: { precision: 2, symbol: '€' },
} as const;
const percentConfig = { type: 'percent', options: { precision: 0 } } as const;
const dateConfig = {
    type: 'date',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
} as const;
const dateTimeConfig = {
    type: 'dateTime',
    options: {
        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone: 'utc',
    },
} as const;
function metadata<Config>(config: Config) {
    return {
        id: 'lookup',
        name: 'Lookup',
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config,
    };
}
const cohorts: [string, LookupResultPresentation, RegExp][] = [
    [
        'native Rating outside grid',
        {
            kind: 'ratingField',
            display: {
                mode: 'controlled',
                value: 8,
                max: 3,
                icon: 'heart',
                color: 'redBright',
                grid: false,
                title: 'Rating',
                labels: { empty: 'No rating' },
            },
        },
        /greater than the maximum allowed/,
    ],
    [
        'native Rating in grid',
        {
            kind: 'ratingField',
            display: {
                mode: 'controlled',
                value: 3,
                max: 5,
                icon: 'star',
                grid: true,
                title: 'Grid Rating',
            },
        },
        /mx-sdk-rating/,
    ],
    [
        'text',
        { kind: 'text', display: { value: 'Complete text', language: 'en' } },
        /Complete text/,
    ],
    [
        'single-line',
        {
            kind: 'singleLine',
            display: { mode: 'readOnly', value: 'Single line', language: 'en' },
        },
        /Single line/,
    ],
    [
        'HTML',
        { kind: 'html', html: '<b>HTML cohort</b>' },
        /<b>HTML cohort<\/b>/,
    ],
    [
        'Quill',
        { kind: 'quill', html: '<p><strong>Quill cohort</strong></p>' },
        /<strong>Quill cohort<\/strong>/,
    ],
    [
        'computed number',
        {
            kind: 'numeric',
            emptyLabel: 'Empty',
            display: {
                ...numericBase,
                physicalKind: 'number',
                field: metadata(numberConfig),
                presentation: { type: 'physical', config: numberConfig },
                value: 1234.5,
                displayConfig: {
                    showThousandsSeparator: true,
                    numberSeparator: 'space-comma',
                },
            },
        },
        /1 234,50/,
    ],
    [
        'computed currency zero',
        {
            kind: 'numeric',
            emptyLabel: 'Empty',
            display: {
                ...numericBase,
                physicalKind: 'currency',
                field: metadata(currencyConfig),
                presentation: { type: 'physical', config: currencyConfig },
                value: 0,
                displayConfig: { numberSeparator: 'comma-period' },
            },
        },
        /€0\.00/,
    ],
    [
        'native-unit percent progress',
        {
            kind: 'numeric',
            emptyLabel: 'Empty',
            display: {
                ...numericBase,
                physicalKind: 'percent',
                field: metadata(percentConfig),
                presentation: { type: 'physical', config: percentConfig },
                value: 0.25,
                displayConfig: { showAsProgressBar: true },
            },
        },
        /25%/,
    ],
    [
        'date',
        {
            kind: 'date',
            display: {
                value: '2026-11-16',
                language: 'en',
                airtableDateConfig: dateConfig,
            },
        },
        /2026-11-16/,
    ],
    [
        'date-time',
        {
            kind: 'dateTime',
            display: {
                value: '2026-11-16T12:30:00.000Z',
                language: 'en',
                airtableDateConfig: dateTimeConfig,
            },
        },
        /2026-11-16 12:30/,
    ],
    [
        'phone',
        {
            kind: 'phone',
            display: { value: '+1 555 0100', emptyLabel: 'No Value' },
        },
        /\+1 555 0100/,
    ],
    [
        'duration',
        {
            kind: 'duration',
            display: { value: 3661, format: 'h:mm:ss', language: 'en' },
        },
        /1:01:01/,
    ],
    [
        'checkbox',
        {
            kind: 'checkbox',
            value: true,
            checkedLabel: 'Checked',
            uncheckedLabel: 'Unchecked',
        },
        /aria-checked="true"/,
    ],
    [
        'barcode',
        {
            kind: 'barcode',
            display: {
                value: { text: 'barcode-value', type: 'qr' },
                language: 'en',
            },
        },
        /barcode-value/,
    ],
    [
        'choice pills',
        {
            kind: 'pills',
            items: [
                { label: 'Urgent', color: 'red' },
                { label: 'Urgent', color: 'red' },
            ],
        },
        /Urgent/,
    ],
    [
        'linked labels',
        { kind: 'linkedPills', labels: ['Record A', 'Record A'] },
        /Record A/,
    ],
    [
        'people',
        { kind: 'people', items: [{ label: 'Ada' }, { label: 'Ada' }] },
        /Ada/,
    ],
    [
        'rating',
        {
            kind: 'rating',
            value: 3,
            max: 5,
            icon: 'star',
            color: '#f5c000',
            label: '3 of 5',
            emptyLabel: 'Empty',
        },
        /3 of 5/,
    ],
    [
        'attachment collection',
        {
            kind: 'attachmentCollection',
            display: {
                rows: [
                    {
                        key: 'a0',
                        label: 'Supplied file',
                        openLabel: 'Open file',
                        imageSources: [],
                        icon: 'document',
                    },
                ],
                layout: 'icon',
                columns: 2,
                fit: 'contain',
                showNames: true,
                owner: { isCurrent: () => true },
                labels: {
                    attachments: 'Attachments',
                    retry: 'Retry',
                    imageUnavailable: 'Unavailable',
                },
            },
        },
        /Supplied file/,
    ],
    [
        'attachment images empty',
        {
            kind: 'attachmentImages',
            images: [],
            empty: 'no-values',
            emptyLabel: 'No Attachments',
        },
        /No Attachments/,
    ],
    [
        'Formula HTML',
        {
            kind: 'formula',
            display: {
                mode: 'controlled',
                language: 'en',
                isValid: true,
                resultType: 'singleLineText',
                value: '<b>Formula cohort</b>',
                formattedValue: 'Formula cohort',
                renderFormulaAsHTML: true,
            },
        },
        /<b>Formula cohort<\/b>/,
    ],
    [
        'Rollup',
        {
            kind: 'rollup',
            display: {
                mode: 'controlled',
                language: 'en',
                isValid: true,
                value: 'Rollup cohort',
            },
        },
        /Rollup cohort/,
    ],
    [
        'Rollup invalid',
        {
            kind: 'rollup',
            display: { mode: 'controlled', language: 'en', isValid: false },
        },
        /invalid value/,
    ],
    [
        'gallery empty',
        {
            kind: 'urlGallery',
            display: { entries: [], labels: { empty: 'No gallery entries' } },
        },
        /No gallery entries/,
    ],
];
function freezeFacts(value: unknown, seen = new Set<object>()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) freezeFacts(child, seen);
    Object.freeze(value);
}
for (const [name, result, expected] of cohorts)
    it(`renders admitted ${name} through the owned readonly cohort`, async (t) => {
        const f = await fixture(t);
        freezeFacts(result);
        await f.render(f.props({ status: 'ready', result }));
        assert.match(`${f.text()}\n${f.host.innerHTML}`, expected);
        if (name === 'checkbox') {
            const checkbox = f.host.querySelector('input[type="checkbox"]');
            assert.ok(checkbox instanceof f.window.HTMLInputElement);
            assert.equal(checkbox.checked, true);
            assert.equal(checkbox.disabled, true);
            assert.equal(checkbox.readOnly, true);
            await f.click(checkbox);
            assert.equal(checkbox.checked, true);
        }
        assert.equal(
            f.host
                .querySelector('.mx-sdk-controlled-lookup')
                ?.getAttribute('aria-invalid'),
            'false'
        );
        assert.doesNotMatch(
            f.host.innerHTML,
            /data-select-remove|data-collaborator-remove/
        );
    });

it('rejects nested JSX labels and malformed resource policy before any readonly child mounts', async (t) => {
    const f = await fixture(t);
    let renders = 0;
    const sentinel = h(() => {
        renders++;
        return h('span', null, 'Undeclared native renderer');
    });
    const cases: [string, LookupResultPresentation][] = [];
    const rating: LookupResultPresentation = {
        kind: 'rating',
        value: null,
        max: 5,
        icon: 'star',
        color: 'gold',
        label: 'Rating',
    };
    Reflect.set(rating, 'emptyLabel', sentinel);
    cases.push(['rating empty label', rating]);
    const numericSource = cohorts.find(
        ([name]) => name === 'computed number'
    )![1];
    assert.equal(numericSource.kind, 'numeric');
    if (numericSource.kind !== 'numeric')
        throw Error('Numeric fixture missing');
    const numeric = structuredClone(numericSource);
    numeric.display.value = null;
    Reflect.set(numeric, 'emptyLabel', sentinel);
    cases.push(['numeric empty label', numeric]);
    const duration: LookupResultPresentation = {
        kind: 'duration',
        display: { value: null, format: 'h:mm:ss', language: 'en' },
    };
    Reflect.set(duration.display, 'emptyLabel', sentinel);
    cases.push(['duration empty label', duration]);
    const rollup: LookupResultPresentation = {
        kind: 'rollup',
        display: {
            mode: 'controlled',
            isValid: true,
            value: null,
            language: 'en',
        },
    };
    Reflect.set(rollup.display, 'emptyLabel', sentinel);
    cases.push(['rollup empty label', rollup]);
    const button: LookupResultPresentation = {
        kind: 'button',
        accepted: { mode: 'controlled', value: null, messages: {} },
    };
    Reflect.set(button.accepted.messages!, 'noValue', sentinel);
    cases.push(['button empty label', button]);
    const busyButton: LookupResultPresentation = {
        kind: 'button',
        accepted: {
            mode: 'controlled',
            value: { label: 'Webhook', url: 'https://never.example.invalid/' },
            busy: true,
            config: { openLinkType: 'triggerWebhookPOST' },
            onTriggerWebhook: () => {
                throw Error('No action expected');
            },
        },
    };
    Reflect.set(busyButton.accepted, 'loadingLabel', sentinel);
    cases.push(['button loading label', busyButton]);
    const option = { id: 'supplied', name: 'Supplied' };
    Reflect.set(option, 'displayName', sentinel);
    cases.push([
        'Formula Select display name',
        {
            kind: 'formula',
            display: {
                mode: 'controlled',
                language: 'en',
                isValid: true,
                resultType: 'singleSelect',
                value: 'Supplied',
                formattedValue: 'Supplied',
                select: { choices: [option] },
            },
        },
    ]);
    const attachmentOptions = { disableDownloadFiles: true };
    Reflect.set(attachmentOptions, 'disableDownloadFiles', 'true');
    cases.push([
        'attachment suppression flag',
        {
            kind: 'singleLine',
            display: {
                mode: 'readOnly',
                language: 'en',
                value: 'https://never.example.invalid/file',
                displayAsAttachments: true,
                resource: { attachmentOptions },
            },
        },
    ]);
    const documentOptions = { source: { kind: 'uri' as const }, labels: {} };
    Reflect.set(documentOptions.labels, 'loading', sentinel);
    cases.push([
        'document renderer label',
        {
            kind: 'attachmentCollection',
            display: {
                rows: [
                    {
                        key: 'doc',
                        label: 'Document',
                        openLabel: 'Open',
                        imageSources: [],
                        icon: 'document',
                        document: {
                            uri: 'https://never.example.invalid/file',
                            options: documentOptions,
                        },
                    },
                ],
                layout: 'grid',
                columns: 2,
                fit: 'contain',
                showNames: true,
                owner: { isCurrent: () => true },
                labels: {
                    attachments: 'Attachments',
                    retry: 'Retry',
                    imageUnavailable: 'Missing image',
                },
            },
        },
    ]);
    const wrongDate: LookupResultPresentation = {
        kind: 'date',
        display: {
            language: 'en',
            value: '2026-11-16',
            airtableDateConfig: dateConfig,
        },
    };
    Reflect.set(wrongDate.display, 'airtableDateConfig', dateTimeConfig);
    cases.push(['date/config kind mismatch', wrongDate]);
    const malformedImage = { url: 'https://never.example.invalid/image' };
    Reflect.set(malformedImage, 'largeUrl', 42);
    cases.push([
        'carousel fallback source',
        {
            kind: 'attachmentImages',
            images: [malformedImage],
            empty: 'none',
            emptyLabel: 'No image',
        },
    ]);
    const wrongButton: LookupResultPresentation = {
        kind: 'button',
        accepted: {
            mode: 'controlled',
            value: { label: 'Button', url: 'https://never.example.invalid/' },
            config: {},
        },
    };
    Reflect.set(
        wrongButton.accepted.config!,
        'openLinkType',
        'otherWebhookMode'
    );
    cases.push(['undeclared webhook mode', wrongButton]);
    for (const [name, result] of cases) {
        await f.render(f.props({ status: 'ready', result }));
        assert.equal(f.text(), 'Unavailable', name);
        assert.doesNotMatch(f.text(), /Undeclared native renderer/, name);
    }
    assert.equal(renders, 0);
});

it('rejects outer presentation JSX and malformed subscriptions before child effects', async (t) => {
    const f = await fixture(t);
    let renders = 0;
    const sentinel = h(() => {
        renders++;
        return 'Undeclared native renderer';
    });
    for (const key of ['title', 'empty', 'invalidResult', 'unavailable']) {
        const input = f.props(literal('Private result'));
        if (key === 'title') {
            input.showTitle = true;
            Reflect.set(input, key, sentinel);
        } else {
            input.labels = {};
            Reflect.set(input.labels, key, sentinel);
        }
        await f.render(input);
        assert.equal(f.text(), 'Unavailable', key);
    }
    const malformed = { token: {}, isCurrent: () => true };
    Reflect.set(malformed, 'subscribe', 'not a subscription');
    await f.render(f.props(literal('Private result'), malformed));
    assert.equal(f.text(), 'Unavailable');
    assert.equal(renders, 0);
});

it('retires an allocated download when only its child resource capture changes', async (t) => {
    const f = await fixture(t);
    let settle: ((value: Response) => void) | undefined;
    let signal: AbortSignal | undefined;
    const fetch = t.mock.method(
        globalThis,
        'fetch',
        async (
            _input: Parameters<typeof globalThis.fetch>[0],
            options?: RequestInit
        ) => {
            signal = options?.signal ?? undefined;
            return new Promise<Response>((resolve) => {
                settle = resolve;
            });
        }
    );
    const publish = t.mock.method(
        URL,
        'createObjectURL',
        () => 'blob:unexpected-lookup-download'
    );
    const childA = { token: {}, isCurrent: () => true };
    const childB = { token: {}, isCurrent: () => true };
    const resultFor = (owner: typeof childA): LookupPresentationState => ({
        status: 'ready',
        result: {
            kind: 'singleLine',
            display: {
                mode: 'readOnly',
                language: 'en',
                value: 'https://resource.example.invalid/file.jpg',
                displayAsAttachments: true,
                resource: {
                    owner,
                    identity: 'same-resource',
                    attachmentOptions: { displayMode: 'icon' },
                },
            },
        },
    });
    await f.render(f.props(resultFor(childA)));
    const open = f.host.querySelector(
        'button[aria-label="https://resource.example.invalid/file.jpg"]'
    );
    assert.ok(open instanceof f.window.HTMLButtonElement, f.host.innerHTML);
    await f.click(open);
    const download = [...f.host.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === 'Download'
    );
    assert.ok(download, f.host.innerHTML);
    await f.click(download);
    assert.equal(fetch.mock.callCount(), 1);
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    await f.render(f.props(resultFor(childA)));
    assert.equal(
        signal.aborted,
        false,
        'equivalent child capture preserves its allocated operation'
    );
    await f.render(f.props(resultFor(childB)));
    assert.equal(
        signal.aborted,
        true,
        'new child capture retires the old allocation with the parent unchanged'
    );
    await act(async () => {
        settle!(
            new Response(new Uint8Array([65]), {
                headers: { 'Content-Type': 'application/octet-stream' },
            })
        );
    });
    assert.equal(publish.mock.callCount(), 0);
});
