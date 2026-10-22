import {
    readFile as readFileDefault,
    readdir as readdirDefault,
    readlink as readlinkDefault,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Private operational-drain proof. An observed zombie is not reported reaped.
// Only ordinary, unfiltered Linux procfs is supported; ambiguity fails closed.
const liveStates = new Set(['R', 'S', 'D', 'T', 't', 'I', 'W', 'P', 'K']);
const identity = ({ pid, pgid, sid, startTime }) =>
    `${pid}:${pgid}:${sid}:${startTime}`;
const identities = (members) => members.map(identity).sort().join(',');
const decodeMount = (value) =>
    value.replace(/\\([0-7]{3})/g, (_, digits) =>
        String.fromCharCode(Number.parseInt(digits, 8))
    );
class ProcSnapshotChangedError extends Error {
    constructor(cause) {
        super(cause.message, { cause });
    }
}
const parseStat = (text, expectedPid) => {
    const end = text.lastIndexOf(')');
    const begin = text.indexOf('(');
    const pidToken = text.slice(0, begin).trim();
    const pid = Number(pidToken);
    const fields = text
        .slice(end + 1)
        .trim()
        .split(/\s+/);
    const member = {
        pid,
        state: fields[0],
        ppid: Number(fields[1]),
        pgid: Number(fields[2]),
        sid: Number(fields[3]),
        numThreads: Number(fields[17]),
        startTime: fields[19],
    };
    if (
        begin < 1 ||
        end <= begin ||
        fields.length < 20 ||
        !/^[1-9]\d*$/.test(pidToken) ||
        !/^(0|[1-9]\d*)$/.test(fields[1] ?? '') ||
        ![fields[2], fields[3]].every((value) =>
            /^(0|[1-9]\d*)$/.test(value ?? '')
        ) ||
        !/^[1-9]\d*$/.test(fields[17] ?? '') ||
        pid !== expectedPid ||
        !Number.isSafeInteger(pid) ||
        pid < 1 ||
        !Number.isSafeInteger(member.ppid) ||
        member.ppid < 0 ||
        !Number.isSafeInteger(member.pgid) ||
        member.pgid < 0 ||
        !Number.isSafeInteger(member.sid) ||
        member.sid < 0 ||
        !Number.isSafeInteger(member.numThreads) ||
        member.numThreads < 1 ||
        typeof member.state !== 'string' ||
        member.state.length !== 1 ||
        !/^(0|[1-9]\d*)$/.test(member.startTime ?? '')
    )
        throw new Error('Malformed process stat');
    return member;
};

export function createProcessGroupObserver({
    pid,
    platform = process.platform,
    procRoot = '/proc',
    selfPid = process.pid,
    kill = (target, signal) => process.kill(target, signal),
    readFile = readFileDefault,
    readdir = readdirDefault,
    readlink = readlinkDefault,
}) {
    if (!Number.isSafeInteger(pid) || pid <= 1)
        throw new TypeError('An owned process-group leader is required.');
    procRoot = resolve(procRoot);
    let leaderStartTime = null;
    let cohort = new Set();
    const seenPids = new Map();
    let disposed = false;
    let last = null;
    const observation = (
        state,
        reason = null,
        members = [],
        mode = 'linux-proc'
    ) => {
        last = { state, reason, members, mode, pid };
        return structuredClone(last);
    };
    const exists = () => {
        try {
            kill(-pid, 0);
            return true;
        } catch (error) {
            if (error.code === 'ESRCH') return false;
            throw error;
        }
    };
    const stat = async (
        processId,
        path = join(procRoot, String(processId), 'stat')
    ) => parseStat(await readFile(path, 'utf8'), processId);
    const visibleNamespace = async () => {
        const self = await stat(selfPid, join(procRoot, 'self/stat'));
        const numeric = await stat(selfPid);
        if (identity(self) !== identity(numeric))
            throw new Error('Proc self identity mismatch');
        const [selfLink, selfNs, numericNs, status] = await Promise.all([
            readlink(join(procRoot, 'self')),
            readlink(join(procRoot, 'self/ns/pid')),
            readlink(join(procRoot, String(selfPid), 'ns/pid')),
            readFile(join(procRoot, 'self/status'), 'utf8'),
        ]);
        const namespaceRows = status
            .split('\n')
            .filter((line) => /^NSpid:/.test(line));
        const namespacePids =
            namespaceRows.length === 1
                ? namespaceRows[0].slice('NSpid:'.length).trim().split(/\s+/)
                : [];
        if (
            selfLink !== String(selfPid) ||
            !/^pid:\[\d+\]$/.test(selfNs) ||
            selfNs !== numericNs ||
            namespacePids.length !== 1 ||
            namespacePids[0] !== String(selfPid)
        )
            throw new Error('Proc PID namespace mismatch');
        const mounts = (
            await readFile(join(procRoot, 'self/mountinfo'), 'utf8')
        )
            .trim()
            .split('\n')
            .map((line) => {
                const halves = line.split(' - ');
                const left = halves[0]?.split(' ');
                const right = halves[1]?.split(' ');
                if (halves.length !== 2 || left.length < 6 || right.length < 3)
                    throw new Error('Malformed proc mount metadata');
                return {
                    root: decodeMount(left[3]),
                    point: decodeMount(left[4]),
                    type: right[0],
                    options: [...left[5].split(','), ...right[2].split(',')],
                };
            });
        const roots = mounts.filter((mount) => mount.point === procRoot);
        if (
            roots.length !== 1 ||
            roots[0].type !== 'proc' ||
            roots[0].root !== '/' ||
            roots[0].options.some(
                (option) =>
                    (option.startsWith('hidepid=') &&
                        !['hidepid=0', 'hidepid=off'].includes(option)) ||
                    option.startsWith('subset=') ||
                    option.startsWith('pidns=')
            ) ||
            mounts.some(
                (mount) =>
                    mount.point.startsWith(`${procRoot}/`) &&
                    /^(?:\d+|self|thread-self)(?:\/|$)/.test(
                        mount.point.slice(procRoot.length + 1)
                    )
            )
        )
            throw new Error('Proc visibility is filtered or overlaid');
    };
    const scan = async () => {
        await visibleNamespace();
        const names = await readdir(procRoot);
        const members = [];
        for (const name of names
            .filter((entry) => /^\d+$/.test(entry))
            .sort()) {
            if (String(Number(name)) !== name)
                throw new Error('Malformed numeric proc entry');
            // Never skip an unreadable entry: it may hide an owned member.
            // A vanished enumerated PID invalidates the entire snapshot pair.
            let current;
            try {
                current = await stat(Number(name));
            } catch (error) {
                if (error.code === 'ENOENT')
                    throw new ProcSnapshotChangedError(error);
                throw error;
            }
            if (current.sid === pid && current.pgid !== pid)
                throw new Error('Owned session contains another process group');
            if (current.pgid !== pid) continue;
            if (current.sid !== pid)
                throw new Error('Owned process-group session mismatch');
            members.push(current);
        }
        return members.sort((left, right) => left.pid - right.pid);
    };
    const stable = async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const first = await scan();
                const second = await scan();
                if (!first.length || identities(first) !== identities(second))
                    throw new Error(
                        'Empty or unstable process-group observation'
                    );
                return { first, second };
            } catch (error) {
                // Retry only this enumeration race, with fresh namespace and
                // two complete scans. No cached proof, skipped PID or inferred
                // absence authorizes a signal/drain; persistent churn refuses.
                if (
                    !(error instanceof ProcSnapshotChangedError) ||
                    attempt === 2
                )
                    throw error;
            }
        }
    };
    const exited = async (members) => {
        for (const member of members) {
            if (member.state !== 'Z' || member.numThreads !== 1) return false;
            const tasks = (
                await readdir(join(procRoot, String(member.pid), 'task'))
            ).filter((name) => /^\d+$/.test(name));
            if (tasks.length !== 1 || tasks[0] !== String(member.pid))
                throw new Error('Exited process has unproven task membership');
            const task = await stat(
                member.pid,
                join(
                    procRoot,
                    String(member.pid),
                    'task',
                    String(member.pid),
                    'stat'
                )
            );
            if (
                identity(task) !== identity(member) ||
                task.state !== 'Z' ||
                task.numThreads !== 1
            )
                throw new Error('Exited process task identity is unproven');
        }
        return true;
    };
    const capture = async () => {
        try {
            if (!exists()) return observation('gone', null, [], 'esrch');
            if (platform !== 'linux')
                return observation('live', null, [], 'posix');
            const { first, second } = await stable();
            for (const members of [first, second]) {
                const leader = members.find((member) => member.pid === pid);
                if (
                    !leader ||
                    !liveStates.has(leader.state) ||
                    (leaderStartTime !== null &&
                        leader.startTime !== leaderStartTime)
                )
                    throw new Error(
                        'Original live leader identity is unproven'
                    );
                for (const member of members)
                    if (
                        seenPids.has(member.pid) &&
                        seenPids.get(member.pid) !== member.startTime
                    )
                        throw new Error(
                            'Previously observed PID identity was reused'
                        );
            }
            const leader = second.find((member) => member.pid === pid);
            if (
                first.find((member) => member.pid === pid).startTime !==
                leader.startTime
            )
                throw new Error('Leader identity changed during capture');
            if (disposed)
                throw new Error('Observer signal authority is retired');
            leaderStartTime = leader.startTime;
            for (const member of second) {
                seenPids.set(member.pid, member.startTime);
                cohort.add(identity(member));
            }
            return observation('live', null, second);
        } catch (error) {
            return observation('unresolved', error.message);
        }
    };
    const inspect = async () => {
        try {
            if (!exists()) return observation('gone', null, [], 'esrch');
            if (platform !== 'linux')
                return observation('live', null, [], 'posix');
            if (leaderStartTime === null)
                throw new Error('No accepted live-leader cohort');
            const { first, second } = await stable();
            for (const members of [first, second]) {
                for (const member of members) {
                    if (!cohort.has(identity(member)))
                        throw new Error(
                            'New or reused process identity outside accepted cohort'
                        );
                    if (
                        member.pid === pid &&
                        member.startTime !== leaderStartTime
                    )
                        throw new Error('Leader PID was reused');
                    if (member.state !== 'Z' && !liveStates.has(member.state))
                        throw new Error('Unknown process execution state');
                }
            }
            const firstExited = await exited(first);
            const secondExited = await exited(second);
            if (!exists()) return observation('gone', null, [], 'esrch');
            return observation(
                firstExited && secondExited ? 'exited' : 'live',
                null,
                second
            );
        } catch (error) {
            return observation('unresolved', error.message);
        }
    };
    const inspectMember = async (processId) => {
        try {
            if (!Number.isSafeInteger(processId) || processId <= 1)
                throw new Error('A recorded member PID is required');
            try {
                kill(processId, 0);
            } catch (error) {
                if (error.code === 'ESRCH')
                    return observation('gone', null, [], 'esrch');
                throw error;
            }
            if (platform !== 'linux')
                throw new Error('Member PID remains present');
            const group = await inspect();
            if (group.state !== 'exited')
                throw new Error(
                    'No current exited-group proof for present member PID'
                );
            const first = await stat(processId);
            const second = await stat(processId);
            if (
                !cohort.has(identity(first)) ||
                identity(first) !== identity(second) ||
                first.pgid !== pid ||
                first.sid !== pid ||
                !(await exited([first])) ||
                !(await exited([second]))
            )
                throw new Error(
                    'Present member PID identity or exited-task proof changed'
                );
            return observation('exited', null, [second]);
        } catch (error) {
            return observation('unresolved', error.message);
        }
    };
    const signal = async (name) => {
        if (disposed)
            return observation(
                'unresolved',
                'Observer signal authority is retired'
            );
        let state = await inspect();
        if (state.state === 'unresolved' && leaderStartTime !== null) {
            // A still-live original leader can positively refresh its cohort.
            const refreshed = await capture();
            if (refreshed.state === 'live') state = await inspect();
        }
        if (disposed)
            return observation(
                'unresolved',
                'Observer signal authority is retired'
            );
        if (state.state !== 'live') return state;
        try {
            // No await between the final identity proof and the actual signal.
            kill(-pid, name);
            return state;
        } catch (error) {
            if (error.code === 'ESRCH')
                return observation('gone', null, [], 'esrch');
            return observation(
                'unresolved',
                `Cannot send ${name}: ${error.code ?? 'unknown'}`
            );
        }
    };
    return {
        capture,
        inspect,
        inspectMember,
        signal,
        dispose() {
            disposed = true;
        },
        getEvidence: () => (last === null ? null : structuredClone(last)),
    };
}
