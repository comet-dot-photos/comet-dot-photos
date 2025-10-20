// serialize.js - utility to serialize async function calls
export class CancelledError extends Error {
  constructor(message = "Call was cancelled before it started") {
    super(message);
    this.name = "CancelledError";
  }
}

/**
 * Serialize calls to `fn`.
 * - mode: 'queue' (default)  -> your current behavior
 * - mode: 'latest'           -> while one call is running, keep at most ONE pending call:
 *                               every new call replaces (cancels) the previous pending one
 */
export function serialize(fn, { mode = 'queue' } = {}) {
  if (mode === 'queue') {
    // Original behavior
    let tail = Promise.resolve();
    return function serialized(...args) {
      const run = () => Promise.resolve(fn.apply(this, args));
      const p = tail.then(run);
      // keep chain alive even on error
      tail = p.catch(() => {});
      return p;
    };
  }

  if (mode === 'latest') {
    let running = false;        // is fn currently executing?
    let tail = Promise.resolve(); // ensures "only after the current run"
    let pending = null;         // { args, resolve, reject, started }

    const kick = (self) => {
      if (!pending) return;
      const job = pending;
      job.started = true;
      pending = null;
      running = true;

      // Start AFTER the current tail finishes (keeps true serialization)
      tail = tail
        .then(() => Promise.resolve(fn.apply(self, job.args)))
        .then((val) => job.resolve(val), (err) => job.reject(err))
        .finally(() => {
          running = false;
          // If another call arrived while we were running, kick it now.
          if (pending && !pending.started) kick(self);
        })
        .catch(() => {}); // keep chain alive even if fn threw
    };

    return function serializedLatest(...args) {
      // cancel any unstarted pending job
      if (pending && !pending.started) {
        pending.reject(new CancelledError());
      }

      // create a fresh promise representing *this* caller’s request
      let resolve, reject;
      const p = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });

      pending = { args, resolve, reject, started: false };

      // If nothing is running, promote the pending job immediately.
      if (!running) kick(this);

      return p;
    };
  }

  throw new Error(`Unknown mode: ${mode}`);
}
