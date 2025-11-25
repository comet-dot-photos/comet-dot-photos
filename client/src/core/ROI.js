// core/ROI.js
// Responsible for keeping track of the Region of Interest (ROI),
//   extracting it from painted vertices, and putting it in a bit array that can be sent to the server.

import * as THREE from 'three';   // Necessary in setFromPaint() 
import {PAINT_RED} from '../core/constants.js';

export class ROI {
    constructor() {
        this.init();
    }

    init() {   // reset to empty
        this.numPainted = 0;
        this.clearPaintBuffer();
    }

    allocatePaintBuffer(nVerts, colorArray) { // colorArray must be provided the firsttime called
        const numBytes = Math.ceil(nVerts/64)*8;  // each on a 64 bit boundary for efficiency if we address outside of Javascript
        this.paintBuffer = new ArrayBuffer(numBytes);
        this.paintArray = new Uint8Array(this.paintBuffer);
        this.colorArray = colorArray;

        this.numPainted = 0;    // in case reallocating
    }

    clearPaintBuffer() {
        this.paintArray?.fill(0);
    }

    updatePaintBuffer(uniqueBlue) {
        this.clearPaintBuffer();
        let i = 2;
        let vertIndex = 0;
        const arraySize = this.colorArray.length;
        while (i < arraySize) {
            if (this.colorArray[i] == uniqueBlue) { 		// visibility blue :-) - made a unique byte so we only have to check blues
                this.setNthBit(vertIndex, this.paintArray);
            }
            i += 3;
            vertIndex++;
        }
    }
    
    setNthBit(i, bitArray) {
        let index = Math.floor(i / 8);
        let pos = i % 8;
        bitArray[index] |= (1 << pos);
    }
    
    getNthBit(n, bitArray) {
        let index = Math.floor(n / 8);
        let pos = n % 8;
        return (bitArray[index] & (1 << pos)) >> pos;
    }

    setFromPaint(cometGeometry) {
        this.clearPaintBuffer();
        this.bbox = new THREE.Box3();
        this.numPainted = 0;
        let loc = new THREE.Vector3(0, 0, 0);
        let norm = new THREE.Vector3(0, 0, 0);
        let vertex = new THREE.Vector3();
        for (let i = 0; i < cometGeometry.attributes.color.array.length; i+=3) {
            if (cometGeometry.attributes.color.array[i] == PAINT_RED) {
                    vertex.fromArray(cometGeometry.attributes.position.array, i);
                    this.bbox.expandByPoint(vertex);
                    loc.add(vertex);
                    vertex.fromArray(cometGeometry.attributes.normal.array, i);
                    norm.add(vertex);
                    this.setNthBit(i/3, this.paintArray);
                    this.numPainted++;
            }
        }
        console.log('numPainted', this.numPainted)
        if (this.numPainted > 0) {
            this.avgPosition = loc.divideScalar(this.numPainted);
            this.avgNormal = norm.divideScalar(this.numPainted).normalize();
        }
    };

};