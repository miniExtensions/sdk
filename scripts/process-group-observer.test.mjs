import assert from 'node:assert/strict';
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    readlink,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createProcessGroupObserver } from './process-group-observer.mjs';

const selfPid = 1000;
const leaderPid = 4200;
const childPid = 4201;
const leaderStart = '9007199254740993';
const childStart = '9007199254740994';
const namespace = 'pid:[4026532001]';
const stat = (row) => {
    const fields = Array(50).fill('0');
    fields[0] = row.state;
    fields[1] = String(row.ppid);
    fields[2] = String(row.pgid);
    fields[3] = String(row.sid);
    fields[5] = '-1';
    fields[15] = '20';
    fields[17] = String(row.numThreads);
    fields[19] = row.startTime;
    return `${row.pid} (${row.command ?? 'synthetic (worker) ) name'}) ${fields.join(' ')}\n`;
};
const row = (pid, overrides = {}) => ({
    pid,
    ppid: pid === childPid ? leaderPid : 1,
    pgid: leaderPid,
    sid: leaderPid,
    state: 'S',
    numThreads: 1,
    startTime: pid === leaderPid ? leaderStart : childStart,
    ...overrides,
});

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'sdk-process-observer-'));
    const procRoot = join(root, 'proc mount');
    await mkdir(procRoot);
    t.after(() => rm(root, { recursive: true, force: true }));
    const writeProcess = async (value, tasks = [value]) => {
        const directory = join(procRoot, String(value.pid));
        await mkdir(join(directory, 'ns'), { recursive: true });
        await writeFile(join(directory, 'stat'), stat(value));
        await rm(join(directory, 'task'), { recursive: true, force: true });
        for (const task of tasks) {
            const taskDirectory = join(directory, 'task', String(task.pid));
            await mkdir(taskDirectory, { recursive: true });
            await writeFile(join(taskDirectory, 'stat'), stat(task));
        }
        await rm(join(directory, 'ns', 'pid'), { force: true });
        await symlink(namespace, join(directory, 'ns', 'pid'));
    };
    await writeProcess(row(1, { pgid: 1, sid: 1, startTime: '1' }));
    await writeProcess(
        row(2, {
            ppid: 0,
            pgid: 0,
            sid: 0,
            state: 'I',
            startTime: '2',
        })
    );
    await writeProcess(
        row(selfPid, { pgid: selfPid, sid: selfPid, startTime: '100' })
    );
    await symlink(String(selfPid), join(procRoot, 'self'));
    await writeFile(
        join(procRoot, 'self', 'status'),
        `Name:\tsynthetic observer\nNSpid:\t${selfPid}\n`
    );
    const mountPoint = procRoot.replaceAll(' ', '\\040');
    await writeFile(
        join(procRoot, 'self', 'mountinfo'),
        `1 0 0:1 / ${mountPoint} rw,nosuid,nodev,noexec,relatime - proc proc rw\n`
    );
    await writeProcess(row(leaderPid));
    await writeProcess(row(childPid));
    let exists = true;
    const signals = [];
    const probes = [];
    const kill = (target, name) => {
        assert.equal(target, -leaderPid);
        if (name === 0) probes.push(target);
        else signals.push({ target, name });
        if (!exists)
            throw Object.assign(new Error('Absent fixture group'), {
                code: 'ESRCH',
            });
    };
    const observer = (overrides = {}) =>
        createProcessGroupObserver({
            pid: leaderPid,
            platform: 'linux',
            procRoot,
            selfPid,
            kill,
            ...overrides,
        });
    const zombies = async (overrides = {}, tasks) => {
        await rm(join(procRoot, String(leaderPid)), {
            recursive: true,
            force: true,
        });
        const value = row(childPid, { state: 'Z', ppid: 1, ...overrides });
        await writeProcess(value, tasks ?? [value]);
    };
    return {
        procRoot,
        observer,
        writeProcess,
        zombies,
        signals,
        probes,
        gone: () => {
            exists = false;
        },
    };
}

