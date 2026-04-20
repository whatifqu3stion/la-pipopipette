import * as THREE from 'three';

const TARGET = new THREE.Vector3(1, 1, 1);
const CAMERA_DIST = 7; // slightly further — board breathes more

// 45° elevation: true 3/4 view — interior structure clearly visible
const CAMERA_ELEVATION = Math.PI / 4; // 45°

const ROTATION_DURATION = 300; // ms
const SETTLE_DURATION = 100; // ms
const OVERSHOOT_DEGREES = 3; // degrees

// Four preset diagonal azimuths (NE, NW, SW, SE corners of the board).
// 45° offset from cardinal so every view shows two faces of the board simultaneously.
const DIAGONAL_START = Math.PI / 4; // 45°
const STEP           = Math.PI / 2; // 90° between presets

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  // Start at the first diagonal view (NE corner, looking SW toward the board)
  private currentAngle = DIAGONAL_START;
  private targetAngle  = DIAGONAL_START;
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

    const delta = direction === 'left' ? -STEP : STEP;
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
    this.currentAngle = DIAGONAL_START;
    this.targetAngle  = DIAGONAL_START;
    this.isAnimating  = false;
    this.updateCameraPosition();
  }
}
