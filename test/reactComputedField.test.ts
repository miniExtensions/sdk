import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import {
    ComputedField,
    composeComputedPresentation,
    projectComputedFormulaDisplay,
    type ComputedPresentationEntry,
    type ComputedFieldProps,
    type ComputedFormulaDisplay,
    type LookupPresentationOwner,
} from '../src/react/index.js';
import { projectComputedLookup } from '../src/ui/index.js';

type ValidFormula = Extract<ComputedFormulaDisplay, { isValid: true }>;
const url = 'https://computed.example.invalid/first.png';
const formula = (override: Partial<ValidFormula> = {}): ValidFormula => ({
    mode: 'controlled',
    language: 'en',
    isValid: true,
    resultType: 'singleLineText',
    value: 'Answer',
    formattedValue: 'Answer',
    ...override,
});

const lookupSource = (result: object) => ({
    id: 'computed-source',
    name: 'Computed Lookup',
    description: null,
    isPrimaryField: false,
    isComputed: true,
    config: {
        type: 'multipleLookupValues',
        options: {
            isValid: true,
            recordLinkFieldId: 'source-link',
            fieldIdInLinkedTable: 'source-result',
            result,
        },
    },
});

async function fixture(t: TestContext) {
    const window = new Window({ url: 'https://computed.example.invalid/' });
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        Node: window.Node,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            value,
            configurable: true,
            writable: true,
        });
    let requests = 0,
        opens = 0,
        writes = 0,
        submits = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        throw Error('No provider request');
    });
    t.mock.method(window, 'open', () => {
        opens++;
        return null;
    });
    const { createRoot } = await import('react-dom/client');
    const host = window.document.createElement('form');
    host.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    const sibling = window.document.createElement('input');
    sibling.value = 'Sibling draft';
    sibling.addEventListener('input', () => writes++);
    const container = window.document.createElement('div');
    host.append(sibling, container);
    window.document.body.append(host);
    const root = createRoot(container as unknown as HTMLElement);
    let active: object | null = null;
    const capture = () => {
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
            listeners,
            retire: () =>
                act(async () => {
                    if (active === token) active = null;
                    for (const listener of [...listeners]) listener();
                }),
        };
    };
    const first = capture();
    t.after(async () => {
        try {
            await act(async () => root.unmount());
            assert.deepEqual(
                { requests, opens, writes, submits },
                { requests: 0, opens: 0, writes: 0, submits: 0 }
            );
            assert.equal(sibling.value, 'Sibling draft');
        } finally {
            for (const [key, descriptor] of originals)
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            await window.happyDOM.close();
        }
    });
    const common = (owner = first.owner) => ({
        owner,
        identity: owner.token,
        language: 'en' as const,
    });
    const tree = (node: ReactNode) =>
        act(async () => root.render(h(StrictMode, null, node)));
    return {
        window,
        container,
        capture,
        first,
        common,
        tree,
        render: (props: ComputedFieldProps) => tree(h(ComputedField, props)),
        click: (node: { click(): void }) => act(async () => node.click()),
        text: () => container.textContent ?? '',
    };
}

it('masks globally before owner, identity, kind, display, or state getters', () => {
    for (const masked of [true, 'malformed']) {
        const input = Object.defineProperties(
            { masked },
            Object.fromEntries(
                ['owner', 'identity', 'kind', 'display', 'state'].map((key) => [
                    key,
                    {
                        get() {
                            throw Error(`Read ${key}`);
                        },
                    },
                ])
            )
        );
        assert.equal(
            ComputedField(input as unknown as ComputedFieldProps),
            null
        );
    }
});

it('rejects malformed Formula mode and validity before the masked fast path', async (t) => {
    const f = await fixture(t);
    for (const metadata of [
        { mode: 'legacy', isValid: true },
        { mode: 'controlled', isValid: null },
        { mode: 'controlled', isValid: 'true' },
    ]) {
        const display = Object.defineProperty(
            { ...metadata, language: 'en', obscurePassword: true },
            'value',
            {
                get() {
                    throw Error('Malformed value read');
                },
            }
        );
        await f.render({
            ...f.common(),
            kind: 'formula',
            display: display as unknown as ComputedFormulaDisplay,
        });
        assert.match(f.text(), /Unavailable/);
        assert.doesNotMatch(f.text(), /••••••••/);
    }
});

