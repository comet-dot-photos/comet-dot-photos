import * as THREE from 'three/build/three.module.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
//import ProjectedMaterial from '../node_modules/three-projected-material/build/ProjectedMaterial.module.js';


function signedAngle(v1, v2, n) {                       // signed angle between v1 and v2. n is the normal, and should be normalized
    const cross_prod = v1.clone().cross(v2);
    const signed_cross = cross_prod.dot(n);
    const dot_prod = v1.dot(v2);
    return (Math.atan2(signed_cross, dot_prod));
}

export class CometView {
    static fov = 2.20746 //2.21;   // From .IMG header
    static center_pixel = new THREE.Vector3(1024, 1024);
    eyept;
    viewVec;
    v1;
    v1_pixel;
    v2;
    v2_pixel;
    imagePath;
    sun;
    m2;
    halfWidth;
    corners;
    viewRect = null;
    upVec;
    bbox = null;
    normDepth = null;
    planeCenter;
    name;
    map = null;
    decal = null;
    viewOutline = null;
    index;
    static mgr = new THREE.LoadingManager();
    static {
        this.mgr.onProgress = (str, num, total) => {
            console.log("In LoadingManager.onProgress: Loading %s: %i/%i", str, num, total);
        }
    }
    static MAX_COMET_WIDTH = 4.0;   // Comet does not extend beyond this distance from origin
    static EXTRA_CLIP_FAR = 400;      // this will mostly avoid clipping if we zoom out w/ trackball control, since far is not updated
    static PREPROCESSING = false;
    static cornerMaxDist = 0;
    static normalMaxDelta = 0;
    static upMaxDelta = 0;
    static cornerSumDelta = 0;
    static normalSumDelta = 0;
    static upSumDelta = 0;

    constructor(vd = viewData2, imgFormat) {
        this.eyept = new THREE.Vector3(...vd.sc);
        this.v1 = new THREE.Vector3(...vd.v1);
        this.v2 = new THREE.Vector3(...vd.v2);
        this.v1_pixel = new THREE.Vector2(...vd.s1);
        this.v2_pixel = new THREE.Vector2(...vd.s2);
        this.sun = new THREE.Vector3(...vd.su);
        this.m2 = vd.m2;
        this.name = vd.nm;
        this.imgFormat = imgFormat;
        this.index = vd.index;
        if ('d1' in vd) this.normDepth = new NormalDepth(vd.d1, vd.d2);

//        if (!CometView.PREPROCESSING)
 //           this.loadImage(imgFormat); // waste of time if preprocessing

        this.computeCometViewPre();   // Actually sets up the normal from any two points
        this.computeCometViewPost();
 //       this.computeLinearAlgebra();    // Testing for now...
        this.createViewRect();
    }

    loadImage() {
        if (this.map) this.map.dispose();   // clean up
        if (this.imgFormat === 'PNG')
            this.imagePath = '../PNG/' + this.name.substring(1, 7) + '/' + this.name + '.png'; // form: ../PNG/YEARMM/NYEARMM....png
        else if (this.imgFormat === 'J80')
            this.imagePath = '../J80/' + this.name.substring(1, 7) + '/' + this.name + '.jpg'; // form: ../J80/YEARMM/NYEARMM....jpg        
        else if (this.imgFormat === 'KTX2')
        this.imagePath = '../KTX2/' + this.name.substring(1, 7) + '/' + this.name + '.ktx2'; // form: ../KTX2/YEARMM/NYEARMM....ktx2        
        const loader = new THREE.TextureLoader(CometView.mgr, function(texture) { console.log('Load manager loaded texture: %s', texture.filename);});  // this line is needed, but loadManager argument only necessary for callback
        const startTime = performance.now();
        this.map = loader.load(this.imagePath);

        CometView.mgr.onLoad = function () {
            const endTime = performance.now();
            //console.log('Loaded texture: ' + texture.filename);     // texture defined in the closure? (!)
            console.log('Texture loading time: %f ms', endTime-startTime);
        }
    }

