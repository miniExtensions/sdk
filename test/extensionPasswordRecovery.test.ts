import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AuthFlowError,
    createAuthFlow,
    type AuthCredentialGrant,
} from '../src/auth/index.js';
import { authFixture, deferred, passwordPage } from './authFixtures.js';

/**
 * Qualification witness, not a shipped password controller or native adapter.
 * The existing fixture creates a real SDK client; only external auth responses,
 * selected-driver storage and page reload are synthetic. Grants and their
 * consumption/retirement are always provided by the actual auth-flow core.
 */
const recoveryWitness = (
    options: {
        storage?: 'normal' | 'throw-before-write' | 'write-then-throw';
        readbackThrows?: boolean;
        reload?: () => Promise<void>;
    } = {}
) => {
    type Phase =
        | 'idle'
        | 'verifying'
        | 'fresh-page-required'
        | 'reading'
        | 'retry-read'
        | 'awaiting-replacement'
        | 'retired';
    const fixture = authFixture();
    const page = passwordPage();
    const ownedKey = `miniExtb7BuZl-${page.extensionId}`;
    const stored = new Map(Object.entries(fixture.client.getSession()));
    const neighbours = [...stored];
    let current = { ownerId: 'synthetic_visitor', revision: 0 };
    const admitted = current;
    let mounted = true;
    let phase: Phase = 'idle';
    let grant: AuthCredentialGrant | undefined;
    let expectedOwnedEntry: string | undefined;
    const counts = {
        setterEntries: 0,
        setterReturns: 0,
        writes: 0,
        readbacks: 0,
        reloads: 0,
    };
    let readback: 'not-read' | 'observed-match' | 'unknown' = 'not-read';
    const isCurrentPage = () => mounted && current === admitted;
    const setClientSession = fixture.client.setSession;
    fixture.client.setSession = (session) => {
        counts.setterEntries += 1;
        expectedOwnedEntry = session[ownedKey];
        assert.equal(typeof expectedOwnedEntry, 'string');
        if (options.storage === 'throw-before-write')
            throw new Error('Synthetic setter-entry refusal.');
        stored.set(ownedKey, expectedOwnedEntry!);
        counts.writes += 1;
        if (options.storage === 'write-then-throw')
            throw new Error('Synthetic failure after selected-driver write.');
        setClientSession(session);
        counts.setterReturns += 1;
    };
    const flow = createAuthFlow({
        client: fixture.client,
        page,
        getScope: () => current,
    });
    const readPage = async (): Promise<boolean> => {
        if (!isCurrentPage()) return false;
        phase = 'reading';
        counts.reloads += 1;
        try {
            await options.reload?.();
        } catch {
            phase = isCurrentPage() ? 'retry-read' : 'retired';
            return false;
        }
        // A resolved void callback is not an accepted successor page.
        phase = isCurrentPage() ? 'awaiting-replacement' : 'retired';
        return true;
    };
    return {
        flow,
        // Unprojected, nonsecret test observation: a guarded getter alone must
        // not hide an incorrect live transition after a retired read settles.
        get recordedPhase() {
            return phase;
        },
        get grant() {
            assert.ok(grant, 'The real core must issue the grant first.');
            return grant;
        },
        get observations() {
            return {
                ...counts,
                verifyCalls: fixture.calls.filter(
                    (call) => call.operation === 'password'
                ).length,
                readback,
                phase: isCurrentPage() ? phase : 'retired',
            };
        },
        get ownedEntryObserved() {
            return (
                expectedOwnedEntry !== undefined &&
                stored.get(ownedKey) === expectedOwnedEntry
            );
        },
        get neighboursPreserved() {
            return neighbours.every(
                ([key, value]) => stored.get(key) === value
            );
        },
        async submit(): Promise<boolean> {
            if (!isCurrentPage() || phase !== 'idle') return false;
            phase = 'verifying';
            const result = await flow.verifyPassword({
                extensionPassword: 'synthetic-only-input',
            });
            assert.equal(result.type, 'correct');
            if (result.type !== 'correct') return false;
            grant = result.grant;
            if (!isCurrentPage()) return false;
            try {
                flow.applySession(grant);
            } catch {
                // Entry of this freshly issued grant's setter proves it was
                // spent. A throw says nothing about rollback or persistence.
                phase = isCurrentPage() ? 'fresh-page-required' : 'retired';
                return true;
            }
            if (!isCurrentPage()) return true;
            counts.readbacks += 1;
            try {
                if (options.readbackThrows)
                    throw new Error('Synthetic selected-driver read failure.');
                readback =
                    stored.get(ownedKey) === expectedOwnedEntry
                        ? 'observed-match'
                        : 'unknown';
            } catch {
                readback = 'unknown';
            }
            if (readback !== 'observed-match') {
                phase = 'fresh-page-required';
                return true;
            }
            await readPage();
            return true;
        },
        recoverFreshPage: () =>
            phase === 'fresh-page-required'
                ? readPage()
                : Promise.resolve(false),
        retryRead: () =>
            phase === 'retry-read' ? readPage() : Promise.resolve(false),
        replacePage(ownerId = current.ownerId) {
            current = { ownerId, revision: current.revision + 1 };
        },
        unmount() {
            mounted = false;
            flow.destroy();
        },
    };
};

const requiresReload = (error: unknown) =>
    error instanceof AuthFlowError && error.code === 'reload-required';

