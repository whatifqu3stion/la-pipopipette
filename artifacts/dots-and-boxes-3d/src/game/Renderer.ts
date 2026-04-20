import * as THREE from 'three';
import { edgeKey, faceKey, cubeKey } from './GameModel';
import type { EdgeState, FaceState, CubeState } from './types';

const PLAYER_COLORS: Record<string, number> = {
  A: 0x3a6ea5,
  B: 0xc75c5c,
  neutral: 0x7a6555,  // warm medium-contrast ink
  hover:   0x180a02,  // dark warm ink — strong contrast on hover
  placed:  0x5a4535,  // fallback for already-placed (shouldn't show, but kept)
};

const BG_COLOR = 0xf5f0e8; // warm off-white paper

const EDGE_RADIUS = 0.04;
const POINT_RADIUS = 0.08;
const FACE_OPACITY = 0.13;  // very subtle
const CUBE_OPACITY = 0.32;  // slightly stronger than faces

export class Renderer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;

  private edgeMeshes = new Map<string, THREE.Mesh>();
  private edgeHitMeshes = new Map<string, THREE.Mesh>(); // invisible enlarged hit zones
  private faceMeshes = new Map<string, THREE.Mesh>();
  private cubeMeshes = new Map<string, THREE.Mesh>();

  private sharedSphereGeo: THREE.SphereGeometry;
  private sharedCylinderGeo: THREE.CylinderGeometry;

  private matNeutralEdge: THREE.MeshStandardMaterial;
  private matHoverEdge: THREE.MeshStandardMaterial;
  private matInvalidEdge: THREE.MeshStandardMaterial;
  private matPlayerA: THREE.MeshStandardMaterial;
  private matPlayerB: THREE.MeshStandardMaterial;
  private matPoint: THREE.MeshStandardMaterial;

  private hoveredEdgeKey: string | null = null;
  private raycaster = new THREE.Raycaster();
  private validEdgeKeys = new Set<string>();

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = false;

    // Shared geometries
    this.sharedSphereGeo = new THREE.SphereGeometry(POINT_RADIUS, 8, 8);
    this.sharedCylinderGeo = new THREE.CylinderGeometry(EDGE_RADIUS, EDGE_RADIUS, 1, 8);

    // Shared materials — tuned for paper background
    this.matNeutralEdge = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.neutral, roughness: 0.8, metalness: 0 });
    this.matHoverEdge   = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.hover,   roughness: 0.5, metalness: 0 });
    this.matInvalidEdge = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.neutral, roughness: 0.9, metalness: 0 });
    this.matPlayerA = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.A, roughness: 0.6, metalness: 0 });
    this.matPlayerB = new THREE.MeshStandardMaterial({ color: PLAYER_COLORS.B, roughness: 0.6, metalness: 0 });
    this.matPoint   = new THREE.MeshStandardMaterial({ color: 0x5a4535, roughness: 0.8, metalness: 0 });

    this.setupLighting();
    this.setupCamera();
  }

  private setupLighting() {
    // Warm ambient to match paper background
    const ambient = new THREE.AmbientLight(0xfff8f0, 0.7);
    this.scene.add(ambient);

    // Warm primary light from upper-right
    const dir1 = new THREE.DirectionalLight(0xfff5e8, 0.6);
    dir1.position.set(5, 8, 5);
    this.scene.add(dir1);

    // Soft warm fill from opposite side
    const dir2 = new THREE.DirectionalLight(0xffe8d0, 0.2);
    dir2.position.set(-4, 2, -4);
    this.scene.add(dir2);
  }

  setupCamera() {
    // Fixed isometric view looking at (1, 1, 1)
    const target = new THREE.Vector3(1, 1, 1);
    const dist = 6;
    // Camera position computed by orbit skill
    this.camera.position.set(
      target.x + dist * Math.cos(Math.PI / 6),
      target.y + dist * Math.sin(Math.PI / 4),
      target.z + dist * Math.cos(Math.PI / 6)
    );
    this.camera.lookAt(target);
  }

  initPoints(points: { x: number; y: number; z: number }[]) {
    for (const p of points) {
      const mesh = new THREE.Mesh(this.sharedSphereGeo, this.matPoint);
      mesh.position.set(p.x, p.y, p.z);
      this.scene.add(mesh);
    }
  }

  initEdges(edges: EdgeState[]) {
    for (const { edge } of edges) {
      const key = edgeKey(edge);

      // Compute position and orientation
      const { mesh: edgeMesh, hitMesh } = this.createEdgeMesh(edge);
      edgeMesh.userData = { edgeKey: key };
      hitMesh.userData = { edgeKey: key };

      this.edgeMeshes.set(key, edgeMesh);
      this.edgeHitMeshes.set(key, hitMesh);
      this.scene.add(edgeMesh);
      this.scene.add(hitMesh);
    }
  }

  private createEdgeMesh(edge: import('./types').Edge): { mesh: THREE.Mesh; hitMesh: THREE.Mesh } {
    const { start, direction } = edge;
    const mid = new THREE.Vector3(
      start.x + (direction === 'x' ? 0.5 : 0),
      start.y + (direction === 'y' ? 0.5 : 0),
      start.z + (direction === 'z' ? 0.5 : 0),
    );

    const mesh = new THREE.Mesh(this.sharedCylinderGeo, this.matNeutralEdge);
    mesh.position.copy(mid);

    // Rotate cylinder to face correct axis (cylinder default is Y-axis)
    if (direction === 'x') mesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') mesh.rotation.x = Math.PI / 2;
    // y: no rotation needed

    // Invisible hit zone (larger)
    const hitGeo = new THREE.CylinderGeometry(0.18, 0.18, 1, 6);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.copy(mid);
    if (direction === 'x') hitMesh.rotation.z = Math.PI / 2;
    else if (direction === 'z') hitMesh.rotation.x = Math.PI / 2;

    return { mesh, hitMesh };
  }

  initFaces(faces: FaceState[]) {
    for (const { face } of faces) {
      const key = faceKey(face);
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;

      const { origin, normal } = face;
      const mid = new THREE.Vector3(
        origin.x + (normal !== 'x' ? 0.5 : 0),
        origin.y + (normal !== 'y' ? 0.5 : 0),
        origin.z + (normal !== 'z' ? 0.5 : 0),
      );
      mesh.position.copy(mid);

      if (normal === 'x') mesh.rotation.y = Math.PI / 2;
      else if (normal === 'y') mesh.rotation.x = Math.PI / 2;
      // z: no rotation (plane faces z by default)

      this.faceMeshes.set(key, mesh);
      this.scene.add(mesh);
    }
  }

  initCubes(cubes: CubeState[]) {
    for (const { cube } of cubes) {
      const key = cubeKey(cube);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      mesh.position.set(
        cube.origin.x + 0.5,
        cube.origin.y + 0.5,
        cube.origin.z + 0.5,
      );

      this.cubeMeshes.set(key, mesh);
      this.scene.add(mesh);
    }
  }

  updateEdgeStates(edges: EdgeState[], validEdgeKeys: Set<string>) {
    this.validEdgeKeys = validEdgeKeys;

    for (const { edge, owner } of edges) {
      const key = edgeKey(edge);
      const mesh = this.edgeMeshes.get(key);
      if (!mesh) continue;

      if (key === this.hoveredEdgeKey && !owner) {
        (mesh as THREE.Mesh).material = this.matHoverEdge;
      } else if (owner === 'A') {
        (mesh as THREE.Mesh).material = this.matPlayerA;
      } else if (owner === 'B') {
        (mesh as THREE.Mesh).material = this.matPlayerB;
      } else if (!validEdgeKeys.has(key)) {
        (mesh as THREE.Mesh).material = this.matInvalidEdge;
      } else {
        (mesh as THREE.Mesh).material = this.matNeutralEdge;
      }
    }
  }

  updateFaceStates(faces: FaceState[]) {
    for (const { face, complete, owner } of faces) {
      const key = faceKey(face);
      const mesh = this.faceMeshes.get(key);
      if (!mesh) continue;
      const mat = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;

      if (complete) {
        mat.opacity = FACE_OPACITY;
        mat.color.setHex(owner === 'A' ? PLAYER_COLORS.A : owner === 'B' ? PLAYER_COLORS.B : 0xffffff);
        mat.needsUpdate = true;
      } else {
        mat.opacity = 0;
        mat.needsUpdate = true;
      }
    }
  }

  updateCubeStates(cubes: CubeState[]) {
    for (const { cube, complete, owner } of cubes) {
      const key = cubeKey(cube);
      const mesh = this.cubeMeshes.get(key);
      if (!mesh) continue;
      const mat = (mesh as THREE.Mesh).material as THREE.MeshBasicMaterial;

      if (complete) {
        mat.opacity = CUBE_OPACITY;
        mat.color.setHex(owner === 'A' ? PLAYER_COLORS.A : owner === 'B' ? PLAYER_COLORS.B : 0xffffff);
        mat.needsUpdate = true;
      } else {
        mat.opacity = 0;
        mat.needsUpdate = true;
      }
    }
  }

  setHoveredEdge(edgeKeyVal: string | null) {
    this.hoveredEdgeKey = edgeKeyVal;
  }

  getHoveredEdgeKey(): string | null {
    return this.hoveredEdgeKey;
  }

  /**
   * Raycast from mouse position to find the nearest valid edge hit zone
   */
  raycastEdge(ndc: THREE.Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hitTargets = Array.from(this.edgeHitMeshes.values());
    const hits = this.raycaster.intersectObjects(hitTargets);

    for (const hit of hits) {
      const key = hit.object.userData.edgeKey as string;
      if (this.validEdgeKeys.has(key)) return key;
    }
    return null;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.sharedSphereGeo.dispose();
    this.sharedCylinderGeo.dispose();
    this.renderer.dispose();
  }
}
