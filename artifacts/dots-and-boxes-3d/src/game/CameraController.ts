import * as THREE from 'three';

const TARGET = new THREE.Vector3(1, 1, 1);
const CAMERA_DIST = 6;
const CAMERA_ELEVATION = Math.PI / 5; // ~36 degrees up
const ROTATION_DURATION = 300; // ms
const SETTLE_DURATION = 100; // ms
const OVERSHOOT_DEGREES = 3; // degrees

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private currentAngle = 0; // Y-axis rotation angle in radians
  private targetAngle = 0;
  private isAnimating = false;
  private animStartTime = 0;
  private animStartAngle = 0;
  private animTargetAngle = 0;
  private onAnimationComplete: (() => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.updateCameraPosition();
  }

  private updateCameraPosition() {
    const x = TARGET.x + CAMERA_DIST * Math.cos(CAMERA_ELEVATION) * Math.sin(this.currentAngle);
    const y = TARGET.y + CAMERA_DIST * Math.sin(CAMERA_ELEVATION);
    const z = TARGET.z + CAMERA_DIST * Math.cos(CAMERA_ELEVATION) * Math.cos(this.currentAngle);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(TARGET);
  }

  rotate(direction: 'left' | 'right'): boolean {
    if (this.isAnimating) return false;

    const delta = direction === 'left' ? -Math.PI / 2 : Math.PI / 2;
    this.animStartAngle = this.currentAngle;
    this.animTargetAngle = this.currentAngle + delta;
    this.targetAngle = this.animTargetAngle;
    this.animStartTime = performance.now();
    this.isAnimating = true;

    return true;
  }

  update(now: number): boolean {
    if (!this.isAnimating) return false;

    const elapsed = now - this.animStartTime;
    const totalDuration = ROTATION_DURATION + SETTLE_DURATION;

    if (elapsed >= totalDuration) {
      // Settled
      this.currentAngle = this.animTargetAngle;
      this.isAnimating = false;
      this.updateCameraPosition();
      if (this.onAnimationComplete) {
        this.onAnimationComplete();
        this.onAnimationComplete = null;
      }
      return false;
    }

    const overshootRad = (OVERSHOOT_DEGREES * Math.PI) / 180;

    if (elapsed < ROTATION_DURATION) {
      // Main rotation phase with easeInOut
      const t = elapsed / ROTATION_DURATION;
      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      // Overshoot slightly at end of main phase
      const overshootProgress = eased;
      const direction = this.animTargetAngle > this.animStartAngle ? 1 : -1;
      this.currentAngle = this.animStartAngle +
        (this.animTargetAngle - this.animStartAngle) * overshootProgress +
        direction * overshootRad * Math.sin(overshootProgress * Math.PI);
    } else {
      // Settle phase: ease back from overshoot
      const settleT = (elapsed - ROTATION_DURATION) / SETTLE_DURATION;
      const eased = 1 - (1 - settleT) * (1 - settleT);
      const direction = this.animTargetAngle > this.animStartAngle ? 1 : -1;
      this.currentAngle = this.animTargetAngle + direction * overshootRad * (1 - eased);
    }

    this.updateCameraPosition();
    return true;
  }

  isRotating(): boolean {
    return this.isAnimating;
  }

  onComplete(cb: () => void) {
    this.onAnimationComplete = cb;
  }

  reset() {
    this.currentAngle = 0;
    this.targetAngle = 0;
    this.isAnimating = false;
    this.updateCameraPosition();
  }
}
