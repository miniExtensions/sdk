import assert from 'node:assert/strict';
import { mock } from 'node:test';

/** Synthetic storage/locks only. This is SDK evidence, not installed native acceptance. */
export async function assertSavedProgressConsumer({
    React,
    ui,
    forms,
    Window,
    createRoot,
    renderToString,
}) {
    const { createElement: h, act, StrictMode } = React;
    let ssrCalls = 0;
    const forbidden = () => {
        ssrCalls++;
        throw Error('SSR I/O');
    };
    function Server() {
        const result = ui.useNativeFormProgress({
            shareId: 'synthetic',
            configurationEligible: true,
            record: { type: 'create', data: {} },
            ports: {
                readSnapshot: forbidden,
                remove: forbidden,
                getWriterId: forbidden,
                write: forbidden,
                subscribeStorage: forbidden,
            },
        });
        return result.hasConflict ? h(ui.FormProgressConflictAlert) : null;
    }
    assert.equal(renderToString(h(Server)), '');
    const warning = renderToString(h(ui.FormProgressConflictAlert));
    assert(warning.includes('role="alert"'));
    assert(warning.includes('Saved progress changed in another tab'));
    assert(
        warning.includes(
            'Reload this page to continue saving progress from this tab.'
        )
    );
    assert(warning.includes('aria-hidden="true"'));
    assert.equal(ssrCalls, 0);
    const window = new Window({ url: 'https://consumer.invalid/' });
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = new Map(
        Object.keys(values).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ])
    );
    for (const [key, value] of Object.entries(values))
        Object.defineProperty(globalThis, key, { configurable: true, value });
    const fixtures = [];
    async function fixture({
        seed,
        held = false,
        strict = false,
        initial = {},
        readDenied = false,
        beforeLockLookup,
        withForm = false,
    } = {}) {
        const data = new Map(
            seed == null ? [] : [['form-progress-synthetic', seed]]
        );
        const io = [],
            records = [],
            locks = [],
            listeners = new Set();
        let denied = false,
            ids = 0,
            lockRequests = 0,
            storageLookups = 0,
            submits = 0,
            subscriptions = 0,
            teardowns = 0,
            unmounted = false;
        const storage = {
            getItem(key) {
                io.push(['read', key]);
                if (readDenied) throw Error('Synthetic unavailable read');
                return data.get(key) ?? null;
            },
            setItem(key, value) {
                io.push(['write', key]);
                if (denied) throw Error('Synthetic denied write');
                data.set(key, value);
            },
            removeItem(key) {
                io.push(['remove', key]);
                data.delete(key);
            },
        };
        const factory = (shareId, writerId = 'reader') =>
            forms.createNativeFormProgressStorage({
                shareId,
                writerId,
                getStorage() {
                    storageLookups++;
                    return storage;
                },
                onWarning() {},
                getLocks() {
                    beforeLockLookup?.();
                    return held
                        ? {
                              request(name, callback) {
                                  lockRequests++;
                                  return new Promise((resolve, reject) =>
                                      locks.push((failure) => {
                                          if (failure) {
                                              reject(failure);
                                              return;
                                          }
                                          try {
                                              resolve(callback());
                                          } catch (error) {
                                              reject(error);
                                          }
                                      })
                                  );
                              },
                          }
                        : undefined;
                },
            });
        const ports = {
            readSnapshot: (share) => factory(share).read(),
            remove: (share) => factory(share).remove(),
            getWriterId: () => `writer-${++ids}`,
            write(args) {
                records.push(args.record);
                return factory(args.shareId, args.writerId).write(args);
            },
            subscribeStorage(listener) {
                subscriptions++;
                listeners.add(listener);
                return () => {
                    teardowns++;
                    listeners.delete(listener);
                };
            },
        };
        let props = {
            shareId: 'synthetic',
            configurationEligible: true,
            record: {
                type: 'create',
                data: { visible: 'hydrated', hidden: 'retained' },
            },
            ports,
            ...initial,
        };
        const container = window.document.createElement('main');
        window.document.body.append(container);
        const root = createRoot(container);
        function Consumer() {
            const { hasConflict } = ui.useNativeFormProgress(props);
            const alert = hasConflict ? h(ui.FormProgressConflictAlert) : null;
            if (!withForm) return alert;
            return h(
                'form',
                {
                    onSubmit(event) {
                        event.preventDefault();
                        submits++;
                    },
                },
                alert
            );
        }
        const element = () =>
            strict ? h(StrictMode, null, h(Consumer)) : h(Consumer);
        const f = {
            data,
            io,
            records,
            locks,
            container,
            get subscriptions() {
                return subscriptions;
            },
            get teardowns() {
                return teardowns;
            },
            get lockRequests() {
                return lockRequests;
            },
            get storageLookups() {
                return storageLookups;
            },
            get submits() {
                return submits;
            },
            get ids() {
                return ids;
            },
            deny(value) {
                denied = value;
            },
            denyReads(value) {
                readDenied = value;
            },
            snapshot: () =>
                forms.parseNativeFormProgressValue(
                    data.get('form-progress-synthetic') ?? null
                ),
            render: async (patch) => {
                props = { ...props, ...patch };
                await act(async () => root.render(element()));
            },
            publish: async (record) => {
                props = { ...props, record: { type: 'create', data: record } };
                await act(async () => root.render(element()));
            },
            release: async () => {
                assert(locks.length > 0, 'expected a held lock');
                await act(async () => locks.shift()());
            },
            rejectLock: async () => {
                assert(locks.length > 0, 'expected a held lock');
                await act(async () =>
                    locks.shift()(Error('Synthetic unavailable lock'))
                );
            },
            event: async (key, newValue) => {
                await act(async () => {
                    for (const listener of listeners)
                        listener({ key, newValue });
                });
            },
            unmount: async () => {
                if (!unmounted) {
                    await act(async () => root.unmount());
                    unmounted = true;
                    container.remove();
                }
            },
            cleanupOwned: async (writerId) => {
                const result = factory('synthetic', writerId).removeIfOwned();
                return result;
            },
        };
        fixtures.push(f);
        await f.render({});
        return f;
    }
    const envelope = (
        writerId = 'foreign',
        revision = 7,
        record = { restored: true }
    ) =>
        JSON.stringify({
            kind: 'miniExtensions-form-progress',
            schemaVersion: 1,
            writerId,
            revision,
            record,
        });
    try {
        // Hydration/equality are not edits; ordered edits retain original hidden values/references.
        const f = await fixture({ held: true });
        assert.equal(f.records.length, 0);
        await f.publish({ visible: 'hydrated', hidden: 'retained' });
        assert.equal(f.records.length, 0);
        const first = { visible: 'edited', hidden: 'retained' },
            back = { visible: 'hydrated', hidden: 'retained' };
        await f.publish(first);
        await f.publish(back);
        assert.equal(f.locks.length, 1);
        assert.equal(f.records[0], first);
        await f.release();
        assert.equal(f.records[1], back);
        assert.equal(f.locks.length, 1);
        await f.release();
        assert.deepEqual(f.snapshot(), {
            revision: 2,
            writerId: 'writer-1',
            record: back,
        });
        await f.unmount();
        assert.equal(f.teardowns, 1);

        // StrictMode legacy replay: retired callback must run first, before CAS can mask it.
        const legacy = { visible: 'hydrated', hidden: 'retained' };
        const s = await fixture({
            seed: JSON.stringify(legacy),
            held: true,
            strict: true,
        });
        assert.equal(s.locks.length, 2);
        const before = s.io.length;
        await s.release();
        assert.equal(s.io.length, before);
        assert.equal(s.snapshot().revision, 0);
        await s.release();
        assert.deepEqual(s.snapshot(), {
            revision: 1,
            writerId: 'writer-2',
            record: legacy,
        });
        await s.publish({ visible: 'post-replay edit', hidden: 'retained' });
        assert.equal(s.locks.length, 1);
        await s.release();
        assert.equal(s.snapshot().revision, 2);
        const strictBytes = s.data.get('form-progress-synthetic');
        await s.unmount();
        assert.equal(s.data.get('form-progress-synthetic'), strictBytes);
        assert.equal(s.subscriptions, s.teardowns);

        // Surface OFF, absent direct share, ineligible config, and Save adoption have distinct removal authority.
        for (const [patch, removes] of [
            [{ surfaceEnabled: false }, 0],
            [{ shareId: null }, 0],
            [{ configurationEligible: false }, 1],
            [{ record: { type: 'edit', data: {} } }, 0],
        ]) {
            const t = await fixture({ seed: envelope(), initial: patch });
            assert.equal(
                t.io.filter(([op]) => op === 'remove').length,
                removes
            );
            assert.equal(t.records.length, 0);
            assert.equal(t.ids, 0);
            await t.unmount();
        }

        // Losing the direct share in the same mount retires a held writer
        // without removing either stored draft. Returning admits a fresh edit.
        const directKey = 'form-progress-synthetic';
        const neighborKey = 'form-progress-adjacent';
        const directBytes = envelope('original-writer', 4, legacy);
        const neighborBytes = envelope('neighbor-writer', 9, {
            neighbor: true,
        });
        const direct = await fixture({ seed: directBytes, held: true });
        direct.data.set(neighborKey, neighborBytes);
        const queuedEdit = { ...legacy, visible: 'held old edit' };
        const freshEdit = { ...legacy, visible: 'fresh direct edit' };
        await direct.publish(queuedEdit);
        const queued = {
            locks: direct.locks.length,
            attempts: [...direct.records],
        };
        const beforeDeactivation = direct.io.length;
        await direct.render({ shareId: null });
        await direct.release();
        const afterRetirement = {
            io: direct.io.slice(beforeDeactivation),
            directBytes: direct.data.get(directKey),
            neighborBytes: direct.data.get(neighborKey),
            locks: direct.locks.length,
            attempts: [...direct.records],
        };

        // Read back the retained draft for reactivation in both red and green
        // cases, so the next real edit is measured even if retirement failed.
        await direct.render({
            shareId: 'synthetic',
            record: { type: 'create', data: direct.snapshot().record },
        });
        const reactivated = {
            locks: direct.locks.length,
            attempts: [...direct.records],
        };
        const beforeFreshEdit = direct.io.length;
        await direct.publish(freshEdit);
        await direct.release();
        const resumed = {
            io: direct.io.slice(beforeFreshEdit),
            snapshot: direct.snapshot(),
            neighborBytes: direct.data.get(neighborKey),
            locks: direct.locks.length,
            attempts: [...direct.records],
        };
        await direct.unmount();
        const directShareRetirement = {
            queued,
            retired: afterRetirement,
            reactivated,
            resumed,
        };
        assert.deepEqual(
            directShareRetirement,
            {
                queued: { locks: 1, attempts: [queuedEdit] },
                retired: {
                    io: [],
                    directBytes,
                    neighborBytes,
                    locks: 0,
                    attempts: [queuedEdit],
                },
                reactivated: { locks: 0, attempts: [queuedEdit] },
                resumed: {
                    io: [
                        ['read', directKey],
                        ['write', directKey],
                    ],
                    snapshot: {
                        revision: 5,
                        writerId: 'writer-2',
                        record: freshEdit,
                    },
                    neighborBytes,
                    locks: 0,
                    attempts: [queuedEdit, freshEdit],
                },
            },
            'Held work must retire when the direct share disappears'
        );

        for (const cutoff of ['unmount', 'off', 'save']) {
            const t = await fixture({ held: true });
            await t.publish({ edited: cutoff });
            if (cutoff === 'unmount') await t.unmount();
            else if (cutoff === 'off')
                await t.render({ configurationEligible: false });
            else await t.render({ record: { type: 'edit', data: {} } });
            const count = t.io.length;
            await t.release();
            assert.equal(t.io.length, count);
            assert.equal(t.snapshot(), undefined);
            assert.equal(t.container.querySelector('[role=alert]'), null);
            await t.unmount();
        }
        const toggled = await fixture({ held: true });
        await toggled.publish({ old: true });
        await toggled.render({ configurationEligible: false });
        await toggled.render({ configurationEligible: true });
        await toggled.publish({ current: true });
        const toggleIo = toggled.io.length;
        await toggled.release();
        assert.equal(toggled.io.length, toggleIo);
        await toggled.release();
        assert.deepEqual(toggled.snapshot().record, { current: true });
        await toggled.unmount();

        // Existing draft updates must also be fenced, preserving unrelated shares.
        for (const cutoff of ['unmount', 'surface', 'config', 'save']) {
            const original = envelope('writer-1', 4, legacy);
            const t = await fixture({ seed: original, held: true });
            t.data.set('form-progress-adjacent', 'adjacent sentinel');
            await t.publish({ updated: true });
            if (cutoff === 'unmount') await t.unmount();
            else if (cutoff === 'surface')
                await t.render({ surfaceEnabled: false });
            else if (cutoff === 'config')
                await t.render({ configurationEligible: false });
            else await t.render({ record: { type: 'edit', data: {} } });
            const count = t.io.length;
            await t.release();
            assert.equal(t.io.length, count);
            assert.equal(
                t.data.get('form-progress-synthetic'),
                cutoff === 'config' ? undefined : original
            );
            assert.equal(
                t.data.get('form-progress-adjacent'),
                'adjacent sentinel'
            );
            await t.unmount();
        }

        // No witness differs from explicit absence. Fresh reads reject Restore races, including legacy zero.
        const unknown = await fixture({
            seed: envelope(),
            initial: { progressRead: undefined },
        });
        assert.equal(unknown.snapshot().revision, 8);
        assert.equal(unknown.container.querySelector('[role=alert]'), null);
        await unknown.unmount();
        for (const [seed, receipt] of [
            [
                envelope(),
                { shareId: 'synthetic', revision: null, writerId: null },
            ],
            [envelope(), { shareId: 'synthetic', revision: 0, writerId: null }],
            [
                envelope(),
                {
                    shareId: 'synthetic',
                    revision: 7,
                    writerId: 'previous-writer',
                },
            ],
            [undefined, { shareId: 'other', revision: null, writerId: null }],
        ]) {
            const t = await fixture({
                seed,
                initial: { progressRead: receipt },
            });
            assert.equal(t.io.filter(([op]) => op === 'write').length, 0);
            assert(t.container.querySelector('[role=alert]'));
            await t.render({ configurationEligible: false });
            await t.render({ configurationEligible: true });
            await t.publish({ new: true });
            assert(t.container.querySelector('[role=alert]'));
            assert.equal(t.io.filter(([op]) => op === 'write').length, 0);
            await t.unmount();
        }
        const absence = await fixture({
            initial: {
                progressRead: {
                    shareId: 'synthetic',
                    revision: null,
                    writerId: null,
                },
            },
        });
        await absence.publish({ edit: 1 });
        assert.equal(absence.snapshot().revision, 1);
        await absence.unmount();
        // Synchronous unavailable reads still mean undefined; explicit absence remains a witness.
        for (const receipt of [
            undefined,
            { shareId: 'synthetic', revision: null, writerId: null },
        ]) {
            const t = await fixture({
                seed: envelope(),
                readDenied: true,
                initial: { progressRead: receipt },
            });
            assert.equal(t.container.querySelector('[role=alert]'), null);
            assert.equal(t.records.length, 0);
            t.denyReads(false);
            await t.publish({ changed: true });
            assert(t.container.querySelector('[role=alert]'));
            assert.equal(t.data.get('form-progress-synthetic'), envelope());
            await t.unmount();
        }
        const unavailableWitness = await fixture({
            seed: envelope(),
            readDenied: true,
            initial: {
                progressRead: {
                    shareId: 'synthetic',
                    revision: 7,
                    writerId: 'foreign',
                },
            },
        });
        assert(unavailableWitness.container.querySelector('[role=alert]'));
        assert.equal(unavailableWitness.records.length, 0);
        await unavailableWitness.unmount();
        const legacyReceipt = await fixture({
            seed: JSON.stringify(legacy),
            initial: {
                progressRead: {
                    shareId: 'synthetic',
                    revision: 0,
                    writerId: null,
                },
            },
        });
        assert.equal(legacyReceipt.snapshot().revision, 1);
        await legacyReceipt.unmount();

        // Unavailable arms one later publication, not an effect/timer loop; consume retry on admission.
        const retry = await fixture({ held: true });
        retry.deny(true);
        await retry.publish({ x: 1 });
        await retry.release();
        assert.equal(retry.locks.length, 0);
        assert.equal(retry.records.length, 1);
        await retry.publish({ x: 1 });
        await retry.publish({ x: 1 });
        assert.equal(retry.records.length, 2);
        assert.equal(retry.locks.length, 1);
        retry.deny(false);
        await retry.release();
        assert.equal(retry.snapshot().revision, 1);
        await retry.unmount();
        const stale = await fixture({ held: true });
        stale.deny(true);
        await stale.publish({ x: 1 });
        await stale.publish({ x: 2 });
        await stale.release();
        await stale.publish({ x: 2 });
        assert.equal(stale.records.length, 2);
        stale.deny(false);
        await stale.release();
        assert.deepEqual(stale.snapshot().record, { x: 2 });
        await stale.unmount();
        // A transient read failure inside the held lock leaves the saved revision intact.
        const readRetry = await fixture({ held: true });
        const progressKey = 'form-progress-synthetic';
        const firstEdit = { edit: 'A' };
        const failedEdit = { edit: 'B' };
        const recoveredEdit = { edit: 'C' };
        await readRetry.publish(firstEdit);
        await readRetry.release();
        assert.deepEqual(readRetry.snapshot(), {
            record: firstEdit,
            revision: 1,
            writerId: 'writer-1',
        });
        const savedBytes = readRetry.data.get(progressKey);

        const browserTimers = [];
        mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'] });
        try {
            for (const name of [
                'setTimeout',
                'clearTimeout',
                'setInterval',
                'clearInterval',
            ]) {
                browserTimers.push(mock.method(window, name, globalThis[name]));
            }
            await readRetry.publish(failedEdit);
            assert.equal(readRetry.locks.length, 1);
            const beforeFailedRead = readRetry.io.length;
            readRetry.denyReads(true);
            await readRetry.release();
            for (const readDenied of [true, false]) {
                readRetry.denyReads(readDenied);
                await act(async () => mock.timers.tick(60_000));
                assert.equal(
                    readRetry.container.querySelector('[role=alert]')
                        ?.textContent,
                    undefined
                );
                assert.equal(readRetry.data.get(progressKey), savedBytes);
                assert.deepEqual(readRetry.records, [firstEdit, failedEdit]);
                assert.equal(readRetry.lockRequests, 2);
                assert.equal(readRetry.locks.length, 0);
                assert.deepEqual(readRetry.io.slice(beforeFailedRead), [
                    ['read', progressKey],
                ]);
            }
        } finally {
            for (const timer of browserTimers) timer.mock.restore();
            mock.timers.reset();
        }

        const beforeRecovery = readRetry.io.length;
        await readRetry.publish(recoveredEdit);
        await readRetry.release();
        assert.equal(readRetry.lockRequests, 3);
        assert.equal(readRetry.locks.length, 0);
        assert.deepEqual(readRetry.records, [
            firstEdit,
            failedEdit,
            recoveredEdit,
        ]);
        assert.deepEqual(readRetry.io.slice(beforeRecovery), [
            ['read', progressKey],
            ['write', progressKey],
        ]);
        assert.deepEqual(readRetry.snapshot(), {
            record: recoveredEdit,
            revision: 2,
            writerId: 'writer-1',
        });
        assert.equal(
            readRetry.container.querySelector('[role=alert]')?.textContent,
            undefined
        );
        await readRetry.unmount();

        // A rejected lookup leaves this mounted writer's queue available for a new edit.
        const lookupFailure = new Error('Synthetic lock lookup failure');
        let lookupOutage = false;
        let lockLookups = 0;
        let failedLookups = 0;
        const recovery = await fixture({
            held: true,
            withForm: true,
            beforeLockLookup() {
                lockLookups++;
                if (lookupOutage && failedLookups === 0) {
                    failedLookups++;
                    throw lookupFailure;
                }
            },
        });
        assert(recovery.container.querySelector('form'));
        const draftA = { visible: 'A', hidden: 'retained' };
        const draftB = { visible: 'B', hidden: 'retained' };
        const draftC = { visible: 'C', hidden: 'retained' };
        const draftD = { visible: 'D', hidden: 'retained' };
        const rejectionReasons = [];
        const onRejection = (reason) => rejectionReasons.push(reason);
        const observeRejections = () =>
            new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
        process.on('unhandledRejection', onRejection);
        let lookupRecovery;
        try {
            await recovery.publish(draftA);
            await recovery.release();
            const storedA = recovery.data.get(progressKey);
            const savedA = recovery.snapshot();
            assert.equal(typeof storedA, 'string');
            assert.deepEqual(savedA, {
                record: draftA,
                revision: 1,
                writerId: 'writer-1',
            });
            assert.equal(lockLookups, 1);
            assert.equal(recovery.lockRequests, 1);
            const ioBeforeB = recovery.io.length;
            const storageBeforeB = recovery.storageLookups;
            lookupOutage = true;
            await recovery.publish(draftB);
            await observeRejections();
            assert.equal(failedLookups, 1);
            assert.equal(lockLookups, 2);
            assert.equal(recovery.lockRequests, 1);
            assert.equal(recovery.storageLookups, storageBeforeB);
            assert.deepEqual(recovery.io.slice(ioBeforeB), []);
            assert.equal(recovery.data.get(progressKey), storedA);
            assert.deepEqual(recovery.records, [draftA, draftB]);
            assert.equal(
                recovery.container.querySelector('[role=alert]'),
                null
            );
            assert.equal(recovery.submits, 0);

            lookupOutage = false;
            await observeRejections();
            assert.equal(recovery.data.get(progressKey), storedA);
            // An equal publication is still not a new edit after a rejected port.
            await recovery.publish({ ...draftB });
            await observeRejections();
            assert.equal(recovery.data.get(progressKey), storedA);
            assert.equal(lockLookups, 2);
            assert.equal(recovery.lockRequests, 1);
            assert.equal(recovery.storageLookups, storageBeforeB);
            assert.deepEqual(recovery.io.slice(ioBeforeB), []);
            assert.deepEqual(recovery.records, [draftA, draftB]);

            await recovery.publish(draftC);
            // The failing baseline never admits C, so capture its state as well.
            if (recovery.locks.length > 0) await recovery.release();
            await observeRejections();
            const savedC = recovery.snapshot();
            assert.deepEqual(
                {
                    rejected: rejectionReasons.map((reason) => reason?.message),
                    attempted: recovery.records,
                    saved: savedC,
                },
                {
                    rejected: [],
                    attempted: [draftA, draftB, draftC],
                    saved: {
                        record: draftC,
                        revision: 2,
                        writerId: savedA.writerId,
                    },
                },
                'Rejected lock lookup must not block the next draft write'
            );
            assert.equal(lockLookups, 3);
            assert.equal(recovery.lockRequests, 2);
            assert.equal(recovery.locks.length, 0);
            assert.deepEqual(recovery.io.slice(ioBeforeB), [
                ['read', progressKey],
                ['write', progressKey],
            ]);
            assert.equal(
                recovery.container.querySelector('[role=alert]'),
                null
            );

            const foreignDraft = envelope('foreign', 9, { visible: 'other' });
            recovery.data.set(progressKey, foreignDraft);
            const ioBeforeConflict = recovery.io.length;
            await recovery.publish(draftD);
            await recovery.release();
            assert(recovery.container.querySelector('[role=alert]'));
            assert.equal(recovery.data.get(progressKey), foreignDraft);
            assert.deepEqual(recovery.io.slice(ioBeforeConflict), [
                ['read', progressKey],
            ]);
            await recovery.publish({ visible: 'later' });
            await observeRejections();
            assert.equal(recovery.data.get(progressKey), foreignDraft);
            assert.deepEqual(recovery.records, [
                draftA,
                draftB,
                draftC,
                draftD,
            ]);
            assert.equal(lockLookups, 4);
            assert.equal(recovery.lockRequests, 3);
            assert.equal(recovery.ids, 1);
            assert.deepEqual(rejectionReasons, []);
            assert.equal(recovery.submits, 0);
            lookupRecovery = {
                revisions: [savedA.revision, savedC.revision, 9],
                writerId: savedC.writerId,
                lockLookups,
                lockRequests: recovery.lockRequests,
                writes: recovery.io.filter(
                    ([operation]) => operation === 'write'
                ).length,
                submits: recovery.submits,
            };
        } finally {
            process.off('unhandledRejection', onRejection);
        }
        await recovery.unmount();

        // Cancellation cannot arm a newly acquired writer.
        const retired = await fixture({ held: true });
        await retired.publish({ old: true });
        await retired.render({ surfaceEnabled: false });
        await retired.render({ surfaceEnabled: true });
        await retired.release();
        await retired.publish({ old: true });
        assert.equal(retired.records.length, 1);
        assert.equal(retired.snapshot(), undefined);
        assert.equal(retired.container.querySelector('[role=alert]'), null);
        await retired.publish({ genuine: 'later edit' });
        await retired.release();
        assert.equal(retired.snapshot().revision, 1);
        await retired.unmount();
        // A rejected held lock really returns unavailable after retirement.
        const unavailable = await fixture({ held: true });
        await unavailable.publish({ old: true });
        await unavailable.render({ surfaceEnabled: false });
        await unavailable.render({ surfaceEnabled: true });
        await unavailable.rejectLock();
        await unavailable.publish({ old: true });
        assert.equal(unavailable.records.length, 1);
        assert.equal(unavailable.snapshot(), undefined);
        assert.equal(unavailable.container.querySelector('[role=alert]'), null);
        await unavailable.publish({ current: true });
        await unavailable.release();
        assert.equal(unavailable.snapshot().revision, 1);
        await unavailable.unmount();

        // Exact raw event semantics and current-writer subscription after edit -> create.
        const events = await fixture();
        await events.publish({ own: true });
        for (const [key, value] of [
            [null, null],
            ['form-progress-other', null],
            ['form-progress-synthetic', '{'],
            ['form-progress-synthetic', envelope('writer-1')],
        ]) {
            await events.event(key, value);
            assert.equal(events.container.querySelector('[role=alert]'), null);
        }
        await events.render({ record: { type: 'edit', data: {} } });
        await events.publish({ current: 'writer-2' });
        assert.equal(events.subscriptions, 1);
        await events.event('form-progress-synthetic', envelope('writer-2'));
        assert.equal(events.container.querySelector('[role=alert]'), null);
        await events.event('form-progress-synthetic', envelope('foreign'));
        assert(events.container.querySelector('[role=alert]'));
        const writes = events.records.length;
        await events.publish({ another: true });
        assert.equal(events.records.length, writes);
        await events.unmount();
        const removal = await fixture();
        await removal.event('form-progress-synthetic', null);
        assert(removal.container.querySelector('[role=alert]'));
        await removal.unmount();

        // Conflict during a held write revokes I/O and suppresses the rest of that queue.
        const heldConflict = await fixture({ held: true });
        await heldConflict.publish({ first: true });
        await heldConflict.publish({ second: true });
        await heldConflict.event(
            'form-progress-synthetic',
            envelope('foreign')
        );
        const conflictIo = heldConflict.io.length;
        await heldConflict.release();
        assert.equal(heldConflict.io.length, conflictIo);
        assert.equal(heldConflict.locks.length, 0);
        assert.equal(heldConflict.records.length, 1);
        assert.equal(heldConflict.snapshot(), undefined);
        assert(heldConflict.container.querySelector('[role=alert]'));
        await heldConflict.publish({ later: true });
        assert.equal(heldConflict.records.length, 1);
        await heldConflict.unmount();
        // Fresh storage compare-and-set also conflicts without an event notification.
        const casConflict = await fixture({ held: true });
        await casConflict.publish({ edited: true });
        const newerBytes = envelope('foreign', 9);
        casConflict.data.set('form-progress-synthetic', newerBytes);
        await casConflict.release();
        assert(casConflict.container.querySelector('[role=alert]'));
        assert.equal(
            casConflict.data.get('form-progress-synthetic'),
            newerBytes
        );
        await casConflict.publish({ later: true });
        assert.equal(casConflict.records.length, 1);
        assert.equal(casConflict.locks.length, 0);
        await casConflict.unmount();

        // A recreated draft can reuse a revision while changing its writer.
        const previousAnswers = { answer: 'previous draft' };
        const recreatedAnswers = { answer: 'recreated draft' };
        const staleTab = await fixture({
            seed: envelope('old-tab', 4, previousAnswers),
            held: true,
            withForm: true,
            initial: {
                record: { type: 'create', data: previousAnswers },
                progressRead: {
                    shareId: 'synthetic',
                    revision: 4,
                    writerId: 'old-tab',
                },
            },
        });
        assert.deepEqual(staleTab.records, []);
        await staleTab.publish({ answer: 'stale edit' });
        const recreatedBytes = envelope('other-tab', 4, recreatedAnswers);
        staleTab.data.set(progressKey, recreatedBytes);
        const ioBeforeRelease = staleTab.io.length;
        await staleTab.release();
        assert.equal(staleTab.data.get(progressKey), recreatedBytes);
        assert.deepEqual(staleTab.io.slice(ioBeforeRelease), [
            ['read', progressKey],
        ]);
        assert.match(
            staleTab.container.querySelector('[role=alert]')?.textContent ?? '',
            /Saved progress changed in another tab/
        );
        await staleTab.publish({ answer: 'another stale edit' });
        assert.equal(staleTab.records.length, 1);
        assert.equal(staleTab.lockRequests, 1);
        assert.equal(staleTab.locks.length, 0);
        assert.equal(staleTab.submits, 0);
        await staleTab.unmount();

        const restoredTab = await fixture({
            seed: recreatedBytes,
            held: true,
            withForm: true,
            initial: {
                record: { type: 'create', data: recreatedAnswers },
                progressRead: {
                    shareId: 'synthetic',
                    revision: 4,
                    writerId: 'other-tab',
                },
            },
        });
        assert.deepEqual(restoredTab.records, []);
        const nextAnswers = { answer: 'edit after Restore' };
        await restoredTab.publish(nextAnswers);
        await restoredTab.release();
        assert.deepEqual(restoredTab.snapshot(), {
            revision: 5,
            writerId: 'writer-1',
            record: nextAnswers,
        });
        assert.deepEqual(restoredTab.records, [nextAnswers]);
        assert.equal(restoredTab.lockRequests, 1);
        assert.equal(restoredTab.container.querySelector('[role=alert]'), null);
        assert.equal(restoredTab.submits, 0);
        await restoredTab.unmount();

        // Save owns guarded removal, including preservation of a competing writer.
        const save = await fixture({ held: true });
        await save.publish({ queued: true });
        await save.render({ record: { type: 'edit', data: {} } });
        const cleanup = save.cleanupOwned('writer-1');
        await save.release();
        await save.release();
        assert.deepEqual(await cleanup, { status: 'removed' });
        assert.equal(save.snapshot(), undefined);
        await save.unmount();
        const foreign = await fixture({ seed: envelope() });
        const foreignBytes = foreign.data.get('form-progress-synthetic');
        // The mounted publication already legitimately wrote under no Restore witness; reset to a foreign envelope before Submit cleanup.
        foreign.data.set('form-progress-synthetic', envelope('other', 99));
        assert.deepEqual(await foreign.cleanupOwned('writer-1'), {
            status: 'preserved-newer-progress',
        });
        assert.equal(
            foreign.data.get('form-progress-synthetic'),
            envelope('other', 99)
        );
        assert(foreignBytes);
        await foreign.unmount();
        return {
            fixtures: fixtures.length,
            ssrCalls,
            directShareRetirement,
            lookupRecovery,
            pendingLocks: fixtures.reduce(
                (count, f) => count + f.locks.length,
                0
            ),
        };
    } finally {
        for (const f of fixtures) await f.unmount();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    }
}
