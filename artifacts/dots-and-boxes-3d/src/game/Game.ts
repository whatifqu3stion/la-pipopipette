import { GameState } from './GameState';
import { Renderer, EDGE_ANIM_MS } from './Renderer';
import { CameraController } from './CameraController';
import { InputController } from './InputController';
import { buildPoints, edgeKey, faceKey, getCubeEdges } from './GameModel';

export class Game {
  private state: GameState;
  private renderer: Renderer;
  private cameraCtrl: CameraController;
  private inputCtrl: InputController;
  private canvas: HTMLCanvasElement;
  private animFrameId: number | null = null;
  private stateChangeCallback: (() => void) | null = null;

  // Edge-placement sound. A single base HTMLAudioElement is preloaded; each
  // play clones it so rapid placements can overlap without one cutting off
  // the previous one. Volume is dialed back to ~60% so it sits under, not
  // over, ambient room noise. Browsers may reject .play() until a user
  // gesture has occurred, but onPlace only fires after a click/tap so a
  // gesture is always established by the time we get here.
  private placeSound: HTMLAudioElement = (() => {
    const a = new Audio(`${import.meta.env.BASE_URL}sounds/edge-place.mp3`);
    a.preload = 'auto';
    a.volume  = 0.36;  // 0.6 → 0.48 (-20%) → 0.36 (-25%)
    return a;
  })();

  // Face-fill sound — plays when a panel finishes filling in (i.e. a
  // player just closed the 4th edge of a face square). Same volume as
  // placeSound so the two SFX sit at parity in the mix. Cloned per
  // play so multiple closures in one move don't clip each other.
  private fillSound: HTMLAudioElement = (() => {
    const a = new Audio(`${import.meta.env.BASE_URL}sounds/face-fill.mp3`);
    a.preload = 'auto';
    a.volume  = 0.36;  // matched to placeSound
    return a;
  })();

  // Snapshot of which face keys were complete after the last render
  // sync. Used to detect newly-closed faces in onPlace so we can fire
  // fillSound exactly once per fresh closure (and not on undo / load /
  // generic re-syncs).
  private completedFaceKeys = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.state = new GameState();
    this.renderer = new Renderer(canvas);
    this.cameraCtrl = new CameraController(this.renderer.camera);
    this.inputCtrl = new InputController(canvas, this.renderer, this.state);

