import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

export class CometView {
    static FOV;                     // set in paintComet:init according to dataset
    static defaultRes;              // set in paintComet:init according to dataset
    static MAX_COMET_WIDTH = 4.0;   // Comet does not extend beyond this distance from origin
    static EXTRA_CLIP_FAR = 400;      // this will mostly avoid clipping if we zoom out w/ trackball control, since far is not updated
    static map;     // We choose to make the map a class var because we keep the last view's map until the new one's loaded
    static decal;   // ... and same for decal
    static lastRequestedImg;  // name of the last requested image, so previous requests don't get displayed!
    static blankTexture = new THREE.Texture();
    static mgr = new THREE.LoadingManager();
    static {
        this.mgr.onProgress = (str, num, total) => {
            console.log("In LoadingManager.onProgress: Loading %s: %i/%i", str, num, total);
        }
    }
    static urlPrefix = "";
    static sMgr; // contains important methods for accessing three.js state
    constructor(photoDict, sceneMgr) {
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
 
        this.jpgPath = CometView.urlPrefix + 'J80/' + photoDict.nm.substring(1, 7) + '/' + photoDict.nm + '.jpg'
 
        this.fileName = photoDict.nm;
        this.time = photoDict.ti;
        //set random image plane it will change soon!
        this.image_plane = new THREE.Plane()
        this.image_plane.setFromNormalAndCoplanarPoint(this.normal, (this.sc_position.clone().add(this.normal.clone().multiplyScalar(30))));

        this.sceneMgr = sceneMgr;
    }

    computeViewRect () {
        this.planeCenter = this.sc_position.clone().add(this.normal.clone().setLength(this.distToPlane));
        this.imageWidth = Math.tan(Math.PI*CometView.FOV/180.0) * this.distToPlane;
        this.halfWidth = this.imageWidth/2.0;
        const midTopLineVec = this.up.clone().setLength(this.halfWidth);
        const midRightLineVec = midTopLineVec.clone().applyAxisAngle(this.normal, Math.PI/2.0);
        this.corners = [];
        this.corners.push(this.planeCenter.clone().add(midTopLineVec).sub(midRightLineVec));    // upper left
        this.corners.push(this.corners[0].clone().add(midRightLineVec).add(midRightLineVec));   // upper right
        this.corners.push(this.corners[1].clone().sub(midTopLineVec).sub(midTopLineVec));       // lower right
        this.corners.push(this.corners[2].clone().sub(midRightLineVec).sub(midRightLineVec));   // lower left
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

    applyToCamera(camera, orbControls, aspect = 0) {
        camera.fov = CometView.FOV;
        if (aspect == 0) aspect = window.innerWidth / window.innerHeight;
        camera.aspect = aspect;
        camera.near = .1;
        const scToComet = this.sc_position.clone().length();
        camera.far = scToComet + CometView.MAX_COMET_WIDTH + CometView.EXTRA_CLIP_FAR; // EXTRA_CLIP_FAR allows us to zoom out 
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
    addDecal() {
        let scene = this.sceneMgr.scene, mesh = this.sceneMgr.targetMesh;
        this.imageFresh = false;
        let view = this;
        function onDecalLoaded(texture) {
            if (CometView.lastRequestedImg != view.fileName) {
                texture.dispose();
                return;
            } 

            let oldMap = CometView.map;
            let oldDecal = CometView.decal;
            CometView.map = texture;
            const decalMaterial = new THREE.MeshPhongMaterial({
                map: CometView.map,
                transparent: true,  // what do the scientists want?
                depthTest: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: - 4
            });
            const euler = new THREE.Euler();
            const orientation = new THREE.Matrix4();
            view.imageDepthAlongNormal = view.maxDistAlongNormal - view.minDistAlongNormal;
            const lookAt = view.sc_position.clone().add((view.normal.clone().multiplyScalar(view.minDistAlongNormal+(view.imageDepthAlongNormal/2))));
            orientation.lookAt(view.sc_position, lookAt, view.up);
            euler.setFromRotationMatrix(orientation);
            const size = new THREE.Vector3(view.imageWidth, view.imageWidth, view.imageDepthAlongNormal+0.05);
            const decalGeometry = new DecalGeometry(mesh, lookAt, euler, size);
            CometView.decal = new THREE.Mesh(decalGeometry, decalMaterial); //should this be a const??
            scene.add(CometView.decal);
            view.imageFresh = true;
            // Cleanup
            if (oldDecal) {
                scene.remove(oldDecal);
                oldDecal.geometry.dispose();
                oldDecal.material.dispose();
            }
            if (oldMap) oldMap.dispose();
        }
        this.loadImage(onDecalLoaded);        // now we do it on demand
    }

    removeDecal() {
        if (CometView.decal) {
            const oldDecal = CometView.decal;
            this.sceneMgr.scene.remove(oldDecal);
            oldDecal.geometry.dispose();
            oldDecal.material.dispose();
            CometView.decal = null;
        }
     }

    addProjection () {
        let mesh = this.sceneMgr.targetMesh, material = this.sceneMgr.cometMaterial;    
        this.imageFresh = false;
        let view = this;
        function onProjectionLoaded(texture) {
            if (CometView.lastRequestedImg != view.fileName) {
                texture.dispose();
                return;
            } 

            let oldMap = CometView.map;
            CometView.map = texture;
            material.texture = texture;
            material.camera = new THREE.PerspectiveCamera();
            view.applyToCamera(material.camera, null, 1.0); // clone the current camera, but set viewing properties for image
            material.project(mesh);
            material.needsUpdate = true;
            material.texture.needsUpdate = true;
            view.imageFresh = true;

            // cleanup for oldMap
            if (oldMap) oldMap.dispose();
        }
        this.loadImage(onProjectionLoaded);        // now we do it on demand
    }

    removeProjection () {
        let material = this.sceneMgr.cometMaterial;
        if (CometView.map) {
            /*
            CometView.map.dispose();
            CometView.map = null;
            */
            material.texture = CometView.blankTexture;
            material.texture.isTextureProjected = false;
            material.needsUpdate = true;
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

    /*
    removeImageForOverlay() {
        if (CometView.map) {
            CometView.map.dispose();
            CometView.map = null;
        }
    }
    */

    removeSelf(){
        this.removeViewport();
    }

    saveExtentInfo(bbox, normDepth) {
        this.bbox = bbox;
        this.normDepth = normDepth;
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