it('keeps notified retirement sticky across unavailable and current parent rerenders', async (t) => {
    const f = await fixture(t);
    let current = true;
    const listeners = new Set<() => void>();
    const owner: LookupPresentationOwner = {
        token: {},
        isCurrent: () => current,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const props: ComputedFieldProps = {
        ...f.common(owner),
        kind: 'formula',
        display: formula({ formattedValue: 'Retired capture' }),
    };
    await f.render(props);
    assert.equal(f.text(), 'Retired capture');
    await act(async () => {
        current = false;
        for (const listener of [...listeners]) listener();
    });
    await f.render(props);
    assert.match(f.text(), /Unavailable/);
    current = true;
    await f.render(props);
    assert.match(f.text(), /Unavailable/);
    assert.doesNotMatch(f.text(), /Retired capture/);
    const successor = { ...owner, token: {} };
    await f.render({
        ...f.common(successor),
        kind: 'formula',
        display: formula({ formattedValue: 'Fresh capture' }),
    });
    assert.equal(f.text(), 'Fresh capture');
});

it('renders live Formula, Rollup and ordered Lookup in the same physical field mount', async (t) => {
    const f = await fixture(t);
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: formula({ formattedValue: '€12.30' }),
    });
    assert.match(f.text(), /€12.30/);
    await f.render({
        ...f.common(),
        kind: 'rollup',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            value: '0, false, 0',
        },
    });
    assert.equal(f.text(), '0, false, 0');
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: {
            status: 'ready',
            result: {
                kind: 'sequence',
                leaves: [
                    {
                        key: 'one',
                        result: { kind: 'literal', text: 'Duplicate' },
                    },
                    {
                        key: 'two',
                        result: { kind: 'literal', text: 'Duplicate' },
                    },
                ],
            },
        },
    });
    assert.equal(f.text(), 'DuplicateDuplicate');
    assert.doesNotMatch(f.text(), /€12.30|false/);
});