    this.initScene();
    this.bindInput();
    this.startLoop();
  }

  private initScene() {
    const points = buildPoints();
    this.renderer.initPoints(points);
    this.renderer.initEdges(this.state.getEdgeStates());
    this.renderer.initFaces(this.state.getFaceStates());
    this.renderer.initCubes(this.state.getCubeStates());
    this.syncRendererWithState();
  }

  private syncRendererWithState() {
    this.syncRendererEdges();
    const faces = this.state.getFaceStates();
    this.renderer.updateFaceStates(faces);
    this.renderer.updateCubeStates(this.state.getCubeStates());
    // Reset the completed-face snapshot to whatever's currently on the
    // board so the next onPlace only fires fillSound for genuinely new
    // closures (load / undo / reset enter through here).
    this.completedFaceKeys = new Set(
      faces.filter(f => f.complete).map(f => faceKey(f.face))
    );
  }

  // Edge-only slice of syncRendererWithState — used on placement so the
  // edge state (incl. valid-edge set and completed-cube cage hue) updates
  // immediately while the face/cube fill animations are deferred until
  // after the placed edge's draw-in stroke completes.
  private syncRendererEdges() {
    const validEdgeKeys = new Set(this.state.getValidEdges().map(e => edgeKey(e)));

    // Build a map of edgeKey → cube-owner for every edge that belongs to a
    // completed cube.  Edges shared between two completed cubes get the last
    // writer's colour — acceptable since both cubes are already done.
    const completedCubeEdgeOwner = new Map<string, 'A' | 'B'>();
    for (const { cube, complete, owner } of this.state.getCubeStates()) {
      if (complete && owner) {
        for (const edge of getCubeEdges(cube)) {
          completedCubeEdgeOwner.set(edgeKey(edge), owner);
        }
      }
    }

    this.renderer.updateEdgeStates(this.state.getEdgeStates(), validEdgeKeys, completedCubeEdgeOwner);
  }

  private bindInput() {
    const canvas = this.canvas;

    // Pixels of movement before we commit to drag-rotate (vs tap-to-place)
    const DRAG_THRESHOLD = 8;
    // Radians of rotation per pixel of drag.
    // π / 500 ≈ a full 500 px swipe rotates 180°, so ~250 px ≈ 90°.
    // Same factor for horizontal (azimuth) and vertical (elevation) drag.
    const DRAG_FACTOR = Math.PI / 500;

    // ── Mouse ──────────────────────────────────────────────────────────────
    let mouseDown     = false;
    let mouseStartX   = 0;
    let mouseStartY   = 0;
    let mousePrevX    = 0;
    let mousePrevY    = 0;
    let mouseDragging = false;

    canvas.addEventListener('mousedown', (e) => {
      mouseDown     = true;
      mouseStartX   = e.clientX;
      mouseStartY   = e.clientY;
      mousePrevX    = e.clientX;
      mousePrevY    = e.clientY;
      mouseDragging = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!mouseDown) {
        this.inputCtrl.handleMove(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - mousePrevX;
      const dy = e.clientY - mousePrevY;
      mousePrevX = e.clientX;
      mousePrevY = e.clientY;

      const totalDrag = Math.hypot(e.clientX - mouseStartX, e.clientY - mouseStartY);
      if (!mouseDragging && totalDrag > DRAG_THRESHOLD) {
        mouseDragging = true;
        this.inputCtrl.setEnabled(false);
        this.renderer.setHoveredEdge(null);
      }
      if (mouseDragging) {
        // Horizontal drag spins the cube (turntable yaw); vertical drag
        // tilts the camera elevation. Pass dy as-is so dragging *down*
        // tips the cube's top toward the viewer (reveals the top face),
        // and dragging up reveals more of the side.
        this.cameraCtrl.dragBy(dx * DRAG_FACTOR);
        this.cameraCtrl.dragByVertical(dy * DRAG_FACTOR);
      } else {
        this.inputCtrl.handleMove(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (!mouseDown) return;
      mouseDown = false;
      if (mouseDragging) {
        mouseDragging = false;
        // No snap on release — the cube rests at whatever angle the user
        // settled on so they can reach edges between snap points.
        this.inputCtrl.setEnabled(true);
      } else {
        this.inputCtrl.handleClick(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (mouseDragging) {
        this.inputCtrl.setEnabled(true);
      }
      mouseDown     = false;
      mouseDragging = false;
      this.renderer.setHoveredEdge(null);
    });

    // ── Touch ──────────────────────────────────────────────────────────────
    let touchStartX   = 0;
    let touchStartY   = 0;
    let touchPrevX    = 0;
    let touchPrevY    = 0;
    let touchDragging = false;
    let touchPinching = false;
    let pinchPrevDist = 0;

    const getPinchDist = (touches: TouchList) =>
      Math.hypot(
        touches[1].clientX - touches[0].clientX,
        touches[1].clientY - touches[0].clientY,
      );

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t      = e.touches[0];
        touchStartX  = touchPrevX = t.clientX;
        touchStartY  = touchPrevY = t.clientY;
        touchDragging = false;
        touchPinching = false;
      } else if (e.touches.length === 2) {
        // Second finger down — commit to pinch, cancel any ongoing drag
        touchPinching  = true;
        touchDragging  = false;
        pinchPrevDist  = getPinchDist(e.touches);
        this.renderer.setHoveredEdge(null);
        this.inputCtrl.setEnabled(true); // restore in case drag was active
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (touchPinching && e.touches.length >= 2) {
        const d      = getPinchDist(e.touches);
        const factor = d / pinchPrevDist;
        this.cameraCtrl.zoom(factor);
        pinchPrevDist = d;
        return;
      }
      if (!touchPinching && e.touches.length === 1) {
        const t   = e.touches[0];
        const dx  = t.clientX - touchPrevX;
        const dy  = t.clientY - touchPrevY;
        touchPrevX = t.clientX;
        touchPrevY = t.clientY;

        const totalDrag = Math.hypot(
          t.clientX - touchStartX,
          t.clientY - touchStartY,
        );
        if (!touchDragging && totalDrag > DRAG_THRESHOLD) {
          touchDragging = true;
          this.inputCtrl.setEnabled(false);
          this.renderer.setHoveredEdge(null);
        }
        if (touchDragging) {
          // Horizontal swipe spins the cube; vertical swipe tilts the
          // camera elevation. Swipe down = peek at the top of the cube.
          this.cameraCtrl.dragBy(dx * DRAG_FACTOR);
          this.cameraCtrl.dragByVertical(dy * DRAG_FACTOR);
        } else {
          this.inputCtrl.handleMove(t.clientX, t.clientY);
        }
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (touchPinching) {
        if (e.touches.length < 2) touchPinching = false;
        return;
      }
      if (touchDragging) {
        touchDragging = false;
        // No snap on release — see mouseup handler above.
        this.inputCtrl.setEnabled(true);
      } else {
        // Short tap — place edge
        const t = e.changedTouches[0];
        this.inputCtrl.handleClick(t.clientX, t.clientY);
      }
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
      if (touchDragging) {
        this.inputCtrl.setEnabled(true);
      }
      touchDragging = false;
      touchPinching = false;
      this.renderer.setHoveredEdge(null);
    });

    // ── Wheel / trackpad zoom (desktop) ────────────────────────────────────
    // Mirrors the pinch-zoom path used on touch. We translate wheel
    // deltaY into a multiplicative zoom factor via an exponential so
    // every "tick" of the wheel applies the same proportional change
    // regardless of current zoom level — feels smooth on both a
    // discrete mouse wheel (large deltas) and a continuous trackpad
    // (small deltas). preventDefault stops the page from scrolling
    // when the cursor is over the board. The cameraCtrl.zoom() call
    // already clamps to the viewport's min/max range so the cube
    // can't be lost off-screen, and it sets the "user has manually
    // zoomed" flag so resizes preserve the chosen zoom.
    const WHEEL_ZOOM_SENSITIVITY = 0.0015; // tuned so one wheel notch ≈ ~10% zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Normalise across deltaMode (pixels / lines / pages). Lines
      // and pages report tiny deltaY numbers; multiply them up so a
      // single notch on a real mouse wheel feels comparable to a
      // pixel-mode trackpad swipe of similar physical magnitude.
      const linesToPx  = 16;
      const pagesToPx  = 400;
      const deltaPx =
        e.deltaMode === 1 ? e.deltaY * linesToPx :
        e.deltaMode === 2 ? e.deltaY * pagesToPx :
        e.deltaY;
      // Negative deltaY (scroll up) → factor > 1 → zoom in.
      const factor = Math.exp(-deltaPx * WHEEL_ZOOM_SENSITIVITY);
      this.cameraCtrl.zoom(factor);
    }, { passive: false });

    // ── Game logic callbacks ───────────────────────────────────────────────
    this.inputCtrl.onPlace((placedKey, placedOwner) => {
      // Edge state updates immediately so the placed edge's resting state
      // (and any cage-hue changes on completed cubes' edges) is in place
      // when the draw-in animation finishes. The placed edge itself is
      // owned by beginEdgePlaceAnim during the next EDGE_ANIM_MS, so
      // updateEdgeStates skips it and applies only to the others.
      this.syncRendererEdges();
      this.renderer.beginEdgePlaceAnim(placedKey, placedOwner);

      // Defer face & cube fill animations until after the placed edge's
      // draw-in stroke completes — so the player sees the line finish
      // first, then the panel inks in. We snapshot state lazily inside
      // the timeout so any further state changes (additional placements,
      // undo) during the delay are reflected when the deferred call fires.
      setTimeout(() => {
        const faces = this.state.getFaceStates();
        // Detect any face that flipped from incomplete → complete since
        // the last sync. Done before updateFaceStates so the snapshot
        // genuinely reflects the prior render-side state. Only fire
        // fillSound once per call regardless of how many faces closed,
        // so a double-closure (placing the shared edge of two squares)
        // doesn't fire two stacked clicks of the same SFX.
        let newlyClosed = 0;
        const nextComplete = new Set<string>();
        for (const f of faces) {
          if (!f.complete) continue;
          const key = faceKey(f.face);
          nextComplete.add(key);
          if (!this.completedFaceKeys.has(key)) newlyClosed++;
        }
        this.completedFaceKeys = nextComplete;

        this.renderer.updateFaceStates(faces);
        this.renderer.updateCubeStates(this.state.getCubeStates());

        if (newlyClosed > 0) {
          const sfx = this.fillSound.cloneNode() as HTMLAudioElement;
          sfx.volume = this.fillSound.volume;
          sfx.play().catch(() => { /* ignore — autoplay/decode errors are non-fatal */ });
        }
      }, EDGE_ANIM_MS);

      // Clone-and-play so rapid placements overlap cleanly. Cloned nodes
      // are GC'd once playback ends. Errors (autoplay policy, decode
      // failure) are non-fatal and silently swallowed.
      const sfx = this.placeSound.cloneNode() as HTMLAudioElement;
      sfx.volume = this.placeSound.volume;
      sfx.play().catch(() => { /* ignore */ });
      this.stateChangeCallback?.();
    });

    this.state.on(() => {
      this.stateChangeCallback?.();
    });

    // ── Resize ────────────────────────────────────────────────────────────
    // Both the renderer (canvas size + projection aspect) and the camera
    // controller (fit-distance + zoom range) need to react to viewport
    // changes — so the cube always fits cleanly between the floating UI bars
    // on any screen from a 320 px phone to a 4K desktop.
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) {
        this.renderer.resize(w, h);
        this.cameraCtrl.setViewport(w, h);
      }
    });
    ro.observe(canvas);

    // Initial fit — ResizeObserver fires async, so do one synchronous pass
    // here so the very first frame already has a sensible camera distance.
    const w0 = canvas.clientWidth;
    const h0 = canvas.clientHeight;
    if (w0 > 0 && h0 > 0) {
      this.renderer.resize(w0, h0);
      this.cameraCtrl.setViewport(w0, h0);
    }
  }

  private startLoop() {
    const loop = (now: number) => {
      // Update tween state (button rotations and snap-back animations).
      this.cameraCtrl.update(now);
      // Push the latest cube yaw into the renderer so the turntable group
      // reflects this frame's rotation before render.
      this.renderer.setCubeYaw(this.cameraCtrl.getCubeYaw());
      this.renderer.tick(now);
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  setStateChangeCallback(cb: () => void) {
    this.stateChangeCallback = cb;
  }

  rotateCamera(dir: 'left' | 'right') {
    if (!this.cameraCtrl.isRotating()) {
      this.inputCtrl.setEnabled(false);
      this.cameraCtrl.rotate(dir);
      const checkDone = () => {
        if (!this.cameraCtrl.isRotating()) {
          this.inputCtrl.setEnabled(true);
        } else {
          setTimeout(checkDone, 50);
        }
      };
      setTimeout(checkDone, 50);
    }
  }

  undo() {
    if (this.state.undo()) {
      this.renderer.clearLastPlaced();
      this.syncRendererWithState();
      this.stateChangeCallback?.();
    }
  }

  canUndo(): boolean {
    return this.state.canUndoMove();
  }

  reset() {
    this.state.reset();
    this.cameraCtrl.reset();
    // Apply the reset yaw immediately so the cube snaps back to its home
    // orientation on the same frame as the rest of the reset, instead of
    // the next render loop tick.
    this.renderer.setCubeYaw(this.cameraCtrl.getCubeYaw());
    this.renderer.clearLastPlaced();
    this.syncRendererWithState();
    this.stateChangeCallback?.();
  }

  getCurrentPlayer(): 'A' | 'B' {
    return this.state.getCurrentPlayer();
  }

  getScores(): { A: number; B: number } {
    return this.state.getScores();
  }

  isGameOver(): boolean {
    return this.state.isGameOver();
  }

  getWinner() {
    return this.state.getWinner();
  }

  dispose() {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
    this.renderer.dispose();
  }
}
