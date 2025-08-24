// /utils/Emitter.js -
//   This object provides the bus on which events are posted and handled. It allows handlers
//   to be defined with the on event, and then triggered by the emit event. Emitter.js allows
//   separation of the UI vs. the application logic. It also provides some basic logging
//   functionality, which is useful in testing.

export class Emitter {
  constructor() {
    this.m = new Map(); // eventName → [listeners]
    this.dontLogSet = new Set(['setVal', 'startLog', 'endLog', 'filter.results', 'startPaint', 'drawBrush', 'endPaint', 'setEnabled', 'setLimits']); // events we don't want to log
  }

  on(event, fn) {
    (this.m.get(event) ?? this.m.set(event, []).get(event)).push(fn);
  }

  off(event, fn) {
    const arr = this.m.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }

  emit(event, ...args) {
    // console.debug(`Emitter: ${event}, args:`, args, 'listeners: ', this.m.get(event));
    for (const fn of (this.m.get(event) ?? [])) {
      fn(...args);
      if (this._logEnabled && !this.dontLogSet.has(event)) {
        this._log.push({ event, args, timestamp: performance.now() });
      }
    }
  }

  async emitAsync(event, ...args) {
    const listeners = this.m.get(event) ?? [];
    for (const fn of listeners) {
      await fn(...args);  // wait for each listener to finish before moving on
    }
  }


/*
// (temporary instrumentation)
async emitAsync(event, ...args) {

  function isThenable(x) { return x && (typeof x.then === 'function'); }
  const listeners = this.m.get(event) ?? [];
  console.log(`[bus.emitAsync] ${event}: ${listeners.length} listener(s)`);
  let i = 0;
  for (const fn of listeners) {
    i++;
    const t0 = performance.now();
    console.log(`[bus.emitAsync] -> L${i} START ${event}`);
    const ret = fn(...args);
    if (!isThenable(ret)) {
      console.warn(`[bus.emitAsync] WARN: L${i} for "${event}" did not return a promise`);
    }
    await Promise.resolve(ret); // normalize sync/async
    const dt = (performance.now() - t0).toFixed(2);
    console.log(`[bus.emitAsync] <- L${i} END   ${event} (${dt} ms)`);
  }
  console.log(`[bus.emitAsync] DONE ${event}`);
}
*/


  clear() {
    this.m.clear();
  }

  once(event, fn) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      return fn(...args); // let async return vals bubble up
    };
    this.on(event, wrapper);
    return () => this.off(event, wrapper); // <-- return unsubscribe
  }

  startLog() {
    this._logEnabled = true;
    this._log = [];
  }

  endLog() {
    this._logEnabled = false;
    return this._log;
  }

  logging() {
    return this._logEnabled;
  }

  logOnly(event, ...args) {
      this._log.push({ event, args, timestamp: performance.now() });
  }

  saveAfter(set) {
    this._saveAfter = set;
  }
}