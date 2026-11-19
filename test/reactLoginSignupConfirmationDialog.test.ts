import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h, Fragment, useState } from 'react';
import { renderToString } from 'react-dom/server';
import {
    LoginSignupConfirmationDialog,
    type LoginSignupConfirmationCopy,
} from '../src/react/LoginSignupConfirmationDialog.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const draft = 'masked-signup@example.invalid';
const copy: LoginSignupConfirmationCopy = {
    title: '•••••••• n’existe pas',
    body: 'Vérifiez la valeur ou créez un nouvel enregistrement.',
    back: 'Retour',
    create: 'Créer',
};

it('renders only the supplied confirmation copy on the server', () => {
    const props = {
        attemptId: 'server-attempt',
        copy,
        onCancel: () => assert.fail('SSR cannot cancel'),
        onCreate: () => assert.fail('SSR cannot create'),
    };
    assert.equal(
        renderToString(
            h(LoginSignupConfirmationDialog, { ...props, open: false })
        ),
        ''
    );
    const markup = renderToString(
        h(LoginSignupConfirmationDialog, { ...props, open: true })
    );
    assert.match(markup, /•••••••• n’existe pas/);
    assert.match(markup, /aria-describedby=/);
    assert.doesNotMatch(markup, /masked-signup@example\.invalid/);
});

it('preserves the masked host draft and admits only one intent per opening', async (t) => {
    const ui = await htmlPresentationFixture(t);
    let cancels = 0;
    let creates = 0;
    const Host = () => {
        const [open, setOpen] = useState(false);
        return h(
            Fragment,
            null,
            h('input', { type: 'password', defaultValue: draft }),
            h(
                'button',
                { type: 'button', onClick: () => setOpen(true) },
                'Open signup'
            ),
            h(LoginSignupConfirmationDialog, {
                open,
                attemptId: 'masked-attempt',
                copy,
                onCancel() {
                    cancels++;
                    setOpen(false);
                },
                onCreate() {
                    creates++;
                },
            })
        );
    };

    await ui.render(h(Host));
    const opener = ui.container.querySelector('button');
    const field = ui.container.querySelector('input');
    assert(opener && field);
    const open = async () => {
        await ui.click(opener);
        const dialog = ui.container.querySelector('dialog[open]');
        assert(dialog);
        const [back, create] = dialog.querySelectorAll('button');
        assert(back && create);
        assert.equal(ui.window.document.activeElement, back);
        assert.equal(back.type, 'button');
        assert.equal(create.type, 'button');
        assert(!dialog.outerHTML.includes(draft));
        return { dialog, back, create };
    };

    opener.focus();
    await ui.click((await open()).back);
    assert.equal(ui.container.querySelector('dialog'), null);
    assert.equal(ui.window.document.activeElement, opener);
    assert.equal(field.value, draft);
    assert.equal(cancels, 1);
    assert.equal(creates, 0);

    const closing = await open();
    const cancel = new ui.window.Event('cancel', { cancelable: true });
    await act(async () => {
        closing.dialog.dispatchEvent(cancel);
    });
    assert(cancel.defaultPrevented);
    assert.equal(ui.container.querySelector('dialog'), null);
    assert.equal(ui.window.document.activeElement, opener);
    assert.equal(field.value, draft);
    assert.equal(cancels, 2);
    assert.equal(creates, 0);

    const pending = await open();
    await act(async () => {
        pending.create.click();
        pending.create.click();
        pending.dialog.dispatchEvent(
            new ui.window.Event('cancel', { cancelable: true })
        );
    });
    assert.equal(creates, 1);
    assert.equal(cancels, 2);
    assert(pending.create.disabled);
    assert(pending.back.disabled);
    assert.equal(field.value, draft);
    ui.unchangedEffects();
});

