import { writeSync } from 'node:fs';
import { hrtime } from 'node:process';

const writeLine = (line) => writeSync(1, line);

export async function measureNativePhase(
    { react, format, phase },
    operation,
    emit = writeLine
) {
    const start = hrtime.bigint();
    const mark = (event, at, outcome) => {
        try {
            emit(
                JSON.stringify({
                    type: 'native-browser-phase',
                    react,
                    format,
                    phase,
                    event,
                    atNs: String(at),
                    ...(outcome === undefined
                        ? {}
                        : { outcome, elapsedNs: String(at - start) }),
                }) + '\n'
            );
        } catch {
            // A failed diagnostic write must leave the proof outcome intact.
        }
    };

    mark('start', start);
    let outcome = 'threw';
    try {
        const value = await operation();
        outcome = 'returned';
        return value;
    } finally {
        mark('end', hrtime.bigint(), outcome);
    }
}
