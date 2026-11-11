import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteRecordCommentsDialog,
    recordCommentsLabels,
    type CompleteRecordCommentsDialogProps,
} from '../src/react/index.js';
import { createRecordCommentsController } from '../src/ui/index.js';
import type { ListRecordCommentsResult } from '../src/runtime/types.js';

const empty: ListRecordCommentsResult = {
    readableVersionOfRecordPrimaryValue: null,
    comments: [],
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
async function fixture(
    t: TestContext,
    patch: Partial<CompleteRecordCommentsDialogProps> = {}
) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'HTMLDialogElement',
        'Node',
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
    const host = window.document.createElement('div');
    window.document.body.append(host);
    const opener = window.document.createElement('button');
    opener.textContent = 'Opener';
    window.document.body.append(opener);
    opener.focus();
    const root = createRoot(host as unknown as HTMLElement);
    let reads = 0,
        writes = 0,
        dismissals = 0,
        invalidations = 0,
        mounted = true;
    let props: CompleteRecordCommentsDialogProps = {
        controller: createRecordCommentsController({
            owner: { isCurrent: () => true },
            childExtensionAccessToken: 'A',
            list: async () => {
                reads++;
                return empty;
            },
            append: async () => {
                writes++;
            },
            invalidate: () => {
                invalidations++;
            },
        }),
        labels: recordCommentsLabels,
        dismiss: () => {
            dismissals++;
        },
        ...patch,
    };
    const render = async () => {
        await act(async () =>
            root.render(
                h(StrictMode, null, h(CompleteRecordCommentsDialog, props))
            )
        );
    };
    const unmount = async () => {
        if (mounted) {
            mounted = false;
            await act(async () => root.unmount());
        }
    };
    t.after(async () => {
        try {
            await unmount();
        } finally {
            keys.forEach((key, index) => {
                const original = originals[index];
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    const button = (label: string) => {
        const node = [...host.querySelectorAll('button')].find(
            (node) =>
                node.getAttribute('aria-label') === label ||
                node.textContent === label
        );
        assert.ok(node, `Expected ${label}`);
        return node;
    };
    await render();
    return {
        window,
        host,
        opener,
        root,
        button,
        unmount,
        controller: props.controller,
        counts: () => ({ reads, writes, dismissals, invalidations }),
        click: async (label: string) => {
            await act(async () => button(label).click());
        },
        update: async (patch: Partial<CompleteRecordCommentsDialogProps>) => {
            props = { ...props, ...patch };
            await render();
        },
    };
}

it('server rendering allocates no read or append and escapes literal labels', () => {
    let requests = 0;
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'private-token',
        list: async () => {
            requests++;
            return empty;
        },
        append: async () => {
            requests++;
        },
        invalidate: () => {},
    });
    const html = renderToString(
        h(CompleteRecordCommentsDialog, {
            controller,
            labels: { ...recordCommentsLabels, title: '<Comentarios>' },
            dismiss: () => {},
        })
    );
    assert.ok(html.includes('&lt;Comentarios&gt;'));
    assert.ok(!html.includes('private-token'));
    assert.equal(requests, 0);
});

it('loads once under StrictMode, renders empty state and a non-submitting raw composer', async (t) => {
    const f = await fixture(t);
    assert.equal(f.counts().reads, 1);
    assert.ok(f.host.textContent.includes(recordCommentsLabels.empty));
    assert.equal(f.host.querySelectorAll('dialog,[role="dialog"]').length, 1);
    assert.equal(
        f.host.querySelector('dialog')?.getAttribute('aria-label'),
        recordCommentsLabels.title
    );
    assert.equal(f.button(recordCommentsLabels.send).disabled, true);
    assert.equal(f.button(recordCommentsLabels.send).type, 'button');
    await act(async () => f.controller.setDraft('  '));
    assert.equal(f.button(recordCommentsLabels.send).disabled, false);
    await f.click(recordCommentsLabels.send);
    assert.equal(f.counts().writes, 1);
    assert.equal(f.counts().reads, 2);
    assert.equal(f.host.querySelector('textarea')?.value, '');
});

it('hides retained history and composer during refresh and failure, then recovers explicitly', async (t) => {
    const pending = deferred<ListRecordCommentsResult>();
    let reads = 0;
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'A',
        list: async () =>
            ++reads === 1 ? empty : reads === 2 ? pending.promise : empty,
        append: async () => {},
        invalidate: () => {},
    });
    const f = await fixture(t, { controller });
    await act(async () => controller.setDraft('retained'));
    await f.click(recordCommentsLabels.refresh);
    assert.ok(f.host.querySelector('[role=status]'));
    assert.equal(f.host.querySelector('textarea'), null);
    assert.equal(f.button(recordCommentsLabels.refresh).disabled, true);
    await act(async () => pending.reject(new Error('Synthetic read failure')));
    assert.equal(
        f.host.querySelector('[role=alert]')?.textContent,
        'Synthetic read failure'
    );
    assert.equal(f.host.querySelector('textarea'), null);
    assert.equal(reads, 2);
    await f.click(recordCommentsLabels.refresh);
    assert.equal(f.host.querySelector('textarea')?.value, 'retained');
});

it('renders source union, escaped mentions and literal unresolved or inherited IDs', async (t) => {
    const mentions = Object.assign(
        Object.create({ inherited: { type: 'userGroup', name: 'forged' } }),
        { known: { type: 'userGroup', id: 'known', name: '<Ops>' } }
    );
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'A',
        list: async () => ({
            ...empty,
            comments: [
                {
                    id: 'native',
                    text: '{{Spoof}}: @[known]',
                    actor: { type: 'public', extensionId: 'ext' },
                    authorLabel: '<Verified>',
                    createdTime: '2024-01-01',
                    lastUpdatedTime: null,
                },
                {
                    id: 'legacy',
                    text: '{{Alias}}: Hi @[known] @[missing] @[inherited] @[toString]',
                    author: {
                        id: 'u',
                        name: 'Ignored',
                        email: 'ignored@example.invalid',
                    },
                    mentioned: mentions,
                    createdTime: '2024-01-01',
                    lastUpdatedTime: null,
                },
            ],
        }),
        append: async () => {},
        invalidate: () => {},
    });
    const f = await fixture(t, { controller });
    assert.ok(f.host.textContent.includes('<Verified>'));
    assert.ok(f.host.textContent.includes('{{Spoof}}: @[known]'));
    assert.ok(f.host.textContent.includes('Alias'));
    assert.ok(f.host.textContent.includes('<Ops>'));
    assert.ok(
        f.host.textContent.includes('@[missing] @[inherited] @[toString]')
    );
    assert.equal(f.host.querySelectorAll('.mx-sdk-comments-mention').length, 1);
    assert.equal(f.host.querySelector('script,Ops,Verified'), null);
});

