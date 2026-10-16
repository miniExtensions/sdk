import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
    appendFileSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const jsonLine = (path, value) =>
    appendFileSync(path, JSON.stringify(value) + '\n');

function processes() {
    const rows = [];
    const errors = [];
    for (const name of readdirSync('/proc')) {
        if (!/^[1-9]\d*$/.test(name)) continue;
        try {
            const stat = readFileSync('/proc/' + name + '/stat', 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const status = readFileSync('/proc/' + name + '/status', 'utf8');
            rows.push({
                pid: Number(name),
                ppid: Number(fields[1]),
                group: Number(fields[2]),
                session: Number(fields[3]),
                startTicks: Number(fields[19]),
                userTicks: Number(fields[11]),
                systemTicks: Number(fields[12]),
                rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0),
            });
        } catch (error) {
            if (!['ENOENT', 'ESRCH'].includes(error.code)) {
                errors.push({ pid: Number(name), code: error.code ?? 'READ' });
            }
        }
    }
    return { rows, errors };
}

function hostMemory() {
    const memory = readFileSync('/proc/meminfo', 'utf8');
    const vm = readFileSync('/proc/vmstat', 'utf8');
    const number = (source, key) =>
        Number(source.match(new RegExp('^' + key + ':?\\s+(\\d+)', 'm'))?.[1] ?? 0);
    return {
        memAvailableKiB: number(memory, 'MemAvailable'),
        swapTotalKiB: number(memory, 'SwapTotal'),
        swapFreeKiB: number(memory, 'SwapFree'),
        swapInPages: number(vm, 'pswpin'),
        swapOutPages: number(vm, 'pswpout'),
        hostOomKills: number(vm, 'oom_kill'),
    };
}

/**
 * Time the real command, capture raw output, sample numeric /proc fields only,
 * and refuse success if a known descendant/group survives command close.
 * No cmdline, environment, or executable-name enumeration is performed.
 */
