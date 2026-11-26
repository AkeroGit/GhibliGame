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
export const HOUSE_ROT = 0.12; // yaw of the tea house (radians)
export const HERO_TREE = new THREE.Vector3(-11, 0, -1);
export const LOOKOUT = new THREE.Vector3(-34, 0, -9);
export const SHRINE = new THREE.Vector3(30, 0, -20);
export const BRIDGE = new THREE.Vector3(); // where the beach path crosses the brook (filled below)
export const BRIDGE_DIR = new THREE.Vector2(0, 1); // path direction across the bridge

// Path: beach -> switchbacks -> tea house porch.
const PATH_POINTS = [
  [36, 53], [32, 49.5], [28.2, 46.5], [27.6, 41.4], [27.1, 36.2], [22.5, 33.4], [15, 31], [9, 26], [5, 19], [11, 12], [9, 5], [3, 2],
].map(([x, z]) => new THREE.Vector3(x, 0, z));
// Discovery paths: the teahouse junction branches to the stream and bamboo shrine.
const SHRINE_PATH_POINTS = [[9, 5], [15, 1], [21, -8], [30, -20]].map(([x, z]) => new THREE.Vector3(x, 0, z));
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
export const SHRINE_PATH = sampleCurve(SHRINE_PATH_POINTS, 150);
const RISE = sampleCurve([[-24, 41], [-16, 45], [-8, 49], [4, 52.5], [16, 54], [26, 55]].map(([x, z]) => new THREE.Vector3(x, 0, z)), 60);

// Kettle Brook: a spring in the hillside -> its own sunken valley meadow -> the east cove.
const STREAM_POINTS = [
  [-9.5, 33.2], [-5, 35.6], [0, 37.6], [7, 39.4], [15, 40.6], [23, 41.2], [31, 41.6], [37.5, 43.4], [42.5, 46.6], [46.5, 50.2], [50.5, 54.5],
].map(([x, z]) => new THREE.Vector3(x, 0, z));
export const STREAM_N = 280;
export const STREAM = (() => {
  const curve = new THREE.CatmullRomCurve3(STREAM_POINTS, false, 'centripetal');
  const out = new Float32Array(STREAM_N * 2);
  for (let i = 0; i < STREAM_N; i++) { const p = curve.getPointAt(i / (STREAM_N - 1)); out[i * 2] = p.x; out[i * 2 + 1] = p.z; }
  return out;
})();
/** Water surface height per stream sample; strictly downhill, meets the sea at ~0. */
export const STREAM_LEN = (() => { let L = 0; for (let i = 0; i < STREAM_N - 1; i++) L += Math.hypot(STREAM[i * 2 + 2] - STREAM[i * 2], STREAM[i * 2 + 3] - STREAM[i * 2 + 1]); return L; })();
export const STREAM_LEVEL = new Float32Array(STREAM_N);
/** Smoothed level for the wide dale floor (no weir step), so the valley floor stays gentle. */
const FLOOR_LEVEL = new Float32Array(STREAM_N);

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

