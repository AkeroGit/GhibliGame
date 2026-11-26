import * as THREE from 'three';
import { blob, merge, paint, place, tube } from '../lib/geo';
import { GLSL_NOISE, mulberry32 } from '../lib/noise';
import { toon, globalUniforms, CLOUD_SHADOW_GLSL } from '../render/toon';
import {
  heightAt, streamFrame, channelHalf, STREAM_LEN, WEIR_T, MILL, MILL_YAW, MILL_T, MILL_OFF,
  BRIDGE, BRIDGE_DIR, walkSurfaces, streamNearest,
} from '../world/terrain';
import type { PlaceLandmark } from './places';

/**
 * Kettle Brook: a spring under the hill -> a little mill pond held by a weir -> the mill wheel
 * turning in the fall -> under the footbridge where the cove path crosses -> out into the cove.
 */

const m = (color: THREE.ColorRepresentation, rim = 0.3) => toon({ color, rim });
const mw = (color: THREE.ColorRepresentation, rim = 0.3) => toon({ color, rim, emissive: '#5a4530', emissiveIntensity: 0.32 });
function box(g: THREE.Object3D, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rz = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  o.position.set(x, y, z); o.rotation.set(0, ry, rz); o.castShadow = o.receiveShadow = true; g.add(o); return o;
}
function cyl(g: THREE.Object3D, r0: number, r1: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 8) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o;
}

