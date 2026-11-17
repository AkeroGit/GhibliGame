import * as THREE from 'three';
import { GLSL_NOISE } from '../lib/noise';
import { globalUniforms } from '../render/toon';
import type { DayState } from './daylight';

/** Stylised sea: depth-tinted colour, painted wave bands, sun/moon glitter, foam at the shore. */
export function createSea(heightAt: (x: number, z: number) => number) {
  // Bake a small depth texture so the shader knows where the shore is.
  const S = 256, WORLD = 240;
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = -WORLD / 2 + (i / (S - 1)) * WORLD, z = -WORLD / 2 + (j / (S - 1)) * WORLD;
    const depth = Math.max(0, Math.min(1, -heightAt(x, z) / 8));
    data[(j * S + i) * 4] = Math.round(depth * 255);
    data[(j * S + i) * 4 + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  depthTex.magFilter = THREE.LinearFilter;
  depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  const uniforms = {
    ...globalUniforms,
    uDepth: { value: depthTex },
    uShallow: { value: new THREE.Color('#5fc4b8') },
    uDeep: { value: new THREE.Color('#1f5b8a') },
    uSky: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDirW: { value: new THREE.Vector3() },
    uMoonDirW: { value: new THREE.Vector3() },
    uLightCol: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uFogNear: { value: 140 },
    uFogFar: { value: 1300 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW;
      varying vec2 vUv2;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        float sw = sin(w.x * 0.08 + uTime * 0.7) * 0.06 + sin(w.z * 0.11 - uTime * 0.9) * 0.05;
        w.y += sw;
        vW = w.xyz;
        vUv2 = (w.xz + 120.0) / 240.0;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDepth;
      uniform vec3 uShallow, uDeep, uSky, uHorizon, uSunDirW, uMoonDirW, uLightCol, uFogColor;
      uniform float uTime, uNight, uFogNear, uFogFar;
      varying vec3 vW;
      varying vec2 vUv2;
      ${GLSL_NOISE}
      void main(){
        bool inside = all(greaterThan(vUv2, vec2(0.0))) && all(lessThan(vUv2, vec2(1.0)));
        float depth = inside ? texture2D(uDepth, vUv2).r : 1.0;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(V.y, 0.0), 4.0);
        vec3 water = mix(uShallow, uDeep, smoothstep(0.02, 0.55, depth));
        // painted wave bands that drift with the wind
        vec2 p = vW.xz;
        float bands = kh_fbm(p * 0.12 + vec2(uTime * 0.05, uTime * 0.03));
        float bands2 = kh_fbm(p * 0.35 - vec2(uTime * 0.08, -uTime * 0.02));
        water *= 0.92 + 0.12 * smoothstep(0.45, 0.7, bands);
        water = mix(water, water * 1.18, smoothstep(0.62, 0.72, bands2) * 0.6);
        // light: night darkens and cools
        water *= mix(vec3(1.0), vec3(0.32, 0.38, 0.62), uNight);
        water = mix(water, mix(uHorizon, uSky, 0.4), fres * 0.7);
        // glitter path towards sun / moon
        vec3 L = normalize(mix(uSunDirW, uMoonDirW, step(0.5, uNight)));
        vec3 H = normalize(L + V);
        float glit = kh_noise(p * 2.2 + uTime * 0.6) * kh_noise(p * 3.7 - uTime * 0.4);
        float spec = pow(max(dot(vec3(0.0, 1.0, 0.0) + (vec3(kh_noise(p*1.3+uTime*0.3), 0.0, kh_noise(p*1.1-uTime*0.25)) - 0.5) * 0.35, H), 0.0), 90.0);
        water += uLightCol * smoothstep(0.08, 0.25, glit * spec * 6.0) * mix(1.2, 0.6, uNight);
        // shore foam: animated lines that follow the depth contours
        float shore = 1.0 - smoothstep(0.0, 0.12, depth);
        float wave = sin(depth * 70.0 - uTime * 1.6 + kh_noise(p * 0.5) * 4.0);
        float foam = smoothstep(0.55, 0.9, wave) * smoothstep(0.0, 0.06, depth) * shore;
        foam += smoothstep(0.03, 0.0, depth) * 0.9;
        foam *= 0.6 + 0.4 * kh_noise(p * 1.5 + uTime * 0.2);
        water = mix(water, vec3(0.97, 0.98, 1.0) * mix(1.0, 0.45, uNight), clamp(foam, 0.0, 1.0));
        float alpha = mix(0.55, 0.96, smoothstep(0.0, 0.25, depth));
        alpha = max(alpha, foam);
        // fog to horizon
        float dist = length(vW - cameraPosition);
        float f = smoothstep(uFogNear, uFogFar, dist);
        water = mix(water, uFogColor, f);
        gl_FragColor = vec4(water, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const geo = new THREE.PlaneGeometry(4000, 4000, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.05;
  mesh.renderOrder = 2;

  return {
    mesh,
    update(s: DayState, fog: THREE.Fog) {
      uniforms.uSky.value.copy(s.skyTop);
      uniforms.uHorizon.value.copy(s.skyHorizon);
      uniforms.uSunDirW.value.copy(s.sunDir);
      uniforms.uMoonDirW.value.copy(s.moonDir);
      uniforms.uLightCol.value.copy(s.night > 0.5 ? new THREE.Color(0.75, 0.8, 1.0) : s.sunColor);
      uniforms.uFogColor.value.copy(fog.color);
      uniforms.uFogNear.value = fog.near;
      uniforms.uFogFar.value = fog.far;
    },
  };
}
