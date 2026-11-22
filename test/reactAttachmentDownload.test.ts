import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, useEffect, useRef } from 'react';
import {
    useAttachmentDownload,
    type AttachmentDownloadOptions,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const url = 'https://attachment.example.test/duplicate';
const response = (byte: number) =>
    new Response(new Uint8Array([byte]), {
        headers: { 'Content-Length': '1' },
    });

test('only the current same-URL occurrence publishes its allocated download', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const reads: Array<{
        url: string;
        resolve(value: Response): void;
        reject(error: Error): void;
    }> = [];
    const read = (requested: string) =>
        new Promise<Response>((resolve, reject) => {
            reads.push({ url: requested, resolve, reject });
        });
    const saved: Array<{ filename: string; href: string }> = [];
    const bytes: Blob[] = [];
    const errors: unknown[] = [];
    const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
    t.mock.method(URL, 'createObjectURL', (blob: Blob) => {
        bytes.push(blob);
        return 'blob:owned-download';
    });
    t.mock.method(
        HTMLAnchorElement.prototype,
        'click',
        function (this: HTMLAnchorElement) {
            saved.push({ filename: this.download, href: this.href });
        }
    );

    function Host(options: AttachmentDownloadOptions) {
        const { progress, start } = useAttachmentDownload(options);
        return h(
            'button',
            { type: 'button', disabled: progress != null, onClick: start },
            progress == null ? 'Download' : `${progress}%`
        );
    }
    const render = (
        identity: string,
        enabled = true,
        owner?: AttachmentDownloadOptions['owner']
    ) =>
        fixture.render(
            h(Host, {
                identity,
                url: enabled ? url : null,
                filename: 'Duplicate.svg',
                owner,
                read,
                onError: (error) => errors.push(error),
            }),
            true
        );
    const button = () => {
        const control = fixture.container.querySelector('button');
        assert.ok(control);
        return control;
    };

    await render('A');
    await fixture.click(button());
    await render('A');
    assert.equal(button().textContent, '0%');
    await render('B');
    assert.equal(button().textContent, 'Download');
    await fixture.click(button());
    await act(async () => reads[0].resolve(response(1)));
    assert.equal(button().textContent, '0%');
    assert.deepEqual(saved, []);
    await act(async () => reads[1].resolve(response(2)));
    assert.equal(button().textContent, 'Download');
    assert.deepEqual(saved, [
        { filename: 'Duplicate.svg', href: 'blob:owned-download' },
    ]);
    assert.deepEqual([...new Uint8Array(await bytes[0].arrayBuffer())], [2]);
    assert.equal(revoke.mock.callCount(), 1);

    await fixture.click(button());
    await render('A');
    await render('B');
    await act(async () => reads[2].reject(new Error('retired B')));
    assert.deepEqual(errors, []);
    await fixture.click(button());
    await render('B', false);
    await act(async () => reads[3].resolve(response(4)));
    assert.equal(saved.length, 1);

    await render('B');
    await fixture.click(button());
    await fixture.render(null);
    await act(async () => reads[4].resolve(response(5)));
    assert.equal(saved.length, 1);

    const listeners = new Set<() => void>();
    let owns = true;
    const owner = {
        token: 1,
        isCurrent: () => owns,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    await render('B', true, owner);
    assert.equal(listeners.size, 1);
    await fixture.click(button());
    await act(async () => {
        owns = false;
        for (const listener of listeners) listener();
        owns = true;
        reads[5].resolve(response(6));
    });
    assert.equal(saved.length, 1);
    assert.equal(listeners.size, 1);
    await act(async () => {
        owner.token = 2;
        for (const listener of [...listeners]) listener();
    });
    await fixture.click(button());
    owner.token = 3;
    await render('B', true, owner);
    await act(async () => reads[6].resolve(response(7)));
    assert.equal(saved.length, 1);
    assert.equal(listeners.size, 1);

    await fixture.click(button());
    assert.equal(button().textContent, '0%');
    await act(async () => {
        owner.token = 4;
        for (const listener of [...listeners]) listener();
    });
    // The parent did not render with a new owner or new options.
    assert.equal(button().textContent, 'Download');
    assert.equal(button().disabled, false);
    await fixture.click(button());
    assert.equal(reads.length, 9);
    await act(async () => reads[7].resolve(response(8)));
    assert.equal(saved.length, 1);
    assert.equal(button().textContent, '0%');
    await act(async () => reads[8].resolve(response(9)));
    assert.equal(saved.length, 2);
    assert.deepEqual([...new Uint8Array(await bytes[1].arrayBuffer())], [9]);
    assert.equal(button().textContent, 'Download');

    await fixture.render(null, true);
    assert.equal(listeners.size, 0);
    function OnFirstCommit() {
        const started = useRef(false);
        const { progress, start } = useAttachmentDownload({
            url,
            identity: 'strict-effect-replay',
            read,
        });
        useEffect(() => {
            if (started.current) return;
            started.current = true;
            void start();
        }, [start]);
        return h('button', { type: 'button' }, progress ?? 'Download');
    }
    await fixture.render(h(OnFirstCommit), true);
    assert.equal(button().textContent, 'Download');
    await act(async () => reads[9].resolve(response(10)));
    assert.equal(saved.length, 2);
    assert.deepEqual(
        reads.map((request) => request.url),
        Array(10).fill(url)
    );
    assert.equal(document.querySelector('a[download]'), null);
    fixture.unchangedEffects();
});