/** Brook geometry frame at arc parameter t (no water level; usable before bake). */
function frameXZ(t: number) {
  const f = clamp(t, 0, 1) * (STREAM_N - 1), i = Math.min(STREAM_N - 2, Math.floor(f)), u = f - i;
  const x = lerp(STREAM[i * 2], STREAM[i * 2 + 2], u), z = lerp(STREAM[i * 2 + 1], STREAM[i * 2 + 3], u);
  const tx0 = STREAM[i * 2 + 2] - STREAM[i * 2], tz0 = STREAM[i * 2 + 3] - STREAM[i * 2 + 1], l = Math.hypot(tx0, tz0) || 1;
  const tx = tx0 / l, tz = tz0 / l;
  return { x, z, tx, tz, nx: tz, nz: -tx, i, u };
}
/** Arc parameter of the mill weir: the brook drops a crisp step there; above it, a little mill pond. */
export const WEIR_T = 0.27;
/** Half-width of the brook: a round spring pool at the head, a mill pond above the weir, wider towards the sea. */
export function channelHalf(t: number): number {
  const base = lerp(1.25, 2.1, smoothstep(0.0, 1.0, t)) * (1 + 0.2 * Math.sin(t * 41 + 0.7) + 0.1 * Math.sin(t * 97 + 2.1));
  const spring = 1.5 * (1 - smoothstep(0.0, 0.045, t));
  const pond = 1.7 * smoothstep(0.16, 0.22, t) * (1 - smoothstep(WEIR_T - 0.03, WEIR_T - 0.008, t));
  return base + spring + pond;
}
/** Mill: on the hill-side bank 4 m below the weir; a flume from the pond feeds its wheel. */
export const MILL_T = WEIR_T + 4.2 / STREAM_LEN;
const MILL_F = frameXZ(MILL_T);
export const MILL_OFF = channelHalf(MILL_T) + 1.95;
export const MILL = new THREE.Vector3(MILL_F.x + MILL_F.nx * MILL_OFF, 0, MILL_F.z + MILL_F.nz * MILL_OFF);
/** Yaw so mill-local +x runs downstream and local +z faces the brook (door on -z, the path side). */
export const MILL_YAW = Math.atan2(-MILL_F.tz, MILL_F.tx);
const MILL_DOOR = new THREE.Vector3(MILL.x + MILL_F.nx * 3.6, 0, MILL.z + MILL_F.nz * 3.6);
const MILL_PATH = sampleCurve([[9, 26], [MILL_DOOR.x + 1.6, (26 + MILL_DOOR.z) / 2], [MILL_DOOR.x, MILL_DOOR.z]].map(([x, z]) => new THREE.Vector3(x, 0, z)), 50);

/** Distance to the brook centreline, the water level there, and the arc parameter (0..1). */
export function streamNearest(x: number, z: number): { d: number; level: number; floor: number; t: number } {
  let best = 1e9, bi = 0, bu = 0;
  for (let i = 0; i < STREAM_N - 1; i++) {
    const ax = STREAM[i * 2], az = STREAM[i * 2 + 1], bx = STREAM[i * 2 + 2], bz = STREAM[i * 2 + 3];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const ex = x - (ax + dx * t), ez = z - (az + dz * t);
    const d = ex * ex + ez * ez;
    if (d < best) { best = d; bi = i; bu = t; }
  }
  return {
    d: Math.sqrt(best),
    level: lerp(STREAM_LEVEL[bi], STREAM_LEVEL[bi + 1], bu),
    floor: lerp(FLOOR_LEVEL[bi], FLOOR_LEVEL[bi + 1], bu),
    t: (bi + bu) / (STREAM_N - 1),
  };
}

/** Unflattened landform: a proud hill crowned by the tea house, sheer cliffs to the west,
 *  a long grassy shoulder rolling down to a sandy cove in the south-east. */
function landform(x: number, z: number): number {
  const n = fbm2(x * 0.02 + 3.1, z * 0.02 - 7.4, 4) - 0.5;
  const nf = fbm2(x * 0.08, z * 0.08, 3) - 0.5;
  // crown of the hill (house plateau sits on top)
  const d1 = Math.hypot(x - 0, (z + 6) * 1.1);
  const crown = 19 * Math.exp(-((d1 / 33) ** 2));
  // eastern forest ridge
  const d2 = Math.hypot(x - 34, z + 24);
  const ridge = 8 * Math.exp(-((d2 / 20) ** 2));
  // lowland shelf that reaches the cove
  const r = Math.hypot(x - 6, z - 6);
  const shelfEdge = 76 + n * 16;
  const shelf = 4.2 * (1 - smoothstep(38, shelfEdge, r));
  let h = Math.max(crown, ridge * 0.9 + crown * 0.4) + shelf - 2.2 + n * 3.2 + nf * 0.6;
  h -= 7 * smoothstep(shelfEdge - 6, shelfEdge + 18, r); // sea floor
  // Western and northern cliffs: keep the plateau height, then drop straight into the sea.
  const ro = Math.hypot(x, z * 1.05);
  const west = 1 - smoothstep(0.05, 0.55, (x * 0.6 + z * 0.8) / (ro + 1e-3)); // all but the SE cove
  const edge = 44 + n * 12 + nf * 3;
  const cliffT = smoothstep(edge + 1.8, edge - 0.8, ro);
  const cliffTop = Math.max(h, 6.5 + n * 3);
  const cliff = cliffTop * cliffT + (-8 + n * 2) * (1 - cliffT);
  return lerp(h, cliff, west);
}

