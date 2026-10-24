import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Private, opt-in test-worker diagnostics. Never serialize fixture objects,
// case names, paths, errors, input values, or arbitrary caller properties.
export const attachmentPhaseCapacity = 64;
export const attachmentPhaseMaxBytes = 16384;
const phases = new Set([
    'upload-release',
    'settlement',
    'global-restoration',
    'happydom-close',
]);
const events = new Set(['start', 'complete']);

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
    let active = null;
    let sequence = 0;
    let evicted = 0;
    let rejected = 0;
    let writeFailures = 0;
    let disabled = !outputDirectory && !persist;
    const snapshot = () =>
        structuredClone({
            schemaVersion: 1,
            suite: 'attachment',
            pid,
            capacity: attachmentPhaseCapacity,
            sequence,
            evicted,
            rejected,
            writeFailures,
            active,
            records,
        });
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
            !phases.has(phase) ||
            !events.has(event)
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
        active = event === 'start' ? record : null;
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
