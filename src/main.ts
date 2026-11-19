import * as THREE from 'three';
import { globalUniforms, toon } from './render/toon';
import { createPost } from './render/post';
import { dayState } from './world/daylight';
import { createSky } from './world/sky';
import { buildTerrain, heightAt, HOUSE, HOUSE_ROT, HERO_TREE, LOOKOUT, surfaceAt } from './world/terrain';
import { createSea } from './world/sea';
import { createGrass } from './world/grass';
import { createClouds } from './world/clouds';
import { createHeroTree, createSmallTree } from './models/trees';
import { createTeaHouse } from './models/teahouse';
import { mulberry32 } from './lib/noise';
import { InputController } from './game/input';
import { createFollowCamera, createPlayer } from './game/player';

/**
 * Kettle Hill — Phase 0 (3D style test).
 * URL params:
 *   ?day=0.5       fixed time of day (0 midnight, .25 dawn, .5 noon, .75 dusk)
 *   ?speed=0.004   day-cycle speed (days per second); default one day per ~6 minutes
 *   ?cam=house     camera preset: house | tree | sea | aerial
 *   ?play=1        enable the behind-the-player prototype controls
 *   ?t=20          animation clock start (seconds)
 *   ?freeze=1      render one frame and stop (screenshots)
 *   ?q=low         quality: low | med | high
 */
const params = new URLSearchParams(location.search);
const fixedDay = params.has('day') ? Number(params.get('day')) : null;
const daySpeed = Number(params.get('speed') ?? 1 / 360);
const freeze = params.get('freeze') === '1';
const playMode = params.get('play') === '1';
const quality = (params.get('q') ?? 'high') as 'low' | 'med' | 'high';
let clock = Number(params.get('t') ?? 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fog = new THREE.Fog(0xcfe6f5, 140, 1300);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.3, 3000);

// --- lights ---
const hemi = new THREE.HemisphereLight(0x93b8ec, 0x5d7048, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff8ec, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
const sc = sun.shadow.camera;
sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

// --- world ---
const sky = createSky();
sky.mesh.scale.setScalar(2.4);
scene.add(sky.mesh);
const clouds = createClouds();
scene.add(clouds.group);

const terrain = buildTerrain();
terrain.material = toon({ vertexColors: true, rim: 0.05 });
terrain.receiveShadow = true;
scene.add(terrain);

const sea = createSea(heightAt);
scene.add(sea.mesh);

const grass = createGrass(quality === 'low' ? 50000 : quality === 'med' ? 100000 : 160000);
grass.mesh.receiveShadow = quality !== 'low';
scene.add(grass.mesh);

const house = createTeaHouse();
house.group.position.copy(HOUSE);
house.group.rotation.y = HOUSE_ROT;
scene.add(house.group);
const lanternLights: THREE.PointLight[] = [];
for (const a of house.lightAnchors) {
  const l = new THREE.PointLight(0xffb060, 0, 9, 1.6);
  l.position.copy(house.group.localToWorld(a.clone()));
  scene.add(l);
  lanternLights.push(l);
}

/** Lowest ground under a footprint, so trunks never float on the downhill side. */
function groundMin(x: number, z: number, r: number): number {
  let y = heightAt(x, z);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; y = Math.min(y, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return y;
}

const hero = createHeroTree(7, 1.05);
hero.position.set(HERO_TREE.x, groundMin(HERO_TREE.x, HERO_TREE.z, 1.2) - 0.2, HERO_TREE.z);
hero.rotation.y = 0.8;
scene.add(hero);

// forest edge on the north-east slope + a few scattered trees
const rand = mulberry32(42);
let planted = 0;
for (let i = 0; i < 400 && planted < 46; i++) {
  const a = -0.2 - rand() * 1.9; // north-east arc
  const r = 30 + rand() * 26;
  const x = Math.cos(a) * r + 6, z = Math.sin(a) * r;
  const s = surfaceAt(x, z);
  if (s.kind !== 'grass' || heightAt(x, z) < 1.5) continue;
  if (Math.hypot(x - HOUSE.x, z - HOUSE.z) < 16) continue;
  const t = createSmallTree(100 + i, rand() < 0.45 ? 'pine' : 'round');
  t.position.set(x, groundMin(x, z, 0.5) - 0.08, z);
  t.rotation.y = rand() * 6.28;
  t.scale.setScalar(0.9 + rand() * 0.9);
  scene.add(t);
  planted++;
}

// boulders near the lookout and along the path
const rockMat = toon({ vertexColors: true, rim: 0.2 });
import('./lib/geo').then(({ blob, paint, merge, place }) => {
  const parts: THREE.BufferGeometry[] = [];
  const rr = mulberry32(5);
  const spots: [number, number, number][] = [
    [LOOKOUT.x + 3, LOOKOUT.z + 2, 1.2], [LOOKOUT.x - 2, LOOKOUT.z - 3, 0.8], [LOOKOUT.x + 1, LOOKOUT.z - 4, 0.6],
    [14, 18, 0.9], [7, 24, 0.6], [-6, 6, 0.7], [20, 30, 1.1], [-15, 2, 0.5],
  ];
  for (const [x, z, s] of spots) {
    const g = blob(s, 1, 0.3, rr() * 30, 0.65);
    place(g, x, heightAt(x, z) + s * 0.2, z, rr(), rr() * 6, 0);
    parts.push(paint(g, new THREE.Color('#9a9488').offsetHSL(0, 0, (rr() - 0.5) * 0.1)));
  }
  const m = new THREE.Mesh(merge(parts), rockMat);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
});

// chimney smoke: soft billboards rising and leaning with the wind
const smokeTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // a soft cluster of overlapping puffs reads as smoke, a single radial blob reads as a light streak
  const puffs: [number, number, number][] = [[64, 70, 34], [44, 58, 24], [84, 56, 26], [60, 42, 22], [78, 80, 20], [46, 82, 18]];
  for (const [x, y, r] of puffs) {
    const grd = g.createRadialGradient(x, y, r * 0.2, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
})();
const smoke: THREE.Sprite[] = [];
const smokeOrigin = house.group.localToWorld(house.chimneyTop.clone());
for (let i = 0; i < 9; i++) {
  const m = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5 });
  const s = new THREE.Sprite(m);
  s.userData.phase = i / 9;
  s.userData.jit = Math.random() * 2 - 1;
  smoke.push(s);
  scene.add(s);
}