// ---- baked grids ----
export const heights = new Float32Array(N * N);
const pathDist = new Float32Array(N * N);
const streamD = new Float32Array(N * N).fill(99); // distance to the brook centreline
const streamL = new Float32Array(N * N); // water level of the nearest brook point
const streamT = new Float32Array(N * N); // 0 spring .. 1 sea

const KNOLL_IN = 2.5, KNOLL_OUT = 8, KNOLL_K = 0.8, KNOLL_DOME = 0.25;

function idx(i: number, j: number) { return j * N + i; }

/** Landform + the house plateau + the lookout shelf (before the tree knoll and paths). */
function baseHeight(x: number, z: number): number {
  let h = landform(x, z);
  // Plateau for the tea house and garden.
  const dh = Math.hypot((x - HOUSE.x) * 0.9, z - HOUSE.z);
  h = lerp(h, HOUSE.y, smoothstep(15, 8, dh));
  // Small flat lookout.
  const dl = Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z);
  h = lerp(h, LOOKOUT.y, smoothstep(6, 3, dl));
  // Sea-wind rise: a low grassy shoulder south of the brook, so the brook runs in a sheltered dale.
  const rd = distToPolyline(RISE, x, z);
  const along = smoothstep(-30, -18, x) * smoothstep(34, 22, x);
  h += 5.0 * Math.exp(-((rd / 7.5) ** 2)) * along * (0.85 + (fbm2(x * 0.05, z * 0.05, 2) - 0.5) * 0.5);
  return h;
}

export const STREAM_BOX = [-44, 92, -6, 70]; // x0, x1, z0, z1 of the dale

/** Water level along the brook: follows the land cut ~2 m in, strictly downhill, meets the sea. */
function bakeStreamLevels() {
  // The brook sits well below the land on BOTH sides: sample the natural ground across the dale floor.
  let prev = Infinity;
  for (let i = 0; i < STREAM_N; i++) {
    const t = i / (STREAM_N - 1);
    const x = STREAM[i * 2], z = STREAM[i * 2 + 1];
    const j0 = Math.max(0, i - 1), j1 = Math.min(STREAM_N - 1, i + 1);
    let tx = STREAM[j1 * 2] - STREAM[j0 * 2], tz = STREAM[j1 * 2 + 1] - STREAM[j0 * 2 + 1];
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const half = floorHalfAt(t) * 0.8;
    let lo = Infinity;
    for (let k = -4; k <= 4; k++) { const o = (k / 4) * half; lo = Math.min(lo, baseHeight(x - tz * o, z + tx * o)); }
    const f = Math.min(lo - lerp(1.9, 0.8, t), prev - 0.004);
    STREAM_LEVEL[i] = f; prev = f;
  }
  for (let pass = 0; pass < 30; pass++) {
    const c = STREAM_LEVEL.slice();
    for (let i = 1; i < STREAM_N - 1; i++) STREAM_LEVEL[i] = Math.min(c[i - 1] - 0.001, (c[i - 1] + c[i] * 2 + c[i + 1]) / 4);
  }
  // The weir: the mill pond is held 0.45 m up, and the race below is cut 0.75 m down (1.2 m head for the wheel).
  for (let i = 0; i < STREAM_N; i++) {
    const t = i / (STREAM_N - 1);
    const up = 1 - smoothstep(WEIR_T - 0.002, WEIR_T + 0.002, t);
    const taper = 1 - smoothstep(WEIR_T, 0.62, t);
    FLOOR_LEVEL[i] = STREAM_LEVEL[i];
    STREAM_LEVEL[i] = Math.max(STREAM_LEVEL[i] + 0.45 * up - 0.75 * (1 - up) * taper, -0.06);
  }
  // water never runs uphill
  for (let i = 1; i < STREAM_N; i++) STREAM_LEVEL[i] = Math.max(-0.06, Math.min(STREAM_LEVEL[i], STREAM_LEVEL[i - 1] - 0.0015));
  // wide floor: the water level blurred over ~6 m either way, so the weir is a step in the brook, not the valley
  const W = 26;
  for (let i = 0; i < STREAM_N; i++) {
    let sum = 0, n = 0;
    for (let k = -W; k <= W; k++) { const j = Math.min(STREAM_N - 1, Math.max(0, i + k)); sum += STREAM_LEVEL[j]; n++; }
    FLOOR_LEVEL[i] = sum / n;
  }
}
const floorHalfAt = (t: number) => lerp(3.2, 9.5, smoothstep(0.0, 0.3, t));


