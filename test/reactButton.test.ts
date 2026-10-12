import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement, StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import {
    ButtonField,
    renderButtonField,
    useButtonField,
} from '../src/react/index.js';
import {
    createButtonFieldModel,
    type ButtonFieldData,
    type ButtonFieldModel,
} from '../src/ui/buttonModel.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type { FieldRendererProps } from '../src/ui/rendererRegistry.js';

const fixture = (configure: (data: ButtonFieldData) => void = () => {}) => {
    const data: ButtonFieldData = {
        field: {
            id: 'fld_button',
            name: 'Action',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'button', options: null },
        },
        value: { label: 'Run action', url: 'action.example.test/run' },
        config: { openLinkType: 'triggerWebhookPOST' },
        language: 'en',
        visible: true,
        source: { type: 'current-record', recordId: 'rec_synthetic' },
        extensionAccessToken: 'synthetic',
    };
    configure(data);
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('Network forbidden');
        },
    });
    let calls = 0,
        current = true;
    let respond: () => Promise<{ success: boolean }> = async () => ({
        success: true,
    });
    client.buttons.triggerWebhook = () => {
        calls++;
        return respond();
    };
    const model = createButtonFieldModel({
        client,
        adapter: {
            read: () => data,
            isCurrent: () => current,
            configurationRevision: () => 1,
        },
        recovery: {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'synthetic',
                tableId: 'tbl_test',
                childExtensionId: 'form',
                parentFieldId: null,
                context: 'modal',
            },
        },
    });
    return {
        data,
        model,
        calls: () => calls,
        retire: () => {
            current = false;
        },
        respond: (fn: typeof respond) => {
            respond = fn;
        },
    };
};
const ModelButton = ({ model }: { model: ButtonFieldModel }) =>
    createElement(ButtonField, useButtonField(model));

