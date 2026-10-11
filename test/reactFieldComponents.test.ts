import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement, type ReactNode } from 'react';
import {
    TextField,
    NumberField,
    DurationField,
    CheckboxField,
    DateField,
    DateTimeField,
    AttachmentField,
} from '../src/react/index.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import {
    createMiniExtensionsClient,
    type RuntimeFieldSchema,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

async function fixture() {
    const window = new Window();
    // tRPC discovers AbortController on window while the SDK uses the global
    // AbortSignal. Keep the synthetic browser in the same realm as Node fetch.
    Object.defineProperty(window, 'AbortController', {
        value: globalThis.AbortController,
    });
    Object.defineProperty(window, 'AbortSignal', {
        value: globalThis.AbortSignal,
    });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const loaded = loadedForm();
    for (const [id, type, options, value] of [
        ['number', 'number', { precision: 2 }, 1.25],
        ['duration', 'duration', { durationFormat: 'h:mm:ss' }, 60],
        [
            'checkbox',
            'checkbox',
            { icon: 'check', color: 'greenBright' },
            false,
        ],
        [
            'date',
            'date',
            { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
            '2024-02-29',
        ],
        [
            'dateTime',
            'dateTime',
            {
                dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                timeFormat: { name: '24hour', format: 'HH:mm' },
                timeZone: 'UTC',
            },
            '2024-02-29T12:30:00Z',
        ],
    ] as const) {
        loaded.payload.fieldIdsInForm.push(id);
        loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: type,
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type, options },
            },
            miniExtConfig: {
                conditionalFields: { logicalOperator: 'and', conditions: [] },
            },
        } as RuntimeFieldSchema;
    }
    let writable = true;
    let requests = 0;
    const owner = createFormFieldBindings({
        loaded,
        saveOptions: formSaveOptions(),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                requests++;
                throw new Error('Synthetic offline');
            },
        }),
        getScope: () => ({ ownerId: 'fields', revision: 0 }),
        canWriteField: () => writable,
        getClientTimeZone: () => 'UTC',
    });
    return {
        window,
        owner,
        loaded,
        requests: () => requests,
        render: async (node: ReactNode) => {
            await act(async () => root.render(node));
        },
        input: () => {
            const input = window.document.querySelector('input');
            assert.ok(input);
            return input;
        },
        text: () => window.document.body.textContent,
        edit: async (value: string) => {
            const input = window.document.querySelector('input');
            assert.ok(input);
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                )!.set!.call(input, value);
                input.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
        },
        hide: async () => {
            await act(async () => {
                writable = false;
                owner.refresh();
            });
        },
        close: async () => {
            await act(async () => root.unmount());
            owner.destroy();
            keys.forEach((key, index) => {
                const previous = originals[index];
                if (previous) Object.defineProperty(globalThis, key, previous);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        },
    };
}

it('TextField commits input and explicit empty as null, observes external changes, and respects read-only fields', async () => {
    const f = await fixture();
    try {
        const binding = f.owner.field('fld_title');
        const readonlyBinding = f.owner.field('fld_readonly');
        await f.render(createElement(TextField, { binding }));
        assert.equal(f.input().value, 'Initial title');
        await f.edit('Edited in the DOM');
        assert.equal(binding.getSnapshot().value, 'Edited in the DOM');
        assert.equal(binding.getSnapshot().dirty, true);
        await f.edit('');
        assert.equal(binding.getSnapshot().value, null);
        await act(async () => {
            binding.setValue('External draft');
        });
        assert.equal(f.input().value, 'External draft');
        await f.render(createElement(TextField, { binding: readonlyBinding }));
        assert.equal(f.input().disabled, true);
        assert.equal(f.input().value, 'Locked value');
        await f.edit('Rejected');
        assert.equal(
            f.owner.field('fld_readonly').getSnapshot().value,
            'Locked value'
        );
        assert.equal(f.requests(), 0);
    } finally {
        await f.close();
    }
});

it('NumberField retains invalid draft text without corrupting native value, recovers, and clears', async () => {
    const f = await fixture();
    try {
        const binding = f.owner.field('number');
        await f.render(createElement(NumberField, { binding }));
        assert.equal(f.input().inputMode, 'decimal');
        await f.edit('1e');
        assert.equal(f.input().value, '1e');
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        assert.equal(binding.getSnapshot().value, 1.25);
        assert.ok(
            f.window.document.querySelector('[role=status]')!.textContent
        );
        await f.edit('-2.75');
        assert.equal(binding.getSnapshot().value, -2.75);
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
        await f.edit('');
        assert.equal(binding.getSnapshot().value, null);
        await f.hide();
        assert.equal(f.window.document.querySelector('input'), null);
        assert.equal(binding.scalar!.setInput('999'), false);
        assert.equal(binding.getSnapshot().value, null);
        assert.equal(f.requests(), 0);
    } finally {
        await f.close();
    }
});

it('DurationField preserves clock draft while focused and normalizes on blur using seconds in the owner', async () => {
    const f = await fixture();
    try {
        const binding = f.owner.field('duration');
        await f.render(createElement(DurationField, { binding }));
        assert.equal(f.input().inputMode, 'text');
        assert.equal(f.input().placeholder, 'h:mm:ss');
        await act(async () => {
            f.input().dispatchEvent(
                new f.window.FocusEvent('focusin', { bubbles: true })
            );
        });
        await f.edit('1:02:03');
        assert.equal(binding.getSnapshot().value, 3723);
        assert.equal(f.input().value, '1:02:03');
        await f.edit('not a clock');
        assert.equal(binding.getSnapshot().value, 3723);
        assert.equal(f.input().getAttribute('aria-invalid'), 'true');
        await f.edit('0:01:30');
        await act(async () => {
            f.input().dispatchEvent(
                new f.window.FocusEvent('focusout', { bubbles: true })
            );
        });
        assert.equal(binding.getSnapshot().value, 90);
        assert.equal(f.input().value, '1:30');
        assert.equal(f.input().getAttribute('aria-invalid'), 'false');
    } finally {
        await f.close();
    }
});

