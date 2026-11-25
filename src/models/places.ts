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

function ribbon(points: [number, number][], width: number, yOffset: number, color: THREE.ColorRepresentation): THREE.Mesh {
  const shape: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const [px, pz] = points[Math.max(0, i - 1)], [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const d = new THREE.Vector2(nx - px, nz - pz).normalize();
    const n = new THREE.Vector2(-d.y, d.x).multiplyScalar(width * 0.5);
    const yl = heightAt(x + n.x, z + n.y) + yOffset;
    const yr = heightAt(x - n.x, z - n.y) + yOffset + 0.012;
    shape.push(x + n.x, yl, z + n.y, x - n.x, yr, z - n.y);
  }
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) pos.push(...shape.slice(i * 6, i * 6 + 6));
  for (let i = 0; i < points.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const o = new THREE.Mesh(geo, m(color, 0.2)); o.receiveShadow = true; return o;
}

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

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, d.length(), 8), mat);
  o.position.copy(mid); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  o.castShadow = o.receiveShadow = true;
  return o;
}

function leafGeometry(): THREE.BufferGeometry {
  // A pointed lanceolate leaf, with a slight crease in the centre. Not a cone or spike.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -0.18, 0.26, 0.018, -0.08, 0.68, 0.025, 0, 1.06, 0,
    0.08, 0.68, 0.025, 0.18, 0.26, 0.018,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
  g.computeVertexNormals();
  return g;
}

const bambooLeafGeo = leafGeometry();
const bambooLeafMat = new THREE.MeshToonMaterial({ color: '#78a957', side: THREE.DoubleSide });

function addBambooLeaf(g: THREE.Group, base: THREE.Vector3, direction: THREE.Vector3, scale: number, mat = bambooLeafMat) {
  const leaf = new THREE.Mesh(bambooLeafGeo, mat);
  leaf.position.copy(base);
  leaf.scale.setScalar(scale);
  leaf.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  leaf.rotation.y += 0.35;
  leaf.castShadow = leaf.receiveShadow = true;
  g.add(leaf);
}

function bamboo(g: THREE.Group, x: number, z: number, h: number, lean: number, seed: number) {
  const ground = heightAt(x, z);
  const points: THREE.Vector3[] = [];
  const segments = 6;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const sway = Math.sin(t * Math.PI) * lean;
    points.push(new THREE.Vector3(x + sway, ground + h * t, z + sway * 0.28));
  }
  const culmMat = m(seed % 2 ? '#82aa5a' : '#628e4b', 0.5);
  const nodeMat = m('#3f6b3c', 0.28);
  for (let i = 0; i < segments; i++) g.add(cylinderBetween(points[i], points[i + 1], 0.22 - i * 0.018, culmMat));
  for (let i = 1; i < segments; i++) {
    const d = points[i + 1].clone().sub(points[i - 1]).normalize();
    const node = cylinderBetween(points[i].clone().addScaledVector(d, -0.06), points[i].clone().addScaledVector(d, 0.06), 0.24 - i * 0.018, nodeMat);
    g.add(node);
    // Two or three leaves per joint, fanning out from a short side branch.
    if (i >= 2) {
      const side = (i + seed) % 2 ? 1 : -1;
      const a = seed * 1.7 + i * 1.9;
      for (let k = 0; k < 5; k++) {
        const ang = a + side * (k - 2) * 0.34;
        const dir = new THREE.Vector3(Math.cos(ang) * (0.62 + k * 0.06), 0.4 + k * 0.1, Math.sin(ang) * (0.62 + k * 0.06));
        const branchEnd = points[i].clone().add(new THREE.Vector3(dir.x * 0.62, dir.y * 0.32, dir.z * 0.62));
        g.add(cylinderBetween(points[i], branchEnd, 0.025, nodeMat));
        addBambooLeaf(g, branchEnd, dir, 1.0 + (seed % 3) * 0.08, k === 1 ? bambooLeafMat : new THREE.MeshToonMaterial({ color: k % 2 ? '#6f9f50' : '#8ab764', side: THREE.DoubleSide }));
      }
    }
  }
}

