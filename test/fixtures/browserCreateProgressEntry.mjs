// Component-test entry only. Keep the starter and its public SDK journal real;
// permit an observer to cancel once after begin but before transport admission.
import { RecoveryJournal } from '@miniextensions/sdk/forms';

const begin = RecoveryJournal.prototype.begin;
RecoveryJournal.prototype.begin = function (...args) {
    const attempt = begin.apply(this, args);
    globalThis.__sdkCreateProgressProofHooks?.afterBegin(attempt);
    return attempt;
};

const notDispatched = RecoveryJournal.prototype.notDispatched;
RecoveryJournal.prototype.notDispatched = function (attempt) {
    const settled = notDispatched.call(this, attempt);
    globalThis.__sdkCreateProgressProofHooks?.afterNotDispatched(
        attempt,
        settled
    );
    return settled;
};

await import('../../examples/browser/src/main.ts');
