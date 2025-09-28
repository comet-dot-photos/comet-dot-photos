import * as THREE from 'three';
import { renderProjectorDepth } from '../utils/ProjectedImages.js';

export class CometView {
    static xFOV;                    // set via setContstants
    static yFOV;                    // set via setContstants
    static aspect;                  // set via setContstants
    static defaultRes;              // set via setContstants
    static urlPrefix = "";          // set via setContstants
    static EXTRA_CLIP_FAR = 400;      // this will mostly avoid clipping if we zoom out w/ trackball control, since far is not updated
    static map;     // We choose to make the map a class var because we keep the last view's map until the new one's loaded
    static lastRequestedImg;  // name of the last requested image, so previous requests don't get displayed!
    static blankTexture = new THREE.Texture();
    static mgr = new THREE.LoadingManager();
    static {
        this.mgr.onProgress = (str, num, total) => {
            console.log("In LoadingManager.onProgress: Loading %s: %i/%i", str, num, total);
        }
    }
    static projectorHandle; // handle for projector material, set in loadCometModel
    static radiusUB;        // upperbound for the object radius (used for setting near/far)

    constructor(photoDict, sceneMgr) {
        // set statics that are now in the photoDict's dataset
        CometView.xFOV = photoDict.dataset.xFOV;
        CometView.yFOV = photoDict.dataset.yFOV;
        CometView.defaultRes = photoDict.dataset.defaultRes;
        CometView.urlPrefix = photoDict.dataset.dataFolder + photoDict.dataset.imgFolder;
        // cache away aspect - use half-angles
        const xr = THREE.MathUtils.degToRad(CometView.xFOV) * 0.5;
        const yr = THREE.MathUtils.degToRad(CometView.yFOV) * 0.5;
        CometView.aspect = Math.tan(xr) / Math.tan(yr);

        this.line = null;
        this.sc_position = new THREE.Vector3();
        this.sc_position.fromArray(photoDict.sc);
        this.minDistAlongNormal = photoDict.d1 ?? 100;  // During preprocessing, we don't know d1, so it to an arbitrary value (necessary for computeViewRect).
        this.maxDistAlongNormal = photoDict.d2;
        this.distToPlane = this.minDistAlongNormal; // Have this over above nearest point - formerly (this.minDistAlongNormal + this.maxDistAlongNormal) / 2.0;
        this.ogIndex = photoDict.ogIndex;
        this.imageRes = ('rz' in photoDict) ? photoDict.rz : CometView.defaultRes;
   
        this.normal = new THREE.Vector3(...photoDict.cv);
        this.up = new THREE.Vector3(...photoDict.up);
        this.computeViewRect();
 
        const YYYYMM = photoDict.nm.match(/(\d{6})\d{2}T/)?.[1] || "unknown"; // extract YYYYMM from filename
        this.jpgPath = CometView.urlPrefix + YYYYMM + '/' + photoDict.nm + '.jpg'
 
        this.fileName = photoDict.nm;
        this.time = photoDict.ti;
        //set random image plane it will change soon!
        this.image_plane = new THREE.Plane()
        this.image_plane.setFromNormalAndCoplanarPoint(this.normal, (this.sc_position.clone().add(this.normal.clone().multiplyScalar(30))));

        this.sceneMgr = sceneMgr;
    }


    computeViewRect () {
        this.planeCenter = this.sc_position.clone().add(this.normal.clone().setLength(this.distToPlane));
        const xr = THREE.MathUtils.degToRad(CometView.xFOV) * 0.5;
        const yr = THREE.MathUtils.degToRad(CometView.yFOV) * 0.5;
        const halfWidth = this.distToPlane * Math.tan(xr);
        const halfHeight = this.distToPlane * Math.tan(yr);
        this.imageWidth = 2*halfWidth;
        this.imageHeight = 2*halfHeight;

        const upVec = this.up.clone().setLength(halfHeight);
        const right = this.normal.clone().cross(this.up).setLength(halfWidth);
        const c = this.planeCenter;
        this.corners = [
            c.clone().add(upVec).sub(right), // UL
            c.clone().add(upVec).add(right), // UR
            c.clone().sub(upVec).add(right), // LR
            c.clone().sub(upVec).sub(right), // LL 
        ];
    }

    createViewRect() {
        const geom = new THREE.BufferGeometry();
        const vertices = new Float32Array( [
            this.corners[0].x, this.corners[0].y, this.corners[0].z,
            this.corners[1].x, this.corners[1].y, this.corners[1].z,
            this.corners[2].x, this.corners[2].y, this.corners[2].z,
            this.corners[3].x, this.corners[3].y, this.corners[3].z,
        ]);
        geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const index = new Uint16Array( [0, 3, 1,   1, 3, 2]);  // two CCW triangles
        geom.setIndex(new THREE.BufferAttribute(index, 1));
        this.viewRect = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    }

    loadImage(onLoadFunc) {
        CometView.lastRequestedImg = this.fileName;
        const loader = new THREE.TextureLoader(CometView.mgr, function(texture) { console.log('Load manager loaded texture: %s', texture.filename);});  // this line is needed, but loadManager argument only necessary for callback
        const startTime = performance.now();
        loader.load(this.jpgPath, onLoadFunc);

        CometView.mgr.onLoad = function () {
            const endTime = performance.now();
            console.log('Texture loading time: %f ms', endTime-startTime);
        }
    }

