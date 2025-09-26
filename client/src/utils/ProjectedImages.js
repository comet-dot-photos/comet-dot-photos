// ProjectedImages.js
// Texture projector wrapper for three.js
// - Stable on tiny triangles (projector clip computed in vertex shader)
// - Optional static depth mask (RGBADepthPacking) to prevent "bleed-through"
// - Runtime-toggleable debug modes ('z'|'mask'|'uv'|'center'|null)
// - WebGL2 sRGB sampling handled correctly; minimal overhead in hot path

import * as THREE from 'three';

// ------------------------------ Utilities ------------------------------

function isPowerOfTwo(n) { return (n & (n - 1)) === 0; }

export function setTextureQuality(tex, renderer) {
  if (!tex) return;
  const gl2 = !!renderer?.capabilities?.isWebGL2;
  const img = tex.image;
  const w = img?.width || tex.source?.data?.width || tex.imageWidth || 0;
  const h = img?.height || tex.source?.data?.height || tex.imageHeight || 0;
  const isPOT = w && h && isPowerOfTwo(w) && isPowerOfTwo(h);

  tex.magFilter = THREE.LinearFilter;

  if (gl2 || isPOT) {
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 0;
    if (maxAniso > 0) tex.anisotropy = maxAniso;
  } else {
    // WebGL1 + NPOT safety
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
}

function getProjectorPV(cam) {
  if (!cam) return new THREE.Matrix4().identity();
  cam.updateMatrixWorld();
  return new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
}

// ------------------------------ ProjectionHandle ------------------------------

class ProjectionHandle {
  constructor(material, projectorCam, texture, blend, origOnBeforeCompile) {
    this.material = material;
    this._origOnBeforeCompile = origOnBeforeCompile;
    this._projectorCam = projectorCam || null;

    this.uniforms = {
      // core
      uProjectorMap: { value: texture || null },
      uProjectorPV:  { value: getProjectorPV(projectorCam) },
      uProjBlend:    { value: blend ?? 0.0 },
      uHasProjTex:   { value: texture ? 1.0 : 0.0 },

      // color/quality
      uOverlayIsLinear: { value: 0.0 }, // WebGL2 sRGB samples are linear
      uFlipY:           { value: 0.0 },
      uEdgeSoft:        { value: 0.0 },
      uMaskAA:          { value: 1.0 }, // ~1px AA at mask edges
      uMipBias:         { value: 0.0 }, // 0..1 LOD bias (WebGL2)

      // depth mask
      uUseDepth:  { value: 0.0 },      // 0/1
      uDepthBias: { value: 0.001 },    // base bias
      uDepthTex:  { value: null },     // RGBADepthPacking

      // adaptive bias (optional; safe defaults)
      uDepthBiasK:   { value: 2.0 },
      uDepthBiasMax: { value: 0.02 },
    };

    this._attached = true;
    this._depthRT = null;
  }

  isAttached() { return !!this._attached; }

  update() {
    if (this._projectorCam) {
      this.uniforms.uProjectorPV.value.copy(getProjectorPV(this._projectorCam));
    }
  }

  setCamera(cam) { this._projectorCam = cam || null; this.update(); }

  setBlend(b) { this.uniforms.uProjBlend.value = Math.max(0, Math.min(1, b ?? 0)); }
  enable()  { this.setBlend(1.0); }
  disable() { this.setBlend(0.0); }

  setTexture(tex, renderer) {
    if (tex) setTextureQuality(tex, renderer);
    this.uniforms.uProjectorMap.value = tex || null;
    this.uniforms.uHasProjTex.value = tex ? 1.0 : 0.0;

    // keep colorspace flag in sync whenever the texture changes
    let overlayIsLinear = 0.0;
    if (tex && renderer && renderer.capabilities?.isWebGL2) {
      const isSRGB =
        ('colorSpace' in tex && tex.colorSpace === THREE.SRGBColorSpace) ||
        (tex.encoding === THREE.sRGBEncoding);
      overlayIsLinear = isSRGB ? 1.0 : 0.0; // WebGL2 auto-decodes sRGB → linear on sample
    }
    this.uniforms.uOverlayIsLinear.value = overlayIsLinear;
  }

  // Depth mask helpers
  setDepthTexture(tex) {
    this.uniforms.uDepthTex.value = tex || null;
    this.uniforms.uUseDepth.value = tex ? 1.0 : 0.0;
  }
  setDepthRenderTarget(rt) { this._depthRT = rt || null; }
  getDepthRenderTarget()  { return this._depthRT || null; }
  
  enableDepthMask(bias = 0.001) {
    this.uniforms.uDepthBias.value = bias;
    this.uniforms.uUseDepth.value = 1.0;
  }
  disableDepthMask() {
    this.uniforms.uUseDepth.value = 0.0;
  }
  setDepthBias(base = 0.001) { this.uniforms.uDepthBias.value = base; }
  setAdaptiveDepthBias(k = 2.0, maxBias = 0.02) {
    this.uniforms.uDepthBiasK.value = k;
    this.uniforms.uDepthBiasMax.value = maxBias;
  }
  enableDepthMaskAdaptive(base = 0.001, k = 2.0, maxBias = 0.02) {
    this.setDepthBias(base);
    this.setAdaptiveDepthBias(k, maxBias);
    this.enableDepthMask(base);
  }

  // ---------- Runtime debug toggles ----------
  setDebugMode(mode /* 'mask'|'uv'|'center'|'z'|null */) {
    this.material.userData ??= {};
    this.material.userData._projectorDebugMode = mode || null;
    this.material.needsUpdate = true; // triggers define switch
  }
  getDebugMode() { return this.material.userData?._projectorDebugMode || null; }
  setDebugTint(on /* boolean */) {
    this.material.userData ??= {};
    this.material.userData._projectorDebugTint = !!on;
    this.material.needsUpdate = true;
  }

  // Refresh a previously attached depth RT after moving scene/camera
  refreshDepth(renderer, scene, projectorCam, { width, height, bias } = {}) {
    const rt = this.getDepthRenderTarget?.();
    if (!rt) return;
    if (width && height) rt.setSize(width, height);
    if (bias !== undefined) this.enableDepthMask(bias);
    scene.updateMatrixWorld(true);
    projectorCam.updateMatrixWorld(true);
    renderProjectorDepth(renderer, scene, projectorCam, rt);
    this.setDepthTexture(rt.texture);
  }

  detach() {
    if (!this._attached) return;
    this.material.onBeforeCompile = this._origOnBeforeCompile || (s => s);
    delete this.material.userData._projectorHandle;
    this.material.needsUpdate = true;
    this._attached = false;
  }
}

// ------------------------------ Wrapper ------------------------------

/**
 * Wrap a material with projector overlay.
 * opts:
 *  - blend?: number (0..1)
 *  - renderer?: THREE.WebGLRenderer
 *  - debugTint?: boolean
 *  - debugMode?: 'mask'|'uv'|'center'|'z'
 *  - log?: boolean
 *  - maskAA?: number      // 0 = off, 1 ≈ 1px analytic AA
 *  - edgeSoft?: number    // optional UV feather (0..~0.1)
 *  - mipBias?: number     // 0..1 LOD bias (WebGL2 textureGrad)
 *  - flipY?: boolean      // flip projector V
 */
export function wrapMaterialWithProjector(
  material,
  projectorCamera = null,
  texture = null,
  opts = {}
) {
  const { blend, renderer, log } = opts;
  const isWebGL2 = !!renderer?.capabilities?.isWebGL2;

  const initialBlend = blend !== undefined ? blend : (projectorCamera && texture ? 1.0 : 0.0);

  material.userData ??= {};
  if (material.userData._projectorHandle?.isAttached?.()) {
    material.userData._projectorHandle.detach();
  }

  // Persist chosen debug flags on the material so we can toggle later
  material.userData._projectorDebugMode = opts.debugMode ?? null;   // 'mask'|'uv'|'center'|'z'|null
  material.userData._projectorDebugTint = !!opts.debugTint;

  // Enable derivatives extension only on WebGL1 (WebGL2 has it built-in)
  material.extensions ??= {};
  if (!isWebGL2) {
    material.extensions.derivatives = true; // needed for fwidth() on WebGL1
  }

  const handle = new ProjectionHandle(
    material, projectorCamera, texture, initialBlend, material.onBeforeCompile
  );

  if (texture) { try { setTextureQuality(texture, renderer); } catch (_) {} }

  // In WebGL2, sampling an sRGB texture yields LINEAR → re-encode to sRGB before mixing
  try {
    const isSRGB = texture &&
      (('colorSpace' in texture && texture.colorSpace === THREE.SRGBColorSpace) ||
       (texture.encoding === THREE.sRGBEncoding));
    handle.uniforms.uOverlayIsLinear.value = (isWebGL2 && isSRGB) ? 1.0 : 0.0;
  } catch (_) {}

  // apply creation-time opts to uniforms
  if (opts.maskAA !== undefined)   handle.uniforms.uMaskAA.value   = Math.max(0, opts.maskAA);
  if (opts.edgeSoft !== undefined) handle.uniforms.uEdgeSoft.value = Math.max(0, opts.edgeSoft);
  if (opts.mipBias !== undefined)  handle.uniforms.uMipBias.value  = Math.max(0, opts.mipBias);
  if (opts.flipY !== undefined)    handle.uniforms.uFlipY.value    = opts.flipY ? 1.0 : 0.0;

  const savedOrig = handle._origOnBeforeCompile;

  material.onBeforeCompile = (shader) => {
    if (typeof savedOrig === 'function') savedOrig(shader);

    shader.defines ??= {};
    // Read debug flags dynamically from material.userData (runtime-toggleable)
    const dbgMode = material.userData?._projectorDebugMode || null;
    const dbgTint = !!material.userData?._projectorDebugTint;

    if (dbgTint) shader.defines.PROJECTOR_DEBUG_TINT = 1;
    if (dbgMode) {
      if (dbgMode === 'center') shader.defines.PROJECTOR_DEBUG_CENTER = 1;
      if (dbgMode === 'mask')   shader.defines.PROJECTOR_DEBUG_MASK   = 1;
      if (dbgMode === 'uv')     shader.defines.PROJECTOR_DEBUG_UV     = 1;
      if (dbgMode === 'z')      shader.defines.PROJECTOR_DEBUG_Z      = 1;
    }
    if (isWebGL2) shader.defines.PI_USE_TEXGRAD = 1;

    Object.assign(shader.uniforms, handle.uniforms);

    // -------- VERTEX: compute projector clip in vertex (stable on tiny tris) --------
    let vsrc = shader.vertexShader;
    vsrc = vsrc.replace(
      'void main() {',
      `
      uniform mat4 uProjectorPV;
      varying highp vec4 vProjClip;
      void main() {
      `
    );
    if (vsrc.includes('#include <project_vertex>')) {
      vsrc = vsrc.replace(
        '#include <project_vertex>',
        `
        #include <project_vertex>
        vProjClip = uProjectorPV * vec4( (modelMatrix * vec4( transformed, 1.0 )).xyz, 1.0 );
        `
      );
    } else if (vsrc.includes('gl_Position')) {
      vsrc = vsrc.replace(
        /gl_Position\s*=\s*[^;]+;/,
        m => `
          vProjClip = uProjectorPV * vec4( (modelMatrix * vec4( position, 1.0 )).xyz, 1.0 );
          ${m}
        `
      );
    }
    shader.vertexShader = vsrc;

    // -------- FRAGMENT: helpers + apply at end of main() --------
    let fsrc = shader.fragmentShader;
    fsrc = fsrc.replace(
      'void main() {',
      `
      uniform sampler2D uProjectorMap;
      uniform float uProjBlend;
      uniform float uHasProjTex;
      uniform float uOverlayIsLinear;
      uniform float uFlipY;
      uniform float uEdgeSoft;
      uniform float uMaskAA;
      uniform float uMipBias;

      // depth mask
      uniform float uUseDepth;
      uniform float uDepthBias;
      uniform sampler2D uDepthTex; // RGBADepthPacking
      uniform float uDepthBiasK;
      uniform float uDepthBiasMax;

      varying highp vec4 vProjClip;

      float inUnit(float x){ return step(0.0,x)*step(x,1.0); }

      float PI_aastep(float t, float x, float wmul) {
        #ifdef GL_OES_standard_derivatives
          float w = fwidth(x) * max(wmul, 0.0);
          return smoothstep(t - w, t + w, x);
        #else
          return step(t, x);
        #endif
      }

      vec3 PI_linearToSRGB(vec3 v) {
        bvec3 cutoff = lessThanEqual(v, vec3(0.0031308));
        vec3 low  = v * 12.92;
        vec3 high = 1.055 * pow(max(v, vec3(0.0)), vec3(1.0/2.4)) - 0.055;
        return vec3(cutoff.x ? low.x  : high.x,
                    cutoff.y ? low.y  : high.y,
                    cutoff.z ? low.z  : high.z);
      }

      // unpack depth packed with THREE.RGBADepthPacking (0..1)
      float PI_unpackRGBADepth(vec4 v) {
        const vec4 bitInv = vec4(1.0/(256.0*256.0*256.0), 1.0/(256.0*256.0), 1.0/256.0, 1.0);
        return dot(v, bitInv);
      }

      vec4 PI_ApplyProjection(vec4 baseColor) {
        #ifdef PROJECTOR_DEBUG_TINT
          return vec4(1.0, 0.1, 0.1, 1.0);
        #endif

        // Interpolated projector clip coords
        vec4 pclip = vProjClip;
        float pw = pclip.w;
        bool valid = (pw > 1e-6);
        vec2 pndc = valid ? (pclip.xy / pw) : vec2(-2.0);
        vec2 puv  = 0.5 * pndc + 0.5;
        if (uFlipY > 0.5) puv.y = 1.0 - puv.y;

        float z01 = 0.0;
        float inside = 0.0;
        float pass   = 1.0;

        if (valid) {
          float zndc = pclip.z / pw; // [-1,1]
          z01 = 0.5 * (zndc + 1.0);

          float ax = uMaskAA, ay = uMaskAA, az = uMaskAA;
          float mx = PI_aastep(0.0, puv.x, ax) * (1.0 - PI_aastep(1.0, puv.x, ax));
          float my = PI_aastep(0.0, puv.y, ay) * (1.0 - PI_aastep(1.0, puv.y, ay));
          float mz = PI_aastep(0.0, z01,  az) * (1.0 - PI_aastep(1.0, z01,  az));
          inside = mx * my * mz;

          if (uEdgeSoft > 0.0) {
            float s = uEdgeSoft;
            inside *= smoothstep(0.0, s, puv.x)
                    * smoothstep(0.0, s, puv.y)
                    * smoothstep(0.0, s, 1.0 - puv.x)
                    * smoothstep(0.0, s, 1.0 - puv.y);
          }

          if (uUseDepth > 0.5) {
            float sceneDepth = PI_unpackRGBADepth( texture2D(uDepthTex, puv) );

            // Adaptive bias for ridges/silhouettes
            #ifdef GL_OES_standard_derivatives
              float slope = fwidth(z01);
            #else
              float slope = 0.0;
            #endif
            float biasLocal = uDepthBias + uDepthBiasK * slope;
            biasLocal = min(biasLocal, uDepthBiasMax);

            pass = step(z01 - biasLocal, sceneDepth); // 1 if projected in front of scene
            inside *= pass;
          }
        }

        #if defined(PROJECTOR_DEBUG_MASK)
          return vec4(vec3(inside), 1.0);
        #elif defined(PROJECTOR_DEBUG_UV)
          return vec4(clamp(vec3(puv, 0.0), 0.0, 1.0), 1.0);
        #elif defined(PROJECTOR_DEBUG_CENTER)
          vec4 centerTex = texture2D(uProjectorMap, vec2(0.5));
          vec3 centerRGB = (uOverlayIsLinear > 0.5) ? PI_linearToSRGB(centerTex.rgb) : centerTex.rgb;
          float tC = clamp(uProjBlend, 0.0, 1.0) * centerTex.a;
          baseColor.rgb = mix(baseColor.rgb, centerRGB, tC);
          return baseColor;
        #elif defined(PROJECTOR_DEBUG_Z)
          // Grayscale = projected z in [0..1]; tint red where depth-mask fails
          vec3 gray = vec3(clamp(z01, 0.0, 1.0));
          #ifdef GL_OES_standard_derivatives
            float e = max(fwidth(z01), 1e-5);
            gray = mix(vec3(0.0), vec3(1.0), smoothstep(0.0 - e, 1.0 + e, z01));
          #endif
          vec3 col = gray;
          if (uUseDepth > 0.5) {
            float sceneDepth2 = PI_unpackRGBADepth( texture2D(uDepthTex, puv) );
            float biasLocal2 = uDepthBias; // show base behavior here
            #ifdef GL_OES_standard_derivatives
              biasLocal2 = min(uDepthBias + uDepthBiasK * fwidth(z01), uDepthBiasMax);
            #endif
            float pass2 = step(z01 - biasLocal2, sceneDepth2);
            col = mix(vec3(1.0, 0.0, 0.0), col, pass2);
          }
          return vec4(col, 1.0);
        #endif

        // If no debug path, proceed with normal projection only if we have a texture & blend
        if (!(uProjBlend > 0.0 && uHasProjTex > 0.5)) return baseColor;

        // sample overlay (explicit LOD control on WebGL2)
        vec4 projTex;
        #if defined(PI_USE_TEXGRAD)
          float lodScale = exp2(max(uMipBias, 0.0));
          vec2 ddx = dFdx(puv) * lodScale;
          vec2 ddy = dFdy(puv) * lodScale;
          projTex = textureGrad(uProjectorMap, puv, ddx, ddy);
        #else
          projTex = texture2D(uProjectorMap, puv);
        #endif

        vec3 projRGB = projTex.rgb;
        if (uOverlayIsLinear > 0.5) projRGB = PI_linearToSRGB(projRGB);

        float t = clamp(uProjBlend, 0.0, 1.0) * inside * projTex.a;
        baseColor.rgb = mix(baseColor.rgb, projRGB, t);
        return baseColor;
      }

      void main() {
      `
    );

    // Apply projector at the very end of main()
    fsrc = fsrc.replace(/}\s*$/, `
      gl_FragColor = PI_ApplyProjection(gl_FragColor);
    }
    `);

    shader.fragmentShader = fsrc;

    if (log) {
      console.log('[Projector] onBeforeCompile', {
        mat: material.uuid,
        type: material.type,
        vertexHasProject: shader.vertexShader.includes('#include <project_vertex>'),
        overlayIsLinear: handle.uniforms.uOverlayIsLinear.value,
        debugMode: material.userData?._projectorDebugMode || null
      });
    }
  };

  material.userData._projectorHandle = handle;
  material.needsUpdate = true;
  return handle;
}