function carveDale(x: number, z: number, h: number, d: number, level: number, floorLevel: number, t: number): number {
  const n = fbm2(x * 0.07 + 40, z * 0.07 - 12, 3) - 0.5;
  const floorHalf = floorHalfAt(t) + n * 3.0;
  const sideW = lerp(6, 11, smoothstep(0.0, 0.3, t)) + n * 2.0;
  const cw = channelHalf(t);
  const near = smoothstep(cw + 3.5, cw + 1.2, d);
  const bankTop = lerp(floorLevel, Math.max(floorLevel, level), near) + 0.6;
  const floorY = bankTop + 0.035 * Math.max(0, d - cw - 0.8) + (fbm2(x * 0.2, z * 0.2, 2) - 0.5) * 0.12;
  // bed: rounded, 0.55 m deep mid-stream; bank face: a short steep cut up to the meadow
  const y = d < cw ? level - 0.55 * (1 - (d / cw) ** 2) : lerp(level, floorY, smoothstep(cw, cw + 0.8, d));
  const carved = lerp(y, h, smoothstep(floorHalf, floorHalf + sideW, d));
  return Math.min(h, carved);
}

function bake() {
  HOUSE.y = Math.round(landform(HOUSE.x, HOUSE.z) * 10) / 10;
  LOOKOUT.y = landform(LOOKOUT.x, LOOKOUT.z);
  HERO_TREE.y = baseHeight(HERO_TREE.x, HERO_TREE.z);
  bakeStreamLevels();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * RES, z = -HALF + j * RES;
      let h = baseHeight(x, z);
      // The camphor tree sits on a soft, slightly domed knoll instead of a raw slope.
      const dt = Math.hypot(x - HERO_TREE.x, z - HERO_TREE.z);
      h = lerp(h, HERO_TREE.y + KNOLL_DOME * smoothstep(KNOLL_IN + 1.5, 0, dt), KNOLL_K * smoothstep(KNOLL_OUT, KNOLL_IN, dt));
      // Paths: soften cross-slope and wear a shallow groove.
      let pd = 99;
      if (Math.abs(x) < 70 && z > -30 && z < 70) {
        pd = Math.min(distToPolyline(PATH, x, z), distToPolyline(LOOKOUT_PATH, x, z));
      }
      pd = Math.min(pd, distToPolyline(SHRINE_PATH, x, z), distToPolyline(MILL_PATH, x, z));
      pathDist[idx(i, j)] = pd;
      h -= 0.12 * smoothstep(1.6, 0.4, pd);
      // Kettle Brook dale: a flat-floored little valley sunk into the hillside, brook channel in its floor.
      if (x > STREAM_BOX[0] && x < STREAM_BOX[1] && z > STREAM_BOX[2] && z < STREAM_BOX[3]) {
        const sn = streamNearest(x, z);
        const k = idx(i, j);
        streamD[k] = sn.d; streamL[k] = sn.level; streamT[k] = sn.t;
        h = carveDale(x, z, h, sn.d, sn.level, sn.floor, sn.t);
      }
      heights[idx(i, j)] = h;
    }
  }
  // Blur the path corridor a little so it isn't bumpy.
  const tmp = heights.slice();
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = idx(i, j);
    const w = smoothstep(3, 0.5, pathDist[k]) * 0.8 * smoothstep(2.2, 3.6, streamD[k]);
    if (w <= 0) continue;
    const avg = (tmp[k] * 4 + tmp[k - 1] + tmp[k + 1] + tmp[k - N] + tmp[k + N]) / 8;
    heights[k] = lerp(tmp[k], avg, w);
  }
}
bake();