    applyToCamera(camera, orbControls, aspect = 0, projCam = false) {
        camera.fov = CometView.yFOV;
        aspect = (aspect != 0) ? aspect : window.innerWidth / window.innerHeight; 
        if (projCam) {            // need a tight near/far pair for proj depth buffer
            const padding = .1;   // .1 km should be sufficient padding
            camera.near = this.minDistAlongNormal - padding;
            camera.far = this.minDistAlongNormal + (2 * CometView.radiusUB) + padding
        } else {
            camera.near = .1;
            // EXTRA_CLIP_FAR allows us to zoom out 
            camera.far = this.minDistAlongNormal + (2* CometView.radiusUB) + CometView.EXTRA_CLIP_FAR;
        }
        camera.position.set(this.sc_position.x, this.sc_position.y, this.sc_position.z);
        camera.up.set(this.up.x, this.up.y, this.up.z);
        camera.lookAt(this.planeCenter.x, this.planeCenter.y, this.planeCenter.z);
        camera.updateProjectionMatrix();
        camera.updateWorldMatrix(true, false);

        if (orbControls) {
            orbControls.target = this.planeCenter.clone();
            orbControls.update();
        }
    }

    setMinDistAlongNormal(x) {
        this.minDistAlongNormal = x;
    }
    setMaxDistAlongNormal(x) {
        this.maxDistAlongNormal = x;
    }
    setUp(x) {
        this.up = x.clone();
    }

    addViewport() {
        const lineMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});
        const linepts = [...this.corners]; // copy of the corners array
        linepts.push(this.corners[0]);     // close the square
        const squareGeometry = new THREE.BufferGeometry().setFromPoints(linepts);
        this.line = new THREE.Line(squareGeometry, lineMaterial);
        this.sceneMgr.scene.add(this.line);
    }

    removeViewport() {
        if (this.line) {
            this.sceneMgr.scene.remove(this.line);
            this.line.material.dispose();
            this.line.geometry.dispose();
            this.line = null;
        }
    }

    addProjection () {
        this.imageFresh = false;
        let view = this;
        function onProjectionLoaded(texture) {
            if (CometView.lastRequestedImg != view.fileName) {
                texture.dispose();
                return;
            } 

            let oldMap = CometView.map;
            CometView.map = texture;
            view._projCam ||= new THREE.PerspectiveCamera();  // only allocate the first time
            const cam = view._projCam;
            view.applyToCamera(cam, null, CometView.aspect, true); // clone the current camera, but set viewing properties for image
            view.applyProjection(cam, texture);
            view.imageFresh = true;

            // cleanup for oldMap
            if (oldMap) oldMap.dispose();
        }
        this.loadImage(onProjectionLoaded);        // now we do it on demand
    }

    /**
     * applyProjection - helper function for addProjection
     * cam: a fully configured THREE.Camera for this image
     * tex: THREE.Texture for the image
     */
    applyProjection(cam, tex) {
        const handle = CometView.projectorHandle;
        const depthRT = handle.getDepthRenderTarget();
        const {renderer, scene} = this.sceneMgr;

        // 1) Give the projector this camera and update PV
        handle.setCamera(cam);
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld(true);
        handle.update();

        // 2) Make depthRT match the camera’s aspect, then render the mask once
        const W = 1024; // choose 1024 or 2048; higher = cleaner edges, more GPU
        const H = Math.max(1, Math.round(W / Math.max(1e-6, cam.aspect))); // camera drives aspect
        depthRT.setSize(W, H);
        renderProjectorDepth(renderer, scene, cam, depthRT);

        // 3) Bind the texture and show it
        tex.colorSpace = THREE.SRGBColorSpace; // keeps brightness faithful
        handle.setTexture(tex, renderer);
        handle.enable(); // setBlend(1)
    }

    removeProjection () {
        if (CometView.map) {
            const handle = CometView.projectorHandle;
            handle.disable();   // blend -> 0 (no projection)
            handle.setTexture(null);
        }
      }

    LoadImageForOverlay(overlayCanvas) {
        let view = this;
        this.imageFresh = false;
        function onOverlayImageLoaded(texture) {
            if (CometView.lastRequestedImg != view.fileName) {
                texture.dispose();
                return;
            }

            const oldMap = CometView.map;
            CometView.map = texture;
            view.imageFresh = true;

            // cleanup for oldMap
            if (oldMap) oldMap.dispose();
        }
        this.loadImage(onOverlayImageLoaded);        // now we do it on demand
    }

    removeSelf(){
        this.removeViewport();
    }

    saveExtentInfo(bbox, normDepth) {
        this.bbox = bbox;
        this.normDepth = normDepth;
    }

    static installCometInfo (handle, radius) {    // called when loading model
        CometView.projectorHandle = handle;
        CometView.radiusUB = radius;
    }
}

const LARGENUMBER = 1.0e12;     // good enough for our scenes

export class NormalDepth {
    depthMin;
    depthMax;

    constructor(min = LARGENUMBER, max = -LARGENUMBER) {
        this.depthMin = min;
        this.depthMax = max;
    }

    expandByVector(vect, norm) {        // normal must be pre-normalized
        const dotProd = vect.dot(norm);
        if (dotProd < this.depthMin) this.depthMin = dotProd;
        if (dotProd > this.depthMax) this.depthMax = dotProd;
    }

    getDepth() {
        return (this.depthMax - this.depthMin);
    }
}



