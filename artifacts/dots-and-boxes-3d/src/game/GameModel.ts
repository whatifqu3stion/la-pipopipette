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


export { edgeKey, faceKey, cubeKey, eq };