// ---------------------------------------------------------------- water
function createWater(): THREE.Mesh {
  const M = 300, K = 15, back = 3.5; // metres the ribbon starts behind the spring (terrain clips it round)
  const pos: number[] = [], flow: number[] = [], extra: number[] = [], idx: number[] = [];
  const total = STREAM_LEN + back;
  const sWeir = WEIR_T * STREAM_LEN;
  let prevLevel = 0;
  for (let i = 0; i <= M; i++) {
    const s = -back + (i / M) * total; // arc length from the spring
    const t = Math.max(0, s / STREAM_LEN);
    const f = streamFrame(t);
    const x0 = f.x + f.tx * Math.min(0, s), z0 = f.z + f.tz * Math.min(0, s);
    const hw = channelHalf(t) + 0.9;
    const ahead = streamFrame(Math.min(1, t + 0.004)).level;
    const fall = Math.max(0, (f.level - ahead) / (0.004 * STREAM_LEN));
    const sMill = MILL_T * STREAM_LEN;
    const foam = Math.exp(-Math.max(0, s - sWeir) / 2.2) * (s > sWeir - 0.3 ? 1 : 0) + Math.exp(-Math.max(0, s) / 1.4) * 0.5
      + 0.8 * Math.exp(-(((s - sMill) / 1.6) ** 2));
    const fade = 1 - Math.max(0, Math.min(1, (t - 0.78) / 0.16));
    prevLevel = f.level;
    for (let k = 0; k < K; k++) {
      const a = -1 + (2 * k) / (K - 1);
      const x = x0 + f.nx * a * hw, z = z0 + f.nz * a * hw;
      pos.push(x, f.level, z);
      flow.push(a * hw, s);
      extra.push(f.level - heightAt(x, z), fall, foam, fade);
    }
  }
  void prevLevel;
  for (let i = 0; i < M; i++) for (let k = 0; k < K - 1; k++) {
    const a = i * K + k, b = a + K;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  geo.setAttribute('aExtra', new THREE.Float32BufferAttribute(extra, 4));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, globalUniforms, {
    uShallow: { value: new THREE.Color('#b9d6a8') },
    uMid: { value: new THREE.Color('#5aa69a') },
    uDeep: { value: new THREE.Color('#2a6570') },
  });
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: true,
    vertexShader: /* glsl */ `
      attribute vec2 aFlow; attribute vec4 aExtra;
      varying vec3 vW; varying vec2 vFlow; varying vec4 vExtra;
      #include <fog_pars_vertex>
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vFlow = aFlow; vExtra = aExtra;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNight;
      uniform vec3 uSunDir, uSunColor, uAmbient, uShallow, uMid, uDeep;
      varying vec3 vW; varying vec2 vFlow; varying vec4 vExtra;
      ${GLSL_NOISE}
      ${CLOUD_SHADOW_GLSL}
      #include <fog_pars_fragment>
      void main(){
        float depth = vExtra.x, fall = vExtra.y, churnAmt = vExtra.z, fade = vExtra.w;
        float d = clamp(depth, 0.0, 1.0);
        vec3 col = mix(uShallow, uMid, smoothstep(0.03, 0.3, d));
        col = mix(col, uDeep, smoothstep(0.3, 0.75, d));
        // flowing streaks: stretched along the current, faster over the weir
        float speed = 0.5 + min(fall, 2.0) * 2.5;
        float s1 = kh_fbm(vec2(vFlow.x * 1.6, vFlow.y * 0.28 - uTime * speed * 0.42));
        float s2 = kh_fbm(vec2(vFlow.x * 3.4 + 7.0, vFlow.y * 0.7 - uTime * speed * 0.9));
        float streak = smoothstep(0.6, 0.78, s1) * 0.45 + smoothstep(0.64, 0.8, s2) * 0.3;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(V.y, 0.0), 3.0);
        col = mix(col, uAmbient * 1.15, fres * 0.35);
        col += streak * vec3(0.8, 0.93, 1.0) * 0.32;
        // sun glints on a gently rippled normal
        vec2 rp = vec2(kh_noise(vW.xz * 1.8 + vec2(0.0, -uTime * 1.1)), kh_noise(vW.xz * 2.1 + vec2(uTime * 0.5, -uTime * 0.9))) - 0.5;
        vec3 N = normalize(vec3(rp.x * 0.5, 1.0, rp.y * 0.5));
        float spec = pow(max(dot(N, normalize(normalize(uSunDir) + V)), 0.0), 140.0);
        col += uSunColor * min(spec * 1.1, 0.6) * (1.0 - uNight);
        // foam: a soft lip at the shore, churn below the weir and at the spring
        float lip = smoothstep(0.12, 0.03, depth) * smoothstep(-0.01, 0.03, depth);
        float churn = churnAmt * smoothstep(0.32, 0.62, kh_fbm(vec2(vFlow.x * 2.6, vFlow.y * 1.3 - uTime * 2.2)));
        float sheet = smoothstep(0.25, 1.0, fall) * (0.55 + 0.45 * kh_noise(vec2(vFlow.x * 4.0, vFlow.y * 2.0 - uTime * 3.0)));
        float foam = clamp(lip * 0.45 * (0.55 + 0.45 * kh_noise(vW.xz * 3.0 + uTime * 0.4)) + churn + sheet * 0.7, 0.0, 0.92);
        col = mix(col, vec3(0.95, 0.98, 1.0), foam);
        col = applyCloudShadow(col, vW.xz);
        col *= mix(vec3(1.0), vec3(0.32, 0.38, 0.62), uNight);
        float alpha = smoothstep(0.0, 0.16, depth) * mix(0.55, 0.94, smoothstep(0.08, 0.6, d));
        alpha = max(alpha, foam * smoothstep(-0.01, 0.03, depth)) * fade;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  return mesh;
}

// ---------------------------------------------------------------- mill
let _straw: THREE.CanvasTexture | null = null;
function strawTex(): THREE.CanvasTexture {
  if (_straw) return _straw;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!, rnd = mulberry32(31);
  x.fillStyle = '#efe2c4'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const y = rnd() * 256, x0 = rnd() * 256, L = 30 + rnd() * 110, dark = rnd() < 0.55;
    x.strokeStyle = dark ? `rgba(110,80,40,${0.12 + rnd() * 0.28})` : `rgba(255,252,236,${0.25 + rnd() * 0.45})`;
    x.lineWidth = 0.8 + rnd() * 1.6;
    for (const o of [-256, 0, 256]) { x.beginPath(); x.moveTo(x0 + o, y); x.lineTo(x0 + L + o, y + (rnd() - 0.5) * 4); x.stroke(); }
  }
  // course lines: a soft shadow just below each overlapping course (every 0.5 m down-slope)
  for (const bx of [0, 128]) {
    const g = x.createLinearGradient(bx, 0, bx + 26, 0);
    g.addColorStop(0, 'rgba(70,48,22,0.55)'); g.addColorStop(0.35, 'rgba(90,64,30,0.25)'); g.addColorStop(1, 'rgba(90,64,30,0)');
    x.fillStyle = g; x.fillRect(bx, 0, 26, 256);
    x.fillStyle = 'rgba(255,248,225,0.35)'; x.fillRect(bx - 4, 0, 4, 256);
  }
  _straw = new THREE.CanvasTexture(c); _straw.wrapS = _straw.wrapT = THREE.RepeatWrapping; _straw.colorSpace = THREE.SRGBColorSpace;
  _straw.anisotropy = 4;
  return _straw;
}

function thatchRoof(len: number, span: number, rise: number, mat: THREE.Material, dark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const half = span / 2, T = 0.62, ang = Math.atan2(rise, half);
  // cross-section in (z,y): convex outer slope, thick rolled eaves, inner soffit
  const sh = new THREE.Shape();
  const outer = (t: number, s: number) => new THREE.Vector2(s * half * t, rise * (1 - t) + 0.18 * Math.sin(Math.PI * t) + 0.1);
  sh.moveTo(0, rise + 0.32);
  for (let i = 1; i <= 8; i++) { const v = outer(i / 8, 1); sh.lineTo(v.x, v.y); }
  sh.quadraticCurveTo(half + 0.28, -0.12, half + 0.05, -T * 0.55);
  sh.lineTo(half - T * 0.7, -T * 0.2);
  sh.lineTo(0, rise - T * 0.9);
  sh.lineTo(-half + T * 0.7, -T * 0.2);
  sh.lineTo(-half - 0.05, -T * 0.55);
  sh.quadraticCurveTo(-half - 0.28, -0.12, outer(1, -1).x, outer(1, -1).y);
  for (let i = 7; i >= 1; i--) { const v = outer(i / 8, -1); sh.lineTo(v.x, v.y); }
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: len - 0.5, steps: 28, bevelEnabled: true, bevelThickness: 0.32, bevelSize: 0.16, bevelSegments: 4, curveSegments: 6 });
  geo.translate(0, 0, -(len - 0.5) / 2); geo.rotateY(Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + v.z * 1.7) * 0.035 + Math.sin(v.x * 7.3 - v.y * 4.1) * 0.02 + Math.sin(v.z * 9.0 + v.x * 1.3) * 0.015;
    pos.setY(i, v.y + n + (v.y < 0.1 ? Math.sin(v.x * 13.0) * 0.03 : 0));
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, toon({ color: (mat as THREE.MeshToonMaterial).color, map: strawTex(), rim: 0.25 })); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
  // ragged fringe of straw tufts hanging off both eaves
  const nT = Math.round(len / 0.07), tuft = new THREE.ConeGeometry(0.09, 1, 5); tuft.translate(0, -0.5, 0);
  const fr = new THREE.InstancedMesh(tuft, toon({ color: '#ffffff', rim: 0.2 }), nT * 2), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), rr = mulberry32(5);
  for (const sgn of [-1, 1]) for (let i = 0; i < nT; i++) {
    const clump = 0.5 + 0.5 * Math.sin(i * 0.9 + sgn) * Math.sin(i * 0.37), h = (0.12 + rr() * 0.22 + clump * 0.28) * (rr() < 0.12 ? 0.3 : 1), row = i % 2;
    q.setFromEuler(new THREE.Euler(sgn * (0.25 + rr() * 0.2), 0, (rr() - 0.5) * 0.3));
    mm.compose(new THREE.Vector3(-len / 2 + 0.05 + (i + rr() * 0.6) * (len - 0.1) / nT, -T * 0.5 + 0.06 + row * 0.08, sgn * (half + 0.06 + row * 0.12 + rr() * 0.04)), q, new THREE.Vector3(1, h, 1));
    fr.setMatrixAt(sgn < 0 ? i : nT + i, mm);
    fr.setColorAt(sgn < 0 ? i : nT + i, new THREE.Color().setHSL(0.1 + rr() * 0.03, 0.42 + rr() * 0.15, 0.5 + rr() * 0.16));
  }
  fr.castShadow = true; g.add(fr);
  // ridge: a thick rounded cap, bound by straw ropes
  const ridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.36, len - 0.4, 4, 12), dark);
  ridge.rotation.z = Math.PI / 2; ridge.position.y = rise + 0.3; ridge.scale.set(0.85, 1, 1); ridge.castShadow = true; g.add(ridge);
  const rope = m('#d6bf86', 0.4);
  for (let i = 0; i < 7; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.045, 5, 14), rope); r.rotation.y = Math.PI / 2; r.position.set(-len / 2 + 0.5 + (i / 6) * (len - 1), rise + 0.3, 0); r.scale.set(1, 0.85, 1); g.add(r); }
  void ang;
  return g;
}

function framedWindow(g: THREE.Object3D, x: number, y: number, z: number, ry: number, glow: THREE.Material, frame: THREE.Material) {
  const w = new THREE.Group(); w.position.set(x, y, z); w.rotation.y = ry;
  box(w, 0.8, 0.62, 0.05, glow, 0, 0, 0);
  box(w, 0.96, 0.1, 0.1, frame, 0, 0.36, 0.02); box(w, 0.96, 0.1, 0.1, frame, 0, -0.36, 0.02);
  box(w, 0.1, 0.72, 0.1, frame, -0.45, 0, 0.02); box(w, 0.1, 0.72, 0.1, frame, 0.45, 0, 0.02);
  box(w, 0.05, 0.62, 0.07, frame, 0, 0, 0.03); box(w, 0.8, 0.05, 0.07, frame, 0, 0.05, 0.03);
  box(w, 1.0, 0.07, 0.22, frame, 0, -0.42, 0.08); // sill
  // flower box under the window
  box(w, 0.9, 0.18, 0.2, m('#6e4a32', 0.3), 0, -0.55, 0.12);
  const fl = [m('#e78fae', 0.5), m('#f6d36a', 0.5), m('#fff2e0', 0.5)];
  for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), fl[i % 3]); b.position.set(-0.36 + i * 0.12, -0.43, 0.14 + (i % 2) * 0.04); w.add(b); }
  g.add(w);
}

function createMill() {
  const g = new THREE.Group();
  g.position.copy(MILL); g.rotation.y = MILL_YAW;
  const stone = mw('#d4c6aa', 0.35), stoneDark = mw('#b9a98b', 0.35);
  const plaster = mw('#f1e6cd', 0.3), timber = m('#4f3a2c', 0.25), wood = m('#7a5638', 0.3);
  const thatch = m('#c29d5f', 0.45), thatchDark = m('#8d7046', 0.3);
  const W = 4.6, D = 3.4, H = 2.4;
  // brook side (+z): race level below the weir; pond level above it
  const race = streamFrame(MILL_T).level - MILL.y, pond = streamFrame(WEIR_T - 0.01).level - MILL.y;
  // coursed-stone ground storey: blocks in staggered rows, deep footing on the brook side
  const footTop = 0.26, footBot = race - 0.75;
  const rows = Math.max(3, Math.round((footTop - footBot) / 0.32)), rh = (footTop - footBot) / rows;
  for (let r = 0; r < rows; r++) {
    const y = footTop - rh / 2 - r * rh;
    for (const [len, axis, off] of [[W + 0.6, 'x', D / 2 + 0.35], [W + 0.6, 'x', -D / 2 - 0.15], [D + 0.5, 'z', W / 2 + 0.3], [D + 0.5, 'z', -W / 2 - 0.3]] as const) {
      const nb = Math.round(len / 0.85), bw = len / nb;
      for (let k = 0; k < nb; k++) {
        const o = -len / 2 + (k + 0.5) * bw + (r % 2 ? bw * 0.25 : -bw * 0.25) * (k === 0 || k === nb - 1 ? 0 : 1);
        const mat = (r + k) % 3 ? stone : stoneDark;
        if (axis === 'x') box(g, bw - 0.04, rh - 0.03, 0.32, mat, o, y, off + 0.0);
        else box(g, 0.32, rh - 0.03, bw - 0.04, mat, off, y, o + 0.1);
      }
    }
  }
  box(g, W + 0.4, footTop - footBot - 0.1, D + 0.3, stoneDark, 0, (footTop + footBot) / 2, 0.1); // core
  box(g, W + 0.9, 0.14, D + 0.8, timber, 0, footTop + 0.04, 0.1); // sill beam
  // timber-framed plaster walls with diagonal braces
  box(g, W, H, D, plaster, 0, footTop + H / 2 + 0.1, 0);
  const y0 = footTop + 0.1;
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) for (const z of [-D / 2 - 0.03, D / 2 + 0.03]) box(g, 0.2, H, 0.12, timber, x, y0 + H / 2, z);
  for (const z of [-D / 2 - 0.04, D / 2 + 0.04]) { box(g, W + 0.1, 0.16, 0.12, timber, 0, y0 + 0.08, z); box(g, W + 0.1, 0.14, 0.12, timber, 0, y0 + H * 0.58, z); box(g, W + 0.1, 0.18, 0.14, timber, 0, y0 + H, z); }
  for (const x of [-W / 2 - 0.03, W / 2 + 0.03]) { box(g, 0.12, 0.14, D, timber, x, y0 + H * 0.58, 0); for (const z of [-D / 2, D / 2]) box(g, 0.2, H, 0.2, timber, x, y0 + H / 2, z); }
  for (const z of [-D / 2 - 0.05, D / 2 + 0.05]) for (const [x0, sg] of [[-W / 2, 1], [W / 2, -1]] as const) {
    const br = box(g, 0.1, Math.hypot(W / 3, H * 0.42), 0.1, timber, x0 + sg * W / 6, y0 + H * 0.79, z); br.rotation.z = -sg * Math.atan2(W / 3, H * 0.42);
  }
  // gable ends: plaster with a little loft door and hoist beam on the downstream gable
  const tri = new THREE.Shape(); tri.moveTo(-D / 2 - 0.05, 0); tri.lineTo(D / 2 + 0.05, 0); tri.lineTo(0, 1.75); tri.closePath();
  const gableMat = toon({ color: '#ece0c4', rim: 0.3, side: THREE.DoubleSide });
  for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) {
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat); gm.rotation.y = Math.PI / 2; gm.position.set(x, y0 + H, 0); gm.castShadow = true; g.add(gm);
    box(g, 0.1, 1.6, 0.14, timber, x + Math.sign(x) * 0.03, y0 + H + 0.8, 0);
  }
  box(g, 0.08, 0.7, 0.6, wood, W / 2 + 0.08, y0 + H + 0.45, 0.45);
  // layered thatch roof
  const roof = thatchRoof(W + 0.9, D + 1.2, 1.95, thatch, thatchDark); roof.position.y = y0 + H - 0.05; g.add(roof);
  // stone chimney on the upstream gable, with smoke-blackened cap
  { const cx = -W / 2 + 0.8, cz = -0.75, top = y0 + H + 3.0, cs = mw('#d2c2a4', 0.35), cs2 = mw('#b6a587', 0.35);
    box(g, 0.74, top - y0 - H - 0.1, 0.74, cs2, cx, (top + y0 + H) / 2 - 0.05, cz);
    for (let k = 0; k < 9; k++) {
      const y = y0 + H + 0.1 + k * 0.32, o = k % 2 ? 0.2 : -0.2;
      for (const [dx, dz, w, d] of [[o, -0.38, 0.46, 0.08], [-o, 0.38, 0.46, 0.08], [-0.38, o, 0.08, 0.46], [0.38, -o, 0.08, 0.46]] as const)
        box(g, w + 0.02, 0.27, d + 0.02, (k + (dx > 0 ? 1 : 0)) % 3 ? cs : cs2, cx + dx, y, cz + dz);
    }
    box(g, 0.9, 0.12, 0.9, cs2, cx, top + 0.02, cz);
    for (const dx of [-0.24, 0.24]) box(g, 0.14, 0.24, 0.62, cs, cx + dx, top + 0.2, cz);
    box(g, 0.7, 0.07, 0.7, cs2, cx, top + 0.34, cz); }
  // flagstone apron in front of the door, stepped down to the ground
  const apronZ = -D / 2 - 0.95;
  box(g, W + 0.6, footTop + 1.4, 1.3, stoneDark, 0, (footTop - 1.4) / 2, apronZ);
  for (let i = 0; i < 6; i++) box(g, (W + 0.5) / 6 - 0.05, 0.06, 1.24, i % 2 ? stone : mw('#cbbd9f', 0.35), -(W + 0.5) / 2 + (i + 0.5) * ((W + 0.5) / 6), footTop + 0.02, apronZ);
  box(g, 1.3, footTop + 1.1, 0.5, stone, 0.75, (footTop - 0.12) - (footTop + 1.1) / 2, apronZ - 0.85); // door step
  // door (planked, with strap hinges), lantern, windows
  box(g, 1.0, 1.75, 0.1, wood, 0.75, y0 + 0.88, -D / 2 - 0.08);
  for (const yy of [0.4, 1.35]) box(g, 0.8, 0.06, 0.04, m('#2e2a28', 0.2), 0.62, y0 + yy, -D / 2 - 0.14);
  box(g, 1.3, 0.14, 0.34, timber, 0.75, y0 + 1.84, -D / 2 - 0.14);
  // small door canopy
  const can = box(g, 1.5, 0.08, 0.7, thatchDark, 0.75, y0 + 2.02, -D / 2 - 0.4); can.rotation.x = -0.35;
  const glow = toon({ color: '#ffd68a', emissive: '#ffae45', emissiveIntensity: 0.75, rim: 0.1 });
  framedWindow(g, -1.15, y0 + 1.4, -D / 2 - 0.08, Math.PI, glow, timber);
  framedWindow(g, W / 2 + 0.07, y0 + 1.25, -0.7, Math.PI / 2, glow, timber);
  framedWindow(g, 1.1, y0 + 1.4, D / 2 + 0.08, 0, glow, timber);
  const lamp = new THREE.Group(); lamp.position.set(1.6, y0 + 1.95, -D / 2 - 0.3);
  box(lamp, 0.05, 0.3, 0.05, timber, 0, 0.12, 0.12); cyl(lamp, 0.15, 0.12, 0.3, glow, 0, -0.12, 0, 8); cyl(lamp, 0.03, 0.2, 0.1, timber, 0, 0.06, 0, 8); g.add(lamp);
  // millstone leaning by the door, grain sacks, barrel, bench
  const ms = cyl(g, 0.5, 0.5, 0.16, stone, -1.95, footTop + 0.55, -D / 2 - 0.28, 16); ms.rotation.x = Math.PI / 2 - 0.2; ms.position.z = -D / 2 - 0.45;
  const eye = cyl(g, 0.11, 0.11, 0.18, stoneDark, -1.95, footTop + 0.55, -D / 2 - 0.29, 8); eye.rotation.x = Math.PI / 2 - 0.2; eye.position.z = -D / 2 - 0.46;
  const sack = m('#dccb9e', 0.3);
  for (const [x, z, k, ry] of [[-0.45, -D / 2 - 0.45, 1, 0.3], [-0.05, -D / 2 - 0.42, 0.9, -0.4], [-0.27, -D / 2 - 0.5, 0.8, 1.2]] as const) {
    const sk = new THREE.Group(); sk.position.set(x, footTop + 0.05 + (k < 0.85 ? 0.5 : 0), z); sk.rotation.y = ry; g.add(sk);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * k, 0.28 * k, 4, 10), sack); body.position.y = 0.36 * k; body.scale.set(1, 1, 0.75); body.castShadow = true; sk.add(body);
    const neck = cyl(sk, 0.07 * k, 0.12 * k, 0.14 * k, sack, 0, 0.78 * k, 0, 8); void neck;
    cyl(sk, 0.08 * k, 0.08 * k, 0.04, m('#8a6a3a', 0.3), 0, 0.73 * k, 0, 8);
  }
  const barrel = cyl(g, 0.3, 0.27, 0.7, wood, 1.75, footTop + 0.4, -D / 2 - 0.5, 12); void barrel;
  for (const yy of [0.16, 0.62]) cyl(g, 0.31, 0.31, 0.05, m('#3a3532', 0.2), 1.75, footTop + yy, -D / 2 - 0.5, 12);
  // climbing rose on a little trellis beside the door
  const rose = [m('#d9607a', 0.5), m('#f3a0b4', 0.5)], leaf = m('#4f7d3c', 0.35), lath = m('#d9c3a0', 0.35);
  for (let k = 0; k < 7; k++) for (const sg2 of [-1, 1]) {
    const l = box(g, 0.05, 2.6, 0.04, lath, 2.07 + (k - 3) * 0.13, y0 + 1.1, -D / 2 - 0.1); l.rotation.z = sg2 * 0.42;
  }
  box(g, 0.85, 0.06, 0.06, lath, 2.07, y0 + 2.25, -D / 2 - 0.1);
  const rnd = mulberry32(77);
  for (let i = 0; i < 46; i++) {
    const t = rnd(), x = 2.07 + (rnd() - 0.5) * (0.35 + t * 0.5), y = y0 + 0.1 + t * 2.15;
    const lf = new THREE.Mesh(new THREE.SphereGeometry(0.07 + rnd() * 0.05, 5, 4), leaf); lf.position.set(x, y, -D / 2 - 0.15 - rnd() * 0.08); lf.scale.set(1.2, 0.8, 0.6); g.add(lf);
    if (rnd() < 0.3) { const r2 = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 5), rose[i % 2]); r2.position.set(x, y + 0.03, -D / 2 - 0.24); g.add(r2); }
  }

  // breastshot wheel turning in the race, fed by a flume from the mill pond above the weir
  const wheel = new THREE.Group();
  const R = 1.35, zc = D / 2 + 1.55, wx = -0.95;
  const wy = race + R - 0.5; // rim dips 0.5 m into the race
  wheel.position.set(wx, wy, zc);
  const wWood = m('#8c6646', 0.35), wDark = m('#5a4030', 0.25);
  for (const dz of [-0.36, 0.36]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.08, 6, 32), wDark); rim.position.z = dz; rim.castShadow = true; wheel.add(rim);
    for (let i = 0; i < 6; i++) { const sp = box(wheel, 0.1, R * 2, 0.1, wWood, 0, 0, dz); sp.rotation.z = (i / 6) * Math.PI; }
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const pd = box(wheel, 0.06, 0.4, 0.8, wWood, Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), 0);
    pd.rotation.z = a;
  }
  const hub = cyl(wheel, 0.22, 0.22, 0.86, wDark, 0, 0, 0, 10); hub.rotation.x = Math.PI / 2;
  g.add(wheel);
  const axle = cyl(g, 0.13, 0.13, zc - D / 2 + 0.9, wDark, wx, wy, D / 2 + (zc - D / 2 + 0.9) / 2, 10); axle.rotation.x = Math.PI / 2;
  box(g, 0.62, 0.5, 0.4, timber, wx, wy, D / 2 + 0.55); box(g, 0.74, 0.12, 0.46, wDark, wx, wy + 0.3, D / 2 + 0.55); // wall bearing
  box(g, 0.4, 0.34, 0.3, wDark, wx, wy, zc + 0.75); // outer bearing block
  for (const dz of [-0.47, 0.47]) { const plate = cyl(wheel, 0.32, 0.32, 0.05, m('#3c3836', 0.3), 0, 0, dz, 10); plate.rotation.x = Math.PI / 2; }
  // outer bearing: a stone pier standing in the race
  for (const dx of [-0.45, 0.45]) { const leg = box(g, 0.16, wy - race + 1.1, 0.16, timber, wx + dx * 0.55, (wy + race - 1.1) / 2, zc + 0.75); leg.rotation.z = -dx * 0.35; }
  box(g, 0.7, 0.14, 0.2, timber, wx, wy - 0.12, zc + 0.75);
  // flume: a timber chute taking water off the weir crest and delivering it to the wheel at hub height
  g.updateMatrixWorld(true);
  const wf = streamFrame(WEIR_T);
  const weirLocal = g.worldToLocal(new THREE.Vector3(wf.x, 0, wf.z));
  const fx0 = weirLocal.x - 0.15, fx1 = wx - R - 0.08;
  const fy0 = pond - 0.06, fy1 = wy + 0.05;
  const fl = new THREE.Group(); fl.position.set(0, 0, zc);
  const len = Math.hypot(fx1 - fx0, fy1 - fy0), tilt = Math.atan2(fy1 - fy0, fx1 - fx0);
  const chute = new THREE.Group(); chute.position.set((fx0 + fx1) / 2, (fy0 + fy1) / 2, 0); chute.rotation.z = tilt; fl.add(chute);
  box(chute, len, 0.08, 0.72, wood, 0, -0.18, 0);
  for (const s2 of [-1, 1]) box(chute, len, 0.34, 0.07, wood, 0, -0.02, s2 * 0.36);
  const fw = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.62), new THREE.MeshBasicMaterial({ color: '#a9dccf', transparent: true, opacity: 0.88 }));
  fw.position.set(0, 0.0, 0); chute.add(fw);
  for (const x of [fx0 + 0.35, (fx0 + fx1) / 2, fx1 - 0.2]) {
    const top = fy0 + (fy1 - fy0) * ((x - fx0) / (fx1 - fx0)) - 0.22;
    for (const s2 of [-1, 1]) box(fl, 0.1, top - race + 0.5, 0.1, timber, x, (top + race - 0.5) / 2, s2 * 0.32);
  }
  // sluice gate at the intake: two posts, a cross head and a raised gate board
  for (const s2 of [-1, 1]) box(fl, 0.14, 1.3, 0.14, timber, fx0 + 0.1, fy0 + 0.35, s2 * 0.44);
  box(fl, 0.2, 0.14, 1.05, timber, fx0 + 0.1, fy0 + 1.0, 0);
  box(fl, 0.07, 0.42, 0.78, wood, fx0 + 0.1, fy0 + 0.62, 0);
  // water riding the buckets: foamy bands filling the upstream-lower quarter, visible on both wheel faces
  const bucketMat = new THREE.MeshBasicMaterial({ color: '#f1faf8', transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false });
  for (const zz of [-0.4, 0.4]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.5, R + 0.08, 24, 1, Math.PI * 0.95, 1.5), bucketMat);
    ring.position.set(wx, wy, zz); fl.add(ring);
  }
  // the jet leaving the chute lip onto the first bucket
  const jet = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.62), bucketMat);
  jet.position.set(fx1 + 0.05, fy1 - 0.25, 0); jet.rotation.y = Math.PI / 2; fl.add(jet);
  // splash where wheel meets the race
  const foamM = new THREE.MeshBasicMaterial({ color: '#f4fbf9', transparent: true, opacity: 0.9 });
  const sr = mulberry32(12);
  for (let i = 0; i < 16; i++) {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14 + sr() * 0.16, 0), foamM);
    f.position.set(wx - 0.9 + sr() * 1.9, race + 0.04 + sr() * 0.1, (sr() - 0.5) * 1.2); f.scale.y = 0.5; fl.add(f);
  }
  g.add(fl);
  return { group: g, wheel };
}

// ---------------------------------------------------------------- weir
let _ct: THREE.CanvasTexture | null = null;
function curtainTex(): THREE.CanvasTexture {
  if (_ct) return _ct;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d')!;
  const rnd = mulberry32(9);
  for (let i = 0; i < 70; i++) {
    const px = rnd() * 128, w = 1 + rnd() * 4, a = 0.25 + rnd() * 0.6;
    const grd = x.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, `rgba(255,255,255,${a})`); grd.addColorStop(0.7, `rgba(255,255,255,${a * 0.6})`); grd.addColorStop(1, 'rgba(255,255,255,0.95)');
    x.fillStyle = grd; x.fillRect(px, 0, w, 64);
  }
  _ct = new THREE.CanvasTexture(c); _ct.wrapS = THREE.RepeatWrapping; _ct.repeat.set(3, 1);
  return _ct;
}

function createWeir(): THREE.Group {
  const g = new THREE.Group();
  const f = streamFrame(WEIR_T - 0.003), up = streamFrame(WEIR_T - 0.02).level, down = streamFrame(WEIR_T + 0.02).level;
  const hw = channelHalf(WEIR_T) + 0.7;
  g.position.set(f.x, 0, f.z); g.rotation.y = Math.atan2(-f.tz, f.tx); // local x downstream, local z across
  const plank = m('#6b5038', 0.3), post = m('#4c3828', 0.25), stone = m('#9a978a', 0.25);
  const bed = heightAt(f.x, f.z) - 0.2;
  // stacked boards with a capping beam just under the pond surface
  for (let k = 0; k < 4; k++) { const y = bed + (k + 0.5) * ((up - 0.04 - bed) / 4); box(g, 0.2, (up - 0.04 - bed) / 4 - 0.02, hw * 2, plank, 0, y, 0); }
  box(g, 0.34, 0.14, hw * 2 + 0.3, post, 0.02, up - 0.06, 0);
  for (let i = 0; i < 5; i++) box(g, 0.16, up - bed + 0.45, 0.16, post, -0.18, (up + bed) / 2 + 0.2, -hw + 0.3 + (i / 4) * (hw * 2 - 0.6));
  // the water curtain spilling over the crest
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 0.2, up - down + 0.1, 1, 1), new THREE.MeshBasicMaterial({ map: curtainTex(), color: '#eaf7f3', transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  curtain.rotation.y = Math.PI / 2; curtain.rotation.z = 0; curtain.position.set(0.22, (up + down) / 2 - 0.02, 0); curtain.rotation.x = 0;
  const cg = new THREE.Group(); cg.add(curtain); cg.rotation.z = -0.18; cg.position.set(0, 0, 0); g.add(cg);
  // dressed stone cheeks set into each bank
  for (const s2 of [-1, 1]) {
    const c = box(g, 0.9, up - bed + 0.5, 0.6, stone, 0, (up + bed) / 2 + 0.15, s2 * (hw + 0.2));
    c.rotation.y = 0;
  }
  return g;
}

// ---------------------------------------------------------------- bridge
const BR_L = 2 * (channelHalf(0.55) + 1.9), BR_A = 1.05, BR_HALF_W = 0.95;
const deckY = (u: number) => BRIDGE.y + 0.12 + BR_A * (1 - (2 * u / BR_L) ** 2);
function createBridge(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(BRIDGE.x, 0, BRIDGE.z); g.rotation.y = Math.atan2(BRIDGE_DIR.x, BRIDGE_DIR.y); // local z along the path
  const deck = m('#a77c55', 0.35), deckDk = m('#8a6444', 0.3), beam = m('#5e4130', 0.25);
  const red = m('#c0523b', 0.45), redDk = m('#93402f', 0.3), bronze = m('#b08a4a', 0.55);
  const stone = m('#a19d90', 0.25), stoneDk = m('#7f7c72', 0.25);
  const ends = BR_L / 2;
  // curved stringers under the deck, plus a lower laminated arch visible from the side
  for (const x of [-0.78, 0.78]) {
    const top = [], arch = [];
    for (let i = 0; i <= 12; i++) { const u = -ends - 0.3 + (i / 12) * (BR_L + 0.6); top.push(new THREE.Vector3(x, deckY(u) - 0.2, u)); }
    for (let i = 0; i <= 12; i++) { const u = -ends + 0.2 + (i / 12) * (BR_L - 0.4); arch.push(new THREE.Vector3(x, deckY(u) - 0.55 - 0.25 * (1 - (2 * u / BR_L) ** 2), u)); }
    const st = new THREE.Mesh(tube(top, 0.14, 0.14, 6, 30), beam); st.castShadow = true; g.add(st);
    void arch;
    const fp = [];
    for (let i = 0; i <= 16; i++) { const u = -ends - 0.2 + (i / 16) * (BR_L + 0.4); fp.push(new THREE.Vector3(0, deckY(u) - 0.2, u)); }
    const fas = new THREE.Mesh(tube(fp, 0.2, 0.2, 10, 40), red); fas.scale.set(0.42, 1, 1);
    const fg = new THREE.Group(); fg.position.x = Math.sign(x) * (BR_HALF_W + 0.06); fg.add(fas); g.add(fg);
  }
  // planks: alternating tones, slight overhang, gaps
  const n = 22;
  for (let i = 0; i < n; i++) {
    const u = -ends + (i + 0.5) * (BR_L / n);
    const p = box(g, BR_HALF_W * 2 + 0.06, 0.08, BR_L / n - 0.035, i % 3 ? deck : deckDk, ((i * 7) % 3 - 1) * 0.015, deckY(u) - 0.05, u);
    p.rotation.x = Math.atan(-8 * BR_A * u / (BR_L * BR_L));
  }
  // vermilion railings: posts, top rail (kasagi) and mid rail, bronze giboshi on the end posts
  for (const x of [-BR_HALF_W, BR_HALF_W]) {
    const rail = [], mid = [];
    for (let i = 0; i <= 12; i++) { const u = -ends + (i / 12) * BR_L; rail.push(new THREE.Vector3(x, deckY(u) + 0.86, u)); mid.push(new THREE.Vector3(x, deckY(u) + 0.45, u)); }
    const tr = new THREE.Mesh(tube(rail, 0.055, 0.055, 8, 30), red); tr.castShadow = true; g.add(tr);
    const mr = new THREE.Mesh(tube(mid, 0.035, 0.035, 6, 30), redDk); g.add(mr);
    for (let i = 0; i <= 6; i++) {
      const u = -ends + (i / 6) * BR_L, endPost = i === 0 || i === 6;
      box(g, endPost ? 0.16 : 0.1, endPost ? 1.08 : 0.92, endPost ? 0.16 : 0.1, red, x, deckY(u) + (endPost ? 0.48 : 0.42), u);
      if (endPost) {
        const cap = new THREE.Group(); cap.position.set(x, deckY(u) + 1.06, u); g.add(cap);
        cyl(cap, 0.12, 0.12, 0.07, bronze, 0, 0, 0, 10);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), bronze); bulb.position.y = 0.13; bulb.scale.y = 0.9; cap.add(bulb);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), bronze); tip.position.y = 0.3; cap.add(tip);
      }
    }
  }
  // dressed-stone abutments: a sunk stone pier under each deck end, wing walls curving into the bank
  for (const sgn of [-1, 1]) {
    const u0 = sgn * (ends - 0.75);
    const top = deckY(u0) - 0.26;
    let lo = Infinity;
    for (const xx of [-1.3, 0, 1.3]) for (const uu of [u0 - 0.5, u0, u0 + 0.5]) {
      const wx = BRIDGE.x + BRIDGE_DIR.y * xx + BRIDGE_DIR.x * uu, wz = BRIDGE.z - BRIDGE_DIR.x * xx + BRIDGE_DIR.y * uu;
      lo = Math.min(lo, heightAt(wx, wz));
    }
    const bot = lo - 1.0, hgt = top - bot, rows = Math.max(2, Math.round(hgt / 0.3));
    for (let r = 0; r < rows; r++) {
      const h = hgt / rows, y = top - h / 2 - r * h;
      for (let k = 0; k < 3; k++) {
        const bl = box(g, 0.74 + ((r + k) % 2) * 0.12, h - 0.03, 0.9, (r + k) % 2 ? stone : stoneDk, (k - 1) * 0.82 + (r % 2 ? 0.1 : -0.05), y, u0);
        bl.rotation.y = ((r * 3 + k) % 5 - 2) * 0.015;
      }
    }
    box(g, 2.6, 0.1, 1.0, stoneDk, 0, top + 0.04, u0);
    // pale flagstone landing: slabs stepping from the deck lip down to the path, clearly read as steps
    const slab = m('#d8cfbc', 0.35), slab2 = m('#c7bda8', 0.35);
    const yEnd = deckY(sgn * ends) - 0.02;
    for (let k = 0; k < 4; k++) {
      const uu = sgn * (ends + 0.25 + 0.5 * k);
      const gy = heightAt(BRIDGE.x + BRIDGE_DIR.x * uu, BRIDGE.z + BRIDGE_DIR.y * uu);
      const top = Math.max(gy + 0.12, yEnd - (yEnd - gy - 0.12) * ((k + 1) / 4));
      const h = top - gy + 0.4;
      const st = box(g, 2.15 - k * 0.08, h, 0.48, k % 2 ? slab : slab2, ((k * 5) % 3 - 1) * 0.04, top - h / 2, uu);
      st.rotation.y = ((k * 7) % 5 - 2) * 0.025;
    }
    // a small stone lantern on the downstream side of each end
    const lx = sgn > 0 ? -1.45 : 1.45, lu = sgn * (ends + 0.15);
    const lwx = BRIDGE.x + BRIDGE_DIR.y * lx + BRIDGE_DIR.x * lu, lwz = BRIDGE.z - BRIDGE_DIR.x * lx + BRIDGE_DIR.y * lu;
    const ly = heightAt(lwx, lwz);
    const lan = new THREE.Group(); lan.position.set(lx, ly, lu); g.add(lan);
    cyl(lan, 0.28, 0.34, 0.18, stoneDk, 0, 0.09, 0, 6);
    cyl(lan, 0.1, 0.13, 0.55, stone, 0, 0.45, 0, 6);
    box(lan, 0.44, 0.08, 0.44, stone, 0, 0.75, 0);
    box(lan, 0.32, 0.3, 0.32, toon({ color: '#ffe2a0', emissive: '#ffb04a', emissiveIntensity: 0.8, rim: 0.1 }), 0, 0.94, 0);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.28, 4), stoneDk); roof.position.y = 1.23; roof.rotation.y = Math.PI / 4; roof.castShadow = true; lan.add(roof);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), stone); knob.position.y = 1.4; lan.add(knob);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
walkSurfaces.push((x, z) => {
  const dx = x - BRIDGE.x, dz = z - BRIDGE.z;
  const u = dx * BRIDGE_DIR.x + dz * BRIDGE_DIR.y, w = dx * BRIDGE_DIR.y - dz * BRIDGE_DIR.x;
  if (Math.abs(u) > BR_L / 2 + 0.2 || Math.abs(w) > BR_HALF_W) return null;
  return deckY(Math.max(-BR_L / 2, Math.min(BR_L / 2, u)));
});

// ---------------------------------------------------------------- banks: rocks, reeds, spring
function createBanks(): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(77);
  const rocks: THREE.BufferGeometry[] = [];
  const moss = new THREE.Color('#7f9e58'), grey = new THREE.Color('#aaa696'), dark = new THREE.Color('#8b8b80');
  const rockAt = (x: number, z: number, r: number, sink: number, mossy: number) => {
    const geo = blob(r, 1, 0.32, rand() * 50, 0.62);
    // moss on the tops: tint upper vertices green
    const p = geo.attributes.position as THREE.BufferAttribute; const cols = new Float32Array(p.count * 3); const c = new THREE.Color();
    const base = grey.clone().lerp(dark, rand() * 0.6);
    for (let i = 0; i < p.count; i++) { c.copy(base).lerp(moss, mossy * Math.max(0, p.getY(i) / r) * 1.4); cols.set([c.r, c.g, c.b], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    place(geo, x, heightAt(x, z) + r * (0.62 - sink), z, rand() * 0.4, rand() * 6, rand() * 0.3);
    rocks.push(geo);
  };
  const near = (x: number, z: number, px: number, pz: number, r: number) => Math.hypot(x - px, z - pz) < r;
  const wheelW = new THREE.Vector3(MILL.x, 0, MILL.z);
  // scattered bank stones, more on the outside of bends
  for (let c = 0; c < 16; c++) {
    const t0 = 0.05 + rand() * 0.62, side = rand() < 0.5 ? -1 : 1, cnt = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < cnt; k++) {
      const t = t0 + (rand() - 0.5) * 0.03, f = streamFrame(t);
      const off = channelHalf(t) - 0.2 + rand() * 0.9;
      const x = f.x + f.nx * side * off, z = f.z + f.nz * side * off;
      if (near(x, z, BRIDGE.x, BRIDGE.z, 3.6) || near(x, z, wheelW.x, wheelW.z, MILL_OFF + 2.5) || Math.abs(t - WEIR_T) < 0.02) continue;
      rockAt(x, z, (k === 0 ? 0.55 : 0.22) + rand() * 0.35, 0.3, 0.7);
    }
  }
  // stepping-stone pairs in the shallows below the bridge (a second, playful crossing)
  // spring head: big mossy boulders cupping the pool, under the hill
  const h = streamFrame(0);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + (i / 8) * 0.9); // behind and to the sides of the pool only
    const r = channelHalf(0) + 1.3 + rand() * 0.7;
    const bx = h.x - h.tx * Math.sin(a) * r * 0.9 + h.nx * Math.cos(a) * r, bz = h.z - h.tz * Math.sin(a) * r * 0.9 + h.nz * Math.cos(a) * r;
    rockAt(bx, bz, 0.8 + rand() * 0.8, 0.2, 1.0);
  }
  const rm = new THREE.Mesh(merge(rocks), toon({ vertexColors: true, rim: 0.25 }));
  rm.castShadow = rm.receiveShadow = true; g.add(rm);

  // bamboo spout (kakehi) pouring the spring into its pool
  const sp = new THREE.Group();
  const top = new THREE.Vector3(h.x - h.tx * 2.6, h.level + 1.25, h.z - h.tz * 2.6);
  const tip = new THREE.Vector3(h.x - h.tx * 0.6, h.level + 0.95, h.z - h.tz * 0.6);
  const bam = m('#8fae62', 0.45);
  const pipe = new THREE.Mesh(tube([top, tip], 0.13, 0.12, 8, 2), bam); pipe.castShadow = true; sp.add(pipe);
  for (const q of [0.3, 0.8]) { const pp = top.clone().lerp(tip, q); const leg = cyl(sp, 0.035, 0.035, pp.y - h.level + 0.3, m('#6e5a3e'), pp.x, (pp.y + h.level - 0.3) / 2, pp.z, 6); void leg; }
  const pour = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, tip.y - h.level, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#e6f7f4', transparent: true, opacity: 0.9, depthWrite: false }));
  pour.position.set(tip.x + h.tx * 0.08, (tip.y + h.level) / 2, tip.z + h.tz * 0.08); sp.add(pour);
  g.add(sp);

  // reeds and irises in the shallows, clustered; none at the bridge, weir or wheel
  const blade = new THREE.ConeGeometry(0.035, 1, 3, 1); blade.translate(0, 0.5, 0);
  const tuft: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) { const b = blade.clone(); b.scale(1, 0.7 + (k % 3) * 0.25, 1); b.rotateZ((k - 2.5) * 0.12); b.rotateY(k * 1.1); b.translate((k % 3 - 1) * 0.06, 0, ((k >> 1) % 2 - 0.5) * 0.08); tuft.push(paint(b, k % 2 ? '#6f9a4c' : '#86ad58')); }
  const stalk = new THREE.CylinderGeometry(0.012, 0.016, 1.15, 4); stalk.translate(0.03, 0.575, 0); tuft.push(paint(stalk, '#7c9a50'));
  const head = new THREE.CylinderGeometry(0.035, 0.035, 0.17, 6); head.translate(0.03, 1.05, 0); tuft.push(paint(head, '#6a4a32'));
  const reedGeo = merge(tuft);
  const reeds = new THREE.InstancedMesh(reedGeo, toon({ vertexColors: true, rim: 0.4, sway: 0.25, swayHeight: 1.2 }), 420);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  let n = 0;
  for (let c = 0; c < 70 && n < 420; c++) {
    const t = 0.03 + rand() * 0.72, f = streamFrame(t), side = rand() < 0.5 ? -1 : 1;
    const off = channelHalf(t) - 0.15 + rand() * 0.5;
    const cx = f.x + f.nx * side * off, cz = f.z + f.nz * side * off;
    if (near(cx, cz, BRIDGE.x, BRIDGE.z, 3.2) || near(cx, cz, wheelW.x, wheelW.z, MILL_OFF + 1.8) || Math.abs(t - WEIR_T) < 0.025) continue;
    const cnt = 4 + Math.floor(rand() * 6);
    for (let k = 0; k < cnt && n < 420; k++) {
      const x = cx + (rand() - 0.5) * 1.1, z = cz + (rand() - 0.5) * 1.1;
      ps.set(x, Math.max(heightAt(x, z), streamNearest(x, z).level - 0.25) - 0.05, z);
      e.set((rand() - 0.5) * 0.25, rand() * 6.28, (rand() - 0.5) * 0.25);
      const k2 = 0.55 + rand() * 0.4; sc.set(k2, k2 * (0.8 + rand() * 0.5), k2);
      reeds.setMatrixAt(n++, mt.compose(ps, q.setFromEuler(e), sc));
    }
  }
  reeds.count = n; reeds.castShadow = true; reeds.receiveShadow = true; g.add(reeds);
  return g;
}

export interface BrookPlace extends PlaceLandmark { update(time: number, dt: number): void; mill: THREE.Vector3 }

export function createKettleBrook(): BrookPlace {
  const g = new THREE.Group();
  g.add(createWater());
  g.add(createWeir());
  const mill = createMill();
  g.add(mill.group);
  g.add(createBridge());
  g.add(createBanks());
  return {
    group: g, name: 'Kettle Brook', mill: MILL.clone(),
    focus: new THREE.Vector3(BRIDGE.x, BRIDGE.y + 0.8, BRIDGE.z),
    update(_time, dt) { mill.wheel.rotation.z += dt * 0.9; },
  };
}
