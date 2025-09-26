// Merge k sorted arrays of objects with a 'time' field (ISO 8601 string).
// Returns a single sorted array.

// Merge k presorted arrays.
// opts.key:  string prop name OR function(item)->key (default: identity)
// opts.cmp:  optional comparator (a,b) -> negative if a<b
export function mergeK(arrs, opts = {}) {
  const k = arrs.length;
  if (k === 0) return [];
  if (k === 1) return arrs[0];
  
  const { key, cmp } = opts;
  const idx  = new Array(k).fill(0);       // per-array pointer
  const keys = new Array(k);                // cached head keys
  const out  = [];

  // Fast getter for current head's key
  let getKey;
  if (typeof key === 'string') {
    getKey = (a, p) => a[p][key];
  } else if (typeof key === 'function') {
    getKey = (a, p) => key(a[p]);
  } else {
    getKey = (a, p) => a[p];               // items are primitives
  }

  const compare = cmp || ((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // seed key cache
  for (let s = 0; s < k; s++) {
    if (arrs[s].length) keys[s] = getKey(arrs[s], 0);
    else keys[s] = undefined;              // marks exhausted
  }

  for (;;) {
    // find min among current heads
    let minSrc = -1, minKey;
    for (let s = 0; s < k; s++) {
      const p = idx[s];
      if (p >= arrs[s].length) continue;
      const ks = keys[s];
      if (minSrc < 0 || compare(ks, minKey) < 0) { minSrc = s; minKey = ks; }
    }
    if (minSrc < 0) break;                 // all arrays done

    // emit one from min source and refresh its cached key
    out.push(arrs[minSrc][idx[minSrc]++]);
    if (idx[minSrc] < arrs[minSrc].length) {
      keys[minSrc] = getKey(arrs[minSrc], idx[minSrc]);
    } else {
      keys[minSrc] = undefined;            // exhausted
    }
  }
  return out;
}
