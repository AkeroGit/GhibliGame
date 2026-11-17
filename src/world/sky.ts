import * as THREE from 'three';
import { GLSL_NOISE } from '../lib/noise';
import type { DayState } from './daylight';

/** Painted sky dome: gradient, glowing sun, crescent moon, twinkling stars. */
export function createSky() {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uMoonDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always at far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uSunDir, uMoonDir, uSunColor;
      uniform float uNight, uTime;
      varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        // gradient: horizon band is wide and soft, top is saturated
        vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(col, uHorizon * 0.85, smoothstep(0.0, -0.2, h)); // below horizon
        // warm scattering around the sun, strongest near the horizon
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        float horizonBoost = 1.0 - smoothstep(0.0, 0.5, h);
        col += uSunColor * (pow(sd, 8.0) * 0.35 + pow(sd, 2.0) * 0.12 * horizonBoost) * (1.0 - uNight * 0.8);
        // sun disc with a soft painted halo
        float disc = smoothstep(0.9993, 0.9996, sd);
        col = mix(col, vec3(1.0, 0.98, 0.9), disc * (1.0 - uNight));
        col += uSunColor * pow(sd, 400.0) * 0.6 * (1.0 - uNight);
        // moon: crescent, gentle glow
        float md = dot(d, normalize(uMoonDir));
        vec3 off = normalize(uMoonDir + vec3(0.012, 0.006, 0.0));
        float moon = smoothstep(0.9990, 0.9993, md) * (1.0 - smoothstep(0.9990, 0.9993, dot(d, off)));
        col += vec3(0.98, 0.95, 0.82) * moon * uNight;
        col += vec3(0.35, 0.42, 0.7) * pow(max(md, 0.0), 60.0) * 0.4 * uNight;
        // stars
        vec2 sp = vec2(atan(d.z, d.x) * 120.0, asin(clamp(d.y, -1.0, 1.0)) * 120.0);
        vec2 cell = floor(sp);
        float star = step(0.985, kh_hash(cell));
        vec2 fp = fract(sp) - 0.5;
        float shape = smoothstep(0.18, 0.0, length(fp));
        float tw = 0.6 + 0.4 * sin(uTime * 1.7 + kh_hash(cell + 3.1) * 60.0);
        col += vec3(0.9, 0.93, 1.0) * star * shape * tw * uNight * smoothstep(0.05, 0.35, h);
        // faint milky band
        float band = kh_fbm(sp * 0.02) * smoothstep(0.35, 0.0, abs(d.y - d.x * 0.4 - 0.3));
        col += vec3(0.25, 0.28, 0.45) * band * 0.25 * uNight;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  return {
    mesh,
    update(s: DayState, time: number) {
      uniforms.uTop.value.copy(s.skyTop);
      uniforms.uHorizon.value.copy(s.skyHorizon);
      uniforms.uSunDir.value.copy(s.sunDir);
      uniforms.uMoonDir.value.copy(s.moonDir);
      uniforms.uSunColor.value.copy(s.sunColor);
      uniforms.uNight.value = s.night;
      uniforms.uTime.value = time;
    },
  };
}
