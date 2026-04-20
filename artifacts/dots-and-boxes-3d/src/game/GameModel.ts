import type { Point, Edge, Face, Cube, Axis } from './types';

function edgeKey(e: Edge): string {
  return `${e.start.x},${e.start.y},${e.start.z},${e.direction}`;
}

function faceKey(f: Face): string {
  return `${f.origin.x},${f.origin.y},${f.origin.z},${f.normal}`;
}

function cubeKey(c: Cube): string {
  return `${c.origin.x},${c.origin.y},${c.origin.z}`;
}

function eq(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Build all 27 grid points (x,y,z in {0,1,2})
 */
export function buildPoints(): Point[] {
  const pts: Point[] = [];
  for (let x = 0; x <= 2; x++)
    for (let y = 0; y <= 2; y++)
      for (let z = 0; z <= 2; z++)
        pts.push({ x, y, z });
  return pts;
}

/**
 * Build all 54 edges (18 per axis direction)
 * An edge in direction 'd' starts at (x,y,z) and goes +1 in that direction.
 */
export function buildEdges(): Edge[] {
  const edges: Edge[] = [];
  const dirs: Axis[] = ['x', 'y', 'z'];

  for (const dir of dirs) {
    for (let x = 0; x <= 2; x++) {
      for (let y = 0; y <= 2; y++) {
        for (let z = 0; z <= 2; z++) {
          if (dir === 'x' && x < 2) edges.push({ start: { x, y, z }, direction: 'x' });
          if (dir === 'y' && y < 2) edges.push({ start: { x, y, z }, direction: 'y' });
          if (dir === 'z' && z < 2) edges.push({ start: { x, y, z }, direction: 'z' });
        }
      }
    }
  }
  return edges;
}

/**
 * Build all 36 faces.
 * A face with normal 'n' is the square perpendicular to axis n.
 * - normal 'x': face at x=origin.x, spanning y and z
 * - normal 'y': face at y=origin.y, spanning x and z
 * - normal 'z': face at z=origin.z, spanning x and y
 */
export function buildFaces(): Face[] {
  const faces: Face[] = [];

  // normal 'x': 3 slices (x=0,1,2) × 2×2 grid in y,z → 3×4=12
  for (let x = 0; x <= 2; x++)
    for (let y = 0; y <= 1; y++)
      for (let z = 0; z <= 1; z++)
        faces.push({ origin: { x, y, z }, normal: 'x' });

  // normal 'y': 12 faces
  for (let x = 0; x <= 1; x++)
    for (let y = 0; y <= 2; y++)
      for (let z = 0; z <= 1; z++)
        faces.push({ origin: { x, y, z }, normal: 'y' });

  // normal 'z': 12 faces
  for (let x = 0; x <= 1; x++)
    for (let y = 0; y <= 1; y++)
      for (let z = 0; z <= 2; z++)
        faces.push({ origin: { x, y, z }, normal: 'z' });

  return faces;
}

/**
 * Build all 8 cubes with origins in {0,1}^3
 */
export function buildCubes(): Cube[] {
  const cubes: Cube[] = [];
  for (let x = 0; x <= 1; x++)
    for (let y = 0; y <= 1; y++)
      for (let z = 0; z <= 1; z++)
        cubes.push({ origin: { x, y, z } });
  return cubes;
}

/**
 * Get the 4 edges that border a face.
 * 
 * For normal='x' at origin (ox, oy, oz):
 *   The face spans y: [oy, oy+1], z: [oz, oz+1] at x=ox
 *   Edges: bottom z-dir (oy, oz)→(oy, oz+1), top z-dir (oy+1, oz)→(oy+1, oz+1)
 *          left y-dir (oy, oz)→(oy+1, oz), right y-dir (oy, oz+1)→(oy+1, oz+1)
 */
export function getFaceEdges(face: Face): Edge[] {
  const { origin: o, normal } = face;

  if (normal === 'x') {
    return [
      { start: { x: o.x, y: o.y,     z: o.z     }, direction: 'z' },
      { start: { x: o.x, y: o.y + 1, z: o.z     }, direction: 'z' },
      { start: { x: o.x, y: o.y,     z: o.z     }, direction: 'y' },
      { start: { x: o.x, y: o.y,     z: o.z + 1 }, direction: 'y' },
    ];
  }

  if (normal === 'y') {
    return [
      { start: { x: o.x,     y: o.y, z: o.z     }, direction: 'x' },
      { start: { x: o.x,     y: o.y, z: o.z + 1 }, direction: 'x' },
      { start: { x: o.x,     y: o.y, z: o.z     }, direction: 'z' },
      { start: { x: o.x + 1, y: o.y, z: o.z     }, direction: 'z' },
    ];
  }

  // normal === 'z'
  return [
    { start: { x: o.x,     y: o.y,     z: o.z }, direction: 'x' },
    { start: { x: o.x,     y: o.y + 1, z: o.z }, direction: 'x' },
    { start: { x: o.x,     y: o.y,     z: o.z }, direction: 'y' },
    { start: { x: o.x + 1, y: o.y,     z: o.z }, direction: 'y' },
  ];
}

/**
 * Get the 6 faces of a cube (one per side: ±x, ±y, ±z)
 */
export function getCubeFaces(cube: Cube): Face[] {
  const { origin: o } = cube;
  return [
    { origin: { x: o.x,     y: o.y, z: o.z }, normal: 'x' },
    { origin: { x: o.x + 1, y: o.y, z: o.z }, normal: 'x' },
    { origin: { x: o.x, y: o.y,     z: o.z }, normal: 'y' },
    { origin: { x: o.x, y: o.y + 1, z: o.z }, normal: 'y' },
    { origin: { x: o.x, y: o.y, z: o.z     }, normal: 'z' },
    { origin: { x: o.x, y: o.y, z: o.z + 1 }, normal: 'z' },
  ];
}

/**
 * Get all faces adjacent to a given edge (edges can border 1-4 faces)
 */
export function getEdgeFaces(edge: Edge, faces: Face[]): Face[] {
  return faces.filter(f => {
    const fEdges = getFaceEdges(f);
    return fEdges.some(fe => edgeKey(fe) === edgeKey(edge));
  });
}

/**
 * Check if an edge is on the bottom layer (y=0)
 */
export function isBottomLayer(edge: Edge): boolean {
  // An edge touches the bottom if all its points have y=0
  return edge.start.y === 0;
}

/**
 * Get the cube directly below a point (the cube whose top face includes this point's y level)
 * Returns null if there's no cube below (i.e. at y=0)
 */
export function getCubeBelow(point: Point): Cube | null {
  if (point.y === 0) return null;
  // The cube directly below has origin.y = point.y - 1
  // We need a cube that "covers" this point's x,z position
  // A cube at (cx, cy, cz) covers x=[cx,cx+1], y=[cy,cy+1], z=[cz,cz+1]
  return null; // handled in GameState with cube positions
}

/**
 * Determine which cubes are directly below an edge (support it)
 * An edge is supported by cubes at y-1 level that are directly under any point of the edge
 */
export function getSupportingCubeOrigins(edge: Edge): Point[] {
  if (edge.start.y === 0) return []; // bottom layer, always valid

  const y = edge.start.y;
  const belowY = y - 1;
  if (belowY < 0) return [];

  // Points of this edge
  const points: Point[] = [edge.start];
  if (edge.direction === 'x') points.push({ x: edge.start.x + 1, y, z: edge.start.z });
  if (edge.direction === 'y') points.push({ x: edge.start.x, y: edge.start.y + 1, z: edge.start.z });
  if (edge.direction === 'z') points.push({ x: edge.start.x, y, z: edge.start.z + 1 });

  // For a cube at (cx, cy, cz), it supports a point (px, py, pz) if:
  // cy = py - 1 (cube is directly below), and px ∈ [cx, cx+1], pz ∈ [cz, cz+1]
  // But we want CUBE origins that, when complete, support this edge
  const supportOrigins: Point[] = [];
  const seen = new Set<string>();

  for (const pt of points) {
    // Find all cubes whose top face includes this point
    // Cube origin (cx, cy, cz) where cy = pt.y - 1, cx ∈ {pt.x-1, pt.x} ∩ {0,1}, cz ∈ {pt.z-1, pt.z} ∩ {0,1}
    const cy = pt.y - 1;
    for (const cx of [pt.x - 1, pt.x]) {
      for (const cz of [pt.z - 1, pt.z]) {
        if (cx >= 0 && cx <= 1 && cy >= 0 && cy <= 1 && cz >= 0 && cz <= 1) {
          const key = `${cx},${cy},${cz}`;
          if (!seen.has(key)) {
            seen.add(key);
            supportOrigins.push({ x: cx, y: cy, z: cz });
          }
        }
      }
    }
  }

  return supportOrigins;
}

export { edgeKey, faceKey, cubeKey, eq };
