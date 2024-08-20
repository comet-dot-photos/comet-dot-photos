import * as THREE from './node_modules/three/build/three.module.js'; //should be good
import {DecalGeometry} from './node_modules/three/examples/jsm/geometries/DecalGeometry.js';

export class CometInfo {
    static FOV = 2.20746; //Based on campt results - 2.21 in .IMG header
    static MAX_COMET_WIDTH = 4.0;   // Comet does not extend beyond this distance from origin
    static EXTRA_CLIP_FAR = 400;      // this will mostly avoid clipping if we zoom out w/ trackball control, since far is not updated
    
    constructor(photoDict) {
        this.decalOn = false;
        this.line = null;
        this.sc_position = new THREE.Vector3();
        this.sc_position.fromArray(photoDict.sc);
        this.minDistAlongNormal = photoDict.d1;
        this.maxDistAlongNormal = photoDict.d2;
        this.ogIndex = photoDict.ogIndex;

        const movieTL = new THREE.Vector3(-1023.5, -1023.5, 53115.2);
        this.top_left_dir = this.calculateSCVector(movieTL, photoDict);
        //console.log('top_left_dir', this.top_left_dir);
        const movieNormal = new THREE.Vector3(0,0,1);
        this.normal = this.calculateSCVector(movieNormal, photoDict);
        //console.log('normal', this.normal)
        //console.log('angle from tl to normal:', this.top_left_dir.angleTo(this.normal)*180/Math.PI);
        const movieUp = new THREE.Vector3(0,-1,0);
        const tryUp = this.calculateSCVector(movieUp, photoDict);
        //console.log('tryUp:', tryUp);
        //console.log('angle from tryUp to normal', this.normal.angleTo(tryUp)*180/Math.PI);
        this.top_right_dir = this.top_left_dir.clone().applyAxisAngle(this.normal, Math.PI/2); 
        this.bottom_right_dir = this.top_left_dir.clone().applyAxisAngle(this.normal, Math.PI);
        this.bottom_left_dir = this.top_left_dir.clone().applyAxisAngle(this.normal, 3*Math.PI/2);
        
        this.tag = photoDict.nm;
    
        this.jpgPath = '../../J80/' + photoDict.nm.substring(1, 7) + '/' + photoDict.nm + '.jpg'
        //console.log('checking jpgPath: ', this.jpgPath);   

        this.fileName = photoDict.nm;
        this.time = photoDict.ti;
        //set random image plane it will change soon!
        this.image_plane = new THREE.Plane()
        this.image_plane.setFromNormalAndCoplanarPoint(this.normal, (this.sc_position.clone().add(this.normal.clone().multiplyScalar(30))));
        
    }
    setCornerArray() {
        this.cornerArray = this.getViewSquare();
        //console.log('corners', this.cornerArray);
        this.imageWidth = (this.cornerArray[0].clone().sub(this.cornerArray[1])).length();
        //console.log('this.imageWidth', this.imageWidth);
        this.up = this.cornerArray[0].clone().sub(this.cornerArray[3]).normalize();
        //console.log('this.up', this.up)
        this.image_plane.setFromCoplanarPoints(this.cornerArray[0], this.cornerArray[1], this.cornerArray[2]);
    }
    calculateSCVector(movieVector, photoDict) {
        //console.log('finding sc vector for this movie vector:', movieVector);
        //create movie theatre coords
        //const eyeToScreenDist = (2048/2)/Math.tan(((2.21/2.0)*Math.PI)/180.0);
        //console.log(eyeToScreenDist);
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
    setMinDistAlongNormal(x) {
        this.minDistAlongNormal = x;
        //console.log(this.minDistAlongNormal)
    }
    setMaxDistAlongNormal(x) {
        this.maxDistAlongNormal = x;
        //console.log(this.maxDistAlongNormal)
    }
    setUp(x) {
        this.up = x.clone();
    }
    getViewSquare() {
        // console.log('confirm if ~1.543522: ', 180*this.normal.angleTo(this.top_left_dir)/Math.PI);
        //const lengthToCorner = this.minDistAlongNormal*Math.sin(1.543521962087762); //this should be the angle in radians of normal to corner??? 88 degrees
        const lengthToCorner = this.minDistAlongNormal/Math.sin(1.56270598642);
        // console.log('minDistAlongNormal', this.minDistAlongNormal);
        // console.log('lengthToCorner', lengthToCorner);
        // console.log('sc', this.sc_position);
        // console.log('tl_dir', this.top_left_dir);
        // console.log('anglebtwnormaltl', this.top_left_dir.angleTo(this.normal));
        const tl_corner = this.sc_position.clone().add(this.top_left_dir.clone().multiplyScalar(lengthToCorner));
        const tr_corner = this.sc_position.clone().add(this.top_right_dir.clone().multiplyScalar(lengthToCorner));
        const bl_corner = this.sc_position.clone().add(this.bottom_left_dir.clone().multiplyScalar(lengthToCorner));
        const br_corner = this.sc_position.clone().add(this.bottom_right_dir.clone().multiplyScalar(lengthToCorner));
        return [tl_corner, tr_corner, br_corner, bl_corner, tl_corner];
    }
    addOutline(scene) {
        const lineMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});
        const squareGeometry = new THREE.BufferGeometry().setFromPoints(this.cornerArray);
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
    applyDecal(scene, mesh) {
        this.imageDepthAlongNormal = this.maxDistAlongNormal - this.minDistAlongNormal;
        const textureLoader = new THREE.TextureLoader();
		this.photoDecal = textureLoader.load(this.jpgPath);
        const decalMaterial = new THREE.MeshPhongMaterial({
            map: this.photoDecal,
            transparent: true,  // what do the scientists want?
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: - 4
        });
        const euler = new THREE.Euler();
        const orientation = new THREE.Matrix4();
        const lookAt = this.sc_position.clone().add((this.normal.clone().multiplyScalar(this.minDistAlongNormal+(this.imageDepthAlongNormal/2))));
        orientation.lookAt(this.sc_position, lookAt, this.up);
        euler.setFromRotationMatrix(orientation);
        const size = new THREE.Vector3(this.imageWidth, this.imageWidth, this.imageDepthAlongNormal+0.05);
        const decalGeometry = new DecalGeometry(mesh, lookAt, euler, size);
        //console.log('decalGeo:', decalGeometry);
        this.decal = new THREE.Mesh(decalGeometry, decalMaterial); //should this be a const??
        scene.add(this.decal);
        this.decalOn = true;
        //console.log('turned on the decal');
        //console.log('minDist', this.minDistAlongNormal);
        //console.log('corners', this.cornerArray);
    }
    applyToCamera(camera, controls) {
        camera.fov = CometInfo.FOV;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.near = .1;
        const scToComet = this.sc_position.clone().length();
        camera.far = scToComet + CometInfo.MAX_COMET_WIDTH + CometInfo.EXTRA_CLIP_FAR; // EXTRA_CLIP_FAR allows us to zoom out 
        camera.position.set(this.sc_position.x, this.sc_position.y, this.sc_position.z);
        const lookPoint = this.sc_position.clone().add(this.normal.clone().setLength(this.minDistAlongNormal)); // look from spacecraft to the point along the view normal, minDist from the spacecraft
        camera.lookAt(lookPoint.x, lookPoint.y, lookPoint.z);
        camera.up.set(this.up.x, this.up.y, this.up.z);
        camera.updateProjectionMatrix();

        controls.target = lookPoint;
        controls.update();
    }
    removeDecal(scene) {
        if (this.decalOn) {
            //console.log('removing decal')
            //console.log(this.decal)
            scene.remove(this.decal);
            this.photoDecal.dispose();      // must dispose of unused textures
            this.decal.geometry.dispose();  // must dispose of unused geometries
            this.decal.material.dispose();  // muse dispose of unused materials
            this.decalOn = false;
        }
    }
    removeSelf(scene){
        if (this.decalOn){ this.removeDecal(scene);}
        //console.log('removeSelf() called');
        this.removeOutline(scene);
    }
}



