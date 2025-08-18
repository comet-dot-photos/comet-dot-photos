// makeDualSlider.js
// New API:
// const ctrl = makeDualSlider(folder, {
//   label: 'Meters per Pixel',
//   min: 0, max: 10, step: 0.01, decimals: 2,                // decimals optional; derived from step if omitted
//   bind: { obj: state.filters, key: 'metersPerPixel' },     // optional; enables: state.filters.metersPerPixel = [0.2, 5.0]
//   onChange: (pair) => applyMpPFilter()                     // called on user edits only
// });

export function makeDualSlider(folder, {
  label,
  min, max,
  step = 1,
  decimals = (String(step).includes('.') ? String(step).split('.')[1].length : 0),
  bind,          // { obj, key } optional
  onChange       // (pair: [number, number]) => void
}) {
  // --- Build DOM row from template and mount in lil-gui folder ---
  const template = document.querySelector('.dual-slider-template');
  const clone = template.cloneNode(true);
  clone.removeAttribute('hidden');
  clone.classList.add('controller', 'number', 'hasSlider');

  const nameEl       = clone.querySelector('#nameNode');
  const slider       = clone.querySelector('#sliderNode');
  const sliderTrack  = clone.querySelector('#slider-track');
  const lowerSlider  = clone.querySelector('#slider-lower');
  const upperSlider  = clone.querySelector('#slider-upper');
  const lowInput     = clone.querySelector('#min');
  const hiInput      = clone.querySelector('#max');

  nameEl.textContent = label ?? '';

  const container =
    folder.domElement.querySelector(':scope > .children') || folder.domElement;
  container.appendChild(clone);

  // --- Helpers & canonical value ---
  const limits = { min: Number(min), max: Number(max), step: Number(step) || 1 };
  const snapDen = Math.pow(10, Number(decimals) || 0);
  const snap = (n) => Math.round(n * snapDen) / snapDen;
  const clamp = (n) => Math.min(limits.max, Math.max(limits.min, n));

  function normalize([a, b]) {
    a = clamp(Number(a)); b = clamp(Number(b));
    if (a > b) [a, b] = [b, a];
    if (limits.step > 0) { a = snap(a); b = snap(b); }
    return [a, b];
  }

  function applyLimitsToDom() {
    [lowerSlider, upperSlider, lowInput, hiInput].forEach(el => {
      el.min = String(limits.min);
      el.max = String(limits.max);
      el.step = String(limits.step);
    });
  }

  function writeDom([a, b]) {
    lowInput.value = String(a);
    hiInput.value  = String(b);
    lowerSlider.value = String(a);
    upperSlider.value = String(b);
  }

  // canonical pair this control owns (seed from bound prop if available)
  let pair = normalize([
    Number(bind?.obj?.[bind?.key]?.[0] ?? limits.min),
    Number(bind?.obj?.[bind?.key]?.[1] ?? limits.max)
  ]);

  applyLimitsToDom();
  writeDom(pair);

  // --- Optional binding: property assignment repaints silently ---
  if (bind?.obj && typeof bind.key === 'string') {
    const { obj, key } = bind;

    // seed the property with a copy
    obj[key] = [pair[0], pair[1]];

    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      get() { return [pair[0], pair[1]]; },  // return a copy
      set(newPair) {
        if (!Array.isArray(newPair) || newPair.length !== 2) return;
        pair = normalize([newPair[0], newPair[1]]);
        writeDom(pair);  // silent repaint; no onChange
      }
    });
  }

  // --- User → app: notify on user edits only ---
  const notifyUserChange = () => { onChange?.([pair[0], pair[1]]); };

  function fromInputs() {
    pair = normalize([lowInput.value, hiInput.value]);
    writeDom(pair);
    notifyUserChange();
  }
  function fromSliders() {
    pair = normalize([lowerSlider.value, upperSlider.value]);
    writeDom(pair);
    notifyUserChange();
  }

  // Click/drag on track to move nearest handle
  let useLower = true;
  function moveNearest(e, choose = false) {
    const rect = sliderTrack.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    const v = limits.min + t * (limits.max - limits.min);

    const lv = Number(lowerSlider.value), uv = Number(upperSlider.value);
    if (choose) useLower = Math.abs(v - lv) <= Math.abs(v - uv);

    if (useLower) {
      const cap = Math.min(uv - limits.step, limits.max);
      lowerSlider.value = String(clamp(Math.min(v, cap)));
      lowInput.value = lowerSlider.value;
    } else {
      const floor = Math.max(lv + limits.step, limits.min);
      upperSlider.value = String(clamp(Math.max(v, floor)));
      hiInput.value = upperSlider.value;
    }
    fromSliders();
    e.stopImmediatePropagation();
  }
  function startDrag(e) {
    moveNearest(e, true);
    document.addEventListener('pointermove', moveNearest);
    document.addEventListener('pointerup', stopDrag);
  }
  function stopDrag(e) {
    moveNearest(e, false);
    document.removeEventListener('pointermove', moveNearest);
    document.removeEventListener('pointerup', stopDrag);
  }

  // Wire events
  lowInput.addEventListener('input', fromInputs);
  hiInput .addEventListener('input', fromInputs);
  slider  .addEventListener('pointerdown', startDrag);

  // --- Controller API ---
  function updateDisplay() { writeDom(pair); }  // repaint from current pair silently

  function setValue(newPair, { silent = true } = {}) {
    if (!Array.isArray(newPair) || newPair.length !== 2) return;
    pair = normalize(newPair);
    writeDom(pair);
    if (!silent) notifyUserChange(); // opt-in notify

    // reflect to bound prop if present (triggers setter; same values → no visual change)
    if (bind?.obj && typeof bind.key === 'string') {
      const { obj, key } = bind;
      obj[key] = [pair[0], pair[1]];
    }
  }

  function setMin(v)  { if (v == null) return; limits.min  = Number(v); applyLimitsToDom(); setValue(pair, { silent: true }); }
  function setMax(v)  { if (v == null) return; limits.max  = Number(v); applyLimitsToDom(); setValue(pair, { silent: true }); }
  function setStep(v) { if (v == null) return; limits.step = Number(v) || 1; applyLimitsToDom(); /* no value change */ }

  function dispose() {
    lowInput.removeEventListener('input', fromInputs);
    hiInput .removeEventListener('input', fromInputs);
    slider  .removeEventListener('pointerdown', startDrag);
    document.removeEventListener('pointermove', moveNearest);
    document.removeEventListener('pointerup', stopDrag);
    clone.remove();
  }

  return {
    root: clone,
    updateDisplay,
    setValue,
    min: setMin, max: setMax, step: setStep,
    dispose
  };
}



