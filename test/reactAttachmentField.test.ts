import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, type FormEvent } from 'react';
import type { AttachmentFieldProps } from '../src/react/attachment.js';
import { scannerDom } from './fixtures/scannerDom.js';

const gallery: AttachmentFieldProps['gallery'] = {
    rows: [],
    layout: 'thumbnail',
    columns: 2,
    fit: 'cover',
    showNames: false,
    showOpen: true,
    readDownload: async () => {
        throw new Error('Rendering did not admit a download');
    },
    labels: {
        attachments: 'Attachments',
        previewNotAvailable: 'Preview unavailable',
        previous: 'Previous',
        next: 'Next',
        close: 'Close',
        delete: 'Delete',
        download: 'Download',
        open: 'Open',
        remove: 'Remove',
        retry: 'Retry',
        annotate: 'Annotate',
    },
};

test('the Attachment field selects the admitted native producer and retains localized empty feedback', async (t) => {
    const { window, host, render } = await scannerDom(t);
    const { AttachmentField } = await import('../src/react/attachment.js');
    const files: string[] = [];
    const storage = () => {
        throw new Error('Rendering did not admit storage');
    };
    let submits = 0;
    const mount = (props: Omit<AttachmentFieldProps, 'gallery'>) =>
        render(
            h(
                'form',
                {
                    id: 'attachment-form',
                    onSubmit: (event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        submits++;
                    },
                },
                h(AttachmentField, { ...props, gallery })
            )
        );

    await mount({
        input: {
            kind: 'device',
            props: {
                id: 'attachments-file',
                form: 'attachment-form',
                labels: {
                    chooseFiles: 'Choose files',
                    dragAndDrop: 'Drop here',
                },
                onFiles: (selected) =>
                    files.push(...selected.map(({ name }) => name)),
            },
        },
    });
    const picker = host.querySelector('input');
    assert.ok(picker);
    assert.equal(picker.id, 'attachments-file');
    assert.equal(picker.type, 'file');
    assert.equal(picker.form?.id, 'attachment-form');
    Object.defineProperty(picker, 'files', {
        configurable: true,
        value: [
            new window.File(['first'], 'first.txt'),
            new window.File(['second'], 'second.txt'),
        ],
    });
    await act(async () => {
        picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.deepEqual(files, ['first.txt', 'second.txt']);

    await mount({
        input: {
            kind: 'url',
            props: {
                id: 'attachments-url',
                owner: { isCurrent: () => true },
                labels: {
                    url: 'Attachment URL',
                    add: 'Add URL',
                    invalidUrl: 'Invalid URL',
                    appendRefused: 'Try again',
                },
                appendCurrent: storage,
            },
        },
    });
    assert.ok(host.querySelector('#attachments-url'));
    assert.match(host.textContent ?? '', /Add URL/);
    assert.equal(picker.isConnected, false);

    await mount({
        input: {
            kind: 'signature',
            props: {
                id: 'attachments-signature',
                ownerIdentity: 'native-field',
                value: [],
                storage: { store: storage },
                onRecovery: storage,
                appendCurrent: storage,
                config: {
                    allowTypedSignature: true,
                    allowDrawnSignature: false,
                    allowUploadedSignature: false,
                },
            },
        },
    });
    assert.ok(host.querySelector('[data-testid="signature-field-test-id"]'));
    assert.equal(host.querySelector('#attachments-url'), null);

    await mount({
        input: {
            kind: 'annotation',
            props: {
                id: 'attachments-annotation',
                owner: { token: {}, isCurrent: () => true },
                storage: { createTemporaryPng: storage, resolveUrl: storage },
                appendCurrent: storage,
            },
        },
    });
    assert.match(host.textContent ?? '', /Select an image to annotate/);
    assert.equal(
        host.querySelector('[data-testid="signature-field-test-id"]'),
        null
    );

    await mount({ emptyLabel: 'Aucune pièce jointe' });
    assert.equal(
        host.querySelector('[data-testid="no-value-test-id"]')?.textContent,
        'Aucune pièce jointe'
    );
    assert.equal(host.querySelector('input,button'), null);
    assert.equal(submits, 0);
});

test('the Attachment field renders literal validation text, links and the admitted help action', async (t) => {
    const { host, render, click } = await scannerDom(t);
    const { AttachmentField } = await import('../src/react/attachment.js');
    let help = 0;
    const update = (disabled: boolean) =>
        render(
            h(AttachmentField, {
                gallery,
                error: {
                    message:
                        'Rejected <img src=invalid>\nhttps://support.example.com/ contact@example.com',
                    help: {
                        label: 'Get help',
                        disabled,
                        onClick: () => help++,
                    },
                },
            })
        );
    await update(true);
    const alert = host.querySelector('[role="alert"]');
    assert.equal(alert?.getAttribute('data-testid'), 'alert-test-id');
    assert.match(
        alert?.querySelector('[aria-label="error-message"]')?.textContent ?? '',
        /Rejected <img src=invalid>\n/
    );
    assert.equal(alert?.querySelector('img'), null);
    assert.deepEqual(
        [...(alert?.querySelectorAll('a') ?? [])].map((link) => [
            link.getAttribute('href'),
            link.textContent,
        ]),
        [
            ['https://support.example.com/', 'Learn more'],
            ['mailto:contact@example.com', 'contact@example.com'],
        ]
    );
    await click('Get help');
    assert.equal(help, 0);
    await update(false);
    await click('Get help');
    assert.equal(help, 1);
});

test('an upload retains Escape while covered and returns focus to Cancel after the owner dismisses confirmation', async (t) => {
    const { window, document, render, click, tick, host } = await scannerDom(t);
    const { AttachmentField } = await import('../src/react/attachment.js');
    let cancellations = 0;
    let parentEscapes = 0;
    const listen = (event: InstanceType<typeof window.Event>) => {
        if (event instanceof window.KeyboardEvent && event.key === 'Escape')
            parentEscapes++;
    };
    window.addEventListener('keydown', listen);
    t.after(() => window.removeEventListener('keydown', listen));
    const update = (upload: boolean, covered = false, percentage = 37) =>
        render(
            h(
                'div',
                null,
                h('button', { id: 'opener', type: 'button' }, 'Open'),
                covered && h('button', { id: 'keep', type: 'button' }, 'Keep'),
                h(AttachmentField, {
                    gallery,
                    upload: upload
                        ? {
                              percentage,
                              labels: {
                                  uploading: 'Uploading',
                                  cancel: 'Cancel upload',
                              },
                              covered,
                              onCancel: () => cancellations++,
                          }
                        : undefined,
                })
            )
        );

    await update(false);
    const opener = [...host.querySelectorAll('button')].find(
        (button) => button.id === 'opener'
    );
    assert.ok(opener);
    opener.focus();
    await update(true);
    await tick();
    const dialog = document.querySelector(
        '[role="dialog"][aria-label="Uploading"]'
    );
    const cancel = dialog?.querySelector('button');
    assert.ok(cancel);
    const escape = async (element: {
        dispatchEvent(
            event: InstanceType<typeof window.KeyboardEvent>
        ): boolean;
    }) => {
        const event = new window.KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Escape',
        });
        await act(async () => {
            element.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, true);
    };
    await escape(cancel);
    await update(true, true, 63);
    const keep = [...host.querySelectorAll('button')].find(
        (button) => button.id === 'keep'
    );
    assert.ok(keep);
    keep.focus();
    assert.equal(dialog?.getAttribute('aria-modal'), null);
    await escape(keep);
    await click('Cancel upload');
    assert.equal(cancellations, 0);
    assert.equal(parentEscapes, 0);
    assert.equal(
        dialog?.querySelector('progress')?.getAttribute('value'),
        '63'
    );

    await update(true, false, 63);
    await tick();
    assert.equal(document.activeElement, cancel);
    await click('Cancel upload');
    assert.equal(cancellations, 1);
    await update(false);
    assert.equal(dialog?.isConnected, false);
    assert.equal(document.activeElement, opener);
});