export function createBambooShrine(): PlaceLandmark {
  const g = new THREE.Group();
  const x = 30, z = -20, y = heightAt(x, z);
  const grove = new THREE.Group();
  // Bamboo is a frame behind the gate, not a wall in front of it.
  for (let i = 0; i < 18; i++) {
    const a = i * 2.399 + 0.3;
    if (Math.sin(a) < -0.3) continue; // keep the ceremonial approach open
    const r = 6.2 + (i % 5) * 0.85;
    const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
    bamboo(grove, bx, bz, 8.0 + (i % 4) * 0.65, Math.sin(i * 4.2) * 0.75, i + 3);
  }
  g.add(grove);

  const gate = torii(); gate.position.set(x, y, z - 4.7); gate.rotation.y = 0.04; g.add(gate);
  // broad stone terrace makes the hut and gate read as one destination
  put(g, new THREE.CylinderGeometry(3.8, 4.2, 0.3, 12), m(MAT.stoneDark, 0.25), x, y + 0.14, z + 1.9);
  const hut = new THREE.Group(); hut.position.set(x + 1.25, y + 0.3, z + 2.0);
  put(hut, new THREE.BoxGeometry(3.7, 2.25, 2.5), m(MAT.wood, 0.3), 0, 1.1, 0);
  put(hut, new THREE.BoxGeometry(4.05, 0.18, 2.8), m(MAT.paper, 0.25), 0, 2.28, 0);
  put(hut, new THREE.ConeGeometry(2.7, 1.45, 4), m('#574c65', 0.4), 0, 3.05, 0);
  put(hut, new THREE.SphereGeometry(0.16, 10, 8), m('#ffb35c', 0.7), -1.0, 1.35, 1.38);
  put(hut, new THREE.BoxGeometry(1.1, 0.85, 0.06), m(MAT.blue, 0.4), 0, 0.82, 1.29);
  for (const xx of [-1.4, 1.4]) put(hut, new THREE.BoxGeometry(0.13, 2.1, 0.13), m(MAT.woodDark, 0.25), xx, 1.1, 1.29);
  g.add(hut);
  // The path is a straight ceremonial approach: torii -> basin -> hut.
  const approach: [number, number][] = [[x, z - 14], [x, z - 11], [x, z - 8], [x, z - 5], [x, z - 2], [x, z + 1]];
  g.add(ribbon(approach, 1.7, 0.03, '#9a7958'));
  for (let i = 0; i < approach.length; i++) put(g, new THREE.DodecahedronGeometry(0.34, 0), m(i % 2 ? MAT.stoneDark : MAT.stone, 0.3), approach[i][0], heightAt(approach[i][0], approach[i][1]) + 0.12, approach[i][1], 1.1);
  // offering basin, two small lanterns, and a warm focal light
  put(g, new THREE.CylinderGeometry(0.72, 0.88, 0.5, 8), m(MAT.stone, 0.25), x - 2.3, y + 0.25, z + 0.3);
  put(g, new THREE.CylinderGeometry(0.58, 0.7, 0.12, 8), m(MAT.moss, 0.45), x - 2.3, y + 0.56, z + 0.3);
  for (const sx of [-2.9, 2.9]) {
    put(g, new THREE.CylinderGeometry(0.14, 0.18, 1.0, 7), m(MAT.stone, 0.25), x + sx, y + 0.62, z + 0.4);
    put(g, new THREE.ConeGeometry(0.42, 0.3, 6), m(MAT.stoneDark, 0.3), x + sx, y + 1.25, z + 0.4);
  }
  return { group: g, focus: new THREE.Vector3(x, y + 2.4, z), name: 'Bamboo Shrine' };
}