// ------------------------------ Depth helpers (static) ------------------------------

export function makeProjectorDepthRT(renderer, w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType, // pack depth to RGBA (WebGL1-friendly)
    depthBuffer: true,
    stencilBuffer: false
  });
  // IMPORTANT: the packed depth must not be sRGB-encoded
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;   // r152+
  // (older three): rt.texture.encoding = THREE.LinearEncoding;
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking
  });
  depthMat.blending = THREE.NoBlending;
  depthMat.side = THREE.FrontSide; // avoid backface overwrites
  return {
    target: rt,
    texture: rt.texture,
    depthMat,
    setSize: (nw, nh) => rt.setSize(nw, nh),
    dispose: () => { rt.dispose(); depthMat.dispose(); }
  };
}

export function renderProjectorDepth(renderer, scene, projectorCam, depthRT) {
  const prev = {
    override: scene.overrideMaterial,
    target: renderer.getRenderTarget(),
    tone: renderer.toneMapping,
    autoClear: renderer.autoClear
  };
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = true;
  scene.overrideMaterial = depthRT.depthMat;

  renderer.setRenderTarget(depthRT.target);
  renderer.clear();
  renderer.render(scene, projectorCam);

  renderer.setRenderTarget(prev.target);
  scene.overrideMaterial = prev.override;
  renderer.toneMapping = prev.tone;
  renderer.autoClear = prev.autoClear;
}

// One-shot setup for static projector cameras (no animate() changes needed)
export function setupStaticProjectorDepthMask(renderer, scene, projectorCam, projectorHandle, opts = {}) {
  const {
    width = 1024,
    height = Math.max(1, Math.round(width / Math.max(1e-6, projectorCam.aspect))),
    bias = 0.005, // tighter, typical default
    log = false
  } = opts;

  const depthRT = makeProjectorDepthRT(renderer, width, height);
  renderProjectorDepth(renderer, scene, projectorCam, depthRT);
  projectorHandle.setDepthTexture(depthRT.texture);
  projectorHandle.enableDepthMask(bias);
  projectorHandle.setDepthRenderTarget(depthRT);

  if (log) console.log(`[Projector][Depth] static depth ready ${width}×${height}, bias=${bias}`);

  return {
    depthRT,
    refresh() { renderProjectorDepth(renderer, scene, projectorCam, depthRT); },
    dispose() { depthRT.dispose(); projectorHandle.disableDepthMask(); projectorHandle.setDepthTexture(null); }
  };
}