it('renders the complete ordered projection pipeline for scalar, whole-array and nested Lookup answers', async (t) => {
    const f = await fixture(t);
    const config = Object.freeze({ readOnly: false });
    const canonical = Object.freeze(['Repeated', null, 'Repeated', false, 0]);
    const scalar = projectComputedLookup({
        field: lookupSource({ type: 'singleLineText', options: null }),
        value: canonical,
        displayConfig: config,
        forceReadOnly: true,
    });
    if (scalar.status !== 'ready')
        throw Error('Expected admitted scalar Lookup');
    const entries = new Map<string, ComputedPresentationEntry>(
        scalar.occurrences.map((item) => [
            item.key,
            {
                kind: 'result',
                result: { kind: 'literal', text: String(item.value) },
            },
        ])
    );
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: composeComputedPresentation({
            projection: scalar,
            entries,
            owner: f.first.owner,
        }),
    });
    assert.equal(f.text(), 'RepeatedRepeatedfalse0');
    assert.deepEqual(
        scalar.occurrences.map((item) => item.index),
        [0, 2, 3, 4]
    );
    assert.equal(config.readOnly, false);
    assert.deepEqual(canonical, ['Repeated', null, 'Repeated', false, 0]);

    const choices = [{ id: 'a', name: 'A' }];
    const wholeValue = Object.freeze(['A', 'A']);
    const whole = projectComputedLookup({
        field: lookupSource({ type: 'multipleSelects', options: { choices } }),
        value: wholeValue,
        displayConfig: config,
    });
    if (whole.status !== 'ready')
        throw Error('Expected admitted whole-array Lookup');
    assert.equal(whole.occurrences[0].value, wholeValue);
    const richEntries = new Map<string, ComputedPresentationEntry>([
        [
            whole.occurrences[0].key,
            {
                kind: 'result',
                result: {
                    kind: 'multipleSelects',
                    display: {
                        value: wholeValue,
                        choices,
                        availableChoices: choices,
                        presentation: 'dropdown',
                    },
                },
            },
        ],
    ]);
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: composeComputedPresentation({
            projection: whole,
            entries: richEntries,
            owner: f.first.owner,
        }),
    });
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-select-badge').length,
        2
    );

    const nested = projectComputedLookup({
        field: lookupSource({
            type: 'multipleLookupValues',
            options: {
                isValid: true,
                recordLinkFieldId: 'nested-link',
                fieldIdInLinkedTable: 'nested-result',
                result: { type: 'singleLineText', options: null },
            },
        }),
        value: canonical,
        displayConfig: config,
    });
    if (nested.status !== 'ready')
        throw Error('Expected nested result descriptor');
    const child = projectComputedLookup({
        field: nested.resultField,
        value: nested.occurrences[0].value,
        displayConfig: nested.displayConfig,
        keyPrefix: nested.occurrences[0].key + '/lookup',
    });
    if (child.status !== 'ready')
        throw Error('Expected child result occurrences');
    const nestedEntries = new Map<string, ComputedPresentationEntry>(
        child.occurrences.map((item) => [
            item.key,
            {
                kind: 'result',
                result: { kind: 'literal', text: String(item.value) },
            },
        ])
    );
    nestedEntries.set(nested.occurrences[0].key, {
        kind: 'nested',
        projection: child,
    });
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: composeComputedPresentation({
            projection: nested,
            entries: nestedEntries,
            owner: f.first.owner,
        }),
    });
    assert.equal(f.text(), 'RepeatedRepeatedfalse0');
    nestedEntries.delete(child.occurrences[0].key);
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: composeComputedPresentation({
            projection: nested,
            entries: nestedEntries,
            owner: f.first.owner,
        }),
    });
    assert.match(f.text(), /Unavailable/);
    assert.doesNotMatch(f.text(), /Repeated/);
    const emptyChild = { status: 'empty' as const };
    nestedEntries.set(nested.occurrences[0].key, {
        kind: 'nested',
        projection: emptyChild,
    });
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: composeComputedPresentation({
            projection: nested,
            entries: nestedEntries,
            owner: f.first.owner,
        }),
    });
    assert.match(f.text(), /No Value/);
    assert.deepEqual(canonical, ['Repeated', null, 'Repeated', false, 0]);
});

it('preserves Formula gallery selection across admitted resource successors without renewing a retired resource or Form owner', async (t) => {
    const f = await fixture(t);
    let current = true;
    const listeners = new Set<() => void>();
    const resource = {
        token: {},
        isCurrent: () => current,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const a = { url: 'https://computed.example.invalid/A.pdf' },
        c = { url: 'https://computed.example.invalid/C.pdf' };
    const display = (entries: readonly (typeof a)[], owner = resource) =>
        formula({
            value: entries.map((item) => item.url).join(' '),
            renderFormulaAsAttachment: true,
            gallery: { entries, disableDownloadFiles: true },
            resource: { owner, identity: owner.token },
        });
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: display([a, c]),
    });
    await f.click(
        f.container.querySelectorAll('li')[1]!.querySelector('button')!
    );
    assert.equal(
        f.container.querySelector('iframe')?.getAttribute('src'),
        c.url + '#toolbar=0'
    );
    await act(async () => {
        current = false;
        for (const listener of [...listeners]) listener();
    });
    assert.equal(f.container.querySelector('[role="dialog"]'), null);
    const next = { ...resource, token: {}, isCurrent: () => true };
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: display([c, a], next),
    });
    assert.equal(
        f.container.querySelector('iframe')?.getAttribute('src'),
        c.url + '#toolbar=0'
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-url-gallery__position')?.textContent,
        '1 / 2'
    );
    await f.first.retire();
    assert.equal(f.container.querySelector('[role="dialog"]'), null);
    const successor = f.capture();
    await f.render({
        ...f.common(successor.owner),
        kind: 'formula',
        display: display([c, a], next),
    });
    assert.equal(f.container.querySelector('[role="dialog"]'), null);
});

