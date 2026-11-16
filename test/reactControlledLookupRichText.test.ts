import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h } from 'react';
import {
    LookupField,
    type LookupPresentationState,
} from '../src/react/index.js';
import { completeRichTextFixture } from './completeRichTextTestHarness.js';

for (const kind of ['richText', 'markdown'] as const)
    it(`owns the real readonly ${kind} document and retires it on concealment/replacement`, async (t) => {
        const f = await completeRichTextFixture(t);
        assert.ok(f.window instanceof Window);
        let active = 1,
            requests = 0;
        t.mock.method(globalThis, 'fetch', async () => {
            requests++;
            throw Error('No Lookup rich-text transport');
        });
        t.after(() => assert.equal(requests, 0));
        const owner = (version: number) => ({
            token: {},
            isCurrent: () => active === version,
        });
        const first = owner(1);
        const value =
            '**Bold Lookup** and _emphasis_\n\n[x] Complete\n[ ] Pending';
        const result =
            kind === 'richText'
                ? {
                      kind,
                      display: {
                          value,
                          identity: 'lookup-rich-a',
                          language: 'en' as const,
                          emptyLabel: 'No rich value',
                          placeholder: 'Notes',
                          accentColor: 'rgb(99, 102, 241)',
                          linkColor: 'rgb(67, 56, 202)',
                          linkHoverColor: 'rgb(99, 102, 241)',
                      },
                  }
                : {
                      kind,
                      value,
                      identity: 'lookup-rich-a',
                      emptyLabel: 'No rich value',
                  };
        await f.render(
            h(LookupField, {
                mode: 'controlled',
                owner: first,
                identity: first.token,
                state: { status: 'ready', result },
            })
        );
        const document =
            f.container.querySelector<HTMLElement>('[role="textbox"]');
        assert.ok(document);
        assert.equal(document.getAttribute('contenteditable'), 'false');
        assert.equal(
            document.querySelector('strong')?.textContent,
            'Bold Lookup'
        );
        assert.equal(document.querySelector('em')?.textContent, 'emphasis');
        const checks = document.querySelectorAll<HTMLInputElement>(
            'input[type="checkbox"]'
        );
        assert.equal(checks.length, 2);
        assert.equal(checks[0].checked, true);
        assert.equal(checks[1].checked, false);
        const before = document.innerHTML;
        const paste = new f.window.Event('paste', {
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(paste, 'clipboardData', {
            value: {
                types: ['text/plain'],
                files: [],
                items: [],
                getData: () => 'Refused replacement',
            },
        });
        await act(async () => {
            document.dispatchEvent(paste as unknown as Event);
        });
        assert.equal(document.innerHTML, before);
        assert.equal(
            value,
            '**Bold Lookup** and _emphasis_\n\n[x] Complete\n[ ] Pending'
        );
        let inspections = 0;
        const masked: LookupPresentationState = { status: 'masked' };
        Object.defineProperty(masked, 'result', {
            get() {
                inspections++;
                throw Error('Concealed raw result');
            },
        });
        await f.render(
            h(LookupField, {
                mode: 'controlled',
                owner: first,
                identity: first.token,
                state: masked,
            })
        );
        assert.equal(document.isConnected, false);
        assert.equal(f.container.querySelector('[role="textbox"]'), null);
        assert.match(f.container.textContent ?? '', /••••••••/);
        assert.equal(inspections, 0);
        active = 2;
        const second = owner(2);
        await f.render(
            h(LookupField, {
                mode: 'controlled',
                owner: second,
                identity: second.token,
                state: {
                    status: 'ready',
                    result: {
                        kind: 'richText',
                        display: {
                            value: '**Successor document**',
                            identity: 'lookup-rich-b',
                            language: 'en',
                            emptyLabel: 'No rich value',
                        },
                    },
                },
            })
        );
        assert.equal(first.isCurrent(), false);
        assert.equal(
            f.container.querySelector('strong')?.textContent,
            'Successor document'
        );
        assert.doesNotMatch(
            f.container.textContent ?? '',
            /Bold Lookup|Refused replacement/
        );
    });