function bridgeMesh(): THREE.Group {
  const g = new THREE.Group();
  const wood = m(MAT.bridge, 0.35), dark = m(MAT.bridgeDark, 0.25);
  // The bridge is aligned across a real north-south stream, with landings at z +/- 4.
  for (let i = -5; i <= 5; i++) {
    const z = i * 0.62, arch = 0.7 * (1 - (z / 3.2) ** 2);
    put(g, new THREE.BoxGeometry(4.8, 0.34, 0.58), wood, 0, arch + 0.8, z);
  }
  // two continuous curved handrails, plus posts planted into the deck
  for (const x of [-1.75, 1.75]) {
    const pts = [new THREE.Vector3(x, 1.28, -3.4), new THREE.Vector3(x, 1.92, -1.5), new THREE.Vector3(x, 2.08, 0), new THREE.Vector3(x, 1.92, 1.5), new THREE.Vector3(x, 1.28, 3.4)];
    const r = new THREE.Mesh(tube(pts, 0.11, 0.075, 8, 16), dark); r.castShadow = true; g.add(r);
    for (const z of [-3.0, -1.5, 0, 1.5, 3.0]) { const arch = 0.7 * (1 - (z / 3.2) ** 2); put(g, new THREE.BoxGeometry(0.14, 0.75, 0.14), dark, x, arch + 1.0, z); }
  }
  return g;
}

function streamRibbon(x: number, z: number, length: number, width: number): THREE.Mesh {
  const pts: [number, number][] = [];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), xx = x - length * 0.5 + t * length;
    const zz = 24 + Math.sin((xx / 16) * Math.PI * 0.8) * 1.1;
    pts.push([xx, zz]);
  }
  const water = ribbon(pts, width, 0.1, MAT.water);
  water.material = new THREE.MeshBasicMaterial({ color: '#70d6cf', transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide });
  return water;
}

