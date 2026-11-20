import assert from 'node:assert/strict';

export const heldRemoveCases = [
    { gesture: 'pointer', newHost: false, sameLabel: false },
    { gesture: 'Space', newHost: false, sameLabel: true },
    { gesture: 'pointer', newHost: true, sameLabel: true },
    { gesture: 'Space', newHost: true, sameLabel: false },
];

export const heldRemoveInterleavedPointerCase = {
    gesture: 'pointer',
    newHost: true,
    sameLabel: true,
    interleavedPointer: true,
};

export function heldRemoveValues({ sameLabel }) {
    const original = { filename: 'Source.txt', url: 'https://files.invalid/a' };
    const replacement = {
        filename: sameLabel ? original.filename : 'Replacement.txt',
        url: 'https://files.invalid/b',
    };
    const sentinel = {
        filename: 'Keep.txt',
        url: 'https://files.invalid/keep',
    };
    return { original, replacement, sentinel };
}

// This fixture also runs as an installed browser entry. Native resources are
// inspected only by the Form owner and the test oracle.
export function mountHeldRemoveFixture({
    h,
    root,
    createMiniExtensionsClient,
    createFormFieldBindings,
    RecoveryJournal,
    createFormFieldRendererHost,
    FieldRenderer,
    renderMultipleAttachmentsField,
    loaded,
    saveOptions,
    values,
    newHost,
}) {
    const { original, replacement, sentinel } = values;
    const calls = { remove: [], upload: 0, submit: 0, save: 0, fetch: 0 };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.invalid',
        fetch: async () => {
            calls.fetch++;
            throw Error('Unexpected fixture request');
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
    const scope = { parentFieldId: null, tableId: null, context: 'modal' };
    function makeOwner(name, row) {
        const seed = structuredClone(loaded);
        seed.payload.formRecord.data.files = [row, sentinel];
        const fields = createFormFieldBindings({
            client,
            loaded: seed,
            getScope: () => ({ ownerId: name, revision: 0 }),
            saveOptions,
        });
        const host = createFormFieldRendererHost({
            fields,
            fieldId: 'files',
            isCurrent: () => true,
            configurationRevision: () => 0,
            attachmentRecovery: {
                journal: new RecoveryJournal(),
                loadVersion: 1,
                scope: { ...scope, owner: name, childExtensionId: 'fixture' },
            },
        });
        return { name, fields, host, field: fields.field('files') };
    }
    const first = makeOwner('first', original);
    const second = newHost ? makeOwner('second', replacement) : first;
    let current = first;
    const renderers = {
        renderMultipleAttachmentsField(field) {
            const { capability } = field;
            const { attachment } = capability;
            const { name } = current;
            return renderMultipleAttachmentsField({
                ...field,
                capability: {
                    ...capability,
                    attachment: {
                        ...attachment,
                        remove(index) {
                            calls.remove.push({ owner: name, index });
                            return attachment.remove(index);
                        },
                    },
                },
            });
        },
    };
    const render = () =>
        root.render(
            h(
                'form',
                {
                    'data-owner': current.name,
                    onSubmit(event) {
                        event.preventDefault();
                        calls.submit++;
                    },
                },
                h(FieldRenderer, { host: current.host, renderers }),
                h('button', { type: 'submit' }, 'Save fixture')
            )
        );
    render();
    return {
        replace() {
            if (newHost) {
                current = second;
                render();
            } else if (!first.field.setValue([replacement, sentinel]).accepted)
                throw Error('The Form refused the synthetic replacement');
        },
        snapshot() {
            return structuredClone({
                calls,
                current: current.field.getSnapshot().value,
                previous: newHost ? first.field.getSnapshot().value : null,
            });
        },
        dispose() {
            root.unmount();
            for (const owner of newHost ? [second, first] : [first]) {
                owner.host.dispose();
                owner.fields.destroy();
            }
        },
    };
}

export function heldRemoveExpected(options, values, phase) {
    const { original, replacement, sentinel } = values;
    return {
        calls: {
            remove:
                phase === 'fresh'
                    ? [
                          {
                              owner: options.newHost ? 'second' : 'first',
                              index: 0,
                          },
                      ]
                    : [],
            upload: 0,
            submit: 0,
            save: 0,
            fetch: 0,
        },
        current:
            phase === 'original'
                ? [original, sentinel]
                : phase === 'fresh'
                  ? [sentinel]
                  : [replacement, sentinel],
        previous: options.newHost ? [original, sentinel] : null,
    };
}

// Happy DOM dispatches events but does not perform native button activation.
// Model a click from the release only when the original target is retained.
export async function checkSyntheticHeldRemove({
    window,
    act,
    createRoot,
    fixture,
    options,
}) {
    const values = heldRemoveValues(options);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const button = () => {
        const node = container.querySelector(
            'button[aria-label="Remove attachment 1"]'
        );
        assert(node);
        return node;
    };
    const dispatch = (node, type, Event, init) =>
        node.dispatchEvent(
            new Event(type, { bubbles: true, cancelable: true, ...init })
        );
    const mouse = {
        button: 0,
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
    };
    const touch = { ...mouse, pointerId: 2, pointerType: 'touch' };
    const space = { key: ' ', code: 'Space' };
    const press = (node, pointer = mouse) => {
        node.focus();
        if (options.gesture === 'Space')
            dispatch(node, 'keydown', window.KeyboardEvent, space);
        else dispatch(node, 'pointerdown', window.PointerEvent, pointer);
    };
    const release = (pressed, target, pointer = mouse) => {
        if (options.gesture === 'Space') {
            if (
                dispatch(target, 'keyup', window.KeyboardEvent, space) &&
                pressed === target
            )
                target.click();
        } else {
            dispatch(target, 'pointerup', window.PointerEvent, pointer);
            if (pressed === target)
                dispatch(
                    target,
                    'click',
                    options.legacyClick
                        ? window.MouseEvent
                        : window.PointerEvent,
                    { ...pointer, detail: 1 }
                );
        }
    };
    let probe;
    try {
        await act(async () => {
            probe = mountHeldRemoveFixture({
                ...fixture,
                root: createRoot(container),
                values,
                newHost: options.newHost,
            });
        });
        assert.deepEqual(
            probe.snapshot(),
            heldRemoveExpected(options, values, 'original')
        );
        const original = button();
        await act(async () => press(original));
        await act(async () => probe.replace());
        assert.deepEqual(
            probe.snapshot(),
            heldRemoveExpected(options, values, 'replacement')
        );
        assert.equal(
            button().parentElement.firstChild.textContent,
            values.replacement.filename
        );
        assert.equal(window.document.activeElement, button());
        const replacement = button();
        if (options.interleavedPointer)
            await act(async () => press(replacement, touch));
        await act(async () => release(original, replacement));
        assert.deepEqual(
            probe.snapshot(),
            heldRemoveExpected(options, values, 'replacement'),
            'Held release acted on a replaced resource'
        );
        if (!options.interleavedPointer)
            await act(async () => press(replacement));
        await act(async () =>
            release(
                replacement,
                replacement,
                options.interleavedPointer ? touch : mouse
            )
        );
        assert.deepEqual(
            probe.snapshot(),
            heldRemoveExpected(options, values, 'fresh')
        );
    } finally {
        if (probe) await act(async () => probe.dispose());
        container.remove();
    }
}
