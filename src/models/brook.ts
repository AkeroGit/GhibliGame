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
function gableRoof(len: number, span: number, rise: number, thick: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const slope = Math.hypot(span / 2, rise), ang = Math.atan2(rise, span / 2);
  for (const s of [-1, 1]) {
    const p = box(g, len, thick, slope + 0.5, mat, 0, rise / 2, s * span / 4);
    p.rotation.x = s * ang;
  }
  return g;
}

function framedWindow(g: THREE.Object3D, x: number, y: number, z: number, ry: number, glow: THREE.Material, frame: THREE.Material) {
  const w = new THREE.Group(); w.position.set(x, y, z); w.rotation.y = ry;
  box(w, 0.8, 0.62, 0.05, glow, 0, 0, 0);
  box(w, 0.96, 0.1, 0.1, frame, 0, 0.36, 0.02); box(w, 0.96, 0.1, 0.1, frame, 0, -0.36, 0.02);
  box(w, 0.1, 0.72, 0.1, frame, -0.45, 0, 0.02); box(w, 0.1, 0.72, 0.1, frame, 0.45, 0, 0.02);
  box(w, 0.05, 0.62, 0.07, frame, 0, 0, 0.03); box(w, 0.8, 0.05, 0.07, frame, 0, 0.05, 0.03);
  box(w, 1.0, 0.07, 0.22, frame, 0, -0.42, 0.08); // sill
  g.add(w);
}

