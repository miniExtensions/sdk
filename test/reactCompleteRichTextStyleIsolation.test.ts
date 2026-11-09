import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Window } from 'happy-dom';
import {
    createElement as h,
    createRef,
    Fragment,
    type ComponentType,
    type ReactNode,
} from 'react';
import { CompleteRichTextEditor } from '../src/react/CompleteRichTextEditor.js';
import type { NativeRichTextEditorHandle } from '../src/react/NativeRichTextEditor.js';
import { completeRichTextFixture } from './completeRichTextTestHarness.js';

type ProbeProps = {
    children?: ReactNode;
    'data-testid'?: string;
};
type StyledProbe = ComponentType<ProbeProps> & { styledComponentId: string };
type StyledTemplate = {
    (strings: TemplateStringsArray, ...values: unknown[]): StyledProbe;
    withConfig(options: {
        componentId: string;
        displayName?: string;
    }): StyledTemplate;
};
type StyledRuntime = {
    default: { div: StyledTemplate };
    version: string;
    __PRIVATE__: {
        masterSheet: {
            hasNameForId(id: string, name: string): boolean;
        };
    };
};

// Narrow the precompiled CommonJS inputs here instead of importing legacy SC
// declarations into the SDK's current React/ProseMirror type graph.
const require = createRequire(import.meta.url);
function loadRuntime(path: string): StyledRuntime {
    return require(path) as StyledRuntime;
}

function appendServerTag(
    window: Window,
    attribute: string,
    id: string,
    name: string
) {
    const tag = window.document.createElement('style');
    tag.setAttribute(attribute, 'true');
    tag.setAttribute('data-styled-version', '5.3.11');
    // This is the upstream server marker grammar consumed by real rehydration.
    tag.textContent =
        `.${name}{color:rgb(77, 88, 99);}/*!sc*/\n` +
        `${attribute}.g1[id="${id}"]{content:"${name},"}/*!sc*/\n`;
    window.document.head.append(tag);
    return tag;
}