const capture = async (observer) => {
    const result = await observer.capture();
    assert.equal(result.state, 'live', JSON.stringify(result));
    return result;
};
const assertRetained = (result) => {
    assert.notEqual(result.state, 'gone');
    assert.notEqual(result.state, 'exited');
};

test('Linux proves an owned orphan zombie only with two complete stable scans and detached evidence', async (t) => {
    const f = await fixture(t);
    let scans = 0;
    const observer = f.observer({
        readdir: async (path, options) => {
            if (path === f.procRoot) scans++;
            return readdir(path, options);
        },
    });
    await capture(observer);
    assert.ok(scans >= 2);
    scans = 0;
    await f.zombies();
    const result = await observer.inspect();
    assert.equal(result.state, 'exited', JSON.stringify(result));
    assert.equal(result.mode, 'linux-proc');
    assert.ok(scans >= 2);
    assert.deepEqual(result.members, [
        {
            pid: childPid,
            ppid: 1,
            pgid: leaderPid,
            sid: leaderPid,
            state: 'Z',
            startTime: childStart,
            numThreads: 1,
        },
    ]);
    assert.ok(
        f.probes.length > 0,
        'killpg(0) remains positive in this fixture.'
    );
    assert.equal((await observer.signal('SIGTERM')).state, 'exited');
    assert.equal((await observer.signal('SIGKILL')).state, 'exited');
    assert.deepEqual(f.signals, []);
    const evidence = observer.getEvidence();
    const expected = structuredClone(evidence);
    assert.notEqual(evidence, observer.getEvidence());
    Reflect.set(evidence, 'syntheticMutation', true);
    result.members[0].state = 'S';
    assert.deepEqual(observer.getEvidence(), expected);
});

test('ESRCH remains sufficient without Linux procfs access', async () => {
    for (const platform of ['linux', 'darwin']) {
        const signals = [];
        const unexpected = async () => {
            throw new Error('Unexpected procfs access.');
        };
        const observer = createProcessGroupObserver({
            pid: leaderPid,
            platform,
            procRoot: '/synthetic-unreadable-proc',
            selfPid,
            kill(target, name) {
                assert.equal(target, -leaderPid);
                if (name !== 0) signals.push(name);
                throw Object.assign(new Error('Absent'), { code: 'ESRCH' });
            },
            readFile: unexpected,
            readdir: unexpected,
            readlink: unexpected,
        });
        assert.equal((await observer.capture()).state, 'gone');
        assert.equal((await observer.inspect()).state, 'gone');
        assert.equal((await observer.signal('SIGKILL')).state, 'gone');
        assert.deepEqual(signals, []);
    }
});

test('an enumerated PID disappearing discards the pair and requires two complete fresh scans', async (t) => {
    for (const mode of ['capture', 'live', 'exited']) {
        for (const vanishedScan of [1, 2]) {
            await t.test(`${mode}, scan ${vanishedScan}`, async (t) => {
                const f = await fixture(t);
                const foreignPid = childPid + 50;
                await f.writeProcess(
                    row(foreignPid, {
                        pgid: 9000,
                        sid: 9000,
                        startTime: '51',
                    })
                );
                let active = false;
                let scans = 0;
                let namespaces = 0;
                const observer = f.observer({
                    readdir: async (path, options) => {
                        const entries = await readdir(path, options);
                        if (
                            active &&
                            path === f.procRoot &&
                            ++scans === vanishedScan
                        ) {
                            assert.ok(entries.includes(String(foreignPid)));
                            await rm(join(f.procRoot, String(foreignPid)), {
                                recursive: true,
                            });
                        }
                        return entries;
                    },
                    readFile: async (path, options) => {
                        if (active && path === join(f.procRoot, 'self/status'))
                            namespaces++;
                        return readFile(path, options);
                    },
                });
                if (mode !== 'capture') await capture(observer);
                if (mode === 'exited') await f.zombies();
                active = true;
                const result =
                    await observer[
                        mode === 'capture' ? 'capture' : 'inspect'
                    ]();
                assert.equal(
                    result.state,
                    mode === 'exited' ? 'exited' : 'live',
                    JSON.stringify(result)
                );
                assert.equal(result.mode, 'linux-proc');
                assert.equal(
                    scans,
                    vanishedScan + 2,
                    'Both complete scans must restart after the partial pair.'
                );
                assert.equal(
                    namespaces,
                    scans,
                    'Every scan revalidates namespace visibility.'
                );
                assert.deepEqual(f.signals, []);
            });
        }
    }
});

