// ui/makeMultiSelect.js
// Custom checkbox-dropdown multiselect for lil-gui.
// API mirrors the dual-slider style and integrates with buildGuiFromSchema.
// Usage in schema: { type:'multiselect', key:'myKey', label:'My Label:', options:[...values...] }

export function makeMultiSelect(folder, {
  label,
  options = [],           // array of primitive option values or {value,label}
  bind,                   // { obj, key } optional -> stores/reads an array on obj[key]
  onChange,               // (arrayOfValues) => void   (user edits only)
  maxInline = 3           // button label shows up to N names, else "N selected"
}) {
  // ---------- mount a lil-gui row ----------
  const container = folder.domElement.querySelector(':scope > .children') || folder.domElement;
  const row = document.createElement('div');
  row.className = 'controller';
  row.innerHTML = `
    <div class="name">${label ?? ''}</div>
    <div class="widget"></div>
  `;
  container.appendChild(row);
  const widget = row.querySelector('.widget');

  // ---------- normalize options ----------
  function norm(o) { return (typeof o === 'object' && o) ? { value: String(o.value), label: String(o.label ?? o.value) }
                                                         : { value: String(o),       label: String(o) }; }
  let OPTS = options.map(norm);

  // ---------- state ----------
  let selected = new Set();   // of string values
  let isDisabled = false;

  // If bound, seed from bound prop; else empty
  if (bind?.obj && typeof bind.key === 'string' && Array.isArray(bind.obj[bind.key])) {
    selected = new Set(bind.obj[bind.key].map(String));
  }

  // ---------- button + popover (portal to <body>) ----------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-btn';
  btn.innerHTML = `<span class="ms-label">Select…</span><span class="ms-caret">▾</span>`;
  const labelEl = btn.querySelector('.ms-label');
  widget.appendChild(btn);

  const pop = document.createElement('div');
  pop.className = 'ms-pop';
  pop.innerHTML = `
    <div class="ms-actions">
      <button type="button" data-action="all">Select all</button>
      <button type="button" data-action="none">Clear</button>
    </div>
    <div class="ms-list"></div>
  `;
  const listEl = pop.querySelector('.ms-list');
  document.body.appendChild(pop);

  // --- ensure popover uses lil-GUI’s exact font (panel → pop) ---
  function syncFontFromGUI() {
    const src = btn.closest('.lil-gui') || folder.domElement;
    const cs  = getComputedStyle(src);
    // small bump so it’s a touch easier to select; tweak if you prefer 1.0
    const basePx = parseFloat(cs.fontSize) || 13;
    pop.style.fontFamily     = cs.fontFamily;
    pop.style.fontWeight     = cs.fontWeight;
    pop.style.fontStyle      = cs.fontStyle;
    pop.style.letterSpacing  = cs.letterSpacing;
    pop.style.lineHeight     = cs.lineHeight;
    pop.style.fontSize       = (basePx * 1.05) + 'px';
  }

  // ---------- render helpers ----------
  function buildList() {
    listEl.innerHTML = '';
    for (const o of OPTS) {
      const row = document.createElement('label');
      row.className = 'ms-item';
      row.innerHTML = `<input type="checkbox" value="${o.value}"> <span>${o.label}</span>`;
      const cb = row.querySelector('input');
      cb.checked = selected.has(o.value);
      cb.disabled = isDisabled;
      listEl.appendChild(row);
    }
  }

  function setButtonLabel() {
    const labels = OPTS.filter(o => selected.has(o.value)).map(o => o.label);
    btn.title = labels.join(', ');
    labelEl.textContent =
      labels.length === 0 ? 'Select…' :
      labels.length <= maxInline ? labels.join(' + ') :
      `${labels.length} selected`;
  }

  function paint() { buildList(); setButtonLabel(); }

  // ---------- commit (user → app) ----------
  function commit() {
    if (isDisabled) return;
    const vals = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    selected = new Set(vals);
    // reflect to bound prop (silent)
    if (bind?.obj && typeof bind.key === 'string') bind.obj[bind.key] = vals.slice();
    setButtonLabel();
    onChange?.(vals.slice());  // notify app
  }

  // ---------- open/close + clamped placement ----------
  const panelEl = folder.domElement.closest('.lil-gui');
  function clampPlace() {
    const rBtn = btn.getBoundingClientRect();
    const rPanel = (panelEl ? panelEl.getBoundingClientRect() : { left:0, right:window.innerWidth });
    // ensure measurable
    const prev = pop.style.display; pop.style.display = 'block';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.display = prev || '';

    const pad = 8;
    let left = rBtn.left;
    const maxLeft = rPanel.right - w - pad;
    const minLeft = rPanel.left + pad;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    let top = rBtn.bottom + 8;
    const maxTop = window.innerHeight - h - 8;
    top = Math.min(Math.max(8, top), maxTop);

    pop.style.left = Math.round(left) + 'px';
    pop.style.top  = Math.round(top) + 'px';
    pop.style.minWidth = Math.round(rBtn.width) + 'px';
  }

function open() {
  if (isDisabled) return;
  // 1) apply final display styles first (so width/height are accurate)
  pop.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  // 2) sync font from lil-GUI (may change text metrics)
  syncFontFromGUI();
  // 3) place now that styles/fonts are applied
  clampPlace();
  // 4) re-place on next frame in case layout shifts
  requestAnimationFrame(() => clampPlace());
  // 5) if fonts load async, re-place once they’re ready
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => clampPlace()).catch(() => {});
  }
  document.addEventListener('click', onOutside, true);
  window.addEventListener('scroll', clampPlace, true);
  window.addEventListener('resize', onResize);
}

  function close() {
    pop.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutside, true);
    window.removeEventListener('scroll', clampPlace, true);
    window.removeEventListener('resize', onResize);
  }
  function onResize() { syncFontFromGUI(); clampPlace(); }
  const onOutside = (e) => {
   // treat clicks on the caret/label (inside the button) as "inside"
   if (btn.contains(e.target) || pop.contains(e.target)) return;
   close();
 }

  // ---------- wire ----------
  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.contains('open') ? close() : open(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  listEl.addEventListener('change', commit);
  pop.querySelector('[data-action="all"]').addEventListener('click', () => {
    if (isDisabled) return;
    OPTS.forEach(o => selected.add(o.value));
    buildList(); commit();
  });
  pop.querySelector('[data-action="none"]').addEventListener('click', () => {
    if (isDisabled) return;
    selected.clear();
    buildList(); commit();
  });

  // ---------- initial paint ----------
  paint();

  // ---------- controller-like API (for GuiController hooks) ----------
  function updateDisplay() {
    // pull latest from bound state if present
    if (bind?.obj && typeof bind.key === 'string') {
      const arr = Array.isArray(bind.obj[bind.key]) ? bind.obj[bind.key] : [];
      selected = new Set(arr.map(String));
    }
    paint();
  }
  function setValue(arr, { silent = true } = {}) {
    const vals = Array.isArray(arr) ? arr.map(String) : [];
    selected = new Set(vals.filter(v => OPTS.some(o => o.value === v)));
    // reflect to bound
    if (bind?.obj && typeof bind.key === 'string') bind.obj[bind.key] = Array.from(selected);
    paint();
    if (!silent) onChange?.(Array.from(selected));
  }
  function setOptions(newOpts) {
    OPTS = (newOpts ?? []).map(norm);
    // prune selection of any values no longer present
    selected = new Set(Array.from(selected).filter(v => OPTS.some(o => o.value === v)));
    paint();
  }
  function disable() {
    isDisabled = true;
    btn.disabled = true;
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.disabled = true);
    row.classList.add('is-disabled');
    close();
  }
  function enable() {
    isDisabled = false;
    btn.disabled = false;
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.disabled = false);
    row.classList.remove('is-disabled');
  }
  function dispose() { btn.remove(); pop.remove(); row.remove(); }

  // shape compatible with the controller registry
  return {
    domElement: row,
    updateDisplay,
    setValue,
    options: setOptions,   // used by GuiController.setSelectOpts
    disable,
    enable,
    dispose
  };
}