// fireflies
const fireflyGeo = new THREE.BufferGeometry();
const FF = 60;
const ffBase = new Float32Array(FF * 3);
for (let i = 0; i < FF; i++) {
  const a = rand() * Math.PI * 2, r = 4 + rand() * 30;
  const x = HOUSE.x + Math.cos(a) * r, z = HOUSE.z + 6 + Math.sin(a) * r;
  ffBase.set([x, heightAt(x, z) + 0.6 + rand() * 1.8, z], i * 3);
}
fireflyGeo.setAttribute('position', new THREE.BufferAttribute(ffBase.slice(), 3));
const fireflyMat = new THREE.PointsMaterial({ color: 0xd8ff8a, size: 0.22, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
scene.add(fireflies);

// --- camera presets (Phase 2 replaces this with the follow camera) ---
const presets: Record<string, [THREE.Vector3, THREE.Vector3]> = {
  house: [new THREE.Vector3(HOUSE.x + 9, HOUSE.y + 4.2, HOUSE.z + 21), new THREE.Vector3(HOUSE.x - 1, HOUSE.y + 2.6, HOUSE.z)],
  tree: [new THREE.Vector3(HERO_TREE.x + 13, HERO_TREE.y + 3, HERO_TREE.z + 17), new THREE.Vector3(HERO_TREE.x - 4, HERO_TREE.y + 5.5, HERO_TREE.z - 2)],
  sea: [new THREE.Vector3(HOUSE.x + 4, HOUSE.y + 3.4, HOUSE.z + 9), new THREE.Vector3(LOOKOUT.x - 40, 4, LOOKOUT.z - 10)],
  aerial: [new THREE.Vector3(70, 48, 80), new THREE.Vector3(0, 6, 0)],
  // looking west into the sunset over the sea: shadows run towards camera, silhouettes get rim light
  cover: [new THREE.Vector3(HOUSE.x + 17, HOUSE.y + 2.2, HOUSE.z + 11), new THREE.Vector3(HOUSE.x - 3, HOUSE.y + 3.2, HOUSE.z - 1)],
  roof: [new THREE.Vector3(HOUSE.x + 11, HOUSE.y + 6.5, HOUSE.z + 9), new THREE.Vector3(HOUSE.x + 1, HOUSE.y + 3.2, HOUSE.z)],
  porch: [new THREE.Vector3(HOUSE.x + 1.5, HOUSE.y + 1.7, HOUSE.z + 12.5), new THREE.Vector3(HOUSE.x + 0.5, HOUSE.y + 1.6, HOUSE.z + 2)],
  corner: [house.group.localToWorld(new THREE.Vector3(10.5, 6.2, 9.5)), house.group.localToWorld(new THREE.Vector3(5.2, 3.9, 3.8))],
  cornerlow: [house.group.localToWorld(new THREE.Vector3(9.5, 2.2, 9.0)), house.group.localToWorld(new THREE.Vector3(5.2, 3.9, 3.8))],
  tip: [house.group.localToWorld(new THREE.Vector3(5.2, 3.6, 11.5)), house.group.localToWorld(new THREE.Vector3(5.6, 4.1, 4.6))],
};
HERO_TREE.y = heightAt(HERO_TREE.x, HERO_TREE.z);
presets.tree = [new THREE.Vector3(HERO_TREE.x + 13, HERO_TREE.y + 3, HERO_TREE.z + 17), new THREE.Vector3(HERO_TREE.x - 4, HERO_TREE.y + 5.5, HERO_TREE.z - 2)];
// downhill side of the camphor tree, low: checks the trunk is planted
presets.treelow = [new THREE.Vector3(HERO_TREE.x - 7, HERO_TREE.y + 0.6, HERO_TREE.z + 7), new THREE.Vector3(HERO_TREE.x, HERO_TREE.y + 1.6, HERO_TREE.z)];
if (params.has('cp')) {
  const [a, b, c, d, e, f] = params.get('cp')!.split(',').map(Number);
  presets.custom = [new THREE.Vector3(a, b, c), new THREE.Vector3(d, e, f)];
}
const [camPos, camLook] = presets[params.has('cp') ? 'custom' : params.get('cam') ?? 'house'] ?? presets.house;
camera.position.copy(camPos);
camera.lookAt(camLook);
// Play mode owns the camera; style-test mode keeps the cinematic presets.
const input = new InputController(renderer.domElement);
const player = createPlayer();
player.position.set(7, heightAt(7, 7) + 0.02, 7);
scene.add(player.root);
const followCamera = createFollowCamera(camera);
followCamera.reset(player.root);
const playPrompt = document.createElement('div');
playPrompt.textContent = playMode ? 'WASD / arrows to walk · click to look · R to reset camera' : 'Kettle Hill · add ?play=1 to explore';
playPrompt.style.cssText = 'position:fixed;left:18px;bottom:18px;padding:9px 13px;border-radius:14px;color:#fff;background:rgba(32,38,56,.62);font:13px system-ui,sans-serif;letter-spacing:.02em;text-shadow:0 1px 2px #000;pointer-events:none;backdrop-filter:blur(5px)';
if (params.get('ui') !== '0') document.body.appendChild(playPrompt);
// gentle orbit drift so the live build feels alive (disabled for stills and play mode)
const orbitCentre = camLook.clone();
const orbitR = Math.hypot(camPos.x - camLook.x, camPos.z - camLook.z);
let orbitA = Math.atan2(camPos.z - camLook.z, camPos.x - camLook.x);

const post = createPost(renderer, scene, camera);
const resize = () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  post.setSize(w, h, renderer.getPixelRatio());
};
resize();
window.addEventListener('resize', resize);

const smooth01 = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
let day = fixedDay ?? 0.69; // open on golden hour
const tmp = new THREE.Vector3();
function frame(dt: number) {
  clock += dt;
  if (fixedDay === null) day = (day + dt * daySpeed) % 1;
  const s = dayState(day);
  const wind = 1.0 + 0.35 * Math.sin(clock * 0.21) + 0.2 * Math.sin(clock * 0.53 + 1.3);

  globalUniforms.uTime.value = clock;
  globalUniforms.uWind.value = wind;
  globalUniforms.uSunColor.value.copy(s.sunColor);
  globalUniforms.uAmbient.value.copy(s.ambientSky);
  globalUniforms.uNight.value = s.night;
  globalUniforms.uCloudOff.value.set(clock * 1.6, clock * 0.55);
  globalUniforms.uCloudAmt.value = 0.85 * (1 - s.night) * Math.min(1, s.sunIntensity / 1.5);

  // light: sun by day, moon by night (cool and dim)
  const lightDir = s.night > 0.55 ? s.moonDir : s.sunDir;
  sun.position.copy(lightDir).multiplyScalar(120).add(tmp.set(0, 0, 0));
  sun.target.position.set(0, 0, 0);
  sun.color.copy(s.night > 0.55 ? new THREE.Color('#9fb3ff') : s.sunColor);
  sun.intensity = s.night > 0.55 ? 0.6 : s.sunIntensity * 1.25;
  hemi.color.copy(s.ambientSky);
  hemi.groundColor.copy(s.ambientGround);
  hemi.intensity = 0.55 + 0.2 * (1 - s.night);
  fog.color.copy(s.fog);
  scene.background = s.fog;

  sky.update(s, clock);
  clouds.update(s, dt, wind);
  sea.update(s, fog);
  grass.update(s.ambientSky, s.ambientGround, s.sunIntensity);

  // lanterns + shoji glow
  // someone is always home: a faint warm glow by day that swells into lamplight at dusk
  const glow = Math.max(s.lanterns, 0.25 + 0.6 * smooth01((0.62 - s.sunDir.y) / 0.5));
  for (const m of house.glowMaterials) m.emissiveIntensity = glow * 1.6;
  for (const l of lanternLights) l.intensity = glow * (5 + Math.sin(clock * 7 + l.id) * 0.4);

  // smoke
  for (const sp of smoke) {
    const t = (sp.userData.phase + clock * 0.06) % 1;
    sp.position.copy(smokeOrigin).add(tmp.set(t * 3.5 * wind + Math.sin(t * 6 + clock * 0.7) * 0.5 + sp.userData.jit * t * 0.8, t * 6, t * 1.2 + sp.userData.jit * 0.3));
    const sz = 0.9 + t * 3.6;
    sp.scale.set(sz, sz, 1);
    (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, t * 6) * (1 - t) * 0.55;
    (sp.material as THREE.SpriteMaterial).rotation = sp.userData.jit * 2 + t * 0.8;
    (sp.material as THREE.SpriteMaterial).color.copy(s.cloudLit).lerp(s.ambientSky, 0.3);
  }

  // fireflies wander at night
  const fp = fireflyGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < FF; i++) {
    fp.setXYZ(i,
      ffBase[i * 3] + Math.sin(clock * 0.4 + i * 2.1) * 1.2,
      ffBase[i * 3 + 1] + Math.sin(clock * 0.7 + i) * 0.4,
      ffBase[i * 3 + 2] + Math.cos(clock * 0.33 + i * 1.3) * 1.2);
  }
  fp.needsUpdate = true;
  fireflyMat.opacity = s.night * (0.7 + 0.3 * Math.sin(clock * 2));

  if (playMode && !freeze) {
    if (input.consumeResetCamera()) followCamera.reset(player.root);
    player.update(input, dt, followCamera.yaw, clock);
    followCamera.update(player.root, input, dt);
  } else if (!freeze) {
    orbitA += dt * 0.01;
    camera.position.set(orbitCentre.x + Math.cos(orbitA) * orbitR, camPos.y + Math.sin(clock * 0.2) * 0.15, orbitCentre.z + Math.sin(orbitA) * orbitR);
    camera.lookAt(orbitCentre);
  }
  sky.mesh.position.copy(camera.position);

  post.update(clock, s.night);
  post.composer.render(dt);
}

let last = performance.now();
const fpsEl = params.get('fps') === '1' ? Object.assign(document.createElement('div'), { style: 'position:fixed;top:6px;left:8px;color:#fff;font:12px monospace;text-shadow:0 1px 2px #000' }) : null;
if (fpsEl) document.body.appendChild(fpsEl);
let frames = 0, fpsT = 0;

if (freeze) {
  frame(1 / 60);
  frame(1 / 60);
  (window as unknown as { __ready: boolean }).__ready = true;
} else {
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    if (fpsEl) { frames++; fpsT += dt; if (fpsT > 0.5) { fpsEl.textContent = `${Math.round(frames / fpsT)} fps · ${grass.count} blades`; frames = 0; fpsT = 0; } }
    (window as unknown as { __ready: boolean }).__ready = true;
  });
}