it('Button renders accepted state across StrictMode/remount without replay, submission or row activation', async () => {
    const window = new Window();
    const globals = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const previous = globals.map((key) =>
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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container as unknown as HTMLElement);
    const models: ButtonFieldModel[] = [];
    const make = (configure?: (data: ButtonFieldData) => void) => {
        const f = fixture(configure);
        models.push(f.model);
        return f;
    };
    let rows = 0,
        submits = 0;
    const tree = (model: ButtonFieldModel) =>
        createElement(
            StrictMode,
            null,
            createElement(
                'form',
                {
                    onSubmit: (e: import('react').FormEvent) => {
                        e.preventDefault();
                        submits++;
                    },
                    onClick: () => rows++,
                    onKeyDown: () => rows++,
                },
                createElement(ModelButton, { model }),
                createElement(ModelButton, { model })
            )
        );
    const remount = async (model: ButtonFieldModel) => {
        await act(async () => root.unmount());
        root = createRoot(container as unknown as HTMLElement);
        await act(async () => root.render(tree(model)));
    };
    try {
        const f = make();
        let resolve!: (value: { success: boolean }) => void;
        f.respond(
            () =>
                new Promise((done) => {
                    resolve = done;
                })
        );
        await act(async () => root.render(tree(f.model)));
        assert.equal(f.calls(), 0);
        const buttons = container.querySelectorAll('button');
        assert.notEqual(buttons[0].id, buttons[1].id);
        assert.notEqual(buttons[0].id, 'fld_button');
        assert.equal(buttons[0].type, 'button');
        await act(async () => {
            buttons[0].click();
            buttons[1].click();
        });
        assert.equal(f.calls(), 1);
        assert.equal(rows, 0);
        assert.equal(submits, 0);
        assert.equal(
            container.querySelector('button')!.getAttribute('aria-busy'),
            'true'
        );
        assert.equal(
            container.querySelector('button')!.textContent,
            'Run action'
        );
        assert.equal(
            container.querySelectorAll('.mx-sdk-button-spinner').length,
            2
        );
        await remount(f.model);
        assert.equal(f.model.getSnapshot().busy, true);
        assert.equal(f.calls(), 1);
        await act(async () => resolve({ success: false }));
        assert.equal(
            container.querySelector('[role=status]')!.textContent,
            'Error triggering webhook'
        );
        assert.equal(container.querySelector('button')!.disabled, true);
        await remount(f.model);
        assert.equal(f.calls(), 1);
        assert.equal(f.model.getSnapshot().phase, 'uncertain');
        await act(async () => container.querySelector('button')!.click());
        assert.equal(f.calls(), 1);

        for (const [success, text] of [
            [true, ''],
            [false, ''],
            [true, '<b>Configured</b>'],
        ] as const) {
            const next = make((data) => {
                data.config = {
                    openLinkType: 'triggerWebhookGET',
                    triggerWebhookSuccessMessage: text,
                    triggerWebhookErrorMessage: text,
                };
            });
            next.respond(async () => ({ success }));
            await remount(next.model);
            await act(async () => container.querySelector('button')!.click());
            assert.equal(
                container.querySelector('[role=status]')!.textContent,
                text
            );
            assert.equal(container.querySelector('b'), null);
            await remount(next.model);
            assert.equal(next.calls(), 1);
        }
        const localized = make((data) => {
            data.language = 'fr';
        });
        await remount(localized.model);
        await act(async () => container.querySelector('button')!.click());
        assert.equal(
            container.querySelector('[role=status]')!.textContent,
            'Webhook déclenché avec succès'
        );
        const absent = make((data) => {
            data.value = null;
            data.language = 'es';
        });
        await remount(absent.model);
        assert.equal(container.querySelector('button'), null);
        assert.ok(container.textContent!.includes('Sin Botón'));
        const hidden = make((data) => {
            data.visible = false;
        });
        await remount(hidden.model);
        assert.equal(container.querySelector('form')!.textContent, '');
        const create = make((data) => {
            data.source = null;
        });
        await remount(create.model);
        assert.equal(container.querySelector('button')!.disabled, true);
        assert.equal(create.calls(), 0);

        for (const mode of [undefined, '_self', '_blank', '_parent'] as const) {
            const link = make((data) => {
                data.config = { openLinkType: mode };
            });
            await remount(link.model);
            const anchor = container.querySelector('a')!;
            assert.equal(anchor.href, 'https://action.example.test/run');
            assert.equal(anchor.target, mode ?? '_blank');
            assert.equal(anchor.rel, 'noreferrer');
            const key = new window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
            });
            await act(async () => anchor.dispatchEvent(key));
            assert.equal(rows, 0);
            link.retire();
            const event = new window.MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            await act(async () => anchor.dispatchEvent(event));
            assert.equal(event.defaultPrevented, true);
            assert.equal(anchor.hasAttribute('href'), false);
            assert.equal(link.calls(), 0);
        }
        for (const eventName of ['auxclick', 'contextmenu']) {
            const f = make((data) => {
                data.config = { openLinkType: '_blank' };
            });
            await remount(f.model);
            const anchor = container.querySelector('a')!;
            f.retire();
            const event = new window.MouseEvent(eventName, {
                bubbles: true,
                cancelable: true,
                button: 1,
            });
            await act(async () => anchor.dispatchEvent(event));
            assert.equal(event.defaultPrevented, true);
        }
        const readonly: FieldRendererProps<'button'> = {
            physicalKind: 'button',
            presentation: { type: 'physical', config: f.data.field.config },
            fieldId: 'fld_button',
            title: 'Action',
            field: f.data.field,
            displayConfig: { openLinkType: '_blank' },
            value: {
                label: 'No capability',
                url: 'https://forbidden.example.test',
            },
            context: 'portal-cell',
            computed: true,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: { type: 'readonly' },
        };
        await act(async () => root.render(renderButtonField(readonly)));
        assert.equal(container.querySelector('a'), null);
        assert.equal(container.querySelector('button')!.disabled, true);
        await act(async () =>
            root.render(renderButtonField({ ...readonly, value: undefined }))
        );
        assert.ok(container.textContent!.includes('No Button'));
        const blank = make((data) => {
            data.value!.label = '';
        });
        await remount(blank.model);
        assert.equal(container.querySelector('button')!.textContent, 'Action');

        const pending = make();
        let settle!: (value: { success: boolean }) => void;
        pending.respond(
            () =>
                new Promise((done) => {
                    settle = done;
                })
        );
        await remount(pending.model);
        await act(async () => container.querySelector('button')!.click());
        const successor = make((data) => {
            data.value!.label = 'Successor';
        });
        pending.retire();
        await remount(successor.model);
        await act(async () => settle({ success: true }));
        assert.equal(container.querySelector('[role=status]')!.textContent, '');
        assert.equal(
            container.querySelector('button')!.textContent,
            'Successor'
        );
        assert.equal(successor.calls(), 0);
    } finally {
        await act(async () => root.unmount());
        models.forEach((model) => model.dispose());
        globals.forEach((key, index) => {
            const value = previous[index];
            if (value) Object.defineProperty(globalThis, key, value);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
});