    computeCometViewPost () {
        const sc_to_poi_normed = this.viewVec;
        const distToPlane = this.normDepth ? this.normDepth.depthMin : 100;  // choose an arbitrary distance for the plane if normDepth not set.
        this.planeCenter = this.eyept.clone().add(sc_to_poi_normed.clone().setLength(distToPlane)); // if poi given, should be same as poi for now 
        const v1_ray = new THREE.Ray(this.eyept, this.v1);
        const plane = new THREE.Plane(sc_to_poi_normed, -sc_to_poi_normed.dot(this.planeCenter));   // 2nd arg is plane's D (using planeCenter in plane equation)
        const v1_in_plane = v1_ray.intersectPlane(plane, new THREE.Vector3());

        // Set "up" - Same rotation to bring poi->v1 to vertical (0, -1) in screen coords, is the rotation
        //   necessary to bring poi->v1 to the upVec in the world coordinates (rotated about viewing axis).

        const goalScreenVec2 = this.v1_pixel.clone().sub(CometView.center_pixel);
        var newAngle = goalScreenVec2.clone().angleTo(new THREE.Vector2(0, -1));
        if (goalScreenVec2.x < 0) newAngle = 2.0*Math.PI - newAngle;
        this.upVec = v1_in_plane.clone().sub(this.planeCenter).applyAxisAngle(sc_to_poi_normed, -newAngle);
        // console.log("UpVec = %O", this.upVec);

        this.halfWidth = Math.tan(Math.PI*(CometView.fov/2.0)/180.0) * distToPlane;
        const midTopLineVec = this.upVec.clone().setLength(this.halfWidth);
        const midRightLineVec = midTopLineVec.clone().applyAxisAngle(sc_to_poi_normed, Math.PI/2.0);
        this.corners = [];
        this.corners.push(this.planeCenter.clone().add(midTopLineVec).sub(midRightLineVec));    // upper left
        this.corners.push(this.corners[0].clone().add(midRightLineVec).add(midRightLineVec));   // upper right
        this.corners.push(this.corners[1].clone().sub(midTopLineVec).sub(midTopLineVec));       // lower right
        this.corners.push(this.corners[2].clone().sub(midRightLineVec).sub(midRightLineVec));   // lower left
    }

    computeCometViewPre() {
        const SCREENWIDTH = 2048;
        const sc_to_screen = (SCREENWIDTH/2.0) / Math.tan(((CometView.fov/2.0)*Math.PI)/180.0);
        const eyeLoc = new THREE.Vector3(SCREENWIDTH/2.0 + .5, SCREENWIDTH/2.0 + .5, -sc_to_screen);
        const v1_prime = new THREE.Vector3(this.v1_pixel.x, this.v1_pixel.y, 0.0).sub(eyeLoc);
        const v2_prime = new THREE.Vector3(this.v2_pixel.x, this.v2_pixel.y, 0.0).sub(eyeLoc);
        const v1_prime_n = v1_prime.clone().normalize();
        const v2_prime_n = v2_prime.clone().normalize();
        const dotted = v1_prime_n.dot(v2_prime_n);
        // console.log("Real vector angle is %f degrees. Screen vector angle is %f degrees.", Math.acos(this.v1.dot(this.v2)) * 180.0 / Math.PI, Math.acos(v1_prime.clone().normalize().dot(v2_prime.clone().normalize())) * 180.0 / Math.PI);
        const screen_normal = new THREE.Vector3(1024.5, 1024.5, 0).sub(eyeLoc);
        const v1_prime_v2_prime_normal_n = v1_prime_n.clone().cross(v2_prime_n).normalize();
        const normal_in_v1pXv2p = screen_normal.clone().projectOnPlane(v1_prime_v2_prime_normal_n); 
        const theta = signedAngle(normal_in_v1pXv2p, v1_prime_n, v1_prime_v2_prime_normal_n);   // signed angle between normal_in_v1pXv2P and v1_prime_n
        // check how accurate rotating back is!
        const vecBack = v1_prime_n.clone().applyAxisAngle(v1_prime_v2_prime_normal_n, -theta); 
        //const norm_dot_norm_proj = screen_normal.clone().normalize().dot(normal_in_v1pXv2p.clone().normalize);
        const prime_rho_axis_n = normal_in_v1pXv2p.clone().applyAxisAngle(v1_prime_v2_prime_normal_n, Math.PI/2.0).normalize();
        const rho = signedAngle(screen_normal, normal_in_v1pXv2p, prime_rho_axis_n); 
        const vecBack2 = normal_in_v1pXv2p.applyAxisAngle(prime_rho_axis_n ,-rho);
        //we've got rho and theta in eye/screen coordinates! now find the vector that makes these angles with the real v1Xv2 in space coords!
        // v1 = v1_prime; v2 = v2_prime;       // FOR TESTING ONLY!!! REMOVE LATER
        const v1Xv2 = this.v1.clone().cross(this.v2);
        const v1Xv2_n = v1Xv2.clone().normalize();
        const normal_in_v1Xv2 = this.v1.clone().applyAxisAngle(v1Xv2_n, -theta); 
        const rho_axis_n = normal_in_v1Xv2.clone().applyAxisAngle(v1Xv2_n, Math.PI/2.0).normalize();
        this.viewVec = normal_in_v1Xv2.clone().applyAxisAngle(rho_axis_n, -rho).normalize();       // this is the new normal! Ha!
    }

