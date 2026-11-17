import * as THREE from 'three';
import { fbm2, lerp, smoothstep, clamp } from '../lib/noise';

/**
 * Kettle Hill island: a soft grassy hill with a sea cliff on the west (sunset side),
 * a beach on the south-east, and a winding path up to the tea house plateau.
 * Height + colour are baked once into grids so meshes and placement always agree.
 */

export const WORLD = 240; // metres across
const RES = 0.5; // grid spacing (m)
const N = Math.round(WORLD / RES) + 1;
const HALF = WORLD / 2;

export const HOUSE = new THREE.Vector3(2, 0, -6); // y filled in at bake
export const HERO_TREE = new THREE.Vector3(-11, 0, -1);
export const LOOKOUT = new THREE.Vector3(-34, 0, -9);

// Path: beach -> switchbacks -> tea house porch.
const PATH_POINTS = [
  [36, 52], [30, 40], [19, 33], [9, 27], [5, 19], [11, 12], [9, 5], [3, 2],
].map(([x, z]) => new THREE.Vector3(x, 0, z));
// Side path to the cliff lookout.
const LOOKOUT_POINTS = [
  [-4, -2], [-14, -6], [-24, -6], [-32, -9],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

function sampleCurve(points: THREE.Vector3[], n: number): Float32Array {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = curve.getPoint(i / (n - 1));
    out[i * 2] = p.x;
    out[i * 2 + 1] = p.z;
  }
  return out;
}
export const PATH = sampleCurve(PATH_POINTS, 220);
export const LOOKOUT_PATH = sampleCurve(LOOKOUT_POINTS, 80);

function distToPolyline(poly: Float32Array, x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < poly.length - 2; i += 2) {
    const ax = poly[i], az = poly[i + 1], bx = poly[i + 2], bz = poly[i + 3];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const ex = x - (ax + dx * t), ez = z - (az + dz * t);
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Unflattened landform. */
function landform(x: number, z: number): number {
  const r = Math.hypot(x, z * 1.08);
  const n = fbm2(x * 0.022 + 3.1, z * 0.022 - 7.4, 4) - 0.5;
  const soft = 16.5 * Math.exp(-((r / 47) ** 2)) - 3.2 + n * 3.2 + (fbm2(x * 0.09, z * 0.09, 3) - 0.5) * 0.7;
  // Sea cliff on the west side.
  const west = smoothstep(0.1, 0.7, -x / (r + 1e-3));
  const edge = 43 + n * 7;
  const top = 16.5 * Math.exp(-((r / 62) ** 2)) - 0.6 + n * 2.2;
  const cliffT = smoothstep(edge + 2.2, edge - 0.6, r);
  const cliff = top * cliffT + (-6 + n * 2) * (1 - cliffT);
  return lerp(soft, cliff, west);
}

// ---- baked grids ----
export const heights = new Float32Array(N * N);
const pathDist = new Float32Array(N * N);

function idx(i: number, j: number) { return j * N + i; }

function bake() {
  HOUSE.y = Math.round(landform(HOUSE.x, HOUSE.z) * 10) / 10;
  LOOKOUT.y = landform(LOOKOUT.x, LOOKOUT.z);
  // Path centre heights (smoothed so the trail climbs evenly).
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * RES, z = -HALF + j * RES;
      let h = landform(x, z);
      // Plateau for the tea house and garden.
      const dh = Math.hypot((x - HOUSE.x) * 0.9, z - HOUSE.z);
      h = lerp(h, HOUSE.y, smoothstep(15, 8, dh));
      // Small flat lookout.
      const dl = Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z);
      h = lerp(h, LOOKOUT.y, smoothstep(6, 3, dl));
      // Paths: soften cross-slope and wear a shallow groove.
      let pd = 99;
      if (Math.abs(x) < 70 && z > -30 && z < 70) {
        pd = Math.min(distToPolyline(PATH, x, z), distToPolyline(LOOKOUT_PATH, x, z));
      }
      pathDist[idx(i, j)] = pd;
      h -= 0.12 * smoothstep(1.6, 0.4, pd);
      heights[idx(i, j)] = h;
    }
  }
  // Blur the path corridor a little so it isn't bumpy.
  const tmp = heights.slice();
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = idx(i, j);
    const w = smoothstep(3, 0.5, pathDist[k]) * 0.8;
    if (w <= 0) continue;
    const avg = (tmp[k] * 4 + tmp[k - 1] + tmp[k + 1] + tmp[k - N] + tmp[k + N]) / 8;
    heights[k] = lerp(tmp[k], avg, w);
  }
}
bake();