it('isolates the real complete editor from an unchanged host styled-components 5 runtime', async (t) => {
    const f = await completeRichTextFixture(t);
    const hostServerTag = appendServerTag(
        f.window,
        'data-styled',
        'host-ssr-probe',
        'hostHydrated'
    );
    const ownedServerTag = appendServerTag(
        f.window,
        'data-me-sdk-rich-text',
        'me-sdk-rich-text-ssr-probe',
        'me-sdk-rich-text-hydrated'
    );
    const unrelatedHostStyle = f.document.createElement('style');
    unrelatedHostStyle.setAttribute('data-unrelated-host-style', 'true');
    unrelatedHostStyle.textContent = '.unrelated-host { color: rgb(9, 8, 7); }';
    f.document.head.append(unrelatedHostStyle);
    const unrelatedHostBytes = unrelatedHostStyle.outerHTML;

    // Independent original/adapted modules share the real React singleton and
    // later render in the same root. No external styled-components dependency
    // or host private runtime state is needed by the SDK package.
    const host = loadRuntime(
        '../vendor/rich-markdown-editor/dependencies/styled-components/upstream/dist/styled-components.cjs.js'
    );
    assert.equal(hostServerTag.isConnected, false);
    assert.equal(ownedServerTag.isConnected, true);
    const hostStyle = f.document.querySelector<HTMLStyleElement>(
        'style[data-styled="active"]'
    );
    assert(hostStyle);
    const hostRehydratedBytes = hostStyle.outerHTML;

    const owned = loadRuntime(
        '../vendor/rich-markdown-editor/dependencies/styled-components/dist/styled-components.cjs.js'
    );
    assert.equal(ownedServerTag.isConnected, false);
    assert.equal(hostStyle.outerHTML, hostRehydratedBytes);
    const ownedStyle = f.document.querySelector<HTMLStyleElement>(
        'style[data-me-sdk-rich-text="active"]'
    );
    assert(ownedStyle);
    assert.notEqual(ownedStyle, hostStyle);
    assert.equal(host.version, '5.3.11');
    assert.equal(owned.version, '5.3.11');
    assert.equal(ownedStyle.getAttribute('data-styled-version'), '5.3.11');
    assert.equal(
        host.__PRIVATE__.masterSheet.hasNameForId(
            'host-ssr-probe',
            'hostHydrated'
        ),
        true
    );
    assert.equal(
        owned.__PRIVATE__.masterSheet.hasNameForId(
            'host-ssr-probe',
            'hostHydrated'
        ),
        false
    );
    assert.equal(
        owned.__PRIVATE__.masterSheet.hasNameForId(
            'me-sdk-rich-text-ssr-probe',
            'me-sdk-rich-text-hydrated'
        ),
        true
    );
    assert.equal(
        host.__PRIVATE__.masterSheet.hasNameForId(
            'me-sdk-rich-text-ssr-probe',
            'me-sdk-rich-text-hydrated'
        ),
        false
    );

    const HostProbe = host.default.div`
        color: rgb(11, 22, 33);
        border-top-width: 0px;
        border-top-style: solid;
        outline-width: 0px;
        outline-style: solid;
    `;
    const OwnedProbe = owned.default.div`
        color: rgb(44, 55, 66);
        border-top-width: 0px;
        border-top-style: solid;
        outline-width: 0px;
        outline-style: solid;
    `;
    // Parent component selectors expose an actual cross-runtime ID collision:
    // without isolation, both first components are sc-aXZVg and both selectors
    // style both probes even when their rule hashes happen to differ.
    const HostScope = host.default.div`
        ${HostProbe} { border-top-width: 7px; }
    `;
    const OwnedScope = owned.default.div`
        ${OwnedProbe} { outline-width: 9px; }
    `;
    const HostExplicit = host.default.div.withConfig({
        displayName: 'Probe',
        componentId: 'shared-explicit-id',
    })`display: block;`;
    const OwnedExplicit = owned.default.div.withConfig({
        displayName: 'Probe',
        componentId: 'shared-explicit-id',
    })`display: block;`;
    assert.equal(HostProbe.styledComponentId, 'sc-aXZVg');
    assert.match(OwnedProbe.styledComponentId, /me-sdk-rich-text-/);
    assert.notEqual(HostProbe.styledComponentId, OwnedProbe.styledComponentId);
    assert.equal(HostExplicit.styledComponentId, 'Probe-shared-explicit-id');
    assert.equal(
        OwnedExplicit.styledComponentId,
        'me-sdk-rich-text-Probe-shared-explicit-id'
    );

    const ref = createRef<NativeRichTextEditorHandle>();
    const render = (includeEditor: boolean) =>
        f.render(
            h(
                Fragment,
                null,
                h(
                    HostScope,
                    null,
                    h(
                        OwnedScope,
                        null,
                        h(HostProbe, { 'data-testid': 'host-probe' }, 'Host'),
                        h(OwnedProbe, { 'data-testid': 'owned-probe' }, 'SDK'),
                        h(HostExplicit, null, 'Host explicit'),
                        h(OwnedExplicit, null, 'SDK explicit')
                    )
                ),
                h('span', { className: 'hostHydrated' }, 'Host rehydrated'),
                h(
                    'span',
                    { className: 'me-sdk-rich-text-hydrated' },
                    'SDK rehydrated'
                ),
                h('span', { className: 'unrelated-host' }, 'Unrelated host'),
                includeEditor
                    ? h(CompleteRichTextEditor, {
                          ref,
                          value: '**Real complete editor**',
                          onValueChange: () => {},
                      })
                    : null
            )
        );
    await render(false);
    const hostProbe = f.container.querySelector<HTMLElement>(
        '[data-testid="host-probe"]'
    );
    const ownedProbe = f.container.querySelector<HTMLElement>(
        '[data-testid="owned-probe"]'
    );
    assert(hostProbe && ownedProbe);
    assert.equal(getComputedStyle(hostProbe).color, 'rgb(11, 22, 33)');
    assert.equal(getComputedStyle(ownedProbe).color, 'rgb(44, 55, 66)');
    assert.equal(getComputedStyle(hostProbe).borderTopWidth, '7px');
    assert.equal(getComputedStyle(ownedProbe).borderTopWidth, '0px');
    assert.equal(getComputedStyle(hostProbe).outlineWidth, '0px');
    assert.equal(getComputedStyle(ownedProbe).outlineWidth, '9px');
    assert(
        [...ownedProbe.classList].some((name) =>
            name.startsWith('me-sdk-rich-text-')
        ),
        'Expected an explicitly namespaced generated CSS class'
    );
    const hostMountedBytes = hostStyle.outerHTML;
    await render(true);
    const editor = await f.editor(ref);
    assert.equal(
        editor.view.dom.querySelector('strong')?.textContent,
        'Real complete editor'
    );
    assert(
        editor.view.dom.closest('[class*="me-sdk-rich-text-"]'),
        'The public complete editor must use the isolated real runtime'
    );
    assert.equal(hostStyle.outerHTML, hostMountedBytes);
    assert.equal(unrelatedHostStyle.outerHTML, unrelatedHostBytes);
    assert.equal(unrelatedHostStyle.isConnected, true);
    const unrelatedHost =
        f.container.querySelector<HTMLElement>('.unrelated-host');
    assert(unrelatedHost);
    assert.equal(getComputedStyle(unrelatedHost).color, 'rgb(9, 8, 7)');
    assert.equal(getComputedStyle(hostProbe).borderTopWidth, '7px');
    assert.equal(getComputedStyle(hostProbe).outlineWidth, '0px');
    assert.equal(getComputedStyle(ownedProbe).borderTopWidth, '0px');
    assert.equal(getComputedStyle(ownedProbe).outlineWidth, '9px');
});
