// core/datasetLoader.js -
//    Functions to load comet model and metadata for a given dataset.

import * as THREE from 'three';
import { OBJLoader2 } from 'wwobjloader2';
import { CometView } from '../view/CometView.js';
import { wrapMaterialWithProjector, makeProjectorDepthRT} from '../utils/ProjectedImages.js';
import { COMETGREYVAL, COMETCOLOR } from '../core/constants.js'; 

function loadOBJ(url) {
  return new Promise((resolve, reject) => {
    const loader = new OBJLoader2().setUseIndices(true);
    loader.load(url, resolve, undefined, reject);
  });
}

/**
 * Kick off the comet model load and attach it when ready.
 * Returns a Promise which can be ignored OR await later if needed.
 * Safe to call multiple times; it no-ops if already present or in-progress.
 */
export async function loadCometModel(sceneMgr, ROI, dataset) {
  if (sceneMgr.targetMesh) return; // already attached
  const filename = dataset.modelFolder + dataset.model;

  const object3d = await loadOBJ(filename);

  // Build geometry + color buffer
  const geom = object3d.children[0].geometry;
  geom.computeVertexNormals();

  const colorArray = new Uint8Array(geom.attributes.position.count * 3);
  colorArray.fill(COMETGREYVAL);
  const colorAttr = new THREE.BufferAttribute(colorArray, 3, true);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('color', colorAttr);

  // Hook up ROI paint buffer
  // note in some rare cases, nVerts > geom.attributes.position.count, thanks to ObjLoader2 quirks or unused vertices in model or collapsed vertices.
  ROI.allocatePaintBuffer(dataset.nVerts, colorArray); 

  // Material + mesh
  const mat = new THREE.MeshStandardMaterial({
    color: COMETCOLOR,
    roughness: 1.0,
    metalness: 0,
    vertexColors: true,
    flatShading: sceneMgr.state['flatShading']
  });

  // 1 Wrap ONCE (no camera/texture yet). Start crisp by default.
  const handle = wrapMaterialWithProjector(mat, null, null, {
    renderer: sceneMgr.renderer,
    maskAA: 0.0,      // 0 = off (crisp edge); can be changed later
    edgeSoft: 0.0,    // 0 = no feather; can be changed later
   });

  // 2 Create ONE reusable depth render target, attach it, and enable masking.
  let depthRT = makeProjectorDepthRT(sceneMgr.renderer, 1024, 1024); // baseline size; we’ll resize per camera
  handle.setDepthTexture(depthRT.texture);
  handle.enableDepthMask(0.05); // increase to ~0.002–0.003 if acne effects .0025
  handle.setDepthRenderTarget(depthRT);

  const mesh = new THREE.Mesh(geom, mat);
  mesh.geometry.computeBoundsTree();

  // Save references on sceneMgr
  sceneMgr.installCometInfo({geom, colorArray, colorAttr, mat, mesh});

  // Save projector handle and mesh radius for later use
  mesh.geometry.computeBoundingSphere();
  CometView.installCometInfo(handle, mesh.geometry.boundingSphere.radius);
}

/** Fetch and return the parsed metadata JSON (startable immediately) */
export async function loadMetadata(dataset) {
  const url = dataset.dataFolder + dataset.metaData;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.json();
}