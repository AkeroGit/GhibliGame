import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { noise3 } from './noise';

/** Geometry helpers for hand-modelled props. Everything is merged and vertex-coloured. */

export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = jitter ? 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * jitter : 1;
    arr.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  });
  const out = mergeGeometries(clean, false);
  if (!out) throw new Error('merge failed');
  return out;
}

export function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s),
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Lumpy blob (foliage clump, cloud puff, boulder). Normals are smoothed outwards so light wraps softly. */
export function blob(radius: number, detail = 2, lump = 0.25, seed = 0, squashY = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = v.clone().normalize();
    const n = noise3(d.x * 1.8 + seed, d.y * 1.8 - seed * 0.7, d.z * 1.8 + seed * 1.3);
    const n2 = noise3(d.x * 4.1 - seed, d.y * 4.1, d.z * 4.1 + seed);
    const r = radius * (1 + (n - 0.5) * 2 * lump + (n2 - 0.5) * lump * 0.5);
    v.copy(d).multiplyScalar(r);
    v.y *= squashY;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Tapered tube along a curve: branches, trunks, roots, rope. */
export function tube(points: THREE.Vector3[], r0: number, r1: number, radial = 7, segs = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  // TubeGeometry lays out (segs+1) rings of (radial+1) verts.
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let k = 0; k <= radial; k++) {
      const i = s * (radial + 1) + k;
      v.fromBufferAttribute(p, i).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** Replace normals with "spherized" normals around a centre — the classic trick for soft painted foliage. */
export function sphereNormals(geo: THREE.BufferGeometry, centre: THREE.Vector3, amount = 1) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(centre).normalize();
    nn.fromBufferAttribute(n, i).lerp(v, amount).normalize();
    n.setXYZ(i, nn.x, nn.y, nn.z);
  }
  n.needsUpdate = true;
  return geo;
}