it('renders host-admitted Formula projection and recovery without evaluating concealed conversion or resources', async (t) => {
    const f = await fixture(t);
    const render = async (
        input: Parameters<typeof projectComputedFormulaDisplay>[0]
    ) => {
        const projection = projectComputedFormulaDisplay(input);
        await f.render(
            projection.status === 'ready'
                ? {
                      ...f.common(),
                      kind: 'formula',
                      display: projection.display,
                  }
                : { ...f.common(), kind: 'formula', state: projection }
        );
    };
    const base = {
        isValid: true,
        language: 'en' as const,
        resultType: 'singleLineText',
        value: '<strong>Native HTML</strong><script>bad()</script>',
        formattedValue: 'Native HTML',
    };
    let conversions = 0,
        resources = 0;
    await render({
        ...base,
        config: {
            renderFormulaAsHTML: true,
            renderFormulaAsAttachment: true,
            displayAsButton: true,
            heightForFormulaFieldHTML: 80,
            textSizeForFormulaAsTextField: 'large',
        },
        get formattedValue() {
            conversions++;
            return 'Native HTML';
        },
        formattingFailed: true,
        gallery: { entries: [] },
    });
    assert.equal(conversions, 1);
    assert.equal(
        f.container.querySelector('strong')?.textContent,
        'Native HTML'
    );
    assert.equal(f.container.querySelector('script'), null);
    assert.equal(
        f.container
            .querySelector('.mx-sdk-html')
            ?.getAttribute('style')
            ?.includes('80px'),
        true
    );
    const concealed = Object.defineProperties(
        {
            isValid: true,
            language: 'en',
            config: {
                obscurePassword: true,
                textSizeForFormulaAsTextField: 'very large',
            },
        },
        {
            value: {
                get() {
                    resources++;
                    throw Error('Private value read');
                },
            },
            formattedValue: {
                get() {
                    conversions++;
                    throw Error('Private conversion');
                },
            },
            gallery: {
                get() {
                    resources++;
                    throw Error('Private gallery');
                },
            },
        }
    );
    await render(
        concealed as Parameters<typeof projectComputedFormulaDisplay>[0]
    );
    assert.equal(f.text(), '••••••••');
    assert.equal(f.container.querySelectorAll('.text-xl').length, 1);
    assert.equal(conversions, 1);
    assert.equal(resources, 0);
    await render({ ...base, isValid: false });
    assert.match(f.text(), /invalid value/);
    await render({ ...base, config: { renderFormulaAsHTML: 'malformed' } });
    assert.match(f.text(), /Unavailable/);
    const entries = Object.freeze([{ url, filename: 'Host admitted' }]);
    await render({
        ...base,
        config: {
            renderFormulaAsAttachment: true,
            displayMode: 'icon',
            thumbnailSize: 'small',
            thumbFitType: 'contain',
            hideAttachmentName: false,
            disableOpenFiles: true,
            disableDownloadFiles: true,
        },
        gallery: { entries, owner: f.first.owner },
        resource: { owner: f.first.owner, identity: f.first.owner.token },
        buttonLabels: { openLink: 'Open supplied URL' },
    });
    assert.match(f.text(), /Host admitted/);
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-url-gallery button').length,
        0
    );
    await render({
        ...base,
        value: 'Recovered',
        formattedValue: 'Recovered',
        config: {},
    });
    assert.equal(f.text(), 'Recovered');
    await f.render({
        ...f.common(),
        kind: 'lookup',
        state: composeComputedPresentation({
            projection: { status: 'native-error', message: '#ERROR!' },
            entries: new Map(),
            owner: f.first.owner,
        }),
    });
    assert.match(f.text(), /#ERROR!/);
});

