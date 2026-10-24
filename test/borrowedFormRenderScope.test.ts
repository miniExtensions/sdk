import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createBorrowedFormRenderScope,
    type BorrowedFormField,
    type BorrowedFormRead,
} from '../src/ui/index.js';

function native() {
    let owner = 'A',
        configuration = 1,
        value = 'Native draft',
        writes = 0;
    const listeners = new Set<() => void>();
    const read = (): BorrowedFormRead => {
        const field: BorrowedFormField = {
            physicalKind: 'singleLineText',
            presentation: {
                type: 'physical',
                config: { type: 'singleLineText', options: null },
            },
            fieldId: 'fld_text',
            title: 'Text',
            field: {
                id: 'fld_text',
                name: 'Text',
                description: null,
                isPrimaryField: false,
                isComputed: false,
                config: { type: 'singleLineText', options: null },
            },
            displayConfig: {},
            value,
            context: 'form',
            computed: false,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            editable: true,
        };
        return { owner, configuration, fields: [field], canSubmit: true };
    };
    return {
        read,
        subscribe: (changed: () => void) => {
            listeners.add(changed);
            return () => {
                listeners.delete(changed);
            };
        },
        write: (
            expected: { owner: unknown; configuration: unknown },
            _id: string,
            next: string | number | null
        ) => {
            if (
                expected.owner !== owner ||
                expected.configuration !== configuration ||
                typeof next !== 'string'
            )
                return false;
            value = next;
            writes++;
            for (const listener of [...listeners]) listener();
            return true;
        },
        replace: (
            nextOwner: string,
            nextConfiguration = configuration,
            emit = true
        ) => {
            owner = nextOwner;
            configuration = nextConfiguration;
            if (emit) for (const listener of [...listeners]) listener();
        },
        value: () => value,
        writes: () => writes,
    };
}

it('borrows native values without construction writes and forwards void settlement after retirement', async () => {
    const port = native();
    let finish: () => void = () => {};
    const settled = new Promise<void>((resolve) => {
        finish = resolve;
    });
    let admitted: (() => boolean) | undefined;
    const scope = createBorrowedFormRenderScope<void>({
        ...port,
        submit: async (_owner, gate) => {
            admitted = gate;
            assert.equal(gate(), true);
            await settled;
        },
    });
    assert.equal(port.writes(), 0);
    const field = scope.getSnapshot().fields[0]!.host.getSnapshot();
    assert.equal(field.status, 'ready');
    if (field.status !== 'ready') throw Error('Expected field');
    const props = field.fields[0]!;
    if (
        props.physicalKind !== 'singleLineText' ||
        props.capability.type !== 'editable'
    )
        throw Error('Expected native text capability');
    assert.deepEqual(props.capability.setValue('Canonical update'), {
        accepted: true,
    });
    assert.equal(port.value(), 'Canonical update');
    const action = scope.getSnapshot().actions.submit;
    const pending = action();
    assert.equal(admitted?.(), false);
    port.replace('B');
    port.replace('A');
    assert.equal(scope.getSnapshot().retired, true);
    assert.deepEqual(props.capability.setValue('Stale update'), {
        accepted: false,
        reason: 'retired',
    });
    finish();
    assert.equal(await pending, undefined);
    await assert.rejects(action());
    assert.equal(port.value(), 'Canonical update');
});

it('cold owner replacement advances presentation revision and refuses retained writes', () => {
    const port = native();
    const scope = createBorrowedFormRenderScope<void>({
        ...port,
        submit: async () => {},
    });
    const before = scope.getSnapshot();
    port.replace('B', 1, false);
    const after = scope.getSnapshot();
    assert.equal(after.retired, true);
    assert(after.revision > before.revision);
    assert.equal(after.fields.length, 0);
    assert.equal(port.writes(), 0);
    scope.destroy();
});

it('refuses queued allocation after configuration ABA and unsubscribe does not reset the draft', async () => {
    const port = native();
    let release: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    let allocations = 0;
    const scope = createBorrowedFormRenderScope<number>({
        ...port,
        submit: async (_expected, admit) => {
            await wait;
            if (admit()) allocations++;
            return 7;
        },
    });
    const stop = scope.subscribe(() => {});
    stop();
    assert.equal(port.value(), 'Native draft');
    const pending = scope.getSnapshot().actions.submit();
    port.replace('A', 2);
    port.replace('A', 1);
    release();
    assert.equal(await pending, 7);
    assert.equal(allocations, 0);
    assert.equal(scope.getSnapshot().retired, true);
    scope.destroy();
});
