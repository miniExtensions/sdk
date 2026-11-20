// Provider-free example. The host owns the admitted page/session, challenge capabilities,
// the configured fallback action and the localized copy. No SDK client or network here.
export function createHostPhoneFallback({ email, sendPhone, phoneNotFoundCopy, isCurrent }) {
  let challenge = email;
  let error = null;
  let busy = false;
  let recovery = false;
  const usable = () => isCurrent() && !recovery;
  return {
    read() {
      if (!isCurrent()) return null;
      return { challenge: recovery ? null : challenge?.notice ?? null, error, busy, recovery };
    },
    async replaceWithPhone(phone) {
      if (!usable() || busy || !challenge || challenge.notice.kind !== 'email') return 'ignored';
      busy = true;
      error = null;
      try {
        const outcome = await sendPhone(phone);
        if (!isCurrent()) return 'ignored';
        if (outcome?.type === 'known-phone-not-found') {
          error = phoneNotFoundCopy();
          return 'retained';
        }
        if (outcome?.type === 'phone-challenge' && outcome.challenge?.notice?.kind === 'phoneNumber' &&
            typeof outcome.challenge.confirm === 'function') {
          challenge = outcome.challenge;
          return 'replaced';
        }
        recovery = true;
        return 'recovery';
      } catch {
        if (!isCurrent()) return 'ignored';
        recovery = true; // unknown delivery is not the known no-record result
        return 'recovery';
      } finally {
        busy = false;
      }
    },
    async confirm(displayedNotice, code) {
      if (!usable() || busy || !challenge || displayedNotice !== challenge.notice) return 'ignored';
      const owned = challenge;
      challenge = null;
      busy = true;
      try {
        await owned.confirm(code);
        return isCurrent() ? 'confirmed' : 'ignored';
      } catch {
        if (!isCurrent()) return 'ignored';
        recovery = true;
        return 'recovery';
      } finally {
        busy = false;
      }
    },
  };
}
