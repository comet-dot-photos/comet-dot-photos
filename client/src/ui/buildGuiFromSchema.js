// ui/buildGuiFromSchema.js
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { makeDualSlider } from './makeDualSlider.js';

/**
 * Build a lil-gui from a schema.
 * @param {GUI} gui - an existing lil-gui instance
 * @param {Array} schema - array of folder nodes (object-style schema)
 * @param {Object} opts
 * @param {Object} opts.state - the UI state object (read/write by lil-gui)
 * @param {Emitter} [opts.bus] - event bus; default onChange emits '<key>'
 * @param {Function} [opts.onChange] - custom change handler (key, value) => void
 * @param {Function} [opts.dualRangeFactory] - (folder, {key,label,min,max,step,get,set}) => controllerLike
 * @returns {{ ctrls: Record<string, any>, folders: Record<string, any>, set: Function }}
 */
export function buildGuiFromSchema(gui, schema, {
  state,
  bus,
  onChange
} = {}) {
  const ctrls = new Map();    // key -> controller 
  const folders = new Map();  // folderKey -> folder

  const emitChange = onChange ?? ((key, v) => bus?.emit?.(`${key}`, v));

  function addFolder(parent, node) {
    const folder = parent.addFolder(node.folder);
    if (node.key) folders[node.key] = folder;
    if (node.hidden) folder.hide();

    if (node.items?.length) {
      for (const item of node.items) {
        switch (item.type) {
          case 'bool': {
            ctrls[item.key] = folder
              .add(state, item.key)
              .name(item.label)
              .onChange(v => { state[item.key] = v; emitChange(item.key, v); });
            break;
          }

          case 'range': {
            const { min, max, step = 1 } = item;
            ctrls[item.key] = folder
              .add(state, item.key, min, max, step)
              .name(item.label)
              .onChange(v => emitChange(item.key, v));
            break;
          }

          case 'range2': {
          // Ensure a pair exists on state (in case caller didn’t seed it)
          if (!Array.isArray(state[item.key]) || state[item.key].length !== 2) {
            state[item.key] = [item.min, item.max];
          }

          ctrls[item.key] = makeDualSlider(folder, {
            label:    item.label,
            min:      item.min,
            max:      item.max,
            step:     item.step ?? 1,
            decimals: item.decimals,     // optional; falls back to step precision
            bind: { obj: state, key: item.key },
            onChange: (pair) => emitChange(item.key, pair)  // emit ui.<key> for user edits
          });
          break;
          }

          case 'select': {
            ctrls[item.key] = folder
              .add(state, item.key, item.options)
              .name(item.label)
              .onChange(v => emitChange(item.key, v));
            break;
          }

          case 'text': {
            ctrls[item.key] = folder.add(state, item.key).name(item.label);
            if (item.readonly) ctrls[item.key].disable?.();
            else ctrls[item.key].onChange(v => emitChange(item.key, v));
            break;
          }

          case 'button': {
            // buttons emit semantic app events
            const shim = { click: () => bus?.emit?.(item.event, item.payload) };
            ctrls[item.key] = folder.add(shim, 'click').name(item.label);
            break;
          }

          default:
            console.warn('Unknown control type:', item.type, item);
        }
      }
    }

    // recurse into children
    if (node.children?.length) {
      node.children.forEach(child => addFolder(folder, child));
    }
  }

  // Build top-level folders
  schema.forEach(node => addFolder(gui, node));

  // Helper to update control values programmatically; silent by default.
  function set({key, val, silent = true}) {
      if (!ctrls[key]) return;  // don't attempt to change dual sliders yet - not implemented
      state[key] = val;
      if (!silent) emitChange(key, val);
      ctrls[key].updateDisplay();
  }

  // Update bounds of any control by key; clamps current value and silently reflects
  function setLimits({key, min, max, step }) {
    const c = ctrls[key];
    if (!c) return;

    // Try controller APIs (native sliders expose .min/.max)
    if (typeof c.min === 'function' && min != null) c.min(min);
    if (typeof c.max === 'function' && max != null) c.max(max);
    if (typeof c.step === 'function' && step != null) c.step(step);

    c.updateDisplay(); 
    // Don't worry about clamping val - app needs to request that explicitly if desired
  }

  return { ctrls, folders, set, setLimits  };
}
