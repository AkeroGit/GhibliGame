import * as THREE from 'three';
import { tube } from '../lib/geo';
import { heightAt } from '../world/terrain';
import { toon } from '../render/toon';

export interface PlaceLandmark {
  group: THREE.Group;
  focus: THREE.Vector3;
  name: string;
}

const MAT = {
  wood: '#72523d', woodDark: '#45352f', bamboo: '#769b55', bambooDark: '#416442',
  vermilion: '#b84f42', vermilionDark: '#74312e', stone: '#87918a', stoneDark: '#5d6866',
  moss: '#5f8751', water: '#66b8ae', bridge: '#a97a4f', bridgeDark: '#614733',
  paper: '#f2d59e', blue: '#6d83bd',
};
const m = (color: THREE.ColorRepresentation, rim = 0.3) => toon({ color, rim, vertexColors: false });
const put = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, scale = 1) => {
  const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.scale.setScalar(scale); o.castShadow = o.receiveShadow = true; g.add(o); return o;
};

function torii(): THREE.Group {
  const g = new THREE.Group();
  const red = m(MAT.vermilion, 0.45), dark = m(MAT.vermilionDark, 0.3);
  // two posts with stone feet, crossbeam and slightly lifted kasagi ends
  for (const x of [-2.0, 2.0]) {
    put(g, new THREE.CylinderGeometry(0.3, 0.38, 5.8, 10), red, x, 2.95, 0);
    put(g, new THREE.CylinderGeometry(0.48, 0.55, 0.26, 8), dark, x, 0.15, 0);
  }
  put(g, new THREE.BoxGeometry(5.8, 0.34, 0.5), red, 0, 5.65, 0);
  put(g, new THREE.BoxGeometry(4.8, 0.34, 0.4), dark, 0, 4.7, 0);
  // curled, capped tips make the gate an authored silhouette rather than a box
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.09, 6, 12, Math.PI * 0.85), red);
    tip.position.set(s * 2.8, 5.75, 0); tip.rotation.z = s * 0.45; tip.castShadow = true; g.add(tip);
  }
  return g;
}

function bamboo(g: THREE.Group, x: number, z: number, h: number, lean: number, seed: number) {
  const pts = [new THREE.Vector3(x, heightAt(x, z), z), new THREE.Vector3(x + lean * 0.25, heightAt(x, z) + h * 0.35, z + lean * 0.12), new THREE.Vector3(x + lean, heightAt(x, z) + h, z + lean * 0.35)];
  const stem = new THREE.Mesh(tube(pts, 0.11, 0.06, 8, 10), m(seed % 2 ? MAT.bamboo : MAT.bambooDark, 0.45));
  stem.castShadow = stem.receiveShadow = true; g.add(stem);
  for (let i = 1; i < 6; i++) {
    const t = i / 6; const y = heightAt(x, z) + h * t; const xx = x + lean * t; const zz = z + lean * 0.35 * t;
    const node = new THREE.Mesh(new THREE.TorusGeometry(0.115 - t * 0.04, 0.018, 5, 8), m(MAT.bambooDark, 0.25)); node.position.set(xx, y, zz); node.rotation.x = Math.PI / 2; g.add(node);
  }
  const leaves = [
    [x + lean * 0.85 - 0.5, heightAt(x, z) + h * 0.82, z + lean * 0.25],
    [x + lean * 0.9 + 0.45, heightAt(x, z) + h * 0.9, z + lean * 0.35],
    [x + lean * 0.6, heightAt(x, z) + h * 0.98, z + lean * 0.2 + 0.45],
  ];
  for (const [lx, ly, lz] of leaves) put(g, new THREE.ConeGeometry(0.33, 1.25, 5), m(MAT.bamboo, 0.5), lx, ly, lz, 1);
}

