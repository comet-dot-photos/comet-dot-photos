// core/SceneManager.js -
//   This object is responsible for the graphics rendering in the main canvas.
//   It uses three.js to set up a scene with a camera, lights, 3D comet model,
//   and trackball control for exploring the comet model. It also has the render
//   loop that is executed every frame.

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { CometView } from '../view/CometView.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, CONTAINED, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import { COMETGREYVAL, SI_NONE, SI_UNMAPPED, SI_ORTHOGRAPHIC, PAINT_RED, PAINT_GREEN, PAINT_BLUE } from '../core/constants.js';

// CONSTANTS!
// Specify Colors
const BRUSH_COLOR = 0xEC407A; // color of brush sphere
const COR_COLOR = 0x007090; // color of center of rotation sphere

export class SceneManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ fov?:number, near?:number, far?:number, initialEye?:[number,number,number] }} options
   */


  constructor(bus, state, overlay, options = {}) {
    this.bus = bus; // Event bus for cross-component communication
    this.state = state;
    this.overlay = overlay;  
    this.overlay.getOverlayCam = this.getOverlayCam.bind(this); // allow overlay to get spacecraftCam
    this.overlay.visiblePaintedVertices = this.visiblePaintedVertices.bind(this); // allow overlay to get visible painted vertices 
    this.setHaltCircle = (b) => this.overlay.setHaltCircle(b);  

    //clock - used for benchmarking
    this.state['clock'] = new THREE.Clock();

    // renderer setup
    const bgColor = 0x263238 / 2;
    const threeCanvas = document.getElementById('threeCanvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(bgColor, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    // Enable BVH for raycasting
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
    THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
    
    // scene setup
    this.scene = new THREE.Scene();
    const light1 = new THREE.DirectionalLight(0xffffff, 0.5);
    light1.position.set(1, 1, 1);
    const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
    light2.position.set(-1, -1, -1);
    this.scene.add(light1);
    this.scene.add(light2);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    
	this.createAxes(); 	//ADD AXES

	const brushGeometry = new THREE.SphereGeometry(1, 40, 40);
	const brushMaterial = new THREE.MeshStandardMaterial({
		color: BRUSH_COLOR,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		opacity: 0.5,
		premultipliedAlpha: true,
		emissive: BRUSH_COLOR,
		emissiveIntensity: 0.5,
	});
	this.brushMesh = new THREE.Mesh(brushGeometry, brushMaterial);
	this.brushMesh.visible = false;
    this.setBrushMeshSize(this.state['brushSize']);
	this.scene.add(this.brushMesh);

	const CORGeometry = new THREE.SphereGeometry(.05, 40, 40);
	const CORMaterial = new THREE.MeshStandardMaterial({
		color: COR_COLOR,
		roughness: 0.75,
		metalness: 0,
		transparent: true,
		opacity: .5,
		premultipliedAlpha: true,
		emissive: COR_COLOR,
		emissiveIntensity: 1.0, //0.5,
	});
	this.CORMesh = new THREE.Mesh(CORGeometry, CORMaterial);
	this.CORMesh.visible = false;
	this.scene.add(this.CORMesh);

	//camera setup
	this.camera = new THREE.PerspectiveCamera(options.fov, window.innerWidth / window.innerHeight, 0.1, 500);
	this.camera.position.set(...options.initialEye);
	this.camera.updateProjectionMatrix();

    // trackball controls setup
    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
	this.controls.rotateSpeed = 4;
	this.controls.zoomSpeed = 4;
	this.controls.panSpeed = 0.05;
	this.controls.staticMoving = true;
	this.controls.maxDistance = 490;

	this.controls.addEventListener('change', (event) => {
		this.updateCameraClipping();
		this.CORMesh.position.copy(this.controls.target);
	});

    // show CORMesh during trackball interaction
    this.controls.addEventListener('start', () => {
        this.CORMesh.visible = true;
    });

    this.controls.addEventListener('end', () => {
        this.CORMesh.visible = false;
    });

    this.shiftCamera(this.camera);  // shift camera to account for GUI panel

	// stats setup
	this.stats = new Stats();
	document.body.appendChild(this.stats.dom);
 
    // add event listener vals
    this.t0COR = -1;
    this.intervalCOR = 1

    // add event listeners
    window.addEventListener('resize', () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    
        this.overlay.overlayResize();

        this.shiftCamera(this.camera);
    
        if (this.state['showImage'] != SI_NONE)
            this.overlayNeedsUpdate();
    }, false);
	

    this.renderLoop = this.renderLoop.bind(this); // So doesn't lose context when executed outside of its object
    }

    overlayNeedsUpdate() {
        this.overlay.overlayNeedsUpdate();
    }

    animateCOR() {		// animates the COR and sets visibility
        if (this.t0COR >= 0) {
            this.setHaltCircle(true);
            const deltaT = this.state.clock.getElapsedTime() - this.t0COR;
            const percentComplete = Math.min(deltaT / this.intervalCOR, 1);
            const thisCOR = this.oldCOR.clone().add(this.deltaCOR.clone().multiplyScalar(percentComplete));
            this.controls.target = thisCOR;
            this.controls.update();
            this.updateCameraClipping();
            if (percentComplete == 1) {			// done - cleanup!
                this.t0COR = -1;
                this.setHaltCircle(false);
                this.overlayNeedsUpdate();
                this.CORMesh.visible = false;
            }
        }
    }

    CORAtMouse({x, y}) {
		const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(x, y);
		raycaster.setFromCamera(mouse, this.camera);
		raycaster.firstHitOnly = true;

		const res = raycaster.intersectObject(this.targetMesh, true);
		if (res.length) {
			this.CORMesh.position.copy(res[0].point);
			this.CORMesh.visible = true;
		} else this.CORMesh.visible = false;
	} 

    startCORAnimation() {
        this.oldCOR = this.controls.target.clone();
        const newCOR = this.CORMesh.position.clone();
        this.deltaCOR = newCOR.sub(this.oldCOR);
        this.t0COR = this.state.clock.getElapsedTime();
    }

    
    // resetCOR - set rotations about center again
    resetCOR () {
        this.controls.target = new THREE.Vector3(0, 0, 0);
        this.controls.update();
        this.controls.dispatchEvent({ type: 'change' });
    }

     createAxes() {
        const AXIS_LENGTH = 4;
        const xMaterial = new THREE.LineBasicMaterial({color: 0xff0000});
        const yMaterial = new THREE.LineBasicMaterial({color: 0x00ff00});
        const zMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});

        const origin = new THREE.Vector3(0,0,0);
        const XAxisGeo = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(AXIS_LENGTH,0,0)]);
        const YAxisGeo = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(0,AXIS_LENGTH,0)]);
        const ZAxisGeo = new THREE.BufferGeometry().setFromPoints([origin, new THREE.Vector3(0,0,AXIS_LENGTH)]);

        this.xAxisLine = new THREE.Line(XAxisGeo, xMaterial);
        this.yAxisLine = new THREE.Line(YAxisGeo, yMaterial);
        this.zAxisLine = new THREE.Line(ZAxisGeo, zMaterial);
    }

    setBrushMeshSize(val) {
		this.brushMesh.scale.setScalar(val/1000.0); // m to km
	}

    shiftCamera(cam) {
		const guiElement = document.querySelector('.lil-gui');
		const guiWidth = this.renderer.domElement.getBoundingClientRect().right - guiElement.getBoundingClientRect().left; // size of lil-gui panel + any right margin
		const canvasWidth = this.renderer.domElement.clientWidth; // Total width of the canvas in pixels
		const canvasHeight = this.renderer.domElement.clientHeight; // Total height of the canvas in pixels
		cam.setViewOffset(
			canvasWidth,             // Full width of the canvas
			canvasHeight,            // Full height of the canvas
			guiWidth/2,              // Offset x - start view after the GUI width/2
			0,                       // Offset y
			canvasWidth,  			 // Width of the viewable area excluding the GUI
			canvasHeight             // Full height of the viewable area
		);
		cam.updateProjectionMatrix();
		if (this.controls) this.controls.update();
	}

    updateCameraClipping () {
        // Transform origin (comet center) to the camera's local space
        const origin = new THREE.Vector3(0, 0, 0);
        const cameraLocalPosition = new THREE.Vector3();
        cameraLocalPosition.copy(origin).applyMatrix4(this.camera.matrixWorldInverse);
        const viewingZDistance = -cameraLocalPosition.z;  // will be negative distance to origin

        // Set clipping planes (too close, even if correct, causes flicker!)
        const COMETRADIUS = 50;	// much bigger than the radius of the comet bounding sphere. Making this too small causes flickering during rotate.
        this.camera.near = Math.max(viewingZDistance - COMETRADIUS, .1);
        this.camera.far = Math.max(viewingZDistance + COMETRADIUS, .1);
        this.camera.updateProjectionMatrix();
    }

    add(obj3d) { this.scene.add(obj3d);  }
    remove(obj3d) { this.scene.remove(obj3d);  }

    enablePaint(enable) {
        this.state['enablePaint'] = enable;
        this.bus.emit('setVal', {key: 'enablePaint', val: enable, silent: true});
        this.controls.enabled = !enable; // disable controls while painting
        if (!enable) this.brushMesh.visible = false
        if (enable && (this.state['showImage'] == SI_UNMAPPED || this.state['showImage'] == SI_ORTHOGRAPHIC)) {
            // only can paint in certain showImage modes - as though user immediately changes showImage mode
            this.bus.emit('setVal', {key: 'showImage', val: SI_NONE, silent: false}); 
        }
        this.adjustShading();
    }

    adjustBrushSize(size) {
  		this.brushMesh.scale.setScalar(size/1000.0); // m to km
        this.state['brushSize'] = size;
        this.bus.emit('setVal', {key: 'brushSize', val: size, silent: true});
	}

    clearPaintAux() {   // called by clearPaint in ImageBrowser
		this.colorArray.fill(COMETGREYVAL);
		this.colorAttr.needsUpdate = true;
		this.overlayNeedsUpdate();
	}

    spacecraftView(on) {
        this.state['spacecraftView'] = on;
        this.bus.emit('setVal', {key: 'spacecraftView', val: on, silent: true});

        let cometView = this.getCometView();
		if (on && cometView) 					
			cometView.applyToCamera(this.camera, this.controls);
		else {					// Allow rotations about center again
			this.controls.target = new THREE.Vector3(0, 0, 0);
			this.controls.update();
		}
		this.controls.dispatchEvent({ type: 'change' });
        this.overlayNeedsUpdate();
	}

    entryShowViewport(on) {
        this.state['showViewport'] = on;
        this.bus.emit('setVal', {key: 'showViewport', val: on, silent: true});

        this.showViewport(on);
    }

    showViewport(on) {
        const cometView = this.getCometView();
		if (cometView) {
			if (on)	cometView.addViewport();
			else cometView.removeViewport();
		}
	}

    entryShowAxes(on) {
        this.state['showAxes'] = on;
        this.bus.emit('setVal', {key: 'showAxes', val: on, silent: true});

        this.showAxes(on);
    }

    showAxes(on) {
        this.state['showAxes'] = on;
        this.bus.emit('setVal', {key: 'showAxes', val: on, silent: true});

        const {scene, xAxisLine, yAxisLine, zAxisLine} = this;
		if (on) {
			scene.add(zAxisLine);
			scene.add(yAxisLine);
			scene.add(xAxisLine);
		} else {
			scene.remove(zAxisLine);
			scene.remove(yAxisLine);
			scene.remove(xAxisLine);
		}
	}

    adjustShading () {
		if (this.state['enablePaint'] || this.state['showImage'] == SI_NONE) {
			this.setFlatShading(true);
			this.showPaint(true);
		} else {
			this.setFlatShading(false);
			this.showPaint(false);
		}
	}

    entrySetFlatShading(boolFlat) {
        this.state['flatShading'] = boolFlat;
        this.bus.emit('setVal', {key: 'flatShading', val: boolFlat, silent: true});
        this.setFlatShading(boolFlat);
    }

    setFlatShading(boolFlat) {
		this.cometMaterial.flatShading = boolFlat;
		this.cometMaterial.needsUpdate = true
	}

	showPaint(visible) {
		this.cometMaterial.vertexColors = visible;
		this.cometMaterial.needsUpdate = true;
	}


    startPaint() {
        this.setHaltCircle(true);
        this.overlayNeedsUpdate();		// so that circle is erased
        this.CORMesh.visible = false;		// hide mesh while painting
    }

    endPaint() {                     // exact opposite of startPaint
        this.setHaltCircle(false);
        this.overlayNeedsUpdate();
        this.CORMesh.visible = true;
    }

     drawBrush({x: x, y: y, paintBelow: paintBelow, eraseMode: eraseMode}) {	// draws the Brush, painting at the brush if paintBelow == true
        if (typeof this.targetMesh === "undefined") return;
        const geometry = this.targetMesh.geometry;
        const bvh = geometry.boundsTree;
        const colorAttr = geometry.getAttribute('color');
        const indexAttr = geometry.index;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
        raycaster.firstHitOnly = true;

        const res = raycaster.intersectObject(this.targetMesh, true);
        if (res.length) {
            this.brushMesh.position.copy(res[0].point);
            this.brushMesh.visible = true;

            if (paintBelow) {
                const inverseMatrix = new THREE.Matrix4();
                inverseMatrix.copy(this.targetMesh.matrixWorld).invert();

                const sphere = new THREE.Sphere();
                sphere.center.copy(this.brushMesh.position).applyMatrix4(inverseMatrix);
                sphere.radius = this.state['brushSize']/1000.0; // m to km;

                const indices = [];
                const tempVec = new THREE.Vector3();
                bvh.shapecast( {
                    intersectsBounds: box => {
                        const intersects = sphere.intersectsBox(box);
                        const { min, max } = box;
                        if (intersects) {
                            for (let x = 0; x <= 1; x++) { // ok to bind over original x & y
                                for (let y = 0; y <= 1; y++) {
                                    for (let z = 0; z <= 1; z++) {
                                        tempVec.set(
                                            x === 0 ? min.x : max.x,
                                            y === 0 ? min.y : max.y,
                                            z === 0 ? min.z : max.z
                                        );
                                        if (!sphere.containsPoint(tempVec)) {
                                            return INTERSECTED;
                                        }
                                    }
                                }
                            }
                            return CONTAINED;
                        }
                        return intersects ? INTERSECTED : NOT_INTERSECTED;
                    },
                    intersectsTriangle: (tri, i, contained) => {
                        if (contained || tri.intersectsSphere(sphere)) {
                            const i3 = 3 * i;
                            indices.push(i3, i3 + 1, i3 + 2);
                        }
                        return false;
                    }
                } );

                let r, g, b;
                if (eraseMode) {
                    r = g = b = COMETGREYVAL;  // erase the paint
                } else {   // set the paint color
                        r = PAINT_RED;
                        g = PAINT_GREEN;
                        b = PAINT_BLUE;
                }
                for (let i = 0, l = indices.length; i < l; i ++) {
                    const vertexIndex = indexAttr.getX(indices[i]);
                    const colorIndex = vertexIndex * 3;
                    this.colorArray[colorIndex] = r;
                    this.colorArray[colorIndex+1] = g;
                    this.colorArray[colorIndex+2] = b;

                }
                colorAttr.needsUpdate = true;
            }
        } else {
            this.brushMesh.visible = false;
        }	
    }

	memStats () {
        this.state.matches = `Textures: ${this.renderer.info.memory.textures}. Geometries = ${this.renderer.info.memory.geometries}.`;    
        this.bus.emit('setVal', {key: 'matches', val: this.state.matches, silent: true});
    }

    renderLoop() {
        requestAnimationFrame(this.renderLoop);
        this.stats.begin();
        this.controls.update();
        
        this.animateCOR();

        let cometView = this.getCometView();
        const skipRender = cometView && (this.state['showImage'] != SI_NONE)  && !cometView.imageFresh;
        if (!skipRender) {
            this.renderer.render(this.scene, this.camera);
            this.overlay.refreshOverlay(cometView, CometView);
        } else console.log("Skipping render");
        
        this.stats.end();
    }

    getOverlayCam() {    // helper function for OverlayCanvas.overlayGetCircle
        if (this.state['showImage'] != SI_UNMAPPED)
            return this.camera;    // Can simply use main camera
        // Unmapped - so set circleCam to spacecraftCam equivalent and shift it
        let cometView = this.getCometView();
        if (cometView) {
            const cam = new THREE.PerspectiveCamera();
            cometView.applyToCamera(cam);
            this.shiftCamera(cam);
            return cam;
        }
        return null;   // cometView is not set - should not happen
    }

    visiblePaintedVertices(sc) {
        let visibleVerts = [];
        const raycaster = new THREE.Raycaster();
        let res = [];
        let cometGeometry = this.cometGeometry, colorArray = this.colorArray;
        raycaster.firstHitOnly = true;
    
        for (let i = 0; i < cometGeometry.attributes.position.array.length; i+=3) {
            if (colorArray[i] == PAINT_RED) {
                    let v = new THREE.Vector3();
                    v.x = cometGeometry.attributes.position.array[i] + .000001; // perturb by a milimeter so it doesn't go through the vertex
                    v.y = cometGeometry.attributes.position.array[i+1] + .000001;
                    v.z = cometGeometry.attributes.position.array[i+2] + .000001;
                    const theoreticalDistance = v.distanceTo(sc);
                    raycaster.set(sc, v.clone().sub(sc));
                    res.length = 0;
                    res = raycaster.intersectObject(this.targetMesh, true, res);
                    if (res.length > 0) {
                        if (Math.abs(res[0].distance - theoreticalDistance) < .001) // less than a meter
                            visibleVerts.push(v.clone());
                    }
                }
            }
        return visibleVerts;
    }

}

