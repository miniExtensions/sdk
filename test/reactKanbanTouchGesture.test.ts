import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window, Touch } from 'happy-dom';
import { claimKanbanTouchMove } from '../src/react/kanban/touchGesture.js';

function fixture(t: TestContext) {
    const window = new Window();
    const target = window.document.createElement('button');
    window.document.body.append(target);
    const releases: (() => void)[] = [];
    t.after(async () => {
        for (const release of releases) release();
        await window.happyDOM.close();
    });
    const point = (x = 10, y = 20, identifier = 1) =>
        new Touch({ target, identifier, clientX: x, clientY: y });
    const event = (type: string, touches = [point()], cancelable = true) =>
        new window.TouchEvent(type, { touches, bubbles: true, cancelable });
    const claim = (isCurrent = () => true, touches = [point()]) => {
        const start = event('touchstart', touches);
        target.dispatchEvent(start);
        const release = claimKanbanTouchMove(
            start as unknown as TouchEvent,
            isCurrent
        );
        releases.push(release);
        return release;
    };
    const dispatch = (
        type: string,
        touches = [point(11)],
        cancelable = true
    ) => {
        const next = event(type, touches, cancelable);
        target.dispatchEvent(next);
        return next;
    };
    return { window, target, point, event, claim, dispatch };
}

it('cancels the first admitted nonzero movement before downstream bubbling, then releases its own listener', (t) => {
    const f = fixture(t);
    f.claim();
    assert.equal(f.dispatch('touchmove', [f.point()]).defaultPrevented, false);
    let observed = false;
    f.window.document.addEventListener(
        'touchmove',
        (event) => {
            observed = event.defaultPrevented;
        },
        { once: true }
    );
    assert.equal(f.dispatch('touchmove').defaultPrevented, true);
    assert.equal(observed, true);
    assert.equal(
        f.dispatch('touchmove', [f.point(12)]).defaultPrevented,
        false
    );
});
for (const terminal of ['touchend', 'touchcancel'])
    it(`leaves a stationary touch native and releases on ${terminal}`, (t) => {
        const f = fixture(t);
        f.claim();
        assert.equal(f.dispatch(terminal, []).defaultPrevented, false);
        assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    });
it('explicit retirement releases idempotently without reading the owner or preventing later movement', (t) => {
    const f = fixture(t);
    let reads = 0;
    const release = f.claim(() => {
        reads++;
        return true;
    });
    release();
    release();
    assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    assert.equal(reads, 0);
});
it('does not revive a refused owner and permits a fresh independently admitted gesture', (t) => {
    const f = fixture(t);
    let current = false;
    f.claim(() => current);
    assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    current = true;
    assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    f.claim(() => current);
    assert.equal(f.dispatch('touchmove').defaultPrevented, true);
});
it('fails closed and releases if the current-owner read throws', (t) => {
    const f = fixture(t);
    let current = false;
    f.claim(() => {
        if (!current) throw new Error('Synthetic owner read');
        return true;
    });
    assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    current = true;
    assert.equal(f.dispatch('touchmove').defaultPrevented, false);
});
it('rechecks retirement after a reentrant owner read before preventing movement', (t) => {
    const f = fixture(t);
    let release = () => {};
    release = f.claim(() => {
        release();
        return true;
    });
    assert.equal(f.dispatch('touchmove').defaultPrevented, false);
});
it('releases an already noncancelable movement without a retry or later suppression', (t) => {
    const f = fixture(t);
    f.claim();
    assert.equal(
        f.dispatch('touchmove', [f.point(11)], false).defaultPrevented,
        false
    );
    assert.equal(
        f.dispatch('touchmove', [f.point(12)]).defaultPrevented,
        false
    );
});
for (const mode of ['empty', 'multiple', 'replaced'] as const)
    it(`releases ${mode} moving touches without suppressing a successor`, (t) => {
        const f = fixture(t);
        f.claim();
        const points =
            mode === 'empty'
                ? []
                : mode === 'multiple'
                  ? [f.point(11), f.point(12, 20, 2)]
                  : [f.point(11, 20, 2)];
        assert.equal(f.dispatch('touchmove', points).defaultPrevented, false);
        assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    });
for (const mode of ['empty', 'multiple', 'targetless'] as const)
    it(`does not claim an invalid ${mode} activation`, (t) => {
        const f = fixture(t);
        if (mode === 'targetless') {
            const release = claimKanbanTouchMove(
                f.event('touchstart') as unknown as TouchEvent,
                () => true
            );
            release();
        } else
            f.claim(
                () => true,
                mode === 'empty' ? [] : [f.point(), f.point(10, 20, 2)]
            );
        assert.equal(f.dispatch('touchmove').defaultPrevented, false);
    });

for (const reason of ['resize', 'visibilitychange', 'Escape'] as const)
    it(`retires pending movement on ${reason} without suppressing a later or fresh gesture`, (t) => {
        const f = fixture(t);
        let reads = 0;
        f.claim(() => {
            reads++;
            return true;
        });
        if (reason === 'Escape')
            f.window.document.dispatchEvent(
                new f.window.KeyboardEvent('keydown', {
                    code: 'Escape',
                    bubbles: true,
                })
            );
        else f.window.dispatchEvent(new f.window.Event(reason));
        assert.equal(f.dispatch('touchmove').defaultPrevented, false);
        assert.equal(reads, 0);
        f.claim();
        assert.equal(f.dispatch('touchmove').defaultPrevented, true);
    });
it('leaves a pending gesture admitted after an unrelated key', (t) => {
    const f = fixture(t);
    f.claim();
    f.window.document.dispatchEvent(
        new f.window.KeyboardEvent('keydown', {
            code: 'ArrowDown',
            bubbles: true,
        })
    );
    assert.equal(f.dispatch('touchmove').defaultPrevented, true);
});
