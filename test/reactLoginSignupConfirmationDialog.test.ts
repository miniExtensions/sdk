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
