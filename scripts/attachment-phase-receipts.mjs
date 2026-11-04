import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Private, opt-in test-worker diagnostics. Never serialize fixture objects,
// case names, paths, errors, input values, or arbitrary caller properties.
export const attachmentPhaseCapacity = 64;
export const attachmentPhaseMaxBytes = 16384;
const phases = new Set([
    'fixture-window-setup',
    'unique-import',
    'initialization',
    'scenario-assertions',
    'upload-release',
    'settlement',
    'global-restoration',
    'happydom-close',
]);
const checkpoints = new Set([
    'connect-submit-start',
    'connect-submit-end',
    'synthetic-response-start',
    'synthetic-response-ready',
    'response-consumed',
    'root-accept-start',
    'root-render-start',
    'root-render-end',
    'readiness-poll-start',
    'readiness-observed',
]);
const events = new Set(['start', 'complete']);
// The labels and endpoints are fixed here, never supplied by a caller. These
// intervals overlap and include the cost of recording intermediate markers.
const checkpointIntervals = [
    ['connect-submit', 'connect-submit-start', 'connect-submit-end'],
    [
        'synthetic-response',
        'synthetic-response-start',
        'synthetic-response-ready',
    ],
    ['root-accept-to-render', 'root-accept-start', 'root-render-start'],
    ['root-render', 'root-render-start', 'root-render-end'],
    ['readiness-poll', 'readiness-poll-start', 'readiness-observed'],
];

export function safeAttachmentPhaseMarker(sink) {
    return (caseIndex, total, phase, event) => {
        try {
            sink?.(caseIndex, total, phase, event);
        } catch {
            // Diagnostics cannot replace a fixture result or cleanup exception.
        }
    };
}

export function createAttachmentPhaseReceipt({
    outputDirectory,
    pid = process.pid,
    now = () => performance.now(),
    persist,
    warn = () =>
        console.error('[attachment-phase] receipt storage unavailable'),
} = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 1)
        throw new TypeError('A numeric worker identity is required');
    const records = [];
    const pending = new Map();
    const aggregates = Object.create(null);
    let active = null;
    let sequence = 0;
    let evicted = 0;
    let rejected = 0;
    let writeFailures = 0;
    let disabled = !outputDirectory && !persist;
    const snapshot = () =>
        structuredClone({
            schemaVersion: 2,
            suite: 'attachment',
            pid,
            capacity: attachmentPhaseCapacity,
            sequence,
            evicted,
            rejected,
            writeFailures,
            active,
            records,
            aggregates,
        });
    const updateInterval = (label, start, record) => {
        if (start) {
            pending.set(label, record);
            return;
        }
        const previous = pending.get(label);
        pending.delete(label);
        if (
            !previous ||
            previous.caseIndex !== record.caseIndex ||
            previous.total !== record.total ||
            record.atMs < previous.atMs
        )
            return;
        const duration = record.atMs - previous.atMs;
        const stats = aggregates[label];
        if (!stats) {
            aggregates[label] = {
                count: 1,
                minMs: duration,
                maxMs: duration,
                meanMs: duration,
            };
        } else if (stats.count < Number.MAX_SAFE_INTEGER) {
            stats.count++;
            stats.minMs = Math.min(stats.minMs, duration);
            stats.maxMs = Math.max(stats.maxMs, duration);
            stats.meanMs += (duration - stats.meanMs) / stats.count;
        }
    };
    const failStorage = () => {
        disabled = true; // Do not retry a failed/denied output operation.
        writeFailures++;
        try {
            warn(); // Fixed, value-free warning, at most once per recorder.
        } catch {}
    };
    let write = persist;
    if (!disabled) {
        if (!write) {
            try {
                mkdirSync(outputDirectory, { recursive: true });
                const file = join(
                    outputDirectory,
                    `attachment-phase-${pid}.json`
                );
                write = (text) => {
                    // At most two bounded files, including an interrupted write.
                    writeFileSync(`${file}.pending`, text);
                    renameSync(`${file}.pending`, file);
                };
            } catch {
                failStorage();
            }
        }
    }
    const mark = safeAttachmentPhaseMarker((caseIndex, total, phase, event) => {
        if (disabled) return;
        if (
            !Number.isSafeInteger(caseIndex) ||
            !Number.isSafeInteger(total) ||
            caseIndex < 1 ||
            total < caseIndex ||
            total > 10000 ||
            !(
                (phases.has(phase) && events.has(event)) ||
                (checkpoints.has(phase) && event === 'point')
            )
        ) {
            rejected++;
            return;
        }
        const time = now();
        if (!Number.isFinite(time) || time < 0 || time > 1e12) {
            rejected++;
            return;
        }
        sequence = Math.min(Number.MAX_SAFE_INTEGER, sequence + 1);
        const record = {
            sequence,
            caseIndex,
            total,
            phase,
            event,
            atMs: Math.round(time * 1000) / 1000,
        };
        if (events.has(event)) updateInterval(phase, event === 'start', record);
        else
            for (const [label, start, end] of checkpointIntervals) {
                if (phase === start) updateInterval(label, true, record);
                if (phase === end) updateInterval(label, false, record);
            }
        if (event === 'start') active = record;
        else if (event === 'complete') active = null;
        if (records.length === attachmentPhaseCapacity) {
            records.shift();
            evicted++;
        }
        records.push(record);
        try {
            const text = JSON.stringify(snapshot()) + '\n';
            if (Buffer.byteLength(text) > attachmentPhaseMaxBytes)
                throw new Error('Receipt bound exceeded');
            write(text);
        } catch {
            failStorage();
        }
    });
    return { mark, snapshot };
}