/** Where the path crosses the brook, and its heading there. */
(() => {
  let best = 1e9, bi = 0;
  for (let i = 0; i < PATH.length / 2; i++) {
    const d = streamNearest(PATH[i * 2], PATH[i * 2 + 1]).d;
    if (d < best) { best = d; bi = i; }
  }
  const x = PATH[bi * 2], z = PATH[bi * 2 + 1];
  const a = Math.max(0, bi - 3), b = Math.min(PATH.length / 2 - 1, bi + 3);
  BRIDGE_DIR.set(PATH[b * 2] - PATH[a * 2], PATH[b * 2 + 1] - PATH[a * 2 + 1]).normalize();
  BRIDGE.set(x, streamNearest(x, z).level + 0.6, z);
})();

// bridge abutments: low stone blocks set into the bank top under each deck end. Earth is filled flush
// with the coping on the path side and beside it, and rises to just under the coping on the water side,
// so only the coping and one course show. brook.ts builds the stone to match BR_ABUT.
// the abutment's water face stands at the channel edge; the deck lands on its coping a little behind
const BR_CW = channelHalf(streamNearest(BRIDGE.x, BRIDGE.z).t);
export const BR_ABUT = { face: BR_CW - 0.1, ends: BR_CW + 0.6, back: BR_CW + 1.5, half: 1.0, wide: 1.25, wing: 2.6, coping: BRIDGE.y + 0.1 };
// Earth around each abutment, designed around the 0.5 m grid: every cut/fill transition lies inside the
// stone or slopes against a wall face, never in the open.
//  - behind the wall line: a flat platform level with the coping, running out past the wall ends
//  - in front: brook bed against the exposed middle of the wall; towards the wall ends an earth bank is
//    piled against the face (it buries them), easing back into the natural bank further along
(() => {
  const yc = BR_ABUT.coping, A = BR_ABUT, f = A.face, cutTo = f + 0.35, wr = A.wing;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * RES, z = -HALF + j * RES, dx = x - BRIDGE.x, dz = z - BRIDGE.z;
    const u = Math.abs(dx * BRIDGE_DIR.x + dz * BRIDGE_DIR.y), w = Math.abs(dx * BRIDGE_DIR.y - dz * BRIDGE_DIR.x);
    if (u > A.back + 6 || w > wr + 3) continue;
    const h = heights[idx(i, j)];
    const plat = yc - 0.03 - Math.max(0, u - A.back - 0.5) * 0.05;
    if (u >= cutTo) {
      const k = smoothstep(wr + 3, wr + 0.6, w) * smoothstep(A.back + 6, A.back + 1.5, u);
      heights[idx(i, j)] = w <= wr + 0.6 ? lerp(h, plat, k) : lerp(h, Math.max(h, plat - (w - wr - 0.6) * 0.6), k);
    } else {
      const dd = Math.max(0, f - u), drop = yc - 0.03 - (streamNearest(x, z).level - 0.3);
      const ramp = Math.max(h, yc - 0.03 - drop * Math.min(1, (dd / 0.7) ** 1.3));
      const deep = Math.min(h, streamNearest(x, z).level - 0.4);
      const toRamp = smoothstep(wr - 1.0, wr - 0.3, w), toNat = smoothstep(wr + 0.2, wr + 1.3, w);
      heights[idx(i, j)] = lerp(lerp(deep, ramp, toRamp), h, toNat);
    }
  }
})();

/** Stream frame at arc parameter t: centre, tangent (flow), normal (to the left bank), water level. */
export function streamFrame(t: number) {
  const f = frameXZ(t);
  return { ...f, level: lerp(STREAM_LEVEL[f.i], STREAM_LEVEL[f.i + 1], f.u) };
}

