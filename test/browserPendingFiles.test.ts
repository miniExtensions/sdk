import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createPendingFiles } from '../examples/browser/src/pendingFiles.js';

it('pending file generations preserve replacements, explicit clears, ABA and retired ownership', async () => {
    const window = new Window();
    const first = window.document.createElement('input');
    const second = window.document.createElement('input');
    first.type = second.type = 'file';
    let owns = true;
    let notifications = 0;
    const registry = createPendingFiles(
        () => owns,
        () => notifications++
    );
    const input = first as unknown as HTMLInputElement;
    registry.register(input);
    registry.register(second as unknown as HTMLInputElement);
    const select = (name: string) => {
        const transfer = new window.DataTransfer();
        transfer.items.add(new window.File(['data'], name));
        first.files = transfer.files as unknown as typeof first.files;
        first.dispatchEvent(new window.Event('change'));
    };
    try {
        const empty = registry.revision();
        select('first.txt');
        const accepted = registry.capture(input);
        assert.ok(accepted);
        assert.equal(registry.pending(), true);
        select('replacement.txt');
        assert.equal(registry.clear(input, accepted), false);
        assert.equal(first.files?.[0]?.name, 'replacement.txt');
        assert.equal(registry.clear(input), true);
        assert.equal(registry.pending(), false);
        assert.ok(registry.revision() > empty);
        select('first.txt');
        assert.equal(
            registry.clear(input, accepted),
            false,
            'same filename is a new File/generation'
        );
        const current = registry.capture(input);
        assert.ok(current);
        const revision = registry.revision();
        assert.equal(registry.clear(input, current), true);
        assert.ok(
            registry.revision() > revision,
            'programmatic clear advances without change event'
        );
        select('retained.txt');
        owns = false;
        const count = notifications;
        const held = registry.revision();
        first.dispatchEvent(new window.Event('change'));
        assert.equal(registry.clear(input), false);
        assert.equal(notifications, count);
        assert.equal(registry.revision(), held);
        owns = true;
        registry.retire();
        const retired = registry.revision();
        first.dispatchEvent(new window.Event('change'));
        assert.equal(registry.revision(), retired);
        assert.equal(registry.capture(input), null);
        assert.equal(first.files?.[0]?.name, 'retained.txt');
    } finally {
        registry.retire();
        await window.happyDOM.close();
    }
});
