// main.js — demo using projector wrapper + static depth mask
import * as THREE from 'three';
import {
  wrapMaterialWithProjector,
  setupStaticProjectorDepthMask
} from '../../../client/src/utils/ProjectedImages.js';

// ---- renderer / scene / view camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // r152+
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x151515);

const viewCam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);

// orbit params (view camera orbits the sphere)
let orbitPaused = false;
let camTheta = 0;
const orbitRadius = 3.2;
const orbitHeight = 1.2;

// set initial camera pose
viewCam.position.set(Math.cos(camTheta) * orbitRadius, orbitHeight, Math.sin(camTheta) * orbitRadius);
viewCam.lookAt(0, 0.8, 0);

// lights
scene.add(new THREE.AmbientLight(0x404040, 0.8));
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(2, 3, 2);
scene.add(dir);

// ---- test mesh ----
const geom = new THREE.SphereGeometry(0.8, 96, 64);
const mat = new THREE.MeshStandardMaterial({ color: 0x8ca0ff, metalness: 0.1, roughness: 0.8 });
const mesh = new THREE.Mesh(geom, mat);
mesh.position.y = 0.8;
scene.add(mesh);

// optional mesh spin (off by default)
let meshSpin = false;

// ---- projector camera (static) ----
const projectorCam = new THREE.PerspectiveCamera(28, 1, 0.1, 10);
resetProjector(projectorCam);
let helper;

// ---- textures ----
const overlayTex = makeOverlayTexture(); // POT for best quality
overlayTex.colorSpace = THREE.SRGBColorSpace;

const loader = new THREE.TextureLoader();
let sampleTex = null;
let useSample = false;

// ---- projector wrap ----
let handle;
let depthCtl = null;
let staticDepthBias = 0.001;

// Edge controls (feather + AA width)
let edgeSoft = 0.0;   // 0..~0.1 typical (feather amount near the projector border)
let maskAA   = 1.0;   // 0 = off, 1 ≈ 1px analytic AA (reduces shimmer)

// Apply current values to the active handle
function applyEdge() {
  if (!handle) return;
  handle.uniforms.uEdgeSoft.value = edgeSoft;
  handle.uniforms.uMaskAA.value   = maskAA;
  console.log(`edgeSoft=${edgeSoft.toFixed(3)}  maskAA=${maskAA.toFixed(2)}`);
}

function rewrap(opts = {}) {
  handle?.detach?.();
  handle = wrapMaterialWithProjector(mat, projectorCam, overlayTex, {
    blend: 1.0,
    renderer,
    log: true,
    ...opts
  });
  handle.update();

  if (depthCtl) {
    handle.setDepthTexture(depthCtl.depthRT.texture);
    handle.enableDepthMask(staticDepthBias);
  }

  // re-apply current edge settings whenever we rewrap
  applyEdge();

  console.log('wrap → blend=', handle.uniforms.uProjBlend.value,
              'hasTex=', handle.uniforms.uHasProjTex.value,
              'useDepth=', handle.uniforms.uUseDepth.value,
              'hasDepthTex=', !!handle.uniforms.uDepthTex.value);
}

// initial wrap
rewrap();

// static depth mask (render once & bind)
depthCtl = setupStaticProjectorDepthMask(renderer, scene, projectorCam, handle, {
  width: 1024,
  bias: staticDepthBias,
  log: true
});

// ---- animate ----
function animate() {
  requestAnimationFrame(animate);

  // orbit the view camera around the sphere (projector is static)
  if (!orbitPaused) camTheta += 0.01;
  viewCam.position.set(Math.cos(camTheta) * orbitRadius, orbitHeight, Math.sin(camTheta) * orbitRadius);
  viewCam.lookAt(mesh.position);

  // optional mesh spin (independent of orbit pause)
  if (meshSpin) mesh.rotation.y += 0.003;

  renderer.render(scene, viewCam);
}
animate();

// ---- helpers ----

function makeOverlayTexture() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');

  g.clearRect(0, 0, w, h);

  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1;
  for (let x=0; x<=w; x+=64) { g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke(); }
  for (let y=0; y<=h; y+=64) { g.beginPath(); g.moveTo(0,y); g.lineTo(w,y); g.stroke(); }

  g.strokeStyle = 'rgba(255,64,64,0.9)';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(w/2,0); g.lineTo(w/2,h); g.stroke();
  g.beginPath(); g.moveTo(0,h/2); g.lineTo(w,h/2); g.stroke();

  g.font = 'bold 120px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillText('PROJECT', w/2, h/2);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function resetProjector(cam) {
  cam.fov = 28;
  cam.aspect = 1;
  cam.near = 0.1;
  cam.far  = 10;
  cam.updateProjectionMatrix();
  cam.position.set(2.0, 1.4, 0.0);
  cam.lookAt(0, 0.8, 0);
}