function bilinear(grid: Float32Array, x: number, z: number): number {
  const fx = clamp((x + HALF) / RES, 0, N - 1.001), fz = clamp((z + HALF) / RES, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = grid[idx(i, j)], b = grid[idx(i + 1, j)], c = grid[idx(i, j + 1)], d = grid[idx(i + 1, j + 1)];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export const heightAt = (x: number, z: number) => bilinear(heights, x, z);
export const pathDistAt = (x: number, z: number) => bilinear(pathDist, x, z);
// mill floor sits just above the highest ground under its footprint
{
  let top = -Infinity;
  for (const a of [-2.6, 0, 2.6]) for (const b of [-2.0, 0, 1.4]) {
    const x = MILL.x + MILL_F.tx * a - MILL_F.nx * b, z = MILL.z + MILL_F.tz * a - MILL_F.nz * b;
    top = Math.max(top, bilinear(heights, x, z));
  }
  MILL.y = top + 0.12;
}
export const streamDistAt = (x: number, z: number) => bilinear(streamD, x, z);
export const streamLevelAt = (x: number, z: number) => bilinear(streamL, x, z);
export const streamTAt = (x: number, z: number) => bilinear(streamT, x, z);

/** True where the brook is deep enough that you'd get your feet wet. */
export function inBrook(x: number, z: number): boolean {
  const d = streamDistAt(x, z);
  return d < 9 && heightAt(x, z) < streamLevelAt(x, z) - 0.12;
}

/** Walkable surfaces laid over the terrain (bridge decks). Return a height or null. */
export const walkSurfaces: ((x: number, z: number) => number | null)[] = [];
export function groundAt(x: number, z: number): number {
  let y = heightAt(x, z);
  for (const f of walkSurfaces) { const v = f(x, z); if (v !== null && v > y - 0.6) y = Math.max(y, v); }
  return y;
}

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
  lush: new THREE.Color('#3f8a3c'),
  bank: new THREE.Color('#76674a'),
  bed: new THREE.Color('#7d8466'),
  pebble: new THREE.Color('#b3ab92'),
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

  // Beach (not on the brook's dale floor, only at its mouth).
  const sd0 = streamDistAt(x, z), st0 = streamTAt(x, z);
  const daleT = sd0 < 12 ? (1 - smoothstep(0.66, 0.74, st0)) * smoothstep(12, 8, sd0) : 0;
  const sandT = smoothstep(1.4, 0.5, h + (mid - 0.5) * 0.8) * (1 - daleT);
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
  // grassy dale sides: no painted rock on the brook valley's slopes (it read as grey smudges)
  const daleSide = streamDistAt(x, z) < 20 ? smoothstep(20, 12, streamDistAt(x, z)) * (1 - smoothstep(0.7, 0.8, streamTAt(x, z))) : 0;
  const rockT = smoothstep(0.75, 1.15, s + (mid - 0.5) * 0.3) * (1 - daleSide);
  if (rockT > 0) {
    const strata = 0.5 + 0.5 * Math.sin(h * 2.3 + mid * 3);
    tmpRock.copy(C.rockDark).lerp(C.rock, strata).lerp(C.rockLight, smoothstep(0.6, 0.9, fine) * 0.5);
    c.lerp(tmpRock, rockT);
    grassiness *= 1 - rockT;
    if (rockT > 0.5) kind = 'rock';
  }

  // Kettle Brook: lush damp meadow, an earthy cut bank, a pebbly bed under clear water.
  if (sd0 < 12) {
    const cw = channelHalf(st0);
    c.lerp(C.lush, smoothstep(9, 3, sd0) * 0.45);
    let bankT = smoothstep(cw + 0.7, cw + 0.3, sd0);
    // beside the bridge abutments the banks are grassed (and stone-armoured at the waterline), not bare earth
    { const bx = x - BRIDGE.x, bz = z - BRIDGE.z, ba = Math.abs(bx * BRIDGE_DIR.x + bz * BRIDGE_DIR.y), bw = Math.abs(bx * BRIDGE_DIR.y - bz * BRIDGE_DIR.x);
      if (ba < BR_ABUT.face + 0.5 && bw < BR_ABUT.wing + 3) bankT *= 0.25 + 0.75 * smoothstep(BR_ABUT.wing + 1.5, BR_ABUT.wing + 3, bw); }
    tmpRock.copy(C.bank).lerp(C.pebble, smoothstep(0.6, 0.85, fine) * 0.6);
    c.lerp(tmpRock, bankT * 0.85);
    const bedT = smoothstep(cw + 0.1, cw - 0.3, sd0);
    tmpRock.copy(C.bed).lerp(C.pebble, smoothstep(0.45, 0.8, fine) * 0.7);
    c.lerp(tmpRock, bedT);
    grassiness *= 1 - smoothstep(cw + 0.65, cw + 0.3, sd0);
    if (sd0 < cw * 0.8) kind = 'water';
  }
  // Worn dirt path with grassy, irregular edges.
  const edgeNoise = (fine - 0.5) * 0.7;
  let pathT = smoothstep(1.35 + edgeNoise, 0.7 + edgeNoise, pd) * (sd0 < 12 ? smoothstep(channelHalf(st0) + 0.2, channelHalf(st0) + 0.9, sd0) : 1);
  // bridge approach: worn dirt right up to the threshold stones
  { const bx = x - BRIDGE.x, bz = z - BRIDGE.z, ba = Math.abs(bx * BRIDGE_DIR.x + bz * BRIDGE_DIR.y), bw = Math.abs(bx * BRIDGE_DIR.y - bz * BRIDGE_DIR.x);
    if (ba > BR_ABUT.back - 1.0 && ba < BR_ABUT.back + 6) { const W = lerp(BR_ABUT.wide + 0.35, 1.0, smoothstep(BR_ABUT.back + 0.5, BR_ABUT.back + 4.5, ba)); pathT = Math.max(pathT, smoothstep(W + 0.5 + edgeNoise * 0.5, W + edgeNoise * 0.4, bw)); } }
  if (pathT > 0) {
    tmpRock.copy(C.pathEdge).lerp(C.path, smoothstep(1.0, 0.3, pd));
    c.lerp(tmpRock, pathT);
    grassiness *= 1 - smoothstep(0.2, 0.7, pathT);
    if (pathT > 0.5) kind = 'path';
  }

  // Tea house: clear grass only under the real footprint (body + veranda + step stone),
  // in house space, with a soft trodden fringe instead of a hard square.
  const dxh = x - HOUSE.x, dzh = z - HOUSE.z;
  const cr = Math.cos(HOUSE_ROT), sr = Math.sin(HOUSE_ROT);
  const lx = dxh * cr - dzh * sr, lz = dxh * sr + dzh * cr;
  let sd = Math.min(
    sdBox(lx, lz, 0, 0, 4.0, 3.2), // body + foundation stones
    sdBox(lx, lz, 0, 3.6, 4.85, 0.85), // front engawa
    sdBox(lx, lz, 4.25, 0, 0.7, 2.9), // side engawa
  );
  sd = Math.min(sd, Math.hypot((lx - 0) / 1.25, (lz - 4.95) / 0.85) - 0.9); // step stone
  sd = Math.min(sd, Math.hypot(lx + 2.6, lz - 6.2) - 0.55); // stone lantern
  if (sd < 1.2) {
    grassiness *= smoothstep(-0.05, 0.75, sd);
    // bare, shaded earth under the floor; trodden earth where people step up
    tmpRock.copy(C.pathEdge).multiplyScalar(0.72);
    c.lerp(tmpRock, smoothstep(0.4, -0.4, sd) * 0.85);
  }

  return { color: c, kind, grassiness };
}
const tmpRock = new THREE.Color();
function sdBox(x: number, z: number, cx: number, cz: number, hx: number, hz: number): number {
  const qx = Math.abs(x - cx) - hx, qz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

export function buildTerrain(seg = 480): THREE.Mesh {
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