it('CheckboxField toggles native booleans and ignores detached controls after visibility is revoked', async () => {
    const f = await fixture();
    try {
        const binding = f.owner.field('checkbox');
        await f.render(createElement(CheckboxField, { binding }));
        assert.equal(f.input().checked, false);
        await act(async () => f.input().click());
        assert.equal(binding.getSnapshot().value, true);
        assert.equal(f.input().checked, true);
        await act(async () => f.input().click());
        assert.equal(binding.getSnapshot().value, false);
        const staleInput = f.input();
        await f.hide();
        assert.equal(f.window.document.querySelector('input'), null);
        await act(async () => staleInput.click());
        assert.equal(binding.getSnapshot().value, false);
    } finally {
        await f.close();
    }
});

for (const kind of ['date', 'dateTime'] as const)
    it(`${kind} rejects invalid calendar text without native writes and clears through the stock button`, async () => {
        const f = await fixture();
        try {
            const binding = f.owner.field(kind);
            const initial = binding.getSnapshot().value;
            await f.render(
                createElement(kind === 'date' ? DateField : DateTimeField, {
                    binding,
                })
            );
            assert.equal(
                f.input().placeholder,
                kind === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm:ssZ'
            );
            await f.edit('2024-02-30');
            assert.equal(f.input().getAttribute('aria-invalid'), 'true');
            assert.equal(binding.getSnapshot().value, initial);
            assert.ok(
                f.window.document.querySelector('[role=status]')!.textContent
            );
            const valid =
                kind === 'date' ? '2024-03-01' : '2024-03-01T09:30:00+05:45';
            await f.edit(valid);
            assert.equal(binding.getSnapshot().value, valid);
            assert.equal(f.input().getAttribute('aria-invalid'), 'false');
            await act(async () =>
                f.window.document.querySelector('button')!.click()
            );
            assert.equal(binding.getSnapshot().value, null);
            assert.equal(f.input().value, '');
            await f.hide();
            assert.equal(f.window.document.querySelector('input'), null);
            assert.equal(f.window.document.querySelector('button'), null);
            assert.equal(binding.date!.setInput(valid), false);
            assert.equal(f.requests(), 0);
        } finally {
            await f.close();
        }
    });

it('AttachmentField accepts chooser changes and clearing pending files leaves native attachments untouched', async () => {
    const f = await fixture();
    try {
        const binding = f.owner.field('fld_files');
        const original = binding.getSnapshot().value;
        const controller = f.owner.attachment('fld_files', {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'fields',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
        });
        await f.render(createElement(AttachmentField, { binding, controller }));
        const button = (label: string) => {
            const button = [
                ...f.window.document.querySelectorAll('button'),
            ].find((node) => node.textContent === label);
            assert.ok(button);
            return button;
        };
        assert.equal(button('Upload').disabled, true);
        assert.equal(button('Cancel upload').disabled, true);
        const file = new f.window.File(['test'], 'local.txt', {
            type: 'text/plain',
        });
        Object.defineProperty(f.input(), 'files', {
            configurable: true,
            value: [file],
        });
        await act(async () => {
            f.input().dispatchEvent(
                new f.window.Event('change', { bubbles: true })
            );
        });
        assert.equal(controller.getSnapshot().files[0], file);
        assert.equal(f.input().value, '');
        assert.equal(button('Upload').disabled, false);
        assert.match(f.text()!, /Files selected/);
        assert.deepEqual(binding.getSnapshot().value, original);
        await act(async () => button('Clear pending files').click());
        assert.equal(controller.getSnapshot().files.length, 0);
        assert.match(f.text()!, /No pending files/);
        assert.equal(button('Upload').disabled, true);
        assert.deepEqual(binding.getSnapshot().value, original);
        assert.equal(f.requests(), 0);
    } finally {
        await f.close();
    }
});

it('AttachmentField shows uncertain upload failure and never retries the same selected file', async () => {
    const f = await fixture();
    try {
        const binding = f.owner.field('fld_files');
        const original = binding.getSnapshot().value;
        const controller = f.owner.attachment('fld_files', {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: 'fields',
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'form',
                context: 'modal',
            },
        });
        const file = new File(['upload'], 'test.txt', { type: 'text/plain' });
        assert.equal(controller.select([file]), true);
        await f.render(createElement(AttachmentField, { binding, controller }));
        const upload = [...f.window.document.querySelectorAll('button')].find(
            (node) => node.textContent === 'Upload'
        )!;
        let unsubscribe = () => {};
        const settled = new Promise<void>((resolve) => {
            unsubscribe = controller.subscribe((state) => {
                if (state.phase === 'uncertain' && !state.busy) resolve();
            });
        });
        await act(async () => {
            upload.click();
            await settled;
        });
        unsubscribe();
        assert.equal(f.requests(), 1);
        assert.equal(controller.getSnapshot().phase, 'uncertain');
        assert.equal(controller.getSnapshot().busy, false);
        assert.equal(controller.getSnapshot().files[0], file);
        assert.match(
            f.window.document.querySelector('[role=status]')!.textContent!,
            /Upload outcome needs inspection/
        );
        assert.deepEqual(binding.getSnapshot().value, original);
        await act(async () => {
            upload.click();
        });
        assert.equal(f.requests(), 1);
        assert.deepEqual(binding.getSnapshot().value, original);
    } finally {
        await f.close();
    }
});
