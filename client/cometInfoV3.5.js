import * as THREE from './node_modules/three/build/three.module.js'; //should be good
import {DecalGeometry} from './node_modules/three/examples/jsm/geometries/DecalGeometry.js';

export class CometInfo {
    static FOV = 2.20746; //Based on campt results - 2.21 in .IMG header
    static defaultRes = 2048;
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
    constructor(photoDict) {
        this.line = null;
        this.sc_position = new THREE.Vector3();
        this.sc_position.fromArray(photoDict.sc);
        this.minDistAlongNormal = photoDict.d1;
        this.maxDistAlongNormal = photoDict.d2;
        this.distToPlane = this.minDistAlongNormal; // Have this over above nearest point - formerly (this.minDistAlongNormal + this.maxDistAlongNormal) / 2.0;
        this.ogIndex = photoDict.ogIndex;
        this.imageRes = ('rz' in photoDict) ? photoDict.rz : CometInfo.defaultRes;
   
        this.normal = new THREE.Vector3(...photoDict.cv);
        this.up = new THREE.Vector3(...photoDict.up);
        this.computeViewRect();
 
        this.tag = photoDict.nm;
        this.jpgPath = CometInfo.urlPrefix + 'J80/' + photoDict.nm.substring(1, 7) + '/' + photoDict.nm + '.jpg'
 
        this.fileName = photoDict.nm;
        this.time = photoDict.ti;
        //set random image plane it will change soon!
        this.image_plane = new THREE.Plane()
        this.image_plane.setFromNormalAndCoplanarPoint(this.normal, (this.sc_position.clone().add(this.normal.clone().multiplyScalar(30))));
    }

    computeViewRect () {
        this.planeCenter = this.sc_position.clone().add(this.normal.clone().setLength(this.distToPlane));
        this.imageWidth = Math.tan(Math.PI*CometInfo.FOV/180.0) * this.distToPlane;
        this.halfWidth = this.imageWidth/2.0;
        const midTopLineVec = this.up.clone().setLength(this.halfWidth);
        const midRightLineVec = midTopLineVec.clone().applyAxisAngle(this.normal, Math.PI/2.0);
        this.corners = [];
        this.corners.push(this.planeCenter.clone().add(midTopLineVec).sub(midRightLineVec));    // upper left
        this.corners.push(this.corners[0].clone().add(midRightLineVec).add(midRightLineVec));   // upper right
        this.corners.push(this.corners[1].clone().sub(midTopLineVec).sub(midTopLineVec));       // lower right
        this.corners.push(this.corners[2].clone().sub(midRightLineVec).sub(midRightLineVec));   // lower left
    }

/* // MOVED TO PREPROCESSING
    calculateSCVector(movieVector, photoDict) {
        //console.log('finding sc vector for this movie vector:', movieVector);
        //create movie theatre coords
        //const eyeToScreenDist = (2048/2)/Math.tan(((2.21/2.0)*Math.PI)/180.0);
        //console.log("eyeToScreenDist = %f", eyeToScreenDist);
        const movieV1 = new THREE.Vector3(photoDict.s1[0]-1024.5, photoDict.s1[1]-1024.5, 53115.2).normalize();
        const movieV2 = new THREE.Vector3(photoDict.s2[0]-1024.5, photoDict.s2[1]-1024.5, 53115.2).normalize();
        // const movieV1 = new THREE.Vector3(photoDict.s1[0]-1024.5, photoDict.s1[1]-1024.5, eyeToScreenDist).normalize();
        // const movieV2 = new THREE.Vector3(photoDict.s2[0]-1024.5, photoDict.s2[1]-1024.5, eyeToScreenDist).normalize();
        const movieCross = new THREE.Vector3();
        movieCross.crossVectors(movieV1, movieV2).normalize();
        const unitMovieVector = movieVector.clone().normalize();
        const A = new THREE.Matrix3(movieV1.x, movieV2.x, movieCross.x, movieV1.y, movieV2.y, movieCross.y, movieV1.z, movieV2.z, movieCross.z);
        const Ainverse = A.clone().invert();
        const linearCombinations = unitMovieVector.clone().applyMatrix3(Ainverse);
        //convert back to sc coords
        const sc_cross = new THREE.Vector3();
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        v1.fromArray(photoDict.v1).normalize(); //.nomalize() new for three lines here and below
        v2.fromArray(photoDict.v2).normalize();
        sc_cross.crossVectors(v1, v2).normalize();
        const B = new THREE.Matrix3(v1.x, v2.x, sc_cross.x, v1.y, v2.y, sc_cross.y, v1.z, v2.z, sc_cross.z);
        const testReturn = linearCombinations.clone().applyMatrix3(B);
        return testReturn;
    }
*/

