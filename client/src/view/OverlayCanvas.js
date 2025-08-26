import * as THREE from 'three';
import { SI_NONE, SI_UNMAPPED } from '../core/constants.js';

// Needs access to ROI, because overlay can highlight the ROI in displayed images .
export class OverlayCanvas {
    constructor({bus, state, ROI}) {
        this.bus = bus;
        this.state = state;
        this.ROI = ROI;

        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.overlayCanvas.width = window.innerWidth;
        this.overlayCanvas.height = window.innerHeight;

        this.threeCanvas = document.getElementById('threeCanvas');
        this.needsUpdate = true;
        this.haltCircle = false;
    }

    overlayNeedsUpdate() {     // useful for setting or checking outside of module
        this.needsUpdate = true;
    }

    setHaltCircle(bool) {
        this.haltCircle = bool;
    }

    overlayResize() {
        this.overlayCanvas.width = window.innerWidth;
        this.overlayCanvas.height = window.innerHeight;
    }

    enableOverlayCanvas(enable) {
        this.threeCanvas.style.pointerEvents = enable ? 'none' : 'auto';
	}    
    
    overlayGetCircle() {
        if (!this.ROI.numPainted) return null;
        let circleCam = this.getOverlayCam();
        let centerVec = this.ROI.avgPosition.clone();
        centerVec.project(circleCam);
        const x = (centerVec.x * 0.5 + 0.5) * window.innerWidth;
        const y = (centerVec.y * -0.5 + 0.5) * window.innerHeight;
        let maxSquared = 0;
        const visiblePainted = this.visiblePaintedVertices(circleCam.position.clone());
        for (let i = 0; i < visiblePainted.length; i++) {
            let thisVec = visiblePainted[i];
            thisVec.project(circleCam);
            thisVec.x = (thisVec.x * 0.5 + 0.5) * window.innerWidth;
            thisVec.y = (thisVec.y * -0.5 + 0.5) * window.innerHeight;
            let deltaX = thisVec.x - x;
            let deltaY = thisVec.y - y;
            let deltaSquared = deltaX*deltaX + deltaY*deltaY;
            if (deltaSquared > maxSquared) maxSquared = deltaSquared;
        }
        return([x, y, Math.sqrt(maxSquared)]);
    }
    
    clearOverlay() {
        const ctx = overlayCanvas.getContext('2d');
        const canvasWidth = overlayCanvas.width, canvasHeight = overlayCanvas.height;

        if (this.state.showImage != SI_UNMAPPED) { // Clear the overlay if it does not contain an image
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            return;
        }
    }
    
    overlayPaintCircle () {
        if (this.needsUpdate && this.state.showImage != SI_NONE && this.state.encircleRegion && !this.haltCircle) {
            let rval = this.overlayGetCircle();
            if (!rval) return;	// nothing to paint
            let x=rval[0], y=rval[1], radius=rval[2];
    
            const ctx = overlayCanvas.getContext('2d');
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2); // Center at (x, y) with a radius of 50
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2 //1;
            ctx.stroke();
        }
    };
    
    drawImageOnOverlay(overlayCanvas, img) {
        const ctx = overlayCanvas.getContext('2d');
        const canvasWidth = overlayCanvas.width, canvasHeight = overlayCanvas.height;
        const guiElement = document.querySelector('.lil-gui');
        const guiWidth = overlayCanvas.getBoundingClientRect().right - guiElement.getBoundingClientRect().left;
    
        if (this.state.showImage != SI_UNMAPPED) { // Clear the overlay if it does not contain an image
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            return;
        }

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight); // Black background
    
        const aspectRatio = img.width / img.height;
    
        // Scale the image height to fit the canvas height
        const drawHeight = canvasHeight;
        const drawWidth = drawHeight * aspectRatio;
    
        // Calculate the available width (canvas width minus gui width)
        const availableWidth = canvasWidth - guiWidth;
    
        // Calculate the x position to center the image within the available space
        const x = (availableWidth - drawWidth) / 2;
        const y = 0; // Start drawing at the top of the canvas
    
        ctx.drawImage(img, x, y, drawWidth, drawHeight); // Draw the image centered
    }
    
    refreshOverlay (cometView, CometView) {
        if (!this.needsUpdate) return;
        if (CometView.map && CometView.map.image && cometView && cometView.imageFresh) {
            this.drawImageOnOverlay(this.overlayCanvas, CometView.map.image);
            this.overlayPaintCircle();
        } else if (!cometView && this.state.metadataLoaded) { // everything loaded but no current cometView => no matches
            this.drawNoMatchesOverlay();
        } else if (cometView) {	 // If No Matches displayed, need to clear it
            this.clearOverlay();
        }
        this.needsUpdate = false;
    };   

    encircleRegion(enable) {
        this.state['encircleRegion'] = enable;
        this.bus.emit('setVal', {key: 'encircleRegion', val: enable, silent: true});

        this.needsUpdate = true;
    }

    drawNoMatchesOverlay() {
        const ctx = this.overlayCanvas.getContext('2d');
        const canvasWidth = this.overlayCanvas.width, canvasHeight = this.overlayCanvas.height;
        const guiElement = document.querySelector('.lil-gui');
        const guiWidth = overlayCanvas.getBoundingClientRect().right - guiElement.getBoundingClientRect().left;
    
        if (this.state['showImage'] == SI_UNMAPPED) {
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight); // Black background
        } else {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight); // Clear - let comet show through
        }
    
        ctx.font = '60px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#9400D3';
        ctx.fillText('No Matching Images', (canvasWidth - guiWidth) / 2, canvasHeight / 2);
    }
}