export async function runMeasured({
    name,
    command,
    args,
    cwd,
    env,
    output,
    timeoutMs,
    signal,
}) {
    assert.equal(process.platform, 'linux');
    const base = join(output, name);
    for (const suffix of ['stdout.log', 'stderr.log', 'combined.log', 'rss.ndjson']) {
        writeFileSync(base + '.' + suffix, '', { flag: 'wx' });
    }
    const began = performance.now();
    const startedAt = new Date().toISOString();
    const known = new Map();
    let rootPid;
    let rootStartTicks = null;
    let closed = false;
    let exitCode = null;
    let exitSignal = null;
    let spawnError = null;
    let reason = null;
    let closeMs = null;
    let scans = 0;
    let samplerMs = 0;
    let peakSampledRssKiB = 0;
    let maxOwnedProcesses = 0;
    let readErrors = 0;
    let ownedReadUncertain = false;
    let reparentedObservations = 0;
    let observerError = null;
    let captureError = null;
    let lastOwned = new Map();
    const initialHostMemory = hostMemory();
    let finalHostMemory = initialHostMemory;
    const child = spawn(command, args, {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    rootPid = child.pid;
    // Retain the spawned root identity even if a later observer/log operation
    // fails before its first complete snapshot.
    if (rootPid) {
        try {
            const stat = readFileSync('/proc/' + rootPid + '/stat', 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            rootStartTicks = Number(fields[19]);
            const row = {
                pid: rootPid,
                ppid: Number(fields[1]),
                group: Number(fields[2]),
                session: Number(fields[3]),
                startTicks: rootStartTicks,
                userTicks: Number(fields[11]),
                systemTicks: Number(fields[12]),
                rssKiB: 0,
            };
            known.set(rootPid, row);
            lastOwned.set(rootPid, row);
        } catch (error) {
            observerError = { code: error.code ?? null, message: error.message };
            ownedReadUncertain = true;
            reason = 'spawned-root-read-uncertain';
        }
    }
    child.once('error', (error) => {
        spawnError = { code: error.code ?? null, message: error.message };
    });
    child.once('close', (code, childSignal) => {
        closed = true;
        exitCode = code;
        exitSignal = childSignal;
        closeMs = performance.now() - began;
    });
    function capture(stream, bytes) {
        if (captureError) return;
        try {
            appendFileSync(base + '.' + stream + '.log', bytes);
            appendFileSync(base + '.combined.log', bytes);
        } catch (error) {
            captureError = { code: error.code ?? null, message: error.message };
            reason ??= 'output-capture-failed';
        }
    }
    child.stdout.on('data', (bytes) => capture('stdout', bytes));
    child.stderr.on('data', (bytes) => capture('stderr', bytes));
    for (const stream of [child.stdout, child.stderr]) {
        stream.on('error', (error) => {
            captureError ??= { code: error.code ?? null, message: error.message };
            reason ??= 'output-stream-failed';
        });
    }

    function sample() {
        const sampleStart = performance.now();
        const snapshot = processes();
        readErrors += snapshot.errors.length;
        const owned = new Map();
        const rootRow = snapshot.rows.find((row) => row.pid === rootPid);
        const rootMatches = rootRow && rootRow.startTicks === rootStartTicks;
        const rootReused = rootRow && !rootMatches;
        if (rootReused) ownedReadUncertain = true;
        const originalGroupAnchor = snapshot.rows.some((row) =>
            known.get(row.pid)?.startTicks === row.startTicks &&
            (row.group === rootPid || row.session === rootPid)
        );
        const admitOriginalGroup = !rootReused &&
            (rootMatches || originalGroupAnchor);
        for (const row of snapshot.rows) {
            const old = known.get(row.pid);
            if (
                (row.pid === rootPid && rootMatches) ||
                (admitOriginalGroup &&
                    (row.group === rootPid || row.session === rootPid)) ||
                (old && old.startTicks === row.startTicks)
            ) {
                owned.set(row.pid, row);
            }
        }
        let changed;
        do {
            changed = false;
            for (const row of snapshot.rows) {
                if (!owned.has(row.pid) && owned.has(row.ppid)) {
                    owned.set(row.pid, row);
                    changed = true;
                }
            }
        } while (changed);
        for (const row of owned.values()) {
            known.set(row.pid, row);
            if (row.pid !== rootPid && !owned.has(row.ppid)) {
                reparentedObservations++;
            }
        }
        if (snapshot.errors.some(({ pid }) => known.has(pid))) {
            ownedReadUncertain = true;
        }
        lastOwned = owned;
        const rssKiB = [...owned.values()].reduce((sum, row) => sum + row.rssKiB, 0);
        peakSampledRssKiB = Math.max(peakSampledRssKiB, rssKiB);
        maxOwnedProcesses = Math.max(maxOwnedProcesses, owned.size);
        finalHostMemory = hostMemory();
        jsonLine(base + '.rss.ndjson', {
            elapsedMs: performance.now() - began,
            rssKiB,
            processes: [...owned.values()],
            ...finalHostMemory,
        });
        scans++;
        samplerMs += performance.now() - sampleStart;
        return owned;
    }

    function observe() {
        try {
            return sample();
        } catch (error) {
            observerError ??= { code: error.code ?? null, message: error.message };
            ownedReadUncertain = true;
            reason ??= 'observer-failed';
            return lastOwned;
        }
    }

    function terminate(owned, childSignal) {
        const groups = new Set();
        const verified = [];
        let ownGroup;
        try {
            const stat = readFileSync('/proc/self/stat', 'utf8');
            ownGroup = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
        } catch (error) {
            observerError ??= { code: error.code ?? null, message: error.message };
            ownedReadUncertain = true;
        }
        // Revalidate identities before signaling a group or individual PID.
        for (const row of owned.values()) {
            try {
                const stat = readFileSync('/proc/' + row.pid + '/stat', 'utf8');
                const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
                if (Number(fields[19]) === row.startTicks) {
                    verified.push(row);
                    if (!ownedReadUncertain &&
                        Number(fields[2]) === row.group && row.group !== ownGroup) {
                        groups.add(row.group);
                    }
                }
            } catch (error) {
                if (!['ENOENT', 'ESRCH'].includes(error.code)) {
                    observerError ??= { code: error.code ?? null, message: error.message };
                    ownedReadUncertain = true;
                }
            }
        }
        for (const group of groups) {
            if (ownedReadUncertain) break;
            if (!Number.isSafeInteger(group) || group <= 1) continue;
            try {
                process.kill(-group, childSignal);
            } catch (error) {
                if (error.code !== 'ESRCH') {
                    observerError ??= { code: error.code ?? null, message: error.message };
                    ownedReadUncertain = true;
                }
            }
        }
        for (const row of verified) {
            try {
                const stat = readFileSync('/proc/' + row.pid + '/stat', 'utf8');
                const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
                if (Number(fields[19]) === row.startTicks) {
                    process.kill(row.pid, childSignal);
                }
            } catch (error) {
                if (!['ENOENT', 'ESRCH'].includes(error.code)) {
                    observerError ??= { code: error.code ?? null, message: error.message };
                    ownedReadUncertain = true;
                }
            }
        }
    }

    let owned = observe();
    while (!closed) {
        if (signal?.aborted) reason = 'parent-interrupted';
        if (performance.now() - began > timeoutMs) reason = 'deadline';
        if (reason) break;
        await pause(200);
        owned = observe();
        if (ownedReadUncertain) reason ??= 'owned-process-read-uncertain';
    }
    owned = observe();
    if (!reason && (spawnError || exitCode !== 0 || exitSignal)) {
        reason = 'command-failed';
    }
    // Allow ordinary close/reaping to settle; a persistent survivor is fatal.
    const settleUntil = performance.now() + 1500;
    while (!reason && owned.size && performance.now() < settleUntil) {
        await pause(100);
        owned = observe();
    }
    if (!reason && owned.size) reason = 'descendant-survived-close';
    if (ownedReadUncertain) reason ??= 'owned-process-read-uncertain';
    if (reason) {
        for (const [childSignal, graceMs] of [['SIGTERM', 5000], ['SIGKILL', 5000]]) {
            terminate(owned, childSignal);
            const until = performance.now() + graceMs;
            do {
                await pause(100);
                owned = observe();
            } while ((!closed || owned.size) && performance.now() < until);
            if (closed && owned.size === 0) break;
        }
    }
    owned = observe();
    const drainConfirmed = closed && owned.size === 0 && !ownedReadUncertain;
    const result = {
        name,
        command,
        args,
        startedAt,
        endedAt: new Date().toISOString(),
        elapsedMs: performance.now() - began,
        commandCloseMs: closeMs,
        exitCode,
        exitSignal,
        spawnError,
        observerError,
        captureError,
        reason,
        drainConfirmed,
        alive: [...owned.values()],
        peakSampledRssKiB,
        maxOwnedProcesses,
        scans,
        samplerMs,
        readErrors,
        reparentedObservations,
        initialHostMemory,
        finalHostMemory,
        memoryLimits: [
            'Numeric /proc snapshots every approximately 200ms; short-lived or detached-before-first-sample descendants may be missed.',
            'Summed process RSS double-counts shared pages and misses between-sample peaks; this is not cgroup peak or billed memory.',
            'Host memory/swap/OOM counters are VM-wide and cannot be attributed exclusively to this command.',
        ],
    };
    try {
        writeFileSync(base + '.receipt.json', JSON.stringify(result, null, 2) + '\n', {
            flag: 'wx',
        });
    } catch (error) {
        result.reason ??= 'receipt-write-failed';
        result.receiptError = error.message;
        reason ??= 'receipt-write-failed';
    }
    console.log(name + ': ' + Math.round(result.elapsedMs) + ' ms; exit=' +
        exitCode + '; drain=' + drainConfirmed + '; peak sampled RSS KiB=' +
        peakSampledRssKiB);
    if (reason || !drainConfirmed) {
        const error = new Error(name + ' failed: ' + (reason ?? 'unconfirmed-drain'));
        error.commandResult = result;
        throw error;
    }
    return result;
}