it('retires held decisions when an attempt is replaced, suspended, or closed', async (t) => {
    const ui = await htmlPresentationFixture(t);
    const intents: string[] = [];
    const render = (
        attemptId: string,
        { open = true, disabled = false } = {}
    ) =>
        ui.render(
            h(
                Fragment,
                null,
                h('input', { type: 'password', defaultValue: draft }),
                h('button', { type: 'button' }, 'Open signup'),
                h(LoginSignupConfirmationDialog, {
                    open,
                    disabled,
                    attemptId,
                    copy: { ...copy },
                    onCancel: () => intents.push('cancel ' + attemptId),
                    onCreate: () => intents.push('create ' + attemptId),
                })
            )
        );
    const controls = () => {
        const dialog = ui.container.querySelector('dialog[open]');
        assert(dialog);
        const [back, create] = dialog.querySelectorAll('button');
        assert(back && create);
        return { dialog, back, create };
    };
    type Button = ReturnType<typeof controls>['create'];
    const pointer = async (button: Button) => {
        await act(async () => {
            button.dispatchEvent(
                new ui.window.PointerEvent('pointerdown', {
                    bubbles: true,
                    isPrimary: true,
                    button: 0,
                })
            );
        });
    };
    const click = async (button: Button) => {
        await act(async () => {
            button.dispatchEvent(
                new ui.window.MouseEvent('click', {
                    bubbles: true,
                    detail: 1,
                })
            );
        });
    };
    const key = async (
        button: Button,
        type: string,
        key: string,
        repeat = false
    ) => {
        const event = new ui.window.KeyboardEvent(type, {
            bubbles: true,
            cancelable: true,
            key,
            repeat,
        });
        await act(async () => {
            button.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };

    await render('A', { open: false });
    const opener = ui.container.querySelector('button');
    assert(opener);
    opener.focus();
    await render('A');
    const a = controls();
    await pointer(a.create);
    await key(a.create, 'keydown', ' ');
    await render('B');
    const b = controls();
    assert.notEqual(b.create, a.create);
    assert.equal(ui.window.document.activeElement, b.back);
    await click(b.create);
    await key(b.back, 'keyup', ' ');
    assert(await key(b.back, 'keydown', 'Enter', true));
    assert(await key(b.back, 'keydown', 'Escape', true));
    await pointer(b.create);
    await act(async () => {
        b.create.dispatchEvent(
            new ui.window.PointerEvent('pointercancel', { bubbles: true })
        );
    });
    await click(b.create);
    assert.deepEqual(intents, []);
    await pointer(b.create);
    await click(b.create);
    assert.deepEqual(intents, ['create B']);

    // Changing callback/copy references or suspending B cannot rearm B.
    await render('B', { disabled: true });
    await render('B');
    assert.equal(controls().create, b.create);
    assert(controls().create.disabled);
    await ui.click(controls().create);
    assert.deepEqual(intents, ['create B']);

    await render('C');
    const c = controls();
    assert.equal(ui.window.document.activeElement, c.back);
    await pointer(c.create);
    await key(c.create, 'keydown', ' ');
    await render('C', { disabled: true });
    assert(c.back.disabled && c.create.disabled);
    await act(async () => {
        c.dialog.dispatchEvent(
            new ui.window.Event('cancel', { cancelable: true })
        );
    });
    await render('C');
    await click(c.create);
    await key(c.create, 'keyup', ' ');
    assert.deepEqual(intents, ['create B']);

    await key(c.create, 'keydown', ' ');
    await render('C', { open: false });
    assert.equal(ui.window.document.activeElement, opener);
    await render('C');
    const reopened = controls();
    await key(reopened.back, 'keyup', ' ');
    assert.deepEqual(intents, ['create B']);
    await key(reopened.create, 'keydown', ' ');
    await key(reopened.create, 'keyup', ' ');
    assert.deepEqual(intents, ['create B', 'create C']);
    assert.equal(ui.container.querySelector('input')?.value, draft);
    ui.unchangedEffects();
});
