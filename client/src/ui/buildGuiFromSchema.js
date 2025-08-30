// ui/buildGuiFromSchema.js
// import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import GUI from 'lil-gui';
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
 * @returns {{ ctrls: Record<string, any>, folders: Record<string, any>, set: Function, setLimits: Function }}
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

    // helper: create a single controller in this folder
    const addOne = (item) => {
      switch (item.type) {
        case 'bool': {
          ctrls[item.key] = folder
            .add(state, item.key)
            .name(item.label)
            .onChange(v => { state[item.key] = v; emitChange(item.key, v); });
          return ctrls[item.key];
        }

        case 'range': {
          const { min, max, step = 1 } = item;
          ctrls[item.key] = folder
            .add(state, item.key, min, max, step)
            .name(item.label)
            .onChange(v => emitChange(item.key, v));
          return ctrls[item.key];
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
            onChange: (pair) => emitChange(item.key, pair)  // emit <key> for user edits
          });
          return ctrls[item.key];
        }

        case 'select': {
          ctrls[item.key] = folder
            .add(state, item.key, item.options)
            .name(item.label)
            .onChange(v => emitChange(item.key, v));
          return ctrls[item.key];
        }

        case 'text': {
          ctrls[item.key] = folder.add(state, item.key).name(item.label);
          if (item.readonly) ctrls[item.key].disable?.();
          else ctrls[item.key].onChange(v => emitChange(item.key, v));
          return ctrls[item.key];
        }

        case 'button': {
          const shim = { click: () => bus?.emit?.(item.event, item.payload) };
          const ctrl = folder.add(shim, 'click');     // create the controller
          const btn = ctrl.domElement.querySelector('button');
          if (btn) btn.textContent = item.label ?? 'Button'; // put label inside <button>
          ctrl.name(''); // clear the left-hand .name so rows can hide it
          ctrl.setLabel = (txt) => { if (btn) btn.textContent = txt ?? ''; }; // since we move the label inside
          ctrls[item.key] = ctrl;
          return ctrl;
        }

        default:
          console.warn('Unknown control type:', item.type, item);
          return null;
      }
    };

    // where lil-gui puts child rows
    const childrenEl =
      folder.domElement.querySelector('.children') || folder.domElement;

    if (node.items?.length) {
      for (const item of node.items) {
        // NEW layout primitive: a single row containing multiple small controls
        // Schema shape: { type: 'row', items: [ {type:'bool',...}, {type:'bool',...}, ... ] }
        if (item.type === 'row') {
          const row = document.createElement('div');
          row.className = 'gui-row';
          if (item.rowKind) row.classList.add(`row-${item.rowKind}`);
          if (item.tight) row.classList.add('row-tight');
          if (Number.isFinite(item.gap)) row.style.gap = `${item.gap}px`;

          for (const child of item.items ?? []) {
            const c = addOne(child);
            if (!c?.domElement) continue;
            // tag button controllers so CSS can hide their left label reliably
            if (c.domElement.querySelector('button')) {
              c.domElement.classList.add('has-button');
            }
            row.appendChild(c.domElement);
          }
          childrenEl.appendChild(row);
          continue;
        }

        // default: create as a normal full-width line
        addOne(item);
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
    if (!ctrls[key]) return;  // dual sliders: not implemented for programmatic set yet
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