it('accepts explicit nonready Formula and Rollup admission without fabricating display facts', async (t) => {
    const f = await fixture(t);
    await f.render({
        ...f.common(),
        kind: 'formula',
        state: { status: 'unavailable' },
    });
    assert.match(f.text(), /Unavailable/);
    await f.render({ ...f.common(), kind: 'formula', display: formula() });
    assert.equal(f.text(), 'Answer');
    await f.render({
        ...f.common(),
        kind: 'rollup',
        state: { status: 'masked' },
    });
    assert.equal(f.text(), '••••••••');
    await f.render({
        ...f.common(),
        kind: 'formula',
        state: {
            status: 'ready',
            result: { kind: 'literal', text: 'Injected' },
        },
    } as unknown as ComputedFieldProps);
    assert.match(f.text(), /Unavailable/);
    assert.doesNotMatch(f.text(), /Injected/);
});

it('preserves invalid metadata, null emptiness and recovery without reading invalid value getters', async (t) => {
    const f = await fixture(t);
    const invalid = Object.defineProperty(
        { mode: 'controlled', language: 'en', isValid: false },
        'value',
        {
            get() {
                throw Error('Invalid value read');
            },
        }
    );
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: invalid as ComputedFormulaDisplay,
    });
    assert.match(
        f.container.querySelector('[role="alert"]')?.textContent ?? '',
        /invalid value/
    );
    await f.render({
        ...f.common(),
        kind: 'rollup',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            value: null,
        },
    });
    assert.match(f.text(), /No Value/);
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: formula({ formattedValue: 'Recovered' }),
    });
    assert.equal(f.text(), 'Recovered');
});

it('masks Formula before rich getters while preserving configured text size and layout', async (t) => {
    const f = await fixture(t);
    const display = Object.defineProperties(
        {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            obscurePassword: true,
            textSize: 'large',
            layout: 'cell-tall',
        },
        Object.fromEntries(
            [
                'value',
                'formattedValue',
                'resultType',
                'gallery',
                'resource',
                'select',
                'renderFormulaAsHTML',
            ].map((key) => [
                key,
                {
                    get() {
                        throw Error(`Secret ${key} read`);
                    },
                },
            ])
        )
    );
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: display as ComputedFormulaDisplay,
    });
    assert.equal(f.text(), '••••••••');
    assert.ok(f.container.querySelector('.read-only-text.text-lg'));
    assert.ok(f.container.querySelector('[data-layout="cell-tall"]'));
    assert.equal(f.container.querySelector('a,img,button,iframe,input'), null);
});

it('delegates Formula Select, HTML, attachment, button and formatted-text precedence to complete leaves', async (t) => {
    const f = await fixture(t);
    const conflict = formula({
        resultType: 'singleSelect',
        value: 'Ready',
        select: {
            choices: [
                { id: 'ready', name: 'Ready', displayName: 'Ready label' },
            ],
        },
        renderFormulaAsHTML: true,
        renderFormulaAsAttachment: true,
        displayAsButton: true,
        gallery: { entries: [{ url }], disableDownloadFiles: true },
    });
    await f.render({ ...f.common(), kind: 'formula', display: conflict });
    assert.equal(
        f.container.querySelector('.mx-sdk-select-selected')?.textContent,
        'Ready label'
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-html,.mx-sdk-url-gallery,a'),
        null
    );
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: {
            ...conflict,
            resultType: 'singleLineText',
            value: '<strong>HTML answer</strong><script>bad()</script>',
        },
    });
    assert.equal(
        f.container.querySelector('strong')?.textContent,
        'HTML answer'
    );
    assert.equal(
        f.container.querySelector('script,.mx-sdk-url-gallery,a'),
        null
    );
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: {
            ...conflict,
            resultType: 'singleLineText',
            value: url,
            renderFormulaAsHTML: false,
        },
    });
    assert.ok(f.container.querySelector('.mx-sdk-url-gallery'));
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: {
            ...conflict,
            resultType: 'singleLineText',
            value: url,
            renderFormulaAsHTML: false,
            renderFormulaAsAttachment: false,
        },
    });
    assert.equal(f.container.querySelector('a')?.getAttribute('href'), url);
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: {
            ...conflict,
            resultType: 'singleLineText',
            value: '<raw>',
            formattedValue: '<literal>',
            renderFormulaAsHTML: false,
            renderFormulaAsAttachment: false,
            displayAsButton: false,
        },
    });
    assert.equal(f.text(), '<literal>');
    assert.equal(f.container.querySelector('raw,literal'), null);
});

