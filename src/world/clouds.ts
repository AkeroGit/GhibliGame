import * as THREE from 'three';
import { blob, merge, place } from '../lib/geo';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../lib/noise';
import type { DayState } from './daylight';

/**
 * Towering painted cumulus: each cloud is a merged pile of lumpy puffs, flat-bottomed,
 * shaded with a 3-band ramp (sunlit cream -> mid -> cool blue belly) in a custom shader.
 * Clouds sit in a ring far out over the sea and drift slowly with the wind.
 */
export function createClouds(count = 16) {
  const rand = mulberry32(99);
  const uniforms = {
    uSunDir: { value: new THREE.Vector3() },
    uLit: { value: new THREE.Color() },
    uShade: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
    uNight: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying float vH;
      attribute float aH;
      void main(){
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vH = aH;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uLit, uShade, uHorizon, uSunCol; uniform float uNight;
      varying vec3 vN; varying vec3 vW; varying float vH;
      void main(){
        float ndl = dot(normalize(vN), normalize(uSunDir));
        float l = ndl * 0.5 + 0.5;
        l = mix(l, vH, 0.45);               // tops are brighter than bellies
        // painted bands with soft transitions
        float b1 = smoothstep(0.38, 0.46, l);
        float b2 = smoothstep(0.62, 0.70, l);
        vec3 mid = mix(uShade, uLit, 0.55);
        vec3 col = mix(uShade, mid, b1);
        col = mix(col, uLit, b2);
        // warm rim where the sun grazes the edge
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.5);
        col += uSunCol * rim * 0.25 * max(ndl, 0.0) * (1.0 - uNight);
        // aerial perspective: distant/low parts melt into the horizon
        col = mix(col, uHorizon, (1.0 - vH) * 0.28);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const group = new THREE.Group();
  const clouds: { mesh: THREE.Mesh; angle: number; dist: number; speed: number }[] = [];
  for (let i = 0; i < count; i++) {
    const parts: THREE.BufferGeometry[] = [];
    const size = 60 + rand() * 70;
    const tall = 0.9 + rand() * 0.9;
    const puffs = 18 + Math.floor(rand() * 12);
    for (let k = 0; k < puffs; k++) {
      // stack puffs into a cauliflower tower: wider at the base, rising in the middle
      const t = k / puffs;
      const ang = rand() * Math.PI * 2;
      const rad = (1 - t * 0.7) * size * 0.75 * rand();
      const r = size * (0.32 + rand() * 0.22) * (1 - t * 0.35);
      const y = t * size * tall * 1.1 + r * 0.3;
      const g = blob(r, 2, 0.18, rand() * 100, 0.9);
      place(g, Math.cos(ang) * rad, y, Math.sin(ang) * rad * 0.6);
      parts.push(g);
    }
    const geo = mergeVertices(merge(parts));
    // flatten the bottom and store normalised height for shading
    const p = geo.attributes.position as THREE.BufferAttribute;
    let maxY = 0;
    for (let k = 0; k < p.count; k++) maxY = Math.max(maxY, p.getY(k));
    const hAttr = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) {
      const y = Math.max(p.getY(k), 0);
      p.setY(k, y);
      hAttr[k] = y / maxY;
    }
    geo.setAttribute('aH', new THREE.BufferAttribute(hAttr, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
    const dist = 900 + rand() * 600;
    mesh.position.set(Math.cos(angle) * dist, 25 + rand() * 60, Math.sin(angle) * dist);
    mesh.rotation.y = rand() * Math.PI;
    mesh.scale.setScalar(1.6 + rand() * 1.4);
    group.add(mesh);
    clouds.push({ mesh, angle, dist, speed: (0.6 + rand() * 0.6) * 0.0012 });
  }

  return {
    group,
    update(s: DayState, dt: number, wind: number) {
      uniforms.uSunDir.value.copy(s.night > 0.6 ? s.moonDir : s.sunDir);
      uniforms.uLit.value.copy(s.cloudLit);
      uniforms.uShade.value.copy(s.cloudShade);
      uniforms.uHorizon.value.copy(s.skyHorizon);
      uniforms.uSunCol.value.copy(s.sunColor);
      uniforms.uNight.value = s.night;
      for (const c of clouds) {
        c.angle += c.speed * dt * wind;
        c.mesh.position.x = Math.cos(c.angle) * c.dist;
        c.mesh.position.z = Math.sin(c.angle) * c.dist;
      }
    },
  };
}