    calculateSCVector(movieVector) {
        //console.log('finding sc vector for this movie vector:', movieVector);
        const SCREENWIDTH = 2048;
        const sc_to_screen = (SCREENWIDTH/2.0) / Math.tan(((CometView.fov/2.0)*Math.PI)/180.0);
        const eyeLoc = new THREE.Vector3(SCREENWIDTH/2.0 + .5, SCREENWIDTH/2.0 + .5, -sc_to_screen);
        const movieV1 = new THREE.Vector3(this.v1_pixel.x, this.v1_pixel.y, 0.0).sub(eyeLoc).normalize(); // DJK - new normalize
        const movieV2 = new THREE.Vector3(this.v2_pixel.x, this.v2_pixel.y, 0.0).sub(eyeLoc).normalize(); // DJK - new normalize
        //create movie theatre coords
        //const eyeToScreenDist = (2048/2)/Math.tan(((2.21/2.0)*Math.PI)/180.0);
        //console.log(eyeToScreenDist);
        /* -DJK
        const movieV1 = new THREE.Vector3(photoDict.s1[0]-1024.5, photoDict.s1[1]-1024.5, 53115.2).normalize();
        const movieV2 = new THREE.Vector3(photoDict.s2[0]-1024.5, photoDict.s2[1]-1024.5, 53115.2).normalize();
        */
        // const movieV1 = new THREE.Vector3(photoDict.s1[0]-1024.5, photoDict.s1[1]-1024.5, eyeToScreenDist).normalize();
        // const movieV2 = new THREE.Vector3(photoDict.s2[0]-1024.5, photoDict.s2[1]-1024.5, eyeToScreenDist).normalize();
        const movieCross = new THREE.Vector3();
        movieCross.crossVectors(movieV1, movieV2).normalize();  /* DJK - normalize??? */
        const unitMovieVector = movieVector.clone(); /*.normalize(); /* DJK - normalize??? */
        const A = new THREE.Matrix3(movieV1.x, movieV2.x, movieCross.x, movieV1.y, movieV2.y, movieCross.y, movieV1.z, movieV2.z, movieCross.z);
        const Ainverse = A.clone().invert();
        const linearCombinations = unitMovieVector.clone().applyMatrix3(Ainverse);
        //convert back to sc coords
        const sc_cross = new THREE.Vector3();
        const v1 = this.v1.clone().normalize(); /* new normalize DJK - was new THREE.Vector3();*/
        const v2 = this.v2.clone().normalize(); /* new normalize DJK - was new THREE.Vector3(); */
        /* DJK - don't need anymore - already done ...
        v1.fromArray(photoDict.v1);
        v2.fromArray(photoDict.v2);
        */
        sc_cross.crossVectors(v1, v2).normalize();  // DJK - newly added
        const B = new THREE.Matrix3(v1.x, v2.x, sc_cross.x, v1.y, v2.y, sc_cross.y, v1.z, v2.z, sc_cross.z);
        const rval = linearCombinations.clone().applyMatrix3(B);
        //console.log('matrix test return:', testReturn.clone().normalize());
        //const returnVector = (v1.clone().multiplyScalar(linearCombinations.x)).add((v2.clone().multiplyScalar(linearCombinations.y)).add(sc_cross.clone().multiplyScalar(linearCombinations.z)));
        //console.log('old way return', returnVector.clone().normalize());
        return rval;
    }

