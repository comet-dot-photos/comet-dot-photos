export function serialize(fn) {
  let tail = Promise.resolve();
  return function serialized(...args) {
    const run = () => Promise.resolve(fn.apply(this, args));
    const p = tail.then(run);
    tail = p.catch(() => {});  // keep chain alive even on error
    return p;
  };
}