// resize
window.addEventListener('resize', () => {
  viewCam.aspect = window.innerWidth / window.innerHeight;
  viewCam.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- hotkeys ----
window.addEventListener('keydown', (e) => {
  if (!handle) return;
  const k = e.key;

  // enable/disable overlay
  if (k.toLowerCase() === 'e') {
    const b = handle.uniforms.uProjBlend.value;
    if (b > 0) { handle.disable(); console.log('projector: disabled'); }
    else { handle.enable(); console.log('projector: enabled'); }
    return;
  }

  // blend down: -, _, [, NumpadSubtract
  if (k === '-' || k === '_' || k === '[' || k === 'Subtract' || k === 'NumpadSubtract') {
    const b = handle.uniforms.uProjBlend.value;
    handle.setBlend(Math.max(0, b - 0.1));
    console.log('blend:', handle.uniforms.uProjBlend.value.toFixed(2));
    return;
  }

  // blend up: +, =, ], Add/NumpadAdd
  if (k === '+' || k === '=' || k === ']' || k === 'Add' || k === 'NumpadAdd') {
    const b = handle.uniforms.uProjBlend.value;
    handle.setBlend(Math.min(1, b + 0.1));
    console.log('blend:', handle.uniforms.uProjBlend.value.toFixed(2));
    return;
  }

  // P: pause/unpause the VIEW CAMERA ORBIT (projector remains static)
  if (k.toLowerCase() === 'p') {
    orbitPaused = !orbitPaused;
    console.log('view orbit paused:', orbitPaused);
    return;
  }

  // M: toggle mesh spin (optional)
  if (k.toLowerCase() === 'm') {
    meshSpin = !meshSpin;
    console.log('mesh spin:', meshSpin);
    return;
  }

  // reset projector pose (still static)
  if (k.toLowerCase() === 'r') {
    resetProjector(projectorCam);
    handle.update();
    // If you changed occluders, you can refresh the static depth once:
    // depthCtl.refresh();
    console.log('projector reset (static)');
    return;
  }

  // toggle CameraHelper
  if (k.toLowerCase() === 'h') {
    if (helper) { scene.remove(helper); helper = undefined; }
    else { helper = new THREE.CameraHelper(projectorCam); scene.add(helper); }
    console.log('helper:', !!helper);
    return;
  }

  // debug modes: 1 mask (now includes depth), 2 uv, 3 center, 0 normal
  if (k === '1') { rewrap({ renderer, debugMode: 'mask' });   console.log('debugMode: mask');   if (!helper) { helper = new THREE.CameraHelper(projectorCam); scene.add(helper); } return; }
  if (k === '2') { rewrap({ renderer, debugMode: 'uv' });     console.log('debugMode: uv');     if (!helper) { helper = new THREE.CameraHelper(projectorCam); scene.add(helper); } return; }
  if (k === '3') { rewrap({ renderer, debugMode: 'center' }); console.log('debugMode: center'); if (!helper) { helper = new THREE.CameraHelper(projectorCam); scene.add(helper); } return; }
  if (k === '0') { rewrap({ renderer }); console.log('debugMode: off'); return; }

  // 'S' toggles projector texture between overlay and sample.jpg
  if (k.toLowerCase() === 's') {
    useSample = !useSample;
    if (useSample) applySampleTexture();
    else applyOverlayTexture();
    return;
  }

  // '(' => sharper (less feather + narrower AA)
  if (k === '(') {
    edgeSoft = Math.max(0.0, edgeSoft - 0.01);  // step feather down
    maskAA   = Math.max(0.0, maskAA   - 0.10);  // step AA width down
    applyEdge();
    console.log(`Sharpening edge: edgeSoft = ${edgeSoft}, maskAA = ${maskAA}`);
    return;
  }

  // ')' => softer (more feather + wider AA)
  if (k === ')') {
    edgeSoft = Math.min(0.12, edgeSoft + 0.01); // clamp ~0.12 max feather
    maskAA   = Math.min(2.00, maskAA   + 0.10); // clamp AA width
    applyEdge();
    console.log(`Softening edge: edgeSoft = ${edgeSoft}, maskAA = ${maskAA}`);
    return;
  }
 

  // 'O' refresh static depth once (if occluders changed)
  if (k.toLowerCase() === 'o') {
    depthCtl.refresh();
    console.log('Depth refreshed once.');
    return;
  }
});

// switching textures
function applyOverlayTexture() {
  handle.setTexture(overlayTex, renderer);
  console.log('Projector texture: overlay (canvas)');
}
function applySampleTexture() {
  if (sampleTex) {
    handle.setTexture(sampleTex, renderer);
    console.log('Projector texture: sample.jpg (cached)');
    return;
  }
  console.log('Loading sample.jpg …');
  loader.load(
    './sample.jpg',
    (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      sampleTex = tex;
      handle.setTexture(sampleTex, renderer);
      console.log('Projector texture: sample.jpg (loaded)');
    },
    undefined,
    (err) => {
      console.error('Failed to load sample.jpg', err);
      useSample = false;
      applyOverlayTexture();
    }
  );
}