test('a disappearing owned member cannot discard the remaining cohort or zombie task proof', async (t) => {
    const f = await fixture(t);
    const neighbor = row(childPid + 1, { startTime: '9007199254740996' });
    await f.writeProcess(neighbor);
    let active = false;
    let scans = 0;
    const observer = f.observer({
        readdir: async (path, options) => {
            const entries = await readdir(path, options);
            if (active && path === f.procRoot && ++scans === 1)
                await rm(join(f.procRoot, String(childPid)), {
                    recursive: true,
                });
            return entries;
        },
    });
    await capture(observer);
    await f.zombies();
    await f.writeProcess({ ...neighbor, state: 'Z', ppid: 1 });
    active = true;
    const result = await observer.inspect();
    assert.equal(result.state, 'exited', JSON.stringify(result));
    assert.deepEqual(
        result.members.map((member) => member.pid),
        [neighbor.pid]
    );
    assert.equal(scans, 3);
    assert.deepEqual(f.signals, []);
});

test('persistent enumeration disappearance remains unresolved after bounded fresh attempts', async (t) => {
    const f = await fixture(t);
    let active = false;
    let scans = 0;
    const observer = f.observer({
        readdir: async (path, options) => {
            const entries = await readdir(path, options);
            if (active && path === f.procRoot) {
                scans++;
                return [...entries, String(childPid + 50)];
            }
            return entries;
        },
    });
    await capture(observer);
    await f.zombies();
    active = true;
    const result = await observer.inspect();
    assert.equal(result.state, 'unresolved');
    assert.match(result.reason, /ENOENT/);
    assert.equal(
        scans,
        3,
        'Retry budget is finite and does not bypass the proof.'
    );
    assert.deepEqual(f.signals, []);
});

test('fresh scan restart preserves accepted cohort identity and visibility checks', async (t) => {
    for (const defect of ['reused-member', 'namespace-change']) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            const foreignPid = childPid + 50;
            await f.writeProcess(
                row(foreignPid, { pgid: 9000, sid: 9000, startTime: '51' })
            );
            let active = false;
            let scans = 0;
            const observer = f.observer({
                readdir: async (path, options) => {
                    const entries = await readdir(path, options);
                    if (active && path === f.procRoot && ++scans === 1) {
                        await rm(join(f.procRoot, String(foreignPid)), {
                            recursive: true,
                        });
                        if (defect === 'reused-member')
                            await f.zombies({
                                startTime: '9007199254740995',
                            });
                        else
                            await writeFile(
                                join(f.procRoot, 'self/status'),
                                'NSpid:\t9999\n'
                            );
                    }
                    return entries;
                },
            });
            await capture(observer);
            await f.zombies();
            active = true;
            const result = await observer.inspect();
            assert.equal(result.state, 'unresolved');
            assert.deepEqual(f.signals, []);
        });
    }
});

test('non-enumeration errors do not receive a snapshot retry or become drain proof', async (t) => {
    for (const defect of [
        'EACCES',
        'malformed',
        'namespace-ENOENT',
        'task-ENOENT',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            let active = false;
            let refused = 0;
            const memberPath = join(f.procRoot, String(childPid), 'stat');
            const faultPath =
                defect === 'namespace-ENOENT'
                    ? join(f.procRoot, 'self/status')
                    : defect === 'task-ENOENT'
                      ? join(
                            f.procRoot,
                            String(childPid),
                            'task',
                            String(childPid),
                            'stat'
                        )
                      : memberPath;
            const observer = f.observer({
                readFile: async (path, options) => {
                    if (active && path === faultPath && refused++ === 0) {
                        if (defect === 'malformed') return 'not a process stat';
                        throw Object.assign(
                            new Error('Unproven process data'),
                            { code: defect === 'EACCES' ? 'EACCES' : 'ENOENT' }
                        );
                    }
                    return readFile(path, options);
                },
            });
            await capture(observer);
            await f.zombies();
            active = true;
            assert.equal((await observer.inspect()).state, 'unresolved');
            assert.equal(
                refused,
                1,
                'Do not turn a different error into a successful rescan.'
            );
            assert.deepEqual(f.signals, []);
        });
    }
});