describe('real one-use password grant with synthetic recovery boundaries', () => {
    it('spends a fresh grant before a throwing setter is entered', async () => {
        const witness = recoveryWitness({ storage: 'throw-before-write' });
        await witness.submit();
        assert.deepEqual(witness.observations, {
            setterEntries: 1,
            setterReturns: 0,
            writes: 0,
            readbacks: 0,
            reloads: 0,
            verifyCalls: 1,
            readback: 'not-read',
            phase: 'fresh-page-required',
        });
        assert.equal(witness.flow.isCurrent(), false);
        assert.throws(
            () => witness.flow.applySession(witness.grant),
            requiresReload
        );
        assert.equal(witness.observations.setterEntries, 1);
        assert.equal(await witness.submit(), false);
    });

    it('never rolls back or reapplies a write that completed before a throw', async () => {
        const witness = recoveryWitness({ storage: 'write-then-throw' });
        await witness.submit();
        assert.equal(witness.ownedEntryObserved, true);
        assert.equal(witness.neighboursPreserved, true);
        assert.equal(witness.observations.setterReturns, 0);
        assert.equal(witness.observations.phase, 'fresh-page-required');
        assert.throws(
            () => witness.flow.applySession(witness.grant),
            requiresReload
        );
        assert.equal(await witness.retryRead(), false);
        assert.equal(await witness.recoverFreshPage(), true);
        assert.equal(witness.ownedEntryObserved, true);
        assert.equal(witness.observations.writes, 1);
        assert.equal(witness.observations.setterEntries, 1);
        assert.equal(witness.observations.verifyCalls, 1);
        assert.equal(witness.observations.reloads, 1);
        assert.equal(witness.observations.phase, 'awaiting-replacement');
    });

    it('keeps failed owned-entry readback unknown despite setter return', async () => {
        const witness = recoveryWitness({ readbackThrows: true });
        await witness.submit();
        assert.equal(witness.observations.setterReturns, 1);
        assert.equal(witness.ownedEntryObserved, true);
        assert.equal(witness.observations.readback, 'unknown');
        assert.equal(witness.observations.phase, 'fresh-page-required');
        assert.equal(witness.observations.reloads, 0);
        assert.equal(await witness.retryRead(), false);
        await witness.recoverFreshPage();
        assert.equal(witness.observations.verifyCalls, 1);
        assert.equal(witness.observations.setterEntries, 1);
        assert.equal(witness.observations.readbacks, 1);
        assert.equal(witness.observations.reloads, 1);
    });

    it('retries only the page read after observed application and rejected reload', async () => {
        let attempts = 0;
        const witness = recoveryWitness({
            reload: async () => {
                attempts += 1;
                if (attempts === 1)
                    throw new Error('Synthetic reload failure.');
            },
        });
        await witness.submit();
        assert.equal(witness.observations.readback, 'observed-match');
        assert.equal(witness.observations.phase, 'retry-read');
        assert.equal(await witness.retryRead(), true);
        assert.equal(witness.observations.verifyCalls, 1);
        assert.equal(witness.observations.setterEntries, 1);
        assert.equal(witness.observations.writes, 1);
        assert.equal(witness.observations.readbacks, 1);
        assert.equal(witness.observations.reloads, 2);
        assert.equal(witness.observations.phase, 'awaiting-replacement');
    });

    it('does not reactivate submission when reload resolves on the same page', async () => {
        const witness = recoveryWitness();
        await witness.submit();
        assert.equal(witness.observations.phase, 'awaiting-replacement');
        assert.equal(await witness.submit(), false);
        assert.equal(await witness.retryRead(), false);
        assert.equal(await witness.recoverFreshPage(), false);
        await assert.rejects(
            witness.flow.verifyPassword({
                extensionPassword: 'synthetic-only-input',
            }),
            requiresReload
        );
        assert.equal(witness.observations.verifyCalls, 1);
        assert.equal(witness.observations.setterEntries, 1);
        assert.equal(witness.observations.reloads, 1);
    });

    it('retires captured recovery callbacks on replacement, ABA and unmount', async () => {
        const witness = recoveryWitness({
            reload: async () => {
                throw new Error('Synthetic reload failure.');
            },
        });
        await witness.submit();
        const oldRetry = witness.retryRead;
        witness.replacePage('other_synthetic_visitor');
        witness.replacePage('synthetic_visitor');
        assert.equal(await oldRetry(), false);
        witness.unmount();
        assert.equal(await oldRetry(), false);
        assert.equal(witness.observations.phase, 'retired');
        assert.equal(witness.observations.verifyCalls, 1);
        assert.equal(witness.observations.setterEntries, 1);
        assert.equal(witness.observations.reloads, 1);

        const pending = deferred<void>();
        const entered = deferred<void>();
        const late = recoveryWitness({
            reload: () => {
                entered.resolve();
                return pending.promise;
            },
        });
        const submitting = late.submit();
        await entered.promise;
        assert.equal(late.observations.reloads, 1);
        late.replacePage();
        pending.resolve();
        await submitting;
        assert.equal(late.observations.phase, 'retired');
        assert.equal(late.recordedPhase, 'retired');
        assert.equal(await late.retryRead(), false);
        assert.equal(late.observations.verifyCalls, 1);
        assert.equal(late.observations.setterEntries, 1);
        assert.equal(late.observations.reloads, 1);
    });
});