it('owns sibling frame IDs and rejects nested association IDs instead of duplicating Select IDs', async (t) => {
    const f = await fixture(t);
    const display = formula({
        resultType: 'singleSelect',
        value: 'Ready',
        select: { choices: [{ id: 'ready', name: 'Ready' }] },
    });
    await f.tree(
        h(
            'div',
            null,
            h('label', { id: 'label-a' }, 'A'),
            h('label', { id: 'label-b' }, 'B'),
            h(ComputedField, {
                ...f.common(),
                kind: 'formula',
                display,
                inputId: 'computed-a',
                labelledBy: 'label-a',
            }),
            h(ComputedField, {
                ...f.common(),
                kind: 'formula',
                display,
                inputId: 'computed-b',
                labelledBy: 'label-b',
            })
        )
    );
    const ids = [...f.container.querySelectorAll('[id]')].map(
        (node) => node.id
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(
        f.container
            .querySelector('#computed-a')
            ?.getAttribute('aria-labelledby'),
        'label-a'
    );
    assert.equal(
        f.container.querySelector('#computed-a')?.getAttribute('role'),
        'group'
    );
    assert.equal(
        f.container
            .querySelector('#computed-b')
            ?.getAttribute('aria-labelledby'),
        'label-b'
    );
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: {
            ...display,
            inputId: 'injected',
        } as unknown as ComputedFormulaDisplay,
    });
    assert.match(f.text(), /Unavailable/);
    assert.equal(f.container.querySelector('#injected'), null);
});

it('does not read stale display and preserves monotonic retirement across owner A to B to A', async (t) => {
    const f = await fixture(t);
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: formula({ formattedValue: 'First A' }),
    });
    const b = f.capture();
    await f.render({
        ...f.common(b.owner),
        kind: 'rollup',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            value: 'B',
        },
    });
    assert.equal(f.text(), 'B');
    const stale = Object.defineProperty(
        { ...f.common(), kind: 'formula' },
        'display',
        {
            get() {
                throw Error('Stale display read');
            },
        }
    );
    await f.render(stale as ComputedFieldProps);
    assert.match(f.text(), /Unavailable/);
    const a2 = f.capture();
    await f.render({
        ...f.common(a2.owner),
        kind: 'formula',
        display: formula({ formattedValue: 'Second A' }),
    });
    assert.equal(f.text(), 'Second A');
    await a2.retire();
    assert.match(f.text(), /Unavailable/);
    assert.equal(a2.listeners.size, 0);
});

it('retires open Formula media and its detached trigger on a physical-kind change', async (t) => {
    const f = await fixture(t);
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: formula({
            value: url,
            renderFormulaAsAttachment: true,
            gallery: {
                entries: [{ url }],
                disableDownloadFiles: true,
                labels: { attachments: 'Computed media' },
            },
        }),
    });
    const open = f.container.querySelector(`button[aria-label="${url}"]`);
    assert.ok(open instanceof f.window.HTMLButtonElement);
    await f.click(open);
    assert.equal(
        f.container
            .querySelector('[role="dialog"]')
            ?.getAttribute('aria-label'),
        'Computed media'
    );
    await f.render({
        ...f.common(),
        kind: 'rollup',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            value: 'Replacement',
        },
    });
    assert.equal(f.container.querySelector('[role="dialog"]'), null);
    await f.click(open);
    assert.equal(f.text(), 'Replacement');
    assert.equal(f.container.querySelector('[role="dialog"]'), null);
    await f.tree(null);
    assert.equal(f.first.listeners.size, 0);
});