export function createBambooShrine(): PlaceLandmark {
  const g = new THREE.Group();
  const x = 30, z = -20, y = heightAt(x, z);
  const grove = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = i * 2.399 + 0.3, r = 7.5 + (i % 3) * 0.65;
    const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
    bamboo(grove, bx, bz, 5.6 + (i % 4) * 0.6, Math.sin(i * 4.2) * 1.2, i);
  }
  g.add(grove);
  const gate = torii(); gate.position.set(x, y, z - 4.2); gate.rotation.y = 0.25; g.add(gate);
  // small shrine behind the torii, with a blue noren and peaked roof
  const hut = new THREE.Group(); hut.position.set(x, y + 0.12, z + 2.5); hut.rotation.y = 0.25;
  put(g, new THREE.CylinderGeometry(2.8, 3.1, 0.28, 10), m(MAT.stoneDark, 0.25), x, y + 0.14, z + 2.5);
  put(hut, new THREE.BoxGeometry(3.2, 2.0, 2.2), m(MAT.wood, 0.3), 0, 1.0, 0);
  put(hut, new THREE.BoxGeometry(3.45, 0.18, 2.45), m(MAT.paper, 0.25), 0, 2.1, 0);
  put(hut, new THREE.ConeGeometry(2.35, 1.25, 4), m(MAT.woodDark, 0.35), 0, 2.75, 0, 1);
  put(hut, new THREE.BoxGeometry(1.0, 0.75, 0.06), m(MAT.blue, 0.4), 0, 0.72, 1.14);
  for (const xx of [-1.2, 1.2]) put(hut, new THREE.BoxGeometry(0.12, 1.9, 0.12), m(MAT.woodDark, 0.25), xx, 1.0, 1.14);
  g.add(hut);
  // offering basin and stepping stones
  put(g, new THREE.CylinderGeometry(0.65, 0.8, 0.42, 8), m(MAT.stone, 0.25), x - 3.2, y + 0.22, z + 2.4);
  put(g, new THREE.CylinderGeometry(0.55, 0.7, 0.14, 8), m(MAT.moss, 0.45), x - 3.2, y + 0.49, z + 2.4);
  for (let i = 0; i < 7; i++) put(g, new THREE.DodecahedronGeometry(0.38, 0), m(i % 2 ? MAT.stoneDark : MAT.stone, 0.3), x, y + 0.12, z - 9 + i * 1.0, 1.1);
  return { group: g, focus: new THREE.Vector3(x, y + 2.2, z), name: 'Bamboo Shrine' };
}

function bridgeMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = m(MAT.bridge, 0.35), dark = m(MAT.bridgeDark, 0.25);
  // deck planks run across the stream, raised in a gentle arch along +Z
  for (let i = -5; i <= 5; i++) {
    const z = i * 0.58, arch = 0.55 * (1 - (z / 3.0) ** 2);
    put(g, new THREE.BoxGeometry(4.8, 0.32, 0.5), wood, 0, arch + 0.72, z);
  }
  for (const x of [-1.65, 1.65]) {
    const pts = [new THREE.Vector3(x, 1.1, -3), new THREE.Vector3(x, 1.75, 0), new THREE.Vector3(x, 1.1, 3)];
    const r = new THREE.Mesh(tube(pts, 0.1, 0.08, 7, 12), dark); r.castShadow = true; g.add(r);
    for (let i = -2; i <= 2; i++) put(g, new THREE.BoxGeometry(0.12, 0.65, 0.12), dark, x, 1.08 + 0.45 * (1 - (i / 2.5) ** 2), i * 1.18);
  }
  return g;
}

export function createMoonbridge(): PlaceLandmark {
  const g = new THREE.Group(); const x = 2, z = 24, y = heightAt(x, z);
  // stream: a shallow blue ribbon plus mossy banks and stones
  const stream = m(MAT.water, 0.5);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9, 30, 1, 12), stream); water.rotation.x = -Math.PI / 2; water.position.set(x, y - 0.18, z + 1); water.scale.x = 0.55; water.receiveShadow = true; g.add(water);
  for (const side of [-1, 1]) {
    for (let i = -4; i <= 4; i++) put(g, new THREE.DodecahedronGeometry(0.55 + (i + 4) % 3 * 0.1, 0), m(side > 0 ? MAT.moss : MAT.stoneDark, 0.35), x + side * 2.5, y + 0.1, z + i * 3.1, 1.1);
  }
  const bridge = bridgeMesh(); bridge.position.set(x, y, z); g.add(bridge);
  // waterwheel silhouette on the east bank
  const wheel = new THREE.Group(); wheel.position.set(x + 3.0, y + 0.6, z + 3.3);
  const disc = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 7, 14), m(MAT.bridgeDark, 0.3)); disc.rotation.y = Math.PI / 2; wheel.add(disc);
  for (let i = 0; i < 8; i++) put(wheel, new THREE.BoxGeometry(0.12, 1.8, 0.16), m(MAT.bridge, 0.25), 0, 0, 0, 1);
  wheel.children.slice(1).forEach((o, i) => o.rotation.z = i * Math.PI / 4); g.add(wheel);
  return { group: g, focus: new THREE.Vector3(x, y + 1.5, z), name: 'Moonbridge Stream' };
}
