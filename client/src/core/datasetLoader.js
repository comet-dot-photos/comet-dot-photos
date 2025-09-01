// core/datasetLoader.js
import * as THREE from 'three';
import { OBJLoader2 } from 'wwobjloader2';
import ProjectedMaterial from 'three-projected-material';
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
  ROI.allocatePaintBuffer(geom.attributes.position.count, colorArray);

  // Material + mesh
  const mat = new ProjectedMaterial({
    cover: false,
    color: COMETCOLOR,
    transparent: false,
    opacity: 1.0,
    vertexColors: true,
    flatShading: sceneMgr.state['flatShading'],
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.geometry.computeBoundsTree();

  // Save references on sceneMgr (matches your current design)
  sceneMgr.cometGeometry = geom;
  sceneMgr.colorArray = colorArray;
  sceneMgr.colorAttr = colorAttr;
  sceneMgr.cometMaterial = mat;
  sceneMgr.targetMesh = mesh;

  sceneMgr.scene.add(mesh);
}

/** Fetch and return the parsed metadata JSON (startable immediately) */
export async function loadMetadata(dataset) {
  const url = dataset.dataFolder + dataset.metaData;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.json();
}