import * as THREE from 'three';
import { blob, merge, paint, place, sphereNormals, tube } from '../lib/geo';
import { mulberry32 } from '../lib/noise';
import { toon } from '../render/toon';

/**
 * Big camphor-style tree: a thick, slightly twisting trunk with flared roots, a few
 * main limbs, and many soft leaf clusters with spherized normals (so light wraps like paint).
 * Two-tone leaves: deep inner shade, bright sunlit outer clumps.
 */
export function createHeroTree(seed = 7, scale = 1): THREE.Group {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const bark = new THREE.Color('#6b4e3a');
  const barkDark = new THREE.Color('#4a3428');

  const woodParts: THREE.BufferGeometry[] = [];
  const leafParts: THREE.BufferGeometry[] = [];
  const leafCentre = new THREE.Vector3(0, 9.5, 0);

  // Trunk with a gentle S-curve.
  const trunkPts = [
    new THREE.Vector3(0, -0.6, 0),
    new THREE.Vector3(0.25, 2.2, 0.1),
    new THREE.Vector3(-0.15, 4.4, -0.1),
    new THREE.Vector3(0.2, 6.2, 0.15),
  ];
  woodParts.push(paint(tube(trunkPts, 0.95, 0.55, 10, 14), bark));

  // Flared roots.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.4;
    const len = 1.6 + rand() * 1.2;
    const pts = [
      new THREE.Vector3(Math.cos(a) * 0.3, 1.1, Math.sin(a) * 0.3),
      new THREE.Vector3(Math.cos(a) * 0.9, 0.35, Math.sin(a) * 0.9),
      new THREE.Vector3(Math.cos(a) * len, -0.15, Math.sin(a) * len),
    ];
    woodParts.push(paint(tube(pts, 0.42, 0.08, 6, 6), barkDark));
  }

  // Main limbs, each ending in a cloud of leaf clusters.
  const limbs = 6;
  const clusterCentres: THREE.Vector3[] = [];
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rand() * 0.5;
    const up = 0.55 + rand() * 0.35;
    const len = 3.6 + rand() * 1.8;
    const start = new THREE.Vector3(0.1, 5.2 + rand() * 1.2, 0);
    const mid = start.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.5, len * up * 0.5, Math.sin(a) * len * 0.5));
    const end = start.clone().add(new THREE.Vector3(Math.cos(a) * len, len * up, Math.sin(a) * len));
    mid.y += 0.4;
    woodParts.push(paint(tube([start, mid, end], 0.42, 0.12, 6, 8), bark));
    clusterCentres.push(end);
    // twig to fill gaps
    const twigEnd = mid.clone().add(new THREE.Vector3(Math.cos(a + 0.9) * 1.6, 1.2, Math.sin(a + 0.9) * 1.6));
    woodParts.push(paint(tube([mid, twigEnd], 0.16, 0.05, 5, 4), bark));
    clusterCentres.push(twigEnd);
  }
  clusterCentres.push(new THREE.Vector3(0.2, 11.2, 0.1), new THREE.Vector3(-1.2, 10.4, 1.4), new THREE.Vector3(1.4, 10.0, -1.2));

  // Leaf clusters: several puffs per centre, shaded by height (top = sunlit).
  const deep = new THREE.Color('#3b6e3c');
  const mid = new THREE.Color('#4f8a3c');
  const lit = new THREE.Color('#8fc05a');
  for (const c of clusterCentres) {
    const puffs = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < puffs; k++) {
      const r = 1.15 + rand() * 0.9;
      const p = c.clone().add(new THREE.Vector3((rand() - 0.5) * 2.2, (rand() - 0.3) * 1.3, (rand() - 0.5) * 2.2));
      const g = blob(r, 3, 0.22, rand() * 50, 0.82);
      place(g, p.x, p.y, p.z, rand(), rand() * 6, rand());
      const tone = Math.min(1, Math.max(0, (p.y - 7.5) / 4.5));
      const col = tone < 0.5 ? deep.clone().lerp(mid, tone * 2) : mid.clone().lerp(lit, (tone - 0.5) * 2);
      leafParts.push(paint(g, col, 0.05));
    }
  }

  const wood = new THREE.Mesh(merge(woodParts), toon({ vertexColors: true, rim: 0.2, sway: 0.05, swayHeight: 10 }));
  const leafGeo = merge(leafParts);
  sphereNormals(leafGeo, leafCentre, 0.75);
  const leaves = new THREE.Mesh(leafGeo, toon({ vertexColors: true, rim: 0.55, sway: 0.28, swayHeight: 10 }));
  for (const m of [wood, leaves]) { m.castShadow = true; m.receiveShadow = true; }
  group.add(wood, leaves);
  group.scale.setScalar(scale);
  return group;
}

/** Smaller rounded trees / shrubs for the forest edge: cheap, instanced by caller. */
export function createSmallTree(seed: number, kind: 'round' | 'pine' = 'round'): THREE.Group {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const trunk = paint(tube([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0.1, 1.5, 0), new THREE.Vector3(-0.05, 3, 0.05)], 0.28, 0.14, 6, 5), '#5c4434');
  const leaf: THREE.BufferGeometry[] = [];
  if (kind === 'round') {
    for (let k = 0; k < 5; k++) {
      const g = blob(1.1 + rand() * 0.5, 1, 0.2, rand() * 40, 0.85);
      place(g, (rand() - 0.5) * 1.6, 3.3 + rand() * 1.4, (rand() - 0.5) * 1.6);
      leaf.push(paint(g, new THREE.Color('#3f7a3a').lerp(new THREE.Color('#86b552'), rand() * 0.6 + k * 0.08)));
    }
  } else {
    for (let k = 0; k < 4; k++) {
      const g = new THREE.ConeGeometry(1.7 - k * 0.32, 1.9, 9, 1);
      place(g, 0, 2.2 + k * 1.15, 0, 0, rand() * 3);
      leaf.push(paint(g, new THREE.Color('#2c5a3c').lerp(new THREE.Color('#4f8a50'), k * 0.2)));
    }
  }
  parts.push(trunk);
  const w = new THREE.Mesh(merge(parts), toon({ vertexColors: true, rim: 0.2 }));
  const lg = merge(leaf);
  sphereNormals(lg, new THREE.Vector3(0, 4, 0), kind === 'round' ? 0.7 : 0.35);
  const l = new THREE.Mesh(lg, toon({ vertexColors: true, rim: 0.5, sway: 0.18, swayHeight: 5 }));
  for (const m of [w, l]) { m.castShadow = true; m.receiveShadow = true; }
  group.add(w, l);
  return group;
}