test('macOS keeps ordinary live POSIX group signals and never consults Linux procfs', async () => {
    const signals = [];
    const unexpected = async () => {
        throw new Error('Unexpected procfs access.');
    };
    const observer = createProcessGroupObserver({
        pid: leaderPid,
        platform: 'darwin',
        procRoot: '/synthetic-unreadable-proc',
        selfPid,
        kill(target, name) {
            assert.equal(target, -leaderPid);
            if (name !== 0) signals.push(name);
        },
        readFile: unexpected,
        readdir: unexpected,
        readlink: unexpected,
    });
    await capture(observer);
    assert.equal((await observer.inspect()).state, 'live');
    await observer.signal('SIGTERM');
    assert.deepEqual(signals, ['SIGTERM']);
});

test('known live and mixed live/zombie owned groups remain live and signals keep exact group ownership', async (t) => {
    const f = await fixture(t);
    const observer = f.observer();
    await capture(observer);
    await f.writeProcess(row(childPid, { state: 'Z' }));
    const live = await observer.inspect();
    assert.equal(live.state, 'live');
    await observer.signal('SIGTERM');
    assert.deepEqual(f.signals, [{ target: -leaderPid, name: 'SIGTERM' }]);
    await f.zombies();
    assert.equal((await observer.inspect()).state, 'exited');
});

test('unknown terminal state, thread count or task proof never authorizes cleanup', async (t) => {
    for (const defect of [
        'X',
        'unknown-state',
        'thread-count',
        'extra-task',
        'task-state',
        'task-start',
        'missing-task',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            const observer = f.observer();
            await capture(observer);
            const base = row(childPid, { state: 'Z', ppid: 1 });
            if (defect === 'X') base.state = 'X';
            if (defect === 'unknown-state') base.state = '?';
            if (defect === 'thread-count') base.numThreads = 2;
            let tasks = [base];
            if (defect === 'extra-task')
                tasks = [base, { ...base, pid: childPid + 1 }];
            if (defect === 'task-state') tasks = [{ ...base, state: 'S' }];
            if (defect === 'task-start')
                tasks = [{ ...base, startTime: '9007199254740995' }];
            if (defect === 'missing-task') tasks = [];
            await f.zombies(base, tasks);
            assertRetained(await observer.inspect());
        });
    }
});

test('unreadable, malformed, vanishing and empty positive scans remain unresolved', async (t) => {
    for (const defect of [
        'directory-error',
        'stat-error',
        'vanished-stat',
        'malformed-stat',
        'pid-mismatch',
        'invalid-start',
        'hex-pgid',
        'empty-owned',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            let active = false;
            const observer = f.observer({
                readdir: async (path, options) => {
                    if (
                        active &&
                        defect === 'directory-error' &&
                        path === f.procRoot
                    )
                        throw Object.assign(
                            new Error('Incomplete enumeration'),
                            { code: 'EACCES' }
                        );
                    return readdir(path, options);
                },
                readFile: async (path, options) => {
                    if (
                        active &&
                        path === join(f.procRoot, String(childPid), 'stat')
                    ) {
                        if (
                            defect === 'stat-error' ||
                            defect === 'vanished-stat'
                        )
                            throw Object.assign(new Error('Uncertain member'), {
                                code:
                                    defect === 'stat-error'
                                        ? 'EACCES'
                                        : 'ENOENT',
                            });
                        if (defect === 'malformed-stat') return 'partial stat';
                        if (defect === 'pid-mismatch')
                            return stat(row(childPid + 1, { state: 'Z' }));
                        if (defect === 'invalid-start')
                            return stat(
                                row(childPid, {
                                    state: 'Z',
                                    startTime: 'not-an-integer',
                                })
                            );
                        if (defect === 'hex-pgid')
                            return stat(
                                row(childPid, {
                                    state: 'Z',
                                    ppid: 1,
                                    pgid: '0x1068',
                                })
                            );
                    }
                    return readFile(path, options);
                },
            });
            await capture(observer);
            await f.zombies();
            if (defect === 'empty-owned')
                await rm(join(f.procRoot, String(childPid)), {
                    recursive: true,
                });
            active = true;
            assert.equal((await observer.inspect()).state, 'unresolved');
            await observer.signal('SIGKILL');
            assert.deepEqual(f.signals, []);
        });
    }
});