function createMill() {
  const g = new THREE.Group();
  g.position.copy(MILL); g.rotation.y = MILL_YAW;
  const stone = m('#8f8b80', 0.25), stoneDark = m('#6a6b66', 0.25);
  const plaster = m('#efe3c8', 0.3), timber = m('#4f3a2c', 0.25), wood = m('#7a5638', 0.3);
  const thatch = m('#b7955c', 0.45), thatchDark = m('#7d6440', 0.3);
  const W = 4.6, D = 3.4, H = 2.4;
  // brook side (+z): race level below the weir; pond level above it
  const race = streamFrame(MILL_T).level - MILL.y, pond = streamFrame(WEIR_T - 0.01).level - MILL.y;
  // stone plinth: deep footing on the brook side so the building stands in its bank, not on the water
  box(g, W + 0.6, 0.9 - race, D + 0.5, stone, 0, (0.15 + race - 0.75) / 2, 0.1);
  box(g, W + 0.8, 0.16, D + 0.7, stoneDark, 0, 0.18, 0.1);
  // timber-framed plaster walls
  box(g, W, H, D, plaster, 0, 0.26 + H / 2, 0);
  for (const x of [-W / 2, -W / 6, W / 6, W / 2]) for (const z of [-D / 2 - 0.03, D / 2 + 0.03]) box(g, 0.2, H, 0.12, timber, x, 0.26 + H / 2, z);
  for (const z of [-D / 2 - 0.04, D / 2 + 0.04]) { box(g, W + 0.1, 0.16, 0.12, timber, 0, 0.34, z); box(g, W + 0.1, 0.14, 0.12, timber, 0, 0.26 + H * 0.58, z); box(g, W + 0.1, 0.18, 0.14, timber, 0, 0.26 + H, z); }
  for (const x of [-W / 2 - 0.03, W / 2 + 0.03]) { box(g, 0.12, 0.14, D, timber, x, 0.26 + H * 0.58, 0); for (const z of [-D / 2, D / 2]) box(g, 0.2, H, 0.2, timber, x, 0.26 + H / 2, z); }
  // gable ends: plaster triangle with a timber king post
  const tri = new THREE.Shape(); tri.moveTo(-D / 2 - 0.05, 0); tri.lineTo(D / 2 + 0.05, 0); tri.lineTo(0, 1.6); tri.closePath();
  const gableMat = toon({ color: '#e8d9ba', rim: 0.3, side: THREE.DoubleSide });
  for (const x of [-W / 2 - 0.02, W / 2 + 0.02]) {
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat); gm.rotation.y = Math.PI / 2; gm.position.set(x, 0.26 + H, 0); gm.castShadow = true; g.add(gm);
    box(g, 0.1, 1.5, 0.14, timber, x + Math.sign(x) * 0.03, 0.26 + H + 0.75, 0);
  }
  // deep, soft thatch: rounded eaves, ridge cap tucked in (no beam poking out)
  const roof = gableRoof(W + 1.2, D + 1.5, 1.75, 0.5, thatch); roof.position.y = 0.26 + H - 0.08; g.add(roof);
  const ridge = cyl(g, 0.3, 0.3, W + 1.0, thatchDark, 0, 0.26 + H + 1.72, 0, 10); ridge.rotation.z = Math.PI / 2; ridge.scale.set(1, 1, 0.8);
  // door, lantern and windows
  box(g, 1.0, 1.75, 0.1, wood, 0.75, 0.26 + 0.88, -D / 2 - 0.08);
  for (const yy of [0.5, 1.2]) box(g, 0.9, 0.06, 0.05, timber, 0.75, 0.26 + yy, -D / 2 - 0.14);
  box(g, 1.25, 0.14, 0.32, timber, 0.75, 0.26 + 1.84, -D / 2 - 0.14);
  const glow = toon({ color: '#ffd68a', emissive: '#ffae45', emissiveIntensity: 0.75, rim: 0.1 });
  framedWindow(g, -1.15, 0.26 + 1.4, -D / 2 - 0.08, Math.PI, glow, timber);
  framedWindow(g, W / 2 + 0.07, 0.26 + 1.4, -0.3, Math.PI / 2, glow, timber);
  framedWindow(g, 1.1, 0.26 + 1.4, D / 2 + 0.08, 0, glow, timber);
  const lamp = new THREE.Group(); lamp.position.set(1.55, 0.26 + 1.95, -D / 2 - 0.3);
  box(lamp, 0.05, 0.3, 0.05, timber, 0, 0.12, 0.12); cyl(lamp, 0.15, 0.12, 0.3, glow, 0, -0.12, 0, 8); cyl(lamp, 0.03, 0.2, 0.1, timber, 0, 0.06, 0, 8); g.add(lamp);
  // grain sacks, a cart wheel and a bench by the door
  const sack = m('#dccb9e', 0.3);
  for (const [x, z, k] of [[-0.35, -D / 2 - 0.5, 1], [-0.7, -D / 2 - 0.42, 0.85], [-0.5, -D / 2 - 0.88, 0.9]] as const) {
    const b = new THREE.Mesh(blob(0.32 * k, 1, 0.12, x * 9, 1.15), sack); b.position.set(x, 0.26 + 0.3 * k, z); b.castShadow = true; g.add(b);
  }
  box(g, 1.3, 0.1, 0.38, wood, -1.6, 0.72, -D / 2 - 0.45);
  for (const x of [-2.1, -1.1]) box(g, 0.1, 0.42, 0.3, timber, x, 0.49, -D / 2 - 0.45);

  // breastshot wheel turning in the race, fed by a flume from the mill pond above the weir
  const wheel = new THREE.Group();
  const R = 1.35, zc = D / 2 + 0.95, wx = -0.95;
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
  const axle = cyl(g, 0.09, 0.09, zc - D / 2 + 0.8, wDark, wx, wy, D / 2 + (zc - D / 2 + 0.8) / 2, 8); axle.rotation.x = Math.PI / 2;
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
  // white water spilling off the chute onto the paddles
  const spillMat = new THREE.MeshBasicMaterial({ color: '#eef8f6', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.9), spillMat);
  spill.position.set(fx1 + 0.12, fy1 - 0.42, 0); spill.rotation.y = Math.PI / 2; spill.rotation.x = 0.15; fl.add(spill);
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
const BR_L = 2 * (channelHalf(0.55) + 1.9), BR_A = 0.75, BR_HALF_W = 0.95;
const deckY = (u: number) => BRIDGE.y + 0.12 + BR_A * (1 - (2 * u / BR_L) ** 2);
function createBridge(): THREE.Group {
  const g = new THREE.Group();
  g.position.set(BRIDGE.x, 0, BRIDGE.z); g.rotation.y = Math.atan2(BRIDGE_DIR.x, BRIDGE_DIR.y); // local z along the path
  const wood = m('#9c7552', 0.35), dark = m('#5a3f2c', 0.25), cap = m('#b8553f', 0.45);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const u = -BR_L / 2 + (i + 0.5) * (BR_L / n), y = deckY(u) - 0.05;
    const p = box(g, BR_HALF_W * 2 + 0.2, 0.09, BR_L / n - 0.04, wood, 0, y, u);
    p.rotation.x = Math.atan(-8 * BR_A * u / (BR_L * BR_L));
  }
  for (const x of [-0.72, 0.72]) {
    const pts = []; for (let i = 0; i <= 8; i++) { const u = -BR_L / 2 - 0.2 + (i / 8) * (BR_L + 0.4); pts.push(new THREE.Vector3(x, deckY(u) - 0.2, u)); }
    const st = new THREE.Mesh(tube(pts, 0.13, 0.13, 6, 24), dark); st.castShadow = true; g.add(st);
  }
  for (const x of [-BR_HALF_W, BR_HALF_W]) {
    const rail = [], mid = [];
    for (let i = 0; i <= 8; i++) { const u = -BR_L / 2 + (i / 8) * BR_L; rail.push(new THREE.Vector3(x, deckY(u) + 0.82, u)); mid.push(new THREE.Vector3(x, deckY(u) + 0.42, u)); }
    for (const [pts, r] of [[rail, 0.06], [mid, 0.04]] as const) { const t = new THREE.Mesh(tube(pts as THREE.Vector3[], r, r, 6, 24), wood); t.castShadow = true; g.add(t); }
    for (let i = 0; i <= 6; i++) {
      const u = -BR_L / 2 + (i / 6) * BR_L;
      box(g, 0.13, 0.95, 0.13, dark, x, deckY(u) + 0.4, u);
      if (i === 0 || i === 6) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), cap); c.position.set(x, deckY(u) + 0.95, u); g.add(c); const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), cap); c2.position.set(x, deckY(u) + 1.08, u); g.add(c2); }
    }
  }
  // stone abutments where the deck meets each bank
  const stone = m('#8a877d', 0.25);
  for (const s of [-1, 1]) for (const x of [-1.15, 1.15]) {
    const u = s * (BR_L / 2 - 0.1);
    const r = new THREE.Mesh(blob(0.6, 1, 0.25, s * 3 + x, 0.75), stone);
    const wx = BRIDGE.x + BRIDGE_DIR.y * x + BRIDGE_DIR.x * u, wz = BRIDGE.z - BRIDGE_DIR.x * x + BRIDGE_DIR.y * u;
    r.position.set(x, heightAt(wx, wz) + 0.15, u); r.castShadow = r.receiveShadow = true; g.add(r);
  }
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
