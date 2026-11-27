import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement, StrictMode, act, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { AttachmentDialog, AttachmentField } from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

function attachmentTestDom() {
    const window = new Window();
    const globals = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const original = globals.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    globals.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        })
    );
    return {
        window,
        async close() {
            globals.forEach((key, index) => {
                const previous = original[index];
                if (previous) Object.defineProperty(globalThis, key, previous);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        },
    };
}

it('picker cancellation preserves owner-held queue and draft across StrictMode remounts', async () => {
    const { window, close } = attachmentTestDom();
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('No request expected');
        },
    });
    let visible = true;
    const loaded = loadedForm();
    const nativeRow = {
        url: 'https://files.example.test/PRIVATE_url',
        filename: 'PRIVATE_existing.txt',
        size: 7,
    };
    loaded.payload.formRecord.data.fld_files = [nativeRow, nativeRow];
    const owner = createFormFieldBindings({
        canWriteField: () => visible,
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    });
    const attachment = owner.attachment('fld_files', {
        journal: new RecoveryJournal(),
        loadVersion: 1,
        scope: {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: 'form',
            context: 'modal',
        },
    });
    const file = new window.File(['content'], 'PRIVATE_filename.txt', {
        type: 'text/plain',
    });
    let closes = 0;
    let root = createRoot(window.document.body as unknown as HTMLElement);
    const render = () =>
        createElement(
            StrictMode,
            null,
            createElement(AttachmentDialog, {
                onClose: () => closes++,
                children: createElement(
                    'div',
                    null,
                    createElement(AttachmentField, {
                        binding: owner.field('fld_files'),
                        controller: attachment,
                    }),
                    createElement(AttachmentField, {
                        binding: owner.field('fld_files'),
                        controller: attachment,
                        render: ({ attachment: state, controller }) =>
                            createElement(
                                'aside',
                                null,
                                createElement(
                                    'p',
                                    null,
                                    state.files.length === 0
                                        ? 'Custom no pending files'
                                        : 'Custom pending files'
                                ),
                                ...state.rows.map((row) =>
                                    createElement(
                                        'div',
                                        { key: row.nativeIndex },
                                        createElement('span', null, row.label),
                                        createElement(
                                            'button',
                                            {
                                                type: 'button',
                                                disabled: !row.removeAllowed,
                                                onClick: () =>
                                                    controller.remove(
                                                        state.valuesRevision,
                                                        row.nativeIndex
                                                    ),
                                            },
                                            'Custom remove'
                                        )
                                    )
                                )
                            ),
                    })
                ),
            })
        );
    try {
        assert.equal(
            owner.field('fld_title').setValue('Dirty draft').accepted,
            true
        );
        assert.equal(attachment.select([file as unknown as File]), true);
        let cleared = false;
        const stopNested = attachment.subscribe((snapshot) => {
            if (!cleared && snapshot.rows.length === 1) {
                cleared = true;
                attachment.clear();
            }
        });
        await act(async () => root.render(render()));
        const removals = [...window.document.querySelectorAll('button')].filter(
            (button) => button.textContent === 'Remove attachment'
        );
        const stale = removals[1];
        await act(async () => removals[0].click());
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
            nativeRow,
        ]);
        assert.equal(cleared, true);
        assert.deepEqual(attachment.getSnapshot().files, []);
        assert.ok(
            window.document.body.textContent!.includes('No pending files')
        );
        stopNested();
        await act(async () =>
            assert.equal(attachment.select([file as unknown as File]), true)
        );
        await act(async () =>
            stale.dispatchEvent(new window.Event('click', { bubbles: true }))
        );
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, [
            nativeRow,
        ]);
        const customRemove = [
            ...window.document.querySelectorAll('button'),
        ].find((button) => button.textContent === 'Custom remove')!;
        await act(async () => customRemove.click());
        assert.deepEqual(owner.field('fld_files').getSnapshot().value, []);
        assert.equal(owner.field('fld_files').getSnapshot().dirty, true);
        assert.equal(attachment.getSnapshot().files[0], file);
        assert.equal(
            window.document.body.innerHTML.includes('PRIVATE_existing'),
            false
        );
        assert.equal(
            window.document.body.innerHTML.includes('PRIVATE_url'),
            false
        );
        const input = window.document.querySelector('input[type=file]')!;
        await act(async () =>
            input.dispatchEvent(
                new window.Event('cancel', { bubbles: true, cancelable: true })
            )
        );
        assert.equal(closes, 0);
        assert.equal(attachment.getSnapshot().files[0], file);
        assert.equal(
            owner.field('fld_title').getSnapshot().value,
            'Dirty draft'
        );
        assert.equal(owner.field('fld_title').getSnapshot().dirty, true);
        assert.equal(
            window.document.body.textContent!.includes('PRIVATE_filename'),
            false
        );
        assert.equal(attachment.select([]), false);
        assert.equal(attachment.getSnapshot().files[0], file);
        await act(async () => root.unmount());
        root = createRoot(window.document.body as unknown as HTMLElement);
        await act(async () => root.render(render()));
        assert.equal(attachment.getSnapshot().files[0], file);
        await act(async () =>
            window.document.querySelector('dialog')!.dispatchEvent(
                new window.Event('cancel', {
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(closes, 1);
        const close = [...window.document.querySelectorAll('button')].find(
            (button) => button.textContent === 'Close'
        )!;
        await act(async () => close.click());
        assert.equal(closes, 2);
        assert.equal(attachment.getSnapshot().files[0], file);
        await act(async () => {
            visible = false;
            owner.refresh();
        });
        assert.equal(
            window.document
                .querySelector('section')!
                .getAttribute('aria-label'),
            'Pending attachment activity'
        );
        assert.equal(window.document.querySelector('[aria-label=Files]'), null);
        const clear = [...window.document.querySelectorAll('button')].find(
            (button) => button.textContent === 'Clear pending files'
        )!;
        await act(async () => clear.click());
        assert.equal(attachment.getSnapshot().files.length, 0);
        assert.equal(
            owner.field('fld_title').getSnapshot().value,
            'Dirty draft'
        );
    } finally {
        await act(async () => root.unmount());
        owner.destroy();
        await close();
    }
});

for (const gesture of ['mouse', 'Space'] as const) {
    it(`preserves a same-row attachment replacement during a held ${gesture} Remove`, async () => {
        const { window, close } = attachmentTestDom();
        const original = {
            id: 'attOriginal',
            filename: 'Shared.txt',
            url: 'https://files.example.test/original',
        };
        const replacement = {
            ...original,
            id: 'attReplacement',
            url: 'https://files.example.test/replacement',
        };
        const keeper = {
            id: 'attKeeper',
            filename: 'Keeper.txt',
            url: 'https://files.example.test/keep',
        };
        const calls = { fetch: 0, upload: 0, save: 0, submit: 0 };
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                calls.fetch++;
                throw Error('Unexpected request');
            },
        });
        client.attachments.uploadFile = async () => {
            calls.upload++;
            throw Error('Unexpected upload');
        };
        client.forms.save = async () => {
            calls.save++;
            throw Error('Unexpected Save');
        };
        const loaded = loadedForm();
        loaded.payload.formRecord.data.fld_files = [original, keeper];
        const owner = createFormFieldBindings({
            client,
            loaded,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'held-remove', revision: 0 }),
        });
        const binding = owner.field('fld_files');
        const attachment = owner.attachment('fld_files', {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'held-remove',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
        });
        const root = createRoot(window.document.body as unknown as HTMLElement);
        const removeButton = () =>
            [...window.document.querySelectorAll('button')].find(
                (button) =>
                    button.getAttribute('aria-label') === 'Remove attachment 1'
            )!;
        const pointer = {
            bubbles: true,
            cancelable: true,
            isPrimary: true,
            button: 0,
            pointerId: 1,
            pointerType: 'mouse',
        };
        const space = {
            bubbles: true,
            cancelable: true,
            key: ' ',
            code: 'Space',
        };
        const press = (button: ReturnType<typeof removeButton>) => {
            button.focus();
            button.dispatchEvent(
                gesture === 'Space'
                    ? new window.KeyboardEvent('keydown', space)
                    : new window.PointerEvent('pointerdown', pointer)
            );
        };
        const release = (button: ReturnType<typeof removeButton>) => {
            if (gesture === 'Space') {
                if (
                    button.dispatchEvent(
                        new window.KeyboardEvent('keyup', space)
                    )
                )
                    button.click();
                return;
            }
            button.dispatchEvent(new window.PointerEvent('pointerup', pointer));
            button.dispatchEvent(
                new window.MouseEvent('click', { ...pointer, detail: 1 })
            );
        };
        try {
            await act(async () =>
                root.render(
                    createElement(
                        'form',
                        {
                            onSubmit(event: FormEvent<HTMLFormElement>) {
                                event.preventDefault();
                                calls.submit++;
                            },
                        },
                        createElement(AttachmentField, {
                            binding,
                            controller: attachment,
                        })
                    )
                )
            );
            const button = removeButton();
            await act(async () => press(button));
            await act(async () =>
                assert.equal(
                    binding.setValue([replacement, keeper]).accepted,
                    true
                )
            );
            assert.equal(removeButton(), button);
            assert.equal(button.isConnected, true);
            assert.equal(window.document.activeElement, button);
            const refreshedRevision = owner.controller.getState().draftRevision;
            assert(refreshedRevision !== null);
            await act(async () => release(button));
            assert.deepEqual(binding.getSnapshot().value, [
                replacement,
                keeper,
            ]);
            assert.equal(
                owner.controller.getState().draftRevision,
                refreshedRevision
            );
            await act(async () => {
                press(button);
                release(button);
            });
            assert.deepEqual(binding.getSnapshot().value, [keeper]);
            assert.equal(
                owner.controller.getState().draftRevision,
                refreshedRevision + 1
            );
            assert.deepEqual(calls, {
                fetch: 0,
                upload: 0,
                save: 0,
                submit: 0,
            });
        } finally {
            await act(async () => root.unmount());
            owner.destroy();
            await close();
        }
    });
}