test('membership churn and lossless start-time changes between complete scans cannot become exited', async (t) => {
    for (const change of ['new-member', 'removed-member', 'reused-pid']) {
        await t.test(change, async (t) => {
            const f = await fixture(t);
            let active = false;
            let scans = 0;
            const observer = f.observer({
                readdir: async (path, options) => {
                    if (active && path === f.procRoot && ++scans === 2) {
                        if (change === 'new-member')
                            await f.writeProcess(
                                row(childPid + 1, { state: 'Z', ppid: 1 })
                            );
                        if (change === 'removed-member')
                            await rm(join(f.procRoot, String(childPid)), {
                                recursive: true,
                            });
                        if (change === 'reused-pid')
                            await f.zombies({ startTime: '9007199254740995' });
                    }
                    return readdir(path, options);
                },
            });
            await capture(observer);
            await f.zombies();
            active = true;
            assert.equal((await observer.inspect()).state, 'unresolved');
            assert.ok(scans >= 2);
            await observer.signal('SIGTERM');
            assert.deepEqual(f.signals, []);
        });
    }
});

test('foreign group, session and leader reuse do not receive a signal', async (t) => {
    for (const defect of [
        'foreign-pgid',
        'foreign-sid',
        'leader-reuse',
        'child-reuse',
        'child-reuse-live-leader',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            const observer = f.observer();
            await capture(observer);
            await f.zombies({
                ...(defect === 'foreign-pgid' ? { pgid: leaderPid + 20 } : {}),
                ...(defect === 'foreign-sid' ? { sid: leaderPid + 20 } : {}),
                ...(defect.startsWith('child-reuse')
                    ? { startTime: '9007199254740995' }
                    : {}),
            });
            if (defect === 'leader-reuse')
                await f.writeProcess(
                    row(leaderPid, { startTime: '9007199254740995' })
                );
            if (defect === 'child-reuse-live-leader')
                await f.writeProcess(row(leaderPid));
            assert.equal((await observer.inspect()).state, 'unresolved');
            await observer.signal('SIGTERM');
            await observer.signal('SIGKILL');
            assert.deepEqual(f.signals, []);
        });
    }
});

test('unreadable PID 1 namespace metadata does not block proof from the observer own namespace and exact NSpid', async (t) => {
    const f = await fixture(t);
    let initNamespaceReads = 0;
    const observer = f.observer({
        readlink: async (path, options) => {
            if (path === join(f.procRoot, '1', 'ns', 'pid')) {
                initNamespaceReads++;
                throw Object.assign(
                    new Error('PID 1 namespace is ptrace-gated'),
                    {
                        code: 'EACCES',
                    }
                );
            }
            return readlink(path, options);
        },
    });
    await capture(observer);
    await f.zombies();
    assert.equal((await observer.inspect()).state, 'exited');
    assert.equal(initNamespaceReads, 0);
    assert.deepEqual(f.signals, []);
});