export function createMoonbridge(): PlaceLandmark {
  const g = new THREE.Group(); const x = 2, z = 24, y = heightAt(x, z);
  // East-west stream: it crosses the north-south footpath, so the bridge has a real purpose.
  g.add(streamRibbon(x, z, 62, 3.6));
  const bankLine = (side: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 22; i++) { const t = i / 21, xx = -29 + t * 62; pts.push([xx, 24 + Math.sin((xx / 16) * Math.PI * 0.8) * 1.1 + side * 2.0]); }
    return pts;
  };
  g.add(ribbon(bankLine(-1), 0.75, 0.05, '#6f6958'));
  g.add(ribbon(bankLine(1), 0.75, 0.05, '#6f6958'));
  for (const off of [-0.75, 0.65]) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 16; i++) { const t = i / 15, xx = -26 + t * 56; pts.push([xx, 24 + Math.sin((xx / 16) * Math.PI * 0.8) * 1.1 + off]); }
    g.add(ribbon(pts, 0.045, 0.14, '#c3f0d3'));
  }
  // Stone bank armor, sampled to each bank's actual terrain.
  for (const side of [-1, 1]) for (let i = 0; i < 18; i++) {
    const xx = -28 + i * 3.3, zz = 24 + Math.sin((xx / 16) * Math.PI * 0.8) * 1.1 + side * 2.5;
    put(g, new THREE.DodecahedronGeometry(0.5 + (i % 3) * 0.1, 0), m(side > 0 ? MAT.moss : MAT.stoneDark, 0.35), xx, heightAt(xx, zz) + 0.04, zz, 1.05);
  }
  // Bridge crosses the stream north-south.
  const bridge = bridgeMesh(); bridge.position.set(x, y, z); g.add(bridge);
  // Clear approaches south and north, with a continuation to the mill.
  g.add(ribbon([[x, z - 16], [x, z - 10], [x, z - 4]], 2.8, 0.06, '#a78561'));
  g.add(ribbon([[x, z + 4], [x + 0.4, z + 10], [x + 1.0, z + 18]], 2.8, 0.06, '#a78561'));
  for (const side of [-1, 1]) for (let i = -5; i <= 5; i++) {
    const rz = z + i * 3.7, rx = x + side * 2.4;
    put(g, new THREE.DodecahedronGeometry(0.46, 0), m(side > 0 ? MAT.moss : MAT.stoneDark, 0.35), rx, heightAt(rx, rz) + 0.04, rz, 1.05);
  }
  // Source end: a spring grotto at the west bank, with a visible rock arch and pool.
  const spring = new THREE.Group(); spring.position.set(-27, heightAt(-27, 24) + 0.1, 24);
  put(spring, new THREE.CylinderGeometry(2.0, 2.4, 0.22, 10), m('#5b7770', 0.3), 0, 0.11, 0);
  put(spring, new THREE.TorusGeometry(2.0, 0.42, 7, 12), m('#62786f', 0.35), 0, 1.7, 0);
  put(spring, new THREE.ConeGeometry(1.3, 2.4, 7), m('#4b625d', 0.35), -1.7, 1.2, 0.2);
  put(spring, new THREE.ConeGeometry(1.3, 2.4, 7), m('#4b625d', 0.35), 1.7, 1.2, 0.2);
  put(spring, new THREE.SphereGeometry(0.32, 10, 8), m('#9fe2cf', 0.6), 0, 1.4, 0.15);
  g.add(spring);
  // Outlet end: a small pond with reeds and a footpath meeting the water.
  const pond = new THREE.Group(); pond.position.set(29, heightAt(29, 24) + 0.05, 24);
  const pondMat = new THREE.MeshBasicMaterial({ color: '#65c6c0', transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const pondMesh = new THREE.Mesh(new THREE.CircleGeometry(5.0, 20), pondMat); pondMesh.rotation.x = -Math.PI / 2; pond.add(pondMesh);
  for (const sx of [-2.8, -1.8, 1.9, 2.8]) { const r = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.7, 5), m('#719d60', 0.4)); r.position.set(sx, 0.7, Math.sin(sx) * 0.7); pond.add(r); }
  g.add(pond);
  // A pair of warm guide lanterns makes the north continuation legible even through the slope.
  for (const zz of [z + 7, z + 10]) {
    put(g, new THREE.CylinderGeometry(0.09, 0.12, 1.5, 7), m(MAT.stone, 0.3), x + 1.6, heightAt(x + 1.6, zz) + 0.75, zz);
    put(g, new THREE.SphereGeometry(0.19, 8, 6), m('#ffb45e', 0.65), x + 1.6, heightAt(x + 1.6, zz) + 1.55, zz);
  }
  // Mill is beyond the north landing, so crossing and stream endpoint have different directions.
  const mill = new THREE.Group(); mill.position.set(x + 5.2, heightAt(x + 5.2, z + 13) + 0.12, z + 13);
  put(g, new THREE.CylinderGeometry(3.0, 3.3, 0.22, 10), m(MAT.stoneDark, 0.25), mill.position.x, mill.position.y - 0.1, mill.position.z);
  put(mill, new THREE.BoxGeometry(3.6, 2.7, 3.0), m(MAT.bridgeDark, 0.3), 0, 1.35, 0);
  put(mill, new THREE.ConeGeometry(2.6, 1.55, 4), m('#74566f', 0.35), 0, 3.05, 0);
  put(mill, new THREE.BoxGeometry(0.9, 1.05, 0.08), m('#f0c36b', 0.55), 0, 1.15, 1.53);
  const wheel = new THREE.Group(); wheel.position.set(-2.0, 1.45, 1.6);
  const disc = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 7, 18), m('#d19b59', 0.4)); disc.rotation.y = Math.PI / 2; wheel.add(disc);
  for (let i = 0; i < 8; i++) { const paddle = put(wheel, new THREE.BoxGeometry(0.18, 2.45, 0.22), m(MAT.bridge, 0.25), 0, 0, 0); paddle.rotation.z = i * Math.PI / 4; }
  mill.add(wheel); g.add(mill);
  return { group: g, focus: new THREE.Vector3(x, y + 1.6, z), name: 'Moonbridge Stream' };
}
