// A single exit gate shared by OOM, scan, dead-man, and signal shutdown.
// The hard deadline is armed BEFORE any disk, browser or network work.
export function createRecovery({ deadlineMs = 30_000, persist, report, close,
  onStart = () => {}, exit = (code) => process.exit(code),
  schedule = setTimeout, cancel = clearTimeout, log = console.error }) {
  let active = false;
  let completion;
  return {
    get active() { return active; },
    request(reason, metadata = {}, code = 1) {
      if (active) return completion;
      active = true;
      const timer = schedule(() => {
        log("Worker recovery deadline reached; forcing controlled exit", reason);
        exit(code);
      }, deadlineMs);
      completion = (async () => {
        try {
          onStart(reason, metadata);
          try { await persist(reason, metadata); }
          catch (error) { log("Recovery persistence failed:", error.message); }
          await Promise.allSettled([Promise.resolve().then(() => report(reason, metadata)),
            Promise.resolve().then(close)]);
        } finally {
          cancel(timer);
          exit(code);
        }
      })();
      return completion;
    }
  };
}
