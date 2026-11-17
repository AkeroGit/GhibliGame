import * as THREE from 'three';

/** Time-of-day palette. day: 0 midnight, .25 dawn, .5 noon, .75 dusk. */
export interface DayState {
  day: number;
  night: number; // 0 day .. 1 full night
  sunDir: THREE.Vector3; // towards the sun
  moonDir: THREE.Vector3;
  skyTop: THREE.Color;
  skyHorizon: THREE.Color;
  sunColor: THREE.Color; // direct light colour
  sunIntensity: number;
  ambientSky: THREE.Color; // hemisphere sky colour (cool shadows)
  ambientGround: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  fog: THREE.Color;
  lanterns: number; // 0..1 lantern glow
}

type Key = { at: number; top: string; hor: string; sun: string; sunI: number; amb: string; gnd: string; lit: string; shade: string };

// Hand-picked keys: warm dawn, clean summer noon, peach dusk, deep blue night.
const KEYS: Key[] = [
  { at: 0.0, top: '#0b1430', hor: '#26345e', sun: '#8fa6e8', sunI: 0.35, amb: '#2a3966', gnd: '#141a2a', lit: '#9fb0dd', shade: '#2a3560' },
  { at: 0.2, top: '#1d2a57', hor: '#5b5a86', sun: '#ffb38a', sunI: 0.5, amb: '#46508a', gnd: '#2a2a3a', lit: '#f6c3b0', shade: '#5a5d8f' },
  { at: 0.27, top: '#5d7fc0', hor: '#ffc9a0', sun: '#ffcf9e', sunI: 1.6, amb: '#7d8fc8', gnd: '#5a5040', lit: '#fff0dd', shade: '#9aa6d6' },
  { at: 0.36, top: '#3f86e0', hor: '#b6dbf4', sun: '#fff4df', sunI: 2.4, amb: '#8fb2e8', gnd: '#5a6a48', lit: '#ffffff', shade: '#a8bde6' },
  { at: 0.5, top: '#2f7ade', hor: '#acd6f3', sun: '#fff8ec', sunI: 2.7, amb: '#93b8ec', gnd: '#5d7048', lit: '#ffffff', shade: '#aec4ea' },
  { at: 0.64, top: '#3a7cd6', hor: '#d9e0dc', sun: '#ffe6c0', sunI: 2.3, amb: '#8eaee0', gnd: '#5d6a48', lit: '#fff8ea', shade: '#a6b6e0' },
  { at: 0.73, top: '#5a64b0', hor: '#ffab78', sun: '#ff9a5c', sunI: 1.5, amb: '#7a78b8', gnd: '#5a4038', lit: '#ffd2a8', shade: '#8a7cb4' },
  { at: 0.8, top: '#2a2c66', hor: '#c06a70', sun: '#ff7a5a', sunI: 0.5, amb: '#504a88', gnd: '#2a2030', lit: '#d898a0', shade: '#4a4478' },
  { at: 0.88, top: '#0e1636', hor: '#2c3766', sun: '#8fa6e8', sunI: 0.35, amb: '#2a3966', gnd: '#141a2a', lit: '#9fb0dd', shade: '#2a3560' },
  { at: 1.0, top: '#0b1430', hor: '#26345e', sun: '#8fa6e8', sunI: 0.35, amb: '#2a3966', gnd: '#141a2a', lit: '#9fb0dd', shade: '#2a3560' },
];

const c = (s: string) => new THREE.Color(s);
const keyColors = KEYS.map((k) => ({
  top: c(k.top), hor: c(k.hor), sun: c(k.sun), amb: c(k.amb), gnd: c(k.gnd), lit: c(k.lit), shade: c(k.shade),
}));

const state: DayState = {
  day: 0.5, night: 0,
  sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(),
  skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), sunColor: new THREE.Color(), sunIntensity: 1,
  ambientSky: new THREE.Color(), ambientGround: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(),
  fog: new THREE.Color(), lanterns: 0,
};

const smooth = (t: number) => t * t * (3 - 2 * t);

export function dayState(day: number): DayState {
  const d = ((day % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && d > KEYS[i + 1].at) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = smooth((d - a.at) / (b.at - a.at));
  const A = keyColors[i], B = keyColors[i + 1];
  state.day = d;
  state.skyTop.lerpColors(A.top, B.top, f);
  state.skyHorizon.lerpColors(A.hor, B.hor, f);
  state.sunColor.lerpColors(A.sun, B.sun, f);
  state.sunIntensity = a.sunI + (b.sunI - a.sunI) * f;
  state.ambientSky.lerpColors(A.amb, B.amb, f);
  state.ambientGround.lerpColors(A.gnd, B.gnd, f);
  state.cloudLit.lerpColors(A.lit, B.lit, f);
  state.cloudShade.lerpColors(A.shade, B.shade, f);
  state.fog.copy(state.skyHorizon).lerp(state.skyTop, 0.15);

  // Sun travels east -> overhead -> west; tilted so it sits over the sea at dusk.
  const ang = (d - 0.25) * Math.PI * 2; // 0 at dawn, PI/2 at noon
  const tilt = 0.55;
  state.sunDir.set(Math.cos(ang), Math.sin(ang) * Math.cos(tilt), Math.sin(ang) * Math.sin(tilt) * 0.6 + 0.25).normalize();
  state.moonDir.copy(state.sunDir).multiplyScalar(-1);
  state.moonDir.y = Math.abs(state.moonDir.y) * 0.8 + 0.25;
  state.moonDir.normalize();

  const sunUp = smoothstep01((state.sunDir.y + 0.08) / 0.28);
  state.night = 1 - sunUp;
  state.lanterns = smoothstep01((0.18 - state.sunDir.y) / 0.3);
  return state;
}

function smoothstep01(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