for (const navigation of [
    { button: 'Next', key: null },
    { button: 'Next', key: 'ArrowRight' },
    { button: 'Previous', key: null },
    { button: 'Previous', key: 'ArrowLeft' },
] as const)
    it(`keeps dialog keyboard ownership when ${navigation.key ?? 'mouse'} removes ${navigation.button}`, async (t) => {
        const f = await fixture(t);
        await f.render({
            ...f.common(),
            kind: 'formula',
            display: formula({
                value: url,
                renderFormulaAsAttachment: true,
                gallery: {
                    entries: [
                        { url, filename: 'First' },
                        {
                            url: 'https://computed.example.invalid/second.png',
                            filename: 'Second',
                        },
                    ],
                    disableDownloadFiles: true,
                },
            }),
        });
        const open = f.container.querySelector(`button[aria-label="${url}"]`);
        assert.ok(open instanceof f.window.HTMLButtonElement);
        open.focus();
        await f.click(open);
        if (navigation.button === 'Previous') {
            await act(async () =>
                f.container.querySelector('[role="dialog"]')?.dispatchEvent(
                    new f.window.KeyboardEvent('keydown', {
                        key: 'ArrowRight',
                        bubbles: true,
                        cancelable: true,
                    })
                )
            );
        }
        const next = f.container.querySelector(
            `button[aria-label="${navigation.button}"]`
        );
        assert.ok(next instanceof f.window.HTMLButtonElement);
        next.focus();
        const key = navigation.key;
        if (key == null) await f.click(next);
        else
            await act(async () =>
                next.dispatchEvent(
                    new f.window.KeyboardEvent('keydown', {
                        key,
                        bubbles: true,
                        cancelable: true,
                    })
                )
            );
        assert.equal(next.isConnected, false);
        assert.ok(
            f.window.document.activeElement?.closest('[role="dialog"]'),
            'removing navigation must retain dialog keyboard ownership'
        );
        await act(async () =>
            f.window.document.activeElement?.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    key: 'Escape',
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(f.container.querySelector('[role="dialog"]'), null);
        assert.equal(f.window.document.activeElement, open);
    });

it('does not steal a deliberate connected-control focus move during boundary navigation', async (t) => {
    const f = await fixture(t);
    await f.render({
        ...f.common(),
        kind: 'formula',
        display: formula({
            value: url,
            renderFormulaAsAttachment: true,
            gallery: {
                entries: [
                    { url },
                    { url: 'https://computed.example.invalid/second.png' },
                ],
                disableDownloadFiles: true,
            },
        }),
    });
    const open = f.container.querySelector(`button[aria-label="${url}"]`);
    assert.ok(open instanceof f.window.HTMLButtonElement);
    open.focus();
    await f.click(open);
    const next = f.container.querySelector('button[aria-label="Next"]');
    const sibling = f.window.document.querySelector('form > input');
    assert.ok(next instanceof f.window.HTMLButtonElement);
    assert.ok(sibling instanceof f.window.HTMLInputElement);
    await act(async () => {
        next.focus();
        next.click();
        sibling.focus();
    });
    assert.equal(next.isConnected, false);
    assert.equal(f.window.document.activeElement, sibling);
});

it('keeps Formula resource fallback fenced when only the child capture changes during download', async (t) => {
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
        () => 'blob:unexpected-computed-download'
    );
    const childA = { token: {}, isCurrent: () => true };
    const childB = { token: {}, isCurrent: () => true };
    const props = (owner: typeof childA): ComputedFieldProps => ({
        ...f.common(),
        kind: 'formula',
        display: formula({
            value: url,
            renderFormulaAsAttachment: true,
            gallery: { entries: [{ url }], displayMode: 'icon' },
            resource: { owner, identity: 'same-resource' },
        }),
    });
    await f.render(props(childA));
    const open = f.container.querySelector(`button[aria-label="${url}"]`);
    assert.ok(open instanceof f.window.HTMLButtonElement);
    await f.click(open);
    const download = [...f.container.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === 'Download'
    );
    assert.ok(download);
    await f.click(download);
    assert.equal(fetch.mock.callCount(), 1);
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    await f.render(props(childA));
    assert.equal(signal.aborted, false);
    await f.render(props(childB));
    assert.equal(signal.aborted, true);
    assert.ok(settle);
    const finish = settle;
    await act(async () => finish(new Response(new Uint8Array([65]))));
    assert.equal(publish.mock.callCount(), 0);
});
