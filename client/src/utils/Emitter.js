// /utils/Emitter.js -
//   This object provides the bus on which events are posted and handled. It allows handlers
//   to be defined with the on event, and then triggered by the emit event. Emitter.js allows
//   separation of the UI vs. the application logic. It also provides some basic logging
//   functionality, which is useful in testing.

export class Emitter {
  constructor() {
    //console.debug('Emitter initialized');
    this.m = new Map(); // eventName → [listeners]
    this.dontLogSet = new Set(['setVal', 'startLog', 'endLog', 'filter.results']); // events we don't want to log
  }

  on(event, fn) {
    //console.debug(`New function: on ${event}`);
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

  clear() {
    this.m.clear();
  }

  startLog() {
    this._logEnabled = true;
    this._log = [];
  }

  endLog() {
    this._logEnabled = false;
    return this._log;
  }
}