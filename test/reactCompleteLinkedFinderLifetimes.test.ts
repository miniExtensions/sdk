import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { fixture } from './fixtures/completeLinkedFinderDom.js';
import { deferred } from './fixtures/scannerDom.js';

test('an admitted deferred selection cannot close a newer same-owner search in the actual view', async (t) => {
    const f = await fixture(t, true, { external: true });
    assert(f.window instanceof Window);
    const coordinator = f.coordinator!;
    let first!: ReturnType<typeof coordinator.queryNow>;
    await act(async () => {
        first = coordinator.queryNow({ filter: 'first', resetOffset: true });
    });
    await f.resolve(['B']);
    await first;
    await f.render({ closeAfterToggle: true });
    const completion = deferred<void>();
    const toggle = f.ports.toggle;
    f.ports.toggle = async (owner, id) => {
        await completion.promise;
        return toggle(owner, id);
    };
    await act(async () =>
        (
            f.host.querySelector('[role="option"]') as unknown as HTMLElement
        ).click()
    );
    let newer!: ReturnType<typeof coordinator.queryNow>;
    await act(async () => {
        newer = coordinator.queryNow({ filter: 'newer', resetOffset: true });
    });
    await f.resolve(['C']);
    assert.equal((await newer).status, 'accepted');
    await act(async () => completion.resolve());
    assert.deepEqual(f.toggles, ['B']);
    assert.equal(f.canonical.includes('B'), true);
    assert.equal(f.closeCount(), 0);
    assert.match(f.host.textContent, /Card C/);
});

for (const preview of [false, true]) {
    test(`retained pagination cannot replace a newer same-owner search before effect cleanup (preview=${preview})`, async (t) => {
        const f = await fixture(t, false, { external: true, preview });
        const coordinator = f.coordinator!;
        let first!: ReturnType<typeof coordinator.queryNow>;
        await act(async () => {
            first = coordinator.queryNow({
                filter: 'first',
                resetOffset: true,
            });
        });
        await f.resolve(['A'], 'next');
        const result = await first;
        assert.equal(result.status, 'accepted');
        if (result.status !== 'accepted') assert.fail();
        await f.render({
            filter: 'first',
            ...(preview
                ? {
                      previewPresentation: {
                          expectedOwner: result.owner,
                          candidateIds: ['A'],
                          offset: 'next',
                          error: null,
                      },
                  }
                : {}),
        });
        const observer = f.observers.at(-1)!;
        let newer!: ReturnType<typeof coordinator.queryNow>;
        await act(async () => {
            newer = coordinator.queryNow({
                filter: 'newer',
                resetOffset: true,
            });
            // React has not run the observer cleanup within this event yet.
            assert.equal(observer.disconnected, false);
            observer.callback(
                [{ isIntersecting: true } as IntersectionObserverEntry],
                {} as IntersectionObserver
            );
        });
        assert.equal(f.reads.length, 2);
        assert.equal(f.reads[1].filter, 'newer');
        await f.resolve(['newer']);
        assert.equal((await newer).status, 'accepted');
        await act(async () =>
            observer.callback(
                [{ isIntersecting: true } as IntersectionObserverEntry],
                {} as IntersectionObserver
            )
        );
        assert.equal(f.reads.length, 2);
    });
}

test('observer replacement retires the old callback even with an unchanged read identity', async (t) => {
    const f = await fixture(t, false, { external: true });
    const coordinator = f.coordinator!;
    let first!: ReturnType<typeof coordinator.queryNow>;
    await act(async () => {
        first = coordinator.queryNow({ filter: 'first', resetOffset: true });
    });
    await f.resolve(['A'], 'next');
    await first;
    await f.render({ filter: 'first' });
    const old = f.observers.at(-1)!;
    const identity = coordinator.getSnapshot().readIdentity;
    await f.render({ filter: 'replacement-filter' });
    assert.equal(old.disconnected, true);
    assert.equal(coordinator.getSnapshot().readIdentity, identity);
    await act(async () =>
        old.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
        )
    );
    assert.equal(f.reads.length, 1);
    const current = f.observers.at(-1)!;
    await act(async () =>
        current.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
        )
    );
    assert.equal(f.reads.length, 2);
    assert.equal(f.reads[1].filter, 'replacement-filter');
    assert.equal(f.reads[1].offset, 'next');
    await f.resolve(['second']);
});