test('namespace and self identity uncertainty prevents proof even for exact zombie records', async (t) => {
    for (const defect of [
        'self-link',
        'self-stat',
        'numeric-self-stat',
        'self-ns',
        'numeric-self-ns',
        'missing-nspid',
        'malformed-nspid',
        'duplicate-nspid',
        'multiple-nspid',
        'parent-mounted-nspid',
        'mismatched-nspid',
        'unreadable-nspid',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            let active = false;
            const observer = f.observer({
                readFile: async (path, options) => {
                    if (active && path === join(f.procRoot, 'self', 'status')) {
                        const statuses = {
                            'missing-nspid': 'Name:\tsynthetic observer\n',
                            'malformed-nspid': `NSpid:\t${selfPid} invalid\n`,
                            'duplicate-nspid': `NSpid:\t${selfPid}\nNSpid:\t${selfPid}\n`,
                            'multiple-nspid': `NSpid:\t${selfPid}\t${selfPid}\n`,
                            'parent-mounted-nspid': `NSpid:\t${selfPid}\t7\n`,
                            'mismatched-nspid': `NSpid:\t${selfPid + 1}\n`,
                        };
                        if (defect === 'unreadable-nspid')
                            throw Object.assign(
                                new Error('Unknown observer status'),
                                {
                                    code: 'EACCES',
                                }
                            );
                        if (Object.hasOwn(statuses, defect))
                            return statuses[defect];
                    }
                    if (
                        active &&
                        ((defect === 'self-stat' &&
                            path === join(f.procRoot, 'self', 'stat')) ||
                            (defect === 'numeric-self-stat' &&
                                path ===
                                    join(f.procRoot, String(selfPid), 'stat')))
                    )
                        return stat(
                            row(selfPid + 1, {
                                pgid: selfPid,
                                sid: selfPid,
                                startTime: '100',
                            })
                        );
                    return readFile(path, options);
                },
                readlink: async (path, options) => {
                    if (active) {
                        if (
                            defect === 'self-link' &&
                            path === join(f.procRoot, 'self')
                        )
                            return String(selfPid + 1);
                        const locations = {
                            'self-ns': join(f.procRoot, 'self', 'ns', 'pid'),
                            'numeric-self-ns': join(
                                f.procRoot,
                                String(selfPid),
                                'ns',
                                'pid'
                            ),
                        };
                        if (path === locations[defect])
                            return 'pid:[4026532999]';
                    }
                    return readlink(path, options);
                },
            });
            await capture(observer);
            await f.zombies();
            active = true;
            assert.equal((await observer.inspect()).state, 'unresolved');
            await observer.signal('SIGTERM');
            assert.deepEqual(f.signals, []);
        });
    }
});

test('filtered, ambiguous and non-proc mounts cannot establish complete membership', async (t) => {
    for (const defect of [
        'hidepid',
        'subset',
        'pidns',
        'wrong-filesystem',
        'ambiguous',
        'overlay',
        'bind-subtree',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            const observer = f.observer();
            await capture(observer);
            await f.zombies();
            const mountPoint = f.procRoot.replaceAll(' ', '\\040');
            const options =
                {
                    hidepid: 'rw,hidepid=2',
                    subset: 'rw,subset=pid',
                    pidns: 'rw,pidns=999',
                }[defect] ?? 'rw';
            const line = `1 0 0:1 ${defect === 'bind-subtree' ? '/subtree' : '/'} ${mountPoint} rw - ${defect === 'wrong-filesystem' ? 'tmpfs' : 'proc'} proc ${options}\n`;
            const extra =
                defect === 'ambiguous'
                    ? `2 0 0:2 / ${mountPoint} rw - proc proc rw\n`
                    : defect === 'overlay'
                      ? `2 1 0:2 / ${mountPoint}/${childPid} rw - tmpfs tmpfs rw\n`
                      : '';
            await writeFile(
                join(f.procRoot, 'self', 'mountinfo'),
                line + extra
            );
            assert.equal((await observer.inspect()).state, 'unresolved');
            await observer.signal('SIGKILL');
            assert.deepEqual(f.signals, []);
        });
    }
});

test('missing live ownership capture and disposed authority cannot signal an observable group', async (t) => {
    const f = await fixture(t);
    await f.zombies();
    const unowned = f.observer();
    assert.equal((await unowned.capture()).state, 'unresolved');
    await unowned.signal('SIGTERM');
    assert.deepEqual(f.signals, []);
    await f.writeProcess(row(leaderPid));
    await f.writeProcess(row(childPid));
    const disposed = f.observer();
    await capture(disposed);
    disposed.dispose();
    await disposed.signal('SIGKILL');
    assert.deepEqual(f.signals, []);
});