it('pending append keeps Close/backdrop available and settles captured cache after unmount', async (t) => {
    const pending = deferred<void>();
    let writes = 0,
        invalidations = 0;
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'captured',
        list: async () => empty,
        append: async () => {
            writes++;
            await pending.promise;
        },
        invalidate: () => {
            invalidations++;
        },
    });
    const f = await fixture(t, { controller });
    await act(async () => controller.setDraft('pending'));
    await f.click(recordCommentsLabels.send);
    assert.equal(f.host.querySelector('textarea')?.disabled, true);
    assert.equal(f.button(recordCommentsLabels.send).disabled, true);
    assert.equal(f.button(recordCommentsLabels.close).disabled, false);
    await f.click(recordCommentsLabels.close);
    await act(async () => {
        const overlay = f.host.querySelector('.mx-sdk-comments-overlay');
        assert.ok(overlay instanceof f.window.HTMLElement);
        overlay.click();
    });
    assert.equal(f.counts().dismissals, 2);
    assert.equal(writes, 1);
    await f.unmount();
    assert.equal(f.window.document.activeElement, f.opener);
    await act(async () => pending.resolve());
    assert.equal(invalidations, 1);
    assert.equal(writes, 1);
});

it('newest disableSending hides composer and supplied language remains literal', async (t) => {
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'A',
        list: async () => ({ ...empty, disableSending: true }),
        append: async () => assert.fail('sending disabled'),
        invalidate: () => {},
    });
    const labels = {
        ...recordCommentsLabels,
        title: 'Comentarios',
        empty: 'Sin comentarios',
        refresh: 'Actualizar',
        close: 'Cerrar',
    };
    const f = await fixture(t, { controller, labels });
    assert.equal(
        f.host.querySelector('dialog')?.getAttribute('aria-label'),
        'Comentarios'
    );
    assert.ok(f.host.textContent.includes('Sin comentarios'));
    assert.equal(f.host.querySelector('textarea'), null);
    await f.click('Cerrar');
    assert.equal(f.counts().dismissals, 1);
});