    computeLinearAlgebra() {
        // all vectors relative to movie theater viewer and spacecraft in each coord system...
        const SCREENWIDTH = 2048;
        const movieNormal = new THREE.Vector3(0,0,1);
        const newNorm = this.calculateSCVector(movieNormal).normalize();
        const movieUp = new THREE.Vector3(0,-1,0);
        const tryUp = this.calculateSCVector(movieUp);
        const sc_to_screen = (SCREENWIDTH/2.0) / Math.tan(((CometView.fov/2.0)*Math.PI)/180.0);
        const movieTL = new THREE.Vector3(-1023.5, -1023.5, sc_to_screen);
        const top_left_dir = this.calculateSCVector(movieTL);
        const bottom_left_dir = top_left_dir.clone().applyAxisAngle(newNorm, 3*Math.PI/2);
        const up = top_left_dir.clone().sub(bottom_left_dir).normalize();
        // this.halfWidth = Math.tan(Math.PI*(CometView.fov/2.0)/180.0) * distToPlane;
        const midTopLineVec = this.upVec.clone().setLength(this.halfWidth);
        const midRightLineVec = midTopLineVec.clone().applyAxisAngle(newNorm, Math.PI/2.0);
        this.cornersDan = []
        this.cornersDan.push(this.planeCenter.clone().add(midTopLineVec).sub(midRightLineVec));    // upper left
        this.cornersDan.push(this.cornersDan[0].clone().add(midRightLineVec).add(midRightLineVec));   // upper right
        this.cornersDan.push(this.cornersDan[1].clone().sub(midTopLineVec).sub(midTopLineVec));       // lower right
        this.cornersDan.push(this.cornersDan[2].clone().sub(midRightLineVec).sub(midRightLineVec));   // lower left
/*    
        if (this.index == 3614) {
            console.log('At 3614!');
        }
*/
/*
        if (this.normDepth.depthMax == -1000000000000) {
            console.log(`No depth info: ${this.name}`);
            return;
        }
        if (this.v1_pixel.equals(this.v2_pixel)) {
            console.log(`No basis: ${this.name}`);
            return;
        }
*/
        let maxDist = 0;
        for (let i = 0; i < 4; i++) {
            const newDist = this.corners[i].clone().sub(this.cornersDan[i]).length();
            if (newDist > maxDist) maxDist = newDist;
        }
        //console.log(`maxDist = ${maxDist}`);
        if (maxDist > CometView.cornerMaxDist) {
            CometView.cornerMaxDist = maxDist;
            CometView.worstIndex = this.index;
        }
        CometView.cornerSumDelta += maxDist;
        const normalDelta = 180* Math.acos(newNorm.dot(this.viewVec))/Math.PI;
        if (normalDelta > CometView.normalMaxDelta) 
            CometView.normalMaxDelta = normalDelta;
        CometView.normalSumDelta += normalDelta;
        const upDelta = 180 * Math.acos(this.upVec.clone().normalize().dot(tryUp.clone().normalize())) / Math.PI;
        if (upDelta > CometView.upMaxDelta)
            CometView.upMaxDelta = upDelta;
        CometView.upSumDelta += upDelta;
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

    addViewOutline(scene) {
        // Add a blue view box 
        if (!CometView.PREPROCESSING) {
            if (! this.normDepth) return; 
            const lineMat = new THREE.LineBasicMaterial( { color: 0x0000ff } );
            const linepts = [...this.corners]; // copy of the corners array
            linepts.push(this.corners[0]);     // close the square
            const linegeo = new THREE.BufferGeometry().setFromPoints(linepts);
            this.viewOutline = new THREE.Line(linegeo, lineMat);
            scene.add(this.viewOutline);
        }
    }

    removeViewOutline(scene) {
        if (this.viewOutline) {
            scene.remove(this.viewOutline);
            this.viewOutline.geometry.dispose();
            this.viewOutline.material.dispose();
            this.viewOutline = null;
        }
    }

    applyToCamera(camera, orbControls) {
        camera.fov = CometView.fov;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.near = .1;
        const scToComet = this.eyept.clone().length();
        camera.far = scToComet + CometView.MAX_COMET_WIDTH + CometView.EXTRA_CLIP_FAR; // EXTRA_CLIP_FAR allows us to zoom out 
        camera.position.set(this.eyept.x, this.eyept.y, this.eyept.z);
        camera.lookAt(this.planeCenter.x, this.planeCenter.y, this.planeCenter.z);
        camera.up.set(this.upVec.x, this.upVec.y, this.upVec.z);
        camera.updateProjectionMatrix();

        orbControls.target = this.planeCenter.clone();
        orbControls.update();
    }

    // Add a decal!
    addDecal (scene, mesh, bestPt) {
        if (! this.normDepth) return; 
        if (this.decal == null) {
            //bestPt = null;  // REMOVE THIS!
            let depth, posDist;
            if (!this.map) this.loadImage();        // now we do it on demand
            const rotation = new THREE.Matrix4();
            rotation.lookAt(this.eyept, this.planeCenter, this.upVec);
            const euler = new THREE.Euler();
            euler.setFromRotationMatrix(rotation);
            if (bestPt) {
                const bestVec = bestPt.clone().sub(this.eyept)
                posDist = bestVec.dot(this.viewVec);
                depth = Math.max(this.normDepth.depthMax - posDist, posDist - this.normDepth.depthMin) *2.0;  // depth must be large enough to cover all visible points   
            } else {
                posDist = (this.normDepth.depthMin + this.normDepth.depthMax)/2.0;
                depth = this.normDepth.getDepth();
            }
            const pos = this.viewVec.clone().multiplyScalar(posDist).add(this.eyept);
            const diam = Math.tan(Math.PI*CometView.fov/180.0) * posDist;
            const TENMETERS = .01;
            const decalGeometry = new DecalGeometry(mesh, pos, euler, new THREE.Vector3(diam, diam, depth + 5*TENMETERS));
            const decalMaterial = new THREE.MeshStandardMaterial( {
                map: this.map,
                transparent: true,  // what do the scientists want?
                depthTest: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: - 4
            } );
            this.decal = new THREE.Mesh(decalGeometry, decalMaterial);
            this.decal.receiveShadow = true;
            scene.add(this.decal);
        }
    }

    removeDecal (scene) {
        if (this.decal) {
            scene.remove(this.decal);
            this.decal.geometry.dispose();
            this.decal.material.dispose();
            this.decal = null;
        }
    }

    projection = null;
    addProjection (camera, mesh, material) {
        if (! this.normDepth) return; 
        if (this.projection == null) {
            material.texture = this.map;
            material.camera = camera.clone();
            material.project(mesh);
            projection = true;
        }
    }

    updateSunLight(sunlight) {
        const nearSun = this.sun.clone().setLength(5);                     // directional at this distance
        sunlight.position.set(nearSun.x, nearSun.y, nearSun.z);  // distance set so that shadow frustrum is reasonable
    }

 
    removeProjection (material) {
        const blankTexture = new THREE.TextureLoader().load('./transparent.png');
	    material.texture = blankTexture;
	    // material.texture.isTextureProjected = false;
	    projection = null; 
    }

    clear (scene) {
        this.removeDecal(scene);
        this.removeViewOutline(scene);
    }

    dispose() {             // probably should dispose of more, but this is the bare minimum
        if (this.map) {
            this.map.dispose();   
            this.map = null;
        }
        if (this.decal) {
            this.decal.geometry.dispose();
            this.decal.material.dispose();
            this.decal.dispose();
            this.decal = null;
        }
        if (this.viewOutline) {
            this.viewOutline.geometry.dispose();
            this.viewOutline.material.dispose();
            this.viewOutline = null;
        }
        if (this.viewRect) {
            this.viewRect.geometry.dispose();
            this.viewRect.material.dispose();
            this.viewRect = null;
        }
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
//    normal;

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

console.log("Done loading cometUtils!!");
