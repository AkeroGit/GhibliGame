import * as THREE from 'three';

/**
 * Shared "painted animation" material language.
 * - 4-step toon ramp with soft steps (cel shading without hard aliasing)
 * - cool, bluish shadows come from the hemisphere light; warm light from the sun
 * - optional rim light so silhouettes glow against the sky
 * - optional wind sway (vertex shader), driven by global uniforms
 */

export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uWindDir: { value: new THREE.Vector2(1, 0.35).normalize() },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uAmbient: { value: new THREE.Color(0.55, 0.62, 0.8) },
  uNight: { value: 0 },
  uCloudOff: { value: new THREE.Vector2() }, // drifting cloud-shadow offset (world metres)
  uCloudAmt: { value: 0.0 }, // cloud-shadow strength (0 at night)
};

/** GLSL: soft drifting cloud shadows in world XZ. Shared by every lit material. */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform vec2 uCloudOff; uniform float uCloudAmt;
float csH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float csN(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(csH(i),csH(i+vec2(1,0)),u.x), mix(csH(i+vec2(0,1)),csH(i+vec2(1,1)),u.x), u.y); }
float cloudShadow(vec2 xz){
  vec2 p = (xz + uCloudOff) * 0.02;
  float n = csN(p) * 0.6 + csN(p * 2.3 + 7.1) * 0.3 + csN(p * 5.1 - 3.7) * 0.1;
  return smoothstep(0.44, 0.68, n) * uCloudAmt;
}
vec3 applyCloudShadow(vec3 col, vec2 xz){
  float c = cloudShadow(xz);
  return mix(col, col * vec3(0.8, 0.83, 0.93), c);
}`;

let ramp: THREE.DataTexture | null = null;
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  // 64px ramp with smoothed steps -> painted bands with soft edges
  const n = 64;
  const data = new Uint8Array(n * 4);
  const steps = [0.0, 0.42, 0.72, 1.0];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const k = x * (steps.length - 1);
    const lo = Math.floor(k);
    const f = k - lo;
    const s = f < 0.85 ? 0 : (f - 0.85) / 0.15; // soft step
    const v = steps[Math.min(lo, steps.length - 1)] * (1 - s) + steps[Math.min(lo + 1, steps.length - 1)] * s;
    const b = Math.round(Math.min(1, 0.18 + v * 0.82) * 255);
    data.set([b, b, b, 255], i * 4);
  }
  ramp = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  ramp.magFilter = THREE.LinearFilter;
  ramp.minFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  return ramp;
}

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  rim?: number; // 0..1 rim light strength
  sway?: number; // wind sway amplitude in metres at 10m height
  swayHeight?: number; // object height used to normalise sway
  side?: THREE.Side;
  transparent?: boolean;
  alphaTest?: number;
}

export function toon(opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    color: opts.color ?? 0xffffff,
    gradientMap: toonRamp(),
    vertexColors: opts.vertexColors ?? false,
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    alphaTest: opts.alphaTest ?? 0,
  });
  const rim = opts.rim ?? 0.35;
  const sway = opts.sway ?? 0;
  const swayH = opts.swayHeight ?? 10;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms);
    shader.uniforms.uRim = { value: rim };
    shader.uniforms.uSway = { value: sway };
    shader.uniforms.uSwayH = { value: swayH };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
uniform float uSway; uniform float uSwayH;
varying vec3 vWorldPosK;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
if (uSway > 0.0) {
  vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
  float hgt = clamp(transformed.y / uSwayH, 0.0, 1.5);
  float ph = dot(wp0.xz, vec2(0.11, 0.07));
  float gust = sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 2.3 + ph * 2.7 + transformed.x * 0.8) * 0.25;
  vec2 off = uWindDir * (gust * uWind + 0.35 * uWind) * uSway * hgt * hgt;
  transformed.x += off.x; transformed.z += off.y;
}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 wpk = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
wpk = instanceMatrix * wpk;
#endif
vWorldPosK = (modelMatrix * wpk).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunColor; uniform vec3 uAmbient; uniform float uRim; uniform float uNight;
varying vec3 vWorldPosK;
${CLOUD_SHADOW_GLSL}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// rim light: silhouettes catch the sky colour
vec3 vdir = normalize(cameraPosition - vWorldPosK);
float rimF = pow(1.0 - clamp(dot(normalize(vNormal), normalize((viewMatrix * vec4(vdir, 0.0)).xyz)), 0.0, 1.0), 3.0);
// far away the rim is thinner than a pixel and just twinkles on leaf clusters and reeds
rimF *= 1.0 - 0.8 * smoothstep(18.0, 60.0, length(cameraPosition - vWorldPosK));
outgoingLight += mix(uSunColor, uAmbient, 0.5) * rimF * uRim * (1.0 - 0.7 * uNight) * diffuseColor.rgb;
outgoingLight = applyCloudShadow(outgoingLight - totalEmissiveRadiance, vWorldPosK.xz) + totalEmissiveRadiance;
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => `toon-${rim}-${sway}-${swayH}`;
  return mat;
}