    loadImage(onLoadFunc) {
        CometInfo.lastRequestedImg = this.name;
        const loader = new THREE.TextureLoader(CometInfo.mgr, function(texture) { console.log('Load manager loaded texture: %s', texture.filename);});  // this line is needed, but loadManager argument only necessary for callback
        const startTime = performance.now();
        loader.load(this.jpgPath, onLoadFunc);

        CometInfo.mgr.onLoad = function () {
            const endTime = performance.now();
            console.log('Texture loading time: %f ms', endTime-startTime);
        }
    }

    applyToCamera(camera, orbControls, aspect = 0) {
        camera.fov = CometInfo.FOV;
        if (aspect == 0) aspect = window.innerWidth / window.innerHeight;
        camera.aspect = aspect;
        camera.near = .1;
        const scToComet = this.sc_position.clone().length();
        camera.far = scToComet + CometInfo.MAX_COMET_WIDTH + CometInfo.EXTRA_CLIP_FAR; // EXTRA_CLIP_FAR allows us to zoom out 
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
    addOutline(scene) {
        const lineMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});
        const linepts = [...this.corners]; // copy of the corners array
        linepts.push(this.corners[0]);     // close the square
        const squareGeometry = new THREE.BufferGeometry().setFromPoints(linepts);
        this.line = new THREE.Line(squareGeometry, lineMaterial);
        scene.add(this.line);
    }
    removeOutline(scene) {
        if (this.line) {
            scene.remove(this.line);
            this.line.material.dispose();
            this.line.geometry.dispose();
            this.line = null;
        }
    }
    addDecal(scene, mesh) {
        this.imageFresh = false;
        let view = this;
        function onDecalLoaded(texture) {
            if (CometInfo.lastRequestedImg != view.name) {
                texture.dispose();
                return;
            } 

            let oldMap = CometInfo.map;
            let oldDecal = CometInfo.decal;
            CometInfo.map = texture;
            const decalMaterial = new THREE.MeshPhongMaterial({
                map: CometInfo.map,
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
            CometInfo.decal = new THREE.Mesh(decalGeometry, decalMaterial); //should this be a const??
            scene.add(CometInfo.decal);
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

    removeDecal(scene) {
        if (CometInfo.decal) {
            const oldDecal = CometInfo.decal;
            scene.remove(oldDecal);
            oldDecal.geometry.dispose();
            oldDecal.material.dispose();
            CometInfo.decal = null;
        }
     }

    addProjection (mesh, material) {
        this.imageFresh = false;
        let view = this;
        function onProjectionLoaded(texture) {
            if (CometInfo.lastRequestedImg != view.name) {
                texture.dispose();
                return;
            } 

            let oldMap = CometInfo.map;
            CometInfo.map = texture;
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

    removeProjection (material) {
        if (CometInfo.map) {
            /*
            CometInfo.map.dispose();
            CometInfo.map = null;
            */
            material.texture = CometInfo.blankTexture;
            material.texture.isTextureProjected = false;
            material.needsUpdate = true;
        }
      }

      LoadImageForOverlay(overlayCanvas) {
        let view = this;
        this.imageFresh = false;
        function onOverlayImageLoaded(texture) {
            if (CometInfo.lastRequestedImg != view.name) {
                texture.dispose();
                return;
            }

            const oldMap = CometInfo.map;
            CometInfo.map = texture;
            view.imageFresh = true;

            // cleanup for oldMap
            if (oldMap) oldMap.dispose();
        }
        this.loadImage(onOverlayImageLoaded);        // now we do it on demand
    }

    removeImageForOverlay() {
        /*
        if (CometInfo.map) {
            CometInfo.map.dispose();
            CometInfo.map = null;
        }
        */
    }

    removeSelf(scene){
        this.removeOutline(scene);
    }
}



