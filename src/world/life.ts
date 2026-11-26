import * as THREE from 'three';
import { mulberry32, fbm2, smoothstep } from '../lib/noise';
import { blob, merge, paint, place } from '../lib/geo';
import { toon, globalUniforms, CLOUD_SHADOW_GLSL } from '../render/toon';
import { heightAt, surfaceAt, pathDistAt, streamDistAt, streamTAt, channelHalf, HOUSE, HOUSE_ROT, HERO_TREE, MILL, MILL_YAW } from './terrain';

/**
 * Cozy life layer:
 *  - wildflower clumps (clustered by noise, densest along the path and around the house)
 *  - hydrangea bushes as the one strong hue accent beside the tea house
 *  - drifting petals carried by the shared wind
 * Everything is seeded so screenshots are reproducible.
 */

const FLOWER_COLS = ['#fff3e0', '#ffd25e', '#f59ab8', '#b7a0f4', '#fffaf2'];

/** Instanced flower heads: a tiny 5-petal star on a thin stem, coloured per instance. */
export function createFlowers(count: number) {
  // star-shaped head (flat disc with 5 lobes) + stem, in one small geometry
  const head = new THREE.CircleGeometry(0.09, 10);
  const p = head.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const r = 0.075 + 0.065 * Math.pow(Math.abs(Math.cos(a * 2.5)), 0.6);
    p.setXY(i, Math.cos(a) * r, Math.sin(a) * r);
  }
  head.rotateX(-Math.PI / 2 + 0.35);
  head.translate(0, 0.17, 0);
  // a little yellow eye so heads read as flowers, not paper stars
  const eye = new THREE.SphereGeometry(0.035, 6, 4);
  eye.translate(0, 0.185, 0.02);
  const stem = new THREE.CylinderGeometry(0.016, 0.022, 0.17, 4, 1);
  stem.translate(0, 0.085, 0);
  // two leaves at the base hide the stem/ground contact
  const leafA = new THREE.SphereGeometry(0.06, 5, 3); leafA.scale(1.6, 0.35, 0.7); leafA.translate(0.06, 0.04, 0);
  const leafB = leafA.clone(); leafB.rotateY(2.4);
  for (const g of [head, stem, eye, leafA, leafB]) { g.deleteAttribute('uv'); }
  const headCol = new Float32Array(head.attributes.position.count * 3).fill(1);
  const stemCol = new Float32Array(stem.attributes.position.count * 3);
  for (let i = 0; i < stem.attributes.position.count; i++) stemCol.set([0.32, 0.5, 0.22], i * 3);
  head.setAttribute('color', new THREE.BufferAttribute(headCol, 3));
  stem.setAttribute('color', new THREE.BufferAttribute(stemCol, 3));
  const solid = (g: THREE.BufferGeometry, c: [number, number, number]) => { const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < g.attributes.position.count; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  // instance colour multiplies vertex colour: eye/leaves are pre-darkened so they stay yellow/green-ish under any tint
  const geo = merge([head, stem, solid(eye, [1.0, 0.85, 0.35]), solid(leafA, [0.35, 0.55, 0.25]), solid(leafB, [0.32, 0.52, 0.24])]);

  const mat = toon({ vertexColors: true, rim: 0.5, sway: 0.12, swayHeight: 0.4, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const rand = mulberry32(2024);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0, tries = 0;
  while (n < count && tries < count * 40) {
    tries++;
    const x = (rand() - 0.5) * 150, z = (rand() - 0.5) * 150;
    const s = surfaceAt(x, z);
    if (s.kind !== 'grass' || s.grassiness < 0.6) continue;
    const streamClear = streamDistAt(x, z) < channelHalf(streamTAt(x, z)) + 0.8;
    const mdx = x - MILL.x, mdz = z - MILL.z, mc = Math.cos(MILL_YAW), ms = Math.sin(MILL_YAW);
    const mlx = mdx * mc - mdz * ms, mlz = mdx * ms + mdz * mc;
    const millClear = Math.abs(mlx) < 3.9 && mlz > -4.6 && mlz < 3.4;
    if (streamClear || millClear) continue;
    // clumps: low-frequency noise picks meadow patches; edges of path and house get extra
    const clump = fbm2(x * 0.09 + 31, z * 0.09 - 17, 3);
    const pd = pathDistAt(x, z);
    const edge = smoothstep(3.2, 1.4, pd) * smoothstep(0.9, 1.4, pd);
    const nearTree = smoothstep(6, 3, Math.hypot(x - HERO_TREE.x, z - HERO_TREE.z));
    const keep = smoothstep(0.6, 0.7, clump) + edge * smoothstep(0.45, 0.58, clump) + nearTree * 0.25;
    if (rand() > keep * keep) continue;
    // tighten each drift: jitter towards a 1.2 m cell centre so heads touch and form a cushion
    const cx = (Math.floor(x / 1.2) + 0.5) * 1.2, cz = (Math.floor(z / 1.2) + 0.5) * 1.2;
    const pull = 0.35 * rand();
    const fx = x + (cx - x) * pull, fz = z + (cz - z) * pull;
    // each patch has a dominant colour so clumps read as drifts, not confetti
    const pick = (Math.floor(fbm2(x * 0.04 - 9, z * 0.04 + 4, 2) * FLOWER_COLS.length * 2.2) + (rand() < 0.12 ? 1 : 0)) % FLOWER_COLS.length;
    col.set(FLOWER_COLS[pick]).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08);
    pos.set(fx, heightAt(fx, fz) - 0.03, fz);
    e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
    const k = 0.8 + rand() * 0.7;
    sc.set(k, k * (0.8 + rand() * 0.6), k);
    m.compose(pos, q.setFromEuler(e), sc);
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/** Hydrangea bushes: mounded leaves crowned with soft blue-violet-pink flower balls. */
export function createHydrangeas(): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(88);
  const leaves: THREE.BufferGeometry[] = [];
  const blooms: THREE.BufferGeometry[] = [];
  const bloomCols = ['#8fa8ff', '#a690f0', '#c39af0', '#f0a8d0', '#7fb6ff'];
  // spots in house-local space: flanking the step and along the front of the veranda
  const spots: [number, number, number][] = [[-5.6, 4.3, 1.1], [-4.6, 5.4, 0.8], [5.9, 4.0, 1.0], [6.4, 2.2, 0.85], [-5.4, -1.8, 0.9]];
  const cr = Math.cos(HOUSE_ROT), sr = Math.sin(HOUSE_ROT);
  for (const [lx, lz, s] of spots) {
    const x = HOUSE.x + lx * cr + lz * sr, z = HOUSE.z - lx * sr + lz * cr;
    const y = heightAt(x, z) - 0.05;
    const tint = bloomCols[Math.floor(rand() * bloomCols.length)];
    for (let k = 0; k < 5; k++) {
      const g = blob(0.55 * s + rand() * 0.2, 2, 0.2, rand() * 30, 0.75);
      place(g, x + (rand() - 0.5) * 0.9 * s, y + 0.35 * s, z + (rand() - 0.5) * 0.9 * s, rand(), rand() * 6, 0);
      leaves.push(paint(g, new THREE.Color('#3d7a40').lerp(new THREE.Color('#6aa24e'), rand() * 0.5), 0.05));
    }
    const heads = 6 + Math.floor(rand() * 4);
    for (let k = 0; k < heads; k++) {
      const a = rand() * Math.PI * 2, r = rand() * 0.6 * s;
      const g = blob(0.2 + rand() * 0.08, 2, 0.35, rand() * 40, 0.9);
      place(g, x + Math.cos(a) * r, y + 0.65 * s + rand() * 0.25, z + Math.sin(a) * r);
      blooms.push(paint(g, new THREE.Color(tint).offsetHSL((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.1), 0.08));
    }
  }
  const lm = new THREE.Mesh(merge(leaves), toon({ vertexColors: true, rim: 0.35, sway: 0.06, swayHeight: 1.2 }));
  const bm = new THREE.Mesh(merge(blooms), toon({ vertexColors: true, rim: 0.6, sway: 0.08, swayHeight: 1.2 }));
  for (const mm of [lm, bm]) { mm.castShadow = true; mm.receiveShadow = true; }
  group.add(lm, bm);
  return group;
}

/** Petals drifting on the wind across the hill; wrap around a box centred on a moving focus. */
export function createPetals(count: number) {
  const g = new THREE.PlaneGeometry(0.16, 0.11);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = g.index;
  geo.setAttribute('position', g.attributes.position);
  geo.setAttribute('uv', g.attributes.uv);
  const rand = mulberry32(77);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seeds.set([rand(), rand(), rand(), rand()], i * 4);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = count;
  const uniforms = {
    ...globalUniforms,
    uFocus: { value: new THREE.Vector3() },
    uLight: { value: new THREE.Color(1, 1, 1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uWind; uniform vec2 uWindDir; uniform vec3 uFocus;
      varying vec2 vUv; varying float vA; varying float vTint; varying vec2 vXZ;
      void main(){
        vec3 box = vec3(60.0, 9.0, 60.0);
        float sp = 0.6 + aSeed.w * 0.8;
        vec3 drift = vec3(uWindDir.x, 0.0, uWindDir.y) * uTime * (1.4 + uWind) * sp;
        vec3 p0 = aSeed.xyz * box + drift + vec3(sin(uTime * 0.7 + aSeed.x * 40.0), sin(uTime * 1.1 + aSeed.y * 30.0) * 0.6, cos(uTime * 0.6 + aSeed.z * 50.0)) * 0.9;
        vec3 rel = mod(p0 - uFocus + box * 0.5, box) - box * 0.5;
        vec3 wp = uFocus + rel;
        wp.y = uFocus.y + rel.y * 0.5 + 1.0;
        // tumble
        float a = uTime * (1.5 + aSeed.w * 2.0) + aSeed.x * 20.0;
        float b = uTime * (1.1 + aSeed.z * 1.7) + aSeed.y * 15.0;
        vec3 v = position;
        v = vec3(v.x, v.y * cos(a) - v.z * sin(a), v.y * sin(a) + v.z * cos(a));
        v = vec3(v.x * cos(b) + v.z * sin(b), v.y, -v.x * sin(b) + v.z * cos(b));
        vUv = uv;
        vA = smoothstep(box.x * 0.5, box.x * 0.3, length(rel.xz));
        vTint = aSeed.y;
        vXZ = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp + v, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight;
      varying vec2 vUv; varying float vA; varying float vTint; varying vec2 vXZ;
      ${CLOUD_SHADOW_GLSL}
      void main(){
        vec2 q = vUv * 2.0 - 1.0;
        float d = length(q * vec2(1.0, 1.4));
        if (d > 1.0) discard;
        vec3 col = mix(vec3(1.0, 0.8, 0.88), vec3(1.0, 0.95, 0.9), vTint);
        col *= uLight * 1.15;
        col = applyCloudShadow(col, vXZ);
        gl_FragColor = vec4(col, vA * smoothstep(1.0, 0.6, d) * 0.95);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(focus: THREE.Vector3, light: THREE.Color) {
      uniforms.uFocus.value.copy(focus);
      uniforms.uLight.value.copy(light);
    },
  };
}