function bilinear(grid: Float32Array, x: number, z: number): number {
  const fx = clamp((x + HALF) / RES, 0, N - 1.001), fz = clamp((z + HALF) / RES, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = grid[idx(i, j)], b = grid[idx(i + 1, j)], c = grid[idx(i, j + 1)], d = grid[idx(i + 1, j + 1)];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export const heightAt = (x: number, z: number) => bilinear(heights, x, z);
export const pathDistAt = (x: number, z: number) => bilinear(pathDist, x, z);

export function slopeAt(x: number, z: number): number {
  const e = 0.6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

// ---- palette ----
const C = {
  deep: new THREE.Color('#2f6a35'),
  mid: new THREE.Color('#5f9a3e'),
  light: new THREE.Color('#9cc552'),
  hay: new THREE.Color('#c9cf6c'),
  rock: new THREE.Color('#8d8577'),
  rockLight: new THREE.Color('#b3a993'),
  rockDark: new THREE.Color('#5d5a58'),
  sand: new THREE.Color('#e6d6a4'),
  wetSand: new THREE.Color('#bfae80'),
  seabed: new THREE.Color('#6f9c8c'),
  path: new THREE.Color('#c6a273'),
  pathEdge: new THREE.Color('#a58a5c'),
};
const tmpC = new THREE.Color();

export type Surface = 'grass' | 'rock' | 'sand' | 'path' | 'water';

export function surfaceAt(x: number, z: number): { color: THREE.Color; kind: Surface; grassiness: number } {
  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  const pd = pathDistAt(x, z);
  const big = fbm2(x * 0.028 + 11, z * 0.028 - 4, 4);
  const mid = fbm2(x * 0.11 - 2, z * 0.11 + 8, 3);
  const fine = fbm2(x * 0.6, z * 0.6, 2);

  // Meadow: big painted patches, lighter and warmer up high.
  const c = tmpC.copy(C.deep).lerp(C.mid, smoothstep(0.3, 0.55, big));
  c.lerp(C.light, smoothstep(0.5, 0.75, big + (h / 16) * 0.25) * 0.85);
  c.lerp(C.hay, smoothstep(0.62, 0.8, mid) * 0.35 + smoothstep(9, 15, h) * 0.12);
  c.multiplyScalar(0.94 + fine * 0.12);
  let kind: Surface = 'grass';
  let grassiness = 1;

  // Beach.
  const sandT = smoothstep(1.4, 0.5, h + (mid - 0.5) * 0.8);
  if (sandT > 0) {
    c.lerp(C.sand, sandT);
    c.lerp(C.wetSand, smoothstep(0.35, -0.1, h));
    grassiness *= 1 - sandT;
    if (sandT > 0.5) kind = 'sand';
  }
  if (h < -0.4) {
    c.lerp(C.seabed, smoothstep(-0.4, -3, h));
    kind = 'water';
    grassiness = 0;
  }

  // Rock on steep faces, with horizontal strata.
  const rockT = smoothstep(0.75, 1.15, s + (mid - 0.5) * 0.3);
  if (rockT > 0) {
    const strata = 0.5 + 0.5 * Math.sin(h * 2.3 + mid * 3);
    tmpRock.copy(C.rockDark).lerp(C.rock, strata).lerp(C.rockLight, smoothstep(0.6, 0.9, fine) * 0.5);
    c.lerp(tmpRock, rockT);
    grassiness *= 1 - rockT;
    if (rockT > 0.5) kind = 'rock';
  }

  // Worn dirt path with grassy, irregular edges.
  const edgeNoise = (fine - 0.5) * 0.7;
  const pathT = smoothstep(1.35 + edgeNoise, 0.7 + edgeNoise, pd);
  if (pathT > 0) {
    tmpRock.copy(C.pathEdge).lerp(C.path, smoothstep(1.0, 0.3, pd));
    c.lerp(tmpRock, pathT);
    grassiness *= 1 - smoothstep(0.2, 0.7, pathT);
    if (pathT > 0.5) kind = 'path';
  }

  // Tea house footprint + porch: no grass.
  const hx = Math.abs(x - HOUSE.x), hz = z - HOUSE.z;
  if (hx < 6.6 && hz > -5.2 && hz < 7.2) grassiness *= 0.0;

  return { color: c, kind, grassiness };
}
const tmpRock = new THREE.Color();

export function buildTerrain(): THREE.Mesh {
  const seg = 240;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    pos.setY(k, heightAt(x, z));
    const { color } = surfaceAt(x, z);
    colors.set([color.r, color.g, color.b], k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo);
}