it('owner replacement isolates successor draft from original pending append settlement', async (t) => {
    const pending = deferred<void>();
    let current = true;
    const old = createRecordCommentsController({
        owner: { isCurrent: () => current },
        childExtensionAccessToken: 'A',
        list: async () => empty,
        append: () => pending.promise,
        invalidate: () => {},
    });
    const next = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'B',
        list: async () => empty,
        append: async () => {},
        invalidate: () => {},
    });
    const f = await fixture(t, { controller: old });
    await act(async () => old.setDraft('old'));
    await f.click(recordCommentsLabels.send);
    current = false;
    await f.update({ controller: next });
    await act(async () => next.setDraft('successor'));
    await act(async () => pending.resolve());
    assert.equal(f.host.querySelector('textarea')?.value, 'successor');
    assert.equal(next.getSnapshot().sending, false);
    assert.equal(next.getSnapshot().sendError, null);
});

it('two dialogs give Escape only to the top and restore the original opener after lower unmount', async (t) => {
    const f = await fixture(t);
    const second = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'second',
        list: async () => empty,
        append: async () => {},
        invalidate: () => {},
    });
    let lower = 0,
        upper = 0;
    const render = async (showLower: boolean, showUpper: boolean) => {
        await act(async () =>
            f.root.render(
                h(
                    'div',
                    null,
                    showLower
                        ? h(CompleteRecordCommentsDialog, {
                              key: 'lower',
                              controller: f.controller,
                              labels: recordCommentsLabels,
                              dismiss: () => {
                                  lower++;
                              },
                          })
                        : null,
                    showUpper
                        ? h(CompleteRecordCommentsDialog, {
                              key: 'upper',
                              controller: second,
                              labels: {
                                  ...recordCommentsLabels,
                                  title: 'Second',
                              },
                              dismiss: () => {
                                  upper++;
                              },
                          })
                        : null
                )
            )
        );
    };
    await render(true, true);
    const dialogs = f.host.querySelectorAll('dialog');
    const close = dialogs[1].querySelector('button');
    assert.ok(close);
    close.focus();
    await act(async () =>
        f.window.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(upper, 1);
    assert.equal(lower, 0);
    await render(false, true);
    await render(false, false);
    assert.equal(f.window.document.activeElement, f.opener);
});

it('disposing an owner closes its actual dialog and restores focus without cancelling an append', async (t) => {
    const pending = deferred<void>();
    let invalidations = 0;
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'original',
        list: async () => empty,
        append: () => pending.promise,
        invalidate: () => {
            invalidations++;
        },
    });
    const f = await fixture(t, { controller });
    await act(async () => controller.setDraft('original draft'));
    await f.click(recordCommentsLabels.send);
    await act(async () => controller.dispose());
    assert.equal(f.host.querySelector('dialog'), null);
    assert.equal(f.window.document.activeElement, f.opener);
    await act(async () => pending.resolve());
    assert.equal(invalidations, 1);
    assert.equal(f.host.querySelector('dialog'), null);
});

it('older-page loading hides the composer and explicit recovery retains its draft and newest sending policy', async (t) => {
    const older = deferred<ListRecordCommentsResult>();
    let reads = 0,
        writes = 0;
    const controller = createRecordCommentsController({
        owner: { isCurrent: () => true },
        childExtensionAccessToken: 'original',
        list: async (input) => {
            reads++;
            if (reads === 1)
                return { ...empty, nextCursor: 'exact opaque cursor' };
            assert.equal(input.cursor, 'exact opaque cursor');
            return reads === 2
                ? older.promise
                : { ...empty, disableSending: true };
        },
        append: async () => {
            writes++;
        },
        invalidate: () => {},
    });
    const f = await fixture(t, { controller });
    await act(async () => controller.setDraft('retained raw draft'));
    await f.click(recordCommentsLabels.older);
    assert.equal(f.host.querySelector('textarea'), null);
    assert.equal(await controller.send(), false);
    await act(async () =>
        older.reject(new Error('Synthetic older-page failure'))
    );
    assert.equal(
        f.host.querySelector('[role=alert]')?.textContent,
        'Synthetic older-page failure'
    );
    assert.equal(f.host.querySelector('textarea')?.value, 'retained raw draft');
    assert.equal(reads, 2);
    await f.click(recordCommentsLabels.older);
    assert.equal(f.host.querySelector('textarea')?.value, 'retained raw draft');
    assert.equal(controller.getSnapshot().disableSending, false);
    assert.equal(writes, 0);
    assert.equal(reads, 3);
});