test('ownership is rechecked before every signal after a previously live observation', async (t) => {
    const f = await fixture(t);
    const observer = f.observer();
    await capture(observer);
    assert.equal((await observer.inspect()).state, 'live');
    await f.writeProcess(row(leaderPid, { startTime: '9007199254740995' }));
    await observer.signal('SIGTERM');
    await observer.signal('SIGKILL');
    assert.deepEqual(f.signals, []);
});

test('positive member PID proof requires the original current zombie identity and preserves ESRCH', async (t) => {
    const f = await fixture(t);
    let memberGone = false;
    let memberProbes = 0;
    const observer = f.observer({
        kill(target, name) {
            if (target === childPid) {
                assert.equal(name, 0);
                memberProbes++;
                if (memberGone)
                    throw Object.assign(new Error('Absent member'), {
                        code: 'ESRCH',
                    });
                return;
            }
            assert.equal(target, -leaderPid);
            if (name !== 0) f.signals.push({ target, name });
        },
    });
    await capture(observer);
    await f.zombies();
    const result = await observer.inspectMember(childPid);
    assert.equal(result.state, 'exited', JSON.stringify(result));
    assert.deepEqual(
        result.members.map((member) => member.pid),
        [childPid]
    );
    assert.equal(result.members[0].startTime, childStart);
    assert.equal(result.members[0].pgid, leaderPid);
    assert.equal(result.members[0].sid, leaderPid);
    memberGone = true;
    assert.equal((await observer.inspectMember(childPid)).state, 'gone');
    assert.equal(memberProbes, 2);
    assert.deepEqual(f.signals, []);
});

test('cached group proof cannot certify a reused, changed, live-task or unreadable positive PID', async (t) => {
    for (const defect of [
        'reused-outside-group',
        'changed-start',
        'live-task',
        'unreadable-stat',
        'second-member-stat-reuse',
    ]) {
        await t.test(defect, async (t) => {
            const f = await fixture(t);
            const neighbor = row(childPid + 1, {
                startTime: '9007199254740996',
            });
            await f.writeProcess(neighbor);
            let active = false;
            let memberStatReads = 0;
            const observer = f.observer({
                kill(target, name) {
                    if (target === childPid) {
                        assert.equal(name, 0);
                        return;
                    }
                    assert.equal(target, -leaderPid);
                    if (name !== 0) f.signals.push({ target, name });
                },
                readFile: async (path, options) => {
                    if (
                        active &&
                        path === join(f.procRoot, String(childPid), 'stat')
                    ) {
                        memberStatReads++;
                        if (defect === 'unreadable-stat')
                            throw Object.assign(
                                new Error('Unknown member stat'),
                                {
                                    code: 'EACCES',
                                }
                            );
                        if (
                            defect === 'second-member-stat-reuse' &&
                            memberStatReads === 4
                        )
                            return stat(
                                row(childPid, {
                                    pgid: 9000,
                                    sid: 9000,
                                    startTime: '9007199254740995',
                                })
                            );
                    }
                    return readFile(path, options);
                },
            });
            await capture(observer);
            await f.zombies();
            await f.writeProcess({ ...neighbor, state: 'Z', ppid: 1 });
            const oldGroup = await observer.inspect();
            assert.equal(oldGroup.state, 'exited');
            if (defect === 'reused-outside-group')
                await f.writeProcess(
                    row(childPid, {
                        pgid: 9000,
                        sid: 9000,
                        startTime: '9007199254740995',
                    })
                );
            if (defect === 'changed-start')
                await f.zombies({ startTime: '9007199254740995' });
            if (defect === 'live-task') {
                const zombie = row(childPid, { state: 'Z', ppid: 1 });
                await f.writeProcess(zombie, [{ ...zombie, state: 'S' }]);
            }
            active = true;
            const result = await observer.inspectMember(childPid);
            assert.equal(result.state, 'unresolved', JSON.stringify(result));
            if (defect === 'reused-outside-group')
                assert.equal(
                    (await observer.inspect()).state,
                    'exited',
                    'The remaining original neighbor still proves group drain.'
                );
            if (defect === 'second-member-stat-reuse')
                assert.equal(memberStatReads, 4);
            assert.deepEqual(f.signals, []);
        });
    }
});