/*

// example makeDualSlider(filterFolder, "Meters per Pixel", 0, 10, .1, 1, cpanel.MpP_duo, (vals)=>{applyMpPFilter(ogPhotoArray)});
export function makeDualSlider(folder, name, min, max, step, afterDec, valArray, funct) {
    // get div structure from html page
    const template = document.getElementById('sliderTemplate');
    const clone = template.cloneNode(true);
    clone.removeAttribute('hidden');
    const label = clone.querySelector('#nameNode');
    label.textContent = name;
    const slider = clone.querySelector('#sliderNode')
    const lowerSlider = clone.querySelector('#slider-lower');
    const upperSlider = clone.querySelector('#slider-upper');
    const sliderTrack = clone.querySelector('#slider-track'); 
    const sliderContainer = slider; // get rid of duplication
    const lowInput = clone.querySelector('#min');
    lowInput.value = min;
    const hiInput = clone.querySelector('#max');
    hiInput.value = max;

    // set slider properties
    lowerSlider.min = upperSlider.min = min;
    lowerSlider.max = upperSlider.max = max;
    lowerSlider.step = upperSlider.step = step;
    lowerSlider.value = valArray[0];
    upperSlider.value = valArray[1];

    // Append the slider to the children element
    const childrenElement = folder.domElement.querySelector('.children');   
    childrenElement.appendChild(clone);

    const roundDenom = 10**afterDec;  // number to divide by when rounding

    function update(event = null) {
        valArray[0] = lowerSlider.value;
        valArray[1] = upperSlider.value;
        funct(valArray);
    }

    let updateLowerHandle;  // will be set to true if the lower slider handle is being updated, false if the upper
    function moveNearestHandle(event, chooseHandle=false) {
        const rect = sliderTrack.getBoundingClientRect();
        const percentage = (event.clientX - rect.left) / rect.width;
        const newVal = min + percentage*(max-min);
        const lowerValue = parseFloat(lowerSlider.value);
        const upperValue = parseFloat(upperSlider.value);
    
        if (chooseHandle)
            updateLowerHandle = Math.abs(newVal - lowerValue) < Math.abs(newVal - upperValue);

        if (updateLowerHandle) {
            if (newVal < min)  						// out of range low
                lowerSlider.value = min;
            else if (newVal <= upperValue-step)		// in range
                lowerSlider.value = newVal;
            else 									// out of range high
                lowerSlider.value = upperValue-step;
            lowInput.value = lowerSlider.value;
        } else {
            if (newVal > max)						// out of range high
                upperSlider.value = max;
            else if (newVal >= lowerValue+step)		// in range
                upperSlider.value = newVal;
            else  									// out of range low
                upperSlider.value = lowerValue+step;
            hiInput.value = upperSlider.value;
        }

        event.stopImmediatePropagation();
        update();
        }

    function startDrag(event) {
        moveNearestHandle(event, true);
        document.addEventListener('pointermove', moveNearestHandle);
        document.addEventListener('pointerup', stopDrag);
    }
    
    function stopDrag(event) {
        moveNearestHandle(event);
        document.removeEventListener('pointermove', moveNearestHandle)
        document.removeEventListener('pointerup', stopDrag);
    }

    function updateSlider(event, index) { // function to update the valArray & slider from low or hi input fields
        let num = Number(event.target.value);
        if (!isNaN(num) && num >= min && num <= max && (num == Math.round(num*roundDenom)/roundDenom)) { // make sure that it's a number, in range, and 
            valArray[index] = num;
            [lowerSlider.value, upperSlider.value] = valArray;  // will not trigger slider callback...
            funct(valArray);									// ...so do it manually
        } else event.target.value= valArray[index];  // reset to old value if not valid
    }
    lowInput.addEventListener('input', (event) => { updateSlider(event, 0); });
    hiInput.addEventListener('input', (event) => { updateSlider(event, 1); });
    sliderContainer.addEventListener('pointerdown', startDrag);  

    function setValue (newPair) {
        valArray[0] = newPair[0];
        valArray[1] = newPair[1];
    }

    return {
        setValue
    };
}
    */
